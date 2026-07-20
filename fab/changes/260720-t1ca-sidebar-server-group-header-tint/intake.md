# Intake: Sidebar SESSIONS Pane — Tinted Server-Group Header Fill

**Change**: 260720-t1ca-sidebar-server-group-header-tint
**Created**: 2026-07-21

## Origin

Promptless dispatch (`/fab-proceed` create-intake) from a synthesized design discussion. The user explored the problem interactively, reviewed **side-by-side HTML mockups** of five variants, and approved **Variant D: tinted header fill**. Key decisions (variant choice, color-only-on-header-surface, rejected alternatives) were made by the user in that discussion; this intake is the sole state-transfer artifact — no draft folders were consulted.

> **Title direction**: Sidebar SESSIONS pane — tinted server-group header fill (server identity).
>
> **Problem**: In the sidebar's SESSIONS pane — especially in ALL scope with many tmux servers — server groups and sessions are hard to tell apart. Every server-group header renders as identical dim 10px uppercase text, and names echo across levels (server SHLL → session shll → window shll, from folder-basename conventions), so users get lost finding their windows. Per-server colors already exist (assigned in settings.yaml, rendered as colored SERVER tiles in the server panel), but that identity never reaches the SESSIONS pane.
>
> **Decision (user-approved via mockups)**: Style each server-group header in the SESSIONS pane as a filled bar carrying that server's color — low-strength color-mixed background, color-mixed text, heavier treatment (taller, weight 600, subtle top border), color ONLY on the header surface (gutter untouched).

## Why

1. **Pain point**: In ALL scope with many servers, every server-group header is identical dim 10px uppercase text (`app/frontend/src/components/sidebar/index.tsx:1533`). Server, session, and window names echo each other (folder-basename naming makes server SHLL → session shll → window shll routine), so the only disambiguating landmark — which server a subtree belongs to — is visually indistinguishable from the rows it contains. Users get lost finding their windows.

2. **Consequence of not fixing**: The multi-server SESSIONS tree stays navigable only by reading text labels; the per-server color identity users already assign in settings.yaml (and already see as colored SERVER tiles) is wasted in the one pane where wayfinding matters most. As server counts grow (ALL scope), scanning cost grows linearly.

