# Intake: UI State Frontend — Layout + Code Root from tmux Options, Ladder Retired

**Change**: 260828-iip5-ui-state-frontend-layout-code-root
**Created**: 2026-08-29

## Origin

> Change 2 from fab/plans/sahil/26-08-28-ui-state-tmux-options.md -- Frontend: layout + code root read from tmux options, ladder retired (LARGE). Change 1 (backend options/payload/snapshot/migration, incl. the read+write compat shim) already merged to main. Implement exactly the Change 2 section of that plan file; do not implement Changes 3-5.

One-shot `/fab-new` invocation. The design is fully authored in two human-curated documents that this intake transcribes rather than re-derives:

- **Plan**: `fab/plans/sahil/26-08-28-ui-state-tmux-options.md` § "Change 2 — Frontend: layout + code root from tmux, ladder retired (LARGE)" — the authoritative scope. Changes 3 (web tab strip), 4 (`rk tab` CLI), 5 (cleanup) are explicitly OUT of scope.
- **Spec**: `docs/specs/ui-state.md` v0.2 — §§ The One Rule, Layout in tmux, Code Surface + Code Bridge, Viewer Behaviour, What Dies/What Stays, Migration. Decided 2026-08-28: zoom is per-viewer; navigation is not tmux state; `?layout=` dies after one release of translation.

**Change 1 landed as PR #759 (`8e4c3310`, change `260828-fykg-ui-state-backend-tmux-options`)** and is the stable contract this change builds on. Verified at `origin/main` while drafting this intake:

