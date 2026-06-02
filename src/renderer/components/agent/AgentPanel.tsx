import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Archive,
  Check,
  ChevronDown,
  ListChecks,
  MessageCircle,
  PanelRight,
  Square,
} from 'lucide-react'
import type {
  AgentContextSnapshot,
  AgentEvent,
  AgentModelStoreSnapshot,
  AgentPermissionMode,
  AgentSession,
  AgentTurn,
  AgentTurnMode,
  ApprovalRequest,
  EditProposal,
  MessagePart,
  TraceEvent,
} from '../../../shared/agent/protocol'
import type { OpenFile } from '../../App'
import type { EditorDiagnostic } from '../Editor'
import { expandComposerDraft, shouldShowSlashActions, slashActionAt, slashActions, type SlashActionId } from './workbenchState'
import {
  fileNameFromPath,
  shortModelLabel,
} from './AgentPartCards'
import { ChatTurnView, type TurnRunMeta } from './AgentTurnView'

interface Props {
  workspace: WorkspaceLocation | null
  gitMeta?: Pick<GitStatusResult, 'isRepo' | 'branch' | 'remoteName'> | null
  activeFile?: OpenFile
  openFiles: OpenFile[]
  diagnostics: EditorDiagnostic[]
  cursor: { line: number; column: number }
  session: AgentSession | null
  sessionId?: string | null
  submitSessionId?: string | null
  transientSessionId?: string | null
  persistHistory?: boolean
  allowSlashActions?: boolean
  showPermissionMenu?: boolean
  forceTurnMode?: AgentTurnMode
  onOpenBtw?: () => void
  onSessionChange: (session: AgentSession | null) => void
  onFileApplied?: (filePath: string, content: string) => void
}

const permissionModes: Array<{ value: AgentPermissionMode; label: string; desc: string }> = [
  { value: 'default', label: '默认权限', desc: '编辑和高危命令需确认' },
  { value: 'auto_review', label: '自动审查', desc: '自动应用编辑，高危命令确认' },
  { value: 'full_access', label: '完全权限', desc: '自动允许所有合法操作' },
]

function toContextSnapshot(props: Props): AgentContextSnapshot {
  return {
    workspace: props.workspace,
    activeFile: props.activeFile
      ? {
          path: props.activeFile.path,
          name: props.activeFile.name,
          isDirty: props.activeFile.isDirty,
          content: props.activeFile.content,
        }
      : null,
    openFiles: props.openFiles.map(file => ({
      path: file.path,
      name: file.name,
      isDirty: file.isDirty,
    })),
    diagnostics: props.diagnostics,
    cursor: props.cursor,
  }
}

type ApprovalAction = 'allow_once' | 'always_allow' | 'allow_workspace' | 'deny'

export function approvalRequestTitle(request: ApprovalRequest): string {
  const target = (request.target || '').trim()
  if (target) return `模型请求执行指令 ${target}`
  const reason = request.reason.trim()
  const title = request.title.toLowerCase()
  if (title.includes('edit') || title.includes('write') || title.includes('proposal') || /propose_file_edit|apply_file_edit/.test(reason)) {
    return `模型请求编辑 ${fileNameFromPath(reason) || reason || '文件'}`
  }
  return reason ? `模型请求 ${reason}` : `模型请求 ${request.title}`
}

export function editProposalTitle(proposals: EditProposal[]): string {
  const primary = proposals[0]
  if (!primary) return '模型请求编辑文件'
  return proposals.length === 1
    ? `模型请求编辑 ${fileNameFromPath(primary.filePath)}`
    : `模型请求编辑 ${proposals.length} 个文件`
}

