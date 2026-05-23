import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ProjectMemoryEntry, ProjectMemoryKind, ProjectMemoryStatus } from '../../shared/agent/protocol'

function memoryPath(workspacePath: string): string {
  return join(workspacePath, '.rille', 'memory.json')
}

function now(): number {
  return Date.now()
}

export class MemoryStore {
  private entries: ProjectMemoryEntry[] = []
  private dirty = false

  constructor(private readonly workspacePath: string) {}

  load(): void {
    const path = memoryPath(this.workspacePath)
    if (!existsSync(path)) return
    try {
      const raw = readFileSync(path, 'utf8')
      const data = JSON.parse(raw) as { entries?: ProjectMemoryEntry[] }
      this.entries = data.entries ?? []
    } catch {
      this.entries = []
    }
  }

  private save(): void {
    const path = memoryPath(this.workspacePath)
    const dir = join(this.workspacePath, '.rille')
    if (!existsSync(dir)) {
      const { mkdirSync } = require('fs')
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(path, JSON.stringify({ entries: this.entries }, null, 2), 'utf8')
    this.dirty = false
  }

  add(kind: ProjectMemoryKind, text: string, sourceRefs: string[]): ProjectMemoryEntry {
    if (!sourceRefs || sourceRefs.length === 0) {
      throw new Error('Memory entries must have at least one sourceRef.')
    }
    const entry: ProjectMemoryEntry = {
      id: `mem_${randomUUID()}`,
      kind,
      text,
      sourceRefs,
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
    }
    this.entries.push(entry)
    this.dirty = true
    this.save()
    return entry
  }

  update(id: string, changes: Partial<Pick<ProjectMemoryEntry, 'text' | 'status' | 'sourceRefs'>>): ProjectMemoryEntry | null {
    const index = this.entries.findIndex(e => e.id === id)
    if (index < 0) return null
    this.entries[index] = { ...this.entries[index], ...changes, updatedAt: now() }
    this.dirty = true
    this.save()
    return this.entries[index]
  }

  delete(id: string): boolean {
    const index = this.entries.findIndex(e => e.id === id)
    if (index < 0) return false
    this.entries.splice(index, 1)
    this.dirty = true
    this.save()
    return true
  }

  markStale(id: string): ProjectMemoryEntry | null {
    return this.update(id, { status: 'stale' })
  }

  markSuperseded(id: string, _byId: string): ProjectMemoryEntry | null {
    return this.update(id, { status: 'superseded' })
  }

  list(kind?: ProjectMemoryKind): ProjectMemoryEntry[] {
    let result = this.entries
    if (kind) result = result.filter(e => e.kind === kind)
    return result.filter(e => e.status !== 'conflict').sort((a, b) => b.updatedAt - a.updatedAt)
  }

  listActive(limit = 5): ProjectMemoryEntry[] {
    return this.entries
      .filter(e => e.status === 'active')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
  }
}
