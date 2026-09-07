# Plan: Cron API + Derivations (watchlist + staleness onto sessions)

**Change**: 260907-1jm6-cron-api-derivations
**Intake**: `intake.md`

## Requirements

### Cron Derivation (`internal/cron`)

#### R1: Exported per-entry schedule derivation
`internal/cron` SHALL expose a new function computing, per entry, the next-fire time, backoff
rung, orphaned status, and last-fired timestamp — reusing `JoinAnchor`, `Ladder.NextFire`,
`everyAnchor`/`everyDue`, and `LastDelivery` rather than reimplementing any of their math. A
`cron`-kind (5-field expression) entry SHALL report no next-fire (unevaluated this wave) rather
than a fabricated value.

- **GIVEN** a `backoff` entry with `min: 60s, max: 30m`, deliveries at T+1m and T+3m, and a raw idle
  epoch 5s after T+3m
- **WHEN** derived at time T+3m+10s
- **THEN** the result reports rung 3 and next-fire T+7m (the same `JoinAnchor`/`Ladder` result
  `docs/memory/run-kit/cron.md`'s Backoff anchor-join scenario already pins)
- **AND GIVEN** an `every` entry with `interval: 1h` and its newest delivery at T
- **WHEN** derived at T+30m
- **THEN** next-fire is T+1h and rung is 0
- **AND GIVEN** a `cron`-kind entry
- **WHEN** derived
- **THEN** no next-fire is reported (a zero value / `hasNextFire: false`), never a fabricated time

#### R2: Watchlist reader over the fab-owned operator-state file
`internal/cron` SHALL expose a new tolerant reader parsing the `monitored:` map (pane, repo,
session, stage, agent, branch — the verified `monitoredEntry` schema from fab-kit's
`operator_state.go`) plus `last_tick_at`, reusing `FabOperatorStatePath` for path resolution. An
absent or YAML-parse-failed file SHALL degrade to an empty result (no entries, `lastTickAt: 0`,
`present: false`) — never an error. A `monitored` entry missing its `pane` field SHALL be skipped
(nothing to join against) rather than failing the whole read.

- **GIVEN** a state file with `monitored: {gmcp: {pane: "%23", repo: /r, session: s1, stage: active,
  agent: active, branch: b}}`
- **WHEN** read
- **THEN** one `WatchlistEntry{ChangeID: "gmcp", Pane: "%23", ...}` is returned
- **AND GIVEN** the file is absent
- **WHEN** read
- **THEN** `(nil, 0, false)` is returned, never an error

### HTTP Read API

#### R3: `GET /api/cron?server=<slug>`
The API SHALL expose `GET /api/cron?server=<slug>` returning `{"entries": [...]}`, one element per
entry combining its intent fields (id, name, schedule, wakeOn, target, payload, deliver, ifAbsent,
pinned, muted) with the derived fields from R1 (nextFire, rung, orphaned, lastFired), all in
camelCase JSON. An absent or empty entry file SHALL yield `{"entries": []}` at 200 — never 404.
Corrupt-entry diagnostics from `cron.LoadEntries` SHALL be logged server-side and never surfaced to
the client.

- **GIVEN** a server with two valid entries and one entry with an unknown schedule kind
- **WHEN** `GET /api/cron?server=<slug>` is called
- **THEN** the response carries the two valid entries with their derived fields, 200, and the
  corrupt entry is logged (not returned, not a client error)
- **AND GIVEN** no entry file exists for the server
- **WHEN** called
- **THEN** the response is `{"entries": []}`, 200

### HTTP Mutation API

#### R4: `POST /api/cron/create`
The API SHALL expose `POST /api/cron/create` accepting the `rk cron add` schema fields (name,
schedule, target, payload, deliver, ifAbsent, pinned), validating and adding the entry via
`cron.Add`, and returning the created entry (with its assigned 4-char id) at 201. A body that fails
`Entry.validate()` SHALL be a 400 with the validation error text.

- **GIVEN** a valid create body for a `backoff` role-target entry
- **WHEN** `POST /api/cron/create` is called
- **THEN** the entry is persisted via `cron.Add`, the response is 201 with the assigned id, and the
  SSE hub is woken for the server (R9)
- **AND GIVEN** a body with an invalid schedule (e.g. `every` with a zero interval)
- **WHEN** called
- **THEN** the response is 400 and no entry is persisted

#### R5: `POST /api/cron/delete`
The API SHALL expose `POST /api/cron/delete` ← `{"id": "<4char>"}`, removing the entry via
`cron.Remove`. An unknown id SHALL be a 404; success SHALL be 200 `{"ok": true}`.

- **GIVEN** an existing entry id
- **WHEN** `POST /api/cron/delete` is called with that id
- **THEN** the entry is removed, response 200, SSE hub woken (R9)
- **AND GIVEN** an id with no matching entry
- **WHEN** called
- **THEN** response is 404, no file mutation

#### R6: `POST /api/cron/mute`
The API SHALL expose `POST /api/cron/mute` ← `{"id": "<4char>", "muted": <bool>}`, setting the
entry's muted flag via `cron.SetMuted`. An unknown id SHALL be a 404; success SHALL be 200
`{"ok": true}`.

- **GIVEN** an existing entry id
- **WHEN** `POST /api/cron/mute` is called with `{"muted": true}`
- **THEN** the entry's `muted` field is set true, response 200, SSE hub woken (R9)
- **AND GIVEN** an unknown id
- **WHEN** called
- **THEN** response is 404

#### R9: Explicit SSE-hub wake on every mutation
Every one of R4/R5/R6's mutation handlers SHALL wake the SSE hub for the mutated server on success,
via `s.initSSEHub(); s.sseHub.wake(server)` — the same pattern already used by
`handleSessionStringOption` (`app/backend/api/sessions.go:141-145`) — because file writes and
user-option-class mutations emit no tmux control-mode event.

- **GIVEN** a successful create/delete/mute call
- **WHEN** the handler returns 2xx
- **THEN** `sseHub.wake(server)` was called exactly once for that server

### Sessions Payload Join

#### R7: Watchlist joined onto `WindowInfo` by pane ID
`tmux.WindowInfo` SHALL gain `Monitored bool`, `MonitoredChange`, `MonitoredStage`,
`MonitoredRepo`, `MonitoredBranch`, `MonitoredAgent string` fields (camelCase JSON, `omitempty`).
`sessions.FetchSessions` SHALL populate them, per window, when any of that window's panes' `PaneID`
matches a `WatchlistEntry.Pane` from one `cron.ReadWatchlist` call per `FetchSessions` invocation
(mirroring the existing per-pane fab-tier join already documented at
`docs/memory/run-kit/tmux-sessions.md` § Fab-Tier Derivation).

- **GIVEN** a window with pane `%23` and a watchlist entry `{ChangeID: "gmcp", Pane: "%23", Stage:
  "active", ...}`
- **WHEN** `FetchSessions` runs
- **THEN** that window's `Monitored` is true and `MonitoredChange`/`MonitoredStage`/etc. carry the
  entry's fields
- **AND GIVEN** no pane matches any watchlist entry
- **WHEN** `FetchSessions` runs
- **THEN** `Monitored` is false (zero value) on every window

#### R8: Staleness surfaced on every `ProjectSession`
`sessions.ProjectSession` SHALL gain `OperatorLastTickAt int64` and `OperatorStale bool` fields
(`omitempty`), populated identically on every session returned for one server from the same
`cron.ReadWatchlist` call's `lastTickAt`, using `DefaultWatchlistStaleThreshold` to compute
`OperatorStale`.

- **GIVEN** an operator-state file with `last_tick_at` older than `DefaultWatchlistStaleThreshold`
- **WHEN** `FetchSessions` runs for that server
- **THEN** every returned `ProjectSession` carries the same `OperatorLastTickAt` and
  `OperatorStale: true`
- **AND GIVEN** an absent operator-state file
- **WHEN** `FetchSessions` runs
- **THEN** `OperatorLastTickAt` is 0 and `OperatorStale` is false (nothing to be stale about)

### Non-Goals

- TTL-based orphan expiry/GC (7d, `pinned`-exempt) — C8 (wave 4) scope; R1's `orphaned` flag is a
  live per-tick snapshot only, never a persisted expiry state.
- `POST /api/cron/pin` — stays CLI-only this wave (`cron.SetPinned` exists, unused by any handler
  after this change); see Design Decisions.
- Any frontend/UI consumption of this surface — C6 (desktop)/C7 (mobile), later wave-3 changes.
- `cron`-kind (5-field expression) schedule evaluation — still unevaluated (C9); R1 only ensures
  such entries never report a fabricated next-fire.

### Design Decisions

#### Derivation logic lives in `internal/cron`, not the `api` package
**Decision**: `DeriveEntry` (next-fire/rung/orphaned/last-fired, R1) is a new exported function in
`internal/cron`; the API handler (R3) is a thin JSON translation layer over it.
**Why**: `internal/cron` already owns every piece of the underlying math (`JoinAnchor`,
`Ladder.NextFire`, `everyAnchor`/`everyDue`, `LastDelivery`); keeping the derivation there matches
the existing package boundary and keeps the projection logic testable independent of HTTP.
**Rejected**: inlining the derivation in `api/cron.go` — duplicates package-private schedule math
or forces exporting internals purely for one caller.
*Introduced by*: 260907-1jm6-cron-api-derivations

#### Watchlist staleness attaches to every `ProjectSession`, not only the `Hidden` operator session
**Decision**: R8's `OperatorLastTickAt`/`OperatorStale` populate identically on every session
returned for one server, rather than only the `Hidden` operator session.
**Why**: simpler consumer contract for C6/C7 — no special-casing to locate the `Hidden` session
first; the repeated bytes are negligible (one int64 + one bool × a handful of sessions per server).
**Rejected**: attaching only to the `Hidden` operator session — matches its "operator row's own
data source" precedent more narrowly, but forces every consumer to filter for it first.
*Introduced by*: 260907-1jm6-cron-api-derivations

#### `pin` gets no HTTP endpoint this wave
**Decision**: only `create`/`delete`/`mute` (R4-R6) get POST routes; `cron.SetPinned` stays
CLI-only.
**Why**: the operator dispatch's enumeration is exact (`create|delete|mute`); C6's row actions
never list pin.
**Rejected**: adding `POST /api/cron/pin` preemptively — speculative surface with no consumer this
wave.
*Introduced by*: 260907-1jm6-cron-api-derivations

#### Watchlist staleness threshold defaults to 15 minutes
**Decision**: a new named constant `DefaultWatchlistStaleThreshold` (15m) gates R8's
`OperatorStale`.
**Why**: the spec names `last_tick_at` as "the single staleness timestamp" but gives no number; a
named constant (mirroring `DefaultOperatorLoopFreshThreshold`'s pattern) keeps the value a
one-line change later.
**Rejected**: reusing `DefaultOperatorLoopFreshThreshold` (120s) directly — that threshold answers
a different, much-shorter-fuse question ("is the in-session `/loop` still ticking") and would
false-trip watchlist staleness constantly.
*Introduced by*: 260907-1jm6-cron-api-derivations

## Tasks

### Phase 1: Setup

- [x] T001 [P] Add `WatchlistEntry` struct + `ReadWatchlist(path string) (entries []WatchlistEntry, lastTickAt int64, present bool)` to new `app/backend/internal/cron/watchlist.go`, tolerantly parsing the `monitored:` map (pane/repo/session/stage/agent/branch, per the verified fab-kit `monitoredEntry` schema) and `last_tick_at`, reusing `FabOperatorStatePath` <!-- R2 -->
- [x] T002 [P] Add `DefaultWatchlistStaleThreshold` (15m) named constant to `app/backend/internal/cron/watchlist.go` <!-- R8 -->

### Phase 2: Core Implementation

- [x] T003 Add `DerivedEntry` struct + `DeriveEntry(e Entry, log []LogLine, facts TargetFacts, now time.Time) DerivedEntry` to new `app/backend/internal/cron/derive.go`, computing `NextFire`/`HasNextFire`/`Rung`/`Orphaned`/`LastFired` by calling `JoinAnchor`, `Ladder.NextFire`, `everyAnchor`/`everyDue`, and `LastDelivery` (no reimplementation) <!-- R1 -->
- [x] T004 Implement `handleCronList` (`GET /api/cron`) in new `app/backend/api/cron.go`: `cron.LoadEntries` + `cron.ReadLog` + `cron.GatherFacts` + `cron.DeriveEntry` per entry, camelCase JSON `{"entries": [...]}`; register `r.Get("/api/cron", s.handleCronList)` in `app/backend/api/router.go` <!-- R3 -->
- [x] T005 Implement `handleCronCreate` (`POST /api/cron/create`) in `app/backend/api/cron.go`: decode body → `cron.Entry`, `cron.Add`, `s.initSSEHub(); s.sseHub.wake(server)`, 201 with created entry; register `r.Post("/api/cron/create", s.handleCronCreate)` <!-- R4 -->
- [x] T006 Implement `handleCronDelete` (`POST /api/cron/delete`) in `app/backend/api/cron.go`: decode `{id}`, `cron.Remove`, 404/200 + SSE wake; register `r.Post("/api/cron/delete", s.handleCronDelete)` <!-- R5 -->
- [x] T007 Implement `handleCronMute` (`POST /api/cron/mute`) in `app/backend/api/cron.go`: decode `{id, muted}`, `cron.SetMuted`, 404/200 + SSE wake; register `r.Post("/api/cron/mute", s.handleCronMute)` <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Add `Monitored`/`MonitoredChange`/`MonitoredStage`/`MonitoredRepo`/`MonitoredBranch`/`MonitoredAgent` fields to `tmux.WindowInfo` in `app/backend/internal/tmux/tmux.go` (camelCase JSON, `omitempty`, alongside the existing `FabChange`/`FabStage` fields) <!-- R7 -->
- [x] T009 Add `OperatorLastTickAt`/`OperatorStale` fields to `sessions.ProjectSession` in `app/backend/internal/sessions/sessions.go` <!-- R8 -->
- [x] T010 Wire the per-pane watchlist join into `FetchSessions` (`app/backend/internal/sessions/sessions.go`): one `cron.ReadWatchlist` call per invocation, map lookup by `PaneID`, roll up `Monitored*` fields onto each window <!-- R7 -->
- [x] T011 Populate `OperatorLastTickAt`/`OperatorStale` on every `ProjectSession` in the same `FetchSessions` call from T010's `ReadWatchlist` result, using `DefaultWatchlistStaleThreshold` <!-- R8 -->

### Phase 4: Tests

- [x] T012 [P] Add `app/backend/internal/cron/watchlist_test.go`: tolerant-parse table (absent file, corrupt YAML, populated `monitored:` map fixture matching the verified fab-kit schema, an entry missing `pane` skipped) <!-- R2 -->
- [x] T013 [P] Add `app/backend/internal/cron/derive_test.go`: next-fire/rung for `backoff` and `every` entries (reusing `backoff_test.go`/`schedule_test.go` fixtures), orphaned flag on an unresolved target, last-fired from the log, no-next-fire for `cron`-kind <!-- R1 -->
- [x] T014 Add `app/backend/api/cron_test.go`: `GET /api/cron` (empty + populated + corrupt-entry-skipped cases), `POST /api/cron/create|delete|mute` (happy path, 400/404 cases, SSE-wake assertion) against `NewTestRouter` <!-- R3 -->
- [x] T015 Add `sessions_test.go` coverage in `app/backend/internal/sessions/`: a pane-ID match populates `Monitored*` fields; `OperatorLastTickAt`/`OperatorStale` populated identically across all sessions for a server <!-- R7 -->

## Execution Order

- T001 blocks T010, T012
- T002 blocks T011
- T003 blocks T004, T013
- T008 blocks T010, T015
- T009 blocks T011, T015
- T004-T007 block T014
- T010-T011 block T015

## Acceptance

### Functional Completeness

- [x] A-001 R1: `GET /api/cron` surfaces `nextFire`/`rung`/`orphaned`/`lastFired` per entry, matching `DeriveEntry`'s computed values for `backoff` and `every` schedules, and no fabricated next-fire for `cron`-kind entries
- [x] A-002 R2: `ReadWatchlist` correctly parses a populated `monitored:` map (pane/repo/session/stage/agent/branch) matching the verified fab-kit `monitoredEntry` schema
- [x] A-003 R3: `GET /api/cron?server=<slug>` returns `{"entries": []}` (200) for an absent/empty entry file, never 404
- [x] A-004 R4: `POST /api/cron/create` adds a valid entry via `cron.Add` and returns it with an assigned id at 201; an invalid body is a 400
- [x] A-005 R5: `POST /api/cron/delete` removes an entry by id (200) and 404s on an unknown id
- [x] A-006 R6: `POST /api/cron/mute` sets the muted flag by id (200) and 404s on an unknown id
- [x] A-007 R7: a window whose live pane ID matches a watchlist entry's pane carries `Monitored: true` plus the joined change/stage/repo/branch/agent fields
- [x] A-008 R8: every `ProjectSession` in one `FetchSessions` call carries the same `OperatorLastTickAt`/`OperatorStale` values, derived from the server's operator-state file

### Behavioral Correctness

- [x] A-009 R9: every one of the three mutation routes wakes the SSE hub (`s.initSSEHub(); s.sseHub.wake(server)`) on success, mirroring `handleSessionStringOption`'s pattern
- [x] A-010 R1: `rung` and `nextFire` for a `backoff` entry match `cron.JoinAnchor`'s existing anchor-join semantics — no reimplementation or divergence of the ladder math

### Scenario Coverage

- [x] A-011 R3: the GIVEN/WHEN/THEN scenario for `GET /api/cron` (populated + empty + corrupt-entry cases) is exercised by `api/cron_test.go`
- [x] A-012 R7: the GIVEN/WHEN/THEN scenario for the pane-ID join is exercised by `sessions_test.go` with a fixture watchlist file

### Edge Cases & Error Handling

- [x] A-013 R2: an absent or corrupt fab-operator-state file degrades `ReadWatchlist` to `(nil, 0, false)` — never an error, never a panic
- [x] A-014 R1: a `cron`-kind entry reports no next-fire/rung (zero value / `hasNextFire: false`) rather than a fabricated value
- [x] A-015 R3-R6: corrupt entries in the entry file are logged server-side (`slog`) and never surfaced as a client-facing error on any of the four routes

### Code Quality

- [x] A-016 Pattern consistency: new handlers follow the existing `api/*.go` handler shape (`writeJSON`/`writeError`, `serverFromRequest`, chi routing)
- [x] A-017 No unnecessary duplication: schedule/derivation math reuses `JoinAnchor`/`Ladder`/`everyAnchor`/`LastDelivery` rather than reimplementing them in the `api` package or `internal/cron`
- [x] A-018 Go backend: all cron/tmux interaction continues to route through `internal/cron`'s `TmuxSeam` / `internal/tmux` — no new ad-hoc `exec` calls
- [x] A-019 New features include tests covering the added/changed behavior (per `code-quality.md`) — satisfied by T012-T015

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `GET /api/cron?server=<slug>` returns `{"entries": [...]}` with derived `nextFire`/`rung`/`orphaned`/`lastFired` per entry | Spec + plan's C5 row state this verbatim; `cron_list.go`'s own doc comment defers this exact work to "the API wave" | S:90 R:70 A:95 D:90 |
| 2 | Certain | Three POST routes — `create`/`delete`/`mute` — mutate via existing `cron.Add`/`Remove`/`SetMuted`; POST-only | Constitution IX; operator dispatch names these three exactly | S:90 R:75 A:95 D:95 |
| 3 | Certain | Every mutation wakes the SSE hub via `s.initSSEHub(); s.sseHub.wake(server)` | Spec quote + the exact reusable pattern in `sessions.go:141-145` | S:95 R:80 A:95 D:95 |
| 4 | Certain | The fab `monitored:` schema is `{pane, repo, session, stage, agent, branch, ...}` keyed by an opaque map key | Verified directly against fab-kit's `operator_state.go` and a live populated state file | S:95 R:70 A:95 D:90 |
| 5 | Confident | `ReadWatchlist` is a sibling to `guards.go`'s `ReadOperatorState`, not a modification of it | Keeps the guard-evaluation path (heavily tested) untouched; strict superset read of the same file for a different consumer | S:65 R:80 A:80 D:70 |
| 6 | Confident | Derivation logic (`DeriveEntry`) is a new exported function in `internal/cron`, not inlined in `api` | Matches the existing package boundary; keeps projection logic testable independent of HTTP | S:60 R:75 A:85 D:75 |
| 7 | Confident | Staleness fields attach to every `ProjectSession`, not only the `Hidden` operator session | Simpler consumer contract; `Hidden`'s doc comment covers other data, not this | S:50 R:80 A:70 D:55 |
| 8 | Tentative | Staleness threshold defaults to 15 minutes via a new named constant | No number given in the spec; a named constant keeps it a one-line change later | S:30 R:85 A:35 D:35 |
| 9 | Confident | `pin` gets no HTTP endpoint this wave | Dispatch enumerates exactly `create|delete|mute` | S:70 R:85 A:60 D:60 |
| 10 | Confident | New derivation logic lives in a new file `derive.go`, not appended to `schedule.go`/`backoff.go` | Keeps read/list-derived concerns file-scoped from mutate-derived ones; trivial to relocate later | S:60 R:85 A:75 D:65 |
| 11 | Certain | The create handler sets `CreatedBy.At = now` unconditionally | `cron_add.go`'s `cronAddTarget` rule: `created_by.at` is always "now" — it anchors `every` schedules pre-first-delivery; a zero value would anchor at the Unix epoch and fire at once | S:90 R:70 A:95 D:90 |
| 12 | Confident | `cron.GatherFactsLive` is the exported production `GatherFacts` binding; the API `Server` holds a `cronFactsFn` function field (nil on the test router) wired to it in `NewRouterAndServer` | `realTmux` stays package-private so `internal/cron` tests keep substituting fakes; the function-field seam is the `refreshCollectorFn`/`refreshBranchFn` injection pattern already on `Server` | S:70 R:80 A:80 D:75 |
| 13 | Confident | Any `cron.Add` error surfaces as 400 (validation text, max-entries, and corrupt-file refusal share the client-facing posture) | R4 pins validation ⇒ 400; Add's remaining errors are operator-actionable and their text is precise; distinguishing them would require exporting error classes for one caller | S:55 R:80 A:70 D:60 |
| 14 | Confident | R7/R8 unit coverage lands on the factored pure helpers `joinWatchlist`/`operatorStaleness` plus a `ProjectSession` JSON payload-contract test, not on `FetchSessions` end-to-end | `FetchSessions` has no tmux test seam in `internal/sessions` (no existing test calls it); pure-helper factoring is the package's established testable shape (`foldViewers`, `operatorSessionHidden`, `rollupAgentState`) | S:55 R:85 A:75 D:65 |
| 15 | Confident | `nextFire` is `omitempty` (absent when `HasNextFire` is false); `lastFired` is a plain int64 with 0 = never | Intake's example shape plus the API's camelCase/`omitempty` convention; a fabricated zero next-fire would violate the cron-kind rule | S:60 R:80 A:75 D:65 |

15 assumptions (5 certain, 9 confident, 1 tentative).
