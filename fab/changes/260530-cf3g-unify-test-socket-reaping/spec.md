# Spec: Unify Test Socket Reaping

**Change**: 260530-cf3g-unify-test-socket-reaping
**Created**: 2026-05-30
**Affected memory**: `docs/memory/run-kit/tmux-sessions.md`

<!--
  Consolidates backlog items p4mx (unify test-socket prefixes), r8kp (pre-sweep → post-sweep),
  and q7vn (manual rk reaper brute-force-by-prefix). Source: intake.md (read it for the full
  Clarifications + Assumptions transfer). Requirements use RFC 2119 keywords; every requirement
  carries at least one GIVEN/WHEN/THEN scenario (config.yaml stage_directives.spec).
-->

## Non-Goals

- **Changing the relay startup sweep (`sweepOrphanedRelaySessions`)** — that sweep reaps `rk-relay-*` *sessions inside live servers* and is orthogonal to test-socket reaping. `cmd/rk/serve.go` and the relay owner-PID logic are untouched.
- **Re-introducing any `/api/servers`-side hide of test sockets** — the hide is deleted, not relocated or made conditional. The reaper is the single cleanup mechanism.
- **A universal PID-liveness gate on the manual reaper** — explicitly rejected (see Design Decisions). The PID gate survives only on the automatic sweep.
- **A new HTTP endpoint** — `rk reaper --prefix` is a CLI flag on the existing top-level command, not an API route (constitution IV, IX).
- **Changing the `_rk-ctl` anchor or `rk-relay-*` naming** — only *test* socket names are unified.

## A. Test Socket Naming

### Requirement: Unified `rk-test-<role>-<pid>-<ns>` socket name
Every test tmux-socket name produced by the Go test suite MUST follow the single umbrella form `rk-test-<role>-<pid>-<ns>`, where `<role>` identifies the test family (e.g. `unit`, `relay`, `tmuxctl`, `daemon`, `e2e`), `<pid>` is the real OS process ID of the test binary (`os.Getpid()`), and `<ns>` is a uniqueness/namespace token. The previously distinct prefixes (`rk-relay-test-`, the fixed names `rk-tmuxctl-test` and `rk-daemon-test`) SHALL NOT be used.

#### Scenario: Session-order / board / sweep unit tests name a unit socket
- **GIVEN** a Go unit test that creates a tmux socket (`tmux_test.go:967` `withSessionOrderTmux`, `tmux_test.go:1115` `withGroupedSessionTmux`, `board_test.go:261` `withBoardTmux`, `serve_sweep_test.go:76`)
- **WHEN** the helper builds the socket name
- **THEN** the name MUST match `rk-test-unit-<pid>-<ns>` with `<pid>` = `os.Getpid()`

#### Scenario: Relay test names a relay socket
- **GIVEN** `api/relay_test.go:28` `withRelayTmux`
- **WHEN** it builds the socket name
- **THEN** the name MUST match `rk-test-relay-<pid>-<ns>` (replacing the former `rk-relay-test-<pid>-<ns>`)

#### Scenario: Formerly fixed-name sockets gain a PID and namespace
- **GIVEN** `internal/tmuxctl/integration_test.go:25` (const `rk-tmuxctl-test`) and `internal/daemon/daemon_test.go:12` (const `rk-daemon-test`)
- **WHEN** the test creates its socket
- **THEN** the name MUST be `rk-test-tmuxctl-<pid>-<ns>` and `rk-test-daemon-<pid>-<ns>` respectively
- **AND** because each now carries a parseable PID, the automatic post-sweep MUST be able to classify them (today they are unparseable and rely on `t.Cleanup` only)

### Requirement: Single shared `testSocketName(role)` helper
A single shared helper MUST produce the unified name so the seven naming sites stop hand-rolling the format string (current anti-pattern: duplicated `fmt.Sprintf`). The helper SHALL have the shape `testSocketName(role string) string` returning `fmt.Sprintf("rk-test-%s-%d-%d", role, os.Getpid(), time.Now().UnixNano())`.

