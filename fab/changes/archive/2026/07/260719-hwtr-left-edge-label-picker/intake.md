# Intake: Left-Edge Label Picker — Single 26px Target, Combined Color+Marker Menu

**Change**: 260719-hwtr-left-edge-label-picker
**Created**: 2026-07-19

## Origin

> left-edge label picker — 26px single target opening combined color+marker picker, hover palette icon, square picker styling, cycle removed

Conversational — a `/fab-discuss` iteration (2026-07-19) directly following the shipped `260718-3prk-row-color-owned-palette-axis-split` (PR #394, merged). The user compared the shipped left gutter against the design sim, spotted geometry slack, and drove four interactive sim iterations (split lanes → rejected; right-click combined menu → rejected as undiscoverable; hover palette icon + cycle → superseded; final: single 26px target). Every decision below was explicitly made or approved by the user against a live simulation. **This change deliberately supersedes four decisions of the 3prk change** — recorded in What Changes §3 so downstream agents don't treat the older intake as current.

## Why

1. **Problem**: After 3prk, the two labeling affordances live on opposite sides of a window row — the 4-state marker in the left gutter, the color picker in the right hover cluster (between pin and kill). Both are *labels* (nouns about the row), while pin/kill are *actions* — the split is taxonomically arbitrary and spends the row's scarce hover-cluster space on a rare action. Additionally the shipped gutter has geometry slack (marker stripe renders flush-left at x=0 while content clearance is 18px, leaving dead space between stripe and status dot), and the click-to-cycle marker interaction is invisible on touch (gutter is coarse-inert; palette-only).
2. **Consequence of not fixing**: labels stay spatially incoherent, the right cluster stays crowded, mobile has no direct label access, and the gutter looks misaligned.
3. **Approach**: consolidate both labellers into the **entire 26px space left of the status dot** (12px group-indent zone + 14px marker gutter) as **one click/tap target that opens a combined Label picker** (colors + marker states). The target never selects the row. A hover-revealed palette icon (the shipped `PaletteIcon`) makes it discoverable using the affordance grammar the right cluster already established. Left edge = who the row is; right cluster = what you can do to it.

**Rejected alternatives** (explored against live sims, in order):
- *Split lanes* (color chip lane + marker lane side by side): sub-13px targets at 24px row height are precision-hostile; a permanent color chip visually duplicates the adjacent status dot and costs Row Minimalism.
- *Right-click on the gutter for the combined menu (click = cycle)*: rejected by the user — right-click is not discoverable enough.
- *Hover palette icon (12px) + separate click-to-cycle marker zone (14px)*: superseded — two adjacent zones with different behaviors is a second thing to learn; the user chose one target, one behavior.

## What Changes

### 1. Single 26px label target on window rows (`window-row.tsx`)

The full 26px to the left of the status dot becomes ONE interactive zone:

- **Click/tap anywhere in it → opens the Label picker** (see §2), anchored at the row's left edge below the row. The click MUST NOT select the row (`stopPropagation`) and MUST coexist with drag-reorder.
- **Layout**: 12px icon zone + 14px marker-stripe zone. The status dot and window name keep their current x-positions — the 26px repurposes the existing group indent + gutter, no content shift.
- **Hover affordance**: hovering the row fades in the shipped `PaletteIcon` (from `components/sidebar/icons.tsx`, ~11px) in the icon zone at ~65% opacity and glows the whole zone at ~12% family color; hovering the zone itself raises the icon to full opacity and the glow to ~24%. Cursor: **`pointer`** (the zone opens a menu; it is not a cycle affordance).
- **Icon color**: the row's family guarded color on colored rows (quietly marking "this row's label lives here"); inherited monochrome on uncolored rows.
- **Marker stripe becomes display-only** and is **inset 5px** within its 14px zone (fixes the shipped flush-left + dead-space geometry). Stripe rendering (3px dotted / 3px solid / 6px double in guarded family color, gray uncolored) is unchanged.
- **Active on coarse pointers**: the 26px × full-row-height (36px coarse) target is tappable — touch gets direct label access. This supersedes 3prk's palette-only touch decision.

### 2. Combined Label picker (extends `swatch-popover.tsx`)

One popover containing both label vocabularies:

- **Colors**: the 10 family swatches in a 5×2 grid (18px square cells, filled with each family's guarded color) + a full-width "Clear color" row. Selection writes through the existing `familyToLegacy` seam (stored vocabulary unchanged). Current color highlighted with a 1px outline.
- **Separator** (1px hairline), then **markers**: 4 cells (20px square) rendering the states as mini stripes — none / dotted / solid / double — in the row's current guarded color; current state highlighted. Selection calls the existing `setWindowMarker` path. Any state is reachable in 2 clicks (open + pick); there is no cycling.
- **Square styling** (user: "less curvy") — scoped to this picker: zero `border-radius` on container and all cells (strip the shipped `rounded-md`/`rounded-sm`), hard offset block shadow (`3px 3px 0 rgba(0,0,0,.35)`) instead of a blurred drop shadow, 1px selection outlines, 3px grid gaps.
- **Keyboard**: preserve/extend the popover's existing arrow-key + Enter/Space navigation across both sections; Escape closes; outside click closes.

### 3. Superseded 3prk decisions (explicit reversals)

| 3prk decision | Now |
|---|---|
| Gutter click cycles the marker | Removed — all marker changes go through the picker |
| `cursor: cell` on the gutter | `pointer` (menu-opener semantics) |
| Next-state ghost preview on gutter hover | Removed — no "next" without cycling; hover = icon + glow |
| Gutter inert on coarse pointers (palette-only touch) | Zone active on touch (26px full-height target) |

Unchanged from 3prk: hue=label / 40% borderless tint selection, the marker states + `@rk_marker` persistence + wake seam, scanline easter egg + selected+double retro animation, accent pin glyph for active-board, owned-palette derivation.

### 4. Right hover cluster slims to actions only

Remove the color button (`PaletteIcon` between pin and kill) from **window rows** — the cluster becomes pin + kill. Session rows and server tiles keep their existing right-side color affordances (they have no left label zone; windows-only scope, consistent with 3prk's marker scope).

### 5. Command palette

Replace `Window: Cycle Marker` with **`Window: Label`** — opens the Label picker for the current window's sidebar row via the imperative document-event pattern already used by the palette's "Board: Pin Current Window" (`pin-popover:open` in `window-row.tsx`). One interaction model everywhere; the picker's keyboard nav makes this a complete keyboard path (Constitution V).

### 6. Documentation

Update `docs/specs/themes.md` § Axis split (gutter interaction paragraph) to the single-target model — flag for human review in the PR body. Memory via hydrate. Playwright specs covering gutter cycling (`window-marker-gutter.spec.ts`) must be updated to the picker flow, with `.spec.md` companions kept in sync (constitution).

## Affected Memory

- `run-kit/ui-patterns`: (modify) window-row label zone — single 26px target, hover icon, combined square picker, cycle/cell-cursor/ghost removal, coarse activation, right-cluster slimming, `Window: Label` palette action

## Impact

- **Frontend only**: `window-row.tsx` (zone restructure, stripe inset, cluster slimming, popover anchoring), `swatch-popover.tsx` (marker section, square styling, keyboard nav), `app.tsx` (palette action swap), unit tests (`window-row.test.tsx`, `swatch-popover.test.tsx`), e2e (`window-marker-gutter.spec.ts` + `.spec.md` rewrite to picker flow), `docs/specs/themes.md`.
- **No backend change**: `@rk_marker` and color options/validators are untouched; writes go through the existing `setWindowOptions` paths.
- Branch bases on the merged main (PR #394 is in).

## Open Questions

None — all decision points were resolved interactively during the sim iterations.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The whole 26px left of the dot is one click/tap target opening the Label picker; never selects the row | User's explicit words: "all of the 26 pixels… opens the color+marker picker… shouldn't select the row" | S:95 R:85 A:90 D:95 |
| 2 | Certain | Marker stripe is display-only; click-to-cycle, `cell` cursor, and next-state ghost are removed | User: "the marker area is no longer click to cycle"; consequences enumerated and approved ("Love it!") | S:95 R:80 A:90 D:95 |
| 3 | Certain | Hover-revealed shipped PaletteIcon in the 12px zone, family-tinted on colored rows, zone glow 12%/24%, `pointer` cursor | User proposed the hover icon; family tint shown in sim and approved | S:90 R:90 A:85 D:90 |
| 4 | Certain | Combined picker = 10 swatches + Clear + separator + 4 marker-state cells, current values highlighted; writes via existing familyToLegacy / setWindowMarker seams | Iterated live in the sim across three versions; approved | S:90 R:85 A:90 D:90 |
| 5 | Certain | Square picker styling: zero radius, 3px offset block shadow, 1px outlines, 3px gaps (this picker only) | User: "less curvy"; v12 styling shown, then "go ahead" | S:85 R:90 A:85 D:85 |
| 6 | Certain | Stripe inset 5px in its zone (geometry fix for flush-left + dead space) | User flagged the shipped slack; fix demonstrated in sim | S:90 R:90 A:90 D:90 |
| 7 | Certain | Zone active on coarse pointers — direct touch label access, superseding 3prk's palette-only decision | Listed as consequence #4 of the single-target model; user approved the list | S:85 R:85 A:85 D:90 |
| 8 | Certain | Window rows' right cluster drops the color button (pin + kill remain) | Core of the user's consolidation ask ("both labellers move to the left") | S:90 R:85 A:90 D:90 |
| 9 | Confident | `Window: Label` palette action (imperative `label-popover:open`-style event, mirrors pin-popover pattern) replaces `Window: Cycle Marker` | Proposed with rationale ("one action, one model"), unobjected across two exchanges; Constitution V requires a keyboard path | S:65 R:85 A:85 D:75 |
| 10 | Confident | Scope: window rows only — session rows / server tiles keep right-side color buttons; picker de-rounding does not touch other popovers | Whole discussion was window-row anatomy; minimal-surface default (Constitution IV); trivially extensible later | S:60 R:85 A:85 D:80 |
| 11 | Certain | No backend change; storage vocabulary and endpoints as shipped in 3prk | Both write seams already exist; picker reuses them verbatim | S:85 R:85 A:95 D:90 |

11 assumptions (9 certain, 2 confident, 0 tentative, 0 unresolved).
