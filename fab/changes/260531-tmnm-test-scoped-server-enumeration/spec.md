# Spec: Test-scoped server enumeration

**Change**: 260531-tmnm-test-scoped-server-enumeration
**Created**: 2026-05-31
**Affected memory**: `docs/memory/run-kit/tmux-sessions.md`

## Non-Goals

- **General operator-facing server allowlist** — `RK_SERVER_ALLOWLIST` is shaped to be forward-compatible (comma-separated prefixes), but exposing it as a documented operator feature for hiding arbitrary servers is out of scope. This change is test-isolation only; prod behavior with the env unset is identical to today.
- **Touching the `IsTestServerName` denylist or `tmuxctl` supervisor resurrection guard** — the new allowlist points the opposite direction (hides *normal* servers from tests; the denylist hides *test* servers from normal operation). They coexist; this change adds the allowlist and leaves the denylist untouched.
- **Pre-test `rk reaper`** — reaping clears leaked `rk-test-*` orphans but cannot bound the operator's legitimately-live `kit`/`runWork` sessions, so it does not solve the load-dependent SSE inflation. Not used here.
- **`tmux -L` scoping of the dev backend** — the backend is not a single tmux client; `ListServers` scans the socket dir directly, so a single `-L` would not apply. The filter belongs in the enumeration path.

## Server Enumeration: Test-Scoped Allowlist Filter

### Requirement: Env-gated allowlist filter in `ListServers`
`tmux.ListServers` (`app/backend/internal/tmux/tmux.go:1413`) SHALL apply an allowlist filter read from the `RK_SERVER_ALLOWLIST` environment variable. When the variable is unset or empty, `ListServers` MUST return all discovered live servers exactly as today (no behavior change). When the variable is set, `ListServers` MUST return only those live servers whose name matches the allowlist.

The filter SHALL be applied inside `ListServers` (not solely in the `/api/servers` HTTP handler), because the board route attaches servers from two distinct `ListServers`-rooted paths: (1) `GET /api/servers` (`api/servers.go:25`) populating `useSessionContext().servers`, and (2) `GET /api/boards/{name}` enumerating servers internally via `internal/tmux/board.go` `ListAllBoardEntries` (`board.go:151`) and `GetBoard` (`board.go:221`). Filtering only the HTTP handler would leave path (2) unscoped and the board-route SSE inflation unfixed.

The env var SHALL be read directly within `internal/tmux` (matching the existing `RK_TMUX_CONF` / `OriginalTMUX` precedent at `tmux.go:34,54`), NOT threaded through `internal/config.Load()`. `internal/tmux` does not import `internal/config` today, and `ListServers` is a free function taking only `ctx`; introducing a `tmux → config` dependency to carry one enumeration-scoping value is unwarranted.

#### Scenario: Env unset preserves production behavior
- **GIVEN** `RK_SERVER_ALLOWLIST` is unset (production default)
- **AND** the socket dir contains live servers `kit`, `runWork`, and `rk-test-e2e`
- **WHEN** `ListServers(ctx)` is called
- **THEN** it returns `["kit", "rk-test-e2e", "runWork"]` (all live servers, sorted) — identical to today
- **AND** the `api/servers.go:20` "surface every server" contract and the `tmux.go:1332` design intent are preserved unchanged

#### Scenario: Env set scopes the enumeration to the allowlist
- **GIVEN** `RK_SERVER_ALLOWLIST` is set to `rk-test-e2e`
- **AND** the socket dir contains live servers `kit`, `runWork`, and `rk-test-e2e`
- **WHEN** `ListServers(ctx)` is called
- **THEN** it returns `["rk-test-e2e"]` only — the operator's `kit` and `runWork` are excluded

#### Scenario: Empty value is treated as unset
- **GIVEN** `RK_SERVER_ALLOWLIST` is set to the empty string
- **WHEN** `ListServers(ctx)` is called
- **THEN** it behaves as if unset — all live servers are returned (no accidental "match nothing")

### Requirement: Prefix-match semantics
A live server name SHALL match the allowlist when it equals an allowlist entry OR begins with an allowlist entry as a prefix. The allowlist value MAY be a comma-separated list of prefixes; each comma-delimited token SHALL be trimmed of surrounding whitespace, and empty tokens SHALL be ignored. A server matches if it prefix-matches ANY token.

