# Plan: Desktop Persistent Host Renderers

**Change**: 260801-3cag-desktop-persistent-host-renderers
**Intake**: `intake.md`

## Requirements

### Desktop Shell: View Lifecycle

#### R1: One persistent WebContentsView per visited host
The shell MUST maintain one `WebContentsView` per **visited** host, created **lazily** on first switch/load (never eagerly for registered-but-unvisited hosts) and kept alive while the host stays registered and the window is open. Destroying a host's view MUST close its webContents. Host removal (`Hosts → Remove`) MUST destroy that host's view; window teardown MUST destroy all views.

- **GIVEN** 3 registered hosts and a cold start landing on host A
- **WHEN** the app starts
- **THEN** exactly one view exists (host A's); hosts B and C have no view yet
- **AND WHEN** the user switches to B and back to A
- **THEN** B's view is created exactly once and A's view is reused with no reload — both remain alive in the registry

- **GIVEN** host B has a live view
- **WHEN** the user removes host B via `Hosts → Remove`
- **THEN** B's view is detached (when attached) and its webContents closed, and its registry entry (badge/theme caches included) is dropped

#### R2: switchToHost is detach/attach, never navigation
`switchToHost(id)` MUST: persist the active id via the store → detach the current view → attach (create-then-attach on first visit) the target host's view → rebuild the menu. It MUST NOT call `loadURL` on an existing view (warm switches preserve live renderer state: WS/SSE connections, xterm scrollback, scroll position). All existing entry points — Hosts-menu radios, ⌥⌘1–9 / ⇧Ctrl+1–9 accelerators, the SPA strip dropdown via `servers:switch`, and the local-connect tail — MUST keep routing through this one seam.

- **GIVEN** hosts A (active, view live) and B (view live from an earlier visit)
- **WHEN** the user presses the switcher accelerator for B
- **THEN** the store's `activeId` becomes B, A's view is detached, B's existing view is attached with no `loadURL`, and the menu radios re-check

- **GIVEN** host C registered but never visited
- **WHEN** `servers:switch` targets C
- **THEN** a view for C is created, loaded at `C.url + (C.lastPath ?? "")`, and attached

#### R3: Welcome stays in the window's webContents; views cover the full window
The window remains a `BrowserWindow` whose own webContents serves only the welcome page (`loadFile`, empty list and `?mode=add`). Host views MUST be attached over the **full window content bounds** (the SPA draws the 28px titlebar strip itself) and MUST track window resizes. While a host view is attached, the welcome page MUST NOT keep running underneath: the window webContents is blanked (`about:blank`) so the welcome page's 3s `daemon:status` poll (which spawns `rk` subprocesses) dies with the page. Showing welcome MUST detach the active view, clear the painted badge, and reset the titlebar overlay to the default strip color.

- **GIVEN** the welcome page is showing (`?mode=add`) and hosts exist
- **WHEN** the user switches to a host (menu or accelerator)
- **THEN** the host's view attaches over full bounds and the window webContents loads `about:blank` (no further daemon polling)

- **GIVEN** a host view is attached
- **WHEN** the window is resized (incl. fullscreen transitions)
- **THEN** the attached view's bounds follow the window content size

#### R9: RK_DESKTOP_URL becomes a single dev view
The `RK_DESKTOP_URL` dev override MUST load in a single view under a sentinel (non-persisted) id rather than in the window webContents. Its normalized origin already joins the navigation allowlist; its lastPath is never persisted (no store entry).

- **GIVEN** `RK_DESKTOP_URL=http://localhost:3000`
- **WHEN** the app starts
- **THEN** one dev view attaches loading that URL, `hosts.json` is untouched, and badge/theme wiring works for it like any host view

#### R10: Per-view decision logic in an electron-free pure module
Which view exists/attaches/destroys, the active-view pointer, and the per-view badge-count and theme-color caches MUST live in a new electron-free pure module `src/views.ts` (the actual `WebContentsView` is an opaque generic handle) with a sibling `views.test.ts` `node --test` suite — the `hosts.ts` / `strip.ts` / `badge.ts` pattern.

- **GIVEN** the compiled package
- **WHEN** `pnpm run compile && pnpm test` runs
- **THEN** `dist/views.test.js` runs under `node --test` with no electron import anywhere in `views.ts`

### Desktop Shell: Per-View Wiring

#### R4: Security wiring applies to every view
Every view MUST be created with the same hardened webPreferences as the window (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, the preload path, and the `--runkit-shell-version` additionalArguments). The existing `app.on("web-contents-created")` window-open handler + navigation guard and the session-wide permission handler MUST cover every view's webContents. IPC sender gating (`isHostsSender`/`isWelcomeSender`) keys on sender-frame origin and MUST survive multiple renderers with no change.

- **GIVEN** a background host view
- **WHEN** its page attempts `window.open` or a navigation to a foreign origin
- **THEN** the existing policy applies (external open / deny) exactly as for the single-webContents shell

#### R5: Theme color and fallback strip are per-view
`did-change-theme-color` MUST be observed per view and the last color cached per view. On switch, the **incoming** view's cached color (default strip color when none) MUST be re-applied via `setTitleBarOverlay` (non-darwin; darwin returns early as today, and a throwing call degrades silently). The fallback-strip CSS injection (`shouldInjectFallbackStrip` / `fallbackStripCss`) MUST run per view on its `did-finish-load`, with a per-view inserted-CSS key and the view's own cached color.

- **GIVEN** host A's page reports theme color `#112233` and host B's reports `#445566`
- **WHEN** the user switches A → B → A on win/linux
- **THEN** the overlay repaints `#445566` then `#112233` from the caches — no waiting for the page to re-report

#### R6: Badge cache is per view; only the active view paints
Main MUST cache the last `badge:set` count **per view** (keyed by the sender's webContents id — sender origin can be shared by multiple host entries). A report from the active view paints the OS badge; background views' reports update their cache silently. On switch the incoming view's cached count MUST repaint (0/clear when none cached). Showing welcome clears the painted badge (caches kept); window `closed` clears the OS badge as today. A report from the welcome page (the window's own webContents) keeps today's direct-paint behavior; a report from an unknown sender MUST NOT paint.

- **GIVEN** host A active with badge 2 and background host B's page reports 5
- **WHEN** B reports
- **THEN** the OS badge stays 2 and B's cache holds 5
- **AND WHEN** the user switches to B
- **THEN** the OS badge repaints 5 immediately from the cache

#### R7: lastPath persists at window close and view destroy; restored only on fresh creation
Warm switches keep live state in the view, so switch-time capture is removed. `lastPath` capture MUST run for **every live view** at window `close` and for a view at destroy time, persisting `pathname + search` keyed directly by the view's host id — guarded so a URL whose origin does not match that host entry's origin (mid-navigation, foreign origin) persists nothing. Restore happens only when creating a view fresh (`url + (lastPath ?? "")`); `findHostByOrigin`'s active-wins tiebreak keeps working for the local-connect dedupe.

- **GIVEN** hosts A and B both live, A on `/utils2/rk-dev?x=1`, B on `/board/main`
- **WHEN** the app quits
- **THEN** both entries persist their own routes (id-keyed — one host's route can never pollute another entry)

#### R8: View-menu items act on the focused (view) webContents
Reload / force-reload / devtools / zoom MUST act on the active view's webContents, not the window's welcome webContents. Electron's `reload`/`forceReload`/`toggleDevTools` roles are window-webContents-bound (`windowMethod`), so they MUST be converted to explicit items driven by a focused-webContents helper that prefers `webContents.getFocusedWebContents()`. The accelerator table MUST stay byte-identical (`CmdOrCtrl+R`, `Shift+CmdOrCtrl+R`, `Alt+Cmd+I`, `CmdOrCtrl+0/Plus/-` on mac; `Shift+Ctrl+R`, `Shift+Ctrl+I` on win/linux) — the keyboard-tier seam is untouched.

- **GIVEN** host A's view attached and focused
- **WHEN** the user hits ⌘R (mac) / clicks View → Reload
- **THEN** the view's webContents reloads — the hidden welcome/blank window webContents does not

### Non-Goals

- Badge **aggregation** across hosts (summing waiting counts) — deliberate follow-up; the "window's own host" contract is preserved
- Any `app/frontend` change — the SPA stays shell-agnostic; strip, palette switch, and badge reporter work unchanged inside views
- Multi-window (one window per host)
- View cap/eviction — host lists are small (≤9 switcher slots, typically 2–4)

### Design Decisions

#### The welcome underlay is blanked while a view is attached
**Decision**: When a host view attaches, the window webContents (if showing welcome) loads `about:blank`; `showWelcome` re-loads the page fresh on demand.
**Why**: A welcome page kept alive under a covering view would poll `daemon:status` every 3s forever, spawning `rk --version`/`rk url` subprocesses perpetually — the interval only dies with the page. Blanking is the smallest way to kill it; main-initiated `loadURL` bypasses `will-navigate` so no guard change is needed.
**Rejected**: Visibility-gating the welcome poller renderer-side (an occluding view does not change the page's visibility state, so the page cannot know); leaving it polling (perpetual background subprocess spawn).
*Introduced by*: 260801-3cag-desktop-persistent-host-renderers

#### Views are window-scoped; macOS reopen recreates them lazily
**Decision**: All views are destroyed on the window's `closed` event (registry reset); a macOS dock-activate reopen recreates views lazily from cold start.
**Why**: Detached views without a live window cannot be shown, resized, or badge-painted, and keeping orphan renderer processes alive behind a closed window buys nothing the lazy path doesn't restore; lastPath was already captured at `close`, so reopen lands on the same routes.
**Rejected**: Keeping views alive across window close on macOS (orphan renderers with no visible surface; re-attach bookkeeping across window instances for a rare path).
*Introduced by*: 260801-3cag-desktop-persistent-host-renderers

#### Mac View-menu roles become explicit items over one focused-webContents helper
**Decision**: `reload`/`forceReload`/`toggleDevTools`/zoom items are explicit on mac too (win/linux already had reload/zoom explicit), all driven by `focusedWebContents()` which prefers `webContents.getFocusedWebContents()` and falls back to the focused window's webContents; accelerator strings are kept identical to the former role defaults.
**Why**: Those roles are `windowMethod`-bound in Electron — they act on the focused *window's own* webContents, which under the view model is the hidden welcome/blank page, so ⌘R would reload the wrong surface. The truly focused webContents is the attached view.
**Rejected**: Keeping the roles and focusing the window webContents forward (fights Electron's focus model); passing an active-view accessor into `buildMenu` (couples the menu module to view state when the focus seam already answers it).
*Introduced by*: 260801-3cag-desktop-persistent-host-renderers

#### Capture keys directly on the view's host id, not on origin lookup
**Decision**: `captureLastPathForView(hostId, wc)` persists to that host id after an origin-equality guard (`url.origin === entry.url`), replacing the `findHostByOrigin` lookup for view capture.
**Why**: Each view belongs to exactly one host entry by construction, so the id is authoritative; with shared-origin entries each holding a live view, an origin lookup would misattribute a background view's route to the *active* entry. The origin guard keeps the mid-navigation/foreign-origin protection.
**Rejected**: Keeping origin-based capture (wrong entry under shared origins with multiple live views).
*Introduced by*: 260801-3cag-desktop-persistent-host-renderers

## Tasks

### Phase 1: Pure module

- [x] T001 Create `app/desktop/src/views.ts` — electron-free per-host view registry: `ViewEntry<H>`/`ViewsState<H>`, `emptyViews`, `getView`, `findViewByWebContentsId`, `activeView`, `addView`, `activateView`, `deactivateViews`, `removeView`, `setViewBadge`, `setViewThemeColor`, `switchPaint` (incoming repaint decision: cached badge or 0, cached theme color or null) <!-- R10, R1, R5, R6 -->
- [x] T002 Create `app/desktop/src/views.test.ts` — node:test suite: lazy add/get, duplicate-add no-op, activate/deactivate, remove clears active + returns handle, per-view badge/theme caches (incl. shared-origin two-entry distinct webContentsIds), `switchPaint` defaults (0 / null) and cached values, unknown-id no-ops <!-- R10, R6, R5 -->

### Phase 2: Core implementation (main.ts)

- [x] T003 View creation + wiring in `app/desktop/src/main.ts`: `hostWebPreferences()` (shared window/view webPreferences), `createHostView(hostId)` (`WebContentsView`, dark background, per-view `did-change-theme-color` → cache + overlay-if-active, per-view `did-finish-load` fallback-strip injection with per-view CSS key + per-view color, `did-navigate` key reset), `applyOverlayColor` helper <!-- R4, R5 -->
- [x] T004 Attach/detach seam in `main.ts`: `attachHostView(host)` (detach current, create-if-missing with `url + lastPath` load, `contentView.addChildView`, full-bounds `setBounds`, activate in registry, repaint badge+overlay from `switchPaint`, focus, blank welcome underlay); `syncActiveViewBounds` on `resize`/fullscreen events; rework `showWelcome` (detach + badge clear + overlay default) / `showActive` / `showStartPage` (dev view under sentinel id) <!-- R2, R3, R9 -->
- [x] T005 Rework `switchToHost` (store-first, no `loadURL`, attach seam, menu rebuild) and its entry points: `welcome:add-host` handler and `connectLocalHost` add-path route through `switchToHost` <!-- R2 -->
- [x] T006 Rework `badge:set` handler: resolve sender via `findViewByWebContentsId` → cache per view, paint only when active; welcome (window webContents) sender keeps direct paint; unknown sender never paints; keep `closed`-event clear <!-- R6 -->
- [x] T007 Last-path rework in `main.ts`: `captureLastPathForView(hostId, wc)` (id-keyed, origin-equality guard); capture every live view on window `close`; capture on view destroy; delete the old switch-time/welcome-time `captureLastPath` <!-- R7 -->
- [x] T008 View destruction: `destroyHostView(hostId)` (capture → detach if attached → registry remove → `webContents.close()`) wired into `confirmAndRemoveHost`; `destroyAllViews()` on window `closed` (guarded `isDestroyed`); remove the now-dead single-webContents theme/strip wiring from `openMainWindow` <!-- R1, R3 -->

### Phase 3: Integration & menu

- [x] T009 `app/desktop/src/menu.ts`: `focusedWebContents()` prefers `webContents.getFocusedWebContents()`; convert mac View roles (`reload`, `forceReload`, `toggleDevTools`, `resetZoom`, `zoomIn`, `zoomOut`) and win/linux `forceReload`/`toggleDevTools` roles to explicit items with byte-identical accelerator strings; `togglefullscreen` role stays <!-- R8 -->
- [x] T010 Compile + run the desktop package suite (`pnpm run compile && pnpm test` in `app/desktop`); fix strict-TS/type errors until green <!-- R1, R2, R3, R4, R5, R6, R7, R8, R9, R10 -->

## Execution Order

- T001 blocks T002 and all of Phase 2 (main.ts imports the registry)
- T003 blocks T004; T004 blocks T005; T006–T008 depend on T004's registry wiring
- T009 is independent of Phase 2 (menu-only) but runs before T010

## Acceptance

### Functional Completeness

- [x] A-001 R1: One view per visited host — lazy creation on first visit, reuse on revisit (no reload), registry entry dropped + webContents closed on host removal
- [x] A-002 R2: `switchToHost` persists active id, detaches/attaches without `loadURL` on existing views; menu radios, accelerators, `servers:switch`, and the local-connect tail all route through it
- [x] A-003 R3: Window webContents serves only welcome/blank; views attach over full content bounds and track resize/fullscreen; welcome underlay blanked while a view is attached
- [x] A-004 R9: `RK_DESKTOP_URL` loads in a sentinel-id dev view, never persisted
- [x] A-005 R10: `src/views.ts` is electron-free with a passing `views.test.ts` node:test suite

### Behavioral Correctness

- [x] A-006 R5: Theme color cached per view; incoming view's cached color re-applied via `setTitleBarOverlay` on switch (darwin early-return, silent degrade); fallback strip injected per view on `did-finish-load` with the view's own color
- [x] A-007 R6: Badge counts cached per view (webContents-id keyed); background reports never paint; switch repaints the incoming cache (0 when none); welcome shows a cleared badge; `closed` clears the OS badge
- [x] A-008 R7: lastPath captured at window close (all live views) and view destroy, id-keyed with origin guard; restored only on fresh view creation; no switch-time capture remains

### Scenario Coverage

- [x] A-009 R10: `views.test.ts` covers lazy add/reuse, remove-clears-active, per-view badge/theme caches under shared origins, and `switchPaint` defaults
- [x] A-010 R2: Warm-switch scenario (A→B→A reuses both views, no `loadURL`) is enforced by the attach seam's create-only load

### Edge Cases & Error Handling

- [x] A-011 R6: A `badge:set` from a sender that is neither a live view nor the window webContents does not paint the OS badge
- [x] A-012 R7: A view mid-navigation (URL origin ≠ its host entry's origin) persists no lastPath
- [x] A-013 R3: Resize with no attached view (welcome showing) is a no-op; `setTitleBarOverlay` failures degrade silently (linux partial WCO)

### Code Quality

- [x] A-014 Pattern consistency: `views.ts` follows the electron-free pure-module pattern (parameterized handle, node:test sibling suite, function-style state ops like `hosts.ts`)
- [x] A-015 No unnecessary duplication: existing helpers reused (`shouldInjectFallbackStrip`, `fallbackStripCss`, `symbolColorFor`, `applyBadge`, `setHostLastPath`, `windowOpenAction` path untouched)
- [x] A-016 Type narrowing over assertions: no `as` casts introduced; unknown IPC payloads stay structurally validated

### Security

- [x] A-017 R4: Every view carries the hardened webPreferences (sandbox, contextIsolation, preload, additionalArguments); `web-contents-created` guards and the session permission handler cover views; sender gating unchanged

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- Manual hardware-verify items (per intake): multi-host flip feel, overlay re-apply on non-darwin, badge repaint on switch, welcome ↔ views transitions

## Deletion Candidates

- `app/desktop/src/hosts.ts:196 findHostByOrigin` — the change removed its last capture-path caller; the only surviving call site is `connectLocalHost` (`main.ts:681`) dedupe, so the "active entry wins among matches" tiebreak (and its doc comment citing last-path capture) is now dead nuance the id-keyed `captureLastPathForView` replaced
- `docs/memory/run-kit/desktop-shell.md:237` — the win/linux View-menu divergence row still claims `forceReload` / `toggleDevTools` "stay roles"; both are now explicit items, so the row's stated contract is redundant with (and contradicted by) the new `menu.ts` shape — hydrate rewrites it rather than deleting

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Views are destroyed on window `closed`; macOS dock-reopen recreates lazily | Intake says "until host removal or app quits" — a closed window's detached views have no showable surface, and lastPath capture at `close` preserves routes; window-scoped is the safe reading | S:55 R:75 A:70 D:65 |
| 2 | Confident | Welcome underlay blanked (`about:blank`) while a view is attached | Not in the intake, but a covered welcome page would poll `daemon:status` (spawning rk subprocesses) every 3s forever; blanking kills the interval with the page | S:50 R:85 A:80 D:75 |
| 3 | Certain | Mac View roles (`reload`/`forceReload`/`toggleDevTools`) converted to explicit items with identical accelerators | Intake explicitly directs "verify roles target the focused view, else convert"; Electron's `windowMethod` roles act on the window's own webContents, which is the hidden welcome page under views | S:80 R:85 A:85 D:85 |
| 4 | Confident | `focusedWebContents()` prefers `webContents.getFocusedWebContents()`, falling back to the focused window's webContents | The attached view is focused after switch, so the focus seam answers "which webContents" without coupling menu.ts to view state | S:55 R:85 A:75 D:70 |
| 5 | Confident | Badge report from the welcome page (window webContents) keeps direct paint; unknown senders never paint | Preserves today's contract for the one non-view allowed sender; the unknown-sender guard closes the removed-host race | S:50 R:85 A:75 D:75 |
| 6 | Confident | View capture is id-keyed with an origin-equality guard (replacing `findHostByOrigin` for capture) | Each view maps to exactly one host entry; origin lookup would misattribute shared-origin background views to the active entry | S:60 R:80 A:80 D:75 |
| 7 | Confident | Dev view sentinel id `__dev__` in the registry; no store entry, no lastPath persistence | Intake: "becomes a single dev view"; sentinel keys the same registry machinery without touching hosts.json | S:65 R:85 A:80 D:80 |
| 8 | Confident | Bounds tracked via `resize` + `enter/leave-full-screen` using `getContentSize` | Child views don't auto-resize; these events cover all size transitions on the three platforms | S:55 R:85 A:70 D:70 |

8 assumptions (1 certain, 7 confident, 0 tentative).
