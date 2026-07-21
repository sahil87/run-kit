# Plan: Sidebar SESSIONS Pane — Tinted Server-Group Header Fill

**Change**: 260720-t1ca-sidebar-server-group-header-tint
**Intake**: `intake.md`

## Requirements

### Sidebar: Server-Group Header Tint (Variant D)

#### R1: Tinted header fill on the header surface
Each server-group header in the SESSIONS pane MUST render as a filled bar carrying that server's resolved color. The fill MUST cover the full-width header row container (`app/frontend/src/components/sidebar/index.tsx`, the `flex items-stretch w-full` div holding the toggle button and the `+` new-session button), replacing the current transparent background + `hover:bg-bg-card/30` treatment with tint-aware rest/hover states.

- **GIVEN** a server with an assigned color descriptor (e.g. `"4"`) in `serverColors`
- **WHEN** its group header renders in the SESSIONS pane
- **THEN** the header row container's background is the server's resolved low-strength tint (blended toward the theme background)
- **AND** the header text carries the server's contrast-guarded accent color

#### R2: Color resolution through the existing descriptor machinery
Header colors MUST be resolved through the existing precomputed maps already passed into `ServerGroupInner` as props: `rowTints` (blended fills from `computeRowTints(theme.palette)`) for the background and `rowBorders` (contrast-adjusted hex from `computeRowBorders`) for the text/accent role. The implementation MUST NOT hardcode the mockup hexes (`#171a1f`, `#e2e5e8`, 16%/62%) and MUST NOT add a parallel color-resolution path. The maps are dual-keyed (family name + legacy descriptor), so the raw stored `serverColor` value is a valid lookup key for both vocabularies.

- **GIVEN** a server color stored as a legacy descriptor (`"4"`) or family name (`"blue"`)
- **WHEN** the header resolves its fill and text colors
- **THEN** both resolve via `rowTints.get(color)` / `rowBorders.get(color)` — the same entries the SERVER panel tiles use
- **AND** the treatment derives structurally from `palette.background` blending, so it renders correctly across system/light/dark themes and all ANSI-derived palettes

#### R3: Uncolored-server fallback
A server with no assigned color (`serverColors[name]` undefined) or an unrecognized descriptor (no `rowTints` entry) MUST fall back to the gray sentinel (`UNCOLORED_SELECTED_KEY`) tint/border entries — a neutral fill that preserves the hierarchy benefit without fabricating identity. The fallback MUST keep the identical heavier treatment (height, weight, top border) so colored and uncolored groups read as the same element class.

- **GIVEN** a server with no color in settings.yaml
- **WHEN** its group header renders
- **THEN** the header carries the gray-sentinel fill and the same 26px/weight-600/top-border treatment as colored headers

#### R4: Current-server distinction via tint strength and text brightness
With all headers moving to weight 600, weight no longer differentiates the current server; the distinction MUST move to color strength. The current server's header MUST use the deeper `selected` tint shade and `text-text-primary` text; other servers rest at the `base` shade with the guarded `rowBorders` hex as text color. Non-current headers MUST hover to the `hover` shade; the current header stays flat at `selected` (a lighter hover shade would read as an inverted effect — the same rule `CollapsiblePanel` applies to its selected-shade header).

- **GIVEN** the current server and a non-current server, both colored
- **WHEN** their headers render
- **THEN** the current header's fill is `rowTints.get(color).selected` with `text-text-primary` text, and the non-current header's fill is `rowTints.get(color).base` with `rowBorders.get(color)` text
- **AND WHEN** the pointer hovers a non-current header **THEN** its fill deepens to `rowTints.get(color).hover` and restores to `base` on leave, while a hovered current header stays at `selected`

#### R5: Heavier header treatment
The header MUST get the heavier Variant D treatment: min-height 26px on fine pointers (up from `min-h-[20px]`; the `coarse:min-h-[28px]` touch floor MUST NOT shrink), `font-weight: 600` on the header label, and a subtle 1px top border on the header bar in the server's resolved accent color, separating consecutive groups. The `<section>`'s existing `border-b border-border last:border-b-0` stays untouched.

- **GIVEN** any server-group header (colored or fallback)
- **WHEN** it renders
- **THEN** the toggle button carries `min-h-[26px] coarse:min-h-[28px]` and `font-semibold`, and the header container carries a 1px top border in the resolved `rowBorders` accent

