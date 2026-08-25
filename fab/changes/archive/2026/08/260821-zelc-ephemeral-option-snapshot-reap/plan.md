# Plan: Ephemeral Server Option — Snapshot Opt-Out + Reap

**Change**: 260821-zelc-ephemeral-option-snapshot-reap
**Intake**: `intake.md`

## Requirements

### Tmux: The `@rk_ephemeral` convention

#### R1: Option constant and reader in `internal/tmux`
A named constant `EphemeralOption = "@rk_ephemeral"` SHALL live in `app/backend/internal/tmux/tmux.go` alongside the other server-scoped option constants (`SessionOrderOption`, `ServerRankOption`, `OriginOption`), with a doc comment stating the convention: a server-scoped user option whose presence with a non-empty value (canonically `1`) marks the whole server ephemeral; unsetting it promotes the server back to durable; the option dies with the tmux server, so no consumer can read it post-mortem — `IsTestServerName` remains the dead-socket fallback (`IsTestServerName(name) ⇒ treated as ephemeral`).

A reader `IsEphemeralServer(ctx context.Context, server string) (bool, error)` SHALL wrap `show-option -sv @rk_ephemeral` via `tmuxExecRawServer` under `context.WithTimeout(ctx, TmuxTimeout)`, mirroring `GetServerOrigin`'s error taxonomy exactly: unset option (`invalid option`/`unknown option` stderr) OR dead/absent socket (`IsServerGone`) return `(false, nil)` — a gone server reads as not-ephemeral; other subprocess failures propagate wrapped. A non-empty trimmed value is truthy.

- **GIVEN** a live server with `set-option -s @rk_ephemeral 1`
- **WHEN** `IsEphemeralServer` runs
- **THEN** it returns `(true, nil)`

- **GIVEN** a live server where the option was never set or was unset with `-u`
- **WHEN** `IsEphemeralServer` runs
- **THEN** it returns `(false, nil)`

- **GIVEN** a dead or absent socket
- **WHEN** `IsEphemeralServer` runs
- **THEN** it returns `(false, nil)` — liveness is the caller's concern

### Snapshot: Opt-out

#### R2: Marked servers get no snapshot writes
The snapshotter (`app/backend/internal/snapshot/snapshotter.go`) SHALL skip snapshot writes for a server observed carrying `@rk_ephemeral`. The check lives in the snapshotter's per-server pass — NOT in the Supervisor's covered set (`Sockets()` is untouched; ephemeral servers stay live in SSE/UI). The ephemeral read SHALL happen only at points a write would happen (first observation and due passes) — never on every 2s tick — via an injectable `ephemeralFunc` seam on `Snapshotter` mirroring the existing `captureFunc` seam (production: `tmux.IsEphemeralServer`; tests inject a fake). A read error degrades to a log line and the pass proceeds as not-ephemeral.

- **GIVEN** a covered server marked `@rk_ephemeral 1`
- **WHEN** a due pass (event-driven or safety) runs for it
- **THEN** no capture or store write happens for that server, per-server bookkeeping still advances (the server is not re-read every tick), and the server remains in the covered set

- **GIVEN** the mark is later removed (`set-option -s -u @rk_ephemeral`)
- **WHEN** the next due pass observes it unmarked
- **THEN** snapshot coverage resumes with no other action

#### R3: Retire existing latest on first mark observation
`Store` (`app/backend/internal/snapshot/store.go`) SHALL gain `RetireLatest(server string) error` — an idempotent `os.Remove` of the latest path where a missing file is a no-op success; rolling history and tombstones are untouched (existing prune owns history). This is deliberately NOT a tombstone: tombstones mean "server died", retire means "never should have been covered". When the snapshotter observes the mark on a due pass, it SHALL call `RetireLatest` (under `writeMu`, honoring the `removedEpoch` drop rule like writes) so the latest written by the immediate first-observation snapshot is removed. Retire outcomes degrade to log lines, never crash the tick.