#### Scenario: Every Go naming site routes through the helper
- **GIVEN** all seven Go test naming sites (the two `tmux_test.go` helpers, `board_test.go` which delegates to `withSessionOrderTmux`, `relay_test.go`, `serve_sweep_test.go`, `integration_test.go`, `daemon_test.go`)
- **WHEN** they construct a socket name
- **THEN** they MUST call `testSocketName(role)` rather than constructing the string inline
- **AND** no inline `fmt.Sprintf("rk-test-...")` socket-name literal SHALL remain at those sites

### Requirement: E2E (TypeScript) socket names embed the Playwright process PID
Playwright e2e server names MUST embed the Playwright **process PID** (`process.pid`) in place of the former `Date.now().toString().slice(-6)` epoch suffix, so the automatic sweep can reason about e2e sockets with the same parse rule as Go sockets. Secondary per-spec servers MUST follow `rk-test-e2e-<role>-<pid>-<ns>` where `<role>` MAY itself contain a hyphen (`multi`, `coupling`).

#### Scenario: Secondary multi-server / coupling specs embed PID
- **GIVEN** `boards-multi-server.spec.ts:7` and `sidebar-server-coupling.spec.ts:7`
- **WHEN** they name a secondary tmux server
- **THEN** the names MUST be `rk-test-e2e-multi-${process.pid}-${suffix}` and `rk-test-e2e-coupling-${process.pid}-${suffix}` respectively (replacing `rk-e2e-multi-${Date.now().slice(-6)}` / `rk-e2e-coupling-...`)
- **AND** `${suffix}` MUST be a single hyphen-free token so the PID remains the second-to-last hyphen field

