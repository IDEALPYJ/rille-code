import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { FeatureStore } from '../../src/main/agent/featureStore'
import { MemoryStore } from '../../src/main/agent/memory'

const tempDirs: string[] = []

afterAll(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function makeStore(): MemoryStore {
  const root = mkdtempSync(join(tmpdir(), 'rille-memory-'))
  tempDirs.push(root)
  return new MemoryStore(root)
}

describe('MemoryStore', () => {
  it('adds and lists memory entries', () => {
    const store = makeStore()
    store.load()
    const entry = store.add('convention', 'Use pnpm as package manager', ['AGENTS.md', 'package.json'])
    expect(entry.id).toMatch(/^mem_/)
    expect(entry.kind).toBe('convention')
    expect(entry.status).toBe('active')

    const list = store.list()
    expect(list).toHaveLength(1)
    expect(list[0].text).toBe('Use pnpm as package manager')
  })

  it('rejects entries without sourceRefs', () => {
    const store = makeStore()
    store.load()
    expect(() => store.add('convention', 'no source', [])).toThrow(/sourceRef/)
  })

  it('updates entries', () => {
    const store = makeStore()
    store.load()
    const entry = store.add('command', 'Run pnpm test before commit', ['AGENTS.md'])
    const updated = store.update(entry.id, { status: 'stale' })
    expect(updated?.status).toBe('stale')
    expect(store.list().length).toBe(1) // stale entries still in list, only conflict excluded
    expect(store.listActive().length).toBe(0) // listActive filters for status==='active'
  })

  it('deletes entries', () => {
    const store = makeStore()
    store.load()
    const entry = store.add('known_issue', 'Type error in legacy module', ['src/legacy.ts'])
    expect(store.delete(entry.id)).toBe(true)
    expect(store.list()).toHaveLength(0)
    expect(store.delete('nonexistent')).toBe(false)
  })

  it('filters by kind', () => {
    const store = makeStore()
    store.load()
    store.add('convention', 'Conv A', ['doc.md'])
    store.add('command', 'Cmd B', ['doc.md'])
    store.add('convention', 'Conv C', ['doc.md'])
    expect(store.list('convention')).toHaveLength(2)
    expect(store.list('command')).toHaveLength(1)
    expect(store.list('decision')).toHaveLength(0)
  })

  it('listActive returns only active entries, limited', () => {
    const store = makeStore()
    store.load()
    store.add('convention', 'A', ['x'])
    store.add('convention', 'B', ['x'])
    store.add('convention', 'C', ['x'])
    const entry = store.add('convention', 'D', ['x'])
    store.update(entry.id, { status: 'stale' })
    store.add('convention', 'E', ['x'])
    store.add('convention', 'F', ['x'])
    const active = store.listActive(3)
    expect(active.length).toBe(3)
    for (const e of active) expect(e.status).toBe('active')
  })

  it('persists to .rille/memory.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rille-memory-persist-'))
    tempDirs.push(dir)
    const store = new MemoryStore(dir)
    store.load()
    store.add('decision', 'Use Vitest for testing', ['AGENTS.md'])
    const store2 = new MemoryStore(dir)
    store2.load()
    expect(store2.list()).toHaveLength(1)
    expect(store2.list()[0].text).toBe('Use Vitest for testing')
  })
})

describe('FeatureStore', () => {
  it('persists feature progress to .rille/features.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rille-features-'))
    tempDirs.push(dir)
    const store = new FeatureStore(dir)
    const snapshot = store.save({
      taskContractId: 'contract_1',
      activeFeatureId: 'feature_1',
      featureList: [{
        id: 'feature_1',
        title: 'Manual evidence support',
        status: 'verified',
        acceptanceCriteriaIds: ['ac_1'],
        evidenceRefs: ['evidence_1'],
        riskRefs: [],
        updatedAt: 1,
      }],
      failedAttempts: [],
      unresolvedRisks: [],
      nextSteps: [],
      updatedAt: 1,
    })
    expect(snapshot.featureList).toHaveLength(1)
    expect(new FeatureStore(dir).load().featureList[0].title).toBe('Manual evidence support')
  })

  it('downgrades verified features with missing evidence refs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rille-features-stale-'))
    tempDirs.push(dir)
    const store = new FeatureStore(dir)
    store.save({
      taskContractId: 'contract_1',
      featureList: [{
        id: 'feature_1',
        title: 'Needs evidence',
        status: 'verified',
        acceptanceCriteriaIds: ['ac_1'],
        evidenceRefs: ['missing_evidence'],
        riskRefs: [],
        updatedAt: 1,
      }],
      failedAttempts: [],
      unresolvedRisks: [],
      nextSteps: [],
      updatedAt: 1,
    })
    const snapshot = store.markStaleMissingEvidence(new Set(['other_evidence']))
    expect(snapshot.featureList[0].status).toBe('implemented_unverified')
  })
})
