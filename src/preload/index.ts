import { contextBridge, ipcRenderer } from 'electron'
import type {
  AgentConfigSnapshot,
  AgentConfigUpdate,
  AgentContextSnapshot,
  AgentEvent,
  AgentIpcResult,
  AgentModelProfile,
  AgentModelProfileUpdate,
  AgentModelStoreSnapshot,
  AgentPermissionMode,
  AgentSession,
  AgentSessionSummary,
  AgentTurn,
  AgentWorkspaceLocation,
  ArtifactPayload,
  ArtifactRef,
  ApprovalDecision,
  CheckpointRef,
  CompactionResult,
  EditProposal,
  ExecutionSandbox,
  PlanConfirmation,
  RuntimeProcessSummary,
  RuntimeStateArtifact,
  TraceEvent,
  VerificationStatus,
} from '../shared/agent/protocol'

export interface RilleAPI {
  openFolder(): Promise<string | null>
  openFileDialog(): Promise<string | null>
  saveFileDialog(defaultPath?: string): Promise<string | null>
  newWindow(): Promise<void>
  exitApp(): Promise<void>
  readDirectory(dirPath: string, workspace?: WorkspaceLocation | null): Promise<FileEntry[]>
  readFile(filePath: string, workspace?: WorkspaceLocation | null): Promise<string>
  writeFile(filePath: string, content: string, workspace?: WorkspaceLocation | null): Promise<boolean>
  fileExists(filePath: string, workspace?: WorkspaceLocation | null): Promise<boolean>
  getFileInfo(filePath: string, workspace?: WorkspaceLocation | null): Promise<{ size: number; modifiedTime: number } | null>
  searchFiles(rootPath: string, query: string, options: SearchOptions, workspace?: WorkspaceLocation | null): Promise<SearchResult[]>
  gitStatus(rootPath: string, workspace?: WorkspaceLocation | null): Promise<GitStatusResult>
  gitStage(rootPath: string, filePath: string, workspace?: WorkspaceLocation | null): Promise<GitCommandResult>
  gitUnstage(rootPath: string, filePath: string, workspace?: WorkspaceLocation | null): Promise<GitCommandResult>
  gitCommit(rootPath: string, message: string, workspace?: WorkspaceLocation | null): Promise<GitCommandResult>
  gitFileDiff(rootPath: string, filePath: string, kind: GitFileDiffKind, workspace?: WorkspaceLocation | null): Promise<GitDiffResult>
  gitLog(rootPath: string, limit?: number, skip?: number, workspace?: WorkspaceLocation | null): Promise<GitLogResult>
  gitCommitFiles(rootPath: string, hash: string, workspace?: WorkspaceLocation | null): Promise<GitCommitFilesResult>
  gitCommitFileDiff(rootPath: string, hash: string, filePath: string, previousPath?: string, workspace?: WorkspaceLocation | null): Promise<GitDiffResult>
  gitCheckoutCommit(rootPath: string, hash: string, workspace?: WorkspaceLocation | null): Promise<GitCommandResult>
  gitCreateBranchFromCommit(rootPath: string, hash: string, branchName: string, workspace?: WorkspaceLocation | null): Promise<GitCommandResult>
  gitResetToCommit(rootPath: string, hash: string, mode: GitResetMode, workspace?: WorkspaceLocation | null): Promise<GitCommandResult>
  gitBranches(rootPath: string, workspace?: WorkspaceLocation | null): Promise<GitBranchesResult>
  gitSwitchBranch(rootPath: string, branchName: string, branchType: 'local' | 'remote', autoStash?: boolean, workspace?: WorkspaceLocation | null): Promise<GitOperationResult>
  gitCreateBranch(rootPath: string, branchName: string, startPoint?: string, checkout?: boolean, workspace?: WorkspaceLocation | null): Promise<GitOperationResult>
  gitDeleteBranch(rootPath: string, branchName: string, workspace?: WorkspaceLocation | null): Promise<GitOperationResult>
  gitFetch(rootPath: string, workspace?: WorkspaceLocation | null): Promise<GitOperationResult>
  gitPull(rootPath: string, autoStash?: boolean, workspace?: WorkspaceLocation | null): Promise<GitOperationResult>
  gitPush(rootPath: string, workspace?: WorkspaceLocation | null): Promise<GitOperationResult>
  gitMerge(rootPath: string, branchName: string, autoStash?: boolean, workspace?: WorkspaceLocation | null): Promise<GitOperationResult>
  gitRebase(rootPath: string, branchName: string, autoStash?: boolean, workspace?: WorkspaceLocation | null): Promise<GitOperationResult>
  gitAbortMerge(rootPath: string, workspace?: WorkspaceLocation | null): Promise<GitOperationResult>
  gitAbortRebase(rootPath: string, workspace?: WorkspaceLocation | null): Promise<GitOperationResult>
  gitStashList(rootPath: string, workspace?: WorkspaceLocation | null): Promise<GitStashListResult>
  gitStashPush(rootPath: string, message?: string, workspace?: WorkspaceLocation | null): Promise<GitOperationResult>
  gitStashApply(rootPath: string, stashRef: string, workspace?: WorkspaceLocation | null): Promise<GitOperationResult>
  gitStashPop(rootPath: string, stashRef: string, workspace?: WorkspaceLocation | null): Promise<GitOperationResult>
  gitStashDrop(rootPath: string, stashRef: string, workspace?: WorkspaceLocation | null): Promise<GitOperationResult>
  gitResolveCommitAvatars(rootPath: string, hashes: string[], workspace?: WorkspaceLocation | null): Promise<GitAvatarResult>
  outputList(): Promise<OutputEntry[]>
  outputClear(): Promise<void>
  onOutputEntry(callback: (entry: OutputEntry) => void): () => void
  onOutputCleared(callback: () => void): () => void
  terminalListProfiles(): Promise<TerminalProfile[]>
  remoteListTargets(): Promise<RemoteTarget[]>
  remoteListSshConfigs(): Promise<SshTargetConfig[]>
  remoteSaveSshConfig(config: Partial<SshTargetConfig>): Promise<SshTargetConfig>
  remoteDeleteSshConfig(id: string): Promise<boolean>
  remoteSelectIdentityFile(): Promise<string | null>
  remoteRespondAuthPrompt(requestId: string, response: { value?: string; cancelled?: boolean }): Promise<boolean>
  onRemoteAuthPrompt(callback: (request: RemoteAuthPromptRequest) => void): () => void
  remoteConnect(targetId: string, sshHost?: string): Promise<RemoteConnection>
  remoteDisconnect(connectionId: string): Promise<boolean>
  remoteListConnections(): Promise<RemoteConnection[]>
  remoteGetHome(connectionId: string): Promise<string>
  remoteOpenWorkspace(connectionId: string, remotePath: string): Promise<WorkspaceLocation>
  terminalCreate(cwd?: string, cols?: number, rows?: number, launchOptions?: TerminalLaunchOptions): Promise<TerminalSession>
  terminalWrite(id: string, data: string): Promise<void>
  terminalResize(id: string, cols: number, rows: number): Promise<void>
  terminalKill(id: string): Promise<void>
  onTerminalData(callback: (event: TerminalDataEvent) => void): () => void
  onTerminalExit(callback: (event: TerminalExitEvent) => void): () => void
  portsList(): Promise<PortEntry[]>
  portsKill(pid: number): Promise<PortOperationResult>
  debugStart(configuration: DebugConfiguration): Promise<DebugSessionState>
  debugStop(sessionId: string): Promise<PortOperationResult>
  debugSend(sessionId: string, command: string, args?: Record<string, unknown>): Promise<PortOperationResult>
  onDebugEvent(callback: (event: DebugEventPayload) => void): () => void
  openExternal(url: string): Promise<void>
  agentCreateSession(workspace: AgentWorkspaceLocation | null, permissionMode?: AgentPermissionMode): Promise<AgentSession>
  agentResumeSession(sessionId: string): Promise<AgentSession>
  agentResumeLastSession(workspace: AgentWorkspaceLocation | null): Promise<AgentSession | null>
  agentListSessions(): Promise<AgentSessionSummary[]>
  agentRenameSession(sessionId: string, title: string): Promise<AgentSession | null>
  agentArchiveSession(sessionId: string): Promise<AgentSession | null>
  agentUnarchiveSession(sessionId: string): Promise<AgentSession | null>
  agentDeleteSession(sessionId: string): Promise<boolean>
  agentReadArtifact(sessionId: string, artifactId: string): Promise<ArtifactPayload>
  agentListArtifacts(sessionId: string): Promise<ArtifactRef[]>
  agentListRuntimeProcesses(sessionId?: string): Promise<RuntimeProcessSummary[]>
  agentStopRuntimeProcess(processId: string): Promise<RuntimeProcessSummary>
  agentCreateCheckpoint(sessionId: string, workspace: AgentWorkspaceLocation, reason: string, turnId?: string): Promise<CheckpointRef>
  agentRestoreCheckpointAsProposal(sessionId: string, checkpointId: string, filePath?: string): Promise<EditProposal | EditProposal[]>
  agentCreateSandbox(sessionId: string, workspace: AgentWorkspaceLocation, reason?: string): Promise<ExecutionSandbox>
  agentDisposeSandbox(sessionId: string, sandboxId: string): Promise<ExecutionSandbox>
  agentSandboxDiffAsProposals(sessionId: string, sandboxId: string, turnId?: string): Promise<EditProposal[]>
  agentCaptureRuntimeState(sessionId: string, workspace?: AgentWorkspaceLocation | null, turnId?: string): Promise<RuntimeStateArtifact>
  agentSubmitTurn(sessionId: string, text: string, context: AgentContextSnapshot): Promise<AgentTurn>
  agentInterruptTurn(sessionId: string, turnId: string): Promise<AgentSession | null>
  agentConfirmPlan(sessionId: string, confirmationId: string): Promise<PlanConfirmation | AgentSession | null>
  agentRejectPlan(sessionId: string, confirmationId: string, reason?: string): Promise<PlanConfirmation | AgentSession | null>
  agentAddUserEvidence(sessionId: string, input: { turnId?: string; criterionId?: string; status?: VerificationStatus; summary: string; output?: string; artifactId?: string }): Promise<AgentSession | null>
  agentAddBrowserEvidence(sessionId: string, input: { turnId?: string; criterionId?: string; url: string; title?: string; status?: VerificationStatus; summary: string; screenshotArtifactId?: string; domExcerptArtifactId?: string }): Promise<AgentSession | null>
  agentWaiveEvidence(sessionId: string, input: { turnId?: string; criterionId?: string; evidenceIds?: string[]; reason: string; scope?: 'criterion' | 'evidence' | 'turn'; expiresAt?: number }): Promise<AgentSession | null>
  agentAcceptReviewRisk(sessionId: string, findingId: string, reason: string, turnId?: string): Promise<AgentSession | null>
  agentDismissReviewFinding(sessionId: string, findingId: string, reason?: string, turnId?: string): Promise<AgentSession | null>
  agentCompactContext(sessionId: string, turnId?: string, reason?: string): Promise<CompactionResult>
  agentExportTrace(sessionId: string, redacted?: boolean): Promise<TraceEvent[]>
  agentRespondApproval(requestId: string, decision: ApprovalDecision): Promise<boolean>
  agentUpdatePermission(sessionId: string, permissionMode: AgentPermissionMode): Promise<AgentSession | null>
  agentApplyEdit(sessionId: string, proposalId: string, context?: AgentContextSnapshot): Promise<EditProposal>
  agentRejectEdit(sessionId: string, proposalId: string, reason?: string): Promise<EditProposal | AgentSession | null>
  agentRollbackEdit(sessionId: string, proposalId: string): Promise<EditProposal | AgentSession | null>
  agentGetConfig(): Promise<AgentConfigSnapshot>
  agentSaveConfig(update: AgentConfigUpdate): Promise<AgentConfigSnapshot>
  agentListModelProfiles(): Promise<AgentModelStoreSnapshot>
  agentSaveModelProfile(update: AgentModelProfileUpdate): Promise<AgentModelProfile>
  agentSelectModelProfile(profileId: string): Promise<AgentConfigSnapshot>
  agentDeleteModelProfile(profileId: string): Promise<AgentModelStoreSnapshot>
  agentTestProvider(profileId?: string): Promise<{ success: boolean; message: string }>
  onAgentEvent(callback: (event: AgentEvent) => void): () => void
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[]
}

