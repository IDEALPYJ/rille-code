import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callMcpTool, registerMcpToolDescriptors, startMcpServer, stopMcpServer } from '../../src/main/agent/mcpManager'
import { decidePermission } from '../../src/main/agent/permissions'
import type { AgentWorkspaceLocation } from '../../src/shared/agent/protocol'

let root = ''
let userData = ''
let httpServer: Server | null = null

function workspace(): AgentWorkspaceLocation {
  return { kind: 'local', path: root, label: 'tmp' }
}

function writeFakeMcpServer(filePath: string, failInitialize = false): void {
  writeFileSync(filePath, `
let buffer = Buffer.alloc(0)
function send(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  process.stdout.write('Content-Length: ' + body.length + '\\r\\n\\r\\n')
  process.stdout.write(body)
}
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const raw = buffer.toString('utf8')
    const headerEnd = raw.indexOf('\\r\\n\\r\\n')
    if (headerEnd < 0) return
    const match = /Content-Length:\\s*(\\d+)/i.exec(raw.slice(0, headerEnd))
    if (!match) return
    const length = Number(match[1])
    const bodyStart = headerEnd + 4
    const available = Buffer.byteLength(raw.slice(bodyStart), 'utf8')
    if (available < length) return
    const body = raw.slice(bodyStart, bodyStart + length)
    buffer = Buffer.from(raw.slice(bodyStart + length), 'utf8')
    const request = JSON.parse(body)
    if (request.method === 'initialize') {
      ${failInitialize ? "send({ jsonrpc: '2.0', id: request.id, error: { message: 'boom' } })" : "send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2024-11-05', capabilities: {} } })"}
    } else if (request.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: request.id, result: { tools: [
        { name: 'echo', description: 'Echo args', inputSchema: { type: 'object', additionalProperties: true }, annotations: { readOnlyHint: true } },
        { name: 'erase', description: 'Side-effect tool', inputSchema: { type: 'object', additionalProperties: true }, annotations: { sideEffect: 'external' } }
      ] } })
    } else if (request.method === 'tools/call') {
      send({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(request.params.arguments) }] } })
    }
  }
})
`, 'utf8')
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('server did not listen on tcp')
  return `http://127.0.0.1:${address.port}`
}

function sendJson(res: ServerResponse, id: number, result: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
}

async function readBody(req: NodeJS.ReadableStream): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function createHttpMcpServer(): Promise<string> {
  httpServer = createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404)
      res.end()
      return
    }
    const request = await readBody(req)
    if (request.method === 'initialize') sendJson(res, request.id, { protocolVersion: '2024-11-05', capabilities: {} })
    else if (request.method === 'tools/list') sendJson(res, request.id, { tools: [{ name: 'echo', description: 'HTTP echo', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] })
    else if (request.method === 'tools/call') sendJson(res, request.id, { content: [{ type: 'text', text: JSON.stringify(request.params.arguments) }] })
    else sendJson(res, request.id, {})
  })
  return listen(httpServer)
}

