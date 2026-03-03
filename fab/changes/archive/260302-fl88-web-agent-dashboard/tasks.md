# Tasks: Web-Based Agent Orchestration Dashboard

**Change**: 260302-fl88-web-agent-dashboard
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Initialize Next.js 15 project with TypeScript strict mode, Tailwind CSS, and App Router in `src/`. Set up `package.json` with pnpm, `tsconfig.json` (strict), `next.config.ts`, and directory structure matching intake layout (`src/app/`, `src/lib/`, `src/components/`, `src/hooks/`, `src/terminal-relay/`)
- [x] T002 Configure dark theme and shadcn/ui. Set up Tailwind config with spec colors (`#111` primary bg, `#1a1a1a` card bg, `#fff`/`#888` text, `#333` borders). Install shadcn/ui (Radix + Tailwind). Set monospace font as default. Create `src/app/globals.css` and `src/app/layout.tsx` with dark-only root styling
- [x] T003 Define shared TypeScript types in `src/lib/types.ts`: `ProjectSession`, `WindowInfo` (activity: `"active" | "idle"`), `Config` (projects map with path + fab_kit), `TmuxExecOptions`

## Phase 2: Core Backend

- [x] T004 Implement `src/lib/config.ts` — load and validate `run-kit.yaml` from repo root using `yaml` package. Parse projects map, derive project IDs from config keys. Throw descriptive error on missing/malformed file. Export typed `loadConfig()` and `getConfig()` (cached singleton). Create sample `run-kit.yaml` at repo root
- [x] T005 Implement `src/lib/tmux.ts` — all tmux operations using `execFile` with argument arrays and timeout options (5-10s for tmux ops). Functions: `listSessions()` (returns `[]` if tmux not running), `listWindows(session)` (parse format string, derive activity from 10s `window_activity` threshold), `createSession(name)`, `createWindow(session, name, cwd)`, `killWindow(session, index)`, `sendKeys(session, window, keys)`, `splitPane(session, window)` (returns pane ID), `killPane(paneId)`, `capturePane(paneId, lines)`
- [x] T006 [P] Implement `src/lib/worktree.ts` — typed async wrappers around fab-kit `wt-*` scripts via `execFile`. Functions: `create(name, branch?)`, `list()`, `delete(name)`, `open(name)`
- [x] T007 [P] Implement `src/lib/fab.ts` — fab state reading via `execFile`. Functions: `getStatus(worktreePath)` (invokes `statusman.sh progress-line`), `getCurrentChange(worktreePath)` (reads `fab/current` file), `listChanges(worktreePath)` (invokes `changeman.sh list`). Return `null` gracefully when no fab state exists

## Phase 3: API Layer

- [x] T008 Implement `src/app/api/health/route.ts` — `GET` handler returning `200 { "status": "ok" }`
- [x] T009 Implement `src/app/api/sessions/route.ts` — `GET` handler that calls `listSessions()` + `listWindows()`, maps sessions to configured projects by exact name match, groups unmatched sessions under `"Other"`, enriches windows with fab state from `getStatus()`/`getCurrentChange()` where `fab_kit: true`. Returns `ProjectSession[]` JSON
- [x] T010 Implement `src/app/api/sessions/stream/route.ts` — SSE endpoint. Poll tmux state every 2-3 seconds via the same logic as T009. Compare each snapshot to the previous (JSON deep equality). Emit full `ProjectSession[]` snapshot only on change. Handle client disconnection gracefully (stop polling interval, no thrown errors)

## Phase 4: UI Components & Hooks

