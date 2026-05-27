import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activateSkill, discoverExtensions, findMatchingSkills } from '../../src/main/agent/skillStore'
import type { AgentWorkspaceLocation } from '../../src/shared/agent/protocol'

let root = ''
let userData = ''

function workspace(): AgentWorkspaceLocation {
  return { kind: 'local', path: root, label: 'tmp' }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'rille-skills-project-'))
  userData = mkdtempSync(join(tmpdir(), 'rille-skills-user-'))
  process.env.RILLE_AGENT_EXTENSION_USER_DATA = userData
})

afterEach(async () => {
  delete process.env.RILLE_AGENT_EXTENSION_USER_DATA
  await rm(root, { recursive: true, force: true }).catch(() => {})
  await rm(userData, { recursive: true, force: true }).catch(() => {})
})

describe('skill/plugin discovery', () => {
  it('scans project and user skills, preferring project conflicts', () => {
    mkdirSync(join(root, '.rille/skills'), { recursive: true })
    mkdirSync(join(userData, 'agent/skills'), { recursive: true })
    writeFileSync(join(userData, 'agent/skills/review.json'), JSON.stringify({
      id: 'review',
      name: 'User review',
      description: 'user skill',
      activationKeywords: ['review'],
      content: 'user review content',
      priority: 10,
    }), 'utf8')
    writeFileSync(join(root, '.rille/skills/review.json'), JSON.stringify({
      id: 'review',
      name: 'Project review',
      description: 'project skill',
      activationKeywords: ['review'],
      content: 'project review content',
      priority: 10,
    }), 'utf8')

    const snapshot = discoverExtensions(workspace())

    expect(snapshot.skills.find(skill => skill.id === 'review')).toMatchObject({
      name: 'Project review',
      source: 'project',
      trust: 'trusted',
    })
    expect(snapshot.conflicts).toContain('skill:review')
  })

  it('loads plugin manifest skills and mcp server configs fail-closed', () => {
    mkdirSync(join(root, '.rille/plugins'), { recursive: true })
    writeFileSync(join(root, '.rille/plugins/plugin.json'), JSON.stringify({
      id: 'fixture',
      name: 'Fixture Plugin',
      version: '1.0.0',
      description: 'fixture',
      skills: [{ id: 'fixture.skill', name: 'Fixture Skill', description: 'skill', activationKeywords: ['fixture'], content: 'fixture skill body' }],
      mcpServers: [
        { id: 'stdio', name: 'stdio', command: 'node fake-server.js', sideEffect: 'none' },
        { id: 'remote', name: 'remote', transport: 'http', url: 'http://127.0.0.1:4321/mcp', authHeaders: { Authorization: 'RILLE_TOKEN' }, sideEffect: 'none' },
        { id: '', command: '' },
        { id: 'bad-http', transport: 'http' },
      ],
      enabled: true,
    }), 'utf8')

    const snapshot = discoverExtensions(workspace())

    expect(snapshot.plugins).toHaveLength(1)
    expect(snapshot.plugins[0].mcpServers).toHaveLength(2)
    expect(snapshot.plugins[0].mcpServers.find(server => server.id === 'remote')).toMatchObject({
      transport: 'http',
      url: 'http://127.0.0.1:4321/mcp',
      authHeaders: { Authorization: 'RILLE_TOKEN' },
    })
    expect(snapshot.skills.find(skill => skill.id === 'fixture.skill')).toMatchObject({ source: 'plugin', pluginId: 'fixture', trust: 'untrusted' })
  })

  it('matches and manually activates skills with trace-ready metadata', () => {
    mkdirSync(join(root, '.rille/skills'), { recursive: true })
    writeFileSync(join(root, '.rille/skills/verify.md'), '# Verify Skill\nUse deterministic verification.', 'utf8')

    const matches = findMatchingSkills('please verify', workspace())
    const activated = activateSkill({
      skillId: matches[0].id,
      reason: 'manual test',
      sessionId: 'session_o',
      turnId: 'turn_o',
      workspace: workspace(),
    })

    expect(matches[0]).toMatchObject({ name: 'verify', source: 'project' })
    expect(activated.activation).toMatchObject({ sessionId: 'session_o', turnId: 'turn_o', skillId: 'verify', source: 'project' })
  })
})
