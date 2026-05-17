import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import {
  Bug,
  ChevronDown,
  Copy,
  CornerDownRight,
  ExternalLink,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  SplitSquareHorizontal,
  Square,
  StepForward,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { StatusDiagnostic } from './StatusBar'

export type BottomPanelTab = 'problems' | 'output' | 'debug' | 'terminal' | 'ports'

interface Props {
  cwd: string | null
  visible: boolean
  activeTab: BottomPanelTab
  diagnostics: StatusDiagnostic[]
  breakpoints: DebugBreakpoint[]
  newSignal: number
  killSignal: number
  launchRequest?: TerminalLaunchRequest | null
  onActiveTabChange: (tab: BottomPanelTab) => void
  onSelectDiagnostic: (diagnostic: StatusDiagnostic) => void | Promise<void>
  onHide: () => void
}

interface TerminalLaunchRequest {
  id: number
  profileId?: string
  sshHost?: string
}

interface TerminalViewSession extends TerminalSession {
  status: 'running' | 'exited'
  exitCode?: number
  splitGroupId: string
  sshHost?: string
}

interface CreateTerminalOptions {
  splitWithActive?: boolean
  sshHost?: string
}

interface DebugConsoleEntry {
  id: string
  level: 'info' | 'warning' | 'error'
  message: string
}

interface DebugFormState {
  name: string
  adapterCommand: string
  adapterArgs: string
  launchJson: string
}

const PANEL_TABS: Array<{ id: BottomPanelTab; label: string }> = [
  { id: 'problems', label: '问题' },
  { id: 'output', label: '输出' },
  { id: 'debug', label: '调试控制台' },
  { id: 'terminal', label: '终端' },
  { id: 'ports', label: '端口' },
]

const OUTPUT_CHANNELS: Array<'All' | OutputChannel> = ['All', 'Git', 'Terminal', 'Debug', 'Ports', 'System']

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

function shortName(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return iso
  }
}

function parseArgs(value: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: string | null = null
  let escaped = false
  for (const char of value) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) args.push(current)
  return args
}

function terminalTheme() {
  return {
    background: '#FBFCFE',
    foreground: '#1D2433',
    cursor: '#2563EB',
    selectionBackground: '#D9E7FF',
    black: '#111827',
    red: '#dc2626',
    green: '#0f8f61',
    yellow: '#b7791f',
    blue: '#2563eb',
    magenta: '#9333ea',
    cyan: '#0891b2',
    white: '#f8fafc',
    brightBlack: '#64748b',
    brightRed: '#ef4444',
    brightGreen: '#10b981',
    brightYellow: '#f59e0b',
    brightBlue: '#3b82f6',
    brightMagenta: '#a855f7',
    brightCyan: '#06b6d4',
    brightWhite: '#ffffff',
  }
}

function EmptyPanel({ children }: { children: string }) {
  return <div className="bottom-panel-empty">{children}</div>
}

