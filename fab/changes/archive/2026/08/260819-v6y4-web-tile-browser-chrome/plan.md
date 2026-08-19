# Plan: Web Tile Browser Chrome + Polish + Hardening

**Change**: 260819-v6y4-web-tile-browser-chrome
**Intake**: `intake.md`

> Visual source of truth: the checked-in mock `web-tile-chrome-design-study.html`
> (this change folder) — button order, badge hues (green=present, amber=proxied
> port, blue=external), display-form examples, error-state copy, and the
> progress-line treatment follow it. The `>_` switch-to-terminal button is
> REMOVED per user direction during mock review.

## Requirements

### Backend: `@rk_url` hardening

#### R1: Scheme allowlist enforced backend-side
The `@rk_url` branch of `validateWindowOption` (`app/backend/api/windows.go`, `optKeyRkURL` case) MUST accept only: absolute `http:`/`https:` URLs, and root-relative paths starting with a single `/` (not `//`). It MUST reject `javascript:`, `data:`, `file:`, scheme-relative `//…`, and every other form with a clear error message naming the accepted forms. The existing non-blank check is retained (empty stays invalid; JSON null still unsets).

- **GIVEN** a client POSTs `/api/windows/{id}/options` with `{"options": {"@rk_url": "javascript:alert(1)"}}`
- **WHEN** the handler validates the merge
- **THEN** it returns 400 with a scheme-allowlist error and issues zero tmux calls
- **AND** `https://example.com`, `http://localhost:3000/x`, and `/proxy/3000/` are all accepted

