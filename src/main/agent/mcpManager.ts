import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'
import type { AgentWorkspaceLocation, McpServerConfig, McpServerState, McpToolDescriptor, PluginManifest, ToolResultView } from '../../shared/agent/protocol'
import { createArtifact } from './artifactStore'
import { discoverExtensions, resolvePluginCommandCwd } from './skillStore'
import { needsShell } from './workspace'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface McpRecord {
  plugin: PluginManifest
  server: McpServerConfig
  state: McpServerState
  child?: ChildProcessWithoutNullStreams
  buffer: Buffer
  output: string
  nextId: number
  pending: Map<number, PendingRequest>
}

const records = new Map<string, McpRecord>()

function key(pluginId: string, serverId: string): string {
  return `${pluginId}:${serverId}`
}

function now(): number {
  return Date.now()
}

function parseCommand(commandLine: string): { command: string; args: string[]; shell: boolean } {
  if (needsShell(commandLine)) return { command: commandLine, args: [], shell: true }
  const parts = commandLine.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(value => value.replace(/^["']|["']$/g, '')) ?? []
  return { command: parts[0], args: parts.slice(1), shell: false }
}

function encodeMessage(payload: unknown): string {
  const body = JSON.stringify(payload)
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
}

function readMessages(record: McpRecord, chunk: Buffer): unknown[] {
  record.buffer = Buffer.concat([record.buffer, chunk])
  const messages: unknown[] = []
  while (true) {
    const headerEnd = record.buffer.indexOf('\r\n\r\n')
    if (headerEnd < 0) break
    const header = record.buffer.subarray(0, headerEnd).toString('utf8')
    const match = /Content-Length:\s*(\d+)/i.exec(header)
    if (!match) {
      record.buffer = Buffer.alloc(0)
      break
    }
    const length = Number(match[1])
    const bodyStart = headerEnd + 4
    if (record.buffer.length - bodyStart < length) break
    const body = record.buffer.subarray(bodyStart, bodyStart + length).toString('utf8')
    record.buffer = record.buffer.subarray(bodyStart + length)
    try { messages.push(JSON.parse(body)) } catch { /* ignore malformed server message */ }
  }
  return messages
}

function descriptor(plugin: PluginManifest, server: McpServerConfig, tool: { name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean; sideEffect?: string } }): McpToolDescriptor {
  const sideEffect = (tool.annotations?.sideEffect as McpToolDescriptor['sideEffect'] | undefined) || server.sideEffect || (tool.annotations?.readOnlyHint ? 'none' : 'external')
  return {
    name: tool.name,
    title: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema || { type: 'object', properties: {}, additionalProperties: true },
    sideEffect,
    namespace: `mcp.${plugin.id}.${server.id}.${tool.name}`,
    pluginId: plugin.id,
    serverId: server.id,
    readOnly: sideEffect === 'none' || sideEffect === 'workspace_read',
  }
}

function wireRecord(record: McpRecord): void {
  const child = record.child
  if (!child) return
  child.stdout.on('data', chunk => {
    record.output += chunk.toString()
    for (const message of readMessages(record, chunk)) {
      const response = message as { id?: number; result?: unknown; error?: { message?: string } }
      if (typeof response.id !== 'number') continue
      const pending = record.pending.get(response.id)
      if (!pending) continue
      clearTimeout(pending.timer)
      record.pending.delete(response.id)
      if (response.error) pending.reject(new Error(response.error.message || 'MCP request failed'))
      else pending.resolve(response.result)
    }
  })
  child.stderr.on('data', chunk => {
    record.output += chunk.toString()
  })
  child.on('error', error => {
    record.state = { ...record.state, status: 'failed', lastError: error.message, updatedAt: now() }
  })
  child.on('close', code => {
    const artifact = createArtifact({
      sessionId: record.state.id,
      kind: 'command_output',
      content: record.output || `(MCP server exited ${code})`,
      mimeType: 'text/plain; charset=utf-8',
    })
    record.state = {
      ...record.state,
      status: record.state.status === 'stopped' ? 'stopped' : code === 0 ? 'stopped' : 'stopped_error',
      lastError: code === 0 ? undefined : `MCP server exited with ${code}; output ${artifact.id}`,
      updatedAt: now(),
    }
  })
}

async function request(record: McpRecord, method: string, params?: unknown): Promise<unknown> {
  if (!record.child || record.state.status !== 'running') throw new Error('MCP server is not running.')
  const id = record.nextId++
  const payload = { jsonrpc: '2.0', id, method, params }
  const promise = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      record.pending.delete(id)
      reject(new Error(`MCP request timed out: ${method}`))
    }, 5000)
    record.pending.set(id, { resolve, reject, timer })
  })
  record.child.stdin.write(encodeMessage(payload))
  return promise
}

