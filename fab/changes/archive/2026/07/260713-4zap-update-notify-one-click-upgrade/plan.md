# Plan: Update Notification and One-Click Upgrade

**Change**: 260713-4zap-update-notify-one-click-upgrade
**Intake**: `intake.md`

## Requirements

### Backend: Running-Version Exposure

#### R1: Expose the running daemon version to clients over SSE
The api package SHALL learn the ldflags-injected running version via a setter on `*api.Server` (mirroring `SetWindowChangeSubscriber`/`SetActiveWindowProvider`), and the SSE hub SHALL emit a server-global `event: version` cached slot delivered to every client on connect (including `?metrics=1` metrics-only streams). No `GET /api/version` endpoint SHALL be added. The slot is static for the process lifetime.

- **GIVEN** `rk serve` starts with `version = "0.5.3"`
- **WHEN** `serve.go` calls `apiServer.SetVersion("0.5.3")` and a client opens the SSE stream
- **THEN** the client receives `event: version\ndata: {"version":"0.5.3"}` on connect
- **AND** a `?metrics=1` metrics-only client also receives it on connect

#### R2: The version slot is cache-on-connect only
Because the running version cannot change for the process lifetime, there SHALL be no broadcast/poll path for `event: version` — only the on-connect replay from a single cached slot set once by `SetVersion`.

- **GIVEN** the version slot was set once at startup
- **WHEN** any number of clients connect over the process lifetime
- **THEN** each receives the same cached `event: version` payload on connect, with no per-tick re-broadcast

### Backend: Periodic Update Checker

#### R3: Poll the GitHub Releases API for the latest release
A new package `internal/updatecheck` SHALL fetch `GET https://api.github.com/repos/sahil87/run-kit/releases/latest` (unauthenticated) via a context-bound `net/http` client with a 10s timeout, parse `tag_name`, and normalize by stripping a leading `v`. The HTTP fetch SHALL sit behind a stubbable seam for tests. Fetch/parse errors SHALL log a warning and retain the previous cached result — never crash, never surface to clients.

- **GIVEN** the GitHub API returns `{"tag_name":"v0.6.0"}`
- **WHEN** the checker fetches and parses it
- **THEN** the normalized latest version is `"0.6.0"` cached in memory
- **AND** a fetch error leaves the prior cached result intact and logs a warning

#### R4: Notify only on minor/major increase; suppress dev/unparseable
The checker SHALL compare running vs. latest via a hand-rolled major/minor integer parse (no new dependency) and qualify an update ONLY when latest major > running major, or majors equal and latest minor > running minor. Patch-level differences SHALL never qualify. The entire checker SHALL be suppressed when the running version is the `"dev"` sentinel or is unparseable.

- **GIVEN** running `0.5.3`
- **WHEN** latest is `0.6.0` → qualifies; latest `0.5.9` (patch) → does not qualify; latest `1.0.0` → qualifies
- **AND** running is `"dev"` or unparseable → the checker is suppressed entirely (never fetches, never qualifies)

#### R5: Schedule an initial check then a 6h ticker bound to the serve context
The checker SHALL run one check ~30s after startup, then on a fixed 6h `time.Ticker`, in a goroutine bound to the serve context (exits on `ctx.Done()`).

- **GIVEN** the daemon starts
- **WHEN** ~30s elapse
- **THEN** the first check runs, followed by checks every 6h until `ctx` is cancelled

#### R6: Broadcast a qualifying update as a server-global cached-slot SSE event
When a check qualifies, the checker SHALL invoke a callback (wired in `serve.go`) that calls a new hub method publishing a server-global cached-slot `event: update-available` delivered to all clients (including `?metrics=1`), replayed on connect for late-connecting clients — mirroring `broadcastServerOrder`/`broadcastBoardOrder`.

