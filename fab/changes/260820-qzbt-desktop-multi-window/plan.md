# Plan: Desktop-Shell Multi-Window

**Change**: 260820-qzbt-desktop-multi-window
**Intake**: `intake.md`

## Requirements

Derived from the intake's 8-point FINAL user-decided contract (one Electron process, many `BrowserWindow`s; `app/desktop` only — zero SPA/renderer/backend changes; the `shell:new-window` channel is exposed but unconsumed).

### Process: Single Instance & Window Set

#### R1: One process, many windows (single-instance lock)
The app MUST call `app.requestSingleInstanceLock()` before any window is created; a launch that does not obtain the lock MUST quit immediately. The surviving process MUST handle `second-instance` by opening a NEW window in itself (same duplicate-of-current-window semantics as the New Window menu item — focused window as source, restore/welcome when no window is open). No two OS instances may ever share `userData`.

- **GIVEN** the app is already running with the single-instance lock held
- **WHEN** a second OS launch occurs (e.g. `open -n`, re-running the binary)
- **THEN** the second launch quits without creating a window
- **AND** the surviving process receives `second-instance` and opens a new window duplicating the current one

#### R2: New Window duplicates the current window
A `New Window` menu item — `Window → New Window` on macOS, `File → New Window` on win/linux, **accelerator-less** (⌘N is a separate follow-up change's claim) — MUST open a duplicate of the CURRENT (focused) window: same host, same current route, but a FRESH INDEPENDENT `WebContentsView` (never a shared or moved view). With no hosts registered it MUST open the welcome page. The shell MUST also expose a `shell:new-window` bridge channel (preload invoker + main-side handler gated like `servers:*`) routing to the SAME new-window function the menu item calls; the SPA does not consume it in this change. Under the `RK_DESKTOP_URL` dev sentinel, New Window duplicates the sentinel view as an independent sentinel-scoped view in the new window (see Design Decisions).

- **GIVEN** a window showing host `studio-mac` at route `/utils2/rk-dev`
- **WHEN** the user clicks `Window → New Window` (or a future SPA invokes `shell:new-window`)
- **THEN** a second window opens on `studio-mac` at `/utils2/rk-dev` in its own new `WebContentsView`, and the first window's view is untouched
- **AND** with zero hosts registered, the new window shows the welcome page

#### R3: Cold-start restores the window set (`windows.json`)
Each open window's `{active host id, current route, bounds}` MUST persist in a NEW `<userData>/windows.json` beside `hosts.json` (hosts.json's shape and additive-field discipline are untouched). The store MUST be electron-free and directory-parameterized (the `hosts.ts` pattern), MUST write atomically (tmp-then-rename), and MUST tolerate a missing/corrupt/wrong-shape file by loading as an empty set. Relaunch MUST restore every recorded window; a macOS dock-reopen after all windows closed MUST likewise restore the recorded set. Per-host `lastPath` in hosts.json REMAINS the fallback for windows restored with an empty recorded route. A record whose host no longer exists MUST degrade that window to the first-host/welcome fallback rather than failing. Windows showing the `RK_DESKTOP_URL` dev sentinel MUST NOT be persisted.

- **GIVEN** two windows open — one on host A at `/s1/w1`, one on host B at `/s2` — when the app quits
- **WHEN** the app is relaunched
- **THEN** both windows reappear with their own host, route, and bounds
- **AND** if `windows.json` is corrupt, the app opens a single fallback window (active host or welcome) with no error

