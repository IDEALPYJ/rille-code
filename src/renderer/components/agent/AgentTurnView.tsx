import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Clock3, Loader2, Pencil, Search, Terminal, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AgentTurn, AgentUsage, MessagePart, TraceEvent } from '../../../shared/agent/protocol'
import { fileNameFromPath, MarkdownMessage, toolResultBadges } from './AgentPartCards'

// ── Chat item model ──

type ChatItem =
  | { type: 'user_text'; text: string }
  | { type: 'assistant_text'; text: string }
  | { type: 'handoff'; summary: string; nextSteps: string[] }

type ToolPart = Extract<MessagePart, { type: 'tool' }>

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

export interface ToolBatchStep {
  id: string
  type: 'tool_batch'
  parts: ToolPart[]
  running: boolean
  summary?: string
}

export interface ModelStep {
  id: string
  type: 'model'
  text?: string
  running: boolean
}

export type RunStep = ToolBatchStep | ModelStep

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

function isFinalStage(stage: string): boolean {
  return stage === 'completed' || stage === 'failed'
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

export function toolIconKind(name: string): OperationKind {
  return operationKind(name)
}

function toolIconForKind(kind: OperationKind): LucideIcon {
  if (kind === 'command') return Terminal
  if (kind === 'edit') return Pencil
  if (kind === 'read' || kind === 'search' || kind === 'diagnostic') return Search
  return Wrench
}

function toolIconForPart(part?: ToolPart): LucideIcon {
  return toolIconForKind(part ? operationKind(part.call.name) : 'other')
}

function operationVerb(kind: OperationKind, running: boolean): string {
  if (kind === 'read') return running ? '读取' : '读取'
  if (kind === 'search') return running ? '搜索' : '搜索'
  if (kind === 'command') return running ? '执行' : '执行'
  if (kind === 'edit') return running ? '编辑' : '编辑'
  if (kind === 'diagnostic') return running ? '读取诊断' : '检查诊断'
  return running ? '处理' : '处理'
}

export function summarizeOperations(parts: ToolPart[], running = false): string {
  const counts: Record<OperationKind, number> = { read: 0, search: 0, command: 0, edit: 0, diagnostic: 0, other: 0 }
  for (const part of latestToolParts(parts)) counts[operationKind(part.call.name)] += 1
  const prefix = running ? '正在' : '已'
  const labels: string[] = []
  if (counts.read) labels.push(`${prefix}读取 ${counts.read} 个文件`)
  if (counts.search) labels.push(`${prefix}搜索 ${counts.search} 次`)
  if (counts.command) labels.push(`${prefix}执行 ${counts.command} 条命令`)
  if (counts.edit) labels.push(`${prefix}编辑 ${counts.edit} 项`)
  if (counts.diagnostic) labels.push(`${prefix}检查 ${counts.diagnostic} 次诊断`)
  if (counts.other) labels.push(`${prefix}处理 ${counts.other} 项`)
  return labels.join(' · ') || `${prefix}处理操作`
}

function latestActiveOperation(parts: ToolPart[]): string | null {
  const latest = latestToolParts(parts)
    .sort((a, b) => (b.call.startedAt || b.createdAt) - (a.call.startedAt || a.createdAt))[0]
  if (!latest) return null
  const target = compactTarget(toolTarget(latest))
  const state = latest.state
  if (state === 'waiting_approval') return target ? `等待确认 ${target}` : '等待确认'
  const running = state === 'running'
  const prefix = running ? '正在' : '已'
  const verb = operationVerb(operationKind(latest.call.name), running)
  if (operationKind(latest.call.name) === 'diagnostic') return `${prefix}${verb}`
  return target ? `${prefix}${verb} ${target}` : `${prefix}${verb}`
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
    case 'command': return target ? `正在执行 ${target}` : '正在执行命令'
    case 'edit': return target ? `正在编辑 ${target}` : '正在编辑'
    case 'diagnostic': return '正在读取诊断'
    default: return target ? `正在处理 ${target}` : '正在处理操作'
  }
}

