# Plan: Left-Edge Label Picker — Single 26px Target, Combined Color+Marker Menu

**Change**: 260719-hwtr-left-edge-label-picker
**Intake**: `intake.md`

## Requirements

<!-- Follow-up iteration on the merged 260718-3prk axis split (PR #394). This
     consolidates both row labellers into a single left-edge target opening a
     combined picker, removes click-to-cycle, and slims the right cluster. The
     intake's §3 "Superseded 3prk decisions" table is BINDING — the OLD
     cycle/cell-cursor/ghost/coarse-inert decisions are reversed here; do not
     resurrect them. All 11 intake assumptions are Certain/user-approved. -->

### Window Row: Left-Edge Label Zone

#### R1: Single 26px label target opening the combined picker
The full 26px to the left of the status dot (12px group-indent zone + 14px marker
stripe zone) SHALL be ONE interactive zone. Clicking/tapping anywhere in it MUST
open the combined Label picker anchored at the row's left edge below the row. The
click MUST NOT select the row (`stopPropagation`) and MUST coexist with
drag-reorder. The status dot and window name MUST keep their exact current
x-positions (the 26px repurposes the existing group indent + gutter — no content
shift). Cursor is `pointer` (menu-opener semantics, not cycle).

- **GIVEN** a window row on the tmux Server page
- **WHEN** the user clicks anywhere in the 26px left-of-dot zone
- **THEN** the combined Label picker opens anchored at the row's bottom-left
- **AND** the row is NOT selected (URL gains no window segment) and the StatusDot's own hover-card / click is unaffected

#### R2: Hover affordance — palette icon + zone glow
Hovering the ROW SHALL fade in the shipped `PaletteIcon` (~11px) in the 12px icon
zone at ~65% opacity and glow the whole 26px zone at ~12% of the row's family
color. Hovering the ZONE ITSELF SHALL raise the icon to full opacity and the glow
to ~24%. The icon color MUST be the row's guarded family color on colored rows and
inherited monochrome on uncolored rows.

- **GIVEN** a colored window row at rest (no hover)
- **WHEN** the pointer enters the row, then enters the 26px zone
- **THEN** the palette icon fades in (~65% → 100%) and the zone glow deepens (~12% → ~24%) in the family color

#### R3: Marker stripe display-only, inset 5px
The left-edge marker stripe SHALL become DISPLAY-ONLY (no click-to-cycle, no
`cell` cursor, no next-state ghost preview). It MUST be inset 5px within its 14px
zone (fixing the shipped flush-left + dead-space geometry). Stripe rendering (3px
dotted / 3px solid / 6px double in the guarded family color, gray uncolored) is
otherwise unchanged.

- **GIVEN** a window row with `marker="solid"`
- **WHEN** the row renders
- **THEN** the 3px solid stripe paints inset 5px from the row's left edge, and clicking it opens the picker (it does NOT cycle the marker)

#### R4: Zone active on coarse pointers
The 26px × full-row-height (36px on coarse) target MUST be tappable on coarse
pointers — touch gets direct label access. This supersedes 3prk's palette-only
touch decision (the zone is no longer `coarse:pointer-events-none`).

- **GIVEN** a touch device (coarse pointer)
- **WHEN** the user taps the left-edge zone
- **THEN** the combined Label picker opens (the zone is interactive on touch)

### Combined Label Picker (`swatch-popover.tsx`)

#### R5: Combined color + marker sections
The picker SHALL contain both label vocabularies in one popover:
- **Colors**: the 10 family swatches in a grid (filled with each family's guarded
  color) + a full-width "Clear color" row. Selection writes through the existing
  `familyToLegacy` seam (stored vocabulary unchanged — the backend validators
  reject family names). Current color highlighted with a 1px outline.
- **Separator** (1px hairline), then **markers**: 4 cells rendering the states as
  mini stripes — none / dotted / solid / double — in the row's current guarded
  color; current state highlighted. Selection calls the existing `setWindowMarker`
  path (via an `onSelectMarker` callback). Any marker state is reachable in 2
  clicks (open + pick); there is NO cycling.

- **GIVEN** the Label picker is open for a window with `color="orange"`, `marker="dotted"`
- **WHEN** the user clicks the `solid` marker cell
- **THEN** `onSelectMarker("solid")` fires (which writes `@rk_marker=solid`) with NO cycling, and the picker reflects the highlighted current values

#### R6: Square picker styling (this picker only)
The combined picker SHALL use square styling scoped to this picker: zero
`border-radius` on the container and all cells (strip the shipped
`rounded-md`/`rounded-sm`), a hard offset block shadow (`3px 3px 0 rgba(0,0,0,.35)`)
instead of the blurred drop shadow, 1px selection outlines, and 3px grid gaps.
Other popovers (session/server color pickers) MUST be unaffected.

- **GIVEN** the combined Label picker rendered in a window-row context
- **WHEN** it displays
- **THEN** the container and cells have zero border-radius and the hard offset block shadow

#### R7: Keyboard navigation across both sections
The picker SHALL preserve/extend its arrow-key + Enter/Space navigation across
BOTH the color and marker sections; Escape closes; outside click closes. This
keeps a complete keyboard path (Constitution V).

- **GIVEN** the combined picker is focused with keyboard
- **WHEN** the user arrows through swatches into the marker cells and presses Enter
- **THEN** focus reaches every color swatch, Clear, and all 4 marker cells; Enter/Space activates the focused item; Escape closes

### Right Hover Cluster & Command Palette

#### R8: Right cluster slims to actions only (windows)
The color button (`PaletteIcon` between pin and kill) MUST be removed from the
WINDOW-row right cluster — the cluster becomes pin + kill. Session rows and server
tiles KEEP their existing right-side color affordances (they have no left label
zone; windows-only scope, consistent with 3prk's marker scope).

- **GIVEN** a window row hovered
- **WHEN** the right cluster reveals
- **THEN** it shows only the pin and kill icons (no color/palette button); session rows and server tiles still show their color button

#### R9: `Window: Label` palette action replaces `Window: Cycle Marker`
The command palette action `Window: Cycle Marker` MUST be replaced with
`Window: Label`, which opens the Label picker for the current window's sidebar row
via an imperative document-event (mirroring the `pin-popover:open` pattern used by
"Board: Pin Current Window"). One interaction model everywhere.

- **GIVEN** a window is current
- **WHEN** the user runs the `Window: Label` palette action
- **THEN** the matching sidebar WindowRow opens its Label picker (and `Window: Cycle Marker` no longer exists)

### Documentation

#### R10: Update themes.md § Axis split to the single-target model
`docs/specs/themes.md` § Axis split (and the § Left-gutter marker paragraph) MUST
be updated to describe the single-target model: one 26px left-edge target opening
the combined picker, hover palette icon + zone glow, `pointer` cursor,
display-only stripe inset 5px, coarse-active. Remove the click-to-cycle / `cell`
cursor / next-state-ghost / palette-only-touch prose.

- **GIVEN** the shipped themes.md describing gutter click-to-cycle
- **WHEN** the doc is updated
- **THEN** it describes the single 26px target + combined picker, with the superseded cycle/cell/ghost/coarse-inert prose removed

#### R11: e2e + companion rewritten to the picker flow
The e2e spec `window-marker-gutter.spec.ts` and its `.spec.md` companion MUST be
rewritten to the picker flow (no cycle clicks), driving state through the API where
the old spec did. The `.spec.md` MUST stay in sync (constitution: Test Companion
Docs).

- **GIVEN** the old spec asserting empty→dotted→solid→double cycling on gutter clicks
- **WHEN** the spec is rewritten
- **THEN** it opens the picker from the left-edge zone, picks a color + a marker state, asserts each persists via the options API, and asserts the zone click does not select the row — with the `.spec.md` mirroring every test

### Non-Goals
- No backend change — `@rk_marker`, color options, and validators are untouched;
  writes go through the existing `setWindowOptions`/`setWindowMarker`/
  `familyToLegacy` seams.
- No changes to session-row / server-tile color affordances (they keep their
  right-side color buttons).
- No de-rounding of other popovers — square styling is scoped to the combined
  window-row Label picker only.
- No changes to the double-marker scanline easter egg, the `@rk_marker` wake seam,
  the accent-pin active-board cue, or the owned-palette derivation (all unchanged
  from 3prk).

### Design Decisions
1. **Combined picker is a superset of the existing SwatchPopover**: extend
   `swatch-popover.tsx` in place with an optional marker section (a new
   `markers?` / `selectedMarker` / `onSelectMarker` prop group + a `square` flag)
   rather than forking a new component — *Why*: the color grid + keyboard nav +
   Escape/outside-click already exist and are reused verbatim; the marker section
   is additive. When the marker props are absent (session/server callers, palette
   window-color action) the component renders exactly as today (color-only,
   rounded). — *Rejected*: a separate `LabelPopover` wrapper composing two
   pickers (duplicates keyboard nav + close logic; two focus rings to reconcile).
2. **`MarkerGutter` becomes a display-only opener zone**: repurpose the existing
   `MarkerGutter` in `window-row.tsx` into the 26px `LabelZone` (12px icon + 14px
   stripe), `onClick` opens the picker instead of cycling — *Why*: the absolute
   z-20 left-edge sibling + the `pl-[18px]` content clearance that keeps the
   StatusDot clear are already correct (must-fix 3 from 3prk); only the width,
   cursor, hover content, and click handler change. — *Rejected*: two adjacent
   zones (superseded by the user — one target, one behavior).
3. **Picker anchored bottom-left of the row**: render the picker in an
   `absolute left-0 top-full z-50` wrapper (mirroring the shipped right-anchored
   color popover but left-anchored) — *Why*: intake R1 says "anchored at the
   row's left edge below the row"; the row root must stay overflow-free so the
   popover isn't clipped (must-fix 4 from 3prk). — *Rejected*: floating-ui
   portal (heavier; the existing popovers use plain absolute anchoring).
4. **Palette event name `label-popover:open`**: add a new imperative document
   event mirroring `pin-popover:open` — *Why*: the pin pattern is proven and
   keyboard-reachable; the palette has no value input so it must delegate to the
   row's popover. — *Rejected*: reusing the app-level modal SwatchPopover for the
   window path (it has no marker section and is centered, not row-anchored).

## Tasks

### Phase 1: Combined picker (swatch-popover.tsx)

- [x] T001 Extend `SwatchPopover` in `app/frontend/src/components/swatch-popover.tsx` with an OPTIONAL marker section: <!-- rework: review must-fix 2+4 — (a) the intake §2 layout is BINDING (user-approved): render the 10 swatches as a 5×2 grid with 18px cells, and make "Clear color" a FULL-WIDTH row (span all 5 columns), replacing the shipped 4-col/half-width-Clear layout — update GRID_COLS nav math accordingly; (b) the new markerStripeStyle helper is a byte-identical duplicate of window-row.tsx markerBorderStyle — move the marker-stripe vocabulary into ONE shared helper (e.g. themes.ts next to MARKER_STATES) and import it in BOTH swatch-popover.tsx and window-row.tsx. --> add props `markerStates?: readonly string[]` (or a boolean `showMarkers`), `selectedMarker?: string`, `onSelectMarker?: (marker: string) => void`, and `markerColor?: string` (the row's guarded family color for stripe rendering); render 4 marker cells (none/dotted/solid/double) as mini stripes below a 1px hairline separator ONLY when the marker props are supplied. Marker selection calls `onSelectMarker` directly (no cycling; "" clears). Keep the color grid + `familyToLegacy` write seam exactly as-is. <!-- R5 -->
- [x] T002 Add a `square?: boolean` styling flag to `SwatchPopover`: when true, strip `rounded-md` (container) / `rounded-sm` (cells), apply the hard offset block shadow `3px 3px 0 rgba(0,0,0,.35)` (replacing `shadow-lg`), use 1px selection outlines and 3px grid gaps — scoped to this instance only; default (flag absent) renders identically to today. <!-- R6 -->
- [x] T003 Extend the popover's arrow-key + Enter/Space keyboard navigation <!-- rework: review must-fix 3 — the picker never receives focus on open: no focus() on mount, so after the `Window: Label` palette action (now the ONLY keyboard marker path) arrow-key nav is dead until a blind Tab. Fix: focus the listbox container in a mount effect, exactly like the explicitly-mirrored pin-popover does (pin-popover.tsx:110). Verify the palette→open→arrows→Enter flow works end-to-end in a unit test. --> to traverse the marker cells as an additional row after the color grid + Clear, wrapping the existing `focusIndex` math to include the 4 marker indices; Enter/Space on a marker cell fires `onSelectMarker`. Escape + outside-click close (unchanged). Guard all marker-nav math behind the marker-section-present condition so color-only callers are unaffected. <!-- R7 -->

### Phase 2: Left-edge label zone (window-row.tsx)

- [x] T004 Convert `MarkerGutter` in `app/frontend/src/components/sidebar/window-row.tsx` into a display-only 26px `LabelZone`: width 26px (12px icon zone + 14px stripe zone), `cursor-pointer`, REMOVE `cursor-[cell]`, REMOVE `coarse:pointer-events-none` (zone active on touch — R4), REMOVE the next-state ghost preview, render the shipped `PaletteIcon` (~11px) in the icon zone with two-stage hover opacity (~65% row-hover → 100% zone-hover) and zone glow (~12% row-hover → ~24% zone-hover) in `markerColor` (family on colored rows, inherited monochrome on uncolored), and inset the display-only marker stripe 5px within its 14px zone. `aria-label` becomes "Set window label" (or similar). `onClick` opens the picker (stopPropagation; must not select the row). <!-- R1 R2 R3 R4 -->
- [x] T005 In `WindowRowInner`, replace the `cycleMarker` handler + `showColorPicker` state with a single `showLabelPicker` state; wire the `LabelZone` `onClick` to open it. Add a `useEffect` listening for the imperative `label-popover:open` CustomEvent (mirroring the existing `pin-popover:open` handler) that opens THIS row's picker when `detail.server`/`detail.windowId` match. Ensure the row root stays overflow-free (keep the scanline inner-overlay pattern; do NOT add overflow-hidden to the root). <!-- R1 R9 -->
- [x] T006 Render the combined Label picker in an `absolute left-0 top-full z-50` wrapper below the row when `showLabelPicker` is set, passing `selectedColor={color}`, the marker props (`selectedMarker={marker}`, `onSelectMarker` → `onMarkerChange(srv, session, windowId, m)`, `markerColor`), `square`, `onSelect` → `onColorChange(srv, session, windowId, c)`, and `onClose`. Both selections close the picker. <!-- R1 R5 -->
- [x] T007 Remove the color button (`PaletteIcon` between pin and kill) from the WINDOW-row right hover cluster — the cluster becomes pin + kill only. Keep the `onColorChange` prop (now consumed by the LabelZone picker, not a right-cluster button). <!-- R8 -->

### Phase 3: Command palette (app.tsx)

- [x] T008 In `app/frontend/src/app.tsx`, replace the `window-cycle-marker` / `Window: Cycle Marker` palette action <!-- rework: review must-fix 1 — dead code left behind: themes.ts:431 `nextMarkerState()` has ZERO call sites (delete it + the orphaned MarkerState type if unused elsewhere), its docstring and the MARKER_STATES comment (themes.ts:421-430) still describe click-to-cycle, and components/sidebar/index.tsx:1062-1064 still claims callers "compute the NEXT state via nextMarkerState". Delete the dead function and fix both stale comments; drop any related dead exports/tests. --> with `window-label` / `Window: Label`, whose `onSelect` dispatches a `label-popover:open` CustomEvent `{ detail: { server, windowId } }` for the current window (mirroring the `pin-popover:open` dispatch in `buildPinActions`). Remove the now-unused `nextMarkerState` / `setWindowMarkerApi` imports if they become dead here (verify no other app.tsx caller). <!-- R9 -->

### Phase 4: Docs, tests, and companions

- [x] T009 [P] Update `docs/specs/themes.md` § Axis split + § Left-gutter marker to the single-target model: one 26px left-edge target opening the combined color+marker picker, hover palette icon + zone glow, `pointer` cursor, display-only stripe inset 5px, coarse-active; remove the click-to-cycle / `cell` cursor / next-state-ghost / palette-only-touch prose. Note the picker's square styling scope. <!-- R10 -->
- [x] T010 [P] Update the unit test `app/frontend/src/components/swatch-popover.test.tsx`: <!-- rework: follow-on from T001/T003 fixes — update assertions for the 5×2 grid (nav math), full-width Clear row, autofocus-on-mount, and the shared marker-stripe helper; drop any test importing the deleted nextMarkerState. --> add cases for the marker section (renders 4 marker cells only when marker props supplied; clicking a cell calls `onSelectMarker` with the state, "" clears; keyboard reaches the marker cells; `square` flag applies zero-radius styling; color-only rendering unchanged when marker props absent). Keep the existing color/legacy-vocabulary assertions. <!-- R5 R6 R7 -->
- [x] T011 [P] Update the unit test `app/frontend/src/components/sidebar/window-row.test.tsx`: rewrite the "axis split" describe block — the left-edge zone is now a display-only picker opener (label "Set window label"), `cursor-pointer` not `cursor-[cell]`, NOT `coarse:pointer-events-none`; clicking it opens the picker and does NOT select the row (assert `onSelectWindow` not called); the right cluster no longer has a color/palette button; the display-only stripe still renders per marker state; scanline overlay assertions (inner element, root stays unclipped) preserved. Remove the cycle-on-click assertions. <!-- R1 R2 R3 R4 R8 -->
- [x] T012 Rewrite the e2e spec `app/frontend/tests/e2e/window-marker-gutter.spec.ts` + its `.spec.md` companion to the picker flow: open the Label picker from the left-edge zone, pick a color (assert it persists via `@color` on the options API), pick a marker state (assert it persists via `@rk_marker`), assert the zone click does NOT select the row (no `aria-current`, URL unchanged). Keep the colored-selection-tint / no-left-border assertion (unchanged behavior). Drive color/marker reads through `GET /api/sessions` as the old spec did; keep the `.spec.md` mirroring every test. <!-- R11 -->

## Execution Order

- Phase 1 (T001–T003) before Phase 2 (the LabelZone picker consumes the extended popover props).
- T004 before T005–T006 (the zone must exist before its click state + picker render are wired).
- T005 before T006 (state before render).
- Phase 3 (T008) depends on Phase 2's `label-popover:open` listener (T005).
- Phase 4: T009/T010/T011 are `[P]` (independent files); T012 (e2e) depends on the full UI (Phases 1–3).

## Acceptance

### Functional Completeness

- [x] A-001 R1: The 26px zone left of the status dot is one click/tap target that opens the combined Label picker anchored bottom-left of the row; the click does not select the row and coexists with drag-reorder; the StatusDot and window name keep their current x-positions.
- [x] A-002 R2: Hovering the row fades in the PaletteIcon (~65%) + ~12% zone glow; hovering the zone raises them to 100% / ~24%; icon color is the guarded family on colored rows, monochrome on uncolored.
- [x] A-003 R3: The marker stripe is display-only, inset 5px in its 14px zone, rendering dotted/solid/double in the guarded family color (gray uncolored); clicking it opens the picker (no cycle).
- [x] A-004 R4: The zone is interactive on coarse pointers (no `coarse:pointer-events-none`) — a tap opens the picker.
- [x] A-005 R5: The combined picker shows 10 color swatches + Clear + a separator + 4 marker cells; color selection writes via `familyToLegacy` (legacy vocabulary stored), marker selection calls `onSelectMarker` with no cycling; current values highlighted.
- [x] A-006 R6: The combined picker (and only it) uses zero border-radius, the `3px 3px 0 rgba(0,0,0,.35)` offset block shadow, 1px selection outlines, and 3px gaps; other popovers are visually unchanged.
- [x] A-007 R7: Keyboard nav reaches every color swatch, Clear, and all 4 marker cells; Enter/Space activates the focused item; Escape and outside-click close.
- [x] A-008 R8: The window-row right cluster shows only pin + kill (color button removed); session rows and server tiles still show their right-side color button.
- [x] A-009 R9: The palette exposes `Window: Label` (not `Window: Cycle Marker`), which opens the matching WindowRow's Label picker via the `label-popover:open` event.

### Behavioral Correctness

- [x] A-010 R3: Clicking the stripe/zone no longer cycles the marker — the only way to change a marker is the picker (verified by the rewritten unit + e2e tests).
- [x] A-011 R5: Color writes still go through `familyToLegacy` (e.g. orange → "1+3") so the backend validators accept them; marker writes go through the existing `setWindowMarker` path unchanged.

### Removal Verification

- [x] A-012 R9: `Window: Cycle Marker` no longer appears in the palette and `nextMarkerState`/gutter-cycling code paths for the window row are removed (no dead cycle handler). *(Rework: MET — `nextMarkerState()` and the orphaned `MarkerState` type deleted from `themes.ts`; the `MARKER_STATES` comment rewritten to the direct-pick (no-cycling) model; the stale `components/sidebar/index.tsx` comment corrected to "the picker passes the EXACT state". No `nextMarkerState` call sites or `window-cycle-marker` references remain.)*
- [x] A-013 R8: No color/palette button remains in the window-row right hover cluster.

### Scenario Coverage

- [x] A-014 R11: The rewritten e2e opens the picker from the zone, picks a color and a marker, asserts both persist via the options API, and asserts the zone click does not select the row.
- [x] A-015 R7: A unit test exercises keyboard traversal into the marker cells and activation.

### Edge Cases & Error Handling

- [x] A-016 R1: A gutter/zone click on an unselected row leaves it unselected (URL gains no window segment) — `stopPropagation` holds.
- [x] A-017 R5: The extended `SwatchPopover` renders identically to today (color-only, rounded) when the marker props and `square` flag are absent (session/server/palette-window-color callers unaffected).

### Code Quality

- [x] A-018 Pattern consistency: New code follows the surrounding patterns — the `label-popover:open` listener mirrors `pin-popover:open`; the picker anchoring mirrors the shipped popover; type narrowing over `as` casts.
- [x] A-019 No unnecessary duplication: The combined picker extends `SwatchPopover` (reusing its grid + keyboard nav + close logic) rather than forking a component; writes reuse `familyToLegacy` / `setWindowMarker`. *(Rework: MET — the duplicated stripe vocabulary now lives in ONE shared helper `markerStripeStyle` in `themes.ts` (next to `MARKER_STATES`), imported by both `swatch-popover.tsx` and `window-row.tsx`; the local copies are removed.)*
- [x] A-020 Test companion docs: The e2e `.spec.md` is updated in the same change as its `.spec.ts` (constitution: Test Companion Docs).
- [x] A-021 Verification gate: `cd app/frontend && npx tsc --noEmit` passes; `just test-frontend` and the rewritten e2e pass (pre-existing "Maximum update depth exceeded" console flake excepted).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/app.tsx` `Window: Set Color` palette action (window branch) + the app-level modal `SwatchPopover` window path — functionally shadowed by `Window: Label` (which sets color AND marker on the same row); kept deliberately per plan Design Decision 4 / intake assumption 10, surfaced for the human to decide whether the color-only window action should survive

*(Cycle-1 candidates executed during rework: `nextMarkerState()` + the orphaned `MarkerState` type deleted from `themes.ts`; the stale `MARKER_STATES` cycle comment and the `sidebar/index.tsx` `handleWindowMarkerChange` comment rewritten to the direct-pick model. No longer candidates.)*

## Assumptions

<!-- Apply-agent's record of graded decisions made while co-generating
     ## Requirements. All 11 intake assumptions are Certain/Confident and
     user-approved; the rows below are the additional inline implementation
     decisions this plan makes on top of the intake's fixed design. -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Extend `SwatchPopover` in place with optional marker props + a `square` flag (not a new `LabelPopover` component) | Intake §2 says "extends swatch-popover.tsx"; the color grid + keyboard nav + close logic are reused verbatim, marker section is additive and gated so existing callers are byte-identical | S:90 R:85 A:90 D:85 |
| 2 | Certain | `MarkerGutter` is repurposed into a 26px display-only `LabelZone` (icon+stripe), reusing the shipped absolute z-20 left-edge sibling + `pl-[18px]` content clearance | The StatusDot-clearance geometry (must-fix 3) and overflow-free root (must-fix 4) are already correct; only width/cursor/hover/onClick change — minimal-diff, honors the "don't overlay the dot" caution | S:90 R:85 A:90 D:90 |
| 3 | Certain | Picker anchored `absolute left-0 top-full z-50` below the row (left-anchored twin of the shipped right-anchored color popover) | Intake R1: "anchored at the row's left edge below the row"; reuses the proven plain-absolute anchoring, root stays overflow-free | S:90 R:85 A:90 D:90 |
| 4 | Certain | Palette action dispatches a new `label-popover:open` CustomEvent handled by the matching WindowRow | Intake §5 explicitly names the `pin-popover:open` imperative pattern as the model; keyboard-reachable per Constitution V | S:90 R:85 A:90 D:90 |
| 5 | Confident | Marker cells clear on `""` and call `onSelectMarker` directly; the `LabelZone` `onClick` opens the picker via a single `showLabelPicker` state (replacing the old `showColorPicker` + `cycleMarker`) | Intake R5 says "any state reachable in 2 clicks, no cycling"; consolidating to one state is the natural refactor but the exact state-var shape is an implementation choice | S:70 R:85 A:85 D:80 |
| 6 | Confident | LabelZone `aria-label` becomes "Set window label" and the e2e/unit selectors switch from "Cycle window marker" to the new label | The affordance is now a menu opener, not a cycle; the old label would misdescribe it. Exact wording is a low-stakes naming choice | S:65 R:90 A:80 D:75 |
| 7 | Confident | The intake §2 5×2-grid / 18px-cell / full-width-"Clear color" layout is gated to the `square` flag (the combined window-row Label picker instance ONLY); color-only callers (session/server/palette modal) keep the shipped 4-col / 20px / `col-span-2` "Clear". The picker text is "Clear color" under square, "Clear" otherwise | Intake §2 places the layout language under the "Combined Label picker" heading and §2's square styling is explicitly "scoped to this picker"; the rework brief requires color-only consumers stay visually unchanged. `square` is set only by the window-row combined instance, so tying the layout to it satisfies both. Nav math reads a single `gridCols` so the two layouts never drift | S:75 R:90 A:85 D:80 |

7 assumptions (4 certain, 3 confident, 0 tentative).
