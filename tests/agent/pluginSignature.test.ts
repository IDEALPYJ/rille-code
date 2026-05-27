import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PluginManifest } from '../../src/shared/agent/protocol'
import { shouldLoadPluginHooks, signPluginManifest, verifyPluginSignature } from '../../src/main/agent/pluginSignature'

const tempDirs: string[] = []

function makePluginManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    skills: [],
    hooks: [],
    mcpServers: [],
    toolNamespaces: [],
    enabled: true,
    ...overrides,
  }
}

function createSignedPluginFile(content: string, dir: string): { filePath: string; manifest: PluginManifest } {
  const filePath = join(dir, 'plugin.json')
  writeFileSync(filePath, content)
  const sig = signPluginManifest(filePath)
  const manifest = makePluginManifest({ filePath, signature: sig })
  return { filePath, manifest }
}

describe('verifyPluginSignature', () => {
  it('returns untrusted when no signature present', () => {
    const plugin = makePluginManifest()
    const result = verifyPluginSignature(plugin)
    expect(result).toMatchObject({ trust: 'untrusted', verified: false, reason: 'No signature present' })
  })

  it('verifies SHA-256 signature for signed manifest file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rille-sig-test-'))
    tempDirs.push(dir)
    const { manifest } = createSignedPluginFile(JSON.stringify({ id: 'test-plugin' }), dir)

    const result = verifyPluginSignature(manifest)
    expect(result).toMatchObject({ trust: 'trusted', verified: true })
    expect(result.reason).toContain('verified')
  })

  it('detects SHA-256 hash mismatch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rille-sig-test-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'plugin.json')
    writeFileSync(filePath, JSON.stringify({ id: 'test-plugin' }))

    const manifest = makePluginManifest({
      filePath,
      signature: { algorithm: 'sha256', signature: '0000000000000000000000000000000000000000000000000000000000000000', signedAt: 0 },
    })

    const result = verifyPluginSignature(manifest)
    expect(result).toMatchObject({ trust: 'untrusted', verified: false })
    expect(result.reason).toContain('hash mismatch')
  })

  it('handles minisign/gpg as unknown_signer (reserved for Phase Z)', () => {
    const plugin = makePluginManifest({
      signature: { algorithm: 'minisign', signature: 'xxx', signerKeyId: 'key1', signedAt: 0 },
    })

    const result = verifyPluginSignature(plugin)
    expect(result).toMatchObject({ trust: 'unknown_signer', verified: false })
    expect(result.reason).toContain('reserved for Phase Z')
  })

  it('handles missing filePath gracefully', () => {
    const plugin = makePluginManifest({
      signature: { algorithm: 'sha256', signature: 'abc123', signedAt: 0 },
    })

    const result = verifyPluginSignature(plugin)
    expect(result).toMatchObject({ trust: 'untrusted', verified: false })
    expect(result.reason).toContain('no filePath')
  })

  it('handles unknown algorithm as untrusted', () => {
    const plugin = makePluginManifest({
      signature: { algorithm: 'unknown' as 'sha256', signature: 'abc', signedAt: 0 },
    })

    const result = verifyPluginSignature(plugin)
    expect(result).toMatchObject({ trust: 'untrusted', verified: false })
  })
})

describe('shouldLoadPluginHooks', () => {
  it('returns true for trusted plugins', () => {
    expect(shouldLoadPluginHooks(makePluginManifest({ trust: 'trusted' }))).toBe(true)
  })

  it('returns false for untrusted plugins', () => {
    expect(shouldLoadPluginHooks(makePluginManifest({ trust: 'untrusted' }))).toBe(false)
  })

  it('returns false for unknown_signer plugins', () => {
    expect(shouldLoadPluginHooks(makePluginManifest({ trust: 'unknown_signer' }))).toBe(false)
  })

  it('defaults to untrusted when trust is not set', () => {
    expect(shouldLoadPluginHooks(makePluginManifest())).toBe(false)
  })
})

describe('signPluginManifest', () => {
  it('generates a SHA-256 signature for a manifest file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rille-sig-test-'))
    tempDirs.push(dir)
    const filePath = join(dir, 'plugin.json')
    writeFileSync(filePath, JSON.stringify({ id: 'test-plugin', name: 'Test' }))

    const sig = signPluginManifest(filePath)
    expect(sig.algorithm).toBe('sha256')
    expect(sig.signature).toMatch(/^[a-f0-9]{64}$/)
    expect(sig.signedAt).toBeGreaterThan(0)
  })
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})
