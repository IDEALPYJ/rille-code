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
    error?: string
  }

  interface GitCommandResult {
    success: boolean
    error?: string
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
    date: string
    subject: string
    parents: string[]
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

  interface TerminalSession {
    id: string
    cwd: string
    shell: string
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

  interface Window {
    rille: RilleAPI
  }
}
