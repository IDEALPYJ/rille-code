import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, Clock3, Loader2 } from 'lucide-react'
import type { AgentTurn, AgentUsage, MessagePart, TraceEvent } from '../../../shared/agent/protocol'
import { fileNameFromPath, MarkdownMessage, toolResultBadges } from './AgentPartCards'

// ── Chat item model ──

type ChatItem =
  | { type: 'user_text'; text: string }
  | { type: 'assistant_text'; text: string }
  | { type: 'handoff'; summary: string; nextSteps: string[] }

type ToolPart = Extract<MessagePart, { type: 'tool' }>
type StagePart = Extract<MessagePart, { type: 'stage' }>

export interface TurnRunMeta {
  turnId?: string | null
  startedAt?: number
  completedAt?: number
  status?: AgentTurn['status']
}

export interface UsageSummary {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  costUsd: number
}

export interface ProcessGroup {
  id: string
  description: string
  stage?: StagePart['stage']
  parts: ToolPart[]
  running: boolean
}

export function stageDescription(stage: string, detail?: string): string | null {
  if (detail?.trim()) return detail.trim()
  switch (stage) {
    case 'building_context': return '我先整理上下文和当前状态。'
    case 'calling_model': return '我在思考接下来要做什么。'
    case 'executing_tools': return '接下来我会执行这批操作。'
    case 'waiting_approval': return '需要你确认后才能继续。'
    case 'applying_edit': return '我会应用已确认的编辑。'
    case 'running_verification': return '我会验证刚才的变更。'
    case 'compacting_context': return '我会整理并压缩当前上下文。'
    default: return null
  }
}

export function stripVerificationSection(text: string): string {
  // Strip "无法完成：..." failure summary
  const failRe = /\n*无法完成[：:]\s*[^\n]+/
  const failMatch = failRe.exec(text)
  if (failMatch) return text.slice(0, failMatch.index).trimEnd()

  // Strip "验收标准回执" section
  const marker = '\n\n验收标准回执'
  const idx = text.indexOf(marker)
  if (idx !== -1) return text.slice(0, idx).trimEnd()
  const altIdx = text.indexOf('\n验收标准回执')
  if (altIdx !== -1) return text.slice(0, altIdx).trimEnd()

  // Strip "任务...。N 项已验证" footer line
  const doneRe = /\n*任务(?:完成|结束（[^）]*）|被中断|中断)。\s*\d+\s*项已验证/
  const doneMatch = doneRe.exec(text)
  if (doneMatch) return text.slice(0, doneMatch.index).trimEnd()

  // Strip standalone "下一步: ..." line that follows verification content
  const nextRe = /\n*下一步[：:]\s*(按验收标准验证|汇报结果|确认修改范围|读取相关上下文)/
  const nextMatch = nextRe.exec(text)
  if (nextMatch) return text.slice(0, nextMatch.index).trimEnd()

  return text
}

export function toolCallLabel(name: string): string {
  const map: Record<string, string> = {
    read_file: '读取文件',
    write_file: '写入文件',
    search_code: '搜索代码',
    search_files: '搜索文件',
    list_files: '列出文件',
    run_command: '运行命令',
    read_diagnostics: '读取诊断',
    git_status: 'Git 状态',
    git_diff: 'Git 差异',
    git_log: 'Git 日志',
    edit_file: '编辑文件',
  }
  return map[name] || name
}

function latestToolParts(parts: ToolPart[]): ToolPart[] {
  const byCall = new Map<string, ToolPart>()
  for (const part of parts) {
    if (part.call.name !== 'model_config') byCall.set(part.call.id, part)
  }
  return [...byCall.values()]
}

function fieldString(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function toolTarget(part: ToolPart): string {
  const input = part.call.input
  if (part.call.name === 'run_command') return fieldString(input, ['commandLine', 'command'])
  return fieldString(input, ['path', 'filePath', 'query', 'pattern', 'proposalId']) || part.call.summary
}

function compactTarget(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.includes('/') || trimmed.includes('\\')) return fileNameFromPath(trimmed)
  return trimmed.length > 56 ? `${trimmed.slice(0, 53)}...` : trimmed
}

type OperationKind = 'read' | 'search' | 'command' | 'edit' | 'diagnostic' | 'other'

function operationKind(name: string): OperationKind {
  if (name === 'read_file') return 'read'
  if (name === 'read_diagnostics') return 'diagnostic'
  if (name === 'run_command') return 'command'
  if (name.includes('edit') || name.includes('proposal') || name === 'write_file') return 'edit'
  if (name.includes('search') || name.includes('list') || name.includes('git') || name === 'explore_codebase') return 'search'
  return 'other'
}

