# Plan: Compose Strip Tile Dock + Ctrl+` Removal

**Change**: 260813-j3jb-compose-tile-dock-drop-zoom-chord
**Intake**: `intake.md`

## Requirements

### Keybindings: Ctrl+` removal

#### R1: layout-zoom default binding removed
The `layout-zoom` row SHALL be removed from `DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts` (currently line ~223, `code: "Backquote", tier: "ctrl"`). The zoom ACTION survives: the palette's `Layout: Zoom`/`Layout: Unzoom` entries and the tile ⛶ verb keep dispatching through `layoutZoomToggleRef`. Doc comments referencing the chord (keybindings.ts header ~line 35 "the Ctrl+` layout-zoom toggle", the DEFAULT_BINDINGS lead comment ~line 150) MUST be reworded — the `ctrl` tier itself stays. Dead wiring in `app.tsx` that exists only for the binding (the combo stamp effect ~line 2556–2560 and the `"layout-zoom"` entry in the keybinding action-dispatch map ~line 3113) SHALL be removed; the palette dispatch path is untouched.

- **GIVEN** the terminal route with a code tile focused inside code-server
- **WHEN** the user presses Ctrl+`
- **THEN** rk performs no zoom (code-server's own Ctrl+` behavior is all that fires)

- **GIVEN** the shortcuts overlay / cheatsheet
- **WHEN** it renders
- **THEN** no Ctrl+` / layout-zoom row appears

- **GIVEN** the command palette on a multi-tile terminal route
- **WHEN** the user runs `Layout: Zoom`
- **THEN** slot-A zoom toggles exactly as before

### Compose strip: two docks

#### R2: In-tile dock on the desktop terminal route
When `composeStripEnabled` is on, the route is a desktop terminal route (`windowParam` set, not `isMobile`), selection broadcast is NOT active, and the resolved layout contains a tty tile, the strip SHALL render inside the FIRST tty tile (the slot holding `wsRef`/`focusRef` — the registered focused terminal) as the last element of the tile's flex column, below the terminal body, inside the tile frame. The terminal body shrinks and its existing ResizeObserver-driven fit refits — no new resize plumbing. Duplicate-tty layouts host the strip in the first tty tile only.

- **GIVEN** a desktop `two-col: tty | code` layout with the strip enabled
- **WHEN** the terminal route renders
- **THEN** the strip appears inside the tty tile's frame (a descendant of `[data-testid="surface-tile-tty"]`), not in the shell footer

- **GIVEN** the strip visible in-tile with text typed
- **WHEN** the tty tile is zoomed or the layout ratio is dragged
- **THEN** the strip stays inside the tile and the draft text is untouched

#### R3: Footer dock retained for broadcast, board, mobile, and no-tty layouts
The shell-footer mount in `app.tsx` (~line 3546) SHALL keep rendering the strip when the strip is enabled AND the in-tile conditions do not hold: selection broadcast active (`selectionBroadcastKeys` non-null), mobile viewport, or a layout with no tty tile. The `board-page.tsx` footer mount (~line 304) is UNTOUCHED. Exactly one dock renders the strip at a time.

- **GIVEN** the strip enabled in-tile on a desktop terminal route
- **WHEN** the palette's selection-broadcast action freezes N target keys
- **THEN** the strip renders at the shell footer with the `→ N selected` target label, and the in-tile dock is empty

- **GIVEN** a desktop terminal route with a `single:code` layout (no tty tile)
- **WHEN** the strip is enabled
- **THEN** the strip renders at the shell footer (today's behavior preserved)

#### R4: One component, one draft store — drafts survive dock flips
Both docks SHALL render the same `ComposeStrip` component backed by the module-level `compose-draft-store`. A dock flip (broadcast on/off, layout gaining/losing its tty tile, window switch remounting the keyed `SurfaceLayout`) MUST NOT lose draft text, attachments-path lines, or sent history. The focus-on-open contract (flag consumed on mount) and the `compose-toggle` (⇧⌘E) chord are unchanged.

- **GIVEN** a draft typed into the in-tile strip
- **WHEN** selection broadcast activates (strip flips to the footer dock)
- **THEN** the broadcast-keyed draft behavior applies as today, and flipping back restores the per-target draft text

#### R5: Pane-chasing geometry retired
`app/frontend/src/lib/compose-strip-geometry.ts` and `compose-strip-geometry.test.ts` SHALL be deleted. The geometry wiring in `compose-strip.tsx` — the `geometry` state, the measure/rAF-debounce effects reading `focused.containerRef` (~lines 311–360), and the inner-wrapper `marginLeft`/`width` inline styles (~line 762) — SHALL be removed. The in-tile dock is container-aligned by construction; the footer dock renders full-width (the pre-260812-fryz presentation). The doc-comment block describing pane-aligned geometry (~lines 144–157) is replaced by the two-dock contract.

- **GIVEN** the footer dock rendering (broadcast or board)
- **WHEN** the focused pane changes or a ratio drag fires
- **THEN** no measurement effect runs and the strip stays full-width (no inline margin/width styles)

### Non-Goals

- Board-page strip placement changes — the board footer mount stays verbatim
- Any change to Enter classification, readline keys, uploads, sent-history recall, or send semantics
- A rebindable-but-unbound-by-default `layout-zoom` row (`KeyBinding.code` is required; removal is the chosen shape)

### Design Decisions

#### Dock selection lives in app.tsx as one predicate
**Decision**: `app.tsx` computes `inTileDock = composeStripEnabled && !isMobile && !!windowParam && !selectionBroadcastKeys && layout.order.includes("tty")`; the footer renders the strip when `composeStripEnabled && !inTileDock`, and `SurfaceLayout` receives the strip as an opaque `ttyDockContent?: React.ReactNode` prop rendered after the first tty tile's content.
**Why**: SurfaceLayout is presentational by contract (verbs already call parent callbacks); a node prop keeps all strip wiring (selectionTarget, chrome state) in AppShell and adds zero strip knowledge to the tile renderer.
**Rejected**: mounting `<ComposeStrip>` directly inside SurfaceLayout — would drag ChromeContext/broadcast wiring into a presentational component and duplicate the mount logic the footer already has.
*Introduced by*: 260813-j3jb-compose-tile-dock-drop-zoom-chord

#### Delete the binding row outright
**Decision**: remove the `layout-zoom` entry from `DEFAULT_BINDINGS` rather than shipping a default-unbound row.
**Why**: `KeyBinding.code` is a required field (keybindings.ts:63); default-unbound needs a type change rippling through combo matching for one action, and the action stays reachable via palette + verb.
**Rejected**: optional-`code` support — disproportionate to the ask ("remove this shortcut"); users lose overlay rebind for zoom, accepted in intake assumption 7.
*Introduced by*: 260813-j3jb-compose-tile-dock-drop-zoom-chord

## Tasks

### Phase 1: Keybinding removal

- [x] T001 Remove the `layout-zoom` row from `DEFAULT_BINDINGS` in `app/frontend/src/lib/keybindings.ts` (~line 217–223 incl. its lead comment); reword the header doc comment (~line 35) and any other comment naming the chord — the `ctrl` tier stays <!-- R1 -->
- [x] T002 Remove dead binding wiring in `app/frontend/src/app.tsx`: the layout-zoom combo-stamp effect (~2556–2560) and the `"layout-zoom"` action-dispatch map entry (~3107–3117 comment + entry); keep `layoutZoomToggleRef` and the palette entries untouched <!-- R1 -->
- [x] T003 Update `app/frontend/src/lib/keybindings.test.ts`: drop/replace assertions that the Backquote/ctrl row exists (line ~167) and any layout-zoom-specific combo tests; keep ctrl-tier matcher tests (~215–240) by re-anchoring them on a synthetic combo if they only used Backquote as an example <!-- R1 -->

### Phase 2: Compose strip two-dock core

- [x] T004 In `app/frontend/src/components/compose-strip.tsx`: delete the pane-aligned geometry block — `geometry` state + measure effects (~311–360), the inner-wrapper inline `marginLeft`/`width` style (~762), the `computeStripGeometry` import, and the 260812-fryz doc-comment block (~144–157), replacing it with the two-dock contract comment <!-- R5 -->
- [x] T005 [P] Delete `app/frontend/src/lib/compose-strip-geometry.ts` and `app/frontend/src/lib/compose-strip-geometry.test.ts` <!-- R5 -->
- [x] T006 In `app/frontend/src/components/surface-layout.tsx`: add optional `ttyDockContent?: React.ReactNode` prop; render it inside the FIRST tty tile (slot === firstTtySlot) as the last child of the tile's flex column (below the renderContent wrapper), desktop branch only <!-- R2 -->
- [x] T007 In `app/frontend/src/app.tsx`: compute the `inTileDock` predicate (Design Decisions); pass `<ComposeStrip selectionTarget={null}/>` (or the shared element) as `ttyDockContent` when in-tile; gate the footer mount (~3546) to `composeStripEnabled && !inTileDock`; board-page.tsx untouched <!-- R2, R3 -->

### Phase 3: Integration & edge cases

- [x] T008 Verify + cover dock-flip draft survival: broadcast on/off flips dock without losing per-target draft (module store) — extend `app/frontend/src/components/compose-strip.test.tsx` and/or `surface-layout.test.tsx` unit coverage for the `ttyDockContent` render slot and the footer-vs-tile exclusivity <!-- R3, R4 -->
- [x] T009 Update `app/frontend/tests/e2e/compose-strip.spec.ts` + sibling `compose-strip.spec.md` (same commit, constitution § Test Companion Docs): strip renders inside `surface-tile-tty` on desktop terminal route; flips to footer when broadcast activates; footer on mobile viewport; geometry assertions (pane-aligned margin/width) removed <!-- R2, R3, R6 -->

### Phase 4: Verification

- [x] T010 Run gates: `just test-frontend` (Vitest incl. keybindings + compose-strip suites), `cd app/frontend && npx tsc --noEmit`, then targeted `just test-e2e "compose-strip"` <!-- R1, R2, R3, R4, R5 -->

## Execution Order

- T004 blocks T007 (footer gating touches the same component's props); T006 blocks T007
- T001–T003 are independent of Phase 2+ and may run first or in parallel with it
- T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `DEFAULT_BINDINGS` has no `layout-zoom` row; shortcuts overlay/cheatsheet lists no Ctrl+` zoom entry; palette `Layout: Zoom`/`Unzoom` and the ⛶ verb still toggle zoom
- [x] A-002 R2: on a desktop multi-tile terminal route with the strip enabled, the strip renders inside the first tty tile's frame
- [x] A-003 R3: broadcast mode, mobile viewport, and no-tty layouts render the strip at the shell footer; the board-page mount is byte-untouched
- [x] A-004 R5: `compose-strip-geometry.ts` + its test are deleted; no `computeStripGeometry` reference remains in the repo

