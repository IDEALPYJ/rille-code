import { mkdtempSync } from 'fs'
import { realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { withinWorkspace } from '../../src/main/agent/workspace'
import type { AgentWorkspaceLocation } from '../../src/shared/agent/protocol'

describe('withinWorkspace', () => {
  it('resolves paths inside local workspace', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'rille-workspace-')))
    const workspace: AgentWorkspaceLocation = { kind: 'local', path: root, label: 'tmp' }
    expect(withinWorkspace(workspace, 'src/index.ts')).toContain(root)
  })

  it('rejects paths outside local workspace', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'rille-workspace-')))
    const workspace: AgentWorkspaceLocation = { kind: 'local', path: root, label: 'tmp' }
    expect(() => withinWorkspace(workspace, '../outside.ts')).toThrow(/工作区/)
  })
})

