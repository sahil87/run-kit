# Plan: Control Tokens, Global Focus Ring & Hue-Free Glint

**Change**: 260905-drcc-control-tokens-focus-glint
**Intake**: `intake.md`

## Requirements

### Controls: Token Module

#### R1: Shared control constants live in a dedicated module
The shared control className constants (`TOP_BAR_BUTTON_BASE`, `TOP_BAR_BUTTON_REST`, `TOP_BAR_BUTTON`, `TOP_BAR_BUTTON_H`, `TOP_BAR_SEGMENT_H`, `MENU_ROW_BASE`, `MENU_ROW_REST`, `MENU_ROW_DISABLED`, `MENU_ROW_ACTIVE`, `MENU_ROW_CLASS`, `MENU_ROW_KBD_CLASS`, `POPOVER_ROW_CLASS`) MUST move from `app/frontend/src/components/top-bar-overflow-menu.tsx` to a new dependency-free module `app/frontend/src/components/controls.ts`, with every consumer (`top-bar.tsx`, `top-bar-overflow-menu.tsx`, `surface-layout.tsx`, `layout-chip.tsx`, `open-button.tsx`) importing from the new home. No re-export shim SHALL remain in `top-bar-overflow-menu.tsx`. The doc comments that travel with the constants (e.g. the 28px-hit-area rationale at top-bar-overflow-menu.tsx:93-104) move with them.

- **GIVEN** the frontend compiles today with constants hosted in `top-bar-overflow-menu.tsx` (per its comment, only to dodge an import cycle)
- **WHEN** the constants move to `components/controls.ts` and imports are updated
- **THEN** `npx tsc --noEmit` passes, no constant definition remains in `top-bar-overflow-menu.tsx`, and no import cycle exists (`controls.ts` imports nothing from components)

#### R2: Control CSS custom properties
`globals.css` MUST define control-geometry custom properties on `:root`: `--ctl-radius: 4px`, `--ctl-duration: 150ms`, `--ctl-h-bar: 28px`, `--ctl-h-bar-coarse: 40px`, `--ctl-chip-h: 33px`, `--ctl-chip-w: 35px`, `--ctl-chip-coarse: 40px`. The TS constants keep Tailwind literal classes (the scanner cannot read vars) and each size-bearing constant MUST carry a lockstep comment naming the custom property it mirrors — the documented-lockstep convention of `COARSE_POINTER_QUERY` (`hooks/use-coarse-pointer.ts:16`) and `STATUS_RAIL_WIDTH_PX` (`row-flyout-card.tsx:82`).

