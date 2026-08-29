# Plan: Window Row — Marker Well (3×3 mode × stage), Spring-Loaded Pad, Label Zone + Mobile Dot-Trigger Retirement

**Change**: 260829-yneo-window-row-marker-well-3x3
**Intake**: `intake.md`

## Requirements

> Source of truth for values: `intake.md` § What Changes (all twenty decisions were agreed by the user; the numbers below are copied from there). Design studies: `docs/wiki/marker-3x3-studies.html` (final), `mode-axis-studies.html`, `marker-axis-studies.html`, `window-row-studies.html`.

### Frontend: Marker vocabulary (`app/frontend/src/themes.ts`)

#### R1: Two-axis marker model replaces the 8 flat states
`themes.ts` SHALL export `MARKER_MODES = ["manual","auto","blocked"]`, `MARKER_STAGES = [1,2,3]`, `MARKER_STAGE_GLOSS = {1:"early",2:"mid",3:"done"}`, the `Marker = { mode, stage }` type, `parseMarker(value)` and `formatMarker(marker)`. `MARKER_STATES` and `markerStripeStyle` SHALL be removed (no re-export, no alias).

- **GIVEN** a stored value `"auto:2"` **WHEN** `parseMarker` runs **THEN** it returns `{ mode: "auto", stage: 2 }`
- **GIVEN** a bare mode `"blocked"` **WHEN** parsed **THEN** it returns `{ mode: "blocked", stage: 1 }` (bare mode renders at stage 1)
- **GIVEN** `""`, `null`, `undefined`, a retired token (`"hatch"`), or a malformed value (`"auto:4"`, `"auto:x"`) **WHEN** parsed **THEN** it returns `null`
- **GIVEN** `{ mode: "manual", stage: 3 }` **WHEN** `formatMarker` runs **THEN** it returns `"manual:3"` and `parseMarker(formatMarker(m))` round-trips for every mode × stage

#### R2: One fill renderer shared by the row well and the pad cells
`themes.ts` (or a sibling module it re-exports) SHALL own the fill rendering: `markerFillStyle(marker)` for `manual` (solid, `var(--color-marker-ink)`) and `blocked` (the existing 45° hatch gradient on a 12px tile) at widths **7 / 15 / 22px** for stages 1 / 2 / 3, and a `MarkerChevrons({ count })` renderer for `auto` drawing 1 / 2 / 3 right-pointing chevrons, each ≈4.2px wide × 10px tall at 7.2px pitch, stroke ≈1.8px, left-aligned and vertically centered (single row, never tiled). Both the row and the pad MUST consume these helpers (the vocabulary lives in exactly one place).

- **GIVEN** `{manual, 2}` **WHEN** rendered **THEN** the fill is a 15px-wide solid box in marker ink from x=0
- **GIVEN** `{auto, 3}` **WHEN** rendered **THEN** three chevrons are drawn inside a 22px box, no wider than the well
- **GIVEN** `{blocked, 1}` **WHEN** rendered **THEN** a 7px-wide hatch fill is drawn; the hatch tile math is unchanged from today's `hatch` case

### Frontend: Marker well + row geometry (`components/sidebar/window-row.tsx`)

#### R3: T4 well — drawn only on marked rows
A window row whose `parseMarker(win.marker)` is non-null SHALL render a display-only well: `absolute inset-y-0 left-0`, `width: 22px` (`MARKER_WELL_WIDTH = 22`), `pointer-events-none`, `aria-hidden`, `background: color-mix(in srgb, var(--color-marker-ink) 12%, transparent)`, `border-right: 1px solid color-mix(in srgb, var(--color-marker-ink) 30%, transparent)`, with the R2 fill inside it from x=0. Unmarked rows SHALL render nothing in the strip. The `STRIPE_EDGE_INSET` constant is removed (the well is flush at x=0). The well renders on BOTH pointer classes.

- **GIVEN** a row with `marker: "manual:1"` **WHEN** rendered **THEN** the well is present at `left:0; width:22px` with the 12%/30% color-mix styles and a 7px solid fill
- **GIVEN** a row with no marker **WHEN** rendered **THEN** no well element exists
- **GIVEN** stacked marked rows **WHEN** rendered **THEN** solid/hatch fills weld across rows (full height) and chevrons do not (centered glyph row)

#### R4: Content start is `pl-[30px]` on every pointer; the coarse split is removed
The row button SHALL keep `pl-[30px]` on fine pointers and SHALL use the same 30px start on coarse pointers (`coarse:pl-4` removed), giving an 8px gap between the well's right edge (x=22) and the status dot (x=30) that clears the waiting halo's 3px spread. `pr-*` values and the 56px status rail geometry are unchanged.

- **GIVEN** a coarse-pointer render **WHEN** the row mounts **THEN** the button class list contains `pl-[30px]` and not `coarse:pl-4`
- **GIVEN** a row whose dot carries the waiting halo **WHEN** the well is present **THEN** the halo's 3px spread does not overlap the well edge (22 + 3 < 30)

#### R5: `blocked` keeps the hazard-wedge pairing, in marker ink
A `blocked` row SHALL mount the existing `.rk-hazard` overlay (`absolute inset-0 z-[5] overflow-hidden pointer-events-none`, static, geometry unchanged) with `--rk-marker-color: var(--color-marker-ink)`; `manual` and `auto` rows mount no texture. The wedge does not vary by stage.

- **GIVEN** `marker: "blocked:2"` **WHEN** rendered **THEN** an `.rk-hazard` element exists on the row with `--rk-marker-color` set to the ink variable
- **GIVEN** `marker: "auto:3"` **WHEN** rendered **THEN** no `.rk-hazard` element exists

#### R6: Marker ink is a fixed theme-paired token
The marker (well, fill, hazard color, pad cells) SHALL use `var(--color-marker-ink)` and SHALL NOT read the row's family color (`markerColor` / `rowBorders`) nor fall back to gray. `markerColor` remains only for what still needs the family hue (the `FlairOverlay` `color` prop).

- **GIVEN** a colored (blue-family) row with `manual:2` **WHEN** rendered **THEN** the fill color is the marker ink, not the blue family hex
- **GIVEN** an uncolored row with `auto:1` **WHEN** rendered **THEN** the chevron is drawn in marker ink (not `var(--color-border)` gray)

