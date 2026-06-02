# Windows Compatibility Matrix

## Guaranteed (测试通过 + 手工验证)

| 能力 | 状态 | 备注 |
|------|------|------|
| Agent 会话生命周期 (create/resume/archive/delete) | Guaranteed | |
| 会话列表 (group by project, archive 分组) | Guaranteed | |
| 工具执行 (read_file, write_file via proposal, search, git_status, git_diff) | Guaranteed | shell:true 用于需要 .cmd 的命令 |
| Workspace 文件 I/O (read/write with path normalization) | Guaranteed | 反斜杠自动归一化为正斜杠 |
| 权限引擎 (default/auto_review/full_access + grant store + guardian) | Guaranteed | 默认权限确认编辑应用和高危命令；自动审查自动应用编辑；完全权限自动允许合法操作 |
| PTY 终端 (cmd.exe, PowerShell, Git Bash, WSL) | Guaranteed | node-pty 需要在 Windows 上编译原生模块 |
| Edit proposals + Monaco DiffEditor | Guaranteed | |
| Checkpoint 创建与恢复 | Guaranteed | |
| Git status/diff 工具 | Guaranteed | execFile('git') 绕过 shell |
| Permission approval cards (Allow once/session/workspace/Deny) | Guaranteed | |
| Slash commands (/plan, /fix, /verify) + @file/#selection | Guaranteed | |
| Model streaming (openai-responses protocol) | Guaranteed | |

## Known Limitations (有变通方案)

| 能力 | 限制 | 变通 |
|------|------|------|
| npm/pnpm/yarn 命令执行 | `.cmd` 包装器需要 shell:true | `isShellRequired()` 自动检测并启用 shell |
| 进程信号 | 无 SIGTERM/SIGKILL 语义 | `child.kill()` → Node.js 转译为 TerminateProcess；进程树终止用 taskkill /T |
| Worktree sandbox 清理 | `rmSync` 可能因 git 持有文件句柄而 EBUSY | `rmSyncWithRetry()` 指数退避重试 (最多 5 次) |
| 路径比较 | 驱动器号大小写不敏感 (C:\ vs c:\) | `isPathInside()` 做大小写不敏感比较 |
| 文件行尾 | git worktree 可能检出 CRLF | 内容比较前做 `replace(/\r\n/g, '\n')` 归一化 |
| 终端模拟 | node-pty 需要 node-gyp 编译 | 安装时需 Python + VS Build Tools |
| Git Bash 路径 | 硬编码搜索路径 (Program Files) | 未使用注册表或 %USERPROFILE% 搜索 |
| OpenSSH 路径 | 仅在 System32\OpenSSH 中搜索 | 不搜索 Program Files\OpenSSH 或 Git\usr\bin\ssh.exe |

## Unsupported (无实现计划)

| 能力 | 原因 |
|------|------|
| POSIX signals (SIGSTOP, SIGCONT, SIGUSR1, SIGUSR2) | Windows 无此信号模型 |
| chmod (文件权限位修改) | Windows 文件权限模型不同 |
| Unix domain socket abstract namespace | Windows 不支持 |
| setuid/setgid | Windows 不支持 |
| Windows Sandbox (基于 VM 的隔离) | 过于重量级，worktree + Job Object 对开发工具足够 |
| AppContainer 沙箱 | MVP 暂不引入原生模块依赖 |

## 测试环境

| 项目 | 值 |
|------|-----|
| 操作系统 | Windows 10+ / Windows Server 2019+ |
| Node.js | 22+ |
| Git | 2.40+ (必须在 PATH 中) |
| 终端 | cmd.exe / PowerShell 5.1+ / Git Bash / WSL |
| CI Runner | windows-latest (GitHub Actions) |
