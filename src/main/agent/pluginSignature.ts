import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import type { PluginManifest, PluginSignature, PluginTrust } from '../../shared/agent/protocol'

export interface PluginVerificationResult {
  pluginId: string
  trust: PluginTrust
  verified: boolean
  reason: string
}

export function verifyPluginSignature(plugin: PluginManifest): PluginVerificationResult {
  if (!plugin.signature) {
    return {
      pluginId: plugin.id,
      trust: 'untrusted',
      verified: false,
      reason: 'No signature present',
    }
  }

  const sig = plugin.signature

  if (sig.algorithm === 'sha256') {
    return verifySha256(plugin, sig)
  }

  if (sig.algorithm === 'minisign' || sig.algorithm === 'gpg') {
    return {
      pluginId: plugin.id,
      trust: 'unknown_signer',
      verified: false,
      reason: `Signature algorithm '${sig.algorithm}' is reserved for Phase Z. No verification performed.`,
    }
  }

  return {
    pluginId: plugin.id,
    trust: 'untrusted',
    verified: false,
    reason: `Unknown signature algorithm: ${sig.algorithm}`,
  }
}

function verifySha256(plugin: PluginManifest, sig: PluginSignature): PluginVerificationResult {
  if (!plugin.filePath) {
    return {
      pluginId: plugin.id,
      trust: 'untrusted',
      verified: false,
      reason: 'Cannot verify SHA-256: no filePath for plugin manifest',
    }
  }

  try {
    const fileContent = readFileSync(plugin.filePath, 'utf8')
    const expectedHash = createHash('sha256').update(fileContent).digest('hex')

    if (expectedHash !== sig.signature) {
      return {
        pluginId: plugin.id,
        trust: 'untrusted',
        verified: false,
        reason: `SHA-256 hash mismatch: expected ${sig.signature}, got ${expectedHash}`,
      }
    }

    return {
      pluginId: plugin.id,
      trust: 'trusted',
      verified: true,
      reason: 'SHA-256 signature verified',
    }
  } catch (err) {
    return {
      pluginId: plugin.id,
      trust: 'untrusted',
      verified: false,
      reason: `Failed to read manifest file: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export function shouldLoadPluginHooks(plugin: PluginManifest): boolean {
  const trust = plugin.trust ?? 'untrusted'
  return trust === 'trusted'
}

export function signPluginManifest(filePath: string, algorithm: 'sha256' = 'sha256'): PluginSignature {
  const content = readFileSync(filePath, 'utf8')
  const hash = createHash(algorithm === 'sha256' ? 'sha256' : 'sha256').update(content).digest('hex')
  return {
    algorithm,
    signature: hash,
    signedAt: Date.now(),
  }
}
