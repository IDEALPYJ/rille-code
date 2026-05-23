import { randomUUID } from 'crypto'
import type {
  AgentContextSnapshot,
  AgentEvent,
  AgentPlanItem,
  AgentRunStage,
  AgentSession,
  AgentToolResult,
  AgentTurn,
  ApprovalDecision,
  ApprovalRequest,
  MessagePart,
  Observation,
  PolicyDecision,
  TaskContract,
  ToolCallView,
  ToolResultView,
  TurnStopReason,
} from '../../shared/agent/protocol'
import { readAgentConfigSnapshot } from './config'
import { buildAgentContext, DEFAULT_CONTEXT_BUDGET_TOKENS } from './contextBuilder'
import { callAgentModel, type AgentChatMessage } from './provider'
import { decidePermission, deniedToolResult, DenialTracker, PermissionGrantStore, permissionForCall, permissionPattern } from './permissions'
import { executeToolCall, getRegisteredTool, type RuntimeToolCall } from './tools'
import { TextJsonToolAdapter } from './modelAdapter'

interface RuntimeOptions {
  session: AgentSession
  turn: AgentTurn
  text: string
  context: AgentContextSnapshot
  taskContract?: TaskContract
  taskContractPart?: { id: string; messageId: string }
  planItems?: AgentPlanItem[]
  planPart?: { id: string; messageId: string }
  signal: AbortSignal
  emit: (event: AgentEvent) => void
  requestApproval: (request: ApprovalRequest) => Promise<ApprovalDecision>
  grants?: PermissionGrantStore
}

function now(): number {
  return Date.now()
}

function createPartId(): string {
  return `part_${randomUUID()}`
}

function createMessageId(role: 'assistant' | 'user' | 'system'): string {
  return `msg_${role}_${randomUUID()}`
}

function toolView(call: RuntimeToolCall, state: ToolCallView['state']): ToolCallView {
  const tool = getRegisteredTool(call.name)
  return {
    id: call.id,
    name: call.name,
    title: tool?.definition.title || call.name,
    input: call.input,
    summary: tool?.summarize(call.input, { workspace: null, openFiles: [], diagnostics: [] }) || call.name,
    state,
    startedAt: now(),
  }
}

function resultPrompt(results: Array<{ call: RuntimeToolCall; result: unknown }>): string {
  return JSON.stringify({
    tool_results: results.map(item => ({
      callId: item.call.id,
      name: item.call.name,
      result: item.result,
    })),
  })
}

function hasVerificationFailure(results: Array<{ call: RuntimeToolCall; result: unknown }>): boolean {
  return results.some(item => {
    const result = item.result as Partial<AgentToolResult>
    return Boolean(result.error || result.timedOut || result.status === 'error' || result.status === 'timeout' || result.status === 'conflict')
  })
}

function observationStatus(result: ToolResultView): Observation['status'] {
  if (result.status === 'denied') return 'denied'
  if (result.status === 'conflict' || result.status === 'timeout') return 'blocked'
  if (result.error || result.status === 'error') return 'error'
  return 'ok'
}

function observationFromToolResult(sessionId: string, turnId: string, call: ToolCallView, result: ToolResultView): Observation {
  return {
    id: `observation_${randomUUID()}`,
    sessionId,
    turnId,
    source: 'tool',
    status: observationStatus(result),
    summary: `${call.title}: ${result.output.slice(0, 240)}`,
    data: {
      callId: call.id,
      toolName: call.name,
      status: result.status || 'ok',
      error: result.error,
      failureType: result.failureType,
      truncated: result.truncated,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      structured: result.structured,
    },
    createdAt: now(),
  }
}

function observationFromPolicy(
  sessionId: string,
  turnId: string,
  call: RuntimeToolCall,
  decision: PolicyDecision,
): Observation {
  return {
    id: `observation_${randomUUID()}`,
    sessionId,
    turnId,
    source: 'policy',
    status: decision.action === 'deny' ? 'denied' : decision.action === 'ask' ? 'blocked' : 'ok',
    summary: `Policy ${decision.action}: ${decision.reason}`,
    data: {
      callId: call.id,
      toolName: call.name,
      input: call.input,
      risk: decision.risk,
      matchedRule: decision.matchedRule,
      grant: decision.grant,
      alternatives: decision.alternatives,
    },
    createdAt: now(),
  }
}

export class AgentLoop {
  private readonly adapter = new TextJsonToolAdapter()
  private readonly grants: PermissionGrantStore
  private taskContract?: TaskContract
  private planItems: AgentPlanItem[]

  constructor(private readonly options: RuntimeOptions) {
    this.grants = options.grants ?? new PermissionGrantStore()
    this.taskContract = options.taskContract
    this.planItems = [...(options.planItems ?? [])]
  }

