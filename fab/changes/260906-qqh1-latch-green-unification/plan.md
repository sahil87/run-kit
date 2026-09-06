# Plan: Latch Vocabulary Unification — Green = State

**Change**: 260906-qqh1-latch-green-unification
**Intake**: `intake.md`

## Requirements

### Controls: The Shared Latch Arm

#### R1: One latch vocabulary, two shapes
`app/frontend/src/components/controls.ts` MUST export `LATCHED_ARM = "bg-accent-green/15 border-accent-green text-accent-green hover:bg-accent-green/25"` (bordered controls) and `LATCHED_ARM_RINGED = "bg-accent-green/15 ring-1 ring-inset ring-accent-green text-accent-green hover:bg-accent-green/25"` (borderless controls — ring-inset paints inside, no layout shift), with a doc comment stating the scheme-C rule (green = state) and the REST-swap requirement (compose with a base carrying no hover color utilities — class stacking ties on specificity and loses on source order, proven on PR #845).

- **GIVEN** a latched control composed as `BASE + LATCHED_ARM`
- **WHEN** it is hovered
- **THEN** ink and border/ring stay accent-green and only the fill deepens (/15 → /25)

#### R2: Accent-blue retires from control states
Every control on-state currently using the accent-blue family MUST move to the shared arm: bottom-bar `^` chip, compose `a▏` chip, scroll-lock chip, F▴ open-latch, the F▴ menu's `⌥` latch row (row form: green fill + ink, no border), the status-bar fine-pointer `a▏` twin, board autofit, compose-strip Send's armed arm, and the window-row pin's pinned-to-viewed-board ink (`text-accent` → `text-accent-green`, glyph-only by design). Afterwards `bg-accent/`, `border-accent` (word-bounded), and control-state `text-accent` MUST NOT appear on any latched/armed control — the known deferred survivors are inputs' `focus:border-accent` and breadcrumb `item.current` (slice 4/6 scope).

- **GIVEN** any latched/armed control in the app
- **WHEN** rendered on
- **THEN** its state hue is accent-green, never accent-blue

#### R3: Existing green latches align to the shared constants
Surface-toggle segments (`top-bar.tsx` ~:437) move to `LATCHED_ARM`; section-rail toggles (`section-rail.tsx` ~:57) to `LATCHED_ARM_RINGED`; the ink-only latches — find-bar `Aa`/`.*` (`find-bar.tsx` / `surface-layout.tsx` ~:1818/:1832) and tile Find/Zoom (`surface-layout.tsx` ~:1609/:1751) — upgrade to `LATCHED_ARM_RINGED` at their existing sizes. No hardcoded green latch class strings remain at these sites.

- **GIVEN** the find-bar `Aa` toggle is on
- **WHEN** viewed at rest
- **THEN** it shows the full tint + ring + ink treatment, not bare glyph color

### Controls: Aria and Open-Latch Stragglers

#### R4: Visually-latching controls carry aria
The scroll-lock chip (`bottom-bar.tsx` ~:494) and tile Zoom (`surface-layout.tsx` ~:1751) MUST carry `aria-pressed` reflecting their latch.

- **GIVEN** scroll-lock is on
- **WHEN** the chip is queried by AT
- **THEN** `aria-pressed="true"` matches the visual latch

#### R5: Open-menu triggers latch while open
The slice-2 F▴ pattern (latched arm swapped in on the open state) MUST apply to: the overflow chevron trigger (`top-bar-overflow-menu.tsx` ~:645), Open `▾` (`open-button.tsx` ~:147), Split `▾` (`top-bar.tsx` ~:2371), the LayoutChip trigger (`layout-chip.tsx` ~:117), the compose history `↑` chip (`compose-strip.tsx` ~:1028), and tile Export (`surface-layout.tsx` ~:1627). Menu ROW selected treatments (`MENU_ROW_ACTIVE`, checked ✓s) are untouched — selection is slice 4.

- **GIVEN** the overflow menu is open
- **WHEN** its trigger is viewed
- **THEN** the trigger renders the green latch arm; closing restores rest

#### R6: Tests conform to the new vocabulary
Sweep `app/frontend/tests/` and `src/**/*.test.tsx` for assertions pinned to the old latch classes (`bg-accent/20`, `border-accent`, `text-accent` on latched controls, `/10` green fills) and update to the shared-arm expectations; Playwright intent comments updated where a `test()` changes. Constitution Test Integrity: tests follow the spec.

- **GIVEN** the scoped affected suites run
- **WHEN** assertions execute
- **THEN** they verify the green arm and pass; no test still encodes a blue latch

### Non-Goals

- Menu selected/checked vocabulary (`MENU_ROW_ACTIVE`, ✓ rows, breadcrumb `item.current`) — slice 4
- Input `focus:border-*` unification — slice 6; the `Control` primitive — slice 7
- Geometry — shipped in slices 1–2; operator-console mobile Send armed state — deferred
- Settings pickers straddling latch/selection (reviewer-flagged for the later sweeps): ThemePairControl mode buttons (`settings-dialog.tsx:158-171`, `aria-pressed` + `border-accent`) and the shortcuts panel's platform/tier/target `bg-accent/20` selections (`settings-shortcuts-panel.tsx:689/:772/:980`) — mutually-exclusive pickers are selection vocabulary; slice 4/6 must not miss them

### Design Decisions

#### Ring-inset as the borderless latch border-axis
**Decision**: Borderless controls latch via `ring-1 ring-inset ring-accent-green` (LATCHED_ARM_RINGED), not a real border.
**Why**: ring-inset paints inside the box — latching never shifts layout; focus owns `outline`, so no token collision.
**Rejected**: `border border-transparent` reserves at rest — needless 1px on every glyph button; real border — 1px layout shift on latch.
*Introduced by*: 260906-qqh1-latch-green-unification

#### Unified fills /15 rest, /25 hover
**Decision**: One tint pair replaces today's /10, /20, /30 mix.
**Why**: The single-value rule is the point; /15–/25 sits between today's extremes and matches the settled contract preview's ~16%/28% color-mix.
**Rejected**: Keeping per-surface tints — re-creates the drift this retrofit retires.
*Introduced by*: 260906-qqh1-latch-green-unification

## Tasks

### Phase 1: Setup

- [x] T001 Add `LATCHED_ARM` and `LATCHED_ARM_RINGED` (+ doc comment: scheme-C rule, REST-swap requirement) to `app/frontend/src/components/controls.ts` <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 `components/bottom-bar.tsx`: `^` chip, compose `a▏` chip, scroll-lock chip (+ add `aria-pressed`), F▴ open-latch, and the `⌥` menu latch row → shared arm (row form: `bg-accent-green/15 text-accent-green`) <!-- R2, R4 -->
- [x] T003 [P] `components/status-bar.tsx` fine-pointer `a▏` twin and `components/compose-strip.tsx` Send armed arm → `LATCHED_ARM` (REST-swap: drop the competing hover classes on the latched branch); compose history `↑` chip gains the open-latch <!-- R2, R5 -->
- [x] T004 [P] Top-bar family: surface toggles + autofit → `LATCHED_ARM`; overflow chevron (`top-bar-overflow-menu.tsx`), Split `▾` (`top-bar.tsx`), Open `▾` (`open-button.tsx`), LayoutChip trigger → open-latch via `LATCHED_ARM` <!-- R2, R3, R5 -->
- [x] T005 [P] `components/find-bar.tsx` `Aa`/`.*` + `components/surface-layout.tsx` tile Find/Zoom (+ `aria-pressed` on Zoom) → `LATCHED_ARM_RINGED`; tile Export gains the open-latch (ringed form) <!-- R3, R4, R5 -->
- [x] T006 [P] `components/sidebar/section-rail.tsx` → `LATCHED_ARM_RINGED`; `components/sidebar/window-row.tsx` pin pinned-to-viewed ink `text-accent` → `text-accent-green` <!-- R2, R3 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Test sweep: update unit/e2e assertions pinned to old latch classes (grep `bg-accent/`, `border-accent`, `text-accent`, `accent-green/10` across `src/**/*.test.tsx` + `tests/`); update intent comments where a `test()` changes <!-- R6 -->
- [x] T009 Settings `BoolToggle` (`components/settings-all-panel.tsx:~87-93`, the registry `bool` switch): migrate the ON state to the green switch-track vocabulary — match the server-card protect switch's existing values (`bg-accent-green/30 border-accent-green`, solid green knob) so the app's two switches agree; update any test asserting the blue track. Also: reword the stale `rk-glint` comment claim (`globals.css:~210-216` — latched fill deliberately deepens on hover, it is not "hover-stable" on the fill axis), fix the stale zen-exit chip comment (`status-bar.tsx:~657-670` — it compares to the compose chip's now-green latch; the chip itself is an action affordance, recolor deferred), and drop the pre-existing change-ID citation in the touched test name (`surface-layout.test.tsx:~421`) <!-- R2, R6 --> <!-- rework: review cycle 1 — plan coverage gap: BoolToggle switch missed from the R2 site list; plus reviewer should-fix comment corrections -->
- [x] T008 Verify: `npx tsc --noEmit`; affected unit suites (bottom-bar, top-bar, status-bar, compose-strip, section-rail, window-row, surface-layout as they exist); scoped e2e for touched surfaces only (e.g. `just test-e2e "bottom-bar-chip-size"` plus any spec T007 touched) — never the full suite <!-- R6 -->

## Execution Order

- T001 blocks T002–T006; T007 depends on T002–T006; T008 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: Both arms exported from `controls.ts` with the doc comment; no other file defines a latch class string
- [x] A-002 R2: `grep -rn "bg-accent/\|border-accent[^-]\|text-accent[^-]" src/components` returns no latched/armed control sites (survivors only: input `focus:border-accent` sites and breadcrumb `item.current`) — re-verified cycle 2: `BoolToggle` on-state is now `bg-accent-green/30 border-accent-green` + `bg-accent-green` knob, matching the server-card protect switch (`server-card.tsx:91,94`); remaining grep hits are the allowed survivors plus the zen-exit ACTION chip (deferred per T009 note), hover-reveal/static-ink uses, and deferred selection vocabulary (slice 4)
- [x] A-003 R3: The nine listed sites compose `LATCHED_ARM`/`LATCHED_ARM_RINGED`; no `/10`/`/20`/`/30` latch fills remain on them
- [x] A-004 R4: scroll-lock and tile Zoom carry `aria-pressed` matching their visual state
- [x] A-005 R5: All six triggers render the latch arm while open and rest classes when closed

### Behavioral Correctness

- [x] A-006 R1: A latched chip under hover keeps green ink/border, fill deepens /15→/25 (no competing hover utility on any latched arm — REST-swap verified by reading each rendered class expression)
- [x] A-007 R3: Latching a find-bar/tile toggle causes no layout shift (ring-inset, no new border box)

### Scenario Coverage

- [x] A-008 R6: Updated unit suites pass; scoped e2e passes; no assertion still expects a blue latch — reviewer re-ran 11 affected unit suites (508 tests, all green) and `npx tsc --noEmit` (clean); scoped e2e not warranted: no e2e spec was touched and the one latch-adjacent assertion (`terminal-tile-find.spec.ts` `text-accent-green` on the open ⌕ button) still matches `LATCHED_ARM_RINGED`

### Edge Cases & Error Handling

- [x] A-009 R5: Open-latch triggers restore rest classes on close (no stuck latch after Escape/outside-click)
- [x] A-010 R2: The `⌥` row and scroll-lock keep their one-shot/long-press semantics — only classes and aria changed

### Code Quality

- [x] A-011 Pattern consistency: latched branches read `cond ? \`${BASE} ${LATCHED_ARM}\` : REST_CLASS` matching slice-2's F▴ idiom
- [x] A-012 No duplication: zero inline latch class strings survive at migrated sites
- [x] A-013 No comment narration; no change-ID citations in code or intent comments

## Notes

- Check items as you review: `- [x]`
- Full e2e suite is on-demand only — scope to changed-surface specs.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant (all replaced inline class strings had exactly one definition site each; `KBD_REST`, `TOP_BAR_BUTTON_REST`, `chipTone`, and `VERB_BUTTON_CLASS` all retain live rest-branch call sites).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The `⌥` menu row and other row-form latches take fill+ink only (no border/ring) — rows are full-width and a ring reads as focus there | Row idiom; border axis is meaningless on a full-bleed row | S:65 R:85 A:80 D:72 |

1 assumption (0 certain, 1 confident, 0 tentative).
