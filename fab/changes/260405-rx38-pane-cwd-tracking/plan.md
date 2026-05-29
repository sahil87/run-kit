# Plan: Pane CWD Tracking and Sidebar Hover Info

**Change**: 260405-rx38-pane-cwd-tracking
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

## Phase 1: Setup

<!-- No scaffolding required — all files already exist. -->

- [x] T001 [P] Add `PaneInfo` struct to `app/backend/internal/tmux/tmux.go` (after `WindowInfo`) and add `Panes []PaneInfo` field to `WindowInfo` struct
- [x] T002 [P] Add `PaneInfo` type and `panes?: PaneInfo[]` field to `app/frontend/src/types.ts`

## Phase 2: Core Implementation

- [x] T003 Add `parsePanes(lines []string) map[int][]PaneInfo` function to `app/backend/internal/tmux/tmux.go` — parses 6-field tab-delimited list-panes output (field 0 = window_index for grouping, fields 1–5 = paneId, paneIndex, cwd, command, isActive); returns window-index→panes map only (flat slice removed — was discarded in all production callers) <!-- rework: dropped unused []PaneInfo first return value per outward review should-fix; tests updated to verify via map -->
- [x] T004 Update `ListWindows` in `app/backend/internal/tmux/tmux.go` to call `list-panes -s -t <session>` after `list-windows`, parse with `parsePanes`, and populate `Panes` on each `WindowInfo` (non-fatal if `list-panes` errors)
- [x] T005 Add `panes: PaneInfo[]` to `WindowEntry` type in `app/frontend/src/store/window-store.ts` and update `setWindowsForSession` to sync `panes` from incoming `WindowInfo` (default to `[]` when absent)
- [x] T006 [P] Add hover tooltip div to `app/frontend/src/components/sidebar/window-row.tsx` — absolutely-positioned inside `relative group` wrapper, revealed via `opacity-0 group-hover:opacity-100`, positioned `top-full left-0 mt-0.5 w-full z-30` (below row, within sidebar bounds), showing `cwd`, `win`, and `panes` key-value rows with fallback behavior per spec <!-- rework: left-full clipped by overflow-hidden ancestor in app.tsx; changed to top-full left-0 to stay within sidebar horizontal bounds -->

## Phase 3: Tests

- [x] T007 Add `parsePanes` unit tests to `app/backend/internal/tmux/tmux_test.go` — cover standard parse (6-field lines), malformed lines skipped, empty input returns nil, active pane flag, window grouping map
- [x] T008 Add `setWindowsForSession` pane sync test to `app/frontend/src/store/window-store.test.ts` (create file if absent, or add to existing) — cover panes synced from WindowInfo, panes absent defaults to `[]`, panes updated on re-sync
- [x] T009 [P] Add `WindowRow` tooltip render tests to `app/frontend/src/components/sidebar/window-row.test.tsx` (create if absent) — cover tooltip hidden at rest (opacity-0), shows cwd from active pane, shows fallback worktreePath when no panes, shows pane list with `*` for active pane, ghost window has no tooltip <!-- rework: update for new top-full positioning and add ghost window suppression test -->

## Phase 4: Verification

- [x] T010 Run `cd app/backend && go test ./...` — all Go tests pass
- [x] T011 Run `cd app/frontend && npx tsc --noEmit` — no TypeScript errors
- [x] T012 Run `just test` — backend + frontend + e2e tests pass

---

## Execution Order

- T001 blocks T003, T004 (need PaneInfo struct before parsePanes and ListWindows can reference it)
- T002 blocks T005, T006 (need PaneInfo type before store and tooltip can use it)
- T003 blocks T004 (parsePanes must exist before ListWindows calls it)
- T004 blocks T010 (Go implementation must be done before backend tests run)
- T005 blocks T008 (store change must exist before store test can be added)
- T006 blocks T009 (tooltip must exist before tooltip tests can be added)
- T007, T008, T009 can run in parallel after their prerequisites
- T010, T011, T012 run sequentially in Phase 4 (verification gates)

---

## Clarifications

### Session 2026-04-06 (auto)

| # | Item | Action | Detail |
|---|------|--------|--------|
| T003 | parsePanes signature vs spec | Resolved | Spec defines `[]PaneInfo` return; tasks extend to `([]PaneInfo, map[int][]PaneInfo)` for single-pass efficiency in ListWindows. Both are consistent — the map is an implementation convenience, not a contract change. |

## Acceptance

## Functional Completeness

