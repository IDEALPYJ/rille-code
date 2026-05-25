import { randomUUID } from 'crypto'
import type {
  AgentContextSnapshot,
  AgentPlanItem,
  AgentSession,
  AgentToolDefinition,
  AgentToolResult,
  AgentTurn,
  ToolFailureType,
  EditProposal,
  ProjectMemoryKind,
  TaskContract,
  ToolResultView,
  ToolSideEffect,
  ToolValidationResult,
  ToolVisibility,
} from '../../shared/agent/protocol'
import { appendSessionEvent } from './sessionStore'
import { applyEditProposal, createEditProposal } from './editStore'
import { normalizePlanUpdate, normalizeTaskContractUpdate } from './taskContract'
import { activateSkill, findMatchingSkills } from './skillStore'
import { callMcpTool, listMcpTools, registerMcpToolDescriptors } from './mcpManager'
import {
  canonicalWorkspacePath,
  isProtectedPath,
  needsShell,
  requireWorkspace,
  withinWorkspace,
  workspaceGitDiff,
  workspaceGitStatus,
  workspaceLabel,
  workspaceReadDirectory,
  workspaceReadFile,
  workspaceRunCommand,
  workspaceSearchFiles,
} from './workspace'
import { createArtifact } from './artifactStore'
import { captureRuntimeState } from './runtimeState'
import { VerifierRunner } from './verifier'

export interface RuntimeToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolExecutionContext {
  session: AgentSession
  turn: AgentTurn
  context: AgentContextSnapshot
  taskContract?: TaskContract
  planItems?: AgentPlanItem[]
  emitProposal: (proposal: EditProposal) => void
  updatePlan?: (items: AgentPlanItem[], reason?: string) => AgentPlanItem[]
  updateTaskContract?: (contract: TaskContract, reason: string) => TaskContract
}

export interface RegisteredTool {
  definition: AgentToolDefinition
  visibility: ToolVisibility
  sideEffect: ToolSideEffect
  summarize(input: Record<string, unknown>, context: AgentContextSnapshot): string
  validate(input: Record<string, unknown>): ToolValidationResult
  execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResultView>
}

const MAX_FILE_CHARS = 24_000
const MAX_TOOL_OUTPUT_CHARS = 24_000

function truncate(text: string, maxChars = MAX_TOOL_OUTPUT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  const head = text.slice(0, Math.floor(maxChars * 0.6))
  const tail = text.slice(-Math.floor(maxChars * 0.35))
  return { text: `${head}\n\n...[已截断 ${text.length - head.length - tail.length} 字符]...\n\n${tail}`, truncated: true }
}

function str(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  return typeof value === 'string' ? value : ''
}

function num(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function ok(normalizedInput: Record<string, unknown> = {}): ToolValidationResult {
  return { ok: true, normalizedInput }
}

function invalid(error: string): ToolValidationResult {
  return { ok: false, error }
}

function validateNoInput(input: Record<string, unknown>): ToolValidationResult {
  return Object.keys(input).length === 0 ? ok({}) : invalid('不支持额外输入字段。')
}

function validateStringFields(input: Record<string, unknown>, required: string[], optional: string[] = []): ToolValidationResult {
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) return invalid(`不支持输入字段 ${key}。`)
  }
  const normalized: Record<string, unknown> = {}
  for (const key of required) {
    const value = input[key]
    if (typeof value !== 'string' || !value.trim()) return invalid(`字段 ${key} 必须是非空字符串。`)
    normalized[key] = value
  }
  for (const key of optional) {
    const value = input[key]
    if (value === undefined) continue
    if (typeof value !== 'string') return invalid(`字段 ${key} 必须是字符串。`)
    normalized[key] = value
  }
  return ok(normalized)
}

function validatePlanInput(input: Record<string, unknown>): ToolValidationResult {
  if (!Array.isArray(input.items)) return invalid('字段 items 必须是数组。')
  if (input.reason !== undefined && typeof input.reason !== 'string') return invalid('字段 reason 必须是字符串。')
  return ok(input)
}

