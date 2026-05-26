import { type ChildProcess, execFileSync, spawn } from 'child_process'
import { mkdtempSync, writeFileSync } from 'fs'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPathInside, isShellRequired, killProcess, killProcessTree, normalizePathSep, rmSyncWithRetry, shellQuote } from '../../src/main/agent/platform'

describe('shellQuote', () => {
  it('quotes paths with spaces', () => {
    const result = shellQuote('C:\\Program Files\\app')
    if (process.platform === 'win32') {
      expect(result).toBe('"C:\\Program Files\\app"')
    } else {
      expect(result).toBe("'C:\\Program Files\\app'")
    }
  })

  it('escapes internal quotes', () => {
    if (process.platform === 'win32') {
      expect(shellQuote('he said "hello"')).toBe('"he said ""hello"""')
    } else {
      expect(shellQuote("he said 'hello'")).toBe("'he said '\\''hello'\\'''")
    }
  })

  it('returns plain strings without extra quoting', () => {
    const result = shellQuote('simple')
    if (process.platform === 'win32') {
      expect(result).toBe('"simple"')
    } else {
      expect(result).toBe("'simple'")
    }
  })
})

describe('rmSyncWithRetry', () => {
  it('removes an existing directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rille-platform-rm-'))
    writeFileSync(join(dir, 'test.txt'), 'hello', 'utf8')
    rmSyncWithRetry(dir)
    const { existsSync } = require('fs')
    expect(existsSync(dir)).toBe(false)
  })

  it('does not throw for non-existent paths', () => {
    expect(() => rmSyncWithRetry(join(tmpdir(), 'nonexistent-' + Date.now()))).not.toThrow()
  })
})

describe('killProcess', () => {
  it('kills a child process', () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { windowsHide: true })
    expect(child.killed).toBe(false)
    killProcess(child)
    // On Windows, kill is synchronous; on POSIX, SIGTERM is async
    if (process.platform === 'win32') {
      expect(child.killed).toBe(true)
    }
  })
})

describe('killProcessTree', () => {
  it('does not throw for a non-existent pid', () => {
    expect(() => killProcessTree(99999)).not.toThrow()
  })
})

describe('normalizePathSep', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePathSep('C:\\Users\\test\\src')).toBe('C:/Users/test/src')
  })

  it('preserves forward slashes', () => {
    expect(normalizePathSep('C:/Users/test/src')).toBe('C:/Users/test/src')
  })

  it('handles mixed separators', () => {
    expect(normalizePathSep('C:\\Users/test\\src')).toBe('C:/Users/test/src')
  })

  it('does nothing on posix paths', () => {
    expect(normalizePathSep('/home/user/src')).toBe('/home/user/src')
  })
})

describe('isPathInside', () => {
  it('returns true when child is inside parent', () => {
    expect(isPathInside('C:\\Users\\test', 'C:\\Users\\test\\src\\index.ts')).toBe(true)
    expect(isPathInside('/home/user', '/home/user/src/index.ts')).toBe(true)
  })

  it('is case-insensitive for drive letters on Windows', () => {
    if (process.platform === 'win32') {
      expect(isPathInside('C:\\Users\\test', 'c:\\Users\\test\\src')).toBe(true)
    }
  })

  it('rejects paths on different drives', () => {
    expect(isPathInside('C:\\Users\\test', 'D:\\other')).toBe(false)
  })

  it('rejects traversal attempts', () => {
    expect(isPathInside('C:\\Users\\test', 'C:\\Users\\test\\..\\Windows')).toBe(false)
    expect(isPathInside('/home/user', '/home/user/../../../etc')).toBe(false)
  })

  it('handles trailing slash on parent', () => {
    expect(isPathInside('/home/user/', '/home/user/src')).toBe(true)
  })
})

describe('isShellRequired', () => {
  it('detects shell operators', () => {
    expect(isShellRequired('echo hello | grep world')).toBe(true)
    expect(isShellRequired('cmd1 && cmd2')).toBe(true)
    expect(isShellRequired('cmd1 > file.txt')).toBe(true)
    expect(isShellRequired('cmd1 < input.txt')).toBe(true)
    expect(isShellRequired('$(pwd)')).toBe(true)
    expect(isShellRequired('cmd1 `echo test`')).toBe(true)
  })

  it('detects npm-related commands', () => {
    expect(isShellRequired('npm install')).toBe(true)
    expect(isShellRequired('npm run test')).toBe(true)
    expect(isShellRequired('npx vitest')).toBe(true)
    expect(isShellRequired('yarn build')).toBe(true)
    expect(isShellRequired('pnpm install')).toBe(true)
  })

  it('returns false for simple commands', () => {
    expect(isShellRequired('git status')).toBe(false)
    expect(isShellRequired('node script.js')).toBe(false)
  })

  it('detects shell metacharacters even when quoted', () => {
    // Parentheses are shell metacharacters (subshell) regardless of quoting
    expect(isShellRequired('python -c "print(1)"')).toBe(true)
  })
})
