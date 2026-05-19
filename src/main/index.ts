import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron'
import type { OpenDialogOptions, SaveDialogOptions, WebContents } from 'electron'
import { execFile, execFileSync, spawn } from 'child_process'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { createServer } from 'http'
import type { Server } from 'http'
import { request } from 'https'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { basename, join, relative } from 'path'
import { readdir, readFile, writeFile, stat } from 'fs/promises'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import * as pty from 'node-pty'

let mainWindow: BrowserWindow | null = null

interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  children?: FileEntry[]
}

interface SearchOptions {
  caseSensitive: boolean
  includeDependencies: boolean
}

interface SearchResult {
  filePath: string
  line: number
  column: number
  preview: string
}

interface GitStatusResult {
  isRepo: boolean
  repoRoot: string
  branch: string
  staged: string[]
  unstaged: string[]
  untracked: string[]
  operationState?: GitOperationState
  error?: string
}

interface GitCommandResult {
  success: boolean
  error?: string
}

interface GitOperationState {
  mergeInProgress: boolean
  rebaseInProgress: boolean
}

interface GitOperationResult extends GitCommandResult {
  output?: string
  didAutoStash?: boolean
  stashPopError?: string
  needsResolution?: boolean
  operationState?: GitOperationState
}

type GitFileDiffKind = 'staged' | 'unstaged' | 'untracked'
type GitResetMode = 'soft' | 'mixed' | 'hard'

interface GitDiffResult {
  success: boolean
  filePath: string
  original: string
  modified: string
  originalLabel: string
  modifiedLabel: string
  isBinary?: boolean
  error?: string
}

interface GitCommitSummary {
  hash: string
  shortHash: string
  author: string
  email: string
  date: string
  subject: string
  body: string
  stats: string
  parents: string[]
  avatarUrl?: string
  avatarSource?: 'github' | 'gravatar' | 'fallback'
  githubLogin?: string
}

interface GitCommitFile {
  path: string
  previousPath?: string
  status: string
}

interface GitBranch {
  name: string
  fullName: string
  type: 'local' | 'remote'
  current: boolean
  upstream?: string
  remote?: string
  hash?: string
}

interface GitBranchesResult {
  success: boolean
  current: string
  branches: GitBranch[]
  operationState: GitOperationState
  error?: string
}

interface GitStashEntry {
  ref: string
  index: number
  hash: string
  message: string
}

interface GitStashListResult {
  success: boolean
  stashes: GitStashEntry[]
  error?: string
}

interface GitAvatarInfo {
  avatarUrl?: string
  avatarSource?: 'github' | 'gravatar' | 'fallback'
  githubLogin?: string
}

interface GitAvatarResult {
  success: boolean
  avatars: Record<string, GitAvatarInfo>
  error?: string
}

interface GitHubCommitResponse {
  author?: { avatar_url?: string; login?: string } | null
  committer?: { avatar_url?: string; login?: string } | null
}

type OutputChannel = 'Git' | 'Terminal' | 'Debug' | 'Ports' | 'System'
type OutputLevel = 'info' | 'warning' | 'error'

interface OutputEntry {
  id: string
  timestamp: string
  channel: OutputChannel
  level: OutputLevel
  message: string
  details?: string
}

interface TerminalProfile {
  id: string
  label: string
  path: string
  args?: string[]
  source: 'detected' | 'fallback'
  kind: 'local' | 'wsl' | 'ssh'
  isDefault?: boolean
}

type SshAuthMethod = 'sshConfigOrAgent' | 'password' | 'identityFile' | 'identityFileWithPassphrase'

interface SshTargetConfig {
  id: string
  alias: string
  hostName: string
  user?: string
  port?: number
  authMethod: SshAuthMethod
  identityFile?: string
  proxyJump?: string
  extraOptions?: string
  defaultRemotePath?: string
}

interface RemoteAuthPromptRequest {
  requestId: string
  prompt: string
  kind: 'password' | 'confirmation' | 'text'
}

interface TerminalLaunchOptions {
  profileId?: string
  sshHost?: string
  workspace?: WorkspaceLocation | null
}

interface RemoteTarget {
  id: string
  kind: 'ssh' | 'wsl'
  label: string
  profileId: string
  host?: string
  distro?: string
  source: 'detected' | 'configured' | 'ssh-config' | 'wsl'
  sshConfigId?: string
  sshConfig?: SshTargetConfig
  defaultRemotePath?: string
}

interface WorkspaceLocation {
  kind: 'local' | 'ssh' | 'wsl'
  path: string
  label: string
  connectionId?: string
  targetId?: string
}

interface RemoteConnection {
  id: string
  targetId: string
  kind: 'ssh' | 'wsl'
  label: string
  home: string
  status: 'connecting' | 'connected' | 'error'
  error?: string
}

interface TerminalSession {
  id: string
  cwd: string
  shell: string
  profileId: string
  name: string
  workspace?: WorkspaceLocation | null
}

interface TerminalRuntime {
  session: TerminalSession
  terminal: pty.IPty
}

interface RemoteRuntime {
  connection: RemoteConnection
  target: RemoteTarget
  process: ChildProcessWithoutNullStreams
  seq: number
  buffer: Buffer
  stderr: string
  pending: Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }>
}

interface PortEntry {
  id: string
  protocol: string
  address: string
  port: number
  pid: number
  processName?: string
}

interface PortOperationResult {
  success: boolean
  error?: string
}

interface DebugBreakpoint {
  sourcePath: string
  lines: number[]
}

interface DebugConfiguration {
  name: string
  adapterCommand: string
  adapterArgs?: string[]
  cwd?: string
  launch?: Record<string, unknown>
  breakpoints?: DebugBreakpoint[]
}

interface DebugSessionState {
  id: string
  status: 'starting' | 'running' | 'paused' | 'stopped' | 'error'
  name: string
  error?: string
}

interface DebugProtocolMessage {
  seq?: number
  type: 'request' | 'response' | 'event'
  command?: string
  request_seq?: number
  success?: boolean
  event?: string
  message?: string
  body?: Record<string, unknown>
}

interface DebugRuntime {
  id: string
  sender: WebContents
  process: ChildProcessWithoutNullStreams
  seq: number
  buffer: Buffer
  state: DebugSessionState
  configuration: DebugConfiguration
  initialized: boolean
  launched: boolean
  lastThreadId?: number
}

interface DebugEventPayload {
  sessionId: string
  type: 'state' | 'output' | 'message' | 'error'
  state?: DebugSessionState
  message?: string
  body?: Record<string, unknown>
}

const MAX_SEARCH_RESULTS = 300
const MAX_SEARCH_FILE_SIZE = 1024 * 1024
const GIT_TIMEOUT_MS = 60_000
const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const outputEntries: OutputEntry[] = []
const terminalSessions = new Map<string, TerminalRuntime>()
const debugSessions = new Map<string, DebugRuntime>()
const remoteConnections = new Map<string, RemoteRuntime>()
const pendingAuthPrompts = new Map<string, {
  resolve: (value: string) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}>()
