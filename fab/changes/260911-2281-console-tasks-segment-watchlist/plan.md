# Plan: Console Operator Tasks Segment — the Operator Watchlist in the Quake Console

**Change**: 260911-2281-console-tasks-segment-watchlist
**Intake**: `intake.md`

## Requirements

### Frontend: Shared watched-list component

#### R1: One watched-list component serves the Server page and the console
The row rendering of the tmux Server page's WATCHED zone (`app/frontend/src/components/server-clock-dashboard/watched-zone.tsx`) MUST be extracted into a shared presentational component `WatchedTable` (`app/frontend/src/components/watched-table.tsx`, props `{ rows, stale, nowSeconds, onNavigate, dense? }`) with its row derivations lifted into two pure helpers in `app/frontend/src/components/server-clock-dashboard/model.ts`: `collectWatchedRows(sessions)` (one row per non-ghost window with `monitored === true`, ordered by session order then window index) and `watchlistStatus(sessions, nowSeconds)` → `{ stale, tickAgeSeconds, hasOperator }`. `WatchedZone` MUST become a thin wrapper (heading + side slot + empty states + `<WatchedTable>`) whose rendered markup, test ids (`clock-zone-watched`, `watched-table`, `watched-row`, `watched-row-navigate`, `watched-stale`), and `watched-zone.test.tsx` expectations are unchanged. `WatchedRow` and `awaitingCell` move into `watched-table.tsx` unchanged. `dense` tightens cell padding only (no column drop; all six columns — status, session, change, awaiting, note, repo — stay).

- **GIVEN** the Server page `/$server` with a monitored window in the sessions payload
- **WHEN** the WATCHED zone renders
- **THEN** the table markup and test ids are byte-equivalent to before the extraction, and `watched-zone.test.tsx` passes without edits
- **AND** `WatchedTable` rendered with `dense` shows the same six columns with tighter padding

### Frontend: Segment strip and the segment union

