import { randomUUID } from 'crypto'
import type {
  AgentContextSnapshot,
  AgentPermissionMode,
  ApprovalRequest,
  GrantScope,
  PermissionGrant,
  PolicyDecision,
  PolicyPermission,
  PolicyRule,
  RiskLevel,
  ToolResultView,
} from '../../shared/agent/protocol'
import { getRegisteredTool, isModelVisibleTool, type RuntimeToolCall } from './tools'
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

function commandPattern(call: RuntimeToolCall): string {
  const commandLine = typeof call.input.commandLine === 'string' ? call.input.commandLine.trim() : ''
  return `${call.name}:${commandLine.split(/\s+/).slice(0, 2).join(' ')}`
}

function isDangerousCommand(commandLine: string): boolean {
  return /\b(rm\s+-rf\s+\/|sudo\s+rm|mkfs|diskpart|shutdown|reboot|git\s+push|npm\s+publish|pnpm\s+publish)\b/i.test(commandLine)
}

function isShellWriteCommand(commandLine: string): boolean {
  return /(^|[^<])>{1,2}($|[^>])/.test(commandLine)
    || /^\s*(touch|mkdir|copy|xcopy|cp|mv|rm|del|erase|rmdir|new-item|set-content|add-content|out-file)\b/i.test(commandLine)
}

function firstTokens(commandLine: string): string[] {
  return commandLine.trim().split(/\s+/).slice(0, 4).map(token => token.toLowerCase())
}

export function classifyCommandRisk(commandLine: string): CommandRisk {
  const normalized = commandLine.trim().toLowerCase()
  const tokens = firstTokens(commandLine)
  const [cmd, sub] = tokens
  if (!normalized) return 'read_only'
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
  if (input.call.name === 'run_command') {
    const commandLine = target
    commandRisk = classifyCommandRisk(commandLine)
    if (!commandLine) {
      const policyDecision: PolicyDecision = { action: 'deny', risk: 'low', reason: '命令为空。', alternatives: alternativesFor(input.call) }
      return { action: 'deny', reason: policyDecision.reason, policyDecision }
    }
    if (commandRisk === 'destructive' || commandRisk === 'deploy') {
      const policyDecision: PolicyDecision = {
        action: 'deny',
        risk: 'critical',
        reason: `命令风险过高 (${commandRisk})，已直接拒绝。`,
        alternatives: alternativesFor(input.call),
      }
      return { action: 'deny', reason: policyDecision.reason, policyDecision }
    }
    if (isShellWriteCommand(commandLine)) {
      const policyDecision: PolicyDecision = {
        action: 'deny',
        risk: 'high',
        reason: '疑似通过 shell 写入/删除文件。请使用 propose_file_edit 和 apply_file_edit。',
        alternatives: alternativesFor(input.call),
      }
      return { action: 'deny', reason: policyDecision.reason, policyDecision }
    }
  }

  const grant = input.grants?.match(permission, permissionPattern(input.call))
  if (grant) {
    const policyDecision: PolicyDecision = { action: grant.action, risk: commandRisk ? commandRiskToPolicyRisk(commandRisk) : baseRisk, reason: `匹配 ${grant.scope} grant。`, grant }
    return grant.action === 'allow'
      ? { action: 'allow', reason: policyDecision.reason, policyDecision }
      : { action: 'deny', reason: policyDecision.reason, policyDecision }
  }

  const rule = matchPolicyRule(normalizedRules(await readProjectPolicy(input.context)), permission, target)
  if (rule) {
    const policyDecision: PolicyDecision = {
      action: rule.action,
      risk: rule.risk || (commandRisk ? commandRiskToPolicyRisk(commandRisk) : baseRisk),
      reason: rule.reason || `匹配项目 policy：${rule.id}`,
      matchedRule: rule.id,
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

  if (input.mode === 'plan') {
    const policyDecision: PolicyDecision = { action: 'deny', risk: baseRisk, reason: 'Plan 模式不允许写文件或运行命令。', alternatives: alternativesFor(input.call) }
    return { action: 'deny', reason: policyDecision.reason, policyDecision }
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
    grantOptions: ['once', 'session'],
    details: input.call.name === 'run_command'
      ? {
          commandRisk,
          cwd: typeof input.call.input.cwd === 'string' ? input.call.input.cwd : undefined,
          timeoutMs: typeof input.call.input.timeoutMs === 'number' ? input.call.input.timeoutMs : undefined,
          shellMode: needsShell(commandLine),
          rule: decision.matchedRule || 'built-in command classifier',
        }
      : { rule: decision.matchedRule || 'built-in tool policy' },
    createdAt: Date.now(),
  }
}
