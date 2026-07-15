# Plan: Top-Bar Overflow Chevron Menu

**Change**: 260715-h1ck-top-bar-overflow-chevron-menu
**Intake**: `intake.md`

## Requirements

<!-- Derived from intake.md What-Changes areas 1–8. Frontend-only
     (app/frontend/src/). No Go/backend changes, no new dependencies. -->

### Top Bar: Overflow Fit Logic

#### R1: Pure fit computation
The frontend SHALL provide a pure function `computeVisibleCount(availableWidth, itemWidths, reservedWidth)` in `src/lib/top-bar-overflow.ts` that returns how many of the ordered non-exempt right-cluster items fit in `availableWidth` after subtracting `reservedWidth` (space for exempt items + chevron + dot + inter-item gaps). Items are consumed FROM THE FRONT of the ordered list (index 0 first), so the count returned is the number of leading items that fit; the remainder overflow.

- **GIVEN** `availableWidth` is large enough for every item plus reserved space
- **WHEN** `computeVisibleCount` is called
- **THEN** it returns `itemWidths.length` (all items fit)
- **AND GIVEN** `availableWidth` is 0 or less than `reservedWidth`
- **WHEN** called
- **THEN** it returns 0 (nothing fits; everything overflows)
- **AND GIVEN** `availableWidth` fits only the first K items' widths + gaps after reserving space
- **WHEN** called
- **THEN** it returns K

#### R2: No hardcoded widths / measured child widths
`computeVisibleCount` SHALL operate on measured actual child widths passed by the caller (never hardcoded pixel constants), and SHALL account for the inter-item gap between rendered items.

- **GIVEN** item widths vary (ViewSwitcher, UpdateChip, `coarse:` sizing)
- **WHEN** the caller measures each child's real width and passes the array
- **THEN** the fit result reflects those real widths, not a fixed 24px assumption

### Top Bar: Registry Architecture

#### R3: Ordered control registry
The right-cluster controls SHALL be described by an ordered registry (one entry per control) replacing the hardcoded JSX sequence in `top-bar.tsx`. Each entry declares `{ id, tier, modes, exempt?, barRender, menuRender, hidden? }`, where `tier` is `"L1" | "L2" | "L3"`, `modes` is the set of `TopBarMode`s the control appears in, `exempt` marks never-overflow items, `barRender` renders the in-bar button, `menuRender` renders the menu row, and `hidden` is an optional per-item opt-out predicate. Registry order encodes drop priority.

- **GIVEN** the registry is the single ordered source
- **WHEN** the bar renders
- **THEN** the first N non-exempt items render as buttons and the rest render as menu rows, both derived from the one registry
- **AND** exempt items (ViewSwitcher, dot, chevron) always render in the bar regardless of N

#### R4: Registry mode + hidden filtering
The registry SHALL filter entries by the active `TopBarMode` (an entry renders only when the current mode is in its `modes` set) and by its optional `hidden` predicate (an entry with `hidden` returning true renders nowhere — not in the bar, not in the menu).

- **GIVEN** the mode is `cockpit`
- **WHEN** the registry is filtered
- **THEN** only L3 controls (Notification, Theme, Refresh, Help) are candidates; L1/L2 (splits, fixed-width, Aa, close, autofit) are excluded
- **AND GIVEN** an entry's `hidden` predicate returns true (e.g. NotificationControl when push unsupported)
- **THEN** that entry is absent from both bar and menu

#### R5: Drop order = pyramid consumed from the left
Overflow SHALL consume the pyramid from the left: L1 first (SplitButton vertical, SplitButton horizontal, FixedWidthToggle), then L2 (TerminalFontControl, BoardAutofitToggle, ClosePaneButton), then L3 last (UpdateChip, NotificationControl, ThemeToggle, RefreshButton, HelpLink). Within a tier, the leftmost (earliest registry index) drops first. Surviving in-bar buttons SHALL keep their exact screen positions (the pyramid invariant).

- **GIVEN** width pressure drops exactly one control
- **WHEN** the bar re-fits
- **THEN** the dropped control is the leftmost L1 control, and every surviving control keeps its prior screen position
- **AND GIVEN** enough pressure to drop L1 entirely
- **THEN** L2 controls begin dropping only after all L1 controls have overflowed

