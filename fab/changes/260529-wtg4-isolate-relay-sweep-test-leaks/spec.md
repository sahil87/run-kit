# Spec: Isolate Relay Sweep & Stop Test Artifact Leaks

**Change**: 260529-wtg4-isolate-relay-sweep-test-leaks
**Created**: 2026-05-29
**Affected memory**: `docs/memory/run-kit/tmux-sessions.md`, `docs/memory/run-kit/architecture.md`

<!--
  CHANGE SPECIFICATION
  Closes three distinct leak/destruction defects:
  1. Cross-instance relay destruction by the startup sweep (correctness/UX bug).
  2. Secondary rk-e2e-* tmux servers surviving crash/Ctrl-C (artifact leak).
  3. Go-test sockets surviving SIGKILL/panic (minor residue).
  Fix is write-side only — read-side server discovery stays global by design.
-->

## Non-Goals

- **No "rk reaper" startup-sweep command (`[fww2]`)** — a parallel backlog task. This change closes the leak at its source so the reaper becomes optional defense-in-depth rather than the load-bearing fix (constitution IV, Minimal Surface Area).
- **No scoping of `ListServers` / `/api/servers`** — read-side visibility of `rk-e2e-*` (and other foreign) servers is intentionally preserved. Hiding leaked servers would mask exactly the class of bug this change targets.
- **No ownership guard on `KillServer` / `KillSession` API paths** — those are user-driven, intentional, and no test targets them. Real named sessions/servers are already safe from any automatic kill path; only relay ephemerals are at risk today.
- **No change to the `IsGoTestServerName` UI filter or tmuxctl `isTmuxSocketCandidate` behavior** — unchanged.

## Relay Sweep: Owner-PID Scoping

### Requirement: Stamp owning PID at relay creation
When a relay ephemeral grouped session is created in `api/relay.go:handleRelay` (immediately after `NewGroupedSession` succeeds and **before** `SelectWindowInSession`/`attach-session` makes the ephemeral attachable), the system MUST stamp the ephemeral session with a session-scoped tmux user option `@rk_owner_pid` whose value is the current `rk serve` process PID (`os.Getpid()`). The setter SHALL follow the existing session-scoped pattern (`set-option -t <ephemeral> @rk_owner_pid <pid>`, mirroring `SetSessionColor`) and SHALL execute via `exec.CommandContext` with a timeout (constitution I / Process Execution). The relay name itself MUST remain a random 8-hex string from `newEphemeralRelayName` — ownership lives in the option, not the name, preserving the injection-closed naming surface.
<!-- clarified: stamp MUST precede the attach step so the ephemeral is never attachable-but-unstamped; this closes the window in which a live relay would be reapable by a sibling sweep (owner=="" → reap). -->

The stamp ordering is load-bearing for leak-not-kill: a sibling sweep reaps any `rk-relay-*` whose `@rk_owner_pid` is empty (treated as a legacy/crashed orphan). An attachable-but-unstamped relay is therefore indistinguishable from an orphan and WILL be wrongly reaped by the next `rk serve`/`air` rebuild/e2e start. Stamping before attach guarantees that the only unstamped relays a sweep can see are genuine orphans (their owner already exited), never a live instance's relay.

#### Scenario: Newly created relay carries its owner PID
- **GIVEN** an `rk serve` process with PID P holding a live dashboard
- **WHEN** a WebSocket relay opens and `NewGroupedSession` creates ephemeral `rk-relay-<hex>`
- **THEN** the ephemeral session has user option `@rk_owner_pid` set to P
- **AND** the ephemeral session name is still `rk-relay-<8 hex chars>` with no PID embedded in the name