function ApprovalPopover({ request, onDecision }: {
  request: ApprovalRequest
  onDecision: (request: ApprovalRequest, action: ApprovalAction, reason?: string) => void
}) {
  const [entered, setEntered] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [guide, setGuide] = useState('')
  useEffect(() => { requestAnimationFrame(() => setEntered(true)) }, [])
  const decide = useCallback((action: ApprovalAction, reason?: string) => {
    setLeaving(true)
    window.setTimeout(() => onDecision(request, action, reason), 180)
  }, [onDecision, request])
  const canWorkspace = request.grantOptions?.includes('workspace')
  const canSession = request.grantOptions?.includes('session')

  return (
    <div className={'approval-popover' + (entered && !leaving ? ' enter' : '') + (leaving ? ' leaving' : '')}>
      <div className={'approval-popover-card risk-' + request.risk}>
        <div className="approval-popover-title">{approvalRequestTitle(request)}</div>
        {(request.target || request.reason) && (
          <div className="approval-popover-summary">{request.target || request.reason}</div>
        )}
        <div className="approval-popover-actions">
          <button type="button" onClick={() => decide('allow_once')}>允许一次</button>
          {canWorkspace ? (
            <button type="button" onClick={() => decide('allow_workspace')}>该项目中允许</button>
          ) : canSession ? (
            <button type="button" onClick={() => decide('always_allow')}>本次会话允许</button>
          ) : null}
          <button type="button" onClick={() => decide('deny')}>拒绝</button>
        </div>
        <div className="approval-guide">
          <input
            value={guide}
            placeholder="告诉模型怎么做"
            onChange={event => setGuide(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && guide.trim()) {
                event.preventDefault()
                decide('deny', guide.trim())
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}

type EditProposalAction = 'apply_one' | 'apply_all' | 'reject'

function SlashActionPopover({
  selectedIndex,
  onSelect,
}: {
  selectedIndex: number
  onSelect: (id: SlashActionId) => void
}) {
  const icons: Record<SlashActionId, typeof MessageCircle> = {
    chat: MessageCircle,
    plan: ListChecks,
    compact: Archive,
    btw: PanelRight,
  }
  return (
    <div className="approval-popover slash-action-popover enter">
      <div className="approval-popover-card slash-action-card">
        {slashActions.map((action, index) => {
          const Icon = icons[action.id]
          return (
            <button
              type="button"
              key={action.id}
              className={index === selectedIndex ? 'selected' : ''}
              onMouseDown={event => event.preventDefault()}
              onClick={() => onSelect(action.id)}
            >
              <Icon size={15} />
              <span className="slash-action-copy">
                <span>{action.label}</span>
                <small>{action.description}</small>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function EditProposalPopover({
  proposals,
  onDecision,
}: {
  proposals: EditProposal[]
  onDecision: (proposal: EditProposal, action: EditProposalAction, reason?: string) => void
}) {
  const [entered, setEntered] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [guide, setGuide] = useState('')
  useEffect(() => { requestAnimationFrame(() => setEntered(true)) }, [])
  const primary = proposals[0]
  const title = editProposalTitle(proposals)
  const decide = useCallback((action: EditProposalAction, reason?: string) => {
    if (!primary) return
    setLeaving(true)
    window.setTimeout(() => onDecision(primary, action, reason), 180)
  }, [onDecision, primary])

  if (!primary) return null

  return (
    <div className={'approval-popover edit-proposal-popover' + (entered && !leaving ? ' enter' : '') + (leaving ? ' leaving' : '')}>
      <div className="approval-popover-card">
        <div className="approval-popover-title">{title}</div>
        <div className="approval-popover-summary">
          {proposals.map(proposal => fileNameFromPath(proposal.filePath)).join(' · ')}
        </div>
        <details className="approval-popover-details">
          <summary>查看编辑列表</summary>
          <div>
            {proposals.map(proposal => (
              <span key={proposal.id}>{proposal.title} · {proposal.filePath}</span>
            ))}
          </div>
        </details>
        {primary.rationale && <div className="approval-popover-summary">{primary.rationale}</div>}
        <div className="approval-popover-actions">
          <button type="button" onClick={() => decide('apply_one')}>应用一次</button>
          <button type="button" onClick={() => decide('apply_all')}>全部应用</button>
          <button type="button" onClick={() => decide('reject')}>拒绝</button>
        </div>
        <div className="approval-guide">
          <input
            value={guide}
            placeholder="告诉模型怎么做"
            onChange={event => setGuide(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && guide.trim()) {
                event.preventDefault()
                decide('reject', guide.trim())
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}

export function AgentPanel(props: Props) {
  const [parts, setParts] = useState<MessagePart[]>([])
  const [proposals, setProposals] = useState<Record<string, EditProposal>>({})
  const [approvals, setApprovals] = useState<Record<string, ApprovalRequest>>({})
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([])
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([])
  const [isTraceOpen, setIsTraceOpen] = useState(false)
  const [modelStore, setModelStore] = useState<AgentModelStoreSnapshot | null>(null)
  const [draft, setDraft] = useState('')
  const [composerMode, setComposerMode] = useState<Extract<AgentTurnMode, 'chat' | 'plan'> | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [activeTurn, setActiveTurn] = useState<AgentTurn | null>(null)
  const [turnRunMeta, setTurnRunMeta] = useState<TurnRunMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openComposeMenu, setOpenComposeMenu] = useState<'mode' | 'model' | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const composeRef = useRef<HTMLFormElement | null>(null)
  const submittedAtRef = useRef<number | null>(null)
  const session = props.session
  const displaySessionId = props.sessionId ?? session?.id ?? null
  const submitSessionId = props.submitSessionId || session?.id || null
  const persistHistory = props.persistHistory !== false
  const allowSlashActions = props.allowSlashActions !== false && persistHistory
  const showPermissionMenu = props.showPermissionMenu !== false && persistHistory

  useEffect(() => {
    const unsubscribe = window.rille.onAgentEvent((event: AgentEvent) => {
      if (event.type === 'session.created' || event.type === 'session.updated') {
        if (displaySessionId && event.session.id === displaySessionId) props.onSessionChange(event.session)
        return
      }
      if (!displaySessionId) return
      if ('sessionId' in event && event.sessionId !== displaySessionId) return
      setAgentEvents(prev => [...prev.slice(-120), event])
      if (event.type === 'message.part.created') {
        setParts(prev => prev.some(part =>
          part.id === event.part.id
          || (part.type === 'plan_question' && event.part.type === 'plan_question' && part.question.id === event.part.question.id)
          || (part.type === 'plan_draft' && event.part.type === 'plan_draft' && part.draft.id === event.part.draft.id))
          ? prev.map(part => (
            part.id === event.part.id
            || (part.type === 'plan_question' && event.part.type === 'plan_question' && part.question.id === event.part.question.id)
            || (part.type === 'plan_draft' && event.part.type === 'plan_draft' && part.draft.id === event.part.draft.id)
              ? event.part
              : part
          ))
          : [...prev, event.part])
      } else if (event.type === 'message.part.updated') {
        setParts(prev => prev.some(part =>
          part.id === event.part.id
          || (part.type === 'plan_question' && event.part.type === 'plan_question' && part.question.id === event.part.question.id)
          || (part.type === 'plan_draft' && event.part.type === 'plan_draft' && part.draft.id === event.part.draft.id))
          ? prev.map(part => (
            part.id === event.part.id
            || (part.type === 'plan_question' && event.part.type === 'plan_question' && part.question.id === event.part.question.id)
            || (part.type === 'plan_draft' && event.part.type === 'plan_draft' && part.draft.id === event.part.draft.id)
              ? event.part
              : part
          ))
          : [...prev, event.part])
      } else if (event.type === 'turn.started') {
        const submittedAt = submittedAtRef.current
        submittedAtRef.current = null
        setActiveTurn(event.turn)
        setTurnRunMeta({
          turnId: event.turn.id,
          startedAt: submittedAt ?? event.turn.createdAt,
          status: 'running',
        })
      } else if (event.type === 'turn.completed' || event.type === 'turn.failed') {
        setTurnRunMeta(prev => ({
          turnId: event.turnId,
          startedAt: prev?.turnId === event.turnId ? prev.startedAt : Date.now(),
          completedAt: Date.now(),
          status: event.type === 'turn.completed' ? 'completed' : 'failed',
        }))
        setActiveTurn(null)
      } else if (event.type === 'edit.proposed') {
        setProposals(prev => ({ ...prev, [event.proposal.id]: event.proposal }))
        if (event.proposal.state === 'applied') {
          props.onFileApplied?.(event.proposal.filePath, event.proposal.modifiedContent)
        }
      } else if (event.type === 'approval.requested') {
        setApprovals(prev => ({ ...prev, [event.request.id]: event.request }))
      } else if (event.type === 'approval.resolved') {
        setApprovals(prev => {
          const next = { ...prev }
          delete next[event.requestId]
          return next
        })
      } else if (event.type === 'trace.batch') {
        setTraceEvents(prev => [...prev, ...event.traceEvents])
      }
    })
    return unsubscribe
  }, [displaySessionId, props.onFileApplied, props.onSessionChange])

  useEffect(() => {
    let cancelled = false
    setParts([])
    setProposals({})
    setApprovals({})
    setAgentEvents([])
    setTraceEvents([])
    setIsTraceOpen(false)
    setActiveTurn(null)
    setTurnRunMeta(null)
    setError(null)
    setDraft('')
    setComposerMode(null)
    if (!displaySessionId) return () => {
      cancelled = true
    }
    if (!persistHistory) return () => {
      cancelled = true
    }
    window.rille.agentResumeSession(displaySessionId)
      .then(resumed => {
        if (!cancelled) props.onSessionChange(resumed)
      })
      .catch(createError => {
        if (!cancelled) setError(createError instanceof Error ? createError.message : 'Agent 会话创建失败。')
      })
    return () => {
      cancelled = true
    }
  }, [displaySessionId, persistHistory, props.onSessionChange])

  const refreshModels = useCallback(async () => {
    setModelStore(await window.rille.agentListModelProfiles())
  }, [])

  useEffect(() => {
    void refreshModels()
  }, [refreshModels])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [parts.length, activeTurn])

  useEffect(() => {
    if (!openComposeMenu) return
    const closeMenu = (event: PointerEvent) => {
      if (!composeRef.current?.contains(event.target as Node)) {
        setOpenComposeMenu(null)
      }
    }
    window.addEventListener('pointerdown', closeMenu)
    return () => window.removeEventListener('pointerdown', closeMenu)
  }, [openComposeMenu])


  const pendingProposals = useMemo(() => Object.values(proposals).filter(proposal => proposal.state === 'pending'), [proposals])
  const selectedMode = session?.permissionMode ?? 'default'
  const selectedModeLabel = permissionModes.find(mode => mode.value === selectedMode)?.label ?? selectedMode
  const modelProfiles = modelStore?.profiles ?? []
  const activeModelProfile = modelProfiles.find(profile => profile.id === modelStore?.activeProfileId) ?? modelProfiles[0]
  const activeModelLabel = activeModelProfile
    ? shortModelLabel(activeModelProfile.model)
    : '模型'
  const isRunning = session?.status === 'running' || Boolean(activeTurn)
  const showSlashMenu = allowSlashActions && !composerMode && shouldShowSlashActions(draft)

  const runCompact = useCallback(async () => {
    if (!session) return
    try {
      setDraft('')
      setError(null)
      await window.rille.agentCompactContext(session.id, activeTurn?.id, 'manual slash action')
    } catch (compactError) {
      setError(compactError instanceof Error ? compactError.message : '上下文压缩失败。')
    }
  }, [activeTurn, session])

  const selectSlashAction = useCallback((id: SlashActionId) => {
    if (id === 'chat') {
      setComposerMode('chat')
      setDraft('')
      return
    }
    if (id === 'plan') {
      setComposerMode('plan')
      setDraft('')
      return
    }
    if (id === 'compact') {
      void runCompact()
      return
    }
    props.onOpenBtw?.()
    setDraft('')
  }, [props.onOpenBtw, runCompact])

  const submit = useCallback(async () => {
    const text = expandComposerDraft(draft.trim(), { activeFile: props.activeFile, cursor: props.cursor })
    if (!text || !session || isRunning) return
    try {
      const latestConfig = await window.rille.agentGetConfig()
      if (!latestConfig.apiKeyConfigured) {
        setError('请先点击顶部设置配置 Agent 模型和 API Key。Ollama 可不填 API Key。')
        return
      }
      const mode: AgentTurnMode = props.forceTurnMode ?? composerMode ?? 'agent'
      if (!submitSessionId) return
      if (submitSessionId !== session.id) await window.rille.agentResumeSession(submitSessionId)
      submittedAtRef.current = Date.now()
      setDraft('')
      setComposerMode(null)
      setError(null)
      await window.rille.agentSubmitTurn(submitSessionId, text, toContextSnapshot(props), { mode, transientSessionId: props.transientSessionId ?? undefined })
    } catch (submitError) {
      submittedAtRef.current = null
      setError(submitError instanceof Error ? submitError.message : '提交失败。')
    }
  }, [composerMode, draft, isRunning, props, session, submitSessionId])

  const interrupt = useCallback(async () => {
    if (!session || !activeTurn) return
    await window.rille.agentInterruptTurn(session.id, activeTurn.id)
  }, [activeTurn, session])

  const updateMode = useCallback(async (mode: AgentPermissionMode) => {
    if (!session) return
    const updated = await window.rille.agentUpdatePermission(session.id, mode)
    if (updated) props.onSessionChange(updated)
  }, [props.onSessionChange, session])

  const selectModelProfile = useCallback(async (profileId: string) => {
    if (!profileId) return
    try {
      await window.rille.agentSelectModelProfile(profileId)
      await refreshModels()
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : '模型切换失败。')
    }
  }, [refreshModels])

  const respondApproval = useCallback(async (request: ApprovalRequest, action: ApprovalAction, reason?: string) => {
    await window.rille.agentRespondApproval(
      request.id,
      action === 'allow_once'
        ? { action: 'allow_once' }
        : action === 'always_allow'
          ? { action: 'always_allow', pattern: request.target || request.reason }
          : action === 'allow_workspace'
            ? { action: 'allow_workspace', pattern: request.target || request.reason }
            : { action: 'deny', reason: reason?.trim() || '用户拒绝。' },
    )
    setApprovals(prev => {
      const next = { ...prev }
      delete next[request.id]
      return next
    })
  }, [])

  const respondProposal = useCallback(async (proposal: EditProposal, action: EditProposalAction, reason?: string) => {
    if (!session) return
    if (action === 'apply_one') {
      const updated = await window.rille.agentApplyEdit(session.id, proposal.id, toContextSnapshot(props))
      setProposals(prev => ({ ...prev, [updated.id]: updated }))
      if (updated.state === 'applied') props.onFileApplied?.(updated.filePath, updated.modifiedContent)
      return
    }
    if (action === 'apply_all') {
      for (const item of pendingProposals) {
        const updated = await window.rille.agentApplyEdit(session.id, item.id, toContextSnapshot(props))
        setProposals(prev => ({ ...prev, [updated.id]: updated }))
        if (updated.state === 'applied') props.onFileApplied?.(updated.filePath, updated.modifiedContent)
      }
      return
    }
    const updated = await window.rille.agentRejectEdit(session.id, proposal.id, reason?.trim() || '用户拒绝。')
    if (updated && 'filePath' in updated) {
      setProposals(prev => ({ ...prev, [updated.id]: updated }))
    }
  }, [pendingProposals, props, session])

  return (
    <aside className="agent-panel" aria-label="Vibe Coding">
      {isTraceOpen && (
        <div className="agent-trace-debug">
          <div className="agent-trace-debug-header">
            <strong>Trace debug</strong>
            <button type="button" onClick={() => setIsTraceOpen(false)}>Close</button>
          </div>
          <div className="agent-trace-list">
            {traceEvents.slice(-20).map((event, index) => (
              <div className="agent-trace-row" key={`${event.type}-${event.createdAt}-${index}`}>
                <span>{event.type}</span>
                <small>{event.type === 'hook.invoked' ? `${event.hook.name} · ${event.hook.status}` : new Date(event.createdAt).toLocaleTimeString()}</small>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="agent-thread" ref={threadRef}>
        {parts.length === 0 ? (
          <div className="agent-empty-state" aria-hidden="true" />
        ) : (
          <ChatTurnView parts={parts} activeTurn={activeTurn} traceEvents={traceEvents} runMeta={turnRunMeta} sessionId={session?.id} context={toContextSnapshot(props)} />
        )}
        {error && <div className="agent-error">{error}</div>}
      </div>

      <form
        className="agent-compose"
        ref={composeRef}
        onSubmit={(event) => {
          event.preventDefault()
          if (showSlashMenu) {
            selectSlashAction(slashActions[slashIndex]?.id ?? 'chat')
            return
          }
          void submit()
        }}
      >
        {Object.values(approvals).map(request => (
          <ApprovalPopover key={request.id} request={request} onDecision={respondApproval} />
        ))}
        {pendingProposals.length > 0 && Object.keys(approvals).length === 0 && (
          <EditProposalPopover proposals={pendingProposals} onDecision={respondProposal} />
        )}
        {showSlashMenu && (
          <SlashActionPopover
            selectedIndex={slashIndex}
            onSelect={selectSlashAction}
          />
        )}
        <div className="agent-compose-input-row">
          {composerMode && (
            <span className={'agent-compose-chip ' + composerMode} aria-label={composerMode === 'plan' ? '计划模式' : '聊天模式'}>
              {composerMode === 'plan' ? <ListChecks size={14} /> : <MessageCircle size={14} />}
              {composerMode === 'plan' ? '计划' : '聊天'}
            </span>
          )}
          <textarea
            value={draft}
            rows={2}
            placeholder=""
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (showSlashMenu && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault()
                setSlashIndex(index => slashActionAt(index, event.key === 'ArrowDown' ? 1 : -1))
                return
              }
              if (showSlashMenu && event.key === 'Enter') {
                event.preventDefault()
                selectSlashAction(slashActions[slashIndex]?.id ?? 'chat')
                return
              }
              if (event.key === 'Backspace' && composerMode && !draft && event.currentTarget.selectionStart === 0) {
                event.preventDefault()
                setComposerMode(null)
                return
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
          />
        </div>
        <div className="agent-compose-actions">
          {showPermissionMenu && <div className="agent-compose-menu-wrap mode-menu">
            <button
              type="button"
              className="agent-compose-menu-trigger"
              aria-label="Agent 模式"
              aria-expanded={openComposeMenu === 'mode'}
              disabled={!session || isRunning}
              onClick={() => setOpenComposeMenu(openComposeMenu === 'mode' ? null : 'mode')}
            >
              <span>{selectedModeLabel}</span>
              <ChevronDown size={14} />
            </button>
            {openComposeMenu === 'mode' && (
              <div className="agent-compose-menu mode" role="menu">
                <div className="agent-compose-menu-label">权限</div>
                {permissionModes.map(mode => (
                  <button
                    type="button"
                    key={mode.value}
                    className={mode.value === selectedMode ? 'selected' : ''}
                    role="menuitemradio"
                    aria-checked={mode.value === selectedMode}
                    onClick={() => {
                      setOpenComposeMenu(null)
                      void updateMode(mode.value)
                    }}
                  >
                    <div>
                      <span>{mode.label}</span>
                      <small>{mode.desc}</small>
                    </div>
                    {mode.value === selectedMode && <Check size={16} />}
                  </button>
                ))}
              </div>
            )}
          </div>}
          <div className="agent-compose-menu-wrap model-menu">
            <button
              type="button"
              className="agent-compose-menu-trigger agent-model-trigger"
              aria-label="选择模型"
              aria-expanded={openComposeMenu === 'model'}
              disabled={!modelStore || modelProfiles.length === 0}
              onMouseDown={() => void refreshModels()}
              onClick={() => setOpenComposeMenu(openComposeMenu === 'model' ? null : 'model')}
            >
              <span>{activeModelLabel}</span>
              <ChevronDown size={14} />
            </button>
            {openComposeMenu === 'model' && (
              <div className="agent-compose-menu model" role="menu">
                <div className="agent-compose-menu-label">模型</div>
                {modelProfiles.map(profile => {
                  const label = shortModelLabel(profile.model)
                  const selected = profile.id === modelStore?.activeProfileId
                  return (
                    <button
                      type="button"
                      key={profile.id}
                      className={selected ? 'selected' : ''}
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => {
                        setOpenComposeMenu(null)
                        void selectModelProfile(profile.id)
                      }}
                    >
                      <span>{label}</span>
                      {selected && <Check size={16} />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {persistHistory && session?.status === 'running' && activeTurn ? (
            <button type="button" title="停止" aria-label="停止" onClick={() => void interrupt()}><Square size={14} /></button>
          ) : (
            <button type="submit" title="发送" aria-label="发送" disabled={!draft.trim() || !session || isRunning}><ArrowUp size={16} /></button>
          )}
        </div>
      </form>
    </aside>
  )
}