- **GIVEN** a new server that was snapshotted on first observation, then marked ephemeral seconds later
- **WHEN** the snapshotter next observes the mark
- **THEN** the server's `{server}.json` latest is removed, so a later death leaves nothing for `RestorableOffers` to offer

- **GIVEN** a marked server with no latest on disk
- **WHEN** retire runs again on a subsequent due pass
- **THEN** it is a no-op success (idempotent)

#### R4: No post-mortem defense forced into `RestorableOffers`
`RestorableOffers` (`restorable.go`) SHALL NOT grow an ephemeral filter: offers derive from dead servers whose option is unreadable post-mortem. The skip+retire pair (R2+R3) is the mechanism; the accepted residual race (marked and killed within ~one check interval before the mark is observed → one lingering offer) is backstopped by the independent Dismiss-all sibling and MUST NOT be over-engineered (no ephemeral flag stamped into the snapshot payload).

- **GIVEN** the residual race window
- **WHEN** a marked server dies before the snapshotter observes the mark
- **THEN** one offer may appear — accepted, no payload flag, no restorable-side filter

### Reaper: `--ephemeral` dimension

#### R5: Union match of prefix and live option-carrying servers
`rk mux reap --ephemeral` SHALL match the **union** of the existing prefix match (unchanged; bare invocation still defaults to prefix `rk-test`) and all **live** servers carrying `@rk_ephemeral`. The ephemeral set is enumerated in `ReapTestServers` (`app/backend/internal/tmux/reaper.go`) from live servers only — via the existing live-server listing (`ListServers`) so dead sockets are never queried (the resurrect-on-dead-socket rule) — then threaded into `reapCandidates` as data so `classifyReap` stays pure (an ephemeral-membership input alongside `prefix`; `probeNeeded` kept in lock-step). Dead sockets and `.lock` files remain prefix-only territory. Ephemeral matches are live servers, so they classify as kill.

- **GIVEN** a live server `echotest` carrying `@rk_ephemeral 1` and a dead socket `rk-test-old`
- **WHEN** `rk mux reap --ephemeral` runs (dry-run default)
- **THEN** the plan lists `echotest` (kill) via the option dimension AND `rk-test-old` (remove) via the default prefix — the union

- **GIVEN** `rk mux reap` without `--ephemeral`
- **WHEN** it runs
- **THEN** behavior is byte-identical to today (prefix-only)

#### R6: Inherited gates unchanged; guard scope stays prefix-only
Dry-run remains the default (`--yes`/`--force` to act), per-entry failure isolation holds, and `_rk-ctl` + `rk-daemon` stay unconditionally hard-skipped even when option-marked. The dangerous-prefix guard applies to the prefix dimension only — `--ephemeral` matches are explicit creator opt-in and need no length guard. The command's Long help SHALL carry the safety framing: the option is explicit opt-in set by the creator (safer than prefix guessing) and gives agents a sanctioned bulk-cleanup verb instead of raw `tmux kill-server`.

- **GIVEN** `rk-daemon` hypothetically carrying `@rk_ephemeral`
- **WHEN** `rk mux reap --ephemeral --yes` runs
- **THEN** `rk-daemon` is skipped unconditionally

- **GIVEN** `rk mux reap --ephemeral` with the default prefix
- **WHEN** it runs without `--yes`
- **THEN** nothing is touched; the union plan is printed

### Toolkit: Standards conformance

#### R7: New flag surface checked against toolkit standards
The grown `reap` flag surface (`--ephemeral`) MUST be checked against `shll standards` before finalizing — help-dump (the flag registers platform-stable and unhidden so the cobra tree walk publishes it; `Long:` updated) and Principle 9 (plan/summary output stays on the data channel; the existing 10-entry display caps cover option-matched entries with no new code).

- **GIVEN** the finished flag and help text
- **WHEN** `rk help-dump` runs
- **THEN** the `mux reap` entry carries `--ephemeral` with its help string, platform-stable

### Non-Goals

