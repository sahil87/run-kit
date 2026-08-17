# Plan: Right-edge status rail + contained mobile card + explicit card actions

**Change**: 260816-b8eu-status-rail-card-actions
**Intake**: `intake.md`

## Requirements

Frontend only (`app/frontend/src/`). Builds on merged #634; every behavioral change is coarse-gated except the card action-row restructure (R5), which applies to all pointer types. Desktop hover cluster, glyph display-swap, and `placement: "right"` stay byte-identical on fine pointers.

### Window Row: Right-Edge Status Rail

#### R1: Rail rendering (coarse, non-ghost rows)
Every non-ghost window row on coarse pointers SHALL render a 48px trailing status rail (`window-row.tsx`): a recessed inset band (`bg-bg-inset`-family background, `border-l border-border` seam; on the selected row a darker variant derived from the existing tint system — `tint.selected`/inset mix or the gray sentinel, no new color tokens). Inside, two FIXED slots so content column-aligns down the sidebar: a 16px PR-glyph slot (empty span when `!prOwnsGlyph(win)`; else the state-picked `GitPullRequestIcon`/`GitPullRequestClosedIcon` colored by `prGlyphColor(win)` — gate and color chain unchanged) and a 12px chevron hint slot (a muted `›` at ~55% opacity, `aria-hidden`, rendered on EVERY rail). On coarse the PR glyph renders in the rail slot INSTEAD of the absolute last-slot overlay; the fine-pointer overlay (`window-row.tsx:663-671`) is untouched. The row button's reserved right padding gains a coarse variant sized to the rail so names truncate before it (fine-pointer `pr-[68px]`/`pr-11` untouched). The rail does not exist on fine pointers or ghost rows.

- **GIVEN** a coarse pointer and rows with and without owned PRs
- **WHEN** the sidebar renders
- **THEN** every non-ghost row shows the inset rail; chevrons align on one vertical line whether or not a glyph is present; PR rows show the glyph in the 16px slot
- **AND** the selected row's rail shows the darker selected variant; ghost rows show no rail

- **GIVEN** a fine pointer
- **WHEN** rows render, hover, or receive cluster focus
- **THEN** rendering is byte-identical to today (hover cluster, glyph overlay swap, padding)

#### R2: Rail is the primary scrub/tap target
The rail SHALL carry `touch-action: none` and the existing #634 gesture handlers — `onScrubStart`/`onScrubMove`/`onScrubEnd` (`window-row.tsx:245-274`), the module-scoped registry + `activeFlyout` coordinator (`row-flyout-card.tsx:87-131`) — REUSED, never duplicated: pointerdown opens via `flyout.openNow()` + capture, pointermove retargets via `scrubTargetAt`, release keeps the last card open. The existing dot-tap zone (`status-dot-tap` span, coarse 32×36 + `touch-none`, `window-row.tsx:587-597`) SHALL keep working as a secondary target sharing the same handlers. Row-body taps still navigate; drawer scrolling from outside the rail and dot zone is untouched; the scrub never selects/navigates; the `onDragStart` scrub guard still applies.

- **GIVEN** a coarse pointer
- **WHEN** the user presses the rail of row A and slides over rows B and C
- **THEN** the card opens for A and retargets to B then C; release keeps C's card; no navigation, no drawer scroll from the gesture
- **AND** a tap on the status dot still opens the card (secondary target)

#### R3: Scrub hit-test selector unification (cleanup)
`onScrubStart`'s `closest('[role="treeitem"]')` (`window-row.tsx:248`) SHALL become the stricter `closest('[role="treeitem"][data-window-id]')`, matching `scrubTargetAt` (`row-flyout-card.tsx:127`). `scrubTargetAt` is unchanged.

- **GIVEN** a scrub starting on a rail
- **WHEN** the start handler resolves its row root
- **THEN** both ends of the gesture use the identical selector

### Shell: Mobile Drawer Width

#### R4: Drawer widened
The mobile drawer aside (`shell/shell.tsx:304`) SHALL change from `w-[88%] max-w-[320px]` to `w-[92%] max-w-[340px]`. No other drawer behavior changes.

- **GIVEN** a mobile viewport
- **WHEN** the drawer opens
- **THEN** it spans 92% of the viewport capped at 340px

### Flyout Card: Coarse Placement + Containment

