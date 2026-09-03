# Plan: UI State Frontend — Web Tab Strip

**Change**: 260828-9kip-web-tab-strip
**Intake**: `intake.md`

## Requirements

> Scope: frontend only. The backend contract (`POST /api/windows/{id}/web`, `…/web/{n}/remove`, `…/web/{n}/select`, the `/options` web-slot validation, `WebAdd`/`WebRemove` semantics) is shipped and MUST NOT change. Every requirement below is satisfied by reading `win.webTabs`/`win.webActive` and writing through those routes.

### API Client: Web-tab verb wrappers

#### R1: Three verb wrappers in `client.ts`
`app/frontend/src/api/client.ts` SHALL export `addWebTab(server, windowId, target)`, `removeWebTab(server, windowId, n)`, and `selectWebTab(server, windowId, n)` posting to `/api/windows/{windowId}/web`, `/web/{n}/remove`, `/web/{n}/select` respectively, each through `withServer(...)`, following the `setWindowOptions` request/error pattern. `n` is the 1-based tmux slot. A non-2xx response MUST reject with an `Error` whose message is the server's `{"error": msg}` text (so "web tabs full (8)" reaches the UI verbatim).

- **GIVEN** a window `@5` on server `s` with two tabs
- **WHEN** `addWebTab("s", "@5", "/proxy/3003/")` resolves
- **THEN** the request was `POST /api/windows/@5/web?server=s` with body `{"target":"/proxy/3003/"}` and the result is `{ index, existed, url }` from the 201 body
- **AND** a 409 rejects with `Error("web tabs full (8)")`

### Address model: `webTabTitle`

