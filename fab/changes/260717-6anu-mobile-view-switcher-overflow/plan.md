# Plan: Mobile View-Switcher Overflow

**Change**: 260717-6anu-mobile-view-switcher-overflow
**Intake**: `intake.md`

## Requirements

<!-- Derived from intake.md. The change ends the ViewSwitcher's exemption from
     the 260715-h1ck priority+ overflow registry and represents it in the chevron
     menu as per-view rows. Frontend-only; no backend/API/route change. -->

### Top Bar: ViewSwitcher joins the overflow registry

#### R1: ViewSwitcher is the first overflow-registry candidate
The window-view `ViewSwitcher` pill SHALL be a registry `RegistryEntry` (`id: "view-switcher"`, `modes: ["terminal"]`) inserted as the **first** element of `rightItems` in `top-bar.tsx`, ahead of `split-vertical`. It MUST no longer render as a leading exempt control. Because overflow consumes candidates from the front, the pill keeps its current leftmost in-bar position and becomes the **first control to yield** under width pressure — before any L1 split.

- **GIVEN** a terminal-route window with more than one available view (e.g. `[tty|chat]`) at a wide viewport with room for the whole cluster
- **WHEN** the top bar renders
- **THEN** the ViewSwitcher pill renders in-bar in its current leftmost position, as a normal (non-exempt) candidate
- **AND** the surviving in-bar candidate set remains a suffix of the registry order (no change to `computeVisibleCount`)

#### R2: The registry `hidden` predicate mirrors the full current render gate
The `view-switcher` entry's `hidden` predicate MUST evaluate to the negation of the current render gate `mode === "terminal" && currentWindow && onSelectView && availableViews && availableViews.length > 1`, so a single-view (tty-only) window, or a non-terminal mode, or an unwired callback contributes **no** bar slot, menu row, or probe width.

- **GIVEN** a terminal window whose capability set is only `{tty}` (`availableViews.length <= 1`)
- **WHEN** the top bar renders
- **THEN** no ViewSwitcher pill renders in-bar, no `View:` menu row appears, and the measurement probe reserves no width for it
- **AND** a non-terminal mode (board/server/host) likewise renders no view-switcher candidate

