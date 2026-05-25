import { createHash } from 'crypto'
import type {
  AgentContextSnapshot,
  AgentSession,
  AgentTurn,
  AgentWorkspaceLocation,
  ContextBuildInput,
  ContextBuildResult,
  ContextFragment,
  ContextFragmentType,
  ContextTrace,
} from '../../shared/agent/protocol'
import { workspaceGitStatus, workspaceReadDirectory, workspaceReadFile } from './workspace'
import { MemoryStore } from './memory'

const PROJECT_RULE_PREFIX_FILES = ['AGENTS.md', 'CLAUDE.md', 'RILLE.md', '.rille/rules.md'] as const
const PROJECT_RULES_DIRECTORY = '.rille/rules'
const PROJECT_RULE_SUFFIX_FILES = ['README.md', '.rille/local.md'] as const
const MAX_DOC_CHARS = 6_000
const MAX_CONTEXT_CHARS = 18_000
const MAX_GIT_STATUS_CHARS = 4_000
export const DEFAULT_CONTEXT_BUDGET_TOKENS = Math.ceil(MAX_CONTEXT_CHARS / 4)
const SECTION_ORDER: Record<ContextFragment['section'], number> = {
  stable_prefix: 0,
  dynamic_suffix: 1,
}

interface ProjectRuleDoc {
  path: string
  text: string
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function fragment(input: {
  id: string
  type: ContextFragmentType
  section: ContextFragment['section']
  priority: number
  source: string
  text: string
  trusted?: boolean
  trust?: ContextFragment['trust']
  untrusted?: boolean
  cacheEligible?: boolean
  cacheKey?: string
  stale?: boolean
}): ContextFragment {
  const trust = input.trust ?? (input.trusted === false ? 'external' : 'system')
  return {
    ...input,
    trusted: input.trusted ?? true,
    trust,
    untrusted: input.untrusted ?? !(trust === 'system' || trust === 'workspace'),
    cacheEligible: input.cacheEligible ?? input.section === 'stable_prefix',
    tokenEstimate: estimateTokens(input.text),
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function readProjectRuleFile(workspace: AgentWorkspaceLocation, filePath: string): Promise<ProjectRuleDoc | null> {
  try {
    const content = await workspaceReadFile(workspace, filePath)
    return {
      path: filePath,
      text: `# ${filePath}\n${truncate(content, MAX_DOC_CHARS)}`,
    }
  } catch {
    return null
  }
}

async function readProjectRuleDirectory(workspace: AgentWorkspaceLocation): Promise<ProjectRuleDoc[]> {
  try {
    const entries = await workspaceReadDirectory(workspace, PROJECT_RULES_DIRECTORY)
    const markdownFiles = entries
      .filter(entry => !entry.isDirectory && entry.name.toLowerCase().endsWith('.md'))
      .map(entry => `${PROJECT_RULES_DIRECTORY}/${entry.name}`)
      .sort((a, b) => a.localeCompare(b))
    const docs = await Promise.all(markdownFiles.map(filePath => readProjectRuleFile(workspace, filePath)))
    return docs.filter((item): item is ProjectRuleDoc => Boolean(item))
  } catch {
    return []
  }
}

async function readProjectRuleDocs(workspace: AgentWorkspaceLocation): Promise<ProjectRuleDoc[]> {
  const docs: ProjectRuleDoc[] = []
  for (const filePath of PROJECT_RULE_PREFIX_FILES) {
    const doc = await readProjectRuleFile(workspace, filePath)
    if (doc) docs.push(doc)
  }
  docs.push(...await readProjectRuleDirectory(workspace))
  for (const filePath of PROJECT_RULE_SUFFIX_FILES) {
    const doc = await readProjectRuleFile(workspace, filePath)
    if (doc) docs.push(doc)
  }
  return docs
}

async function readGitStatus(workspace: AgentWorkspaceLocation): Promise<string> {
  try {
    return truncate(await workspaceGitStatus(workspace), MAX_GIT_STATUS_CHARS)
  } catch (error) {
    return `Git status unavailable: ${error instanceof Error ? error.message : String(error)}`
  }
}

function collectTaskContractFragment(input: ContextBuildInput): ContextFragment | null {
  const contract = input.taskContract
  if (!contract) return null
  return fragment({
    id: `context_task_contract_${contract.id}`,
    type: 'task_contract',
    section: 'stable_prefix',
    priority: 100,
    source: contract.id,
    cacheKey: `task_contract:${contract.id}:${contract.updatedAt}`,
    trust: 'system',
    text: [
      'Task Contract:',
      JSON.stringify({
        id: contract.id,
        goal: contract.goal,
        scope: contract.scope,
        nonGoals: contract.nonGoals,
        constraints: contract.constraints,
        acceptanceCriteria: contract.acceptanceCriteria,
        verificationPlan: contract.verificationPlan,
        riskPoints: contract.riskPoints,
        assumptions: contract.assumptions,
        status: contract.status,
      }, null, 2),
    ].join('\n'),
  })
}

function collectPlanFragment(input: ContextBuildInput): ContextFragment | null {
  if (!input.planItems || input.planItems.length === 0) return null
  return fragment({
    id: `context_plan_${input.turn.id}`,
    type: 'plan',
    section: 'stable_prefix',
    priority: 90,
    source: 'agent_plan',
    cacheKey: `plan:${input.planItems.map(p => `${p.id}:${p.status}`).join(',')}`,
    text: [
      'Structured Plan:',
      JSON.stringify(input.planItems.map(item => ({
        id: item.id,
        title: item.title,
        status: item.status,
        description: item.description,
        evidence: item.evidence,
        evidenceIds: item.evidenceIds,
        acceptanceCriterionIds: item.acceptanceCriterionIds,
      })), null, 2),
    ].join('\n'),
  })
}

function collectWorkspaceFragment(context: AgentContextSnapshot): ContextFragment {
  const text = `Workspace: ${context.workspace ? `${context.workspace.label} (${context.workspace.kind}:${context.workspace.path})` : 'none'}`
  return fragment({
    id: 'context_workspace',
    type: 'workspace',
    section: 'stable_prefix',
    priority: 80,
    source: context.workspace ? `${context.workspace.kind}:${context.workspace.path}` : 'none',
    trust: 'workspace',
    text,
  })
}

function collectActiveEditorFragment(context: AgentContextSnapshot): ContextFragment {
  const text = [
    `Active file: ${context.activeFile ? `${context.activeFile.name} (${context.activeFile.path}) dirty=${context.activeFile.isDirty}` : 'none'}`,
    `Cursor: ${context.cursor ? `${context.cursor.line}:${context.cursor.column}` : 'unknown'}`,
  ].join('\n')
  return fragment({
    id: 'context_active_editor',
    type: 'active_editor',
    section: 'dynamic_suffix',
    priority: 70,
    source: context.activeFile?.path || 'none',
    trust: 'workspace',
    text,
  })
}

function collectOpenFilesFragment(context: AgentContextSnapshot): ContextFragment {
  return fragment({
    id: 'context_open_files',
    type: 'open_files',
    section: 'dynamic_suffix',
    priority: 60,
    source: 'open_files',
    trust: 'workspace',
    text: `Open files: ${context.openFiles.map(file => `${file.isDirty ? '*' : '-'}${file.path}`).join(', ') || 'none'}`,
  })
}

function collectDiagnosticsFragment(context: AgentContextSnapshot): ContextFragment {
  const lines = [
    `Diagnostics: ${context.diagnostics.length}`,
    ...(context.diagnostics.length > 0
      ? [
          'Visible diagnostics:',
          context.diagnostics
            .slice(0, 20)
            .map(item => `${item.severity} ${item.filePath}:${item.line}:${item.column} ${item.message}`)
            .join('\n'),
        ]
      : []),
  ]
  return fragment({
    id: 'context_diagnostics',
    type: 'diagnostics',
    section: 'dynamic_suffix',
    priority: 65,
    source: 'visible_diagnostics',
    trust: 'tool_output',
    text: lines.join('\n'),
  })
}

function collectSymbolsFragment(context: AgentContextSnapshot): ContextFragment | null {
  const symbols = context.symbols ?? []
  if (symbols.length === 0) return null
  return fragment({
    id: 'context_symbols',
    type: 'symbols',
    section: 'dynamic_suffix',
    priority: 64,
    source: 'ide_symbols',
    trust: 'workspace',
    text: [
      `Symbols: ${symbols.length}`,
      ...symbols.slice(0, 50).map(symbol => {
        const range = symbol.range ? `${symbol.range.startLine}:${symbol.range.startColumn}-${symbol.range.endLine}:${symbol.range.endColumn}` : 'unknown'
        return `${symbol.kind} ${symbol.name} ${symbol.filePath}:${range}${symbol.containerName ? ` in ${symbol.containerName}` : ''}`
      }),
    ].join('\n'),
  })
}

function collectSelectionsFragment(context: AgentContextSnapshot): ContextFragment | null {
  const selections = context.selections ?? []
  if (selections.length === 0) return null
  return fragment({
    id: 'context_selections',
    type: 'selection',
    section: 'dynamic_suffix',
    priority: 68,
    source: 'ide_selection',
    trust: 'user',
    text: [
      `Selections: ${selections.length}`,
      ...selections.slice(0, 5).map(selection => [
        `${selection.filePath}:${selection.range.startLine}:${selection.range.startColumn}-${selection.range.endLine}:${selection.range.endColumn}`,
        selection.text ? truncate(selection.text, 2_000) : null,
      ].filter(Boolean).join('\n')),
    ].join('\n'),
  })
}

function collectVerificationFragment(input: ContextBuildInput): ContextFragment | null {
  const evidence = input.evidence ?? []
  const coverage = input.verificationCoverage
  if (evidence.length === 0 && !coverage) return null
  return fragment({
    id: `context_verification_${input.turn.id}`,
    type: 'verification',
    section: 'dynamic_suffix',
    priority: 75,
    source: 'verification_gate',
    trust: 'tool_output',
    text: [
      'Verification summary:',
      JSON.stringify({
        evidence: evidence.slice(-8).map(item => ({
          id: item.id,
          source: item.source,
          status: item.status,
          summary: item.summary,
        })),
        coverage: coverage?.criteria.map(item => ({
          criterionId: item.criterionId,
          status: item.status,
          reason: item.reason,
          evidenceIds: item.evidenceIds,
        })),
      }, null, 2),
    ].join('\n'),
  })
}

function collectSessionSummaryFragment(input: ContextBuildInput): ContextFragment | null {
  const contract = input.taskContract
  const plan = input.planItems
  if (!contract) return null
  const completed = plan?.filter(p => p.status === 'completed').length ?? 0
  const total = plan?.length ?? 0
  const evidenceCount = input.evidence?.length ?? 0
  return fragment({
    id: 'context_session_summary',
    type: 'session_summary',
    section: 'stable_prefix',
    priority: 88,
    source: 'session_summary',
    trust: 'system',
    text: [
      'Session summary:',
      `Goal: ${contract.goal}`,
      `Progress: ${completed}/${total} plan items completed`,
      evidenceCount > 0 ? `Evidence collected: ${evidenceCount} items` : null,
      `Phase: ${input.phase}`,
    ].filter(Boolean).join('\n'),
  })
}

function collectMemoryRefsFragment(input: ContextBuildInput): ContextFragment | null {
  const workspacePath = input.contextSnapshot.workspace?.path
  if (!workspacePath || input.contextSnapshot.workspace?.kind !== 'local') return null
  const store = new MemoryStore(workspacePath)
  store.load()
  const entries = store.listActive(5)
  if (entries.length === 0) return null
  return fragment({
    id: 'context_memory_refs',
    type: 'memory_ref',
    section: 'stable_prefix',
    priority: 87,
    source: 'project_memory',
    trust: 'external',
    text: [
      'Project Memory:',
      ...entries.map(e => `[${e.kind}] ${e.text} (refs: ${e.sourceRefs.join(', ')})`),
    ].join('\n'),
  })
}

function collectHandoffFragment(input: ContextBuildInput): ContextFragment | null {
  const handoff = input.handoff
  if (!handoff) return null
  return fragment({
    id: `context_handoff_${handoff.id}`,
    type: 'handoff',
    section: 'stable_prefix',
    priority: 90,
    source: handoff.id,
    trust: 'system',
    text: [
      'Previous session handoff:',
      `Summary: ${handoff.summary}`,
      handoff.completed.length > 0 ? `Completed (verified): ${handoff.completed.join(', ')}` : null,
      handoff.implementedUnverified.length > 0 ? `Implemented (unverified): ${handoff.implementedUnverified.join(', ')}` : null,
      handoff.failedAttempts.length > 0 ? `Failed attempts: ${handoff.failedAttempts.join(', ')}` : null,
      handoff.changedFiles.length > 0 ? `Changed files: ${handoff.changedFiles.join(', ')}` : null,
      handoff.nextSteps.length > 0 ? `Next steps: ${handoff.nextSteps.join(', ')}` : null,
      handoff.unresolvedRisks.length > 0 ? `Unresolved risks: ${handoff.unresolvedRisks.join(', ')}` : null,
    ].filter(Boolean).join('\n'),
  })
}

function collectReviewFragment(input: ContextBuildInput): ContextFragment | null {
  const review = input.reviewResult
  if (!review) return null
  return fragment({
    id: `context_review_${review.id}`,
    type: 'review',
    section: 'dynamic_suffix',
    priority: 74,
    source: review.id,
    trust: 'tool_output',
    text: [
      'Review summary:',
      JSON.stringify({
        status: review.status,
        summary: review.summary,
        findings: review.findings.map(item => ({
          id: item.id,
          severity: item.severity,
          blocking: item.blocking,
          title: item.title,
          recommendation: item.recommendation,
        })),
      }, null, 2),
    ].join('\n'),
  })
}

async function collectGitFragment(context: AgentContextSnapshot): Promise<ContextFragment | null> {
  if (!context.workspace) return null
  const text = ['Git status:', await readGitStatus(context.workspace)].join('\n')
  return fragment({
    id: 'context_git',
    type: 'git',
    section: 'dynamic_suffix',
    priority: 55,
    source: `${context.workspace.kind}:${context.workspace.path}`,
    trust: 'tool_output',
    text,
  })
}

async function collectProjectRulesFragment(context: AgentContextSnapshot): Promise<ContextFragment | null> {
  if (!context.workspace) return null
  const docs = await readProjectRuleDocs(context.workspace)
  if (docs.length === 0) return null
  return fragment({
    id: 'context_project_rules',
    type: 'project_rules',
    section: 'stable_prefix',
    priority: 85,
    source: docs.map(doc => doc.path).join(','),
    cacheKey: `rules:${docs.map(d => d.path).sort().join(',')}`,
    trust: 'workspace',
    text: ['Project instructions:', docs.map(doc => doc.text).join('\n\n')].join('\n'),
  })
}

async function collectContextFragments(input: ContextBuildInput): Promise<ContextFragment[]> {
  const context = input.contextSnapshot
  const stable = [
    collectTaskContractFragment(input),
    collectPlanFragment(input),
    collectHandoffFragment(input),
    collectSessionSummaryFragment(input),
    collectMemoryRefsFragment(input),
    collectWorkspaceFragment(context),
    await collectProjectRulesFragment(context),
  ].filter((item): item is ContextFragment => Boolean(item))
  const dynamic = [
    collectActiveEditorFragment(context),
    collectSelectionsFragment(context),
    collectOpenFilesFragment(context),
    collectDiagnosticsFragment(context),
    collectSymbolsFragment(context),
    collectVerificationFragment(input),
    collectReviewFragment(input),
    await collectGitFragment(context),
  ].filter((item): item is ContextFragment => Boolean(item))
  return [...stable, ...dynamic]
}

function compareFragments(a: ContextFragment, b: ContextFragment): number {
  const sectionDelta = SECTION_ORDER[a.section] - SECTION_ORDER[b.section]
  if (sectionDelta !== 0) return sectionDelta
  const priorityDelta = b.priority - a.priority
  if (priorityDelta !== 0) return priorityDelta
  const sourceDelta = a.source.localeCompare(b.source)
  if (sourceDelta !== 0) return sourceDelta
  return a.id.localeCompare(b.id)
}

function traceItem(fragment: ContextFragment, reason: string) {
  return {
    id: fragment.id,
    type: fragment.type,
    section: fragment.section,
    source: fragment.source,
    reason,
    tokenEstimate: fragment.tokenEstimate ?? estimateTokens(fragment.text),
    cacheKey: fragment.cacheKey,
    cacheEligible: fragment.cacheEligible,
    trust: fragment.trust,
    untrusted: fragment.untrusted,
  }
}

function cacheKeyForFragments(fragments: ContextFragment[]): string {
  return sha256(fragments.map(fragment => [
    fragment.id,
    fragment.type,
    fragment.section,
    fragment.cacheKey || sha256(fragment.text),
  ].join(':')).join('\n')).slice(0, 32)
}

function selectContextFragments(candidates: ContextFragment[], budgetTokens: number): {
  included: ContextFragment[]
  trace: ContextTrace
} {
  const sortedCandidates = [...candidates].sort(compareFragments)
  const effectiveBudget = Math.max(0, budgetTokens)
  let usedTokens = 0
  const included: ContextFragment[] = []
  const excluded: ContextTrace['excluded'] = []

  for (const candidate of sortedCandidates) {
    const tokenEstimate = candidate.tokenEstimate ?? estimateTokens(candidate.text)
    const fitsBudget = usedTokens + tokenEstimate <= effectiveBudget
    if (fitsBudget || included.length === 0) {
      included.push(candidate)
      usedTokens += tokenEstimate
    } else {
      excluded.push(traceItem(candidate, 'Excluded by deterministic trimming: budget exhausted.'))
    }
  }

  return {
    included,
    trace: {
      included: included.map(fragment => traceItem(fragment, 'Included by deterministic trimming.')),
      excluded,
      totalTokenEstimate: sortedCandidates.reduce((sum, fragment) => sum + (fragment.tokenEstimate ?? estimateTokens(fragment.text)), 0),
      budgetTokens,
      stablePrefixCacheKey: cacheKeyForFragments(included.filter(fragment => fragment.section === 'stable_prefix')),
      dynamicSuffixHash: cacheKeyForFragments(included.filter(fragment => fragment.section === 'dynamic_suffix')),
      cacheEligibleTokenEstimate: included
        .filter(fragment => fragment.cacheEligible)
        .reduce((sum, fragment) => sum + (fragment.tokenEstimate ?? estimateTokens(fragment.text)), 0),
    },
  }
}

function renderContextPrompt(fragments: ContextFragment[]): string {
  return truncate(fragments.map(item => item.untrusted
    ? [
        `BEGIN_UNTRUSTED_CONTEXT source=${item.source} type=${item.type}`,
        item.text,
        'END_UNTRUSTED_CONTEXT',
      ].join('\n')
    : item.text).join('\n\n'), MAX_CONTEXT_CHARS)
}

export async function buildAgentContext(input: ContextBuildInput): Promise<ContextBuildResult> {
  const candidates = await collectContextFragments(input)
  const { included: fragments, trace } = selectContextFragments(candidates, input.budgetTokens)
  const prompt = renderContextPrompt(fragments)
  return {
    fragments,
    prompt,
    trace,
  }
}

export async function buildAgentContextPrompt(context: AgentContextSnapshot): Promise<string> {
  const session: AgentSession = {
    id: 'session_context_wrapper',
    workspace: context.workspace,
    title: 'Context wrapper',
    createdAt: 0,
    updatedAt: 0,
    status: 'running',
    permissionMode: 'ask',
  }
  const turn: AgentTurn = {
    id: 'turn_context_wrapper',
    sessionId: session.id,
    text: 'Build context prompt',
    createdAt: 0,
    status: 'running',
  }
  return (await buildAgentContext({
    phase: 'planning',
    session,
    turn,
    contextSnapshot: context,
    budgetTokens: DEFAULT_CONTEXT_BUDGET_TOKENS,
  })).prompt
}