Prefix matching is required because multi-server e2e specs create secondary servers in `beforeAll` named `rk-test-e2e-<role>-<pid>-<epoch>` (e.g. `boards-multi-server.spec.ts:10` → `rk-test-e2e-multi-...`, `sidebar-server-coupling.spec.ts:10` → `rk-test-e2e-coupling-...`, `multi-server-sidebar.spec.ts:10` → `rk-test-e2e-msb-...`). Exact matching on `rk-test-e2e` would wrongly exclude these secondaries and break multi-server specs.

#### Scenario: Prefix admits the primary and this-run secondaries
- **GIVEN** `RK_SERVER_ALLOWLIST` is set to `rk-test-e2e`
- **AND** live servers are `rk-test-e2e`, `rk-test-e2e-multi-4821-318204`, `rk-test-e2e-coupling-4821-318211`, and `kit`
- **WHEN** `ListServers(ctx)` is called
- **THEN** it returns the three `rk-test-e2e`-prefixed servers (sorted), excluding `kit`

#### Scenario: Comma-separated multi-prefix allowlist
- **GIVEN** `RK_SERVER_ALLOWLIST` is set to `rk-test-e2e, rk-test-foo`
- **AND** live servers are `rk-test-e2e-multi-1-2`, `rk-test-foo`, and `runWork`
- **WHEN** `ListServers(ctx)` is called
- **THEN** it returns `["rk-test-e2e-multi-1-2", "rk-test-foo"]`, excluding `runWork`
- **AND** whitespace around the comma-delimited tokens does not affect matching

#### Scenario: Non-matching live server is excluded
- **GIVEN** `RK_SERVER_ALLOWLIST` is set to `rk-test-e2e`
- **AND** a live server `rk-test-relay-9001-1717` (a Go-test server under the broader `rk-test-` umbrella) exists
- **WHEN** `ListServers(ctx)` is called
- **THEN** `rk-test-relay-9001-1717` is excluded — the allowlist targets `rk-test-e2e*` specifically, not all `rk-test-*`

### Requirement: All `ListServers` consumers inherit the scope when env is set
Because the filter lives in `ListServers`, every enumeration consumer SHALL observe the scoped list when `RK_SERVER_ALLOWLIST` is set. This is the intended outcome in the test environment (the only environment that sets the var). Consumers: `api/servers.go:25` (`/api/servers`), `internal/tmux/board.go:151,221` (board entry enumeration), `cmd/rk/serve_sweep.go:83` (startup relay-orphan sweep), and `api/router.go:178` (`prodTmuxOps.ListServers` wrapper).

The `internal/tmuxctl` supervisor SHALL be unaffected: it does not call `ListServers` (it enumerates via `os.ReadDir` + `isTmuxSocketCandidate`, `supervisor.go:38`), so its `IsTestServerName` resurrection guard is untouched.

#### Scenario: Board enumeration scoped in tests
- **GIVEN** `RK_SERVER_ALLOWLIST=rk-test-e2e` (test environment)
- **AND** the operator box also runs live `kit` and `runWork` servers
- **WHEN** the board route requests `GET /api/boards/{name}` and the backend enumerates servers via `board.go` → `ListServers`
- **THEN** only `rk-test-e2e*` servers contribute board entries, so the board route attaches one EventSource (not one per operator server)

#### Scenario: Supervisor enumeration unchanged
- **GIVEN** `RK_SERVER_ALLOWLIST=rk-test-e2e`
- **WHEN** the `tmuxctl` supervisor enumerates the socket dir for resurrection-guard purposes
- **THEN** it uses `os.ReadDir` + `isTmuxSocketCandidate` and is NOT affected by the `ListServers` allowlist (its behavior is identical to today)

## Test Harness: Scope the Backend Read Path

### Requirement: Harness exports `RK_SERVER_ALLOWLIST` to the backend process
`scripts/test-e2e.sh` SHALL export `RK_SERVER_ALLOWLIST` (set to the `E2E_TMUX_SERVER` value, i.e. `rk-test-e2e`) into the environment of the dev backend it launches (the `setsid ... just dev` invocation, currently `:46`), not only into the Playwright invocation (`:74`). This scopes the backend's `ListServers` read path during the e2e run.

