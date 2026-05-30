# Spec: rk reaper command

**Change**: 260529-fww2-rk-reaper-command
**Created**: 2026-05-29
**Affected memory**: `docs/memory/run-kit/tmux-sessions.md`

## Non-Goals

- **Root-cause fix for why test sockets leak** — cleanup races and daemonized servers reparenting to init are explicitly out of scope, tracked as a separate backlog item. The reaper is a janitor of last resort, not a leak fix.
- **Wiring the reaper into `rk serve` startup** — the existing race-safe `sweepOrphanedRelaySessions`-at-startup behavior is untouched. `app/backend/cmd/rk/serve.go` MUST NOT be modified by this change.
- **Reaping live non-test servers, `rk-e2e-*` sockets, or the `_rk-ctl` control anchor** — these are protected (see Hard Exclusions).
- **PID-liveness gating** — no parsing of `rk-test-<pid>-<ns>`, no `kill(pid, 0)`. The operator invocation asserts safety; matched candidates reap unconditionally.

## CLI Command: `rk reaper`

### Requirement: Standalone top-level command registration
A new cobra command `rk reaper` SHALL be registered as a top-level sibling of `rk serve` via `rootCmd.AddCommand(reaperCmd)` in `app/backend/cmd/rk/root.go`. It MUST NOT be nested under `rk serve` or `rk daemon`, and MUST NOT be invoked from any startup path. The command itself MUST be thin: `app/backend/cmd/rk/reaper.go` parses flags and renders the summary only; all scan/probe/classify/reap logic SHALL live in `internal/tmux` (Constitution §III).

#### Scenario: Command is discoverable at top level
- **GIVEN** a built `rk` binary
- **WHEN** the operator runs `rk reaper --help`
- **THEN** cobra resolves `reaper` as a top-level command (not under `serve` or `daemon`)
- **AND** a `--dry-run` flag is listed

#### Scenario: Startup path is untouched
- **GIVEN** the change is applied
- **WHEN** the diff is inspected
- **THEN** `app/backend/cmd/rk/serve.go` is unmodified
- **AND** `sweepOrphanedRelaySessions` and its wiring in `serveCmd.RunE` are unchanged

#### Scenario: Command body is thin
- **GIVEN** `app/backend/cmd/rk/reaper.go`
- **WHEN** the file is reviewed
- **THEN** it only parses the `--dry-run` flag, calls the exported `internal/tmux` reaper helper, and renders the summary
- **AND** no socket-directory scanning, probing, or `os.Remove`/`KillServer` calls appear in `cmd/rk`

### Requirement: Default invocation reaps and prints a summary
By default (no flags), `rk reaper` SHALL reap all matched candidates and print a summary reporting the count and names of both the killed live servers and the removed dead sockets/lock files.

#### Scenario: Summary after reaping
- **GIVEN** the socket directory `/tmp/tmux-{uid}/` contains one live orphan test server, one dead test socket, and one `*.lock` socket
- **WHEN** the operator runs `rk reaper`
- **THEN** the live test server is killed, the dead test socket and the lock socket are removed
- **AND** the printed summary reports the total count plus the names of the killed server(s) and the removed socket/lock file(s)

#### Scenario: Nothing to reap
- **GIVEN** the socket directory contains no test sockets, no dead test sockets, and no `*.lock` files
- **WHEN** the operator runs `rk reaper`
- **THEN** nothing is killed or removed
- **AND** the summary reports a zero count (or an equivalent "nothing to reap" message)

### Requirement: `--dry-run` previews without mutating
When `--dry-run` is set, `rk reaper` SHALL list the candidates classified by the action that *would* be taken (kill vs. remove) and MUST NOT kill any server or remove any file.

#### Scenario: Dry-run touches nothing
- **GIVEN** the socket directory contains a live orphan test server, a dead test socket, and a `*.lock` socket
- **WHEN** the operator runs `rk reaper --dry-run`
- **THEN** the output lists each candidate annotated with its classified action (kill / remove)
- **AND** no `tmux kill-server` is issued and no socket file is removed
- **AND** all three entries remain present in `/tmp/tmux-{uid}/` afterward

