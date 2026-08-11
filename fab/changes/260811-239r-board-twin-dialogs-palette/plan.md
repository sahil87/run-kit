# Plan: Dissolve Board-Twin Server Dialogs & Command Palette

**Change**: 260811-239r-board-twin-dialogs-palette
**Intake**: `intake.md`

## Requirements

### Frontend: Server Dialogs (Part A)

#### R1: Server Dialogs Context
A new `app/frontend/src/contexts/server-dialogs-context.tsx` SHALL provide, mirroring `settings-dialog-context.tsx`: referentially stable triggers `openCreateServer()` and `requestKillServer(name)`, plus readable open-state `createServerOpen: boolean` and `killServerTarget: string | null`. The provider SHALL mount at the `AppLayout` level so every route (boards included) can trigger the dialogs.

- **GIVEN** the app is running on any route (terminal, board, host)
- **WHEN** a descendant calls `openCreateServer()` or `requestKillServer(name)`
- **THEN** the corresponding dialog opens from the single layout-level mount
- **AND** the trigger functions are referentially stable across renders (memoized consumers such as the `Sidebar` server-group header cluster must not re-render)

#### R2: Single Server-Dialog Mount
The create-server and kill-server confirm dialog JSX SHALL render exactly once, mounted in `AppLayout` alongside the existing `SettingsDialog` mount, extracted into `app/frontend/src/components/server-dialogs.tsx`. That component SHALL own the create-input local state and the submit/kill handlers (`useOptimisticAction` wrappers around `createServer`/`killServer`, `markServerPending`, `markKilled`). The per-route dialog JSX in `app.tsx` (AppShell) and `board-page.tsx` SHALL be deleted.

- **GIVEN** any route is active
- **WHEN** a server create or kill is requested
- **THEN** the same single dialog implementation renders, regardless of route

#### R3: Unified Create-Server Behavior
The create-server flow SHALL apply AppShell's current superset on ALL routes: `toSafeServerName` on input change, `finalizeSafeName` on submit, then `markServerPending(name)` and navigate to `/$server` after create (navigation is route-agnostic and matches both routes' current behavior).

- **GIVEN** the create-server dialog is open on a board route
- **WHEN** the user types an unsafe server name and submits
- **THEN** the input is sanitized on change and finalized on submit exactly as on terminal routes today
- **AND** after creation the app navigates to `/$server` and the pending-marker lifecycle begins

#### R4: Unified Kill-Server Behavior
The kill-server confirm SHALL render the `DAEMON_SERVER` warning paragraph ("hosts the run-kit daemon serving this dashboard — killing it takes the dashboard down") on ALL routes when the target is the daemon server. After a confirmed kill, the app SHALL navigate to `/` only when the killed server is the current server per `SessionContext`'s `currentServer` (the deepest-first route-param walk) — `null` on board routes, so a board kill never navigates away, matching current board behavior.

- **GIVEN** the kill-server confirm targets the daemon server on a board route
- **WHEN** the dialog renders
- **THEN** the daemon warning paragraph is visible (today it is absent on boards — drift)
- **AND** after confirming, a board-route kill does not navigate away, while killing the current server from its own route navigates to `/`

#### R5: Caller Rewire & Twin-State Removal
All trigger call sites SHALL rewire to the context: both `Sidebar` mounts (`onCreateServer`/`onKillServer` props), and AppShell's palette entries (`Server: Create`, `buildServerKillActions(...)`). The per-route state (`showCreateServerDialog`/`createServerName`/`killServerTarget` in `app.tsx`; `killServerTarget` + create dialog state in `board-page.tsx`) SHALL be deleted.

- **GIVEN** the refactor is complete
- **WHEN** the sidebar server-group menu or a palette entry requests create/kill
- **THEN** the request flows through `server-dialogs-context` triggers
- **AND** no per-route server-dialog state or dialog JSX remains in `app.tsx` or `board-page.tsx`

#### R6: Modal Gating via Context
AppShell's any-dialog-open predicate (gates keyboard handling while a modal is up) SHALL read `createServerOpen`/`killServerTarget` from the context instead of local state. BoardPage's equivalent gating seam SHALL also consume the context open-state.

- **GIVEN** the create-server or kill-server dialog is open
- **WHEN** a keybinding chord fires on either route
- **THEN** route-level keyboard handling stays gated exactly as before the refactor