### Top Bar: Overflow Chevron Button

#### R6: Always-visible chevron left of the dot
A down-chevron icon button SHALL render in the right cluster at ALL breakpoints and in all four page modes, positioned immediately left of the connection dot (the dot keeps its right-most status-terminator role). It follows the top-bar icon-button convention (`rk-glint`, bordered chip, `min-w-[24px] min-h-[24px] coarse:min-w-[30px] coarse:min-h-[30px]`), and carries `aria-haspopup`, `aria-expanded`, and an `aria-label` (e.g. "More controls"). The chevron renders even when nothing is overflowed (the menu always holds the fixed version row).

- **GIVEN** any page mode and any viewport width
- **WHEN** the top bar renders
- **THEN** the chevron button is present, and the connection dot is the last element after it
- **AND GIVEN** nothing is currently overflowed
- **THEN** the chevron still renders (never conditionally removed)

#### R7: Chevron attention badge
When the overflow menu contains attention-bearing overflowed items (today: the UpdateChip with a qualifying, undismissed update), the chevron SHALL carry a small accent dot/badge so the attention signal is not lost when the chip is hidden into the menu.

- **GIVEN** a qualifying undismissed update is pending AND the UpdateChip is currently overflowed into the menu
- **WHEN** the chevron renders
- **THEN** it shows an accent attention badge
- **AND GIVEN** the UpdateChip is visible in the bar (not overflowed), or no qualifying update
- **THEN** the chevron shows no badge

### Top Bar: Overflow Menu

#### R8: Menu a11y mirrors BreadcrumbDropdown
The overflow menu SHALL be a dropdown panel anchored to the chevron following the existing dropdown a11y conventions (mirroring `breadcrumb-dropdown.tsx`): `role="menu"` on the panel, `role="menuitem"` on rows, Escape closes and returns focus to the chevron, ArrowUp/ArrowDown move focus between rows, outside `mousedown` closes. It SHALL position without adding a new dependency (fixed-positioning anchored to the trigger rect, mirroring `BreadcrumbDropdown`).

- **GIVEN** the menu is open
- **WHEN** the user presses Escape
- **THEN** the menu closes and focus returns to the chevron
- **AND WHEN** the user presses ArrowDown/ArrowUp
- **THEN** focus moves between menu rows
- **AND WHEN** the user clicks outside the menu
- **THEN** the menu closes

#### R9: Menu contents and order
The menu SHALL list, top to bottom: (1) the overflowed controls as labeled menu rows in pyramid order (same order as the registry), then (2) a fixed version row that is always last and always present.

- **GIVEN** three controls are overflowed
- **WHEN** the menu opens
- **THEN** it shows exactly those three rows in pyramid order, followed by the version row
- **AND GIVEN** nothing is overflowed
- **THEN** the menu shows only the version row

### Top Bar: Version Row

#### R10: Fixed version row + copy
The version row SHALL render `Run Kit v{version}` using `daemonVersion` from `useUpdateNotification()` formatted via `displayVersion()`. Clicking it copies the displayed form to the clipboard (via `copyToClipboard`) with a success/error toast — matching the existing `buildVersionAction` palette behavior. When `daemonVersion` is null (no `event: version` yet) the row SHALL show plain `Run Kit` (never `vundefined`).

- **GIVEN** `daemonVersion` is `"0.6.2"`
- **WHEN** the version row renders
- **THEN** it shows `Run Kit v0.6.2`
- **AND WHEN** clicked
- **THEN** `copyToClipboard("v0.6.2")` runs and a success/error toast appears
- **AND GIVEN** `daemonVersion` is null
- **THEN** the row shows plain `Run Kit` (no `v`, no `undefined`)

#### R11: Version row as update surface
When a qualifying update is pending AND the UpdateChip is currently overflowed into the menu, the version row SHALL become the update surface: it displays `Run Kit v{current} → v{latest} ⬆` and clicking it triggers the update (same `updateNow()` path as the chip) instead of copying. When the UpdateChip is visible in the bar (not overflowed), the version row keeps its plain copy behavior and the UpdateChip has no separate menu row.

