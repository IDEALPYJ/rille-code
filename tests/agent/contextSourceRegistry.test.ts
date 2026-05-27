import { describe, expect, it } from 'vitest'
import {
  ContextSourceRegistry,
  FEATURE_LIST_PRIORITY,
  MEMORY_DEFAULT_PRIORITY,
  MCP_TOOL_DEFAULT_PRIORITY,
  matchGlob,
  parseRuleFrontmatter,
  resolveRuleActivation,
  resolveRulePriority,
} from '../../src/main/agent/contextSourceRegistry'

describe('parseRuleFrontmatter', () => {
  it('returns empty frontmatter and original body for content without frontmatter', () => {
    const result = parseRuleFrontmatter('# Rule\nsome content')
    expect(result.frontmatter).toEqual({})
    expect(result.body).toBe('# Rule\nsome content')
  })

  it('parses scopes from frontmatter', () => {
    const result = parseRuleFrontmatter('---\nscopes:\n  - "src/**/*.ts"\n  - "test/**/*.ts"\n---\n# Rule\ncontent')
    expect(result.frontmatter.scopes).toEqual(['src/**/*.ts', 'test/**/*.ts'])
    expect(result.body).toBe('# Rule\ncontent')
  })

  it('parses activation from frontmatter', () => {
    const result = parseRuleFrontmatter('---\nactivation: on_match\n---\n# Rule')
    expect(result.frontmatter.activation).toBe('on_match')
  })

  it('parses priority from frontmatter', () => {
    const result = parseRuleFrontmatter('---\npriority: 95\n---\n# Rule')
    expect(result.frontmatter.priority).toBe(95)
  })

  it('ignores invalid activation values', () => {
    const result = parseRuleFrontmatter('---\nactivation: invalid_value\n---\n# Rule')
    expect(result.frontmatter.activation).toBeUndefined()
  })

  it('handles content starting with --- that is not frontmatter', () => {
    const result = parseRuleFrontmatter('---\njust separator\nno closing')
    expect(result.frontmatter).toEqual({})
    expect(result.body).toBe('---\njust separator\nno closing')
  })

  it('parses inline bracket scopes', () => {
    const result = parseRuleFrontmatter('---\nscopes: [src/**/*.ts, test/**/*.ts]\n---\nbody')
    expect(result.frontmatter.scopes).toEqual(['src/**/*.ts', 'test/**/*.ts'])
  })
})

describe('matchGlob', () => {
  it('matches wildcard patterns', () => {
    expect(matchGlob('*', 'any-file')).toBe(true)
    expect(matchGlob('**', 'any/file/path')).toBe(true)
  })

  it('matches single-star patterns', () => {
    expect(matchGlob('*.ts', 'file.ts')).toBe(true)
    expect(matchGlob('*.ts', 'file.js')).toBe(false)
    expect(matchGlob('*.ts', 'dir/file.ts')).toBe(false)
  })

  it('matches double-star patterns', () => {
    expect(matchGlob('src/**/*.ts', 'src/main/agent/file.ts')).toBe(true)
    expect(matchGlob('src/**/*.ts', 'src/file.ts')).toBe(true)
    expect(matchGlob('src/**/*.ts', 'test/file.ts')).toBe(false)
  })

  it('matches literal path patterns', () => {
    expect(matchGlob('src/main/agent/context.ts', 'src/main/agent/context.ts')).toBe(true)
    expect(matchGlob('src/main/agent/context.ts', 'src/main/agent/other.ts')).toBe(false)
  })

  it('matches wildcard-star patterns', () => {
    expect(matchGlob('src/**/*', 'src/a/b/c/d')).toBe(true)
    expect(matchGlob('src/**/*', 'other/file')).toBe(false)
  })

  it('handles regex special characters safely', () => {
    expect(matchGlob('src/main+agent/file.ts', 'src/main+agent/file.ts')).toBe(true)
    expect(matchGlob('file.[jt]s', 'file.ts')).toBe(false)
  })
})

describe('resolveRulePriority', () => {
  it('returns frontmatter priority when set', () => {
    expect(resolveRulePriority('AGENTS.md', { priority: 50 })).toBe(50)
  })

  it('returns built-in priority for known files', () => {
    expect(resolveRulePriority('AGENTS.md', {})).toBe(100)
    expect(resolveRulePriority('CLAUDE.md', {})).toBe(95)
    expect(resolveRulePriority('RILLE.md', {})).toBe(90)
    expect(resolveRulePriority('.rille/rules.md', {})).toBe(85)
    expect(resolveRulePriority('.cursorrules', {})).toBe(75)
  })

  it('returns directory priority for .rille/rules/ files', () => {
    expect(resolveRulePriority('.rille/rules/security.md', {})).toBe(80)
  })

  it('returns directory priority for .cursor/rules/ files', () => {
    expect(resolveRulePriority('.cursor/rules/test.md', {})).toBe(70)
  })

  it('returns default 50 for unknown files', () => {
    expect(resolveRulePriority('unknown.md', {})).toBe(50)
  })
})

