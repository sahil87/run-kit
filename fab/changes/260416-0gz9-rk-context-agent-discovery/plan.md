# Plan: rk context — Agent Discovery

**Change**: 260416-0gz9-rk-context-agent-discovery
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

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

## Acceptance

## Functional Completeness

- [x] CHK-001 Command registration: `contextCmd` registered on `rootCmd`, `rk context` invocable
- [x] CHK-002 Environment section: displays session name, window name, pane ID, server URL, window type when inside tmux
- [x] CHK-003 Capabilities section: includes terminal windows, iframe windows, proxy, and categorized CLI commands
- [x] CHK-004 Conventions section: documents `@rk_type`/`@rk_url` options, window lifecycle, SSE reactivity
- [x] CHK-005 CLI command categories: all 6 registered subcommands appear grouped under Server, Diagnostics, or Info

## Behavioral Correctness

- [x] CHK-006 Outside-tmux degradation: shows `(not in tmux)` for environment, server URL still present, capabilities and conventions sections rendered
- [x] CHK-007 `@rk_type` absent: window type line omitted when option not set on window
- [x] CHK-008 Tmux query failure: failed fields omitted, command exits 0, other sections unaffected

## Scenario Coverage

- [x] CHK-009 Scenario "inside tmux with all fields": environment section shows all 5 fields
- [x] CHK-010 Scenario "outside tmux": environment shows `(not in tmux)`, static sections present
- [x] CHK-011 Scenario "output is markdown-compatible": output renderable as valid markdown

## Edge Cases & Error Handling

- [x] CHK-012 Tmux timeout: `exec.CommandContext` uses 5s timeout for all tmux queries
- [x] CHK-013 No `$TMUX_PANE`: command does not panic or error, gracefully degrades
- [x] CHK-014 `@rk_type` query returns error: field omitted, no error propagated

## Code Quality

- [x] CHK-015 Pattern consistency: `context.go` follows naming and structural patterns of `status.go`, `doctor.go` (Cobra command variable, `RunE` function, `cmd.OutOrStdout()`)
- [x] CHK-016 No unnecessary duplication: server URL derivation reuses env var reading pattern from `internal/config`
- [x] CHK-017 All subprocess calls use `exec.CommandContext` with explicit argument slices — no shell strings
- [x] CHK-018 Functions focused and appropriately sized: `RunE` delegates to helper functions if output logic exceeds ~50 lines
- [x] CHK-019 No inline tmux command construction: tmux queries use argument slices via `exec.CommandContext`
- [x] CHK-020 No database/ORM/migration imports (constitution)

## Security

- [x] CHK-021 All `exec.CommandContext` calls include timeout (5s for tmux queries)
- [x] CHK-022 No shell string construction — all subprocess args are explicit slices

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
