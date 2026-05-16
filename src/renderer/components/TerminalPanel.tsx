import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

interface Props {
  cwd: string | null
  visible: boolean
  newSignal: number
  killSignal: number
  onHide: () => void
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

export function TerminalPanel({ cwd, visible, newSignal, killSignal, onHide }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sessionRef = useRef<TerminalSession | null>(null)
  const isStartingRef = useRef(false)
  const [session, setSession] = useState<TerminalSession | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const lastNewSignalRef = useRef(newSignal)
  const lastKillSignalRef = useRef(killSignal)

  const fitAndResize = useCallback(async () => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (!terminal || !fitAddon || !visible) return

    await nextFrame()
    try {
      fitAddon.fit()
      const currentSession = sessionRef.current
      if (currentSession) {
        void window.rille.terminalResize(currentSession.id, terminal.cols, terminal.rows)
      }
    } catch {
      // xterm can throw while the container is hidden or not measured yet.
    }
  }, [visible])

  const startTerminal = useCallback(async () => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (sessionRef.current || isStartingRef.current || !terminal || !fitAddon) return

    isStartingRef.current = true
    setIsStarting(true)
    setMessage(null)
    try {
      await nextFrame()
      try {
        fitAddon.fit()
      } catch {
        // Fall back to xterm defaults if the panel is still settling.
      }
      const created = await window.rille.terminalCreate(cwd ?? undefined, terminal.cols, terminal.rows)
      sessionRef.current = created
      setSession(created)
      terminal.writeln(`[90m${created.shell} • ${created.cwd}[0m`)
      await fitAndResize()
      terminal.focus()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Terminal failed to start')
    } finally {
      isStartingRef.current = false
      setIsStarting(false)
    }
  }, [cwd, fitAndResize])

  const killTerminal = useCallback(async () => {
    const currentSession = sessionRef.current
    if (!currentSession) return
    await window.rille.terminalKill(currentSession.id)
    sessionRef.current = null
    setSession(null)
    setMessage('Terminal closed')
  }, [])

  const restartTerminal = useCallback(async () => {
    if (sessionRef.current) await killTerminal()
    terminalRef.current?.clear()
    setMessage(null)
    await startTerminal()
  }, [killTerminal, startTerminal])

  useLayoutEffect(() => {
    if (!visible || !containerRef.current || terminalRef.current) return

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
      fontSize: 13,
      theme: {
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
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    terminal.onData((data) => {
      const currentSession = sessionRef.current
      if (currentSession) void window.rille.terminalWrite(currentSession.id, data)
    })
  }, [visible])

  useEffect(() => {
    return () => {
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    if (terminalRef.current) {
      void startTerminal()
      void fitAndResize()
    }
  }, [fitAndResize, startTerminal, visible])

  useEffect(() => {
    if (newSignal === lastNewSignalRef.current) return
    lastNewSignalRef.current = newSignal
    if (!visible) return
    void restartTerminal()
  }, [newSignal, restartTerminal, visible])

  useEffect(() => {
    if (killSignal === lastKillSignalRef.current) return
    lastKillSignalRef.current = killSignal
    void killTerminal()
  }, [killSignal, killTerminal])

  useEffect(() => {
    const removeDataListener = window.rille.onTerminalData(({ id, data }) => {
      if (sessionRef.current?.id === id) terminalRef.current?.write(data)
    })
    const removeExitListener = window.rille.onTerminalExit(({ id, exitCode }) => {
      if (sessionRef.current?.id !== id) return
      terminalRef.current?.writeln(`
[90mProcess exited with code ${exitCode}[0m`)
      sessionRef.current = null
      setSession(null)
      setMessage(`Terminal exited with code ${exitCode}`)
    })
    return () => {
      removeDataListener()
      removeExitListener()
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    const observer = new ResizeObserver(() => void fitAndResize())
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [fitAndResize, visible])

  return (
    <section className={'terminal-panel ' + (visible ? '' : 'terminal-panel-hidden')}>
      <header className="terminal-header">
        <div className="terminal-tabs">
          <button type="button" className="terminal-tab active">TERMINAL</button>
        </div>
        <div className="terminal-actions">
          <span className="terminal-meta">{session?.cwd ?? cwd ?? 'Home'}</span>
          <button type="button" onClick={() => void restartTerminal()} disabled={isStarting}>{session ? '新建' : '启动'}</button>
          <button type="button" onClick={() => void killTerminal()} disabled={!session}>关闭</button>
          <button type="button" onClick={onHide}>隐藏</button>
        </div>
      </header>
      {message && !session && <div className="terminal-message">{message}</div>}
      <div className="terminal-body" ref={containerRef} />
    </section>
  )
}
