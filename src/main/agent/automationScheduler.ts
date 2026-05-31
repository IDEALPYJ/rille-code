import type { WebContents } from 'electron'
import type { AgentEvent, AutomationRun, AutomationSpec } from '../../shared/agent/protocol'
import { loadAutomationSpecs, saveAutomationRun } from './automationStore'
import { runAutomation } from './automationRunner'

// Minimal 5-field cron parser. Supports *, */N, N, N-M, N,M values.
function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>()
  const parts = field.split(',')
  for (const part of parts) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i)
    } else if (part.startsWith('*/')) {
      const step = parseInt(part.slice(2), 10)
      if (step > 0) {
        for (let i = min; i <= max; i += step) values.add(i)
      }
    } else if (part.includes('-')) {
      const [low, high] = part.split('-').map(Number)
      for (let i = Math.max(min, low); i <= Math.min(max, high); i++) values.add(i)
    } else {
      const n = parseInt(part, 10)
      if (n >= min && n <= max) values.add(n)
    }
  }
  return values
}

function nextCronTime(cronExpr: string, from: Date): Date {
  const [minute, hour, dom, month, dow] = cronExpr.trim().split(/\s+/)
  const minutes = parseCronField(minute, 0, 59)
  const hours = parseCronField(hour, 0, 23)
  const daysOfMonth = parseCronField(dom, 1, 31)
  const months = parseCronField(month, 1, 12)
  const daysOfWeek = parseCronField(dow, 0, 6)

  const next = new Date(from)
  next.setMilliseconds(0)
  next.setSeconds(0)
  next.setMinutes(next.getMinutes() + 1) // Start checking from next minute

  // Search forward, max 2 years ahead
  const limit = new Date(from)
  limit.setFullYear(limit.getFullYear() + 2)

  while (next <= limit) {
    const m = next.getMonth() + 1
    const d = next.getDate()
    const day = next.getDay()
    const h = next.getHours()
    const min = next.getMinutes()

    if (months.has(m) && daysOfMonth.has(d) && daysOfWeek.has(day) && hours.has(h) && minutes.has(min)) {
      return next
    }
    next.setMinutes(next.getMinutes() + 1)
  }
  // Fallback: return now + 1 hour
  return new Date(from.getTime() + 3600000)
}

interface ScheduledTimer {
  timeout: ReturnType<typeof setTimeout> | null
  automationId: string
}

export class AutomationScheduler {
  private timers = new Map<string, ScheduledTimer>()
  private runningRuns = new Map<string, AutomationRun>()
  private pausedSet = new Set<string>()
  private sender: WebContents
  private emitFn: (event: AgentEvent) => void
  private started = false

  constructor(sender: WebContents, emitFn: (event: AgentEvent) => void) {
    this.sender = sender
    this.emitFn = emitFn
  }

  start(): void {
    if (this.started) return
    this.started = true
    const specs = loadAutomationSpecs()
    for (const spec of specs) {
      if (spec.enabled && spec.schedule !== 'manual') {
        this.scheduleAutomation(spec)
      }
    }
  }

  stop(): void {
    this.started = false
    for (const [, timer] of this.timers) {
      if (timer.timeout) clearTimeout(timer.timeout)
    }
    this.timers.clear()
  }

  scheduleAutomation(spec: AutomationSpec): void {
    if (spec.schedule === 'manual') return
    if (this.pausedSet.has(spec.id)) return

    const existing = this.timers.get(spec.id)
    if (existing?.timeout) clearTimeout(existing.timeout)

    const nextTime = nextCronTime(spec.schedule.cron, new Date())
    const delay = Math.max(1000, nextTime.getTime() - Date.now())

    const timeout = setTimeout(() => {
      void this.fireAutomation(spec).then(() => {
        // Re-schedule for next fire time
        if (this.started && !this.pausedSet.has(spec.id)) {
          this.scheduleAutomation(spec)
        }
      })
    }, delay)

    this.timers.set(spec.id, { timeout, automationId: spec.id })
  }

  unscheduleAutomation(automationId: string): void {
    const timer = this.timers.get(automationId)
    if (timer?.timeout) clearTimeout(timer.timeout)
    this.timers.delete(automationId)
  }

  pauseAutomation(automationId: string): void {
    this.pausedSet.add(automationId)
    this.unscheduleAutomation(automationId)
  }

  resumeAutomation(automationId: string): void {
    this.pausedSet.delete(automationId)
    const spec = (() => {
      const specs = loadAutomationSpecs()
      return specs.find(s => s.id === automationId)
    })()
    if (spec && spec.enabled && spec.schedule !== 'manual') {
      this.scheduleAutomation(spec)
    }
  }

  async triggerAutomation(automationId: string): Promise<AutomationRun> {
    const specs = loadAutomationSpecs()
    const spec = specs.find(s => s.id === automationId)
    if (!spec) throw new Error(`Automation "${automationId}" not found`)
    return this.fireAutomation(spec)
  }

  cancelRun(runId: string): boolean {
    const run = this.runningRuns.get(runId)
    if (!run) return false
    run.status = 'cancelled'
    run.completedAt = Date.now()
    saveAutomationRun(run)
    this.runningRuns.delete(runId)
    return true
  }

  private async fireAutomation(spec: AutomationSpec): Promise<AutomationRun> {
    const run = await runAutomation(this.sender, spec, 'scheduled', this.emitFn)
    if (run.status === 'running') {
      this.runningRuns.set(run.id, run)
    } else {
      this.runningRuns.delete(run.id)
    }
    return run
  }
}

let instance: AutomationScheduler | null = null

export function getAutomationScheduler(sender: WebContents, emitFn: (event: AgentEvent) => void): AutomationScheduler {
  if (!instance) instance = new AutomationScheduler(sender, emitFn)
  return instance
}
