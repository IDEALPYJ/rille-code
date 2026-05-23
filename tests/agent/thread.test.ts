import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSession, AgentTurn, ApprovalRequest } from '../../src/shared/agent/protocol'

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
    title: 'approval resume',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'waiting_approval',
    permissionMode: 'ask',
  }
}

function turn(sessionId: string): AgentTurn {
  return {
    id: 'turn_waiting',
    sessionId,
    text: '运行测试',
    createdAt: Date.now(),
    status: 'running',
  }
}

function sender() {
  return {
    isDestroyed: () => false,
    send: vi.fn(),
  }
}

afterEach(async () => {
  if (userData) await rm(userData, { recursive: true, force: true })
  userData = ''
  vi.resetModules()
})

describe('AgentThread resume hardening', () => {
  it('resumes waiting approval sessions as idle and expires stale approvals in replay', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-thread-'))
    const store = await import('../../src/main/agent/sessionStore')
    const { resumeAgentSession } = await import('../../src/main/agent')
    const meta = session()
    const activeTurn = turn(meta.id)
    const request: ApprovalRequest = {
      id: 'approval_stale',
      sessionId: meta.id,
      turnId: activeTurn.id,
      toolCallId: 'tool_run',
      title: '运行命令',
      reason: '需要用户审批',
      risk: 'high',
      target: 'npm test',
      createdAt: Date.now(),
    }
    const events: AgentEvent[] = [
      { type: 'session.created', session: meta },
      { type: 'turn.started', sessionId: meta.id, turn: activeTurn },
      { type: 'approval.requested', sessionId: meta.id, turnId: activeTurn.id, request },
    ]
    for (const event of events) await store.appendSessionEvent(event)

    const webContents = sender()
    const resumed = await resumeAgentSession(webContents as never, { type: 'session.resume', sessionId: meta.id })

    expect(resumed.ok).toBe(true)
    if (!resumed.ok) return
    expect(resumed.value.status).toBe('idle')
    expect(store.readSessionMeta(meta.id)?.status).toBe('idle')
    const replayed = webContents.send.mock.calls.map(call => call[1] as AgentEvent)
    expect(replayed.some(event => event.type === 'approval.requested' && event.request.id === request.id)).toBe(true)
    expect(replayed.some(event =>
      event.type === 'approval.resolved'
      && event.requestId === request.id
      && event.decision.action === 'deny',
    )).toBe(true)
    expect(replayed.some(event =>
      event.type === 'message.part.created'
      && event.part.type === 'text'
      && event.part.text.includes('旧审批请求已失效'),
    )).toBe(true)
    const finalSessionCreated = replayed.filter(event => event.type === 'session.created').at(-1)
    expect(finalSessionCreated?.type).toBe('session.created')
    if (finalSessionCreated?.type !== 'session.created') return
    expect(finalSessionCreated.session.status).toBe('idle')
  })
})