- **GIVEN** a check qualifies with current `0.5.3`, latest `0.6.0`
- **WHEN** the callback fires
- **THEN** every connected client receives `event: update-available\ndata: {"current":"0.5.3","latest":"0.6.0"}`
- **AND** a client connecting afterwards receives the cached payload on connect

### Backend: Update Trigger Endpoint

#### R7: `POST /api/update` validates then spawns a detached upgrade
A new handler registered in `router.go` SHALL, per Constitution IX (POST): (1) resolve the daemon's own executable path (`os.Executable` + `EvalSymlinks`) and require the `/Cellar/run-kit/` marker, returning `409` with a JSON error body when not brew-installed; (2) require the checker's cached state to show a qualifying newer version, else `409` ("no update available"); (3) respond `202 Accepted` and then spawn a detached `rk update` process (`exec.Command(resolvedSelfPath, "update")` with `SysProcAttr{Setsid: true}`, stdout/stderr redirected to `~/.rk/update.log`). The spawn SHALL sit behind a package-level fn seam for tests (per the `runBrewFn`/`restartDaemonFn` idiom).

- **GIVEN** the daemon is brew-installed and an update qualifies
- **WHEN** `POST /api/update` is called
- **THEN** it responds `202` and spawns a detached `rk update` via the seam
- **AND** not brew-installed → `409`; no qualifying update → `409`

#### R8: Second-click idempotency is acceptable without an in-flight lock
A second `POST /api/update` while an update is in flight SHALL be permitted to spawn another `rk update` (which exits harmlessly once brew reports "already up to date"). No in-flight lock is required.

- **GIVEN** an update was already triggered
- **WHEN** `POST /api/update` is called again while still qualifying
- **THEN** it responds `202` again (no lock, no error)

### Frontend: SSE Consumption & Auto-Reload

#### R9: Consume `version` and `update-available` on every stream
`SessionContext` SHALL add listeners for `event: version` and `event: update-available` on both the per-server pool streams and the dedicated `?metrics=1` stream (server-global — applied idempotently, like `server-order`/`board-order`), track the daemon version and `{current, latest}` in state, and expose them plus an `updateNow()` trigger and per-version `dismissUpdate()` through context.

- **GIVEN** the SSE stream delivers `event: version` and `event: update-available`
- **WHEN** either arrives on any stream (per-server or `?metrics=1`)
- **THEN** the context state updates idempotently and the values are exposed to consumers

#### R10: Reload the stale tab when the daemon version changes after a restart
The context SHALL remember the first `version` seen and call `location.reload()` only when a subsequent `version` event (after SSE reconnect post-restart) differs from the remembered one — never on first connect, so there are no reload loops.

- **GIVEN** the tab first saw version `0.5.3`
- **WHEN** after a daemon restart a later `version` event reports `0.6.0`
- **THEN** the tab reloads exactly once
- **AND** the first `version` event on a fresh connect never triggers a reload

### Frontend: Update Chip & Palette

#### R11: Top-bar L3 update chip with one-click trigger and per-version dismiss
`top-bar.tsx` SHALL render a small chip in the always-visible L3 right cluster (leading the notification→theme→refresh→help+dot run), in-app only (no Web Push). Rest state shows `⬆ v{latest}` with accent styling and CRT-glint hover (`rk-glint`). Clicking the chip body SHALL trigger `POST /api/update` and enter a disabled `updating…` state. A small `✕` affordance SHALL dismiss per-version, persisted in localStorage keyed `runkit-update-dismissed` = the latest version string. The chip SHALL be hidden when no qualifying update exists, when dismissed for the current latest, or when the daemon reports the `dev` version.

- **GIVEN** a qualifying update to `0.6.0` and no dismissal
- **WHEN** the top bar renders
- **THEN** the chip shows `⬆ v0.6.0`; clicking it POSTs `/api/update` and disables into `updating…`
- **AND** clicking `✕` writes `runkit-update-dismissed=0.6.0` and hides the chip; a later `0.7.0` re-shows it
- **AND** the chip is hidden when the daemon version is `dev`

