import { randomUUID } from 'crypto'
import type { AgentEvent, CompactionResult, CompactionTask, FeatureItem, Handoff } from '../../shared/agent/protocol'
import { createArtifact } from './artifactStore'
import { FeatureStore } from './featureStore'
import { readSessionEvents } from './sessionStore'

function now(): number {
  return Date.now()
}

const compactionJobs = new Map<string, CompactionTask>()

function latestHandoff(events: AgentEvent[]): Handoff | undefined {
  return events.filter((event): event is Extract<AgentEvent, { type: 'handoff.created' }> => event.type === 'handoff.created').at(-1)?.handoff
}

function latestFeatureList(events: AgentEvent[], workspacePath?: string): FeatureItem[] {
  const progress = events.filter((event): event is Extract<AgentEvent, { type: 'progress.updated' }> => event.type === 'progress.updated').at(-1)?.progress
  if (progress?.featureList.length) return progress.featureList
  if (workspacePath) return new FeatureStore(workspacePath).load().featureList
  return []
}

export function createCompactionTask(sessionId: string, turnId?: string, reason?: string): CompactionTask {
  const task: CompactionTask = {
    id: `compact_${randomUUID()}`,
    sessionId,
    turnId,
    status: 'running',
    reason,
    createdAt: now(),
  }
  compactionJobs.set(task.id, task)
  return task
}

export function getCompactionTask(taskId: string): CompactionTask | null {
  return compactionJobs.get(taskId) ?? null
}

export function markCompactionTaskFailed(task: CompactionTask): CompactionTask {
  const failed = { ...task, status: 'failed' as const, completedAt: now() }
  compactionJobs.set(failed.id, failed)
  return failed
}

export async function runCompactionTask(input: {
  task: CompactionTask
  workspacePath?: string
  stablePrefixCacheKey?: string
}): Promise<{ task: CompactionTask; result: CompactionResult }> {
  const events = await readSessionEvents(input.task.sessionId)
  const handoff = latestHandoff(events)
  const features = latestFeatureList(events, input.workspacePath)
  const evidenceCount = events.filter(event => event.type === 'evidence.created').length
  const reviewCount = events.filter(event => event.type === 'review.completed').length
  const turnCount = events.filter(event => event.type === 'turn.started').length
  const summary = [
    `Session compact summary`,
    `Session: ${input.task.sessionId}`,
    input.task.turnId ? `Turn: ${input.task.turnId}` : null,
    input.task.reason ? `Reason: ${input.task.reason}` : null,
    `Turns: ${turnCount}`,
    `Evidence items: ${evidenceCount}`,
    `Review runs: ${reviewCount}`,
    handoff ? `Latest handoff: ${handoff.summary}` : null,
    features.length > 0 ? `Retained features:\n${features.map(item => `- [${item.status}] ${item.title}`).join('\n')}` : null,
  ].filter(Boolean).join('\n')
  const artifact = createArtifact({
    sessionId: input.task.sessionId,
    turnId: input.task.turnId,
    kind: 'text',
    content: summary,
    mimeType: 'text/plain; charset=utf-8',
    redacted: true,
  })
  const result: CompactionResult = {
    id: `compact_result_${randomUUID()}`,
    taskId: input.task.id,
    sessionId: input.task.sessionId,
    turnId: input.task.turnId,
    summaryArtifact: artifact,
    retainedFeatureList: features,
    handoff,
    stablePrefixCacheKey: input.stablePrefixCacheKey,
    createdAt: now(),
  }
  const completedTask = { ...input.task, status: 'completed' as const, completedAt: now() }
  compactionJobs.set(completedTask.id, completedTask)
  return {
    task: completedTask,
    result,
  }
}
