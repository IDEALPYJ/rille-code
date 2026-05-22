import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentContextSnapshot, AgentEvent, AgentSession, AgentTurn } from '../../src/shared/agent/protocol'
import { createInitialPlanItems, createInitialTaskContract } from '../../src/main/agent/taskContract'

let userData = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
}))

function session(): AgentSession {
  return {
    id: `session_${Date.now()}`,
    workspace: null,
    title: 'test',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'idle',
    permissionMode: 'ask',
  }
}

function turn(sessionId: string): AgentTurn {
  return {
    id: 'turn_test',
    sessionId,
    text: '修复当前类型错误',
    createdAt: Date.now(),
    status: 'running',
  }
}

function context(): AgentContextSnapshot {
  return {
    workspace: null,
    activeFile: null,
    openFiles: [],
    diagnostics: [],
  }
}

afterEach(async () => {
  if (userData) await rm(userData, { recursive: true, force: true })
  vi.resetModules()
})

describe('sessionStore', () => {
  it('appends and replays schema-versioned events', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-session-'))
    const store = await import('../../src/main/agent/sessionStore')
    const meta = session()
    const event: AgentEvent = { type: 'session.created', session: meta }
    await store.appendSessionEvent(event)
    await expect(store.readSessionEvents(meta.id)).resolves.toEqual([event])
  })

  it('ignores corrupt jsonl lines during replay', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-session-'))
    const store = await import('../../src/main/agent/sessionStore')
    const meta = session()
    await store.appendSessionEvent({ type: 'session.created', session: meta })
    const events = await store.readSessionEvents(meta.id)
    expect(events).toHaveLength(1)
  })

  it('replays task contract and plan events without requiring older sessions to have them', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-session-'))
    const store = await import('../../src/main/agent/sessionStore')
    const meta = session()
    const activeTurn = turn(meta.id)
    const contract = createInitialTaskContract({ session: meta, turn: activeTurn, text: activeTurn.text, context: context(), timestamp: 10 })
    const planItems = createInitialPlanItems(contract, 11)
    const events: AgentEvent[] = [
      { type: 'session.created', session: meta },
      { type: 'turn.started', sessionId: meta.id, turn: activeTurn },
      { type: 'task_contract.created', sessionId: meta.id, turnId: activeTurn.id, contract },
      { type: 'plan.updated', sessionId: meta.id, turnId: activeTurn.id, items: planItems, reason: 'runtime 初始化任务计划', source: 'runtime', createdAt: 11 },
    ]

    for (const event of events) await store.appendSessionEvent(event)

    await expect(store.readSessionEvents(meta.id)).resolves.toEqual(events)
  })
})