let askPassServer: Server | null = null
let askPassPort = 0
let askPassScriptPath = ''
const REMOTE_AGENT_SOURCE = String.raw`
const childProcess = require('child_process');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const os = require('os');

const MAX_SEARCH_RESULTS = 300;
const MAX_SEARCH_FILE_SIZE = 1024 * 1024;
const GIT_TIMEOUT_MS = 60000;
const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
let inputBuffer = Buffer.alloc(0);
process.stderr.write('RILLECODE_AGENT_READY\n');

function sendFrame(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  process.stdout.write('Content-Length: ' + body.length + '\r\n\r\n');
  process.stdout.write(body);
}

function sendResult(id, result) {
  sendFrame({ id, result });
}

function sendError(id, error) {
  sendFrame({ id, error: { message: error && error.message ? error.message : String(error || 'Remote agent error') } });
}

function drainInput() {
  while (inputBuffer.length > 0) {
    const headerText = inputBuffer.toString('utf8');
    const headerEnd = headerText.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = headerText.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      inputBuffer = inputBuffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (inputBuffer.length < bodyStart + length) return;
    const body = inputBuffer.slice(bodyStart, bodyStart + length).toString('utf8');
    inputBuffer = inputBuffer.slice(bodyStart + length);
    let message;
    try {
      message = JSON.parse(body);
    } catch (error) {
      sendError(0, error);
      continue;
    }
    dispatch(message).catch(error => sendError(message.id, error));
  }
}

process.stdin.on('data', chunk => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  drainInput();
});

process.stdin.on('end', () => process.exit(0));
process.on('uncaughtException', error => sendError(0, error));
process.on('unhandledRejection', error => sendError(0, error));

function asBool(value) {
  return Boolean(value);
}

async function readDirectory(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    result.push({
      name: entry.name,
      path: path.join(dirPath, entry.name),
      isDirectory: entry.isDirectory(),
    });
  }
  return result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function searchFiles(rootPath, query, options) {
  const needle = options && options.caseSensitive ? query : query.toLowerCase();
  const results = [];
  if (!needle.trim()) return results;

  async function walk(dirPath) {
    if (results.length >= MAX_SEARCH_RESULTS) return;
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= MAX_SEARCH_RESULTS) return;
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      if (!(options && options.includeDependencies) && (entry.name === 'node_modules' || entry.name === 'out')) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      let fileStat;
      try {
        fileStat = await fs.stat(fullPath);
      } catch {
        continue;
      }
      if (fileStat.size > MAX_SEARCH_FILE_SIZE) continue;
      let content;
      try {
        content = await fs.readFile(fullPath, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const lineText = lines[index];
        const haystack = options && options.caseSensitive ? lineText : lineText.toLowerCase();
        const column = haystack.indexOf(needle);
        if (column === -1) continue;
        results.push({ filePath: fullPath, line: index + 1, column: column + 1, preview: lineText.trim().slice(0, 240) });
        if (results.length >= MAX_SEARCH_RESULTS) return;
      }
    }
  }

  await walk(rootPath);
  return results;
}

function runGit(cwd, args) {
  return new Promise(resolve => {
    childProcess.execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: GIT_TIMEOUT_MS }, (error, stdout, stderr) => {
      const stderrText = String(stderr || '');
      resolve({ success: !error, stdout: String(stdout || ''), stderr: stderrText, error: error ? stderrText || error.message : undefined });
    });
  });
}

function commandOutput(result) {
  return [String(result.stdout || '').trim(), String(result.stderr || '').trim()].filter(Boolean).join('\n');
}

function toGitPath(repoRoot, filePath) {
  const normalizedRoot = repoRoot.replace(/\\/g, '/');
  const normalizedFile = String(filePath || '').replace(/\\/g, '/');
  if (normalizedFile === normalizedRoot) return '';
  return normalizedFile.startsWith(normalizedRoot + '/') ? path.relative(repoRoot, filePath).replace(/\\/g, '/') : normalizedFile;
}

function toAbsoluteGitPath(repoRoot, gitPath) {
  if (!gitPath) return path.join(repoRoot, '.git');
  if (gitPath.startsWith('/')) return gitPath;
  return path.join(repoRoot, gitPath);
}

async function resolveRepoRoot(rootPath) {
  const gitVersion = await runGit(rootPath, ['--version']);
  if (!gitVersion.success) return { success: false, repoRoot: '', error: 'Git is not available: ' + (gitVersion.error || 'unknown error') };
  const insideRepo = await runGit(rootPath, ['rev-parse', '--is-inside-work-tree']);
  if (!insideRepo.success || insideRepo.stdout.trim() !== 'true') return { success: false, repoRoot: '', error: insideRepo.error || '当前文件夹不是 Git 仓库。' };
  const rootResult = await runGit(rootPath, ['rev-parse', '--show-toplevel']);
  if (!rootResult.success) return { success: false, repoRoot: '', error: rootResult.error || '无法解析 Git 仓库根目录。' };
  return { success: true, repoRoot: rootResult.stdout.trim() };
}

async function getGitOperationState(repoRoot) {
  const gitDirResult = await runGit(repoRoot, ['rev-parse', '--git-dir']);
  const gitDir = toAbsoluteGitPath(repoRoot, gitDirResult.stdout.trim() || '.git');
  return {
    mergeInProgress: fsSync.existsSync(path.join(gitDir, 'MERGE_HEAD')),
    rebaseInProgress: fsSync.existsSync(path.join(gitDir, 'rebase-merge')) || fsSync.existsSync(path.join(gitDir, 'rebase-apply')),
  };
}

async function isWorktreeDirty(repoRoot) {
  const statusResult = await runGit(repoRoot, ['status', '--porcelain=v1', '-z']);
  return statusResult.success && statusResult.stdout.length > 0;
}

async function runGitOperation(repoRoot, args, options) {
  const dirty = await isWorktreeDirty(repoRoot);
  let didAutoStash = false;
  if (dirty && options && options.requireClean && !options.autoStash) {
    return { success: false, error: '工作区存在未提交更改。请提交、手动 stash，或确认自动 stash 后再执行。', operationState: await getGitOperationState(repoRoot) };
  }
  if (dirty && options && options.autoStash) {
    const stashResult = await runGit(repoRoot, ['stash', 'push', '-u', '-m', options.stashMessage || 'RilleCode auto stash']);
    if (!stashResult.success) return { success: false, error: stashResult.error || '自动 stash 失败。', output: commandOutput(stashResult), operationState: await getGitOperationState(repoRoot) };
    didAutoStash = true;
  }
  const result = await runGit(repoRoot, args);
  let operationState = await getGitOperationState(repoRoot);
  const output = commandOutput(result);
  if (!result.success) return { success: false, error: result.error || output || 'Git 操作失败。', output, didAutoStash, needsResolution: operationState.mergeInProgress || operationState.rebaseInProgress, operationState };
  if (didAutoStash) {
    const popResult = await runGit(repoRoot, ['stash', 'pop']);
    operationState = await getGitOperationState(repoRoot);
    if (!popResult.success) return { success: false, error: 'Git 操作已完成，但自动恢复 stash 失败。请查看工作区并手动处理 stash。', output, didAutoStash, stashPopError: popResult.error || commandOutput(popResult) || 'stash pop failed', needsResolution: true, operationState };
  }
  return { success: true, output, didAutoStash, operationState };
}

function createTextReadResult(content) {
  const value = content || '';
  return { success: true, content: value, isBinary: value.includes('\0') };
}

async function readGitObjectText(repoRoot, revision, filePath) {
  const spec = revision === ':' ? ':' + filePath : revision + ':' + filePath;
  const result = await runGit(repoRoot, ['show', spec]);
  if (!result.success) return createTextReadResult('');
  return createTextReadResult(result.stdout);
}

async function readWorktreeText(repoRoot, filePath) {
  const absolutePath = path.join(repoRoot, filePath);
  if (!fsSync.existsSync(absolutePath)) return createTextReadResult('');
  try {
    return createTextReadResult(await fs.readFile(absolutePath, 'utf8'));
  } catch (error) {
    return { success: false, content: '', error: error && error.message ? error.message : '无法读取文件内容。' };
  }
}

function buildGitDiffResult(filePath, original, modified, originalLabel, modifiedLabel) {
  if (!original.success || !modified.success) return { success: false, filePath, original: '', modified: '', originalLabel, modifiedLabel, error: original.error || modified.error || '无法读取 diff 内容。' };
  if (original.isBinary || modified.isBinary) return { success: true, filePath, original: '', modified: '', originalLabel, modifiedLabel, isBinary: true, error: '二进制文件无法在文本 diff 中预览。' };
  return { success: true, filePath, original: original.content, modified: modified.content, originalLabel, modifiedLabel };
}

function normalizeGitLimit(limit) {
  const value = Number(limit || 50);
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(200, Math.floor(value)));
}

async function gitStatus(rootPath) {
  const repo = await resolveRepoRoot(rootPath);
  if (!repo.success) return { isRepo: false, repoRoot: '', branch: '', staged: [], unstaged: [], untracked: [], error: repo.error };
  const branchResult = await runGit(repo.repoRoot, ['branch', '--show-current']);
  const fallbackBranch = await runGit(repo.repoRoot, ['rev-parse', '--short', 'HEAD']);
  const statusResult = await runGit(repo.repoRoot, ['status', '--porcelain=v1', '-z']);
  const staged = new Set();
  const unstaged = new Set();
  const untracked = new Set();
  if (statusResult.success) {
    const entries = statusResult.stdout.split('\0').filter(Boolean);
    for (let index = 0; index < entries.length; index += 1) {
      const item = entries[index];
      if (item.length < 4) continue;
      const x = item[0];
      const y = item[1];
      const filePath = item.slice(3);
      if ((x === 'R' || x === 'C') && entries[index + 1]) index += 1;
      if (x === '?' && y === '?') {
        untracked.add(filePath);
        continue;
      }
      if (x !== ' ' && x !== '?') staged.add(filePath);
      if (y !== ' ' && y !== '?') unstaged.add(filePath);
    }
  }
  return { isRepo: true, repoRoot: repo.repoRoot, branch: branchResult.stdout.trim() || fallbackBranch.stdout.trim() || 'HEAD', staged: Array.from(staged).sort(), unstaged: Array.from(unstaged).sort(), untracked: Array.from(untracked).sort(), operationState: await getGitOperationState(repo.repoRoot), error: statusResult.success ? undefined : statusResult.error };
}

async function gitFileDiff(rootPath, filePath, kind) {
  const repo = await resolveRepoRoot(rootPath);
  const gitPath = repo.success ? toGitPath(repo.repoRoot, filePath) : filePath;
  if (!repo.success) return { success: false, filePath: gitPath, original: '', modified: '', originalLabel: '', modifiedLabel: '', error: repo.error };
  if (kind === 'staged') return buildGitDiffResult(gitPath, await readGitObjectText(repo.repoRoot, 'HEAD', gitPath), await readGitObjectText(repo.repoRoot, ':', gitPath), 'HEAD', '已暂存');
  if (kind === 'untracked') return buildGitDiffResult(gitPath, createTextReadResult(''), await readWorktreeText(repo.repoRoot, gitPath), '空文件', '工作区');
  return buildGitDiffResult(gitPath, await readGitObjectText(repo.repoRoot, ':', gitPath), await readWorktreeText(repo.repoRoot, gitPath), '索引', '工作区');
}

async function gitLog(rootPath, limit, skip) {
  const repo = await resolveRepoRoot(rootPath);
  if (!repo.success) return { success: false, commits: [], error: repo.error };
  const recordSep = String.fromCharCode(30);
  const fieldSep = String.fromCharCode(31);
  const statsSep = String.fromCharCode(29);
  const args = ['log'];
  if (skip && skip > 0) args.push('--skip=' + skip);
  args.push('--topo-order', '--shortstat', '-' + normalizeGitLimit(limit), '--date=iso-strict', '--pretty=format:%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%P%x1f%b%x1d');
  const result = await runGit(repo.repoRoot, args);
  if (!result.success) return { success: false, commits: [], error: result.error };
  const commits = [];
  for (const record of result.stdout.split(recordSep)) {
    if (!record.trim()) continue;
    const parts = record.split(statsSep);
    const fields = (parts[0] || '').split(fieldSep);
    const hash = fields[0] || '';
    if (!hash) continue;
    commits.push({ hash, shortHash: fields[1] || '', author: fields[2] || '', email: fields[3] || '', date: fields[4] || '', subject: fields[5] || '', parents: (fields[6] || '').split(' ').filter(Boolean), body: fields.slice(7).join(fieldSep) || '', stats: (parts[1] || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim() });
  }
  return { success: true, commits };
}

async function getCommitBase(repoRoot, hash) {
  const parentsResult = await runGit(repoRoot, ['rev-list', '--parents', '-n', '1', hash]);
  if (!parentsResult.success) return EMPTY_TREE_HASH;
  const parts = parentsResult.stdout.trim().split(/\s+/);
  return parts[1] || EMPTY_TREE_HASH;
}

async function gitCommitFiles(rootPath, hash) {
  const repo = await resolveRepoRoot(rootPath);
  if (!repo.success) return { success: false, files: [], error: repo.error };
  const base = await getCommitBase(repo.repoRoot, hash);
  const result = await runGit(repo.repoRoot, ['diff', '--name-status', '-z', base, hash, '--']);
  if (!result.success) return { success: false, files: [], error: result.error };
  const records = result.stdout.split('\0').filter(Boolean);
  const files = [];
  for (let index = 0; index < records.length;) {
    const status = records[index++] || '';
    if (!status) continue;
    if (status.startsWith('R') || status.startsWith('C')) {
      const previousPath = records[index++] || '';
      const itemPath = records[index++] || previousPath;
      files.push({ path: itemPath, previousPath, status: status[0] });
      continue;
    }
    const itemPath = records[index++] || '';
    if (itemPath) files.push({ path: itemPath, status: status[0] });
  }
  return { success: true, files };
}

async function gitCommitFileDiff(rootPath, hash, filePath, previousPath) {
  const repo = await resolveRepoRoot(rootPath);
  if (!repo.success) return { success: false, filePath, original: '', modified: '', originalLabel: '', modifiedLabel: '', error: repo.error };
  const gitPath = toGitPath(repo.repoRoot, filePath);
  const oldGitPath = previousPath ? toGitPath(repo.repoRoot, previousPath) : gitPath;
  const base = await getCommitBase(repo.repoRoot, hash);
  const shortBase = base === EMPTY_TREE_HASH ? '空文件' : base.slice(0, 7);
  const original = base === EMPTY_TREE_HASH ? createTextReadResult('') : await readGitObjectText(repo.repoRoot, base, oldGitPath);
  const modified = await readGitObjectText(repo.repoRoot, hash, gitPath);
  return buildGitDiffResult(gitPath, original, modified, shortBase, hash.slice(0, 7));
}

async function gitBranches(rootPath) {
  const repo = await resolveRepoRoot(rootPath);
  if (!repo.success) return { success: false, current: '', branches: [], operationState: { mergeInProgress: false, rebaseInProgress: false }, error: repo.error };
  const currentResult = await runGit(repo.repoRoot, ['branch', '--show-current']);
  const fallbackBranch = await runGit(repo.repoRoot, ['rev-parse', '--short', 'HEAD']);
  const current = currentResult.stdout.trim() || fallbackBranch.stdout.trim() || 'HEAD';
  const fieldSep = String.fromCharCode(31);
  const recordSep = String.fromCharCode(30);
  const result = await runGit(repo.repoRoot, ['for-each-ref', '--format=%(refname)' + fieldSep + '%(refname:short)' + fieldSep + '%(upstream:short)' + fieldSep + '%(HEAD)' + fieldSep + '%(objectname:short)' + recordSep, 'refs/heads', 'refs/remotes']);
  if (!result.success) return { success: false, current, branches: [], operationState: await getGitOperationState(repo.repoRoot), error: result.error };
  const branches = result.stdout.split(recordSep).map(record => record.trim()).filter(Boolean).map(record => {
    const fields = record.split(fieldSep);
    const fullName = fields[0] || '';
    const name = fields[1] || '';
    if (!fullName || !name) return null;
    const type = fullName.startsWith('refs/remotes/') ? 'remote' : 'local';
    if (type === 'remote' && name.endsWith('/HEAD')) return null;
    return { name, fullName, type, current: (fields[3] || '').trim() === '*', upstream: fields[2] || undefined, remote: type === 'remote' ? name.split('/')[0] : undefined, hash: fields[4] || undefined };
  }).filter(Boolean).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'local' ? -1 : 1;
    if (a.current !== b.current) return a.current ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { success: true, current, branches, operationState: await getGitOperationState(repo.repoRoot) };
}

function localNameFromRemote(remoteBranch) {
  const parts = String(remoteBranch || '').split('/');
  return parts.slice(1).join('/') || remoteBranch;
}

async function listGitStashes(rootPath) {
  const repo = await resolveRepoRoot(rootPath);
  if (!repo.success) return { success: false, stashes: [], error: repo.error };
  const fieldSep = String.fromCharCode(31);
  const recordSep = String.fromCharCode(30);
  const result = await runGit(repo.repoRoot, ['stash', 'list', '--format=%gd' + fieldSep + '%H' + fieldSep + '%gs' + recordSep]);
  if (!result.success) return { success: false, stashes: [], error: result.error };
  const stashes = result.stdout.split(recordSep).map(record => record.trim()).filter(Boolean).map(record => {
    const fields = record.split(fieldSep);
    const ref = fields[0] || '';
    const index = Number((ref.match(/stash@\{(\d+)\}/) || [])[1] || -1);
    if (!ref || index < 0) return null;
    return { ref, index, hash: fields[1] || '', message: fields[2] || '' };
  }).filter(Boolean);
  return { success: true, stashes };
}

async function gitOperation(rootPath, kind, params) {
  const repo = await resolveRepoRoot(rootPath);
  if (!repo.success) return { success: false, error: repo.error };
  if (kind === 'switchBranch') {
    const name = String(params.branchName || '').trim();
    if (!name) return { success: false, error: '分支名不能为空。' };
    let args;
    if (params.branchType === 'remote') {
      const localName = localNameFromRemote(name);
      const localExists = await runGit(repo.repoRoot, ['show-ref', '--verify', '--quiet', 'refs/heads/' + localName]);
      args = localExists.success ? ['switch', localName] : ['switch', '--track', '-c', localName, name];
    } else {
      args = ['switch', name];
    }
    return runGitOperation(repo.repoRoot, args, { requireClean: true, autoStash: asBool(params.autoStash), stashMessage: 'RilleCode auto stash before switching to ' + name });
  }
  if (kind === 'createBranch') {
    const name = String(params.branchName || '').trim();
    const validation = await runGit(repo.repoRoot, ['check-ref-format', '--branch', name]);
    if (!name || !validation.success) return { success: false, error: validation.error || '分支名无效。' };
    const args = params.checkout === false ? ['branch', name] : ['switch', '-c', name];
    if (params.startPoint) args.push(params.startPoint);
    return runGitOperation(repo.repoRoot, args);
  }
  if (kind === 'deleteBranch') {
    const name = String(params.branchName || '').trim();
    const current = (await runGit(repo.repoRoot, ['branch', '--show-current'])).stdout.trim();
    if (!name) return { success: false, error: '分支名不能为空。' };
    if (name === current) return { success: false, error: '不能删除当前分支。' };
    return runGitOperation(repo.repoRoot, ['branch', '-d', name]);
  }
  if (kind === 'fetch') return runGitOperation(repo.repoRoot, ['fetch', '--all', '--prune']);
  if (kind === 'pull') return runGitOperation(repo.repoRoot, ['pull', '--ff-only'], { requireClean: true, autoStash: asBool(params.autoStash), stashMessage: 'RilleCode auto stash before pull' });
  if (kind === 'push') {
    const current = (await runGit(repo.repoRoot, ['branch', '--show-current'])).stdout.trim();
    if (!current) return { success: false, error: '当前处于 detached HEAD，无法直接 push。' };
    const upstream = await runGit(repo.repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    return runGitOperation(repo.repoRoot, upstream.success ? ['push'] : ['push', '-u', 'origin', current]);
  }
  if (kind === 'merge') return runGitOperation(repo.repoRoot, ['merge', String(params.branchName || '').trim()], { requireClean: true, autoStash: asBool(params.autoStash), stashMessage: 'RilleCode auto stash before merging ' + String(params.branchName || '').trim() });
  if (kind === 'rebase') return runGitOperation(repo.repoRoot, ['rebase', String(params.branchName || '').trim()], { requireClean: true, autoStash: asBool(params.autoStash), stashMessage: 'RilleCode auto stash before rebasing onto ' + String(params.branchName || '').trim() });
  if (kind === 'abortMerge') return runGitOperation(repo.repoRoot, ['merge', '--abort']);
  if (kind === 'abortRebase') return runGitOperation(repo.repoRoot, ['rebase', '--abort']);
  if (kind === 'stashPush') return runGitOperation(repo.repoRoot, ['stash', 'push', '-u', '-m', String(params.message || '').trim() || 'RilleCode stash']);
  if (kind === 'stashApply') return runGitOperation(repo.repoRoot, ['stash', 'apply', String(params.stashRef || '')]);
  if (kind === 'stashPop') return runGitOperation(repo.repoRoot, ['stash', 'pop', String(params.stashRef || '')]);
  if (kind === 'stashDrop') return runGitOperation(repo.repoRoot, ['stash', 'drop', String(params.stashRef || '')]);
  throw new Error('Unknown git operation: ' + kind);
}

async function dispatch(message) {
  const id = message && message.id;
  const method = message && message.method;
  const params = message && message.params ? message.params : {};
  let result;
  if (method === 'ping') result = { home: os.homedir(), platform: process.platform };
  else if (method === 'fs.readDirectory') result = await readDirectory(params.path);
  else if (method === 'fs.readFile') result = await fs.readFile(params.path, 'utf8');
  else if (method === 'fs.writeFile') { await fs.writeFile(params.path, params.content || '', 'utf8'); result = true; }
  else if (method === 'fs.stat') { try { const s = await fs.stat(params.path); result = { exists: true, isDirectory: s.isDirectory(), size: s.size, modifiedTime: s.mtimeMs }; } catch { result = { exists: false, isDirectory: false }; } }
  else if (method === 'search.files') result = await searchFiles(params.rootPath, params.query || '', params.options || { caseSensitive: false, includeDependencies: false });
  else if (method === 'git.status') result = await gitStatus(params.rootPath);
  else if (method === 'git.stage') { const repo = await resolveRepoRoot(params.rootPath); if (!repo.success) result = { success: false, error: repo.error }; else { const r = await runGit(repo.repoRoot, ['add', '--', toGitPath(repo.repoRoot, params.filePath)]); result = { success: r.success, error: r.error }; } }
  else if (method === 'git.unstage') { const repo = await resolveRepoRoot(params.rootPath); if (!repo.success) result = { success: false, error: repo.error }; else { const r = await runGit(repo.repoRoot, ['restore', '--staged', '--', toGitPath(repo.repoRoot, params.filePath)]); result = { success: r.success, error: r.error }; } }
  else if (method === 'git.commit') { const repo = await resolveRepoRoot(params.rootPath); if (!repo.success) result = { success: false, error: repo.error }; else { const r = await runGit(repo.repoRoot, ['commit', '-m', params.message || '']); result = { success: r.success, error: r.error }; } }
  else if (method === 'git.fileDiff') result = await gitFileDiff(params.rootPath, params.filePath, params.kind);
  else if (method === 'git.log') result = await gitLog(params.rootPath, params.limit, params.skip);
  else if (method === 'git.commitFiles') result = await gitCommitFiles(params.rootPath, params.hash);
  else if (method === 'git.commitFileDiff') result = await gitCommitFileDiff(params.rootPath, params.hash, params.filePath, params.previousPath);
  else if (method === 'git.checkoutCommit') { const repo = await resolveRepoRoot(params.rootPath); if (!repo.success) result = { success: false, error: repo.error }; else { const r = await runGit(repo.repoRoot, ['checkout', '--detach', params.hash]); result = { success: r.success, error: r.error }; } }
  else if (method === 'git.createBranchFromCommit') { const repo = await resolveRepoRoot(params.rootPath); if (!repo.success) result = { success: false, error: repo.error }; else { const name = String(params.branchName || '').trim(); const validation = await runGit(repo.repoRoot, ['check-ref-format', '--branch', name]); if (!name || !validation.success) result = { success: false, error: validation.error || '分支名无效。' }; else { const r = await runGit(repo.repoRoot, ['checkout', '-b', name, params.hash]); result = { success: r.success, error: r.error }; } } }
  else if (method === 'git.resetToCommit') { const repo = await resolveRepoRoot(params.rootPath); if (!repo.success) result = { success: false, error: repo.error }; else { const mode = params.mode === 'soft' || params.mode === 'mixed' || params.mode === 'hard' ? params.mode : 'mixed'; const r = await runGit(repo.repoRoot, ['reset', '--' + mode, params.hash]); result = { success: r.success, error: r.error }; } }
  else if (method === 'git.branches') result = await gitBranches(params.rootPath);
  else if (method === 'git.stashList') result = await listGitStashes(params.rootPath);
  else if (method === 'git.resolveCommitAvatars') result = { success: true, avatars: {} };
  else if (method && method.startsWith('git.operation.')) result = await gitOperation(params.rootPath, method.slice('git.operation.'.length), params);
  else throw new Error('Unknown method: ' + method);
  sendResult(id, result);
}
`;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'RilleCode',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f8f8f8',
      symbolColor: '#343842',
      height: 34,
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.setMenuBarVisibility(false)

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function readDirectory(dirPath: string): Promise<FileEntry[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    const result: FileEntry[] = []

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue
      }

      result.push({
        name: entry.name,
        path: join(dirPath, entry.name),
        isDirectory: entry.isDirectory(),
      })
    }

    return result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  } catch {
    return []
  }
}