  async run(): Promise<TurnStopReason> {
    const assistantMessageId = createMessageId('assistant')
    const config = readAgentConfigSnapshot()
    if (!config.apiKeyConfigured) {
      this.emitPart({
        id: createPartId(),
        messageId: assistantMessageId,
        type: 'text',
        role: 'assistant',
        text: '请先配置 Agent 模型和 API Key，然后再提交任务。Ollama 可不填 API Key。',
        createdAt: now(),
      })
      return 'completed'
    }

    this.emitStage(assistantMessageId, 'building_context', '读取模型配置和 IDE 上下文')
    this.emitPart({
      id: createPartId(),
      messageId: assistantMessageId,
      type: 'tool',
      call: {
        id: `tool_${randomUUID()}`,
        name: 'model_config',
        title: '读取模型配置',
        input: { providerId: config.providerId, protocol: config.protocol, baseURL: config.baseURL, model: config.model },
        summary: `${config.providerId} · ${config.model}`,
        state: 'completed',
        startedAt: now(),
        completedAt: now(),
      },
      state: 'completed',
      output: { output: `${config.providerId} · ${config.model}`, structured: config as unknown as Record<string, unknown>, status: 'ok' },
      createdAt: now(),
    })

    if (this.options.context.diagnostics.length > 0) {
      this.options.emit({ type: 'diagnostics.updated', sessionId: this.options.session.id, diagnostics: this.options.context.diagnostics })
      this.emitPart({
        id: createPartId(),
        messageId: assistantMessageId,
        type: 'diagnostic',
        diagnostics: this.options.context.diagnostics.slice(0, 8),
        createdAt: now(),
      })
    }

    const contextResult = await buildAgentContext({
      phase: 'planning',
      session: this.options.session,
      turn: this.options.turn,
      contextSnapshot: this.options.context,
      taskContract: this.taskContract,
      planItems: this.planItems,
      budgetTokens: DEFAULT_CONTEXT_BUDGET_TOKENS,
    })
    this.options.emit({
      type: 'context.built',
      sessionId: this.options.session.id,
      turnId: this.options.turn.id,
      summary: {
        phase: 'planning',
        fragmentCount: contextResult.trace.included.length + contextResult.trace.excluded.length,
        includedCount: contextResult.trace.included.length,
        excludedCount: contextResult.trace.excluded.length,
        totalTokenEstimate: contextResult.trace.totalTokenEstimate,
        budgetTokens: contextResult.trace.budgetTokens,
      },
      trace: contextResult.trace,
      createdAt: now(),
    })
    const messages: AgentChatMessage[] = this.adapter.buildMessages({
      session: this.options.session,
      contextPrompt: contextResult.prompt,
      userTask: this.options.text,
      taskContract: this.taskContract,
      planItems: this.planItems,
    })
    const denialTracker = new DenialTracker()

    for (let iteration = 0; iteration < 12; iteration += 1) {
      if (this.options.signal.aborted) return 'interrupted'
      this.emitStage(assistantMessageId, 'calling_model', `第 ${iteration + 1} 轮模型调用`)
      const modelText = await callAgentModel(messages, { signal: this.options.signal })
      if (this.options.signal.aborted) return 'interrupted'
      const action = this.adapter.parseAction(modelText)

      if (action.type === 'answer') {
        this.emitPart({
          id: createPartId(),
          messageId: assistantMessageId,
          type: 'text',
          role: 'assistant',
          text: action.text,
          createdAt: now(),
        })
        this.emitStage(assistantMessageId, 'completed', '模型给出最终答复')
        return 'completed'
      }

      if (action.text) {
        this.emitPart({
          id: createPartId(),
          messageId: assistantMessageId,
          type: 'text',
          role: 'assistant',
          text: action.text,
          createdAt: now(),
        })
      }
      messages.push({ role: 'assistant', content: JSON.stringify({ tool_calls: action.toolCalls }) })

      const results: Array<{ call: RuntimeToolCall; result: unknown }> = []
      this.emitStage(assistantMessageId, 'executing_tools', `执行 ${action.toolCalls.length} 个工具调用`)
      for (const call of action.toolCalls) {
        if (this.options.signal.aborted) return 'interrupted'
        const runningCall = toolView(call, 'running')
        this.options.emit({ type: 'tool.started', sessionId: this.options.session.id, turnId: this.options.turn.id, call: runningCall })
        const toolPart: Extract<MessagePart, { type: 'tool' }> = { id: createPartId(), messageId: assistantMessageId, type: 'tool', call: runningCall, state: 'running', createdAt: now() }
        this.emitPart(toolPart)

        const permission = await decidePermission({
          call,
          mode: this.options.session.permissionMode,
          sessionId: this.options.session.id,
          turnId: this.options.turn.id,
          context: this.options.context,
          grants: this.grants,
        })
        if (permission.action === 'deny') {
          const result = deniedToolResult(call, permission.reason, permission.policyDecision.alternatives)
          results.push({ call, result })
          this.emitObservation(observationFromPolicy(this.options.session.id, this.options.turn.id, call, permission.policyDecision))
          if (denialTracker.record(permissionPattern(call))) {
            return 'permission_denied_loop'
          }
          this.completeToolPart(toolPart, runningCall, result)
          continue
        }
        if (permission.action === 'ask') {
          const waitingCall: ToolCallView = { ...runningCall, state: 'waiting_approval' }
          this.updatePart({ ...toolPart, call: waitingCall, state: 'waiting_approval' })
          this.emitStage(assistantMessageId, 'waiting_approval', permission.reason)
          this.options.emit({ type: 'approval.requested', sessionId: this.options.session.id, turnId: this.options.turn.id, request: permission.request })
          const decision = await this.options.requestApproval(permission.request)
          this.options.emit({ type: 'approval.resolved', sessionId: this.options.session.id, turnId: this.options.turn.id, requestId: permission.request.id, decision })
          if (decision.action === 'deny') {
            const result = deniedToolResult(call, decision.reason || '用户拒绝。')
            results.push({ call, result })
            this.emitObservation(observationFromPolicy(this.options.session.id, this.options.turn.id, call, {
              action: 'deny',
              risk: permission.policyDecision.risk,
              reason: decision.reason || '用户拒绝。',
              alternatives: permission.policyDecision.alternatives,
            }))
            if (denialTracker.record(permissionPattern(call))) return 'permission_denied_loop'
            this.completeToolPart(toolPart, runningCall, result)
            continue
          }
          if (decision.action === 'always_allow') {
            this.grants.add({
              permission: permissionForCall(call),
              pattern: permissionPattern(call),
              scope: 'session',
            })
          }
        }

        const result = await executeToolCall(call, {
          session: this.options.session,
          turn: this.options.turn,
          context: this.options.context,
          taskContract: this.taskContract,
          planItems: this.planItems,
          emitProposal: proposal => {
            this.options.emit({ type: 'edit.proposed', sessionId: this.options.session.id, turnId: this.options.turn.id, proposal })
            this.emitPart({
              id: createPartId(),
              messageId: assistantMessageId,
              type: 'diff',
              proposalId: proposal.id,
              title: proposal.title,
              state: proposal.state,
              createdAt: now(),
            })
          },
          updatePlan: (items, reason) => this.updatePlan(items, reason),
          updateTaskContract: (contract, reason) => this.updateTaskContract(contract, reason),
        })
        results.push({ call, result })
        this.completeToolPart(toolPart, runningCall, result)
      }
      messages.push({
        role: 'user',
        content: [
          resultPrompt(results),
          hasVerificationFailure(results)
            ? 'Some tool results failed or need validation. Continue fixing if possible; otherwise explain the blocking reason clearly.'
            : 'Tool results completed. Continue only if more verification or edits are needed.',
        ].join('\n'),
      })
    }

    this.emitStage(assistantMessageId, 'failed', '达到最大迭代次数')
    return 'max_turns'
  }

