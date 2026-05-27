import type { AgentWorkspaceLocation, SubagentFallbackMode, SubagentRole } from '../../shared/agent/protocol'
import { workspaceReadFile } from './workspace'

export interface SubagentRolePolicy {
  modelProfileId?: string
}

export interface SubagentPolicyConfig {
  fallbackMode: SubagentFallbackMode
  executionMode: 'local_worktree'
  maxIterations: number
  timeoutMs: number
  roles: Partial<Record<SubagentRole, SubagentRolePolicy>>
}

const DEFAULTS: SubagentPolicyConfig = {
  fallbackMode: 'visible_deterministic',
  executionMode: 'local_worktree',
  maxIterations: 6,
  timeoutMs: 120_000,
  roles: {},
}

interface PolicyFile {
  agent?: {
    subagents?: Partial<{
      fallbackMode: SubagentFallbackMode
      executionMode: 'local_worktree' | 'remote_worker'
      maxIterations: number
      timeoutMs: number
      roles: Partial<Record<SubagentRole, SubagentRolePolicy>>
      reviewer: SubagentRolePolicy
      verifier: SubagentRolePolicy
      explorer: SubagentRolePolicy
      advisor: SubagentRolePolicy
    }>
  }
}

function isFallbackMode(value: unknown): value is SubagentFallbackMode {
  return value === 'strict' || value === 'visible_deterministic'
}

function rolePolicy(value: unknown): SubagentRolePolicy | undefined {
  const raw = value as SubagentRolePolicy | undefined
  if (!raw || typeof raw !== 'object') return undefined
  return typeof raw.modelProfileId === 'string' && raw.modelProfileId.trim()
    ? { modelProfileId: raw.modelProfileId.trim() }
    : {}
}

async function readPolicyFile(workspace?: AgentWorkspaceLocation | null): Promise<PolicyFile | null> {
  if (!workspace) return null
  try {
    return JSON.parse(await workspaceReadFile(workspace, '.rille/policy.json')) as PolicyFile
  } catch {
    return null
  }
}

export async function readSubagentPolicyConfig(workspace?: AgentWorkspaceLocation | null): Promise<SubagentPolicyConfig> {
  const policy = await readPolicyFile(workspace)
  const raw = policy?.agent?.subagents
  if (!raw) return { ...DEFAULTS, roles: {} }
  const roles: Partial<Record<SubagentRole, SubagentRolePolicy>> = { ...(raw.roles || {}) }
  for (const role of ['reviewer', 'verifier', 'explorer', 'advisor'] as const) {
    const direct = rolePolicy(raw[role])
    if (direct) roles[role] = direct
  }
  return {
    fallbackMode: isFallbackMode(raw.fallbackMode) ? raw.fallbackMode : DEFAULTS.fallbackMode,
    executionMode: raw.executionMode === 'local_worktree' ? 'local_worktree' : DEFAULTS.executionMode,
    maxIterations: typeof raw.maxIterations === 'number' && Number.isFinite(raw.maxIterations) && raw.maxIterations > 0 ? Math.floor(raw.maxIterations) : DEFAULTS.maxIterations,
    timeoutMs: typeof raw.timeoutMs === 'number' && Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0 ? Math.floor(raw.timeoutMs) : DEFAULTS.timeoutMs,
    roles,
  }
}
