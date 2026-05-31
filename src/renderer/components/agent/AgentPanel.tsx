import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Check,
  ChevronDown,
  Square,
} from 'lucide-react'
import type {
  AgentContextSnapshot,
  AgentEvent,
  AgentModelStoreSnapshot,
  AgentPermissionMode,
  AgentSession,
  AgentTurn,
  ApprovalRequest,
  EditProposal,
  MessagePart,
  TraceEvent,
} from '../../../shared/agent/protocol'
import type { OpenFile } from '../../App'
import type { EditorDiagnostic } from '../Editor'
import { expandComposerDraft } from './workbenchState'
import {
  fileNameFromPath,
  ProposalReview,
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
  onSessionChange: (session: AgentSession | null) => void
  onFileApplied?: (filePath: string, content: string) => void
}

const permissionModes: Array<{ value: AgentPermissionMode; label: string; desc: string }> = [
  { value: 'ask', label: 'Ask', desc: '写入前询问' },
  { value: 'plan', label: 'Plan', desc: '仅读取与规划' },
  { value: 'accept_edits', label: 'Auto-Apply', desc: '自动应用编辑，命令需确认' },
  { value: 'auto', label: 'Auto', desc: '自动执行，命令需确认' },
  { value: 'bypass', label: 'Bypass', desc: '完全自主，不询问' },
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

function approvalRequestTitle(request: ApprovalRequest): string {
  const target = (request.target || '').trim()
  if (target) return `模型请求执行指令 ${target}`
  const reason = request.reason.trim()
  const title = request.title.toLowerCase()
  if (title.includes('edit') || title.includes('write') || title.includes('proposal') || /propose_file_edit|apply_file_edit/.test(reason)) {
    return `模型请求编辑 ${fileNameFromPath(reason) || reason || '文件'}`
  }
  return reason ? `模型请求 ${reason}` : `模型请求 ${request.title}`
}

function ApprovalPopover({ request, onDecision }: {
  request: ApprovalRequest
  onDecision: (request: ApprovalRequest, action: ApprovalAction, reason?: string) => void
}) {
  const [entered, setEntered] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [isGuiding, setIsGuiding] = useState(false)
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
        {isGuiding ? (
          <div className="approval-guide">
            <textarea
              value={guide}
              rows={2}
              autoFocus
              placeholder="告诉模型应该怎么改做..."
              onChange={event => setGuide(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && guide.trim()) {
                  decide('deny', guide.trim())
                }
              }}
            />
            <div className="approval-guide-actions">
              <button type="button" onClick={() => setIsGuiding(false)}>取消</button>
              <button type="button" disabled={!guide.trim()} onClick={() => decide('deny', guide.trim())}>发送给模型</button>
            </div>
          </div>
        ) : (
          <div className="approval-popover-actions">
            <button type="button" onClick={() => decide('allow_once')}>允许一次</button>
            {canWorkspace ? (
              <button type="button" onClick={() => decide('allow_workspace')}>该项目中允许</button>
            ) : canSession ? (
              <button type="button" onClick={() => decide('always_allow')}>本次会话允许</button>
            ) : null}
            <button type="button" onClick={() => decide('deny')}>拒绝</button>
            <button type="button" onClick={() => setIsGuiding(true)}>告诉模型怎么做</button>
          </div>
        )}
      </div>
    </div>
  )
}

