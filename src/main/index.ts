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

interface GitCommitSummary {
  hash: string
  shortHash: string
  author: string
  date: string
  subject: string
  parents: string[]
}

interface GitCommitFile {
  path: string
  previousPath?: string
  status: string
}

interface TerminalSession {
  id: string
  cwd: string
  shell: string
}

const MAX_SEARCH_RESULTS = 300
const MAX_SEARCH_FILE_SIZE = 1024 * 1024
const GIT_TIMEOUT_MS = 10_000
const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
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

function hasBinaryMarker(content: string): boolean {
  return content.includes('\0')
}

function normalizeGitLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return 50
  return Math.max(1, Math.min(200, Math.floor(limit ?? 50)))
}

function createTextReadResult(content = ''): { success: boolean; content: string; isBinary?: boolean; error?: string } {
  return { success: true, content, isBinary: hasBinaryMarker(content) }
}

async function readGitObjectText(
  repoRoot: string,
  revision: string,
  filePath: string,
): Promise<{ success: boolean; content: string; isBinary?: boolean; error?: string }> {
  const spec = revision === ':' ? `:${filePath}` : `${revision}:${filePath}`
  const result = await runGit(repoRoot, ['show', spec])
  if (!result.success) {
    return createTextReadResult('')
  }
  return createTextReadResult(result.stdout)
}

async function readWorktreeText(
  repoRoot: string,
  filePath: string,
): Promise<{ success: boolean; content: string; isBinary?: boolean; error?: string }> {
  const absolutePath = join(repoRoot, filePath)
  if (!existsSync(absolutePath)) {
    return createTextReadResult('')
  }

  try {
    const content = await readFile(absolutePath, 'utf-8')
    return createTextReadResult(content)
  } catch (error) {
    return {
      success: false,
      content: '',
      error: error instanceof Error ? error.message : '无法读取文件内容。',
    }
  }
}

function buildGitDiffResult(
  filePath: string,
  original: { success: boolean; content: string; isBinary?: boolean; error?: string },
  modified: { success: boolean; content: string; isBinary?: boolean; error?: string },
  originalLabel: string,
  modifiedLabel: string,
): GitDiffResult {
  if (!original.success || !modified.success) {
    return {
      success: false,
      filePath,
      original: '',
      modified: '',
      originalLabel,
      modifiedLabel,
      error: original.error || modified.error || '无法读取 diff 内容。',
    }
  }

  if (original.isBinary || modified.isBinary) {
    return {
      success: true,
      filePath,
      original: '',
      modified: '',
      originalLabel,
      modifiedLabel,
      isBinary: true,
      error: '二进制文件无法在文本 diff 中预览。',
    }
  }

  return {
    success: true,
    filePath,
    original: original.content,
    modified: modified.content,
    originalLabel,
    modifiedLabel,
  }
}

async function getGitFileDiff(rootPath: string, filePath: string, kind: GitFileDiffKind): Promise<GitDiffResult> {
  const repo = await resolveRepoRoot(rootPath)
  const gitPath = repo.success ? toGitPath(repo.repoRoot, filePath) : filePath
  if (!repo.success) {
    return {
      success: false,
      filePath: gitPath,
      original: '',
      modified: '',
      originalLabel: '',
      modifiedLabel: '',
      error: repo.error,
    }
  }

  if (kind === 'staged') {
    const original = await readGitObjectText(repo.repoRoot, 'HEAD', gitPath)
    const modified = await readGitObjectText(repo.repoRoot, ':', gitPath)
    return buildGitDiffResult(gitPath, original, modified, 'HEAD', '已暂存')
  }

  if (kind === 'untracked') {
    const original = createTextReadResult('')
    const modified = await readWorktreeText(repo.repoRoot, gitPath)
    return buildGitDiffResult(gitPath, original, modified, '空文件', '工作区')
  }

  const original = await readGitObjectText(repo.repoRoot, ':', gitPath)
  const modified = await readWorktreeText(repo.repoRoot, gitPath)
  return buildGitDiffResult(gitPath, original, modified, '索引', '工作区')
}

async function getGitLog(rootPath: string, limit?: number): Promise<{ success: boolean; commits: GitCommitSummary[]; error?: string }> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, commits: [], error: repo.error }

  const result = await runGit(repo.repoRoot, [
    'log',
    `-${normalizeGitLimit(limit)}`,
    '--date=iso-strict',
    '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1f%P%x1e',
  ])

  if (!result.success) {
    return { success: false, commits: [], error: result.error }
  }

  const commits = result.stdout
    .split('\x1e')
    .map(item => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [hash = '', shortHash = '', author = '', date = '', subject = '', parents = ''] = item.split('\x1f')
      return { hash, shortHash, author, date, subject, parents: parents.split(' ').filter(Boolean) }
    })
    .filter(commit => Boolean(commit.hash))

  return { success: true, commits }
}

