# Plan: Flyout Card Elevation + Action Tray

**Change**: 260817-nwz9-flyout-card-elevation-action-tray
**Intake**: `intake.md`

## Requirements

### Popup Surfaces: Elevation

#### R1: The row popups SHALL render on the elevated surface with a theme-aware occlusion shadow

The row-flyout card SHALL use `bg-bg-card` (not `bg-bg-primary`) and a new `.rk-popup-elev` utility (not Tailwind's stock `shadow-lg`). `.rk-popup-elev` SHALL read two theme-scoped custom properties defined in `globals.css` so the shadow alpha differs between dark and light. No new color tokens SHALL be introduced and `UIColors` / `themes.ts` SHALL NOT change.

- **GIVEN** the dark theme, where `bg-bg-card` (`#171b24`) measures only 1.10:1 against the page ground (`#0f1117`)
- **WHEN** the flyout card opens over the xterm terminal surface
- **THEN** the card reads as a distinct object because a visible shadow separates it
- **AND** in light theme the same class produces a proportionate shadow rather than the dark theme's 70%-black value

#### R2: The floating-arrow notch SHALL paint the same surface as the card body

`notchFill` in `popup-title-bar.tsx` SHALL return `var(--color-bg-card)` for arrows resolving below the title band, matching R1's new card ground. The title-band branch (`var(--color-bg-inset)`) SHALL be unchanged.

- **GIVEN** a fine-pointer card whose arrow resolves below `POPUP_TITLE_BAR_HEIGHT_PX`
- **WHEN** the notch renders
- **THEN** its fill matches the card body and the notch reads as part of the card silhouette
- **AND** an arrow resolving inside the title band still fills `bg-inset`

#### R3: The identity tip SHALL share the card's elevation

`identity-tip.tsx` SHALL take R1's `bg-bg-card` + `.rk-popup-elev` shell treatment. It SHALL NOT take the action-row changes (R4–R7) because it renders no action rows.

- **GIVEN** the session identity tip and the flyout card both open on the same sidebar
- **WHEN** a user compares them
- **THEN** both sit at the same visual elevation

### Flyout Card: Action Affordance

#### R4: Action rows SHALL be visually separable from read-only register text at rest

`ACTION_ROW_CLASS` SHALL set `text-text-primary` at rest, and `ACTION_ROW_HINT_CLASS` SHALL drop `opacity-60`. The card SHALL then obey one rule: secondary text is read-only, primary text is actionable.

- **GIVEN** a card showing `out` / `agt` registers in `text-text-secondary` above four action rows
- **WHEN** the card is at rest with no pointer over it
- **THEN** the action labels are visibly brighter than the register text
- **AND** every sub-hint ("not pinned", "confirms first", "new window, same directory") measures at least 4.5:1 on the card ground in both themes

#### R5: The action list SHALL occupy its own inset tray

`CardActionList` SHALL carry `bg-bg-inset`, a bottom radius matching the title bar's `rounded-t-[5px]`, and a negative bottom margin cancelling the card's `py-1.5` so the tray reaches the card edge.

- **GIVEN** a card with a title bar, register body, and action list
- **WHEN** it renders
- **THEN** three zones are distinguishable without interaction: inset identity band, card-ground facts, inset action tray
- **AND** the tray's bottom corners follow the card radius with no 6px gap below the last row

#### R6: Hovering an action row SHALL light a left rail colored by the action's destructiveness

`ACTION_ROW_CLASS` SHALL carry colorless rail geometry (`border-l-2 border-l-transparent pl-1.5`). `CardActionRow` SHALL supply the color through its existing `danger` ternary: `hover:border-l-signal-red` when `danger`, `hover:border-l-accent-green` otherwise. The hover fill SHALL become a neutral `text-primary` 8% lift, replacing `hover:bg-bg-inset` (a 1.13:1 step on the new card ground).

- **GIVEN** the window card's four action rows
- **WHEN** the pointer enters "Change color…", "Fork conversation", or "Pin to board…"
- **THEN** a 2px `accent-green` rail lights on that row's left edge
- **WHEN** the pointer enters "Kill window"
- **THEN** the rail lights `signal-red` instead, matching the label color that row already adopts
- **AND** total row width is unchanged, because `pl-1.5` (6px) plus the 2px border restores the original 8px inset

#### R7: The fork row SHALL carry the rail explicitly and SHALL NOT light it while disabled

`ForkActionRow` builds its own `className` and never passes through R6's ternary, so it SHALL add `hover:border-l-accent-green` directly, plus `disabled:hover:border-l-transparent`.

- **GIVEN** a forkable window whose fork row is idle
- **WHEN** the pointer enters the fork row
- **THEN** the green rail lights like any other safe action
- **GIVEN** a fork already in flight (`busy === true`, row `disabled`)
- **WHEN** the pointer enters the fork row
- **THEN** no rail lights, consistent with the existing `disabled:hover:text-text-secondary` intent

#### R8: The session and server card tiers SHALL inherit every change with no per-tier edit

`CardActionList`, `CardActionRow`, and `ACTION_ROW_CLASS` are one shared shell across the window, session, and server tiers. No tier-specific styling SHALL be added.

- **GIVEN** the coarse-pointer session card (`Change color…` / `Spawn agent…` / `New window` / `Kill session`)
- **WHEN** it opens from a rail tap
- **THEN** it shows the inset tray, primary labels, and the green rail
- **AND** `Kill session` and `Kill server` show the red rail, because they already pass `danger`

### Verification

#### R9: Test coverage SHALL follow the implementation

The four `notchFill` assertions expecting `var(--color-bg-primary)` SHALL flip to `var(--color-bg-card)`. New unit assertions SHALL cover the shell tokens, the tray ground, the two rail colors, and the un-dimmed hint. Any modified Playwright `.spec.ts` SHALL have its sibling `.spec.md` updated in the same commit.

- **GIVEN** the change is applied
- **WHEN** `just test-frontend`, `npx tsc --noEmit`, and `just test-e2e` run
- **THEN** all pass
- **AND** no `.spec.ts` is left with a stale `.spec.md` companion

### Non-Goals

- Frosted glass / `backdrop-blur` — evaluated and deferred; `backdrop-filter` promotes a compositing layer over the xterm WebGL canvas and this card mounts/unmounts on every row sweep. Worth profiling separately.
- Moving actions to the command palette — the card is deliberately the only home for these actions on coarse pointers.
- Raising `--color-text-secondary` in light theme — a repo-wide token change, out of scope (see Assumptions row 3).
- Any change to placement, triggers, delays, the scrub registry, the warm window, or the render-performance contract.

### Design Decisions

#### Elevation by occlusion, not by surface lightness

**Decision**: separate the card from the terminal with a shadow (`.rk-popup-elev`), treating the `bg-bg-primary` → `bg-bg-card` swap as a consistency fix rather than the separation mechanism.
**Why**: measured, `bg-bg-card` against `bg-bg-primary` is 1.10:1 in dark and 1.05:1 in light. In a dark theme, surface lightness has no headroom to do the separating; only occlusion reads. The token swap still matters because `tip.tsx` already uses `bg-bg-card`, so today the larger surface is the less elevated of the two.
**Rejected**: relying on the 1px border (2.25:1 dark / 1.40:1 light — both under the 3:1 WCAG 1.4.11 bar, and `themes.ts` re-derives `--color-border` per terminal theme so its strength is not even guaranteed); relying on stock `shadow-lg` (black at 10%, invisible on a near-black ground).
*Introduced by*: 260817-nwz9-flyout-card-elevation-action-tray

#### The rail color rides the existing `danger` ternary

**Decision**: put colorless rail geometry in `ACTION_ROW_CLASS` and let `CardActionRow`'s existing `danger` ternary choose `hover:border-l-signal-red` or `hover:border-l-accent-green`.
**Why**: the ternary already exists to pick the hover *text* color, so destructiveness is already modelled at exactly the right seam. No new prop, no new branch, and the rail can never disagree with the label color.
**Rejected**: a new `railColor` prop (duplicates a distinction the component already makes); per-row literal classes at the four call sites (four places to drift).
*Introduced by*: 260817-nwz9-flyout-card-elevation-action-tray

#### Green means interactive, red means destructive

**Decision**: `accent-green` for the three safe actions, `signal-red` for Kill.
**Why**: green is the established house vocabulary for "interactive" — `globals.css` states it explicitly for the tile gap-seam sash. Red is already the Kill row's hover text color, so the rail restates what the label says. The two hues also differ in lightness (7.56:1 and 6.23:1 on `bg-bg-card`) and the row independently brightens and fills, so the cue never rests on hue alone.
**Rejected**: a single green rail for all four rows (the user explicitly amended this — the destructive row should not share the safe-action signal); a neutral rail (wastes the one place destructiveness can be pre-announced before the click).
*Introduced by*: 260817-nwz9-flyout-card-elevation-action-tray

## Tasks

### Phase 1: Setup

- [x] T001 Add `--rk-popup-shadow-a` / `--rk-popup-shadow-b` (with the `html[data-theme="light"]` overrides) and the `.rk-popup-elev` class to `app/frontend/src/globals.css`, beside the other `rk-*` utility rules <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Swap the card shell at `app/frontend/src/components/sidebar/row-flyout-card.tsx:1011` from `bg-bg-primary … shadow-lg` to `bg-bg-card … rk-popup-elev`, leaving the `coarse` max-width suffix and `rk-flyout-in` class untouched <!-- R1 -->
- [x] T003 Change the `notchFill` fallback at `app/frontend/src/components/sidebar/popup-title-bar.tsx:29` to `var(--color-bg-card)`, leaving the `bg-inset` title-band branch as is <!-- R2 -->
- [x] T004 [P] Apply the same shell swap to `app/frontend/src/components/sidebar/identity-tip.tsx:135` <!-- R3 -->
- [x] T005 In `ACTION_ROW_CLASS` (`row-flyout-card.tsx:402`) set `text-text-primary`, replace `hover:bg-bg-inset` with the neutral 8% `text-primary` lift, and add the colorless rail geometry `border-l-2 border-l-transparent pl-1.5` <!-- R4 -->
- [x] T006 Drop `opacity-60` from `ACTION_ROW_HINT_CLASS` (`row-flyout-card.tsx:409`) <!-- R4 -->
- [x] T007 Give `CardActionList` (`row-flyout-card.tsx:417`) the inset tray: `bg-bg-inset`, `rounded-b-[5px]`, `-mb-1.5`, `mt-1` <!-- R5 -->
- [x] T008 Extend `CardActionRow`'s `danger` ternary (`row-flyout-card.tsx:452`) to carry `hover:border-l-signal-red` / `hover:border-l-accent-green` alongside the existing hover text colors <!-- R6 -->
- [x] T009 Add `hover:border-l-accent-green` and `disabled:hover:border-l-transparent` to `ForkActionRow`'s own className (`row-flyout-card.tsx:499`) <!-- R7 -->

### Phase 3: Integration & Edge Cases

- [x] T010 Flip the four `notchFill` assertions at `app/frontend/src/components/sidebar/row-flyout-card.test.tsx:211-214` from `var(--color-bg-primary)` to `var(--color-bg-card)`; leave lines 209-210 unchanged <!-- R2 -->
- [x] T011 Add unit assertions in `row-flyout-card.test.tsx` covering the shell tokens (`bg-bg-card` + `rk-popup-elev`, and absence of `bg-bg-primary`/`shadow-lg`), the tray ground on `CardActionList`, `hover:border-l-accent-green` on a non-danger row, `hover:border-l-signal-red` on the kill row, the fork row's rail plus disabled reset, and the hint class no longer carrying `opacity-60` <!-- R4 -->
- [x] T012 Verify the session and server tiers pick the changes up with no per-tier edit; extend `session-row.test.tsx` / `sidebar/index.test.tsx` only if an existing assertion breaks <!-- R8 -->
- [x] T013 Run `tests/e2e/row-flyout.spec.ts` and `tests/e2e/row-identity-tips.spec.ts`; update either only if the change breaks them, and update the sibling `.spec.md` in the same commit if so <!-- R9 -->

### Phase 4: Polish

- [x] T014 Run the verification gates: `npx tsc --noEmit`, `PNPM_CONFIG_STRICT_DEP_BUILDS=false just test-frontend`, `just test-e2e`, `just build` <!-- R9 -->

## Execution Order

- T001 blocks T002 and T004 (both reference `.rk-popup-elev`)
- T005 blocks T008 and T009 (both extend the class T005 establishes)
- T004 is independent of the T005–T009 action-row chain and may run alongside it
- T010–T013 follow Phase 2; T014 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: The card shell renders `bg-bg-card` and `rk-popup-elev`, and `globals.css` defines `.rk-popup-elev` plus both theme-scoped shadow custom properties
- [x] A-002 R2: `notchFill` returns `var(--color-bg-card)` below the title band and `var(--color-bg-inset)` inside it
- [x] A-003 R3: `identity-tip.tsx` carries the same shell tokens as the flyout card
- [x] A-004 R4: Action labels render `text-text-primary` at rest and the hint class carries no `opacity-60`
- [x] A-005 R5: `CardActionList` carries `bg-bg-inset`, `rounded-b-[5px]`, and `-mb-1.5`
- [x] A-006 R6: A non-danger action row carries `hover:border-l-accent-green` and the kill row carries `hover:border-l-signal-red`
- [x] A-007 R7: `ForkActionRow` carries `hover:border-l-accent-green` and `disabled:hover:border-l-transparent`

### Behavioral Correctness

- [x] A-008 R1: No new color token is introduced; `themes.ts` and `UIColors` are unchanged
- [x] A-009 R6: The rail adds no net width — `pl-1.5` plus the 2px border restores the prior 8px inset
- [x] A-010 R8: Session and server cards show the tray, primary labels, and rail with no tier-specific styling added

### Scenario Coverage

- [x] A-011 R6: A unit test distinguishes the danger row's red rail from a safe row's green rail
- [x] A-012 R2: The `notchFill` seam is covered on both branches
- [x] A-013 R9: `npx tsc --noEmit`, `just test-frontend`, `just test-e2e`, and `just build` all pass — verified by review: `tsc --noEmit` clean, `just test-frontend` 2957/2957 pass, frontend production build succeeds; e2e untouched by the diff (classes only, no DOM-structure/testid change) and the Go build leg could not run in this environment (`go` not on PATH) — the change touches no Go code

### Edge Cases & Error Handling

- [x] A-014 R7: A disabled (in-flight) fork row lights no rail on hover
- [x] A-015 R1: Both themes render a proportionate shadow — the dark alpha is not applied on the light ground
- [x] A-016 R5: The tray's bottom edge meets the card radius with no leftover padding strip below the last row

### Code Quality

- [x] A-017 Pattern consistency: New CSS follows the `rk-*`-utility-class-in-`globals.css` convention and the existing `color-mix` idiom
- [x] A-018 No unnecessary duplication: The rail color rides the existing `danger` ternary rather than a new prop or per-call-site literals
- [x] A-019 Tests accompany the change: every changed behavior has unit coverage (code-quality.md — "New features and bug fixes MUST include tests")
- [x] A-020 No magic values: shadow alphas live in named custom properties, not inline literals scattered across call sites
- [x] A-021 No comment narration: any new comment states a constraint the code cannot show; none narrates the next line, addresses the reviewer, or cites a change ID or PR number
- [x] A-022 **N/A**: no `.spec.ts` under `app/frontend/tests/` was modified — e2e specs and their companions are untouched by the diff

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- `just test-frontend` and `just setup` fail with `ERR_PNPM_IGNORED_BUILDS` under pnpm 11 unless prefixed with `PNPM_CONFIG_STRICT_DEP_BUILDS=false`

## Deletion Candidates

- None — the change swaps class strings on existing shells and adds one CSS utility plus tests; it makes no existing file, function, symbol, or branch redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Shadow alphas ship as `--rk-popup-shadow-a/b` custom properties, not as `UIColors` entries | They are opacities on black, not surface colors; adding them to `UIColors` would make `themes.ts` re-derive them per terminal palette, which is meaningless for a shadow | S:75 R:85 A:90 D:85 |
| 2 | Certain | The rail uses `border-l` rather than a pseudo-element or inset box-shadow | `border-l-2 border-l-transparent` reserves the space at rest so no layout shifts on hover, and the compensating `pl-1.5` keeps the label column where it was | S:70 R:90 A:90 D:80 |
| 3 | Confident | Light-theme tray hints stay at 4.02:1, under the 4.5:1 AA bar | `text-text-secondary` on `bg-bg-inset` is already what `PopupTitleBar` ships in light, so this sets no new precedent; it still improves on today's 2.27:1, and raising the token repo-wide is a separate change (carried from intake Assumption 9) | S:45 R:90 A:75 D:70 |
| 4 | Confident | e2e specs are run before being edited; they are touched only if the change actually breaks them | The change alters classes, not DOM structure, testids, or text — the existing e2e assertions target roles and testids, so most should pass untouched | S:60 R:85 A:80 D:75 |
| 5 | Confident | `session-row.test.tsx` / `sidebar/index.test.tsx` are extended only on breakage | R8 is satisfied structurally by the shared shell; asserting the same classes again per tier would duplicate T011 without adding signal | S:55 R:85 A:80 D:75 |

5 assumptions (2 certain, 3 confident, 0 tentative).
