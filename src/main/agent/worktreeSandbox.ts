import { randomUUID } from 'crypto'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { dirname, join, posix, resolve } from 'path'
import type { AgentSession, AgentTurn, AgentWorkspaceLocation, EditProposal, ExecutionSandbox } from '../../shared/agent/protocol'
import { createCheckpoint } from './checkpointStore'
import { createEditProposal, createEditProposalSet, getEditProposal } from './editStore'
import { workspaceGitDiff, workspaceReadFile, workspaceRunCommand } from './workspace'

import { rmSyncWithRetry, shellQuote as quote } from './platform'
import { createSandboxAdapter } from './sandboxAdapter'

const sandboxes = new Map<string, ExecutionSandbox>()

function localSandboxPath(sessionId: string, sandboxId: string): string {
  return join(app.getPath('userData'), 'agent', 'worktrees', sessionId, sandboxId)
}

function remoteSandboxPath(workspace: AgentWorkspaceLocation, sandboxId: string): string {
  const root = workspace.path.replace(/\\/g, '/').replace(/\/+$/, '')
  const parent = root.includes('/') ? root.slice(0, root.lastIndexOf('/')) || '/' : '.'
  return posix.join(parent, '.rille-agent-worktrees', sandboxId)
}

function sandboxPathFor(sessionId: string, workspace: AgentWorkspaceLocation, sandboxId: string): string {
  return workspace.kind === 'local' || workspace.kind === 'worktree'
    ? localSandboxPath(sessionId, sandboxId)
    : remoteSandboxPath(workspace, sandboxId)
}

export function listSandboxes(sessionId?: string): ExecutionSandbox[] {
  return [...sandboxes.values()]
    .filter(item => !sessionId || item.sessionId === sessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createWorktreeSandbox(input: {
  sessionId: string
  workspace: AgentWorkspaceLocation
  reason?: string
}): Promise<ExecutionSandbox> {
  const sandboxId = `sandbox_${randomUUID()}`
  const targetPath = sandboxPathFor(input.sessionId, input.workspace, sandboxId)
  const timestamp = Date.now()
  let sandbox: ExecutionSandbox = {
    id: sandboxId,
    sessionId: input.sessionId,
    workspace: input.workspace,
    sandboxWorkspace: {
      ...input.workspace,
      kind: 'worktree',
      path: targetPath,
      label: `${input.workspace.label || 'workspace'} sandbox`,
      origin: input.workspace,
      sandboxId,
    },
    status: 'creating',
    reason: input.reason,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  sandboxes.set(sandboxId, sandbox)
  try {
    if (input.workspace.kind === 'local' || input.workspace.kind === 'worktree') {
      mkdirSync(dirname(resolve(targetPath)), { recursive: true })
    }
    const mkdir = input.workspace.kind === 'local' || input.workspace.kind === 'worktree' ? '' : `mkdir -p ${quote(dirname(targetPath))} && `
    const check = await workspaceRunCommand(input.workspace, { commandLine: 'git rev-parse --is-inside-work-tree', timeoutMs: 30_000 })
    if (check.status !== 'ok') throw new Error('当前 workspace 不是 git 仓库，无法创建 worktree sandbox。')
    const result = await workspaceRunCommand(input.workspace, {
      commandLine: `${mkdir}git worktree add --detach ${quote(targetPath)} HEAD`,
      timeoutMs: 120_000,
      outputLimitBytes: 120 * 1024,
      shellMode: true,
    })
    if (result.status !== 'ok') throw new Error(result.output || result.error || '创建 worktree sandbox 失败。')
    const adapter = createSandboxAdapter()
    sandbox = { ...sandbox, status: 'ready', constraints: adapter.describe(), updatedAt: Date.now() }
    sandboxes.set(sandboxId, sandbox)
    return sandbox
  } catch (error) {
    sandbox = { ...sandbox, status: 'failed', reason: error instanceof Error ? error.message : String(error), updatedAt: Date.now() }
    sandboxes.set(sandboxId, sandbox)
    return sandbox
  }
}

export async function diffSandbox(sessionId: string, sandboxId: string): Promise<string> {
  const sandbox = sandboxes.get(sandboxId)
  if (!sandbox || sandbox.sessionId !== sessionId) throw new Error('Sandbox does not exist.')
  return workspaceGitDiff(sandbox.sandboxWorkspace)
}

export async function sandboxDiffAsProposals(session: AgentSession, turn: AgentTurn, sandboxId: string): Promise<EditProposal[]> {
  const sandbox = sandboxes.get(sandboxId)
  if (!sandbox || sandbox.sessionId !== session.id) throw new Error('Sandbox does not exist.')
  if (sandbox.status !== 'ready') throw new Error('Sandbox is not ready.')
  const changed = await workspaceRunCommand(sandbox.sandboxWorkspace, {
    commandLine: 'git diff --name-only && git ls-files --others --exclude-standard',
    timeoutMs: 30_000,
    outputLimitBytes: 64 * 1024,
    shellMode: true,
  })
  if (changed.status !== 'ok') throw new Error(changed.output || changed.error || '读取 sandbox diff 失败。')
  const files = changed.output.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (files.length === 0) return []
  const proposals = await Promise.all(files.map(async filePath => {
    const originalContent = await workspaceReadFile(sandbox.workspace, filePath).catch(() => '')
    const modifiedContent = await workspaceReadFile(sandbox.sandboxWorkspace, filePath).catch(() => '')
    return createEditProposal({
      session,
      turn,
      title: `合并 sandbox 变更: ${filePath}`,
      filePath,
      originalContent,
      modifiedContent,
      rationale: `从 sandbox ${sandbox.id} 生成可审查合并提案。`,
      sandboxId: sandbox.id,
    })
  }))
  const set = createEditProposalSet({
    session,
    turn,
    title: `合并 sandbox ${sandbox.id}`,
    source: 'sandbox',
    sandboxId: sandbox.id,
    proposals,
  })
  return set.proposalIds.map(id => getEditProposal(id)).filter((item): item is EditProposal => Boolean(item))
}

export async function disposeSandbox(sessionId: string, sandboxId: string): Promise<ExecutionSandbox> {
  const sandbox = sandboxes.get(sandboxId)
  if (!sandbox || sandbox.sessionId !== sessionId) throw new Error('Sandbox does not exist.')
  let checkpoint = sandbox.checkpoint
  try {
    if (sandbox.status === 'ready') {
      checkpoint = await createCheckpoint({
        sessionId,
        workspace: sandbox.sandboxWorkspace,
        reason: `Dispose sandbox ${sandboxId}`,
      })
      if (sandbox.workspace.kind === 'local' || sandbox.workspace.kind === 'worktree') {
        if (existsSync(sandbox.sandboxWorkspace.path)) rmSyncWithRetry(sandbox.sandboxWorkspace.path)
      } else {
        await workspaceRunCommand(sandbox.workspace, {
          commandLine: `git worktree remove --force ${quote(sandbox.sandboxWorkspace.path)} || rm -rf ${quote(sandbox.sandboxWorkspace.path)}`,
          timeoutMs: 120_000,
          shellMode: true,
        })
      }
    }
  } catch {
    // Keep disposal best-effort. The checkpoint or command error is visible via runtime state.
  }
  const next: ExecutionSandbox = { ...sandbox, checkpoint, status: 'disposed', updatedAt: Date.now() }
  sandboxes.set(sandboxId, next)
  return next
}
