# Plan: Server URL via tmux Option

**Change**: 260814-qb8z-server-url-tmux-option
**Intake**: `intake.md`

## Requirements

### tmux: `@rk_origin` option primitives

#### R1: Server-scoped origin option constant and accessors
`internal/tmux` MUST define `OriginOption = "@rk_origin"` (registered beside `SessionOrderOption`/`ServerRankOption` in `app/backend/internal/tmux/tmux.go`) and provide `SetServerOrigin(ctx, server, origin string) error` and `GetServerOrigin(ctx, server string) (string, error)` following the `SetServerRank`/`GetServerRank` pattern exactly: server-scoped `set-option -s` / `show-option -sv` via `tmuxExecRawServer`, `context.WithTimeout(ctx, TmuxTimeout)`, explicit argv (Constitution I). `GetServerOrigin` MUST return `("", nil)` for the normal first-use states (unset option — "invalid option"/"unknown option" — and dead/absent socket via `IsServerGone`), and propagate other failures as wrapped errors.

- **GIVEN** a live tmux server on socket `S` **WHEN** `SetServerOrigin(ctx, S, "http://127.0.0.1:3001")` is called **THEN** `tmux -L S show-option -sv @rk_origin` prints `http://127.0.0.1:3001`
- **GIVEN** a live server where `@rk_origin` was never set **WHEN** `GetServerOrigin` is called **THEN** it returns `("", nil)`, not an error
- **GIVEN** a dead/absent socket **WHEN** `GetServerOrigin` is called **THEN** it returns `("", nil)`

#### R2: Allowlist admission helper
`internal/tmux` MUST export `ServerAllowed(name string) bool`, reporting whether a server name is admitted by the deployment's `RK_SERVER_ALLOWLIST` (env `ServerAllowlistEnv`), with semantics identical to the existing `ListServers` filter: unset/blank env admits everything; otherwise `matchesServerAllowlist` decides. This is the shared "does this deployment cover this server?" predicate the stamp seam (R3) gates on.

- **GIVEN** `RK_SERVER_ALLOWLIST` unset **WHEN** `ServerAllowed("default")` is called **THEN** it returns true
- **GIVEN** `RK_SERVER_ALLOWLIST=rk-test-e2e` **WHEN** `ServerAllowed("default")` is called **THEN** it returns false, **AND** `ServerAllowed("rk-test-e2e")` returns true

### tmuxctl: origin stamp at the dial seam

