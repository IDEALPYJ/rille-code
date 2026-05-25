import { randomUUID } from 'crypto'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type {
  AgentContextSnapshot,
  AgentPermissionMode,
  ApprovalRequest,
  CommandSubject,
  GrantScope,
  GuardianDecision,
  PermissionGrant,
  PolicyDecision,
  PolicyPermission,
  PolicyRule,
  RiskLevel,
  ToolResultView,
} from '../../shared/agent/protocol'
import { getRegisteredTool, isModelVisibleTool, type RuntimeToolCall } from './tools'
import { listMcpTools, registerMcpToolDescriptors } from './mcpManager'
import { needsShell, workspaceReadFile } from './workspace'

export type CommandRisk =
  | 'read_only'
  | 'test'
  | 'install'
  | 'write_workspace'
  | 'git_write'
  | 'network'
  | 'destructive'
  | 'deploy'

export type PermissionDecision =
  | { action: 'allow'; reason: string; policyDecision: PolicyDecision }
  | { action: 'ask'; reason: string; request: ApprovalRequest; policyDecision: PolicyDecision }
  | { action: 'deny'; reason: string; policyDecision: PolicyDecision }

interface ProjectPolicyFile {
  agent?: {
    permissions?: PolicyRule[]
    verification?: {
      commands?: string[]
    }
  }
}

export class DenialTracker {
  private readonly consecutiveByPattern = new Map<string, number>()
  private total = 0

  record(pattern: string): boolean {
    this.total += 1
    const next = (this.consecutiveByPattern.get(pattern) || 0) + 1
    this.consecutiveByPattern.set(pattern, next)
    return next >= 3 || this.total > 10
  }
}

export class PermissionGrantStore {
  private readonly grants: PermissionGrant[] = []

  add(input: { permission: PolicyPermission; pattern: string; scope: GrantScope; action?: 'allow' | 'deny'; expiresAt?: number }): PermissionGrant {
    const grant: PermissionGrant = {
      id: `grant_${randomUUID()}`,
      permission: input.permission,
      pattern: input.pattern,
      action: input.action || 'allow',
      scope: input.scope,
      expiresAt: input.expiresAt,
      createdAt: Date.now(),
    }
    this.grants.push(grant)
    return grant
  }

  match(permission: PolicyPermission, pattern: string, now = Date.now()): PermissionGrant | null {
    for (let index = 0; index < this.grants.length; index += 1) {
      const grant = this.grants[index]
      if (grant.expiresAt && grant.expiresAt <= now) continue
      if (grant.permission !== permission) continue
      if (!patternMatches(grant.pattern, pattern)) continue
      if (grant.scope === 'once') this.grants.splice(index, 1)
      return grant
    }
    return null
  }
}

function grantRoot(): string {
  const userData = typeof app?.getPath === 'function' ? app.getPath('userData') : join(tmpdir(), 'rillecode-test-user-data')
  return join(userData, 'agent', 'workspace-grants.json')
}

export class WorkspacePermissionGrantStore {
  private grants: PermissionGrant[] = []