#### R6: Header-surface-only scope
Color MUST appear only on the header bar surface. The left gutter (window-marker vocabulary — `markerStripeStyle` stripes) stays untouched; no color wash on group body rows; no changes to session rows, window rows, agent-activity tints, or the SERVER panel tiles. Existing header semantics (aria-labels, `aria-expanded`, `data-server`/`data-current-server` attributes, chevron, `+` button behavior) MUST be preserved.

- **GIVEN** the implemented change
- **WHEN** the sidebar renders
- **THEN** only the `ServerGroupInner` header render is visually changed; `themes.ts` marker/row-tint vocabularies and all other row types are byte-identical in behavior

#### R7: Unit test coverage
Unit tests in `app/frontend/src/components/sidebar/index.test.tsx` MUST cover: a colored server header carrying the resolved tint fill and accent text, the uncolored-server gray-sentinel fallback with the heavier treatment, the current-vs-other distinction (selected vs base shades, text-primary vs accent text), and the non-current hover deepen/restore behavior.

- **GIVEN** the sidebar rendered with mocked `getAllServerColors` returning a colored server
- **WHEN** the tests assert against the header container/button styles
- **THEN** expected values are computed from the same `computeRowTints`/`computeRowBorders` maps (no hardcoded hexes in tests either)

### Non-Goals