#### Scenario: E2E harness server and teardown adopt the rk-test prefix
- **GIVEN** `scripts/test-e2e.sh` (`E2E_TMUX_SERVER`) and `app/frontend/tests/e2e/global-teardown.ts` (prefix-glob default)
- **WHEN** the harness sets the dedicated server name and the teardown globs sockets to remove
- **THEN** both MUST use the `rk-test-e2e` prefix (was `rk-e2e`); the glob-shape teardown logic is otherwise unchanged
- **AND** the *primary* harness server SHOULD remain a fixed name `rk-test-e2e` (created once by the shell script, torn down by trap/glob, and caught by the manual reaper's `rk-test` brute-force) — it is not PID-swept and does not need a PID; only the per-spec *secondary* servers carry a PID

### Requirement: `<ns>` is a single hyphen-free token
The `<ns>` (namespace/uniqueness) segment MUST be a single token containing no hyphen, so the PID is unambiguously the second-from-right hyphen field regardless of how many hyphens the role contains.

#### Scenario: Multi-token role with hyphen-free namespace parses unambiguously
- **GIVEN** a socket named `rk-test-e2e-multi-48213-1717050000000000000`
- **WHEN** the name is split on `-`
- **THEN** the final field (`1717050000000000000`) is `<ns>` and the second-to-last field (`48213`) is the PID
- **AND** the role (`e2e-multi`) occupying the middle fields does not affect PID extraction

## B. PID Parsing & Liveness

### Requirement: `parseTestSocketPID` parses the second-to-last hyphen field
`parseTestSocketPID` MUST extract the PID from the **second-to-last** hyphen-delimited field of the socket name (the field immediately before `<ns>`), not a fixed index. Implementation SHALL `strings.Split(name, "-")`, take element `len-2`, and `strconv.Atoi` it. The function MUST return `ok=false` when the name lacks the `rk-test-` prefix, when there are too few fields, or when the candidate field does not parse as an integer.

#### Scenario: Hyphenated role does not break parsing
- **GIVEN** the name `rk-test-e2e-coupling-48213-1717050000000000000`
- **WHEN** `parseTestSocketPID` runs
- **THEN** it MUST return PID `48213`, `ok=true`

#### Scenario: Simple single-token role parses
- **GIVEN** the name `rk-test-unit-48213-1717050000000000000`
- **WHEN** `parseTestSocketPID` runs
- **THEN** it MUST return PID `48213`, `ok=true`

#### Scenario: Non-test name is rejected
- **GIVEN** a name without the `rk-test-` prefix (e.g. `runkit` or `rk-relay-3f9a1c2b`)
- **WHEN** `parseTestSocketPID` runs
- **THEN** it MUST return `ok=false`

#### Scenario: Too few fields or non-numeric PID field is rejected
- **GIVEN** a name such as `rk-test-unit` (too few fields) or `rk-test-unit-abc-<ns>` (non-numeric second-to-last field)
- **WHEN** `parseTestSocketPID` runs
- **THEN** it MUST return `ok=false`

### Requirement: `testPIDAlive` liveness check unchanged
`testPIDAlive` MUST continue to determine liveness via `syscall.Kill(pid, 0)` with a biased-alive interpretation: any error other than `ESRCH` (including `EPERM`) is treated as alive (spare). Only a definitive `ESRCH` (no such process) marks the PID dead.

#### Scenario: Dead PID reaped, ambiguous PID spared
- **GIVEN** two candidate sockets: one whose embedded PID returns `ESRCH`, one whose PID returns `EPERM`
- **WHEN** `testPIDAlive` is queried for each
- **THEN** the `ESRCH` PID MUST be reported dead and the `EPERM` PID MUST be reported alive (leak-not-kill bias)

## C. Automatic Sweep Timing

### Requirement: `TestMain` runs a POST-sweep, not a pre-sweep
In both packages that have it (`internal/tmux/main_test.go`, `api/main_test.go`), `TestMain` MUST run `sweepDeadTestSockets()` **after** `m.Run()` and before `os.Exit`. The pre-sweep (`sweepDeadTestSockets(); os.Exit(m.Run())`) MUST be dropped entirely. New shape:

```go
func TestMain(m *testing.M) {
    code := m.Run()
    sweepDeadTestSockets()
    os.Exit(code)
}
```

#### Scenario: Sweep runs at exit
- **GIVEN** a test package whose `TestMain` is converted to the post-sweep shape
- **WHEN** the package's tests finish and `TestMain` proceeds past `m.Run()`
- **THEN** `sweepDeadTestSockets()` MUST run once, then `os.Exit(code)` with the captured run code

#### Scenario: No pre-sweep remains
- **GIVEN** the converted `TestMain` in either package
- **WHEN** the file is inspected
- **THEN** there MUST be no `sweepDeadTestSockets()` call before `m.Run()`

### Requirement: Sweep stays PID-scoped to dead owners — never a blanket wipe
`sweepDeadTestSockets` MUST reap only sockets whose embedded PID parses (`parseTestSocketPID`) AND is dead (`testPIDAlive` reports `ESRCH`). It MUST NOT perform a blanket `rk-test-*` wipe. Live-PID sockets (belonging to a concurrent `go test ./...` package running as a separate process) MUST be spared, and sockets without a parseable PID MUST be left untouched.

#### Scenario: Concurrent live socket spared, dead orphan reaped
- **GIVEN** the sweep runs with two `rk-test-*` sockets present — one owned by a live PID (simulating a concurrent test process) and one owned by a dead PID
- **WHEN** `sweepDeadTestSockets()` executes
- **THEN** the dead-PID socket MUST be reaped (`tmux kill-server` via `exec.CommandContext` with a 5s timeout)
- **AND** the live-PID socket MUST survive
- **AND** a new test MUST assert exactly this sparing/reaping behavior

#### Scenario: Per-test cleanup unchanged
- **GIVEN** a test that registers `t.Cleanup(kill-server)` for its socket
- **WHEN** the test completes normally
- **THEN** `t.Cleanup` MUST still reap that socket on the normal path; the post-sweep handles only un-catchable SIGKILL/panic/OOM residue

#### Scenario: Sweep kills via context-timed exec
- **GIVEN** the sweep decides to reap a dead-owner socket
- **WHEN** it kills the server
- **THEN** it MUST use `exec.CommandContext` with an explicit timeout and an argument slice — never a shell string (constitution I, Process Execution)

### Requirement: E2E harness teardown MUST NOT signal the caller's process group
`scripts/test-e2e.sh` MUST NOT use `kill 0` (or any group kill targeting its own, caller-inherited process group) in its cleanup trap. Because the script is not detached, its process group is the **caller's** group; when the e2e run executes inline inside an interactive session or an agent-spawned shell, a `kill 0` SIGTERMs the caller's live tmux servers and `-CC` control clients sharing that group — destroying unrelated live sessions with no tmux `kill-server` command (root cause proven 2026-05-30: a 16-server death burst with zero `audit=kill-server` lines; see memory). Instead, the dev server MUST be launched into its **own** process group via `setsid`, and cleanup MUST kill only that group by negative PGID (`kill -- -"$DEV_PGID"`), leaving the caller's group untouched. The `rk-test-e2e*` socket reap loop is unchanged.

#### Scenario: Cleanup kills only the detached dev-server group
- **GIVEN** `scripts/test-e2e.sh` launches the dev server via `setsid bash -c "... exec just dev" &` and captures `DEV_PGID=$!`
- **WHEN** the `EXIT` trap's `cleanup` runs (normal completion, `set -e` abort, or SIGINT/SIGTERM)
- **THEN** it MUST kill the dev subtree via `kill -- -"$DEV_PGID"` and MUST NOT call `kill 0`
- **AND** any tmux server in the caller's process group (e.g. an interactive `kit`/`abbb`/`runWork` server) MUST survive the teardown

#### Scenario: setsid child PID equals its PGID
- **GIVEN** the dev server is started with `setsid bash -c "..." &`
- **WHEN** `DEV_PID=$!` is captured and assigned to `DEV_PGID`
- **THEN** `$!` MUST equal the new process group's PGID (setsid makes the child a session/group leader), so `kill -- -"$DEV_PGID"` targets exactly the dev subtree

## D. Test-Socket Identity Check

### Requirement: `IsGoTestServerName` is replaced by `IsTestServerName`
`IsGoTestServerName` (`internal/tmux/tmux.go:1152-1179`) and its five-prefix allowlist MUST be deleted. A single exported helper `IsTestServerName` MUST replace it, returning `strings.HasPrefix(name, "rk-test-")` — keeping the `"rk-test-"` literal in one place.

#### Scenario: Single-prefix identity
- **GIVEN** the names `rk-test-unit-48213-...`, `rk-test-e2e-multi-48213-...`, and `runkit`
- **WHEN** `IsTestServerName` is called for each
- **THEN** the first two MUST return `true` and `runkit` MUST return `false`

### Requirement: tmuxctl supervisor adopts the single-prefix check and keeps its resurrection guard
`internal/tmuxctl/supervisor.go:37` (`isTmuxSocketCandidate`) MUST adopt `IsTestServerName` in place of `IsGoTestServerName`. This filter MUST remain in force regardless of the `/api/servers` change: it prevents `resolveBootstrap`'s `tmux new-session -s _rk-ctl` from *resurrecting* every orphan test socket on bootstrap. It is a correctness guard, not UI noise reduction.

#### Scenario: Orphan test sockets are not resurrected on bootstrap
- **GIVEN** several leaked `rk-test-*` sockets in `/tmp/tmux-{uid}/` at supervisor bootstrap
- **WHEN** the supervisor enumerates socket candidates for control-mode attach
- **THEN** the `rk-test-*` candidates MUST be excluded by `IsTestServerName` so the supervisor does not create `_rk-ctl` anchors against them (no resurrection)

### Requirement: `/api/servers` lists every server — the hide is deleted
The test-socket hide filter at `api/servers.go:20-37` MUST be deleted entirely (no helper swap, no conditional, no e2e exemption). `/api/servers` MUST return *every* tmux server discovered, including leaked `rk-test-*` orphans. The reaper becomes the sole mechanism that keeps the list clean.

#### Scenario: Orphan test sockets surface in the list
- **GIVEN** a crashed test run left several `rk-test-*` orphan sockets on disk
- **WHEN** the dev UI calls `GET /api/servers`
- **THEN** the response MUST include those orphan servers (alongside real servers)
- **AND** the accepted consequence is that the UI opens an SSE stream per orphan until the operator runs `rk reaper` — this is intended ("surface everything")

#### Scenario: servers fixture asserts everything is returned
- **GIVEN** the `servers_test.go` fixture that previously asserted hidden-vs-shown
- **WHEN** the fixture is updated for this change
- **THEN** it MUST assert that ALL servers (including `rk-test-*`) are returned — the former hide-assertion is inverted

## E. Manual `rk reaper`

### Requirement: Brute-force-by-prefix, no liveness probe
The manual reaper MUST be rewritten to match by prefix with no liveness probe and no name-shape reasoning. Bare `rk reaper` MUST be equivalent to `rk reaper --prefix rk-test` (matching every `rk-test*` socket, `.lock` file, and live server). `rk reaper --prefix <p>` MUST apply identical behavior to `<p>*`. The reaper MUST NOT call `parseTestSocketPID`, MUST NOT call `testPIDAlive`, MUST NOT special-case `rk-e2e-*`, and MUST NOT apply `.lock`-inherits-base-server logic.

#### Scenario: Bare reaper matches the rk-test prefix
- **GIVEN** sockets `rk-test-unit-1-2`, `rk-test-e2e`, `rk-test-relay-9-8`, a `.lock` file `rk-test-unit-1-2.lock`, and an unrelated server `runkit`
- **WHEN** the operator runs bare `rk reaper`
- **THEN** the three `rk-test*` servers and the `rk-test*.lock` file MUST be in the match set and `runkit` MUST NOT

#### Scenario: --prefix matches the supplied prefix
- **GIVEN** servers `proj-a`, `proj-b`, and `runkit`
- **WHEN** the operator runs `rk reaper --prefix proj`
- **THEN** `proj-a` and `proj-b` MUST be in the match set and `runkit` MUST NOT

### Requirement: Dry-run is the default for both bare and `--prefix`
Invoking `rk reaper` (or `rk reaper --prefix <p>`) with no action flag MUST print the match list with each entry's classified action (`kill` for live servers, `remove` for sockets/`.lock` files) and MUST touch nothing on disk or in tmux. The operator MUST pass `--yes` (or `--force`) to actually reap. `--dry-run` MAY be retained as an explicit alias for the now-default preview behavior (resolved per intake's lean — keeping it as a redundant explicit form is acceptable).

