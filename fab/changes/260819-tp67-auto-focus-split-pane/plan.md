# Plan: Auto-Focus Split Pane

**Change**: 260819-tp67-auto-focus-split-pane
**Intake**: `intake.md`

## Requirements

### Backend API: Split auto-focus

#### R1: Split endpoint selects the new pane
`POST /api/windows/{windowId}/split` (`handleWindowSplit`, `app/backend/api/windows.go`) MUST, after a successful `SplitWindow` call, select the newly created pane via the `TmuxOps` seam (`SelectPane(paneID, server)`), so the pane a split creates becomes the window's active pane — auto-focusing it for the attached web client and every other split entry point (Cmd+D / ⇧⌘D chords, top-bar Split chip + ▾ menu, palette `Window: Split …` and `Board: Split Focused Pane …` actions).

- **GIVEN** a valid split request for window `@0` on server `s`
- **WHEN** `SplitWindow` succeeds and returns pane ID `%5`
- **THEN** the handler calls `SelectPane("%5", "s")` before responding
- **AND** the response is `200 {"ok": true, "pane_id": "%5"}` as before

- **GIVEN** a split request whose `SplitWindow` call fails
- **WHEN** the handler returns the 500 error
- **THEN** `SelectPane` is never called

#### R2: SelectPane joins the TmuxOps seam; existing tmux contracts unchanged
The `TmuxOps` interface (`app/backend/api/router.go`) MUST gain `SelectPane(paneID, server string) error`, with a `prodTmuxOps` pass-through to the existing `tmux.SelectPane` (`app/backend/internal/tmux/layout.go`). `tmux.SplitWindow` MUST keep its signature and its `-d` (detached) flag verbatim, and `internal/snapshot/restore.go` MUST NOT be touched — the restorer's detached-split + re-select contract is unchanged.

- **GIVEN** the change is applied
- **WHEN** `git diff` is inspected
- **THEN** `tmux.SplitWindow` and `internal/snapshot/` are byte-identical to before
- **AND** `prodTmuxOps.SelectPane` delegates to `tmux.SelectPane`

#### R3: Focus is best-effort
A `SelectPane` failure MUST NOT fail the split response: the split succeeded and the pane exists, so the handler SHALL still return `200 {"ok": true, "pane_id": ...}`, discarding the select error (the `KillActivePane` silent-success posture for pane operations that may race external state).

- **GIVEN** a valid split request and a `SelectPane` that returns an error
- **WHEN** the handler runs
- **THEN** the response is still `200 {"ok": true, "pane_id": ...}`

### Non-Goals

- No frontend changes — the web terminal is a live tmux attach; focus follows the active pane by construction.
- No `focus` parameter on the API or on `tmux.SplitWindow` — uniform auto-focus was the user's explicit choice.
- No e2e/Playwright additions — the frontend contract is unchanged; backend unit tests pin the new behavior.

### Design Decisions

#### Handler-level select, not a SplitWindow contract change
**Decision**: Auto-focus is implemented as a `SelectPane` call in `handleWindowSplit` after the split returns, leaving `tmux.SplitWindow`'s `-d` flag and signature untouched.
**Why**: One spot fixes every split entry point (all share the endpoint); the snapshot restorer (`internal/snapshot/restore.go`) deliberately depends on detached splits and does its own active-pane re-select.
**Rejected**: Dropping `-d` or adding a `focus bool` to `SplitWindow` — breaks or churns the restorer's contract, the `TmuxOps` interface, and every mock for identical behavior.
*Introduced by*: 260819-tp67-auto-focus-split-pane

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `SelectPane(paneID, server string) error` to the `TmuxOps` interface and the `prodTmuxOps` pass-through (`return tmux.SelectPane(paneID, server)`) in `app/backend/api/router.go`, adjacent to the existing `SplitWindow` members <!-- R2 -->
- [x] T002 Add `SelectPane` to `mockTmuxOps` in `app/backend/api/sessions_test.go`: recording fields (`selectPaneCalled bool`, `selectPanePaneID string`, `selectPaneServer string`, `selectPaneErr error`) following the existing `splitWindow*` field naming, and the method returning `selectPaneErr` <!-- R2 -->
- [x] T003 In `handleWindowSplit` (`app/backend/api/windows.go`), after the successful `SplitWindow` call, invoke `s.tmux.SelectPane(paneID, server)` best-effort (error discarded) before writing the `200` response <!-- R1 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Extend split tests in `app/backend/api/windows_test.go`: `TestWindowSplit` additionally asserts `SelectPane` was called with the returned pane ID (`%5`); new `TestWindowSplitSelectPaneError` asserts a `selectPaneErr` still yields `200 ok` + `pane_id`; new `TestWindowSplitError` asserts a `splitWindowErr` yields `500` and `SelectPane` is not called. Run `cd app/backend && go test ./...` <!-- R1, R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: A successful split calls `SelectPane` with exactly the pane ID `SplitWindow` returned and the request's server, then responds `200 {"ok": true, "pane_id": ...}`
- [x] A-002 R2: `TmuxOps` exposes `SelectPane`; `prodTmuxOps` delegates to `tmux.SelectPane`; `tmux.SplitWindow` and `internal/snapshot/` are unchanged
- [x] A-003 R3: A `SelectPane` error is swallowed — the split response is still `200 ok` with the pane ID

### Behavioral Correctness

- [x] A-004 R1: A failed `SplitWindow` returns `500` without calling `SelectPane`

### Scenario Coverage

- [x] A-005 R1: `go test ./...` in `app/backend` passes, including the extended `TestWindowSplit` and the two new split tests

### Code Quality

- [x] A-006 Pattern consistency: mock fields/method follow the existing `mockTmuxOps` naming and structure; the prod pass-through matches sibling one-liners
- [x] A-007 No unnecessary duplication: reuses the existing `tmux.SelectPane` (no new tmux command construction; all tmux interaction stays in `internal/tmux/`)
- [x] A-008 Subprocess discipline: no new `exec` call sites — `tmux.SelectPane` already uses `tmuxExecServer` with `withTimeout()` (Constitution I / process-execution constraint)
- [x] A-009 Comment discipline: any new comment states a constraint the code can't show (the best-effort contract), never narration or change-ID citations

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Select error is discarded (`_ =`), not logged | Matches `KillActivePane`'s silent-success posture; the handler has no logger seam today and adding one is out of scope | S:60 R:90 A:80 D:75 |
| 2 | Certain | Mock recording-field names follow the `splitWindow*` prefix convention (`selectPane*`) | Direct pattern read from `sessions_test.go` | S:85 R:95 A:95 D:90 |

2 assumptions (1 certain, 1 confident, 0 tentative).
