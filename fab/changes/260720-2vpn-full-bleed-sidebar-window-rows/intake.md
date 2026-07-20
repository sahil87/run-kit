# Intake: Full-Bleed Sidebar Window Rows

**Change**: 260720-2vpn-full-bleed-sidebar-window-rows
**Created**: 2026-07-20

## Origin

Promptless dispatch via `/fab-proceed` from a live design conversation (no user available for questions — `promptless-defer` mode). Synthesized description:

> **Full-bleed sidebar window rows — remove the 12px left group margin.** The sidebar window-row group is wrapped in `<div className="ml-3" role="group">` (`app/frontend/src/components/sidebar/index.tsx:1597`). Because the indent is a *margin*, each window row's box starts 12px inside the sidebar, so row tint/hover/selection backgrounds are inset, leaving a black gutter at the left edge. Desired state (spec source: demo screenshot `.uploads/260720140259-image.png` — a previously built demo HTML page NOT in the repo; the screenshot is the authoritative visual reference): window rows render **full-bleed** — the row box and its tint/hover/selection backgrounds span the sidebar edge-to-edge, marker stripes sit at the true left edge of the sidebar, and the hover palette icon appears at the true edge.

Current-state screenshot: `.uploads/260720140219-image.png` (shows the black gutter left of the tinted rows). Both screenshots verified present in `.uploads/` and inspected during intake — the geometry statements below are grounded in them plus the actual source.

Conversation decisions carried across the boundary: (1) indent becomes padding inside the row, dot/name keep exact x-positions; (2) LabelZone geometry coherently re-derived, constants/comments rewritten; (3) same treatment in `boards-section.tsx`; (4) preserve PR #420 dotted-stripe continuity and the selected+double scanlines-crawl; (5) `docs/memory/run-kit/ui-patterns.md` rewritten at hydrate.

## Why

1. **Pain point**: the 12px `ml-3` group margin insets each window row's *box*, so colored family tints, hover fills, and the 40% selection tint all stop 12px short of the sidebar's left edge, leaving a black gutter (visible in the current-state screenshot). Marker stripes paint 17px in from the sidebar edge — 5px inside the tint box — so the "left-edge marker" axis is not actually at the edge.
2. **Consequence of not fixing**: rows keep reading as floating inset chips rather than full-width list rows; the gutter visually breaks the stripe/tint at the sidebar seam. The user compared against a previously built demo page and judged the full-bleed look strictly better.
3. **Why this approach**: moving the 12px from a *group margin* to *left padding inside each row* keeps every piece of row content (status dot, window name) at its exact current x-position — the visual hierarchy vs. the session row is preserved — while the row's background box extends to the physical sidebar edge. It also *simplifies* the LabelZone geometry: today's `-left-3` negative-offset hack exists only to escape the group margin; with the margin gone the zone is a plain `left-0` overlay.

## What Changes

Frontend-only visual/geometry change. Three source files plus one unit-test expectation. No backend, no API surface, no routes.

### 1. Window-row group: margin → per-row padding (`sidebar/index.tsx`)

Remove `ml-3` from the window-list group wrapper at `app/frontend/src/components/sidebar/index.tsx:1597`:

```tsx
// before
<div className="ml-3" role="group" id={windowGroupId}>
// after
<div role="group" id={windowGroupId}>
```

`role="group"`, `id={windowGroupId}` (the `aria-controls` target), and all children are unchanged. Note: an existing comment near the sidebar code warns that tests must not couple to spacing utility classes — verified: no test references `ml-3`.

### 2. Window-row box: absorb the indent as left padding (`sidebar/window-row.tsx`)

The row `<button>` currently uses `pl-[18px]` (window-row.tsx:235). The 12px indent moves into this padding: `pl-[18px]` → `pl-[30px]` (12 + 18). Result:

- The status dot and window name keep their **exact current absolute x-positions** (dot leading edge at 30px from the sidebar edge, as today: 12px margin + 18px padding).
- The row box — and with it the family tint (`buttonStyle` backgroundColor), hover fill, 40% selection tint, the `isDragOver` box-shadow, and the double-marker scanline overlay (`inset-0` on the row root) — now spans the sidebar edge-to-edge. The scanline band extending to the physical edge matches the demo (its "operator" row) and is intended, not a side effect to suppress.
- All comments referencing the old geometry (the `pl-[18px]`/"−12px into the group indent" narration around window-row.tsx:221–235 and the button-class comment) are rewritten to the new derivation.

