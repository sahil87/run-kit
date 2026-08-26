---
type: memory
description: "Test-socket isolation on the tmux substrate: unified rk-test-<role>-<pid>-<ns> naming, the TestMain POST-sweep, rk mux reap (dry-run default, --force, --ephemeral), /api/servers listing every server, the RK_SERVER_ALLOWLIST enumeration bound, the e2e rk-test-e2e-<token>- family anchor + E2E_TMUX_FAMILY, and the port-fallback rule."
---
# Test Sockets & Test Isolation

**Domain**: run-kit

## Unified Test-Socket Naming — `rk-test-<role>-<pid>-<ns>`

**Every** test tmux-socket name — Go *and* Playwright — follows one umbrella form (260530-cf3g-unify-test-socket-reaping):

```
rk-test-<role>-<pid>-<ns>
```

- `<role>` identifies the test family: `unit`, `relay`, `tmuxctl`, `daemon`, `e2e`, and the hyphenated e2e secondaries `e2e-<token>-multi`, `e2e-<token>-msb` (worktree token embedded — § E2E (Playwright) naming below). **A role MAY contain hyphens.**
- `<pid>` is the real OS PID of the test binary (`os.Getpid()` in Go, `process.pid` in Playwright).
- `<ns>` is a single **hyphen-free** uniqueness token (Go: `time.Now().UnixNano()`; Playwright: a `Date.now().toString().slice(-6)` suffix). It being hyphen-free is what makes `<pid>` unambiguously the **second-to-last** hyphen field regardless of how many hyphens the role has.

**Single shared naming helper**: Go tests build the name via `testSocketName(role string) string` → `fmt.Sprintf("rk-test-%s-%d-%d", role, os.Getpid(), time.Now().UnixNano())`. Because Go `_test.go` symbols are package-private, the helper is duplicated across the test-support files of each package that needs it (`internal/tmux/main_test.go`, `api/main_test.go`, and small local equivalents in `internal/tmuxctl`/`internal/daemon`); all seven Go naming sites route through it — no inline `fmt.Sprintf("rk-test-…")` socket literal remains (the only intentional exceptions are the helper definitions and `socketsweep_test.go`, which hand-builds live-vs-dead-PID sockets for the sparing test).

**E2E (Playwright) naming — per-worktree derived family**: the e2e socket identity derives from the worktree, not a fixed name. `scripts/e2e-env.sh` computes a hyphen-free **token** — lowercase alphanumerics from the checkout's basename (hyphens stripped), an all-digits token gaining a `wt` prefix, plus a 2-char `cksum` hash tail of the absolute toplevel path so two same-named checkouts diverge — and sets the **family anchor** `E2E_TMUX_FAMILY=rk-test-e2e-<token>-` (trailing hyphen included; the `rk-test-` umbrella is preserved) and the **primary** `E2E_TMUX_SERVER=rk-test-e2e-<token>-0`, created once by `scripts/test-e2e.sh`, torn down by its family-anchored trap glob, and caught by the manual reaper's `rk-test` brute-force. Every family member carries a role segment after the token: secondary per-spec servers are `${TMUX_FAMILY}<role>-${process.pid}-${epoch}` (e.g. `rk-test-e2e-<token>-multi-48213-1717…`), so `parseTestSocketPID` still reads the PID from the second-to-last field, while the primary's `-0` tail keeps it un-PID-sweepable (the `wt` prefix guarantees an all-digits token never parses as one). Because tokens are hyphen-free, the anchor `rk-test-e2e-<tokenA>-` prefixes a `rk-test-e2e-<tokenB>-…` name only when the tokens are equal — cross-worktree family matching is impossible by construction under glob and `HasPrefix` semantics alike. The declaration sites are `scripts/e2e-env.sh` (derivation), `scripts/test-e2e.sh` + `scripts/pw.sh` (which pass `E2E_TMUX_SERVER`/`E2E_TMUX_FAMILY` into the Playwright env), and the spec tree's single env reads in `app/frontend/tests/e2e/_tmux.ts` (`TMUX_SERVER`/`TMUX_FAMILY`) and `global-teardown.ts` (see `architecture.md` § Playwright E2E Tests). A preset `E2E_TMUX_SERVER` with no preset family implies family = the server name AS-IS (no appended hyphen), so prefix matching admits the primary itself.