3. **Why this approach**: The `serverColor` prop is **already plumbed** into `ServerGroupInner` (passed at `index.tsx:1179`, typed at `:1294`, destructured at `:1375`) and is currently unused in its render — the data path exists; only the paint is missing. Variant D (tinted header fill) was chosen over the alternatives because it adds both hierarchy (a filled bar separates group levels from row levels) and identity (the fill carries the server's color), without touching the left gutter, which is reserved for the window-marker vocabulary.

**Alternatives rejected (user decisions, for the record)**:
- Full-height 3px left color stripe per group (+faint header tint) — rejected: collides with the window-marker left-gutter stripes (dotted/solid/double, `markerStripeStyle` in `app/frontend/src/themes.ts:440`).
- Header-only color swatch/dot with tinted name, no fill — subsumed by D.
- Neutral gray header fill only — improves hierarchy but carries no server identity (D = this + color).
- Tinted fill + ~4% whole-group-body color wash — deferred: risks muddying the green agent-activity row tints.
- Neutral fill + 2px server-color bottom rule — kept as fallback if D reads too heavy; not chosen.

## What Changes

### 1. Server-group header fill (Variant D)

In `ServerGroupInner` (`app/frontend/src/components/sidebar/index.tsx`, header render at `:1512–1555`), each server-group header in the SESSIONS pane becomes a filled bar carrying that server's color:

- **Header background**: the server color mixed at low strength into the theme background. The approved mockup used `color-mix(in srgb, <serverColor> 16%, #171a1f)`. The mockup hexes are **visual targets, not literal values** — the implementation resolves the actual color through the existing theme machinery (see §3).
- **Header text**: the server color mixed toward the light text — mockup target `color-mix(in srgb, <serverColor> 62%, #e2e5e8)`. Text must remain legible against the tinted fill; the contrast-guarded `rowBorders` color (WCAG-nudged vs theme background via `adjustBorderForContrast`) is the natural candidate for the text/accent role.
- **Heavier treatment than today**: taller header (mockup 26px vs today's ~22px visual; today's classes are `min-h-[20px] coarse:min-h-[28px]` at `:1533` — coarse-pointer height must not shrink), `font-weight: 600`, and a subtle top border separating consecutive groups (note the `<section>` already carries `border-b border-border last:border-b-0` at `:1514`).
- The fill covers the header bar surface (the full-width header row container at `:1521`, which holds the toggle button and the `+` new-session button), replacing the current transparent background + `hover:bg-bg-card/30` treatment with tint-aware rest/hover states.

### 2. Scope boundary: color on the header surface ONLY

The left gutter stays untouched — it belongs to the window-marker vocabulary (dotted/solid/double left-edge stripes, `markerStripeStyle` in `app/frontend/src/themes.ts:440`). This was the explicit reason the full-height group stripe was rejected. No color wash on the group body rows (deferred alternative). No changes to session rows, window rows, agent-activity tints, or the SERVER panel tiles.

### 3. Color resolution: reuse the existing descriptor machinery

`serverColor` values are color **descriptors** (`"4"` / `"1+3"` legacy vocabulary, or family names), sourced from settings.yaml via `getAllServerColors()` into `serverColors` state (`index.tsx:127`). The SERVER panel tiles already resolve these via the precomputed maps: `rowTints.get(color)` (blended fills from `computeRowTints(theme.palette)`, `index.tsx:98`) and `rowBorders.get(color)` (contrast-adjusted saturated hex from `computeRowBorders`) — see `app/frontend/src/components/sidebar/server-panel.tsx:155–166`. Both maps are already passed into `ServerGroupInner` as props (`rowTints`/`rowBorders`, `:1295–1296`).

The implementation MUST resolve the header colors through this machinery (or a small addition to it in `app/frontend/src/themes.ts`, e.g. a header-specific blend ratio alongside `RowTint`'s base/hover/selected if the existing ratios don't hit the ~16%-fill / high-strength-text targets) — **not** a parallel resolution path and **not** hardcoded mockup hexes. Blending toward `palette.background` (as `computeRowTints` does) is what makes the treatment correct across the three-mode theme (system/light/dark) and all ANSI-derived palettes.

### 4. Fallback for servers with no assigned color

Servers without a settings.yaml color (`serverColors[name]` undefined) need a defined fallback header appearance. The established uncolored pattern is the gray sentinel (`UNCOLORED_SELECTED_KEY`, ANSI 8) used by the SERVER panel for uncolored tiles — a neutral fill preserving the hierarchy benefit without fabricating identity. The fallback must keep the heavier header treatment (height/weight/border) so colored and uncolored groups read as the same element class.

### 5. Current-server distinction preserved

Today the current server's header is distinguished by `text-text-primary font-medium` vs dim `text-text-secondary` (`index.tsx:1533–1537`). After tinting, the current-vs-other distinction must remain legible — e.g. brighter text and/or a deeper fill for the current server, dimmer/lower-strength treatment for others. With all headers moving to weight 600, weight alone no longer differentiates; the distinction moves to color/tint strength.

### 6. Tests

Per `fab/project/code-quality.md`, the change MUST include unit tests covering the new behavior — sidebar unit tests exist at `app/frontend/src/components/sidebar/index.test.tsx` (assert: colored server header carries the resolved tint/text styles; uncolored server gets the fallback; current-server distinction present). A Playwright e2e is optional (SHOULD where possible); if any `.spec.ts` is added or modified, its sibling `.spec.md` companion must be updated in the same commit per the constitution (§ Test Companion Docs).

## Affected Memory

- `run-kit/ui-patterns`: (modify) sidebar section — add the server-group header tint treatment (Variant D), its color-resolution path (rowTints/rowBorders reuse), the uncolored fallback, and the header-surface-only scope boundary vs the marker gutter.

## Impact

- **Frontend-only.** No backend, API, or settings.yaml schema changes — the color assignment and delivery path already exist.
- `app/frontend/src/components/sidebar/index.tsx` — `ServerGroupInner` header render (`:1512–1555`); the unused `serverColor` prop becomes live. Props `rowTints`/`rowBorders` already available in scope.
- `app/frontend/src/themes.ts` — possible small addition (header-specific blend ratios / helper) alongside `computeRowTints`/`computeRowBorders`; no changes to the marker or row-tint vocabularies.
- `app/frontend/src/components/sidebar/index.test.tsx` — new/extended unit tests.
- Optionally `app/frontend/tests/` — e2e spec + `.spec.md` companion (plan decision).
- Must render correctly across system/light/dark themes and all ANSI-derived palettes (structural, via palette blending).

## Open Questions

- None — the design was resolved in the discussion; remaining latitude (exact blend ratios, fallback styling, current-server treatment) is graded below and safely decidable at apply.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Variant D (tinted header fill) is the chosen treatment | Discussed — user approved via side-by-side HTML mockups | S:95 R:75 A:95 D:95 |
| 2 | Certain | Color appears only on the header surface; left gutter untouched | Discussed — explicit rejection of the full-height stripe to protect the window-marker gutter vocabulary | S:95 R:80 A:95 D:95 |
| 3 | Certain | Resolve descriptors via existing `rowTints`/`rowBorders`/`computeRowTints` machinery, not a parallel path | Discussed — explicit constraint; SERVER tiles prove the pattern (`server-panel.tsx:155–166`) | S:90 R:75 A:90 D:90 |
| 4 | Certain | Mockup hexes (`#171a1f`, `#e2e5e8`, 16%/62%) are visual targets, not literal values | Discussed — stated verbatim in the design decision | S:90 R:85 A:90 D:90 |
| 5 | Certain | Frontend-only scope: `ServerGroupInner` + possible `themes.ts` utility; no backend | Discussed — explicit constraint; color delivery path already exists end-to-end | S:90 R:80 A:90 D:90 |
| 6 | Certain | Whole-group body color wash is out of scope | Discussed — explicitly deferred (risks muddying agent-activity row tints) | S:95 R:85 A:95 D:95 |
| 7 | Certain | Unit tests in `index.test.tsx` are required; any e2e `.spec.ts` needs its `.spec.md` companion | code-quality.md MUST + constitution § Test Companion Docs answer this deterministically | S:85 R:90 A:95 D:90 |
| 8 | Confident | Exact blend ratios map mockup targets onto `blendHex`-toward-`palette.background` (fill) and the contrast-guarded `rowBorders` hex (text), tuned visually | Mockup gives targets; machinery gives the method; trivially adjustable constants | S:60 R:90 A:70 D:55 |
| 9 | Confident | Uncolored-server fallback = neutral gray-sentinel fill (`UNCOLORED_SELECTED_KEY`) with the same heavier treatment | Constraint flags the need; server-panel's uncolored-tile pattern is the established front-runner | S:45 R:85 A:75 D:60 |
| 10 | Confident | Current-server distinction carried by tint strength / text brightness (weight no longer differentiates at uniform 600) | Constraint requires legibility; several treatments possible, clear front-runner, easily reversed | S:55 R:90 A:65 D:55 |
| 11 | Confident | Light-theme rendering derives structurally from palette blending (mockups were dark-only) | Constraint mandates three-mode correctness; `computeRowTints` blending toward `palette.background` is the proven mechanism | S:50 R:85 A:70 D:65 |
| 12 | Confident | Header height ~26px on fine pointers; `coarse:min-h-[28px]` floor preserved | Mockup gives 26px; context.md coarse-target conventions bound the touch height | S:65 R:95 A:80 D:70 |
| 13 | Confident | Fill spans the full-width header row container (toggle button + `+` button), with tint-aware rest/hover states | "Filled bar" mockup reading; single obvious container at `index.tsx:1521` | S:60 R:95 A:75 D:70 |

13 assumptions (7 certain, 6 confident, 0 tentative, 0 unresolved).
