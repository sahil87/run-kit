# Plan: Continuous Three-Tier Status Rail + Session/Server Cards + Change Color Action

**Change**: 260817-ve5m-three-tier-status-rail-cards
**Intake**: `intake.md`

## Requirements

Frontend only, `app/frontend/src/components/sidebar/` (+ tests). Builds on merged #634/#639. Fine-pointer behavior changes ONLY where stated (the window card's `Change color…` row). The intake's verified anchors are authoritative; re-verify at apply if a hunk fails to match.

### Rail: Three-Tier Extension

#### R1: Rail on session rows and server-group headers (coarse, non-ghost)
Session rows (`session-row.tsx`) and server-group headers (`index.tsx` ServerGroup) SHALL render the same recessed rail as the shipped window rail — inset band, 1px left seam, fixed 16px glyph slot (ALWAYS an empty span on these tiers) + 12px `›` chevron (~55% opacity, `aria-hidden`) — forming one continuous strip. Per-tier band tint derives from existing tint systems: session/server rails mix their header's family tints into the inset base using the established `color-mix` idiom (the window rail's selected-variant pattern, `window-row.tsx:385-392`); window rails keep the shipped treatment. No new color tokens. Coarse only; non-ghost only; fine pointers keep hover clusters + identity tips untouched.

- **GIVEN** a coarse pointer and an expanded server group with sessions and windows
- **WHEN** the sidebar renders
- **THEN** every non-ghost row of all three tiers shows the rail; chevrons align on one vertical line; session/server glyph slots are empty; band tints read per-tier
- **AND** on fine pointers no tier renders a rail

#### R2: Rail width 56px (all tiers) via the one constant
`STATUS_RAIL_WIDTH_PX` (`row-flyout-card.tsx:75`) SHALL change 48 → 56; the coarse card width cap (size() middleware) follows automatically. The window-row literal `coarse:pr-[48px]` (`window-row.tsx:360`) becomes `coarse:pr-[56px]` (the literal-must-match-constant rule pinned in the comment there). Session/server rails use the same constant for their reserve/geometry.

- **GIVEN** a coarse pointer
- **WHEN** any tier's rail renders
- **THEN** it is 56px wide, and an open card's right edge still stops before the rail column

#### R3: Coarse left-zone reclaim (window rows)
On coarse the interactive label zone and its palette-icon reveal SHALL NOT render — the `LabelZone` becomes desktop-only (fine-pointer geometry/behavior byte-identical). The display-only marker stripe (and the scanlines/hazard/data-rain/flair overlays) REMAIN on coarse. Row content start shifts on coarse from `pl-[30px]` to ≈16px (coarse-only class split); fine pointers keep `pl-[30px]`. This supersedes the "label zone active on coarse" wiring (`window-row.tsx:397-399`) — the touch path to color is the card's `Change color…` row (R7).

- **GIVEN** a coarse pointer and a window row with a marker
- **WHEN** the row renders
- **THEN** the stripe is visible, no zone/icon is tappable at the left edge, and the dot+name start ≈16px from the row edge
- **GIVEN** a fine pointer
- **THEN** zone, reveal, stripe, and `pl-[30px]` are all unchanged

### Cards: Session and Server (coarse-only surfaces)

#### R4: Session card
Rail tap/scrub on a session row SHALL open a card using the SAME placement/containment/held-state machinery as the window card: `PopupTitleBar` title `Session <name>`; one facts line `$id · N windows · ~path` (identity-tip content verbatim, omission-degrading, `abbreviateHomePath`); action rows in order — `Change color…` (R7), `Spawn agent…` (rendered ONLY when the consumer wires the existing optional `onSpawnAgent`), `New window` (existing create path), `Kill session` (red, sub-hint `confirms first`, existing kill-dialog path, never force-kill). The desktop session identity tip stays exactly as-is.

- **GIVEN** a coarse pointer
- **WHEN** the user taps a session row's rail
- **THEN** the session card opens below the row (top-start near the drawer bottom), contained left of the rail, with title, facts, and the wired action rows
- **AND** on the board-route sidebar (no `onSpawnAgent`) the Spawn row is absent