async function searchFiles(rootPath: string, query: string, options: SearchOptions): Promise<SearchResult[]> {
  const needle = options.caseSensitive ? query : query.toLowerCase()
  const results: SearchResult[] = []

  if (!needle.trim()) {
    return results
  }

  async function walk(dirPath: string): Promise<void> {
    if (results.length >= MAX_SEARCH_RESULTS) return

    let entries
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (results.length >= MAX_SEARCH_RESULTS) return
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      if (!options.includeDependencies && (entry.name === 'node_modules' || entry.name === 'out')) continue

      const fullPath = join(dirPath, entry.name)

      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }

      let fileStat
      try {
        fileStat = await stat(fullPath)
      } catch {
        continue
      }

      if (fileStat.size > MAX_SEARCH_FILE_SIZE) continue

      let content
      try {
        content = await readFile(fullPath, 'utf-8')
      } catch {
        continue
      }

      const lines = content.split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        const lineText = lines[index]
        const haystack = options.caseSensitive ? lineText : lineText.toLowerCase()
        const column = haystack.indexOf(needle)
        if (column === -1) continue

        results.push({
          filePath: fullPath,
          line: index + 1,
          column: column + 1,
          preview: lineText.trim().slice(0, 240),
        })

        if (results.length >= MAX_SEARCH_RESULTS) return
      }
    }
  }

  await walk(rootPath)
  return results
}

function runGit(cwd: string, args: string[]): Promise<GitCommandResult & { stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: GIT_TIMEOUT_MS }, (error, stdout, stderr) => {
      const stderrText = stderr.toString()
      resolve({
        success: !error,
        stdout: stdout.toString(),
        stderr: stderrText,
        error: error ? stderrText || error.message : undefined,
      })
    })
  })
}

function toGitPath(repoRoot: string, filePath: string): string {
  const relPath = filePath.startsWith(repoRoot) ? relative(repoRoot, filePath) : filePath
  return relPath.replace(/\\/g, '/')
}


function toAbsoluteGitPath(repoRoot: string, gitPath: string): string {
  if (!gitPath) return join(repoRoot, '.git')
  if (gitPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(gitPath)) return gitPath
  return join(repoRoot, gitPath)
}

async function getGitOperationState(repoRoot: string): Promise<GitOperationState> {
  const gitDirResult = await runGit(repoRoot, ['rev-parse', '--git-dir'])
  const gitDir = toAbsoluteGitPath(repoRoot, gitDirResult.stdout.trim() || '.git')
  return {
    mergeInProgress: existsSync(join(gitDir, 'MERGE_HEAD')),
    rebaseInProgress: existsSync(join(gitDir, 'rebase-merge')) || existsSync(join(gitDir, 'rebase-apply')),
  }
}

async function isWorktreeDirty(repoRoot: string): Promise<boolean> {
  const statusResult = await runGit(repoRoot, ['status', '--porcelain=v1', '-z'])
  return statusResult.success && statusResult.stdout.length > 0
}

function commandOutput(result: { stdout: string; stderr: string }): string {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')
}


function sendToRenderers(channel: string, payload: unknown, sender?: WebContents): void {
  const targets = new Set<WebContents>()
  if (sender && !sender.isDestroyed()) targets.add(sender)
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) targets.add(window.webContents)
  }
  for (const target of targets) target.send(channel, payload)
}

function pushOutput(channel: OutputChannel, level: OutputLevel, message: string, details?: string, sender?: WebContents): OutputEntry {
  const entry: OutputEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    channel,
    level,
    message,
    details,
  }
  outputEntries.push(entry)
  if (outputEntries.length > 1000) outputEntries.splice(0, outputEntries.length - 1000)
  sendToRenderers('output:entry', entry, sender)
  return entry
}

async function runGitOperation(
  repoRoot: string,
  args: string[],
  options?: { requireClean?: boolean; autoStash?: boolean; stashMessage?: string },
): Promise<GitOperationResult> {
  const dirty = await isWorktreeDirty(repoRoot)
  let didAutoStash = false

  if (dirty && options?.requireClean && !options.autoStash) {
    return {
      success: false,
      error: '工作区存在未提交更改。请提交、手动 stash，或确认自动 stash 后再执行。',
      operationState: await getGitOperationState(repoRoot),
    }
  }

  if (dirty && options?.autoStash) {
    const stashResult = await runGit(repoRoot, ['stash', 'push', '-u', '-m', options.stashMessage || 'RilleCode auto stash'])
    if (!stashResult.success) {
      return {
        success: false,
        error: stashResult.error || '自动 stash 失败。',
        output: commandOutput(stashResult),
        operationState: await getGitOperationState(repoRoot),
      }
    }
    didAutoStash = true
  }

  const result = await runGit(repoRoot, args)
  let operationState = await getGitOperationState(repoRoot)
  const output = commandOutput(result)

  if (!result.success) {
    pushOutput('Git', 'error', `git ${args.join(' ')} failed`, result.error || output)
    return {
      success: false,
      error: result.error || output || 'Git 操作失败。',
      output,
      didAutoStash,
      needsResolution: operationState.mergeInProgress || operationState.rebaseInProgress,
      operationState,
    }
  }

  if (didAutoStash) {
    const popResult = await runGit(repoRoot, ['stash', 'pop'])
    operationState = await getGitOperationState(repoRoot)
    if (!popResult.success) {
      return {
        success: false,
        error: 'Git 操作已完成，但自动恢复 stash 失败。请查看工作区并手动处理 stash。',
        output,
        didAutoStash,
        stashPopError: popResult.error || commandOutput(popResult) || 'stash pop failed',
        needsResolution: true,
        operationState,
      }
    }
  }

  pushOutput('Git', 'info', `git ${args.join(' ')} completed`, output || undefined)
  return { success: true, output, didAutoStash, operationState }
}

function parseGitHubRemote(remoteUrl: string): { owner: string; repo: string } | null {
  const cleaned = remoteUrl.trim().replace(/\.git$/, '')
  const match = cleaned.match(/github\.com[:/]([^/\s:]+)\/([^/\s]+)$/)
    || cleaned.match(/^git@github[^:]*:([^/\s:]+)\/([^/\s]+)$/)
    || cleaned.match(/^ssh:\/\/git@github[^/]*\/([^/\s:]+)\/([^/\s]+)$/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

async function getGitHubRepo(repoRoot: string): Promise<{ owner: string; repo: string } | null> {
  const remotes = await runGit(repoRoot, ['remote', '-v'])
  if (!remotes.success) return null
  for (const line of remotes.stdout.split(/\r?\n/)) {
    if (!line.includes('(fetch)')) continue
    const parts = line.trim().split(/\s+/)
    const parsed = parts[1] ? parseGitHubRemote(parts[1]) : null
    if (parsed) return parsed
  }
  return null
}

function fetchJson<T>(url: string): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: T | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const req = request(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'RilleCode',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, (res) => {
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        finish(null)
        return
      }

      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try {
          finish(JSON.parse(body) as T)
        } catch {
          finish(null)
        }
      })
    })

    req.on('error', () => finish(null))
    req.setTimeout(5000, () => {
      req.destroy()
      finish(null)
    })
    req.end()
  })
}

async function resolveRepoRoot(rootPath: string): Promise<GitCommandResult & { repoRoot: string }> {
  const gitVersion = await runGit(rootPath, ['--version'])
  if (!gitVersion.success) {
    return { success: false, repoRoot: '', error: `Git is not available: ${gitVersion.error || 'unknown error'}` }
  }

  const insideRepo = await runGit(rootPath, ['rev-parse', '--is-inside-work-tree'])
  if (!insideRepo.success || insideRepo.stdout.trim() !== 'true') {
    return { success: false, repoRoot: '', error: insideRepo.error || '当前文件夹不是 Git 仓库。' }
  }

  const rootResult = await runGit(rootPath, ['rev-parse', '--show-toplevel'])
  if (!rootResult.success) {
    return { success: false, repoRoot: '', error: rootResult.error || '无法解析 Git 仓库根目录。' }
  }

  return { success: true, repoRoot: rootResult.stdout.trim() }
}

async function getGitStatus(rootPath: string): Promise<GitStatusResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) {
    return { isRepo: false, repoRoot: '', branch: '', staged: [], unstaged: [], untracked: [], error: repo.error }
  }

  const branchResult = await runGit(repo.repoRoot, ['branch', '--show-current'])
  const fallbackBranch = await runGit(repo.repoRoot, ['rev-parse', '--short', 'HEAD'])
  const statusResult = await runGit(repo.repoRoot, ['status', '--porcelain=v1', '-z'])

  const staged = new Set<string>()
  const unstaged = new Set<string>()
  const untracked = new Set<string>()

  if (statusResult.success) {
    const entries = statusResult.stdout.split('\0').filter(Boolean)
    for (let index = 0; index < entries.length; index += 1) {
      const item = entries[index]
      if (item.length < 4) continue
      const x = item[0]
      const y = item[1]
      const filePath = item.slice(3)

      if ((x === 'R' || x === 'C') && entries[index + 1]) {
        index += 1
      }

      if (x === '?' && y === '?') {
        untracked.add(filePath)
        continue
      }

      if (x !== ' ' && x !== '?') staged.add(filePath)
      if (y !== ' ' && y !== '?') unstaged.add(filePath)
    }
  }

  return {
    isRepo: true,
    repoRoot: repo.repoRoot,
    branch: branchResult.stdout.trim() || fallbackBranch.stdout.trim() || 'HEAD',
    staged: [...staged].sort(),
    unstaged: [...unstaged].sort(),
    untracked: [...untracked].sort(),
    operationState: await getGitOperationState(repo.repoRoot),
    error: statusResult.success ? undefined : statusResult.error,
  }
}

function hasBinaryMarker(content: string): boolean {
  return content.includes('\0')
}

function normalizeGitLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return 50
  return Math.max(1, Math.min(200, Math.floor(limit ?? 50)))
}

function createTextReadResult(content = ''): { success: boolean; content: string; isBinary?: boolean; error?: string } {
  return { success: true, content, isBinary: hasBinaryMarker(content) }
}

async function readGitObjectText(
  repoRoot: string,
  revision: string,
  filePath: string,
): Promise<{ success: boolean; content: string; isBinary?: boolean; error?: string }> {
  const spec = revision === ':' ? `:${filePath}` : `${revision}:${filePath}`
  const result = await runGit(repoRoot, ['show', spec])
  if (!result.success) {
    return createTextReadResult('')
  }
  return createTextReadResult(result.stdout)
}

async function readWorktreeText(
  repoRoot: string,
  filePath: string,
): Promise<{ success: boolean; content: string; isBinary?: boolean; error?: string }> {
  const absolutePath = join(repoRoot, filePath)
  if (!existsSync(absolutePath)) {
    return createTextReadResult('')
  }

  try {
    const content = await readFile(absolutePath, 'utf-8')
    return createTextReadResult(content)
  } catch (error) {
    return {
      success: false,
      content: '',
      error: error instanceof Error ? error.message : '无法读取文件内容。',
    }
  }
}