### 3. LabelZone: coherent re-derivation, not a patch (`sidebar/window-row.tsx`)

Today (constants + comment block at window-row.tsx:463–468): the zone is an absolute `z-20` sibling at `-left-3` (−12px) spanning `LABEL_ZONE_WIDTH = 26` — a 12px icon zone (`ICON_ZONE_WIDTH`) over the group indent plus a 14px stripe zone; the display-only stripe container sits at `left: ICON_ZONE_WIDTH + STRIPE_INSET` = 17px (`STRIPE_INSET = 5`), `right: 0`.

New derivation:

- **Zone**: `left-0`, width stays 26px, full row height — no negative offset. The zone's *absolute* span (sidebar x = 0…26) is unchanged; only its coordinate expression simplifies because the row box now starts at the sidebar edge. The dot at `pl-[30px]` stays 4px clear of the zone's inner edge, exactly as today.
- **Palette icon**: stays in the leftmost 12px of the zone — now the true sidebar edge — hover-revealed with the same two-stage opacity (row hover ~65% → zone hover 100%) and family tinting.
- **Marker stripe**: moves to anchor at the **true left edge of the sidebar** (per the demo screenshot, stripes render nearly flush with only a small inset of roughly 2–5px). The `left: ICON_ZONE_WIDTH + STRIPE_INSET` (17px) placement is replaced by a single small inset constant measured from the zone/sidebar left edge. Because the stripe now shares the leftmost 12px with the hover icon, the icon renders **above** the stripe on hover (demo shows the palette icon overlaying the stripe region; current z-order — stripe is a plain child, icon a later sibling — already stacks this way, but the final code must make the layering explicit).
- **Constants and comments**: `LABEL_ZONE_WIDTH` / `ICON_ZONE_WIDTH` / `STRIPE_INSET` and the geometry comment block at window-row.tsx:463 are rewritten to match the new derivation (no stale "-left-3"/"group indent" narration). Names may change if the re-derivation makes better ones obvious.
- **Unchanged interaction contract**: one 26px click target that opens the combined Label picker (no cycling), `stopPropagation` (never selects the row), active on coarse pointers, `aria-label="Set window label"`, zone glow at 12%/24% family tint, `z-20` above the icon cluster (`z-10`) and scanline overlay (`z-[5]`).

### 4. Boards section: same treatment (`sidebar/boards-section.tsx`)

Two `ml-3` uses (lines 59, 69) get the identical margin→padding conversion so board rows are full-bleed too:

- Hint-mode div (line 59): `ml-3 px-2` → `pl-5 pr-2` (left 12+8 = 20px; right stays 8px).
- Board list item (line 69): drop `ml-3` from the `<li>`; the row `<button>`'s `px-2` → `pl-5 pr-2`. Board name/pin-count keep their x-positions; the active `bg-bg-card` and hover `bg-bg-card/50` fills span edge-to-edge.

### 5. Preserved behaviors (explicit regression guards)

