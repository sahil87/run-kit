# Intake: UI State Frontend — Web Tab Strip

**Change**: 260828-9kip-web-tab-strip
**Created**: 2026-08-29

## Origin

> Change 3 from fab/plans/sahil/26-08-28-ui-state-tmux-options.md -- Frontend: web tab strip (MEDIUM). Changes 1 (backend) and 2 (frontend layout+code-root, ladder retired) already merged to main. Implement exactly the Change 3 section of that plan file; do not implement Change 4 or 5.

Interactive `/fab-new` invocation. The design is authored in two human-curated documents that this intake transcribes and reconciles against shipped code:

- **Plan**: `fab/plans/sahil/26-08-28-ui-state-tmux-options.md` § "Change 3 — Frontend: web tab strip (MEDIUM)" (`:80-92`) — the scope. Changes 4 (`rk tab` CLI, `rk present` as sugar) and 5 (cleanup) are explicitly OUT of scope.
- **Spec**: `docs/specs/ui-state.md` § Web Tabs (`:229-288`, currently `[planned]`), § The One Rule, § Open Questions (decided 2026-08-28: identity is the URL, web tabs are declared-only, zoom is per-viewer). P3 "hide, never unmount" is `docs/specs/right-panel.md:214-219`.

**Change 1 landed as PR #759 (`8e4c3310`, `260828-fykg`); Change 2 as PR #760 (`c4fa2047`, `260828-iip5`).** Verified at `c4fa2047` while drafting:

