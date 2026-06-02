import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentContextSnapshot, AgentPlanItem, AgentSession, AgentTurn, TaskContract } from '../../src/shared/agent/protocol'
import { executeToolCall, getModelVisibleToolDefinitions, getToolDefinitions, toolRegistry } from '../../src/main/agent/tools'
import { createInitialTaskContract } from '../../src/main/agent/taskContract'

let root = ''
let extensionUserData = ''

function session(): AgentSession {
  return {
    id: 'session_test',
    workspace: { kind: 'local', path: '/repo', label: 'repo' },
    title: 'test',
    createdAt: 1,
    updatedAt: 1,
    status: 'idle',
    permissionMode: 'default',
  }
}

function turn(): AgentTurn {
  return {
    id: 'turn_test',
    sessionId: 'session_test',
    text: '修复当前类型错误',
    createdAt: 1,
    status: 'running',
  }
}

function context(): AgentContextSnapshot {
  return {
    workspace: { kind: 'local', path: '/repo', label: 'repo' },
    activeFile: null,
    openFiles: [],
    diagnostics: [],
  }
}

function localSession(workspacePath: string): AgentSession {
  return {
    ...session(),
    workspace: { kind: 'local', path: workspacePath, label: 'tmp' },
  }
}

function localContext(workspacePath: string, filePath: string, content: string): AgentContextSnapshot {
  return {
    workspace: { kind: 'local', path: workspacePath, label: 'tmp' },
    activeFile: { path: filePath, name: filePath.split(/[/\\]/).pop() || filePath, isDirty: true, content },
    openFiles: [{ path: filePath, name: filePath.split(/[/\\]/).pop() || filePath, isDirty: true }],
    diagnostics: [],
  }
}

afterEach(async () => {
  delete process.env.RILLE_AGENT_EXTENSION_USER_DATA
  if (root) await rm(root, { recursive: true, force: true }).catch(() => {})
  if (extensionUserData) await rm(extensionUserData, { recursive: true, force: true }).catch(() => {})
  root = ''
  extensionUserData = ''
})

