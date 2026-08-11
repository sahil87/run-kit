# Intake: Sidebar Footer Chip Buttons

**Change**: 260811-cj4b-sidebar-footer-chip-buttons
**Created**: 2026-08-11

## Origin

Conversational (`/fab-discuss` session). The user asked for a bolder visual treatment of the sidebar-footer action buttons, referencing an external example (Xirp's top-right button cluster — visibly chip-shaped buttons rather than bare glyphs):

> These buttons on the bottom left (help, keyboard shortcuts, theme, settings) — can you give them a slightly bolder visual treatment? … Show me a mock page, with multiple suggestions

A live HTML mock was built with four options rendered in both themes using the real codebase tokens/icons:

- **A — Top-bar chips**: the exact `TOP_BAR_BUTTON` idiom (bordered rounded square + `rk-glint` CRT sweep + green-line hover) scaled to 24px
- **B — Filled tiles**: `bg-inset` filled squares, no resting border
- **C — Segmented tray**: one bordered container with hairline dividers
- **D — Bolder glyphs only**: no boxes, ~18% larger icons, lifted resting color

The user reviewed the mock and chose **Option A**: "A it is. Take this through a fab pipeline."

## Why

1. **Pain point**: the four footer actions (Help · Keyboard · Theme · Settings) render as bare 13–14px `text-secondary` glyphs (the borderless `FOOTER_ICON_CLASS` idiom). They are easy to miss and read as decoration rather than actionable controls — the user explicitly found them too subtle.
2. **Consequence of not changing**: app-global chrome (settings, shortcuts, theme, help) stays under-discovered; the footer reads weaker than the top-bar cluster that carries the same class of actions.
3. **Why this approach**: Option A reuses a button vocabulary the app already has (`TOP_BAR_BUTTON` — bordered chip, CRT glint, green-line hover), so the footer gains presence without introducing a new visual species. This **consciously reverses the o7q8 decision** ("deliberately NOT the top bar's bordered `rk-glint` chips" — `sidebar/index.tsx` comment above `FOOTER_ICON_CLASS`) in favor of one app-wide button language. Options B/C were rejected for introducing a third button species / a visually heavier group; D was rejected as not bold enough relative to the user's reference example.

## What Changes

### Footer chip idiom (`app/frontend/src/components/sidebar/index.tsx`)

Replace the borderless `FOOTER_ICON_CLASS` (currently at `sidebar/index.tsx:1733`):

```ts
// current (borderless idiom, o7q8)
const FOOTER_ICON_CLASS =
  "min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px] flex items-center justify-center rounded text-text-secondary hover:text-text-primary transition-colors";
```

with the top-bar chip idiom at footer scale — a bordered fixed-size rounded square with `rk-glint`:

```ts
// new (top-bar chip idiom, footer-scaled)
const FOOTER_ICON_CLASS = `rk-glint w-[24px] h-[24px] coarse:w-[30px] coarse:h-[30px] rounded border transition-colors flex items-center justify-center shrink-0 ${TOP_BAR_BUTTON_REST}`;
```

Specifics:

- **Geometry**: fixed `w-[24px] h-[24px]` on fine pointers (footer scale — deliberately smaller than the top bar's 28px), `coarse:w-[30px] coarse:h-[30px]` on touch (same as top bar's coarse size; preserves the current 30px coarse target). Fixed sizes, not `min-*` floors — the same drift-prevention rationale as the top bar's `TOP_BAR_BUTTON_BASE` fixed-size token.
- **Rest/hover treatment**: reuse `TOP_BAR_BUTTON_REST` (`border-border text-text-secondary hover:border-text-secondary`) **imported from `top-bar-overflow-menu.tsx`** (it is already exported) rather than duplicating the string — single source for the rest-state treatment so the two surfaces cannot drift. The `rk-glint` class supplies the hover behavior on top: one-shot CRT sweep plus border+glyph flipping to `accent-green` (the unlayered `.rk-glint:hover:not(:disabled)` rule in `globals.css:175` wins over the Tailwind hover utility). The current `hover:text-text-primary` is dropped — hover color is now the green line, same as every top-bar chip.
- **Applies to all four actions**: the Help `<a>` and the Keyboard / Theme / Settings `<button>`s all share `FOOTER_ICON_CLASS`, so the single constant swap restyles the whole cluster. Icons (SVGs), ordering, click behaviors, Tips (placement="top", kbd chords), and aria-labels are all unchanged.
- **Cluster spacing**: widen the right cluster gap from `gap-0.5` (2px) to `gap-1` (4px) so the bordered chips don't visually fuse — matches the approved mock and the top bar's chip spacing rhythm.
- **Left side untouched**: the connection dot + version readout keep their current passive-readout styling.
- **Doc comment**: rewrite the comment block above `FOOTER_ICON_CLASS` (and the SidebarFooter JSDoc line that says "all in the gear's borderless footer idiom") — the footer now deliberately **shares** the top-bar chip vocabulary at 24px scale, reversing o7q8; record this change's ID as the source of the reversal.

### Row-height check

The footer row is `px-2 py-1` around 24px-tall buttons today; the new chips are the same 24px box (border included via `box-sizing`), so the footer's resting height must not change. Verify no layout shift against the sidebar bottom edge.

### Tests

- Update/extend the sidebar footer unit tests (`sidebar/index.test.tsx`) to assert the four footer actions carry the chip idiom (`rk-glint` + `border`) — behavior (click handlers, aria, tips) is already covered and unchanged.
- No new e2e spec: no behavioral change, styling only. Existing e2e specs that click footer buttons should be checked for pointer-interception assumptions (bordered chips do not add `pointer-events` gating, so no changes expected).

## Affected Memory

- `run-kit/ui-patterns`: (modify) footer-action idiom entry — the sidebar footer cluster now shares the top-bar bordered chip vocabulary (24px footer scale); the borderless-contrast decision (o7q8) is reversed.

## Impact

- `app/frontend/src/components/sidebar/index.tsx` — `FOOTER_ICON_CLASS` constant, its doc comment, the SidebarFooter JSDoc, the cluster `gap` utility; import of `TOP_BAR_BUTTON_REST` from `top-bar-overflow-menu.tsx`.
- `app/frontend/src/components/sidebar/index.test.tsx` — footer assertions.
- No backend, routing, API, or keyboard-shortcut changes. No new dependencies. `globals.css` untouched (`rk-glint` already exists and is reduced-motion-safe).

## Open Questions

None — the treatment was chosen from a rendered mock of four alternatives.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Adopt Option A (top-bar chip idiom: border + `rk-glint` + green-line hover) for all four footer actions | Discussed — user chose A from a live mock of four options rendered with real tokens | S:95 R:90 A:95 D:95 |
| 2 | Certain | Icons, ordering, behaviors, Tips, aria-labels, and the left-side dot/version readouts are unchanged | Scope was explicitly visual treatment only; mock kept them identical | S:90 R:95 A:95 D:90 |
| 3 | Confident | Chip geometry is fixed 24×24 fine / 30×30 coarse (footer-scaled from the top bar's 28/30) | Mock rendered 24px and was approved; coarse 30px preserves the current touch target; fixed-size mirrors the top bar's anti-drift token decision | S:80 R:85 A:85 D:80 |
| 4 | Confident | Reuse the exported `TOP_BAR_BUTTON_REST` for rest/hover colors instead of duplicating the string | "One app-wide vocabulary" is the stated motivation; the export exists; footer keeps local geometry since 24px ≠ 28px | S:70 R:90 A:85 D:75 |
| 5 | Confident | Cluster gap widens `gap-0.5` → `gap-1` | Approved mock used 4px spacing between bordered chips; 2px would visually fuse adjacent borders | S:70 R:95 A:85 D:75 |
| 6 | Confident | Rewrite the o7q8 doc comment + SidebarFooter JSDoc to record the reversal | Comments claiming a deliberate contrast would become actively misleading; recording reversals at the site is existing repo practice | S:75 R:95 A:90 D:85 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).
