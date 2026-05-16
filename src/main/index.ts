import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron'
import type { OpenDialogOptions, SaveDialogOptions, WebContents } from 'electron'
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { join, relative } from 'path'
import { readdir, readFile, writeFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import * as pty from 'node-pty'

let mainWindow: BrowserWindow | null = null

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

interface TerminalSession {
  id: string
  cwd: string
  shell: string
}

const MAX_SEARCH_RESULTS = 300
const MAX_SEARCH_FILE_SIZE = 1024 * 1024
const GIT_TIMEOUT_MS = 10_000
const terminalSessions = new Map<string, pty.IPty>()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'RilleCode',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f8f8f8',
      symbolColor: '#343842',
      height: 34,
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.setMenuBarVisibility(false)

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function readDirectory(dirPath: string): Promise<FileEntry[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const result: FileEntry[] = []

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue
      }

      result.push({
        name: entry.name,
        path: join(dirPath, entry.name),
        isDirectory: entry.isDirectory(),
      })
    }

    return result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  } catch {
    return []
  }
}

async function searchFiles(rootPath: string, query: string, options: SearchOptions): Promise<SearchResult[]> {
  const needle = options.caseSensitive ? query : query.toLowerCase()
  const results: SearchResult[] = []

  if (!needle.trim()) {
    return results
  }

  async function walk(dirPath: string): Promise<void> {
    if (results.length >= MAX_SEARCH_RESULTS) return

    let entries
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (results.length >= MAX_SEARCH_RESULTS) return
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      if (!options.includeDependencies && (entry.name === 'node_modules' || entry.name === 'out')) continue

      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }

      let fileStat
      try {
        fileStat = await stat(fullPath)
      } catch {
        continue
      }

      if (fileStat.size > MAX_SEARCH_FILE_SIZE) continue

      let content
      try {
        content = await readFile(fullPath, 'utf-8')
      } catch {
        continue
      }

      const lines = content.split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        const lineText = lines[index]
        const haystack = options.caseSensitive ? lineText : lineText.toLowerCase()
        const column = haystack.indexOf(needle)
        if (column === -1) continue

        results.push({
          filePath: fullPath,
          line: index + 1,
          column: column + 1,
          preview: lineText.trim().slice(0, 240),
        })

        if (results.length >= MAX_SEARCH_RESULTS) return
      }
    }
  }

  await walk(rootPath)
  return results
}

function runGit(cwd: string, args: string[]): Promise<GitCommandResult & { stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: GIT_TIMEOUT_MS }, (error, stdout, stderr) => {
      const stderrText = stderr.toString()
      resolve({
        success: !error,
        stdout: stdout.toString(),
        stderr: stderrText,
        error: error ? stderrText || error.message : undefined,
      })
    })
  })
}

function toGitPath(repoRoot: string, filePath: string): string {
  const relPath = filePath.startsWith(repoRoot) ? relative(repoRoot, filePath) : filePath
  return relPath.replace(/\\/g, '/')
}

async function resolveRepoRoot(rootPath: string): Promise<GitCommandResult & { repoRoot: string }> {
  const gitVersion = await runGit(rootPath, ['--version'])
  if (!gitVersion.success) {
    return { success: false, repoRoot: '', error: `Git is not available: ${gitVersion.error || 'unknown error'}` }
  }

  const insideRepo = await runGit(rootPath, ['rev-parse', '--is-inside-work-tree'])
  if (!insideRepo.success || insideRepo.stdout.trim() !== 'true') {
    return { success: false, repoRoot: '', error: insideRepo.error || '当前文件夹不是 Git 仓库。' }
  }

  const rootResult = await runGit(rootPath, ['rev-parse', '--show-toplevel'])
  if (!rootResult.success) {
    return { success: false, repoRoot: '', error: rootResult.error || '无法解析 Git 仓库根目录。' }
  }

  return { success: true, repoRoot: rootResult.stdout.trim() }
}

async function getGitStatus(rootPath: string): Promise<GitStatusResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) {
    return { isRepo: false, repoRoot: '', branch: '', staged: [], unstaged: [], untracked: [], error: repo.error }
  }

  const branchResult = await runGit(repo.repoRoot, ['branch', '--show-current'])
  const fallbackBranch = await runGit(repo.repoRoot, ['rev-parse', '--short', 'HEAD'])
  const statusResult = await runGit(repo.repoRoot, ['status', '--porcelain=v1', '-z'])

  const staged = new Set<string>()
  const unstaged = new Set<string>()
  const untracked = new Set<string>()

  if (statusResult.success) {
    const entries = statusResult.stdout.split('\0').filter(Boolean)
    for (let index = 0; index < entries.length; index += 1) {
      const item = entries[index]
      if (item.length < 4) continue
      const x = item[0]
      const y = item[1]
      const filePath = item.slice(3)

      if ((x === 'R' || x === 'C') && entries[index + 1]) {
        index += 1
      }

      if (x === '?' && y === '?') {
        untracked.add(filePath)
        continue
      }

      if (x !== ' ' && x !== '?') staged.add(filePath)
      if (y !== ' ' && y !== '?') unstaged.add(filePath)
    }
  }

  return {
    isRepo: true,
    repoRoot: repo.repoRoot,
    branch: branchResult.stdout.trim() || fallbackBranch.stdout.trim() || 'HEAD',
    staged: [...staged].sort(),
    unstaged: [...unstaged].sort(),
    untracked: [...untracked].sort(),
    error: statusResult.success ? undefined : statusResult.error,
  }
}

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe'
  }
  return process.env.SHELL || 'bash'
}

