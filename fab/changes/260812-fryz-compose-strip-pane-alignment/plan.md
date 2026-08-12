# Plan: Compose Strip Pane Alignment

**Change**: 260812-fryz-compose-strip-pane-alignment
**Intake**: `intake.md`

## Requirements

### Compose Strip: Pane-Aligned Geometry

#### R1: Focused-pane geometry channel
`FocusedTerminalContext` (`app/frontend/src/contexts/focused-terminal-context.tsx`) SHALL extend the `FocusedTerminal` type with a `containerRef: React.RefObject<HTMLElement | null>` pointing at the element whose box visually IS the pane (the tile/pane container, not the inner xterm canvas). Both producers MUST register it: `TerminalClient` (`src/components/terminal-client.tsx`, `registerFocus` path — its root wrapper div) and `BoardPane` (`src/components/board/board-pane.tsx` — its root pane div, alongside the existing `rootRef` callback). The context doc header SHALL document the new field and the existing no-clear-on-focus-loss / clear-on-unmount-iff-still-registered semantics remain unchanged.

- **GIVEN** a terminal route with a focused `TerminalClient`
- **WHEN** the client registers into `FocusedTerminalContext`
- **THEN** `focused.containerRef.current` is the client's root container element

- **GIVEN** a board route where a pane gains focus (click, cycle, initial pane)
- **WHEN** `BoardPane` registers itself as focused
- **THEN** `focused.containerRef.current` is that pane's root div

#### R2: Strip visible box aligns under the focused pane
`ComposeStrip` (`src/components/compose-strip.tsx`) SHALL keep its shell-footer mounts (`app.tsx` footer, `board-page.tsx` footer) and its outer element occupying the full footer row (row-height/refit mechanics untouched, per 260718-dhdj). When a normal focused target exists, the strip MUST measure `focused.containerRef.current.getBoundingClientRect()` and apply the pane's horizontal span (via inline `margin-left` + `width` on an inner wrapper carrying the visible chrome — border, background, input, buttons) so the visible box sits under the focused pane. It MUST re-measure on: focused-target change, window resize, and pane-size change (ResizeObserver on the container element — covers sidebar open/close and layout ratio drags). Measurement is rAF-debounced.

- **GIVEN** a terminal route with a tty+code split layout and the strip enabled
- **WHEN** the tty tile is the focused terminal
- **THEN** the strip's visible box left/width match the tty tile's horizontal span (not the full page width)

- **GIVEN** a board with N panes and the strip enabled
- **WHEN** focus cycles to a different pane
- **THEN** the strip's visible box re-measures and moves under the newly focused pane

- **GIVEN** an aligned strip
- **WHEN** the sidebar opens/closes or a layout ratio drag resizes the focused pane
- **THEN** the strip re-measures without a window resize event (ResizeObserver path)

#### R3: Min-width clamp and viewport containment
The visible box SHALL clamp to a minimum usable width of **420px** and never overflow the strip's own bounds. When a narrow pane forces the clamp, the box overhangs its neighbors **centered on the target pane's span** where possible, shifted only as needed to stay inside the footer row. The clamp/positioning computation MUST be a pure function (new `src/lib/compose-strip-geometry.ts`) for unit testing.

- **GIVEN** a focused board pane narrower than 420px
- **WHEN** the strip aligns to it
- **THEN** the visible box is 420px wide, centered on the pane's span, shifted to remain fully inside the footer row

- **GIVEN** a focused pane wider than the footer row (degenerate)
- **WHEN** the strip aligns
- **THEN** the visible box clamps to the footer row's width

#### R4: Full-width fallbacks unchanged
The strip SHALL stay full width in exactly two modes: **selection broadcast** (`selectionTarget` set — frozen multi-window target, no single anchor) and the **no-target disabled state** (`focused === null`). The `→ {window}` target label remains in all modes.

- **GIVEN** selection-broadcast mode (`→ N selected`)
- **WHEN** the strip renders
- **THEN** the visible box spans the full footer row with no alignment styles applied

- **GIVEN** `focused === null` (e.g. `/$server` tiles route)
- **WHEN** the strip renders disabled
- **THEN** the visible box spans the full footer row

#### R5: Retarget motion, reduced-motion zeroed
The visible box SHALL transition its `margin-left`/`width` on focus change (the slide visualizes the retarget). Under `prefers-reduced-motion` the transition MUST be zeroed (Tailwind `motion-reduce:` — animations zeroed, static states remain, per project convention).

- **GIVEN** two panes and the strip aligned to pane A
- **WHEN** focus moves to pane B
- **THEN** the visible box animates its left/width to pane B's span
- **AND** with `prefers-reduced-motion: reduce` the change is instant

