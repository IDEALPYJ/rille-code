import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentContextSnapshot, AgentEvent, AgentSession, AgentTurn, ApprovalRequest, PlanConfirmation } from '../../src/shared/agent/protocol'

let userData = ''
const callAgentModelMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
}))

vi.mock('../../src/main/agent/config', () => ({
  readAgentConfigSnapshot: () => ({
    profileId: 'model_test',
    name: 'Test Model',
    providerId: 'openai',
    protocol: 'openai-chat',
    baseURL: 'https://example.test/v1',
    model: 'test-model',
    apiKeyConfigured: true,
    contextLengthTokens: 128_000,
    modalities: ['text'],
  }),
}))

vi.mock('../../src/main/agent/provider', () => ({
  streamAgentModelWithTools: async function* (...args: unknown[]) {
    const textResult = await callAgentModelMock(...args)
    const result = typeof textResult === 'string' ? { text: textResult, usage: undefined } : textResult
    yield {
      type: 'model.completed',
      text: result?.text,
      usage: result?.usage,
      toolCalls: result?.toolCalls,
      cacheMetrics: result?.cacheMetrics,
      fallbackTrace: result?.fallbackTrace,
      createdAt: Date.now(),
    }
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
    permissionMode: 'default',
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
  callAgentModelMock.mockReset()
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
  }, 30_000)

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
    const meta: AgentSession = { ...session(), status: 'idle', permissionMode: 'default' }
    const confirmation: PlanConfirmation = {
      id: 'plan_confirmation_test',
      sessionId: meta.id,
      turnId: 'turn_plan',
      contractId: 'contract_plan',
      planItemIds: ['plan_1'],
      status: 'pending',
      riskLevel: 'medium',
      reason: 'Plan confirmation requires user review.',
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

  it('renders compaction as message parts', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-thread-compact-'))
    const { AgentThread } = await import('../../src/main/agent/thread')
    const webContents = sender()
    const thread = new AgentThread(webContents as never, null, 'default', { ...session(), status: 'idle' })

    await thread.compactContext(undefined, 'manual slash action')

    const emitted = webContents.send.mock.calls.map(call => call[1] as AgentEvent)
    expect(emitted.some(event => event.type === 'message.part.created' && event.part.type === 'stage' && event.part.stage === 'compacting_context')).toBe(true)
    expect(emitted.some(event => event.type === 'message.part.created' && event.part.type === 'artifact' && event.part.label === '上下文压缩摘要')).toBe(true)
    expect(emitted.some(event => event.type === 'message.part.created' && event.part.type === 'text' && event.part.text.includes('上下文已压缩'))).toBe(true)
  })

  it('submits transient chat turns without appending main session events', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-thread-transient-'))
    callAgentModelMock.mockResolvedValueOnce('{"answer":"临时回答"}')
    const { AgentThread } = await import('../../src/main/agent/thread')
    const store = await import('../../src/main/agent/sessionStore')
    const meta: AgentSession = { ...session(), status: 'idle' }
    await store.appendSessionEvent({ type: 'session.created', session: meta })
    const webContents = sender()
    const thread = new AgentThread(webContents as never, null, 'default', meta)

    const turnResult = await thread.submitTurn('临时问答', { workspace: null, activeFile: null, openFiles: [], diagnostics: [] }, {
      mode: 'chat',
      transientSessionId: 'btw_temp_1',
    })

    expect(turnResult.sessionId).toBe('btw_temp_1')
    await expect(store.readSessionEvents(meta.id)).resolves.toHaveLength(1)
    const emitted = webContents.send.mock.calls.map(call => call[1] as AgentEvent)
    expect(emitted.some(event => 'sessionId' in event && event.sessionId === 'btw_temp_1')).toBe(true)
    expect(emitted.some(event =>
      event.type === 'message.part.created'
      && event.sessionId === 'btw_temp_1'
      && event.part.type === 'text'
      && event.part.role === 'assistant'
      && event.part.text.includes('临时回答'),
    )).toBe(true)
    expect(store.readSessionMeta(meta.id)?.status).toBe('idle')
  })

  it('answers plan questions and continues the same read-only planning flow', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-thread-plan-question-'))
    callAgentModelMock
      .mockResolvedValueOnce(JSON.stringify({
        plan_question: {
          question: '优先做哪部分？',
          options: [
            { label: '推荐方案', description: '先改协议和运行时。' },
            { label: '备选方案', description: '先改 UI。' },
            { label: '保守方案', description: '先补测试。' },
          ],
        },
      }))
      .mockResolvedValueOnce(JSON.stringify({
        plan_draft: {
          markdown: '# 计划\n\n按用户选择先改协议和运行时。',
        },
      }))
    const { AgentThread } = await import('../../src/main/agent/thread')
    const store = await import('../../src/main/agent/sessionStore')
    const meta: AgentSession = { ...session(), status: 'idle' }
    await store.appendSessionEvent({ type: 'session.created', session: meta })
    const webContents = sender()
    const thread = new AgentThread(webContents as never, null, 'default', meta)
    const context: AgentContextSnapshot = { workspace: null, activeFile: null, openFiles: [], diagnostics: [] }

    await thread.submitTurn('制定计划', context, { mode: 'plan' })
    const emittedAfterQuestion = webContents.send.mock.calls.map(call => call[1] as AgentEvent)
    const questionEvent = emittedAfterQuestion.find(event => event.type === 'message.part.created' && event.part.type === 'plan_question')
    expect(questionEvent?.type).toBe('message.part.created')
    if (questionEvent?.type !== 'message.part.created' || questionEvent.part.type !== 'plan_question') return

    const continued = await thread.answerPlanQuestion(questionEvent.part.question.id, '推荐方案')

    expect(continued.text).toContain('用户对问题')
    const emitted = webContents.send.mock.calls.map(call => call[1] as AgentEvent)
    expect(emitted.some(event => event.type === 'plan.question.answered' && event.question.answered === '推荐方案')).toBe(true)
    expect(emitted.some(event => event.type === 'message.part.created' && event.part.type === 'plan_draft')).toBe(true)
  }, 15_000)

  it('supersedes plan drafts on revise and submits ordinary agent turns on execute', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-thread-plan-draft-'))
    callAgentModelMock
      .mockResolvedValueOnce(JSON.stringify({
        plan_draft: {
          markdown: '# 计划 v1\n\n先做 A。',
        },
      }))
      .mockResolvedValueOnce(JSON.stringify({
        plan_draft: {
          markdown: '# 计划 v2\n\n按反馈先做 B。',
        },
      }))
      .mockResolvedValueOnce('{"answer":"开始执行"}')
    const { AgentThread } = await import('../../src/main/agent/thread')
    const store = await import('../../src/main/agent/sessionStore')
    const meta: AgentSession = { ...session(), status: 'idle' }
    await store.appendSessionEvent({ type: 'session.created', session: meta })
    const webContents = sender()
    const thread = new AgentThread(webContents as never, null, 'default', meta)
    const context: AgentContextSnapshot = { workspace: null, activeFile: null, openFiles: [], diagnostics: [] }

    await thread.submitTurn('制定计划', context, { mode: 'plan' })
    const firstDraftEvent = webContents.send.mock.calls
      .map(call => call[1] as AgentEvent)
      .find(event => event.type === 'message.part.created' && event.part.type === 'plan_draft')
    expect(firstDraftEvent?.type).toBe('message.part.created')
    if (firstDraftEvent?.type !== 'message.part.created' || firstDraftEvent.part.type !== 'plan_draft') return

    await thread.resolvePlanDraft(firstDraftEvent.part.draft.id, 'revise', '请先做 B', context)
    const afterRevise = webContents.send.mock.calls.map(call => call[1] as AgentEvent)
    expect(afterRevise.some(event => event.type === 'plan.draft.resolved' && event.draft.id === firstDraftEvent.part.draft.id && event.draft.status === 'superseded')).toBe(true)
    const pendingDrafts = afterRevise.filter(event => event.type === 'message.part.created' && event.part.type === 'plan_draft' && event.part.draft.status === 'pending')
    expect(pendingDrafts.length).toBeGreaterThanOrEqual(1)
    const latestDraft = pendingDrafts.at(-1)
    expect(latestDraft?.type).toBe('message.part.created')
    if (latestDraft?.type !== 'message.part.created' || latestDraft.part.type !== 'plan_draft') return

    const executed = await thread.resolvePlanDraft(latestDraft.part.draft.id, 'execute', undefined, context)
    expect('text' in executed ? executed.text : '').toContain('请执行以下已批准计划')
    const afterExecute = webContents.send.mock.calls.map(call => call[1] as AgentEvent)
    expect(afterExecute.some(event => event.type === 'plan.draft.resolved' && event.draft.id === latestDraft.part.draft.id && event.draft.status === 'executing')).toBe(true)
  }, 15_000)
})