- **GIVEN** control heights exist only as TS Tailwind strings, invisible to CSS rules
- **WHEN** the `--ctl-*` block lands in `globals.css`
- **THEN** CSS-side consumers (this change's global rules; later slices) can reference the same geometry, and each mirrored TS literal names its custom property in a comment

### Globals: Interaction-State Rules

#### R3: One global focus-visible ring
`globals.css` MUST add an **unlayered** rule giving every interactive control a keyboard-focus ring: selector `:where(button, [role="button"], [role="option"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"], [role="switch"], a, summary):focus-visible` with `outline: 2px solid var(--color-accent-green); outline-offset: 2px;`. `input`, `textarea`, and `select` are excluded (they keep the `focus:border-*` live-input idiom). The rule MUST be unlayered on purpose — it outranks the ~37 Tailwind `outline-none` utilities that currently suppress focus with no replacement, and the three divergent per-site ring idioms, without touching any call site.

- **GIVEN** a control that today suppresses focus (e.g. the web-tab elements at `iframe-window.tsx:1264` with bare `outline-none`)
- **WHEN** it receives keyboard focus (Tab / roving `.focus()`)
- **THEN** a 2px accent-green ring renders at 2px offset
- **AND** mouse clicks (`:focus` without `:focus-visible`) render no ring

#### R4: One global pressed treatment
`globals.css` MUST add a pressed rule on the same control selector set (minus `a` and `summary`): `:active:not(:disabled)` → `background-color: var(--color-bg-card); transition: none;`. This generalizes `KBD_CLASS`'s existing `active:bg-bg-card` — touch's only feedback channel. Inline-styled tinted rows keep their tint (inline style wins over the rule); that is accepted behavior.

- **GIVEN** a coarse-pointer tap on any control (compose chip, top-bar button, menu row)
- **WHEN** the pointer is down
- **THEN** the control's background snaps to `bg-card` instantly (no transition), and releases on pointer-up

#### R5: Long-press select guard
The existing "clickable elements should feel clickable" block in `globals.css` (~line 90: `button, [role="button"], [role="option"], [role="menuitem"], a, …`) MUST additionally declare `user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;` so a long-press on any control never selects the glyph or pops the iOS callout/magnifier.

- **GIVEN** a long-press on a bottom-bar chip on iOS Safari
- **WHEN** the press exceeds the selection threshold
- **THEN** no text selection occurs and no callout/magnifier appears

### Globals: Hue-Free Glint

#### R6: Glint hover carries no hue; the color override is deleted
Per the settled scheme C (neutral interaction, green = state only): the `.rk-glint::after` sweep gradient (globals.css:242-257) MUST recolor from `color-mix(in srgb, var(--color-accent-green) 45%, transparent)` to `color-mix(in srgb, var(--color-text-primary) 22%, transparent)`, and the `.rk-glint:hover:not(:disabled) { border-color/color: accent-green }` rule (globals.css:266) MUST be **deleted** — not layered, not scoped. Consequences (all intended): call-site Tailwind hover utilities (`hover:border-text-secondary`, `hover:text-text-primary`) become the live neutral hover; latched controls (`bg-accent/20 border-accent text-accent`, surface toggles, autofit) become hover-stable. The motion-doctrine comment block (globals.css:140-152) and the glint comment (:155-161, "the green line") MUST be updated to describe the hue-free sweep and the green-means-state rule; the `prefers-reduced-motion` sweep zeroing (:1537-1538) stays as is.

- **GIVEN** a latched Ctrl chip (`aria-pressed`, `text-accent`) or an on surface-toggle
- **WHEN** the pointer hovers it
- **THEN** the sweep plays hue-free, the latched ink/border hold their color, and no rule forces accent-green

### Sizes: 40px Coarse Floor

#### R7: Shared size constants move to the 40px coarse floor
Fine-pointer sizes are unchanged. Coarse values MUST become: `TOP_BAR_BUTTON_BASE` `coarse:w-[40px] coarse:h-[40px]` (was 30); `TOP_BAR_BUTTON_H` `coarse:h-[40px]`; `TOP_BAR_SEGMENT_H` `coarse:h-[38px]` (keeps the 2px inset construction inside the 40px wrapper; was 28-in-30); `KBD_CLASS` `coarse:min-h-[40px] coarse:min-w-[40px]` (was 36); `ARROW_BTN` (`arrow-pad.tsx:17`) `min-h-[40px] min-w-[40px]` (was 36 — it renders only in the coarse arrow popup, flat geometry kept).

- **GIVEN** a coarse pointer (`any-pointer: coarse`)
- **WHEN** the top bar and bottom bar render
- **THEN** icon buttons measure 40×40, segments 38 tall, bottom-bar chips ≥40×40, and the 8-chip bottom-bar row still fits a 375px viewport in one row (8×40 + 7×4 gap = 348px)

#### R8: Geometry-asserting tests conform to the new spec
`app/frontend/tests/e2e/bottom-bar-chip-size.spec.ts` MUST assert the new 40px coarse values, and a sweep of `app/frontend/tests/` (e2e + unit) MUST update any other assertion pinned to the old coarse geometry (30/36) or to the deleted green hover behavior (accent-green border/color on hover). Per constitution Test Integrity, tests change to match the spec — never the reverse. Playwright test-intent comments are updated in the same commit where a `test()` changes.

- **GIVEN** the size and hover contract changed
- **WHEN** the scoped affected specs run (`just test-e2e "<spec>"` per project convention)
- **THEN** they pass against the new values, and no spec still encodes 30/36 coarse sizes or green-hover expectations

### Non-Goals

- Bottom-bar recomposition (⌥ + arrow pad into the F▴ menu) — a later slice.
- The `Control` React primitive and per-surface migrations; latch-vocabulary and input-focus unification; disabled-opacity sweep; sub-target stragglers (breadcrumb 24px triggers, dialog `coarse:` adoption).
- Removing now-redundant per-site `focus-visible:` utilities (the global rule outranks them uniformly; removal rides each surface's slice).

### Design Decisions

#### Unlayered focus ring as deliberate override
**Decision**: The global `:focus-visible` rule is unlayered so it outranks layered Tailwind utilities, including the 37 `outline-none` suppressions and the three divergent per-site ring idioms.
**Why**: Fixes keyboard-focus invisibility everywhere with zero call-site churn; the mechanism is proven (it is exactly how the old glint override won).
**Rejected**: Per-call-site `focus-visible:` utility additions — 50+ edits, guaranteed drift, and the naked `outline-none` sites would still need touching.
*Introduced by*: 260905-drcc-control-tokens-focus-glint

#### Glint override deleted, not layered
**Decision**: The `.rk-glint:hover` border/color override is removed entirely; the sweep survives, hue-free.
**Why**: Scheme C (settled with the user) gives hover no hue, so there is nothing left to layer-manage; deletion revives the call-site hover utilities as the neutral hover and makes latched states hover-stable with no further work.
**Rejected**: Moving the override into a cascade layer — preserves a green hover the settled contract no longer wants.
*Introduced by*: 260905-drcc-control-tokens-focus-glint

#### Text inputs excluded from the global ring
**Decision**: `input`/`textarea`/`select` keep the `focus:border-*` idiom; the global ring covers buttons, role-bearing controls, links, and summaries.
**Why**: 13 inputs already signal focus via border color; ringing them too double-signals. The 17 naked-input sites are a later unification slice.
**Rejected**: Including inputs — cheaper coverage but visually noisy on the sites that already have a border treatment.
*Introduced by*: 260905-drcc-control-tokens-focus-glint

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/components/controls.ts` with the twelve moved constants (`TOP_BAR_BUTTON_BASE/REST/BUTTON/H`, `TOP_BAR_SEGMENT_H`, `MENU_ROW_BASE/REST/DISABLED/ACTIVE/CLASS/KBD_CLASS`, `POPOVER_ROW_CLASS`), their travelling doc comments, and lockstep comments naming the `--ctl-*` custom property each size literal mirrors <!-- R1, R2 -->
- [x] T002 [P] Add the `--ctl-*` custom-property block (`--ctl-radius`, `--ctl-duration`, `--ctl-h-bar`, `--ctl-h-bar-coarse`, `--ctl-chip-h`, `--ctl-chip-w`, `--ctl-chip-coarse`) to `:root` in `app/frontend/src/globals.css` with a comment naming the TS lockstep partners <!-- R2 -->

### Phase 2: Core Implementation

- [x] T003 Remove the constant definitions from `app/frontend/src/components/top-bar-overflow-menu.tsx` and update imports in it plus `top-bar.tsx`, `surface-layout.tsx`, `layout-chip.tsx`, `open-button.tsx` to `./controls` <!-- R1 -->
- [x] T004 [P] Add the unlayered global `:focus-visible` ring rule to `app/frontend/src/globals.css` (selector set per R3, excludes input/textarea/select), with a constraint comment stating why it is unlayered <!-- R3 -->
- [x] T005 [P] Add the global `:active:not(:disabled)` pressed rule (`bg-card` fill, `transition: none`) to `app/frontend/src/globals.css` <!-- R4 -->
- [x] T006 [P] Extend the clickable-elements block in `app/frontend/src/globals.css` with `user-select: none; -webkit-user-select: none; -webkit-touch-callout: none` <!-- R5 -->
- [x] T007 [P] Recolor `.rk-glint::after` to the hue-free `color-mix(in srgb, var(--color-text-primary) 22%, transparent)` sweep, delete the `.rk-glint:hover:not(:disabled)` color-override rule, and update the motion-doctrine (globals.css:140-152) and glint (:155-161) comments <!-- R6 -->
- [x] T008 Re-value coarse sizes: `TOP_BAR_BUTTON_BASE`/`TOP_BAR_BUTTON_H` coarse 30→40 and `TOP_BAR_SEGMENT_H` coarse 28→38 (now in `controls.ts`), `KBD_CLASS` coarse 36→40 in `components/kbd-chip.ts`, `ARROW_BTN` 36→40 in `components/arrow-pad.tsx`; latched bottom-bar chips MUST keep their accent border under hover via a **structural swap, not a competing utility**: split `kbd-chip.ts` into `KBD_BASE` (geometry/border/radius/focus/active, no hover colors) + `KBD_REST` (the `hover:border-text-secondary` neutral-hover arm) with `KBD_CLASS = KBD_BASE + KBD_REST` (existing consumers unchanged), and at the three latch sites (`bottom-bar.tsx` ~:382 Ctrl/Alt, ~:478 compose a▏, ~:494 scroll-lock) render `pressed ? \`${KBD_BASE} bg-accent/20 border-accent text-accent hover:bg-accent/30\` : KBD_CLASS` — the hover-carrying REST is absent when latched, so no specificity tie exists (mirrors the TOP_BAR_BUTTON_BASE/REST pattern the latched top-bar controls already use); drop the cycle-1 `hover:border-accent` additions <!-- R7 --> <!-- rework: review cycle 2 — cycle-1 fix tied on specificity and lost on compiled source order; swap out the REST arm when latched instead -->

### Phase 3: Integration & Edge Cases

- [x] T009 Update `app/frontend/tests/e2e/bottom-bar-chip-size.spec.ts` to the 40px coarse contract; grep `app/frontend/tests/` (e2e `.spec.ts` + unit `.test.ts(x)`) for assertions pinned to coarse 30/36 geometry or accent-green hover border/color and update each (with intent comments per constitution) <!-- R8 -->
- [x] T010 Verify: `cd app/frontend && npx tsc --noEmit`; run affected unit suites (`just test-frontend` if scoped run unavailable); run scoped e2e for the changed surface (`just test-e2e "bottom-bar-chip-size"` plus any specs T009 touched, e.g. mobile-layout/top-bar suites) — never the full suite <!-- R8 -->

## Execution Order

- T001 blocks T003 and T008 (constants must exist in `controls.ts` before imports/re-values there)
- T004–T007 are independent globals.css edits ([P] as a group, sequential within the file in practice)
- T009 depends on T007+T008 (asserts the new contract); T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: All twelve constants are defined only in `components/controls.ts`; `grep -n "TOP_BAR_BUTTON_BASE\s*=" top-bar-overflow-menu.tsx` is empty; all five consumers import from `./controls`; `tsc --noEmit` passes
- [x] A-002 R2: The `--ctl-*` block exists on `:root` in globals.css; every size-bearing TS constant carries a lockstep comment naming its custom property
- [x] A-003 R3: The unlayered `:focus-visible` rule exists with the specified selector set (no `input`/`textarea`/`select`); a previously `outline-none` control (web tab, `iframe-window.tsx:1264`) shows the green ring under keyboard focus
- [x] A-004 R4: The `:active:not(:disabled)` rule exists with `transition: none`; a disabled control gets no pressed fill
- [x] A-005 R5: The clickable-elements block carries all three select-guard declarations
- [x] A-006 R6: No `.rk-glint:hover` border/color override remains anywhere in globals.css; the sweep gradient uses `--color-text-primary`; the doctrine and glint comments describe the hue-free contract
- [x] A-007 R7: Coarse values in code are exactly 40/40 (bar), 38 (segment), 40/40 (KBD_CLASS, ARROW_BTN); fine values unchanged (28, 26, 33×35)

### Behavioral Correctness

- [x] A-008 R6: A latched control (`aria-pressed="true"` chip or surface toggle) keeps its accent/green state ink and border under hover — no color flip — **MET (cycle-2 structural fix, re-verified)**: `kbd-chip.ts` is now split into `KBD_BASE` (kbd-chip.ts:22 — geometry/border/radius/transition/select-guard/`active:bg-bg-card`/focus ring, **no hover color utilities**) + `KBD_REST` (:23 — `hover:border-text-secondary`), `KBD_CLASS = KBD_BASE + KBD_REST` (:24). The three latch sites render the swap — bottom-bar.tsx:382 (Ctrl/Alt), :478 (compose a▏), :494 (scroll-lock) all read `pressed ? \`${KBD_BASE} bg-accent/20 border-accent text-accent hover:bg-accent/30\` : \`${KBD_CLASS} …\``: the REST arm is ABSENT when latched, so no `hover:border-*` utility competes with `border-accent` — no specificity tie exists to lose. No `hover:border-accent` residue anywhere in the latch arms (the cycle-1 additions are gone). Non-latch `KBD_CLASS` consumers unchanged (arrow-pad.tsx:113; bottom-bar.tsx:372/:397/:464). Top-bar latched controls were already clean.
- [x] A-009 R3: Mouse click on a ringed control does not paint the ring (`:focus-visible`, not `:focus`)

### Scenario Coverage

- [x] A-010 R8: `bottom-bar-chip-size.spec.ts` asserts ≥40×40 coarse chips and passes on the scoped run
- [x] A-011 R7: The 8-chip bottom-bar row renders in a single row at 375px viewport width (no wrap, no horizontal scroll)

### Edge Cases & Error Handling

- [x] A-012 R6: Under `prefers-reduced-motion: reduce`, the glint sweep remains zeroed (existing gate at globals.css:1537 unaffected)
- [x] A-013 R3/R4: Disabled controls receive neither the pressed fill nor (when unfocusable) the ring; `aria-disabled` rows are unaffected by `:disabled`-gated rules as today (no regression introduced)

### Code Quality

- [x] A-014 Pattern consistency: new module and CSS blocks follow surrounding naming/idiom (constants SCREAMING_SNAKE, comment style matches globals.css doctrine blocks)
- [x] A-015 No unnecessary duplication: geometry values single-sourced per side (TS literal + named custom property pair, lockstep-commented); no third copy introduced
- [x] A-016 No comment narration: comments state constraints only (why unlayered, lockstep pairs) — no change-ID citations, no reviewer-addressed prose in code
- [x] A-017 Tests cover changed behavior: geometry spec updated in the same change; intent comments updated where a `test()` changed

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Full e2e suite is on-demand only (user directive 2026-09-03) — scope to changed-surface specs.

## Deletion Candidates

- `select-none` in `KBD_BASE` (app/frontend/src/components/kbd-chip.ts:22) — subsumed by the global `user-select: none` guard now applied to all button controls in globals.css
- `select-none` in `ARROW_BTN` (app/frontend/src/components/arrow-pad.tsx:20) — same global select-guard subsumption
- `focus-visible:outline-2 focus-visible:outline-accent` in `KBD_BASE` (app/frontend/src/components/kbd-chip.ts:22) and `ARROW_BTN` (app/frontend/src/components/arrow-pad.tsx:20) — overridden by the unlayered global focus ring; removal deliberately deferred to per-surface slices per plan non-goals

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `ARROW_BTN` keeps flat geometry (40 both pointer classes) rather than adopting KBD's fine/coarse split | It renders only in the coarse-only arrow popup; a fine split is dead code there | S:70 R:90 A:85 D:80 |
| 2 | Confident | The pressed rule's selector set omits `a` and `summary` (links navigate; fill-snap on anchors reads wrong) | Pressed is a control affordance; links keep browser behavior | S:65 R:85 A:80 D:75 |
| 3 | Confident | Doc comments travel with the moved constants; `top-bar-overflow-menu.tsx` keeps only its menu component code | The 28px rationale comment documents the constants, not the menu | S:70 R:90 A:85 D:85 |

3 assumptions (0 certain, 3 confident, 0 tentative).
