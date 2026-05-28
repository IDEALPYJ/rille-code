import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AutomationRun, AutomationSpec } from '../../shared/agent/protocol'

let specsCache: Map<string, AutomationSpec> | null = null
let runsCache: Map<string, AutomationRun[]> | null = null

export function clearAutomationStore(): void {
  specsCache = new Map()
  runsCache = new Map()
}

function rootDir(): string {
  const userData = typeof app?.getPath === 'function' ? app.getPath('userData') : join(tmpdir(), 'rillecode-test-user-data')
  return join(userData, 'agent')
}

function specsPath(): string {
  return join(rootDir(), 'automations.json')
}

function ensureRoot(): void {
  mkdirSync(rootDir(), { recursive: true })
}

function reloadCache(): void {
  ensureRoot()
  const path = specsPath()
  if (!existsSync(path)) {
    specsCache = new Map()
    return
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as AutomationSpec[]
    specsCache = new Map(raw.map(s => [s.id, s]))
  } catch {
    specsCache = new Map()
  }
}

function flushSpecs(): void {
  ensureRoot()
  const arr = Array.from((specsCache ?? new Map()).values())
  writeFileSync(specsPath(), JSON.stringify(arr, null, 2), 'utf8')
}

function ensureCache(): Map<string, AutomationSpec> {
  if (!specsCache) reloadCache()
  return specsCache!
}

export function loadAutomationSpecs(): AutomationSpec[] {
  return Array.from(ensureCache().values()).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function saveAutomationSpec(spec: AutomationSpec): void {
  const cache = ensureCache()
  cache.set(spec.id, spec)
  flushSpecs()
}

export function deleteAutomationSpec(automationId: string): void {
  const cache = ensureCache()
  cache.delete(automationId)
  flushSpecs()
}

export function findAutomationSpec(automationId: string): AutomationSpec | undefined {
  return ensureCache().get(automationId)
}

// --- Runs (in-memory only, persisted alongside specs) ---

function ensureRunsCache(): Map<string, AutomationRun[]> {
  if (!runsCache) runsCache = new Map()
  return runsCache
}

export function loadAutomationRuns(automationId: string): AutomationRun[] {
  return ensureRunsCache().get(automationId) ?? []
}

export function saveAutomationRun(run: AutomationRun): void {
  const cache = ensureRunsCache()
  const existing = cache.get(run.automationId) ?? []
  const idx = existing.findIndex(r => r.id === run.id)
  if (idx >= 0) existing[idx] = run
  else existing.push(run)
  cache.set(run.automationId, existing)
}

export function findAutomationRun(runId: string): AutomationRun | undefined {
  for (const runs of ensureRunsCache().values()) {
    const found = runs.find(r => r.id === runId)
    if (found) return found
  }
  return undefined
}

export function findLatestRun(automationId: string): AutomationRun | undefined {
  const runs = loadAutomationRuns(automationId)
  if (runs.length === 0) return undefined
  return runs[runs.length - 1]
}
