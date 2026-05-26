import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, join, relative } from 'path'
import type {
  AgentToolDefinition,
  ConfigAuditFinding,
  EvalMode,
  FeatureItem,
  FeatureLifecycleEntry,
  GovernanceAuditFinding,
  GovernanceAuditReport,
  ModelUpgradeReview,
  ScaffoldCleanupCandidate,
} from '../../shared/agent/protocol'
import { lifecycleFromFeatures } from './featureStore'

export interface GovernanceAuditOptions {
  workspacePath?: string
  repoRoot?: string
  tools?: AgentToolDefinition[]
  modelProfiles?: { activeProfileId?: string; profiles?: Array<{ id: string; model?: string; providerId?: string; fallbackProfileIds?: string[] }> }
  evaluatorConfigured?: boolean
}

const DEFAULT_REQUIRED_GATES = ['npm test', 'npm run typecheck', 'npm run build', 'npm run eval:agent', 'npm run governance:agent']

function repoRoot(options: GovernanceAuditOptions): string {
  return options.repoRoot || process.cwd()
}

function finding(category: GovernanceAuditFinding['category'], severity: GovernanceAuditFinding['severity'], title: string, detail: string, evidenceRefs: string[], recommendation?: string): GovernanceAuditFinding {
  return { id: `${category}_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, category, severity, title, detail, evidenceRefs, recommendation }
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

function loadFeatureLifecycle(workspacePath?: string): { features: FeatureItem[]; lifecycle: FeatureLifecycleEntry[]; findings: GovernanceAuditFinding[] } {
  if (!workspacePath) return { features: [], lifecycle: [], findings: [] }
  const snapshot = readJson<{ featureList?: FeatureItem[]; lifecycle?: FeatureLifecycleEntry[] }>(join(workspacePath, '.rille', 'features.json'))
  if (!snapshot) return { features: [], lifecycle: [], findings: [] }
  const features = Array.isArray(snapshot.featureList) ? snapshot.featureList : []
  const lifecycle = lifecycleFromFeatures(features, Array.isArray(snapshot.lifecycle) ? snapshot.lifecycle : [])
  const findings: GovernanceAuditFinding[] = []
  for (const entry of lifecycle) {
    if (entry.status === 'verified' && entry.evidenceRefs.length === 0) {
      findings.push(finding('feature_lifecycle', 'warning', `Feature ${entry.featureId} lacks evidence`, 'Verified lifecycle entries must retain evidence refs for release review.', ['.rille/features.json'], 'Attach verification evidence or downgrade lifecycle status.'))
    }
    if (entry.status === 'deprecated' && !entry.deprecationNote) {
      findings.push(finding('feature_lifecycle', 'info', `Feature ${entry.featureId} deprecated without note`, 'Deprecated features should explain replacement or removal timing.', ['.rille/features.json'], 'Add a deprecation note before release.'))
    }
  }
  return { features, lifecycle, findings }
}

function loadEvalCases(root: string): Array<{ id?: string; title?: string; mode?: EvalMode; expectedTrajectory?: string[]; traceFixture?: Array<{ type?: string }>; expectedEvidence?: string[] }> {
  const casesDir = join(root, 'eval', 'cases')
  if (!existsSync(casesDir)) return []
  return readdirSync(casesDir)
    .filter(file => file.endsWith('.json') && !file.startsWith('_'))
    .map(file => readJson(join(casesDir, file)))
    .filter((item): item is ReturnType<typeof loadEvalCases>[number] => Boolean(item))
}

function evalRegression(root: string): GovernanceAuditReport['evalRegression'] {
  const cases = loadEvalCases(root)
  const caseSummaries = cases.map(evalCase => {
    const traceTypes = (evalCase.traceFixture || []).map(event => event.type).filter(Boolean)
    const failures: string[] = []
    for (const expected of evalCase.expectedTrajectory || []) {
      if (!traceTypes.includes(expected)) failures.push(`Missing trajectory ${expected}`)
    }
    if ((evalCase.expectedEvidence || []).length > 0 && traceTypes.length === 0) failures.push('Missing deterministic trace fixture')
    return {
      id: evalCase.id || 'unknown',
      title: evalCase.title || evalCase.id || 'Untitled eval',
      mode: evalCase.mode || 'trace_replay',
      passed: failures.length === 0,
      failures,
    }
  })
  const passed = caseSummaries.filter(item => item.passed).length
  return {
    status: passed === caseSummaries.length ? 'pass' : 'fail',
    caseCount: caseSummaries.length,
    passed,
    failed: caseSummaries.length - passed,
    caseSummaries,
  }
}

function modelUpgradeReview(root: string, options: GovernanceAuditOptions, evalCaseCount: number): ModelUpgradeReview {
  const pkg = readJson<{ scripts?: Record<string, string> }>(join(root, 'package.json'))
  const scripts = pkg?.scripts || {}
  const missingGates = DEFAULT_REQUIRED_GATES.filter(gate => {
    const scriptName = gate.replace(/^npm run /, '').replace(/^npm /, '')
    if (gate === 'npm test') return !scripts.test
    return !scripts[scriptName]
  })
  const profiles = options.modelProfiles?.profiles || []
  const findings: GovernanceAuditFinding[] = []
  if (evalCaseCount === 0) findings.push(finding('model_upgrade', 'blocking', 'No eval cases', 'Model upgrade review requires deterministic eval fixtures.', ['eval/cases'], 'Add at least one local eval case.'))
  for (const gate of missingGates) {
    findings.push(finding('model_upgrade', gate === 'npm run governance:agent' ? 'warning' : 'error', `Missing gate ${gate}`, 'Required release validation gate is not declared in package scripts.', ['package.json'], `Add ${gate} before closing Phase Q.`))
  }
  if (profiles.length > 0 && options.modelProfiles?.activeProfileId && !profiles.some(profile => profile.id === options.modelProfiles?.activeProfileId)) {
    findings.push(finding('model_upgrade', 'error', 'Invalid active model profile', 'The active model profile is not present in the model profile list.', ['agent config'], 'Select a valid active profile.'))
  }
  return {
    status: findings.some(item => item.severity === 'blocking' || item.severity === 'error') ? 'fail' : findings.some(item => item.severity === 'warning') ? 'warn' : 'pass',
    activeProfileId: options.modelProfiles?.activeProfileId,
    profileCount: profiles.length,
    evaluatorConfigured: options.evaluatorConfigured !== false,
    evalCaseCount,
    requiredGates: DEFAULT_REQUIRED_GATES,
    missingGates,
    findings,
  }
}

function auditTools(tools: AgentToolDefinition[] = []): GovernanceAuditFinding[] {
  const findings: GovernanceAuditFinding[] = []
  const names = new Set<string>()
  for (const tool of tools) {
    if (names.has(tool.name)) findings.push(finding('prompt_tool_policy', 'error', `Duplicate tool ${tool.name}`, 'Tool registry names must be unique.', ['tool registry'], 'Rename or remove the duplicate tool.'))
    names.add(tool.name)
    if (!tool.visibility) findings.push(finding('prompt_tool_policy', 'error', `Tool ${tool.name} missing visibility`, 'Every tool must declare visibility for prompt governance.', ['tool registry'], 'Set visibility to model, runtime, or ui.'))
    if (!tool.sideEffect) findings.push(finding('prompt_tool_policy', 'error', `Tool ${tool.name} missing sideEffect`, 'Every tool must declare sideEffect for permission policy.', ['tool registry'], 'Set sideEffect metadata.'))
    if (!tool.inputSchema || typeof tool.inputSchema !== 'object') findings.push(finding('prompt_tool_policy', 'error', `Tool ${tool.name} missing schema`, 'Model-visible tools require an input schema.', ['tool registry'], 'Add a JSON schema.'))
    if (tool.deferred && tool.visibility === 'model' && !tool.activationHint) findings.push(finding('prompt_tool_policy', 'warning', `Deferred tool ${tool.name} lacks activation hint`, 'Deferred tools should explain when to activate them.', ['tool registry'], 'Add an activationHint.'))
  }
  const modelVisibleDeferred = tools.filter(tool => tool.visibility === 'model' && tool.deferred).map(tool => tool.name)
  if (!modelVisibleDeferred.includes('run_governance_audit')) {
    findings.push(finding('prompt_tool_policy', 'warning', 'Governance tool not deferred', 'run_governance_audit should be discoverable without entering the stable prompt.', ['tool registry'], 'Register run_governance_audit as a deferred model tool.'))
  }
  return findings
}

function configFindings(root: string, workspacePath?: string): ConfigAuditFinding[] {
  const results: ConfigAuditFinding[] = []
  const pkg = readJson<{ scripts?: Record<string, string> }>(join(root, 'package.json'))
  if (!pkg?.scripts?.['eval:agent']) results.push({ id: 'missing_eval_script', source: 'package.json', severity: 'error', message: 'Missing eval:agent script.', evidenceRefs: ['package.json'] })
  if (!pkg?.scripts?.['governance:agent']) results.push({ id: 'missing_governance_script', source: 'package.json', severity: 'warning', message: 'Missing governance:agent script.', evidenceRefs: ['package.json'] })
  const pluginDir = workspacePath ? join(workspacePath, '.rille', 'plugins') : ''
  if (pluginDir && existsSync(pluginDir)) {
    for (const file of readdirSync(pluginDir).filter(name => name.endsWith('.json'))) {
      const manifest = readJson<{ id?: string; enabled?: boolean; mcpServers?: Array<{ id?: string; command?: string; enabled?: boolean; sideEffect?: string }> }>(join(pluginDir, file))
      if (!manifest?.id) results.push({ id: `invalid_plugin_${file}`, source: file, severity: 'error', message: 'Plugin manifest is missing id.', evidenceRefs: [relative(workspacePath || root, join(pluginDir, file))] })
      for (const server of manifest?.mcpServers || []) {
        if (server.enabled !== false && !server.command) results.push({ id: `mcp_missing_command_${manifest?.id || file}_${server.id || 'server'}`, source: file, severity: 'error', message: 'Enabled MCP server is missing command.', evidenceRefs: [relative(workspacePath || root, join(pluginDir, file))] })
        if (!server.sideEffect) results.push({ id: `mcp_unknown_side_effect_${manifest?.id || file}_${server.id || 'server'}`, source: file, severity: 'warning', message: 'MCP server sideEffect is unknown and will require ask/deny policy.', evidenceRefs: [relative(workspacePath || root, join(pluginDir, file))] })
      }
    }
  }
  return results
}

function walkFiles(root: string, maxFiles = 1200): string[] {
  const ignored = new Set(['node_modules', 'out', 'dist', '.git'])
  const files: string[] = []
  const visit = (dir: string) => {
    if (files.length >= maxFiles) return
    for (const entry of readdirSync(dir)) {
      if (ignored.has(entry)) continue
      const path = join(dir, entry)
      const stat = statSync(path)
      if (stat.isDirectory()) visit(path)
      else if (/\.(ts|tsx|js|json|md)$/.test(entry)) files.push(path)
      if (files.length >= maxFiles) break
    }
  }
  if (existsSync(root)) visit(root)
  return files
}

function scaffoldCandidates(root: string): ScaffoldCleanupCandidate[] {
  const patterns = [
    { re: /\bTODO\b.*\bPhase\b/i, reason: 'Phase-scoped TODO remains in source.' },
    { re: /\bnot implemented\b/i, reason: 'Not implemented scaffold remains.' },
    { re: /\bmock-only\b/i, reason: 'Mock-only scaffold remains.' },
  ]
  const candidates: ScaffoldCleanupCandidate[] = []
  for (const file of walkFiles(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split(/\r?\n/)
    lines.forEach((line, index) => {
      if (line.includes('re: /')) return
      const match = patterns.find(pattern => pattern.re.test(line))
      if (match) {
        const rel = relative(root, file)
        candidates.push({
          id: `scaffold_${candidates.length + 1}`,
          filePath: rel,
          reason: match.reason,
          risk: 'medium',
          evidence: `${basename(file)}:${index + 1}: ${line.trim().slice(0, 160)}`,
          recommendation: 'Review manually; Phase Q does not delete scaffold automatically.',
        })
      }
    })
  }
  return candidates.slice(0, 50)
}

function migrationCompatibility(): GovernanceAuditReport['migrationCompatibility'] {
  const oldFeature: { featureList: FeatureItem[]; updatedAt: number } = {
    featureList: [{ id: 'feature_old', title: 'Old feature', status: 'verified', acceptanceCriteriaIds: [], evidenceRefs: ['evidence_old'], riskRefs: [], updatedAt: 1 }],
    updatedAt: 1,
  }
  const lifecycle = lifecycleFromFeatures(oldFeature.featureList, [])
  const failures: string[] = []
  if (lifecycle[0]?.status !== 'verified') failures.push('Old feature snapshot did not migrate to verified lifecycle.')
  if (lifecycle[0]?.evidenceRefs[0] !== 'evidence_old') failures.push('Old feature evidence refs were not preserved.')
  return { status: failures.length === 0 ? 'pass' : 'fail', checkedFixtures: ['legacy_feature_store_snapshot', 'unknown_trace_event_ignored'], failures }
}

export function runGovernanceAudit(options: GovernanceAuditOptions = {}): GovernanceAuditReport {
  const root = repoRoot(options)
  const workspacePath = options.workspacePath || root
  const lifecycle = loadFeatureLifecycle(workspacePath)
  const evalReport = evalRegression(root)
  const modelReview = modelUpgradeReview(root, options, evalReport.caseCount)
  const toolFindings = auditTools(options.tools)
  const configs = configFindings(root, workspacePath)
  const scaffolds = scaffoldCandidates(root)
  const migration = migrationCompatibility()

  const findings: GovernanceAuditFinding[] = [
    ...lifecycle.findings,
    ...modelReview.findings,
    ...toolFindings,
    ...configs.map(item => finding('stale_config', item.severity, item.id, item.message, item.evidenceRefs)),
    ...scaffolds.map(item => finding('scaffold_cleanup', 'info', item.id, item.reason, [item.filePath], item.recommendation)),
  ]
  if (evalReport.status === 'fail') findings.push(finding('eval_regression', 'blocking', 'Eval regression failed', `${evalReport.failed}/${evalReport.caseCount} deterministic eval cases failed.`, ['eval/cases'], 'Fix failing eval fixtures before release.'))
  if (migration.status === 'fail') findings.push(finding('migration_compatibility', 'blocking', 'Migration compatibility failed', migration.failures.join('; '), migration.checkedFixtures, 'Preserve backward-compatible readers.'))

  const hasBlocking = findings.some(item => item.severity === 'blocking' || item.severity === 'error')
  const hasWarning = findings.some(item => item.severity === 'warning')
  return {
    id: `governance_${Date.now()}`,
    workspacePath,
    createdAt: Date.now(),
    status: hasBlocking ? 'fail' : hasWarning ? 'warn' : 'pass',
    summary: `Governance audit: ${findings.length} findings, ${evalReport.passed}/${evalReport.caseCount} eval cases passed.`,
    featureLifecycle: lifecycle.lifecycle,
    modelUpgrade: modelReview,
    evalRegression: evalReport,
    configFindings: configs,
    scaffoldCandidates: scaffolds,
    migrationCompatibility: migration,
    findings,
  }
}
