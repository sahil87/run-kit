# Plan: Pane-Map Join by Pane ID

**Change**: 260713-d07t-pane-map-join-by-pane-id
**Intake**: `intake.md`

## Requirements

### Backend/Sessions: Pane-Map Enrichment Join

#### R1: Fetch-time pane-map key is the stable pane ID
The fetch-time pane-map lookup SHALL be keyed by the stable tmux pane ID (`paneMapEntry.Pane`, e.g. `"%12"`), one entry per pane, with NO window-level dedup performed at fetch time. Window membership is only knowable against a fresh tmux snapshot, so any change-bound-vs-first-seen preference among a window's panes MUST be deferred to join time (see R3), not applied while building the fetch map.

- **GIVEN** a `fab pane map --json` result containing multiple entries, including two panes in one window
- **WHEN** the fetch-time map is built
- **THEN** each entry is stored under its own `Pane` key
- **AND** no two panes are collapsed into a single window-level entry at fetch time

#### R2: Empty-`Pane` entries fall back to the legacy positional key
An entry whose `Pane` field is empty (hypothetical older `fab` JSON that omits the pane ID) SHALL be stored in the same fetch-time map under the legacy positional key `fmt.Sprintf("%s:%d", e.Session, e.WindowIndex)`. The two key shapes cannot collide because a real pane ID always begins with `%`.

- **GIVEN** a pane-map entry with `Pane == ""` for session `dev`, window index `0`
- **WHEN** the fetch-time map is built
- **THEN** the entry is retrievable under key `"dev:0"`
- **AND** a pane-ID-keyed entry (`"%3"`) in the same map is unaffected

#### R3: Join attributes enrichment by fresh pane membership, keyed by pane ID
The `FetchSessions` enrichment join SHALL attribute a pane-map entry to a window by looking up each pane of the **fresh** snapshot window (iterating `sd.windows[j].Panes`) in the fetch-time map by that pane's `PaneID`. Among multiple matching candidate panes of one window, selection MUST preserve today's dedup semantics exactly: a change-bound entry (`Change != nil`) wins; otherwise the first-seen candidate in pane order wins. The selected entry lands in `enrichByWindowID[windowID]`, feeding the existing fab-field assignment (`FabChange`/`FabStage`/`FabDisplayState`) unchanged.

- **GIVEN** a stale cached pane map captured before a `swap-window`, and a fresh snapshot where two windows' indices are swapped but pane IDs and window IDs travel with their windows
- **WHEN** `FetchSessions` runs the enrichment join
- **THEN** each window's `FabChange`/`FabStage`/`FabDisplayState` follows its window ID (its actual panes), never its list position
- **AND** a window with two panes where one is change-bound attributes the change-bound entry
- **AND** a window with two non-change-bound candidate panes attributes the first-seen one (pane order)

#### R4: Legacy positional fallback at join time
When no pane of a fresh-snapshot window matches any pane-ID key in the fetch-time map, the join SHALL attempt the legacy positional key `fmt.Sprintf("%s:%d", session, window.Index)` exactly once, so empty-`Pane` fallback entries (R2) still enrich their window.

- **GIVEN** a fetch-time map containing only a legacy-keyed entry `"dev:1"` (from an empty-`Pane` entry) and a fresh window at session `dev`, index `1` whose panes have pane IDs absent from the map
- **WHEN** the join runs
- **THEN** the window is enriched from the `"dev:1"` entry

#### R5: Corrected comment stating the true invariant
The comment block preceding the enrichment join (currently claiming the WindowID re-key means "a reorder can never misattribute") SHALL be rewritten to state the actual invariant: the stable tmux pane ID is the join key, so a stale cached pane map can never misattribute enrichment across a reorder/move — at worst a pane absent from the fresh snapshot contributes nothing. The `dedupEntries`/`fetchPaneMap` doc comments SHALL likewise be updated to describe the pane-ID keying rather than the removed positional window dedup.

- **GIVEN** a reader of `sessions.go`
- **WHEN** they read the comment above the enrichment join and on the fetch-map helper
- **THEN** the text accurately describes pane-ID keying and cache-staleness immunity for identity, with no stale claim about positional/WindowID re-keying

### Backend/Sessions: Regression & Fallback Tests

#### R6: Swap-scenario regression test
`sessions_test.go` SHALL contain a test that builds a pre-swap pane map (two windows, distinct changes, keyed by pane ID) and a fresh snapshot where the two windows' indices are swapped while panes and window IDs travel, then asserts each window's fab fields follow its window ID rather than its index. This test MUST fail against the old positional (`session:index`) join.

