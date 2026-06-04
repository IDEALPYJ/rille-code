import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentContextSnapshot, AgentEvent, AgentSession, AgentTurn } from '../../src/shared/agent/protocol'
import { createInitialPlanItems, createInitialTaskContract } from '../../src/main/agent/taskContract'

const callAgentModelMock = vi.hoisted(() => vi.fn())
let root = ''

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
  callAgentModel: async (...args: unknown[]) => {
    const result = await callAgentModelMock(...args)
    if (typeof result === 'string') return { text: result, usage: undefined }
    return result
  },
  callAgentModelWithConfig: async (...args: unknown[]) => {
    const textResult = await callAgentModelMock(...args)
    if (typeof textResult === 'string') return { text: textResult, usage: undefined }
    return textResult
  },
  callAgentModelWithTools: async (...args: unknown[]) => {
    const textResult = await callAgentModelMock(...args)
    if (typeof textResult === 'string') return { text: textResult, usage: undefined }
    return textResult
  },
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
    id: 'session_runtime',
    workspace: null,
    title: 'runtime test',
    createdAt: 1,
    updatedAt: 1,
    status: 'running',
    permissionMode: 'default',
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

function cleanContext(): AgentContextSnapshot {
  return { ...context(), diagnostics: [] }
}

function diagnosticsOnlyContract(runtimeSession: AgentSession, runtimeTurn: AgentTurn, runtimeContext: AgentContextSnapshot) {
  const contract = createInitialTaskContract({ session: runtimeSession, turn: runtimeTurn, text: runtimeTurn.text, context: runtimeContext, timestamp: 1 })
  return {
    ...contract,
    acceptanceCriteria: contract.acceptanceCriteria.map(item => ({ ...item, evidenceRequired: ['diagnostics' as const] })),
  }
}

