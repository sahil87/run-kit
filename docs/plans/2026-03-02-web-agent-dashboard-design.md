# run-kit v1: Web Agent Dashboard — Design

**Date**: 2026-03-02
**Change**: 260302-fl88-web-agent-dashboard
**Status**: Approved

## Problem

Running multiple Claude Code agent sessions across worktrees and projects is currently a tmux-only workflow. Fab-kit's batch scripts (`batch-fab-new-backlog.sh`, `batch-pipeline.sh`, `dispatch.sh`) orchestrate sessions by creating tmux windows and sending commands via `tmux send-keys`. This works but has no visibility — you need `tmux attach` to see what's happening, no status overview exists, and intervention requires terminal fluency. Fine for 1-3 sessions, unusable at 10+.

## Design Decisions

### Interaction Model: Hybrid

Push-based by default (spawn agents, walk away, get notified via SSE status updates), but with the ability to attach and interact with any session live via embedded terminal. Neither pure dashboard nor pure terminal multiplexer.

**Rejected alternatives:**
- Hands-on dashboard (always watching) — doesn't scale to many sessions
- Pure push-based like AO — loses the ability to intervene quickly

### UI Model: Card + Terminal Drill-In

Session list shows cards with status/progress. Clicking a card opens a full terminal view. Combines overview with deep access.

**Rejected alternatives:**
- Terminal-centric (sidebar + terminal) — poor overview of many sessions
- Split-pane layout (multiple terminals visible) — complex, duplicates tmux itself

### Scope: Start Thin, Grow

v1 is a web UI + session CRUD (create/list/kill tmux sessions + windows). Orchestration features (pipeline dispatch, dependency ordering, confidence gates) added incrementally later.

**Rejected alternatives:**
- Thin wrapper over bash scripts — poor error handling, hard to extend
- Port pipeline logic immediately — over-scoped for v1

### Tech Stack: Next.js 15 + TypeScript

Monolith Next.js 15 app (App Router, Server Components, Tailwind, shadcn/ui). Follows AO's proven stack. Single process for UI + API, separate WebSocket relay on port 3001.

**Rejected alternatives:**
- Hono + htmx — simpler but less ecosystem support for terminal embedding
- Go backend + React SPA — more separation but unnecessary complexity for v1
- Separate API server + Next.js frontend — over-engineered for v1

### Session Model: One Session Per Project

Each project gets one tmux session. Agent work items are windows within that session. Maps naturally to how byobu organizes things.

**Rejected alternatives:**
- One session per agent — worse grouping, harder to overview
- Flexible (both models) — unnecessary complexity

### Terminal: Tmux Directly

Target tmux, not byobu. Byobu is just a tmux wrapper — going direct is simpler integration with identical capabilities.

### Multi-Client: Independent Panes

When two browsers open the same terminal window, each gets its own pane via `tmux split-window`. Original agent pane stays untouched. Pane killed on WebSocket disconnect.

**Rejected alternatives:**
- Shared attach (both see/type same terminal) — accidental input conflicts
- Read-only followers — limits usefulness of second client

### Self-Improvement: Process Supervisor

A bash supervisor (~50 lines) manages the Next.js process. Signal-based restart via `.restart-requested` file. Atomic rollback via `git revert HEAD`. Health check via `GET /api/health`. Tmux sessions fully independent — never affected.

**Rejected alternatives:**
- Blue-green with worktrees — more complex, overkill for single-server
- Simple restart script — no health checking, no automatic rollback

### UI Style: Minimal + Opinionated

Linear/Raycast aesthetic. Dark theme only. Dark gray backgrounds, white text, monospace everywhere. Keyboard-first with `Cmd+K` command palette. No loading spinners (SSE keeps data fresh). shadcn/ui for consistent components.

**Rejected alternatives:**
- Dark theme + AO-style status colors — more visual noise
- Default shadcn/ui look — less opinionated, less cohesive

## Architecture

