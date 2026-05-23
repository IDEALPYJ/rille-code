import { describe, expect, it } from 'vitest'
import type { AgentContextSnapshot, Evidence, TaskContract } from '../../src/shared/agent/protocol'
import {
  computeVerificationCoverage,
  evaluateVerificationGate,
  evidenceFromDiagnostics,
  runRuleBasedReview,
} from '../../src/main/agent/verificationGate'

function contract(): TaskContract {
  return {
    id: 'contract_test',
    sessionId: 'session_test',
    turnId: 'turn_test',
    goal: '修改 src/main.ts',
    scope: [{ kind: 'file', value: 'src/main.ts', source: 'user' }],
    nonGoals: [],
    constraints: [],
    acceptanceCriteria: [
      { id: 'ac_diff', text: '有 diff', evidenceRequired: ['diff'], status: 'unverified' },
      { id: 'ac_verify', text: '验证通过', evidenceRequired: ['diagnostics', 'command'], status: 'unverified' },
    ],
    verificationPlan: [],
    riskPoints: [],
    assumptions: [],
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  }
}

function evidence(source: Evidence['source'], status: Evidence['status'] = 'passed'): Evidence {
  return {
    id: `evidence_${source}_${status}`,
    sessionId: 'session_test',
    turnId: 'turn_test',
    source,
    status,
    summary: `${source} ${status}`,
    createdAt: 1,
  }
}

describe('verification gate', () => {
  it('creates diagnostics evidence from visible diagnostics', () => {
    const context: AgentContextSnapshot = {
      workspace: null,
      activeFile: null,
      openFiles: [],
      diagnostics: [{ id: 'diag_1', filePath: 'src/main.ts', line: 1, column: 1, severity: 'error', message: 'bad' }],
    }
    expect(evidenceFromDiagnostics({ sessionId: 'session_test', turnId: 'turn_test', context })).toMatchObject({
      source: 'diagnostics',
      status: 'failed',
    })
  })

  it('computes covered and blocked criteria', () => {
    const coverage = computeVerificationCoverage(contract(), [evidence('diff'), evidence('diagnostics')])
    expect(coverage?.criteria.find(item => item.criterionId === 'ac_diff')?.status).toBe('covered')
    expect(coverage?.criteria.find(item => item.criterionId === 'ac_verify')?.status).toBe('partial')
  })

  it('blocks final response when changed code has failed evidence', () => {
    const gate = evaluateVerificationGate({
      contract: contract(),
      evidence: [evidence('diff'), evidence('diagnostics', 'failed'), evidence('command')],
      codeChanged: true,
    })
    expect(gate.nextAction).toBe('repair')
    expect(gate.status).toBe('failed')
  })

  it('blocks final answers when contract coverage is partial', () => {
    const gate = evaluateVerificationGate({
      contract: contract(),
      evidence: [evidence('diagnostics')],
      codeChanged: false,
    })
    expect(gate.nextAction).toBe('repair')
  })

  it('does not let duplicate evidence types cover distinct requirements', () => {
    const coverage = computeVerificationCoverage(contract(), [evidence('diff'), { ...evidence('command'), id: 'command_1' }, { ...evidence('command'), id: 'command_2' }])
    expect(coverage?.criteria.find(item => item.criterionId === 'ac_verify')?.status).toBe('partial')
    expect(coverage?.criteria.find(item => item.criterionId === 'ac_verify')?.reason).toContain('missing: diagnostics')
  })

  it('creates blocking review findings for out-of-scope changed files', () => {
    const review = runRuleBasedReview({
      sessionId: 'session_test',
      turnId: 'turn_test',
      contract: contract(),
      evidence: [evidence('diff'), evidence('diagnostics'), evidence('command')],
      coverage: computeVerificationCoverage(contract(), [evidence('diff'), evidence('diagnostics'), evidence('command')]),
      codeChanged: true,
      proposedFiles: ['src/other.ts'],
    })
    expect(review.status).toBe('request_changes')
    expect(review.findings.some(item => item.category === 'scope' && item.blocking)).toBe(true)
  })
})
