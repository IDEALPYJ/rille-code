import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSession, AgentTurn, ApprovalRequest, PlanConfirmation } from '../../src/shared/agent/protocol'

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
  if (userData) await rm(userData, { recursive: true, force: true }).catch(() => {})
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
  }, 15_000)

  it('refuses to resume archived sessions until they are unarchived', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-thread-'))
    const store = await import('../../src/main/agent/sessionStore')
    const { resumeAgentSession, dispatchAgentOp } = await import('../../src/main/agent')
    const meta: AgentSession = { ...session(), status: 'idle' }
    await store.appendSessionEvent({ type: 'session.created', session: meta })
    const archived = await dispatchAgentOp({ type: 'session.archive', sessionId: meta.id })
    expect(archived.ok).toBe(true)
    expect(store.readSessionMeta(meta.id)?.status).toBe('archived')

    const blocked = await resumeAgentSession(sender() as never, { type: 'session.resume', sessionId: meta.id })
    expect(blocked.ok).toBe(false)

    const restored = await dispatchAgentOp({ type: 'session.unarchive', sessionId: meta.id })
    expect(restored.ok).toBe(true)
    const resumed = await resumeAgentSession(sender() as never, { type: 'session.resume', sessionId: meta.id })
    expect(resumed.ok).toBe(true)
  })

  it('replays plan confirmation events and resolves them through dispatch', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-thread-'))
    const store = await import('../../src/main/agent/sessionStore')
    const { resumeAgentSession, dispatchAgentOp } = await import('../../src/main/agent')
    const meta: AgentSession = { ...session(), status: 'idle', permissionMode: 'plan' }
    const confirmation: PlanConfirmation = {
      id: 'plan_confirmation_test',
      sessionId: meta.id,
      turnId: 'turn_plan',
      contractId: 'contract_plan',
      planItemIds: ['plan_1'],
      status: 'pending',
      riskLevel: 'medium',
      reason: 'Plan Mode requires confirmation.',
      createdAt: Date.now(),
    }
    await store.appendSessionEvent({ type: 'session.created', session: meta })
    await store.appendSessionEvent({ type: 'plan.confirmation.requested', sessionId: meta.id, turnId: confirmation.turnId, confirmation })

    const webContents = sender()
    const resumed = await resumeAgentSession(webContents as never, { type: 'session.resume', sessionId: meta.id })
    expect(resumed.ok).toBe(true)
    const replayed = webContents.send.mock.calls.map(call => call[1] as AgentEvent)
    expect(replayed.some(event => event.type === 'plan.confirmation.requested' && event.confirmation.id === confirmation.id)).toBe(true)

    const resolved = await dispatchAgentOp({ type: 'plan.confirm', sessionId: meta.id, confirmationId: confirmation.id })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.value && 'status' in resolved.value ? resolved.value.status : null).toBe('confirmed')
  })
})