- Creation-verb integration and agent adoption docs — sibling `260821-hbmh` (stacks on this branch)
- API/frontend surfacing of ephemeral state — sibling `260821-l1qe` (stacks on this branch)
- Recovery-section Dismiss all — independent sibling `260821-f2b7`
- Replacing the `rk-test-*` name umbrella — it stays as the post-mortem/dead-socket fallback

### Design Decisions

#### Ephemeral read via an injectable snapshotter seam, not a ServerSource extension
**Decision**: `Snapshotter` gains an `ephemeralFunc func(ctx, server) (bool, error)` field (production: `tmux.IsEphemeralServer`), called only on due passes inside `snapshot()`/the pass path; the `ServerSource` interface is untouched.
**Why**: Mirrors the existing `captureFunc` test seam exactly (the suite already injects fakes); keeps option semantics in `internal/tmux` where all tmux interaction lives; satisfies the cost constraint by construction — reads happen only where writes would (first observation, event-due, safety-due), never per tick. Supervisor/tmuxctl stay ignorant of the convention.
**Rejected**: Extending `ServerSource` with an ephemeral query implemented by `*tmuxctl.Supervisor` — the control-mode Client has no existing cheap option-query path, so it would drag option semantics and new plumbing into tmuxctl for no cost win; per-tick reads — a subprocess every 2s per server violates the intake's explicit cost constraint.
*Introduced by*: 260821-zelc-ephemeral-option-snapshot-reap

#### Skipped pass advances bookkeeping
**Decision**: An ephemeral-skip pass reports success to the tick loop (bookkeeping `lastPass`/`writtenGen` advance), so a marked server is re-read only on generation movement or the safety cadence.
**Why**: Treating skip as failure would make the server due every tick — exactly the per-tick subprocess the cost constraint forbids. The safety cadence (60s) doubles as the un-mark detection bound, matching the intake's "coverage resumes on the next tick"-order-of-magnitude expectation.
**Rejected**: A separate ephemeral-state cache with its own refresh timer — more state for the same behavior the existing bookkeeping already provides.
*Introduced by*: 260821-zelc-ephemeral-option-snapshot-reap

#### Ephemeral set as caller-computed data into a pure classifier
**Decision**: `ReapTestServers` enumerates live servers and queries `IsEphemeralServer` per live server; `reapCandidates`/`classifyReap` receive the resulting name-set as data.
**Why**: Preserves `classifyReap`'s documented purity (the full matrix stays unit-testable with no tmux); dead sockets are never queried (a tmux command on a dead socket resurrects a server); the existing temp-dir + fake-prober seam tests extend naturally with a fake ephemeral set.
**Rejected**: Querying the option inside `classifyReap`/`reapCandidates` per candidate — breaks purity and probes dead sockets.
*Introduced by*: 260821-zelc-ephemeral-option-snapshot-reap

## Tasks

### Phase 1: Setup

