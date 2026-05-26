import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { callMcpTool, registerMcpToolDescriptors, startMcpServer, stopMcpServer } from '../../src/main/agent/mcpManager'
import { decidePermission } from '../../src/main/agent/permissions'
import type { AgentWorkspaceLocation } from '../../src/shared/agent/protocol'

let root = ''
let userData = ''

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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rille-mcp-project-'))
  userData = mkdtempSync(join(tmpdir(), 'rille-mcp-user-'))
  process.env.RILLE_AGENT_EXTENSION_USER_DATA = userData
})

afterEach(async () => {
  delete process.env.RILLE_AGENT_EXTENSION_USER_DATA
  stopMcpServer('fixture', 'stdio')
  stopMcpServer('broken', 'stdio')
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
      mode: 'plan',
      sessionId: 'session_o_mcp',
      turnId: 'turn_o_mcp',
      context: { workspace: workspace(), activeFile: null, openFiles: [], diagnostics: [] },
    })
    const externalDecision = await decidePermission({
      call: { id: 'tool_mcp_external', name: 'mcp.fixture.stdio.erase', input: { value: 1 } },
      mode: 'plan',
      sessionId: 'session_o_mcp',
      turnId: 'turn_o_mcp',
      context: { workspace: workspace(), activeFile: null, openFiles: [], diagnostics: [] },
    })
    expect(readOnlyDecision.action).toBe('allow')
    expect(externalDecision.action).toBe('deny')

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
})