- **GIVEN** a qualifying update AND the UpdateChip is overflowed
- **WHEN** the version row renders
- **THEN** it shows `Run Kit v{current} → v{latest} ⬆` and clicking it calls `updateNow()`
- **AND** there is NO separate UpdateChip row in the menu (its function merged into the version row)
- **AND GIVEN** the UpdateChip is NOT overflowed (visible in the bar)
- **THEN** the version row is the plain copy row

### Top Bar: Menu-Row Representations

#### R12: Per-control menu-row mapping
Each overflowed control SHALL render as a labeled menu row per this mapping: SplitButton → "Split vertical" / "Split horizontal" (two rows); FixedWidthToggle → "Fixed width" checkbox row (`role="menuitemcheckbox"` with checked state); TerminalFontControl → a single row with inline `−`/`+` steppers operating on `terminalFontSize` (bounds `TERMINAL_FONT_BOUNDS`, does NOT open the Aa popover); BoardAutofitToggle → "Autofit panes" checkbox row (board mode only, only when `onToggleAutofit` present); ClosePaneButton → "Close pane" (terminal) / "Unpin pane" (board) row honoring the same disabled conditions; NotificationControl → flattened direct rows ("Enable notifications" / "Send test notification" per subscription state); ThemeToggle → "Theme: {current}" row cycling system/light/dark; RefreshButton → "Refresh page" row (Shift+click force-reload preserved); HelpLink → "Help / Documentation" external link row.

- **GIVEN** each control is overflowed
- **WHEN** the menu renders its row
- **THEN** the row carries the mapped label and invokes the same underlying action as the in-bar button
- **AND** the FixedWidthToggle and BoardAutofitToggle rows expose pressed/checked state
- **AND** the TerminalFontControl row steps the font inline without opening the popover

### Top Bar: Measurement Wiring & Squeezable Track

#### R13: Right-cluster min-w-0 + ResizeObserver
The right-cluster grid item SHALL be given `min-w-0` so its `1fr` grid track becomes squeezable (this change relies on q8ey's left/center min-width floors already present). A single `ResizeObserver` SHALL observe the right cell and drive re-fitting via `computeVisibleCount`, measuring actual child widths. Initial render SHALL be collapse-first (measure in `useLayoutEffect` before paint, or render collapsed first) to avoid a visible flash of overflowing buttons.

- **GIVEN** the right cell resizes (window resize, sidebar toggle, heading length change)
- **WHEN** the ResizeObserver fires
- **THEN** the visible count recomputes and the bar re-fits without oscillation
- **AND GIVEN** first paint
- **THEN** no flash of overflowing buttons is shown before the fit settles

#### R14: Remove the `hidden sm:flex` cliff
The per-item `hidden sm:flex` breakpoint gating SHALL be removed from the right-cluster controls; below `sm`, controls overflow into the menu like at any other width rather than vanishing. Per-item opt-out remains available via the registry `hidden` predicate. The UpdateChip's and NotificationControl's self-carried `hidden sm:flex` (the empty-flex-item gap hack) SHALL be replaced by registry-driven rendering.

- **GIVEN** a viewport below `sm` (e.g. 375px)
- **WHEN** the top bar renders
- **THEN** controls that previously vanished (theme, refresh, help, splits) are reachable via the chevron menu
- **AND** no empty flex item / double-gap remains where a self-hiding control was

### Non-Goals

- No changes to the bottom bar (mobile terminal toolbar) or sidebar.
- No new palette actions; no removal of existing ones (Constitution V keyboard path unchanged — the palette already exposes every affected action).
- No change to the left breadcrumb / center heading beyond what q8ey ships.
- No settings/config surface for customizing the order.
- No new route (Constitution IV — a dropdown, not a page).
- No new dependency (menu positioning mirrors `BreadcrumbDropdown`).

### Design Decisions

1. **Pure fit lib + colocated Vitest test**: `computeVisibleCount` lives in `src/lib/top-bar-overflow.ts` with `top-bar-overflow.test.ts` — *Why*: matches the `lib/palette-*.ts` pure-helper pattern, unit-testable without mounting the shell — *Rejected*: inlining the math in the component (untestable, mixed with DOM measurement).
2. **Registry entries expose `barRender`/`menuRender` closures**: each control renders itself both ways — *Why*: one ordered source drives bar + menu, kills the hardcoded JSX sequence and the per-item `hidden sm:flex` hack — *Rejected*: two parallel lists (bar list + menu list) that could drift.
3. **Version-row-as-update-surface only when the chip is overflowed**: — *Why*: preserves the ambient-chip affordance when it fits, and prevents losing the update signal when it doesn't; the chevron badge carries attention — *Rejected*: a permanent separate update menu row (duplicates the chip when it's visible in the bar).
4. **Aa becomes an inline `−/+` stepper row** rather than reopening the popover — *Why*: avoids a nested popover-inside-menu interaction — *Rejected*: a menu row that reopens the Aa popover (awkward nested dismiss semantics).