#### R5: Card anchors below the row on coarse, never overlapping the rail
On coarse pointers `useRowFlyout` SHALL position the card with `placement: "bottom-start"` and `flip({ fallbackPlacements: ["top-start"] })` near the drawer bottom; on fine pointers `placement: "right"` and the current middleware stay exactly as today (`row-flyout-card.tsx:637-655`; `strategy: "fixed"`, `offset(6)`, `shift({ padding: 8 })`, `arrow()` retained on both arms). The coarse card's width SHALL be capped so its right edge stops BEFORE the 48px rail column (max-width ≈ drawer width − 48px − margins, replacing `max-w-xs` on coarse only — CSS calc or `size()` middleware, implementer's choice) — the card never overlaps the rail and never renders off-screen. The `FloatingArrow` notch points up at the rail on coarse; the `notchFill` title-band seam logic (`row-flyout-card.tsx:760-771`) MUST keep producing the correct fill for the new arrow side (top edge ⇒ the arrow's resolved coordinate is `x`, not `y` — verify, don't assume).

- **GIVEN** a coarse pointer and an open card on any row (including the last visible row)
- **WHEN** the card renders
- **THEN** it is fully inside the viewport, below (or above, near the drawer bottom) its row, its right edge left of the rail column, notch pointing at the rail
- **AND** during a scrub the finger's rail column is never covered by the card

- **GIVEN** a fine pointer
- **WHEN** the card opens on row hover/focus
- **THEN** placement, size, and behavior are unchanged from today

### Flyout Card: Sectioned Action Rows (all pointer types)

#### R6: Fork/Pin/Kill as an explicit sectioned action list; fork leaves the title bar
The card's action area SHALL become a sectioned list — top border after the registers/freshness block, one row per action, inter-row hairlines — in this order:

1. `⑂ Fork conversation`, sub-hint "new window, same directory" (the `FORK_TOOLTIP` semantics). Keeps the double gate (`canForkWindow(win)` AND optional `onFork`) and the leaf-scoped in-flight busy guard + `mountedRef` (currently in `ForkLink`, `row-flyout-card.tsx:265-300` — the guard moves with the affordance into the row; no gate/guard weakening).
2. `Pin to board…` with `PinIcon filled={pinned}`; sub-hint reflects pin state — "not pinned" when unpinned, the board name via a new `pinnedBoard` value threaded through `UseRowFlyoutOptions` (sourced from the existing `WindowRow` prop, `window-row.tsx:123`), a bare pinned wording when pinned without a known board. Handler unchanged (`onPinAction` → close card → `PinPopover`).
3. `✕ Kill window`, red treatment, sub-hint "confirms first". Handler unchanged (`onKillAction` → `KillDialog`, ctrl=false).

The title-bar `ForkLink` (`row-flyout-card.tsx:378`) SHALL be removed — the title bar keeps only the ⓘ docs link. Row heights: `coarse:min-h-[36px]`, ~28px (`min-h-[28px]`) on fine pointers. All rows `stopPropagation`; Tab-reachable via the existing `FloatingFocusManager` (no focus-management changes). Optional-handler gating stays: a consumer wiring no handler renders no corresponding row.

- **GIVEN** an open card on a claude-chat row wired with all handlers
- **WHEN** the card renders (any pointer type)
- **THEN** three action rows appear in order fork → pin → kill with their sub-hints, and no fork icon exists in the title bar
- **AND** activating Fork disables the row until the promise settles (busy guard) and never selects the underlying row

- **GIVEN** a non-forkable window (`chatProvider !== "claude"`) or a consumer with no `onFork`
- **WHEN** the card renders
- **THEN** no Fork row appears (double gate preserved)

### Tests

#### R7: Unit + e2e coverage; companion doc in the same commit
Unit: `window-row.test.tsx` (rail presence/slots/alignment classes under mocked coarse, absence on fine and ghosts, glyph-in-rail vs fine overlay, padding reserve, rail gesture wiring, selector unification) and `row-flyout-card.test.tsx` (placement branch on coarse, width-cap class/middleware, action-row order + sub-hints + gates + busy guard moved into the row, title-bar fork removal, `pinnedBoard` threading). E2E: extend/update `tests/e2e/row-flyout.spec.ts` AND `row-flyout.spec.md` in the same commit — update #634 assertions that this change moves (fork in title bar at :212/:249 → fork as action row; glyph geometry at :316/:350 → rail slot on coarse; the coarse `hasTouch` block from :337 → bottom-start placement, rail tap/scrub, containment: card box right edge < rail left edge). Run only via `just test-e2e` / `just pw` (port-3020 isolation).

- **GIVEN** the full change
- **WHEN** `just test-frontend` and `just test-e2e` run
- **THEN** all pass, and every new/changed `test()` is documented in `row-flyout.spec.md`

### Non-Goals

- Fine-pointer rail (desktop keeps the hover cluster; no rail)
- SessionRow / SessionTiles / PANE panel — untouched
- New color tokens, new icons beyond the `›` text glyph, backend, routes
- Rail treatments B/C, title-bar fork retention, left-edge rail (rejected in the mock session)

