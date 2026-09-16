# Plan: Web Frame Engine Seam

**Change**: 260916-fxt1-web-frame-engine-seam
**Intake**: `intake.md`

## Requirements

### Frontend: Engine Contract (`app/frontend/src/lib/web-frame-engine.ts`)

#### R1: A pure contract module defines the engine seam
`app/frontend/src/lib/web-frame-engine.ts` SHALL be a new module exporting `WebFrameEngineKind` (`"iframe"` only in this change), `WebFrameCapabilities` (`history`, `find`, `meta`, `zoomGestures`, `devtools` — five required booleans), `TileError` (moved verbatim from `iframe-window.tsx`), `FrameChromeState` (`loading`, `supports`, `trackedLocation`, `title`, `favicon`, `tileError`, `canGoBack`, `canGoForward`, `find: { active: number; total: number } | null`), `FindOptions` (`{ forward: boolean; findNext: boolean }`), `WebFrameEngineHandle` (`kind`, `reload`, `retry`, `back`, `forward`, `find(query, opts)`, `stopFind`, optional `openDevTools`), `WebFrameEngineProps` (`url`, `active`, `zoom`, `wireGestureListeners`, `onState`, `onLoad`, `registerHandle`, `unregisterHandle`, `interactRef`, `reclaimRef`), `ChordEvent` (`key`, `code`, `ctrlKey`, `metaKey`, `shiftKey`, `altKey`), and the one helper `redispatchChord(e: ChordEvent): void` that dispatches a bubbling synthetic `KeyboardEvent("keydown", …)` on `document`. The module MUST NOT contain the identifier `crossOrigin` and MUST import React only as types.

- **GIVEN** the module is imported by the chrome, the iframe engine, and tests
- **WHEN** `npx tsc --noEmit` runs
- **THEN** every consumer type-checks against these exports and no runtime import of React exists in the module
- **AND** `redispatchChord({key:"k", code:"KeyK", metaKey:true, ctrlKey:false, shiftKey:false, altKey:false})` dispatches exactly one `keydown` on `document` with those six fields copied and `bubbles === true`

#### R2: The chrome renders per capability, never per origin
`iframe-window.tsx` MUST gate every content-dependent control on `FrameChromeState` fields only: the ◀ ▶ buttons render iff `!onboarding && supports.history` and carry `disabled={!canGoBack}` / `disabled={!canGoForward}`; the find bar receives `disabled={!supports.find}`. The file MUST NOT contain the identifiers `crossOrigin`, `contentDocument`, `contentWindow`, `HTMLIFrameElement`, or `checkFrame` after this change (the onboarding prose string "same-origin pages" is exempt).

- **GIVEN** a stub engine reporting `supports` all-false
- **WHEN** the chrome renders a non-onboarding tile
- **THEN** Back/Forward are absent, Refresh is present, the ⌕ button is present and enabled, and opening the find bar shows it disabled with the hint "page is cross-origin — find unavailable"
- **GIVEN** a stub engine reporting `supports.history: true`, `canGoBack: false`, `canGoForward: true`
- **WHEN** the chrome renders
- **THEN** Back renders disabled and Forward renders enabled

### Frontend: Iframe Engine (`app/frontend/src/components/web-frame-iframe.tsx`)

#### R3: Today's `WebFrame` becomes `WebFrameIframe`, implementing the contract verbatim
`components/web-frame-iframe.tsx` SHALL export `WebFrameIframe(props: WebFrameEngineProps)` whose body is today's `WebFrame` (plus `frameFavicon` and `ICON_REL_PATTERN`) moved with no behavioral edits beyond the contract's renames. `supports` SHALL derive from the same-origin attach probe on every attach: `history = find = meta = zoomGestures = !crossOrigin`, `devtools = false`; `crossOrigin` stays a file-local state that still selects real reload vs the about:blank bounce. The engine SHALL report `canGoBack = canGoForward = supports.history`. The rendered `<iframe>` MUST be unchanged: `src={toProxySrc(url)}`, `hidden={!active}`, the `hidden` class under an active `tileError`, the compensated `width/height` + `transform: scale(zoom)` style at `zoom !== 1` and the plain 100% style at `zoom === 1` or inactive, `title="Proxied content"`, and the identical `sandbox` token list.