export function summarizeOperations(parts: ToolPart[], running = false): string {
  const counts: Record<OperationKind, number> = { read: 0, search: 0, command: 0, edit: 0, diagnostic: 0, other: 0 }
  for (const part of latestToolParts(parts)) counts[operationKind(part.call.name)] += 1
  const prefix = running ? '正在' : '已'
  const labels: string[] = []
  if (counts.read) labels.push(`${prefix}读取 ${counts.read} 个文件`)
  if (counts.search) labels.push(`${prefix}搜索 ${counts.search} 次`)
  if (counts.command) labels.push(`${prefix}运行 ${counts.command} 条命令`)
  if (counts.edit) labels.push(`${prefix}编辑 ${counts.edit} 项`)
  if (counts.diagnostic) labels.push(`${prefix}检查 ${counts.diagnostic} 次诊断`)
  if (counts.other) labels.push(`${prefix}处理 ${counts.other} 项`)
  return labels.join(' · ') || `${prefix}处理操作`
}

export function latestRunningOperation(parts: ToolPart[]): string | null {
  const running = latestToolParts(parts)
    .filter(part => part.state === 'running' || part.state === 'waiting_approval')
    .sort((a, b) => (b.call.startedAt || b.createdAt) - (a.call.startedAt || a.createdAt))[0]
  if (!running) return null
  const target = compactTarget(toolTarget(running))
  if (running.state === 'waiting_approval') return target ? `等待确认 ${target}` : '等待确认'
  switch (operationKind(running.call.name)) {
    case 'read': return target ? `正在读取 ${target}` : '正在读取文件'
    case 'search': return target ? `正在搜索 ${target}` : '正在搜索'
    case 'command': return target ? `正在运行 ${target}` : '正在运行命令'
    case 'edit': return target ? `正在编辑 ${target}` : '正在编辑'
    case 'diagnostic': return '正在读取诊断'
    default: return target ? `正在处理 ${target}` : '正在处理操作'
  }
}

export function buildProcessGroups(parts: MessagePart[]): ProcessGroup[] {
  const groups: ProcessGroup[] = []
  let current: ProcessGroup | null = null
  for (const part of parts) {
    if (part.type === 'stage') {
      if (part.stage === 'completed' || part.stage === 'failed') continue
      const description = stageDescription(part.stage, part.detail)
      if (!description) continue
      current = {
        id: part.id,
        description,
        stage: part.stage,
        parts: [],
        running: false,
      }
      groups.push(current)
      continue
    }
    if (part.type === 'tool' && part.call.name !== 'model_config') {
      if (!current) {
        current = {
          id: `group_${part.messageId}_${groups.length}`,
          description: '接下来我会执行这批操作。',
          parts: [],
          running: false,
        }
        groups.push(current)
      }
      current.parts.push(part)
    }
  }
  return groups
    .map(group => {
      const unique = latestToolParts(group.parts)
      return {
        ...group,
        parts: unique,
        running: unique.some(part => part.state === 'running' || part.state === 'waiting_approval'),
      }
    })
    .filter(group => group.description || group.parts.length > 0)
}

export function aggregateUsage(traceEvents: TraceEvent[], turnId?: string | null): UsageSummary {
  const relevant = traceEvents.filter(event => !turnId || ('turnId' in event && event.turnId === turnId))
  const usageEvents = relevant
    .filter((event): event is Extract<TraceEvent, { type: 'cost.updated' }> => event.type === 'cost.updated')
    .map(event => event.usage)
  const usages: AgentUsage[] = usageEvents.length > 0
    ? usageEvents
    : relevant
      .filter((event): event is Extract<TraceEvent, { type: 'model.called' }> => event.type === 'model.called' && Boolean(event.usage))
      .map(event => event.usage as AgentUsage)
  return usages.reduce<UsageSummary>((acc, usage) => ({
    inputTokens: acc.inputTokens + (usage.inputTokens || 0),
    outputTokens: acc.outputTokens + (usage.outputTokens || 0),
    cachedInputTokens: acc.cachedInputTokens + (usage.cachedInputTokens || 0),
    cacheWriteInputTokens: acc.cacheWriteInputTokens + (usage.cacheWriteInputTokens || 0),
    costUsd: acc.costUsd + (usage.costUsd || 0),
  }), { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, costUsd: 0 })
}

function useChatItems(parts: MessagePart[]): ChatItem[] {
  return useMemo(() => {
    const items: ChatItem[] = []
    for (const part of parts) {
      if (part.type === 'text') {
        if (part.role === 'user') items.push({ type: 'user_text', text: part.text })
        if (part.role === 'assistant') {
          const text = stripVerificationSection(part.text)
          if (text.trim()) items.push({ type: 'assistant_text', text })
        }
      }
      if (part.type === 'handoff') {
        const filtered = stripVerificationSection(part.handoff.summary)
        if (filtered) items.push({ type: 'handoff', summary: filtered, nextSteps: part.handoff.nextSteps })
      }
    }
    return items
  }, [parts])
}

// ── Tool summary expandable line ──

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(Math.round(value))
}