```
supervisor.sh (bash, always running)
  └── Next.js 15 App (:3000)
        ├── /api/* routes (REST + SSE)
        ├── lib/tmux.ts (tmux operations via execFile)
        ├── lib/worktree.ts (wraps wt-* scripts)
        └── lib/fab.ts (wraps fab-kit commands)
  └── Terminal Relay (:3001)
        └── WebSocket ↔ tmux attach (xterm.js in browser)
  └── tmux server
        ├── session: project-a
        │     ├── window 0: agent (worktree-1)
        │     └── window 1: agent (worktree-2)
        └── session: project-b
              └── window 0: agent (worktree-1)
```

## URL Structure

```
/                          → Dashboard (all projects, all sessions)
/p/:project                → Project view (session cards for one project)
/p/:project/:window        → Terminal view (full-screen xterm.js)
```

Three pages. No settings page. Configuration via `run-kit.yaml` on disk.

## Data Model

No database. State derived at request time:

| Source | Provides |
|--------|----------|
| `tmux list-sessions` | Project sessions |
| `tmux list-windows` | Windows per session, activity timestamps, pane CWDs |
| `.status.yaml` | Fab stage and progress (per worktree) |
| `fab/current` | Active change (per worktree) |

```typescript
type ProjectSession = {
  name: string
  windows: WindowInfo[]
}

type WindowInfo = {
  index: number
  name: string
  worktreePath: string
  activity: "active" | "idle" | "exited"
  fabStage?: string
  fabProgress?: string
}
```

SSE endpoint (`/api/sessions/stream`) polls tmux every 2-3 seconds and pushes diffs.

## Keyboard Shortcuts

| Key | Context | Action |
|-----|---------|--------|
| `j` / `k` | Dashboard, Project | Navigate cards |
| `Enter` | Dashboard, Project | Open terminal view |
| `/` | Dashboard, Project | Filter |
| `n` | Dashboard, Project | Create new window |
| `c` | Project | Create window |
| `x` | Project | Kill window (with confirmation) |
| `s` | Project | Send message to agent |
| `Cmd+K` | Global | Command palette |
| `Esc Esc` | Terminal | Back to project view |

## Configuration

```yaml
# run-kit.yaml
projects:
  my-app:
    path: ~/code/my-app
    session_prefix: ma
    fab_kit: true
```

## Project Structure

```
src/
  app/
    page.tsx                    # Dashboard
    p/[project]/
      page.tsx                  # Project view
      [window]/
        page.tsx                # Terminal view
    api/
      sessions/
        route.ts                # REST: list sessions
        stream/
          route.ts              # SSE: live updates
      health/
        route.ts                # Health check
  lib/
    tmux.ts                     # tmux operations (execFile)
    worktree.ts                 # wt-* script wrappers
    fab.ts                      # fab-kit command wrappers
    config.ts                   # run-kit.yaml loader
  components/
    session-card.tsx            # Window card component
    terminal.tsx                # xterm.js wrapper
    command-palette.tsx         # Cmd+K palette
  terminal-relay/
    server.ts                   # WebSocket ↔ tmux (port 3001)
supervisor.sh                   # Bash process supervisor
run-kit.yaml                    # Project configuration
```

## Dependencies

| Package | Purpose |
|---------|---------|
| next@15 | App framework |
| tailwindcss | Styling |
| shadcn/ui (radix-ui) | Component library |
| xterm.js + xterm-addon-fit | Browser terminal |
| ws | WebSocket server (terminal relay) |
| yaml | Config parsing |
| zod | Config validation |

## Runtime Requirements

- Node.js 20+
- pnpm
- tmux
- fab-kit (`wt-*` scripts on PATH)

## Self-Improvement Loop

```
Agent commits changes → touch .restart-requested
  → Supervisor detects signal
  → pnpm build
  → Build OK? → Kill old server, start new, health check
    → Health OK? → Done
    → Health fail? → git revert HEAD, rebuild, restart old
  → Build fail? → git revert HEAD, rebuild, restart old
  → Tmux sessions unaffected throughout
```

## Key Constraints (from Constitution)

1. `execFile` only — never `exec` or shell template strings
2. No database — derive everything from tmux + filesystem
3. Wrap fab-kit utilities — don't reimplement
4. Three routes maximum — resist page creep
5. Keyboard-first — every action reachable via keyboard
6. Tmux independent of server — sessions survive restarts