- **GIVEN** a mounted `WebFrameIframe` whose iframe is same-origin (jsdom default)
- **WHEN** the iframe fires `load`
- **THEN** `onState` reports `supports` = `{history: true, find: true, meta: true, zoomGestures: true, devtools: false}`, `canGoBack === true`, `canGoForward === true`, `loading === false`
- **GIVEN** the iframe's `contentDocument`/`contentWindow` getters throw
- **WHEN** it fires `load`
- **THEN** `onState` reports all five `supports` flags false, `canGoBack === false`, `title === null`, `favicon === null`, `trackedLocation === null`

#### R4: Every probe lives inside the iframe engine
The `checkFrame(url)` refusal probe for `external` addresses (→ `refused` / `unreachable`), the `fetch(toProxySrc(url))` 502 read for `proxy` addresses (→ `dead-port`), the `probeNonce` retry bump, and the same-origin `location`/`title`/favicon reads on `load` SHALL live in `web-frame-iframe.tsx` and nowhere else. The chrome consumes only the reported `tileError`, `trackedLocation`, `title`, `favicon`.

- **GIVEN** an active engine for `https://example.com/` and `checkFrame` resolving `{reachable: true, embeddable: false, reason: "X-Frame-Options: DENY"}`
- **WHEN** the probe resolves
- **THEN** `onState` reports `tileError = {kind: "refused", host: "example.com", reason: "X-Frame-Options: DENY"}` and `loading === false`
- **GIVEN** an active engine for `http://localhost:4000/` and the proxied fetch answering 502
- **WHEN** the probe resolves
- **THEN** `onState` reports `tileError = {kind: "dead-port", port: 4000}`
- **AND** a `present`/`relative` address runs no probe and reports `tileError === null`

#### R5: Find is an engine command; the chrome owns only the open state and the query
The engine SHALL own the match set, the active index, and the Highlight-API/`window.find()` fallback flag, driven by `handle.find(query, {forward, findNext})` and `handle.stopFind()`: `findNext: false` re-collects matches for `query` (active resets to 0), applies highlights (or the fallback), scrolls to the first match, and reports `find: {active: 0, total}`; `findNext: true` steps with wrap via `stepMatch` and re-applies (Highlight API) or calls `findWithWindow(win, query, !forward)` (fallback), reporting the new `active`; `stopFind()` clears highlights and reports `find: null`. When `!supports.find`, `find` is a no-op that reports `find: null`. Every `load` attach SHALL clear highlights and the engine's match state and then fire `onLoad(url)`.

- **GIVEN** a same-origin frame document containing three occurrences of "foo" and an open find bar
- **WHEN** the chrome calls `find("foo", {forward: true, findNext: false})`
- **THEN** the engine reports `find = {active: 0, total: 3}` and highlights are applied to the frame
- **WHEN** the chrome then calls `find("foo", {forward: true, findNext: true})` three times
- **THEN** the reported `active` goes 1 → 2 → 0 (wrap)
- **WHEN** the chrome calls `stopFind()`
- **THEN** the engine reports `find = null` and the frame carries no highlights
- **GIVEN** an active search and a frame navigation
- **WHEN** the iframe fires `load`
- **THEN** the engine's matches are cleared and `onLoad(url)` fires once

#### R6: Chord reclaim and the interaction seam stay engine-internal
The capture-phase `pointerdown`/`keydown` listeners on the same-origin `contentDocument`, the window-blur fallback, the `interactRef.current?.()` report, and the reclaim (predicate from `reclaimRef.current`; a match is `preventDefault` + `stopImmediatePropagation` + `redispatchChord(...)`) SHALL live in the engine, byte-equivalent to today's behavior; the inline `document.dispatchEvent(new KeyboardEvent(...))` is replaced by the shared `redispatchChord` helper.

- **GIVEN** a mounted engine with `reclaimRef.current = (e) => e.metaKey && e.key === "k"`
- **WHEN** a `keydown` for ⌘K fires in the frame document
- **THEN** the frame event is default-prevented and a synthetic bubbling `keydown` with `metaKey && key === "k"` reaches a `document` listener, and `interactRef.current` was called first
- **WHEN** a plain `keydown` "a" fires
- **THEN** it is not prevented and no synthetic event is dispatched, but `interactRef.current` is still called

#### R7: Navigation commands ride the handle
`reload` SHALL perform today's `refresh` (same-origin `contentWindow.location.reload()`, else the about:blank bounce with `setTimeout(0)`), `retry` today's `retry` (clear `tileError`, set loading, bump the probe nonce, reload), `back`/`forward` today's `navigate(-1|1)` on `contentWindow.history`. The handle SHALL be registered via `registerHandle(url, handle)` in the effect that today calls `registerFrame`, and unregistered on cleanup. The handle MUST NOT expose the iframe element.

