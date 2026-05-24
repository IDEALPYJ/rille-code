import { mkdtempSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

let userData = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
  },
}))

afterEach(async () => {
  if (userData) await rm(userData, { recursive: true, force: true })
  userData = ''
  vi.resetModules()
})

describe('artifactStore', () => {
  it('creates, lists, and reads text artifacts with stable metadata', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-artifact-'))
    const store = await import('../../src/main/agent/artifactStore')

    const ref = store.createArtifact({
      sessionId: 'session_artifact',
      turnId: 'turn_artifact',
      kind: 'command_output',
      content: 'hello artifact',
      mimeType: 'text/plain; charset=utf-8',
      redacted: true,
    })

    expect(ref.id).toMatch(/^artifact_/)
    expect(ref.sizeBytes).toBeGreaterThan(0)
    expect(ref.sha256).toHaveLength(64)
    expect(ref.redacted).toBe(true)
    expect(store.listArtifacts('session_artifact')).toHaveLength(1)
    expect(store.readArtifact('session_artifact', ref.id)).toMatchObject({
      encoding: 'utf8',
      content: 'hello artifact',
      ref,
    })
  })

  it('keeps session artifact namespaces isolated', async () => {
    userData = mkdtempSync(join(tmpdir(), 'rille-artifact-'))
    const store = await import('../../src/main/agent/artifactStore')
    const ref = store.createArtifact({ sessionId: 'session_a', kind: 'json', content: { ok: true }, mimeType: 'application/json' })

    expect(store.readArtifact('session_b', ref.id)).toBeNull()
    expect(store.listArtifacts('session_b')).toEqual([])
  })
})

