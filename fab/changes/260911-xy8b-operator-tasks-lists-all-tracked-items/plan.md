# Plan: Operator Tasks tab lists every tracked item, not only pane-bearing workers

**Change**: 260911-xy8b-operator-tasks-lists-all-tracked-items
**Intake**: `intake.md`

## Requirements

### Backend: operator state reader

#### R1: The reader surfaces every tracked item
`internal/cron/watchlist.go` SHALL expose `ParseOperatorState(data []byte) (OperatorState, ok bool)` and `ReadOperatorState(path string) (OperatorState, present bool)`, where `OperatorState{Items []TrackedItem, LastTickAt int64}` and `TrackedItem{ID, Kind, Text string; Refs []string; Pane, Repo, Session, Stage, Agent, Branch string; Paused bool; DoneAt, AddedAt, UpdatedAt int64}`. The `tracked:` arm MUST keep every list element that is a map with a non-empty string `id` — pane-less, done, paused, or scope-less — in list order. `Text` comes from `text`, `Refs` from `scope.refs` (string elements only, `nil` when absent), `Paused` from `paused == true`, and `DoneAt`/`AddedAt`/`UpdatedAt` through `parseTickAt` (`null`/absent/unparseable ⇒ 0). A missing or non-map `scope` MUST NOT skip the item. The legacy `monitored:` arm (read only when the `tracked` key is absent) MUST yield `TrackedItem`s with `Kind == ""`, sorted by key. Unknown keys stay ignored; an absent or corrupt file degrades to `(zero, false)`, never an error. rk MUST NOT write the file.

- **GIVEN** a state file whose `tracked:` list holds a `kind: note` item with `scope: {refs: [y60c, np2w]}`, `text`, `paused: false`, `done_at: null`, RFC3339 `added_at`/`updated_at`
- **WHEN** `ParseOperatorState` runs
- **THEN** `Items` holds one `TrackedItem` with `Kind == "note"`, the `Text`, `Refs == [y60c np2w]`, `Pane == ""`, `DoneAt == 0`, parsed `AddedAt`/`UpdatedAt`
- **AND GIVEN** an item with no `scope` key, **THEN** it is kept with empty scope fields
- **AND GIVEN** a non-map element and an element with no `id` beside a valid item, **THEN** only the valid item is returned

#### R2: The watchlist join set is unchanged
`OperatorState.WatchlistEntries() []WatchlistEntry` SHALL return exactly today's `ParseWatchlist` entry set: every item with a non-empty `Pane` and `DoneAt == 0` (paused and kind do not filter), sorted by `ChangeID`. `ParseWatchlist` and `ReadWatchlist` SHALL be removed (sole caller `sessions.go`), and the existing 17-case `TestParseWatchlist` table MUST pass unchanged in expectation when re-pointed at `ParseOperatorState(...).WatchlistEntries()`.

- **GIVEN** a done pane-bearing item (`done_at: "2026-09-11T10:00:00Z"`), a paused pane-bearing item, and a pane-less note
- **WHEN** `WatchlistEntries()` runs
- **THEN** only the paused item is an entry; the done item is in `Items` with `DoneAt > 0` and absent from the entries; the note is in `Items` and absent from the entries

### Backend: sessions payload

#### R3: `ProjectSession.OperatorTracked`, stamped on every session; the pane join untouched
`internal/sessions/sessions.go` SHALL add `OperatorTrackedItem{ID, Kind, Text, Refs, Pane, WindowID, Repo, Session, Stage, Agent, Branch, Paused, DoneAt, AddedAt, UpdatedAt}` with camelCase `omitempty` JSON tags (`id` always present) and `ProjectSession.OperatorTracked []OperatorTrackedItem` (`json:"operatorTracked,omitempty"`). `FetchSessions` MUST replace `cron.ReadWatchlist` with `cron.ReadOperatorState`, build `watchlistByPane` from `state.WatchlistEntries()` so `joinWatchlist` and every `Monitored*` field stay byte-identical, and project `state.Items` through a pure `projectTrackedItems(items, paneToWindow)` helper where `paneToWindow` maps every window's `Panes[].PaneID` to its `WindowID` across all sessions of the fetch. `WindowID` is set only when the item's pane resolves to a live window in this fetch. The same slice is stamped on every session; an absent file leaves the field `nil` (key omitted).