function buildGitDiffResult(
  filePath: string,
  original: { success: boolean; content: string; isBinary?: boolean; error?: string },
  modified: { success: boolean; content: string; isBinary?: boolean; error?: string },
  originalLabel: string,
  modifiedLabel: string,
): GitDiffResult {
  if (!original.success || !modified.success) {
    return {
      success: false,
      filePath,
      original: '',
      modified: '',
      originalLabel,
      modifiedLabel,
      error: original.error || modified.error || '无法读取 diff 内容。',
    }
  }

  if (original.isBinary || modified.isBinary) {
    return {
      success: true,
      filePath,
      original: '',
      modified: '',
      originalLabel,
      modifiedLabel,
      isBinary: true,
      error: '二进制文件无法在文本 diff 中预览。',
    }
  }

  return {
    success: true,
    filePath,
    original: original.content,
    modified: modified.content,
    originalLabel,
    modifiedLabel,
  }
}

async function getGitFileDiff(rootPath: string, filePath: string, kind: GitFileDiffKind): Promise<GitDiffResult> {
  const repo = await resolveRepoRoot(rootPath)
  const gitPath = repo.success ? toGitPath(repo.repoRoot, filePath) : filePath
  if (!repo.success) {
    return {
      success: false,
      filePath: gitPath,
      original: '',
      modified: '',
      originalLabel: '',
      modifiedLabel: '',
      error: repo.error,
    }
  }

  if (kind === 'staged') {
    const original = await readGitObjectText(repo.repoRoot, 'HEAD', gitPath)
    const modified = await readGitObjectText(repo.repoRoot, ':', gitPath)
    return buildGitDiffResult(gitPath, original, modified, 'HEAD', '已暂存')
  }

  if (kind === 'untracked') {
    const original = createTextReadResult('')
    const modified = await readWorktreeText(repo.repoRoot, gitPath)
    return buildGitDiffResult(gitPath, original, modified, '空文件', '工作区')
  }

  const original = await readGitObjectText(repo.repoRoot, ':', gitPath)
  const modified = await readWorktreeText(repo.repoRoot, gitPath)
  return buildGitDiffResult(gitPath, original, modified, '索引', '工作区')
}

async function getGitLog(rootPath: string, limit?: number, skip?: number): Promise<{ success: boolean; commits: GitCommitSummary[]; error?: string }> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, commits: [], error: repo.error }

  const recordSep = '\x1e'
  const fieldSep = '\x1f'
  const statsSep = '\x1d'
  const args: string[] = ['log']
  if (skip && skip > 0) args.push(`--skip=${skip}`)
  args.push(
    '--topo-order',
    '--shortstat',
    `-${normalizeGitLimit(limit)}`,
    '--date=iso-strict',
    '--pretty=format:%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s%x1f%P%x1f%b%x1d',
  )

  const result = await runGit(repo.repoRoot, args)

  if (!result.success) {
    return { success: false, commits: [], error: result.error }
  }

  const commits: GitCommitSummary[] = []
  const rawRecords = result.stdout.split(recordSep)

  for (const record of rawRecords) {
    if (!record.trim()) continue

    const [commitStr = '', statsStr = ''] = record.split(statsSep)
    const fields = commitStr.split(fieldSep)
    const hash = fields[0] || ''
    if (!hash) continue

    commits.push({
      hash,
      shortHash: fields[1] || '',
      author: fields[2] || '',
      email: fields[3] || '',
      date: fields[4] || '',
      subject: fields[5] || '',
      parents: (fields[6] || '').split(' ').filter(Boolean),
      body: fields.slice(7).join(fieldSep) || '',
      stats: statsStr.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim(),
    })
  }

  return { success: true, commits }
}

async function getCommitBase(repoRoot: string, hash: string): Promise<string> {
  const parentsResult = await runGit(repoRoot, ['rev-list', '--parents', '-n', '1', hash])
  if (!parentsResult.success) return EMPTY_TREE_HASH
  const [, firstParent] = parentsResult.stdout.trim().split(/\s+/)
  return firstParent || EMPTY_TREE_HASH
}

async function getGitCommitFiles(rootPath: string, hash: string): Promise<{ success: boolean; files: GitCommitFile[]; error?: string }> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, files: [], error: repo.error }

  const base = await getCommitBase(repo.repoRoot, hash)
  const result = await runGit(repo.repoRoot, ['diff', '--name-status', '-z', base, hash, '--'])
  if (!result.success) {
    return { success: false, files: [], error: result.error }
  }

  const records = result.stdout.split('\0').filter(Boolean)
  const files: GitCommitFile[] = []
  for (let index = 0; index < records.length;) {
    const status = records[index++] ?? ''
    if (!status) continue

    if (status.startsWith('R') || status.startsWith('C')) {
      const previousPath = records[index++] ?? ''
      const path = records[index++] ?? previousPath
      files.push({ path, previousPath, status: status[0] })
      continue
    }

    const path = records[index++] ?? ''
    if (path) files.push({ path, status: status[0] })
  }

  return { success: true, files }
}

async function getGitCommitFileDiff(
  rootPath: string,
  hash: string,
  filePath: string,
  previousPath?: string,
): Promise<GitDiffResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) {
    return {
      success: false,
      filePath,
      original: '',
      modified: '',
      originalLabel: '',
      modifiedLabel: '',
      error: repo.error,
    }
  }

  const gitPath = toGitPath(repo.repoRoot, filePath)
  const oldGitPath = previousPath ? toGitPath(repo.repoRoot, previousPath) : gitPath
  const base = await getCommitBase(repo.repoRoot, hash)
  const shortBase = base === EMPTY_TREE_HASH ? '空文件' : base.slice(0, 7)
  const original = base === EMPTY_TREE_HASH
    ? createTextReadResult('')
    : await readGitObjectText(repo.repoRoot, base, oldGitPath)
  const modified = await readGitObjectText(repo.repoRoot, hash, gitPath)

  return buildGitDiffResult(gitPath, original, modified, shortBase, hash.slice(0, 7))
}


async function getGitBranches(rootPath: string): Promise<GitBranchesResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) {
    return {
      success: false,
      current: '',
      branches: [],
      operationState: { mergeInProgress: false, rebaseInProgress: false },
      error: repo.error,
    }
  }

  const currentResult = await runGit(repo.repoRoot, ['branch', '--show-current'])
  const fallbackBranch = await runGit(repo.repoRoot, ['rev-parse', '--short', 'HEAD'])
  const current = currentResult.stdout.trim() || fallbackBranch.stdout.trim() || 'HEAD'
  const fieldSep = '\x1f'
  const recordSep = '\x1e'
  const result = await runGit(repo.repoRoot, [
    'for-each-ref',
    `--format=%(refname)${fieldSep}%(refname:short)${fieldSep}%(upstream:short)${fieldSep}%(HEAD)${fieldSep}%(objectname:short)${recordSep}`,
    'refs/heads',
    'refs/remotes',
  ])

  if (!result.success) {
    return { success: false, current, branches: [], operationState: await getGitOperationState(repo.repoRoot), error: result.error }
  }

  const branches = result.stdout
    .split(recordSep)
    .map(record => record.trim())
    .filter(Boolean)
    .map((record): GitBranch | null => {
      const [fullName = '', name = '', upstream = '', head = '', hash = ''] = record.split(fieldSep)
      if (!fullName || !name) return null
      const type: 'local' | 'remote' = fullName.startsWith('refs/remotes/') ? 'remote' : 'local'
      if (type === 'remote' && name.endsWith('/HEAD')) return null
      return {
        name,
        fullName,
        type,
        current: head.trim() === '*',
        upstream: upstream || undefined,
        remote: type === 'remote' ? name.split('/')[0] : undefined,
        hash: hash || undefined,
      }
    })
    .filter((branch): branch is GitBranch => Boolean(branch))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'local' ? -1 : 1
      if (a.current !== b.current) return a.current ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  return { success: true, current, branches, operationState: await getGitOperationState(repo.repoRoot) }
}

function localNameFromRemote(remoteBranch: string): string {
  return remoteBranch.split('/').slice(1).join('/') || remoteBranch
}

async function switchGitBranch(rootPath: string, branchName: string, branchType: 'local' | 'remote', autoStash?: boolean): Promise<GitOperationResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }

  const trimmedName = branchName.trim()
  if (!trimmedName) return { success: false, error: '分支名不能为空。' }

  let args: string[]
  if (branchType === 'remote') {
    const localName = localNameFromRemote(trimmedName)
    const localExists = await runGit(repo.repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${localName}`])
    args = localExists.success ? ['switch', localName] : ['switch', '--track', '-c', localName, trimmedName]
  } else {
    args = ['switch', trimmedName]
  }

  return runGitOperation(repo.repoRoot, args, {
    requireClean: true,
    autoStash,
    stashMessage: `RilleCode auto stash before switching to ${trimmedName}`,
  })
}

async function createGitBranch(rootPath: string, branchName: string, startPoint?: string, checkout = true): Promise<GitOperationResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }

  const normalizedBranchName = branchName.trim()
  const validation = await runGit(repo.repoRoot, ['check-ref-format', '--branch', normalizedBranchName])
  if (!normalizedBranchName || !validation.success) {
    return { success: false, error: validation.error || '分支名无效。' }
  }

  const args = checkout
    ? ['switch', '-c', normalizedBranchName, ...(startPoint ? [startPoint] : [])]
    : ['branch', normalizedBranchName, ...(startPoint ? [startPoint] : [])]
  return runGitOperation(repo.repoRoot, args)
}

async function deleteGitBranch(rootPath: string, branchName: string): Promise<GitOperationResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }

  const normalizedBranchName = branchName.trim()
  const current = (await runGit(repo.repoRoot, ['branch', '--show-current'])).stdout.trim()
  if (!normalizedBranchName) return { success: false, error: '分支名不能为空。' }
  if (normalizedBranchName === current) return { success: false, error: '不能删除当前分支。' }

  return runGitOperation(repo.repoRoot, ['branch', '-d', normalizedBranchName])
}

async function fetchGit(rootPath: string): Promise<GitOperationResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  return runGitOperation(repo.repoRoot, ['fetch', '--all', '--prune'])
}

async function pullGit(rootPath: string, autoStash?: boolean): Promise<GitOperationResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  return runGitOperation(repo.repoRoot, ['pull', '--ff-only'], {
    requireClean: true,
    autoStash,
    stashMessage: 'RilleCode auto stash before pull',
  })
}

async function pushGit(rootPath: string): Promise<GitOperationResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }

  const current = (await runGit(repo.repoRoot, ['branch', '--show-current'])).stdout.trim()
  if (!current) return { success: false, error: '当前处于 detached HEAD，无法直接 push。' }

  const upstream = await runGit(repo.repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  const args = upstream.success ? ['push'] : ['push', '-u', 'origin', current]
  return runGitOperation(repo.repoRoot, args)
}

async function mergeGitBranch(rootPath: string, branchName: string, autoStash?: boolean): Promise<GitOperationResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  const target = branchName.trim()
  if (!target) return { success: false, error: '请选择要合并的分支。' }
  return runGitOperation(repo.repoRoot, ['merge', target], {
    requireClean: true,
    autoStash,
    stashMessage: `RilleCode auto stash before merging ${target}`,
  })
}

async function rebaseGitBranch(rootPath: string, branchName: string, autoStash?: boolean): Promise<GitOperationResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  const target = branchName.trim()
  if (!target) return { success: false, error: '请选择 rebase 目标分支。' }
  return runGitOperation(repo.repoRoot, ['rebase', target], {
    requireClean: true,
    autoStash,
    stashMessage: `RilleCode auto stash before rebasing onto ${target}`,
  })
}

async function abortMerge(rootPath: string): Promise<GitOperationResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  return runGitOperation(repo.repoRoot, ['merge', '--abort'])
}

async function abortRebase(rootPath: string): Promise<GitOperationResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  return runGitOperation(repo.repoRoot, ['rebase', '--abort'])
}

async function listGitStashes(rootPath: string): Promise<GitStashListResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, stashes: [], error: repo.error }

  const fieldSep = '\x1f'
  const recordSep = '\x1e'
  const result = await runGit(repo.repoRoot, ['stash', 'list', `--format=%gd${fieldSep}%H${fieldSep}%gs${recordSep}`])
  if (!result.success) return { success: false, stashes: [], error: result.error }

  const stashes = result.stdout
    .split(recordSep)
    .map(record => record.trim())
    .filter(Boolean)
    .map((record): GitStashEntry | null => {
      const [ref = '', hash = '', message = ''] = record.split(fieldSep)
      const index = Number(ref.match(/stash@\{(\d+)\}/)?.[1] ?? -1)
      if (!ref || index < 0) return null
      return { ref, index, hash, message }
    })
    .filter((stash): stash is GitStashEntry => Boolean(stash))

  return { success: true, stashes }
}

async function stashPush(rootPath: string, message?: string): Promise<GitOperationResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  return runGitOperation(repo.repoRoot, ['stash', 'push', '-u', '-m', message?.trim() || 'RilleCode stash'])
}

async function stashApply(rootPath: string, stashRef: string): Promise<GitOperationResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  return runGitOperation(repo.repoRoot, ['stash', 'apply', stashRef])
}

async function stashPop(rootPath: string, stashRef: string): Promise<GitOperationResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  return runGitOperation(repo.repoRoot, ['stash', 'pop', stashRef])
}

async function stashDrop(rootPath: string, stashRef: string): Promise<GitOperationResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  return runGitOperation(repo.repoRoot, ['stash', 'drop', stashRef])
}

async function resolveCommitAvatars(rootPath: string, hashes: string[]): Promise<GitAvatarResult> {
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, avatars: {}, error: repo.error }

  const githubRepo = await getGitHubRepo(repo.repoRoot)
  if (!githubRepo) return { success: true, avatars: {} }

  const avatars: Record<string, GitAvatarInfo> = {}
  const uniqueHashes = [...new Set(hashes.map(hash => hash.trim()).filter(Boolean))].slice(0, 80)

  for (const hash of uniqueHashes) {
    const url = `https://api.github.com/repos/${githubRepo.owner}/${githubRepo.repo}/commits/${hash}`
    const data = await fetchJson<GitHubCommitResponse>(url)
    const account = data?.author || data?.committer || null
    if (account?.avatar_url) {
      avatars[hash] = {
        avatarUrl: account.avatar_url,
        avatarSource: 'github',
        githubLogin: account.login,
      }
    }
  }

  return { success: true, avatars }
}

function execFileText(command: string, args: string[], cwd?: string, timeout = 10_000): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, timeout, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      const stdoutText = stdout.toString()
      const stderrText = stderr.toString()
      resolve({
        success: !error,
        stdout: stdoutText,
        stderr: stderrText,
        error: error ? stderrText || error.message : undefined,
      })
    })
  })
}