- **Dotted-stripe cross-row continuity (PR #420, commit 2d00d770)**: the fixed-rhythm `repeating-linear-gradient` (6px period dividing the 24px/36px row heights exactly — `markerStripeStyle` in `src/themes.ts:440–447`) is untouched; only the stripe's x-position moves. Full-bleed should make continuity *better* (stripes meet at the physical sidebar edge with no gutter seam — the demo's adjacent dotted rows read as one continuous stripe). Verify no regression for stacked dotted rows and dotted↔solid/double adjacency.
- **Selected+double `rk-scanlines-crawl`**: overlay classes, the `--rk-marker-color` custom property, the dedicated inner clip element, and reduced-motion behavior are all unchanged; only the overlay's width grows with the row box.
- **Dot hover-card/click-to-select**: the dot still starts 4px past the zone's inner edge, so the zone never steals the dot's interactions (the "must-fix-3" geometry).

### 6. Tests

- `app/frontend/src/components/sidebar/window-row.test.tsx:948` asserts the stripe container's `left` is `"17px"` (with a comment saying "inset from the zone's left edge (not flush at 0)") — update the expectation (and comment) to the new edge-anchored inset.
- No Playwright spec asserts zone/stripe pixel geometry (`window-marker-gutter.spec.ts` is behavioral via `getByLabel("Set window label")` and survives unchanged); if any `.spec.ts` does change, its sibling `.spec.md` must be updated in the same commit (constitution § Test Companion Docs).
- Do not add new couplings to spacing utility classes; assert geometry via computed positions or the existing aria handles if new assertions are needed.
- Run only via `just` recipes (`just test-frontend`, `just test-e2e "<spec>"`), never raw playwright.

## Affected Memory

- `run-kit/ui-patterns`: (modify) — § Left-Edge Label Zone ("Zone geometry" paragraph: `-left-3`, 26px span over the group indent, `pl-[18px]`), § Row Anatomy, the keyboard/ARIA note quoting the `ml-3` group wrapper (currently cites `index.tsx:1519`), and any stripe-position references — rewrite to the padding-based full-bleed geometry at hydrate.

## Impact

- **Files**: `app/frontend/src/components/sidebar/index.tsx` (1 line), `app/frontend/src/components/sidebar/window-row.tsx` (row padding, LabelZone constants/positions, comment rewrites), `app/frontend/src/components/sidebar/boards-section.tsx` (2 spots), `app/frontend/src/components/sidebar/window-row.test.tsx` (1 expectation). Stack: Vite + React 19 + Tailwind 4.
- **No** backend/API/route changes; no theme/palette changes (`markerStripeStyle`, `computeRowBorders` untouched).
- **Verification**: unit tests (`just test-frontend`), the marker-gutter e2e (`just test-e2e "window-marker-gutter"`), and a visual check against the demo screenshot (dev server on port 3020 per context.md § Playwright-Driven Development).

## Open Questions

- (none — all would-be questions resolved from the conversation decisions and the authoritative demo screenshot; see Assumptions)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Indent becomes left padding inside the row (`pl-[18px]` → `pl-[30px]`), not a margin — dot and window name keep their exact current x-positions; only the row box extends left | Discussed — conversation decision 1, explicit and specific | S:90 R:85 A:90 D:95 |
| 2 | Certain | LabelZone re-derived coherently: `left-0`, width 26, no negative offset; constants and the window-row.tsx:463 comment block rewritten to match | Discussed — conversation decision 2 names exactly this simplification | S:90 R:80 A:90 D:90 |
| 3 | Certain | `boards-section.tsx` gets the same margin→padding treatment (both `ml-3` uses, lines 59 and 69) | Discussed — conversation decision 3 | S:85 R:90 A:90 D:90 |
| 4 | Certain | PR #420 dotted-stripe continuity and the selected+double `rk-scanlines-crawl` behavior are preserved and explicitly regression-checked | Discussed — conversation decision 4; mechanism (fixed-rhythm gradient) is position-independent | S:90 R:85 A:90 D:90 |
| 5 | Certain | `run-kit/ui-patterns` memory (§ Left-Edge Label Zone, § Row Anatomy) rewritten at hydrate — normal pipeline work | Discussed — conversation decision 5 | S:90 R:95 A:95 D:95 |
| 6 | Confident | Marker stripe anchors at the true sidebar edge with a small inset (~2–5px, exact value picked at apply against the demo screenshot), replacing the 17px `ICON_ZONE_WIDTH + STRIPE_INSET` placement; hover palette icon overlays the stripe in the shared leftmost 12px | Desired-state text says "stripes sit at the true left edge"; demo screenshot (authoritative) shows near-flush stripes with the hover icon overlaying — only the exact inset px is left to apply, easily tuned | S:70 R:85 A:75 D:65 |
| 7 | Confident | Boards rows use `pl-5 pr-2` (20px left = 12 indent + 8 existing, right unchanged at 8px) so text keeps its x-position | Derived arithmetically from the current `ml-3 px-2` box; trivially reversible | S:60 R:90 A:85 D:70 |
| 8 | Certain | Scope is window rows + boards rows only — session rows, server group headers, and server tiles are untouched (they already span full width; hierarchy vs. session row preserved per decision 1) | Conversation names exactly these two areas; both screenshots show session headers already full-bleed | S:80 R:90 A:85 D:85 |
| 9 | Certain | Full-bleed applies to every row-box visual layer (tint, hover, selection, drag-over shadow, scanline overlay) — the wider scanline band is intended, matching the demo's "operator" row | Follows structurally from "the row box extends left" (overlay is `inset-0` on the row root); demo confirms the wide band | S:70 R:85 A:85 D:80 |

9 assumptions (7 certain, 2 confident, 0 tentative, 0 unresolved).
