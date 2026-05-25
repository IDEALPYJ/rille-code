import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { FeatureItem, FeatureStoreSnapshot, ProgressState } from '../../shared/agent/protocol'

function featurePath(workspacePath: string): string {
  return join(workspacePath, '.rille', 'features.json')
}

function ensureRilleDir(workspacePath: string): void {
  mkdirSync(join(workspacePath, '.rille'), { recursive: true })
}

function validFeature(item: unknown): item is FeatureItem {
  if (!item || typeof item !== 'object') return false
  const value = item as Partial<FeatureItem>
  return typeof value.id === 'string' && typeof value.title === 'string' && typeof value.status === 'string'
}

export class FeatureStore {
  constructor(private readonly workspacePath: string) {}

  load(): FeatureStoreSnapshot {
    const path = featurePath(this.workspacePath)
    if (!existsSync(path)) return { featureList: [], updatedAt: Date.now() }
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<FeatureStoreSnapshot>
      return {
        taskContractId: raw.taskContractId,
        featureList: Array.isArray(raw.featureList) ? raw.featureList.filter(validFeature) : [],
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
      }
    } catch {
      return { featureList: [], updatedAt: Date.now() }
    }
  }

  save(progress: ProgressState): FeatureStoreSnapshot {
    const snapshot: FeatureStoreSnapshot = {
      taskContractId: progress.taskContractId,
      featureList: progress.featureList,
      updatedAt: Date.now(),
    }
    ensureRilleDir(this.workspacePath)
    writeFileSync(featurePath(this.workspacePath), JSON.stringify(snapshot, null, 2), 'utf8')
    return snapshot
  }

  markStaleMissingEvidence(existingEvidenceIds: Set<string>): FeatureStoreSnapshot {
    const snapshot = this.load()
    let changed = false
    const featureList = snapshot.featureList.map(feature => {
      const missingRefs = feature.evidenceRefs.filter(id => !existingEvidenceIds.has(id))
      if (missingRefs.length === 0) return feature
      changed = true
      return {
        ...feature,
        status: feature.status === 'verified' ? 'implemented_unverified' as const : feature.status,
        updatedAt: Date.now(),
      }
    })
    if (!changed) return snapshot
    const updated = { ...snapshot, featureList, updatedAt: Date.now() }
    ensureRilleDir(this.workspacePath)
    writeFileSync(featurePath(this.workspacePath), JSON.stringify(updated, null, 2), 'utf8')
    return updated
  }
}