- Window JSON (`internal/tmux/tmux.go:739-758`, TS mirror `src/types.ts:153-176`): `layout`, `webTabs` (dense `[]string`, index 0 = slot 1), `webActive` (1-based, 0/absent = none), `codeRoot`, `gitRoot`. **No `ports` field** — `rkUrl`/`rkType` are gone.
- Web-tab verb routes (`api/router.go:756-759`, handlers `api/windows_web.go`) — **POST only** (Constitution IX; memory `api-and-sockets.md:449-454` records the plan's `DELETE` as rejected):
  - `POST /api/windows/{id}/web?server=` body `{"target": string}` → **201** `{"index": n, "existed": bool, "url": string}`; `target` resolves through `present.ParseTarget` against the window's first-pane cwd; **409** `{"error":"web tabs full (8)"}`; 400 for bad target/window.
  - `POST /api/windows/{id}/web/{n}/remove` → 200 `{"ok":true}`; 400 `"web tab index must be 1..8"` / `"web tab index out of range"`.
  - `POST /api/windows/{id}/web/{n}/select` → 200 `{"ok":true}`; same 400s.
  - All three wake the SSE hub on success, so the caller's own click repaints within the tick.
- `WebAdd` (`internal/tmux/webtabs.go:110-172`) is idempotent on an identical URL (`/present/` kinds compare by target identity + root and get a fresh `?v=`), returns `existed: true` with the existing index, appends at `len+1` otherwise, and sets `_active=1` **only when the family was empty** ("add" is not "show"). `WebRemove` shifts URL+root down and repoints `_active` (`active==n → min(n,newLen)`; `active>n → active-1`; empty → unset).
- `POST /api/windows/{id}/options` (`api/windows.go:388-500`) accepts `@rk_win_web_1..8` (`validate.ValidateWebTabURL`: `/proxy/…`, `/present/…`, or absolute http(s); a null routes through `WebRemove`; a slot beyond `len+1` is a 400 "gap"), `@rk_win_web_active` (1..len), not `_root` twins.
- Frontend today: `IframeWindow` (`src/components/iframe-window.tsx`, 987 lines) is presentational — props `url`, `onWriteUrl`, `onInteract`, `shouldReclaimChord`, `onPageMeta`; no `server`/`windowId`. Its sole mount is `src/components/surface-layout.tsx:1263-1282`, passing `url={activeWebUrl(win)}` and `onWriteUrl` = `setWindowOptions(server, windowId, {["@rk_win_web_" + (webActive>=1 ? webActive : 1)]: url})`. Onboarding derives from `url.trim() === ""` (`:102`). `client.ts` has **no** `webAdd`/`webRemove`/`webSelect`; `lib/web-url.ts` has **no** `webTabTitle` (nearest: `displayForm`, `:106-142`). The find/zoom/address-focus/open-external document CustomEvents assume **exactly one web receiver per layout** (memory `ui/lenses-and-layout.md` Address model + Find bar paragraphs).
- e2e: `_tmux.ts` has `setWindowOption`/`windowOption`/`stampWebTab` (slot 1 only, `:220-226`); `_web-tile.ts` `stubProxyPorts(page, ...ports)`; there are **no `.spec.md` sidecars** (Constitution § Test Intent Comments — in-file JSDoc headers); `surface-layout.spec.ts:32-34` carries a binding HTTP/1.1 6-slot pool budget note.

**Decisions taken in this conversation (asked, answered):**

1. **Detected-port chip is DEFERRED.** The plan's `+ :3000` chip assumed `win.ports` on the payload; it does not exist and the host-global `useHostServices()` list has no window attribution. The user chose to ship the strip without the chip and file a follow-up for a per-window `ports` field (backend pane-pid → process-tree → port join). Nothing in this change consumes host services.
2. **Address-bar submit REPLACES the active tab** — `setWindowOptions({"@rk_win_web_<active>": url})`, exactly as today (spec § Web Tabs wording; browser semantics). The plan's parenthetical "default: always `POST …/web`" is overridden. Only the `+` control goes through `POST …/web`.

## Why

**The problem.** Change 1 made the web-tab family (`@rk_win_web_1..8`, `_active`) and its three verb routes real, and Change 2 made the frontend a renderer of `@rk_win_layout`/`@rk_win_code_root` — but the web tile still renders exactly one address, `activeWebUrl(win)`. Consequences today:

1. An agent (or the operator via `tmux set-option -w @rk_win_web_2 …`, and `rk tab web add` in Change 4) can populate a window with several web tabs and select among them, and **no viewer can see the set** — the UI shows the active slot with no indication that others exist, no way to switch, and no way to close one. The backend contract is half-consumed.
2. `rk present` re-presenting the same file bumps `?v=` on an existing slot; a second `rk present` of a *different* file appends slot 2 (via `WebAdd`) — the viewer sees whichever slot `_active` points at and cannot get the other back without a shell.
3. Switching the active slot by option write swaps the single iframe's `src`, reloading the page. Dev-server pages (Vite HMR sessions, an in-progress form) lose state on every switch. Spec P3 says hide, never unmount.
4. The address bar is the only UI writer of the family and it can only overwrite slot `_active`; there is no UI way to *add* a tab, so the family's "identity is the URL, idempotent add" contract is reachable only from the CLI.

**If we don't fix it.** Change 4's `rk tab web add/rm/select` ships with no rendering counterpart — agents drive state that humans cannot see; the two-viewer coherence promise of the ui-state spec is broken for the one surface with sub-addresses; and the `[planned]` § Web Tabs never becomes `[current]`.

**Why this approach.** Render the family as a **strip above the URL bar inside the existing web tile** (one `web` surface per tab, N web tabs inside — spec § Web Tabs rejects N web *surfaces* because the layout encoding names kinds and a second nested arrangement model is not wanted). Every strip interaction is a **declared write through the shipped verb routes** (select / remove / add) or the existing `/options` seam (address bar) — the frontend holds no tab state; it renders `win.webTabs`/`win.webActive` and repaints on the option tick, optimistic until confirmed (the color-swatch / Change 2 layout pattern). Renumbering on remove and `_active` fix-up are **server-side** (`WebRemove`), so the strip never re-implements them. Keep **one `IframeWindow` chrome with N `<iframe>` elements** rather than N `IframeWindow`s, so the single-receiver invariant of the find/zoom/address/open-external events survives P3.

## What Changes

### 1. `api/client.ts` — three verb wrappers

Add, next to `setWindowOptions` (`:444`), following its `withServer` + `fetchJson`/error pattern:

```ts
/** POST /api/windows/{id}/web — declared add (idempotent on identical URL; the
 *  server returns the existing index with existed:true and, for /present/
 *  kinds, bumps ?v=). 409 when the family is full (8). Does NOT select. */
export async function addWebTab(server: string, windowId: string, target: string):
  Promise<{ index: number; existed: boolean; url: string }>;

/** POST /api/windows/{id}/web/{n}/remove — server shifts slots down and
 *  repoints @rk_win_web_active; the strip never renumbers locally. */
export async function removeWebTab(server: string, windowId: string, n: number): Promise<{ ok: boolean }>;

/** POST /api/windows/{id}/web/{n}/select — writes @rk_win_web_active. */
export async function selectWebTab(server: string, windowId: string, n: number): Promise<{ ok: boolean }>;
```

`n` is 1-based (tmux slot), matching the route. A non-2xx response rejects with the `{"error": msg}` text so the strip can toast "web tabs full (8)" verbatim. No change to `setWindowOptions` or `createWindow`.

### 2. `lib/web-url.ts` — `webTabTitle(url)`

Pure, colocated-tested, beside `displayForm`:

```ts
/** Strip label for a web tab — shorter than displayForm: the address the
 *  viewer would say aloud. present → basename (plumbing params `server`/`v`
 *  stripped, own query dropped); proxy → `localhost:{port}` + path (no
 *  search/hash); external → host only; relative → the raw path. Never throws;
 *  empty input → "" (caller renders a placeholder). */
export function webTabTitle(url: string): string
```

Examples the tests pin: `/present/@3/1/report.html?v=17&server=x` → `report.html`; `/proxy/3000/docs/api` → `localhost:3000/docs/api`; `http://localhost:5173/?x=1` → `localhost:5173/`; `https://docs.example.com/a/b#c` → `docs.example.com`; `/foo` → `/foo`; `""` → `""`. Also fix the two stale `@rk_win_url` mentions in the module header (`:5`, `:22`) to `@rk_win_web_<n>`.

### 3. `components/iframe-window.tsx` — strip + N mounted frames

**Props.** Replace the single-address contract with the family, keeping the component payload-shape agnostic (no `server`/`windowId`; the caller owns the verb calls):

```ts
interface IframeWindowProps {
  /** Dense web-tab family (win.webTabs ?? []). */
  tabs: string[];
  /** 1-based active slot (win.webActive); 0/undefined with tabs → 1. */
  active?: number;
  /** Address-bar submit on the active tab — REPLACES the active slot's URL
   *  via @rk_win_web_<active> (slot 1 when the family is empty). */
  onWriteUrl?: (url: string) => Promise<unknown>;
  /** Strip verbs — absent ⇒ the control is not rendered. */
  onSelectTab?: (n: number) => Promise<unknown>;
  onCloseTab?: (n: number) => Promise<unknown>;
  /** `+` — declared add of the address-bar draft (POST …/web). Resolves to the
   *  server's {index, existed}; the component then calls onSelectTab(index). */
  onAddTab?: (target: string) => Promise<{ index: number; existed: boolean }>;
  onInteract?, shouldReclaimChord?, onPageMeta?   // unchanged
}
```

Derivations: `activeIndex = tabs.length ? clamp(active ?? 1, 1, tabs.length) : 0`; `url = tabs[activeIndex - 1] ?? ""` (same value `activeWebUrl(win)` yields today — every existing `url`-driven effect keeps working by consuming this local). **Onboarding = `tabs.length === 0`** (`data-testid="web-tile-onboarding"`, copy unchanged); an out-of-range `active` never shows onboarding while tabs exist.

**Strip.** New first child of the outer `flex flex-col` wrapper, *above* the `TipGroup` URL-bar row, rendered only when `tabs.length >= 2` — at 0 or 1 tab the DOM is byte-identical to today (the existing chrome tests keep passing unchanged). `data-testid="web-tab-strip"`, `role="tablist"`, `shrink-0 flex items-stretch gap-px px-1 border-b border-border bg-bg-card overflow-x-auto` (11px monospace, the tile-header idiom at `surface-layout.tsx` "Tile chrome"). Per tab, `role="tab"` `aria-selected` `data-testid="web-tab" data-index={n}`: label `webTabTitle(url)` (falls back to `#n` when empty), `title={displayForm(url)}`, the `classifyAddress` color dot the tile header already uses (green present / yellow proxy / blue external), and a close glyph `×` (`aria-label="Close web tab n"`, `data-testid="web-tab-close"`) visible on hover/focus-within and always on the active tab (coarse pointer: always). Click → `onSelectTab(n)`; `×` → `onCloseTab(n)` (stops propagation, no confirm — remove is one `+` away and the URL is the identity). Active tab: `bg-bg-primary text-text-primary` with the bottom border knocked out; inactive: `text-text-secondary hover:text-text-primary`. Strip end: `+` button (`aria-label="Add web tab from address"`, `data-testid="web-tab-add"`), disabled with `Tip` "web tabs full (8)" at `tabs.length >= 8`.

Keyboard on the strip (Constitution V): tabs are a roving-focus `tablist` — ←/→ move focus, Enter/Space select, Delete/Backspace close the focused tab, Home/End jump. Focused-but-not-active is a viewer posture; nothing is written until Enter.

**`+` semantics.** The draft is the address bar's current input (`normalizeAddressInput(inputUrl)`). If the draft is empty **or equals the active tab's URL**, `+` focuses the address bar (selecting its text) and sets a one-shot "new tab" arm so the *next* Enter routes through `onAddTab` instead of `onWriteUrl` (arm cleared on Escape/blur). Otherwise `+` calls `onAddTab(draft)` and, on `{index}`, `onSelectTab(index)` (`WebAdd` does not select unless the family was empty). Errors (409 full, 400 bad target) surface in the existing inline `role="alert"` submit-error slot with the server's `error` text. `+` is hidden at `tabs.length < 2` along with the strip — at 0–1 tabs the way to get a second tab from the UI is the palette action below (a discoverable path must exist for the strip to appear at all).

**Address-bar submit** (unchanged behavior, new plumbing): Enter → `onWriteUrl(normalized)` = replace `@rk_win_web_<activeIndex || 1>`; same-URL submit is a no-op (skip the POST when `normalized === url`). The `/present/` `?v=` refresh is **not** the bar's job — Refresh reloads the frame as today.

**P3 — N frames mounted, one visible.** The zoom wrapper renders one `<iframe>` **per tab** (`key={url}`, so a replaced URL remounts only that frame; a `WebRemove` shift re-keys by URL, not index, so surviving frames keep state), each `hidden` (`display:none`, the `[hidden]` reset) unless `n === activeIndex`. `iframeRef`, `loading`, `crossOrigin`, `trackedLocation`, page-meta, back/forward, find, and the probe/error machinery are **per frame** — hold them in a `Map<url, FrameState>` (or a small `useFrameState(url)` per frame child) and bind the chrome to the active frame's entry; the document CustomEvents (`web-find:open`, `web-address:focus`, `web-open-external`, `web-zoom`) keep their single listener on the component and act on the active frame — the single-receiver invariant holds because there is still exactly one `IframeWindow` per layout. Zoom: `zoomBucket = webZoomKeyFor(url)` re-seeds on active change (today's behavior for a changed `url`); the scale wrapper wraps the active frame only. `onPageMeta` fires for the active frame's title (the tile header shows the active tab). Inactive frames do not run the dead-port probe on a timer — probe on first mount and on activation. **Cap on mounted frames** is the family cap (8); no LRU (P3 defers eviction).