describe('AgentLoop context integration', () => {
  beforeEach(() => {
    callAgentModelMock.mockReset()
  })

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true }).catch(() => {})
    root = ''
  })

  it('emits redacted context.built before calling the model', async () => {
    callAgentModelMock.mockResolvedValueOnce('{"answer":"完成"}')
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const runtimeSession = session()
    const runtimeTurn = turn()
    root = mkdtempSync(join(tmpdir(), 'rille-runtime-gate-'))
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/main.ts'), 'const value: string = 1', 'utf8')
    const runtimeContext: AgentContextSnapshot = {
      ...context(),
      workspace: { kind: 'local', path: root, label: 'tmp' },
      activeFile: { path: join(root, 'src/main.ts'), name: 'main.ts', isDirty: false, content: 'const value: string = 1' },
      openFiles: [{ path: join(root, 'src/main.ts'), name: 'main.ts', isDirty: false }],
      diagnostics: [{ id: 'diag_secret', filePath: join(root, 'src/main.ts'), line: 1, column: 7, severity: 'warning', message: 'SECRET_DIAG_DO_NOT_PERSIST' }],
    }
    const contract = diagnosticsOnlyContract(runtimeSession, runtimeTurn, runtimeContext)
    const planItems = createInitialPlanItems(contract, 1)
    const events: AgentEvent[] = []

    const reason = await new AgentLoop({
      session: { ...runtimeSession, workspace: runtimeContext.workspace },
      turn: runtimeTurn,
      text: runtimeTurn.text,
      context: runtimeContext,
      taskContract: contract,
      planItems,
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'allow_once' }),
    }).run()

    expect(['completed', 'tool_failed']).toContain(reason)
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
  }, 30_000)

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
    const runtimeContext: AgentContextSnapshot = {
      ...context(),
      diagnostics: [{ id: 'diag_secret', filePath: '/repo/src/main.ts', line: 1, column: 7, severity: 'warning', message: 'SECRET_DIAG_DO_NOT_PERSIST' }],
    }
    const contract = diagnosticsOnlyContract(runtimeSession, runtimeTurn, runtimeContext)
    const planItems = createInitialPlanItems(contract, 1)
    const events: AgentEvent[] = []

    const reason = await new AgentLoop({
      session: { ...runtimeSession, workspace: runtimeContext.workspace },
      turn: runtimeTurn,
      text: runtimeTurn.text,
      context: runtimeContext,
      taskContract: contract,
      taskContractPart: { id: 'part_contract', messageId: 'msg_contract' },
      planItems,
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'allow_once' }),
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

  it('emits policy and tool observations for denied tools', async () => {
    callAgentModelMock
      .mockResolvedValueOnce(JSON.stringify({
        tool_calls: [{
          id: 'tool_apply',
          name: 'apply_file_edit',
          input: { proposalId: 'proposal_1' },
        }],
      }))
      .mockResolvedValueOnce('{"answer":"blocked"}')
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const events: AgentEvent[] = []

    const reason = await new AgentLoop({
      session: session(),
      turn: turn(),
      text: 'apply edit',
      context: cleanContext(),
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'deny', reason: 'not needed' }),
    }).run()

    expect(reason).toBe('completed')
    const observations = events.filter(event => event.type === 'observation.created')
    expect(observations.some(event => event.type === 'observation.created' && event.observation.source === 'policy' && event.observation.status === 'denied')).toBe(true)
    expect(observations.some(event => event.type === 'observation.created' && event.observation.source === 'tool' && event.observation.status === 'denied')).toBe(true)
  })

  it('leaves edit proposals pending in default mode', async () => {
    callAgentModelMock
      .mockResolvedValueOnce(JSON.stringify({
        tool_calls: [{
          id: 'tool_write',
          name: 'propose_file_edit',
          input: { filePath: 'src/main.ts', modifiedContent: 'changed' },
        }],
      }))
      .mockResolvedValueOnce('{"answer":"planned"}')
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const events: AgentEvent[] = []
    root = mkdtempSync(join(tmpdir(), 'rille-runtime-default-edit-'))
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/main.ts'), 'original', 'utf8')
    const runtimeContext: AgentContextSnapshot = {
      ...cleanContext(),
      workspace: { kind: 'local', path: root, label: 'tmp' },
      activeFile: { path: join(root, 'src/main.ts'), name: 'main.ts', isDirty: false, content: 'original' },
      openFiles: [{ path: join(root, 'src/main.ts'), name: 'main.ts', isDirty: false }],
    }

    const reason = await new AgentLoop({
      session: { ...session(), permissionMode: 'default' },
      turn: turn(),
      text: 'edit normally',
      context: runtimeContext,
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'allow_once' }),
    }).run()

    expect(reason).toBe('completed')
    expect(events.some(event => event.type === 'edit.proposed' && event.proposal.state === 'pending')).toBe(true)
    expect(events.some(event => event.type === 'edit.proposed' && event.proposal.state === 'applied')).toBe(false)
  })

  it('denies edit proposals in chat turn mode', async () => {
    callAgentModelMock
      .mockResolvedValueOnce(JSON.stringify({
        tool_calls: [{
          id: 'tool_write',
          name: 'propose_file_edit',
          input: { filePath: 'src/main.ts', modifiedContent: 'changed' },
        }],
      }))
      .mockResolvedValueOnce('{"answer":"只读回答"}')
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const events: AgentEvent[] = []

    const reason = await new AgentLoop({
      session: { ...session(), permissionMode: 'full_access' },
      turn: turn(),
      text: '只聊天，不编辑',
      context: cleanContext(),
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'allow_once' }),
      turnMode: 'chat',
    }).run()

    expect(reason).toBe('completed')
    expect(events.some(event => event.type === 'edit.proposed')).toBe(false)
    expect(events.some(event => event.type === 'observation.created' && event.observation.status === 'denied' && event.observation.summary.includes('聊天模式'))).toBe(true)
  })

  it('denies run_command in chat turn mode even for read-only commands', async () => {
    callAgentModelMock
      .mockResolvedValueOnce(JSON.stringify({
        tool_calls: [{
          id: 'tool_command',
          name: 'run_command',
          input: { commandLine: 'pwd' },
        }],
      }))
      .mockResolvedValueOnce('{"answer":"不能运行命令"}')
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const events: AgentEvent[] = []

    const reason = await new AgentLoop({
      session: session(),
      turn: turn(),
      text: 'pwd 是什么',
      context: cleanContext(),
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'allow_once' }),
      turnMode: 'chat',
    }).run()

    expect(reason).toBe('completed')
    expect(events.some(event => event.type === 'tool.completed' && event.result.status === 'denied')).toBe(true)
    expect(events.some(event => event.type === 'observation.created' && event.observation.status === 'denied')).toBe(true)
  })

  it('denies edit proposals in plan turn mode', async () => {
    callAgentModelMock
      .mockResolvedValueOnce(JSON.stringify({
        tool_calls: [{
          id: 'tool_write',
          name: 'propose_file_edit',
          input: { filePath: 'src/main.ts', modifiedContent: 'changed' },
        }],
      }))
      .mockResolvedValueOnce('{"answer":"已改为只读计划"}')
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const events: AgentEvent[] = []

    const reason = await new AgentLoop({
      session: { ...session(), permissionMode: 'full_access' },
      turn: turn(),
      text: '制定实现计划',
      context: cleanContext(),
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'allow_once' }),
      turnMode: 'plan',
    }).run()

    expect(reason).toBe('completed')
    expect(events.some(event => event.type === 'edit.proposed')).toBe(false)
    expect(events.some(event => event.type === 'observation.created' && event.observation.status === 'denied' && event.observation.summary.includes('计划模式'))).toBe(true)
  })

  it('denies run_command in plan turn mode', async () => {
    callAgentModelMock
      .mockResolvedValueOnce(JSON.stringify({
        tool_calls: [{
          id: 'tool_command',
          name: 'run_command',
          input: { commandLine: 'pwd' },
        }],
      }))
      .mockResolvedValueOnce('{"answer":"计划模式不能运行命令"}')
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const events: AgentEvent[] = []

    const reason = await new AgentLoop({
      session: session(),
      turn: turn(),
      text: '先看项目再计划',
      context: cleanContext(),
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'allow_once' }),
      turnMode: 'plan',
    }).run()

    expect(reason).toBe('completed')
    expect(events.some(event => event.type === 'tool.completed' && event.result.status === 'denied')).toBe(true)
    expect(events.some(event => event.type === 'observation.created' && event.observation.summary.includes('计划模式'))).toBe(true)
  })

  it('emits plan question and draft parts in plan turn mode', async () => {
    callAgentModelMock.mockResolvedValueOnce(JSON.stringify({
      plan_question: {
        question: '先做哪条路径？',
        options: [
          { label: '推荐方案', description: '先补协议和运行时。' },
          { label: '备选方案', description: '先做 UI。' },
          { label: '保守方案', description: '先补测试。' },
        ],
      },
    }))
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const questionEvents: AgentEvent[] = []

    await new AgentLoop({
      session: session(),
      turn: turn(),
      text: '制定计划',
      context: cleanContext(),
      signal: new AbortController().signal,
      emit: event => questionEvents.push(event),
      requestApproval: async () => ({ action: 'allow_once' }),
      turnMode: 'plan',
    }).run()

    const questionPart = questionEvents.find(event => event.type === 'message.part.created' && event.part.type === 'plan_question')
    expect(questionPart?.type).toBe('message.part.created')
    if (questionPart?.type !== 'message.part.created' || questionPart.part.type !== 'plan_question') return
    expect(questionPart.part.question.options).toHaveLength(3)
    expect(questionPart.part.question.recommendedOptionId).toBe(questionPart.part.question.options[0].id)

    callAgentModelMock.mockReset()
    callAgentModelMock.mockResolvedValueOnce(JSON.stringify({
      plan_draft: {
        markdown: '# 实施计划\n\n1. 更新协议。\n2. 更新 UI。',
      },
    }))
    const draftEvents: AgentEvent[] = []
    await new AgentLoop({
      session: session(),
      turn: turn(),
      text: '输出计划',
      context: cleanContext(),
      signal: new AbortController().signal,
      emit: event => draftEvents.push(event),
      requestApproval: async () => ({ action: 'allow_once' }),
      turnMode: 'plan',
    }).run()

    const draftPart = draftEvents.find(event => event.type === 'message.part.created' && event.part.type === 'plan_draft')
    expect(draftPart?.type).toBe('message.part.created')
    if (draftPart?.type !== 'message.part.created' || draftPart.part.type !== 'plan_draft') return
    expect(draftPart.part.draft.markdown).toContain('实施计划')
    expect(draftPart.part.draft.status).toBe('pending')
  })

  it('auto-applies edit proposals in auto review mode', async () => {
    callAgentModelMock
      .mockResolvedValueOnce(JSON.stringify({
        tool_calls: [{
          id: 'tool_write',
          name: 'propose_file_edit',
          input: { filePath: 'src/main.ts', modifiedContent: 'changed' },
        }],
      }))
      .mockResolvedValueOnce('{"answer":"done"}')
      .mockResolvedValue('{"answer":"done"}')
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const events: AgentEvent[] = []
    root = mkdtempSync(join(tmpdir(), 'rille-runtime-auto-edit-'))
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/main.ts'), 'original', 'utf8')
    const runtimeContext: AgentContextSnapshot = {
      ...cleanContext(),
      workspace: { kind: 'local', path: root, label: 'tmp' },
      activeFile: { path: join(root, 'src/main.ts'), name: 'main.ts', isDirty: false, content: 'original' },
      openFiles: [{ path: join(root, 'src/main.ts'), name: 'main.ts', isDirty: false }],
    }

    const reason = await new AgentLoop({
      session: { ...session(), permissionMode: 'auto_review', workspace: runtimeContext.workspace },
      turn: turn(),
      text: 'edit automatically',
      context: runtimeContext,
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'allow_once' }),
    }).run()

    expect(['completed', 'tool_failed']).toContain(reason)
    expect(events.some(event => event.type === 'edit.proposed' && event.proposal.state === 'applied')).toBe(true)
    expect(events.some(event => event.type === 'verification.completed')).toBe(true)
  })

  it('turns always_allow approvals into session grants', async () => {
    callAgentModelMock
      .mockResolvedValueOnce(JSON.stringify({
        tool_calls: [{
          id: 'tool_command_1',
          name: 'run_command',
          input: { commandLine: 'node --version && node --version' },
        }],
      }))
      .mockResolvedValueOnce(JSON.stringify({
        tool_calls: [{
          id: 'tool_command_2',
          name: 'run_command',
          input: { commandLine: 'node --version && node --version' },
        }],
      }))
      .mockResolvedValueOnce('{"answer":"done"}')
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const requestApproval = vi.fn(async () => ({ action: 'always_allow' as const, pattern: 'ignored-ui-pattern' }))
    root = mkdtempSync(join(tmpdir(), 'rille-runtime-grant-'))
    const runtimeSession: AgentSession = { ...session(), workspace: { kind: 'local', path: root, label: 'tmp' } }
    const runtimeContext: AgentContextSnapshot = { ...cleanContext(), workspace: runtimeSession.workspace }

    const reason = await new AgentLoop({
      session: runtimeSession,
      turn: turn(),
      text: 'run commands',
      context: runtimeContext,
      signal: new AbortController().signal,
      emit: vi.fn(),
      requestApproval,
    }).run()

    expect(reason).toBe('completed')
    expect(requestApproval).toHaveBeenCalledTimes(1)
  })

  it('blocks final answer when changed code has failed verification evidence', async () => {
    callAgentModelMock
      .mockResolvedValueOnce(JSON.stringify({
        tool_calls: [{
          id: 'tool_edit',
          name: 'propose_file_edit',
          input: { filePath: 'src/main.ts', modifiedContent: 'const value = 1' },
        }],
      }))
      .mockResolvedValueOnce('{"answer":"完成"}')
      .mockResolvedValueOnce('{"answer":"仍然阻塞"}')
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const runtimeSession = { ...session(), permissionMode: 'auto_review' as const }
    const runtimeTurn = turn()
    root = mkdtempSync(join(tmpdir(), 'rille-runtime-edit-'))
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, '.rille'))
    writeFileSync(join(root, 'src/main.ts'), 'const value: string = 1', 'utf8')
    writeFileSync(join(root, '.rille/policy.json'), JSON.stringify({ agent: { verification: { commands: ['node -e "process.exit(1)"'] } } }), 'utf8')
    const runtimeContext: AgentContextSnapshot = {
      ...context(),
      workspace: { kind: 'local', path: root, label: 'tmp' },
      activeFile: { path: join(root, 'src/main.ts'), name: 'main.ts', isDirty: false, content: 'const value: string = 1' },
      openFiles: [{ path: join(root, 'src/main.ts'), name: 'main.ts', isDirty: false }],
    }
    const contract = createInitialTaskContract({ session: runtimeSession, turn: runtimeTurn, text: '修复当前类型错误', context: runtimeContext, timestamp: 1 })
    const events: AgentEvent[] = []

    const reason = await new AgentLoop({
      session: { ...runtimeSession, workspace: runtimeContext.workspace },
      turn: runtimeTurn,
      text: runtimeTurn.text,
      context: runtimeContext,
      taskContract: contract,
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'allow_once' }),
    }).run()

    expect(reason).toBe('tool_failed')
    expect(events.some(event => event.type === 'verification.coverage.updated' && event.gate.nextAction === 'repair')).toBe(true)
    expect(events.some(event => event.type === 'review.completed' && event.result.status === 'request_changes')).toBe(true)
    expect(events.some(event => event.type === 'observation.created' && event.observation.source === 'verification')).toBe(true)
  })

  it('emits progress.updated and handoff.created on successful completion', async () => {
    callAgentModelMock.mockResolvedValueOnce('{"answer":"完成"}')
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const runtimeSession = session()
    const runtimeTurn = turn()
    const runtimeContext = cleanContext()
    const contract = diagnosticsOnlyContract(runtimeSession, runtimeTurn, runtimeContext)
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
      requestApproval: async () => ({ action: 'allow_once' }),
    }).run()

    expect(reason).toBe('completed')

    const progressEvent = events.find(e => e.type === 'progress.updated')
    expect(progressEvent).toBeDefined()
    if (progressEvent?.type !== 'progress.updated') return
    expect(progressEvent.progress.taskContractId).toBe(contract.id)
    expect(progressEvent.progress.featureList.length).toBeGreaterThan(0)

    const handoffEvent = events.find(e => e.type === 'handoff.created')
    expect(handoffEvent).toBeDefined()
    if (handoffEvent?.type !== 'handoff.created') return
    expect(handoffEvent.handoff.taskContractId).toBe(contract.id)
    expect(handoffEvent.handoff.nextSteps.length).toBeGreaterThan(0)
  })

  it('marks plan items as implemented_unverified when no verification coverage exists', async () => {
    callAgentModelMock.mockImplementation(() => Promise.resolve('{"answer":"完成"}'))
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const runtimeSession = session()
    const runtimeTurn = turn()
    const runtimeContext = cleanContext()
    // Contract requires command evidence which won't be produced → no coverage
    const contract = {
      ...diagnosticsOnlyContract(runtimeSession, runtimeTurn, runtimeContext),
      acceptanceCriteria: [{ id: 'ac_cmd', text: '验证命令通过', evidenceRequired: ['command' as const], status: 'unverified' as const }],
    }
    const planItems = createInitialPlanItems(contract, 1).map(p =>
      p.id === 'plan_explore' ? { ...p, status: 'completed' as const } : p
    )
    const events: AgentEvent[] = []

    await new AgentLoop({
      session: runtimeSession,
      turn: runtimeTurn,
      text: runtimeTurn.text,
      context: runtimeContext,
      taskContract: contract,
      planItems,
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'allow_once' }),
    }).run()

    const progressEvent = events.find(e => e.type === 'progress.updated')
    expect(progressEvent).toBeDefined()
    if (progressEvent?.type !== 'progress.updated') return

    const completedItem = progressEvent.progress.featureList.find(f => f.id === 'plan_explore')
    expect(completedItem).toBeDefined()
    // Completed plan item with no coverage evidence → implemented_unverified, NOT verified
    expect(completedItem?.status).toBe('implemented_unverified')
  })

  it('handoff includes changed files when proposals were created', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'rille-runtime-handoff-'))
    mkdirSync(join(rootDir, 'src'), { recursive: true })
    writeFileSync(join(rootDir, 'src/main.ts'), 'const value: string = 1', 'utf8')
    const mainPath = join(rootDir, 'src/main.ts')

    callAgentModelMock.mockImplementation(() => {
      const callCount = callAgentModelMock.mock.calls.length
      if (callCount === 1) {
        return Promise.resolve(JSON.stringify({
          tool_calls: [{ id: 'call_propose', name: 'propose_file_edit', input: { filePath: mainPath, modifiedContent: '// fixed' } }],
        }))
      }
      return Promise.resolve('{"answer":"完成"}')
    })
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const runtimeSession = session()
    const runtimeTurn = turn()
    const runtimeContext: AgentContextSnapshot = {
      ...context(),
      workspace: { kind: 'local', path: rootDir, label: 'tmp' },
      activeFile: { path: mainPath, name: 'main.ts', isDirty: false, content: 'const value: string = 1' },
      openFiles: [{ path: mainPath, name: 'main.ts', isDirty: false }],
      diagnostics: [],
    }
    const contract = diagnosticsOnlyContract(runtimeSession, runtimeTurn, runtimeContext)
    const planItems = createInitialPlanItems(contract, 1)
    const events: AgentEvent[] = []

    await new AgentLoop({
      session: runtimeSession,
      turn: runtimeTurn,
      text: runtimeTurn.text,
      context: runtimeContext,
      taskContract: contract,
      planItems,
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'allow_once' }),
    }).run()

    await rm(rootDir, { recursive: true, force: true }).catch(() => {})

    const handoffEvent = events.find(e => e.type === 'handoff.created')
    expect(handoffEvent).toBeDefined()
    if (handoffEvent?.type !== 'handoff.created') return
    expect(handoffEvent.handoff.changedFiles).toContain(mainPath)
  })

  it('handoff is emitted even on max_turns stop reason', async () => {
    callAgentModelMock.mockResolvedValue(JSON.stringify({
      tool_calls: [{ id: 'call_active', name: 'get_active_editor', input: {} }],
    }))
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const runtimeSession = session()
    const runtimeTurn = turn()
    const runtimeContext = context()
    const contract = diagnosticsOnlyContract(runtimeSession, runtimeTurn, runtimeContext)
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
      requestApproval: async () => ({ action: 'allow_once' }),
    }).run()

    expect(reason).toBe('max_turns')
    const handoffEvent = events.find(e => e.type === 'handoff.created')
    expect(handoffEvent).toBeDefined()
    if (handoffEvent?.type !== 'handoff.created') return
    expect(handoffEvent.handoff.failedAttempts.length).toBeGreaterThanOrEqual(0)
  })

  it('wraps plain markdown answers as plan drafts in plan mode', async () => {
    callAgentModelMock.mockResolvedValueOnce('# 修复计划\n\n## Summary\n只读分析后再实现。')
    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const runtimeSession = session()
    const runtimeTurn = turn()
    const runtimeContext = cleanContext()
    const contract = diagnosticsOnlyContract(runtimeSession, runtimeTurn, runtimeContext)
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
      requestApproval: async () => ({ action: 'allow_once' }),
      turnMode: 'plan',
    }).run()

    expect(reason).toBe('completed')
    const createdParts = events
      .filter((event): event is Extract<AgentEvent, { type: 'message.part.created' }> => event.type === 'message.part.created')
      .map(event => event.part)
    expect(createdParts.some(part => part.type === 'plan_draft' && part.draft.markdown.includes('修复计划'))).toBe(true)
    expect(createdParts.some(part => part.type === 'text' && part.role === 'assistant' && part.text.includes('修复计划'))).toBe(false)
  })
})