export interface SearchOptions {
  caseSensitive: boolean
  includeDependencies: boolean
}

export interface SearchResult {
  filePath: string
  line: number
  column: number
  preview: string
}

export interface GitStatusResult {
  isRepo: boolean
  repoRoot: string
  branch: string
  remoteName?: string
  staged: string[]
  unstaged: string[]
  untracked: string[]
  operationState?: GitOperationState
  error?: string
}

export interface GitCommandResult {
  success: boolean
  error?: string
}

export interface GitOperationState {
  mergeInProgress: boolean
  rebaseInProgress: boolean
}

export interface GitOperationResult extends GitCommandResult {
  output?: string
  didAutoStash?: boolean
  stashPopError?: string
  needsResolution?: boolean
  operationState?: GitOperationState
}

export type GitFileDiffKind = 'staged' | 'unstaged' | 'untracked'
export type GitResetMode = 'soft' | 'mixed' | 'hard'

export interface GitDiffResult {
  success: boolean
  filePath: string
  original: string
  modified: string
  originalLabel: string
  modifiedLabel: string
  isBinary?: boolean
  error?: string
}

export interface GitCommit {
  hash: string
  shortHash: string
  author: string
  email: string
  date: string
  subject: string
  body: string
  stats: string
  parents: string[]
  avatarUrl?: string
  avatarSource?: 'github' | 'gravatar' | 'fallback'
  githubLogin?: string
}

