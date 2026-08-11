# Intake: Daemon-Managed code-server & the Stable /code Route

**Change**: 260811-a2bo-daemon-code-server-stable-route
**Created**: 2026-08-12

## Origin

Backlog item `[a2bo]` (fab/backlog.md — redesigned 2026-08-12 in conversation with the user, superseding the port-only sketch; the redesigned entry ships in this change). This is the `docs/specs/right-panel.md` § The `code` lens **Topology** follow-up — "a run-kit-managed lifecycle … is a later change" — and it IS that change. Phase 2 (`260811-k3vp`, PR #561) is merged: the `code` lens ships, `just dev` starts code-server on `RK_PORT+2`, and the Homebrew formula declares `depends_on "code-server"`.

> Can we make rk daemon similar to just dev — start code-server on a deterministic port. Then proxy it via the go server, like we do for the react app?

User-confirmed design (2026-08-12): daemon starts code-server on the deterministic port, AND the Go server mounts it on a **stable `/code/*` route** so the port becomes a private implementation detail — the pathname (which code-server keys browser workspace state by) can never change.

## Why

1. **The production gap is real and was hit in practice**: after a release + `rk daemon restart`, code-server is installed (formula dependency) but nothing starts it, and the lens stays dark unless the user hand-runs code-server and hand-sets `RK_CODE_SERVER_PORT`. The end-to-end story — install → daemon start → lens live, zero configuration — is this change (Constitution VII: convention over configuration).
2. **The stable path hardens state identity**: code-server keys browser-side workspace state (tabs/layout, IndexedDB) by the proxy *pathname*. Today's `/proxy/{port}/` blanks every user's workspace if the port ever changes. `/code/` never changes. Migration cost is near-zero — phase 2 is days old.
3. **The frontend contract shrinks**: with `/code/` the client no longer needs the port at all — the iframe src is `/code/?folder=<gitRoot>` always, and the SSE payload needs only `gitRoot` + the reachability signal.

## What Changes

### 1. Daemon half — code-server as a sibling tmux window (`internal/daemon`)

`rk daemon start` additionally launches code-server in its **own tmux window** beside the `rk serve` window on the rk-daemon socket (Constitution VI: tmux-hosted, survives rk server restarts/crashes/deploys; visible and debuggable with plain tmux). Reuse the daemon's existing window-spawn machinery (`runTmuxInDir`/tmuxctl seams — `exec.CommandContext` + argv slices + timeouts, Constitution I).

- **Port resolution (one function, shared with the proxy half)**: `RK_CODE_SERVER_PORT` preset (env/.env.local) wins; otherwise the convention default `RK_PORT+2`. Nothing else configures it.
- **Launch command**: `code-server --bind-addr 127.0.0.1:{port} --auth none`, with `VSCODE_IPC_HOOK_CLI` stripped from the window's environment (inside a VS Code integrated terminal that var flips code-server into `code`-CLI mode — "open in existing instance" → exits with *Please specify at least one file or folder*; the dev.sh lesson, commit 5f02ee06/81f42503 in PR #561). Loopback-only + the rk origin as the trust boundary — same rationale as dev.
- **Idempotency** (every `daemon start`, including the restart path):
  1. window named `code-server` already exists on the daemon socket ⇒ skip silently;
  2. the resolved port already accepts connections ⇒ skip with a note (an externally managed instance is respected — mirrors dev.sh's preset-port carve-out);
  3. `code-server` binary absent ⇒ **warn loudly and continue** — the daemon MUST still bring up `rk serve` (an editor must never block the dashboard); the lens degrades to the existing not-running state and `rk doctor` reports it. (This refines the backlog's "error" wording: hard-failing daemon start over a missing editor is the wrong trade.)
- **`rk daemon stop` leaves code-server RUNNING** — deliberate: server-side terminals and hot-exit state live in that process, and stop/start of the *dashboard* should not tear down the *editor* (the same reason tmux sessions survive, Constitution VI's spirit). Killing it is a manual tmux action in v1; no `--all` flag yet.
- **`rk daemon status`** (if it enumerates windows today) naturally shows the window; no bespoke reporting beyond doctor.

### 2. Proxy half — the stable `/code/*` route (`app/backend/api`)

A dedicated route on the Go server that reverse-proxies `/code/*` to `127.0.0.1:{resolved port}`, **reusing the existing `/proxy/{port}` machinery verbatim** — same `httputil.ReverseProxy` construction, `SetXForwarded()` (code-server's origin check needs `X-Forwarded-Host` matching the browser Origin on WS handshakes), WebSocket passthrough, and a `/code` → `/code/` trailing-slash redirect (relative-base resolution). Prefer extracting the proxy construction into a shared helper over copy-paste (code-quality: no duplicated utilities).

- Route is `GET`-and-WS only — no Constitution IX concern; not a UI route, so no Constitution IV route-set change (`/code/*` is an API-plane path like `/proxy/*`).
- The port never appears in any URL the frontend builds.

### 3. Frontend — `/code/` replaces `/proxy/{port}/`

- `code-surface.tsx`: iframe src becomes `/code/?folder=<encoded gitRoot>` (keep the relative-path discipline — never compose an absolute origin). The not-running empty state text drops the port (it's no longer client-known): e.g. `code-server not running` (+ the doctor hint).
- **SSE payload**: the code-server signal keeps `reachable` and drops `port` (or keeps it emitted-but-unread for one release — apply's call; prefer dropping since both sides ship together). Per-window `gitRoot` unchanged.
- **Availability simplifies**: with the port always resolvable by convention, availability = `gitRoot` derived (the "configured" leg of the phase-2 gate becomes always-true). `availableViews`/`availableSurfaces` signatures simplify accordingly; reachability continues to govern CONTENT only (the not-running state), never the rail button/segment (right-panel.md § Surface Registry semantics, unchanged).
- Palette/switcher/chord surfaces unchanged.

### 4. Dev + e2e harness convergence

- `app/frontend/vite.config.ts`: add a `/code` proxy entry to the backend — `ws: true`, **NO `changeOrigin`** (the Origin-vs-X-Forwarded-Host WS-403 lesson, commit 8ae14ce3).
- `scripts/dev.sh`: unchanged in behavior (starts code-server on `+2` unless `RK_CODE_SERVER_PORT` is preset). The backend resolves the same port by the same rule, so `/code/*` forwards correctly in dev.
- `scripts/test-e2e.sh`: keeps presetting `RK_CODE_SERVER_PORT=3939`; the spec's stub keeps binding it; the backend's `/code/*` now forwards to 3939. The e2e spec updates its iframe-src expectation to `/code/?folder=…` and gains a `/code` → `/code/` redirect assertion.

### 5. Doctor

`rk doctor` gains a code-server check: binary presence, resolved port, reachability. Reported as a normal doctor row (PASS/WARN); absent binary is the WARN case matching § 1.3.

### 6. Docs

- `docs/specs/right-panel.md` § The `code` lens **Topology**: "configured, not managed" → managed lifecycle is now **[current]** (daemon window, convention port, stable `/code/` path, preset-port override).
- `README` + committed `.env`: `RK_CODE_SERVER_PORT` becomes an *override* ("only set this to point rk at an externally managed code-server; by default the daemon runs one on RK_PORT+2 behind /code/").
- Memory (hydrate): `run-kit/architecture` (daemon lifecycle + `/code` route + port resolution), `run-kit/ui-patterns` (src/availability simplification).

### 7. Tests

- **Go**: `internal/daemon` — fake `code-server` on PATH via the `testutil` WriteStub/StubOnPath precedent: started when absent, skipped when window exists, skipped when port listening, warn-and-continue when binary missing, env carries no `VSCODE_IPC_HOOK_CLI`; port-resolution unit tests (preset vs convention). `api` httptest — `/code/*` forwards (headers incl. X-Forwarded-Host), trailing-slash redirect, WS upgrade path shape (mirror the existing proxy tests).
- **Vitest**: availability simplification in `window-view.ts`/`right-panel.ts`; `code-surface` src + empty-state text.
- **Playwright e2e** (`just test-e2e`/`just pw` only; companion `.spec.md` updated in the same commit): existing code-surface spec updated to the `/code/` src expectation; stub mechanics unchanged.

## Affected Memory

- `run-kit/architecture`: (modify) — daemon lifecycle gains the code-server window (idempotency, stop-leaves-running, warn-on-absent); the `/code/*` route beside `/proxy/{port}/*`; the shared port-resolution rule; doctor row.
- `run-kit/ui-patterns`: (modify) — code-surface src `/code/?folder=…`, availability = gitRoot-only, port removed from the client contract.

## Impact

- **Backend**: `internal/daemon` (window spawn + idempotency), `api/router.go` + proxy helper (`/code/*`), `internal/config` (port resolution), doctor. **Frontend**: `code-surface.tsx`, `window-view.ts`, `right-panel.ts`, `session-context` (payload field), vite.config. **Scripts**: test-e2e spec expectations; dev.sh untouched.
- **Risk shape**: daemon start is the sensitive path — every branch must keep `rk serve` coming up (warn-and-continue discipline). The `/code` route reuses proven proxy machinery. The SSE payload field drop is an internal contract change shipped atomically with its only consumer.
- Live daemons: the new behavior lands on the next `rk update` + `daemon restart`; existing `/proxy/{port}/` workspace state is abandoned (days old, accepted).

## Open Questions

- None blocking. (`daemon stop --all` to also kill code-server is explicitly deferred; manual tmux kill covers v1.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Daemon starts code-server in its own tmux window on the rk-daemon socket; `rk serve` restarts never touch it | User-confirmed design; Constitution VI verbatim; the daemon already owns window spawning | S:90 R:85 A:90 D:90 |
| 2 | Certain | Stable `/code/*` route on the Go server, reusing the `/proxy` machinery (SetXForwarded, WS, trailing-slash) | User-confirmed ("proxy it via the go server"); pathname = workspace-state identity (researched 2026-08-11) | S:90 R:80 A:90 D:90 |
| 3 | Certain | Port resolution: preset `RK_CODE_SERVER_PORT` wins, else `RK_PORT+2` convention; one shared function | Constitution VII + the dev.sh/e2e-harness preset contract (commit cc925971) | S:85 R:85 A:90 D:85 |
| 4 | Confident | Absent binary ⇒ warn-and-continue (daemon still starts rk serve); doctor reports it | Refines the backlog's "error" wording — an editor must never block the dashboard; formula makes absence rare | S:70 R:85 A:80 D:70 |
| 5 | Confident | `daemon stop` leaves code-server running; no `--all` flag in v1 | Discussed — server-side terminals + hot-exit live there; killing is deliberate; recommendation not objected to | S:70 R:85 A:75 D:65 |
| 6 | Certain | Idempotency: window-exists ⇒ silent skip; port-listening ⇒ note + skip; per-start re-entrant | Backlog verbatim; mirrors dev.sh's externally-managed carve-out | S:85 R:85 A:85 D:85 |
| 7 | Certain | Launch env strips `VSCODE_IPC_HOOK_CLI`; `--bind-addr 127.0.0.1:{port} --auth none` | The shipped dev.sh lesson (code-CLI mode trap); same trust-boundary rationale | S:90 R:90 A:95 D:90 |
| 8 | Confident | Frontend drops the port from the SSE payload (both sides ship atomically); src = `/code/?folder=<gitRoot>` | Internal contract, single consumer, one release; the stable path is the point of the change | S:70 R:75 A:85 D:75 |
| 9 | Confident | Availability simplifies to gitRoot-derived (the "configured" leg is always true by convention); reachability still content-only | Follows from #3; right-panel.md § Surface Registry availability-vs-reachability semantics preserved | S:70 R:80 A:80 D:70 |
| 10 | Certain | Vite gains a `/code` entry with `ws: true` and NO `changeOrigin` | Commit 8ae14ce3's documented WS-403 lesson | S:90 R:90 A:95 D:95 |
| 11 | Certain | e2e keeps the 3939 stub via the preset-port contract; spec expectations move to `/code/` | scripts/test-e2e.sh + code-surface.spec.ts already structure this; harness contract proven by cc925971 | S:85 R:90 A:90 D:85 |
| 12 | Certain | Go tests use the `internal/testutil` stub-on-PATH precedent for a fake code-server; httptest mirrors the existing proxy tests | testutil WriteStub/StubOnPath shipped for exactly this shape (260731-4404) | S:85 R:90 A:90 D:90 |
| 13 | Confident | Doctor gains a code-server row (presence, port, reachability) | Backlog lists it; doctor already has the row idiom; low-effort | S:65 R:90 A:80 D:70 |
| 14 | Certain | Spec/README/.env updated: managed lifecycle becomes [current]; `RK_CODE_SERVER_PORT` documented as an override | right-panel.md § Topology names this exact change; docs follow shipped truth | S:85 R:90 A:90 D:90 |

14 assumptions (9 certain, 5 confident, 0 tentative, 0 unresolved).
