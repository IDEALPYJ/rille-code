import { useCallback, useEffect, useMemo, useState } from 'react'

interface Props {
  rootPath: string | null
}

function GitFileRow({ file, status, actionLabel, actionTitle, onAction }: {
  file: string
  status: 'S' | 'M' | 'U'
  actionLabel: string
  actionTitle: string
  onAction: () => Promise<void>
}) {
  const [isBusy, setIsBusy] = useState(false)

  return (
    <div className="git-file-row">
      <span className="git-file-name" title={file}>{file}</span>
      <span className={'git-status-letter ' + status.toLowerCase()}>{status}</span>
      <button
        type="button"
        title={actionTitle}
        disabled={isBusy}
        onClick={async () => {
          setIsBusy(true)
          await onAction()
          setIsBusy(false)
        }}
      >
        {isBusy ? '...' : actionLabel}
      </button>
    </div>
  )
}

export function GitPanel({ rootPath }: Props) {
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!rootPath) {
      setStatus(null)
      setMessage(null)
      return
    }

    setIsLoading(true)
    setMessage(null)
    try {
      setStatus(await window.rille.gitStatus(rootPath))
    } catch (error) {
      setStatus({
        isRepo: false,
        repoRoot: '',
        branch: '',
        staged: [],
        unstaged: [],
        untracked: [],
        error: error instanceof Error ? error.message : 'Git status failed',
      })
    } finally {
      setIsLoading(false)
    }
  }, [rootPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const stageFile = useCallback(async (file: string) => {
    if (!rootPath) return
    const result = await window.rille.gitStage(rootPath, file)
    if (!result.success) setMessage(result.error || 'Stage failed')
    await refresh()
  }, [refresh, rootPath])

  const unstageFile = useCallback(async (file: string) => {
    if (!rootPath) return
    const result = await window.rille.gitUnstage(rootPath, file)
    if (!result.success) setMessage(result.error || 'Unstage failed')
    await refresh()
  }, [refresh, rootPath])

  const stagedCount = status?.staged.length ?? 0
  const workingCount = (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0)
  const canCommit = stagedCount > 0 && Boolean(commitMessage.trim())

  const commit = useCallback(async () => {
    if (!rootPath || !canCommit) return
    setMessage(null)
    const result = await window.rille.gitCommit(rootPath, commitMessage.trim())
    if (result.success) {
      setCommitMessage('')
      setMessage('Commit created')
      await refresh()
    } else {
      setMessage(result.error || 'Commit failed')
    }
  }, [canCommit, commitMessage, refresh, rootPath])

  const hasWorkingChanges = useMemo(() => workingCount > 0, [workingCount])

  return (
    <div className="side-view git-view">
      <div className="side-view-title-row git-title-row">
        <span className="side-view-title">源代码管理</span>
        <button type="button" onClick={refresh} disabled={!rootPath || isLoading}>{isLoading ? '...' : '刷新'}</button>
      </div>

      {!rootPath && <div className="panel-empty">打开文件夹后可以查看 Git 状态。</div>}
      {rootPath && isLoading && !status && <div className="panel-empty">正在读取 Git 状态...</div>}
      {rootPath && status && !status.isRepo && <div className="panel-empty">当前文件夹不是 Git 仓库。</div>}
      {status?.error && <div className="panel-error">{status.error}</div>}

      {status?.isRepo && (
        <>
          <div className="git-commit-box">
            <textarea
              className="commit-input"
              value={commitMessage}
              placeholder="消息(Ctrl+Enter 提交)"
              rows={2}
              onChange={(event) => setCommitMessage(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canCommit) {
                  event.preventDefault()
                  void commit()
                }
              }}
            />
            <button
              type="button"
              className="commit-button"
              disabled={!canCommit}
              onClick={commit}
            >
              ✓ 提交
            </button>
          </div>

          {message && <div className={message === 'Commit created' ? 'panel-success' : 'panel-error'}>{message}</div>}

          <div className="git-section">
            <div className="git-section-title">
              <span>已暂存</span>
              <span className="git-count">{status.staged.length}</span>
            </div>
            {status.staged.length === 0 && <div className="panel-empty compact">没有已暂存文件</div>}
            {status.staged.map(file => (
              <GitFileRow key={file} file={file} status="S" actionLabel="−" actionTitle="取消暂存" onAction={() => unstageFile(file)} />
            ))}
          </div>

          <div className="git-section">
            <div className="git-section-title">
              <span>更改</span>
              <span className="git-count">{workingCount}</span>
            </div>
            {!hasWorkingChanges && <div className="panel-empty compact">工作区干净</div>}
            {status.unstaged.map(file => (
              <GitFileRow key={file} file={file} status="M" actionLabel="+" actionTitle="暂存" onAction={() => stageFile(file)} />
            ))}
            {status.untracked.map(file => (
              <GitFileRow key={file} file={file} status="U" actionLabel="+" actionTitle="暂存" onAction={() => stageFile(file)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
