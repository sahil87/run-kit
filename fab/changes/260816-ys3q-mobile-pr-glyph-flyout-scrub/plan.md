# Plan: Mobile PR-Status Parity + Flyout Scrub Gesture

**Change**: 260816-ys3q-mobile-pr-glyph-flyout-scrub
**Intake**: `intake.md`

## Requirements

All frontend, `app/frontend/src/`. No backend changes; every surface reads the already-streamed `WindowInfo`. Fine-pointer (desktop) behavior is byte-identical throughout — every behavioral change below is gated to coarse pointers except the flyout action rows (R3), which are additive on all pointer types.

### Sidebar Window Row: Rest-State PR Glyph on Coarse

#### R1: PR glyph visible at rest on coarse pointers
The rest-state PR glyph (`components/sidebar/window-row.tsx`, the `data-testid="row-pr-glyph"` span at ~line 599) MUST render visibly at rest on coarse pointers: the `coarse:hidden` class SHALL be removed from its className. The fine-pointer display swap (`group-hover:hidden`, `group-has-[:focus-visible]/icons:hidden`) SHALL remain. The gate (`prOwnsGlyph`), color chain (`prGlyphColor`), state-picked icon (`prState === "closed" ? GitPullRequestClosedIcon : GitPullRequestIcon`), `aria-hidden`, `pointer-events-none`, and the absolute-overlay last-slot geometry MUST all remain unchanged (`components/pr-status-model.ts` untouched).

- **GIVEN** a coarse-pointer viewport and a non-ghost window row whose window has an owned PR (`prOwnsGlyph` true)
- **WHEN** the row renders at rest
- **THEN** the PR glyph is visible in the trailing cluster's last slot, colored by `prGlyphColor`
- **AND** ghost rows render no glyph (existing `!ghost && prOwnsGlyph(win)` gate unchanged)

- **GIVEN** a fine-pointer viewport and the same row
- **WHEN** the pointer hovers the row (or keyboard focus enters the icon cluster)
- **THEN** the glyph hides via the display swap and the revealed ✕ occupies the slot — exactly today's behavior

### Sidebar Window Row: Coarse Action-Cluster Relocation

#### R2: No in-row pin/✕ at rest on coarse
On coarse pointers the trailing pin and kill buttons MUST NOT be visible or hittable at rest. The pin and kill `<button>`s SHALL be render-gated on `!coarse` (the row already holds `useCoarsePointer()` as `coarse`), and their now-dead `coarse:opacity-100` / `coarse:min-w-[32px] coarse:min-h-[36px]` classes SHALL be removed, along with the container's `coarse:pointer-events-auto` (window-row.tsx lines ~573, ~626, ~638). The `group/icons` container itself MUST keep rendering on coarse — it anchors the PR glyph's absolute last-slot overlay (R1). Fine-pointer rest/hover/focus behavior MUST be byte-identical to today (rest `[pin][PR]` → hover `[pin][✕]`, zero layout shift, `pr-[68px]`/`pr-11` reserved padding unchanged).

- **GIVEN** a coarse pointer
- **WHEN** a non-ghost window row renders
- **THEN** no pin or kill button exists in the row DOM (not merely hidden), and the PR glyph (when owned) is the only content of the trailing cluster
- **AND** on coarse, pinned rows show no at-rest pin cue; pin state is readable in the flyout card's pin action row (R3)

- **GIVEN** a fine pointer
- **WHEN** the row renders, is hovered, or receives keyboard focus in the cluster
- **THEN** behavior is unchanged from today

### Row Flyout Card: Pin + Kill Action Rows