  private completeToolPart(part: Extract<MessagePart, { type: 'tool' }>, runningCall: ToolCallView, result: ToolResultView) {
    const completedCall: ToolCallView = { ...runningCall, state: result.error ? 'failed' : 'completed', completedAt: now() }
    this.options.emit({ type: 'tool.completed', sessionId: this.options.session.id, turnId: this.options.turn.id, callId: runningCall.id, result })
    this.emitObservation(observationFromToolResult(this.options.session.id, this.options.turn.id, runningCall, result))
    this.updatePart({
      ...part,
      call: completedCall,
      state: completedCall.state,
      output: result,
    })
  }

  private emitPart(part: MessagePart): void {
    this.options.emit({ type: 'message.part.created', sessionId: this.options.session.id, turnId: this.options.turn.id, part })
  }

  private emitObservation(observation: Observation): void {
    this.options.emit({ type: 'observation.created', sessionId: this.options.session.id, turnId: this.options.turn.id, observation })
  }

  private updatePart(part: MessagePart): void {
    this.options.emit({ type: 'message.part.updated', sessionId: this.options.session.id, turnId: this.options.turn.id, part })
  }

  private updatePlan(items: AgentPlanItem[], reason?: string): AgentPlanItem[] {
    this.planItems = items
    const createdAt = now()
    this.options.emit({
      type: 'plan.updated',
      sessionId: this.options.session.id,
      turnId: this.options.turn.id,
      items,
      reason,
      source: 'model',
      createdAt,
    })
    if (this.options.planPart) {
      this.updatePart({
        id: this.options.planPart.id,
        messageId: this.options.planPart.messageId,
        type: 'plan',
        items,
        reason,
        createdAt,
      })
    }
    return this.planItems
  }

  private updateTaskContract(contract: TaskContract, reason: string): TaskContract {
    this.taskContract = contract
    this.options.emit({
      type: 'task_contract.updated',
      sessionId: this.options.session.id,
      turnId: this.options.turn.id,
      contract,
      reason,
      source: 'model',
    })
    if (this.options.taskContractPart) {
      this.updatePart({
        id: this.options.taskContractPart.id,
        messageId: this.options.taskContractPart.messageId,
        type: 'task_contract',
        contract,
        createdAt: now(),
      })
    }
    return contract
  }

  private emitStage(messageId: string, stage: AgentRunStage, detail?: string): void {
    this.options.emit({ type: 'turn.stage', sessionId: this.options.session.id, turnId: this.options.turn.id, stage, detail })
    this.emitPart({
      id: createPartId(),
      messageId,
      type: 'stage',
      stage,
      detail,
      createdAt: now(),
    })
  }
}
