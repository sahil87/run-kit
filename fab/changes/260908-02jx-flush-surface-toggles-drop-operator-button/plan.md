# Plan: Flush Surface Toggles + Drop Operator Button

**Change**: 260908-02jx-flush-surface-toggles-drop-operator-button
**Intake**: `intake.md`

## Requirements

### Top Bar: Surface-toggle group flush treatment

#### R1: Flush segmented control
The surface-toggle group (`SurfaceToggleGroup`, `app/frontend/src/components/top-bar.tsx`) SHALL render as ONE connected segmented control in both modes (desktop toggle, pinned mobile switch): the wrapper keeps its neutral `border border-border rounded` and owns the outline; segments carry NO per-segment border and NO per-segment full radius; every segment after the first carries a `border-l border-border` hairline divider (neutral even between two lit segments); only the outer corners round (first segment `rounded-l-[3px]`, last `rounded-r-[3px]` — per-position radius classes, NOT wrapper `overflow-hidden`, so segment `focus-visible` outlines are never clipped). A lit segment SHALL show the wash-only latch: `bg-accent-green/15 text-accent-green hover:bg-accent-green/25` — green wash + green glyph, no green border. Unlit rest/hover, glyphs, the corner `showDot` dot, `aria-pressed`, disabled-at-3 with the Tip-wrapped span, `TOP_BAR_SEGMENT_H` geometry, the trailing `w-px h-4` group divider, and `SurfaceToggleMenuRows` are all unchanged.

- **GIVEN** a terminal route with all three tiles open (desktop toggle mode)
- **WHEN** the top bar renders
- **THEN** the group reads as one bordered control: a single neutral outline, two interior hairline dividers, three green-washed cells — no per-segment green borders, no gaps between cells
- **AND GIVEN** one tile open, **THEN** only that cell is washed and the group outline/dividers are unchanged (no layout shift on toggle)

#### R2: Flush latch arm in the Control primitive
The wash-only latch SHALL be a new arm on `controlClass`'s `segment` variant in `app/frontend/src/components/control.tsx` (a `flush?: boolean` option selecting a `LATCHED_ARM_FLUSH` constant for the pressed/open arm), following the structural REST-swap rule (base + state-arm OR rest, never both). The shared `LATCHED_ARM` / `LATCHED_ARM_RINGED` and the plain segment arm MUST NOT change — OpenButton's chevron segment, `terminal-activity-tabs.tsx`, and SplitControl keep the bordered latch. The `/__controls` gallery (`control-gallery.tsx`) SHALL show the new variant×state cell, and `control.test.tsx` SHALL cover the flush arm's emission.

- **GIVEN** `controlClass({ variant: "segment", flush: true, pressed: true })`
- **WHEN** the class string is composed
- **THEN** it contains the wash-only latch (`bg-accent-green/15 text-accent-green`) and does NOT contain `border-accent-green`
- **AND GIVEN** `flush` absent, **THEN** the emitted classes are byte-identical to today's (existing consumers unaffected)

### Top Bar / Operator Console: standing-affordance consolidation