#### Scenario: Stamp failure aborts relay setup cleanly
- **GIVEN** the `set-option` stamp call fails (e.g., the ephemeral died mid-setup, or the tmux server is unreachable)
- **WHEN** the relay handler evaluates the stamp result
- **THEN** the handler logs the failure (`slog.Warn`), closes the WebSocket with a relay-allocation close code (mirroring the existing `4001`/`4004` setup-failure pattern), and returns — letting the already-registered `defer KillSessionCtx` reap the half-owned ephemeral so no unstamped relay survives
<!-- clarified: resolved toward ABORT-CLEAN, not log-and-continue. The intake's "bias toward leaking an unstamped relay rather than dropping the connection" is internally inconsistent with the legacy-unstamped-reap rule (owner=="" → reap): a live-but-unstamped relay would be wrongly killed by the very next sibling sweep, which is exactly the cross-instance destruction bug this change exists to fix. Abort-clean is the leak-not-kill-faithful choice — it never leaves a live relay that a sweep can wrongly reap, it reuses the existing setup-failure pattern (NewGroupedSession/SelectWindowInSession/pty.StartWithSize all close+return on failure and rely on `defer KillSessionCtx`), and a clean close lets the client retry rather than silently losing the connection later. -->

> **Why not log-and-continue**: a relay that fails to stamp is *unprotectable*. Keeping it open is a false promise — any second `rk serve`, `air` rebuild, or e2e start would observe `@rk_owner_pid==""`, treat it as an orphan, and reap it, dropping the live terminal. Closing the connection at setup time (and reaping the ephemeral via the existing defer) is strictly safer and consistent with how every other setup-step failure in `handleRelay` already behaves.

### Requirement: Sweep reaps only dead-owner relays
`cmd/rk/serve_sweep.go:sweepOrphanedRelaySessions` MUST continue iterating every tmux server returned by `tmux.ListServers` (read scope unchanged), but for each `rk-relay-*` session it SHALL read the `@rk_owner_pid` option and reap the session ONLY when the owner PID is absent (empty/unstamped) OR dead. The sweep MUST NOT reap a relay whose `@rk_owner_pid` names a live process. Reaping continues to use `tmux.KillSessionCtx`.

#### Scenario: Live-instance relay is spared
- **GIVEN** a real dashboard `rk serve` (PID P alive) owns relay `rk-relay-abc12345` stamped `@rk_owner_pid=P`
- **WHEN** a second `rk serve` (e2e backend, an `air` rebuild, or a manual second instance) starts and runs `sweepOrphanedRelaySessions`
- **THEN** the sweep observes P is alive and does NOT kill `rk-relay-abc12345`
- **AND** the live dashboard's open terminal WebSocket connection is preserved

#### Scenario: Dead-owner relay is reaped
- **GIVEN** a relay `rk-relay-def67890` stamped `@rk_owner_pid=D` where process D has exited
- **WHEN** `sweepOrphanedRelaySessions` runs at startup
- **THEN** the sweep observes D is dead and kills `rk-relay-def67890`

#### Scenario: Legacy unstamped relay is reaped
- **GIVEN** a relay `rk-relay-0badf00d` with no `@rk_owner_pid` option (created by an older binary or a crashed predecessor)
- **WHEN** `sweepOrphanedRelaySessions` runs
- **THEN** the empty owner is treated as orphan and the relay is reaped

### Requirement: pidAlive ownership semantics
A `pidAlive(pid)` predicate MUST determine liveness via `syscall.Kill(pid, 0)` with the following mapping: `nil` error → process is alive (spare); `ESRCH` → process is dead (reap); `EPERM` → process exists but is owned by another user → treated as alive (spare). The predicate MUST bias toward sparing (leak-not-kill) on any ambiguous or non-`ESRCH` error.

#### Scenario: kill(pid,0) returns nil — alive
- **GIVEN** an owner PID whose `syscall.Kill(pid, 0)` returns nil
- **WHEN** the sweep evaluates ownership
- **THEN** `pidAlive` returns true and the relay is spared

#### Scenario: kill(pid,0) returns ESRCH — dead
- **GIVEN** an owner PID whose `syscall.Kill(pid, 0)` returns `ESRCH`
- **WHEN** the sweep evaluates ownership
- **THEN** `pidAlive` returns false and the relay is reaped

