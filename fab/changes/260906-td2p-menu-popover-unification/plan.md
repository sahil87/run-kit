# Plan: Menu & Popover Unification

**Change**: 260906-td2p-menu-popover-unification
**Intake**: `intake.md`

## Requirements

### Menus: One Row Scale

#### R1: MENU_ROW is the one menu-row family, with a coarse floor
`MENU_ROW_BASE` (`controls.ts`) MUST gain `min-h-[28px] coarse:min-h-[40px]` (fine unchanged visually — 28px matches today's xs/py-1.5 box). `POPOVER_ROW_CLASS` MUST be retired: its consumers (open popover target rows `open-button.tsx`~:206, split-direction rows `top-bar.tsx`~:2406/:2421, layout shape rows `layout-chip.tsx`~:139) move to `MENU_ROW_CLASS` (xs scale, px-2.5), with disabled unified on `MENU_ROW_DISABLED` (opacity-40 + not-allowed + hover-neutralized). `breadcrumb-dropdown.tsx` rows (~:203, ~:224-241) MUST adopt `MENU_ROW_CLASS` (their truncation/icon extras stay call-site). The two hand-rolled version rows (`top-bar-overflow-menu.tsx`~:543, ~:577) MUST compose `MENU_ROW_BASE` instead of re-typed strings (restoring the dropped `flex items-center gap-2` on the copy row).

- **GIVEN** any menu/popover row on a coarse pointer
- **WHEN** rendered
- **THEN** it is ≥40px tall, on the MENU_ROW scale, and `grep -rn "POPOVER_ROW_CLASS" src/` is empty

#### R2: One popover shell
`controls.ts` MUST export `POPOVER_SHELL = "bg-bg-primary border border-border rounded-lg shadow-2xl py-1 z-50"`. Consumers replace their inline copies: overflow menu container (`top-bar-overflow-menu.tsx`~:658), split popover (`top-bar.tsx`~:2400), layout popover (`layout-chip.tsx`), open popover (`open-button.tsx`), breadcrumb dropdown container, and the F▴ menu container (`bottom-bar.tsx` — its `max-h-[calc(var(--app-height,100vh)-130px)] overflow-y-auto` viewport cap stays call-site). Per-menu min/max-width stays call-site. Section labels unify on the overflow menu's recipe (`px-2.5 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-text-secondary select-none`); `open-button.tsx`~:177 aligns.

- **GIVEN** the shell extraction lands
- **WHEN** popovers render
- **THEN** they are pixel-identical to today (widths unchanged) and no inline copy of the shell string remains

### Menus: One Checked/Selected Vocabulary (green)

#### R3: MENU_ROW_CHECKED replaces the four dialects
`controls.ts` MUST export a checked treatment (row ink `text-text-primary`; trailing `ml-auto` ✓ in `text-accent-green`) — suggested shape: a `MENU_ROW_CHECKED` row-ink constant plus a small `MenuCheck`/shared ✓ span idiom if a component is cleaner. Migrations: `MENU_ROW_ACTIVE` inverse-video consumers (layout menu rows, `layout-chip.tsx`~:186) → checked treatment, then DELETE `MENU_ROW_ACTIVE` (`top-bar-overflow-menu.tsx:67`); the uncolored ✓s (autofit `top-bar.tsx`~:2720, fixed-width ~:2671) and LayoutChip popover ✓ (~:139) → the green ✓; `SurfaceToggleMenuRows` (`top-bar.tsx`~:480-495) gains the green ✓ on `aria-checked` (today: no visual); breadcrumb `item.current` (`breadcrumb-dropdown.tsx`~:224-241) drops `text-accent` for the checked treatment (keep `aria-current`). The F▴ menu rows are already conformant — untouched.

- **GIVEN** any checked/current menu row
- **WHEN** rendered
- **THEN** it shows row-primary ink + trailing green ✓; no inverse-video row, no uncolored ✓, and no `text-accent` current-tint remains in any menu

#### R4: Settings pickers move to the green selected treatment
Via REST-swap (selected arm replaces hover-carrying rest classes): ThemePairControl mode buttons (`settings-dialog.tsx:158-171`, bordered chips, keep `aria-pressed`) → `LATCHED_ARM`; shortcuts-panel platform/tier/target selections (`settings-shortcuts-panel.tsx:689/:772/:980`) → green selected fills, shape-matched (`LATCHED_ARM` where bordered; `bg-accent-green/15 text-accent-green` fill+ink where borderless).

- **GIVEN** a selected settings picker option
- **WHEN** rendered or hovered
- **THEN** its selection reads green, holds under hover (REST-swap), and no `bg-accent/20`/`border-accent` selection survives in the settings surfaces

### Top Bar: Trigger Floor

#### R5: Breadcrumb-dropdown triggers join the coarse floor
`breadcrumb-dropdown.tsx:174`'s trigger sizing gains `coarse:min-h-[40px] coarse:min-w-[40px]` (fine 24px unchanged — a within-crumb affordance). The breadcrumb collapse measurement runs on fine pointers; coarse-only classes MUST NOT change fine measurement.

- **GIVEN** a coarse pointer
- **WHEN** the `… ▾`/tab-switcher/board-switcher triggers render
- **THEN** each hit target is ≥40px; fine-pointer crumb widths are byte-identical

### Tests

#### R6: Tests conform to the new vocabulary
Sweep `app/frontend/tests/` + `src/**/*.test.tsx` for assertions pinned to `POPOVER_ROW_CLASS` (11px, opacity-50), `MENU_ROW_ACTIVE` inverse video, breadcrumb `text-accent` current tint, settings `bg-accent/20` selections, and 24px trigger geometry; update with intent comments in the same edit. Exact/anchored assertions where palette/menu text could collide.

- **GIVEN** the scoped affected suites run
- **WHEN** assertions execute
- **THEN** they verify the new contract and pass

### Non-Goals

- Command palette's own row treatment (not a popover-menu surface; slice-7 polish)
- Dialogs/inputs (slice 6), sidebar rows/flyouts (slice 5), the `Control` primitive (slice 7)
- Menu behavior (roving focus, dismiss semantics) — classes/constants only

### Design Decisions

#### POPOVER_ROW_CLASS retires into MENU_ROW at the MENU_ROW scale
**Decision**: One row scale (text-xs, px-2.5, 28/40 floors); the 11px/px-3 popover scale is deleted.
**Why**: Four scales for one role is the audited drift; MENU_ROW has the most consumers and the complete disabled recipe.
**Rejected**: Keeping a smaller popover scale — re-encodes a distinction no design rule motivates.
*Introduced by*: 260906-td2p-menu-popover-unification

#### Checked = row ink + trailing green ✓ (inverse video retired)
**Decision**: One checked treatment for every menu row: `text-text-primary` ink + `ml-auto` green ✓.
**Why**: Scheme C (green = state) and the F▴/contract-preview idiom; inverse video reads as a different widget class and collides with hover fills.
**Rejected**: Inverse video everywhere — heavier than the information carried; green tint fills on rows — competes with the hover fill channel.
*Introduced by*: 260906-td2p-menu-popover-unification

## Tasks

### Phase 1: Setup

- [x] T001 `controls.ts`: add `min-h-[28px] coarse:min-h-[40px]` to `MENU_ROW_BASE`; export `POPOVER_SHELL` and the checked treatment (`MENU_ROW_CHECKED` ink + shared green-✓ idiom); doc comments state the one-scale/one-checked rules <!-- R1, R2, R3 -->

### Phase 2: Core Implementation

- [x] T002 `top-bar-overflow-menu.tsx`: container → `POPOVER_SHELL`; version rows (~:543, ~:577) compose `MENU_ROW_BASE` (restore `flex items-center gap-2` on the copy row); delete `MENU_ROW_ACTIVE` once T004 lands (ordering: after T004) <!-- R1, R2, R3 -->
- [x] T003 [P] `top-bar.tsx`: split-direction rows → `MENU_ROW_CLASS`; split popover container → `POPOVER_SHELL`; `SurfaceToggleMenuRows` gain the green ✓; autofit + fixed-width rows' ✓ → green <!-- R1, R2, R3 -->
- [x] T004 [P] `layout-chip.tsx` (rows → `MENU_ROW_CLASS`/checked treatment, popover → shell, ✓ aligned) and `open-button.tsx` (target rows → `MENU_ROW_CLASS`, container → shell, "on host" section label → the unified label recipe) <!-- R1, R2, R3 -->
- [x] T005 [P] `breadcrumb-dropdown.tsx`: rows adopt `MENU_ROW_CLASS` (call-site truncation/icon extras); `item.current` → checked treatment (keep `aria-current`); container → shell; triggers gain the coarse 40 floor <!-- R1, R2, R3, R5 -->
- [x] T006 [P] `bottom-bar.tsx`: F▴ menu container adopts `POPOVER_SHELL` + keeps its viewport cap call-site <!-- R2 -->
- [x] T007 [P] Settings pickers: `settings-dialog.tsx:158-171` ThemePairControl → `LATCHED_ARM` (REST-swap, keep aria); `settings-shortcuts-panel.tsx:689/:772/:980` selections → green, shape-matched <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Test sweep per R6 (grep `POPOVER_ROW_CLASS`, `MENU_ROW_ACTIVE`, `bg-accent-green text-bg-primary`, breadcrumb `text-accent`, settings `bg-accent/20`, 24px trigger assertions); update intent comments in the same edits <!-- R6 -->
- [x] T009 Verify: `cd app/frontend && npx tsc --noEmit`; affected unit suites (top-bar, top-bar-overflow-menu, layout-chip, open-button, breadcrumb-dropdown, bottom-bar, settings-dialog, settings-shortcuts-panel as they exist); scoped e2e only for touched surfaces (breadcrumb/top-bar/menu specs T008 touched) — never the full suite <!-- R6 -->

## Execution Order

- T001 blocks T002–T007; T002's `MENU_ROW_ACTIVE` deletion waits for T004; T008 after T002–T007; T009 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `POPOVER_ROW_CLASS` has zero definitions and zero references; all enumerated rows on `MENU_ROW_CLASS`; `MENU_ROW_BASE` carries the 28/40 floors
- [x] A-002 R2: `POPOVER_SHELL` exported and consumed at all six containers; no inline copy of the shell string remains; F▴ viewport cap intact
- [x] A-003 R3: `MENU_ROW_ACTIVE` deleted; every checked/current menu row uses the checked treatment (green ✓ + primary ink); `SurfaceToggleMenuRows` show state; breadcrumb current has no `text-accent`
- [x] A-004 R4: Settings pickers' selected arms are green via REST-swap; `grep -n "bg-accent/20\|border-accent[^-]" settings-*.tsx` is empty
- [x] A-005 R5: Breadcrumb triggers carry `coarse:min-h/w-[40px]`; fine values untouched

### Behavioral Correctness

- [x] A-006 R3: A checked row under hover keeps primary ink + green ✓ (hover fill only) — no competing hover utility on checked/selected arms
- [x] A-007 R5: Fine-pointer breadcrumb collapse measurement unchanged (crumb widths identical; collapse rung fires at the same widths)

### Scenario Coverage

- [x] A-008 R6: Updated suites pass; scoped e2e for touched specs passes; no assertion still encodes the retired vocabularies

### Edge Cases & Error Handling

- [x] A-009 R1: Disabled popover rows now use the 40-opacity unified recipe; `aria`-disabled anchor rows (Help) unaffected
- [x] A-010 R2: Menus anchored near viewport edges render as today (shell extraction adds no positioning change)

### Code Quality

- [x] A-011 Pattern consistency: checked/selected branches follow the REST-swap idiom; constants SCREAMING_SNAKE in controls.ts with constraint-only comments
- [x] A-012 No duplication: zero re-typed row/shell strings survive at migrated sites
- [x] A-013 No comment narration or change-ID citations in code/intent comments

## Notes

- Check items as you review: `- [x]`
- Full e2e suite is on-demand only — scope to changed-surface specs.

## Deletion Candidates

- None — the redundant code this change produced (`POPOVER_ROW_CLASS`, `MENU_ROW_ACTIVE`, the inline shell/row string copies) was already deleted as planned removals declared in `## Requirements`; review found no further redundancy the apply pass missed.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The checked ✓ ships as a tiny shared span idiom (constant or helper) rather than a component — slice 7 owns componentization | Smallest change that kills the four dialects | S:68 R:85 A:82 D:75 |
| 2 | Confident | Version rows keep their color arms (green update row) as call-site additions on MENU_ROW_BASE | Their hue is status semantics, not selection | S:66 R:85 A:80 D:74 |

2 assumptions (0 certain, 2 confident, 0 tentative).