export interface GitLogResult {
  success: boolean
  commits: GitCommit[]
  error?: string
}

export interface GitCommitFile {
  path: string
  previousPath?: string
  status: string
}

export interface GitCommitFilesResult {
  success: boolean
  files: GitCommitFile[]
  error?: string
}

export interface GitBranch {
  name: string
  fullName: string
  type: 'local' | 'remote'
  current: boolean
  upstream?: string
  remote?: string
  hash?: string
}

export interface GitBranchesResult {
  success: boolean
  current: string
  branches: GitBranch[]
  operationState: GitOperationState
  error?: string
}

export interface GitStashEntry {
  ref: string
  index: number
  hash: string
  message: string
}

export interface GitStashListResult {
  success: boolean
  stashes: GitStashEntry[]
  error?: string
}

export interface GitAvatarInfo {
  avatarUrl?: string
  avatarSource?: 'github' | 'gravatar' | 'fallback'
  githubLogin?: string
}

export interface GitAvatarResult {
  success: boolean
  avatars: Record<string, GitAvatarInfo>
  error?: string
}

export type OutputChannel = 'Git' | 'Terminal' | 'Debug' | 'Ports' | 'System'
export type OutputLevel = 'info' | 'warning' | 'error'

export interface OutputEntry {
  id: string
  timestamp: string
  channel: OutputChannel
  level: OutputLevel
  message: string
  details?: string
}