async function getCommitBase(repoRoot: string, hash: string): Promise<string> {
  const parentsResult = await runGit(repoRoot, ['rev-list', '--parents', '-n', '1', hash])
  if (!parentsResult.success) return EMPTY_TREE_HASH
  const [, firstParent] = parentsResult.stdout.trim().split(/\s+/)
  return firstParent || EMPTY_TREE_HASH
}

async function getGitCommitFiles(rootPath: string, hash: string): Promise<{ success: boolean; files: GitCommitFile[]; error?: string }> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, files: [], error: repo.error }

  const base = await getCommitBase(repo.repoRoot, hash)
  const result = await runGit(repo.repoRoot, ['diff', '--name-status', '-z', base, hash, '--'])
  if (!result.success) {
    return { success: false, files: [], error: result.error }
  }

  const records = result.stdout.split('\0').filter(Boolean)
  const files: GitCommitFile[] = []
  for (let index = 0; index < records.length;) {
    const status = records[index++] ?? ''
    if (!status) continue

    if (status.startsWith('R') || status.startsWith('C')) {
      const previousPath = records[index++] ?? ''
      const path = records[index++] ?? previousPath
      files.push({ path, previousPath, status: status[0] })
      continue
    }

    const path = records[index++] ?? ''
    if (path) files.push({ path, status: status[0] })
  }

  return { success: true, files }
}

async function getGitCommitFileDiff(
  rootPath: string,
  hash: string,
  filePath: string,
  previousPath?: string,
): Promise<GitDiffResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) {
    return {
      success: false,
      filePath,
      original: '',
      modified: '',
      originalLabel: '',
      modifiedLabel: '',
      error: repo.error,
    }
  }

  const gitPath = toGitPath(repo.repoRoot, filePath)
  const oldGitPath = previousPath ? toGitPath(repo.repoRoot, previousPath) : gitPath
  const base = await getCommitBase(repo.repoRoot, hash)
  const shortBase = base === EMPTY_TREE_HASH ? '空文件' : base.slice(0, 7)
  const original = base === EMPTY_TREE_HASH
    ? createTextReadResult('')
    : await readGitObjectText(repo.repoRoot, base, oldGitPath)
  const modified = await readGitObjectText(repo.repoRoot, hash, gitPath)

  return buildGitDiffResult(gitPath, original, modified, shortBase, hash.slice(0, 7))
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

ipcMain.handle('git:fileDiff', async (_event, rootPath: string, filePath: string, kind: GitFileDiffKind) => {
  return getGitFileDiff(rootPath, filePath, kind)
})

ipcMain.handle('git:log', async (_event, rootPath: string, limit?: number) => {
  return getGitLog(rootPath, limit)
})

ipcMain.handle('git:commitFiles', async (_event, rootPath: string, hash: string) => {
  return getGitCommitFiles(rootPath, hash)
})

ipcMain.handle('git:commitFileDiff', async (_event, rootPath: string, hash: string, filePath: string, previousPath?: string) => {
  return getGitCommitFileDiff(rootPath, hash, filePath, previousPath)
})

ipcMain.handle('git:checkoutCommit', async (_event, rootPath: string, hash: string) => {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  const result = await runGit(repo.repoRoot, ['checkout', '--detach', hash])
  return { success: result.success, error: result.error }
})

ipcMain.handle('git:createBranchFromCommit', async (_event, rootPath: string, hash: string, branchName: string) => {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }

  const normalizedBranchName = branchName.trim()
  const validation = await runGit(repo.repoRoot, ['check-ref-format', '--branch', normalizedBranchName])
  if (!normalizedBranchName || !validation.success) {
    return { success: false, error: validation.error || '分支名无效。' }
  }

  const result = await runGit(repo.repoRoot, ['checkout', '-b', normalizedBranchName, hash])
  return { success: result.success, error: result.error }
})

ipcMain.handle('git:resetToCommit', async (_event, rootPath: string, hash: string, mode: GitResetMode) => {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') {
    return { success: false, error: 'Reset mode is invalid.' }
  }
  const result = await runGit(repo.repoRoot, ['reset', `--${mode}`, hash])
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
