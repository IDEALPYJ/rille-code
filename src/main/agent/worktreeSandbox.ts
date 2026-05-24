import { randomUUID } from 'crypto'
import { app } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { dirname, join, posix, resolve } from 'path'
import type { AgentWorkspaceLocation, ExecutionSandbox } from '../../shared/agent/protocol'
import { createCheckpoint } from './checkpointStore'
import { workspaceGitDiff, workspaceRunCommand } from './workspace'

const sandboxes = new Map<string, ExecutionSandbox>()

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

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
    sandbox = { ...sandbox, status: 'ready', updatedAt: Date.now() }
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
        if (existsSync(sandbox.sandboxWorkspace.path)) rmSync(sandbox.sandboxWorkspace.path, { recursive: true, force: true })
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

