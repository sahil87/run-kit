# Intake: Web Tile Browser Chrome + Polish + Hardening

**Change**: 260819-v6y4-web-tile-browser-chrome
**Created**: 2026-08-19

## Origin

Conversational — the same `/fab-discuss` session that produced the sibling change `260819-ie2i-web-tile-keyboard-find`. A code sweep mapped the Web tile pipeline end-to-end and a research pass compared peer tools (VS Code Simple Browser, Vibe Kanban, Codespaces/code-server, Cursor/Claude Desktop). The user asked for two intakes (this is items 3+4+5 of the discussed improvement list) and, after reviewing a screenshot of the current tile, asked whether visual polish should merge into this intake — the recommendation was yes (same component, same chrome rebuild), and this intake includes it.

> Two intakes: 1+2 and 3+4+5. What about the looks of the WebTile. Any improvements there? Should that be merged with the 2nd intake?

The proposed chrome was then mocked as a static design study and reviewed by the user via `rk present`. The user approved everything with one amendment: **the `>_` switch-to-terminal button is removed** ("not really required"). The approved mock is checked in beside this intake as **`web-tile-chrome-design-study.html`** — it is the visual source of truth for this change (anatomy + six states: proxied rest, address-bar edit, find bar in place, external loading, frame-refusal error, dead-port error).

Key context established during discussion (verified against source by a code sweep):

- The tile (`app/frontend/src/components/iframe-window.tsx`) has an editable URL bar (Enter POSTs `@rk_url` — shared substrate state per window-views spec R7), a reload that bounces through `about:blank` (`iframe-window.tsx:103-115`, losing in-page state), and nothing else: no back/forward, no open-in-browser, no error states.
- External sites that refuse framing (`X-Frame-Options` / CSP `frame-ancestors`) render a **silent blank tile** — no error, no fallback. This is the single biggest user-visible cliff.
- `@rk_url` validation is non-blank only (`app/backend/api/windows.go:373-376`) — even `javascript:` would be accepted; there is no scheme allowlist and no normalization.
- The header host chip (`tileMeta`, `surface-layout.tsx:436-453`) calls `new URL(rkUrl)`, which **throws on relative URLs** (`/proxy/…`, `/present/…`) — so the common `rk present` case renders no meta at all.
- The URL bar displays raw plumbing (e.g. `/present/@320/tmux-version-floor.html?server=runKit&v=…` including the `?v=` cache-buster) with no cleaned display form, no page title, no load indicator.
- `toProxySrc` (`iframe-window.tsx:193-201`) passes absolute URLs through untouched; only relative addresses ride the same-origin proxy. The proxy targets loopback http only (`present.go:111-112`).
- Peer research verdict: header-stripping proxies for arbitrary external sites are a security liability and break on cookies/redirects/absolute URLs — the honest ceiling for a web-served iframe tile is "detect refusal, explain, open externally"; genuinely arbitrary external URLs belong to a (deferred, desktop-only) Electron `WebContentsView` discussion.
- The agent-facing display contract (`docs/site/skill/display.md`) requires relative addresses ("never compose an absolute `{server_url}/proxy/...`") — display-form work must not change what gets stored in `@rk_url`.

## Why

1. **Pain point**: the tile *looks* like a browser but betrays browser muscle memory at every turn — a URL that fails to frame fails silently; reload destroys in-page state; there is no back/forward, no way to pop the page into a real browser, no page title or load feedback; and the address bar shows internal plumbing strings. Separately, the non-blank-only `@rk_url` validation is a latent hole (any client or agent can POST a `javascript:` URL that every viewer's tile will then load).
2. **Consequence if unfixed**: "load any URL" stays a trap — users paste an external URL, get a blank rectangle, and conclude the feature is broken. The tile reads as an internal debug view rather than a browser surface, undercutting the differentiator (most tmux-dashboard peers have no web tile at all).
3. **Why this approach**: every improvement here is frontend chrome plus two small backend seams (validation, a frame-check probe) — no new architecture, no proxy changes, and an explicit rejection of the header-stripping-proxy path that peer tools regret. Visual polish is merged in because it edits the same component the chrome rebuild already restructures; a separate change would guarantee conflicts.

## What Changes

### 1. Fail loudly + escape hatch for external URLs

- **Open in browser ↗** button in the tile's URL-bar row: opens the current address in a new tab (`window.open`; relative addresses resolve naturally against the viewer's origin — the stored `@rk_url` stays relative per the display contract). Also registered as a palette action (e.g. `Web: Open in browser`). This is the universal fallback for anything the tile can't render.
- **Frame-refusal probe**: a small read-only backend endpoint (e.g. `GET /api/frame-check?url=…`) that fetches the URL server-side with a short timeout and reports whether framing is blocked (`X-Frame-Options` present, or CSP `frame-ancestors` excluding the viewer origin) plus the terminal status. Used by the frontend **only for absolute external URLs**. Constraints: http/https only, response body discarded (headers are the payload), bounded redirects, existing exec/HTTP timeout discipline.
- **In-tile error state**: when the probe says the site refuses embedding (or the URL is unreachable), render a proper state in the tile — "this site refuses embedding — Open in browser ↗" / connection-error message — instead of a silent blank iframe.
- **Explicit non-goal**: no header-stripping proxy for arbitrary external sites (security liability, breaks on cookies/redirects/absolute asset URLs).

