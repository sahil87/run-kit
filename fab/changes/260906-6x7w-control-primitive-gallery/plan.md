# Plan: Control Primitive + Gallery

**Change**: 260906-6x7w-control-primitive-gallery
**Intake**: `intake.md`

## Requirements

### Frontend: Control primitive

#### R1: One Control primitive expressing the shipped vocabulary
`app/frontend/src/components/control.tsx` (new) SHALL export a pure class-builder `controlClass({ variant, size?, pressed?, open?, disabled?, danger? })` and a thin `<Control>` button component wrapping it. Variants: `icon | chip | toggle | segment | menu-row | wide | confirm`; sizes: `bar | chip | row` (defaulted per variant). The builder SHALL emit **exactly the class strings today's constant compositions produce** — `icon` = `TOP_BAR_BUTTON*` (28/40 fixed squares, glint), `chip` = `KBD_*` / `FN_ITEM_*` (33×35 fine / 40 coarse), `toggle` = base + `LATCHED_ARM` or `LATCHED_ARM_RINGED` on-state, `segment` = `TOP_BAR_SEGMENT_H` inset heights (26/38), `menu-row` = `MENU_ROW_*` (28/40 floors; checked = `MENU_ROW_CHECKED`), `wide` = `WIDE_BTN_BASE` floors, `confirm` = `CONFIRM_NEUTRAL`/`CONFIRM_DANGER` — zero new tokens, colors, or geometry.

- **GIVEN** any variant × size × state combination in the matrix
- **WHEN** `controlClass()` renders it
- **THEN** the emitted class string is character-identical to the pre-migration constant composition for that state (unit-asserted per combination)

#### R2: REST-swap internalized
State composition inside the primitive SHALL implement the REST-swap rule structurally: the builder emits `BASE + (state-arm | REST)` — a latched/checked/danger arm **replaces** the hover-carrying rest classes, never stacks on them. `pressed` maps to the green arm (`LATCHED_ARM`/`LATCHED_ARM_RINGED` per variant, `MENU_ROW_CHECKED` for menu-row) and the component sets `aria-pressed`; `open` maps to the open-latch idiom (same arm; `aria-expanded` stays at the call site); `disabled` composes the unified `opacity-40 + cursor-not-allowed + hover-neutralized` recipe; `danger` selects `CONFIRM_DANGER` (confirm variant only).

- **GIVEN** a call site using `<Control variant="toggle" pressed>`
- **WHEN** the pressed class list is inspected
- **THEN** it contains the green arm and NO rest hover utilities (`hover:border-text-secondary` etc.) — arm-stacking is impossible by construction

#### R3: Dev-only gallery route
A gallery page (`app/frontend/src/components/control-gallery.tsx`, new) SHALL render the full variant × size × prop-state matrix (rest, pressed, open, disabled, danger, checked-row) from the REAL primitive with forced-state props, each cell labeled. Its route (`/__controls`) SHALL be registered in `src/router.tsx` **only when `import.meta.env.DEV`** — the prod bundle serves no gallery route (Constitution IV: dev surface, hard-gated). Hover/focus frames are NOT part of the matrix — they are interaction-time treatments owned by global rules.

- **GIVEN** a dev build (`import.meta.env.DEV` true)
- **WHEN** navigating to `/__controls`
- **THEN** the matrix renders from the primitive
- **AND** in a production build the route does not exist (falls through to Not Found)

#### R4: Standing screenshot drift guard, baseline-first
A Playwright spec (`app/frontend/tests/e2e/control-gallery.spec.ts`, new, with the constitution-required intent comments) SHALL screenshot the gallery matrix per pointer class — fine, and coarse via touch/pointer emulation — chromium-scoped, with committed baselines. **Sequencing is load-bearing**: the gallery FIRST renders from today's constants and the baselines are captured/committed (T001–T002); the primitive then replaces the gallery's rendering (T004) and the spec MUST pass against those unchanged pre-migration baselines — that green run IS the pixel-parity proof.