- **GIVEN** a state file with a pane-bearing not-done item on live pane `%5`, a pane-bearing item on a pane no window carries, and a pane-less note
- **WHEN** `FetchSessions` runs
- **THEN** every session's `OperatorTracked` holds all three items, the first with `WindowID` set, the other two without, **AND** only the window holding `%5` reports `monitored: true`
- **AND GIVEN** no operator state file, **THEN** the marshalled session JSON carries no `operatorTracked` key

### Frontend: types and row model

#### R4: `operatorTracked` type and `collectTrackedRows`
`src/types.ts` SHALL add `OperatorTrackedItem` (all fields optional except `id`) and `ProjectSession.operatorTracked?: OperatorTrackedItem[]`. `server-watched-zone/model.ts` SHALL add `TrackedRow = { kind: "worker"; item; session; win; done } | { kind: "item"; item; done }` and `collectTrackedRows(sessions): TrackedRow[] | null`: `null` when no session carries `operatorTracked`; the list read from the first session carrying it; `done = (item.doneAt ?? 0) > 0`; a `worker` row when `item.windowId` matches a live non-ghost window, else an `item` row. Order: worker rows first in session order then window index, then item rows in tracked-list order; within each species live before done. `collectWatchedRows` and `watchlistStatus` are unchanged.

- **GIVEN** sessions carrying `operatorTracked` with a live worker item, a done worker item, a note, and an item whose `windowId` names a ghost window
- **WHEN** `collectTrackedRows` runs
- **THEN** it returns [live worker, done worker, note (item), ghost-target (item)] with `done` flags set accordingly
- **AND GIVEN** sessions without `operatorTracked`, **THEN** it returns `null`

### Frontend: table and segment

#### R5: Two row species in the one six-column `WatchedTable`
`WatchedTable` SHALL accept `rows: TrackedRow[]` (the Server page WATCHED zone adapts `collectWatchedRows` output into `worker` rows via a small mapper in `watched-zone.tsx`; header unchanged). A `worker` row renders today's `WatchedRow`; when `done` the `<tr>` carries `opacity-50` and `data-done="true"`, the change cell appends a `done` marker, and — because the join excludes done items so the window carries no `monitored*` facets — change/stage/repo render from the item via an optional `facets` override; when `item.paused` a `paused` marker follows the stage badge. An `item` row (`data-testid="tracked-item-row"`) renders: status cell = kind chip (`bg-accent/10 text-accent`, text `item.kind` or `item`) + the id; session = `item.session` or `—`; change = `refs` joined with `, ` (truncated `max-w-[24ch]` + `Tip`) or `—`; awaiting = `paused` (yellow) / `done` / `pane gone` (pane set, no window) / `—`; note = `item.text` truncated (`max-w-[40ch]` dense, `24ch` otherwise) in a `Tip`, as a `<button aria-expanded data-testid="tracked-item-expand">` that toggles the cell to full `whitespace-pre-wrap` text and back; repo = optional repo basename + `Tip`, then `updated {age} ago` from `updatedAt` (fallback `added {age} ago`, else `—`). Item rows MUST NOT navigate; `stale` still dims the whole table; `dense` keeps all six columns.

- **GIVEN** a `worker` row that is done and an `item` note row with a 200-char `text`
- **WHEN** the table renders
- **THEN** the worker `<tr>` has `data-done="true"` and `opacity-50`, the note row shows the kind chip `note`, its id, truncated text, and no `watched-row-navigate` button
- **AND WHEN** the note's expand button is clicked, **THEN** `aria-expanded` flips to `true` and the full text is visible; clicking again collapses it