The existing `E2E_TMUX_SERVER` variable (which scopes the socket the tests *write* to, `:40`) SHALL remain unchanged; `RK_SERVER_ALLOWLIST` is the new, Go-visible companion that scopes what the backend *reads*.

#### Scenario: Backend launched with allowlist scope
- **GIVEN** an e2e run started via `scripts/test-e2e.sh`
- **WHEN** the script launches the dev backend (`just dev`)
- **THEN** the backend process environment contains `RK_SERVER_ALLOWLIST=rk-test-e2e`
- **AND** for the duration of the run, the backend's `ListServers` returns only `rk-test-e2e*` servers regardless of how many `kit`/`runWork`/orphan servers are live on the operator's box

#### Scenario: Board specs deterministic on a busy box
- **GIVEN** an operator box with several live tmux servers beyond the test servers
- **WHEN** the board-route e2e specs run under the harness with `RK_SERVER_ALLOWLIST` exported to the backend
- **THEN** the board route opens exactly one SSE EventSource per test server (not one per box server)
- **AND** the load-dependent connection-pool starvation that made board specs flaky on busy sessions no longer occurs from SSE inflation

## Testing

### Requirement: Go unit test for the filter
A Go unit test SHALL cover the filter behavior using `t.Setenv` (mirroring existing `servers_test.go`/`config_test.go` patterns): env unset → full list; env set → prefix-scoped list; empty value → treated as unset; comma-separated multi-prefix; whitespace trimming. Because `ListServers` probes real sockets, the test SHOULD exercise the *match predicate* directly (a small exported or package-visible helper, e.g. `matchesServerAllowlist(name, allowlist string) bool`) rather than requiring live tmux servers, so the test is hermetic.

#### Scenario: Match predicate unit-tested hermetically
- **GIVEN** a table of `(allowlist, serverName, expectedMatch)` cases including unset, exact, prefix, multi-token, whitespace, and non-match
- **WHEN** the match predicate is evaluated for each row
- **THEN** every row matches its expected boolean
- **AND** no live tmux server is required to run the test

### Requirement: Companion `.spec.md` parity for any changed spec
IF any `*.spec.ts` file is modified as part of validating this change, its sibling `*.spec.md` SHALL be updated in the same commit per the constitution's Test Companion Docs rule. (Expected: no `.spec.ts` change is needed — the payoff is determinism of existing board specs — but if a spec's `beforeAll` is touched, parity applies.)

#### Scenario: No orphaned spec docs
- **GIVEN** the change is complete
- **WHEN** the changed-file set is reviewed
- **THEN** every modified `*.spec.ts` has a correspondingly updated `*.spec.md`, or no `*.spec.ts` was modified at all

## Design Decisions

1. **Filter location = `ListServers`, not `handleServersList`-only**
   - *Why*: The board route attaches servers from two `ListServers`-rooted backend paths (`/api/servers` and the internal `board.go` board-entry enumeration). Only filtering at `ListServers` scopes both; an HTTP-handler-only filter leaves board-entry attach unscoped, so the SSE inflation persists.
   - *Rejected*: `handleServersList`-only — narrower blast radius but does not fix the board route (the actual failing route). Verified by tracing `use-boards.ts:40-43` + `board.go:151/221`.

2. **Env read inside `internal/tmux`, not via `config.Load()`**
   - *Why*: `internal/tmux` already reads env directly (`RK_TMUX_CONF` at `tmux.go:54`, `OriginalTMUX` at `tmux.go:34`); `ListServers` is a free `ctx`-only function. Reading `RK_SERVER_ALLOWLIST` in-package matches precedent and avoids a new `tmux → config` import.
   - *Rejected*: Threading through `internal/config.Load()` — would force `internal/tmux` to depend on `internal/config` (no such dependency exists today) and put an enumeration-scoping concern into the HTTP-server `Config` struct. This refines intake assumption #4, which named `config.go` as a *candidate* location; the codebase's own pattern points to the tmux package.

