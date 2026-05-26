import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentWorkspaceLocation } from '../../src/shared/agent/protocol'

let userData = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
}))

function workspace(root: string): AgentWorkspaceLocation {
  return { kind: 'local', path: root, label: 'tmp' }
}

function initGitRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'rille-runtime-workspace-'))
  execFileSync('git', ['init'], { cwd: root })
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root })
  writeFileSync(join(root, 'README.md'), 'initial\n', 'utf8')
  execFileSync('git', ['add', 'README.md'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: root })
  return root
}

afterEach(async () => {
  if (userData) await rm(userData, { recursive: true, force: true }).catch(() => {})
  userData = ''
  vi.resetModules()
})

describe('runtime substrate', () => {
  it('creates checkpoint metadata and captures runtime state artifacts', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-runtime-'))
    const root = initGitRepo()
    writeFileSync(join(root, 'README.md'), 'changed\n', 'utf8')
    const { createCheckpoint } = await import('../../src/main/agent/checkpointStore')
    const { restoreCheckpointAsProposal } = await import('../../src/main/agent/checkpointStore')
    const { captureRuntimeState } = await import('../../src/main/agent/runtimeState')

    const checkpoint = await createCheckpoint({
      sessionId: 'session_runtime',
      turnId: 'turn_runtime',
      workspace: workspace(root),
      reason: 'test checkpoint',
    })
    expect(checkpoint.files).toContain('README.md')
    expect(checkpoint.artifact.kind).toBe('checkpoint')

    const { state, artifact } = await captureRuntimeState({ sessionId: 'session_runtime', turnId: 'turn_runtime', workspace: workspace(root) })
    expect(state.checkpoints.map(item => item.id)).toContain(checkpoint.id)
    expect(artifact.kind).toBe('runtime_state')

    writeFileSync(join(root, 'README.md'), 'changed again\n', 'utf8')
    const proposal = await restoreCheckpointAsProposal(
      checkpoint.id,
      { id: 'session_runtime', title: 'runtime', workspace: workspace(root), createdAt: 1, updatedAt: 1, status: 'idle', permissionMode: 'ask' },
      { id: 'turn_runtime', sessionId: 'session_runtime', text: 'restore', createdAt: 1, status: 'completed' },
    )
    expect(proposal.originalContent).toBe('changed again\n')
    expect(proposal.modifiedContent).toBe('changed\n')
  }, 15_000)

  it('restores multi-file checkpoints as reviewable proposals without writing files', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-runtime-'))
    const root = initGitRepo()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'README.md'), 'changed readme\n', 'utf8')
    writeFileSync(join(root, 'src/file.ts'), 'snapshot file\n', 'utf8')
    const { createCheckpoint, restoreCheckpointAsProposals } = await import('../../src/main/agent/checkpointStore')

    const checkpoint = await createCheckpoint({
      sessionId: 'session_runtime',
      turnId: 'turn_runtime',
      workspace: workspace(root),
      reason: 'multi file checkpoint',
    })
    writeFileSync(join(root, 'README.md'), 'after checkpoint\n', 'utf8')
    writeFileSync(join(root, 'src/file.ts'), 'after checkpoint file\n', 'utf8')

    const proposals = await restoreCheckpointAsProposals(
      checkpoint.id,
      { id: 'session_runtime', title: 'runtime', workspace: workspace(root), createdAt: 1, updatedAt: 1, status: 'idle', permissionMode: 'ask' },
      { id: 'turn_runtime', sessionId: 'session_runtime', text: 'restore', createdAt: 1, status: 'completed' },
    )

    expect(proposals).toHaveLength(2)
    expect(proposals.every(proposal => proposal.checkpointId === checkpoint.id)).toBe(true)
    expect(proposals.every(proposal => proposal.proposalSetId)).toBe(true)
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('after checkpoint\n')
  }, 15_000)

  it('turns sandbox diffs into main-workspace proposals', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-runtime-'))
    const root = initGitRepo()
    const { createWorktreeSandbox, sandboxDiffAsProposals, disposeSandbox } = await import('../../src/main/agent/worktreeSandbox')
    const sandbox = await createWorktreeSandbox({
      sessionId: 'session_sandbox',
      workspace: workspace(root),
      reason: 'test merge proposals',
    })
    expect(sandbox.status).toBe('ready')
    writeFileSync(join(sandbox.sandboxWorkspace.path, 'README.md'), 'sandbox change\n', 'utf8')

    const proposals = await sandboxDiffAsProposals(
      { id: 'session_sandbox', title: 'sandbox', workspace: workspace(root), createdAt: 1, updatedAt: 1, status: 'idle', permissionMode: 'ask' },
      { id: 'turn_sandbox', sessionId: 'session_sandbox', text: 'merge', createdAt: 1, status: 'completed' },
      sandbox.id,
    )

    expect(proposals).toHaveLength(1)
    expect(proposals[0].sandboxId).toBe(sandbox.id)
    expect(proposals[0].originalContent.replace(/\r\n/g, '\n')).toBe('initial\n')
    expect(proposals[0].modifiedContent.replace(/\r\n/g, '\n')).toBe('sandbox change\n')
    expect((await readFile(join(root, 'README.md'), 'utf8')).replace(/\r\n/g, '\n')).toBe('initial\n')
    await disposeSandbox('session_sandbox', sandbox.id)
  }, 30_000)

  it('returns actionable sandbox failure for non-git workspaces', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-runtime-'))
    const root = mkdtempSync(join(tmpdir(), 'rille-nongit-'))
    const { createWorktreeSandbox } = await import('../../src/main/agent/worktreeSandbox')

    const sandbox = await createWorktreeSandbox({
      sessionId: 'session_sandbox',
      workspace: workspace(root),
      reason: 'test sandbox',
    })

    expect(sandbox.status).toBe('failed')
    expect(sandbox.reason).toMatch(/git|worktree|仓库/i)
  })

  it('tracks runtime process output through an artifact', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-runtime-'))
    const root = mkdtempSync(join(tmpdir(), 'rille-process-'))
    const { startRuntimeProcess, listRuntimeProcesses } = await import('../../src/main/agent/processRegistry')

    const started = startRuntimeProcess({
      sessionId: 'session_process',
      workspace: workspace(root),
      commandLine: 'node -e "console.log(123)"',
    })
    expect(started.status).toBe('running')

    await new Promise(resolve => setTimeout(resolve, 500))
    const [completed] = listRuntimeProcesses('session_process')
    expect(completed.status === 'exited' || completed.status === 'running').toBe(true)
    if (completed.status === 'exited') expect(completed.outputArtifactRef).toBeTruthy()
  })
})