#### R12: Command-palette parity for update and dismiss
`app.tsx` SHALL register an AppShell-level palette action `run-kit: Update to v{latest}` (gated on a qualifying un-updated state, ignoring chip dismissal) alongside a `run-kit: Dismiss Update Notice` action mirroring the chip's `✕`.

- **GIVEN** a qualifying update exists
- **WHEN** the command palette opens
- **THEN** `run-kit: Update to v0.6.0` is present even if the chip was dismissed, and `run-kit: Dismiss Update Notice` mirrors the chip's dismiss

### Non-Goals
- No Web Push for update notices (explicitly excluded — push is reserved for waiting agents).
- No `GET /api/version` endpoint (SSE connect is the signal — R1).
- No new pages/routes, no database, no new Go dependency (Constitution II/IV).
- No tap-formula pre-verification; the release-vs-formula race window is accepted (a premature click yields "already up to date" from `rk update`).

### Design Decisions
1. **Version state lives in `SessionContext`**: it already owns the server-global SSE pool and the `?metrics=1` stream, and both `version`/`update-available` are server-global like `server-order`/`board-order`. — *Why*: reuses the exact fan-out + cached-on-connect precedent; avoids a second context. — *Rejected*: a dedicated context (needless duplication of the stream plumbing).
2. **Chip + palette are self-contained consumers of a `useUpdateNotification()` hook** reading `SessionContext`. — *Why*: mirrors `NotificationControl` (self-contained via `usePushSubscription`); avoids threading new props through the whole `TopBar` prop chain and `RootTopBar`. — *Rejected*: prop-drilling through `RootTopBar` → `TopBar`.
3. **Detached spawn, deliberately not `exec.CommandContext`-bound**: `rk update` restarts the daemon (killing the serving process), so the child must outlive the request/server. — *Why*: the Constitution I timeout rule prevents *hung subprocesses blocking the server*; a detached child cannot block it. Argument-slice construction still applies (no user input). — *Rejected*: in-process upgrade (impossible — restart kills the server mid-request).

## Tasks

### Phase 1: Backend — version plumbing

- [x] T001 Add `SetVersion(version string)` on `*api.Server` in `app/backend/api/tmuxctl_bridge.go` (co-located with the other setters) that stores the version and seeds the hub's cached `event: version` slot; add a `cachedVersionJSON string` field + a `setVersion` method on `sseHub` in `app/backend/api/sse.go` that marshals `{"version":...}` once. <!-- R1 R2 -->
- [x] T002 In `addClient` (`app/backend/api/sse.go`), replay the cached `event: version` slot on connect (after sessions/order, alongside metrics/services/server-order/board-order), so every client incl. `?metrics=1` receives it. <!-- R1 R2 -->
- [x] T003 Wire `apiServer.SetVersion(version)` in `app/backend/cmd/rk/serve.go` after `NewRouterAndServer`, using the `main.version` from `root.go`. <!-- R1 -->

### Phase 2: Backend — update checker package

