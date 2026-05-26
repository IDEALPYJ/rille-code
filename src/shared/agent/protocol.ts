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
  fallbackProfileIds?: string[]
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
  fallbackProfileIds?: string[]
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
  fallbackProfileIds?: string[]
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

export interface AgentSymbol {
  name: string
  kind: string
  filePath: string
  range?: AgentTextRange
  containerName?: string
}

export interface AgentSelection {
  filePath: string
  range: AgentTextRange
  text?: string
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
  artifact?: ArtifactRef
  artifactRef?: string
  truncated?: boolean
  exitCode?: number | null
  durationMs?: number
  createdAt: number
}

export interface AgentWorkspaceLocation {
  kind: 'local' | 'ssh' | 'wsl' | 'worktree'
  path: string
  label: string
  connectionId?: string
  targetId?: string
  origin?: AgentWorkspaceLocation
  sandboxId?: string
}

export type ArtifactKind = 'text' | 'json' | 'binary' | 'command_output' | 'verification_output' | 'runtime_state' | 'trace' | 'checkpoint'

export interface ArtifactRef {
  id: string
  sessionId: string
  turnId?: string
  kind: ArtifactKind
  uri: string
  mimeType?: string
  sizeBytes: number
  sha256: string
  redacted: boolean
  createdAt: number
}

export interface ArtifactPayload {
  ref: ArtifactRef
  encoding: 'utf8' | 'base64'
  content: string
}

export interface RuntimeProcessSummary {
  id: string
  sessionId: string
  workspace: AgentWorkspaceLocation
  commandLine: string
  cwd: string
  pid?: number
  status: 'starting' | 'running' | 'exited' | 'failed' | 'stopped'
  exitCode?: number | null
  timedOut?: boolean
  outputArtifact?: ArtifactRef
  outputArtifactRef?: string
  startedAt: number
  updatedAt: number
}

export interface RuntimeProcessEvent {
  process: RuntimeProcessSummary
  outputDelta?: string
}

export interface CheckpointRef {
  id: string
  sessionId: string
  turnId?: string
  workspace: AgentWorkspaceLocation
  reason: string
  files: string[]
  gitStatus: string
  artifact: ArtifactRef
  artifactRef: string
  runtimeStateArtifact?: ArtifactRef
  createdAt: number
}

export interface SandboxConstraints {
  filesystem: 'worktree_only' | 'readonly'
  network: 'none' | 'allow'
  platform: 'windows_job_object' | 'none'
  active: boolean
}

export interface ExecutionSandbox {
  id: string
  sessionId: string
  workspace: AgentWorkspaceLocation
  sandboxWorkspace: AgentWorkspaceLocation
  status: 'creating' | 'ready' | 'failed' | 'disposed'
  reason?: string
  checkpoint?: CheckpointRef
  constraints?: SandboxConstraints
  createdAt: number
  updatedAt: number
}

export interface RuntimeStateArtifact {
  id: string
  sessionId: string
  turnId?: string
  workspace: AgentWorkspaceLocation | null
  gitStatus?: string
  processes: RuntimeProcessSummary[]
  checkpoints: CheckpointRef[]
  sandboxes: ExecutionSandbox[]
  latestEvidence: Evidence[]
  createdAt: number
}

export interface AgentContextSnapshot {
  workspace: AgentWorkspaceLocation | null
  activeFile?: AgentContextFile | null
  openFiles: AgentContextFile[]
  diagnostics: AgentDiagnostic[]
  cursor?: { line: number; column: number }
  symbols?: AgentSymbol[]
  selections?: AgentSelection[]
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
export type PlanConfirmationStatus = 'pending' | 'confirmed' | 'rejected' | 'superseded'
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
  | 'feature_list'
  | 'handoff'
  | 'symbols'
  | 'selection'
  | 'runtime_state'
  | 'skill'
  | 'plugin'
  | 'mcp_tool'
  | 'subagent_result'
export type ContextFragmentSection = 'stable_prefix' | 'dynamic_suffix'
export type ContextTrustLevel = 'system' | 'workspace' | 'tool_output' | 'user' | 'external'
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
export type GrantScope = 'once' | 'session' | 'workspace'
export type SkillSource = 'project' | 'user' | 'plugin'
export type SkillTrust = 'trusted' | 'untrusted'
export type McpTransport = 'stdio'
export type McpServerStatus = 'stopped' | 'starting' | 'running' | 'failed' | 'stopped_error'

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
  workspaceKey?: string
  expiresAt?: number
  createdAt: number
}

