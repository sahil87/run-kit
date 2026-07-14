# Intake: Update Notification and One-Click Upgrade

**Change**: 260713-4zap-update-notify-one-click-upgrade
**Created**: 2026-07-13

## Origin

> Notify run-kit web-UI users when a new minor/major version is available, with a one-click "Update" action that upgrades the brew-installed daemon and restarts it.

Created via promptless dispatch from a synthesized description that captures a prior design discussion. The discussion pre-resolved the major decision points (detection source, notify threshold, transport, surfaces, dismissal, trigger endpoint, reload loop, race-window acceptance) — those are recorded as Certain assumptions below with rationale "Discussed — user decided", not re-opened. Verified repo context from that discussion (release pipeline, `rk update` internals, SSE cached-slot precedents, ldflags version injection) was re-confirmed against the working tree before this intake was written.

## Why

1. **Pain point**: run-kit ships via git-tag-driven releases (`scripts/release.sh` → `.github/workflows/release.yml` → GitHub Release + Homebrew tap `sahil87/tap/run-kit`), but the running daemon has no idea a newer version exists and the web UI never shows it. The operator only discovers updates by remembering to run `rk update` in a shell. In practice the daemon lingers on stale versions for weeks.
2. **Consequence if unaddressed**: improvements and bug repairs sit unused on the tap; the primary interaction surface (the web UI, often reached from a phone/tablet over Tailscale where no shell is handy) gives no signal and no remedy — the whole update loop requires SSH.
3. **Why this approach**: the upgrade path already exists and works — `rk update` (`app/backend/cmd/rk/upgrade.go`) does Homebrew detection, version check, `brew upgrade`, and daemon restart via `daemon.RestartWithBinary`. Per Constitution III (Wrap, Don't Reinvent) the web action wraps that CLI rather than reimplementing it. Detection uses the GitHub Releases API instead of `brew update`+`brew info` on a schedule because the brew pair is heavyweight and mutates global brew state every run; a single unauthenticated JSON GET every 6h is effectively free (rejected alternative, user-decided). Tmux sessions survive the daemon restart (Constitution VI), so one-click restart is safe.

## What Changes

### 1. Backend — expose the running version over SSE

The running version (ldflags-injected `main.version`, `app/backend/cmd/rk/root.go:11`, sentinel `"dev"` for local builds) is not exposed anywhere in the HTTP API today. Plumb it into the api package via a setter on `*api.Server` following the existing `SetWindowChangeSubscriber` precedent (`app/backend/cmd/rk/serve.go:103–115`), e.g. `apiServer.SetVersion(version)`.

The SSE hub (`app/backend/api/sse.go`) gains a server-global `event: version` sent to every client on connect — same cached-slot on-connect delivery as `event: server-order` / `event: board-order` (`sse.go:370–390`), including `?metrics=1` streams. Payload:

```
event: version
data: {"version":"0.5.3"}
```

The slot is static for the process lifetime (set once from `SetVersion`), so no broadcast path is needed for it — only the on-connect replay. No new `GET /api/version` endpoint (minimal surface; SSE connect is exactly the moment the client needs it — see Assumption 9).

### 2. Backend — periodic update checker (`internal/updatecheck`)

New package `app/backend/internal/updatecheck`:

- **Fetch**: `GET https://api.github.com/repos/sahil87/run-kit/releases/latest`, unauthenticated, via `net/http` with a 10-second timeout (context-bound). `/releases/latest` excludes drafts and prereleases. Parse `tag_name` (e.g. `"v0.6.0"`); normalize by stripping the leading `v` (release tags carry `v`, the injected version does not — `displayVersion` adds it for display only).
- **Schedule**: one check shortly after daemon startup (~30s delay so it never competes with boot), then a 6-hour ticker, goroutine bound to the serve context. ~4 requests/day is far under the unauthenticated rate limit (60/hr/IP).
- **Compare**: hand-rolled major/minor semver comparison (parse `X.Y.Z` into ints — no new dependency). Notify **only** when latest major > running major, or majors equal and latest minor > running minor. Patch-level differences never notify. Suppress the entire checker when the running version is the `"dev"` sentinel or unparseable (user-decided).
- **Failure handling**: fetch/parse errors log a warning and keep the previous cached result; never crash, never surface to clients.
- **State**: latest known result cached in memory only (ephemeral derived state — no database, no file, Constitution II).
- **Broadcast**: when an update qualifies, invoke a callback wired in `serve.go` that calls a new hub method (pattern: `broadcastServerOrder` / `broadcastBoardOrder`, `sse.go:456–533`) publishing a server-global cached-slot event delivered to all clients including `?metrics=1`, replayed on connect for late-connecting clients:

```
event: update-available
data: {"current":"0.5.3","latest":"0.6.0"}
```

### 3. Backend — `POST /api/update` trigger

New handler (e.g. `app/backend/api/update.go`), registered in `router.go`. POST per Constitution IX. Behavior:

1. **Validate brew install**: resolve the daemon's own executable path (`os.Executable` + `EvalSymlinks`) and require the `/Cellar/run-kit/` marker — the same detection `rk update` uses (`upgrade.go:88`). Not brew-installed → `409` with a JSON error body explaining the manual path.
2. **Validate an update is pending**: the checker's cached state must show a qualifying newer version → otherwise `409` ("no update available").
3. **Respond `202 Accepted`**, then spawn a **detached** `rk update` process: `exec.Command(resolvedSelfPath, "update")` with `SysProcAttr{Setsid: true}` (own session/process group, not tied to the server process lifetime), stdout/stderr redirected to `~/.rk/update.log`. The upgrade cannot run in-process because `rk update` restarts the daemon, which kills the serving process mid-request (user-decided). Note: this is a detached long-lived child, deliberately not `exec.CommandContext`-bound — the Constitution I rule exists to prevent hung subprocesses blocking the server, and a detached spawn cannot block it; argument-slice construction and input validation still apply (there is no user-provided input here).
4. **Idempotency**: a second click while an update is in flight spawns another `rk update`, which exits harmlessly with "already up to date" after brew resolves — acceptable, no in-flight lock.

**Accepted race window** (user-decided): a GitHub Release exists a few minutes before the tap-formula CI lands; a click in that window makes `rk update` report "already up to date". No formula pre-verification.

### 4. Frontend — SSE consumption + auto-reload

In `app/frontend/src/contexts/session-context.tsx`, add listeners for `version` and `update-available` on the same streams that handle `server-order` (server-global: identical on every stream, apply idempotently; `session-context.tsx:505–522` precedent).

- `version`: track the daemon version in state. **Reload guard**: remember the first version seen; when a subsequent `version` event (i.e. after SSE reconnect post-restart) differs from the remembered one, `location.reload()` — the new binary embeds new frontend assets, the open tab is stale (user-decided). No reload on first connect; only on an observed change, so no reload loops.
- `update-available`: store `{current, latest}` in state, exposed to the chip and palette.

### 5. Frontend — top-bar chip (L3 right cluster)

A small chip in `app/frontend/src/components/top-bar.tsx`'s always-visible L3 right cluster (leading the notification→theme→refresh→help+connection-dot run). In-app only — explicitly NO Web Push (user-decided; Web Push exists for waiting agents, update notices must not buzz phones).

- **Rest state**: `⬆ v0.6.0` (accent styling, CRT-glint hover per the button hover vocabulary).
- **Click**: one-click trigger — `POST /api/update`, chip enters a disabled `updating…` state; the daemon restart then drops SSE, reconnect delivers the new `version`, and the reload guard refreshes the page.
- **Dismiss**: a small `✕` affordance on the chip. Dismissal is per-version, persisted in localStorage keyed by the latest version string (e.g. `runkit-update-dismissed` = `"0.6.0"`), no server state (user-decided). A later release with a different version string re-shows the chip.
- Hidden entirely when no qualifying update, when dismissed for the current latest, or when the daemon reports the `dev` version.

### 6. Frontend — command-palette action

Keyboard-first parity (Constitution V): an AppShell-level palette action in `app/frontend/src/app.tsx` (alongside `viewActions`), label `run-kit: Update to v0.6.0`, gated on a qualifying un-updated state. The palette action ignores chip dismissal (dismissal silences the ambient chip; the palette is deliberate discovery). A companion `run-kit: Dismiss Update Notice` action mirrors the chip's `✕` for keyboard users.

### 7. Tests

- **Go**: `internal/updatecheck` unit tests (semver compare table: major/minor/patch/dev/unparseable/tag-normalization; scheduler callback firing; fetch-failure retention) with the HTTP fetch behind a stubbable seam; `api/update_test.go` handler tests (202 spawn-seam recorded, 409 not-brew, 409 no-update — spawn behind a package-level fn seam per the `runBrewFn`/`restartDaemonFn` idiom in `upgrade.go`); SSE test asserting `version` + cached `update-available` replay on connect (pattern: `boards_test.go:552` board-order assertions).
- **Frontend**: Vitest unit tests for the chip (render/hide/dismiss/localStorage) and reload guard; palette action registration test alongside existing `command-palette` tests. Playwright e2e only if the SSE stream can be exercised without heavy mocking — the update events originate server-side from a live GitHub call, so unit-level coverage is the required floor and e2e is best-effort (see Assumption 17). Any new `.spec.ts` ships its `.spec.md` companion.

## Affected Memory

- `run-kit/architecture`: (modify) new `internal/updatecheck` package, `POST /api/update` endpoint, server-global `event: version` + `event: update-available` cached-slot SSE broadcasts, version plumbing into `api.Server`
- `run-kit/ui-patterns`: (modify) top-bar L3 update chip (one-click trigger + per-version localStorage dismissal), `run-kit: Update…` palette actions, SSE-reconnect version-change auto-reload

## Impact

- **Backend**: `app/backend/internal/updatecheck/` (new), `app/backend/api/update.go` (new), `app/backend/api/sse.go` (two new server-global events), `app/backend/api/router.go` (route + Server field), `app/backend/cmd/rk/serve.go` (wire version + checker). `rk update` / `upgrade.go` unchanged — reused as-is.
- **Frontend**: `app/frontend/src/contexts/session-context.tsx` (listeners + state), `app/frontend/src/components/top-bar.tsx` (chip), `app/frontend/src/app.tsx` (palette actions), `app/frontend/src/api/client.ts` (POST helper). New localStorage key `runkit-update-dismissed`.
- **No new dependencies**, no database, no new pages/routes (Constitution II, IV). External surface: one unauthenticated GitHub API GET every 6h.

## Open Questions

- None — every decision point was either user-decided in the originating discussion or resolved as a graded assumption below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Detection runs in the backend daemon via `GET https://api.github.com/repos/sahil87/run-kit/releases/latest` (unauthenticated) on startup + every ~6h; brew-based detection rejected as heavyweight/state-mutating | Discussed — user decided, including the rejected alternative | S:95 R:70 A:90 D:95 |
| 2 | Certain | Notify only on minor/major increase; patch never notifies; suppress entirely for `"dev"` or unparseable running version | Discussed — user decided the exact threshold | S:95 R:85 A:95 D:95 |
| 3 | Certain | Check result cached in memory only and broadcast as a server-global `event: update-available` via the existing cached-slot pattern (replayed on connect, all clients incl. `?metrics=1`) | Discussed — user decided; pattern verified at `sse.go:456–533` | S:90 R:75 A:95 D:90 |
| 4 | Certain | In-app notification only — no Web Push; surfaces are a top-bar L3 chip + a command-palette action | Discussed — user decided explicitly (update notices must not buzz phones) | S:95 R:80 A:90 D:95 |
| 5 | Certain | Per-version dismissal persisted in localStorage keyed by the latest version string; no server state | Discussed — user decided | S:90 R:90 A:90 D:90 |
| 6 | Certain | Trigger is `POST /api/update`: validate (brew marker + update pending), respond `202`, spawn a detached `rk update` (setsid, own process group) | Discussed — user decided, including why in-process is impossible (restart kills the serving process) | S:90 R:70 A:85 D:90 |
| 7 | Certain | Running version exposed to the frontend; after daemon restart the SSE reconnect sees a different version → auto-reload the stale tab | Discussed — user decided the reload loop | S:85 R:70 A:85 D:85 |
| 8 | Certain | Release-vs-tap-formula race window accepted: a click before the formula CI lands yields "already up to date"; no formula pre-verification | Discussed — user decided | S:95 R:90 A:90 D:95 |
| 9 | Confident | Version exposure mechanism: server-global `event: version` cached slot sent on every SSE connect; no new `GET /api/version` endpoint | User left "SSE and/or GET" open; SSE-only is minimal-surface (Constitution IV) and the reconnect is exactly the signal the reload loop needs — a GET adds nothing the client would poll <!-- assumed: SSE-only version exposure, no GET /api/version --> | S:70 R:80 A:75 D:65 |
| 10 | Confident | Semver comparison is a hand-rolled major/minor int parse in `internal/updatecheck` — no new dependency | ~20 lines + table test; repo has no semver dep and hand-parses brew JSON already (`parseBrewVersion`) | S:60 R:85 A:80 D:70 |
| 11 | Confident | Cadence detail: first check ~30s after startup, then a fixed 6h `time.Ticker`, goroutine bound to the serve context | User said "on startup + every ~6h"; exact delay/ticker shape is implementation choice, trivially adjustable | S:65 R:90 A:80 D:75 |
| 12 | Confident | Chip UX: chip click = one-click update trigger, small `✕` = dismiss; dismissal hides the chip but the palette action remains | "One-click" implies the chip is the trigger; keeping palette past dismissal preserves keyboard-first recoverability (Constitution V) | S:60 R:85 A:75 D:60 |
| 13 | Certain | GitHub fetch via `net/http` client with 10s timeout — not a subprocess | Constitution I / process-execution rules target subprocesses; a context-bound HTTP client is the idiomatic Go equivalent and cannot hang the server | S:70 R:90 A:90 D:85 |
| 14 | Confident | Detached spawn mechanics: `exec.Command(resolvedSelfPath, "update")`, `SysProcAttr{Setsid: true}`, stdout/stderr → `~/.rk/update.log`; deliberately not context-bound (a detached child must outlive the server) | Follows the user-decided setsid requirement; `~/.rk/` is the established daemon-adjacent state dir (push subsystem); log file makes silent failures diagnosable | S:55 R:75 A:75 D:60 |
| 15 | Confident | `POST /api/update` failure semantics: `409` + JSON error body for both "not brew-installed" and "no update available" | Validation-refusal shape; no established project error-code convention forces a choice, easily adjusted in review | S:50 R:90 A:80 D:70 |
| 16 | Confident | Reload guard: remember first-seen version, reload only when a later `version` event differs — never on first connect | Prevents reload loops while implementing the user-decided auto-reload; only sound interpretation | S:60 R:85 A:85 D:80 |
| 17 | Confident | Test scope: Go unit + handler + SSE tests and frontend Vitest tests are the required floor; Playwright e2e is best-effort because the update events originate from a live server-side GitHub call | code-quality.md mandates tests for new behavior but scopes e2e to "where possible"; SSE-origin state is expensive to mock end-to-end | S:60 R:90 A:80 D:70 |

17 assumptions (9 certain, 8 confident, 0 tentative, 0 unresolved).
