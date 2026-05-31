import { type ChildProcess, execFileSync } from 'child_process'
import { rmSync } from 'fs'
import { posix, win32 } from 'path'

export function shellQuote(value: string): string {
  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '""')}"`
  }
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function rmSyncWithRetry(targetPath: string, maxRetries = 5, delayMs = 200): void {
  for (let attempt = 0; ; attempt++) {
    try {
      rmSync(targetPath, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt >= maxRetries) throw error
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error
      const waitMs = delayMs * (attempt + 1)
      const start = Date.now()
      while (Date.now() - start < waitMs) { /* busy-wait */ }
    }
  }
}

export function killProcess(child: ChildProcess): void {
  if (process.platform === 'win32') {
    child.kill()
    return
  }
  child.kill('SIGTERM')
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL')
  }, 5000)
}

export function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true }) } catch { /* pid may not exist */ }
  } else {
    try { process.kill(-pid, 'SIGKILL') } catch { /* process group may not exist */ }
  }
}

export function normalizePathSep(path: string): string {
  return path.replace(/\\/g, '/')
}

export function isPathInside(parent: string, child: string): boolean {
  const looksWindowsPath = /^[a-zA-Z]:[\\/]/.test(parent) || /^[a-zA-Z]:[\\/]/.test(child) || parent.includes('\\') || child.includes('\\')
  if (process.platform === 'win32' || looksWindowsPath) {
    const resolvedParent = normalizePathSep(win32.resolve(parent)).replace(/\/+$/, '')
    const resolvedChild = normalizePathSep(win32.resolve(child)).replace(/\/+$/, '')
    const parentKey = resolvedParent.toLowerCase()
    const childKey = resolvedChild.toLowerCase()
    return childKey === parentKey || childKey.startsWith(`${parentKey}/`)
  }
  const resolvedParent = posix.resolve(parent).replace(/\/+$/, '')
  const resolvedChild = posix.resolve(child).replace(/\/+$/, '')
  return resolvedChild === resolvedParent || resolvedChild.startsWith(`${resolvedParent}/`)
}

export function isShellRequired(commandLine: string): boolean {
  if (/[|&;<>()`]|>>?|\\n|\$\(/.test(commandLine)) return true
  return /^(npm|npx|yarn|pnpm)(\s|$)/.test(commandLine.trim())
}
