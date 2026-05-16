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
