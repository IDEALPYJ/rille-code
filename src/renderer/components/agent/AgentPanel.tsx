import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertCircle,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  FileText,
  ListChecks,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Square,
  Terminal,
  Wrench,
} from 'lucide-react'
import type {
  AgentContextSnapshot,
  AgentEvent,
  AgentModelStoreSnapshot,
  AgentPlanItem,
  AgentPermissionMode,
  AgentSession,
  AgentTurn,
  ApprovalRequest,
  EditProposal,
  MessagePart,
  TaskContract,
} from '../../../shared/agent/protocol'
import type { OpenFile } from '../../App'
import type { EditorDiagnostic } from '../Editor'

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

const permissionModes: Array<{ value: AgentPermissionMode; label: string }> = [
  { value: 'ask', label: 'Ask' },
  { value: 'plan', label: 'Plan' },
  { value: 'accept_edits', label: 'Execute' },
]

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath
}

function shortModelLabel(model?: string): string {
  const raw = (model || '模型').trim()
  const base = raw.split('/').pop() || raw
  const lower = base.toLowerCase()
  if (lower.includes('gpt-5.5')) return 'GPT-5.5'
  if (lower.includes('gpt-5')) return 'GPT-5'
  return base
}

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="agent-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={event => {
                event.preventDefault()
                if (href) void window.rille.openExternal(href)
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

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

function ToolPart({ part }: { part: Extract<MessagePart, { type: 'tool' }> }) {
  const isRunning = part.state === 'running'
  return (
    <div className={'agent-tool-card ' + part.state}>
      <div className="agent-tool-icon">
        {isRunning ? <Loader2 size={14} className="spin" /> : <Wrench size={14} />}
      </div>
      <div className="agent-tool-main">
        <div className="agent-tool-title">{part.call.title}</div>
        <div className="agent-tool-summary">{part.output?.output || part.call.summary}</div>
      </div>
    </div>
  )
}

function StagePart({ part }: { part: Extract<MessagePart, { type: 'stage' }> }) {
  const labels: Record<typeof part.stage, string> = {
    building_context: '构建上下文',
    calling_model: '调用模型',
    executing_tools: '执行工具',
    waiting_approval: '等待批准',
    applying_edit: '应用编辑',
    running_verification: '运行验证',
    compacting_context: '压缩上下文',
    completed: '完成',
    failed: '失败',
  }
  const busy = !['completed', 'failed'].includes(part.stage)
  return (
    <div className={'agent-stage-card stage-' + part.stage}>
      <div className="agent-tool-icon">{busy ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}</div>
      <div className="agent-tool-main">
        <div className="agent-tool-title">{labels[part.stage]}</div>
        {part.detail && <div className="agent-tool-summary">{part.detail}</div>}
      </div>
    </div>
  )
}

type ToolCategory = 'explore' | 'edit' | 'command' | 'diagnostic' | 'other'

function toolCategory(name: string): ToolCategory {
  if (name === 'read_diagnostics') return 'diagnostic'
  if (name.includes('edit') || name.includes('proposal')) return 'edit'
  if (name.includes('command')) return 'command'
  if (name === 'model_config') return 'other'
  if (name.includes('read') || name.includes('list') || name.includes('search') || name.includes('git') || name.includes('file')) return 'explore'
  return 'other'
}

function toolSummaryText(parts: Array<Extract<MessagePart, { type: 'tool' }>>): string {
  const latest = new Map<string, Extract<MessagePart, { type: 'tool' }>>()
  for (const part of parts) latest.set(part.call.id, part)
  const counts = { explore: 0, edit: 0, command: 0, diagnostic: 0, other: 0 }
  for (const part of latest.values()) counts[toolCategory(part.call.name)] += 1
  const labels: string[] = []
  if (counts.explore) labels.push(`已探索 ${counts.explore} 项`)
  if (counts.edit) labels.push(`已编辑 ${counts.edit} 项`)
  if (counts.command) labels.push(`已运行 ${counts.command} 个命令`)
  if (counts.diagnostic) labels.push(`已检查 ${counts.diagnostic} 次诊断`)
  if (counts.other) labels.push(`已处理 ${counts.other} 项`)
  return labels.join(' · ') || '已处理操作'
}

