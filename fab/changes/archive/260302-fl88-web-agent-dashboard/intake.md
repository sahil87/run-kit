# Intake: Web-Based Agent Orchestration Dashboard

**Change**: 260302-fl88-web-agent-dashboard
**Created**: 2026-03-02
**Status**: Draft

## Origin

> run-kit v1: Web-based agent orchestration dashboard. Next.js 15 + TypeScript monolith with bash process supervisor and WebSocket terminal relay. Three-page UI (dashboard, project view, terminal view) with minimal dark theme, shadcn/ui, keyboard-first design. One tmux session per project, windows per agent/worktree. State derived from tmux server + filesystem (no database). SSE for live updates. Self-improvement loop via signal-based restart with git revert rollback. Wraps existing fab-kit utilities (wt-*, idea, fab-* commands). Terminal relay on separate port, independent panes per browser client. Config via run-kit.yaml.

This was a conversational brainstorming session (`/fab-discuss` → brainstorming) that explored the AO spec suite (`docs/ao/`), fab-kit batch scripts (`batch-pipeline.sh`, `batch-fab-new-backlog.sh`, `dispatch.sh`, etc.), and the short-term goal (`docs/specs/short-term-goal.md`). The user made explicit choices at every decision point via structured questions. All decisions below are grounded in those explicit choices.

## Why

run-kit exists to solve the coordination problem of running multiple Claude Code agent sessions across different worktrees and projects. Currently, fab-kit's batch scripts (`batch-fab-new-backlog.sh`, `batch-fab-switch-change.sh`, `batch-pipeline.sh`) orchestrate agent sessions by creating tmux windows and sending commands via `tmux send-keys`. This works but has no visibility layer — you need to manually `tmux attach` to see what's happening, there's no status overview, and intervention requires terminal fluency.

The AO project (documented in `docs/ao/`) solves this at enterprise scale with 8 plugin slots, a lifecycle state machine, and a full Next.js dashboard. run-kit takes a different approach: start thin with a web UI over tmux + fab-kit, and grow orchestration features incrementally.

If we don't build this, agent session management remains a tmux-only workflow — fine for 1-3 sessions, unusable when running 10+ agents across multiple projects.

## What Changes

This is a greenfield implementation. The `src/` directory is currently empty.

### Architecture Overview

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
        ├── session: project-a (window 0: agent/wt-1, window 1: agent/wt-2)
        └── session: project-b (window 0: agent/wt-1)
```

### Next.js 15 Application

**Stack**: Next.js 15 (App Router), TypeScript (strict), Tailwind CSS, shadcn/ui (Radix + Tailwind).

**Three pages only:**

1. **Dashboard (`/`)** — All projects, all sessions at a glance. Projects as sections, each showing tmux windows as compact cards. Cards display: window name, worktree path, fab stage (if active change), activity status (active/idle/exited).

2. **Project view (`/p/:project`)** — Focused view of one project's windows. Same cards with more room. Actions: create window (spawns worktree + Claude session), kill window, send message to agent.

3. **Terminal view (`/p/:project/:window`)** — Full-screen xterm.js. WebSocket connection to that tmux window. Minimal chrome — top bar with window name, worktree path, back button.

**Keyboard navigation:**
- `j`/`k` to navigate cards
- `Enter` to drill into terminal view
- `/` to filter
- `n` to create new window
- `c` to create, `x` to kill (with confirmation), `s` to send message
- `Cmd+K` for global command palette
- `Esc Esc` (double-escape) in terminal view to go back

**UI style:** Minimal + opinionated (Linear/Raycast vibe). Dark theme only. Dark gray backgrounds (`#111`, `#1a1a1a`), white text. Monospace font everywhere. Information-dense without clutter. No loading spinners — SSE keeps data fresh, optimistic UI for actions.

### Backend Libraries