### 2. Same-origin browser chrome

- **Back / forward** buttons driven by `contentWindow.history.back()/forward()` for same-origin frames; hidden (or disabled with tooltip) for cross-origin. This navigation is **per-viewer** — it never touches `@rk_url`.
- **Real reload**: `contentWindow.location.reload()` for same-origin frames (preserving the frame's current location); the existing `about:blank` bounce remains only as the cross-origin fallback.
- **Current-path display**: as the user navigates inside a same-origin frame, the address bar's display value tracks `contentWindow.location` (read on the frame's `load` events). The R7 substrate/view split is preserved exactly: only an explicit Enter in the address bar POSTs `@rk_url`; in-frame navigation and back/forward are view-local.

### 3. URL bar hardening + normalization

- **Scheme allowlist, enforced backend-side** in the `@rk_url` branch of the window-options handler (`windows.go:373-376`): accept `http:`/`https:` absolute URLs and root-relative paths (`/…`); reject everything else (`javascript:`, `data:`, `file:`, scheme-relative `//…`) with a clear error. The frontend mirrors the check for immediate feedback.
- **Input normalization** on address-bar submit: `localhost:3000` / `127.0.0.1:3000` → `/proxy/3000/` (ride the proxy, matching how the Host page's "Open in window" already addresses ports); bare domain (`example.com`) → `https://example.com`; already-valid values pass through.
- **Fix `tileMeta`** (`surface-layout.tsx:436-453`): stop throwing on relative URLs — derive a display label per address kind (below) so proxied/presented tiles get a header chip too.

### 4. Visual polish (the "looks" pass)

- **Clean display form vs raw edit form**: at rest the address bar shows a pretty, kind-specific form — proxied `/proxy/3000/…` displays as `localhost:3000/…`; presented `/present/@N/file.html?server=…&v=…` displays as the file name (plumbing params `server`/`v` hidden); external URLs display host+path. Focusing the input reveals the raw editable value; click selects all; Escape reverts the edit (existing revert behavior kept).
- **Page title + kind badge in the tile header**: for same-origin frames show `contentDocument.title` next to the `://` glyph instead of the bare "Web" label (falling back to the display form); a small badge distinguishes the three address kinds (proxied port / presented file / external site).
- **Load feedback**: a thin indeterminate progress line at the tile's top edge while the iframe is loading; the area-1 error state renders in-tile when a load fails.
- **⌘L focuses the address bar** while the web tile owns focus (keyboard-first), plus a palette action (`Web: Focus address bar`). Full ⌘L coverage while focus is *inside* the frame arrives via the sibling reclaim change (`260819-ie2i`) — soft dependency only; the tile-level binding works standalone.
- **Visual source of truth**: the checked-in mock `web-tile-chrome-design-study.html` (this change folder) — button order, badge hues (green=present, amber=proxied port, blue=external), display-form examples, error-state copy, and the progress-line treatment follow it. Progress animation zeroes under `prefers-reduced-motion` per the project's animation vocabulary.

### 5. Remove the `>_` switch-to-terminal button

User-directed during mock review: drop the `>_` button from the URL-bar row (`iframe-window.tsx:162-172`) and delete its `onSwitchToTty` prop plumbing. View switching is already owned by the top-bar surface toggles / mobile pinned switch group and the palette — the in-tile duplicate is redundant. The e2e that asserts the `>_` flip performs zero `/options` POSTs retires with the button (its R7 concern — lens switching must not mutate `@rk_type` — is already guaranteed by the surface-toggle path it asserts against).

### Non-goals

- No keyboard reclaim and no find-in-page — that is the sibling change `260819-ie2i-web-tile-keyboard-find`.
- No header-stripping proxy, no proxy.go rewrite changes, no auth on `/proxy` (noted as a standing concern, out of scope here).
- No Electron `WebContentsView` work (deferred; desktop-only path to true arbitrary-URL embedding).
- No change to the `@rk_url` substrate semantics (shared address, R7) or to what agents store there.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) IframeWindow chrome overhaul — URL bar display/edit forms, back/forward, real reload, error states, progress line, title/badge header
- `run-kit/ui/keyboard-and-palette`: (modify) ⌘L claim (web-tile scope) + new palette actions (open in browser, focus address bar)
- `run-kit/architecture`: (modify) new frame-check read endpoint on the REST surface
- `run-kit/tmux-sessions`: (modify) `@rk_url` registry entry gains the scheme-allowlist validation contract

