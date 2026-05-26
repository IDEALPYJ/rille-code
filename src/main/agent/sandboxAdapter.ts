import type { SpawnOptions } from 'child_process'
import type { SandboxConstraints } from '../../shared/agent/protocol'

export interface SandboxAdapter {
  readonly platform: string
  readonly available: boolean

  constrainProcess(opts: { network?: boolean; filesystem?: boolean }): Partial<SpawnOptions>
  describe(): SandboxConstraints
}

class SandboxAdapterWindows implements SandboxAdapter {
  readonly platform = 'windows_job_object'
  readonly available = true

  constrainProcess(opts: { network?: boolean; filesystem?: boolean }): Partial<SpawnOptions> {
    const result: Partial<SpawnOptions> = { windowsHide: true }
    if (opts.network === false) {
      result.env = {
        ...process.env,
        http_proxy: '',
        https_proxy: '',
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        no_proxy: '*',
        NO_PROXY: '*',
        NODE_EXTRA_CA_CERTS: '',
      }
    }
    return result
  }

  describe(): SandboxConstraints {
    return {
      filesystem: 'worktree_only',
      network: 'allow',
      platform: 'windows_job_object',
      active: true,
    }
  }
}

class SandboxAdapterPosix implements SandboxAdapter {
  readonly platform = process.platform
  readonly available = false

  constrainProcess(_opts: { network?: boolean; filesystem?: boolean }): Partial<SpawnOptions> {
    return { windowsHide: true }
  }

  describe(): SandboxConstraints {
    return {
      filesystem: 'worktree_only',
      network: 'allow',
      platform: 'none',
      active: false,
    }
  }
}

export function createSandboxAdapter(): SandboxAdapter {
  if (process.platform === 'win32') return new SandboxAdapterWindows()
  return new SandboxAdapterPosix()
}