## Reaper Logic (`internal/tmux`)

### Requirement: Shared socket-dir candidate-scan helper extracted from `ListServers`
The raw socket-directory candidate-collection logic currently inlined in `ListServers` (the `/tmp/tmux-{uid}` `os.ReadDir` plus the directory-and-socket-mode filter at `tmux.go:1045-1058`) SHALL be factored out into a single exported helper. Both `ListServers` and the reaper MUST consume this helper so the `/tmp/tmux-{uid}` convention and the entry filter live in exactly one place.

The shared filter MUST return the full reapable candidate set: unix-socket files (`os.ModeSocket` — live or dead tmux servers) **plus** `*.lock` regular files. tmux's per-socket `*.lock` files are **regular files, not sockets**, so a socket-mode-only filter would silently drop them — leaving the spec-mandated `.lock` reap branch (below) dead in real runs. `.lock` files MUST therefore be matched by name suffix (single source: `tmux.LockSocketSuffix = ".lock"`), not by mode. `ListServers`, which enumerates only real servers, MUST skip `.lock` candidates (they are never servers — probing one would spend a doomed subprocess); its observable behavior (probe each socket candidate, return only probe-success servers, sorted) MUST otherwise be unchanged after the extraction.

#### Scenario: Single source for the socket-dir convention
- **GIVEN** the extraction is complete
- **WHEN** the reaper and `ListServers` need raw socket-dir candidates
- **THEN** both call the same exported helper
- **AND** the `/tmp/tmux-{uid}` path construction and entry filter are defined only once

#### Scenario: Lock files survive the shared filter
- **GIVEN** the socket directory contains a unix-socket file and a `*.lock` regular file
- **WHEN** the shared filter processes the directory entries
- **THEN** both the socket and the `.lock` file are returned as candidates
- **AND** a non-`.lock` regular file and any subdirectory are excluded

#### Scenario: ListServers behavior preserved
- **GIVEN** a socket directory with live and dead sockets
- **WHEN** `ListServers(ctx)` is called after the extraction
- **THEN** it returns only the sorted names of sockets whose probe (`tmux -L name list-sessions`) succeeds
- **AND** dead sockets continue to be dropped, exactly as before

### Requirement: Reaper iterates raw socket-dir candidates, not `ListServers`
The reaper MUST enumerate candidates via the shared raw socket-dir helper, NOT via `ListServers`. `ListServers` only returns probe-success sockets and silently drops dead sockets (the probe loop at `tmux.go:1066-1082` appends only on `cmd.Run() == nil`), which are precisely leak-shape (b). Iterating raw entries is therefore required to see dead sockets at all.

#### Scenario: Dead sockets are visible to the reaper
- **GIVEN** a dead test socket whose tmux daemon has already exited
- **WHEN** the reaper enumerates candidates
- **THEN** the dead socket appears as a candidate (because raw socket-dir iteration is used)
- **AND** it would never have appeared had `ListServers` been used

### Requirement: Classify each candidate by name and probe result
For each raw candidate the reaper SHALL probe the socket for liveness and classify it into exactly one action. The classification rules are:
- **(a) Live orphan test server** — probe succeeds (daemon alive) AND name matches `tmux.IsGoTestServerName` → kill via `tmux.KillServer(name)`.
- **(b) Dead test socket** — name matches `tmux.IsGoTestServerName` AND the probe fails (daemon gone) → remove the socket file via `os.Remove`.
- **(c) `.lock` file** — name ends in `.lock` (an explicit `strings.HasSuffix(name, ".lock")` branch, because `.lock` files are regular files that carry no test prefix and are surfaced by the shared filter via name, not socket mode) → remove via `os.Remove`.

The classification SHOULD be structured as a pure function over `(name, probeAlive)` returning the action, so it is unit-testable without real tmux servers; the thin I/O-performing reap routine then executes the action.

#### Scenario: Live test server is killed
- **GIVEN** a socket named `rk-test-1234-abc` whose probe succeeds
- **WHEN** the reaper classifies it
- **THEN** the action is "kill via `tmux.KillServer`"