### Frontend: Command Palette (Part B)

#### R7: Palette-Actions Slot Context
A new `app/frontend/src/contexts/palette-actions-context.tsx` SHALL mirror `top-bar-slot-context.tsx`: routes publish their route-scoped, already-shortcut-decorated action lists via `useRegisterPaletteActions(actions)` (referentially-stable dispatcher, last-writer-wins, clear-on-unmount). The context SHALL also expose the merged decorated list (`allActions`) back to routes for id-based resolution seams.

- **GIVEN** a route registers its actions and later unmounts
- **WHEN** the registration effect runs / cleans up
- **THEN** the slot holds that route's actions while mounted and clears to empty on unmount (no stale actions on the next route)

#### R8: Single CommandPalette Mount
Exactly one (lazy) `CommandPalette` SHALL mount in `AppLayout`, rendering `[...routeActions, ...globalActions]`. The two per-route mounts (`app.tsx` AppShell, `board-page.tsx`) SHALL be deleted.

- **GIVEN** any route is active
- **WHEN** the user presses the `command-palette` chord (⌘K / Ctrl+K)
- **THEN** the single layout-mounted palette opens with the active route's actions first, followed by the global groups

#### R9: Layout-Level Global Actions
The global palette groups — nav (`buildNavActions`, mode from the same route-derived walk `RootTopBar` uses), terminal-font trio, `View: Refresh Page`, `Help: Documentation` (shared `HELP_URL`), `Help: Keyboard Shortcuts`, `Settings: Open`, update/check/maintenance/version (`buildUpdateActions`/`buildCheckActions`/`buildMaintenanceActions`/`buildVersionAction` over `useUpdateCheck` + daemon version state) — SHALL be built once at the layout level and decorated with `withShortcutHints` via `useKeybindings`. The seven "duplicated from AppShell (DD-8)" groups in `board-page.tsx` and the same groups in AppShell's list SHALL be removed.

- **GIVEN** any route (terminal or board)
- **WHEN** the palette opens
- **THEN** the global groups appear exactly once, built by the layout-level builder
- **AND** no DD-8 duplicated-global comment blocks remain in `board-page.tsx`

#### R10: Merged-List Resolution Seams
Every seam that resolves palette actions by id SHALL consume the merged decorated list: AppShell's keybinding dispatch (`fromPalette` — chords such as `go-back`, `go-forward`, `settings-open`, `shortcuts-overlay` resolve ids that become global), the macro palette-target enumeration, and the macro invocation-time resolution (`paletteActionsRef`). No chord or macro target MAY silently lose its handler.

- **GIVEN** a keybinding chord bound to a now-global palette id (e.g. `settings-open`)
- **WHEN** the chord fires on a terminal route
- **THEN** the global action executes exactly as before the refactor
- **AND** a macro targeting any palette entry (route or global) still enumerates and invokes it

#### R11: Palette Identity & Ordering Preservation
Every existing palette entry SHALL keep its `id` and label (ids double as keybinding actionIds). Ordering SHALL remain route-group entries first, then the global groups in their current relative order. Macro-generated actions (`macroPaletteActions`) SHALL remain part of AppShell's registered route list.

- **GIVEN** the existing unit and e2e suites reference palette entry ids/labels
- **WHEN** the refactor lands
- **THEN** all id/label-referencing tests pass unmodified (except ownership-driven mount changes), proving identity and ordering are preserved

### Frontend: Shortcuts Overlay (Part C)

#### R12: ShortcutsOverlay Lift
The `showShortcutsOverlay` state and the `<ShortcutsOverlay>` mount SHALL lift from both routes to `AppLayout` (forced by the `Help: Keyboard Shortcuts` global entry moving to the layout — a layout-level entry cannot toggle route-local state). The `shortcuts-overlay` keybinding chord SHALL resolve through the merged palette action's layout-owned `onSelect`. AppShell's session-scoped overlay behavior (the `showShortcutsOverlay && sessionName` effect) SHALL be preserved at the layout level or verified equivalent.

- **GIVEN** any route is active
- **WHEN** the user selects `Help: Keyboard Shortcuts` or fires the `shortcuts-overlay` chord
- **THEN** the single layout-mounted overlay opens/closes with the same behavior as before on both routes

### Non-Goals

