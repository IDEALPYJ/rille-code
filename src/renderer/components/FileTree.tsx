import { useState } from 'react'
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Database,
  File,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Globe2,
  Palette,
  Terminal,
  type LucideIcon,
} from 'lucide-react'

interface Props {
  entries: FileEntry[]
  onSelectFile: (path: string) => void
  activePath: string | null
}

function getFileIcon(fileName: string): { icon: LucideIcon; tone: string } {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const map: Record<string, { icon: LucideIcon; tone: string }> = {
    ts: { icon: FileCode2, tone: 'blue' },
    tsx: { icon: FileCode2, tone: 'blue' },
    js: { icon: FileCode2, tone: 'amber' },
    jsx: { icon: FileCode2, tone: 'blue' },
    json: { icon: Braces, tone: 'violet' },
    css: { icon: Palette, tone: 'rose' },
    scss: { icon: Palette, tone: 'rose' },
    html: { icon: Globe2, tone: 'orange' },
    md: { icon: FileText, tone: 'slate' },
    svg: { icon: Palette, tone: 'rose' },
    py: { icon: FileCode2, tone: 'green' },
    rs: { icon: FileCode2, tone: 'orange' },
    go: { icon: FileCode2, tone: 'cyan' },
    java: { icon: FileCode2, tone: 'red' },
    sql: { icon: Database, tone: 'violet' },
    sh: { icon: Terminal, tone: 'slate' },
    bash: { icon: Terminal, tone: 'slate' },
  }
  return map[ext ?? ''] ?? { icon: File, tone: 'slate' }
}

function TreeNode({ entry, depth, onSelect, activePath }: {
  entry: FileEntry
  depth: number
  onSelect: (path: string) => void
  activePath: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FileEntry[] | undefined>(entry.children)
  const [isLoading, setIsLoading] = useState(false)

  const handleDirectoryClick = async () => {
    const nextExpanded = !expanded
    setExpanded(nextExpanded)

    if (nextExpanded && children === undefined && !isLoading) {
      setIsLoading(true)
      const loadedChildren = await window.rille.readDirectory(entry.path)
      setChildren(loadedChildren)
      setIsLoading(false)
    }
  }

  if (entry.isDirectory) {
    return (
      <>
        <button
          type="button"
          className="tree-item tree-folder"
          style={{ '--depth': depth } as React.CSSProperties}
          onClick={handleDirectoryClick}
          title={entry.path}
        >
          {expanded
            ? <ChevronDown size={14} className="icon chevron" />
            : <ChevronRight size={14} className="icon chevron" />
          }
          {expanded
            ? <FolderOpen size={15} className="icon folder" />
            : <Folder size={15} className="icon folder" />
          }
          <span className="name">{entry.name}</span>
        </button>
        {expanded && isLoading && (
          <div className="tree-loading" style={{ '--depth': depth + 1 } as React.CSSProperties}>Loading...</div>
        )}
        {expanded && !isLoading && children?.map(child => (
          <TreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            onSelect={onSelect}
            activePath={activePath}
          />
        ))}
      </>
    )
  }

  const fileIcon = getFileIcon(entry.name)
  const FileIcon = fileIcon.icon

  return (
    <button
      type="button"
      className={'tree-item tree-file ' + (activePath === entry.path ? 'active' : '')}
      style={{ '--depth': depth } as React.CSSProperties}
      onClick={() => onSelect(entry.path)}
      title={entry.path}
    >
      <span className={'file-icon ' + fileIcon.tone}>
        <FileIcon size={14} />
      </span>
      <span className="name">{entry.name}</span>
    </button>
  )
}

export function FileTree({ entries, onSelectFile, activePath }: Props) {
  if (entries.length === 0) {
    return <div className="file-tree-empty">No files</div>
  }

  return (
    <div className="file-tree">
      {entries.map(entry => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          onSelect={onSelectFile}
          activePath={activePath}
        />
      ))}
    </div>
  )
}
