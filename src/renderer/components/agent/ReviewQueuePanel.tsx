import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, AlertCircle, AlertTriangle, CheckCircle, FileText, Inbox } from 'lucide-react'
import type { ReviewQueueItem, ReviewQueueSource } from '../../../shared/agent/protocol'

interface Props {
  collapsed?: boolean
  onToggleCollapse?: () => void
}

const SOURCE_LABELS: Record<ReviewQueueSource, string> = {
  plan_confirmation: '计划审批',
  diff_proposal: '差异提案',
  failed_evidence: '失败证据',
  blocking_finding: '阻塞发现',
  stale_evidence: '过期证据',
  waiver_expiring: '豁免到期',
}

const SEVERITY_ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  info: CheckCircle,
  warning: AlertTriangle,
  blocking: AlertCircle,
}

const SEVERITY_CLASS: Record<string, string> = {
  info: 'rq-severity-info',
  warning: 'rq-severity-warning',
  blocking: 'rq-severity-blocking',
}

export function ReviewQueuePanel({ collapsed: externalCollapsed, onToggleCollapse }: Props) {
  const [items, setItems] = useState<ReviewQueueItem[]>([])
  const [internalCollapsed, setInternalCollapsed] = useState(true)
  const [filterSource, setFilterSource] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const collapsed = externalCollapsed ?? internalCollapsed
  const toggleCollapse = onToggleCollapse ?? (() => setInternalCollapsed(prev => !prev))

  const load = useCallback(async () => {
    try {
      const list = await window.rille.agentListReviewQueue()
      setItems(list)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    load()
    const unsub = window.rille.onAgentEvent(event => {
      if (event.type === 'review.queue.pushed' || event.type === 'review.queue.resolved' || event.type === 'review.queue.changed') {
        load()
      }
    })
    return () => unsub()
  }, [load])

  const handleResolve = async (itemId: string, action: 'dismiss' | 'accept_risk' | 'reject' | 'retry') => {
    try {
      await window.rille.agentResolveReviewQueueItem(itemId, action)
      await load()
    } catch { /* ignore */ }
  }

  const unresolved = items.filter(i => !i.resolved)
  const displayed = showResolved ? items : unresolved.filter(i => !filterSource || i.source === filterSource)
  const blockingCount = unresolved.filter(i => i.severity === 'blocking').length
  const sourceTypes = [...new Set(unresolved.map(i => i.source))]

  const ageLabel = (ts: number): string => {
    const diff = Date.now() - ts
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
    return `${Math.floor(diff / 86400000)} 天前`
  }

  if (collapsed) {
    return (
      <div className="review-queue-bar" onClick={toggleCollapse}>
        <span className="rq-bar-icon"><Inbox size={12} /></span>
        <span className="rq-bar-text">
          {unresolved.length > 0
            ? `${unresolved.length} 条待处理${blockingCount > 0 ? ` · ${blockingCount} 阻塞` : ''}`
            : '审查队列为空'}
        </span>
        <ChevronDown size={12} className="rq-bar-chevron" />
      </div>
    )
  }

  return (
    <div className="review-queue-panel">
      <div className="rq-header" onClick={toggleCollapse}>
        <span className="rq-title">
          <Inbox size={14} />
          {' '}审查队列
        </span>
        <span className="rq-summary">
          {unresolved.length} 条待处理
          {blockingCount > 0 && <span className="rq-blocking-badge"> · {blockingCount} 阻塞</span>}
        </span>
        <ChevronDown size={14} className="rq-header-chevron rq-chevron-up" />
      </div>

      <div className="rq-filters">
        <button className={`rq-filter-btn ${filterSource === null ? 'rq-filter-active' : ''}`} onClick={() => setFilterSource(null)}>全部</button>
        {sourceTypes.map(source => (
          <button key={source} className={`rq-filter-btn ${filterSource === source ? 'rq-filter-active' : ''}`} onClick={() => setFilterSource(source)}>
            {SOURCE_LABELS[source] ?? source}
          </button>
        ))}
      </div>

      <div className="rq-list">
        {displayed.map(item => {
          const SevIcon = SEVERITY_ICON[item.severity] ?? CheckCircle
          const sevClass = SEVERITY_CLASS[item.severity] ?? 'rq-severity-info'
          const isExpanded = expandedId === item.id
          const sourceLabel = SOURCE_LABELS[item.source] ?? item.source

          return (
            <div key={item.id} className={`rq-entry ${item.resolved ? 'rq-resolved' : ''}`}>
              <div className="rq-entry-row" onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                <SevIcon size={14} className={`rq-severity-icon ${sevClass}`} />
                <span className="rq-source-badge">{sourceLabel}</span>
                <span className="rq-entry-title">{item.title}</span>
                <span className="rq-entry-age">{ageLabel(item.createdAt)}</span>
              </div>

              {isExpanded && (
                <div className="rq-entry-detail">
                  <p className="rq-detail-desc">{item.description}</p>
                  <div className="rq-detail-meta">
                    {item.automationId && <span>自动化: {item.automationId}</span>}
                  </div>
                  {!item.resolved && (
                    <div className="rq-detail-actions">
                      {item.source === 'plan_confirmation' && (
                        <>
                          <button className="rq-btn rq-btn-primary" onClick={() => handleResolve(item.id, 'accept_risk')}>确认</button>
                          <button className="rq-btn" onClick={() => handleResolve(item.id, 'reject')}>拒绝</button>
                        </>
                      )}
                      {item.source === 'diff_proposal' && (
                        <>
                          <button className="rq-btn rq-btn-primary" onClick={() => handleResolve(item.id, 'accept_risk')}>应用</button>
                          <button className="rq-btn" onClick={() => handleResolve(item.id, 'reject')}>拒绝</button>
                        </>
                      )}
                      {(item.source === 'failed_evidence' || item.source === 'blocking_finding') && (
                        <>
                          <button className="rq-btn" onClick={() => handleResolve(item.id, 'accept_risk')}>接受风险</button>
                          <button className="rq-btn" onClick={() => handleResolve(item.id, 'retry')}>重试</button>
                          <button className="rq-btn" onClick={() => handleResolve(item.id, 'dismiss')}>忽略</button>
                        </>
                      )}
                      {item.source === 'stale_evidence' && (
                        <>
                          <button className="rq-btn" onClick={() => handleResolve(item.id, 'retry')}>重新验证</button>
                          <button className="rq-btn" onClick={() => handleResolve(item.id, 'dismiss')}>豁免</button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="rq-toggle-resolved">
        <label>
          <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} />
          {' '}显示已处理
        </label>
      </div>

      {displayed.length === 0 && (
        <div className="rq-empty">
          {filterSource ? '无匹配项' : showResolved ? '无记录' : '审查队列为空'}
        </div>
      )}
    </div>
  )
}
