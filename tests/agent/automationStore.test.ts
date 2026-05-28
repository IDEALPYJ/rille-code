import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AutomationRun, AutomationSpec } from '../../src/shared/agent/protocol'

// Mock electron.app before importing the store
const mockUserData = mkdtempSync(join(tmpdir(), 'rillecode-test-automation-store-'))
process.env.RILLECODE_TEST_USER_DATA = mockUserData

const tempDirs: string[] = [mockUserData]

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

// We need to import after setting up the mock data path
// The store module reads from app.getPath which we can't easily mock in vitest,
// so we test the in-memory functions directly.

import {
  clearAutomationStore,
  deleteAutomationSpec,
  findAutomationRun,
  findAutomationSpec,
  findLatestRun,
  loadAutomationRuns,
  loadAutomationSpecs,
  saveAutomationRun,
  saveAutomationSpec,
} from '../../src/main/agent/automationStore'

function makeSpec(overrides: Partial<AutomationSpec> = {}): AutomationSpec {
  return {
    id: 'automation_test1',
    name: 'Test Automation',
    goal: 'Run tests',
    schedule: 'manual',
    workspace: { path: '/tmp', label: 'test' },
    permissionMode: 'plan',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run_test1',
    automationId: 'automation_test1',
    sessionId: 'session_1',
    turnId: 'turn_1',
    status: 'completed',
    evidenceCount: 0,
    findingCount: 0,
    startedAt: Date.now(),
    ...overrides,
  }
}

describe('automationStore', () => {
  beforeEach(() => {
    clearAutomationStore()
  })

  describe('spec CRUD', () => {
    it('loads empty specs', () => {
      const specs = loadAutomationSpecs()
      expect(specs).toEqual([])
    })

    it('saves and loads specs', () => {
      const spec = makeSpec()
      saveAutomationSpec(spec)
      const specs = loadAutomationSpecs()
      expect(specs).toHaveLength(1)
      expect(specs[0].id).toBe('automation_test1')
      expect(specs[0].name).toBe('Test Automation')
    })

    it('saves specs sorted by updatedAt desc', () => {
      const spec1 = makeSpec({ id: 'a1', updatedAt: 100 })
      const spec2 = makeSpec({ id: 'a2', updatedAt: 200 })
      saveAutomationSpec(spec2)
      saveAutomationSpec(spec1)
      const specs = loadAutomationSpecs()
      expect(specs[0].id).toBe('a2')
      expect(specs[1].id).toBe('a1')
    })

    it('deletes specs', () => {
      const spec = makeSpec()
      saveAutomationSpec(spec)
      deleteAutomationSpec(spec.id)
      expect(loadAutomationSpecs()).toEqual([])
    })

    it('finds spec by id', () => {
      const spec = makeSpec()
      saveAutomationSpec(spec)
      const found = findAutomationSpec(spec.id)
      expect(found?.name).toBe('Test Automation')
    })

    it('returns undefined for non-existent spec', () => {
      expect(findAutomationSpec('nonexistent')).toBeUndefined()
    })

    it('updates existing spec on re-save', () => {
      const spec = makeSpec()
      saveAutomationSpec(spec)
      spec.name = 'Updated Name'
      saveAutomationSpec(spec)
      const found = findAutomationSpec(spec.id)
      expect(found?.name).toBe('Updated Name')
    })
  })

  describe('runs', () => {
    it('loads empty runs', () => {
      expect(loadAutomationRuns('automation_test1')).toEqual([])
    })

    it('saves and loads runs', () => {
      const run = makeRun()
      saveAutomationRun(run)
      const runs = loadAutomationRuns('automation_test1')
      expect(runs).toHaveLength(1)
      expect(runs[0].id).toBe('run_test1')
    })

    it('finds latest run', () => {
      const run1 = makeRun({ id: 'run_1', startedAt: 100 })
      const run2 = makeRun({ id: 'run_2', startedAt: 200 })
      saveAutomationRun(run1)
      saveAutomationRun(run2)
      const latest = findLatestRun('automation_test1')
      expect(latest?.id).toBe('run_2')
    })

    it('updates existing run', () => {
      const run = makeRun()
      saveAutomationRun(run)
      run.status = 'failed'
      saveAutomationRun(run)
      const runs = loadAutomationRuns('automation_test1')
      expect(runs[0].status).toBe('failed')
    })

    it('finds run by id', () => {
      const run = makeRun({ id: 'special_run' })
      saveAutomationRun(run)
      const found = findAutomationRun('special_run')
      expect(found?.status).toBe('completed')
    })
  })

  describe('multiple automations', () => {
    it('runs are separated by automationId', () => {
      const spec1 = makeSpec({ id: 'a1' })
      const spec2 = makeSpec({ id: 'a2' })
      saveAutomationSpec(spec1)
      saveAutomationSpec(spec2)
      saveAutomationRun(makeRun({ automationId: 'a1', id: 'r1' }))
      saveAutomationRun(makeRun({ automationId: 'a2', id: 'r2' }))
      expect(loadAutomationRuns('a1')).toHaveLength(1)
      expect(loadAutomationRuns('a2')).toHaveLength(1)
      expect(loadAutomationRuns('a1')[0].id).toBe('r1')
    })
  })
})
