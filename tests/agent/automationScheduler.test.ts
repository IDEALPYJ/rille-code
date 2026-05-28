import { describe, expect, it, vi } from 'vitest'

// Test the cron parser inline
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
  next.setMinutes(next.getMinutes() + 1)

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
  return new Date(from.getTime() + 3600000)
}

describe('cron parser', () => {
  describe('parseCronField', () => {
    it('parses wildcard', () => {
      const result = parseCronField('*', 0, 5)
      expect(result.size).toBe(6)
    })

    it('parses exact value', () => {
      const result = parseCronField('3', 0, 10)
      expect(result.has(3)).toBe(true)
      expect(result.size).toBe(1)
    })

    it('parses range', () => {
      const result = parseCronField('1-3', 0, 10)
      expect(result.has(1)).toBe(true)
      expect(result.has(2)).toBe(true)
      expect(result.has(3)).toBe(true)
      expect(result.size).toBe(3)
    })

    it('parses step', () => {
      const result = parseCronField('*/2', 0, 5)
      expect(result.has(0)).toBe(true)
      expect(result.has(2)).toBe(true)
      expect(result.has(4)).toBe(true)
      expect(result.size).toBe(3)
    })

    it('parses comma-separated values', () => {
      const result = parseCronField('1,3,5', 0, 10)
      expect(result.has(1)).toBe(true)
      expect(result.has(3)).toBe(true)
      expect(result.has(5)).toBe(true)
      expect(result.size).toBe(3)
    })

    it('clamps values to min/max', () => {
      const result = parseCronField('25', 0, 23)
      expect(result.size).toBe(0)
    })
  })

  describe('nextCronTime', () => {
    it('finds next minute match for every-minute cron', () => {
      const from = new Date(2026, 0, 1, 12, 0, 0)
      const next = nextCronTime('* * * * *', from)
      expect(next.getTime()).toBeGreaterThan(from.getTime())
      expect(next.getHours()).toBe(12)
      expect(next.getMinutes()).toBe(1)
    })

    it('finds next daily cron', () => {
      const from = new Date(2026, 0, 1, 8, 0, 0)
      const next = nextCronTime('0 9 * * *', from)
      expect(next.getHours()).toBe(9)
      expect(next.getMinutes()).toBe(0)
    })

    it('finds next weekly cron', () => {
      const from = new Date(2026, 0, 1, 10, 0, 0)
      const next = nextCronTime('0 9 * * 1', from)
      expect(next.getDay()).toBe(1)
      expect(next.getHours()).toBe(9)
      expect(next.getTime()).toBeGreaterThan(from.getTime())
    })

    it('advances to next hour when no minute matches', () => {
      const from = new Date(2026, 0, 1, 12, 30, 0)
      const next = nextCronTime('0 * * * *', from)
      expect(next.getMinutes()).toBe(0)
      expect(next.getHours()).toBe(13)
    })

    it('returns fallback for impossible cron', () => {
      const from = new Date(2026, 0, 1, 12, 0, 0)
      const result = nextCronTime('* * 30 * *', from)
      expect(result.getTime()).toBeGreaterThan(from.getTime())
    })
  })
})

describe('AutomationScheduler', () => {
  async function getSchedulerModule() {
    return await import('../../src/main/agent/automationScheduler')
  }

  it('scheduler starts and stops without error', async () => {
    const { AutomationScheduler } = await getSchedulerModule()
    const mockSender = {} as any
    const mockEmit = vi.fn()
    const scheduler = new AutomationScheduler(mockSender, mockEmit)
    scheduler.start()
    scheduler.stop()
  })

  it('scheduleAutomation with manual spec does nothing', async () => {
    const { AutomationScheduler } = await getSchedulerModule()
    const scheduler = new AutomationScheduler({} as any, vi.fn())
    const spec = {
      id: 'auto_manual',
      name: 'Manual',
      goal: 'test',
      schedule: 'manual' as const,
      workspace: { path: '/tmp', label: 'test' },
      permissionMode: 'plan' as const,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    scheduler.scheduleAutomation(spec)
    scheduler.unscheduleAutomation('auto_manual')
  })

  it('pause and resume', async () => {
    const { AutomationScheduler } = await getSchedulerModule()
    const scheduler = new AutomationScheduler({} as any, vi.fn())
    scheduler.pauseAutomation('auto_1')
    expect(() => scheduler.resumeAutomation('auto_1')).not.toThrow()
  })

  it('trigger throws for unknown automation', async () => {
    const { AutomationScheduler } = await getSchedulerModule()
    const scheduler = new AutomationScheduler({} as any, vi.fn())
    await expect(scheduler.triggerAutomation('nonexistent')).rejects.toThrow()
  })

  it('cancelRun returns false for unknown run', async () => {
    const { AutomationScheduler } = await getSchedulerModule()
    const scheduler = new AutomationScheduler({} as any, vi.fn())
    expect(scheduler.cancelRun('nonexistent')).toBe(false)
  })

  it('getAutomationScheduler returns singleton', async () => {
    const { getAutomationScheduler } = await getSchedulerModule()
    const s1 = getAutomationScheduler({} as any, vi.fn())
    const s2 = getAutomationScheduler({} as any, vi.fn())
    expect(s1).toBe(s2)
  })
})