#### R2: Frame-refusal probe endpoint
A new read-only endpoint `GET /api/frame-check?url=…` (handler in a new `app/backend/api/framecheck.go`, registered in `router.go`) SHALL fetch the URL server-side and report whether framing is blocked. Constraints: `http:`/`https:` absolute URLs only (400 otherwise); loopback/localhost hosts rejected (they ride `/proxy`, never probed); `net/http` client with a 5s timeout and redirects bounded (≤ 5, following the project's timeout discipline — no `exec`); response body discarded (headers are the payload). Blocked means: an `X-Frame-Options` header is present (any value — `DENY`/`SAMEORIGIN` both block a cross-origin viewer), or a CSP `frame-ancestors` directive exists that includes neither `*` nor the requesting viewer's origin (derived from the inbound request's Host/derived origin). Response JSON: `{"reachable": bool, "embeddable": bool, "status": int, "reason": string}` — `reachable: false` (with `reason`) for DNS/connect/timeout failures, never a 5xx from our own endpoint for a probe-target failure.

- **GIVEN** a target URL that responds `200` with `X-Frame-Options: DENY`
- **WHEN** the frontend calls `GET /api/frame-check?url=<that URL>`
- **THEN** the response is `200 {"reachable": true, "embeddable": false, "status": 200, "reason": "X-Frame-Options: DENY"}`
- **AND** a connection-refused target yields `{"reachable": false, "embeddable": false, ...}` with a connect-failure reason

### Frontend lib: address model (`lib/web-url.ts`, new pure module)

#### R3: Address-kind classification + display form
A new pure module `app/frontend/src/lib/web-url.ts` (colocated `web-url.test.ts` — the `window-view.ts` module contract: DOM-free, unit-tested) SHALL export the address-kind classifier and display-form deriver used by the URL bar, the tile header, and `tileMeta`. Kinds: `present` (root-relative starting `/present/`), `proxy` (root-relative `/proxy/{port}/…` OR absolute `http(s)://localhost|127.0.0.1:{port}…`), `external` (any other absolute `http(s)` URL), `relative` (any other root-relative path). Display forms: present → the file's basename with the plumbing query params (`server`, `v`) hidden; proxy → `localhost:{port}{path}` (the `/proxy/` plumbing never shows at rest); external → host + path (scheme dimmed/omitted per the design study); relative → the raw path. Derivation MUST NOT throw on any input (unparseable degrades to the raw string).

- **GIVEN** the stored `@rk_url` is `/present/@320/tmux-version-floor.html?server=runKit&v=1755600000`
- **WHEN** the display form is derived
- **THEN** it is `tmux-version-floor.html` with kind `present`
- **AND** `/proxy/3000/board/runKit` derives `localhost:3000/board/runKit` with kind `proxy`, and `https://shll.ai/rk/skill` derives kind `external`

#### R4: Input normalization + frontend scheme mirror
On address-bar submit, the input SHALL be normalized via a pure `normalizeAddressInput` in `web-url.ts`: bare loopback `localhost:{port}[{path}]` / `127.0.0.1:{port}[{path}]` (no scheme) → `/proxy/{port}{path or /}`; bare domain (`example.com[/path]`, no scheme) → `https://example.com[/path]`; already-valid values (absolute `http(s)`, root-relative) pass through unchanged. A frontend mirror of R1's allowlist rejects invalid schemes locally (inline feedback, no POST fired); the backend remains the enforcement point.

- **GIVEN** the user types `localhost:5173` into the address bar and presses Enter
- **WHEN** submit normalizes the input
- **THEN** `@rk_url` is POSTed as `/proxy/5173/`
- **AND** typing `javascript:alert(1)` fires no POST and surfaces the inline rejection

### Web tile chrome (`iframe-window.tsx`)

#### R5: Back / forward, same-origin, per-viewer
The URL-bar row SHALL gain ◀/▶ buttons driving `contentWindow.history.back()/forward()` for same-origin frames, and both buttons are HIDDEN when the frame is cross-origin (the existing `crossOrigin` state). This navigation is per-viewer view state and MUST NOT touch `@rk_url` (spec window-views R7). Buttons render enabled whenever same-origin (no canGoBack tracking — a boundary click is a harmless no-op).

- **GIVEN** a same-origin presented page where the user clicked an in-page link
- **WHEN** ◀ is clicked
- **THEN** the frame navigates back to the previous page with zero `/options` POSTs
- **AND** on a cross-origin frame neither button renders

#### R6: Real reload
The ↻ reload button SHALL call `contentWindow.location.reload()` for same-origin frames (preserving the frame's CURRENT location and in-page state); the existing `about:blank` bounce remains ONLY as the cross-origin fallback.

- **GIVEN** a same-origin frame navigated two links deep from `@rk_url`
- **WHEN** ↻ is clicked
- **THEN** the frame reloads its current page, not the stored `@rk_url`

#### R7: Display-vs-edit address bar + current-path tracking
At rest the address input SHOWS the display form (R3). Focusing it reveals the raw editable value with select-all; Escape reverts the edit and returns to display form (existing revert semantics kept); Enter (after R4 normalization) remains the ONE write to `@rk_url`. As the user navigates inside a same-origin frame, the display value SHALL track `contentWindow.location` (read on the frame's `load` events, same try/catch posture as the attach seam) — display-only, never POSTed. External SSE changes to `rkUrl` still reset the bar (existing sync effect).

- **GIVEN** a proxied tile at rest displaying `localhost:3000/board/runKit`
- **WHEN** the user clicks the address input
- **THEN** the raw stored value `/proxy/3000/board/runKit` appears, fully selected
- **AND** Escape restores the rest display form without a POST
- **GIVEN** a same-origin frame where the user navigates to a second page
- **WHEN** the frame's `load` fires
- **THEN** the display form tracks the frame's current location while `@rk_url` is unchanged

#### R8: In-tile error states (fail loudly)
The tile SHALL render explicit in-tile error states in place of the iframe, with copy per the design study: (a) **frame refusal** — for absolute external URLs, the frontend calls `GET /api/frame-check` (R2) on address change; when `embeddable: false` render "`{host}` refuses embedding" + the reason line + an "Open in browser ↗" button; (b) **unreachable external** — when `reachable: false`, render the connection-error message with the reason; (c) **dead proxied port** — for `proxy`-kind addresses, detect a dead upstream via a same-origin `fetch` of the proxied path (the reverse proxy answers 502 when nothing listens) and render "nothing listening on :{port}" + "connection refused — the dev server may have stopped" + a ↻ Retry button that re-runs detection and reloads. A silent blank iframe is no longer a reachable state for probed-blocked external URLs.

- **GIVEN** `@rk_url` set to an external site sending `X-Frame-Options: DENY`
- **WHEN** the tile loads
- **THEN** the frame-refusal error state renders with the Open in browser ↗ escape hatch instead of a silent blank iframe
- **GIVEN** a `/proxy/8080/` address with nothing listening on port 8080
- **WHEN** the tile loads
- **THEN** the dead-port error state renders with Retry

#### R9: Open in browser ↗
The URL-bar row SHALL gain an ↗ button (rightmost, per the design study) that opens the CURRENT address (the tracked frame location when known, else `@rk_url`) in a new tab via `window.open` — relative addresses resolve naturally against the viewer's origin (stored `@rk_url` stays relative per the display contract). A palette action `Web: Open in browser` (id `web-open-external`) mirrors it, registered only while the rendered layout includes an open `web` tile (the `web-find` registration pattern).

- **GIVEN** a presented tile showing `/present/@320/file.html?server=runKit`
- **WHEN** ↗ is clicked
- **THEN** `window.open` receives the relative address (resolving against the viewer origin) and `@rk_url` is unchanged

#### R10: Page title + kind badge in the tile header
For the `web` tile, the SurfaceLayout header SHALL show a kind badge (`present` green / `:{port} proxy` amber / `external` blue — hues per the design study and the existing accent vocabulary) and the page title: same-origin `contentDocument.title` (read on `load`, reported from `IframeWindow` through a new optional `onPageMeta` callback seam), falling back to the display form when cross-origin, pre-load, or empty. `tileMeta` (`surface-layout.tsx`) MUST stop throwing on relative URLs — it derives its label via `web-url.ts` so proxied/presented tiles get header meta too.

- **GIVEN** a presented file whose document title is "tmux Version Floor"
- **WHEN** the frame loads
- **THEN** the web tile header shows the green `present` badge and "tmux Version Floor"
- **AND** a `/present/…` URL no longer renders an empty header meta (the old `new URL` throw)

#### R11: Load progress line
A thin (2px) indeterminate progress line SHALL render at the tile's top content edge while the iframe is loading (loading = src set/changed or reload fired, cleared on the frame's `load` event), styled per the design study's sweep. Under `prefers-reduced-motion` the animation is zeroed per the project's animation vocabulary (CSS media query; static or hidden line).

- **GIVEN** an external URL that takes seconds to load
- **WHEN** the navigation starts
- **THEN** the progress sweep renders until `load` fires, and reduced-motion users see no animation

#### R12: ⌘L focuses the address bar (web-tile scope)
A new registry binding `web-address` (`lib/keybindings.ts`: `code: "KeyL"`, `tier: "cmd"`, `scope: "terminal"`, `webOnly: true`, `ignoreInputs: true`, label "Focus address bar") SHALL focus the web tile's address input (select-all, entering edit mode) while the web tile owns focus. It follows the `web-find` seam shape exactly: a `web-address:focus` document CustomEvent (exported const beside the input's listener), a `Web: Focus address bar` palette action (id `web-address`) registered only while an open `web` tile renders, and the `webOnly` handler gate in `app.tsx` (handler absent unless the focused tile kind is `web`, so ⌘L/Ctrl+L falls through everywhere else — browser address bar elsewhere in the app, readline clear-screen under terminal focus on Win/Linux). The mac-browser `cmd`-tier `KeyL` claimed-keys row is REMOVED (reclassified as page-interceptable, the ⌘D/⌘J class); in-frame coverage rides the existing kind-aware reclaim predicate (a `webOnly` match reclaims only in the `web` iframe — already shipped, data-driven).

- **GIVEN** the web tile owns focus (in-frame or tile chrome)
- **WHEN** ⌘L (mac) / Ctrl+L (Win/Linux) is pressed
- **THEN** the address input focuses with the raw value selected
- **AND** with the terminal focused the chord falls through untouched (no handler)

#### R13: Remove the `>_` switch-to-terminal button
The `>_` button and its `onSwitchToTty` prop plumbing SHALL be deleted end-to-end: the button block in `iframe-window.tsx`, the `IframeWindowProps.onSwitchToTty` prop, `surface-layout.tsx`'s prop declaration and pass-through (line ~176/~883), and `app.tsx`'s callback (line ~3897). The unit test asserting the `>_` flip fires zero `/options` POSTs retires with the button (its R7 concern is already guaranteed by the surface-toggle path `web-view-lens.spec.ts` asserts against). View switching is owned by the top-bar surface toggles / mobile switch group and the palette.

- **GIVEN** a rendered web tile
- **WHEN** its URL-bar row is inspected
- **THEN** no "Switch to terminal" button exists and no `onSwitchToTty` prop remains in the codebase

### Non-Goals

- No keyboard reclaim and no find-in-page work — shipped by sibling `260819-ie2i` (already on main); this change only reorders the existing ⌕ button per the design study.
- No header-stripping proxy for arbitrary external sites; no `proxy.go` rewrite changes; no auth on `/proxy`.
- No Electron `WebContentsView` work.
- No change to `@rk_url` substrate semantics (R7 substrate/view split) or to what agents store there.

### Design Decisions

#### Dead-port detection is a frontend same-origin fetch, not a proxy ErrorHandler
**Decision**: detect a dead proxied port by `fetch`ing the proxied path from the frontend and reading the reverse proxy's 502, rendering the error state client-side.
**Why**: the proxy already answers 502 on connect failure (default `ReverseProxy` error path); a same-origin fetch reads it with zero backend change, honoring the intake's "no proxy.go changes" non-goal and keeping `frame-check` scoped to absolute external URLs only.
**Rejected**: a custom `ErrorHandler` serving a styled error page from `proxy.go` — touches the proxy the intake fences off, and couples error UI to the Go layer.
*Introduced by*: 260819-v6y4-web-tile-browser-chrome

#### Page title crosses the component seam via a callback, kind stays derived
**Decision**: `IframeWindow` reports `{ title }` through a new optional `onPageMeta` prop on frame `load`; `SurfaceLayout` holds it as state for the header. The kind badge is derived purely from `rkUrl` via `web-url.ts` with no seam.
**Why**: the header is SurfaceLayout's render but only the mounted iframe can read `contentDocument.title`; a narrow optional callback matches the existing `onInteract`/`onFolderNavigated` seam shapes, and deriving the badge purely keeps it testable and SSE-consistent.
**Rejected**: rendering a second header inside `IframeWindow` (duplicates the tile-header contract) or lifting the whole iframe ref up (breaks the presentational-component boundary).
*Introduced by*: 260819-v6y4-web-tile-browser-chrome

#### The mac-browser ⌘L claim is removed, not worked around
**Decision**: delete the `{ code: "KeyL", tier: "cmd", owner: "browser", platform: "mac" }` claimed-keys row so `web-address` resolves enabled in mac browsers.
**Why**: ⌘L is `preventDefault`-interceptable in mac browsers (the ⌘D bookmark / ⌘J downloads class, proven by vscode.dev intercepting ⌘L) — the claim was recorded conservatively when nothing bound the key. The `webOnly` gate means the chord falls through to the browser's own address bar everywhere except web-tile focus, which is exactly the claim's original protection.
**Rejected**: keeping the claim and shipping ⌘L `macShellOnly` (the `settings-open` pattern) — leaves the primary browser deployment without the chord for no technical reason; the shifted-tier alternative ⇧⌘L is taken (`window-next`). Mirrors the ⌘J precedent including its pre-ship manual mac verification caveat: if a mac browser refuses interception, the recorded fallback is restoring the claim + palette-only.
*Introduced by*: 260819-v6y4-web-tile-browser-chrome

#### frame-check rejects loopback targets
**Decision**: `GET /api/frame-check` 400s loopback/localhost target hosts.
**Why**: loopback content rides `/proxy` and is never probed (the frontend only probes external absolute URLs), and refusing it bounds the server-side-fetch (SSRF-shaped) surface of a probe endpoint that accepts arbitrary URLs — the response also carries only derived fields (`embeddable`/`status`/`reason`), never raw headers.
**Rejected**: probing everything uniformly — widens the fetch surface for zero frontend need.
*Introduced by*: 260819-v6y4-web-tile-browser-chrome

## Tasks

### Phase 1: Setup — backend seams + pure lib

- [x] T001 [P] Tighten the `optKeyRkURL` case in `validateWindowOption` (`app/backend/api/windows.go`): scheme allowlist per R1 with a clear error string; add the validation matrix to `app/backend/api/windows_test.go` (accept: https/http absolute, `/…` root-relative; reject: `javascript:`, `data:`, `file:`, `//…`, `ftp:`, whitespace-only) <!-- R1 -->
- [x] T002 [P] New `app/backend/api/framecheck.go`: `handleFrameCheck` per R2 (url param validation incl. loopback rejection, 5s-timeout `http.Client` with `CheckRedirect` bound ≤ 5, body discarded, X-Frame-Options + CSP `frame-ancestors` parse against the request-derived viewer origin, JSON response shape); register `r.Get("/api/frame-check", s.handleFrameCheck)` in `app/backend/api/router.go`; `httptest`-driven tests in `app/backend/api/framecheck_test.go` (XFO deny, CSP allow/deny incl. `*`, no headers → embeddable, unreachable target, loopback/invalid-scheme 400s) <!-- R2 -->
- [x] T003 [P] New pure module `app/frontend/src/lib/web-url.ts`: `classifyAddress(url): AddressKind` (`present`/`proxy`/`external`/`relative`), `displayForm(url)` (kind-specific per R3, plumbing `server`/`v` params hidden, never throws), `proxyPortOf(url)`, `normalizeAddressInput(input)` (R4), `isAllowedUrl(input)` (frontend mirror of R1); colocated `web-url.test.ts` covering the intake's examples and edge cases (bare domain, loopback with/without scheme and path, `?v=` cache-buster hiding, unparseable input) <!-- R3 -->
- [x] T004 [P] Add `checkFrame(url: string)` to `app/frontend/src/api/client.ts` calling `GET /api/frame-check?url=…` (typed `FrameCheckResult`; note: no `server` param — host-global read) <!-- R2 -->

### Phase 2: Core chrome rework (`iframe-window.tsx`)

- [x] T005 Remove the `>_` button end-to-end: the button block in `app/frontend/src/components/iframe-window.tsx`, `IframeWindowProps.onSwitchToTty`, `surface-layout.tsx`'s prop + pass-through, `app.tsx`'s inline callback; retire the `>_` flip zero-POST unit test in `iframe-window.test.tsx` and drop the `onSwitchToTty={vi.fn()}` props in `surface-layout.test.tsx` <!-- R13 -->
- [x] T006 Address bar display/edit split in `iframe-window.tsx`: rest shows `displayForm(trackedLocation ?? rkUrl)`; focus/click reveals the raw value with select-all; Escape reverts to display; Enter runs `normalizeAddressInput` + `isAllowedUrl` (inline rejection feedback, no POST on invalid) before `updateWindowUrl`; same-origin `load` events update the tracked-location display state (R7, try/catch posture) <!-- R7 -->
- [x] T007 Back/forward + real reload: ◀/▶ buttons (hidden when `crossOrigin`) calling `contentWindow.history.back()/forward()`; ↻ becomes same-origin `contentWindow.location.reload()` with the `about:blank` bounce kept as the cross-origin-only fallback; button order per the design study (◀ ▶ ↻ [addr] ⌕ ↗) <!-- R5 -->
- [x] T008 Load progress line: `loading` state set on src change/reload, cleared on `load`; 2px accent-green indeterminate sweep row between the URL-bar block and the iframe (a shared `rk-*` utility in `app/frontend/src/globals.css` if none fits), zeroed under `prefers-reduced-motion` <!-- R11 -->
- [x] T009 Error states: for `external`-kind addresses call `checkFrame` on address change and render the frame-refusal / unreachable error boxes (copy + layout per design-study states 05/06, Open in browser ↗ button inside the refusal state); for `proxy`-kind addresses run the same-origin dead-port fetch probe and render the "nothing listening on :{port}" state with ↻ Retry; error states replace the iframe render and clear on the next address change/retry <!-- R8 -->
- [x] T010 Open in browser ↗: URL-bar button (rightmost) opening the current address via `window.open`; `Web: Open in browser` palette action (id `web-open-external`) in `app.tsx` beside the `web-find` registration, gated on an open `web` tile <!-- R9 -->
- [x] T011 Header title + badge: `onPageMeta` callback prop reporting same-origin `contentDocument.title` on `load` (null cross-origin); `surface-layout.tsx` holds the reported title, renders the web tile header as glyph + kind badge (`present`/`:{port} proxy`/`external`, design-study hues) + title-or-display-form; rewrite `tileMeta`'s web branch through `web-url.ts` (no `new URL` throw on relative) <!-- R10 -->

### Phase 3: Keyboard, palette, integration & tests

- [x] T012 `web-address` binding: add the `DEFAULT_BINDINGS` row (`KeyL`, `cmd`, `terminal`, `webOnly`, `ignoreInputs`, `mapLabel: "address"`) and REMOVE the mac-browser `cmd`-tier `KeyL` claimed-keys row in `app/frontend/src/lib/keybindings.ts`; export `WEB_ADDRESS_FOCUS_EVENT` beside the input's listener; `Web: Focus address bar` palette action (id `web-address`) + the `webGated("web-address")` handler in `app.tsx` dispatching the CustomEvent; `IframeWindow` listens and focuses+selects the address input (entering edit mode); update `keybindings.test.ts` (binding row, claim removal, `hasReclaimableMatch` reclaims `web-address` only in the `web` kind) <!-- R12 -->
- [x] T013 Unit tests (`iframe-window.test.tsx`, jsdom): display/edit split incl. Escape revert and normalization-on-submit (POST payload asserted), invalid-scheme inline rejection with zero POSTs, back/forward hidden on cross-origin, error-state renders with mocked `checkFrame`/fetch, `onPageMeta` reporting, ⌘L CustomEvent focus; `surface-layout.test.tsx`: badge + title fallback render, `tileMeta` relative-URL fix <!-- R7 -->
- [x] T014 e2e `app/frontend/tests/e2e/web-tile-chrome.spec.ts` + companion `.spec.md` (constitution Test Companion Docs), real-tmux port-3020 rig (`web-view-lens.spec.ts` `_tmux.ts` pattern): (a) frame-refusal error state + Open-in-browser affordance via a `page.route` mock of `/api/frame-check*` (trailing `*` — query-string glob) and a `window.open` stub; (b) back/forward across a presented two-page flow (two HTML files via `@rk_url` `/present/…`, click a link, ◀ returns, zero `/options` POSTs asserted); (c) display-form at rest + raw value on focus; (d) no "Switch to terminal" button in the web tile <!-- R8 -->
- [x] T015 Verification gates in order: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; scoped e2e `just test-e2e "web-tile-chrome"` + `just test-e2e "web-view-lens"` (regression on the reworked tile); then `just build` <!-- R1 -->

## Execution Order

- Phase 1 tasks are all [P] (disjoint files). T006–T011 build on T005's cleaned-up component and T003's lib; within Phase 2, T006 → T007 → T009 share `iframe-window.tsx` state (sequential), T008/T010/T011 are small and ride the same file after T006.
- T012 depends on T006 (the edit-mode focus behavior it triggers). T013–T014 after all implementation. T015 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: Backend `@rk_url` validation accepts http/https absolute + root-relative and rejects `javascript:`/`data:`/`file:`/`//…` with 400 and zero tmux calls (Go test matrix passes)
- [x] A-002 R2: `GET /api/frame-check` reports embeddable/blocked/unreachable per the response contract, bounded by timeout + redirect cap, loopback targets 400
- [x] A-003 R3: `web-url.ts` classifies present/proxy/external/relative and derives the intake's display-form examples exactly, never throwing
- [x] A-004 R4: Submit normalization maps bare loopback → `/proxy/{port}/…`, bare domain → `https://…`, passes valid values through
- [x] A-005 R5: ◀/▶ drive same-origin frame history and are hidden cross-origin
- [x] A-006 R6: ↻ preserves the frame's current location on same-origin frames; cross-origin keeps the bounce
- [x] A-007 R7: Rest shows display form; focus shows raw select-all; Escape reverts; in-frame navigation tracks display-only
- [x] A-008 R8: Frame-refusal, unreachable-external, and dead-port states render per the design study with working escape hatches (Open in browser / Retry)
- [x] A-009 R9: ↗ button + `Web: Open in browser` palette action open the current address in a new tab
- [x] A-010 R10: Web tile header shows kind badge + page title (fallback display form); `tileMeta` renders meta for `/present/…` and `/proxy/…` URLs
- [x] A-011 R11: Progress line renders during load, clears on `load`, zeroed under `prefers-reduced-motion`
- [x] A-012 R12: ⌘L/Ctrl+L focuses the address bar only under web-tile focus; palette action registered only with an open web tile; mac-browser KeyL claim removed
- [x] A-013 R13: `>_` button and `onSwitchToTty` plumbing fully removed; retired test gone

### Behavioral Correctness

- [x] A-014 R7: Only explicit address-bar Enter POSTs `@rk_url`; back/forward, in-frame navigation, reload, and ⌘L fire zero `/options` POSTs (spec window-views R7 substrate/view split preserved)
- [x] A-015 R1: Existing valid `@rk_url` writers (`rk present` relative URLs, iframe-window creation dialog) still pass validation unchanged
- [x] A-016 R6: Reload no longer resets a navigated same-origin frame back to `@rk_url`

### Scenario Coverage

- [x] A-017 R8: e2e proves the frame-refusal error state + Open-in-browser affordance (mocked `/api/frame-check*` with trailing-`*` glob)
- [x] A-018 R5: e2e proves back/forward on a presented two-page flow with zero `/options` POSTs
- [x] A-019 R13: e2e (or unit) proves no switch-to-terminal button renders in the web tile

### Edge Cases & Error Handling

- [x] A-020 R3: Unparseable/degenerate addresses degrade to raw display, never a component crash
- [x] A-021 R2: Probe-target failures (DNS, refused, timeout) return `reachable: false` — never a 5xx from our endpoint or an unhandled frontend rejection
- [x] A-022 R4: Invalid-scheme submit shows inline feedback, fires no POST, and leaves the stored `@rk_url` untouched

### Code Quality

- [x] A-023 Pattern consistency: new code follows the seam shapes it extends (optional callback props, pure lib modules with colocated tests, `webGated` handler pattern, `Tip` buttons, design-token classes)
- [x] A-024 No unnecessary duplication: `toProxySrc`/display/normalization logic consolidated in `web-url.ts` (single source; `iframe-window.tsx` consumes it), no second URL parser
- [x] A-025 Type narrowing over assertions; no `as` casts introduced in the new frontend code
- [x] A-026 New tests cover added behavior (Go validation matrix + frame-check; Vitest lib + component; e2e with `.spec.md` companion)

### Security

- [x] A-027 R1: `javascript:`/`data:` injection via `/options` is dead backend-side (any client, not just the UI)
- [x] A-028 R2: frame-check uses stdlib HTTP with timeout discipline (no exec), bounded redirects, discarded bodies, loopback rejection, and returns derived fields only (no raw header echo)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None outstanding — the change's planned removals were all executed in the diff: the `>_` switch-to-terminal button and `onSwitchToTty` plumbing end-to-end (R13/T005), the `⏎` hint glyph span in `iframe-window.tsx` (assumption 13), the component-local `toProxySrc` (subsumed by `lib/web-url.ts`, A-024), and the mac-browser `KeyL` claimed-keys row in `lib/keybindings.ts` (R12). No additional redundant code discovered in the parsimony pass.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Dead-port detection via frontend same-origin fetch of the proxied path (reads the proxy's 502), not a proxy.go ErrorHandler | Honors the intake's "no proxy.go changes" non-goal; the default ReverseProxy already answers 502; zero backend change | S:65 R:85 A:80 D:70 |
| 2 | Confident | Remove the mac-browser cmd-tier KeyL claim so ⌘L resolves enabled; ⌘J-precedent manual mac verification caveat recorded | ⌘L is page-interceptable in mac browsers (⌘D/⌘J class; vscode.dev proves it); the webOnly gate preserves browser address-bar behavior everywhere else; ⇧⌘L is taken by window-next | S:55 R:80 A:70 D:65 |
| 3 | Confident | Back/forward render enabled (not disabled-state-tracked) on same-origin frames | Browsers expose no reliable canGoBack signal to a parent; a boundary click is a harmless no-op; design study's disabled ▶ is cosmetic | S:50 R:90 A:75 D:70 |
| 4 | Confident | Page title crosses to SurfaceLayout via a new optional `onPageMeta` callback; badge derived purely from rkUrl | Matches the existing onInteract/onFolderNavigated seam shapes; keeps IframeWindow presentational and the badge SSE-consistent | S:60 R:85 A:85 D:75 |
| 5 | Confident | frame-check response shape `{reachable, embeddable, status, reason}` with derived fields only; loopback targets rejected | Headers are the payload but echoing them raw leaks internal-service data; loopback rides /proxy and is never probed — bounds the SSRF-shaped surface | S:55 R:80 A:80 D:70 |
| 6 | Confident | XFO of ANY value counts as blocked for the probe (DENY and SAMEORIGIN both block a cross-origin viewer) | The probe serves external absolute URLs only, where the viewer origin is never same-origin with the target | S:60 R:85 A:85 D:80 |
| 7 | Certain | Frame-check is `GET` (read-only, no state) registered beside the other GET reads in router.go | Constitution IX Uniform HTTP Verb; intake states it explicitly | S:85 R:90 A:95 D:90 |
| 8 | Confident | ⌘L focuses/edit-modes the tile address input via a `web-address:focus` CustomEvent mirroring the shipped `web-find:open` seam | At most one web tile per layout (the seam's stated precondition); byte-level precedent shipped in 260819-ie2i | S:70 R:85 A:90 D:85 |
| 9 | Confident | The `>_` flip zero-POST test retires outright (not rewritten) — its R7 concern is covered by web-view-lens's palette-path zero-POST assertion | Intake directs the retirement and names the covering test | S:75 R:80 A:85 D:80 |
| 10 | Confident | The `web-address:focus` / `web-open-external` event constants live in `lib/web-url.ts`, not the component | R12 says "follows the web-find seam shape exactly" — `WEB_FIND_OPEN_EVENT` lives in `lib/find-in-page.ts`; web-url.ts is the address module | S:60 R:80 A:80 D:70 |
| 11 | Confident | Unreachable-external error copy is "{host} can't be reached" + the probe reason + the Open-in-browser hatch | The design study defines only the refusal (05) and dead-port (06) states; the unreachable state mirrors their shape | S:55 R:80 A:75 D:65 |
| 12 | Confident | The `relative` address kind renders no header badge (plain label + meta fallback) | The design study shows badges only for present/proxy/external; a badge for "a path" adds noise | S:50 R:75 A:70 D:60 |
| 13 | Confident | The ⏎ glyph after the address input is dropped | The design study's urlrow is exactly ◀ ▶ ↻ [addr] ⌕ ↗; the glyph is not in the approved visual source of truth | S:50 R:75 A:70 D:60 |
| 14 | Certain | Error states render over a HIDDEN (still-mounted) iframe rather than unmounting it | Unmounting would strand the attach seam's listeners (its effect is mount-once), forcing a remount dance on Retry; `hidden` satisfies "replace the iframe render" visually with zero seam churn | S:80 R:85 A:85 D:80 |
| 15 | Certain | `/present` added to the vite dev proxy table (forwarded to the Go backend, plain GETs) | The e2e rig (vite on 3020) answered `/present/…` with the SPA fallback — presented tiles could never load in dev; the two-page back/forward flow (T014b) requires the real route. No SPA route collides with the prefix | S:85 R:90 A:90 D:85 |
| 16 | Confident | The six e2e specs stamping the dead `http://localhost:8080/` URL get a shared `/proxy/8080/**` route stub (`_web-tile.ts`) instead of a live server | R8's dead-port state intentionally hides their iframe (they asserted chrome over a frame that used to render blank); the stub restores their written posture — "asserts chrome, never content" — hermetically, matching web-tile-find's stub-server intent without its port plumbing | S:65 R:85 A:80 D:70 |

16 assumptions (3 certain, 13 confident, 0 tentative).