#### R6: `WatchedTasks` lists the tracked set with a count line and a `No tracked items` empty state
`WatchedTasks` SHALL derive `rows = collectTrackedRows(sessions) ?? collectWatchedRows(sessions)` mapped to `worker` rows (the older-backend fallback). When rows exist it SHALL render a summary line `data-testid="watched-tasks-summary"` reading `{N} tracked · {W} watched` where `N = rows.length` and `W` = worker rows that are not done, in `text-xs text-text-secondary font-mono`, below the staleness banner and above the table. The hint ladder becomes `no server resolved — watchlist unavailable` / `No operator on this server` / `No tracked items`; the Server page WATCHED zone keeps `No watched workers`. Banner, `data-testid`s, `dense`, and `onNavigate` are unchanged, and the two mount sites (`operator-console.tsx`, `app.tsx` mobile `tab=tasks`) need no edits.

- **GIVEN** sessions with an operator tick and `operatorTracked: []`
- **WHEN** `WatchedTasks` renders
- **THEN** the hint reads `No tracked items`
- **AND GIVEN** one live worker item and one note, **THEN** the summary reads `2 tracked · 1 watched`
- **AND GIVEN** a payload without `operatorTracked` but with a `monitored: true` window, **THEN** one worker row renders exactly as today

### Docs: spec

#### R7: The cron spec describes the whole-list Operator Tasks segment
`docs/specs/cron.md` SHALL be updated at: § UI tier 2 (Operator Tasks renders the operator's whole tracked list — workers as watched-table rows that navigate; pane-less items as item rows with kind, refs, text, paused/done state; done items dimmed until removed; the count matching `fab operator track list`), § Watchlist (the same read surfaces every tracked item for the Tasks tab, display only, never a fire input), and § Requirement: tolerant watchlist read (the reader returns every item with done/paused/timestamps; the JOIN takes the pane-bearing not-done subset; scenario extended with a note item that lands on `operatorTracked` and on no window's `monitored`). Memory files listed in the intake's Affected Memory are the hydrate stage's work, not this plan's.

- **GIVEN** the updated spec
- **WHEN** a reader looks for what Operator Tasks lists
- **THEN** the spec names the whole tracked set, the two row species, and the done-dimmed rule, and the reader requirement no longer says pane-less or done items are skipped

### Non-Goals

- No fab-kit change, no new state-file fields, rk never writes the file.
- No row actions (`track rm`/`update`/pause/ack); the list stays read-only.
- `monitored` semantics, `joinWatchlist`, the sidebar watched underbar, the `opr` register, and the Server page WATCHED zone are unchanged.
- No new route, no polling; `operatorTracked` rides the sessions payload.
- No kind-specific enrichment beyond the chip (e.g. a `github-pr` link).

### Design Decisions

#### The Operator Tasks list is the whole tracked set; the pane join stays pane-bearing and not-done
**Decision**: One tolerant read of the operator state file yields two projections — `Items` (every tracked item, for the Tasks segment, done items dimmed) and `WatchlistEntries()` (pane-bearing, not-done, for the `monitored` join). The Tasks segment lists `Items`; the sidebar underbar, `opr` register, and Server page WATCHED zone keep the join's meaning.
**Why**: A tab named Operator Tasks must show what `fab operator track list` reports, and a done note's text ("archive once merged") stays useful until the operator removes it; a done pane-bearing item must still not pin a watched row onto a finished pane.
**Rejected**: Renaming the tab to "Watched Workers" and keeping it workers-only (the user wants the task list); a separate `GET /api/operator/tracked` endpoint (the sessions payload already carries server-scoped operator facts on the SSE cadence, and fab caps note text at 500 chars).
*Introduced by*: 260911-xy8b-operator-tasks-lists-all-tracked-items