export interface GuardianDecision {
  verdict: 'allow' | 'ask' | 'deny'
  risk: RiskLevel
  reason: string
  recommendedAction: PolicyAction
  classifier: 'deterministic' | 'llm'
}

export interface CommandSubject {
  raw: string
  primary: string
  args: string[]
  arity: number
  subjects: string[]
  usesShell: boolean
  hasPipe: boolean
  hasRedirect: boolean
  hasSubshell: boolean
  hasChain: boolean
  envAssignments: string[]
}

export interface PolicyDecision {
  action: PolicyAction
  risk: RiskLevel
  reason: string
  matchedRule?: string
  grant?: PermissionGrant
  guardian?: GuardianDecision
  commandSubject?: CommandSubject
  sandboxRequired?: boolean
  alternatives?: string[]
}

export interface Observation {
  id: string
  sessionId: string
  turnId: string
  source: 'tool' | 'policy' | 'edit' | 'verification' | 'review' | 'user' | 'runtime' | 'subagent'
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
  artifact?: ArtifactRef
  artifactRef?: string
  waiver?: WaiverRef
  reviewFindingIds?: string[]
  acceptedRiskIds?: string[]
  data?: Record<string, unknown>
  createdAt: number
}

export interface WaiverRef {
  id: string
  criterionId?: string
  evidenceIds: string[]
  reason: string
  scope: 'criterion' | 'evidence' | 'turn'
  createdBy: 'user'
  createdAt: number
  expiresAt?: number
}

export interface Waiver extends WaiverRef {
  sessionId: string
  turnId: string
}