#### R5: Server card
Rail tap/scrub on a server-group header SHALL open: title `Server <name>`; facts `tmux -L <name> · N sessions` (count from the group's own data — no new fetch); actions — `Change color…`, `New session` (existing `onCreateSession(server)` instant create), `Kill server` (red, `confirms first`, existing `onKillServer(server)` → `requestKillServer` → the `killServerTarget` dialog; the rk-daemon warning renders as today). Desktop group headers unchanged.

- **GIVEN** a coarse pointer
- **WHEN** the user taps a group header's rail and activates Kill server
- **THEN** the existing kill-server dialog opens (daemon warning included for rk-daemon), and the underlying header was never toggled by the card interaction

#### R6: Header clusters render-gated !coarse
The session-row 4-icon cluster (`session-row.tsx:263-311`) and the server-group header cluster (`index.tsx:2363-2419`) SHALL be render-gated `!coarse` (the `window-row.tsx:663` precedent), retiring their `coarse:opacity-100` / `coarse:min-w-[32px] coarse:min-h-[36px]` fallbacks. Desktop clusters (hover reveals, Tips) unchanged. Every relocated action keeps its palette/desktop path (Constitution V).

- **GIVEN** a coarse pointer
- **WHEN** session rows and group headers render
- **THEN** no cluster buttons exist in their DOM; the rail owns the edge
- **GIVEN** a fine pointer
- **THEN** clusters behave byte-identically to today

### Cards: Change Color + Held State + Scrub

#### R7: `Change color…` first action row of every card
All three cards SHALL open with `Change color…` (exact wording) as the first action row; on the WINDOW card it renders on BOTH pointer worlds, above Fork (order: Change color → Fork → Pin → Kill). Mechanism is the Pin-row idiom: close the card, then open that tier's existing picker — window: `setShowLabelPicker(true)` (the combined label picker); session: the header palette's `showColorPicker` → `SwatchPopover`; server: the group's portalled `SwatchPopover`. The card `suppressed` gates SHALL include each tier's color-popover-open state (window already does via `showLabelPicker`; session/server card hooks add theirs), so popover-over-card precedence holds everywhere. Optional-handler gating: a consumer wiring no color seam renders no row.

- **GIVEN** an open window card on a fine pointer (desktop hover)
- **WHEN** `Change color…` is activated
- **THEN** the card closes and the label picker opens anchored to the row; the row was not selected
- **GIVEN** an open session/server card on coarse
- **WHEN** `Change color…` is activated
- **THEN** the card closes and that tier's color popover opens; re-opening the card is inhibited while the popover is open

#### R8: Held-rail highlight (all tiers, including the shipped window rail)
While a row's card is open (tap-held or mid-scrub), that row's rail SHALL lighten — band steps up one shade, seam brightens — keyed on the row-local open state (the `flyout.open` held-state precedent, `window-row.tsx:332-340`). Shade derivation reuses the existing `color-mix` tint idioms; no new tokens; no highlight at rest. During a scrub the highlight travels row-to-row with the single-open card.

- **GIVEN** a finger holding row A's rail, then sliding to row B
- **WHEN** the card retargets
- **THEN** A's rail returns to rest and B's rail shows the held treatment

#### R9: Cross-tier scrub
All rail-bearing rows (window, session, server) SHALL register in the one module-scoped scrub registry (`flyoutScrubTargets`); `resetFlyoutWarmState()` keeps clearing it. The hit-test SHALL generalize via a shared data attribute on rail-bearing row roots (e.g. `data-rail-row`, since session rows lack `data-window-id` and group headers are not treeitems), with BOTH gesture ends (`scrubTargetAt` and every tier's start-handler `closest`) using the IDENTICAL selector. Sliding along the strip retargets cards across tiers; suppressed rows (ghosts, open pickers/popovers) are skipped via `openNow()`'s existing early-return; single-open + warm-window semantics unchanged; the scrub never selects/navigates/toggles any row.

- **GIVEN** a coarse pointer and a finger starting on a window row's rail
- **WHEN** it slides up across the session row and onto the server-group header
- **THEN** window card → session card → server card retarget in sequence, one open at a time; release keeps the server card; nothing navigated or collapsed

### Tests

#### R10: Unit + e2e; companion doc same commit
Unit: `window-row.test.tsx` (zone reclaim, 56px reserve, held-rail class, Change color row wiring), `row-flyout-card.test.tsx` (constant change + cap, generalized selector/registry, Change color row order + gating), `session-row.test.tsx` (rail, cluster gating, card content/actions/suppression), `sidebar/index.test.tsx` (ServerGroup rail + card seams, R6a handler stability where asserted). E2E: extend `tests/e2e/row-flyout.spec.ts` + `.spec.md` in the SAME commit — update #639 geometry assertions this change moves (content start, 56px rail, held highlight where asserted), add session/server rail coverage (tap opens card, kill/create/color actions route, cross-tier scrub retarget). hasTouch emulation; `just test-e2e` / `just pw` only.

- **GIVEN** the full change
- **WHEN** `just test-frontend` and `just test-e2e` run
- **THEN** all pass and every new/changed `test()` is documented in `row-flyout.spec.md`

### Non-Goals

- Desktop session/server cards (identity tips + hover clusters stay the fine-pointer surfaces)
- Any change to `identity-tip.tsx`, the desktop label zone, palette entries, backend, routes, tokens
- Rail-hold palette reveal (rejected — obsolete with the zone gone and the card row present)

### Design Decisions

#### One card shell, three tiers
**Decision**: Generalize the flyout machinery into ONE shared shell (placement arms, containment cap, held-state key, portal/focus wiring) parameterized by tier content (title, facts, action rows), consumed by window (existing content), session, and server rows.
**Why**: The intake binds all tiers to one placement/containment/held implementation; duplicating the floating-ui wiring per tier is the drift risk the one-card principle exists to prevent.
**Rejected**: Per-tier card components with copied positioning (three drift surfaces), or forcing session/server content through the window card's register renderer (registers are window-only concepts).
*Introduced by*: 260817-ve5m-three-tier-status-rail-cards

#### Shared `data-rail-row` hit-test attribute
**Decision**: Rail-bearing row roots carry a shared data attribute; both scrub ends select on it exclusively.
**Why**: The three tiers have three DOM shapes (`treeitem`+`data-window-id`, `treeitem`+`data-session-row`, non-treeitem header) — a role-based selector cannot cover them; one attribute makes the selector identical at both gesture ends by construction.
**Rejected**: A union selector (three shapes to keep in sync at two call sites).
*Introduced by*: 260817-ve5m-three-tier-status-rail-cards

#### Cluster gating mirrors the window precedent
**Decision**: Session/server clusters are render-gated `!coarse`, not CSS-hidden.
**Why**: Same rationale as #634's window-row decision — removes the buttons from the a11y tree/tab order on touch and makes "not hittable" structural.
**Rejected**: Class removal (invisible focusable buttons).
*Introduced by*: 260817-ve5m-three-tier-status-rail-cards

## Tasks

### Phase 1: Setup

*(none — all files exist)*

### Phase 2: Core Implementation

- [x] T001 `row-flyout-card.tsx`: `STATUS_RAIL_WIDTH_PX` 48→56; generalize the scrub hit-test to the shared `data-rail-row` attribute (`scrubTargetAt` + exported selector constant); registry accepts all rail-bearing rows; extract/generalize the shared card shell (placement arms, size() cap, held key, FloatingPortal/FocusManager, notch) parameterized by tier content <!-- R2, R9, R1 -->
- [x] T002 `window-row.tsx`: `coarse:pr-[48px]`→`[56px]`; add `data-rail-row` + the shared selector at the start-handler; held-rail highlight keyed on `flyout.open`; coarse left-zone reclaim (LabelZone + reveal `!coarse`, stripe/overlays stay, content start ≈16px coarse-only split) <!-- R2, R3, R8, R9 -->
- [x] T003 `row-flyout-card.tsx` + `window-row.tsx`: `Change color…` first action row on the window card (both pointer worlds, above Fork), Pin-row close-then-open idiom via `setShowLabelPicker(true)`; suppression already covers `showLabelPicker` <!-- R7 -->
- [x] T004 `session-row.tsx`: coarse rail (tier tint, empty glyph slot, chevron, 56px), cluster render-gated `!coarse`, `data-rail-row` + scrub registration, session card (title/facts/action rows: Change color… → Spawn agent… [onSpawnAgent-gated] → New window → Kill session), suppression incl. `showColorPicker`, held highlight <!-- R1, R4, R6, R7, R8, R9 -->
- [x] T005 `index.tsx` (ServerGroup): coarse rail on the group header (tier tint), cluster render-gated `!coarse`, `data-rail-row` + scrub registration, server card (title/facts/actions: Change color… → New session → Kill server), suppression incl. its color popover, held highlight; new per-row handlers as identity-arg `useCallback`s (R6a stability) <!-- R1, R5, R6, R7, R8, R9 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T006 [P] Unit `window-row.test.tsx`: zone/reveal absent under mocked coarse (stripe present), content-start split, 56px reserve, held-rail class on open, Change color row → label picker wiring, shared selector <!-- R2, R3, R7, R8 -->
- [x] T007 [P] Unit `row-flyout-card.test.tsx`: constant 56 + cap follows, generalized selector/registry (all-tier elements retarget), Change color first + order Change color→Fork→Pin→Kill, optional-handler gating <!-- R2, R7, R9 -->
- [x] T008 [P] Unit `session-row.test.tsx` (+ `sidebar/index.test.tsx` for ServerGroup): rail render coarse-only + tier tint class, clusters absent on coarse / unchanged on fine, card content + action routing (spawn gate, kill path, color handoff), suppression precedence <!-- R1, R4, R5, R6, R7 -->
- [x] T009 E2E `tests/e2e/row-flyout.spec.ts` + `row-flyout.spec.md` (same commit): update moved #639 geometry assertions; add — session rail tap opens session card + actions route, server rail tap opens server card + kill dialog (daemon warning case if cheap), cross-tier scrub retarget with release-keeps-open, zone-gone/stripe-present on coarse; `just test-e2e` / `just pw` only <!-- R10 -->

## Execution Order

- T001 first (constants + shared shell + selector foundation); T002/T003 then T004/T005 build on it
- T006–T008 after their subjects; T009 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: All three tiers render the rail on coarse non-ghost rows — continuous strip, aligned chevrons, per-tier tints, empty glyph slots on session/server; no rail on fine pointers
- [x] A-002 R2: Rail is 56px on every tier via `STATUS_RAIL_WIDTH_PX`; window reserve literal updated; card cap still contains left of the rail
- [x] A-003 R3: Coarse — no interactive label zone or reveal; marker stripe + row overlays intact; content starts ≈16px. Fine — byte-identical
- [x] A-004 R4: Session card renders title/facts/actions per spec; Spawn row absent without `onSpawnAgent`; Kill session confirms via the existing dialog
- [x] A-005 R5: Server card renders title/facts/actions per spec; Kill server routes through `killServerTarget` (daemon warning preserved); New session uses the instant-create path
- [x] A-006 R6: Session/server clusters absent from the DOM on coarse, unchanged on fine
- [x] A-007 R7: `Change color…` first row on all three cards (window card on both pointer worlds, above Fork); close-then-open handoff to each tier's existing picker; suppression precedence at every tier

### Behavioral Correctness

- [x] A-008 R8: Held-rail highlight appears only while that row's card is open, travels with the scrub, rests otherwise; shades derive from existing idioms (no new tokens)
- [x] A-009 R9: Both scrub ends use the identical `data-rail-row` selector; cross-tier scrub retargets window↔session↔server; scrub never selects/navigates/toggles
- [x] A-010 R6/V: Every relocated action retains its desktop + palette path (session color/spawn/create/kill; server color/create/kill)

### Scenario Coverage

- [x] A-011 R9: Suppressed rows (ghosts, open pickers) are skipped mid-scrub; single-open + warm-window semantics unchanged
- [x] A-012 R4/R5: Card action rows `stopPropagation` and are Tab-reachable (focus manager order); activating never selects/toggles the underlying row
- [x] A-013 R10: `row-flyout.spec.ts` + `.spec.md` updated in the same commit; #639 geometry assertions updated, not orphaned

### Edge Cases & Error Handling

- [x] A-014 R4: Facts line degrades by omission (missing `sessionId`/`sessionPath`/counts → segment dropped, never "undefined")
- [x] A-015 R9: Row unmount mid-scrub (SSE churn) unregisters cleanly; coordinator never points at a dead row
- [x] A-016 R7: Re-opening a card is inhibited while that tier's color popover is open (no card-over-popover flash)

### Code Quality

- [x] A-017 Pattern consistency: one shared card shell, one registry, one selector constant; comments state constraints, not narration
- [x] A-018 No duplication: floating-ui wiring exists once; existing pickers/dialogs/handlers reused; `PopupTitleBar` carries the card titles
- [x] A-019 Render-performance invariants hold across all three tiers: memo'd rows, row-local card state, module-scope coordination, no new subscriptions/ticks, R6a-stable new handler props
- [x] A-020 Type narrowing over assertions; no new `as` casts beyond file idiom

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without leaving redundant code behind; the code it made redundant (the window-row inline scrub trio, `LabelZone`'s `marker` prop + in-zone stripe, the session/server clusters' coarse touch fallbacks) was removed in the same diff.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Shared card shell realized by generalizing the existing flyout machinery (parameterized content), not per-tier copies | Intake grants implementation freedom bound to ONE implementation; generalization is the shape that satisfies the bound | S:75 R:65 A:85 D:70 |
| 2 | Confident | Hit-test attribute named `data-rail-row`, exported as one selector constant consumed by both gesture ends | Intake suggests the shared-attribute route and names the three DOM shapes; the exact name is free | S:70 R:90 A:85 D:80 |
| 3 | Confident | Coarse content start implemented as a coarse-only padding split (~`coarse:pl-4` equivalent) leaving fine `pl-[30px]` untouched | Arithmetic given (≈16px); exact class realization is apply-time with one obvious shape | S:70 R:90 A:85 D:75 |
| 4 | Confident | Held/tier shade ratios picked at apply from the existing `color-mix` idiom (one step up from each band's rest mix) | Intake assumption 9/10 defer ratios to apply explicitly | S:70 R:90 A:80 D:70 |
| 5 | Certain | Window card row order Change color → Fork → Pin → Kill, wording `Change color…` everywhere | Stated verbatim | S:95 R:85 A:95 D:95 |

5 assumptions (1 certain, 4 confident, 0 tentative).
