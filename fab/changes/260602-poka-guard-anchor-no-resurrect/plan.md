# Plan: Guard createAnchor against resurrecting a killed tmux server

**Change**: 260602-poka-guard-anchor-no-resurrect
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

### tmuxctl: Anchor join-only guard

#### R1: Decline on a dead server (no resurrection)
`resolveBootstrap` MUST run a side-effect-free `tmux -L <socket> list-sessions` liveness probe BEFORE `createAnchor`, and MUST return a non-nil error (decline) when the probe reports the server is genuinely dead (exit 1 with `no server running` / `failed to connect`). `createAnchor` MUST NOT run when the server is dead, so the anchor's `tmux new-session` can no longer implicitly start a dead server.

- **GIVEN** a tmux server was killed (`kill-server`) and the socket has no listening server
- **WHEN** the reconnect FSM re-dials via `productionDial → resolveBootstrap`
- **THEN** `resolveBootstrap` returns a non-nil error without running `createAnchor`
- **AND** no tmux server exists on that socket afterward (the dead server stays dead)

#### R2: First-connect to a fresh live server still succeeds
A freshly-created, currently-listening server MUST still pass the probe, create/ensure the `_rk-ctl` anchor floor, and return the correct attach target (the first real session if one exists, else `_rk-ctl`). The probe-first restructure MUST preserve the existing attach-target preference and MUST keep the net tmux round-trip count flat at 4 (`SetExitEmptyOff`, the unified `list-sessions` probe+first-session, `createAnchor`, `setAnchorKeepalive`).

- **GIVEN** a live server with one real session `realwork` (anchor not yet present)
- **WHEN** `resolveBootstrap` runs
- **THEN** it returns `realwork` as the attach target
- **AND** the `_rk-ctl` anchor floor is created on the server

#### R3: Alive-but-zero-session server still gets the anchor (Constitution VI floor)
When the probe returns exit 0 with empty output (a live server with zero real sessions, e.g. the `exit-empty off` floor case), `resolveBootstrap` MUST treat the server as alive, create the `_rk-ctl` anchor, and return `_rk-ctl` as the attach target. A zero-session-but-alive server MUST NOT be declined.

- **GIVEN** a live server whose only session is the anchor (or which is briefly at zero real sessions but still listening)
- **WHEN** `resolveBootstrap` runs
- **THEN** the probe passes (exit 0), the anchor is ensured, and `_rk-ctl` is returned

### Non-Goals

- Kill-handler telling the Supervisor to close the dead socket's Client — deferred to a separate change.
- Foreign-socket ownership boundary (`rk-probe-*` / `rk-edge-*` / `rk-riff-*`) — deferred.
- Tombstone / de-adopt coordination in the Supervisor — deferred (unnecessary for correctness once the guard lands).
- Removing `_rk-ctl` / the control-mode stream — load-bearing for live tab-switch UI updates; out of scope.
- Any change to `api/servers.go` or the kill path.

### Design Decisions

