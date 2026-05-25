/// <reference types="vite/client" />
import type {
  AgentConfigSnapshot,
  AgentConfigUpdate,
  AgentContextSnapshot,
  AgentEvent,
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
  EditProposal,
  ExecutionSandbox,
  PlanConfirmation,
  RuntimeProcessSummary,
  RuntimeStateArtifact,
} from '../shared/agent/protocol'

export {}

declare global {
  interface FileEntry {
    name: string
    path: string
    isDirectory: boolean
    children?: FileEntry[]
  }

  interface SearchOptions {
    caseSensitive: boolean
    includeDependencies: boolean
  }

  interface SearchResult {
    filePath: string
    line: number
    column: number
    preview: string
  }

  interface GitStatusResult {
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

  interface GitCommandResult {
    success: boolean
    error?: string
  }

  interface GitOperationState {
    mergeInProgress: boolean
    rebaseInProgress: boolean
  }

  interface GitOperationResult extends GitCommandResult {
    output?: string
    didAutoStash?: boolean
    stashPopError?: string
    needsResolution?: boolean
    operationState?: GitOperationState
  }

  type GitFileDiffKind = 'staged' | 'unstaged' | 'untracked'
  type GitResetMode = 'soft' | 'mixed' | 'hard'

  interface GitDiffResult {
    success: boolean
    filePath: string
    original: string
    modified: string
    originalLabel: string
    modifiedLabel: string
    isBinary?: boolean
    error?: string
  }

  interface GitCommit {
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

  interface GitLogResult {
    success: boolean
    commits: GitCommit[]
    error?: string
  }

  interface GitCommitFile {
    path: string
    previousPath?: string
    status: string
  }

  interface GitCommitFilesResult {
    success: boolean
    files: GitCommitFile[]
    error?: string
  }

  interface GitBranch {
    name: string
    fullName: string
    type: 'local' | 'remote'
    current: boolean
    upstream?: string
    remote?: string
    hash?: string
  }

  interface GitBranchesResult {
    success: boolean
    current: string
    branches: GitBranch[]
    operationState: GitOperationState
    error?: string
  }

  interface GitStashEntry {
    ref: string
    index: number
    hash: string
    message: string
  }

  interface GitStashListResult {
    success: boolean
    stashes: GitStashEntry[]
    error?: string
  }

  interface GitAvatarInfo {
    avatarUrl?: string
    avatarSource?: 'github' | 'gravatar' | 'fallback'
    githubLogin?: string
  }

  interface GitAvatarResult {
    success: boolean
    avatars: Record<string, GitAvatarInfo>
    error?: string
  }

  type OutputChannel = 'Git' | 'Terminal' | 'Debug' | 'Ports' | 'System'
  type OutputLevel = 'info' | 'warning' | 'error'

  interface OutputEntry {
    id: string
    timestamp: string
    channel: OutputChannel
    level: OutputLevel
    message: string
    details?: string
  }

  interface TerminalProfile {
    id: string
    label: string
    path: string
    args?: string[]
    source: 'detected' | 'fallback'
    kind: 'local' | 'wsl' | 'ssh'
    isDefault?: boolean
  }

  interface WorkspaceLocation {
    kind: 'local' | 'ssh' | 'wsl' | 'worktree'
    path: string
    label: string
    connectionId?: string
    targetId?: string
    origin?: WorkspaceLocation
    sandboxId?: string
  }

  interface RemoteConnection {
    id: string
    targetId: string
    kind: 'ssh' | 'wsl'
    label: string
    home: string
    status: 'connecting' | 'connected' | 'error'
    error?: string
  }

  type SshAuthMethod = 'sshConfigOrAgent' | 'password' | 'identityFile' | 'identityFileWithPassphrase'

  interface SshTargetConfig {
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

  interface RemoteAuthPromptRequest {
    requestId: string
    prompt: string
    kind: 'password' | 'confirmation' | 'text'
  }

  interface TerminalLaunchOptions {
    profileId?: string
    sshHost?: string
    workspace?: WorkspaceLocation | null
  }

  interface RemoteTarget {
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

  interface TerminalSession {
    id: string
    cwd: string
    shell: string
    profileId: string
    name: string
    workspace?: WorkspaceLocation | null
  }

  interface PortEntry {
    id: string
    protocol: string
    address: string
    port: number
    pid: number
    processName?: string
  }

  interface PortOperationResult {
    success: boolean
    error?: string
  }

  interface DebugBreakpoint {
    sourcePath: string
    lines: number[]
  }

  interface DebugConfiguration {
    name: string
    adapterCommand: string
    adapterArgs?: string[]
    cwd?: string
    launch?: Record<string, unknown>
    breakpoints?: DebugBreakpoint[]
  }

  interface DebugSessionState {
    id: string
    status: 'starting' | 'running' | 'paused' | 'stopped' | 'error'
    name: string
    error?: string
  }

  interface DebugEventPayload {
    sessionId: string
    type: 'state' | 'output' | 'message' | 'error'
    state?: DebugSessionState
    message?: string
    body?: Record<string, unknown>
  }

  interface TerminalDataEvent {
    id: string
    data: string
  }

  interface TerminalExitEvent {
    id: string
    exitCode: number
  }

  interface RilleAPI {
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

  interface Window {
    rille: RilleAPI
  }
}