Frames load lazily? **No** — mount all N at once (P3 wants warm frames), but only the active frame gets the progress line and error surface.

### 4. `components/surface-layout.tsx` — wire the verbs

At the `case "web"` mount (`:1263-1282`), `server` and `windowId` are already in scope:

```tsx
<IframeWindow
  tabs={win.webTabs ?? []}
  active={win.webActive}
  onWriteUrl={(url) => setWindowOptions(server, windowId, { [`@rk_win_web_${activeSlot(win)}`]: url })}
  onSelectTab={(n) => selectWebTab(server, windowId, n)}
  onCloseTab={(n) => removeWebTab(server, windowId, n)}
  onAddTab={(target) => addWebTab(server, windowId, target)}
  … />
```

Optimistic render: the Zustand window store's optimistic-action pattern (`ui/dialogs-and-state.md` § Optimistic UI, used by Change 2 for `layout`) gets a `webActive` override on select and a `webTabs`/`webActive` override on remove (local shift mirroring `repointActive`, **display only** — the server write is authoritative and the SSE tick reconciles; on POST failure revert + toast). Add is not optimistic (the index comes from the server). Tile header meta (`displayForm(activeWebUrl(win))`) and the kind badge are unchanged.

### 5. Command palette + chords (Constitution V)

Register in the palette's web group, enabled when the layout has a web tile: `Web: Next tab` / `Web: Previous tab` (wrap; `selectWebTab`), `Web: Close tab` (active; `removeWebTab`), `Web: New tab from address` (focus the address bar with the new-tab arm). No new global chords beyond what the palette provides; the strip's own ←/→/Enter/Delete are local to the focused `tablist`. Buttons mirror these actions, not the reverse.

