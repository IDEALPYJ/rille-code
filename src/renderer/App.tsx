import { useState, useCallback, createContext, useContext, useEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { editor as MonacoEditorApi } from 'monaco-editor'
import {
  ArrowUp,
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Files,
  Folder,
  GitBranch,
  Home,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  PanelBottom,
  PanelLeft,
  PanelRight,
} from 'lucide-react'
import { FileTree } from './components/FileTree'
import { Tabs } from './components/Tabs'
import { Editor, type EditorDiagnostic } from './components/Editor'
import { StatusBar, type StatusDiagnostic } from './components/StatusBar'
import { SearchPanel } from './components/SearchPanel'
import { GitPanel } from './components/GitPanel'
import { GitDiffViewer, type GitDiffTarget } from './components/GitDiffViewer'
import { TerminalPanel } from './components/TerminalPanel'
import { RemotePanel } from './components/RemotePanel'
import { AgentPanel } from './components/agent/AgentPanel'
import { ModelSettingsDialog } from './components/ModelSettingsDialog'
import type { AgentEvent, AgentSession, AgentSessionSummary } from '../shared/agent/protocol'

// ── Types ────────────────────────────────────────────────────

export interface OpenFile {
  path: string
  name: string
  content: string
  isDirty: boolean
  originalContent: string
}

export interface AppState {
  workspace: WorkspaceLocation | null
  fileTree: FileEntry[]
  openFiles: OpenFile[]
  activeFilePath: string | null
}

export interface AppContextType extends AppState {
  setWorkspace: (workspace: WorkspaceLocation) => Promise<void>
  openFile: (path: string) => Promise<void>
  closeFile: (path: string) => void
  setActiveFile: (path: string) => void
  updateFileContent: (path: string, content: string) => void
  saveFile: (path: string) => Promise<void>
  markFileApplied: (path: string, content: string) => void
}

type SideView = 'explorer' | 'search' | 'git' | 'remote' | 'agent'
type BottomPanelTab = 'problems' | 'output' | 'debug' | 'terminal' | 'ports'

type TerminalLaunchRequest = {
  id: number
  profileId?: string
  sshHost?: string
}

type RemoteFolderDialogState = {
  connection: RemoteConnection
  value: string
  entries: FileEntry[]
  isLoading: boolean
  error?: string
}

type MenuActionItem = {
  type?: 'item'
  label: string
  shortcut?: string
  disabled?: boolean
  action: () => void | Promise<void>
}

type MenuSeparator = { type: 'separator' }

type MenuItem = MenuActionItem | MenuSeparator

type MenuGroup = {
  label: string
  items: MenuItem[]
}

export const AppContext = createContext<AppContextType>(null!)

export function useApp() {
  return useContext(AppContext)
}

// ── Language Detection ───────────────────────────────────────

function getLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    html: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', xml: 'xml', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', sql: 'sql', sh: 'shell', bash: 'shell',
    svg: 'xml', graphql: 'graphql', gql: 'graphql',
  }
  return map[ext ?? ''] ?? 'plaintext'
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

function dirnameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized || normalized === '/') return '/'
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return '/'
  return normalized.slice(0, index)
}

function joinRemotePath(base: string, name: string): string {
  const normalized = base.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized || normalized === '/') return `/${name}`
  return `${normalized}/${name}`
}

function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = Date.now()
  if (now - timestamp < 60_000) return '刚刚'
  if (now - timestamp < 60 * 60_000) return `${Math.max(1, Math.floor((now - timestamp) / 60_000))}分钟前`
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function agentSessionStatusLabel(status: AgentSession['status']): string {
  if (status === 'running') return '运行中'
  if (status === 'waiting_approval') return '等待'
  if (status === 'error') return '错误'
  if (status === 'interrupted') return '已停止'
  return ''
}

function agentVerificationLabel(session: AgentSessionSummary): string {
  if (session.status !== 'idle' || !session.latestVerificationStatus) return agentSessionStatusLabel(session.status) || formatSessionTime(session.updatedAt)
  if (session.latestVerificationStatus === 'passed') return '验证通过'
  if (session.latestVerificationStatus === 'failed') return '验证失败'
  return '未验证'
}

function isActionItem(item: MenuItem): item is MenuActionItem {
  return item.type !== 'separator'
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key)
    if (value === null) return fallback
    return value === 'true'
  } catch {
    return fallback
  }
}

