# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

RilleCode — an AI-powered code editor built on Electron + Monaco + React, with a modular agent system that uses task contracts, verification gates, and evidence-driven completion.

## Commands

```bash
npm run dev          # Start Electron dev (electron-vite dev)
npm run build        # Production build
npm run test         # Run vitest (tests/**/*.test.ts)
npm run typecheck    # Type-check both node and web tsconfigs
```

## Architecture

```
src/
  main/               # Electron main process
    index.ts           #   Window creation, IPC handlers, Git, terminal, SSH/WSL, debug
    agent/             #   AI agent subsystem (see below)
  preload/
    index.ts           #   contextBridge API (window.rille)
  renderer/            # Electron renderer (React)
    App.tsx            #   Root component — layout, menus, workspace state
    components/        #   FileTree, Editor, Tabs, TerminalPanel, AgentPanel, etc.
    main.tsx           #   React entry point
  shared/
    agent/protocol.ts  #   All agent types, events, IPC contracts (~600 lines)
tests/agent/           # Unit tests for each agent module
plan/                  # Design docs (15 docs, module-by-module)
```

## Agent Subsystem (`src/main/agent/`)

The agent is a **single-agent loop** with guardrails, not a multi-agent swarm:

| Module | Role |
|---|---|
| `thread.ts` | `AgentThread` — session lifecycle, turn management, history replay |
| `runtime.ts` | `AgentLoop` — the core loop: build context → call model → execute tools → verify → gate → repeat (max 12 iterations) |
| `contextBuilder.ts` | Assembles context fragments (project rules, git status, open files, diagnostics) into a prompt for the model |
| `tools.ts` | Registered tool definitions (`read_file`, `write_file`, `search`, `command`, `git_*`, etc.) and execution |
| `provider.ts` | Model provider abstraction (OpenAI-compatible protocol) |
| `modelAdapter.ts` | Parses/encodes model output into structured actions (`answer` or `tool_calls`) |
| `permissions.ts` | Policy-based permission engine (allow/ask/deny) with grant tracking and denial detection |
| `verificationGate.ts` | Evidence-driven completion gate — evaluates diagnostics, command output, diffs, runs rule-based review |
| `verifier.ts` | `VerifierRunner` — executes verification commands (typecheck, lint, test, etc.) |
| `taskContract.ts` | Task contract creation and normalization (scope, acceptance criteria, verification plan) |
| `editStore.ts` | File edit proposals as diffs (propose → apply/reject/rollback) |
| `sessionStore.ts` | Persists session metadata and events to disk |
| `workspace.ts` | Workspace abstraction (local / SSH / WSL) for file I/O, commands, and Git |
| `config.ts` | Agent model config persistence and profile management |

**Key flow:** User submits a turn → `AgentThread.submitTurn()` → creates `AgentLoop` → `AgentLoop.run()` iterates: build context, call model, parse output (tool calls or final answer), execute tools with permission checks, run verification gate, optionally repair or review, then emit events back to the renderer.

## IPC Pattern

All renderer↔main communication goes through `contextBridge` in [src/preload/index.ts](src/preload/index.ts). The renderer calls `window.rille.*` methods which invoke IPC channels. Agent-specific IPC uses a typed `AgentOp`/`AgentIpcResult<T>` pattern defined in [src/shared/agent/protocol.ts](src/shared/agent/protocol.ts).

## Key Design Principles (from plan docs)

1. The model reasons and proposes; the system enforces boundaries, executes, verifies, and recovers
2. User requests are translated into Task Contracts before execution
3. File writes go through diff proposals (propose → review → apply), never direct writes from the model
4. Completion is gated by evidence + verification + review, not model self-assessment
5. Permissions are part of the action pipeline, not a final interceptor

## Testing

Tests run in Node with vitest. Each test file under `tests/agent/` corresponds to a module in `src/main/agent/`. Tests import directly from source — no IPC or Electron mocking needed for unit tests.