#### R3: Exempt-pill machinery is removed; measurement simplifies
The leading exempt render block for the ViewSwitcher, the `viewSwitcherRef`, its term in the `reserved` computation, and its `ro.observe(viewSwitcherRef.current)` line MUST be removed. `reserved` MUST simplify to `trailing + RIGHT_GAP_PX`. The pill's width MUST be measured via the hidden probe row like every other candidate. The `availableViews`/`activeView` entries in the measure effect's dependency array MUST be retained (the pill's probe width still varies with segment count and the active segment).

- **GIVEN** the exempt-pill machinery is removed
- **WHEN** the measure effect runs
- **THEN** `reserved` accounts only for the trailing chevron+dot block plus one gap, and the ViewSwitcher's width is contributed by the probe row
- **AND** the ResizeObserver no longer observes a `viewSwitcherRef` node (that ref no longer exists)
- **AND** the trailing exempt block (chevron + connection dot) is unchanged

#### R4: Overflowed pill is represented as per-view menu rows
When the `view-switcher` entry overflows into the chevron menu, its `menuRender` MUST produce **one `role="menuitem"` row per available view**, labeled `View: {VIEW_LABEL[view]}` (`View: Terminal` / `View: Web` / `View: Chat`), rendered in the pill's fixed `DISPLAY_ORDER` (tty first). The **active** view's row MUST be visually marked with the accent-green treatment and expose active state via `aria-pressed` (or `aria-checked` on a `menuitemradio`). Clicking a row MUST call the same `onSelectView(view)` callback and close the menu.

- **GIVEN** a chat-capable terminal window at a narrow viewport where the pill has overflowed into the "More controls" menu
- **WHEN** the user opens the chevron menu
- **THEN** the menu lists `View: Terminal` and `View: Chat` rows in tty-first order, the active view's row is visually marked and carries the active aria state, and no in-bar pill is shown
- **AND** clicking a non-active row calls `onSelectView(view)` and closes the menu

#### R5: Lens identity while collapsed is carried by the marked row + view content (no new inline indicator)
While the pill is collapsed into the menu, the marked menu row plus the view content itself (chat bubbles vs. terminal) SHALL carry lens identity. No new inline lens indicator is added to the bar, and the center heading stays the static `Window:` prefix in every lens (spec R4 / 260714-uco1). Keyboard/palette parity (`Ctrl+\``, `Cmd+.`, `View:` palette actions) is untouched (Constitution V).

- **GIVEN** the pill is collapsed into the menu
- **WHEN** the user inspects the bar
- **THEN** the center heading still reads the static `Window: <window>`, no inline lens chip appears, and the lens is discoverable via the marked menu row and via the palette/keyboard affordances

### Spec: window-views.md R4 amendment

#### R6: Spec R4 records overflow participation
`docs/specs/window-views.md` R4 SHALL gain a sentence recording that the segmented chip participates in the right-cluster overflow registry (drops first, before L1) and is represented by per-view menu rows when collapsed. The "sole lens indicator" language SHALL gain a qualifier that, while collapsed, the marked menu row (plus the view content) carries lens identity — with no new inline lens indicator added.

- **GIVEN** the change ships
- **WHEN** a reader consults `docs/specs/window-views.md` R4
- **THEN** R4 documents the chip's overflow participation and the collapsed-state lens-identity qualifier, mirroring how it already records the 260714-uco1 heading reversal

### Non-Goals

- No change to lens semantics, `?view=` URL state, localStorage keys, default-view hints, or `window-view.ts`.
- No change to keyboard/palette parity (`Ctrl+\`` toggle, `Cmd+.` cycle, `View:` palette actions).
- No change to the heading's `max-w-[16ch]` mobile cap or the center-cell grid contract (260715-q8ey).
- The chevron + connection dot stay exempt; `lib/top-bar-overflow.ts` is untouched.
- No new inline lens indicator in the bar while the pill is collapsed.

### Design Decisions

1. **Space-driven overflow, not a hard mobile gate**: make the pill a registry candidate rather than adding a `hidden sm:*` + always-in-menu-on-mobile branch — *Why*: the stated goal is heading room, which space-driven delivers on any narrow viewport, and 260715-h1ck deliberately killed per-item breakpoint cliffs — *Rejected*: a hard mobile gate, which reintroduces the exact cliff pattern h1ck removed.
2. **Pill joins as the FIRST candidate**: keeps its leftmost display position and makes it the first control to yield — *Why*: preserves the front-consumption suffix invariant and leaves `computeVisibleCount` untouched; the pill is the widest control and every lens action has palette/keyboard parity — *Rejected*: a custom collapse order, which would complicate the proven measurement design.
3. **Menu form = per-view rows**: `View: Terminal/Web/Chat` rows, active marked, click switches lens + closes — *Why*: follows the `NotificationMenuRows` multi-row precedent and the palette's `View:` vocabulary; menu rows are action-shaped — *Rejected*: embedding the raw segmented pill in a menu row, which fights the menu's keyboard/ARIA model.
4. **`ViewSwitcherMenuRows` component placement**: colocated in `view-switcher.tsx` and imported into `top-bar.tsx` — *Why*: the label map (`VIEW_LABEL`), short glyphs, and `DISPLAY_ORDER` already live in `view-switcher.tsx`; keeping the menu-row form beside them avoids duplicating those constants or exporting them across files — *Rejected*: defining it inline in `top-bar.tsx` alongside `NotificationMenuRows`, which would require exporting `VIEW_LABEL`/`DISPLAY_ORDER`.

## Tasks

### Phase 1: Menu-row component

- [x] T001 Add a `ViewSwitcherMenuRows` component to `app/frontend/src/components/view-switcher.tsx`: props `{ views: ViewName[]; active: ViewName; onSelect: (view: ViewName) => void }`; render one `role="menuitem"` (or `menuitemradio`) row per available view in `DISPLAY_ORDER` (tty-first, unlisted views appended), label `View: {VIEW_LABEL[view]}`, the active row marked with the accent-green treatment + active aria state (`aria-pressed`/`aria-checked`), `tabIndex={-1}` per the menu-row convention, `onClick={() => onSelect(view)}`; return `null` when `views.length <= 1`. Match the existing `NotificationMenuRows` multi-row precedent and `MENU_ROW_CLASS` styling vocabulary. <!-- R4 -->

### Phase 2: Registry entry + exempt-machinery removal (top-bar.tsx)

- [x] T002 In `app/frontend/src/components/top-bar.tsx`, import `ViewSwitcherMenuRows` and insert a new `RegistryEntry` `{ id: "view-switcher", modes: ["terminal"], hidden: !(mode === "terminal" && currentWindow && onSelectView && availableViews && availableViews.length > 1), barRender: () => <ViewSwitcher …/>, menuRender: () => <ViewSwitcherMenuRows …/> }` as the FIRST element of `rightItems`, ahead of `split-vertical`. The `barRender` passes `views={availableViews ?? []}`/`active={activeView ?? "tty"}`/`onSelect={onSelectView ?? noop}` (safe under the `hidden` gate); `menuRender` passes the same. <!-- R1 R2 R4 -->
- [x] T003 In `app/frontend/src/components/top-bar.tsx`, remove the leading exempt ViewSwitcher render block (the `{mode === "terminal" && currentWindow && onSelectView && availableViews && availableViews.length > 1 && (<div ref={viewSwitcherRef}>…</div>)}` block in the right cell), the `viewSwitcherRef` declaration, its term in the `reserved` computation (simplify to `reserved = trailing + RIGHT_GAP_PX`), and the `if (viewSwitcherRef.current) ro.observe(viewSwitcherRef.current)` line. Retain `availableViews`/`activeView` in the measure effect's dependency array. Update the reserved-block comment to reflect that only the trailing chevron+dot block is reserved. <!-- R3 -->

### Phase 3: Spec + tests

- [x] T004 [P] Amend `docs/specs/window-views.md` R4: add one sentence recording the segmented chip's overflow-registry participation (drops first, before L1; per-view menu rows when collapsed) and add the "sole lens indicator" qualifier that the marked menu row + view content carry lens identity while collapsed, with no new inline indicator. <!-- R6 -->
- [x] T005 [P] Update `app/frontend/src/components/view-switcher.test.tsx`: add unit coverage for `ViewSwitcherMenuRows` (renders one row per view in DISPLAY_ORDER; active row marked + active aria state; click calls `onSelect(view)`; renders nothing for a single-view window). Update the existing "visible at all breakpoints" test only if the pill's `hidden sm:*`-absence claim is affected (it is not — the pill still has no `hidden` gate; the doc comment at `view-switcher.tsx:75-78` about "visible at ALL breakpoints" is now wrong and should be corrected in T001). <!-- R4 -->
- [x] T006 Update `app/frontend/tests/e2e/chat-view.spec.ts` (+ sibling `chat-view.spec.md`): rewrite the 375px "single-line top bar with chat toggle visible" test — at phone width with a realistically long window name the pill now lives in the "More controls" menu (assert the chevron menu carries the `View: Terminal`/`View: Chat` rows + heading room + single-line + no horizontal overflow), rather than asserting the inline `view-toggle` pill. Make the collapse deterministic via a long window name. <!-- R4 R5 -->
- [x] T007 Update `app/frontend/tests/e2e/web-view-lens.spec.ts` (+ sibling `web-view-lens.spec.md`): supersede the "switcher visible on mobile unlike its `hidden sm:*` siblings" assertion (375px) with the registry contract — at 375px with a long window name the pill overflows into the chevron menu (`View: Terminal`/`View: Web` rows), and at desktop it renders inline. Keep the no-horizontal-overflow and lens-render assertions. <!-- R1 R4 -->
- [x] T008 Extend `app/frontend/tests/e2e/top-bar-overflow.spec.ts` (+ sibling `top-bar-overflow.spec.md`) — the view-switcher candidate is terminal-only and gated on a multi-view window, so add coverage on a chat/web-capable window: the pill is the first-to-drop (it overflows before any L1 split as width shrinks), the menu carries the per-view `View:` rows, and activating a row switches the lens. Keep the existing pyramid-order sweep intact (the tty-only WINDOW_NAME window has no view-switcher candidate, so those tests are unaffected). <!-- R1 R4 -->

## Execution Order

- T001 blocks T002 (registry entry imports `ViewSwitcherMenuRows`).
- T002 and T003 both edit `top-bar.tsx` and are interdependent (add the registry entry, then remove the exempt machinery) — run T002 then T003 sequentially.
- T004, T005 are independent `[P]` (spec + unit test).
- T006, T007, T008 are e2e specs — run after T001–T003 land so the runtime behavior they assert exists.

## Acceptance

### Functional Completeness

- [x] A-001 R1: The `rightItems` registry in `top-bar.tsx` has a `view-switcher` entry (`modes: ["terminal"]`) as its FIRST element, ahead of `split-vertical`; the pill renders in-bar at a wide viewport in its leftmost position as a non-exempt candidate.
- [x] A-002 R2: The `view-switcher` entry's `hidden` predicate is the negation of the full current render gate (including `availableViews.length > 1`); a tty-only window and non-terminal modes render no view-switcher candidate (no bar slot, no menu row, no probe width).
- [x] A-003 R3: The leading exempt ViewSwitcher block, `viewSwitcherRef`, its `reserved` term, and its `ro.observe` line are removed; `reserved === trailing + RIGHT_GAP_PX`; `availableViews`/`activeView` remain in the measure-effect deps.
- [x] A-004 R4: `ViewSwitcherMenuRows` renders one `View: {label}` row per available view in DISPLAY_ORDER, marks the active row with active aria state, and click invokes `onSelectView(view)` + closes the menu.
- [x] A-005 R6: `docs/specs/window-views.md` R4 records the overflow-registry participation sentence and the collapsed-state lens-identity qualifier.

### Behavioral Correctness

- [x] A-006 R1: As the viewport narrows on a multi-view terminal window, the ViewSwitcher pill is the FIRST control to overflow into the chevron menu (before any L1 split), and surviving in-bar controls keep their positions (front-consumption suffix invariant preserved; `computeVisibleCount` unchanged).
- [x] A-007 R4: On a collapsed pill, opening the chevron menu shows the per-view `View:` rows with the active row marked; clicking a non-active row switches the lens and closes the menu.
- [x] A-008 R5: While the pill is collapsed, the center heading stays the static `Window: <window>`, no new inline lens indicator appears, and `Ctrl+\``/`Cmd+.`/`View:` palette parity is unchanged.

### Scenario Coverage

- [x] A-009 R4: `view-switcher.test.tsx` covers `ViewSwitcherMenuRows` (per-view rows in DISPLAY_ORDER, active marking, click callback, single-view null); `just test-frontend` is green.
- [x] A-010 R4: `chat-view.spec.ts` asserts the 375px collapsed-pill contract (menu rows + heading room + single-line + no overflow) and its `.spec.md` companion is updated in the same change.
- [x] A-011 R1: `web-view-lens.spec.ts` asserts the registry contract (375px overflow into menu, desktop inline) and its `.spec.md` companion is updated.
- [x] A-012 R1: `top-bar-overflow.spec.ts` covers the view-switcher first-to-drop ordering + per-view menu rows + row activation on a multi-view window; its `.spec.md` companion is updated.

### Edge Cases & Error Handling

- [x] A-013 R2: A single-view (tty-only) terminal window contributes no phantom probe width or empty menu row — the fit math and menu are unchanged from a bar with no view-switcher.

### Code Quality

- [x] A-014 Pattern consistency: `ViewSwitcherMenuRows` follows the `NotificationMenuRows`/`MENU_ROW_CLASS` menu-row conventions (`role="menuitem"`, `tabIndex={-1}`, shared styling) and the registry entry follows the existing `RegistryEntry` shape.
- [x] A-015 No unnecessary duplication: the menu-row form reuses the existing `VIEW_LABEL`/`DISPLAY_ORDER` from `view-switcher.tsx` and the shared `onSelectView` plumbing (no re-implemented label map or view logic); `lib/top-bar-overflow.ts` and `computeVisibleCount` are untouched.
- [x] A-016 Type check: `cd app/frontend && npx tsc --noEmit` is clean.
- [x] A-017 Test companion docs: every touched `*.spec.ts` has its sibling `*.spec.md` updated in the same change (Constitution — Test Companion Docs). (Rework cycle 1 fixed the four 1280px-vs-1440px step-line mismatches — top-bar-overflow.spec.md and web-view-lens.spec.md now say 1440px where the tests use 1440px, and the remaining 1280px mentions accurately describe the drop-threshold context.)
- [x] A-018 Stale doc comment removed: the `view-switcher.tsx` "visible at ALL breakpoints" doc comment (and the inline group-class comment) is corrected to reflect the new overflow-participation behavior.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- The affected memory file `docs/memory/run-kit/ui-patterns.md` is updated at HYDRATE, not apply — specifically the "visible at ALL breakpoints" claim (line ~331) and the exempt-set bullet (line ~843) become stale here.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (The exempt-pill machinery the change made redundant — the leading exempt render block, `viewSwitcherRef`, its `reserved` term, and its `ro.observe` line — was already removed by apply per R3. The residual stale exemption comments flagged in review cycle 1 — `top-bar.tsx`, `lib/top-bar-overflow.ts` — were corrected by rework cycle 1; no candidates remain.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Space-driven overflow (registry candidate) instead of a hard mobile breakpoint gate | Intake assumption #1; stated goal is heading room, delivered on any narrow viewport; 260715-h1ck killed per-item breakpoint cliffs; trivially reversible. | S:55 R:80 A:80 D:50 |
| 2 | Confident | Pill joins as the FIRST candidate — leftmost kept, first to drop before L1 | Intake assumption #2; preserves the front-consumption suffix invariant and leaves `computeVisibleCount` untouched; the pill is the widest control with full palette/keyboard parity. | S:50 R:85 A:75 D:60 |
| 3 | Confident | Menu form = per-view rows (`View: Terminal/Web/Chat`), active marked, click switches lens + closes | Intake assumption #3; follows `NotificationMenuRows` multi-row precedent + palette `View:` vocabulary; menu rows are action-shaped. | S:45 R:85 A:80 D:60 |
| 4 | Confident | `ViewSwitcherMenuRows` lives in `view-switcher.tsx` (colocated with `VIEW_LABEL`/`DISPLAY_ORDER`), imported into `top-bar.tsx` | Intake §2 defers file placement to implementation "matching where NotificationMenuRows lives"; colocating with the shared label/order constants avoids exporting them and matches the pure-presentational component's home. `NotificationMenuRows` lives in `top-bar.tsx`, but its data (`usePushSubscription`) also lives there, whereas the view label/order map lives in `view-switcher.tsx`. | S:45 R:80 A:70 D:55 |
| 5 | Confident | Active menu row marked via `aria-pressed` + accent-green treatment (matching the pill's active segment) | Intake §2 specifies "inverse-video accent-green treatment matching the pill's active segment" and "`aria-pressed`/equivalent"; `aria-pressed` matches the in-bar segment's existing aria. A `menuitemradio`+`aria-checked` set is the ARIA-canonical single-select alternative but diverges from the menu's existing `menuitem`/`menuitemcheckbox` vocabulary; `aria-pressed` on a `menuitem` mirrors the in-bar segment and the intake's explicit wording. | S:50 R:85 A:75 D:55 |
| 6 | Confident | Spec R4 gets a one-sentence amendment + qualifier recording overflow participation | Intake assumption #6; R4 already records change-driven reversals (260714-uco1); leaving it stale would contradict shipped behavior. | S:40 R:90 A:70 D:65 |
| 7 | Certain | Keyboard/palette parity untouched | Intake assumption #5; `Ctrl+\``, `Cmd+.`, `View:` palette actions live outside the bar; no in-scope code path touches them. | S:70 R:90 A:95 D:90 |

7 assumptions (1 certain, 6 confident, 0 tentative).
