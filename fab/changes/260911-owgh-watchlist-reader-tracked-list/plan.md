# Plan: Read the fab operator watchlist from the 2.25 `tracked:` list

**Change**: 260911-owgh-watchlist-reader-tracked-list
**Intake**: `intake.md`

## Requirements

### Cron: operator watchlist reader

#### R1: `tracked:` list is the primary watchlist schema
`cron.ParseWatchlist` SHALL read the top-level `tracked:` list of the fab operator state file. Every list element that is a map with a non-empty string `id` and a non-empty `scope.pane` SHALL become a `WatchlistEntry` with `ChangeID = id`, `Pane = scope.pane`, `Repo = scope.repo`, `Session = scope.session`, `Stage = scope.stage`, `Agent = scope.agent`, `Branch = scope.branch`, `Kind = kind`. YAML `null` scope values read as `""`. `kind` is not a filter. Entries are returned sorted by `ChangeID`.

- **GIVEN** the live loom-shaped file (one `fab-change` item `pa9n`, `scope.pane: '%180'`, `stage: apply`, `agent: idle`, `last_tick_at` RFC3339)
- **WHEN** `ParseWatchlist` runs
- **THEN** it returns exactly one entry `{pa9n, %180, /home/sahil/code/wvrdz/loom, loom, apply, idle, 260911-pa9n-…, fab-change}` and the tick timestamp

#### R2: Skip and include rules
An item with no pane (`scope.pane` absent, null, or empty), a non-map element, a map without a string `id`, a non-map `scope`, or a non-null `done_at` SHALL be skipped. An item with `paused: true` SHALL be included. A non-list `tracked:` value SHALL yield no entries with `ok == true`.

- **GIVEN** a list with a pane-less queued fab-change, a `github-pr` item without a pane, a done item with a pane, a paused item with a pane, a scalar element, an id-less map, and a map whose `scope` is a string
- **WHEN** parsed
- **THEN** only the paused item is returned

#### R3: Legacy `monitored:` map is a one-release dual read
When the `tracked` key is ABSENT, `ParseWatchlist` SHALL parse the legacy `monitored:` map exactly as today (`Kind` left `""`). When the `tracked` key is PRESENT — even as an empty list — the `monitored:` map SHALL be ignored.

- **GIVEN** `monitored: {legacy: {pane: "%1"}}` and `tracked: [{id: new, kind: fab-change, scope: {pane: "%2"}}]`
- **WHEN** parsed
- **THEN** only `new` is returned

- **GIVEN** the same `monitored:` map and `tracked: []`
- **WHEN** parsed
- **THEN** no entries are returned

#### R4: Struct and comments
`WatchlistEntry` SHALL gain a trailing `Kind string` field; it is NOT plumbed onto `tmux.WindowInfo` or the payload. The file header EXTERNAL CONTRACT comment SHALL describe the `tracked:` schema (citing the kit migration 2.24.9→2.25.0 by name), the skip/include rules, the both-present rule, and the one-release dual read. Stale "monitored map" wording in `sessions.go` (~line 702) and `tmux.go` (~line 857) comments SHALL be updated. No PR numbers or change ids in code comments.

- **GIVEN** the change complete
- **WHEN** `grep -n 'monitored' app/backend/internal/sessions/sessions.go app/backend/internal/tmux/tmux.go` runs
- **THEN** no comment describes the reader's schema as a `monitored:` map

#### R5: Tests and gates
`watchlist_test.go` SHALL cover the nine cases in intake § 3 plus a `tracked:`-shaped round-trip, with every legacy case unchanged and passing. `just test-backend` SHALL pass (after `just _ensure-tmux-conf`).

- **GIVEN** the change complete
- **WHEN** `just test-backend` runs
- **THEN** all packages pass, including `internal/cron` and `internal/sessions`

### Non-Goals

- Rendering `kind`/`probe`/`paused`/`depends_on` in any UI surface; plumbing `Kind` to the payload
- fab-kit or its schema; the cron entry file; staleness semantics

### Design Decisions

