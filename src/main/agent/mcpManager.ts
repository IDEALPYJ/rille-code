import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import type { AgentWorkspaceLocation, McpServerConfig, McpServerState, McpToolDescriptor, PluginManifest, ToolResultView } from '../../shared/agent/protocol'
import { createArtifact } from './artifactStore'
import { discoverExtensions, resolvePluginCommandCwd } from './skillStore'
import { killProcess } from './platform'
import { needsShell } from './workspace'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface McpTransportClient {
  pid?: number
  start(): Promise<void>
  request(method: string, params?: unknown): Promise<unknown>
  stop(): void
  output(): string
}

interface McpRecord {
  plugin: PluginManifest
  server: McpServerConfig
  state: McpServerState
  client: McpTransportClient
}

const records = new Map<string, McpRecord>()

function key(pluginId: string, serverId: string): string {
  return `${pluginId}:${serverId}`
}

function now(): number {
  return Date.now()
}

function timeoutMs(server: McpServerConfig): number {
  return server.timeoutMs && server.timeoutMs > 0 ? server.timeoutMs : 5000
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

function makeJsonRpc(id: number, method: string, params?: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, method, params }
}

function responseError(message: unknown): Error {
  const data = message as { error?: { message?: string } }
  return new Error(data.error?.message || 'MCP request failed')
}

function resolveHeaders(server: McpServerConfig): Record<string, string> {
  const headers: Record<string, string> = { ...(server.headers || {}) }
  for (const [header, envName] of Object.entries(server.authHeaders || {})) {
    const value = process.env[envName]
    if (value) headers[header] = value
  }
  return headers
}

function messageEndpoint(server: McpServerConfig): string {
  if (server.messageUrl) return server.messageUrl
  const url = server.url || ''
  if (/\/sse\/?$/i.test(url)) return url.replace(/\/sse\/?$/i, '/message')
  return url
}

function summarizeHttpError(status: number, text: string): string {
  return `MCP HTTP request failed (${status}): ${text.slice(0, 800) || 'empty response'}`
}

function parseSseChunk(buffer: string): { events: string[]; rest: string } {
  const chunks = buffer.split(/\r?\n\r?\n/)
  return { events: chunks.slice(0, -1), rest: chunks[chunks.length - 1] || '' }
}

function sseData(chunk: string): string {
  return chunk
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .join('\n')
}

class StdioMcpClient implements McpTransportClient {
  private child?: ChildProcessWithoutNullStreams
  private buffer = Buffer.alloc(0)
  private log = ''
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()

  constructor(private readonly server: McpServerConfig, private readonly cwd?: string) {}

  get pid(): number | undefined {
    return this.child?.pid
  }

