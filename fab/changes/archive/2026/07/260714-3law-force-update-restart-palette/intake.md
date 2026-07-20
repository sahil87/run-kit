# Intake: Force Update + Daemon Restart Palette Actions with Boot-Aware Reload

**Change**: 260714-3law-force-update-restart-palette
**Created**: 2026-07-14

## Origin

> Force-update + daemon-restart command-palette actions, and restart-aware tab reload via a boot ID on the version SSE event.

Promptless dispatch (created via the Create-Intake Procedure with `{questioning-mode} = promptless-defer`) from a synthesized description produced in prior discussion. The description carried six explicitly **user-decided** design blocks (palette entries and gating, force semantics on `POST /api/update`, new `POST /api/restart`, extended `event: version` payload, extended reload guard with dev suppression, frontend wiring) — these were settled in discussion and are recorded as Certain assumptions; they are not to be re-opened. Remaining implementation-detail decisions were graded via SRAD without asking (no user reachable); none landed Unresolved.

Direct follow-up to merged change `260713-4zap-update-notify-one-click-upgrade` (PR #340, commit 979fbbe — present in this checkout).

## Why

1. **Patch releases are unreachable from the web.** 4zap's one-click update is gated on the update checker's *qualifying* snapshot, and the checker qualifies only minor/major releases (`internal/updatecheck` — hand-rolled semver, minor/major only). For a patch release, `POST /api/update` returns `409 "no update available"` even though `rk update` in a shell would happily install it. The web surface is strictly weaker than the CLI for no principled reason.
2. **A wedged daemon still needs SSH.** There is no web-reachable way to bounce the daemon. `rk daemon restart` exists and works (`app/backend/cmd/rk/daemon_restart.go` — `daemon.Stop()` then `daemon.Start()`), but only from a shell. run-kit's primary use case is remote/mobile operation over Tailscale — requiring SSH for a routine restart defeats that.
3. **A plain restart does not refresh open tabs.** The tab-reload guard (`shouldReloadOnVersion` in `app/frontend/src/contexts/session-context.tsx`) keys on *version change* only. After a same-version daemon restart (config change, wedge recovery, restart from SSH), every open tab silently reconnects to a new process while running possibly-stale assets and holding stale in-memory state, with no signal that a restart happened. The daemon needs a per-process *boot identity* so tabs can detect "same version, new process".

If we don't do this: patch releases require SSH on every host, daemon recovery requires SSH, and restarts leave stale tabs — all directly against the project's remote-first, keyboard-first posture.

Why this approach: both new verbs wrap existing CLI commands (`rk update`, `rk daemon restart`) per Constitution III (Wrap, Don't Reinvent); the palette is the mandated discovery surface per Constitution V; the boot ID is in-memory per-process state, clean under Constitution II (No Database); and the whole design reuses the proven 4zap machinery (seams, detached spawn, cached SSE slot, pure builders, dual palette mounts) rather than inventing parallel mechanisms.

## What Changes

### 1. Backend — force semantics on `POST /api/update` (USER-DECIDED)

`app/backend/api/update.go` `handleUpdate` gains a JSON body flag:

```json
{"force": true}
```

- Body parsing is tolerant: absent body, empty body, or `{}` ⇒ `force=false` (the existing client already POSTs `{}` — must keep working unchanged).
- `force=true` **skips the checker-snapshot qualifying check** (`s.updateChecker == nil || !s.updateChecker.Snapshot().Qualifies` → 409 "no update available") but **KEEPS the brew-install 409** (`selfpath.IsBrewInstalled(selfPath)` via the `resolveSelfPathFn` seam).
- The real "is there anything newer" decision is delegated to `rk update` itself — it is idempotent and exits "already up to date" harmlessly when nothing newer exists (same no-in-flight-lock rationale as 4zap's second-click behavior).
- `force=false` path is byte-identical to today: brew 409 → qualify 409 → 202 + spawn.
- Response stays `202 {"status":"updating"}` on the force path.
- Note: the brew 409 also covers `dev` builds server-side (a dev binary never lives under `/Cellar/run-kit/`), so no separate dev guard is needed on this endpoint.

### 2. Backend — new `POST /api/restart` (USER-DECIDED)

New handler (suggested: `app/backend/api/restart.go`, registered in `router.go` next to the existing `r.Post("/api/update", s.handleUpdate)` at router.go:422). Constitution IX: POST.

- Responds `202` (suggested body `{"status":"restarting"}`, mirroring update's `{"status":"updating"}`) **before** spawning, then spawns a detached `rk daemon restart` — the restart kills this serving process, so the client must get its response first (same accept-before-spawn comment discipline as `handleUpdate`).
- Detached-spawn shape identical to 4zap: `exec.Command(self, "daemon", "restart")`, `SysProcAttr{Setsid: true}`, stdout/stderr appended to a log under `~/.rk/` (suggested: `~/.rk/restart.log`, separate from `update.log`). Deliberately NOT context-bound — same accepted 4zap precedent with its inline justification (a detached child that must outlive the server cannot inherit the request/server context; Constitution I's timeout rule exists to stop a hung subprocess *blocking* the server, and a detached spawn cannot block it; argv is a fixed slice with no user input).
- **NO brew requirement** — restart works for any install method.
- **Dev guard (server-side)**: respond `409` when the running version is `"dev"` — under `just dev` the serve process runs under air, not the daemon; spawning `rk daemon restart` from it would stop/start the *real* daemon, which is never what a dev tab means. Mirrors the palette-side dev gate with defense in depth. `<!-- assumed: server-side 409 on dev version for /api/restart — palette already hides the entry on dev; the guard prevents a curl/stale-tab from bouncing the real daemon out from under a dev process -->`
- No `--force` flag on the spawned `rk daemon restart` (plain stop/start suffices; the daemon just released its own port).
- **Accepted caveat (user-decided)**: if `daemon.Start()` fails after the stop, the web UI is down and SSH is needed — narrow failure window accepted. The `restart.log` makes it diagnosable.

### 3. Backend — generalize the spawn seam (USER-DECIDED)

Rather than duplicating `spawnUpdateFn`, generalize it into a shared spawn-self-subcommand helper, e.g.:

```go
// spawnSelfFn spawns a detached `rk <args...>` child logging to ~/.rk/<logName>.
var spawnSelfFn = func(selfPath string, logName string, args ...string) error { ... }
```

- Same detached shape (Setsid, append-mode log under `~/.rk/`, non-fatal log-open failure, parent-side fd close after `cmd.Start()` dups it).
- Keeps the package-var test seam pattern (tests record `(logName, args)` without spawning). `handleUpdate` calls it with `("update.log", "update")`; `handleRestart` with `("restart.log", "daemon", "restart")`. Exact naming/shape is the implementer's choice — the requirement is ONE helper, two call sites, seam-recordable in tests.

### 4. Backend — boot ID + brew flag on `event: version` (USER-DECIDED)

`app/backend/api/sse.go` `setVersion` / `cachedVersionJSON` payload extends from `{"version":"0.5.3"}` to:

```json
{"version":"0.5.3","boot":"<per-process id>","brew":true}
```

- **`boot`** — per-process identity generated ONCE at startup; in-memory only (Constitution II clean). Suggested: random hex from `crypto/rand` (e.g. 16 hex chars) generated in `serve.go`; a start timestamp was the discussed alternative — either satisfies the design, randomness avoids any clock-granularity collision across fast restarts. `<!-- assumed: random hex boot ID over start timestamp — both discussed as acceptable; random is collision-proof and needs no clock reasoning -->`
- **`brew`** — `selfpath.IsBrewInstalled(...)` computed ONCE at startup in `serve.go` (resolve self path once, compute the boolean) and passed with the version.
- Wiring: `Server.SetVersion` (called at serve.go:113) carries the two extra values — exact signature (extra params vs. a small struct) is implementer's choice; the set-once / replay-on-connect / no-broadcast semantics of the cached slot are unchanged.
- Fields are **additive** — existing client parsing (`data.version`) is unaffected; the slot is still replayed on every SSE connect including `?metrics=1`.

### 5. Frontend — restart-aware reload guard with dev suppression (USER-DECIDED)

`app/frontend/src/contexts/session-context.tsx`:

- Extend the pure predicate (currently `shouldReloadOnVersion(firstSeen, next)`) to remember the first-seen **version AND boot**, and reload when EITHER differs on a later `version` event. Never reload on first connect (first-seen unset) — the existing no-reload-loop invariant holds.
- **DEV GUARD (user-agreed)**: suppress the *boot-based* reload when version is `"dev"` (the `DEV_VERSION` constant already exists in this file) — `air` recompiles the backend on every save during `just dev`, each restart is a new boot ID, and reloading every dev tab on every recompile would be a reload storm. Version-based reload is untouched (a dev version never changes, so this is moot in practice but keeps the predicate honest).
- Coverage this buys: update (version change), plain restart (boot change), every open tab (slot replayed per connect), and restarts initiated from SSH or crash-recovery (the signal is server-originated, not client-action-originated).
- The `version` listener (`applyVersion` callback) parses the new fields tolerantly — a payload without `boot`/`brew` (older daemon during a mixed-version window) must not break.

### 6. Frontend — context, client helpers, palette entries (USER-DECIDED)

**`app/frontend/src/api/client.ts`** — two POST helpers following the `triggerUpdate()` precedent (reject on non-2xx via `throwOnError`):

- `triggerForceUpdate()` → `POST /api/update` with body `{"force":true}`
- `triggerRestart()` → `POST /api/restart` with body `{}`

**SessionContext** exposes:

- the `brew` flag from the version event (default `false` until the first version event arrives — entries stay hidden until the flag is observed)
- `forceUpdateNow()` / `restartNow()` actions wrapping the client helpers (same thin-wrapper shape as `updateNow`)
- surfaced through the tolerant hook pattern (extend `useUpdateNotification()` or a sibling tolerant hook — must not throw outside the provider, mirroring the existing defaults-when-absent contract).

**Palette entries** (USER-DECIDED — palette-only, no new chrome, both fire immediately on select, NO confirmation dialogs):

- **`run-kit: Update Now`** — force update. Visible whenever `brew === true` AND version is not `"dev"`. NOT gated on a qualifying update — works for patch releases and before any check has run.
- **`run-kit: Restart Daemon`** — visible when version is not `"dev"` (no brew requirement).
- The existing qualifying-gated `run-kit: Update to v{latest}` entry stays **unchanged**; slight overlap when an update qualifies is accepted (two static labels beat dynamic ones).
- Built via the pure-builder pattern: extend `app/frontend/src/lib/palette-update.ts` with a new pure builder (suggested: `buildMaintenanceActions(brew, version, onForceUpdate, onRestart)`) alongside `buildUpdateActions` — a sibling file is acceptable if cleaner. `<!-- assumed: new builder co-located in lib/palette-update.ts rather than a new file — same domain, mirrors the existing builder's test surface -->`
- Mounted in **BOTH** `app/frontend/src/app.tsx` (AppShell `updateActions` memo, ~line 1522) and `app/frontend/src/components/board/board-page.tsx` (`boardRouteActions`, builder invoked ~line 463) per the board-palette duplication convention — the L3 top-bar cluster (incl. the update chip) is hidden below `sm`, so board routes on phones need palette parity.
- No dedicated toast/feedback for the two new actions: the SSE drop followed by the boot/version-driven tab reload IS the success feedback; helper rejections are caught (no unhandled-rejection noise). `<!-- assumed: no toast on fire — palette-only surface, reload is the observable outcome; failures land in ~/.rk logs -->`

### 7. Tests (per code-quality.md — new behavior MUST be covered)

- **Go handler tests** (`api/update_test.go`, new `api/restart_test.go`): `force:true` skips the qualify 409 but keeps the brew 409; `force:false`/absent body byte-preserves today's flow; restart returns 202 and the spawn seam records `("restart.log", "daemon", "restart")`; restart 409 on dev version; spawn-failure-after-202 logs without breaking the committed response.
- **SSE test** (`api/sse_test.go` vicinity): extended version payload carries `boot` + `brew`; set-once/replay-on-connect semantics unchanged; empty version still suppresses the slot.
- **Frontend reload-guard unit tests** (session-context colocated tests): boot change → reload; version change → reload (regression); first connect → never; dev version + boot change → suppressed; payload without boot/brew → tolerated.
- **Palette-builder tests** (`lib/palette-update.test.ts`): the two new entries' gating matrix — brew×dev for Update Now, dev for Restart Daemon; existing `buildUpdateActions` gating untouched.
- **Client-helper coverage** (`api/client.test.ts`): force body shape, restart POST, non-2xx rejection.
- **Playwright e2e: best-effort only** (user-decided, same rationale as 4zap — the trigger state is server-originated SSE state that the e2e harness can't drive deterministically).

## Affected Memory

- `run-kit/architecture`: (modify) API endpoints — `POST /api/update` force flag, new `POST /api/restart`, generalized detached spawn-self seam, `event: version` payload extended with `boot` + `brew`, per-process boot ID generated at startup in serve.go
- `run-kit/ui-patterns`: (modify) update-notification cluster — two new palette-only maintenance entries (`run-kit: Update Now`, `run-kit: Restart Daemon`) with brew/dev gating, boot-aware reload guard with dev suppression, brew flag + `forceUpdateNow`/`restartNow` on SessionContext

## Impact

- **Backend**: `app/backend/api/update.go` (force flag, spawn call rewired to shared helper), new `app/backend/api/restart.go` (+ test), `app/backend/api/router.go` (one route line), `app/backend/api/sse.go` (`setVersion` payload), `app/backend/api/server.go` (`SetVersion` signature), `app/backend/cmd/rk/serve.go` (boot ID generation, brew computation, SetVersion call)
- **Frontend**: `app/frontend/src/contexts/session-context.tsx` (reload guard, brew flag, two actions, tolerant hook), `app/frontend/src/api/client.ts` (two helpers), `app/frontend/src/lib/palette-update.ts` (new pure builder + tests), `app/frontend/src/app.tsx` + `app/frontend/src/components/board/board-page.tsx` (mount new entries)
- **No new routes/pages, no chrome, no persistent state, no dependencies.** All mutations POST (Constitution IX); both verbs wrap existing CLI commands (Constitution III); boot ID in-memory only (Constitution II); palette-only surface (IV, V).
- **Compatibility**: additive SSE fields — old clients ignore them; existing `POST /api/update {}` callers unaffected; mixed-version window (new frontend, old daemon payload) tolerated by the parser.

## Open Questions

- None — all material decisions were settled in discussion (user-decided) or graded Confident-or-better via SRAD below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Two palette-only entries (`run-kit: Update Now`, `run-kit: Restart Daemon`), both firing immediately on select, NO confirmation dialogs; existing qualifying-gated `Update to vX` entry unchanged (overlap accepted) | User-decided in discussion — do not re-open | S:95 R:75 A:95 D:95 |
| 2 | Certain | Force semantics via JSON body flag `{"force":true}` on existing `POST /api/update`: skip qualify 409, KEEP brew 409; version decision delegated to idempotent `rk update` | User-decided in discussion — do not re-open | S:95 R:80 A:95 D:90 |
| 3 | Certain | New `POST /api/restart`: 202 then detached `rk daemon restart` spawn (setsid, `~/.rk/` log); no brew requirement; `spawnUpdateFn` generalized into ONE shared spawn-self-subcommand helper; daemon.Start-fails-after-stop window accepted (SSH fallback) | User-decided in discussion — do not re-open | S:95 R:70 A:90 D:90 |
| 4 | Certain | `event: version` payload extended additively to `{"version","boot","brew"}`: boot = per-process startup identity, in-memory only; brew = `selfpath.IsBrewInstalled` computed once at startup in serve.go | User-decided in discussion — do not re-open | S:95 R:80 A:95 D:95 |
| 5 | Certain | Reload guard remembers first-seen version AND boot, reloads when EITHER differs on a later event, never on first connect; boot-based reload suppressed when version is `"dev"` (air recompile storm guard) | User-decided in discussion — do not re-open | S:95 R:80 A:95 D:90 |
| 6 | Certain | Frontend wiring: SessionContext exposes brew flag + `forceUpdateNow()`/`restartNow()`; POST helpers in `api/client.ts`; pure palette builder mounted in BOTH app.tsx and board-page.tsx per duplication convention | User-decided in discussion — do not re-open | S:95 R:85 A:95 D:90 |
| 7 | Certain | Test plan: Go handler tests (force matrix, restart 202+seam, dev 409), SSE payload test, reload-guard unit tests (boot/dev/first-connect), palette-builder gating tests, client-helper coverage; Playwright e2e best-effort only | User-specified in constraints (mirrors 4zap rationale) | S:90 R:85 A:95 D:90 |
| 8 | Confident | Boot ID format: random hex (crypto/rand, ~16 chars) generated once in serve.go — over the discussed start-timestamp alternative | Both named acceptable in discussion; random needs no clock-granularity reasoning; trivially swappable | S:60 R:90 A:85 D:70 |
| 9 | Confident | Restart spawn logs to separate `~/.rk/restart.log`; shared helper parameterizes `(logName, args...)` | Description says "log under ~/.rk/" without naming it; separate log keeps update.log semantics untouched; rename is trivial | S:55 R:95 A:80 D:65 |
| 10 | Confident | Force body parsed tolerantly: absent/empty/`{}` body ⇒ `force=false`, preserving the existing client's `{}` POST byte-for-byte behavior | Existing `triggerUpdate()` already POSTs `{}`; strict parsing would break it; obvious default | S:65 R:85 A:80 D:70 |
| 11 | Confident | `POST /api/restart` additionally 409s when version is `"dev"` (server-side mirror of the palette dev gate); response body `{"status":"restarting"}` | Not explicitly discussed; under `just dev` the serve process is air-managed and `rk daemon restart` would bounce the REAL daemon — guard prevents that; body mirrors update's shape | S:55 R:85 A:75 D:65 |
| 12 | Confident | `SetVersion` seam carries boot+brew (extra params or small struct — implementer's choice); cached-slot set-once/replay semantics unchanged | Mechanical wiring choice behind an internal seam; either shape satisfies the design | S:60 R:85 A:85 D:70 |
| 13 | Confident | New pure builder co-located in `lib/palette-update.ts` (e.g. `buildMaintenanceActions(brew, version, onForceUpdate, onRestart)`) rather than a sibling file | User allowed "extend or a sibling"; same domain + shared test file argues co-location; file split is trivial later | S:65 R:95 A:85 D:60 |
| 14 | Confident | brew flag defaults `false` until the first version event; `Update Now` hidden until `brew===true` observed | Mirrors the existing `qualifies` absent-data-hidden gating; brief hidden window on connect is harmless | S:60 R:90 A:85 D:75 |
| 15 | Confident | No dedicated toast/success feedback for the two new actions — the SSE drop + boot/version-driven reload IS the feedback; helper rejections caught to avoid unhandled-rejection noise | Palette-only surface was user-decided; reload is the observable outcome; adding a toast later is additive | S:50 R:90 A:75 D:60 |

15 assumptions (7 certain, 8 confident, 0 tentative, 0 unresolved).
