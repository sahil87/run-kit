# Plan: Writable tmuxctl Control Bridge (Go-Enforced Read-Only)

**Change**: 260904-gx32-tmuxctl-bridge-writable
**Intake**: `intake.md`

## Requirements

### tmuxctl Bridge: Attach Posture

#### R1: Bridge attaches writable with ignore-size
`productionDial` (`app/backend/internal/tmuxctl/client.go`) MUST attach the control-mode client with `-f ignore-size` in place of `-r` — the composed argv becomes `tmux [-L <socket>] -CC attach-session -t =<bootstrap> -f ignore-size`. The `ignore-size` half of the old `-r` alias (`-f read-only,ignore-size`) MUST be preserved so the bridge PTY's size never participates in window-size arbitration; only the `read-only` half is dropped.

- **GIVEN** a managed tmux server whose only attached client is the rk control bridge
- **WHEN** any client (rk or external) runs `send-keys` targeting a pane on that server under tmux ≥3.7
- **THEN** tmux's target-client resolution may resolve the bridge, and the send succeeds because the resolved client is not read-only

#### R2: Go-enforced write guard on the bridge PTY
The `io.ReadWriteCloser` returned by `productionDial` MUST be wrapped so any `Write` returns a package sentinel error (e.g. `errBridgeWriteForbidden`) without writing; `Read` and `Close` MUST pass through untouched (the reconnect FSM closes the handle on teardown). The wrapper MUST carry a comment stating the cross-file invariant: the bridge is a pure listener — commands to tmux go through one-shot subprocesses (`internal/tmux` runners), never this handle.

- **GIVEN** the wrapped bridge handle returned by `productionDial`
- **WHEN** code calls `Write` on it
- **THEN** the sentinel error is returned and no bytes reach the control client's stdin
- **AND** `Read` and `Close` behave exactly as the unwrapped PTY

#### R3: send-keys succeeds with the bridge as sole client (regression)
The change MUST include a live-tmux regression test proving `send-keys` into a real session succeeds on an isolated server whose ONLY attached client is a control client attached exactly as `productionDial` now attaches (`-CC attach-session -t =<target> -f ignore-size`, via a real PTY). On tmux <3.7 the test passes trivially (the unconditional read-only target-client guard does not exist there) — accepted; the local box (tmux 3.7c) exercises the real guard.

- **GIVEN** an isolated tmux socket with one real session and a PTY-attached `-CC … -f ignore-size` control client as the sole client
- **WHEN** `send-keys` delivers keys to the session's pane
- **THEN** the command exits 0 and the keys reach the pane (no `client is read-only` rejection)

#### R4: No behavior change elsewhere
Daemon `Stop()` stays signal-first exactly as shipped in 260901-phip (`internal/daemon/` untouched). The tmuxctl dial's other responsibilities — `exit-empty off` backstop, origin stamp, anchor floor, join-only probe, reconnect FSM, backoff — MUST remain byte-identical in behavior; existing daemon and tmuxctl tests pass without assertion changes.

- **GIVEN** the existing `internal/daemon` and `internal/tmuxctl` test suites
- **WHEN** the change is applied
- **THEN** all pre-existing tests pass unmodified (the `TestStop_ReadOnlyControlClientStopsGracefully` rig attaches its own `-r` client and remains valid — users can still attach read-only clients)

### Non-Goals