  load(): this {
    const path = grantRoot()
    if (!existsSync(path)) {
      this.grants = []
      return this
    }
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { grants?: PermissionGrant[] }
      this.grants = Array.isArray(parsed.grants) ? parsed.grants : []
    } catch {
      this.grants = []
    }
    return this
  }

  save(): void {
    const path = grantRoot()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ grants: this.grants }, null, 2), 'utf8')
  }

  add(input: { workspaceKey: string; permission: PolicyPermission; pattern: string; action?: 'allow' | 'deny'; expiresAt?: number }): PermissionGrant {
    const grant: PermissionGrant = {
      id: `grant_${randomUUID()}`,
      permission: input.permission,
      pattern: input.pattern,
      action: input.action || 'allow',
      scope: 'workspace',
      workspaceKey: input.workspaceKey,
      expiresAt: input.expiresAt,
      createdAt: Date.now(),
    }
    this.grants = [grant, ...this.grants.filter(item => !(item.workspaceKey === grant.workspaceKey && item.permission === grant.permission && item.pattern === grant.pattern))]
    this.save()
    return grant
  }

  revoke(grantId: string): boolean {
    const before = this.grants.length
    this.grants = this.grants.filter(grant => grant.id !== grantId)
    this.save()
    return this.grants.length !== before
  }

  list(workspaceKey?: string, now = Date.now()): PermissionGrant[] {
    return this.grants.filter(grant => (!workspaceKey || grant.workspaceKey === workspaceKey) && (!grant.expiresAt || grant.expiresAt > now))
  }

  match(workspaceKey: string, permission: PolicyPermission, patterns: string[], now = Date.now()): PermissionGrant | null {
    return this.list(workspaceKey, now).find(grant => grant.permission === permission && patterns.some(pattern => patternMatches(grant.pattern, pattern))) ?? null
  }
}

export function workspaceGrantKey(context?: AgentContextSnapshot): string | null {
  const workspace = context?.workspace
  if (!workspace) return null
  return `${workspace.kind}:${workspace.connectionId || workspace.targetId || 'local'}:${workspace.path}`
}

export function addWorkspacePermissionGrant(input: { context?: AgentContextSnapshot; permission: PolicyPermission; pattern: string; expiresAt?: number }): PermissionGrant | null {
  const key = workspaceGrantKey(input.context)
  if (!key) return null
  return new WorkspacePermissionGrantStore().load().add({ workspaceKey: key, permission: input.permission, pattern: input.pattern, expiresAt: input.expiresAt })
}

function commandPattern(call: RuntimeToolCall): string {
  const commandLine = typeof call.input.commandLine === 'string' ? call.input.commandLine.trim() : ''
  const subject = parseCommandSubject(commandLine)
  return `${call.name}:${subject.primary}${subject.args[0] ? ` ${subject.args[0]}` : ''}`.trim()
}

function isDangerousCommand(commandLine: string): boolean {
  return /\b(rm\s+-rf\s+\/|sudo\s+rm|mkfs|diskpart|shutdown|reboot|git\s+push|npm\s+publish|pnpm\s+publish)\b/i.test(commandLine)
}

function isShellWriteCommand(commandLine: string): boolean {
  return /(^|[^<])>{1,2}($|[^>])/.test(commandLine)
    || /^\s*(touch|mkdir|copy|xcopy|cp|mv|rm|del|erase|rmdir|new-item|set-content|add-content|out-file)\b/i.test(commandLine)
}