- Kill-WINDOW dialogs stay route-owned — the board `killTarget` dialog (kill-everywhere + `Unpin instead` escape) and the terminal-route current-window confirm differ semantically; at most a shared presentational confirm MAY be extracted if it falls out naturally
- AppShell's other dialogs (rename session, kill session, tmux commands, create session/window at folder, iframe, spawn agent) — server/terminal-scoped, single-route, do not move
- No backend, API, or route changes; no visual/behavioral change beyond the two board-side drift fixes (daemon warning, input sanitization)

### Design Decisions

#### Lift via two contexts + single AppLayout mounts
**Decision**: New `server-dialogs-context` (mirrors `settings-dialog-context`, o7q8) and `palette-actions-context` (mirrors `top-bar-slot-context`, PR #326); dialogs, palette, and shortcuts overlay each mount exactly once in `AppLayout`.
**Why**: Both precedents are proven in-repo for exactly this dissolve-a-twin shape; the backlog FIX line names them.
**Rejected**: Rendering AppShell on the board route (AppShell is deliberately server-scoped — pinned by the backlog); shared JSX with per-route mounts/state (removes JSX drift but keeps the state twins and the seven DD-8 blocks).
*Introduced by*: 260811-239r-board-twin-dialogs-palette

#### Unified dialogs adopt AppShell's superset
**Decision**: The single dialog implementation carries the `DAEMON_SERVER` warning, `toSafeServerName`/`finalizeSafeName` sanitization, and the navigate-away-only-when-killing-current-server rule (via `SessionContext.currentServer`).
**Why**: The board copies' gaps are drift, not design — the warning and sanitization are safety behavior; the currentServer rule reproduces both routes' current navigation behavior exactly.
**Rejected**: Keeping the board's laxer variants as a route-specific mode (perpetuates two behaviors for one dialog).
*Introduced by*: 260811-239r-board-twin-dialogs-palette

#### Merged palette list as a back-channel
**Decision**: `palette-actions-context` exposes the merged decorated `allActions`; keybinding dispatch and macro seams resolve over it.
**Why**: Chords (`go-back`, `settings-open`, `shortcuts-overlay`) and macro targets reference ids that become global; without the merged list they silently break.
**Rejected**: The layout taking over dispatch for global-only chords (splits one dispatch mechanism into two, and macros still need the merged enumeration).
*Introduced by*: 260811-239r-board-twin-dialogs-palette

## Tasks

### Phase 1: Setup

- [x] T001 [P] Create `app/frontend/src/contexts/server-dialogs-context.tsx` (provider + `useServerDialogs`, stable triggers `openCreateServer`/`requestKillServer`, open-state `createServerOpen`/`killServerTarget`) + colocated unit test `server-dialogs-context.test.tsx` mirroring `settings-dialog-context.test.tsx` <!-- R1 -->
- [x] T002 [P] Create `app/frontend/src/contexts/palette-actions-context.tsx` (provider, `useRegisterPaletteActions` last-writer-wins + clear-on-unmount, exposed merged `allActions`) + colocated unit test `palette-actions-context.test.tsx` mirroring `top-bar-slot-context.test.tsx` <!-- R7 -->

### Phase 2: Core Implementation

- [x] T003 Create `app/frontend/src/components/server-dialogs.tsx` — the single create-server + kill-server dialog implementation lifted from AppShell: `toSafeServerName`/`finalizeSafeName`, `useOptimisticAction` wrappers around `createServer`/`killServer`, `markServerPending`/`markKilled`, `DAEMON_SERVER` warning, post-create navigate to `/$server`, post-kill navigate to `/` only when target === `SessionContext.currentServer` <!-- R2, R3, R4 -->
- [x] T004 In `app.tsx` `AppLayout`: mount `ServerDialogsProvider` + `PaletteActionsProvider` (provider order compatible with `SessionContext`/`SettingsDialogProvider` consumers), mount `<ServerDialogs>`, the single lazy `<CommandPalette actions={allActions}>`, the layout-level global-actions builder (new hook module reusing `lib/palette-*` builders, decorated via `withShortcutHints`/`useKeybindings`, mode from the `RootTopBar` route walk), and the lifted `showShortcutsOverlay` state + `<ShortcutsOverlay>` mount <!-- R2, R8, R9, R12 -->
- [x] T005 In `app.tsx` `AppShell`: delete twin state (`showCreateServerDialog`/`createServerName`/`killServerTarget`/`showShortcutsOverlay`), the two dialog JSX blocks, the palette mount, and the overlay mount; rewire the `Sidebar` props + `Server: Create`/`buildServerKillActions` entries to the context triggers; point the modal-gating predicate at the context; register AppShell's route-scoped actions (incl. `macroPaletteActions`) via `useRegisterPaletteActions`; rewire `fromPalette` keybinding dispatch and macro target/invocation seams (`paletteActionsRef`) to the merged `allActions` <!-- R5, R6, R10, R11, R12 -->
- [x] T006 In `app/frontend/src/components/board/board-page.tsx`: delete the twin dialog state/JSX, the seven DD-8 global groups from `boardRouteActions`, the `CommandPalette` and `ShortcutsOverlay` mounts; rewire the `Sidebar` props to the context triggers; register the board-scoped `boardRouteActions` via `useRegisterPaletteActions`; point the board's modal-gating seam and `useKeybindingDispatch` at the merged list <!-- R5, R6, R8, R9, R10, R11 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Update colocated unit tests for the new ownership: `app/frontend/src/components/command-palette.test.tsx`, `command-palette.boards.test.tsx`, and any dialog-touching unit tests (app/board renders); keep id/label assertions unchanged <!-- R8, R11 -->
- [x] T008 Verify edge seams during implementation: board-route kill never navigates (`currentServer === null`), modal gating while server dialogs are open on both routes, `shortcuts-overlay` chord + session-scoped overlay effect preserved, palette on a route with no registered actions shows globals only <!-- R4, R6, R7, R12 -->

### Phase 4: Verification

- [x] T009 Run the quality gates in order: `just test-frontend`, `just test-backend`, `just build` (tsc + vite), then `just test-e2e` (palette + server-dialog Playwright specs on both routes are the primary regression guard) <!-- R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12 -->

## Execution Order

- T001 and T002 are independent new files — parallelizable
- T003 depends on T001 (consumes the dialogs context)
- T004 depends on T001–T003 (mounts providers, dialogs, palette, global builder)
- T005 and T006 both depend on T004 (both consume the layout-mounted contexts); T005 first (AppShell owns the merged-list seams T006's dispatch also uses)
- T007/T008 follow T005+T006; T009 is last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `server-dialogs-context.tsx` exists with stable triggers + open-state, provided at `AppLayout`, with colocated unit tests
- [x] A-002 R2: Create/kill server dialog JSX renders exactly once (single `server-dialogs.tsx` mount in `AppLayout`); no dialog JSX remains in AppShell or BoardPage
- [x] A-003 R3: Create flow sanitizes on change, finalizes on submit, marks pending, and navigates to `/$server` from every route
- [x] A-004 R4: `DAEMON_SERVER` warning renders on all routes; post-kill navigation happens only when the killed server is `currentServer`
- [x] A-005 R5: Both `Sidebar` mounts and the AppShell palette server entries call context triggers; all per-route twin state deleted
- [x] A-006 R6: Keyboard gating on both routes reads dialog open-state from the context — **N/A (board half)**: BoardPage never had a dialog-state gating seam (chord suppression is input-target-based via `shouldSuppressChord` in `use-keybinding-dispatch.ts`); AppShell's `dialogOpenRef` now reads `createServerOpen`/`killServerTarget` from the context (app.tsx:1566). Board-route gating behavior is unchanged by construction
- [x] A-007 R7: `palette-actions-context.tsx` exists with `useRegisterPaletteActions` (last-writer-wins, clear-on-unmount) and exposed `allActions`, with colocated unit tests
- [x] A-008 R8: One lazy `CommandPalette` mounts in `AppLayout` rendering route-actions-first merged list; per-route mounts deleted
- [x] A-009 R9: Global groups are built once at layout level from the shared `lib/palette-*` builders with shortcut hints; the seven DD-8 blocks are gone from `board-page.tsx`
- [x] A-010 R10: `fromPalette` chord dispatch and macro target/enumeration/invocation resolve over the merged `allActions`
- [x] A-011 R11: Every palette entry keeps its id/label; ordering is route actions then global groups in prior relative order; macro actions stay in AppShell's route list
- [x] A-012 R12: `ShortcutsOverlay` state + mount live in `AppLayout`; palette entry and chord toggle it on both routes

### Behavioral Correctness

- [x] A-013 R3: On a board route, the create-server input applies `toSafeServerName`/`finalizeSafeName` (drift fixed — proven by `server-dialogs.test.tsx`)
- [x] A-014 R4: On a board route, killing the daemon server shows the dashboard-down warning (drift fixed — single implementation renders it on all routes)
- [x] A-015 R4: Killing the current server from a terminal route navigates to `/`; killing any server from a board route does not navigate (both covered by `server-dialogs.test.tsx`)

### Scenario Coverage

- [x] A-016 R8: Palette opens via ⌘K on a terminal route and on a board route, with route entries first in both cases (covered by existing Playwright specs kept green — full `just test-e2e` run: 234 passed, the single failure is the pre-existing `right-panel.spec.ts:128` `?panel=web` deep-link test, which fails identically on the base branch)
- [x] A-017 R10: `go-back`/`go-forward`/`settings-open`/`shortcuts-overlay` chords still execute on terminal routes (`shortcut-registry.spec.ts` green; `fromPalette` resolves over the merged route+globals list)
- [x] A-018 R10: A macro whose target is a global palette entry enumerates and invokes it (enumeration: `LayoutShortcutsOverlay`'s `macroPaletteTargets` runs over the merged `allActions`; invocation: `executeMacro` resolves via the imperative `getAllActions()` at call time)

### Edge Cases & Error Handling

- [x] A-019 R6: With the create-server or kill-server dialog open, route keybindings stay gated on both routes (AppShell `dialogOpenRef` reads the context; board-route suppression is input-target-based and unchanged)
- [x] A-020 R7: On a route with no registered actions (or during lazy-chunk load), the palette renders the global groups only — no stale actions from the previous route (proven by `palette-actions-context.test.tsx`: empty initial + clear-on-unmount)

### Code Quality

- [x] A-021 Pattern consistency: the two new contexts mirror `settings-dialog-context.tsx`/`top-bar-slot-context.tsx` structure and naming; the dialogs component follows existing dialog component patterns
- [x] A-022 No unnecessary duplication: the seven DD-8 duplicated blocks and both twin dialog/palette/overlay implementations are deleted, not mirrored a third time
- [x] A-023 New behavior covered by tests: colocated unit tests for both new contexts; existing palette/dialog unit + e2e suites updated for ownership and kept green
- [x] A-024 Type narrowing: new code uses `if` guards over `as` casts, per project principles (the route-param walks in `use-global-palette-actions.ts`/`LayoutShortcutsOverlay` use one `as` cast each, mirroring the existing `RootTopBar`/`useCurrentServerFromRoute` idiom for `useMatches()` params verbatim)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change IS the deletion: both twin dialog/palette/overlay implementations and the seven DD-8 global groups were removed in-flight. Review found no further code made redundant; the only leftover is a stale comment (`app/frontend/src/components/sidebar/index.tsx:2053-2054` still points at `killServerTarget` in app.tsx / board-page.tsx), carried as a nice-to-have finding rather than a deletion candidate.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | No third context for the shortcuts overlay — its toggle flows through the merged palette action's layout-owned `onSelect`, which the `shortcuts-overlay` chord resolves via `allActions` | Intake names exactly two new contexts; the merged-list seam (R10) already gives chords access to global action handlers | S:60 R:75 A:75 D:65 |
| 2 | Confident | The layout-level global-actions builder lives in its own hook module (e.g. `app/frontend/src/hooks/use-global-palette-actions.ts`) rather than inline in the 3708-line `app.tsx`, composing the existing `lib/palette-*` builders | Every palette group already has a shared `lib/palette-*` builder; extraction keeps `app.tsx` from growing and matches the hooks/lib split | S:70 R:80 A:75 D:65 |
| 3 | Certain | The single dialog implementation lands in `app/frontend/src/components/server-dialogs.tsx` | The intake names this exact path ("or equivalent placement") and it matches the components/ convention | S:85 R:90 A:85 D:80 |
| 4 | Confident | Kill-window dialogs are left fully route-owned — no shared presentational confirm extraction unless it falls out naturally during T005/T006 | Intake marks this out of scope (its Assumption #6); the two kill-window flows differ semantically | S:60 R:80 A:70 D:65 |

4 assumptions (1 certain, 3 confident, 0 tentative).
