import { randomUUID } from 'crypto'
import { redactSecrets } from './redact'
import type {
  AgentContextSnapshot,
  AgentToolResult,
  AcceptanceEvidenceRequirement,
  Evidence,
  Observation,
  ReviewFinding,
  ReviewResult,
  AgentPlanItem,
  ArtifactRef,
  AcceptedRisk,
  TaskContract,
  VerificationCoverage,
  VerificationCoverageItem,
  VerificationGateResult,
  VerificationResult,
  VerificationStatus,
  Waiver,
} from '../../shared/agent/protocol'
import type { RuntimeToolCall } from './tools'

function now(): number {
  return Date.now()
}

function statusFromToolResult(result: Partial<AgentToolResult>): VerificationStatus {
  if (result.status === 'denied' || result.status === 'conflict') return 'blocked'
  if (result.error || result.status === 'error' || result.status === 'timeout' || result.timedOut) return 'failed'
  return 'passed'
}

export function evidenceFromDiagnostics(input: {
  sessionId: string
  turnId: string
  context: AgentContextSnapshot
}): Evidence {
  const errors = input.context.diagnostics.filter(item => item.severity === 'error')
  return {
    id: `evidence_${randomUUID()}`,
    sessionId: input.sessionId,
    turnId: input.turnId,
    source: 'diagnostics',
    status: errors.length > 0 ? 'failed' : 'passed',
    summary: errors.length > 0 ? `${errors.length} visible diagnostic error(s).` : 'No visible diagnostic errors.',
    output: errors.slice(0, 20).map(item => `${item.filePath}:${item.line}:${item.column} ${item.message}`).join('\n') || undefined,
    data: { errorCount: errors.length, diagnosticCount: input.context.diagnostics.length },
    createdAt: now(),
  }
}

export function evidenceFromVerificationResult(result: VerificationResult): Evidence {
  return {
    id: `evidence_${randomUUID()}`,
    sessionId: result.sessionId,
    turnId: result.turnId,
    source: 'command',
    status: result.status,
    summary: result.command ? `${result.command}: ${result.status}` : `verification: ${result.status}`,
    output: redactSecrets(result.output),
    artifact: result.artifact,
    artifactRef: result.artifactRef,
    data: { verifier: result.verifier, command: result.command, exitCode: result.exitCode, durationMs: result.durationMs },
    createdAt: now(),
  }
}

export function evidenceFromToolResult(input: {
  sessionId: string
  turnId: string
  call: RuntimeToolCall
  result: AgentToolResult
}): Evidence | null {
  if (input.call.name === 'read_diagnostics') {
    return {
      id: `evidence_${randomUUID()}`,
      sessionId: input.sessionId,
      turnId: input.turnId,
      source: 'diagnostics',
      status: statusFromToolResult(input.result),
      summary: input.result.output.slice(0, 240) || 'Diagnostics checked.',
      output: input.result.output,
      data: input.result.structured,
      createdAt: now(),
    }
  }
  if (input.call.name === 'run_command') {
    return {
      id: `evidence_${randomUUID()}`,
      sessionId: input.sessionId,
      turnId: input.turnId,
      source: 'command',
      status: statusFromToolResult(input.result),
      summary: `${String(input.call.input.commandLine || 'command')}: ${input.result.status || 'ok'}`,
      output: input.result.output,
      artifact: input.result.artifact,
      artifactRef: input.result.artifactRef,
      data: { ...input.result.structured, exitCode: input.result.exitCode, durationMs: input.result.durationMs },
      createdAt: now(),
    }
  }
  if (input.call.name === 'git_diff' || input.call.name === 'propose_file_edit') {
    const output = input.result.output || ''
    const hasDiff = input.call.name === 'propose_file_edit' || output.trim().length > 0
    if (!hasDiff) return null
    return {
      id: `evidence_${randomUUID()}`,
      sessionId: input.sessionId,
      turnId: input.turnId,
      source: 'diff',
      status: statusFromToolResult(input.result),
      summary: input.call.name === 'propose_file_edit' ? 'Diff proposal created.' : 'Workspace diff inspected.',
      output: output.slice(0, 6_000),
      data: {
        ...input.result.structured,
        kind: input.call.name === 'propose_file_edit' ? 'edit_proposal' : 'workspace_diff',
        workspaceChanged: input.call.name === 'git_diff' && output.trim().length > 0,
      },
      createdAt: now(),
    }
  }
  return null
}

