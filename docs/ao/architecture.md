# Architecture

## System Overview

```
Human
  │
  ├── ao CLI ──────────────────┐
  │                            │
  └── Web Dashboard ───────────┤
                               ▼
                    ┌──────────────────┐
                    │  Core Services   │
                    │                  │
                    │  SessionManager  │◄── CRUD for sessions
                    │  LifecycleManager│◄── State machine + reaction engine
                    │  PluginRegistry  │◄── Plugin discovery + loading
                    │  Config          │◄── YAML loader + Zod validation
                    │  Metadata        │◄── Flat-file read/write
                    │  Paths           │◄── Hash-based directory structure
                    │  PromptBuilder   │◄── Layered prompt composition
                    └──────┬───────────┘
                           │
              ┌────────────┼────────────────┐
              ▼            ▼                ▼
        ┌──────────┐ ┌──────────┐   ┌──────────────┐
        │ Runtime  │ │  Agent   │   │  Workspace   │
        │ (tmux)   │ │(claude)  │   │ (worktree)   │
        └──────────┘ └──────────┘   └──────────────┘
              │            │                │
              ▼            ▼                ▼
        tmux session   AI process      git worktree
                                       + feature branch
```

## 8 Plugin Slots

Every abstraction is swappable. The system is designed around 8 plugin slots, each with a TypeScript interface defined in `packages/core/src/types.ts`:

| Slot | Interface | Responsibility | Default |
|------|-----------|---------------|---------|
| Runtime | `Runtime` | Where sessions execute (tmux, docker, k8s, process) | tmux |
| Agent | `Agent` | AI coding tool adapter (launch, detect activity, introspect) | claude-code |
| Workspace | `Workspace` | Code isolation (worktree, clone) | worktree |
| Tracker | `Tracker` | Issue tracking (GitHub Issues, Linear, Jira) | github |
| SCM | `SCM` | Source platform (PR/CI/review lifecycle) | github |
| Notifier | `Notifier` | Push notifications (desktop, Slack, webhook) | desktop |
| Terminal | `Terminal` | Human interaction UI (iTerm2 tabs, web terminal) | iterm2 |
| Lifecycle | (core) | State machine + reaction engine | built-in |

## Directory Structure

### Source Layout (pnpm monorepo)

```
packages/
  core/              @composio/ao-core — types, config, services
  cli/               @composio/ao-cli — the `ao` command (Commander.js)
  web/               @composio/ao-web — Next.js 15 dashboard
  integration-tests/ Integration test suite
  plugins/
    runtime-tmux/        Runtime: tmux sessions
    runtime-process/     Runtime: child processes
    agent-claude-code/   Agent: Claude Code CLI
    agent-codex/         Agent: OpenAI Codex
    agent-aider/         Agent: Aider
    agent-opencode/      Agent: OpenCode
    workspace-worktree/  Workspace: git worktrees
    workspace-clone/     Workspace: full clones
    tracker-github/      Tracker: GitHub Issues
    tracker-linear/      Tracker: Linear
    scm-github/          SCM: GitHub PRs/CI/reviews
    notifier-desktop/    Notifier: macOS notifications
    notifier-slack/      Notifier: Slack webhooks
    notifier-composio/   Notifier: Composio platform
    notifier-webhook/    Notifier: generic webhooks
    terminal-iterm2/     Terminal: iTerm2 tabs
    terminal-web/        Terminal: web-based terminal
```

### Runtime Data (on disk, not versioned)

```
~/.agent-orchestrator/
  {hash}-{projectId}/            Hash-based namespacing
    sessions/
      {prefix}-{num}             Flat key=value metadata files
      archive/                   Archived (killed/cleaned) sessions
    worktrees/
      {prefix}-{num}/            Git worktrees for each session
    .origin                      Config path for collision detection
    orchestrator-prompt.md       Generated orchestrator prompt (for ao start)
```

The `{hash}` is `sha256(dirname(configPath)).slice(0, 12)`. This ensures:
- Different checkouts of the orchestrator get separate namespaces
- Projects within the same config share the same hash
- Hash collisions are detected via `.origin` files