### 6. Onboarding + `hasWebUrl`

`lib/window-view.ts` `hasWebUrl`/`activeWebUrl` unchanged. `IframeWindow`'s onboarding branch moves from `url.trim()===""` to `tabs.length === 0`; the eight onboarding unit cases (`iframe-window.test.tsx:671-746`) are re-pointed to pass `tabs={[]}`.

### 7. Tests

**Unit** (`iframe-window.test.tsx`, `renderIframe` helper grows `tabs`/`active`/verb mocks; existing cases pass `tabs={[url]}`):
- strip absent at 0 and 1 tabs (DOM equality with the pre-change chrome for the 1-tab case — snapshot the URL-bar row), present at 2;
- N `<iframe>` mounted, only the active one not `hidden`; switching `active` flips `hidden` without changing any frame's `src`;
- click tab → `onSelectTab(n)`; `×` → `onCloseTab(n)` and does not select; `+` with a differing draft → `onAddTab(draft)` then `onSelectTab(index)`; `+` with empty/same draft focuses the bar and arms new-tab so Enter → `onAddTab`; 409 error text lands in the alert;
- Enter on the bar → `onWriteUrl`, never `onAddTab`, and a same-URL submit does not call it;
- roving keyboard: ←/→/Home/End/Enter/Delete;
- `+` disabled at 8.
- `web-url.test.ts`: the `webTabTitle` table above.
- `surface-layout.test.tsx` stub records the new props; `surface-layout.web-integration.test.tsx` renders a 2-tab window and asserts no update-depth loop.

