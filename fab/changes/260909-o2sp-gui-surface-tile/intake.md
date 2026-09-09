# Intake: GUI Surface Tile (plan C3 — frontend)

**Change**: 260909-o2sp-gui-surface-tile
**Created**: 2026-09-09

## Origin

One-shot `/fab-new` invocation carrying the plan pointer and the pickup protocol:

> gui-surface-tile Plan: fab/plans/sahil/26-09-09-gui-surface.md -- implement C3 (frontend: the tile) per the plan's change breakdown and pickup protocol. C2 (260909-fkh1-gui-backend-switch-and-relay, PR #892) merged -- the backend switch, supervisor, relay, and gui: state payload now exist on main. Before starting, read the plan file in full (including the C0 verdict), docs/specs/gui.md (created by C1), docs/specs/window-views.md, docs/specs/surface-layout.md, fab/project/constitution.md, and the lenses-and-layout, configuration, daemon-lifecycle memory files, plus internal/gui and api/gui_ws.go and api/sse.go on main to see C2's actual shipped shapes (field names, the gui: payload schema) rather than assuming the plan's draft names are exact. Treat the plan's Decision log (D1-D10) as Certain in SRAD scoring -- spend clarification effort on the plan's named per-change picks (e.g. the SURFACE_GLYPH placeholder). Note: a prior C2 worker flagged a payload field-name mismatch between the plan draft and the shipped Go -- check for that carefully. After merge, fill in the C3 row (change folder / PR) in the plan's tracking table in the same PR.

**Authority chain**: the plan's Decision log D1–D10 (Certain, not re-opened here) → `docs/specs/gui.md` → `docs/specs/window-views.md` (View Registry `gui` row, R3 host-singleton clause, R6 dot) → `docs/specs/surface-layout.md` (one tile per kind, § Mobile coarse-pointer rule). Design study: `docs/wiki/gui-surface-design-study.html`.

**Shipped-shape audit (the mismatch the C2 worker flagged)** — read from `app/backend/internal/gui/status.go`, `api/sse.go`, `api/gui.go`, `api/gui_ws.go`, `api/router.go` on main after PR #892:

| Where | Draft/spec text | Shipped Go (authoritative for C3) |
|-------|-----------------|-----------------------------------|
| `docs/specs/gui.md` substrate diagram | `gui[{id:"host", available, reachable, display, size}]` | `event: gui` data = `[]gui.StreamEntry` → `[{"id":"host","enabled":true,"backend":"Xtigervnc","reachable":true,"display":":10","width":1920,"height":1080,"viewers":1}]` — the key is **`enabled`** (not `available`), geometry is **`width`/`height`** (not `size`), and `backend`/`viewers` exist |
| `docs/specs/gui.md` diagram | `POST /api/gui/start\|stop\|resize` | **`GET /api/gui/{id}`** (the `gui.Status` document: `id, enabled, backend, reachable, display, width, height, viewers, socket, session, reason, apps[{name,count}], uptime_seconds`) and **`POST /api/gui/{id}/restart`** (`409 {"error":"gui disabled"}` when off, `200 {"status":"ok"}`). On/off is **`POST /api/settings` with `{"gui.enabled": true\|false}`** — the settings-POST side effect ensures/kills the session and flips the stream within one event. There is no start/stop/resize route; resize is RFB SetDesktopSize over the relay |
| plan C3 text | "confirm dialog listing running apps — from `gui[0]` payload fields" | the stream payload carries **no apps**; the apps list + uptime come from `GET /api/gui/host` (`apps`, `uptime_seconds`) — the same document `rk gui status --json` prints |
| plan C3 text | "install hint from payload" | the stream payload carries **no `reason`**; the not-running reason (`no VNC backend: sudo apt install tigervnc-standalone-server openbox`, `<bin> exited — see the rk-gui pane; 'rk gui restart'`, `rk-gui session absent…`, `Screen Sharing is off: …`) is the `reason` field of `GET /api/gui/host` |
| relay | `/ws/gui/{id}` | `GET /ws/gui/{id}` — binary frames only; gate failures arrive as WS close codes **4400** `invalid gui id`, **4403** `gui disabled`, **4404** `gui not running: <reason>`; text frames ignored; on macOS (`backend: screen-sharing`, tcp) the relay drops client KeyEvent/PointerEvent after the handshake (view-only) |
| state delivery | SSE | the `/ws/state` socket: `hubEvent{kind: kindGlobal, typ: "gui"}` broadcast every poll tick (raw-payload dedup client-side) and replayed to late joiners from `cachedGuiJSON` beside `code-server` |

