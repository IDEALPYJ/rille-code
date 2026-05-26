import { describe, expect, it } from 'vitest'
import { createSandboxAdapter } from '../../src/main/agent/sandboxAdapter'

describe('createSandboxAdapter', () => {
  it('returns adapter for current platform', () => {
    const adapter = createSandboxAdapter()
    expect(adapter.platform).toBeTruthy()
    if (process.platform === 'win32') {
      expect(adapter.platform).toBe('windows_job_object')
    }
  })

  it('reports availability', () => {
    const adapter = createSandboxAdapter()
    expect(typeof adapter.available).toBe('boolean')
    if (process.platform === 'win32') {
      expect(adapter.available).toBe(true)
    } else {
      expect(adapter.available).toBe(false)
    }
  })

  it('describes constraints', () => {
    const adapter = createSandboxAdapter()
    const desc = adapter.describe()
    expect(desc.filesystem).toBe('worktree_only')
    expect(desc.network).toBe('allow')
    expect(['windows_job_object', 'none']).toContain(desc.platform)
    expect(typeof desc.active).toBe('boolean')
  })

  it('constrainProcess returns spawn-compatible options', () => {
    const adapter = createSandboxAdapter()
    const opts = adapter.constrainProcess({ network: true })
    expect(typeof opts).toBe('object')
    expect(opts.windowsHide).toBe(true)
  })

  it('constrainProcess with network=false sets blocking env vars on Windows', () => {
    const adapter = createSandboxAdapter()
    const opts = adapter.constrainProcess({ network: false })
    if (process.platform === 'win32') {
      expect(opts.env).toBeDefined()
      const env = opts.env as Record<string, string>
      expect(env.http_proxy).toBe('')
      expect(env.no_proxy).toBe('*')
    }
  })
})