- **GIVEN** committed pre-migration baselines
- **WHEN** the gallery renders from the primitive and the spec runs
- **THEN** every screenshot matches its baseline (zero visual change)
- **AND** any future control-vocabulary drift fails this spec

#### R5: Surface-by-surface call-site migration
Call sites SHALL migrate to the primitive in this order, each group passing its unit suites (plus `npx tsc --noEmit`) before the next group starts: (1) top bar — `top-bar.tsx`, `top-bar-overflow-menu.tsx`, `layout-chip.tsx`, `open-button.tsx`, `surface-layout.tsx`; (2) bottom bar/compose — `bottom-bar.tsx` (folding module-local `FN_ITEM_BASE`/`FN_ITEM_CLASS` into the chip variant), `compose-strip.tsx`; (3) menus — `breadcrumb-dropdown.tsx`, `status-bar.tsx`; (4) sidebar — `sidebar/section-rail.tsx`, `sidebar/server-card.tsx` (button shells only, not the switch track); (5) dialogs — `sidebar/kill-dialog.tsx`, `board/board-page.tsx`, `server-dialogs.tsx`, `desktop-shell/titlebar-strip.tsx`, `app.tsx`, `host-form-dialog.tsx`, `host-overview-page.tsx`, `spawn-agent-dialog.tsx`, `create-session-dialog.tsx`, `session-name-prompt.tsx`, `window-note-prompt.tsx`, `operator-compose-dialog.tsx`, `settings-dialog.tsx`, `settings-shortcuts-panel.tsx`. Call sites with custom elements, refs, or floating-ui prop composition MAY consume `controlClass()` directly instead of `<Control>` — same emitted classes either way.

- **GIVEN** a migrated surface group
- **WHEN** its unit suites run
- **THEN** they pass with no behavioral change (class assertions updated mechanically only where they asserted composition internals)

#### R6: Constants internalized + deletion finale
After migration, constants consumed only by the primitive SHALL stop being exported from `controls.ts`/`kbd-chip.ts` (moved into or privatized behind `control.tsx`, lockstep comments preserved): `TOP_BAR_BUTTON*`, `TOP_BAR_SEGMENT_H`, `MENU_ROW_BASE/REST/DISABLED/CHECKED/CLASS`, `LATCHED_ARM`, `LATCHED_ARM_RINGED`, `WIDE_BTN_BASE`, `CONFIRM_NEUTRAL/DANGER`, `KBD_BASE/REST/CLASS`, and `bottom-bar.tsx`'s `FN_ITEM_*`. Constants with consumers OUTSIDE the variant matrix stay exported: `INPUT_FOCUS`, `INPUT_COARSE`, `SWITCH_TRACK_*`/`SWITCH_KNOB_*`, `MENU_ROW_KBD_CLASS`, `MENU_ROW_CHECK_MARK` (the ✓ stays call-site content), `POPOVER_SHELL`, `POPOVER_SECTION_LABEL`. The accumulated earlier-slice deletion candidates SHALL be removed: `select-none` and `focus-visible:outline-2 focus-visible:outline-accent` in `KBD_BASE` (`kbd-chip.ts`) and `ARROW_BTN` (`arrow-pad.tsx`) — both subsumed by the global select guard / unlayered focus ring (zero visual change).

- **GIVEN** the finale is complete
- **WHEN** grepping `src/` for the internalized constant names outside `control.tsx`
- **THEN** no consumer remains (test files updated in the same edit)

#### R7: Zero visual change is the acceptance bar
The change SHALL produce zero pixel deltas: the gallery screenshot spec passes against pre-migration baselines after every phase, and no rendered-class diffs exist beyond the mechanical substitution. Verification per group: `npx tsc --noEmit` + the group's unit suites; final: the gallery spec + scoped e2e for touched surfaces only (full suite never a gate — standing directive 2026-09-03).

- **GIVEN** the completed migration
- **WHEN** the gallery spec and affected suites run
- **THEN** all pass, screenshots match pre-migration baselines

### Non-Goals