export function createUserEvidence(input: {
  sessionId: string
  turnId: string
  criterionId?: string
  status?: VerificationStatus
  summary: string
  output?: string
  artifact?: ArtifactRef
  artifactRef?: string
  reviewFindingIds?: string[]
  acceptedRiskIds?: string[]
}): Evidence {
  return {
    id: `evidence_${randomUUID()}`,
    sessionId: input.sessionId,
    turnId: input.turnId,
    criterionId: input.criterionId,
    source: 'user',
    status: input.status ?? 'passed',
    summary: input.summary,
    output: input.output,
    artifact: input.artifact,
    artifactRef: input.artifactRef,
    reviewFindingIds: input.reviewFindingIds,
    acceptedRiskIds: input.acceptedRiskIds,
    createdAt: now(),
  }
}

export function createBrowserEvidence(input: {
  sessionId: string
  turnId: string
  criterionId?: string
  status?: VerificationStatus
  url: string
  title?: string
  summary: string
  screenshotArtifact?: ArtifactRef
  domExcerptArtifact?: ArtifactRef
}): Evidence {
  return {
    id: `evidence_${randomUUID()}`,
    sessionId: input.sessionId,
    turnId: input.turnId,
    criterionId: input.criterionId,
    source: 'browser',
    status: input.status ?? 'passed',
    summary: input.summary,
    artifact: input.screenshotArtifact ?? input.domExcerptArtifact,
    artifactRef: (input.screenshotArtifact ?? input.domExcerptArtifact)?.id,
    data: {
      url: input.url,
      title: input.title,
      screenshotArtifactId: input.screenshotArtifact?.id,
      domExcerptArtifactId: input.domExcerptArtifact?.id,
    },
    createdAt: now(),
  }
}

export function createWaiver(input: {
  sessionId: string
  turnId: string
  criterionId?: string
  evidenceIds?: string[]
  reason: string
  scope?: Waiver['scope']
  expiresAt?: number
}): Waiver {
  const reason = input.reason.trim()
  if (!reason) throw new Error('Waiver reason is required.')
  return {
    id: `waiver_${randomUUID()}`,
    sessionId: input.sessionId,
    turnId: input.turnId,
    criterionId: input.criterionId,
    evidenceIds: input.evidenceIds ?? [],
    reason,
    scope: input.scope ?? (input.criterionId ? 'criterion' : input.evidenceIds?.length ? 'evidence' : 'turn'),
    createdBy: 'user',
    createdAt: now(),
    expiresAt: input.expiresAt,
  }
}

export function evidenceFromWaiver(waiver: Waiver): Evidence {
  return {
    id: `evidence_${randomUUID()}`,
    sessionId: waiver.sessionId,
    turnId: waiver.turnId,
    criterionId: waiver.criterionId,
    source: 'user',
    status: 'waived',
    summary: `User waiver: ${waiver.reason}`,
    waiver,
    reviewFindingIds: [],
    data: { scope: waiver.scope, evidenceIds: waiver.evidenceIds },
    createdAt: now(),
  }
}

function requirementEvidence(requirement: AcceptanceEvidenceRequirement, evidence: Evidence[]): Evidence[] {
  return evidence.filter(item => item.source === requirement)
}

function coverageStatusByRequirement(requirements: AcceptanceEvidenceRequirement[], evidence: Evidence[]): VerificationCoverageItem['status'] {
  const perRequirement = requirements.map(requirement => requirementEvidence(requirement, evidence))
  const matched = perRequirement.flat()
  if (matched.some(item => item.status === 'blocked')) return 'blocked'
  if (matched.some(item => item.status === 'failed')) return 'failed'
  if (matched.some(item => item.status === 'stale')) return 'stale'
  if (requirements.every((_, index) => perRequirement[index].some(item => item.status === 'waived'))) return 'waived'
  if (requirements.every((_, index) => perRequirement[index].some(item => item.status === 'passed' || item.status === 'waived'))) return 'covered'
  if (matched.length > 0) return 'partial'
  return 'blocked'
}

