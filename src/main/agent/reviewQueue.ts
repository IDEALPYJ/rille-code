import type { ReviewQueueItem, ReviewQueueSource } from '../../shared/agent/protocol'

let items: ReviewQueueItem[] = []

export function clearReviewQueue(): void {
  items = []
}

export function pushReviewQueueItem(item: ReviewQueueItem): void {
  items.push(item)
}

export function resolveReviewQueueItem(
  itemId: string,
  action: 'dismiss' | 'accept_risk' | 'reject' | 'retry',
  reason?: string,
): ReviewQueueItem | undefined {
  const item = items.find(i => i.id === itemId)
  if (!item) return undefined
  item.resolved = true
  item.resolvedAt = Date.now()
  item.resolvedBy = 'user'
  return item
}

export function listReviewQueue(filter?: {
  sessionId?: string
  automationId?: string
  source?: ReviewQueueSource
  includeResolved?: boolean
}): ReviewQueueItem[] {
  let result = items
  if (!filter?.includeResolved) {
    result = result.filter(i => !i.resolved)
  }
  if (filter?.sessionId) {
    result = result.filter(i => i.sessionId === filter.sessionId)
  }
  if (filter?.automationId) {
    result = result.filter(i => i.automationId === filter.automationId)
  }
  if (filter?.source) {
    result = result.filter(i => i.source === filter.source)
  }
  return result.sort((a, b) => b.createdAt - a.createdAt)
}

export function autoResolveForPlan(confirmationId: string): void {
  for (const item of items) {
    if (item.source === 'plan_confirmation' && item.payload.planConfirmationId === confirmationId) {
      item.resolved = true
      item.resolvedAt = Date.now()
      item.resolvedBy = 'automation'
    }
  }
}

export function autoResolveForProposal(proposalId: string): void {
  for (const item of items) {
    if (item.source === 'diff_proposal' && item.payload.proposalId === proposalId) {
      item.resolved = true
      item.resolvedAt = Date.now()
      item.resolvedBy = 'automation'
    }
  }
}

export function autoResolveForEvidence(evidenceId: string): void {
  for (const item of items) {
    if ((item.source === 'failed_evidence' || item.source === 'stale_evidence') && item.payload.evidenceId === evidenceId) {
      item.resolved = true
      item.resolvedAt = Date.now()
      item.resolvedBy = 'automation'
    }
  }
}

export function autoResolveForFinding(findingId: string): void {
  for (const item of items) {
    if (item.source === 'blocking_finding' && item.payload.findingId === findingId) {
      item.resolved = true
      item.resolvedAt = Date.now()
      item.resolvedBy = 'automation'
    }
  }
}

export function autoResolveForSession(sessionId: string): void {
  for (const item of items) {
    if (item.sessionId === sessionId) {
      item.resolved = true
      item.resolvedAt = Date.now()
      item.resolvedBy = 'automation'
    }
  }
}

function makeItemId(): string {
  return `rqi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function createReviewQueueItem(params: {
  source: ReviewQueueSource
  sessionId: string
  turnId: string
  automationId?: string
  title: string
  description: string
  severity?: ReviewQueueItem['severity']
  payload?: ReviewQueueItem['payload']
}): ReviewQueueItem {
  return {
    id: makeItemId(),
    source: params.source,
    sessionId: params.sessionId,
    turnId: params.turnId,
    automationId: params.automationId,
    title: params.title,
    description: params.description,
    severity: params.severity ?? 'info',
    resolved: false,
    payload: params.payload ?? {},
    createdAt: Date.now(),
  }
}