#### Scenario: kill(pid,0) returns EPERM — spare
- **GIVEN** an owner PID whose `syscall.Kill(pid, 0)` returns `EPERM` (PID owned by another user)
- **WHEN** the sweep evaluates ownership
- **THEN** `pidAlive` returns true and the relay is spared (safe direction)
<!-- clarified: confirmed no legitimate cross-user owner scenario exists, AND EPERM-spare is harmless even if one did. (1) The sweep only ever sees rk-relay-* sessions on servers from `tmux.ListServers`, which scans exactly `/tmp/tmux-{os.Getuid()}/` (tmux.go:1036-1037) — a single-uid socket model. A foreign user's tmux server lives under a different uid's socket dir and is invisible to the sweep. (2) Relays are created by the `rk serve` process and stamped with its own `os.Getpid()` (same OS user); a foreign-user PID is never an expected `@rk_owner_pid` value. (3) Even in the degenerate case where a recycled/foreign PID returns EPERM, sparing is the safe leak-not-kill direction — a stale relay survives one extra cycle (and the out-of-scope reaper backstops it) rather than wrongly killing a live instance's relay. EPERM=spare therefore needs no special-casing. -->

> **Single-uid socket model**: `ListServers` derives its socket directory solely from `os.Getuid()`, so every server the sweep touches belongs to the current user. Cross-user relay ownership is not reachable; EPERM (if ever observed, e.g. from a recycled PID now owned by another user) is treated as alive and spared, which is the benign-leak direction by design.

### Requirement: Anchor guard and per-server error isolation are retained
The sweep MUST continue to skip any session named `tmux.ControlAnchorSessionName` (`_rk-ctl`) and MUST retain the existing prefix guard (`RelaySessionPrefix`, `rk-relay-`). Per-server failures (list or kill) MUST be logged and accumulated into the aggregate error without aborting the sweep or blocking server startup, exactly as today.

#### Scenario: Control anchor is never reaped
- **GIVEN** a tmux server with the `_rk-ctl` anchor session present
- **WHEN** `sweepOrphanedRelaySessions` runs
- **THEN** `_rk-ctl` is skipped (it is not `rk-relay-*` prefixed, and the explicit anchor guard remains)

#### Scenario: One server's failure does not abort the sweep
- **GIVEN** two tmux servers where listing sessions on server A fails
- **WHEN** the sweep iterates both servers
- **THEN** the error for A is logged and accumulated, server B is still processed, and startup proceeds

### Requirement: Read-side server discovery stays global
`tmux.ListServers` and the `/api/servers` handler MUST remain unscoped — they continue to scan every socket in `/tmp/tmux-{uid}/` and surface foreign servers (including `rk-e2e-*`) in the UI. This change MUST NOT add any socket/prefix filtering to the read path.

#### Scenario: Foreign e2e server remains visible
- **GIVEN** an e2e run that creates an `rk-e2e-multi-*` tmux server
- **WHEN** the dashboard lists servers via `/api/servers`
- **THEN** the `rk-e2e-multi-*` server appears in the list (read-side visibility preserved)

## E2E Teardown: Prefix-Complete Socket Reaping

### Requirement: Shell teardown reaps every rk-e2e* socket on EXIT
`scripts/test-e2e.sh`'s `cleanup()` (the `trap cleanup EXIT` handler) MUST kill every tmux socket whose basename starts with the `E2E_TMUX_SERVER` prefix (`rk-e2e`), not just the literal `rk-e2e` socket. Because the trap fires on EXIT regardless of cause (normal completion, `set -e` error, SIGINT/SIGTERM from Ctrl-C), this SHALL reap timestamp-named secondaries (`rk-e2e-multi-*`, `rk-e2e-coupling-*`) even when a spec's own `afterAll` never ran. Each kill MUST be best-effort (swallow errors — a socket may already be gone).

#### Scenario: Secondary socket gone after normal completion
- **GIVEN** an e2e run that spun up `rk-e2e` and `rk-e2e-multi-1748...`
- **WHEN** the run completes and the EXIT trap fires
- **THEN** both `rk-e2e` and `rk-e2e-multi-1748...` sockets/servers are killed