- No change to `internal/daemon/` `Stop()` sequencing — signal-first is strictly better (a writable target client with the pane in copy-mode routes `C-c` into the mode key table, the old #360 trap; the signal path bypasses key dispatch entirely).
- No change to the terminal relay client (`api/terminals_ws.go` — already writable) or any `paste-buffer` path (already immune, no client resolution).
- No parked writable client, no `send-keys -c` plumbing — rejected alternatives recorded below.
- No upstream tmux report as part of this change (worth raising separately; not a shipping dependency).
- Memory narrative rewrite (daemon-lifecycle, tmux-sessions § `_rk-ctl` Anchor, architecture TMUX_PANE-scrub Why) is hydrate-owned, per the intake's Affected Memory enumeration — not an apply task.

### Design Decisions

#### Writable bridge at the tmux layer, read-only enforced in Go
**Decision**: Drop the `read-only` client flag from the control bridge's attach and enforce the never-mutates invariant in Go instead — a write-guarded PTY wrapper whose `Write` always errors.
**Why**: tmux 3.7's `cmd_send_keys_exec` rejects any send whose resolved target client is read-only, and `cmd_find_best_client` resolution is recency-only (never skips read-only; falls through server-wide when the target session has no attached clients). The bridge is permanently attached to every managed server, so keeping it read-only exposes every typed-delivery surface — rk's own (chat send Enter, `C-u` clear, operator actuation, POST window send-keys, `rk mux send`, tutorial kickoff) and external same-user callers (fab dispatch deliver/ready, agent hooks, scripts) — to a lottery that hard-fails deterministically for sessions with no tty lens open. Making every rk-attached client writable makes resolution harmless regardless of who wins. The Go wrapper turns "happens to never write" (verified: no production `.Write(` on the handle; re-seed queries are one-shot subprocesses) into "cannot write", which is a stronger guarantee than the tmux flag it replaces.
**Rejected**: Parking a writable `no-output,ignore-size` client per server plus explicit `send-keys -c` — fixes only rk's own call sites, adds a second client per server, and parking alone is nondeterministic (resolution never prefers writable). Generalizing 260901-phip's signal-first delivery — no signal equivalent exists for typing text. Version-gating on tmux ≥3.7 — the writable posture is safe on the whole supported range (≥3.4) and needs no probe.
*Introduced by*: 260904-gx32-tmuxctl-bridge-writable

#### `-r` → `-f ignore-size`, not bare removal
**Decision**: Replace `-r` with `-f ignore-size` rather than deleting the flag.
**Why**: `-r` is an alias for `-f read-only,ignore-size` (tmux man page). A bare removal would newly enroll the bridge PTY's size in client-size arbitration on every managed server — an untested behavioral change unrelated to the fix. Dropping only the `read-only` half is the minimal diff.
**Rejected**: Bare `-r` removal — silently changes sizing behavior; `-f read-only,ignore-size` verbatim — that IS `-r`, no change.
*Introduced by*: 260904-gx32-tmuxctl-bridge-writable

#### Regression test lives in `internal/tmuxctl`
**Decision**: Host the sole-client send-keys regression test in `internal/tmuxctl` (alongside `integration_test.go`), borrowing the real-PTY `-CC` attach pattern from `internal/daemon/daemon_test.go`'s `TestStop_ReadOnlyControlClientStopsGracefully` rig.
**Why**: the behavior under test is the bridge's attach posture, which `productionDial` owns; the package already has a live-tmux integration test file and the per-package `TestMain` dead-socket sweep. Cross-package placement in `internal/daemon` would test another package's flag from a distance.
**Rejected**: `internal/daemon` placement — the daemon rig is about `Stop()`, not the bridge's attach args.
*Introduced by*: 260904-gx32-tmuxctl-bridge-writable

## Tasks

### Phase 2: Core Implementation

- [x] T001 In `app/backend/internal/tmuxctl/client.go` `productionDial`: replace the attach argv's `"-r"` with `"-f", "ignore-size"` <!-- R1 -->
- [x] T002 In `app/backend/internal/tmuxctl/client.go`: add the write-guard wrapper (unexported type over the PTY implementing `io.ReadWriteCloser`; `Write` returns the package sentinel `errBridgeWriteForbidden`, `Read`/`Close` delegate) with the invariant comment (pure listener; commands go through one-shot subprocesses, never this handle), and return the wrapped handle from `productionDial` <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T003 [P] Unit test in `app/backend/internal/tmuxctl/client_test.go`: wrapper `Write` returns the sentinel and writes nothing; `Read` and `Close` delegate to the underlying handle <!-- R2 -->
- [x] T004 [P] Live regression test in `app/backend/internal/tmuxctl` (integration-test conventions: skip when tmux absent or `-short`; isolated `rk-test-*` socket): create a session, attach a real PTY `-CC … -f ignore-size` control client as the sole client (the exact `productionDial` shape), assert `send-keys` into the session's pane exits 0 and the keys land (capture-pane confirms) <!-- R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `productionDial` composes `-CC attach-session -t =<bootstrap> -f ignore-size` with no `-r` anywhere in the dial argv
- [x] A-002 R2: the handle `productionDial` returns refuses `Write` with the package sentinel; `Read`/`Close` pass through (reconnect FSM teardown still works)

### Behavioral Correctness

- [x] A-003 R1: with the bridge attached, `send-keys` targeting a pane on the server is not rejected with `client is read-only` (the tmux ≥3.7 target-client guard no longer matches)

### Scenario Coverage

- [x] A-004 R3: the sole-client regression test exists, follows the package's live-tmux conventions (tmux-absent/short skips, isolated test socket), and passes locally on tmux 3.7c
- [x] A-005 R2: the wrapper unit test exists and passes without a live tmux server

### Edge Cases & Error Handling

- [x] A-006 R4: existing `internal/tmuxctl` and `internal/daemon` suites pass with unmodified assertions (`TestStop_ReadOnlyControlClientStopsGracefully` included — its own `-r` client is a user-attached read-only client, still valid)

### Code Quality

- [x] A-007 Pattern consistency: wrapper and sentinel follow the package's existing idioms; comments state constraints (the cross-file pure-listener invariant), never narration
- [x] A-008 No unnecessary duplication: the regression rig reuses the package's existing integration-test helpers/conventions rather than re-inventing the daemon rig wholesale
- [x] A-009 Subprocess discipline: no new subprocess paths outside `exec.CommandContext` with timeouts; test rigs use context-bounded commands (Constitution I)
- [x] A-010 Tests cover the added/changed behavior; `cd app/backend && go test ./internal/tmuxctl/... ./internal/daemon/...` green

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (write-guard wrapper, regression coverage) and swaps one attach flag without making any existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Regression test placed in `internal/tmuxctl`, not `internal/daemon` | Intake left placement to apply; the package owns `productionDial`, already hosts `integration_test.go` and the `TestMain` socket sweep | S:75 R:90 A:85 D:80 |
| 2 | Confident | Wrapper is an unexported struct with a package-level sentinel `errBridgeWriteForbidden`; no exported surface | Intake pinned "any Write returns an error" with a suggested sentinel name; nothing outside the package needs the type | S:70 R:90 A:85 D:80 |
| 3 | Confident | Regression asserts both `send-keys` exit 0 AND capture-pane content | Exit 0 alone proves the 3.7 guard no longer fires; the capture confirms delivery end-to-end at trivial extra cost | S:65 R:90 A:85 D:75 |

3 assumptions (0 certain, 3 confident, 0 tentative).
