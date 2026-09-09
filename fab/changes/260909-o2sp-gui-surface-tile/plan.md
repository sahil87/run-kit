# Plan: GUI Surface Tile (plan C3 — frontend)

**Change**: 260909-o2sp-gui-surface-tile
**Intake**: `intake.md`

> Read `intake.md` first — it carries the shipped-shape audit (the `event: gui`
> payload keys, the `/api/gui/*` routes, the WS close codes) that every
> requirement below keys off. The plan's decision log D1–D10
> (`fab/plans/sahil/26-09-09-gui-surface.md`) is binding and not re-opened.

## Requirements

### Registry: `gui` is a surface kind

#### R1: `gui` joins the lens/surface registry
`ViewName`/`SurfaceKind` SHALL include `"gui"`; `SURFACE_LABEL.gui` MUST be `"GUI"` and `SURFACE_GLYPH.gui` MUST be `"[]"`. `parseLayout` MUST accept `gui` in any slot with the existing non-tty no-repeat rule.

- **GIVEN** the string `split-h:tty,gui`
- **WHEN** `parseLayout` runs
- **THEN** it returns `{shape:"split-h", order:["tty","gui"]}`
- **AND** `split-h:gui,gui` returns `null`

#### R2: Availability keys off the payload's `enabled`, never a probe
`availableTiles(win, host)` SHALL push `gui` as the LAST kind iff `hasGui(host)` — `host?.enabled === true` — where `host` is the `id:"host"` entry of the `event: gui` payload. A `null`/absent signal MUST read as not available. `reachable`, `backend`, and `viewers` MUST NOT affect availability. `availableViews` and `right-panel.ts`'s `availableSurfaces` MUST thread the same arg and return the same set.

- **GIVEN** a window with `codeRoot` and a gui signal `{enabled:true, reachable:false}`
- **WHEN** `availableTiles(win, gui)` runs
- **THEN** it returns `["tty","code","web","gui"]`
- **AND** with `{enabled:false, reachable:true}` or `null` it returns `["tty","code","web"]`

#### R3: Off degrades, on restores, the option is never written
`effectiveLayout(win, host)` SHALL drop `gui` tiles through the existing `degradeLayout` collapse when `hasGui(host)` is false and render them again when it flips true, with `@rk_win_layout` untouched on both transitions.

- **GIVEN** `layout: "split-h:tty,gui"` and `host = {enabled:false}`
- **WHEN** `effectiveLayout` runs
- **THEN** it returns `single:tty`
- **AND** with `host = {enabled:true}` the same input returns `split-h:tty,gui`, and no `/options` POST is issued by either render

#### R4: `FocusKind` gains `gui`
`focus-memory.ts` `FocusKind` SHALL include `"gui"`; the gui tile records focus through the same `recordFocus` seam as `code` on genuine interaction.

- **GIVEN** a gui tile in slot B
- **WHEN** the user pointer-downs on its canvas
- **THEN** `focusedTileKind` becomes `gui` and `recordFocus(key, "gui")` fires

### State: the `gui` signal

#### R5: A `useGui()` context mirrors the code-server slot
`session-context.tsx` SHALL handle `case "gui"`: the data is a JSON list; select the entry with `id === "host"` (fallback `[0]`); narrow every field with type guards (`enabled`/`reachable` booleans, `backend`/`display` strings, `width`/`height`/`viewers` numbers, defaults `false`/`""`/`0`); dedup on the raw payload string like `applyCodeServer`. `useGui()` returns `GuiSignal | null` (`null` = no event yet).

- **GIVEN** a `gui` event `[{"id":"host","enabled":true,"backend":"Xtigervnc","reachable":true,"display":":10","width":1920,"height":1080,"viewers":1}]`
- **WHEN** it arrives twice with identical bytes
- **THEN** consumers re-render once with `{enabled:true, reachable:true, width:1920, height:1080, backend:"Xtigervnc", display:":10", viewers:1}`

### Top bar, chords, palette, settings

#### R6: The 4th toggle is registry-driven; its dot is VNC health
The top-bar `SurfaceToggleGroup`, the overflow Tiles rows, and the mobile switch group SHALL render the gui button with no gui-specific branches — presence follows `availableTiles`. The `showDot` predicate SHALL return the RFB connection state (`connected` from the tile via the R11 seam, falling back to `gui.reachable` when no tile is open) for `gui`.

- **GIVEN** the switch flips from off to on in the stream
- **WHEN** the next `gui` event lands
- **THEN** every open tab shows a 4th button with glyph `[]` and tooltip `GUI` without reload
- **AND** flipping back off removes the button and any Tiles menu row

#### R7: ⌘4 / ⇧Ctrl+4 is the `gui-toggle` stateful chord
`keybindings.ts` SHALL register `{ actionId:"gui-toggle", code:"Digit4", tier:"shifted", macTier:"cmd", scope:"terminal", kind:"builtin", label:"Toggle GUI", description:"open/close the GUI tile", mapLabel:"gui", ignoreInputs:true }`, and `app.tsx` SHALL wire `"gui-toggle": tileChord("gui")` so the three-state rule (open → focus → hide) applies; with the switch off no handler mounts and the chord falls through.

- **GIVEN** the switch is off
- **WHEN** ⌘4 is pressed on a window route
- **THEN** nothing happens and the event is not `preventDefault`ed
- **AND** with the switch on and no gui tile open, ⌘4 adds the tile (`addSurface`) and focuses it once it lands

