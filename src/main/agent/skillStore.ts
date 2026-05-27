import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { basename, extname, join, resolve } from 'path'
import type { AgentWorkspaceLocation, ExtensionDiscoverySnapshot, McpServerConfig, PluginManifest, SkillContract, SkillSource, SkillTrust } from '../../shared/agent/protocol'

function now(): number {
  return Date.now()
}

function userDataRoot(): string {
  if (process.env.RILLE_AGENT_EXTENSION_USER_DATA) return join(process.env.RILLE_AGENT_EXTENSION_USER_DATA, 'agent')
  const root = typeof app?.getPath === 'function' ? app.getPath('userData') : join(tmpdir(), 'rillecode-test-user-data')
  return join(root, 'agent')
}

function safeReadJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function listFiles(dir: string, extensions: string[]): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const filePath = join(dir, entry)
    const stat = statSync(filePath)
    if (stat.isDirectory()) out.push(...listFiles(filePath, extensions))
    if (stat.isFile() && extensions.includes(extname(entry).toLowerCase())) out.push(filePath)
  }
  return out
}

function sourceRank(source: SkillSource): number {
  if (source === 'project') return 3
  if (source === 'plugin') return 2
  return 1
}

function normalizeSkill(raw: unknown, source: SkillSource, filePath: string, pluginId?: string): SkillContract | null {
  const timestamp = now()
  if (typeof raw === 'string') {
    const name = basename(filePath, extname(filePath))
    return {
      id: pluginId ? `${pluginId}.${name}` : name,
      name,
      description: raw.split(/\r?\n/).find(line => line.trim())?.slice(0, 160) || name,
      activationKeywords: [name],
      source,
      content: raw,
      priority: sourceRank(source) * 10,
      trust: source === 'project' ? 'trusted' : 'untrusted',
      pluginId,
      filePath,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }
  const data = raw as Partial<SkillContract>
  if (!data || typeof data !== 'object') return null
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : basename(filePath, extname(filePath))
  const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : pluginId ? `${pluginId}.${name}` : name
  const content = typeof data.content === 'string' ? data.content : ''
  if (!content.trim()) return null
  return {
    id,
    name,
    description: typeof data.description === 'string' ? data.description : name,
    activationKeywords: Array.isArray(data.activationKeywords) ? data.activationKeywords.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [name],
    source,
    content,
    priority: typeof data.priority === 'number' ? data.priority : sourceRank(source) * 10,
    trust: (data.trust === 'trusted' || data.trust === 'untrusted') ? data.trust : source === 'project' ? 'trusted' : 'untrusted',
    pluginId,
    filePath,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : timestamp,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : timestamp,
  }
}

function normalizeMcpServer(raw: unknown): McpServerConfig | null {
  const data = raw as Partial<McpServerConfig>
  if (!data || typeof data !== 'object') return null
  if (typeof data.id !== 'string' || !data.id.trim()) return null
  const transport = data.transport === 'http' || data.transport === 'sse' ? data.transport : 'stdio'
  const command = typeof data.command === 'string' && data.command.trim() ? data.command.trim() : undefined
  const url = typeof data.url === 'string' && data.url.trim() ? data.url.trim() : undefined
  if (transport === 'stdio' && !command) return null
  if ((transport === 'http' || transport === 'sse') && !url) return null
  return {
    id: data.id.trim(),
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : data.id.trim(),
    command,
    url,
    messageUrl: typeof data.messageUrl === 'string' && data.messageUrl.trim() ? data.messageUrl.trim() : undefined,
    headers: data.headers && typeof data.headers === 'object' ? data.headers as Record<string, string> : undefined,
    authHeaders: data.authHeaders && typeof data.authHeaders === 'object' ? data.authHeaders as Record<string, string> : undefined,
    cwd: typeof data.cwd === 'string' ? data.cwd : undefined,
    env: data.env && typeof data.env === 'object' ? data.env as Record<string, string> : undefined,
    transport,
    enabled: data.enabled !== false,
    sideEffect: data.sideEffect,
    timeoutMs: typeof data.timeoutMs === 'number' && data.timeoutMs > 0 ? Math.floor(data.timeoutMs) : undefined,
    heartbeatMs: typeof data.heartbeatMs === 'number' && data.heartbeatMs > 0 ? Math.floor(data.heartbeatMs) : undefined,
    reconnect: data.reconnect && typeof data.reconnect === 'object'
      ? { maxAttempts: Math.max(0, Math.floor(data.reconnect.maxAttempts || 0)), backoffMs: Math.max(0, Math.floor(data.reconnect.backoffMs || 0)) }
      : undefined,
  }
}

function normalizePlugin(raw: unknown, filePath: string): PluginManifest | null {
  const data = raw as Partial<PluginManifest>
  if (!data || typeof data !== 'object') return null
  if (typeof data.id !== 'string' || !data.id.trim()) return null
  const id = data.id.trim()
  const skills = Array.isArray(data.skills) ? data.skills.map((item, index) => normalizeSkill(item, 'plugin', `${filePath}#skill${index}`, id)).filter((item): item is SkillContract => Boolean(item)) : []
  const mcpServers = Array.isArray(data.mcpServers) ? data.mcpServers.map(normalizeMcpServer).filter((item): item is McpServerConfig => Boolean(item)) : []
  return {
    id,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : id,
    version: typeof data.version === 'string' ? data.version : '0.0.0',
    description: typeof data.description === 'string' ? data.description : id,
    skills,
    hooks: Array.isArray(data.hooks) ? data.hooks.filter((item): item is string => typeof item === 'string') : [],
    mcpServers,
    toolNamespaces: Array.isArray(data.toolNamespaces) ? data.toolNamespaces.filter((item): item is string => typeof item === 'string') : [id],
    enabled: data.enabled !== false,
    filePath,
  }
}

function skillDirs(workspace?: AgentWorkspaceLocation | null): Array<{ dir: string; source: SkillSource }> {
  const dirs: Array<{ dir: string; source: SkillSource }> = [{ dir: join(userDataRoot(), 'skills'), source: 'user' }]
  if (workspace?.kind === 'local' || workspace?.kind === 'worktree') dirs.unshift({ dir: join(workspace.path, '.rille', 'skills'), source: 'project' })
  return dirs
}

function pluginDirs(workspace?: AgentWorkspaceLocation | null): Array<{ dir: string; source: SkillSource }> {
  const dirs: Array<{ dir: string; source: SkillSource }> = [{ dir: join(userDataRoot(), 'plugins'), source: 'user' }]
  if (workspace?.kind === 'local' || workspace?.kind === 'worktree') dirs.unshift({ dir: join(workspace.path, '.rille', 'plugins'), source: 'project' })
  return dirs
}

export function discoverExtensions(workspace?: AgentWorkspaceLocation | null): ExtensionDiscoverySnapshot {
  mkdirSync(join(userDataRoot(), 'skills'), { recursive: true })
  mkdirSync(join(userDataRoot(), 'plugins'), { recursive: true })
  const conflicts: string[] = []
  const skills = new Map<string, SkillContract>()
  const plugins = new Map<string, PluginManifest>()
  const insertSkill = (skill: SkillContract) => {
    const current = skills.get(skill.id)
    if (current && (sourceRank(current.source) > sourceRank(skill.source) || current.priority >= skill.priority)) {
      conflicts.push(`skill:${skill.id}`)
      return
    }
    if (current) conflicts.push(`skill:${skill.id}`)
    skills.set(skill.id, skill)
  }
  for (const item of skillDirs(workspace)) {
    for (const filePath of listFiles(item.dir, ['.json', '.md'])) {
      const raw = extname(filePath).toLowerCase() === '.json' ? safeReadJson(filePath) : readFileSync(filePath, 'utf8')
      const skill = normalizeSkill(raw, item.source, filePath)
      if (skill) insertSkill(skill)
    }
  }
  for (const item of pluginDirs(workspace)) {
    for (const filePath of listFiles(item.dir, ['.json'])) {
      const plugin = normalizePlugin(safeReadJson(filePath), filePath)
      if (!plugin || !plugin.enabled) continue
      const current = plugins.get(plugin.id)
      if (current) conflicts.push(`plugin:${plugin.id}`)
      if (!current || item.source === 'project') plugins.set(plugin.id, plugin)
      for (const skill of plugin.skills) insertSkill({ ...skill, source: 'plugin', pluginId: plugin.id })
    }
  }
  return {
    skills: [...skills.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)),
    plugins: [...plugins.values()].sort((a, b) => a.id.localeCompare(b.id)),
    conflicts,
  }
}

