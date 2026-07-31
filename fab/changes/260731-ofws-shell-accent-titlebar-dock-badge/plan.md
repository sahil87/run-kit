# Plan: Desktop Shell Accent Titlebar & Waiting Badge

**Change**: 260731-ofws-shell-accent-titlebar-dock-badge
**Intake**: `intake.md`

## Requirements

### Desktop Shell: Hidden Titlebar & Strip Foundation

#### R1: Hidden native titlebar with platform-appropriate window controls
The shell's BrowserWindow MUST hide the native titlebar so the page's top edge becomes the visible "titlebar": `titleBarStyle: "hiddenInset"` on macOS (traffic lights composite over the page-drawn strip); `titleBarStyle: "hidden"` plus `titleBarOverlay: { color, symbolColor, height }` on Windows and Linux (native `─ ▢ ✕` draw over the strip's right end). The overlay height MUST equal the SPA strip height (28px).

- **GIVEN** the shell launches on macOS
- **WHEN** the main window opens
- **THEN** the window has no native titlebar band and the traffic lights composite over the page's top 28px

- **GIVEN** the shell launches on Windows or Linux
- **WHEN** the main window opens
- **THEN** the window controls overlay renders over the page's top-right corner at 28px height

#### R2: Windows/Linux overlay color synced via `did-change-theme-color`
The shell SHALL listen to `webContents.on("did-change-theme-color")` — fired by the same `theme-color` meta the SPA already maintains (including the pre-paint localStorage echo in `index.html`) — and on Windows/Linux call `win.setTitleBarOverlay({ color: <observed>, symbolColor: <contrast-derived> })`. The `symbolColor` derivation MUST be a pure electron-free function under `node --test`. Linux partial WCO support MUST degrade gracefully (a throwing `setTitleBarOverlay` is swallowed). No new SPA→shell API is added for the color.

- **GIVEN** the SPA (or the index.html pre-paint script) updates the `theme-color` meta
- **WHEN** `did-change-theme-color` fires on a Windows/Linux shell
- **THEN** the window-controls overlay repaints to the observed color with a contrast-derived symbol color

- **GIVEN** a dark observed color (e.g. `#0f1117`)
- **WHEN** the symbol color is derived
- **THEN** it is the light text hex; a light observed color derives the dark text hex

#### R3: Version-skew fallback strip (shell `insertCSS`)
On `did-finish-load` of a page whose origin is a registered host origin, the shell MUST `insertCSS` a minimal fallback strip — a fixed-position 28px band, `padding-top` on `body`, background from the last observed theme-color, `-webkit-app-region: drag` — whose selectors are keyed on `html:not(.rk-shell-strip)` so they no-op when the SPA-drawn strip (which sets `html.rk-shell-strip`) exists. The gating predicate (registered-host-origin URL) MUST be a pure electron-free function under `node --test`.

- **GIVEN** an older SPA (no strip component) loaded from a registered host origin under the new shell
- **WHEN** `did-finish-load` fires
- **THEN** the injected band gives the window a drag surface

- **GIVEN** a new SPA that mounts the strip (setting `html.rk-shell-strip`)
- **WHEN** the same CSS is injected
- **THEN** the injected rules do not apply (no double strip)

- **GIVEN** the welcome `file://` page or a non-registered URL
- **WHEN** `did-finish-load` fires
- **THEN** no CSS is injected

#### R4: Welcome-page static strip
`welcome.html` MUST carry its own static strip: a neutral `#0f1117` 28px band, `-webkit-app-region: drag`, with matching body top padding — so the welcome page is draggable and visually consistent under the hidden titlebar.

- **GIVEN** the shell shows the welcome page
- **WHEN** the user drags the top band
- **THEN** the window moves

### Frontend: SPA Titlebar Strip

#### R5: Shell-only accent strip above the top bar
A new strip component SHALL render only when `isShell()` (mounted in `AppLayout` above the existing top-bar wrapper): a ~28px full-width draggable band. Background = the instance accent blended at the existing `INSTANCE_TITLEBAR_RATIO` (0.35) — the `titlebarHex` already derived by `instance-accent.ts` (identical color math to the PWA titlebar tint); with no accent set, the plain theme background. The entire strip is `-webkit-app-region: drag` and carries no interactive elements. The component sets the `rk-shell-strip` marker class on `<html>` while mounted (keying R3's fallback off). The existing top bar MUST remain byte-identical (no layout, breadcrumb, or hamburger changes).

- **GIVEN** the SPA runs in a plain browser (`isShell()` false)
- **WHEN** `AppLayout` renders
- **THEN** no strip renders and `<html>` carries no `rk-shell-strip` class

- **GIVEN** the SPA runs in the shell with an instance accent set
- **WHEN** the strip renders
- **THEN** its background is the accent blended into the theme background at 0.35 and `<html>` has the `rk-shell-strip` class

- **GIVEN** no accent is set
- **WHEN** the strip renders
- **THEN** its background is the theme background and it is still draggable

#### R6: Strip label — host identity, contrast text, platform insets
The strip SHALL show a centered label: the shell-registered active host name via the existing `runkitShell.servers.list()` bridge call, falling back to `location.hostname` when the call fails or no active entry exists. Text color MUST be contrast-derived from the strip background (reusing the `themes.ts` contrast helpers). The label MUST be inset so it never sits under the macOS traffic lights (fixed ~80px inset on darwin, from `shellInfo().platform`) or the Windows overlay controls (`titlebar-area-*` env vars). The strip persists in macOS fullscreen (no fullscreen bridge flag).

- **GIVEN** `servers.list()` resolves with an active entry named "studio-mac"
- **WHEN** the strip renders
- **THEN** the centered label reads "studio-mac"

- **GIVEN** `servers.list()` resolves `null` (older shell / denial)
- **WHEN** the strip renders
- **THEN** the label falls back to `location.hostname`

- **GIVEN** platform `darwin`
- **WHEN** insets are computed
- **THEN** both sides are inset ~80px; on other platforms the insets derive from `titlebar-area-*` env vars with 0/full fallbacks

### Desktop Shell: Dock/Taskbar Waiting Badge

#### R7: `badge:set` IPC — bridge group + sender-gated handler
The preload SHALL expose a new invoker group `badge: { set(count) }` on `runkitShell` (`ipcRenderer.invoke("badge:set", count)`). The main-process handler MUST be sender-gated exactly like `servers:*` (`isHostsSender` — registered host origins + welcome page) and MUST reject non-integer or negative payloads with `{ ok: false, error: "Invalid request" }` and no state change.

- **GIVEN** a page loaded from a registered host origin
- **WHEN** it invokes `badge:set` with `3`
- **THEN** the OS badge shows 3 and the call resolves `{ ok: true }`

- **GIVEN** an unregistered sender, or a payload of `-1` / `2.5` / `"3"`
- **WHEN** `badge:set` is invoked
- **THEN** the handler returns `{ ok: false }` and the badge is unchanged

#### R8: Platform badge application; Windows overlay glyph is a pure module
On macOS/Linux the handler SHALL call `app.setBadgeCount(n)` (`0` clears). On Windows it SHALL call `win.setOverlayIcon(<count NativeImage>, "N agents waiting")` and `null` at 0. The count-glyph rendering MUST be canvas-free and live in an electron-free pure module (`app/desktop/src/badge.ts`) producing PNG bytes (consumed via `nativeImage.createFromBuffer`), with `node --test` coverage — the `hosts.ts`/`local-daemon.ts` precedent. Counts above 9 render as `9+`.

- **GIVEN** count 5 on macOS
- **WHEN** the handler runs
- **THEN** `app.setBadgeCount(5)` is called

- **GIVEN** count 12 on Windows
- **WHEN** the glyph is generated
- **THEN** `badge.ts` produces a valid PNG (signature + declared dimensions) whose label is `9+`, and the overlay description reads "12 agents waiting"

#### R9: Badge cleared on host switch, welcome navigation, and window close
The shell MUST clear the badge on host switch (`switchToHost`) and on navigation to the welcome page, letting the new page re-report once its SSE stream is up; and clear it when the main window closes.

- **GIVEN** a non-zero badge
- **WHEN** the user switches hosts or the window closes
- **THEN** the badge is cleared (count 0 / overlay removed)

### Frontend: Waiting-Count Badge Subscriber

#### R10: SPA subscriber derives waiting count from SSE and reports on change
A small subscriber (mounted in `AppLayout`, gated on `isShell()`, no-op in browsers) SHALL derive the waiting-agent count from the already-streamed SSE session state — `agentState === "waiting"` only (busy/idle never count), summed across everything the connected instance's stream covers (`sessionsByServer`) via the `lib/waiting.ts` helpers — and call the shell's `badge.set(n)` only when the count changes, reporting `0` explicitly so clears propagate. `lib/shell.ts` SHALL gain a never-throwing `badge` bridge accessor (absent group / rejection / denial resolve `false`), matching the `servers` wrapper pattern. No polling, no new endpoint (Constitution II).

- **GIVEN** two sessions with one waiting window each across two attached servers
- **WHEN** the subscriber derives the count
- **THEN** it reports 2

- **GIVEN** the count goes 2 → 2 across an SSE update
- **WHEN** the subscriber re-renders
- **THEN** no bridge call is made; when it goes 2 → 0 the subscriber reports 0

- **GIVEN** a plain browser or an older shell without the `badge` group
- **WHEN** the subscriber would report
- **THEN** nothing throws and no call is made

### Non-Goals

- Full titlebar merge (SPA top bar becoming window chrome) — explicitly rejected in favor of the strip (1b); the hidden-titlebar foundation keeps it possible later
- Sidebar vibrancy, launch-flash `backgroundColor` sync, shell marker chip — excluded by the intake
- Taskbar progress bar, per-route window title — presented alongside the badge and not taken
- macOS fullscreen strip suppression (no fullscreen bridge flag in v1)
- Backend (Go) changes, route changes, Playwright e2e (`isShell()` is false in Playwright)

### Design Decisions

#### Windows overlay glyph is a hand-rolled PNG encoder
**Decision**: `badge.ts` renders the count glyph into an RGBA raster (5×7 bit-font digits, filled disc) and encodes PNG bytes itself (zlib deflate via `node:zlib` + a small CRC32), consumed by `nativeImage.createFromBuffer`.
**Why**: `nativeImage.createFromDataURL` accepts only PNG/JPEG (not SVG), the main process has no canvas, and the three-dep pin forbids an image library. A ~hundred-line pure encoder keeps the module electron-free and `node --test`-coverable.
**Rejected**: SVG data URL (unsupported by nativeImage); an offscreen BrowserWindow render (heavy, untestable); adding an image dependency (breaks the dep pin).
*Introduced by*: 260731-ofws-shell-accent-titlebar-dock-badge

#### `titlebarHex` is exposed from the accent context, not re-derived
**Decision**: `InstanceAccent` gains a nullable `titlebarHex` field (the strip is the first rendering surface consuming the 0.35 blend directly).
**Why**: The provider already derives it for the meta bridge; a second `deriveAccentHexes` call in the strip would duplicate one derivation and could drift.
**Rejected**: Strip-local `deriveAccentHexes(color, theme)` (duplicate derivation); reading the meta tag content (DOM round-trip for state React already holds).
*Introduced by*: 260731-ofws-shell-accent-titlebar-dock-badge

#### Drag regions are CSS utility classes, not inline style casts
**Decision**: `globals.css` gains `.rk-shell-drag { -webkit-app-region: drag; }`; the strip uses the class.
**Why**: `WebkitAppRegion` is not in React's `CSSProperties`, and code-quality forbids `as` casts; a class is also where the `rk-*` utility vocabulary lives.
**Rejected**: `style={{ WebkitAppRegion: "drag" } as CSSProperties}` (assertion); a styled wrapper component (overkill).
*Introduced by*: 260731-ofws-shell-accent-titlebar-dock-badge

## Tasks

### Phase 1: Setup — desktop pure modules

- [x] T001 [P] Create `app/desktop/src/strip.ts` (electron-free): `STRIP_HEIGHT_PX = 28`, `symbolColorFor(bgHex)` (contrast-derived light/dark symbol hex), `fallbackStripCss(bgHex)` (fixed band + body padding, selectors keyed on `html:not(.rk-shell-strip)`), `shouldInjectFallbackStrip(url, origins)` (http(s) + origin ∈ registered set). Sibling `app/desktop/src/strip.test.ts` under `node --test`. <!-- R2, R3 -->
- [x] T002 [P] Create `app/desktop/src/badge.ts` (electron-free): `badgeLabel(n)` (`""`/`"1"`–`"9"`/`"9+"`), `overlayDescription(n)`, `badgePng(n)` (RGBA disc + 5×7 digit font → PNG bytes via `node:zlib` deflate + CRC32). Sibling `app/desktop/src/badge.test.ts` (PNG signature, IHDR dimensions, label cases, distinct bytes per count). <!-- R8 -->

### Phase 2: Shell integration (`app/desktop`)

- [x] T003 In `app/desktop/src/main.ts`: BrowserWindow gains `titleBarStyle` (`hiddenInset` on darwin, `hidden` + `titleBarOverlay {color, symbolColor, height: STRIP_HEIGHT_PX}` elsewhere); track last observed theme color; wire `did-change-theme-color` → `setTitleBarOverlay` (non-darwin, try/catch for partial Linux WCO); wire `did-finish-load` → `insertCSS(fallbackStripCss(...))` gated on `shouldInjectFallbackStrip(url, registeredOrigins())`. <!-- R1, R2, R3 -->
- [x] T004 Badge IPC: add the `badge` invoker group to `app/desktop/src/preload.ts`; in `main.ts` add the `badge:set` handler (`isHostsSender` gate, integer ≥ 0 validation, darwin/linux `app.setBadgeCount`, win32 `setOverlayIcon` from `badgePng`), plus `clearBadge()` calls in `switchToHost`, `showWelcome`, and the main window `closed` event. <!-- R7, R8, R9 -->
- [x] T005 [P] Add the static 28px `#0f1117` draggable strip to `app/desktop/src/welcome/welcome.html` (fixed band + body top padding). <!-- R4 -->
- [x] T006 Compile and run the desktop suite: `cd app/desktop && pnpm run compile && pnpm test` (node --test over `dist/**/*.test.js`). <!-- R1, R2, R3, R7, R8 -->

### Phase 3: SPA (`app/frontend`)

- [x] T007 [P] Expose `titlebarHex` on the `InstanceAccent` context value (`src/contexts/instance-accent-context.tsx`) and update the test fixtures constructing `InstanceAccent` objects (`sidebar.test.tsx`, `sidebar/index.test.tsx`, `settings-dialog.test.tsx`, `sidebar/host-panel.test.tsx`, others found by tsc). <!-- R5 -->
- [x] T008 [P] Add the `badge` bridge accessor `setShellBadge(count): Promise<boolean>` to `src/lib/shell.ts` (structural narrowing, never throws) + cases in `src/lib/shell.test.ts` (absent group, well-formed, rejection, `{ok:false}`). <!-- R10 -->
- [x] T009 [P] Create `src/lib/shell-strip.ts` pure helpers: `stripLabelColor(bgHex)` (contrastRatio pick between fixed light/dark text hexes), `stripInsets(platform)` (darwin 80px both sides; else `titlebar-area-*` env expressions), `activeShellHostName(servers)` (active entry's name or null) + `src/lib/shell-strip.test.ts`. <!-- R5, R6 -->
- [x] T010 Create `src/components/shell-titlebar-strip.tsx` (28px band: `titlebarHex ?? theme background`, drag class, centered truncated label from `listShellServers()` with `location.hostname` fallback, `rk-shell-strip` marker class on `<html>` while mounted); add `.rk-shell-drag` to `src/globals.css`; mount in `AppLayout` (`src/app.tsx`) above the top-bar wrapper gated on `isShell()`; component test `shell-titlebar-strip.test.tsx` (browser → null; shell → renders label, marker class, accent/fallback background). <!-- R5, R6 -->
- [x] T011 Add `countWaitingAcrossServers(sessionsByServer)` to `src/lib/waiting.ts` (+ cases in its test file, creating `waiting.test.ts` if absent); create `src/components/shell-badge-reporter.tsx` (null-rendering subscriber: derives the count, reports via `setShellBadge` on change only, reports 0) + test (report-on-change, explicit 0, browser no-op); mount in `AppLayout` gated on `isShell()`. <!-- R10 -->
- [x] T012 Frontend verification: `cd app/frontend && npx tsc --noEmit`, then `just test-frontend`. <!-- R5, R6, R10 -->

## Execution Order

- T001/T002 are independent [P]; T003 depends on T001; T004 depends on T002 (and touches the same `main.ts` as T003 — run after T003)
- T006 gates Phase 2 completion; T007–T009 are independent [P]; T010 depends on T007 + T009; T011 depends on T008; T012 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: BrowserWindow options hide the native titlebar per platform (`hiddenInset` darwin; `hidden` + 28px `titleBarOverlay` elsewhere) — `main.ts:738-748`
- [x] A-002 R2: `did-change-theme-color` updates the Windows/Linux overlay color with a contrast-derived symbol color; derivation is pure and node:test-covered — `main.ts:761-774`, `strip.ts:52`, `strip.test.ts:18-31`
- [x] A-003 R3: Registered-host loads get the fallback strip CSS keyed on `html:not(.rk-shell-strip)`; the gating predicate is pure and node:test-covered — `main.ts:778-783`, `strip.ts:61-95`, `strip.test.ts:35-77`
- [x] A-004 R4: welcome.html carries a static draggable `#0f1117` strip — `welcome.html:37-48,193`
- [x] A-005 R5: The SPA strip renders only under `isShell()`, uses `titlebarHex` (0.35 blend) with theme-background fallback, is fully draggable with no interactive children, and sets the `rk-shell-strip` marker — `app.tsx:238-239`, `shell-titlebar-strip.tsx:41-74`
- [x] A-006 R6: Strip label shows the active shell host name with `location.hostname` fallback, contrast-derived text color, and platform insets (80px darwin / `titlebar-area-*` elsewhere) — `shell-strip.ts:27-57`, `shell-titlebar-strip.tsx:48-73`
- [x] A-007 R7: `badge.set` bridge group exists; `badge:set` is `isHostsSender`-gated and rejects non-integer/negative payloads — `preload.ts:46-48`, `main.ts:712-719`
- [x] A-008 R8: macOS/Linux badge via `app.setBadgeCount`; Windows overlay icon generated by the electron-free `badge.ts` PNG module (label caps at `9+`) — `main.ts:147-158`, `badge.ts:31-34,176-178`
- [x] A-009 R9: Badge cleared on host switch, welcome navigation, and window close — `main.ts:167,224,789-792`
- [x] A-010 R10: The `isShell()`-gated subscriber derives the waiting count from streamed SSE state and reports on change only, including explicit 0 — `shell-badge-reporter.tsx:24-35` (scope caveat: `sessionsByServer` covers ATTACHED servers only — see review should-fix)

### Behavioral Correctness

- [x] A-011 R5: The existing top bar markup/layout is unchanged (no breadcrumb/hamburger/layout edits — the strip is a new sibling above it) — `app.tsx` diff adds only the two gated siblings + imports
- [x] A-012 R2: The color sync reuses the existing `theme-color` meta seam — no new SPA→shell color API was added — no new IPC channel beyond `badge:set`

### Scenario Coverage

- [x] A-013 R3: Tests cover: registered-host URL → inject; welcome file:// and foreign origin → no inject — `strip.test.ts:57-77`
- [x] A-014 R8: Tests cover PNG validity (signature/IHDR), `badgeLabel` boundaries (0, 1, 9, 10+), and overlay description text — `badge.test.ts:12-81`
- [x] A-015 R10: Tests cover count derivation across servers, change-only reporting, explicit-0 propagation, and plain-browser no-op — `waiting.test.ts:50-64`, `shell-badge-reporter.test.tsx:49-88`

### Edge Cases & Error Handling

- [x] A-016 R2: A throwing `setTitleBarOverlay` (partial Linux WCO) is swallowed — no crash — `main.ts:766-773` (try/catch; not unit-covered — impure Electron glue)
- [x] A-017 R6: `servers.list()` failure/denial/older-shell falls back to `location.hostname` without throwing — `shell.ts` `listShellServers` never throws; `shell-titlebar-strip.test.tsx:101-107`
- [x] A-018 R7: Invalid payloads (float, negative, non-number) and unauthorized senders leave the badge unchanged — `main.ts:713-716` (early return before `applyBadge`; not unit-covered — impure `ipcMain` glue)

### Code Quality

- [x] A-019 Pattern consistency: new desktop modules follow the electron-free pure-module + `node --test` precedent; SPA code follows the structural-narrowing (no `as` casts) bridge pattern — verified: zero `as` casts in new code; `badge.ts`/`strip.ts` import only `node:zlib`
- [x] A-020 No unnecessary duplication: reuses `instance-accent.ts` blend math, `themes.ts` contrast helpers, `lib/waiting.ts` counting, `isHostsSender` gating — no parallel implementations (`strip.ts`'s own luminance helper is unavoidable — `app/desktop` is a separate package with no path to `app/frontend`)
- [x] A-021 No client polling: the badge subscriber derives from the existing SSE stream (no `setInterval`/fetch) — `shell-badge-reporter.tsx` reads `useSessionContext()` only
- [x] A-022 Security: `badge:set` payload structurally validated in main before use; sender-frame gated (Constitution I posture) — `main.ts:712-719`; `fallbackStripCss` also hex-validates before CSS interpolation (`strip.ts:62`)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. Every touched surface is additive: the strip is a new sibling above an untouched top bar, `badge:*` is a new IPC channel alongside (not replacing) `servers:*`, `titlebarHex` is a new context field beside the existing `stripeHex`/`washHex`, and `countWaitingAcrossServers` composes the existing `countWaitingInSessions` rather than superseding it. The `#0f1117` literal now appears in three places (`main.ts:736` `backgroundColor`, `strip.ts:31` `DEFAULT_STRIP_COLOR`, `welcome.html:44`) — consolidating the two `app/desktop` occurrences onto `DEFAULT_STRIP_COLOR` is a consolidation opportunity, not a deletion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Windows overlay glyph = hand-rolled PNG encoder in `badge.ts` (RGBA disc + 5×7 bit font + zlib/CRC32), label capped at `9+` | `nativeImage.createFromDataURL` accepts only PNG/JPEG (no SVG); dep pin forbids an image lib; a 2-glyph cap keeps a 16–32px overlay legible | S:60 R:80 A:75 D:70 |
| 2 | Confident | Expose `titlebarHex` on the accent context rather than re-deriving in the strip | The provider already computes it; single derivation cannot drift; fixture updates are mechanical | S:55 R:85 A:85 D:75 |
| 3 | Confident | Drag region via a `globals.css` utility class (`.rk-shell-drag`), marker via `rk-shell-strip` on `<html>` | `WebkitAppRegion` is absent from React's CSSProperties and code-quality bans `as` casts; `rk-*` utility classes are the established vocabulary | S:55 R:90 A:85 D:80 |
| 4 | Confident | Fallback CSS injected on every registered-host load, self-disabled by the `html:not(.rk-shell-strip)` selector (no probing) | CSS is live — the marker appearing disables the rules; avoids timing races an executeJavaScript probe would have | S:60 R:85 A:80 D:75 |
| 5 | Confident | Badge clear seams = `switchToHost` + `showWelcome` + window `closed`; the add-host/local-connect `loadURL` paths start from welcome where the badge is already cleared | Matches the intake's three named clear points; covering the loadURL tails would be redundant | S:65 R:85 A:80 D:75 |
| 6 | Confident | Strip label text color picked by `contrastRatio` against fixed light (`#e5e7eb`) / dark (`#111827`) text hexes; symbolColor uses the same rule shell-side | "Contrast-derived (reuse themes.ts helpers)" with a binary pick is the obvious reading; both hexes are the app's standard text colors | S:55 R:90 A:75 D:70 |
| 7 | Confident | Linux `setTitleBarOverlay` wrapped in try/catch (silent degradation) | Intake grants "Linux degrading gracefully where WCO support is partial"; swallow-and-continue is the only non-crashing reading | S:60 R:90 A:80 D:80 |
| 8 | Confident | macOS traffic-light inset fixed at 80px on BOTH sides so the centered label stays visually centered | Intake specifies "a fixed ~80px inset on darwin"; symmetry is the presentation detail it leaves open | S:55 R:95 A:80 D:75 |

8 assumptions (0 certain, 8 confident, 0 tentative).