export function computeVerificationCoverage(contract: TaskContract | undefined, evidence: Evidence[]): VerificationCoverage | null {
  if (!contract) return null
  const criteria: VerificationCoverageItem[] = contract.acceptanceCriteria.map(criterion => {
    const required = criterion.evidenceRequired.length > 0 ? criterion.evidenceRequired : ['user' as AcceptanceEvidenceRequirement]
    const matched = required.flatMap(requirement => requirementEvidence(requirement, evidence))
    const uniqueEvidence = Array.from(new Map(matched.map(item => [item.id, item])).values())
    const status = coverageStatusByRequirement(required, evidence)
    const coveredTypes = required.filter(requirement => requirementEvidence(requirement, evidence).some(item => item.status === 'passed' || item.status === 'waived'))
    const missingTypes = required.filter(requirement => requirementEvidence(requirement, evidence).length === 0)
    return {
      criterionId: criterion.id,
      status,
      evidenceIds: uniqueEvidence.map(item => item.id),
      reason: uniqueEvidence.length > 0
        ? `${coveredTypes.length}/${required.length} required evidence type(s) covered${missingTypes.length > 0 ? `; missing: ${missingTypes.join(', ')}` : ''}.`
        : `Missing evidence: ${required.join(', ')}`,
    }
  })
  return { contractId: contract.id, criteria, updatedAt: now() }
}

export function evaluateVerificationGate(input: {
  contract?: TaskContract
  evidence: Evidence[]
  codeChanged: boolean
}): VerificationGateResult {
  const coverage = computeVerificationCoverage(input.contract, input.evidence)
  const failedEvidence = input.evidence.filter(item => item.status === 'failed' || item.status === 'blocked')
  const staleEvidence = input.evidence.filter(item => item.status === 'stale')
  const failedCoverage = coverage?.criteria.filter(item => item.status === 'failed' || item.status === 'blocked') ?? []
  const staleCoverage = coverage?.criteria.filter(item => item.status === 'stale') ?? []
  const partialCoverage = coverage?.criteria.filter(item => item.status === 'partial') ?? []

  if (input.codeChanged && input.evidence.length === 0) {
    return { status: 'blocked', coverage, evidence: input.evidence, nextAction: 'run_more_checks', summary: 'Code changed but no verification evidence exists.' }
  }
  if (failedEvidence.length > 0 || failedCoverage.length > 0) {
    return { status: 'failed', coverage, evidence: input.evidence, nextAction: 'repair', summary: 'Verification evidence or coverage failed.' }
  }
  if (staleEvidence.length > 0 || staleCoverage.length > 0) {
    return { status: 'stale', coverage, evidence: input.evidence, nextAction: 'run_more_checks', summary: 'Verification evidence is stale and must be refreshed.' }
  }
  if (partialCoverage.length > 0) {
    return { status: 'partial', coverage, evidence: input.evidence, nextAction: 'repair', summary: 'Verification coverage is partial.' }
  }
  if (coverage && coverage.criteria.length > 0 && coverage.criteria.every(item => item.status === 'covered' || item.status === 'waived')) {
    return { status: 'passed', coverage, evidence: input.evidence, nextAction: 'allow_final', summary: 'Verification coverage passed.' }
  }
  if (input.codeChanged || (coverage && coverage.criteria.length > 0 && coverage.criteria.some(item => item.status === 'blocked'))) {
    return { status: 'blocked', coverage, evidence: input.evidence, nextAction: 'run_more_checks', summary: 'Code changed but coverage is missing.' }
  }
  return { status: 'skipped', coverage, evidence: input.evidence, nextAction: 'allow_final', summary: 'No code change requiring verification.' }
}

function fileInScope(filePath: string, contract?: TaskContract): boolean {
  if (!contract || contract.scope.length === 0) return true
  const fileScopes = contract.scope.filter(item => item.kind === 'file' || item.kind === 'module' || item.kind === 'workspace')
  if (fileScopes.length === 0) return true
  return fileScopes.some(item => filePath.includes(item.value) || item.value.includes(filePath))
}

