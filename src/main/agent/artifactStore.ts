import { createHash, randomUUID } from 'crypto'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ArtifactKind, ArtifactPayload, ArtifactRef } from '../../shared/agent/protocol'

function rootDir(): string {
  const userData = typeof app?.getPath === 'function' ? app.getPath('userData') : join(tmpdir(), 'rillecode-test-user-data')
  return join(userData, 'agent', 'artifacts')
}

function sessionDir(sessionId: string): string {
  return join(rootDir(), sessionId)
}

function artifactDir(sessionId: string, artifactId: string): string {
  return join(sessionDir(sessionId), artifactId)
}

function metadataPath(sessionId: string, artifactId: string): string {
  return join(artifactDir(sessionId, artifactId), 'metadata.json')
}

function contentPath(sessionId: string, artifactId: string): string {
  return join(artifactDir(sessionId, artifactId), 'content.bin')
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

function hash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

export interface CreateArtifactInput {
  sessionId: string
  turnId?: string
  kind: ArtifactKind
  content: string | Buffer | unknown
  mimeType?: string
  redacted?: boolean
}

export function createArtifact(input: CreateArtifactInput): ArtifactRef {
  const artifactId = `artifact_${randomUUID()}`
  const dir = artifactDir(input.sessionId, artifactId)
  ensureDir(dir)
  const buffer = Buffer.isBuffer(input.content)
    ? input.content
    : typeof input.content === 'string'
      ? Buffer.from(input.content, 'utf8')
      : Buffer.from(JSON.stringify(input.content, null, 2), 'utf8')
  writeFileSync(contentPath(input.sessionId, artifactId), buffer)
  const ref: ArtifactRef = {
    id: artifactId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    kind: input.kind,
    uri: `agent-artifact://${input.sessionId}/${artifactId}`,
    mimeType: input.mimeType || (typeof input.content === 'string' ? 'text/plain; charset=utf-8' : 'application/json'),
    sizeBytes: buffer.byteLength,
    sha256: hash(buffer),
    redacted: input.redacted ?? false,
    createdAt: Date.now(),
  }
  writeFileSync(metadataPath(input.sessionId, artifactId), JSON.stringify(ref, null, 2), 'utf8')
  return ref
}

export function readArtifactRef(sessionId: string, artifactId: string): ArtifactRef | null {
  const path = metadataPath(sessionId, artifactId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ArtifactRef
  } catch {
    return null
  }
}

export function readArtifact(sessionId: string, artifactId: string): ArtifactPayload | null {
  const ref = readArtifactRef(sessionId, artifactId)
  if (!ref) return null
  const path = contentPath(sessionId, artifactId)
  if (!existsSync(path)) return null
  const buffer = readFileSync(path)
  const textual = ref.mimeType?.startsWith('text/')
    || ref.mimeType?.includes('json')
    || ref.kind === 'text'
    || ref.kind === 'command_output'
    || ref.kind === 'verification_output'
    || ref.kind === 'runtime_state'
    || ref.kind === 'trace'
    || ref.kind === 'checkpoint'
  return {
    ref,
    encoding: textual ? 'utf8' : 'base64',
    content: textual ? buffer.toString('utf8') : buffer.toString('base64'),
  }
}

export function listArtifacts(sessionId: string): ArtifactRef[] {
  const dir = sessionDir(sessionId)
  if (!existsSync(dir)) return []
  const refs: ArtifactRef[] = []
  for (const entry of readdirSync(dir)) {
    const ref = readArtifactRef(sessionId, entry)
    if (ref) refs.push(ref)
  }
  return refs.sort((a, b) => b.createdAt - a.createdAt)
}
