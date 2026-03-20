# Tasks: Dedicated Tmux Server

**Change**: 260318-0gjh-dedicated-tmux-server
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Create `config/tmux.conf` with run-kit dark theme status bar, F2/F3/F4 keybindings, mouse on, tmux-256color default-terminal
- [x] T002 [P] Add `RK_TMUX_CONF=config/tmux.conf` to `.env`

## Phase 2: Core Implementation

- [x] T003 Modify `tmuxExec` and `tmuxExecRaw` in `app/backend/internal/tmux/tmux.go` to prepend `-L runkit` and optionally `-f <RK_TMUX_CONF>` to all commands. Read config path from `os.Getenv("RK_TMUX_CONF")` at init time
- [x] T004 Add `tmuxExecDefault` helper in `app/backend/internal/tmux/tmux.go` that runs tmux commands against the default server (no `-L` flag, no `-f` flag)
- [x] T005 Refactor `ListSessions()` in `app/backend/internal/tmux/tmux.go` to query both servers: runkit via `tmuxExec` and default via `tmuxExecDefault`. Replace `Byobu bool` with `Server string` in `SessionInfo`. Tag results with `"runkit"` or `"default"`. Update `parseSessions` to accept a `server` parameter
- [x] T006 Update `ListWindows()` in `app/backend/internal/tmux/tmux.go` — add a `server` parameter. Use `tmuxExec` for `"runkit"`, `tmuxExecDefault` for `"default"`
- [x] T007 Remove `hasByobu` variable and byobu branch from `CreateSession()` in `app/backend/internal/tmux/tmux.go`. Remove `exec.LookPath` import if no longer needed
- [x] T008 Update relay handler in `app/backend/api/relay.go` — add `-L runkit` and `-f <configPath>` to the `tmux attach-session` command

## Phase 3: Integration & Edge Cases

- [x] T009 Replace `Byobu bool` with `Server string` in `ProjectSession` struct in `app/backend/internal/sessions/sessions.go`. Update `FetchSessions()` to pass `Server` from `SessionInfo` to `ProjectSession`. Update `ListWindows` calls to pass correct server
- [x] T010 [P] Update `ProjectSession` type in `app/frontend/src/types.ts` — replace `byobu: boolean` with `server: "runkit" | "default"`
- [x] T011 [P] Update `app/frontend/src/components/sidebar.tsx` — remove byobu "b" marker, add `↗` marker for `session.server === "default"`
- [x] T012 [P] Update `app/frontend/src/components/dashboard.tsx` if it references `session.byobu` — change to `session.server`

## Phase 4: Tests

- [x] T013 Update `parseSessions` tests in `app/backend/internal/tmux/tmux_test.go` — verify `Server` field instead of `Byobu`, add test cases for multi-server merge
- [x] T014 [P] Update `ProjectSession` assertions in `app/backend/internal/sessions/sessions_test.go` for `Server` field
- [x] T015 [P] Update sidebar tests in `app/frontend/src/components/sidebar.test.tsx` — remove byobu marker test, add external session `↗` marker test
- [x] T016 [P] Update MSW handlers in `app/frontend/tests/msw/handlers.ts` — replace `byobu` field with `server` field in mock data

---

## Execution Order

- T001, T002 are independent setup tasks
- T003 blocks T004, T005, T006, T007, T008 (all depend on the modified tmuxExec)
- T004 blocks T005 (ListSessions needs tmuxExecDefault)
- T005 blocks T006, T009 (type change propagates)
- T007 is independent once T003 is done
- T008 is independent once T003 is done
- T009 blocks T010, T011, T012 (frontend depends on backend type change)
- T010, T011, T012 are parallelizable
- T013-T016 are parallelizable, depend on their respective implementation tasks
