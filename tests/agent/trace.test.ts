import { describe, expect, it } from 'vitest'
import type { ContextTrace, PolicyDecision, TraceEvent } from '../../src/shared/agent/protocol'
import { computeTrajectoryMetrics, redactTraceEvent, TraceCollector } from '../../src/main/agent/trace'

function makeContextTrace(): ContextTrace {
  return {
    included: [
      { id: 'ctx_task', type: 'task_contract', section: 'stable_prefix', source: 'task', reason: 'included', tokenEstimate: 100 },
    ],
    excluded: [],
    totalTokenEstimate: 100,
    budgetTokens: 4096,
  }
}

describe('TraceCollector', () => {
  it('emits all 9 trace event types', () => {
    const collector = new TraceCollector()
    collector.taskCreated('s1', 't1', 'c1', 'goal')
    collector.contextBuilt('s1', 't1', makeContextTrace())
    collector.modelCalled('s1', 't1', { model: 'gpt-4', providerId: 'openai', inputTokens: 100, outputTokens: 50, latencyMs: 1000 })
    collector.toolExecuted('s1', 't1', 'call1', 'read_file', 'ok', 50)
    collector.policyDecided('s1', 't1', { action: 'allow', risk: 'low', reason: 'read-only tool' })
    collector.verificationRan('s1', 't1', {
      id: 'v1', sessionId: 's1', turnId: 't1', verifier: 'command', status: 'passed', output: 'ok', createdAt: 1,
    })
    collector.reviewCompleted('s1', 't1', {
      id: 'r1', sessionId: 's1', turnId: 't1', status: 'approved', findingIds: [], findings: [], summary: 'approved', createdAt: 1,
    })
    collector.handoffGenerated('s1', 't1', {
      id: 'h1', sessionId: 's1', turnId: 't1', taskContractId: 'c1', summary: 'done', completed: [], implementedUnverified: [],
      failedAttempts: [], changedFiles: [], evidenceRefs: [], unresolvedRisks: [], nextSteps: [], createdAt: 1,
    })
    collector.costUpdated('s1', 't1', { model: 'gpt-4', providerId: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.01, latencyMs: 1000 })

    const events = collector.flush()
    expect(events).toHaveLength(9)
    const types = events.map(e => e.type)
    expect(types).toContain('task.created')
    expect(types).toContain('context.built')
    expect(types).toContain('model.called')
    expect(types).toContain('tool.executed')
    expect(types).toContain('policy.decided')
    expect(types).toContain('verification.ran')
    expect(types).toContain('review.completed')
    expect(types).toContain('handoff.generated')
    expect(types).toContain('cost.updated')
  })

  it('flush clears internal events', () => {
    const collector = new TraceCollector()
    collector.taskCreated('s1', 't1', 'c1', 'goal')
    expect(collector.flush()).toHaveLength(1)
    expect(collector.flush()).toHaveLength(0)
  })
})

describe('redactTraceEvent', () => {
  it('strips grant from policy.decided events', () => {
    const event: TraceEvent = {
      type: 'policy.decided',
      sessionId: 's1',
      turnId: 't1',
      decision: {
        action: 'allow',
        risk: 'low',
        reason: 'test',
        grant: { id: 'g1', permission: 'file.read', pattern: '/secret', action: 'allow', scope: 'session', createdAt: 1 },
      },
      createdAt: 1,
    }
    const redacted = redactTraceEvent(event)
    if (redacted.type !== 'policy.decided') throw new Error('expected policy.decided')
    expect(redacted.decision.grant).toBeUndefined()
  })

  it('passes through context.built events unchanged', () => {
    const event: TraceEvent = {
      type: 'context.built',
      sessionId: 's1',
      turnId: 't1',
      trace: makeContextTrace(),
      createdAt: 1,
    }
    expect(redactTraceEvent(event)).toEqual(event)
  })

  it('passes through model.called events unchanged', () => {
    const event: TraceEvent = {
      type: 'model.called',
      sessionId: 's1',
      turnId: 't1',
      usage: { model: 'gpt-4', providerId: 'openai', inputTokens: 100, outputTokens: 50 },
      createdAt: 1,
    }
    expect(redactTraceEvent(event)).toEqual(event)
  })
})

describe('computeTrajectoryMetrics', () => {
  it('computes completion rate from task.created and handoff.generated events', () => {
    const events: TraceEvent[] = [
      { type: 'task.created', sessionId: 's1', turnId: 't1', contractId: 'c1', summary: 'task 1', createdAt: 1 },
      { type: 'handoff.generated', sessionId: 's1', turnId: 't1', handoff: {
        id: 'h1', sessionId: 's1', turnId: 't1', taskContractId: 'c1', summary: '任务完成。1 项已验证。',
        completed: [], implementedUnverified: [], failedAttempts: [], changedFiles: [], evidenceRefs: [], unresolvedRisks: [], nextSteps: [], createdAt: 2,
      }, createdAt: 2 },
      { type: 'task.created', sessionId: 's1', turnId: 't2', contractId: 'c2', summary: 'task 2', createdAt: 3 },
      { type: 'handoff.generated', sessionId: 's1', turnId: 't2', handoff: {
        id: 'h2', sessionId: 's1', turnId: 't2', taskContractId: 'c2', summary: '任务被中断。0 项已验证。',
        completed: [], implementedUnverified: [], failedAttempts: [], changedFiles: [], evidenceRefs: [], unresolvedRisks: [], nextSteps: [], createdAt: 4,
      }, createdAt: 4 },
    ]
    const metrics = computeTrajectoryMetrics(events)
    expect(metrics.turnCount).toBe(2)
    expect(metrics.completionRate).toBe(0.5) // 1 completed out of 2
  })

  it('counts policy denials', () => {
    const events: TraceEvent[] = [
      { type: 'policy.decided', sessionId: 's1', turnId: 't1', decision: { action: 'deny', risk: 'high', reason: 'destructive' }, createdAt: 1 },
      { type: 'policy.decided', sessionId: 's1', turnId: 't1', decision: { action: 'allow', risk: 'low', reason: 'safe' }, createdAt: 2 },
      { type: 'policy.decided', sessionId: 's1', turnId: 't1', decision: { action: 'deny', risk: 'critical', reason: 'rm -rf' }, createdAt: 3 },
    ]
    expect(computeTrajectoryMetrics(events).denialCount).toBe(2)
  })

  it('aggregates cost.updated events', () => {
    const events: TraceEvent[] = [
      { type: 'cost.updated', sessionId: 's1', turnId: 't1', usage: { model: 'gpt-4', providerId: 'openai', inputTokens: 100, outputTokens: 50, costUsd: 0.01, latencyMs: 500 }, createdAt: 1 },
      { type: 'cost.updated', sessionId: 's1', turnId: 't1', usage: { model: 'gpt-4', providerId: 'openai', inputTokens: 200, outputTokens: 100, costUsd: 0.02, latencyMs: 1000 }, createdAt: 2 },
    ]
    const metrics = computeTrajectoryMetrics(events)
    expect(metrics.totalInputTokens).toBe(300)
    expect(metrics.totalOutputTokens).toBe(150)
    expect(metrics.totalCostUsd).toBeCloseTo(0.03)
    expect(metrics.totalLatencyMs).toBe(1500)
  })

  it('returns zero metrics for empty events', () => {
    const metrics = computeTrajectoryMetrics([])
    expect(metrics.turnCount).toBe(0)
    expect(metrics.completionRate).toBe(0)
    expect(metrics.denialCount).toBe(0)
    expect(metrics.totalInputTokens).toBe(0)
  })
})
