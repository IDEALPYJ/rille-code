import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  GitBranch,
  GitMerge,
  GitPullRequest,
  MoreHorizontal,
  PackageOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { GitDiffTarget } from './GitDiffViewer'

interface Props {
  workspace: WorkspaceLocation | null
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

interface CommitGraphNode {
  readonly id: string
  readonly color: string
}

interface CommitGraphRow {
  inputSwimlanes: CommitGraphNode[]
  outputSwimlanes: CommitGraphNode[]
  circleIndex: number
  circleColor: string
  parentIds: string[]
  isHead: boolean
  commitId: string
}

type GraphCommit = GitCommit & { graph: CommitGraphRow }

const GRAPH_COLORS = ['#FFB000', '#DC267F', '#994F00', '#40B0A6', '#B66DFF']
const SWIMLANE_HEIGHT = 22
const SWIMLANE_WIDTH = 11
const SWIMLANE_CURVE_RADIUS = 5
const CIRCLE_RADIUS = 4
const CIRCLE_STROKE_WIDTH = 2

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

function md5(str: string): string {
  function r(n: number, c: number) { return (n << c) | (n >>> (32 - c)) }
  function q(n: number, c: number) { return (n & 0xffff) + ((n >> 16) + (c >> 16)) }
  function b(i: number) { return (i + 8).toString(16).slice(-8) }

  let len = str.length
  const words: number[] = [len << 3]
  let i = 0
  for (; i < len; i++) { words[i >> 2] |= str.charCodeAt(i) << ((i & 3) << 3) }
  i = i >> 2
  words[i] |= 0x80 << ((i & 3) << 3)
  if (len % 64 >= 56) {
    for (let j = i + 1; j < ((i + 1) | 15) + 1; j++) words[j] = 0
    i = ((i + 1) | 15) + 1
  }
  for (let j = i + 1; j < (i | 15) + 1; j++) words[j] = 0
  words[(i | 15) - 1] = len << 3

  let a = 0x67452301, bv = 0xefcdab89, c = 0x98badcfe, d = 0x10325476
  for (let k = 0; k < words.length; k += 16) {
    const [aa, bb, cc, dd] = [a, bv, c, d]
    for (let j = 0; j < 64; j++) {
      let f: number, g: number
      if (j < 16) { f = (bv & c) | (~bv & d); g = j }
      else if (j < 32) { f = (d & bv) | (~d & c); g = (5 * j + 1) & 15 }
      else if (j < 48) { f = bv ^ c ^ d; g = (3 * j + 5) & 15 }
      else { f = c ^ (bv | ~d); g = (7 * j) & 15 }
      f = q(f, a + q(bv + f, words[k + g] + [0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x2441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x4881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665][j]))
      a = d; d = c; c = bv; bv = f
      a = r(q(f, a), [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21][j])
    }
    a = q(a, aa); bv = q(bv, bb); c = q(c, cc); d = q(d, dd)
  }
  return b(a) + b(bv) + b(c) + b(d)
}

function gravatarUrl(email: string): string {
  const hash = md5(email.trim().toLowerCase())
  return `https://www.gravatar.com/avatar/${hash}?s=80&d=404`
}

function authorInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0].toUpperCase())
    .join('')
  return initials || 'G'
}

function formatDate(isoStr: string): string {
  try {
    const d = new Date(isoStr)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return isoStr
  }
}

function avatarColor(name: string): string {
  const colors = ['#f59e0b', '#ec4899', '#a855f7', '#14b8a6', '#3b82f6', '#ef4444', '#22c55e', '#f97316']
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

function renderStats(stats: string) {
  const parts = stats.split(', ')
  return parts.map((part, i) => {
    const trimmed = part.trim()
    let color = 'inherit'
    if (trimmed.includes('insertion') || trimmed.includes('addition')) color = '#22863a'
    else if (trimmed.includes('deletion')) color = '#cb2431'
    return (
      <span key={i}>
        {i > 0 && ', '}
        <span style={{ color }}>{trimmed}</span>
      </span>
    )
  })
}

function formatOperationError(result: GitOperationResult, fallback: string): string {
  const details = [result.error, result.stashPopError, result.output].filter(Boolean).join('\n')
  return details || fallback
}

function successMessage(message: string, result: GitOperationResult): string {
  return result.didAutoStash ? `${message}（已自动 stash 并恢复）` : message
}

function findLastIndex(nodes: CommitGraphNode[], id: string): number {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].id === id) return i
  }
  return -1
}