function tokenizeCommand(commandLine: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false
  for (const char of commandLine) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaping = true
      continue
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char
      continue
    }
    if (!quote && /\s/.test(char)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    if (!quote && ['|', '>', '<', ';', '&'].includes(char)) {
      if (current) tokens.push(current)
      tokens.push(char)
      current = ''
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

export function parseCommandSubject(commandLine: string): CommandSubject {
  const raw = commandLine.trim()
  const tokens = tokenizeCommand(raw)
  const envAssignments = tokens.filter(token => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token))
  const commandTokens = tokens.filter(token => !envAssignments.includes(token))
  const controlIndex = commandTokens.findIndex(token => ['|', '>', '<', ';', '&'].includes(token) || token === '&&' || token === '||')
  const primaryTokens = (controlIndex >= 0 ? commandTokens.slice(0, controlIndex) : commandTokens).filter(Boolean)
  const primary = (primaryTokens[0] || '').toLowerCase()
  const args = primaryTokens.slice(1).map(token => token.toLowerCase())
  const subjects = [
    primary ? `command:${primary}${args[0] ? ` ${args[0]}` : ''}` : 'command:',
    primary === 'git' && args[0] ? `git:${args[0]}` : '',
    ['npm', 'pnpm', 'yarn', 'bun'].includes(primary) && args[0] ? `package:${primary} ${args[0]}` : '',
    commandTokens.includes('|') ? 'shell:pipe' : '',
    commandTokens.some(token => token === '>' || token === '<') ? 'shell:redirect:file' : '',
    /[`$]\(/.test(raw) ? 'shell:subshell' : '',
    /&&|\|\||;/.test(raw) ? 'shell:chain' : '',
  ].filter(Boolean)
  return {
    raw,
    primary,
    args,
    arity: args.length,
    subjects,
    usesShell: needsShell(commandLine),
    hasPipe: commandTokens.includes('|'),
    hasRedirect: commandTokens.some(token => token === '>' || token === '<') || />{1,2}/.test(raw),
    hasSubshell: /[`$]\(/.test(raw),
    hasChain: /&&|\|\||;/.test(raw),
    envAssignments,
  }
}

function firstTokens(commandLine: string): string[] {
  const subject = parseCommandSubject(commandLine)
  return [subject.primary, ...subject.args].slice(0, 4)
}

export function classifyCommandRisk(commandLine: string): CommandRisk {
  const normalized = commandLine.trim().toLowerCase()
  const subject = parseCommandSubject(commandLine)
  const tokens = firstTokens(commandLine)
  const [cmd, sub] = tokens
  if (!normalized) return 'read_only'
  if (subject.hasRedirect || subject.hasSubshell || subject.hasChain) return 'write_workspace'
  if (/\b(deploy|release|publish)\b/.test(normalized) || (cmd === 'git' && sub === 'push')) return 'deploy'
  if (isDangerousCommand(commandLine) || /\b(rm\s+-rf|del\s+\/[fsq]|format|mkfs|diskpart|shutdown|reboot)\b/i.test(commandLine)) return 'destructive'
  if (cmd === 'git' && ['commit', 'merge', 'rebase', 'reset', 'checkout', 'switch', 'stash', 'tag', 'branch'].includes(sub || '')) return 'git_write'
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(cmd || '') && ['install', 'add', 'remove', 'update'].includes(sub || '')) return 'install'
  if (/\b(curl|wget|scp|ssh|rsync)\b/.test(normalized)) return 'network'
  if (isShellWriteCommand(commandLine)) return 'write_workspace'
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(cmd || '') && /\b(test|typecheck|lint|build|check)\b/.test(tokens.join(' '))) return 'test'
  if (cmd === 'git' && ['status', 'diff', 'log', 'show'].includes(sub || '')) return 'read_only'
  if (['ls', 'dir', 'pwd', 'cat', 'type', 'rg', 'grep', 'find'].includes(cmd || '')) return 'read_only'
  return needsShell(commandLine) ? 'write_workspace' : 'test'
}

export function classifyGuardian(commandLine: string): GuardianDecision {
  const subject = parseCommandSubject(commandLine)
  const normalized = commandLine.toLowerCase()
  if (/\b(api[_-]?key|token|password|secret)\b/.test(normalized) && /\b(curl|wget|scp|ssh|rsync)\b/.test(normalized)) {
    return { verdict: 'deny', risk: 'critical', reason: '疑似将凭据或 secret 通过网络外传。', recommendedAction: 'deny', classifier: 'deterministic' }
  }
  if (/\b(npm|pnpm|yarn|bun)\s+publish\b|\bgit\s+push\b|\bdeploy\b/.test(normalized)) {
    return { verdict: 'deny', risk: 'critical', reason: '发布、部署或推送命令需要用户手动执行。', recommendedAction: 'deny', classifier: 'deterministic' }
  }
  if (/\b(rm\s+-rf\s+\/|sudo\s+rm|mkfs|diskpart|shutdown|reboot)\b/i.test(commandLine)) {
    return { verdict: 'deny', risk: 'critical', reason: '破坏性系统命令。', recommendedAction: 'deny', classifier: 'deterministic' }
  }
  if (subject.hasSubshell || (subject.hasPipe && /\b(curl|wget|nc|netcat)\b/.test(normalized))) {
    return { verdict: 'ask', risk: 'high', reason: '复杂 shell 或网络管道需要人工确认。', recommendedAction: 'ask', classifier: 'deterministic' }
  }
  if (subject.hasRedirect) {
    return { verdict: 'ask', risk: 'high', reason: '命令包含文件重定向，应优先使用 diff proposal。', recommendedAction: 'ask', classifier: 'deterministic' }
  }
  return { verdict: 'allow', risk: commandRiskToPolicyRisk(classifyCommandRisk(commandLine)), reason: 'deterministic guardian 未发现额外风险。', recommendedAction: 'allow', classifier: 'deterministic' }
}

