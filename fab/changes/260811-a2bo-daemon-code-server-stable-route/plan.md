# Plan: Daemon-Managed code-server & the Stable /code Route

**Change**: 260811-a2bo-daemon-code-server-stable-route
**Intake**: `intake.md`

## Requirements

### Backend: Port Resolution

#### R1: Shared code-server port resolution
`internal/config` SHALL expose one shared resolution rule used by the daemon, the `/code` proxy, the SSE probe, and doctor: a valid preset `RK_CODE_SERVER_PORT` (1–65535) wins; otherwise the convention default `RK_PORT+2` applies. When neither yields a valid port (degenerate `RK_PORT`), resolution yields 0 (feature off). No other input configures the port.

- **GIVEN** `RK_CODE_SERVER_PORT=3939` and `RK_PORT=3020`
- **WHEN** the port is resolved
- **THEN** the result is 3939 (preset wins)
- **AND** with `RK_CODE_SERVER_PORT` unset/invalid and `RK_PORT=3000`, the result is 3002

### Backend: The /code Route

#### R2: Stable `/code/*` reverse-proxy route
The Go server SHALL mount a dedicated route reverse-proxying `/code/*` to `127.0.0.1:{resolved port}`, reusing the existing `/proxy/{port}` machinery via a shared prefix-parameterized proxy constructor (no copy-paste): same `httputil.ReverseProxy` shape, `SetXForwarded()` (code-server's origin check needs `X-Forwarded-Host` matching the browser Origin on WS handshakes), WebSocket passthrough, HTML localhost-rewrite targeting `/code`, and per-route proxy caching. The port MUST never appear in any URL the frontend builds.

- **GIVEN** a listener on the resolved code-server port
- **WHEN** a client requests `GET /code/?folder=/repo`
- **THEN** the request is proxied to `127.0.0.1:{port}/?folder=/repo` with `X-Forwarded-Host` set from the inbound Host
- **AND** a request path `/code/static/x.js` reaches the upstream as `/static/x.js`

#### R3: `/code` trailing-slash redirect
A request for the bare `/code` (no trailing slash) SHALL 308-redirect to `/code/` with the query string preserved (relative-base resolution), before any proxying; slashed paths proxy directly (no loop).

- **GIVEN** the server is running
- **WHEN** a client requests `GET /code?folder=/repo`
- **THEN** the response is 308 with `Location: /code/?folder=/repo`

### Backend: SSE Signal

#### R4: code-server signal drops the port
The host-global `event: code-server` payload SHALL carry only `{"reachable": bool}` — the port is a private implementation detail behind `/code/`. The hub SHALL probe `127.0.0.1:{resolved port}` with the existing TTL-cached dial (5s TTL, 500ms dial timeout, outside `h.mu`) and broadcast on every poll tick with client-side dedup absorbing repetition, replayed to late joiners via the cached slot. Since the port is always resolvable by convention, a configured server always broadcasts (0 = degenerate config stays silent).

- **GIVEN** the resolved port has a listener
- **WHEN** the poll loop ticks
- **THEN** every state-socket connection receives `event: code-server` with `{"reachable":true}` and no `port` field

### Daemon: Managed code-server Lifecycle

#### R5: Daemon starts code-server on the rk-daemon socket
Every successful `rk daemon start` / `restart` (both `Start` and `StartWithBinary` branches) SHALL additionally launch code-server as its own tmux session `rk-code-server` (single window `code-server`) on the `rk-daemon` socket — the `rk-remotes` sibling-session precedent: shares the socket, not the `rk-daemon` session's lifecycle. Launch argv: `env -u VSCODE_IPC_HOOK_CLI code-server --bind-addr 127.0.0.1:{port} --auth none` (the `env -u` strips the VS Code integrated-terminal var that flips code-server into `code`-CLI mode; loopback-only + the rk origin as the trust boundary). All exec via the existing `runTmux` wrapper (`exec.CommandContext` + argv + `cmdTimeout`).

- **GIVEN** no code-server session exists and the resolved port is free and the binary is on PATH
- **WHEN** `daemon.Start()` completes
- **THEN** a detached `rk-code-server` session exists on the rk-daemon socket running code-server bound to `127.0.0.1:{resolved port}` with `--auth none`

#### R6: Idempotent spawn
The code-server spawn SHALL be re-entrant on every daemon start: (a) the `rk-code-server` session already exists on the daemon socket ⇒ skip silently; (b) the resolved port already accepts connections ⇒ skip with an `slog` note (an externally managed instance is respected — the dev.sh preset-port carve-out's mirror).

- **GIVEN** the `rk-code-server` session already exists
- **WHEN** the daemon starts again
- **THEN** no second spawn is attempted and no error is raised

#### R7: Warn-and-continue on absent binary
When the `code-server` binary is absent from PATH, the daemon SHALL warn loudly (`slog.Warn`) and continue — `rk serve` MUST still come up on every daemon-start branch; a missing editor must never block the dashboard. The code-server spawn itself is best-effort: any spawn failure is logged, never propagated.

- **GIVEN** `code-server` is not on PATH
- **WHEN** `rk daemon start` runs
- **THEN** the daemon session starts successfully and a warning naming the missing binary is logged

#### R8: `daemon stop` leaves code-server running
`rk daemon stop` SHALL NOT touch the code-server session — server-side terminals and hot-exit state live in that process (Constitution VI's spirit). `Stop()`'s exact-match target (`=rk-daemon`) never matches the sibling session. Killing code-server is a manual tmux action in v1 (no `--all` flag).

- **GIVEN** a running daemon and a running code-server session
- **WHEN** `rk daemon stop` completes
- **THEN** the `rk-code-server` session is still alive

### Frontend: /code/ Contract

#### R9: Stable iframe src and portless empty state
`code-surface.tsx`'s `codeServerSrc(gitRoot)` SHALL return the relative path `/code/?folder=<encodeURIComponent(gitRoot)>` (never an absolute origin; no port anywhere). The `CodeSurface` component SHALL drop its `port` prop; the not-running empty state SHALL read `code-server not running` plus a doctor hint (`data-testid="code-surface-empty"` unchanged).

- **GIVEN** a window with gitRoot `/repo`
- **WHEN** the code surface renders reachable
- **THEN** the iframe src is exactly `/code/?folder=%2Frepo`

#### R10: Availability simplifies to gitRoot-derived
`hasCode`/`availableViews`/`resolveView` (`window-view.ts`) and `availableSurfaces`/`resolvePanel` (`right-panel.ts`) SHALL drop the `codeServerPort` parameter — availability = the window's `gitRoot` derived non-empty (the "configured" leg is always true by convention). Reachability continues to govern CONTENT only, never the rail button/switcher segment (right-panel.md § Surface Registry semantics preserved).

- **GIVEN** a window with a derived gitRoot and no code-server signal received yet
- **WHEN** available views/surfaces are computed
- **THEN** `code` is offered
- **AND** a `/tmp`-cwd window (no gitRoot) still offers no code lens/surface

#### R11: Client signal shape
`session-context.tsx`'s `CodeServerSignal` SHALL be `{ reachable: boolean }`; the `code-server` event handler SHALL parse `reachable` only. `app.tsx` SHALL drop all `codeServerPort` plumbing.

- **GIVEN** a `code-server` event with `{"reachable":true}`
- **WHEN** the client applies it
- **THEN** `useCodeServer()` returns `{ reachable: true }`

### Dev & E2E Convergence

#### R12: Vite dev proxy for /code
`app/frontend/vite.config.ts` SHALL gain a `/code` proxy entry to the Go backend (`RK_PORT+1`) with `ws: true` and NO `changeOrigin` (the Origin-vs-X-Forwarded-Host WS-403 lesson). `scripts/dev.sh` stays behaviorally unchanged (its preset-export covers the backend's resolution in dev).

- **GIVEN** `just dev` running
- **WHEN** the browser requests `/code/...` from the Vite origin
- **THEN** Vite forwards it (including WS upgrades) to the Go backend with the inbound Host preserved

#### R13: E2E harness keeps the 3939 preset; spec expects /code/
`scripts/test-e2e.sh` SHALL keep presetting `RK_CODE_SERVER_PORT=3939` and the spec's stub keeps binding it; the backend's `/code/*` forwards to 3939. `code-surface.spec.ts` SHALL assert the `/code/?folder=…` iframe src, the portless not-running empty state, and the `/code` → `/code/` redirect; `code-surface.spec.md` SHALL be updated in the same commit.

- **GIVEN** the e2e harness (port 3020, stub on 3939)
- **WHEN** `?panel=code` resolves on a repo-cwd window
- **THEN** the iframe src is `/code/?folder=<git root>` and `/code` 308-redirects to `/code/`

### Doctor

#### R14: code-server doctor row
`rk doctor` SHALL gain a code-server row reporting binary presence, the resolved port, and reachability — a normal doctor row (PASS/WARN), never a hard FAIL: absent binary is the WARN case (OK with an explanatory note, the shim-check precedent), matching R7's warn-and-continue.

- **GIVEN** `code-server` absent from PATH
- **WHEN** `rk doctor` runs
- **THEN** the report stays OK and the code-server row carries a note naming the install remediation

### Docs

#### R15: Spec, README, and .env reflect the managed lifecycle
`docs/specs/right-panel.md` § The `code` lens **Topology** SHALL state the managed lifecycle as current (daemon session, convention port, stable `/code/` path, preset-port override); the Surface Registry availability cell and the Renderer/state-identity bullets SHALL drop the configured-port requirement in favor of `/code/`. The committed `.env` and README SHALL document `RK_CODE_SERVER_PORT` as an override only ("set this to point rk at an externally managed code-server; by default the daemon runs one on RK_PORT+2 behind /code/").

- **GIVEN** a reader of right-panel.md § Topology
- **WHEN** they check how code-server is provisioned
- **THEN** the managed lifecycle reads as the current design, not a deferred follow-up

### Non-Goals

- `daemon stop --all` / killing code-server from the CLI — deferred; manual tmux kill covers v1.
- `rk daemon status` bespoke code-server reporting — the sibling session shows up naturally; doctor is the report.
- Removing the generic `/proxy/{port}` route — it still serves iframe windows; only the code lens moves to `/code/`.
- Memory updates (`docs/memory/`) — the hydrate stage's job.

### Design Decisions

#### code-server runs as a sibling session, not a window of the daemon session
**Decision**: code-server gets its own tmux session `rk-code-server` (one window, `code-server`) on the `rk-daemon` socket — the `rk-remotes` precedent.
**Why**: R8 (stop-leaves-running) and "survives rk serve restarts" are impossible for a window inside the `rk-daemon` session: the session dies with the serve process, and `Stop()`'s grace-timeout `kill-session` fallback would take the editor with it. A sibling session on the same socket satisfies both while staying visible/debuggable with plain tmux (`-L rk-daemon`).
**Rejected**: a window inside the `rk-daemon` session (intake's loose wording) — coupled lifecycle breaks R8 and Stop()'s liveness poll (the session would linger on the orphaned code-server window and then be force-killed).
*Introduced by*: 260811-a2bo-daemon-code-server-stable-route

#### Per-request port resolution in the /code handler
**Decision**: `handleCode` resolves the port via `config.Load().ResolvedCodeServerPort()` at request time; the SSE hub keeps its startup-seeded port for probing.
**Why**: Constitution II derive-at-request-time; env is process-lifetime-stable, the read is four getenvs, and tests drive it with `t.Setenv` instead of needing a server-field seam.
**Rejected**: seeding `Server.codeServerPort` at startup and reading the field — one more seam for zero behavioral gain.
*Introduced by*: 260811-a2bo-daemon-code-server-stable-route

## Tasks

### Phase 1: Setup

- [x] T001 Add `ResolvedCodeServerPort()` to `app/backend/internal/config/config.go` (valid preset wins, else `RK_PORT+2`, else 0; update the `CodeServerPort` field doc — 0 no longer means feature-off, it means unset) + unit tests in `config_test.go` (preset wins, convention fallback, invalid preset falls back, degenerate port ⇒ 0) <!-- R1 -->
- [x] T002 [P] Refactor `app/backend/api/proxy.go`: extract a prefix-parameterized proxy constructor (strip prefix, `SetXForwarded`, HTML rewrite target) from `getOrCreateProxy` — `makeModifyResponse`/`rewriteHTML` take a `pathFor func(matchedPort int) string` so `/proxy/{port}` behavior is preserved verbatim and `/code` rewrites to `/code`; cache keyed by route prefix <!-- R2 -->

### Phase 2: Core Implementation

- [x] T003 Add `handleCode` (`/code` + `/code/*`, registered before the SPA catch-all in `app/backend/api/router.go`): per-request port resolution, 503 when unresolvable, 308 trailing-slash redirect, proxy via the T002 constructor; httptest coverage in `proxy_test.go` (forward + prefix strip + X-Forwarded-Host, redirect with query, no redirect loop) <!-- R2 R3 -->
- [x] T004 `app/backend/api/sse.go`: drop `Port` from `codeServerPayload` (`{"reachable":bool}` only); seed the hub from `cfg.ResolvedCodeServerPort()` in `router.go`; update `TestSSEHubCodeServerBroadcast` expectations in `sse_test.go` <!-- R4 -->
- [x] T005 Add `app/backend/internal/daemon/codeserver.go`: `ensureCodeServer()` (session-exists skip → port-listening skip+note → LookPath warn-and-continue → spawn `rk-code-server` session with `env -u VSCODE_IPC_HOOK_CLI code-server --bind-addr 127.0.0.1:{port} --auth none` via `runTmux`; package seams `codeServerSessionExists`/`codeServerSpawn` for tests); call it best-effort at the end of `startSession`; tests in `codeserver_test.go` (spawn argv + `env -u` assertion via stubbed `code-server` on PATH, skip-when-session-exists, skip-when-port-listening via a real loopback listener, warn-and-continue with empty PATH, port-resolution integration) <!-- R5 R6 R7 R8 -->
- [x] T006 [P] `app/backend/cmd/rk/doctor.go`: add the code-server row (presence + resolved port + reachability, WARN-as-note, never fails the report) via a pure injectable helper + `doctor_test.go` coverage <!-- R14 -->
- [x] T007 `app/frontend/src/components/code-surface.tsx`: `codeServerSrc(gitRoot)` → `/code/?folder=…`; drop the `port` prop; empty state reads `code-server not running` + doctor hint; update `code-surface.test.tsx` <!-- R9 -->
- [x] T008 [P] `app/frontend/src/lib/window-view.ts` + `app/frontend/src/lib/right-panel.ts`: drop `codeServerPort` params (`hasCode(win)` = gitRoot only); update `window-view.test.ts` + `right-panel.test.ts` <!-- R10 -->
- [x] T009 `app/frontend/src/contexts/session-context.tsx`: `CodeServerSignal = { reachable: boolean }`, handler parses `reachable` only; update `app.tsx` call sites (drop `codeServerPort`, CodeSurface props) and `session-context.test.tsx` <!-- R11 -->

### Phase 3: Integration & Edge Cases

- [x] T010 `app/frontend/vite.config.ts`: add the `/code` proxy entry (`ws: true`, NO `changeOrigin`) mirroring the `/proxy` entry's comment discipline <!-- R12 -->
- [x] T011 `app/frontend/tests/e2e/code-surface.spec.ts`: iframe-src expectation → `/code/?folder=…`, portless empty-state text, add the `/code` → `/code/` redirect assertion (request with `maxRedirects: 0`); update `code-surface.spec.md` in the same commit <!-- R13 -->
- [x] T012 Run the verification gates: `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, `just test-e2e "code-surface"` <!-- R2 R4 R9 R10 R11 R13 -->

### Phase 4: Polish

- [x] T013 Docs: `docs/specs/right-panel.md` (§ Topology managed-lifecycle current, Surface Registry availability cell, Renderer/state-identity bullets, Constitution VI line), committed `.env` (RK_CODE_SERVER_PORT as override), README (code-server/daemon mention) <!-- R15 -->

## Execution Order

- T001 blocks T003 (route resolution), T005 (daemon resolution), T006 (doctor resolution)
- T002 blocks T003 (shared constructor)
- T007/T008 block T009 (app.tsx consumes both)
- T010–T013 are independent leaves

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ResolvedCodeServerPort` returns preset-when-valid, else `RK_PORT+2`, else 0; unit tests cover all four branches
- [x] A-002 R2: `/code/*` proxies to `127.0.0.1:{resolved port}` with the prefix stripped and `X-Forwarded-Host` set; WS upgrades pass through the same Rewrite hook
- [x] A-003 R3: `GET /code?folder=/repo` → 308 `Location: /code/?folder=/repo`; `/code/` proxies without redirecting
- [x] A-004 R4: the `code-server` event payload is exactly `{"reachable":bool}`; broadcast + replay behavior otherwise unchanged
- [x] A-005 R5: a successful daemon start spawns the `rk-code-server` session with the exact argv `env -u VSCODE_IPC_HOOK_CLI code-server --bind-addr 127.0.0.1:{port} --auth none` via `exec.CommandContext` + timeout
- [x] A-006 R6: re-running daemon start with the session existing or the port listening spawns nothing and errors nothing
- [x] A-007 R7: with `code-server` absent from PATH the daemon still starts and a warn is logged
- [x] A-008 R8: `daemon stop` never targets the `rk-code-server` session (exact-match `=rk-daemon` only)
- [x] A-009 R9: the code-surface iframe src is `/code/?folder=<encoded gitRoot>`; the empty state carries no port
- [x] A-010 R10: `code` availability depends only on a derived gitRoot; `/tmp`-cwd windows still offer no code affordance
- [x] A-011 R11: `CodeServerSignal` is `{ reachable }`; no `port` plumbing remains in the frontend
- [x] A-012 R12: vite proxies `/code` with `ws: true` and no `changeOrigin`
- [x] A-013 R13: the e2e spec asserts the `/code/` src, the redirect, and the portless empty state; the `.spec.md` matches
- [x] A-014 R14: `rk doctor` reports code-server presence/port/reachability without failing the report on absence
- [x] A-015 R15: right-panel.md, `.env`, and README read as managed-lifecycle-current with `RK_CODE_SERVER_PORT` as an override

### Behavioral Correctness

- [x] A-016 R4: `TestSSEHubCodeServerBroadcast` passes with the portless payload; unconfigured (0) still broadcasts nothing
- [x] A-017 R2: existing `/proxy/{port}` tests pass unchanged — the refactor preserves its behavior byte-for-byte

### Scenario Coverage

- [x] A-018 R5: daemon-code-server tests cover spawn / session-exists skip / port-listening skip / binary-absent warn-and-continue
- [x] A-019 R13: `just test-e2e "code-surface"` passes against the :3020 isolated harness

### Edge Cases & Error Handling

- [x] A-020 R1: `RK_PORT=65535` (convention result out of range) resolves to 0 — `/code` answers 503, the hub stays silent
- [x] A-021 R7: a spawn failure (tmux error) is logged and never fails daemon start
- [x] A-022 R3: `/code` with an empty query redirects to `/code/` exactly (no double slash)

### Code Quality

- [x] A-023: All subprocess execution uses `exec.CommandContext` with argv slices and timeouts — no shell strings (Constitution I)
- [x] A-024: New features include tests covering the added/changed behavior (code-quality Principles)
- [x] A-025: No duplicated proxy construction — the `/code` route reuses the T002 helper (anti-pattern: duplicated utilities)
- [x] A-026: Frontend uses type narrowing over assertions in the touched files (code-quality Principles)
- [x] A-027 Pattern consistency: daemon code reuses `runTmux`/`sessionExistsCtx`/`portInUse`; frontend keeps the pure-helper + colocated-test pattern
- [x] A-028 No unnecessary duplication: port resolution lives in exactly one function shared by daemon, proxy, SSE seed, and doctor

### Security

- [x] A-029 R5: code-server binds `127.0.0.1` only, with `--auth none` behind the rk origin trust boundary (the dev.sh posture); the launch argv strips `VSCODE_IPC_HOOK_CLI`
- [x] A-030 R2: `/code` proxies to loopback only; no user-controlled host/port reaches the proxy target (port comes from config resolution, not the request)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

None — this change adds new functionality (daemon code-server session, `/code` route, doctor row) and refactors the proxy constructor / SSE payload / frontend contract in place; review found no orphaned symbols. The generic `/proxy/{port}` route is deliberately retained (plan Non-Goals — it still serves iframe windows). Memory files describing the pre-change contract (`docs/memory/run-kit/architecture.md`, `ui-patterns.md`) are the hydrate stage's rewrite, not deletions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | code-server runs as a sibling session `rk-code-server` on the rk-daemon socket, not a window inside the `rk-daemon` session | Intake says "own tmux window … on the rk-daemon socket" but also requires stop-leaves-running and serve-restart survival — impossible inside the serve-bound session (its exit closes the session; Stop()'s kill-session fallback would take the editor). The rk-remotes sibling-session precedent satisfies both readings. | S:75 R:80 A:80 D:70 |
| 2 | Certain | An invalid preset `RK_CODE_SERVER_PORT` falls back to the `RK_PORT+2` convention (invalid = unset), matching the existing Load() parse behavior | Load() already zeroes invalid values; the resolution treats 0 as "no preset" | S:85 R:85 A:90 D:85 |
| 3 | Certain | The SSE payload drops `port` entirely (not emitted-but-unread) — both sides ship atomically | Intake §3 prefers dropping; single consumer, one release | S:70 R:75 A:85 D:75 |
| 4 | Confident | The doctor code-server row never fails the report: absent binary renders OK + remediation note (the tmux-guard shim check's optional-note precedent) | Intake's "PASS/WARN" maps onto doctor's existing OK+Note warn idiom; hard-failing over an editor contradicts R7 | S:70 R:85 A:80 D:70 |
| 5 | Certain | Empty state text: `code-server not running — check rk doctor` (`data-testid="code-surface-empty"` preserved) | Intake's example plus the doctor hint; testid stability keeps e2e locators | S:80 R:90 A:85 D:80 |
| 6 | Confident | `handleCode` resolves the port per request via `config.Load()`; the SSE hub keeps its startup seed | Constitution II request-time derivation; env is process-stable; removes a test seam | S:70 R:80 A:80 D:70 |

6 assumptions (3 certain, 3 confident, 0 tentative).
