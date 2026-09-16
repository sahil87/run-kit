# Intake: Web Frame Engine Seam

**Change**: 260916-fxt1-web-frame-engine-seam
**Created**: 2026-09-16

## Origin

One-shot `/fab-new` invocation, autonomous (the user is not watching; the intake proceeds straight into `/fab-fff`, full lane). Change **1 of 5** in the plan `fab/plans/sahil/26-09-16-web-tile-native-browser.md` (§ Change 1 — engine seam), which itself came out of the 2026-09-16 `/fab-discuss` session on replacing the web tile's iframe with Electron's Chromium renderer in the desktop shell. Design authority: `docs/wiki/web-tile-native-browser-studies.html` (§3 engine contract, §8 parity matrix, §13 change stack).

> The web tile's chrome stops knowing it drives an iframe — a WebFrameEngine contract with capability flags sits between IframeWindow's chrome and the per-tab frame, today's frame becomes the iframe engine, and every control renders per capability instead of per crossOrigin. No behavior change.
>
> Full context lives in fab/plans/sahil/26-09-16-web-tile-native-browser.md — read the whole file before starting, especially "## Change 1 — engine seam" for the task detail, "## Standing context" and "## Decisions of record" for what applies across the whole plan, and the now-filled-in "## Spike verdict" section at the bottom — change 0's spike just landed and found one sharpened requirement for THIS change: every probe (frame-check, the 502 fetch, the same-origin location read) must move INTO the iframe engine, not stay at the chrome level (in the spike, a chrome-level probe painted "github.com refuses embedding" over a working native view until gated). This is change 1 of 5 in the plan — full lane.

Key decisions carried from the plan and the spike verdict (all apply here):

- **Two engines behind one chrome; the iframe engine is never removed.** This change builds the seam and moves today's frame behind it as the `iframe` engine. The `native` engine (Electron `WebContentsView`) arrives in change 3 and must be addable **without touching the chrome**.
- **The chrome renders per `supports.*` capability flags, never per `crossOrigin`.** `crossOrigin` is an iframe-engine implementation detail that derives the flags; it leaves the chrome-facing state entirely.
- **Every probe lives inside the iframe engine** (spike verdict, sharpened requirement): the `/api/frame-check` refusal probe (`checkFrame`), the proxied-port 502 fetch, the same-origin `contentWindow.location` read, the `contentDocument` reads (title, favicon, attach seam). The chrome only ever sees the engine's reported state (`tileError`, `trackedLocation`, `title`, `favicon`, `supports`).
- **Non-goals**: any native/Electron code; any change to the stored `@rk_win_web_<n>` contract or the backend; the `code` lens (`CodeSurface` keeps its own iframe); overlay presence (change 2); specs (change 5).

## Why

**Problem.** `app/frontend/src/components/iframe-window.tsx` (1761 lines) fuses two things: the web tile's **chrome** (tab strip, address bar with the submit ladder, find bar, zoom control, load progress line, error surface, onboarding panel, the document CustomEvent receivers, zoom-bucket persistence) and the **per-tab frame** (`WebFrame`: the `<iframe>` element, the same-origin attach seam, the chord reclaim, the refusal/dead-port probes, real reload vs the about:blank bounce, history back/forward, the scale wrapper). The chrome reads `crossOrigin` from each frame and branches on it directly — back/forward hide on `!crossOrigin`, the find bar disables on `crossOrigin`, `refresh` falls back on `crossOrigin` — and reaches into the frame's `iframeRef.current.contentDocument` for find-in-page. Everything the chrome knows about content is "is this a same-origin iframe or not".