#### Scenario: Default invocation previews only
- **GIVEN** matching `rk-test*` artifacts on disk
- **WHEN** the operator runs bare `rk reaper` with no `--yes`/`--force`
- **THEN** the command MUST print each match labeled `kill`/`remove`
- **AND** every matched server, socket, and `.lock` file MUST remain untouched

#### Scenario: --yes confirms the reap
- **GIVEN** the same matches
- **WHEN** the operator runs `rk reaper --yes`
- **THEN** live matched servers MUST be killed via `KillServer` (`exec.CommandContext` + timeout), and matched sockets and `.lock` files MUST be removed via `os.Remove`

#### Scenario: --prefix also defaults to dry-run
- **GIVEN** servers matching `--prefix proj`
- **WHEN** the operator runs `rk reaper --prefix proj` without `--yes`/`--force`
- **THEN** it MUST preview only and reap nothing

### Requirement: `_rk-ctl` and live `rk-daemon` are unconditionally skipped
The reaper MUST never reap the `_rk-ctl` control anchor (`ControlAnchorSessionName`) nor the live production `rk-daemon` server, even under `--prefix` and even with `--yes`/`--force`. A bare `rk-test` reap never matches these, but a broad or mistyped `--prefix` could, and the dry-run default alone is not sufficient protection for the production daemon.

