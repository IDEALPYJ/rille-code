import type { AgentEvent, Handoff, MessagePart, ReviewResult, RiskLevel, TraceEvent, VerificationResult } from '../../../shared/agent/protocol'

const riskOrder: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 }

export interface AgentRiskSummary {
  risk: RiskLevel
  latestVerification?: VerificationResult['status']
  latestReview?: ReviewResult['status']
  lastAction: string
  nextStep?: string
}

export interface ComposerContext {
  activeFile?: { path: string; name: string; content?: string } | null
  cursor?: { line: number; column: number }
}

export function summarizeAgentWorkbench(parts: MessagePart[], events: AgentEvent[]): AgentRiskSummary {
  let risk: RiskLevel = 'low'
  let latestVerification: VerificationResult['status'] | undefined
  let latestReview: ReviewResult['status'] | undefined
  let latestHandoff: Handoff | undefined
  let lastAction = '等待任务'

  for (const part of parts) {
    if (part.type === 'task_contract') {
      for (const item of part.contract.riskPoints) {
        if (riskOrder[item.risk] > riskOrder[risk]) risk = item.risk
      }
    }
    if (part.type === 'plan_confirmation' && riskOrder[part.confirmation.riskLevel] > riskOrder[risk]) risk = part.confirmation.riskLevel
    if (part.type === 'verification') latestVerification = part.result.status
    if (part.type === 'review') latestReview = part.result.status
    if (part.type === 'handoff') latestHandoff = part.handoff
    lastAction = labelPart(part)
  }

  for (const event of events) {
    if (event.type === 'verification.completed') latestVerification = event.result.status
    if (event.type === 'review.completed') latestReview = event.result.status
    if (event.type === 'handoff.created') latestHandoff = event.handoff
    if (event.type === 'tool.completed') lastAction = `工具完成: ${event.callId}`
    if (event.type === 'hook.invoked') lastAction = `Hook: ${event.hook.name}`
  }

  return {
    risk,
    latestVerification,
    latestReview,
    lastAction,
    nextStep: latestHandoff?.nextSteps[0],
  }
}

function labelPart(part: MessagePart): string {
  if (part.type === 'stage') return part.detail || part.stage
  if (part.type === 'tool') return `工具: ${part.call.title}`
  if (part.type === 'review') return `Review: ${part.result.status}`
  if (part.type === 'verification') return `验证: ${part.result.status}`
  if (part.type === 'handoff') return 'Handoff'
  return part.type
}

export function expandComposerDraft(input: string, context: ComposerContext): string {
  const activeFile = context.activeFile
  const fileToken = activeFile ? activeFile.path : ''
  const selectionToken = activeFile
    ? `${activeFile.path}:${context.cursor?.line ?? 1}:${context.cursor?.column ?? 1}`
    : ''
  return input
    .replace(/^\/plan\b/, '请进入 Plan Mode，只做只读探索并给出可执行计划。')
    .replace(/^\/fix\b/, '请修复当前问题，并在完成前提供证据、验证和 review 结果。')
    .replace(/^\/verify\b/, '请运行或补充验证，更新 evidence coverage，并说明仍然阻塞的项。')
    .replace(/@file\b/g, fileToken)
    .replace(/#selection\b/g, selectionToken)
}

export function traceDebugSummary(traceEvents: TraceEvent[]): string {
  const fallbackCount = traceEvents.filter(event => event.type === 'model.fallback').length
  const cacheCount = traceEvents.filter(event => event.type === 'model.cache').length
  const hookCount = traceEvents.filter(event => event.type === 'hook.invoked').length
  return `${traceEvents.length} events · ${fallbackCount} fallback · ${cacheCount} cache · ${hookCount} hooks`
}

export function subagentNodes(events: AgentEvent[]): Array<{ id: string; label: string; status: string }> {
  const nodes: Array<{ id: string; label: string; status: string }> = []
  for (const event of events) {
    if (event.type === 'evaluator.started' || event.type === 'evaluator.completed' || event.type === 'evaluator.failed') {
      nodes.push({
        id: event.run.id,
        label: 'Reviewer evaluator',
        status: event.run.status,
      })
    }
  }
  if (nodes.length === 0) nodes.push({ id: 'reviewer_placeholder', label: 'Reviewer subagent', status: 'read_only placeholder' })
  return nodes
}
