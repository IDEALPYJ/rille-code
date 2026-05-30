import { useCallback, useMemo, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Circle,
  FileText,
  ListChecks,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Terminal,
  Wrench,
  Zap,
} from 'lucide-react'
import type {
  AgentContextSnapshot,
  AgentPlanItem,
  AgentSession,
  ApprovalRequest,
  EditProposal,
  MessagePart,
  PlanConfirmation,
  TaskContract,
} from '../../../shared/agent/protocol'

// ── Utility functions ──

export function fileNameFromPath(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath
}

export function shortModelLabel(model?: string): string {
  const raw = (model || '模型').trim()
  const base = raw.split('/').pop() || raw
  const lower = base.toLowerCase()
  if (lower.includes('gpt-5.5')) return 'GPT-5.5'
  if (lower.includes('gpt-5')) return 'GPT-5'
  return base
}

export function MarkdownMessage({ text }: { text: string }) {
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

export function languageFromPath(filePath: string): string {
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

export function editStateLabel(state: EditProposal['state']): string {
  if (state === 'pending') return '待处理'
  if (state === 'applied') return '已应用'
  if (state === 'rejected') return '已拒绝'
  return '冲突'
}

export function diffStats(originalContent: string, modifiedContent: string): { added: number; removed: number } {
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

type ToolCategory = 'explore' | 'edit' | 'command' | 'diagnostic' | 'other'

export function toolCategory(name: string): ToolCategory {
  if (name === 'read_diagnostics') return 'diagnostic'
  if (name.includes('edit') || name.includes('proposal')) return 'edit'
  if (name.includes('command')) return 'command'
  if (name === 'model_config') return 'other'
  if (name.includes('read') || name.includes('list') || name.includes('search') || name.includes('git') || name.includes('file')) return 'explore'
  return 'other'
}

export function toolSummaryText(parts: Array<Extract<MessagePart, { type: 'tool' }>>): string {
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

export function toolResultBadges(part: Extract<MessagePart, { type: 'tool' }>): string[] {
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

function riskText(risk: TaskContract['riskPoints'][number]['risk']): string {
  if (risk === 'critical') return '严重'
  if (risk === 'high') return '高'
  if (risk === 'medium') return '中'
  return '低'
}

function scopeText(scope: TaskContract['scope'][number]): string {
  const kindLabels: Record<typeof scope.kind, string> = {
    file: '文件', module: '模块', behavior: '行为', ui: '界面',
    test: '测试', doc: '文档', workspace: '工作区', unknown: '待确认',
  }
  return `${kindLabels[scope.kind]}: ${scope.value}`
}

function planStatusLabel(status: AgentPlanItem['status']): string {
  if (status === 'in_progress') return '进行中'
  if (status === 'completed') return '完成'
  if (status === 'blocked') return '阻塞'
  if (status === 'skipped') return '跳过'
  return '待处理'
}

function planConfirmationLabel(status: PlanConfirmation['status']): string {
  if (status === 'confirmed') return '已确认'
  if (status === 'rejected') return '已拒绝'
  if (status === 'superseded') return '已替换'
  return '待确认'
}

// ── Card components ──

export function ToolPart({ part }: { part: Extract<MessagePart, { type: 'tool' }> }) {
  const isRunning = part.state === 'running'
  const [artifactText, setArtifactText] = useState<string | null>(null)
  const artifact = part.output?.artifact
  const openArtifact = useCallback(async () => {
    if (!artifact) return
    const payload = await window.rille.agentReadArtifact(artifact.sessionId, artifact.id)
    setArtifactText(payload.encoding === 'utf8' ? payload.content : `[binary artifact: ${payload.ref.sizeBytes} bytes]`)
  }, [artifact])
  return (
    <div className={'agent-tool-card ' + part.state}>
      <div className="agent-tool-icon">
        {isRunning ? <Loader2 size={14} className="spin" /> : <Wrench size={14} />}
      </div>
      <div className="agent-tool-main">
        <div className="agent-tool-title">{part.call.title}</div>
        <div className="agent-tool-summary">{part.output?.output || part.call.summary}</div>
        {artifact && (
          <button type="button" className="agent-inline-button" onClick={() => void openArtifact()}>
            展开 artifact
          </button>
        )}
        {artifactText !== null && <pre className="agent-artifact-preview">{artifactText}</pre>}
      </div>
    </div>
  )
}

export function StagePart({ part }: { part: Extract<MessagePart, { type: 'stage' }> }) {
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
      <div className="agent-tool-icon">{busy ? <Circle size={10} /> : <CheckCircle2 size={14} />}</div>
      <div className="agent-tool-main">
        <div className={'agent-tool-title' + (busy ? ' shimmer-text' : '')}>{labels[part.stage]}</div>
        {part.detail && <div className="agent-tool-summary">{part.detail}</div>}
      </div>
    </div>
  )
}

export function ToolGroupPart({
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

export function DiagnosticPart({ part }: { part: Extract<MessagePart, { type: 'diagnostic' }> }) {
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

export function VerificationPart({ part }: { part: Extract<MessagePart, { type: 'verification' }> }) {
  const result = part.result
  const statusLabel: Record<typeof result.status, string> = {
    passed: '通过', failed: '失败', skipped: '跳过', partial: '部分',
    blocked: '阻塞', stale: '过期', waived: '豁免',
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

export function EvidenceCoveragePart({ part, sessionId }: { part: Extract<MessagePart, { type: 'evidence_coverage' }>; sessionId?: string | null }) {
  const counts = part.coverage.criteria.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1
    return acc
  }, {})
  const addUserEvidence = async () => {
    if (!sessionId) return
    const summary = window.prompt('User evidence summary')
    if (!summary?.trim()) return
    const blocked = part.coverage.criteria.find(item => item.status !== 'covered' && item.status !== 'waived')
    await window.rille.agentAddUserEvidence(sessionId, { turnId: part.evidence[0]?.turnId, criterionId: blocked?.criterionId, summary: summary.trim(), status: 'passed' })
  }
  const waive = async () => {
    if (!sessionId) return
    const blocked = part.coverage.criteria.find(item => item.status !== 'covered' && item.status !== 'waived')
    if (!blocked) return
    const reason = window.prompt('Waiver reason')
    if (!reason?.trim()) return
    await window.rille.agentWaiveEvidence(sessionId, { turnId: part.evidence[0]?.turnId, criterionId: blocked.criterionId, evidenceIds: blocked.evidenceIds, reason: reason.trim(), scope: 'criterion' })
  }
  return (
    <div className={'agent-verification-card status-' + (part.gate?.status || 'partial')}>
      <div className="agent-tool-icon">{part.gate?.nextAction === 'allow_final' ? <CheckCircle2 size={14} /> : <ListChecks size={14} />}</div>
      <div className="agent-tool-main">
        <div className="agent-tool-title">Evidence Coverage</div>
        <div className="agent-tool-summary">
          {Object.entries(counts).map(([status, count]) => `${status} ${count}`).join(' · ') || '无验收项'}{part.gate ? ` · ${part.gate.nextAction}` : ''}
        </div>
        {part.gate?.summary && <p>{part.gate.summary}</p>}
        {sessionId && (
          <div className="agent-card-actions">
            <button type="button" onClick={addUserEvidence}>Add user evidence</button>
            <button type="button" onClick={waive}>Waive</button>
          </div>
        )}
      </div>
    </div>
  )
}

export function ReviewPart({ part, sessionId }: { part: Extract<MessagePart, { type: 'review' }>; sessionId?: string | null }) {
  const blocking = part.result.findings.filter(item => item.blocking).length
  const acceptRisk = async (findingId: string) => {
    if (!sessionId) return
    const reason = window.prompt('Accepted risk reason')
    if (!reason?.trim()) return
    await window.rille.agentAcceptReviewRisk(sessionId, findingId, reason.trim(), part.result.turnId)
  }
  const dismiss = async (findingId: string) => {
    if (!sessionId) return
    const reason = window.prompt('Dismiss reason')
    await window.rille.agentDismissReviewFinding(sessionId, findingId, reason?.trim() || undefined, part.result.turnId)
  }
  return (
    <div className={'agent-verification-card status-' + (blocking > 0 ? 'blocked' : 'passed')}>
      <div className="agent-tool-icon">{blocking > 0 ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}</div>
      <div className="agent-tool-main">
        <div className="agent-tool-title">Review {part.result.status}</div>
        <div className="agent-tool-summary">{part.result.summary}</div>
        {part.result.findings.length > 0 && (
          <div className="agent-approval-details">
            {part.result.findings.slice(0, 10).map(finding => (
              <span key={finding.id}>
                <span className={'agent-review-source-badge ' + (finding.source === 'llm' ? 'source-llm' : 'source-rule')}>
                  {finding.source === 'llm' ? 'AI' : 'Rule'}
                </span>
                {finding.status !== 'open' ? `${finding.status}: ` : finding.blocking ? 'blocking: ' : `${finding.severity}: `}{finding.title}
                {sessionId && finding.status === 'open' && (
                  <span className="agent-inline-actions">
                    <button type="button" onClick={() => acceptRisk(finding.id)}>Accept risk</button>
                    <button type="button" onClick={() => dismiss(finding.id)}>Dismiss</button>
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function TaskContractPart({ part }: { part: Extract<MessagePart, { type: 'task_contract' }> }) {
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

export function PlanPart({ part }: { part: Extract<MessagePart, { type: 'plan' }> }) {
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

function isPlanConfirmation(value: unknown): value is PlanConfirmation {
  return Boolean(value && typeof value === 'object' && 'contractId' in value && 'planItemIds' in value)
}

export function PlanConfirmationPart({
  part,
  sessionId,
  onResolved,
}: {
  part: Extract<MessagePart, { type: 'plan_confirmation' }>
  sessionId: string | null | undefined
  onResolved: (confirmation: PlanConfirmation) => void
}) {
  const confirmation = part.confirmation
  const disabled = !sessionId || confirmation.status !== 'pending'
  const confirm = useCallback(async () => {
    if (!sessionId) return
    const result = await window.rille.agentConfirmPlan(sessionId, confirmation.id)
    if (isPlanConfirmation(result)) onResolved(result)
  }, [confirmation.id, onResolved, sessionId])
  const reject = useCallback(async () => {
    if (!sessionId) return
    const reason = window.prompt('拒绝原因（可留空）：') || undefined
    const result = await window.rille.agentRejectPlan(sessionId, confirmation.id, reason)
    if (isPlanConfirmation(result)) onResolved(result)
  }, [confirmation.id, onResolved, sessionId])
  return (
    <div className={'agent-plan-confirmation status-' + confirmation.status}>
      <div className="agent-contract-header">
        <ListChecks size={15} />
        <span>Plan Confirmation</span>
        <small>{planConfirmationLabel(confirmation.status)} · {riskText(confirmation.riskLevel)}</small>
      </div>
      <p>{confirmation.reason}</p>
      {confirmation.rejectedReason && <small>拒绝原因：{confirmation.rejectedReason}</small>}
      <div className="agent-plan-confirmation-actions">
        <button type="button" disabled={disabled} onClick={() => void confirm()}>Confirm</button>
        <button type="button" disabled={disabled} onClick={() => void reject()}>Reject</button>
      </div>
    </div>
  )
}

export function EditResultPart({ part }: { part: Extract<MessagePart, { type: 'edit_result' }> }) {
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

export function DiffProposalPart({
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

export function MessagePartView({
  part,
  proposals,
  onOpenProposal,
  sessionId,
  onPlanConfirmationResolved,
}: {
  part: MessagePart
  proposals: Record<string, EditProposal>
  onOpenProposal: (proposal: EditProposal) => void
  sessionId?: string | null
  onPlanConfirmationResolved: (confirmation: PlanConfirmation) => void
}) {
  if (part.type === 'tool') return <ToolPart part={part} />
  if (part.type === 'stage') return <StagePart part={part} />
  if (part.type === 'task_contract') return <TaskContractPart part={part} />
  if (part.type === 'plan') return <PlanPart part={part} />
  if (part.type === 'plan_confirmation') return <PlanConfirmationPart part={part} sessionId={sessionId} onResolved={onPlanConfirmationResolved} />
  if (part.type === 'diagnostic') return <DiagnosticPart part={part} />
  if (part.type === 'verification') return <VerificationPart part={part} />
  if (part.type === 'evidence_coverage') return <EvidenceCoveragePart part={part} sessionId={sessionId} />
  if (part.type === 'review') return <ReviewPart part={part} sessionId={sessionId} />
  if (part.type === 'edit_result') return <EditResultPart part={part} />
  if (part.type === 'artifact') {
    return (
      <div className="agent-file-part">
        <FileText size={13} />
        <span>{part.label} · {Math.round(part.artifact.sizeBytes / 1024)} KB</span>
      </div>
    )
  }
  if (part.type === 'handoff') {
    return (
      <div className="agent-message assistant">
        <MarkdownMessage text={`## Handoff\n\n${part.handoff.summary}\n\n**下一步**: ${part.handoff.nextSteps.join(', ') || '无'}`} />
      </div>
    )
  }
  if (part.type === 'subagent') {
    const bits = [
      part.run.contract.permissionScope,
      part.run.executionMode,
      part.run.modelProfileId ? `model ${part.run.modelProfileId}` : undefined,
      part.run.fallbackMode ? `fallback ${part.run.fallbackMode}` : undefined,
      part.run.sandboxId ? `sandbox ${part.run.sandboxId}` : undefined,
      part.run.proposalIds?.length ? `${part.run.proposalIds.length} proposal${part.run.proposalIds.length === 1 ? '' : 's'}` : undefined,
      part.run.mergeStatus && part.run.mergeStatus !== 'not_applicable' ? `merge ${part.run.mergeStatus}` : undefined,
    ].filter(Boolean).join(' · ')
    return (
      <div className="agent-file-part">
        <Bot size={13} />
        <span>{part.run.role} subagent · {part.run.status}{bits ? ` · ${bits}` : ''}{part.result?.summary ? ` · ${part.result.summary}` : ''}</span>
      </div>
    )
  }
  if (part.type === 'automation_run') {
    return (
      <div className="agent-file-part">
        <Zap size={13} />
        <span>Automation · {part.run.status}{part.run.handoff?.summary ? ` · ${part.run.handoff.summary.slice(0, 100)}` : ''}</span>
      </div>
    )
  }
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

export function ApprovalCard({
  request,
  onDecision,
}: {
  request: ApprovalRequest
  onDecision: (request: ApprovalRequest, action: 'allow_once' | 'always_allow' | 'allow_workspace' | 'deny') => void
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
          {request.grantOptions?.includes('workspace') && (
            <button type="button" onClick={() => onDecision(request, 'allow_workspace')}>Allow workspace</button>
          )}
          <button type="button" onClick={() => onDecision(request, 'deny')}>Deny</button>
        </div>
      </div>
    </div>
  )
}

export function ProposalReview({
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
