import { useState, useCallback, createContext, useContext, useEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { editor as MonacoEditorApi } from 'monaco-editor'
import {
  ArrowUp,
  Box,
  ChevronDown,
  Files,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  Home,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Settings,
  PanelBottom,
  PanelLeft,
  PanelRight,
  X,
} from 'lucide-react'
import { FileTree } from './components/FileTree'
import { Tabs } from './components/Tabs'
import { Editor, type EditorDiagnostic } from './components/Editor'
import { StatusBar, type StatusDiagnostic } from './components/StatusBar'
import { SearchPanel } from './components/SearchPanel'
import { GitPanel } from './components/GitPanel'
import { GitDiffViewer, type GitDiffTarget } from './components/GitDiffViewer'
import { TerminalPanel } from './components/TerminalPanel'
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

type BottomPanelTab = 'problems' | 'output' | 'debug' | 'terminal' | 'ports'
type RightTool = 'launcher' | 'files' | 'review' | 'search' | 'browser'
type OpenRightTool = Exclude<RightTool, 'launcher' | 'browser'>

type GitMeta = Pick<GitStatusResult, 'isRepo' | 'repoRoot' | 'branch' | 'remoteName' | 'error'>

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

function workspaceRelativePathSegments(filePath: string, workspacePath?: string | null): string[] {
  const normalizedFile = normalizePath(filePath)
  const normalizedWorkspace = normalizePath(workspacePath ?? '').replace(/\/+$/, '')
  const relativePath = normalizedWorkspace && normalizedFile.toLowerCase().startsWith(`${normalizedWorkspace.toLowerCase()}/`)
    ? normalizedFile.slice(normalizedWorkspace.length + 1)
    : normalizedFile
  return relativePath.split('/').filter(Boolean)
}

function workspaceKey(workspace: WorkspaceLocation | null): string {
  if (!workspace) return 'none'
  return `${workspace.kind}:${workspace.path}`
}

function sessionTimeLabel(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分`
  if (diff < day) return `${Math.floor(diff / hour)} 小时`
  return `${Math.floor(diff / day)} 天`
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
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSidePanelVisible, setIsSidePanelVisible] = useState(() => readStoredBoolean('rille:side-panel-visible', true))
  const [isRightPanelVisible, setIsRightPanelVisible] = useState(() => readStoredBoolean('rille:file-panel-visible:v2', false))
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(() => readStoredBoolean('rille:bottom-panel-visible:v3', false))
  const [activeBottomTab, setActiveBottomTab] = useState<BottomPanelTab>('terminal')
  const [activeRightTool, setActiveRightTool] = useState<RightTool>('launcher')
  const [openRightTools, setOpenRightTools] = useState<OpenRightTool[]>([])
  const [isRightPanelDetailExpanded, setIsRightPanelDetailExpanded] = useState(false)
  const [rightBrowserWidth, setRightBrowserWidth] = useState(300)
  const [terminalNewSignal, setTerminalNewSignal] = useState(0)
  const [terminalKillSignal, setTerminalKillSignal] = useState(0)
  const [terminalLaunchRequest, setTerminalLaunchRequest] = useState<TerminalLaunchRequest | null>(null)
  const [gitDiffTarget, setGitDiffTarget] = useState<GitDiffTarget | null>(null)
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 })
  const [diagnostics, setDiagnostics] = useState<EditorDiagnostic[]>([])
  const [breakpoints, setBreakpoints] = useState<Record<string, number[]>>({})
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [rightPanelWidth, setRightPanelWidth] = useState(520)
  const [remoteFolderConnection, setRemoteFolderConnection] = useState<RemoteConnection | null>(null)
  const [remoteFolderDialog, setRemoteFolderDialog] = useState<RemoteFolderDialogState | null>(null)
  const [agentSessions, setAgentSessions] = useState<AgentSessionSummary[]>([])
  const [selectedAgentSession, setSelectedAgentSession] = useState<AgentSession | null>(null)
  const [isAgentSessionsLoading, setIsAgentSessionsLoading] = useState(false)
  const [sessionContextMenu, setSessionContextMenu] = useState<{ session: AgentSessionSummary; x: number; y: number } | null>(null)
  const [gitMeta, setGitMeta] = useState<GitMeta | null>(null)
  const [collapsedProjectKeys, setCollapsedProjectKeys] = useState<Set<string>>(() => new Set())
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

  const loadWorkspaceContext = useCallback(async (workspace: WorkspaceLocation | null) => {
    editorRef.current = null
    pendingRevealRef.current = null
    setGitDiffTarget(null)
    setCursorPosition({ line: 1, column: 1 })
    setDiagnostics([])
    setBreakpoints({})
    setGitMeta(null)
    setActiveRightTool('launcher')
    setOpenRightTools([])
    setIsRightPanelDetailExpanded(false)

    if (!workspace) {
      setState(prev => ({ ...prev, workspace: null, fileTree: [], openFiles: [], activeFilePath: null }))
      return
    }

    const tree = await window.rille.readDirectory(workspace.path, workspace)
    setState(prev => ({ ...prev, workspace, fileTree: tree, openFiles: [], activeFilePath: null }))
  }, [])

  const selectAgentSession = useCallback(async (summary: AgentSessionSummary) => {
    if (selectedAgentSession?.id === summary.id) return
    if (summary.status === 'archived') {
      if (!window.confirm('此对话已归档。要取消归档并打开吗？')) return
      const restored = await window.rille.agentUnarchiveSession(summary.id)
      if (!restored) return
      setSelectedAgentSession(restored)
      await loadWorkspaceContext(restored.workspace)
      void refreshAgentSessions()
      return
    }
    const session: AgentSession = {
      id: summary.id,
      title: summary.title,
      workspace: summary.workspace,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      status: summary.status === 'running' || summary.status === 'waiting_approval' ? 'idle' : summary.status,
      permissionMode: summary.permissionMode,
    }
    setSelectedAgentSession(session)
    await loadWorkspaceContext(session.workspace)
    void refreshAgentSessions()
  }, [loadWorkspaceContext, refreshAgentSessions, selectedAgentSession?.id])

  const createAgentSessionForWorkspace = useCallback(async () => {
    const workspace = selectedAgentSession ? selectedAgentSession.workspace : state.workspace
    const session = await window.rille.agentCreateSession(workspace, 'ask')
    setSelectedAgentSession(session)
    await loadWorkspaceContext(session.workspace)
    void refreshAgentSessions()
  }, [loadWorkspaceContext, refreshAgentSessions, selectedAgentSession, state.workspace])

  const setWorkspace = useCallback(async (workspace: WorkspaceLocation) => {
    setSelectedAgentSession(null)
    await loadWorkspaceContext(workspace)
  }, [loadWorkspaceContext])

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
    setActiveRightTool('files')
    setOpenRightTools(prev => prev.includes('files') ? prev : [...prev, 'files'])
    setIsRightPanelDetailExpanded(true)
    setIsRightPanelVisible(true)
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
  const activeFile = selectedOpenFile
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
    window.localStorage.setItem('rille:file-panel-visible:v2', String(isRightPanelVisible))
  }, [isRightPanelVisible])

  useEffect(() => {
    window.localStorage.setItem('rille:bottom-panel-visible:v3', String(isBottomPanelVisible))
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
          ? { ...item, lastMessage }
          : item))
      }
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    let cancelled = false
    window.rille.agentResumeLastSession(null)
      .then(async session => {
        if (cancelled) return
        if (session) {
          setSelectedAgentSession(session)
          await loadWorkspaceContext(session.workspace)
        }
        void refreshAgentSessions()
      })
      .catch(() => {
        if (!cancelled) setSelectedAgentSession(null)
      })
    return () => {
      cancelled = true
    }
  }, [loadWorkspaceContext, refreshAgentSessions])

  useEffect(() => {
    let cancelled = false
    const workspace = state.workspace
    if (!workspace) {
      setGitMeta(null)
      return
    }
    window.rille.gitStatus(workspace.path, workspace)
      .then(status => {
        if (!cancelled) setGitMeta({
          isRepo: status.isRepo,
          repoRoot: status.repoRoot,
          branch: status.branch,
          remoteName: status.remoteName,
          error: status.error,
        })
      })
      .catch(() => {
        if (!cancelled) setGitMeta({ isRepo: false, repoRoot: '', branch: '' })
      })
    return () => {
      cancelled = true
    }
  }, [state.workspace])

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

  useEffect(() => {
    if (!sessionContextMenu) return
    const closeMenu = () => setSessionContextMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSessionContextMenu(null)
    }
    window.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [sessionContextMenu])

  const renameAgentSession = useCallback(async (session: AgentSessionSummary) => {
    const currentTitle = session.title || session.lastMessage || '新对话'
    const nextTitle = window.prompt('重命名对话', currentTitle)
    if (nextTitle === null) return
    const title = nextTitle.trim()
    if (!title || title === session.title) return
    const updated = await window.rille.agentRenameSession(session.id, title)
    setAgentSessions(prev => prev.map(item => item.id === session.id ? { ...item, title, updatedAt: updated?.updatedAt ?? Date.now() } : item))
    setSelectedAgentSession(prev => prev?.id === session.id && updated ? updated : prev)
    void refreshAgentSessions()
  }, [refreshAgentSessions])

  const deleteAgentSession = useCallback(async (session: AgentSessionSummary) => {
    const label = session.title || session.lastMessage || '这个对话'
    if (!window.confirm(`删除“${label}”？此操作不可恢复。`)) return
    await window.rille.agentDeleteSession(session.id)
    setAgentSessions(prev => prev.filter(item => item.id !== session.id))
    if (selectedAgentSession?.id === session.id) {
      setSelectedAgentSession(null)
      await loadWorkspaceContext(null)
    }
    void refreshAgentSessions()
  }, [loadWorkspaceContext, refreshAgentSessions, selectedAgentSession?.id])

  const archiveAgentSession = useCallback(async (session: AgentSessionSummary) => {
    const updated = session.status === 'archived'
      ? await window.rille.agentUnarchiveSession(session.id)
      : await window.rille.agentArchiveSession(session.id)
    if (!updated) return
    setAgentSessions(prev => prev.map(item => item.id === session.id ? { ...item, status: updated.status, updatedAt: updated.updatedAt } : item))
    if (selectedAgentSession?.id === session.id) {
      if (updated.status === 'archived') {
        setSelectedAgentSession(null)
        await loadWorkspaceContext(null)
      } else {
        setSelectedAgentSession(updated)
        await loadWorkspaceContext(updated.workspace)
      }
    }
    void refreshAgentSessions()
  }, [loadWorkspaceContext, refreshAgentSessions, selectedAgentSession?.id])

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
    setActiveRightTool('review')
    setOpenRightTools(prev => prev.includes('review') ? prev : [...prev, 'review'])
    setIsRightPanelDetailExpanded(true)
    setIsRightPanelVisible(true)
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
        { label: '文件', action: () => { setIsRightPanelVisible(true); setOpenRightTools(prev => prev.includes('files') ? prev : [...prev, 'files']); setActiveRightTool('files') } },
        { label: '搜索', action: () => { setIsRightPanelVisible(true); setOpenRightTools(prev => prev.includes('search') ? prev : [...prev, 'search']); setActiveRightTool('search') } },
        { label: '审查', action: () => { setIsRightPanelVisible(true); setOpenRightTools(prev => prev.includes('review') ? prev : [...prev, 'review']); setActiveRightTool('review') } },
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

  const projectSessionGroups = useMemo(() => {
    const groups = new Map<string, { workspace: WorkspaceLocation; sessions: AgentSessionSummary[] }>()
    for (const session of agentSessions) {
      if (session.status === 'archived') continue
      if (!session.workspace) continue
      const key = workspaceKey(session.workspace)
      const existing = groups.get(key)
      if (existing) {
        existing.sessions.push(session)
      } else {
        groups.set(key, { workspace: session.workspace, sessions: [session] })
      }
    }
    return [...groups.values()].sort((a, b) => {
      const latestA = Math.max(...a.sessions.map(session => session.updatedAt))
      const latestB = Math.max(...b.sessions.map(session => session.updatedAt))
      return latestB - latestA
    })
  }, [agentSessions])

  const plainSessions = useMemo(
    () => agentSessions.filter(session => !session.workspace && session.status !== 'archived'),
    [agentSessions],
  )

  const archivedSessions = useMemo(
    () => agentSessions.filter(session => session.status === 'archived'),
    [agentSessions],
  )

  const toggleProjectGroup = useCallback((key: string) => {
    setCollapsedProjectKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const renderSessionItem = (session: AgentSessionSummary) => (
    <button
      key={session.id}
      type="button"
      className={'agent-session-item ' + (selectedAgentSession?.id === session.id ? 'active ' : '') + session.status}
      onClick={() => void selectAgentSession(session)}
      onContextMenu={(event) => {
        event.preventDefault()
        setSessionContextMenu({ session, x: event.clientX, y: event.clientY })
      }}
    >
      <span className="agent-session-label">{session.lastMessage || session.title || '新对话'}</span>
      <span className="agent-session-time">{sessionTimeLabel(session.updatedAt)}</span>
    </button>
  )

  const renderSidebar = () => (
    <div className="conversation-sidebar">
      <button type="button" className="conversation-new-button" onClick={() => void createAgentSessionForWorkspace()}>
        <Plus size={15} />
        <span>新对话</span>
      </button>

      <div className="conversation-sidebar-scroll">
        <section className="conversation-sidebar-section">
          <div className="conversation-sidebar-heading">项目</div>
          {isAgentSessionsLoading && agentSessions.length === 0 ? (
            <div className="conversation-empty">正在读取对话...</div>
          ) : projectSessionGroups.length === 0 ? (
            <div className="conversation-empty">暂无项目</div>
          ) : (
            projectSessionGroups.map(group => {
              const key = workspaceKey(group.workspace)
              const isExpanded = !collapsedProjectKeys.has(key)
              return (
                <div className={'project-session-group ' + (isExpanded ? 'expanded' : 'collapsed')} key={key}>
                  <button
                    type="button"
                    className="project-session-title"
                    aria-expanded={isExpanded}
                    onClick={() => toggleProjectGroup(key)}
                  >
                    {isExpanded ? <FolderOpen size={17} /> : <Folder size={17} />}
                    <span>{group.workspace.label || fileNameFromPath(group.workspace.path)}</span>
                  </button>
                  {isExpanded && (
                    <div className="project-session-list">
                      {group.sessions.map(renderSessionItem)}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </section>

        <section className="conversation-sidebar-section plain">
          <div className="conversation-sidebar-heading">对话</div>
          {plainSessions.length === 0 ? (
            <div className="conversation-empty">暂无聊天</div>
          ) : (
            plainSessions.map(renderSessionItem)
          )}
        </section>

        {archivedSessions.length > 0 && (
          <section className="conversation-sidebar-section plain">
            <div className="conversation-sidebar-heading">归档</div>
            {archivedSessions.map(renderSessionItem)}
          </section>
        )}
      </div>
    </div>
  )

  const renderAgentPanel = () => (
    <AgentPanel
      workspace={state.workspace}
      gitMeta={gitMeta}
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

  const renderFileWorkspacePanel = () => {
    const hasEditor = Boolean(activeFile)
    const hasDiff = Boolean(gitDiffTarget && state.workspace)
    const hasProject = Boolean(state.workspace)
    const hasGit = Boolean(gitMeta?.isRepo)
    const workspaceLabel = state.workspace?.label || (state.workspace ? fileNameFromPath(state.workspace.path) : '')
    const activePathSegments = activeFile
      ? workspaceRelativePathSegments(activeFile.path, state.workspace?.path)
      : []
    const rightToolLabels: Record<OpenRightTool, string> = {
      files: '文件',
      review: '源代码管理',
      search: '搜索',
    }
    const activateRightTool = (tool: RightTool) => {
      if (tool === 'browser') return
      if (tool !== 'launcher') {
        setOpenRightTools(prev => prev.includes(tool) ? prev : [...prev, tool])
      }
      setActiveRightTool(tool)
      setIsRightPanelDetailExpanded(false)
    }
    const closeRightTool = (tool: OpenRightTool) => {
      setOpenRightTools(prev => prev.filter(item => item !== tool))
      if (activeRightTool === tool) {
        setActiveRightTool('launcher')
        setIsRightPanelDetailExpanded(false)
      }
    }
    const renderRightToolTabs = () => openRightTools.length > 0 && (
      <div className="right-panel-tabs" role="tablist" aria-label="右侧面板">
        <div className="right-panel-tabs-scroll">
          {openRightTools.map(tool => (
            <button
              type="button"
              key={tool}
              role="tab"
              aria-selected={activeRightTool === tool}
              className={'right-panel-tab ' + (activeRightTool === tool ? 'active' : '')}
              onClick={() => {
                setActiveRightTool(tool)
                setIsRightPanelDetailExpanded(false)
              }}
            >
              <span>{rightToolLabels[tool]}</span>
              <span
                role="button"
                tabIndex={0}
                className="right-panel-tab-close"
                aria-label={`关闭${rightToolLabels[tool]}`}
                onClick={(event) => {
                  event.stopPropagation()
                  closeRightTool(tool)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    closeRightTool(tool)
                  }
                }}
              >
                <X size={12} />
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="right-panel-tab-add"
          aria-label="添加右侧面板"
          onClick={() => {
            setActiveRightTool('launcher')
            setIsRightPanelDetailExpanded(false)
          }}
        >
          <Plus size={15} />
        </button>
      </div>
    )

    const toolButtons: Array<{ tool: RightTool; label: string; description: string; icon: typeof Files; disabled?: boolean }> = [
      ...(hasProject ? [{ tool: 'files' as const, label: '文件', description: '浏览项目文件', icon: Files }] : []),
      ...(hasProject && hasGit ? [{ tool: 'review' as const, label: '审查', description: '查看代码更改', icon: GitBranch }] : []),
      ...(hasProject ? [{ tool: 'search' as const, label: '搜索', description: '搜索项目内容', icon: Search }] : []),
      { tool: 'browser', label: '浏览器', description: '打开网站', icon: Globe, disabled: true },
    ]

    const renderToolLauncher = () => (
      <div className="right-tool-launcher" aria-label="项目工具">
        {toolButtons.map(item => {
          const Icon = item.icon
          return (
            <button
              type="button"
              key={item.tool}
              className={'right-tool-card ' + (activeRightTool === item.tool ? 'active' : '')}
              disabled={item.disabled}
              onClick={() => activateRightTool(item.tool)}
            >
              <Icon size={25} />
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          )
        })}
      </div>
    )

    return (
      <aside
        className={'file-workspace-panel right-tool-panel ' + (isRightPanelDetailExpanded ? 'detail-expanded' : '')}
        aria-label="项目工具"
        style={{ '--right-browser-width': `${rightBrowserWidth}px` } as CSSProperties}
      >
        {renderRightToolTabs()}
        {activeRightTool === 'files' && state.workspace && (
          <div className="right-workspace-pathbar">
            <span>{workspaceLabel}</span>
            {activePathSegments.map((segment, index) => (
              <span className="path-segment-wrap" key={`${segment}:${index}`}>
                <ChevronDown size={13} className="path-separator" />
                {index === activePathSegments.length - 1 ? (
                  <strong>{segment}</strong>
                ) : (
                  <span>{segment}</span>
                )}
              </span>
            ))}
          </div>
        )}
        <div className="file-workspace-body">
          {activeRightTool === 'launcher' && renderToolLauncher()}

          {activeRightTool === 'browser' && (
            <div className="file-panel-empty browser-placeholder">
              <Globe size={34} />
              <span>浏览器功能暂未实现</span>
            </div>
          )}

          {activeRightTool === 'files' && (
            <section className="file-workspace-section file-panel-tree" aria-label="文件">
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
                <FileTree
                  entries={state.fileTree}
                  workspace={state.workspace}
                  onSelectFile={openFile}
                  activePath={state.activeFilePath}
                />
              ) : (
                <div className="panel-empty">打开文件夹后可以浏览文件。</div>
              )}
            </section>
          )}

          {activeRightTool === 'files' && hasEditor && isRightPanelDetailExpanded && (
            <>
            <div
              className="right-detail-resize-handle"
              onPointerDown={(event) => {
                event.preventDefault()
                const startX = event.clientX
                const startWidth = rightBrowserWidth
                const onMove = (moveEvent: PointerEvent) => {
                  const delta = startX - moveEvent.clientX
                  setRightBrowserWidth(Math.max(220, Math.min(520, startWidth + delta)))
                }
                const onUp = () => {
                  document.removeEventListener('pointermove', onMove)
                  document.removeEventListener('pointerup', onUp)
                }
                document.addEventListener('pointermove', onMove)
                document.addEventListener('pointerup', onUp)
              }}
            />
            <section className="file-workspace-section file-panel-editor" aria-label="编辑器">
              {state.openFiles.length > 0 && (
                <Tabs
                  files={state.openFiles}
                  activePath={state.activeFilePath}
                  onSelect={(path) => {
                    setActiveRightTool('files')
                    setIsRightPanelDetailExpanded(true)
                    setActiveFile(path)
                  }}
                  onClose={closeFile}
                />
              )}
              <div className="editor-container">
                {activeFile ? (
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
                  <div className="file-panel-empty">
                    <Files size={34} />
                    <span>从文件树选择文件</span>
                  </div>
                )}
              </div>
            </section>
            </>
          )}

          {activeRightTool === 'review' && (
            <section className="file-workspace-section review-panel-section" aria-label="审查">
              <GitPanel workspace={state.workspace} onOpenDiff={openGitDiff} />
            </section>
          )}

          {activeRightTool === 'review' && hasDiff && isRightPanelDetailExpanded && (
            <>
            <div
              className="right-detail-resize-handle"
              onPointerDown={(event) => {
                event.preventDefault()
                const startX = event.clientX
                const startWidth = rightBrowserWidth
                const onMove = (moveEvent: PointerEvent) => {
                  const delta = startX - moveEvent.clientX
                  setRightBrowserWidth(Math.max(220, Math.min(520, startWidth + delta)))
                }
                const onUp = () => {
                  document.removeEventListener('pointermove', onMove)
                  document.removeEventListener('pointerup', onUp)
                }
                document.addEventListener('pointermove', onMove)
                document.addEventListener('pointerup', onUp)
              }}
            />
            <section className="file-workspace-section file-panel-diff" aria-label="Diff">
              {gitDiffTarget && state.workspace ? (
                <GitDiffViewer
                  key={gitDiffTarget.id}
                  workspace={state.workspace}
                  target={gitDiffTarget}
                />
              ) : (
                <div className="file-panel-empty">
                  <GitBranch size={34} />
                  <span>从 Git 面板选择一个 diff</span>
                </div>
              )}
            </section>
            </>
          )}

          {activeRightTool === 'search' && (
            <section className="file-workspace-section search-panel-section" aria-label="搜索">
              <SearchPanel workspace={state.workspace} onOpenFile={openFile} />
            </section>
          )}

          {activeRightTool === 'search' && hasEditor && isRightPanelDetailExpanded && (
            <>
            <div
              className="right-detail-resize-handle"
              onPointerDown={(event) => {
                event.preventDefault()
                const startX = event.clientX
                const startWidth = rightBrowserWidth
                const onMove = (moveEvent: PointerEvent) => {
                  const delta = startX - moveEvent.clientX
                  setRightBrowserWidth(Math.max(220, Math.min(520, startWidth + delta)))
                }
                const onUp = () => {
                  document.removeEventListener('pointermove', onMove)
                  document.removeEventListener('pointerup', onUp)
                }
                document.addEventListener('pointermove', onMove)
                document.addEventListener('pointerup', onUp)
              }}
            />
            <section className="file-workspace-section file-panel-editor" aria-label="编辑器">
              {state.openFiles.length > 0 && (
                <Tabs
                  files={state.openFiles}
                  activePath={state.activeFilePath}
                  onSelect={(path) => {
                    setActiveRightTool('search')
                    setIsRightPanelDetailExpanded(true)
                    setActiveFile(path)
                  }}
                  onClose={closeFile}
                />
              )}
              <div className="editor-container">
                {activeFile && (
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
                )}
              </div>
            </section>
            </>
          )}
        </div>
      </aside>
    )
  }

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
              title={isRightPanelVisible ? '隐藏文件栏' : '显示文件栏'}
              aria-label={isRightPanelVisible ? '隐藏文件栏' : '显示文件栏'}
              onClick={() => {
                setIsRightPanelVisible(value => {
                  const next = !value
                  if (!next) {
                    setActiveRightTool('launcher')
                    setIsRightPanelDetailExpanded(false)
                  }
                  return next
                })
              }}
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
        } style={{
          '--sidebar-width': `${sidebarWidth}px`,
          '--right-panel-width': `${rightPanelWidth}px`,
        } as CSSProperties}>
          {isSidePanelVisible && (
            <>
              <aside className="sidebar ide-sidebar" style={{ width: sidebarWidth }}>
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

          <section className="editor-area conversation-area">
            <div className="conversation-panel-shell">
              {renderAgentPanel()}
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
                    setRightPanelWidth(Math.max(300, Math.min(900, startWidth + delta)))
                  }
                  const onUp = () => {
                    document.removeEventListener('pointermove', onMove)
                    document.removeEventListener('pointerup', onUp)
                  }
                  document.addEventListener('pointermove', onMove)
                  document.addEventListener('pointerup', onUp)
                }}
              />
              {renderFileWorkspacePanel()}
            </>
          )}
        </main>

        <ModelSettingsDialog open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

        {sessionContextMenu && (
          <div
            className="agent-session-context-menu"
            style={{ left: sessionContextMenu.x, top: sessionContextMenu.y }}
            onPointerDown={event => event.stopPropagation()}
            role="menu"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const session = sessionContextMenu.session
                setSessionContextMenu(null)
                void renameAgentSession(session)
              }}
            >
              重命名
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const session = sessionContextMenu.session
                setSessionContextMenu(null)
                void archiveAgentSession(session)
              }}
            >
              {sessionContextMenu.session.status === 'archived' ? '取消归档' : '归档'}
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                const session = sessionContextMenu.session
                setSessionContextMenu(null)
                void deleteAgentSession(session)
              }}
            >
              删除
            </button>
          </div>
        )}

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
