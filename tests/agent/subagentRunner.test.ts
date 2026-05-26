import { describe, expect, it } from 'vitest'
import type { AgentContextSnapshot, AgentSession, ReviewResult } from '../../src/shared/agent/protocol'
import {
  assertSubagentToolAllowed,
  createSubagentContract,
  createSubagentMerge,
  mergeSubagentReview,
  SubagentRunner,
  SubagentScheduler,
} from '../../src/main/agent/subagentRunner'

function session(): AgentSession {
  return {
    id: 'session_parent',
    workspace: null,
    title: 'parent',
    createdAt: 1,
    updatedAt: 1,
    status: 'running',
    permissionMode: 'ask',
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
