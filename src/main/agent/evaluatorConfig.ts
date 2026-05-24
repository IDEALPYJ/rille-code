import type { AgentWorkspaceLocation } from '../../shared/agent/protocol'
import type { ProviderConfigWithSecret } from './config'
import { workspaceReadFile } from './workspace'
import { getAgentConfigForProvider, readAgentConfig } from './config'

export interface EvaluatorConfig {
  enabled: boolean
  triggerWhen: 'codeChanged' | 'always' | 'never'
  modelProfileId?: string
  maxTokens: number
  skepticism: 'low' | 'medium' | 'high'
  timeoutMs: number
  blocking: boolean
}

const DEFAULTS: EvaluatorConfig = {
  enabled: false,
  triggerWhen: 'codeChanged',
  maxTokens: 4096,
  skepticism: 'high',
  timeoutMs: 30_000,
  blocking: false,
}

interface PolicyFile {
  agent?: {
    evaluator?: Partial<{
      enabled: boolean
      triggerWhen: 'codeChanged' | 'always' | 'never'
      modelProfileId: string
      maxTokens: number
      skepticism: 'low' | 'medium' | 'high'
      timeoutMs: number
      blocking: boolean
    }>
  }
}

function isTriggerWhen(value: unknown): value is EvaluatorConfig['triggerWhen'] {
  return value === 'codeChanged' || value === 'always' || value === 'never'
}

function isSkepticism(value: unknown): value is EvaluatorConfig['skepticism'] {
  return value === 'low' || value === 'medium' || value === 'high'
}

async function readPolicyFile(workspace?: AgentWorkspaceLocation | null): Promise<PolicyFile | null> {
  if (!workspace) return null
  try {
    return JSON.parse(await workspaceReadFile(workspace, '.rille/policy.json')) as PolicyFile
  } catch {
    return null
  }
}

export async function readEvaluatorConfig(workspace?: AgentWorkspaceLocation | null): Promise<EvaluatorConfig> {
  const policy = await readPolicyFile(workspace)
  const raw = policy?.agent?.evaluator
  if (!raw) return { ...DEFAULTS }
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULTS.enabled,
    triggerWhen: isTriggerWhen(raw.triggerWhen) ? raw.triggerWhen : DEFAULTS.triggerWhen,
    modelProfileId: typeof raw.modelProfileId === 'string' && raw.modelProfileId.trim() ? raw.modelProfileId.trim() : undefined,
    maxTokens: typeof raw.maxTokens === 'number' && Number.isFinite(raw.maxTokens) && raw.maxTokens > 0 ? raw.maxTokens : DEFAULTS.maxTokens,
    skepticism: isSkepticism(raw.skepticism) ? raw.skepticism : DEFAULTS.skepticism,
    timeoutMs: typeof raw.timeoutMs === 'number' && Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0 ? raw.timeoutMs : DEFAULTS.timeoutMs,
    blocking: typeof raw.blocking === 'boolean' ? raw.blocking : DEFAULTS.blocking,
  }
}

export function shouldRunEvaluator(config: EvaluatorConfig, codeChanged: boolean): boolean {
  if (!config.enabled) return false
  if (config.triggerWhen === 'never') return false
  if (config.triggerWhen === 'always') return true
  return codeChanged
}

export function getEvaluatorModelConfig(preferredProfileId?: string): ProviderConfigWithSecret {
  if (preferredProfileId) {
    try {
      return getAgentConfigForProvider(preferredProfileId)
    } catch {
      // fall through to active config
    }
  }
  return readAgentConfig()
}