export function AgentPanel(props: Props) {
  const [parts, setParts] = useState<MessagePart[]>([])
  const [proposals, setProposals] = useState<Record<string, EditProposal>>({})
  const [reviewProposal, setReviewProposal] = useState<EditProposal | null>(null)
  const [approvals, setApprovals] = useState<Record<string, ApprovalRequest>>({})
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([])
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([])
  const [isTraceOpen, setIsTraceOpen] = useState(false)
  const [modelStore, setModelStore] = useState<AgentModelStoreSnapshot | null>(null)
  const [draft, setDraft] = useState('')
  const [activeTurn, setActiveTurn] = useState<AgentTurn | null>(null)
  const [turnRunMeta, setTurnRunMeta] = useState<TurnRunMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openComposeMenu, setOpenComposeMenu] = useState<'mode' | 'model' | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const composeRef = useRef<HTMLFormElement | null>(null)
  const session = props.session

  useEffect(() => {
    const unsubscribe = window.rille.onAgentEvent((event: AgentEvent) => {
      if (event.type === 'session.created' || event.type === 'session.updated') {
        if (props.sessionId && event.session.id === props.sessionId) props.onSessionChange(event.session)
        return
      }
      if (!props.sessionId) return
      if ('sessionId' in event && event.sessionId !== props.sessionId) return
      setAgentEvents(prev => [...prev.slice(-120), event])
      if (event.type === 'message.part.created') {
        setParts(prev => prev.some(part => part.id === event.part.id)
          ? prev.map(part => part.id === event.part.id ? event.part : part)
          : [...prev, event.part])
      } else if (event.type === 'message.part.updated') {
        setParts(prev => prev.some(part => part.id === event.part.id)
          ? prev.map(part => part.id === event.part.id ? event.part : part)
          : [...prev, event.part])
      } else if (event.type === 'turn.started') {
        setActiveTurn(event.turn)
        setTurnRunMeta({
          turnId: event.turn.id,
          startedAt: event.turn.createdAt,
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
        if (event.proposal.state === 'pending') {
          setReviewProposal(event.proposal)
        } else {
          setReviewProposal(prev => prev?.id === event.proposal.id ? event.proposal : prev)
        }
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
  }, [props.onFileApplied, props.onSessionChange, props.sessionId])

  useEffect(() => {
    let cancelled = false
    setParts([])
    setProposals({})
    setApprovals({})
    setAgentEvents([])
    setTraceEvents([])
    setIsTraceOpen(false)
    setReviewProposal(null)
    setActiveTurn(null)
    setTurnRunMeta(null)
    setError(null)
    if (!props.sessionId) return () => {
      cancelled = true
    }
    window.rille.agentResumeSession(props.sessionId)
      .then(resumed => {
        if (!cancelled) props.onSessionChange(resumed)
      })
      .catch(createError => {
        if (!cancelled) setError(createError instanceof Error ? createError.message : 'Agent 会话创建失败。')
      })
    return () => {
      cancelled = true
    }
  }, [props.onSessionChange, props.sessionId])

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
  const selectedMode = session?.permissionMode ?? 'ask'
  const selectedModeLabel = permissionModes.find(mode => mode.value === selectedMode)?.label ?? selectedMode
  const modelProfiles = modelStore?.profiles ?? []
  const activeModelProfile = modelProfiles.find(profile => profile.id === modelStore?.activeProfileId) ?? modelProfiles[0]
  const activeModelLabel = activeModelProfile
    ? shortModelLabel(activeModelProfile.model)
    : '模型'

  const submit = useCallback(async () => {
    const text = expandComposerDraft(draft.trim(), { activeFile: props.activeFile, cursor: props.cursor })
    if (!text || !session || session.status === 'running') return
    try {
      const latestConfig = await window.rille.agentGetConfig()
      if (!latestConfig.apiKeyConfigured) {
        setError('请先点击顶部设置配置 Agent 模型和 API Key。Ollama 可不填 API Key。')
        return
      }
      setDraft('')
      setError(null)
      await window.rille.agentSubmitTurn(session.id, text, toContextSnapshot(props))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '提交失败。')
    }
  }, [draft, props, session])

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
          <ChatTurnView parts={parts} activeTurn={activeTurn} traceEvents={traceEvents} runMeta={turnRunMeta} />
        )}
        {error && <div className="agent-error">{error}</div>}
      </div>

      <form
        className="agent-compose"
        ref={composeRef}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {Object.values(approvals).map(request => (
          <ApprovalPopover key={request.id} request={request} onDecision={respondApproval} />
        ))}
        <textarea
          value={draft}
          rows={2}
          placeholder=""
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <div className="agent-compose-actions">
          <div className="agent-compose-menu-wrap mode-menu">
            <button
              type="button"
              className="agent-compose-menu-trigger"
              aria-label="Agent 模式"
              aria-expanded={openComposeMenu === 'mode'}
              disabled={!session || session.status === 'running'}
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
          </div>
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
          {session?.status === 'running' && activeTurn ? (
            <button type="button" title="停止" aria-label="停止" onClick={() => void interrupt()}><Square size={14} /></button>
          ) : (
            <button type="submit" title="发送" aria-label="发送" disabled={!draft.trim() || !session}><ArrowUp size={16} /></button>
          )}
        </div>
      </form>
      {reviewProposal && session && (
        <ProposalReview
          proposal={reviewProposal}
          sessionId={session.id}
          contextSnapshot={toContextSnapshot(props)}
          pendingProposals={pendingProposals}
          onClose={() => setReviewProposal(null)}
          onApplied={props.onFileApplied}
          onUpdated={proposal => {
            setProposals(prev => ({ ...prev, [proposal.id]: proposal }))
            setReviewProposal(proposal)
          }}
        />
      )}
    </aside>
  )
}