- **GIVEN** a registered handle for a same-origin frame
- **WHEN** `handle.reload()` is called
- **THEN** `contentWindow.location.reload` is invoked and `onState` reports `loading === true`
- **WHEN** `handle.back()` is called
- **THEN** `contentWindow.history.back` is invoked

### Frontend: Chrome (`app/frontend/src/components/iframe-window.tsx`)

#### R8: The chrome mounts one engine per tab through a factory
`iframe-window.tsx` SHALL export `IframeWindow` with its props interface unchanged, mount `const Engine = createEngine(ENGINE_KIND)` where `createEngine(kind: WebFrameEngineKind): ComponentType<WebFrameEngineProps>` returns `WebFrameIframe` for `"iframe"`, and render `<Engine key={tabUrl} url={tabUrl} active={…} zoom={zoom} wireGestureListeners={…} onState={handleChromeState} onLoad={handleFrameLoad} registerHandle={…} unregisterHandle={…} interactRef={…} reclaimRef={…} />` per tab inside the existing `web-zoom-frame-wrapper` div. `handleChromeState`'s equality guard SHALL compare the new field set (`supports` and `find` by value). `surface-layout.tsx` MUST NOT change.

- **GIVEN** `tabs = ["http://localhost:8080/docs", "https://example.com/"]`
- **WHEN** `IframeWindow` renders
- **THEN** two iframes mount (one hidden), `getByTitle("Proxied content")` still resolves the active one, and a tab select flips `hidden` without changing `src` or element identity
- **AND** `git diff --stat` shows no change to `surface-layout.tsx`

#### R9: The chrome's find flow drives the engine handle
The chrome SHALL keep `findOpen` and `findQuery` only. While the bar is open, a `findQuery` change or an active-url change SHALL call `handle.find(findQuery, {forward: true, findNext: false})` for a non-empty query and `handle.stopFind()` for an empty one; closing the bar SHALL call `stopFind()`; `onNext`/`onPrev` SHALL call `find(findQuery, {forward: true|false, findNext: true})`; `handleFrameLoad(frameUrl)` for the ACTIVE url SHALL reset `findQuery` to `""`. `FindBar` SHALL receive `matchIndex = state.find?.active ?? 0`, `matchCount = state.find?.total ?? 0`, `disabled = !supports.find`, and `statusText = !supports.find ? "page is cross-origin — find unavailable" : undefined` (copy verbatim). The ⌕ button stays rendered and enabled for every non-onboarding tile.

