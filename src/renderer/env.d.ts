/// <reference types="vite/client" />

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

  interface TerminalLaunchOptions {
    profileId?: string
    sshHost?: string
  }

  interface RemoteTarget {
    id: string
    kind: 'ssh' | 'wsl'
    label: string
    profileId: string
    host?: string
    distro?: string
    source: 'detected' | 'ssh-config' | 'wsl'
  }

  interface TerminalSession {
    id: string
    cwd: string
    shell: string
    profileId: string
    name: string
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
    readDirectory(dirPath: string): Promise<FileEntry[]>
    readFile(filePath: string): Promise<string>
    writeFile(filePath: string, content: string): Promise<boolean>
    fileExists(filePath: string): Promise<boolean>
    getFileInfo(filePath: string): Promise<{ size: number; modifiedTime: number } | null>
    searchFiles(rootPath: string, query: string, options: SearchOptions): Promise<SearchResult[]>
    gitStatus(rootPath: string): Promise<GitStatusResult>
    gitStage(rootPath: string, filePath: string): Promise<GitCommandResult>
    gitUnstage(rootPath: string, filePath: string): Promise<GitCommandResult>
    gitCommit(rootPath: string, message: string): Promise<GitCommandResult>
    gitFileDiff(rootPath: string, filePath: string, kind: GitFileDiffKind): Promise<GitDiffResult>
    gitLog(rootPath: string, limit?: number, skip?: number): Promise<GitLogResult>
    gitCommitFiles(rootPath: string, hash: string): Promise<GitCommitFilesResult>
    gitCommitFileDiff(rootPath: string, hash: string, filePath: string, previousPath?: string): Promise<GitDiffResult>
    gitCheckoutCommit(rootPath: string, hash: string): Promise<GitCommandResult>
    gitCreateBranchFromCommit(rootPath: string, hash: string, branchName: string): Promise<GitCommandResult>
    gitResetToCommit(rootPath: string, hash: string, mode: GitResetMode): Promise<GitCommandResult>
    gitBranches(rootPath: string): Promise<GitBranchesResult>
    gitSwitchBranch(rootPath: string, branchName: string, branchType: 'local' | 'remote', autoStash?: boolean): Promise<GitOperationResult>
    gitCreateBranch(rootPath: string, branchName: string, startPoint?: string, checkout?: boolean): Promise<GitOperationResult>
    gitDeleteBranch(rootPath: string, branchName: string): Promise<GitOperationResult>
    gitFetch(rootPath: string): Promise<GitOperationResult>
    gitPull(rootPath: string, autoStash?: boolean): Promise<GitOperationResult>
    gitPush(rootPath: string): Promise<GitOperationResult>
    gitMerge(rootPath: string, branchName: string, autoStash?: boolean): Promise<GitOperationResult>
    gitRebase(rootPath: string, branchName: string, autoStash?: boolean): Promise<GitOperationResult>
    gitAbortMerge(rootPath: string): Promise<GitOperationResult>
    gitAbortRebase(rootPath: string): Promise<GitOperationResult>
    gitStashList(rootPath: string): Promise<GitStashListResult>
    gitStashPush(rootPath: string, message?: string): Promise<GitOperationResult>
    gitStashApply(rootPath: string, stashRef: string): Promise<GitOperationResult>
    gitStashPop(rootPath: string, stashRef: string): Promise<GitOperationResult>
    gitStashDrop(rootPath: string, stashRef: string): Promise<GitOperationResult>
    gitResolveCommitAvatars(rootPath: string, hashes: string[]): Promise<GitAvatarResult>
    outputList(): Promise<OutputEntry[]>
    outputClear(): Promise<void>
    onOutputEntry(callback: (entry: OutputEntry) => void): () => void
    onOutputCleared(callback: () => void): () => void
    terminalListProfiles(): Promise<TerminalProfile[]>
    remoteListTargets(): Promise<RemoteTarget[]>
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
  }

  interface Window {
    rille: RilleAPI
  }
}
