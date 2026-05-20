import { randomUUID } from 'crypto'
import type { AgentPermissionMode, ApprovalRequest, ToolResultView } from '../../shared/agent/protocol'
import { getRegisteredTool, isModelVisibleTool, type RuntimeToolCall } from './tools'
import { needsShell } from './workspace'

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
  | { action: 'allow'; reason: string }
  | { action: 'ask'; reason: string; request: ApprovalRequest }
  | { action: 'deny'; reason: string }

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

export function deniedToolResult(call: RuntimeToolCall, reason: string): ToolResultView {
  return { output: `权限拒绝：${reason}`, error: 'permission_denied', status: 'denied', structured: { toolName: call.name, input: call.input } }
}

export function permissionPattern(call: RuntimeToolCall): string {
  return call.name === 'run_command' ? commandPattern(call) : call.name
}

export function decidePermission(input: {
  call: RuntimeToolCall
  mode: AgentPermissionMode
  sessionId: string
  turnId: string
}): PermissionDecision {
  const tool = getRegisteredTool(input.call.name)
  if (!tool) return { action: 'deny', reason: `未知工具 ${input.call.name}` }
  if (!isModelVisibleTool(input.call.name)) return { action: 'deny', reason: `${tool.definition.title} 只能由 RilleCode runtime 或用户界面触发。` }

  if (tool.definition.isReadOnly || input.call.name === 'propose_file_edit') {
    return { action: 'allow', reason: '只读工具或 diff proposal 自动允许。' }
  }

  if (input.call.name === 'run_command') {
    const commandLine = typeof input.call.input.commandLine === 'string' ? input.call.input.commandLine.trim() : ''
    const commandRisk = classifyCommandRisk(commandLine)
    if (!commandLine) return { action: 'deny', reason: '命令为空。' }
    if (commandRisk === 'destructive' || commandRisk === 'deploy') return { action: 'deny', reason: `命令风险过高 (${commandRisk})，已直接拒绝。` }
    if (isShellWriteCommand(commandLine)) return { action: 'deny', reason: '疑似通过 shell 写入/删除文件。请使用 propose_file_edit 和 apply_file_edit。' }
  }

  if (input.mode === 'plan') return { action: 'deny', reason: 'Plan 模式不允许写文件或运行命令。' }
  if (input.mode === 'bypass') return { action: 'allow', reason: 'Bypass 模式允许。' }
  if (input.mode === 'accept_edits' && input.call.name === 'apply_file_edit') return { action: 'allow', reason: 'Accept edits 模式允许应用编辑。' }
  if (input.mode === 'auto' && input.call.name !== 'run_command') return { action: 'allow', reason: 'Auto 模式允许低风险写操作。' }

  const commandLine = typeof input.call.input.commandLine === 'string' ? input.call.input.commandLine.trim() : ''
  const commandRisk = input.call.name === 'run_command' ? classifyCommandRisk(commandLine) : null
  const risk = commandRisk ? commandRiskToApprovalRisk(commandRisk) : tool.definition.risk
  return {
    action: 'ask',
    reason: input.call.name === 'run_command' ? `运行命令需要确认：${commandLine}` : `${tool.definition.title} 需要确认。`,
    request: {
      id: `approval_${randomUUID()}`,
      sessionId: input.sessionId,
      turnId: input.turnId,
      toolCallId: input.call.id,
      title: tool.definition.title,
      reason: input.call.name === 'run_command' ? commandLine : tool.summarize(input.call.input, { workspace: null, openFiles: [], diagnostics: [] }),
      risk,
      target: input.call.name === 'run_command' ? commandLine : undefined,
      details: input.call.name === 'run_command'
        ? {
            commandRisk,
            cwd: typeof input.call.input.cwd === 'string' ? input.call.input.cwd : undefined,
            timeoutMs: typeof input.call.input.timeoutMs === 'number' ? input.call.input.timeoutMs : undefined,
            shellMode: needsShell(commandLine),
            rule: 'built-in command classifier',
          }
        : { rule: 'built-in tool policy' },
      createdAt: Date.now(),
    },
  }
}
