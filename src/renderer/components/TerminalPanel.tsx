import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import {
  ChevronDown,
  Plus,
  TerminalSquare,
  X,
} from 'lucide-react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

interface Props {
  workspace: WorkspaceLocation | null
  visible: boolean
  newSignal: number
  killSignal: number
  launchRequest?: TerminalLaunchRequest | null
  onTerminalSessionsEmpty?: () => void
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

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

function isRemoteWorkspace(workspace: WorkspaceLocation | null): boolean {
  return Boolean(workspace && workspace.kind !== 'local')
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

export function TerminalPanel({
  workspace,
  visible,
  newSignal,
  killSignal,
  launchRequest,
  onTerminalSessionsEmpty,
}: Props) {
  const panelRef = useRef<HTMLElement | null>(null)
  const terminalsRef = useRef<Map<string, Terminal>>(new Map())
  const fitAddonsRef = useRef<Map<string, FitAddon>>(new Map())
  const terminalContainersRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const openedTerminalsRef = useRef<Set<string>>(new Set())
  const lastNewSignalRef = useRef(newSignal)
  const lastKillSignalRef = useRef(killSignal)
  const lastLaunchRequestIdRef = useRef(launchRequest?.id ?? 0)
  const autoCreatedRef = useRef(false)
  const [profiles, setProfiles] = useState<TerminalProfile[]>([])
  const [terminalSessions, setTerminalSessions] = useState<TerminalViewSession[]>([])
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const [draggedTerminalId, setDraggedTerminalId] = useState<string | null>(null)
  const [terminalMessage, setTerminalMessage] = useState<string | null>(null)
  const cwd = workspace?.path ?? null
  const remoteWorkspaceActive = isRemoteWorkspace(workspace)

  const normalizedProfiles = useMemo<TerminalProfile[]>(() => {
    const safeProfiles = profiles.map(profile => ({ ...profile, kind: profile.kind || 'local' }))
    if (safeProfiles.length > 0) return safeProfiles
    return [{
      id: 'cmd',
      label: '命令提示符',
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
  const profileGroups = useMemo(() => (remoteWorkspaceActive ? [] : [
    { id: 'local', label: '本地', profiles: normalizedProfiles.filter(profile => profile.kind === 'local') },
  ].filter(group => group.profiles.length > 0)), [normalizedProfiles, remoteWorkspaceActive])

  const fitTerminal = useCallback(async (id?: string | null) => {
    if (!visible) return
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
  }, [visible, visibleTerminalIds])

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
      const targetProfileId = remoteWorkspaceActive ? undefined : (profileId ?? defaultProfile?.id)
      const splitGroupId = options.splitWithActive && activeTerminal ? activeTerminal.splitGroupId : crypto.randomUUID()
      const created = await window.rille.terminalCreate(cwd ?? undefined, 80, 24, {
        profileId: targetProfileId,
        sshHost: options.sshHost,
        workspace,
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
      await nextFrame()
      attachTerminal(created.id)
      await fitTerminal(created.id)
      if (options.splitWithActive && activeTerminal) await fitTerminal(activeTerminal.id)
    } catch (error) {
      setTerminalMessage(error instanceof Error ? error.message : '终端启动失败。')
    }
  }, [activeTerminal, attachTerminal, cwd, defaultProfile?.id, fitTerminal, remoteWorkspaceActive, workspace])

  const createTerminalFromProfile = useCallback(async (profile: TerminalProfile) => {
    if (profile.kind === 'ssh' && profile.id === 'ssh') {
      const host = window.prompt('输入 SSH 主机名或 user@host')?.trim()
      if (!host) return
      await createTerminal(profile.id, { sshHost: host })
      return
    }
    await createTerminal(profile.id)
  }, [createTerminal])

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
      if (next.length === 0) onTerminalSessionsEmpty?.()
      setActiveTerminalId(current => {
        if (current !== id) return current
        return next.find(session => session.splitGroupId === closing?.splitGroupId)?.id ?? next.at(-1)?.id ?? null
      })
      return next
    })
  }, [activeTerminal?.id, disposeTerminal, onTerminalSessionsEmpty])

  const moveTerminalSession = useCallback((draggedId: string, targetId: string, place: 'before' | 'after' = 'before') => {
    setTerminalSessions(prev => {
      const dragged = prev.find(session => session.id === draggedId)
      if (!dragged || dragged.id === targetId) return prev
      const withoutDragged = prev.filter(session => session.id !== draggedId)
      const targetIndex = withoutDragged.findIndex(session => session.id === targetId)
      if (targetIndex === -1) return prev
      const next = [...withoutDragged]
      next.splice(place === 'after' ? targetIndex + 1 : targetIndex, 0, dragged)
      return next
    })
    setDraggedTerminalId(null)
    void nextFrame().then(() => fitTerminal())
  }, [fitTerminal])

  const handleTabDrop = useCallback((event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault()
    event.stopPropagation()
    const draggedId = event.dataTransfer.getData('text/plain') || draggedTerminalId
    if (!draggedId || draggedId === targetId) return
    const rect = event.currentTarget.getBoundingClientRect()
    const place = event.clientX > rect.left + rect.width / 2 ? 'after' : 'before'
    moveTerminalSession(draggedId, targetId, place)
  }, [draggedTerminalId, moveTerminalSession])

  useEffect(() => {
    void window.rille.terminalListProfiles().then(setProfiles).catch(() => setProfiles([]))
    const removeData = window.rille.onTerminalData(({ id, data }) => {
      terminalsRef.current.get(id)?.write(data)
    })
    const removeExit = window.rille.onTerminalExit(({ id, exitCode }) => {
      terminalsRef.current.get(id)?.writeln(`\r\n\x1b[90mProcess exited with code ${exitCode}\x1b[0m`)
      setTerminalSessions(prev => prev.map(session => session.id === id ? { ...session, status: 'exited', exitCode } : session))
    })
    return () => {
      removeData()
      removeExit()
      for (const id of terminalsRef.current.keys()) disposeTerminal(id)
    }
  }, [disposeTerminal])

  useEffect(() => {
    if (!visible) return
    if (terminalSessions.length > 0) void fitTerminal()
  }, [fitTerminal, terminalSessions.length, visible])

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

  useEffect(() => {
    if (!visible || terminalSessions.length > 0 || autoCreatedRef.current) return
    autoCreatedRef.current = true
    void createTerminal()
  }, [createTerminal, terminalSessions.length, visible])

  useLayoutEffect(() => {
    if (!visible) return
    const observer = new ResizeObserver(() => void fitTerminal())
    if (panelRef.current) observer.observe(panelRef.current)
    return () => observer.disconnect()
  }, [fitTerminal, visible])

  return (
    <section ref={panelRef} className={'terminal-panel ' + (visible ? '' : 'terminal-panel-hidden')}>
      <header className="terminal-header">
        <div className="terminal-session-tabs">
          <div className="terminal-session-tabs-scroll">
            {terminalSessions.map(session => (
              <button
                type="button"
                key={session.id}
                className={'terminal-session-tab ' + (session.id === activeTerminal?.id ? 'active ' : '') + (session.id === draggedTerminalId ? 'dragging' : '')}
                onClick={() => {
                  setActiveTerminalId(session.id)
                  void fitTerminal(session.id)
                }}
                draggable
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
                onDrop={event => handleTabDrop(event, session.id)}
                onDragEnd={() => setDraggedTerminalId(null)}
              >
                <TerminalSquare size={13} />
                <span>{session.name}</span>
                <span
                  className="terminal-session-tab-close"
                  onClick={event => {
                    event.stopPropagation()
                    void closeTerminal(session.id)
                  }}
                >
                  <X size={12} />
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="terminal-actions">
          <div className="terminal-profile-wrap">
            {!remoteWorkspaceActive && (
              <div className="terminal-create-group">
                <button type="button" title={`新建 ${defaultProfile?.label || '终端'}`} onClick={() => { setIsProfileMenuOpen(false); void createTerminal(defaultProfile?.id) }}>
                  <Plus size={14} />
                </button>
                <button type="button" className="terminal-profile-chevron" title="选择终端类型" onClick={() => setIsProfileMenuOpen(value => !value)}>
                  <ChevronDown size={13} />
                </button>
              </div>
            )}
            {remoteWorkspaceActive && (
              <button type="button" title={`新建 ${workspace?.label || '远程终端'}`} onClick={() => void createTerminal(defaultProfile?.id)}>
                <Plus size={14} />
              </button>
            )}
            {!remoteWorkspaceActive && isProfileMenuOpen && (
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
        </div>
      </header>

      <div className="terminal-workbench">
        <div
          className="terminal-stack"
          style={{ '--terminal-split-count': String(visibleTerminalCount) } as CSSProperties}
        >
          {terminalSessions.length === 0 && terminalMessage && <div className="terminal-message">{terminalMessage}</div>}
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
      </div>
    </section>
  )
}
