import { useCallback, useEffect, useMemo, useState } from 'react'
import { DiffEditor, type DiffBeforeMount } from '@monaco-editor/react'

export type GitDiffTarget =
  | { id: string; type: 'file'; filePath: string; kind: GitFileDiffKind }
  | { id: string; type: 'commit'; commit: GitCommit }

interface Props {
  workspace: WorkspaceLocation | null
  target: GitDiffTarget
}

function languageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    html: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', xml: 'xml', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', sql: 'sql', sh: 'shell', bash: 'shell',
    svg: 'xml', graphql: 'graphql', gql: 'graphql',
  }
  return map[ext ?? ''] ?? 'plaintext'
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath
}

function formatDate(date: string): string {
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleString('zh-CN', { hour12: false })
}

function kindLabel(kind: GitFileDiffKind): string {
  if (kind === 'staged') return '已暂存'
  if (kind === 'untracked') return '未跟踪'
  return '工作区'
}

function statusTitle(status: string): string {
  const code = status[0]
  if (code === 'A') return '新增'
  if (code === 'D') return '删除'
  if (code === 'R') return '重命名'
  if (code === 'C') return '复制'
  return '修改'
}

export function GitDiffViewer({ workspace, target }: Props) {
  const rootPath = workspace?.path ?? null
  const [commitFiles, setCommitFiles] = useState<GitCommitFile[]>([])
  const [selectedFile, setSelectedFile] = useState<GitCommitFile | null>(null)
  const [diff, setDiff] = useState<GitDiffResult | null>(null)
  const [isFilesLoading, setIsFilesLoading] = useState(false)
  const [isDiffLoading, setIsDiffLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleBeforeMount: DiffBeforeMount = useCallback((monaco) => {
    monaco.editor.defineTheme('rille-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '7A8494' },
        { token: 'keyword', foreground: '2457C5' },
        { token: 'number', foreground: 'A855F7' },
        { token: 'string', foreground: '0F7A55' },
      ],
      colors: {
        'editor.background': '#FFFFFF',
        'editor.foreground': '#1D2433',
        'editorLineNumber.foreground': '#AAB4C4',
        'editorLineNumber.activeForeground': '#42526E',
        'editorCursor.foreground': '#2563EB',
        'editor.selectionBackground': '#D9E7FF',
        'editor.inactiveSelectionBackground': '#E8EEF7',
        'editor.lineHighlightBackground': '#F2F6FC',
        'editorWidget.background': '#FFFFFF',
        'editorWidget.border': '#D8E0EC',
        'scrollbarSlider.background': '#CBD5E166',
        'scrollbarSlider.hoverBackground': '#AAB7CA88',
        'scrollbarSlider.activeBackground': '#8E9CB2AA',
      },
    })
  }, [])

  useEffect(() => {
    let isCancelled = false

    if (!rootPath || target.type !== 'file') return () => {
      isCancelled = true
    }

    setCommitFiles([])
    setSelectedFile(null)
    setDiff(null)
    setError(null)
    setIsFilesLoading(false)
    setIsDiffLoading(true)

    window.rille.gitFileDiff(rootPath, target.filePath, target.kind, workspace)
      .then((result) => {
        if (isCancelled) return
        setDiff(result)
        setError(result.success ? null : result.error || '无法加载 diff。')
      })
      .catch((loadError) => {
        if (isCancelled) return
        setDiff(null)
        setError(loadError instanceof Error ? loadError.message : '无法加载 diff。')
      })
      .finally(() => {
        if (!isCancelled) setIsDiffLoading(false)
      })

    return () => {
      isCancelled = true
    }
  }, [rootPath, target, workspace])

  useEffect(() => {
    let isCancelled = false

    if (!rootPath || target.type !== 'commit') return () => {
      isCancelled = true
    }

    setCommitFiles([])
    setSelectedFile(null)
    setDiff(null)
    setError(null)
    setIsFilesLoading(true)
    setIsDiffLoading(false)

    window.rille.gitCommitFiles(rootPath, target.commit.hash, workspace)
      .then((result) => {
        if (isCancelled) return
        if (!result.success) {
          setError(result.error || '无法加载提交文件列表。')
          return
        }
        setCommitFiles(result.files)
        setSelectedFile(result.files[0] ?? null)
      })
      .catch((loadError) => {
        if (isCancelled) return
        setError(loadError instanceof Error ? loadError.message : '无法加载提交文件列表。')
      })
      .finally(() => {
        if (!isCancelled) setIsFilesLoading(false)
      })

    return () => {
      isCancelled = true
    }
  }, [rootPath, target, workspace])

  useEffect(() => {
    let isCancelled = false

    if (!rootPath || target.type !== 'commit' || !selectedFile) return () => {
      isCancelled = true
    }

    setDiff(null)
    setError(null)
    setIsDiffLoading(true)

    window.rille.gitCommitFileDiff(rootPath, target.commit.hash, selectedFile.path, selectedFile.previousPath, workspace)
      .then((result) => {
        if (isCancelled) return
        setDiff(result)
        setError(result.success ? null : result.error || '无法加载 diff。')
      })
      .catch((loadError) => {
        if (isCancelled) return
        setDiff(null)
        setError(loadError instanceof Error ? loadError.message : '无法加载 diff。')
      })
      .finally(() => {
        if (!isCancelled) setIsDiffLoading(false)
      })

    return () => {
      isCancelled = true
    }
  }, [rootPath, selectedFile, target, workspace])

  const title = target.type === 'commit'
    ? target.commit.subject || target.commit.shortHash
    : fileNameFromPath(target.filePath)

  const subtitle = target.type === 'commit'
    ? `${target.commit.shortHash} · ${target.commit.author} · ${formatDate(target.commit.date)}`
    : `${kindLabel(target.kind)} diff · ${target.filePath}`

  const activeFilePath = diff?.filePath ?? selectedFile?.path ?? (target.type === 'file' ? target.filePath : '')
  const language = useMemo(() => languageFromPath(activeFilePath), [activeFilePath])
  const originalModelPath = useMemo(() => `git-diff://original/${target.id}/${activeFilePath}`, [activeFilePath, target.id])
  const modifiedModelPath = useMemo(() => `git-diff://modified/${target.id}/${activeFilePath}`, [activeFilePath, target.id])

  const renderDiffBody = () => {
    if (isDiffLoading) {
      return <div className="git-diff-empty">正在加载 diff...</div>
    }

    if (!diff && error) {
      return <div className="git-diff-empty error">{error}</div>
    }

    if (!diff) {
      return <div className="git-diff-empty">选择一个文件查看 diff。</div>
    }

    if (diff.isBinary) {
      return <div className="git-diff-empty">{diff.error || '二进制文件无法在文本 diff 中预览。'}</div>
    }

    if (!diff.success) {
      return <div className="git-diff-empty error">{diff.error || '无法加载 diff。'}</div>
    }

    return (
      <>
        <div className="git-diff-labels">
          <span title={diff.originalLabel}>{diff.originalLabel}</span>
          <span title={diff.modifiedLabel}>{diff.modifiedLabel}</span>
        </div>
        <div className="git-diff-editor">
          <DiffEditor
            key={`${target.id}:${diff.filePath}`}
            height="100%"
            language={language}
            original={diff.original}
            modified={diff.modified}
            originalModelPath={originalModelPath}
            modifiedModelPath={modifiedModelPath}
            beforeMount={handleBeforeMount}
            theme="rille-light"
            loading={<div className="git-diff-empty">正在加载编辑器...</div>}
            options={{
              readOnly: true,
              originalEditable: false,
              renderSideBySide: true,
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace)",
              lineNumbers: 'on',
              renderWhitespace: 'selection',
              scrollBeyondLastLine: false,
              wordWrap: 'off',
              automaticLayout: true,
            }}
          />
        </div>
      </>
    )
  }

  return (
    <div className="git-diff-view">
      <div className="git-diff-header">
        <div className="git-diff-heading">
          <div className="git-diff-title" title={title}>{title}</div>
          <div className="git-diff-subtitle" title={subtitle}>{subtitle}</div>
        </div>
      </div>
      <div className="git-diff-content">
        {target.type === 'commit' && (
          <div className="git-diff-file-list">
            <div className="git-diff-file-list-title">
              <span>文件</span>
              <span>{commitFiles.length}</span>
            </div>
            {isFilesLoading && <div className="git-diff-list-empty">正在加载...</div>}
            {!isFilesLoading && commitFiles.length === 0 && (
              <div className="git-diff-list-empty">{error || '没有文件变更。'}</div>
            )}
            {commitFiles.map(file => (
              <button
                type="button"
                key={`${file.status}:${file.previousPath ?? ''}:${file.path}`}
                className={'git-diff-file-item ' + (selectedFile?.path === file.path ? 'active' : '')}
                onClick={() => setSelectedFile(file)}
                title={file.previousPath ? `${file.previousPath} -> ${file.path}` : file.path}
              >
                <span className={'git-diff-file-status status-' + file.status.toLowerCase()} title={statusTitle(file.status)}>
                  {file.status[0]}
                </span>
                <span className="git-diff-file-name">{file.path}</span>
              </button>
            ))}
          </div>
        )}
        <div className="git-diff-body">
          {renderDiffBody()}
        </div>
      </div>
    </div>
  )
}
