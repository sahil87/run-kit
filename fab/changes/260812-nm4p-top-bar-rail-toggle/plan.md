# Plan: Top-Bar Right-Rail Toggle

**Change**: 260812-nm4p-top-bar-rail-toggle
**Intake**: `intake.md`

## Requirements

### Shell Layout: Full-Height Right Column

#### R1: Third grid column via an optional slot
`components/shell/shell.tsx` SHALL accept an optional `rightPanelChildren` prop (and the visibility flag R2 needs), mirroring the existing `sidebarChildren` slot pattern. When provided on desktop, the grid SHALL become `"sidebar content rightpanel" / "sidebar bottombar rightpanel"` with columns `${sidebarWidth}px 1fr auto` (rows stay `1fr auto`). When the prop is absent (board/host consumers, mobile), the grid SHALL be byte-identical to today's two-column layout.

- **GIVEN** a desktop terminal route with the right panel slot filled
- **WHEN** the shell renders
- **THEN** the rail (and any open panel) spans both grid rows — full height to the viewport bottom
- **AND** the bottom bar + compose strip occupy only the content column (nothing renders beneath the right column)

- **GIVEN** a board or host route (no `rightPanelChildren`)
- **WHEN** the shell renders
- **THEN** the two-column grid is unchanged

#### R2: Right column hides, never unmounts
The right column SHALL be gated by a visibility flag (`rightAreaVisible`, R5): when false the column collapses to zero width at display level while its children stay mounted. It MUST NOT copy the sidebar aside's unmount-on-collapse — the web/code iframes keep in-memory state per right-panel spec P3.

- **GIVEN** a panel open with a loaded iframe, then the rail collapsed via the toggle
- **WHEN** the right column hides
- **THEN** the iframe element remains in the DOM (`hidden`/zero-width, not unmounted)
- **AND** re-opening restores it without a reload