- No visual or behavior change of any kind; no new tokens, colors, or geometry.
- Inputs stay on `INPUT_FOCUS`/`INPUT_COARSE` (no input variant — the border idiom is not a button recipe).
- Switch tracks keep `SWITCH_TRACK_*` color constants (geometry is per-site by design).
- Arrow-pad, swatch/marker-pad cells, and other documented dense-picker exceptions stay off the primitive.
- No changes to `globals.css` global rules (`:focus-visible` ring, pressed fill, select guard, glint) or `--ctl-*` tokens.
- The staged 3i9e archive bookkeeping rides this change's ship commit (already in the worktree).

### Design Decisions

#### Class-builder core with a component wrapper
**Decision**: The primitive's core is the pure function `controlClass()`; `<Control>` is a thin `forwardRef` button wrapper over it for the plain-button majority.
**Why**: Many call sites render non-button elements or compose floating-ui `getReferenceProps`/refs; a component-only API would force re-plumbing every one — pure churn against a zero-visual-change bar. The builder still internalizes the REST-swap for both consumption forms.
**Rejected**: Component-only API (re-plumbs refs/element types for no rendered difference); `asChild` slot pattern (new dependency/idiom this codebase doesn't use).
*Introduced by*: 260906-6x7w-control-primitive-gallery

#### Baseline-first screenshot sequencing
**Decision**: Build the gallery rendering from TODAY'S constants, capture/commit baselines, THEN land the primitive and switch the gallery to it — the spec passing against unchanged baselines proves pixel parity.
**Why**: "Pixel-parity against pre-migration captures" is only checkable if the captures predate the primitive; capture-after would compare the primitive to itself.
**Rejected**: Side-by-side dual rendering in one gallery (throwaway complexity; the committed baseline achieves the same comparison and persists as the standing guard).
*Introduced by*: 260906-6x7w-control-primitive-gallery

#### Chromium-scoped screenshot spec with committed baselines
**Decision**: The drift-guard spec runs chromium-only with committed Linux baselines and default-tight `toHaveScreenshot` thresholds; coarse is emulated per the repo's established pointer-class patterns.
**Why**: First visual-baseline spec in the repo — cross-browser font rasterization differences would produce false drift; chromium on Linux matches both the dev rig and CI shards.
**Rejected**: All-browser screenshots (three baseline sets, triple flake surface, no added guard value for a class-composition regression).
*Introduced by*: 260906-6x7w-control-primitive-gallery

#### Primitive composes the existing constants verbatim
**Decision**: `control.tsx` implements variants as a lookup over the SAME constant strings (imported/moved, not re-typed), so emitted classes are identical by construction.
**Why**: Zero-visual-change bar — re-authoring class strings invites transcription drift; composition-over-retyping makes parity structural.
**Rejected**: Fresh class authoring per variant (drift risk with no benefit).
*Introduced by*: 260906-6x7w-control-primitive-gallery

## Tasks

### Phase 1: Baseline (gallery + guard against today's constants)

- [x] T001 Create `app/frontend/src/components/control-gallery.tsx` rendering the full variant × size × state matrix (rest/pressed/open/disabled/danger/checked) composed from TODAY'S exported constants, each cell labeled with `data-testid`; register `/__controls` in `app/frontend/src/router.tsx` gated on `import.meta.env.DEV` <!-- R3 -->
- [x] T002 Create `app/frontend/tests/e2e/control-gallery.spec.ts` (file-header + Proves/Steps intent comments) screenshotting the matrix per pointer class (fine + coarse emulation), chromium-scoped; run via `just pw` to capture and commit the pre-migration baselines <!-- R4 -->

### Phase 2: Primitive + parity gate

- [x] T003 Create `app/frontend/src/components/control.tsx` — `controlClass()` + `<Control>` (forwardRef button) composing the existing constants verbatim with the REST-swap internalized (`pressed`/`open`/`disabled`/`danger`); add `app/frontend/src/components/control.test.tsx` asserting per-combination string identity with the pre-migration compositions and the no-arm-stacking property <!-- R1 -->
- [x] T004 Switch `control-gallery.tsx` to render from the primitive; re-run the screenshot spec against the committed baselines — must pass unchanged (pixel-parity gate) <!-- R4 -->

### Phase 3: Call-site migration (sequential groups, unit-verified each)

- [x] T005 Migrate the top-bar group to `Control`/`controlClass`: `src/components/top-bar.tsx`, `top-bar-overflow-menu.tsx`, `layout-chip.tsx`, `open-button.tsx`, `surface-layout.tsx`; run `top-bar.test.tsx`, `top-bar.update-chip.test.tsx`, `top-bar-overflow-menu.test.tsx`, `open-button.test.tsx`, `surface-layout.test.tsx`, `surface-layout.web-integration.test.tsx` + `npx tsc --noEmit` <!-- R5 -->
- [x] T006 Migrate bottom bar/compose: `src/components/bottom-bar.tsx` (fold `FN_ITEM_BASE`/`FN_ITEM_CLASS` into the chip variant), `compose-strip.tsx`; run `bottom-bar.test.tsx`, `compose-strip.test.tsx` + tsc <!-- R5 -->
- [x] T007 Migrate menus/popovers: `src/components/breadcrumb-dropdown.tsx`, `status-bar.tsx`; run `breadcrumb-dropdown.test.tsx`, `status-bar.test.tsx` + tsc <!-- R5 -->
- [x] T008 Migrate sidebar: `src/components/sidebar/section-rail.tsx`, `sidebar/server-card.tsx` (button shells only — switch track untouched); run `sidebar/section-rail.test.tsx`, `sidebar/server-panel.test.tsx` (covers server-card) + tsc <!-- R5 -->
- [x] T009 Migrate dialogs (wide/confirm buttons only; inputs untouched): `src/components/sidebar/kill-dialog.tsx`, `board/board-page.tsx`, `server-dialogs.tsx`, `desktop-shell/titlebar-strip.tsx`, `app.tsx`, `host-form-dialog.tsx`, `host-overview-page.tsx`, `spawn-agent-dialog.tsx`, `create-session-dialog.tsx`, `session-name-prompt.tsx`, `window-note-prompt.tsx`, `operator-compose-dialog.tsx`, `settings-dialog.tsx`, `settings-shortcuts-panel.tsx`; run `server-dialogs.test.tsx`, `host-form-dialog.test.tsx`, `host-overview-page.test.tsx`, `spawn-agent-dialog.test.tsx`, `session-name-prompt.test.tsx`, `window-note-prompt.test.tsx`, `operator-compose-dialog.test.tsx`, `settings-dialog.test.tsx`, `settings-shortcuts-panel.test.tsx`, `dialog.test.tsx` + tsc <!-- R5 -->

### Phase 4: Finale + verification

- [x] T010 Internalize migrated constants (stop exporting `TOP_BAR_BUTTON*`, `TOP_BAR_SEGMENT_H`, `MENU_ROW_BASE/REST/DISABLED/CHECKED/CLASS`, `LATCHED_ARM*`, `WIDE_BTN_BASE`, `CONFIRM_*`, `KBD_BASE/REST/CLASS` from `controls.ts`/`kbd-chip.ts`; delete `FN_ITEM_*` from `bottom-bar.tsx`); keep `INPUT_*`, `SWITCH_*`, `MENU_ROW_KBD_CLASS`, `MENU_ROW_CHECK_MARK`, `POPOVER_SHELL`, `POPOVER_SECTION_LABEL` exported; preserve lockstep comments; grep-verify no stray consumer (src AND tests) <!-- R6 -->
- [x] T011 Remove accumulated deletion candidates: `select-none` and `focus-visible:outline-2 focus-visible:outline-accent` from `KBD_BASE` (`src/components/kbd-chip.ts`) and `ARROW_BTN` (`src/components/arrow-pad.tsx`) — subsumed by global rules. **N/A (ARROW_BTN half)**: `arrow-pad.tsx`/`ARROW_BTN` do not exist in this tree — no such file or constant; only the `KBD_BASE` removals applied <!-- R6 -->
- [x] T012 Final verification: `npx tsc --noEmit`; the gallery screenshot spec against the pre-migration baselines; the Phase-3 unit suites; scoped e2e for touched surfaces (e.g. top-bar/menu/dialog specs touching migrated components) via `just test-e2e "<spec>"` <!-- R7 -->

## Execution Order

- T001 → T002 (baselines need the gallery) → T003 → T004 (parity gate blocks migration) → T005 → T006 → T007 → T008 → T009 (strict surface ladder) → T010 → T011 → T012.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `controlClass()`/`<Control>` exist and cover the full variant × size × state matrix; per-combination emitted classes are string-identical to pre-migration compositions (unit-asserted) — verified: `control.tsx` + `control.test.tsx` identity oracle; full unit suite 186 files / 3814 tests green
- [x] A-002 R3: `/__controls` renders the matrix from the real primitive in dev; the route is absent from the prod bundle (`import.meta.env.DEV` gate verified) — verified: gallery spec green on the dev rig; prod `vite build` output greps clean for `control-gallery`/`__controls` (no chunk, no route string)
- [x] A-003 R4: the screenshot spec exists with fine + coarse captures, chromium-scoped, committed baselines, and constitution-compliant intent comments — verified: `tests/e2e/control-gallery.spec.ts` (file header + Proves/Steps on both tests), single chromium project in `playwright.config.ts`, two baseline PNGs under `control-gallery.spec.ts-snapshots/`
- [x] A-004 R5: every listed call site composes the primitive (or `controlClass()`); no migrated surface re-types a control recipe — verified file-by-file across all 25 migrated surfaces; `server-card.tsx` needed no edit (its only `controls.ts` imports are the out-of-matrix `SWITCH_*` family)

### Behavioral Correctness

- [x] A-005 R2: pressed/open/danger states REST-swap — no class list contains both a state arm and rest hover utilities — verified: every `controlClass` branch emits `BASE + (arm | REST)`; unit tests assert the no-arm-stacking property; no call site stacks arms
- [x] A-006 R7: gallery screenshots after T004 and after T012 match the T002 pre-migration baselines exactly — verified at final state: `just test-e2e control-gallery` → 2 passed (fine + coarse) against the unchanged committed baselines with the primitive in place

### Removal Verification

- [x] A-007 R6: internalized constants have zero consumers outside `control.tsx` (src and tests); `FN_ITEM_*` gone from `bottom-bar.tsx` — verified by grep over `src/` + `tests/`: only the intentionally-exported out-of-matrix names remain in use; `kbd-chip.ts` deleted
- [x] A-008 R6: the drcc deletion candidates (`select-none`, `focus-visible:outline-*` in `KBD_BASE`/`ARROW_BTN`) are removed — `KBD_BASE` (now in `control.tsx`) no longer carries either token (subsumed by the global select guard / unlayered focus ring); **`ARROW_BTN` half N/A**: `arrow-pad.tsx`/`ARROW_BTN` do not exist in this tree (verified)

### Scenario Coverage

- [x] A-009 R1: `control.test.tsx` covers every variant's rest + each applicable state, including the ringed-vs-bordered toggle split and menu-row checked
- [x] A-010 R5: each Phase-3 group's unit suites pass at its migration commit (verified per group, not only at the end) — the working tree is one uncommitted diff, so per-commit sequencing is not independently re-checkable; verified at final state: `npx tsc --noEmit` clean and the full Vitest suite (which includes every Phase-3 group's suites) green

