import { mkdtempSync, writeFileSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverVerificationCommands } from '../../src/main/agent/verifier'
import type { AgentWorkspaceLocation } from '../../src/shared/agent/protocol'

let root = ''

function workspace(): AgentWorkspaceLocation {
  root = mkdtempSync(join(tmpdir(), 'rille-verifier-'))
  return { kind: 'local', path: root, label: 'tmp' }
}

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

describe('discoverVerificationCommands', () => {
  it('prefers policy commands', async () => {
    const ws = workspace()
    await mkdir(join(root, '.rille'))
    writeFileSync(join(root, '.rille/policy.json'), JSON.stringify({ agent: { verification: { commands: ['npm run build'] } } }), 'utf8')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc' } }), 'utf8')
    await expect(discoverVerificationCommands(ws)).resolves.toEqual([{ verifier: 'command', command: 'npm run build' }])
  })

  it('discovers package typecheck script', async () => {
    const ws = workspace()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc -p tsconfig.json' } }), 'utf8')
    await expect(discoverVerificationCommands(ws)).resolves.toEqual([{ verifier: 'command', command: 'npm run typecheck' }])
  })
})