function toolResultBadges(part: Extract<MessagePart, { type: 'tool' }>): string[] {
  const result = part.output
  if (!result) return []
  const badges: string[] = []
  if (typeof result.exitCode !== 'undefined') badges.push(`退出 ${result.exitCode ?? '-'}`)
  if (result.durationMs) badges.push(`${Math.max(1, Math.round(result.durationMs / 1000))}s`)
  if (result.timedOut) badges.push('超时')
  if (result.truncated) badges.push('已截断')
  if (result.status === 'conflict') badges.push('冲突')
  if (result.status === 'denied') badges.push('已拒绝')
  return badges
}

function ToolGroupPart({
  groupId,
  parts,
  expanded,
  onToggle,
}: {
  groupId: string
  parts: Array<Extract<MessagePart, { type: 'tool' }>>
  expanded: boolean
  onToggle: (groupId: string) => void
}) {
  const latest = useMemo(() => {
    const map = new Map<string, Extract<MessagePart, { type: 'tool' }>>()
    for (const part of parts) {
      if (part.call.name !== 'model_config') map.set(part.call.id, part)
    }
    return Array.from(map.values())
  }, [parts])
  const visible = latest.length > 0 ? latest : parts
  const isRunning = visible.some(part => part.state === 'running' || part.state === 'waiting_approval')
  const failed = visible.some(part => part.state === 'failed' || part.output?.error)
  const duration = visible.reduce((max, part) => Math.max(max, part.output?.durationMs || ((part.call.completedAt && part.call.startedAt) ? part.call.completedAt - part.call.startedAt : 0)), 0)
  const primaryIcon = visible.some(part => toolCategory(part.call.name) === 'command')
    ? <Terminal size={14} />
    : visible.some(part => toolCategory(part.call.name) === 'edit')
      ? <Pencil size={14} />
      : <Search size={14} />

  return (
    <div className={'agent-tool-group ' + (expanded ? 'expanded ' : '') + (failed ? 'failed' : '')}>
      <button type="button" className="agent-tool-group-summary" onClick={() => onToggle(groupId)}>
        <span className="agent-tool-group-icon">
          {isRunning ? <Loader2 size={14} className="spin" /> : failed ? <AlertCircle size={14} /> : primaryIcon}
        </span>
        <span>{isRunning ? toolSummaryText(visible).replace(/^已/, '正在') : toolSummaryText(visible)}</span>
        {duration > 0 && <small>{Math.max(1, Math.round(duration / 1000))}s</small>}
        <ChevronDown size={14} className="agent-tool-group-chevron" />
      </button>
      {expanded && (
        <div className="agent-tool-group-details">
          {visible.map(part => (
            <div className="agent-tool-detail" key={part.call.id}>
              <div className="agent-tool-detail-title">
                {part.state === 'running' || part.state === 'waiting_approval'
                  ? <Loader2 size={13} className="spin" />
                  : part.output?.error ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />}
                <span>{part.call.title}</span>
                {toolResultBadges(part).length > 0 && (
                  <small>{toolResultBadges(part).join(' · ')}</small>
                )}
              </div>
              <pre>{JSON.stringify(part.call.input, null, 2)}</pre>
              {part.output?.output && <p>{part.output.output}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DiagnosticPart({ part }: { part: Extract<MessagePart, { type: 'diagnostic' }> }) {
  const errors = part.diagnostics.filter(item => item.severity === 'error').length
  const warnings = part.diagnostics.length - errors
  return (
    <div className="agent-diagnostic-card">
      <div className="agent-tool-icon"><Circle size={14} /></div>
      <div className="agent-tool-main">
        <div className="agent-tool-title">诊断快照</div>
        <div className="agent-tool-summary">{errors} 错误 · {warnings} 警告</div>
      </div>
    </div>
  )
}

function VerificationPart({ part }: { part: Extract<MessagePart, { type: 'verification' }> }) {
  const result = part.result
  const statusLabel: Record<typeof result.status, string> = {
    passed: '通过',
    failed: '失败',
    skipped: '跳过',
    partial: '部分',
    blocked: '阻塞',
    stale: '过期',
    waived: '豁免',
  }
  return (
    <div className={'agent-verification-card status-' + result.status}>
      <div className="agent-tool-icon">{result.status === 'passed' ? <CheckCircle2 size={14} /> : result.status === 'skipped' ? <ListChecks size={14} /> : <AlertCircle size={14} />}</div>
      <div className="agent-tool-main">
        <div className="agent-tool-title">验证{statusLabel[result.status]}</div>
        <div className="agent-tool-summary">
          {[result.command || result.verifier, result.exitCode !== undefined ? `退出 ${result.exitCode ?? '-'}` : '', result.durationMs ? `${Math.max(1, Math.round(result.durationMs / 1000))}s` : '', result.truncated ? '已截断' : ''].filter(Boolean).join(' · ')}
        </div>
        {result.output && <pre className="agent-verification-output">{result.output}</pre>}
      </div>
    </div>
  )
}

function EvidenceCoveragePart({ part }: { part: Extract<MessagePart, { type: 'evidence_coverage' }> }) {
  const counts = part.coverage.criteria.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1
    return acc
  }, {})
  return (
    <div className={'agent-verification-card status-' + (part.gate?.status || 'partial')}>
      <div className="agent-tool-icon">{part.gate?.nextAction === 'allow_final' ? <CheckCircle2 size={14} /> : <ListChecks size={14} />}</div>
      <div className="agent-tool-main">
        <div className="agent-tool-title">Evidence Coverage</div>
        <div className="agent-tool-summary">
          {Object.entries(counts).map(([status, count]) => `${status} ${count}`).join(' · ') || '无验收项'}{part.gate ? ` · ${part.gate.nextAction}` : ''}
        </div>
        {part.gate?.summary && <p>{part.gate.summary}</p>}
      </div>
    </div>
  )
}

function ReviewPart({ part }: { part: Extract<MessagePart, { type: 'review' }> }) {
  const blocking = part.result.findings.filter(item => item.blocking).length
  return (
    <div className={'agent-verification-card status-' + (blocking > 0 ? 'blocked' : 'passed')}>
      <div className="agent-tool-icon">{blocking > 0 ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}</div>
      <div className="agent-tool-main">
        <div className="agent-tool-title">Review {part.result.status}</div>
        <div className="agent-tool-summary">{part.result.summary}</div>
        {part.result.findings.length > 0 && (
          <div className="agent-approval-details">
            {part.result.findings.slice(0, 6).map(finding => (
              <span key={finding.id}>{finding.blocking ? 'blocking' : finding.severity}: {finding.title}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function riskText(risk: TaskContract['riskPoints'][number]['risk']): string {
  if (risk === 'critical') return '严重'
  if (risk === 'high') return '高'
  if (risk === 'medium') return '中'
  return '低'
}

function scopeText(scope: TaskContract['scope'][number]): string {
  const kindLabels: Record<typeof scope.kind, string> = {
    file: '文件',
    module: '模块',
    behavior: '行为',
    ui: '界面',
    test: '测试',
    doc: '文档',
    workspace: '工作区',
    unknown: '待确认',
  }
  return `${kindLabels[scope.kind]}: ${scope.value}`
}

function TaskContractPart({ part }: { part: Extract<MessagePart, { type: 'task_contract' }> }) {
  const contract = part.contract
  return (
    <div className="agent-contract-card">
      <div className="agent-contract-header">
        <ListChecks size={15} />
        <span>Task Contract</span>
        <small>{contract.status}</small>
      </div>
      <div className="agent-contract-goal">{contract.goal}</div>
      <div className="agent-contract-section">
        <strong>范围</strong>
        <div className="agent-contract-chips">
          {contract.scope.slice(0, 4).map((scope, index) => (
            <span key={`${scope.kind}-${scope.value}-${index}`}>{scopeText(scope)}</span>
          ))}
        </div>
      </div>
      <div className="agent-contract-section">
        <strong>验收</strong>
        <ul>
          {contract.acceptanceCriteria.map(item => (
            <li key={item.id}>{item.text}</li>
          ))}
        </ul>
      </div>
      {contract.riskPoints.length > 0 && (
        <div className="agent-contract-section">
          <strong>风险</strong>
          <div className="agent-contract-risks">
            {contract.riskPoints.slice(0, 3).map(item => (
              <span className={'risk-' + item.risk} key={item.id}>{riskText(item.risk)} · {item.text}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function planStatusLabel(status: AgentPlanItem['status']): string {
  if (status === 'in_progress') return '进行中'
  if (status === 'completed') return '完成'
  if (status === 'blocked') return '阻塞'
  if (status === 'skipped') return '跳过'
  return '待处理'
}

function PlanPart({ part }: { part: Extract<MessagePart, { type: 'plan' }> }) {
  return (
    <div className="agent-plan-card">
      <div className="agent-contract-header">
        <CheckCircle2 size={15} />
        <span>Plan</span>
        {part.reason && <small>{part.reason}</small>}
      </div>
      <ol className="agent-plan-list">
        {part.items.map(item => (
          <li className={'status-' + item.status} key={item.id}>
            <span className="agent-plan-status">
              {item.status === 'completed' ? <CheckCircle2 size={13} /> : item.status === 'blocked' ? <AlertCircle size={13} /> : <Circle size={13} />}
            </span>
            <div>
              <strong>{item.title}</strong>
              <small>{planStatusLabel(item.status)}{item.evidence ? ` · ${item.evidence}` : ''}</small>
              {item.description && <p>{item.description}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function EditResultPart({ part }: { part: Extract<MessagePart, { type: 'edit_result' }> }) {
  return (
    <div className={'agent-edit-result state-' + part.state}>
      <FileText size={13} />
      <div className="agent-diff-part-main">
        <span>{part.message}</span>
        <small>{part.filePath}</small>
      </div>
    </div>
  )
}

function languageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    html: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', xml: 'xml', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', sql: 'sql', sh: 'shell', bash: 'shell',
    svg: 'xml', graphql: 'graphql', gql: 'graphql',
  }
  return map[ext ?? ''] ?? 'plaintext'
}

function editStateLabel(state: EditProposal['state']): string {
  if (state === 'pending') return '待处理'
  if (state === 'applied') return '已应用'
  if (state === 'rejected') return '已拒绝'
  return '冲突'
}

function diffStats(originalContent: string, modifiedContent: string): { added: number; removed: number } {
  const originalLines = originalContent.split(/\r?\n/)
  const modifiedLines = modifiedContent.split(/\r?\n/)
  const originalSet = new Map<string, number>()
  const modifiedSet = new Map<string, number>()
  for (const line of originalLines) originalSet.set(line, (originalSet.get(line) || 0) + 1)
  for (const line of modifiedLines) modifiedSet.set(line, (modifiedSet.get(line) || 0) + 1)
  let removed = 0
  for (const [line, count] of originalSet) removed += Math.max(0, count - (modifiedSet.get(line) || 0))
  let added = 0
  for (const [line, count] of modifiedSet) added += Math.max(0, count - (originalSet.get(line) || 0))
  return { added, removed }
}

function DiffProposalPart({
  part,
  proposal,
  onOpen,
}: {
  part: Extract<MessagePart, { type: 'diff' }>
  proposal?: EditProposal
  onOpen: (proposal: EditProposal) => void
}) {
  const state = proposal?.state ?? part.state
  return (
    <div className={'agent-diff-part state-' + state}>
      <FileText size={13} />
      <div className="agent-diff-part-main">
        <span>{proposal?.title || part.title}</span>
        <small>{editStateLabel(state)}</small>
      </div>
      {proposal && (
        <button type="button" onClick={() => onOpen(proposal)}>查看</button>
      )}
    </div>
  )
}

function MessagePartView({
  part,
  proposals,
  onOpenProposal,
}: {
  part: MessagePart
  proposals: Record<string, EditProposal>
  onOpenProposal: (proposal: EditProposal) => void
}) {
  if (part.type === 'tool') return <ToolPart part={part} />
  if (part.type === 'stage') return <StagePart part={part} />
  if (part.type === 'task_contract') return <TaskContractPart part={part} />
  if (part.type === 'plan') return <PlanPart part={part} />
  if (part.type === 'diagnostic') return <DiagnosticPart part={part} />
  if (part.type === 'verification') return <VerificationPart part={part} />
  if (part.type === 'evidence_coverage') return <EvidenceCoveragePart part={part} />
  if (part.type === 'review') return <ReviewPart part={part} />
  if (part.type === 'edit_result') return <EditResultPart part={part} />
  if (part.type === 'file') {
    return (
      <div className="agent-file-part">
        <FileText size={13} />
        <span>{part.label || fileNameFromPath(part.filePath)}</span>
      </div>
    )
  }
  if (part.type === 'diff') {
    return <DiffProposalPart part={part} proposal={proposals[part.proposalId]} onOpen={onOpenProposal} />
  }
  if (part.type === 'reasoning') {
    return (
      <div className="agent-message assistant reasoning">
        <MarkdownMessage text={part.redacted ? '推理内容已隐藏。' : part.text} />
      </div>
    )
  }
  return (
    <div className={'agent-message ' + part.role}>
      <MarkdownMessage text={part.text} />
    </div>
  )
}

function ApprovalCard({
  request,
  onDecision,
}: {
  request: ApprovalRequest
  onDecision: (request: ApprovalRequest, action: 'allow_once' | 'always_allow' | 'deny') => void
}) {
  return (
    <div className={'agent-approval-card risk-' + request.risk}>
      <div className="agent-tool-icon"><Wrench size={14} /></div>
      <div className="agent-tool-main">
        <div className="agent-tool-title">{request.title}</div>
        <div className="agent-tool-summary">{request.target || request.reason}</div>
        {request.details && (
          <div className="agent-approval-details">
            {Object.entries(request.details).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => (
              <span key={key}>{key}: {String(value)}</span>
            ))}
          </div>
        )}
        <div className="agent-approval-actions">
          <button type="button" onClick={() => onDecision(request, 'allow_once')}>Allow once</button>
          {request.grantOptions?.includes('session') && (
            <button type="button" onClick={() => onDecision(request, 'always_allow')}>Allow session</button>
          )}
          <button type="button" onClick={() => onDecision(request, 'deny')}>Deny</button>
        </div>
      </div>
    </div>
  )
}

function ProposalReview({
  proposal,
  sessionId,
  contextSnapshot,
  pendingProposals,
  onClose,
  onApplied,
  onUpdated,
}: {
  proposal: EditProposal
  sessionId: string
  contextSnapshot: AgentContextSnapshot
  pendingProposals: EditProposal[]
  onClose: () => void
  onApplied?: (filePath: string, content: string) => void
  onUpdated: (proposal: EditProposal) => void
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const stats = useMemo(() => diffStats(proposal.originalContent, proposal.modifiedContent), [proposal.modifiedContent, proposal.originalContent])

  const applyProposal = useCallback(async (target: EditProposal) => {
    const updated = await window.rille.agentApplyEdit(sessionId, target.id, contextSnapshot)
    onUpdated(updated)
    if (updated.state === 'applied') onApplied?.(updated.filePath, updated.modifiedContent)
    return updated
  }, [contextSnapshot, onApplied, onUpdated, sessionId])

  const apply = useCallback(async () => {
    setIsBusy(true)
    setMessage(null)
    try {
      const updated = await applyProposal(proposal)
      if (updated.state === 'applied') {
        setMessage('已应用。')
      } else if (updated.state === 'conflicted') {
        setMessage('文件内容已变化，proposal 已标记为冲突，未覆盖当前文件。')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '应用失败。')
    } finally {
      setIsBusy(false)
    }
  }, [applyProposal, proposal])

  const applyAll = useCallback(async () => {
    setIsBusy(true)
    setMessage(null)
    try {
      let applied = 0
      let conflicted = 0
      for (const item of pendingProposals) {
        const updated = await applyProposal(item)
        if (updated.state === 'applied') applied += 1
        if (updated.state === 'conflicted') conflicted += 1
      }
      setMessage(`批量应用完成：${applied} 已应用，${conflicted} 冲突。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '批量应用失败。')
    } finally {
      setIsBusy(false)
    }
  }, [applyProposal, pendingProposals])

  const reject = useCallback(async () => {
    const reason = window.prompt('拒绝原因（会反馈给 Agent，可留空）：') || undefined
    setIsBusy(true)
    setMessage(null)
    try {
      const updated = await window.rille.agentRejectEdit(sessionId, proposal.id, reason)
      if (updated && 'filePath' in updated) {
        onUpdated(updated)
        setMessage(reason ? `已拒绝：${reason}` : '已拒绝。')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '拒绝失败。')
    } finally {
      setIsBusy(false)
    }
  }, [onUpdated, proposal.id, sessionId])

  const rollback = useCallback(async () => {
    setIsBusy(true)
    setMessage(null)
    try {
      const updated = await window.rille.agentRollbackEdit(sessionId, proposal.id)
      if (updated && 'filePath' in updated) {
        onUpdated(updated)
        setMessage('已创建回滚提案，请审查后应用。')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建回滚提案失败。')
    } finally {
      setIsBusy(false)
    }
  }, [onUpdated, proposal.id, sessionId])

  return (
    <div className="agent-diff-modal-overlay" role="presentation" onMouseDown={onClose}>
      <section className="agent-diff-modal" role="dialog" aria-modal="true" onMouseDown={event => event.stopPropagation()}>
        <header className="agent-diff-modal-header">
          <div>
            <strong>{proposal.title}</strong>
            <span>{proposal.filePath}</span>
          </div>
          <div className="agent-diff-modal-actions">
            <button type="button" onClick={() => void apply()} disabled={isBusy || proposal.state !== 'pending'}>Apply</button>
            <button type="button" onClick={() => void applyAll()} disabled={isBusy || pendingProposals.length === 0}>Apply all</button>
            <button type="button" onClick={() => void reject()} disabled={isBusy || proposal.state !== 'pending'}>Reject</button>
            <button type="button" onClick={() => void rollback()} disabled={isBusy || proposal.state !== 'applied'}><RotateCcw size={13} /> Rollback</button>
            <button type="button" onClick={onClose}>关闭</button>
          </div>
        </header>
        <div className="agent-diff-stats">
          <span>+{stats.added}</span>
          <span>-{stats.removed}</span>
          <span>{editStateLabel(proposal.state)}</span>
          {proposal.rollbackOf && <span>回滚 {proposal.rollbackOf}</span>}
        </div>
        {proposal.rationale && <div className="agent-diff-rationale">{proposal.rationale}</div>}
        {proposal.rejectedReason && <div className="agent-diff-rationale">拒绝原因：{proposal.rejectedReason}</div>}
        {message && <div className="agent-diff-review-message">{message}</div>}
        <div className="agent-diff-review-editor">
          <DiffEditor
            height="100%"
            language={languageFromPath(proposal.filePath)}
            original={proposal.originalContent}
            modified={proposal.modifiedContent}
            originalModelPath={`agent-proposal://original/${proposal.id}/${proposal.filePath}`}
            modifiedModelPath={`agent-proposal://modified/${proposal.id}/${proposal.filePath}`}
            theme="vs"
            options={{
              readOnly: true,
              originalEditable: false,
              renderSideBySide: true,
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace)",
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>
      </section>
    </div>
  )
}

export function AgentPanel(props: Props) {
  const [parts, setParts] = useState<MessagePart[]>([])
  const [proposals, setProposals] = useState<Record<string, EditProposal>>({})
  const [reviewProposal, setReviewProposal] = useState<EditProposal | null>(null)
  const [approvals, setApprovals] = useState<Record<string, ApprovalRequest>>({})
  const [latestContextSummary, setLatestContextSummary] = useState<Extract<AgentEvent, { type: 'context.built' }>['summary'] | null>(null)
  const [expandedToolGroups, setExpandedToolGroups] = useState<Record<string, boolean>>({})
  const [modelStore, setModelStore] = useState<AgentModelStoreSnapshot | null>(null)
  const [draft, setDraft] = useState('')
  const [activeTurn, setActiveTurn] = useState<AgentTurn | null>(null)
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
      } else if (event.type === 'turn.completed' || event.type === 'turn.failed') {
        setActiveTurn(null)
      } else if (event.type === 'edit.proposed') {
        setProposals(prev => ({ ...prev, [event.proposal.id]: event.proposal }))
        setReviewProposal(prev => prev?.id === event.proposal.id ? event.proposal : prev)
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
      } else if (event.type === 'context.built') {
        setLatestContextSummary(event.summary)
      }
    })
    return unsubscribe
  }, [props.onFileApplied, props.onSessionChange, props.sessionId])

  useEffect(() => {
    let cancelled = false
    setParts([])
    setProposals({})
    setApprovals({})
    setLatestContextSummary(null)
    setReviewProposal(null)
    setActiveTurn(null)
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

  const contextLine = useMemo(() => {
    const file = props.activeFile?.name ?? '无当前文件'
    const dirty = props.openFiles.filter(item => item.isDirty).length
    const contextTrace = latestContextSummary ? ` · ctx ${latestContextSummary.includedCount}/${latestContextSummary.fragmentCount}` : ''
    return `${props.workspace?.label ?? '未打开工作区'} · ${file} · ${dirty} dirty · ${props.diagnostics.length} diagnostics${contextTrace}`
  }, [latestContextSummary, props.activeFile?.name, props.diagnostics.length, props.openFiles, props.workspace?.label])

  const timelineItems = useMemo(() => {
    const toolGroups = new Map<string, Array<Extract<MessagePart, { type: 'tool' }>>>()
    for (const part of parts) {
      if (part.type !== 'tool' || part.call.name === 'model_config') continue
      const key = part.messageId
      toolGroups.set(key, [...(toolGroups.get(key) || []), part])
    }

    const emittedToolGroups = new Set<string>()
    const items: Array<
      | { type: 'part'; part: MessagePart }
      | { type: 'tool-group'; groupId: string; parts: Array<Extract<MessagePart, { type: 'tool' }>> }
    > = []

    for (const part of parts) {
      if (part.type === 'tool') {
        if (part.call.name === 'model_config') continue
        const groupId = part.messageId
        if (emittedToolGroups.has(groupId)) continue
        emittedToolGroups.add(groupId)
        items.push({ type: 'tool-group', groupId, parts: toolGroups.get(groupId) || [] })
        continue
      }
      items.push({ type: 'part', part })
    }
    return items
  }, [parts])

  const pendingProposals = useMemo(() => Object.values(proposals).filter(proposal => proposal.state === 'pending'), [proposals])
  const selectedMode = session?.permissionMode ?? 'ask'
  const selectedModeLabel = permissionModes.find(mode => mode.value === selectedMode)?.label ?? 'Ask'
  const modelProfiles = modelStore?.profiles ?? []
  const activeModelProfile = modelProfiles.find(profile => profile.id === modelStore?.activeProfileId) ?? modelProfiles[0]
  const activeModelLabel = activeModelProfile
    ? shortModelLabel(activeModelProfile.model)
    : '模型'
  const projectContextLabel = useMemo(() => {
    if (!props.workspace) return null
    const folder = props.workspace.label || fileNameFromPath(props.workspace.path)
    if (!props.gitMeta?.isRepo) return folder
    const gitLabel = [props.gitMeta.remoteName, props.gitMeta.branch].filter(Boolean).join(' · ')
    return gitLabel ? `${folder} · ${gitLabel}` : folder
  }, [props.gitMeta?.branch, props.gitMeta?.isRepo, props.gitMeta?.remoteName, props.workspace])

  const submit = useCallback(async () => {
    const text = draft.trim()
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

  const respondApproval = useCallback(async (request: ApprovalRequest, action: 'allow_once' | 'always_allow' | 'deny') => {
    await window.rille.agentRespondApproval(
      request.id,
      action === 'allow_once'
        ? { action: 'allow_once' }
        : action === 'always_allow'
          ? { action: 'always_allow', pattern: request.target || request.reason }
          : { action: 'deny', reason: '用户拒绝。' },
    )
    setApprovals(prev => {
      const next = { ...prev }
      delete next[request.id]
      return next
    })
  }, [])

  const toggleToolGroup = useCallback((groupId: string) => {
    setExpandedToolGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }))
  }, [])

  return (
    <aside className="agent-panel" aria-label="Vibe Coding">
      {projectContextLabel && (
        <div className="agent-project-context" title={projectContextLabel}>
          <span>{projectContextLabel}</span>
        </div>
      )}
      <div className="agent-context-bar">
        <div className="agent-context-line" title={contextLine}>{contextLine}</div>
      </div>

      <div className="agent-thread" ref={threadRef}>
        {parts.length === 0 ? (
          <div className="agent-empty-state" aria-hidden="true" />
        ) : (
          timelineItems.map(item => (
            item.type === 'tool-group' ? (
              <div className="agent-timeline-item tool-group" key={item.groupId}>
                <ToolGroupPart
                  groupId={item.groupId}
                  parts={item.parts}
                  expanded={Boolean(expandedToolGroups[item.groupId])}
                  onToggle={toggleToolGroup}
                />
              </div>
            ) : (
              <div className={'agent-timeline-item part-' + item.part.type} key={item.part.id}>
                <MessagePartView
                  part={item.part}
                  proposals={proposals}
                  onOpenProposal={setReviewProposal}
                />
              </div>
            )
          ))
        )}
        {error && <div className="agent-timeline-item"><div className="agent-error">{error}</div></div>}
        {Object.values(approvals).map(request => (
          <div className="agent-timeline-item approval" key={request.id}>
            <ApprovalCard request={request} onDecision={respondApproval} />
          </div>
        ))}
      </div>

      <form
        className="agent-compose"
        ref={composeRef}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
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
                    <span>{mode.label}</span>
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