  async start(): Promise<void> {
    const commandLine = this.server.command
    if (!commandLine) throw new Error('stdio MCP server command is required.')
    const parsed = parseCommand(commandLine)
    this.child = parsed.shell
      ? spawn(parsed.command, { cwd: this.cwd, shell: true, env: { ...process.env, ...(this.server.env || {}) }, windowsHide: true })
      : spawn(parsed.command, parsed.args, { cwd: this.cwd, shell: false, env: { ...process.env, ...(this.server.env || {}) }, windowsHide: true })
    this.wire()
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.child) throw new Error('MCP server is not running.')
    const id = this.nextId++
    const promise = this.pendingPromise(id, method)
    this.child.stdin.write(encodeMessage(makeJsonRpc(id, method, params)))
    return promise
  }

  stop(): void {
    if (this.child) killProcess(this.child)
  }

  output(): string {
    return this.log
  }

  private pendingPromise(id: number, method: string): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request timed out: ${method}`))
      }, timeoutMs(this.server))
      this.pending.set(id, { resolve, reject, timer })
    })
  }

  private wire(): void {
    const child = this.child
    if (!child) return
    child.stdout.on('data', chunk => {
      this.log += chunk.toString()
      for (const message of this.readMessages(chunk)) this.resolveMessage(message)
    })
    child.stderr.on('data', chunk => {
      this.log += chunk.toString()
    })
    child.on('error', error => {
      this.log += `\n${error.message}`
    })
    child.on('close', code => {
      if (code !== 0) this.log += `\nMCP server exited with ${code}`
    })
  }

  private readMessages(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const messages: unknown[] = []
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) break
      const header = this.buffer.subarray(0, headerEnd).toString('utf8')
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) {
        this.buffer = Buffer.alloc(0)
        break
      }
      const length = Number(match[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length - bodyStart < length) break
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8')
      this.buffer = this.buffer.subarray(bodyStart + length)
      try { messages.push(JSON.parse(body)) } catch { /* ignore malformed server message */ }
    }
    return messages
  }

  private resolveMessage(message: unknown): void {
    const response = message as { id?: number; error?: { message?: string }; result?: unknown }
    if (typeof response.id !== 'number') return
    const pending = this.pending.get(response.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(response.id)
    if (response.error) pending.reject(responseError(response))
    else pending.resolve(response.result)
  }
}

class HttpMcpClient implements McpTransportClient {
  protected nextId = 1
  protected log = ''

  constructor(protected readonly server: McpServerConfig) {}

  async start(): Promise<void> {
    if (!this.server.url) throw new Error('remote MCP server url is required.')
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++
    const started = now()
    const response = await fetch(this.server.url || '', {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs(this.server)),
      headers: { ...resolveHeaders(this.server), 'Content-Type': 'application/json' },
      body: JSON.stringify(makeJsonRpc(id, method, params)),
    })
    const text = await response.text()
    this.log += `\nhttp ${method} ${response.status} ${now() - started}ms`
    if (!response.ok) throw new Error(summarizeHttpError(response.status, text))
    const json = text ? JSON.parse(text) : {}
    const data = json as { id?: number; result?: unknown; error?: { message?: string } }
    if (data.error) throw responseError(data)
    return data.result
  }

  stop(): void {}

  output(): string {
    return this.log
  }
}

class SseMcpClient extends HttpMcpClient {
  private controller?: AbortController
  private readonly pending = new Map<number, PendingRequest>()
  private reconnectAttempts = 0
  private stopped = false

  async start(): Promise<void> {
    await this.openStream()
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++
    const payload = makeJsonRpc(id, method, params)
    const pending = this.pendingPromise(id, method)
    const response = await fetch(messageEndpoint(this.server), {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs(this.server)),
      headers: { ...resolveHeaders(this.server), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    this.log += `\nsse-post ${method} ${response.status}`
    if (!response.ok) {
      this.rejectPending(id, new Error(summarizeHttpError(response.status, text)))
      return pending
    }
    if (text.trim()) {
      try {
        const data = JSON.parse(text)
        if (data?.id === id) this.resolveMessage(data)
      } catch { /* SSE servers commonly return empty/accepted responses */ }
    }
    return pending
  }

  stop(): void {
    this.stopped = true
    this.controller?.abort()
  }

  private pendingPromise(id: number, method: string): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request timed out: ${method}`))
      }, timeoutMs(this.server))
      this.pending.set(id, { resolve, reject, timer })
    })
  }

  private async openStream(): Promise<void> {
    if (!this.server.url) throw new Error('SSE MCP server url is required.')
    this.controller = new AbortController()
    const response = await fetch(this.server.url, {
      method: 'GET',
      signal: this.controller.signal,
      headers: { ...resolveHeaders(this.server), Accept: 'text/event-stream' },
    })
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '')
      throw new Error(summarizeHttpError(response.status, detail))
    }
    this.pump(response).catch(error => {
      if (this.stopped) return
      this.log += `\nsse stream failed: ${error instanceof Error ? error.message : String(error)}`
      void this.reconnect()
    })
  }

  private async pump(response: Response): Promise<void> {
    const reader = response.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parsed = parseSseChunk(buffer)
      buffer = parsed.rest
      for (const chunk of parsed.events) {
        const data = sseData(chunk)
        if (!data || data === '[DONE]') continue
        try { this.resolveMessage(JSON.parse(data)) } catch { /* ignore malformed event */ }
      }
    }
    if (!this.stopped) throw new Error('SSE stream closed')
  }

  private async reconnect(): Promise<void> {
    const policy = this.server.reconnect || { maxAttempts: 0, backoffMs: 0 }
    if (this.reconnectAttempts >= policy.maxAttempts) return
    this.reconnectAttempts += 1
    await new Promise(resolve => setTimeout(resolve, policy.backoffMs))
    if (!this.stopped) await this.openStream().catch(error => {
      this.log += `\nsse reconnect failed: ${error instanceof Error ? error.message : String(error)}`
    })
  }

  private resolveMessage(message: unknown): void {
    const response = message as { id?: number; error?: { message?: string }; result?: unknown }
    if (typeof response.id !== 'number') return
    const pending = this.pending.get(response.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(response.id)
    if (response.error) pending.reject(responseError(response))
    else pending.resolve(response.result)
  }

  private rejectPending(id: number, error: Error): void {
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(id)
    pending.reject(error)
  }
}

function createClient(server: McpServerConfig, cwd?: string): McpTransportClient {
  if (server.transport === 'http') return new HttpMcpClient(server)
  if (server.transport === 'sse') return new SseMcpClient(server)
  return new StdioMcpClient(server, cwd)
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

  const cwd = resolvePluginCommandCwd(plugin, server, input.workspace)
  const client = createClient(server, cwd)
  const state: McpServerState = {
    id: input.sessionId,
    pluginId: plugin.id,
    serverId: server.id,
    transport: server.transport,
    status: 'starting',
    startedAt: now(),
    updatedAt: now(),
    tools: [],
  }
  const record: McpRecord = { plugin, server, state, client }
  records.set(key(plugin.id, server.id), record)

  try {
    await client.start()
    record.state = { ...record.state, status: 'running', pid: client.pid, updatedAt: now() }
    await client.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'RilleCode', version: '0.1.0' } })
    const listed = await client.request('tools/list') as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean; sideEffect?: string } }> }
    record.state = { ...record.state, tools: (listed.tools || []).map(tool => descriptor(plugin, server, tool)), updatedAt: now() }
  } catch (error) {
    client.stop()
    const artifact = createArtifact({
      sessionId: record.state.id,
      kind: 'command_output',
      content: client.output() || (error instanceof Error ? error.message : String(error)),
      mimeType: 'text/plain; charset=utf-8',
    })
    record.state = { ...record.state, status: 'failed', lastError: `${error instanceof Error ? error.message : String(error)}; output ${artifact.id}`, updatedAt: now() }
  }
  return record.state
}

export function stopMcpServer(pluginId: string, serverId: string): McpServerState | null {
  const record = records.get(key(pluginId, serverId))
  if (!record) return null
  record.state = { ...record.state, status: 'stopped', updatedAt: now() }
  record.client.stop()
  return record.state
}

export async function callMcpTool(namespace: string, args: Record<string, unknown>): Promise<ToolResultView> {
  const tool = listMcpTools().find(item => item.namespace === namespace)
  if (!tool) return { output: `MCP tool not found: ${namespace}`, status: 'error', error: 'unknown_tool' }
  const record = records.get(key(tool.pluginId, tool.serverId))
  if (!record) return { output: `MCP server not running: ${tool.pluginId}/${tool.serverId}`, status: 'error', error: 'environment_missing' }
  const result = await record.client.request('tools/call', { name: tool.name, arguments: args }).catch(error => ({ error: error instanceof Error ? error.message : String(error) }))
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
