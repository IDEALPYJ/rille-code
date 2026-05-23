import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentContextSnapshot, AgentEvent, AgentSession, AgentTurn } from '../../src/shared/agent/protocol'
import { createInitialPlanItems, createInitialTaskContract } from '../../src/main/agent/taskContract'

const callAgentModelMock = vi.hoisted(() => vi.fn())

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
  callAgentModel: callAgentModelMock,
}))

function session(): AgentSession {
  return {
    id: 'session_runtime',
    workspace: null,
    title: 'runtime test',
    createdAt: 1,
    updatedAt: 1,
    status: 'running',
    permissionMode: 'ask',
  }
}

function turn(): AgentTurn {
  return {
    id: 'turn_runtime',
    sessionId: 'session_runtime',
    text: '修复当前类型错误',
    createdAt: 1,
    status: 'running',
  }
}

function context(): AgentContextSnapshot {
  return {
    workspace: null,
    activeFile: {
      path: '/repo/src/main.ts',
      name: 'main.ts',
      isDirty: false,
      content: 'const value: string = 1',
    },
    openFiles: [{ path: '/repo/src/main.ts', name: 'main.ts', isDirty: false }],
    diagnostics: [
      { id: 'diag_secret', filePath: '/repo/src/main.ts', line: 1, column: 7, severity: 'error', message: 'SECRET_DIAG_DO_NOT_PERSIST' },
    ],
    cursor: { line: 1, column: 7 },
  }
}

describe('AgentLoop context integration', () => {
  beforeEach(() => {
    callAgentModelMock.mockReset()
  })

  it('emits redacted context.built before calling the model', async () => {
    callAgentModelMock.mockResolvedValueOnce('{"answer":"完成"}')
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const runtimeSession = session()
    const runtimeTurn = turn()
    const runtimeContext = context()
    const contract = createInitialTaskContract({ session: runtimeSession, turn: runtimeTurn, text: runtimeTurn.text, context: runtimeContext, timestamp: 1 })
    const planItems = createInitialPlanItems(contract, 1)
    const events: AgentEvent[] = []

    const reason = await new AgentLoop({
      session: runtimeSession,
      turn: runtimeTurn,
      text: runtimeTurn.text,
      context: runtimeContext,
      taskContract: contract,
      planItems,
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'deny', reason: 'not needed' }),
    }).run()

    expect(reason).toBe('completed')
    expect(callAgentModelMock).toHaveBeenCalledTimes(1)

    const contextEventIndex = events.findIndex(event => event.type === 'context.built')
    const modelStageIndex = events.findIndex(event => event.type === 'turn.stage' && event.stage === 'calling_model')
    expect(contextEventIndex).toBeGreaterThanOrEqual(0)
    expect(modelStageIndex).toBeGreaterThan(contextEventIndex)

    const contextEvent = events[contextEventIndex]
    expect(contextEvent.type).toBe('context.built')
    if (contextEvent.type !== 'context.built') return
    expect(contextEvent.summary).toMatchObject({
      phase: 'planning',
      fragmentCount: contextEvent.trace.included.length + contextEvent.trace.excluded.length,
      includedCount: contextEvent.trace.included.length,
      excludedCount: contextEvent.trace.excluded.length,
      totalTokenEstimate: contextEvent.trace.totalTokenEstimate,
      budgetTokens: contextEvent.trace.budgetTokens,
    })
    expect(contextEvent.trace.included.length).toBeGreaterThan(0)
    const serializedContextEvent = JSON.stringify(contextEvent)
    expect(serializedContextEvent).not.toContain('prompt')
    expect(serializedContextEvent).not.toContain('Task Contract:')
    expect(serializedContextEvent).not.toContain('SECRET_DIAG_DO_NOT_PERSIST')

    const modelMessages = callAgentModelMock.mock.calls[0][0]
    expect(JSON.stringify(modelMessages)).toContain('Task Contract:')
    expect(JSON.stringify(modelMessages)).toContain('SECRET_DIAG_DO_NOT_PERSIST')
  })

  it('lets the model update the task contract and refreshes the same message part', async () => {
    callAgentModelMock
      .mockResolvedValueOnce(JSON.stringify({
        tool_calls: [{
          id: 'tool_contract',
          name: 'update_task_contract',
          input: {
            reason: '收窄目标',
            contract: { goal: '只修复当前类型错误' },
          },
        }],
      }))
      .mockResolvedValueOnce('{"answer":"完成"}')
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const runtimeSession = session()
    const runtimeTurn = turn()
    const runtimeContext = context()
    const contract = createInitialTaskContract({ session: runtimeSession, turn: runtimeTurn, text: runtimeTurn.text, context: runtimeContext, timestamp: 1 })
    const planItems = createInitialPlanItems(contract, 1)
    const events: AgentEvent[] = []

    const reason = await new AgentLoop({
      session: runtimeSession,
      turn: runtimeTurn,
      text: runtimeTurn.text,
      context: runtimeContext,
      taskContract: contract,
      taskContractPart: { id: 'part_contract', messageId: 'msg_contract' },
      planItems,
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'deny', reason: 'not needed' }),
    }).run()

    expect(reason).toBe('completed')
    const updatedEvent = events.find(event => event.type === 'task_contract.updated')
    expect(updatedEvent?.type).toBe('task_contract.updated')
    if (updatedEvent?.type !== 'task_contract.updated') return
    expect(updatedEvent.contract.goal).toBe('只修复当前类型错误')
    expect(updatedEvent.reason).toBe('收窄目标')

    const partUpdate = events.find(event =>
      event.type === 'message.part.updated'
      && event.part.type === 'task_contract'
      && event.part.id === 'part_contract',
    )
    expect(partUpdate?.type).toBe('message.part.updated')
    if (partUpdate?.type !== 'message.part.updated' || partUpdate.part.type !== 'task_contract') return
    expect(partUpdate.part.messageId).toBe('msg_contract')
    expect(partUpdate.part.contract.goal).toBe('只修复当前类型错误')
  })
})
