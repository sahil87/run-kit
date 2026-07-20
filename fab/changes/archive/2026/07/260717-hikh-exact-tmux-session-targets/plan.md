# Plan: Exact tmux session targets, window-id pane join, ghost TTL

**Change**: 260717-hikh-exact-tmux-session-targets
**Intake**: `intake.md`

> Adopted change — code authored off-pipeline. Apply was skipped; this plan is reverse-engineered from the branch diff to feed hydrate.

## Requirements

### internal/tmux: exact-match session targets

Every tmux command that receives a session name as a `-t` target composes it through the new `ExactSessionTarget` helper (`=name:`) — the leading `=` disables tmux's prefix/fnmatch name matching and the trailing `:` forces the string to parse as a session, never as a window name. This matters because `new-window` and `list-panes` (even with `-s`) treat `-t` as a *window* target: tmux matches a bare name against the attached session's window names before trying it as a session name, so a window named like a session (routine under folder-basename auto-naming) hijacks the command. Session-qualified window targets (`swap-window`, `select-window`, `SelectWindowInSession`) compose through `exactWindowInSession` (`=session:windowSpec`). Call sites converted: `ListWindows` (both reads), `buildCreateWindowArgs`, `CreateWindowWithOptions`, `KillSession`, `RenameSession`, `MoveWindow`, `MoveWindowToSession`, `SelectWindowInSession`, and board.go's option/has-session/list-windows/recovery sites. `daemon` and `tmuxctl` already carried their own `=` discipline and are unchanged.

### internal/tmux: pane join keyed by window id

`paneFormat` emits `#{window_id}` (was `#{window_index}`); `parsePanes` groups into `map[string][]PaneInfo` keyed by window id with a `ValidWindowID` guard on field 0; `ListWindows` attaches panes by `WindowID`. A target divergence between the windows read and the panes read now degrades to empty pane lists (visible) instead of attaching another session's panes to a window (silent data corruption — the live `ext` symptom where session 0's pane cwd/branch/agent-state rendered on session planner's window).

### internal/riff: exact spawn targets

riff's daemon-path spawn targets go through the same exact forms: `sessionTarget` returns `tmux.ExactSessionTarget(spec.Session)`, `windowTarget` returns `=session:name` (window-name part deliberately non-exact — riff uniquifies names within the session pre-spawn), and the `listWindowNames` collision probe targets `=session:`. The CLI path (empty `spec.Session`) is byte-identical to before. riff now imports `rk/internal/tmux`.

### frontend window-store: ghost TTL backstop

An optimistic ghost window row that is never claimed (claimed = a new windowId arriving for its server+session via SSE) self-clears after `GHOST_WINDOW_TTL_MS` (15s) via a `setTimeout` in `addGhostWindow`. `removeGhost` is idempotent, so timers firing after a claim or rollback are no-ops. This bounds the "create succeeded in a different session — no rollback, no claim" strand to a visible blip instead of a permanent greyed pulsing row.

### Tests

`TestSessionWindowNameCollision` reproduces the session/window name collision against a real tmux server and asserts both the create routing and pane-join isolation. `TestExactSessionTarget` pins the target form (numeric and pin-session names included). `parsePanes` fixtures moved to window-id keys plus a non-`@N` skip test. riff argv expectations updated. Frontend: fake-timer tests for TTL expiry and claimed-ghost no-op.

## Tasks

- [x] Adopted: implementation authored outside the pipeline (see PR #380, branch `astral-lynx`).

## Acceptance

- [x] Adopted: code already authored and verified (full backend suite incl. real-tmux integration, 1375 frontend unit tests, tsc, targeted e2e); a diff-only review runs in this pipeline.

## Assumptions

0 assumptions.