### E2E creation sites mark their servers `@rk_ephemeral`

Both e2e creation sites set `@rk_ephemeral 1` server-scoped at birth: `scripts/test-e2e.sh` marks the primary `rk-test-e2e-<token>-0` server immediately after its `new-session` creation, and the Playwright `_tmux.ts` `createSession` helper marks its target server after a successful create, inside its existing best-effort try block — one seam covering the primary and every `rk-test-e2e-<token>-<role>-<pid>-<epoch>` secondary the multi-server specs spin up (a repeated set is an idempotent no-op). The marking is belt-and-braces alongside the `rk-test-*` name umbrella: `IsTestServerName(name)` ⇒ treated-as-ephemeral already covers these names, so the option changes no behavior for them — it standardizes the creator-intent semantic for option-reading consumers (`rk mux reap --ephemeral`, the snapshotter's retire-on-mark). Go test-scaffolding creation sites are deliberately NOT marked: creation there is ~50 heterogeneous raw `new-session` sites (only the *naming* is centralized, via `testSocketName`), and the PID-scoped `TestMain` post-sweep self-heals Go-test residue independently.

### PID parsing — second-to-last hyphen field

`parseTestSocketPID(name) (int, bool)` (duplicated in `internal/tmux/main_test.go` and `api/main_test.go`) extracts the PID from the **second-to-last** hyphen-delimited field — `strings.Split(name, "-")`, take element `len-2`, `strconv.Atoi`. It returns `ok=false` when the name lacks the `rk-test-` prefix, has fewer than 5 fields (`rk`, `test`, `<role>`, `<pid>`, `<ns>`), or the candidate field is non-numeric.

Parsing from the right (fixed `len-2` index) is what makes hyphenated roles work: `rk-test-e2e-sunnygazelleac-multi-48213-1717…` yields PID `48213` because the role (`e2e-sunnygazelleac-multi`) occupies the middle fields and never shifts the PID's position. A fixed *left* index (the field immediately after the prefix) would break the moment a role contained a hyphen.

`testPIDAlive(pid)` reports liveness via `syscall.Kill(pid, 0)` with a biased-alive interpretation — only a definitive `ESRCH` marks the PID dead; any other error (incl. `EPERM`) is treated as alive (leak-not-kill bias). A non-positive PID is treated as dead defensively.

### `IsTestServerName` — single-prefix identity check

"Is this a test artifact?" is the single exported check `tmux.IsTestServerName(name) bool` → `strings.HasPrefix(name, "rk-test-")` (`internal/tmux/tmux.go`); the `"rk-test-"` literal lives in exactly this one place.

`IsTestServerName` is **intentionally NOT applied** in `ListServers` nor in the `/api/servers` handler — internal consumers (`board.go` in particular) iterate every real tmux server, and `/api/servers` surfaces every server so the operator sees exactly what `rk mux reap` will reap. Its only consumer is the **tmuxctl supervisor's resurrection guard** (`isTmuxSocketCandidate` in `internal/tmuxctl/supervisor.go`): leaked `rk-test-*` sockets (including `rk-test-e2e-*`) are excluded from the control-mode candidate set so `resolveBootstrap`'s `new-session -s _rk-ctl` does not *resurrect* every orphan test socket on bootstrap. This is a **correctness guard, not UI noise reduction**, and stays in force regardless of `/api/servers` listing every server.

## Automatic Test-Socket Sweep — POST-sweep in `TestMain`

Both packages that have it (`internal/tmux/main_test.go`, `api/main_test.go`) run a **post-sweep** — `sweepDeadTestSockets()` runs *after* `m.Run()`, never before:

```go
func TestMain(m *testing.M) {
    code := m.Run()
    sweepDeadTestSockets()
    os.Exit(code)
}
```

There is no pre-sweep: the post-sweep means **each run reaps its OWN dead-PID residue** on the way out.

**PID-scoped to dead owners only — never a blanket wipe.** `sweepDeadTestSockets` enumerates `/tmp/tmux-<uid>/` and `kill-server`s a socket only when its embedded PID **parses** (`parseTestSocketPID`) **AND is dead** (`testPIDAlive` reports `ESRCH`). Live-PID sockets — which belong to a **concurrent `go test ./...` package running as a separate process** — are spared, so packages running in parallel do not kill each other. Sockets without a parseable PID (no role/pid/ns shape) are left untouched. Kills use `exec.CommandContext` + a 5s timeout and an argument slice (constitution I) — never a shell string. Best-effort: enumeration or kill failures are ignored (a leaked socket is harmless residue; never blocking tests is the priority).

`t.Cleanup(kill-server)` reaps each socket on the normal path; the post-sweep is the only automatic cleanup for **un-catchable SIGKILL / panic / OOM residue**. The manual `rk mux reap` is the by-hand janitor for cruft that has already accumulated on disk across runs.

## `rk mux reap` — Brute-Force-by-Prefix Operator Cleanup

`rk mux reap` is an **operator-invoked** member of the `rk mux` family ([agent-messaging](/run-kit/agent-messaging.md)), built by the `newReapCmd(use, deprecated)` two-instance constructor and registered on `muxCmd` (260529-fww2-rk-reaper-command). `reapAliasCmd` is a **hidden deprecation alias** `rk reaper` at the root that prints cobra's `Deprecated` pointer to stderr and runs byte-identically (a human-typed verb, so the alias is removable in a future release — unlike the permanent `agent-hook` contract). Neither form is wired into any startup path. The command body (`cmd/rk/reaper.go`) is thin — flag parsing + summary rendering; all scan/classify/reap logic lives in `internal/tmux/reaper.go` (constitution §III). The family member rejects an explicitly-set inherited `-L/--server` with a usage error (exit 2); the root alias carries no `-L` flag.

### No relay startup sweep

There is no relay startup sweep. Relay ephemerals do not exist (the relay attaches directly), and board pin-sessions (`_rk-pin-*`) are PERSISTENT across rk restarts (a valid state, not an orphan), so there is no in-server session class to reap at startup. The reaper is the operator-only janitor for **whole test servers and dead/stale sockets/`.lock` files** — different scope, different trigger. (260602-qn62-move-based-board-pin-sessions)

### Brute-force-by-prefix — no liveness probe to match

The reaper's default match is **purely by name prefix** — no PID parse, no name-shape reasoning, no e2e exclusion, no `.lock`-inherits-base-server logic; `--ephemeral` adds a second, option-based match dimension (see § `--ephemeral` below). It iterates **RAW** socket-dir candidates via `ScanSocketDir(ctx)` (NOT `ListServers`, which probes dead sockets away) and classifies each:

- **Bare `rk mux reap`** ≡ `rk mux reap --prefix rk-test` — matches every `rk-test*` socket, `.lock` file, and live server.
- **`rk mux reap --prefix <p>`** applies identical behavior to `<p>*`.
- A matched **live server** → `KillServer` (`ReapActionKill`); a matched **socket** (dead) or **`.lock` file** → `os.Remove` (`ReapActionRemove`).

The only thing requiring the outside world is the live-vs-dead distinction for a matched, non-`.lock` candidate. `classifyReap(name, prefix, ephemeral, protected, serverLive)` is a **pure function** (`internal/tmux/reaper.go`) — `serverLive` and the `ephemeral`/`protected` membership sets are supplied by the caller (`reapCandidates`, which calls `probeServerAlive` only when `probeNeeded` says the kill-vs-remove decision depends on it). `ReapAction` is the exported enum (`ReapActionSkip`/`Kill`/`Remove`); the full matrix is unit-testable via `TestClassifyReap` without spawning servers.

### `--ephemeral` — union with the live option dimension

`rk mux reap --ephemeral` matches the **union** of the prefix match (unchanged; bare invocation still defaults to `--prefix rk-test`) and every **live** server carrying `@rk_ephemeral`. The mark sets are caller-computed: `enumerateMarkedServers(ctx, ephemeralEnabled)` enumerates live servers via `ListServers` (liveness-probed — a tmux command on a dead socket resurrects a server, so dead sockets are never queried and stay prefix-only territory), queries `IsEphemeralServer`/`IsProtectedServer` per live server (skipping `_rk-ctl`/`rk-daemon` before the query; a per-server read failure logs and simply does not match), and returns BOTH sets — the ephemeral set is nil when the dimension is disabled, the protected set is ALWAYS enumerated (the skip it feeds is unconditional). The resulting name-sets are threaded into `reapCandidates` as data so `classifyReap`/`probeNeeded` stay pure. Ephemeral matches are live servers, so they classify as kill. The dangerous-prefix guard applies to the prefix dimension only — option matches are explicit creator opt-in and need no length guard. Without the flag the ephemeral dimension is disabled entirely and behavior is byte-identical to the prefix-only sweep. Safety framing (stated in the command's `Long` help): the option is explicit opt-in set by the creator, making this sweep safer than prefix guessing — and it gives agents a sanctioned bulk-cleanup verb so they stop reaching for raw `tmux kill-server`.

### Hard-skips (never reaped, even under `--prefix` + `--force`)

- **`_rk-ctl` control anchor** (`ControlAnchorSessionName`) — owned by `tmuxctl`.
- **Live `rk-daemon` production server** (named const `productionDaemonServer = "rk-daemon"`, a local literal to avoid an `internal/daemon` import edge).
- **Live `@rk_protected` servers** — skipped unconditionally: under `--ephemeral`, under any prefix match, always; protected beats ephemeral when one server carries both marks.

The name-skips are short-circuited before the prefix/ephemeral check in *both* `classifyReap` and `probeNeeded`, so a broad or mistyped `--prefix rk` — or a hypothetical `@rk_ephemeral` mark on one of them — can never take down production — the dry-run default alone is not sufficient protection for the daemon. The protected skip is live-only and checked in the same lock-step: a LIVE protected server yields `ReapActionSkip` before the prefix/ephemeral checks in both functions, and `probeNeeded` still probes a protected-marked candidate because the option dies with its server — the DEAD socket file of a formerly-protected server is inert and stays removable.

### Dry-run is the DEFAULT; `--yes`/`--force` to act

Invoking `rk mux reap` (bare or `--prefix`) with no action flag **prints the match list** with each entry's classified action (`kill`/`remove`) and **touches nothing**. The action gate is `act := (yes || force) && !dryRun` (per-instance closure-bound flag vars):

- `--yes` (or `--force`) → actually reap.
- `--dry-run` is an **explicit alias** for the default preview and always wins (forces preview even if `--yes`/`--force` were also passed).
- `--force` is the **ONLY** flag that bypasses the dangerous-prefix guard. `--yes` acts but does NOT bypass the guard, so an operator who only confirms is still protected from a typo'd short prefix.

**Dangerous-prefix guard** (`ReapTestServers`): an empty prefix or one of length ≤ 3 (e.g. `rk-`) matches nearly everything (`runkit`, `runWork`, production) and is **refused** unless `--force`. The guard refuses regardless of `act`, so even a dry-run with a dangerous prefix reports the refusal rather than previewing a near-everything match. The guard applies to the **prefix dimension only** — `--ephemeral` matches are explicit creator opt-in and need no length guard.

### Operating contract — do NOT run while tests are running

Because the manual reaper has **no live-run protection by design** (no name allowlist, no PID gate), the operating contract is: **do not run `rk mux reap` (bare or `--prefix`) while tests are running** — it will kill their live tmux servers. The automatic post-sweep's PID-scoping protects concurrent `go test` packages; the manual tool relies on the human. This contract is stated in the command's `Long` help text and here.

### I/O routine, test seam, and partial-failure contract

`ReapTestServers(ctx, prefix, act, force, ephemeralOnly) (ReapResult, error)` is the public entry point: it applies the dangerous-prefix guard, scans via `ScanSocketDir`, computes the mark sets via `enumerateMarkedServers(ctx, ephemeralOnly)` (ephemeral nil when the dimension is disabled; protected always enumerated), then delegates per-candidate work to the internal seam `reapCandidates(ctx, dir, prefix, candidates, ephemeral, protected, probe, act)` — passing `socketDirPath()` and `probeServerAlive`. Tests drive `reapCandidates` directly with a temp dir + fake prober + fake ephemeral/protected sets (no real tmux server spawned). `ReapResult` carries `Killed []string`, `RemovedSockets []string`, and `DryRunPlan []ReapPlanEntry` (`{Name, Action}` pairs, populated only on a dry-run).

**Partial failure**: each kill/remove failure is logged via `slog.Warn` and skipped; iteration continues; a joined aggregate error (`reaper partial failures: …`) is returned at the end (nil when all succeed). The command renders the summary *before* surfacing the aggregate error, so the operator sees what was reaped even on partial failure.

## `/api/servers` Lists Every Server — No Test-Socket Hide

There is no `/api/servers` test-socket hide filter (260530-cf3g-unify-test-socket-reaping). `handleServersList` (`api/servers.go`) returns the output of `tmux.ListServers` directly, so the response includes **every** tmux server discovered — including leaked `rk-test-*` orphans. The reaper is the **sole** mechanism that keeps this list clean.

**Accepted consequence**: after a crashed test run, the dev UI lists the orphans **and opens an SSE stream per orphan server** until the operator runs `rk mux reap`. This is intended ("surface everything") — the user sees exactly the pile the reaper will reap. The `servers_test.go` fixture asserts that ALL servers (including `rk-test-*` / `rk-test-e2e-*`) are returned (`TestHandleServersList_ReturnsAllServersIncludingTestSockets`).

## `RK_SERVER_ALLOWLIST` — Env-Gated Test-Isolation Filter in `ListServers`

`ListServers` applies an **env-gated allowlist filter** read from `RK_SERVER_ALLOWLIST` (const `tmux.ServerAllowlistEnv`, `internal/tmux/tmux.go`) (260531-tmnm-test-scoped-server-enumeration). The env var is read **in-package** via `os.Getenv` — matching the `RK_TMUX_CONF`/`OriginalTMUX` precedent — **NOT** threaded through `internal/config` (`ListServers` is a `ctx`-only free function and `internal/tmux` has no `config` dependency to carry it).

- **Unset / whitespace-only (production default)**: the filter is a no-op — `ListServers` returns all live servers. The `/api/servers` "surface every server" contract (see § above) and the `IsTestServerName` design intent are preserved exactly. An empty value is treated as unset, so a blank env never means "match nothing".
- **Set (test only)**: the post-probe live-server list is narrowed to names admitted by `matchesServerAllowlist(name, allowlist)` — a pure, table-tested predicate (`TestMatchesServerAllowlist`, no live tmux server needed). The allowlist is a **comma-separated list of prefixes**; each token is trimmed, empty tokens skipped, and a name matches when it `strings.HasPrefix` ANY token (exact match = prefix-of-itself).

**Why prefix, not exact**: multi-server e2e specs create secondaries in `beforeAll` named `rk-test-e2e-<token>-<role>-<pid>-<epoch>` (e.g. `rk-test-e2e-<token>-multi-*`, `…-scope-*`, `…-msb-*`). Exact match on the primary (`rk-test-e2e-<token>-0`) would wrongly exclude them and break those specs; the harness therefore exports the **family anchor** `rk-test-e2e-<token>-` — trailing hyphen included — as the allowlist, admitting the primary plus this-run secondaries. Because the token is hyphen-free, the anchor prefixes a sibling worktree's family only when the tokens are equal, so the prefix match can never bleed across worktrees; and the anchor still excludes the broader `rk-test-` umbrella — a `rk-test-relay-*` Go-test server is NOT admitted.

**Why the filter lives in `ListServers`, not the `/api/servers` handler**: the board route attaches servers from **two** distinct `ListServers`-rooted paths — (1) `GET /api/servers` (`api/servers.go`) populating `useSessionContext().servers`, and (2) the internal `board.go` board-entry enumeration (`ListBoards` / `GetBoard`, which iterate `ListServers` per-server) (260602-qn62). Filtering only the HTTP handler would leave path (2) unscoped, so the SSE inflation persists. Placing it in `ListServers` means **all** enumeration consumers inherit the scope when the env is set: `/api/servers` and `board.go`. This is the intended outcome in the test environment (the only environment that sets the var).

**Why it matters**: on the board route the frontend attaches **all** known servers (boards are cross-server by design). All N per-server subscriptions ride ONE state-socket WebSocket that holds no HTTP/1.1 pool slot (260716-qf3j-state-socket), so scoping the backend READ path to the worktree's e2e family does not relieve connection-pool pressure; the allowlist's value is that it **bounds which servers a test backend enumerates**, one subscription per test server rather than one per live `kit`/`runWork`/orphan server on a busy operator box.

### Allowlist vs `IsTestServerName` denylist — opposite directions

These two mechanisms point in **opposite directions** and coexist without conflict:

| Mechanism | Question | Hides | Used by |
|-----------|----------|-------|---------|
| `RK_SERVER_ALLOWLIST` (forward allowlist) | "Is this a server THIS test run may see?" | **normal** servers from tests | `ListServers` (env-gated) |
| `IsTestServerName` (`HasPrefix "rk-test-"`, denylist) | "Is this a test server?" | **test** servers from normal operation | tmuxctl supervisor resurrection guard only |

The `tmuxctl` supervisor's **enumeration** is **unaffected**: it does NOT call `ListServers` — it enumerates the socket dir via `os.ReadDir` + `isTmuxSocketCandidate` (`supervisor.go`), so its resurrection guard is independent of the allowlist. Its **dial path does consult the allowlist**: the `productionDial` `@rk_origin` stamp is gated on the exported `tmux.ServerAllowed(name)` predicate (the same `matchesServerAllowlist` semantics `ListServers` applies, exported so "which servers do I stamp" is the same question as "which servers does this deployment cover" — otherwise the e2e backend's supervisor, which dials the host's sockets, would overwrite host servers' origins with its own e2e origin).

### Harness wiring — backend READ path vs WRITE socket

`scripts/test-e2e.sh` exports `RK_SERVER_ALLOWLIST` (set to `E2E_TMUX_FAMILY`, the `rk-test-e2e-<token>-` anchor) into the **dev backend** process — the own-process-group `bash -c "… exec just dev"` launch — so the backend's `ListServers` read path is scoped for the run. This is distinct from `E2E_TMUX_SERVER`, which scopes the **socket the tests WRITE to** (a shell/TS-only variable Go never reads). A dedicated `RK_*` name is honest about allowlist intent and matches the env-var convention rather than repurposing the socket-naming variable for Go config.


## Design Decisions

### Never `kill 0` from a non-detached shell script
**Decision**: Launch the subtree you intend to tear down into its **own** process group — `set -m` job control (`bash -c "… exec <cmd>" &`, portable: macOS has no `setsid`) makes the background job a group leader, so `PGID=$!` — then **verify via `ps` that the child's real PGID is not the script's own** (abort on match — a silent job-control failure would re-arm the grenade), and kill **only** that group by negative PGID: `kill -- "-$PGID"`. Guard with `[ -n "$PGID" ]` so a trap firing before launch is a no-op.
**Why**: A script that runs inline (sourced into an interactive shell or spawned by an agent) shares the **caller's** process group, so `kill 0` / `kill -- -$$` SIGTERMs the caller's unrelated processes — including live tmux servers and `-CC` control clients. Root cause of a 16-server death burst with zero `audit=kill-server` lines; constitution VI.
**Rejected**: `kill 0` / `kill -- -$$` from the script's own (shared) process group.
*Introduced by*: 260530-cf3g-unify-test-socket-reaping

### Embedded-PID naming: PID = second-to-last hyphen field
**Decision**: When a name encodes `<prefix>-<role>-<pid>-<ns>` and `<role>` may itself contain hyphens (e.g. `e2e-multi`), parse the PID from the **right** (`strings.Split(name, "-")`, element `len-2`) and keep `<ns>` a single hyphen-free token.
**Why**: This decouples PID extraction from the role's segment count.
**Rejected**: A fixed left index — it breaks the moment a role gains a hyphen.
*Introduced by*: 260530-cf3g-unify-test-socket-reaping

### Manual cleanup tools default to dry-run; only `--force` bypasses safety guards
**Decision**: A brute-force-by-prefix janitor (`rk mux reap`) is intentionally not PID-gated — the operator asserts nothing live needs the matched artifacts. The safety budget is: dry-run-default preview, unconditional hard-skips for production-critical names (`_rk-ctl`, `rk-daemon`), a dangerous-prefix guard (empty/≤3 chars), and a documented operating contract ("don't run while tests run"). `--yes` (confirm) and `--force` (bypass guard) are **separate** flags.
**Why**: Confirming an action does not waive typo protection.
*Introduced by*: 260530-cf3g-unify-test-socket-reaping

### Test isolation via an env-gated allowlist at the enumeration root, not the HTTP handler
**Decision**: When a behavior fans out to multiple backend paths (here: the board route reaches `ListServers` via both `/api/servers` and internal `board.go` enumeration), scope it at the shared **root function** (`ListServers`), not at one consumer (`handleServersList`). Gate the filter behind an env var read **in-package** so production (env UNSET) is a byte-for-byte no-op and only the test harness narrows the list. Extract the match logic as a pure predicate (`matchesServerAllowlist`).
**Why**: A handler-only filter leaves sibling paths unscoped. The in-package read matches the package's existing `os.Getenv` precedent — no new cross-package import for one scoping value. A pure predicate is table-testable without live tmux servers.
**Rejected**: Filtering only in `handleServersList` — leaves the `board.go` enumeration path unscoped.
*Introduced by*: 260531-tmnm-test-scoped-server-enumeration

### A forward allowlist and a reverse denylist can coexist — keep them distinct
**Decision**: Hiding *normal* servers *from tests* (`RK_SERVER_ALLOWLIST`) and hiding *test* servers *from normal operation* (the `IsTestServerName` resurrection guard) are separate mechanisms; when opposite-direction scoping is needed, add a new mechanism rather than flipping the existing one.
**Why**: They are not interchangeable: the e2e family (`rk-test-e2e-<token>-*`) is matched by `IsTestServerName`, so a `!IsTestServerName` denylist would hide the very servers the tests need.
**Rejected**: Repurposing `IsTestServerName` as a `!IsTestServerName` denylist for test scoping.
*Introduced by*: 260531-tmnm-test-scoped-server-enumeration

### Keep the test-server allowlist on bounded enumeration, not pool relief
**Decision**: `RK_SERVER_ALLOWLIST` stays in force purely as a bound on how many tmux servers a test backend enumerates; connection-pool pressure is not part of its justification.
**Why**: Every enumerated server costs a subscription, so an unscoped test backend on a busy operator box subscribes to every live `kit`/`runWork`/orphan server as well as the test ones. Pool relief is not the lever — all per-server subscriptions ride ONE pool-free state socket (260716-qf3j-state-socket). The related pool-starvation failure mode is recorded in `e2e-flakiness-board-route-dynamic-import-hang`.
*Introduced by*: 260531-tmnm-test-scoped-server-enumeration

### Keep the `rk-test-` umbrella in the e2e family anchor
**Decision**: The e2e socket family anchor is `rk-test-e2e-<token>-` (primary `rk-test-e2e-<token>-0`), keeping the `rk-test-` umbrella rather than shortening to `rk-e2e-<token>-`.
**Why**: The `rk-test-` prefix is load-bearing in three shipped contracts: `IsTestServerName` (`HasPrefix "rk-test-"`) drives the tmuxctl supervisor's resurrection guard (stops daemon bootstrap resurrecting leaked test sockets), bare `rk mux reap` defaults to `--prefix rk-test`, and the name umbrella is the documented treated-as-ephemeral belt. Shedding it would silently exit all three. Every nesting-proof property survives the longer spelling: the token is hyphen-free, so `rk-test-e2e-<tokenA>-` prefixes `rk-test-e2e-<tokenB>-…` only when the tokens are equal.
**Rejected**: the `rk-e2e-<token>-` shorthand — it carries no rationale for shedding `rk-test-`, and shedding it regresses the resurrection guard and reap coverage.
*Introduced by*: 260822-pz2e-per-worktree-e2e-isolation

### `E2E_TMUX_FAMILY` as a first-class exported env var
**Decision**: The derivation helper (`scripts/e2e-env.sh`) exports both the anchor (`E2E_TMUX_FAMILY`, trailing hyphen included) and the primary (`E2E_TMUX_SERVER = family + "0"`); the trap glob, `RK_SERVER_ALLOWLIST`, `global-teardown.ts`, and spec secondary names all consume the family.
**Why**: With a role segment on the primary (`-0`), the primary's own name is not the family prefix — globbing `${E2E_TMUX_SERVER}*` would match only `…-0*` and leak secondaries. A dedicated anchor variable keeps every matcher on the same string instead of four sites re-deriving "strip the trailing role".
**Rejected**: deriving the family in each consumer by string-stripping the primary's `-0` tail — four fragile copies of the same slice, and a preset `E2E_TMUX_SERVER` override would strip a character that isn't a role segment.
*Introduced by*: 260822-pz2e-per-worktree-e2e-isolation

### Step-forward port fallback only on an unkillable foreign owner
**Decision**: `scripts/e2e-env.sh` derivation is pure (no port probing, no mutation). `scripts/test-e2e.sh` first kills listeners on the derived port triple (self-claim — they are this worktree's by construction); only when a port is STILL busy after the kill does it step the triple forward by 3 within the 3400–3699 block (bounded), with a printed notice that `just pw` then needs an explicit `RK_E2E_PORT`.
**Why**: Probing inside the derivation would make `just pw` non-deterministic (it could derive past a rig the harness just started). Killing first preserves the "claim from your own leftover `just dev`" semantic; stepping is reserved for the genuinely-foreign case (a hash collision with another user's process).
**Rejected**: probe-and-step inside `e2e-env.sh` (breaks the deterministic-rediscovery property `just pw` depends on); treating any listener as foreign (would never reclaim your own leftover rig).
*Introduced by*: 260822-pz2e-per-worktree-e2e-isolation

### Ephemeral set as caller-computed data into a pure classifier
**Decision**: `ReapTestServers` enumerates live servers and queries `IsEphemeralServer` per live server; `reapCandidates`/`classifyReap` receive the resulting name-set as data.
**Why**: Preserves `classifyReap`'s documented purity (the full matrix stays unit-testable with no tmux); dead sockets are never queried (a tmux command on a dead socket resurrects a server); the existing temp-dir + fake-prober seam tests extend naturally with a fake ephemeral set.
**Rejected**: Querying the option inside `classifyReap`/`reapCandidates` per candidate — breaks purity and probes dead sockets.
*Introduced by*: 260821-zelc-ephemeral-option-snapshot-reap

### One Playwright marking seam, not per-spec marking
**Decision**: the e2e `@rk_ephemeral` option-set lives inside `_tmux.ts` `createSession` (server-scoped, idempotent, best-effort), not in each spec's `beforeAll`.
**Why**: every secondary-server spec already routes through `createSession`; one seam future-proofs new specs with zero per-spec ceremony — the same rationale that centralized the lifecycle helpers.
**Rejected**: a separate `createServer` helper (nothing else distinguishes server-create from session-create in the specs — `createSession` with `opts.server` IS the server-create path).
*Introduced by*: 260821-hbmh-ephemeral-creation-adoption