#### Scenario: Broad prefix cannot take down production
- **GIVEN** a live `rk-daemon` server and a `_rk-ctl` anchor present
- **WHEN** the operator runs `rk reaper --prefix rk --yes` (a broad, dangerous prefix passed with `--force`)
- **THEN** `rk-daemon` and `_rk-ctl` MUST be skipped unconditionally and survive
- **AND** other `rk*` matches MAY be reaped (subject to the dangerous-prefix guard below)

### Requirement: Dangerous-prefix guard
An empty prefix, or a prefix of length ≤ 3 characters (e.g. `rk-`), MUST be refused unless `--force` is supplied — such a prefix matches nearly everything (`runkit`, `runWork`, production) and is almost always a typo.

#### Scenario: Short prefix refused without force
- **GIVEN** the operator runs `rk reaper --prefix rk-` (3 chars) without `--force`
- **WHEN** the command validates the prefix
- **THEN** it MUST refuse with an explanatory error and reap nothing

#### Scenario: Empty prefix refused without force
- **GIVEN** the operator runs `rk reaper --prefix ""` without `--force`
- **WHEN** the command validates the prefix
- **THEN** it MUST refuse and reap nothing

#### Scenario: Short prefix permitted with force
- **GIVEN** the operator runs `rk reaper --prefix rk- --force`
- **WHEN** the command validates the prefix
- **THEN** the guard MUST be bypassed and the reap MAY proceed (still skipping `_rk-ctl` and live `rk-daemon`)

