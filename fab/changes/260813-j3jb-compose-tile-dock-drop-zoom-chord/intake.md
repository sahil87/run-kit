# Intake: Compose Strip Tile Dock + Ctrl+` Removal

**Change**: 260813-j3jb-compose-tile-dock-drop-zoom-chord
**Created**: 2026-08-13

## Origin

Conversational — a `/fab-discuss` session reviewing top-bar/tile chrome (the same session that drafted 260813-w1lf-terminal-tile-content-verbs). The user requested two small fixes bundled here:

> 1) Ctrl+` — let's remove this shortcut. It already has meaning in code-server.
> 3) The Compose Text bar can be made a part of the xterm tile itself. Right now it's outside it.

Follow-up decisions from the discussion: *"agreed, two mount points for the compose strip. This also disambiguates single send against the broadcast mode."*

## Why

1. **Ctrl+` collision**: the `layout-zoom` builtin binding (`keybindings.ts:223`, added in 260812-0c6o citing "VS Code Ctrl+` muscle memory") collides with code-server's own Ctrl+` (toggle integrated terminal). With the code tile focused, the iframe swallows the chord and toggles code-server's terminal; with focus anywhere else, rk zooms the tile. Same keystroke, two behaviors depending on last click — worse than no chord. Zoom stays reachable via the palette (`Layout: Zoom`/`Layout: Unzoom`) and the tile's ⛶ verb.
2. **Compose strip orphaned from its target**: the strip docks in the shell footer (`app.tsx` ~3545, above `BottomBar`) and chases the focused pane's x/width via `computeStripGeometry` (260812-fryz) — a measurement hack that visually approximates what containment would give for free. On a multi-tile layout the strip sits outside every tile frame, so which terminal it sends to is only discoverable from its target label. Docking it **inside the tty tile** makes the target self-evident, and the tile's zoom/hide/close then carries the strip with it for free.
3. **Disambiguation bonus** (user-stated): with single-send living in-tile, the footer dock becomes the visual signature of **broadcast mode** — where the strip renders tells you what it will do.

## What Changes

### 1. Remove the Ctrl+` default binding

- Delete the `layout-zoom` row from `DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts` (line ~223: `{ actionId: "layout-zoom", code: "Backquote", tier: "ctrl", ... }`) and its stale doc-comment references (the header comment at ~line 35 and ~150 mention "Ctrl+` layout zoom").
- The zoom **action** survives untouched: the palette's `Layout: Zoom`/`Layout: Unzoom` entries and the tile ⛶ verb dispatch through `layoutZoomToggleRef` directly (app.tsx ~3107 documents why). Removing the binding row removes only the chord and its shortcuts-overlay/cheatsheet row.
- Clean up the now-dead `"layout-zoom"` entry in app.tsx's keybinding action-dispatch map (~line 3113) and the boot-sweep combo stamp (~line 2556) if it references the binding.
- Update `keybindings.test.ts` (e.g., line 167 asserts the Backquote row exists) per the spec-conformance rule: tests follow the new spec.
- The `ctrl` tier itself stays (its doc comment cites this chord as the example — reword, don't remove the tier).

### 2. Compose strip: two mount points, one component

The strip (`app/frontend/src/components/compose-strip.tsx`) becomes mount-agnostic and renders at exactly one of two docks:

- **In-tile dock (new, the primary)**: on the **desktop terminal route**, when the layout contains a tty tile and the strip is in **single-send** mode, the strip renders inside the tty tile — bottom of the tile, above the tile's bottom edge, inside the frame (below the terminal body in the tile's flex column in `surface-layout.tsx`). On layouts with **duplicate tty tiles**, the FIRST tty tile hosts it (the one holding `wsRef`/`focusRef` — the registered focused terminal).
- **Footer dock (existing, retained)** for everything the tile cannot host:
  - **Selection broadcast** (`selectionTarget` non-null, the "→ N selected" frozen-key mode) — a shell-level concern spanning N windows, never a property of one tile. The dock split IS the disambiguation: in-tile = sends to this terminal; footer = broadcast.
  - **Board route** (no surface tiles there).
  - **Mobile** (tile chrome doesn't render; `renderTile`'s `!mobile` gate).
  - **Desktop terminal route with no tty tile in the layout** (e.g. `single:code`) — fallback preserving today's behavior (the strip still targets the window's pane).