**e2e** `app/frontend/tests/e2e/web-tabs.spec.ts` (in-file JSDoc header + per-test Proves/Steps; **no `.spec.md`**). Dedicated session `e2e-webtabs-${Date.now()}`, `stubProxyPorts(page, 3001, 3002, 3003)` static pages, seed via `setWindowOption` for `@rk_win_web_1..3` + `_active=2` (add a `stampWebTabs(windowId, urls, active)` helper to `_tmux.ts` beside `stampWebTab`), layout `single:web` via `@rk_win_layout`:
1. strip renders 3 tabs with `webTabTitle` labels, tab 2 `aria-selected`; exactly one visible iframe;
2. click tab 3 → `windowOption(id, "@rk_win_web_active") === "3"` within `OPTION_TICK_TIMEOUT`; the tab-2 iframe stays in the DOM (`hidden`) — P3;
3. close tab 2 (middle) → `@rk_win_web_2` now holds the former tab-3 URL, `@rk_win_web_3` empty, strip shows 2 tabs, DOM labels renumbered, `_active` repointed per `repointActive`;
4. second `browser.newContext()` on the same route sees the same active tab and the same strip after one context clicks;
5. `+` with a new `/proxy/3003/` draft → a 4th slot appears in tmux and is selected; typing an address and Enter on the bar replaces the active slot only (`webTabs.length` unchanged).
Budget: the spec mounts 3 iframes in ONE tile — honor the `surface-layout.spec.ts` pool note (one 3-frame test at a time, stubbed static pages, no second tile). Baseline `web-tile-chrome`, `web-tile-find`, `web-tile-zoom`, `web-view-lens`, `surface-layout`, `present-auto-expand` on clean `origin/main` first (memory: `web-view-lens` :194/:412/:444/:521 pre-existing), run them together before ship.