function createTerminal(sender: WebContents, cwd?: string, cols = 80, rows = 24): TerminalSession {
  const id = randomUUID()
  const shellPath = getDefaultShell()
  const terminalCwd = cwd && existsSync(cwd) ? cwd : homedir()
  const env = { ...process.env, TERM: 'xterm-256color' }

  const terminal = pty.spawn(shellPath, [], {
    name: 'xterm-256color',
    cols: Math.max(2, Math.floor(cols)),
    rows: Math.max(1, Math.floor(rows)),
    cwd: terminalCwd,
    env,
  })

  terminal.onData((data) => {
    if (!sender.isDestroyed()) {
      sender.send('terminal:data', { id, data })
    }
  })

  terminal.onExit(({ exitCode }) => {
    terminalSessions.delete(id)
    if (!sender.isDestroyed()) {
      sender.send('terminal:exit', { id, exitCode })
    }
  })

  terminalSessions.set(id, terminal)
  return { id, cwd: terminalCwd, shell: shellPath }
}

function killAllTerminals(): void {
  for (const terminal of terminalSessions.values()) {
    terminal.kill()
  }
  terminalSessions.clear()
}

// ── IPC Handlers ────────────────────────────────────────────

ipcMain.handle('dialog:openFolder', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  const options: OpenDialogOptions = { properties: ['openDirectory'] }
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:openFile', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  const options: OpenDialogOptions = { properties: ['openFile'] }
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:saveFile', async (event, defaultPath?: string) => {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  const options: SaveDialogOptions = { defaultPath }
  const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
  return result.canceled ? null : result.filePath ?? null
})

ipcMain.handle('app:newWindow', () => {
  createWindow()
})

ipcMain.handle('app:exit', () => {
  app.quit()
})

ipcMain.handle('fs:readDirectory', async (_event, dirPath: string) => {
  return readDirectory(dirPath)
})

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  const content = await readFile(filePath, 'utf-8')
  return content
})

ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
  await writeFile(filePath, content, 'utf-8')
  return true
})

ipcMain.handle('fs:fileExists', async (_event, filePath: string) => {
  return existsSync(filePath)
})

ipcMain.handle('fs:getFileInfo', async (_event, filePath: string) => {
  try {
    const s = await stat(filePath)
    return { size: s.size, modifiedTime: s.mtimeMs }
  } catch {
    return null
  }
})

ipcMain.handle('search:files', async (_event, rootPath: string, query: string, options: SearchOptions) => {
  return searchFiles(rootPath, query, options)
})

ipcMain.handle('git:status', async (_event, rootPath: string) => {
  return getGitStatus(rootPath)
})

ipcMain.handle('git:stage', async (_event, rootPath: string, filePath: string) => {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  const result = await runGit(repo.repoRoot, ['add', '--', toGitPath(repo.repoRoot, filePath)])
  return { success: result.success, error: result.error }
})

ipcMain.handle('git:unstage', async (_event, rootPath: string, filePath: string) => {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  const result = await runGit(repo.repoRoot, ['restore', '--staged', '--', toGitPath(repo.repoRoot, filePath)])
  return { success: result.success, error: result.error }
})

ipcMain.handle('git:commit', async (_event, rootPath: string, message: string) => {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  const result = await runGit(repo.repoRoot, ['commit', '-m', message])
  return { success: result.success, error: result.error }
})

ipcMain.handle('terminal:create', (event, cwd?: string, cols?: number, rows?: number) => {
  try {
    return createTerminal(event.sender, cwd, cols, rows)
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Terminal failed to start')
  }
})

ipcMain.handle('terminal:write', (_event, id: string, data: string) => {
  terminalSessions.get(id)?.write(data)
})

ipcMain.handle('terminal:resize', (_event, id: string, cols: number, rows: number) => {
  terminalSessions.get(id)?.resize(cols, rows)
})

ipcMain.handle('terminal:kill', (_event, id: string) => {
  terminalSessions.get(id)?.kill()
  terminalSessions.delete(id)
})

ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  await shell.openExternal(url)
})

// ── App Lifecycle ────────────────────────────────────────────

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
})

app.on('before-quit', () => {
  killAllTerminals()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
