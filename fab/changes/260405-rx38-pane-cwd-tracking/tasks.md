# Tasks: Pane CWD Tracking and Sidebar Hover Info

**Change**: 260405-rx38-pane-cwd-tracking
**Spec**: `spec.md`
**Intake**: `intake.md`

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