### Design Decisions

#### Rail replaces the glyph overlay on coarse, not alongside it
**Decision**: On coarse, the PR glyph renders inside the rail's fixed 16px slot; the absolute last-slot overlay renders only on fine pointers.
**Why**: One PR channel per pointer world — two glyph renderings on coarse would double-paint inside the same 48px; the rail slot IS the coarse home.
**Rejected**: Keeping the overlay and hiding it under the rail band (dead DOM, z-index fights).
*Introduced by*: 260816-b8eu-status-rail-card-actions

#### Pointer-conditional placement inside one `useRowFlyout`
**Decision**: `useRowFlyout` reads `useCoarsePointer()` itself and branches placement/middleware/width-cap on it; one hook, two placement arms.
**Why**: The hook already owns all positioning; forking the hook or threading placement as a prop would spread the decision across consumers and risk drift.
**Rejected**: A separate mobile card component (duplicate card body — the #634 one-card-three-triggers principle).
*Introduced by*: 260816-b8eu-status-rail-card-actions

#### Fork guard moves as a unit
**Decision**: The fork action row absorbs `ForkLink`'s busy/`mountedRef` guard verbatim rather than reimplementing or centralizing it.
**Why**: The guard is load-bearing (N clicks = N tmux windows) and already correct; moving code beats rewriting it.
**Rejected**: A shared "busy action row" abstraction — one consumer, premature.
*Introduced by*: 260816-b8eu-status-rail-card-actions

## Tasks

### Phase 1: Setup

*(none — all files exist)*

### Phase 2: Core Implementation

- [x] T001 Render the status rail in `app/frontend/src/components/sidebar/window-row.tsx`: coarse-only, non-ghost, 48px inset band (bg-inset + `border-l border-border`, selected-tint variant from the existing tint derivations), fixed 16px glyph slot + 12px `›` hint slot (~55% opacity, aria-hidden) <!-- R1 -->
- [x] T002 Relocate the PR glyph on coarse into the rail slot (fine-pointer absolute overlay untouched) and add the coarse right-padding reserve on the row button (`pr-[68px]`/`pr-11` gain a coarse variant ≈ rail width) in `window-row.tsx` <!-- R1 -->
- [x] T003 Wire the rail as the primary gesture target in `window-row.tsx`: `touch-action: none`, attach the existing `onScrubStart`/`onScrubMove`/`onScrubEnd` handlers (shared with the kept dot-tap zone); verify drag guard still applies <!-- R2 -->
- [x] T004 Unify the scrub hit-test selector in `window-row.tsx` (line ~248): `closest('[role="treeitem"][data-window-id]')` <!-- R3 -->
- [x] T005 Widen the mobile drawer in `app/frontend/src/components/shell/shell.tsx` (line ~304): `w-[88%] max-w-[320px]` → `w-[92%] max-w-[340px]` <!-- R4 -->
- [x] T006 Pointer-conditional card placement in `app/frontend/src/components/sidebar/row-flyout-card.tsx`: coarse ⇒ `bottom-start` + `flip({fallbackPlacements:["top-start"]})` + width cap stopping before the rail column (replace `max-w-xs` on coarse only); fine ⇒ today's `right` arm verbatim; verify the `FloatingArrow`/`notchFill` seam for a top-edge arrow <!-- R5 -->
- [x] T007 Restructure the card actions in `row-flyout-card.tsx` (+ `window-row.tsx` threading): sectioned list fork → pin → kill with sub-hints and heights (36px coarse / 28px fine), fork row absorbing `ForkLink`'s double gate + busy guard, `pinnedBoard` threaded through `UseRowFlyoutOptions` for the pin sub-hint, kill row red treatment; REMOVE the title-bar `ForkLink` (title bar keeps only ⓘ) <!-- R6 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T008 [P] Unit tests in `window-row.test.tsx`: rail presence/slot alignment on mocked coarse, absence on fine + ghosts, glyph-in-rail vs fine overlay, coarse padding reserve, rail pointerdown opens + shares handlers, unified selector <!-- R1, R2, R3 -->
- [x] T009 [P] Unit tests in `row-flyout-card.test.tsx`: coarse placement branch + width cap, action rows (order, sub-hints incl. `pinnedBoard` states, gates, busy guard, stopPropagation), title-bar fork removed <!-- R5, R6 -->
- [x] T010 Update/extend `app/frontend/tests/e2e/row-flyout.spec.ts` + `row-flyout.spec.md` (same commit): fork-as-action-row (was title bar, :212/:249), glyph-in-rail geometry (:316/:350), coarse block (:337+) — rail tap opens, bottom-start placement fully on-screen, card right edge < rail left edge, scrub via rail, drawer width unasserted elsewhere; run via `just test-e2e` / `just pw` only <!-- R7 -->

## Execution Order

- T001 → T002 → T003 (rail build-up); T004, T005 independent
- T006 and T007 are independent card edits; T007 after T001 only for shared testids if any
- T008/T009 after their subjects; T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: Coarse non-ghost rows render the 48px inset rail with aligned fixed slots (16px glyph, 12px `›`); ghost rows and fine pointers render none
- [x] A-002 R1: On coarse the PR glyph renders inside the rail slot (correct color/icon); on fine the absolute overlay behavior is unchanged
- [x] A-003 R2: Rail pointerdown opens the card, scrub retargets across rows, release keeps the last card; dot-tap still opens as secondary
- [x] A-004 R4: Drawer is `w-[92%] max-w-[340px]`
- [x] A-005 R5: Coarse card anchors bottom-start (top-start near the drawer bottom), fully on-screen, right edge before the rail column; fine keeps `right` verbatim
- [x] A-006 R6: Card shows fork → pin → kill sectioned rows with sub-hints on both pointer worlds; title bar has no fork icon

### Behavioral Correctness

- [x] A-007 R1: Selected-row rail uses the darker tint variant derived from existing tint derivations (no new tokens)
- [x] A-008 R2: Row-body taps navigate; drawer scrolls from outside rail+dot zone; scrub never navigates; drag guard intact
- [x] A-009 R6: Fork keeps the `canForkWindow` + `onFork` double gate and the in-flight busy guard (disabled until settle, `mountedRef`-safe); pin/kill handlers unchanged (PinPopover handoff; KillDialog confirm, ctrl=false)
- [x] A-010 R3: Both scrub ends use `'[role="treeitem"][data-window-id]'`

### Scenario Coverage

- [x] A-011 R5: During a scrub the rail column is never covered by the open card (containment invariant)
- [x] A-012 R6: Action rows are Tab-reachable and `stopPropagation` (activation never selects the row); optional-handler gating renders no row without its handler
- [x] A-013 R7: `row-flyout.spec.ts` + `row-flyout.spec.md` updated in the same commit; stale #634 assertions (title-bar fork, glyph overlay on coarse, right-placement on coarse) updated; e2e via `just` only

### Edge Cases & Error Handling

- [x] A-014 R5: Card on the last visible row flips to top-start and stays on-screen
- [x] A-015 R6: `isPinnedToAny` true with `pinnedBoard` undefined degrades to a bare pinned wording (no "undefined" text)
- [x] A-016 R5: `notchFill` produces the correct fill for the top-edge arrow (title-band seam does not break)

### Code Quality

- [x] A-017 Pattern consistency: rail derives from existing tokens/tints; comments state constraints, not narration; no text-glyph action icons (the `›` is aria-hidden decoration)
- [x] A-018 No unnecessary duplication: gesture handlers, registry, coordinator, gates, and guards are reused/moved — never reimplemented
- [x] A-019 Render-performance invariants hold: memo'd `WindowRow`, row-local flyout state, module-scope coordination, card mounts only while open, no new subscriptions/ticks in rows
- [x] A-020 Type narrowing over assertions; no new `as` casts beyond file idiom

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without leaving discovered redundancies behind; everything it obsoleted was removed in the same diff (the title-bar `ForkLink` home, the `Pinned — manage boards…` label variant, the `row-flyout-fork-link` testid, and the coarse-mounted empty `group/icons` glyph-anchor container).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Width cap mechanism left as implementer's choice between a coarse-only CSS `calc()` max-width and floating-ui `size()` middleware, with the containment invariant (right edge < rail left edge) as the acceptance test | Intake grades this Confident (its #6); the invariant, not the mechanism, is the contract | S:70 R:85 A:80 D:65 |
| 2 | Confident | Rail gesture attachment reuses the exact existing handler trio; the rail and dot zone are two reference elements sharing one row-local flyout instance | "reuse, don't duplicate" is stated; the handlers are already row-scoped so a second attach point is the minimal shape | S:70 R:80 A:85 D:75 |
| 3 | Confident | The arrow/notch on coarse: keep `arrow()` middleware; verify whether the resolved coordinate for a top-edge arrow is `x` and adapt `notchFill`'s input accordingly | The intake flags "must keep working" without prescribing the fix; floating-ui documents per-side coordinates | S:60 R:85 A:75 D:70 |
| 4 | Certain | Sub-hint copy: "new window, same directory" / "not pinned"·board name / "confirms first" | Stated verbatim in the intake/mock | S:90 R:90 A:90 D:90 |

4 assumptions (1 certain, 3 confident, 0 tentative).