export function findMatchingSkills(query: string, workspace?: AgentWorkspaceLocation | null, limit = 5): SkillContract[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return discoverExtensions(workspace).skills.filter(skill => {
    const haystack = [skill.id, skill.name, skill.description, ...skill.activationKeywords].join(' ').toLowerCase()
    return terms.length === 0 || terms.some(term => haystack.includes(term))
  }).slice(0, limit)
}

export function activateSkill(input: { skillId: string; reason: string; sessionId: string; turnId: string; workspace?: AgentWorkspaceLocation | null }) {
  const skill = discoverExtensions(input.workspace).skills.find(item => item.id === input.skillId)
  if (!skill) throw new Error(`Skill not found: ${input.skillId}`)
  return {
    skill,
    activation: {
      id: `skill_activation_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      sessionId: input.sessionId,
      turnId: input.turnId,
      skillId: skill.id,
      source: skill.source,
      reason: input.reason,
      createdAt: Date.now(),
    },
  }
}

export function resolvePluginCommandCwd(plugin: PluginManifest, server: McpServerConfig, workspace?: AgentWorkspaceLocation | null): string | undefined {
  if (server.cwd) return resolve(plugin.filePath ? resolve(plugin.filePath, '..', server.cwd) : server.cwd)
  if (workspace?.kind === 'local' || workspace?.kind === 'worktree') return workspace.path
  return plugin.filePath ? resolve(plugin.filePath, '..') : undefined
}
