import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentContextSnapshot, AgentSession, AgentWorkspaceLocation, ReviewResult } from '../../src/shared/agent/protocol'
import {
  assertSubagentToolAllowed,
  createSubagentContract,
  createSubagentMerge,
  mergeSubagentReview,
  SubagentRunner,
  SubagentScheduler,
} from '../../src/main/agent/subagentRunner'

let userData = mkdtempSync(join(tmpdir(), 'rille-subagent-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
}))

afterEach(async () => {
  if (userData) await rm(userData, { recursive: true, force: true }).catch(() => {})
  userData = mkdtempSync(join(tmpdir(), 'rille-subagent-'))
  vi.clearAllMocks()
})

function session(): AgentSession {
  return {
    id: 'session_parent',
    workspace: null,
    title: 'parent',
    createdAt: 1,
    updatedAt: 1,
    status: 'running',
    permissionMode: 'default',
  }
}

function context(): AgentContextSnapshot {
  return {
    workspace: null,
    activeFile: { path: '/repo/src/app.ts', name: 'app.ts', isDirty: false, content: 'const value = 1' },
    openFiles: [{ path: '/repo/src/app.ts', name: 'app.ts', isDirty: false }],
    diagnostics: [],
  }
}

function workspace(root: string): AgentWorkspaceLocation {
  return { kind: 'local', path: root, label: 'tmp' }
}

function workspaceSession(root: string): AgentSession {
  return { ...session(), workspace: workspace(root) }
}

function workspaceContext(root: string): AgentContextSnapshot {
  return { ...context(), workspace: workspace(root), activeFile: { path: 'README.md', name: 'README.md', isDirty: false, content: 'initial\n' } }
}

function initGitRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'rille-subagent-workspace-'))
  execFileSync('git', ['init'], { cwd: root })
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root })
  writeFileSync(join(root, 'README.md'), 'initial\n', 'utf8')
  execFileSync('git', ['add', 'README.md'], { cwd: root })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: root })
  return root
}