export function listMcpServerStates(): McpServerState[] {
  return [...records.values()].map(record => record.state)
}

export function listMcpTools(): McpToolDescriptor[] {
  return listMcpServerStates().flatMap(state => state.tools)
}

export async function startMcpServer(input: { sessionId: string; pluginId: string; serverId: string; workspace?: AgentWorkspaceLocation | null }): Promise<McpServerState> {
  const snapshot = discoverExtensions(input.workspace)
  const plugin = snapshot.plugins.find(item => item.id === input.pluginId)
  const server = plugin?.mcpServers.find(item => item.id === input.serverId)
  if (!plugin || !server) throw new Error('MCP server config not found.')
  if (!server.enabled) throw new Error('MCP server is disabled.')
  const existing = records.get(key(plugin.id, server.id))
  if (existing?.state.status === 'running') return existing.state
  const parsed = parseCommand(server.command)
  const cwd = resolvePluginCommandCwd(plugin, server, input.workspace)
  const child = parsed.shell
    ? spawn(parsed.command, { cwd, shell: true, env: { ...process.env, ...(server.env || {}) }, windowsHide: true })
    : spawn(parsed.command, parsed.args, { cwd, shell: false, env: { ...process.env, ...(server.env || {}) }, windowsHide: true })
  const state: McpServerState = {
    id: input.sessionId,
    pluginId: plugin.id,
    serverId: server.id,
    status: 'running',
    pid: child.pid,
    startedAt: now(),
    updatedAt: now(),
    tools: [],
  }
  const record: McpRecord = { plugin, server, state, child, buffer: Buffer.alloc(0), output: '', nextId: 1, pending: new Map() }
  records.set(key(plugin.id, server.id), record)
  wireRecord(record)
  await request(record, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'RilleCode', version: '0.1.0' } }).catch(error => {
    record.state = { ...record.state, status: 'failed', lastError: error.message, updatedAt: now() }
  })
  if (record.state.status === 'running') {
    const listed = await request(record, 'tools/list').catch(error => {
      record.state = { ...record.state, status: 'failed', lastError: error.message, updatedAt: now() }
      return null
    }) as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean; sideEffect?: string } }> } | null
    if (listed?.tools) {
      record.state = { ...record.state, tools: listed.tools.map(tool => descriptor(plugin, server, tool)), updatedAt: now() }
    }
  }
  return record.state
}

export function stopMcpServer(pluginId: string, serverId: string): McpServerState | null {
  const record = records.get(key(pluginId, serverId))
  if (!record) return null
  record.state = { ...record.state, status: 'stopped', updatedAt: now() }
  record.child?.kill('SIGTERM')
  return record.state
}

export async function callMcpTool(namespace: string, args: Record<string, unknown>): Promise<ToolResultView> {
  const tool = listMcpTools().find(item => item.namespace === namespace)
  if (!tool) return { output: `MCP tool not found: ${namespace}`, status: 'error', error: 'unknown_tool' }
  const record = records.get(key(tool.pluginId, tool.serverId))
  if (!record) return { output: `MCP server not running: ${tool.pluginId}/${tool.serverId}`, status: 'error', error: 'environment_missing' }
  const result = await request(record, 'tools/call', { name: tool.name, arguments: args }).catch(error => ({ error: error.message }))
  if ((result as { error?: string }).error) return { output: String((result as { error: string }).error), status: 'error', error: 'tool_failed' }
  const output = JSON.stringify(result, null, 2)
  const artifact = createArtifact({ sessionId: record.state.id, kind: 'command_output', content: output, mimeType: 'application/json' })
  return { output, structured: result as Record<string, unknown>, artifact, artifactRef: artifact.id, status: 'ok' }
}

export function registerMcpToolDescriptors(workspace?: AgentWorkspaceLocation | null): McpToolDescriptor[] {
  const configs = discoverExtensions(workspace).plugins.flatMap(plugin => plugin.mcpServers.map(server => ({ plugin, server })))
  const configured = configs.map(({ plugin, server }) => ({
    name: '*',
    inputSchema: { type: 'object', properties: {}, additionalProperties: true },
    annotations: { sideEffect: server.sideEffect || 'external' },
    plugin,
    server,
  }))
  return [...listMcpTools(), ...configured.map(item => descriptor(item.plugin, item.server, item))]
    .filter((tool, index, all) => all.findIndex(other => other.namespace === tool.namespace) === index)
}
