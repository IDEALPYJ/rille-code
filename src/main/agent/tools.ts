import { randomUUID } from 'crypto'
import type {
  AgentContextSnapshot,
  AgentSession,
  AgentToolDefinition,
  AgentToolResult,
  AgentTurn,
  EditProposal,
  ToolResultView,
} from '../../shared/agent/protocol'
import { applyEditProposal, createEditProposal } from './editStore'
import {
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

export interface RuntimeToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolExecutionContext {
  session: AgentSession
  turn: AgentTurn
  context: AgentContextSnapshot
  emitProposal: (proposal: EditProposal) => void
}

export interface RegisteredTool {
  definition: AgentToolDefinition
  modelVisible?: boolean
  summarize(input: Record<string, unknown>, context: AgentContextSnapshot): string
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

export const toolRegistry: RegisteredTool[] = [
  {
    definition: {
      name: 'get_active_editor',
      title: '读取活动编辑器',
      description: 'Get the current active editor file path, dirty state, and cursor.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
    },
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
    },
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
    },
    summarize: () => '诊断快照',
    execute: async (_input, { context }) => diagnostics(context),
  },
  {
    definition: {
      name: 'list_directory',
      title: '列出目录',
      description: 'List files and folders inside the workspace. Input: { "dirPath"?: string }.',
      inputSchema: { type: 'object', properties: { dirPath: { type: 'string' } }, additionalProperties: false },
      isReadOnly: true,
      risk: 'low',
    },
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
    },
    summarize: input => str(input, 'filePath'),
    execute: async (input, { context }) => {
      const workspace = requireWorkspace(context.workspace)
      const filePath = str(input, 'filePath') || context.activeFile?.path || ''
      const content = context.activeFile?.path === filePath && context.activeFile.content !== undefined
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
    },
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
    },
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
    },
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
    },
    summarize: input => str(input, 'filePath'),
    execute: async (input, { session, turn, context, emitProposal }) => {
      const workspace = requireWorkspace(context.workspace)
      const filePath = str(input, 'filePath') || context.activeFile?.path || ''
      const absolutePath = withinWorkspace(workspace, filePath)
      const originalContent = context.activeFile?.path === filePath && context.activeFile.content !== undefined
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
    },
    modelVisible: false,
    summarize: input => str(input, 'proposalId'),
    execute: async (input, { context }) => {
      const proposal = await applyEditProposal(str(input, 'proposalId'), context.workspace)
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
      name: 'run_command',
      title: '运行命令',
      description: 'Run a non-interactive workspace command. Input: { "commandLine": string, "cwd"?: string, "timeoutMs"?: number }.',
      inputSchema: { type: 'object', required: ['commandLine'], properties: { commandLine: { type: 'string' }, cwd: { type: 'string' }, timeoutMs: { type: 'number' } }, additionalProperties: false },
      isReadOnly: false,
      risk: 'high',
    },
    summarize: input => str(input, 'commandLine'),
    execute: async (input, { context }) => {
      const workspace = requireWorkspace(context.workspace)
      return workspaceRunCommand(workspace, {
        commandLine: str(input, 'commandLine'),
        cwd: str(input, 'cwd') || undefined,
        timeoutMs: num(input, 'timeoutMs'),
        outputLimitBytes: 50 * 1024,
        shellMode: needsShell(str(input, 'commandLine')),
      })
    },
  },
]

const registryByName = new Map(toolRegistry.map(tool => [tool.definition.name, tool]))

export function getToolDefinitions(): AgentToolDefinition[] {
  return toolRegistry.map(tool => tool.definition).sort((a, b) => a.name.localeCompare(b.name))
}

export function getModelVisibleToolDefinitions(): AgentToolDefinition[] {
  return toolRegistry
    .filter(tool => tool.modelVisible !== false)
    .map(tool => tool.definition)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function isModelVisibleTool(name: string): boolean {
  return registryByName.get(name)?.modelVisible !== false
}

export function getRegisteredTool(name: string): RegisteredTool | null {
  return registryByName.get(name) ?? null
}

export function createRuntimeToolCall(name: string, input: Record<string, unknown>, id?: string): RuntimeToolCall {
  return { id: id || `tool_${randomUUID()}`, name, input }
}

export async function executeToolCall(call: RuntimeToolCall, context: ToolExecutionContext): Promise<AgentToolResult> {
  const tool = getRegisteredTool(call.name)
  if (!tool) {
    return { callId: call.id, toolName: call.name, input: call.input, output: `未知工具 ${call.name}`, error: 'unknown_tool', status: 'error' }
  }
  try {
    const result = await tool.execute(call.input, context)
    return { ...result, callId: call.id, toolName: call.name, input: call.input }
  } catch (error) {
    return {
      callId: call.id,
      toolName: call.name,
      input: call.input,
      output: error instanceof Error ? error.message : String(error),
      error: 'tool_failed',
      status: 'error',
    }
  }
}