- [x] T004 Create `app/backend/internal/updatecheck/updatecheck.go`: a `Checker` with an in-memory cached `Result{Current, Latest string; Qualifies bool}` under a `sync.RWMutex`, a stubbable `fetchFn func(ctx) (string, error)` seam (default issues the GitHub `/releases/latest` GET via a 10s context-bound `net/http` client and returns the normalized `tag_name`), a pure `parseMajorMinor` helper, a pure `qualifies(current, latest)` predicate (minor/major only, patch never), and `normalizeTag` (strip leading `v`). Suppress entirely when current is `"dev"` or unparseable. Fetch/parse errors retain the last-good result + log a warning. <!-- R3 R4 --> <!-- rework: should-fix — SetFetchForTest mutates fetchFn/suppressed without holding c.mu while the Start goroutine reads them (latent -race trap): guard with the mutex; nice-to-have — rename the local `qualifies :=` that shadows the package-level qualifies func (e.g. isQualifying) -->
- [x] T005 Add `Checker.Start(ctx)` in `updatecheck.go`: an initial check ~30s after start then a fixed 6h `time.Ticker`, goroutine bound to `ctx` (exits on `ctx.Done()`); expose `Snapshot() Result` and an `OnQualify func(current, latest string)` callback fired when a check newly qualifies OR when the qualifying latest version changes. Constants `initialCheckDelay = 30*time.Second`, `checkInterval = 6*time.Hour`, `fetchTimeout = 10*time.Second`. <!-- R5 R6 --> <!-- rework: must-fix — OnQualify fired only on the false→true transition (updatecheck.go:151), so a later NEWER release (0.6.0→0.7.0) never re-fires: the cached SSE update-available slot and chip go stale and the per-version dismissal re-show contract (A-015) can never trigger. Fire when qualifies && (!wasQualifying || latest != prevLatest) — capture prev Latest under the lock -->

### Phase 3: Backend — update-available broadcast + trigger endpoint

- [x] T006 Add `broadcastUpdateAvailable(current, latest string)` on `sseHub` in `app/backend/api/sse.go` (pattern: `broadcastBoardOrder`) publishing a server-global cached-slot `event: update-available` to every client incl. `?metrics=1`, caching `cachedUpdateAvailableJSON`; replay it in `addClient`. Add `SetUpdateChecker` + `WireUpdateAvailableBroadcast` seams on `*api.Server` (`tmuxctl_bridge.go`) exposing the checker snapshot to the update handler and letting `serve.go` wire the `OnQualify` callback to `broadcastUpdateAvailable`. <!-- R6 -->
- [x] T007 Create `app/backend/api/update.go`: `handleUpdate` (POST) — resolve self path via a `resolveSelfPathFn` seam (`os.Executable`+`EvalSymlinks`), require `/Cellar/run-kit/` marker (else `409` JSON error), require the checker snapshot to show `Qualifies` (else `409` "no update available"), respond `202`, then spawn a detached `rk update` via a package-level `spawnUpdateFn` seam (`exec.Command(self, "update")`, `SysProcAttr{Setsid: true}`, stdout/stderr → `~/.rk/update.log`). No in-flight lock (R8). <!-- R7 R8 --> <!-- rework: should-fix — the /Cellar/run-kit/ marker + self-path resolver duplicate cmd/rk/upgrade.go resolveExeFn byte-for-byte (unreachable package main); extract marker const + resolver into a small shared internal/ package consumed by BOTH upgrade.go and update.go so brew-install detection cannot drift -->
- [x] T008 Register `r.Post("/api/update", s.handleUpdate)` in `app/backend/api/router.go`; construct+start the checker in `serve.go` (bound to `ctx`, needs the ldflags version) and inject via `SetUpdateChecker` so the handler reads its snapshot; wire the `OnQualify` callback → `broadcastUpdateAvailable` via `WireUpdateAvailableBroadcast` from `serve.go`. <!-- R6 R7 -->

### Phase 4: Backend — tests

- [x] T009 [P] `app/backend/internal/updatecheck/updatecheck_test.go`: table test for semver compare + `qualifies` (major/minor/patch/equal/dev/unparseable/tag-normalization), scheduler `OnQualify` firing via a stubbed `fetchFn`, and fetch-failure retention. <!-- R3 R4 R5 R6 --> <!-- rework: add a second-release re-fire test — after 0.6.0 qualifies and fires, a later check returning 0.7.0 MUST re-fire OnQualify with the updated latest (and an unchanged 0.6.0 must NOT re-fire) -->
- [x] T010 [P] `app/backend/api/update_test.go`: handler tests constructing `*Server` directly — `202` records the spawn seam, `409` not-brew (marker absent), `409` no-update (snapshot not qualifying), `409` nil-checker, second-click 202 (R8), using the exe/spawn seams + `SetFetchForTest`/`CheckOnceForTest`. <!-- R7 R8 -->
- [x] T011 [P] SSE tests in `app/backend/api/sse_test.go` asserting `event: version` replays on connect (incl. `?metrics=1`) + empty-when-unset, and a cached `event: update-available` fans out + replays on connect (pattern: existing board-order/server-order cached-replay assertions). <!-- R1 R2 R6 -->

