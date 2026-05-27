import type {
  ContextActivationRecord,
  ContextSourceConflict,
  ContextSourceEntry,
  ContextSourceKind,
  ContextSourceSnapshot,
  ContextTrustLevel,
  RuleFrontmatter,
} from '../../shared/agent/protocol'

const RULE_FILE_PRIORITY: Record<string, number> = {
  'AGENTS.md': 100,
  'CLAUDE.md': 95,
  'RILLE.md': 90,
  '.rille/rules.md': 85,
  '.cursorrules': 75,
  'README.md': 30,
  '.rille/local.md': 25,
}

const CURSOR_RULES_DIR_PRIORITY = 70
const RILLE_RULES_DIR_PRIORITY = 80
const MEMORY_DEFAULT_PRIORITY = 85
const FEATURE_LIST_PRIORITY = 88
const MCP_TOOL_DEFAULT_PRIORITY = 34

function parseRuleFrontmatter(content: string): { frontmatter: RuleFrontmatter; body: string } {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) return { frontmatter: {}, body: content }

  const endIndex = trimmed.indexOf('---', 3)
  if (endIndex === -1) return { frontmatter: {}, body: content }

  const fmBlock = trimmed.slice(3, endIndex)
  const body = trimmed.slice(endIndex + 3).trimStart()
  const frontmatter: RuleFrontmatter = {}
  const lines = fmBlock.split('\n')
  let listKey: string | null = null
  let listValues: string[] = []

  function flushList(): void {
    if (listKey && listValues.length > 0) {
      if (listKey === 'scopes') {
        frontmatter.scopes = (frontmatter.scopes ?? []).concat(listValues)
      }
      listKey = null
      listValues = []
    }
  }

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine) { flushList(); continue }

    // YAML list item: "- value"
    if (trimmedLine.startsWith('- ') && listKey) {
      const item = trimmedLine.slice(2).trim().replace(/^["']|["']$/g, '')
      listValues.push(item)
      continue
    }

    flushList()

    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue
    const key = line.slice(0, colonIndex).trim()
    const rawValue = line.slice(colonIndex + 1).trim()

    if (key === 'scopes') {
      if (rawValue) {
        // Inline format: scopes: [a, b] or scopes: "a"
        frontmatter.scopes = rawValue
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map(s => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      } else {
        // Multi-line format: scopes:\n  - a\n  - b
        listKey = 'scopes'
      }
    } else if (key === 'activation') {
      const val = rawValue.replace(/^["']|["']$/g, '')
      if (val === 'always' || val === 'on_match' || val === 'on_demand') {
        frontmatter.activation = val
      }
    } else if (key === 'priority') {
      const num = Number(rawValue)
      if (!isNaN(num)) frontmatter.priority = num
    } else if (key === 'trust') {
      const val = rawValue.replace(/^["']|["']$/g, '') as ContextTrustLevel
      frontmatter.trust = val
    }
  }
  flushList()

  return { frontmatter, body }
}

function matchGlob(pattern: string, filePath: string): boolean {
  if (pattern === '*' || pattern === '**' || pattern === '**/*') return true
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/?/g, '__DOUBLE_STAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLE_STAR__/g, '(?:.*/)?')
  return new RegExp(`^${regexStr}$`).test(filePath)
}

export interface ResolvedRuleDoc {
  path: string
  text: string
  frontmatter: RuleFrontmatter
  effectivePriority: number
}

function resolveRulePriority(filePath: string, frontmatter: RuleFrontmatter): number {
  if (frontmatter.priority !== undefined) return frontmatter.priority
  if (RULE_FILE_PRIORITY[filePath] !== undefined) return RULE_FILE_PRIORITY[filePath]
  if (filePath.startsWith('.rille/rules/')) return RILLE_RULES_DIR_PRIORITY
  if (filePath.startsWith('.cursor/rules/')) return CURSOR_RULES_DIR_PRIORITY
  return 50
}

function resolveRuleActivation(filePath: string, frontmatter: RuleFrontmatter): 'always' | 'on_match' | 'on_demand' {
  if (frontmatter.activation) return frontmatter.activation
  if (frontmatter.scopes && frontmatter.scopes.length > 0) return 'on_match'
  return 'always'
}

function resolveRuleTrust(filePath: string, frontmatter: RuleFrontmatter): ContextTrustLevel {
  if (frontmatter.trust) return frontmatter.trust
  return 'workspace'
}

export class ContextSourceRegistry {
  private entries = new Map<string, ContextSourceEntry>()
  private activationLog: ContextActivationRecord[] = []
  private maxActivationLog = 200

  register(entry: ContextSourceEntry): void {
    this.entries.set(entry.id, entry)
  }

  unregister(id: string): boolean {
    return this.entries.delete(id)
  }

  get(id: string): ContextSourceEntry | undefined {
    return this.entries.get(id)
  }

  list(kind?: ContextSourceKind): ContextSourceEntry[] {
    const all = Array.from(this.entries.values())
    return kind ? all.filter(e => e.kind === kind) : all
  }

  getEnabled(): ContextSourceEntry[] {
    return this.list().filter(e => e.enabled && !e.stale)
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    entry.enabled = enabled
    return true
  }

  markStale(id: string): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    entry.stale = true
    return true
  }

  recordActivation(record: ContextActivationRecord): void {
    this.activationLog.push(record)
    if (this.activationLog.length > this.maxActivationLog) {
      this.activationLog = this.activationLog.slice(-this.maxActivationLog)
    }
  }

  getActivationTrace(turnId?: string): ContextActivationRecord[] {
    if (!turnId) return [...this.activationLog]
    return this.activationLog.filter(r => r.turnId === turnId)
  }

  registerRuleFile(args: {
    id: string
    filePath: string
    content: string
    scopes?: string[]
    enabled?: boolean
  }): ResolvedRuleDoc {
    const { frontmatter, body } = parseRuleFrontmatter(args.content)
    const effectivePriority = resolveRulePriority(args.filePath, frontmatter)
    const activation = resolveRuleActivation(args.filePath, frontmatter)
    const trust = resolveRuleTrust(args.filePath, frontmatter)
    const scopes = args.scopes ?? frontmatter.scopes

    const entry: ContextSourceEntry = {
      id: args.id,
      kind: args.filePath.includes('/') ? 'rule_directory' : 'rule_file',
      provider: args.filePath,
      location: args.filePath,
      priority: effectivePriority,
      trust,
      activation,
      scopes,
      enabled: args.enabled ?? true,
      metadata: frontmatter,
    }
    this.register(entry)

    return { path: args.filePath, text: body, frontmatter, effectivePriority }
  }

  registerMemorySource(workspacePath: string): ContextSourceEntry {
    const id = 'ctx_src_memory'
    const existing = this.entries.get(id)
    if (existing) return existing

    const entry: ContextSourceEntry = {
      id,
      kind: 'memory',
      provider: '.rille/memory.json',
      location: workspacePath,
      priority: MEMORY_DEFAULT_PRIORITY,
      trust: 'external',
      activation: 'always',
      enabled: true,
    }
    this.register(entry)
    return entry
  }

  registerFeatureListSource(workspacePath: string): ContextSourceEntry {
    const id = 'ctx_src_feature_list'
    const existing = this.entries.get(id)
    if (existing) return existing

    const entry: ContextSourceEntry = {
      id,
      kind: 'feature_list',
      provider: '.rille/features.json',
      location: workspacePath,
      priority: FEATURE_LIST_PRIORITY,
      trust: 'workspace',
      activation: 'always',
      enabled: true,
    }
    this.register(entry)
    return entry
  }

  registerSkillSource(skillId: string, name: string, location: string, priority: number, trust: ContextTrustLevel, keywords?: string[]): ContextSourceEntry {
    const id = `ctx_src_skill_${skillId}`
    const entry: ContextSourceEntry = {
      id,
      kind: 'skill',
      provider: `skill:${name}`,
      location,
      priority,
      trust,
      activation: 'on_match',
      activationKeywords: keywords,
      enabled: true,
    }
    this.register(entry)
    return entry
  }

  registerMcpSource(pluginId: string, serverId: string, toolName: string, toolNamespace: string): ContextSourceEntry {
    const id = `ctx_src_mcp_${pluginId}_${serverId}_${toolName}`
    const entry: ContextSourceEntry = {
      id,
      kind: 'mcp',
      provider: `mcp:${pluginId}.${serverId}`,
      location: toolNamespace,
      priority: MCP_TOOL_DEFAULT_PRIORITY,
      trust: 'external',
      activation: 'on_demand',
      enabled: true,
    }
    this.register(entry)
    return entry
  }

  private ignoreReasons = new Map<string, string>()

  recordIgnore(entryId: string, reason: string): void {
    this.ignoreReasons.set(entryId, reason)
  }

  getIgnoreReason(entryId: string): string | undefined {
    return this.ignoreReasons.get(entryId)
  }

  getIgnoreReasons(): Array<{ entryId: string; reason: string }> {
    return Array.from(this.ignoreReasons.entries()).map(([entryId, reason]) => ({ entryId, reason }))
  }

  resolveConflicts(entries?: ContextSourceEntry[]): ContextSourceConflict[] {
    const items = entries ?? this.getEnabled()
    const conflicts: ContextSourceConflict[] = []
    const seen = new Map<string, ContextSourceEntry>()

    for (const entry of items) {
      const key = `${entry.kind}:${entry.provider}`
      if (seen.has(key)) {
        const prev = seen.get(key)!
        conflicts.push({
          entryA: prev.id,
          entryB: entry.id,
          kind: 'duplicate_rule',
          description: `Duplicate source: ${entry.provider} from ${entry.location}`,
          resolvedBy: entry.priority > prev.priority ? 'priority' : entry.trust === 'system' && prev.trust !== 'system' ? 'trust' : 'none',
          resolution: entry.priority > prev.priority
            ? `Higher priority ${entry.provider} (${entry.priority} > ${prev.priority}) overrides`
            : 'No clear resolution — both sources loaded',
        })
      } else {
        seen.set(key, entry)
      }
    }

    return conflicts
  }

  checkScopeMatch(entry: ContextSourceEntry, activeFilePath?: string): boolean {
    if (!activeFilePath) return true
    if (!entry.scopes || entry.scopes.length === 0) return true
    if (entry.scopes.includes('*')) return true
    return entry.scopes.some(scope => matchGlob(scope, activeFilePath))
  }

  isActivationAllowed(entry: ContextSourceEntry, turnText?: string): boolean {
    if (!entry.enabled || entry.stale) return false
    if (entry.activation === 'always') return true
    if (entry.activation === 'on_match' && turnText && entry.activationKeywords) {
      const lower = turnText.toLowerCase()
      return entry.activationKeywords.some(kw => lower.includes(kw.toLowerCase()))
    }
    return true
  }

  toSnapshot(): ContextSourceSnapshot {
    return {
      entries: this.list(),
      activationTrace: this.activationLog.slice(-50),
      conflicts: this.resolveConflicts(),
      generatedAt: Date.now(),
    }
  }
}

export { matchGlob, parseRuleFrontmatter, resolveRulePriority, resolveRuleActivation, resolveRuleTrust, RULE_FILE_PRIORITY, CURSOR_RULES_DIR_PRIORITY, RILLE_RULES_DIR_PRIORITY, MEMORY_DEFAULT_PRIORITY, FEATURE_LIST_PRIORITY, MCP_TOOL_DEFAULT_PRIORITY }