#### R2: `webTabTitle(url)` in `lib/web-url.ts`
`app/frontend/src/lib/web-url.ts` SHALL export a pure `webTabTitle(url: string): string`: `present` → basename of the path (plumbing params `server`/`v` and the tab's own query dropped); `proxy` (both `/proxy/{port}/…` and absolute loopback) → `localhost:{port}{path}` with no search/hash; `external` → host only; `relative` → the raw path; empty/whitespace → `""`. It MUST never throw. The module header's two `@rk_win_url` mentions SHALL be updated to `@rk_win_web_<n>`.

- **GIVEN** the table `/present/@3/1/report.html?v=17&server=x` → `report.html`; `/proxy/3000/docs/api?q=1` → `localhost:3000/docs/api`; `http://localhost:5173/?x=1` → `localhost:5173/`; `https://docs.example.com/a/b#c` → `docs.example.com`; `/foo` → `/foo`; `""` → `""`
- **WHEN** `webTabTitle` is applied to each input
- **THEN** each output matches, asserted in `web-url.test.ts`

### Iframe Window: family props + onboarding

#### R3: `IframeWindow` renders the web-tab family
`app/frontend/src/components/iframe-window.tsx` SHALL replace its `url: string` prop with `tabs: string[]` and `active?: number`, plus optional verb callbacks `onSelectTab(n)`, `onCloseTab(n)`, `onAddTab(target) → Promise<{index, existed}>`; `onWriteUrl`, `onInteract`, `shouldReclaimChord`, `onPageMeta` are unchanged. The component MUST stay payload-shape agnostic (no `server`/`windowId` props). Internally `activeIndex = tabs.length ? clamp(active ?? 1, 1, tabs.length) : 0` and the active URL is `tabs[activeIndex - 1] ?? ""`; every existing URL-driven effect consumes that local.

- **GIVEN** `tabs=["/proxy/3001/", "/proxy/3002/"]` and `active=2`
- **WHEN** the component renders
- **THEN** the address bar shows `displayForm("/proxy/3002/")` and the visible iframe's `src` is `toProxySrc("/proxy/3002/")`
- **AND** with `active=9` (out of range) the active index clamps to 2, never to onboarding

#### R4: Onboarding keys on an empty family
The onboarding state (`data-testid="web-tile-onboarding"`, copy unchanged) SHALL render iff `tabs.length === 0`. With ≥1 tab the iframe(s) mount regardless of the active slot's value.

- **GIVEN** `tabs=[]`
- **WHEN** the component renders
- **THEN** the onboarding panel is present, no `<iframe>` is mounted, and the URL-bar chrome hides the same controls it hides today (back/forward, find, zoom, open-external)

### Iframe Window: the strip

#### R5: Strip visibility threshold
A tab strip (`data-testid="web-tab-strip"`, `role="tablist"`) SHALL render as the FIRST child of the outer `flex flex-col` wrapper, above the URL-bar row, iff `tabs.length >= 2`. At 0 or 1 tab the rendered DOM of the URL-bar row and below MUST be identical to the pre-change component (the 1-tab chrome tests pass unchanged).

- **GIVEN** `tabs=["/proxy/3001/"]`
- **WHEN** the component renders
- **THEN** `web-tab-strip` is absent
- **GIVEN** a second tab is added to `tabs`
- **THEN** `web-tab-strip` is present with two `role="tab"` children

#### R6: Tab rendering
Each tab (`role="tab"`, `aria-selected`, `data-testid="web-tab"`, `data-index={n}`) SHALL show `webTabTitle(url)` (fallback `#n` when empty), carry `title={displayForm(url)}`, the `classifyAddress` color dot the tile header already uses (green present / yellow proxy / blue external), and a close glyph `×` (`aria-label="Close web tab {n}"`, `data-testid="web-tab-close"`) — always rendered on the active tab and on coarse pointers, hover/focus-within-revealed otherwise. Active styling: `bg-bg-primary text-text-primary`; inactive: `text-text-secondary hover:text-text-primary`. The strip is `shrink-0`, horizontally scrollable, monospace 11px, `bg-bg-card border-b border-border` (the tile-header idiom). The strip end SHALL carry a `+` button (`aria-label="Add web tab from address"`, `data-testid="web-tab-add"`), disabled with a `Tip` reading `web tabs full (8)` when `tabs.length >= 8`.

- **GIVEN** three tabs with `active=2`
- **WHEN** rendered
- **THEN** exactly one tab has `aria-selected="true"` (index 2) and the labels are `webTabTitle` of each URL

#### R7: Select and close verbs
Clicking a tab SHALL call `onSelectTab(n)`; clicking its `×` SHALL call `onCloseTab(n)` and MUST NOT also select (`stopPropagation`). No confirmation dialog. The component performs no local renumbering — it re-renders from the next `tabs`/`active` props.

- **GIVEN** three tabs, `active=1`
- **WHEN** the user clicks the `×` on tab 2
- **THEN** `onCloseTab(2)` is called once and `onSelectTab` is not called

#### R8: `+` semantics and the new-tab arm
Let `draft = normalizeAddressInput(inputUrl)`. When `draft` is non-empty and differs from the active URL, `+` SHALL call `onAddTab(draft)` and then, on `{index}`, `onSelectTab(index)` (because `WebAdd` selects only on an empty family). When `draft` is empty or equals the active URL, `+` SHALL focus the address input, select its text, and arm a one-shot **new-tab mode** so the next Enter routes through `onAddTab` (then `onSelectTab(index)`) instead of `onWriteUrl`; Escape or blur clears the arm. Errors from `onAddTab` (409 full, 400 bad target) SHALL surface in the existing inline `role="alert"` submit-error slot with the rejected error's message. `+` is only rendered with the strip (`tabs.length >= 2`); the palette action of R11 is the 0–1-tab path.

- **GIVEN** two tabs, `active=1`, the address input holds `localhost:3003`
- **WHEN** the user clicks `+`
- **THEN** `onAddTab("http://localhost:3003/")` (the normalized draft) is awaited and `onSelectTab(3)` follows when it resolves `{index: 3}`
- **GIVEN** the address input equals the active URL
- **WHEN** the user clicks `+`
- **THEN** no verb fires, the input is focused, and the next Enter with a new address calls `onAddTab`, not `onWriteUrl`

#### R9: Address-bar Enter replaces the active slot
Outside new-tab mode, Enter on the address bar SHALL call `onWriteUrl(normalized)` exactly as today, and MUST skip the call when `normalized === activeUrl` (same-URL no-op). It MUST NOT call `onAddTab`. Refresh reloads the active frame as today; the `/present/` `?v=` refresh is not the bar's job.

- **GIVEN** two tabs, `active=2`, the bar edited to `localhost:9000`
- **WHEN** Enter
- **THEN** `onWriteUrl("http://localhost:9000/")` is called and `onAddTab` is not
- **AND** the caller (`surface-layout.tsx`) writes `@rk_win_web_2`

#### R10: Roving keyboard on the strip
The strip SHALL be a roving-focus `tablist`: ←/→ move focus among tabs (no write), Home/End jump, Enter/Space call `onSelectTab(focused)`, Delete/Backspace call `onCloseTab(focused)`. Only the active tab is in the tab order (`tabIndex=0`); others are `-1`.

- **GIVEN** three tabs, focus on tab 1
- **WHEN** → then Enter
- **THEN** `onSelectTab(2)` is called; → alone caused no write

### P3: mounted frames

#### R12: One `<iframe>` per tab, only the active visible
When `tabs.length >= 1`, the component SHALL mount one `<iframe>` per tab inside the zoom wrapper region, each `key`ed by its URL, with the same `sandbox`/`title` attributes as today; every non-active frame carries the `hidden` attribute (display:none) and is NEVER unmounted by a selection change. A selection change MUST NOT alter any frame's `src`. All frames mount eagerly (no lazy mount, no LRU); the family cap (8) bounds the count.

- **GIVEN** three tabs, `active=1`
- **WHEN** `active` becomes 3
- **THEN** three `<iframe>` elements are still in the DOM, only the third lacks `hidden`, and the first frame's `src` is unchanged (same element identity)
- **GIVEN** `WebRemove` shifts tab 3 into slot 2
- **THEN** the frame keyed by that URL persists (key = URL, not index)

#### R13: Chrome binds to the active frame; single receiver preserved
Per-frame state (`iframeRef`, `loading`, `crossOrigin`, tracked location, page meta, probe/error state) SHALL be held per frame (a `Map<url, FrameState>` or a per-frame child hook) and the chrome — back/forward, refresh, find bar, progress line, error surface, `onPageMeta`, address display — SHALL read the active frame's entry. The document CustomEvent listeners (`web-find:open`, `web-address:focus`, `web-open-external`, `web-zoom`) SHALL remain single listeners on the component acting on the active frame. The zoom bucket `webZoomKeyFor(activeUrl)` re-seeds on active change and the scale wrapper applies to the active frame only. Inactive frames SHALL NOT run the dead-port probe timer, progress line, or error surface; a frame probes on first mount and on activation.

- **GIVEN** two tabs where tab 1 is cross-origin and tab 2 same-origin
- **WHEN** `active` switches 1 → 2
- **THEN** back/forward become visible and `⌘F`'s `web-find:open` event opens the find bar against frame 2
- **AND** exactly one `web-find:open` listener exists on `document` for the tile

### Surface layout: wiring + optimistic state

#### R14: `surface-layout.tsx` passes the family and verbs
The `case "web"` mount in `app/frontend/src/components/surface-layout.tsx` SHALL pass `tabs={win.webTabs ?? []}`, `active={win.webActive}`, `onWriteUrl` (unchanged: `setWindowOptions(server, windowId, {["@rk_win_web_" + activeSlot]: url})` with `activeSlot = webActive >= 1 ? webActive : 1`), `onSelectTab={(n) => selectWebTab(server, windowId, n)}`, `onCloseTab={(n) => removeWebTab(server, windowId, n)}`, `onAddTab={(t) => addWebTab(server, windowId, t)}`. Tile header meta/badge (`displayForm(activeWebUrl(win))`, `classifyAddress`) are unchanged. `lib/window-view.ts` is unchanged.

- **GIVEN** the web tile mounted for `@5` on server `s`
- **WHEN** the user clicks tab 3
- **THEN** `POST /api/windows/@5/web/3/select?server=s` is issued

#### R15: Optimistic select/remove, SSE reconcile
Select SHALL apply an optimistic `webActive` override and remove SHALL apply an optimistic `webTabs`/`webActive` override (a local shift mirroring the server's `repointActive` rule — display only) through the Zustand window store's existing optimistic-action pattern; the next SSE/`/ws/state` tick reconciles. On POST rejection the override reverts and a toast shows the error. Add is NOT optimistic (the index is server-assigned).

- **GIVEN** three tabs, `active=3`
- **WHEN** the user closes tab 2 and the POST is in flight
- **THEN** the strip immediately shows two tabs with the former tab 3 active (index 2), and the tmux options match when the tick arrives
- **AND** if the POST rejects, three tabs return and a toast shows the error

### Keyboard-first: palette

#### R11: Palette actions for the strip
The command palette SHALL register, enabled when the current layout contains a `web` tile with ≥1 tab (≥2 for next/prev/close where noted): `Web: Next tab` (wrap; `selectWebTab(active+1)`), `Web: Previous tab` (wrap), `Web: Close tab` (`removeWebTab(active)`), and `Web: New tab from address` (dispatches `web-address:focus` with a new-tab arm so the next Enter adds — available at ≥1 tab; it is the only UI path to a second tab from a 1-tab window). Registration follows the existing `Web: Zoom *` action pattern in the palette registry. No new global chords.

- **GIVEN** two tabs, `active=2`
- **WHEN** the palette runs `Web: Next tab`
- **THEN** `selectWebTab(server, windowId, 1)` is called (wrap)

### Tests

#### R16: Unit coverage
`iframe-window.test.tsx` SHALL grow its `renderIframe` helper to accept `tabs`/`active`/verb mocks (existing cases pass `tabs={[url]}`; the eight onboarding cases pass `tabs={[]}`) and add cases for R3–R10, R12, R13 (strip threshold incl. a DOM-equality check of the URL-bar row at 1 tab against a `tabs=[url]` vs pre-change snapshot; N frames with one visible and stable `src`; select/close/`+`/new-tab arm/Enter routing/same-URL no-op; roving keys; `+` disabled at 8; 409 text in the alert; single `web-find:open` listener). `web-url.test.ts` SHALL pin the R2 table. `surface-layout.test.tsx`'s `IframeWindow` stub SHALL record the new props; `surface-layout.web-integration.test.tsx` SHALL render a 2-tab window and assert no update-depth loop. A palette test SHALL cover R11 enablement + wrap.

- **GIVEN** `just test-frontend`
- **WHEN** run
- **THEN** all suites pass

#### R17: e2e `web-tabs.spec.ts`
`app/frontend/tests/e2e/web-tabs.spec.ts` SHALL exist with a file-header comment and a JSDoc **Proves:/Steps:** block per `test()` (Constitution § Test Intent Comments; no `.spec.md`). Setup: dedicated session `e2e-webtabs-${Date.now()}`, `stubProxyPorts(page, 3001, 3002, 3003)`, `@rk_win_layout=single:web`, seed via a new `_tmux.ts` helper `stampWebTabs(windowId, urls, active, opts)` (beside `stampWebTab`). Tests: (1) strip renders 3 tabs with `webTabTitle` labels, tab 2 selected, exactly one visible iframe; (2) click tab 3 → `windowOption(id,"@rk_win_web_active") === "3"` within `OPTION_TICK_TIMEOUT`, tab-2 iframe still in the DOM (`hidden`); (3) close tab 2 → `@rk_win_web_2` holds the former tab-3 URL, `@rk_win_web_3` is empty, DOM shows 2 tabs, `_active` per `repointActive`; (4) a second browser context on the same route sees the same active tab after context 1 clicks; (5) `+` with a `/proxy/3003/` draft → 4th slot in tmux and selected, and Enter on the bar with a new address replaces the active slot only (`webTabs.length` unchanged). The spec MUST mount no second tile and MUST run ≤1 three-frame test at a time (the `surface-layout.spec.ts:32-34` pool budget). Before editing, the touched web specs (`web-tile-chrome`, `web-tile-find`, `web-tile-zoom`, `web-view-lens`, `surface-layout`, `present-auto-expand`) are baselined on clean `origin/main`; `web-view-lens` :194/:412/:444/:521 are pre-existing failures.

- **GIVEN** `just test-e2e "web-tabs.spec.ts"`
- **WHEN** run on the isolated rig
- **THEN** all five tests pass

### Docs

#### R18: Spec status + deferral tracking
`docs/specs/ui-state.md` SHALL flip § Web Tabs to `[current]` for the state, rendering, identity, and declared-only paragraphs (header status line updated), leave the "`rk present` is absorbed" sub-paragraph `[planned]` (Change 4), and annotate the detected-port affordance sentence "(deferred — needs per-window port attribution; tracked in `fab/backlog.md`)". `fab/backlog.md` SHALL gain an entry "Per-window `ports` on the Window payload + web-strip `+ :port` chip" in the file's existing entry format.

- **GIVEN** the docs after apply
- **WHEN** read
- **THEN** § Web Tabs reads `[current]` except the `rk present` paragraph, and the backlog entry exists

### Non-Goals

- No backend, route, payload, or `internal/tmux` changes; no removal of Change 5 compat (`translateLegacyOptionKeys`, n-less `/present`, `@rk_win_url` dual-read).
- No `rk tab` CLI, `rk present` rewrite, or `rk code exec --tab` (Change 4).
- No detected-port chip; no consumption of `useHostServices()`.
- No page-`<title>`-derived tab labels; no drag-to-reorder; no per-tab zoom key; no LRU eviction of hidden frames.
- No new global keyboard chords.

### Design Decisions

#### One IframeWindow chrome, N frames
**Decision**: the web tile stays a single `IframeWindow` component that mounts one `<iframe>` per tab (hidden when inactive) with per-frame state and chrome bound to the active frame.
**Why**: the find/zoom/address-focus/open-external document CustomEvents rely on exactly one receiver per layout; N `IframeWindow` instances would each hear every event and need listener gating. One component also keeps the URL bar, find bar, and zoom control as one set of DOM nodes.
**Rejected**: N `IframeWindow` instances stacked with `hidden` — duplicated chrome, multi-receiver events, zoom buckets re-seeding per instance.
*Introduced by*: 260828-9kip-web-tab-strip

#### Frames keyed by URL, not slot index
**Decision**: `<iframe key={url}>`.
**Why**: `WebRemove` renumbers slots; keying by index would remount the surviving frames on every middle-close and defeat P3. Identity is the URL per spec.
**Rejected**: index keys (remount storm) and stable client-side ids (a second identity the spec deliberately avoids).
*Introduced by*: 260828-9kip-web-tab-strip

#### Client selects after add
**Decision**: after `onAddTab` resolves `{index}`, the component calls `onSelectTab(index)`.
**Why**: `WebAdd` sets `_active` only when the family was empty ("add is not show"); a UI `+` is a user intent to look at the new tab.
**Rejected**: a server-side `?show=1` flag (backend change, out of scope).
*Introduced by*: 260828-9kip-web-tab-strip

#### Address bar replaces, `+` adds
**Decision**: Enter on the bar writes `@rk_win_web_<active>`; only `+` (and the palette new-tab action) POST `…/web`.
**Why**: user decision at intake — browser semantics, spec § Web Tabs wording, and typing a URL never silently grows a strip.
**Rejected**: the plan's "always POST …/web" parenthetical.
*Introduced by*: 260828-9kip-web-tab-strip

## Tasks

### Phase 1: Setup

- [x] T001 Baseline: on a clean `origin/main` worktree state, run `just test-e2e "web-tile-chrome|web-tile-find|web-tile-zoom|web-view-lens|surface-layout|present-auto-expand"` (or the per-spec form) and record pass/fail per spec in `fab/changes/260828-9kip-web-tab-strip/notes-baseline.md`; `web-view-lens` :194/:412/:444/:521 are expected failures <!-- R17 -->
- [x] T002 [P] Add `addWebTab`, `removeWebTab`, `selectWebTab` to `app/frontend/src/api/client.ts` beside `setWindowOptions`, rejecting non-2xx with the server's `error` text; add unit cases in `app/frontend/src/api/client.test.ts` (request shape, 201 body, 409 message) <!-- R1 -->
- [x] T003 [P] Add `webTabTitle` to `app/frontend/src/lib/web-url.ts`, fix the two stale `@rk_win_url` header mentions, and pin the R2 table in `app/frontend/src/lib/web-url.test.ts` <!-- R2 -->
- [x] T004 [P] Add `stampWebTabs(windowId, urls, active, opts)` to `app/frontend/tests/e2e/_tmux.ts` beside `stampWebTab` <!-- R17 -->

### Phase 2: Core Implementation

- [x] T005 Refactor `app/frontend/src/components/iframe-window.tsx` props to `tabs`/`active` + verb callbacks; derive `activeIndex`/`activeUrl`; onboarding on `tabs.length === 0`; keep the 0–1-tab DOM byte-identical (no strip). Update `app/frontend/src/components/surface-layout.tsx` `case "web"` and the `surface-layout.test.tsx` stub so the tree compiles (`npx tsc --noEmit`) <!-- R3, R4, R14 -->
- [x] T006 Per-frame state in `iframe-window.tsx`: extract frame-scoped state (ref, loading, crossOrigin, tracked location, page meta, probe/error) into a per-frame structure; mount one `<iframe key={url} hidden={n !== activeIndex}>` per tab; bind chrome, CustomEvent listeners, zoom bucket/scale wrapper, progress line, and error surface to the active frame; probe on mount + activation only <!-- R12, R13 -->
- [x] T007 Strip UI in `iframe-window.tsx`: `web-tab-strip` tablist above the URL bar at `tabs.length >= 2`, tab items (label/title/dot/×), active/inactive styling, `+` with full-state Tip; select/close click handlers with `stopPropagation` on × <!-- R5, R6, R7 -->
- [x] T008 `+` and new-tab arm in `iframe-window.tsx`: draft-vs-active routing, `onAddTab` → `onSelectTab(index)`, arm/disarm on focus/Escape/blur, Enter routing (`onWriteUrl` vs `onAddTab`), same-URL no-op, error text into the `role="alert"` slot <!-- R8, R9 -->
- [x] T009 Roving-focus keyboard on the strip (←/→/Home/End/Enter/Space/Delete/Backspace, `tabIndex` discipline) <!-- R10 -->
- [x] T010 Unit tests in `app/frontend/src/components/iframe-window.test.tsx`: extend `renderIframe`, re-point the onboarding cases, add R3–R10/R12/R13 cases incl. the 1-tab DOM-equality check, single-listener assertion, N-frame `src` stability, 409 alert text; run `just test-frontend` scoped to the file <!-- R16 -->

### Phase 3: Integration & Edge Cases

- [x] T011 Wire `surface-layout.tsx` verbs (`selectWebTab`/`removeWebTab`/`addWebTab`) and add optimistic `webActive`/`webTabs` overrides via the Zustand window store's optimistic-action pattern (local `repointActive` mirror, revert + toast on rejection, add not optimistic); update `surface-layout.web-integration.test.tsx` to a 2-tab window and `surface-layout.test.tsx` prop assertions <!-- R14, R15 -->
- [x] T012 Register `Web: Next tab` / `Web: Previous tab` / `Web: Close tab` / `Web: New tab from address` in the command palette registry following the `Web: Zoom *` pattern (enablement predicates, wrap semantics, new-tab arm via `web-address:focus`); add palette unit cases <!-- R11 -->
- [x] T013 Write `app/frontend/tests/e2e/web-tabs.spec.ts` (file header + Proves/Steps per test; five tests per R17; `stubProxyPorts`; `stampWebTabs`; ≤1 three-frame test, no second tile) and run `just test-e2e "web-tabs.spec.ts"`; then run the six baselined specs together and compare to T001 <!-- R17 -->

### Phase 4: Polish

- [x] T014 `docs/specs/ui-state.md` § Web Tabs → `[current]` (except the `rk present` paragraph), header status line, deferral annotation on the port-affordance sentence; add the backlog entry to `fab/backlog.md` <!-- R18 -->
- [x] T015 Gates: `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, `just build` <!-- R16 -->

## Execution Order

- T005 blocks T006–T009 (prop contract first); T006 blocks T007 (frames before strip so the strip's chrome binds to per-frame state)
- T010 after T009; T011 after T005 (compiles) and T010 (component contract settled)
- T013 after T011 + T012 + T004; T015 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `addWebTab`/`removeWebTab`/`selectWebTab` exist in `client.ts`, hit the three POST routes with `?server=`, and reject with the server `error` text
- [x] A-002 R2: `webTabTitle` exists, is pure, and the six-row table passes in `web-url.test.ts`
- [x] A-003 R3: `IframeWindow` accepts `tabs`/`active`/verb props, has no `server`/`windowId` props, and clamps an out-of-range `active`
- [x] A-004 R4: onboarding renders iff `tabs.length === 0`
- [x] A-005 R5: strip absent at 0–1 tabs, present at ≥2, above the URL bar
- [x] A-006 R6: tabs show `webTabTitle`, `title=displayForm`, kind dot, `×`; `+` disabled with Tip at 8
- [x] A-007 R7: tab click → `onSelectTab(n)`; `×` → `onCloseTab(n)` only
- [x] A-008 R8: `+` routes (differing draft → add then select; empty/same → focus + arm); errors land in the alert slot
- [x] A-009 R9: Enter → `onWriteUrl` (never `onAddTab` outside the arm); same-URL is a no-op
- [x] A-010 R10: roving tablist keys behave as specified
- [x] A-011 R11: four `Web: … tab` palette actions registered with correct enablement and wrap
- [x] A-012 R12: one `<iframe>` per tab, keyed by URL, only the active un-hidden, `src` stable across selection
- [x] A-013 R13: chrome + CustomEvents bind to the active frame; exactly one `web-find:open` listener per tile; inactive frames run no probe timer
- [x] A-014 R14: `surface-layout.tsx` passes the family + verbs; `onWriteUrl` still writes `@rk_win_web_<active>`
- [x] A-015 R15: optimistic select/remove with SSE reconcile and revert-on-reject toast; add not optimistic
- [x] A-016 R18: `ui-state.md` § Web Tabs `[current]` except `rk present`; deferral note; backlog entry present

### Behavioral Correctness

- [x] A-017 R5: the 1-tab URL-bar row DOM equals the pre-change component's (chrome unchanged for single-tab windows)
- [x] A-018 R9: typing a new URL in the bar on a 1-tab window does not create a second tab
- [x] A-019 R12: switching tabs does not reload a frame (element identity and `src` preserved)

### Scenario Coverage

- [x] A-020 R17: `web-tabs.spec.ts` exists with header + Proves/Steps blocks, five tests pass on the isolated rig
- [x] A-021 R17: the six baselined web specs match or improve on the T001 baseline
- [x] A-022 R16: `just test-frontend` green; `npx tsc --noEmit` clean; `just build` succeeds

### Edge Cases & Error Handling

- [x] A-023 R8: 409 "web tabs full (8)" text reaches the alert; `+` disabled at 8
- [x] A-024 R3: `active` out of range or 0 with a non-empty family renders tab 1 / clamps, never onboarding
- [x] A-025 R15: a rejected select/remove POST reverts the optimistic override and toasts
- [x] A-026 R13: a cross-origin active frame hides back/forward; switching to a same-origin frame shows them

### Code Quality

- [x] A-027 Pattern consistency: new code follows the surrounding component/client/test idioms (Tip/TipGroup, testids, `withServer`, colocated tests)
- [x] A-028 No unnecessary duplication: `displayForm`/`classifyAddress`/`normalizeAddressInput`/`toProxySrc` reused; no second HTTP helper
- [x] A-029 Type narrowing over assertions: no new `as` casts where a guard works
- [x] A-030 No magic numbers: the 8 cap and strip threshold are named constants
- [x] A-031 No client polling: state arrives via SSE/`/ws/state`; no `setInterval` + fetch
- [x] A-032 Comment discipline: comments state invariants/cross-file contracts only; no narration, no change IDs
- [x] A-033 Tests accompany every behavior change (unit + e2e per code-quality.md)
- [x] A-034 No functions >50 lines without clear reason introduced in `iframe-window.tsx` (per-frame extraction keeps the component composable)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (The `url` prop of `IframeWindow` is superseded by `tabs`/`active` in place, not left behind; `activeWebUrl`/`hasWebUrl` in `lib/window-view.ts` remain in use by the tile header and the palette/content gates; the old single-frame effects were refactored into `WebFrame` rather than duplicated.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Per-frame state lives in a `Map<url, FrameState>`/per-frame child hook inside `IframeWindow`; the exact shape is the implementer's | Intake fixes the invariant (one chrome, N frames), not the data structure | S:65 R:85 A:80 D:70 |
| 2 | Confident | Optimistic overrides ride the Zustand window store's existing optimistic-action pattern; local `repointActive` mirror is display-only | Change 2 precedent for `layout`; server authoritative | S:65 R:85 A:80 D:80 |
| 3 | Confident | `Web: New tab from address` reuses `web-address:focus` with a new-tab arm rather than a new event | Fewer events; the arm already exists for `+` | S:55 R:90 A:80 D:70 |
| 4 | Certain | `×` is always visible on the active tab and on coarse pointers; hover/focus-revealed elsewhere | Playwright pointer-events hover gate lesson; touch has no hover | S:70 R:95 A:90 D:85 |
| 5 | Certain | e2e seeds via raw `tmux set-option` (`stampWebTabs`) rather than the verb routes | `_tmux.ts` pattern; Change 4 owns the CLI | S:85 R:95 A:95 D:95 |
| 6 | Confident | Inactive frames skip the probe timer; probe on mount + activation | P3 keeps frames warm; timers ×8 would be wasteful | S:60 R:90 A:80 D:75 |

6 assumptions (2 certain, 4 confident, 0 tentative).
