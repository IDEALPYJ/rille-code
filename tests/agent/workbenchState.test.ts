import { describe, expect, it } from 'vitest'
import type { AgentEvent, MessagePart, TraceEvent } from '../../src/shared/agent/protocol'
import { composerInlineModeLabel, expandComposerDraft, removeLeadingSlashAction, shouldShowSlashActions, slashActionAt, slashActions, subagentNodes, summarizeAgentWorkbench, traceDebugSummary } from '../../src/renderer/components/agent/workbenchState'

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

  it('describes slash action choices and keyboard cycling', () => {
    expect(slashActions.map(action => action.id)).toEqual(['chat', 'plan', 'compact', 'btw'])
    expect(slashActions.find(action => action.id === 'chat')?.immediate).toBe(false)
    expect(slashActions.find(action => action.id === 'plan')?.immediate).toBe(false)
    expect(slashActions.find(action => action.id === 'compact')?.immediate).toBe(true)
    expect(slashActions.find(action => action.id === 'btw')?.immediate).toBe(true)
    expect(slashActions.find(action => action.id === 'btw')?.label).toBe('临时聊天')
    expect(shouldShowSlashActions('/')).toBe(true)
    expect(shouldShowSlashActions('/bt')).toBe(true)
    expect(shouldShowSlashActions('/btw hello')).toBe(false)
    expect(slashActionAt(0, -1)).toBe(3)
    expect(slashActionAt(3, 1)).toBe(0)
  })

  it('removes only the leading slash action token when selecting chat or plan', () => {
    expect(removeLeadingSlashAction('/plan 请分析当前实现')).toBe('请分析当前实现')
    expect(removeLeadingSlashAction('/chat\n第二行内容')).toBe('第二行内容')
    expect(removeLeadingSlashAction('/')).toBe('')
    expect(removeLeadingSlashAction('保留普通草稿')).toBe('保留普通草稿')
  })

  it('labels inline composer modes', () => {
    expect(composerInlineModeLabel('plan')).toBe('计划')
    expect(composerInlineModeLabel('chat')).toBe('聊天')
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

  it('summarizes real subagent tree events', () => {
    const events: AgentEvent[] = [
      { type: 'subagent.started', sessionId: 's1', turnId: 't1', run: {
        id: 'run_1',
        parentSessionId: 's1',
        parentTurnId: 't1',
        childSessionId: 'child_1',
        role: 'explorer',
        status: 'running',
        executionMode: 'local_worktree',
        fallbackMode: 'visible_deterministic',
        mergeStatus: 'blocked',
        proposalIds: [],
        contract: { id: 'c1', parentSessionId: 's1', parentTurnId: 't1', role: 'explorer', goal: 'explore', permissionScope: 'isolated_write', executionMode: 'local_worktree', allowedTools: [], outputSchema: 'summary', fallbackMode: 'visible_deterministic', createdAt: 1 },
        createdAt: 1,
      } },
      { type: 'subagent.sandbox.created', sessionId: 's1', turnId: 't1', runId: 'run_1', sandbox: {
        id: 'sandbox_1',
        sessionId: 's1',
        workspace: { kind: 'local', path: '/repo', label: 'repo' },
        sandboxWorkspace: { kind: 'worktree', path: '/tmp/sandbox', label: 'sandbox', origin: { kind: 'local', path: '/repo', label: 'repo' }, sandboxId: 'sandbox_1' },
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
      } },
      { type: 'subagent.proposals.created', sessionId: 's1', turnId: 't1', runId: 'run_1', proposalIds: ['proposal_1'], mergeStatus: 'ready' },
      { type: 'subagent.completed', sessionId: 's1', turnId: 't1', run: {
        id: 'run_1',
        parentSessionId: 's1',
        parentTurnId: 't1',
        childSessionId: 'child_1',
        role: 'explorer',
        status: 'completed',
        executionMode: 'local_worktree',
        sandboxId: 'sandbox_1',
        fallbackMode: 'visible_deterministic',
        proposalIds: ['proposal_1'],
        mergeStatus: 'ready',
        contract: { id: 'c1', parentSessionId: 's1', parentTurnId: 't1', role: 'explorer', goal: 'explore', permissionScope: 'isolated_write', executionMode: 'local_worktree', allowedTools: [], outputSchema: 'summary', fallbackMode: 'visible_deterministic', createdAt: 1 },
        createdAt: 1,
        completedAt: 2,
      }, result: { id: 'r1', contractId: 'c1', role: 'explorer', status: 'completed', summary: 'found files', proposalIds: ['proposal_1'], fallbackMode: 'visible_deterministic', mergeStatus: 'ready', createdAt: 1, completedAt: 2 } },
    ]

    const nodes = subagentNodes(events)
    expect(nodes[0]).toMatchObject({ label: 'explorer subagent' })
    expect(nodes[0]).toMatchObject({ scope: 'isolated_write', sandboxId: 'sandbox_1', proposalCount: 1, mergeStatus: 'ready' })
    expect(nodes[0].status).toContain('found files')
  })
})