- **GIVEN** the join helper under test
- **WHEN** the swapped-fresh-snapshot scenario is exercised
- **THEN** the assertions pass under the pane-ID join and would fail under the positional join

#### R7: Empty-`Pane` fallback test
`sessions_test.go` SHALL contain a test proving an entry with empty `Pane` still enriches its window via the legacy positional key (R2/R4).

- **GIVEN** a fetch-time map built from an empty-`Pane` entry
- **WHEN** the join runs against the matching fresh window
- **THEN** the window is enriched from the legacy-keyed entry

#### R8: Reworked existing join/dedup tests
The existing tests that replicate the old positional join inline (`TestPaneMapJoinPopulatesPerWindowFabFields`, `TestPaneMapJoinPopulatesDisplayState`) and the fetch-time dedup tests (`TestPaneMapDedupFirstSeenWhenNeitherChangeBound`, `TestPaneMapDedupChangeWins`) SHALL be reworked to exercise the new join helper and assert the same selection semantics (change-bound > first-seen among one window's panes) at join time rather than at fetch time.

- **GIVEN** the reworked tests
- **WHEN** `go test ./internal/sessions/` runs
- **THEN** all four exercise the new join path and pass, with no lingering reference to a removed positional fetch-time dedup

### Design Decisions

1. **Join key = stable tmux pane ID**: match `paneMapEntry.Pane` against fresh `PaneInfo.PaneID` — *Why*: both sides already carry the pane ID, which travels with its window across swap/move exactly like the window ID, making cache staleness harmless for identity with zero fab-kit changes — *Rejected*: adding `window_id` to fab's output (explicitly rejected by the user; would require an rk index-join fallback for older fabs, leaving two join paths).
2. **Extract a testable join helper**: prefer extracting the fetch-map build and/or the membership join into named functions over inline replication in tests — *Why*: the intake calls for it and the existing tests currently replicate join logic inline, which drifts — *Rejected*: keeping the join fully inline in `FetchSessions` and re-replicating it in each test.
3. **No fetch-time window dedup**: the fetch map is one-entry-per-pane; change-bound-vs-first-seen selection moves to join time — *Why*: window membership is only authoritative against the fresh snapshot; deduping at fetch time by a stale positional key is exactly the bug — *Rejected*: keeping fetch-time dedup (reintroduces positional misattribution).

### Non-Goals

- fab-kit `window_id` output field — explicitly rejected; rk-side fix only.
- The frontend `setWindowsForSession` optimistic-index stomp — distinct, out of scope.
- Pane-map cache semantics — the 5s TTL and stale-on-error preservation stay unchanged.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Re-shape the fetch-time map builder in `app/backend/internal/sessions/sessions.go`: replace `dedupEntries` with a pane-ID-keyed builder (one entry per pane, no window dedup) that falls back to the legacy `session:windowIndex` key for entries with empty `Pane`; update its doc comment to describe pane-ID keying. Keep `fetchPaneMap` returning this map. <!-- R1 --> <!-- R2 -->
- [x] T002 Rewrite the `FetchSessions` enrichment join block in `app/backend/internal/sessions/sessions.go`: iterate each fresh window's `Panes`, look up `PaneID` in the map, select change-bound > first-seen among candidates, fall back to the legacy `session:index` key once when no pane-ID candidate matched, and land the result in `enrichByWindowID[windowID]`. Prefer extracting a testable join function over inline logic. <!-- R3 --> <!-- R4 -->
- [x] T003 Rewrite the now-incorrect comment block above the enrichment join (and the `fetchPaneMap` doc note about `session:windowIndex` keying) in `app/backend/internal/sessions/sessions.go` to state the true pane-ID-join invariant. <!-- R5 -->

### Phase 3: Tests

- [x] T004 Add the swap-scenario regression test to `app/backend/internal/sessions/sessions_test.go`: pre-swap pane map (two windows, distinct changes, keyed by pane ID) + fresh snapshot with swapped indices but traveling panes/window IDs; assert fab fields follow window ID. Verify it fails against the old positional join. <!-- R6 -->
- [x] T005 [P] Add the empty-`Pane` fallback test to `app/backend/internal/sessions/sessions_test.go`: an entry with empty `Pane` enriches via the legacy positional key. <!-- R7 -->
- [x] T006 Rework `TestPaneMapJoinPopulatesPerWindowFabFields`, `TestPaneMapJoinPopulatesDisplayState`, `TestPaneMapDedupFirstSeenWhenNeitherChangeBound`, and `TestPaneMapDedupChangeWins` in `app/backend/internal/sessions/sessions_test.go` to exercise the new join helper and assert change-bound > first-seen selection at join time. <!-- R8 -->

### Phase 4: Verification

- [x] T007 Run `cd app/backend && go test ./internal/sessions/`, then `just test-backend`; fix any failures. <!-- R1 --> <!-- R2 --> <!-- R3 --> <!-- R4 --> <!-- R5 --> <!-- R6 --> <!-- R7 --> <!-- R8 -->

## Execution Order

- T001 blocks T002 (the join consumes the fetch-map shape).
- T002 and T003 both touch the same region; do T002 then T003 (or together).
- T004, T005, T006 depend on T001–T002 (they exercise the new join). T005 is independent of T004/T006.
- T007 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: The fetch-time pane-map map is keyed by pane ID with one entry per pane and no window-level dedup at fetch time.
- [x] A-002 R2: An empty-`Pane` entry is stored (and retrievable) under the legacy `session:windowIndex` key; a `%`-prefixed pane-ID key in the same map does not collide.
- [x] A-003 R3: The `FetchSessions` join attributes entries by fresh pane membership (pane-ID lookup) into `enrichByWindowID[windowID]`, preserving `FabChange`/`FabStage`/`FabDisplayState` assignment.
- [x] A-004 R4: When no fresh pane matches a pane-ID key, the join falls back to the legacy `session:index` key exactly once.
- [x] A-005 R5: The join comment and fetch-map doc comment accurately describe pane-ID keying and cache-staleness immunity for identity, with no stale positional/WindowID claim.

### Behavioral Correctness

- [x] A-006 R3: Change-bound > first-seen selection among a window's candidate panes matches the prior dedup semantics.
- [x] A-007 R3: After a window swap (stale map, swapped fresh indices, traveling panes/window IDs), each window's fab fields follow its window ID, not its index.

### Scenario Coverage

- [x] A-008 R6: The swap-scenario regression test exists, passes under the pane-ID join, and fails under the old positional join.
- [x] A-009 R7: The empty-`Pane` fallback test exists and passes.
- [x] A-010 R8: `TestPaneMapJoinPopulatesPerWindowFabFields`, `TestPaneMapJoinPopulatesDisplayState`, `TestPaneMapDedupFirstSeenWhenNeitherChangeBound`, and `TestPaneMapDedupChangeWins` exercise the new join helper and pass.

### Edge Cases & Error Handling

- [x] A-011 R3: A pane present in the cached map but absent from the fresh snapshot contributes nothing (no misattribution, no panic).
- [x] A-012 R1: A nil/empty pane map leaves all fab fields empty (existing `TestPaneMapNilLeavesAllFieldsEmpty` behavior preserved).

### Code Quality

- [x] A-013 Pattern consistency: New code follows the naming and structural patterns of surrounding `sessions.go` code (pure, testable helpers mirroring the `parseWindows`/`rollupAgentState` split).
- [x] A-014 No unnecessary duplication: The join logic is extracted into a testable function reused by tests rather than replicated inline.
- [x] A-015 Tests cover changed behavior: The bug fix ships with tests covering the swap regression and the empty-`Pane` fallback (code-quality.md: bug fixes MUST include tests).
- [x] A-016 No new caches/subprocess: The change introduces no new in-memory cache or subprocess call; the 5s pane-map TTL and stale-on-error preservation are unchanged.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change replaces the positional fetch-time dedup in place (`dedupEntries` and the inline `FetchSessions` index join were removed in the same diff) and leaves no existing code redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix lives entirely rk-side in `sessions.go` + its test file; no fab-kit change | User explicitly chose the rk-side fix; intake Assumption 1 | S:95 R:90 A:95 D:95 |
| 2 | Certain | Join key = stable tmux pane ID (`paneMapEntry.Pane` ↔ `PaneInfo.PaneID`) | Verified both sides carry the pane ID; it travels with windows across swap/move; intake Assumption 2 | S:90 R:85 A:95 D:90 |
| 3 | Confident | Change-bound > first-seen preference moves from fetch-time index-grouping to join-time fresh-membership grouping | Preserves existing dedup semantics while making window membership authoritative; intake Assumption 3 | S:70 R:75 A:85 D:75 |
| 4 | Confident | Empty-`Pane` entries fall back to the legacy `session:windowIndex` key (shapes cannot collide via `%` prefix) | Cheap one-branch compat with hypothetical older fab JSON, strictly safer than skipping; intake Assumption 4 | S:55 R:85 A:75 D:65 |
| 5 | Confident | Extract the membership join into a testable helper rather than replicating inline in tests | Intake calls for it; existing tests drift from inline replication; mirrors the pure-helper pattern in the file | S:65 R:85 A:80 D:70 |

5 assumptions (2 certain, 3 confident, 0 tentative).