- [x] T001 Add `EphemeralOption = "@rk_ephemeral"` constant with convention doc comment (server scope, truthy `1`, unset promotes, dies with server, `IsTestServerName` post-mortem fallback) beside `OriginOption` in `app/backend/internal/tmux/tmux.go` <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Implement `IsEphemeralServer(ctx, server) (bool, error)` in `app/backend/internal/tmux/tmux.go` mirroring `GetServerOrigin`'s `show-option -sv` read + unset/gone taxonomy (`(false, nil)` for unset and dead sockets; non-empty trimmed value = true) <!-- R1 -->
- [x] T003 [P] Unit tests for the reader in `app/backend/internal/tmux/tmux_test.go`: option set / unset / never set / gone server (follow the existing `GetServerRank`/`GetServerOrigin` test idiom) <!-- R1 -->
- [x] T004 [P] Add `Store.RetireLatest(server string) error` in `app/backend/internal/snapshot/store.go` (idempotent latest-file remove; missing file no-op success; history/tombstones untouched) + idempotency and history-preservation tests in `store_test.go` <!-- R3 -->
- [x] T005 Wire the ephemeral seam into `app/backend/internal/snapshot/snapshotter.go`: `ephemeralFunc` field (production default `tmux.IsEphemeralServer` adapted to the package), checked at due-pass time; marked server → skip capture/write, call `RetireLatest` under `writeMu` with the `removedEpoch` drop rule, report pass success so bookkeeping advances; read error logs and proceeds as not-ephemeral <!-- R2 -->
- [x] T006 Snapshotter tests in `app/backend/internal/snapshot/snapshotter_test.go` via the fake seam: marked server skips writes on due passes; retire fires when a mark is first observed after a first-observation snapshot; un-mark resumes coverage; bookkeeping advances on skip (no per-tick re-read) <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Extend the reaper core in `app/backend/internal/tmux/reaper.go`: `classifyReap` and `probeNeeded` gain ephemeral-membership input (hard-skips still first; union with prefix), `reapCandidates` accepts the ephemeral name-set <!-- R5 -->
- [x] T008 Extend `ReapTestServers` with the ephemeral dimension: when enabled, enumerate live servers (`ListServers`) and query `IsEphemeralServer` per live server (never dead sockets); thread the set through; per-entry query failures isolate per the existing failure rule <!-- R5 -->
- [x] T009 Add `--ephemeral` flag to `newReapCmd` in `app/backend/cmd/rk/reaper.go` with updated `Long:` help (union semantics, opt-in safety framing, sanctioned bulk-cleanup verb vs raw `tmux kill-server`); dry-run/`--yes`/`--force`/display-cap behavior unchanged <!-- R5, R6 -->
- [x] T010 Reaper tests in `app/backend/internal/tmux/reaper_test.go`: union dry-run plan (option-matched live server + prefix-matched dead socket), hard-skips win over the option, no-flag behavior unchanged, guard applies to prefix dimension only <!-- R5, R6 -->

### Phase 4: Polish

- [x] T011 Check the grown flag surface against `shll standards` (help-dump + Principle 9); verify `rk help-dump` publishes `mux reap --ephemeral`; run `just test-backend` full pass <!-- R7 -->

## Execution Order

- T002 blocks T005 and T008 (both consume the reader)
- T004 blocks T005 (retire call)
- T007 blocks T008 blocks T009/T010
- T003/T004 are parallel to each other after T001

## Acceptance

### Functional Completeness

- [x] A-001 R1: `tmux.EphemeralOption` constant and `IsEphemeralServer` reader exist in `internal/tmux` with the GetServerOrigin-mirrored taxonomy (unset/gone → `(false, nil)`)
- [x] A-002 R2: The snapshotter skips writes for marked servers via an injectable seam read only at due passes; `ServerSource`/Supervisor coverage untouched
- [x] A-003 R3: `Store.RetireLatest` exists, is idempotent, removes only the latest file, and is invoked on first mark observation under `writeMu`
- [x] A-004 R5: `rk mux reap --ephemeral` matches the union of prefix and live option-carrying servers; bare reap unchanged
- [x] A-005 R7: `--ephemeral` appears in `rk help-dump` output for `mux reap`, platform-stable and unhidden

### Behavioral Correctness

- [x] A-006 R2: Un-marking a server resumes snapshot coverage on a later due pass with no other action
- [x] A-007 R3: Retire is not a tombstone — no `.died-*` file is created and history is untouched
- [x] A-008 R6: `_rk-ctl` and `rk-daemon` are hard-skipped even when option-marked; the dangerous-prefix guard is not applied to the option dimension

### Scenario Coverage

- [x] A-009 R1: Reader unit tests cover set / unset / absent / gone-server cases
- [x] A-010 R2: Snapshotter tests prove skip + bookkeeping-advance (no per-tick re-read) via the fake seam
- [x] A-011 R3: Test proves the first-observation latest is removed once the mark is observed
- [x] A-012 R5: Reaper seam test shows a union dry-run plan with an option-matched live server labeled kill

### Edge Cases & Error Handling