export function formatUsageSummary(usage: UsageSummary): string {
  const total = usage.inputTokens + usage.outputTokens
  if (!total && !usage.cachedInputTokens && !usage.cacheWriteInputTokens) return 'Token 0'
  const bits = [`Token ${formatNumber(total)}`]
  if (usage.cachedInputTokens) bits.push(`缓存 ${formatNumber(usage.cachedInputTokens)}`)
  if (usage.costUsd) bits.push(`$${usage.costUsd.toFixed(4)}`)
  return bits.join(' · ')
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes > 0) return `${minutes}m ${rest}s`
  return `${rest}s`
}

function ProcessGroupView({ group }: { group: ProcessGroup }) {
  const [expanded, setExpanded] = useState(false)
  const latest = latestRunningOperation(group.parts)
  const summary = latest || summarizeOperations(group.parts, false)
  return (
    <div className={'agent-process-group' + (group.running ? ' running' : '')}>
      <div className="agent-process-description">{group.description}</div>
      {group.parts.length > 0 && (
        <>
          <button
            type="button"
            className={'agent-process-summary' + (expanded ? ' expanded' : '')}
            onClick={() => setExpanded(value => !value)}
          >
            {group.running ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />}
            <span>{summary}</span>
            <ChevronDown size={12} className="agent-process-chevron" />
          </button>
          {expanded && (
            <div className="agent-process-details">
              {group.parts.map(part => (
                <div key={part.call.id} className="agent-process-detail">
                  <span className="agent-process-detail-name">{toolCallLabel(part.call.name)}</span>
                  <span className="agent-process-detail-target">{compactTarget(toolTarget(part)) || part.call.summary}</span>
                  {toolResultBadges(part).length > 0 && <small>{toolResultBadges(part).join(' · ')}</small>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function useNow(enabled: boolean): number {
  const [value, setValue] = useState(Date.now())
  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => setValue(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [enabled])
  return value
}

// ── View ──

export function ChatTurnView({
  parts,
  activeTurn,
  traceEvents = [],
  runMeta,
}: {
  parts: MessagePart[]
  activeTurn?: AgentTurn | null
  traceEvents?: TraceEvent[]
  runMeta?: TurnRunMeta | null
}) {
  const items = useChatItems(parts)
  const groups = useMemo(() => buildProcessGroups(parts), [parts])
  const isRunning = Boolean(activeTurn || runMeta?.status === 'running')
  const [processOpen, setProcessOpen] = useState(isRunning)
  const now = useNow(isRunning)
  const startedAt = runMeta?.startedAt || activeTurn?.createdAt || parts.find(part => part.type === 'text' && part.role === 'user')?.createdAt
  const completedAt = runMeta?.completedAt
  const elapsed = startedAt ? (completedAt || now) - startedAt : 0
  const usage = useMemo(() => aggregateUsage(traceEvents, runMeta?.turnId || activeTurn?.id), [activeTurn?.id, runMeta?.turnId, traceEvents])

  useEffect(() => {
    setProcessOpen(isRunning)
  }, [isRunning, runMeta?.turnId])

  const finalStartIndex = Math.max(0, items.findIndex(item => item.type === 'assistant_text' || item.type === 'handoff'))
  const userItems = items.filter(item => item.type === 'user_text')
  const finalItems = finalStartIndex === 0
    ? items.filter(item => item.type === 'assistant_text' || item.type === 'handoff')
    : items.slice(finalStartIndex).filter(item => item.type === 'assistant_text' || item.type === 'handoff')
  const showHeader = groups.length > 0 || Boolean(activeTurn || runMeta) || usage.inputTokens || usage.outputTokens

  return (
    <div className="agent-turn-view">
      {userItems.map((item, i) => (
        <div key={`user-${i}`} className="agent-message user">
          <MarkdownMessage text={item.text} />
        </div>
      ))}
      {showHeader && (
        <div className="agent-run-block">
          <button
            type="button"
            className={'agent-run-header' + (processOpen ? ' expanded' : '')}
            onClick={() => setProcessOpen(value => !value)}
          >
            <Clock3 size={13} />
            <span>已处理 {formatElapsed(elapsed)}</span>
            <small>{formatUsageSummary(usage)}</small>
            <ChevronDown size={13} />
          </button>
          {processOpen && (
            <div className="agent-process-log">
              {groups.map(group => <ProcessGroupView key={group.id} group={group} />)}
            </div>
          )}
        </div>
      )}
      {finalItems.map((item, i) => {
        if (item.type === 'assistant_text') {
          return (
            <div key={`assistant-${i}`} className="agent-message assistant">
              <MarkdownMessage text={item.text} />
            </div>
          )
        }
        if (item.type === 'handoff') {
          return (
            <div key={`handoff-${i}`} className="agent-message assistant">
              <p>{item.summary}</p>
              {item.nextSteps.length > 0 && (
                <p className="agent-handoff-next">
                  <strong>下一步:</strong> {item.nextSteps.join(' · ')}
                </p>
              )}
            </div>
          )
        }
        return null
      })}
    </div>
  )
}
