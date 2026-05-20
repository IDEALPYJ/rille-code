import { execFile, spawn } from 'child_process'
import { readdir, readFile } from 'fs/promises'
import { basename, isAbsolute, relative, resolve } from 'path'
import type { AgentWorkspaceLocation, ToolResultView } from '../../shared/agent/protocol'

export interface CommandRunInput {
  commandLine: string
  cwd?: string
  timeoutMs?: number
  outputLimitBytes?: number
  shellMode?: boolean
}

export interface WorkspaceHost {
  readDirectory(workspace: AgentWorkspaceLocation, dirPath: string): Promise<Array<{ name: string; path: string; isDirectory: boolean }>>
  readFile(workspace: AgentWorkspaceLocation, filePath: string): Promise<string>
  writeFile(workspace: AgentWorkspaceLocation, filePath: string, content: string): Promise<boolean>
  searchFiles(workspace: AgentWorkspaceLocation, query: string): Promise<string>
  gitStatus(workspace: AgentWorkspaceLocation): Promise<string>
  gitDiff(workspace: AgentWorkspaceLocation, filePath?: string): Promise<string>
  runCommand(workspace: AgentWorkspaceLocation, input: CommandRunInput): Promise<ToolResultView>
}

let remoteHost: WorkspaceHost | null = null

const DEFAULT_OUTPUT_LIMIT = 50 * 1024

export function setAgentWorkspaceHost(host: WorkspaceHost): void {
  remoteHost = host
}

export function isRemoteWorkspace(workspace?: AgentWorkspaceLocation | null): workspace is AgentWorkspaceLocation & { connectionId: string } {
  return Boolean(workspace && workspace.kind !== 'local' && workspace.connectionId)
}

export function requireWorkspace(workspace?: AgentWorkspaceLocation | null): AgentWorkspaceLocation {
  if (!workspace) throw new Error('未打开工作区。')
  return workspace
}

function normalizeRemotePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/')
}

export function withinWorkspace(workspace: AgentWorkspaceLocation, filePath?: string): string {
  const root = workspace.kind === 'local' ? resolve(workspace.path) : normalizeRemotePath(workspace.path).replace(/\/+$/, '') || '/'
  if (!filePath) return root
  if (workspace.kind === 'local') {
    const absolute = isAbsolute(filePath) || /^[a-zA-Z]:[\\/]/.test(filePath) ? resolve(filePath) : resolve(root, filePath)
    const rel = relative(root, absolute)
    if (rel.startsWith('..') || rel === '..' || resolve(root, rel) !== absolute) throw new Error('文件路径不在当前工作区内。')
    return absolute
  }
  const candidate = normalizeRemotePath(filePath)
  const absolute = candidate === '.' ? root : candidate.startsWith('/') ? candidate : `${root}/${candidate}`.replace(/\/+/g, '/')
  const prefix = root.endsWith('/') ? root : `${root}/`
  if (absolute !== root && !absolute.startsWith(prefix)) throw new Error('文件路径不在当前工作区内。')
  return absolute
}

function truncateBytes(text: string, maxBytes = DEFAULT_OUTPUT_LIMIT): { output: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= maxBytes) return { output: text, truncated: false }
  const head = text.slice(0, Math.floor(maxBytes * 0.45))
  const tail = text.slice(-Math.floor(maxBytes * 0.25))
  return { output: `${head}\n\n...[output truncated ${bytes - Buffer.byteLength(head) - Buffer.byteLength(tail)} bytes]...\n\n${tail}`, truncated: true }
}