#### Done items are skipped, paused items included, kind is not a filter
**Decision**: A tracked item is "watched" for the UI exactly when it has a pane and no `done_at`; `paused` and `kind` do not affect inclusion.
**Why**: The UI answers "is the operator watching this pane". A done-but-unacked item would pin a watched row onto a finished or dead pane; a paused item is still in the tracked set; only `fab-change` carries a pane probe today, so filtering on kind would encode a fab-kit implementation detail.
**Rejected**: Filtering to `kind: fab-change` (brittle to kit changes); including done items until `track rm` (misleading rows on dead panes).
*Introduced by*: 260911-owgh-watchlist-reader-tracked-list

#### `tracked` wins by key presence
**Decision**: The legacy `monitored:` map is read only when the `tracked` key is absent; `tracked: []` beside a stale map yields nothing.
**Why**: The binary deletes `monitored` in the same write that introduces `tracked`, so both-present is residue; falling back on an empty list would resurrect stale entries after the operator removes the last item.
**Rejected**: Merging both arms; falling back on emptiness.
*Introduced by*: 260911-owgh-watchlist-reader-tracked-list

## Tasks

### Phase 2: Core Implementation

- [x] T001 `app/backend/internal/cron/watchlist.go`: add `Kind` to `WatchlistEntry`; split `ParseWatchlist` into the `tracked` arm (`parseTrackedItems`, R1/R2 rules) and the legacy arm (`parseMonitoredMap`, today's loop verbatim), branching on `tracked` key presence (R3); rewrite the header EXTERNAL CONTRACT and struct doc comments (R4). <!-- R1, R2, R3, R4 -->
- [x] T002 [P] Comment-only touches: `app/backend/internal/sessions/sessions.go` (~702 "the monitored:-map join" → "the watchlist join") and `app/backend/internal/tmux/tmux.go` (~857 "the monitored map's key" → "the tracked item id"). <!-- R4 -->
- [x] T003 `app/backend/internal/cron/watchlist_test.go`: extend `TestParseWatchlist` with the nine intake § 3 cases (loom mirror, pane-less, done, paused, non-fab-change kind, malformed, non-list, both-present incl. `tracked: []`, sort) and add a `tracked:`-shaped `ReadWatchlist` round-trip; keep every legacy case. <!-- R5 -->
- [x] T004 Gates: `just _ensure-tmux-conf`; `just test-backend`; fix failures. <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: A loom-shaped `tracked:` file yields the one expected entry with all seven fields plus `Kind: fab-change` and the RFC3339 tick
- [x] A-002 R2: Pane-less, done, scalar, id-less, and string-scope items are skipped; paused items are included; non-list `tracked:` yields no entries with `ok == true`
- [x] A-003 R3: Legacy `monitored:` files parse exactly as before; with `tracked` present (even empty) the map is ignored
- [x] A-004 R4: `WatchlistEntry.Kind` exists, populated only by the tracked arm; header contract comment rewritten; `sessions.go`/`tmux.go` comments no longer say "monitored map"

### Behavioral Correctness

- [x] A-005 R1: Entries sort by `ChangeID` regardless of list order
- [x] A-006 R1: YAML `null` scope fields (`stage: null`, `agent: null`) read as `""`

### Scenario Coverage

- [x] A-007 R5: `TestParseWatchlist` carries the nine new cases and every legacy case; a `tracked:` round-trip exists
- [x] A-008 R5: `just test-backend` passes, including `internal/sessions` join tests

### Edge Cases & Error Handling

- [x] A-009 R2: Corrupt YAML still returns `ok == false`; an empty file still parses as present with nothing

### Code Quality

- [x] A-010 Pattern consistency: helpers follow `strField`/`parseTickAt` style; no god function (two named arms)
- [x] A-011 No unnecessary duplication: `strField` reused; legacy loop moved, not copied twice
- [x] A-012 Comments state constraints (load-bearing keys, skip rules, dual-read sunset) with no PR numbers or change ids
- [x] A-013 No route, payload, or frontend change; `Kind` not plumbed to `WindowInfo`

## Notes

- Check items as you review: `- [x]`
- Hydrate scope is intake § 4 and § Affected Memory

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `done_at` non-null test is `item["done_at"] != nil` | yaml.v3 decodes `null` to nil interface and a timestamp to `time.Time`/string | S:85 R:95 A:95 D:90 |
| 2 | Certain | Light lane: 4 tasks, apply/hydrate/ship inline, review dispatched | `_pipeline.md` fork rule (≤5 tasks) | S:95 R:95 A:95 D:95 |

2 assumptions (2 certain, 0 confident, 0 tentative).