function commandRiskToApprovalRisk(risk: CommandRisk): ApprovalRequest['risk'] {
  if (risk === 'destructive' || risk === 'deploy') return 'critical'
  if (risk === 'install' || risk === 'git_write' || risk === 'write_workspace' || risk === 'network') return 'high'
  if (risk === 'test') return 'medium'
  return 'low'
}

function commandRiskToPolicyRisk(risk: CommandRisk): RiskLevel {
  return commandRiskToApprovalRisk(risk)
}

export function deniedToolResult(call: RuntimeToolCall, reason: string, alternatives: string[] = []): ToolResultView {
  return {
    output: `权限拒绝：${reason}${alternatives.length > 0 ? `\n可选替代路径：${alternatives.join('；')}` : ''}`,
    error: 'permission_denied',
    failureType: 'permission_denied',
    status: 'denied',
    structured: { toolName: call.name, input: call.input, alternatives },
  }
}

export function permissionPattern(call: RuntimeToolCall): string {
  return call.name === 'run_command' ? commandPattern(call) : call.name
}

export function permissionForCall(call: RuntimeToolCall): PolicyPermission {
  if (call.name.startsWith('mcp.')) {
    const descriptor = listMcpTools().find(tool => tool.namespace === call.name)
      ?? registerMcpToolDescriptors().find(tool => tool.namespace === call.name)
    if (descriptor?.sideEffect === 'none' || descriptor?.sideEffect === 'workspace_read') return 'file.read'
    if (descriptor?.sideEffect === 'workspace_write') return 'file.write'
    if (descriptor?.sideEffect === 'network' || descriptor?.sideEffect === 'external' || !descriptor) return 'network.access'
    return 'command.run'
  }
  if (call.name === 'run_command') {
    const commandLine = typeof call.input.commandLine === 'string' ? call.input.commandLine.trim() : ''
    const risk = classifyCommandRisk(commandLine)
    if (risk === 'git_write' || risk === 'deploy') return 'git.write'
    if (risk === 'network') return 'network.access'
    return 'command.run'
  }
  if (call.name === 'read_file' || call.name === 'list_directory' || call.name === 'search_files' || call.name === 'git_status' || call.name === 'git_diff') return 'file.read'
  if (call.name.includes('edit')) return 'file.write'
  return 'command.run'
}

function targetForCall(call: RuntimeToolCall): string {
  if (call.name === 'run_command') return typeof call.input.commandLine === 'string' ? call.input.commandLine.trim() : ''
  if (typeof call.input.filePath === 'string') return call.input.filePath
  if (typeof call.input.dirPath === 'string') return call.input.dirPath
  return permissionPattern(call)
}

function patternMatches(pattern: string, value: string): boolean {
  const normalizedPattern = pattern.trim()
  const normalizedValue = value.trim()
  if (!normalizedPattern) return false
  if (normalizedPattern === normalizedValue) return true
  if (normalizedPattern === '*') return true
  if (normalizedPattern.includes('*')) {
    const escaped = normalizedPattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
    return new RegExp(`^${escaped}$`).test(normalizedValue)
  }
  return normalizedValue.includes(normalizedPattern)
}

