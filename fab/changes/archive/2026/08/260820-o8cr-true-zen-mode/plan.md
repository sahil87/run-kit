# Plan: True Zen Mode

**Change**: 260820-o8cr-true-zen-mode
**Intake**: `intake.md`

## Requirements

### UI: Zen State and Chrome Hide

#### R1: Transient zen state on the desktop terminal route
The terminal route (AppShell, `app/frontend/src/app.tsx`) SHALL hold a transient `zenActive` flag plus a `zenZoomed` tracking boolean (whether zen itself initiated the tile zoom). Zen state SHALL persist across window switches within the terminal route, SHALL be deactivated whenever the terminal route is left (board/host/server routes, or `windowParam` gone), and SHALL NEVER be written to a URL param or localStorage. Mobile (`isMobileViewport()`) is excluded — zen never activates there.

- **GIVEN** the desktop terminal route is mounted with zen inactive
- **WHEN** zen is entered
- **THEN** `zenActive` is true and no localStorage key and no URL search param changes
- **AND** navigating to a non-terminal route renders normal chrome (zen no longer applies)

#### R2: Zen hides the top bar via a render-time seam
Entering zen SHALL hide the persistent root-layout top bar (`RootTopBar`, mounted outside AppShell in `app.tsx:337`). The hide MUST cross the root-layout/AppShell boundary via a context field that is never persisted, and MUST NOT flash on route transitions (the consumer of the flag derives it per render from route params, never stores it).

- **GIVEN** zen is active on the terminal route
- **WHEN** any render occurs
- **THEN** the top bar wrapper renders nothing for the bar itself
- **AND** the instance-accent stripe/wash continue to render (they are chrome identity, not the bar)

#### R3: Zen hides the sidebar without touching persisted preference
While zen is active, the Shell sidebar column SHALL render collapsed (`0 1fr` + zero column-gap, the existing hidden-sidebar geometry) and the sidebar aside + resize handle SHALL not mount. This MUST be a render-time override composed as `sidebarOpen && !zenActive` — `setSidebarOpen` (which persists `runkit-sidebar-open`) SHALL NEVER be called by any zen path.

- **GIVEN** the sidebar is open (persisted preference true) and zen is entered
- **WHEN** zen is active
- **THEN** the sidebar is hidden and `localStorage["runkit-sidebar-open"]` is unchanged
- **AND** exiting zen restores the sidebar exactly as the persisted preference dictates

#### R4: Zen zooms the focused tile at arity > 1, with exit unzoom only for zen-initiated zoom
On ENTER at arity > 1, zen SHALL zoom the focused tile via the existing `layoutZoomToggleRef` seam only if it is not already zoomed, recording whether zen initiated the zoom. On EXIT, zen SHALL unzoom only if zen initiated the zoom — a zoom the user made before entering zen survives exit. While zen is active, plain zoom verbs (tile-header ⛶, `Layout: Zoom`/`Unzoom`) keep acting on the tile zoom without exiting zen.

- **GIVEN** a 2-tile layout, no zoom active
- **WHEN** zen is entered
- **THEN** the focused tile zooms and `zenZoomed` records true
- **GIVEN** zen is active with a zen-initiated zoom
- **WHEN** zen is exited
- **THEN** the zoom clears and `zenZoomed` records false
- **GIVEN** the user zoomed BEFORE entering zen
- **WHEN** zen is exited
- **THEN** the user zoom remains active

#### R5: Zen keeps the compose strip and status bar visible
Zen SHALL NOT hide the compose strip, the status bar, or the bottom-bar row. Only the top bar, sidebar, and (arity > 1) non-focused tiles are hidden.

- **GIVEN** zen is active with the compose strip enabled
- **WHEN** the layout renders
- **THEN** the compose strip and the status bar remain visible

### UI: Chord, Palette, Exit Button

#### R6: `zen-toggle` chord mounts at any arity
The `zen-toggle` handler in `app.tsx` SHALL mount whenever `windowParam && !isMobile` (the `renderLayout.order.length > 1` term is dropped) and SHALL toggle the full zen state (enter/exit per R1/R4), not merely the tile zoom. The binding row itself (`lib/keybindings.ts:252`) is unchanged. Esc SHALL NOT be bound as a zen exit.

- **GIVEN** a single-tile `single:tty` layout (arity 1) on desktop
- **WHEN** ⇧⌘⏎ is pressed
- **THEN** zen activates (top bar + sidebar hidden) instead of falling through as a no-op

#### R7: Palette entries `View: Enter Zen Mode` / `View: Exit Zen Mode`
A new pure builder (`lib/palette-zen.ts`, the `buildViewActions`/`buildLayoutActions` precedent) SHALL emit exactly one form — `view-zen-enter` or `view-zen-exit` — keyed on live zen state, gated to `windowParam && !isMobile` (any arity). Entries invoke the same enter/exit body as the chord and SHOULD carry the ⇧⌘⏎ hint via the existing explicit `shortcut` option (the `toggleShortcut` precedent — no new hint mechanism). `Layout: Zoom`/`Unzoom` REMAIN as separate zoom-only entries with their existing arity>1 gate.

