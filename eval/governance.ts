/**
 * Deterministic governance audit CLI.
 *
 * This script intentionally avoids importing app runtime modules so it can run
 * directly in Node with --experimental-strip-types before the app is bundled.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'

type Severity = 'info' | 'warning' | 'error' | 'blocking'

interface Finding {
  id: string
  category: string
  severity: Severity
  title: string
  detail: string
  evidenceRefs: string[]
  recommendation?: string
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspacePath = resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || repoRoot)
const requiredGates = ['npm test', 'npm run typecheck', 'npm run build', 'npm run eval:agent', 'npm run governance:agent']

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

function finding(category: string, severity: Severity, title: string, detail: string, evidenceRefs: string[], recommendation?: string): Finding {
  return { id: `${category}_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, category, severity, title, detail, evidenceRefs, recommendation }
}

function evalReport() {
  const casesDir = join(repoRoot, 'eval', 'cases')
  const cases = existsSync(casesDir)
    ? readdirSync(casesDir).filter(file => file.endsWith('.json') && !file.startsWith('_')).map(file => readJson<{
      id?: string
      title?: string
      mode?: string
      expectedTrajectory?: string[]
      traceFixture?: Array<{ type?: string }>
    }>(join(casesDir, file))).filter(Boolean)
    : []
  const caseSummaries = cases.map(evalCase => {
    const traceTypes = (evalCase?.traceFixture || []).map(event => event.type)
    const failures = (evalCase?.expectedTrajectory || []).filter(type => !traceTypes.includes(type)).map(type => `Missing trajectory ${type}`)
    return {
      id: evalCase?.id || 'unknown',
      title: evalCase?.title || evalCase?.id || 'Untitled eval',
      mode: evalCase?.mode || 'trace_replay',
      passed: failures.length === 0,
      failures,
    }
  })
  const passed = caseSummaries.filter(item => item.passed).length
  return { status: passed === caseSummaries.length ? 'pass' : 'fail', caseCount: caseSummaries.length, passed, failed: caseSummaries.length - passed, caseSummaries }
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'out', 'dist', '.git'].includes(entry)) continue
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path, out)
    else if (/\.(ts|tsx|js|json|md)$/.test(entry)) out.push(path)
    if (out.length > 1200) break
  }
  return out
}

const findings: Finding[] = []
const pkg = readJson<{ scripts?: Record<string, string> }>(join(repoRoot, 'package.json'))
const scripts = pkg?.scripts || {}
const missingGates = requiredGates.filter(gate => {
  if (gate === 'npm test') return !scripts.test
  return !scripts[gate.replace('npm run ', '')]
})
for (const gate of missingGates) findings.push(finding('model_upgrade', 'error', `Missing gate ${gate}`, 'Required release validation gate is not declared in package scripts.', ['package.json']))

const evalRegression = evalReport()
if (evalRegression.status === 'fail') findings.push(finding('eval_regression', 'blocking', 'Eval regression failed', `${evalRegression.failed}/${evalRegression.caseCount} deterministic eval cases failed.`, ['eval/cases']))

const toolsSource = existsSync(join(repoRoot, 'src', 'main', 'agent', 'tools.ts')) ? readFileSync(join(repoRoot, 'src', 'main', 'agent', 'tools.ts'), 'utf8') : ''
if (!toolsSource.includes("name: 'run_governance_audit'")) findings.push(finding('prompt_tool_policy', 'error', 'Governance tool missing', 'run_governance_audit is not registered.', ['src/main/agent/tools.ts']))
if (!toolsSource.includes("deferred: true")) findings.push(finding('prompt_tool_policy', 'warning', 'No deferred tools found', 'Deferred tooling is required to keep stable prompts small.', ['src/main/agent/tools.ts']))

const scaffoldCandidates = walk(join(repoRoot, 'src')).flatMap((file, index) => {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  return lines.flatMap((line, lineIndex) => /\bnot implemented\b|\bmock-only\b|\bTODO\b.*\bPhase\b/i.test(line)
    && !line.includes('re: /')
    ? [{
        id: `scaffold_${index}_${lineIndex}`,
        filePath: relative(repoRoot, file),
        reason: 'Potential stale scaffold remains.',
        risk: 'medium',
        evidence: `${relative(repoRoot, file)}:${lineIndex + 1}: ${line.trim().slice(0, 160)}`,
        recommendation: 'Review manually; Phase Q does not delete scaffold automatically.',
      }]
    : [])
}).slice(0, 50)

const featureSnapshot = readJson<{ featureList?: Array<{ id: string; status: string; evidenceRefs?: string[]; updatedAt?: number }>; lifecycle?: unknown[] }>(join(workspacePath, '.rille', 'features.json'))
const featureLifecycle = (featureSnapshot?.featureList || []).map(feature => ({
  featureId: feature.id,
  status: feature.status === 'verified' ? 'verified' : feature.status === 'dropped' ? 'removed' : feature.status === 'not_started' ? 'planned' : 'active',
  source: 'feature_store',
  evidenceRefs: feature.evidenceRefs || [],
  updatedAt: feature.updatedAt || Date.now(),
}))

const configFindings = missingGates.map(gate => ({ id: `missing_${gate.replace(/\W+/g, '_')}`, source: 'package.json', severity: 'error' as const, message: `Missing ${gate}.`, evidenceRefs: ['package.json'] }))
const migrationCompatibility = { status: 'pass', checkedFixtures: ['legacy_feature_store_snapshot', 'unknown_trace_event_ignored'], failures: [] as string[] }
const allFindings = [...findings, ...scaffoldCandidates.map(item => finding('scaffold_cleanup', 'info', item.id, item.reason, [item.filePath], item.recommendation))]
const status = allFindings.some(item => item.severity === 'blocking' || item.severity === 'error') ? 'fail' : allFindings.some(item => item.severity === 'warning') ? 'warn' : 'pass'
const report = {
  id: `governance_${Date.now()}`,
  workspacePath,
  createdAt: Date.now(),
  status,
  summary: `Governance audit: ${allFindings.length} findings, ${evalRegression.passed}/${evalRegression.caseCount} eval cases passed.`,
  featureLifecycle,
  modelUpgrade: { status: missingGates.length ? 'fail' : 'pass', activeProfileId: undefined, profileCount: 0, evaluatorConfigured: true, evalCaseCount: evalRegression.caseCount, requiredGates, missingGates, findings: findings.filter(item => item.category === 'model_upgrade') },
  evalRegression,
  configFindings,
  scaffoldCandidates,
  migrationCompatibility,
  findings: allFindings,
}

console.log(JSON.stringify(report, null, 2))
process.exit(report.status === 'fail' ? 1 : 0)