export interface TerminalProfile {
  id: string
  label: string
  path: string
  args?: string[]
  source: 'detected' | 'fallback'
  kind: 'local' | 'wsl' | 'ssh'
  isDefault?: boolean
}

export interface WorkspaceLocation {
  kind: 'local' | 'ssh' | 'wsl' | 'worktree'
  path: string
  label: string
  connectionId?: string
  targetId?: string
  origin?: WorkspaceLocation
  sandboxId?: string
}

export interface RemoteConnection {
  id: string
  targetId: string
  kind: 'ssh' | 'wsl'
  label: string
  home: string
  status: 'connecting' | 'connected' | 'error'
  error?: string
}

export type SshAuthMethod = 'sshConfigOrAgent' | 'password' | 'identityFile' | 'identityFileWithPassphrase'

export interface SshTargetConfig {
  id: string
  alias: string
  hostName: string
  user?: string
  port?: number
  authMethod: SshAuthMethod
  identityFile?: string
  proxyJump?: string
  extraOptions?: string
  defaultRemotePath?: string
}

export interface RemoteAuthPromptRequest {
  requestId: string
  prompt: string
  kind: 'password' | 'confirmation' | 'text'
}

export interface TerminalLaunchOptions {
  profileId?: string
  sshHost?: string
  workspace?: WorkspaceLocation | null
}

export interface RemoteTarget {
  id: string
  kind: 'ssh' | 'wsl'
  label: string
  profileId: string
  host?: string
  distro?: string
  source: 'detected' | 'configured' | 'ssh-config' | 'wsl'
  sshConfigId?: string
  sshConfig?: SshTargetConfig
  defaultRemotePath?: string
}