#### `operatorTracked` rides the sessions payload, stamped on every session
**Decision**: `ProjectSession.OperatorTracked` is stamped identically on every session of a server, like `operatorLastTickAt`/`operatorStale`, with `windowId` resolved server-side by pane.
**Why**: The Tasks segment stays a pure projection over data the frontend already holds; no new route, no client polling, no second clock; a missing key is the older-backend signal and the frontend falls back to the `monitored`-derived rows.
**Rejected**: A per-server top-level field (the sessions payload has no server envelope) or a dedicated endpoint (a second fetch path for a handful of items).
*Introduced by*: 260911-xy8b-operator-tasks-lists-all-tracked-items

## Tasks

### Phase 2: Core Implementation

- [x] T001 Reshape `app/backend/internal/cron/watchlist.go`: add `TrackedItem`, `OperatorState`, `ParseOperatorState`, `ReadOperatorState`, `OperatorState.WatchlistEntries()`; make `parseTrackedItems` return every id-bearing item (no pane/done/scope skip; `Text`, `Refs`, `Paused`, `DoneAt`/`AddedAt`/`UpdatedAt` via `parseTickAt`) and `parseMonitoredMap` return `TrackedItem`s sorted by key; remove `ParseWatchlist`/`ReadWatchlist`; rewrite the file-header contract comment (no change IDs or PR numbers) <!-- R1 R2 -->
- [x] T002 Update `app/backend/internal/cron/watchlist_test.go`: re-point `TestParseWatchlist` at `ParseOperatorState(...).WatchlistEntries()` with expectations unchanged; rename the `TestReadWatchlist*` round-trips to the new functions; add `TestParseOperatorStateItems` covering the live-file note shape, done pane-bearing item, paused item, scope-less item, mixed-type `refs`, list order vs sorted entries, legacy map items, malformed siblings skipped, unparseable `done_at` ⇒ live <!-- R1 R2 -->
- [x] T003 In `app/backend/internal/sessions/sessions.go`: add `OperatorTrackedItem` and `ProjectSession.OperatorTracked`; add pure helpers `paneToWindowMap(sessions)` and `projectTrackedItems(items, paneToWindow)` beside `joinWatchlist`; switch `FetchSessions` to `cron.ReadOperatorState`, build `watchlistByPane` from `state.WatchlistEntries()`, and stamp `OperatorTracked` on every `ProjectSession` alongside the tick facts; leave `joinWatchlist` untouched <!-- R3 -->
- [x] T004 Update `app/backend/internal/sessions/sessions_test.go`: keep `TestJoinWatchlist` as-is; add `TestProjectTrackedItems` (live pane ⇒ `WindowID`, dead pane ⇒ none, pane-less ⇒ none, field mapping); add `TestProjectSessionOperatorTrackedJSON` (camelCase, `omitempty`, omitted when nil); extend `TestFetchSessionsWatchlistSlug`'s fixture with a note item and assert it lands on every session's `OperatorTracked` while `Monitored` is unchanged <!-- R3 -->
- [x] T005 [P] Add `OperatorTrackedItem` and `ProjectSession.operatorTracked?` to `app/frontend/src/types.ts` with a doc comment noting server-scoped stamping, `windowId` resolution, display-only, and absence on older backends <!-- R4 -->
- [x] T006 Add `TrackedRow` and `collectTrackedRows` to `app/frontend/src/components/server-watched-zone/model.ts` (species split, ghost exclusion via `isGhostWindow`, ordering, `null` fallback) and create `app/frontend/src/components/server-watched-zone/model.test.ts` covering null fallback, worker vs item species, ghost ⇒ item, done ordering, list order for items <!-- R4 -->
- [x] T007 Rework `app/frontend/src/components/watched-table.tsx` to take `rows: TrackedRow[]`: `WatchedRow` gains `done`/`paused` rendering and an optional item `facets` override; add `TrackedItemRow` (kind chip + id, refs, awaiting states incl. `pane gone`, truncated text with `Tip` + `tracked-item-expand` toggle, repo + `updated/added … ago`); adapt `app/frontend/src/components/server-watched-zone/watched-zone.tsx` to map `collectWatchedRows` output into `worker` rows; extend `watched-table.test.tsx` (done row dimmed with `data-done`, item row cells, expand toggle, no navigate button on item rows) and confirm `watched-zone.test.tsx` passes unchanged <!-- R5 -->
- [x] T008 Update `app/frontend/src/components/watched-tasks.tsx`: derive rows via `collectTrackedRows` with the `collectWatchedRows` fallback, add the `watched-tasks-summary` line `{N} tracked · {W} watched`, change the empty hint to `No tracked items`; update `watched-tasks.test.tsx` (rename the `No watched workers` case, add note row, done `data-done`, summary text, expand reveals full text, older-backend fallback renders worker rows) <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T009 Extend `app/frontend/tests/e2e/operator-console.spec.ts`: `sessionsPayload(..., watched = true)` stamps `operatorTracked` (the `wuiu` worker item with `pane: "%2"`, `windowId: "@2"` and an `n3` note item with `refs`, `text`, `updatedAt`) on both sessions; extend the Tasks-segment test to assert one `watched-row` and one `tracked-item-row`, the note chip/id/truncated text, the summary `2 tracked · 1 watched`, that expanding the note does not navigate or close the drawer, and that the worker row click still navigates to `/default/2` and collapses the drawer; update the test's Proves/Steps JSDoc and the file-header fixture description in the same commit; leave the `?tab=tasks` deep-link test unchanged <!-- R5 R6 -->
- [x] T010 [P] Update `docs/specs/cron.md` at § UI tier 2 (Operator Tasks), § Watchlist, and § Requirement: tolerant watchlist read (+ scenario) per R7 <!-- R7 -->
- [x] T011 Run the gates through `just`: `just test-backend`, `just test-frontend`, `cd app/frontend && npx tsc --noEmit`, `just test-e2e "e2e/operator-console"`, `just test-e2e "e2e/server-watched-zone"`, `just test-e2e "e2e/mobile-cron-tabs"`; fix anything red that this change caused <!-- R1 R2 R3 R4 R5 R6 -->

