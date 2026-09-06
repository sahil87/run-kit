# Intake: Server Header Coarse Density

**Change**: 260906-wr2z-server-header-coarse-density
**Created**: 2026-09-06

## Origin

Operator-dispatched mobile bug report with two iPhone screenshots (`.uploads/260906213250-IMG_3276.png`, `.uploads/260906213250-IMG_3277.png`).

> User's words: "the server pane header is too thick."

Investigated in the dispatching session (one-shot, root cause confirmed before intake):

- Measured from the screenshots: the SERVER section header renders ~55pt tall on the iPhone drawer while the BOARDS header directly above it renders ~24pt — visible in both the collapsed (IMG_3276) and expanded (IMG_3277) states, so the thickness is the **header row itself**, not the tile grid.
- Root cause located: `CollapsiblePanel`'s header is a `flex items-center … py-1` row (`app/frontend/src/components/sidebar/collapsible-panel.tsx:263`) whose height is governed by its tallest child. The SERVER panel's `headerAction` — the `+` create-server button (`app/frontend/src/components/sidebar/server-panel.tsx:132`) — carries the stray-tappable floor pair `min-w-[24px] min-h-[24px] coarse:min-w-[40px] coarse:min-h-[40px]`. On a coarse pointer the 40px min-height stretches the whole header row to ~48px (+3px panel top border ≈ the measured ~51–55pt). BOARDS has only a small `headerRight` pin icon (no action button), so its header stays at the text-driven ~24px.
- Decision from the dispatch discussion: the 24px-fine / 40px-coarse touch-target floor is a settled repo-wide convention (visual-design § Touch Targets) and MUST be kept — the fix is to make the floor **layout-neutral** (negative vertical margin so the hit target overhangs the row instead of stretching it), not to shrink the target.

## Why

1. **Pain point**: On mobile, the sidebar drawer's SERVER header is roughly twice the height of the BOARDS and SESSIONS headers around it. It reads as a rendering bug, wastes vertical space in a drawer that is already height-constrained (the SESSIONS tree below is the surface users scroll), and breaks the sidebar's uniform section-header rhythm.
2. **Consequence of not fixing**: every coarse-pointer viewer sees a visually broken drawer; the wasted ~24px comes directly out of the SESSIONS list. The same defect silently applies to the HOST panel header (same class string on its palette `titleAction` button), so the desktop sidebar on touch-capable devices (tablets, touchscreen laptops — `coarse:` matches `any-pointer: coarse`) is inconsistently dense too.
3. **Why this approach**: shrinking the button's coarse floor would violate the settled 40px touch-target convention; giving the header a fixed height with `overflow: visible` would fight the flex layout and clip focus rings. A negative vertical margin on the coarse arm is the standard, minimal way to keep a large hit target without letting it drive row height — the button's painted content (a 13px `+`) is unaffected, only its invisible hit box overhangs the neighboring rows by a few px, which is exactly what a touch floor is for.

## What Changes

### 1. SERVER panel `+` headerAction becomes layout-neutral on coarse (`server-panel.tsx`)

`app/frontend/src/components/sidebar/server-panel.tsx:132` — the `+` button's class string gains a coarse negative vertical margin sized so the button's layout contribution no longer exceeds the header's text-driven height. Current relevant classes:

```
px-1 min-w-[24px] min-h-[24px] coarse:min-w-[40px] coarse:min-h-[40px] flex items-center justify-center
```

Add the negative-margin arm(s) so that on coarse pointers the 40px box contributes ≤ the row's natural content height (16px text line): e.g. `-my-1 coarse:-my-3` (fine: 24 − 2·4 = 16; coarse: 40 − 2·12 = 16). The exact utility values are apply-time detail; the acceptance-level contract is:

- The SERVER `CollapsiblePanel` header row height equals the BOARDS header row height on both pointer classes (collapsed and expanded).
- The `+` button's hit box stays ≥ 24×24 fine / ≥ 40×40 coarse (the floor pair is unchanged — only margins are added).

### 2. HOST panel palette `titleAction` gets the identical treatment (`host-panel.tsx`)