export interface TerminalSession {
  id: string
  cwd: string
  shell: string
  profileId: string
  name: string
  workspace?: WorkspaceLocation | null
}

export interface PortEntry {
  id: string
  protocol: string
  address: string
  port: number
  pid: number
  processName?: string
}

export interface PortOperationResult {
  success: boolean
  error?: string
}

export interface DebugBreakpoint {
  sourcePath: string
  lines: number[]
}

export interface DebugConfiguration {
  name: string
  adapterCommand: string
  adapterArgs?: string[]
  cwd?: string
  launch?: Record<string, unknown>
  breakpoints?: DebugBreakpoint[]
}

export interface DebugSessionState {
  id: string
  status: 'starting' | 'running' | 'paused' | 'stopped' | 'error'
  name: string
  error?: string
}

export interface DebugEventPayload {
  sessionId: string
  type: 'state' | 'output' | 'message' | 'error'
  state?: DebugSessionState
  message?: string
  body?: Record<string, unknown>
}

export interface TerminalDataEvent {
  id: string
  data: string
}

export interface TerminalExitEvent {
  id: string
  exitCode: number
}


type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

function isIpcResult<T>(value: unknown): value is IpcResult<T> {
  return Boolean(value && typeof value === 'object' && 'ok' in value)
}

function unwrapIpcResult<T>(value: T | IpcResult<T>): T {
  if (!isIpcResult<T>(value)) return value as T
  if (value.ok) return value.value
  throw new Error(value.error)
}

async function invokeRemote<T>(channel: string, ...args: unknown[]): Promise<T> {
  return unwrapIpcResult<T>(await ipcRenderer.invoke(channel, ...args))
}

async function invokeAgent<T>(channel: string, ...args: unknown[]): Promise<T> {
  return unwrapIpcResult<T>(await ipcRenderer.invoke(channel, ...args) as AgentIpcResult<T>)
}