## Execution Order

- T001 blocks T002 and T003; T003 blocks T004
- T005 blocks T006; T006 blocks T007 and T008; T007 blocks T008 (shared `TrackedRow` prop contract)
- T009 depends on T007 and T008; T010 is independent; T011 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ParseOperatorState`/`ReadOperatorState` exist and return every id-bearing `tracked:` item (pane-less, done, paused, scope-less) in list order with `Text`, `Refs`, `Paused`, `DoneAt`, `AddedAt`, `UpdatedAt` populated per the tolerant rules
- [x] A-002 R2: `WatchlistEntries()` returns the pane-bearing not-done subset sorted by ID; `ParseWatchlist`/`ReadWatchlist` are gone and `grep -rn 'ReadWatchlist\|ParseWatchlist' app/backend` is empty
- [x] A-003 R3: `ProjectSession.OperatorTracked` is stamped identically on every session with `WindowID` resolved by pane; `joinWatchlist` and the `Monitored*` fields are unchanged
- [x] A-004 R4: `collectTrackedRows` yields worker/item species in the specified order and returns `null` without `operatorTracked`; `collectWatchedRows`/`watchlistStatus` unchanged
- [x] A-005 R5: `WatchedTable` renders worker rows (done dimmed + `data-done`, paused marker, item facets for done workers) and item rows (kind chip, id, refs, awaiting states, truncated text with expand toggle, updated age) with no navigation on item rows
- [x] A-006 R6: `WatchedTasks` shows the `{N} tracked · {W} watched` summary, the `No tracked items` empty state, and falls back to `monitored`-derived worker rows on an older payload
- [x] A-007 R7: `docs/specs/cron.md` describes the whole-list Operator Tasks segment and the updated reader requirement

### Behavioral Correctness

- [x] A-008 R2: The 17 pre-existing `TestParseWatchlist` cases pass with unchanged expectations against `WatchlistEntries()`
- [x] A-009 R3: With the live-file shape (five notes, no panes), every session's `operatorTracked` has five items and no window is `monitored`
- [x] A-010 R6: The Server page WATCHED zone still lists only workers and still reads `No watched workers` when empty (`watched-zone.test.tsx` and `server-watched-zone.spec.ts` unchanged and green)

### Scenario Coverage

- [x] A-011 R1: `TestParseOperatorStateItems` covers the note shape, done item, paused item, scope-less item, mixed `refs`, order, legacy map, malformed siblings, unparseable `done_at`
- [x] A-012 R3: `TestProjectTrackedItems`, `TestProjectSessionOperatorTrackedJSON`, and the extended `TestFetchSessionsWatchlistSlug` exist and pass
- [x] A-013 R5: The extended `operator-console.spec.ts` Tasks test proves one worker row + one item row, the summary text, expand-without-navigate, and worker-row navigation; its JSDoc Proves/Steps and the file-header fixture comment are updated
- [x] A-014 R4: `model.test.ts` covers null fallback, species split, ghost exclusion, and ordering

### Edge Cases & Error Handling

- [x] A-015 R1: An absent or corrupt state file yields `present == false` and no `operatorTracked` key; a non-list `tracked:` yields no items
- [x] A-016 R5: A pane-bearing item whose pane no window carries renders as an item row with `pane gone`; a `windowId` naming a ghost window renders as an item row
- [x] A-017 R6: `operatorTracked: []` with an operator present renders `No tracked items`, not `No watched workers`

### Code Quality

- [x] A-018 Pattern consistency: New Go helpers are pure and unit-tested beside `joinWatchlist`; frontend derivation stays in `model.ts` with no fetch or timer; JSON tags camelCase `omitempty`
- [x] A-019 No unnecessary duplication: one parse feeds both projections; the WATCHED zone and the console share `WatchedTable`; no second reader of the state file
- [x] A-020 No client polling: `operatorTracked` rides the sessions SSE payload only
- [x] A-021 Comments state constraints, not narration; no change IDs or PR numbers in code comments
- [x] A-022 Tests run only through `just` recipes; Playwright intent JSDoc present on every touched `test()`
- [x] A-023 Type narrowing over assertions in the new TypeScript (discriminated `TrackedRow`, no `as` casts)

### Security

- [x] A-024 R1: rk never writes the operator state file; no new subprocess or shell string is introduced

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant; the `ParseWatchlist`/`ReadWatchlist` removal was planned under R2 and is verified by A-002, not a discovered candidate.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Memory updates (cron, tmux-sessions, ui/operator-console, ui/routes-and-shell, api-and-sockets) are the hydrate stage's work; only `docs/specs/cron.md` is an apply task | Pipeline stage ownership; intake § Affected Memory lists them for hydrate | S:85 R:95 A:95 D:90 |
| 2 | Confident | The `facets` override on `WatchedRow` is the mechanism for done worker rows whose window lost its `monitored*` fields | Intake § 4 names it; smallest change that keeps one row component | S:70 R:90 A:80 D:70 |
| 3 | Confident | The WATCHED zone adapts rows via a mapper in `watched-zone.tsx` rather than `WatchedTable` accepting two row shapes | Keeps one prop contract on the shared component; the adapter is a few lines | S:65 R:95 A:85 D:75 |
| 4 | Confident | `paneToWindowMap` is built once per fetch over all sessions before the per-session loop | A pane belongs to one window; building it once mirrors the single state-file read | S:70 R:95 A:90 D:85 |
| 5 | Confident | The e2e gate runs the three affected specs individually (`e2e/operator-console`, `e2e/server-watched-zone`, `e2e/mobile-cron-tabs`), not the whole suite | One spec per run avoids the filter/worktree-name collision; the full suite is `just test`'s job | S:70 R:95 A:85 D:80 |

5 assumptions (1 certain, 4 confident, 0 tentative).
