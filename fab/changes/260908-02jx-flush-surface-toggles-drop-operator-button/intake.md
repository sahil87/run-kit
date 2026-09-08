# Intake: Flush Surface Toggles + Drop Operator Button

**Change**: 260908-02jx-flush-surface-toggles-drop-operator-button
**Created**: 2026-09-08

## Origin

Conversational (`/fab-discuss` session with a screenshot + live HTML design study). The user's raw input:

> This combo box - looks like 3 disconnected buttons. Can you make it look better? Present examples to me
>
> Also the operator button on the left - is it really needed? We already have the input box on the left. Can remove it IMHO.

Four treatments (A flush segments / B underline latch / C fused outline runs / D ink-only) were mocked interactively (`rk present` design study, dark + light) alongside a before/after of the ◉ operator button removal. The user chose **variant A** ("Agreed A") and had themselves proposed the button removal, which the discussion confirmed with the state-dot relocation caveat.

## Why

1. **The pain point**: the top-bar surface-toggle group (tty `>_` / code `{}` / web `://`) draws a rounded accent-green border around **every lit segment** (`top-bar.tsx` `SurfaceToggleGroup`, `rounded border` per segment + `LATCHED_ARM`). With 2–3 tiles open, the segments render as separate green pills, the group's neutral wrapper border disappears behind them, and the control reads as three disconnected buttons instead of one segmented control. The "only the lit segment draws a border" rule came from the split-chip precedent, where at most one segment latches — it breaks down when several latch at once (the group's common state).
2. **Redundant chrome**: the ◉ operator-console button at the right cluster's head duplicates the operator omnibox one cell over — the omnibox carries the same ◉ glyph and opens the same console (click / ⌘J two-state machine). Two adjacent affordances for one action is noise in a bar that fights for width (the fit/overflow pipeline).
3. **If not fixed**: the group keeps mis-reading as three unrelated actions (users won't discover it's one open-tiles control), and the bar spends a 28px slot + fit-budget on a duplicate affordance.
4. **Why this approach**: variant A (flush segments) is the classic segmented-control idiom, keeps the established "green wash = latched" algebra, and is the smallest diff — segments only *lose* their own border/radius. B (underline) introduced a new latch vocabulary nothing else uses; C (fused outline runs) needed neighbor-aware render logic for the same legibility; D (ink-only) had too little on/off contrast. Removing the ◉ button loses nothing once its one unique signal (the operator live-state dot) relocates onto the omnibox's ◉ glyph.

## What Changes

### 1. Surface-toggle group → flush segmented control (variant A)

`app/frontend/src/components/top-bar.tsx` `SurfaceToggleGroup` (both modes — desktop toggle and pinned mobile switch — share the button grammar):

- Segments **drop** their per-segment `rounded border` and the `border-transparent` rest arm. The wrapper keeps its neutral `border border-border rounded` and now owns the outline.
- **Hairline dividers**: every segment after the first gets `border-l border-border` (the OpenButton chevron-segment precedent, `open-button.tsx`). Dividers stay neutral even between two lit segments (per the approved mock).
- **End radius**: outer corners only — first segment `rounded-l-[3px]`, last `rounded-r-[3px]` (or wrapper `overflow-hidden`; apply picks, the rendered result is square inner corners / rounded outer corners).
- **Lit state = wash-only latch**: `bg-accent-green/15 text-accent-green hover:bg-accent-green/25` — green wash + green glyph, **no green border**. Unlit rest/hover unchanged (`text-text-secondary hover:text-text-primary`, no wash).
- Everything else is untouched: 26px segment height inside the 28px wrapper box (`TOP_BAR_SEGMENT_H`), glyphs from `SURFACE_GLYPH`, the corner content/availability dot and its `showDot` predicate, `aria-pressed`, disabled-at-3 with the Tip-wrapped span, the trailing `w-px h-4` group divider, and `SurfaceToggleMenuRows` (the overflow-menu form).

`app/frontend/src/components/control.tsx`:

- The wash-only latch is a **new arm** on the `segment` variant (e.g. a `flush?: true` option or a `LATCHED_ARM_FLUSH` constant) — `LATCHED_ARM` itself MUST NOT change: it is shared by the other `segment` consumers (OpenButton's chevron segment, `terminal-activity-tabs.tsx`'s Terminal|Activity radio, the board SplitControl), which latch at most one segment and keep the border treatment.
- `control-gallery.tsx` (`/__controls`) gains the new variant×state cell and `control.test.tsx` covers it (the visual-design drift-guard convention).

### 2. Remove the ◉ operator-console button

