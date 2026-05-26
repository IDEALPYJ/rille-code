import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'
import type { AgentWorkspaceLocation, RuntimeProcessSummary } from '../../shared/agent/protocol'
import { createArtifact } from './artifactStore'
import { killProcess } from './platform'
import { needsShell, withinWorkspace } from './workspace'

interface RuntimeProcessRecord {
  summary: RuntimeProcessSummary
  child?: ChildProcessWithoutNullStreams
  output: string
}

const processes = new Map<string, RuntimeProcessRecord>()

function now(): number {
  return Date.now()
}

function tokens(commandLine: string): string[] {
  return commandLine.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(value => value.replace(/^["']|["']$/g, '')) ?? []
}

export interface StartRuntimeProcessInput {
  sessionId: string
  workspace: AgentWorkspaceLocation
  commandLine: string
  cwd?: string
}

export function startRuntimeProcess(input: StartRuntimeProcessInput): RuntimeProcessSummary {
  const id = `process_${randomUUID()}`
  const cwd = withinWorkspace(input.workspace, input.cwd || input.workspace.path)
  const commandLine = input.commandLine.trim()
  if (!commandLine) throw new Error('命令为空。')
  const shellMode = needsShell(commandLine)
  const parts = shellMode ? [] : tokens(commandLine)
  if (!shellMode && parts.length === 0) throw new Error('命令为空。')
  const child = shellMode
    ? spawn(commandLine, { cwd, shell: true, windowsHide: true })
    : spawn(parts[0], parts.slice(1), { cwd, shell: false, windowsHide: true })
  const timestamp = now()
  const summary: RuntimeProcessSummary = {
    id,
    sessionId: input.sessionId,
    workspace: input.workspace,
    commandLine,
    cwd,
    pid: child.pid,
    status: 'running',
    startedAt: timestamp,
    updatedAt: timestamp,
  }
  const record: RuntimeProcessRecord = { summary, child, output: '' }
  processes.set(id, record)
  const append = (chunk: Buffer) => {
    record.output += chunk.toString()
    record.summary = { ...record.summary, updatedAt: now() }
  }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  child.on('error', error => {
    record.output += error.message
    const artifact = createArtifact({
      sessionId: input.sessionId,
      kind: 'command_output',
      content: record.output,
      mimeType: 'text/plain; charset=utf-8',
    })
    record.summary = {
      ...record.summary,
      status: 'failed',
      outputArtifact: artifact,
      outputArtifactRef: artifact.id,
      updatedAt: now(),
    }
  })
  child.on('close', code => {
    const artifact = createArtifact({
      sessionId: input.sessionId,
      kind: 'command_output',
      content: record.output || '(no output)',
      mimeType: 'text/plain; charset=utf-8',
    })
    record.summary = {
      ...record.summary,
      status: record.summary.status === 'stopped' ? 'stopped' : 'exited',
      exitCode: code,
      outputArtifact: artifact,
      outputArtifactRef: artifact.id,
      updatedAt: now(),
    }
  })
  return summary
}

export function listRuntimeProcesses(sessionId?: string): RuntimeProcessSummary[] {
  return [...processes.values()]
    .map(record => record.summary)
    .filter(process => !sessionId || process.sessionId === sessionId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function stopRuntimeProcess(processId: string): RuntimeProcessSummary | null {
  const record = processes.get(processId)
  if (!record) return null
  if (record.child && record.summary.status === 'running') {
    record.summary = { ...record.summary, status: 'stopped', updatedAt: now() }
    killProcess(record.child)
  }
  return record.summary
}

export function cleanupRuntimeProcesses(sessionId?: string): RuntimeProcessSummary[] {
  const stopped: RuntimeProcessSummary[] = []
  for (const process of listRuntimeProcesses(sessionId)) {
    if (process.status === 'running' || process.status === 'starting') {
      const next = stopRuntimeProcess(process.id)
      if (next) stopped.push(next)
    }
  }
  return stopped
}