### Phase 5: Frontend — SSE consumption + state

- [x] T012 In `app/frontend/src/contexts/session-context.tsx`: added `daemonVersion` + `updateAvailable` + `updateDismissedVersion` to `SessionContextType` + state; added `event: version` / `event: update-available` listeners on BOTH the per-server pool ES and the dedicated `?metrics=1` ES (server-global, no `data.server` filter); exposed `updateNow()` (calls the client POST) + `dismissUpdate()` (localStorage `runkit-update-dismissed`); added the tolerant `useUpdateNotification()` hook; updated `StandaloneSessionContextProvider` defaults. <!-- R9 -->
- [x] T013 Added the reload guard in `session-context.tsx`: a `firstVersionRef` + the pure `shouldReloadOnVersion(firstSeen, next)` predicate; `applyVersion` reloads once when a later `version` differs; never on first connect. <!-- R10 -->
- [x] T014 [P] Added `triggerUpdate(): Promise<void>` POST helper for `/api/update` in `app/frontend/src/api/client.ts` (pattern: `refreshPrStatus`/`initTmuxConf`). <!-- R7 R11 -->

### Phase 6: Frontend — chip + palette

- [x] T015 Added an `UpdateChip` component in `app/frontend/src/components/top-bar.tsx` (self-contained, reading `useUpdateNotification`), rendered in the L3 right cluster leading `NotificationControl`. Rest = `⬆ v{latest}` accent + `rk-glint` hover; click body → `updateNow()` → disabled `updating…` + error toast on failure; `✕` → `dismissUpdate()`. Hidden when no qualifying update, dismissed-for-latest, or daemon version is `dev`. <!-- R11 --> <!-- rework: must-fix — busy label at top-bar.tsx:1675 is raw JSX text containing the escape sequence backslash-u2026 (`<span>updating…</span>`); JSX text does NOT process JS escapes, so the UI visibly renders the six literal characters "…" after "updating". Fix: wrap in a JS string expression like the sibling `{"✕"}` — i.e. `{"updating…"}` — or put the literal `…` character in the JSX text; also normalize the UpdateChip JSDoc —/⬆ escape text to real characters (nice-to-have, same file) -->
- [x] T016 Registered the palette actions in `app/frontend/src/app.tsx` (an `updateActions` block via the pure `buildUpdateActions` helper in `lib/palette-update.ts`, folded into `paletteActions`): `run-kit: Update to v{latest}` (gated on qualifying state, ignoring dismissal) + `run-kit: Dismiss Update Notice` (mirrors the chip `✕`). <!-- R12 --> <!-- rework: should-fix — fold buildUpdateActions(...) into the board route's boardRouteActions (board-page.tsx) per the ui-patterns board-palette duplication convention: below `sm` the L3 cluster (and chip) is hidden, so a phone user on /board/$name currently has NO update surface -->

### Phase 7: Frontend — tests

- [x] T017 [P] Vitest unit tests in `app/frontend/src/components/update-chip.test.tsx`: chip render / hide-by-gate (no-update / dev / dismissed-latest) / re-show-for-newer / click-triggers-updateNow+updating / failure-toast / ✕-dismiss, plus reload-guard predicate tests (`shouldReloadOnVersion`: first-connect no-reload, unchanged no-reload, differing reload). <!-- R10 R11 --> <!-- rework: add a rendered-TEXT assertion for the busy state — update-chip.test.tsx:130 asserts only the aria-label, so a garbled visible label ('updating…' as literal chars) slips through; assert the visible text is `updating…` -->
- [x] T018 [P] Palette-action tests in `app/frontend/src/lib/palette-update.test.ts` asserting `run-kit: Update to v…` + `run-kit: Dismiss Update Notice` are built under a qualifying state (with correct ids/labels + wiring), and are empty when not qualifying / dev / dismissal-ignored. <!-- R12 -->