- [x] T011 [P] Create `src/components/session-card.tsx` — Client Component displaying window name, worktree path, activity status (active/idle indicator), and optional fab stage badge (e.g., "apply 4/6"). Accepts `WindowInfo` + `projectName` props. Click handler for navigation. Supports focus state for keyboard nav (highlighted border)
- [x] T012 [P] Create `src/components/command-palette.tsx` — Client Component. `Cmd+K` opens modal overlay with text input. Fuzzy search over registered actions. Actions include: navigate to project, open terminal, create window, kill window, send message. Each action has label, shortcut hint, and handler. Esc to close
- [x] T013 [P] Create `src/hooks/use-keyboard-nav.ts` — custom hook for card-based keyboard navigation. `j`/`k` moves focus index, `Enter` triggers action on focused item, `/` opens filter. Tracks focused index in state. Returns `{ focusedIndex, setFocusedIndex, onKeyDown }`. Disables when text inputs are focused
- [x] T014 [P] Create `src/hooks/use-sessions.ts` — SSE consumer hook. Connects to `/api/sessions/stream`, replaces entire `ProjectSession[]` state on each event. Handles reconnection on disconnect. Returns `{ sessions, isConnected }`

## Phase 5: Pages

- [x] T015 Implement Dashboard page (`src/app/page.tsx`) — Server Component shell fetching initial data from `/api/sessions`, passing to Client Component wrapper. Client component consumes `use-sessions` hook for live updates. Renders project sections (grouped by config key + "Other"), each with a grid of `SessionCard` components. Empty state when no sessions. Keyboard shortcuts: `j`/`k` navigation, `Enter` to drill in, `c` to create session, `Cmd+K` for palette
- [x] T016 Implement Project view (`src/app/p/[project]/page.tsx`) — Similar structure to dashboard but scoped to one project. Actions: `n` creates new window (dialog for name + optional worktree/branch), `x` kills focused window (confirmation dialog), `s` sends message to agent (text input). Calls `lib/tmux.ts` functions via server actions or API calls
- [x] T017 Implement Terminal view (`src/app/p/[project]/[window]/page.tsx`) — Client Component with xterm.js. On mount: establish WebSocket to `ws://localhost:3001/{project}/{window}`. Relay I/O between xterm.js and WebSocket. Minimal top bar: window name, worktree path, back button. `Esc Esc` (double-escape) navigates back and triggers pane cleanup. Handle terminal resize (sync xterm.js dimensions to tmux pane via relay)

## Phase 6: Terminal Relay

- [x] T018 Implement terminal relay (`src/terminal-relay/server.ts`) — standalone Node.js WebSocket server on port 3001 using `ws` package. Parse `/:session/:window` from URL path. On connection: validate path, call `splitPane(session, window)` to create independent pane, relay stdin/stdout between WebSocket and pane. On disconnect (`close`/error): call `killPane(paneId)`. Ping/pong for stale connection detection. Log errors, never throw unhandled. Add `package.json` script entry for running relay independently

## Phase 7: Supervisor

- [x] T019 Implement `supervisor.sh` (~50 lines bash). Polling loop checking for `.restart-requested` file. On detection: `pnpm build`, kill Next.js PID + relay PID, start both, poll `GET /api/health` (up to 10s). On build or health failure: `git revert HEAD`, rebuild, restart prior version. Remove `.restart-requested` on success. Store PIDs in variables for clean kill. Never touch tmux sessions

## Phase 8: Polish

- [x] T020 Create `run-kit.yaml` example config at repo root with sample project entry. Add `start` script to `package.json` that launches supervisor.sh. Verify full flow: supervisor starts Next.js + relay, dashboard loads, SSE streams, terminal view connects

---

## Execution Order

- T001 blocks all subsequent tasks
- T002, T003 depend on T001 but are independent of each other
- T004, T005 depend on T003 (types). T005 is the critical path — T006, T007 are parallel to each other but also depend on T003
- T008 depends on T004 (config for context, though minimal)
- T009 depends on T004, T005, T007 (config + tmux + fab)
- T010 depends on T009 (reuses session-fetching logic)
- T011-T014 depend on T003 (types) but are parallel to each other
- T015 depends on T010, T011, T013, T014
- T016 depends on T011, T013, T014, T005 (tmux actions)
- T017 depends on T018 (needs relay running), T011
- T018 depends on T005 (pane operations)
- T019 depends on T008 (health endpoint)
- T020 depends on all prior tasks