// ── App Component ────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState<AppState>({
    workspace: null,
    fileTree: [],
    openFiles: [],
    activeFilePath: null,
  })
  const [activeSideView, setActiveSideView] = useState<SideView>('explorer')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSidePanelVisible, setIsSidePanelVisible] = useState(() => readStoredBoolean('rille:side-panel-visible', true))
  const [isRightPanelVisible, setIsRightPanelVisible] = useState(() => readStoredBoolean('rille:right-panel-visible', true))
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(() => readStoredBoolean('rille:bottom-panel-visible:v2', false))
  const [activeBottomTab, setActiveBottomTab] = useState<BottomPanelTab>('terminal')
  const [terminalNewSignal, setTerminalNewSignal] = useState(0)
  const [terminalKillSignal, setTerminalKillSignal] = useState(0)
  const [terminalLaunchRequest, setTerminalLaunchRequest] = useState<TerminalLaunchRequest | null>(null)
  const [gitDiffTarget, setGitDiffTarget] = useState<GitDiffTarget | null>(null)
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 })
  const [diagnostics, setDiagnostics] = useState<EditorDiagnostic[]>([])
  const [breakpoints, setBreakpoints] = useState<Record<string, number[]>>({})
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [rightPanelWidth, setRightPanelWidth] = useState(340)
  const [remoteFolderConnection, setRemoteFolderConnection] = useState<RemoteConnection | null>(null)
  const [remoteFolderDialog, setRemoteFolderDialog] = useState<RemoteFolderDialogState | null>(null)
  const [agentSessions, setAgentSessions] = useState<AgentSessionSummary[]>([])
  const [selectedAgentSession, setSelectedAgentSession] = useState<AgentSession | null>(null)
  const [isAgentSessionsLoading, setIsAgentSessionsLoading] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MonacoEditorApi.IStandaloneCodeEditor | null>(null)
  const pendingRevealRef = useRef<{ path: string; line: number; column: number } | null>(null)
  const workspacePath = state.workspace?.path ?? null

  const refreshAgentSessions = useCallback(async () => {
    setIsAgentSessionsLoading(true)
    try {
      setAgentSessions(await window.rille.agentListSessions())
    } finally {
      setIsAgentSessionsLoading(false)
    }
  }, [])

  const selectAgentSession = useCallback(async (sessionId: string) => {
    const session = await window.rille.agentResumeSession(sessionId)
    setSelectedAgentSession(session)
    setIsRightPanelVisible(true)
    void refreshAgentSessions()
  }, [refreshAgentSessions])

  const createAgentSessionForWorkspace = useCallback(async () => {
    const session = await window.rille.agentCreateSession(state.workspace, 'ask')
    setSelectedAgentSession(session)
    setIsRightPanelVisible(true)
    setActiveSideView('agent')
    void refreshAgentSessions()
  }, [refreshAgentSessions, state.workspace])

  const setWorkspace = useCallback(async (workspace: WorkspaceLocation) => {
    const tree = await window.rille.readDirectory(workspace.path, workspace)
    editorRef.current = null
    pendingRevealRef.current = null
    setGitDiffTarget(null)
    setCursorPosition({ line: 1, column: 1 })
    setDiagnostics([])
    setBreakpoints({})
    setState(prev => ({ ...prev, workspace, fileTree: tree, openFiles: [], activeFilePath: null }))
    setActiveSideView('explorer')
  }, [])

  const resolveRemoteFolderConnection = useCallback(async (): Promise<RemoteConnection | null> => {
    const connections = await window.rille.remoteListConnections()
    if (remoteFolderConnection) {
      const selected = connections.find(connection => connection.id === remoteFolderConnection.id)
      if (selected) return selected
    }
    if (state.workspace?.kind !== 'local' && state.workspace?.connectionId) {
      const current = connections.find(connection => connection.id === state.workspace?.connectionId)
      if (current) return current
    }
    return connections.length === 1 ? connections[0] : null
  }, [remoteFolderConnection, state.workspace])

  const loadRemoteFolderEntries = useCallback(async (connection: RemoteConnection, path: string) => {
    const nextPath = path.trim() || connection.home || '/'
    const browsingWorkspace: WorkspaceLocation = {
      kind: connection.kind,
      path: nextPath,
      label: `${connection.label}:${nextPath}`,
      connectionId: connection.id,
      targetId: connection.targetId,
    }

    setRemoteFolderDialog(prev => prev && prev.connection.id === connection.id
      ? { ...prev, value: nextPath, entries: [], isLoading: true, error: undefined }
      : prev)

    try {
      const entries = await window.rille.readDirectory(nextPath, browsingWorkspace)
      setRemoteFolderDialog(prev => prev && prev.connection.id === connection.id && prev.value === nextPath
        ? { ...prev, entries: entries.filter(entry => entry.isDirectory), isLoading: false }
        : prev)
    } catch (error) {
      setRemoteFolderDialog(prev => prev && prev.connection.id === connection.id
        ? {
            ...prev,
            value: nextPath,
            entries: [],
            isLoading: false,
            error: error instanceof Error ? error.message : '读取远程目录失败。',
          }
        : prev)
    }
  }, [])

  const openRemoteFolderDialog = useCallback((connection: RemoteConnection, path: string, error?: string) => {
    const initialPath = path.trim() || connection.home || '/'
    setRemoteFolderConnection(connection)
    setRemoteFolderDialog({ connection, value: initialPath, entries: [], isLoading: true, error })
    void loadRemoteFolderEntries(connection, initialPath)
  }, [loadRemoteFolderEntries])

  const openWorkspace = useCallback(async () => {
    const remoteConnection = await resolveRemoteFolderConnection()
    if (remoteConnection) {
      try {
        const home = remoteConnection.home || await window.rille.remoteGetHome(remoteConnection.id)
        const defaultPath = state.workspace?.kind !== 'local' && state.workspace?.connectionId === remoteConnection.id
          ? state.workspace.path
          : home
        openRemoteFolderDialog(remoteConnection, defaultPath)
      } catch (error) {
        openRemoteFolderDialog(
          remoteConnection,
          remoteConnection.home || '/',
          error instanceof Error ? error.message : '读取远程 home 失败。',
        )
      }
      return
    }

    const p = await window.rille.openFolder()
    if (p) await setWorkspace({ kind: 'local', path: p, label: fileNameFromPath(p) || p })
  }, [openRemoteFolderDialog, resolveRemoteFolderConnection, setWorkspace, state.workspace])

  const submitRemoteFolderDialog = useCallback(async () => {
    if (!remoteFolderDialog) return
    const remotePath = remoteFolderDialog.value.trim()
    if (!remotePath) {
      setRemoteFolderDialog(prev => prev ? { ...prev, error: '请输入远程目录路径。' } : prev)
      return
    }
    try {
      const workspace = await window.rille.remoteOpenWorkspace(remoteFolderDialog.connection.id, remotePath)
      setRemoteFolderConnection(remoteFolderDialog.connection)
      setRemoteFolderDialog(null)
      await setWorkspace(workspace)
    } catch (error) {
      setRemoteFolderDialog(prev => prev ? { ...prev, error: error instanceof Error ? error.message : '打开远程目录失败。' } : prev)
    }
  }, [remoteFolderDialog, setWorkspace])

  const refreshWorkspace = useCallback(async () => {
    if (!state.workspace) return
    const tree = await window.rille.readDirectory(state.workspace.path, state.workspace)
    setState(prev => ({ ...prev, fileTree: tree }))
  }, [state.workspace])

  const openFile = useCallback(async (path: string) => {
    setGitDiffTarget(null)
    const existing = state.openFiles.find(f => normalizePath(f.path) === normalizePath(path))
    if (existing) {
      setState(prev => ({ ...prev, activeFilePath: existing.path }))
      return
    }
    const content = await window.rille.readFile(path, state.workspace)
    const name = fileNameFromPath(path)
    const openFile: OpenFile = { path, name, content, isDirty: false, originalContent: content }
    setState(prev => ({
      ...prev,
      openFiles: [...prev.openFiles, openFile],
      activeFilePath: path,
    }))
  }, [state.openFiles, state.workspace])

  const openFileFromDialog = useCallback(async () => {
    if (state.workspace && state.workspace.kind !== 'local') {
      const remotePath = window.prompt('远程文件路径：', `${state.workspace.path}/`)?.trim()
      if (remotePath) await openFile(remotePath)
      return
    }
    const path = await window.rille.openFileDialog()
    if (path) await openFile(path)
  }, [openFile, state.workspace])

  const closeFile = useCallback((path: string) => {
    setGitDiffTarget(null)
    setState(prev => {
      const idx = prev.openFiles.findIndex(f => f.path === path)
      const newFiles = prev.openFiles.filter(f => f.path !== path)
      let newActive = prev.activeFilePath
      if (newActive === path) {
        newActive = newFiles[Math.min(idx, newFiles.length - 1)]?.path ?? null
      }
      return { ...prev, openFiles: newFiles, activeFilePath: newActive }
    })
  }, [])

  const closeAllFiles = useCallback(() => {
    editorRef.current = null
    pendingRevealRef.current = null
    setGitDiffTarget(null)
    setCursorPosition({ line: 1, column: 1 })
    setState(prev => ({ ...prev, openFiles: [], activeFilePath: null }))
  }, [])

  const setActiveFile = useCallback((path: string) => {
    setGitDiffTarget(null)
    setState(prev => ({ ...prev, activeFilePath: path }))
  }, [])

  const updateFileContent = useCallback((path: string, content: string) => {
    setState(prev => ({
      ...prev,
      openFiles: prev.openFiles.map(f =>
        f.path === path ? { ...f, content, isDirty: content !== f.originalContent } : f
      ),
    }))
  }, [])

  const saveFile = useCallback(async (path: string) => {
    const file = state.openFiles.find(f => f.path === path)
    if (!file) return
    await window.rille.writeFile(path, file.content, state.workspace)
    setState(prev => ({
      ...prev,
      openFiles: prev.openFiles.map(f =>
        f.path === path ? { ...f, isDirty: false, originalContent: f.content } : f
      ),
    }))
  }, [state.openFiles, state.workspace])

  const markFileApplied = useCallback((path: string, content: string) => {
    setState(prev => ({
      ...prev,
      openFiles: prev.openFiles.map(file =>
        file.path === path ? { ...file, content, originalContent: content, isDirty: false } : file
      ),
    }))
  }, [])

  const saveAllFiles = useCallback(async () => {
    const dirtyFiles = state.openFiles.filter(file => file.isDirty)
    await Promise.all(dirtyFiles.map(file => window.rille.writeFile(file.path, file.content, state.workspace)))
    const savedPaths = new Set(dirtyFiles.map(file => file.path))
    setState(prev => ({
      ...prev,
      openFiles: prev.openFiles.map(file =>
        savedPaths.has(file.path) ? { ...file, isDirty: false, originalContent: file.content } : file
      ),
    }))
  }, [state.openFiles, state.workspace])

  const selectedOpenFile = state.openFiles.find(f => f.path === state.activeFilePath)
  const activeFile = gitDiffTarget ? undefined : selectedOpenFile
  const workspaceName = state.workspace?.label || (workspacePath ? fileNameFromPath(workspacePath) : 'RilleCode')
  const workspaceTitle = workspaceName.toUpperCase()
  const hasRemoteFolderContext = Boolean(remoteFolderConnection || (state.workspace?.kind !== 'local' && state.workspace?.connectionId))
  const connectionStatusLabel = remoteFolderConnection?.label
    ?? (state.workspace && state.workspace.kind !== 'local' ? state.workspace.label : '本地')
  const isRemoteConnectionStatus = connectionStatusLabel !== '本地'

  useEffect(() => {
    window.localStorage.setItem('rille:side-panel-visible', String(isSidePanelVisible))
  }, [isSidePanelVisible])

  useEffect(() => {
    window.localStorage.setItem('rille:right-panel-visible', String(isRightPanelVisible))
  }, [isRightPanelVisible])

  useEffect(() => {
    window.localStorage.setItem('rille:bottom-panel-visible:v2', String(isBottomPanelVisible))
  }, [isBottomPanelVisible])

  useEffect(() => {
    void refreshAgentSessions()
  }, [refreshAgentSessions])

  useEffect(() => {
    const unsubscribe = window.rille.onAgentEvent((event: AgentEvent) => {
      if (event.type === 'session.created' || event.type === 'session.updated') {
        setAgentSessions(prev => {
          const summary: AgentSessionSummary = {
            id: event.session.id,
            title: event.session.title,
            workspace: event.session.workspace,
            createdAt: event.session.createdAt,
            updatedAt: event.session.updatedAt,
            status: event.session.status,
            permissionMode: event.session.permissionMode,
            lastMessage: prev.find(item => item.id === event.session.id)?.lastMessage,
          }
          const next = [summary, ...prev.filter(item => item.id !== event.session.id)]
          return next.sort((a, b) => b.updatedAt - a.updatedAt)
        })
        setSelectedAgentSession(prev => prev?.id === event.session.id ? event.session : prev)
        return
      }
      if (event.type === 'message.part.created' && event.part.type === 'text') {
        const lastMessage = event.part.text.slice(0, 160)
        setAgentSessions(prev => prev.map(item => item.id === event.sessionId
          ? { ...item, lastMessage, updatedAt: Date.now() }
          : item).sort((a, b) => b.updatedAt - a.updatedAt))
      }
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    let cancelled = false
    window.rille.agentResumeLastSession(state.workspace)
      .then(async session => {
        if (cancelled) return
        if (session) {
          setSelectedAgentSession(session)
        } else {
          const created = await window.rille.agentCreateSession(state.workspace, 'ask')
          if (!cancelled) setSelectedAgentSession(created)
        }
        void refreshAgentSessions()
      })
      .catch(() => {
        if (!cancelled) setSelectedAgentSession(null)
      })
    return () => {
      cancelled = true
    }
  }, [refreshAgentSessions, state.workspace])

  const saveFileAs = useCallback(async () => {
    if (!activeFile) return
    const targetPath = state.workspace && state.workspace.kind !== 'local'
      ? window.prompt('远程保存路径：', activeFile.path)?.trim() || null
      : await window.rille.saveFileDialog(activeFile.path)
    if (!targetPath) return

    await window.rille.writeFile(targetPath, activeFile.content, state.workspace)
    const targetName = fileNameFromPath(targetPath)
    const activePath = activeFile.path
    const savedContent = activeFile.content

    setState(prev => ({
      ...prev,
      openFiles: prev.openFiles
        .filter(file => file.path === activePath || normalizePath(file.path) !== normalizePath(targetPath))
        .map(file => file.path === activePath
          ? { ...file, path: targetPath, name: targetName, isDirty: false, originalContent: savedContent }
          : file),
      activeFilePath: targetPath,
    }))
  }, [activeFile, state.workspace])

  const revealEditorPosition = useCallback((editor: MonacoEditorApi.IStandaloneCodeEditor, target: { line: number; column: number }) => {
    const position = { lineNumber: target.line, column: target.column }
    editor.setPosition(position)
    editor.revealPositionInCenter(position)
    editor.focus()
  }, [])

  const revealPendingPosition = useCallback((editor: MonacoEditorApi.IStandaloneCodeEditor, path: string) => {
    const pending = pendingRevealRef.current
    if (!pending || normalizePath(pending.path) !== normalizePath(path)) return
    revealEditorPosition(editor, pending)
    pendingRevealRef.current = null
  }, [revealEditorPosition])

  const visibleDiagnostics = useMemo<StatusDiagnostic[]>(() => {
    const openPaths = new Set(state.openFiles.map(file => normalizePath(file.path)))
    return diagnostics.filter(diagnostic => openPaths.has(normalizePath(diagnostic.filePath)))
  }, [diagnostics, state.openFiles])

  const openDiagnostic = useCallback(async (diagnostic: StatusDiagnostic) => {
    pendingRevealRef.current = { path: diagnostic.filePath, line: diagnostic.line, column: diagnostic.column }
    await openFile(diagnostic.filePath)
    if (normalizePath(state.activeFilePath ?? '') === normalizePath(diagnostic.filePath) && editorRef.current) {
      revealEditorPosition(editorRef.current, diagnostic)
      pendingRevealRef.current = null
    }
  }, [openFile, revealEditorPosition, state.activeFilePath])


  const debugBreakpoints = useMemo<DebugBreakpoint[]>(() => Object.entries(breakpoints)
    .map(([sourcePath, lines]) => ({ sourcePath, lines: [...lines].sort((a, b) => a - b) }))
    .filter(item => item.lines.length > 0), [breakpoints])

  const toggleBreakpoint = useCallback((filePath: string, line: number) => {
    setBreakpoints(prev => {
      const current = prev[filePath] || []
      const nextLines = current.includes(line)
        ? current.filter(item => item !== line)
        : [...current, line].sort((a, b) => a - b)
      const next = { ...prev }
      if (nextLines.length === 0) delete next[filePath]
      else next[filePath] = nextLines
      return next
    })
  }, [])

  useEffect(() => {
    editorRef.current = null
    setCursorPosition({ line: 1, column: 1 })
  }, [state.activeFilePath])

  useEffect(() => {
    if (!openMenu) return
    const closeMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenu(null)
      }
    }
    window.addEventListener('pointerdown', closeMenu)
    return () => window.removeEventListener('pointerdown', closeMenu)
  }, [openMenu])

  const runEditorCommand = useCallback((command: string, fallbackCommand?: string) => {
    if (editorRef.current) {
      editorRef.current.focus()
      editorRef.current.trigger('menu', command, null)
      return
    }
    if (fallbackCommand) document.execCommand(fallbackCommand)
  }, [])

  const cycleFile = useCallback((direction: number) => {
    if (state.openFiles.length === 0) return
    const currentIndex = Math.max(0, state.openFiles.findIndex(file => file.path === state.activeFilePath))
    const nextIndex = (currentIndex + direction + state.openFiles.length) % state.openFiles.length
    setActiveFile(state.openFiles[nextIndex].path)
  }, [setActiveFile, state.activeFilePath, state.openFiles])

  const showBottomPanel = useCallback((tab: BottomPanelTab) => {
    setActiveBottomTab(tab)
    setIsBottomPanelVisible(true)
  }, [])

  const newTerminal = useCallback(() => {
    showBottomPanel('terminal')
    setTerminalNewSignal(value => value + 1)
  }, [showBottomPanel])

  const openTerminalProfile = useCallback((profileId?: string, sshHost?: string) => {
    showBottomPanel('terminal')
    setTerminalLaunchRequest(prev => ({ id: (prev?.id ?? 0) + 1, profileId, sshHost }))
  }, [showBottomPanel])

  const closeTerminal = useCallback(() => {
    setTerminalKillSignal(value => value + 1)
  }, [])

  const openGitDiff = useCallback((target: GitDiffTarget) => {
    editorRef.current = null
    pendingRevealRef.current = null
    setCursorPosition({ line: 1, column: 1 })
    setGitDiffTarget(target)
  }, [])

  const ctx: AppContextType = {
    ...state,
    setWorkspace, openFile, closeFile, setActiveFile, updateFileContent, saveFile, markFileApplied,
  }

  const menus = useMemo<MenuGroup[]>(() => [
    {
      label: '文件(F)',
      items: [
        { label: '新建窗口', shortcut: 'Ctrl+Shift+N', action: () => window.rille.newWindow() },
        { type: 'separator' },
        { label: '打开文件...', shortcut: 'Ctrl+O', action: openFileFromDialog },
        { label: '打开文件夹...', shortcut: 'Ctrl+K Ctrl+O', action: openWorkspace },
        { type: 'separator' },
        { label: '保存', shortcut: 'Ctrl+S', disabled: !activeFile, action: () => activeFile && saveFile(activeFile.path) },
        { label: '另存为...', shortcut: 'Ctrl+Shift+S', disabled: !activeFile, action: saveFileAs },
        { label: '全部保存', shortcut: 'Ctrl+Alt+S', disabled: !state.openFiles.some(file => file.isDirty), action: saveAllFiles },
        { type: 'separator' },
        { label: '关闭当前文件', shortcut: 'Ctrl+W', disabled: !activeFile, action: () => activeFile && closeFile(activeFile.path) },
        { label: '关闭全部文件', disabled: state.openFiles.length === 0, action: closeAllFiles },
        { type: 'separator' },
        { label: '退出', action: () => window.rille.exitApp() },
      ],
    },
    {
      label: '编辑(E)',
      items: [
        { label: '撤销', shortcut: 'Ctrl+Z', action: () => runEditorCommand('undo', 'undo') },
        { label: '重做', shortcut: 'Ctrl+Y', action: () => runEditorCommand('redo', 'redo') },
        { type: 'separator' },
        { label: '剪切', shortcut: 'Ctrl+X', action: () => runEditorCommand('editor.action.clipboardCutAction', 'cut') },
        { label: '复制', shortcut: 'Ctrl+C', action: () => runEditorCommand('editor.action.clipboardCopyAction', 'copy') },
        { label: '粘贴', shortcut: 'Ctrl+V', action: () => runEditorCommand('editor.action.clipboardPasteAction', 'paste') },
        { type: 'separator' },
        { label: '全选', shortcut: 'Ctrl+A', action: () => runEditorCommand('editor.action.selectAll', 'selectAll') },
        { label: '查找', shortcut: 'Ctrl+F', action: () => runEditorCommand('actions.find') },
      ],
    },
    {
      label: '查看(V)',
      items: [
        { label: '资源管理器', action: () => setActiveSideView('explorer') },
        { label: '搜索', action: () => setActiveSideView('search') },
        { label: '源代码管理', action: () => setActiveSideView('git') },
      ],
    },
    {
      label: '转到(G)',
      items: [
        { label: '上一个标签', disabled: state.openFiles.length < 2, action: () => cycleFile(-1) },
        { label: '下一个标签', disabled: state.openFiles.length < 2, action: () => cycleFile(1) },
      ],
    },
    {
      label: '终端(T)',
      items: [
        { label: '新建终端', shortcut: 'Ctrl+Shift+`', action: newTerminal },
        {
          label: isBottomPanelVisible && activeBottomTab === 'terminal' ? '隐藏终端' : '显示终端',
          shortcut: 'Ctrl+`',
          action: () => {
            if (isBottomPanelVisible && activeBottomTab === 'terminal') {
              setIsBottomPanelVisible(false)
            } else {
              showBottomPanel('terminal')
            }
          },
        },
        { label: '关闭终端', action: closeTerminal },
      ],
    },
  ], [activeBottomTab, activeFile, closeAllFiles, closeFile, closeTerminal, cycleFile, isBottomPanelVisible, newTerminal, openFileFromDialog, openWorkspace, runEditorCommand, saveAllFiles, saveFile, saveFileAs, showBottomPanel, state.openFiles])

  const renderSidebar = () => {
    if (activeSideView === 'search') {
      return <SearchPanel workspace={state.workspace} onOpenFile={openFile} />
    }

    if (activeSideView === 'git') {
      return <GitPanel workspace={state.workspace} onOpenDiff={openGitDiff} />
    }

    if (activeSideView === 'remote') {
      return <RemotePanel onOpenWorkspace={setWorkspace} onRemoteConnectionReady={setRemoteFolderConnection} />
    }

    if (activeSideView === 'agent') {
      return (
        <>
          <div className="side-view-title-row explorer-title">
            <button type="button" className="workspace-root">
              <MessageSquare size={14} />
              <span>对话</span>
            </button>
            <button type="button" className="side-action" onClick={() => void createAgentSessionForWorkspace()}>
              新建
            </button>
          </div>
          <div className="agent-session-list">
            {isAgentSessionsLoading && agentSessions.length === 0 ? (
              <div className="panel-empty">正在读取对话...</div>
            ) : agentSessions.length === 0 ? (
              <div className="panel-empty">还没有对话。</div>
            ) : (
              agentSessions.map(session => (
                <button
                  key={session.id}
                  type="button"
                  className={'agent-session-item ' + (selectedAgentSession?.id === session.id ? 'active ' : '') + session.status}
                  onClick={() => void selectAgentSession(session.id)}
                >
                  <div>
                    <strong>{session.title || 'Vibe Coding'}</strong>
                    <span>{session.lastMessage || session.workspace?.label || '新对话'}</span>
                  </div>
                  <small>{agentVerificationLabel(session)}</small>
                </button>
              ))
            )}
            <button type="button" className="agent-session-new" onClick={() => void createAgentSessionForWorkspace()}>
              <Plus size={14} />
              <span>新建对话</span>
            </button>
          </div>
        </>
      )
    }

    return (
      <>
        <div className="side-view-title-row explorer-title">
          <button type="button" className="workspace-root">
            <ChevronDown size={14} />
            <span>{state.workspace ? workspaceTitle : '资源管理器'}</span>
          </button>
          <button type="button" className="side-action" onClick={state.workspace && !hasRemoteFolderContext ? refreshWorkspace : openWorkspace}>
            {state.workspace && !hasRemoteFolderContext ? '刷新' : '打开'}
          </button>
        </div>
        {state.workspace ? (
          <>
            <FileTree
              entries={state.fileTree}
              workspace={state.workspace}
              onSelectFile={openFile}
              activePath={state.activeFilePath}
            />
          </>
        ) : (
          <div className="panel-empty">打开文件夹后可以浏览文件。</div>
        )}
      </>
    )
  }

  const renderSideToolbar = () => (
    <div className="sidebar-activity-tabs" aria-label="侧边栏功能">
      <button type="button" className={'sidebar-activity-item ' + (activeSideView === 'explorer' ? 'active' : '')} title="资源管理器" onClick={() => setActiveSideView('explorer')}><Files size={17} /></button>
      <button type="button" className={'sidebar-activity-item ' + (activeSideView === 'search' ? 'active' : '')} title="搜索" onClick={() => setActiveSideView('search')}><Search size={17} /></button>
      <button type="button" className={'sidebar-activity-item ' + (activeSideView === 'git' ? 'active' : '')} title="源代码管理" onClick={() => setActiveSideView('git')}><GitBranch size={17} /></button>
      <button type="button" className={'sidebar-activity-item ' + (activeSideView === 'remote' ? 'active' : '')} title="远程" onClick={() => setActiveSideView('remote')}><Server size={17} /></button>
      <button type="button" className={'sidebar-activity-item ' + (activeSideView === 'agent' ? 'active' : '')} title="对话" onClick={() => setActiveSideView('agent')}><MessageSquare size={17} /></button>
    </div>
  )

  const renderAgentPanel = () => (
    <AgentPanel
      workspace={state.workspace}
      activeFile={activeFile}
      openFiles={state.openFiles}
      diagnostics={visibleDiagnostics}
      cursor={cursorPosition}
      session={selectedAgentSession}
      sessionId={selectedAgentSession?.id ?? null}
      onSessionChange={setSelectedAgentSession}
      onFileApplied={markFileApplied}
    />
  )

  const emptyTitle = !state.workspace
    ? '打开文件夹或文件开始使用'
    : activeSideView === 'search'
      ? '在左侧搜索项目内容'
      : activeSideView === 'git'
        ? '在左侧管理 Git 变更'
        : activeSideView === 'remote'
          ? '在左侧连接远程环境'
          : activeSideView === 'agent'
            ? '在左侧选择或新建对话'
            : '从资源管理器选择文件'

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <header className="top-chrome">
          <div className="chrome-left">
            <div className="chrome-logo" aria-hidden="true">
              <Box size={15} />
            </div>
            <nav className="chrome-menu" aria-label="Application menu" ref={menuRef}>
              {menus.map(menu => (
                <div className="menu-group" key={menu.label}>
                  <button
                    type="button"
                    className={openMenu === menu.label ? 'active' : ''}
                    onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
                  >
                    {menu.label}
                  </button>
                  {openMenu === menu.label && (
                    <div className="menu-dropdown">
                      {menu.items.map((item, index) => item.type === 'separator' ? (
                        <div className="menu-separator" key={`sep-${index}`} />
                      ) : (
                        <button
                          type="button"
                          key={item.label}
                          disabled={item.disabled}
                          onClick={() => {
                            if (!isActionItem(item) || item.disabled) return
                            setOpenMenu(null)
                            void item.action()
                          }}
                        >
                          <span>{item.label}</span>
                          {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </nav>
          </div>

          <div className="chrome-center">
            <button type="button" className="chrome-nav ghost" aria-label="上一个标签" onClick={() => cycleFile(-1)}><ChevronLeft size={14} /></button>
            <button type="button" className="chrome-nav ghost" aria-label="下一个标签" onClick={() => cycleFile(1)}><ChevronRight size={14} /></button>
            <span className="chrome-title">RilleCode</span>
          </div>

          <div className="chrome-right">
            <button
              type="button"
              className="chrome-panel-toggle"
              title="设置"
              aria-label="打开设置"
              onClick={() => setIsSettingsOpen(true)}
            >
              <Settings size={14} />
            </button>
            <button
              type="button"
              className={'chrome-panel-toggle ' + (isSidePanelVisible ? 'active' : '')}
              title={isSidePanelVisible ? '隐藏左侧栏' : '显示左侧栏'}
              aria-label={isSidePanelVisible ? '隐藏左侧栏' : '显示左侧栏'}
              onClick={() => setIsSidePanelVisible(value => !value)}
            >
              <PanelLeft size={14} />
            </button>
            <button
              type="button"
              className={'chrome-panel-toggle ' + (isBottomPanelVisible ? 'active' : '')}
              title={isBottomPanelVisible ? '隐藏底部栏' : '显示底部栏'}
              aria-label={isBottomPanelVisible ? '隐藏底部栏' : '显示底部栏'}
              onClick={() => setIsBottomPanelVisible(value => !value)}
            >
              <PanelBottom size={14} />
            </button>
            <button
              type="button"
              className={'chrome-panel-toggle ' + (isRightPanelVisible ? 'active' : '')}
              title={isRightPanelVisible ? '隐藏右侧栏' : '显示右侧栏'}
              aria-label={isRightPanelVisible ? '隐藏右侧栏' : '显示右侧栏'}
              onClick={() => setIsRightPanelVisible(value => !value)}
            >
              <PanelRight size={14} />
            </button>
          </div>
        </header>

        <main className={
          'workbench ide-workbench '
          + (!isSidePanelVisible ? 'left-collapsed ' : '')
          + (!isRightPanelVisible ? 'right-collapsed ' : '')
          + (!isBottomPanelVisible ? 'bottom-collapsed' : '')
        } style={{ '--sidebar-width': `${sidebarWidth}px`, '--right-panel-width': `${rightPanelWidth}px` } as CSSProperties}>
          {isSidePanelVisible && (
            <>
              <aside className="sidebar ide-sidebar" style={{ width: sidebarWidth }}>
                {renderSideToolbar()}
                {renderSidebar()}
              </aside>

              <div
                className="sidebar-resize-handle"
                onPointerDown={(e) => {
                  e.preventDefault()
                  const startX = e.clientX
                  const startWidth = sidebarWidth
                  const onMove = (ev: PointerEvent) => {
                    const delta = ev.clientX - startX
                    setSidebarWidth(Math.max(200, Math.min(420, startWidth + delta)))
                  }
                  const onUp = () => {
                    document.removeEventListener('pointermove', onMove)
                    document.removeEventListener('pointerup', onUp)
                  }
                  document.addEventListener('pointermove', onMove)
                  document.addEventListener('pointerup', onUp)
                }}
              />
            </>
          )}

          <section className="editor-area">
            {state.openFiles.length > 0 && (
              <Tabs
                files={state.openFiles}
                activePath={gitDiffTarget ? null : state.activeFilePath}
                onSelect={setActiveFile}
                onClose={closeFile}
              />
            )}
            <div className="editor-container">
              {gitDiffTarget && state.workspace ? (
                <GitDiffViewer
                  key={gitDiffTarget.id}
                  workspace={state.workspace}
                  target={gitDiffTarget}
                />
              ) : activeFile ? (
                <Editor
                  key={activeFile.path}
                  path={activeFile.path}
                  language={getLanguage(activeFile.name)}
                  value={activeFile.content}
                  onChange={(v) => updateFileContent(activeFile.path, v ?? '')}
                  onSave={() => saveFile(activeFile.path)}
                  onEditorMount={(editor) => {
                    editorRef.current = editor
                    revealPendingPosition(editor, activeFile.path)
                  }}
                  onCursorPositionChange={setCursorPosition}
                  onDiagnosticsChange={setDiagnostics}
                  breakpointLines={breakpoints[activeFile.path] || []}
                  onBreakpointToggle={(line) => toggleBreakpoint(activeFile.path, line)}
                />
              ) : (
                <div className="empty-editor">
                  <div className="empty-cube" aria-hidden="true"><Box size={78} /></div>
                  <div className="empty-message">{emptyTitle}</div>
                  {!state.workspace && (
                    <button type="button" className="empty-add-folder" onClick={openWorkspace}>打开文件夹</button>
                  )}
                </div>
              )}
            </div>
            <TerminalPanel
              workspace={state.workspace}
              visible={isBottomPanelVisible}
              activeTab={activeBottomTab}
              diagnostics={visibleDiagnostics}
              breakpoints={debugBreakpoints}
              newSignal={terminalNewSignal}
              killSignal={terminalKillSignal}
              launchRequest={terminalLaunchRequest}
              onActiveTabChange={(tab) => showBottomPanel(tab)}
              onSelectDiagnostic={openDiagnostic}
              onHide={() => setIsBottomPanelVisible(false)}
              onTerminalSessionsEmpty={() => setIsBottomPanelVisible(false)}
            />
          </section>

          {isRightPanelVisible && (
            <>
              <div
                className="agent-resize-handle"
                onPointerDown={(e) => {
                  e.preventDefault()
                  const startX = e.clientX
                  const startWidth = rightPanelWidth
                  const onMove = (ev: PointerEvent) => {
                    const delta = startX - ev.clientX
                    setRightPanelWidth(Math.max(260, Math.min(560, startWidth + delta)))
                  }
                  const onUp = () => {
                    document.removeEventListener('pointermove', onMove)
                    document.removeEventListener('pointerup', onUp)
                  }
                  document.addEventListener('pointermove', onMove)
                  document.addEventListener('pointerup', onUp)
                }}
              />
              {renderAgentPanel()}
            </>
          )}
        </main>

        <ModelSettingsDialog open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

        {remoteFolderDialog && (
          <div className="remote-modal-overlay">
            <div className="remote-config-dialog remote-folder-dialog">
              <div className="remote-folder-header">
                <div>
                  <div className="remote-config-title">打开远程文件夹</div>
                  <div className="remote-auth-prompt">{remoteFolderDialog.connection.label}</div>
                </div>
              </div>
              <div className="remote-folder-toolbar">
                <button
                  type="button"
                  title="主目录"
                  onClick={() => void loadRemoteFolderEntries(remoteFolderDialog.connection, remoteFolderDialog.connection.home || '/')}
                >
                  <Home size={15} />
                </button>
                <button
                  type="button"
                  title="上一级"
                  onClick={() => void loadRemoteFolderEntries(remoteFolderDialog.connection, dirnameFromPath(remoteFolderDialog.value))}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  title="刷新"
                  onClick={() => void loadRemoteFolderEntries(remoteFolderDialog.connection, remoteFolderDialog.value)}
                >
                  <RefreshCw size={15} />
                </button>
                <input
                  autoFocus
                  className="remote-folder-input"
                  value={remoteFolderDialog.value}
                  onChange={event => setRemoteFolderDialog(prev => prev ? { ...prev, value: event.target.value, error: undefined } : prev)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') void loadRemoteFolderEntries(remoteFolderDialog.connection, remoteFolderDialog.value)
                    if (event.key === 'Escape') setRemoteFolderDialog(null)
                  }}
                />
              </div>
              {remoteFolderDialog.error && <pre className="panel-error">{remoteFolderDialog.error}</pre>}
              <div className="remote-folder-list" role="listbox" aria-label="远程文件夹">
                {remoteFolderDialog.isLoading ? (
                  <div className="remote-folder-empty">正在读取目录...</div>
                ) : remoteFolderDialog.entries.length === 0 ? (
                  <div className="remote-folder-empty">没有子文件夹</div>
                ) : (
                  remoteFolderDialog.entries.map(entry => (
                    <button
                      key={entry.path}
                      type="button"
                      className="remote-folder-row"
                      onClick={() => void loadRemoteFolderEntries(
                        remoteFolderDialog.connection,
                        entry.path || joinRemotePath(remoteFolderDialog.value, entry.name),
                      )}
                    >
                      <Folder size={15} />
                      <span>{entry.name}</span>
                    </button>
                  ))
                )}
              </div>
              <div className="remote-config-actions">
                <button type="button" onClick={() => void submitRemoteFolderDialog()}>打开</button>
                <button type="button" onClick={() => setRemoteFolderDialog(null)}>取消</button>
              </div>
            </div>
          </div>
        )}

        <StatusBar
          diagnostics={visibleDiagnostics}
          cursorLine={cursorPosition.line}
          cursorColumn={cursorPosition.column}
          problemsActive={isBottomPanelVisible && activeBottomTab === 'problems'}
          connectionLabel={connectionStatusLabel}
          isRemoteConnection={isRemoteConnectionStatus}
          onOpenProblems={() => showBottomPanel('problems')}
        />
      </div>
    </AppContext.Provider>
  )
}