- **GIVEN** the desktop terminal route at any arity with zen inactive
- **WHEN** the command palette is searched for "zen"
- **THEN** `View: Enter Zen Mode` appears with the ⇧⌘⏎ hint
- **GIVEN** zen is active
- **WHEN** the palette is searched for "zen"
- **THEN** `View: Exit Zen Mode` appears (exactly one form) and `Layout: Zoom`/`Unzoom` still gate on arity > 1

#### R8: Exit-zen button in the status bar's right host cluster
While zen is active, `components/status-bar.tsx` SHALL render a small exit button (`data-testid="status-bar-exit-zen"`, `aria-label` naming zen exit) at the bottom-right of the status bar's right host cluster (before the ⌘K/compose hints), invoking the exit body. The zen state + callback arrive as new optional `StatusBar` props. The button never renders while zen is inactive.

- **GIVEN** zen is active
- **WHEN** the status bar renders
- **THEN** the exit-zen button is visible and clicking it exits zen
- **AND** while zen is inactive the button is absent

#### R9: Parity invariant updated, not deleted
`lib/keybindings.test.ts`'s palette parity invariant SHALL map `"zen-toggle"` to `["view-zen-enter", "view-zen-exit"]` and the test SHALL pass.

- **GIVEN** the updated parity map
- **WHEN** `keybindings.test.ts` runs
- **THEN** the parity invariant passes with the new zen equivalence

#### R10: ⌘B sidebar chord keeps its normal semantics in zen
Chrome-affecting actions while in zen (⌘B, palette `Sidebar:` entries) are not suppressed. Per intake assumption 12, the Shell composition decides the visible sidebar as `sidebarOpen && !zenActive`: while zen is active the persisted preference stays untouched; an explicit ⌘B toggle that leaves the preference `true` keeps the sidebar hidden for the rest of that zen session, and exiting zen restores it.

- **GIVEN** zen is active with the sidebar preference persisted open
- **WHEN** the user presses ⌘B (which flips the preference to closed then open)
- **THEN** no crash/no zen exit occurs, and the persisted preference continues to own post-zen rendering

### Non-Goals

- Mobile zen — excluded by user decision.
- Hiding the compose strip or status bar — explicitly kept visible.
- Any zen persistence (URL param, localStorage) — explicitly rejected.
- Esc as a zen exit binding — explicitly rejected (Esc must reach the terminal pane).
- Backend/API changes — frontend-only view state.

### Design Decisions

#### Zen is a transient render-time override, never a persisted write
**Decision**: zen state lives in AppShell's transient React state and crosses the root-layout boundary via a new `ZenContext` (deliberately NOT ChromeContext, whose shape is persisted-chrome); the top bar consumes it derived per render from route params + `zenActive`. The sidebar hide composes `sidebarOpen && !zenActive` in Shell — `setSidebarOpen` is never called.
**Why**: the transient contract (intake §1) is the precise answer to 260819-qwr7's rejected-coupling objection — no persisted sidebar/layout state is ever written by zen, so reload restores exactly what persisted state says.
**Rejected**: writing zen into ChromeContext (its fields are persisted chrome — the shape itself would suggest persistence); suppressing the sidebar via `setSidebarOpen(false)` (persists `runkit-sidebar-open` — forbidden).
*Introduced by*: 260820-o8cr-true-zen-mode

#### Exit unzooms only a zen-initiated zoom
**Decision**: one `zenZoomed` boolean beside `zenActive` records whether zen initiated the tile zoom; exit unzooms only when it is true.
**Why**: a zoom the user made before entering zen is their arrangement choice and survives exit; tracking is one boolean.
**Rejected**: always-unzoom on exit (materially simpler but destroys a pre-existing user zoom — user preferred the tracked form).
*Introduced by*: 260820-o8cr-true-zen-mode