### Requirement: All kill/teardown via context-timed exec, no shell strings
All server kills in the reap path MUST use `exec.CommandContext` with an explicit timeout and an argument slice (the existing `KillServer` at `tmux.go:1309-1321` already complies). Socket and `.lock` removal uses `os.Remove`. No shell string construction is permitted anywhere in the reaper (constitution I, Process Execution).

#### Scenario: Reap path uses no shell strings
- **GIVEN** the `--yes` reap path executes a kill
- **WHEN** the kill is dispatched
- **THEN** it MUST go through `KillServer` (`exec.CommandContext` + `withTimeout`) — never `exec.Command` without a context or a shell string

## F. Operating Contract

### Requirement: Document "do not run rk reaper while tests are running"
Because the manual reaper no longer protects live runs by name or PID, the operating contract — **do not run `rk reaper` (bare or `--prefix`) while tests are running** — MUST be documented in the reaper command's `Long` help text and in run-kit memory (`docs/memory/run-kit/tmux-sessions.md`). The automatic sweep's PID-scoping protects concurrent `go test` packages; the manual tool relies on the human.

#### Scenario: Reaper help states the contract
- **GIVEN** the operator runs `rk reaper --help`
- **WHEN** the `Long` help renders
- **THEN** it MUST state that the reaper is brute-force-by-prefix with no liveness protection and MUST warn against running it while tests are in progress

#### Scenario: Memory documents the contract
- **GIVEN** the affected memory `docs/memory/run-kit/tmux-sessions.md`
- **WHEN** it is hydrated for this change
- **THEN** it MUST document the unified `rk-test-<role>-<pid>-<ns>` convention (PID = second-to-last field), the post-sweep timing, the brute-force-by-prefix + dry-run-default reaper, the operating contract, and the fact that `/api/servers` now lists every server (the hide was deleted)

### Requirement: Companion `.spec.md` updated alongside modified `.spec.ts`
Per constitution Test Companion Docs, any modified Playwright `.spec.ts` (`boards-multi-server.spec.ts`, `sidebar-server-coupling.spec.ts`) MUST ship an updated sibling `.spec.md` in the same commit, reflecting the new `rk-test-e2e-*` secondary-server naming.

#### Scenario: Modified spec files carry updated companions
- **GIVEN** `boards-multi-server.spec.ts` and `sidebar-server-coupling.spec.ts` are modified for the new naming
- **WHEN** the change is committed
- **THEN** `boards-multi-server.spec.md` and `sidebar-server-coupling.spec.md` MUST be updated in the same commit to reflect the new server-naming setup

## Design Decisions

1. **Manual reaper is brute-force-by-prefix, not PID-gated**: the operator who runs the reaper asserts that nothing live needs the matched sockets.
   - *Why*: a deliberate operator escape hatch; the live-vs-leaked safety the e2e exclusion used to provide is replaced by (a) dry-run-default preview, (b) unconditional `_rk-ctl`/`rk-daemon` skips, (c) the dangerous-prefix guard, and (d) the documented operating contract.
   - *Rejected*: a universal PID-liveness gate on the manual path. A live-system check found 12 `rk-e2e-*` servers whose embedded epoch-suffix "PID" was dead while the tmux server was alive — the embedded-number-is-PID assumption is not reliable for a *kill* decision under the old e2e naming, and a PID gate adds machinery without adding safety the operating contract does not already provide. The PID gate is retained *only* on the automatic sweep, where the embedded value is genuinely `os.Getpid()` of the live test binary.