### Edge Cases & Error Handling

- [x] A-011 R3: production build (`just build` or vite build) succeeds and contains no gallery chunk/route — verified: `pnpm build` (tsc + vite) succeeds; `dist/` greps clean for `control-gallery`/`__controls`
- [x] A-012 R4: coarse-pointer captures actually exercise the 40px floors (coarse emulation verified in the spec, not assumed) — verified: the spec asserts the chip bounding box ≥ 40px under `hasTouch` and < 40px on the fine run, and both runs passed

### Code Quality

- [x] A-013 Pattern consistency: primitive and gallery follow existing component patterns (forwardRef, named exports, lockstep comments, no new idioms)
- [x] A-014 No unnecessary duplication: class strings composed from the single constant definitions — never re-typed — verified: `control.tsx`'s constants were moved verbatim from `controls.ts`/`kbd-chip.ts`/`bottom-bar.tsx` (character-identical to the deleted definitions); call-site `rest` overrides are the pre-existing per-site inline strings, moved not re-typed
- [x] A-015 No comment narration or change-ID citations in code comments; intent comments state constraints only — verified: added-lines grep for `6x7w`/`R#`/`T0##` clean (remaining hits are pre-existing citations in untouched files); changed comments state constraints
- [x] A-016 Type narrowing over assertions; no `as` casts introduced by the migration — verified: added-lines grep clean
- [x] A-017 Tests included for added behavior (`control.test.tsx`, the gallery spec); e2e intent comments per constitution

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Core = pure `controlClass()` builder; `<Control>` wraps it for plain buttons; ref/floating-ui/custom-element sites consume the builder | Avoids re-plumbing against a zero-visual-change bar; REST-swap enforced in both forms | S:70 R:75 A:80 D:70 |
| 2 | Confident | Screenshot spec chromium-only, committed Linux baselines, prop-forced states only (no hover/focus frames) | First visual baseline in the repo; cross-browser rasterization = false drift; hover/focus are global-rule territory | S:65 R:75 A:70 D:65 |
| 3 | Confident | Export boundary: `INPUT_*`, `SWITCH_*`, `MENU_ROW_KBD_CLASS`, `MENU_ROW_CHECK_MARK`, `POPOVER_SHELL`, `POPOVER_SECTION_LABEL` stay public; the ✓ glyph stays call-site content | These are container/input/content recipes outside the button-variant matrix; folding them would change DOM structure or extend the vocabulary | S:65 R:70 A:75 D:60 |
| 4 | Confident | `settings-dialog.tsx`/`settings-shortcuts-panel.tsx` ride the dialogs group (their `LATCHED_ARM`/`SELECTED_FILL` pickers migrate only where they map to `toggle`; `SELECTED_FILL` stays if outside the matrix) | Settings pickers were slice-4 scope; only their button-shaped controls fit the matrix | S:60 R:70 A:65 D:60 |
| 5 | Confident | Builder API extensions beyond the seeded props, each mapping to a shipped composition: `ringed` (borderless ring-inset form — A-009's ringed-vs-bordered split), `base`/`rest` overrides (bespoke-geometry latch sites: section-rail, verb/find buttons, status-bar/settings toggles), `onBorder` (compose-strip's `border ${LATCHED_ARM}`), `glint:false` (menu steppers), `box:"height"` (`TOP_BAR_BUTTON_H` consumers), `bare` (geometry-only: version/update rows, option-list rows) | The shipped vocabulary contains per-site bespoke bases the fixed prop list cannot express; overrides keep the REST-swap structural without re-plumbing call sites | S:65 R:75 A:70 D:65 |
| 6 | Confident | Disabled-recipe rule: composed iff the `disabled` prop is provided, except `menu-row`/`confirm` whose constant compositions bake it in; the three previously-bare checked menu rows (layout-chip ×2, breadcrumb ×1) gain the inert `MENU_ROW_DISABLED` tokens | All recipe tokens are `disabled:` variants — inert without the attribute — so presence is zero-rendered-diff; keeping `MENU_ROW_CLASS` verbatim preserves the one-row-scale family invariant | S:60 R:70 A:70 D:60 |

4 assumptions (0 certain, 4 confident, 0 tentative).

## Deletion Candidates

- None — this change IS the deletion finale: the planned redundants (`kbd-chip.ts`, `bottom-bar.tsx`'s `FN_ITEM_*`, the internalized `controls.ts` constants, the drcc `KBD_BASE` tokens) were already removed by T010/T011, and review verified every symbol still exported from `controls.ts` (`MENU_ROW_CHECK_MARK`, `MENU_ROW_KBD_CLASS`, `POPOVER_SHELL`, `POPOVER_SECTION_LABEL`, `SWITCH_*`, `INPUT_*`) and every helper in `control.tsx` has live consumers.
