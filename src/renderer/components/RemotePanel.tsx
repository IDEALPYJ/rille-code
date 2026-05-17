import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Server, TerminalSquare } from 'lucide-react'

interface Props {
  onOpenTerminal: (profileId?: string, sshHost?: string) => void
}

export function RemotePanel({ onOpenTerminal }: Props) {
  const [targets, setTargets] = useState<RemoteTarget[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadTargets = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      setTargets(await window.rille.remoteListTargets())
    } catch (loadError) {
      setTargets([])
      setError(loadError instanceof Error ? loadError.message : '无法加载远程目标。')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTargets()
  }, [loadTargets])

  const sshTargets = useMemo(() => targets.filter(target => target.kind === 'ssh'), [targets])
  const wslTargets = useMemo(() => targets.filter(target => target.kind === 'wsl'), [targets])
  const connectTarget = useMemo(() => sshTargets.find(target => target.source === 'detected'), [sshTargets])
  const configuredSshTargets = useMemo(() => sshTargets.filter(target => target.source === 'ssh-config'), [sshTargets])

  const openTarget = useCallback((target: RemoteTarget) => {
    if (target.source === 'detected') {
      const host = window.prompt('输入 SSH 主机名或 user@host')?.trim()
      if (!host) return
      onOpenTerminal(target.profileId, host)
      return
    }
    onOpenTerminal(target.profileId, target.host)
  }, [onOpenTerminal])

  return (
    <div className="side-view remote-view">
      <div className="side-view-title-row">
        <span className="side-view-title">远程资源管理器</span>
        <button type="button" className="side-action icon" title="刷新远程目标" onClick={() => void loadTargets()} disabled={isLoading}>
          <RefreshCw size={13} />
        </button>
      </div>

      {error && <div className="panel-error">{error}</div>}

      <div className="remote-section">
        <div className="remote-section-title">SSH Targets</div>
        {connectTarget && (
          <button type="button" className="remote-row" onClick={() => openTarget(connectTarget)}>
            <Server size={15} />
            <span>{connectTarget.label}</span>
          </button>
        )}
        {configuredSshTargets.map(target => (
          <button type="button" className="remote-row" key={target.id} onClick={() => openTarget(target)}>
            <Server size={15} />
            <span>{target.label}</span>
          </button>
        ))}
        {!isLoading && sshTargets.length === 0 && <div className="panel-empty compact">没有检测到 SSH。</div>}
      </div>

      <div className="remote-section">
        <div className="remote-section-title">WSL Targets</div>
        {wslTargets.map(target => (
          <button type="button" className="remote-row" key={target.id} onClick={() => openTarget(target)}>
            <TerminalSquare size={15} />
            <span>{target.label}</span>
          </button>
        ))}
        {!isLoading && wslTargets.length === 0 && <div className="panel-empty compact">没有检测到 WSL 发行版。</div>}
      </div>
    </div>
  )
}