#### R3: Flyout card grows Pin and Kill action rows
`RowFlyoutContent` (`components/sidebar/row-flyout-card.tsx`) SHALL render two action rows below the registers/links/freshness content: **Pin** and **Kill**. Callbacks thread through `UseRowFlyoutOptions` as optional handlers the way `onFork` does (`onPinAction?: () => void`, `onKillAction?: () => void`); a consumer wiring none renders no corresponding row. `WindowRow` SHALL wire `onPinAction` to close-card-then-`setShowPinPopover(true)` (the existing `suppressed` gate already includes `showPinPopover`, so popover-over-flyout precedence is pre-wired) and `onKillAction` to the existing `onKillClick(srv, session, win.windowId, false)` → `KillDialog` confirm path (never a force-kill: no modifier on touch). Both rows MUST `stopPropagation` on click (the PR-link/fork/docs idiom) so activating an action never selects the underlying row. The rows render for **all pointer types** — additive on desktop and Tab-reachable via the existing `FloatingFocusManager` (`order={["reference", "content"]}`); the Pin row's label SHOULD reflect pin state (e.g. pinned vs not, from `isPinnedToAny` threaded alongside the handler).

- **GIVEN** an open flyout card on a row wired with both handlers
- **WHEN** the Kill row is activated (tap, click, or Enter on the focused row)
- **THEN** the existing kill confirmation dialog opens (no new kill path, no confirm bypass), and the underlying row is not selected

- **GIVEN** the same card
- **WHEN** the Pin row is activated
- **THEN** the card closes and the existing `PinPopover` opens anchored to the row

- **GIVEN** a consumer that wires no kill/pin handlers (e.g. a bare unit-test render)
- **WHEN** the card opens
- **THEN** no action rows render (the optional-prop idiom)

### Sidebar Window Row: Widened Coarse Tap Zone

#### R4: Leading tap zone on coarse
The `data-testid="status-dot-tap"` span (window-row.tsx ~lines 522–535) SHALL grow on coarse pointers into a proper leading tap zone: `coarse:min-w-[32px] coarse:min-h-[36px]` (the sidebar row-cluster touch-target convention) with the dot centered in the zone (`coarse:justify-center`), plus `coarse:touch-none` (`touch-action: none`) so a drag beginning on the zone is always a scrub (R5) and never scrolls the drawer; drags beginning anywhere else on the row scroll normally. Coarse-only classes: fine-pointer layout, row height, and dot x-position MUST be untouched. The zone MUST NOT overlap the left-edge label zone (which spans the leftmost 26px; the button content starts at `pl-[30px]`).

- **GIVEN** a coarse pointer
- **WHEN** the row renders
- **THEN** the dot's tap target is ≥32px wide and ≥36px tall and carries `touch-action: none`
- **AND** a vertical drag starting elsewhere on the row scrolls the sessions tree as before

- **GIVEN** a fine pointer
- **WHEN** the row renders
- **THEN** the span keeps today's shrink-wrapped geometry and inert behavior (no tap handler side effects beyond today's)

### Row Flyout Card: Slide-to-Scrub Gesture

