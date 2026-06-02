import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Play, Pause, Edit, Trash2, Plus, Clock, Zap } from 'lucide-react'
import type { AutomationRun, AutomationSpec } from '../../../shared/agent/protocol'

interface Props {
  collapsed?: boolean
  onToggleCollapse?: () => void
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  idle: { label: '空闲', className: 'auto-status-idle' },
  pending: { label: '等待中', className: 'auto-status-pending' },
  running: { label: '运行中', className: 'auto-status-running' },
  paused: { label: '已暂停', className: 'auto-status-paused' },
  completed: { label: '已完成', className: 'auto-status-completed' },
  failed: { label: '失败', className: 'auto-status-failed' },
  cancelled: { label: '已取消', className: 'auto-status-cancelled' },
}

const RUN_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  running: { label: '运行中', className: 'auto-status-running' },
  completed: { label: '完成', className: 'auto-status-completed' },
  failed: { label: '失败', className: 'auto-status-failed' },
  cancelled: { label: '取消', className: 'auto-status-cancelled' },
}

export function AutomationList({ collapsed: externalCollapsed, onToggleCollapse }: Props) {
  const [automations, setAutomations] = useState<AutomationSpec[]>([])
  const [runs, setRuns] = useState<Map<string, AutomationRun[]>>(new Map())
  const [internalCollapsed, setInternalCollapsed] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Editing form state
  const [formName, setFormName] = useState('')
  const [formGoal, setFormGoal] = useState('')
  const [formSchedule, setFormSchedule] = useState<'manual' | 'cron'>('manual')
  const [formCron, setFormCron] = useState('0 9 * * *')
  const [formEnabled, setFormEnabled] = useState(true)

  const collapsed = externalCollapsed ?? internalCollapsed
  const toggleCollapse = onToggleCollapse ?? (() => setInternalCollapsed(prev => !prev))

  const load = useCallback(async () => {
    try {
      const specs = await window.rille.agentListAutomations()
      setAutomations(specs)
      const runsMap = new Map<string, AutomationRun[]>()
      for (const spec of specs) {
        try {
          const specRuns = await window.rille.agentListAutomationRuns(spec.id)
          runsMap.set(spec.id, specRuns)
        } catch { /* ignore */ }
      }
      setRuns(runsMap)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    load()
    const unsub = window.rille.onAgentEvent(event => {
      if (event.type === 'automation.run.started' || event.type === 'automation.run.completed' || event.type === 'automation.run.failed') {
        load()
      }
    })
    return () => unsub()
  }, [load])

  const handleCreate = async () => {
    try {
      const spec = await window.rille.agentCreateAutomation({
        name: formName || '新自动化',
        goal: formGoal || '执行任务',
        schedule: formSchedule === 'cron' ? { cron: formCron } : 'manual',
        workspace: { path: '', label: '' } as AutomationSpec['workspace'],
        permissionMode: 'default',
        enabled: formEnabled,
      })
      setFormName(''); setFormGoal(''); setFormSchedule('manual'); setFormCron('0 9 * * *'); setFormEnabled(true)
      setEditingId(null)
      await load()
    } catch { /* ignore */ }
  }

  const handleDelete = async (id: string) => {
    try {
      await window.rille.agentDeleteAutomation(id)
      await load()
    } catch { /* ignore */ }
  }

  const handleTrigger = async (id: string) => {
    try {
      await window.rille.agentTriggerAutomation(id)
      await load()
    } catch { /* ignore */ }
  }

  const handlePause = async (id: string) => {
    try {
      await window.rille.agentPauseAutomation(id)
      await load()
    } catch { /* ignore */ }
  }

  const handleResume = async (id: string) => {
    try {
      await window.rille.agentResumeAutomation(id)
      await load()
    } catch { /* ignore */ }
  }

  const scheduleLabel = (spec: AutomationSpec): string => {
    if (spec.schedule === 'manual') return '手动'
    return `Cron: ${spec.schedule.cron}`
  }

  const latestRun = (automationId: string): AutomationRun | undefined => {
    const list = runs.get(automationId) ?? []
    return list[list.length - 1]
  }

  if (collapsed) {
    return (
      <div className="automation-bar" onClick={toggleCollapse}>
        <span className="auto-bar-icon"><Zap size={12} /></span>
        <span className="auto-bar-text">
          {automations.length > 0 ? `${automations.length} 个自动化` : '无自动化'}
        </span>
        <ChevronDown size={12} className="auto-bar-chevron" />
      </div>
    )
  }

  return (
    <div className="automation-panel">
      <div className="auto-header" onClick={toggleCollapse}>
        <span className="auto-title">
          <Zap size={14} />
          {' '}自动化
        </span>
        <span className="auto-summary">{automations.length} 个</span>
        <ChevronDown size={14} className="auto-header-chevron auto-chevron-up" />
      </div>

      <div className="auto-list">
        {automations.map(spec => {
          const lastRun = latestRun(spec.id)
          const status = STATUS_BADGE[spec.enabled ? 'idle' : 'paused'] ?? STATUS_BADGE.idle
          const isExpanded = expandedId === spec.id
          const runList = runs.get(spec.id) ?? []

          return (
            <div key={spec.id} className={`auto-entry ${!spec.enabled ? 'auto-disabled' : ''}`}>
              <div className="auto-entry-row" onClick={() => setExpandedId(isExpanded ? null : spec.id)}>
                <span className="auto-entry-name">{spec.name}</span>
                <span className={`auto-status-badge ${status.className}`}>{status.label}</span>
                <span className="auto-schedule">{scheduleLabel(spec)}</span>
                <ChevronDown size={12} className={`auto-entry-chevron ${isExpanded ? 'auto-chevron-up' : ''}`} />
              </div>

              {isExpanded && (
                <div className="auto-entry-detail">
                  <div className="auto-detail-goal">{spec.goal}</div>
                  <div className="auto-detail-actions">
                    <button className="auto-btn" onClick={() => handleTrigger(spec.id)} title="立即触发">
                      <Play size={12} /> 触发
                    </button>
                    {spec.enabled && spec.schedule !== 'manual' && (
                      <button className="auto-btn" onClick={() => handlePause(spec.id)} title="暂停">
                        <Pause size={12} /> 暂停
                      </button>
                    )}
                    {!spec.enabled && (
                      <button className="auto-btn" onClick={() => handleResume(spec.id)} title="恢复">
                        <Play size={12} /> 恢复
                      </button>
                    )}
                    <button className="auto-btn auto-btn-danger" onClick={() => handleDelete(spec.id)} title="删除">
                      <Trash2 size={12} /> 删除
                    </button>
                  </div>

                  {runList.length > 0 && (
                    <div className="auto-runs">
                      <span className="auto-runs-label">最近运行:</span>
                      {runList.slice(-5).reverse().map(run => {
                        const rs = RUN_STATUS_BADGE[run.status] ?? RUN_STATUS_BADGE.failed
                        return (
                          <div key={run.id} className="auto-run-item">
                            <span className={`auto-run-status ${rs.className}`}>{rs.label}</span>
                            <span className="auto-run-time">{new Date(run.startedAt).toLocaleString()}</span>
                            {run.evidenceCount > 0 && <span className="auto-run-evidence">证据: {run.evidenceCount}</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {runList.length === 0 && (
                    <div className="auto-runs-empty">尚无运行记录</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Create form */}
      {editingId === 'new' || (automations.length === 0 && editingId === null) ? (
        <div className="auto-create-form">
          <input
            className="auto-form-input"
            placeholder="自动化名称"
            value={formName}
            onChange={e => setFormName(e.target.value)}
          />
          <textarea
            className="auto-form-textarea"
            placeholder="自动化任务描述（会作为 agent turn 文本）"
            value={formGoal}
            onChange={e => setFormGoal(e.target.value)}
            rows={3}
          />
          <div className="auto-form-row">
            <select className="auto-form-select" value={formSchedule} onChange={e => setFormSchedule(e.target.value as 'manual' | 'cron')}>
              <option value="manual">手动触发</option>
              <option value="cron">定时 (Cron)</option>
            </select>
            {formSchedule === 'cron' && (
              <input
                className="auto-form-input"
                placeholder="0 9 * * *"
                value={formCron}
                onChange={e => setFormCron(e.target.value)}
              />
            )}
          </div>
          <div className="auto-form-actions">
            <button className="auto-btn auto-btn-primary" onClick={handleCreate}>
              <Plus size={12} /> 创建
            </button>
            {automations.length > 0 && (
              <button className="auto-btn" onClick={() => setEditingId(null)}>取消</button>
            )}
          </div>
        </div>
      ) : (
        <div className="auto-create-bar" onClick={() => setEditingId('new')}>
          <Plus size={12} /> 创建新自动化
        </div>
      )}

      {automations.length === 0 && editingId !== null && editingId !== 'new' && (
        <div className="auto-empty">暂无自动化配置。点击上方按钮创建。</div>
      )}
    </div>
  )
}