const api: RilleAPI = {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFileDialog: (defaultPath) => ipcRenderer.invoke('dialog:saveFile', defaultPath),
  newWindow: () => ipcRenderer.invoke('app:newWindow'),
  exitApp: () => ipcRenderer.invoke('app:exit'),
  readDirectory: (path, workspace) => ipcRenderer.invoke('fs:readDirectory', path, workspace),
  readFile: (path, workspace) => ipcRenderer.invoke('fs:readFile', path, workspace),
  writeFile: (path, content, workspace) => ipcRenderer.invoke('fs:writeFile', path, content, workspace),
  fileExists: (path, workspace) => ipcRenderer.invoke('fs:fileExists', path, workspace),
  getFileInfo: (path, workspace) => ipcRenderer.invoke('fs:getFileInfo', path, workspace),
  searchFiles: (rootPath, query, options, workspace) => ipcRenderer.invoke('search:files', rootPath, query, options, workspace),
  gitStatus: (rootPath, workspace) => ipcRenderer.invoke('git:status', rootPath, workspace),
  gitStage: (rootPath, filePath, workspace) => ipcRenderer.invoke('git:stage', rootPath, filePath, workspace),
  gitUnstage: (rootPath, filePath, workspace) => ipcRenderer.invoke('git:unstage', rootPath, filePath, workspace),
  gitCommit: (rootPath, message, workspace) => ipcRenderer.invoke('git:commit', rootPath, message, workspace),
  gitFileDiff: (rootPath, filePath, kind, workspace) => ipcRenderer.invoke('git:fileDiff', rootPath, filePath, kind, workspace),
  gitLog: (rootPath, limit, skip, workspace) => ipcRenderer.invoke('git:log', rootPath, limit, skip, workspace),
  gitCommitFiles: (rootPath, hash, workspace) => ipcRenderer.invoke('git:commitFiles', rootPath, hash, workspace),
  gitCommitFileDiff: (rootPath, hash, filePath, previousPath, workspace) => ipcRenderer.invoke('git:commitFileDiff', rootPath, hash, filePath, previousPath, workspace),
  gitCheckoutCommit: (rootPath, hash, workspace) => ipcRenderer.invoke('git:checkoutCommit', rootPath, hash, workspace),
  gitCreateBranchFromCommit: (rootPath, hash, branchName, workspace) => ipcRenderer.invoke('git:createBranchFromCommit', rootPath, hash, branchName, workspace),
  gitResetToCommit: (rootPath, hash, mode, workspace) => ipcRenderer.invoke('git:resetToCommit', rootPath, hash, mode, workspace),
  gitBranches: (rootPath, workspace) => ipcRenderer.invoke('git:branches', rootPath, workspace),
  gitSwitchBranch: (rootPath, branchName, branchType, autoStash, workspace) => ipcRenderer.invoke('git:switchBranch', rootPath, branchName, branchType, autoStash, workspace),
  gitCreateBranch: (rootPath, branchName, startPoint, checkout, workspace) => ipcRenderer.invoke('git:createBranch', rootPath, branchName, startPoint, checkout, workspace),
  gitDeleteBranch: (rootPath, branchName, workspace) => ipcRenderer.invoke('git:deleteBranch', rootPath, branchName, workspace),
  gitFetch: (rootPath, workspace) => ipcRenderer.invoke('git:fetch', rootPath, workspace),
  gitPull: (rootPath, autoStash, workspace) => ipcRenderer.invoke('git:pull', rootPath, autoStash, workspace),
  gitPush: (rootPath, workspace) => ipcRenderer.invoke('git:push', rootPath, workspace),
  gitMerge: (rootPath, branchName, autoStash, workspace) => ipcRenderer.invoke('git:merge', rootPath, branchName, autoStash, workspace),
  gitRebase: (rootPath, branchName, autoStash, workspace) => ipcRenderer.invoke('git:rebase', rootPath, branchName, autoStash, workspace),
  gitAbortMerge: (rootPath, workspace) => ipcRenderer.invoke('git:abortMerge', rootPath, workspace),
  gitAbortRebase: (rootPath, workspace) => ipcRenderer.invoke('git:abortRebase', rootPath, workspace),
  gitStashList: (rootPath, workspace) => ipcRenderer.invoke('git:stashList', rootPath, workspace),
  gitStashPush: (rootPath, message, workspace) => ipcRenderer.invoke('git:stashPush', rootPath, message, workspace),
  gitStashApply: (rootPath, stashRef, workspace) => ipcRenderer.invoke('git:stashApply', rootPath, stashRef, workspace),
  gitStashPop: (rootPath, stashRef, workspace) => ipcRenderer.invoke('git:stashPop', rootPath, stashRef, workspace),
  gitStashDrop: (rootPath, stashRef, workspace) => ipcRenderer.invoke('git:stashDrop', rootPath, stashRef, workspace),
  gitResolveCommitAvatars: (rootPath, hashes, workspace) => ipcRenderer.invoke('git:resolveCommitAvatars', rootPath, hashes, workspace),
  outputList: () => ipcRenderer.invoke('output:list'),
  outputClear: () => ipcRenderer.invoke('output:clear'),
  onOutputEntry: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: OutputEntry) => callback(entry)
    ipcRenderer.on('output:entry', listener)
    return () => ipcRenderer.removeListener('output:entry', listener)
  },
  onOutputCleared: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('output:cleared', listener)
    return () => ipcRenderer.removeListener('output:cleared', listener)
  },
  terminalListProfiles: () => ipcRenderer.invoke('terminal:listProfiles'),
  remoteListTargets: () => ipcRenderer.invoke('remote:listTargets'),
  remoteListSshConfigs: () => ipcRenderer.invoke('remote:listSshConfigs'),
  remoteSaveSshConfig: (config) => invokeRemote<SshTargetConfig>('remote:saveSshConfig', config),
  remoteDeleteSshConfig: (id) => invokeRemote<boolean>('remote:deleteSshConfig', id),
  remoteSelectIdentityFile: () => invokeRemote<string | null>('remote:selectIdentityFile'),
  remoteRespondAuthPrompt: (requestId, response) => ipcRenderer.invoke('remote:respondAuthPrompt', requestId, response),
  onRemoteAuthPrompt: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, request: RemoteAuthPromptRequest) => callback(request)
    ipcRenderer.on('remote:authPrompt', listener)
    return () => ipcRenderer.removeListener('remote:authPrompt', listener)
  },
  remoteConnect: (targetId, sshHost) => invokeRemote<RemoteConnection>('remote:connect', targetId, sshHost),
  remoteDisconnect: (connectionId) => ipcRenderer.invoke('remote:disconnect', connectionId),
  remoteListConnections: () => ipcRenderer.invoke('remote:listConnections'),
  remoteGetHome: (connectionId) => invokeRemote<string>('remote:getHome', connectionId),
  remoteOpenWorkspace: (connectionId, remotePath) => invokeRemote<WorkspaceLocation>('remote:openWorkspace', connectionId, remotePath),
  terminalCreate: (cwd, cols, rows, launchOptions) => ipcRenderer.invoke('terminal:create', cwd, cols, rows, launchOptions),
  terminalWrite: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  terminalResize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  terminalKill: (id) => ipcRenderer.invoke('terminal:kill', id),
  onTerminalData: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: TerminalDataEvent) => callback(data)
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },
  onTerminalExit: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: TerminalExitEvent) => callback(data)
    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  },
  portsList: () => ipcRenderer.invoke('ports:list'),
  portsKill: (pid) => ipcRenderer.invoke('ports:kill', pid),
  debugStart: (configuration) => ipcRenderer.invoke('debug:start', configuration),
  debugStop: (sessionId) => ipcRenderer.invoke('debug:stop', sessionId),
  debugSend: (sessionId, command, args) => ipcRenderer.invoke('debug:send', sessionId, command, args),
  onDebugEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: DebugEventPayload) => callback(data)
    ipcRenderer.on('debug:event', listener)
    return () => ipcRenderer.removeListener('debug:event', listener)
  },
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  agentCreateSession: (workspace, permissionMode) => invokeAgent<AgentSession>('agent:createSession', { type: 'session.create', workspace, permissionMode }),
  agentResumeSession: (sessionId) => invokeAgent<AgentSession>('agent:resumeSession', { type: 'session.resume', sessionId }),
  agentResumeLastSession: (workspace) => invokeAgent<AgentSession | null>('agent:resumeLastSession', { type: 'session.resumeLast', workspace }),
  agentListSessions: () => invokeAgent<AgentSessionSummary[]>('agent:listSessions', { type: 'session.list' }),
  agentRenameSession: (sessionId, title) => invokeAgent<AgentSession | null>('agent:dispatch', { type: 'session.rename', sessionId, title }),
  agentArchiveSession: (sessionId) => invokeAgent<AgentSession | null>('agent:dispatch', { type: 'session.archive', sessionId }),
  agentUnarchiveSession: (sessionId) => invokeAgent<AgentSession | null>('agent:dispatch', { type: 'session.unarchive', sessionId }),
  agentDeleteSession: (sessionId) => invokeAgent<boolean>('agent:dispatch', { type: 'session.delete', sessionId }),
  agentReadArtifact: (sessionId, artifactId) => invokeAgent<ArtifactPayload>('agent:dispatch', { type: 'artifact.read', sessionId, artifactId }),
  agentListArtifacts: (sessionId) => invokeAgent<ArtifactRef[]>('agent:dispatch', { type: 'artifact.list', sessionId }),
  agentListRuntimeProcesses: (sessionId) => invokeAgent<RuntimeProcessSummary[]>('agent:dispatch', { type: 'runtime.process.list', sessionId }),
  agentStopRuntimeProcess: (processId) => invokeAgent<RuntimeProcessSummary>('agent:dispatch', { type: 'runtime.process.stop', processId }),
  agentCreateCheckpoint: (sessionId, workspace, reason, turnId) => invokeAgent<CheckpointRef>('agent:dispatch', { type: 'checkpoint.create', sessionId, workspace, reason, turnId }),
  agentRestoreCheckpointAsProposal: (sessionId, checkpointId, filePath) => invokeAgent<EditProposal | EditProposal[]>('agent:dispatch', { type: 'checkpoint.restoreAsProposal', sessionId, checkpointId, filePath }),
  agentCreateSandbox: (sessionId, workspace, reason) => invokeAgent<ExecutionSandbox>('agent:dispatch', { type: 'sandbox.create', sessionId, workspace, reason }),
  agentDisposeSandbox: (sessionId, sandboxId) => invokeAgent<ExecutionSandbox>('agent:dispatch', { type: 'sandbox.dispose', sessionId, sandboxId }),
  agentSandboxDiffAsProposals: (sessionId, sandboxId, turnId) => invokeAgent<EditProposal[]>('agent:dispatch', { type: 'sandbox.diffAsProposals', sessionId, sandboxId, turnId }),
  agentCaptureRuntimeState: (sessionId, workspace, turnId) => invokeAgent<RuntimeStateArtifact>('agent:dispatch', { type: 'runtime.state.capture', sessionId, workspace, turnId }),
  agentSubmitTurn: (sessionId, text, context) => invokeAgent<AgentTurn>('agent:submitTurn', { type: 'turn.submit', sessionId, text, context }),
  agentInterruptTurn: (sessionId, turnId) => invokeAgent<AgentSession | null>('agent:dispatch', { type: 'turn.interrupt', sessionId, turnId }),
  agentConfirmPlan: (sessionId, confirmationId) => invokeAgent<PlanConfirmation | AgentSession | null>('agent:dispatch', { type: 'plan.confirm', sessionId, confirmationId }),
  agentRejectPlan: (sessionId, confirmationId, reason) => invokeAgent<PlanConfirmation | AgentSession | null>('agent:dispatch', { type: 'plan.reject', sessionId, confirmationId, reason }),
  agentAddUserEvidence: (sessionId, input) => invokeAgent<AgentSession | null>('agent:dispatch', { type: 'evidence.user.add', sessionId, ...input }),
  agentAddBrowserEvidence: (sessionId, input) => invokeAgent<AgentSession | null>('agent:dispatch', { type: 'evidence.browser.add', sessionId, ...input }),
  agentWaiveEvidence: (sessionId, input) => invokeAgent<AgentSession | null>('agent:dispatch', { type: 'evidence.waive', sessionId, ...input }),
  agentAcceptReviewRisk: (sessionId, findingId, reason, turnId) => invokeAgent<AgentSession | null>('agent:dispatch', { type: 'review.acceptRisk', sessionId, findingId, reason, turnId }),
  agentDismissReviewFinding: (sessionId, findingId, reason, turnId) => invokeAgent<AgentSession | null>('agent:dispatch', { type: 'review.dismissFinding', sessionId, findingId, reason, turnId }),
  agentCompactContext: (sessionId, turnId, reason) => invokeAgent<CompactionResult>('agent:dispatch', { type: 'context.compact', sessionId, turnId, reason }),
  agentExportTrace: async (sessionId, redacted) => {
    const result = await invokeAgent<{ traceEvents: TraceEvent[] }>('agent:dispatch', { type: 'trace.export', sessionId, redacted })
    return result.traceEvents
  },
  agentRespondApproval: (requestId, decision) => invokeAgent<boolean>('agent:dispatch', { type: 'approval.respond', requestId, decision }),
  agentUpdatePermission: (sessionId, permissionMode) => invokeAgent<AgentSession | null>('agent:dispatch', { type: 'permission.update', sessionId, permissionMode }),
  agentApplyEdit: (sessionId, proposalId, context) => invokeAgent<EditProposal>('agent:dispatch', { type: 'edit.apply', sessionId, proposalId, context }),
  agentRejectEdit: (sessionId, proposalId, reason) => invokeAgent<EditProposal | AgentSession | null>('agent:dispatch', { type: 'edit.reject', sessionId, proposalId, reason }),
  agentRollbackEdit: (sessionId, proposalId) => invokeAgent<EditProposal | AgentSession | null>('agent:dispatch', { type: 'edit.rollback', sessionId, proposalId }),
  agentGetConfig: () => invokeAgent<AgentConfigSnapshot>('agent:getConfig'),
  agentSaveConfig: (update) => invokeAgent<AgentConfigSnapshot>('agent:saveConfig', update),
  agentListModelProfiles: () => invokeAgent<AgentModelStoreSnapshot>('agent:listModelProfiles'),
  agentSaveModelProfile: (update) => invokeAgent<AgentModelProfile>('agent:saveModelProfile', update),
  agentSelectModelProfile: (profileId) => invokeAgent<AgentConfigSnapshot>('agent:selectModelProfile', profileId),
  agentDeleteModelProfile: (profileId) => invokeAgent<AgentModelStoreSnapshot>('agent:deleteModelProfile', profileId),
  agentTestProvider: (profileId) => invokeAgent<{ success: boolean; message: string }>('agent:testProvider', profileId),
  onAgentEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, event: AgentEvent) => callback(event)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
}

contextBridge.exposeInMainWorld('rille', api)
