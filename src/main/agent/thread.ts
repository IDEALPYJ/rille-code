import type { WebContents } from 'electron'
import { randomUUID } from 'crypto'
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
  EditProposal,
  MessagePart,
} from '../../shared/agent/protocol'
import { applyEditProposal, createRollbackProposal, rejectEditProposal } from './editStore'
import { AgentLoop } from './runtime'
import { appendSessionEvent, readSessionEvents, saveSessionMeta } from './sessionStore'
import { VerifierRunner } from './verifier'

function now(): number {
  return Date.now()
}

function createPartId(): string {
  return `part_${randomUUID()}`
}

function createMessageId(role: 'user' | 'assistant' | 'system'): string {
  return `msg_${role}_${randomUUID()}`
}

export class AgentThread {
  private session: AgentSession
  private activeTurn: AgentTurn | null = null
  private abortController: AbortController | null = null
  private approvals = new Map<string, { resolve: (decision: ApprovalDecision) => void; request: ApprovalRequest }>()

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

  emitCreated(): void {
    this.emit({ type: 'session.created', session: this.session })
  }

  async replayHistory(): Promise<void> {
    for (const event of await readSessionEvents(this.session.id)) {
      this.send(event)
    }
    this.send({ type: 'session.created', session: this.session })
  }

  handle(op: AgentOp): AgentSession | null {
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

  async applyEdit(proposalId: string) {
    this.emitStage(this.activeTurn?.id, 'applying_edit', `应用编辑提案 ${proposalId}`)
    const proposal = await applyEditProposal(proposalId, this.session.workspace)
    this.emit({ type: 'edit.proposed', sessionId: this.session.id, turnId: proposal.turnId, proposal })
    const message = proposal.state === 'applied'
      ? `已应用编辑提案 ${proposal.id}。`
      : proposal.state === 'conflicted'
        ? `编辑提案 ${proposal.id} 与当前文件内容冲突，未写入。`
        : `编辑提案 ${proposal.id} 当前状态为 ${proposal.state}。`
    this.emitEditResult(proposal.turnId, proposal.id, proposal.state, proposal.filePath, message)
    if (proposal.state === 'applied') {
      await this.runVerification(proposal.turnId)
    }
    return proposal
  }

  rejectEdit(proposalId: string, reason?: string) {
    const proposal = rejectEditProposal(proposalId, reason)
    this.emit({ type: 'edit.proposed', sessionId: this.session.id, turnId: proposal.turnId, proposal })
    this.emitEditResult(proposal.turnId, proposal.id, proposal.state, proposal.filePath, reason ? `已拒绝：${reason}` : '已拒绝编辑提案。')
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

  async submitTurn(text: string, context: AgentContextSnapshot): Promise<AgentTurn> {
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
      const reason = await new AgentLoop({
        session: this.session,
        turn,
        text,
        context,
        signal: this.abortController.signal,
        emit: event => this.emit(event),
        requestApproval: request => this.requestApproval(request),
      }).run()
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
    const result = await new VerifierRunner(this.session, turn).runFirstAvailable()
    this.emit({ type: 'verification.completed', sessionId: this.session.id, turnId: turn.id, result })
    this.emitPart(turn.id, {
      id: createPartId(),
      messageId: createMessageId('assistant'),
      type: 'verification',
      result,
      createdAt: now(),
    })
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
    if (event.type === 'session.created' || event.type === 'session.updated') saveSessionMeta(event.session)
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
}
