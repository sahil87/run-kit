# Intake: Test-scoped server enumeration

**Change**: 260531-tmnm-test-scoped-server-enumeration
**Created**: 2026-05-31
**Status**: Draft

## Origin

> Scope the backend's tmux server enumeration to a single allowlisted server when running under E2E, so board-route tests open exactly ONE SSE `EventSource` instead of one per live tmux server on the box.

Conversational mode. Third of three fixes drafted from a `/fab-discuss` transport-analysis session. This is the **environmental** vector — the one that explains why the board-route E2E hang is *load-dependent* (passes on a clean box, fails on a busy operator session). The first two drafted changes shrink the connection budget's consumers (`260531-m3pl-static-xterm-imports` removes runtime chunk fetches; `260531-rus8-bound-desktop-relay-websockets` bounds relay WebSockets); this one removes the **uncontrolled SSE inflation** that a busy box injects into board tests. See memory `e2e-flakiness-board-route-dynamic-import-hang` (third vector).

## Why

**Problem.** The e2e backend enumerates **every** tmux server on the box, not just the test server. `tmux.ListServers` (`internal/tmux/tmux.go:1413`) does `ScanSocketDir` over the whole `/tmp/tmux-<uid>/` directory with **no prefix filter** (it only skips `.lock` files). `GET /api/servers` (`api/servers.go:19-25`) then deliberately surfaces all of them — the comment is explicit: *"Surface EVERY tmux server discovered, including leaked rk-test-* orphans ... Accepted cost: a per-orphan SSE stream until the operator runs `rk reaper`."*

`scripts/test-e2e.sh` isolates the tmux socket the tests **write to** (`E2E_TMUX_SERVER=rk-test-e2e`, seeded at `:40`), but **not what the backend reads**: the dev backend it launches (`just dev`, `:46`) has no `tmux -L` scoping, so `ListServers` also sees the operator's live `kit`/`runWork`/`abbb` sessions plus leaked `rk-test-*` orphans from other worktrees. `E2E_TMUX_SERVER` is passed into the test env (`:74`) but is **never read by Go** — only the harness and specs use it to target the right socket.

**Consequence.** On the board route, `use-window-pins.ts:93-95` attaches **all** known servers (boards are explicitly cross-server), and `session-context.tsx:211-215` opens **one `EventSource` per attached server**. So N live tmux servers → N SSE connections → **N of the browser's 6 HTTP/1.1 connection slots consumed before any relay WebSocket or xterm chunk fetch happens.** The lazy-attach guard (`session-context.tsx:207`, *"keeps us under the 6-connection cap"*) protects single-window routes, but the board route defeats it by attaching everything. The more servers on the box, the fewer slots remain, the more reliably the board-route hang triggers. This is the connection-starvation amplifier — distinct from the session *death* that occurred when cleaning up servers earlier (that was the `kill 0` process-group grenade, a SIGTERM, already fixed by `setsid`+PGID in the current script; unrelated to connections — see `test-e2e-kill0-process-group-grenade`).

**Why this approach over alternatives.**
- **Allowlist, not denylist (critical).** `rk-test-e2e` **is** matched by `tmux.IsTestServerName` (`HasPrefix("rk-test-")`, `tmux.go:1336`). The denylist that `tmuxctl/supervisor.go:31-42` applies (`!IsTestServerName`, for resurrection-prevention) would **hide the very server the tests need**. So the correct test scoping is an **allowlist of the configured test server name**, not reuse of the existing test-name denylist.
- **Env-gated, prod-default-unchanged.** When the allowlist env var is unset (production), `ListServers`/`/api/servers` behave exactly as today (surface everything — the `servers.go:20` contract is preserved). The filter only narrows the list when the env var is set, which only the test harness does. This keeps prod's "show the operator everything the reaper will reap" behavior intact while making "isolated tmux server" actually isolated at the backend **read** path, not just the test **write** path.
- **Rejected: pre-test `rk reaper`.** Reaping clears leaked `rk-test-*` orphans but **cannot** reap the operator's legitimately-live `kit`/`runWork` sessions, so it doesn't bound the SSE count on a working box. Insufficient alone.
- **Rejected: `tmux -L` scoping the dev backend.** The backend isn't a single tmux client; `ListServers` scans the socket dir directly, so a single `-L` wouldn't apply. The filter belongs in the enumeration path.

## What Changes

### Backend enumeration — `internal/tmux/tmux.go` and/or `api/servers.go`

Introduce an **allowlist filter** read from a new env var **`RK_SERVER_ALLOWLIST`** (read in `config.Load()`, mirroring `RK_PORT`/`RK_HOST`).
<!-- clarified: env var = new RK_SERVER_ALLOWLIST, not reuse of E2E_TMUX_SERVER. Verified E2E_TMUX_SERVER is shell/TS-only — Go never reads it (test-e2e.sh:5,40,74 and *.spec.ts fallbacks only). A dedicated RK_* name read in config.Load matches the existing convention and is honest about allowlist intent rather than repurposing a shell socket-naming variable for Go config. -->