### 8. Docs

- `docs/specs/ui-state.md` § Web Tabs → `[current]` for the state/rendering/identity/declared-only paragraphs; the "`rk present` is absorbed" sub-paragraph stays `[planned]` (Change 4). The detected-port affordance sentence gains "(deferred — needs per-window port attribution; tracked as a follow-up)". Header status line updated.
- Backlog: add an `idea`/backlog entry "Per-window `ports` on the Window payload + web-strip `+ :port` chip" so the deferral is tracked.
- Memory hydrate (see Affected Memory) is the hydrate stage's job, not an apply task.

### Explicit non-goals

- No `rk tab` CLI, no `rk present` rewrite, no `rk code exec --tab` (Change 4). No removal of `translateLegacyOptionKeys`, the n-less `/present/{windowId}/*` route, or the `@rk_win_url` dual-read (Change 5).
- No detected-port chip and no consumption of `useHostServices()` (deferred, decided above).
- No backend changes; no new routes; no Window JSON change.
- Web-tab titles are derived from the URL, never from page `<title>` (spec: "titles are derived from the page and are display-only" is satisfied by the tile header's `onPageMeta`; the strip label stays URL-derived so it is stable before load and for cross-origin frames).
- No drag-to-reorder, no per-tab zoom persistence beyond today's per-bucket key, no LRU eviction of hidden frames.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) § Iframe Window — Layout (six children: strip + URL bar + find + progress + error + frames), new § Web tab strip (verbs, `+` arm, roving tablist, optimistic select/remove), § Onboarding (`tabs.length === 0`, fix the stale `rkUrl` wording), § Address model (`webTabTitle`), § Content zoom (per-active-frame), § SSE Sync → "active frame selection"; retire the "at most one web tile per layout, so the receiver is unambiguous" sentences to "one `IframeWindow` per layout with N frames — the component is still the sole receiver"; Design Decisions: one chrome + N frames (P3) vs N components; strip hidden below 2; frames keyed by URL; add-then-select client-side; port chip deferred.
- `run-kit/ui/keyboard-and-palette`: (modify) the four `Web: … tab` palette actions.
- `run-kit/ui/dialogs-and-state`: (modify) § Optimistic UI — `webActive`/`webTabs` optimistic overrides + SSE reconcile.
- `run-kit/tmux-sessions`: (modify) registry rows `@rk_win_web_<n>` / `@rk_win_web_active` writers gain "web tile strip via the verb routes; address bar replaces the active slot".
- `run-kit/api-and-sockets`: (modify) the three web verb route rows gain their frontend callers (`addWebTab`/`removeWebTab`/`selectWebTab`).

## Impact

- **Frontend** (`app/frontend/src`): `components/iframe-window.tsx` (major — prop contract + per-frame state + strip), `components/surface-layout.tsx` (mount site, optimistic overrides), `api/client.ts` (+3 functions), `lib/web-url.ts` (+`webTabTitle`), palette action registry (+4 actions), `lib/window-view.ts` unchanged.
- **Tests**: `iframe-window.test.tsx` (helper + ~12 new cases, 8 re-pointed), `web-url.test.ts`, `surface-layout.test.tsx` / `.web-integration.test.tsx`, new `tests/e2e/web-tabs.spec.ts`, `_tmux.ts` (+`stampWebTabs`).
- **Docs**: `docs/specs/ui-state.md` status flips; backlog entry for the deferred chip.
- **Backend / API**: none. **Payload**: none.
- **Risk**: P3 refactor of a 987-line component that currently assumes one frame — the per-frame state map is the risky part; the e2e pool budget bounds how many frames a spec may mount at once.

## Open Questions

- None blocking. `+` visibility below 2 tabs (hidden with the strip; palette carries the path) is a judgment call the reviewer may flip to "always show a compact `+` at the URL bar's end".

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly plan § Change 3; Changes 4–5 excluded; no backend, route, or payload changes | User's instruction verbatim; plan sequencing | S:95 R:90 A:95 D:95 |
| 2 | Certain | Remove goes through `POST …/web/{n}/remove`, not the plan's `DELETE` | Constitution IX; shipped route `api/router.go:757`; memory DD records the rejection | S:90 R:95 A:100 D:100 |
| 3 | Certain | Detected-port `+ :3000` chip is deferred to a follow-up (per-window `ports` field); nothing consumes host services | Asked — user chose "Defer the chip"; `win.ports` does not exist | S:90 R:90 A:90 D:90 |
| 4 | Certain | Address-bar Enter replaces `@rk_win_web_<active>` (slot 1 when empty); only `+` goes through `POST …/web` | Asked — user chose "Replace active tab"; spec § Web Tabs wording; today's behavior | S:90 R:90 A:90 D:90 |
| 5 | Confident | One `IframeWindow` chrome with N `<iframe>` children keyed by URL, per-frame state map, chrome bound to the active frame | Preserves the single-receiver CustomEvent invariant (find/zoom/address/open-external); N components would need listener gating | S:70 R:70 A:80 D:75 |
| 6 | Certain | Strip hidden at `tabs.length < 2`; 0–1 tab DOM byte-identical to today | Plan + spec verbatim | S:95 R:90 A:95 D:95 |
| 7 | Certain | Onboarding = `tabs.length === 0` (was `url.trim()===""`) | Plan verbatim; equivalent for dense families | S:90 R:95 A:95 D:95 |
| 8 | Certain | Client selects after add (`onAddTab` → `onSelectTab(index)`) because `WebAdd` only sets `_active` on an empty family | Verified `webtabs.go:164-167` ("add is not show"); the UI `+` is a user intent to look | S:70 R:90 A:85 D:80 |
| 9 | Confident | `+` with an empty/same-URL draft focuses the bar and arms a one-shot "next Enter adds" mode; `+` is hidden with the strip below 2 tabs, palette `Web: New tab from address` is the 0–1 path | Plan says "`+` → POST with the address-bar draft" but not the empty-draft case or the sub-2 path; several defensible UIs | S:45 R:85 A:60 D:45 |
| 10 | Certain | `webTabTitle`: basename / `localhost:{port}{path}` / host-only / raw; URL-derived, never page `<title>` | Plan's three cases verbatim; stable pre-load and cross-origin | S:75 R:95 A:85 D:80 |
| 11 | Certain | Palette actions `Web: Next/Previous/Close tab`, `Web: New tab from address`; strip is a roving `tablist` | Constitution V requires palette registration for every UI control | S:65 R:90 A:90 D:80 |
| 12 | Confident | Optimistic `webActive`/`webTabs` override via the Zustand optimistic-action pattern; add not optimistic; revert + toast on failure | Change 2 used it for `layout`; server index needed for add | S:65 R:85 A:80 D:80 |
| 13 | Certain | e2e is `web-tabs.spec.ts` with in-file intent comments; **no `.spec.md`**; `_tmux.ts` gains `stampWebTabs`; frames stubbed via `stubProxyPorts`; honor the 6-slot pool note | Constitution § Test Intent Comments; PR #758 retired sidecars; `surface-layout.spec.ts:32-34` | S:90 R:95 A:95 D:95 |
| 14 | Certain | Baseline touched web specs on clean `origin/main` first; `web-view-lens` :194/:412/:444/:521 are pre-existing | Plan § Sequencing + memory | S:90 R:95 A:95 D:95 |
| 15 | Certain | Change type `feat` (inferred; plan says 3 `feature`) | `.status.yaml` already `feat` | S:95 R:100 A:100 D:100 |
| 16 | Certain | `ui-state.md` § Web Tabs → `[current]` except the `rk present` sugar paragraph (Change 4); deferral note added to the port-affordance sentence; backlog entry for the chip | Change 2 precedent for status flips; deferral must be tracked | S:70 R:95 A:85 D:85 |
| 17 | Confident | Inactive frames: no timed dead-port probe, no progress line, no error surface; probe on mount + activation; all N mount eagerly (no lazy, no LRU) | P3 "hide, never unmount; eviction deferred"; 8-cap bounds cost | S:60 R:85 A:75 D:70 |

17 assumptions (13 certain, 4 confident, 0 tentative, 0 unresolved).
