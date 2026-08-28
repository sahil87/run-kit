# Plan: UI State Frontend — Layout + Code Root from tmux Options, Ladder Retired

**Change**: 260828-iip5-ui-state-frontend-layout-code-root
**Intake**: `intake.md`

> Scope guard: this plan implements ONLY plan-file Change 2 (`fab/plans/sahil/26-08-28-ui-state-tmux-options.md`). No web-tab strip, no `rk tab` CLI, no removal of the `/options` write shim / dual-read fields / n-less present route / migration rows. The single backend deletion is the derived `rkUrl`/`rkType` read shim that Change 1 assigned to this change.

## Requirements

### Frontend: Layout model (`lib/surface-layout.ts`)

#### R1: `effectiveLayout` replaces the resolution ladder
`lib/surface-layout.ts` MUST export `effectiveLayout(win: ViewWindow | null | undefined): Layout` = `degradeLayout(parseLayout(win?.layout), win) ?? { shape: "single", order: ["tty"] }`. The functions `hintLayout`, `resolveLayout`, `layoutStorageKey`, `readStoredLayout`, `writeStoredLayout`, `seedLayoutFromLegacy` MUST be deleted. `parseLayout`, `serializeLayout`, `degradeLayout`, `availableTiles`, `SURFACE_RAIL_HIDDEN`, every verb (`promote`, `swapWithNext`, `closeSurface`, `addSurface`, `cycleShape`, `setShape`, `shapesForArity`) and the ratios block MUST remain byte-identical in behavior. `translateLegacyParams` MUST remain (inbound one-release translation input) with its doc comment rewritten to say so.

- **GIVEN** a window record with `layout: "main-left:tty,code,web"` and `gitRoot: ""`
- **WHEN** `effectiveLayout(win)` runs
- **THEN** it returns `{ shape: "split-h", order: ["tty", "web"] }` (code degraded away, order kept, slot A kept) and `win.layout` is untouched
- **AND** for `layout: ""`, `layout: "garbage"`, or `layout: undefined` it returns `single:tty`