function shellTokens(commandLine: string): string[] {
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
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

export function needsShell(commandLine: string): boolean {
  return /[|&;<>()`]|>>?|\\n|\$\(/.test(commandLine)
}

function execFileText(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise(resolvePromise => {
    execFile(command, args, { cwd, maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: unknown } | null)?.code === 'number' ? (error as { code: number }).code : error ? 1 : 0
      resolvePromise({ stdout: stdout.toString(), stderr: stderr.toString(), exitCode: code })
    })
  })
}

async function localListDirectory(workspace: AgentWorkspaceLocation, dirPath: string) {
  const absolute = withinWorkspace(workspace, dirPath || workspace.path)
  const entries = await readdir(absolute, { withFileTypes: true })
  return entries
    .filter(entry => !['.git', 'node_modules', 'out', 'dist'].includes(entry.name))
    .slice(0, 160)
    .map(entry => ({ name: entry.name, path: resolve(absolute, entry.name), isDirectory: entry.isDirectory() }))
}

async function localSearchFiles(workspace: AgentWorkspaceLocation, query: string): Promise<string> {
  const safeQuery = query.trim()
  if (!safeQuery) throw new Error('搜索关键词为空。')
  const result = await execFileText('rg', ['--line-number', '--column', '--max-count', '40', '--hidden', '-g', '!.git', '-g', '!node_modules', safeQuery], workspace.path)
  return result.stdout || result.stderr || '(无匹配)'
}

async function localGitStatus(workspace: AgentWorkspaceLocation): Promise<string> {
  const result = await execFileText('git', ['status', '--short', '--branch'], workspace.path)
  return result.stdout.trim() || result.stderr.trim() || '工作区干净。'
}

async function localGitDiff(workspace: AgentWorkspaceLocation, filePath?: string): Promise<string> {
  const args = ['diff', '--', ...(filePath ? [relative(workspace.path, withinWorkspace(workspace, filePath))] : [])]
  const result = await execFileText('git', args, workspace.path)
  return result.stdout || result.stderr || '没有 unstaged diff。'
}

async function localRunCommand(workspace: AgentWorkspaceLocation, input: CommandRunInput): Promise<ToolResultView> {
  const startedAt = Date.now()
  const timeoutMs = Math.max(1000, Math.min(input.timeoutMs || 120_000, 600_000))
  const outputLimitBytes = Math.max(1024, Math.min(input.outputLimitBytes || DEFAULT_OUTPUT_LIMIT, 512 * 1024))
  const cwd = withinWorkspace(workspace, input.cwd || workspace.path)
  const commandLine = input.commandLine.trim()
  if (!commandLine) throw new Error('命令为空。')
  const shellMode = input.shellMode || needsShell(commandLine)
  const tokens = shellMode ? [] : shellTokens(commandLine)
  if (!shellMode && tokens.length === 0) throw new Error('命令为空。')

  return new Promise(resolvePromise => {
    const child = shellMode
      ? spawn(commandLine, { cwd, shell: true, windowsHide: true })
      : spawn(tokens[0], tokens.slice(1), { cwd, shell: false, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, 5000)
    }, timeoutMs)
    child.stdout?.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', error => {
      clearTimeout(timer)
      const limited = truncateBytes(error.message, outputLimitBytes)
      resolvePromise({ output: limited.output, truncated: limited.truncated, error: 'command_failed', status: 'error', exitCode: null, timedOut, durationMs: Date.now() - startedAt })
    })
    child.on('close', code => {
      clearTimeout(timer)
      const combined = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join('\n')
      const limited = truncateBytes(combined || '(no output)', outputLimitBytes)
      resolvePromise({
        output: limited.output,
        truncated: limited.truncated,
        status: timedOut ? 'timeout' : code === 0 ? 'ok' : 'error',
        error: timedOut ? 'command_timeout' : code === 0 ? undefined : 'command_failed',
        exitCode: code,
        timedOut,
        durationMs: Date.now() - startedAt,
        structured: { cwd, shellMode },
      })
    })
  })
}

function requireRemoteHost(): WorkspaceHost {
  if (!remoteHost) throw new Error('远程 Agent 执行器尚未初始化。')
  return remoteHost
}

export async function workspaceReadDirectory(workspace: AgentWorkspaceLocation, dirPath?: string) {
  const absolute = withinWorkspace(workspace, dirPath || workspace.path)
  return isRemoteWorkspace(workspace) ? requireRemoteHost().readDirectory(workspace, absolute) : localListDirectory(workspace, absolute)
}

export async function workspaceReadFile(workspace: AgentWorkspaceLocation, filePath: string): Promise<string> {
  const absolute = withinWorkspace(workspace, filePath)
  return isRemoteWorkspace(workspace) ? requireRemoteHost().readFile(workspace, absolute) : readFile(absolute, 'utf8')
}

export async function workspaceWriteFile(workspace: AgentWorkspaceLocation, filePath: string, content: string): Promise<boolean> {
  const absolute = withinWorkspace(workspace, filePath)
  if (isRemoteWorkspace(workspace)) return requireRemoteHost().writeFile(workspace, absolute, content)
  throw new Error('Local writes must go through editStore to preserve conflict checks.')
}

export async function workspaceSearchFiles(workspace: AgentWorkspaceLocation, query: string): Promise<string> {
  if (isRemoteWorkspace(workspace)) return requireRemoteHost().searchFiles(workspace, query)
  return localSearchFiles(workspace, query)
}

export async function workspaceGitStatus(workspace: AgentWorkspaceLocation): Promise<string> {
  if (isRemoteWorkspace(workspace)) return requireRemoteHost().gitStatus(workspace)
  return localGitStatus(workspace)
}

export async function workspaceGitDiff(workspace: AgentWorkspaceLocation, filePath?: string): Promise<string> {
  if (isRemoteWorkspace(workspace)) return requireRemoteHost().gitDiff(workspace, filePath ? withinWorkspace(workspace, filePath) : undefined)
  return localGitDiff(workspace, filePath)
}

export async function workspaceRunCommand(workspace: AgentWorkspaceLocation, input: CommandRunInput): Promise<ToolResultView> {
  const cwd = withinWorkspace(workspace, input.cwd || workspace.path)
  if (isRemoteWorkspace(workspace)) return requireRemoteHost().runCommand(workspace, { ...input, cwd, shellMode: true })
  return localRunCommand(workspace, { ...input, cwd })
}

export function workspaceLabel(workspace: AgentWorkspaceLocation): string {
  return basename(workspace.path) || workspace.label || workspace.path
}