Everything below keys off the shipped column. The spec diagram is corrected in this change (§ Spec/plan bookkeeping).

## Why

C2 made the backend real: `rk gui on` yields a live RFB socket behind `/ws/gui/host`, and every tab's state socket already carries `event: gui` with `enabled`/`reachable`. Nothing renders it. A user who turns the GUI on today sees no fourth toggle, no tile, no way to watch or drive the desktop from a phone or a laptop — the whole point of the surface (plan Goal). C4 (agent verbs) can ship in parallel, but C5 (measure) is gated on C3: D9's smoothness targets are measured *through this tile*, so until it exists the KasmVNC decision (C6) cannot be made with numbers.

Why a `gui` surface kind in the existing layout registry rather than a page or a special-cased tile: `window-views.md` R1 ("a new projection adds a row, a capability signal, and a renderer — not a window type, a name convention, or a route") and Constitution IV (fixed route set). The tile rides `@rk_win_layout` like `code`/`web`, so every layout verb, the ▦ chip, zen, the mobile switch group, and the palette `Tile:` family work on day one with zero new state — the only new state anywhere is the per-viewer render posture (fit/1:1, lock) in localStorage, exactly where `surface-layout.md` § State puts postures.

Why stock noVNC on a bare `<canvas>` (D4) and not an iframe of `vnc.html`: the library gives rk the focus/chord seams the code tile already fought for (steal guard, chord reclaim) without a cross-document boundary, `resizeSession` is a one-line D7 decision, and the C0 verdict confirmed noVNC 1.7's `vnc.html` UI cannot hide its control bar in an iframe.

## What Changes

All paths under `app/frontend/` unless noted. C3 is **frontend-only** — no Go changes except the spec-text corrections and the plan table row.

### 1. Registry: `gui` becomes a surface kind

- `src/lib/window-view.ts`: `ViewName = "tty" | "web" | "code" | "gui"`. `ViewWindow` is unchanged (gui availability is per-HOST, not per-window). Add the capability helper:
  ```ts
  /** The host-global gui signal the availability helpers consult. Absent/null
   *  ⇒ no signal yet ⇒ NOT available (never on by default — D3). */
  export type GuiHost = { enabled: boolean } | null | undefined;
  export function hasGui(host: GuiHost): boolean { return host?.enabled === true; }
  ```
  `availableViews(win, host?)` gains the optional second arg and pushes `gui` when `hasGui(host)`; `HINT_ORDER` gains `gui` after `code`.