async function readProjectPolicy(context?: AgentContextSnapshot): Promise<ProjectPolicyFile | null> {
  if (!context?.workspace) return null
  try {
    return JSON.parse(await workspaceReadFile(context.workspace, '.rille/policy.json')) as ProjectPolicyFile
  } catch {
    return null
  }
}

function normalizedRules(policy: ProjectPolicyFile | null): PolicyRule[] {
  const rules = Array.isArray(policy?.agent?.permissions) ? policy.agent.permissions.filter(isPolicyRule) : []
  const verificationCommands = policy?.agent?.verification?.commands
  if (Array.isArray(verificationCommands)) {
    for (const command of verificationCommands) {
      if (typeof command !== 'string' || !command.trim()) continue
      rules.push({
        id: `verification:${command.trim()}`,
        permission: 'command.run',
        pattern: command.trim(),
        action: 'allow',
        risk: 'medium',
        reason: '项目 policy verification command。',
      })
    }
  }
  return rules
}

function isPolicyRule(value: unknown): value is PolicyRule {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PolicyRule>
  return typeof item.id === 'string'
    && typeof item.permission === 'string'
    && typeof item.pattern === 'string'
    && (item.action === 'allow' || item.action === 'ask' || item.action === 'deny')
}

function matchPolicyRule(rules: PolicyRule[], permission: PolicyPermission, target: string): PolicyRule | null {
  return rules.find(rule => rule.permission === permission && patternMatches(rule.pattern, target)) ?? null
}

function policyTargetsForCall(call: RuntimeToolCall): string[] {
  if (call.name !== 'run_command') return [targetForCall(call), permissionPattern(call)]
  const commandLine = typeof call.input.commandLine === 'string' ? call.input.commandLine.trim() : ''
  return [commandLine, permissionPattern(call), ...parseCommandSubject(commandLine).subjects]
}

function alternativesFor(call: RuntimeToolCall): string[] {
  if (call.name === 'run_command') {
    return ['改用只读命令收集信息', '用 propose_file_edit 生成可审查 diff', '请用户手动执行高风险命令']
  }
  if (call.name.includes('edit')) return ['先读取文件并生成 diff proposal', '缩小修改范围后重试']
  return ['缩小请求范围后重试', '向用户说明阻塞原因']
}

