import { randomUUID } from 'crypto'
import { redactSecrets } from './redact'
import type {
  AgentUsage,
  ArtifactRef,
  CheckpointRef,
  CompactionResult,
  ContextTrace,
  Handoff,
  PolicyDecision,
  ModelCacheMetrics,
  McpServerState,
  McpToolDescriptor,
  PluginActivation,
  ProviderFallbackTrace,
  ReviewResult,
  TraceEvent,
  AgentHookInvocation,
  SkillActivation,
  VerificationResult,
} from '../../shared/agent/protocol'
import { readSessionEvents } from './sessionStore'

function now(): number {
  return Date.now()
}

// === TraceCollector ===

export class TraceCollector {
  private events: TraceEvent[] = []

  emit(event: TraceEvent): void {
    this.events.push(event)
  }

  taskCreated(sessionId: string, turnId: string, contractId: string, summary: string): void {
    this.emit({ type: 'task.created', sessionId, turnId, contractId, summary, createdAt: now() })
  }

  contextBuilt(sessionId: string, turnId: string, trace: ContextTrace): void {
    this.emit({ type: 'context.built', sessionId, turnId, trace, createdAt: now() })
  }

  modelCalled(sessionId: string, turnId: string, usage?: AgentUsage): void {
    this.emit({ type: 'model.called', sessionId, turnId, usage, createdAt: now() })
  }

  toolExecuted(sessionId: string, turnId: string, callId: string, name: string, status: string, durationMs?: number): void {
    this.emit({ type: 'tool.executed', sessionId, turnId, callId, name, status, durationMs, createdAt: now() })
  }

  policyDecided(sessionId: string, turnId: string, decision: PolicyDecision): void {
    this.emit({ type: 'policy.decided', sessionId, turnId, decision, createdAt: now() })
  }

  verificationRan(sessionId: string, turnId: string, result: VerificationResult): void {
    this.emit({ type: 'verification.ran', sessionId, turnId, result, createdAt: now() })
  }

  reviewCompleted(sessionId: string, turnId: string, result: ReviewResult): void {
    this.emit({ type: 'review.completed', sessionId, turnId, result, createdAt: now() })
  }

  handoffGenerated(sessionId: string, turnId: string, handoff: Handoff): void {
    this.emit({ type: 'handoff.generated', sessionId, turnId, handoff, createdAt: now() })
  }

  costUpdated(sessionId: string, turnId: string, usage: AgentUsage): void {
    this.emit({ type: 'cost.updated', sessionId, turnId, usage, createdAt: now() })
  }

  modelFallback(sessionId: string, turnId: string, fallback: ProviderFallbackTrace): void {
    this.emit({ type: 'model.fallback', sessionId, turnId, fallback, createdAt: now() })
  }

  modelCache(sessionId: string, turnId: string, cache: ModelCacheMetrics): void {
    this.emit({ type: 'model.cache', sessionId, turnId, cache, createdAt: now() })
  }

  hookInvoked(invocation: AgentHookInvocation): void {
    this.emit({ type: 'hook.invoked', sessionId: invocation.sessionId, turnId: invocation.turnId, hook: invocation, createdAt: now() })
  }

  flush(): TraceEvent[] {
    const events = [...this.events]
    this.events = []
    return events
  }
}

// === Redaction ===

export function redactTraceEvent(event: TraceEvent): TraceEvent {
  // TraceEvent carries summary metadata by design — raw prompts, file contents,
  // and full tool outputs are not included. Redaction here strips remaining
  // fields that could carry sensitive details.
  switch (event.type) {
    case 'context.built':
      // trace already excludes prompt text, keep metadata only
      return event
    case 'model.called':
      // usage is summary data, safe to keep
      return event
    case 'policy.decided': {
      const decision = { ...event.decision, grant: undefined }
      return { ...event, decision }
    }
    case 'verification.ran': {
      const result = { ...event.result, output: redactSecrets(event.result.output) }
      return { ...event, result }
    }
    default:
      return event
  }
}

// === Trajectory Metrics ===

export interface TrajectoryMetrics {
  sessionId: string
  turnCount: number
  completionRate: number
  denialCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  totalLatencyMs: number
}

export function computeTrajectoryMetrics(events: TraceEvent[]): TrajectoryMetrics {
  const sessionId = events[0]?.sessionId ?? ''
  let completed = 0
  let turns = 0
  let denialCount = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCostUsd = 0
  let totalLatencyMs = 0

  for (const event of events) {
    if (event.type === 'task.created') turns += 1
    if (event.type === 'handoff.generated' && event.handoff.summary.includes('任务完成')) completed += 1
    if (event.type === 'policy.decided' && event.decision.action === 'deny') denialCount += 1
    if (event.type === 'cost.updated') {
      totalInputTokens += event.usage.inputTokens ?? 0
      totalOutputTokens += event.usage.outputTokens ?? 0
      totalCostUsd += event.usage.costUsd ?? 0
      totalLatencyMs += event.usage.latencyMs ?? 0
    }
  }

  return {
    sessionId,
    turnCount: turns,
    completionRate: turns > 0 ? completed / turns : 0,
    denialCount,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd,
    totalLatencyMs,
  }
}

