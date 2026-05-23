export type AgentPermissionMode = 'plan' | 'ask' | 'accept_edits' | 'auto' | 'bypass'

export type AgentProviderId =
  | 'openai'
  | 'deepseek'
  | 'anthropic'
  | 'google'
  | 'openrouter'
  | 'moonshot'
  | 'siliconflow'
  | 'mistral'
  | 'xai'
  | 'ollama'
  | 'custom'

export type AgentProviderProtocol = 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini' | 'ollama'
export type AgentModelModality = 'text' | 'image'

export interface AgentConfigSnapshot {
  profileId?: string
  name?: string
  providerId: AgentProviderId
  protocol: AgentProviderProtocol
  baseURL: string
  model: string
  apiKeyConfigured: boolean
  contextLengthTokens?: number
  modalities: AgentModelModality[]
}

export interface AgentConfigUpdate {
  profileId?: string
  name?: string
  providerId: AgentProviderId
  protocol?: AgentProviderProtocol
  baseURL?: string
  model: string
  apiKey?: string
  contextLengthTokens?: number
  modalities?: AgentModelModality[]
}

export interface AgentModelProfile extends AgentConfigSnapshot {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface AgentModelProfileUpdate {
  id?: string
  name?: string
  providerId: AgentProviderId
  protocol?: AgentProviderProtocol
  baseURL?: string
  model: string
  apiKey?: string
  contextLengthTokens?: number
  modalities?: AgentModelModality[]
  makeActive?: boolean
}

export interface AgentModelStoreSnapshot {
  activeProfileId: string
  profiles: AgentModelProfile[]
}

export interface AgentTextRange {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export interface AgentContextFile {
  path: string
  name: string
  isDirty: boolean
  content?: string
}

export interface AgentDiagnostic {
  id: string
  filePath: string
  line: number
  column: number
  message: string
  severity: 'error' | 'warning'
}

export type AgentRunStage =
  | 'building_context'
  | 'calling_model'
  | 'executing_tools'
  | 'waiting_approval'
  | 'applying_edit'
  | 'running_verification'
  | 'compacting_context'
  | 'completed'
  | 'failed'

export type VerificationStatus = 'passed' | 'failed' | 'skipped' | 'partial' | 'blocked' | 'stale' | 'waived'

export interface VerificationResult {
  id: string
  sessionId: string
  turnId: string
  verifier: 'diagnostics' | 'command'
  command?: string
  status: VerificationStatus
  output: string
  truncated?: boolean
  exitCode?: number | null
  durationMs?: number
  createdAt: number
}

export interface AgentWorkspaceLocation {
  kind: 'local' | 'ssh' | 'wsl'
  path: string
  label: string
  connectionId?: string
  targetId?: string
}

export interface AgentContextSnapshot {
  workspace: AgentWorkspaceLocation | null
  activeFile?: AgentContextFile | null
  openFiles: AgentContextFile[]
  diagnostics: AgentDiagnostic[]
  cursor?: { line: number; column: number }
}

export type ContractScopeKind = 'file' | 'module' | 'behavior' | 'ui' | 'test' | 'doc' | 'workspace' | 'unknown'
export type ContractScopeSource = 'user' | 'agent_inferred' | 'tool_observed'
export type AcceptanceEvidenceRequirement = 'diagnostics' | 'command' | 'diff' | 'review' | 'browser' | 'user'
export type AcceptanceCriterionStatus = 'unverified' | 'covered' | 'failed' | 'waived'
export type VerificationPlanKind = 'diagnostics' | 'typecheck' | 'test' | 'lint' | 'build' | 'review' | 'manual'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type TaskAssumptionStatus = 'open' | 'confirmed' | 'rejected' | 'stale'
export type TaskContractStatus = 'draft' | 'active' | 'updated' | 'completed' | 'blocked'
export type StructuredPlanStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped'
export type StructuredPlanSource = 'runtime' | 'model' | 'user'
export type ContextBuildPhase = 'planning' | 'exploration' | 'coding' | 'repair' | 'verification' | 'review' | 'resume'
export type ContextFragmentType =
  | 'system'
  | 'tool_schema'
  | 'project_rules'
  | 'task_contract'
  | 'plan'
  | 'workspace'
  | 'active_editor'
  | 'open_files'
  | 'git'
  | 'diagnostics'
  | 'tool_observation'
  | 'edit_proposal'
  | 'verification'
  | 'review'
  | 'session_summary'
  | 'memory_ref'
  | 'handoff'
export type ContextFragmentSection = 'stable_prefix' | 'dynamic_suffix'
export type ToolVisibility = 'model' | 'runtime' | 'ui'
export type ToolSideEffect = 'none' | 'workspace_read' | 'workspace_write' | 'process' | 'network' | 'external'
export type ToolFailureType =
  | 'invalid_input'
  | 'unknown_tool'
  | 'permission_denied'
  | 'path_not_found'
  | 'path_outside_workspace'
  | 'conflict'
  | 'timeout'
  | 'environment_missing'
  | 'output_too_large'
  | 'cancelled'
  | 'tool_failed'
export type PolicyPermission = 'file.read' | 'file.write' | 'command.run' | 'git.write' | 'network.access' | 'memory.write'
export type PolicyAction = 'allow' | 'ask' | 'deny'
export type GrantScope = 'once' | 'session'

export interface ToolValidationResult {
  ok: boolean
  normalizedInput?: Record<string, unknown>
  error?: string
}

export interface PolicyRule {
  id: string
  permission: PolicyPermission
  pattern: string
  action: PolicyAction
  risk?: RiskLevel
  reason?: string
}

export interface PermissionGrant {
  id: string
  permission: PolicyPermission
  pattern: string
  action: 'allow' | 'deny'
  scope: GrantScope
  expiresAt?: number
  createdAt: number
}

export interface PolicyDecision {
  action: PolicyAction
  risk: RiskLevel
  reason: string
  matchedRule?: string
  grant?: PermissionGrant
  alternatives?: string[]
}

export interface Observation {
  id: string
  sessionId: string
  turnId: string
  source: 'tool' | 'policy' | 'edit' | 'verification' | 'review' | 'user' | 'runtime'
  status: 'ok' | 'error' | 'denied' | 'blocked' | 'stale'
  summary: string
  data?: Record<string, unknown>
  createdAt: number
}

export interface Evidence {
  id: string
  sessionId: string
  turnId: string
  criterionId?: string
  source: AcceptanceEvidenceRequirement
  status: VerificationStatus
  summary: string
  output?: string
  artifactRef?: string
  data?: Record<string, unknown>
  createdAt: number
}

export type VerificationCoverageStatus = 'covered' | 'failed' | 'partial' | 'blocked' | 'stale' | 'waived'

export interface VerificationCoverageItem {
  criterionId: string
  status: VerificationCoverageStatus
  evidenceIds: string[]
  reason: string
}

export interface VerificationCoverage {
  contractId: string
  criteria: VerificationCoverageItem[]
  updatedAt: number
}

export interface VerificationGateResult {
  status: VerificationStatus
  coverage: VerificationCoverage | null
  evidence: Evidence[]
  nextAction: 'allow_final' | 'repair' | 'run_more_checks' | 'ask_user' | 'blocked'
  summary: string
}

export interface ReviewFinding {
  id: string
  sessionId: string
  turnId: string
  category: 'scope' | 'correctness' | 'security' | 'test' | 'architecture' | 'ux' | 'evidence'
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
  blocking: boolean
  title: string
  body: string
  filePath?: string
  range?: AgentTextRange
  evidenceRefs: string[]
  recommendation?: string
  status: 'open' | 'fixed' | 'accepted_risk' | 'dismissed'
  createdAt: number
}

export interface ReviewResult {
  id: string
  sessionId: string
  turnId: string
  status: 'approved' | 'request_changes' | 'needs_more_verification' | 'out_of_scope' | 'blocked'
  findingIds: string[]
  findings: ReviewFinding[]
  summary: string
  createdAt: number
}

export interface ContractScopeItem {
  kind: ContractScopeKind
  value: string
  source: ContractScopeSource
}

export interface AcceptanceCriterion {
  id: string
  text: string
  evidenceRequired: AcceptanceEvidenceRequirement[]
  status: AcceptanceCriterionStatus
}

export interface VerificationPlanItem {
  id: string
  verifier: VerificationPlanKind
  reason: string
  command?: string
}

export interface RiskPoint {
  id: string
  risk: RiskLevel
  text: string
  approvalRequired: boolean
}

export interface TaskAssumption {
  id: string
  text: string
  status: TaskAssumptionStatus
}

export interface TaskContract {
  id: string
  sessionId: string
  turnId: string
  goal: string
  scope: ContractScopeItem[]
  nonGoals: string[]
  constraints: string[]
  acceptanceCriteria: AcceptanceCriterion[]
  verificationPlan: VerificationPlanItem[]
  riskPoints: RiskPoint[]
  assumptions: TaskAssumption[]
  status: TaskContractStatus
  createdAt: number
  updatedAt: number
}

export interface AgentPlanItem {
  id: string
  title: string
  description?: string
  status: StructuredPlanStatus
  source: StructuredPlanSource
  evidence?: string
  updatedAt: number
}

export interface ContextFragment {
  id: string
  type: ContextFragmentType
  section: ContextFragmentSection
  priority: number
  source: string
  text: string
  trusted: boolean
  cacheKey?: string
  stale?: boolean
  tokenEstimate?: number
}

export interface ContextTraceItem {
  id: string
  type: ContextFragmentType
  section: ContextFragmentSection
  source: string
  reason: string
  tokenEstimate?: number
}

export interface ContextTrace {
  included: ContextTraceItem[]
  excluded: ContextTraceItem[]
  totalTokenEstimate: number
  budgetTokens: number
}

export interface ContextBuildInput {
  phase: ContextBuildPhase
  session: AgentSession
  turn: AgentTurn
  contextSnapshot: AgentContextSnapshot
  taskContract?: TaskContract
  planItems?: AgentPlanItem[]
  evidence?: Evidence[]
  verificationCoverage?: VerificationCoverage | null
  reviewResult?: ReviewResult | null
  handoff?: Handoff
  budgetTokens: number
}

export interface ContextBuildResult {
  fragments: ContextFragment[]
  prompt: string
  trace: ContextTrace
}

export interface ContextBuiltSummary {
  phase: ContextBuildPhase
  fragmentCount: number
  includedCount: number
  excludedCount: number
  totalTokenEstimate: number
  budgetTokens: number
}

// === Feature / Progress / Handoff ===

export type FeatureStatus = 'not_started' | 'in_progress' | 'implemented_unverified' | 'verified' | 'blocked' | 'dropped'

export interface FeatureItem {
  id: string
  title: string
  status: FeatureStatus
  acceptanceCriteriaIds: string[]
  evidenceRefs: string[]
  riskRefs: string[]
  updatedAt: number
}

export interface ProgressState {
  taskContractId: string
  activeFeatureId?: string
  featureList: FeatureItem[]
  failedAttempts: string[]
  unresolvedRisks: string[]
  nextSteps: string[]
  updatedAt: number
}

export interface Handoff {
  id: string
  sessionId: string
  turnId: string
  taskContractId: string
  summary: string
  completed: string[]
  implementedUnverified: string[]
  failedAttempts: string[]
  changedFiles: string[]
  evidenceRefs: string[]
  unresolvedRisks: string[]
  nextSteps: string[]
  createdAt: number
}

// === Trace / Usage / Eval ===

export interface AgentUsage {
  model: string
  providerId: string
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  costUsd?: number
  latencyMs?: number
}

export type TraceEvent =
  | { type: 'task.created'; sessionId: string; turnId: string; contractId: string; summary: string; createdAt: number }
  | { type: 'context.built'; sessionId: string; turnId: string; trace: ContextTrace; createdAt: number }
  | { type: 'model.called'; sessionId: string; turnId: string; usage?: AgentUsage; createdAt: number }
  | { type: 'tool.executed'; sessionId: string; turnId: string; callId: string; name: string; status: string; durationMs?: number; createdAt: number }
  | { type: 'policy.decided'; sessionId: string; turnId: string; decision: PolicyDecision; createdAt: number }
  | { type: 'verification.ran'; sessionId: string; turnId: string; result: VerificationResult; createdAt: number }
  | { type: 'review.completed'; sessionId: string; turnId: string; result: ReviewResult; createdAt: number }
  | { type: 'handoff.generated'; sessionId: string; turnId: string; handoff: Handoff; createdAt: number }
  | { type: 'cost.updated'; sessionId: string; turnId: string; usage: AgentUsage; createdAt: number }

export interface EvalCase {
  id: string
  title: string
  task: string
  workspaceFixture?: string
  expectedTrajectory: string[]
  expectedEvidence: string[]
  safetyExpectations: string[]
}

export interface AgentSession {
  id: string
  workspace: AgentWorkspaceLocation | null
  title: string
  createdAt: number
  updatedAt: number
  status: 'idle' | 'running' | 'waiting_approval' | 'interrupted' | 'error'
  permissionMode: AgentPermissionMode
}

export interface AgentTurn {
  id: string
  sessionId: string
  text: string
  createdAt: number
  status: 'running' | 'completed' | 'failed' | 'interrupted'
}

export type ToolState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'waiting_approval'

export interface ToolCallView {
  id: string
  name: string
  title: string
  input: Record<string, unknown>
  summary: string
  state: ToolState
  startedAt?: number
  completedAt?: number
}

export interface ToolResultView {
  output: string
  structured?: Record<string, unknown>
  truncated?: boolean
  error?: string
  failureType?: ToolFailureType
  status?: 'ok' | 'error' | 'denied' | 'timeout' | 'conflict'
  exitCode?: number | null
  timedOut?: boolean
  durationMs?: number
}

export interface AgentToolDefinition {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  isReadOnly: boolean
  risk: 'low' | 'medium' | 'high' | 'critical'
  visibility?: ToolVisibility
  sideEffect?: ToolSideEffect
}

export interface AgentToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface AgentToolResult extends ToolResultView {
  callId: string
  toolName: string
  input: Record<string, unknown>
}

export interface EditProposal {
  id: string
  sessionId: string
  turnId: string
  title: string
  filePath: string
  originalContent: string
  modifiedContent: string
  rationale?: string
  rejectedReason?: string
  rollbackOf?: string
  state: 'pending' | 'applied' | 'rejected' | 'conflicted'
  createdAt: number
}

export type MessagePart =
  | { id: string; messageId: string; type: 'text'; role: 'user' | 'assistant' | 'system'; text: string; createdAt: number }
  | { id: string; messageId: string; type: 'reasoning'; text: string; redacted?: boolean; createdAt: number }
  | { id: string; messageId: string; type: 'stage'; stage: AgentRunStage; detail?: string; createdAt: number }
  | { id: string; messageId: string; type: 'task_contract'; contract: TaskContract; createdAt: number }
  | { id: string; messageId: string; type: 'plan'; items: AgentPlanItem[]; reason?: string; createdAt: number }
  | { id: string; messageId: string; type: 'tool'; call: ToolCallView; state: ToolState; output?: ToolResultView; createdAt: number }
  | { id: string; messageId: string; type: 'file'; filePath: string; range?: AgentTextRange; label: string; createdAt: number }
  | { id: string; messageId: string; type: 'diff'; proposalId: string; title: string; state: EditProposal['state']; createdAt: number }
  | { id: string; messageId: string; type: 'diagnostic'; diagnostics: AgentDiagnostic[]; createdAt: number }
  | { id: string; messageId: string; type: 'verification'; result: VerificationResult; createdAt: number }
  | { id: string; messageId: string; type: 'evidence_coverage'; coverage: VerificationCoverage; evidence: Evidence[]; gate?: VerificationGateResult; createdAt: number }
  | { id: string; messageId: string; type: 'review'; result: ReviewResult; createdAt: number }
  | { id: string; messageId: string; type: 'edit_result'; proposalId: string; state: EditProposal['state']; filePath: string; message: string; createdAt: number }
  | { id: string; messageId: string; type: 'handoff'; handoff: Handoff; createdAt: number }

export interface ApprovalRequest {
  id: string
  sessionId: string
  turnId: string
  toolCallId: string
  title: string
  reason: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  target?: string
  details?: Record<string, unknown>
  matchedRule?: string
  runtime?: AgentWorkspaceLocation | null
  grantOptions?: GrantScope[]
  createdAt: number
}

export interface AgentSessionSummary {
  id: string
  title: string
  workspace: AgentWorkspaceLocation | null
  createdAt: number
  updatedAt: number
  status: AgentSession['status']
  permissionMode: AgentPermissionMode
  lastMessage?: string
  latestVerificationStatus?: VerificationStatus
}

export type ApprovalDecision =
  | { action: 'allow_once' }
  | { action: 'always_allow'; pattern: string }
  | { action: 'deny'; reason?: string }

export type TurnStopReason =
  | 'completed'
  | 'interrupted'
  | 'max_turns'
  | 'permission_denied'
  | 'permission_denied_loop'
  | 'tool_failed'
  | 'tool_timeout'
  | 'command_timeout'
  | 'model_error'
  | 'model_context_overflow'
  | 'approval_timeout'

export type AgentOp =
  | { type: 'session.create'; workspace: AgentWorkspaceLocation | null; permissionMode?: AgentPermissionMode }
  | { type: 'session.resume'; sessionId: string }
  | { type: 'session.resumeLast'; workspace: AgentWorkspaceLocation | null }
  | { type: 'session.list' }
  | { type: 'session.rename'; sessionId: string; title: string }
  | { type: 'session.delete'; sessionId: string }
  | { type: 'turn.submit'; sessionId: string; text: string; context: AgentContextSnapshot }
  | { type: 'turn.interrupt'; sessionId: string; turnId: string }
  | { type: 'approval.respond'; requestId: string; decision: ApprovalDecision }
  | { type: 'edit.apply'; sessionId: string; proposalId: string; context?: AgentContextSnapshot }
  | { type: 'edit.reject'; sessionId: string; proposalId: string; reason?: string }
  | { type: 'edit.rollback'; sessionId: string; proposalId: string }
  | { type: 'permission.update'; sessionId: string; permissionMode: AgentPermissionMode }
  | { type: 'trace.export'; sessionId: string; redacted?: boolean }

export type AgentEvent =
  | { type: 'session.created'; session: AgentSession }
  | { type: 'session.updated'; session: AgentSession }
  | { type: 'turn.started'; sessionId: string; turn: AgentTurn }
  | { type: 'turn.stage'; sessionId: string; turnId: string; stage: AgentRunStage; detail?: string }
  | { type: 'task_contract.created'; sessionId: string; turnId: string; contract: TaskContract }
  | { type: 'task_contract.updated'; sessionId: string; turnId: string; contract: TaskContract; reason: string; source: StructuredPlanSource }
  | { type: 'plan.updated'; sessionId: string; turnId: string; items: AgentPlanItem[]; reason?: string; source: StructuredPlanSource; createdAt: number }
  | { type: 'context.built'; sessionId: string; turnId: string; summary: ContextBuiltSummary; trace: ContextTrace; createdAt: number }
  | { type: 'message.part.created'; sessionId: string; turnId?: string; part: MessagePart }
  | { type: 'message.part.updated'; sessionId: string; turnId?: string; part: MessagePart }
  | { type: 'tool.started'; sessionId: string; turnId: string; call: ToolCallView }
  | { type: 'tool.completed'; sessionId: string; turnId: string; callId: string; result: ToolResultView }
  | { type: 'observation.created'; sessionId: string; turnId: string; observation: Observation }
  | { type: 'evidence.created'; sessionId: string; turnId: string; evidence: Evidence }
  | { type: 'verification.coverage.updated'; sessionId: string; turnId: string; coverage: VerificationCoverage; gate: VerificationGateResult }
  | { type: 'review.completed'; sessionId: string; turnId: string; result: ReviewResult }
  | { type: 'approval.requested'; sessionId: string; turnId: string; request: ApprovalRequest }
  | { type: 'approval.resolved'; sessionId: string; turnId: string; requestId: string; decision: ApprovalDecision }
  | { type: 'edit.proposed'; sessionId: string; turnId: string; proposal: EditProposal }
  | { type: 'diagnostics.updated'; sessionId: string; diagnostics: AgentDiagnostic[] }
  | { type: 'verification.started'; sessionId: string; turnId: string; verifier: VerificationResult['verifier']; command?: string }
  | { type: 'verification.completed'; sessionId: string; turnId: string; result: VerificationResult }
  | { type: 'turn.completed'; sessionId: string; turnId: string; reason: TurnStopReason }
  | { type: 'turn.failed'; sessionId: string; turnId: string; reason: TurnStopReason; error: string }
  | { type: 'progress.updated'; sessionId: string; turnId: string; progress: ProgressState }
  | { type: 'handoff.created'; sessionId: string; turnId: string; handoff: Handoff }
  | { type: 'trace.exported'; sessionId: string; format: 'json'; redacted: boolean; traceEvents: TraceEvent[] }
  | { type: 'trace.batch'; sessionId: string; turnId: string; traceEvents: TraceEvent[] }

export type AgentIpcResult<T> = { ok: true; value: T } | { ok: false; error: string }