#### R5: Scrub retargets the single-open card across rows
On coarse, non-ghost rows: `pointerdown` on the tap zone SHALL open that row's card via `flyout.openNow()` (stopping propagation; subsuming the current coarse `onClick`) and capture the pointer (`setPointerCapture(e.pointerId)`). While captured, `pointermove` SHALL hit-test the finger position (`document.elementFromPoint(clientX, clientY)` + `closest()` to a window-row root) against rendered window rows and, when over a **different non-ghost window row** (any session/server group), retarget the single-open card by invoking that row's registered `openNow` (the module-scoped `activeFlyout` coordinator already closes the previous card on open). Non-row elements under the finger (session headers, gaps, panels) MUST leave the current card open — no flicker-close. On `pointerup`/`pointercancel` the capture is released and the last card **stays open**; tapping elsewhere dismisses via the existing `useDismiss` outside-press. The scrub MUST NOT select or navigate rows (`onSelectWindow` never fires from the gesture) and MUST NOT initiate HTML5 row drag (the gesture zone suppresses `dragstart` while a scrub is active, belt to `touch-action: none`'s braces).

**Retarget mechanism**: a module-scoped registry beside the existing `activeFlyout`/`lastClosedAt` coordinator in `row-flyout-card.tsx` — a `Map<HTMLElement, () => void>` from row root element to that row's `openNow` — registered/unregistered inside `useRowFlyout` via an effect keyed on the reference element. Rows whose flyout is suppressed (ghost, pin popover / label picker open) are skipped naturally by `openNow()`'s existing `suppressed` early-return.

**Render-performance invariants (hard constraints, `docs/memory/run-kit/ui/sidebar.md` § Render Performance)**: open state stays row-local inside `useRowFlyout` (never lifted to `Sidebar`); the card body mounts only while open; no per-second tick enters rows; `WindowRow` stays `memo`'d with referentially stable props (the registry is module state, not context, and registration effects introduce no new props).

- **GIVEN** a coarse pointer and several window rows with live data
- **WHEN** the user presses the tap zone of row A and slides the finger over rows B then C without lifting
- **THEN** the card opens for A, retargets to B, then to C — one card open at a time
- **AND** releasing over C keeps C's card open, no navigation occurred, and the drawer did not scroll during the gesture

- **GIVEN** the finger passes over a session header or panel gap mid-scrub
- **WHEN** `pointermove` fires there
- **THEN** the currently open card stays open (no close/flicker)

- **GIVEN** a row whose flyout is suppressed (ghost, or its pin popover/label picker is open)
- **WHEN** the finger passes over it mid-scrub
- **THEN** it is skipped (no card opens for it, the current card stays)

### Tests

#### R6: Unit + e2e coverage, companion doc in the same commit
Unit tests (`window-row.test.tsx`, `row-flyout-card.test.tsx`) SHALL cover: glyph no longer coarse-hidden; pin/kill buttons absent from the DOM under a mocked coarse pointer and present/unchanged under fine; tap-zone coarse classes (`touch-none`, min sizes); pointerdown-opens wiring; card action rows (render + optional-handler gating + `stopPropagation` + kill → `onKillAction` + pin → `onPinAction`); registry register/unregister and retarget helper logic. E2E SHALL extend `tests/e2e/row-flyout.spec.ts` **and its sibling `row-flyout.spec.md` in the same commit** (Constitution — Test Companion Docs) with coarse-pointer coverage (a `hasTouch` context + direct `goto`, the mobile-spec pattern): at-rest PR glyph on coarse; no pin/✕ at rest on coarse; widened tap zone opens the card; kill row opens the kill dialog; pin row opens the pin popover; scrub retarget across rows with release-keeps-open, no navigation, tap-elsewhere dismiss. Existing assertions encoding the old coarse behavior (the coarse dot-tap case, any coarse-cluster visibility assertions in this or other specs) SHALL be updated, not deleted-and-forgotten. E2E runs only via `just test-e2e` / `just pw` (port-3020 isolation), never Playwright directly.

- **GIVEN** the full change
- **WHEN** `just test-frontend` and `just test-e2e` run
- **THEN** all new and updated tests pass, and `row-flyout.spec.md` documents every new `test()` (what it proves + steps)

### Non-Goals

- `SessionRow`'s coarse always-visible cluster (palette/spawn/create/kill) — window rows only; session-row actions serve different needs and stay as-is
- `SessionTiles` window tiles and the PANE panel — unchanged
- Mobile status-bar/bottom-bar PR chip — deferred per intake (rejected alternative)
- Any change to `pr-status-model.ts`, `sidebar/registers.ts`, `status-dot.tsx`, or the backend

### Design Decisions

#### Render-gate the coarse cluster, keep the container
**Decision**: On coarse, the pin/kill buttons are render-gated (`!coarse && …`) rather than CSS-hidden, while the `group/icons` container keeps rendering.
**Why**: Render-gating removes the buttons from the accessibility tree and tab order on touch (an `opacity-0 pointer-events-none` button would still be focusable), and the row already reads `useCoarsePointer()`. The container must survive because the PR glyph's absolute last-slot overlay geometry hangs off it.
**Rejected**: Pure CSS class removal (`coarse:opacity-100` → nothing) — leaves invisible focusable buttons in the DOM on touch and makes the "not hittable" contract depend on class subtleties instead of structure.
*Introduced by*: 260816-ys3q-mobile-pr-glyph-flyout-scrub

#### Element-keyed scrub registry beside the existing coordinator
**Decision**: The scrub retarget uses a module-scoped `Map<HTMLElement, () => void>` (row root → `openNow`) in `row-flyout-card.tsx`, populated by `useRowFlyout`; the gesture hit-tests with `elementFromPoint` + `closest()` to a row root and looks up the handle.
**Why**: Module state is the established coordinator pattern here (`activeFlyout`/`lastClosedAt`), costs no re-renders, and honors the memo tree — no context provider, no lifted state, no new props through `ServerGroup`.
**Rejected**: A React context of row handles (re-render churn through the memo tree) and a `data-row-key`-keyed map (`rowKey` is optional; the element itself is always known to the hook and needs no naming contract).
*Introduced by*: 260816-ys3q-mobile-pr-glyph-flyout-scrub

## Tasks

### Phase 1: Setup

*(none — no scaffolding or dependencies; all files exist)*

### Phase 2: Core Implementation

- [x] T001 Remove `coarse:hidden` from the rest-state PR glyph span in `app/frontend/src/components/sidebar/window-row.tsx` (~line 599); keep the fine-pointer swap classes, gate, color, icons, testid unchanged <!-- R1 -->
- [x] T002 Render-gate the pin and kill buttons on `!coarse` in `app/frontend/src/components/sidebar/window-row.tsx`; remove the dead `coarse:opacity-100` / `coarse:min-w-[32px] coarse:min-h-[36px]` button classes and the container's `coarse:pointer-events-auto`; keep the `group/icons` container rendering on coarse for the glyph overlay <!-- R2 -->
- [x] T003 Add Pin + Kill action rows to `RowFlyoutContent` in `app/frontend/src/components/sidebar/row-flyout-card.tsx`; extend `UseRowFlyoutOptions` with optional `onPinAction` / `onKillAction` (+ a pin-state input for the Pin row label); render rows for all pointer types below the existing content, `stopPropagation` on click, optional-handler gating (no handler → no row) <!-- R3 -->
- [x] T004 Wire the handlers in `app/frontend/src/components/sidebar/window-row.tsx`: `onPinAction` → close card + `setShowPinPopover(true)` (only when `showPinIcon`), `onKillAction` → `onKillClick(srv, session, win.windowId, false)` (only on non-ghost rows) <!-- R3 -->
- [x] T005 Widen the coarse tap zone in `app/frontend/src/components/sidebar/window-row.tsx`: `coarse:min-w-[32px] coarse:min-h-[36px] coarse:justify-center coarse:touch-none` on the `status-dot-tap` span; fine-pointer geometry untouched <!-- R4 -->
- [x] T006 Add the module-scoped scrub registry to `app/frontend/src/components/sidebar/row-flyout-card.tsx`: `Map<HTMLElement, () => void>` beside `activeFlyout`, `registerFlyoutTarget`/lookup helpers, register/unregister in `useRowFlyout` via an effect on the reference element (include in `resetFlyoutWarmState` test seam) <!-- R5 -->
- [x] T007 Implement the scrub gesture on the tap zone in `app/frontend/src/components/sidebar/window-row.tsx`: coarse-only `pointerdown` (stopPropagation, `openNow()`, `setPointerCapture`), `pointermove` hit-test (`elementFromPoint` + `closest` to a row root, registry lookup, retarget only on a different row, no-op on non-row elements), `pointerup`/`pointercancel` release keeping the card open; suppress `dragstart` while a scrub is active; never call `onSelectWindow` <!-- R5 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T008 [P] Unit tests in `app/frontend/src/components/sidebar/window-row.test.tsx`: glyph visible at rest under mocked coarse (no `coarse:hidden`); pin/kill absent from DOM under coarse, present under fine; tap-zone coarse classes; pointerdown opens the flyout and does not select the row; scrub does not trigger drag <!-- R1, R2, R4, R5 -->
- [x] T009 [P] Unit tests in `app/frontend/src/components/sidebar/row-flyout-card.test.tsx`: action rows render with handlers / absent without; `stopPropagation`; kill invokes `onKillAction`, pin invokes `onPinAction`; registry register/unregister on mount/unmount and retarget lookup <!-- R3, R5 -->
- [x] T010 Extend `app/frontend/tests/e2e/row-flyout.spec.ts` + sibling `row-flyout.spec.md` (same commit): coarse at-rest glyph; no pin/✕ at rest on coarse; tap-zone open; kill row → dialog; pin row → popover; scrub retarget + release-keeps-open + no navigation + tap-elsewhere dismiss; update stale coarse assertions here and sweep other specs for coarse-cluster assumptions; run via `just test-e2e` / `just pw` only <!-- R6 -->

## Execution Order

- T001, T002, T005 are independent row edits; T003 blocks T004; T006 blocks T007
- T008/T009 after their subjects (T001–T007); T010 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: On a coarse pointer, a non-ghost row with an owned PR shows the rest-state PR glyph at rest (correct `prGlyphColor` token, state-picked icon); ghost rows show none — verified: `coarse:hidden` removed (window-row.tsx), gate/color/icon untouched; unit (`coarse pointer: … (ys3q)` keeps glyph + `text-accent-green`) + e2e (`rest PR glyph is visible …`) pass; ghost gate `!ghost && prOwnsGlyph(win)` intact
- [x] A-002 R2: On a coarse pointer, no pin or kill button exists in the row DOM at rest; the `group/icons` container still anchors the glyph overlay — verified: render-gated `{showPinIcon && !coarse &&` / `{!coarse &&`; unit asserts absence from DOM + container still mounts; e2e asserts `toHaveCount(0)`
- [x] A-003 R3: The flyout card renders Pin and Kill action rows when handlers are wired, none when not; Kill routes to the existing `KillDialog` confirm path with no force-kill; Pin closes the card and opens `PinPopover` — verified: optional-handler gating + `stopPropagation` unit-tested; e2e proves kill opens "Kill window?" with zero kill POSTs and pin closes card → opens `PinPopover` dialog
- [x] A-004 R4: The coarse tap zone is ≥32×36px, centered dot, `touch-action: none`; fine-pointer geometry byte-identical — verified: `coarse:min-w-[32px] coarse:min-h-[36px] coarse:justify-center coarse:touch-none`, base classes unchanged; e2e measures bounding box ≥32×36
- [x] A-005 R5: Pointerdown on the zone opens the card and captures the pointer; sliding across rows retargets the single-open card; release keeps the last card open — verified: unit (pointerdown/pointermove/pointerup with stubbed `elementFromPoint`) + e2e (`scrub: press + slide retargets …`) pass

### Behavioral Correctness

- [x] A-006 R1: Fine-pointer glyph swap (hover / focus-within → hidden, ✕ revealed) is unchanged — verified: `group-hover:hidden group-has-[:focus-visible]/icons:hidden` retained; fine-pointer e2e describe (rest glyph → hover swap) passes
- [x] A-007 R2: Fine-pointer cluster rest/hover/focus behavior is unchanged (rest `[pin][PR]` → hover `[pin][✕]`, zero layout shift, reserved right padding unchanged) — verified: only the coarse classes were removed; `pr-[68px]`/`pr-11` untouched; fine-pointer unit + e2e pass
- [x] A-008 R5: The scrub never selects or navigates a row, never closes the drawer on release, and drags starting outside the zone still scroll the drawer — verified: `onSelectWindow` never called (unit); e2e asserts URL unchanged + drawer visible after release; `coarse:touch-none` scoped to the zone only

### Scenario Coverage

- [x] A-009 R5: Mid-scrub passes over non-row elements leave the current card open (no flicker-close); suppressed rows (ghost, open popover) are skipped — verified: `scrubTargetAt` returns null on non-row hits (unit); suppressed rows skipped via `openNow()`'s existing `suppressed` early-return (registry re-registers on gate flip); ghost-row pointerdown test passes
- [x] A-010 R3: Action rows are Tab-reachable from the focused row on desktop (FloatingFocusManager order), and activating them never selects the underlying row — verified: rows are plain `<button>`s inside the card content under the existing `FloatingFocusManager order={["reference","content"]}`; `stopPropagation` asserted in unit tests
- [x] A-011 R6: `row-flyout.spec.ts` + `row-flyout.spec.md` updated in the same commit; stale coarse assertions updated; e2e run through `just test-e2e` / `just pw` only — verified: both files changed together; the old "no rest glyph on coarse" test rewritten; every new `test()` documented in `.spec.md`; e2e run via `just test-e2e "row-flyout"` (11 passed, exit 0)

### Edge Cases & Error Handling

- [x] A-012 R5: A scrub gesture on a draggable row does not initiate HTML5 drag (dragstart suppressed while scrubbing; `touch-action: none` on the zone) — verified: `scrubActiveRef` guard in `onDragStart`; unit test proves suppression during scrub and normal drag after release
- [x] A-013 R5: Unmounting a row mid-scrub (SSE removal) does not strand the registry or the coordinator (unregister on unmount; existing unmount-while-open cleanup) — verified: registry effect's cleanup deletes the row's entry on unmount (unit-tested); pre-existing unmount-while-open coordinator release untouched

### Code Quality

- [x] A-014 Pattern consistency: new code follows the module-coordinator, optional-handler, and `stopPropagation` idioms of the surrounding files; comments state constraints, not narration — verified
- [x] A-015 No unnecessary duplication: reuses `useCoarsePointer`, the `activeFlyout` coordinator, `PinPopover`, `onKillClick`/`KillDialog`; no new kill/pin paths — verified
- [x] A-016 Render-performance invariants hold: `WindowRow` stays memo'd, no lifted flyout state, no per-second tick in rows, card mounts only while open — verified: registry is module state; the one `setReferenceEl` state set is a mount-time one-off (identical-node bail-out), not a tick
- [x] A-017 Type narrowing over assertions; no `as` casts introduced beyond the file's existing idiom — verified: `closest<HTMLElement>` generic, no new `as` in source (test-file stubs excepted, matching test idiom)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The two things it did obsolete (the coarse `coarse:opacity-100`/`coarse:min-*` cluster classes and the coarse dot-tap `onClick` handler in `window-row.tsx`) were removed by the change itself, not left behind.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Coarse cluster removal is render-gating (`!coarse`) on the two buttons, container retained for the glyph overlay | Intake offered class-removal vs render-gate as implementer's choice; render-gate satisfies "not hittable" structurally and keeps the a11y tree clean on touch | S:70 R:85 A:80 D:70 |
| 2 | Confident | Tap zone centers the dot on coarse (`coarse:justify-center`), accepting a small coarse-only name x-shift | Zone must grow around a 7px dot; centering is the only non-lopsided option; fine pointers untouched per intake | S:60 R:90 A:80 D:75 |
| 3 | Confident | Registry is element-keyed (`Map<HTMLElement, () => void>`), populated via an effect on the reference element; hit-test uses `closest()` to the row root | `rowKey` is optional so element identity is the only always-present key; matches the module-coordinator pattern | S:60 R:80 A:75 D:70 |
| 4 | Certain | Kill row passes `ctrl: false` (always confirm); Pin row = close card + open `PinPopover` | Explicit in intake decisions 2 + assumptions 10–11 | S:85 R:85 A:90 D:90 |
| 5 | Confident | Action rows sit below the freshness line as the card's last block; Pin label reflects `isPinnedToAny` threaded with the handler | Intake says "below the registers/links"; pin-state label is the intake's "label reflects pin state" with the cheapest existing input | S:55 R:85 A:75 D:70 |
| 6 | Confident | Drag conflict handled by suppressing `dragstart` while a scrub is active (plus `touch-action: none`) | HTML5 drag on touch is browser-dependent; an explicit guard makes the contract testable instead of incidental | S:50 R:85 A:70 D:65 |

6 assumptions (1 certain, 5 confident, 0 tentative).