function validateObjectInput(input: Record<string, unknown>, key: string): ToolValidationResult {
  const value = input[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(`字段 ${key} 必须是对象。`)
  return ok(input)
}

function validateCommandInput(input: Record<string, unknown>): ToolValidationResult {
  for (const key of Object.keys(input)) {
    if (!['commandLine', 'cwd', 'timeoutMs'].includes(key)) return invalid(`不支持输入字段 ${key}。`)
  }
  if (typeof input.commandLine !== 'string' || !input.commandLine.trim()) return invalid('字段 commandLine 必须是非空字符串。')
  if (input.cwd !== undefined && typeof input.cwd !== 'string') return invalid('字段 cwd 必须是字符串。')
  if (input.timeoutMs !== undefined && (typeof input.timeoutMs !== 'number' || !Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) {
    return invalid('字段 timeoutMs 必须是正数。')
  }
  return ok({
    commandLine: input.commandLine,
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  })
}

function validateToolSearchInput(input: Record<string, unknown>): ToolValidationResult {
  return validateStringFields(input, ['query'])
}

function validateActivateSkillInput(input: Record<string, unknown>): ToolValidationResult {
  return validateStringFields(input, ['skillId', 'reason'])
}

function classifyToolError(error: unknown): ToolFailureType {
  const message = error instanceof Error ? error.message : String(error)
  if (/outside workspace|工作区外|out of workspace/i.test(message)) return 'path_outside_workspace'
  if (/enoent|no such file|not found|cannot find/i.test(message)) return 'path_not_found'
  if (/timed out|timeout|超时/i.test(message)) return 'timeout'
  if (/workspace|工作区/i.test(message)) return 'environment_missing'
  if (/conflict|冲突/i.test(message)) return 'conflict'
  return 'tool_failed'
}

function diagnostics(context: AgentContextSnapshot): ToolResultView {
  const lines = context.diagnostics.slice(0, 80).map(item => `${item.severity} ${item.filePath}:${item.line}:${item.column} ${item.message}`)
  return {
    output: lines.join('\n') || '当前可见文件没有诊断。',
    truncated: context.diagnostics.length > 80,
    structured: { count: context.diagnostics.length },
    status: 'ok',
  }
}

function activeEditor(context: AgentContextSnapshot): ToolResultView {
  const file = context.activeFile
  if (!file) return { output: '当前没有活动编辑器。', status: 'ok' }
  return {
    output: `${file.name}\npath: ${file.path}\ndirty: ${file.isDirty}\ncursor: ${context.cursor?.line ?? 1}:${context.cursor?.column ?? 1}`,
    structured: { activeFile: file.path, isDirty: file.isDirty, cursor: context.cursor },
    status: 'ok',
  }
}

function openFiles(context: AgentContextSnapshot): ToolResultView {
  const lines = context.openFiles.map(file => `${file.isDirty ? '*' : '-'} ${file.path}`)
  return {
    output: lines.join('\n') || '没有打开文件。',
    structured: { count: context.openFiles.length },
    status: 'ok',
  }
}

function activeFileMatches(workspace: ReturnType<typeof requireWorkspace>, context: AgentContextSnapshot, filePath: string): boolean {
  if (!context.activeFile) return false
  try {
    return canonicalWorkspacePath(workspace, context.activeFile.path) === canonicalWorkspacePath(workspace, filePath)
  } catch {
    return context.activeFile.path === filePath
  }
}

export const toolRegistry: RegisteredTool[] = [
  {
    definition: {
      name: 'get_active_editor',
      title: '读取活动编辑器',
      description: 'Get the current active editor file path, dirty state, and cursor.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
      category: 'context',
      keywords: ['editor', 'active file', 'cursor'],
    },
    visibility: 'model',
    sideEffect: 'none',
    validate: validateNoInput,
    summarize: () => '当前编辑器',
    execute: async (_input, { context }) => activeEditor(context),
  },
  {
    definition: {
      name: 'get_open_files',
      title: '读取打开文件',
      description: 'List currently open files in the IDE.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
      category: 'context',
      keywords: ['open files', 'tabs'],
    },
    visibility: 'model',
    sideEffect: 'none',
    validate: validateNoInput,
    summarize: () => '打开文件列表',
    execute: async (_input, { context }) => openFiles(context),
  },
  {
    definition: {
      name: 'read_diagnostics',
      title: '读取诊断',
      description: 'Read visible editor diagnostics.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
      category: 'verification',
      keywords: ['diagnostics', 'errors'],
    },
    visibility: 'model',
    sideEffect: 'none',
    validate: validateNoInput,
    summarize: () => '诊断快照',
    execute: async (_input, { context }) => diagnostics(context),
  },
  {
    definition: {
      name: 'update_plan',
      title: '更新结构化计划',
      description: 'Update the current structured plan. Input: { "items": [{"id"?: string, "title": string, "status": "pending"|"in_progress"|"completed"|"blocked"|"skipped", "description"?: string, "evidence"?: string}], "reason"?: string }.',
      inputSchema: {
        type: 'object',
        required: ['items'],
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked', 'skipped'] },
                description: { type: 'string' },
                evidence: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
          reason: { type: 'string' },
        },
        additionalProperties: false,
      },
      isReadOnly: true,
      risk: 'low',
      category: 'planning',
      keywords: ['plan', 'progress'],
    },
    visibility: 'model',
    sideEffect: 'none',
    validate: validatePlanInput,
    summarize: input => {
      const items = Array.isArray(input.items) ? input.items : []
      return str(input, 'reason') || `更新 ${items.length} 个计划项`
    },
    execute: async (input, context) => {
      if (!context.updatePlan) {
        return { output: '当前 runtime 不支持更新结构化计划。', error: 'plan_update_unavailable', status: 'error' }
      }
      const normalized = normalizePlanUpdate({
        currentItems: context.planItems ?? [],
        rawItems: input.items,
        reason: input.reason,
      })
      const items = context.updatePlan(normalized.items, normalized.reason)
      return {
        output: normalized.reason ? `计划已更新：${normalized.reason}` : '计划已更新。',
        structured: { items: items as unknown as Record<string, unknown>, reason: normalized.reason },
        status: 'ok',
      }
    },
  },
  {
    definition: {
      name: 'update_task_contract',
      title: '更新任务合同',
      description: 'Update the current Task Contract. Input: { "contract": { goal?, scope?, nonGoals?, constraints?, acceptanceCriteria?, verificationPlan?, riskPoints?, assumptions?, status? }, "reason"?: string }.',
      inputSchema: {
        type: 'object',
        required: ['contract'],
        properties: {
          contract: { type: 'object', additionalProperties: true },
          reason: { type: 'string' },
        },
        additionalProperties: false,
      },
      isReadOnly: true,
      risk: 'low',
      category: 'planning',
      keywords: ['task contract', 'scope', 'acceptance'],
    },
    visibility: 'model',
    sideEffect: 'none',
    validate: input => validateObjectInput(input, 'contract'),
    summarize: input => str(input, 'reason') || '更新任务合同',
    execute: async (input, context) => {
      if (!context.taskContract || !context.updateTaskContract) {
        return { output: '当前 runtime 不支持更新任务合同。', error: 'task_contract_update_unavailable', status: 'error' }
      }
      const normalized = normalizeTaskContractUpdate({
        currentContract: context.taskContract,
        patch: input.contract,
        reason: input.reason,
      })
      const contract = context.updateTaskContract(normalized.contract, normalized.reason)
      return {
        output: `任务合同已更新：${normalized.reason}`,
        structured: { contract: contract as unknown as Record<string, unknown>, reason: normalized.reason },
        status: 'ok',
      }
    },
  },
  {
    definition: {
      name: 'list_directory',
      title: '列出目录',
      description: 'List files and folders inside the workspace. Input: { "dirPath"?: string }.',
      inputSchema: { type: 'object', properties: { dirPath: { type: 'string' } }, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
      category: 'filesystem',
      keywords: ['directory', 'files', 'ls'],
    },
    visibility: 'model',
    sideEffect: 'workspace_read',
    validate: input => validateStringFields(input, [], ['dirPath']),
    summarize: input => str(input, 'dirPath') || 'workspace root',
    execute: async (input, { context }) => {
      const workspace = requireWorkspace(context.workspace)
      const entries = await workspaceReadDirectory(workspace, str(input, 'dirPath') || workspace.path)
      return {
        output: entries.map(entry => `${entry.isDirectory ? 'dir ' : 'file'} ${entry.name}`).join('\n') || '(空目录)',
        truncated: entries.length >= 160,
        structured: { dirPath: str(input, 'dirPath') || workspace.path, count: entries.length, workspace: workspaceLabel(workspace) },
        status: 'ok',
      }
    },
  },
  {
    definition: {
      name: 'read_file',
      title: '读取文件',
      description: 'Read a workspace file. Input: { "filePath": string }.',
      inputSchema: { type: 'object', required: ['filePath'], properties: { filePath: { type: 'string' } }, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
      category: 'filesystem',
      keywords: ['read', 'file', 'source'],
    },
    visibility: 'model',
    sideEffect: 'workspace_read',
    validate: input => validateStringFields(input, ['filePath']),
    summarize: input => str(input, 'filePath'),
    execute: async (input, { context }) => {
      const workspace = requireWorkspace(context.workspace)
      const filePath = str(input, 'filePath') || context.activeFile?.path || ''
      const content = activeFileMatches(workspace, context, filePath) && context.activeFile?.content !== undefined
        ? context.activeFile.content
        : await workspaceReadFile(workspace, filePath)
      const result = truncate(content, MAX_FILE_CHARS)
      return { output: result.text, truncated: result.truncated, structured: { filePath }, status: 'ok' }
    },
  },
  {
    definition: {
      name: 'search_files',
      title: '搜索代码',
      description: 'Search workspace text using ripgrep-like matching. Input: { "query": string }.',
      inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } }, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
      category: 'search',
      keywords: ['search', 'ripgrep', 'code'],
    },
    visibility: 'model',
    sideEffect: 'workspace_read',
    validate: input => validateStringFields(input, ['query']),
    summarize: input => str(input, 'query'),
    execute: async (input, { context }) => {
      const workspace = requireWorkspace(context.workspace)
      const output = await workspaceSearchFiles(workspace, str(input, 'query'))
      const result = truncate(output)
      return { output: result.text, truncated: result.truncated, structured: { query: str(input, 'query') }, status: 'ok' }
    },
  },
  {
    definition: {
      name: 'git_status',
      title: '读取 Git 状态',
      description: 'Read git status for the workspace.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
      category: 'git',
      keywords: ['git', 'status'],
    },
    visibility: 'model',
    sideEffect: 'workspace_read',
    validate: validateNoInput,
    summarize: () => 'git status',
    execute: async (_input, { context }) => {
      const workspace = requireWorkspace(context.workspace)
      const output = await workspaceGitStatus(workspace)
      return { output, structured: { root: workspace.path }, status: 'ok' }
    },
  },
  {
    definition: {
      name: 'git_diff',
      title: '读取 Git Diff',
      description: 'Read unstaged git diff. Input: { "filePath"?: string }.',
      inputSchema: { type: 'object', properties: { filePath: { type: 'string' } }, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
      category: 'git',
      keywords: ['git', 'diff'],
    },
    visibility: 'model',
    sideEffect: 'workspace_read',
    validate: input => validateStringFields(input, [], ['filePath']),
    summarize: input => str(input, 'filePath') || 'unstaged diff',
    execute: async (input, { context }) => {
      const workspace = requireWorkspace(context.workspace)
      const output = await workspaceGitDiff(workspace, str(input, 'filePath') || undefined)
      const result = truncate(output)
      return { output: result.text, truncated: result.truncated, structured: { filePath: str(input, 'filePath') || null }, status: 'ok' }
    },
  },
  {
    definition: {
      name: 'propose_file_edit',
      title: '生成编辑提案',
      description: 'Create a full-file replacement edit proposal. Input: { "filePath": string, "modifiedContent": string, "rationale"?: string }.',
      inputSchema: { type: 'object', required: ['filePath', 'modifiedContent'], properties: { filePath: { type: 'string' }, modifiedContent: { type: 'string' }, rationale: { type: 'string' } }, additionalProperties: false },
      isReadOnly: false,
      risk: 'medium',
      category: 'edit',
      keywords: ['edit', 'diff', 'proposal'],
    },
    visibility: 'model',
    sideEffect: 'workspace_write',
    validate: input => {
      const base = validateStringFields(input, ['filePath', 'modifiedContent'], ['rationale'])
      if (!base.ok) return base
      const filePath = (input as Record<string, unknown>).filePath as string | undefined
      if (filePath && isProtectedPath(filePath)) return { ok: false, error: `受保护路径不可编辑: ${filePath}` }
      return base
    },
    summarize: input => str(input, 'filePath'),
    execute: async (input, { session, turn, context, emitProposal }) => {
      const workspace = requireWorkspace(context.workspace)
      const filePath = str(input, 'filePath') || context.activeFile?.path || ''
      const absolutePath = withinWorkspace(workspace, filePath)
      const originalContent = activeFileMatches(workspace, context, filePath) && context.activeFile?.content !== undefined
        ? context.activeFile.content
        : await workspaceReadFile(workspace, absolutePath).catch(error => {
          const message = error instanceof Error ? error.message : String(error)
          if (/enoent|no such file|cannot find/i.test(message)) return ''
          throw error
        })
      const proposal = createEditProposal({
        session,
        turn,
        title: `修改 ${filePath.split(/[/\\]/).pop() || filePath}`,
        filePath: absolutePath,
        originalContent,
        modifiedContent: str(input, 'modifiedContent'),
        rationale: str(input, 'rationale') || undefined,
      })
      emitProposal(proposal)
      return {
        output: `已生成编辑提案 ${proposal.id}，等待用户在 diff review 中应用或拒绝。`,
        structured: { proposalId: proposal.id, filePath: proposal.filePath, state: proposal.state },
        status: 'ok',
      }
    },
  },
  {
    definition: {
      name: 'apply_file_edit',
      title: '应用编辑提案',
      description: 'Apply a pending edit proposal after approval. Input: { "proposalId": string }.',
      inputSchema: { type: 'object', required: ['proposalId'], properties: { proposalId: { type: 'string' } }, additionalProperties: false },
      isReadOnly: false,
      risk: 'high',
      category: 'edit',
      keywords: ['apply', 'write'],
    },
    visibility: 'runtime',
    sideEffect: 'workspace_write',
    validate: input => validateStringFields(input, ['proposalId']),
    summarize: input => str(input, 'proposalId'),
    execute: async (input, { context }) => {
      const proposal = await applyEditProposal(str(input, 'proposalId'), context.workspace, context)
      return {
        output: proposal.state === 'applied'
          ? `已应用编辑提案 ${proposal.id}。`
          : proposal.state === 'conflicted'
            ? `编辑提案 ${proposal.id} 与当前文件内容冲突，未写入。`
            : `编辑提案 ${proposal.id} 状态为 ${proposal.state}。`,
        structured: { proposalId: proposal.id, filePath: proposal.filePath, state: proposal.state },
        status: proposal.state === 'applied' ? 'ok' : proposal.state === 'conflicted' ? 'conflict' : 'error',
        error: proposal.state === 'applied' ? undefined : proposal.state,
      }
    },
  },
  {
    definition: {
      name: 'ask_user',
      title: '询问用户',
      description: 'Ask the user for structured clarification. Input: { "question": string, "reason"?: string }.',
      inputSchema: { type: 'object', required: ['question'], properties: { question: { type: 'string' }, reason: { type: 'string' } }, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
      category: 'user',
      keywords: ['clarify', 'question'],
      activationHint: 'Use when task is blocked by missing user intent.',
    },
    visibility: 'model',
    sideEffect: 'none',
    validate: input => validateStringFields(input, ['question'], ['reason']),
    summarize: input => str(input, 'question'),
    execute: async input => ({
      output: `需要用户确认：${str(input, 'question')}`,
      structured: { question: str(input, 'question'), reason: str(input, 'reason') || null },
      status: 'error',
      error: 'user_input_required',
      failureType: 'cancelled',
    }),
  },
  {
    definition: {
      name: 'select_files',
      title: '请求选择文件',
      description: 'Ask the user to confirm or select files for scope. Input: { "reason": string, "patterns"?: string }.',
      inputSchema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' }, patterns: { type: 'string' } }, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
      deferred: true,
      category: 'user',
      keywords: ['select files', 'scope'],
      activationHint: 'Use when file scope cannot be inferred safely.',
    },
    visibility: 'model',
    sideEffect: 'none',
    validate: input => validateStringFields(input, ['reason'], ['patterns']),
    summarize: input => str(input, 'reason'),
    execute: async input => ({
      output: `需要用户确认文件范围：${str(input, 'reason')}`,
      structured: { reason: str(input, 'reason'), patterns: str(input, 'patterns') || null },
      status: 'error',
      error: 'file_selection_required',
      failureType: 'cancelled',
    }),
  },
  {
    definition: {
      name: 'run_command',
      title: '运行命令',
      description: 'Run a non-interactive workspace command. Input: { "commandLine": string, "cwd"?: string, "timeoutMs"?: number }.',
      inputSchema: { type: 'object', required: ['commandLine'], properties: { commandLine: { type: 'string' }, cwd: { type: 'string' }, timeoutMs: { type: 'number' } }, additionalProperties: false },
      isReadOnly: false,
      risk: 'high',
      category: 'process',
      keywords: ['command', 'test', 'build', 'shell'],
    },
    visibility: 'model',
    sideEffect: 'process',
    validate: validateCommandInput,
    summarize: input => str(input, 'commandLine'),
    execute: async (input, { context, session, turn }) => {
      const workspace = requireWorkspace(context.workspace)
      const result = await workspaceRunCommand(workspace, {
        commandLine: str(input, 'commandLine'),
        cwd: str(input, 'cwd') || undefined,
        timeoutMs: num(input, 'timeoutMs'),
        outputLimitBytes: 50 * 1024,
        shellMode: needsShell(str(input, 'commandLine')),
      })
      const artifact = createArtifact({
        sessionId: session.id,
        turnId: turn.id,
        kind: 'command_output',
        content: result.output,
        mimeType: 'text/plain; charset=utf-8',
      })
      return { ...result, artifact, artifactRef: artifact.id, structured: { ...(result.structured || {}), artifactRef: artifact.id } }
    },
  },
  {
    definition: {
      name: 'search_tools',
      title: '搜索可用工具',
      description: 'Discover deferred or specialized tools by query. Input: { "query": string }.',
      inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } }, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
      category: 'tooling',
      keywords: ['tool', 'discover', 'deferred'],
    },
    visibility: 'model',
    sideEffect: 'none',
    validate: validateToolSearchInput,
    summarize: input => str(input, 'query'),
    execute: async (input, { context }) => {
      const query = str(input, 'query').toLowerCase()
      const matches = toolRegistry
        .filter(tool => tool.visibility === 'model' && tool.definition.name !== 'search_tools')
        .filter(tool => {
          const haystack = [
            tool.definition.name,
            tool.definition.title,
            tool.definition.description,
            tool.definition.category,
            ...(tool.definition.keywords || []),
          ].join(' ').toLowerCase()
          return haystack.includes(query) || query.split(/\s+/).some(token => token && haystack.includes(token))
        })
        .slice(0, 8)
        .map(tool => ({
          name: tool.definition.name,
          title: tool.definition.title,
          description: tool.definition.description,
          category: tool.definition.category,
          sideEffect: tool.sideEffect,
          activationHint: tool.definition.activationHint,
          inputSchema: tool.definition.inputSchema,
        }))
      const workspace = context.workspace
      const skills = findMatchingSkills(query, workspace, 5).map(skill => ({
        kind: 'skill',
        id: skill.id,
        name: skill.name,
        description: skill.description,
        source: skill.source,
        trust: skill.trust,
        activationKeywords: skill.activationKeywords,
      }))
      const mcpTools = registerMcpToolDescriptors(workspace)
        .filter(tool => {
          const haystack = [tool.namespace, tool.name, tool.title, tool.description, tool.pluginId, tool.serverId].filter(Boolean).join(' ').toLowerCase()
          return haystack.includes(query) || query.split(/\s+/).some(token => token && haystack.includes(token))
        })
        .slice(0, 8)
        .map(tool => ({
          kind: 'mcp_tool',
          name: tool.namespace,
          title: tool.title || tool.name,
          description: tool.description || '',
          pluginId: tool.pluginId,
          serverId: tool.serverId,
          sideEffect: tool.sideEffect,
          readOnly: tool.readOnly,
          deferred: true,
        }))
      const combined = { matches, skills, mcpTools }
      return { output: JSON.stringify(combined, null, 2), structured: combined, status: 'ok' }
    },
  },
  {
    definition: {
      name: 'search_skills',
      title: '搜索技能和插件',
      description: 'Discover matching skills, plugins, and MCP tools. Input: { "query": string }.',
      inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } }, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
      category: 'extension',
      keywords: ['skill', 'plugin', 'mcp', 'extension'],
    },
    visibility: 'model',
    sideEffect: 'none',
    validate: validateToolSearchInput,
    summarize: input => str(input, 'query'),
    execute: async (input, { context }) => {
      const query = str(input, 'query')
      const skills = findMatchingSkills(query, context.workspace, 8).map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        source: skill.source,
        trust: skill.trust,
        pluginId: skill.pluginId,
        activationKeywords: skill.activationKeywords,
      }))
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
      const mcpTools = registerMcpToolDescriptors(context.workspace)
        .filter(tool => {
          const haystack = [tool.namespace, tool.name, tool.title, tool.description, tool.pluginId, tool.serverId].filter(Boolean).join(' ').toLowerCase()
          return terms.length === 0 || terms.some(term => haystack.includes(term))
        })
        .slice(0, 12)
        .map(tool => ({
          namespace: tool.namespace,
          title: tool.title || tool.name,
          description: tool.description || '',
          pluginId: tool.pluginId,
          serverId: tool.serverId,
          readOnly: tool.readOnly,
          sideEffect: tool.sideEffect,
        }))
      const matches = { skills, mcpTools }
      return { output: JSON.stringify(matches, null, 2), structured: matches, status: 'ok' }
    },
  },
  {
    definition: {
      name: 'activate_skill',
      title: '激活技能',
      description: 'Activate a discovered skill for the current turn. Input: { "skillId": string, "reason": string }.',
      inputSchema: { type: 'object', required: ['skillId', 'reason'], properties: { skillId: { type: 'string' }, reason: { type: 'string' } }, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
      deferred: true,
      category: 'extension',
      keywords: ['skill', 'activate'],
      activationHint: 'Use after search_skills identifies a relevant skill.',
    },
    visibility: 'model',
    sideEffect: 'none',
    validate: validateActivateSkillInput,
    summarize: input => `${str(input, 'skillId')}: ${str(input, 'reason')}`,
    execute: async (input, { session, turn, context }) => {
      const { skill, activation } = activateSkill({
        skillId: str(input, 'skillId'),
        reason: str(input, 'reason'),
        sessionId: session.id,
        turnId: turn.id,
        workspace: context.workspace,
      })
      void appendSessionEvent({ type: 'skill.activated', sessionId: session.id, turnId: turn.id, activation })
      return {
        output: `已激活技能 ${skill.name}。`,
        structured: { activation, skill: { id: skill.id, name: skill.name, source: skill.source, trust: skill.trust, pluginId: skill.pluginId } },
        status: 'ok',
      }
    },
  },
  {
    definition: {
      name: 'explore_codebase',
      title: '探索代码库',
      description: 'High-level read-only exploration using directory listing, optional search, git status, and diagnostics. Input: { "query"?: string, "dirPath"?: string }.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, dirPath: { type: 'string' } }, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
      category: 'composed',
      keywords: ['explore', 'codebase', 'overview'],
    },
    visibility: 'model',
    sideEffect: 'workspace_read',
    validate: input => validateStringFields(input, [], ['query', 'dirPath']),
    summarize: input => str(input, 'query') || str(input, 'dirPath') || '代码库概览',
    execute: async (input, { context }) => {
      const workspace = requireWorkspace(context.workspace)
      const entries = await workspaceReadDirectory(workspace, str(input, 'dirPath') || workspace.path)
      const status = await workspaceGitStatus(workspace).catch(error => error instanceof Error ? error.message : String(error))
      const search = str(input, 'query') ? await workspaceSearchFiles(workspace, str(input, 'query')).catch(error => error instanceof Error ? error.message : String(error)) : ''
      const output = [
        `Workspace: ${workspaceLabel(workspace)}`,
        '',
        'Directory:',
        entries.slice(0, 80).map(entry => `${entry.isDirectory ? 'dir ' : 'file'} ${entry.name}`).join('\n') || '(空目录)',
        '',
        'Git:',
        status,
        ...(search ? ['', 'Search:', search] : []),
      ].join('\n')
      const limited = truncate(output)
      return { output: limited.text, truncated: limited.truncated, structured: { entryCount: entries.length, query: str(input, 'query') || null }, status: 'ok' }
    },
  },
  {
    definition: {
      name: 'verify_changes',
      title: '验证变更',
      description: 'Run the project verification command and return command evidence. Input: {}.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      isReadOnly: false,
      risk: 'medium',
      category: 'composed',
      keywords: ['verify', 'test', 'typecheck', 'build'],
    },
    visibility: 'model',
    sideEffect: 'process',
    validate: validateNoInput,
    summarize: () => '运行验证',
    execute: async (_input, { session, turn }) => {
      const { result, evidence } = await new VerifierRunner(session, turn).runFirstAvailableWithEvidence()
      return {
        output: evidence.output || result.output,
        artifact: result.artifact,
        artifactRef: result.artifactRef,
        structured: { result, evidence },
        status: result.status === 'passed' || result.status === 'skipped' ? 'ok' : 'error',
        error: result.status === 'failed' || result.status === 'blocked' ? 'verification_failed' : undefined,
      }
    },
  },
  {
    definition: {
      name: 'inspect_runtime_state',
      title: '检查运行状态',
      description: 'Capture process/checkpoint/sandbox/evidence runtime state as an artifact. Input: {}.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
      deferred: true,
      category: 'runtime',
      keywords: ['runtime state', 'process', 'checkpoint', 'sandbox'],
      activationHint: 'Use when debugging long-running process or resume state.',
    },
    visibility: 'model',
    sideEffect: 'none',
    validate: validateNoInput,
    summarize: () => 'runtime state',
    execute: async (_input, { session, turn, context }) => {
      const { state, artifact } = await captureRuntimeState({ sessionId: session.id, turnId: turn.id, workspace: context.workspace })
      return {
        output: `runtime state captured: ${artifact.id}`,
        artifact,
        artifactRef: artifact.id,
        structured: state as unknown as Record<string, unknown>,
        status: 'ok',
      }
    },
  },
  {
    definition: {
      name: 'create_memory',
      title: '创建项目记忆',
      description: 'Save a project-level memory entry. Input: { "kind": "command"|"convention"|"decision"|"known_issue"|"workflow", "text": string, "sourceRefs": string[] }.',
      inputSchema: { type: 'object', required: ['kind', 'text', 'sourceRefs'], properties: { kind: { type: 'string' }, text: { type: 'string' }, sourceRefs: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
      isReadOnly: false,
      risk: 'low',
      deferred: true,
      category: 'memory',
      keywords: ['memory', 'remember', 'convention'],
      activationHint: 'Use after a durable project fact has source evidence.',
    },
    visibility: 'model',
    sideEffect: 'none',
    validate: input => {
      const base = validateStringFields(input, ['kind', 'text'], [])
      if (!base.ok) return base
      const kind = (input as Record<string, unknown>).kind as string
      if (!['command', 'convention', 'decision', 'known_issue', 'workflow', 'handoff'].includes(kind)) {
        return { ok: false, error: `无效的记忆类型: ${kind}` }
      }
      const sourceRefs = (input as Record<string, unknown>).sourceRefs as string[] | undefined
      if (!sourceRefs || sourceRefs.length === 0) {
        return { ok: false, error: 'sourceRefs 不能为空' }
      }
      return { ok: true, normalizedInput: input as Record<string, unknown> }
    },
    summarize: input => `创建 ${str(input, 'kind')} 记忆: ${str(input, 'text').slice(0, 80)}`,
    execute: async (input, { context }) => {
      const workspacePath = context.workspace?.path
      if (!workspacePath) throw new Error('需要工作区才能创建项目记忆。')
      const { MemoryStore } = await import('./memory')
      const store = new MemoryStore(workspacePath)
      store.load()
      const entry = store.add(
        str(input, 'kind') as ProjectMemoryKind,
        str(input, 'text'),
        (input.sourceRefs as string[]) || [],
      )
      return {
        callId: '',
        toolName: 'create_memory',
        input: input as Record<string, unknown>,
        output: `已创建 ${entry.kind} 记忆: ${entry.text.slice(0, 120)}`,
        structured: entry as unknown as Record<string, unknown>,
        status: 'ok' as const,
      }
    },
  },
]

const registryByName = new Map(toolRegistry.map(tool => [tool.definition.name, tool]))

function createMcpRegisteredTool(namespace: string): RegisteredTool | null {
  const tool = listMcpTools().find(item => item.namespace === namespace)
  if (!tool || tool.name === '*') return null
  return {
    definition: {
      name: tool.namespace,
      title: tool.title || tool.name,
      description: tool.description || `MCP tool from ${tool.pluginId}/${tool.serverId}.`,
      inputSchema: tool.inputSchema || { type: 'object', properties: {}, additionalProperties: true },
      isReadOnly: tool.readOnly,
      risk: tool.sideEffect === 'none' || tool.sideEffect === 'workspace_read' ? 'low' : tool.sideEffect === 'workspace_write' ? 'high' : 'critical',
      visibility: 'model',
      sideEffect: tool.sideEffect,
      deferred: true,
      category: 'mcp',
      keywords: ['mcp', tool.pluginId, tool.serverId, tool.name],
      activationHint: 'Use after search_tools or search_skills discovers this MCP tool and policy allows it.',
    },
    visibility: 'model',
    sideEffect: tool.sideEffect,
    validate: input => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('MCP tool input must be an object.')
      return ok(input)
    },
    summarize: () => tool.namespace,
    execute: async input => callMcpTool(tool.namespace, input),
  }
}

function publicDefinition(tool: RegisteredTool): AgentToolDefinition {
  return {
    ...tool.definition,
    visibility: tool.visibility,
    sideEffect: tool.sideEffect,
  }
}

export function getToolDefinitions(): AgentToolDefinition[] {
  const mcpDefinitions = registerMcpToolDescriptors().map(tool => ({
    name: tool.namespace,
    title: tool.title || tool.name,
    description: tool.description || `MCP tool from ${tool.pluginId}/${tool.serverId}.`,
    inputSchema: tool.inputSchema || { type: 'object', properties: {}, additionalProperties: true },
    isReadOnly: tool.readOnly,
    risk: tool.readOnly ? 'low' as const : 'critical' as const,
    visibility: 'model' as const,
    sideEffect: tool.sideEffect,
    deferred: true,
    category: 'mcp',
    keywords: ['mcp', tool.pluginId, tool.serverId, tool.name],
  }))
  return [...toolRegistry.map(publicDefinition), ...mcpDefinitions].sort((a, b) => a.name.localeCompare(b.name))
}

export function getModelVisibleToolDefinitions(): AgentToolDefinition[] {
  return toolRegistry
    .filter(tool => tool.visibility === 'model' && !tool.definition.deferred)
    .map(publicDefinition)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function isModelVisibleTool(name: string): boolean {
  return registryByName.get(name)?.visibility === 'model' || Boolean(createMcpRegisteredTool(name))
}

export function getRegisteredTool(name: string): RegisteredTool | null {
  return registryByName.get(name) ?? createMcpRegisteredTool(name)
}

export function createRuntimeToolCall(name: string, input: Record<string, unknown>, id?: string): RuntimeToolCall {
  return { id: id || `tool_${randomUUID()}`, name, input }
}

export async function executeToolCall(call: RuntimeToolCall, context: ToolExecutionContext): Promise<AgentToolResult> {
  const tool = getRegisteredTool(call.name)
  if (!tool) {
    return { callId: call.id, toolName: call.name, input: call.input, output: `未知工具 ${call.name}`, error: 'unknown_tool', failureType: 'unknown_tool', status: 'error' }
  }
  const validation = tool.validate(call.input)
  if (!validation.ok) {
    return {
      callId: call.id,
      toolName: call.name,
      input: call.input,
      output: validation.error || '工具输入无效。',
      error: 'invalid_input',
      failureType: 'invalid_input',
      status: 'error',
    }
  }
  const normalizedInput = validation.normalizedInput ?? call.input
  try {
    const result = await tool.execute(normalizedInput, context)
    return { ...result, callId: call.id, toolName: call.name, input: normalizedInput }
  } catch (error) {
    const failureType = classifyToolError(error)
    return {
      callId: call.id,
      toolName: call.name,
      input: normalizedInput,
      output: error instanceof Error ? error.message : String(error),
      error: failureType,
      failureType,
      status: failureType === 'timeout' ? 'timeout' : failureType === 'conflict' ? 'conflict' : 'error',
    }
  }
}