- Window JSON (`internal/tmux/tmux.go` `Window` struct ~`:740`) carries `layout` (raw `@rk_win_layout` string, `""` = unset), `webTabs` (dense `[]string`, index 0 = tmux slot 1), `webActive` (1-based, `0` = no tabs), `codeRoot` (absolute folder or `""`). It ALSO still emits **derived** `rkUrl`/`rkType` (`internal/sessions/sessions.go` `deriveWebCompat` `:563-570`, called at `:725`) marked `// compat: removed by the frontend layout change (ui-state plan Change 2)` — **this change deletes that read shim** (it is the frontend's last consumer).
- `POST /api/windows/{id}/options` allowlist (`api/windows.go` `:390-400`) accepts `@rk_win_layout` (validated by `layoutspec.Parse`), `@rk_win_web_1..8`, `@rk_win_web_active`, `@rk_win_code_root` (`validate.ValidatePath` + tilde-expand), plus the **write** compat keys `@rk_win_url`/`@rk_win_lens` translated by `translateLegacyOptionKeys` (marked for Change 5 — **left in place** by this change). The handler wakes the SSE hub after a successful write, so a viewer's own click repaints within the same tick (row-color safety-poll lesson already applied).
- `POST /api/sessions/{session}/windows` keeps the body field NAMES `rkType:"iframe"`/`rkUrl` this release (Change 1 R10) and writes `@rk_win_layout=single:web` + `@rk_win_web_1` + `_active=1`. The frontend `createWindow` arm is what this change renames.
- `@rk_win_url` is **dual-read** server-side (never swept — `parseWindows` field 24 falls back to it when slot 1 is empty); `@rk_win_lens=iframe` dual-reads as `single:web` when `_layout` is empty. These keep the current e2e specs (which stamp `@rk_win_url` via `tmux set-option`) working until this change re-points them.
- Backend consts: `tmux.LayoutOption`, `tmux.WebTabOption(n)`, `tmux.WebActiveOption`, `tmux.CodeRootOption`, `tmux.MaxWebTabs = 8`.

No prior conversation preceded this invocation; all decisions below come from the plan/spec + codebase verification.

## Why

**The problem.** Tab state — what a tmux window *shows* in run-kit — currently lives in the viewer's browser. `rk-layout:{server}:{@N}`, `runkit-window-view:*`, `runkit-window-panel:*` (`lib/surface-layout.ts:308-375`) and the code-folder latch `runkit-code-folder:*` (`lib/code-folder-latch.ts`) are per-browser localStorage keys that decide which surfaces a tab renders and which folder its editor opens; `?layout=` in the URL is a second copy of the same state (the L1–L4 resolution ladder, `resolveLayout` at `surface-layout.ts:286`, mirrored via `replaceState` in `app.tsx:838-873`). Consequences:

1. **An agent cannot open a surface on a tab.** `rk present` had to grow the `present-auto-expand.ts` render-time carve-out (a per-viewer transient override watching `rkUrl` transitions) to fake "show the web tile" — 106 lines of state machine plus an e2e spec, and it only works for viewers already mounted on the route.
2. **Two viewers of one tab disagree.** A phone and a desktop looking at the same window render different layouts and different code folders. tmux itself shares pane layout across every attached client; run-kit's per-viewer layout is the deviation from the substrate it renders.
3. **Snapshot restore orphans every key.** A restored window gets a new `@N`, so its layout and latch vanish while the backend (since Change 1) faithfully restores `@rk_win_layout`/`@rk_win_code_root` — state the frontend does not yet read.
4. **Two stores must be nudged.** Every verb writes localStorage AND navigates to mirror the URL; the mobile arm, the ungated-window-switch classifier (`app.tsx:2095-2135`), and the latch all re-read localStorage at render with epoch bumps to stay coherent. The 1844-line `surface-layout.tsx` is presentational, but `app.tsx` carries ~250 lines of ladder/mirror/seed/auto-expand machinery.

**If we don't fix it.** Change 1's backend contract (options, payload, verb routes, snapshot round-trip, migration) sits unused; Change 3 (web tab strip) and Change 4 (`rk tab` CLI) cannot ship because the frontend would not render what agents write. The compat read shim (`deriveWebCompat`) and the dual-read fields would have to be carried indefinitely.

**Why this approach.** The frontend becomes a *renderer of tmux state*: layout = `parseLayout(win.layout) ?? single:tty`, degraded tile-by-tile at render (never rewritten); every verb is a `setWindowOptions(server, id, {"@rk_win_layout": …})` POST through the seam color/marker/note already use; the code root is `win.codeRoot || derived gitRoot` with seed/follow writes to `@rk_win_code_root`. Two things stay per-viewer by explicit spec decision — **divider ratios** (already local) and **zoom / the mobile single-tile choice** (a new `rk-layout-zoom:{server}:{@N}` key) — because they are viewport-dependent reading postures, not tab state. The `?layout=`/`?view=`/`?panel=` params and the localStorage keys get exactly one release of one-shot translation into tmux, then die (Change 5 removes the translation).

## What Changes

### 1. `lib/surface-layout.ts` — pure layer loses the ladder, gains `effectiveLayout` + zoom storage

**Delete** (with their unit tests in `surface-layout.test.ts` — the `hintLayout`, `translateLegacyParams`, `resolveLayout`, `storage keys + read/write` (layout half only), `seedLayoutFromLegacy` describe blocks):

- `hintLayout(win)` (`:250`) — the R5 default-view hint; `single:web` is now an explicit `@rk_win_layout` value written by the backend/migration.
- `resolveLayout(searchLayout, stored, win)` (`:286`) — the L2 ladder.
- `layoutStorageKey` / `readStoredLayout` / `writeStoredLayout` (`:308-347`) — the `rk-layout:*` localStorage store.
- `seedLayoutFromLegacy` (`:354`) — the localStorage→localStorage legacy seed.

**Keep unchanged**: `parseLayout`, `serializeLayout`, `degradeLayout`, `availableTiles`, `SURFACE_RAIL_HIDDEN`, all verbs (`promote`, `swapWithNext`, `closeSurface`, `addSurface`, `cycleShape`, `setShape`, `shapesForArity`), the ratios block (`ratiosStorageKey`/`readStoredRatios`/`writeStoredRatios`, `:377-426`), the `SHAPE_*`/`SURFACE_*` tables.

**Add**:

```ts
/** The shared layout the tab renders: `@rk_win_layout` parsed, else `single:tty`,
 *  then degraded tile-by-tile against `availableTiles(win)`. The option itself is
 *  never rewritten by degradation (spec: invalid values degrade, never error —
 *  the author sees their mistake with `show-options`). A fully-invalid or
 *  fully-unavailable value renders `single:tty`. */
export function effectiveLayout(win: ViewWindow | null | undefined): Layout {
  const parsed = parseLayout(win?.layout);
  const degraded = parsed ? degradeLayout(parsed, win) : null;
  return degraded ?? { shape: "single", order: ["tty"] };
}
```

`ViewWindow` (`lib/window-view.ts:34`) gains `layout?: string; webTabs?: string[]; webActive?: number; codeRoot?: string;` and **loses** `rkType`/`rkUrl`. `types.ts` `WindowInfo` (`:153-154`) likewise: drop `rkType`/`rkUrl`, add the four new fields with doc comments matching the backend struct comments.

`translateLegacyParams(view, panel)` **stays** as the pure param→layout-string mapper (it is still needed by the one-shot arm) but its doc comment changes from "permanent shim" to "one-release translation, removed in Change 5".

**Per-viewer zoom key** (spec § Layout in tmux — decided 2026-08-28):

```ts
export function zoomStorageKey(server: string, windowId: string): string {
  return `rk-layout-zoom:${server}:${windowId}`;
}
/** The zoomed surface KIND, or undefined. try/catch-noop like ratios. */
export function readStoredZoom(server: string, windowId: string): SurfaceKind | undefined;
/** `null` clears the key. */
export function writeStoredZoom(server: string, windowId: string, kind: SurfaceKind | null): void;
```

The value is a surface **kind** (not a slot index): it is shared by the desktop zoom verb and the mobile single-tile switch, both of which are kind-addressed, and the spec phrases the rule as "cleared when the zoomed *surface* leaves the layout". Desktop zoom resolves kind → the first slot of that kind in the effective layout. `<!-- assumed: zoom key stores a surface kind, not a slot index — unifies desktop zoom and mobile switch; duplicate-tty independence (hand-written layouts only) is not preserved across reload -->`

### 2. One-shot legacy translation at route entry (client-side migration, spec § Migration)

A single effect in `app.tsx` (replacing the `seedLayoutFromLegacy` effect at `:809-811` and the URL-mirror effect at `:858-873`), running once per `(server, windowParam)` arrival **after** the window record has resolved (`effectiveWindow !== null` — the same gate the current mirror uses so the pre-snapshot frame never acts):

1. Compute `carried = search.layout ?? translateLegacyParams(search.view, search.panel)` and `stored = localStorage["rk-layout:{server}:{@N}"]` (read directly — the storage helpers are deleted; a tiny local `readLegacyLayoutKey` is fine, or reuse `readStoredView`/`readStoredPanel` from `window-view.ts`/`right-panel.ts` which stay for this one consumer).
2. **If `win.layout` is empty** and `parseLayout(carried ?? stored ?? translateLegacyParams(storedView, storedPanel))` succeeds: `setWindowOptions(server, id, {"@rk_win_layout": serialized})` — exactly once. Precedence: URL params > `rk-layout:` key > legacy view/panel keys. Last browser to arrive wins on a never-visited tab (accepted by spec).
3. **If `win.layout` is set**: write nothing — the shared layout wins over any carried param.
4. **Both arms**: if the URL carried any of `?layout|?view|?panel`, `navigate({ replace: true, search: {} })` to the bare route; delete the four matching keys `rk-layout:{s}:{@N}`, `runkit-window-view:{s}:{@N}`, `runkit-window-panel:{s}:{@N}`, `runkit-code-folder:{s}:{@N}` (matching keys only, never a prefix sweep — other tabs' keys migrate on their own arrival).
5. **Code-folder arm (same effect or a sibling)**: if `win.codeRoot` is empty and `runkit-code-folder:{s}:{@N}` holds a non-empty path, `setWindowOptions({"@rk_win_code_root": folder})` once; delete the key either way.

`lib/router-url.ts`: `TerminalSearch` keeps `view`/`panel`/`layout` as *accepted inbound* params for this release (they must still parse to be translated); the module comment is rewritten to say the params are translation-only inbound and never written. Nothing in the frontend writes `?layout=` anymore — the `navigate(..., search: { layout })` calls at `app.tsx:866-872` and `:899-904` are deleted; history entries are bare routes.

### 3. `app.tsx` — layout state is derived, every verb is an option write

- `const layout = useMemo(() => effectiveLayout(effectiveWindow), [effectiveWindow])` replaces the `searchLayout`/`storedLayout`/`resolveLayout` block (`:728-734`). No `useState` copy of the layout.
- **`applyLayout(next)`** (`:876-908`) becomes: `setWindowOptions(server, windowParam, {"@rk_win_layout": serializeLayout(next)})`, with **optimistic render** until the option tick confirms — the existing color-swatch pattern (`dialogs-and-state.md` § Optimistic UI & Mutation Feedback / § Zustand Window Store: the store applies the new value immediately and the next SSE `sessions` event reconciles; on POST failure the store reverts and the mutation-feedback toast fires). Concretely: the Zustand window store gains an optimistic `layout` override for the window keyed `${server}:${windowId}`, cleared when an SSE payload arrives whose `layout` equals the pending value or when the POST rejects. The verb callers are unchanged: `promote`/`swapWithNext`/`closeSurface`/`addSurface`/`cycleShape`/`setShape` via tile verbs (`:4517-4521`), `togglePanel` (rail toggles, `:922-934`), `switchView` (`:913`, the `View:`/`Tile:` palette rows), the ▦ layout chip.
- **Delete** the present auto-expand block (`:742-807`: `autoExpandRef`, `autoExpandKeyRef`, `autoWebOpen`, the observation effect, `renderLayout = withAutoWeb(...)`) and the `foldLayoutMutation` call inside `applyLayout`. `renderLayout` → `layout` everywhere (`SurfaceLayout` `layout=` prop `:4478`, `togglePanel`, `mobileActiveTile`, `toggleZen`, palette deps at `:3354`). **Delete `lib/present-auto-expand.ts` + `present-auto-expand.test.ts`.** The layout write *is* the expand — an agent that wants the web tile visible writes `@rk_win_layout` (Change 4 ships `rk present --show`; until then `tmux set-option -w @rk_win_layout` is the mechanism).
- **Delete** the URL-mirror effect (`:858-873`) and the `seedLayoutFromLegacy` effect (`:809-811`) — replaced by § 2's one-shot effect.
- **Ungated window-switch classification** (`:2095-2135`): `ungatedIds` = windows whose `effectiveLayout(fw.window).order[0] !== "tty"` — reads the payload directly; the localStorage/`translateLegacyParams`/`readLatchedCodeFolder` reads go away. `withLatchedCodeFolder` is no longer needed for the classifier because `codeRoot` rides the payload (see § 5).
- **Zoom**: `SurfaceLayout`'s internal `zoomedIndex` state (`surface-layout.tsx:800`) is initialized from `readStoredZoom(server, windowId)` (kind → first matching slot) and every zoom flip writes `writeStoredZoom` (kind of the zoomed slot, or `null` on unzoom). The existing "clear when the layout can no longer host the zoomed slot" effect (`:798-806`) also clears the key when the zoomed kind leaves `layout.order`. Zen mode's zoom (`toggleZen`, `resolveZenToggle`) rides the same seam unchanged — it drives `layoutZoomToggleRef` and therefore persists like a manual zoom (accepted: zen is a viewer posture).
- **Mobile switch-to-tile** (`:995-1020`): `mobileSlotA` state is replaced by the stored zoom kind — `mobileActiveTile = storedZoom ∈ layout.order ? storedZoom : layout.order[0]`. Switching to an **already-open** surface writes only the zoom key (never `@rk_win_layout` — a phone reading `web` leaves the desktop viewer's arrangement alone). Switching to an **available-but-not-open** surface goes through the shared growth mutation `addSurface(layout, kind)` → `applyLayout` (the spec's "adding a surface that is not in the layout goes through the shared `--add` mutation like everywhere else") AND writes the zoom key to that kind so the phone shows it; when `addSurface` returns `null` (arity 3 without the kind) the switch is a no-op and the button renders disabled. This replaces today's `switchView(single:<kind>)` collapse for the not-open case. `<!-- assumed: not-open mobile switch grows the shared layout via addSurface rather than collapsing to single:<kind> — the spec names the --add mutation explicitly; the collapse would rewrite every desktop viewer's arrangement from a phone -->`
- The mobile reset-on-window-switch effect (`useEffect(() => setMobileSlotA(null), [server, windowParam])`) is deleted — the zoom key is per-window already.
- **Code-folder latch wiring** (`:670-700`): `latchEpoch`/`latchedCodeFolder`/`latchCodeFolder`/`withLatchedCodeFolder` are replaced per § 5.

### 4. `lib/window-view.ts` + web content selector

- `ViewWindow` drops `rkType`/`rkUrl`, adds `layout`/`webTabs`/`webActive`/`codeRoot`.
- `hasWebUrl(win)` → `(win?.webTabs?.length ?? 0) > 0` (the content selector for onboarding-vs-iframe and the web toggle's corner dot — unchanged semantics, new source). Add `activeWebUrl(win): string` = `webTabs[(webActive || 1) - 1] ?? ""` — the URL the single web tile renders this release (Change 3 adds the strip; until then the active tab is the only tab shown).
- **Delete `defaultView`** (`:127-141`, the R5 hint walk — its only consumer was `hintLayout`) and its test cases. `HINT_ORDER` stays as the capability ordering for `availableViews`. `windowViewStorageKey`/`readStoredView` stay only as inputs to the one-shot translation (comment: removed in Change 5); same for `panelStorageKey`/`readStoredPanel` in `lib/right-panel.ts`.
- `components/iframe-window.tsx`: the `rkUrl` prop is fed `activeWebUrl(win)` by `surface-layout.tsx` (`:508` and the tile renderer); the address-bar submit (`:643-659`, `updateWindowUrl`) writes `{"@rk_win_web_<n>": url} (n = webActive, or 1 when the family is empty)` via `setWindowOptions` instead of `@rk_win_url` — the same value the compat shim would have produced, without relying on the shim (Change 3 later routes the strip's `+` through `POST …/web`). `web-zoom.ts`'s `webZoomKeyFor(rkUrl)` is unchanged (it takes a URL string).
- `api/client.ts` `createWindow(server, session, name?, cwd?, rkType?, rkUrl?)` → `createWindow(server, session, name?, cwd?, webUrl?)`: when `webUrl` is given the body sends `{ rkType: "iframe", rkUrl: webUrl }` (the backend keeps those body names this release — Change 1 R10). The sidebar "Open in window" caller passes the URL only. `updateWindowUrl` is either deleted (callers moved to `setWindowOptions`) or re-pointed as above — one seam, not two.
- **Backend**: delete `deriveWebCompat` (`internal/sessions/sessions.go:563-570`, call at `:725`), the `RkUrl`/`RkType` fields on `tmux.Window` (`tmux.go` ~`:757-760`) and their unit test; grep `rkUrl|rkType|RkUrl|RkType` across `app/backend` — the ONLY survivors are the `POST /api/sessions/{session}/windows` body field names (Change 1 R10, kept this release) and the `legacy*` consts/dual-read fields (Change 5). The write shim `translateLegacyOptionKeys` and the `@rk_win_url`/`@rk_win_lens` dual-read stay untouched.

### 5. Code root — `lib/code-folder-latch.ts` becomes pure, writes go to `@rk_win_code_root`

- **Delete** `codeFolderStorageKey`/`readLatchedCodeFolder`/`writeLatchedCodeFolder` (and their tests). The module keeps the pure seed/follow decision and exports:

```ts
/** The folder the code surface opens: the shared `@rk_win_code_root` when set,
 *  else the live derivation (the seed source). Empty when neither exists. */
export function codeRootFor(win: ViewWindow | null | undefined): string {
  return win?.codeRoot || win?.gitRoot || "";
}
/** Seed rule (unchanged): write once, the first time the code tile renders for a
 *  tab whose codeRoot is empty, from the derived gitRoot; empty derivation seeds
 *  nothing. Returns the folder to write or null. */
export function codeRootSeed(win, layout: Layout): string | null;
```

- `app.tsx`: `effectiveWindow` no longer needs `withLatchedCodeFolder` — the code lens availability (`hasCode`) should treat a non-empty `codeRoot` as available exactly as a latched folder did (a window whose active pane left the repo keeps offering `code`): `hasCode(win) = (win.codeRoot || win.gitRoot).length > 0`. The seed effect (`:820-830`) becomes: `if (layout.order.includes("code") && !win.codeRoot && win.gitRoot) setWindowOptions({"@rk_win_code_root": win.gitRoot})`. The follow write (`onCodeFolderNavigated`, `surface-layout.tsx:198/1255` from `CodeSurface`'s load-event seam) → `setWindowOptions({"@rk_win_code_root": folder})`. `CodeSurface` receives `codeRootFor(effectiveWindow)` as its folder.
- The **seed must not double-fire**: while the seed POST is in flight the SSE payload still shows `codeRoot: ""`; guard with a per-window in-flight ref (or the optimistic override from § 3) so a second render does not POST again. Same guard for the one-shot layout translation.
- One-shot migration of `runkit-code-folder:*` is in § 2 step 5.

### 6. `components/surface-layout.tsx`

- Presentational contract unchanged: `layout` arrives as a prop (now the derived effective layout); verbs call back into `app.tsx`'s `applyLayout`. Changes: zoom init/persist per § 3; `mobileActiveSlot` computed from the zoom kind; `IframeWindow` fed `activeWebUrl(win)`; `CodeSurface` fed `codeRootFor(win)`; the web tile-header display (`:508`) uses `activeWebUrl`. No `present-auto-expand` hook.
- `lib/focus-memory.ts` keys are **unchanged** (viewer posture, spec § What Stays).

### 7. Tests

**Unit (`vitest`, colocated)**:
- `surface-layout.test.ts`: drop the ladder/storage/seed/hint blocks; add `effectiveLayout` (unset → `single:tty`; valid → as written; partially unavailable → degraded in place; fully invalid → `single:tty`; malformed string → `single:tty`), `read/writeStoredZoom` round-trip + clear + garbage rejection, and the one-shot translation arms as a pure decision helper (URL params win over stored key; stored key wins over legacy view/panel; set `win.layout` → no write; keys deleted in both arms) with `setWindowOptions` mocked.
- `window-view.test.ts`: `hasWebUrl` over `webTabs`; `activeWebUrl` (empty family → `""`, `webActive` 0/out-of-range → slot 1); `defaultView` cases removed; `hasCode` with `codeRoot` but empty `gitRoot`.
- `code-folder-latch.test.ts`: `codeRootFor` precedence, `codeRootSeed` (seeds only when code tile open AND codeRoot empty AND gitRoot non-empty).
- Delete `present-auto-expand.test.ts`.
- Backend: remove the `deriveWebCompat` test; `go test ./...` green.

**e2e (Playwright, `just test-e2e`)** — every touched spec re-pointed so assertions read tmux, not localStorage/URL:
- `surface-layout.spec.ts`, `right-panel.spec.ts`, `mobile-layout.spec.ts`, `surface-focus-chords.spec.ts`, `code-folder-latch.spec.ts`: after a verb, assert `tmux -L $TMUX_SERVER show-option -wv -t <id> @rk_win_layout` equals the expected string (a small `windowOption(id, key)` helper in `_tmux.ts` via `execFileSync` argument arrays — no shell); reload-persistence tests reload the bare route and assert the tile set (persistence now comes from tmux); the `expectLayoutParam` helpers and every `?layout=` URL assertion are deleted; `?layout=`/`?view=`/`?panel=` deep-link tests become "translation writes the option once and the URL is replaced with the bare route" (one test each for the carried-param arm and the `win.layout`-set-drops-params arm). Window setup stamps `@rk_win_web_1` (+ `@rk_win_web_active 1`) instead of `@rk_win_url`; code-folder tests assert `@rk_win_code_root` after the seed and after the follow write.
- **New tests**: (a) two browser contexts on one window — context A clicks the web-tile toggle, context B (already mounted, no interaction) shows the web tile within the option tick; (b) zoom in context A does not zoom context B; (c) a `tmux set-option -w @rk_win_layout split-h:tty,web` issued while a viewer is mounted repaints the web tile (this is the rewritten `present-auto-expand.spec.ts`, now "present grows the shared layout" — Change 4 re-points it to `rk present`).
- Every Playwright `test()` carries the constitution's **Proves:/Steps:** JSDoc; there are no `.spec.md` companions.
- **Baseline discipline** (plan § Sequencing): before touching them, run `surface-layout`, `right-panel`, `mobile-layout`, `surface-focus-chords`, `code-folder-latch`, `present-auto-expand`, `web-view-lens` on a clean `origin/main` worktree; `web-view-lens.spec.ts` has known pre-existing local failures (memory: `:194/:412/:444/:521` as of 2026-08-29 — pass in CI). Run the seven together again before ship; a pane worker's "green" claim is scoped to what it ran.

### 8. Docs — in-place amendments land with this change (replace the banners)

- `docs/specs/window-views.md`: **R2** rewritten — "Choice is shared tab state in `@rk_win_layout`; a viewer's zoom/single-tile choice is the only per-viewer part (`rk-layout-zoom:*`)"; **R5 deleted** (the default-view hint is subsumed by an explicit `single:web` layout — renumber nothing, leave a one-line tombstone "R5 retired by ui-state.md"); **R7** rewritten — content address (`@rk_win_web_<n>`) AND lens choice (`@rk_win_layout`) are both substrate state now; only zoom/ratios/focus are local. Remove the top banner.
- `docs/specs/surface-layout.md`: § State (L1–L4) replaced by a pointer to `ui-state.md` § Layout in tmux plus a short paragraph: ratios (`rk-layout-ratios:*`) and zoom (`rk-layout-zoom:*`) are per-viewer; the L3 present carve-out is gone; history entries are bare routes. Remove the top banner. The § Mobile "Switch-to-tile" row updated to the zoom-key + `--add` semantics.
- `docs/specs/right-panel.md`: **P1** rewritten — panel/tile choice is shared tab state via `@rk_win_layout`; panel width stays per-viewer. The § Surface Registry `code` row's "LATCHED" sentence points at `@rk_win_code_root`. Remove the top banner.
- `docs/specs/ui-state.md`: status line → `[current]` for §§ Layout in tmux and Code Surface + Code Bridge (Web Tabs strip and `rk tab` remain planned).
- Memory hydration (the hydrate stage, not hand-edited here) covers the files in § Affected Memory.

### Explicit non-goals (Changes 3–5)

- No web tab strip, no `webTabTitle`, no detected-port chip, no `POST …/web` calls from the UI (Change 3). The single web tile renders `activeWebUrl` only.
- No `rk tab` verbs, no `rk present` re-pointing, no `rk code exec --tab` (Change 4).
- No removal of `translateLegacyOptionKeys`, the `@rk_win_url`/`@rk_win_lens` dual-read fields, the n-less `/present/{windowId}/*` route, the migration rows, or the client-side one-shot translation (Change 5). The ONLY backend deletion in this change is the derived `rkUrl`/`rkType` read shim, which Change 1 explicitly assigned to Change 2.
- Ratios stay in localStorage (spec OQ1 deferred). Navigation/follow-mode untouched.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) § Window Views (`?layout=` + translation shim, `app.tsx` integration), § Surface Layout (`app.tsx` integration — ladder/mirroring/write discipline → option-driven derive + optimistic POST), § Present auto-expand (removed → "the layout write is the expand"), § Code Surface → "The code folder is a per-window latch" (→ `@rk_win_code_root` seed/follow), § Mobile slot-A / switch group (zoom key semantics), § Tile renderer (zoom persistence), e2e sections re-pointed to tmux assertions, Design Decisions for zoom-as-kind and mobile `--add`.
- `run-kit/ui/routes-and-shell`: (modify) § URL Structure — the terminal route carries no `?layout=`/`?view=`/`?panel=`; inbound params are translation-only for one release; history entries are bare routes.
- `run-kit/tmux-sessions`: (modify) § Server-Scoped User Options registry rows — `@rk_win_layout` writers gain "frontend verbs via `POST /options`", `@rk_win_code_root` writers gain "frontend seed (first code render) + follow (code-server navigation)", `@rk_win_web_<n>` writers gain "web tile address bar (active slot)"; § Deprecation Ledger — the derived `rkUrl`/`rkType` JSON fields are deleted (this change), the rest of the retired-web-name compat surface remains for Change 5.
- `run-kit/api-and-sockets`: (modify) Window JSON shape — `rkUrl`/`rkType` removed from SSE/`/ws/state`/`/api/sessions` payloads; `layout`/`webTabs`/`webActive`/`codeRoot` are the frontend's inputs.
- `run-kit/ui/dialogs-and-state`: (modify) § Zustand Window Store / § Optimistic UI — the layout (and code-root) optimistic override + SSE reconcile rule.

## Impact

**Frontend (`app/frontend/src`)** — the bulk of the change:
- `lib/surface-layout.ts` (−~130 lines: ladder/storage/seed/hint; +~40: `effectiveLayout`, zoom storage), `lib/surface-layout.test.ts`
- `lib/window-view.ts` (`ViewWindow`, `hasWebUrl`, `activeWebUrl`, `defaultView` deleted), `lib/window-view.test.ts`
- `lib/code-folder-latch.ts` (storage deleted; `codeRootFor`/`codeRootSeed`), `lib/code-folder-latch.test.ts`
- `lib/present-auto-expand.ts` + `.test.ts` **deleted**
- `lib/router-url.ts` (comment + inbound-only posture), `lib/right-panel.ts` (comment)
- `app.tsx` (~250 lines of ladder/mirror/seed/auto-expand/latch machinery replaced by ~80 of derive + one-shot + optimistic write; ungated classifier simplified; mobile arm)
- `components/surface-layout.tsx` (zoom persistence, mobile slot from zoom kind, `activeWebUrl`/`codeRootFor` feeds), `components/iframe-window.tsx` (address-bar write target), `api/client.ts` (`createWindow` arm, `updateWindowUrl`), `types.ts`, the Zustand window store (optimistic layout/codeRoot override), the sidebar "Open in window" caller
- e2e: `surface-layout`, `right-panel`, `mobile-layout`, `surface-focus-chords`, `code-folder-latch`, `present-auto-expand` (rewritten), `_tmux.ts` helper; `web-view-lens` run as a regression gate

**Backend (`app/backend`)** — small, deletion-only: `internal/sessions/sessions.go` `deriveWebCompat` + call; `internal/tmux/tmux.go` `RkUrl`/`RkType` fields; the derivation unit test.

**Docs**: `docs/specs/window-views.md`, `surface-layout.md`, `right-panel.md`, `ui-state.md` (in-place amendments, banners removed).

**Behavior changes users will notice**: layouts and code folders are shared across every viewer of a tab and survive reload/snapshot-restore; the URL never shows `?layout=`; old `?layout=`/`?view=`/`?panel=` links still open the right arrangement once (then the URL is cleaned); zoom persists per browser across reloads (new); switching to a not-open surface on mobile grows the shared layout instead of collapsing it.

**Risk**: `app.tsx` (4824 lines) and `surface-layout.tsx` (1844 lines) are the two largest files in the app; five e2e specs plus the rewritten sixth are touched. Mitigations: baseline on clean main first, run the seven specs together before ship, keep the pure-helper + colocated-test contract so `app.tsx` changes are thin wiring.

**Constitution check**: II (state derived from tmux; zoom/ratios in localStorage are viewer preferences per IV's layering; cold start equivalent), IV (no new routes; `?layout=` removed from the surface), V (palette `Tile:`/`View:` rows remain the mechanism; buttons mirror), IX (all writes are `POST /options`), Test Intent Comments (every touched `test()` gets Proves/Steps).

## Open Questions

- None blocking. Rows 8–9 (zoom key stores a kind; mobile not-open switch grows via `addSurface`) follow the spec's explicit wording; `/fab-clarify` can revisit them if today's mobile collapse behavior is preferred.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly plan § Change 2; Changes 3–5 excluded, including the web strip, `rk tab`, and removal of the write shim / dual-read / n-less present route | User's instruction verbatim; plan sequencing table | S:95 R:90 A:95 D:95 |
| 2 | Certain | Build on Change 1 as merged (`8e4c3310`): read `layout`/`webTabs`/`webActive`/`codeRoot` from the payload; write through `POST /api/windows/{id}/options` | Verified in `tmux.go`, `windows.go`, `sessions.go` at origin/main | S:90 R:90 A:95 D:95 |
| 3 | Certain | Delete the backend derived `rkUrl`/`rkType` read shim (`deriveWebCompat`) in this change; keep `translateLegacyOptionKeys` and the dual-read fields for Change 5 | Change 1's own `// compat:` marker assigns the read shim to Change 2 and the write shim to Change 5; the frontend is its only consumer | S:75 R:85 A:85 D:80 |
| 4 | Certain | Change type `refactor` (explicit `fab status set-change-type`) | Plan § Sequencing assigns "2 `refactor`"; the keyword inferrer would default to `feat` | S:90 R:95 A:95 D:90 |
| 5 | Confident | Address-bar submit writes `@rk_win_web_<n>` (n = `webActive`, or 1 when the family is empty) directly rather than `@rk_win_url` through the write shim | Same resulting tmux state; matches Change 3's stated address-bar rule; removes our own dependency on the shim | S:65 R:90 A:80 D:75 |
| 6 | Certain | One-shot translation precedence: URL params > `rk-layout:` key > legacy view/panel keys; writes only when `win.layout` is empty; both arms drop params and delete the four matching keys; code-folder latch migrates alongside | Spec § Migration + plan Change 2 wording; last-browser-wins accepted by spec | S:80 R:85 A:85 D:80 |
| 7 | Confident | Optimistic render via the Zustand window store's existing optimistic-action pattern (color swatch); reconcile on the SSE tick, revert on POST failure | Plan names "the existing color-swatch pattern"; `dialogs-and-state.md` § Optimistic UI documents it | S:70 R:85 A:80 D:80 |
| 8 | Confident | `rk-layout-zoom:{server}:{@N}` stores a surface **kind**; desktop zoom resolves kind → first slot; duplicate-tty zoom independence is not persisted | Unifies desktop zoom and the kind-addressed mobile switch; spec says "zoomed surface leaves the layout"; duplicate tty tiles arise only from hand-written layouts | S:55 R:85 A:70 D:55 |
| 9 | Confident | Mobile switch to a **not-open** surface grows the shared layout via `addSurface` + sets the zoom key; `null` growth (arity 3) is a disabled no-op. Already-open surfaces write the zoom key only | Spec § Layout in tmux names the `--add` mutation explicitly; today's `single:<kind>` collapse would rewrite every desktop viewer's arrangement from a phone | S:60 R:80 A:70 D:55 |
| 10 | Certain | `hasCode` treats a non-empty `codeRoot` as availability (stable capability after the pane leaves the repo), replacing `withLatchedCodeFolder` | Preserves the latch's documented purpose (right-panel.md § Surface Registry `code` row) with the shared option as the source | S:75 R:85 A:85 D:85 |
| 11 | Certain | Desktop zoom persists per browser across reloads (new behavior) and zen-initiated zoom rides the same key | Spec puts zoom in localStorage "beside ratios"; ratios already persist | S:70 R:90 A:80 D:75 |
| 12 | Certain | `translateLegacyParams`, `readStoredView`/`readStoredPanel`, and `TerminalSearch`'s `view`/`panel`/`layout` fields stay as inbound-only inputs to the one-shot arm, commented for Change 5 removal | Plan Change 5 lists the translation as the thing it deletes | S:85 R:95 A:90 D:90 |
| 13 | Certain | `present-auto-expand.spec.ts` is rewritten to assert an option-driven repaint using `tmux set-option -w @rk_win_layout` (the `_tmux.ts` pattern); Change 4 re-points it to `rk present` | Plan Change 2 § Tests states this verbatim | S:90 R:95 A:95 D:95 |
| 14 | Certain | Baseline the seven e2e specs on clean `origin/main` before editing; run them together before ship; `web-view-lens` failures at the memory-recorded lines are pre-existing | Plan § Sequencing + memory `web-view-lens-e2e-preexisting-failures` | S:90 R:95 A:95 D:95 |
| 15 | Certain | `createWindow` client signature becomes `(server, session, name?, cwd?, webUrl?)` and still sends `{rkType:"iframe", rkUrl}` in the body | Plan Change 1: "client.ts createWindow signature loses the rkType arm in Change 2"; Change 1 R10 keeps the body names this release | S:70 R:90 A:85 D:80 |
| 16 | Certain | Spec amendments (window-views R2/R7 rewritten, R5 deleted; surface-layout § State → pointer + ratios/zoom paragraph; right-panel P1 rewritten; ui-state §§ Layout/Code → `[current]`) land in this change and replace the banners | Plan Change 2 § Docs verbatim | S:90 R:90 A:90 D:95 |

16 assumptions (12 certain, 4 confident, 0 tentative, 0 unresolved).
