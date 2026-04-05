# Tasks: tmux Server Switcher

**Change**: 260320-1335-tmux-server-switcher
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Backend tmux Layer Refactor

- [x] T001 Unify `tmuxExec`/`tmuxExecDefault` into `tmuxExecServer(server string, args ...string)` and replace `runkitPrefix()` with `serverArgs(server string)` in `app/backend/internal/tmux/tmux.go`. `serverArgs("default")` returns empty slice; any other name returns `["-L", name]`. Config flag `-f` applied to all named servers.
- [x] T002 Update `ListSessions(server string)` to query only the specified server. Remove the dual-query merge logic and the `SessionInfo.Server` field in `app/backend/internal/tmux/tmux.go`.
- [x] T003 [P] Update `ListWindows`, `CreateSession`, `KillSession`, `RenameSession`, `CreateWindow`, `KillWindow`, `RenameWindow`, `SendKeys` to accept `server string` parameter. Rename `SelectWindowOnServer` to `SelectWindow`. All use `tmuxExecServer`. In `app/backend/internal/tmux/tmux.go`.
- [x] T004 [P] Add `ListServers() ([]string, error)` function to `app/backend/internal/tmux/tmux.go` — scan `/tmp/tmux-{uid}/` for socket files, return sorted server names.
- [x] T005 [P] Add `KillServer(server string) error` function to `app/backend/internal/tmux/tmux.go` — run `tmux [-L server] kill-server`.
- [x] T006 Remove `tmuxExecDefault()` and the `parseSessions()` server-tagging logic. Remove `SessionInfo.Server` field. Clean up dead code in `app/backend/internal/tmux/tmux.go`.

## Phase 2: Backend API Layer

- [x] T007 Add `serverFromRequest(r *http.Request) string` helper in `app/backend/api/router.go` — extracts `?server=` query param, defaults to `"default"`.
- [x] T008 Update `handleSessionsList`, `handleSessionCreate`, `handleSessionKill`, `handleSessionRename` in `app/backend/api/sessions.go` to use `serverFromRequest()` and pass server to tmux functions.
- [x] T009 [P] Update `handleWindowCreate`, `handleWindowKill`, `handleWindowRename`, `handleWindowKeys`, `handleWindowSelect` in `app/backend/api/windows.go` (or wherever they live) to use `serverFromRequest()`.
- [x] T010 [P] Update `handleRelay` in `app/backend/api/relay.go` — replace hardcoded `"runkit"` default with `serverFromRequest()` defaulting to `"default"`.
- [x] T011 [P] Update `handleTmuxReloadConfig` in `app/backend/api/tmux_config.go` — read server from `?server=` param (or body) via `serverFromRequest()`.
- [x] T012 Update `handleSSE` in `app/backend/api/sse.go` — read `?server=` from request, pass to session fetching. Update `sseHub` to support per-server polling (poll only servers with active clients, route data to appropriate clients).
- [x] T013 Add `handleServersList` (`GET /api/servers`) endpoint in new file `app/backend/api/servers.go` — calls `tmux.ListServers()`, returns JSON array.
- [x] T014 [P] Add `handleServerCreate` (`POST /api/servers`) endpoint in `app/backend/api/servers.go` — validate name (alphanumeric/hyphens/underscores, non-empty), call `tmux.CreateSession("0", os.UserHomeDir(), name)`.
- [x] T015 [P] Add `handleServerKill` (`POST /api/servers/kill`) endpoint in `app/backend/api/servers.go` — call `tmux.KillServer(name)`.
- [x] T016 Register new routes in `app/backend/api/router.go`: `GET /api/servers`, `POST /api/servers`, `POST /api/servers/kill`.
- [x] T017 Remove `ProjectSession.Server` field from `app/backend/internal/sessions/sessions.go`. Update `FetchSessions()` to accept `server string` and pass it to `tmux.ListSessions(server)`.
- [x] T018 Update `TmuxOps` interface in `app/backend/api/router.go` to match new function signatures (server params on all methods, add `ListServers`, `KillServer`).

## Phase 3: Frontend Changes

- [x] T019 Remove `server` field from `ProjectSession` type in `app/frontend/src/types.ts`.
- [x] T020 Add server state management to `SessionProvider` in `app/frontend/src/contexts/session-context.tsx` — `server` (from localStorage `"runkit-server"`, default `"runkit"`), `setServer()`, `servers[]`, `refreshServers()`. SSE EventSource URL includes `?server=`. Reconnects on server change.
- [x] T021 Add API functions in `app/frontend/src/api/client.ts`: `listServers()`, `createServer(name)`, `killServer(name)`. Add `getServer()/setServerGetter()` module-level mechanism so all fetch calls append `?server=`. Remove explicit `server` param from `selectWindow()` and `reloadTmuxConfig()`.
- [x] T022 Add server selector component at sidebar bottom in `app/frontend/src/components/sidebar.tsx` — pinned footer with `border-t`, dropdown showing available servers, current highlighted. Remove `↗` server marker from session rows. Make session tree area scrollable above the pinned footer.
- [x] T023 Add "Create tmux server", "Kill tmux server", "Switch tmux server" commands to command palette in `app/frontend/src/app.tsx`. Create server opens dialog (name input, validation). Kill server shows confirmation dialog. Switch server shows server list.
- [x] T024 Update `app.tsx` — remove `session.server` references from `navigateToWindow`, `TerminalClient` server prop, and "Reload tmux config" command. Navigate to `/` on server switch.

## Phase 4: Tests & Cleanup

- [x] T025 [P] Update Go tests in `app/backend/internal/tmux/` for new function signatures (server params). Add tests for `ListServers()`, `KillServer()`, `serverArgs()`.
- [x] T026 [P] Update Go tests in `app/backend/api/` for `serverFromRequest()`, new server endpoints, and updated handler signatures.
- [x] T027 [P] Update frontend tests for removed `server` field, new SessionProvider server state, sidebar server selector, and command palette actions.
- [x] T028 Run full test suite (`just test`) and fix any breakage.

---

## Execution Order

- T001 blocks T002, T003, T004, T005, T006 (unified exec function needed first)
- T002, T003, T004, T005 can run in parallel after T001
- T006 runs after T002 (cleanup after merge removal)
- T007 blocks T008-T012 (helper needed for endpoint updates)
- T008 blocks T017 (sessions handler needs updating before struct removal)
- T013-T015 can run in parallel (independent new endpoints)
- T016 depends on T013-T015 (routes for new endpoints)
- T017 depends on T002, T008 (both tmux and API layers updated)
- T018 depends on T003, T004, T005 (interface matches new signatures)
- T019 depends on T017 (backend field removed first)
- T020 depends on T019 (types updated first)
- T021 depends on T020 (server state available)
- T022, T023, T024 depend on T020, T021 (server context and API available)
- T025-T027 run in parallel after implementation
- T028 runs last
