# Intake: Menu & Popover Unification

**Change**: 260906-td2p-menu-popover-unification
**Created**: 2026-09-06

## Origin

> Operator-dispatched: slice 4 of the control-vocabulary retrofit, per `fab/plans/sahil/26-09-06-control-retrofit-slices.md` (merged, PR #848). Intake seed: one menu system — a single row scale with a 40px coarse floor, one shared popover-shell recipe, and one selected/checked vocabulary (green ✓ / green tint — retiring `MENU_ROW_ACTIVE`'s inverse video and the last selection blues).

Slices 1–3 shipped as PR #845 (tokens, global focus/pressed/select rules, hue-free glint, 40px coarse floor, bar recomposition) and PR #847 (green latch vocabulary, `LATCHED_ARM`/`LATCHED_ARM_RINGED`). The contract of record is `docs/wiki/control-state-audit.html` + `control-contract-preview.html` (scheme C, settled 2026-09-05); post-change truth so far lives in `docs/memory/run-kit/ui/visual-design.md`. This slice extends the same discipline to menus, popovers, and the selection vocabulary.

### Standing context (binding on apply — do not re-derive)

- **Tokens**: `--ctl-*` custom properties in `globals.css` `:root`; TS constants keep Tailwind literals with lockstep comments (the `COARSE_POINTER_QUERY` convention).
- **Shared arms** in `app/frontend/src/components/controls.ts`: `TOP_BAR_*`, `MENU_ROW_*`, `POPOVER_ROW_CLASS`, `LATCHED_ARM`, `LATCHED_ARM_RINGED`; `KBD_BASE`/`KBD_REST`/`KBD_CLASS` in `kbd-chip.ts`; `FN_ITEM_BASE`/`FN_ITEM_CLASS` in `bottom-bar.tsx`.
- **REST-swap rule** (load-bearing, proven on PR #845's review cycles): a latched/selected arm replaces the hover-carrying rest classes — never stacks on them (specificity ties resolve by compiled source order).
- **Global rules already shipped — do not duplicate per site**: unlayered `:focus-visible` green ring, `:active` pressed fill, long-press select guard, hue-free glint.
- **Color algebra**: hover = brightness only · green = state (latch/armed/open/checked/selected) · signal hues = status · blue survives only where slices 5–6 own it (inputs' focus borders; sidebar-slice strays).
- **Coarse floor**: 40px (38 for inset segments). Fine sizes unchanged.
- **Verification**: `npx tsc --noEmit` + affected unit suites + scoped e2e only (full suite is never a gate — standing directive 2026-09-03). Tests conform to the spec (constitution Test Integrity); Playwright intent comments updated in the same edit; no change-ID citations in code comments.

## Why

1. **The pain** (audit §7/§4): four menu-row scales coexist (`MENU_ROW_*` xs/px-2.5, `POPOVER_ROW_CLASS` 11px/px-3, breadcrumb-dropdown rows sm/px-3 with no constant, two hand-rolled version rows re-typing `MENU_ROW_BASE`); menu rows have **no coarse touch floor**; four popover containers restate one shell recipe; and "selected" speaks four visual languages — inverse video (`MENU_ROW_ACTIVE`), a green ✓, an uncolored ✓, a blue text tint (`item.current`) — while `SurfaceToggleMenuRows` is a `menuitemcheckbox` with **no checked affordance at all** (tile state visible in the bar, invisible in the menu).
2. **If unfixed**: the selection half of the vocabulary stays four-way ambiguous, blue survives in selection (contradicting scheme C), and menus stay below the 40px coarse contract every other control now honors.
3. **Approach**: constants-first, exactly like slices 1–3 — fold the scales into the `MENU_ROW_*` family, export one popover shell, define one green checked treatment, and migrate the enumerated sites via REST-swap.

## What Changes

### 1. One menu-row scale (`MENU_ROW_*` is the survivor)

- `MENU_ROW_BASE` gains the coarse floor: add `min-h-[28px] coarse:min-h-[40px]` (fine rows keep today's rendered height — 28px matches the current xs/py-1.5 box; lockstep-comment `--ctl-h-row` if a row token is added, else the existing literals convention).
- **Fold `POPOVER_ROW_CLASS` into the family**: popover rows become `MENU_ROW_CLASS` consumers (text-xs, px-2.5). Its disabled tail (`opacity-50`) aligns to `MENU_ROW_DISABLED`'s unified recipe (opacity-40 + not-allowed + hover-neutralized). Consumers: `open-button.tsx` (~:206 target rows), `top-bar.tsx` split-direction rows (~:2406, :2421), `layout-chip.tsx` shape rows (~:139).
- **`breadcrumb-dropdown.tsx` rows adopt the family** (~:203 leading action row, ~:224-241 item rows): today `px-3 py-2 text-sm` with no constant — move to `MENU_ROW_CLASS` (+ their truncation/icon extras as call-site additions).
- **Version rows import instead of re-typing**: `top-bar-overflow-menu.tsx` ~:543 (update row) and ~:577 (copy-version row, which dropped `flex items-center gap-2` when hand-copied) compose `MENU_ROW_BASE` + their own color arms.

### 2. One selected/checked vocabulary — green ✓ (state = green)

Define once in `controls.ts` (name suggestion: `MENU_ROW_CHECKED` — row ink `text-text-primary`; the ✓ marker `text-accent-green`, trailing `ml-auto`) and retire the four dialects:

- **`MENU_ROW_ACTIVE` inverse video** (`bg-accent-green text-bg-primary`, `top-bar-overflow-menu.tsx:67`; consumers: layout menu rows in `layout-chip.tsx:186` family) → the checked treatment. Delete the constant when no consumer remains.
- **LayoutChip popover ✓** (already green, `layout-chip.tsx:~139`) and the **uncolored ✓s** (autofit row `top-bar.tsx:~2720`, fixed-width row `~:2671`) → the same green ✓ treatment.
- **`SurfaceToggleMenuRows`** (`top-bar.tsx:~480-495`, `menuitemcheckbox` with no visual) → gains the green ✓ on `aria-checked`.
- **Breadcrumb-dropdown `item.current`** (`text-accent` tint, `breadcrumb-dropdown.tsx:~224-241`) → the checked treatment (row ink text-primary + green ✓); this retires a deferred selection blue. Keep `aria-current`.
- The F▴ menu's rows are already conformant (slice 2/3) — no change.

### 3. One popover shell

Export a shell constant from `controls.ts` (name suggestion: `POPOVER_SHELL = "bg-bg-primary border border-border rounded-lg shadow-2xl py-1 z-50"`); per-menu min/max-width stays a call-site addition. Consumers replacing inline copies: the overflow menu container (`top-bar-overflow-menu.tsx` ~:658), split/layout popovers (`top-bar.tsx` ~:2400, `layout-chip.tsx`), open popover (`open-button.tsx`), breadcrumb dropdown, and the F▴ menu container in `bottom-bar.tsx` (keep its `max-h-[calc(var(--app-height,100vh)-130px)] overflow-y-auto` viewport cap — that stays call-site). Section labels unify on the overflow menu's paddings (`px-2.5 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-text-secondary select-none`) — `open-button.tsx:~177`'s "on host" header aligns.

### 4. Settings pickers (slice-3 reviewer tracker)

Mutually-exclusive **selection** controls move to a green selected treatment via REST-swap (selected arm replaces the hover-carrying rest classes):

- **ThemePairControl mode buttons** (`settings-dialog.tsx:158-171`): selected `border-accent … bg-bg-inset` → `LATCHED_ARM` (they are bordered chip-shaped buttons; keep `aria-pressed`).
- **Shortcuts-panel platform/tier/target selections** (`settings-shortcuts-panel.tsx:689/:772/:980`): `bg-accent/20` selected fills → green selected fills (use `LATCHED_ARM` for bordered shapes, or fill+ink `bg-accent-green/15 text-accent-green` where the control is borderless — match each site's shape).

### 5. Breadcrumb-dropdown triggers join the coarse floor

`breadcrumb-dropdown.tsx:174`'s `min-w-[24px] min-h-[24px]` (governs the collapsed `… ▾`, tab switcher, and board switcher triggers) gains `coarse:min-h-[40px] coarse:min-w-[40px]` — the audit's last top-bar-family stray. Fine 24px stays (it is a within-crumb affordance).

### 6. Tests conform

Sweep `app/frontend/tests/` + `src/**/*.test.tsx` for assertions pinned to: `POPOVER_ROW_CLASS`'s 11px/opacity-50, inverse-video `MENU_ROW_ACTIVE` (`bg-accent-green text-bg-primary`), breadcrumb `text-accent` current tint, settings `bg-accent/20` selections, and the breadcrumb 24px trigger geometry. Update intent comments in the same edit. Palette risk: no new standing palette rows are added by this slice; if any test text collides, apply exact/anchored assertions per the standing collision rule.

### Non-goals

- Dialogs and text inputs (slice 6); sidebar rows/flyouts/icon clusters (slice 5); the `Control` primitive and gallery (slice 7).
- The command palette's own row treatment (`command-palette.tsx` selected `bg-bg-card`) — the palette is not a popover-menu surface and its weak hover/selected separation is slice-7 gallery-era polish; touching it here risks the palette e2e surface for no contract gain.
- Menu behavior (roving focus, dismiss semantics) — classes and constants only.
- Geometry beyond the two enumerated floors (menu rows, breadcrumb triggers).

## Affected Memory

- `run-kit/ui/visual-design`: (modify) selection/checked joins the green vocabulary (one checked treatment, `MENU_ROW_ACTIVE` inverse video retired); popover shell + menu-row scale as shared constants
- `run-kit/ui/top-bar`: (modify) menu-row family absorbs popover/breadcrumb/version rows; one popover shell; breadcrumb triggers 40px coarse; surface-toggle menu rows gain the checked ✓
- `run-kit/ui/keyboard-and-palette`: (modify) Settings Shortcuts tab platform/tier/target pickers on the green selected treatment
- `run-kit/ui/dialogs-and-state`: (modify) settings-dialog ThemePairControl mode picker on the green selected treatment

## Impact

- **Files**: `controls.ts`, `top-bar-overflow-menu.tsx`, `top-bar.tsx`, `layout-chip.tsx`, `open-button.tsx`, `breadcrumb-dropdown.tsx`, `bottom-bar.tsx` (shell adoption only), `settings-dialog.tsx`, `settings-shortcuts-panel.tsx` + affected tests.
- **Visible deltas** (intended): menu rows meet the 40px coarse floor; every checked/selected menu row and settings picker reads green; the layout menu loses its inverse-video rows; the breadcrumb's current item loses its blue tint; popovers render identically (shell extraction is invisible).
- **Risk surface**: e2e specs on menus/palette (pointer-events hover gates, exact-text assertions); breadcrumb-collapse measurement logic reads crumb widths — the trigger coarse floor must not disturb fine-pointer measurement (coarse-only classes, no fine change); `MENU_ROW_KBD_CLASS` chips inside taller coarse rows (verify vertical centering).
- Frontend-only; no backend/API/tmux impact.

## Open Questions

- None — the plan doc pre-settled the decisions; judgment calls are graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Green is the one selected/checked hue; inverse video and selection blues retire | Scheme C settled 2026-09-05; plan doc merged (PR #848) directs this slice | S:95 R:75 A:95 D:95 |
| 2 | Certain | Strict slice scope: menus/popovers/pickers only; palette rows, dialogs, sidebar untouched | Plan §Sequencing + non-goals | S:90 R:85 A:92 D:90 |
| 3 | Confident | `MENU_ROW_*` absorbs `POPOVER_ROW_CLASS` at the MENU_ROW scale (xs/px-2.5); the 11px scale retires | Plan names MENU_ROW as survivor; one-scale rule outweighs the 1px type delta | S:72 R:82 A:85 D:75 |
| 4 | Confident | Checked treatment = row ink text-primary + trailing green ✓ (`ml-auto`), as `MENU_ROW_CHECKED` in controls.ts | Matches the F▴/contract-preview idiom and LayoutChip's existing ✓ | S:70 R:85 A:82 D:78 |
| 5 | Confident | Breadcrumb rows keep their truncation/icon behaviors as call-site additions on MENU_ROW_CLASS | Class-string migration only; behavior untouched by slice rule | S:68 R:85 A:80 D:75 |
| 6 | Confident | Fine menu-row floor is 28px (`min-h-[28px]`), matching today's rendered xs/py-1.5 box — no fine-pointer visual change | Floor formalizes the existing height; only coarse grows | S:65 R:88 A:80 D:75 |
| 7 | Confident | Settings pickers use LATCHED_ARM where bordered, fill+ink where borderless — shape-matched, both green | Slice-3 precedent (rail vs chips); reviewer tracker language | S:66 R:82 A:80 D:72 |

7 assumptions (2 certain, 5 confident, 0 tentative).