**Consequence of not doing it.** Change 3 wants to mount a second engine (Electron's `WebContentsView`, driven over an IPC bridge) under the same chrome. With today's shape that means either duplicating the 1200-line chrome or threading `if (native) … else …` through every control — and the spike already demonstrated the failure mode: a chrome-level `checkFrame` probe painted "github.com refuses embedding" over a working native view, because the probe answers an iframe question (X-Frame-Options) that has no meaning for a renderer that does not embed. Origin is the wrong axis; **capability** is the right one (history? find? meta? zoom gestures? devtools?), and the native engine's answers differ from the iframe engine's on every one of them (native: history yes even cross-origin, find via `findInPage`, meta via `page-title-updated`, no scale wrapper).

**Why this approach.** A typed `WebFrameEngine` contract in a pure module, with today's `WebFrame` moved *verbatim* behind it as the `iframe` engine, is the smallest behavior-preserving cut that (a) makes the chrome engine-blind, (b) gives change 3 a file-disjoint landing spot (`components/web-frame-native.tsx` implementing the same contract), and (c) puts every iframe-specific probe where it cannot leak onto another engine. Alternatives rejected in the study § 12: stripping `X-Frame-Options` in a backend proxy (cookies at the rk origin, CSP breakage, an open proxy), replacing the iframe outright (breaks every non-shell viewer — browsers, PWAs, phones), `<webview>` as the primary engine, `BrowserView`. This change commits to none of the native decisions; it only makes them possible.

**Behavior contract.** Zero user-visible change. Every existing Vitest and e2e spec that drives the web tile must pass unchanged (no `test()` intent-comment edits expected). The stored `@rk_win_web_<n>` addressing, the `/proxy/{port}` path, `toProxySrc`, the `IframeWindow` props seam that `SurfaceLayout` mounts (`tabs`, `active`, `onWriteUrl`, `onSelectTab`, `onCloseTab`, `onAddTab`, `onMoveTab`, `onInteract`, `shouldReclaimChord`, `onPageMeta`) are all untouched.

## What Changes

### 1. `app/frontend/src/lib/web-frame-engine.ts` (new — pure types + one shared helper)

The engine contract. No React import beyond types (`ComponentType`, ref shapes); no DOM side effects except the one re-dispatch helper.

```ts
/** Which renderer sits behind the web tile's chrome. Only `iframe` exists in
 *  this change; the desktop shell's native engine widens the union later. */
export type WebFrameEngineKind = "iframe";

/** What an engine can do — the chrome renders per these, never per origin. */
export interface WebFrameCapabilities {
  /** back/forward are meaningful (chrome shows ◀ ▶). */
  history: boolean;
  /** find-in-page is available (chrome's find bar is live; false ⇒ the bar
   *  renders disabled with the hint). */
  find: boolean;
  /** the engine reports page title/favicon/tracked location. */
  meta: boolean;
  /** the engine wires ctrl-wheel / pinch gestures inside the content itself
   *  (the chrome's wrapper arm is unconditional and separate). */
  zoomGestures: boolean;
  /** the engine can open devtools (no chrome consumer until the native
   *  parity change). */
  devtools: boolean;
}

/** The tile's error surface — produced by an engine's probes, rendered by
 *  the chrome. Moved verbatim from iframe-window.tsx. */
export type TileError =
  | { kind: "refused"; host: string; reason: string }
  | { kind: "unreachable"; host: string; reason: string }
  | { kind: "dead-port"; port: number };

/** The chrome-relevant slice of one frame's state, reported up per engine
 *  instance. Replaces the old `crossOrigin` boolean with `supports`. */
export interface FrameChromeState {
  loading: boolean;
  supports: WebFrameCapabilities;
  /** Root-relative current location when readable (display-only, never POSTed). */
  trackedLocation: string | null;
  title: string | null;
  favicon: string | null;
  tileError: TileError | null;
  /** History boundary flags. The iframe engine has no signal, so it reports
   *  both equal to `supports.history` (today's semantics: a boundary click is
   *  a harmless no-op). */
  canGoBack: boolean;
  canGoForward: boolean;
  /** Find result for the engine's CURRENT query; null when no search is
   *  active. `active` is the 0-based index of the active match (FindBar's
   *  `matchIndex`), `total` the match count. */
  find: { active: number; total: number } | null;
}

export interface FindOptions {
  /** Direction for a step; ignored when starting a new search. */
  forward: boolean;
  /** false ⇒ (re)start the search for `query` (matches re-collected, active
   *  resets to the first); true ⇒ step to the next/previous match of the
   *  current query. */
  findNext: boolean;
}

/** Chrome → engine commands, registered per frame URL (the frame's identity). */
export interface WebFrameEngineHandle {
  kind: WebFrameEngineKind;
  reload: () => void;
  retry: () => void;
  back: () => void;
  forward: () => void;
  find: (query: string, opts: FindOptions) => void;
  stopFind: () => void;
  openDevTools?: () => void;
}

/** Props every engine component accepts — the chrome mounts one engine per
 *  tab through these. */
export interface WebFrameEngineProps {
  /** The stored tab address (the frame's identity — React key). */
  url: string;
  active: boolean;
  /** Content zoom factor (chrome-owned bucket); the engine applies it how it
   *  can (iframe: the scale wrapper). */
  zoom: number;
  /** The chrome's gesture arm, handed to the engine so it can wire the same
   *  continuous-zoom mapping inside the content when it is able to. */
  wireGestureListeners: (target: Document | HTMLElement) => () => void;
  onState: (url: string, state: FrameChromeState) => void;
  /** Fired once per completed main-frame load of this frame — the chrome
   *  resets its find query on the ACTIVE frame's loads. */
  onLoad: (url: string) => void;
  registerHandle: (url: string, handle: WebFrameEngineHandle) => void;
  unregisterHandle: (url: string) => void;
  /** Late-bindable seams read through refs (a hidden tile handed slot -1
   *  becoming visible supplies `onInteract` after mount). */
  interactRef: { current: (() => void) | undefined };
  reclaimRef: { current: ((e: KeyboardEvent) => boolean) | undefined };
}

/** The modifier + key slice a reclaimed chord carries across the engine
 *  boundary. */
export interface ChordEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Re-dispatch a reclaimed chord as a synthetic bubbling KeyboardEvent on the
 *  parent document — the one mechanism both engines share (today's inline
 *  `document.dispatchEvent(new KeyboardEvent("keydown", …))`). */
export function redispatchChord(e: ChordEvent): void;
```

Exact names may be tightened by the apply agent, but the **shape** is binding: `crossOrigin` MUST NOT appear anywhere in this module or in `FrameChromeState`; `supports` MUST be a required field; `canGoBack`/`canGoForward`/`find` MUST exist. Colocated `web-frame-engine.test.ts` covers `redispatchChord` (dispatches a bubbling `keydown` on `document` with the six fields copied).

### 2. `app/frontend/src/components/web-frame-iframe.tsx` (new — today's `WebFrame` moved verbatim, implementing the contract)

`export function WebFrameIframe(props: WebFrameEngineProps)`. The body is today's `WebFrame` (iframe-window.tsx lines ~164–470) plus `frameFavicon`/`ICON_REL_PATTERN` (lines ~472–492), moved with **no behavioral edits** beyond the renames the contract demands:

- **`supports` derives from the same-origin probe on each attach** (the `void iframe.contentWindow?.location.href; doc = iframe.contentDocument` try/catch): `history = find = meta = zoomGestures = !crossOrigin`, `devtools = false`. `crossOrigin` stays a local `useState` inside this file (it still drives `refresh`'s real-reload-vs-bounce choice) and never leaves it.
- **Reported state**: `onState(url, { loading, supports, trackedLocation, title, favicon, tileError, canGoBack: supports.history, canGoForward: supports.history, find })`.
- **Every probe is here and only here**: `checkFrame(url)` for `external` addresses (→ `refused` / `unreachable`), the `fetch(toProxySrc(url))` 502 read for `proxy` addresses (→ `dead-port`), the same-origin location/title/favicon reads on `load`, the `probeNonce` bump on `retry`. `iframe-window.tsx` MUST NOT import `checkFrame` after this change (the test-file `vi.mock("@/api/client")` of `checkFrame` moves with the tests that need it).
- **Find engine behind the handle**: the match/highlight machinery that today lives in the chrome (`findMatches`, `findActive`, `highlightApiRef`, the collect effect, the highlight effect, `stepFind`, `findFrame()`) moves INTO this engine as engine-local state, driven by `find(query, {forward, findNext})` / `stopFind()`:
  - `findNext: false` → `collectMatches(doc, query)` on the same-origin document, active = 0, `applyHighlights` (or the `findWithWindow` fallback when the Highlight API is unavailable), `scrollToMatch`; report `find: { active: 0, total }` (or `null` when the query is empty / zero matches — the FindBar shows `0/0` from `total: 0`; pick whichever keeps the existing "0/0" test green).
  - `findNext: true` → `stepMatch(active, total, forward ? 1 : -1)`, re-apply highlights (Highlight API path) or `findWithWindow(win, query, !forward)` (fallback path); report the new `active`.
  - `stopFind()` → `clearHighlights(win, doc)`, engine match state cleared, report `find: null`.
  - When `!supports.find` (cross-origin), `find` is a no-op that reports `find: null`.
  - Every `load` attach still runs `clearHighlights` and resets the engine's match state (today's R8 highlight reset), then fires `onLoad(url)`.
- **Chord reclaim stays engine-internal**: the capture-phase `keydown` listener reads `reclaimRef.current`; a match is prevented + `stopImmediatePropagation` and re-dispatched through `redispatchChord({...})` from the lib module (replacing the inline `document.dispatchEvent(new KeyboardEvent(…))`).
- **Handle**: `registerHandle(url, { kind: "iframe", reload: refresh, retry, back: () => navigate(-1), forward: () => navigate(1), find, stopFind })` in the same effect that today calls `registerFrame`; `unregisterHandle(url)` on cleanup. No `iframeRef` on the handle — the chrome no longer touches the element.
- **Render**: the `<iframe>` exactly as today — `src={toProxySrc(url)}`, `hidden={!active}`, `className` hiding under an active `tileError`, the compensated `width/height` + `transform: scale(zoom)` style at `zoom !== 1`, `title="Proxied content"`, the same `sandbox` list.

### 3. `app/frontend/src/components/iframe-window.tsx` (chrome only)

Keeps: props interface (unchanged), drafts, address bar + submit ladder, tab strip (roving focus, drag reorder, favicons/spinners, kind dots), zoom bucket state + persistence + `wireGestureListeners` + the wrapper gesture arm, the load progress line, the error surface markup, the onboarding panel, the five document CustomEvent receivers (`web-find:open`, `web-address:focus`, `web-tab:open-draft`, `web-open-external`, `web-zoom`), `onPageMeta` reporting from `activeChrome.title`.

Changes:

- **Types come from the lib**: `import type { FrameChromeState, WebFrameEngineHandle, WebFrameEngineKind, WebFrameEngineProps, TileError } from "@/lib/web-frame-engine"`. Local `TileError`, `FrameChromeState`, `FrameHandle`, `WebFrameProps`, `WebFrame`, `frameFavicon`, `ICON_REL_PATTERN` are deleted from this file. `checkFrame`, `ApiError`-only from `@/api/client` (ApiError stays — the submit ladder's 400 fallback needs it), `find-in-page` collect/highlight imports, `proxyPortOf` — removed from this file if no longer used.
- **Engine factory**: `function createEngine(kind: WebFrameEngineKind): ComponentType<WebFrameEngineProps>` returning `WebFrameIframe` for `"iframe"`; the render site does `const Engine = createEngine(engineKind)` once (module-level constant is fine — `const ENGINE_KIND: WebFrameEngineKind = "iframe"`) and mounts `<Engine key={tabUrl} url={tabUrl} active={…} zoom={zoom} wireGestureListeners={…} onState={handleChromeState} onLoad={handleFrameLoad} registerHandle={…} unregisterHandle={…} interactRef={…} reclaimRef={…} />` per tab inside the existing `web-zoom-frame-wrapper` div.
- **`handleChromeState` equality guard** compares the new field set (`loading`, `supports` by value — five booleans, `trackedLocation`, `title`, `favicon`, `tileError` by reference, `canGoBack`, `canGoForward`, `find` by value — `active`/`total`).
- **Per-capability rendering** (the load-bearing part):
  - `const supports = activeChrome?.supports ?? NO_CAPABILITIES` where `NO_CAPABILITIES` is the all-false constant used before the first report (today `crossOrigin` defaults to `false`, i.e. everything enabled, until the first report — to keep the "renders back/forward … on a same-origin tile" test and the initial paint identical, default to **all-true for the iframe engine's optimistic first paint** is NOT acceptable because it is engine knowledge; instead the iframe engine MUST report its initial state synchronously on mount (a `useEffect` with no deps fires before paint is not synchronous — use the same `useEffect([... deps])` report that exists today; today's first `onChromeState` fires on mount with `crossOrigin: false` ⇒ `supports` all-true except devtools, so the very first chrome render after mount is unchanged). Before any report exists the chrome renders as it does today for `activeChrome === undefined`: `loading = !onboarding`, controls hidden until state arrives is fine ONLY if no existing test observes the pre-report frame — verify; if one does, seed `supports` from the engine kind's declared **static default** exported by the engine module (`WEB_FRAME_IFRAME_DEFAULT_CAPABILITIES`), which keeps the knowledge in the engine file.
  - Back/forward buttons render iff `!onboarding && supports.history`; each carries `disabled={!activeChrome.canGoBack}` / `disabled={!activeChrome.canGoForward}` (never true on the iframe engine — no visible change); clicks call `handles.get(url)?.back()` / `.forward()`.
  - Refresh → `handles.get(url)?.reload()`. Retry → `.retry()`.
  - Find ⌕ button: rendered and **enabled** exactly as today (`!onboarding`); toggling opens the bar. The `FindBar` receives `disabled={!supports.find}`, `statusText={!supports.find ? "page is cross-origin — find unavailable" : undefined}` (copy verbatim — asserted by `web-tile-find.spec.ts:294`, `iframe-window.test.tsx:429`, `find-bar.test.tsx:86`; the copy is presentation and may move onto engine state in a later change), `matchIndex={activeChrome?.find?.active ?? 0}`, `matchCount={activeChrome?.find?.total ?? 0}`.
  - Chrome find state shrinks to `findOpen` + `findQuery`. Effects: (a) while `findOpen`, a `findQuery` change or an active-url change → `handles.get(url)?.find(findQuery, { forward: true, findNext: false })` when the query is non-empty, else `.stopFind()`; (b) `findOpen` → false → `.stopFind()`; (c) `onNext`/`onPrev` → `.find(findQuery, { forward: true|false, findNext: true })`; (d) `handleFrameLoad(frameUrl)` for the ACTIVE url → `setFindQuery("")` (the engine already cleared its matches on that load). On an active-tab switch with the bar open, the previous engine MAY receive `stopFind()` (invisible — the frame is hidden).
  - The header meta effect reads `activeChrome?.title` regardless of engine (already true).
  - The zoom control renders exactly as today for every engine (the scale wrapper is engine-applied via the `zoom` prop; the control is chrome). `supports.zoomGestures` and `supports.devtools` have **no chrome consumer** in this change.
  - `trackedLocation`, `tileError`, `activeLoading` read from `activeChrome` as today.
- The file MUST contain no reference to `crossOrigin`, `contentDocument`, `contentWindow`, or `HTMLIFrameElement` after this change (grep-verifiable; the onboarding copy "same-origin pages" prose string is exempt).

### 4. Tests

- **`app/frontend/src/components/web-frame-iframe.test.tsx`** (new): the engine-internal subjects from `iframe-window.test.tsx`, rendering `WebFrameIframe` directly with a recording `onState`/`onLoad`/`registerHandle` harness (or through `IframeWindow` where the subject needs the chrome's wiring — apply's call, but the file's subject is the engine): the `onInteract` seam block (pointerdown/keydown attach, same-document no-double-attach, blur fallback, late-bound handler, unmount removal), the chord reclaim block (match prevented + re-dispatched, non-match untouched, no predicate ⇒ report-only), the error-state probes (`checkFrame` refused/unreachable → `tileError`; 502 → `dead-port`; the `vi.mock("@/api/client")` moves here), same-origin title/favicon/location reporting and the cross-origin clearing, `supports` derivation (same-origin ⇒ history/find/meta/zoomGestures true, devtools false; cross-origin ⇒ all false), `canGoBack`/`canGoForward` mirroring `supports.history`, the handle's `find`/`stopFind` reporting `find: {active, total}` and stepping with wrap, load resetting match state + firing `onLoad`, `reload` real-reload vs about:blank bounce, the scale-wrapper style at `zoom !== 1`.
- **`iframe-window.test.tsx`** keeps every chrome subject (address bar display/edit/submit ladder, tab strip, drafts, drag, roving focus, zoom control + persistence + gestures on the wrapper, onboarding, CustomEvent seams, error-surface copy and buttons, load progress line, find bar open/counter/cycle/close/cross-origin-hint) — these may keep rendering the real engine through `IframeWindow` since jsdom iframes are same-origin. Add a **stub-engine chrome test** block: `vi.mock("@/components/web-frame-iframe")` (or a `vi.doMock` in a dedicated file `iframe-window.stub-engine.test.tsx` if module-mock scoping is cleaner) with a stub engine that pushes a controllable `FrameChromeState` and registers a spy handle; assert (a) `supports` all-false ⇒ back/forward absent, find bar disabled with the hint, refresh still present; (b) `supports.history` true + `canGoBack: false` ⇒ Back rendered disabled; (c) a pushed `state.title` renders as the tab label and reaches `onPageMeta`; (d) Refresh/Back/Forward/Retry click the handle's `reload`/`back`/`forward`/`retry`; (e) typing in the find bar calls `find(query, {findNext: false})`, Enter calls `find(query, {forward: true, findNext: true})`, close calls `stopFind`, and a pushed `find: {active: 1, total: 3}` renders `2/3`.
- **Invariant**: no existing `it(...)` is deleted; every one survives in one of the files (re-targeted at the engine where its subject moved). The `surface-layout.web-integration.test.tsx` and `surface-layout.test.tsx` mocks of `@/api/client` keep working (they still stub `checkFrame`; the engine imports it from the same module).
- **E2E** (unchanged specs, must pass): `web-tabs.spec.ts`, `web-tile-chrome.spec.ts`, `web-tile-find.spec.ts`, `web-tile-zoom.spec.ts`, `web-view-lens.spec.ts`, `present-viewer.spec.ts`. No intent-comment edits expected.

### 5. Memory (hydrate)

`docs/memory/run-kit/ui/lenses-and-layout.md` § Iframe Window is rewritten in **present-truth** terms: the `web` lens renderer is `IframeWindow` chrome over a `WebFrameEngine` (contract in `lib/web-frame-engine.ts`); one engine instance per tab; the `iframe` engine (`components/web-frame-iframe.tsx`) owns the element, the probes, the attach/reclaim seam, the find machinery and the scale wrapper, and derives `supports` from the same-origin probe; the chrome renders per `supports.*`, reads `state.title`/`trackedLocation`/`tileError`, and drives the engine through the registered handle. Existing Design Decisions that name `WebFrame`/`iframe-window.tsx` internals (chord-reclaim listener, error states over a hidden iframe, scale wrapper, "One `IframeWindow` chrome, N URL-keyed frames", find-bar open seam, Highlight styling) get their file pointers corrected; a new Design Decision **The chrome renders per capability, never per origin** is added (Why: a second engine's answers differ per feature, not per origin; a chrome-level origin probe misreports on a renderer that does not embed — the spike's "refuses embedding" over a working view. Rejected: `if (native)` branches in the chrome; keeping `crossOrigin` as a pseudo-capability). No "was X, now Y" narration.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) § Iframe Window rewritten as chrome-over-engine with capability flags; DD file-pointer fixes; new DD *The chrome renders per capability, never per origin*
- `run-kit/ui/focus-ownership`: (modify, verify-only) the recording asymmetry ("`onInteract` is the only recorder for iframe tiles") stays true — update only if it names `WebFrame` or `iframe-window.tsx` internals rather than the `IframeWindow` prop seam

## Impact

- **Frontend only** — `app/frontend/src/lib/web-frame-engine.ts` (+ `.test.ts`, new), `app/frontend/src/components/web-frame-iframe.tsx` (+ `.test.tsx`, new), `app/frontend/src/components/iframe-window.tsx` (shrinks by ~450 lines; chrome only), `app/frontend/src/components/iframe-window.test.tsx` (split). No change to `surface-layout.tsx` (the single mount and its props are unchanged), `find-bar.tsx`, `lib/web-url.ts`, `lib/web-zoom.ts`, `lib/find-in-page.ts`, `lib/zoom-gesture.ts`, `lib/keybindings.ts`, `api/client.ts`.
- **Backend**: none. `api/proxy.go`, `api/framecheck.go` unchanged.
- **Desktop shell**: none.
- **Specs**: none (change 5 updates `window-views.md` / `surface-layout.md` / `right-panel.md` rows).
- **Verification** (the apply worker runs exactly these — never full `just test`, never `git stash`): `cd app/frontend && npx tsc --noEmit`; `just test-frontend` (the whole Vitest suite — touched-files-only runs have missed cross-file breakage before); the six e2e specs **one per run** as `just test-e2e "e2e/web-tabs.spec.ts"` etc. (the `e2e/<file>` form — a bare name is a path regex; one `just test-e2e` per worktree at a time). Desktop `pnpm test` is not needed (no desktop files touched).
- **Branch note**: this worktree's branch carries one local docs commit not on `origin/main` (`912378c3` — the plan's Spike verdict); it rides into the PR as a docs commit.

## Open Questions

- None blocking. The plan's phrase "find button disables when `!supports.find`" conflicts with the intake's "no behavior change" and with `web-tile-find.spec.ts:294` (the bar must open cross-origin and show the hint); the intake resolves it in favor of today's behavior (button enabled, bar disabled with hint) — see Assumption 8.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Contract lives in `lib/web-frame-engine.ts` (pure types + `ChordEvent` + `redispatchChord`); the iframe engine in `components/web-frame-iframe.tsx`; `IframeWindow` stays in `iframe-window.tsx` as chrome | Plan § Change 1 names all three files; the module split mirrors `lib/window-view.ts` / `lib/surface-layout.ts` pure-module precedent | S:95 R:70 A:95 D:95 |
| 2 | Certain | Every probe (`checkFrame`, the 502 fetch, the same-origin location/document reads) lives inside the iframe engine; `iframe-window.tsx` imports none of them | Spike verdict's sharpened requirement, restated in the user's prompt | S:100 R:80 A:95 D:100 |
| 3 | Certain | `crossOrigin` leaves `FrameChromeState`; `supports: WebFrameCapabilities` replaces it and the chrome gates only on flags (`history`, `find`) plus `canGoBack`/`canGoForward` | Decision of record: "renders per capability, never per crossOrigin" | S:95 R:75 A:90 D:95 |
| 4 | Confident | Iframe engine reports `canGoBack = canGoForward = supports.history`; chrome hides ◀ ▶ when `!supports.history` and disables at `false` flags (never visible on iframe) | Plan item 1 verbatim; adds the disabled seam change 4 needs with zero visible change today | S:85 R:85 A:90 D:80 |
| 5 | Confident | Find contract is `find(query, {forward, findNext})` + `stopFind()`; state `find: {active (0-based), total}` or null; engine owns matches/highlights, chrome owns `findOpen`/`findQuery` | Mirrors Electron `findInPage(text, {forward, findNext})` / `found-in-page {activeMatchOrdinal, matches}` so the native engine maps 1:1 in change 4; 0-based `active` matches `FindBar.matchIndex` | S:70 R:70 A:85 D:65 |
| 6 | Confident | Contract carries an `onLoad(url)` callback beyond the plan's `onState`/`onInteract`/`onChord` list | The chrome's find-query reset (R8, tested) needs a load EDGE, not a state level; both engines have a natural load event | S:60 R:80 A:85 D:70 |
| 7 | Confident | Chord reclaim stays engine-internal (predicate in via `reclaimRef`, re-dispatch via the shared `redispatchChord` helper); no chrome-facing `onChord` subscription | The chrome never needed the chord; both engines re-dispatch on `document` (plan change 4 item 4) — the shared helper is the seam | S:65 R:80 A:85 D:70 |
| 8 | Confident | The ⌕ find button stays enabled when `!supports.find`; the bar opens disabled with the verbatim hint "page is cross-origin — find unavailable" | "No behavior change" + `web-tile-find.spec.ts:294` and two Vitest assertions on the exact copy; the plan's "button disables" is superseded; the copy may move onto engine state in change 3/4 | S:75 R:90 A:85 D:75 |
| 9 | Confident | An engine is a React component (`WebFrameEngineProps`) plus a registered imperative handle (`WebFrameEngineHandle`); `zoom` is a prop (declarative `setZoom`) | Today's `WebFrame` + `registerFrame` shape, verbatim move; a native engine renders a placeholder element the same way | S:70 R:70 A:85 D:70 |
| 10 | Confident | `createEngine(kind)` in `iframe-window.tsx` maps `"iframe"` → `WebFrameIframe`; `WebFrameEngineKind = "iframe"` only, widened in change 3 | Plan item 3; a `"native"` member with no implementation would be dead code under the "no native code" non-goal | S:80 R:90 A:90 D:80 |
| 11 | Confident | The stub-engine chrome test injects through `vi.mock("@/components/web-frame-iframe")` (or a dedicated test file), not a production `engine` prop | No test-only production surface; the codebase already module-mocks `@/api/client` and `terminal-client` this way | S:60 R:95 A:85 D:65 |
| 12 | Confident | Test split rule: engine-internal subjects move to `web-frame-iframe.test.tsx` (rendering the engine directly), chrome subjects stay; no `it` is deleted | Plan item 4; the invariant is grep-checkable (`it(` count before ≤ after across both files) | S:70 R:85 A:80 D:70 |
| 13 | Certain | Verification is `npx tsc --noEmit`, `just test-frontend`, and the six named e2e specs one per run via `just test-e2e "e2e/<spec>.spec.ts"`; never full `just test`, never `git stash` | Plan § Verification per change + project memory (touched-file Vitest misses cross-file breakage; one full e2e per worktree; shared stash stack) | S:90 R:95 A:95 D:95 |
| 14 | Certain | `change_type` set explicitly to `refactor` | Behavior-preserving restructure; the plan calls change 1 "a behavior-preserving refactor"; inference produced `feat` from wording | S:90 R:95 A:95 D:95 |
| 15 | Confident | Memory scope is `ui/lenses-and-layout.md` (rewrite § Iframe Window + DD pointers + one new DD); `ui/focus-ownership.md` verify-only | Plan item 5; grep shows the other memory hits (`api-and-sockets`, `status-signals`, logs) reference `checkFrame`/the API, not the component internals | S:75 R:90 A:85 D:80 |
| 16 | Confident | `supports.zoomGestures` and `supports.devtools` are reported but have no chrome consumer in this change | Plan lists both flags in the contract; their consumers (native zoom relay, `Web: Inspect page`) are changes 3–4 | S:80 R:95 A:90 D:85 |
| 17 | Confident | On an active-tab switch while the find bar is open, the chrome re-issues `find(findQuery, {findNext: false})` on the new engine; the previous engine MAY get `stopFind()` | Parity with today's re-collect effect (keyed on `findFrame`/url); clearing a hidden frame's highlights is invisible | S:60 R:90 A:80 D:65 |
| 18 | Confident | Before an engine's first state report the chrome renders as today for a missing entry; if a test observes that frame, seed `supports` from an engine-exported static default rather than hardcoding in the chrome | Keeps engine knowledge out of the chrome while preserving first-paint parity | S:55 R:90 A:80 D:65 |

18 assumptions (5 certain, 13 confident, 0 tentative, 0 unresolved).
