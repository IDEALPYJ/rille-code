import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Settings, Trash2, X } from 'lucide-react'
import type {
  AgentModelModality,
  AgentModelProfile,
  AgentModelProfileUpdate,
  AgentModelStoreSnapshot,
  AgentProviderId,
  AgentProviderProtocol,
} from '../../shared/agent/protocol'

interface Props {
  open: boolean
  onClose: () => void
}

const providerOptions: Array<{ value: AgentProviderId; label: string; protocol: AgentProviderProtocol; baseURL: string; model: string }> = [
  { value: 'openai', label: 'OpenAI', protocol: 'openai-chat', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { value: 'deepseek', label: 'DeepSeek', protocol: 'openai-chat', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { value: 'anthropic', label: 'Anthropic', protocol: 'anthropic', baseURL: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest' },
  { value: 'google', label: 'Google Gemini', protocol: 'gemini', baseURL: 'https://generativelanguage.googleapis.com', model: 'gemini-1.5-flash-latest' },
  { value: 'openrouter', label: 'OpenRouter', protocol: 'openai-chat', baseURL: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { value: 'moonshot', label: 'Moonshot', protocol: 'openai-chat', baseURL: 'https://api.moonshot.cn/v1', model: 'kimi-k2-turbo-preview' },
  { value: 'siliconflow', label: 'SiliconFlow', protocol: 'openai-chat', baseURL: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  { value: 'mistral', label: 'Mistral', protocol: 'openai-chat', baseURL: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  { value: 'xai', label: 'xAI', protocol: 'openai-chat', baseURL: 'https://api.x.ai/v1', model: 'grok-beta' },
  { value: 'ollama', label: 'Ollama', protocol: 'ollama', baseURL: 'http://localhost:11434/v1', model: 'llama3.1' },
  { value: 'custom', label: 'Custom', protocol: 'openai-chat', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
]

function providerLabel(providerId: AgentProviderId): string {
  return providerOptions.find(item => item.value === providerId)?.label || providerId
}

function draftFromProfile(profile: AgentModelProfile): AgentModelProfileUpdate {
  return {
    id: profile.id,
    name: profile.name,
    providerId: profile.providerId,
    protocol: profile.protocol,
    baseURL: profile.baseURL,
    model: profile.model,
    contextLengthTokens: profile.contextLengthTokens,
    modalities: profile.modalities,
  }
}

function newDraft(): AgentModelProfileUpdate {
  const provider = providerOptions[0]
  return {
    name: `${provider.label} · ${provider.model}`,
    providerId: provider.value,
    protocol: provider.protocol,
    baseURL: provider.baseURL,
    model: provider.model,
    apiKey: '',
    contextLengthTokens: 128000,
    modalities: ['text'],
    makeActive: true,
  }
}

export function ModelSettingsDialog({ open, onClose }: Props) {
  const [store, setStore] = useState<AgentModelStoreSnapshot | null>(null)
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<AgentModelProfileUpdate | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isTesting, setIsTesting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const selectedProfile = useMemo(
    () => store?.profiles.find(profile => profile.id === selectedId) || null,
    [selectedId, store?.profiles],
  )

  const refresh = useCallback(async () => {
    const snapshot = await window.rille.agentListModelProfiles()
    setStore(snapshot)
    setSelectedId(prev => {
      if (prev === 'new') return prev
      if (prev && snapshot.profiles.some(profile => profile.id === prev)) return prev
      return snapshot.activeProfileId
    })
    return snapshot
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setMessage(null)
    window.rille.agentListModelProfiles()
      .then(snapshot => {
        if (cancelled) return
        setStore(snapshot)
        setSelectedId(snapshot.activeProfileId)
      })
      .catch(error => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : '模型配置读取失败。')
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (selectedId === 'new') {
      setDraft(newDraft())
      return
    }
    if (selectedProfile) setDraft(draftFromProfile(selectedProfile))
  }, [selectedId, selectedProfile])

  const updateProvider = useCallback((providerId: AgentProviderId) => {
    const selected = providerOptions.find(item => item.value === providerId) ?? providerOptions[0]
    setDraft(prev => ({
      ...prev,
      providerId,
      protocol: selected.protocol,
      baseURL: selected.baseURL,
      model: prev?.providerId === providerId ? (prev.model || selected.model) : selected.model,
      name: prev?.id ? prev.name : `${selected.label} · ${selected.model}`,
      contextLengthTokens: prev?.contextLengthTokens ?? 128000,
      modalities: prev?.modalities ?? ['text'],
    }))
  }, [])

  const toggleModality = useCallback((modality: AgentModelModality) => {
    setDraft(prev => {
      if (!prev) return prev
      const current = prev.modalities ?? ['text']
      const next = current.includes(modality) ? current.filter(item => item !== modality) : [...current, modality]
      return { ...prev, modalities: next.length > 0 ? next : ['text'] }
    })
  }, [])

  const save = useCallback(async (makeActive?: boolean) => {
    if (!draft?.model.trim()) {
      setMessage('请输入模型名称。')
      return null
    }
    setIsSaving(true)
    try {
      const saved = await window.rille.agentSaveModelProfile({ ...draft, makeActive })
      const snapshot = await refresh()
      setSelectedId(saved.id)
      setDraft(draftFromProfile(saved))
      setMessage(snapshot.activeProfileId === saved.id ? '模型已保存并设为当前。' : '模型配置已保存。')
      return saved
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败。')
      return null
    } finally {
      setIsSaving(false)
    }
  }, [draft, refresh])

  const selectActive = useCallback(async () => {
    if (!draft?.id) return
    try {
      await window.rille.agentSelectModelProfile(draft.id)
      await refresh()
      setMessage('已设为当前模型。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '切换模型失败。')
    }
  }, [draft?.id, refresh])

  const test = useCallback(async () => {
    setIsTesting(true)
    setMessage(null)
    try {
      const saved = await save(false)
      if (!saved) return
      const result = await window.rille.agentTestProvider(saved.id)
      setMessage(result.success ? `连接成功：${result.message}` : `连接失败：${result.message}`)
    } finally {
      setIsTesting(false)
    }
  }, [save])

  const remove = useCallback(async () => {
    if (!draft?.id || !store) return
    if (store.profiles.length <= 1) {
      setMessage('至少需要保留一个模型配置。')
      return
    }
    try {
      const snapshot = await window.rille.agentDeleteModelProfile(draft.id)
      setStore(snapshot)
      setSelectedId(snapshot.activeProfileId)
      setMessage('模型配置已删除。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除失败。')
    }
  }, [draft?.id, store])

  if (!open) return null

  return (
    <div className="settings-modal-overlay" role="presentation" onMouseDown={onClose}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="设置" onMouseDown={event => event.stopPropagation()}>
        <header className="settings-dialog-header">
          <div className="settings-dialog-title">
            <Settings size={16} />
            <span>设置</span>
          </div>
          <button type="button" title="关闭" aria-label="关闭设置" onClick={onClose}><X size={15} /></button>
        </header>

        <div className="settings-dialog-body">
          <aside className="settings-nav model-profile-list">
            <button type="button" className="model-add-button" onClick={() => setSelectedId('new')}>
              <Plus size={14} />
              <span>添加模型</span>
            </button>
            {store?.profiles.map(profile => (
              <button
                type="button"
                key={profile.id}
                className={'model-profile-item ' + (selectedId === profile.id ? 'active ' : '') + (store.activeProfileId === profile.id ? 'current' : '')}
                onClick={() => setSelectedId(profile.id)}
              >
                <strong>{profile.name}</strong>
                <span>{providerLabel(profile.providerId)} · {profile.model}</span>
              </button>
            ))}
          </aside>

          <div className="settings-content">
            <div className="settings-section-heading">
              <strong>{selectedId === 'new' ? '添加模型' : '管理模型'}</strong>
              <span>{store?.profiles.find(profile => profile.id === store.activeProfileId)?.name || '尚未配置 Agent 模型'}</span>
            </div>

            {draft && (
              <div className="settings-form">
                <label>
                  <span>显示名称</span>
                  <input value={draft.name || ''} placeholder="例如 DeepSeek 快速模型" onChange={event => setDraft(prev => prev ? { ...prev, name: event.target.value } : prev)} />
                </label>
                <label>
                  <span>服务商</span>
                  <select value={draft.providerId} onChange={event => updateProvider(event.target.value as AgentProviderId)}>
                    {providerOptions.map(provider => (
                      <option key={provider.value} value={provider.value}>{provider.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>协议</span>
                  <select value={draft.protocol} onChange={event => setDraft(prev => prev ? { ...prev, protocol: event.target.value as AgentProviderProtocol } : prev)}>
                    <option value="openai-chat">OpenAI Chat</option>
                    <option value="openai-responses">OpenAI Responses</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Gemini</option>
                    <option value="ollama">Ollama</option>
                  </select>
                </label>
                <label>
                  <span>Base URL</span>
                  <input value={draft.baseURL || ''} onChange={event => setDraft(prev => prev ? { ...prev, baseURL: event.target.value } : prev)} />
                </label>
                <label>
                  <span>模型名称</span>
                  <input value={draft.model} placeholder="例如 deepseek-chat / gpt-4o-mini" onChange={event => setDraft(prev => prev ? { ...prev, model: event.target.value } : prev)} />
                </label>
                <label>
                  <span>API Key</span>
                  <input
                    type="password"
                    value={draft.apiKey || ''}
                    placeholder={selectedProfile?.apiKeyConfigured ? '已保存，留空保持不变' : '输入 API Key；Ollama 可留空'}
                    onChange={event => setDraft(prev => prev ? { ...prev, apiKey: event.target.value } : prev)}
                  />
                </label>
                <label>
                  <span>上下文大小 tokens</span>
                  <input
                    type="number"
                    min={4096}
                    step={4096}
                    value={draft.contextLengthTokens ?? 128000}
                    onChange={event => setDraft(prev => prev ? { ...prev, contextLengthTokens: Number(event.target.value) || 128000 } : prev)}
                  />
                </label>
                <div className="settings-modality-group">
                  <span>模态</span>
                  <label><input type="checkbox" checked={(draft.modalities ?? ['text']).includes('text')} onChange={() => toggleModality('text')} /><span>Text</span></label>
                  <label><input type="checkbox" checked={(draft.modalities ?? ['text']).includes('image')} onChange={() => toggleModality('image')} /><span>Image</span></label>
                </div>
              </div>
            )}

            <div className="settings-actions">
              <button type="button" onClick={() => void save(false)} disabled={isSaving || !draft}>保存模型</button>
              <button type="button" onClick={() => void save(true)} disabled={isSaving || !draft}>保存并设为当前</button>
              <button type="button" onClick={() => void selectActive()} disabled={!draft?.id || store?.activeProfileId === draft.id}>设为当前</button>
              <button type="button" onClick={() => void test()} disabled={isTesting || isSaving || !draft}>{isTesting ? '测试中...' : '测试连接'}</button>
              <button type="button" className="danger" onClick={() => void remove()} disabled={!draft?.id || (store?.profiles.length ?? 0) <= 1}><Trash2 size={13} /> 删除</button>
            </div>
            {message && <div className="settings-message">{message}</div>}
          </div>
        </div>
      </section>
    </div>
  )
}
