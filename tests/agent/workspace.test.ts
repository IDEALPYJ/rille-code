import { mkdtempSync } from 'fs'
import { realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { isProtectedPath, withinWorkspace } from '../../src/main/agent/workspace'
import type { AgentWorkspaceLocation } from '../../src/shared/agent/protocol'

describe('withinWorkspace', () => {
  it('resolves paths inside local workspace', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'rille-workspace-')))
    const workspace: AgentWorkspaceLocation = { kind: 'local', path: root, label: 'tmp' }
    expect(withinWorkspace(workspace, 'src/index.ts').replace(/\\/g, '/')).toContain(root.replace(/\\/g, '/'))
  })

  it('rejects paths outside local workspace', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'rille-workspace-')))
    const workspace: AgentWorkspaceLocation = { kind: 'local', path: root, label: 'tmp' }
    expect(() => withinWorkspace(workspace, '../outside.ts')).toThrow(/工作区/)
  })
})

describe('isProtectedPath', () => {
  it('marks .git paths as protected', () => {
    expect(isProtectedPath('.git/config')).toBe(true)
    expect(isProtectedPath('src/.git/HEAD')).toBe(true)
  })

  it('marks node_modules as protected', () => {
    expect(isProtectedPath('node_modules/react/index.js')).toBe(true)
  })

  it('marks .env files as protected', () => {
    expect(isProtectedPath('.env')).toBe(true)
    expect(isProtectedPath('.env.local')).toBe(true)
  })

  it('allows normal source files', () => {
    expect(isProtectedPath('src/main.ts')).toBe(false)
    expect(isProtectedPath('README.md')).toBe(false)
    expect(isProtectedPath('package.json')).toBe(false)
  })
})