export async function decidePermission(input: {
  call: RuntimeToolCall
  mode: AgentPermissionMode
  sessionId: string
  turnId: string
  context?: AgentContextSnapshot
  grants?: PermissionGrantStore
}): Promise<PermissionDecision> {
  const tool = getRegisteredTool(input.call.name)
  const permission = permissionForCall(input.call)
  const target = targetForCall(input.call)
  const baseRisk: RiskLevel = tool?.definition.risk ?? 'high'

  if (!tool) {
    const policyDecision: PolicyDecision = { action: 'deny', risk: 'high', reason: `未知工具 ${input.call.name}`, alternatives: alternativesFor(input.call) }
    return { action: 'deny', reason: policyDecision.reason, policyDecision }
  }
  if (!isModelVisibleTool(input.call.name)) {
    const policyDecision: PolicyDecision = {
      action: 'deny',
      risk: tool.definition.risk,
      reason: `${tool.definition.title} 只能由 RilleCode runtime 或用户界面触发。`,
      alternatives: alternativesFor(input.call),
    }
    return { action: 'deny', reason: policyDecision.reason, policyDecision }
  }

  const validation = tool.validate(input.call.input)
  if (!validation.ok) {
    const policyDecision: PolicyDecision = { action: 'deny', risk: baseRisk, reason: validation.error || '工具输入无效。', alternatives: alternativesFor(input.call) }
    return { action: 'deny', reason: policyDecision.reason, policyDecision }
  }

  let commandRisk: CommandRisk | null = null
  let commandSubject: CommandSubject | undefined
  let guardian: GuardianDecision | undefined
  if (input.call.name === 'run_command') {
    const commandLine = target
    commandSubject = parseCommandSubject(commandLine)
    guardian = classifyGuardian(commandLine)
    commandRisk = classifyCommandRisk(commandLine)
    if (!commandLine) {
      const policyDecision: PolicyDecision = { action: 'deny', risk: 'low', reason: '命令为空。', alternatives: alternativesFor(input.call) }
      return { action: 'deny', reason: policyDecision.reason, policyDecision }
    }
    if (guardian.verdict === 'deny') {
      const policyDecision: PolicyDecision = {
        action: 'deny',
        risk: guardian.risk,
        reason: guardian.reason,
        guardian,
        commandSubject,
        alternatives: alternativesFor(input.call),
      }
      return { action: 'deny', reason: policyDecision.reason, policyDecision }
    }
    if (commandRisk === 'destructive' || commandRisk === 'deploy') {
      const policyDecision: PolicyDecision = {
        action: 'deny',
        risk: 'critical',
        reason: `命令风险过高 (${commandRisk})，已直接拒绝。`,
        guardian,
        commandSubject,
        alternatives: alternativesFor(input.call),
      }
      return { action: 'deny', reason: policyDecision.reason, policyDecision }
    }
  }

  if (input.mode === 'plan') {
    const allowedPlanTools = new Set(['list_directory', 'read_file', 'search_files', 'git_status', 'git_diff', 'read_diagnostics', 'search_tools', 'explore_codebase', 'update_plan', 'update_task_contract'])
    const allowed = tool.definition.isReadOnly || allowedPlanTools.has(input.call.name)
    const policyDecision: PolicyDecision = {
      action: allowed ? 'allow' : 'deny',
      risk: commandRisk ? commandRiskToPolicyRisk(commandRisk) : baseRisk,
      reason: allowed ? 'Plan 模式允许只读探索和计划更新。' : 'Plan 模式不允许写文件、运行命令、应用编辑或操作 sandbox。',
      guardian,
      commandSubject,
      alternatives: allowed ? undefined : alternativesFor(input.call),
    }
    return allowed
      ? { action: 'allow', reason: policyDecision.reason, policyDecision }
      : { action: 'deny', reason: policyDecision.reason, policyDecision }
  }

  const grantPatterns = policyTargetsForCall(input.call)
  const grant = input.grants?.match(permission, permissionPattern(input.call))
  if (grant) {
    const policyDecision: PolicyDecision = { action: grant.action, risk: commandRisk ? commandRiskToPolicyRisk(commandRisk) : baseRisk, reason: `匹配 ${grant.scope} grant。`, grant, guardian, commandSubject }
    return grant.action === 'allow'
      ? { action: 'allow', reason: policyDecision.reason, policyDecision }
      : { action: 'deny', reason: policyDecision.reason, policyDecision }
  }
  const workspaceKey = workspaceGrantKey(input.context)
  const workspaceGrant = workspaceKey ? new WorkspacePermissionGrantStore().load().match(workspaceKey, permission, grantPatterns) : null
  if (workspaceGrant) {
    const policyDecision: PolicyDecision = { action: workspaceGrant.action, risk: commandRisk ? commandRiskToPolicyRisk(commandRisk) : baseRisk, reason: '匹配 workspace grant。', grant: workspaceGrant, guardian, commandSubject }
    return workspaceGrant.action === 'allow'
      ? { action: 'allow', reason: policyDecision.reason, policyDecision }
      : { action: 'deny', reason: policyDecision.reason, policyDecision }
  }

  const rules = normalizedRules(await readProjectPolicy(input.context))
  const rule = grantPatterns.map(pattern => matchPolicyRule(rules, permission, pattern)).find(Boolean) ?? null
  if (rule) {
    const policyDecision: PolicyDecision = {
      action: rule.action,
      risk: rule.risk || (commandRisk ? commandRiskToPolicyRisk(commandRisk) : baseRisk),
      reason: rule.reason || `匹配项目 policy：${rule.id}`,
      matchedRule: rule.id,
      guardian,
      commandSubject,
      alternatives: rule.action === 'deny' ? alternativesFor(input.call) : undefined,
    }
    if (rule.action === 'allow') return { action: 'allow', reason: policyDecision.reason, policyDecision }
    if (rule.action === 'deny') return { action: 'deny', reason: policyDecision.reason, policyDecision }
    return { action: 'ask', reason: policyDecision.reason, request: createApprovalRequest(input, tool.definition.title, policyDecision, commandRisk), policyDecision }
  }

  if (tool.definition.isReadOnly || input.call.name === 'propose_file_edit') {
    const policyDecision: PolicyDecision = { action: 'allow', risk: commandRisk ? commandRiskToPolicyRisk(commandRisk) : baseRisk, reason: '只读工具或 diff proposal 自动允许。' }
    return { action: 'allow', reason: policyDecision.reason, policyDecision }
  }

  if (input.mode === 'bypass') {
    const policyDecision: PolicyDecision = { action: 'allow', risk: baseRisk, reason: 'Bypass 模式允许。' }
    return { action: 'allow', reason: policyDecision.reason, policyDecision }
  }
  if (input.mode === 'accept_edits' && input.call.name === 'apply_file_edit') {
    const policyDecision: PolicyDecision = { action: 'allow', risk: baseRisk, reason: 'Accept edits 模式允许应用编辑。' }
    return { action: 'allow', reason: policyDecision.reason, policyDecision }
  }
  if (input.mode === 'auto' && input.call.name !== 'run_command') {
    const policyDecision: PolicyDecision = { action: 'allow', risk: baseRisk, reason: 'Auto 模式允许低风险写操作。' }
    return { action: 'allow', reason: policyDecision.reason, policyDecision }
  }

  const policyDecision: PolicyDecision = {
    action: 'ask',
    risk: commandRisk ? commandRiskToPolicyRisk(commandRisk) : baseRisk,
    reason: input.call.name === 'run_command' ? `运行命令需要确认：${target}` : `${tool.definition.title} 需要确认。`,
    guardian,
    commandSubject,
    sandboxRequired: commandRisk === 'install' || commandRisk === 'write_workspace' || commandRisk === 'git_write' || guardian?.verdict === 'ask',
  }
  return { action: 'ask', reason: policyDecision.reason, request: createApprovalRequest(input, tool.definition.title, policyDecision, commandRisk), policyDecision }
}