export function runRuleBasedReview(input: {
  sessionId: string
  turnId: string
  contract?: TaskContract
  evidence: Evidence[]
  coverage: VerificationCoverage | null
  codeChanged: boolean
  proposedFiles: string[]
  pendingProposalFiles?: string[]
  planItems?: AgentPlanItem[]
}): ReviewResult {
  const findings: ReviewFinding[] = []
  const addFinding = (finding: Omit<ReviewFinding, 'id' | 'sessionId' | 'turnId' | 'status' | 'createdAt'>) => {
    findings.push({
      id: `finding_${randomUUID()}`,
      sessionId: input.sessionId,
      turnId: input.turnId,
      status: 'open',
      source: 'rule',
      createdAt: now(),
      ...finding,
    })
  }

  if (input.codeChanged && input.evidence.length === 0) {
    addFinding({
      category: 'test',
      severity: 'high',
      blocking: true,
      title: 'Missing verification evidence',
      body: 'Code changed but no verification evidence was recorded.',
      evidenceRefs: [],
      recommendation: 'Run diagnostics, tests, typecheck, or another relevant verifier before final response.',
    })
  }

  for (const filePath of input.pendingProposalFiles ?? []) {
    addFinding({
      category: 'correctness',
      severity: 'high',
      blocking: true,
      title: 'Pending edit proposal is not applied',
      body: `A diff proposal exists but has not been applied to the workspace: ${filePath}`,
      filePath,
      evidenceRefs: input.evidence.filter(item => item.source === 'diff').map(item => item.id),
      recommendation: 'Wait for the user/runtime to apply or reject the proposal before claiming the task is complete.',
    })
  }

  const completedWithoutEvidence = (input.planItems ?? []).filter(item =>
    item.status === 'completed'
    && (!item.evidenceIds || item.evidenceIds.length === 0)
    && !item.evidence
  )
  if (completedWithoutEvidence.length > 0) {
    addFinding({
      category: 'evidence',
      severity: 'medium',
      blocking: true,
      title: 'Completed plan item lacks evidence',
      body: `Completed plan items must bind evidence before final response: ${completedWithoutEvidence.map(item => item.title).join(', ')}`,
      evidenceRefs: [],
      recommendation: 'Bind evidence IDs to completed plan items or move them back to in_progress.',
    })
  }

  const failedEvidence = input.evidence.filter(item => item.status === 'failed' || item.status === 'blocked')
  if (input.codeChanged && failedEvidence.length > 0) {
    addFinding({
      category: 'evidence',
      severity: 'high',
      blocking: true,
      title: 'Failed evidence is still open',
      body: 'One or more verification evidence items failed or were blocked.',
      evidenceRefs: failedEvidence.map(item => item.id),
      recommendation: 'Repair the issue or obtain an explicit waiver before final response.',
    })
  }

  for (const filePath of input.proposedFiles) {
    if (!fileInScope(filePath, input.contract)) {
      addFinding({
        category: 'scope',
        severity: 'medium',
        blocking: true,
        title: 'Potentially out-of-scope file change',
        body: `Changed file is not covered by the current task scope: ${filePath}`,
        filePath,
        evidenceRefs: input.evidence.filter(item => item.source === 'diff').map(item => item.id),
        recommendation: 'Confirm the scope or revert unrelated changes.',
      })
    }
  }

  if (input.contract?.riskPoints.some(item => item.risk === 'high' || item.risk === 'critical') && input.coverage?.criteria.some(item => item.status !== 'covered' && item.status !== 'waived')) {
    addFinding({
      category: 'evidence',
      severity: 'medium',
      blocking: true,
      title: 'High-risk task lacks full coverage',
      body: 'The task has high-risk points and not all acceptance criteria are covered.',
      evidenceRefs: input.evidence.map(item => item.id),
      recommendation: 'Complete verification coverage before final response.',
    })
  }

  const blocking = findings.filter(item => item.blocking)
  return {
    id: `review_${randomUUID()}`,
    sessionId: input.sessionId,
    turnId: input.turnId,
    status: blocking.length > 0 ? 'request_changes' : 'approved',
    findingIds: findings.map(item => item.id),
    findings,
    summary: blocking.length > 0 ? `${blocking.length} blocking review finding(s).` : 'Rule-based review approved.',
    createdAt: now(),
  }
}