describe('SubagentRunner', () => {
  it('normalizes contracts and enforces read-only tool boundaries', () => {
    const contract = createSubagentContract({
      parentSessionId: 'session_parent',
      parentTurnId: 'turn_parent',
      role: 'explorer',
      goal: 'explore',
      allowedTools: ['read_file', 'run_command', 'mcp.fixture.server.erase'],
    })

    expect(contract.allowedTools).toEqual(['read_file'])
    expect(() => assertSubagentToolAllowed(contract, 'read_file')).not.toThrow()
    expect(() => assertSubagentToolAllowed(contract, 'run_command')).toThrow(/cannot use/)
  })

  it('permits isolated write contracts without allowing parent apply or mcp side effects', () => {
    const contract = createSubagentContract({
      parentSessionId: 'session_parent',
      parentTurnId: 'turn_parent',
      role: 'explorer',
      goal: 'write in sandbox',
      permissionScope: 'isolated_write',
      allowedTools: ['read_file', 'run_command', 'propose_file_edit', 'apply_file_edit', 'mcp.fixture.server.erase'],
    })

    expect(contract.permissionScope).toBe('isolated_write')
    expect(contract.executionMode).toBe('local_worktree')
    expect(contract.allowedTools).toEqual(['read_file', 'run_command', 'propose_file_edit'])
    expect(() => assertSubagentToolAllowed(contract, 'run_command')).not.toThrow()
    expect(() => assertSubagentToolAllowed(contract, 'apply_file_edit')).toThrow(/cannot use/)
  })

  it('creates child session metadata and returns deterministic offline results', async () => {
    const events: string[] = []
    const run = await new SubagentRunner().run({
      parentSession: session(),
      parentTurnId: 'turn_parent',
      role: 'explorer',
      goal: 'explore repo',
      context: context(),
      emit: event => { events.push(event.type) },
    })

    expect(run.status).toBe('completed')
    expect(run.childSessionId).toContain('session_explorer_')
    expect(run.result?.summary).toContain('Explorer')
    expect(events).toContain('subagent.started')
    expect(events).toContain('subagent.completed')
  })

  it('uses visible deterministic fallback instead of hiding model failures', async () => {
    const events: string[] = []
    const run = await new SubagentRunner().run({
      parentSession: session(),
      parentTurnId: 'turn_parent',
      role: 'explorer',
      goal: 'explore repo',
      context: context(),
      readConfig: async () => ({ fallbackMode: 'visible_deterministic', executionMode: 'local_worktree', maxIterations: 6, timeoutMs: 1000, roles: {} }),
      emit: event => { events.push(event.type) },
    })

    expect(run.status).toBe('completed')
    expect(run.result?.fallbackMode).toBe('visible_deterministic')
    expect(run.result?.fallbackReason).toBeTruthy()
    expect(events).toContain('subagent.failed')
    expect(events).toContain('subagent.completed')
  })

  it('fails the run when strict fallback mode is configured', async () => {
    const run = await new SubagentRunner().run({
      parentSession: session(),
      parentTurnId: 'turn_parent',
      role: 'explorer',
      goal: 'strict model',
      context: context(),
      readConfig: async () => ({ fallbackMode: 'strict', executionMode: 'local_worktree', maxIterations: 6, timeoutMs: 1000, roles: {} }),
    })

    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/model|key|api/i)
  })

  it('creates a writable worktree and turns sandbox changes into parent proposals', async () => {
    const root = initGitRepo()
    const proposals: string[] = []
    const events: string[] = []
    const run = await new SubagentRunner().run({
      parentSession: workspaceSession(root),
      parentTurnId: 'turn_parent',
      role: 'explorer',
      goal: 'change readme',
      permissionScope: 'isolated_write',
      commands: ['node -e "require(\'fs\').writeFileSync(\'README.md\', \'sandbox change\\\\n\')"'],
      context: workspaceContext(root),
      readConfig: async () => ({ fallbackMode: 'visible_deterministic', executionMode: 'local_worktree', maxIterations: 6, timeoutMs: 30_000, roles: {} }),
      emitProposal: proposal => { proposals.push(proposal.id) },
      emit: event => { events.push(event.type) },
    })

    expect(run.status).toBe('completed')
    expect(run.contract.permissionScope).toBe('isolated_write')
    expect(run.sandboxId).toBeTruthy()
    expect(run.proposalIds).toHaveLength(1)
    expect(proposals).toEqual(run.proposalIds)
    expect(run.mergeStatus).toBe('ready')
    expect(events).toContain('subagent.sandbox.created')
    expect(events).toContain('subagent.proposals.created')
    expect((await readFile(join(root, 'README.md'), 'utf8')).replace(/\r\n/g, '\n')).toBe('initial\n')
  }, 30_000)

  it('uses role-specific model profile policy in the contract and run snapshot', async () => {
    const run = await new SubagentRunner().run({
      parentSession: session(),
      parentTurnId: 'turn_parent',
      role: 'reviewer',
      goal: 'review with profile',
      context: context(),
      readConfig: async () => ({ fallbackMode: 'visible_deterministic', executionMode: 'local_worktree', maxIterations: 6, timeoutMs: 1000, roles: { reviewer: { modelProfileId: 'review-model' } } }),
    })

    expect(run.contract.modelProfileId).toBe('review-model')
    expect(run.modelProfileId).toBe('review-model')
  })

  it('merges blocking reviewer findings into parent review', async () => {
    const run = await new SubagentRunner().run({
      parentSession: session(),
      parentTurnId: 'turn_parent',
      role: 'reviewer',
      goal: 'review risky diff',
      context: context(),
      codeChanged: true,
      evidence: [],
    })
    const base: ReviewResult = {
      id: 'review_parent',
      sessionId: 'session_parent',
      turnId: 'turn_parent',
      status: 'approved',
      findingIds: [],
      findings: [],
      summary: 'approved',
      createdAt: 1,
    }

    const merged = mergeSubagentReview({ sessionId: 'session_parent', turnId: 'turn_parent' }, base, run.result)

    expect(merged.status).toBe('blocked')
    expect(merged.findings[0].source).toBe('subagent')
  })

  it('bounds scheduler concurrency and deduplicates active runs', async () => {
    const scheduler = new SubagentScheduler(2)
    const first = scheduler.runDeduped('same', async () => ({ id: 'run_1' } as any))
    const second = scheduler.runDeduped('same', async () => ({ id: 'run_2' } as any))
    expect(await first).toEqual(await second)

    const runs = await scheduler.runAll([
      async () => ({ id: 'a' } as any),
      async () => ({ id: 'b' } as any),
      async () => ({ id: 'c' } as any),
    ])
    expect(runs.map(run => run.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('creates merge result with run and finding references', () => {
    const merge = createSubagentMerge({
      sessionId: 'session_parent',
      turnId: 'turn_parent',
      runs: [{ id: 'run_1' } as any],
      observationIds: ['obs_1'],
      findingIds: ['finding_1'],
      advisorySummary: 'advice',
    })
    expect(merge.runIds).toEqual(['run_1'])
    expect(merge.mergedFindingIds).toEqual(['finding_1'])
  })
})