## Execution Order

- T001 → T002 → T003 (version plumbing is sequential; all in the api/serve seam).
- T004 → T005 (checker Start depends on the Checker type/predicates).
- T006 depends on T005 (broadcast wired to the checker callback) and the hub cached-slot pattern from T002.
- T007 depends on T005 (reads the checker snapshot); T008 wires T006/T007 into the router.
- Phase 4 tests (T009–T011) depend on their subjects (T004–T008) but are `[P]` among themselves.
- T012 → T013 (reload guard extends the version listener); T014 is independent `[P]`.
- T015/T016 depend on T012 (context state/hooks); T017/T018 depend on T015/T016.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `*api.Server.SetVersion` exists and the hub emits `event: version\ndata: {"version":"..."}` to every client (incl. `?metrics=1`) on connect.
- [x] A-002 R2: No broadcast/poll path for `event: version` — it is a single cached slot set once by `SetVersion`, replayed only on connect.
- [x] A-003 R3: `internal/updatecheck` fetches `/releases/latest` via a 10s context-bound `net/http` client behind a stubbable seam, normalizes `tag_name` (strips `v`), and retains last-good + logs a warning on fetch/parse error.
- [x] A-004 R4: The qualify predicate notifies only on minor/major increase (patch never) and suppresses entirely for `"dev"`/unparseable running versions.
- [x] A-005 R5: The checker runs an initial check ~30s after start then every 6h in a `ctx`-bound goroutine that exits on cancellation.
- [x] A-006 R6: A qualifying check fires `OnQualify` → `broadcastUpdateAvailable`, delivering a server-global cached-slot `event: update-available\ndata: {"current":...,"latest":...}` to all clients (incl. `?metrics=1`), replayed on connect. *(Rework cycle 1 fixed the newly-qualifying-only gate: `checkOnce` now re-fires when a still-qualifying check reports a different latest — `updatecheck.go:163` — covered by `TestCheckOnceRefiresOnNewerRelease`.)*
- [x] A-007 R7: `POST /api/update` returns `202` and spawns a detached `rk update` (setsid, log → `~/.rk/update.log`) via a seam; returns `409` when not brew-installed and `409` when no qualifying update.
- [x] A-008 R8: A second `POST /api/update` while qualifying returns `202` again with no in-flight lock and no error.
- [x] A-009 R9: `SessionContext` exposes `daemonVersion` + `updateAvailable` + `updateNow()`/`dismissUpdate()`, populated by `version`/`update-available` listeners on both the per-server and `?metrics=1` streams (server-global, idempotent).
- [x] A-010 R10: The reload guard reloads exactly once when a later `version` differs from the first-seen version, and never on first connect.
- [x] A-011 R11: The L3 chip shows `⬆ v{latest}`, click → `POST /api/update` + `updating…`, `✕` → per-version `runkit-update-dismissed` localStorage dismissal; hidden on no-update / dismissed-latest / `dev`. *(Met after rework cycle 2: the busy label at `top-bar.tsx:1675` is now the JS string expression `{"updating\u2026"}` — the escape is processed as a JS string, so the chip renders a real `…` — and `update-chip.test.tsx:133` asserts the exact visible text `updating…` (frontend suite green, 63 files / 1090 tests). Trigger, disable-while-updating, failure-toast re-enable, `✕` dismiss, and all three hide gates re-verified on this fresh cycle-2 review.)*
- [x] A-012 R12: The palette registers `run-kit: Update to v{latest}` (dismissal-ignoring, qualification-gated) and `run-kit: Dismiss Update Notice`.