export function TerminalPanel({
  cwd,
  visible,
  activeTab,
  diagnostics,
  breakpoints,
  newSignal,
  killSignal,
  launchRequest,
  onActiveTabChange,
  onSelectDiagnostic,
  onHide,
}: Props) {
  const panelRef = useRef<HTMLElement | null>(null)
  const terminalsRef = useRef<Map<string, Terminal>>(new Map())
  const fitAddonsRef = useRef<Map<string, FitAddon>>(new Map())
  const terminalContainersRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const openedTerminalsRef = useRef<Set<string>>(new Set())
  const lastNewSignalRef = useRef(newSignal)
  const lastKillSignalRef = useRef(killSignal)
  const lastLaunchRequestIdRef = useRef(launchRequest?.id ?? 0)
  const [profiles, setProfiles] = useState<TerminalProfile[]>([])
  const [terminalSessions, setTerminalSessions] = useState<TerminalViewSession[]>([])
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const [draggedTerminalId, setDraggedTerminalId] = useState<string | null>(null)
  const [terminalMessage, setTerminalMessage] = useState<string | null>(null)
  const [outputEntries, setOutputEntries] = useState<OutputEntry[]>([])
  const [outputChannel, setOutputChannel] = useState<'All' | OutputChannel>('All')
  const [ports, setPorts] = useState<PortEntry[]>([])
  const [portsError, setPortsError] = useState<string | null>(null)
  const [isPortsLoading, setIsPortsLoading] = useState(false)
  const [debugForm, setDebugForm] = useState<DebugFormState>({
    name: 'Generic Debug',
    adapterCommand: '',
    adapterArgs: '',
    launchJson: '{\n  "program": ""\n}',
  })
  const [debugSession, setDebugSession] = useState<DebugSessionState | null>(null)
  const [debugConsole, setDebugConsole] = useState<DebugConsoleEntry[]>([])
  const [debugInput, setDebugInput] = useState('')
  const [debugError, setDebugError] = useState<string | null>(null)

  const normalizedProfiles = useMemo<TerminalProfile[]>(() => {
    const safeProfiles = profiles.map(profile => ({ ...profile, kind: profile.kind || 'local' }))
    if (safeProfiles.length > 0) return safeProfiles
    return [{
      id: 'cmd',
      label: 'Command Prompt',
      path: 'cmd.exe',
      source: 'fallback',
      kind: 'local',
      isDefault: true,
    }]
  }, [profiles])
  const activeTerminal = useMemo(
    () => terminalSessions.find(session => session.id === activeTerminalId) ?? terminalSessions[0],
    [activeTerminalId, terminalSessions],
  )
  const defaultProfile = useMemo(
    () => normalizedProfiles.find(profile => profile.id === 'cmd') ?? normalizedProfiles.find(profile => profile.isDefault) ?? normalizedProfiles[0],
    [normalizedProfiles],
  )
  const visibleTerminals = useMemo(() => {
    if (!activeTerminal) return []
    return terminalSessions.filter(session => session.splitGroupId === activeTerminal.splitGroupId)
  }, [activeTerminal, terminalSessions])
  const visibleTerminalIds = useMemo(() => new Set(visibleTerminals.map(session => session.id)), [visibleTerminals])
  const lastVisibleTerminalId = visibleTerminals.at(-1)?.id
  const visibleTerminalCount = Math.max(1, visibleTerminals.length)
  const terminalGroups = useMemo(() => {
    const groups: Array<{ id: string; index: number; sessions: TerminalViewSession[] }> = []
    const groupMap = new Map<string, { id: string; index: number; sessions: TerminalViewSession[] }>()
    for (const session of terminalSessions) {
      let group = groupMap.get(session.splitGroupId)
      if (!group) {
        group = { id: session.splitGroupId, index: 0, sessions: [] }
        groupMap.set(session.splitGroupId, group)
        groups.push(group)
      }
      group.sessions.push(session)
    }
    let splitIndex = 1
    return groups.map(group => group.sessions.length > 1 ? { ...group, index: splitIndex++ } : group)
  }, [terminalSessions])
  const profileGroups = useMemo(() => ([
    { id: 'local', label: '本地', profiles: normalizedProfiles.filter(profile => profile.kind === 'local') },
  ].filter(group => group.profiles.length > 0)), [normalizedProfiles])
  const filteredOutput = useMemo(
    () => outputChannel === 'All' ? outputEntries : outputEntries.filter(entry => entry.channel === outputChannel),
    [outputChannel, outputEntries],
  )
  const debugStorageKey = `rille-debug-config:${cwd || 'home'}`

  const fitTerminal = useCallback(async (id?: string | null) => {
    if (!visible || activeTab !== 'terminal') return
    await nextFrame()
    const targetIds = id ? [id] : [...visibleTerminalIds]
    for (const targetId of targetIds) {
      const terminal = terminalsRef.current.get(targetId)
      const fitAddon = fitAddonsRef.current.get(targetId)
      if (!terminal || !fitAddon) continue
      try {
        fitAddon.fit()
        void window.rille.terminalResize(targetId, terminal.cols, terminal.rows)
      } catch {
        // xterm can throw while a hidden panel is being measured.
      }
    }
  }, [activeTab, visible, visibleTerminalIds])

  const attachTerminal = useCallback((id: string) => {
    const terminal = terminalsRef.current.get(id)
    const container = terminalContainersRef.current.get(id)
    if (!terminal || !container || openedTerminalsRef.current.has(id)) return
    terminal.open(container)
    openedTerminalsRef.current.add(id)
    void fitTerminal(id)
    terminal.focus()
  }, [fitTerminal])

  const bindTerminalContainer = useCallback((id: string) => (node: HTMLDivElement | null) => {
    if (node) {
      terminalContainersRef.current.set(id, node)
      attachTerminal(id)
    } else {
      terminalContainersRef.current.delete(id)
    }
  }, [attachTerminal])

  const createTerminal = useCallback(async (profileId?: string, options: CreateTerminalOptions = {}) => {
    setTerminalMessage(null)
    setIsProfileMenuOpen(false)
    try {
      const targetProfileId = profileId ?? defaultProfile?.id
      const splitGroupId = options.splitWithActive && activeTerminal ? activeTerminal.splitGroupId : crypto.randomUUID()
      const created = await window.rille.terminalCreate(cwd ?? undefined, 80, 24, {
        profileId: targetProfileId,
        sshHost: options.sshHost,
      })
      const terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
        fontSize: 13,
        theme: terminalTheme(),
      })
      const fitAddon = new FitAddon()
      terminal.loadAddon(fitAddon)
      terminal.onData(data => void window.rille.terminalWrite(created.id, data))
      terminalsRef.current.set(created.id, terminal)
      fitAddonsRef.current.set(created.id, fitAddon)
      setTerminalSessions(prev => [...prev, { ...created, status: 'running', splitGroupId, sshHost: options.sshHost }])
      setActiveTerminalId(created.id)
      onActiveTabChange('terminal')
      await nextFrame()
      attachTerminal(created.id)
      await fitTerminal(created.id)
      if (options.splitWithActive && activeTerminal) await fitTerminal(activeTerminal.id)
    } catch (error) {
      setTerminalMessage(error instanceof Error ? error.message : '终端启动失败。')
    }
  }, [activeTerminal, attachTerminal, cwd, defaultProfile?.id, fitTerminal, onActiveTabChange])


  const createTerminalFromProfile = useCallback(async (profile: TerminalProfile) => {
    if (profile.kind === 'ssh' && profile.id === 'ssh') {
      const host = window.prompt('输入 SSH 主机名或 user@host')?.trim()
      if (!host) return
      await createTerminal(profile.id, { sshHost: host })
      return
    }
    await createTerminal(profile.id)
  }, [createTerminal])

  const splitTerminal = useCallback(async () => {
    if (!activeTerminal) return
    await createTerminal(activeTerminal.profileId, {
      splitWithActive: true,
      sshHost: activeTerminal.sshHost,
    })
  }, [activeTerminal, createTerminal])

  const disposeTerminal = useCallback((id: string) => {
    terminalsRef.current.get(id)?.dispose()
    terminalsRef.current.delete(id)
    fitAddonsRef.current.delete(id)
    terminalContainersRef.current.delete(id)
    openedTerminalsRef.current.delete(id)
  }, [])

  const closeTerminal = useCallback(async (id: string | null | undefined = activeTerminal?.id) => {
    if (!id) return
    await window.rille.terminalKill(id)
    disposeTerminal(id)
    setTerminalSessions(prev => {
      const closing = prev.find(session => session.id === id)
      const next = prev.filter(session => session.id !== id)
      setActiveTerminalId(current => {
        if (current !== id) return current
        return next.find(session => session.splitGroupId === closing?.splitGroupId)?.id ?? next.at(-1)?.id ?? null
      })
      return next
    })
  }, [activeTerminal?.id, disposeTerminal])


  const moveTerminalSession = useCallback((draggedId: string, targetId?: string, targetGroupId?: string, place: 'before' | 'after' | 'end' = 'before') => {
    setTerminalSessions(prev => {
      const dragged = prev.find(session => session.id === draggedId)
      if (!dragged || dragged.id === targetId) return prev
      const withoutDragged = prev.filter(session => session.id !== draggedId)
      const moved = targetGroupId && targetGroupId !== dragged.splitGroupId
        ? { ...dragged, splitGroupId: targetGroupId }
        : dragged
      const next = [...withoutDragged]

      if (targetId) {
        const targetIndex = next.findIndex(session => session.id === targetId)
        if (targetIndex === -1) return prev
        next.splice(place === 'after' ? targetIndex + 1 : targetIndex, 0, moved)
        return next
      }

      if (targetGroupId) {
        let insertIndex = next.length
        for (let index = next.length - 1; index >= 0; index -= 1) {
          if (next[index].splitGroupId === targetGroupId) {
            insertIndex = index + 1
            break
          }
        }
        next.splice(insertIndex, 0, moved)
        return next
      }

      next.push(moved)
      return next
    })
    setDraggedTerminalId(null)
    void nextFrame().then(() => fitTerminal())
  }, [fitTerminal])

  const handleTerminalDrop = useCallback((event: DragEvent<HTMLElement>, targetId?: string, targetGroupId?: string) => {
    event.preventDefault()
    event.stopPropagation()
    const draggedId = event.dataTransfer.getData('text/plain') || draggedTerminalId
    if (!draggedId) return
    const rect = targetId ? event.currentTarget.getBoundingClientRect() : null
    const place = rect && event.clientY > rect.top + rect.height / 2 ? 'after' : 'before'
    moveTerminalSession(draggedId, targetId, targetGroupId, targetId ? place : 'end')
  }, [draggedTerminalId, moveTerminalSession])

  const refreshPorts = useCallback(async () => {
    setIsPortsLoading(true)
    setPortsError(null)
    try {
      setPorts(await window.rille.portsList())
    } catch (error) {
      setPortsError(error instanceof Error ? error.message : '端口扫描失败。')
    } finally {
      setIsPortsLoading(false)
    }
  }, [])

  const openPort = useCallback((port: PortEntry) => {
    const host = port.address === '0.0.0.0' || port.address === '::' || port.address === '*' ? 'localhost' : port.address
    const normalizedHost = host.includes(':') && host !== 'localhost' ? `[${host}]` : host
    void window.rille.openExternal(`http://${normalizedHost}:${port.port}`)
  }, [])

  const killPort = useCallback(async (port: PortEntry) => {
    if (!window.confirm(`停止占用端口 ${port.port} 的进程 ${port.pid}？`)) return
    const result = await window.rille.portsKill(port.pid)
    if (!result.success) {
      setPortsError(result.error || '停止进程失败。')
      return
    }
    await refreshPorts()
  }, [refreshPorts])

  const startDebug = useCallback(async () => {
    setDebugError(null)
    let launch: Record<string, unknown>
    try {
      launch = debugForm.launchJson.trim() ? JSON.parse(debugForm.launchJson) as Record<string, unknown> : {}
    } catch (error) {
      setDebugError(error instanceof Error ? error.message : 'Launch JSON 格式错误。')
      return
    }
    try {
      const session = await window.rille.debugStart({
        name: debugForm.name.trim() || 'Generic Debug',
        adapterCommand: debugForm.adapterCommand.trim(),
        adapterArgs: parseArgs(debugForm.adapterArgs),
        cwd: cwd ?? undefined,
        launch,
        breakpoints,
      })
      setDebugSession(session)
      setDebugConsole(prev => [...prev, { id: crypto.randomUUID(), level: 'info', message: `Started ${session.name}` }])
      localStorage.setItem(debugStorageKey, JSON.stringify(debugForm))
    } catch (error) {
      setDebugError(error instanceof Error ? error.message : '调试启动失败。')
    }
  }, [breakpoints, cwd, debugForm, debugStorageKey])

  const stopDebug = useCallback(async () => {
    if (!debugSession) return
    await window.rille.debugStop(debugSession.id)
    setDebugSession(prev => prev ? { ...prev, status: 'stopped' } : prev)
  }, [debugSession])

  const sendDebugCommand = useCallback(async (command: string, args?: Record<string, unknown>) => {
    if (!debugSession) return
    const result = await window.rille.debugSend(debugSession.id, command, args)
    if (!result.success) setDebugError(result.error || '调试命令失败。')
  }, [debugSession])

  const sendDebugEvaluate = useCallback(async () => {
    const expression = debugInput.trim()
    if (!expression || !debugSession) return
    setDebugInput('')
    setDebugConsole(prev => [...prev, { id: crypto.randomUUID(), level: 'info', message: `> ${expression}` }])
    await sendDebugCommand('evaluate', { expression, context: 'repl' })
  }, [debugInput, debugSession, sendDebugCommand])

  const copyOutput = useCallback(async () => {
    const text = filteredOutput.map(entry => `[${formatTime(entry.timestamp)}] [${entry.channel}] ${entry.message}${entry.details ? `\n${entry.details}` : ''}`).join('\n')
    await navigator.clipboard?.writeText(text)
  }, [filteredOutput])

  useEffect(() => {
    void window.rille.terminalListProfiles().then(setProfiles).catch(() => setProfiles([]))
    void window.rille.outputList().then(setOutputEntries).catch(() => setOutputEntries([]))
    const removeOutput = window.rille.onOutputEntry(entry => setOutputEntries(prev => [...prev.slice(-999), entry]))
    const removeOutputClear = window.rille.onOutputCleared(() => setOutputEntries([]))
    const removeData = window.rille.onTerminalData(({ id, data }) => {
      terminalsRef.current.get(id)?.write(data)
    })
    const removeExit = window.rille.onTerminalExit(({ id, exitCode }) => {
      terminalsRef.current.get(id)?.writeln(`\r\n\x1b[90mProcess exited with code ${exitCode}\x1b[0m`)
      setTerminalSessions(prev => prev.map(session => session.id === id ? { ...session, status: 'exited', exitCode } : session))
    })
    const removeDebug = window.rille.onDebugEvent(event => {
      if (event.state) setDebugSession(event.state)
      if (event.message) {
        const message = event.message
        setDebugConsole(prev => [...prev.slice(-300), {
          id: crypto.randomUUID(),
          level: event.type === 'error' ? 'error' : 'info',
          message,
        }])
      }
    })
    return () => {
      removeOutput()
      removeOutputClear()
      removeData()
      removeExit()
      removeDebug()
      for (const id of terminalsRef.current.keys()) disposeTerminal(id)
    }
  }, [disposeTerminal])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(debugStorageKey)
      if (raw) setDebugForm(JSON.parse(raw) as DebugFormState)
    } catch {
      // Ignore invalid saved debug forms.
    }
  }, [debugStorageKey])

  useEffect(() => {
    if (!visible || activeTab !== 'terminal') return
    if (terminalSessions.length === 0) void createTerminal()
    else void fitTerminal()
  }, [activeTab, createTerminal, fitTerminal, terminalSessions.length, visible])

  useEffect(() => {
    if (!visible || activeTab !== 'ports' || ports.length > 0 || isPortsLoading) return
    void refreshPorts()
  }, [activeTab, isPortsLoading, ports.length, refreshPorts, visible])

  useEffect(() => {
    if (newSignal === lastNewSignalRef.current) return
    lastNewSignalRef.current = newSignal
    if (!visible) return
    void createTerminal()
  }, [createTerminal, newSignal, visible])

  useEffect(() => {
    if (!launchRequest || launchRequest.id === lastLaunchRequestIdRef.current) return
    lastLaunchRequestIdRef.current = launchRequest.id
    if (!visible) return
    void createTerminal(launchRequest.profileId, { sshHost: launchRequest.sshHost })
  }, [createTerminal, launchRequest, visible])

  useEffect(() => {
    if (killSignal === lastKillSignalRef.current) return
    lastKillSignalRef.current = killSignal
    void closeTerminal()
  }, [closeTerminal, killSignal])

  useLayoutEffect(() => {
    if (!visible) return
    const observer = new ResizeObserver(() => void fitTerminal())
    if (panelRef.current) observer.observe(panelRef.current)
    return () => observer.disconnect()
  }, [fitTerminal, visible])

  return (
    <section ref={panelRef} className={'terminal-panel ' + (visible ? '' : 'terminal-panel-hidden')}>
      <header className="terminal-header">
        <div className="terminal-tabs">
          {PANEL_TABS.map(tab => (
            <button
              type="button"
              key={tab.id}
              className={'terminal-tab ' + (activeTab === tab.id ? 'active' : '')}
              onClick={() => onActiveTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="terminal-actions">
          {activeTab === 'terminal' && (
            <div className="terminal-profile-wrap">
              <div className="terminal-create-group">
                <button type="button" title={`新建 ${defaultProfile?.label || '终端'}`} onClick={() => void createTerminal(defaultProfile?.id)}><Plus size={14} /></button>
                <button type="button" className="terminal-profile-chevron" title="选择终端类型" onClick={() => setIsProfileMenuOpen(value => !value)}><ChevronDown size={13} /></button>
              </div>
              {isProfileMenuOpen && (
                <div className="terminal-profile-menu">
                  {profileGroups.map(group => (
                    <div className="terminal-profile-section" key={group.id}>
                      <div className="terminal-profile-label">{group.label}</div>
                      {group.profiles.map(profile => (
                        <button type="button" key={profile.id} onClick={() => void createTerminalFromProfile(profile)}>
                          <TerminalSquare size={14} />
                          <span>{profile.label}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {activeTab === 'terminal' && <button type="button" title="拆分终端" onClick={() => void splitTerminal()} disabled={!activeTerminal}><SplitSquareHorizontal size={14} /></button>}
          {activeTab === 'terminal' && activeTerminal && <span className="terminal-meta"><TerminalSquare size={13} />{activeTerminal.name}</span>}
          {activeTab === 'ports' && <button type="button" title="刷新端口" onClick={() => void refreshPorts()} disabled={isPortsLoading}><RefreshCw size={14} /></button>}
          {activeTab === 'output' && <button type="button" title="复制输出" onClick={() => void copyOutput()} disabled={filteredOutput.length === 0}><Copy size={14} /></button>}
          {activeTab === 'output' && <button type="button" title="清空输出" onClick={() => void window.rille.outputClear()}><Trash2 size={14} /></button>}
          <button type="button" title="更多操作" disabled><MoreHorizontal size={14} /></button>
          <button type="button" title="隐藏面板" onClick={onHide}><ChevronDown size={14} /></button>
          <button type="button" title="关闭面板" onClick={onHide}><X size={14} /></button>
        </div>
      </header>

      {activeTab === 'problems' && (
        <div className="bottom-panel-content problems-panel">
          {diagnostics.length === 0 ? (
            <EmptyPanel>没有错误或警告</EmptyPanel>
          ) : diagnostics.map(diagnostic => (
            <button type="button" key={diagnostic.id} className="problem-row" onClick={() => void onSelectDiagnostic(diagnostic)}>
              <span className={'problem-dot ' + diagnostic.severity}>{diagnostic.severity === 'error' ? '×' : '△'}</span>
              <span className="problem-main">
                <span className="problem-message">{diagnostic.message}</span>
                <span className="problem-location">{shortName(diagnostic.filePath)}:{diagnostic.line}:{diagnostic.column}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {activeTab === 'output' && (
        <div className="bottom-panel-content output-panel">
          <div className="output-toolbar">
            {OUTPUT_CHANNELS.map(channel => (
              <button type="button" key={channel} className={outputChannel === channel ? 'active' : ''} onClick={() => setOutputChannel(channel)}>{channel}</button>
            ))}
          </div>
          {filteredOutput.length === 0 ? <EmptyPanel>暂无输出</EmptyPanel> : filteredOutput.map(entry => (
            <div className={'output-row ' + entry.level} key={entry.id}>
              <span className="output-time">{formatTime(entry.timestamp)}</span>
              <span className="output-channel">{entry.channel}</span>
              <span className="output-message">{entry.message}</span>
              {entry.details && <pre>{entry.details}</pre>}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'debug' && (
        <div className="bottom-panel-content debug-panel">
          <div className="debug-config">
            <input value={debugForm.name} onChange={event => setDebugForm(prev => ({ ...prev, name: event.target.value }))} placeholder="配置名称" />
            <input value={debugForm.adapterCommand} onChange={event => setDebugForm(prev => ({ ...prev, adapterCommand: event.target.value }))} placeholder="Debug adapter command" />
            <input value={debugForm.adapterArgs} onChange={event => setDebugForm(prev => ({ ...prev, adapterArgs: event.target.value }))} placeholder="Adapter args" />
            <textarea value={debugForm.launchJson} onChange={event => setDebugForm(prev => ({ ...prev, launchJson: event.target.value }))} spellCheck={false} />
          </div>
          <div className="debug-controls">
            <button type="button" onClick={() => void startDebug()} disabled={!debugForm.adapterCommand.trim()}><Play size={14} />启动</button>
            <button type="button" onClick={() => void stopDebug()} disabled={!debugSession || debugSession.status === 'stopped'}><Square size={14} />停止</button>
            <button type="button" onClick={() => void sendDebugCommand('pause')} disabled={!debugSession}><Pause size={14} />暂停</button>
            <button type="button" onClick={() => void sendDebugCommand('continue')} disabled={!debugSession}><Play size={14} />继续</button>
            <button type="button" onClick={() => void sendDebugCommand('next')} disabled={!debugSession}><StepForward size={14} />单步</button>
            <button type="button" onClick={() => void sendDebugCommand('stepIn')} disabled={!debugSession}><CornerDownRight size={14} />进入</button>
            <span className={'debug-state ' + (debugSession?.status || 'idle')}><Bug size={14} />{debugSession?.status || 'idle'}</span>
          </div>
          {debugError && <div className="debug-error">{debugError}</div>}
          <div className="debug-console">
            {debugConsole.length === 0 ? <EmptyPanel>启动调试会话后，这里会显示 DAP 输出。</EmptyPanel> : debugConsole.map(entry => (
              <div className={'debug-console-row ' + entry.level} key={entry.id}>{entry.message}</div>
            ))}
          </div>
          <div className="debug-input-row">
            <input value={debugInput} onChange={event => setDebugInput(event.target.value)} onKeyDown={event => {
              if (event.key === 'Enter') void sendDebugEvaluate()
            }} placeholder="Evaluate expression" disabled={!debugSession || debugSession.status === 'stopped'} />
            <button type="button" onClick={() => void sendDebugEvaluate()} disabled={!debugInput.trim() || !debugSession}><Send size={14} /></button>
          </div>
        </div>
      )}

      {activeTab === 'ports' && (
        <div className="bottom-panel-content ports-panel">
          {portsError && <div className="debug-error">{portsError}</div>}
          {isPortsLoading ? <EmptyPanel>正在扫描端口...</EmptyPanel> : ports.length === 0 ? <EmptyPanel>暂无监听端口</EmptyPanel> : (
            <div className="ports-table">
              <div className="ports-header"><span>端口</span><span>地址</span><span>PID</span><span>进程</span><span /></div>
              {ports.map(port => (
                <div className="ports-row" key={port.id}>
                  <span>{port.protocol.toUpperCase()} {port.port}</span>
                  <span>{port.address}</span>
                  <span>{port.pid}</span>
                  <span>{port.processName || '-'}</span>
                  <span className="ports-actions">
                    <button type="button" title="打开" onClick={() => openPort(port)}><ExternalLink size={14} /></button>
                    <button type="button" title="停止进程" onClick={() => void killPort(port)}><Trash2 size={14} /></button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={'terminal-workbench ' + (activeTab === 'terminal' ? '' : 'terminal-body-hidden')}>
        <div
          className="terminal-stack"
          style={{ '--terminal-split-count': String(visibleTerminalCount) } as CSSProperties}
        >
          {terminalSessions.length === 0 && terminalMessage && <div className="terminal-message">{terminalMessage}</div>}
          {terminalSessions.length === 0 && !terminalMessage && <EmptyPanel>选择 + 新建终端</EmptyPanel>}
          {terminalSessions.map(session => {
            const isVisible = visibleTerminalIds.has(session.id)
            return (
              <div
                key={session.id}
                className={'terminal-pane ' + (isVisible ? 'visible ' : '') + (session.id === lastVisibleTerminalId ? 'last-visible ' : '') + (session.id === activeTerminal?.id ? 'active' : '')}
                ref={bindTerminalContainer(session.id)}
                onMouseDown={() => setActiveTerminalId(session.id)}
              />
            )
          })}
        </div>
        <aside className="terminal-session-list">
          {terminalGroups.map(group => {
            const renderSessionRow = (session: TerminalViewSession, targetGroupId?: string) => (
              <div
                role="button"
                tabIndex={0}
                draggable
                key={session.id}
                className={'terminal-session-row ' + (session.id === activeTerminal?.id ? 'active ' : '') + (session.id === draggedTerminalId ? 'dragging' : '')}
                onClick={() => {
                  setActiveTerminalId(session.id)
                  void fitTerminal(session.id)
                }}
                onKeyDown={event => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  setActiveTerminalId(session.id)
                  void fitTerminal(session.id)
                }}
                onDragStart={event => {
                  setDraggedTerminalId(session.id)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', session.id)
                }}
                onDragOver={event => {
                  if (!draggedTerminalId || draggedTerminalId === session.id) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={event => handleTerminalDrop(event, session.id, targetGroupId)}
                onDragEnd={() => setDraggedTerminalId(null)}
              >
                <TerminalSquare size={14} />
                <span>{session.name}</span>
                {session.status === 'exited' && <small>{session.exitCode}</small>}
                <button type="button" className="terminal-session-close" title="删除终端" onClick={event => {
                  event.stopPropagation()
                  void closeTerminal(session.id)
                }}>
                  <X size={13} />
                </button>
              </div>
            )

            if (group.sessions.length === 1) return renderSessionRow(group.sessions[0])

            return (
              <div
                className={'terminal-session-group ' + (group.sessions.some(session => session.id === activeTerminal?.id) ? 'active' : '')}
                key={group.id}
                onDragOver={event => {
                  if (!draggedTerminalId) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={event => handleTerminalDrop(event, undefined, group.id)}
              >
                <div className="terminal-session-group-title">
                  <SplitSquareHorizontal size={12} />
                  <span>组 {group.index}</span>
                  <small>{group.sessions.length}</small>
                </div>
                {group.sessions.map(session => renderSessionRow(session, group.id))}
              </div>
            )
          })}
        </aside>
      </div>
    </section>
  )
}
