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

export type VerificationStatus = 'passed' | 'failed' | 'skipped'

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
  | { id: string; messageId: string; type: 'tool'; call: ToolCallView; state: ToolState; output?: ToolResultView; createdAt: number }
  | { id: string; messageId: string; type: 'file'; filePath: string; range?: AgentTextRange; label: string; createdAt: number }
  | { id: string; messageId: string; type: 'diff'; proposalId: string; title: string; state: EditProposal['state']; createdAt: number }
  | { id: string; messageId: string; type: 'diagnostic'; diagnostics: AgentDiagnostic[]; createdAt: number }
  | { id: string; messageId: string; type: 'verification'; result: VerificationResult; createdAt: number }
  | { id: string; messageId: string; type: 'edit_result'; proposalId: string; state: EditProposal['state']; filePath: string; message: string; createdAt: number }

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
  | { type: 'turn.submit'; sessionId: string; text: string; context: AgentContextSnapshot }
  | { type: 'turn.interrupt'; sessionId: string; turnId: string }
  | { type: 'approval.respond'; requestId: string; decision: ApprovalDecision }
  | { type: 'edit.apply'; sessionId: string; proposalId: string }
  | { type: 'edit.reject'; sessionId: string; proposalId: string; reason?: string }
  | { type: 'edit.rollback'; sessionId: string; proposalId: string }
  | { type: 'permission.update'; sessionId: string; permissionMode: AgentPermissionMode }

export type AgentEvent =
  | { type: 'session.created'; session: AgentSession }
  | { type: 'session.updated'; session: AgentSession }
  | { type: 'turn.started'; sessionId: string; turn: AgentTurn }
  | { type: 'turn.stage'; sessionId: string; turnId: string; stage: AgentRunStage; detail?: string }
  | { type: 'message.part.created'; sessionId: string; turnId?: string; part: MessagePart }
  | { type: 'message.part.updated'; sessionId: string; turnId?: string; part: MessagePart }
  | { type: 'tool.started'; sessionId: string; turnId: string; call: ToolCallView }
  | { type: 'tool.completed'; sessionId: string; turnId: string; callId: string; result: ToolResultView }
  | { type: 'approval.requested'; sessionId: string; turnId: string; request: ApprovalRequest }
  | { type: 'approval.resolved'; sessionId: string; turnId: string; requestId: string; decision: ApprovalDecision }
  | { type: 'edit.proposed'; sessionId: string; turnId: string; proposal: EditProposal }
  | { type: 'diagnostics.updated'; sessionId: string; diagnostics: AgentDiagnostic[] }
  | { type: 'verification.started'; sessionId: string; turnId: string; verifier: VerificationResult['verifier']; command?: string }
  | { type: 'verification.completed'; sessionId: string; turnId: string; result: VerificationResult }
  | { type: 'turn.completed'; sessionId: string; turnId: string; reason: TurnStopReason }
  | { type: 'turn.failed'; sessionId: string; turnId: string; reason: TurnStopReason; error: string }

export type AgentIpcResult<T> = { ok: true; value: T } | { ok: false; error: string }