function buildCommitGraph(commits: GitCommit[]): GraphCommit[] {
  let colorIndex = -1
  let prevOutputSwimlanes: CommitGraphNode[] = []
  const result: GraphCommit[] = []

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]
    const inputSwimlanes = prevOutputSwimlanes.map(n => ({ ...n }))
    const outputSwimlanes: CommitGraphNode[] = []
    let firstParentAdded = false

    for (const node of inputSwimlanes) {
      if (node.id === commit.hash) {
        if (commit.parents.length > 0 && !firstParentAdded) {
          outputSwimlanes.push({ id: commit.parents[0], color: node.color })
          firstParentAdded = true
        }
        continue
      }
      outputSwimlanes.push({ ...node })
    }

    for (let j = firstParentAdded ? 1 : 0; j < commit.parents.length; j++) {
      colorIndex = (colorIndex + 1) % GRAPH_COLORS.length
      outputSwimlanes.push({ id: commit.parents[j], color: GRAPH_COLORS[colorIndex] })
    }

    const inputIndex = inputSwimlanes.findIndex(n => n.id === commit.hash)
    const circleIndex = inputIndex !== -1 ? inputIndex : inputSwimlanes.length
    const circleColor = circleIndex < outputSwimlanes.length
      ? outputSwimlanes[circleIndex].color
      : circleIndex < inputSwimlanes.length
        ? inputSwimlanes[circleIndex].color
        : GRAPH_COLORS[0]

    result.push({
      ...commit,
      graph: {
        inputSwimlanes,
        outputSwimlanes,
        circleIndex,
        circleColor,
        parentIds: commit.parents,
        isHead: i === 0,
        commitId: commit.hash,
      },
    })

    prevOutputSwimlanes = outputSwimlanes
  }

  return result
}

function CommitGraph({ graph }: { graph: CommitGraphRow }) {
  const { inputSwimlanes, outputSwimlanes, circleIndex, circleColor, parentIds, isHead, commitId } = graph
  const width = SWIMLANE_WIDTH * (Math.max(inputSwimlanes.length, outputSwimlanes.length, 1) + 1)
  const inputIndex = circleIndex < inputSwimlanes.length ? circleIndex : -1
  const cx = SWIMLANE_WIDTH * (circleIndex + 1)
  const cy = SWIMLANE_HEIGHT / 2

  const paths: Array<{ d: string; stroke: string }> = []
  let outputIndex = 0

  for (let index = 0; index < inputSwimlanes.length; index++) {
    const color = inputSwimlanes[index].color

    if (inputSwimlanes[index].id === commitId) {
      if (index !== circleIndex) {
        const xOld = SWIMLANE_WIDTH * (index + 1)
        const xNew = SWIMLANE_WIDTH * (circleIndex + 1)
        paths.push({
          d: `M ${xOld} 0 A ${SWIMLANE_WIDTH} ${SWIMLANE_WIDTH} 0 0 1 ${SWIMLANE_WIDTH * index} ${SWIMLANE_WIDTH} H ${xNew}`,
          stroke: color,
        })
      } else if (parentIds.length > 0) {
        outputIndex++
      }
    } else if (
      outputIndex < outputSwimlanes.length &&
      inputSwimlanes[index].id === outputSwimlanes[outputIndex].id
    ) {
      if (index === outputIndex) {
        const x = SWIMLANE_WIDTH * (index + 1)
        paths.push({ d: `M ${x} 0 V ${SWIMLANE_HEIGHT}`, stroke: color })
      } else {
        const x1 = SWIMLANE_WIDTH * (index + 1)
        const targetX = SWIMLANE_WIDTH * (outputIndex + 1)
        const R = SWIMLANE_CURVE_RADIUS
        paths.push({
          d: [
            `M ${x1} 0`,
            `V 6`,
            `A ${R} ${R} 0 0 1 ${x1 - R} ${SWIMLANE_HEIGHT / 2}`,
            `H ${targetX + R}`,
            `A ${R} ${R} 0 0 0 ${targetX} ${SWIMLANE_HEIGHT / 2 + R}`,
            `V ${SWIMLANE_HEIGHT}`,
          ].join(' '),
          stroke: color,
        })
      }
      outputIndex++
    }
  }

  for (let i = 1; i < parentIds.length; i++) {
    const parentOutputIndex = findLastIndex(outputSwimlanes, parentIds[i])
    if (parentOutputIndex === -1) continue
    const xParent = SWIMLANE_WIDTH * parentOutputIndex
    paths.push({
      d: [
        `M ${xParent} ${SWIMLANE_HEIGHT / 2}`,
        `A ${SWIMLANE_WIDTH} ${SWIMLANE_WIDTH} 0 0 1 ${xParent + SWIMLANE_WIDTH} ${SWIMLANE_HEIGHT}`,
        `M ${xParent} ${SWIMLANE_HEIGHT / 2}`,
        `H ${cx}`,
      ].join(' '),
      stroke: outputSwimlanes[parentOutputIndex].color,
    })
  }

  if (inputIndex !== -1) paths.push({ d: `M ${cx} 0 V ${cy}`, stroke: inputSwimlanes[inputIndex].color })
  if (parentIds.length > 0) paths.push({ d: `M ${cx} ${cy} V ${SWIMLANE_HEIGHT}`, stroke: circleColor })

  return (
    <svg className="git-graph" width={width} height={SWIMLANE_HEIGHT} aria-hidden="true">
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill="none" stroke={p.stroke} strokeWidth={1} strokeLinecap="round" />
      ))}
      {isHead ? (
        <>
          <circle cx={cx} cy={cy} r={CIRCLE_RADIUS + 3} fill={circleColor} style={{ stroke: 'var(--bg-side)', strokeWidth: CIRCLE_STROKE_WIDTH }} />
          <circle cx={cx} cy={cy} r={CIRCLE_STROKE_WIDTH} fill="none" style={{ stroke: 'var(--bg-side)', strokeWidth: CIRCLE_RADIUS }} />
        </>
      ) : parentIds.length > 1 ? (
        <>
          <circle cx={cx} cy={cy} r={CIRCLE_RADIUS + 2} fill={circleColor} style={{ stroke: 'var(--bg-side)', strokeWidth: CIRCLE_STROKE_WIDTH }} />
          <circle cx={cx} cy={cy} r={CIRCLE_RADIUS - 1} fill={circleColor} style={{ stroke: 'var(--bg-side)', strokeWidth: CIRCLE_STROKE_WIDTH }} />
        </>
      ) : (
        <circle cx={cx} cy={cy} r={CIRCLE_RADIUS + 1} fill={circleColor} style={{ stroke: 'var(--bg-side)', strokeWidth: CIRCLE_STROKE_WIDTH }} />
      )}
    </svg>
  )
}