#### R6: Mobile non-regression
On mobile (`isMobileViewport()` — single visible pane fills the content width), pane-aligned and full-width converge; the strip MUST NOT shrink below the clamp behavior incorrectly or overflow at 375px.

- **GIVEN** a 375px viewport on the terminal route with the strip enabled
- **WHEN** the strip renders
- **THEN** no horizontal page overflow occurs and the strip remains fully usable

### Non-Goals

- No re-mount of the strip inside any tile (breaks selection broadcast, boards, refit mechanics — intake Why §3).
- No change to send semantics, Enter policy, drafts, sent-history, uploads, or focus contract.
- No backend or API changes.

### Design Decisions

#### Inner-wrapper geometry, outer row untouched
**Decision**: Apply alignment as inline `marginLeft`/`width` styles on a new inner wrapper that takes over the strip's visible chrome; the outer `data-testid="compose-strip"` element keeps occupying the full footer row.
**Why**: The footer-row growth is what drives every terminal's ResizeObserver refit (260718-dhdj); narrowing only the visible chrome preserves that mechanic byte-for-byte while delivering the visual scoping.
**Rejected**: Absolute-positioning the whole strip over the content area — it would decouple the strip from the footer grid row, breaking the refit mechanic and stacking-context assumptions.
*Introduced by*: 260812-fryz-compose-strip-pane-alignment

#### Pure geometry helper
**Decision**: Extract the clamp/centering math into `computeStripGeometry()` in `src/lib/compose-strip-geometry.ts`, taking pane and strip rects plus the min-width constant, returning `{ left, width } | null` (null = full width).
**Why**: Mount-free unit tests for the clamp/overhang/viewport edge cases (the `palette-move.ts` extraction pattern); DOM measurement stays in the component, math stays pure.
**Rejected**: Inline math in the measure effect — untestable without a real layout engine.
*Introduced by*: 260812-fryz-compose-strip-pane-alignment

## Tasks

### Phase 2: Core Implementation

- [x] T001 Extend `FocusedTerminal` type with `containerRef: React.RefObject<HTMLElement | null>` + doc-header update in `app/frontend/src/contexts/focused-terminal-context.tsx` <!-- R1 -->
- [x] T002 [P] `TerminalClient`: add a root-wrapper div ref and register it as `containerRef` in the `registerFocus` effect (`app/frontend/src/components/terminal-client.tsx`) <!-- R1 -->
- [x] T003 [P] `BoardPane`: capture the root pane div in a local ref (composed with the existing `rootRef` callback) and register it as `containerRef` in the focus-registration effect (`app/frontend/src/components/board/board-pane.tsx`) <!-- R1 -->
- [x] T004 [P] Pure geometry helper `computeStripGeometry()` in new `app/frontend/src/lib/compose-strip-geometry.ts` (min-width 420 clamp, center-on-pane overhang, strip-bounds containment) with colocated `compose-strip-geometry.test.ts` <!-- R3 -->
- [x] T005 `ComposeStrip`: split outer row / inner visible-chrome wrapper, add the measurement effect (focused-target change + window resize + ResizeObserver on `containerRef.current`, rAF-debounced), apply geometry styles, keep full-width fallbacks for selection-broadcast and no-target modes (`app/frontend/src/components/compose-strip.tsx`) <!-- R2 -->
- [x] T006 Motion: transition `margin-left`/`width` on the inner wrapper, zeroed via `motion-reduce:transition-none` (`app/frontend/src/components/compose-strip.tsx`) <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Unit tests in `app/frontend/src/components/compose-strip.test.tsx`: aligned mode applies geometry styles; selection-broadcast and no-target modes apply none (full width) <!-- R4 -->
- [x] T008 E2E `app/frontend/tests/e2e/compose-strip.spec.ts` + companion `.spec.md`: strip aligns under the focused pane on a split terminal layout and under the focused board pane (re-aligns on pane cycle), stays full-width in selection-broadcast mode; verify 375px mobile no-overflow. Run via `just test-e2e` / `just pw` only <!-- R2 -->

## Execution Order

- T001 blocks T002, T003, T005 (type change first).
- T004 is independent; T005 consumes it.
- T006 rides T005's wrapper; T007–T008 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `FocusedTerminal` carries `containerRef`; both `TerminalClient` and `BoardPane` register a live element for it
- [x] A-002 R2: With a focused terminal target, the strip's visible box matches the focused pane's horizontal span; the outer element still spans the footer row
- [x] A-003 R3: `computeStripGeometry()` exists as a pure function and implements the 420px clamp, centered overhang, and strip-bounds containment

### Behavioral Correctness

