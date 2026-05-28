import { beforeEach, describe, expect, it } from 'vitest'
import {
  autoResolveForEvidence,
  autoResolveForFinding,
  autoResolveForPlan,
  autoResolveForProposal,
  autoResolveForSession,
  clearReviewQueue,
  createReviewQueueItem,
  listReviewQueue,
  pushReviewQueueItem,
  resolveReviewQueueItem,
} from '../../src/main/agent/reviewQueue'

describe('reviewQueue', () => {
  beforeEach(() => {
    clearReviewQueue()
  })
  describe('push and list', () => {
    it('starts empty', () => {
      expect(listReviewQueue()).toEqual([])
    })

    it('pushes and lists items', () => {
      const item = createReviewQueueItem({
        source: 'plan_confirmation',
        sessionId: 'session_1',
        turnId: 'turn_1',
        title: 'Test Item',
        description: 'A test queue item',
        severity: 'blocking',
      })
      pushReviewQueueItem(item)
      const list = listReviewQueue()
      expect(list).toHaveLength(1)
      expect(list[0].title).toBe('Test Item')
      expect(list[0].severity).toBe('blocking')
    })

    it('returns items sorted by createdAt desc', async () => {
      const item1 = createReviewQueueItem({
        source: 'plan_confirmation',
        sessionId: 'session_1',
        turnId: 'turn_1',
        title: 'Item 1',
        description: 'First',
      })
      pushReviewQueueItem(item1)
      // Small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 5))
      const item2 = createReviewQueueItem({
        source: 'failed_evidence',
        sessionId: 'session_1',
        turnId: 'turn_2',
        title: 'Item 2',
        description: 'Second',
      })
      pushReviewQueueItem(item2)
      const list = listReviewQueue()
      expect(list[0].title).toBe('Item 2')
    })

    it('excludes resolved by default', () => {
      const item = createReviewQueueItem({
        source: 'plan_confirmation',
        sessionId: 'session_1',
        turnId: 'turn_1',
        title: 'Resolved Item',
        description: 'Should be hidden',
      })
      item.resolved = true
      pushReviewQueueItem(item)
      expect(listReviewQueue()).toEqual([])
    })

    it('includes resolved when requested', () => {
      const item = createReviewQueueItem({
        source: 'plan_confirmation',
        sessionId: 'session_1',
        turnId: 'turn_1',
        title: 'Resolved Item',
        description: 'Should be visible',
      })
      item.resolved = true
      pushReviewQueueItem(item)
      expect(listReviewQueue({ includeResolved: true })).toHaveLength(1)
    })
  })

  describe('filters', () => {
    it('filters by sessionId', () => {
      pushReviewQueueItem(createReviewQueueItem({
        source: 'plan_confirmation', sessionId: 's1', turnId: 't1', title: 'S1', description: '',
      }))
      pushReviewQueueItem(createReviewQueueItem({
        source: 'plan_confirmation', sessionId: 's2', turnId: 't2', title: 'S2', description: '',
      }))
      expect(listReviewQueue({ sessionId: 's1' })).toHaveLength(1)
    })

    it('filters by automationId', () => {
      pushReviewQueueItem(createReviewQueueItem({
        source: 'plan_confirmation', sessionId: 's1', turnId: 't1', title: 'A1',
        description: '', automationId: 'auto1',
      }))
      pushReviewQueueItem(createReviewQueueItem({
        source: 'plan_confirmation', sessionId: 's2', turnId: 't2', title: 'A2',
        description: '', automationId: 'auto2',
      }))
      expect(listReviewQueue({ automationId: 'auto1' })).toHaveLength(1)
    })

    it('filters by source', () => {
      pushReviewQueueItem(createReviewQueueItem({
        source: 'plan_confirmation', sessionId: 's1', turnId: 't1', title: 'Plan', description: '',
      }))
      pushReviewQueueItem(createReviewQueueItem({
        source: 'failed_evidence', sessionId: 's1', turnId: 't1', title: 'Evidence', description: '',
      }))
      expect(listReviewQueue({ source: 'failed_evidence' })).toHaveLength(1)
      expect(listReviewQueue({ source: 'plan_confirmation' })).toHaveLength(1)
    })
  })

  describe('resolve', () => {
    it('resolves an item', () => {
      const item = createReviewQueueItem({
        source: 'plan_confirmation', sessionId: 's1', turnId: 't1', title: 'To Resolve', description: '',
      })
      pushReviewQueueItem(item)
      const resolved = resolveReviewQueueItem(item.id, 'accept_risk')
      expect(resolved?.resolved).toBe(true)
      expect(resolved?.resolvedBy).toBe('user')
      expect(listReviewQueue()).toEqual([])
    })

    it('returns undefined for non-existent item', () => {
      expect(resolveReviewQueueItem('nonexistent', 'dismiss')).toBeUndefined()
    })
  })

  describe('autoResolve', () => {
    it('autoResolveForPlan resolves plan items', () => {
      const item = createReviewQueueItem({
        source: 'plan_confirmation', sessionId: 's1', turnId: 't1', title: 'Plan',
        description: '', payload: { planConfirmationId: 'confirm_1' },
      })
      pushReviewQueueItem(item)
      autoResolveForPlan('confirm_1')
      expect(listReviewQueue()).toEqual([])
    })

    it('autoResolveForProposal resolves proposal items', () => {
      const item = createReviewQueueItem({
        source: 'diff_proposal', sessionId: 's1', turnId: 't1', title: 'Diff',
        description: '', payload: { proposalId: 'prop_1' },
      })
      pushReviewQueueItem(item)
      autoResolveForProposal('prop_1')
      expect(listReviewQueue()).toEqual([])
    })

    it('autoResolveForEvidence resolves evidence items', () => {
      const item = createReviewQueueItem({
        source: 'failed_evidence', sessionId: 's1', turnId: 't1', title: 'Failed',
        description: '', payload: { evidenceId: 'ev_1' },
      })
      pushReviewQueueItem(item)
      autoResolveForEvidence('ev_1')
      expect(listReviewQueue()).toEqual([])
    })

    it('autoResolveForFinding resolves finding items', () => {
      const item = createReviewQueueItem({
        source: 'blocking_finding', sessionId: 's1', turnId: 't1', title: 'Finding',
        description: '', payload: { findingId: 'find_1' },
      })
      pushReviewQueueItem(item)
      autoResolveForFinding('find_1')
      expect(listReviewQueue()).toEqual([])
    })

    it('autoResolveForSession resolves all items for a session', () => {
      pushReviewQueueItem(createReviewQueueItem({
        source: 'plan_confirmation', sessionId: 's1', turnId: 't1', title: 'A', description: '',
      }))
      pushReviewQueueItem(createReviewQueueItem({
        source: 'plan_confirmation', sessionId: 's2', turnId: 't2', title: 'B', description: '',
      }))
      autoResolveForSession('s1')
      expect(listReviewQueue()).toHaveLength(1)
      expect(listReviewQueue()[0].title).toBe('B')
    })
  })

  describe('createReviewQueueItem', () => {
    it('generates a unique id', () => {
      const item1 = createReviewQueueItem({
        source: 'plan_confirmation', sessionId: 's1', turnId: 't1', title: 'T', description: '',
      })
      const item2 = createReviewQueueItem({
        source: 'plan_confirmation', sessionId: 's1', turnId: 't1', title: 'T', description: '',
      })
      expect(item1.id).not.toBe(item2.id)
    })

    it('sets default severity to info', () => {
      const item = createReviewQueueItem({
        source: 'plan_confirmation', sessionId: 's1', turnId: 't1', title: 'T', description: '',
      })
      expect(item.severity).toBe('info')
    })

    it('sets createdAt', () => {
      const before = Date.now()
      const item = createReviewQueueItem({
        source: 'plan_confirmation', sessionId: 's1', turnId: 't1', title: 'T', description: '',
      })
      expect(item.createdAt).toBeGreaterThanOrEqual(before)
    })
  })
})