- [x] CHK-001 PaneInfo struct: `tmux.go` defines `PaneInfo` with fields `PaneID`, `PaneIndex`, `Cwd`, `Command`, `IsActive` and correct JSON tags (`paneId`, `paneIndex`, `cwd`, `command`, `isActive`)
- [x] CHK-002 WindowInfo.Panes field: `WindowInfo` in `tmux.go` has `Panes []PaneInfo` with `json:"panes,omitempty"`
- [x] CHK-003 parsePanes function: unexported `parsePanes` helper exists, parses 6-field tab-delimited lines, returns `nil` for empty input, skips malformed (<6 fields) lines silently
- [x] CHK-004 ListWindows pane population: `ListWindows` calls `list-panes -s -t <session>` with the 6-field format string and populates `Panes` on each `WindowInfo` grouped by window index
- [x] CHK-005 WorktreePath unchanged: `WorktreePath` still populated from `list-windows #{pane_current_path}` — not derived from `list-panes`
- [x] CHK-006 Frontend PaneInfo type: `types.ts` exports `PaneInfo` type with `paneId`, `paneIndex`, `cwd`, `command`, `isActive` fields
- [x] CHK-007 WindowInfo.panes optional field: `WindowInfo` in `types.ts` has `panes?: PaneInfo[]` — optional, not required
- [x] CHK-008 WindowEntry.panes: `window-store.ts` `WindowEntry` has `panes: PaneInfo[]` field
- [x] CHK-009 setWindowsForSession syncs panes: pane data from incoming `WindowInfo.panes` copied to `WindowEntry.panes`; absent/undefined panes defaults to `[]`
- [x] CHK-010 Sidebar tooltip rendered: `window-row.tsx` includes absolutely-positioned tooltip div inside `relative group` wrapper
- [x] CHK-011 Tooltip reveal pattern: tooltip uses `opacity-0 group-hover:opacity-100` (same as kill button)
- [x] CHK-012 Tooltip positioning: tooltip uses `top-full left-0 mt-0.5 w-full z-30` Tailwind classes (below row, within sidebar bounds)
- [x] CHK-013 Tooltip content fields: tooltip shows `cwd`, `win` (index + windowId), and `panes` (comma-separated IDs with index, `*` for active)
- [x] CHK-014 Tooltip CWD fallback: when `panes` is absent/empty, `cwd` row falls back to `worktreePath`
- [x] CHK-015 Tooltip panes fallback: when `panes` is absent/empty, `panes` row shows `—`

## Behavioral Correctness

- [x] CHK-016 list-panes failure non-fatal: when `list-panes` errors (e.g., session disappears), `ListWindows` returns windows with empty `Panes` fields — not an error
- [x] CHK-017 panes updated on re-sync: each SSE tick replaces `WindowEntry.panes` with fresh data (no stale pane data accumulates)

## Scenario Coverage

- [x] CHK-018 Panes grouped by window: Go test verifies window index 0 gets panes %0,%1 and window index 1 gets pane %2 when list-panes output contains both windows
- [x] CHK-019 setWindowsForSession panes test: TS test verifies `panes` synced from `WindowInfo`, absent panes defaults to `[]`, re-sync replaces panes
- [x] CHK-020 Tooltip shows active pane CWD: test verifies `cwd:` shows the cwd of the pane where `isActive: true`
- [x] CHK-021 Tooltip shows pane list with asterisk: test verifies active pane marked with `*` in panes list

## Edge Cases & Error Handling

- [x] CHK-022 Window with no matching panes: a window index present in list-windows but absent from list-panes result gets empty `Panes` (nil or `[]`), not an error
- [x] CHK-023 PaneInfo with isActive=false for all panes: tooltip CWD falls back to `worktreePath`, no crash

## Code Quality

- [x] CHK-024 Pattern consistency: `parsePanes` follows same structure as `parseWindows` (tab delimiter, nil on empty, skip malformed); `PaneInfo` struct follows `WindowInfo` JSON tag conventions
- [x] CHK-025 No unnecessary duplication: `tmuxExecServer` reused for `list-panes` call (no new exec helper); `listDelim` constant reused in `parsePanes`
- [x] CHK-026 Go subprocess safety: `list-panes` call uses `tmuxExecServer(ctx, server, ...)` with argument slices — no shell strings
- [x] CHK-027 No magic strings: `list-panes` format string defined as a named `strings.Join` expression or constant (not scattered inline) — defined as `var paneFormat`
- [x] CHK-028 Type narrowing in frontend: tooltip component uses optional chaining (`panes?.find(...)`) — no `as` casts

## Security

- [x] CHK-029 No injection surface: `list-panes -s -t <session>` call passes `session` as an explicit argument to `tmuxExecServer` (arg slice), not via shell string interpolation