- No Playwright e2e spec — the treatment is a per-element style resolution fully assertable in unit tests; e2e style assertions add no additional behavioral signal here (code-quality's e2e clause is SHOULD, not MUST)
- No whole-group body color wash (explicitly deferred by the intake — risks muddying agent-activity row tints)
- No full-height left color stripe (rejected — collides with the window-marker gutter vocabulary)
- No backend, API, or settings.yaml schema changes — the color assignment/delivery path already exists

### Design Decisions

#### Reuse RowTint ratios verbatim — no new themes.ts blend constants
**Decision**: Map the mockup's visual targets onto the existing `RowTint` shades: rest fill = `base` (14% saturated-source), hover = `hover` (22%), current-server fill = `selected` (40%), text/accent = the contrast-guarded `rowBorders` hex.
**Why**: `base` (14%) hits the ~16% mockup fill target within visual tolerance; `selected` doubles as the current-server depth cue; `rowBorders` is the intake's named candidate for the text role and is already WCAG-nudged per theme. Zero new constants keeps one tint vocabulary.
**Rejected**: A header-specific blend ratio added to `themes.ts` — permitted by the intake but unnecessary once the existing ratios land within tolerance of the (explicitly non-literal) mockup targets.
*Introduced by*: 260720-t1ca-sidebar-server-group-header-tint

#### Subtle top border = 1px guarded accent on the header container
**Decision**: Render the "subtle top border" as `1px solid rowBorders.get(key)` on the header row container, keeping the `<section>`'s neutral `border-b` untouched.
**Why**: Reuses the same guarded-color vocabulary the SERVER tile stripe uses, adds group separation, and carries identity; 1px keeps it subtle.
**Rejected**: A neutral `border-t border-border` (no identity, doubles the theme hairline); a tint-shade border (`hover` is lighter than the current server's `selected` fill — would invert).
*Introduced by*: 260720-t1ca-sidebar-server-group-header-tint

## Tasks

### Phase 2: Core Implementation

- [x] T001 Implement the tinted server-group header in `ServerGroupInner` (`app/frontend/src/components/sidebar/index.tsx` header render at `:1512–1555`): import `UNCOLORED_SELECTED_KEY` from `@/themes`; resolve `headerTint`/`headerAccent` from `rowTints`/`rowBorders` with the gray-sentinel fallback; apply the fill (`selected` for current, `base` otherwise) + 1px accent top border to the header row container with imperative `onMouseEnter`/`onMouseLeave` hover swap (non-current only, per the `session-row.tsx`/`collapsible-panel.tsx` pattern); update the toggle button to `min-h-[26px] coarse:min-h-[28px] font-semibold`, drop `hover:bg-bg-card/30`, and set text color to `text-text-primary` (current) / inline `rowBorders` accent (non-current) <!-- R1 R2 R3 R4 R5 R6 -->

### Phase 3: Integration & Edge Cases

- [x] T002 Add unit tests to `app/frontend/src/components/sidebar/index.test.tsx` (new describe block): colored header fill + accent text, uncolored gray-sentinel fallback with heavier treatment, current-server `selected` shade + `text-text-primary` vs non-current `base` shade, and hover deepen/restore on a non-current header — expected values computed from `computeRowTints`/`computeRowBorders` over the default dark theme palette <!-- R7 -->
- [x] T003 Verify: `npx tsc --noEmit` in `app/frontend` and `just test-frontend` green; confirm no e2e selector coupling broke (header selectors are aria-label/`data-server` based and unchanged) <!-- R6 R7 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Server-group headers in the SESSIONS pane render as filled bars — the full-width header container (toggle + `+`) carries the resolved server tint, and `hover:bg-bg-card/30` is gone
- [x] A-002 R2: Fill and text colors resolve exclusively via the `rowTints`/`rowBorders` props (dual-keyed descriptor lookup); no hardcoded mockup hexes, no parallel resolution path
- [x] A-003 R3: Uncolored/unrecognized-color servers fall back to the `UNCOLORED_SELECTED_KEY` gray sentinel with the identical heavier treatment
- [x] A-004 R4: Current server header uses the `selected` shade + `text-text-primary`; non-current uses `base` + guarded accent text; non-current hovers to `hover` and restores; current stays flat
- [x] A-005 R5: Header is `min-h-[26px]` fine-pointer / `coarse:min-h-[28px]` touch, `font-semibold`, with a 1px resolved-accent top border

### Scenario Coverage

- [x] A-006 R7: Unit tests exist and pass for colored fill/text, uncolored fallback, current-vs-other distinction, and hover behavior, with expectations computed from the theme machinery

### Edge Cases & Error Handling

- [x] A-007 R3: An unrecognized color descriptor (no `rowTints` entry) degrades to the gray sentinel, never to an unstyled/transparent header
- [x] A-008 R6: Left gutter, marker stripes, session/window rows, agent-activity tints, and SERVER panel tiles are visually and behaviorally unchanged; header aria-labels and `data-server`/`data-current-server` attributes preserved (existing unit + e2e selectors keep passing)

### Code Quality

- [x] A-009 Pattern consistency: hover applied imperatively via `onMouseEnter`/`onMouseLeave` style mutation (the established dynamic-background pattern); no new CSS-specificity hacks
- [x] A-010 No unnecessary duplication: no new color-resolution helpers; existing `rowTints`/`rowBorders`/`UNCOLORED_SELECTED_KEY` reused; no magic hexes or unnamed ratios introduced

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change repaints the existing `ServerGroupInner` header (activating the already-plumbed `serverColor` prop) and removes only inline class fragments (`hover:bg-bg-card/30`, `font-medium`, `text-text-secondary`) from that one element; it introduces no new symbol/file/config and makes no existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Reuse `RowTint` shades verbatim (base/hover/selected) instead of adding header-specific blend ratios to `themes.ts` | Intake grants this latitude ("if the existing ratios don't hit the targets"); 14% vs 16% is within the stated visual-target tolerance; trivially adjustable later | S:70 R:95 A:85 D:75 |
| 2 | Confident | Subtle top border = 1px solid `rowBorders` guarded hex on the header container; section `border-b` untouched | Intake names the border but not its color; the guarded hex is the established identity-carrying line color (server-tile stripe); 1px reads subtle | S:55 R:95 A:75 D:60 |
| 3 | Confident | Current-server header stays flat on hover at the `selected` shade | Direct precedent: `collapsible-panel.tsx` disables the hover swap at the selected shade because `hover` (22%) < `selected` (40%) would read inverted | S:60 R:95 A:90 D:80 |
| 4 | Confident | Non-current header text is the static guarded accent (drops `hover:text-text-primary`); the fill hover carries the affordance | Colored text is the mockup's identity signal; a hover flip to text-primary would fight it; fill hover + chevron keep the affordance legible | S:55 R:95 A:75 D:65 |
| 5 | Confident | No Playwright e2e spec added (unit tests only) | code-quality e2e clause is SHOULD; the change is pure per-element style resolution fully assertable in jsdom; intake marks e2e "optional (plan decision)" | S:65 R:90 A:80 D:70 |

5 assumptions (0 certain, 5 confident, 0 tentative).
