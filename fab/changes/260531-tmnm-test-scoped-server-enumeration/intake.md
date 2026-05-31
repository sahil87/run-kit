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

Introduce an **allowlist filter** read from an env var (name TBD at spec — candidates: a new `RK_SERVER_ALLOWLIST`, or reuse/rename `E2E_TMUX_SERVER` which the harness already exports). Behavior:

- **Env unset** (prod default): `ListServers` returns all discovered live servers — unchanged from today.
- **Env set** (test): the enumeration returns only servers whose name matches the allowlist (single value for now, e.g. `rk-test-e2e`; a comma-list is a possible extension).

Open design point (spec): apply the filter inside `ListServers` (`tmux.go:1413`) so *all* consumers see the scoped list (servers list, board enumeration, supervisor — anything that calls it), **vs.** apply it only in `handleServersList` (`api/servers.go:19`) so the HTTP surface is scoped but internal callers still see everything. The former is more thorough (the board cross-server attach reads the same list); the latter is narrower-blast-radius. Leaning toward `ListServers` since that is where the SSE-driving list originates, but the supervisor/active-window paths must be checked for unintended scoping.

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

- Filter location: inside `ListServers` (scopes all consumers incl. board cross-server attach — more thorough) vs only `handleServersList` (HTTP-surface-only — narrower)? Must check whether scoping `ListServers` has unintended effects on the `tmuxctl` supervisor / active-window providers that also enumerate servers.
- Env var: new `RK_SERVER_ALLOWLIST` vs reuse `E2E_TMUX_SERVER` (already exported by the harness but currently Go-invisible)? A dedicated `RK_*` name is more honest about intent and matches the existing config convention; reusing avoids adding a var.
- Single value vs comma-separated allowlist? Tests spin up secondary servers (`rk-test-e2e-multi-*`, `rk-test-e2e-coupling-*`, per `test-e2e.sh:26`) — does the allowlist need a prefix match (`rk-test-e2e*`) rather than exact, so multi-server specs still see their own secondaries but not the operator's `kit`/`runWork`?
- Should this be strictly test-only, or is a general prod-side server-allowlist (e.g. for an operator who wants to hide certain servers) a worthwhile generalization? Default assumption: test-only, prod unchanged.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The backend enumerates ALL tmux servers unfiltered; test isolation covers the write socket but not the backend read path | Verified this session: tmux.go:1413 ScanSocketDir no filter, servers.go:20-24 surfaces everything by design, E2E_TMUX_SERVER never read by Go | S:95 R:85 A:95 D:95 |
| 2 | Certain | This inflates board-route SSE count load-dependently: N live servers → N EventSources → N of 6 slots consumed | Traced use-window-pins.ts:93-95 (attach all) + session-context.tsx:211-215 (one ES per server) this session | S:95 R:80 A:90 D:90 |
| 3 | Certain | Must use an ALLOWLIST of the test server name, NOT a denylist — rk-test-e2e is matched by IsTestServerName so `!IsTestServerName` would hide it | Verified tmux.go:1336 (HasPrefix "rk-test-") and supervisor.go:31-42 usage; the denylist hides exactly the wrong thing | S:95 R:80 A:95 D:90 |
| 4 | Confident | Env-gated, prod-default-unchanged — filter only narrows when the var is set | Preserves the deliberate servers.go:20 prod contract; matches existing RK_PORT/RK_HOST config convention | S:80 R:75 A:85 D:80 |
| 5 | Confident | change_type = fix | Repairs the environmental cause of a deterministic-on-busy-box test hang; matches "fix"/"hang" | S:80 R:90 A:90 D:80 |
| 6 | Tentative | Apply the filter in ListServers (all consumers) vs only handleServersList (HTTP only) | ListServers is more thorough since the board attach reads the same list, but may scope the supervisor/active-window paths unintentionally — verify at spec | S:55 R:60 A:60 D:50 |
| 7 | Tentative | Env var: new RK_SERVER_ALLOWLIST vs reuse E2E_TMUX_SERVER | Dedicated name is clearer + matches convention; reuse avoids a new var — both defensible | S:55 R:70 A:60 D:55 |
| 8 | Tentative | Allowlist match mode: exact vs prefix (rk-test-e2e*) to also admit test-spun secondaries (rk-test-e2e-multi-*, -coupling-*) | Secondary test servers exist (test-e2e.sh:26); exact-match would wrongly exclude them, prefix risks re-admitting other worktrees' rk-test-* — needs the naming scheme nailed down at spec | S:50 R:60 A:55 D:45 |

8 assumptions (3 certain, 2 confident, 3 tentative, 0 unresolved).