`app/frontend/src/components/sidebar/host-panel.tsx:88` — the instance-color palette button carries the same `min-w-[24px] min-h-[24px] coarse:min-w-[40px] coarse:min-h-[40px]` floor inside the same header flex row (via the `titleAction` slot) and inflates the HOST header identically on coarse pointers. Apply the same negative-margin spelling so both fixed headers match sibling density.

### 3. e2e regression coverage

Add a coarse-pointer assertion (touch emulation, per the existing coarse-emulation idiom in `control-gallery.spec.ts` / mobile specs) comparing the SERVER panel header's bounding-box height to the BOARDS header's — equal (±1px). Natural home: `sidebar-panels.spec.ts` or `server-panel-grid.spec.ts`, whichever already exercises the panel headers. Per the constitution's Test Intent Comments rule, the new `test()` carries a Proves/Steps JSDoc block.

### Non-goals

- The PANE panel's bordered refresh chip (`status-panel.tsx:183`, `coarse:min-h-[30px]`) is a visible bordered control with a deliberately smaller coarse floor — restyling it is a separate visual decision, out of scope.
- The status-panel PR-copy cluster (`status-panel.tsx:369`) already sits in an `absolute … -translate-y-1/2` wrapper and is layout-neutral — no change.
- Tile grid / tile anatomy (`ServerTile`) — unchanged; the tiles were not the reported defect.
- No change to `CollapsiblePanel` itself — the fix belongs at the two call sites whose action buttons carry the floor, not in the shared shell.

## Affected Memory

- `run-kit/ui/sidebar`: (modify) § Stray Floors and One Row-Hover Alpha — record that the SERVER `+` and HOST palette floors are layout-neutral (negative vertical margin) so panel headers keep the text-driven height; the server-panel/host-panel component bullets pick up the new spelling.
- `run-kit/ui/visual-design`: (modify) § Touch Targets, the "Sidebar stray tappables" paragraph — the floor pair gains the layout-neutral rule for buttons living inside fixed-density header rows.

## Impact

- `app/frontend/src/components/sidebar/server-panel.tsx` — one class-string edit (headerAction button).
- `app/frontend/src/components/sidebar/host-panel.tsx` — one class-string edit (titleAction button).
- `app/frontend/tests/e2e/sidebar-panels.spec.ts` (or `server-panel-grid.spec.ts`) — one new coarse-emulation test.
- No backend, API, or state changes. No new components, tokens, or constants.
- Risk: the overhanging hit box overlaps ~8–12px of the adjacent panel edge / first tile row on coarse; this is inherent to layout-neutral touch floors and matches how the absolute-positioned PR-copy cluster already behaves.

## Open Questions

*(none — root cause verified against source and screenshots in the dispatching session)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is the 40px coarse floor on the header flex row's action button, not the tile grid | Verified by reading collapsible-panel.tsx (flex row, tallest child wins) + server-panel.tsx classes; screenshot measurements match the computed ~48px | S:90 R:90 A:95 D:95 |
| 2 | Confident | Fix = negative vertical margin on the button (layout-neutral floor), keeping the 24/40 target sizes | Discussed at dispatch — 40px coarse target is a settled convention (visual-design § Touch Targets); negative margin is the minimal standard escape; exact utility values left to apply | S:75 R:85 A:80 D:70 |
| 3 | Confident | Include host-panel.tsx's identical titleAction in scope | Same class string in the same header shell — same defect on coarse-capable desktops; fixing one and not the other leaves the vocabulary split | S:70 R:85 A:85 D:80 |
| 4 | Confident | PANE panel refresh chip (30px coarse bordered button) stays out of scope | Different control species (visible bordered chip, deliberately smaller floor); restyling it is a separate visual decision | S:65 R:90 A:75 D:70 |
| 5 | Tentative | New e2e assertion lands in sidebar-panels.spec.ts comparing SERVER vs BOARDS header heights under touch emulation | Two plausible host specs (sidebar-panels / server-panel-grid); apply picks whichever already mounts both headers <!-- assumed: e2e host spec — sidebar-panels.spec.ts vs server-panel-grid.spec.ts, apply decides --> | S:55 R:90 A:70 D:55 |

5 assumptions (1 certain, 3 confident, 1 tentative, 0 unresolved).