## Tasks

### Phase 1: Pure Fit Lib

- [x] T001 Create `src/lib/top-bar-overflow.ts` exporting `computeVisibleCount(availableWidth: number, itemWidths: number[], reservedWidth: number, gap: number): number` — front-consuming fit: reserve `reservedWidth`, then greedily fit leading items with `gap` between rendered items; clamp to `[0, itemWidths.length]`; return 0 for non-positive available budget. <!-- R1 R2 -->
- [x] T002 [P] Create `src/lib/top-bar-overflow.test.ts` (Vitest) covering: all fit, none fit (zero/negative width, width < reserved), partial fit (first K), exempt/reserved-space reservation, gap accounting. <!-- R1 R2 -->

### Phase 2: Registry Types & Data

- [x] T003 In `src/components/top-bar.tsx`, define the registry entry type `{ id, tier: "L1"|"L2"|"L3", modes: TopBarMode[], exempt?: boolean, hidden?: boolean, barRender: () => ReactNode, menuRender: (ctx) => ReactNode }` and build the ordered registry from the existing controls in pyramid order (L1 splits+fixed-width, L2 Aa+autofit+close, L3 update+notification+theme+refresh+help), with ViewSwitcher + chevron + dot marked exempt. <!-- R3 R5 -->
- [x] T004 Implement registry mode-filtering + `hidden`-predicate filtering (NotificationControl hidden when push unsupported; splits/fixed-width terminal-only; Aa/close terminal||board; autofit board-only when `onToggleAutofit`). <!-- R4 -->

### Phase 3: Menu Component & Rows