**`lib/tmux.ts`** — All tmux interaction. Uses `execFile` exclusively (never `exec`, per AO's security pattern). Operations:
- `listSessions()` — `tmux list-sessions -F '#{session_name}'`
- `listWindows(session)` — `tmux list-windows -t <session> -F '#{window_index}:#{window_name}:#{pane_current_path}:#{window_activity}'`
- `createSession(name)` — `tmux new-session -d -s <name>`
- `createWindow(session, name, cwd)` — `tmux new-window -t <session> -n <name> -c <cwd>`
- `killWindow(session, index)` — `tmux kill-window -t <session>:<index>`
- `sendKeys(session, window, keys)` — `tmux send-keys -t <session>:<window> <keys> Enter`
- `splitPane(session, window)` — for independent browser panes
- `killPane(paneId)` — cleanup on WebSocket disconnect
- `capturePane(paneId, lines)` — for status snapshots

**`lib/worktree.ts`** — Wraps existing fab-kit `wt-*` scripts:
- `create(name, branch?)` — calls `wt-create --non-interactive --worktree-name <name> [branch]`
- `list()` — calls `wt-list`
- `delete(name)` — calls `wt-delete <name>`
- `open(name)` — calls `wt-open <name>`

**`lib/fab.ts`** — Wraps fab-kit commands for backlog and agent dispatch:
- `getStatus(worktreePath)` — reads `.status.yaml` via `statusman.sh progress-line`
- `getCurrentChange(worktreePath)` — reads `fab/current`
- `listChanges(worktreePath)` — calls `changeman.sh list`

### Data Model

No database. State is derived at request time from two sources:

1. **tmux server** — `tmux list-sessions`, `tmux list-windows` provide live truth about running sessions.
2. **Worktree filesystem** — `fab/changes/<name>/.status.yaml` provides fab stage/progress. `fab/current` provides active change.

```typescript
type ProjectSession = {
  name: string              // tmux session name
  windows: WindowInfo[]
}

type WindowInfo = {
  index: number             // tmux window index
  name: string              // window name (= change ID or label)
  worktreePath: string      // from tmux pane CWD
  activity: "active" | "idle" | "exited"  // from tmux last-activity
  fabStage?: string         // from .status.yaml if fab change active
  fabProgress?: string      // from statusman.sh progress-line
}
```

**SSE endpoint** (`/api/sessions/stream`): Polls tmux state every 2-3 seconds and pushes diffs to connected clients.

### Terminal Relay

Runs on port 3001, separate from the Next.js app. WebSocket connections bridge browser xterm.js to tmux sessions.

**Multi-client behavior**: Each browser connection creates an **independent pane** via `tmux split-window` in the target window. The original agent pane (pane 0) stays untouched. On WebSocket disconnect, the pane is killed (`tmux kill-pane`).

### Configuration

Single `run-kit.yaml` in repo root:

```yaml
projects:
  my-app:
    path: ~/code/my-app
    session_prefix: ma
    fab_kit: true
```

Minimal config — project paths and preferences. Everything else derived (convention over configuration).

### Self-Improvement Loop

A bash supervisor (`supervisor.sh`, ~50 lines) manages the Next.js process:

1. Agent commits code changes to run-kit repo
2. Agent signals restart: `touch .restart-requested`
3. Supervisor detects signal file (polling loop)
4. Supervisor runs: `pnpm build`
5. Build succeeds → kill old Next.js, start new, wait for `GET /api/health` (200 within 10s)
6. Health OK → done, remove `.restart-requested`
7. Build or health fails → `git revert HEAD`, rebuild, restart prior version
8. Tmux sessions are fully independent — never affected by server restarts

### Project Setup (pnpm monorepo)

```
src/
  app/                    # Next.js App Router pages
    page.tsx              # Dashboard (/)
    p/[project]/
      page.tsx            # Project view
      [window]/
        page.tsx          # Terminal view
    api/
      sessions/
        route.ts          # REST: list sessions
        stream/
          route.ts        # SSE: live updates
      health/
        route.ts          # Health check endpoint
  lib/
    tmux.ts               # tmux operations
    worktree.ts           # wt-* wrappers
    fab.ts                # fab-kit wrappers
    config.ts             # run-kit.yaml loader
  components/
    session-card.tsx      # Window card component
    terminal.tsx          # xterm.js wrapper
    command-palette.tsx   # Cmd+K palette
  terminal-relay/
    server.ts             # WebSocket ↔ tmux relay (port 3001)
supervisor.sh             # Bash process supervisor
run-kit.yaml              # Project configuration
```

## Affected Memory

- `run-kit/architecture`: (new) System architecture, component responsibilities, data flow
- `run-kit/ui-patterns`: (new) URL structure, keyboard shortcuts, component conventions

## Impact

- **New codebase**: Entire `src/` directory created from scratch
- **Dependencies**: Next.js 15, tailwindcss, shadcn/ui, xterm.js, ws (WebSocket), yaml (config parsing)
- **Runtime dependencies**: tmux, Node.js 20+, pnpm, fab-kit (wt-* scripts on PATH)
- **Ports**: 3000 (Next.js), 3001 (terminal relay)

## Open Questions

- None — all major decisions were resolved during the brainstorming session.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Hybrid interaction model — push-based default with live attach capability | Discussed — user explicitly chose "Hybrid" over hands-on and push-only | S:95 R:85 A:90 D:90 |
| 2 | Certain | Card + terminal drill-in UI pattern | Discussed — user chose over terminal-centric and split-pane layouts | S:95 R:80 A:85 D:90 |
| 3 | Certain | Start thin, grow — v1 is web UI + session CRUD, orchestration later | Discussed — user chose over thin wrapper and porting pipeline logic | S:95 R:90 A:85 D:90 |
| 4 | Certain | Next.js 15 + TypeScript tech stack | Discussed — user chose over Hono+htmx and Go+React | S:95 R:70 A:90 D:90 |
| 5 | Certain | Target tmux directly, not byobu | Discussed — user chose "Tmux is fine" | S:90 R:90 A:90 D:95 |
| 6 | Certain | One tmux session per project, windows per agent/worktree | Discussed — user chose over per-agent sessions and flexible model | S:95 R:75 A:85 D:85 |
| 7 | Certain | Monolith Next.js app with clean lib/ extraction | Discussed — user confirmed Approach A over separate API server and bash-wrapper | S:90 R:80 A:85 D:85 |
| 8 | Certain | Three routes: /, /p/:project, /p/:project/:window | Discussed — user approved URL structure | S:95 R:90 A:90 D:95 |
| 9 | Certain | No database — state derived from tmux + filesystem | Discussed — user approved data model | S:95 R:85 A:90 D:95 |
| 10 | Certain | Process supervisor for self-improvement loop | Discussed — user chose over blue-green worktrees and simple script | S:90 R:75 A:80 D:85 |
| 11 | Certain | Independent panes per browser client for multi-attach | Discussed — user chose over shared tmux and read-only followers | S:90 R:70 A:75 D:80 |
| 12 | Certain | Minimal + opinionated UI (Linear/Raycast vibe) | Discussed — user chose over dark+status-colors and shadcn-default | S:95 R:85 A:85 D:90 |
| 13 | Confident | shadcn/ui as component library | Proposed in UI section, user approved full design. Could swap to another Radix wrapper | S:80 R:85 A:80 D:75 |
| 14 | Confident | Dark theme only, monospace aesthetic | Part of approved UI design. Could add light mode later | S:80 R:90 A:80 D:80 |
| 15 | Confident | Keyboard-first with Cmd+K command palette | Part of approved UI design. Specific shortcuts may evolve | S:80 R:90 A:80 D:75 |
| 16 | Confident | SSE polling tmux every 2-3 seconds for live updates | Part of approved data model. Interval is tunable | S:75 R:90 A:80 D:80 |
| 17 | Confident | WebSocket terminal relay on port 3001 | Part of approved architecture. Port number is convention | S:75 R:90 A:85 D:80 |

17 assumptions (12 certain, 5 confident, 0 tentative, 0 unresolved).
