# Plan: Prevent exit-empty tmux server death

**Change**: 260602-a1wo-prevent-exit-empty-server-death
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

### tmuxctl: Permanent anchor floor

#### R1: The `_rk-ctl` anchor is always created as a permanent session floor
`resolveBootstrap` SHALL always ensure the `_rk-ctl` anchor session exists on
every tmux server run-kit attaches control-mode to, regardless of how many real
user sessions are present. Anchor creation MUST be idempotent: a "duplicate
session" error (concurrent `rk serve` won the race) MUST be treated as benign.

- **GIVEN** a tmux server that already has one or more real user sessions
- **WHEN** run-kit opens a control-mode client and runs `resolveBootstrap`
- **THEN** the `_rk-ctl` anchor session exists on that server afterward
- **AND** the keepalive marker option is set on it (non-fatal if it fails)

#### R2: The control-mode attach target prefers a real session, else the anchor
`resolveBootstrap` SHALL return the first existing real session as the attach
target when one exists, and SHALL return `_rk-ctl` only when no real session is
present. This decouples "session floor" (always created — R1) from "attach
target" (conditional).

- **GIVEN** a server with at least one real session
- **WHEN** `resolveBootstrap` runs
- **THEN** it returns that real session's name as the attach target
- **AND** the anchor still exists (R1) even though it is not the attach target
- **GIVEN** a server with zero real sessions
- **WHEN** `resolveBootstrap` runs
- **THEN** it returns `_rk-ctl` as the attach target

### tmux: exit-empty backstop

#### R3: `exit-empty off` is set imperatively on every server run-kit touches
run-kit SHALL set `set-option -g exit-empty off` (server-scoped) on every tmux
socket it dials control-mode against, including hand-created/foreign servers
that never received the embedded `tmux.conf` via `-f`. This MUST be applied
BEFORE the anchor is created on each dial so no reapable zero-session window
exists during the restart/reconnect close-then-reopen gap (edge case A).

- **GIVEN** a foreign tmux server created by hand (default `exit-empty on`)
- **WHEN** run-kit dials control-mode against it
- **THEN** `exit-empty` is `off` on that server
- **AND** the option was set before `createAnchor` ran on that dial

#### R4: The embedded `tmux.conf` also sets `exit-empty off` (belt-and-suspenders)
The embedded default tmux config applied via `-f` on run-kit-created servers
SHALL also carry `set -g exit-empty off`, so run-kit-created servers get the
floor immediately at server birth even before the first control-mode dial.

- **GIVEN** a server created by `rk` with the embedded config
- **WHEN** the server starts
- **THEN** `exit-empty` is `off` from the config alone

### Lifetime contract & observability

#### R5: A managed server dies only via explicit kill
A managed tmux server SHALL be torn down ONLY via `kill-server` / `rk reaper`.
Empty (anchor-only) servers persist by design. This change SHALL NOT add any
auto-reaping of anchor-only servers, and SHALL NOT add cross-process
refcounting or shared state (Constitution II).

- **GIVEN** a server whose last real session and relays have all closed, leaving
  only `_rk-ctl`
- **WHEN** the next relay disconnects / time passes
- **THEN** the server persists (it is not reaped by run-kit)

#### R6: The relay startup sweep never reaps `_rk-ctl`
The relay startup sweep SHALL never reap the `_rk-ctl` anchor (prefix guard +
explicit name guard), and this MUST remain covered by a regression test.

- **GIVEN** a server holding `_rk-ctl` plus orphan `rk-relay-*` ephemerals
- **WHEN** `sweepOrphanedRelaySessions` runs
- **THEN** orphan relays are reaped and `_rk-ctl` survives

#### R7: The deferred-fix comment references this change
The `app/backend/api/sse.go` block comment that previously said prevention "is a
separate change" SHALL be updated to reference this change as the
implementation. The observability WARN itself SHALL be kept as defense-in-depth.

- **GIVEN** the real-session-disappearance WARN block in `sse.go`
- **WHEN** a reader inspects the comment
- **THEN** it names this change as the prevention implementation and the WARN
  still fires