describe('resolveRuleActivation', () => {
  it('returns frontmatter activation when set', () => {
    expect(resolveRuleActivation('file.md', { activation: 'on_match' })).toBe('on_match')
  })

  it('returns on_match when scopes are present without explicit activation', () => {
    expect(resolveRuleActivation('file.md', { scopes: ['src/**/*.ts'] })).toBe('on_match')
  })

  it('defaults to always for rules without scopes or activation', () => {
    expect(resolveRuleActivation('file.md', {})).toBe('always')
  })
})

describe('ContextSourceRegistry', () => {
  it('registers and retrieves entries', () => {
    const registry = new ContextSourceRegistry()
    registry.register({
      id: 'test_1',
      kind: 'rule_file',
      provider: 'AGENTS.md',
      location: 'AGENTS.md',
      priority: 100,
      trust: 'workspace',
      activation: 'always',
      enabled: true,
    })
    expect(registry.get('test_1')).toMatchObject({ provider: 'AGENTS.md' })
  })

  it('lists entries by kind', () => {
    const registry = new ContextSourceRegistry()
    registry.register({ id: 'r1', kind: 'rule_file', provider: 'A', location: 'A', priority: 100, trust: 'workspace', activation: 'always', enabled: true })
    registry.register({ id: 'm1', kind: 'memory', provider: 'mem', location: 'mem', priority: 85, trust: 'external', activation: 'always', enabled: true })

    expect(registry.list('rule_file')).toHaveLength(1)
    expect(registry.list('memory')).toHaveLength(1)
    expect(registry.list()).toHaveLength(2)
  })

  it('filters enabled entries', () => {
    const registry = new ContextSourceRegistry()
    registry.register({ id: 'r1', kind: 'rule_file', provider: 'A', location: 'A', priority: 100, trust: 'workspace', activation: 'always', enabled: false })
    registry.register({ id: 'r2', kind: 'rule_file', provider: 'B', location: 'B', priority: 90, trust: 'workspace', activation: 'always', enabled: true })

    const enabled = registry.getEnabled()
    expect(enabled).toHaveLength(1)
    expect(enabled[0].id).toBe('r2')
  })

  it('excludes stale entries from enabled list', () => {
    const registry = new ContextSourceRegistry()
    registry.register({ id: 'r1', kind: 'rule_file', provider: 'A', location: 'A', priority: 100, trust: 'workspace', activation: 'always', enabled: true, stale: true })

    expect(registry.getEnabled()).toHaveLength(0)
  })

  it('toggles entry enabled state', () => {
    const registry = new ContextSourceRegistry()
    registry.register({ id: 'r1', kind: 'rule_file', provider: 'A', location: 'A', priority: 100, trust: 'workspace', activation: 'always', enabled: true })

    expect(registry.setEnabled('r1', false)).toBe(true)
    expect(registry.get('r1')?.enabled).toBe(false)
    expect(registry.setEnabled('nonexistent', true)).toBe(false)
  })

  it('marks entries as stale', () => {
    const registry = new ContextSourceRegistry()
    registry.register({ id: 'r1', kind: 'rule_file', provider: 'A', location: 'A', priority: 100, trust: 'workspace', activation: 'always', enabled: true })

    expect(registry.markStale('r1')).toBe(true)
    expect(registry.get('r1')?.stale).toBe(true)
    expect(registry.markStale('nonexistent')).toBe(false)
  })

  it('unregisters entries', () => {
    const registry = new ContextSourceRegistry()
    registry.register({ id: 'r1', kind: 'rule_file', provider: 'A', location: 'A', priority: 100, trust: 'workspace', activation: 'always', enabled: true })
    expect(registry.unregister('r1')).toBe(true)
    expect(registry.get('r1')).toBeUndefined()
    expect(registry.unregister('r1')).toBe(false)
  })

  it('records and retrieves activation trace', () => {
    const registry = new ContextSourceRegistry()
    registry.recordActivation({
      entryId: 'r1',
      turnId: 'turn_1',
      activatedAt: Date.now(),
      reason: 'always',
      fragmentId: 'frag_1',
    })
    registry.recordActivation({
      entryId: 'r2',
      turnId: 'turn_2',
      activatedAt: Date.now(),
      reason: 'keyword_matched',
      fragmentId: 'frag_2',
    })

    expect(registry.getActivationTrace()).toHaveLength(2)
    expect(registry.getActivationTrace('turn_1')).toHaveLength(1)
    expect(registry.getActivationTrace('turn_1')[0]).toMatchObject({ entryId: 'r1', reason: 'always' })
  })

  it('registers rule files with frontmatter parsing', () => {
    const registry = new ContextSourceRegistry()
    const result = registry.registerRuleFile({
      id: 'rule_1',
      filePath: 'AGENTS.md',
      content: '---\nscopes:\n  - src/**/*.ts\npriority: 95\n---\n# Rule Content',
    })

    expect(result.effectivePriority).toBe(95)
    expect(result.frontmatter.scopes).toEqual(['src/**/*.ts'])
    expect(result.text).toBe('# Rule Content')
    expect(result.path).toBe('AGENTS.md')

    const entry = registry.get('rule_1')
    expect(entry).toMatchObject({ activation: 'on_match', priority: 95 })
  })

  it('registers memory sources', () => {
    const registry = new ContextSourceRegistry()
    const entry = registry.registerMemorySource('/workspace')
    expect(entry).toMatchObject({ kind: 'memory', priority: MEMORY_DEFAULT_PRIORITY, trust: 'external' })
    // idempotent
    expect(registry.registerMemorySource('/workspace').id).toBe(entry.id)
  })

  it('registers feature list sources', () => {
    const registry = new ContextSourceRegistry()
    const entry = registry.registerFeatureListSource('/workspace')
    expect(entry).toMatchObject({ kind: 'feature_list', priority: FEATURE_LIST_PRIORITY })
    expect(registry.registerFeatureListSource('/workspace').id).toBe(entry.id)
  })

  it('registers skill sources', () => {
    const registry = new ContextSourceRegistry()
    const entry = registry.registerSkillSource('verify', 'Verify Skill', '.rille/skills/verify.json', 50, 'workspace', ['verify', 'test'])
    expect(entry).toMatchObject({ kind: 'skill', activation: 'on_match', activationKeywords: ['verify', 'test'] })
  })

  it('registers MCP sources', () => {
    const registry = new ContextSourceRegistry()
    const entry = registry.registerMcpSource('plugin', 'server', 'tool', 'mcp.plugin.server.toolName')
    expect(entry).toMatchObject({ kind: 'mcp', priority: MCP_TOOL_DEFAULT_PRIORITY, trust: 'external' })
  })

  it('detects duplicate source conflicts', () => {
    const registry = new ContextSourceRegistry()
    registry.register({ id: 'r1', kind: 'rule_file', provider: 'AGENTS.md', location: 'AGENTS.md', priority: 100, trust: 'workspace', activation: 'always', enabled: true })
    registry.register({ id: 'r2', kind: 'rule_file', provider: 'AGENTS.md', location: 'alt/AGENTS.md', priority: 90, trust: 'workspace', activation: 'always', enabled: true })

    const conflicts = registry.resolveConflicts()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ kind: 'duplicate_rule', entryA: 'r1', entryB: 'r2' })
  })

  it('checks scope matching', () => {
    const registry = new ContextSourceRegistry()
    registry.register({
      id: 'r1', kind: 'rule_file', provider: 'A', location: 'A', priority: 100, trust: 'workspace',
      activation: 'on_match', scopes: ['src/**/*.ts'], enabled: true,
    })
    const entry = registry.get('r1')!

    expect(registry.checkScopeMatch(entry, 'src/main/agent/file.ts')).toBe(true)
    expect(registry.checkScopeMatch(entry, 'README.md')).toBe(false)
    expect(registry.checkScopeMatch(entry, undefined)).toBe(true)
  })

  it('checks activation is allowed', () => {
    const registry = new ContextSourceRegistry()
    registry.register({
      id: 'r1', kind: 'rule_file', provider: 'A', location: 'A', priority: 100, trust: 'workspace',
      activation: 'always', enabled: true,
    })
    let entry = registry.get('r1')!
    expect(registry.isActivationAllowed(entry)).toBe(true)

    registry.register({
      id: 'r2', kind: 'skill', provider: 'B', location: 'B', priority: 50, trust: 'workspace',
      activation: 'on_match', activationKeywords: ['verify'], enabled: true,
    })
    entry = registry.get('r2')!
    expect(registry.isActivationAllowed(entry, 'please verify this change')).toBe(true)
    expect(registry.isActivationAllowed(entry, 'nothing matching')).toBe(false) // 'on_match' without keyword match → not activated
    expect(registry.isActivationAllowed({ ...entry, enabled: false }, 'verify')).toBe(false)
  })

  it('produces snapshot', () => {
    const registry = new ContextSourceRegistry()
    registry.register({ id: 'r1', kind: 'rule_file', provider: 'A', location: 'A', priority: 100, trust: 'workspace', activation: 'always', enabled: true })
    registry.recordActivation({ entryId: 'r1', turnId: 'turn_1', activatedAt: Date.now(), reason: 'always', fragmentId: 'frag_1' })

    const snap = registry.toSnapshot()
    expect(snap.entries).toHaveLength(1)
    expect(snap.activationTrace).toHaveLength(1)
    expect(snap.conflicts).toEqual([])
    expect(snap.generatedAt).toBeGreaterThan(0)
  })
})