#### Scenario: Dead test socket is removed
- **GIVEN** a socket named `rk-test-1234-abc` whose probe fails (daemon exited)
- **WHEN** the reaper classifies it
- **THEN** the action is "remove socket file via `os.Remove`"

#### Scenario: Lock file is removed regardless of prefix
- **GIVEN** a regular `.lock` file whose name carries no test prefix
- **WHEN** the reaper classifies it
- **THEN** the explicit `HasSuffix(name, ".lock")` branch selects "remove via `os.Remove`"

### Requirement: Reap unconditionally — no liveness gate, no per-prefix exceptions
The reaper MUST NOT apply any PID-liveness gate, MUST NOT call `kill(pid, 0)`, and MUST NOT parse `rk-test-<pid>-<ns>` for liveness. All five test-server prefixes matched by `tmux.IsGoTestServerName` — `rk-test-`, `rk-relay-test-`, `rk-verify-`, `rk-tmuxctl-test`, `rk-daemon-test` (including the fixed-name `rk-tmuxctl-test` and `rk-daemon-test`) — and all `*.lock` files SHALL reap unconditionally. The operator invocation asserts that nothing live needs these.

#### Scenario: Fixed-name test servers reap without exception
- **GIVEN** live orphan servers named `rk-tmuxctl-test` and `rk-daemon-test`
- **WHEN** the operator runs `rk reaper`
- **THEN** both are killed
- **AND** no per-prefix exemption or PID check is performed

### Requirement: `IsGoTestServerName` is the single source of truth for test matching
The reaper MUST use `tmux.IsGoTestServerName` to decide whether a candidate is a test server. It MUST NOT re-list or hardcode the test prefixes independently.

#### Scenario: No duplicated prefix list
- **GIVEN** the reaper implementation
- **WHEN** the code is reviewed
- **THEN** test-server matching delegates to `tmux.IsGoTestServerName`
- **AND** the five prefixes are not re-declared inside the reaper

