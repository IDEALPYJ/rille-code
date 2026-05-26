# Windows Manual Acceptance Checklist

## Prerequisites

- [ ] Node.js 22+ installed
- [ ] Git 2.40+ installed and in PATH
- [ ] `npm ci` completes without errors
- [ ] `npx vitest run tests/agent/` passes (all 214 tests)

## 1. App Launch

- [ ] `npm run dev` starts the Electron app without errors
- [ ] App window appears and renders the IDE workbench
- [ ] No console errors in DevTools

## 2. Terminal Integration

- [ ] cmd.exe terminal profile is detected and functional
- [ ] PowerShell terminal profile is detected and functional
- [ ] Git Bash terminal profile is detected (if installed)
- [ ] WSL terminal profiles are detected (if WSL installed)

## 3. Agent Workspace Operations

- [ ] Open a git project folder
- [ ] Create a new agent session
- [ ] Agent correctly shows workspace context (git status, open files)

## 4. Agent Command Execution

- [ ] `git status` tool returns correct output
- [ ] `npm test` executes correctly (shell:true for .cmd wrapper)
- [ ] Command with shell operators (`echo hello | findstr hello`) works
- [ ] Command timeout is handled gracefully

## 5. Sandbox Lifecycle

- [ ] Create sandbox from a git workspace (status becomes `ready`)
- [ ] Sandbox diff returns changed files
- [ ] Dispose sandbox cleans up correctly (no EBUSY errors)
- [ ] Sandbox creation in non-git workspace returns `failed` status

## 6. Permission Approval Flow

- [ ] `ask` mode: command execution requests user approval
- [ ] Allow once works for single command
- [ ] Allow session persists for the session duration
- [ ] Deny properly blocks command execution
- [ ] Plan mode restricts file writes

## 7. PTY Terminal Interaction

- [ ] Terminal opens with correct shell (cmd.exe default on Windows)
- [ ] Commands execute and output is displayed
- [ ] Terminal resize works correctly
- [ ] ANSI color codes render correctly

## 8. File Editing and Diff

- [ ] Agent proposes file edit via diff
- [ ] Diff modal shows Monaco DiffEditor with correct highlighting
- [ ] Apply applies the change to the file
- [ ] Reject discards the change
- [ ] Rollback restores original content

## 9. Error Scenarios

- [ ] Non-git workspace: sandbox creation shows actionable error
- [ ] Command timeout: error is displayed without crash
- [ ] Permission denied: command is blocked, session continues
- [ ] Session resume: previous session state is restored correctly

## 10. Cleanup

- [ ] Close the app — no orphaned processes remain (check Task Manager)
- [ ] Temp directories from test runs are cleaned up