#### R2: Per-viewer zoom key
`lib/surface-layout.ts` MUST export `zoomStorageKey(server, windowId)` = `` `rk-layout-zoom:${server}:${windowId}` ``, `readStoredZoom(server, windowId): SurfaceKind | undefined` (validates the stored string with the module's surface-kind guard; garbage/absent/storage-unavailable → `undefined`), and `writeStoredZoom(server, windowId, kind: SurfaceKind | null)` (`null` removes the key; try/catch-noop like `writeStoredRatios`). The value is a surface **kind**.

- **GIVEN** `writeStoredZoom("s", "@3", "web")`
- **WHEN** `readStoredZoom("s", "@3")` runs
- **THEN** it returns `"web"`; after `writeStoredZoom("s", "@3", null)` it returns `undefined`; a stored `"bogus"` reads as `undefined`

### Frontend: Window record shape (`lib/window-view.ts`, `types.ts`)

#### R3: Payload fields replace `rkUrl`/`rkType`
`ViewWindow` (`lib/window-view.ts`) and `WindowInfo` (`types.ts`) MUST drop `rkType`/`rkUrl` and gain `layout?: string`, `webTabs?: string[]`, `webActive?: number`, `codeRoot?: string` with doc comments mirroring the backend `Window` struct. `hasWebUrl(win)` MUST become `(win?.webTabs?.length ?? 0) > 0`. A new `activeWebUrl(win): string` MUST return `webTabs[(webActive >= 1 ? webActive : 1) - 1] ?? ""` (empty family → `""`). `defaultView` MUST be deleted (its only consumer was `hintLayout`); `HINT_ORDER` stays as the capability ordering. `hasCode(win)` MUST be `((win?.codeRoot || win?.gitRoot) ?? "").length > 0` so a tab with a shared code root stays code-capable after its active pane leaves the repo (the latch's stable-availability contract). `readStoredView`/`windowViewStorageKey` and `right-panel.ts`'s `readStoredPanel`/`panelStorageKey` MUST remain, commented as one-release translation inputs (Change 5 deletes them). No frontend source file outside test fixtures may reference `rkUrl`/`rkType` after this change.

- **GIVEN** `{ webTabs: ["/proxy/3000/", "/present/@7/2/x.html"], webActive: 2 }`
- **WHEN** `activeWebUrl` / `hasWebUrl` run
- **THEN** they return `"/present/@7/2/x.html"` / `true`; for `{ webTabs: [] }` they return `""` / `false`; for `{ webTabs: ["a"], webActive: 0 }` `activeWebUrl` returns `"a"`

### Frontend: `app.tsx` layout state

#### R4: Layout is derived from the payload; verbs write `@rk_win_layout`
`app.tsx` MUST compute `layout = useMemo(() => effectiveLayout(effectiveWindow), [effectiveWindow])` with no `useState` copy and no localStorage read. `applyLayout(next)` MUST call `setWindowOptions(server, windowParam, { "@rk_win_layout": serializeLayout(next) })` and MUST NOT navigate or write localStorage. Every existing caller (`promote`/`swapWithNext`/`closeSurface`/`addSurface`/`cycleShape`/`setShape` tile verbs, `togglePanel` rail toggles, `switchView` for the `View:`/`Tile:` palette rows, the ▦ layout chip) keeps calling `applyLayout` unchanged.

- **GIVEN** a desktop viewer on `/s/3` whose window has `layout: ""`
- **WHEN** the user clicks the `Web tile` toggle
- **THEN** `POST /api/windows/@3/options {"options":{"@rk_win_layout":"split-h:tty,web"}}` is sent, the URL stays `/s/3` (no search params), and no `rk-layout:*` key is written

#### R5: Optimistic render until the option tick confirms
`app.tsx` MUST hold a `pendingLayout: { key: string; value: string } | null` state (key = `${server}:${windowId}`). `applyLayout` sets it before the POST; the rendered layout is `effectiveLayout({ ...effectiveWindow, layout: pendingLayout.value })` while `pendingLayout` matches the current route key. It is cleared when (a) the SSE/`/ws/state` window record's `layout` equals `pendingLayout.value`, or (b) the POST rejects (revert to the payload value; surface the failure through the existing mutation-feedback path used by other option writes), or (c) the route key changes. Degradation still applies to the pending value.

- **GIVEN** the POST takes 200 ms and the SSE tick lands 300 ms later
- **WHEN** the user promotes `web`
- **THEN** the tiles reorder immediately and do not flicker back when the tick confirms; if the POST returns 400 the previous arrangement is restored

#### R6: One-shot legacy translation at route entry (one release)
`app.tsx` MUST run one effect per `(server, windowParam)` arrival, gated on `effectiveWindow !== null`, that: (1) computes `carried = search.layout ?? translateLegacyParams(search.view, search.panel)`, `storedLayout = localStorage["rk-layout:{server}:{@N}"]`, `storedLegacy = translateLegacyParams(readStoredView(...), readStoredPanel(...))`; (2) if `effectiveWindow.layout === ""` and `parseLayout(carried ?? storedLayout ?? storedLegacy)` succeeds, calls `setWindowOptions({ "@rk_win_layout": serialized })` exactly once (per-key in-flight ref prevents a second fire while the payload still reads empty); (3) if `effectiveWindow.layout !== ""` writes nothing; (4) in both arms, when the URL carried any of `layout`/`view`/`panel`, navigates `replace: true` to the bare route with `search: {}`; (5) in both arms deletes exactly the four keys `rk-layout:{s}:{@N}`, `runkit-window-view:{s}:{@N}`, `runkit-window-panel:{s}:{@N}`, `runkit-code-folder:{s}:{@N}` (no prefix sweep); (6) if `effectiveWindow.codeRoot === ""` and `runkit-code-folder:{s}:{@N}` held a non-empty path, calls `setWindowOptions({ "@rk_win_code_root": folder })` once. `lib/router-url.ts` keeps accepting `view`/`panel`/`layout` inbound; nothing in the frontend writes `?layout=` anymore, and the two `navigate(..., search: { layout })` sites are deleted. The translated write renders through the same `pendingLayout` optimistic overlay as a verb (R5), so a carried deep link paints immediately rather than waiting for the option tick; a rejected write reverts.

- **GIVEN** a window with `layout: ""` opened via `/s/3?layout=split-h:tty,web`
- **WHEN** the record resolves
- **THEN** one POST sets `@rk_win_layout=split-h:tty,web`, the URL becomes `/s/3`, and the four keys for `(s, @3)` are gone
- **AND** GIVEN a window with `layout: "single:code"` opened via `/s/3?view=web` — THEN no POST is sent, the URL becomes `/s/3`, and the code tile renders (the shared layout wins)

#### R7: Present auto-expand removed
`lib/present-auto-expand.ts` and `lib/present-auto-expand.test.ts` MUST be deleted, together with the `autoExpandRef`/`autoExpandKeyRef`/`autoWebOpen` state, the observation effect, `renderLayout`, and the `foldLayoutMutation` call in `app.tsx`. Every former `renderLayout` consumer uses `layout` (the optimistic-aware derived value). A `tmux set-option -w @rk_win_layout` issued while a viewer is mounted MUST repaint on the next option tick with no client-side state machine.

- **GIVEN** a viewer mounted on `/s/3` rendering `single:tty`
- **WHEN** `tmux -L <srv> set-option -w -t @3 @rk_win_layout split-h:tty,web` runs
- **THEN** the web tile appears within the safety-poll bound and closing it via the rail toggle POSTs `single:tty`

#### R8: Window-switch ungated classification reads the payload
The `ungatedIds` derivation in `app.tsx` (the `flatWindows.filter(...)` block) MUST become `effectiveLayout(fw.window).order[0] !== "tty"` — no localStorage reads, no `translateLegacyParams`, no `withLatchedCodeFolder`.

- **GIVEN** a sidebar window whose payload `layout` is `single:web`
- **WHEN** the classifier runs
- **THEN** that window id is in `ungatedIds`; a window with `layout: ""` is not

#### R9: Zoom persists per viewer; mobile single-tile choice rides the same key
`components/surface-layout.tsx`'s `zoomedIndex` MUST initialize from `readStoredZoom(server, windowId)` (kind → first slot index of that kind in `layout.order`, `null` when absent/not in layout) and every zoom flip MUST call `writeStoredZoom` (the zoomed slot's kind, or `null` on unzoom). The existing clear-when-layout-cannot-host effect MUST also clear the key when the zoomed kind leaves `layout.order`. Zen-initiated zoom rides the same seam (accepted). In `app.tsx`, `mobileSlotA` state and its reset effect MUST be replaced: `mobileActiveTile = storedZoom && layout.order.includes(storedZoom) ? storedZoom : layout.order[0]` (re-read after each zoom write via a small epoch state or a subscription hook — the component must re-render on write). `switchToTile(kind)`: if `layout.order.includes(kind)` → `writeStoredZoom(kind)` only (no `@rk_win_layout` write); else `const next = addSurface(layout, kind)`; if `next` → `applyLayout(next)` and `writeStoredZoom(kind)`; if `null` → no-op and the switch-group button for that kind renders disabled. The former `switchView(single:<kind>)` arm for not-open surfaces is removed.

- **GIVEN** a phone viewer (375px) on a tab whose shared layout is `split-h:tty,web` and a desktop viewer on the same tab
- **WHEN** the phone taps `Web` in the switch group
- **THEN** the phone renders the web tile, `rk-layout-zoom:{s}:{@N}` = `web` on the phone, no POST is sent, and the desktop still shows both tiles
- **AND** WHEN the phone taps `Code` (available, not open) — THEN one POST sets `@rk_win_layout=main-left:tty,web,code`, the phone shows code, and the desktop grows to three tiles

### Frontend: Code root (`lib/code-folder-latch.ts`)

#### R10: Code root from `@rk_win_code_root`, seed + follow writes
`lib/code-folder-latch.ts` MUST delete `codeFolderStorageKey`/`readLatchedCodeFolder`/`writeLatchedCodeFolder` and export `codeRootFor(win): string` = `win?.codeRoot || win?.gitRoot || ""` and `codeRootSeed(win, layout): string | null` = `layout.order.includes("code") && !win?.codeRoot && win?.gitRoot ? win.gitRoot : null`. `app.tsx` MUST delete `latchEpoch`/`latchedCodeFolder`/`latchCodeFolder`/`withLatchedCodeFolder` (`effectiveWindow` becomes `currentWindow`, renamed or aliased as convenient); the seed effect MUST call `setWindowOptions({ "@rk_win_code_root": seed })` once per window while `codeRootSeed` is non-null (per-window in-flight ref so a second render before the tick does not re-POST); `onCodeFolderNavigated(folder)` MUST call `setWindowOptions({ "@rk_win_code_root": folder })` when `folder !== codeRootFor(win)`. `CodeSurface` receives `codeRootFor(win)` as its folder. The terminal never moves the code root (unchanged rule).

- **GIVEN** a repo-cwd window with `codeRoot: ""`, `gitRoot: "/repo"` and a viewer opening the code tile
- **WHEN** the code tile first renders
- **THEN** exactly one POST sets `@rk_win_code_root=/repo`; a later `cd /tmp` in the pane (gitRoot → `""`) leaves the editor on `/repo` and the code toggle still available
- **AND** WHEN code-server reports a folder navigation to `/repo/sub` — THEN one POST sets `@rk_win_code_root=/repo/sub`

### Frontend: Web tile feeds and client (`components/iframe-window.tsx`, `api/client.ts`)

#### R11: Web tile renders the active web tab; address bar writes the active slot
`components/surface-layout.tsx` MUST pass `activeWebUrl(win)` where it previously passed `win.rkUrl` (the `IframeWindow` `rkUrl` prop and the tile-header display at the `displayForm` call). `IframeWindow`'s address-bar submit MUST write `setWindowOptions(server, windowId, { ["@rk_win_web_" + n]: url })` with `n = webActive >= 1 ? webActive : 1` (the component receives `webActive` as a prop or the caller passes a `writeUrl(url)` callback). `api/client.ts` `updateWindowUrl` MUST be deleted or re-pointed to that slot form — one seam, and no frontend code writes `@rk_win_url`/`@rk_win_lens` afterwards. `createWindow(server, session, name?, cwd?, rkType?, rkUrl?)` MUST become `createWindow(server, session, name?, cwd?, webUrl?)`, sending `{ rkType: "iframe", rkUrl: webUrl }` in the body when `webUrl` is given (the backend keeps those body names this release); the sidebar "Open in window" caller passes only the URL.

- **GIVEN** a web tile on a window with `webTabs: ["/proxy/3000/"]`, `webActive: 1`
- **WHEN** the user submits `localhost:4000` in the address bar
- **THEN** `POST …/options {"options":{"@rk_win_web_1":"/proxy/4000/"}}` is sent (after the existing `normalizeAddressInput` + `isAllowedUrl` steps) and no `@rk_win_url` key appears in any request body

### Backend: derived compat read shim removed

#### R12: `deriveWebCompat` and the `RkUrl`/`RkType` JSON fields are deleted
`internal/sessions/sessions.go` MUST delete `deriveWebCompat` and its call site; `internal/tmux/tmux.go` MUST delete the `RkUrl`/`RkType` fields (and their `// compat:` comment) from the API-facing `Window` struct; the derivation unit test MUST be removed. `grep -rn 'RkUrl\|RkType\|rkUrl\|rkType' app/backend` MUST match only (a) the `POST /api/sessions/{session}/windows` body struct + handler in `api/windows.go` (Change 1 R10, kept this release) and (b) test fixtures for that handler. `translateLegacyOptionKeys`, the `@rk_win_url`/`@rk_win_lens` dual-read format fields, the n-less present route, and every `legacy*Option` const MUST be untouched.

- **GIVEN** a window with `@rk_win_web_1=/proxy/3000/` and `@rk_win_layout=single:web`
- **WHEN** `GET /api/sessions` (or the SSE `sessions` event) serializes it
- **THEN** the JSON has `layout`, `webTabs`, `webActive` and no `rkUrl`/`rkType` keys; `go test ./...` is green

### Tests

#### R13: Unit coverage follows the new pure surface
`surface-layout.test.ts` MUST drop the `hintLayout`, `resolveLayout`, `storage keys + read/write` (layout half), and `seedLayoutFromLegacy` blocks and add `effectiveLayout` (unset/valid/partially-unavailable/fully-invalid/malformed) and zoom-storage (round-trip, clear, garbage) cases; the `translateLegacyParams` block stays. `window-view.test.ts` MUST cover `hasWebUrl` over `webTabs`, `activeWebUrl` (empty, in-range, `webActive` 0/out-of-range), `hasCode` with `codeRoot`-only, and drop `defaultView` cases. `code-folder-latch.test.ts` MUST cover `codeRootFor` precedence and `codeRootSeed` (code open + empty codeRoot + non-empty gitRoot → seed; each negation → `null`). A pure helper for R6's decision (`legacyTranslationDecision({carried, storedLayout, storedLegacy, winLayout})` → `{ write?: string, dropParams: boolean }` or equivalent) MUST exist in `lib/surface-layout.ts` with tests for the precedence and the set-layout-drops-params arm. `present-auto-expand.test.ts` is deleted.

- **GIVEN** `just test-frontend`
- **WHEN** it runs
- **THEN** it is green with the new cases present and the deleted modules absent

#### R14: e2e specs assert tmux, not localStorage/URL
`tests/e2e/surface-layout.spec.ts`, `right-panel.spec.ts`, `mobile-layout.spec.ts`, `surface-focus-chords.spec.ts`, `code-folder-latch.spec.ts` MUST be re-pointed: a `windowOption(id, key): string` helper in `tests/e2e/_tmux.ts` (`execFileSync("tmux", ["-L", TMUX_SERVER, "show-option", "-wv", "-t", id, key])` argument arrays, trimmed, `""` on unset) replaces every `expectLayoutParam`/`?layout=` URL assertion with an `expect.poll(() => windowOption(id, "@rk_win_layout")).toBe(...)`; window setup stamps `@rk_win_web_1` + `@rk_win_web_active 1` instead of `@rk_win_url`; reload-persistence tests reload the bare route and assert the tile set; `?layout=`/`?view=`/`?panel=` deep-link tests become two translation tests (carried param → one option write + bare URL; `win.layout` set → params dropped, no write); code-folder tests assert `@rk_win_code_root` after the seed and after the follow write. `present-auto-expand.spec.ts` MUST be rewritten as "an external `set-option -w @rk_win_layout` repaints the mounted viewer" (R7 scenario) with the `@rk_win_url` stamping removed. New tests: (a) two contexts on one window — A toggles the web tile, B (no interaction) shows it; (b) zoom in A, B unzoomed; (c) 375px switch-to-tile of an open surface sends no POST while the desktop context keeps both tiles. Every touched/added `test()` carries a **Proves:/Steps:** JSDoc and the file header covers shared setup; no `.spec.md` files are created. Before editing, the seven specs (`surface-layout`, `right-panel`, `mobile-layout`, `surface-focus-chords`, `code-folder-latch`, `present-auto-expand`, `web-view-lens`) MUST be baselined on a clean `origin/main` worktree and the baseline recorded in `## Notes`; the same seven MUST be run together (`just test-e2e "<spec>"` per spec or a single grep) before the apply result is returned; `web-view-lens` failures at the memory-recorded pre-existing lines are not regressions.

- **GIVEN** `just test-e2e` on the touched specs
- **WHEN** it runs on this branch
- **THEN** every re-pointed and new test passes; the only failures, if any, are the recorded `web-view-lens` pre-existing ones

### Docs (specs amended in place)

#### R15: Spec banners replaced by in-place amendments
`docs/specs/window-views.md`: R2 rewritten (lens choice is shared tab state in `@rk_win_layout`; zoom/single-tile choice is the only per-viewer part, `rk-layout-zoom:*`), R5 replaced by a one-line "R5 — retired: the default-view hint is subsumed by an explicit `single:web` layout (ui-state.md)", R7 rewritten (content address `@rk_win_web_<n>` AND lens choice `@rk_win_layout` are both substrate state; zoom, ratios, focus are local); top banner removed. `docs/specs/surface-layout.md`: § State (L1–L4) replaced by a pointer to `ui-state.md` § Layout in tmux plus one paragraph on per-viewer ratios/zoom, no present carve-out, bare-route history; § Mobile "Switch-to-tile" row updated to zoom-key + `--add` semantics; top banner removed. `docs/specs/right-panel.md`: P1 rewritten (tile choice is shared via `@rk_win_layout`; panel width per-viewer); § Surface Registry `code` row's LATCHED sentence points at `@rk_win_code_root`; top banner removed. `docs/specs/ui-state.md`: status line marks §§ Layout in tmux and Code Surface + Code Bridge `[current]` (Web Tabs strip and `rk tab` still planned).

- **GIVEN** `grep -n "Amended by" docs/specs/window-views.md docs/specs/surface-layout.md docs/specs/right-panel.md`
- **WHEN** it runs after this change
- **THEN** it matches nothing, and each named section carries the new text

### Non-Goals

- Web tab strip, `webTabTitle`, detected-port chip, `POST …/web` UI calls — Change 3.
- `rk tab` family, `rk present` sugar, `rk code exec --tab` — Change 4.
- Removing `translateLegacyOptionKeys`, dual-read fields, n-less `/present/` route, migration rows, or the client one-shot translation — Change 5.
- Ratios in tmux (spec OQ1), navigation/follow mode, boards convergence.

### Design Decisions

#### Zoom key stores a surface kind
**Decision**: `rk-layout-zoom:{server}:{@N}` holds a `SurfaceKind`; desktop zoom resolves it to the first slot of that kind.
**Why**: one key serves desktop zoom and the kind-addressed mobile switch group; the spec phrases the clear rule as "the zoomed *surface* leaves the layout".
**Rejected**: slot index — breaks the mobile switch group's kind addressing and survives a reorder pointing at the wrong tile. Duplicate-tty zoom independence (hand-written layouts only) is not persisted.
*Introduced by*: 260828-iip5-ui-state-frontend-layout-code-root

#### Mobile switch to a not-open surface grows the shared layout
**Decision**: `switchToTile(kind)` for a kind not in the layout runs `addSurface` through `applyLayout` and sets the local zoom key; `null` growth is a disabled no-op.
**Why**: the spec names the `--add` mutation for this case; the previous `single:<kind>` collapse rewrote every desktop viewer's arrangement from a phone.
**Rejected**: keep the collapse — violates the one-rule (a phone posture must not destroy shared tab state).
*Introduced by*: 260828-iip5-ui-state-frontend-layout-code-root

#### Optimistic layout lives in `app.tsx` state, not the Zustand store
**Decision**: a single `pendingLayout {key, value}` state overlaid on `effectiveLayout`, cleared by payload equality / POST rejection / route change.
**Why**: the layout has exactly one writer surface (the terminal route) and one consumer; a store-level override would add a cross-component channel nothing else reads.
**Rejected**: Zustand window-store patch — heavier, and the store's optimistic machinery is built for ghost rows, not field overrides.
*Introduced by*: 260828-iip5-ui-state-frontend-layout-code-root

### Deprecated Requirements

#### `?layout=` / `?view=` / `?panel=` as layout state (surface-layout.md L1–L4, window-views R2, right-panel P1)
**Reason**: tab state moved to `@rk_win_layout`; the URL is the bare route.
**Migration**: one release of inbound translation (R6); Change 5 removes it.

#### Present auto-expand transient override (surface-layout.md L3 carve-out)
**Reason**: the layout write is the expand; every viewer renders it.
**Migration**: `tmux set-option -w @rk_win_layout …` now; `rk present --show` in Change 4.

#### Per-browser code-folder latch (`runkit-code-folder:*`)
**Reason**: replaced by the shared `@rk_win_code_root`.
**Migration**: one-shot client migration in R6 step 6.

#### Derived `rkUrl`/`rkType` Window JSON fields
**Reason**: the frontend reads `webTabs`/`webActive`/`layout` directly.
**Migration**: N/A (last consumer removed in this change).

## Tasks

### Phase 1: Setup

- [x] T001 Baseline: create a clean `origin/main` worktree (`wt create` or `git worktree add`), run `just test-e2e` for the seven specs (`surface-layout`, `right-panel`, `mobile-layout`, `surface-focus-chords`, `code-folder-latch`, `present-auto-expand`, `web-view-lens`), record pass/fail per spec:line in `## Notes` of this plan, then remove the worktree <!-- R14 -->
- [x] T002 [P] Update `app/frontend/src/types.ts` `WindowInfo` and `app/frontend/src/lib/window-view.ts` `ViewWindow`: drop `rkType`/`rkUrl`, add `layout`/`webTabs`/`webActive`/`codeRoot` with backend-mirroring doc comments <!-- R3 -->
- [x] T003 [P] Backend: delete `deriveWebCompat` + call in `app/backend/internal/sessions/sessions.go`, the `RkUrl`/`RkType` fields on `Window` in `app/backend/internal/tmux/tmux.go`, and their unit test; `cd app/backend && go test ./...` green; grep confirms only the `POST /windows` body names remain <!-- R12 -->

### Phase 2: Core Implementation

- [x] T004 `app/frontend/src/lib/surface-layout.ts`: delete `hintLayout`, `resolveLayout`, `layoutStorageKey`, `readStoredLayout`, `writeStoredLayout`, `seedLayoutFromLegacy`; add `effectiveLayout`; add `zoomStorageKey`/`readStoredZoom`/`writeStoredZoom`; add the pure `legacyTranslationDecision` helper; rewrite `translateLegacyParams`'s doc comment to one-release inbound-only <!-- R1 R2 R6 -->
- [x] T005 `app/frontend/src/lib/window-view.ts`: `hasWebUrl` over `webTabs`, new `activeWebUrl`, `hasCode` honoring `codeRoot`, delete `defaultView`, comment `readStoredView`/`windowViewStorageKey` as translation-only inputs; same comment on `readStoredPanel`/`panelStorageKey` in `app/frontend/src/lib/right-panel.ts` <!-- R3 -->
- [x] T006 `app/frontend/src/lib/code-folder-latch.ts`: delete the storage functions; export `codeRootFor` and `codeRootSeed`; rewrite the module header for the shared-option model <!-- R10 -->
- [x] T007 Delete `app/frontend/src/lib/present-auto-expand.ts` and `app/frontend/src/lib/present-auto-expand.test.ts`; remove their imports from `app/frontend/src/app.tsx` <!-- R7 -->
- [x] T008 `app/frontend/src/app.tsx` layout block: replace the `searchLayout`/`storedLayout`/`resolveLayout` block with `effectiveLayout(effectiveWindow)` plus the `pendingLayout` optimistic overlay; rewrite `applyLayout` as the `setWindowOptions` POST (set pending → POST → clear on payload equality / revert on reject / clear on route change); delete the auto-expand block and `renderLayout` (rename consumers to `layout`); delete the URL-mirror effect, the `seedLayoutFromLegacy` effect, and both `navigate(..., search: { layout })` sites <!-- R4 R5 R7 -->
- [x] T009 `app/frontend/src/app.tsx`: add the one-shot legacy-translation effect (R6 steps 1–6) using `legacyTranslationDecision`, gated on `effectiveWindow !== null`, with a per-key in-flight ref; update `app/frontend/src/lib/router-url.ts`'s module comment to inbound-only translation <!-- R6 -->
- [x] T010 `app/frontend/src/app.tsx` code root: delete `latchEpoch`/`latchedCodeFolder`/`latchCodeFolder`/`withLatchedCodeFolder`; seed effect → `setWindowOptions({"@rk_win_code_root": codeRootSeed(win, layout)})` with an in-flight ref; `onCodeFolderNavigated` → `setWindowOptions({"@rk_win_code_root": folder})` when it differs from `codeRootFor(win)`; pass `codeRootFor(win)` to `CodeSurface` via `components/surface-layout.tsx` <!-- R10 -->
- [x] T011 `app/frontend/src/app.tsx` ungated classifier: `effectiveLayout(fw.window).order[0] !== "tty"`; remove the localStorage/`translateLegacyParams`/`readLatchedCodeFolder` reads and the now-unused imports <!-- R8 -->
- [x] T012 `app/frontend/src/components/surface-layout.tsx` zoom: init `zoomedIndex` from `readStoredZoom` (kind → first slot), write on every flip, clear the key when the zoomed kind leaves `layout.order`; expose the write through the existing `onZoomChange`/`zoomToggleRef` seam unchanged <!-- R9 -->
- [x] T013 `app/frontend/src/app.tsx` mobile: replace `mobileSlotA` + reset effect with the stored-zoom read (epoch or subscription so writes re-render); rewrite `switchToTile` (open → zoom key only; not-open → `addSurface` + `applyLayout` + zoom key; `null` → no-op + disabled button in the switch group / `Tile: Switch to` palette rows) <!-- R9 -->
- [x] T014 `app/frontend/src/components/surface-layout.tsx` + `components/iframe-window.tsx`: feed `activeWebUrl(win)` where `win.rkUrl` was used (tile header `displayForm`, `IframeWindow` `rkUrl` prop); address-bar submit writes `@rk_win_web_<n>` (n = webActive or 1) via `setWindowOptions`; in `app/frontend/src/api/client.ts` delete or re-point `updateWindowUrl`, change `createWindow` to `(server, session, name?, cwd?, webUrl?)` sending `{rkType:"iframe", rkUrl}` when given, and update the sidebar "Open in window" caller; grep `rkUrl|rkType` across `app/frontend/src` (non-test) → zero hits <!-- R11 -->
- [x] T015 `cd app/frontend && npx tsc --noEmit` clean; fix every type error introduced by T002–T014 <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T016 [P] Unit tests: rewrite `app/frontend/src/lib/surface-layout.test.ts` (drop ladder/storage/seed/hint blocks; add `effectiveLayout`, zoom storage, `legacyTranslationDecision`), update `window-view.test.ts` (`hasWebUrl`/`activeWebUrl`/`hasCode`, drop `defaultView`), rewrite `code-folder-latch.test.ts` (`codeRootFor`/`codeRootSeed`); fix any `app.test.tsx`/component tests that built `rkUrl`/`rkType` fixtures; `just test-frontend` green <!-- R13 -->
- [x] T017 [P] `app/frontend/tests/e2e/_tmux.ts`: add `windowOption(id, key)` (argument-array `execFileSync`, trimmed, `""` on unset) and a `stampWebTab(id, url)` helper writing `@rk_win_web_1` + `@rk_win_web_active 1` <!-- R14 -->
- [x] T018 Re-point `app/frontend/tests/e2e/surface-layout.spec.ts` and `right-panel.spec.ts`: `@rk_win_layout` assertions via `expect.poll(windowOption)`, `stampWebTab` instead of `@rk_win_url`, delete `expectLayoutParam`, convert deep-link tests into the two translation tests, reload-persistence via bare route; update Proves/Steps JSDoc + file headers <!-- R14 -->
- [x] T019 Re-point `app/frontend/tests/e2e/mobile-layout.spec.ts`, `surface-focus-chords.spec.ts`, `code-folder-latch.spec.ts` (code-folder asserts `@rk_win_code_root` after seed and after follow); add the 375px no-POST switch-to-tile test; update Proves/Steps JSDoc + headers <!-- R14 R9 R10 -->
- [x] T020 Rewrite `app/frontend/tests/e2e/present-auto-expand.spec.ts` as "external `set-option -w @rk_win_layout` repaints the mounted viewer" (remove `@rk_win_url` stamping; keep the Connected-readiness gate); add the two-context shared-layout test and the two-context zoom-isolation test (in `surface-layout.spec.ts` or this file); Proves/Steps JSDoc <!-- R14 R7 -->
- [x] T021 Run the seven specs together via `just test-e2e` (one invocation per spec or a single grep); fix regressions; record results next to the T001 baseline in `## Notes`; confirm `web-view-lens` failures, if any, match the baseline lines <!-- R14 -->

### Phase 4: Polish

- [x] T022 [P] Spec amendments: `docs/specs/window-views.md` (R2/R7 rewritten, R5 retired line, banner removed), `docs/specs/surface-layout.md` (§ State → pointer + ratios/zoom paragraph; Mobile switch-to-tile row; banner removed), `docs/specs/right-panel.md` (P1 rewritten; `code` row LATCHED → `@rk_win_code_root`; banner removed), `docs/specs/ui-state.md` (status `[current]` for §§ Layout in tmux, Code Surface + Code Bridge) <!-- R15 -->
- [x] T023 Final gates in order: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; `just build` <!-- R12 R13 -->

## Execution Order

- T001 first (baseline must predate any edit to the specs it measures)
- T002 and T003 are independent of each other; T002 blocks T004–T015
- T004–T007 before T008–T014 (app.tsx consumes the new pure exports); T015 after T014
- T017 blocks T018–T020; T021 after T018–T020
- T022 can run alongside Phase 3; T023 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `effectiveLayout` exists with the documented fallback/degradation semantics; `hintLayout`/`resolveLayout`/layout storage/`seedLayoutFromLegacy` are gone from `lib/surface-layout.ts`
- [x] A-002 R2: `zoomStorageKey`/`readStoredZoom`/`writeStoredZoom` exist with kind validation and null-clears
- [x] A-003 R3: `ViewWindow`/`WindowInfo` carry `layout`/`webTabs`/`webActive`/`codeRoot` and no `rkUrl`/`rkType`; `activeWebUrl` and the new `hasWebUrl`/`hasCode` behave as specified; `defaultView` is gone
- [x] A-004 R4: `applyLayout` POSTs `@rk_win_layout` and neither navigates nor writes localStorage; all verb/toggle/palette/chip callers still route through it
- [x] A-005 R5: the pending-layout overlay renders immediately and clears on payload equality, POST rejection (with revert), and route change
- [x] A-006 R6: the one-shot effect implements steps 1–6 with the stated precedence, single-fire guard, bare-route replace, and exactly-four-key deletion
- [x] A-007 R7: `present-auto-expand.ts`/`.test.ts` and all auto-expand state in `app.tsx` are deleted
- [x] A-008 R8: `ungatedIds` derives from `effectiveLayout(fw.window)` only
- [x] A-009 R9: zoom initializes from and writes to the zoom key; mobile active tile reads it; `switchToTile` follows the open/not-open/null branches
- [x] A-010 R10: `codeRootFor`/`codeRootSeed` exist; seed and follow writes target `@rk_win_code_root` with the in-flight guard; latch storage code is gone
- [x] A-011 R11: the web tile renders `activeWebUrl`; the address bar writes `@rk_win_web_<n>`; `createWindow` has the new signature; no frontend source references `rkUrl`/`rkType`/`@rk_win_url`/`@rk_win_lens`
- [x] A-012 R12: `deriveWebCompat` and the `RkUrl`/`RkType` struct fields are deleted; the write shim, dual-read fields, n-less present route, and `legacy*Option` consts are untouched
- [x] A-013 R15: the three spec banners are gone and each named section carries the amended text; `ui-state.md` marks the two sections `[current]`

### Behavioral Correctness

- [x] A-014 R4: clicking a rail toggle leaves the URL as the bare route (no `?layout=`) and results in exactly one `/options` POST
- [x] A-015 R6: `/s/N?layout=…` on an unset window produces one POST and a cleaned URL; the same link on a set window produces zero POSTs and a cleaned URL
- [x] A-016 R9: a mobile switch to an open surface sends no POST; to a not-open surface sends one `addSurface`-shaped POST
- [x] A-017 R10: after the seed, an active-pane `cd` out of the repo leaves the code tile and its availability intact

### Removal Verification

- [x] A-018 R7: no code path composes a render-time web override; an external `@rk_win_layout` write repaints without client state
- [x] A-019 R1: `grep -rn "rk-layout:" app/frontend/src` matches only the one-shot deletion/read in the translation helper
- [x] A-020 R12: `grep -rn 'rkUrl\|rkType' app/backend` matches only the `POST /windows` body handling and its tests

### Scenario Coverage

- [x] A-021 R14: two browser contexts on one window converge on the layout after one toggles a tile
- [x] A-022 R14: zoom in one context does not zoom the other
- [x] A-023 R14: the rewritten `present-auto-expand.spec.ts` proves an external `set-option` repaint
- [x] A-024 R14: every touched spec asserts `@rk_win_layout` / `@rk_win_code_root` through `windowOption`, none through `?layout=` or `rk-layout:` localStorage
- [x] A-025 R14: the T001 baseline and T021 results are recorded in `## Notes`; no regression outside the recorded `web-view-lens` lines

### Edge Cases & Error Handling

- [x] A-026 R1: a hand-written invalid `@rk_win_layout` renders `single:tty` and the option value is not rewritten
- [x] A-027 R5: a rejected layout POST reverts the render to the payload layout
- [x] A-028 R6: the translation effect never fires twice for one arrival even when the payload is slow to reflect the write
- [x] A-029 R9: the zoom key is cleared when the zoomed kind leaves the layout; `addSurface` returning `null` disables the mobile switch target instead of throwing
- [x] A-030 R3: `activeWebUrl` tolerates `webActive` 0 / out-of-range by falling back to slot 1

### Code Quality

- [x] A-031 Pattern consistency: pure helpers + colocated tests in `lib/`, `app.tsx` holds thin wiring; new storage helpers follow the try/catch-noop ratios pattern
- [x] A-032 No unnecessary duplication: `setWindowOptions` is the single write seam (no new client helpers per key beyond the address-bar slot write); `_tmux.ts` gains the shared `windowOption`/`stampWebTab` helpers instead of per-spec copies
- [x] A-033 Type narrowing over assertions: `readStoredZoom` validates via the surface-kind guard, no `as` casts on parse paths
- [x] A-034 No client polling: repaint relies on the SSE tick; no `setInterval` introduced
- [x] A-035 Comment discipline: no comment narrates change IDs/PR numbers or "previously/now" transitions; comments state constraints only
- [x] A-036 Test intent: every touched/added Playwright `test()` has a Proves/Steps JSDoc and each touched spec file has a current header; no `.spec.md` companions
- [x] A-037 Tests cover added/changed behavior (unit for every new pure export; e2e for every user-visible behavior change)

### Security

- [x] A-038 R11: the address-bar write still passes `normalizeAddressInput` + `isAllowedUrl` before the POST; backend validation remains the enforcement point

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- T001 baseline results (clean `origin/main` worktree @ 8e4c3310, 2026-08-29, throwaway worktree removed after run):
  - `surface-layout`: 1 failed / 11 passed — `surface-layout.spec.ts:907` (split chord tty-scoped, 260812-wfic R8)
  - `right-panel`: 7 failed / 4 flaky / 2 passed — failed: `:214` `:250` `:297` `:356` `:413` `:460` `:538`; flaky: `:160` `:509` `:571` `:607`
  - `mobile-layout`: 4 passed
  - `surface-focus-chords`: 4 passed
  - `code-folder-latch`: 2 passed
  - `present-auto-expand`: 3 passed
  - `web-view-lens`: 5 failed / 2 flaky / 3 passed — failed: `:194` `:326` `:412` `:444` `:521` (`:194`/`:412`/`:444`/`:521` are the memory-recorded pre-existing local failures; `:326` additionally fails locally on this machine); flaky: `:478` `:596`
- T021 branch results (this worktree @ HEAD of the change branch, 2026-08-29 — the seven specs in ONE `just test-e2e` invocation, exit 0):
  - Combined run: **50 passed / 0 failed / 0 flaky** (9.9m) across `surface-layout` (15), `right-panel` (13), `mobile-layout` (4), `surface-focus-chords` (4), `code-folder-latch` (2), `present-auto-expand` (3, rewritten to external-`set-option` repaint), `web-view-lens` (10).
  - The T001 baseline's failing lines no longer exist as such: every re-pointed spec asserts `@rk_win_layout` / `@rk_win_code_root` via `windowOption` (tmux) instead of `?layout=` / localStorage, so the old local-failure lines (`right-panel:214/250/297/356/413/460/538`, `web-view-lens:194/326/412/444/521`, `surface-layout:907`) are gone with the old assertions; their equivalents pass. Two right-panel tests flake-retried green on intermediate runs (suite-load timing on this box), zero in the final combined run.
  - Note for review: the pre-existing "Maximum update depth" console noise reproduces identically on a clean `origin/main` worktree (verified with a probe spec) — not introduced by this change.
- Sibling e2e specs touched by the re-point but outside the seven (run by the orchestrator before ship, 2026-08-29): `chat-view`, `code-surface`, `compose-strip`, `focus-restore`, `top-bar-overflow`, `web-tile-chrome`, `web-tile-find`, `web-tile-zoom`.
  - First branch run: 15 failed / 8 flaky / 37 passed. Root causes: (A) fully-mocked specs deep-linking `?view=` (`chat-view` ×10) — the one-shot translation POSTed to an unmocked `/options` and the mocked payload never reflected the write; fixed by rendering the translated layout through the `pendingLayout` optimistic overlay (a carried deep link now paints immediately, R5/R6) and mocking `/options` in `chat-view.spec.ts`. (B) `web-tile-chrome` (a)/(b) counted the arrival's translation write as a chrome mutation — the counter now starts after the write has landed in tmux. (C) `web-tile-zoom:145`, `code-surface:441`, `top-bar-overflow:720` — "element not stable" click timeouts.
  - Clean `origin/main` baseline of `web-tile-zoom` + `code-surface` + `top-bar-overflow` + `web-tile-chrome` on the same box: 9 failed / 4 flaky / 12 passed (`top-bar-overflow` :217/:316/:419/:498/:723, `code-surface` :360/:387 (+:301 flaky), `web-tile-zoom` :149 (+:174 flaky), `web-tile-chrome` :207 (+:148 flaky)) — cluster (C) and `web-tile-chrome` (b) are pre-existing local failures, not regressions. Note: the baseline and the branch re-run overlapped in time, which adds load-induced flakiness to both.
  - After the fixes: `chat-view` 10/10 pass (1 flaky-retried); `web-tile-chrome` (a)/(c)/(d) pass, (b) fails as on main.

## Deletion Candidates

- `app/frontend/src/components/iframe-window.tsx:45,93` — `windowId` prop is dead: declared and destructured but never read after the address-bar write moved to the `onWriteUrl` seam.
- `app/frontend/src/lib/window-view.ts:126` — `HINT_ORDER` symbol name outlived the deleted default-view hint; the array is now purely the capability ordering (rename candidate).
- `app/frontend/tests/e2e/{surface-layout,right-panel,web-view-lens,code-surface}.spec.ts` — identical per-file `expectWindowLayout`/`expectBareUrl` copies (the pre-existing per-spec helper convention; a shared home beside `_tmux.ts`/`_ready.ts` would dedupe).
- `app/backend/internal/tmux/tmux.go:1261-1264`, `app/frontend/tests/e2e/compose-strip.spec.ts:40`, `app/frontend/tests/e2e/right-panel.spec.ts:757`, `app/frontend/tests/e2e/surface-layout.spec.ts:845` — stale comments citing the deleted `present-auto-expand` consumer / the removed `rkUrl` payload field (comment drift, not behavior).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Optimistic layout is `app.tsx` state (`pendingLayout`), not a Zustand store patch | Single writer/consumer; store's optimistic machinery is ghost-row shaped | S:70 R:90 A:80 D:75 |
| 2 | Confident | The one-shot translation decision is extracted as a pure helper so unit tests cover precedence without React | Matches the lib/ pure-helper + colocated-test contract | S:75 R:95 A:90 D:85 |
| 3 | Confident | `IframeWindow` gets the active slot index (or a write callback) rather than computing it from a window record | Keeps the component payload-shape agnostic for Change 3's strip | S:60 R:90 A:80 D:70 |
| 4 | Confident | Mobile switch-target disabled state for `addSurface === null` reuses the switch group's existing disabled affordance | Arity-3-without-kind is reachable only with chat present; no new UI vocabulary | S:60 R:90 A:75 D:75 |
| 5 | Certain | Baseline recorded in `## Notes` of this plan (not a new file) | Plan is the apply/review shared artifact | S:85 R:95 A:95 D:95 |

5 assumptions (1 certain, 4 confident, 0 tentative).
