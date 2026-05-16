import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { GitDiffTarget } from './GitDiffViewer'

interface Props {
  rootPath: string | null
  onOpenDiff: (target: GitDiffTarget) => void
}

interface GitFileRowProps {
  file: string
  status: 'S' | 'M' | 'U'
  kind: GitFileDiffKind
  actionLabel: string
  actionTitle: string
  onAction: () => Promise<void>
  onOpen: (file: string, kind: GitFileDiffKind) => void
}

interface CommitMenuState {
  commit: GitCommit
  x: number
  y: number
}

interface CommitGraphRow {
  lanes: string[]
  nextLanes: string[]
  lane: number
  parentLanes: number[]
  laneCount: number
}

type GraphCommit = GitCommit & { graph: CommitGraphRow }

const GRAPH_COLORS = ['#f59e0b', '#ec4899', '#a855f7', '#14b8a6', '#3b82f6', '#a16207', '#22c55e', '#ef4444']
const GRAPH_ROW_HEIGHT = 24
const GRAPH_LANE_GAP = 13
const GRAPH_LANE_OFFSET = 7
const GRAPH_MAX_WIDTH = 92

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function graphColor(lane: number): string {
  return GRAPH_COLORS[lane % GRAPH_COLORS.length]
}

function trimEmptyLanes(lanes: string[]): string[] {
  const next = [...lanes]
  while (next.length > 0 && !next[next.length - 1]) {
    next.pop()
  }
  return next
}

function buildCommitGraph(commits: GitCommit[]): GraphCommit[] {
  let lanes: string[] = []

  return commits.map((commit) => {
    let lane = lanes.indexOf(commit.hash)
    if (lane === -1) {
      const emptyLane = lanes.findIndex(value => !value)
      lane = emptyLane === -1 ? lanes.length : emptyLane
      lanes[lane] = commit.hash
    }

    const currentLanes = [...lanes]
    let nextLanes = [...lanes]

    if (commit.parents.length === 0) {
      nextLanes.splice(lane, 1)
    } else {
      nextLanes[lane] = commit.parents[0]
      commit.parents.slice(1).forEach((parent, index) => {
        if (!nextLanes.includes(parent)) {
          nextLanes.splice(lane + index + 1, 0, parent)
        }
      })
    }

    nextLanes = trimEmptyLanes(nextLanes)

    const parentLanes = commit.parents.map((parent) => {
      const parentLane = nextLanes.indexOf(parent)
      return parentLane === -1 ? lane : parentLane
    })

    const laneCount = Math.max(currentLanes.length, nextLanes.length, lane + 1, ...parentLanes.map(parentLane => parentLane + 1))
    const graph = {
      lanes: currentLanes,
      nextLanes,
      lane,
      parentLanes,
      laneCount,
    }

    lanes = nextLanes
    return { ...commit, graph }
  })
}

function CommitGraph({ graph }: { graph: CommitGraphRow }) {
  const width = GRAPH_MAX_WIDTH
  const activeLaneIndexes = Array.from({ length: graph.laneCount }, (_, lane) => lane)
    .filter(lane => Boolean(graph.lanes[lane]) || Boolean(graph.nextLanes[lane]))
  const centerX = GRAPH_LANE_OFFSET + graph.lane * GRAPH_LANE_GAP
  const centerY = GRAPH_ROW_HEIGHT / 2

  return (
    <svg
      className="git-graph"
      width={width}
      height={GRAPH_ROW_HEIGHT}
      viewBox={`0 0 ${width} ${GRAPH_ROW_HEIGHT}`}
      aria-hidden="true"
    >
      {activeLaneIndexes.map((lane) => {
        const x = GRAPH_LANE_OFFSET + lane * GRAPH_LANE_GAP
        if (x > width) return null
        return (
          <line
            key={`line-${lane}`}
            x1={x}
            y1={0}
            x2={x}
            y2={GRAPH_ROW_HEIGHT}
            stroke={graphColor(lane)}
            strokeWidth={1.4}
          />
        )
      })}
      {graph.parentLanes.map((parentLane) => {
        if (parentLane === graph.lane) return null
        const parentX = GRAPH_LANE_OFFSET + parentLane * GRAPH_LANE_GAP
        if (centerX > width && parentX > width) return null
        return (
          <path
            key={`parent-${parentLane}`}
            d={`M ${centerX} ${centerY} C ${centerX} ${GRAPH_ROW_HEIGHT} ${parentX} 0 ${parentX} ${centerY}`}
            fill="none"
            stroke={graphColor(parentLane)}
            strokeWidth={1.4}
          />
        )
      })}
      {centerX <= width && (
        <circle
          cx={centerX}
          cy={centerY}
          r={4.3}
          fill={graphColor(graph.lane)}
          stroke="#ffffff"
          strokeWidth={1.6}
        />
      )}
    </svg>
  )
}