export interface AcceptedRisk {
  id: string
  sessionId: string
  turnId: string
  findingId: string
  reason: string
  createdBy: 'user'
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
  /** Origin of this finding: 'rule' (static rules), 'llm' (evaluator model), or 'subagent'. */
  source?: 'rule' | 'llm' | 'subagent'
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

export interface ReviewerSubagentConfig {
  role: 'reviewer'
  modelProfileId?: string
  permissionScope: 'read_only'
}

export interface EvaluatorRun {
  id: string
  sessionId: string
  turnId: string
  status: 'running' | 'completed' | 'failed'
  configSnapshot?: Record<string, unknown>
  reviewerSubagent?: ReviewerSubagentConfig
  reviewResult?: ReviewResult | null
  usage?: AgentUsage
  error?: string
  createdAt: number
  completedAt?: number
}

export type SubagentRole = 'explorer' | 'verifier' | 'reviewer' | 'advisor'
export type SubagentPermissionScope = 'read_only' | 'verify_only' | 'review_only' | 'advisory_only'
export type SubagentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface SubagentContract {
  id: string
  parentSessionId: string
  parentTurnId: string
  role: SubagentRole
  goal: string
  permissionScope: SubagentPermissionScope
  allowedTools: string[]
  focusFiles?: string[]
  outputSchema: string
  createdAt: number
}

export interface SubagentResult {
  id: string
  contractId: string
  role: SubagentRole
  status: 'completed' | 'failed' | 'blocked'
  summary: string
  findings?: ReviewFinding[]
  evidenceRefs?: string[]
  artifactRefs?: string[]
  recommendedActions?: string[]
  childSessionId?: string
  usage?: AgentUsage
  error?: string
  createdAt: number
  completedAt?: number
}

export interface SubagentRun {
  id: string
  contract: SubagentContract
  parentSessionId: string
  parentTurnId: string
  childSessionId: string
  role: SubagentRole
  status: SubagentRunStatus
  result?: SubagentResult
  error?: string
  createdAt: number
  completedAt?: number
}

export interface SubagentMergeResult {
  id: string
  parentSessionId: string
  parentTurnId: string
  runIds: string[]
  mergedObservationIds: string[]
  mergedFindingIds: string[]
  advisorySummary?: string
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
  evidenceIds?: string[]
  acceptanceCriterionIds?: string[]
  updatedAt: number
}

export interface PlanConfirmation {
  id: string
  sessionId: string
  turnId: string
  contractId: string
  planItemIds: string[]
  status: PlanConfirmationStatus
  riskLevel: RiskLevel
  reason: string
  rejectedReason?: string
  createdAt: number
  resolvedAt?: number
}

export interface ContextFragment {
  id: string
  type: ContextFragmentType
  section: ContextFragmentSection
  priority: number
  source: string
  text: string
  trusted: boolean
  trust?: ContextTrustLevel
  untrusted?: boolean
  cacheEligible?: boolean
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
  cacheKey?: string
  cacheEligible?: boolean
  trust?: ContextTrustLevel
  untrusted?: boolean
}

export interface ContextTrace {
  included: ContextTraceItem[]
  excluded: ContextTraceItem[]
  totalTokenEstimate: number
  budgetTokens: number
  stablePrefixCacheKey?: string
  dynamicSuffixHash?: string
  cacheEligibleTokenEstimate?: number
  cacheHit?: boolean
  cachedInputTokens?: number
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
  subagentResults?: SubagentResult[]
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
  stablePrefixCacheKey?: string
  dynamicSuffixHash?: string
  cacheEligibleTokenEstimate?: number
  cacheHit?: boolean
  cachedInputTokens?: number
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

export type FeatureLifecycleStatus = 'planned' | 'active' | 'verified' | 'deprecated' | 'removed'

export interface FeatureLifecycleEntry {
  featureId: string
  status: FeatureLifecycleStatus
  source?: string
  owner?: string
  lastVerifiedAt?: number
  evidenceRefs: string[]
  deprecationNote?: string
  removalNote?: string
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

export interface FeatureStoreSnapshot {
  taskContractId?: string
  featureList: FeatureItem[]
  lifecycle?: FeatureLifecycleEntry[]
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

// === Project Memory ===

export type ProjectMemoryKind = 'command' | 'convention' | 'decision' | 'known_issue' | 'workflow' | 'handoff'
export type ProjectMemoryStatus = 'active' | 'stale' | 'superseded' | 'conflict'

export interface ProjectMemoryEntry {
  id: string
  kind: ProjectMemoryKind
  text: string
  sourceRefs: string[]
  status: ProjectMemoryStatus
  createdAt: number
  updatedAt: number
}

export interface CompactionTask {
  id: string
  sessionId: string
  turnId?: string
  status: 'running' | 'completed' | 'failed'
  reason?: string
  createdAt: number
  completedAt?: number
}

export interface CompactionResult {
  id: string
  taskId: string
  sessionId: string
  turnId?: string
  summaryArtifact: ArtifactRef
  retainedFeatureList: FeatureItem[]
  handoff?: Handoff
  stablePrefixCacheKey?: string
  cacheInvalidatedReason?: string
  createdAt: number
}

// === Trace / Usage / Eval ===

export interface AgentUsage {
  model: string
  providerId: string
  purpose?: 'executor' | 'evaluator' | 'advisor'
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  cacheWriteInputTokens?: number
  cacheMetrics?: ModelCacheMetrics
  costUsd?: number
  latencyMs?: number
}

export interface ModelCacheMetrics {
  promptCacheKey?: string
  promptCacheRetention?: '24h'
  cachedInputTokens?: number
  cacheWriteInputTokens?: number
  cacheHit?: boolean
}

export interface ProviderFallbackTrace {
  fromProviderId: AgentProviderId
  fromProtocol: AgentProviderProtocol
  toProviderId?: AgentProviderId
  toProtocol?: AgentProviderProtocol
  reason: 'network' | 'rate_limit' | 'server_error' | 'empty_response' | 'unsupported_streaming' | 'provider_error'
  attempt: number
  latencyMs?: number
  error?: string
  createdAt: number
}

export type ModelStreamEvent =
  | { type: 'model.started'; sessionId?: string; turnId?: string; providerId: AgentProviderId; protocol: AgentProviderProtocol; createdAt: number }
  | { type: 'model.text.delta'; sessionId?: string; turnId?: string; text: string; sequence?: number; createdAt: number }
  | { type: 'model.reasoning.delta'; sessionId?: string; turnId?: string; text: string; sequence?: number; createdAt: number }
  | { type: 'model.tool_call.delta'; sessionId?: string; turnId?: string; callId: string; name?: string; argumentsDelta?: string; sequence?: number; createdAt: number }
  | { type: 'model.tool_call.done'; sessionId?: string; turnId?: string; callId: string; name: string; arguments: string; sequence?: number; createdAt: number }
  | { type: 'model.completed'; sessionId?: string; turnId?: string; text: string; usage?: AgentUsage; toolCalls?: AgentToolCall[]; cacheMetrics?: ModelCacheMetrics; createdAt: number }
  | { type: 'model.failed'; sessionId?: string; turnId?: string; error: string; fallback?: ProviderFallbackTrace; createdAt: number }

export interface ModelDecision {
  text: string
  toolCalls?: AgentToolCall[]
  usage?: AgentUsage
  cacheMetrics?: ModelCacheMetrics
  fallbackTrace?: ProviderFallbackTrace[]
}

export interface SkillContract {
  id: string
  name: string
  description: string
  activationKeywords: string[]
  source: SkillSource
  content: string
  priority: number
  trust: SkillTrust
  pluginId?: string
  filePath?: string
  createdAt: number
  updatedAt: number
}

export interface McpServerConfig {
  id: string
  name: string
  command: string
  cwd?: string
  env?: Record<string, string>
  transport: McpTransport
  enabled: boolean
  sideEffect?: ToolSideEffect
}

export interface McpToolDescriptor {
  name: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
  sideEffect: ToolSideEffect
  namespace: string
  pluginId: string
  serverId: string
  readOnly: boolean
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  skills: SkillContract[]
  hooks: string[]
  mcpServers: McpServerConfig[]
  toolNamespaces: string[]
  enabled: boolean
  filePath?: string
}

export interface ExtensionDiscoverySnapshot {
  skills: SkillContract[]
  plugins: PluginManifest[]
  conflicts: string[]
}

export interface SkillActivation {
  id: string
  sessionId: string
  turnId: string
  skillId: string
  source: SkillSource
  reason: string
  createdAt: number
}

export interface PluginActivation {
  id: string
  pluginId: string
  status: 'loaded' | 'failed'
  error?: string
  createdAt: number
}

export interface McpServerState {
  id: string
  pluginId: string
  serverId: string
  status: McpServerStatus
  pid?: number
  startedAt?: number
  updatedAt: number
  lastError?: string
  tools: McpToolDescriptor[]
}

export type GovernanceFindingSeverity = 'info' | 'warning' | 'error' | 'blocking'
export type GovernanceFindingCategory = 'feature_lifecycle' | 'model_upgrade' | 'prompt_tool_policy' | 'eval_regression' | 'stale_config' | 'scaffold_cleanup' | 'migration_compatibility'

export interface GovernanceAuditFinding {
  id: string
  category: GovernanceFindingCategory
  severity: GovernanceFindingSeverity
  title: string
  detail: string
  evidenceRefs: string[]
  recommendation?: string
}

export interface ModelUpgradeReview {
  status: 'pass' | 'warn' | 'fail'
  activeProfileId?: string
  profileCount: number
  evaluatorConfigured: boolean
  evalCaseCount: number
  requiredGates: string[]
  missingGates: string[]
  findings: GovernanceAuditFinding[]
}

export interface EvalRegressionReport {
  status: 'pass' | 'fail'
  caseCount: number
  passed: number
  failed: number
  caseSummaries: Array<{ id: string; title: string; mode: EvalMode; passed: boolean; failures: string[] }>
  previousReportAt?: number
}

export interface ConfigAuditFinding {
  id: string
  source: string
  severity: GovernanceFindingSeverity
  message: string
  evidenceRefs: string[]
}

export interface ScaffoldCleanupCandidate {
  id: string
  filePath: string
  reason: string
  risk: 'low' | 'medium' | 'high'
  evidence: string
  recommendation: string
}

export interface MigrationCompatibilityResult {
  status: 'pass' | 'fail'
  checkedFixtures: string[]
  failures: string[]
}

export interface GovernanceAuditReport {
  id: string
  workspacePath?: string
  createdAt: number
  status: 'pass' | 'warn' | 'fail'
  summary: string
  featureLifecycle: FeatureLifecycleEntry[]
  modelUpgrade: ModelUpgradeReview
  evalRegression: EvalRegressionReport
  configFindings: ConfigAuditFinding[]
  scaffoldCandidates: ScaffoldCleanupCandidate[]
  migrationCompatibility: MigrationCompatibilityResult
  findings: GovernanceAuditFinding[]
}

export type AgentHookName =
  | 'turn.start'
  | 'context.built'
  | 'model.before'
  | 'model.after'
  | 'tool.before'
  | 'tool.after'
  | 'verification.after'
  | 'review.after'
  | 'finalize'

export type AgentHookStatus = 'completed' | 'failed'

export interface AgentHookInvocation {
  id: string
  sessionId: string
  turnId: string
  name: AgentHookName
  status: AgentHookStatus
  durationMs: number
  error?: string
  createdAt: number
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
  | { type: 'model.fallback'; sessionId: string; turnId: string; fallback: ProviderFallbackTrace; createdAt: number }
  | { type: 'model.cache'; sessionId: string; turnId: string; cache: ModelCacheMetrics; createdAt: number }
  | { type: 'artifact.created'; sessionId: string; turnId?: string; artifact: ArtifactRef; createdAt: number }
  | { type: 'runtime.state.captured'; sessionId: string; turnId?: string; artifact: ArtifactRef; createdAt: number }
  | { type: 'checkpoint.created'; sessionId: string; turnId?: string; checkpoint: CheckpointRef; createdAt: number }
  | { type: 'context.compacted'; sessionId: string; turnId?: string; result: CompactionResult; createdAt: number }
  | { type: 'hook.invoked'; sessionId: string; turnId: string; hook: AgentHookInvocation; createdAt: number }
  | { type: 'skill.activated'; sessionId: string; turnId: string; activation: SkillActivation; createdAt: number }
  | { type: 'plugin.loaded'; sessionId: string; activation: PluginActivation; createdAt: number }
  | { type: 'mcp.server.started' | 'mcp.server.completed' | 'mcp.server.failed' | 'mcp.server.stopped'; sessionId: string; state: McpServerState; createdAt: number }
  | { type: 'mcp.tool.discovered'; sessionId: string; tool: McpToolDescriptor; createdAt: number }
  | { type: 'subagent.started'; sessionId: string; turnId: string; run: SubagentRun; createdAt: number }
  | { type: 'subagent.progress'; sessionId: string; turnId: string; runId: string; message: string; createdAt: number }
  | { type: 'subagent.completed'; sessionId: string; turnId: string; run: SubagentRun; result: SubagentResult; createdAt: number }
  | { type: 'subagent.failed'; sessionId: string; turnId: string; run: SubagentRun; error: string; createdAt: number }
  | { type: 'subagent.merged'; sessionId: string; turnId: string; merge: SubagentMergeResult; createdAt: number }
  | { type: 'governance.audit.started'; sessionId: string; turnId?: string; reportId: string; createdAt: number }
  | { type: 'governance.audit.completed'; sessionId: string; turnId?: string; report: GovernanceAuditReport; createdAt: number }
  | { type: 'governance.audit.failed'; sessionId: string; turnId?: string; reportId: string; error: string; createdAt: number }
  | { type: 'eval.regression.reported'; sessionId: string; turnId?: string; report: EvalRegressionReport; createdAt: number }
  | { type: 'config.audit.completed'; sessionId: string; turnId?: string; findings: ConfigAuditFinding[]; createdAt: number }
  | { type: 'scaffold.cleanup.reported'; sessionId: string; turnId?: string; candidates: ScaffoldCleanupCandidate[]; createdAt: number }

export type EvalMode = 'trace_replay' | 'single_step' | 'full_turn'

export interface EvalFixtureStep {
  name: string
  command?: string
}

export interface EvalExpectedState {
  finalGate?: 'allow_final' | 'repair' | 'blocked'
  reviewStatus?: ReviewResult['status']
  handoffCompleted?: boolean
}

export interface EvalCase {
  id: string
  title: string
  task: string
  mode?: EvalMode
  workspaceFixture?: string
  traceFixture?: TraceEvent[]
  setup?: EvalFixtureStep[]
  teardown?: EvalFixtureStep[]
  expectedTrajectory: string[]
  expectedEvidence: string[]
  expectedState?: EvalExpectedState
  forbiddenActions?: string[]
  safetyExpectations: string[]
}

export interface AgentSession {
  id: string
  workspace: AgentWorkspaceLocation | null
  title: string
  createdAt: number
  updatedAt: number
  status: 'idle' | 'running' | 'waiting_approval' | 'interrupted' | 'error' | 'archived'
  permissionMode: AgentPermissionMode
  parentSessionId?: string
  rootSessionId?: string
  subagent?: { role: SubagentRole; contractId: string }
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
  artifact?: ArtifactRef
  artifactRef?: string
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
  deferred?: boolean
  category?: string
  keywords?: string[]
  activationHint?: string
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
  checkpointId?: string
  sandboxId?: string
  proposalSetId?: string
  state: 'pending' | 'applied' | 'rejected' | 'conflicted'
  createdAt: number
}

export interface EditProposalSet {
  id: string
  sessionId: string
  turnId: string
  title: string
  source: 'checkpoint' | 'sandbox' | 'rollback'
  checkpointId?: string
  sandboxId?: string
  proposalIds: string[]
  createdAt: number
}

export type MessagePart =
  | { id: string; messageId: string; type: 'text'; role: 'user' | 'assistant' | 'system'; text: string; createdAt: number }
  | { id: string; messageId: string; type: 'reasoning'; text: string; redacted?: boolean; createdAt: number }
  | { id: string; messageId: string; type: 'stage'; stage: AgentRunStage; detail?: string; createdAt: number }
  | { id: string; messageId: string; type: 'task_contract'; contract: TaskContract; createdAt: number }
  | { id: string; messageId: string; type: 'plan'; items: AgentPlanItem[]; reason?: string; createdAt: number }
  | { id: string; messageId: string; type: 'plan_confirmation'; confirmation: PlanConfirmation; createdAt: number }
  | { id: string; messageId: string; type: 'tool'; call: ToolCallView; state: ToolState; output?: ToolResultView; createdAt: number }
  | { id: string; messageId: string; type: 'file'; filePath: string; range?: AgentTextRange; label: string; createdAt: number }
  | { id: string; messageId: string; type: 'diff'; proposalId: string; title: string; state: EditProposal['state']; createdAt: number }
  | { id: string; messageId: string; type: 'diagnostic'; diagnostics: AgentDiagnostic[]; createdAt: number }
  | { id: string; messageId: string; type: 'verification'; result: VerificationResult; createdAt: number }
  | { id: string; messageId: string; type: 'evidence_coverage'; coverage: VerificationCoverage; evidence: Evidence[]; gate?: VerificationGateResult; createdAt: number }
  | { id: string; messageId: string; type: 'review'; result: ReviewResult; createdAt: number }
  | { id: string; messageId: string; type: 'edit_result'; proposalId: string; state: EditProposal['state']; filePath: string; message: string; createdAt: number }
  | { id: string; messageId: string; type: 'handoff'; handoff: Handoff; createdAt: number }
  | { id: string; messageId: string; type: 'artifact'; artifact: ArtifactRef; label: string; createdAt: number }
  | { id: string; messageId: string; type: 'subagent'; run: SubagentRun; result?: SubagentResult; createdAt: number }

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
  parentSessionId?: string
  rootSessionId?: string
  subagent?: AgentSession['subagent']
}

export type ApprovalDecision =
  | { action: 'allow_once' }
  | { action: 'always_allow'; pattern: string }
  | { action: 'allow_workspace'; pattern: string; expiresAt?: number }
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
  | { type: 'session.archive'; sessionId: string }
  | { type: 'session.unarchive'; sessionId: string }
  | { type: 'session.delete'; sessionId: string }
  | { type: 'artifact.read'; sessionId: string; artifactId: string }
  | { type: 'artifact.list'; sessionId: string }
  | { type: 'runtime.process.list'; sessionId?: string }
  | { type: 'runtime.process.stop'; processId: string }
  | { type: 'checkpoint.create'; sessionId: string; turnId?: string; workspace: AgentWorkspaceLocation; reason: string }
  | { type: 'checkpoint.restoreAsProposal'; sessionId: string; checkpointId: string; filePath?: string }
  | { type: 'sandbox.create'; sessionId: string; workspace: AgentWorkspaceLocation; reason?: string }
  | { type: 'sandbox.dispose'; sessionId: string; sandboxId: string }
  | { type: 'sandbox.diffAsProposals'; sessionId: string; sandboxId: string; turnId?: string }
  | { type: 'runtime.state.capture'; sessionId: string; turnId?: string; workspace?: AgentWorkspaceLocation | null }
  | { type: 'turn.submit'; sessionId: string; text: string; context: AgentContextSnapshot }
  | { type: 'turn.interrupt'; sessionId: string; turnId: string }
  | { type: 'plan.confirm'; sessionId: string; confirmationId: string }
  | { type: 'plan.reject'; sessionId: string; confirmationId: string; reason?: string }
  | { type: 'evidence.user.add'; sessionId: string; turnId?: string; criterionId?: string; status?: VerificationStatus; summary: string; output?: string; artifactId?: string }
  | { type: 'evidence.browser.add'; sessionId: string; turnId?: string; criterionId?: string; url: string; title?: string; status?: VerificationStatus; summary: string; screenshotArtifactId?: string; domExcerptArtifactId?: string }
  | { type: 'evidence.waive'; sessionId: string; turnId?: string; criterionId?: string; evidenceIds?: string[]; reason: string; scope?: Waiver['scope']; expiresAt?: number }
  | { type: 'review.acceptRisk'; sessionId: string; turnId?: string; findingId: string; reason: string }
  | { type: 'review.dismissFinding'; sessionId: string; turnId?: string; findingId: string; reason?: string }
  | { type: 'context.compact'; sessionId: string; turnId?: string; reason?: string }
  | { type: 'approval.respond'; requestId: string; decision: ApprovalDecision }
  | { type: 'edit.apply'; sessionId: string; proposalId: string; context?: AgentContextSnapshot }
  | { type: 'edit.reject'; sessionId: string; proposalId: string; reason?: string }
  | { type: 'edit.rollback'; sessionId: string; proposalId: string }
  | { type: 'permission.update'; sessionId: string; permissionMode: AgentPermissionMode }
  | { type: 'trace.export'; sessionId: string; redacted?: boolean }
  | { type: 'extension.refresh'; sessionId: string; workspace?: AgentWorkspaceLocation | null }
  | { type: 'skill.list'; sessionId: string; workspace?: AgentWorkspaceLocation | null }
  | { type: 'plugin.list'; sessionId: string; workspace?: AgentWorkspaceLocation | null }
  | { type: 'mcp.server.list'; sessionId: string }
  | { type: 'mcp.server.start'; sessionId: string; pluginId: string; serverId: string; workspace?: AgentWorkspaceLocation | null }
  | { type: 'mcp.server.stop'; sessionId: string; pluginId: string; serverId: string }
  | { type: 'subagent.launch'; sessionId: string; turnId?: string; role: SubagentRole; goal: string; reason?: string; focusFiles?: string[]; context?: AgentContextSnapshot }
  | { type: 'subagent.cancel'; sessionId: string; runId: string }
  | { type: 'subagent.list'; sessionId: string }
  | { type: 'subagent.read'; sessionId: string; runId: string }
  | { type: 'governance.audit'; sessionId: string; workspace?: AgentWorkspaceLocation | null; turnId?: string }
  | { type: 'governance.report.read'; sessionId: string }
  | { type: 'model.upgrade.review'; sessionId: string; workspace?: AgentWorkspaceLocation | null }
  | { type: 'memory.create'; workspacePath: string; kind: ProjectMemoryKind; text: string; sourceRefs: string[] }
  | { type: 'memory.update'; workspacePath: string; entryId: string; changes: Partial<Pick<ProjectMemoryEntry, 'text' | 'status' | 'sourceRefs'>> }
  | { type: 'memory.delete'; workspacePath: string; entryId: string }
  | { type: 'memory.list'; workspacePath: string }

export type AgentEvent =
  | { type: 'session.created'; session: AgentSession }
  | { type: 'session.updated'; session: AgentSession }
  | { type: 'session.archived'; session: AgentSession }
  | { type: 'session.unarchived'; session: AgentSession }
  | { type: 'turn.started'; sessionId: string; turn: AgentTurn }
  | { type: 'turn.stage'; sessionId: string; turnId: string; stage: AgentRunStage; detail?: string }
  | { type: 'task_contract.created'; sessionId: string; turnId: string; contract: TaskContract }
  | { type: 'task_contract.updated'; sessionId: string; turnId: string; contract: TaskContract; reason: string; source: StructuredPlanSource }
  | { type: 'plan.updated'; sessionId: string; turnId: string; items: AgentPlanItem[]; reason?: string; source: StructuredPlanSource; createdAt: number }
  | { type: 'plan.confirmation.requested'; sessionId: string; turnId: string; confirmation: PlanConfirmation }
  | { type: 'plan.confirmation.resolved'; sessionId: string; turnId: string; confirmation: PlanConfirmation }
  | { type: 'context.built'; sessionId: string; turnId: string; summary: ContextBuiltSummary; trace: ContextTrace; createdAt: number }
  | { type: 'message.part.created'; sessionId: string; turnId?: string; part: MessagePart }
  | { type: 'message.part.updated'; sessionId: string; turnId?: string; part: MessagePart }
  | { type: 'tool.started'; sessionId: string; turnId: string; call: ToolCallView }
  | { type: 'tool.completed'; sessionId: string; turnId: string; callId: string; result: ToolResultView }
  | { type: 'observation.created'; sessionId: string; turnId: string; observation: Observation }
  | { type: 'evidence.created'; sessionId: string; turnId: string; evidence: Evidence }
  | { type: 'evidence.waived'; sessionId: string; turnId: string; waiver: Waiver; evidence: Evidence }
  | { type: 'verification.coverage.updated'; sessionId: string; turnId: string; coverage: VerificationCoverage; gate: VerificationGateResult }
  | { type: 'review.completed'; sessionId: string; turnId: string; result: ReviewResult }
  | { type: 'evaluator.started'; sessionId: string; turnId: string; run: EvaluatorRun }
  | { type: 'evaluator.completed'; sessionId: string; turnId: string; run: EvaluatorRun }
  | { type: 'evaluator.failed'; sessionId: string; turnId: string; run: EvaluatorRun }
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
  | { type: 'hook.invoked'; sessionId: string; turnId: string; hook: AgentHookInvocation }
  | { type: 'skill.activated'; sessionId: string; turnId: string; activation: SkillActivation }
  | { type: 'plugin.loaded'; sessionId: string; activation: PluginActivation }
  | { type: 'mcp.server.started'; sessionId: string; state: McpServerState }
  | { type: 'mcp.server.completed'; sessionId: string; state: McpServerState }
  | { type: 'mcp.server.failed'; sessionId: string; state: McpServerState }
  | { type: 'mcp.server.stopped'; sessionId: string; state: McpServerState }
  | { type: 'mcp.tool.discovered'; sessionId: string; tool: McpToolDescriptor }
  | { type: 'subagent.started'; sessionId: string; turnId: string; run: SubagentRun }
  | { type: 'subagent.progress'; sessionId: string; turnId: string; runId: string; message: string; createdAt: number }
  | { type: 'subagent.completed'; sessionId: string; turnId: string; run: SubagentRun; result: SubagentResult }
  | { type: 'subagent.failed'; sessionId: string; turnId: string; run: SubagentRun; error: string }
  | { type: 'subagent.merged'; sessionId: string; turnId: string; merge: SubagentMergeResult }
  | { type: 'governance.audit.started'; sessionId: string; turnId?: string; reportId: string; createdAt: number }
  | { type: 'governance.audit.completed'; sessionId: string; turnId?: string; report: GovernanceAuditReport; createdAt: number }
  | { type: 'governance.audit.failed'; sessionId: string; turnId?: string; reportId: string; error: string; createdAt: number }
  | { type: 'eval.regression.reported'; sessionId: string; turnId?: string; report: EvalRegressionReport; createdAt: number }
  | { type: 'config.audit.completed'; sessionId: string; turnId?: string; findings: ConfigAuditFinding[]; createdAt: number }
  | { type: 'scaffold.cleanup.reported'; sessionId: string; turnId?: string; candidates: ScaffoldCleanupCandidate[]; createdAt: number }
  | { type: 'context.compaction.started'; sessionId: string; turnId?: string; task: CompactionTask }
  | { type: 'context.compacted'; sessionId: string; turnId?: string; task: CompactionTask; result: CompactionResult }
  | { type: 'context.compaction.failed'; sessionId: string; turnId?: string; task: CompactionTask; error: string }
  | { type: 'artifact.created'; sessionId: string; turnId?: string; artifact: ArtifactRef }
  | { type: 'runtime.process.updated'; sessionId: string; process: RuntimeProcessSummary }
  | { type: 'checkpoint.created'; sessionId: string; turnId?: string; checkpoint: CheckpointRef }
  | { type: 'sandbox.created'; sessionId: string; sandbox: ExecutionSandbox }
  | { type: 'sandbox.updated'; sessionId: string; sandbox: ExecutionSandbox }
  | { type: 'runtime.state.captured'; sessionId: string; turnId?: string; state: RuntimeStateArtifact; artifact: ArtifactRef }
  | { type: 'memory.created'; sessionId: string; entry: ProjectMemoryEntry }
  | { type: 'memory.updated'; sessionId: string; entry: ProjectMemoryEntry }
  | { type: 'memory.deleted'; sessionId: string; entryId: string; workspacePath: string }

export type AgentIpcResult<T> = { ok: true; value: T } | { ok: false; error: string }