async function createSseMcpServer(): Promise<string> {
  let stream: ServerResponse | null = null
  httpServer = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/sse') {
      stream = res
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(': ready\n\n')
      return
    }
    if (req.method !== 'POST' || req.url !== '/message') {
      res.writeHead(404)
      res.end()
      return
    }
    const request = await readBody(req)
    let result: unknown = {}
    if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: {} }
    if (request.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'SSE echo', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] }
    if (request.method === 'tools/call') result = { content: [{ type: 'text', text: JSON.stringify(request.params.arguments) }] }
    stream?.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n\n`)
    res.writeHead(202, { 'Content-Type': 'application/json' })
    res.end('{}')
  })
  return listen(httpServer)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rille-mcp-project-'))
  userData = mkdtempSync(join(tmpdir(), 'rille-mcp-user-'))
  process.env.RILLE_AGENT_EXTENSION_USER_DATA = userData
})

afterEach(async () => {
  delete process.env.RILLE_AGENT_EXTENSION_USER_DATA
  stopMcpServer('fixture', 'stdio')
  stopMcpServer('fixture', 'http')
  stopMcpServer('fixture', 'sse')
  stopMcpServer('broken', 'stdio')
  if (httpServer) await new Promise(resolve => httpServer?.close(resolve))
  httpServer = null
  // Allow child processes time to release file handles before cleanup
  await new Promise(resolve => setTimeout(resolve, 200))
  await rm(root, { recursive: true, force: true }).catch(() => {})
  await rm(userData, { recursive: true, force: true }).catch(() => {})
})

describe('MCP stdio lifecycle', () => {
  it('starts a real stdio server, discovers tools, calls tools, and stops', async () => {
    const serverPath = join(root, 'fake-mcp.js')
    writeFakeMcpServer(serverPath)
    mkdirSync(join(root, '.rille/plugins'), { recursive: true })
    writeFileSync(join(root, '.rille/plugins/fixture.json'), JSON.stringify({
      id: 'fixture',
      name: 'Fixture',
      version: '1.0.0',
      description: 'fixture mcp',
      mcpServers: [{ id: 'stdio', name: 'stdio', command: `node ${serverPath}`, sideEffect: 'none' }],
      enabled: true,
    }), 'utf8')

    const configured = registerMcpToolDescriptors(workspace())
    expect(configured.map(tool => tool.namespace)).toContain('mcp.fixture.stdio.*')

    const state = await startMcpServer({ sessionId: 'session_o_mcp', pluginId: 'fixture', serverId: 'stdio', workspace: workspace() })
    expect(state.status).toBe('running')
    expect(state.tools[0]).toMatchObject({ namespace: 'mcp.fixture.stdio.echo', readOnly: true, sideEffect: 'none' })

    const result = await callMcpTool('mcp.fixture.stdio.echo', { value: 42 })
    expect(result.status).toBe('ok')
    expect(result.output).toContain('42')

    const readOnlyDecision = await decidePermission({
      call: { id: 'tool_mcp_read', name: 'mcp.fixture.stdio.echo', input: { value: 1 } },
      mode: 'default',
      sessionId: 'session_o_mcp',
      turnId: 'turn_o_mcp',
      context: { workspace: workspace(), activeFile: null, openFiles: [], diagnostics: [] },
    })
    const externalDecision = await decidePermission({
      call: { id: 'tool_mcp_external', name: 'mcp.fixture.stdio.erase', input: { value: 1 } },
      mode: 'default',
      sessionId: 'session_o_mcp',
      turnId: 'turn_o_mcp',
      context: { workspace: workspace(), activeFile: null, openFiles: [], diagnostics: [] },
    })
    expect(readOnlyDecision.action).toBe('allow')
    expect(externalDecision.action).toBe('ask')

    const stopped = stopMcpServer('fixture', 'stdio')
    expect(stopped?.status).toBe('stopped')
  })

  it('records server startup failure without throwing away state', async () => {
    const serverPath = join(root, 'broken-mcp.js')
    writeFakeMcpServer(serverPath, true)
    mkdirSync(join(root, '.rille/plugins'), { recursive: true })
    writeFileSync(join(root, '.rille/plugins/broken.json'), JSON.stringify({
      id: 'broken',
      name: 'Broken',
      version: '1.0.0',
      description: 'broken mcp',
      mcpServers: [{ id: 'stdio', name: 'stdio', command: `node ${serverPath}` }],
      enabled: true,
    }), 'utf8')

    const state = await startMcpServer({ sessionId: 'session_o_mcp_fail', pluginId: 'broken', serverId: 'stdio', workspace: workspace() })

    expect(state.status).toBe('failed')
    expect(state.lastError).toContain('boom')
  })

  it('connects to a remote HTTP MCP server, discovers tools, and calls tools', async () => {
    const endpoint = await createHttpMcpServer()
    mkdirSync(join(root, '.rille/plugins'), { recursive: true })
    writeFileSync(join(root, '.rille/plugins/fixture.json'), JSON.stringify({
      id: 'fixture',
      name: 'Fixture',
      version: '1.0.0',
      description: 'fixture mcp',
      mcpServers: [{ id: 'http', name: 'http', transport: 'http', url: endpoint, sideEffect: 'none' }],
      enabled: true,
    }), 'utf8')

    const state = await startMcpServer({ sessionId: 'session_o_mcp_http', pluginId: 'fixture', serverId: 'http', workspace: workspace() })

    expect(state).toMatchObject({ status: 'running', transport: 'http' })
    expect(state.tools[0]).toMatchObject({ namespace: 'mcp.fixture.http.echo', readOnly: true })
    const result = await callMcpTool('mcp.fixture.http.echo', { value: 42 })
    expect(result.status).toBe('ok')
    expect(result.output).toContain('42')
  })

  it('connects to a remote SSE MCP server and resolves responses from the event stream', async () => {
    const endpoint = await createSseMcpServer()
    mkdirSync(join(root, '.rille/plugins'), { recursive: true })
    writeFileSync(join(root, '.rille/plugins/fixture.json'), JSON.stringify({
      id: 'fixture',
      name: 'Fixture',
      version: '1.0.0',
      description: 'fixture mcp',
      mcpServers: [{ id: 'sse', name: 'sse', transport: 'sse', url: `${endpoint}/sse`, messageUrl: `${endpoint}/message`, sideEffect: 'none' }],
      enabled: true,
    }), 'utf8')

    const state = await startMcpServer({ sessionId: 'session_o_mcp_sse', pluginId: 'fixture', serverId: 'sse', workspace: workspace() })

    expect(state).toMatchObject({ status: 'running', transport: 'sse' })
    expect(state.tools[0]).toMatchObject({ namespace: 'mcp.fixture.sse.echo', readOnly: true })
    const result = await callMcpTool('mcp.fixture.sse.echo', { value: 'streamed' })
    expect(result.status).toBe('ok')
    expect(result.output).toContain('streamed')
  })
})
