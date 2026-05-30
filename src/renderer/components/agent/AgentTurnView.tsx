import { useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown } from 'lucide-react'
import type { AgentTurn, MessagePart } from '../../../shared/agent/protocol'
import { MarkdownMessage, toolSummaryText } from './AgentPartCards'

// ── Chat item model ──

type ChatItem =
  | { type: 'stage_status'; stage: string; label: string; completed: boolean }
  | { type: 'user_text'; text: string }
  | { type: 'assistant_text'; text: string }
  | { type: 'tool_summary'; parts: Array<Extract<MessagePart, { type: 'tool' }>> }
  | { type: 'handoff'; summary: string; nextSteps: string[] }

function stageLabel(stage: string): string | null {
  switch (stage) {
    case 'calling_model': return '思考中...'
    case 'executing_tools': return '正在执行操作...'
    case 'building_context': return '正在准备上下文...'
    case 'running_verification': return '正在验证变更...'
    case 'waiting_approval': return '等待审批...'
    case 'applying_edit': return '正在应用编辑...'
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

function toolCallLabel(name: string): string {
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

function useChatItems(parts: MessagePart[], activeTurn?: AgentTurn | null): ChatItem[] {
  return useMemo(() => {
    const items: ChatItem[] = []
    const pendingTools: Array<Extract<MessagePart, { type: 'tool' }>> = []

    function flushTools() {
      if (pendingTools.length === 0) return
      items.push({ type: 'tool_summary', parts: [...pendingTools] })
      pendingTools.length = 0
    }

    let lastStageLabel = ''

    for (const part of parts) {
      if (part.type === 'task_contract' || part.type === 'plan' || part.type === 'plan_confirmation') continue
      if (part.type === 'evidence_coverage' || part.type === 'verification' || part.type === 'review') continue
      if (part.type === 'diagnostic' || part.type === 'edit_result' || part.type === 'artifact' || part.type === 'file') continue
      if (part.type === 'reasoning' || part.type === 'subagent' || part.type === 'automation_run') continue

      if (part.type === 'stage') {
        if (!activeTurn) continue
        if (part.stage === 'completed' || part.stage === 'failed') {
          for (const it of items) {
            if (it.type === 'stage_status') it.completed = true
          }
          continue
        }
        const label = stageLabel(part.stage)
        if (!label) continue
        if (label === lastStageLabel) continue
        lastStageLabel = label
        flushTools()
        for (const it of items) {
          if (it.type === 'stage_status') it.completed = true
        }
        items.push({ type: 'stage_status', stage: part.stage, label, completed: false })
        continue
      }

      if (part.type === 'tool') {
        if (part.call.name === 'model_config') continue
        pendingTools.push(part as Extract<MessagePart, { type: 'tool' }>)
        lastStageLabel = ''
        continue
      }

      flushTools()
      lastStageLabel = ''

      if (part.type === 'text') {
        if (part.role === 'user') {
          items.push({ type: 'user_text', text: part.text })
        } else {
          items.push({ type: 'assistant_text', text: stripVerificationSection(part.text) })
        }
      } else if (part.type === 'handoff') {
        const filtered = stripVerificationSection(part.handoff.summary)
        if (filtered) {
          items.push({
            type: 'handoff',
            summary: filtered,
            nextSteps: part.handoff.nextSteps,
          })
        }
      }
    }

    flushTools()
    return items
  }, [parts, activeTurn])
}

// ── Tool summary expandable line ──

function ToolSummaryLine({ parts }: { parts: Array<Extract<MessagePart, { type: 'tool' }>> }) {
  const [expanded, setExpanded] = useState(false)
  const summary = toolSummaryText(parts)

  const unique = new Map<string, Extract<MessagePart, { type: 'tool' }>>()
  for (const p of parts) unique.set(p.call.id, p)
  const toolParts = [...unique.values()]

  return (
    <div className="agent-tool-summary-group">
      <button
        type="button"
        className={'agent-tool-summary-line' + (expanded ? ' expanded' : '')}
        onClick={() => setExpanded(v => !v)}
      >
        <ChevronDown size={12} className="agent-tool-summary-chevron" />
        <span>{summary}</span>
      </button>
      {expanded && (
        <div className="agent-tool-summary-details">
          {toolParts.map(p => (
            <div key={p.call.id} className="agent-tool-summary-detail">
              <span className="agent-tool-summary-name">{toolCallLabel(p.call.name)}</span>
              {p.output?.output && (
                <span className="agent-tool-summary-result">
                  {p.output.output.length > 120 ? p.output.output.slice(0, 120) + '...' : p.output.output}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── View ──

export function ChatTurnView({ parts, activeTurn }: { parts: MessagePart[]; activeTurn?: AgentTurn | null }) {
  const items = useChatItems(parts, activeTurn)

  return (
    <div className="agent-turn-view">
      {items.map((item, i) => {
        if (item.type === 'stage_status') {
          if (item.completed) {
            return (
              <div key={i} className="agent-status-indicator completed">
                <CheckCircle2 size={13} />
                <span>{item.label}</span>
              </div>
            )
          }
          return (
            <div key={i} className="agent-status-indicator active">
              <span className="shimmer-text">{item.label}</span>
            </div>
          )
        }
        if (item.type === 'user_text') {
          return (
            <div key={i} className="agent-message user">
              <MarkdownMessage text={item.text} />
            </div>
          )
        }
        if (item.type === 'assistant_text') {
          return (
            <div key={i} className="agent-message assistant">
              <MarkdownMessage text={item.text} />
            </div>
          )
        }
        if (item.type === 'tool_summary') {
          return <ToolSummaryLine key={i} parts={item.parts} />
        }
        if (item.type === 'handoff') {
          return (
            <div key={i} className="agent-message assistant">
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