describe('update_plan tool', () => {
  it('exposes Phase F tool metadata and validators', () => {
    for (const tool of toolRegistry) {
      expect(tool.visibility).toMatch(/^(model|runtime|ui)$/)
      expect(tool.sideEffect).toMatch(/^(none|workspace_read|workspace_write|process|network|external)$/)
      expect(typeof tool.validate).toBe('function')
    }
    const definitions = getToolDefinitions()
    expect(definitions.every(tool => tool.visibility && tool.sideEffect)).toBe(true)
    expect(getModelVisibleToolDefinitions().some(tool => tool.name === 'apply_file_edit')).toBe(false)
    expect(getModelVisibleToolDefinitions().some(tool => tool.name === 'ask_user')).toBe(true)
    expect(getModelVisibleToolDefinitions().some(tool => tool.name === 'select_files')).toBe(false)
    expect(getModelVisibleToolDefinitions().some(tool => tool.name === 'search_tools')).toBe(true)
  })

  it('discovers deferred tools without adding them to the stable tool prefix', async () => {
    expect(getToolDefinitions().some(tool => tool.name === 'inspect_runtime_state' && tool.deferred)).toBe(true)
    expect(getModelVisibleToolDefinitions().some(tool => tool.name === 'inspect_runtime_state')).toBe(false)
    const result = await executeToolCall(
      { id: 'tool_search', name: 'search_tools', input: { query: 'runtime state' } },
      {
        session: session(),
        turn: turn(),
        context: context(),
        emitProposal: vi.fn(),
      },
    )
    expect(result.status).toBe('ok')
    expect(result.output).toContain('inspect_runtime_state')
  })

  it('discovers skills through search_tools/search_skills while keeping activation deferred', async () => {
    root = mkdtempSync(join(tmpdir(), 'rille-tools-skill-'))
    extensionUserData = mkdtempSync(join(tmpdir(), 'rille-tools-user-'))
    process.env.RILLE_AGENT_EXTENSION_USER_DATA = extensionUserData
    mkdirSync(join(root, '.rille/skills'), { recursive: true })
    writeFileSync(join(root, '.rille/skills/review.json'), JSON.stringify({
      id: 'review',
      name: 'Review Skill',
      description: 'Review helper',
      activationKeywords: ['review'],
      content: 'Review only after evidence is collected.',
    }), 'utf8')
    const runtimeContext = { ...context(), workspace: { kind: 'local' as const, path: root, label: 'tmp' } }

    const tools = await executeToolCall(
      { id: 'tool_search', name: 'search_tools', input: { query: 'review' } },
      { session: localSession(root), turn: turn(), context: runtimeContext, emitProposal: vi.fn() },
    )
    const skills = await executeToolCall(
      { id: 'skill_search', name: 'search_skills', input: { query: 'review' } },
      { session: localSession(root), turn: turn(), context: runtimeContext, emitProposal: vi.fn() },
    )

    expect(getToolDefinitions().some(tool => tool.name === 'activate_skill' && tool.deferred)).toBe(true)
    expect(getModelVisibleToolDefinitions().some(tool => tool.name === 'activate_skill')).toBe(false)
    expect(tools.output).toContain('Review Skill')
    expect(skills.output).toContain('review')
  })

  it('rejects invalid input before tool execution', async () => {
    const result = await executeToolCall(
      { id: 'tool_read_invalid', name: 'read_file', input: { filePath: 42 } },
      {
        session: session(),
        turn: turn(),
        context: context(),
        emitProposal: vi.fn(),
      },
    )

    expect(result.status).toBe('error')
    expect(result.error).toBe('invalid_input')
    expect(result.failureType).toBe('invalid_input')
  })

  it('is model-visible and updates runtime plan state', async () => {
    expect(getModelVisibleToolDefinitions().some(tool => tool.name === 'update_plan')).toBe(true)
    const currentItems: AgentPlanItem[] = [
      { id: 'plan_explore', title: '探索上下文', status: 'in_progress', source: 'runtime', updatedAt: 1 },
      { id: 'plan_verify', title: '验证结果', status: 'pending', source: 'runtime', updatedAt: 1 },
    ]
    const updatePlan = vi.fn((items: AgentPlanItem[]) => items)

    const result = await executeToolCall(
      {
        id: 'tool_plan',
        name: 'update_plan',
        input: {
          reason: '完成探索',
          items: [{ id: 'plan_explore', title: '探索上下文', status: 'completed', evidence: 'read_file' }],
        },
      },
      {
        session: session(),
        turn: turn(),
        context: context(),
        planItems: currentItems,
        emitProposal: vi.fn(),
        updatePlan,
      },
    )

    expect(result.status).toBe('ok')
    expect(updatePlan).toHaveBeenCalledOnce()
    const nextItems = updatePlan.mock.calls[0][0]
    expect(nextItems).toHaveLength(2)
    expect(nextItems[0]).toMatchObject({ id: 'plan_explore', status: 'completed', evidence: 'read_file' })
  })

  it('returns an error when runtime does not expose plan updates', async () => {
    const result = await executeToolCall(
      {
        id: 'tool_plan',
        name: 'update_plan',
        input: { items: [{ title: '探索上下文', status: 'completed' }] },
      },
      {
        session: session(),
        turn: turn(),
        context: context(),
        emitProposal: vi.fn(),
      },
    )

    expect(result.status).toBe('error')
    expect(result.error).toBe('plan_update_unavailable')
  })
})