- [x] T005 Create `src/components/top-bar-overflow-menu.tsx` — the chevron button (R6, always-visible, left of dot, icon-button convention, `aria-haspopup`/`aria-expanded`/`aria-label`) + the anchored dropdown panel with `role="menu"`, mirroring `breadcrumb-dropdown.tsx` a11y (Escape→refocus chevron, ArrowUp/Down, outside `mousedown` close, fixed positioning to trigger rect). Renders overflowed rows (passed in) then the version row. Carries the attention badge when signaled. <!-- R6 R7 R8 R9 -->
- [x] T006 Implement the fixed version row inside the menu component: `Run Kit v{version}` via `displayVersion(daemonVersion)`; plain `Run Kit` when null; click copies displayed form via `copyToClipboard` + success/error toast (mirroring app.tsx `buildVersionAction` body). <!-- R10 -->
- [x] T007 Implement version-row update-surface mode: when a qualifying update is pending AND UpdateChip is overflowed, render `Run Kit v{current} → v{latest} ⬆` and wire click to `updateNow()` (with failure toast, mirroring UpdateChip); suppress any separate UpdateChip menu row in this case. <!-- R11 --> <!-- rework: M5 — update-click handler duplicates UpdateChip's updating-state+catch/toast (top-bar-overflow-menu.tsx:194-201 vs top-bar.tsx:2123-2134); extract a shared update-click handler so bar↔menu can't drift (A-021 parsimony duplicated-logic) -->
- [x] T008 Implement per-control `menuRender` rows in the registry (T003): Split vertical / Split horizontal; Fixed width (`role="menuitemcheckbox"`, checked=fixedWidth); Terminal font inline `−`/`+` stepper row (bounds `TERMINAL_FONT_BOUNDS`, disables at edges, no popover); Autofit panes checkbox row; Close pane / Unpin pane row (same disabled conditions); Enable notifications / Send test notification flattened rows; Theme: {current} cycle row; Refresh page row (Shift+click force-reload); Help / Documentation external link row. <!-- R12 --> <!-- rework: M5 — ThemeMenuRow.cycle duplicates ThemeToggle.handleClick branch (top-bar.tsx:2593-2597 vs :1675-1683); extract a shared cycleTheme(). should-fix S1 — stepper −/+ must NOT auto-close the menu (close only on role=menuitem/menuitemcheckbox targets, not any [data-menu-row] click) -->
- [x] T014 Add the Playwright width-sweep e2e spec `app/frontend/tests/e2e/top-bar-overflow.spec.ts` + sibling `.spec.md` (Constitution § Test Companion Docs — MANDATORY for any new `.spec.ts`): width sweep (e.g. 1280→1024→800→700→640→500→375) asserting (a) no bounding-box overlap, (b) L1 drops before L2 before L3, (c) the chevron menu contains exactly the dropped controls + version row, (d) version row copies to clipboard, (e) exempt items (ViewSwitcher when multi-view, dot, chevron) always visible, (f) a menu action (e.g. theme cycle) works from the menu. Reuse the `top-bar-overlap.spec.ts` sweep pattern. This spec is the regression proof for the M1 fit-wiring fix — it MUST fail before the M1 fix and pass after. <!-- R1 R5 R6 R8 R13 R14 -->
<!-- rework: T007/T008 unchecked for M5 duplication + S1 stepper auto-close; T014 added for M4 missing width-sweep e2e + .spec.md -->


### Phase 4: Integration — Right Cluster Rewrite

- [x] T009 Rewrite the right-cluster JSX in `top-bar.tsx` to render from the registry: give the right grid item `min-w-0`; render ViewSwitcher (exempt) + first N in-bar buttons + the chevron/menu + the dot; move the remaining (overflowed) entries' `menuRender` into the menu. Remove the per-item `hidden sm:flex` wrappers and the UpdateChip/NotificationControl self-carried `hidden sm:flex` (now registry-driven). <!-- R3 R6 R13 R14 --> <!-- rework: M2 — UpdateChip STILL self-carries `hidden sm:flex` (top-bar.tsx:2137) and NotificationControl `hidden sm:inline-flex` (:2237); below sm they render display:none yet the registry counts them as in-bar → in neither bar nor menu, and their probe copies measure 0 width. Remove these two remnants so gating is 100% registry-driven (R14/A-014). M1 also needs the measured cell to fill the 1fr track (see T010). -->
- [x] T010 Add the measurement hook/effect in `top-bar.tsx` (or `src/hooks/use-top-bar-overflow.ts`): one `ResizeObserver` on the right cell, measure exempt + candidate child widths, compute `reservedWidth` (exempt items + chevron + dot + gaps), call `computeVisibleCount`, drive `visibleCount` state; collapse-first initial render via `useLayoutEffect` to avoid flash; no hysteresis. <!-- R13 --> <!-- rework: M1 (CRITICAL) — the measured right cell keeps `justify-self-end`, so in CSS Grid it sizes to its OWN content, not the `1fr` track. With collapse-first visibleCount=0 the cell measures only ViewSwitcher+chevron+dot → budget = clientWidth − reserved < 0 → count deadlocks at 0 forever, and the RO never fires on window resize (content-sized box). Feature is non-functional at every width in a real browser. Fix: let the cell fill the track (drop `justify-self-end`, right-align content via `justify-content:flex-end`) OR measure a stretched wrapper. Verify with the T014 width-sweep e2e + tsc/vitest. should-fix S2 — measure effect deps `[candidateKey, mode]` + RO-on-cell-only miss reserved/exempt width changes (ViewSwitcher segment count, UpdateChip width on `latest` change); observe exempt/probe nodes too or add driving props to deps. -->
- [x] T011 Wire the attention signal: compute "UpdateChip overflowed AND qualifying undismissed update" and pass it to the chevron badge (R7) and to the version-row update-surface (R11). <!-- R7 R11 -->