#### R3: The ◉ operator-console button is removed
The `operator-console-button` registry entry in `top-bar.tsx` `rightItems` and the `OperatorConsoleButton` component in `top-bar-overflow-menu.tsx` SHALL be removed. The desktop standing affordance for the console becomes the operator omnibox (already the console's only desktop input). The menu-only `operator-console` App-section entry (`OperatorConsoleMenuRow`), the ⌘J two-state machine, the palette open action, and the mobile tongue MUST remain untouched. Stale comment references to the in-bar ◉ (the terminal-mode end-state comment, the "OperatorConsoleButton pattern" citations) SHALL be updated, and the repo-wide sweep MUST cover `app/frontend/tests/e2e` (spec assertions on `operator-console-button` testids).

- **GIVEN** any desktop route
- **WHEN** the top bar renders
- **THEN** no `operator-console-button` testid exists anywhere; the right cluster's first fit candidate is the surface-toggle group (terminal) or the mode's next entry
- **AND** the chevron menu still carries the `Operator console` App-section row, and ⌘J still toggles the console

#### R4: The operator live-state dot rides the omnibox ◉ glyph
`operator-omnibox.tsx` SHALL render the resolved-server operator's live-state dot on its ◉ glyph in BOTH desktop rungs — the ≥lg standing box and the md–lg `· ◉ ask` ghost — with semantics identical to the removed button's dot: colors from the `OPERATOR_STATE_DOT` map (`active` → `bg-accent-green`, `waiting` → `bg-signal-yellow`, any other state → `bg-text-secondary`), positioned at the glyph's bottom-right (`h-2 w-2 rounded-full` with a `border border-bg-primary` cutout ring), and NO dot when no operator resolves. The `OPERATOR_STATE_DOT` map SHALL move to `lib/operator-console.ts` (exported). The omnibox already derives the target via `resolveOperatorConsoleTarget`; no new data plumbing.

- **GIVEN** a ≥lg viewport on a server whose operator window's agent state is `waiting`
- **WHEN** the standing omnibox renders
- **THEN** an amber dot sits at the ◉ glyph's bottom-right (testid preserved as the state-dot anchor for e2e)
- **AND GIVEN** md–lg at rest, **THEN** the ghost's ◉ carries the same dot
- **AND GIVEN** no operator window on the resolved server, **THEN** no dot renders

### Non-Goals

- No change to the tongue (mobile standing affordance), the ⌘J machine, palette actions, or keybindings
- No change to the other `segment` consumers' visuals (OpenButton, Terminal|Activity tabs, SplitControl)
- No change to the surface-toggle mutation semantics (`togglePanel` / `switchToTile`), the `showDot` predicate, or the disabled-at-3 rule

### Design Decisions

#### Flush latch is a new segment arm, not a LATCHED_ARM restyle
**Decision**: Add `LATCHED_ARM_FLUSH` behind a `flush` option on the `segment` variant; `LATCHED_ARM` is untouched.
**Why**: Three other segment consumers latch at most one segment and keep the bordered latch; the flush treatment is specifically for a group where several segments latch at once.
**Rejected**: Restyling `LATCHED_ARM` globally — would silently change OpenButton/SplitControl/activity-tab latch visuals.
*Introduced by*: 260908-02jx-flush-surface-toggles-drop-operator-button

#### Per-position end radius over wrapper overflow-hidden
**Decision**: First/last segments carry `rounded-l-[3px]` / `rounded-r-[3px]`; the wrapper does NOT get `overflow-hidden`.
**Why**: Segments carry `focus-visible:outline-2` — outlines paint outside the border box and a clipping wrapper would swallow the focus ring (an accessibility regression).
**Rejected**: Wrapper `overflow-hidden` (simpler CSS, clips focus outlines).
*Introduced by*: 260908-02jx-flush-surface-toggles-drop-operator-button

#### Desktop standing affordance consolidates onto the omnibox
**Decision**: Remove the ◉ button; the omnibox (standing box + ghost) is the desktop standing affordance and carries the live-state dot.
**Why**: The omnibox is already the console's only desktop input, carries the same ◉ glyph, and opens the same machine — two adjacent affordances for one action; the dot was the button's only unique signal.
**Rejected**: Keeping both (duplicate affordance + a wasted 28px fit-budget slot); dropping the dot entirely (loses the amber `waiting` attention signal).
*Introduced by*: 260908-02jx-flush-surface-toggles-drop-operator-button

### Deprecated Requirements

#### Top-bar ◉ operator-console button (desktop standing affordance)
**Reason**: Redundant with the operator omnibox one cell over; the affordance-pair rule ("exactly one standing affordance per form factor") is now satisfied by the omnibox on desktop.
**Migration**: Omnibox ◉ glyph carries the live-state dot; console opening stays via omnibox click/focus, ⌘J, palette, and the chevron-menu App row.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add the flush segment arm to `app/frontend/src/components/control.tsx`: `LATCHED_ARM_FLUSH = "bg-accent-green/15 text-accent-green hover:bg-accent-green/25"`, a `flush?: boolean` option on the `segment` variant selecting it as the pressed/open arm (REST-swap preserved); extend `control.test.tsx` (flush pressed/rest/disabled emission + existing-consumer byte-identity) <!-- R2 -->
- [x] T002 [P] Add the flush-segment variant×state cell to `app/frontend/src/components/control-gallery.tsx` (the `/__controls` drift guard) <!-- R2 -->
- [x] T003 Restyle `SurfaceToggleGroup` in `app/frontend/src/components/top-bar.tsx` per R1 (depends on T001): segments use `controlClass({ variant: "segment", flush: true, pressed })` with divider/end-radius classes replacing the per-segment `rounded border`; update `top-bar.test.tsx` toggle-group assertions <!-- R1 -->
- [x] T004 [P] Remove the `operator-console-button` registry entry from `top-bar.tsx` and delete `OperatorConsoleButton` from `top-bar-overflow-menu.tsx`; move `OPERATOR_STATE_DOT` to `app/frontend/src/lib/operator-console.ts` (exported); update stale ◉ comments (terminal-mode end-state comment, "OperatorConsoleButton pattern" citations in top-bar.tsx/operator-omnibox.tsx) <!-- R3 -->
- [x] T005 Add the live-state dot to `app/frontend/src/components/operator-omnibox.tsx` (standing-box ◉ and md–lg ghost ◉; depends on T004's map relocation): derive `agentState` from the existing resolved target, keep the "no operator ⇒ no dot" rule and a stable state-dot testid <!-- R4 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Port dot unit coverage: delete `operator-console-button.test.tsx`, add equivalent state-dot cases (active/waiting/none-resolved) to `operator-omnibox.test.tsx` <!-- R4 -->
- [x] T007 Re-anchor `app/frontend/tests/e2e/operator-console.spec.ts` lines ~847 (`operator-console-button-state` dot assertion) and ~932 (button-absent check) onto the omnibox dot / removed-button reality; update the tests' intent comments in the same commit (constitution Test Intent Comments) <!-- R3 -->
- [x] T008 Removal + class sweep across `app/frontend/src` AND `app/frontend/tests` (memory: removal sweeps must include e2e): grep `operator-console-button|OperatorConsoleButton` (zero hits outside git history) and audit surface-toggle class assertions (`border-accent-green` on toggle segments) in `top-bar.test.tsx` + the 6 e2e specs referencing `surface-toggles` (mobile-layout, top-bar-overflow, code-surface, right-panel, surface-layout, operator-console) <!-- R3 -->

### Phase 4: Polish

- [x] T009 Verification gates: `cd app/frontend && npx tsc --noEmit`; scoped Vitest (`control`, `top-bar`, `operator-omnibox`, `top-bar-overflow`); scoped e2e via `just test-e2e "operator-console"`, `just test-e2e "top-bar-overflow"`, AND `just test-e2e "control-gallery"` — the gallery gained a cell, so its screenshot spec is changed surface: regenerate the fine/coarse baselines under `tests/e2e/control-gallery.spec.ts-snapshots/` and visually review them <!-- rework: gallery drift-guard baselines stale — control-gallery.spec.ts:63/:93 fail against committed snapshots --> <!-- R1 -->

## Execution Order

- T001 blocks T003 (flush arm consumed by the group)
- T004 blocks T005 (dot map relocation) and T006/T007 (test re-anchoring)
- T002 is independent

## Acceptance

### Functional Completeness

- [x] A-001 R1: The surface-toggle group renders as one connected control (wrapper outline + hairline dividers + wash-only lit cells) in both toggle and switch modes
- [x] A-002 R2: `controlClass` segment variant accepts `flush` and emits the wash-only latch; the gallery shows the new cell
- [x] A-003 R3: The ◉ button (registry entry + component) is gone; menu row, ⌘J, palette, tongue unchanged
- [x] A-004 R4: The omnibox ◉ (standing box AND ghost) carries the live-state dot with the button's exact semantics

### Behavioral Correctness

- [x] A-005 R1: Toggling a tile changes only that cell's wash/ink — no 1px glyph shift, no wrapper geometry change (the total box stays 28px fine / 40px coarse)
- [x] A-006 R2: OpenButton, Terminal|Activity tabs, and SplitControl emit byte-identical classes to before (no `flush` ⇒ no change)

### Removal Verification

- [x] A-007 R3: Zero `operator-console-button` / `OperatorConsoleButton` references remain in `app/frontend/src` and `app/frontend/tests` (e2e included)

### Scenario Coverage

- [x] A-008 R1: A unit or e2e assertion proves a lit segment carries the wash and NOT `border-accent-green`
- [x] A-009 R4: Unit coverage exists for dot states (active/waiting) and the none-resolved absence on the omnibox

### Edge Cases & Error Handling

- [x] A-010 R1: Segment `focus-visible` outline renders unclipped (no `overflow-hidden` on the wrapper)
- [x] A-011 R4: Missing `SessionContext` degrades to "no operator, no dot" without a crash (the existing omnibox tolerance holds)

### Code Quality

- [x] A-012 Pattern consistency: New classes follow the Control-primitive REST-swap composition; no arm-stacking; lockstep comments preserved on size literals
- [x] A-013 No unnecessary duplication: The dot markup/map exists once (shared via `lib/operator-console.ts`), not copied per rung
- [x] A-014 No comment narration or change-ID citations in code comments (provenance lives in git/memory)
- [x] A-015 Tests conform to spec, not vice versa; e2e intent comments updated with the behavior they now prove

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the redundant operator button and its now-unreachable `"button"` event action were removed; no additional dead code was found in the changed-file scope.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Flush arm exposed as a `flush` boolean on the segment variant (not a new variant) | Smallest schema delta; the variant matrix stays one-axis per the primitive's design | S:65 R:85 A:85 D:75 |
| 2 | Confident | End radius via per-position classes, not wrapper `overflow-hidden` | Segment focus-visible outlines must not clip; derived from the global focus-ring rule | S:60 R:85 A:90 D:80 |
| 3 | Confident | The omnibox dot keeps a dedicated state-dot testid (successor to `operator-console-button-state`) | e2e :847 needs a stable anchor; naming is apply's choice | S:60 R:90 A:85 D:80 |
| 4 | Certain | Scoped test gates only (changed-surface specs), full suite on demand | Standing user directive (2026-09-03) recorded in code-quality gates | S:80 R:90 A:95 D:90 |

4 assumptions (1 certain, 3 confident, 0 tentative).