#### Esc is not a zen exit binding
**Decision**: exit affordances are ⇧⌘⏎ (toggle) and the always-visible-in-zen status-bar exit button only.
**Why**: Esc must keep flowing to the terminal pane — vim/menus/readline consume it; a global Esc binding would break terminal use.
**Rejected**: global Esc exit (user decision, final).
*Introduced by*: 260820-o8cr-true-zen-mode

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `ZenProvider`/`useZenState`/`useZenDispatch` (`zenActive`, `zenZoomed`, `setZenActive`, `setZenZoomed`) to `app/frontend/src/contexts/zen-context.tsx` (new file, the `chrome-context.tsx` dual-context shape, no storage) and mount it in the root provider composition in `app/frontend/src/app.tsx` <!-- R1 -->
- [x] T002 Implement the zen state + toggle body in `app/frontend/src/app.tsx` AppShell (`zenActive`/`zenZoomed` read from ZenContext; `toggleZen` implementing R4's enter/exit rules through `layoutZoomToggleRef` + `layoutZoomed`; reset `zenActive` off the terminal route) and rewire the `zen-toggle` chord (`windowParam && !isMobile`, arity term dropped) to it <!-- R1 R4 R6 -->
- [x] T003 Hide the root top bar while zen applies in `app/frontend/src/app.tsx` (`AppLayoutContent`: consume ZenContext, derive the applies-flag from `useMatches()` route params + `zenActive`; skip the `RootTopBar` render while keeping the stripe/wash) <!-- R2 -->
- [x] T004 Add the `zenActive?: boolean` prop to `app/frontend/src/components/shell/shell.tsx` and compose `sidebarOpen && !zenActive` for the stage columns, column-gap, aside, and resize handle; pass it from AppShell's `<Shell>` in `app.tsx` <!-- R3 R5 R10 -->
- [x] T005 Add `zenActive`/`onExitZen` props and the `status-bar-exit-zen` button to `app/frontend/src/components/status-bar.tsx` (right host cluster, before the ⌘K hint; the cluster's hint-button vocabulary) and wire the props in `app.tsx` <!-- R5 R8 -->
- [x] T006 Create `app/frontend/src/lib/palette-zen.ts` (`buildZenActions(active, opts)` — one-form `view-zen-enter`/`view-zen-exit`, explicit `shortcut` hint option) and wire it into the palette list in `app.tsx` gated on `windowParam && !isMobile` <!-- R7 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Update the parity invariant map in `app/frontend/src/lib/keybindings.test.ts` (`"zen-toggle": ["view-zen-enter", "view-zen-exit"]`, comment updated) <!-- R9 -->
- [x] T008 Unit tests: `app/frontend/src/lib/palette-zen.test.ts` (one-form gating, hint, bodies) and zen state-machine coverage of `toggleZen` enter/exit/arity-1/pre-zoomed-survives paths (colocated test file per the project's frontend test strategy) <!-- R1 R4 R6 R7 -->
- [x] T009 New e2e spec `app/frontend/tests/e2e/zen-mode.spec.ts` + sibling `zen-mode.spec.md` (enter via ⇧⌘⏎ → top bar/sidebar hidden, status bar + exit button present; exit via chord AND via button; `runkit-sidebar-open` untouched after a round-trip; arity-1 entry) — run via `just pw test zen-mode` <!-- R1 R2 R3 R5 R6 R8 -->

## Execution Order

- T001 blocks T002–T005 (all consume ZenContext)
- T002 blocks T006/T008 (palette builder + tests exercise `toggleZen`'s contract)
- T009 runs last (e2e covers the whole feature)

## Acceptance

### Functional Completeness

- [x] A-001 R1: Zen state is transient (no URL/localStorage writes), terminal-route-scoped, desktop-only, and survives window switches within the route
- [x] A-002 R2: The top bar hides while zen is active and returns on exit, without flashing on route transitions; stripe/wash unaffected
- [x] A-003 R3: The sidebar hides in zen via render-time override; `runkit-sidebar-open` is never written by any zen path
- [x] A-004 R4: Enter at arity > 1 zooms the focused tile if unzoomed; exit unzooms only a zen-initiated zoom; a pre-existing user zoom survives
- [x] A-005 R5: Compose strip and status bar stay visible in zen
- [x] A-006 R6: ⇧⌘⏎ toggles zen at any arity on the desktop terminal route; Esc is not bound
- [x] A-007 R7: Palette offers exactly one of `View: Enter/Exit Zen Mode` findable by "zen" at any arity, with the ⇧⌘⏎ hint; `Layout: Zoom`/`Unzoom` unchanged
- [x] A-008 R8: The `status-bar-exit-zen` button renders only while zen is active and exits zen
- [x] A-009 R9: The parity invariant maps `zen-toggle` to the new entry ids and passes
- [x] A-010 R10: ⌘B keeps normal persisting semantics while in zen; no zen exit, no crash

### Behavioral Correctness

- [x] A-011 R6: The former arity>1 gate at `app.tsx:3585` is gone — arity 1 enters zen (top bar + sidebar hidden, no zoom attempted)
- [x] A-012 R4: Zooming via ⛶ or the palette while zen is active changes only the tile zoom and does not exit zen

### Scenario Coverage

- [x] A-013 R1: Unit tests cover the zen state machine (enter/exit, arity-1 path, zenZoomed tracking, pre-zoomed survival)
- [x] A-014 R2: E2E spec proves enter → chrome hidden/status bar present, exit via chord and via button, sidebar preference untouched, arity-1 entry

### Edge Cases & Error Handling

- [x] A-015 R1: Leaving the terminal route deactivates zen — board/host/server routes render normal chrome
- [x] A-016 R4: Zen entered at arity 1, then a tile added while in zen, does not attempt a retroactive zoom

### Code Quality

- [x] A-017 Pattern consistency: New code follows naming and structural patterns of surrounding code (dual-context shape, pure `lib/` palette builder, ref-seam usage)
- [x] A-018 No unnecessary duplication: Existing seams reused (`layoutZoomToggleRef`, Shell's hidden-sidebar geometry, status-bar hint-button vocabulary)
- [x] A-019 Tests included: Unit tests cover the added behavior; a Playwright e2e spec + `.spec.md` companion cover the UI change
- [x] A-020 Type narrowing: New code uses `if` guards and explicit types, no `as` casts beyond existing patterns
- [x] A-021 Comments state constraints (invariants, cross-file contracts), never narrate the next line

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The former `zen-toggle` arity>1 gate (`app.tsx`) and the old `"zen-toggle": ["layout-zoom", "layout-unzoom"]` parity row were replaced in place by this change's own diff (not discovered leftovers). `Layout: Zoom`/`Unzoom` remain deliberately (plan assumption 8).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Zen hides top bar + sidebar + (arity > 1) non-focused tiles via the existing zoom seam; keeps compose strip + status bar visible | User-decided contract, verbatim from intake | S:95 R:70 A:95 D:95 |
| 2 | Certain | Esc is NOT a zen exit binding; exit = ⇧⌘⏎ + the status-bar exit button | User-decided with rationale; recorded as plan DD | S:95 R:80 A:95 D:95 |
| 3 | Certain | Zen is transient — no URL param, no localStorage; render-time override never writing persisted state | User-decided; answers 260819-qwr7's coupling objection | S:95 R:75 A:90 D:90 |
| 4 | Certain | `zen-toggle` mounts at any arity on `windowParam && !isMobile`; mobile excluded | User-decided | S:95 R:80 A:95 D:95 |
| 5 | Certain | Palette gains one-form `view-zen-enter`/`view-zen-exit` entries findable by "zen", any arity | User-decided; one-form pattern verified at palette-layout.ts:147-152 | S:90 R:85 A:90 D:90 |
| 6 | Certain | Parity invariant updated (not deleted) to the new zen ids | User-decided | S:90 R:90 A:95 D:90 |
| 7 | Certain | Exit unzooms only a zen-initiated zoom (one tracked boolean) | User preferred the tracked form; tracking is trivial | S:75 R:85 A:75 D:70 |
| 8 | Certain | `Layout: Zoom`/`Unzoom` remain separate arity>1-gated zoom-only entries | Removing them would regress zoom-only workflows | S:70 R:90 A:70 D:65 |
| 9 | Certain | Cross-boundary seam is a new non-persisted `ZenContext` mounted at the root; the top-bar consumer derives the applies-flag per render from route params | ChromeContext is persisted chrome; per-render derivation avoids route-transition flash | S:70 R:85 A:80 D:75 |
| 10 | Certain | Zen persists across window switches within the terminal route; leaving the route deactivates it | Transient app-level chrome state; off-route the gate unmounts | S:45 R:80 A:65 D:60 |
| 11 | Certain | ⌘B/`Sidebar:` palette entries keep normal semantics while in zen (Shell composes `sidebarOpen && !zenActive`; persisted pref untouched) | Intake assumption 12 front-runner: zen is a pure overlay | S:35 R:80 A:55 D:45 |
| 12 | Certain | Exit-zen button in the status bar's right host cluster, only while zen is active, cluster's hint-button vocabulary | User-decided placement | S:90 R:85 A:85 D:85 |
| 13 | Certain | Labels `View: Enter Zen Mode`/`View: Exit Zen Mode`, ids `view-zen-enter`/`view-zen-exit` | User's suggested form adopted | S:80 R:95 A:80 D:80 |
| 14 | Confident | Zen entries carry the ⇧⌘⏎ hint via the explicit `shortcut` option (the `toggleShortcut` precedent) | Existing hint plumbing allows it without a new mechanism | S:75 R:80 A:70 D:65 |
| 15 | Confident | The instance-accent stripe/wash stay visible in zen (only the `RootTopBar` render is skipped) | They are instance identity chrome outside the bar; hiding them gains nothing | S:50 R:85 A:60 D:55 |
| 16 | Confident | Zen state + toggle body live in AppShell; StatusBar receives `zenActive`/`onExitZen` as props; Shell receives `zenActive` as a prop | Intake's "props extension or context seam — plan decides": props keep AppShell the single owner of the state machine | S:65 R:80 A:75 D:65 |

16 assumptions (13 certain, 3 confident, 0 tentative).