export function buildRunSteps(parts: MessagePart[], activeTurn?: AgentTurn | null): RunStep[] {
  const steps: RunStep[] = []
  const hasFutureTool = (index: number) => parts.slice(index + 1).some(part => part.type === 'tool' && part.call.name !== 'model_config')
  let currentToolBatch: ToolBatchStep | null = null
  let currentModelStep: ModelStep | null = null
  let pendingToolSummary: string | undefined

  function closeToolBatch() {
    currentToolBatch = null
  }

  function closeModelStep() {
    if (currentModelStep && !currentModelStep.text) currentModelStep.running = false
    currentModelStep = null
  }

  function ensureModelStep(part: MessagePart): ModelStep {
    closeToolBatch()
    if (!currentModelStep || currentModelStep.text) {
      currentModelStep = {
        id: `model_${part.messageId}_${steps.length}`,
        type: 'model',
        running: true,
      }
      steps.push(currentModelStep)
    } else {
      currentModelStep.running = true
    }
    return currentModelStep
  }

  function ensureToolBatch(part: MessagePart): ToolBatchStep {
    closeModelStep()
    if (!currentToolBatch) {
      currentToolBatch = {
        id: `tools_${part.messageId}_${steps.length}`,
        type: 'tool_batch',
        parts: [],
        running: false,
        summary: pendingToolSummary,
      }
      pendingToolSummary = undefined
      steps.push(currentToolBatch)
    }
    return currentToolBatch
  }

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part.type === 'stage') {
      if (isFinalStage(part.stage)) {
        closeToolBatch()
        closeModelStep()
        continue
      }
      if (part.stage === 'calling_model') {
        ensureModelStep(part)
        continue
      }
      if (part.stage === 'executing_tools' || part.stage === 'waiting_approval' || part.stage === 'applying_edit' || part.stage === 'running_verification') {
        closeToolBatch()
        closeModelStep()
        const detail = part.detail?.trim()
        pendingToolSummary = detail && !/^执行\s+\d+\s+个工具调用$/.test(detail) ? detail : undefined
      }
      continue
    }
    if (part.type === 'text' && part.role === 'assistant') {
      const text = stripVerificationSection(part.text)
      if (text.trim() && hasFutureTool(index)) {
        const modelStep = ensureModelStep(part)
        modelStep.text = text
        modelStep.running = false
      }
      continue
    }
    if (part.type === 'tool' && part.call.name !== 'model_config') {
      ensureToolBatch(part).parts.push(part)
    }
  }

  return steps
    .map(step => {
      if (step.type === 'model') {
        return {
          ...step,
          running: step.running && Boolean(activeTurn),
        }
      }
      const unique = latestToolParts(step.parts)
      const running = unique.some(part => part.state === 'running' || part.state === 'waiting_approval')
      return { ...step, parts: unique, running }
    })
    .filter(step => step.type === 'model' ? Boolean(step.text?.trim() || step.running) : step.parts.length > 0)
}

