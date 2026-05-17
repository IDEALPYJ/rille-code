import { contextBridge, ipcRenderer } from 'electron'

export interface RilleAPI {
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

export interface TerminalLaunchOptions {
  profileId?: string
  sshHost?: string
}

export interface RemoteTarget {
  id: string
  kind: 'ssh' | 'wsl'
  label: string
  profileId: string
  host?: string
  distro?: string
  source: 'detected' | 'ssh-config' | 'wsl'
}

export interface TerminalSession {
  id: string
  cwd: string
  shell: string
  profileId: string
  name: string
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

const api: RilleAPI = {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  saveFileDialog: (defaultPath) => ipcRenderer.invoke('dialog:saveFile', defaultPath),
  newWindow: () => ipcRenderer.invoke('app:newWindow'),
  exitApp: () => ipcRenderer.invoke('app:exit'),
  readDirectory: (path) => ipcRenderer.invoke('fs:readDirectory', path),
  readFile: (path) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path, content) => ipcRenderer.invoke('fs:writeFile', path, content),
  fileExists: (path) => ipcRenderer.invoke('fs:fileExists', path),
  getFileInfo: (path) => ipcRenderer.invoke('fs:getFileInfo', path),
  searchFiles: (rootPath, query, options) => ipcRenderer.invoke('search:files', rootPath, query, options),
  gitStatus: (rootPath) => ipcRenderer.invoke('git:status', rootPath),
  gitStage: (rootPath, filePath) => ipcRenderer.invoke('git:stage', rootPath, filePath),
  gitUnstage: (rootPath, filePath) => ipcRenderer.invoke('git:unstage', rootPath, filePath),
  gitCommit: (rootPath, message) => ipcRenderer.invoke('git:commit', rootPath, message),
  gitFileDiff: (rootPath, filePath, kind) => ipcRenderer.invoke('git:fileDiff', rootPath, filePath, kind),
  gitLog: (rootPath, limit, skip) => ipcRenderer.invoke('git:log', rootPath, limit, skip),
  gitCommitFiles: (rootPath, hash) => ipcRenderer.invoke('git:commitFiles', rootPath, hash),
  gitCommitFileDiff: (rootPath, hash, filePath, previousPath) => ipcRenderer.invoke('git:commitFileDiff', rootPath, hash, filePath, previousPath),
  gitCheckoutCommit: (rootPath, hash) => ipcRenderer.invoke('git:checkoutCommit', rootPath, hash),
  gitCreateBranchFromCommit: (rootPath, hash, branchName) => ipcRenderer.invoke('git:createBranchFromCommit', rootPath, hash, branchName),
  gitResetToCommit: (rootPath, hash, mode) => ipcRenderer.invoke('git:resetToCommit', rootPath, hash, mode),
  gitBranches: (rootPath) => ipcRenderer.invoke('git:branches', rootPath),
  gitSwitchBranch: (rootPath, branchName, branchType, autoStash) => ipcRenderer.invoke('git:switchBranch', rootPath, branchName, branchType, autoStash),
  gitCreateBranch: (rootPath, branchName, startPoint, checkout) => ipcRenderer.invoke('git:createBranch', rootPath, branchName, startPoint, checkout),
  gitDeleteBranch: (rootPath, branchName) => ipcRenderer.invoke('git:deleteBranch', rootPath, branchName),
  gitFetch: (rootPath) => ipcRenderer.invoke('git:fetch', rootPath),
  gitPull: (rootPath, autoStash) => ipcRenderer.invoke('git:pull', rootPath, autoStash),
  gitPush: (rootPath) => ipcRenderer.invoke('git:push', rootPath),
  gitMerge: (rootPath, branchName, autoStash) => ipcRenderer.invoke('git:merge', rootPath, branchName, autoStash),
  gitRebase: (rootPath, branchName, autoStash) => ipcRenderer.invoke('git:rebase', rootPath, branchName, autoStash),
  gitAbortMerge: (rootPath) => ipcRenderer.invoke('git:abortMerge', rootPath),
  gitAbortRebase: (rootPath) => ipcRenderer.invoke('git:abortRebase', rootPath),
  gitStashList: (rootPath) => ipcRenderer.invoke('git:stashList', rootPath),
  gitStashPush: (rootPath, message) => ipcRenderer.invoke('git:stashPush', rootPath, message),
  gitStashApply: (rootPath, stashRef) => ipcRenderer.invoke('git:stashApply', rootPath, stashRef),
  gitStashPop: (rootPath, stashRef) => ipcRenderer.invoke('git:stashPop', rootPath, stashRef),
  gitStashDrop: (rootPath, stashRef) => ipcRenderer.invoke('git:stashDrop', rootPath, stashRef),
  gitResolveCommitAvatars: (rootPath, hashes) => ipcRenderer.invoke('git:resolveCommitAvatars', rootPath, hashes),
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
}

contextBridge.exposeInMainWorld('rille', api)