2. **`/api/servers` deletes its hide entirely rather than exempting e2e**: surface everything; the reaper is the sole cleanup tool.
   - *Why*: under the unified rule, a hide keyed on `rk-test-` would also hide visible e2e runs; the user chose to surface every server so the operator sees exactly what the reaper will reap.
   - *Rejected*: keeping a conditional hide (e.g. hide dead-PID `rk-test-*` but show e2e). Accepted cost of deletion: per-orphan SSE churn in the dev UI until the operator reaps.

3. **PID parsed as the second-to-last hyphen field**: robust to multi-token roles (`e2e-multi`, `e2e-coupling`).
   - *Why*: parsing from the right with a fixed `len-2` index removes any dependence on the role being a single segment; only constraint is `<ns>` being hyphen-free.
   - *Rejected*: a fixed left-index parse (the old `rk-<kind>-<pid>-<ns>` 2nd-field rule), which breaks the moment a role contains a hyphen.

4. **Dry-run is the default for both bare and `--prefix`**: preview first, `--yes`/`--force` to act.
   - *Why*: reverses the earlier "act by default" framing; composes with the deleted `/api/servers` hide so the UI shows the pile, the dry-run shows what will be reaped, then the operator confirms.
   - *Rejected*: act-by-default on the bare `rk-test` path. Even the bare path now previews.

## Deprecated Requirements

### `IsGoTestServerName` five-prefix allowlist
**Reason**: "Is this a test artifact?" collapses to a single `HasPrefix(name, "rk-test-")` check. The five-prefix allowlist (`rk-test-`, `rk-relay-test-`, `rk-verify-`, `rk-tmuxctl-test`, `rk-daemon-test`) — including the dead `rk-verify-` entry — is removed.
**Migration**: `IsTestServerName` (single `HasPrefix("rk-test-")`); all test sockets renamed under the unified umbrella (Domain A).

### `/api/servers` test-socket hide filter
**Reason**: the reaper becomes the sole cleanup mechanism; the UI surfaces every server (Domain D).
**Migration**: none — the hide is deleted; `servers_test.go` assertions are inverted to expect all servers.

### Manual reaper PID-probe, e2e-exclusion, and `.lock`-inheritance
**Reason**: the manual reaper is now brute-force-by-prefix (Domain E). The liveness probe in `classifyReap`, the `rk-e2e-*` skip, and the `.lock`-inherits-base-server logic are removed.
**Migration**: prefix match + dry-run-default + unconditional `_rk-ctl`/`rk-daemon` skip + dangerous-prefix guard + operating contract.

### `TestMain` pre-sweep
**Reason**: converted to a post-sweep (Domain C). The pre-sweep (`sweepDeadTestSockets(); os.Exit(m.Run())`) ran before tests; the only automatic cleanup of un-catchable SIGKILL/panic/OOM residue is now the post-sweep, with the manual `rk reaper` as the by-hand janitor.
**Migration**: `code := m.Run(); sweepDeadTestSockets(); os.Exit(code)` in both `internal/tmux/main_test.go` and `api/main_test.go`.

### Epoch-suffix e2e socket naming
**Reason**: `Date.now().toString().slice(-6)` is not a PID, so `parseTestSocketPID` could not reason about e2e sockets.
**Migration**: e2e secondary servers embed `process.pid` under the unified `rk-test-e2e-*` umbrella (Domain A).

## Assumptions

