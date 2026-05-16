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
  gitLog(rootPath: string, limit?: number): Promise<GitLogResult>
  gitCommitFiles(rootPath: string, hash: string): Promise<GitCommitFilesResult>
  gitCommitFileDiff(rootPath: string, hash: string, filePath: string, previousPath?: string): Promise<GitDiffResult>
  gitCheckoutCommit(rootPath: string, hash: string): Promise<GitCommandResult>
  gitCreateBranchFromCommit(rootPath: string, hash: string, branchName: string): Promise<GitCommandResult>
  gitResetToCommit(rootPath: string, hash: string, mode: GitResetMode): Promise<GitCommandResult>
  terminalCreate(cwd?: string, cols?: number, rows?: number): Promise<TerminalSession>
  terminalWrite(id: string, data: string): Promise<void>
  terminalResize(id: string, cols: number, rows: number): Promise<void>
  terminalKill(id: string): Promise<void>
  onTerminalData(callback: (event: TerminalDataEvent) => void): () => void
  onTerminalExit(callback: (event: TerminalExitEvent) => void): () => void
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
  error?: string
}

export interface GitCommandResult {
  success: boolean
  error?: string
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
  date: string
  subject: string
  parents: string[]
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

export interface TerminalSession {
  id: string
  cwd: string
  shell: string
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
  gitLog: (rootPath, limit) => ipcRenderer.invoke('git:log', rootPath, limit),
  gitCommitFiles: (rootPath, hash) => ipcRenderer.invoke('git:commitFiles', rootPath, hash),
  gitCommitFileDiff: (rootPath, hash, filePath, previousPath) => ipcRenderer.invoke('git:commitFileDiff', rootPath, hash, filePath, previousPath),
  gitCheckoutCommit: (rootPath, hash) => ipcRenderer.invoke('git:checkoutCommit', rootPath, hash),
  gitCreateBranchFromCommit: (rootPath, hash, branchName) => ipcRenderer.invoke('git:createBranchFromCommit', rootPath, hash, branchName),
  gitResetToCommit: (rootPath, hash, mode) => ipcRenderer.invoke('git:resetToCommit', rootPath, hash, mode),
  terminalCreate: (cwd, cols, rows) => ipcRenderer.invoke('terminal:create', cwd, cols, rows),
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
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
}

contextBridge.exposeInMainWorld('rille', api)
