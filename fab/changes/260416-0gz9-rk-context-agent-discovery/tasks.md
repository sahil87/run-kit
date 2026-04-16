# Tasks: rk context — Agent Discovery

**Change**: 260416-0gz9-rk-context-agent-discovery
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Create `app/backend/cmd/rk/context.go` with Cobra command skeleton — `Use: "context"`, `Short: "Show agent-optimized environment info"`, empty `RunE` that returns nil
- [x] T002 Register `contextCmd` on `rootCmd` in `app/backend/cmd/rk/root.go` — add `rootCmd.AddCommand(contextCmd)` in `init()`

## Phase 2: Core Implementation

- [x] T003 Implement environment detection in `context.go` — read `$TMUX_PANE`, query `tmux display-message -p '#{session_name}'` and `'#{window_name}'` via `exec.CommandContext` (5s timeout, no `-L` flag), read `@rk_type` via `tmux show-option -w -v @rk_type`, derive server URL from `RK_HOST`/`RK_PORT` env vars with `127.0.0.1:3000` defaults
- [x] T004 Implement output rendering in `context.go` — write Environment section (dynamic fields from T003, graceful degradation when outside tmux or on query failure), Capabilities section (static text: terminal windows, iframe windows with exact `tmux set-option` commands, proxy URL pattern, categorized CLI commands), and Conventions section (tmux user options, window lifecycle, SSE reactivity). Output via `fmt.Fprint` to `cmd.OutOrStdout()`

## Phase 3: Integration & Edge Cases

- [x] T005 Handle graceful degradation outside tmux in `context.go` — when `$TMUX_PANE` is unset, show `(not in tmux)` for environment, still show server URL and all static sections
- [x] T006 Handle `@rk_type` absent — omit window type line when `tmux show-option` returns error or empty value
- [x] T007 Handle tmux query failures — if individual tmux queries timeout or error, omit those fields but continue rendering; command always exits 0

## Phase 4: Testing

- [x] T008 Create `app/backend/cmd/rk/context_test.go` — test command output outside tmux (`$TMUX_PANE` unset): verify Capabilities and Conventions sections present, environment shows `(not in tmux)`, exit code 0. Test command registration: verify `contextCmd` is registered on `rootCmd`

---

## Execution Order

- T001 and T002 are sequential (T002 depends on T001 — `contextCmd` must be defined before `rootCmd.AddCommand` references it)
- T003 blocks T004 (output rendering uses environment detection results)
- T005, T006, T007 can run after T004 (edge case handling)
- T008 runs last (tests verify all behavior)
