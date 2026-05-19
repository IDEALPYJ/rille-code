import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, Pencil, Plus, RefreshCw, Server, TerminalSquare, Trash2 } from 'lucide-react'

interface Props {
  onOpenWorkspace: (workspace: WorkspaceLocation) => Promise<void>
  onRemoteConnectionReady?: (connection: RemoteConnection) => void
}

type SshConfigForm = {
  id?: string
  alias: string
  hostName: string
  user: string
  port: string
  authMethod: SshAuthMethod
  identityFile: string
  proxyJump: string
  extraOptions: string
  defaultRemotePath: string
}

const emptySshForm: SshConfigForm = {
  alias: '',
  hostName: '',
  user: '',
  port: '22',
  authMethod: 'sshConfigOrAgent',
  identityFile: '',
  proxyJump: '',
  extraOptions: '',
  defaultRemotePath: '',
}

function formFromConfig(config?: SshTargetConfig | null): SshConfigForm {
  if (!config) return { ...emptySshForm }
  return {
    id: config.id,
    alias: config.alias,
    hostName: config.hostName,
    user: config.user || '',
    port: config.port ? String(config.port) : '22',
    authMethod: config.authMethod,
    identityFile: config.identityFile || '',
    proxyJump: config.proxyJump || '',
    extraOptions: config.extraOptions || '',
    defaultRemotePath: config.defaultRemotePath || '',
  }
}

function payloadFromForm(form: SshConfigForm): Partial<SshTargetConfig> {
  return {
    id: form.id,
    alias: form.alias.trim(),
    hostName: form.hostName.trim(),
    user: form.user.trim() || undefined,
    port: form.port.trim() ? Number(form.port.trim()) : undefined,
    authMethod: form.authMethod,
    identityFile: form.identityFile.trim() || undefined,
    proxyJump: form.proxyJump.trim() || undefined,
    extraOptions: form.extraOptions.trim() || undefined,
    defaultRemotePath: form.defaultRemotePath.trim() || undefined,
  }
}

