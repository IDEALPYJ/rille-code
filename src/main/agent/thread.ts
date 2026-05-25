import type { WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { join } from 'path'
import type {
  AgentContextSnapshot,
  AgentEvent,
  AgentRunStage,
  AgentOp,
  AgentPermissionMode,
  AgentSession,
  AgentTurn,
  ApprovalDecision,
  ApprovalRequest,
  Evidence,
  EditProposal,
  Handoff,
  MessagePart,
  Observation,
  AgentPlanItem,
  PlanConfirmation,
  ReviewResult,
  TaskContract,
  VerificationCoverage,
} from '../../shared/agent/protocol'
import { applyEditProposal, createRollbackProposal, rejectEditProposal } from './editStore'
import { PermissionGrantStore } from './permissions'
import { AgentLoop } from './runtime'
import { appendSessionEvent, readSessionEvents, saveSessionMeta } from './sessionStore'
import { createInitialPlanItems, createInitialTaskContract } from './taskContract'
import { VerifierRunner } from './verifier'
import { observationFromVerification } from './verificationGate'
import {
  acceptReviewRisk,
  createBrowserEvidence,
  createUserEvidence,
  createWaiver,
  dismissReviewFinding,
  evaluateVerificationGate,
  evidenceFromWaiver,
} from './verificationGate'
import { createCheckpoint } from './checkpointStore'
import { captureRuntimeState, rememberEvidence } from './runtimeState'
import { readArtifactRef } from './artifactStore'
import { FeatureStore } from './featureStore'
import { MemoryStore } from './memory'
import { createCompactionTask, markCompactionTaskFailed, runCompactionTask } from './compaction'
import { invokeAgentHook } from './hooks'

function now(): number {
  return Date.now()
}

function createPartId(): string {
  return `part_${randomUUID()}`
}

function createMessageId(role: 'user' | 'assistant' | 'system'): string {
  return `msg_${role}_${randomUUID()}`
}

function editObservation(sessionId: string, turnId: string, proposal: EditProposal, message: string): Observation {
  return {
    id: `observation_${randomUUID()}`,
    sessionId,
    turnId,
    source: 'edit',
    status: proposal.state === 'applied' ? 'ok' : proposal.state === 'conflicted' ? 'blocked' : 'error',
    summary: message,
    data: {
      proposalId: proposal.id,
      filePath: proposal.filePath,
      state: proposal.state,
      rollbackOf: proposal.rollbackOf,
    },
    createdAt: now(),
  }
}

export class AgentThread {
  private session: AgentSession
  private activeTurn: AgentTurn | null = null
  private abortController: AbortController | null = null
  private approvals = new Map<string, { resolve: (decision: ApprovalDecision) => void; request: ApprovalRequest }>()
  private lastHandoff: Handoff | null = null
  private latestTaskContract: TaskContract | null = null
  private latestPlanItems: AgentPlanItem[] = []
  private latestPlanConfirmation: PlanConfirmation | null = null
  private latestEvidence: Evidence[] = []
  private latestCoverage: VerificationCoverage | null = null
  private latestReviewResult: ReviewResult | null = null
  private readonly grants = new PermissionGrantStore()

  constructor(
    private readonly sender: WebContents,
    workspace: AgentSession['workspace'],
    permissionMode: AgentPermissionMode = 'ask',
    existingSession?: AgentSession,
  ) {
    const timestamp = now()
    this.session = existingSession || {
      id: `session_${randomUUID()}`,
      workspace,
      title: workspace?.label || 'Vibe Coding',
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'idle',
      permissionMode,
    }
  }

  get id(): string {
    return this.session.id
  }

  get view(): AgentSession {
    return this.session
  }

  rename(title: string): AgentSession {
    this.session = { ...this.session, title: title.trim() || '新对话', updatedAt: now() }
    this.emit({ type: 'session.updated', session: this.session })
    return this.session
  }

  archive(): AgentSession {
    this.abortController?.abort()
    this.session = { ...this.session, status: 'archived', updatedAt: now() }
    this.emit({ type: 'session.archived', session: this.session })
    this.emit({ type: 'session.updated', session: this.session })
    return this.session
  }

  unarchive(): AgentSession {
    this.session = { ...this.session, status: 'idle', updatedAt: now() }
    this.emit({ type: 'session.unarchived', session: this.session })
    this.emit({ type: 'session.updated', session: this.session })
    return this.session
  }

  emitCreated(): void {
    this.emit({ type: 'session.created', session: this.session })
  }

  async replayHistory(): Promise<void> {
    const events = await readSessionEvents(this.session.id)
    const pendingApprovals = new Map<string, ApprovalRequest>()
    for (const event of events) {
      if (event.type === 'approval.requested') pendingApprovals.set(event.request.id, event.request)
      if (event.type === 'approval.resolved') pendingApprovals.delete(event.requestId)
      if (event.type === 'handoff.created') this.lastHandoff = event.handoff
      if (event.type === 'task_contract.created' || event.type === 'task_contract.updated') this.latestTaskContract = event.contract
      if (event.type === 'plan.updated') this.latestPlanItems = event.items
      if (event.type === 'plan.confirmation.requested' || event.type === 'plan.confirmation.resolved') this.latestPlanConfirmation = event.confirmation
      if (event.type === 'evidence.created') {
        this.latestEvidence = [...this.latestEvidence.filter(item => item.id !== event.evidence.id), event.evidence].slice(-50)
      }
      if (event.type === 'verification.coverage.updated') this.latestCoverage = event.coverage
      if (event.type === 'review.completed') this.latestReviewResult = event.result
      this.send(event)
    }
    for (const request of pendingApprovals.values()) {
      if (this.approvals.has(request.id)) continue
      this.send({
        type: 'approval.resolved',
        sessionId: this.session.id,
        turnId: request.turnId,
        requestId: request.id,
        decision: { action: 'deny', reason: '会话已恢复，旧审批请求已失效。请重新提交或继续任务。' },
      })
      this.send({ type: 'message.part.created', sessionId: this.session.id, turnId: request.turnId, part: {
        id: `part_approval_expired_${request.id}`,
        messageId: createMessageId('assistant'),
        type: 'text',
        role: 'assistant',
        text: '旧审批请求已失效。请重新提交请求或继续任务。',
        createdAt: now(),
      } })
    }
    this.send({ type: 'session.created', session: this.session })
  }

  handle(op: AgentOp): AgentSession | PlanConfirmation | null {
    if (op.type === 'permission.update') {
      this.session = { ...this.session, permissionMode: op.permissionMode, updatedAt: now() }
      this.emit({ type: 'session.updated', session: this.session })
      return this.session
    }
    if (op.type === 'approval.respond') {
      const pending = this.approvals.get(op.requestId)
      if (pending) {
        this.approvals.delete(op.requestId)
        pending.resolve(op.decision)
      }
      return this.session
    }
    if (op.type === 'turn.interrupt') {
      this.abortController?.abort()
      if (this.activeTurn?.id === op.turnId) {
        this.activeTurn = { ...this.activeTurn, status: 'interrupted' }
        this.session = { ...this.session, status: 'interrupted', updatedAt: now() }
        this.emit({ type: 'turn.completed', sessionId: this.session.id, turnId: op.turnId, reason: 'interrupted' })
        this.emit({ type: 'session.updated', session: this.session })
      }
      return this.session
    }
    if (op.type === 'plan.confirm') {
      return this.confirmPlan(op.confirmationId)
    }
    if (op.type === 'plan.reject') {
      return this.rejectPlan(op.confirmationId, op.reason)
    }
    if (op.type === 'evidence.user.add') {
      this.addUserEvidence(op)
      return this.session
    }
    if (op.type === 'evidence.browser.add') {
      this.addBrowserEvidence(op)
      return this.session
    }
    if (op.type === 'evidence.waive') {
      this.waiveEvidence(op)
      return this.session
    }
    if (op.type === 'review.acceptRisk') {
      this.acceptRisk(op)
      return this.session
    }
    if (op.type === 'review.dismissFinding') {
      this.dismissFinding(op)
      return this.session
    }
    if (op.type === 'edit.reject') {
      this.rejectEdit(op.proposalId, op.reason)
      return this.session
    }
    if (op.type === 'edit.rollback') {
      this.rollbackEdit(op.proposalId)
      return this.session
    }
    return null
  }

  async applyEdit(proposalId: string, context?: AgentContextSnapshot) {
    this.emitStage(this.activeTurn?.id, 'applying_edit', `应用编辑提案 ${proposalId}`)
    if (this.session.workspace) {
      const checkpoint = await createCheckpoint({
        sessionId: this.session.id,
        turnId: this.activeTurn?.id,
        workspace: this.session.workspace,
        reason: `Before applying edit proposal ${proposalId}`,
      })
      this.emit({ type: 'checkpoint.created', sessionId: this.session.id, turnId: this.activeTurn?.id, checkpoint })
    }
    const proposal = await applyEditProposal(proposalId, this.session.workspace, context)
    this.emit({ type: 'edit.proposed', sessionId: this.session.id, turnId: proposal.turnId, proposal })
    const message = proposal.state === 'applied'
      ? `已应用编辑提案 ${proposal.id}。`
      : proposal.state === 'conflicted'
        ? `编辑提案 ${proposal.id} 与当前文件内容冲突，未写入。`
        : `编辑提案 ${proposal.id} 当前状态为 ${proposal.state}。`
    this.emitEditResult(proposal.turnId, proposal.id, proposal.state, proposal.filePath, message)
    this.emitObservation(editObservation(this.session.id, proposal.turnId, proposal, message))
    if (proposal.state === 'applied') {
      await this.runVerification(proposal.turnId)
    }
    return proposal
  }

  rejectEdit(proposalId: string, reason?: string) {
    const proposal = rejectEditProposal(proposalId, reason)
    this.emit({ type: 'edit.proposed', sessionId: this.session.id, turnId: proposal.turnId, proposal })
    const message = reason ? `已拒绝：${reason}` : '已拒绝编辑提案。'
    this.emitEditResult(proposal.turnId, proposal.id, proposal.state, proposal.filePath, message)
    this.emitObservation(editObservation(this.session.id, proposal.turnId, proposal, message))
    return proposal
  }

  rollbackEdit(proposalId: string) {
    const turn = this.activeTurn || {
      id: `turn_ui_${randomUUID()}`,
      sessionId: this.session.id,
      text: 'Rollback edit proposal',
      createdAt: now(),
      status: 'completed' as const,
    }
    const proposal = createRollbackProposal(proposalId, this.session, turn)
    this.emit({ type: 'edit.proposed', sessionId: this.session.id, turnId: proposal.turnId, proposal })
    return proposal
  }

  private createPlanConfirmation(turnId: string, contract: TaskContract, planItems: AgentPlanItem[], reason: string): PlanConfirmation {
    const riskOrder: Record<PlanConfirmation['riskLevel'], number> = { low: 0, medium: 1, high: 2, critical: 3 }
    const riskLevel = contract.riskPoints.reduce<PlanConfirmation['riskLevel']>((current, item) => (
      riskOrder[item.risk] > riskOrder[current] ? item.risk : current
    ), 'low')
    return {
      id: `plan_confirmation_${randomUUID()}`,
      sessionId: this.session.id,
      turnId,
      contractId: contract.id,
      planItemIds: planItems.map(item => item.id),
      status: 'pending',
      riskLevel,
      reason,
      createdAt: now(),
    }
  }

  private emitPlanConfirmation(confirmation: PlanConfirmation): void {
    this.latestPlanConfirmation = confirmation
    this.emit({ type: 'plan.confirmation.requested', sessionId: this.session.id, turnId: confirmation.turnId, confirmation })
    this.emitPart(confirmation.turnId, {
      id: createPartId(),
      messageId: createMessageId('system'),
      type: 'plan_confirmation',
      confirmation,
      createdAt: now(),
    })
  }

  private resolvePlanConfirmation(confirmationId: string, status: 'confirmed' | 'rejected', reason?: string): PlanConfirmation {
    const current = this.latestPlanConfirmation
    if (!current || current.id !== confirmationId) throw new Error('Plan confirmation does not exist.')
    const confirmation: PlanConfirmation = {
      ...current,
      status,
      rejectedReason: status === 'rejected' ? reason : current.rejectedReason,
      resolvedAt: now(),
    }
    this.latestPlanConfirmation = confirmation
    this.emit({ type: 'plan.confirmation.resolved', sessionId: this.session.id, turnId: confirmation.turnId, confirmation })
    this.emitPart(confirmation.turnId, {
      id: createPartId(),
      messageId: createMessageId('system'),
      type: 'plan_confirmation',
      confirmation,
      createdAt: now(),
    })
    return confirmation
  }

  confirmPlan(confirmationId: string): PlanConfirmation {
    return this.resolvePlanConfirmation(confirmationId, 'confirmed')
  }

  rejectPlan(confirmationId: string, reason?: string): PlanConfirmation {
    return this.resolvePlanConfirmation(confirmationId, 'rejected', reason)
  }

  private resolveTurnId(turnId?: string): string {
    return turnId || this.activeTurn?.id || this.latestTaskContract?.turnId || `turn_ui_${randomUUID()}`
  }

  private refreshCoverage(turnId: string): void {
    if (!this.latestTaskContract) return
    const gate = evaluateVerificationGate({ contract: this.latestTaskContract, evidence: this.latestEvidence, codeChanged: false })
    if (gate.coverage) {
      this.emit({ type: 'verification.coverage.updated', sessionId: this.session.id, turnId, coverage: gate.coverage, gate })
      this.emitPart(turnId, {
        id: createPartId(),
        messageId: createMessageId('assistant'),
        type: 'evidence_coverage',
        coverage: gate.coverage,
        evidence: this.latestEvidence,
        gate,
        createdAt: now(),
      })
    }
  }

  private addUserEvidence(op: Extract<AgentOp, { type: 'evidence.user.add' }>): Evidence {
    const artifact = op.artifactId ? readArtifactRef(op.sessionId, op.artifactId) ?? undefined : undefined
    const evidence = createUserEvidence({
      sessionId: this.session.id,
      turnId: this.resolveTurnId(op.turnId),
      criterionId: op.criterionId,
      status: op.status,
      summary: op.summary,
      output: op.output,
      artifact,
      artifactRef: artifact?.id ?? op.artifactId,
    })
    rememberEvidence(evidence)
    this.emitEvidence(evidence)
    this.refreshCoverage(evidence.turnId)
    return evidence
  }

  private addBrowserEvidence(op: Extract<AgentOp, { type: 'evidence.browser.add' }>): Evidence {
    const screenshotArtifact = op.screenshotArtifactId ? readArtifactRef(op.sessionId, op.screenshotArtifactId) ?? undefined : undefined
    const domExcerptArtifact = op.domExcerptArtifactId ? readArtifactRef(op.sessionId, op.domExcerptArtifactId) ?? undefined : undefined
    const evidence = createBrowserEvidence({
      sessionId: this.session.id,
      turnId: this.resolveTurnId(op.turnId),
      criterionId: op.criterionId,
      status: op.status,
      url: op.url,
      title: op.title,
      summary: op.summary,
      screenshotArtifact,
      domExcerptArtifact,
    })
    rememberEvidence(evidence)
    this.emitEvidence(evidence)
    this.refreshCoverage(evidence.turnId)
    return evidence
  }

  private waiveEvidence(op: Extract<AgentOp, { type: 'evidence.waive' }>): Evidence {
    const waiver = createWaiver({
      sessionId: this.session.id,
      turnId: this.resolveTurnId(op.turnId),
      criterionId: op.criterionId,
      evidenceIds: op.evidenceIds,
      reason: op.reason,
      scope: op.scope,
      expiresAt: op.expiresAt,
    })
    const evidence = evidenceFromWaiver(waiver)
    rememberEvidence(evidence)
    this.emit({ type: 'evidence.waived', sessionId: this.session.id, turnId: waiver.turnId, waiver, evidence })
    this.emitEvidence(evidence)
    this.refreshCoverage(waiver.turnId)
    return evidence
  }

  private acceptRisk(op: Extract<AgentOp, { type: 'review.acceptRisk' }>): ReviewResult {
    if (!this.latestReviewResult) throw new Error('No review result exists.')
    const { review, acceptedRisk } = acceptReviewRisk(this.latestReviewResult, op.findingId, op.reason)
    this.emit({ type: 'review.completed', sessionId: this.session.id, turnId: review.turnId, result: review })
    this.emitPart(review.turnId, {
      id: createPartId(),
      messageId: createMessageId('assistant'),
      type: 'review',
      result: review,
      createdAt: now(),
    })
    const evidence = createUserEvidence({
      sessionId: this.session.id,
      turnId: op.turnId || review.turnId,
      status: 'waived',
      summary: `Accepted risk for review finding ${op.findingId}: ${op.reason}`,
      reviewFindingIds: [op.findingId],
      acceptedRiskIds: [acceptedRisk.id],
    })
    rememberEvidence(evidence)
    this.emitEvidence(evidence)
    this.refreshCoverage(evidence.turnId)
    return review
  }

  private dismissFinding(op: Extract<AgentOp, { type: 'review.dismissFinding' }>): ReviewResult {
    if (!this.latestReviewResult) throw new Error('No review result exists.')
    const review = dismissReviewFinding(this.latestReviewResult, op.findingId, op.reason)
    this.emit({ type: 'review.completed', sessionId: this.session.id, turnId: review.turnId, result: review })
    this.emitPart(review.turnId, {
      id: createPartId(),
      messageId: createMessageId('assistant'),
      type: 'review',
      result: review,
      createdAt: now(),
    })
    return review
  }

  async compactContext(turnId?: string, reason?: string) {
    const task = createCompactionTask(this.session.id, turnId, reason)
    this.emit({ type: 'context.compaction.started', sessionId: this.session.id, turnId, task })
    try {
      const { task: completedTask, result } = await runCompactionTask({
        task,
        workspacePath: this.session.workspace?.kind === 'local' ? this.session.workspace.path : undefined,
      })
      this.emit({ type: 'artifact.created', sessionId: this.session.id, turnId, artifact: result.summaryArtifact })
      this.emit({ type: 'context.compacted', sessionId: this.session.id, turnId, task: completedTask, result })
      return result
    } catch (error) {
      const failedTask = markCompactionTaskFailed(task)
      const message = error instanceof Error ? error.message : String(error)
      this.emit({ type: 'context.compaction.failed', sessionId: this.session.id, turnId, task: failedTask, error: message })
      throw error
    }
  }

  private useConfirmedPlanForTurn(turn: AgentTurn): { contract?: TaskContract; planItems?: AgentPlanItem[]; reason?: string } {
    if (this.latestPlanConfirmation?.status !== 'confirmed' || !this.latestTaskContract || this.latestPlanItems.length === 0) return {}
    return {
      contract: { ...this.latestTaskContract, turnId: turn.id, status: 'active', updatedAt: now() },
      planItems: this.latestPlanItems.map(item => ({ ...item, updatedAt: now() })),
      reason: `复用已确认计划 ${this.latestPlanConfirmation.id}`,
    }
  }

  async submitTurn(text: string, context: AgentContextSnapshot): Promise<AgentTurn> {
    if (this.session.status === 'archived') {
      throw new Error('归档会话不能继续运行，请先取消归档。')
    }
    if (this.session.status === 'running') {
      throw new Error('当前会话已有正在运行的 turn。')
    }

    this.abortController = new AbortController()
    const turn: AgentTurn = {
      id: `turn_${randomUUID()}`,
      sessionId: this.session.id,
      text,
      createdAt: now(),
      status: 'running',
    }
    this.activeTurn = turn
    this.session = {
      ...this.session,
      workspace: context.workspace,
      status: 'running',
      updatedAt: now(),
    }

    this.emit({ type: 'session.updated', session: this.session })
    this.emit({ type: 'turn.started', sessionId: this.session.id, turn })
    await this.invokeHook(turn.id, 'turn.start', { textLength: text.length })
    await this.captureRuntime(turn.id, context.workspace)

    const userMessageId = createMessageId('user')
    this.emitPart(turn.id, {
      id: createPartId(),
      messageId: userMessageId,
      type: 'text',
      role: 'user',
      text,
      createdAt: now(),
    })

    try {
      const confirmed = this.useConfirmedPlanForTurn(turn)
      const contract = confirmed.contract ?? createInitialTaskContract({ session: this.session, turn, text, context })
      const planItems = confirmed.planItems ?? createInitialPlanItems(contract)
      const contractMessageId = createMessageId('system')
      const contractPartId = createPartId()
      const planMessageId = createMessageId('system')
      const planPartId = createPartId()

      this.emit({ type: 'task_contract.created', sessionId: this.session.id, turnId: turn.id, contract })
      this.emitPart(turn.id, {
        id: contractPartId,
        messageId: contractMessageId,
        type: 'task_contract',
        contract,
        createdAt: now(),
      })
      this.emit({
        type: 'plan.updated',
        sessionId: this.session.id,
        turnId: turn.id,
        items: planItems,
        reason: confirmed.reason ?? 'runtime 初始化任务计划',
        source: 'runtime',
        createdAt: now(),
      })
      this.emitPart(turn.id, {
        id: planPartId,
        messageId: planMessageId,
        type: 'plan',
        items: planItems,
        reason: confirmed.reason ?? 'runtime 初始化任务计划',
        createdAt: now(),
      })

      if (this.lastHandoff) {
        const freshness = this.checkWorkspaceFreshness(this.lastHandoff, context)
        if (!freshness.fresh) {
          this.emitStaleWarning(turn.id, freshness.warnings)
        }
      }
      this.checkLongRunningFreshness(turn.id, context)

      const reason = await new AgentLoop({
        session: this.session,
        turn,
        text,
        context,
        taskContract: contract,
        taskContractPart: { id: contractPartId, messageId: contractMessageId },
        planItems,
        planPart: { id: planPartId, messageId: planMessageId },
        handoff: this.lastHandoff ?? undefined,
        signal: this.abortController.signal,
        emit: event => this.emit(event),
        requestApproval: request => this.requestApproval(request),
        grants: this.grants,
      }).run()
      if (this.session.permissionMode === 'plan' && reason === 'completed') {
        const confirmation = this.createPlanConfirmation(
          turn.id,
          this.latestTaskContract ?? contract,
          this.latestPlanItems.length > 0 ? this.latestPlanItems : planItems,
          'Plan Mode 需要用户确认后才会执行写入、命令或 sandbox 操作。',
        )
        this.emitPlanConfirmation(confirmation)
      }
      if (this.abortController.signal.aborted) {
        this.activeTurn = { ...turn, status: 'interrupted' }
        this.session = { ...this.session, status: 'interrupted', updatedAt: now() }
        this.emit({ type: 'turn.completed', sessionId: this.session.id, turnId: turn.id, reason: 'interrupted' })
      } else {
        this.activeTurn = { ...turn, status: reason === 'completed' ? 'completed' : 'failed' }
        this.session = { ...this.session, status: reason === 'completed' ? 'idle' : 'error', updatedAt: now() }
        this.emit({ type: 'turn.completed', sessionId: this.session.id, turnId: turn.id, reason })
      }
      this.emit({ type: 'session.updated', session: this.session })
      return turn
    } catch (error) {
      if (this.abortController.signal.aborted) {
        this.activeTurn = { ...turn, status: 'interrupted' }
        this.session = { ...this.session, status: 'interrupted', updatedAt: now() }
        this.emit({ type: 'turn.completed', sessionId: this.session.id, turnId: turn.id, reason: 'interrupted' })
        this.emit({ type: 'session.updated', session: this.session })
        return turn
      }
      const message = error instanceof Error ? error.message : String(error)
      this.activeTurn = { ...turn, status: 'failed' }
      this.session = { ...this.session, status: 'error', updatedAt: now() }
      this.emit({ type: 'turn.failed', sessionId: this.session.id, turnId: turn.id, reason: 'model_error', error: message })
      this.emit({ type: 'message.part.created', sessionId: this.session.id, turnId: turn.id, part: {
        id: createPartId(),
        messageId: createMessageId('assistant'),
        type: 'text',
        role: 'assistant',
        text: `Agent 运行失败：${message}`,
        createdAt: now(),
      } })
      this.emit({ type: 'session.updated', session: this.session })
      return turn
    } finally {
      this.abortController = null
    }
  }

  private emitPart(turnId: string, part: MessagePart): void {
    this.emit({ type: 'message.part.created', sessionId: this.session.id, turnId, part })
  }

  private emitObservation(observation: Observation): void {
    this.emit({ type: 'observation.created', sessionId: this.session.id, turnId: observation.turnId, observation })
  }

  private emitEvidence(evidence: Evidence): void {
    this.emit({ type: 'evidence.created', sessionId: this.session.id, turnId: evidence.turnId, evidence })
  }

  private emitEditResult(turnId: string, proposalId: string, state: EditProposal['state'], filePath: string, message: string): void {
    this.emitPart(turnId, {
      id: createPartId(),
      messageId: createMessageId('assistant'),
      type: 'edit_result',
      proposalId,
      state,
      filePath,
      message,
      createdAt: now(),
    })
  }

  private async runVerification(turnId: string): Promise<void> {
    const turn = this.activeTurn || {
      id: turnId,
      sessionId: this.session.id,
      text: 'Run verification after applying edit',
      createdAt: now(),
      status: 'completed' as const,
    }
    this.emitStage(turn.id, 'running_verification', '运行项目验证命令')
    this.emit({ type: 'verification.started', sessionId: this.session.id, turnId: turn.id, verifier: 'command' })
    const { result, evidence } = await new VerifierRunner(this.session, turn).runFirstAvailableWithEvidence()
    rememberEvidence(evidence)
    this.emit({ type: 'verification.completed', sessionId: this.session.id, turnId: turn.id, result })
    this.emitEvidence(evidence)
    if (result.status === 'failed' || result.status === 'blocked') {
      this.emitObservation(observationFromVerification(this.session.id, turn.id, {
        status: result.status,
        coverage: null,
        evidence: [evidence],
        nextAction: 'repair',
        summary: `Post-apply verification ${result.status}.`,
      }))
    }
    this.emitPart(turn.id, {
      id: createPartId(),
      messageId: createMessageId('assistant'),
      type: 'verification',
      result,
      createdAt: now(),
    })
    await this.captureRuntime(turn.id, this.session.workspace)
  }

  private async captureRuntime(turnId: string | undefined, workspace: AgentSession['workspace']): Promise<void> {
    const { state, artifact } = await captureRuntimeState({ sessionId: this.session.id, turnId, workspace })
    this.emit({ type: 'artifact.created', sessionId: this.session.id, turnId, artifact })
    this.emit({ type: 'runtime.state.captured', sessionId: this.session.id, turnId, state, artifact })
  }

  private emitStage(turnId: string | undefined, stage: AgentRunStage, detail?: string): void {
    const resolvedTurnId = turnId || this.activeTurn?.id || `turn_stage_${randomUUID()}`
    this.emit({ type: 'turn.stage', sessionId: this.session.id, turnId: resolvedTurnId, stage, detail })
    this.emitPart(resolvedTurnId, {
      id: createPartId(),
      messageId: createMessageId('assistant'),
      type: 'stage',
      stage,
      detail,
      createdAt: now(),
    })
  }

  private checkWorkspaceFreshness(handoff: Handoff, context: AgentContextSnapshot): { fresh: boolean; staleFiles: string[]; warnings: string[] } {
    const staleFiles: string[] = []
    const warnings: string[] = []
    const workspacePath = context.workspace?.path
    if (!workspacePath || context.workspace?.kind !== 'local') {
      return { fresh: true, staleFiles: [], warnings: [] }
    }
    for (const filePath of handoff.changedFiles) {
      const fullPath = join(workspacePath, filePath)
      if (!existsSync(fullPath)) {
        staleFiles.push(filePath)
        warnings.push(`文件 ${filePath} 已不存在。`)
      }
    }
    return { fresh: staleFiles.length === 0, staleFiles, warnings }
  }

  private checkLongRunningFreshness(turnId: string, context: AgentContextSnapshot): void {
    const workspacePath = context.workspace?.path
    if (!workspacePath || context.workspace?.kind !== 'local') return
    const evidenceIds = new Set(this.latestEvidence.map(item => item.id))
    const featureSnapshot = new FeatureStore(workspacePath).markStaleMissingEvidence(evidenceIds)
    const downgraded = featureSnapshot.featureList.filter(item => item.status === 'implemented_unverified' && item.evidenceRefs.some(ref => !evidenceIds.has(ref)))
    const memoryStore = new MemoryStore(workspacePath)
    memoryStore.load()
    const activeEntries = memoryStore.listActive(20)
    const missingMemoryRefs = activeEntries.filter(entry => entry.sourceRefs.some(ref => ref.startsWith('evidence_') && !evidenceIds.has(ref)))
    for (const entry of missingMemoryRefs) memoryStore.markStale(entry.id)
    const warnings = [
      ...downgraded.map(item => `Feature ${item.title} has stale or missing evidence refs.`),
      ...missingMemoryRefs.map(item => `Memory ${item.id} has stale source refs.`),
    ]
    if (warnings.length > 0) this.emitStaleWarning(turnId, warnings)
  }

  private emitStaleWarning(turnId: string, warnings: string[]): void {
    if (warnings.length === 0) return
    const observation: Observation = {
      id: `observation_${randomUUID()}`,
      sessionId: this.session.id,
      turnId,
      source: 'runtime',
      status: 'stale',
      summary: `工作区已变化：${warnings.join(' ')}`,
      createdAt: now(),
    }
    this.emitObservation(observation)
  }

  private requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    this.session = { ...this.session, status: 'waiting_approval', updatedAt: now() }
    this.emit({ type: 'session.updated', session: this.session })
    return new Promise(resolve => {
      this.approvals.set(request.id, { resolve: decision => {
        this.session = { ...this.session, status: 'running', updatedAt: now() }
        this.emit({ type: 'session.updated', session: this.session })
        resolve(decision)
      }, request })
    })
  }

  private emit(event: AgentEvent): void {
    if (event.type === 'session.created' || event.type === 'session.updated' || event.type === 'session.archived' || event.type === 'session.unarchived') saveSessionMeta(event.session)
    if (event.type === 'handoff.created') this.lastHandoff = event.handoff
    if (event.type === 'task_contract.created' || event.type === 'task_contract.updated') this.latestTaskContract = event.contract
    if (event.type === 'plan.updated') this.latestPlanItems = event.items
    if (event.type === 'plan.confirmation.requested' || event.type === 'plan.confirmation.resolved') this.latestPlanConfirmation = event.confirmation
    if (event.type === 'evidence.created') this.latestEvidence = [...this.latestEvidence.filter(item => item.id !== event.evidence.id), event.evidence].slice(-50)
    if (event.type === 'verification.coverage.updated') this.latestCoverage = event.coverage
    if (event.type === 'review.completed') this.latestReviewResult = event.result
    if (event.type === 'progress.updated' && this.session.workspace?.kind === 'local') {
      new FeatureStore(this.session.workspace.path).save(event.progress)
    }
    void appendSessionEvent(event).catch(error => {
      console.warn('Failed to persist agent event', error)
    })
    this.send(event)
  }

  private send(_event: AgentEvent): void {
    if (!this.sender.isDestroyed()) {
      this.sender.send('agent:event', _event)
    }
  }

  private async invokeHook(turnId: string, name: 'turn.start', payload?: Record<string, unknown>): Promise<void> {
    const invocations = await invokeAgentHook({ sessionId: this.session.id, turnId, name, payload })
    for (const hook of invocations) this.emit({ type: 'hook.invoked', sessionId: this.session.id, turnId, hook })
  }
}