### Behavioral Correctness

- [x] A-013 R4: Given running `0.5.3`, latest `0.5.9` does NOT qualify (patch) while `0.6.0` and `1.0.0` DO qualify (verified by table test).
- [x] A-014 R10: A first `version` event on a fresh connect does not reload; only a subsequent differing `version` does (no reload loop).
- [x] A-015 R11: Dismissing `0.6.0` hides the chip; a later `update-available` for `0.7.0` re-shows it (localStorage key is per-version). *(Met end-to-end after rework cycle 1: `checkOnce` now re-fires `OnQualify` when a still-qualifying check reports a different latest (`updatecheck.go:159–165`, `TestCheckOnceRefiresOnNewerRelease` asserts 0.6.0→0.7.0 re-fires and an unchanged 0.7.0 does not), refreshing the cached SSE slot; the frontend per-version gate (`showChip = qualifies && latest !== updateDismissedVersion`) is unit-tested by the "re-shows for a newer latest even after an older dismissal" case in `update-chip.test.tsx`.)*

### Scenario Coverage

- [x] A-016 R3: `updatecheck` fetch-failure retention is exercised by a unit test (stubbed `fetchFn` returning an error leaves the prior snapshot intact).
- [x] A-017 R7: The `202`/`409`(not-brew)/`409`(no-update) branches of `handleUpdate` are each exercised by a handler test using the exe/spawn/checker seams.
- [x] A-018 R1: A cached-replay-on-connect assertion covers `event: version` (and `event: update-available`) for a connecting client (incl. the `?metrics=1` path where testable).

### Edge Cases & Error Handling

- [x] A-019 R3: Fetch/parse errors never crash the daemon and never reach clients (warning-logged, last-good retained).
- [x] A-020 R7: The detached spawn is deliberately not `exec.CommandContext`-bound (a detached child must outlive the server) yet uses an explicit argument slice with no user input (Constitution I honored).

### Code Quality