### Behavioral Correctness

- [x] A-005 R2: the terminal refits (no clipped xterm rows) when the in-tile strip opens/closes — the tile flex column drives the existing ResizeObserver fit
- [x] A-006 R3: exactly one dock renders the strip at any time (never both, never zero while enabled)
- [x] A-007 R4: a per-target draft typed in-tile survives a broadcast on/off dock flip and a window switch (module store), text intact

### Removal Verification

- [x] A-008 R1: no dead `layout-zoom` dispatch wiring remains in app.tsx (combo stamp + action map); `layoutZoomToggleRef` palette path intact
- [x] A-009 R5: compose-strip.tsx carries no geometry state, measurement effects, or inline margin/width alignment styles

### Scenario Coverage

- [x] A-010 R2: e2e asserts strip-inside-`surface-tile-tty` on the desktop terminal route; `.spec.md` updated in the same commit
- [x] A-011 R3: e2e asserts the footer dock for the broadcast flip and the mobile viewport

### Edge Cases & Error Handling

- [x] A-012 R2: duplicate-tty layout hosts the strip in the first tty tile only
- [x] A-013 R3: a `single:code`/no-tty layout falls back to the footer dock without errors

### Code Quality

- [x] A-014 Pattern consistency: new code follows surrounding naming/idiom (presentational SurfaceLayout contract, module-store seams, `rk-*`/Tailwind conventions)
- [x] A-015 No unnecessary duplication: one ComposeStrip element/definition serves both docks; no copied strip markup
- [x] A-016 No client polling: no `setInterval`/fetch loops introduced (SSE/ResizeObserver seams only)
- [x] A-017 Tests included: new/changed behavior covered by unit tests and e2e per code-quality.md

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `FocusedTerminal.containerRef` (`app/frontend/src/contexts/focused-terminal-context.tsx:34`) plus its registrations (`app/frontend/src/components/terminal-client.tsx:128-160`, `app/frontend/src/components/board/board-pane.tsx:92-156`) — the retired pane-aligned geometry was its only consumer; with `computeStripGeometry` gone the field is write-only (no reader remains in `src/`). Not deleted here: out of this change's scope and the field is a plausible future seam, but it is now dead weight.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Strip enters the tile via an opaque `ttyDockContent` node prop | Preserves SurfaceLayout's presentational-by-contract rule; mirrors existing parent-callback verb pattern | S:70 R:85 A:85 D:80 |
| 2 | Confident | Ctrl-tier matcher unit tests re-anchor on a synthetic combo rather than being deleted | Tests verify tier mechanics, not the zoom binding; spec-conformance rule says tests follow spec | S:60 R:90 A:80 D:75 |
| 3 | Confident | In-tile dock renders `selectionTarget={null}` (broadcast never reaches the tile dock) | The dock predicate excludes broadcast before the tile mounts — footer owns broadcast by R3 | S:75 R:85 A:85 D:85 |

3 assumptions (0 certain, 3 confident, 0 tentative).