### Phase 5: Tests

- [x] T012 Update/extend `src/components/top-bar.test.tsx`: chevron always present (all modes) and left of the dot; menu opens and lists overflowed rows + version row; a menu action works (e.g. Theme cycle, Refresh page); exempt items (ViewSwitcher when multi-view, dot, chevron) always visible. Adjust any existing assertions that keyed on `hidden sm:flex` wrappers now removed. <!-- R6 R8 R9 R12 R14 --> <!-- rework: M3 — existing e2e specs assert the OLD in-bar/flat structure and were not updated (only unit tests were). Update these to the new registry/overflow structure: tests/e2e/top-bar-refresh.spec.ts:124 (in-bar Close-pane anchor — confirmed failing) and :143-166 (wrapper-adjacency + `cluster.lastElementChild === dot` — nested trailing block now); tests/e2e/board-autofit.spec.ts:62 and tests/e2e/board-unpin-focused.spec.ts:69 (buttons now overflowed on narrow viewports); tests/e2e/mobile-layout.spec.ts:27-34 (theme visibility). Update each sibling `.spec.md` in the same commit. These must go green only AFTER the M1 fit fix. -->

- [x] T013 [P] Extend `src/components/update-chip.test.tsx` (or top-bar tests) for version-row states: plain `Run Kit` when version null; `Run Kit v{version}` + copy when known; `Run Kit v{current} → v{latest} ⬆` + `updateNow()` when update pending and chip overflowed. <!-- R10 R11 -->

## Execution Order

- T001 blocks T002 (test imports the function) and T010 (measurement calls it).
- T003 blocks T004, T008, T009 (registry shape is the contract).
- T005/T006/T007 block T009 (the menu component is rendered by the right cluster).
- T009 blocks T010/T011 (measurement + attention wire into the rewritten cluster).
- T012/T013 run after Phase 4.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `computeVisibleCount` returns all-fit / none-fit / partial-K correctly, covered by `top-bar-overflow.test.ts`.
- [x] A-002 R2: `computeVisibleCount` uses caller-supplied measured widths + gap, no hardcoded pixel width; verified by tests passing varied widths.
- [x] A-003 R3: The right cluster renders from one ordered registry driving both bar buttons and menu rows (no parallel hardcoded JSX sequence remains).
- [x] A-004 R4: Registry filters by mode and by the `hidden` predicate — cockpit shows only L3 candidates; NotificationControl absent when push unsupported.
- [x] A-005 R5: Drop order consumes L1→L2→L3 from the left; surviving buttons keep screen position. (Re-verified after rework: the right cell now fills its `1fr` track — `justify-self-end` dropped, content right-aligned via `justify-end` — and the width-sweep e2e `top-bar-overflow.spec.ts` proves in-bar controls at 1280px, monotonic tier-by-tier drop L1→L2→L3, and full overflow at 375px; 5/5 passed via `just test-e2e`.)
- [x] A-006 R6: The chevron renders in all four modes at all widths, immediately left of the dot, with `aria-haspopup`/`aria-expanded`/`aria-label`, even when nothing overflows.
- [x] A-007 R7: The chevron shows an attention badge when a qualifying undismissed update exists AND the UpdateChip is overflowed; none otherwise.
- [x] A-008 R8: The menu has `role="menu"`/`menuitem`, closes on Escape (refocusing the chevron), moves focus on ArrowUp/Down, and closes on outside click.
- [x] A-009 R9: The menu lists overflowed controls in pyramid order then the always-present version row (only the version row when nothing overflows).
- [x] A-010 R10: The version row shows `Run Kit v{version}` (plain `Run Kit` when null) and copies the displayed form with a success/error toast on click.
- [x] A-011 R11: When a qualifying update is pending and the chip is overflowed, the version row shows `Run Kit v{current} → v{latest} ⬆`, triggers `updateNow()` on click, and no separate UpdateChip row appears.
- [x] A-012 R12: Each overflowed control renders its mapped menu row invoking the same action (splits, fixed-width checkbox, inline font stepper, autofit checkbox, close/unpin, notification rows, theme cycle, refresh page, help link). (S1 resolved: the menu-close handler keys on `role="menuitem"`/`menuitemcheckbox` targets only — the font stepper row is a `role="group"`, so −/+ steps no longer close the menu.)