describe('update_task_contract tool', () => {
  it('is model-visible and updates the current task contract', async () => {
    expect(getModelVisibleToolDefinitions().some(tool => tool.name === 'update_task_contract')).toBe(true)
    const runtimeSession = session()
    const runtimeTurn = turn()
    const contract = createInitialTaskContract({ session: runtimeSession, turn: runtimeTurn, text: runtimeTurn.text, context: context(), timestamp: 1 })
    const updateTaskContract = vi.fn((next: TaskContract) => next)

    const result = await executeToolCall(
      {
        id: 'tool_contract',
        name: 'update_task_contract',
        input: {
          reason: '收窄任务目标',
          contract: {
            goal: '只修复当前类型错误',
            acceptanceCriteria: [{ id: 'ac_goal', text: '类型错误消失', status: 'covered', evidenceRequired: ['diagnostics'] }],
            unsupported: 'ignored',
          },
        },
      },
      {
        session: runtimeSession,
        turn: runtimeTurn,
        context: context(),
        taskContract: contract,
        emitProposal: vi.fn(),
        updateTaskContract,
      },
    )

    expect(result.status).toBe('ok')
    expect(updateTaskContract).toHaveBeenCalledOnce()
    const next = updateTaskContract.mock.calls[0][0]
    expect(next.goal).toBe('只修复当前类型错误')
    expect(next.acceptanceCriteria[0]).toMatchObject({ id: 'ac_goal', status: 'covered' })
    expect(next.status).toBe('updated')
  })

  it('rejects unavailable or empty task contract updates', async () => {
    const runtimeSession = session()
    const runtimeTurn = turn()
    const contract = createInitialTaskContract({ session: runtimeSession, turn: runtimeTurn, text: runtimeTurn.text, context: context(), timestamp: 1 })

    const unavailable = await executeToolCall(
      {
        id: 'tool_contract_unavailable',
        name: 'update_task_contract',
        input: { contract: { goal: 'new goal' } },
      },
      {
        session: runtimeSession,
        turn: runtimeTurn,
        context: context(),
        taskContract: contract,
        emitProposal: vi.fn(),
      },
    )
    expect(unavailable.status).toBe('error')
    expect(unavailable.error).toBe('task_contract_update_unavailable')

    const invalid = await executeToolCall(
      {
        id: 'tool_contract_invalid',
        name: 'update_task_contract',
        input: { contract: { ignored: true } },
      },
      {
        session: runtimeSession,
        turn: runtimeTurn,
        context: context(),
        taskContract: contract,
        emitProposal: vi.fn(),
        updateTaskContract: vi.fn(next => next),
      },
    )
    expect(invalid.status).toBe('error')
    expect(invalid.error).toBe('tool_failed')
  })
})

describe('dirty buffer path matching', () => {
  it('read_file uses the dirty active buffer when relative and absolute paths match canonically', async () => {
    root = mkdtempSync(join(tmpdir(), 'rille-tools-'))
    mkdirSync(join(root, 'src'))
    const filePath = join(root, 'src/main.ts')
    writeFileSync(filePath, 'disk-content', 'utf8')

    const result = await executeToolCall(
      { id: 'tool_read', name: 'read_file', input: { filePath: 'src/main.ts' } },
      {
        session: localSession(root),
        turn: turn(),
        context: localContext(root, filePath, 'dirty-buffer-content'),
        emitProposal: vi.fn(),
      },
    )

    expect(result.status).toBe('ok')
    expect(result.output).toBe('dirty-buffer-content')
    expect(result.output).not.toBe('disk-content')
  })

  it('propose_file_edit uses the dirty active buffer as originalContent', async () => {
    root = mkdtempSync(join(tmpdir(), 'rille-tools-'))
    mkdirSync(join(root, 'src'))
    const filePath = join(root, 'src/main.ts')
    writeFileSync(filePath, 'disk-content', 'utf8')
    const emitProposal = vi.fn()

    const result = await executeToolCall(
      { id: 'tool_edit', name: 'propose_file_edit', input: { filePath: 'src/main.ts', modifiedContent: 'next-content' } },
      {
        session: localSession(root),
        turn: turn(),
        context: localContext(root, filePath, 'dirty-buffer-content'),
        emitProposal,
      },
    )

    expect(result.status).toBe('ok')
    expect(emitProposal).toHaveBeenCalledOnce()
    expect(emitProposal.mock.calls[0][0]).toMatchObject({
      filePath,
      originalContent: 'dirty-buffer-content',
      modifiedContent: 'next-content',
    })
  })
})
