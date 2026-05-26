import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { FeatureItem, FeatureLifecycleEntry, FeatureLifecycleStatus, FeatureStoreSnapshot, ProgressState } from '../../shared/agent/protocol'

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

function lifecycleStatusForFeature(status: FeatureItem['status']): FeatureLifecycleStatus {
  if (status === 'verified') return 'verified'
  if (status === 'dropped') return 'removed'
  if (status === 'blocked') return 'active'
  if (status === 'not_started') return 'planned'
  return 'active'
}

function validLifecycle(item: unknown): item is FeatureLifecycleEntry {
  if (!item || typeof item !== 'object') return false
  const value = item as Partial<FeatureLifecycleEntry>
  return typeof value.featureId === 'string'
    && ['planned', 'active', 'verified', 'deprecated', 'removed'].includes(String(value.status))
    && Array.isArray(value.evidenceRefs)
}

export function lifecycleFromFeatures(features: FeatureItem[], existing: FeatureLifecycleEntry[] = []): FeatureLifecycleEntry[] {
  const existingById = new Map(existing.filter(validLifecycle).map(entry => [entry.featureId, entry]))
  return features.map(feature => {
    const current = existingById.get(feature.id)
    return {
      featureId: feature.id,
      status: current?.status || lifecycleStatusForFeature(feature.status),
      source: current?.source || 'feature_store',
      owner: current?.owner,
      lastVerifiedAt: current?.lastVerifiedAt || (feature.status === 'verified' ? feature.updatedAt : undefined),
      evidenceRefs: current?.evidenceRefs?.length ? current.evidenceRefs : feature.evidenceRefs,
      deprecationNote: current?.deprecationNote,
      removalNote: current?.removalNote,
      updatedAt: current?.updatedAt || feature.updatedAt,
    }
  })
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
        lifecycle: lifecycleFromFeatures(
          Array.isArray(raw.featureList) ? raw.featureList.filter(validFeature) : [],
          Array.isArray(raw.lifecycle) ? raw.lifecycle.filter(validLifecycle) : [],
        ),
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
      lifecycle: lifecycleFromFeatures(progress.featureList),
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