- `src/lib/surface-layout.ts`:
  - `SURFACE_LABEL.gui = "GUI"`; `SURFACE_GLYPH.gui = "[]"` (picked with the user — the 2-char ASCII window frame, matching `>_` / `://` / `{}`; the plan's `▣` placeholder is retired); `SURFACE_KINDS` gains `"gui"` (so `parseLayout("split-h:tty,gui")` parses).
  - `availableTiles(win, host?: GuiHost)` — order stays the shortcut order: `tty`, `code`, `web`, then **`gui` iff `hasGui(host)`** (⌘4 last). Reachability is NOT availability (the `code` split).
  - `degradeLayout(layout, win, host?)` / `effectiveLayout(win, host?)` thread the host arg. With the switch off, `split-h:tty,gui` degrades to `single:tty` and the `@rk_win_layout` option is left as written; when the payload flips `enabled:true` the same option renders the gui tile again — no write on either transition (spec § The switch).
- `src/lib/right-panel.ts`: `availableSurfaces(win, host?)` threads the arg (it delegates to `availableTiles`).
- `src/lib/focus-memory.ts`: `FocusKind` gains `"gui"` (the tile is a focus owner like `code`).
- Every `availableTiles`/`effectiveLayout`/`availableSurfaces` call site in `src/app.tsx`, `src/components/surface-layout.tsx`, `src/components/top-bar.tsx`, `src/lib/tile-chord.ts`, `src/lib/palette/layout.ts` passes the gui signal (the compiler enumerates them via the `Record<SurfaceKind, …>` exhaustiveness and the new required-by-shape branches).

### 2. State: the `gui` signal context

`src/contexts/session-context.tsx`, mirroring the `code-server` slot exactly:

```ts
/** One entry of the host-global `event: gui` payload (C2's gui.StreamEntry). */
export type GuiSignal = {
  id: string; enabled: boolean; backend: string; reachable: boolean;
  display: string; width: number; height: number; viewers: number;
};
const GuiContext = createContext<GuiSignal | null | undefined>(undefined);
export function useGui(): GuiSignal | null  // null = no event yet ⇒ treated as disabled
```

- `case "gui"`: the data is a **list**; take the entry with `id === "host"` (fall back to `[0]`); narrow each field with type guards (no `as` casts on the payload path — code-quality rule); same raw-string dedup as `applyCodeServer` so the every-tick repetition does not re-render consumers.
- `null` (no event yet) means **not available** — the opposite of `useCodeServer`'s null semantics, because D3 says never-on-by-default and a late `gui` replay must not flash a button.

### 3. Top bar, chords, palette, settings

- **Toggle group** (`src/components/top-bar.tsx` `SurfaceToggleGroup`): no gui-specific code — the group is registry-driven; the 4th button appears iff `gui ∈ availableTiles(...)`. The `showDot` predicate in `app.tsx` returns `gui.reachable` for `gui` (R6: the dot is VNC health; web = has content; others always-on). Overflow-menu **Tiles** row and the mobile **switch group** inherit.
- **Chord** (`src/lib/keybindings.ts`): `{ actionId: "gui-toggle", code: "Digit4", tier: "shifted", macTier: "cmd", scope: "terminal", kind: "builtin", label: "Toggle GUI", description: "open/close the GUI tile", mapLabel: "gui", ignoreInputs: true }` — the same tiers as 1–3 (Digit4 is unbound today). `app.tsx` wires `"gui-toggle": tileChord("gui")`; a window route with the switch off mounts no handler and the chord falls through untouched (the existing `availableTiles` gate in `tileChord`).
- **Palette** (`src/lib/palette/layout.ts` inherits `Tile: Show/Hide/Focus/Switch to GUI` from the registry; new `src/lib/palette/gui.ts` builds the `GUI:` family, all gated on the terminal route):

  | Entry | Gate | Body |
  |-------|------|------|
  | `GUI: Turn on` | `!enabled` | `POST /api/settings {"gui.enabled": true}` (via the settings client in `src/api/client.ts`) |
  | `GUI: Turn off` | `enabled` | opens the **off-confirm** (§ 5), which POSTs `{"gui.enabled": false}` on confirm |
  | `GUI: Fullscreen` | gui tile open | § 4 fullscreen verb |
  | `GUI: Paste clipboard` | gui tile open + connected | `navigator.clipboard.readText()` → `rfb.clipboardPasteFrom(text)` (user gesture — palette selection) |
  | `GUI: Fit` / `GUI: 1:1` | gui tile open | toggles the per-viewer view mode (§ 4) — the entry shows the destination, never the current mode |
  | `GUI: Lock resolution` / `GUI: Unlock resolution` | gui tile open, fine pointer | toggles the **viewer-local** resize lock (§ 4): localStorage `rk-gui-lock` (`"1"` = locked; absent = unlocked), read through the same try/catch-noop wrappers as `rk-gui-view`. Locked ⇒ this viewer never sets `resizeSession`. A second fine-pointer viewer can still resize — the documented v1 limit (a shared lock would need a backend key; deferred) |
  | `GUI: Open supervisor logs` | `enabled` | navigates to the `rk-gui` session's `host` window on the `rk-daemon` server (`/rk-daemon/<@N>`) — derived from the sessions payload the way `system-card.tsx` finds `rk-code-server`; disabled with tooltip "supervisor not running" when the session is absent |
  | `GUI: Reconnect` | gui tile open, disconnected | drops and re-dials the RFB connection |

  Every keyboard-reachable action above is also a palette row (Constitution V). `withShortcutHints` decorates `gui-toggle` from the registry actionId like the other tile chords.
- **Settings dialog** (`src/components/settings-all-panel.tsx` / `settings-registry-seam.ts`): the `gui.enabled` row is already rendered by the registry (`BoolToggle`). Add one interception in the seam's `commitSetting`: key `gui.enabled` with value `false` while the current value is `true` routes through the off-confirm (§ 5) before committing; every other key/value is untouched. The on direction commits directly.

### 4. `src/components/gui-surface.tsx` — the renderer (peer of `code-surface.tsx`)

Dependency: `@novnc/novnc@^1.7.0` (MPL-2.0; `exports: ./core/rfb.js`, **no bundled `.d.ts`**). Add `src/types/novnc.d.ts` declaring the `@novnc/novnc/core/rfb.js` default export with exactly the members used (constructor `(target, url, {shared, credentials?, wsProtocols?})`, `scaleViewport`, `clipViewport`, `resizeSession`, `qualityLevel`, `compressionLevel`, `showDotCursor`, `viewOnly`, `focusOnClick`, `background`, `clipboardPasteFrom`, `sendCredentials`, `disconnect`, `addEventListener`/`removeEventListener` for `connect`/`disconnect`/`credentialsrequired`/`clipboard`/`desktopname`/`securityfailure`, `_fbWidth`-free: read geometry from the payload, never noVNC internals). Risk 8 (typings re-derive) is this file.

Props (mirroring the `CodeSurface` seam grammar so `surface-layout.tsx`'s `case "gui"` reads like `case "code"`):

```ts
interface GuiSurfaceProps {
  gui: GuiSignal | null;                 // the host signal (enabled/reachable/width/height/backend)
  visible: boolean;                      // tile displayed (not zoomed away / document not hidden)
  focused: boolean;                      // this tile owns focus (focusedTileKind === "gui")
  coarsePointer: boolean;                // isMobileViewport()-style coarse detection
  viewMode: "fit" | "1:1";               // per-viewer posture (localStorage `rk-gui-view`)
  resizeLocked: boolean;                 // viewer-local lock (localStorage `rk-gui-lock`)
  onConnectionChange: (connected: boolean) => void;   // R6 dot
  onInteract?: () => void;               // tile focus seam (pointerdown/keydown on the canvas wrapper)
  shouldReclaimChord?: (e: KeyboardEvent) => boolean;  // registry predicate bound to kind "gui"
  onRestart: () => Promise<void>;        // POST /api/gui/host/restart
  onOpenLogs: () => void;
}
```

Content states (spec § Availability vs reachability):

| State | Render |
|-------|--------|
| `enabled && reachable` | the `<canvas>` host `<div>` with an `RFB` connected to `ws(s)://<origin>/ws/gui/host` (explicit absolute WS URL built from `location` — C0 finding 5: never a relative `path=`); `data-testid="gui-surface-canvas"` |
| `enabled && !reachable` | empty state `data-testid="gui-surface-empty"`: `GUI is on but not running` + the `reason` line fetched from `GET /api/gui/host` once per unreachable transition (not polled — the stream drives re-fetch) + two boxed controls **Restart supervisor** (`POST /api/gui/host/restart`; a 409 re-renders as "gui turned off") and **Open supervisor logs**; when `reason` names a missing backend the install hint line is the reason text verbatim |
| connected then RFB `disconnect` | while `reachable` still true: the canvas stays mounted, an overlay `disconnected — reconnecting…` and one automatic re-dial after 1 s, then 2 s, 4 s (cap 8 s, reset on `connect`); the `GUI: Reconnect` palette row is the manual path. When `reachable` flips false the empty state takes over |
| `!enabled` | never rendered — degradation removed the tile |

Behavior:

- **D7 resize policy**: `rfb.resizeSession = !coarsePointer && focused && !resizeLocked` — recomputed on every prop change (noVNC applies the setter live, sending SetDesktopSize on the next size change). Coarse pointers never set it (assertable: no SetDesktopSize leaves the phone — the payload's `width/height` stay at the desktop viewer's size). `rfb.scaleViewport = viewMode === "fit"`; `rfb.clipViewport = viewMode === "1:1"` (`dragViewport = true` in 1:1 so touch-drag pans). Only the **focused** fine-pointer viewer drives resize, so the "last-focused" viewer wins by construction (the previous one loses `focused` when it blurs).
- **Quality**: fine `qualityLevel 6 / compressionLevel 2` (noVNC defaults); coarse `qualityLevel 4 / compressionLevel 6`. `showDotCursor = true`; `background = ""` (the tile's own bg). HiDPI 1×: noVNC sizes the canvas in CSS px by default — no `devicePixelRatio` scaling is applied (D7).
- **Visibility**: when `visible` is false (zoomed-away tile, or `document.visibilityState === "hidden"`) for longer than 15 s, `disconnect()`; reconnect on the next `visible` true. This is "stop framebuffer requests when hidden" without touching noVNC internals, and it releases the relay's `viewers` count so the probe resumes. Focus alone never disconnects.
- **Focus/chords**: the canvas wrapper carries a capture-phase `keydown` listener that, for a registry chord (`shouldReclaimChord` — the `hasReclaimableMatch(e, bindings, "gui")` binding built in `app.tsx`), calls `stopPropagation()` so noVNC's keyboard handler (attached to the canvas) never sees it, then lets the document-level dispatcher handle it naturally (same document — no re-dispatch needed unlike the iframe tiles). Everything else reaches the guest. ⌘K, ⌘1–⌘4, ⌘;, and the zen chord stay rk's. `focusOnClick = true`; pointerdown/keydown fire `onInteract` (tile-focus seam). No steal guard is needed: noVNC never grabs focus programmatically (`focusOnClick` is a click response), so `onProgrammaticFocus` is not wired — recorded so the reviewer does not ask.
- **Clipboard**: RFB `clipboard` event → `navigator.clipboard.writeText(text)` best-effort (silently skipped without permission); paste is palette-only (§ 3) because `readText` needs a user gesture.
- **Fullscreen verb**: `tileEl.requestFullscreen()` on the tile wrapper + `navigator.keyboard?.lock()` when present (Chrome desktop — the deliberate "all keys to the guest" mode), `unlock()` + `exitFullscreen()` on the second invocation or `fullscreenchange` exit. Where `requestFullscreen` is absent (iPhone Safari), the verb runs the existing zen toggle (`resolveZenToggle`) instead, and the empty-state/tile-header tooltip of the fullscreen control reads "Fullscreen (falls back to zen on this device)" — a tooltip, never a modal.
- **macOS credentials** (`backend === "screen-sharing"`): noVNC negotiates ARD (type 30) and fires `credentialsrequired`. The tile renders an **inline password field** over the canvas (`data-testid="gui-surface-credentials"`: label `Screen Sharing password`, a `type="password"` input, Enter or a **Connect** button ⇒ `rfb.sendCredentials({ password })`; Escape cancels ⇒ disconnect and show the empty state with `reason` "Screen Sharing password required"). The password lives **only in component state** — never localStorage/sessionStorage, never a POST — and is re-asked on every reconnect (the user's pick; a server-side Keychain injection per D6 is a backend follow-up, not C3). A `securityfailure` event after submit re-shows the field with `Wrong password — try again`. The relay already enforces view-only; the tile additionally sets `viewOnly = true` when `backend === "screen-sharing"` so the cursor does not pretend.
- **Dot**: `onConnectionChange(true)` on `connect`, `false` on `disconnect` — the top-bar toggle dot and the tile header's status use it (R6).

Wiring: `surface-layout.tsx` gains `case "gui"` rendering `<GuiSurface …/>`, and new props (`gui`, `guiViewMode`, `guiResizeLocked`, `onGuiConnection`, `onGuiRestart`, `onGuiOpenLogs`) carried from `app.tsx` the way `codeReachable`/`codeWorkspaceSrc` are. Tile hide-never-unmount is preserved (`visible` is a prop, not a mount gate). The tile header verb cluster gains no new buttons — the GUI verbs are palette entries (the surface-layout § Verbs amendment: palette-reachable, one cycle chord).

### 5. The off-confirm

One dialog component (`src/components/gui-off-dialog.tsx`, the `server-dialogs.tsx` danger-confirm grammar), opened by the palette `GUI: Turn off` and by the settings-dialog interception. On open it fetches `GET /api/gui/host` and renders — copy mirrors the shipped CLI confirm byte-for-byte in structure:

```
Turn the GUI off?

Turning the GUI off kills the rk-gui session and every app on display :10:
  chromium ×3, xterm ×1  (up 4h 12m)

[Cancel]  [Turn off]
```

- `apps` empty ⇒ the second block reads `No apps are running on display :10.`; `display` empty (never ran) ⇒ `…kills the rk-gui session.`; macOS ⇒ `Turning the GUI off stops the Screen Sharing mirror; nothing on your Mac is closed.`
- Confirm ⇒ `POST /api/settings {"gui.enabled": false}` → the stream flips `enabled:false` within one event → every tab's button disappears and open gui tiles degrade (option untouched). The dialog never kills anything itself (Constitution IX: the settings POST is the one mutation; the server does the kill).
- Uptime formats `uptime_seconds` as `up 4h 12m` / `up 3m` / `up 12s`.

### 6. Tests

- **Vitest** (colocated): `surface-layout.test.ts` — `availableTiles`/`degradeLayout`/`effectiveLayout` against `{enabled:true|false}` hosts incl. the off→on restore with the option untouched and `parseLayout` of gui-bearing strings; `window-view.test.ts` — `hasGui`, `availableViews` order; `session-context` — the `gui` case narrows the list payload, picks `id:"host"`, dedups; `palette/gui.test.ts` — gating of every `GUI:` row (off/on/open/connected/coarse) and the destination-only Fit/1:1 + Lock/Unlock pairs; `gui-surface.test.tsx` with `vi.mock("@novnc/novnc/core/rfb.js")` — content states, `resizeSession` truth table (fine+focused+unlocked ⇒ true; coarse ⇒ always false; locked ⇒ false), quality by pointer, visibility disconnect/reconnect timers, reconnect backoff, chord capture gating, `credentialsrequired` handling; `gui-off-dialog.test.tsx` — copy variants and the POST body; `keybindings.test.ts` — `gui-toggle` on Digit4 in both tiers; `settings-registry-seam.test.tsx` — the `gui.enabled` false interception.
- **Playwright** (`tests/e2e/gui-surface.spec.ts`, intent comments per constitution): (a) **ungated**, over `_state-socket-mock.ts`: with `gui` event `[{…enabled:false…}]` no 4th button, no Tiles menu row, ⌘4 inert, and a window whose `@rk_win_layout` is `split-h:tty,gui` renders `single:tty`; flip the mocked event to `enabled:true, reachable:false` ⇒ the button appears without reload, the tile opens to `gui-surface-empty`; 375 px and 1280 px viewports. (b) **capability-gated** on `Xtigervnc` on PATH (`test.skip` with the reason otherwise; CI lacks it — Risk 7): on the real rig, `POST /api/settings {"gui.enabled":true}` ⇒ button within one state event ⇒ toggle opens a live canvas (`gui-surface-canvas` present, RFB `connect` observed via the dot) ⇒ zen zooms it ⇒ the phone viewport (coarse emulation) fits the canvas without the payload `width/height` changing ⇒ palette `GUI: Turn off` shows the confirm listing apps ⇒ confirm removes the button and degrades the layout ⇒ `GUI: Turn on` restores the same layout. Settings file snapshot/restore via `_settings.ts`. The gated spec cleans up with `POST /api/settings {"gui.enabled": null}`.
- Playwright perf sampling is **not** this change (C5).

### 7. Spec/plan bookkeeping (same PR)

- `docs/specs/gui.md`: correct the substrate diagram to the shipped payload keys (`enabled`, `width`, `height`, `backend`, `viewers`) and routes (`GET /api/gui/{id}`, `POST /api/gui/{id}/restart`, on/off via `POST /api/settings`); drop the "**[target]** throughout: nothing shipped yet" header line in favor of a status line naming C2 and C3 as shipped; leave § Agent verbs / § Smoothness targets marked target.
- `docs/specs/window-views.md`: View Registry `gui` row status `[target]` → `[current]` naming this change; `docs/specs/surface-layout.md` § Mobile gui rule `[target]` → `[current]`.
- `fab/plans/sahil/26-09-09-gui-surface.md`: fill the C3 row (change folder, PR URL, Status) and update the header **Status** paragraph; mark Done on merge.
- `docs/specs/index.md` row for `gui.md` loses the `[target]` tag.

### Non-goals (D10 + plan scope)

Audio, multi-monitor, per-session displays, Wayland, macOS "take control", the macOS virtual-display backend, board pins of `(window, gui)`, the KasmVNC iframe variant (C6), perf measurement (C5), `rk gui exec|shot` (C4), a `gui` row in the Host page's system card (not in the plan's C3 scope — noted as a natural follow-up), server-side Keychain credential injection for macOS (backend; see Assumptions #2).

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) the `gui` renderer (`GuiSurface`), the 4-kind registry (`availableTiles(win, host)`), the off→on degradation/restore, the `gui` dot semantics, the `event: gui` context, `SURFACE_GLYPH`/`SURFACE_LABEL` rows, e2e `gui-surface.spec.ts`
- `run-kit/ui/keyboard-and-palette`: (modify) the `gui-toggle` ⌘4/⇧Ctrl+4 stateful chord, the `GUI:` palette family and its gating, the fullscreen verb + keyboard lock
- `run-kit/ui/focus-ownership`: (modify) `FocusKind` gains `gui`; the canvas capture-phase chord gate (no steal guard needed — noVNC never grabs focus)
- `run-kit/ui/dialogs-and-state`: (modify) the GUI off-confirm dialog, the settings-seam `gui.enabled` interception, the per-viewer `rk-gui-view` / lock keys
- `run-kit/gui`: (modify) the Overview's "frontend tile not yet shipped" note becomes a pointer to the ui files; the shipped-vs-spec payload note
- `run-kit/architecture`: (modify) frontend dependency list gains `@novnc/novnc` (+ the local `novnc.d.ts` typings rule)

## Impact

- **Frontend**: `src/lib/{window-view,surface-layout,right-panel,focus-memory,keybindings,tile-chord}.ts`, `src/lib/palette/{layout,gui}.ts`, `src/contexts/session-context.tsx`, `src/components/{surface-layout,top-bar,settings-registry-seam,settings-all-panel}.tsx`, new `src/components/{gui-surface,gui-off-dialog}.tsx`, new `src/types/novnc.d.ts`, `src/app.tsx` (signal plumbing, `showDot`, `tileChord("gui")`, palette assembly, fullscreen/zen fallback), `src/api/client.ts` (`fetchGuiStatus`, `restartGui`). New dependency `@novnc/novnc` (MPL-2.0 — file-level copyleft, compatible with bundling; no other MPL dep exists today, so the license note lands in the memory hydrate). Bundle: noVNC core ≈ 150 KB min — load `GuiSurface` via `React.lazy` so tabs that never open a gui tile pay nothing.
- **Backend**: none (C2 shipped every seam). If apply finds a needed backend seam it is a plan-visible task, not a silent addition.
- **Docs**: `docs/specs/{gui,window-views,surface-layout,index}.md`, the plan tracking table.
- **Tests**: Vitest suites above; one new Playwright spec (ungated + Xvnc-gated halves). `just test-e2e` on this VM has `Xtigervnc`/`openbox` installed so the gated half runs here; CI skips it cleanly.
- **Constitution**: IV (no routes, no settings surface — the registry row rides the one dialog), V (every verb palette-reachable; ⌘4 a chord with the button as mirror), IX (all mutations are the existing POSTs), II/X (nothing stored but viewer postures in localStorage).

## Open Questions

None — the three per-change picks (glyph, macOS credentials, lock scope) were asked at intake and are recorded as Certain rows 1–3 below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `SURFACE_GLYPH.gui = "[]"` — the 2-char ASCII window frame; the plan's `▣` placeholder is retired | Asked — user chose `[]` over `▣` / `⊞` / `⧉` (matches the `>_` / `://` / `{}` grammar, one cell in every monospace font) | S:100 R:95 A:100 D:100 |
| 2 | Certain | macOS `credentialsrequired` ⇒ inline password field in the tile, `sendCredentials`, held in component state only, re-asked per reconnect; no storage, no POST; server-side Keychain injection (D6) stays a backend follow-up | Asked — user chose "inline prompt, memory only" over sessionStorage and over unsupported-in-C3 | S:100 R:85 A:100 D:100 |
| 3 | Certain | `GUI: Lock resolution` is viewer-local (localStorage `rk-gui-lock`); a second fine-pointer viewer can still resize — documented v1 limit; no backend key | Asked — user chose viewer-local over a shared `gui.lock_resolution` settings key and over deferring the verb | S:100 R:90 A:100 D:100 |
| 4 | Certain | D1–D10 of the plan are binding (name `gui`, host singleton, `gui.enabled` switch, RFB+noVNC canvas, Xvnc Linux/Screen Sharing macOS, D7 resize policy, R3 supervisor-logs verb, D9 measured after C3, D10 out of scope) | Instructed: treat the decision log as Certain | S:100 R:90 A:100 D:100 |
| 5 | Certain | Availability keys off the shipped payload's `enabled` (not `available`); geometry is `width`/`height`; apps/reason/uptime come from `GET /api/gui/host`; on/off is `POST /api/settings {"gui.enabled"}`; restart is `POST /api/gui/host/restart` | Read from main after PR #892 (`internal/gui/status.go`, `api/gui.go`, `api/router.go`, memory `run-kit/gui`) | S:100 R:85 A:100 D:100 |
| 6 | Certain | `null` gui signal (no event yet) ⇒ not available | D3 never-on-by-default; a late replay must not flash a button | S:90 R:90 A:95 D:95 |
| 7 | Certain | `gui-toggle` on `Digit4`, `shifted`/`macTier: cmd`, scope `terminal`, `mapLabel: "gui"`; `gui` is 4th in shortcut order | Plan C3 scope; Digit4 unbound in the registry today; `availableTiles` order = digit order | S:95 R:90 A:100 D:100 |
| 8 | Certain | Registry-driven: the 4th button, Tiles menu row, mobile switch group, and `Tile:` palette rows need no gui-specific code | `SurfaceToggleGroup` and `buildTile*Actions` iterate `availableTiles` | S:95 R:95 A:100 D:100 |
| 9 | Confident | `availableTiles(win, host?)` gains an optional host arg (with `hasGui(host)` in `window-view.ts`) rather than a global store read | Keeps the pure-module + colocated-test pattern; `ViewWindow` stays per-window; plan names `hasGui(win, guiState)` | S:80 R:85 A:85 D:80 |
| 10 | Confident | Off-confirm copy mirrors the shipped CLI confirm (`Turning the GUI off kills the rk-gui session and every app on display :N:` + `chromium ×3, xterm ×1  (up 4h 12m)`), with the no-apps / never-ran / macOS variants above | The plan lists "confirm copy" as a pick, but the CLI copy already exists in memory `run-kit/gui` — one copy source, no drift | S:75 R:90 A:85 D:80 |
| 11 | Confident | Local `src/types/novnc.d.ts` ambient declaration for `@novnc/novnc/core/rfb.js` (1.7.0 ships no `.d.ts`) | Verified against the 1.7.0 tarball; Risk 8 in the plan | S:85 R:90 A:90 D:90 |
| 12 | Confident | `GuiSurface` is `React.lazy`-loaded | ≈150 KB core that most tabs never need; no other tile is lazy, but the cost asymmetry justifies it | S:60 R:90 A:85 D:80 |
| 13 | Confident | "Stop framebuffer requests when hidden" = disconnect after 15 s not-visible (zoomed away or document hidden), reconnect on visible; focus loss alone never disconnects | noVNC has no pause API; disconnecting also releases the relay `viewers` count so the probe resumes | S:65 R:85 A:80 D:75 |
| 14 | Confident | Reconnect backoff 1 s → 2 s → 4 s → 8 s cap while `reachable` stays true; the empty state takes over when it flips false | Mirrors the terminal relay's reconnect posture; the stream is the authority on reachability | S:60 R:90 A:85 D:80 |
| 15 | Confident | Quality: fine `qualityLevel 6 / compressionLevel 2`; coarse `4 / 6` | Plan says "lower on coarse"; noVNC defaults are 6/2 | S:65 R:95 A:80 D:75 |
| 16 | Confident | Fullscreen verb = `requestFullscreen()` + `navigator.keyboard.lock()`; where `requestFullscreen` is absent it runs the zen toggle and the control's tooltip says so | Plan C3 text verbatim; iPhone Safari has no element fullscreen | S:85 R:90 A:85 D:85 |
| 17 | Confident | Chord gate is a capture-phase `keydown` on the canvas wrapper that stops propagation to noVNC for registry chords (`hasReclaimableMatch(e, bindings, "gui")`); no steal guard | Same-document canvas — simpler than the iframe reclaim; noVNC only focuses on click | S:80 R:85 A:85 D:85 |
| 18 | Confident | `viewOnly = true` client-side when `backend === "screen-sharing"` | The relay already drops input on macOS; the client flag stops a pretend cursor | S:70 R:95 A:90 D:85 |
| 19 | Confident | Per-viewer postures in localStorage: `rk-gui-view` (`fit`\|`1:1`, default `fit`) and `rk-gui-lock` (`"1"`\|absent) | surface-layout.md § State puts render postures per-viewer | S:75 R:95 A:90 D:85 |
| 20 | Confident | Spec corrections (gui.md diagram/routes, window-views + surface-layout status flips, index tag) ride this PR | The plan tells the C3 agent to edit the plan table in the same PR; the diagram is wrong against shipped Go and would mislead C4/C5 | S:70 R:95 A:85 D:80 |
| 21 | Confident | e2e: ungated half over `_state-socket-mock.ts`; gated half `test.skip`s without `Xtigervnc` on PATH | Plan Risk 7 mitigation; this VM has `Xtigervnc` + `openbox` | S:85 R:90 A:90 D:85 |
| 22 | Tentative | The Host page's system card does NOT gain a `gui` service row in C3 <!-- assumed: system-card gui row left out — not in the plan's C3 scope; trivial follow-up --> | Natural place for it (jobs/code-server/remotes rows exist) but outside the stated C3 scope | S:40 R:95 A:70 D:60 |

22 assumptions (8 certain, 13 confident, 1 tentative, 0 unresolved).