<!-- SCORING SOURCE: fab score reads only this table. Starts from intake.md's Assumptions
     (12 rows: 9 Certain, 3 Confident), each confirmed/upgraded with the action noted in Rationale.
     Three spec-level assumptions added (#13–#15). Spec gate threshold for `refactor` is 3.0. -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Unify all test sockets under `rk-test-<role>-<pid>-<ns>`; collapse the 5-prefix allowlist + e2e exclusion into one `HasPrefix("rk-test-")` | Confirmed from intake #1 — core of p4mx, explicitly chosen by user; spec Domain A/D encode it directly | S:95 R:60 A:90 D:90 |
| 2 | Certain | Manual `rk reaper` = brute-force-by-prefix, no PID/liveness probe; bare ≡ `--prefix rk-test`; kills live servers + removes sockets + `.lock`; dry-run is the default for both bare and `--prefix`, `--yes`/`--force` required to act | Confirmed from intake #2 — encoded in Domain E requirements + Design Decision 1/4 | S:95 R:50 A:85 D:85 |
| 3 | Certain | Automatic sweep stays PID-scoped (dead-PID owners only), NOT a blanket wipe, so concurrent `go test ./...` packages don't kill each other | Confirmed from intake #3 — Domain C requirement + concurrent-sparing scenario | S:90 R:55 A:90 D:85 |
| 4 | Certain | Convert `TestMain` pre-sweep → post-sweep in `internal/tmux` and `api`; drop the pre-sweep entirely; manual reaper is the only auto-cleanup for SIGKILL residue | Confirmed from intake #4 — Domain C + Deprecated Requirements (pre-sweep) | S:90 R:60 A:85 D:85 |
| 5 | Certain | Embed real PID in e2e (Playwright) socket names (`rk-test-e2e-<pid>-…`) via `process.pid`, replacing the `Date.now()` epoch suffix | Confirmed from intake #5 — Domain A (e2e naming) + Deprecated (epoch suffix) | S:90 R:55 A:85 D:80 |
| 6 | Certain | Delete `IsGoTestServerName`; tmuxctl supervisor + reaper adopt single `HasPrefix("rk-test-")`; `/api/servers` DELETES its hide filter entirely and lists every server | Confirmed from intake #6 — Domain D, three call sites diverge (two adopt, one deletes) | S:95 R:45 A:90 D:90 |
| 7 | Confident | Document an operating contract ("don't run `rk reaper` while tests run") in reaper help + memory | Confirmed from intake #7 — Domain F requirement | S:80 R:75 A:80 D:75 |
| 8 | Confident | Introduce a single shared `testSocketName(role)` helper to replace the duplicated `fmt.Sprintf` naming sites | Confirmed from intake #8 — Domain A requirement; code-quality anti-pattern (duplication) | S:75 R:85 A:85 D:80 |
| 9 | Confident | Add a post-sweep test proving live-PID sparing holds under a simulated concurrent live socket | Confirmed from intake #9 — Domain C concurrent-sparing scenario marked MUST | S:80 R:80 A:85 D:80 |
| 10 | Certain | `parseTestSocketPID` parses the PID as the **second-to-last hyphen field**; roles may contain hyphens; `<ns>` MUST be a single hyphen-free token | Confirmed from intake #10 — Domain B requirement + Design Decision 3 | S:95 R:55 A:60 D:50 |
| 11 | Certain | `/api/servers` hide is **deleted entirely** — all servers listed, including leaked `rk-test-*` orphans; reaper is the sole list-cleaning mechanism; accepted cost is per-orphan SSE churn until reaped | Confirmed from intake #11 — Domain D requirement + Design Decision 2 | S:95 R:45 A:55 D:45 |
| 12 | Certain | `--prefix` (and bare) default to **dry-run**; `--yes`/`--force` to act; `_rk-ctl` + live `rk-daemon` unconditionally skipped even under `--prefix`; empty/≤3-char prefix refused unless `--force` | Confirmed from intake #12 — Domain E (three separate requirements + scenarios) | S:95 R:60 A:55 D:50 |
| 13 | Confident | Primary e2e harness server stays a fixed name `rk-test-e2e` (created by the shell script, torn down by trap/glob, caught by the reaper's `rk-test` brute-force); only per-spec secondary servers carry a PID | Resolved per intake's stated lean (Open Questions) — encoded as a SHOULD in Domain A; a fixed-name primary cannot be PID-swept and does not need to be | S:78 R:70 A:75 D:72 |
| 14 | Confident | `--dry-run` is retained as an explicit alias for the now-default preview behavior (rather than removed) | Resolved per intake's stated lean (Open Questions) — minor CLI-surface detail; keeping it is backward-compatible and low-cost; encoded as a MAY in Domain E | S:75 R:65 A:80 D:78 |
| 15 | Confident | Companion `.spec.md` files for the two modified `.spec.ts` are updated in the same commit (constitution Test Companion Docs) | New spec-level assumption — constitution mandates it; Domain F requirement makes it explicit | S:82 R:85 A:88 D:80 |

15 assumptions (9 certain, 6 confident, 0 tentative, 0 unresolved).