function pathCandidates(command: string): string[] {
  const paths = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean)
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : ['']
  const result: string[] = []
  for (const dir of paths) {
    if (process.platform === 'win32' && /\.[a-z0-9]+$/i.test(command)) {
      result.push(join(dir, command))
    } else {
      for (const ext of extensions) result.push(join(dir, command + ext.toLowerCase()))
      for (const ext of extensions) result.push(join(dir, command + ext.toUpperCase()))
    }
  }
  return result
}

function findExecutable(command: string, extraPaths: string[] = []): string | null {
  if (command.includes('/') || command.includes('\\')) return existsSync(command) ? command : null
  for (const candidate of [...extraPaths, ...pathCandidates(command)]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function decodeCommandOutput(buffer: Buffer): string {
  return buffer.toString('utf8').replace(/\u0000/g, '')
}

function isWslAvailable(wslPath: string): boolean {
  if (process.platform !== 'win32') return false
  try {
    execFileSync(wslPath, ['--status'], { timeout: 3_000, stdio: ['ignore', 'pipe', 'ignore'] })
    return true
  } catch {
    return false
  }
}

function getWslDistroNames(wslPath: string): string[] {
  try {
    const output = decodeCommandOutput(execFileSync(wslPath, ['-l', '-q'], { timeout: 3_000, stdio: ['ignore', 'pipe', 'ignore'] }))
    return output
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !/^Windows Subsystem for Linux/i.test(line))
  } catch {
    return []
  }
}

function getWindowsSystem32Path(subPath: string): string | null {
  if (process.platform !== 'win32') return null
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const systemDir = Object.prototype.hasOwnProperty.call(process.env, 'PROCESSOR_ARCHITEW6432') ? 'Sysnative' : 'System32'
  return join(systemRoot, systemDir, subPath)
}

function stripSshComment(value: string): string {
  const index = value.indexOf(' #')
  return index === -1 ? value.trim() : value.slice(0, index).trim()
}

function parseSshConfigHosts(): string[] {
  const configPaths = [join(homedir(), '.ssh', 'config')]
  const hosts = new Set<string>()

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) continue
    try {
      const content = readFileSync(configPath, 'utf8')
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const match = trimmed.match(/^Host\s+(.+)$/i)
        if (!match) continue
        const hostValue = stripSshComment(match[1])
        for (const host of hostValue.split(/\s+/)) {
          if (!host || host.includes('*') || host.includes('?') || host.startsWith('!')) continue
          hosts.add(host)
        }
      }
    } catch {
      // Ignore unreadable SSH config files; generic SSH remains available.
    }
  }

  return [...hosts].sort((a, b) => a.localeCompare(b))
}

function getSshTargetsPath(): string {
  return join(app.getPath('userData'), 'remote', 'ssh-targets.json')
}

function normalizeSshAuthMethod(value: unknown): SshAuthMethod {
  return value === 'password' || value === 'identityFile' || value === 'identityFileWithPassphrase'
    ? value
    : 'sshConfigOrAgent'
}

function normalizeSshTargetConfig(raw: unknown): SshTargetConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const hostName = String(value.hostName || '').trim()
  const alias = String(value.alias || hostName || '').trim()
  if (!hostName || !alias) return null
  const port = Number(value.port)
  const config: SshTargetConfig = {
    id: String(value.id || randomUUID()),
    alias,
    hostName,
    authMethod: normalizeSshAuthMethod(value.authMethod),
  }
  const user = String(value.user || '').trim()
  const identityFile = String(value.identityFile || '').trim()
  const proxyJump = String(value.proxyJump || '').trim()
  const extraOptions = String(value.extraOptions || '').trim()
  const defaultRemotePath = String(value.defaultRemotePath || '').trim()
  if (Number.isFinite(port) && port > 0) config.port = Math.floor(port)
  if (user) config.user = user
  if (identityFile) config.identityFile = identityFile
  if (proxyJump) config.proxyJump = proxyJump
  if (extraOptions) config.extraOptions = extraOptions
  if (defaultRemotePath) config.defaultRemotePath = defaultRemotePath
  return config
}

function listSshTargetConfigs(): SshTargetConfig[] {
  const filePath = getSshTargetsPath()
  if (!existsSync(filePath)) return []
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    const rows = Array.isArray(parsed) ? parsed : []
    return rows.map(normalizeSshTargetConfig).filter((item): item is SshTargetConfig => Boolean(item))
  } catch {
    return []
  }
}

function writeSshTargetConfigs(configs: SshTargetConfig[]): void {
  const filePath = getSshTargetsPath()
  mkdirSync(join(app.getPath('userData'), 'remote'), { recursive: true })
  writeFileSync(filePath, JSON.stringify(configs, null, 2), 'utf8')
}

function saveSshTargetConfig(input: Partial<SshTargetConfig>): SshTargetConfig {
  const normalized = normalizeSshTargetConfig({ ...input, id: input.id || randomUUID() })
  if (!normalized) throw new Error('SSH 配置缺少 Host Alias 或 HostName/IP。')
  const configs = listSshTargetConfigs()
  const index = configs.findIndex(item => item.id === normalized.id)
  if (index === -1) configs.push(normalized)
  else configs[index] = normalized
  configs.sort((a, b) => a.alias.localeCompare(b.alias))
  writeSshTargetConfigs(configs)
  return normalized
}

function deleteSshTargetConfig(id: string): boolean {
  const configs = listSshTargetConfigs()
  const next = configs.filter(item => item.id !== id)
  writeSshTargetConfigs(next)
  return next.length !== configs.length
}

function getRemoteTargets(): RemoteTarget[] {
  const profiles = getTerminalProfiles()
  const targets: RemoteTarget[] = []
  const sshProfile = profiles.find(profile => profile.kind === 'ssh' && profile.id === 'ssh')
  if (sshProfile) {
    targets.push({
      id: 'ssh:connect',
      kind: 'ssh',
      label: 'Connect to Host...',
      profileId: sshProfile.id,
      source: 'detected',
    })
    for (const config of listSshTargetConfigs()) {
      targets.push({
        id: `ssh-configured:${config.id}`,
        kind: 'ssh',
        label: config.alias,
        profileId: sshProfile.id,
        host: config.hostName,
        source: 'configured',
        sshConfigId: config.id,
        sshConfig: config,
        defaultRemotePath: config.defaultRemotePath,
      })
    }
    for (const host of parseSshConfigHosts()) {
      targets.push({
        id: `ssh:${host}`,
        kind: 'ssh',
        label: host,
        profileId: `ssh:${host}`,
        host,
        source: 'ssh-config',
      })
    }
  }

  for (const profile of profiles) {
    if (profile.kind !== 'wsl' || !profile.id.startsWith('wsl:')) continue
    const distro = profile.id.slice('wsl:'.length)
    targets.push({
      id: profile.id,
      kind: 'wsl',
      label: distro || profile.label,
      profileId: profile.id,
      distro: distro || undefined,
      source: 'wsl',
    })
  }

  return targets
}

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

function splitSshExtraOptions(value?: string): string[] {
  if (!value) return []
  const result: string[] = []
  let current = ''
  let quote: 'single' | 'double' | null = null
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single'
      continue
    }
    if (char === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double'
      continue
    }
    if (/\s/.test(char) && !quote) {
      if (current) result.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) result.push(current)
  return result
}

function getSshExecutable(): string {
  const sshCommand = process.platform === 'win32' ? 'ssh.exe' : 'ssh'
  const extraPaths = process.platform === 'win32'
    ? [getWindowsSystem32Path(join('OpenSSH', 'ssh.exe'))].filter((path): path is string => Boolean(path))
    : []
  const sshPath = findExecutable(sshCommand, extraPaths)
  if (!sshPath) throw new Error('未找到系统 ssh 命令。')
  return sshPath
}

function resolveSshTargetConfig(target: RemoteTarget): SshTargetConfig | null {
  if (target.sshConfig) return target.sshConfig
  if (!target.sshConfigId) return null
  return listSshTargetConfigs().find(config => config.id === target.sshConfigId) || null
}

function buildSshArgs(target: RemoteTarget, remoteCommand: string[] = [], allocateTty = false): string[] {
  const args = [allocateTty ? '-t' : '-T', '-o', 'BatchMode=no', '-o', 'NumberOfPasswordPrompts=3']
  const config = resolveSshTargetConfig(target)
  let destination = target.host?.trim() || target.label.trim()

  if (config) {
    destination = config.user ? `${config.user}@${config.hostName}` : config.hostName
    if (config.port) args.push('-p', String(config.port))
    if (config.proxyJump) args.push('-J', config.proxyJump)
    if (config.identityFile) args.push('-i', config.identityFile)
    if (config.authMethod === 'password') args.push('-o', 'PreferredAuthentications=password,keyboard-interactive', '-o', 'PubkeyAuthentication=no')
    if (config.authMethod === 'identityFile' || config.authMethod === 'identityFileWithPassphrase') args.push('-o', 'IdentitiesOnly=yes', '-o', 'PreferredAuthentications=publickey')
    args.push(...splitSshExtraOptions(config.extraOptions))
  }

  if (!destination) throw new Error('SSH 目标缺少 Host。')
  args.push(destination, ...remoteCommand)
  return args
}

function remoteAgentBootstrapScript(): string {
  const version = app.getVersion().replace(/[^a-zA-Z0-9._-]/g, '_') || 'dev'
  return [
    'set -eu',
    `dir="$HOME/.rillecode-server/${version}"`,
    'mkdir -p "$dir"',
    'agent="$dir/agent.js"',
    'if ! command -v node >/dev/null 2>&1; then echo "RilleCode remote requires node in PATH." >&2; exit 127; fi',
    'cat > "$agent" <<\'RILLECODE_AGENT_EOF\'',
    REMOTE_AGENT_SOURCE,
    'RILLECODE_AGENT_EOF',
    'exec node "$agent"',
    '',
  ].join('\n')
}

function resolveRemoteTarget(targetId: string, sshHost?: string): RemoteTarget {
  if (targetId === 'ssh:connect') {
    const host = sshHost?.trim()
    if (!host) throw new Error('请输入 SSH 主机名或 user@host。')
    return { id: `ssh:${host}`, kind: 'ssh', label: host, profileId: 'ssh', host, source: 'detected' }
  }

  const target = getRemoteTargets().find(item => item.id === targetId || item.profileId === targetId)
  if (!target) throw new Error('未找到远程目标。')
  return target
}

function classifyAuthPrompt(prompt: string): RemoteAuthPromptRequest['kind'] {
  if (/yes\/no|fingerprint|authenticity|continue connecting/i.test(prompt)) return 'confirmation'
  if (/password|passphrase|verification code|otp/i.test(prompt)) return 'password'
  return 'text'
}

function requestRemoteAuthPrompt(prompt: string): Promise<string> {
  const requestId = randomUUID()
  const kind = classifyAuthPrompt(prompt)
  const payload: RemoteAuthPromptRequest = { requestId, prompt, kind }
  sendToRenderers('remote:authPrompt', payload)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingAuthPrompts.delete(requestId)
      reject(new Error('SSH 认证输入超时。'))
    }, 120_000)
    pendingAuthPrompts.set(requestId, { resolve, reject, timer })
  })
}