### Design Decisions

1. **Single canonical site for `exit-empty off` = `productionDial`** (the
   tmuxctl dialFn), invoked just before `resolveBootstrap`. — *Why*: `productionDial`
   runs on the initial dial AND on every reconnect in the Client read-loop FSM,
   so the floor is re-asserted before `createAnchor` on every (re)connect —
   exactly satisfying ordering A. The actual tmux exec lives in an
   `internal/tmux` helper (`SetExitEmptyOff`) so it is unit-testable in
   isolation. — *Rejected*: `openSocket` (intake assumption #8's lean) — it runs
   only once per socket-appearance and does NOT re-run on the Client's internal
   reconnect, so it would leave the reconnect window uncovered.
2. **Anchor floor always created; attach target unchanged** — *Why*: minimal
   diff, zero event-scope risk (`%session-window-changed` is global). —
   *Rejected*: always-attach-to-anchor (larger diff, no benefit).
3. **No auto-reaping of anchor-only servers** — *Why*: Constitution II forbids
   the cross-process shared state required to know "I am the last rk that wants
   this anchor." — *Rejected*: refcounted teardown.

## Tasks

### Phase 1: tmux exit-empty helper

- [x] T001 Add `SetExitEmptyOff(ctx, server)` to `app/backend/internal/tmux/tmux.go` — runs `tmux [-L server] set-option -g exit-empty off` via the existing `tmuxExecServer`/`serverArgs` exec pattern (no shell strings, ctx-scoped). <!-- R3 -->
- [x] T002 [P] Add `set -g exit-empty off` to the embedded config `configs/tmux/default.conf` (and the build copy `app/backend/build/tmux.conf`). <!-- R4 -->

### Phase 2: tmuxctl anchor floor + ordered exit-empty application

- [x] T003 Rewrite `resolveBootstrap` in `app/backend/internal/tmuxctl/client.go` to ALWAYS `createAnchor` (dup-session benign) + `setAnchorKeepalive`, then return first real session if present else `_rk-ctl`. <!-- R1 R2 -->
- [x] T004 In `productionDial` (`client.go`), call `tmux.SetExitEmptyOff(ctx, socket)` BEFORE `resolveBootstrap` (best-effort, logged on failure) so exit-empty off precedes createAnchor on every dial AND every reconnect (ordering A). <!-- R3 -->

### Phase 3: Comment update

- [x] T005 Update the deferred-fix comment in `app/backend/api/sse.go` (~line 613) to reference this change as the prevention implementation; keep the WARN. <!-- R7 -->

### Phase 4: Tests

- [x] T006 [P] Unit test `SetExitEmptyOff` against a live isolated tmux server in `app/backend/internal/tmux/tmux_test.go` (skips when tmux absent): asserts `show-options -g exit-empty` reads `off`. <!-- R3 -->
- [x] T007 [P] Live integration test in `app/backend/internal/tmuxctl/integration_test.go`: server pre-seeded with a real session → after `Open`, `_rk-ctl` exists (R1 always-floor) AND `exit-empty` is `off` (R3). Covers edge case A (reconnect/restart-to-N-sessions self-heal). <!-- R1 R3 -->
- [x] T008 [P] Unit/live test for the concurrent-anchor dup-session path: a second `createAnchor` on a server that already has `_rk-ctl` returns a duplicate-session error that `isDuplicateSessionError` classifies benign, and `resolveBootstrap` still succeeds. Covers edge case B. <!-- R1 -->
- [x] T009 Confirm the existing `serve_sweep_test.go` anchor-never-reaped assertion still passes (R6); no new test needed if already present. <!-- R6 -->

## Execution Order

- T001 blocks T004 (productionDial calls the new helper) and T006.
- T003 blocks T007/T008.
- T002, T005 are independent.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `resolveBootstrap` always creates `_rk-ctl`; a server with real sessions still gets the anchor floor (verified by T007).
- [x] A-002 R2: attach target is the first real session when present, else `_rk-ctl` (verified by code + T007 which still connects).
- [x] A-003 R3: `exit-empty off` is set on every dialed server, before `createAnchor`, on initial dial and reconnect (verified by T004 ordering + T006/T007).
- [x] A-004 R4: embedded config carries `set -g exit-empty off`.
- [x] A-005 R7: `sse.go` comment references this change; WARN retained.

### Behavioral Correctness

- [x] A-006 R1/R2: prior only-when-empty behavior is gone — the `firstSessionName`-then-return-early-without-anchor path no longer exists in `resolveBootstrap`.

### Edge Cases & Error Handling

- [x] A-007 R3 (edge A): restart/reconnect to N existing sessions self-heals — anchor created on reconnect and exit-empty off applied BEFORE createAnchor closes the zero-session reap window (T007 + ordering in T004).
- [x] A-008 R1 (edge B): concurrent `createAnchor` dup-session is benign via `isDuplicateSessionError`; no cross-process state added (T008).
- [x] A-009 R6: relay sweep spares `_rk-ctl` (existing serve_sweep_test.go regression — T009).

### Code Quality

- [x] A-010 Pattern consistency: new tmux helper mirrors `tmuxExecServer`/`serverArgs`; tmuxctl exec mirrors `createAnchor` (5s ctx, `-L socket` prepend).
- [x] A-011 No unnecessary duplication: exit-empty logic lives once in `internal/tmux.SetExitEmptyOff`, called from `productionDial`.

### Security

- [x] A-012 R3: all new process execution uses `exec.CommandContext` with explicit arg slices + timeout; no shell strings (Constitution I).

## Notes

- Check items as you review: `- [x]`
- Build copy `app/backend/build/tmux.conf` is generated from `configs/tmux/default.conf` at build time (scripts/dev.sh, scripts/build.sh); both updated for T002 so the embed compiles in this checkout.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Canonical site for `exit-empty off` is tmuxctl `productionDial` (calling an `internal/tmux.SetExitEmptyOff` helper), NOT `openSocket` | `productionDial` is the only site that runs on BOTH initial dial and every reconnect of the Client FSM, so it is the one place that guarantees ordering A (exit-empty off before createAnchor) on every reconnect. `openSocket` runs once per socket-appearance and is bypassed by the in-Client reconnect. Helper in internal/tmux keeps it unit-testable. | S:4 R:4 A:4 D:4 |
| 2 | Confident | Also add `set -g exit-empty off` to the embedded tmux.conf (belt-and-suspenders) | Intake §"Decisions you MAY make" calls this a reasonable yes; gives run-kit-created servers the floor at birth before the first dial. Zero risk (idempotent server option). | S:4 R:4 A:4 D:4 |
| 3 | Confident | `SetExitEmptyOff` failures are logged at Debug and non-fatal in `productionDial` | Matches `setAnchorKeepalive`'s non-fatal pattern; a foreign server momentarily unreachable should not abort the dial — the anchor floor (R1) is the primary guarantee and exit-empty is the backstop. | S:4 R:4 A:4 D:4 |
| 4 | Certain | The anchor-never-reaped regression (R6) already exists in serve_sweep_test.go and needs no new test | Read `serve_sweep_test.go:104-137` — `anchor := tmux.ControlAnchorSessionName` is created and asserted spared. | S:5 R:5 A:5 D:5 |

4 assumptions (1 certain, 3 confident, 0 tentative).

## Deletion Candidates

None — this is a small additive `fix`. The two functions it rewrote (`resolveBootstrap`, `firstSessionName` in `client.go`) replaced their old bodies in place (the only-when-empty branch and the hand-rolled byte-scan loop) rather than leaving dead code behind; `git diff` confirms no orphaned function or branch remains. The `@rk_ctl_keepalive` marker / `setAnchorKeepalive` (`client.go:26`, `client.go:483`) still has no runtime consumer (a pre-existing label, noted in intake §"Mechanism"), but it is intentionally retained by this change and was not made redundant by it, so it is out of scope here.
</content>
</invoke>