- [x] A-004 R2: The strip re-measures on focused-target change, window resize, and container ResizeObserver events (rAF-debounced)
- [x] A-005 R4: Selection-broadcast and no-target modes render full width with no alignment styles; the `→ {target}` label is present in all modes
- [x] A-006 R5: The inner wrapper transitions left/width on retarget and the transition is zeroed under `prefers-reduced-motion`

### Scenario Coverage

- [x] A-007 R2: E2E asserts alignment under the focused pane on a split terminal layout and under the focused board pane, and full width in selection-broadcast mode; `.spec.md` companion updated in the same commit (constitution: Test Companion Docs)
- [x] A-008 R3: Unit tests cover clamp edge cases: pane narrower than 420px (centered overhang, edge shift), pane wider than strip, pane at strip edges

### Edge Cases & Error Handling

- [x] A-009 R1: A null/unset `containerRef.current` (registrant unmounted mid-measure) degrades to full width without throwing
- [x] A-010 R6: At 375px the strip causes no horizontal page overflow and remains usable (mobile convergence)

### Code Quality

- [x] A-011 Pattern consistency: New code follows naming and structural patterns of surrounding code (module-scope helpers, doc-comment style, `rk-*`/Tailwind vocabulary)
- [x] A-012 No unnecessary duplication: Existing utilities reused (`entryKey`, existing refs/effects patterns); no second measurement pipeline
- [x] A-013 Type narrowing over assertions: no `as` casts on the new geometry/ref plumbing
- [x] A-014 Tests included: new behavior covered by unit tests and Playwright e2e (code-quality principles)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The full-width rendering path is retained deliberately as the selection-broadcast / no-target fallback (R4), so nothing it replaces is dead.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Geometry applied as inline `marginLeft`+`width` on a new inner wrapper; outer keeps the full footer row and `data-testid="compose-strip"` | Intake names both options ("margin-left + width, or absolute inline style"); margin flow keeps the wrapper in-grid and testids stable | S:70 R:85 A:80 D:70 |
| 2 | Confident | `containerRef` targets: TerminalClient's root wrapper div; BoardPane's root pane div (composed with the existing `rootRef` callback) | Intake asks for "the element whose box visually IS the pane"; these are the outermost per-pane elements each registrant owns | S:70 R:80 A:85 D:75 |
| 3 | Confident | Pure helper `computeStripGeometry()` in `src/lib/compose-strip-geometry.ts` returning `{left,width}|null` | Intake requires extracting clamp math for unit tests; shape follows the `palette-move.ts` extraction pattern | S:75 R:85 A:85 D:80 |
| 4 | Confident | Transition via CSS on the inner wrapper with `motion-reduce:transition-none` | Matches the project's zeroed-animation convention (context.md § Conventions); no JS animation needed for a layout slide | S:70 R:90 A:85 D:80 |
| 5 | Tentative | Containment bound = the strip outer element's own rect (footer row), not the raw viewport | The footer row is the strip's positioning context and never exceeds the viewport, so containing to it satisfies "never overflow the viewport" while keeping math relative | S:55 R:85 A:70 D:60 |<!-- assumed: viewport containment implemented as containment within the strip's own footer-row bounds -->

Apply-run additions (worker-decided, T001–T008):

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 6 | Confident | The strip's `border-t`/`bg-bg-primary` moved onto the inner wrapper; the outer row carries only `data-testid="compose-strip"` | R2 names border+background as part of the narrowing "visible chrome"; the strip's only border was its top separator | S:65 R:85 A:80 D:70 |
| 7 | Confident | First measure runs synchronously in the `useLayoutEffect`; only subsequent re-measures (resize/RO) are rAF-debounced | A rAF-deferred first measure flashes full width on mount; the plan's "rAF-debounced" targets the re-measure path | S:60 R:90 A:80 D:70 |
| 8 | Confident | `setGeometry` returns the previous object when left/width are unchanged | Divider drags fire ResizeObserver continuously; identity-preserving updates avoid re-render churn | S:70 R:90 A:85 D:75 |
| 9 | Confident | E2E terminal-route tolerance is 16px because the registered container is TerminalClient's root div inside the tile's `px-1` padding | Plan assumption 2 fixes the container choice; the tile box differs from it by exactly that padding | S:75 R:90 A:85 D:80 |
| 10 | Confident | E2E stamps `@rk_url` in `beforeAll` (not mid-test); the backend window payload refreshes on an interval | A mid-test set raced payload propagation and flaked the web-tile wait at 10s; verified by a failing first run, green after the move | S:85 R:90 A:85 D:80 |
| 11 | Certain | Board e2e pins to a second per-run board (`csa<digits>`), not the label test's `BOARD_NAME` | Same windows pinned to two boards in one file; separate names keep the tests independent | S:80 R:90 A:90 D:85 |

5 assumptions (0 certain, 4 confident, 1 tentative).