## Impact

- **Frontend**: `app/frontend/src/components/iframe-window.tsx` (major rework), `surface-layout.tsx` (tileMeta fix, header title/badge), `src/api/client.ts` (frame-check call), keybindings + palette registry, URL display/normalization helpers (new, unit-tested pure functions).
- **Backend**: `app/backend/api/windows.go` (`@rk_url` validation), a new read-only frame-check handler + route (`api/router.go`), with `exec`-free stdlib HTTP and the project's timeout discipline; Go tests via `httptest`.
- **Tests**: Go unit tests (validation matrix incl. `javascript:` rejection, frame-check header parsing); Vitest for normalization + display-form derivation; e2e for the error state, open-in-browser affordance, and back/forward on a presented multi-page flow — with `.spec.md` companions per constitution.
- **Constitution fit**: probe endpoint is GET (read-only) per Uniform HTTP Verb; validation is backend-enforced per Security First.

## Open Questions

- None.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Visual polish is merged into this change rather than a third intake | User raised the merge themselves; recommended yes in discussion — same component (`iframe-window.tsx`), same chrome rebuild, splitting guarantees conflicts. Easily split later via /fab-clarify if it bloats | S:70 R:70 A:80 D:75 |
| 2 | Certain | No header-stripping proxy for arbitrary external sites — detect refusal, explain, open externally is the ceiling | Discussed and accepted; peer research shows the approach is a security liability and breaks on cookies/redirects regardless | S:85 R:75 A:90 D:85 |
| 3 | Confident | Frame-refusal detection via a backend GET probe inspecting `X-Frame-Options`/CSP `frame-ancestors`, used only for absolute external URLs | Cross-origin iframes expose no load-failure signal to the parent; a server-side header read is the only reliable detector. GET per Uniform Verb (read-only) | S:60 R:80 A:80 D:70 |
| 4 | Certain | Scheme allowlist (`http:`/`https:`/root-relative) enforced in the backend `@rk_url` validation, mirrored in the frontend | Security First: any client can POST options, so the backend is the enforcement point; current non-blank check accepts `javascript:` | S:65 R:85 A:85 D:80 |
| 5 | Certain | In-frame navigation and back/forward are per-viewer; only explicit address-bar Enter POSTs `@rk_url` | Directly mandated by window-views spec R7's substrate/view split — shared address is substrate, navigation is view state | S:75 R:80 A:90 D:85 |
| 6 | Confident | Normalization: loopback `host:port` → `/proxy/{port}/`, bare domain → `https://`, valid values pass through | Matches the Host page's existing port addressing; bare-domain→https is the universal browser default | S:60 R:85 A:75 D:65 |
| 7 | Confident | Display form hides plumbing (`server`/`v` params; kind-specific pretty labels) with raw value on focus | Screenshot review drove this; browsers' display-vs-edit URL split is the established pattern. Stored `@rk_url` unchanged per display contract | S:55 R:85 A:70 D:65 |
| 8 | Confident | Tile header shows same-origin `contentDocument.title` + a kind badge (proxy/present/external), falling back to the display form | Discussed as looks item 2; title read is same-origin-gated and cheap; badge disambiguates the three address kinds | S:60 R:85 A:80 D:75 |
| 9 | Confident | Back/forward via `contentWindow.history`, same-origin only; hidden/disabled for cross-origin | Only mechanism available to a web parent; cross-origin history is unreachable by design | S:60 R:80 A:75 D:70 |
| 10 | Confident | ⌘L binds at tile level now; in-frame coverage arrives via sibling `260819-ie2i` (soft dependency, not blocking) | Keeps the two changes independently shippable; keyboard-first requires the affordance either way | S:50 R:85 A:70 D:60 |
| 11 | Certain | Remove the `>_` switch-to-terminal button (+ `onSwitchToTty` plumbing); surface toggles own view switching | User-directed during mock review ("not really required"); the top-bar toggle path already covers it | S:90 R:85 A:90 D:90 |
| 12 | Certain | The checked-in `web-tile-chrome-design-study.html` is the visual source of truth for chrome layout, badges, and error copy | User reviewed the presented mock and approved with the single `>_` amendment | S:90 R:80 A:90 D:90 |

12 assumptions (5 certain, 7 confident, 0 tentative, 0 unresolved).
