import { useState, useCallback, createContext, useContext, useEffect, useMemo, useRef } from 'react'
import type { editor as MonacoEditorApi } from 'monaco-editor'
import {
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Files,
  GitBranch,
  Search,
  Server,
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

// ── Types ────────────────────────────────────────────────────

export interface OpenFile {
  path: string
  name: string
  content: string
  isDirty: boolean
  originalContent: string
}

export interface AppState {
  workspacePath: string | null
  fileTree: FileEntry[]
  openFiles: OpenFile[]
  activeFilePath: string | null
}

export interface AppContextType extends AppState {
  setWorkspace: (path: string) => Promise<void>
  openFile: (path: string) => Promise<void>
  closeFile: (path: string) => void
  setActiveFile: (path: string) => void
  updateFileContent: (path: string, content: string) => void
  saveFile: (path: string) => Promise<void>
}

type SideView = 'explorer' | 'search' | 'git' | 'remote'
type BottomPanelTab = 'problems' | 'output' | 'debug' | 'terminal' | 'ports'

type TerminalLaunchRequest = {
  id: number
  profileId?: string
  sshHost?: string
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

function isActionItem(item: MenuItem): item is MenuActionItem {
  return item.type !== 'separator'
}

// ── App Component ────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState<AppState>({
    workspacePath: null,
    fileTree: [],
    openFiles: [],
    activeFilePath: null,
  })
  const [activeSideView, setActiveSideView] = useState<SideView>('explorer')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(false)
  const [activeBottomTab, setActiveBottomTab] = useState<BottomPanelTab>('terminal')
  const [terminalNewSignal, setTerminalNewSignal] = useState(0)
  const [terminalKillSignal, setTerminalKillSignal] = useState(0)
  const [terminalLaunchRequest, setTerminalLaunchRequest] = useState<TerminalLaunchRequest | null>(null)
  const [gitDiffTarget, setGitDiffTarget] = useState<GitDiffTarget | null>(null)
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 })
  const [diagnostics, setDiagnostics] = useState<EditorDiagnostic[]>([])
  const [breakpoints, setBreakpoints] = useState<Record<string, number[]>>({})
  const [sidebarWidth, setSidebarWidth] = useState(264)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MonacoEditorApi.IStandaloneCodeEditor | null>(null)
  const pendingRevealRef = useRef<{ path: string; line: number; column: number } | null>(null)

  const setWorkspace = useCallback(async (path: string) => {
    const tree = await window.rille.readDirectory(path)
    editorRef.current = null
    pendingRevealRef.current = null
    setGitDiffTarget(null)
    setCursorPosition({ line: 1, column: 1 })
    setDiagnostics([])
    setBreakpoints({})
    setState(prev => ({ ...prev, workspacePath: path, fileTree: tree, openFiles: [], activeFilePath: null }))
    setActiveSideView('explorer')
  }, [])

  const openWorkspace = useCallback(async () => {
    const p = await window.rille.openFolder()
    if (p) await setWorkspace(p)
  }, [setWorkspace])

  const refreshWorkspace = useCallback(async () => {
    if (!state.workspacePath) return
    const tree = await window.rille.readDirectory(state.workspacePath)
    setState(prev => ({ ...prev, fileTree: tree }))
  }, [state.workspacePath])

  const openFile = useCallback(async (path: string) => {
    setGitDiffTarget(null)
    const existing = state.openFiles.find(f => normalizePath(f.path) === normalizePath(path))
    if (existing) {
      setState(prev => ({ ...prev, activeFilePath: existing.path }))
      return
    }
    const content = await window.rille.readFile(path)
    const name = fileNameFromPath(path)
    const openFile: OpenFile = { path, name, content, isDirty: false, originalContent: content }
    setState(prev => ({
      ...prev,
      openFiles: [...prev.openFiles, openFile],
      activeFilePath: path,
    }))
  }, [state.openFiles])

  const openFileFromDialog = useCallback(async () => {
    const path = await window.rille.openFileDialog()
    if (path) await openFile(path)
  }, [openFile])

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
    await window.rille.writeFile(path, file.content)
    setState(prev => ({
      ...prev,
      openFiles: prev.openFiles.map(f =>
        f.path === path ? { ...f, isDirty: false, originalContent: f.content } : f
      ),
    }))
  }, [state.openFiles])

  const saveAllFiles = useCallback(async () => {
    const dirtyFiles = state.openFiles.filter(file => file.isDirty)
    await Promise.all(dirtyFiles.map(file => window.rille.writeFile(file.path, file.content)))
    const savedPaths = new Set(dirtyFiles.map(file => file.path))
    setState(prev => ({
      ...prev,
      openFiles: prev.openFiles.map(file =>
        savedPaths.has(file.path) ? { ...file, isDirty: false, originalContent: file.content } : file
      ),
    }))
  }, [state.openFiles])

  const selectedOpenFile = state.openFiles.find(f => f.path === state.activeFilePath)
  const activeFile = gitDiffTarget ? undefined : selectedOpenFile
  const workspaceName = state.workspacePath?.split(/[/\\]/).pop() ?? 'RilleCode'
  const workspaceTitle = workspaceName.toUpperCase()

  const saveFileAs = useCallback(async () => {
    if (!activeFile) return
    const targetPath = await window.rille.saveFileDialog(activeFile.path)
    if (!targetPath) return

    await window.rille.writeFile(targetPath, activeFile.content)
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
  }, [activeFile])

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
    setWorkspace, openFile, closeFile, setActiveFile, updateFileContent, saveFile,
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
      return <SearchPanel rootPath={state.workspacePath} onOpenFile={openFile} />
    }

    if (activeSideView === 'git') {
      return <GitPanel rootPath={state.workspacePath} onOpenDiff={openGitDiff} />
    }

    if (activeSideView === 'remote') {
      return <RemotePanel onOpenTerminal={openTerminalProfile} />
    }

    return (
      <>
        <div className="side-view-title-row explorer-title">
          <button type="button" className="workspace-root">
            <ChevronDown size={14} />
            <span>{state.workspacePath ? workspaceTitle : '资源管理器'}</span>
          </button>
          <button type="button" className="side-action" onClick={state.workspacePath ? refreshWorkspace : openWorkspace}>
            {state.workspacePath ? '刷新' : '打开'}
          </button>
        </div>
        {state.workspacePath ? (
          <>
            <FileTree
              entries={state.fileTree}
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

  const emptyTitle = !state.workspacePath
    ? '打开文件夹或文件开始使用'
    : activeSideView === 'search'
      ? '在左侧搜索项目内容'
      : activeSideView === 'git'
        ? '在左侧管理 Git 变更'
        : activeSideView === 'remote'
          ? '在左侧连接远程环境'
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
            <button type="button" className="chrome-nav ghost" aria-label="Previous tab" onClick={() => cycleFile(-1)}><ChevronLeft size={14} /></button>
            <button type="button" className="chrome-nav ghost" aria-label="Next tab" onClick={() => cycleFile(1)}><ChevronRight size={14} /></button>
            <span className="chrome-title">RilleCode</span>
          </div>

          <div className="chrome-right" />
        </header>

        <main className="workbench">
          <aside className="activity-bar" aria-label="Activity bar">
            <button type="button" className={'activity-item ' + (activeSideView === 'explorer' ? 'active' : '')} title="Explorer" onClick={() => setActiveSideView('explorer')}><Files size={18} /></button>
            <button type="button" className={'activity-item ' + (activeSideView === 'search' ? 'active' : '')} title="Search" onClick={() => setActiveSideView('search')}><Search size={18} /></button>
            <button type="button" className={'activity-item ' + (activeSideView === 'git' ? 'active' : '')} title="Source Control" onClick={() => setActiveSideView('git')}><GitBranch size={18} /></button>
            <button type="button" className={'activity-item ' + (activeSideView === 'remote' ? 'active' : '')} title="Remote" onClick={() => setActiveSideView('remote')}><Server size={18} /></button>
          </aside>

          <aside className="sidebar" style={{ width: sidebarWidth }}>
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
                setSidebarWidth(Math.max(170, Math.min(500, startWidth + delta)))
              }
              const onUp = () => {
                document.removeEventListener('pointermove', onMove)
                document.removeEventListener('pointerup', onUp)
              }
              document.addEventListener('pointermove', onMove)
              document.addEventListener('pointerup', onUp)
            }}
          />

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
              {gitDiffTarget && state.workspacePath ? (
                <GitDiffViewer
                  key={gitDiffTarget.id}
                  rootPath={state.workspacePath}
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
                  {!state.workspacePath && (
                    <button type="button" className="empty-add-folder" onClick={openWorkspace}>打开文件夹</button>
                  )}
                </div>
              )}
            </div>
            <TerminalPanel
              cwd={state.workspacePath}
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
            />
          </section>
        </main>

        <StatusBar
          diagnostics={visibleDiagnostics}
          cursorLine={cursorPosition.line}
          cursorColumn={cursorPosition.column}
          problemsActive={isBottomPanelVisible && activeBottomTab === 'problems'}
          onOpenProblems={() => showBottomPanel('problems')}
        />
      </div>
    </AppContext.Provider>
  )
}
