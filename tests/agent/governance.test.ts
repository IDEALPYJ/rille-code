import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { AgentContextSnapshot, AgentSession, AgentTurn } from '../../src/shared/agent/protocol'
import { FeatureStore } from '../../src/main/agent/featureStore'
import { runGovernanceAudit } from '../../src/main/agent/governance'
import { executeToolCall, getToolDefinitions, getModelVisibleToolDefinitions } from '../../src/main/agent/tools'

const tempDirs: string[] = []

afterAll(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'rille-governance-'))
  tempDirs.push(root)
  mkdirSync(join(root, 'eval', 'cases'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    scripts: {
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
      build: 'vite build',
      'eval:agent': 'node eval/runner.ts',
      'governance:agent': 'node eval/governance.ts',
    },
  }), 'utf8')
  writeFileSync(join(root, 'eval', 'cases', 'happy.json'), JSON.stringify({
    id: 'happy',
    title: 'Happy governance eval',
    mode: 'trace_replay',
    expectedTrajectory: ['task.created'],
    expectedEvidence: [],
    safetyExpectations: [],
    traceFixture: [{ type: 'task.created', sessionId: 's', turnId: 't', contractId: 'c', summary: 'x', createdAt: 1 }],
  }), 'utf8')
  writeFileSync(join(root, 'src', 'index.ts'), 'export const ready = true\n', 'utf8')
  return root
}

function session(workspacePath: string): AgentSession {
  return {
    id: 'session_governance',
    workspace: { kind: 'local', path: workspacePath, label: 'tmp' },
    title: 'test',
    createdAt: 1,
    updatedAt: 1,
    status: 'idle',
    permissionMode: 'default',
  }
}

function turn(): AgentTurn {
  return { id: 'turn_governance', sessionId: 'session_governance', text: 'audit', createdAt: 1, status: 'running' }
}

function context(workspacePath: string): AgentContextSnapshot {
  return { workspace: { kind: 'local', path: workspacePath, label: 'tmp' }, activeFile: null, openFiles: [], diagnostics: [] }
}

describe('governance audit', () => {
  it('migrates feature lifecycle from old feature snapshots', () => {
    const root = makeRepo()
    const store = new FeatureStore(root)
    store.save({
      taskContractId: 'contract_1',
      activeFeatureId: 'feature_1',
      featureList: [{
        id: 'feature_1',
        title: 'Governance registry',
        status: 'verified',
        acceptanceCriteriaIds: ['ac_1'],
        evidenceRefs: ['evidence_1'],
        riskRefs: [],
        updatedAt: 10,
      }],
      failedAttempts: [],
      unresolvedRisks: [],
      nextSteps: [],
      updatedAt: 10,
    })

    const report = runGovernanceAudit({ repoRoot: root, workspacePath: root, tools: getToolDefinitions() })
    expect(report.featureLifecycle[0]).toMatchObject({ featureId: 'feature_1', status: 'verified', evidenceRefs: ['evidence_1'] })
    expect(report.migrationCompatibility.status).toBe('pass')
  })

  it('reports eval regression, stale config, and scaffold candidates without mutating files', () => {
    const root = makeRepo()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }), 'utf8')
    writeFileSync(join(root, 'src', 'stub.ts'), '// not implemented scaffold\n', 'utf8')

    const report = runGovernanceAudit({ repoRoot: root, workspacePath: root, tools: [] })
    expect(report.configFindings.some(item => item.id === 'missing_eval_script')).toBe(true)
    expect(report.modelUpgrade.missingGates).toContain('npm run eval:agent')
    expect(report.scaffoldCandidates[0]).toMatchObject({ filePath: expect.stringMatching(/^src[/\\]stub\.ts$/) })
    expect(report.findings.some(item => item.category === 'prompt_tool_policy')).toBe(true)
  })

  it('keeps run_governance_audit deferred and returns a report artifact', async () => {
    const root = makeRepo()
    expect(getToolDefinitions().some(tool => tool.name === 'run_governance_audit' && tool.deferred)).toBe(true)
    expect(getModelVisibleToolDefinitions().some(tool => tool.name === 'run_governance_audit')).toBe(false)

    const result = await executeToolCall(
      { id: 'tool_governance', name: 'run_governance_audit', input: {} },
      { session: session(root), turn: turn(), context: context(root), emitProposal: vi.fn() },
    )

    expect(result.status).toBe('ok')
    expect(result.structured?.report).toBeTruthy()
    expect(result.artifactRef).toMatch(/^artifact_/)
  })
})