export function buildProcessGroups(parts: MessagePart[]): ToolBatchStep[] {
  return buildRunSteps(parts).filter((step): step is ToolBatchStep => step.type === 'tool_batch')
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

function estimateOutputTokens(parts: MessagePart[], usage: UsageSummary): number {
  if (usage.outputTokens > 0) return usage.outputTokens
  const streamedChars = parts
    .filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text' && part.role === 'assistant')
    .reduce((count, part) => count + part.text.length, 0)
  return Math.ceil(streamedChars / 4)
}

function useChatItems(parts: MessagePart[]): ChatItem[] {
  return useMemo(() => {
    const items: ChatItem[] = []
    const lastToolIndex = parts.reduce((latest, part, index) => part.type === 'tool' && part.call.name !== 'model_config' ? index : latest, -1)
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]
      if (part.type === 'text') {
        if (part.role === 'user') items.push({ type: 'user_text', text: part.text })
        if (part.role === 'assistant' && (lastToolIndex === -1 || index > lastToolIndex)) {
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
  if (!usage.inputTokens && !usage.outputTokens && !usage.cachedInputTokens && !usage.cacheWriteInputTokens) {
    return 'Input 0 · Output 0 · Cache 0'
  }
  const bits = [
    `Input ${formatNumber(usage.inputTokens)}`,
    `Output ${formatNumber(usage.outputTokens)}`,
    `Cache ${formatNumber(usage.cachedInputTokens + usage.cacheWriteInputTokens)}`,
  ]
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

function RunStepView({ step }: { step: RunStep }) {
  if (step.type === 'model') {
    return (
      <div className={'agent-run-step model' + (step.running ? ' running' : '')}>
        <div className="agent-run-step-line">
          {step.running && <Loader2 size={13} className="spin" />}
          {step.text ? (
            <div className="agent-run-step-markdown">
              <MarkdownMessage text={step.text} />
            </div>
          ) : (
            <span className="agent-run-step-text">思考中</span>
          )}
        </div>
      </div>
    )
  }
  return <ToolBatchStepView step={step} />
}

function ToolBatchStepView({ step }: { step: ToolBatchStep }) {
  const [expanded, setExpanded] = useState(false)
  const latest = latestRunningOperation(step.parts) || (step.running ? latestActiveOperation(step.parts) : null)
  const summary = latest || summarizeOperations(step.parts, false)
  const Icon = toolIconForPart(step.running
    ? latestToolParts(step.parts).filter(part => part.state === 'running' || part.state === 'waiting_approval').sort((a, b) => (b.call.startedAt || b.createdAt) - (a.call.startedAt || a.createdAt))[0]
    : step.parts[0])
  return (
    <div className={'agent-run-step tool-batch' + (step.running ? ' running' : '')}>
      <button
        type="button"
        className={'agent-run-step-line' + (expanded ? ' expanded' : '')}
        onClick={() => setExpanded(value => !value)}
      >
        <Icon size={13} />
        <span className="agent-run-step-text">{step.summary ? `${step.summary} · ${summary}` : summary}</span>
        <ChevronDown size={12} className="agent-process-chevron" />
      </button>
      {expanded && (
        <div className="agent-process-details">
          {step.parts.map(part => {
            const DetailIcon = toolIconForPart(part)
            return (
            <div key={part.call.id} className={'agent-process-detail state-' + part.state}>
              <DetailIcon size={12} />
              <span className="agent-process-detail-name">{toolCallLabel(part.call.name)}</span>
              <span className="agent-process-detail-target">{compactTarget(toolTarget(part)) || part.call.summary}</span>
              {part.output?.output && (
                <span className="agent-process-detail-output">
                  {part.output.output.length > 120 ? `${part.output.output.slice(0, 120)}...` : part.output.output}
                </span>
              )}
              {toolResultBadges(part).length > 0 && <small>{toolResultBadges(part).join(' · ')}</small>}
            </div>
          )})}
        </div>
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
  const isRunning = Boolean(activeTurn || runMeta?.status === 'running')
  const runSteps = useMemo(() => buildRunSteps(parts, activeTurn), [activeTurn, parts])
  const [processOpen, setProcessOpen] = useState(isRunning)
  const now = useNow(isRunning)
  const startedAt = runMeta?.startedAt || activeTurn?.createdAt || parts.find(part => part.type === 'text' && part.role === 'user')?.createdAt
  const completedAt = runMeta?.completedAt
  const elapsed = startedAt ? (completedAt || now) - startedAt : 0
  const usage = useMemo(() => aggregateUsage(traceEvents, runMeta?.turnId || activeTurn?.id), [activeTurn?.id, runMeta?.turnId, traceEvents])
  const liveUsage = useMemo(() => ({
    ...usage,
    outputTokens: Math.max(usage.outputTokens, isRunning ? estimateOutputTokens(parts, usage) : usage.outputTokens),
  }), [isRunning, parts, usage])

  useEffect(() => {
    setProcessOpen(isRunning)
  }, [isRunning, runMeta?.turnId])

  const userItems = items.filter(item => item.type === 'user_text')
  const finalItems = items.filter(item => item.type === 'assistant_text' || item.type === 'handoff')
  const showHeader = runSteps.length > 0 || Boolean(activeTurn || runMeta) || usage.inputTokens || usage.outputTokens

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
            <small>{formatUsageSummary(liveUsage)}</small>
            <ChevronDown size={13} />
          </button>
          {processOpen && (
            <div className="agent-process-log">
              {runSteps.map(step => <RunStepView key={step.id} step={step} />)}
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