function GitFileRow({ file, status, kind, actionLabel, actionTitle, onAction, onOpen }: GitFileRowProps) {
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

export function GitPanel({ workspace, onOpenDiff }: Props) {
  const rootPath = workspace?.path ?? null
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [currentBranch, setCurrentBranch] = useState('')
  const [operationState, setOperationState] = useState<GitOperationState | null>(null)
  const [stashes, setStashes] = useState<GitStashEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [isBranchMenuOpen, setIsBranchMenuOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(true)
  const [history, setHistory] = useState<GitCommit[]>([])
  const [avatarMap, setAvatarMap] = useState<Record<string, GitAvatarInfo>>({})
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [hasMoreHistory, setHasMoreHistory] = useState(true)
  const [commitMenu, setCommitMenu] = useState<CommitMenuState | null>(null)
  const [commitHover, setCommitHover] = useState<{ commit: GitCommit; x: number; y: number } | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const avatarRequestedRef = useRef<Set<string>>(new Set())

  const loadHistory = useCallback(async (skip?: number) => {
    if (!rootPath) {
      setHistory([])
      setHasMoreHistory(false)
      return
    }

    setIsHistoryLoading(true)
    try {
      const result = await window.rille.gitLog(rootPath, 50, skip, workspace)
      if (result.success) {
        if (skip && skip > 0) {
          setHistory(prev => [...prev, ...result.commits])
        } else {
          setHistory(result.commits)
          setHasMoreHistory(true)
        }
        if (result.commits.length < 50) setHasMoreHistory(false)
      } else {
        if (!skip) {
          setHistory([])
          setHasMoreHistory(false)
        }
        setMessage(result.error || '加载历史提交失败。')
      }
    } catch (error) {
      if (!skip) {
        setHistory([])
        setHasMoreHistory(false)
      }
      setMessage(error instanceof Error ? error.message : '加载历史提交失败。')
    } finally {
      setIsHistoryLoading(false)
    }
  }, [rootPath, workspace])

  const loadBranches = useCallback(async () => {
    if (!rootPath) {
      setBranches([])
      setCurrentBranch('')
      setOperationState(null)
      return
    }

    const result = await window.rille.gitBranches(rootPath, workspace)
    if (result.success) {
      setBranches(result.branches)
      setCurrentBranch(result.current)
      setOperationState(result.operationState)
    } else {
      setBranches([])
      setCurrentBranch('')
      setOperationState(null)
      setMessage(result.error || '加载分支失败。')
    }
  }, [rootPath, workspace])

  const loadStashes = useCallback(async () => {
    if (!rootPath) {
      setStashes([])
      return
    }

    const result = await window.rille.gitStashList(rootPath, workspace)
    if (result.success) {
      setStashes(result.stashes)
    } else {
      setStashes([])
    }
  }, [rootPath, workspace])

  const refresh = useCallback(async (options?: { keepMessage?: boolean }) => {
    if (!rootPath) {
      setStatus(null)
      setHistory([])
      setBranches([])
      setStashes([])
      setHasMoreHistory(false)
      setOperationState(null)
      setMessage(null)
      return
    }

    setIsLoading(true)
    if (!options?.keepMessage) setMessage(null)
    try {
      const nextStatus = await window.rille.gitStatus(rootPath, workspace)
      setStatus(nextStatus)
      if (nextStatus.operationState) setOperationState(nextStatus.operationState)
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
  }, [rootPath, workspace])

  const refreshAll = useCallback(async (options?: { keepMessage?: boolean }) => {
    await Promise.all([refresh(options), loadBranches(), loadStashes()])
    if (isHistoryOpen) await loadHistory()
  }, [isHistoryOpen, loadBranches, loadHistory, loadStashes, refresh])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  useEffect(() => {
    avatarRequestedRef.current.clear()
    setAvatarMap({})
  }, [rootPath, workspace])

  useEffect(() => {
    if (!rootPath || history.length === 0) return
    const hashes = history
      .map(commit => commit.hash)
      .filter(hash => !avatarMap[hash] && !avatarRequestedRef.current.has(hash))
      .slice(0, 50)
    if (hashes.length === 0) return

    hashes.forEach(hash => avatarRequestedRef.current.add(hash))
    let disposed = false
    window.rille.gitResolveCommitAvatars(rootPath, hashes, workspace)
      .then((result) => {
        if (!disposed && result.success && Object.keys(result.avatars).length > 0) {
          setAvatarMap(prev => ({ ...prev, ...result.avatars }))
        }
      })
      .catch(() => undefined)

    return () => {
      disposed = true
    }
  }, [avatarMap, history, rootPath, workspace])

  useEffect(() => {
    if (!commitMenu && !isBranchMenuOpen) return

    const close = () => {
      setCommitMenu(null)
      setIsBranchMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }

    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [commitMenu, isBranchMenuOpen])

  const stageFile = useCallback(async (file: string) => {
    if (!rootPath) return
    const result = await window.rille.gitStage(rootPath, file, workspace)
    if (!result.success) setMessage(result.error || 'Stage failed')
    await refresh()
  }, [refresh, rootPath, workspace])

  const unstageFile = useCallback(async (file: string) => {
    if (!rootPath) return
    const result = await window.rille.gitUnstage(rootPath, file, workspace)
    if (!result.success) setMessage(result.error || 'Unstage failed')
    await refresh()
  }, [refresh, rootPath, workspace])

  const openFileDiff = useCallback((file: string, kind: GitFileDiffKind) => {
    onOpenDiff({ id: `file:${kind}:${encodeURIComponent(file)}`, type: 'file', filePath: file, kind })
  }, [onOpenDiff])

  const openCommitDiff = useCallback((commit: GitCommit) => {
    onOpenDiff({ id: `commit:${commit.hash}`, type: 'commit', commit })
  }, [onOpenDiff])

  const stagedCount = status?.staged.length ?? 0
  const workingCount = (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0)
  const canCommit = stagedCount > 0 && Boolean(commitMessage.trim())
  const graphHistory = useMemo(() => buildCommitGraph(history), [history])
  const localBranches = useMemo(() => branches.filter(branch => branch.type === 'local'), [branches])
  const remoteBranches = useMemo(() => branches.filter(branch => branch.type === 'remote'), [branches])
  const activeBranchName = branches.find(branch => branch.current)?.name || currentBranch || status?.branch || 'HEAD'
  const hasWorkingChanges = useMemo(() => workingCount > 0 || stagedCount > 0, [stagedCount, workingCount])
  const hoverAvatar = commitHover ? avatarMap[commitHover.commit.hash] : undefined
  const hoverAvatarSrc = commitHover ? (hoverAvatar?.avatarUrl || (commitHover.commit.email ? gravatarUrl(commitHover.commit.email) : '')) : ''
  const isBusy = Boolean(busyAction)

  const commit = useCallback(async () => {
    if (!rootPath || !canCommit) return
    setMessage(null)
    const result = await window.rille.gitCommit(rootPath, commitMessage.trim(), workspace)
    if (result.success) {
      setCommitMessage('')
      setMessage('Commit created')
      await refreshAll({ keepMessage: true })
    } else {
      setMessage(result.error || 'Commit failed')
    }
  }, [canCommit, commitMessage, refreshAll, rootPath, workspace])

  const runTool = useCallback(async (
    id: string,
    action: () => Promise<GitOperationResult>,
    doneMessage: string,
  ) => {
    setBusyAction(id)
    setMessage(null)
    try {
      const result = await action()
      if (result.success) {
        setMessage(successMessage(doneMessage, result))
      } else {
        setMessage(formatOperationError(result, 'Git 操作失败。'))
      }
      if (result.operationState) setOperationState(result.operationState)
      await refreshAll({ keepMessage: true })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Git 操作失败。')
    } finally {
      setBusyAction(null)
    }
  }, [refreshAll])

  const confirmAutoStash = useCallback((label: string): boolean | null => {
    if (!hasWorkingChanges) return false
    return window.confirm(`${label} 前需要处理未提交更改。是否先自动 stash，并在操作成功后恢复？`) ? true : null
  }, [hasWorkingChanges])

  const switchBranch = useCallback(async (branch: GitBranch) => {
    if (!rootPath || branch.current) return
    const autoStash = confirmAutoStash(`切换到 ${branch.name}`)
    if (autoStash === null) return
    setIsBranchMenuOpen(false)
    await runTool(
      `switch-${branch.name}`,
      () => window.rille.gitSwitchBranch(rootPath, branch.name, branch.type, autoStash, workspace),
      `已切换到 ${branch.name}`,
    )
  }, [confirmAutoStash, rootPath, runTool, workspace])

  const createBranch = useCallback(async () => {
    if (!rootPath) return
    const branchName = window.prompt('新建并切换到分支：', '')
    if (!branchName?.trim()) return
    setIsBranchMenuOpen(false)
    await runTool(
      'create-branch',
      () => window.rille.gitCreateBranch(rootPath, branchName.trim(), undefined, true, workspace),
      `已创建并切换到 ${branchName.trim()}`,
    )
  }, [rootPath, runTool, workspace])

  const deleteBranch = useCallback(async (branch: GitBranch) => {
    if (!rootPath || branch.current || branch.type !== 'local') return
    if (!window.confirm(`删除本地分支 ${branch.name}？仅使用安全删除，未合并分支会被 Git 拒绝。`)) return
    await runTool(
      `delete-${branch.name}`,
      () => window.rille.gitDeleteBranch(rootPath, branch.name, workspace),
      `已删除分支 ${branch.name}`,
    )
  }, [rootPath, runTool, workspace])

  const runProtectedTool = useCallback(async (
    id: string,
    label: string,
    action: (autoStash: boolean) => Promise<GitOperationResult>,
    doneMessage: string,
  ) => {
    const autoStash = confirmAutoStash(label)
    if (autoStash === null) return
    await runTool(id, () => action(autoStash), doneMessage)
  }, [confirmAutoStash, runTool])

  const mergeBranch = useCallback(async () => {
    if (!rootPath) return
    const defaultTarget = localBranches.find(branch => !branch.current)?.name || remoteBranches[0]?.name || ''
    const target = window.prompt('合并哪个分支到当前分支？', defaultTarget)
    if (!target?.trim()) return
    await runProtectedTool('merge', `合并 ${target.trim()}`, autoStash => window.rille.gitMerge(rootPath, target.trim(), autoStash, workspace), `已合并 ${target.trim()}`)
  }, [localBranches, remoteBranches, rootPath, runProtectedTool, workspace])

  const rebaseBranch = useCallback(async () => {
    if (!rootPath) return
    const defaultTarget = localBranches.find(branch => !branch.current)?.name || remoteBranches[0]?.name || ''
    const target = window.prompt('将当前分支变基到：', defaultTarget)
    if (!target?.trim()) return
    await runProtectedTool('rebase', `变基到 ${target.trim()}`, autoStash => window.rille.gitRebase(rootPath, target.trim(), autoStash, workspace), `已变基到 ${target.trim()}`)
  }, [localBranches, remoteBranches, rootPath, runProtectedTool, workspace])

  const stashPush = useCallback(async () => {
    if (!rootPath) return
    const stashMessage = window.prompt('储藏说明：', `RilleCode 储藏 ${new Date().toLocaleString()}`)
    if (stashMessage === null) return
    await runTool('stash-push', () => window.rille.gitStashPush(rootPath, stashMessage, workspace), '已创建储藏')
  }, [rootPath, runTool, workspace])

  const runCommitCommand = useCallback(async (
    action: () => Promise<GitCommandResult>,
    doneMessage: string,
  ) => {
    setCommitMenu(null)
    setMessage(null)
    try {
      const result = await action()
      if (result.success) {
        setMessage(doneMessage)
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
      await runCommitCommand(() => window.rille.gitCheckoutCommit(rootPath, commitItem.hash, workspace), `已检出 ${commitItem.shortHash}`)
      return
    }

    if (action === 'branch') {
      setCommitMenu(null)
      const branchName = window.prompt('从该提交创建并切换到新分支：', `branch-${commitItem.shortHash}`)
      if (!branchName) return
      await runCommitCommand(() => window.rille.gitCreateBranchFromCommit(rootPath, commitItem.hash, branchName, workspace), `已创建并切换到 ${branchName.trim()}`)
      return
    }

    if (action === 'reset-soft' || action === 'reset-mixed' || action === 'reset-hard') {
      const mode = action.replace('reset-', '') as GitResetMode
      setCommitMenu(null)
      if (!window.confirm(`执行 git reset --${mode} ${commitItem.shortHash}？`)) return
      await runCommitCommand(() => window.rille.gitResetToCommit(rootPath, commitItem.hash, mode, workspace), `已 reset --${mode} 到 ${commitItem.shortHash}`)
    }
  }, [openCommitDiff, rootPath, runCommitCommand, workspace])

  return (
    <div className="side-view git-view">
      <div className="side-view-title-row git-title-row">
        <span className="side-view-title">源代码管理</span>
        <button
          type="button"
          className="git-icon-button"
          title="刷新"
          aria-label="刷新"
          onClick={() => void refreshAll()}
          disabled={!rootPath || isLoading || isHistoryLoading || isBusy}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {!rootPath && <div className="panel-empty">打开文件夹后可以查看 Git 状态。</div>}
      {rootPath && isLoading && !status && <div className="panel-empty">正在读取 Git 状态...</div>}
      {rootPath && status && !status.isRepo && <div className="panel-empty">当前文件夹不是 Git 仓库。</div>}
      {status?.error && <div className="panel-error">{status.error}</div>}

      {status?.isRepo && (
        <>
          <div className="git-branch-toolbar">
            <div className="git-branch-menu-wrap">
              <button
                type="button"
                className="git-branch-button"
                title={`当前分支：${activeBranchName}`}
                onClick={(event) => {
                  event.stopPropagation()
                  setIsBranchMenuOpen(value => !value)
                }}
              >
                <GitBranch size={14} />
                <span>{activeBranchName}</span>
                <ChevronDown size={13} />
              </button>

              {isBranchMenuOpen && (
                <div className="git-branch-menu" onPointerDown={(event) => event.stopPropagation()}>
                  <div className="git-branch-menu-header">本地分支</div>
                  {localBranches.length === 0 && <div className="git-branch-empty">没有本地分支</div>}
                  {localBranches.map(branch => (
                    <div className="git-branch-row" key={branch.fullName}>
                      <button
                        type="button"
                        className={'git-branch-row-main ' + (branch.current ? 'active' : '')}
                        disabled={branch.current || isBusy}
                        onClick={() => void switchBranch(branch)}
                      >
                        <span>{branch.name}</span>
                        <small>{branch.upstream || branch.hash}</small>
                      </button>
                      {!branch.current && (
                        <button
                          type="button"
                          className="git-icon-button git-branch-delete danger"
                          title={`删除分支 ${branch.name}`}
                          aria-label={`删除分支 ${branch.name}`}
                          disabled={isBusy}
                          onClick={() => void deleteBranch(branch)}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}

                  <div className="git-branch-menu-header">远程分支</div>
                  {remoteBranches.length === 0 && <div className="git-branch-empty">没有远程分支</div>}
                  {remoteBranches.map(branch => (
                    <button
                      type="button"
                      className="git-branch-remote-row"
                      key={branch.fullName}
                      disabled={isBusy}
                      onClick={() => void switchBranch(branch)}
                    >
                      <span>{branch.name}</span>
                      <small>{branch.hash}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="git-icon-button"
              title="新建分支"
              aria-label="新建分支"
              disabled={isBusy}
              onClick={() => void createBranch()}
            >
              <Plus size={15} />
            </button>
          </div>

          {(operationState?.mergeInProgress || operationState?.rebaseInProgress) && (
            <div className="git-operation-alert">
              <span>{operationState.mergeInProgress ? 'Merge 正在进行，请解决冲突后提交。' : 'Rebase 正在进行，请解决冲突后继续或中止。'}</span>
              {operationState.mergeInProgress && (
                <button
                  type="button"
                  className="git-icon-button danger"
                  title="中止 merge"
                  aria-label="中止 merge"
                  disabled={isBusy}
                  onClick={() => void runTool('abort-merge', () => window.rille.gitAbortMerge(rootPath!, workspace), '已中止 merge')}
                >
                  <X size={14} />
                </button>
              )}
              {operationState.rebaseInProgress && (
                <button
                  type="button"
                  className="git-icon-button danger"
                  title="中止 rebase"
                  aria-label="中止 rebase"
                  disabled={isBusy}
                  onClick={() => void runTool('abort-rebase', () => window.rille.gitAbortRebase(rootPath!, workspace), '已中止 rebase')}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}

          <div className="git-main-scroll">
            <div className="git-commit-box">
              <textarea
                className="commit-input"
                value={commitMessage}
                placeholder="消息(Ctrl+Enter 提交)"
                rows={1}
                onChange={(event) => {
                  setCommitMessage(event.target.value)
                  const el = event.target
                  el.style.height = 'auto'
                  el.style.height = Math.min(el.scrollHeight, 20 * 6 + 8) + 'px'
                }}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canCommit) {
                    event.preventDefault()
                    void commit()
                  }
                }}
              />
              <button type="button" className="commit-button" disabled={!canCommit || isBusy} onClick={commit}>
                <Check size={14} />
                <span>提交</span>
              </button>
            </div>

            {message && <pre className={message === 'Commit created' || message.startsWith('已') ? 'panel-success' : 'panel-error'}>{message === 'Commit created' ? '提交已创建' : message}</pre>}

            <div className="git-scm-action-bar" aria-label="Git actions">
              <button type="button" className="git-icon-button" title="获取" aria-label="获取" disabled={isBusy} onClick={() => void runTool('fetch', () => window.rille.gitFetch(rootPath!, workspace), '获取完成')}><Download size={15} /></button>
              <button type="button" className="git-icon-button" title="拉取" aria-label="拉取" disabled={isBusy} onClick={() => void runProtectedTool('pull', '拉取', autoStash => window.rille.gitPull(rootPath!, autoStash, workspace), '拉取完成')}><RotateCcw size={15} /></button>
              <button type="button" className="git-icon-button" title="推送" aria-label="推送" disabled={isBusy} onClick={() => void runTool('push', () => window.rille.gitPush(rootPath!, workspace), '推送完成')}><Upload size={15} /></button>
              <button type="button" className="git-icon-button" title="合并" aria-label="合并" disabled={isBusy} onClick={() => void mergeBranch()}><GitMerge size={15} /></button>
              <button type="button" className="git-icon-button" title="变基" aria-label="变基" disabled={isBusy} onClick={() => void rebaseBranch()}><GitPullRequest size={15} /></button>
              <button type="button" className="git-icon-button" title="储藏" aria-label="储藏" disabled={isBusy} onClick={() => void stashPush()}><Archive size={15} /></button>
            </div>

            <div className="git-section">
              <div className="git-section-title">
                <span>已暂存</span>
                <span className="git-count">{status.staged.length}</span>
              </div>
              {status.staged.length === 0 && <div className="panel-empty compact">没有已暂存文件</div>}
              {status.staged.map(file => (
                <GitFileRow key={file} file={file} status="S" kind="staged" actionLabel="-" actionTitle="取消暂存" onAction={() => unstageFile(file)} onOpen={openFileDiff} />
              ))}
            </div>

            <div className="git-section">
              <div className="git-section-title">
                <span>更改</span>
                <span className="git-count">{workingCount}</span>
              </div>
              {!hasWorkingChanges && <div className="panel-empty compact">工作区干净</div>}
              {status.unstaged.map(file => (
                <GitFileRow key={file} file={file} status="M" kind="unstaged" actionLabel="+" actionTitle="暂存" onAction={() => stageFile(file)} onOpen={openFileDiff} />
              ))}
              {status.untracked.map(file => (
                <GitFileRow key={file} file={file} status="U" kind="untracked" actionLabel="+" actionTitle="暂存" onAction={() => stageFile(file)} onOpen={openFileDiff} />
              ))}
            </div>

            <div className="git-section">
              <div className="git-section-title">
                <span>储藏</span>
                <span className="git-count">{stashes.length}</span>
              </div>
              {stashes.length === 0 && <div className="panel-empty compact">没有储藏</div>}
              {stashes.map(stash => (
                <div className="git-stash-row" key={stash.ref} title={stash.message}>
                  <div className="git-stash-main">
                    <span>{stash.ref}</span>
                    <small>{stash.message}</small>
                  </div>
                  <button type="button" className="git-icon-button" title={`应用 ${stash.ref}`} aria-label={`应用 ${stash.ref}`} disabled={isBusy} onClick={() => void runTool(`stash-apply-${stash.ref}`, () => window.rille.gitStashApply(rootPath!, stash.ref, workspace), `已应用 ${stash.ref}`)}><ArchiveRestore size={14} /></button>
                  <button type="button" className="git-icon-button" title={`弹出 ${stash.ref}`} aria-label={`弹出 ${stash.ref}`} disabled={isBusy} onClick={() => void runTool(`stash-pop-${stash.ref}`, () => window.rille.gitStashPop(rootPath!, stash.ref, workspace), `已弹出 ${stash.ref}`)}><PackageOpen size={14} /></button>
                  <button type="button" className="git-icon-button danger" title={`删除 ${stash.ref}`} aria-label={`删除 ${stash.ref}`} disabled={isBusy} onClick={() => {
                    if (window.confirm(`删除 ${stash.ref}？`)) void runTool(`stash-drop-${stash.ref}`, () => window.rille.gitStashDrop(rootPath!, stash.ref, workspace), `已删除 ${stash.ref}`)
                  }}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>

          <div className={'git-history-panel ' + (isHistoryOpen ? '' : 'collapsed')}>
            <div className="git-history-panel-header">
              <button
                type="button"
                className="git-history-toggle"
                title={`${history.length} 条提交`}
                onClick={() => {
                  if (!isHistoryOpen && history.length === 0) void loadHistory()
                  setIsHistoryOpen(value => !value)
                }}
              >
                {isHistoryOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>图形</span>
              </button>
              <div className="git-section-actions">
                <button type="button" className="git-icon-button" title="刷新图形" aria-label="刷新图形" disabled={isHistoryLoading || isBusy} onClick={() => void loadHistory()}><RefreshCw size={14} /></button>
                <button type="button" className="git-icon-button" title="更多图形操作" aria-label="更多图形操作" disabled><MoreHorizontal size={14} /></button>
              </div>
            </div>
            {isHistoryOpen && (
              <div
                className="git-history-list"
                onScroll={(event) => {
                  const el = event.currentTarget
                  if (el.scrollHeight - el.scrollTop - el.clientHeight < 60 && !isHistoryLoading && hasMoreHistory) {
                    void loadHistory(history.length)
                  }
                }}
              >
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
                    onMouseEnter={(event) => {
                      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
                      const rect = event.currentTarget.getBoundingClientRect()
                      setCommitHover({ commit: commitItem, x: rect.right + 8, y: rect.top })
                    }}
                    onMouseLeave={() => {
                      hoverTimerRef.current = setTimeout(() => setCommitHover(null), 200)
                    }}
                  >
                    <CommitGraph graph={commitItem.graph} />
                    <span className="git-history-subject">{commitItem.subject || commitItem.shortHash}</span>
                    <span className="git-history-author">{commitItem.author}</span>
                  </button>
                ))}
                {hasMoreHistory && !isHistoryLoading && history.length > 0 && <div className="panel-empty compact">继续向下滚动加载更多</div>}
              </div>
            )}
          </div>

        </>
      )}

      {commitMenu && (
        <div className="git-context-menu" style={{ left: commitMenu.x, top: commitMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => void handleCommitMenuAction('view', commitMenu.commit)}><Eye size={13} />查看提交 diff</button>
          <button type="button" onClick={() => void handleCommitMenuAction('copy-hash', commitMenu.commit)}><Copy size={13} />复制 hash</button>
          <button type="button" onClick={() => void handleCommitMenuAction('copy-subject', commitMenu.commit)}><Copy size={13} />复制提交信息</button>
          <div className="menu-separator" />
          <button type="button" onClick={() => void handleCommitMenuAction('checkout', commitMenu.commit)}><GitBranch size={13} />检出该提交</button>
          <button type="button" onClick={() => void handleCommitMenuAction('branch', commitMenu.commit)}><Plus size={13} />从此提交创建分支</button>
          <div className="menu-separator" />
          <button type="button" onClick={() => void handleCommitMenuAction('reset-soft', commitMenu.commit)}><RotateCcw size={13} />Reset --soft 到此提交</button>
          <button type="button" onClick={() => void handleCommitMenuAction('reset-mixed', commitMenu.commit)}><RotateCcw size={13} />Reset --mixed 到此提交</button>
          <button type="button" className="danger" onClick={() => void handleCommitMenuAction('reset-hard', commitMenu.commit)}><Trash2 size={13} />Reset --hard 到此提交</button>
        </div>
      )}

      {commitHover && !commitMenu && (
        <div
          className="git-hover-card"
          style={{ left: commitHover.x, top: commitHover.y }}
          onMouseEnter={() => {
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
          }}
          onMouseLeave={() => setCommitHover(null)}
        >
          <div className="git-hover-header">
            {hoverAvatarSrc && (
              <img
                key={hoverAvatarSrc}
                className="git-hover-avatar"
                src={hoverAvatarSrc}
                alt=""
                style={{ display: 'block' }}
                onError={(e) => {
                  const el = e.currentTarget as HTMLImageElement
                  el.style.display = 'none'
                  const fallback = el.nextElementSibling as HTMLElement
                  if (fallback) fallback.style.display = 'flex'
                }}
              />
            )}
            <div className="git-hover-avatar-fallback" style={{ background: avatarColor(commitHover.commit.author), display: hoverAvatarSrc ? 'none' : 'flex' }}>
              {authorInitials(commitHover.commit.author)}
            </div>
            <div>
              <div className="git-hover-name">{commitHover.commit.author}</div>
              <div className="git-hover-email">{commitHover.commit.email}</div>
              {hoverAvatar?.githubLogin && <div className="git-hover-email">GitHub @{hoverAvatar.githubLogin}</div>}
            </div>
          </div>
          <div className="git-hover-date">{formatDate(commitHover.commit.date)}</div>
          {commitHover.commit.body && <pre className="git-hover-body">{commitHover.commit.body}</pre>}
          {commitHover.commit.stats && <div className="git-hover-stats">{renderStats(commitHover.commit.stats)}</div>}
          <div className="git-hover-hash">{commitHover.commit.hash}</div>
        </div>
      )}
    </div>
  )
}