3. **Prefix match, not exact**
   - *Why*: Multi-server specs create `rk-test-e2e-<role>-<pid>-<epoch>` secondaries in `beforeAll`; exact match would exclude them and break those specs. Prefix admits the primary plus this-run secondaries; cross-worktree isolation holds because secondaries embed `process.pid`.
   - *Rejected*: Exact match — works for single-server specs only; multi-server specs would fail to see their own secondaries.

4. **New `RK_SERVER_ALLOWLIST`, not reuse of `E2E_TMUX_SERVER`**
   - *Why*: `E2E_TMUX_SERVER` is shell/TS-only and Go-invisible today; a dedicated `RK_*` name is honest about allowlist intent and matches the `RK_*` env convention. The harness already knows the value (`E2E_TMUX_SERVER`) and simply exports it under the new name.
   - *Rejected*: Reuse `E2E_TMUX_SERVER` — would repurpose a shell socket-naming variable for Go config and conflate "socket the tests write to" with "allowlist the backend reads".

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Backend enumerates ALL tmux servers unfiltered; test isolation covers the write socket but not the backend read path | Confirmed from intake #1; verified tmux.go:1413 ScanSocketDir no filter, servers.go:20-24 surfaces everything by design, E2E_TMUX_SERVER never read by Go | S:95 R:85 A:95 D:95 |
| 2 | Certain | Inflates board-route SSE count load-dependently: N live servers → N EventSources → N of 6 HTTP/1.1 slots | Confirmed from intake #2; traced use-window-pins.ts:92-95 + use-boards.ts:40-43 (attach all) + session-context.tsx:211-215 (one ES per server) | S:95 R:80 A:90 D:90 |
| 3 | Certain | Use an ALLOWLIST of the test server name, NOT a denylist — rk-test-e2e is matched by IsTestServerName so `!IsTestServerName` would hide it | Confirmed from intake #3; verified tmux.go:1336 (HasPrefix "rk-test-") and supervisor.go:31-42 | S:95 R:80 A:95 D:90 |
| 4 | Certain | Filter location = ListServers (tmux.go:1413), env-gated — not handleServersList-only | Upgraded from intake #6 (Tentative→Certain via investigation + user confirmation). Board route attaches via TWO ListServers-rooted paths (/api/servers + board.go ListAllBoardEntries:151/GetBoard:221); handleServersList-only leaves path 2 unscoped. tmux.go:1332 comment is the env-unset (prod) path, preserved. Supervisor doesn't call ListServers. | S:95 R:80 A:90 D:90 |
| 5 | Certain | Env var = new RK_SERVER_ALLOWLIST; match mode = PREFIX on rk-test-e2e | Upgraded from intake #7+#8 (Tentative→Certain via investigation + user confirmation). E2E_TMUX_SERVER is Go-invisible; dedicated RK_* matches convention. Per-spec secondaries rk-test-e2e-<role>-<pid>-<epoch> (boards-multi-server.spec.ts:10 etc) require prefix; cross-worktree-safe via process.pid. | S:95 R:75 A:90 D:85 |
| 6 | Confident | Read the env var inside internal/tmux directly, NOT via config.Load() | Refines intake #4 (which named config.go as a candidate). internal/tmux already reads env directly (RK_TMUX_CONF tmux.go:54, OriginalTMUX tmux.go:34); ListServers is a ctx-only free fn; routing via config.Load would force a new tmux→config import. Clear codebase precedent, but a defensible alternative (config struct) exists. | S:80 R:75 A:85 D:80 |
| 7 | Confident | Env-gated, prod-default-unchanged — filter only narrows when the var is set | Confirmed from intake #4; preserves the servers.go:20 prod contract and tmux.go:1332 intent; matches RK_PORT/RK_HOST gating convention | S:85 R:80 A:85 D:85 |
| 8 | Confident | change_type = fix | Confirmed from intake #5; repairs the environmental cause of a deterministic-on-busy-box test hang | S:85 R:90 A:90 D:80 |
| 9 | Confident | Test the match predicate hermetically (extracted helper), not ListServers end-to-end | ListServers probes real sockets; an extracted predicate (matchesServerAllowlist) is unit-testable with t.Setenv-free table cases, mirroring code-quality.md "features/fixes MUST include tests" and existing servers_test.go mock pattern | S:80 R:80 A:85 D:75 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
