import { describe, expect, it } from 'vitest'
import type { EvalCase, TraceEvent } from '../../src/shared/agent/protocol'
import { evaluateEvalCase, runEvalCases } from '../../eval/runner'

const approvedTrace: TraceEvent[] = [
  { type: 'task.created', sessionId: 's1', turnId: 't1', contractId: 'c1', summary: 'task', createdAt: 1 },
  { type: 'verification.ran', sessionId: 's1', turnId: 't1', result: { id: 'v1', sessionId: 's1', turnId: 't1', verifier: 'command', status: 'passed', output: 'ok', createdAt: 2 }, createdAt: 2 },
  { type: 'review.completed', sessionId: 's1', turnId: 't1', result: { id: 'r1', sessionId: 's1', turnId: 't1', status: 'approved', findingIds: [], findings: [], summary: 'approved', createdAt: 3 }, createdAt: 3 },
  { type: 'handoff.generated', sessionId: 's1', turnId: 't1', handoff: { id: 'h1', sessionId: 's1', turnId: 't1', taskContractId: 'c1', summary: '任务完成。', completed: [], implementedUnverified: [], failedAttempts: [], changedFiles: [], evidenceRefs: [], unresolvedRisks: [], nextSteps: [], createdAt: 4 }, createdAt: 4 },
]

describe('eval runner', () => {
  it('passes deterministic full-turn fixture cases', () => {
    const evalCase: EvalCase = {
      id: 'case_1',
      title: 'case',
      task: 'task',
      mode: 'full_turn',
      expectedTrajectory: ['task.created', 'verification.ran', 'review.completed', 'handoff.generated'],
      expectedEvidence: ['command'],
      expectedState: { finalGate: 'allow_final', reviewStatus: 'approved', handoffCompleted: true },
      safetyExpectations: ['no destructive commands'],
    }

    expect(evaluateEvalCase(evalCase, approvedTrace).passed).toBe(true)
  })

  it('fails when forbidden actions appear', () => {
    const evalCase: EvalCase = {
      id: 'case_2',
      title: 'forbidden',
      task: 'task',
      expectedTrajectory: ['tool.executed'],
      expectedEvidence: [],
      forbiddenActions: ['run_command'],
      safetyExpectations: [],
    }
    const trace: TraceEvent[] = [
      { type: 'tool.executed', sessionId: 's1', turnId: 't1', callId: 'tool_1', name: 'run_command', status: 'ok', createdAt: 1 },
    ]

    const result = evaluateEvalCase(evalCase, trace)
    expect(result.passed).toBe(false)
    expect(result.forbiddenActions.found).toEqual(['run_command'])
  })

  it('runs setup and teardown metadata without mutating fixtures', async () => {
    const evalCase: EvalCase = {
      id: 'case_3',
      title: 'fixture',
      task: 'task',
      mode: 'single_step',
      setup: [{ name: 'setup fixture' }],
      teardown: [{ name: 'teardown fixture' }],
      traceFixture: approvedTrace,
      expectedTrajectory: ['task.created'],
      expectedEvidence: [],
      safetyExpectations: [],
    }

    const [result] = await runEvalCases([evalCase])
    expect(result.passed).toBe(true)
    expect(result.setupRan).toEqual(['setup fixture'])
    expect(result.teardownRan).toEqual(['teardown fixture'])
  })
})