export function observationFromVerification(sessionId: string, turnId: string, gate: VerificationGateResult): Observation {
  return {
    id: `observation_${randomUUID()}`,
    sessionId,
    turnId,
    source: 'verification',
    status: gate.status === 'passed' || gate.status === 'skipped' || gate.status === 'waived' ? 'ok' : gate.status === 'stale' ? 'stale' : 'blocked',
    summary: gate.summary,
    data: { status: gate.status, nextAction: gate.nextAction, coverage: gate.coverage },
    createdAt: now(),
  }
}

export function observationFromReview(result: ReviewResult): Observation {
  return {
    id: `observation_${randomUUID()}`,
    sessionId: result.sessionId,
    turnId: result.turnId,
    source: 'review',
    status: result.status === 'approved' ? 'ok' : 'blocked',
    summary: result.summary,
    data: { status: result.status, findingIds: result.findingIds, findings: result.findings },
    createdAt: now(),
  }
}

function isBlockingFinding(finding: ReviewFinding): boolean {
  return finding.blocking && finding.status === 'open'
}

export function mergeReviews(ruleReview: ReviewResult, llmReview: ReviewResult | null): ReviewResult {
  if (!llmReview) return ruleReview

  const ruleFindings = ruleReview.findings.map(f => ({ ...f, source: f.source ?? 'rule' as const }))
  const llmFindings = llmReview.findings.map(f => ({ ...f, source: 'llm' as const }))

  const allFindings = [...ruleFindings, ...llmFindings]

  const combinedSummary = [
    ruleReview.summary ? `Rule: ${ruleReview.summary}` : null,
    llmReview.summary ? `LLM: ${llmReview.summary}` : null,
  ].filter(Boolean).join(' | ')

  const openBlocking = allFindings.some(isBlockingFinding)
  const nonBlockingStatus = ruleReview.status !== 'approved' || llmReview.status !== 'approved'
  const status: ReviewResult['status'] = openBlocking || nonBlockingStatus ? 'request_changes' : 'approved'

  return {
    ...ruleReview,
    status,
    findingIds: allFindings.map(f => f.id),
    findings: allFindings,
    summary: combinedSummary || ruleReview.summary || llmReview.summary,
  }
}

export function acceptReviewRisk(result: ReviewResult, findingId: string, reason: string): { review: ReviewResult; acceptedRisk: AcceptedRisk } {
  const trimmed = reason.trim()
  if (!trimmed) throw new Error('Accepted risk reason is required.')
  const finding = result.findings.find(item => item.id === findingId)
  if (!finding) throw new Error('Review finding does not exist.')
  const acceptedRisk: AcceptedRisk = {
    id: `accepted_risk_${randomUUID()}`,
    sessionId: result.sessionId,
    turnId: result.turnId,
    findingId,
    reason: trimmed,
    createdBy: 'user',
    createdAt: now(),
  }
  const findings = result.findings.map(item => item.id === findingId
    ? { ...item, status: 'accepted_risk' as const, recommendation: [item.recommendation, `Accepted risk: ${trimmed}`].filter(Boolean).join('\n') }
    : item)
  const status: ReviewResult['status'] = findings.some(isBlockingFinding) ? result.status : 'approved'
  return {
    acceptedRisk,
    review: {
      ...result,
      status,
      findings,
      summary: status === 'approved' ? 'Review approved with accepted risk.' : result.summary,
    },
  }
}

export function dismissReviewFinding(result: ReviewResult, findingId: string, reason?: string): ReviewResult {
  const finding = result.findings.find(item => item.id === findingId)
  if (!finding) throw new Error('Review finding does not exist.')
  const findings = result.findings.map(item => item.id === findingId
    ? { ...item, status: 'dismissed' as const, recommendation: reason ? [item.recommendation, `Dismissed: ${reason}`].filter(Boolean).join('\n') : item.recommendation }
    : item)
  const status: ReviewResult['status'] = findings.some(isBlockingFinding) ? result.status : 'approved'
  return {
    ...result,
    status,
    findings,
    summary: status === 'approved' ? 'Review approved after dismissed finding.' : result.summary,
  }
}
