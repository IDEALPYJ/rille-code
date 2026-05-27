import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Circle, Database, FileText, Globe, Puzzle, Shield, Zap } from 'lucide-react'
import type { ContextSourceEntry, ContextSourceSnapshot } from '../../../shared/agent/protocol'

interface Props {
  sessionId: string
  collapsed?: boolean
  onToggleCollapse?: () => void
}

const KIND_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  rule_file: FileText,
  rule_directory: FileText,
  memory: Database,
  skill: Zap,
  mcp: Globe,
  feature_list: Puzzle,
}

const TRUST_BADGE: Record<string, { label: string; className: string }> = {
  system: { label: '系统', className: 'cs-trust-system' },
  workspace: { label: '项目', className: 'cs-trust-workspace' },
  tool_output: { label: '工具', className: 'cs-trust-tool' },
  user: { label: '用户', className: 'cs-trust-user' },
  external: { label: '外部', className: 'cs-trust-external' },
}

const ACTIVATION_LABEL: Record<string, string> = {
  always: '始终',
  on_match: '匹配',
  on_demand: '按需',
}

export function ContextSourcePanel({ sessionId, collapsed: externalCollapsed, onToggleCollapse }: Props) {
  const [snapshot, setSnapshot] = useState<ContextSourceSnapshot | null>(null)
  const [internalCollapsed, setInternalCollapsed] = useState(true)
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)
  const [filterKind, setFilterKind] = useState<string | null>(null)

  const collapsed = externalCollapsed ?? internalCollapsed
  const toggleCollapse = onToggleCollapse ?? (() => setInternalCollapsed(prev => !prev))

  const load = useCallback(async () => {
    try {
      const snap = await window.rille.agentListContextSources(sessionId)
      setSnapshot(snap)
    } catch {
      // Registry not available yet
    }
  }, [sessionId])

  useEffect(() => {
    load()
  }, [load])

  const handleToggle = useCallback(async (entryId: string, enabled: boolean) => {
    try {
      const snap = await window.rille.agentToggleContextSource(sessionId, entryId, enabled)
      setSnapshot(snap)
    } catch {
      // ignore
    }
  }, [sessionId])

  const entries = snapshot?.entries ?? []
  const filtered = filterKind ? entries.filter(e => e.kind === filterKind) : entries
  const kinds = [...new Set(entries.map(e => e.kind))]
  const activeCount = snapshot?.activationTrace.filter(t => t.reason !== 'scope_not_matched').length ?? 0
  const conflictCount = snapshot?.conflicts.length ?? 0

  if (collapsed) {
    return (
      <div className="context-source-bar" onClick={toggleCollapse}>
        <span className="cs-bar-icon"><Puzzle size={12} /></span>
        <span className="cs-bar-text">
          {entries.length > 0
            ? `${entries.length} 上下文来源 · ${activeCount} 活跃 · ${conflictCount > 0 ? `${conflictCount} 冲突` : '无冲突'}`
            : '上下文来源加载中…'}
        </span>
        <ChevronDown size={12} className="cs-bar-chevron" />
      </div>
    )
  }

  return (
    <div className="context-source-panel">
      <div className="cs-header" onClick={toggleCollapse}>
        <span className="cs-title">上下文来源</span>
        <span className="cs-summary">
          {entries.length} 来源 · {activeCount} 活跃
          {conflictCount > 0 && <span className="cs-conflict-badge"> · {conflictCount} 冲突</span>}
        </span>
        <ChevronDown size={14} className="cs-header-chevron cs-chevron-up" />
      </div>

      <div className="cs-filters">
        <button className={`cs-filter-btn ${filterKind === null ? 'cs-filter-active' : ''}`} onClick={() => setFilterKind(null)}>全部</button>
        {kinds.map(kind => (
          <button key={kind} className={`cs-filter-btn ${filterKind === kind ? 'cs-filter-active' : ''}`} onClick={() => setFilterKind(kind)}>
            {kind}
          </button>
        ))}
      </div>

      {conflictCount > 0 && (
        <div className="cs-conflicts">
          <AlertCircle size={14} />
          <span>{conflictCount} 个冲突已检测</span>
        </div>
      )}

      <div className="cs-list">
        {filtered.map(entry => {
          const Icon = KIND_ICONS[entry.kind] ?? FileText
          const trust = TRUST_BADGE[entry.trust] ?? TRUST_BADGE.external
          const isExpanded = expandedEntry === entry.id
          const activationRecords = snapshot?.activationTrace.filter(t => t.entryId === entry.id) ?? []

          return (
            <div key={entry.id} className={`cs-entry ${!entry.enabled ? 'cs-disabled' : ''} ${entry.stale ? 'cs-stale' : ''}`}>
              <div className="cs-entry-row" onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}>
                <Icon size={14} className="cs-entry-icon" />
                <span className="cs-entry-provider">{entry.provider}</span>
                <span className={`cs-trust-badge ${trust.className}`}>{trust.label}</span>
                <span className="cs-priority">P{entry.priority}</span>
                <span className="cs-activation">{ACTIVATION_LABEL[entry.activation] ?? entry.activation}</span>
                <label className="cs-toggle" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={e => handleToggle(entry.id, e.target.checked)}
                  />
                  <span className="cs-toggle-slider" />
                </label>
                <ChevronDown size={12} className={`cs-entry-chevron ${isExpanded ? 'cs-chevron-up' : ''}`} />
              </div>

              {isExpanded && (
                <div className="cs-entry-detail">
                  <div className="cs-detail-row">
                    <span className="cs-detail-label">位置</span>
                    <span className="cs-detail-value">{entry.location}</span>
                  </div>
                  {entry.scopes && entry.scopes.length > 0 && (
                    <div className="cs-detail-row">
                      <span className="cs-detail-label">作用域</span>
                      <span className="cs-detail-value">{entry.scopes.join(', ')}</span>
                    </div>
                  )}
                  {entry.activationKeywords && entry.activationKeywords.length > 0 && (
                    <div className="cs-detail-row">
                      <span className="cs-detail-label">激活词</span>
                      <span className="cs-detail-value">{entry.activationKeywords.join(', ')}</span>
                    </div>
                  )}
                  {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                    <div className="cs-detail-row">
                      <span className="cs-detail-label">元数据</span>
                      <span className="cs-detail-value">{JSON.stringify(entry.metadata)}</span>
                    </div>
                  )}
                  {activationRecords.length > 0 && (
                    <div className="cs-detail-row">
                      <span className="cs-detail-label">最近激活</span>
                      <div className="cs-activations">
                        {activationRecords.slice(-3).map((rec, i) => (
                          <span key={i} className="cs-activation-rec">
                            {rec.reason} {rec.matchedScope ? `(${rec.matchedScope})` : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <div className="cs-empty">无上下文来源</div>
      )}
    </div>
  )
}