describe('AgentLoop evaluator integration', () => {
  it('completes normally when evaluator config is disabled (default)', async () => {
    const events: AgentEvent[] = []
    const runtimeSession = session()
    const runtimeTurn = turn()
    const runtimeContext = cleanContext()
    const contract = diagnosticsOnlyContract(runtimeSession, runtimeTurn, runtimeContext)
    const planItems = createInitialPlanItems(contract, 1)

    callAgentModelMock
      .mockResolvedValueOnce(JSON.stringify({ answer: '已完成，无代码修改。' }))

    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const reason = await new AgentLoop({
      session: runtimeSession,
      turn: runtimeTurn,
      text: runtimeTurn.text,
      context: runtimeContext,
      taskContract: contract,
      planItems,
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'allow_once' }),
    }).run()

    expect(reason).toBe('completed')
    const reviewEvent = events.find(e => e.type === 'review.completed')
    expect(reviewEvent).toBeDefined()
  })

  it('review completes normally with workspace but no evaluator config', async () => {
    root = mkdtempSync(join(tmpdir(), 'rille-eval-'))
    const wsDir = join(root, 'eval_ws')
    mkdirSync(wsDir, { recursive: true })

    const events: AgentEvent[] = []
    const runtimeSession = session()
    runtimeSession.workspace = { kind: 'local', path: wsDir, label: 'eval_ws' }
    const runtimeTurn = turn()
    const runtimeContext = cleanContext()
    runtimeContext.workspace = runtimeSession.workspace
    const contract = diagnosticsOnlyContract(runtimeSession, runtimeTurn, runtimeContext)
    const planItems = createInitialPlanItems(contract, 1)

    callAgentModelMock
      .mockResolvedValueOnce(JSON.stringify({ answer: '修复完成。' }))

    const { AgentLoop } = await import('../../src/main/agent/runtime')
    const reason = await new AgentLoop({
      session: runtimeSession,
      turn: runtimeTurn,
      text: runtimeTurn.text,
      context: runtimeContext,
      taskContract: contract,
      planItems,
      signal: new AbortController().signal,
      emit: event => events.push(event),
      requestApproval: async () => ({ action: 'allow_once' }),
    }).run()

    expect(reason).toBe('completed')
    const reviewEvent = events.find(e => e.type === 'review.completed')
    expect(reviewEvent).toBeDefined()
    if (reviewEvent?.type !== 'review.completed') return
    expect(reviewEvent.result.status).toBe('approved')
  })
})