### Frontend: Label zone retirement + hover shade

#### R7: The interactive `LabelZone` is removed
`window-row.tsx` SHALL no longer render the `LabelZone` component, its `zoneHover` state, `openLabelPicker`, `ICON_ZONE_WIDTH`, `ICON_EDGE_INSET`, the palette-icon reveal, or any element with `aria-label="Set tab label"`. The color + flair picker (`SwatchPopover`, anchored `absolute left-0 top-full z-50` at the row's bottom-left) remains reachable ONLY via the flyout card's `Change color…` row and the `label-popover:open` CustomEvent (palette `Tab: Label`). The row-root hover/focus flyout trigger is unchanged.

- **GIVEN** any window row on a fine pointer **WHEN** hovered **THEN** no palette icon and no zone glow appear, and no element labelled `Set tab label` exists in the DOM
- **GIVEN** the `label-popover:open` event for the row **WHEN** dispatched **THEN** the color + flair `SwatchPopover` opens at the row's bottom-left exactly as today

#### R8: Plain hover no longer shades the row; the held state still does
On plain hover the row background SHALL NOT change (drop `hover:bg-bg-card/50` on the uncolored branch and the colored branch's `onMouseEnter`/`onMouseLeave` `tint.hover` swap). While the row's flyout card is open (`flyout.open`) the row SHALL render the shade as today (`tint.hover` colored / `bg-bg-card/50` uncolored) plus `text-text-primary`. Hover text brightening and selection tint depth are unchanged.

- **GIVEN** a colored, unselected row **WHEN** the pointer hovers it (card not open) **THEN** its background stays `tint.base`
- **GIVEN** the same row **WHEN** its flyout card is open **THEN** its background is `tint.hover` and its text is `text-text-primary`

### Frontend: Spring-loaded marker pad (`components/sidebar/marker-pad.tsx`, new)

#### R9: Press target and gesture contract (fine pointer)
Every non-ghost window row wired with `onMarkerChange` + `server` SHALL render an invisible fine-pointer-only press target `absolute inset-y-0 left-0 w-[22px]` (`cursor: pointer`, no rest/hover visual). `pointerdown` on it SHALL `stopPropagation` (never selects the row), capture the pointer (`setPointerCapture` with the jsdom optional-call guards used by `useRailScrub`), and open the pad with the row's current cell highlighted (∅ on an unmarked row). `pointermove` while captured SHALL select relatively: highlighted cell = current cell + `round(dx / cellPitch)` columns (right = next stage; left past stage 1 = ∅) and + `round(dy / cellPitch)` rows (down = next mode), clamped to the grid edges (over-drag sticks to the edge cell), live-previewing the highlighted marker on the row. `pointerup` after movement SHALL commit (`onMarkerChange(server, session, windowId, formatMarker(cell))` or `null` for ∅) and close. `pointerup` with no cell change SHALL leave the pad open as a click menu.

- **GIVEN** a row at `manual:1` **WHEN** the user presses the strip and drags right one cell pitch and releases **THEN** `onMarkerChange` is called with `"manual:2"` and the pad closes
- **GIVEN** a row at `auto:2` **WHEN** the user presses and drags down one pitch **THEN** the highlight is `blocked:2` and the row previews a hatch fill until release
- **GIVEN** any row **WHEN** the user presses and releases without moving **THEN** no `onMarkerChange` call is made and the pad stays open
- **GIVEN** a row at `manual:3` **WHEN** the user drags right by 5 pitches **THEN** the highlight stays at `manual:3` (edge clamp)

#### R10: Click-menu mode, dismissal, wheel
In click-menu mode hovering a cell SHALL preview it on the row; clicking a cell SHALL commit and close; `Escape` or an outside pointerdown SHALL close and revert the preview to the committed marker. Wheel over the strip on a row that ALREADY carries a marker SHALL step the stage (`deltaY > 0` → next, `< 0` → previous, clamped 1..3, mode unchanged), `preventDefault`, and commit directly; on an unmarked row the wheel is not intercepted (the sidebar scrolls).

- **GIVEN** the pad open in click mode **WHEN** the user presses Escape **THEN** the pad closes and the row shows its committed marker
- **GIVEN** a row at `blocked:1` **WHEN** the user wheels down over the strip **THEN** `onMarkerChange` is called with `"blocked:2"`
- **GIVEN** an unmarked row **WHEN** the user wheels over the strip **THEN** no handler prevents default and no marker is written

#### R11: Pad geometry, placement, header
The pad SHALL render 3 mode rows × (one ∅ cell spanning the three rows + 3 stage columns), row labels `manual` / `auto` / `blocked`, a header line `<mode> · <stage gloss>` (or `∅` when the highlight is ∅), ≈54px label column and 26px cells in popover mode (≈166 × 110px), 28px cells in inline/card mode; each stage cell is a mini well (12% wash + 30% edge + R2 fill in marker ink); the highlighted cell carries a 1px `ring-text-primary`. Popover mode SHALL anchor at the well's right edge (x=22), vertically centered on the row, and clamp inside the sidebar's client rect (`rk-popup-elev`, `bg-bg-card`, 1px `border-border`, `z-50`).

- **GIVEN** the pad opens on the first visible row near the sidebar's top edge **WHEN** placed **THEN** its bounding box lies entirely inside the sidebar box
- **GIVEN** the highlight is `auto:2` **WHEN** rendered **THEN** the header reads `auto · mid`

#### R12: Keyboard + palette entry (Constitution V)
`app.tsx` SHALL register a `window-marker` action (`Tab: Marker`, same group as `window-label`) that dispatches `marker-pad:open` (`{ detail: { server, windowId } }`, the `label-popover:open` pattern). The matching row SHALL open the pad in click-menu mode with the current cell focused; arrow keys move the highlight (Left/Right = stage/∅, Up/Down = mode), `Enter`/`Space` commit, `Escape` reverts and closes. `Tab: Label` remains and opens the color + flair picker.

- **GIVEN** the palette action `Tab: Marker` for the current window **WHEN** run **THEN** that row's pad opens with focus inside it
- **GIVEN** the pad focused at `manual:1` **WHEN** ArrowRight then Enter **THEN** `onMarkerChange` receives `"manual:2"`

#### R13: Suppression and drag guard
While the pad is open or armed, the row's hover flyout SHALL be suppressed (`suppressed` gains `showMarkerPad` beside `showPinPopover || showLabelPicker`) and the row's `onDragStart` SHALL bail (no HTML5 drag starts from a strip press).

- **GIVEN** the user presses the strip **WHEN** the pointer then travels over the row body **THEN** no flyout card opens
- **GIVEN** a press-drag on the strip **WHEN** the browser would start a drag **THEN** `dragstart` is prevented

### Frontend: Coarse pointer (mobile)

#### R14: The status dot is not a flyout trigger; the rail is the only one
On coarse pointers the dot wrapper (`data-testid="status-dot-tap"`) SHALL carry no `scrub.handlers`, no `onClick` `stopPropagation`, and none of `coarse:min-w-[32px] coarse:min-h-[36px] coarse:justify-center coarse:touch-none` — the dot is a plain 7px glyph in the name flex row with the normal `gap-1.5`; a tap on it selects the row. The 56px rail keeps `{...scrub.handlers}` unchanged and is the sole flyout trigger; the strip has no press target on coarse (marker is set from the card's Marker row, R16).

- **GIVEN** a coarse render **WHEN** the user taps the dot **THEN** the row's `onSelect` fires and no card opens
- **GIVEN** a coarse render **WHEN** the user taps/scrubs the rail **THEN** the card opens exactly as today

#### R15: Held text brightening on coarse
While a coarse row's card is open (`flyout.open`) its text SHALL be `text-text-primary` (the desktop held cue), alongside the unchanged `railHeldBand` / `RAIL_HELD_SEAM` rail treatment.

- **GIVEN** a coarse row whose card is open **WHEN** rendered **THEN** the row button carries `text-text-primary`

### Frontend: Flyout card + SwatchPopover

#### R16: `Marker` action row with the inline pad
`row-flyout-card.tsx` `WindowFlyoutContent` SHALL render a `Marker` action row (`data-testid="row-flyout-marker-action"`) directly after `Change color…` (order: change-color → marker → fork → fix-tab-name → pin → kill) whenever `onMarkerChange` + `server` are wired (ghost rows / board-route sidebar render none), for ALL pointer classes. The row hosts the pad component inline in click mode with 28px cells; a cell tap writes the marker immediately via `onMarkerChange` and keeps the card open; ∅ clears.

- **GIVEN** the card open for a marked row **WHEN** the user taps the `blocked` / stage-3 cell **THEN** `onMarkerChange(..., "blocked:3")` is called and the card stays open with that cell highlighted
- **GIVEN** a ghost row **WHEN** its card would render **THEN** no `Marker` row exists

#### R17: `SwatchPopover` becomes color + flair only
`swatch-popover.tsx` SHALL drop the marker band, the `selectedMarker` / `onSelectMarker` props, `markerOverride`, the `clear-marker` keyboard row, the marker leg of the combo caption (now `{color} · {flair}`) and of the panel-level clear-all; the composite preview shows tint + flair + name with no marker stripe. The window row's call site passes no marker props; `aria-label` stays `Label picker` when flair is offered, `Color picker` for color-only callers.

- **GIVEN** the picker opened from the card's `Change color…` **WHEN** rendered **THEN** it has exactly two bands (color, flair) and no `Marker none` option
- **GIVEN** the picker's keyboard walk **WHEN** traversed **THEN** it visits color cells then flair cells with no marker row

### Frontend: Token

#### R18: `--color-marker-ink`
`globals.css` SHALL define `--color-marker-ink` in the `@theme` block, `html[data-theme="dark"]` (**#f59e0b**) and `html[data-theme="light"]` (**#d97706**), following the `--color-signal-yellow` pattern.

- **GIVEN** the dark theme **WHEN** `--color-marker-ink` resolves **THEN** it is `#f59e0b`; **GIVEN** light **THEN** `#d97706`

### Backend: `@rk_win_marker` value schema (`app/backend`)

#### R19: Closed set of 12 tokens on write
`internal/validate/validate.go` `markerTokens` SHALL become the ordered set `manual, manual:1, manual:2, manual:3, auto, auto:1, auto:2, auto:3, blocked, blocked:1, blocked:2, blocked:3` (`""` = unset via the existing `closedSet` idiom; error copy `Marker must be one of: … (or empty to clear)`). `ValidateMarkerValue` SHALL reject the retired tokens (`pipe`, `dotted`, `dashed`, `solid`, `double`, `thick`, `hatch`, `block`) → `POST /api/windows/{id}/options` returns 400 with zero tmux calls.

- **GIVEN** `{"@rk_win_marker":"auto:2"}` **WHEN** POSTed **THEN** 200 and the option is set
- **GIVEN** `{"@rk_win_marker":"hatch"}` **WHEN** POSTed **THEN** 400 and no tmux call is made

#### R20: Read-side legacy normalization
`internal/tmux` SHALL export `NormalizeMarker(raw string) string` mapping `pipe|dotted|dashed|solid → manual:1`, `double → manual:2`, `thick → manual:3`, `hatch → blocked:2`, `block → blocked:3`, passing new-scheme values through, and returning `""` for anything else. `parseWindows` (`tmux.go`) and the snapshot reader (`layout.go` field 27) SHALL apply it before the closed-set drop, so the frontend never sees a legacy token and snapshot restore re-applies the normalized value. No `legacy_options.go` row is added (same-name value remap). Doc comments on `WindowInfo.Marker`, `MarkerOption`, the options handler, and `client.ts` `setWindowMarker` describe the new vocabulary.

- **GIVEN** a live window with `@rk_win_marker=hatch` **WHEN** `/api/sessions` is served **THEN** its `marker` is `"blocked:2"`
- **GIVEN** an old snapshot with field 27 = `double` **WHEN** restored **THEN** the window option becomes `manual:2`

#### R21: Operator prompt vocabulary
`api/operator.go`'s `color-tabs` prompt line for `@rk_win_marker` SHALL list the new tokens, and the `promptVocab("@rk_win_marker") == closedSetTokens(validate.MarkerValues)` invariant test keeps passing.

- **GIVEN** the color-tabs template **WHEN** rendered **THEN** it lists `manual … blocked:3` and none of the retired tokens

### Docs

#### R22: Design studies land in `docs/wiki/` with index rows
The four study pages SHALL be copied from the session scratchpad (`/tmp/claude-1001/-home-sahil-code-sahil87-run-kit-worktrees-buffed-pika/320a4ab6-fd8c-4826-8287-57605af127c4/scratchpad/`) to `docs/wiki/window-row-studies.html`, `marker-axis-studies.html`, `mode-axis-studies.html`, `marker-3x3-studies.html`, and `docs/specs/index.md` § Wiki SHALL gain one row per page in the existing "… Self-contained; open in a browser" idiom (`marker-3x3-studies.html` described as the canonical final state; the other three as the iteration trail).

- **GIVEN** the repo after apply **WHEN** `docs/wiki/` is listed **THEN** the four files exist and each is referenced from `docs/specs/index.md`

### Non-Goals

- No fab/tooling writer for the marker (no `fab fff` stamping, no hooks) — declared-only; option names stay generic.
- No change to the label color families, shades, `familyToLegacy`, or the flair channel/vocabulary.
- No change to the status dot's derived vocabulary or the PR glyph; no change to the status rail geometry or the three-tier card shell.
- No second `@rk_win_stage` option; no new `/options` key; no `ListWindows` format-string change.
- Specs `docs/specs/themes.md` / `docs/specs/ui-state.md` are flagged for `/docs-hydrate-specs`, not edited here.

### Design Decisions

#### Marker is mode × stage, not a flat weight ladder
**Decision**: The marker carries two orthogonal axes — `mode` (categorical: manual / auto / blocked, encoded by SHAPE: solid / chevrons / hatch) × `stage` (ordinal: 1 / 2 / 3, encoded by WIDTH or chevron COUNT as ⅓ / ⅔ / full of a 22px well).
**Why**: The 8 flat states implied a progress ladder whose ink ran 1→6→6→6→6, so "how far" was unreadable and dashed ≈ block. Shape for kind + width for progress reads without a legend.
**Rejected**: Adding more pattern classes under the "categorical growth" rule (encodes neither axis legibly); making the 8 markers an ordinal slider (widths non-monotonic; a hatch = hazard row would read as 75% done).
*Introduced by*: 260829-yneo-window-row-marker-well-3x3

#### One fixed, theme-paired marker ink
**Decision**: `--color-marker-ink` (#f59e0b dark / #d97706 light) paints every marker; the marker no longer inherits the row's label hue and never falls back to gray.
**Why**: The marker is now an instrument; a constant ink lets the eye read the shape, not the hue. Uncolored rows previously got an invisible gray stripe.
**Rejected**: Inherit label hue (invisible on uncolored rows; legibility depends on the family picked); hue-by-mode (red/blue collide with the status dot and PR glyph); a small user palette (a third free axis — 36 states).
*Introduced by*: 260829-yneo-window-row-marker-well-3x3

#### The well is drawn, flush, on marked rows only (T4)
**Decision**: A 12% ink wash + 1px 30%-ink right edge occupies x=0–22 on rows that carry a marker; unmarked rows carry nothing; the dot stays at x=30.
**Why**: A ⅓ fill under a full slab read as a gap; the well gives 0→⅓→⅔→full a visible end. The 4px `STRIPE_EDGE_INSET` duplicated the shell's 6px inset ground + 1px card border, so removing it yields the 8px well→dot gap at zero name-width cost.
**Rejected**: A permanent column hairline on every row (a line on sidebars that never use markers); an outlined cell per row (a ladder of boxes, 2px of fill lost); moving the dot to 34 (pays 4px of name width for the same gap).
*Introduced by*: 260829-yneo-window-row-marker-well-3x3

#### Spring-loaded pad with relative drag (I3)
**Decision**: Press in the strip opens the pad; drag selects in 2D relative to the press point (clamped to the grid); release commits; a no-move release leaves a click menu. The pad clamps inside the sidebar rather than positioning the current cell under the pointer.
**Why**: One motion covers the common "bump the stage" while both axes stay discoverable (the pad is the legend). The pointer is 0–22px from the sidebar's left edge, so absolute placement would clip; relative selection keeps "one pitch right = +1 stage" true regardless of where the pad lands.
**Rejected**: One-step drag only (second axis undiscoverable, no mobile analogue); click-then-pick only (two clicks for the common bump); absolute hit-testing (clips at the edge).
*Introduced by*: 260829-yneo-window-row-marker-well-3x3

#### Hover shade is a held-state cue, not a hover cue
**Decision**: The row background shades only while its flyout card is open; plain hover brightens text only.
**Why**: On hover the card arms, the trailing cluster fades in and the background shifted — three competing lights. The held shade is the one that carries information (which row the card belongs to).
**Rejected**: Keep the hover shade (redundant with the card + cluster).
*Introduced by*: 260829-yneo-window-row-marker-well-3x3

#### The rail is the only coarse flyout trigger
**Decision**: The status dot's coarse tap zone is removed; the 56px rail alone opens the card; everything left of the rail is tap = select.
**Why**: The dot zone predates the rail and made the most common mobile gesture (tap a row to switch) misfire on ~32px beside every name; session/server dots were never triggers.
**Rejected**: Long-press on the row body as a secondary trigger (collides with reorder long-press, iOS callout, scroll-cancel).
*Introduced by*: 260829-yneo-window-row-marker-well-3x3

#### One option, `<mode>[:<stage>]`, with read-side legacy normalization
**Decision**: `@rk_win_marker` stores `mode` or `mode:stage`; a bare mode renders at stage 1; legacy tokens map forward on read (`NormalizeMarker`) and are rejected on write; no `@rk_win_stage`, no `legacy_options.go` row.
**Why**: One key keeps one registry row, one format-string field, one validator and one migration seam (`@rk_win_note`'s `<epoch>:<text>` is the precedent); the sweep table maps option NAMES, and this is a same-name VALUE remap that the parser normalizes.
**Rejected**: A second option (positional format-string change, two writes per change, half-set states).
*Introduced by*: 260829-yneo-window-row-marker-well-3x3

### Deprecated Requirements

#### Left-edge Label Zone (interactive 26px picker trigger)
**Reason**: Duplicates the card's `Change color…` row and the palette action; competes with the row-root hover flyout.
**Migration**: Color + flair via the card / `Tab: Label`; marker via the spring-loaded pad / `Tab: Marker` / the card's `Marker` row.

#### 8-state flat marker vocabulary (`MARKER_STATES`, `markerStripeStyle`)
**Reason**: Unreadable progress ladder; dashed ≈ block.
**Migration**: `MARKER_MODES` × `MARKER_STAGES`; legacy values normalize on read (R20).

#### Coarse status-dot tap zone as a secondary flyout trigger
**Reason**: Stale opener from before the status rail; misfires the tap-to-select gesture.
**Migration**: The rail (R14).

#### `coarse:pl-4` content start
**Reason**: The well needs the full 22px on coarse too; the reclaimed dot zone funds it.
**Migration**: `pl-[30px]` on every pointer (R4).

## Tasks

### Phase 1: Setup

- [x] T001 Bootstrap the worktree toolchain: `cd app/frontend && pnpm install --frozen-lockfile` (no `node_modules` exists in this worktree); confirm `npx tsc --noEmit`, `npx vitest run --reporter=dot src/themes.test.ts` and `cd app/backend && go test ./internal/validate/...` all run green BEFORE any edit (baseline). <!-- R1 -->
- [x] T002 `app/frontend/src/themes.ts` + `themes.test.ts`: replace `MARKER_STATES`/`markerStripeStyle` with `MARKER_MODES`, `MARKER_STAGES`, `MARKER_STAGE_GLOSS`, `Marker`, `parseMarker`, `formatMarker`, `markerFillStyle` (solid/hatch at 7/15/22px, marker ink) and the `MarkerChevrons` renderer (1/2/3 chevrons, 4.2×10px, 7.2px pitch, stroke 1.8, centered); tests for parse/format round-trip, bare-mode → stage 1, retired/malformed → null, fill widths and chevron counts. Leave call sites broken for T007/T011 to fix in this same apply (type check is the gate). <!-- R1 -->
- [x] T003 [P] `app/frontend/src/globals.css`: add `--color-marker-ink` to the `@theme` block, `html[data-theme="dark"]` (#f59e0b) and `html[data-theme="light"]` (#d97706), next to `--color-signal-yellow`; update the `.rk-hazard` comment to name `blocked`. <!-- R18 -->
- [x] T004 [P] `app/backend/internal/validate/validate.go` + `validate_test.go`: `markerTokens` → the 12 new tokens; `ValidateMarkerValue` copy; tests: every new token + `""` accepted, each retired token rejected, flair tokens still rejected. <!-- R19 -->
- [x] T005 <!-- rework: review should-fix — tmux.go:168-174 legacy-mapping comment says block→heaviest manual stage; the table maps block→blocked:3 — fix the comment --> [P] `app/backend/internal/tmux/tmux.go` + `layout.go` + tests: add `NormalizeMarker(raw) string` (legacy table, pass-through, else `""`), call it in `parseWindows` and in the `layout.go` field-27 reader before the closed-set drop; update `WindowInfo.Marker` / `MarkerOption` doc comments; table test for `NormalizeMarker`, `parseWindows` legacy → normalized, `layout_test.go` field-27 normalization. <!-- R20 -->
- [x] T006 [P] `app/backend/api/operator.go` `color-tabs` prompt vocabulary → new tokens; `api/windows.go` options-handler comment; `operator_test.go` (:889-890 expectation + the `promptVocab == closedSetTokens(MarkerValues)` invariant), `windows_test.go` POST `auto:2` → 200, retired token → 400 with zero tmux calls. Run `cd app/backend && go test ./...`. <!-- R21 -->

### Phase 2: Core Implementation

- [x] T007 `app/frontend/src/components/sidebar/window-row.tsx` — well + geometry + ink: delete `LabelZone`, `zoneHover`, `openLabelPicker`, `ICON_ZONE_WIDTH`, `ICON_EDGE_INSET`, `STRIPE_EDGE_INSET`; rename `LABEL_ZONE_WIDTH` → `MARKER_WELL_WIDTH = 22`; replace the display-only stripe with the T4 well (rendered only when `parseMarker(marker)` is non-null; `left:0; width:22px`; 12% wash + 30% right edge; R2 fill inside); `blocked` mounts `.rk-hazard` with `--rk-marker-color: var(--color-marker-ink)`, `manual`/`auto` mount no texture; the marker no longer uses `markerColor` (keep it for `FlairOverlay` only); button padding `pl-[30px]` on every pointer (remove `coarse:pl-4`); keep `label-popover:open` → `showLabelPicker` and the `SwatchPopover` mount, now without marker props. Drop the `PaletteIcon` import if unused. <!-- R3 -->
- [x] T008 `window-row.tsx` — hover shade held-only: remove `hover:bg-bg-card/50` from the uncolored branch and the colored branch's `onMouseEnter`/`onMouseLeave` `tint.hover` swap; keep the `flyout.open` held branch (`tint.hover` / `bg-bg-card/50` + `text-text-primary`) and verify it applies on coarse too. <!-- R8 -->
- [x] T009 `window-row.tsx` — coarse: remove `{...scrub.handlers}`, the `stopPropagation` `onClick`, and `coarse:min-w-[32px] coarse:min-h-[36px] coarse:justify-center coarse:touch-none` from the dot wrapper (keep `data-testid="status-dot-tap"`, `flex items-center shrink-0`); the rail keeps its handlers unchanged. <!-- R14 -->
- [x] T010 <!-- rework 2: review must-fix — pad popover ≈180px cannot fit the 160px minimum sidebar (chrome-context.tsx:20); make the pad shrink to fit every supported width and add first/last-row + min-width bounding-box tests --> <!-- rework: review must-fix — MARKER_PAD_CLEAR_VALUE exported with zero call sites (remove or use as the shared clear sentinel); nice-to-have: inert gridRef, misindented clear-cell props --> New `app/frontend/src/components/sidebar/marker-pad.tsx` + `marker-pad.test.tsx`: the pad component with two modes — `popover` (26px cells, anchored at x=22 on the row, clamped inside the sidebar rect, `rk-popup-elev bg-bg-card border border-border z-50`) and `inline` (28px cells, no chrome); grid = 3 mode rows × (∅ spanning 3 rows + 3 stage cells) each a mini well using the T002 helpers; header `<mode> · <gloss>` / `∅`; highlight ring; pure `selectCell(current, dx, dy, pitch)` relative-displacement + clamp math exported for tests; keyboard nav (arrows move, Enter/Space commit, Escape revert); click-mode hover preview + click commit; props `{ value: Marker|null, onPreview, onCommit, onCancel, mode, cellPx }`. Tests: grid math (relative, clamp, ∅ column, unmarked → ∅ with `manual` as the first downward row), header text, keyboard, click commit. <!-- R11 -->
- [x] T011 `window-row.tsx` — press target + gesture: fine-pointer-only `absolute inset-y-0 left-0 w-[22px] cursor-pointer` hit area on non-ghost rows with `onMarkerChange` + `server`; `pointerdown` → `stopPropagation`, capture (jsdom-guarded), open the pad in popover mode with the current cell; `pointermove` → relative select via the pad's math with live row preview; `pointerup` moved → commit + close, unmoved → stays open as click menu; Escape / outside pointerdown → revert + close; wheel over the strip on a MARKED row steps the stage (clamped, `preventDefault`) and commits, unmarked rows untouched; `marker-pad:open` CustomEvent listener (registered in the same `useEffect` as `label-popover:open`) opens click-menu mode with focus inside; `suppressed` gains `showMarkerPad`; `onDragStart` bails while armed. <!-- R9 -->
- [x] T012 <!-- rework: review should-fix — .rk-hazard-preview::before + its comment in globals.css are dead now that the marker preview is gone; delete --> `app/frontend/src/components/swatch-popover.tsx` + `swatch-popover.test.tsx`: remove the marker band, `selectedMarker`/`onSelectMarker`, `markerOverride`, the `clear-marker` keyboard row, the marker leg of the combo caption (`{color} · {flair}`) and of clear-all; composite preview shows tint + flair + name (no stripe); update the option-count / keyboard-walk tests and delete the marker-band cases. <!-- R17 -->
- [x] T013 <!-- rework 2: review should-fix — row-flyout-card.tsx:183,:936 comments still describe the dot as a scrub trigger; state the rail-only contract --> `app/frontend/src/components/sidebar/row-flyout-card.tsx` + `row-flyout-card.test.tsx`: add the `Marker` action row (`data-testid="row-flyout-marker-action"`) after `Change color…`, hosting the pad in `inline` mode (28px cells), rendered on all pointers when `onMarkerChange` + `server` are wired (none for ghosts / board-route); a cell tap calls `onMarkerChange` immediately and keeps the card open; thread the current `marker` + handler through `WindowFlyoutContent` props from `window-row.tsx`. <!-- R16 -->
- [x] T014 <!-- rework 2: review must-fix — app.tsx:2549 comment cites change-id (hwtr); strip provenance, keep the constraint --> `app/frontend/src/app.tsx` (+ its test) : register `window-marker` / `Tab: Marker` in the `terminal` group beside `window-label`, dispatching `marker-pad:open` for the current window; `Tab: Label` copy stays. <!-- R12 -->
- [x] T015 [P] Doc comments: `app/frontend/src/types.ts` `WindowInfo.marker`, `api/client.ts` `setWindowMarker`, `components/sidebar/index.tsx` marker prop-drilling comments → new vocabulary (no behavior change). <!-- R20 -->

### Phase 3: Integration & Edge Cases

- [x] T016 `app/frontend/src/components/sidebar/window-row.test.tsx`: retire the LabelZone suite, the coarse `grows the dot tap zone…` / `pointerdown on the tap zone opens the flyout…` tests and the `coarse left-zone reclaim` suite; add: well only on marked rows with the exact styles and `left:0; width:22px`; fills per mode/stage; `blocked` mounts `.rk-hazard` in ink; `pl-[30px]` on both pointers, no `coarse:pl-4`; press→drag→release commits `formatMarker`; no-move release keeps the click menu; Escape reverts; wheel steps only on marked rows; `marker-pad:open` opens the pad; no shade on plain hover, shade while held (both pointers); a coarse dot tap selects the row; the card's `Marker` row writes via `onMarkerChange`. Run `npx vitest run` for `src/components/sidebar` and `src/components/swatch-popover*` and `src/themes*`. <!-- R9 -->
- [x] T017 `app/frontend/tests/e2e/window-marker-gutter.spec.ts` rewrite (keep the `Proves:` / `Steps:` JSDoc discipline): pad press-drag-release persists `@rk_win_marker` = `manual:2` (poll `/api/sessions` `marker`); no-move release → click menu → click cell commits; wheel steps stage on a marked row; well renders on marked rows only, flush at x=0, 22px wide; `blocked` rows carry `.rk-hazard`, `manual`/`auto` do not; the strip press does not select the row; color/flair persistence tests keep passing via the card's `Change color…` (picker has two bands, no `Marker none`). <!-- R9 -->
- [x] T018 `app/frontend/tests/e2e/row-flyout.spec.ts`: the coarse tests at :690 and :727 open the card via `status-rail` instead of `status-dot-tap`; the rail test (:583) drops the ≥32×36 dot-zone and dot-as-secondary-tap steps and asserts a dot tap SELECTS the row; the `coarse left-zone reclaim` test (:820) asserts content starts ≈30px, the well exists on a marked row, and no `Set tab label` element exists on either pointer; update each touched `Proves:`/`Steps:`. <!-- R14 -->
- [x] T019 Removal sweep: `grep -rn "status-dot-tap\|Set tab label\|Marker none\|markerStripeStyle\|MARKER_STATES\|STRIPE_EDGE_INSET\|ICON_ZONE_WIDTH\|coarse:pl-4" app/frontend app/backend docs/specs` — every hit is either intentionally kept (`status-dot-tap` test id) or removed; `cd app/frontend && npx tsc --noEmit` clean. <!-- R7 -->
- [x] T023 Comment-provenance sweep (scoped to the diff's `+` lines): every comment line this change ADDED or MODIFIED is free of change/plan identifiers and removed-feature narration — verified over `git diff -U0` plus new files, not by whole-file grep; the stale label-zone claims at `window-row.tsx` ~:893,:896 are rewritten. Pre-existing citations on untouched lines are out of scope. <!-- R7 -->
- [x] T024 `Tab: Marker` regression test through the PRODUCTION path (review A-042, cycle 3): delete the test-only `buildTabPickerActions` copy in `app/frontend/src/app.test.tsx` (~:1090-1112) and instead either (a) extract the real builder from `app.tsx` (~:2559-2574) into an exported function the test imports, or (b) render AppShell and assert the palette exposes `Tab: Marker` and that running it dispatches `marker-pad:open` with the current window's `{ server, windowId }`; breaking or deleting the production `window-marker` registration MUST fail the test. Run `npx vitest run src/app.test.tsx`. <!-- R12 -->
- [x] T020 Gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit && npx vitest run`; `just test-e2e "window-marker-gutter"`; `just test-e2e "row-flyout"`; `just build`. Fix and re-run until green (escalate after 3 failed attempts on the same failure). <!-- R1 -->

### Phase 4: Polish

- [x] T021 [P] Copy the four study pages from the scratchpad path in R22 into `docs/wiki/` and add four rows to `docs/specs/index.md` § Wiki in the existing idiom (`marker-3x3-studies.html` = canonical final state; the other three = iteration trail). Verify each file has no external `src=`/`href=` resource. <!-- R22 -->
- [x] T022 [P] Visual check with the headless Chromium already in `~/.cache/ms-playwright` (or Playwright): 375px drawer (flush well, plain dot, rail-only card, Marker row in the card) and ≥1024px (well + pad on press, no hover shade, held shade with the card open), dark and light for the ink; save PNGs under the change folder as `visual-*.png` and note any deviation in `## Notes`. <!-- R3 -->

## Execution Order

- T001 first (toolchain baseline); T002 before T007/T010/T011/T012/T013 (shared vocabulary); T003–T006 are independent of the frontend work
- T007 → T008 → T009 → T011 edit the same file sequentially; T010 (pad component) must land before T011 and T013
- T012 before T007's final type check passes (the row's `SwatchPopover` call site loses marker props)
- T016–T019 after all Phase 2 tasks; T020 last in Phase 3; T021/T022 any time after T020

## Acceptance

### Functional Completeness

- [x] A-001 R1: `themes.ts` exports `MARKER_MODES`, `MARKER_STAGES`, `MARKER_STAGE_GLOSS`, `parseMarker`, `formatMarker`; `MARKER_STATES` and `markerStripeStyle` no longer exist anywhere in `app/frontend`
- [x] A-002 R2: one fill renderer (solid/hatch widths 7/15/22, chevrons 1/2/3) is consumed by both the row well and the pad cells — no second copy of the widths or chevron geometry
- [x] A-003 R3: a marked row renders the well at `left:0; width:22px` with the 12% wash and 30% right edge in `var(--color-marker-ink)`; an unmarked row renders nothing in the strip
- [x] A-004 R4: the row button has `pl-[30px]` on both pointers and no `coarse:pl-4`
- [x] A-005 R5: `blocked` rows mount `.rk-hazard` with `--rk-marker-color: var(--color-marker-ink)`; `manual`/`auto` rows mount no texture
- [x] A-006 R6: no marker rendering path reads `markerColor` / `rowBorders`; `markerColor` survives only as the `FlairOverlay` color
- [x] A-007 R7: `LabelZone`, `zoneHover`, `openLabelPicker`, `ICON_ZONE_WIDTH`, `ICON_EDGE_INSET`, `STRIPE_EDGE_INSET` and `aria-label="Set tab label"` are gone; `label-popover:open` still opens the color + flair picker at the row's bottom-left
- [x] A-008 R8: plain hover changes no row background on any pointer; `flyout.open` renders the held shade + `text-text-primary`
- [x] A-009 R9: press → drag one pitch right → release commits `formatMarker` with stage+1; drag down commits the next mode; over-drag clamps; a no-move release commits nothing and leaves the pad open
- [x] A-010 R10: click-mode hover previews, click commits, Escape/outside reverts; wheel steps the stage only on marked rows and never intercepts scroll on unmarked rows
- [x] A-011 R11: the pad has 3 mode rows, a ∅ cell spanning them, 3 stage columns, the `<mode> · <gloss>` header, 26px cells in popover mode / 28px inline, and clamps inside the sidebar box
- [x] A-012 R12: `Tab: Marker` (`window-marker`) is registered beside `Tab: Label` and dispatches `marker-pad:open`; the pad supports arrows / Enter / Space / Escape
- [x] A-013 R13: the hover flyout is suppressed while the pad is open/armed and `dragstart` is prevented during a strip press
- [x] A-014 R14: the coarse dot wrapper carries no scrub handlers or tap-zone classes; a dot tap selects the row; the rail keeps its handlers unchanged
- [x] A-015 R15: a coarse row with its card open carries `text-text-primary`
- [x] A-016 R16: the card renders `row-flyout-marker-action` after `Change color…` on all pointers when wired, hosting the inline 28px pad; a cell tap writes via `onMarkerChange` and keeps the card open; ghosts/board-route render no row
- [x] A-017 R17: `SwatchPopover` has no marker band/props; the composite preview shows no marker stripe; combo caption is `{color} · {flair}`
- [x] A-018 R18: `--color-marker-ink` is `#f59e0b` in the `@theme` + dark blocks and `#d97706` in the light block
- [x] A-019 R19: `ValidateMarkerValue` accepts the 12 new tokens + `""` and rejects every retired token; the options POST returns 400 for a retired token with zero tmux calls
- [x] A-020 R20: `NormalizeMarker` maps the legacy table forward, passes new values through, and is applied in `parseWindows` and the snapshot field-27 reader; no `legacy_options.go` row was added
- [x] A-021 R21: the `color-tabs` prompt lists the new tokens and the `promptVocab == closedSetTokens(MarkerValues)` invariant test passes
- [x] A-022 R22: the four study pages exist in `docs/wiki/` and `docs/specs/index.md` § Wiki lists each in the existing idiom

### Behavioral Correctness

- [x] A-023 R20: a live window carrying legacy `hatch` is served as `marker: "blocked:2"` and, after any new marker write, the tmux option holds only new-scheme values
- [x] A-024 R9: the row live-previews the highlighted cell during a drag and shows the committed marker after release (no stale preview)
- [x] A-025 R8: the held shade appears/disappears with the card on both pointer classes, without a hover shade in between

### Removal Verification

- [x] A-026 **N/A**: the literal repository-wide grep matches only negative test assertions proving the retired `Set tab label` affordance is absent; production references to all listed symbols/affordances are gone
- [x] A-027 **N/A**: the literal repository-wide grep matches only a negative e2e assertion proving `Marker none` is absent; production references to all listed symbols/affordances are gone
- [x] A-028 R14: `grep -rn "coarse:min-w-\[32px\]" app/frontend/src/components/sidebar/window-row.tsx` returns nothing; e2e specs no longer open the card via `status-dot-tap`

### Scenario Coverage

- [x] A-029 R9: `window-marker-gutter.spec.ts` covers press-drag-release persistence, the no-move click menu, wheel stepping, well-on-marked-rows-only, hazard-on-blocked, and strip-press-does-not-select, each with `Proves:`/`Steps:` JSDoc
- [x] A-030 R14: `row-flyout.spec.ts` coarse tests open the card via the rail, assert a dot tap selects, and the reclaim test asserts the ≈30px content start + well presence
- [x] A-031 R11: `marker-pad.test.tsx` covers relative displacement, clamping, the ∅ column, header text, keyboard nav and click-mode commit; the unmarked-row case asserts the first downward pitch enters `manual:1`.

### Edge Cases & Error Handling

- [x] A-032 R1: `parseMarker` returns `null` for `""`, `null`, `undefined`, retired tokens, out-of-range stages and malformed values — never throws
- [x] A-033 R11: opening the pad on the first/last visible row keeps it inside the sidebar box (clamped), and the relative drag still maps one pitch to one cell
- [x] A-034 R9: a strip `pointerdown` never selects the row and never starts an HTML5 drag; `setPointerCapture` is guarded for jsdom
- [x] A-035 R10: wheel over the strip on an unmarked row does not call `preventDefault`

### Code Quality

- [x] A-036 Pattern consistency: new code follows the row/popover idioms (`rk-popup-elev`, `bg-bg-card`, `border-border`, CustomEvent openers, jsdom-guarded pointer capture) and the Go closed-set / normalize-at-parser idioms
- [x] A-037 No unnecessary duplication: fill/chevron geometry, the well styles, and the pad grid math each live in exactly one module; `internal/tmux` owns `NormalizeMarker`
- [x] A-038 Type narrowing over assertions: `parseMarker` narrows with guards, no `as MarkerMode` casts on untrusted strings
- [x] A-039 Named constants: `MARKER_WELL_WIDTH`, stage widths, chevron geometry, cell pitches and the ink alphas are named, not inline magic numbers
- [x] A-040 No god functions: the pad's gesture handling and grid math are split (pure `selectCell` + component); no new function exceeds ~50 lines without reason
- [x] A-041 Comments state constraints, not narration — SCOPED TO LINES THIS CHANGE ADDED OR MODIFIED: no change-ids, plan IDs (R#/T#/A-#), or removed-feature narration in any comment the diff introduces or edits (source, unit tests, e2e specs); comments explain the relative-drag rationale, the well-only-on-marked rule, and the read-side normalization contract. Pre-existing historical citations on untouched lines are the repo's existing convention and out of scope (a repo-wide sweep is a separate change).
- [x] A-042 Tests cover added/changed behavior in vitest, Go tests and Playwright e2e per `code-quality.md` § Test Strategy; touched e2e tests carry updated `Proves:`/`Steps:`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Design references: `docs/wiki/marker-3x3-studies.html` § 1 (3×3 shapes + pad), § 3 T4 well, § 4 flush-well gap study; the live demos on that page are the gesture spec in motion.
- T022 visual check: no deviations observed across the six dark/light mobile, desktop-pad, and desktop-held captures saved as `visual-*.png`.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `plan.md` implements the intake's twenty decisions verbatim (values, file paths, geometry, tokens) — no re-derivation. | The intake was generated from the user's own agreed list and carries every value; the plan only structures it. | S:95 R:75 A:90 D:95 |
| 2 | Confident | Marker parsing/formatting/fill helpers live in `themes.ts` (the current vocabulary owner) rather than a new module. | `MARKER_STATES` + `markerStripeStyle` live there today and both the row and `swatch-popover` import from it; keeping the owner avoids an import churn across four files. A sibling module re-exported from `themes.ts` is acceptable if the file grows unwieldy. | S:70 R:90 A:85 D:75 |
| 3 | Confident | The pad component exposes a pure `selectCell(current, dx, dy, pitch)` for relative-displacement math and two render modes (`popover` / `inline`) instead of two components. | One grid, two chromes; a pure function makes the clamp/∅ rules unit-testable without pointer simulation. | S:65 R:90 A:85 D:75 |
| 4 | Confident | Chevrons render as inline SVG (three `<path>`s at 7.2px pitch) rather than a data-URI background, so the ink is `currentColor`/the CSS variable and scales with the cell. | Inline SVG reads the theme variable at paint time; a data-URI would have to bake the hex per theme. Either satisfies R2; SVG is the smaller surprise. | S:55 R:90 A:80 D:70 |
| 5 | Confident | `T001` installs the frontend toolchain in this worktree (`pnpm install --frozen-lockfile`) as a plan task rather than assuming it exists. | The worktree has no `node_modules`; `packageManager` is pinned to pnpm in `package.json`. | S:90 R:95 A:95 D:95 |
| 6 | Confident | Wheel-step and the click-menu fallback are implemented in `window-row.tsx` (the strip owner) with the pad supplying only the grid math and rendering. | Matches the intake's split (strip = press target on the row; pad = component) and keeps the pad reusable inline in the card with no gesture code. | S:60 R:85 A:80 D:70 |
| 7 | Confident | Visual verification (T022) uses the Playwright-installed headless Chromium already on the machine and stores PNGs in the change folder, not in `docs/`. | The e2e harness is the shipped visual path; PNGs are review evidence, not documentation. | S:55 R:95 A:80 D:75 |

7 assumptions (1 certain, 6 confident, 0 tentative).
