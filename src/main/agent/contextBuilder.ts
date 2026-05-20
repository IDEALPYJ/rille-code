import type { AgentContextSnapshot, AgentWorkspaceLocation } from '../../shared/agent/protocol'
import { workspaceGitStatus, workspaceReadFile } from './workspace'

const PROJECT_DOCS = ['CLAUDE.md', 'AGENTS.md', 'README.md']
const MAX_DOC_CHARS = 6_000
const MAX_CONTEXT_CHARS = 18_000
const MAX_GIT_STATUS_CHARS = 4_000

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`
}

async function readProjectDoc(workspace: AgentWorkspaceLocation, fileName: string): Promise<string | null> {
  try {
    const content = await workspaceReadFile(workspace, fileName)
    return `# ${fileName}\n${truncate(content, MAX_DOC_CHARS)}`
  } catch {
    return null
  }
}

async function readGitStatus(workspace: AgentWorkspaceLocation): Promise<string> {
  try {
    return truncate(await workspaceGitStatus(workspace), MAX_GIT_STATUS_CHARS)
  } catch (error) {
    return `Git status unavailable: ${error instanceof Error ? error.message : String(error)}`
  }
}

export async function buildAgentContextPrompt(context: AgentContextSnapshot): Promise<string> {
  const sections = [
    `Workspace: ${context.workspace ? `${context.workspace.label} (${context.workspace.kind}:${context.workspace.path})` : 'none'}`,
    `Active file: ${context.activeFile ? `${context.activeFile.name} (${context.activeFile.path}) dirty=${context.activeFile.isDirty}` : 'none'}`,
    `Open files: ${context.openFiles.map(file => `${file.isDirty ? '*' : '-'}${file.path}`).join(', ') || 'none'}`,
    `Diagnostics: ${context.diagnostics.length}`,
    `Cursor: ${context.cursor ? `${context.cursor.line}:${context.cursor.column}` : 'unknown'}`,
  ]

  if (context.diagnostics.length > 0) {
    sections.push([
      'Visible diagnostics:',
      context.diagnostics
        .slice(0, 20)
        .map(item => `${item.severity} ${item.filePath}:${item.line}:${item.column} ${item.message}`)
        .join('\n'),
    ].join('\n'))
  }

  if (context.workspace) {
    sections.push(['Git status:', await readGitStatus(context.workspace)].join('\n'))
    const docs = (await Promise.all(PROJECT_DOCS.map(fileName => readProjectDoc(context.workspace as AgentWorkspaceLocation, fileName))))
      .filter((item): item is string => Boolean(item))
    if (docs.length > 0) {
      sections.push(['Project instructions:', docs.join('\n\n')].join('\n'))
    }
  }

  return truncate(sections.join('\n\n'), MAX_CONTEXT_CHARS)
}