- **GIVEN** an open find bar on a same-origin tile with three matches for "foo"
- **WHEN** the user types "foo", presses Enter twice, then Shift+Enter
- **THEN** the counter reads 1/3 → 2/3 → 3/3 → 2/3 (today's `web-tile-find.spec.ts` cycle-with-wrap contract)
- **GIVEN** the bar is open and the active frame navigates
- **WHEN** `onLoad` fires for the active url
- **THEN** the query input is empty and the counter is cleared

#### R10: Header meta, address display, error surface, and progress read engine state regardless of engine
`onPageMeta({title})` SHALL fire from `activeChrome?.title` on url/title changes; `rawAddress = trackedLocation ?? url` drives the ↗ button, the edit reveal, and the `web-open-external` event; the error surface renders `tileError` with today's copy and buttons (Retry → `handle.retry()`, Open in browser → `window.open`); the progress line renders while `activeChrome?.loading ?? !onboarding`. None of these consult the engine kind.

- **GIVEN** a stub engine pushing `state.title = "Docs"` for the active tab
- **WHEN** the chrome renders
- **THEN** the tab label reads "Docs" and `onPageMeta` was called with `{title: "Docs"}`
- **GIVEN** a stub engine pushing `tileError = {kind: "dead-port", port: 4000}`
- **WHEN** the chrome renders
- **THEN** "nothing listening on :4000" renders with a Retry button whose click calls the stub handle's `retry`

#### R11: Zero behavior change is proven by the unchanged suites
Every existing Vitest test (re-homed or not) and the six e2e specs `web-tabs`, `web-tile-chrome`, `web-tile-find`, `web-tile-zoom`, `web-view-lens`, `present-viewer` SHALL pass with no edits to any `test()` body or intent comment. The stored `@rk_win_web_<n>` contract, `toProxySrc`, the backend, `find-bar.tsx`, `lib/web-url.ts`, `lib/web-zoom.ts`, `lib/find-in-page.ts`, `lib/zoom-gesture.ts`, `lib/keybindings.ts`, `api/client.ts` MUST NOT change.

- **GIVEN** the finished implementation
- **WHEN** `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, and `just test-e2e "e2e/<spec>.spec.ts"` for each of the six specs run
- **THEN** all are green and `git diff --name-only` against the merge-base lists only the files named in this plan (plus `fab/`)

### Tests

#### R12: The test file splits along the seam and adds a stub-engine chrome test
`web-frame-iframe.test.tsx` (new) SHALL hold the engine-internal subjects from `iframe-window.test.tsx` — the `onInteract` seam block, the chord reclaim block, the probe/error-state cases, same-origin title/favicon/location reporting and cross-origin clearing, `supports`/`canGoBack` derivation, the handle's `find`/`stopFind`/`reload`/`back`, per-load reset + `onLoad`, and the scale style — rendering `WebFrameIframe` directly with a recording `onState`/`onLoad`/`registerHandle` harness (the `vi.mock("@/api/client")` of `checkFrame` moves with them). `iframe-window.test.tsx` keeps every chrome subject and gains a stub-engine block (module-mocking `@/components/web-frame-iframe`) asserting: (a) all-false `supports` ⇒ Back/Forward absent, find bar disabled with the hint, Refresh present; (b) `history: true` + `canGoBack: false` ⇒ Back disabled; (c) a pushed `title` renders as the tab label and reaches `onPageMeta`; (d) Refresh/Back/Forward/Retry call the handle's `reload`/`back`/`forward`/`retry`; (e) typing calls `find(q, {findNext: false})`, Enter calls `find(q, {forward: true, findNext: true})`, close calls `stopFind`, and a pushed `find: {active: 1, total: 3}` renders `2/3`. No existing `it(` is deleted: the combined `it(` count across both files MUST be ≥ the pre-change count of `iframe-window.test.tsx`.

- **GIVEN** the pre-change `grep -c "^\s*it(" iframe-window.test.tsx` value N
- **WHEN** the split is done
- **THEN** `grep -c` over `iframe-window.test.tsx` + `web-frame-iframe.test.tsx` ≥ N + 5 and `just test-frontend` is green

#### R13: The contract helper has a colocated unit test
`web-frame-engine.test.ts` SHALL cover `redispatchChord` (fields copied, `bubbles: true`, dispatched on `document`).

- **GIVEN** a `document` `keydown` spy
- **WHEN** `redispatchChord` runs with ⌘K
- **THEN** the spy sees one event with `key === "k"`, `metaKey === true`, `bubbles === true`

### Non-Goals

- Any native/Electron engine, bridge, or `"native"` kind member — change 3
- Overlay presence, hide-on-modal — change 2
- A palette entry or header verb for devtools; `supports.devtools`/`supports.zoomGestures` have no chrome consumer here — change 4
- Spec edits (`window-views.md`, `surface-layout.md`, `right-panel.md`) — change 5
- The `code` lens (`CodeSurface` keeps its own iframe seam)
- Any change to `@rk_win_web_<n>`, `/proxy/{port}`, `/api/frame-check`, or the backend

### Design Decisions

#### The chrome renders per capability, never per origin
**Decision**: `IframeWindow` gates every content-dependent control on `FrameChromeState.supports.*` (plus `canGoBack`/`canGoForward`, `find`) reported by the mounted engine; the word `crossOrigin` exists only inside the iframe engine, where it derives the flags and selects the reload strategy.
**Why**: a second engine's answers differ per feature, not per origin (a native renderer has history and meta on any origin, find via `findInPage`, no scale wrapper); a chrome-level origin probe misreports on a renderer that does not embed — the spike painted "github.com refuses embedding" over a working native view.
**Rejected**: `if (engine === "native")` branches in the chrome (duplicates every control's logic per engine); keeping `crossOrigin` as a pseudo-capability (wrong axis — it would be false on native for a page that still cannot find).
*Introduced by*: 260916-fxt1-web-frame-engine-seam

#### Probes are engine-owned
**Decision**: the frame-check refusal probe, the proxied-port 502 fetch, and the same-origin location/document reads live in `web-frame-iframe.tsx`; the chrome consumes only reported `tileError`/`trackedLocation`/`title`/`favicon`.
**Why**: each probe answers an iframe-specific question (can this origin be embedded; does the proxied upstream listen; is the document readable); on another engine the question is meaningless or answered by the engine's own events.
**Rejected**: a chrome-level probe gated per engine kind (the spike's failure mode — the gate is one more per-engine branch in the chrome).
*Introduced by*: 260916-fxt1-web-frame-engine-seam

#### Find is an engine command with a chrome-owned query
**Decision**: `handle.find(query, {forward, findNext})` / `handle.stopFind()` mirror Electron's `findInPage` / `stopFindInPage`; the engine owns matches, active index, and highlights and reports `find: {active, total}`; the chrome owns `findOpen` and `findQuery` and resets the query on the active frame's `onLoad`.
**Why**: the iframe engine's Highlight-API machinery reaches into the frame document, which only the engine may touch; the native engine's `found-in-page` maps onto the same `{active, total}` shape with `activeMatchOrdinal - 1`.
**Rejected**: leaving match state in the chrome and passing the frame document out through the handle (re-couples the chrome to `contentDocument`).
*Introduced by*: 260916-fxt1-web-frame-engine-seam

#### `onLoad` is a callback edge, not a state level
**Decision**: the engine props carry `onLoad(url)` beside `onState`; the chrome uses it to reset its find query.
**Why**: "a navigation happened" is an edge the chrome must react to once; encoding it as a state field (a counter, or `find` flipping to null) would be either a synthetic level or ambiguous with `stopFind`.
**Rejected**: a `loadCount` field on `FrameChromeState`; deriving the reset from `find` becoming `null`.
*Introduced by*: 260916-fxt1-web-frame-engine-seam

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/lib/web-frame-engine.ts` with the contract exactly as `intake.md` § What Changes 1 specifies (`WebFrameEngineKind`, `WebFrameCapabilities`, `TileError`, `FrameChromeState`, `FindOptions`, `WebFrameEngineHandle`, `WebFrameEngineProps`, `ChordEvent`, `redispatchChord`); doc comments state constraints only (no change-ID citations). Add `app/frontend/src/lib/web-frame-engine.test.ts` covering `redispatchChord`. Run `cd app/frontend && npx tsc --noEmit`. <!-- R1, R13 -->

### Phase 2: Core Implementation

- [x] T002 Create `app/frontend/src/components/web-frame-iframe.tsx`: move today's `WebFrame` (iframe-window.tsx ~164–470), `frameFavicon`, `ICON_REL_PATTERN` verbatim into `export function WebFrameIframe(props: WebFrameEngineProps)`; derive `supports` from the attach probe (`history/find/meta/zoomGestures = !crossOrigin`, `devtools = false`), keep `crossOrigin` file-local for the reload strategy; report `onState(url, {loading, supports, trackedLocation, title, favicon, tileError, canGoBack: supports.history, canGoForward: supports.history, find})`; keep every probe (`checkFrame`, the 502 fetch, the same-origin reads, `probeNonce`) here; replace the inline synthetic-KeyboardEvent dispatch with `redispatchChord`; register `{kind: "iframe", reload, retry, back, forward, find, stopFind}` via `registerHandle`/`unregisterHandle`; render the `<iframe>` unchanged (src/hidden/class/style/title/sandbox). <!-- R3, R4, R6, R7 -->
- [x] T003 Move the find machinery into `web-frame-iframe.tsx`: engine-local `findMatches`/`findActive`/`highlightApiRef` state, `find(query, {forward, findNext})` (collect + highlight/fallback + scroll, or step with wrap), `stopFind()` (clear highlights, reset, report `find: null`), the `!supports.find` no-op, and the per-load reset (existing `clearHighlights` in attach + match state reset) followed by `onLoad(url)`; report `find` through `onState`. Reuse `collectMatches`/`stepMatch`/`applyHighlights`/`clearHighlights`/`scrollToMatch`/`findWithWindow` from `@/lib/find-in-page` unchanged. <!-- R5 -->
- [x] T004 <!-- rework: review must-fix — the onboarding `://` glyph lost its `mb-2` class in the split (iframe-window.tsx:1300); restore the pre-change className verbatim, zero other edits to that block --> Refactor `app/frontend/src/components/iframe-window.tsx` to chrome only: delete the moved code and the local `TileError`/`FrameChromeState`/`FrameHandle`/`WebFrameProps` types; import types from `@/lib/web-frame-engine`; add `const ENGINE_KIND: WebFrameEngineKind = "iframe"` and `createEngine(kind)` returning `WebFrameIframe`; mount `<Engine …/>` per tab with the contract props; rewrite `handleChromeState`'s equality guard for the new field set (compare `supports` and `find` by value); render ◀ ▶ iff `!onboarding && supports.history` with `disabled={!canGoBack}`/`disabled={!canGoForward}`; route Refresh/Retry/Back/Forward through the registered handle; keep `onPageMeta`, `rawAddress`, error surface, progress line, onboarding, tab strip, zoom control + persistence, CustomEvent receivers unchanged. Drop imports that are no longer used (`checkFrame`, `proxyPortOf`, the `find-in-page` collect/highlight functions); keep `ApiError` and `WEB_FIND_OPEN_EVENT`. <!-- R2, R8, R10 -->
- [x] T005 Rewrite the chrome's find flow in `iframe-window.tsx`: state shrinks to `findOpen` + `findQuery`; effects call `handle.find(findQuery, {forward: true, findNext: false})` / `handle.stopFind()` on query change, active-url change, and bar close; `onNext`/`onPrev` call `find(findQuery, {forward, findNext: true})`; `handleFrameLoad` resets `findQuery` for the active url; `FindBar` gets `matchIndex`/`matchCount` from `activeChrome?.find`, `disabled={!supports.find}`, and the verbatim `statusText` copy; the ⌕ button stays enabled. <!-- R9 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Grep gate + type check: `grep -nE "crossOrigin|contentDocument|contentWindow|HTMLIFrameElement|checkFrame" app/frontend/src/components/iframe-window.tsx` returns nothing (the onboarding prose "same-origin pages" is prose, not an identifier); `grep -n crossOrigin app/frontend/src/lib/web-frame-engine.ts` returns nothing; `git diff --stat` shows no change to `surface-layout.tsx`, `find-bar.tsx`, or any `lib/` file other than the new one; `cd app/frontend && npx tsc --noEmit` is clean. <!-- R2, R4, R8, R11 -->
- [x] T007 [P] Create `app/frontend/src/components/web-frame-iframe.test.tsx`: move the engine-subject tests out of `iframe-window.test.tsx` (onInteract seam block, chord reclaim block, error-state probe cases, same-origin title/favicon/location reporting + cross-origin clearing, load progress clearing on `load`) and re-target them at `WebFrameIframe` rendered directly with a recording harness (`onState` spy keyed by url, `onLoad` spy, `registerHandle` capturing the handle); move the `vi.mock("@/api/client")` for `checkFrame`; add cases for `supports`/`canGoBack` derivation (same-origin vs throwing getters), `find`/`stopFind` reporting and wrap-stepping, per-load reset + `onLoad`, `reload` real-reload vs bounce, `back`/`forward`, and the scale style at `zoom !== 1`. <!-- R12, R3, R4, R5, R6, R7 -->
- [x] T008 <!-- rework: review should-fix — the refused/unreachable error-surface render branches (iframe-window.tsx ~1247–1286) are asserted nowhere after the split; add stub-engine pushes for both kinds asserting the copy + the "Open in browser" button; also re-export the real WEB_FRAME_IFRAME_DEFAULT_CAPABILITIES through importOriginal in the module mock instead of re-declaring the literal --> [P] Add the stub-engine chrome block to `app/frontend/src/components/iframe-window.test.tsx` (or a sibling `iframe-window.stub-engine.test.tsx` if module-mock scoping requires a separate file): `vi.mock("@/components/web-frame-iframe")` with a stub `WebFrameIframe` that pushes a test-controlled `FrameChromeState` through `onState` and registers a `vi.fn()` handle; assert R2's two scenarios, R10's two scenarios, R9's handle calls and the `2/3` counter from a pushed `find: {active: 1, total: 3}`. <!-- R12, R2, R9, R10 -->
- [x] T009 Trim `iframe-window.test.tsx` to chrome subjects <!-- before: 88, after: 76 + 29 --> (record the pre-change `grep -c "^\s*it(" app/frontend/src/components/iframe-window.test.tsx` count in this task's checkbox line when done — e.g. `<!-- before: N, after: A + B -->`), keep the shared `renderIframe` helper and the remaining `@/api/client` mock only if a chrome test still needs `ApiError`; verify the combined `it(` count across both files ≥ before + 5. <!-- R12 -->
- [x] T010 Run `just test-frontend` (the full Vitest suite, not touched-files-only) and fix every failure in the moved/new code; `surface-layout.test.tsx` and `surface-layout.web-integration.test.tsx` must stay green with their existing `@/api/client` mocks. <!-- R11 -->
- [x] T011 Run the six e2e specs one per invocation, in the `e2e/` path form: `just test-e2e "e2e/web-tabs.spec.ts"`, `just test-e2e "e2e/web-tile-chrome.spec.ts"`, `just test-e2e "e2e/web-tile-find.spec.ts"`, `just test-e2e "e2e/web-tile-zoom.spec.ts"`, `just test-e2e "e2e/web-view-lens.spec.ts"`, `just test-e2e "e2e/present-viewer.spec.ts"`; all must pass with no spec edits. <!-- R11 -->

### Phase 4: Polish

- [x] T012 Comment pass over the two new files and the trimmed chrome: comments state constraints and cross-file contracts (why the chrome must not read origin; why probes are engine-owned; why `onLoad` is an edge), never narrate the move or cite this change ID; moved comments that already carry historical `(2608xx-xxxx Rn)` citations may stay verbatim. Remove dead code/imports left by the split. Final `npx tsc --noEmit` + `just test-frontend`. <!-- R11 -->

## Execution Order

- T001 blocks T002; T002 blocks T003; T003 blocks T004; T004 blocks T005 (the chrome cannot compile against the engine until the handle shape exists)
- T006 runs after T005 and before any test work
- T007, T008 are parallel after T006; T009 follows both (it needs to know which tests moved)
- T010 after T009; T011 after T010 (do not start e2e on a red Vitest suite); T012 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `lib/web-frame-engine.ts` exports every contract type named in R1 plus `redispatchChord`, contains no `crossOrigin` identifier, and imports React only as types
- [x] A-002 R3: `components/web-frame-iframe.tsx` exports `WebFrameIframe(props: WebFrameEngineProps)` whose iframe render (src, hidden, class, style, title, sandbox) is byte-equivalent to the pre-change `WebFrame` render
- [x] A-003 R4: `checkFrame`, the proxied 502 fetch, `probeNonce`, and the same-origin location/title/favicon reads exist only in `web-frame-iframe.tsx`
- [x] A-004 R5: the engine handle exposes `find`/`stopFind` and reports `find: {active, total} | null`; no match/highlight state remains in `iframe-window.tsx`
- [x] A-005 R7: the handle exposes `reload`/`retry`/`back`/`forward` and no iframe element reference
- [x] A-006 R8: `iframe-window.tsx` mounts engines through `createEngine(ENGINE_KIND)` with the contract props; `IframeWindow`'s exported props interface is unchanged
- [x] A-007 R9: the chrome's find state is exactly `findOpen` + `findQuery`; FindBar props derive from `activeChrome.find` and `supports.find`
- [x] A-008 R13: `lib/web-frame-engine.test.ts` exists and covers `redispatchChord`

### Behavioral Correctness

- [x] A-009 R2: ◀ ▶ render iff `!onboarding && supports.history`, each with a `disabled` bound to `!canGoBack`/`!canGoForward`; the find bar's `disabled`/`statusText` derive from `supports.find`; the ⌕ button is rendered and enabled on every non-onboarding tile
- [x] A-010 R3: same-origin load reports `supports` `{history, find, meta, zoomGestures}` true and `devtools` false with both history flags true; throwing `contentDocument`/`contentWindow` getters report all flags false and null meta
- [x] A-011 R6: a reclaimed chord is prevented in the frame and re-dispatched on `document` through `redispatchChord`; non-matching keys pass through; `onInteract` reports first in both cases
- [x] A-012 R10: `onPageMeta`, `rawAddress`, the error surface (copy + Retry/Open buttons), and the progress line read only `FrameChromeState` fields

### Removal Verification

- [x] A-013 R2: `grep -nE "crossOrigin|contentDocument|contentWindow|HTMLIFrameElement|checkFrame" app/frontend/src/components/iframe-window.tsx` is empty; the local `TileError`/`FrameChromeState`/`FrameHandle`/`WebFrameProps`/`WebFrame`/`frameFavicon` definitions are gone from that file

### Scenario Coverage

- [x] A-014 R5: engine tests cover collect → `{active: 0, total: 3}`, three forward steps wrapping 1 → 2 → 0, `stopFind` → `null` + cleared highlights, and load → cleared matches + one `onLoad`
- [x] A-015 R9: the find-bar cycle-with-wrap and Escape-close Vitest cases pass unchanged, and `just test-e2e "e2e/web-tile-find.spec.ts"` is green
- [x] A-016 R12: the stub-engine block asserts all five listed behaviors (a)–(e)
- [x] A-017 R11: `just test-e2e` is green for each of `web-tabs`, `web-tile-chrome`, `web-tile-find`, `web-tile-zoom`, `web-view-lens`, `present-viewer` (one spec per invocation, `e2e/` path form), with no edits to any `test()` or intent comment

### Edge Cases & Error Handling

- [x] A-018 R4: `external` refused/unreachable and `proxy` 502 map to the three `TileError` kinds with the same host/port/reason values as before; `present`/`relative` addresses run no probe; a same-origin fetch failure (app server down) leaves `tileError` null
- [x] A-019 R5: `find` on a `!supports.find` engine is a no-op reporting `find: null`; an empty query reports no matches; the bar's `0/0` case renders as before
- [x] A-020 R9: an active-tab switch with the bar open re-issues `find` on the new engine; the query resets on the active frame's `onLoad` only (an inactive frame's load does not clear it)
- [x] A-021 R8: two tabs mount two iframes; selecting flips `hidden` with stable `src` and element identity (the P3 mount-once contract)

### Code Quality

- [x] A-022 Pattern consistency: new modules follow the `lib/` pure-module + colocated `.test.ts` and `components/` + `.test.tsx` conventions; ref-based late-binding (`interactRef`/`reclaimRef`) and the URL-keyed handle registry keep today's shape
- [x] A-023 No unnecessary duplication: `find-in-page`, `web-url`, `web-zoom`, `zoom-gesture` utilities are reused unchanged; no second re-dispatch implementation exists beside `redispatchChord`
- [x] A-024 Type narrowing over assertions: the contract uses discriminated unions/optional fields; no new `as` casts beyond the pre-existing cross-realm event narrowing moved verbatim
- [x] A-025 No comment narration: new comments state constraints/contracts, never the refactor's history or this change's ID
- [x] A-026 No god functions: `WebFrameIframe` and `IframeWindow` are the pre-existing bodies split, not grown; no new helper exceeds the surrounding code's typical size without reason
- [x] A-027 Tests cover changed behavior: `web-frame-engine.test.ts`, `web-frame-iframe.test.tsx`, and the stub-engine block exist and the combined `it(` count across `iframe-window.test.tsx` + `web-frame-iframe.test.tsx` ≥ the pre-change count + 5
- [x] A-028 Verification gates ran: `npx tsc --noEmit` clean, `just test-frontend` green (full suite), the six e2e specs green; no `just test`, no `git stash`, no commits made by apply

### Security

- [x] A-029 R3: the iframe `sandbox` attribute is byte-identical to the pre-change value (`allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads`) and no new script injection path into the frame exists beyond the pre-existing Highlight `<style>` element

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change is a move-style refactor: `WebFrame`, `FrameHandle`, the local `FrameChromeState`/`TileError`/`WebFrameProps` types, `frameFavicon`, and `ICON_REL_PATTERN` in `iframe-window.tsx` were deleted in the same diff that re-homed them (`web-frame-iframe.tsx` / `lib/web-frame-engine.ts`), and a re-review sweep of the touched area (repo-wide import grep for the removed symbols, unused-import check via `npx tsc --noEmit`, `find-in-page`/`web-url`/`web-zoom` utility reuse) found no surviving symbol, branch, config, or import left unused by the split.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `find.active` is the 0-based index (FindBar's `matchIndex`); a native engine maps `activeMatchOrdinal - 1` later | Keeps `FindBar` untouched; the mapping is one subtraction on the other side | S:75 R:85 A:90 D:75 |
| 2 | Confident | The reported `find` is `null` (not `{active: 0, total: 0}`) when no search is active or the query is empty; the chrome's `?? 0` defaults render the existing `0/0` | Either encoding renders the same; `null` keeps "no search" distinguishable from "zero matches" for the native engine's `found-in-page` | S:65 R:90 A:85 D:70 |
| 3 | Confident | The stub-engine block lives in `iframe-window.test.tsx` under a `vi.mock("@/components/web-frame-iframe")` unless Vitest's module-mock hoisting forces a sibling file; either placement satisfies R12 | The repo mocks `@/api/client` and `terminal-client` at module level already; a sibling file is the documented fallback | S:60 R:95 A:85 D:65 |
| 4 | Confident | Before an engine's first `onState`, the chrome renders as today for a missing map entry (`activeChrome === undefined`); no static default capability constant is added unless a test observes the pre-report frame | Today's first `onChromeState` fires in the frame's mount effect, before any assertion in the existing tests runs | S:60 R:90 A:80 D:65 |
| 5 | Certain | `WebFrameEngineKind` is `"iframe"` only; `createEngine` has one arm | Non-goal: no native code in this change; the union widens in change 3 | S:90 R:95 A:95 D:90 |
| 6 | Confident | `wireGestureListeners` stays a prop the chrome hands the engine (the engine wires it on same-origin documents only) rather than a handle command | It is the chrome's own gesture arm, invoked per document by the engine; a native engine ignores it and relays `zoom-changed` instead | S:70 R:85 A:85 D:75 |

6 assumptions (1 certain, 5 confident, 0 tentative).