#### R4: Window switching surfaces stay OS-native
The shell MUST NOT bind any new window-switching accelerators (macOS ⌘\`/⇧⌘\`, App Exposé, Dock window list, win/linux Alt+Tab are OS-native). To keep those surfaces distinguishable, every window's title MUST be `{host name} — {route leaf}` (route leaf = last non-empty path segment; bare origin → host name alone), and a welcome window's title MUST be the plain product name. The macOS Window menu (custom template — deliberately NOT `role: 'windowMenu'`) MUST gain a manual per-window list section rebuilt on window open/close/focus/title changes, whose items focus their window on click.

- **GIVEN** windows on `studio-mac — rk-dev` and `buildbox — utils2`
- **WHEN** the user opens the macOS Window menu (or reads the Dock window list / App Exposé)
- **THEN** both entries are distinguishable by their `{host} — {leaf}` titles, and clicking the menu entry focuses that window

### Views: Registry & Host Switching

#### R5: Views key on (windowId, hostId)
The view registry (`src/views.ts`) MUST re-key every entry on `(windowId, hostId)`: the same host MAY be shown in N windows uncapped, each with its own independent view; views MUST never migrate between windows. `webContentsId` sender resolution MUST stay id-based; per-view badge/theme caches MUST stay unchanged in shape. The registry MUST remain electron-free with `node --test` coverage (existing suite extends, never forks).

- **GIVEN** two windows both switched to host `studio-mac`
- **WHEN** the registry is inspected
- **THEN** two distinct entries exist, keyed `(win1, studio-mac)` and `(win2, studio-mac)`, each with its own handle and caches
- **AND** closing one window destroys only that window's views

#### R6: Host switching is per-window, focus-routed
The ⌥⌘1–9 (mac) / Alt+1–9 (win/linux) accelerators and the Hosts menu radio callbacks MUST act on the FOCUSED window. The menu MUST rebuild on window-focus changes wherever its rendered state depends on the focused window's active host (the radio check marks, at minimum). The hosts.json `activeId` field MUST demote to a cosmetic "last focused window's host" — kept for back-compat and as the first-window fallback — written on window focus and on switches in the focused window, never as the source of per-window state.

- **GIVEN** window 1 on host A and window 2 focused on host B
- **WHEN** the user presses the accelerator for host C
- **THEN** window 2 switches to host C and window 1 stays on host A
- **AND** `activeId` in hosts.json records host C (the focused window's host)

#### R7: Host removal spans all windows
`Hosts → Remove` (and the `servers:remove*` IPC paths) MUST destroy the removed host's views across ALL windows. Each window left showing the removed host MUST fall back to the first remaining host, or to the welcome page when none remain.

- **GIVEN** windows 1 and 2 both showing host A, window 3 on host B
- **WHEN** host A is removed (and confirmed)
- **THEN** A's views in windows 1 and 2 are destroyed, windows 1 and 2 attach host B (or welcome if no hosts remain), and window 3 is unaffected

### Chrome: Badge, Titles, Per-Window Wiring

#### R8: Badge aggregates across distinct displayed hosts
The painted OS badge MUST equal the sum of waiting counts over the DISTINCT hosts that are the active host of any open window — a host displayed by two windows counts ONCE. The aggregate MUST recompute on any per-view cached-count change, on window open/close, and on host switches. On win32 the overlay icon is per-window (`win.setOverlayIcon`) and MUST paint the aggregate on EVERY open window (see Design Decisions). `src/badge.ts` itself stays unchanged in shape (aggregation is a caller-side sum over the view registry).

- **GIVEN** window 1 shows host A (3 waiting) and window 2 shows host B (2 waiting)
- **WHEN** either count's report lands
- **THEN** the OS badge reads 5
- **AND** with two windows both on host A (3 waiting), the badge reads 3, not 6

#### R9: Chrome wiring is per-window; app-level policy wiring is untouched
Overlay painting, the welcome underlay blanking, attached-view bounds sync, welcome rendering, and last-path capture MUST all operate per window (`applyOverlayColor` takes the window; `isWelcomeSender` covers any window's own webContents). The window-open deny policy, navigation guard, permission handler, and IPC sender gating MUST remain app-level and shape-agnostic — unchanged by this change.

- **GIVEN** two windows with different attached views
- **WHEN** window 1 resizes and window 2's view reports a theme color
- **THEN** window 1's attached view re-syncs to window 1's bounds only, and only window 2's overlay repaints

### Non-Goals

- ⌘N / ⇧⌘T / ⇧⌘W keymap, "tab" copy, and the SPA-side ⌘\` system-claim row — a separate drafted follow-up change.
- ⌘-click "open host in new window" affordances in the SPA host-switcher — later phase.
- Cross-window view moving — views never migrate between windows.
- Any renderer/SPA/frontend/backend change — the `shell:new-window` channel is exposed but unconsumed.
- Packaging/build changes (electron-builder config, release CI) — untouched.
- A cap or eviction policy for same-host views — host lists are small; the posture extends to windows.

### Design Decisions

#### win32 overlay paints the aggregate on EVERY open window
**Decision**: On win32, every open window's taskbar button gets the aggregate overlay icon (`win.setOverlayIcon` per window); macOS/Linux keep the single app-level `app.setBadgeCount`. (Resolves intake Assumption #10.)
**Why**: `setOverlayIcon` is a per-window surface — painting only the focused window would leave other taskbar entries claiming "nothing waiting" while the app badge says otherwise; every entry signaling is the platform-correct reading of an app-scoped count. Painting all windows is also the cheaper invariant: one recompute paints every surface, with no focus-tracking special case.
**Rejected**: Focused-window-only overlay (a stale zero on unfocused windows contradicts the aggregate, and adds focus-tracking to the paint path for no user benefit).
*Introduced by*: 260820-qzbt-desktop-multi-window

#### `RK_DESKTOP_URL` sentinel: New Window duplicates it as an independent view
**Decision**: Under the dev sentinel, New Window opens a new window with its OWN sentinel-scoped view, keyed `(newWindowId, "__dev__")` — the (window, host) registry re-key makes this fall out naturally, so no simplification to "sentinel stays single-window" is taken. Sentinel windows are never persisted to `windows.json` and never write `activeId`/`lastPath` (the existing sentinel no-persist posture, extended). (Resolves intake Assumption #11.)
**Why**: With the registry keyed on (window, host), a second sentinel view costs nothing extra — it is the same code path as any duplicated window. Restricting New Window under the sentinel would be a special case whose only benefit is dev-cosmetic.
**Rejected**: Sentinel stays single-window (New Window a no-op under `RK_DESKTOP_URL`) — a branch that exists only to be explained, for a dev-only surface.
*Introduced by*: 260820-qzbt-desktop-multi-window

#### Window records restore focus by array order — focused window captured last
**Decision**: `windows.json` carries an ordered array (`version: 1`, records `{ hostId: string | null, route: string, bounds: { width, height, x?, y? } }`). At capture the records are ordered by window creation order with the LAST-FOCUSED window's record moved to the END; restore creates windows in array order, so the last-created window takes focus — no `focused` field in the schema.
**Why**: Order is the cheapest possible focus-restoration encoding (intake Assumption #13 leaves focus order plan-decided): Electron focuses each newly shown window, so array position does the work a boolean would.
**Rejected**: An explicit `focused: true` field (schema surface for information array order already carries); restore-all-then-focus-by-id (a second pass for what creation order gives free).
*Introduced by*: 260820-qzbt-desktop-multi-window

#### Quit vs. close-one-window is distinguished by a `before-quit` flag
**Decision**: Each window's `close` event captures its record (`{hostId, route, bounds}`) and its views' `lastPath` (webContents still readable during `close`). On QUIT (`before-quit`-set flag up) each closing window's record ACCUMULATES into a capture map and the set is re-saved — windows closed earlier in the same quit keep their records even though their registry entries are already gone, so the last quit-time write holds the whole set. A user closing one of N windows drops only that window's record: the set is rebuilt from the OTHER live windows (the closing one excluded up front — its views are torn down first, so capturing it would degrade to a spurious welcome record). The accumulation/drop/order logic is pure (`windowSetForSave`/`captureWindowRecord` in window-registry.ts).
**Why**: During quit every window closes one by one, each vanishing from the registry at its `closed` before the next window's `close` fires — rebuilding the set from live windows would shrink every save down to the last-closed window's record. The flag plus the accumulation map is the minimal state that separates "the app is going away" from "this surface is going away".
**Rejected**: Capturing only on `before-quit` (a macOS user closing all windows individually leaves stale records for surfaces that no longer exist); removing records on `closed` unconditionally (loses the whole set on every quit).
*Introduced by*: 260820-qzbt-desktop-multi-window

#### Duplicate-host badge dedupe takes the first window's cache
**Decision**: When two windows show the same host, the aggregate counts that host once, using the cached count of the active view in the FIRST window (creation order) displaying it.
**Why**: The contract fixes "counts once" but not which cache supplies the count; two views of one host are independent renderers that normally report the same SSE-driven number, so any deterministic pick is correct — first-in-creation-order is the simplest.
**Rejected**: Max/min across duplicates (implies a difference that does not exist in practice); summing then dividing (meaningless).
*Introduced by*: 260820-qzbt-desktop-multi-window

## Tasks

### Phase 1: Pure Modules (electron-free, node:test-covered)

- [x] T001 Create `app/desktop/src/windows.ts` — the `windows.json` store: `WindowBounds`/`WindowRecord`/`WindowSet` types (`version: 1`, ordered `windows` array, `{ hostId: string | null, route: string, bounds: { width, height, x?, y? } }`), `emptyWindowSet`, `loadWindows` (missing/corrupt/wrong-shape → empty; required-field violations reject the file; wrong-typed optional `bounds.x`/`bounds.y` drop the field, entry still loads), `saveWindows` (tmp-`<pid>`-then-rename, mkdir -p) — byte-for-byte the `hosts.ts` style. Plus `app/desktop/src/windows.test.ts` (tmp-dir suite on the `hosts.test.ts` pattern). <!-- R3 -->
- [x] T002 <!-- rework: align aggregateBadge dedupe order with the plan DD (creation order, first-window-wins) or amend the decision — review should-fix --> [P] Re-key `app/desktop/src/views.ts` on (windowId, hostId): `ViewEntry` gains `windowId`; `activeHostId: string | null` becomes per-window `active: { windowId: number; hostId: string }[]`; signatures gain the window dimension (`addView(state, windowId, hostId, …)`, `getView(state, windowId, hostId)`, `activeView(state, windowId)`, `activateView`/`deactivateViews(state, windowId, …)`, `removeView(state, windowId, hostId)`, `setViewBadge`/`setViewThemeColor`/`switchPaint` gain `windowId`); new `removeWindowViews(state, windowId)` and `removeHostViews(state, hostId)` returning removed entries; new `aggregateBadge(state)` (sum over distinct active hosts, first-window-wins dedupe). Extend `app/desktop/src/views.test.ts` to the new signatures plus same-host-in-two-windows, per-window active pointers, cross-window removal, and aggregate cases. <!-- R5, R8 -->
- [x] T003 [P] Create `app/desktop/src/window-registry.ts` — the window-registry pure decision module (distinct from the `windows.ts` store): `routeLeaf(route)`, `windowTitle(productName, hostName | null, route)`, `newWindowTarget(source)` (duplicate decision → `{ hostId, route } | { hostId: null }`), `orderRecordsForSave(records, focusedWindowId)` (focused last), `restoreTargets(set, list)` (per-record host resolution with first-host/welcome fallback), `hostRemovedFallback(remainingHosts)` (first-remaining-or-welcome), `windowListItems(windows)` (mac Window-menu list model: `{ windowId, label, focused }`). Plus `app/desktop/src/window-registry.test.ts`. <!-- R2, R3, R4, R7 -->

### Phase 2: Electron Surfaces (menu, preload)

- [x] T004 Reshape `app/desktop/src/menu.ts`: `buildMenu(hosts, focusedHostId, windows: WindowMenuEntry[], callbacks, daemon, update)` where `WindowMenuEntry = { windowId: number; title: string; focused: boolean }`; radio `checked` keys on the FOCUSED window's host (`focusedHostId`); `MenuCallbacks` gains `onNewWindow` and `onFocusWindow(windowId)`; accelerator-less `New Window` item in the mac Window menu and the win/linux File menu; mac Window menu gains a manual per-window list section (items check the focused window, click routes `onFocusWindow`). Header comment updated: New Window is accelerator-less by design (⌘N is the follow-up change's SPA-bridge claim). <!-- R2, R4, R6 -->
- [x] T005 [P] Add the `shell:new-window` invoker to `app/desktop/src/preload.ts`: a `windows: { newWindow() }` bridge group invoking `shell:new-window`; header comment documents the group as exposed-but-unconsumed (the follow-up change's SPA ⌘N binding is its intended consumer). <!-- R2 -->

### Phase 3: Main-Process Glue (app/desktop/src/main.ts)

- [x] T006 Replace the `mainWindow` singleton with a window registry (`Map<number, BrowserWindow>`), add `requestSingleInstanceLock()` + early `app.quit()` on lock failure, the `second-instance` handler (duplicate-of-current via the focused window, restore/welcome when none), and the shared `restoreOrOpenInitial()` startup/`activate` flow driven by `windows.json` (empty set → single fallback window). <!-- R1, R3 -->
- [x] T007 Parameterize routing per window: `attachHostView(win, host, initialPath?)`, `showWelcome(win, query?)`, `showActive(win)`, `switchToHost(win, id)` (registry-only per-window activation — no longer persists via `setActiveHost`; menu rebuild follows), `openAddHost(win)`; `applyOverlayColor(color, win)`; per-(window,host) `viewLoadFailed`/`rawAccentReported` composite keys; `activeId` cosmetic tracking (written on window focus and on switches in the focused window); menu radio callbacks and `servers:switch` route through the sender/focused window; `rebuildMenu()` passes the focused window's active host + the window list; menu rebuilds on window `focus`. <!-- R5, R6, R9 -->
- [x] T008 <!-- rework: quit path collapses window set to last-closed record; close-one-of-N keeps the closing window as a spurious welcome record — review must-fix x2 --> Persist the window set: `before-quit` flag; per-window `close` capture (every live view's `lastPath` in THAT window + the window record via `window-registry`/`windows` store — sentinel windows skipped, `getNormalBounds()` for bounds, focused record ordered last); per-window `closed` (record removal unless quitting; that window's views only destroyed; aggregate badge repaint; menu rebuild); window titles (`host — route-leaf`, welcome → product name) set at attach/welcome/switch and refreshed from per-view `did-navigate`/`did-navigate-in-page`. <!-- R3, R4, R9 -->
- [x] T009 Aggregate badge paint in `main.ts`: `repaintBadge()` computes `aggregateBadge(views)` and paints — `app.setBadgeCount` on mac/linux, the aggregate overlay on EVERY open window on win32; repaints on `badge:set` cache writes, window open/close, host switches, and welcome transitions (replacing the single-window `applyBadge`/`clearBadge` direct paints; the welcome-window direct-paint branch of `badge:set` retires into the aggregate). <!-- R8 -->
- [x] T010 Cross-window removal + new-window seam: `removeHostEverywhere` destroys the host's views in ALL windows (`removeHostViews`) and applies the per-window fallback (`hostRemovedFallback`); `confirmAndRemoveHost` dialog parents on the focused window; `openDuplicateWindow(sourceWin)` (duplicate target via `newWindowTarget`, fresh view, restore-style bounds default) shared by the menu item, `second-instance`, and the new `shell:new-window` IPC handler (gated `isHostsSender`). <!-- R1, R2, R7 -->

### Phase 4: Verification

- [x] T011 <!-- rework: re-run compile + node --test after the persistence fixes --> Run `pnpm install` in `app/desktop` if `node_modules` is absent, then `pnpm run compile` (tsc strict) and `pnpm run test` (`node --test "dist/**/*.test.js"`) — ALL suites green, existing tests updated only where signatures changed. Record real-hardware manual-verify items in `## Notes`. Do NOT launch Electron. <!-- R1, R2, R3, R4, R5, R6, R7, R8, R9 -->

## Execution Order

- T001–T003 are independent pure modules (different files) — T002/T003 marked [P] alongside T001.
- T004/T005 are independent of each other ([P]) but both precede the main.ts glue (T006–T010), which consumes their signatures.
- T006 (window registry + lock + restore) precedes T007–T010, which build on the per-window routing it establishes; T007 precedes T008–T010 (capture/titles, badge, removal all ride the per-window seams).
- T011 is the final gate.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `requestSingleInstanceLock` runs before window creation; lock failure quits; `second-instance` opens a new window in the surviving process.
- [x] A-002 R2: `New Window` (mac Window menu, win/linux File menu, accelerator-less) opens a duplicate of the focused window — same host, same route, fresh `WebContentsView`; welcome when no hosts; `shell:new-window` preload invoker + gated IPC handler route to the same function.
- [x] A-003 R3: `windows.json` (version 1, `{hostId, route, bounds}` records, atomic tmp-rename write, corrupt→empty) sits beside hosts.json; relaunch and mac dock-reopen restore every recorded window; empty route falls back to host `lastPath`; unknown host degrades to first-host/welcome; sentinel windows never persist. — MET after rework: the quit path accumulates each closing window's record (`quitCaptures` + `windowSetForSave`), so the final quit-time write holds the whole set; closing one of N windows rebuilds the set from the OTHER live windows only (pinned by `window-registry.test.ts`).
- [x] A-004 R4: Window titles are `{host} — {route leaf}` (bare origin → host alone; welcome → product name); the mac Window menu carries a manual per-window list rebuilt on open/close/focus/title changes; no new accelerators exist.
- [x] A-005 R5: The view registry keys on (windowId, hostId); the same host displays in N windows with independent views; sender resolution stays `webContentsId`-based; per-view caches keep their shape; the module stays electron-free.
- [x] A-006 R6: Host-switch accelerators and menu radios act on the focused window; the menu rebuilds on focus changes; `activeId` tracks only the last focused window's host.
- [x] A-007 R7: Removing a host destroys its views in every window; each affected window falls to the first remaining host or welcome.
- [x] A-008 R8: The painted badge sums waiting counts over distinct displayed hosts (duplicates count once); it recomputes on cache changes, window open/close, and host switches; win32 paints the aggregate overlay on every open window.
- [x] A-009 R9: Overlay paint, underlay blanking, bounds sync, welcome rendering, and last-path capture operate per window; window-open deny, navigation guard, permission handler, and IPC gating are unchanged.

### Behavioral Correctness

- [x] A-010 R6: `switchToHost` no longer persists `activeId` on every switch — per-window activation is registry-only and `activeId` moves only on focus/focused-switch.
- [x] A-011 R8: A host shown in two windows contributes its count once (first window's cache), not twice. — `aggregateBadge` dedupes by hostId keyed on the FIRST-CREATED window (smallest active window id), matching the Design Decision; pinned by a dedicated `views.test.ts` creation-vs-activation-order case.
- [x] A-012 R3: Closing ONE of several windows drops only that window's record; quitting keeps every record for the next launch. — MET after rework: quit accumulates records per closing window (`captureWindowRecord` into `quitCaptures`, saved via `windowSetForSave`) so the final write holds the whole set; a non-quit close rebuilds the set excluding the closing window (no degraded welcome record). Both behaviors pinned in `window-registry.test.ts`.

### Scenario Coverage

- [x] A-013 R2: Duplicate-window derivation, record ordering, restore-target resolution, route-leaf/title derivation, and removal fallback are covered by `node --test` cases in `window-registry.test.ts`.
- [x] A-014 R5: Same-host-in-two-windows, per-window active pointers, cross-window removal, and aggregate-badge cases exist in `views.test.ts`.
- [x] A-015 R3: Missing/corrupt/wrong-shape load tolerance, atomic-write roundtrip, optional-field drop tolerance, and record validation cases exist in `windows.test.ts`.

### Edge Cases & Error Handling

- [x] A-016 R3: A record referencing a removed host restores that window to the first-host/welcome fallback; a fully empty/corrupt `windows.json` opens exactly one fallback window.
- [x] A-017 R2: New Window with zero hosts registered opens the welcome page; New Window under `RK_DESKTOP_URL` duplicates the sentinel as an independent view and persists nothing.
- [x] A-018 R1: A second-instance event with no open window opens a restore/welcome window rather than crashing or no-oping.

### Code Quality

- [x] A-019: New pure modules follow the `hosts.ts`/`views.ts` precedent — electron-free, directory/handle-parameterized, function-style state transitions, sibling `node --test` suites; the package stays at three devDependencies.
- [x] A-020: Impure Electron glue stays in `main.ts`; no decision logic was added inline to `main.ts` that belongs in a testable module.
- [x] A-021 Pattern consistency: New code follows naming and structural patterns of surrounding code.
- [x] A-022 No unnecessary duplication: Existing utilities (`switchToHost`-style single seams, store helpers) are reused rather than reimplemented.

### Security

- [x] A-023 R9: `shell:new-window` is sender-gated (`isHostsSender` — registered origins + welcome) like `servers:*`; the window-open deny policy and navigation allowlist are byte-identical in behavior.
- [x] A-024 R5: IPC sender gating still resolves views by `webContentsId` (never origin), so shared-origin windows cannot cross-paint badge/accent state.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- There is no e2e rig for the Electron shell (Playwright never covers it — `isShell()` is false there); the pure-module suites plus `tsc` are the automated surface.
- **Manual-verify on real hardware** (not covered by any automated gate):
  - ⌘\` / ⇧⌘\` window cycling and App Exposé / Dock window-list distinguishability on macOS; Alt+Tab on win/linux.
  - Second-instance behavior: `open -n` (or relaunching the binary) quits the new launch and opens a window in the survivor.
  - mac Window-menu per-window list: presence, check mark on the focused window, click-to-focus, rebuild on title changes.
  - Window titles track route changes live (`did-navigate-in-page` driven) and survive the page-title-vs-`setTitle` interaction with the underlay.
  - Cold-start restore of a multi-window set (bounds, routes, focus order) and macOS dock-reopen after all windows closed.
  - win32 aggregate overlay on every taskbar button; ⌥⌘1–9 / Alt+1–9 on non-US layouts (standing digit-accelerator caveat).
  - New Window under `RK_DESKTOP_URL` (dev sentinel duplication).

## Deletion Candidates

- `app/desktop/src/views.ts:127 removeView` — both production teardown paths (window close, host removal/set-url) now go through `removeWindowViews`/`removeHostViews`; `removeView` has no production call site left (only `views.test.ts` exercises it).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `windows.json` shape: `{ version: 1, windows: [{ hostId: string | null, route: string, bounds: { width, height, x?, y? } }] }`, ordered array, same tolerance discipline as hosts.json (required-field violations reject the file; wrong-typed optional x/y drop the field) | Intake contract #7 fixes the record triple and the store discipline; the envelope follows the hosts.json v1 precedent (intake #13) | S:70 R:85 A:85 D:75 |
| 2 | Confident | Record order = window creation order with the last-focused window's record moved to the end at capture; restore creates in array order so the last-created window takes focus | The cheapest focus-restoration encoding; array position carries what a `focused` field would | S:60 R:85 A:75 D:65 |
| 3 | Confident | win32 overlay: the aggregate paints on EVERY open window's taskbar button (confirms intake Assumption #10) | Per-window surface, app-scoped count — every entry should signal; the simpler invariant (one recompute paints all) | S:60 R:90 A:80 D:70 |
| 4 | Confident | `RK_DESKTOP_URL` sentinel: New Window duplicates it as an independent `(windowId, "__dev__")`-keyed view; sentinel windows never persist to windows.json (confirms intake Assumption #11, no simplification needed) | The (window, host) re-key makes duplication the natural path; single-window restriction would be a dev-only special case | S:65 R:90 A:75 D:65 |
| 5 | Confident | `activeId` is written on window-focus events and on switches in the focused window only; per-window activation itself is registry-only (no store write) | Contract #8 demotes `activeId` to cosmetic last-focused tracking; writing on non-focused switches would lie about focus | S:60 R:80 A:75 D:65 |
| 6 | Confident | Duplicate-host badge dedupe: the count comes from the FIRST window (creation order) showing that host | "Counts once" is contracted; the cache pick is arbitrary-but-deterministic — duplicate views normally report the same number | S:55 R:90 A:75 D:60 |
| 7 | Confident | Restore route resolution: a non-empty recorded route wins; empty route falls back to the host's `lastPath`; unknown `hostId` degrades that window to `resolveActiveHost`/welcome | Contract #7's "last-closed-wins applies only where a per-window record is absent" plus ordinary robustness for hosts removed while the app was closed | S:60 R:85 A:75 D:65 |
| 8 | Confident | Quit vs close-one-window distinguished by a `before-quit` flag: `close` captures the record — accumulated on quit, dropped (set rebuilt from the surviving windows) when NOT quitting | Without the accumulation, quit-time saves would rebuild from a shrinking live-window set and the final write would hold only the last-closed window's record, breaking cold-start restore | S:65 R:85 A:80 D:70 |
| 9 | Confident | Route leaf = last non-empty path segment; titles refresh from per-view `did-navigate` + `did-navigate-in-page` events | Intake #12's reading; the two navigation events are the only signals a history-API SPA emits for route changes | S:60 R:85 A:75 D:65 |
| 10 | Confident | `buildMenu` extends to `(hosts, focusedHostId, windows, callbacks, daemon, update)`; menu.ts stays electron-importing with no pure extraction (the window-list model derivation lives in window-registry.ts) | The existing menu module already imports electron and is verified by compile + the mocked-electron template precedent; the genuinely testable decisions move to the pure module | S:60 R:80 A:75 D:65 |

10 assumptions (1 certain, 9 confident, 0 tentative, 0 unresolved).