function GitFileRow({
  file,
  status,
  kind,
  actionLabel,
  actionTitle,
  onAction,
  onOpen,
}: GitFileRowProps) {
  const [isBusy, setIsBusy] = useState(false)

  return (
    <div
      className="git-file-row"
      role="button"
      tabIndex={0}
      title={file}
      onClick={() => onOpen(file, kind)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(file, kind)
        }
      }}
    >
      <span className="git-file-name">{file}</span>
      <span className={'git-status-letter ' + status.toLowerCase()}>{status}</span>
      <button
        type="button"
        title={actionTitle}
        disabled={isBusy}
        onClick={async (event) => {
          event.stopPropagation()
          setIsBusy(true)
          try {
            await onAction()
          } finally {
            setIsBusy(false)
          }
        }}
      >
        {isBusy ? '...' : actionLabel}
      </button>
    </div>
  )
}

export function GitPanel({ rootPath, onOpenDiff }: Props) {
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [history, setHistory] = useState<GitCommit[]>([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [commitMenu, setCommitMenu] = useState<CommitMenuState | null>(null)

  const loadHistory = useCallback(async () => {
    if (!rootPath) {
      setHistory([])
      return
    }

    setIsHistoryLoading(true)
    try {
      const result = await window.rille.gitLog(rootPath, 50)
      if (result.success) {
        setHistory(result.commits)
      } else {
        setHistory([])
        setMessage(result.error || '加载历史提交失败。')
      }
    } catch (error) {
      setHistory([])
      setMessage(error instanceof Error ? error.message : '加载历史提交失败。')
    } finally {
      setIsHistoryLoading(false)
    }
  }, [rootPath])

  const refresh = useCallback(async (options?: { keepMessage?: boolean }) => {
    if (!rootPath) {
      setStatus(null)
      setHistory([])
      setMessage(null)
      return
    }

    setIsLoading(true)
    if (!options?.keepMessage) setMessage(null)
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

  const refreshAll = useCallback(async (options?: { keepMessage?: boolean }) => {
    await refresh(options)
    if (isHistoryOpen) await loadHistory()
  }, [isHistoryOpen, loadHistory, refresh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (isHistoryOpen) void loadHistory()
  }, [isHistoryOpen, loadHistory])

  useEffect(() => {
    if (!commitMenu) return

    const close = () => setCommitMenu(null)
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCommitMenu(null)
    }

    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [commitMenu])

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

  const openFileDiff = useCallback((file: string, kind: GitFileDiffKind) => {
    onOpenDiff({
      id: `file:${kind}:${encodeURIComponent(file)}`,
      type: 'file',
      filePath: file,
      kind,
    })
  }, [onOpenDiff])

  const openCommitDiff = useCallback((commit: GitCommit) => {
    onOpenDiff({
      id: `commit:${commit.hash}`,
      type: 'commit',
      commit,
    })
  }, [onOpenDiff])

  const stagedCount = status?.staged.length ?? 0
  const workingCount = (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0)
  const canCommit = stagedCount > 0 && Boolean(commitMessage.trim())
  const graphHistory = useMemo(() => buildCommitGraph(history), [history])

  const commit = useCallback(async () => {
    if (!rootPath || !canCommit) return
    setMessage(null)
    const result = await window.rille.gitCommit(rootPath, commitMessage.trim())
    if (result.success) {
      setCommitMessage('')
      setMessage('Commit created')
      await refreshAll({ keepMessage: true })
    } else {
      setMessage(result.error || 'Commit failed')
    }
  }, [canCommit, commitMessage, refreshAll, rootPath])

  const hasWorkingChanges = useMemo(() => workingCount > 0, [workingCount])

  const runCommitCommand = useCallback(async (
    action: () => Promise<GitCommandResult>,
    successMessage: string,
  ) => {
    setCommitMenu(null)
    setMessage(null)
    try {
      const result = await action()
      if (result.success) {
        setMessage(successMessage)
        await refreshAll({ keepMessage: true })
      } else {
        setMessage(result.error || 'Git 操作失败。')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Git 操作失败。')
    }
  }, [refreshAll])

  const handleCommitMenuAction = useCallback(async (action: string, commitItem: GitCommit) => {
    if (!rootPath) return

    if (action === 'copy-hash') {
      setCommitMenu(null)
      try {
        await copyToClipboard(commitItem.hash)
        setMessage('已复制提交 hash')
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '复制失败。')
      }
      return
    }

    if (action === 'copy-subject') {
      setCommitMenu(null)
      try {
        await copyToClipboard(commitItem.subject)
        setMessage('已复制提交信息')
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '复制失败。')
      }
      return
    }

    if (action === 'view') {
      setCommitMenu(null)
      openCommitDiff(commitItem)
      return
    }

    if (action === 'checkout') {
      setCommitMenu(null)
      if (!window.confirm(`检出 ${commitItem.shortHash} 会进入 detached HEAD。继续吗？`)) return
      await runCommitCommand(
        () => window.rille.gitCheckoutCommit(rootPath, commitItem.hash),
        `已检出 ${commitItem.shortHash}`,
      )
      return
    }

    if (action === 'branch') {
      setCommitMenu(null)
      const branchName = window.prompt('从该提交创建并切换到新分支：', `branch-${commitItem.shortHash}`)
      if (!branchName) return
      await runCommitCommand(
        () => window.rille.gitCreateBranchFromCommit(rootPath, commitItem.hash, branchName),
        `已创建并切换到 ${branchName.trim()}`,
      )
      return
    }

    if (action === 'reset-soft' || action === 'reset-mixed' || action === 'reset-hard') {
      const mode = action.replace('reset-', '') as GitResetMode
      setCommitMenu(null)
      if (!window.confirm(`执行 git reset --${mode} ${commitItem.shortHash}？`)) return
      await runCommitCommand(
        () => window.rille.gitResetToCommit(rootPath, commitItem.hash, mode),
        `已 reset --${mode} 到 ${commitItem.shortHash}`,
      )
    }
  }, [openCommitDiff, rootPath, runCommitCommand])

  return (
    <div className="side-view git-view">
      <div className="side-view-title-row git-title-row">
        <span className="side-view-title">源代码管理</span>
        <button type="button" onClick={() => void refreshAll()} disabled={!rootPath || isLoading || isHistoryLoading}>
          {isLoading ? '...' : '刷新'}
        </button>
      </div>

      {!rootPath && <div className="panel-empty">打开文件夹后可以查看 Git 状态。</div>}
      {rootPath && isLoading && !status && <div className="panel-empty">正在读取 Git 状态...</div>}
      {rootPath && status && !status.isRepo && <div className="panel-empty">当前文件夹不是 Git 仓库。</div>}
      {status?.error && <div className="panel-error">{status.error}</div>}

      {status?.isRepo && (
        <>
          <div className="git-main-scroll">
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
                提交
              </button>
            </div>

            {message && <div className={message === 'Commit created' || message.startsWith('已') ? 'panel-success' : 'panel-error'}>{message}</div>}

            <div className="git-section">
              <div className="git-section-title">
                <span>已暂存</span>
                <span className="git-count">{status.staged.length}</span>
              </div>
              {status.staged.length === 0 && <div className="panel-empty compact">没有已暂存文件</div>}
              {status.staged.map(file => (
                <GitFileRow
                  key={file}
                  file={file}
                  status="S"
                  kind="staged"
                  actionLabel="-"
                  actionTitle="取消暂存"
                  onAction={() => unstageFile(file)}
                  onOpen={openFileDiff}
                />
              ))}
            </div>

            <div className="git-section">
              <div className="git-section-title">
                <span>更改</span>
                <span className="git-count">{workingCount}</span>
              </div>
              {!hasWorkingChanges && <div className="panel-empty compact">工作区干净</div>}
              {status.unstaged.map(file => (
                <GitFileRow
                  key={file}
                  file={file}
                  status="M"
                  kind="unstaged"
                  actionLabel="+"
                  actionTitle="暂存"
                  onAction={() => stageFile(file)}
                  onOpen={openFileDiff}
                />
              ))}
              {status.untracked.map(file => (
                <GitFileRow
                  key={file}
                  file={file}
                  status="U"
                  kind="untracked"
                  actionLabel="+"
                  actionTitle="暂存"
                  onAction={() => stageFile(file)}
                  onOpen={openFileDiff}
                />
              ))}
            </div>
          </div>

          <div className="git-history-panel">
            <button
              type="button"
              className="git-history-toggle"
              onClick={() => setIsHistoryOpen(value => !value)}
            >
              {isHistoryOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>图形</span>
              <span className="git-count">{history.length}</span>
            </button>

            {isHistoryOpen && (
              <div className="git-history-list">
                {isHistoryLoading && <div className="panel-empty compact">正在加载历史提交...</div>}
                {!isHistoryLoading && history.length === 0 && <div className="panel-empty compact">没有历史提交</div>}
                {graphHistory.map(commitItem => (
                  <button
                    type="button"
                    key={commitItem.hash}
                    className="git-history-row"
                    onClick={() => openCommitDiff(commitItem)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setCommitMenu({ commit: commitItem, x: event.clientX, y: event.clientY })
                    }}
                    title={commitItem.subject || commitItem.shortHash}
                  >
                    <CommitGraph graph={commitItem.graph} />
                    <span className="git-history-subject">{commitItem.subject || commitItem.shortHash}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {commitMenu && (
        <div
          className="git-context-menu"
          style={{ left: commitMenu.x, top: commitMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => void handleCommitMenuAction('view', commitMenu.commit)}>查看提交 diff</button>
          <button type="button" onClick={() => void handleCommitMenuAction('copy-hash', commitMenu.commit)}>复制 hash</button>
          <button type="button" onClick={() => void handleCommitMenuAction('copy-subject', commitMenu.commit)}>复制提交信息</button>
          <div className="menu-separator" />
          <button type="button" onClick={() => void handleCommitMenuAction('checkout', commitMenu.commit)}>检出该提交</button>
          <button type="button" onClick={() => void handleCommitMenuAction('branch', commitMenu.commit)}>从此提交创建分支</button>
          <div className="menu-separator" />
          <button type="button" onClick={() => void handleCommitMenuAction('reset-soft', commitMenu.commit)}>Reset --soft 到此提交</button>
          <button type="button" onClick={() => void handleCommitMenuAction('reset-mixed', commitMenu.commit)}>Reset --mixed 到此提交</button>
          <button type="button" className="danger" onClick={() => void handleCommitMenuAction('reset-hard', commitMenu.commit)}>Reset --hard 到此提交</button>
        </div>
      )}
    </div>
  )
}
