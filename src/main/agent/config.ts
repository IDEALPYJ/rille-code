import { app } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type {
  AgentConfigSnapshot,
  AgentConfigUpdate,
  AgentModelModality,
  AgentModelProfile,
  AgentModelProfileUpdate,
  AgentModelStoreSnapshot,
  AgentProviderId,
  AgentProviderProtocol,
} from '../../shared/agent/protocol'

interface StoredAgentModelProfile extends AgentModelProfile {
  apiKey?: string
}

interface StoredAgentModelStore {
  activeProfileId: string
  profiles: StoredAgentModelProfile[]
}

export interface ProviderConfigWithSecret extends AgentConfigSnapshot {
  apiKey?: string
}

const PROVIDER_DEFAULTS: Record<AgentProviderId, { protocol: AgentProviderProtocol; baseURL: string; model: string; name: string }> = {
  openai: { protocol: 'openai-chat', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', name: 'OpenAI' },
  deepseek: { protocol: 'openai-chat', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat', name: 'DeepSeek' },
  anthropic: { protocol: 'anthropic', baseURL: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest', name: 'Anthropic' },
  google: { protocol: 'gemini', baseURL: 'https://generativelanguage.googleapis.com', model: 'gemini-1.5-flash-latest', name: 'Google Gemini' },
  openrouter: { protocol: 'openai-chat', baseURL: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', name: 'OpenRouter' },
  moonshot: { protocol: 'openai-chat', baseURL: 'https://api.moonshot.cn/v1', model: 'kimi-k2-turbo-preview', name: 'Moonshot' },
  siliconflow: { protocol: 'openai-chat', baseURL: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', name: 'SiliconFlow' },
  mistral: { protocol: 'openai-chat', baseURL: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', name: 'Mistral' },
  xai: { protocol: 'openai-chat', baseURL: 'https://api.x.ai/v1', model: 'grok-beta', name: 'xAI' },
  ollama: { protocol: 'ollama', baseURL: 'http://localhost:11434/v1', model: 'llama3.1', name: 'Ollama' },
  custom: { protocol: 'openai-chat', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', name: 'Custom' },
}

const DEFAULT_MODALITIES: AgentModelModality[] = ['text']

function configPath(): string {
  return join(app.getPath('userData'), 'agent', 'config.json')
}

function sanitizeProfile(profile: StoredAgentModelProfile): AgentModelProfile {
  const { apiKey: _apiKey, ...snapshot } = profile
  return {
    ...snapshot,
    apiKeyConfigured: Boolean(profile.apiKey?.trim()) || profile.providerId === 'ollama',
  }
}

function snapshotFromProfile(profile: StoredAgentModelProfile): AgentConfigSnapshot {
  const sanitized = sanitizeProfile(profile)
  return {
    profileId: sanitized.id,
    name: sanitized.name,
    providerId: sanitized.providerId,
    protocol: sanitized.protocol,
    baseURL: sanitized.baseURL,
    model: sanitized.model,
    apiKeyConfigured: sanitized.apiKeyConfigured,
    contextLengthTokens: sanitized.contextLengthTokens,
    modalities: sanitized.modalities,
  }
}

function normalizeModalities(raw?: AgentModelModality[]): AgentModelModality[] {
  const modalities = Array.isArray(raw)
    ? raw.filter((item): item is AgentModelModality => item === 'text' || item === 'image')
    : DEFAULT_MODALITIES
  return modalities.length > 0 ? modalities : DEFAULT_MODALITIES
}

function normalizeProviderId(providerId?: AgentProviderId): AgentProviderId {
  return providerId && providerId in PROVIDER_DEFAULTS ? providerId : 'openai'
}

function createProfile(raw: Partial<StoredAgentModelProfile> = {}, timestamp = Date.now()): StoredAgentModelProfile {
  const providerId = normalizeProviderId(raw.providerId)
  const defaults = PROVIDER_DEFAULTS[providerId]
  const id = raw.id?.trim() || `model_${randomUUID()}`
  const model = raw.model?.trim() || defaults.model
  const name = raw.name?.trim() || `${defaults.name} · ${model}`
  return {
    id,
    profileId: id,
    name,
    providerId,
    protocol: raw.protocol || defaults.protocol,
    baseURL: raw.baseURL?.trim() || defaults.baseURL,
    model,
    apiKey: raw.apiKey,
    apiKeyConfigured: Boolean(raw.apiKey?.trim()) || providerId === 'ollama',
    contextLengthTokens: raw.contextLengthTokens && raw.contextLengthTokens > 0 ? Math.floor(raw.contextLengthTokens) : 128_000,
    modalities: normalizeModalities(raw.modalities),
    createdAt: raw.createdAt || timestamp,
    updatedAt: raw.updatedAt || timestamp,
  }
}

function defaultStore(): StoredAgentModelStore {
  const profile = createProfile({ providerId: 'openai' })
  return { activeProfileId: profile.id, profiles: [profile] }
}

function normalizeStore(raw: unknown): StoredAgentModelStore {
  const timestamp = Date.now()
  const maybeStore = raw as Partial<StoredAgentModelStore> | undefined
  if (Array.isArray(maybeStore?.profiles)) {
    const profiles = maybeStore.profiles.map(profile => createProfile(profile, timestamp))
    const fallback = profiles[0] || createProfile({ providerId: 'openai' }, timestamp)
    const activeProfileId = profiles.some(profile => profile.id === maybeStore.activeProfileId) ? String(maybeStore.activeProfileId) : fallback.id
    return { activeProfileId, profiles: profiles.length > 0 ? profiles : [fallback] }
  }

  const legacy = raw as Partial<StoredAgentModelProfile> | undefined
  const migrated = createProfile({
    ...legacy,
    id: legacy?.id || 'default',
    name: legacy?.name || (legacy?.model ? `${PROVIDER_DEFAULTS[normalizeProviderId(legacy?.providerId)].name} · ${legacy.model}` : '默认模型'),
  }, timestamp)
  return { activeProfileId: migrated.id, profiles: [migrated] }
}

function readStore(): StoredAgentModelStore {
  const filePath = configPath()
  if (!existsSync(filePath)) return defaultStore()
  try {
    return normalizeStore(JSON.parse(readFileSync(filePath, 'utf8')) as unknown)
  } catch {
    return defaultStore()
  }
}

function writeStore(store: StoredAgentModelStore): StoredAgentModelStore {
  const normalized = normalizeStore(store)
  const filePath = configPath()
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}

function publicStore(store: StoredAgentModelStore): AgentModelStoreSnapshot {
  return {
    activeProfileId: store.activeProfileId,
    profiles: store.profiles.map(sanitizeProfile).sort((a, b) => b.updatedAt - a.updatedAt),
  }
}

function activeProfile(store = readStore()): StoredAgentModelProfile {
  return store.profiles.find(profile => profile.id === store.activeProfileId) || store.profiles[0] || createProfile({ providerId: 'openai' })
}

export function listAgentModelProfiles(): AgentModelStoreSnapshot {
  return publicStore(writeStore(readStore()))
}

export function readAgentConfig(): ProviderConfigWithSecret {
  return activeProfile(readStore())
}

export function readAgentConfigSnapshot(): AgentConfigSnapshot {
  return snapshotFromProfile(activeProfile(readStore()))
}

export function saveAgentConfig(update: AgentConfigUpdate): AgentConfigSnapshot {
  const profile = saveAgentModelProfile({ ...update, id: update.profileId, makeActive: true })
  return readAgentConfigSnapshotForProfile(profile.id)
}

export function saveAgentModelProfile(update: AgentModelProfileUpdate): AgentModelProfile {
  const store = readStore()
  const timestamp = Date.now()
  const existing = update.id ? store.profiles.find(profile => profile.id === update.id) : undefined
  const providerId = normalizeProviderId(update.providerId || existing?.providerId)
  const defaults = PROVIDER_DEFAULTS[providerId]
  const apiKey = update.apiKey === undefined ? existing?.apiKey : update.apiKey
  const next = createProfile({
    ...existing,
    id: existing?.id || update.id,
    name: update.name ?? existing?.name,
    providerId,
    protocol: update.protocol || existing?.protocol || defaults.protocol,
    baseURL: update.baseURL ?? existing?.baseURL ?? defaults.baseURL,
    model: update.model || existing?.model || defaults.model,
    apiKey,
    contextLengthTokens: update.contextLengthTokens ?? existing?.contextLengthTokens,
    modalities: update.modalities ?? existing?.modalities,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  }, timestamp)
  const profiles = existing ? store.profiles.map(profile => profile.id === next.id ? next : profile) : [next, ...store.profiles]
  const activeProfileId = update.makeActive === false ? store.activeProfileId : next.id
  writeStore({ activeProfileId, profiles })
  return sanitizeProfile(next)
}

export function selectAgentModelProfile(profileId: string): AgentConfigSnapshot {
  const store = readStore()
  if (!store.profiles.some(profile => profile.id === profileId)) throw new Error('模型配置不存在。')
  writeStore({ ...store, activeProfileId: profileId })
  return readAgentConfigSnapshotForProfile(profileId)
}

export function deleteAgentModelProfile(profileId: string): AgentModelStoreSnapshot {
  const store = readStore()
  if (store.profiles.length <= 1) throw new Error('至少需要保留一个模型配置。')
  const profiles = store.profiles.filter(profile => profile.id !== profileId)
  if (profiles.length === store.profiles.length) throw new Error('模型配置不存在。')
  const activeProfileId = store.activeProfileId === profileId
    ? profiles.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0].id
    : store.activeProfileId
  return publicStore(writeStore({ activeProfileId, profiles }))
}

export function readAgentConfigSnapshotForProfile(profileId: string): AgentConfigSnapshot {
  const store = readStore()
  const profile = store.profiles.find(item => item.id === profileId)
  if (!profile) throw new Error('模型配置不存在。')
  return snapshotFromProfile(profile)
}

export function getAgentConfigForProvider(profileId?: string): ProviderConfigWithSecret {
  const store = readStore()
  if (profileId) {
    const profile = store.profiles.find(item => item.id === profileId)
    if (!profile) throw new Error('模型配置不存在。')
    return profile
  }
  return activeProfile(store)
}

export function getProviderDefaults(providerId: AgentProviderId): AgentConfigSnapshot {
  return snapshotFromProfile(createProfile({ providerId }, Date.now()))
}