Behavior:

- **Env unset** (prod default): `ListServers` returns all discovered live servers — unchanged from today.
- **Env set** (test): the enumeration returns only servers whose name **prefix-matches** the allowlist value (e.g. `rk-test-e2e`).
<!-- clarified: match mode = PREFIX, not exact. Verified specs spin up secondaries in beforeAll named rk-test-e2e-<role>-<pid>-<epoch> (boards-multi-server.spec.ts:10 "multi", sidebar-server-coupling.spec.ts:10 "coupling", multi-server-sidebar.spec.ts:10 "msb"). Exact match on rk-test-e2e would wrongly exclude these → multi-server specs fail. Prefix match admits the primary + all this-run secondaries; cross-worktree isolation holds because secondaries embed process.pid (and an epoch suffix), so a different worktree's run has different names under the same prefix. -->
  The allowlist value MAY itself be a comma-separated list of prefixes (a forward-compatible extension); for now the harness sets a single prefix.

Apply the filter inside `ListServers` (`tmux.go:1413`) so *all* enumeration consumers see the scoped list.
<!-- clarified: filter location = ListServers (not handleServersList-only). Verified the board route attaches servers from TWO ListServers-rooted paths: (1) GET /api/servers (servers.go:25) populates useSessionContext().servers, iterated by use-window-pins.ts:92-95 AND use-boards.ts:40-43; (2) GET /api/boards/{name} enumerates internally via board.go ListAllBoardEntries:151 / GetBoard:221 → ListServers, and the board-entry server fields ALSO drive attach. A handleServersList-only filter leaves path (2) unscoped → SSE inflation persists. ListServers is the only location that fixes both. The tmux.go:1332-1335 comment ("intentionally NOT in ListServers") describes the env-UNSET (prod) path, which the env-gated filter preserves unchanged. Other ListServers callers when env IS set are all test-only context (serve_sweep.go:83 relay sweep, board.go enum) and scoping them in tests is desired. The tmuxctl supervisor does NOT call ListServers (uses os.ReadDir + isTmuxSocketCandidate, supervisor.go:38), so its resurrection guard is untouched. -->

Confirmed safe for all callers: scoping is gated behind the allowlist env var, which only the e2e harness sets — so production (env unset) preserves the `servers.go:20` "surface everything" contract and the `tmux.go:1332` design intent exactly.

### Test harness — `scripts/test-e2e.sh`

Set the chosen allowlist env var on the **backend** process (the `setsid ... just dev` launch at `:46`), not just on the Playwright invocation, so the dev backend's `ListServers` is scoped during the run.

### Unchanged

- Production `/api/servers` (env unset) — still surfaces every server, per the existing `servers.go:20` contract and the `rk reaper` cleanup model.
- The `tmuxctl/supervisor.go` test-socket **denylist** (resurrection-prevention) — orthogonal; stays as-is.

### Allowlist (new) vs `IsTestServerName` denylist (existing) — directionality (clarified)

These point in **opposite directions** and must not be conflated:

- **`IsTestServerName` (existing denylist)** answers *"is this a test server?"* and is used to hide **tests from normal operation** — the supervisor's resurrection guard (`supervisor.go:38`) skips `rk-test-*` so `rk` startup doesn't resurrect orphan test sockets. (`rk reaper` does NOT call it — it has its own `--prefix rk-test` flag, `reaper.go:29`. So the supervisor guard is `IsTestServerName`'s *only* non-test caller.)
- **Our allowlist (new)** answers *"is this THE server this test run may see?"* and is used to hide **normal servers from tests** — the exact opposite direction.

Therefore this change **adds a new forward allowlist** on the enumeration path; it does **not** consume, flip, or remove `IsTestServerName`. There is no need to touch the denylist — it keeps doing resurrection-prevention untouched, and the two mechanisms coexist without conflict. (Removing `IsTestServerName` is explicitly NOT in scope: its sole caller, the supervisor resurrection guard, is a correctness mechanism that must stay.)

## Affected Memory

<!-- This is a test-isolation / backend-enumeration fix. The env-gated filter is a new
     behavior of ListServers/api-servers worth recording in the run-kit architecture or
     tmux-sessions memory at hydrate (how server enumeration is scoped, and the allowlist-
     vs-denylist distinction). Marked (modify) tentatively — confirm at hydrate which file
     owns the server-enumeration contract. -->

- `run-kit/tmux-sessions`: (modify) document the env-gated server-enumeration allowlist (test scoping of `ListServers`/`/api/servers`), and the allowlist-vs-`IsTestServerName`-denylist distinction. Confirm scope at hydrate.

## Impact

- **Code**: `internal/tmux/tmux.go` (`ListServers`, or a new filtered wrapper), possibly `api/servers.go` (`handleServersList`), `internal/config/config.go` (env read, matching the existing `RK_PORT`/`RK_HOST` pattern), and `scripts/test-e2e.sh` (export the var on the backend launch).
- **Tests**: Go unit test for the filter (env set → scoped list; env unset → full list — mirrors `servers_test.go` and `config_test.go` `t.Setenv` patterns). The payoff is e2e: board-route specs become deterministic regardless of how many servers are live on the operator's box. Companion `.spec.md` updates only if a `*.spec.ts` changes.
- **No prod behavior change** when the env var is unset — the production `/api/servers` contract is preserved.
- **Interaction**: independent of and complementary to `260531-m3pl` and `260531-rus8`. Those reduce per-board consumers; this removes environmental SSE inflation. This change is specifically the one that fixes *"passes alone, fails on a busy session"*.

## Open Questions

*(Resolved 2026-05-31 via codebase investigation + user confirmation — see `<!-- clarified -->` markers above.)*

- ~~Filter location~~ → **`ListServers`** (`tmux.go:1413`). The board route attaches servers from two `ListServers`-rooted paths (`/api/servers` and the internal `board.go` board-entry enumeration), so `handleServersList`-only would leave board SSE inflation unscoped. Env-gated, so prod is unchanged and the supervisor (which doesn't call `ListServers`) is untouched.
- ~~Env var~~ → **new `RK_SERVER_ALLOWLIST`**, read in `config.Load()`. `E2E_TMUX_SERVER` is Go-invisible (shell/TS only); a dedicated `RK_*` name matches convention.
- ~~Match mode~~ → **prefix** on `rk-test-e2e`. Admits per-spec secondaries (`rk-test-e2e-multi/-coupling/-msb-<pid>-<epoch>`); exact would exclude them. Cross-worktree-safe via embedded `process.pid`.
- Should this be strictly test-only, or a general prod-side server-allowlist? **Default: test-only, prod unchanged** (env unset = today's behavior). The `RK_SERVER_ALLOWLIST` shape is a forward-compatible base for a future operator-facing allowlist, but that generalization is explicitly out of scope here.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The backend enumerates ALL tmux servers unfiltered; test isolation covers the write socket but not the backend read path | Verified this session: tmux.go:1413 ScanSocketDir no filter, servers.go:20-24 surfaces everything by design, E2E_TMUX_SERVER never read by Go | S:95 R:85 A:95 D:95 |
| 2 | Certain | This inflates board-route SSE count load-dependently: N live servers → N EventSources → N of 6 slots consumed | Traced use-window-pins.ts:93-95 (attach all) + session-context.tsx:211-215 (one ES per server) this session | S:95 R:80 A:90 D:90 |
| 3 | Certain | Must use an ALLOWLIST of the test server name, NOT a denylist — rk-test-e2e is matched by IsTestServerName so `!IsTestServerName` would hide it | Verified tmux.go:1336 (HasPrefix "rk-test-") and supervisor.go:31-42 usage; the denylist hides exactly the wrong thing | S:95 R:80 A:95 D:90 |
| 4 | Confident | Env-gated, prod-default-unchanged — filter only narrows when the var is set | Preserves the deliberate servers.go:20 prod contract; matches existing RK_PORT/RK_HOST config convention | S:80 R:75 A:85 D:80 |
| 5 | Confident | change_type = fix | Repairs the environmental cause of a deterministic-on-busy-box test hang; matches "fix"/"hang" | S:80 R:90 A:90 D:80 |
| 6 | Certain | Apply the filter in ListServers (`tmux.go:1413`), env-gated — not handleServersList-only | Clarified — user confirmed. Traced board route to TWO ListServers-rooted paths (/api/servers + board.go ListAllBoardEntries:151/GetBoard:221); handleServersList-only leaves board-entry attach unscoped. tmux.go:1332 comment is the prod (env-unset) path, preserved. Supervisor doesn't call ListServers. | S:95 R:80 A:90 D:90 |
| 7 | Certain | Env var: new RK_SERVER_ALLOWLIST read in config.Load (not reuse E2E_TMUX_SERVER) | Clarified — user confirmed. Verified E2E_TMUX_SERVER is Go-invisible (shell/TS only); dedicated RK_* mirrors RK_PORT/RK_HOST convention and is honest about allowlist intent. | S:95 R:75 A:90 D:85 |
| 8 | Certain | Allowlist match mode: prefix on rk-test-e2e (not exact) | Clarified — user confirmed. Verified per-spec secondaries rk-test-e2e-<role>-<pid>-<epoch> created in beforeAll (boards-multi-server.spec.ts:10 etc); exact would exclude them. Cross-worktree-safe via embedded process.pid. | S:95 R:70 A:85 D:80 |

8 assumptions (6 certain, 2 confident, 0 tentative, 0 unresolved).