#### Scenario: Secondary socket gone after Ctrl-C interrupt
- **GIVEN** an e2e run mid-spec with `rk-e2e-coupling-*` alive and the spec's `afterAll` not yet run
- **WHEN** the operator presses Ctrl-C (SIGINT) and the EXIT trap fires
- **THEN** the `rk-e2e-coupling-*` socket is killed and does not survive on disk

### Requirement: Playwright teardown is prefix-complete
`app/frontend/tests/e2e/global-teardown.ts` MUST kill every tmux socket whose basename starts with `E2E_TMUX_SERVER` (defaulting to `rk-e2e`), matching the shell trap's glob behavior. The teardown MUST be best-effort and swallow errors so a socket already removed by the shell trap (or a prior `afterAll`) does not fail teardown.

#### Scenario: Playwright teardown removes secondaries
- **GIVEN** a Playwright run that created `rk-e2e` and `rk-e2e-multi-*`
- **WHEN** Playwright's `globalTeardown` runs
- **THEN** all `rk-e2e*` sockets are killed and any already-gone socket does not raise an error

## Go Test Sockets: Dead-PID Pre-Sweep

### Requirement: TestMain sweeps dead-PID test sockets before tests run
The affected packages (`internal/tmux` and `api`) MUST each define a `TestMain(m *testing.M)` that, before `m.Run()`, sweeps tmux sockets named `rk-test-*` and `rk-relay-test-*` whose embedded PID is dead. The PID is the second hyphen-delimited field of the `rk-<kind>-<pid>-<ns>` name (e.g., `rk-test-<pid>-<ns>`, `rk-relay-test-<pid>-<ns>`, matching `withSessionOrderTmux`, `withGroupedSessionTmux`, and `withRelayTmux`). Liveness MUST use the same `pidAlive` semantics. All subprocess calls MUST use `exec.CommandContext` with a timeout.

#### Scenario: Dead-PID test socket removed at startup
- **GIVEN** an orphaned `rk-test-99999-1748...` socket whose PID 99999 is dead (leaked by a prior SIGKILL/panic)
- **WHEN** the package's `TestMain` runs before any test
- **THEN** the `rk-test-99999-*` socket/server is killed prior to `m.Run()`

#### Scenario: Live-PID test socket preserved
- **GIVEN** a concurrent `go test` invocation (PID L alive) owns `rk-test-<L>-1748...`
- **WHEN** another package's `TestMain` pre-sweep runs
- **THEN** `pidAlive(L)` is true and the live-PID socket is NOT reaped (no interference with concurrent test runs)

#### Scenario: Fixed-name shared sockets untouched
- **GIVEN** sockets `rk-daemon-test` and `rk-tmuxctl-test` (fixed-name, no parseable PID, pre-killed by their own helpers)
- **WHEN** the `TestMain` pre-sweep runs
- **THEN** the pre-sweep does not attempt to parse or reap them (only `rk-test-*` / `rk-relay-test-*` with a parseable dead PID are targeted)

## Design Decisions

1. **PID + `kill(pid,0)` ownership over `host:port`**: each relay is stamped with the owning `rk serve` PID at creation; the sweep reaps only when the owner is dead/absent.
   - *Why*: the sweep runs **before** the instance's own HTTP listener binds, so a port-liveness probe is ambiguous at exactly the moment the sweep runs. PID liveness is unambiguous, and its failure mode is a benign leak (a recycled PID could spare a stale relay one extra cycle) rather than a wrongful kill of a live instance's relays.
   - *Rejected*: `host:port` owner model — port-liveness is unreliable pre-bind and its failure direction (false "port free" → wrongful kill) is unsafe.

2. **Write-side-only fix over scoping `ListServers`**: only the destructive sweep is scoped; read-side discovery stays global.
   - *Why*: scoping reads would hide `rk-e2e-*` and other leaked servers from the UI, masking the very class of bug this change targets. The user explicitly wants temporaries visible ("as long as I know they're temporary"). The destructive sweep is the only thing that needs scoping.
   - *Rejected*: scoping `ListServers`/`/api/servers` to the e2e socket — masks bugs and removes useful visibility.

