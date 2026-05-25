import { describe, expect, it } from 'vitest'
import type { AgentEvent, MessagePart, TraceEvent } from '../../src/shared/agent/protocol'
import { expandComposerDraft, subagentNodes, summarizeAgentWorkbench, traceDebugSummary } from '../../src/renderer/components/agent/workbenchState'

describe('agent workbench state helpers', () => {
  it('computes risk, verification, review, and next action summary', () => {
    const parts: MessagePart[] = [
      { id: 'p1', messageId: 'm1', type: 'task_contract', contract: {
        id: 'c1', sessionId: 's1', turnId: 't1', goal: 'goal', status: 'active', createdAt: 1, updatedAt: 1,
        scope: [], nonGoals: [], constraints: [], acceptanceCriteria: [], verificationPlan: [],
        riskPoints: [{ id: 'risk_1', text: 'Risk', risk: 'high', approvalRequired: true }], assumptions: [],
      }, createdAt: 1 },
      { id: 'p2', messageId: 'm1', type: 'handoff', handoff: {
        id: 'h1', sessionId: 's1', turnId: 't1', taskContractId: 'c1', summary: 'handoff',
        completed: [], implementedUnverified: [], failedAttempts: [], changedFiles: [], evidenceRefs: [], unresolvedRisks: [], nextSteps: ['Run eval'], createdAt: 2,
      }, createdAt: 2 },
    ]
    const events: AgentEvent[] = [
      { type: 'verification.completed', sessionId: 's1', turnId: 't1', result: { id: 'v1', sessionId: 's1', turnId: 't1', verifier: 'command', status: 'passed', output: 'ok', createdAt: 1 } },
      { type: 'review.completed', sessionId: 's1', turnId: 't1', result: { id: 'r1', sessionId: 's1', turnId: 't1', status: 'approved', findingIds: [], findings: [], summary: 'ok', createdAt: 1 } },
    ]

    const summary = summarizeAgentWorkbench(parts, events)
    expect(summary.risk).toBe('high')
    expect(summary.latestVerification).toBe('passed')
    expect(summary.latestReview).toBe('approved')
    expect(summary.nextStep).toBe('Run eval')
  })

  it('expands slash commands, file mentions, and selection mentions', () => {
    const expanded = expandComposerDraft('/fix @file #selection', {
      activeFile: { path: '/repo/src/app.ts', name: 'app.ts' },
      cursor: { line: 12, column: 4 },
    })

    expect(expanded).toContain('请修复当前问题')
    expect(expanded).toContain('/repo/src/app.ts')
    expect(expanded).toContain('/repo/src/app.ts:12:4')
  })

  it('summarizes trace debug and subagent placeholder nodes', () => {
    const trace: TraceEvent[] = [
      { type: 'hook.invoked', sessionId: 's1', turnId: 't1', hook: { id: 'h1', sessionId: 's1', turnId: 't1', name: 'finalize', status: 'completed', durationMs: 1, createdAt: 1 }, createdAt: 1 },
      { type: 'model.cache', sessionId: 's1', turnId: 't1', cache: { cacheHit: true }, createdAt: 2 },
    ]

    expect(traceDebugSummary(trace)).toContain('2 events')
    expect(traceDebugSummary(trace)).toContain('1 cache')
    expect(subagentNodes([])[0].status).toContain('placeholder')
  })
})
