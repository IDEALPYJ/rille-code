import type { AgentPermissionMode } from './protocol'

export type LegacyAgentPermissionMode = 'plan' | 'ask' | 'accept_edits' | 'auto' | 'bypass'

export function normalizeAgentPermissionMode(value: unknown): AgentPermissionMode {
  if (value === 'auto_review' || value === 'full_access' || value === 'default') return value
  if (value === 'accept_edits' || value === 'auto') return 'auto_review'
  if (value === 'bypass') return 'full_access'
  return 'default'
}