3. **Fix at source over building the `rk` reaper**: close the leak in the sweep, e2e teardown, and `TestMain` rather than adding a separate reaper command.
   - *Why*: honors constitution IV (Minimal Surface Area) — the reaper becomes optional defense-in-depth instead of load-bearing infrastructure compensating for a leak that should not exist.
   - *Rejected*: building `[fww2]` rk reaper as the primary fix — adds surface area to paper over a source-level defect.

## Assumptions

<!-- SCORING SOURCE: fab score reads only this table. -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix is write-side only; `ListServers`/`/api/servers` read scope is unchanged so `rk-e2e-*` stays visible in the UI | Confirmed from intake #1; verified `ListServers` (tmux.go:1035) and `IsGoTestServerName` (tmux.go:1016) are read-path only and intentionally exclude e2e servers from filtering | S:95 R:82 A:90 D:95 |
| 2 | Certain | Ownership model is PID + `kill(pid,0)`; relays stamped session-scoped `@rk_owner_pid`, reaped only when owner PID dead/absent | Confirmed from intake #2; sweep at serve.go:91-95 runs before HTTP listen so port-liveness is ambiguous; PID failure mode is benign leak | S:95 R:75 A:88 D:90 |
| 3 | Certain | Scope excludes the rk reaper, `ListServers` scoping, and `KillServer`/`KillSession` guards | Confirmed from intake #3; reproduced verbatim in Non-Goals; user confirmed "keep scope as-is" | S:95 R:78 A:90 D:95 |
| 4 | Certain | Real named sessions/servers are already safe from automatic kill; only relay ephemerals are at risk | Confirmed from intake #4; the only automatic kill path is `sweepOrphanedRelaySessions`, prefix-guarded to `rk-relay-` plus the `_rk-ctl` anchor guard (serve_sweep.go:38-47) | S:90 R:88 A:90 D:90 |
| 5 | Certain | Session-scoped `set-option -t <ephemeral> @rk_owner_pid <pid>` is the correct stamp mechanism (no group-option bleed) | Upgraded from intake #7 (Confident→Certain): `SetSessionColor` (tmux.go:885-890) establishes the exact `set-option -t <session> @opt` session-scoped pattern, and the intake notes each relay is its own ephemeral session that dies with its connection | S:88 R:80 A:85 D:88 |
| 6 | Confident | e2e teardown must glob `rk-e2e*` (not literal `rk-e2e`) in both `test-e2e.sh` trap and `global-teardown.ts` | Confirmed from intake #5; verified both layers kill only literal `rk-e2e` (test-e2e.sh:11, global-teardown.ts:6); trap fires on EXIT so glob covers Ctrl-C | S:85 R:78 A:85 D:85 |
| 7 | Confident | Each affected package needs its own `TestMain`; dead-PID pre-sweep parses `<pid>` from `rk-<kind>-<pid>-<ns>` | Upgraded from intake Open Question #3: verified no existing `TestMain` in `internal/tmux` or `api`; Go allows one per package, so each needs its own; helpers (tmux_test.go:881,1029; relay_test.go:34) embed `os.Getpid()` as the second field | S:80 R:80 A:82 D:80 |
| 8 | Certain | `pidAlive` treats `EPERM` (PID owned by another user) as alive → spare | Clarified — `ListServers` scans only `/tmp/tmux-{os.Getuid()}/` (tmux.go:1036), a single-uid socket model, so the sweep never sees a foreign-user server; relays are stamped with the same-user `rk serve` PID; and even a recycled foreign PID returning EPERM is safely spared (benign leak). No legitimate cross-user owner scenario exists | S:90 R:80 A:88 D:90 |
| 9 | Certain | Stamp failure aborts relay setup cleanly (close WS + reap ephemeral via existing defer), NOT log-and-continue | Clarified — log-and-continue contradicts the legacy-unstamped-reap rule: a live-but-unstamped relay (owner=="") would be wrongly reaped by the next sibling sweep, re-creating the exact cross-instance destruction bug. Abort-clean reuses the existing setup-failure pattern in `handleRelay` and is the leak-not-kill-faithful choice | S:90 R:78 A:85 D:88 |

9 assumptions (7 certain, 2 confident, 0 tentative, 0 unresolved).