#### R2: Third segment value `tasks`, domain-prefixed labels
`SEGMENTS` in `app/frontend/src/components/terminal-activity-tabs.tsx` MUST carry three entries in this order: `{ tab: "terminal", label: "Operator Terminal" }`, `{ tab: "activity", label: "Activity" }` (this entry's text is NOT touched — a parallel change renames it), `{ tab: "tasks", label: "Operator Tasks" }`. `ConsoleSegment` derives from `SEGMENTS`. The mobile wrapper `TerminalActivityTabs` MUST derive `active` for all three values (`tab` absent → `terminal`). The file name and the `terminal-activity-tabs` test id stay. `OperatorConsoleRequest.segment` (`app/frontend/src/lib/operator-console.ts`) MUST accept `"tasks"` (import `ConsoleSegment` from the component module or widen the literal — the three spellings must agree). `TerminalSearch.tab` and `validateTerminalSearch` in `app/frontend/src/lib/router-url.ts` MUST accept `"tasks"` (the file stays a dependency-free leaf with its own literal union); unknown values still drop to absent.

- **GIVEN** the `ConsoleSegments` strip
- **WHEN** it renders
- **THEN** three `role="tab"` buttons read `Operator Terminal`, `Activity`, `Operator Tasks` in that order
- **AND** a Vitest guard asserts `SEGMENTS.map(s => s.tab)` equals the set of `tab` values `validateTerminalSearch` accepts
- **AND** `validateTerminalSearch({ tab: "tasks" }).tab === "tasks"` while `{ tab: "bogus" }` drops the key

### Frontend: Mobile operator route

#### R3: Mobile `?tab=tasks` content slot
In `app/frontend/src/app.tsx`, the mobile operator route (`operatorConsoleTabs` gate: mobile + window route + `role === "operator"`) MUST treat `?tab=tasks` like `?tab=activity`: the surface-layout column takes the `hidden` class (mounted, never unmounted) while either non-terminal tab is active, and `<WatchedTasks server={server} sessions={sessions} onNavigate={navigateToWindow} />` mounts in the content slot where `CronActivityFeed` mounts for `activity`. Derive `consoleTab = operatorConsoleTabs ? (search.tab ?? "terminal") : "terminal"`, `activityTabActive`, `tasksTabActive`, `terminalHidden`.

- **GIVEN** a mobile viewport on the operator window's terminal route
- **WHEN** the user taps `Operator Tasks`
- **THEN** the URL gains `?tab=tasks` via an in-place `replace` search update, the terminal column is hidden (not unmounted), and the `watched-tasks` body renders
- **AND WHEN** a watched row is tapped, `navigateToWindow` routes to that window's terminal (the `tab` param drops naturally)

#### R4: Desktop `?tab=` handoff generalizes to any non-terminal tab
The once-per-arrival desktop effect in `app.tsx` (operator route, non-mobile) MUST fire for `search.tab === "activity" || search.tab === "tasks"`, dispatching `requestOperatorConsole({ action: "open", segment: search.tab })` and stripping `tab` with `replace: true`.

- **GIVEN** a desktop viewport landing on the operator terminal route with `?tab=tasks`
- **WHEN** the route resolves the operator role
- **THEN** the console opens on the Operator Tasks segment and the URL no longer carries `tab`

### Frontend: Operator console drawer

#### R5: The console body on `tasks`
In `app/frontend/src/components/operator-console.tsx`: when `segment === "tasks"` the body MUST mount `<WatchedTasks server sessions={sessionsByServer.get(server) ?? []} onNavigate dense />` and the `TerminalClient` MUST be unmounted (one relay stream per drawer, same as Activity). Segment state stays console-local (`useState<ConsoleSegment>("terminal")`), reset to `terminal` on every close path (`finishClose`, immediate close), set from `detail.segment` after the machine transition. The desktop operator-route no-op gate MUST hold only when the request carries no segment or `segment: "terminal"` (any other segment bypasses it). The mobile arm MUST map any non-terminal `detail.segment` to `tab: detail.segment` (merged with `?from=` on a cross-route navigation; in-place `replace` when already on the operator route) — byte-identical behavior for `activity`. Update the component JSDoc (`Operator Terminal | Activity | Operator Tasks`).

- **GIVEN** the open desktop drawer on Operator Terminal with the embedded terminal mounted
- **WHEN** the user selects Operator Tasks
- **THEN** `watched-tasks` renders and the terminal client is unmounted
- **AND WHEN** the drawer closes and re-opens by a plain toggle, the Operator Terminal segment is selected
- **AND GIVEN** the operator's own terminal route on desktop, **WHEN** a request carrying `segment: "tasks"` arrives, **THEN** the drawer opens (no `already viewing` toast)
- **AND GIVEN** mobile, **WHEN** a request carrying `segment: "tasks"` arrives, **THEN** the route gains `?tab=tasks`

#### R6: Desktop row click navigates and collapses
A watched-row click inside the desktop drawer MUST navigate through the router to `/$server/$window` (`params: { server, window: windowId }`, `search: {}`) and then drive the machine to `rest` via `setConsoleMachineState("rest")` — the in-console click bypasses the outside-click collapse, so the handler collapses explicitly. With no resolved server the click is a no-op.

- **GIVEN** the desktop drawer on Operator Tasks with a watched row
- **WHEN** the row's name button is clicked
- **THEN** the router navigates to that window's terminal route and the drawer collapses

#### R7: `WatchedTasks` anatomy
`app/frontend/src/components/watched-tasks.tsx` exports `WatchedTasks({ server, sessions, onNavigate, dense = false })`, a pure projection (no hook, no timer, no fetch; `nowSeconds` from `Date.now()` at render) in a `flex-1 min-h-0 flex flex-col` root with `data-testid="watched-tasks"`: (1) a pinned staleness banner rendered exactly when `watchlistStatus(...).stale` (`shrink-0 border-b border-border px-3 py-2 text-xs text-signal-yellow`, `role="status"`, `data-testid="watched-tasks-banner"`, text `operator tick — last seen {formatDuration(age)} ago`, or `operator tick — no recent tick` when the age is unknown); (2) a scroll body (`flex-1 min-h-0 overflow-y-auto px-3 py-2`) holding `<WatchedTable rows stale nowSeconds onNavigate dense />` when rows exist; (3) a centered hint line (`text-xs text-text-secondary`, `data-testid="watched-tasks-hint"`) — `no server resolved — watchlist unavailable` when `server` is empty, `No operator on this server` when `!hasOperator`, `No watched workers` when the operator exists but rows are empty. Never an error state.

- **GIVEN** sessions where one reports `operatorStale: true`
- **WHEN** `WatchedTasks` renders
- **THEN** the banner shows with the tick age and the table dims (`stale` passed through)
- **AND GIVEN** an empty `server`, **THEN** only the `no server resolved` hint renders
- **AND GIVEN** no operator window and no tick, **THEN** `No operator on this server`
- **AND GIVEN** an operator but zero monitored windows, **THEN** `No watched workers`

### Frontend: Command palette

#### R8: Palette entry `Operator: Show tasks`
`app/frontend/src/lib/palette/operator-console.ts` MUST export `buildOperatorConsoleTasksAction()` returning `{ id: "operator-console-tasks", label: "Operator: Show tasks", onSelect: () => requestOperatorConsole({ action: "open", segment: "tasks" }) }`, and `app/frontend/src/hooks/use-global-palette-actions.ts` MUST fold it into the layout-global group immediately after `operatorConsoleActivityEntry`. Always listed, no registry chord.

- **GIVEN** the command palette on any route
- **WHEN** the user types `Show tasks`
- **THEN** exactly one option `Operator: Show tasks` is listed, and selecting it opens the console on Operator Tasks (desktop) or navigates to `?tab=tasks` (mobile)

### Tests

#### R9: Unit and e2e coverage, label assertions updated
Vitest: `router-url.test.ts` (`tasks` accepted, `bogus` dropped), `terminal-activity-tabs.test.tsx` (three tabs, `?tab=tasks` selects, the union-agreement guard), `operator-console.test.tsx` (tasks segment mount/unmount, `segment: "tasks"` open, gate bypass, reset on re-open, mobile arm `?tab=tasks`, row click navigate + `rest`), `lib/palette/operator-console.test.ts` (tasks builder), `model.test.ts` (the two helpers), new `watched-table.test.tsx` and `watched-tasks.test.tsx`; `watched-zone.test.tsx` MUST stay green unchanged. Every `getByRole("tab", { name: "Terminal" })` in `terminal-activity-tabs.test.tsx`, `operator-console.test.tsx`, and `tests/e2e/mobile-cron-activity.spec.ts` becomes `{ name: "Operator Terminal" }`; every `{ name: "Activity" }` assertion is left untouched; `switchLens(page, "Terminal")` in `web-view-lens.spec.ts` is the lens switcher and is left alone. Playwright (each `test()` with the Constitution's **Proves:/Steps:** JSDoc; file headers updated for new stubbed facets): `operator-console.spec.ts` gains "the Operator Tasks segment lists watched workers and a row click navigates and collapses the drawer" (seed a `monitored` window via the sessions `page.route` stub as `server-clock-dashboard.spec.ts` does) and "desktop ?tab=tasks deep link opens the drawer on Operator Tasks and strips the param"; `operator-compose.spec.ts`'s palette assertion gains `Operator: Show tasks` toHaveCount(1); `mobile-cron-activity.spec.ts` gains "tapping Operator Tasks swaps the content slot without a full reload" and "?tab=tasks deep link lands on Operator Tasks". `server-clock-dashboard.spec.ts` stays untouched and green. All runs go through `just` recipes only.

- **GIVEN** the change applied
- **WHEN** `just test-frontend` runs
- **THEN** it is green, including the untouched `watched-zone.test.tsx`
- **AND WHEN** `just test-e2e "operator-console|mobile-cron-activity|server-clock-dashboard|operator-compose"` runs, **THEN** it is green

### Docs

#### R10: Spec records the segment and the rejected alternative
`docs/specs/cron.md` § UI — Three Tiers, tier 2(a) MUST state the desktop console drawer carries `Operator Terminal | Activity | Operator Tasks`, Operator Tasks being the watchlist rendered through the same component as the Server page WATCHED zone (tier 2b), with entry points `Operator: Show tasks` and mobile `?tab=tasks`; the **Superseded/Rejected** prose MUST add the fab-authored HTML frame displayed by path (new file-serving route + sandboxed iframe, a polling or mtime-watch refresh story, a second cross-repo file contract, an unthemed foreign page — superseded by rendering the already-derived watchlist); the Constitution V row MUST list the new palette entry.

- **GIVEN** `docs/specs/cron.md`
- **WHEN** read after apply
- **THEN** tier 2(a) names the three segments and the rejected HTML-frame alternative appears

### Non-Goals
- No new fields in the operator state YAML; no fab-kit change; no backend change; no new route, tmux option, or hook.
- No row actions on the list; no sidebar change; no status-bar chip for Tasks; no new chord.
- No Server page visual change beyond the pure component extraction.
- The `Activity` segment label is not touched (a parallel change renames it to Cron List / Cron Log).

### Design Decisions

#### Operator Tasks renders the derived watchlist, not a fab-written HTML frame
**Decision**: the console's Operator Tasks segment renders the watchlist run-kit already derives from the fab operator state file (joined onto windows server-side, riding the sessions payload).
**Why**: the frontend already holds every fact; rendering in rk gives theme tokens, terminal font, live SSE refresh, row-click navigation, and the shared `StatusDot` channels with zero new contract surface (Constitution II and X).
**Rejected**: a fab-authored `<slug>.html` displayed by path — needs a file-serving route plus a sandboxed iframe, a polling (anti-pattern) or mtime-watch refresh story, a second cross-repo file contract beside the slug rule, and looks foreign inside the drawer.
*Introduced by*: 260911-2281-console-tasks-segment-watchlist

#### One watched-list component for the Server page and the console
**Decision**: `WatchedTable` + `collectWatchedRows`/`watchlistStatus` are the single rendering of watched rows; `WatchedZone` and `WatchedTasks` are thin mounts.
**Why**: two renderings of the same rows drift the moment one gains a column or a state treatment.
**Rejected**: a second table in the console — duplicated markup and empty states.
*Introduced by*: 260911-2281-console-tasks-segment-watchlist

#### Domain-prefixed two-word segment labels
**Decision**: the segment labels are `Operator Terminal` and `Operator Tasks`; `tab` values, `?tab=` values, and internal identifiers stay `terminal`/`tasks`/`watched`.
**Why**: a parallel change renames `Activity` to `Cron List` / `Cron Log`, so every segment carries its domain prefix after both merge.
**Rejected**: a bare `Tasks` label — reads as an orphan beside two-word cron siblings.
*Introduced by*: 260911-2281-console-tasks-segment-watchlist

#### The gate and the mobile arm branch on "non-terminal segment", not an enumeration
**Decision**: the desktop operator-route no-op gate bypasses, and the mobile arm maps to `?tab=`, for any `segment` other than absent/`terminal`.
**Why**: one rule for every drawer-only view; byte-identical behavior for `activity`.
**Rejected**: enumerating `activity`/`tasks` at each site — a fourth segment would need three more edits.
*Introduced by*: 260911-2281-console-tasks-segment-watchlist

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add `collectWatchedRows(sessions)` and `watchlistStatus(sessions, nowSeconds)` to `app/frontend/src/components/server-clock-dashboard/model.ts` (lifted verbatim from `WatchedZone`'s inline derivations; `isGhostWindow` from `@/contexts/optimistic-context`); unit-test both in `model.test.ts` (ordering, ghost exclusion, stale/tickAge/hasOperator cases) <!-- R1 -->
- [x] T002 Create `app/frontend/src/components/watched-table.tsx` exporting `WatchedTable({ rows, stale, nowSeconds, onNavigate, dense = false })` with the six-column table, `WatchedRow`, and `awaitingCell` moved from `watched-zone.tsx` unchanged (same classes and test ids; `dense` swaps `py-1`/`pr-3` for `py-0.5`/`pr-2` on cells and headers only); rewrite `watched-zone.tsx` as the thin wrapper using T001's helpers; add `watched-table.test.tsx` (rows, stale dimming, awaiting/note/repo cells, navigate callback, dense padding); run `just test-frontend` and confirm `watched-zone.test.tsx` passes UNCHANGED <!-- R1 -->
- [x] T003 [P] Widen the segment union: in `app/frontend/src/components/terminal-activity-tabs.tsx` set `SEGMENTS` to `Operator Terminal` / `Activity` (untouched text) / `Operator Tasks` with `tab: "tasks"` appended, make `TerminalActivityTabs` derive `active` for all three, update the JSDoc; in `app/frontend/src/lib/operator-console.ts` type `segment?: ConsoleSegment` (import the type) or add `"tasks"` to the literal; in `app/frontend/src/lib/router-url.ts` add `"tasks"` to `TerminalSearch.tab` and `validateTerminalSearch` (keep the file dependency-free; update the header comment). Update tests: `router-url.test.ts` (`tasks` accepted, `bogus` dropped), `terminal-activity-tabs.test.tsx` (three tabs, `?tab=tasks` selects, the union-agreement guard comparing `SEGMENTS` tabs to the accepted `tab` values), and every `{ name: "Terminal" }` assertion in `terminal-activity-tabs.test.tsx` + `operator-console.test.tsx` → `{ name: "Operator Terminal" }` (leave `Activity` assertions alone) <!-- R2 -->
- [x] T004 [P] Create `app/frontend/src/components/watched-tasks.tsx` exporting `WatchedTasks({ server, sessions, onNavigate, dense = false })` per R7 (banner / scroll body with `WatchedTable` / hint line; `formatDuration` from `@/lib/format`; helpers from T001); add `watched-tasks.test.tsx` covering the banner (stale with age, stale with unknown age), the three hint states, rows rendering, and the `dense` pass-through <!-- R7 -->
- [x] T005 In `app/frontend/src/components/operator-console.tsx`: add the `segment === "tasks"` body branch mounting `WatchedTasks` (sessions from `sessionsByServer.get(server) ?? []`, `dense`, `onNavigate` navigating to `/$server/$window` with `search: {}` then `setConsoleMachineState("rest")`; no-op without a server) with the `TerminalClient` unmounted; generalize the operator-route gate to `detail.segment === undefined || detail.segment === "terminal"`; generalize the mobile arm to map any non-terminal `detail.segment` to `tab: detail.segment` (both branches); update the component JSDoc and inline comments to `Operator Terminal | Activity | Operator Tasks`. Extend `operator-console.test.tsx`: selecting Operator Tasks mounts `watched-tasks` and unmounts the terminal; `segment: "tasks"` open lands on it; the operator-route gate is bypassed for `tasks`; close + plain re-open resets to Operator Terminal; mobile arm maps `segment: "tasks"` to `search.tab = "tasks"` (cross-route with `?from=`, in-place when already there); a row click navigates and drives the machine to `rest` <!-- R5, R6 -->
- [x] T006 In `app/frontend/src/app.tsx`: derive `consoleTab` / `activityTabActive` / `tasksTabActive` / `terminalHidden`; hide the surface-layout column on `terminalHidden`; mount `{tasksTabActive && <WatchedTasks server={server} sessions={sessions} onNavigate={navigateToWindow} />}` beside the Activity feed mount; generalize the desktop `?tab=` handoff effect to `activity` or `tasks` dispatching `segment: search.tab`; update the adjacent comments <!-- R3, R4 -->
- [x] T007 [P] Add `buildOperatorConsoleTasksAction()` to `app/frontend/src/lib/palette/operator-console.ts` (id `operator-console-tasks`, label `Operator: Show tasks`, `segment: "tasks"`) with a JSDoc mirroring the Activity twin; fold `operatorConsoleTasksEntry` into `app/frontend/src/hooks/use-global-palette-actions.ts` immediately after `operatorConsoleActivityEntry` (both the array and the deps list); extend `lib/palette/operator-console.test.ts` with the tasks builder's id/label/dispatch <!-- R8 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Playwright: in `app/frontend/tests/e2e/operator-console.spec.ts` add "the Operator Tasks segment lists watched workers and a row click navigates and collapses the drawer" (extend the file's sessions `page.route` stub with a `monitored: true` window carrying `monitoredChange`/`monitoredStage`/`monitoredRepo` and `operatorLastTickAt` on the session, as `server-clock-dashboard.spec.ts` does; update the file header) and "desktop ?tab=tasks deep link opens the drawer on Operator Tasks and strips the param"; in `operator-compose.spec.ts` add `Operator: Show tasks` toHaveCount(1) beside the Activity twin assertion (update that test's JSDoc); in `mobile-cron-activity.spec.ts` update `{ name: "Terminal" }` → `{ name: "Operator Terminal" }` and add "tapping Operator Tasks swaps the content slot without a full reload" and "?tab=tasks deep link lands on Operator Tasks". Each `test()` carries the **Proves:/Steps:** JSDoc. Run `just test-e2e "operator-console|operator-compose|mobile-cron-activity|server-clock-dashboard"` and fix until green <!-- R9 -->
- [x] T009 Run the gates: `just test-frontend` (all Vitest) and `cd app/frontend && pnpm exec tsc --noEmit` (or the project's `just` type-check recipe if one exists); fix any failure at its root <!-- R9 -->

### Phase 4: Polish

- [x] T010 [P] Update `docs/specs/cron.md` § UI — Three Tiers tier 2(a) with the `Operator Terminal | Activity | Operator Tasks` strip, the shared-component note, the entry points (`Operator: Show tasks`, `?tab=tasks`), the rejected fab-HTML-frame alternative in the superseded/rejected prose, and the palette entry in the Constitution V row <!-- R10 -->

## Execution Order

- T001 blocks T002 and T004 (both import the helpers)
- T002 and T004 block T005 and T006 (they mount `WatchedTasks`)
- T003 blocks T005, T006, T007 (the widened union must compile first)
- T008 runs after T005–T007; T009 after T008; T010 is independent

## Acceptance

### Functional Completeness

- [x] A-001 R1: `WatchedTable` in `components/watched-table.tsx` renders the six-column watched table with `WatchedRow`/`awaitingCell` moved unchanged, and `collectWatchedRows`/`watchlistStatus` live in `server-clock-dashboard/model.ts` with unit tests
- [x] A-002 R1: `WatchedZone` is a thin wrapper over the helpers and `WatchedTable`; `watched-zone.test.tsx` passes with no edits
- [x] A-003 R2: `SEGMENTS` carries `Operator Terminal` / `Activity` / `Operator Tasks` in order with `tab` values `terminal`/`activity`/`tasks`; the `activity` entry text is unchanged
- [x] A-004 R2: `OperatorConsoleRequest.segment` and `TerminalSearch.tab` accept `"tasks"`; `router-url.ts` has no new imports
- [x] A-005 R3: on mobile the operator route renders `WatchedTasks` for `?tab=tasks` with the terminal column `hidden` (not unmounted)
- [x] A-006 R4: the desktop `?tab=tasks` arrival opens the console on Operator Tasks and strips the param
- [x] A-007 R5: the desktop drawer mounts `WatchedTasks` (dense) on `tasks` with the `TerminalClient` unmounted
- [x] A-008 R6: a desktop watched-row click navigates to `/$server/$window` with `search: {}` and sets the machine to `rest`
- [x] A-009 R7: `WatchedTasks` renders banner / scroll body / hint per its three states with the specified test ids
- [x] A-010 R8: `buildOperatorConsoleTasksAction()` exists with id `operator-console-tasks` and label `Operator: Show tasks`, folded in after the Activity twin
- [x] A-011 R10: `docs/specs/cron.md` tier 2(a) names the three segments, the shared component, the entry points, and the rejected HTML-frame alternative

### Behavioral Correctness

- [x] A-012 R5: the operator-route no-op gate bypasses for any non-terminal segment and still toasts for a plain `toggle`/`open`
- [x] A-013 R5: the mobile arm maps `segment: "tasks"` to `?tab=tasks` (merged with `?from=` cross-route; in-place `replace` on the route) and `activity` behaves exactly as before
- [x] A-014 R5: closing the drawer by any path and re-opening with a plain request lands on Operator Terminal
- [x] A-015 R2: the mobile `TerminalActivityTabs` wrapper selects `Operator Tasks` for `?tab=tasks` and `Operator Terminal` when `tab` is absent

### Scenario Coverage

- [x] A-016 R9: Vitest covers the union-agreement guard, `?tab=tasks` validation, the tasks segment in the console, the mobile arm, the row-click collapse, the palette builder, `WatchedTable`, `WatchedTasks`, and the two model helpers; `just test-frontend` is green
- [x] A-017 R9: Playwright covers the Operator Tasks segment listing + row-click collapse, the desktop `?tab=tasks` deep link, the palette entry count, and the mobile tap/deep-link; `just test-e2e "operator-console|operator-compose|mobile-cron-activity|server-clock-dashboard"` is green, with `server-clock-dashboard.spec.ts` untouched
- [x] A-018 R9: every Playwright `test()` added or modified carries a **Proves:/Steps:** JSDoc, and touched spec files' headers describe any new stubbed payload facets
- [x] A-019 R9: all `{ name: "Terminal" }` tab assertions read `Operator Terminal`; no `{ name: "Activity" }` assertion and no `switchLens` call was modified

### Edge Cases & Error Handling

- [x] A-020 R7: an empty `server` renders only the `no server resolved — watchlist unavailable` hint; no operator renders `No operator on this server`; an operator with zero monitored windows renders `No watched workers` — never an error or a thrown render
- [x] A-021 R7: a stale watchlist renders the yellow `role="status"` banner (with `no recent tick` when the age is unknown) and passes `stale` into the table's dimming
- [x] A-022 R6: a row click with no resolved server is a no-op (no navigate, no machine change)
- [x] A-023 R2: `validateTerminalSearch({ tab: "bogus" })` still drops the key

### Code Quality

- [x] A-024 Pattern consistency: new components follow the colocated-test, `data-testid`, `text-xs font-mono` and `controlClass` idioms of `watched-zone.tsx`, `cron-activity-feed.tsx`, and `terminal-activity-tabs.tsx`
- [x] A-025 No unnecessary duplication: the watched table markup exists exactly once (`watched-table.tsx`); no second rendering in the console or the zone
- [x] A-026 No client polling: `WatchedTasks` and `WatchedTable` hold no timer, `setInterval`, or fetch — ages compute at render from the sessions payload
- [x] A-027 Type narrowing over assertions: the widened union is derived from `SEGMENTS` (`as const`) rather than `as` casts at use sites, except the existing `as const` on literal `tab` values in navigate calls
- [x] A-028 Comment discipline: new comments state constraints (one-relay-stream rule, why the row handler collapses explicitly, why `router-url.ts` keeps its own literal) and cite no change IDs or PR numbers
- [x] A-029 Tests through `just` only: no direct `pnpm test`, `vitest`, or `playwright test` invocations recorded in the apply run
- [x] A-030 Every user-facing action is palette-registered (Constitution V): `Operator: Show tasks` exists and no other new action lacks an entry

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Merge hygiene: a parallel change edits the `activity` entry and its label assertions — this change must not touch them.

## Deletion Candidates

- None — this change adds new functionality (the Operator Tasks segment) and performs a pure extraction: `watched-zone.tsx`'s inline row rendering moved verbatim into `watched-table.tsx` with its imports following it, leaving no orphaned symbol, file, or branch behind.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `WatchedTable` lives in `components/watched-table.tsx`; the two helpers join the existing `server-clock-dashboard/model.ts` | The intake offered both placements; the zone module already has a pure-helper file with tests, and a shared component belongs beside the other top-level shared components | S:80 R:95 A:90 D:85 |
| 2 | Confident | `dense` = `py-0.5`/`pr-2` cell + header padding, nothing else | Smallest change that tightens the console variant; the scroll body handles overflow; all six columns kept per the intake | S:60 R:95 A:80 D:70 |
| 3 | Certain | `lib/operator-console.ts` imports `ConsoleSegment` from the component module; `router-url.ts` keeps its own literal union guarded by the agreement test | `router-url.ts` is a dependency-free leaf by design; the component module already exports the derived type | S:85 R:90 A:90 D:85 |
| 4 | Certain | Gate and mobile arm branch on "segment absent or `terminal`" vs "any other" | Intake assumption #9; one rule per site, byte-identical for `activity` | S:80 R:90 A:90 D:85 |
| 5 | Confident | Desktop row click: navigate then `setConsoleMachineState("rest")`; mobile row click: `navigateToWindow` | Intake assumptions #7/#13; verified no in-drawer navigation exists today | S:80 R:85 A:80 D:75 |
| 6 | Confident | `WatchedTasks` takes `sessions` by prop | Intake assumption #11; keeps it a pure projection like `WatchedZone` | S:60 R:90 A:80 D:70 |
| 7 | Certain | `WatchedTasks` hint line carries `data-testid="watched-tasks-hint"`; banner `watched-tasks-banner`; root `watched-tasks` | Test ids needed for Vitest/Playwright; follows the feed's `cron-activity-banner` idiom | S:85 R:95 A:90 D:90 |
| 8 | Confident | The spec edit (`docs/specs/cron.md`) is an apply task; memory edits are hydrate's | Specs are human-curated but the intake named the exact edits; memory hydration is the pipeline's hydrate stage by contract | S:70 R:95 A:85 D:80 |
| 9 | Confident | Type check runs via `pnpm exec tsc --noEmit` from `app/frontend` if no `just` type-check recipe exists | `code-quality.md` names `npx tsc --noEmit`; the repo uses pnpm | S:60 R:95 A:85 D:75 |

| 10 | Confident | The mobile `TerminalActivityTabs` wrapper gains `shrink-0 pt-9` so the strip starts below the console tongue's `absolute top-0 h-9 w-16` centered hit box — with three equal segments the middle one's center would otherwise sit under the tongue | Recorded at apply (reviewer should-fix): a layout adjustment beyond R2's active-derivation scope, justified by the tongue geometry and covered by the green mobile e2e; desktop strip unaffected | S:70 R:90 A:80 D:75 |

10 assumptions (4 certain, 6 confident, 0 tentative).