- **One component, one draft store**: `compose-draft-store` is already module-global, so drafts, sent history, and attachments survive the strip moving between docks (including the broadcast-mode flip mid-draft). The `compose-toggle` chord (⇧⌘E), `focusComposeStrip` events, and Enter-classification behavior are unchanged.
- **Retire `computeStripGeometry`**: the in-tile mount is naturally tile-aligned, and no remaining footer consumer needs pane-chasing (broadcast spans windows; board/mobile render full-width). Delete `lib/compose-strip-geometry.ts` + its test and the measurement wiring in `compose-strip.tsx` (~lines 311–340, 755–762). The footer dock renders full-width as it did before 260812-fryz.
- The footer grid-area comment contract in app.tsx (strip grows the `auto` footer row; terminal ResizeObserver refits) applies analogously in-tile: the strip inside the tile's flex column shrinks the terminal body, and the existing fit logic refits — no new resize plumbing expected.

### Tests

- Unit: `compose-strip.test.tsx` (dock selection logic), `keybindings.test.ts` (row removal), delete `compose-strip-geometry` tests with the lib.
- E2E: update specs asserting strip position/geometry; add assertions — strip renders inside the tty tile frame on desktop terminal route; flips to footer when selection broadcast activates; footer on board route and mobile viewport; draft text survives the dock flip. Sibling `.spec.md` files update in the same commit (constitution § Test Companion Docs).

## Affected Memory

- `run-kit/ui-patterns`: (modify) compose-strip section (two-dock model, geometry retirement, broadcast disambiguation) and keybindings section (Ctrl+` row removal)

## Impact

- `app/frontend/src/lib/keybindings.ts` + `keybindings.test.ts` — binding row removal
- `app/frontend/src/app.tsx` — dead dispatch-map entry cleanup; footer mount becomes conditional; passes the strip (or its props) into the tile path
- `app/frontend/src/components/compose-strip.tsx` + test — mount-agnostic render, geometry removal
- `app/frontend/src/components/surface-layout.tsx` — tty tile hosts the in-tile dock
- `app/frontend/src/lib/compose-strip-geometry.ts` + test — deleted
- `app/frontend/tests/*.spec.ts` + `.spec.md` — e2e updates
- No backend changes

## Open Questions

- None — the two-dock split and broadcast disambiguation were decided in the originating discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Two mount points, one component + one draft store | Discussed — user: "agreed, two mount points for the compose strip" | S:95 R:80 A:90 D:95 |
| 2 | Certain | Broadcast mode renders at the footer dock; in-tile is single-send only | Discussed — user: "this also disambiguates single send against the broadcast mode" | S:90 R:85 A:90 D:90 |
| 3 | Certain | Ctrl+` chord removed; zoom action stays via palette + ⛶ verb | User: "ok" to the removal framing that named both surviving paths | S:90 R:90 A:95 D:90 |
| 4 | Confident | First tty tile hosts the in-tile dock on duplicate-tty layouts | Follows the existing first-tty convention (wsRef/focusRef holder, registered focused terminal) | S:65 R:85 A:85 D:80 |
| 5 | Confident | No-tty-tile layouts fall back to the footer dock | Preserves today's behavior; hiding the strip would regress send-to-window on code/web-only layouts | S:60 R:85 A:80 D:75 |
| 6 | Confident | Retire `computeStripGeometry` entirely (no remaining consumer) | In-tile mount is container-aligned; broadcast/board/mobile render full-width — derived from code reading | S:70 R:80 A:85 D:80 |
| 7 | Tentative | Remove the `layout-zoom` row from DEFAULT_BINDINGS entirely (vs keeping a default-unbound row for overlay rebindability) | `KeyBinding.code` is required (`keybindings.ts:63`); user-side `null` overrides exist but a default-unbound row needs a type change — removal is simpler and matches "remove this shortcut"; users lose overlay rebind for zoom <!-- assumed: delete the binding row outright; a default-unbound row would need optional code support --> | S:50 R:75 A:60 D:45 |

7 assumptions (3 certain, 3 confident, 1 tentative, 0 unresolved).