// === Debug Export ===

export async function exportSessionTrace(sessionId: string, redacted = true): Promise<TraceEvent[]> {
  const domainEvents = await readSessionEvents(sessionId)
  const traceEvents: TraceEvent[] = []

  for (const event of domainEvents) {
    const derived = deriveTraceEvents(event)
    for (const traceEvent of derived) {
      traceEvents.push(redacted ? redactTraceEvent(traceEvent) : traceEvent)
    }
  }

  return traceEvents
}

function deriveTraceEvents(event: { type: string; [key: string]: unknown }): TraceEvent[] {
  switch (event.type) {
    case 'task_contract.created':
      return [{
        type: 'task.created',
        sessionId: event.sessionId as string,
        turnId: event.turnId as string,
        contractId: (event.contract as { id: string }).id,
        summary: (event.contract as { goal: string }).goal,
        createdAt: Date.now(),
      }]
    case 'context.built':
      return [{
        type: 'context.built',
        sessionId: event.sessionId as string,
        turnId: event.turnId as string,
        trace: event.trace as ContextTrace,
        createdAt: Date.now(),
      }]
    case 'tool.completed': {
      const result = event.result as { status?: string; error?: string; durationMs?: number }
      return [{
        type: 'tool.executed',
        sessionId: event.sessionId as string,
        turnId: event.turnId as string,
        callId: event.callId as string,
        name: (event as { call?: { name: string } }).call?.name ?? '',
        status: result.error ? 'failed' : (result.status ?? 'ok'),
        durationMs: result.durationMs,
        createdAt: Date.now(),
      }]
    }
    case 'approval.requested': {
      const request = event.request as { risk: string; reason: string }
      return [{
        type: 'policy.decided',
        sessionId: event.sessionId as string,
        turnId: event.turnId as string,
        decision: { action: 'ask' as const, risk: (request.risk as PolicyDecision['risk']) || 'medium', reason: request.reason },
        createdAt: Date.now(),
      }]
    }
    case 'verification.completed':
      return [{
        type: 'verification.ran',
        sessionId: event.sessionId as string,
        turnId: event.turnId as string,
        result: event.result as VerificationResult,
        createdAt: Date.now(),
      }]
    case 'review.completed':
      return [{
        type: 'review.completed',
        sessionId: event.sessionId as string,
        turnId: event.turnId as string,
        result: event.result as ReviewResult,
        createdAt: Date.now(),
      }]
    case 'handoff.created':
      return [{
        type: 'handoff.generated',
        sessionId: event.sessionId as string,
        turnId: event.turnId as string,
        handoff: event.handoff as Handoff,
        createdAt: Date.now(),
      }]
    case 'trace.batch':
      return (event.traceEvents as TraceEvent[]).filter(traceEvent => traceEvent.type !== 'hook.invoked')
    case 'hook.invoked':
      return [{
        type: 'hook.invoked',
        sessionId: event.sessionId as string,
        turnId: event.turnId as string,
        hook: event.hook as AgentHookInvocation,
        createdAt: Date.now(),
      }]
    case 'skill.activated':
      return [{
        type: 'skill.activated',
        sessionId: event.sessionId as string,
        turnId: event.turnId as string,
        activation: event.activation as SkillActivation,
        createdAt: Date.now(),
      }]
    case 'plugin.loaded':
      return [{
        type: 'plugin.loaded',
        sessionId: event.sessionId as string,
        activation: event.activation as PluginActivation,
        createdAt: Date.now(),
      }]
    case 'mcp.server.started':
    case 'mcp.server.completed':
    case 'mcp.server.failed':
    case 'mcp.server.stopped':
      return [{
        type: event.type as 'mcp.server.started' | 'mcp.server.completed' | 'mcp.server.failed' | 'mcp.server.stopped',
        sessionId: event.sessionId as string,
        state: event.state as McpServerState,
        createdAt: Date.now(),
      }]
    case 'mcp.tool.discovered':
      return [{
        type: 'mcp.tool.discovered',
        sessionId: event.sessionId as string,
        tool: event.tool as McpToolDescriptor,
        createdAt: Date.now(),
      }]
    case 'artifact.created':
      return [{
        type: 'artifact.created',
        sessionId: event.sessionId as string,
        turnId: event.turnId as string | undefined,
        artifact: event.artifact as ArtifactRef,
        createdAt: Date.now(),
      }]
    case 'runtime.state.captured':
      return [{
        type: 'runtime.state.captured',
        sessionId: event.sessionId as string,
        turnId: event.turnId as string | undefined,
        artifact: event.artifact as ArtifactRef,
        createdAt: Date.now(),
      }]
    case 'checkpoint.created':
      return [{
        type: 'checkpoint.created',
        sessionId: event.sessionId as string,
        turnId: event.turnId as string | undefined,
        checkpoint: event.checkpoint as CheckpointRef,
        createdAt: Date.now(),
      }]
    case 'context.compacted':
      return [{
        type: 'context.compacted',
        sessionId: event.sessionId as string,
        turnId: event.turnId as string | undefined,
        result: event.result as CompactionResult,
        createdAt: Date.now(),
      }]
    default:
      return []
  }
}
