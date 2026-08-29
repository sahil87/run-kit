# Intake: Window Row — Marker Well (3×3 mode × stage), Spring-Loaded Pad, Label Zone + Mobile Dot-Trigger Retirement

**Change**: 260829-yneo-window-row-marker-well-3x3
**Created**: 2026-08-29

## Origin

Promptless dispatch (`/fab-proceed` create-new, `{questioning-mode} = promptless-defer`) from a design discussion the user held in this session over four interactive HTML design studies (`window-row-studies.html`, `marker-axis-studies.html`, `mode-axis-studies.html`, `marker-3x3-studies.html` — the last is the canonical final state: T4 well, flush, 3×3, ink pair, gap study). Every decision below was agreed by the user in that discussion; nothing here is invented. The synthesized description handed to the intake, verbatim:

> **Title suggestion**: Window Row — Marker Well (3×3 mode × stage), Spring-Loaded Pad, Label Zone + Mobile Dot-Trigger Retirement.
>
> **Why**: The sidebar window row's left 26px is a hover-revealed color-picker trigger that duplicates the flyout card's *Change color…* row and competes with the row-root hover flyout; the 8 flat marker states (pipe/dotted/dashed/solid/double/thick/hatch/block) carry implied progress conventions (parked→in-progress→review→completed→archived) but their ink widths run 1→6→6→6→6, so the ladder is unreadable, and dashed vs block are visually identical; on mobile the status dot's 32×36 tap zone still carries the rail's scrub handlers (a leftover from before the status rail existed), so a thumb near the name's left edge opens the flyout card instead of selecting the row.
>
> **Decisions (all agreed by the user):**
>
> Desktop row:
> 1. Remove the interactive LabelZone (`z-20` overlay, palette-icon glow, click-opens-picker). Color and flair are set only from the flyout card (`Change color…`) and the palette action (`label-popover:open`). The flyout trigger stays the row root hover (unchanged).
> 2. The left strip becomes the **marker well** with a **spring-loaded pad** as its only interaction (below).
> 3. Accepted small refinement: do not shade the row background on plain hover; reserve the hover shade for the *held* state (flyout card open), which the code already distinguishes (`window-row.tsx` ~L404-410).
>
> Mobile (coarse pointer) row:
> 4. The status dot stops being a flyout trigger: remove the `scrub.handlers` spread + `stopPropagation` from the dot zone (`window-row.tsx:644-649`) and its `coarse:min-w-[32px] coarse:min-h-[36px]` box; the dot returns to a plain 7px glyph with the normal `gap-1.5`. The 56px status rail is the sole flyout trigger; everything left of the rail is tap = select. Any e2e spec that taps the dot to open the card moves to the rail.
> 5. The coarse display-only stripe widens from ~8px to the full 22px well using the ~18px reclaimed from the dot zone (net-zero name width), so three chevrons fit. Marker is set on mobile from a **Marker** row in the flyout card (same pad component, click mode, 28px cells). The mobile drawer has no card chrome, so the flush well touches the viewport edge — accepted.
> 6. Accepted refinement: mirror the desktop held-row text brightening onto the coarse row while its card is open.
>
> Marker model (3×3):
> 7. Two axes replace the 8 flat markers: **mode** (vertical, categorical) × **stage** (horizontal, ordinal).
> 8. Modes: `manual` · `auto` · `blocked`. Shapes: manual = solid fill; auto = right-pointing chevrons `»`; blocked = hatch (keeps the existing hazard-wedge texture pairing). pipe/dotted/dashed/double/thick/block retire.
> 9. Stages: 1 · 2 · 3 = ⅓ · ⅔ · full of the 22px well. manual/blocked ink widths **7 / 15 / 22px**; auto = **1 / 2 / 3 chevrons**, each 4.2px wide × 10px tall at 7.2px pitch, stroke ~1.8px, vertically centered (single row, not tiled). Glosses: early · mid · done.
> 10. Storage: `@rk_win_marker` narrows to the 3 mode names plus a stage — either a second option `@rk_win_stage` or one `mode:stage` value (implementer's call; record as an assumption). Suggested legacy mapping for existing values (tunable): pipe→manual:1, solid→manual:1, thick→manual:3, double→manual:2, dotted→manual:1, dashed→manual:1, hatch→blocked:2, block→blocked:3. A mode with no stage renders at stage 1.
> 11. Write model: the option stays user-owned; tooling MAY stamp it at lifecycle boundaries (e.g. `fab fff` stamps `auto` on enter and clears on exit), never per-turn agent state; `blocked` is human-only. **Deferred out of this change**: the first cut is declared-only (human sets it); keep option names generic so a later tooling writer can stamp the same channel. Do not wire fab.
> 12. This revisits the recorded design decision "new marker states are pattern classes, never a new weight between existing ones" — deliberately: width becomes a separate ordinal axis rather than more markers. The hydrate must update that decision.
>
> Marker well (variant "T4"):
> 13. Well = 12% marker-ink wash across the 22px strip + a 1px right edge at 30% marker ink, drawn **only on rows that carry a marker**; unmarked rows carry nothing. The fill (solid/hatch width or chevron count) sits inside it, so 0 → ⅓ → ⅔ → full is legible and a ⅓ fill no longer reads as a gap next to a full slab.
> 14. Well is flush at x=0–22 of the row: `STRIPE_EDGE_INSET` 4 → 0. The dot stays at `pl-[30px]`, giving an 8px well→dot gap at zero cost (the desktop shell already places the sidebar card on a 6px inset ground behind a 1px card border). This also clears the waiting halo (3px spread).
>
> Marker ink:
> 15. One fixed theme-paired ink, no marker color picker: new token `--color-marker-ink` = **#f59e0b dark / #d97706 light** (paired like `--color-signal-yellow`). The marker no longer inherits the row's label/family color and no longer falls back to gray on uncolored rows. Label (row) color stays exactly as is and stays user-pickable from the card. Rejected: inherit label hue (uncolored rows get an invisible gray stripe), hue-by-mode (red/blue collide with the status dot and PR glyph), a small user palette (third axis, 36 states).
>
> Interaction (spring-loaded pad, variant "I3"):
> 16. Press (pointerdown) in the row's left strip → the pad opens; drag → 2D select (right = next stage, down = next mode); release → commit. Release without moving leaves the pad open as a click menu (hover previews on the row, click commits); Esc / outside click closes and reverts; wheel on the strip steps the stage. Keyboard: Enter opens, arrows move, Enter commits.
> 17. The pad clamps inside the sidebar box (it cannot place the current cell under a pointer that is 0–22px from the sidebar's left edge) and the drag is **relative**: the highlighted cell follows the pointer's displacement from the press point; over-drag sticks to the edge cell; the current cell highlights on press; a no-move release changes nothing.
> 18. Pad geometry: 3 mode rows × (∅ + 3 stage columns); ∅ spans the three rows and clears both axes; row labels are the mode words; header line reads `<mode> · <stage gloss>`; ~54px label column + 26px cells ≈ 166×110px on desktop; 28px cells when inline in the mobile card. Rejected: one-step drag-only (second axis undiscoverable, no mobile analogue) and click-then-pick only (two clicks for the common bump).
> 19. The card's `Change color…` band becomes color + flair only (the existing SwatchPopover minus its marker band); the marker band is replaced by the Marker row/pad.
>
> Docs:
> 20. Move the four design-study HTML pages into `docs/wiki/` alongside the existing studies and list them in `docs/specs/index.md` § Wiki, following the existing "Self-contained; open in a browser" description idiom: `window-row-studies.html`, `marker-axis-studies.html`, `mode-axis-studies.html`, `marker-3x3-studies.html` (copy them in; the last one is the canonical final state — T4 well, flush, 3×3, ink pair, gap study).
>
> **Non-goals**: no fab/tooling writer for the marker; no change to the label color families or the flair channel; no change to the status dot's derived vocabulary; no change to the status rail geometry.

Interaction mode: one-shot promptless dispatch — no questions were asked; every decision the intake would otherwise have asked about is recorded in `## Assumptions` (none scored Unresolved — the description is specific enough that each would-be question has a defensible default).

## Why

**Three pain points on the sidebar window row, all in the same 26px.**

1. **The left-edge label zone duplicates and competes.** On fine pointers the 26px left of the status dot is a `z-20` interactive overlay (`window-row.tsx` `LabelZone`) that reveals a palette icon + a family-tinted glow on row hover and opens the banded Label picker on click. The same picker is already reachable from the flyout card's first action row (`Change color…`, `row-flyout-card.tsx`) and from the `Tab: Label` palette action (`label-popover:open`). Two openers for one picker is chrome without information, and the zone's own hover glow fights the row-root hover flyout (the row is the flyout's floating reference; the zone is a second hover story painted on top of it). Consequence of leaving it: every window row keeps a hover affordance that most users never need, and the marker axis has no interaction of its own — a marker change is a three-step trip through a color picker.

2. **The 8 flat marker states are an unreadable ladder.** `MARKER_STATES = ["", "pipe", "dotted", "dashed", "solid", "double", "thick", "hatch", "block"]` carries *suggested* progress conventions (pipe = parked, hatch = in-progress, double = review, thick = completed, block = archived) but the ink widths run 1 → 3 → 3 → 3 → 6 → 6 → 6 → 6px (`markerStripeStyle`): the eye cannot rank "parked → in-progress → review → completed → archived" from stripes whose weights do not move in that order, and `dashed` (3px, 8-on/4-off) vs `block` (6px, 9-on/3-off) are visually near-identical at row scale. The recorded design decision ("marker growth is categorical — new pattern classes, never new weights") was right that a single weight ladder cannot encode categories, but the vocabulary that grew under it ended up encoding neither categories nor progress legibly. Consequence: users cannot read a window's declared progress at a glance — the one job a left-edge marker exists for.

3. **The mobile dot is a stale flyout trigger.** On coarse pointers the status dot's wrapper is a `coarse:min-w-[32px] coarse:min-h-[36px]` tap zone that still spreads `scrub.handlers` + `stopPropagation` (`window-row.tsx:644-649`) — the SECONDARY opener from before the 56px status rail existed (260816-b8eu / 260817-ve5m made the rail the primary). A thumb landing near the name's left edge opens the flyout card instead of selecting the row. Consequence: the most common mobile gesture (tap a row to switch to it) misfires on the ~32px next to every name.

**Why this approach.** Replace the flat vocabulary with two orthogonal axes — **mode** (categorical: `manual` / `auto` / `blocked`, carried by *shape*: solid / chevrons `»` / hatch) × **stage** (ordinal: 1 / 2 / 3, carried by *width*: ⅓ / ⅔ / full of a 22px well) — so shape says *what kind* and width says *how far*, and the ladder reads without a legend. Draw the empty part of the ladder too (the **well**: a 12% ink wash + 1px 30%-ink right edge, on marked rows only) so a ⅓ fill reads as one-third rather than as a gap. Give the marker its own gesture — a **spring-loaded pad** (press → 2D drag → release commits; a no-move release leaves a click menu) — so the common "bump the stage" is one press-drag-release and both axes are discoverable, while the color/flair picker stays where it already lives (card + palette). Paint the marker in one fixed theme-paired **ink** (`--color-marker-ink`) so it reads identically on colored and uncolored rows and never collides with the status dot / PR glyph hues. On mobile, drop the dot's trigger role so the rail is the *only* flyout trigger and everything left of it is tap = select, and widen the display-only strip to the full 22px well so three chevrons fit; the marker is set from a **Marker** row in the card (same pad component, click mode).

Rejected alternatives (from the discussion): inherit the label hue for the marker (uncolored rows get an invisible gray stripe); hue-by-mode (red/blue collide with the status dot and PR glyph vocabularies); a small user palette for marker color (a third axis — 36 states); a one-step drag-only pad (the second axis is undiscoverable and has no mobile analogue); click-then-pick only (two clicks for the common bump). Design studies: `docs/wiki/marker-3x3-studies.html` (final), `mode-axis-studies.html`, `marker-axis-studies.html`, `window-row-studies.html` (this change moves them in).

## What Changes

### 1. Desktop row — retire the interactive `LabelZone`

`app/frontend/src/components/sidebar/window-row.tsx`:

- Delete the `LabelZone` component, its props type, the `zoneHover` state, `openLabelPicker`, and the constants `ICON_ZONE_WIDTH` / `ICON_EDGE_INSET`. `LABEL_ZONE_WIDTH` is renamed/repurposed as the well width (`MARKER_WELL_WIDTH = 22`) and `STRIPE_EDGE_INSET` goes 4 → 0 (i.e. the constant is removed; the well is flush at `left: 0`).
- Remove the `PaletteIcon` import from the row if it becomes unused (the card's `Change color…` row still uses it in `row-flyout-card.tsx`).
- The `aria-label="Set tab label"` element no longer exists anywhere. Color + flair are set only via the flyout card's `Change color…` row and the `Tab: Label` palette action (`label-popover:open`, `app.tsx` ~L2545-2565) — both keep opening `showLabelPicker` / the `SwatchPopover` anchored `absolute left-0 top-full z-50` at the row's bottom-left, unchanged.
- The flyout trigger stays the row root hover / keyboard focus (`useRowFlyout` reference on the row root) — unchanged.
- The button content start stays `pl-[30px]` on fine pointers.

### 2. Hover shade → held-only

`window-row.tsx` `buttonClass` / `buttonStyle` / `onMouseEnter` / `onMouseLeave` (~L390-420):

- **Plain hover no longer shades the row background** on any pointer: drop `hover:bg-bg-card/50` from the uncolored branch and drop the colored branch's `onMouseEnter`/`onMouseLeave` `tint.hover` swap.
- **Held state keeps the shade**: while `flyout.open` is true the row renders `tint.hover` (colored) / `bg-bg-card/50` (uncolored) exactly as today — the held-row continuity cue the code already distinguishes (`flyout.open ? tint.hover : tint.base`; `flyout.open ? " text-text-primary bg-bg-card/50" : ""`).
- Hover **text** brightening (`hover:text-text-primary`) is untouched; selection tint depth (`tint.selected` / gray sentinel) is untouched.

### 3. Marker model — 3×3 mode × stage

`app/frontend/src/themes.ts` (the single vocabulary owner, replacing `MARKER_STATES` + `markerStripeStyle`):

```ts
export const MARKER_MODES = ["manual", "auto", "blocked"] as const;   // vertical axis, categorical
export type MarkerMode = (typeof MARKER_MODES)[number];
export const MARKER_STAGES = [1, 2, 3] as const;                      // horizontal axis, ordinal
export type MarkerStage = (typeof MARKER_STAGES)[number];
export const MARKER_STAGE_GLOSS: Record<MarkerStage, string> = { 1: "early", 2: "mid", 3: "done" };
export type Marker = { mode: MarkerMode; stage: MarkerStage };
/** Parse the stored `@rk_win_marker` value. `"auto"` (no stage) → stage 1.
 *  Unknown / empty → null (no marker). */
export function parseMarker(value: string | null | undefined): Marker | null;
/** `formatMarker({mode, stage})` → `"auto:2"` — the stored form. */
export function formatMarker(m: Marker): string;
```

Rendering per mode (all in `var(--color-marker-ink)`, § 5):

| Mode | Shape | Stage 1 | Stage 2 | Stage 3 |
|------|-------|---------|---------|---------|
| `manual` | solid fill from the left edge | 7px | 15px | 22px |
| `auto` | right-pointing chevrons `»`, single row, vertically centered — each 4.2px wide × 10px tall, 7.2px pitch, stroke ≈1.8px, left-aligned in the well | 1 chevron | 2 chevrons | 3 chevrons |
| `blocked` | hatch fill from the left edge (the existing 45° weave on a 12px tile, `markerStripeStyle("hatch")`'s gradient) | 7px | 15px | 22px |

- Widths are ⅓ / ⅔ / full of the 22px well (7 / 15 / 22 — the study's rounding; three chevrons at 7.2px pitch ≈ 21.6px also fill it).
- `blocked` keeps the **hazard-wedge texture pairing**: a `blocked` row mounts the existing `.rk-hazard` overlay (dedicated `absolute inset-0 z-[5] overflow-hidden pointer-events-none` inner element, static, 22%/55% left-edge mask unchanged) with `--rk-marker-color` set to `var(--color-marker-ink)`. The wedge does not vary by stage. `manual` and `auto` are texture-free.
- Retired states: `pipe`, `dotted`, `dashed`, `solid`, `double`, `thick`, `block` (as stored tokens) and `hatch` (as a token — it lives on as `blocked`'s shape).
- Markers stay **fully static** (the motion split — all row motion is flair's).
- A helper such as `markerFillStyle(marker: Marker): CSSProperties` (solid/hatch fills) plus a small `MarkerChevrons({ count })` inline-SVG (or equivalent CSS) render the fill; both the row well and the pad cells consume them so the vocabulary lives in exactly one place (the `markerStripeStyle` sharing rule carried forward).

### 4. Storage — `@rk_win_marker` = `<mode>[:<stage>]`, legacy mapping, validator

**Schema (assumption #2)**: a single option, `@rk_win_marker`, whose value is `<mode>` or `<mode>:<stage>` — `manual`, `manual:1` … `blocked:3`. The bare mode is a valid stored state (tooling may later stamp `auto` alone) and **renders at stage 1**. No second `@rk_win_stage` option; no new registry row; the `ListWindows` format string, `layout.go` snapshot field 27, and the `/options` allowlist key are unchanged. Names stay generic (`manual`/`auto`/`blocked`, `1`/`2`/`3`) so a later tooling writer stamps the same channel.

**Backend** (`app/backend/internal/validate/validate.go`, `internal/tmux/tmux.go`, `api/windows.go`):

- `markerTokens` becomes the 12-token ordered closed set `manual, manual:1, manual:2, manual:3, auto, auto:1, auto:2, auto:3, blocked, blocked:1, blocked:2, blocked:3` (+ `""` = unset, via the existing `closedSet`/`validateClosedSet` idiom, error copy `"Marker must be one of: … (or empty to clear)"`). `ValidateMarkerValue` rejects the retired tokens on write (`pipe`, `dotted`, …, `hatch`, `block` → 400 from `POST /api/windows/{id}/options`, zero tmux calls — the existing all-or-nothing contract).
- `parseWindows` (`tmux.go`) and the snapshot reader (`layout.go` field 27) **normalize legacy tokens on read** through one shared `tmux.NormalizeMarker(raw) string` helper before the closed-set drop: `pipe→manual:1`, `dotted→manual:1`, `dashed→manual:1`, `solid→manual:1`, `double→manual:2`, `thick→manual:3`, `hatch→blocked:2`, `block→blocked:3`; new-scheme values pass through; anything else → `""`. The frontend therefore never sees a legacy token; the tmux option itself is rewritten on the user's next marker write (no once-per-server sweep row is required — `legacy_options.go`'s table maps *names*, and this is a same-name *value* remap; assumption #3). Snapshot restore (`rk mux snapshot restore`) re-applies the *normalized* value.
- Doc comments on `WindowInfo.Marker`, `MarkerOption`, `optKeyMarker`, and `client.ts` `setWindowMarker` update to the new vocabulary.
- `api/operator.go` `color-tabs` prompt line `tmux set-option -t @N '@rk_win_marker' '<value>'   (pipe dotted dashed solid double thick hatch block)` → the new tokens; `operator_test.go:889-890` and the `promptVocab("@rk_win_marker") == closedSetTokens(validate.MarkerValues)` invariant (`operator_test.go:935`) keep the prompt honest.
- Tests: `validate_test.go` `TestValidateMarkerValue` (new set accepted, retired tokens rejected, flair tokens still rejected), a `NormalizeMarker` table test, `tmux_test.go` parseWindows legacy → normalized, `layout_test.go` field-27 normalization, `windows_test.go` options POST with `auto:2` / retired token → 400.

**Frontend plumbing**: `WindowInfo.marker?: string` (`types.ts`) stays a string (the stored form); `setWindowMarker(server, windowId, marker | null)` (`client.ts`) unchanged in shape (`null`/`""` clears via `"@rk_win_marker": ""`); `sidebar/index.tsx` `handleWindowMarkerChange` → `onWindowMarkerChange` → `WindowRow.onMarkerChange(server, session, windowId, marker | null)` unchanged in shape — the pad passes `formatMarker(...)` or `null`.

### 5. Marker ink token

`app/frontend/src/globals.css`: add `--color-marker-ink` in all three places the signal hues live — the `@theme` block, `html[data-theme="dark"]`, and `html[data-theme="light"]` (the `--color-signal-yellow` pattern): **`#f59e0b` dark / `#d97706` light** (assumption #4 records the study's `#c97400` candidate). Tailwind then also yields `text-marker-ink` / `bg-marker-ink` / `border-marker-ink` utilities; the row uses the CSS variable inline.

- The marker **no longer** reads the row's guarded family color (`markerColor` from `rowBorders`) and no longer falls back to gray on uncolored rows. `markerColor` remains for what still needs the family hue — the `FlairOverlay` `color` prop (rain/scan tint). The hazard wedge's `--rk-marker-color` custom property is set to `var(--color-marker-ink)` on `blocked` rows.
- Label (row) color and flair stay exactly as they are and stay user-pickable from the card.
- Contrast note from the study: `#d97706` measures ≈3.0:1 on the light backgrounds (the WCAG 1.4.11 graphics bar), `#f59e0b` is the dark-theme ink as-is.

### 6. Marker well (T4) — geometry and rendering

`window-row.tsx`, replacing the display-only stripe block (currently `left: STRIPE_EDGE_INSET, width: LABEL_ZONE_WIDTH - STRIPE_EDGE_INSET`):

- **Well** = an `absolute inset-y-0 left-0` element, `width: 22px`, `pointer-events-none`, `aria-hidden`, rendered **only when the row carries a marker** (`parseMarker(marker) !== null`); unmarked rows render nothing in the strip. Style: `background: color-mix(in srgb, var(--color-marker-ink) 12%, transparent)` + `border-right: 1px solid color-mix(in srgb, var(--color-marker-ink) 30%, transparent)` (the 1px edge is the well's right boundary at x≈22; the 22px box includes it).
- **Fill** sits inside the well from x=0: solid/hatch at 7/15/22px width (§ 3), or 1/2/3 chevrons for `auto`, vertically centered in the row (single row, not tiled — the chevrons do not weld across stacked rows; solid/hatch fills still weld because they are full-height).
- **Flush**: `STRIPE_EDGE_INSET` 4 → 0 — the well occupies sidebar x = 0…22 on both pointer classes. The desktop shell already places the sidebar card on a 6px inset ground behind a 1px card border, so a flush well reads inside the card; in the mobile drawer (no card chrome) the well touches the viewport edge — accepted.
- **Dot gap**: the button content stays `pl-[30px]` → an 8px gap between the well's right edge (22) and the dot's leading edge (30), clearing the waiting halo's 3px `box-shadow` spread. On coarse the content start becomes the same `pl-[30px]` (the current `coarse:pl-4` = 16px is removed — see § 8; the name gains ≈11px, § 8).
- Well/fill are display-only on every pointer; the **interaction** target is the strip itself (§ 7), fine-pointer-only.
- Z-order unchanged: well `z-10` above the button background; hazard/flair overlays `z-[5]` below it; the pad popover `z-50`.

### 7. Spring-loaded pad (I3) — fine-pointer interaction

New component `app/frontend/src/components/sidebar/marker-pad.tsx` (name indicative), consumed by `window-row.tsx` (desktop, popover mode) and `row-flyout-card.tsx` (card, inline click mode — § 9).

**Press target**: an invisible `absolute inset-y-0 left-0 w-[22px]` hit area on every non-ghost window row wired with `onMarkerChange` + `server` (fine pointers only — on coarse the strip is inert and tap = select, § 8). `cursor: pointer`; no rest or hover visual on unmarked rows (the well appears only once a marker is set — assumption #7). The hit area `stopPropagation`s pointerdown/click so a press never selects the row and never starts an HTML5 drag (`e.preventDefault()` on `dragstart` while the pad is armed, the same guard the scrub uses via `scrubActiveRef`).

**Gesture contract** (decisions 16–17):

1. `pointerdown` in the strip → the pad opens immediately; the **current cell** (the row's current `{mode, stage}`, or ∅ on an unmarked row) highlights; the pointer is captured (`setPointerCapture`, the `useRailScrub` idiom with the optional-call jsdom guards).
2. `pointermove` while captured → **relative 2D select**: the highlighted cell = current cell + `round(dx / cellPitch)` columns (right = next stage, left = previous stage → ∅ past stage 1) and + `round(dy / cellPitch)` rows (down = next mode, up = previous mode), each clamped to the grid edges — over-drag sticks to the edge cell. The row **live-previews** the highlighted cell's marker while dragging (the picker's preview-state idiom).
3. `pointerup` after movement → **commit** the highlighted cell (`onMarkerChange(server, session, windowId, formatMarker(cell))`, or `null` for ∅) and close.
4. `pointerup` **without movement** (no cell change) → the pad **stays open as a click menu**: hovering a cell previews it on the row, clicking a cell commits and closes; `Escape` or an outside click closes and **reverts** the preview; a no-move release by itself changes nothing.
5. **Wheel on the strip** steps the stage (`deltaY > 0` → next stage, `< 0` → previous; clamped at 1 and 3; no mode change) and commits directly (assumption #6 records the gating default — only on rows that already carry a marker, so unmarked rows scroll the sidebar normally).
6. **Keyboard** (Constitution V): a new palette action `window-marker` / `Tab: Marker` dispatches `marker-pad:open` (`{ detail: { server, windowId } }`, the `label-popover:open` / `pin-popover:open` pattern) and the matching row opens the pad in click-menu mode with the current cell focused; arrow keys move the highlight (Left/Right = stage/∅, Up/Down = mode), `Enter`/`Space` commit, `Escape` reverts and closes (assumption #5 — "Enter opens" is satisfied at the palette action, since Enter on the focused treeitem row is the tree's activate-and-select key).

**Placement**: anchored beside the row (left edge at the well's right edge, x=22, vertically centered on the pressed row), **clamped inside the sidebar box** (`shift`/clamp to the sidebar's client rect), so the pad can never position the current cell under a pointer that is 0–22px from the sidebar's left edge — which is exactly why the drag is relative rather than absolute. Portal/elevation follow the existing popover idioms (`rk-popup-elev`, `bg-bg-card`, 1px `border-border`).

**Pad geometry** (decision 18):

```
┌─────────────────────────────────────────┐
│ <mode> · <stage gloss>          (header) │   e.g. "auto · mid"; "∅" when the highlight is on ∅
├──────────┬────┬────┬────┬────┐          │
│ manual   │    │ ▍  │ ▌  │ █  │          │   row label column ≈54px; cells 26px (desktop) / 28px (card)
│ auto     │ ∅  │ »  │ »» │ »»»│          │   ∅ is ONE cell spanning the three mode rows — clears both axes
│ blocked  │    │ ░  │ ░░ │ ░░░│          │   each stage cell is a mini well preview (12% wash + edge + fill) in marker ink
└──────────┴────┴────┴────┴────┘          │   ≈166 × 110px on desktop
```

- Highlight = a 1px `ring-text-primary` on the current/hovered cell (the picker's selection ring idiom); the header line names the highlighted cell.
- On an unmarked row the current cell is ∅ and the vertical reference row for the first downward step is `manual` (assumption #8).

**Suppression/precedence**: the flyout card's `suppressed` gate gains `showMarkerPad` alongside `showPinPopover || showLabelPicker` (a pad press must not open/flash the card; the row's hover flyout is suppressed while the pad is open); the row's `onDragStart` guard also bails while the pad is armed.

### 8. Mobile (coarse pointer) row

`window-row.tsx`:

- **Dot zone retired as a trigger** (decision 4): the dot wrapper `<span data-testid="status-dot-tap" …>` loses `{...scrub.handlers}`, its `onClick={e => e.stopPropagation()}`, and the classes `coarse:min-w-[32px] coarse:min-h-[36px] coarse:justify-center coarse:touch-none` — the dot is a plain 7px glyph in the name flex row with the normal `gap-1.5`; the wrapper keeps `flex items-center shrink-0` (and may keep the test id). The **56px status rail is the sole flyout trigger** (`{...scrub.handlers}` stay on the rail only; `useRailScrub` itself is unchanged); everything left of the rail is tap = select.
- **Well on coarse**: the same 22px well + fill (§ 6) renders on coarse rows (display-only, inert — the strip has no press target on coarse; marker is set from the card's Marker row, § 9). The `coarse:pl-4` content start is replaced by the shared `pl-[30px]`: content start 16 → 30px (+14), the dot's box 32 → 7px (−25) → the name's start moves from ≈54px to ≈43px (net ≈+11px name width; the description's "net-zero" is approximate — the reclaimed dot zone funds the wider well and the 8px gap). Three chevrons fit in the 22px well.
- **Held text brightening on coarse** (decision 6): while the row's card is open (`flyout.open`), the coarse row's text brightens to `text-text-primary` — the same class the desktop held state already applies (it is currently in the class string on every pointer; verify it is not masked on coarse and pair it with the held rail treatment `railHeldBand` / `RAIL_HELD_SEAM`, unchanged).
- Status rail geometry (`STATUS_RAIL_WIDTH_PX = 56`, slots, `coarse:pr-[56px]`) is unchanged (non-goal).

### 9. Flyout card — `Change color…` becomes color + flair; new `Marker` row

`row-flyout-card.tsx` `WindowFlyoutContent` + `window-row.tsx`:

- The row's `SwatchPopover` call site drops `selectedMarker` / `onSelectMarker`, so the picker renders its **color + flair** variant (the same variant session rows and the server-group header already use) — no `[ marker ]` band. `swatch-popover.tsx`: remove the marker band, the `selectedMarker`/`onSelectMarker` props, `markerOverride`, the `clear-marker` keyboard row, the marker leg of the combo caption and of the panel-level clear-all; the composite preview row shows the row's tint + flair + name (the preview no longer draws a marker stripe — the marker is not this picker's axis; assumption #9). `aria-label="Label picker"` when flair is offered, `Color picker` for color-only callers (as today).
- New action row **`Marker`** in the card's sectioned `CardActionList`, placed directly after `Change color…` (order: change-color → marker → fork → fix-tab-name → pin → kill; `data-testid="row-flyout-marker-action"`), rendered whenever `onMarkerChange` + `server` are wired (the optional-handler idiom — ghost rows / the board-route sidebar render no row). The row hosts the **same pad component inline in click mode with 28px cells** (no popover): tapping/clicking a cell writes the marker immediately (`onMarkerChange`) and keeps the card open (live toggling, the picker's dismissal contract); ∅ clears. Rendered for **all pointer classes** — it is the mobile marker path and an additive, Tab-reachable desktop path (assumption #10).
- The `Change color…` row's label, handoff (`close()` then `setShowLabelPicker(true)`), and its FIRST-row position are unchanged.

### 10. Palette actions (Constitution V)

`app.tsx` action registry: keep `window-label` / `Tab: Label` (now opens the color + flair picker) and add `window-marker` / `Tab: Marker` (dispatches `marker-pad:open` for the current window, § 7). Register the new action in the same `terminal`-mode group as `window-label`.

### 11. Tests

Unit (`app/frontend/src`):
- `themes.test.ts` — replace the `MARKER_STATES` / `markerStripeStyle` suites with `MARKER_MODES` / `MARKER_STAGES` / `parseMarker` (`"auto"` → stage 1, `"auto:2"`, unknown → null) / `formatMarker` / fill-style widths 7/15/22 + chevron count.
- `window-row.test.tsx` — retire the `LabelZone` suite (`renders the label zone…`, `clicking the label zone opens the picker…`, `hover palette-icon container is inset…`, `ghost rows get no label zone`), the `grows the dot tap zone…` and `pointerdown on the tap zone opens the flyout card…` coarse tests (invert: the dot wrapper carries no scrub handlers and a tap on it selects the row), the `coarse left-zone reclaim` suite (content starts at 30px on both pointers; no `coarse:pl-4`); add: well renders only on marked rows with the 12%/30% color-mix styles and `left:0; width:22px`; fills per mode/stage; `blocked` mounts `.rk-hazard` with `--rk-marker-color: var(--color-marker-ink)`; pad press → drag → release commits `formatMarker` (jsdom pointer events with the optional-call capture guards); no-move release leaves the click menu; Escape reverts; `marker-pad:open` opens the pad; the row does NOT shade on plain hover but does while held; the card's `Marker` row writes via `onMarkerChange`.
- `swatch-popover.test.tsx` — the `banded Label picker` suite loses its marker-band cases (`8 markers`, `the marker band is a single unscrolled row…`, `clicking a marker cell…`, `marker cells are STATIC mini rows…`), the option-count assertions drop the 8 markers + `Marker none`, the keyboard-walk test loses the marker row; the color+flair variant becomes the window-row variant.
- `sidebar/index.test.tsx` / `app.test.tsx` — the `Tab: Marker` palette action dispatches `marker-pad:open`.
- New `marker-pad.test.tsx` — grid math (relative displacement, clamping, ∅ column), header text, keyboard nav, click-mode commit.

E2E (`app/frontend/tests/e2e`):
- `window-marker-gutter.spec.ts` — rewrite around the new model: the pad press-drag-release persists `@rk_win_marker` = `manual:2` etc. (poll `/api/sessions` `marker`); the no-move click menu; wheel steps the stage; the well renders on marked rows only, flush at x=0 with a 22px width; `blocked` rows carry the hazard wedge while `manual`/`auto` are texture-free; the color/flair picker (from the card row) has no marker band; the strip press does not select the row. Keep the color/flair persistence tests (via the card's `Change color…`).
- `row-flyout.spec.ts` — the three coarse tests that tap `status-dot-tap` (`card kill row opens the existing kill confirmation dialog…` :690, `card pin row closes the card…` :727) move to `status-rail`; the rail test (:583) drops steps 4/7 (the ≥32×36 dot zone and the dot-as-secondary tap) and instead asserts a dot tap **selects** the row; the `coarse left-zone reclaim` test (:820) asserts content starts at ≈30px, the well (not a `border-left` stripe) is present on a marked row, and no `Set tab label` element exists on either pointer. Every touched `test()` gets its `Proves:` / `Steps:` JSDoc updated in the same commit (constitution § Test Intent Comments).
- Sweep `grep -rn "status-dot-tap\|Set tab label\|Marker none\|markerStripeStyle\|MARKER_STATES" app/frontend` to catch stragglers (the removal-sweep rule includes `tests/e2e`).

### 12. Docs

- Copy the four design-study pages into `docs/wiki/`: `window-row-studies.html`, `marker-axis-studies.html`, `mode-axis-studies.html`, `marker-3x3-studies.html` (source: the session scratchpad `/tmp/claude-1001/-home-sahil-code-sahil87-run-kit-worktrees-buffed-pika/320a4ab6-fd8c-4826-8287-57605af127c4/scratchpad/`; verified self-contained — no external `src=`/`href=` resources). Add four rows to `docs/specs/index.md` § Wiki in the existing idiom, e.g. `| [Marker 3×3 Studies](../wiki/marker-3x3-studies.html) | HTML design study behind the 3×3 marker model (260829-yneo) — mode × stage grid, the marker-ink token candidates in dark and light, the T4 marker well (12% wash + 30% edge, marked rows only), and the flush well → status-dot gap study. Self-contained; open in a browser |` (one row per page; `marker-3x3-studies.html` is the canonical final state; the earlier three are the iteration trail).
- Hydrate revisits the recorded design decision **"Marker growth is categorical — new pattern classes, never new weights"** (`docs/memory/run-kit/ui/visual-design.md` § Design Decisions, also stated in `sidebar.md` § Left-Edge Label Zone and `docs/specs/themes.md`): width becomes a separate *ordinal* axis (stage) rather than more categorical markers — the categorical axis is now `mode`, carried by shape.
- `docs/specs/themes.md` § "Left-edge label zone (single target) + `@rk_win_marker`" and `docs/specs/ui-state.md` inventory row `@rk_win_marker / @rk_win_flair | marker/flair tokens` describe the retired model — flagged for `/docs-hydrate-specs` (specs are human-curated; hydrate updates memory).

### Non-goals

- No fab/tooling writer for the marker (no `fab fff` stamping, no hooks) — declared-only in this change; option names stay generic for a later writer.
- No change to the label color families, shades, `familyToLegacy`, or the flair channel/vocabulary.
- No change to the status dot's derived vocabulary or the PR glyph.
- No change to the status rail geometry (56px, slots, chevron hint) or the three-tier card shell.
- No second `@rk_win_stage` option (assumption #2).

## Affected Memory

- `run-kit/ui/sidebar`: (modify) § Row Anatomy (left-edge zone → marker well; coarse content start; dot is a plain glyph), § Left-Edge Label Zone → rewritten as § Marker Well + Spring-Loaded Pad (3×3 model, ink, geometry, gesture contract, `marker-pad:open`), § Sidebar Row Icon System / status rail (rail is the sole coarse flyout trigger), § Row Flair (flair stays family-tinted; marker no longer shares `markerColor`), Design Decisions: revise "Server-group color is a header-bar surface only" wording (gutter still belongs to the marker), keep "Flair is an independent per-row channel, orthogonal to color and marker", add DDs for the 3×3 split, the fixed ink, the T4 well, the spring-loaded pad, hover-shade-held-only, and the mobile dot-trigger retirement.
- `run-kit/ui/status-signals`: (modify) § Row-hover register flyout card (`Change color…` = color + flair; new `Marker` action row; the dot tap zone is no longer a secondary trigger — the rail is the only coarse trigger), § Status Dot detail-surface note, Design Decision "One status-detail surface, three triggers — the ROW, not the dot" (drop the dot-tap-zone clause).
- `run-kit/ui/visual-design`: (modify) § Color Tokens (+ `--color-marker-ink`), § SwatchPopover / § Banded Label picker (marker band removed; two bands), § Hazard-Wedge Row Texture (paired with `blocked`, ink-colored), Design Decisions: revisit "Marker growth is categorical — new pattern classes, never new weights" (→ mode × stage), "Banded B-H picker layout" (two bands), "Signal hues are per-theme tokens" (marker ink follows the pattern), "The motion split" (unchanged wording, new vocabulary).
- `run-kit/tmux-sessions`: (modify) § Server-Scoped User Options registry row `@rk_win_marker` (value schema `<mode>[:<stage>]`, 12 tokens, read-side legacy normalization `NormalizeMarker`); note that no `legacy_options.go` row is added (same-name value remap).
- `run-kit/architecture`: (modify) `@rk_win_marker` window option paragraph (value schema, normalization) and the `internal/validate` closed-set (1) marker entry.
- `run-kit/api-and-sockets`: (modify) the `/options` handler paragraph's `@rk_win_marker` allowed values.
- `run-kit/layout-snapshots`: (modify) restored `marker` values normalize through `NormalizeMarker` (legacy tokens in old snapshots map forward).
- `run-kit/ui/keyboard-and-palette`: (modify) `Tab: Label` opens the color + flair picker; new `Tab: Marker` / `window-marker` action (`marker-pad:open`).

## Impact

**Frontend** (`app/frontend/src`): `components/sidebar/window-row.tsx` (LabelZone removal, well, pad press target, hover-shade change, coarse dot/rail, `pl-[30px]` on both pointers, suppression gate), new `components/sidebar/marker-pad.tsx`, `components/sidebar/row-flyout-card.tsx` (`Marker` action row; `WindowFlyoutContent` props `onMarkerChange`-equivalent + current marker), `components/swatch-popover.tsx` (marker band/props removed), `themes.ts` (`MARKER_MODES`/`MARKER_STAGES`/`parseMarker`/`formatMarker`/fill helpers replace `MARKER_STATES`/`markerStripeStyle`), `globals.css` (`--color-marker-ink` ×3 blocks; hazard comment), `types.ts` (`WindowInfo.marker` doc), `api/client.ts` (`setWindowMarker` doc), `app.tsx` (`window-marker` palette action), `components/sidebar/index.tsx` (prop-drilling unchanged; doc comments). Unit tests listed in § 11.

**Backend** (`app/backend`): `internal/validate/validate.go` (`markerTokens`, `ValidateMarkerValue` copy), `internal/tmux/tmux.go` (`NormalizeMarker`, `parseWindows`, `WindowInfo.Marker` doc), `internal/tmux/layout.go` (field-27 normalization), `api/windows.go` (comments), `api/operator.go` (color-tabs prompt vocabulary) + their `_test.go` files (`validate_test.go`, `tmux_test.go`, `layout_test.go`, `windows_test.go`, `operator_test.go`). No API route, format-string field, or option key changes; no `legacy_options.go` table row.

**E2E** (`app/frontend/tests/e2e`): `window-marker-gutter.spec.ts` (rewrite), `row-flyout.spec.ts` (dot-tap → rail; geometry assertions), `_ready.ts` unchanged (`SnapshotWindow.marker` stays a string).

**Docs**: `docs/wiki/*.html` (+4), `docs/specs/index.md` § Wiki (+4 rows); memory per § Affected Memory; specs `docs/specs/themes.md` / `docs/specs/ui-state.md` flagged for `/docs-hydrate-specs`.

**Compatibility**: existing `@rk_win_marker` values in live tmux servers and stored snapshots keep rendering via read-side normalization (§ 4); external writers (the operator `color-tabs` prompt, agents using `tmux set-option`) must use the new tokens — the retired ones now 400 through `/options` and drop to unset on read. The `@rk_win_note`, `@rk_win_flair`, `@rk_win_color` channels are untouched.

**Verification gates**: `just test-frontend` (vitest) and `cd app/backend && go test ./...` first; then `just test-e2e "window-marker-gutter"`, `just test-e2e "row-flyout"`; `just build`. Playwright-driven visual check at 375px (drawer: flush well, plain dot, rail-only card; Marker row in the card) and ≥1024px (well + pad; no hover shade; held shade with the card open), both themes for the ink.

## Open Questions

- Light-theme marker ink: the description fixes `#d97706` (amber-600, ≈3.0:1); the final design study (`marker-3x3-studies.html` § 2) marks `#c97400` (≈3.3:1) as its "pick ✓". Implemented as `#d97706` per the description; a one-line flip if the study's pick was the intended one.
- Wheel-on-strip stage stepping: on a 22px strip inside a scrollable sidebar, an ungated wheel handler would hijack sidebar scrolling whenever the pointer rests over the strip. Default taken: step (and `preventDefault`) only on rows that already carry a marker; unmarked rows scroll normally.
- Keyboard entry ("Enter opens"): Enter on the focused treeitem row is the tree's activate-and-select key, so the pad's keyboard opener is the new `Tab: Marker` palette action (Constitution V); inside the pad Enter commits, arrows move, Escape reverts.
- Desktop card: the `Marker` action row (inline pad, click mode) renders on fine pointers too (additive, Tab-reachable), not coarse-only.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The twenty numbered decisions in § Origin are implemented as stated — 3×3 mode × stage model, T4 well flush at x=0–22 with `pl-[30px]` kept, fixed `--color-marker-ink`, spring-loaded pad (I3), LabelZone removal, hover shade held-only, mobile dot-trigger retirement + rail-only flyout, `Change color…` → color + flair, `Marker` card row with 28px cells, four wiki pages + index rows, declared-only write model, non-goals honored. | Discussed — every item was agreed by the user in the design session and handed over verbatim; nothing was synthesized beyond it. | S:95 R:70 A:90 D:95 |
| 2 | Confident | Storage is ONE option — `@rk_win_marker` = `<mode>[:<stage>]` (`manual`, `manual:1` … `blocked:3`, bare mode renders at stage 1); no `@rk_win_stage`. | Description left this to the implementer. One key keeps one registry row, one `ListWindows`/snapshot field, one validator, and one legacy-mapping seam; the `@rk_win_note` `<epoch>:<text>` composite is the in-repo precedent; a later tooling writer stamps `auto` with one `set-option`. Rejected: a second option (a positional format-string change — the note must stay the last field — plus two writes per marker change and a half-set state to reconcile). | S:70 R:55 A:75 D:65 |
| 3 | Confident | Legacy tokens are mapped forward on READ (`tmux.NormalizeMarker` in `parseWindows` + `layout.go` field 27) with the suggested table (pipe/dotted/dashed/solid→manual:1, double→manual:2, thick→manual:3, hatch→blocked:2, block→blocked:3); write-side validation rejects retired tokens; no `legacy_options.go` sweep row. | The sweep table maps option NAMES (Old→New); this is a same-name VALUE remap, and the registry's dual-read pattern already normalizes at the parser. The option rewrites itself on the user's next marker write; snapshot restore re-applies the normalized value. The mapping was marked "tunable" by the user — the table is reproduced as given. | S:75 R:80 A:80 D:70 |
| 4 | Confident | Light-theme ink is `#d97706` (dark `#f59e0b`), per the description. | The description states the pair explicitly ("paired like `--color-signal-yellow`"); the final study page marks `#c97400` (3.3:1) as its pick — recorded as an alternative in § Open Questions. A single hex in one token; trivially flipped. | S:45 R:95 A:45 D:60 |
| 5 | Confident | Keyboard opener for the pad is a new `Tab: Marker` / `window-marker` palette action dispatching `marker-pad:open` (mirroring `label-popover:open`); inside the pad arrows move, Enter/Space commit, Escape reverts. | Constitution V requires palette registration for every user-facing action; Enter on the focused treeitem is already the tree's activate-and-select key, and the flyout DD removed the extra pre-row tab stop for exactly this reason — so "Enter opens" resolves to Enter on the palette action. | S:50 R:85 A:80 D:65 |
| 6 | Confident | Wheel-on-strip steps the stage only on rows that already carry a marker (the handler `preventDefault`s there); unmarked rows scroll the sidebar normally. | The description asks for wheel stepping; an ungated 22px wheel trap inside a scrollable sidebar would hijack scrolling over every row. Gating on marked rows keeps the gesture where it has a target. Easily changed. | S:45 R:90 A:50 D:50 |
| 7 | Confident | The strip on an unmarked row has no rest or hover visual (the well appears only with a marker, per decision 13; plain-hover row shading is removed per decision 3); `cursor: pointer` over the strip is the only fine-pointer hint, with the palette action and the card's Marker row as the discoverable paths. | Follows from decisions 3 + 13 directly; adding a hover cue would reintroduce the zone-glow the change removes. | S:60 R:90 A:70 D:65 |
| 8 | Confident | Pad grid math: cell pitch = cell size (26px desktop / 28px card); highlight = current cell + `round(dx/pitch)`, `round(dy/pitch)` clamped to the grid; on an unmarked row the current cell is ∅ and the first downward step's reference row is `manual`. | Decision 17 fixes relative displacement + edge clamping; the ∅-spanning column leaves the reference row for an unmarked row open — the top row is the natural default and the description lists `manual` first. | S:65 R:90 A:75 D:70 |
| 9 | Confident | `SwatchPopover` loses the marker band AND its `selectedMarker`/`onSelectMarker` props (not just hidden); the composite preview row shows tint + flair + name without a marker stripe; the combo caption becomes `{color} · {flair}`. | Decision 19 removes the band; with no marker call site left, dead props are removal-sweep debt. The preview depicts the picker's own axes; the row itself shows the marker. | S:60 R:85 A:80 D:70 |
| 10 | Confident | The card's `Marker` action row renders for ALL pointer classes (additive + Tab-reachable on desktop), directly after `Change color…`. | The card's action rows are rendered pointer-agnostically today ("rendered for ALL pointer types"); decision 5 names mobile as the reason but a coarse-only row would be the card's first pointer-gated row and would break its keyboard reach on desktop. | S:40 R:85 A:60 D:55 |
| 11 | Confident | Coarse content start becomes the shared `pl-[30px]` (the `coarse:pl-4` split is removed); the name start moves ≈54px → ≈43px (≈+11px width) rather than exactly net-zero. | Derived from the current classes (`coarse:pl-4` 16px + 32px dot box + 6px gap vs 30px + 7px dot + 6px gap); decision 14 fixes the 8px well→dot gap and the description calls the width effect "net-zero" approximately. | S:60 R:90 A:85 D:75 |
| 12 | Certain | The hazard wedge on `blocked` rows keeps its geometry (12px tile, 22%/55% left-edge mask) regardless of stage; only its color changes to the marker ink. | Decision 8 says `blocked` "keeps the existing hazard-wedge texture pairing" and nothing varies the wedge by stage; the study renders it that way. | S:65 R:90 A:80 D:80 |
| 13 | Certain | The change type is `feat` (a new marker model, token, component, and palette action), set explicitly. | `fab status refresh` inferred `fix` from an incidental keyword hit (the card's "Fix tab name" row appears in the body); overridden via `fab status set-change-type yneo feat` so `change_type_source: explicit` survives refresh. | S:80 R:95 A:90 D:90 |

13 assumptions (3 certain, 10 confident, 0 tentative, 0 unresolved). Run /fab-clarify to review.