async function ensureAskPassBroker(): Promise<string> {
  if (askPassServer && askPassPort && askPassScriptPath) return askPassScriptPath

  await new Promise<void>((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/askpass') {
        res.statusCode = 404
        res.end()
        return
      }
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      req.on('end', async () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8')
          const parsed = JSON.parse(body) as { prompt?: string }
          const answer = await requestRemoteAuthPrompt(String(parsed.prompt || 'SSH authentication'))
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end(answer)
        } catch {
          res.statusCode = 204
          res.end()
        }
      })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('无法启动 SSH AskPass broker。'))
        return
      }
      askPassServer = server
      askPassPort = address.port
      resolve()
    })
  })

  const dir = join(app.getPath('userData'), 'remote', 'askpass')
  mkdirSync(dir, { recursive: true })
  const helperJs = join(dir, 'askpass-helper.js')
  const helperSource = `
const http = require('http');
const prompt = process.argv.slice(2).join(' ') || 'SSH authentication';
const body = JSON.stringify({ prompt });
const request = http.request({ hostname: '127.0.0.1', port: ${askPassPort}, path: '/askpass', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
  let output = '';
  response.setEncoding('utf8');
  response.on('data', chunk => { output += chunk; });
  response.on('end', () => {
    if (response.statusCode !== 200) process.exit(1);
    process.stdout.write(output);
  });
});
request.on('error', () => process.exit(1));
request.end(body);
`
  writeFileSync(helperJs, helperSource, 'utf8')

  if (process.platform === 'win32') {
    askPassScriptPath = join(dir, 'rille-ssh-askpass.cmd')
    writeFileSync(askPassScriptPath, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${helperJs}" %*\r\n`, 'utf8')
  } else {
    askPassScriptPath = join(dir, 'rille-ssh-askpass.sh')
    writeFileSync(askPassScriptPath, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(process.execPath)} ${shellQuote(helperJs)} "$@"\n`, 'utf8')
    chmodSync(askPassScriptPath, 0o755)
  }

  return askPassScriptPath
}

async function getSshEnv(): Promise<NodeJS.ProcessEnv> {
  const askPassPath = await ensureAskPassBroker()
  return {
    ...process.env,
    DISPLAY: process.env.DISPLAY || 'rillecode:0',
    SSH_ASKPASS: askPassPath,
    SSH_ASKPASS_REQUIRE: 'force',
  }
}

async function spawnRemoteAgent(target: RemoteTarget): Promise<ChildProcessWithoutNullStreams> {
  if (target.kind === 'ssh') {
    const child = spawn(getSshExecutable(), buildSshArgs(target, ['sh', '-s']), {
      stdio: 'pipe',
      env: await getSshEnv(),
    })
    return child
  }

  const distro = target.distro?.trim()
  const wslPath = findExecutable('wsl.exe', [getWindowsSystem32Path('wsl.exe')].filter((item): item is string => Boolean(item)))
  const wslProfile = getTerminalProfiles().find(profile => profile.id === target.profileId)
  const commandPath = wslPath || wslProfile?.path
  if (!commandPath) throw new Error('未找到 wsl.exe。')
  const args = distro ? ['-d', distro, '--', 'sh', '-s'] : ['--', 'sh', '-s']
  const child = spawn(commandPath, args, { stdio: 'pipe' })
  return child
}

function uniqueOutputLines(value: string): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const line of value.replace(/\u0000/g, '').split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
    if (seen.has(line)) continue
    seen.add(line)
    lines.push(line)
  }
  return lines.join('\n')
}

function withRemoteDetails(message: string, details: string): string {
  return details ? `${message}\n${details}` : message
}

function formatRemoteError(runtime: RemoteRuntime, fallback: string): string {
  const stderr = uniqueOutputLines(runtime.stderr)
  if (/connection closed by/i.test(stderr)) {
    return withRemoteDetails(`${runtime.connection.label} SSH 连接被远端关闭。请检查 Host/IP、端口、用户名、登录方式，或确认远端允许执行远程命令。`, stderr)
  }
  if (/node/i.test(stderr) || /not found/i.test(stderr) || /127/.test(stderr)) {
    return withRemoteDetails(`${runtime.connection.label} 需要远程环境安装 node，并确保 node 在 PATH 中。`, stderr)
  }
  if (/permission denied|authentication|denied|too many authentication failures/i.test(stderr)) {
    return withRemoteDetails(`${runtime.connection.label} 认证失败。请检查 SSH key、ssh-agent、密码或 Host 配置。`, stderr)
  }
  if (/could not resolve|name or service not known|no route to host|connection refused|timed out|operation timed out/i.test(stderr)) {
    return withRemoteDetails(`${runtime.connection.label} 无法连接。`, stderr)
  }
  return stderr ? `${fallback}\n${stderr}` : fallback
}

function handleRemoteStdout(runtime: RemoteRuntime, chunk: Buffer): void {
  runtime.buffer = Buffer.concat([runtime.buffer, chunk])

  while (runtime.buffer.length > 0) {
    const text = runtime.buffer.toString('utf8')
    const headerStart = text.indexOf('Content-Length:')
    if (headerStart > 0) runtime.buffer = runtime.buffer.slice(headerStart)
    if (headerStart === -1) {
      if (runtime.buffer.length > 4096) runtime.buffer = Buffer.alloc(0)
      return
    }

    const currentText = runtime.buffer.toString('utf8')
    const headerEnd = currentText.indexOf('\r\n\r\n')
    if (headerEnd === -1) return
    const match = currentText.slice(0, headerEnd).match(/Content-Length:\s*(\d+)/i)
    if (!match) {
      runtime.buffer = runtime.buffer.slice(headerEnd + 4)
      continue
    }

    const bodyLength = Number(match[1])
    const bodyStart = headerEnd + 4
    if (runtime.buffer.length < bodyStart + bodyLength) return
    const body = runtime.buffer.slice(bodyStart, bodyStart + bodyLength).toString('utf8')
    runtime.buffer = runtime.buffer.slice(bodyStart + bodyLength)

    try {
      const message = JSON.parse(body) as { id?: number; result?: unknown; error?: { message?: string } }
      if (!message.id) continue
      const pending = runtime.pending.get(message.id)
      if (!pending) continue
      clearTimeout(pending.timer)
      runtime.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message || 'Remote agent error'))
      else pending.resolve(message.result)
    } catch (error) {
      pushOutput('System', 'error', 'Remote response parse failed', error instanceof Error ? error.message : String(error))
    }
  }
}

function rejectRemotePending(runtime: RemoteRuntime, error: Error): void {
  for (const pending of runtime.pending.values()) {
    clearTimeout(pending.timer)
    pending.reject(error)
  }
  runtime.pending.clear()
}

function remoteRequest<T>(connectionId: string, method: string, params: Record<string, unknown> = {}, timeout = 60_000): Promise<T> {
  const runtime = remoteConnections.get(connectionId)
  if (!runtime || runtime.connection.status !== 'connected' && method !== 'ping') {
    return Promise.reject(new Error('远程连接不可用或已断开。'))
  }

  const id = ++runtime.seq
  const body = Buffer.from(JSON.stringify({ id, method, params }), 'utf8')
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8')

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      runtime.pending.delete(id)
      reject(new Error(`${method} 远程请求超时。`))
    }, timeout)
    runtime.pending.set(id, { resolve: value => resolve(value as T), reject, timer })
    runtime.process.stdin.write(header)
    runtime.process.stdin.write(body)
  })
}

function isRemoteWorkspace(workspace?: WorkspaceLocation | null): workspace is WorkspaceLocation & { connectionId: string } {
  return Boolean(workspace && workspace.kind !== 'local' && workspace.connectionId)
}

function remoteConnectionForWorkspace(workspace: WorkspaceLocation & { connectionId: string }): RemoteRuntime {
  const runtime = remoteConnections.get(workspace.connectionId)
  if (!runtime || runtime.connection.status !== 'connected') throw new Error('远程连接不可用或已断开。')
  return runtime
}

async function connectRemoteTarget(targetId: string, sshHost?: string): Promise<RemoteConnection> {
  const target = resolveRemoteTarget(targetId, sshHost)
  const existing = [...remoteConnections.values()].find(runtime => runtime.target.id === target.id && runtime.connection.status === 'connected')
  if (existing) return existing.connection

  const id = randomUUID()
  const child = await spawnRemoteAgent(target)
  const connection: RemoteConnection = {
    id,
    targetId: target.id,
    kind: target.kind,
    label: target.kind === 'ssh' ? `SSH ${target.host || target.label}` : `WSL ${target.distro || target.label}`,
    home: '',
    status: 'connecting',
  }
  const runtime: RemoteRuntime = { connection, target, process: child, seq: 0, buffer: Buffer.alloc(0), stderr: '', pending: new Map() }
  remoteConnections.set(id, runtime)

  let readySettled = false
  let rejectReady: (error: Error) => void = () => undefined
  const readyPromise = new Promise<void>((resolve, reject) => {
    rejectReady = reject
    const timer = setTimeout(() => {
      if (readySettled) return
      readySettled = true
      reject(new Error('远程 agent 启动超时。'))
    }, 20_000)
    const settleReady = () => {
      if (readySettled) return
      readySettled = true
      clearTimeout(timer)
      resolve()
    }
    child.stdout.on('data', chunk => handleRemoteStdout(runtime, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    child.stderr.on('data', chunk => {
      const text = (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)).toString('utf8').replace(/\u0000/g, '')
      if (text.includes('RILLECODE_AGENT_READY')) settleReady()
      const cleaned = text.replace(/RILLECODE_AGENT_READY\r?\n?/g, '')
      if (cleaned) runtime.stderr += cleaned
      if (runtime.stderr.length > 16_000) runtime.stderr = runtime.stderr.slice(-16_000)
    })
  })
  child.on('error', error => {
    connection.status = 'error'
    connection.error = error.message
    if (!readySettled) {
      readySettled = true
      rejectReady(error)
    }
    rejectRemotePending(runtime, error)
  })
  child.on('exit', (code) => {
    if (connection.status !== 'error') {
      connection.status = 'error'
      connection.error = formatRemoteError(runtime, `远程连接已退出（code ${code ?? 'unknown'}）。`)
    }
    if (!readySettled) {
      readySettled = true
      rejectReady(new Error(connection.error || '远程连接已断开。'))
    }
    rejectRemotePending(runtime, new Error(connection.error || '远程连接已断开。'))
  })

  try {
    child.stdin.write(remoteAgentBootstrapScript())
    await readyPromise
    const ping = await remoteRequest<{ home: string; platform: string }>(id, 'ping', {}, 20_000)
    connection.home = ping.home || '/'
    connection.status = 'connected'
    connection.error = undefined
    pushOutput('System', 'info', `Connected to ${connection.label}`, connection.home)
    return connection
  } catch (error) {
    connection.status = 'error'
    connection.error = formatRemoteError(runtime, error instanceof Error ? error.message : '远程连接失败。')
    remoteConnections.delete(id)
    child.kill()
    pushOutput('System', 'error', `Remote connection failed: ${connection.label}`, connection.error)
    throw new Error(connection.error)
  }
}

function listRemoteConnections(): RemoteConnection[] {
  return [...remoteConnections.values()].map(runtime => ({ ...runtime.connection }))
}

function disconnectRemoteConnection(connectionId: string): boolean {
  const runtime = remoteConnections.get(connectionId)
  if (!runtime) return false
  for (const terminalRuntime of terminalSessions.values()) {
    if (terminalRuntime.session.workspace?.connectionId === connectionId) terminalRuntime.terminal.kill()
  }
  runtime.process.kill()
  remoteConnections.delete(connectionId)
  rejectRemotePending(runtime, new Error('远程连接已断开。'))
  pushOutput('System', 'info', `Disconnected ${runtime.connection.label}`)
  return true
}

async function getRemoteHome(connectionId: string): Promise<string> {
  const runtime = remoteConnections.get(connectionId)
  if (!runtime || runtime.connection.status !== 'connected') throw new Error('远程连接不可用或已断开。')
  if (runtime.connection.home) return runtime.connection.home
  const ping = await remoteRequest<{ home: string }>(connectionId, 'ping', {}, 10_000)
  runtime.connection.home = ping.home || '/'
  return runtime.connection.home
}

async function openRemoteWorkspace(connectionId: string, remotePath: string): Promise<WorkspaceLocation> {
  const runtime = remoteConnections.get(connectionId)
  if (!runtime || runtime.connection.status !== 'connected') throw new Error('远程连接不可用或已断开。')
  const pathValue = remotePath.trim() || runtime.connection.home || '/'
  const info = await remoteRequest<{ exists: boolean; isDirectory: boolean }>(connectionId, 'fs.stat', { path: pathValue }, 10_000)
  if (!info.exists) throw new Error(`远程目录不存在：${pathValue}`)
  if (!info.isDirectory) throw new Error(`远程路径不是目录：${pathValue}`)
  return {
    kind: runtime.connection.kind,
    path: pathValue,
    label: `${runtime.connection.label}:${pathValue}`,
    connectionId,
    targetId: runtime.connection.targetId,
  }
}

function getTerminalProfiles(): TerminalProfile[] {
  const profiles: TerminalProfile[] = []
  const seen = new Set<string>()
  const add = (
    id: string,
    label: string,
    command: string,
    args: string[] = [],
    extraPaths: string[] = [],
    kind: TerminalProfile['kind'] = 'local',
    isDefault = false,
  ) => {
    const resolved = findExecutable(command, extraPaths)
    if (!resolved) return
    const key = `${resolved}\0${args.join('\0')}`.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    profiles.push({ id, label, path: resolved, args, source: 'detected', kind, isDefault })
  }

  if (process.platform === 'win32') {
    const cmdPath = getWindowsSystem32Path('cmd.exe')
    const powershellPath = getWindowsSystem32Path(join('WindowsPowerShell', 'v1.0', 'powershell.exe'))
    const wslPath = getWindowsSystem32Path('wsl.exe')
    add('cmd', 'Command Prompt', 'cmd.exe', [], cmdPath ? [cmdPath] : [], 'local', true)
    add('pwsh', 'PowerShell 7', 'pwsh.exe', ['-NoLogo'])
    add('powershell', 'Windows PowerShell', 'powershell.exe', ['-NoLogo'], powershellPath ? [powershellPath] : [])
    add('git-bash', 'Git Bash', 'bash.exe', ['--login', '-i'], [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ])
    const resolvedWslPath = findExecutable('wsl.exe', wslPath ? [wslPath] : [])
    if (resolvedWslPath && isWslAvailable(resolvedWslPath)) {
      const distros = getWslDistroNames(resolvedWslPath)
      add('wsl', 'WSL', 'wsl.exe', [], [resolvedWslPath], 'wsl')
      for (const distro of distros) add(`wsl:${distro}`, `WSL: ${distro}`, 'wsl.exe', ['-d', distro], [resolvedWslPath], 'wsl')
    }
  } else {
    add('bash', 'bash', 'bash', [], [], 'local', true)
    add('zsh', 'zsh', 'zsh')
    add('fish', 'fish', 'fish')
    add('sh', 'sh', 'sh')
  }

  const sshCommand = process.platform === 'win32' ? 'ssh.exe' : 'ssh'
  const sshExtraPaths = process.platform === 'win32'
    ? [getWindowsSystem32Path(join('OpenSSH', 'ssh.exe'))].filter((path): path is string => Boolean(path))
    : []
  const sshPath = findExecutable(sshCommand, sshExtraPaths)
  if (sshPath) {
    add('ssh', 'Remote SSH...', sshCommand, [], [sshPath], 'ssh')
    for (const host of parseSshConfigHosts()) add(`ssh:${host}`, `SSH: ${host}`, sshCommand, [host], [sshPath], 'ssh')
  }

  if (profiles.length === 0) {
    const fallback = process.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/sh')
    profiles.push({ id: 'default', label: basename(fallback), path: fallback, source: 'fallback', kind: 'local', isDefault: true })
  }

  return profiles
}

function getDefaultTerminalProfile(profileId?: string): TerminalProfile {
  const profiles = getTerminalProfiles()
  return profiles.find(profile => profile.id === profileId)
    || profiles.find(profile => profile.id === 'cmd')
    || profiles.find(profile => profile.isDefault)
    || profiles[0]
}

function createTerminal(sender: WebContents, cwd?: string, cols = 80, rows = 24, launchOptions: TerminalLaunchOptions = {}): TerminalSession {
  const id = randomUUID()
  const env = { ...process.env, TERM: 'xterm-256color' }
  let profile = getDefaultTerminalProfile(launchOptions.profileId)
  let terminalCwd = cwd && existsSync(cwd) ? cwd : homedir()
  let args = [...(profile.args || [])]
  let name = profile.label
  let workspace = launchOptions.workspace || null

  if (isRemoteWorkspace(workspace)) {
    const runtime = remoteConnectionForWorkspace(workspace)
    const remoteCommand = `cd ${shellQuote(workspace.path)} && exec "\${SHELL:-/bin/sh}" -l`
    terminalCwd = homedir()
    name = runtime.connection.label

    if (runtime.connection.kind === 'ssh') {
      const sshProfile = getTerminalProfiles().find(item => item.kind === 'ssh' && item.id === 'ssh')
      if (!sshProfile) throw new Error('远程 SSH 终端无法启动：缺少 ssh 命令。')
      profile = sshProfile
      args = buildSshArgs(runtime.target, [remoteCommand], true)
    } else {
      const wslPath = findExecutable('wsl.exe', [getWindowsSystem32Path('wsl.exe')].filter((item): item is string => Boolean(item)))
      const wslProfile = getTerminalProfiles().find(item => item.id === runtime.target.profileId)
      const commandPath = wslPath || wslProfile?.path
      if (!commandPath) throw new Error('远程 WSL 终端无法启动：未找到 wsl.exe。')
      profile = { id: runtime.target.profileId, label: runtime.connection.label, path: commandPath, kind: 'wsl', source: 'detected' }
      args = runtime.target.distro
        ? ['-d', runtime.target.distro, '--', 'sh', '-lc', remoteCommand]
        : ['--', 'sh', '-lc', remoteCommand]
    }
  } else if (profile.kind === 'ssh' && profile.id === 'ssh') {
    const host = launchOptions.sshHost?.trim()
    if (!host) throw new Error('请输入 SSH 主机名或使用 ~/.ssh/config 中的 Host。')
    args = [host]
    name = `SSH: ${host}`
  }

  const terminal = pty.spawn(profile.path, args, {
    name: 'xterm-256color',
    cols: Math.max(2, Math.floor(cols)),
    rows: Math.max(1, Math.floor(rows)),
    cwd: terminalCwd,
    env,
  })

  const session: TerminalSession = {
    id,
    cwd: isRemoteWorkspace(workspace) ? workspace.path : terminalCwd,
    shell: [profile.path, ...args].join(' '),
    profileId: profile.id,
    name,
    workspace,
  }

  terminal.onData((data) => {
    if (!sender.isDestroyed()) sender.send('terminal:data', { id, data })
  })

  terminal.onExit(({ exitCode }) => {
    terminalSessions.delete(id)
    pushOutput('Terminal', exitCode === 0 ? 'info' : 'warning', `${session.name} exited with code ${exitCode}`, undefined, sender)
    if (!sender.isDestroyed()) sender.send('terminal:exit', { id, exitCode })
  })

  terminalSessions.set(id, { session, terminal })
  pushOutput('Terminal', 'info', `Started ${session.name}`, terminalCwd, sender)
  return session
}

function killAllTerminals(): void {
  for (const runtime of terminalSessions.values()) runtime.terminal.kill()
  terminalSessions.clear()
  for (const runtime of debugSessions.values()) runtime.process.kill()
  debugSessions.clear()
  for (const runtime of remoteConnections.values()) runtime.process.kill()
  remoteConnections.clear()
}

function parsePortAddress(raw: string): { address: string; port: number } | null {
  const trimmed = raw.trim().replace(/^\[|\]$/g, '')
  const match = trimmed.match(/^(.*):(\d+)$/)
  if (!match) return null
  const address = match[1].replace(/^\[|\]$/g, '') || '0.0.0.0'
  return { address, port: Number(match[2]) }
}

function normalizePort(entry: Omit<PortEntry, 'id'>): PortEntry {
  return {
    ...entry,
    id: `${entry.protocol}:${entry.address}:${entry.port}:${entry.pid}`,
    processName: entry.processName || undefined,
  }
}

async function listWindowsPorts(): Promise<PortEntry[]> {
  const script = `
$items = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  [pscustomobject]@{ protocol='tcp'; address=$_.LocalAddress; port=[int]$_.LocalPort; pid=[int]$_.OwningProcess; processName=$(if ($p) { $p.ProcessName } else { '' }) }
}
$items | ConvertTo-Json -Compress
`
  const result = await execFileText('powershell.exe', ['-NoProfile', '-Command', script], undefined, 8000)
  if (result.success && result.stdout.trim()) {
    const parsed = JSON.parse(result.stdout.trim()) as Array<Record<string, unknown>> | Record<string, unknown>
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows.map(row => normalizePort({
      protocol: String(row.protocol || 'tcp'),
      address: String(row.address || '0.0.0.0'),
      port: Number(row.port),
      pid: Number(row.pid),
      processName: String(row.processName || ''),
    })).filter(row => Number.isFinite(row.port) && row.port > 0)
  }

  const fallback = await execFileText('netstat.exe', ['-ano', '-p', 'tcp'], undefined, 8000)
  if (!fallback.success) throw new Error(result.error || fallback.error || '端口扫描失败。')
  return fallback.stdout.split(/\r?\n/).flatMap(line => {
    if (!/LISTENING/i.test(line)) return []
    const parts = line.trim().split(/\s+/)
    const parsed = parsePortAddress(parts[1] || '')
    const pid = Number(parts[4])
    if (!parsed || !Number.isFinite(pid)) return []
    return [normalizePort({ protocol: 'tcp', address: parsed.address, port: parsed.port, pid })]
  })
}

async function listUnixPorts(): Promise<PortEntry[]> {
  const lsof = await execFileText('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], undefined, 8000)
  if (lsof.success && lsof.stdout.trim()) {
    return lsof.stdout.split(/\r?\n/).slice(1).flatMap(line => {
      const match = line.match(/^(\S+)\s+(\d+)\s+.*?\s+(TCP)\s+(.+?)(?:\s+\(LISTEN\))?$/)
      if (!match) return []
      const parsed = parsePortAddress(match[4])
      if (!parsed) return []
      return [normalizePort({ protocol: match[3].toLowerCase(), address: parsed.address, port: parsed.port, pid: Number(match[2]), processName: match[1] })]
    })
  }

  const ss = await execFileText('ss', ['-ltnpH'], undefined, 8000)
  if (ss.success && ss.stdout.trim()) {
    return ss.stdout.split(/\r?\n/).flatMap(line => {
      const parts = line.trim().split(/\s+/)
      const local = parts[3] || parts[2] || ''
      const parsed = parsePortAddress(local)
      const pid = Number((line.match(/pid=(\d+)/) || [])[1])
      const processName = (line.match(/"([^"]+)"/) || [])[1]
      if (!parsed || !Number.isFinite(pid)) return []
      return [normalizePort({ protocol: 'tcp', address: parsed.address, port: parsed.port, pid, processName })]
    })
  }

  const netstat = await execFileText('netstat', ['-ltnp'], undefined, 8000)
  if (!netstat.success) throw new Error(lsof.error || ss.error || netstat.error || '端口扫描失败。')
  return netstat.stdout.split(/\r?\n/).flatMap(line => {
    if (!/LISTEN/i.test(line)) return []
    const parts = line.trim().split(/\s+/)
    const parsed = parsePortAddress(parts[3] || '')
    const proc = parts[6] || ''
    const pid = Number((proc.match(/^(\d+)/) || [])[1])
    const processName = proc.includes('/') ? proc.split('/').slice(1).join('/') : undefined
    if (!parsed || !Number.isFinite(pid)) return []
    return [normalizePort({ protocol: 'tcp', address: parsed.address, port: parsed.port, pid, processName })]
  })
}

async function listPorts(sender?: WebContents): Promise<PortEntry[]> {
  try {
    const ports = process.platform === 'win32' ? await listWindowsPorts() : await listUnixPorts()
    const unique = [...new Map(ports.map(port => [port.id, port])).values()]
      .sort((a, b) => a.port - b.port || a.pid - b.pid)
    pushOutput('Ports', 'info', `Scanned ${unique.length} listening ports`, undefined, sender)
    return unique
  } catch (error) {
    const message = error instanceof Error ? error.message : '端口扫描失败。'
    pushOutput('Ports', 'error', 'Port scan failed', message, sender)
    throw new Error(message)
  }
}

async function killPortProcess(pid: number, sender?: WebContents): Promise<PortOperationResult> {
  if (!Number.isFinite(pid) || pid <= 0) return { success: false, error: 'PID 无效。' }
  try {
    if (process.platform === 'win32') {
      const result = await execFileText('taskkill.exe', ['/PID', String(pid), '/F'], undefined, 8000)
      if (!result.success) return { success: false, error: result.error || '停止进程失败。' }
    } else {
      process.kill(pid, 'SIGTERM')
    }
    pushOutput('Ports', 'warning', `Stopped process ${pid}`, undefined, sender)
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : '停止进程失败。'
    pushOutput('Ports', 'error', `Failed to stop process ${pid}`, message, sender)
    return { success: false, error: message }
  }
}

function sendDebugPayload(runtime: DebugRuntime, payload: DebugEventPayload): void {
  if (!runtime.sender.isDestroyed()) runtime.sender.send('debug:event', payload)
}

function setDebugState(runtime: DebugRuntime, status: DebugSessionState['status'], error?: string): void {
  runtime.state = { ...runtime.state, status, error }
  sendDebugPayload(runtime, { sessionId: runtime.id, type: 'state', state: runtime.state })
}

function sendDapRequest(runtime: DebugRuntime, command: string, args?: Record<string, unknown>): number {
  const seq = ++runtime.seq
  const message = JSON.stringify({ seq, type: 'request', command, arguments: args || {} })
  runtime.process.stdin.write(`Content-Length: ${Buffer.byteLength(message, 'utf8')}\r\n\r\n${message}`)
  return seq
}

function sendDapOutput(runtime: DebugRuntime, level: OutputLevel, message: string, body?: Record<string, unknown>): void {
  pushOutput('Debug', level, message, body ? JSON.stringify(body, null, 2) : undefined, runtime.sender)
  sendDebugPayload(runtime, { sessionId: runtime.id, type: level === 'error' ? 'error' : 'output', message, body })
}

function applyDebugBreakpoints(runtime: DebugRuntime): void {
  for (const item of runtime.configuration.breakpoints || []) {
    if (item.lines.length === 0) continue
    sendDapRequest(runtime, 'setBreakpoints', {
      source: { path: item.sourcePath, name: basename(item.sourcePath) },
      breakpoints: item.lines.map(line => ({ line })),
      lines: item.lines,
    })
  }
}

function launchDebugRuntime(runtime: DebugRuntime): void {
  if (runtime.launched) return
  runtime.launched = true
  const launchArgs = {
    ...(runtime.configuration.launch || {}),
    cwd: runtime.configuration.cwd || runtime.configuration.launch?.cwd,
  }
  sendDapRequest(runtime, 'launch', launchArgs)
}

function handleDebugMessage(runtime: DebugRuntime, message: DebugProtocolMessage): void {
  if (message.type === 'event') {
    if (message.event === 'initialized') {
      applyDebugBreakpoints(runtime)
      sendDapRequest(runtime, 'configurationDone')
      launchDebugRuntime(runtime)
      setDebugState(runtime, 'running')
      return
    }
    if (message.event === 'output') {
      const body = message.body || {}
      const output = String(body.output || '').trimEnd()
      if (output) sendDapOutput(runtime, 'info', output, body)
      return
    }
    if (message.event === 'stopped') {
      const threadId = Number(message.body?.threadId)
      if (Number.isFinite(threadId)) runtime.lastThreadId = threadId
      setDebugState(runtime, 'paused')
      sendDapOutput(runtime, 'info', message.body?.description ? String(message.body.description) : 'Debug session paused', message.body)
      return
    }
    if (message.event === 'continued') {
      setDebugState(runtime, 'running')
      return
    }
    if (message.event === 'terminated' || message.event === 'exited') {
      setDebugState(runtime, 'stopped')
      sendDapOutput(runtime, 'info', `Debug session ${message.event}`)
      return
    }
  }

  if (message.type === 'response') {
    if (message.command === 'initialize' && message.success) {
      runtime.initialized = true
      launchDebugRuntime(runtime)
      return
    }
    if (message.command === 'threads' && message.body && Array.isArray(message.body.threads)) {
      const first = message.body.threads[0] as { id?: number } | undefined
      if (first?.id) runtime.lastThreadId = first.id
    }
    if (message.command === 'evaluate' && message.body) {
      const result = String(message.body.result || '')
      if (result) sendDapOutput(runtime, 'info', result, message.body)
      return
    }
    if (message.success === false) {
      sendDapOutput(runtime, 'error', message.message || `${message.command || 'DAP request'} failed`, message.body)
    }
  }

  sendDebugPayload(runtime, { sessionId: runtime.id, type: 'message', message: JSON.stringify(message), body: message.body })
}

function parseDebugBuffer(runtime: DebugRuntime): void {
  while (runtime.buffer.length > 0) {
    const headerEnd = runtime.buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return
    const header = runtime.buffer.subarray(0, headerEnd).toString('utf8')
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
    if (!lengthMatch) {
      runtime.buffer = Buffer.alloc(0)
      return
    }
    const length = Number(lengthMatch[1])
    const bodyStart = headerEnd + 4
    const bodyEnd = bodyStart + length
    if (runtime.buffer.length < bodyEnd) return
    const raw = runtime.buffer.subarray(bodyStart, bodyEnd).toString('utf8')
    runtime.buffer = runtime.buffer.subarray(bodyEnd)
    try {
      handleDebugMessage(runtime, JSON.parse(raw) as DebugProtocolMessage)
    } catch (error) {
      sendDapOutput(runtime, 'error', error instanceof Error ? error.message : 'Invalid DAP message')
    }
  }
}

function startDebugSession(sender: WebContents, configuration: DebugConfiguration): DebugSessionState {
  const adapterCommand = configuration.adapterCommand.trim()
  if (!adapterCommand) throw new Error('Debug adapter command is required.')
  const id = randomUUID()
  const cwd = configuration.cwd && existsSync(configuration.cwd) ? configuration.cwd : homedir()
  const child = spawn(adapterCommand, configuration.adapterArgs || [], {
    cwd,
    env: { ...process.env },
    stdio: 'pipe',
  })
  const runtime: DebugRuntime = {
    id,
    sender,
    process: child,
    seq: 0,
    buffer: Buffer.alloc(0),
    state: { id, status: 'starting', name: configuration.name || basename(adapterCommand) },
    configuration,
    initialized: false,
    launched: false,
  }
  debugSessions.set(id, runtime)

  child.stdout.on('data', (chunk: Buffer) => {
    runtime.buffer = Buffer.concat([runtime.buffer, chunk])
    parseDebugBuffer(runtime)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trimEnd()
    if (text) sendDapOutput(runtime, 'warning', text)
  })
  child.on('error', (error) => {
    setDebugState(runtime, 'error', error.message)
    sendDapOutput(runtime, 'error', error.message)
  })
  child.on('exit', (code) => {
    debugSessions.delete(id)
    setDebugState(runtime, runtime.state.status === 'error' ? 'error' : 'stopped')
    pushOutput('Debug', code === 0 ? 'info' : 'warning', `Debug adapter exited with code ${code ?? 'unknown'}`, undefined, sender)
  })

  pushOutput('Debug', 'info', `Started debug adapter ${adapterCommand}`, cwd, sender)
  sendDapRequest(runtime, 'initialize', {
    clientID: 'rillecode',
    clientName: 'RilleCode',
    adapterID: configuration.name || 'generic',
    pathFormat: 'path',
    linesStartAt1: true,
    columnsStartAt1: true,
    supportsVariableType: true,
    supportsRunInTerminalRequest: false,
  })
  return runtime.state
}

function stopDebugSession(id: string): PortOperationResult {
  const runtime = debugSessions.get(id)
  if (!runtime) return { success: true }
  try {
    sendDapRequest(runtime, 'disconnect', { terminateDebuggee: true })
  } catch {
    // Adapter may already be gone.
  }
  runtime.process.kill()
  debugSessions.delete(id)
  setDebugState(runtime, 'stopped')
  return { success: true }
}

function sendDebugCommand(id: string, command: string, args?: Record<string, unknown>): PortOperationResult {
  const runtime = debugSessions.get(id)
  if (!runtime) return { success: false, error: '调试会话不存在。' }
  const threadCommand = new Set(['continue', 'pause', 'next', 'stepIn', 'stepOut'])
  const finalArgs = threadCommand.has(command)
    ? { threadId: runtime.lastThreadId || 1, ...(args || {}) }
    : (args || {})
  sendDapRequest(runtime, command, finalArgs)
  if (command === 'continue') setDebugState(runtime, 'running')
  if (command === 'pause' || command === 'next' || command === 'stepIn' || command === 'stepOut') {
    sendDapRequest(runtime, 'threads')
  }
  return { success: true }
}

// ── IPC Handlers ────────────────────────────────────────────

ipcMain.handle('dialog:openFolder', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  const options: OpenDialogOptions = { properties: ['openDirectory'] }
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:openFile', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  const options: OpenDialogOptions = { properties: ['openFile'] }
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:saveFile', async (event, defaultPath?: string) => {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
  const options: SaveDialogOptions = { defaultPath }
  const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
  return result.canceled ? null : result.filePath ?? null
})

ipcMain.handle('app:newWindow', () => {
  createWindow()
})

ipcMain.handle('app:exit', () => {
  app.quit()
})

ipcMain.handle('fs:readDirectory', async (_event, dirPath: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<FileEntry[]>(workspace.connectionId, 'fs.readDirectory', { path: dirPath })
  return readDirectory(dirPath)
})

ipcMain.handle('fs:readFile', async (_event, filePath: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<string>(workspace.connectionId, 'fs.readFile', { path: filePath })
  const content = await readFile(filePath, 'utf-8')
  return content
})

ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<boolean>(workspace.connectionId, 'fs.writeFile', { path: filePath, content })
  await writeFile(filePath, content, 'utf-8')
  return true
})

ipcMain.handle('fs:fileExists', async (_event, filePath: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) {
    const info = await remoteRequest<{ exists: boolean }>(workspace.connectionId, 'fs.stat', { path: filePath })
    return info.exists
  }
  return existsSync(filePath)
})

ipcMain.handle('fs:getFileInfo', async (_event, filePath: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) {
    const info = await remoteRequest<{ exists: boolean; size?: number; modifiedTime?: number }>(workspace.connectionId, 'fs.stat', { path: filePath })
    return info.exists ? { size: info.size || 0, modifiedTime: info.modifiedTime || 0 } : null
  }
  try {
    const s = await stat(filePath)
    return { size: s.size, modifiedTime: s.mtimeMs }
  } catch {
    return null
  }
})

ipcMain.handle('search:files', async (_event, rootPath: string, query: string, options: SearchOptions, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<SearchResult[]>(workspace.connectionId, 'search.files', { rootPath, query, options })
  return searchFiles(rootPath, query, options)
})

ipcMain.handle('git:status', async (_event, rootPath: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitStatusResult>(workspace.connectionId, 'git.status', { rootPath })
  return getGitStatus(rootPath)
})

ipcMain.handle('git:stage', async (_event, rootPath: string, filePath: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitCommandResult>(workspace.connectionId, 'git.stage', { rootPath, filePath })
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  const result = await runGit(repo.repoRoot, ['add', '--', toGitPath(repo.repoRoot, filePath)])
  return { success: result.success, error: result.error }
})

ipcMain.handle('git:unstage', async (_event, rootPath: string, filePath: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitCommandResult>(workspace.connectionId, 'git.unstage', { rootPath, filePath })
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  const result = await runGit(repo.repoRoot, ['restore', '--staged', '--', toGitPath(repo.repoRoot, filePath)])
  return { success: result.success, error: result.error }
})

ipcMain.handle('git:commit', async (_event, rootPath: string, message: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitCommandResult>(workspace.connectionId, 'git.commit', { rootPath, message })
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  const result = await runGit(repo.repoRoot, ['commit', '-m', message])
  return { success: result.success, error: result.error }
})

ipcMain.handle('git:fileDiff', async (_event, rootPath: string, filePath: string, kind: GitFileDiffKind, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitDiffResult>(workspace.connectionId, 'git.fileDiff', { rootPath, filePath, kind })
  return getGitFileDiff(rootPath, filePath, kind)
})

ipcMain.handle('git:log', async (_event, rootPath: string, limit?: number, skip?: number, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<{ success: boolean; commits: GitCommitSummary[]; error?: string }>(workspace.connectionId, 'git.log', { rootPath, limit, skip })
  return getGitLog(rootPath, limit, skip)
})

ipcMain.handle('git:commitFiles', async (_event, rootPath: string, hash: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<{ success: boolean; files: GitCommitFile[]; error?: string }>(workspace.connectionId, 'git.commitFiles', { rootPath, hash })
  return getGitCommitFiles(rootPath, hash)
})

ipcMain.handle('git:commitFileDiff', async (_event, rootPath: string, hash: string, filePath: string, previousPath?: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitDiffResult>(workspace.connectionId, 'git.commitFileDiff', { rootPath, hash, filePath, previousPath })
  return getGitCommitFileDiff(rootPath, hash, filePath, previousPath)
})

ipcMain.handle('git:checkoutCommit', async (_event, rootPath: string, hash: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitCommandResult>(workspace.connectionId, 'git.checkoutCommit', { rootPath, hash })
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  const result = await runGit(repo.repoRoot, ['checkout', '--detach', hash])
  return { success: result.success, error: result.error }
})

ipcMain.handle('git:createBranchFromCommit', async (_event, rootPath: string, hash: string, branchName: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitCommandResult>(workspace.connectionId, 'git.createBranchFromCommit', { rootPath, hash, branchName })
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }

  const normalizedBranchName = branchName.trim()
  const validation = await runGit(repo.repoRoot, ['check-ref-format', '--branch', normalizedBranchName])
  if (!normalizedBranchName || !validation.success) {
    return { success: false, error: validation.error || '分支名无效。' }
  }

  const result = await runGit(repo.repoRoot, ['checkout', '-b', normalizedBranchName, hash])
  return { success: result.success, error: result.error }
})

ipcMain.handle('git:resetToCommit', async (_event, rootPath: string, hash: string, mode: GitResetMode, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitCommandResult>(workspace.connectionId, 'git.resetToCommit', { rootPath, hash, mode })
  const repo = await resolveRepoRoot(rootPath)
  if (!repo.success) return { success: false, error: repo.error }
  if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') {
    return { success: false, error: 'Reset mode is invalid.' }
  }
  const result = await runGit(repo.repoRoot, ['reset', `--${mode}`, hash])
  return { success: result.success, error: result.error }
})

ipcMain.handle('git:branches', async (_event, rootPath: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitBranchesResult>(workspace.connectionId, 'git.branches', { rootPath })
  return getGitBranches(rootPath)
})

ipcMain.handle('git:switchBranch', async (_event, rootPath: string, branchName: string, branchType: 'local' | 'remote', autoStash?: boolean, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitOperationResult>(workspace.connectionId, 'git.operation.switchBranch', { rootPath, branchName, branchType, autoStash })
  return switchGitBranch(rootPath, branchName, branchType, autoStash)
})

ipcMain.handle('git:createBranch', async (_event, rootPath: string, branchName: string, startPoint?: string, checkout?: boolean, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitOperationResult>(workspace.connectionId, 'git.operation.createBranch', { rootPath, branchName, startPoint, checkout })
  return createGitBranch(rootPath, branchName, startPoint, checkout)
})

ipcMain.handle('git:deleteBranch', async (_event, rootPath: string, branchName: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitOperationResult>(workspace.connectionId, 'git.operation.deleteBranch', { rootPath, branchName })
  return deleteGitBranch(rootPath, branchName)
})

ipcMain.handle('git:fetch', async (_event, rootPath: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitOperationResult>(workspace.connectionId, 'git.operation.fetch', { rootPath })
  return fetchGit(rootPath)
})

ipcMain.handle('git:pull', async (_event, rootPath: string, autoStash?: boolean, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitOperationResult>(workspace.connectionId, 'git.operation.pull', { rootPath, autoStash })
  return pullGit(rootPath, autoStash)
})

ipcMain.handle('git:push', async (_event, rootPath: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitOperationResult>(workspace.connectionId, 'git.operation.push', { rootPath })
  return pushGit(rootPath)
})

ipcMain.handle('git:merge', async (_event, rootPath: string, branchName: string, autoStash?: boolean, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitOperationResult>(workspace.connectionId, 'git.operation.merge', { rootPath, branchName, autoStash })
  return mergeGitBranch(rootPath, branchName, autoStash)
})

ipcMain.handle('git:rebase', async (_event, rootPath: string, branchName: string, autoStash?: boolean, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitOperationResult>(workspace.connectionId, 'git.operation.rebase', { rootPath, branchName, autoStash })
  return rebaseGitBranch(rootPath, branchName, autoStash)
})

ipcMain.handle('git:abortMerge', async (_event, rootPath: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitOperationResult>(workspace.connectionId, 'git.operation.abortMerge', { rootPath })
  return abortMerge(rootPath)
})

ipcMain.handle('git:abortRebase', async (_event, rootPath: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitOperationResult>(workspace.connectionId, 'git.operation.abortRebase', { rootPath })
  return abortRebase(rootPath)
})

ipcMain.handle('git:stashList', async (_event, rootPath: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitStashListResult>(workspace.connectionId, 'git.stashList', { rootPath })
  return listGitStashes(rootPath)
})

ipcMain.handle('git:stashPush', async (_event, rootPath: string, message?: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitOperationResult>(workspace.connectionId, 'git.operation.stashPush', { rootPath, message })
  return stashPush(rootPath, message)
})

ipcMain.handle('git:stashApply', async (_event, rootPath: string, stashRef: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitOperationResult>(workspace.connectionId, 'git.operation.stashApply', { rootPath, stashRef })
  return stashApply(rootPath, stashRef)
})

ipcMain.handle('git:stashPop', async (_event, rootPath: string, stashRef: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitOperationResult>(workspace.connectionId, 'git.operation.stashPop', { rootPath, stashRef })
  return stashPop(rootPath, stashRef)
})

ipcMain.handle('git:stashDrop', async (_event, rootPath: string, stashRef: string, workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitOperationResult>(workspace.connectionId, 'git.operation.stashDrop', { rootPath, stashRef })
  return stashDrop(rootPath, stashRef)
})

ipcMain.handle('git:resolveCommitAvatars', async (_event, rootPath: string, hashes: string[], workspace?: WorkspaceLocation | null) => {
  if (isRemoteWorkspace(workspace)) return remoteRequest<GitAvatarResult>(workspace.connectionId, 'git.resolveCommitAvatars', { rootPath, hashes })
  return resolveCommitAvatars(rootPath, hashes)
})

ipcMain.handle('output:list', () => {
  return outputEntries
})

ipcMain.handle('output:clear', (event) => {
  outputEntries.length = 0
  sendToRenderers('output:cleared', null, event.sender)
})

ipcMain.handle('terminal:listProfiles', () => {
  return getTerminalProfiles()
})

ipcMain.handle('remote:listTargets', () => {
  return getRemoteTargets()
})

ipcMain.handle('remote:listSshConfigs', () => {
  return listSshTargetConfigs()
})

ipcMain.handle('remote:saveSshConfig', (_event, config: Partial<SshTargetConfig>) => {
  try {
    return { ok: true, value: saveSshTargetConfig(config) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('remote:deleteSshConfig', (_event, id: string) => {
  try {
    return { ok: true, value: deleteSshTargetConfig(id) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('remote:selectIdentityFile', async (event) => {
  try {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    const options: OpenDialogOptions = { properties: ['openFile'] }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return { ok: true, value: result.canceled ? null : result.filePaths[0] }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('remote:respondAuthPrompt', (_event, requestId: string, response: { value?: string; cancelled?: boolean }) => {
  const pending = pendingAuthPrompts.get(requestId)
  if (!pending) return false
  clearTimeout(pending.timer)
  pendingAuthPrompts.delete(requestId)
  if (response?.cancelled) pending.reject(new Error('用户取消了 SSH 认证。'))
  else pending.resolve(String(response?.value ?? ''))
  return true
})

ipcMain.handle('remote:connect', async (_event, targetId: string, sshHost?: string) => {
  try {
    return { ok: true, value: await connectRemoteTarget(targetId, sshHost) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('remote:disconnect', (_event, connectionId: string) => {
  return disconnectRemoteConnection(connectionId)
})

ipcMain.handle('remote:listConnections', () => {
  return listRemoteConnections()
})

ipcMain.handle('remote:getHome', async (_event, connectionId: string) => {
  try {
    return { ok: true, value: await getRemoteHome(connectionId) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('remote:openWorkspace', async (_event, connectionId: string, remotePath: string) => {
  try {
    return { ok: true, value: await openRemoteWorkspace(connectionId, remotePath) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('terminal:create', (event, cwd?: string, cols?: number, rows?: number, launchOptions?: TerminalLaunchOptions) => {
  try {
    return createTerminal(event.sender, cwd, cols, rows, launchOptions)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Terminal failed to start'
    pushOutput('Terminal', 'error', 'Terminal failed to start', message, event.sender)
    throw new Error(message)
  }
})

ipcMain.handle('terminal:write', (_event, id: string, data: string) => {
  terminalSessions.get(id)?.terminal.write(data)
})

ipcMain.handle('terminal:resize', (_event, id: string, cols: number, rows: number) => {
  terminalSessions.get(id)?.terminal.resize(cols, rows)
})

ipcMain.handle('terminal:kill', (event, id: string) => {
  const runtime = terminalSessions.get(id)
  if (runtime) {
    runtime.terminal.kill()
    terminalSessions.delete(id)
    pushOutput('Terminal', 'warning', `Closed ${runtime.session.name}`, undefined, event.sender)
  }
})

ipcMain.handle('ports:list', async (event) => {
  return listPorts(event.sender)
})

ipcMain.handle('ports:kill', async (event, pid: number) => {
  return killPortProcess(pid, event.sender)
})

ipcMain.handle('debug:start', (event, configuration: DebugConfiguration) => {
  try {
    return startDebugSession(event.sender, configuration)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Debug session failed to start'
    pushOutput('Debug', 'error', 'Debug session failed to start', message, event.sender)
    throw new Error(message)
  }
})

ipcMain.handle('debug:stop', (_event, sessionId: string) => {
  return stopDebugSession(sessionId)
})

ipcMain.handle('debug:send', (_event, sessionId: string, command: string, args?: Record<string, unknown>) => {
  return sendDebugCommand(sessionId, command, args)
})

ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  await shell.openExternal(url)
})

// ── App Lifecycle ────────────────────────────────────────────

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
})

app.on('before-quit', () => {
  killAllTerminals()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
