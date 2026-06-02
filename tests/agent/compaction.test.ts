import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession, AgentTurn, ProgressState } from '../../src/shared/agent/protocol'

let userData = mkdtempSync(join(tmpdir(), 'rille-compact-userdata-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
}))

afterEach(() => {
  if (userData) rmSync(userData, { recursive: true, force: true })
  userData = mkdtempSync(join(tmpdir(), 'rille-compact-userdata-'))
})

function session(): AgentSession {
  return {
    id: 'session_compact',
    workspace: null,
    title: 'compact test',
    createdAt: 1,
    updatedAt: 1,
    status: 'idle',
    permissionMode: 'default',
  }
}

function turn(): AgentTurn {
  return {
    id: 'turn_compact',
    sessionId: 'session_compact',
    text: 'compact',
    createdAt: 1,
    status: 'completed',
  }
}

describe('compaction task', () => {
  it('creates a compact artifact without rewriting session events', async () => {
    const { appendSessionEvent, readSessionEvents, saveSessionMeta } = await import('../../src/main/agent/sessionStore')
    const { createCompactionTask, getCompactionTask, runCompactionTask } = await import('../../src/main/agent/compaction')

    saveSessionMeta(session())
    await appendSessionEvent({ type: 'turn.started', sessionId: 'session_compact', turn: turn() })
    const progress: ProgressState = {
      taskContractId: 'contract_1',
      featureList: [{
        id: 'feature_1',
        title: 'Compaction support',
        status: 'verified',
        acceptanceCriteriaIds: ['ac_1'],
        evidenceRefs: ['evidence_1'],
        riskRefs: [],
        updatedAt: 1,
      }],
      failedAttempts: [],
      unresolvedRisks: [],
      nextSteps: [],
      updatedAt: 1,
    }
    await appendSessionEvent({ type: 'progress.updated', sessionId: 'session_compact', turnId: 'turn_compact', progress })
    const before = await readSessionEvents('session_compact')
    const task = createCompactionTask('session_compact', 'turn_compact', 'manual')
    expect(getCompactionTask(task.id)?.status).toBe('running')
    const { result } = await runCompactionTask({ task })
    const after = await readSessionEvents('session_compact')

    expect(result.summaryArtifact.id).toMatch(/^artifact_/)
    expect(result.retainedFeatureList[0].title).toBe('Compaction support')
    expect(getCompactionTask(task.id)?.status).toBe('completed')
    expect(after).toHaveLength(before.length)
  }, 15_000)
})