function createApprovalRequest(
  input: { call: RuntimeToolCall; sessionId: string; turnId: string; context?: AgentContextSnapshot },
  title: string,
  decision: PolicyDecision,
  commandRisk: CommandRisk | null,
): ApprovalRequest {
  const commandLine = typeof input.call.input.commandLine === 'string' ? input.call.input.commandLine.trim() : ''
  return {
    id: `approval_${randomUUID()}`,
    sessionId: input.sessionId,
    turnId: input.turnId,
    toolCallId: input.call.id,
    title,
    reason: input.call.name === 'run_command' ? commandLine : targetForCall(input.call),
    risk: decision.risk,
    target: input.call.name === 'run_command' ? commandLine : undefined,
    matchedRule: decision.matchedRule,
    runtime: input.context?.workspace ?? null,
    grantOptions: ['once', 'session', ...(input.context?.workspace ? ['workspace' as const] : [])],
    details: input.call.name === 'run_command'
      ? {
          commandRisk,
          commandSubject: decision.commandSubject ? decision.commandSubject.subjects.join(', ') : undefined,
          guardian: decision.guardian?.reason,
          sandboxRequired: decision.sandboxRequired,
          cwd: typeof input.call.input.cwd === 'string' ? input.call.input.cwd : undefined,
          timeoutMs: typeof input.call.input.timeoutMs === 'number' ? input.call.input.timeoutMs : undefined,
          shellMode: needsShell(commandLine),
          rule: decision.matchedRule || 'built-in command classifier',
        }
      : { rule: decision.matchedRule || 'built-in tool policy' },
    createdAt: Date.now(),
  }
}