### Requirement: Hard exclusions that MUST NEVER be reaped
The reaper MUST NEVER reap:
- **`rk-e2e-*` sockets** — they may be live during a Playwright e2e run. These are excluded for free because `tmux.IsGoTestServerName` does not include an e2e prefix (the comment at `tmux.go:1009` documents that e2e is deliberately not filtered).
- **The `_rk-ctl` control anchor** (`tmux.ControlAnchorSessionName`) — owned by `tmuxctl`, excluded as defense-in-depth (mirroring the existing sweep's anchor guard at `serve_sweep.go:45`).
- **Any LIVE non-test server** — probe succeeds but the name does NOT match `tmux.IsGoTestServerName` → leave it alone.

#### Scenario: e2e server is left alone
- **GIVEN** a live socket named `rk-e2e-foo`
- **WHEN** the reaper runs
- **THEN** the socket is neither killed nor removed (it does not match `IsGoTestServerName`)

#### Scenario: Control anchor is excluded
- **GIVEN** a candidate matching `tmux.ControlAnchorSessionName` (`_rk-ctl`)
- **WHEN** the reaper classifies it
- **THEN** it is skipped (no kill, no remove)

#### Scenario: Live non-test server is preserved
- **GIVEN** a live socket named `runkit` (or any non-test, non-lock name) whose probe succeeds
- **WHEN** the reaper runs
- **THEN** it is left untouched (not a test server, not a dead socket, not a `.lock` file)

### Requirement: Partial-failure contract — log and skip, never abort
Per-entry kill/remove failures MUST be logged via `slog` and skipped; a single failure MUST NEVER abort the sweep. The reaper SHALL mirror the partial-failure shape of `sweepOrphanedRelaySessions` (`serve_sweep.go:28-62`): collect per-entry errors, continue iterating remaining candidates, and surface an aggregate error at the end.

#### Scenario: One failure does not stop the sweep
- **GIVEN** three reapable candidates where killing/removing the first fails
- **WHEN** the reaper runs
- **THEN** the failure is logged via `slog`
- **AND** the remaining two candidates are still processed
- **AND** an aggregate error describing the failed entry is returned at the end

#### Scenario: All success yields no aggregate error
- **GIVEN** reapable candidates that all kill/remove successfully
- **WHEN** the reaper runs
- **THEN** no aggregate error is returned

## Constitution Alignment

### Requirement: Subprocess execution and no new persistent state
Subprocess execution within `internal/tmux` MUST continue to use `exec.CommandContext` with a timeout (Constitution §I — already true in `internal/tmux`; the kill path is `tmux.KillServer`). The reaper MUST derive its candidate set from the socket directory at invocation time and MUST NOT introduce any new persistent state store (Constitution §II). The reaper MUST NOT touch the startup path nor affect any live non-test tmux session (Constitution §VI).

#### Scenario: No new persistent state
- **GIVEN** the reaper implementation
- **WHEN** it determines candidates
- **THEN** it reads `/tmp/tmux-{uid}/` directly at invocation time
- **AND** introduces no database, cache, or persisted candidate list

#### Scenario: Live user sessions unaffected
- **GIVEN** a live non-test tmux server with active user sessions
- **WHEN** the operator runs `rk reaper`
- **THEN** that server and its sessions are not killed or otherwise affected (Constitution §VI)

## Test Requirements

### Requirement: Unit coverage for classification and dry-run
The change SHALL include Go `*_test.go` coverage alongside the code (per the project test strategy). Tests MUST cover the classify logic for each shape — live-test → kill, dead-test → remove, `.lock` → remove, live-non-test → skip, `rk-e2e-*` → skip, control anchor → skip — and MUST verify that `--dry-run` performs no mutations. The classify logic SHOULD be exercised as a pure function over `(name, probeAlive)` so these cases are testable without spawning real tmux servers.

#### Scenario: Classification cases are unit-tested
- **GIVEN** the pure classify function over `(name, probeAlive)`
- **WHEN** unit tests exercise live-test, dead-test, `.lock`, live-non-test, `rk-e2e-*`, and anchor inputs
- **THEN** each returns the expected action (kill / remove / skip)

#### Scenario: Dry-run mutation-free is asserted
- **GIVEN** a test harness with classifiable candidates
- **WHEN** the reaper runs in `--dry-run` mode
- **THEN** the test asserts no `KillServer` and no `os.Remove` occurred

## Design Decisions

1. **Standalone operator command, not a startup sweep**: `rk reaper` is invoked manually by an operator rather than extended into `sweepOrphanedRelaySessions` at `rk serve` startup.
   - *Why*: The reaper is a blunt, destructive "janitor of last resort." Keeping it manual leaves the race-safe startup sweep untouched and puts the destructive action behind an explicit human invocation.
   - *Rejected*: Extending the startup sweep to reap whole servers — rejected in the design conversation because it couples destructive cleanup to startup and reintroduces the PID-gate complexity the manual invocation avoids.

2. **No PID-liveness gate**: Matched test servers and `.lock` files reap unconditionally.
   - *Why*: The original `kill(pid, 0)` gate was designed for a startup-time auto-sweep. Because the reaper is operator-invoked, the human asserts "nothing live needs these," so the gate is unnecessary complexity.
   - *Rejected*: Parsing `rk-test-<pid>-<ns>` and probing the PID — rejected as solving a problem that the manual invocation model removes.

3. **Iterate raw socket-dir candidates, not `ListServers`**: The reaper scans `/tmp/tmux-{uid}/` directly.
   - *Why*: `ListServers` returns only probe-success sockets and silently drops dead sockets — exactly leak-shape (b). Raw iteration is the only way to see dead sockets.
   - *Rejected*: Reusing `ListServers` — would make dead-socket cleanup impossible.

4. **Extract the candidate-scan helper rather than duplicate it**: The `tmux.go:1045-1058` dir-scan is factored into one exported helper shared by `ListServers` and the reaper.
   - *Why*: The code-quality doc flags duplicated utilities as an anti-pattern; a single helper keeps the `/tmp/tmux-{uid}` convention and socket-mode filter in one place.
   - *Rejected*: Copy-pasting the loop into the reaper — drift risk on the socket-dir convention.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Change type is `chore` (new operator/maintenance command, low blast radius) | Confirmed from intake #1; stated explicitly in the resolved design and matches the `chore` taxonomy | S:98 R:80 A:95 D:95 |
| 2 | Certain | `rk reaper` is a standalone top-level cobra command registered in `root.go`, NOT nested under `serve`/`daemon` and NOT wired into startup; `serve.go` untouched | Confirmed from intake #2; verified the `rootCmd.AddCommand` idiom in `root.go:34-44` | S:98 R:70 A:95 D:95 |
| 3 | Certain | Reaper iterates raw socket-dir candidates (the `tmux.go:1045-1058` scan), not `ListServers`, because `ListServers` drops dead sockets | Confirmed from intake #3; verified `ListServers` appends only on probe success (`tmux.go:1066-1082`) | S:95 R:60 A:98 D:95 |
| 4 | Certain | `IsGoTestServerName` is the single source of truth for test matching and already excludes `rk-e2e-*` | Confirmed from intake #4; verified `tmux.go:1016-1030` (5 prefixes, e2e deliberately omitted per comment at `:1009`) | S:98 R:75 A:98 D:98 |
| 5 | Certain | No PID-liveness gate / no `kill(pid,0)` — all matched test servers and `.lock` files reap unconditionally | Confirmed from intake #5; design conversation explicitly overrode the backlog's PID-gate suggestion | S:95 R:55 A:90 D:90 |
| 6 | Certain | Partial-failure contract: log-and-skip per entry via `slog`, continue, aggregate error at end | Confirmed from intake #6; verified the pattern in `serve_sweep.go:28-62` (collect `perServerErrs`, continue, join at `:59-61`) | S:95 R:80 A:95 D:90 |
| 7 | Certain | Three classify branches: live test → `KillServer`; dead test → `os.Remove`; `*.lock` → `os.Remove` via explicit `HasSuffix` branch | Confirmed from intake #7 (user-confirmed); `.lock` lacks a test prefix so it needs its own branch | S:95 R:55 A:85 D:80 |
| 8 | Certain | UX: default reaps + prints count/names summary; `--dry-run` previews candidates classified by action, mutating nothing | Confirmed from intake #8 (user-confirmed) | S:95 R:80 A:85 D:85 |
| 9 | Certain | Exclude `_rk-ctl` control anchor and live non-test servers (defense-in-depth) | Confirmed from intake #9 (user-confirmed); mirrors anchor guard at `serve_sweep.go:45` | S:95 R:75 A:90 D:85 |
| 10 | Certain | Affected memory is `run-kit/tmux-sessions` (modify) | Confirmed from intake #10 (user-confirmed); verified the file documents the startup sweep and exclusions | S:95 R:80 A:85 D:80 |
| 11 | Certain | Factor the socket-dir candidate scan out of `ListServers` into a shared exported helper (not duplicated); `ListServers` behavior preserved | Confirmed from intake #11 (user-confirmed); single source for the `/tmp/tmux-{uid}` convention, avoids the duplicated-utility smell | S:95 R:60 A:65 D:55 |
| 12 | Certain | Reap logic lives behind a single exported `internal/tmux` reaper helper (e.g. `ReapTestServers(ctx, dryRun)`); `reaper.go` stays thin; exact name/signature finalized at plan stage | Confirmed from intake #12 (user-confirmed); §III thin-command, mirrors `sweepOrphanedRelaySessions` result shape | S:95 R:55 A:75 D:60 |
| 13 | Confident | Classification structured as a pure function over `(name, probeAlive)` plus a thin I/O reap routine, to enable unit tests without real tmux servers | New (spec-level): the intake notes testability; testability is the natural structure and is fully reversible (internal refactor), but the intake left exact structure to plan stage | S:80 R:75 A:80 D:70 |

13 assumptions (12 certain, 1 confident, 0 tentative, 0 unresolved).