### Behavioral Correctness

- [x] A-013 R13: The right grid item has `min-w-0`; a `ResizeObserver` re-fits on resize using measured widths with no oscillation; first paint shows no flash of overflowing buttons. (Re-verified after rework: the cell fills the `1fr` track and the RO observes the cell + probe + ViewSwitcher + trailing exempt block, so reserved/candidate width changes re-fit too (S2); collapse-first via `useState(0)` + `useLayoutEffect`; the width-sweep e2e re-fits across 7 viewport sizes with no oscillation observed.)
- [x] A-014 R14: Below `sm`, controls overflow into the menu instead of vanishing; the `hidden sm:flex` cliff and the UpdateChip/NotificationControl empty-flex-item hack are gone; per-item `hidden` opt-out remains available. (Re-verified after rework: `grep 'hidden sm:'` over the right-cluster controls is clean — the only remaining matches are pre-existing left/center heading elements; UpdateChip and NotificationControl gating is 100% registry-driven, and `mobile-layout.spec.ts` proves theme is menu-reachable at 375px.)

### Scenario Coverage

- [x] A-015 R1: `top-bar-overflow.test.ts` exercises zero width, all fit, partial fit, exempt reservation, gap accounting.
- [x] A-016 R6 R8 R9 R12: `top-bar.test.tsx` exercises chevron presence, menu open, a working menu action, exempt-item visibility.
- [x] A-017 R10 R11: version-row plain / update-pending / unknown-version states are covered by unit tests.

### Edge Cases & Error Handling