- [x] A-013 R2: An ephemeral-read error degrades to a log line and the pass proceeds as not-ephemeral (never crashes the tick)
- [x] A-014 R4: No ephemeral filter was added to `RestorableOffers` and no flag was added to the snapshot payload (the accepted-race boundary)
- [x] A-015 R5: Dead sockets are never queried for the option (live-listing enumeration only)

### Code Quality

- [x] A-016 Pattern consistency: New code follows the surrounding idioms (option constants block, `tmuxExecRawServer` + `TmuxTimeout`, seam-injection test style)
- [x] A-017 No unnecessary duplication: Reader reuses `tmuxExecRawServer`/`IsServerGone`; retire reuses `latestPath`; no parallel option-parsing helper
- [x] A-018 All subprocess calls use `exec.CommandContext` argument slices with timeouts (Constitution I)
- [x] A-019 No magic strings: the option name appears only via `EphemeralOption`
- [x] A-020 Comments state constraints, not narration (per the anti-patterns list)
- [x] A-021 New behavior is test-covered (reader, skip, retire, reaper dimension) and `just test-backend` passes

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Ephemeral read seam = injectable `ephemeralFunc` on Snapshotter (read-at-due-pass), not a ServerSource extension | Intake Assumption 6 delegated this within the no-per-tick-subprocess constraint; mirrors the existing captureFunc seam and keeps tmuxctl ignorant of the convention | S:70 R:80 A:85 D:70 |
| 2 | Confident | Skip pass counts as success so bookkeeping advances; safety cadence (60s) bounds un-mark detection | Only reading at due passes satisfies the cost constraint; the intake's "resumes on the next tick" reads as next due pass, not next 2s tick | S:65 R:80 A:80 D:70 |
| 3 | Confident | Truthy = any non-empty trimmed option value ("1" documented as the convention) | Intake says "value `1` / non-empty per the existing option-parsing idiom"; matches how presence-style options are read elsewhere | S:70 R:85 A:80 D:75 |
| 4 | Certain | Ephemeral set computed by the caller from live servers only; classifyReap stays pure with the set as data | Purity is documented on classifyReap; the dead-socket-resurrection rule is established memory | S:85 R:85 A:90 D:85 |
| 5 | Confident | Ephemeral read lands at the head of `snapshot()` (before capture), covering both write points (capture + retire) under one removedEpoch check | First-observation and due passes all flow through `snapshot()`; one seam call site keeps the epoch read/check mirrored with the write path | S:70 R:80 A:85 D:75 |
| 6 | Confident | Retire pass under writeMu reports success when the server was removed mid-pass (epoch moved) — the tick drops that server's bookkeeping anyway, so a failure there would only re-read a dying server | Mirrors the write drop rule's "already part of the tombstone path" posture; retrying a removed server is pointless | S:60 R:75 A:75 D:65 |
| 7 | Confident | `ReapTestServers` gains `ephemeralOnly bool` as a 5th parameter (single call site in `cmd/rk/reaper.go`) rather than an options struct | One caller, one new dimension; the codebase's existing gate style is positional bools (`act, force`) | S:65 R:80 A:80 D:70 |
| 8 | Certain | `enumerateEphemeralServers` skips `_rk-ctl`/`rk-daemon` before querying the option — hard-skips must not even be read for the mark | The unconditional skip is the production-safety floor; querying them would resurrect no behavior but wastes subprocesses on guaranteed skips | S:80 R:85 A:90 D:85 |
| 9 | Confident | Help text routes the option name through `tmux.EphemeralOption` (fmt.Sprintf) so the magic string appears only via the constant (A-019) | The help text must name the option for discoverability; the constant keeps one source of truth | S:70 R:85 A:85 D:75 |
| 10 | Confident | No `--ephemeral` mention in `Short:` — the flag's own help string and `Long:` carry the surface; help-dump publishes it via the cobra tree walk | `Short:` stays the stable one-liner; R7 requires only that the flag registers platform-stable and unhidden | S:65 R:80 A:80 D:70 |

10 assumptions (2 certain, 8 confident, 0 tentative).

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.