- Delete the `operator-console-button` registry entry from `rightItems` in `top-bar.tsx` (the cluster-head entry, `hidden: isMobile`, `menuRender: null`).
- Delete `OperatorConsoleButton` (and its now-unused pieces) from `top-bar-overflow-menu.tsx`; move/export the `OPERATOR_STATE_DOT` map to wherever the omnibox consumes it (e.g. `lib/operator-console.ts`).
- **Keep** untouched: the menu-only `operator-console` App-section entry (`OperatorConsoleMenuRow` — the mobile path), the ⌘J chord and two-state machine, the palette's open action, and the mobile tongue.
- Tests: `operator-console-button.test.tsx` is removed or rewritten against the omnibox dot; `tests/e2e/operator-console.spec.ts` has 2 references to the `operator-console-button` testid that must be re-anchored (intent comments updated in the same commit per the constitution's Test Intent Comments rule).

### 3. Operator live-state dot rides the omnibox ◉ glyph

`app/frontend/src/components/operator-omnibox.tsx` (it already resolves the console target via `resolveOperatorConsoleTarget`, so the `agentState` derivation exists in place):

- The **standing box** (≥ lg) ◉ glyph gains the state dot: absolutely positioned at the glyph's bottom-right, `h-2 w-2 rounded-full border border-bg-primary`, colors per `OPERATOR_STATE_DOT` (`active` → `bg-accent-green`, `waiting` → `bg-signal-yellow`, other states → `bg-text-secondary`), **no dot when no operator resolves** (the console hint line stays the answer) — semantics identical to the button's dot today.
- The **md–lg ghost** (`· ◉ ask`) carries the same dot on its ◉ (the accepted caveat: the signal is less prominent at those widths).
- Mobile renders nothing here (omnibox self-gates), unchanged.

## Affected Memory

- `run-kit/ui/top-bar`: (modify) surface-toggle group treatment (flush segments, wash-only latch, hairline dividers); ◉ operator-console button section removed; omnibox section gains the live-state dot
- `run-kit/ui/visual-design`: (modify) Control primitive — new flush latch arm on the `segment` variant; latch color algebra note (border latch vs wash-only latch and which consumers use which)
- `run-kit/ui/operator-console`: (modify) desktop standing affordance is the omnibox alone (button retired); state-dot surfacing moves accordingly

## Impact

- **Frontend only** — no Go, no API, no routes. Files: `top-bar.tsx`, `top-bar-overflow-menu.tsx`, `operator-omnibox.tsx`, `control.tsx`, `control-gallery.tsx`, `lib/operator-console.ts` (dot map home).
- **Tests**: `control.test.tsx`, `top-bar.test.tsx` (toggle-group class assertions, operator-button registry assertions), `operator-console-button.test.tsx` (remove/rewrite), `operator-omnibox.test.tsx` (dot), e2e `operator-console.spec.ts` (2 testid refs) + any surface-toggle e2e assertions on lit-segment classes.
- **Fit pipeline**: removing the cluster-head entry changes the first-fit-candidate order (surface-toggles becomes the head) — behavior-neutral but overflow tests may assert order.
- **No keyboard changes**: ⌘J, ⌘1/2/3, and the palette registry are untouched (Constitution V holds — the console stays palette-reachable).

## Open Questions

*(none — the design was settled interactively against live mocks)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Variant A (flush segments + hairline dividers, wash-only latch) over B/C/D | Discussed — user chose A explicitly against live mocks of all four | S:95 R:80 A:90 D:95 |
| 2 | Certain | Remove the ◉ operator button; keep the menu row, ⌘J, palette action, and mobile tongue | User proposed the removal themselves; discussion confirmed nothing else is lost | S:90 R:85 A:90 D:90 |
| 3 | Confident | Operator live-state dot relocates onto the omnibox ◉ glyph (standing box AND md–lg ghost) | Shown in the before/after mock with the md–lg caveat; user agreed to the package | S:70 R:85 A:80 D:75 |
| 4 | Certain | New flush latch arm in controlClass; shared `LATCHED_ARM` unchanged | Code-derived: OpenButton/activity-tabs/SplitControl share the segment variant and keep the border latch | S:60 R:80 A:95 D:90 |
| 5 | Confident | Dividers between segments stay neutral (`border-border`) even between two lit segments | Matches the approved variant-A mock; trivially reversible | S:65 R:85 A:80 D:70 |
| 6 | Confident | Unlit hover stays ink-brighten only (no wash) — unchanged from today | Current behavior carried forward; mock showed the same | S:55 R:90 A:80 D:75 |
| 7 | Confident | Mobile switch mode gets the identical flush treatment | The two modes share the button grammar by design; radio mode never hits the multi-lit case anyway | S:60 R:85 A:85 D:80 |

7 assumptions (3 certain, 4 confident, 0 tentative, 0 unresolved).