- [x] A-018 R10: Version unknown (no `event: version`) renders plain `Run Kit`, never `vundefined`.
- [x] A-019 R11: Update failure from the version-row surface re-enables and toasts (mirrors the chip's failure path). (Now structurally guaranteed: both surfaces consume the shared `useUpdateClick()` hook — the updating-state + catch/toast is one implementation, not a mirrored copy.)

### Code Quality

- [x] A-020 Pattern consistency: new code follows the `lib/palette-*.ts` pure-helper pattern and `breadcrumb-dropdown.tsx` menu-a11y pattern; icon buttons follow the `rk-glint` + `coarse:` convention.
- [x] A-021 No unnecessary duplication: reuses `displayVersion`, `copyToClipboard`, `useUpdateNotification`, `TERMINAL_FONT_BOUNDS`, and existing control internals rather than reimplementing. (Re-verified after rework: the theme cycle is a single shared `cycleTheme()` (top-bar.tsx:1707) consumed by both ThemeToggle and ThemeMenuRow, and the update-click behavior is the shared `useUpdateClick()` hook (src/hooks/use-update-click.ts) consumed by both UpdateChip and the version-row update surface — M5 resolved.)
- [x] A-022 Type narrowing over assertions: registry/menu code prefers guards and discriminated unions over `as` casts (frontend code-quality principle).
- [x] A-023 No new dependency: menu positioning mirrors `BreadcrumbDropdown`; no floating-ui or other package added.
- [x] A-024 Tests included: new/changed behavior is covered by Vitest (`top-bar-overflow.test.ts` + touched `*.test.tsx`); `npx tsc --noEmit` passes. (116 tests green, tsc clean. jsdom's zero widths still mean the Vitest layer cannot catch fit-wiring defects — that gap is now closed at the e2e layer by `top-bar-overflow.spec.ts` (M4), the width-sweep regression proof, which passes along with the four updated specs.)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Playwright e2e width-sweep coverage (intake §8) is deferred to the reviewer's spot-checks / a follow-up (`just test-e2e` only, not run at apply per the block contract); the unit tests above cover the pure fit math and the menu contract.

## Deletion Candidates

- `top-bar.tsx:1322` + `:1378-1385` (WindowHeading `prevPrefixRef` + prefix-keyed replay effect) — pre-existing inert machinery (the sole call site has passed the constant `WINDOW_PREFIX` since 260714-uco1, so the prefix-change branch never runs; already recorded as a deletion candidate in memory § window-heading); still standing, untouched by this change.

All four candidates from the prior review cycle were resolved by the rework: the UpdateChip/NotificationControl `hidden sm:` remnants were deleted (M2), and the stale wrapper-adjacency block in `top-bar-refresh.spec.ts` and the cliff-premised `mobile-layout.spec.ts` test were rewritten to the registry-driven structure (M3). No new code was made redundant by this change beyond the above carry-over.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Always-visible chevron with a fixed `Run Kit v{version}` menu row | User-specified verbatim in the intake; template/convention deterministic | S:95 R:90 A:95 D:95 |
| 2 | Certain | Drop order = L1→L2→L3 pyramid consumed from the left; surviving buttons never shift | Follows the documented pyramid invariant carried in intake assumption #2 | S:85 R:85 A:95 D:90 |
| 3 | Confident | Chevron placed immediately left of the connection dot (dot stays right-most terminator) | Preserves the documented dot invariant; accepted in the intake | S:65 R:90 A:80 D:70 |
| 4 | Confident | ViewSwitcher + dot + chevron exempt from overflow (registry `exempt` flag) | ViewSwitcher all-breakpoints visibility is a documented deliberate decision; intake assumption #4 | S:75 R:85 A:90 D:80 |
| 5 | Confident | Version row doubles as update surface only when the UpdateChip is overflowed; chevron carries an attention badge otherwise | Solves the lost-attention problem; intake assumption #5 | S:70 R:80 A:85 D:75 |
| 6 | Confident | `computeVisibleCount(availableWidth, itemWidths, reservedWidth, gap)` signature — added a `gap` param to the intake's 3-arg sketch so gap accounting is explicit and testable | The intake specifies "reserving space for … gaps"; making gap an explicit param keeps the function pure and unit-testable rather than baking a magic gap constant | S:70 R:90 A:85 D:75 |
| 7 | Confident | Registry `{id, tier, modes, exempt, hidden, barRender, menuRender}` replaces hardcoded JSX + per-item `hidden sm:flex` | Single ordered source for bar+menu; intake assumption #7 | S:70 R:70 A:85 D:75 |
| 8 | Confident | Below-`sm` cliff removed: all current controls become menu-reachable on mobile (no per-item touch-hostility opt-out applied initially) | Intake assumption #8 flags this as a deliberate win; the open question defaults to "include everything, revisit if a control proves touch-hostile" | S:65 R:75 A:80 D:70 |
| 9 | Confident | Menu positioning reuses `BreadcrumbDropdown`'s fixed-to-trigger-rect approach (no new dependency) | Intake explicitly prefers this over adding floating-ui; matches the existing dropdown escaping the nav clip context | S:70 R:85 A:90 D:80 |
| 10 | Confident | Chevron/menu live in a new `top-bar-overflow-menu.tsx`; measurement in `top-bar.tsx` (inline hook) rather than a separate `use-top-bar-overflow.ts` file | Intake lists the hook file as "possibly" — keeping measurement colocated with the cluster it drives avoids an extra indirection; still a pure `computeVisibleCount` boundary for testing | S:60 R:85 A:80 D:65 |
| 11 | Tentative | Aa terminal-font control becomes an inline `−/+` stepper row in the menu (not a popover reopen) | Avoids nested popover; intake assumption #9, one of two viable options | S:45 R:85 A:70 D:45 |
| 12 | Tentative | RefreshButton menu row labeled "Refresh page"; HelpLink row labeled "Help / Documentation" | Disambiguates from `Status: Refresh` (260715-jykd); exact label is the implementer's call per intake assumptions #10 and change-area 4 | S:50 R:95 A:80 D:60 |

12 assumptions (2 certain, 8 confident, 2 tentative).