## Session Lifecycle

### Spawn Flow

```
ao spawn my-app INT-1234
    │
    ├── 1. Validate issue exists (via Tracker plugin)
    ├── 2. Reserve session ID atomically (O_EXCL file creation)
    ├── 3. Create git worktree (via Workspace plugin)
    │       └── Fetch origin, create feature branch, run postCreate hooks
    ├── 4. Build layered prompt (base + config context + user rules + issue)
    ├── 5. Create tmux session (via Runtime plugin)
    │       └── Launch agent command in detached tmux
    ├── 6. Write metadata file (worktree, branch, status, tmuxName, etc.)
    ├── 7. Run postLaunchSetup (install Claude Code hooks for metadata updates)
    └── 8. Deliver prompt post-launch (via runtime.sendMessage for Claude Code)
```

### State Machine

```
spawning → working → pr_open → review_pending → approved → mergeable → merged
                  │         │                                    │
                  │         ├→ ci_failed (auto-fix) ─────────────┘
                  │         ├→ changes_requested (auto-address) ─┘
                  │         └→ merge.conflicts (auto-rebase) ────┘
                  │
                  ├→ needs_input (notify human)
                  ├→ stuck (notify human)
                  └→ killed / errored / terminated
```

### Lifecycle Polling

The `LifecycleManager` runs a polling loop (default 30s) that:

1. Lists all active sessions
2. For each session, determines current status by:
   - Checking runtime liveness (tmux session alive?)
   - Reading agent JSONL files for activity state
   - Auto-detecting PRs by branch name (for non-Claude agents)
   - Checking PR state, CI status, review decision via SCM plugin
3. Detects state transitions (old status != new status)
4. On transition: updates metadata, triggers reactions, notifies humans
5. Tracks reaction attempts and escalates after configured retries

## Session Naming

Two layers of names serve different purposes:

- **User-facing**: `{prefix}-{num}` (e.g., `int-1`, `ao-3`) — short, readable, used in CLI commands
- **Tmux name**: `{hash}-{prefix}-{num}` (e.g., `a3b4c5d6e7f8-int-1`) — globally unique across multiple orchestrator instances

The prefix is auto-generated from the project directory name:
- `agent-orchestrator` -> `ao` (kebab-case: initials)
- `integrator` -> `int` (single word: first 3 chars)
- `PyTorch` -> `pt` (CamelCase: uppercase letters)
- `api` -> `api` (<=4 chars: as-is)

## Metadata Format

Flat key=value files, one per session, human-readable and bash-compatible:

```
project=integrator
worktree=/Users/dev/.agent-orchestrator/a3b4c5d6e7f8-integrator/worktrees/int-1
branch=feat/INT-1234
status=working
tmuxName=a3b4c5d6e7f8-int-1
pr=https://github.com/org/repo/pull/42
issue=INT-1234
agent=claude-code
createdAt=2026-02-17T10:30:00Z
runtimeHandle={"id":"a3b4c5d6e7f8-int-1","runtimeName":"tmux","data":{}}
```

Writes are atomic (write to `.tmp`, then `rename`). Reads tolerate corruption (malformed lines are skipped). Session ID reservation uses `O_EXCL` flag for concurrency safety.

## Prompt Architecture

Three-layer composition:

1. **Base Agent Prompt** — constant instructions about session lifecycle, git workflow, PR best practices
2. **Config-Derived Context** — project name, repo, default branch, tracker, issue details, reaction rules
3. **User Rules** — inline `agentRules` from config and/or contents of `agentRulesFile`

Returns `null` when there's nothing meaningful to compose (bare launches with no issue), preserving backward compatibility.

For orchestrator sessions (`ao start`), a separate `generateOrchestratorPrompt()` produces a comprehensive guide to available `ao` commands, workflows, and project configuration. This is written to a file (not inlined) to avoid tmux truncation.

## Real-Time Updates

The web dashboard uses Server-Sent Events (SSE) for real-time status updates. The API layer reads metadata files and returns session state, which the frontend polls or streams. Terminal access uses WebSocket connections to tmux sessions.