#### R3: Stamp `@rk_origin` in `productionDial`
The serve process MUST stamp its config-derived origin (`http://{cfg.Host}:{cfg.Port}`) onto every tmux server it dials, in `productionDial` (`app/backend/internal/tmuxctl/client.go`) immediately beside the existing `SetExitEmptyOff` backstop — same contract: runs on every dial AND every reconnect, non-fatal on error (`slog.Debug`, dial proceeds). The stamp MUST be skipped when (a) the configured origin is empty (no origin was injected — non-serve consumers of tmuxctl are unaffected), or (b) `tmux.ServerAllowed(socket)` is false (an allowlisted deployment — e.g. the e2e backend on :3020, which dials host sockets — must never overwrite a host server's origin).

The origin value MUST be injected once by `cmd/rk/serve.go` before `supervisor.Start` via an exported tmuxctl seam (package-level setter or equivalent), derived from the same `config.Load()` the server binds with. This seam placement is what satisfies the intake's staleness/coverage criteria: fsnotify `Create` → `openSocket` → dial covers every server at birth, the synchronous `Start` enumeration covers every pre-existing server at daemon startup (healing a port change across restarts), and reconnects re-stamp for free.

- **GIVEN** a daemon started with `RK_PORT=3001` **WHEN** the supervisor dials any covered server (at startup, on socket creation, or on reconnect) **THEN** that server's `@rk_origin` is `http://127.0.0.1:3001`
- **GIVEN** an e2e backend with `RK_SERVER_ALLOWLIST=rk-test-e2e` whose supervisor dials the host's `default` socket **WHEN** `productionDial` runs **THEN** no `@rk_origin` write occurs on `default`
- **GIVEN** the stamp write fails (e.g. momentarily unreachable server) **WHEN** `productionDial` runs **THEN** the dial proceeds (non-fatal, logged at debug)
- **GIVEN** a daemon previously stamped `http://127.0.0.1:3000` and was restarted with `RK_PORT=3005` **WHEN** the new process's supervisor start-enumeration dials the server **THEN** `@rk_origin` becomes `http://127.0.0.1:3005`

### CLI: origin resolver and consumers

#### R4: Shared origin resolver with env → option → default precedence
`cmd/rk` MUST provide a shared resolver (new file `app/backend/cmd/rk/origin.go`, package `main`, beside the `tmuxSocketArgs` precedent used by `role.go`/`present.go`) returning the deployment origin as a string, with this exact precedence:

1. **Explicit env wins**: if `RK_HOST` or `RK_PORT` is set (non-empty) in the caller's environment, return `http://{cfg.Host}:{cfg.Port}` from `config.Load()` — current behavior, a deliberate operator override.
2. **Tmux option**: else, when the caller runs inside a tmux pane (`tmux.OriginalTMUX` non-empty — internal/tmux's `init()` strips `$TMUX`, so the captured value is the seam, per the `role.go` pattern), read `@rk_origin` from the pane's OWN server via `tmuxSocketArgs(tmux.OriginalTMUX)` + `show-option -sv @rk_origin` under a bounded context. The value MUST be validated before use: `url.Parse` succeeds, scheme is `http` or `https`, host is non-empty. Empty, unreadable, or invalid values fall through to 3.
3. **Default**: return `http://{cfg.Host}:{cfg.Port}` from `config.Load()` (i.e. `http://127.0.0.1:3000`) — unchanged fallback.

Subprocess and env reads MUST go through seam vars (the `roleRunOutputFn`/`roleOriginalTMUXFn` idiom) so precedence is unit-testable without a live tmux server.

- **GIVEN** `RK_PORT=4000` set in a pane whose server carries `@rk_origin=http://127.0.0.1:3001` **WHEN** the resolver runs **THEN** it returns `http://127.0.0.1:4000` (env wins)
- **GIVEN** no `RK_*` env, a pane whose server carries `@rk_origin=http://127.0.0.1:3001` **WHEN** the resolver runs **THEN** it returns `http://127.0.0.1:3001`
- **GIVEN** no `RK_*` env and `@rk_origin` unset or malformed (e.g. `not a url`) **WHEN** the resolver runs **THEN** it returns `http://127.0.0.1:3000`
- **GIVEN** no `RK_*` env and no `$TMUX` (not in a pane) **WHEN** the resolver runs **THEN** it returns `http://127.0.0.1:3000` with zero tmux subprocess calls

#### R5: `rk url` uses the resolver
`cmd/rk/url.go` MUST print the resolver's origin. Its Short/Long help text and doc comment MUST be updated to describe the precedence (explicit `RK_HOST`/`RK_PORT` env → the covering tmux server's `@rk_origin` → the `127.0.0.1:3000` default) while retaining the existing "not a liveness probe" caveat. The CLI-surface change MUST be checked against the applicable `shll standards` entries (Constitution § Toolkit Standards).

- **GIVEN** a pane in an rk-born server on a `RK_PORT=3001` deployment (env scrubbed by `sanitizeEnv`) **WHEN** `rk url` runs **THEN** it prints `http://127.0.0.1:3001`, not the 3000 default

#### R6: `rk notify` uses the resolver
`cmd/rk/notify.go`'s `sendNotify` MUST build its POST target from the resolver (`{origin}/api/notify`) instead of `config.Load()` directly. The fail-silent contract is unchanged.

- **GIVEN** a pane in an rk-born server on a `RK_PORT=3001` deployment **WHEN** `rk notify "msg"` runs **THEN** the POST targets `http://127.0.0.1:3001/api/notify`

### Exclusions

#### R7: Layout snapshots exclude `@rk_origin`
The `internal/snapshot` capture/restore set (which mirrors `@rk_server_rank`/`@rk_session_order`) MUST NOT gain `@rk_origin`: a restored server is re-stamped by the supervisor's dial within one fsnotify/startup pass, so persisting the value would only round-trip staleness. This is a no-change requirement verified by inspection.

- **GIVEN** the shipped change **WHEN** grepping `internal/snapshot` for `@rk_origin`/`OriginOption` **THEN** there are no matches

### Non-Goals

- No UI/frontend change, no API surface change — `@rk_origin` is not surfaced in `ListWindows`/SSE payloads.
- No env injection of any `RK_*` var into tmux servers or panes — the `sanitizeEnv` strip is untouched.
- `rk serve` and the daemon lifecycle commands (`daemon start/stop/status/restart`) keep env-only resolution — the server defines the truth the option mirrors; daemon lifecycle targets the env-selected deployment by design.
- No port-owner/liveness probing — `rk url` remains a heuristic, now a better-informed one.
- No remote-hosts (`internal/remote`) behavior change — remote daemons benefit automatically once their panes read the option.

### Design Decisions

#### Stamp seam is productionDial, not the SSE hub poll
**Decision**: Stamp `@rk_origin` in `tmuxctl.productionDial` beside `SetExitEmptyOff`, injected from serve startup.
**Why**: The supervisor covers EVERY server the deployment touches (fsnotify socket-create → dial at birth; synchronous start enumeration → heals staleness across daemon restarts; reconnect → re-stamp), independent of whether any client is viewing. `SetExitEmptyOff` already established the exact contract (every-dial, idempotent, non-fatal) and coverage story ("every server run-kit touches, including hand-created/foreign ones"). The intake suggested the SSE hub's safety poll; that seam's poll set is client-derived (`h.clients`), so panes in never-viewed servers would never get stamped — the dial seam strictly dominates it on the intake's own criteria.
**Rejected**: SSE hub poll stamp (client-scoped coverage, misses unviewed servers, adds hot-path work); birth-seam-only stamp (stale across daemon restarts, misses foreign/pre-existing servers).
*Introduced by*: 260814-qb8z-server-url-tmux-option

#### Allowlist-gated stamping
**Decision**: Gate the stamp on `tmux.ServerAllowed(socket)` — the `RK_SERVER_ALLOWLIST` semantics `ListServers` already applies.
**Why**: The e2e backend (`RK_PORT=3020`, `RK_SERVER_ALLOWLIST=rk-test-e2e` per `scripts/test-e2e.sh`) runs a supervisor that dials the host's non-test sockets (the supervisor skips only `rk-test-*` names); ungated, it would overwrite host servers' origin with `:3020`. The allowlist is the deployment's own declaration of coverage, making "which servers do I stamp" the same question as "which servers do I enumerate".
**Rejected**: Ungated stamp (test-deployment corruption of host origins); a separate stamp-specific env knob (a second knob for the same coverage concept).
*Introduced by*: 260814-qb8z-server-url-tmux-option

#### Unconditional set on dial (no read-compare)
**Decision**: Write the option on every dial without reading it first.
**Why**: Dials are rare events (startup, socket birth, reconnect), and `SetExitEmptyOff` already pays an identical unconditional round-trip at the same spot; a read-compare would double the tmux calls to save nothing.
**Rejected**: Write-if-different (extra `show-option` per dial for zero benefit); in-memory once-per-server memo (extra state, and a manually cleared option would never heal until restart).
*Introduced by*: 260814-qb8z-server-url-tmux-option

#### Resolver lives in cmd/rk (package main)
**Decision**: Put the resolver in `cmd/rk/origin.go` beside its two consumers, reusing the local `tmuxSocketArgs` helper and the `role.go` seam-var test idiom.
**Why**: Both consumers are `cmd/rk` commands; the `$TMUX`-socket targeting helper (`tmuxSocketArgs`) and the `tmux.OriginalTMUX` capture pattern already live there (`role.go`, `present.go`, `agent_hook.go`). A new `internal/origin` package would need the socket-args helper moved/exported for no additional consumer.
**Rejected**: `internal/origin` package (premature — extract later if a non-CLI consumer appears); extending `internal/config` (config is a leaf package that must not import `internal/tmux`).
*Introduced by*: 260814-qb8z-server-url-tmux-option

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `OriginOption = "@rk_origin"` constant + `SetServerOrigin`/`GetServerOrigin` (mirror `SetServerRank`/`GetServerRank` incl. unset/dead-socket taxonomy) in `app/backend/internal/tmux/tmux.go`; live-socket round-trip + unset tests in `app/backend/internal/tmux/tmux_test.go` <!-- R1 -->
- [x] T002 [P] Export `ServerAllowed(name string) bool` in `app/backend/internal/tmux/tmux.go` (wraps `ServerAllowlistEnv` + `matchesServerAllowlist`; unset env admits all) and refactor the `ListServers` filter to use it; unit tests for unset/blank/match/no-match in `tmux_test.go` <!-- R2 -->
- [x] T003 Add the origin-stamp seam to `app/backend/internal/tmuxctl/client.go`: exported package-level injection (e.g. `SetStampOrigin(origin string)`), and in `productionDial` — after `SetExitEmptyOff`, same non-fatal contract — call `tmux.SetServerOrigin` when the injected origin is non-empty AND `tmux.ServerAllowed(socket)`; unit test the gate logic via a small extracted helper (pty-free) in `client_test.go` <!-- R3 -->
- [x] T004 Wire injection in `app/backend/cmd/rk/serve.go`: compute `http://{cfg.Host}:{cfg.Port}` from the already-loaded config and call the tmuxctl seam before `supervisor.Start` <!-- R3 -->
- [x] T005 Create `app/backend/cmd/rk/origin.go`: `resolveOrigin()` with env → `@rk_origin` (via `tmuxSocketArgs(tmux.OriginalTMUX)` + `show-option -sv`, bounded ctx, `url.Parse` + http/https + non-empty-host validation) → default precedence; seam vars per the `role.go` idiom; table-driven tests in `origin_test.go` covering all four R4 scenarios <!-- R4 -->
- [x] T006 Switch `app/backend/cmd/rk/url.go` to `resolveOrigin()`; update doc comment + Short/Long help text to describe the precedence, keeping the not-a-liveness-probe caveat; update `url_test.go`; check the changed help surface against `shll standards` (help-dump standard) <!-- R5 -->
- [x] T007 Switch `app/backend/cmd/rk/notify.go` `sendNotify` to `resolveOrigin()` (POST to `{origin}/api/notify`, fail-silent unchanged); update `notify_test.go` <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Verify no `@rk_origin` capture crept into `internal/snapshot` (grep), and run the verification gates: `cd app/backend && go test ./...`, then `just build` <!-- R7 -->

## Execution Order

- T001 and T002 block T003 (the stamp calls both); T003 blocks T004
- T005 blocks T006 and T007
- T002 and T005 are independent of each other; T008 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `tmux.OriginOption`, `SetServerOrigin`, `GetServerOrigin` exist and round-trip on a live test socket; unset and dead-socket cases return `("", nil)`
- [x] A-002 R2: `tmux.ServerAllowed` admits everything when `RK_SERVER_ALLOWLIST` is unset/blank and applies `matchesServerAllowlist` otherwise; `ListServers` uses it (no duplicated filter logic)
- [x] A-003 R3: `productionDial` stamps the injected origin on admitted sockets after `SetExitEmptyOff`, non-fatally; `serve.go` injects the config-derived origin before `supervisor.Start`
- [x] A-004 R4: `resolveOrigin` implements the exact env → validated-option → default precedence with seam-var testability
- [x] A-005 R5: `rk url` prints the resolver result; help text documents the precedence and retains the heuristic caveat
- [x] A-006 R6: `rk notify` POSTs to `{resolveOrigin()}/api/notify` with the fail-silent contract intact

### Behavioral Correctness

- [x] A-007 R3: An empty injected origin (tmuxctl used outside serve) and a non-admitted socket (e2e allowlist) both produce zero `@rk_origin` writes
- [x] A-008 R4: With `RK_HOST` or `RK_PORT` explicitly set, the resolver never spawns a tmux subprocess (env short-circuits)

### Scenario Coverage

- [x] A-009 R4: Table-driven tests cover: env wins over option; option wins over default; malformed/empty option falls through; no-$TMUX falls through with zero subprocess calls
- [x] A-010 R1: Live-socket test proves set → show round-trip of a full origin string (scheme://host:port)

### Edge Cases & Error Handling

- [x] A-011 R3: A failing stamp write does not abort the dial (non-fatal, logged)
- [x] A-012 R4: A hostile/garbage `@rk_origin` value (non-URL, `javascript:` scheme, empty host) is rejected by validation and never used as a POST/print target

### Removal Verification

- [x] A-013 R7: `internal/snapshot` contains no `@rk_origin`/`OriginOption` reference

### Code Quality

- [x] A-014 Pattern consistency: new tmux accessors mirror `SetServerRank`/`GetServerRank`; resolver seams mirror `role.go`'s `roleRunOutputFn` idiom; all subprocess calls use `exec.CommandContext` with explicit argv and timeouts (never shell strings)
- [x] A-015 No unnecessary duplication: the allowlist predicate is shared (`ServerAllowed`) rather than re-implemented at the stamp site; origin composition (`http://{host}:{port}`) is not duplicated across url.go/notify.go (both call the resolver)
- [x] A-016 Tests included: new behavior in `internal/tmux`, `internal/tmuxctl`, and `cmd/rk` is covered per code-quality.md (new features MUST include tests)
- [x] A-017 No polling/caching additions on the SSE hot path (the stamp rides dial events only)

### Security

- [x] A-018 R4: The option value read from tmux is validated (scheme allowlist http/https, parseable, non-empty host) before being used to build request/print targets — a pane-writable option can never inject an arbitrary scheme or malformed target

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The only replaced code (the direct `config.Load()` origin derivation in `url.go`/`notify.go`) was removed in place by the resolver switch; no other symbol, file, or branch became unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Stamp seam moved from the intake's suggested SSE-hub covering pass to `productionDial` (beside `SetExitEmptyOff`) | The hub's poll set is client-derived, so unviewed servers would never be stamped; the dial seam covers every touched server at birth/startup/reconnect — strictly better on the intake's own staleness+coverage criteria, with an established idempotent non-fatal precedent at the exact spot | S:70 R:70 A:85 D:75 |
| 2 | Confident | Stamp gated on `RK_SERVER_ALLOWLIST` via a new shared `tmux.ServerAllowed` | `scripts/test-e2e.sh` sets the allowlist while its supervisor still dials host sockets; without the gate the e2e backend would overwrite host origins with `:3020` | S:65 R:75 A:85 D:70 |
| 3 | Confident | Resolver placed in `cmd/rk/origin.go` (package main) with seam-var tests, not a new internal package | Both consumers and the `tmuxSocketArgs`/`OriginalTMUX` idiom live in `cmd/rk` (`role.go`, `present.go`); extract a package only when a non-CLI consumer appears | S:60 R:80 A:80 D:65 |
| 4 | Confident | Env short-circuit means "RK_HOST or RK_PORT set ⇒ pure env path, no tmux read" | Partial-env cases are rare; `config.Load()` already fills the unset half with defaults, and a deliberate operator override should behave exactly like today | S:55 R:80 A:75 D:60 |
| 5 | Confident | Option-value validation = `url.Parse` + scheme ∈ {http, https} + non-empty host, reject-and-fall-through | The option is same-user-writable state used to build POST/print targets; scheme allowlisting is the minimal Constitution-I-posture guard without inventing a URL vocabulary | S:55 R:85 A:80 D:70 |

5 assumptions (0 certain, 5 confident, 0 tentative).
