# Intake: Right Panel Phase 2 — Code Lens & CODE Surface

**Change**: 260811-k3vp-right-panel-code-lens
**Created**: 2026-08-11

## Origin

Backlog item `[k3vp]` (fab/backlog.md), created 2026-08-11 from the right-panel design discussion — phase 2 of 3 in `docs/specs/right-panel.md` § Phasing. Phase 1 (rail + panel shell + `web` surface) shipped and **merged** as PR #552 (`260811-2r1w-right-panel-shell-web-surface`); this change builds directly on its shipped code. Phase 3 (`@rk_owner` companions + `agents` surface, backlog `[w7qc]`) remains out of scope.

> Right panel phase 2 — `code` lens + CODE surface. GOAL: embed code-server as a full lens in the window-views View Registry (reachable via `?view=code` in the main slot AND as the panel's CODE surface). Availability derived (Constitution X): git root derivable from the active pane's cwd AND a configured code-server endpoint. v1 is CONFIGURED, NOT MANAGED. Keyed by git root. Proxy prerequisites spiked and proven 2026-08-11.

Two technical spikes and source research (2026-08-11, recorded in the backlog entry and `docs/specs/right-panel.md`) de-risked this change before intake — their findings are reproduced in § What Changes so the apply agent needs no external context.

## Why

1. **The editor/diff surface is the highest-value panel content** (right-panel.md § The Problem): an operator watching an agent edit a worktree currently leaves run-kit entirely (separate editor, separate diff tool) to see what changed. Embedding code-server puts tabs, syntax highlighting, git gutters, the SCM view, and side-by-side diffs BESIDE the live agent terminal — without building any editor functionality (wrap, don't reinvent; Constitution III in spirit).
2. **If we don't build it**: the phase-1 panel stays a single-surface shell, and "what did the agent just change" keeps costing a context switch out of the dashboard.
3. **Why now**: every unknown that could sink this approach was spiked 2026-08-11 and resolved — WebSocket passthrough works through the proxy, the one hard blocker (origin-check 403) has a proven one-line fix, the feared service-worker collision is benign, and code-server's relative-base design fits run-kit's prefix-stripping proxy exactly. What remains is wiring, not research.

## What Changes

### 1. Proxy prerequisites (backend, `app/backend/api/proxy.go`) — spiked, proven

Three changes, all verified against a live rk instance + code-server source on 2026-08-11:

1. **`r.SetXForwarded()` in the Rewrite hook** (proxy.go `Rewrite` func, ~lines 45–56, beside the existing `r.Out.Host = target.Host`). Without it, code-server's `authenticateOrigin` (its src/node/http.ts) compares the browser's `Origin` header host against `Forwarded` → `X-Forwarded-Host` → `Host` and **403s every WebSocket handshake and POST**. Browsers omit `Origin` on same-origin GETs, so the symptom is "editor loads, then sits disconnected forever" — NOT an obvious error. The fix was proven with a patched replica proxy: upstream then sees `X-Forwarded-Host: <rk host>`, matching the Origin. Works over Tailscale (the forwarded host comes from the inbound Host).
2. **Redirect `/proxy/{port}` → `/proxy/{port}/`** (router or handler level). Relative-base apps resolve `./x` against `/proxy/` without the trailing slash. Currently masked because `toProxySrc` (iframe-window.tsx:127–135) always appends a path — the redirect makes the proxy safe for any client.
3. **`allow-downloads` in the iframe sandbox** (iframe-window.tsx:116) or VS Code file downloads break.

Verified NON-issues (do not re-litigate; regression evidence exists): WS upgrade passthrough works through `httputil.ReverseProxy` (101 + bidirectional frames proven; upgrade headers are re-added before the Rewrite hook runs); the Content-Length rewrite bug is fixed with tests (proxy_test.go:120/152/201); code-server computes a RELATIVE base per request depth (its base-path patch), so prefix-stripping is its documented happy path — `--abs-proxy-base-path` is NOT relevant; no `X-Frame-Options`/`frame-ancestors`; the auth cookie is deliberately sub-path-scoped and SameSite-satisfied same-origin; **the service worker is benign** — `Service-Worker-Allowed: /` is a ceiling, not a claim; the registration requests a base-relative scope (`./` → `/proxy/{port}/`), so run-kit's root-scope `/sw.js` Web Push worker is NOT evicted. Eyeball the registered scope in devtools (Application → Service Workers) on the first live run.

### 2. Backend: configuration + derived availability (Constitution II/X — derive, don't store)

- **Config**: a `RK_CODE_SERVER_PORT` environment variable (`.env` / `.env.local`, Constitution IV's config convention). Unset ⇒ the feature is off everywhere (no rail button, no switcher segment). The value is a **port** (not a URL) because the embed rides the same-origin relative `/proxy/{port}/` path — a full URL would bypass the proxy and break same-origin. **The port is state identity**: code-server keys browser-side workspace state (open tabs/layout, IndexedDB) by the proxy *pathname*, so a port that drifts across restarts silently blanks every user's workspace. Document this beside the env var.
- **Per-window git root**: derive the active pane's cwd → git toplevel server-side (an `exec.CommandContext` `git -C <cwd> rev-parse --show-toplevel` with timeout, or reuse existing repo-root derivation — `internal/config` `FindGitRoot` exists and api/riff.go already derives repo root from a session's active-pane cwd; follow that precedent). Keyed by git root, NOT window id and NOT raw cwd: editor state follows the code, agents `cd` constantly, and two windows on one worktree deliberately share one editor state.
- **Reachability probe**: a cheap TTL-cached TCP/HTTP probe of `127.0.0.1:{port}` (piggyback the existing poll cadence; never a per-request dial). Reachability governs the panel's CONTENT state, not availability (see § 4).
- **SSE window payload**: new derived fields — a per-window `gitRoot` (empty when the cwd is not a repo) and a host-level `codeServerPort`/reachability signal (host-scoped, so it can ride the existing metrics/hello frame instead of per-window duplication if that fits the payload shape better — apply's call). No DB, no pushed state, nothing stored (Constitution II/X).

### 3. Frontend: `code` joins the lens registry + the CODE surface

- **`window-view.ts`**: `ViewName` gains `"code"`; `availableViews` includes it when the window's `gitRoot` is present AND the code-server port is configured; `resolveView` falls through unchanged (unknown/unavailable → tty). The main slot renders it via `?view=code` and the shared switcher grows a segment (window-views.md R4) — the registry row is exactly what the spec § The `code` lens commits to.
- **`right-panel.ts`**: `SurfaceName` gains `"code"`; `availableSurfaces` mirrors the view gate. The rail gains the code button (same availability-dot treatment as `web`); `Panel: Code` palette entry beside `Panel: Web`; `View: Code` beside the existing view entries (Constitution V parity).
- **Renderer**: an iframe of `/proxy/{port}/?folder=<absolute git root>` (code-server restores per-folder state from the folder param). This is a NEW lean component (e.g. `code-surface.tsx`), NOT `IframeWindow` — the URL bar is `@rk_url` substrate state and is meaningless here (the URL is fully derived); the component is an iframe + the not-running empty state. Reuse `toProxySrc`'s relative-path discipline (never compose an absolute origin).
- **Not-running empty state**: when the port is configured but unreachable, the surface renders a terse monospace empty state ("code-server not running on :{port}") instead of a dead iframe. When the port is unset or no git root derives, the surface is simply unavailable (no button, no segment).
- **Panel rules inherited from phase 1** (all shipped, no rework): P3 hide-never-unmount (the code iframe keeps tabs/scroll across collapse), P6 one-surface-at-a-time (opening `code` swaps out `web` in place), P1 persistence (`?panel=code` deep links + the value-bearing per-window key), desktop-only gate.

### 4. Availability vs reachability (resolves a spec-internal tension)

`docs/specs/right-panel.md` says both "available when … configured and reachable" (§ Surface Registry) and "renders 'not running' when unreachable" (§ The code lens) — if reachability gated availability, the not-running state could never render. This change resolves it as: **availability = port configured AND git root derived** (stable capability signals — the button/segment render, users can discover the feature); **reachability = content state** (live iframe vs the not-running empty state — a fluctuating signal that shouldn't strobe the rail). Amend the spec's § Surface Registry row to match as part of this change.

### 5. Keyboard-capture spike (in-change, time-boxed)

Focus inside the code-server iframe swallows run-kit chords (`⌘K` collides with VS Code's own). Same-origin makes an escape hatch possible: a capture-phase `keydown` listener attached to `iframe.contentDocument` (after load) that intercepts run-kit's registry chords before VS Code's keybinding service sees them, re-dispatching to the parent handler. Unproven pattern — spike it inside this change: if it works, wire the registry chords; if it doesn't, ship without chord-reclaim, document the limitation in memory, and leave the escape as click-out (spec Open Question 1 gets its answer either way). The spike must not block the rest of the change.

### 6. Tests

- **Go**: httptest coverage for the proxy changes — `X-Forwarded-Host` present on proxied requests (including the upgrade path's header set), the trailing-slash redirect, existing rewrite tests stay green. Unit coverage for the git-root derivation (temp repo fixture) and the config read.
- **Vitest**: `window-view.ts` (code availability/fall-through), `right-panel.ts` (surface gate), renderer empty-state branch.
- **Playwright e2e** (`just test-e2e` / `just pw` only, isolated :3020; companion `.spec.md` per constitution): code-server itself is NOT installable in the test env — run a **stub HTTP server** on the configured port (the `RK_CODE_SERVER_PORT` the test backend reads) and assert: rail button + switcher segment appear only when the window's cwd is a git repo AND the port is configured; the panel iframe's `src` is the relative `/proxy/{port}/?folder=<git root>` shape; the not-running empty state renders when the stub is down; `?view=code` and `?panel=code` both resolve; availability absent on a non-repo cwd window. Mutating-route mocks need trailing `*` (withServer appends `?server=`).

## Affected Memory

- `run-kit/ui-patterns`: (modify) — the `code` lens registry row (switcher segment, `?view=code`), the CODE surface (renderer, availability vs reachability split, not-running state), palette entries, keyboard-capture outcome.
- `run-kit/architecture`: (modify) — proxy `SetXForwarded` + trailing-slash redirect semantics, `RK_CODE_SERVER_PORT` config, the git-root/reachability derivation and its SSE payload fields.

## Impact

- **Backend**: `api/proxy.go` (+tests), router (redirect), the window-payload builder in `internal/sessions`/`api/sse.go` (gitRoot + code-server fields), `internal/config` (env read). All exec via `exec.CommandContext` + timeouts (Constitution I); everything derived at request time (II/X).
- **Frontend**: `src/lib/window-view.ts`, `src/lib/right-panel.ts`, `src/app.tsx` (surface content composition), `src/components/view-switcher.tsx` (segment), new `src/components/code-surface.tsx`, `src/components/iframe-window.tsx` (sandbox attr only), `src/lib/keybindings.ts`/palette (entries), plus the spike.
- **Docs**: `docs/specs/right-panel.md` § Surface Registry amendment (availability vs reachability).
- **Risk shape**: the proxy edits touch a shared code path (every `/proxy/` consumer) — the existing regression tests plus the new header/redirect tests are the guard. The keyboard spike is isolated. No route changes, no DB, no new endpoints (redirect aside).

## Open Questions

- None blocking. The keyboard-capture question is deliberately an in-change spike (§ 5) with a defined fallback, not a pre-condition.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Phase 2 scope only: `code` lens + surface + proxy prerequisites; `@rk_owner`/agents ([w7qc]) and rk-managed code-server lifecycle stay out | Spec § Phasing + backlog entries; discussed and settled | S:95 R:90 A:95 D:95 |
| 2 | Certain | `r.SetXForwarded()` + trailing-slash redirect + `allow-downloads` are the complete proxy prerequisite set | Spiked 2026-08-11 against live rk + code-server source; fix proven with a replica proxy | S:90 R:85 A:90 D:90 |
| 3 | Confident | Config = `RK_CODE_SERVER_PORT` env var (port, not URL); unset ⇒ feature off | Constitution IV (env-var config convention); the same-origin `/proxy/{port}/` embed needs exactly a port; a URL would bypass the proxy | S:75 R:80 A:85 D:75 |
| 4 | Certain | Keyed by git root (not window id, not raw cwd); URL = `/proxy/{port}/?folder=<git root>` | Spec § The code lens verbatim; persistence research: code-server keys per-folder state on `?folder=` | S:90 R:85 A:90 D:90 |
| 5 | Confident | Availability = port configured AND git root derived; reachability governs CONTENT (not-running empty state); spec § Surface Registry amended to match | Resolves the spec's internal tension (§ 4 above); capability signals should be stable, content states may fluctuate | S:60 R:85 A:70 D:60 |
| 6 | Confident | Renderer is a new lean `code-surface.tsx` (iframe + empty state), not `IframeWindow` | The URL bar is `@rk_url` substrate state — meaningless for a fully-derived URL; IframeWindow reuse would drag inapplicable chrome | S:65 R:85 A:80 D:70 |
| 7 | Certain | `code` is a full View Registry lens: `?view=code` in the main slot + switcher segment, AND the panel surface | Spec § The code lens: "also reachable in the main slot"; window-views R4 registry is open-ended by design | S:85 R:80 A:90 D:85 |
| 8 | Confident | Git-root derivation follows the shipped repo-root precedent (active-pane cwd → `FindGitRoot`-style toplevel, `exec.CommandContext` + timeout, TTL-friendly) | api/riff.go already derives repo root from session active-pane cwd; Constitution I/X | S:70 R:80 A:80 D:70 |
| 9 | Confident | Reachability probe is TTL-cached on the existing poll cadence — never a per-request dial | Code-review rule: no blocking tmux/API ops >5s; a cheap cached probe matches the 5s-cache precedent (fab pane map) | S:65 R:85 A:80 D:70 |
| 10 | Confident | Keyboard capture is an in-change time-boxed spike (capture-phase `contentDocument` listener); failure ⇒ ship without chord-reclaim + document | Spec Open Question 1's stated direction; fallback defined so the spike can't block the change | S:60 R:80 A:70 D:65 |
| 11 | Confident | Layout-per-browser (tabs/layout in IndexedDB) is accepted silently in v1 — no UI callout; documented in memory | Spec Open Question 2; low-stakes, trivially reversible with a later hint; persistence facts already researched | S:60 R:90 A:70 D:65 |
| 12 | Certain | Port stability is documented as state identity beside the env var (drifting port = blank workspace) | Persistence research: browser state keyed by proxy pathname (unique-db patch) | S:85 R:85 A:85 D:85 |
| 13 | Certain | E2E uses a stub HTTP server on the configured port (code-server not installable in CI); asserts availability gating, iframe src shape, not-running state; companion `.spec.md`; `just` recipes only | Project testing norms + constitution Test Companion Docs; phase-1 e2e precedent | S:85 R:90 A:90 D:90 |
| 14 | Certain | Everything derived server-side at request time; no DB, no pushed agent state, no new routes | Constitution II/IV/X — the availability fields are exactly the derived-capability pattern phase 1 used | S:90 R:85 A:95 D:90 |

14 assumptions (7 certain, 7 confident, 0 tentative, 0 unresolved).