- [x] A-021 Pattern consistency: New code follows the surrounding patterns — setter idiom (`SetWindowChangeSubscriber`), cached-slot broadcast idiom (`broadcastBoardOrder`), package-level fn seams (`runBrewFn`/`resolveExeFn`), self-contained top-bar control (`NotificationControl`), and client POST helper idiom (`refreshPrStatus`).
- [x] A-022 No unnecessary duplication: Reuses `internal/prstatus`/collector precedents, the existing SSE fan-out + cached-on-connect machinery, and `parseBrewVersion`-style JSON parsing rather than adding a semver dependency. *(One should-fix: `resolveSelfPathFn` + the Cellar marker duplicate `upgrade.go`'s `resolveExeFn` — unreachable cross-package (`package main`), flagged for extraction.)*
- [x] A-023 Security (exec/injection): The `rk update` spawn uses `exec.Command` with an explicit argument slice and no user-provided input; the GitHub fetch is a context-bound `net/http` GET, not a subprocess. No shell strings.
- [x] A-024 No new dependencies / no database: hand-rolled semver compare (no new module) and in-memory-only checker state (Constitution II).
- [x] A-025 Uniform HTTP verb: `/api/update` is a POST (Constitution IX); no new GET version endpoint (Constitution IV minimal surface).
- [x] A-026 Test companion docs: Any new `.spec.ts` ships its `.spec.md` companion (per constitution). If only unit tests (`*.test.ts`/`*_test.go`) are added, no companion is required. *(Only unit tests added — no `.spec.ts`, so no companion required.)*

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Playwright e2e is best-effort (intake Assumption 17): the update events originate from a live server-side GitHub call, so unit-level coverage is the required floor. No `.spec.ts` is planned unless the SSE stream can be exercised cheaply; unit tests carry the floor.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (`rk update` / `upgrade.go` is wrapped as-is, not superseded; no prior version-exposure or update-notification surface existed to retire. The cycle-1 consolidation — `upgrade.go`'s inline self-path resolver + `/Cellar/run-kit/` marker duplicated in `update.go` — remains resolved via the shared `internal/selfpath` package (`selfpath.Resolve` / `selfpath.IsBrewInstalled` / `selfpath.CellarMarker`) consumed by both entry points. Re-affirmed on the cycle-2 fresh review: no existing code became redundant; the one piece of newly-dead state found (`api.Server.version` at `router.go:81` — write-only, never read) is *new* code in this change, reported as a review should-fix finding rather than a deletion candidate.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Version state, `update-available` state, and the reload guard all live in `SessionContext` (it owns the server-global SSE pool + `?metrics=1` stream); `version`/`update-available` are handled on both stream kinds like `server-order`/`board-order` | Intake §4 names `session-context.tsx` and the `server-order` precedent (`session-context.tsx:505–522`); reuses the exact fan-out | S:90 R:80 A:90 D:85 |
| 2 | Certain | `POST /api/update` returns `202` then spawns a detached `rk update` (setsid) behind a `spawnUpdateFn` package-var seam; `409` for not-brew and no-update; not `exec.CommandContext`-bound | Intake §3 + Assumptions 6/14/15 user-decided; the `runBrewFn`/`resolveExeFn` seams already exist in `upgrade.go` | S:90 R:75 A:90 D:90 |
| 3 | Certain | Hand-rolled major/minor int semver compare in `internal/updatecheck`; patch never qualifies; suppress on `dev`/unparseable | Intake Assumption 2/10 user-decided; repo already hand-parses versions (`parseBrewVersion`) with no semver dep | S:90 R:85 A:90 D:90 |
| 4 | Confident | The chip + palette are self-contained consumers of a new `useUpdateNotification()` hook reading `SessionContext`, rather than props threaded through `RootTopBar`→`TopBar` | `NotificationControl` sets the self-contained precedent (`usePushSubscription`); avoids widening the already-large `TopBar` prop chain and the tolerant-empty `RootTopBar` shape | S:65 R:80 A:80 D:70 |
| 5 | Confident | The checker is constructed + `Start(ctx)`-ed in `NewRouterAndServer` (next to the metrics/prstatus collectors) and held on `*Server`; the `OnQualify`→`broadcastUpdateAvailable` callback + `SetVersion` are wired from `serve.go` | `NewRouterAndServer` is the established collector-start site; `serve.go` is where `version` and post-supervisor setters already live | S:60 R:85 A:80 D:70 |
| 6 | Confident | `event: version`/`event: update-available` are single cached slots on `sseHub` (`cachedVersionJSON`/`cachedUpdateAvailableJSON`) replayed in `addClient`, mirroring `cachedServerOrderJSON`/`cachedBoardOrderJSON` | Direct structural match to the two existing server-global cached slots in `sse.go` | S:75 R:85 A:85 D:80 |
| 7 | Confident | `updateNow()` posts via a new `triggerUpdate()` client helper; the chip's `updating…` disabled state is local component state (no server-reported progress) — recovery is the SSE-reconnect version change → reload guard | Intake §5 describes exactly this flow; no progress channel exists, so a local disabled flag is the only signal until reconnect | S:60 R:85 A:80 D:70 |
| 8 | Confident | Backend tests are Go unit (`updatecheck`) + handler (`update_test.go`) + SSE cached-replay; frontend is Vitest (chip render/hide/dismiss + reload guard) + palette registration; Playwright e2e is best-effort/omitted | Intake Assumption 17 + code-quality.md scopes e2e to "where possible"; SSE-origin state from a live GitHub call is expensive to mock end-to-end | S:60 R:90 A:80 D:70 |

8 assumptions (3 certain, 5 confident, 0 tentative).