#### R8: The `GUI:` palette family
A new `lib/palette/gui.ts` SHALL build, gated as listed: `GUI: Turn on` (off ⇒ `postSettings({"gui.enabled": true})`), `GUI: Turn off` (on ⇒ opens the R13 confirm), `GUI: Fullscreen` (tile open ⇒ R12), `GUI: Paste clipboard` (tile open + connected ⇒ `navigator.clipboard.readText()` → `clipboardPasteFrom`), `GUI: Fit` / `GUI: 1:1` (tile open — destination-only pair toggling the `rk-gui-view` posture), `GUI: Lock resolution` / `GUI: Unlock resolution` (tile open + fine pointer — destination-only pair toggling `rk-gui-lock`), `GUI: Open supervisor logs` (on ⇒ navigate to the `rk-gui` session's `host` window on `rk-daemon`; disabled with tooltip `supervisor not running` when absent), `GUI: Reconnect` (tile open + disconnected). The registry-inherited `Tile: Show/Hide/Focus/Switch to GUI` rows MUST appear with no extra code. `withShortcutHints` MUST decorate `gui-toggle`.

- **GIVEN** the switch is on, a gui tile open and connected, fine pointer, view `fit`, unlocked
- **WHEN** the palette opens
- **THEN** it lists `GUI: Turn off`, `GUI: Fullscreen`, `GUI: Paste clipboard`, `GUI: 1:1`, `GUI: Lock resolution`, `GUI: Open supervisor logs`, `Tile: Hide GUI`, `Tile: Focus GUI` and NOT `GUI: Turn on`, `GUI: Fit`, `GUI: Unlock resolution`, `GUI: Reconnect`

#### R9: The settings-dialog GUI row routes the off direction through the confirm
`settings-registry-seam.ts` `commitSetting` SHALL intercept key `gui.enabled` with value `false` while the current value is `true` and open the R13 confirm instead of posting; confirm ⇒ the POST + `updateEntryValue`; cancel ⇒ the toggle snaps back. The on direction and every other key are untouched.

- **GIVEN** the dialog's GUI toggle is on
- **WHEN** the user flips it off and cancels the confirm
- **THEN** no `/api/settings` POST is sent and the toggle shows on

### The renderer

#### R10: `GuiSurface` content states
`components/gui-surface.tsx` (lazy-loaded via `React.lazy` + `Suspense` in `surface-layout.tsx`'s `case "gui"`) SHALL render: `enabled && reachable` ⇒ an `RFB` from `@novnc/novnc/core/rfb.js` on a host `<div data-testid="gui-surface-canvas">` connecting to the absolute `ws(s)://<location.host>/ws/gui/host` URL (never a relative path); `enabled && !reachable` ⇒ `data-testid="gui-surface-empty"` with the text `GUI is on but not running`, the `reason` from `GET /api/gui/host` fetched once per unreachable transition, and two boxed controls **Restart supervisor** (`POST /api/gui/host/restart`; a 409 renders `gui turned off`) and **Open supervisor logs**. The tile is never mounted when `!enabled` (degradation).

- **GIVEN** `{enabled:true, reachable:false}` and `GET /api/gui/host` returning `reason:"no VNC backend: sudo apt install tigervnc-standalone-server openbox"`
- **WHEN** the tile renders
- **THEN** the empty state shows that reason line verbatim and the two controls, and no WebSocket is opened

#### R11: Connection lifecycle — dot, reconnect, visibility
The component SHALL report `connect`/`disconnect` through `onConnectionChange(boolean)` (R6 dot). On an RFB `disconnect` while `reachable` stays true it SHALL show an overlay `disconnected — reconnecting…` and re-dial with backoff 1 s → 2 s → 4 s → 8 s (cap, reset on `connect`); when `reachable` flips false the empty state takes over and the timer is cleared. When `visible` is false for ≥ 15 s (tile zoomed away or `document.visibilityState === "hidden"`) it SHALL `disconnect()` and reconnect on the next `visible` true; focus loss alone MUST NOT disconnect. Unmount MUST `disconnect()` and clear every timer.

- **GIVEN** a connected tile
- **WHEN** the document becomes hidden for 15 s
- **THEN** the RFB is disconnected (relay viewer count drops)
- **AND** when the document becomes visible again a new RFB connects within one backoff step

#### R12: D7 resize, view mode, quality, fullscreen, clipboard, chords
`rfb.resizeSession` MUST equal `!coarsePointer && focused && !resizeLocked`, recomputed on every prop change; `rfb.scaleViewport = viewMode === "fit"`, `rfb.clipViewport = viewMode === "1:1"` with `dragViewport = true` in 1:1. Quality: fine `qualityLevel 6 / compressionLevel 2`, coarse `4 / 6`. `showDotCursor = true`, `focusOnClick = true`, `background = ""`. `viewOnly = true` iff `backend === "screen-sharing"`. RFB `clipboard` events write to `navigator.clipboard` best-effort. The fullscreen verb SHALL call `requestFullscreen()` on the tile wrapper plus `navigator.keyboard.lock()` when present, and exit both on the second invocation or `fullscreenchange`; where `requestFullscreen` is absent it SHALL run the existing zen toggle and the control's tooltip reads `Fullscreen (falls back to zen on this device)`. A capture-phase `keydown` on the canvas wrapper SHALL `stopPropagation()` for events matching `shouldReclaimChord` (built from `hasReclaimableMatch(e, bindings, "gui")`) so noVNC never sees rk chords; every other key reaches the guest; pointerdown/keydown fire `onInteract`.

- **GIVEN** a fine-pointer viewer whose gui tile is focused and unlocked
- **WHEN** the tile resizes
- **THEN** `resizeSession` is `true` (SetDesktopSize goes out)
- **AND** a coarse-pointer viewer never sets `resizeSession` regardless of focus/lock, so the payload `width/height` do not change when a phone connects

#### R12a: macOS credentials prompt (in-memory only)
On `credentialsrequired` the component SHALL render `data-testid="gui-surface-credentials"` over the canvas: label `Screen Sharing password`, a `type="password"` input, Enter or **Connect** ⇒ `rfb.sendCredentials({password})`; Escape ⇒ `disconnect()` and the empty state with reason `Screen Sharing password required`. The password MUST live only in component state (no storage, no POST) and is re-asked on every reconnect. A `securityfailure` after submit re-shows the field with `Wrong password — try again`.

- **GIVEN** `backend:"screen-sharing"` and the RFB emitting `credentialsrequired`
- **WHEN** the user enters a password and presses Enter
- **THEN** `sendCredentials({password})` is called and the field hides; `localStorage`/`sessionStorage` contain no password key

### The off-confirm

#### R13: `GuiOffDialog`
`components/gui-off-dialog.tsx` (the `server-dialogs.tsx` danger-confirm grammar) SHALL fetch `GET /api/gui/host` on open and render title `Turn the GUI off?`, body `Turning the GUI off kills the rk-gui session and every app on display <display>:` followed by an indented line `<name> ×<count>, … (up <uptime>)` (uptime from `uptime_seconds` as `4h 12m` / `3m` / `12s`); variants: empty `apps` ⇒ `No apps are running on display <display>.`; empty `display` ⇒ `Turning the GUI off kills the rk-gui session.`; `backend === "screen-sharing"` ⇒ `Turning the GUI off stops the Screen Sharing mirror; nothing on your Mac is closed.`. Buttons **Cancel** / **Turn off** (danger). Confirm ⇒ `postSettings({"gui.enabled": false})` only — the dialog never calls a kill route.

- **GIVEN** `apps:[{name:"chromium",count:3},{name:"xterm",count:1}]`, `display:":10"`, `uptime_seconds:15120`
- **WHEN** the dialog opens
- **THEN** it shows `chromium ×3, xterm ×1  (up 4h 12m)` and Turn off POSTs exactly `{"gui.enabled":false}`

### Plumbing

#### R14: Wiring in `app.tsx` and `surface-layout.tsx`
`app.tsx` SHALL read `useGui()`, pass the host signal into `availableSurfaces`/`effectiveLayout` (including the `pendingLayout` overlay and any other `effectiveLayout` call), extend `surfaceDot`, wire `tileChord("gui")`, assemble the `GUI:` palette actions, own the `rk-gui-view`/`rk-gui-lock` posture state (validated localStorage reads, try/catch-noop writes), the fullscreen/zen fallback, and the `GuiOffDialog` open state; `surface-layout.tsx` SHALL gain `case "gui"` plus the carried props (`gui`, `guiViewMode`, `guiResizeLocked`, `onGuiConnection`, `onGuiRestart`, `onGuiOpenLogs`) with tile hide-never-unmount preserved (`visible` is a prop). `api/client.ts` SHALL gain `fetchGuiStatus(id)` and `restartGui(id)` over `deduplicatedFetch`.

- **GIVEN** a 2-tile layout `split-h:tty,gui` zoomed to tty
- **WHEN** the zoom applies
- **THEN** the gui tile stays mounted with `visible=false` (and disconnects after 15 s per R11)

### Tests

#### R15: Vitest coverage
Colocated Vitest suites SHALL cover R1–R3 (surface-layout / window-view / right-panel), R4, R5 (session-context gui case), R7 (keybindings), R8 (palette gating), R9 (seam interception), R10–R12a (`gui-surface.test.tsx` with `vi.mock("@novnc/novnc/core/rfb.js")` exposing a fake RFB with settable props, `addEventListener`, `disconnect`, `sendCredentials`, `clipboardPasteFrom`), and R13 (dialog copy variants + POST body).

- **GIVEN** the fake RFB
- **WHEN** props go `{coarsePointer:false, focused:true, resizeLocked:false}` → `{resizeLocked:true}` → `{coarsePointer:true, focused:true, resizeLocked:false}`
- **THEN** `resizeSession` reads `true`, `false`, `false`

#### R16: Playwright coverage
`tests/e2e/gui-surface.spec.ts` (intent comments per constitution) SHALL have (a) an ungated half over `_state-socket-mock.ts` (extended with a `gui` slot option delivered on hello): off ⇒ no 4th button, no Tiles row, ⌘4 inert, a window whose mocked `layout` is `split-h:tty,gui` renders one tile; flipping the mocked slot to `enabled:true, reachable:false` ⇒ the button appears without reload and toggling opens `gui-surface-empty`; run at 375 px and 1280 px; and (b) an Xvnc-gated half (`test.skip` when `Xtigervnc` is not on PATH, with the reason) against the real rig: `POST /api/settings {"gui.enabled":true}` ⇒ button within one state event ⇒ toggle opens `gui-surface-canvas` ⇒ zen zooms it ⇒ coarse emulation at 375 px fits without the payload `width/height` changing ⇒ palette `GUI: Turn off` confirm lists apps ⇒ confirm removes the button ⇒ `GUI: Turn on` restores the same layout; settings snapshot/restore via `_settings.ts`; cleanup `POST /api/settings {"gui.enabled": null}`.

- **GIVEN** the mock delivers `gui: [{id:"host", enabled:false, …}]`
- **WHEN** the window route loads at 1280 px
- **THEN** `[data-testid="surface-toggles"]` contains exactly the tty/code/web buttons and pressing ⌘4 changes nothing

### Docs

#### R17: Spec and plan bookkeeping
`docs/specs/gui.md` SHALL have its substrate diagram corrected to the shipped payload keys (`enabled`, `backend`, `reachable`, `display`, `width`, `height`, `viewers`) and routes (`GET /api/gui/{id}`, `POST /api/gui/{id}/restart`, on/off via `POST /api/settings`), its header `[target] throughout` line replaced by a status line naming C2 and C3 as shipped (agent verbs and smoothness targets stay target); `docs/specs/window-views.md` gui row and `docs/specs/surface-layout.md` § Mobile gui rule flip `[target]` → `[current]`; `docs/specs/index.md` gui row loses `[target]`; `fab/plans/sahil/26-09-09-gui-surface.md` C3 row gains change folder `260909-o2sp-gui-surface-tile`, Status `in review`, and the header Status paragraph is updated (the PR URL cell is filled by the ship stage or left for merge).

- **GIVEN** the docs after apply
- **WHEN** `grep -n 'available, reachable' docs/specs/gui.md` runs
- **THEN** it matches nothing, and `fab docs-index --check` passes

### Backend: the rk-gui option-target fix (discovered at apply)

#### R18: Session-option stamps and reads target `=rk-gui:`, not `=rk-gui`
`tmux set-option` / `show-options` against the `rk-gui` session MUST use the session-scoped exact-match target `tmux.ExactSessionTarget(daemon.GUISessionName)` (`=rk-gui:` — the form `internal/tmux/board.go` already uses for session options); `display-message`, `list-panes`, and `kill-session` keep the bare `=rk-gui` target they already use (tmux accepts it there). Affected sites: `internal/daemon/gui.go` `guiSessionOption` (the `@rk_gui_display`/`@rk_gui_backend` reads behind `GUISessionOptions`) and `cmd/rk/gui_supervise.go`'s stamp write. The existing argv-capturing tests MUST be updated to the new target and a regression comment MUST state the constraint (tmux 3.7c rejects `=name` for option commands, accepts `=name:`).

- **GIVEN** tmux 3.7c and a running `rk-gui` session with a live `Xtigervnc`
- **WHEN** the supervisor stamps `@rk_gui_display :10` and the hub's `guiTick` reads it
- **THEN** the stamp and the read both succeed and the `event: gui` payload reports `reachable:true, display:":10"` (previously both failed with `no such session: =rk-gui` and the stream stayed `reachable:false`)

#### R19: `layoutspec` admits the `gui` surface kind
`internal/layoutspec`'s `surfaceKinds` registry SHALL include `gui` (the frontend ships it in this change — the registry's own "extending is appending one entry" contract). Without it, `POST /api/windows/{id}/options` rejects every gui-bearing `@rk_win_layout` write with a 400, so no toggle/chord/palette path can open a gui tile against a real backend.

- **GIVEN** the C3 frontend and a window route
- **WHEN** the surface toggle writes `@rk_win_layout split-h:tty,gui`
- **THEN** the POST returns 200 and the option holds the value (previously 400 `unknown surface "gui"`)

#### R20: The rk-gui spawn pins the daemon's `XDG_STATE_HOME`
The `new-session` argv for the `rk-gui` supervisor MUST carry `-e XDG_STATE_HOME=<the daemon process's value>` (empty when unset — `gui.StateDir` treats empty as unset). tmux builds pane environments from the SERVER's environment plus the `update-environment` allowlist (which `XDG_STATE_HOME` is not on), so without the pin a daemon whose state home differs from the tmux server's birth env forks `gui.StateDir()`: supervise binds `host.sock` under one root while `gui.Probe` and the relay dial the other. The daemon session's own `-e RK_DAEMON_LOG=…` pin (`startSession`) is the precedent.

- **GIVEN** a daemon launched with `XDG_STATE_HOME=/tmp/e2e-state` against a tmux server born without it
- **WHEN** `gui.enabled` flips on
- **THEN** the supervisor binds the socket under `/tmp/e2e-state/run-kit/gui/` and the probe reports `reachable:true` (previously supervise wrote to the server env's root and the stream stayed `reachable:false`)

### Non-Goals
- Audio, multi-monitor, per-session displays, Wayland, macOS take-control, the macOS virtual-display backend, `(window, gui)` board pins — D10.
- KasmVNC iframe variant (C6), perf sampling (C5), `rk gui exec|shot` and `rk skill gui` (C4).
- A `gui` row in the Host page's system card — outside C3's stated scope.
- Server-side Keychain credential injection for macOS — backend follow-up.
- A shared (cross-viewer) resolution lock — needs a backend key; viewer-local only in v1.

### Design Decisions

#### Host signal is an argument, not a store read
**Decision**: `availableTiles(win, host?)` / `effectiveLayout(win, host?)` take the gui signal as an optional second argument.
**Why**: keeps `lib/surface-layout.ts` pure and DOM-free so the colocated unit tests stay drift-free; `ViewWindow` stays per-window because gui availability is per-host.
**Rejected**: a module-level store or context read inside the pure helpers (untestable without React); a synthetic `gui` field on `ViewWindow` (lies about ownership).
*Introduced by*: 260909-o2sp-gui-surface-tile

#### Visibility, not focus, gates the RFB connection
**Decision**: disconnect after 15 s of not-visible; never on focus loss.
**Why**: noVNC has no pause API; disconnecting when hidden stops framebuffer traffic and releases the relay `viewers` count so the backend probe resumes; focus loss is constant in a multi-tile layout and must not flap the connection.
**Rejected**: disconnect on blur (flaps); keep connected while hidden (wastes bandwidth on phones, keeps the probe suppressed).
*Introduced by*: 260909-o2sp-gui-surface-tile

#### The C2/C3 backend seam fixes ride this change, not separate PRs
**Decision**: the `=rk-gui` → `=rk-gui:` option-target fix (R18), the `layoutspec` `gui` registry entry (R19), and the spawn's `XDG_STATE_HOME` pin (R20) are bundled into C3.
**Why**: without them the shipped backend cannot drive C3's live-canvas acceptance anywhere (stamps never land on tmux ≥ 3.7 hosts; gui-bearing layout writes 400; env-isolated rigs fork the socket path); the fixes are a few argv/registry literals plus their tests, and the same PR is where the evidence (the gated e2e) lives.
**Rejected**: separate hotfix changes (blocks C3's e2e on merge round-trips for a few-line fix); leaving the gated e2e red or skipped (ships an unproven tile).
*Introduced by*: 260909-o2sp-gui-surface-tile

#### Chord gate is same-document capture, no steal guard
**Decision**: a capture-phase keydown on the canvas wrapper stops rk chords before noVNC's canvas handler; no `onProgrammaticFocus` seam.
**Why**: the canvas is in rk's own document, so the iframe re-dispatch dance is unnecessary; noVNC only takes focus on click (`focusOnClick`), so there is no load-time grab to guard.
**Rejected**: reusing the iframe contentDocument reclaim (no frame here); disabling noVNC's keyboard entirely (breaks the guest).
*Introduced by*: 260909-o2sp-gui-surface-tile

## Tasks

### Phase 1: Setup

- [x] T001 Add `@novnc/novnc@^1.7.0` to `app/frontend/package.json` dependencies (`pnpm add` in `app/frontend/`, lockfile updated) and create `app/frontend/src/types/novnc.d.ts` declaring module `@novnc/novnc/core/rfb.js` with the RFB class surface used by R10–R12a (constructor `(target: HTMLElement, url: string, options?: {shared?: boolean; credentials?: {password?: string}; wsProtocols?: string[]})`, settable props `scaleViewport`, `clipViewport`, `dragViewport`, `resizeSession`, `qualityLevel`, `compressionLevel`, `showDotCursor`, `viewOnly`, `focusOnClick`, `background`, methods `disconnect()`, `sendCredentials()`, `clipboardPasteFrom()`, `focus()`, and typed `addEventListener`/`removeEventListener` for `connect`/`disconnect`/`credentialsrequired`/`securityfailure`/`clipboard`/`desktopname`); confirm `tsc --noEmit` resolves it. <!-- R10 -->

### Phase 2: Core Implementation

- [x] T002 `app/frontend/src/lib/window-view.ts`: add `"gui"` to `ViewName`, export `GuiHost` + `hasGui(host)`, thread `host?` through `availableViews` (push `gui` when `hasGui`), add `gui` to `HINT_ORDER` after `code`; update the header comment; extend `window-view.test.ts`. <!-- R2 -->
- [x] T003 `app/frontend/src/lib/surface-layout.ts`: `SURFACE_LABEL.gui = "GUI"`, `SURFACE_GLYPH.gui = "[]"`, `SURFACE_KINDS` gains `"gui"`, `availableTiles(win, host?)` pushes `gui` last iff `hasGui(host)`, `degradeLayout`/`effectiveLayout` thread `host?`; extend `surface-layout.test.ts` with R1/R2/R3 scenarios (parse gui strings, availability truth table, off→single:tty / on→restored with no write). <!-- R1 R2 R3 -->
- [x] T004 [P] `app/frontend/src/lib/right-panel.ts`: `availableSurfaces(win, host?)` threads the arg; `app/frontend/src/lib/focus-memory.ts`: `FocusKind` gains `"gui"`; fix every compile site the `Record<SurfaceKind,…>` exhaustiveness now flags (`top-bar.tsx`, `palette/layout.ts`, `tile-chord.ts`, `surface-layout.tsx`, `top-bar-slot-context.tsx`). <!-- R2 R4 -->
- [x] T005 [P] `app/frontend/src/contexts/session-context.tsx`: add `GuiSignal`, `GuiContext`, `applyGui` (raw-string dedup, list narrowing, `id:"host"` selection, type guards — no `as` casts), `case "gui"` in the event switch, the provider value, and `useGui()`; add a `GuiProvider`-style test seam only if the existing code-server test pattern needs one; unit-test the narrowing and dedup. <!-- R5 -->
- [x] T006 [P] `app/frontend/src/lib/keybindings.ts`: register `gui-toggle` on `Digit4` (shifted / macTier cmd, terminal scope, mapLabel `gui`) beside `web-toggle`; extend `keybindings.test.ts` for both tiers and the absence of a Digit4 collision. <!-- R7 -->
- [x] T007 [P] `app/frontend/src/api/client.ts`: add `GuiStatus` type (`id, enabled, backend, reachable, display, width, height, viewers, socket, session, reason, apps:{name,count}[], uptime_seconds`), `fetchGuiStatus(id = "host")` (GET `/api/gui/{id}`) and `restartGui(id = "host")` (POST `/api/gui/{id}/restart`, resolving `{ok:true}` on 200, `{ok:false, disabled:true}` on 409, throwing otherwise) over `deduplicatedFetch`; unit-test in `client.test.ts`. <!-- R10 R13 -->
- [x] T008 `app/frontend/src/lib/palette/gui.ts` (+ `gui.test.ts`): `buildGuiActions(input)` returning the R8 rows with their gates and destination-only pairs; ids `gui-turn-on`, `gui-turn-off`, `gui-fullscreen`, `gui-paste`, `gui-view-fit`, `gui-view-1to1`, `gui-lock`, `gui-unlock`, `gui-logs`, `gui-reconnect`; `gui-toggle` is NOT built here (registry-inherited via `Tile:` rows + `withShortcutHints`). <!-- R8 -->
- [x] T009 `app/frontend/src/components/gui-surface.tsx` (+ `gui-surface.test.tsx` with `vi.mock("@novnc/novnc/core/rfb.js")`): the R10 content states, R11 lifecycle (dot seam, backoff reconnect, 15 s visibility disconnect, unmount cleanup), R12 prop→RFB mapping (`resizeSession` truth table, fit/1:1, quality by pointer, `viewOnly` on screen-sharing, clipboard write, capture-phase chord gate, `onInteract`), R12a credentials field, the empty state's reason fetch (`fetchGuiStatus` once per unreachable transition) and its Restart / Open logs controls; absolute `ws(s)://` URL from `location`; `export default` for `React.lazy`. <!-- R10 R11 R12 R12a -->
- [x] T010 [P] `app/frontend/src/components/gui-off-dialog.tsx` (+ `gui-off-dialog.test.tsx`): R13 copy variants, uptime formatter (`formatUptime(seconds)` exported for tests), loading state while the GET is in flight, Cancel/Turn off (danger) buttons per `server-dialogs.tsx`, confirm ⇒ `postSettings({"gui.enabled": false})` then `onDone()`. <!-- R13 -->
- [x] T011 `app/frontend/src/components/settings-registry-seam.ts`: intercept `commitSetting("gui.enabled", false)` while the current entry value is `true` — call the injected `requestGuiOff()` seam (opens `GuiOffDialog`; resolves `true` on confirm) and only then POST + `updateEntryValue`; cancel resolves without posting so `BoolToggle` snaps back; extend `settings-registry-seam.test.tsx`. <!-- R9 -->

### Phase 3: Integration & Edge Cases

- [x] T012 `app/frontend/src/components/surface-layout.tsx`: `case "gui"` rendering the lazy `GuiSurface` inside `Suspense` (fallback: the same terse monospace `opening…` styling as `code-surface-pending`), new props `gui`, `guiViewMode`, `guiResizeLocked`, `onGuiConnection`, `onGuiRestart`, `onGuiOpenLogs`, `visible` derived from the slot's zoom/mobile visibility, `focused` from the focused slot, `coarsePointer` from the existing coarse/mobile detection helper, `shouldReclaimChord?.("gui")`, `onInteract` recording `gui` focus; thread `host` into every `availableTiles`/`effectiveLayout` call in the file; extend `surface-layout.test.tsx`. <!-- R14 R4 -->
- [x] T013 `app/frontend/src/app.tsx`: `const gui = useGui()`; pass `gui` to every `availableSurfaces`/`effectiveLayout` call (`baseLayout`, the `pendingLayout` overlay, the host-tile filter at ~L2259, `panelSurfaces`); extend `surfaceDot` (`gui` ⇒ connected-or-reachable); wire `"gui-toggle": tileChord("gui")`; `useState` for `guiViewMode`/`guiResizeLocked` seeded from validated localStorage reads (`rk-gui-view`, `rk-gui-lock`) with try/catch-noop writes; fullscreen verb (`requestFullscreen` + `navigator.keyboard.lock`, exit on second call / `fullscreenchange`; zen fallback when absent); `GuiOffDialog` open state shared by the palette row and the settings seam (`requestGuiOff`); `GUI: Open supervisor logs` navigation derived from the `rk-daemon` server's `rk-gui` session (the `system-card.tsx` `activeOrFirstWindow` pattern); assemble `buildGuiActions` into `paletteActions` with the terminal-route gate; pass the new props to `SurfaceLayout`. <!-- R6 R7 R8 R12 R14 -->
- [x] T014 [P] Top bar: verify `SurfaceToggleGroup`, the overflow Tiles rows, and the mobile switch group render the gui button from the registry with no code change beyond the `Record` exhaustiveness fixes in T004; add a `top-bar` unit test asserting the 4th button with glyph `[]` and aria-label `GUI tile` when `available` includes `gui`, and its absence otherwise. <!-- R6 -->
- [x] T015 `app/frontend/tests/e2e/_state-socket-mock.ts`: add a `gui?: unknown` option delivered as the `gui` global on hello (beside `services`/`serverOrder`), plus an exported `emitGui(page/ws, payload)` helper or equivalent so a spec can flip the slot mid-test. <!-- R16 -->
- [x] T016 `app/frontend/tests/e2e/gui-surface.spec.ts`: the R16 ungated half (375 px + 1280 px) and the Xvnc-gated half (`test.skip(!hasXtigervnc, "Xtigervnc not on PATH")`, settings snapshot/restore via `_settings.ts`, cleanup POST `{"gui.enabled": null}`), file header + per-test **Proves:**/**Steps:** JSDoc per the constitution; run via `just pw test gui-surface`. <!-- R16 --> <!-- rework: gated half blocked by the =rk-gui option-target bug; re-run after T019 --> <!-- rework 2: phone-fit assertion races the focused fine-pointer desktop viewer (D7 allows its resize) — settle the payload geometry before sampling `before` or assert the phone context directly; give the retry a clean rk-gui slate -->
- [x] T017 Run the verification gates: `just test-frontend`, `cd app/frontend && npx tsc --noEmit`, `just test-e2e "gui-surface"`, then `just test` (backend unchanged — confirm `go test ./...` still green) and `just build`; fix any failure. <!-- R15 R16 --> <!-- rework: re-run all gates after T019 (Go changed) --> <!-- rework 2: re-run all gates after the T016 test fix -->

### Phase 3b: Backend fix (rework — discovered by T016)

- [x] T019 Go: in `app/backend/internal/daemon/gui.go` change `guiSessionOption`'s `show-options` target from `"="+GUISessionName` to `tmux.ExactSessionTarget(GUISessionName)` (the package already imports `rk/internal/tmux`); in `app/backend/cmd/rk/gui_supervise.go` change the stamp `set-option` target the same way (import `rk/internal/tmux`); leave `kill-session`/`display-message`/`list-panes` targets untouched; add a constraint comment at both sites (tmux 3.7c rejects `=name` for option commands, accepts `=name:` — `board.go` precedent); update `cmd/rk/gui_supervise_test.go` (the two `want` argv slices) and any `internal/daemon/gui_test.go` / `api/sse_gui_test.go` assertion on the option argv; run `cd app/backend && go test ./...`. <!-- R18 -->
- [x] T020 Go: `internal/layoutspec/layoutspec.go` — `"gui"` joins `surfaceKinds` (R19); update `layoutspec_test.go`'s `IsSurface` accepted-kinds list. <!-- R19 --> <!-- rework: discovered by T016 — the gated half's toggle POST 400'd on the gui-bearing layout -->
- [x] T021 Go: `internal/daemon/gui.go` — the rk-gui `new-session` argv pins `-e XDG_STATE_HOME=<daemon env>` with a constraint comment (R20; the `startSession` RK_DAEMON_LOG pin precedent); update the `TestEnsureGUISpawnsSuperviseSession` argv assertion. <!-- R20 --> <!-- rework: discovered by T016 — supervise/probe StateDir fork on env-isolated rigs -->

### Phase 4: Polish

- [x] T018 [P] Docs: correct `docs/specs/gui.md` (diagram keys/routes, header status line), flip `docs/specs/window-views.md` gui row and `docs/specs/surface-layout.md` § Mobile gui rule to `[current]`, drop `[target]` from the `docs/specs/index.md` gui row, and fill the C3 row + header Status paragraph in `fab/plans/sahil/26-09-09-gui-surface.md` (change folder `260909-o2sp-gui-surface-tile`, Status `in review`, PR cell `TBD at ship`); run `fab docs-index --check`. <!-- R17 -->

## Execution Order

- T001 blocks T009 (typings) and T017 (install).
- T002 blocks T003; T003 blocks T004, T012, T013.
- T005, T006, T007, T008, T010 are independent after T003 and block T013.
- T009 blocks T012; T012 blocks T013; T011 blocks T013 (the `requestGuiOff` seam).
- T015 blocks T016; T013 blocks T016; T019–T021 block T016 (the gated half needs the backend fixes); T016 blocks T017.
- T018 can run any time after T001.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `SurfaceKind` includes `gui`; `SURFACE_LABEL.gui === "GUI"`, `SURFACE_GLYPH.gui === "[]"`; `parseLayout("split-h:tty,gui")` parses and `"split-h:gui,gui"` returns null.
- [x] A-002 R2: `availableTiles`/`availableViews`/`availableSurfaces` include `gui` last iff `host?.enabled === true`; `null` host and `reachable`/`backend`/`viewers` never affect the result.
- [x] A-003 R3: `effectiveLayout` degrades `split-h:tty,gui` to `single:tty` when off and restores it when on with no `/options` write.
- [x] A-004 R4: `FocusKind` includes `gui` and canvas interaction records `gui` focus.
- [x] A-005 R5: `useGui()` exposes the narrowed `id:"host"` entry with raw-string dedup; `null` before the first event.
- [x] A-006 R6: the 4th toggle, Tiles row, and switch-group button appear/disappear with the payload's `enabled` and no gui-specific branch exists in `SurfaceToggleGroup`.
- [x] A-007 R7: `gui-toggle` is bound to Digit4 in both tiers and wired through `tileChord("gui")`.
- [x] A-008 R8: every `GUI:` palette row exists with its documented gate; `Tile: Show/Hide/Focus/Switch to GUI` appear via the registry; `gui-toggle` carries its shortcut hint.
- [x] A-009 R9: the settings GUI toggle's off direction opens the confirm; cancel posts nothing and snaps back; on posts directly.
- [x] A-010 R10: reachable ⇒ canvas connected to an absolute `ws(s)://…/ws/gui/host`; unreachable ⇒ empty state with fetched `reason` and Restart/Open-logs controls; `GuiSurface` is lazy-loaded.
- [x] A-011 R11: connect/disconnect drive the dot seam; reconnect backoff 1/2/4/8 s; disconnect after 15 s hidden and reconnect on visible; unmount cleans up.
- [x] A-012 R12: `resizeSession`, `scaleViewport`/`clipViewport`/`dragViewport`, quality levels, `viewOnly`, clipboard write, fullscreen + keyboard lock with zen fallback, and the capture-phase chord gate behave as specified.
- [x] A-013 R12a: the credentials field appears on `credentialsrequired`, submits via `sendCredentials`, stores nothing, and handles Escape and `securityfailure`.
- [x] A-014 R13: the off-confirm renders the four copy variants from `GET /api/gui/host` and confirm posts exactly `{"gui.enabled": false}`.
- [x] A-015 R14: `app.tsx`/`surface-layout.tsx` thread the host signal everywhere `availableTiles`/`effectiveLayout` are called; new props carried; hide-never-unmount preserved.
- [x] A-036 R18: `set-option`/`show-options` against the rk-gui session use `=rk-gui:`; the argv tests assert it; on this host the stream reports `reachable:true` after `rk gui on`.
- [x] A-037 R19: `layoutspec.Parse("split-h:tty,gui")` succeeds and `Parse("split-h:gui,gui")` fails; the `/options` POST accepts a gui-bearing layout.
- [x] A-038 R20: the rk-gui spawn argv carries `-e XDG_STATE_HOME=<daemon env>`; on an env-isolated rig the stream reports `reachable:true`.
- [x] A-016 R17: spec diagram/routes corrected, status tags flipped, plan C3 row filled; `fab docs-index --check` passes.

### Behavioral Correctness

- [x] A-017 R2: a host with Xvnc installed but the switch off shows no button anywhere (never-on-by-default at the UI).
- [x] A-018 R12: a coarse-pointer viewer never sets `resizeSession` regardless of focus or lock.
- [x] A-019 R13: turning off from the dialog or palette never calls a kill route directly — only the settings POST.

### Scenario Coverage

- [x] A-020 R16: the ungated e2e half proves off ⇒ no button / no row / ⌘4 inert / degraded layout, and on ⇒ button without reload + empty state, at 375 px and 1280 px.
- [x] A-021 R16: the Xvnc-gated e2e half proves the live canvas, zen zoom, phone fit without a `width/height` change, the off-confirm app list, degrade, and restore; it skips cleanly with a reason where `Xtigervnc` is absent. — MET at re-review (cycle 1): `just test-e2e "gui-surface"` ran the gated half on this host (Xtigervnc present) twice, exit 0, 4 passed both times. The race fix disarms the desktop viewer (focuses the tty tile, spec:414) and samples via `stableGuiGeometry` (two equal reads ≥1 s apart, spec:294); the retry clean-slate guard unsets the key and waits for the session to disappear first (spec:381-382).
- [x] A-022 R15: Vitest suites exist for every requirement listed in R15 and pass under `just test-frontend`.

### Edge Cases & Error Handling

- [x] A-023 R10: a 409 from the restart POST renders `gui turned off` instead of an error toast; a failed reason GET leaves the empty state without a reason line (no throw).
- [x] A-024 R11: `reachable` flipping false mid-backoff clears the reconnect timer and renders the empty state.
- [x] A-025 R12a: Escape on the credentials field disconnects and shows the empty state with `Screen Sharing password required`.
- [x] A-026 R5: a malformed `gui` payload (non-list, missing fields) narrows to safe defaults and never throws.

### Code Quality

- [x] A-027 Pattern consistency: new modules follow the pure-helper + colocated-test pattern (`lib/`), the `CodeSurface` seam grammar (`components/`), and the `server-dialogs.tsx` dialog grammar.
- [x] A-028 No unnecessary duplication: `deduplicatedFetch`, `postSettings`, `isMobileViewport`/coarse detection, `hasReclaimableMatch`, `tileChordHandler`, `resolveZenToggle`, and `activeOrFirstWindow`-style derivation are reused, not re-implemented.
- [x] A-029 Type narrowing over assertions: no `as` casts on the payload or localStorage read paths.
- [x] A-030 No client polling: reachability and enablement come from the state socket; the status GET fires only on transitions/opens.
- [x] A-031 Comments state constraints, not narration; no change IDs or PR numbers in code comments.
- [x] A-032 Every Playwright `test()` carries **Proves:**/**Steps:** JSDoc and the spec file has a shared-setup header.
- [x] A-033 Tests cover added behavior (constitution Test Integrity); no implementation change exists solely to satisfy a fixture.

### Security

- [x] A-034 R12a: the Screen Sharing password is never persisted (no localStorage/sessionStorage key, no network body other than the RFB frames) and is cleared on unmount.
- [x] A-035 R10: the WS URL is composed from `location.protocol`/`location.host` only — no user-controlled input reaches the URL.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Run tests through `just` recipes only (`just test-frontend`, `just pw test gui-surface`, `just test-e2e "gui-surface"`, `just test`, `just build`) — never bare `pnpm test` / `playwright test`.

## Deletion Candidates

- None — re-evaluated at re-review (cycle 1): the change adds a new surface kind (registry entries, the `GuiSurface` renderer, the `GUI:` palette family, the off-confirm, the `gui-posture` and `gui-off-context` seams) without making existing code redundant. The `toggleTarget`/`toggleShortcut` pair in `lib/palette/layout.ts` stays in use (the code-toggle call site in `app.tsx`) alongside the generalized `toggleHints`; `lib/format.ts`'s `formatDuration` ("4h") does not cover the off-confirm's "4h 12m" contract, so `formatGuiUptime` is not a duplicate.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Requirements derive verbatim from the intake's What Changes and the three asked picks (`[]`, in-memory macOS prompt, viewer-local lock) | Intake scored 4.8; picks confirmed by the user | S:100 R:90 A:100 D:100 |
| 2 | Confident | `GuiSurface` uses `export default` + `React.lazy` with a `Suspense` fallback styled like `code-surface-pending` | Bundle asymmetry; the pending style already exists | S:70 R:90 A:85 D:85 |
| 3 | Confident | The plan's C3 PR cell reads `TBD at ship` in apply and is filled by the ship/hydrate stage | The PR URL does not exist at apply time | S:75 R:95 A:90 D:90 |
| 4 | Confident | `restartGui` maps 409 to `{ok:false, disabled:true}` rather than throwing | The empty state needs to render `gui turned off`, not toast | S:70 R:90 A:85 D:85 |
| 5 | Confident | `emitGui`-style mid-test slot flip is added to the state-socket mock | The ungated e2e needs an off→on flip without reload | S:70 R:90 A:85 D:80 |
| 6 | Tentative | The supervisor-logs navigation target is the `rk-gui` session's `host` window on the `rk-daemon` server as exposed in the sessions payload; if the frontend does not list that server's sessions the row disables with `supervisor not running` | The system card finds `rk-code-server` the same way, so the payload most likely carries `rk-gui` too | S:55 R:85 A:60 D:60 |

6 assumptions (1 certain, 4 confident, 1 tentative).