export function RemotePanel({ onOpenWorkspace, onRemoteConnectionReady }: Props) {
  const [targets, setTargets] = useState<RemoteTarget[]>([])
  const [sshConfigs, setSshConfigs] = useState<SshTargetConfig[]>([])
  const [connections, setConnections] = useState<RemoteConnection[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSshFormOpen, setIsSshFormOpen] = useState(false)
  const [sshForm, setSshForm] = useState<SshConfigForm>(() => ({ ...emptySshForm }))
  const [authPrompt, setAuthPrompt] = useState<RemoteAuthPromptRequest | null>(null)
  const [authValue, setAuthValue] = useState('')
  const authInputRef = useRef<HTMLInputElement | null>(null)

  const loadTargets = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [nextTargets, nextConnections, nextConfigs] = await Promise.all([
        window.rille.remoteListTargets(),
        window.rille.remoteListConnections(),
        window.rille.remoteListSshConfigs(),
      ])
      setTargets(nextTargets)
      setConnections(nextConnections)
      setSshConfigs(nextConfigs)
    } catch (loadError) {
      setTargets([])
      setConnections([])
      setSshConfigs([])
      setError(loadError instanceof Error ? loadError.message : '无法加载远程目标。')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTargets()
  }, [loadTargets])

  useEffect(() => window.rille.onRemoteAuthPrompt((request) => {
    setAuthValue(request.kind === 'confirmation' ? 'yes' : '')
    setAuthPrompt(request)
  }), [])

  useEffect(() => {
    if (!authPrompt || authPrompt.kind === 'confirmation') return
    window.setTimeout(() => {
      authInputRef.current?.focus()
      authInputRef.current?.select()
    }, 0)
  }, [authPrompt])

  const sshTargets = useMemo(() => targets.filter(target => target.kind === 'ssh'), [targets])
  const wslTargets = useMemo(() => targets.filter(target => target.kind === 'wsl'), [targets])
  const connectTarget = useMemo(() => sshTargets.find(target => target.source === 'detected'), [sshTargets])
  const configuredSshTargets = useMemo(() => sshTargets.filter(target => target.source === 'configured'), [sshTargets])
  const sshConfigTargets = useMemo(() => sshTargets.filter(target => target.source === 'ssh-config'), [sshTargets])
  const connectionByTarget = useMemo(() => new Map(connections.map(connection => [connection.targetId, connection])), [connections])
  const configById = useMemo(() => new Map(sshConfigs.map(config => [config.id, config])), [sshConfigs])

  const openTarget = useCallback(async (target: RemoteTarget) => {
    const existingConnection = connectionByTarget.get(target.id)
    if (existingConnection) {
      onRemoteConnectionReady?.(existingConnection)
      await loadTargets()
      return
    }

    const targetKey = target.source === 'detected' ? 'ssh:connect' : target.id
    let sshHost: string | undefined
    if (target.source === 'detected') {
      sshHost = window.prompt('输入 SSH 主机名或 user@host')?.trim()
      if (!sshHost) return
    }

    setConnectingId(targetKey)
    setError(null)
    try {
      const connection = await window.rille.remoteConnect(target.id, sshHost)
      onRemoteConnectionReady?.(connection)
      await loadTargets()
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : '远程连接失败。')
      await loadTargets()
    } finally {
      setConnectingId(null)
    }
  }, [connectionByTarget, loadTargets, onRemoteConnectionReady])

  const saveSshConfig = useCallback(async () => {
    setError(null)
    try {
      await window.rille.remoteSaveSshConfig(payloadFromForm(sshForm))
      setIsSshFormOpen(false)
      setSshForm({ ...emptySshForm })
      await loadTargets()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存 SSH 配置失败。')
    }
  }, [loadTargets, sshForm])

  const editSshConfig = useCallback((config: SshTargetConfig) => {
    setSshForm(formFromConfig(config))
    setIsSshFormOpen(true)
  }, [])

  const deleteSshConfig = useCallback(async (config: SshTargetConfig) => {
    if (!window.confirm(`删除 SSH 目标 ${config.alias}？`)) return
    setError(null)
    try {
      await window.rille.remoteDeleteSshConfig(config.id)
      await loadTargets()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除 SSH 配置失败。')
    }
  }, [loadTargets])

  const selectIdentityFile = useCallback(async () => {
    const filePath = await window.rille.remoteSelectIdentityFile()
    if (filePath) setSshForm(prev => ({ ...prev, identityFile: filePath }))
  }, [])

  const respondAuthPrompt = useCallback(async (cancelled: boolean) => {
    if (!authPrompt) return
    await window.rille.remoteRespondAuthPrompt(authPrompt.requestId, { value: authValue, cancelled })
    setAuthPrompt(null)
    setAuthValue('')
  }, [authPrompt, authValue])

  const renderTarget = (target: RemoteTarget, icon: 'ssh' | 'wsl') => {
    const busy = connectingId === target.id || (target.source === 'detected' && connectingId === 'ssh:connect')
    const Icon = icon === 'ssh' ? Server : TerminalSquare
    const config = target.sshConfigId ? configById.get(target.sshConfigId) : null
    return (
      <div className="remote-row-wrap" key={target.id}>
        <button type="button" className="remote-row" onClick={() => void openTarget(target)} disabled={busy}>
          <Icon size={15} />
          <span>{busy ? '连接中...' : target.label}</span>
        </button>
        {config && (
          <button type="button" className="remote-inline-action" title="编辑 SSH 目标" onClick={() => editSshConfig(config)}>
            <Pencil size={13} />
          </button>
        )}
        {config && (
          <button type="button" className="remote-inline-action danger" title="删除 SSH 目标" onClick={() => void deleteSshConfig(config)}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="side-view remote-view">
      <div className="side-view-title-row">
        <span className="side-view-title">远程资源管理器</span>
        <button type="button" className="side-action icon" title="刷新远程目标" onClick={() => void loadTargets()} disabled={isLoading}>
          <RefreshCw size={13} />
        </button>
      </div>

      {error && <pre className="panel-error">{error}</pre>}

      <div className="remote-section">
        <div className="remote-section-heading">
          <div className="remote-section-title">SSH 目标</div>
          <button type="button" className="side-action icon" title="添加 SSH 目标" onClick={() => { setSshForm({ ...emptySshForm }); setIsSshFormOpen(true) }}>
            <Plus size={13} />
          </button>
        </div>
        {connectTarget && renderTarget(connectTarget, 'ssh')}
        {configuredSshTargets.map(target => renderTarget(target, 'ssh'))}
        {sshConfigTargets.map(target => renderTarget(target, 'ssh'))}
        {!isLoading && sshTargets.length === 0 && <div className="panel-empty compact">没有检测到 SSH。</div>}
      </div>

      <div className="remote-section">
        <div className="remote-section-title">WSL 目标</div>
        {wslTargets.map(target => renderTarget(target, 'wsl'))}
        {!isLoading && wslTargets.length === 0 && <div className="panel-empty compact">没有检测到 WSL 发行版。</div>}
      </div>

      {isSshFormOpen && (
        <div className="remote-modal-overlay">
          <div className="remote-config-dialog">
            <div className="remote-config-title">SSH 目标</div>
            <div className="remote-config-form">
            <input value={sshForm.alias} onChange={event => setSshForm(prev => ({ ...prev, alias: event.target.value }))} placeholder="主机别名" />
            <input value={sshForm.hostName} onChange={event => setSshForm(prev => ({ ...prev, hostName: event.target.value }))} placeholder="主机名 / IP" />
            <div className="remote-config-grid">
              <input value={sshForm.user} onChange={event => setSshForm(prev => ({ ...prev, user: event.target.value }))} placeholder="用户" />
              <input value={sshForm.port} onChange={event => setSshForm(prev => ({ ...prev, port: event.target.value }))} placeholder="端口" />
            </div>
            <select value={sshForm.authMethod} onChange={event => setSshForm(prev => ({ ...prev, authMethod: event.target.value as SshAuthMethod }))}>
              <option value="sshConfigOrAgent">使用 SSH 配置 / Agent</option>
              <option value="password">密码</option>
              <option value="identityFile">密钥文件</option>
              <option value="identityFileWithPassphrase">密钥文件 + 口令</option>
            </select>
            <div className="remote-config-file-row">
              <input value={sshForm.identityFile} onChange={event => setSshForm(prev => ({ ...prev, identityFile: event.target.value }))} placeholder="密钥文件" />
              <button type="button" onClick={() => void selectIdentityFile()}><FolderOpen size={13} /></button>
            </div>
            <input value={sshForm.proxyJump} onChange={event => setSshForm(prev => ({ ...prev, proxyJump: event.target.value }))} placeholder="ProxyJump" />
            <input value={sshForm.extraOptions} onChange={event => setSshForm(prev => ({ ...prev, extraOptions: event.target.value }))} placeholder="Extra ssh options" />
            <input value={sshForm.defaultRemotePath} onChange={event => setSshForm(prev => ({ ...prev, defaultRemotePath: event.target.value }))} placeholder="默认远程路径" />
            <div className="remote-config-actions">
              <button type="button" onClick={() => void saveSshConfig()}>保存</button>
              <button type="button" onClick={() => { setIsSshFormOpen(false); setSshForm({ ...emptySshForm }) }}>取消</button>
            </div>
            </div>
          </div>
        </div>
      )}

      {authPrompt && (
        <div className="remote-auth-overlay">
          <div className="remote-auth-dialog">
            <div className="remote-auth-title">SSH 认证</div>
            <div className="remote-auth-prompt">{authPrompt.prompt}</div>
            {authPrompt.kind !== 'confirmation' && (
              <input
                ref={authInputRef}
                autoFocus
                type={authPrompt.kind === 'password' ? 'password' : 'text'}
                value={authValue}
                onChange={event => setAuthValue(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') void respondAuthPrompt(false)
                  if (event.key === 'Escape') void respondAuthPrompt(true)
                }}
              />
            )}
            <div className="remote-auth-actions">
              <button type="button" onClick={() => void respondAuthPrompt(false)}>{authPrompt.kind === 'confirmation' ? '是' : '确定'}</button>
              <button type="button" onClick={() => void respondAuthPrompt(true)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