1. **Probe folded into the existing `list-sessions`, not a separate round-trip**: restructure so a single `list-sessions` runs first and serves double duty (dead-vs-alive detection AND first-real-session selection). — *Why*: keeps net tmux round-trips flat at 4 (intake Assumption #6). — *Rejected*: adding a second `list-sessions` purely for the probe (one extra round-trip per dial/reconnect).
2. **Mirror the probe pattern locally in `tmuxctl`, do not export `tmux.probeServerAlive`**: classify the `list-sessions` exit-1 stderr (`no server running` / `failed to connect`) inside `tmuxctl`. — *Why*: `doc.go` documents `tmuxctl` as the sanctioned self-contained bypass of the `internal/tmux/` boundary that uses `exec.CommandContext` directly; the single `list-sessions` call already lives here, so folding the dead-vs-empty distinction into it is the minimal-diff, package-self-contained choice. Resolves intake Assumption #8 (Tentative) toward "mirror locally". — *Rejected*: exporting `probeServerAlive` from `internal/tmux` and adding a separate cross-package probe call (extra round-trip + wider blast radius, and `probeServerAlive` collapses the dead-vs-empty distinction this change needs to surface).

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/backend/internal/tmuxctl/client.go`, restructure `resolveBootstrap` to probe-first: replace `firstSessionName` with a combined `list-sessions`-based helper (e.g. `probeAndFirstSession`) that returns `(serverAlive bool, first string, err error)` by classifying the `list-sessions` exit-1 stderr (`no server running` / `failed to connect`) as dead. When dead, `resolveBootstrap` returns a non-nil error BEFORE calling `createAnchor`; when alive, it calls `createAnchor` + `setAnchorKeepalive` and returns the first real session (else `_rk-ctl`). Add a named constant for the decline sentinel/message and reuse the existing `_rk-ctl` skip + socket-arg construction. Keep round-trips flat at 4. <!-- R1 --> <!-- R2 --> <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T002 In `app/backend/internal/tmuxctl/integration_test.go` (real-tmux harness, skip when tmux absent), add `TestIntegration_ResolveBootstrap_DeadServerDeclines`: kill-server the socket, then assert `resolveBootstrap` returns a non-nil error AND no server is created afterward (`hasSession`/probe shows no server). This proves the dead server is not resurrected. <!-- R1 -->
- [x] T003 In `app/backend/internal/tmuxctl/integration_test.go`, add coverage proving first-connect to a fresh LIVE server still succeeds (live server with a real session → `resolveBootstrap` returns the real session and creates the anchor) and that an alive-but-zero-session server still gets the anchor (`_rk-ctl`-only server → probe passes, returns `_rk-ctl`). May reuse/extend the existing `AlwaysFloorsAnchor` and `ConcurrentAnchorBenign` patterns. <!-- R2 --> <!-- R3 -->
- [x] T004 In `app/backend/internal/tmuxctl/`, add a tmux-free unit test for the dead-vs-alive stderr classifier (the new helper's error-classification logic), mirroring `TestIsDuplicateSessionError_TmuxText`: `no server running` / `failed to connect` → dead; unrelated/nil → not dead. This keeps the decline behavior covered where tmux is absent. <!-- R1 -->

## Execution Order

- T001 blocks T002, T003, T004 (tests exercise the restructured `resolveBootstrap` / new classifier).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `resolveBootstrap` runs the `list-sessions` probe before `createAnchor` and returns a non-nil error (declines) when the server is dead, so `createAnchor`'s `new-session` cannot resurrect a killed server.
- [x] A-002 R2: First-connect to a fresh live server still creates the `_rk-ctl` anchor and returns the correct attach target (first real session, else `_rk-ctl`); net tmux round-trips remain 4.
- [x] A-003 R3: An alive-but-zero-session server (exit 0, empty output) is treated as alive — anchor created, `_rk-ctl` returned — preserving the Constitution VI floor.

### Behavioral Correctness

- [x] A-004 R1: After a kill, re-dialing does NOT recreate the server — verified by a test that kills the server then asserts `resolveBootstrap` declines and no server exists afterward.

### Scenario Coverage

- [x] A-005 R1: Integration test `TestIntegration_ResolveBootstrap_DeadServerDeclines` exists and proves the dead-server-declines-without-resurrecting guarantee.
- [x] A-006 R2 R3: Tests prove the fresh-live-server-succeeds and alive-but-zero-session-anchored guarantees.
- [x] A-007 R1: A tmux-free unit test covers the dead-vs-alive stderr classifier (`no server running` / `failed to connect` → dead).

### Code Quality

- [x] A-008 Pattern consistency: New code follows `client.go`/`tmux.go` patterns — `exec.CommandContext` with arg slices and timeout, socket-arg construction reused, no shell strings (Constitution I), `_rk-ctl` skip preserved.
- [x] A-009 No unnecessary duplication: The single `list-sessions` call serves both the liveness probe and first-session selection (round-trips stay flat at 4); no second `list-sessions` added.
- [x] A-010 Named constants: The decline sentinel/message and any new dead-server match strings use named constants, not inline magic strings.
- [x] A-011 No god functions: `resolveBootstrap` and the new probe helper stay focused (<50 lines each); the probe logic is extracted into its own helper rather than inlined into a bloated `resolveBootstrap`.

### Security

- [x] A-012 R1: The liveness probe uses `exec.CommandContext` with an explicit argument slice and a ~2s timeout — never a shell string (Constitution I — Security First).

## Notes

- Run tests via `just test-backend` — never `go test` directly (project convention).
- This change is backend-only Go; the frontend is untouched, so frontend gates are not required.

## Deletion Candidates

- `app/backend/internal/tmuxctl/supervisor.go:26-30` (`isTmuxSocketCandidate` doc comment) — the comment justifies skipping test sockets because "tmuxctl's resolveBootstrap calls `tmux new-session -d -s _rk-ctl` ... which would RESURRECT every orphan test socket." After this change `resolveBootstrap` declines on a dead server and never resurrects, so the resurrection rationale is stale. The skip itself stays valid (`.lock` recursion / noise), but the comment should be re-justified or trimmed. Documentation-only; out of poka's strict scope.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Mirror the probe locally in `tmuxctl` (classify `list-sessions` exit-1 stderr) rather than exporting `tmux.probeServerAlive` | Resolves intake Assumption #8 (Tentative). `doc.go` documents `tmuxctl` as the sanctioned self-contained bypass using `exec.CommandContext` directly; the single `list-sessions` call already lives here, and `probeServerAlive` collapses the dead-vs-empty distinction this change must surface. Low blast radius, easily reversed. | S:80 R:85 A:85 D:80 |
| 2 | Confident | Combine the probe and first-session selection into one helper returning `(alive, first, err)` so the existing `firstSessionName` `list-sessions` round-trip does double duty | Intake Assumption #6 mandates flat round-trips at 4; folding the probe into the existing listing is the only way to add liveness detection without a new round-trip. | S:80 R:80 A:85 D:80 |
| 3 | Certain | Dead-server discriminator is `list-sessions` exit 1 with `no server running` / `failed to connect` in stderr; exit 0 (incl. empty output) = alive | Matches the existing in-package detection used across `tmux.go` (lines 381/407/654/739) and `board.go isAbsentOption`; exit-0-empty is the Constitution VI floor case that must stay alive. | S:90 R:80 A:90 D:90 |

3 assumptions (1 certain, 2 confident, 0 tentative).