#### R3: Panel width math re-based off the shell container
`components/right-panel.tsx` SHALL size the panel in pixels (its grid column is `auto`), replacing the `width: N%`-of-parent model. The 280px floor / 65% cap (`clampPanelWidth`) SHALL resolve against the width of the content-plus-panel region (the shell container minus the sidebar column — the equivalent of today's content-row basis), measured via a seam that is NOT the panel's own `parentElement` (e.g. a ResizeObserver on the shell grid element passed by ref/context, or on the content `<main>`). The stored `runkit-panel-width` percentage semantics and `lib/right-panel.ts` clamp helpers stay; only the measurement basis and the applied CSS unit change. Drag-resize MUST keep working with the handle on the panel's left edge.

- **GIVEN** an open panel at 38% stored width on a desktop terminal route
- **WHEN** the user drags the resize handle left/right
- **THEN** the panel width tracks the pointer, clamped to the 280px floor / 65% cap of the content+panel basis
- **AND** the percentage persists to `runkit-panel-width` on drag end

- **GIVEN** the panel is its own grid column
- **WHEN** its width math measures its basis
- **THEN** no measurement reads the panel's own parent (the circular basis), and no box-less (`display: contents`) element sits between the measured container and the panel

### Chrome State: railOpen

#### R4: `railOpen` in ChromeContext
`contexts/chrome-context.tsx` SHALL add a `railOpen` boolean, persisted to localStorage key `runkit-rail-open`, default `true`, following the `sidebarOpen` pattern (lazy initial read, setter writing through), exposed via `useChromeState`/`useChromeDispatch`. Desktop-only; no mobile-aware default.

- **GIVEN** no stored value
- **WHEN** ChromeProvider mounts
- **THEN** `railOpen` is `true`
- **AND** toggling writes `"false"`/`"true"` to `runkit-rail-open` and survives a reload

### Visibility Model

#### R5: Derived `rightAreaVisible`
AppShell SHALL derive `rightAreaVisible = railOpen || resolvedPanel != null` — no effect-based synchronization. An open panel always forces the right area visible, so `?panel=` deep links, the `⇧⌘.` chord, and palette entries work while the rail is collapsed. The toggle icon's fill SHALL track `rightAreaVisible`, not raw `railOpen`.

- **GIVEN** `railOpen === false` (collapsed) and no open panel
- **WHEN** the user opens a panel via `?panel=` deep link, the `⇧⌘.` chord, or `Panel: Web`
- **THEN** the right column appears with rail + panel (derived visible), without flipping `railOpen`

#### R6: Collapse closes an open panel
The toggle's collapse action, when a panel is open, SHALL close the panel through the same path as `togglePanel`'s close branch: `removeStoredPanel(server, windowParam)` + navigate with the `?panel=` param dropped. Collapsed means nothing right of the terminal; a hidden-but-open panel would contradict its own URL.

- **GIVEN** the code panel open (`?panel=code` in the URL)
- **WHEN** the user clicks the rail toggle
- **THEN** rail and panel both hide, `?panel=` is removed from the URL, and the per-window panel key is removed
- **AND** clicking the toggle again restores only the rail (the panel stays closed)

### Top Bar: Toggle Button

#### R7: Trailing chip placement and gating
The toggle button SHALL render as the outermost right element of the top bar, inside the trailing exempt block AFTER the overflow chevron (the `trailingRef` block — width-measured by the fit, so it never overflows). Styling: the sidebar-toggle chip treatment (`rk-glint` + `TOP_BAR_BUTTON_BASE` + `border-border` + `text-text-primary`), `aria-label="Toggle panel"`. Gate: rendered only when `onToggleRail` is provided — AppShell provides it on `windowParam && !isMobile`, i.e. every desktop terminal route, even with zero available surfaces.

- **GIVEN** a desktop terminal route on a window with no web URL and no git root (zero surfaces)
- **WHEN** the top bar renders
- **THEN** the rail toggle chip is present after the overflow chevron

- **GIVEN** a board, host, or mobile route (no `onToggleRail` registered)
- **WHEN** the top bar renders
- **THEN** no rail toggle renders

#### R8: Mirrored HamburgerIcon
`HamburgerIcon` in `top-bar.tsx` SHALL take a `side?: 'left' | 'right'` prop (default `'left'`, existing geometry untouched). `side='right'` mirrors the geometry: fill rect `x=11.5`, divider `x=11.5` (vs the left icon's `2.5`/`6.5`). The right icon's column fill tracks `rightAreaVisible` — one icon language on both edges.

- **GIVEN** the rail toggle with the right area visible
- **WHEN** the icon renders
- **THEN** the right column of the icon is filled (`fill-opacity` full); collapsing empties it

### Wiring

#### R9: Slot-context transport
`railOpen` (as the derived `rightAreaVisible` for icon state) and `onToggleRail` SHALL ride `contexts/top-bar-slot-context.tsx`: AppShell registers them, RootTopBar passes them through to `TopBar` — the same transport the sidebar toggle uses.

- **GIVEN** AppShell mounted on a desktop terminal route
- **WHEN** it registers its top-bar slot
- **THEN** RootTopBar receives and forwards `onToggleRail` + the visibility flag, and the button dispatches back into AppShell's handler

### Keyboard Path

#### R10: Palette entry
A command-palette entry (label `Panel: Toggle rail`) SHALL invoke the same toggle handler, gated identically to the button (desktop terminal route). Constitution V: every user-facing action keyboard-reachable, palette as discovery mechanism.

- **GIVEN** the palette open on a desktop terminal route
- **WHEN** the user runs `Panel: Toggle rail`
- **THEN** the rail collapses/restores exactly as the button does

### Documentation

#### R11: Spec amendment
`docs/specs/right-panel.md` SHALL be amended: (a) the "always-visible icon rail" wording (intro + § 2) becomes "rendered on every desktop terminal route, collapsible from the top bar"; (b) a short paragraph documents the full-height column layout — rail+panel as a Shell grid column beside the content column, bottom bar scoped to the content column. (Memory hydration of `docs/memory/run-kit/ui-patterns.md` happens at the hydrate stage, not here.)

- **GIVEN** the amended spec
- **WHEN** read against the implementation
- **THEN** no spec sentence claims the rail is unconditionally visible

### Non-Goals

- Mobile: no rail, no toggle, no sheet changes (right-panel spec P5's sheet remains deferred).
- No `agents` surface work, no board/host-route layout changes (their shell grid is untouched by construction, R1).
- No change to `?view=` lens resolution (spec P2 holds) or to the `⇧⌘.` chord semantics (it still toggles a panel surface, not the rail).

### Design Decisions

#### Collapse is Shell grid-column gating, not a RightPanel visible prop
**Decision**: The right column (rail + panel) hides via the Shell grid slot's visibility gating at width/display level.
**Why**: With the full-height column, `railOpen` collapses the third column exactly like `sidebarOpen` collapses the first — one mechanism, true mirror; the first attempt's `display:contents` hazard has no wrapper to bite.
**Rejected**: The backlog's `visible` prop on RightPanel hiding its two root divs — correct in the old inside-content layout, superseded by the 2026-08-12 layout fold-in; implementing it first would mean building the hide mechanism twice.
*Introduced by*: 260812-nm4p-top-bar-rail-toggle

#### Panel column sized in pixels, clamp basis measured off the shell container
**Decision**: The panel sets a pixel width on its grid column; `clampPanelWidth` keeps its floor/cap semantics against the content+panel region measured from outside the panel.
**Why**: Percent-of-parent is circular once the panel IS the column; pixels keep the grid `auto` column honest while the stored percentage stays viewer-relative.
**Rejected**: Keeping `width: N%` against the grid container directly — the sidebar column would silently change the panel's rendered width on sidebar resize, coupling the two panels.
*Introduced by*: 260812-nm4p-top-bar-rail-toggle

#### Derived visibility over synchronized state
**Decision**: `rightAreaVisible` is computed at render (`railOpen || resolvedPanel != null`); no effects write one state from the other.
**Why**: Settled 2026-08-11 — effect-based sync races on deep links and chord paths; derivation cannot desync.
**Rejected**: `useEffect` forcing `railOpen = true` on panel open — the race the model exists to avoid, and it would corrupt the user's persisted rail preference.
*Introduced by*: 260812-nm4p-top-bar-rail-toggle

## Tasks

### Phase 1: State & Transport

- [x] T001 [P] Add `railOpen` to `app/frontend/src/contexts/chrome-context.tsx`: `RAIL_OPEN_STORAGE_KEY = "runkit-rail-open"`, lazy initial read defaulting `true`, `setRailOpen` writing through — mirror `sidebarOpen` exactly; extend `chrome-context.test.tsx` (default true, toggle persists, reload restores) <!-- R4 -->
- [x] T002 [P] Extend `app/frontend/src/contexts/top-bar-slot-context.tsx` slot shape with `railOpen: boolean` (the derived visible flag for icon state) and `onToggleRail?: () => void`; update `top-bar-slot-context.test.tsx` <!-- R9 -->

### Phase 2: Layout Restructure

- [x] T003 Add the optional third grid column to `app/frontend/src/components/shell/shell.tsx`: `rightPanelChildren` + `rightPanelVisible` props; grid areas `"sidebar content rightpanel" / "sidebar bottombar rightpanel"`, columns `${sidebarWidth}px 1fr auto` when the slot is filled; the `<aside gridArea:"rightpanel">` stays mounted when `rightPanelVisible` is false (zero-width/`hidden` at display level — NOT the sidebar's unmount gating); two-column grid byte-identical when the slot is absent <!-- R1 -->
- [x] T004 Refactor `app/frontend/src/components/right-panel.tsx` width math: panel width applied in pixels; measurement basis = content+panel region via a seam off the panel's own parent (ResizeObserver on the shell grid or content `<main>`, wired by ref/prop from Shell/AppShell); keep `clampPanelWidth`/`runkit-panel-width` semantics, drag handle, `setPointerCapture` mechanics, and P3 lazy-mount/`hidden` behavior; update `right-panel.test.ts(x)` coverage of the new basis <!-- R3 -->
- [x] T005 Move the `<RightPanel>` block in `app/frontend/src/app.tsx` out of `<main>` into the Shell slot: pass `rightPanelChildren` + `rightPanelVisible={rightAreaVisible}`; derive `rightAreaVisible = railOpen || resolvedPanel != null`; implement `onToggleRail` (collapse path: when `resolvedPanel != null`, run `removeStoredPanel` + navigate dropping `?panel=`, then set `railOpen` false; restore path: set `railOpen` true); register `railOpen`/`onToggleRail` into the top-bar slot <!-- R5 -->

### Phase 3: Top Bar & Palette

- [x] T006 Extend `HamburgerIcon` in `app/frontend/src/components/top-bar.tsx` with `side?: 'left' | 'right'` (right: fill rect x=11.5, divider x=11.5; fill tracks the passed open flag); add the toggle chip as the last element of the `trailingRef` block (after the overflow chevron): `rk-glint` + `TOP_BAR_BUTTON_BASE` + `border-border` + `text-text-primary`, `aria-label="Toggle panel"`, rendered only when `onToggleRail` is provided; thread `railOpen`/`onToggleRail` through `RootTopBar`/`TopBar` props <!-- R7 -->
- [x] T007 Add the `Panel: Toggle rail` palette entry in `app/frontend/src/app.tsx` beside `Panel: Web` (`app.tsx:2432`), invoking the same `onToggleRail` handler, gated on desktop terminal route <!-- R10 -->

### Phase 4: Tests & Docs

- [x] T008 Unit tests in `app/frontend/src/components/top-bar.test.tsx`: no toggle button when `onToggleRail` absent; click calls it; mirrored geometry (fill rect x=11.5; fill-opacity tracks the open flag) <!-- R7 -->
- [x] T009 e2e additions to `app/frontend/tests/e2e/right-panel.spec.ts`: toggle present on a PLAIN window (zero surfaces); collapse hides the rail and the terminal `boundingBox` width grows (poll); collapse-with-open-panel hides both and drops `?panel=`; `⇧⌘.` chord after collapse re-shows rail+panel; full-height layout — with a panel open, the panel/rail bottom edge reaches the shell bottom and the bottom bar's width equals the terminal column, not the viewport; iframe survives collapse (no reload); reset `runkit-rail-open` in each test's setup; verify existing drag-resize tests still pass (R3 regression proof); update `right-panel.spec.md` in the same commit <!-- R2 -->
- [x] T010 Amend `docs/specs/right-panel.md`: "always-visible" wording (intro line 4, § 2 line 48) → "rendered on every desktop terminal route, collapsible from the top bar"; add the full-height column layout paragraph (rail+panel as a Shell grid column, bottom bar scoped to the content column) <!-- R11 -->

## Execution Order

- T001, T002 are independent ([P]).
- T003 blocks T004 and T005 (the slot must exist before RightPanel moves into it).
- T005 depends on T001 (railOpen) and T002 (slot shape).
- T006 depends on T002; T007 depends on T005.
- T008–T010 run after their subjects (T006, T003–T007, none respectively).

## Acceptance

### Functional Completeness

- [x] A-001 R1: On a desktop terminal route the rail (and open panel) spans to the viewport bottom; the bottom bar + compose strip render only under the terminal column; board/host routes render the unchanged two-column grid
- [x] A-002 R4: `railOpen` defaults true, persists to `runkit-rail-open`, and is exposed via `useChromeState`/`useChromeDispatch`
- [x] A-003 R5: `rightAreaVisible` is derived (`railOpen || resolvedPanel != null`) with no synchronizing effect; opening a panel via deep link/chord/palette shows the right area while `railOpen` is false
- [x] A-004 R7: The toggle chip renders after the overflow chevron with the sidebar-toggle treatment and `aria-label="Toggle panel"` on every desktop terminal route (including zero-surface windows), and never on board/host/mobile
- [x] A-005 R8: `HamburgerIcon side='right'` renders mirrored geometry (fill/divider x=11.5) and its fill tracks `rightAreaVisible`
- [x] A-006 R9: `railOpen`/`onToggleRail` travel AppShell → slot context → RootTopBar → TopBar
- [x] A-007 R10: `Panel: Toggle rail` palette entry invokes the toggle on desktop terminal routes
- [x] A-008 R11: The right-panel spec no longer claims an unconditionally visible rail and documents the full-height column

### Behavioral Correctness

- [x] A-009 R6: Collapsing with an open panel closes it through `removeStoredPanel` + `?panel=` drop (URL clean, per-window key removed); re-expanding restores only the rail
- [x] A-010 R3: Drag-resize works in the new grid-column layout — floor 280px, cap 65% of the content+panel basis, percentage persisted on drag end; no measurement reads the panel's own parent

### Scenario Coverage

- [x] A-011 R2: e2e proves the iframe survives a collapse (element remains, no reload on restore)
- [x] A-012 R1: e2e asserts panel/rail bottom edge at the shell bottom and bottom-bar width equal to the terminal column
- [x] A-013 R7: e2e proves the toggle is present on a plain (zero-surface) window and that collapse grows the terminal `boundingBox` width

### Edge Cases & Error Handling

- [x] A-014 R5: `?panel=code` deep link on a collapsed-rail window renders rail+panel (never a dead link); window switch drops `?panel=` and the destination window resolves its own state, with the rail preference (`railOpen`) unaffected
- [x] A-015 R3: On a narrow desktop window where the 280px floor and 65% cap collide, the floor wins (existing `clampPanelWidth` semantics preserved under the new basis)

### Code Quality

- [x] A-016 Pattern consistency: new code mirrors the named precedents — `sidebarOpen` (state), `sidebarChildren` (slot), sidebar-toggle chip (styling), `panel-toggle` palette composition
- [x] A-017 No unnecessary duplication: reuses `clampPanelWidth`, `removeStoredPanel`, `TOP_BAR_BUTTON_BASE`, and the b20a8020 plumbing where its semantics survive
- [x] A-018 Tests included: unit coverage for chrome-context, slot-context, top-bar; e2e for layout/toggle behavior; `.spec.md` companion updated in the same commit (Constitution § Test Companion Docs)
- [x] A-019 No client polling introduced; no new routes; `overflow: hidden` guards on `.app-shell`/terminal column preserved

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The superseded percent-of-parent width machinery (`railRef` / `railRef.parentElement` measurement in `right-panel.tsx`) and the old in-content flex-row wrapper in `app.tsx` were already removed inside the apply diff itself; no other live code was left unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Shell takes a separate `rightPanelVisible` flag rather than AppShell conditionally passing children | Children must stay mounted while hidden (R2); conditional children would unmount — the flag keeps the P3 contract at the layout seam | S:70 R:80 A:85 D:75 |
| 2 | Confident | Measurement seam = ResizeObserver on the content+panel region wired from Shell/AppShell (exact element left to apply) | Any non-parent, non-contents box covering terminal+panel satisfies R3; the specific element is an implementation detail with equivalent options | S:65 R:80 A:80 D:70 |
| 3 | Confident | `onToggleRail` collapse sets `railOpen=false` AND closes the panel in one handler (not two user steps) | R6's GIVEN/THEN requires a single click to hide both; ordering (close panel, then flip flag) avoids a one-frame open-panel-while-collapsed state | S:75 R:85 A:85 D:80 |
| 4 | Certain | Measurement seam (assumption 2) resolved to: Shell provides the `.app-shell` grid element via a `ShellGridRefContext` ref; RightPanel observes it (passive effect + RO) and subtracts the sidebar column from chrome state | Child layout effects run before the parent attaches its ref, so the initial read lives in a passive effect (RO's initial callback covers first paint); grid-minus-sidebar IS the content+panel region | S:75 R:80 A:85 D:80 |
| 5 | Certain | e2e pref reset (`runkit-rail-open`) is guarded to the TOP FRAME (`window !== window.top`) | Playwright init scripts run for EVERY frame; the panel's same-origin `/proxy/` iframe shares the origin's localStorage, so an unguarded reset wiped the pref mid-test the moment a panel opened (root-caused via Storage-prototype spy: no main-world removeItem/clear) | S:90 R:85 A:90 D:85 |
| 6 | Confident | The pre-existing `?panel=web deep link…` e2e got `test.setTimeout(30_000)` | It fails on the BASE commit in this environment too (verified via stash) — three page loads + two window creations exceed the 10s default on a loaded box; the sidebar-panels spec uses the same pattern. Test-only budget change, no behavior touched | S:80 R:85 A:85 D:75 |

6 assumptions (2 certain at apply, plus the original 3 confident; 0 tentative).
