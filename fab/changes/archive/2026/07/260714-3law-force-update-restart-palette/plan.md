# Plan: Force Update + Daemon Restart Palette Actions with Boot-Aware Reload

**Change**: 260714-3law-force-update-restart-palette
**Intake**: `intake.md`

## Requirements

### Backend: Force Update Semantics

#### R1: `POST /api/update` accepts a `{"force":true}` body that skips the qualify check
`handleUpdate` SHALL parse a tolerant JSON body: an absent body, empty body, or `{}` MUST decode to `force=false` (byte-preserving the existing `triggerUpdate()` client's `{}` POST). When `force=true`, the handler MUST skip the checker-snapshot qualifying 409 (`s.updateChecker == nil || !Snapshot().Qualifies`) but MUST KEEP the brew-install 409. The response stays `202 {"status":"updating"}` and spawns the detached upgrade.

- **GIVEN** a brew-installed daemon with no qualifying update pending
- **WHEN** `POST /api/update` is called with body `{"force":true}`
- **THEN** the handler returns `202 {"status":"updating"}` and spawns `rk update`
- **AND** the same request with `{"force":false}`, `{}`, empty, or absent body returns `409 "no update available"` (today's behavior, byte-identical)

#### R2: The brew-install 409 is preserved on the force path
A non-brew install MUST still receive `409` on `POST /api/update` regardless of the `force` flag (the brew 409 also covers dev builds server-side — a dev binary never lives under `/Cellar/run-kit/`).

- **GIVEN** a non-brew-installed daemon
- **WHEN** `POST /api/update` is called with `{"force":true}`
- **THEN** the handler returns `409` and does NOT spawn `rk update`

### Backend: Restart Endpoint

#### R3: `POST /api/restart` restarts the daemon via a detached `rk daemon restart`
A new handler (registered next to `/api/update`) MUST respond `202 {"status":"restarting"}` BEFORE spawning a detached `rk daemon restart` (the restart kills the serving process, so the client must get its response first). It MUST have NO brew requirement. Spawn logs to `~/.rk/restart.log`, separate from `update.log`. POST per Constitution IX.

- **GIVEN** a running (non-dev) daemon of any install method
- **WHEN** `POST /api/restart` is called
- **THEN** the handler returns `202 {"status":"restarting"}` and spawns `rk daemon restart` via the shared spawn seam recording `("restart.log", "daemon", "restart")`
- **AND** a spawn failure after the 202 is logged but does not alter the committed response

#### R4: `POST /api/restart` 409s on the `dev` version
When the running version is `"dev"`, `POST /api/restart` MUST return `409` and MUST NOT spawn (defense-in-depth: under `just dev` the serve process runs under air, and `rk daemon restart` would bounce the real daemon).

- **GIVEN** a daemon running the `"dev"` version
- **WHEN** `POST /api/restart` is called
- **THEN** the handler returns `409` and does NOT spawn `rk daemon restart`

### Backend: Shared Spawn Seam

#### R5: `spawnUpdateFn` is generalized into one shared spawn-self-subcommand helper
The `spawnUpdateFn` package-var seam SHALL be replaced by ONE shared helper parameterized by `(logName, args...)`, preserving the detached shape (Setsid, append-mode log under `~/.rk/`, non-fatal log-open failure, parent-side fd close after `cmd.Start()`) and the package-var test-seam pattern (tests record `(logName, args)` without spawning). `handleUpdate` calls it with `("update.log", "update")`; `handleRestart` with `("restart.log", "daemon", "restart")`.

- **GIVEN** the shared spawn helper seam
- **WHEN** `handleUpdate` or `handleRestart` triggers a spawn
- **THEN** exactly one helper is invoked with the call-site's `(logName, args...)` and tests can record them without launching a process

### Backend: Version Event Payload

#### R6: `event: version` payload carries `boot` and `brew` additively
The cached `event: version` slot SHALL extend from `{"version":"..."}` to `{"version":"...","boot":"<per-process id>","brew":<bool>}`. `boot` is a per-process identity generated ONCE at startup (random hex from `crypto/rand`), in-memory only. `brew` is `selfpath.IsBrewInstalled` computed ONCE at startup in `serve.go`. Fields are additive: the set-once / replay-on-connect / no-broadcast semantics of the cached slot are unchanged, and an empty version still suppresses the slot.

- **GIVEN** a daemon that has called `SetVersion` with version + boot + brew
- **WHEN** any SSE client (including `?metrics=1`) connects
- **THEN** it receives `event: version` with `{"version","boot","brew"}` on connect
- **AND** an empty version leaves the slot empty (no `event: version` sent)

### Frontend: Restart-Aware Reload Guard

#### R7: The reload guard reloads on version OR boot change, with dev boot-suppression
The pure predicate SHALL remember the first-seen version AND boot, and reload when EITHER differs on a later `version` event. It MUST never reload on first connect (first-seen unset). The boot-based reload MUST be suppressed when the version is `"dev"` (air recompile storm guard); version-based reload is untouched. The `version` listener MUST parse `boot`/`brew` tolerantly — a payload without them (older daemon) must not break.

- **GIVEN** a tab that has seen version `v` boot `b1`
- **WHEN** a later `version` event arrives with the same version but boot `b2`
- **THEN** the tab reloads (unless version is `"dev"`, in which case it does not)
- **AND** a version change always reloads (regression); a first connect never reloads; a payload without `boot`/`brew` is tolerated

### Frontend: Client Helpers, Context, Palette Entries

#### R8: `api/client.ts` exposes `triggerForceUpdate()` and `triggerRestart()`
Two POST helpers following the `triggerUpdate()` precedent SHALL be added: `triggerForceUpdate()` → `POST /api/update` body `{"force":true}`; `triggerRestart()` → `POST /api/restart` body `{}`. Both reject on a non-2xx via `throwOnError`.

- **GIVEN** the client helpers
- **WHEN** `triggerForceUpdate()` / `triggerRestart()` are called
- **THEN** they POST the correct URL + body and reject on a non-2xx response

#### R9: SessionContext exposes `brew`, `forceUpdateNow()`, `restartNow()`
SessionContext SHALL expose the `brew` flag from the version event (default `false` until the first version event) and thin-wrapper actions `forceUpdateNow()` / `restartNow()`. These MUST be surfaced through a tolerant hook (extend `useUpdateNotification()` or a sibling) that does not throw outside the provider, mirroring the defaults-when-absent contract.

- **GIVEN** the SessionProvider has observed a version event with `brew:true`
- **WHEN** a consumer reads the tolerant hook
- **THEN** `brew` is `true` and `forceUpdateNow`/`restartNow` invoke the client helpers
- **AND** outside a provider the hook returns safe defaults (`brew:false`, no-op-resolve actions) without throwing

#### R10: Two palette-only maintenance entries with brew/dev gating, mounted in both palettes
A pure builder SHALL produce `run-kit: Update Now` (force update — visible when `brew===true` AND version not `"dev"`) and `run-kit: Restart Daemon` (visible when version not `"dev"`; no brew requirement). Both fire immediately on select with NO confirmation dialog. The existing qualifying-gated `run-kit: Update to v{latest}` entry stays unchanged. The builder MUST be mounted in BOTH `app.tsx` (AppShell) and `board-page.tsx` (board palette) per the board-palette duplication convention. No dedicated toast/feedback — the SSE drop + boot/version reload IS the feedback; helper rejections are caught.

- **GIVEN** `brew===true` and version is not `"dev"`
- **WHEN** the command palette is opened (AppShell or board route)
- **THEN** both `run-kit: Update Now` and `run-kit: Restart Daemon` appear; selecting fires the action immediately
- **AND** on `dev` version neither entry appears; when `brew===false`, `Restart Daemon` still appears but `Update Now` does not

## Tasks

### Phase 1: Backend — Spawn Seam + Force Update

- [x] T001 In `app/backend/api/update.go`, generalize `spawnUpdateFn` into ONE shared spawn-self-subcommand helper `spawnSelfFn(selfPath, logName string, args ...string) error` (Setsid, append-mode `~/.rk/<logName>` via a generalized `openRkLog(logName)`, non-fatal log-open failure, deferred parent-side fd close). Rewire `handleUpdate` to call it with `("update.log", "update")`. <!-- R5 -->
- [x] T002 In `app/backend/api/update.go`, add tolerant JSON body parsing to `handleUpdate` (absent/empty/`{}` ⇒ `force=false`) and gate the qualify-check 409 behind `!force`, KEEPING the brew 409 unconditional. Response + spawn unchanged. <!-- R1 R2 -->

### Phase 2: Backend — Restart Endpoint

- [x] T003 Create `app/backend/api/restart.go` with `handleRestart`: 409 when the running version is `"dev"`; else `202 {"status":"restarting"}` BEFORE spawning `spawnSelfFn(selfPath, "restart.log", "daemon", "restart")`; NO brew requirement; spawn-failure-after-202 logged only. Add a `Server` field carrying the running version for the dev guard (reuse the value already passed to `SetVersion`). <!-- R3 R4 -->
- [x] T004 In `app/backend/api/router.go`, register `r.Post("/api/restart", s.handleRestart)` next to the existing `/api/update` route (~router.go:424). <!-- R3 -->

### Phase 3: Backend — Version Payload (boot + brew)

- [x] T005 In `app/backend/api/sse.go`, extend `setVersion` to accept `(version, boot, brew)` and marshal `{"version","boot","brew"}` into `cachedVersionJSON` (empty version still suppresses the slot; additive fields). Update the doc comment. <!-- R6 -->
- [x] T006 In `app/backend/api/tmuxctl_bridge.go`, extend `Server.SetVersion` to accept `(version, boot string, brew bool)`, store version on the Server (for the restart dev guard, T003), and forward all three to `h.setVersion`. <!-- R6 R4 -->
- [x] T007 In `app/backend/cmd/rk/serve.go`, generate a per-process boot ID once (random hex via `crypto/rand`), compute `brew` once (`selfpath.IsBrewInstalled(resolved-self-path)`), and pass `(version, boot, brew)` to `apiServer.SetVersion(...)`. <!-- R6 -->

### Phase 4: Backend — Tests

- [x] T008 [P] In `app/backend/api/update_test.go`, adapt the seam helper for the generalized `spawnSelfFn` (record `(logName, args)`), add force-matrix tests: `force:true` skips qualify 409 but keeps brew 409; `force:false`/`{}`/absent body byte-preserves today's 409/202 flow. <!-- R1 R2 R5 -->
- [x] T009 [P] Create `app/backend/api/restart_test.go`: restart returns 202 and the spawn seam records `("restart.log", "daemon", "restart")`; restart 409 on dev version (no spawn); spawn-failure-after-202 logs without breaking the committed 202. <!-- R3 R4 R5 -->
- [x] T010 [P] In `app/backend/api/sse_test.go`, extend the version-slot test: payload carries `boot` + `brew`; set-once/replay-on-connect semantics unchanged; empty version still suppresses the slot. <!-- R6 -->

### Phase 5: Frontend — Client + Context + Reload Guard

- [x] T011 In `app/frontend/src/api/client.ts`, add `triggerForceUpdate()` (`POST /api/update` body `{"force":true}`) and `triggerRestart()` (`POST /api/restart` body `{}`), both rejecting on non-2xx via `throwOnError`. <!-- R8 -->
- [x] T012 In `app/frontend/src/contexts/session-context.tsx`, extend `shouldReloadOnVersion` to a boot-aware predicate (remember first-seen version AND boot; reload when EITHER differs; suppress boot-based reload on `dev`; never on first connect). Extend `applyVersion` + both `version` SSE listeners to parse `boot`/`brew` tolerantly, track `brew` state (default `false`), and add `forceUpdateNow`/`restartNow` actions + `brew` to the context value, the standalone provider defaults, and the tolerant `useUpdateNotification()` hook. <!-- R7 R9 -->

### Phase 6: Frontend — Palette Builder + Mounts

- [x] T013 In `app/frontend/src/lib/palette-update.ts`, add a pure `buildMaintenanceActions(brew, version, onForceUpdate, onRestart)` builder returning `run-kit: Update Now` (gated `brew && version!=="dev"`) and `run-kit: Restart Daemon` (gated `version!=="dev"`). <!-- R10 -->
- [x] T014 Mount `buildMaintenanceActions` in `app/frontend/src/app.tsx` (AppShell `updateActions` memo area, ~line 1522) reading `brew`/`daemonVersion`/`forceUpdateNow`/`restartNow` from the hook, with the same toast-on-failure handling as `updateActions`. <!-- R10 -->
- [x] T015 Mount `buildMaintenanceActions` in `app/frontend/src/components/board/board-page.tsx` (`boardRouteActions`, alongside `updateEntries` ~line 463) with the same gating + toast handling, appended to the returned action list and dep array. <!-- R10 -->

### Phase 7: Frontend — Tests

- [x] T016 [P] In `app/frontend/src/lib/palette-update.test.ts`, add `buildMaintenanceActions` gating tests: brew×dev matrix for `Update Now`, dev gate for `Restart Daemon`, action wiring; assert existing `buildUpdateActions` gating untouched. <!-- R10 -->
- [x] T017 [P] In `app/frontend/src/contexts/session-context.test.tsx`, add `shouldReloadOnVersion` boot-aware unit tests: boot change → reload; version change → reload (regression); first connect → never; dev + boot change → suppressed; payload without boot/brew tolerated. <!-- R7 -->
- [x] T018 [P] In `app/frontend/src/api/client.test.ts`, add `triggerForceUpdate` (force body shape) and `triggerRestart` (restart POST) coverage, including non-2xx rejection. <!-- R8 -->

## Execution Order

- T001 blocks T002 (both edit `update.go`; the seam rename precedes the force gate) and T003/T009 (they call `spawnSelfFn`).
- T005 → T006 → T007 (payload signature flows sse.go → tmuxctl_bridge.go → serve.go).
- T006 provides the Server version field the restart dev guard (T003) reads — sequence T005/T006 before or alongside T003; both touch backend seams.
- Phase 4 tests follow their Phase 1-3 implementation. Phase 5 (T012) precedes Phase 6 mounts (T014/T015 read the new hook fields). Phase 7 tests follow.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `POST /api/update` with `{"force":true}` returns 202 + spawns even when no update qualifies; `{"force":false}`/`{}`/empty/absent body byte-preserves today's 409/202 flow.
- [x] A-002 R2: A non-brew install returns 409 on `POST /api/update` regardless of the `force` flag, and does not spawn.
- [x] A-003 R3: `POST /api/restart` returns `202 {"status":"restarting"}` before a detached `rk daemon restart` spawn (recorded as `("restart.log","daemon","restart")`), with no brew requirement.
- [x] A-004 R4: `POST /api/restart` returns 409 and does not spawn when the running version is `"dev"`.
- [x] A-005 R5: One shared `spawnSelfFn(selfPath, logName, args...)` seam backs both `handleUpdate` and `handleRestart`; tests record `(logName, args)` without launching a process.
- [x] A-006 R6: `event: version` carries `{"version","boot","brew"}` on connect for every client (incl. `?metrics=1`); empty version suppresses the slot; set-once/replay/no-broadcast semantics unchanged.
- [x] A-007 R7: The reload guard reloads on a boot change (same version), reloads on a version change (regression), never reloads on first connect, and suppresses the boot-based reload on `dev`.
- [x] A-008 R8: `triggerForceUpdate()` POSTs `/api/update` body `{"force":true}` and `triggerRestart()` POSTs `/api/restart` body `{}`; both reject on non-2xx.
- [x] A-009 R9: SessionContext exposes `brew` (default false), `forceUpdateNow`, `restartNow`; the tolerant hook returns safe defaults outside a provider.
- [x] A-010 R10: `run-kit: Update Now` (brew && !dev) and `run-kit: Restart Daemon` (!dev) appear in BOTH the AppShell and board-route palettes and fire immediately; the existing `Update to v{latest}` entry is unchanged.

### Behavioral Correctness

- [x] A-011 R7: A payload without `boot`/`brew` (mixed-version window: new frontend, old daemon) is tolerated by the parser and does not break the reload guard or brew tracking.
- [x] A-012 R6: `boot` is a fresh per-process random hex on each daemon start (distinct across restarts) and is in-memory only (no persistence).

### Edge Cases & Error Handling

- [x] A-013 R3: A spawn failure after the 202 is logged (`restart.log`/logger) and does not alter the already-committed 202 response.
- [x] A-014 R9: `brew` stays `false` (entries hidden) until the first version event is observed.

### Code Quality

- [x] A-015 Pattern consistency: New Go handlers use `exec.Command` argument slices (no shell strings), the detached spawn keeps its no-context justification comment (Constitution I), and new frontend helpers/actions mirror the `triggerUpdate`/`updateNow` thin-wrapper shape.
- [x] A-016 No unnecessary duplication: The spawn logic is a single shared seam (not duplicated per verb); the palette builder is one pure function mounted twice per the existing duplication convention; `selfpath.IsBrewInstalled` and existing SSE cached-slot machinery are reused, not reinvented.
- [x] A-017 No new routes/pages, no chrome, no persistent state, no dependencies; all mutations POST (Constitution IX); boot ID in-memory only (Constitution II); palette-only surface (Constitution IV/V).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

- `app/frontend/src/components/update-chip.test.tsx:186-198` (`describe("shouldReloadOnVersion (reload guard)")`) — its three cases (first-connect never, unchanged no-reload, version-change reload) are now fully subsumed by the more complete colocated suite added in `session-context.test.tsx` (`shouldReloadOnVersion — boot-aware reload guard`); the block was adapted to the new 4-arg signature instead of being retired, leaving duplicate coverage in the wrong home.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Generalized seam named `spawnSelfFn(selfPath, logName, args...)` with a generalized `openRkLog(logName)` replacing `openUpdateLog`/`updateLogRelPath` | Intake §3 specifies ONE helper, two call sites, seam-recordable; naming is implementer's choice | S:90 R:90 A:90 D:85 |
| 2 | Certain | Restart dev guard reads a running-version field stored on `Server` (populated via the extended `SetVersion`), not a re-read | Intake §2 mandates the server-side dev 409; `SetVersion` is the single startup version seam already wired at serve.go:113 | S:85 R:85 A:90 D:85 |
| 3 | Certain | `SetVersion`/`setVersion` extended to positional params `(version, boot, brew)` rather than a struct | Intake §4 leaves shape to implementer; positional matches the existing single-string signature with least churn | S:80 R:85 A:90 D:80 |
| 4 | Confident | Boot ID = 16 hex chars from `crypto/rand` generated in serve.go | Intake assumption #8 (Confident) — random hex over start-timestamp, collision-proof | S:60 R:90 A:85 D:70 |
| 5 | Confident | New `buildMaintenanceActions` co-located in `lib/palette-update.ts` (not a sibling file) | Intake assumption #13 (Confident) — same domain, shared test file | S:65 R:95 A:85 D:60 |
| 6 | Confident | `brew` + `forceUpdateNow`/`restartNow` surfaced by EXTENDING `useUpdateNotification()` (not a sibling hook) | Intake allows either; extending keeps one tolerant hook the palette mounts already consume, minimizing wiring | S:60 R:85 A:80 D:65 |
| 7 | Confident | Reload-guard predicate signature becomes `shouldReloadOnVersion(firstVersion, firstBoot, nextVersion, nextBoot)` (kept as one exported pure predicate) | Intake §5 says "extend the pure predicate"; a single predicate keeps the existing unit-test seam and export | S:65 R:90 A:85 D:70 |
| 8 | Confident | `boot` state tracked in refs (like `firstVersionRef`) and `brew` in React state (drives palette visibility) | Mirrors the existing firstVersionRef pattern (reload decision) vs. daemonVersion state (render-driving); brew must re-render the palette | S:60 R:85 A:85 D:70 |
| 9 | Confident | Restart 202 body `{"status":"restarting"}` mirroring update's `{"status":"updating"}` | Intake assumption #11 (Confident) — mirrors update's shape | S:60 R:90 A:85 D:70 |

9 assumptions (3 certain, 6 confident, 0 tentative).
