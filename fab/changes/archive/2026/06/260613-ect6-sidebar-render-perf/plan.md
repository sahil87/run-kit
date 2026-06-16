# Plan: Sidebar Render Performance (memoize tree + leaf-scope the now-tick)

**Change**: 260613-ect6-sidebar-render-perf
**Intake**: `intake.md`

## Requirements

### Render Perf: Leaf-scoped now-tick

#### R1: `useNow()` leaf hook
The frontend SHALL provide a `useNow()` hook that returns the current epoch seconds (`Math.floor(Date.now() / 1000)`) and self-updates once per second via a `setInterval`, re-rendering only the component that calls it. The interval MUST be cleared on unmount via a `useEffect` cleanup.

- **GIVEN** a component calls `useNow()`
- **WHEN** one second elapses
- **THEN** the hook returns an incremented epoch-seconds value and re-renders that component (not its ancestors)
- **AND** when the component unmounts, the underlying interval is cleared (no leak)

#### R2: Remove `nowSeconds` prop-threading
`nowSeconds` SHALL NOT be computed in the `Sidebar` render body nor in `BottomPanels`, and SHALL NOT be threaded as a prop through `ServerGroup` → `WindowRow` or into `WindowPanel`. Each duration-displaying leaf MUST read the current time from `useNow()` internally.

- **GIVEN** the `Sidebar` renders
- **WHEN** the SSE stream ticks (no time change)
- **THEN** no `Math.floor(Date.now()/1000)` is recomputed at the `Sidebar`/`BottomPanels`/`ServerGroup` level and no `nowSeconds` prop is passed to `WindowRow`/`WindowPanel`
- **AND** the duration text still updates once per second from the leaf's own `useNow()`

#### R3: Duration display via a leaf subcomponent in `WindowRow`
The per-window duration in `WindowRow` SHALL be rendered by a dedicated leaf subcomponent (`WindowDuration`) that calls `useNow()` internally and renders `getWindowDuration(win, now)`, so that the per-second tick re-renders only the duration text node, not the whole `WindowRow`. `WindowRow` itself MUST NOT call `useNow()`.

- **GIVEN** a `WindowRow` showing an idle window with a duration
- **WHEN** one second elapses
- **THEN** only the `WindowDuration` leaf re-renders; the surrounding `WindowRow` does not
- **AND** for an active window (`getWindowDuration` returns `""`) the leaf renders nothing

#### R4: Duration display in `WindowPanel` reads `useNow()` internally
The bottom `WindowPanel` (`status-panel.tsx`) SHALL read the current time from `useNow()` inside the component that computes the idle/process line (`WindowContent`), instead of receiving a `nowSeconds` prop.

- **GIVEN** the `WindowPanel` shows an idle window's `run` line
- **WHEN** one second elapses
- **THEN** the idle duration in the `run` line updates from the panel's own `useNow()`
- **AND** no `nowSeconds` prop is required to render the panel

### Render Perf: Memoized rows with stable props

#### R5: `React.memo` the row components
`WindowRow`, `SessionRow`, and `ServerGroup` SHALL each be wrapped in `React.memo` so that an SSE tick on an unrelated server (or any rerender that does not change a row's inputs) does not re-render that row.

- **GIVEN** a memoized `WindowRow`/`SessionRow`/`ServerGroup` with referentially-stable props
- **WHEN** the parent re-renders with the same prop references
- **THEN** the memoized component's render body does NOT re-run

#### R6: Stabilize per-row handler/closure props
The per-`ServerGroup` and per-row event handlers built inline in `Sidebar`'s render (the ~30 arrow handlers passed to each `ServerGroup`, and the per-`WindowRow`/`SessionRow` closures built inside `ServerGroup`) SHALL be referentially stable across renders that do not change their identity inputs, so that `React.memo` (R5) is effective. Handlers SHALL be `useCallback`s in `Sidebar` that accept identity (`server`/`session`/`windowId`) as arguments, following the existing `toggleSession` pattern; leaves bind their own identity when invoking.

- **GIVEN** the `Sidebar` re-renders on an SSE tick
- **WHEN** a `ServerGroup`'s data is unchanged
- **THEN** every handler prop it received is the same reference as the previous render
- **AND** the group's `React.memo` skips the re-render

#### R6a: `Sidebar`'s own incoming handler props are stable at the caller (rework)
<!-- rework: outward review — ServerGroup memo (R5/R6) is inert on the SSE-tick path because three handler props ARE inline arrows in Sidebar's PARENTS (app.tsx AppShell + board-page.tsx), recreated every tick -->
The handler props `Sidebar` itself *receives* from its callers and threads down to `ServerGroup`/rows — `onSelectWindow`, `onCreateWindow`, `onCreateSession` — MUST be referentially stable across SSE ticks. They are defined in `Sidebar`'s parents `AppShell` (`app.tsx`) and `BoardPage` (`board-page.tsx`), both of which consume `useSessionContext()` and therefore re-render on every SSE tick; inline arrow definitions there recreate the references each tick and defeat `ServerGroup`'s `React.memo` for **every** group, including the currently-viewed one. They SHALL be wrapped in `useCallback` at their source (the underlying helpers — `navigateToWindow`, `handleCreateWindow`, `handleCreateSessionInstant`, `executeCreateWindow`, `executeCreateSessionInstant` — are already `useCallback`s). (R6 covered handlers *built inside* `Sidebar`; this requirement covers the handlers `Sidebar` *receives*, which the initial implementation did not examine.)

- **GIVEN** `AppShell`/`BoardPage` re-render on an SSE tick (no user navigation/creation intent)
- **WHEN** the `sidebarElement` is rebuilt
- **THEN** `onSelectWindow`, `onCreateWindow`, and `onCreateSession` keep their previous references
- **AND** `ServerGroup`'s `React.memo` can actually skip unchanged groups on the tick

#### R7: Map/array context props are stable refs
The Map/array props consumed by the memoized rows (`rowTints`, `ansiPalette`, `allBoards`/`boards`, `pinnedSet`, `pinnedToBoard`, `isPinnedToActiveBoardFor`) MUST be referentially stable across SSE session ticks; any that churn per render SHALL be stabilized at their source, or the churn documented as accepted.

- **GIVEN** an SSE session tick (no theme/board change)
- **WHEN** `Sidebar` re-renders
- **THEN** `rowTints`, `ansiPalette`, `allBoards`, `pinnedSet`, `pinnedToBoard`, and `isPinnedToActiveBoardFor` keep their previous references

### Invariants (preserved, not changed)

#### R8: Derive-over-store session order preserved
The derive-over-store session-order pattern (`orderOverrideRef.current[server] ?? sseOrder` with the render-time `arraysEqual` reconcile that clears the override and the render-time ref mutation, `index.tsx ~757-771`) SHALL remain unchanged. Memoization MUST NOT reintroduce a whole-Map watcher effect.

- **GIVEN** a session reorder drag with a transient override
- **WHEN** the SSE order echoes the new arrangement
- **THEN** the override is cleared at render time via `arraysEqual` exactly as before, with no new watcher effect

#### R9: #259 triage signal preserved
After memoization, `WindowRow` SHALL still render the `#259` triage signals: the `fabDisplayState === "failed"` red text on the stage label and the activity dot, and the `isFailish` PR-failure red glyph (gated on `fabChange && prNumber`).

- **GIVEN** a window with `fabDisplayState === "failed"` and/or a failing PR
- **WHEN** the row renders
- **THEN** the stage text + dot use `text-red-400` and the PR-fail glyph shows, identical to pre-change behavior

#### R10: Single-source selection preserved
The `isSelected` derivation (URL window-id first, `isActiveWindow` fallback; `index.tsx ~1192-1197`) and the existing intra-`WindowRow` `useMemo`s (`tint`, `uncoloredSelectedTint`, `borderColor`, `buttonStyle`, `buttonClass`) SHALL remain unchanged.

- **GIVEN** a window route with a URL window id
- **WHEN** a row renders
- **THEN** selection keys on `currentWindowId === win.windowId` (falling back to `isActiveWindow` only when no URL window), unchanged

### Design Decisions

1. **Leaf `WindowDuration` for the row, `useNow()` in `WindowContent` for the panel**: the row's duration is an isolated text node, so a `<WindowDuration>` leaf maximizes the memo benefit (the row stays static). The panel's idle string is interwoven into a larger composed line (`{command} — idle {idle}`) computed in `WindowContent`, and the panel is a single bottom-pinned instance (not the per-row tree), so calling `useNow()` directly in `WindowContent` is the minimal, readable change — *Why*: matches the intake's "read `useNow()` (or a duration leaf) inside it" allowance; a forced text-node split there would fragment the run-line composition for no tree-scale win. — *Rejected*: a separate panel duration leaf (needless complexity for a single instance).
2. **Identity-arg `useCallback`s over a keyed-factory cache**: stabilize handlers as a fixed set of `useCallback`s that take `server`/`session`/`windowId` arguments, following the existing `toggleSession` — *Why*: one stable callback per logical action, no per-id closure cache to invalidate. — *Rejected*: a `useCallback` factory keyed by id (more state, GC churn).

### Non-Goals

- No backend, API, or SSE-protocol change. No new route.
- Not changing the intentional fresh-ref `slicesByServer` rebuild in `session-context.tsx` — the memoization absorbs it on the consumer side.
- No Playwright e2e added (unit tests prove memo behavior; the perf win is a render-count property, not a user-visible behavior change).

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/hooks/use-now.ts` exporting `useNow(): number` (epoch seconds, 1s `setInterval`, `useEffect` cleanup), matching the repo's hooks-dir convention. <!-- R1 -->
- [x] T002 [P] Add `app/frontend/src/hooks/use-now.test.ts` proving the initial value, the 1s tick increment (fake timers), and interval cleanup on unmount. <!-- R1 -->

### Phase 2: Core Implementation — leaf now-tick

- [x] T003 In `app/frontend/src/components/sidebar/window-row.tsx`: add a `WindowDuration({ win })` leaf subcomponent that calls `useNow()` and renders `getWindowDuration(win, now)` inside the existing `text-xs text-text-secondary` span; remove the `nowSeconds` prop from `WindowRowProps` and the component signature; replace the inline `duration` usage with `<WindowDuration win={win} />`. <!-- R3 R2 -->
- [x] T004 In `app/frontend/src/components/sidebar/status-panel.tsx`: remove `nowSeconds` from `WindowPanelProps` and `WindowContent`'s props; call `const nowSeconds = useNow()` inside `WindowContent`; keep `getProcessLine(win, nowSeconds)` unchanged. <!-- R4 R2 -->
- [x] T005 In `app/frontend/src/components/sidebar/index.tsx`: delete `const nowSeconds = Math.floor(Date.now()/1000)` in the `Sidebar` body (~:697) and in `BottomPanels` (~:907); drop `nowSeconds` from `ServerGroupProps`, the `ServerGroup` JSX, the `WindowRow` call site, and the `<WindowPanel>` JSX. <!-- R2 -->

### Phase 3: Core Implementation — memo + prop stabilization

- [x] T006 In `index.tsx`: convert the inline `Sidebar`→`ServerGroup` arrow handlers (kill/rename/color/create/drag closures, ~:804-871) into identity-arg `useCallback`s (taking `server` as a leading argument where they currently close over `srvInfo.name`), following the `toggleSession` pattern; pass the stable callbacks to `ServerGroup`. Verify `rowTints`/`ansiPalette`/`allBoards`/`pinnedSet`/`pinnedToBoard`/`isPinnedToActiveBoardFor` are stable refs (R7) and document any accepted churn. <!-- R6 R7 -->
- [x] T007 In `index.tsx`: wrap `ServerGroup` in `React.memo` (`const ServerGroup = React.memo(function ServerGroup(props){…})`). Confirm per-group slice props passed from `Sidebar` (`editingWindow`/`dragSource`/`dropTarget`/`sessionDropTarget` etc.) yield stable values (e.g. `null`) for unaffected groups. <!-- R5 R8 --> <!-- rework-verified: after T014/T015, the three caller-supplied handlers (`onSelectWindow`/`onCreateWindow`/`onCreateSession`, index.tsx:856-858) are stable useCallbacks; `rawSessions` for an unaffected group keeps its array ref (updateSlice replaces only the changed server's slice, session-context.tsx:216-227). The group's React.memo now genuinely skips an unchanged group on a tick affecting a DIFFERENT server. The currently-viewed group still re-renders on its own data tick (correct). -->
- [x] T008 In `session-row.tsx`: wrap `SessionRow` in `React.memo`. In `index.tsx` (`ServerGroup` body, ~:1147-1166), stabilize the per-`SessionRow` closures via identity-arg `useCallback`s in `Sidebar` + identity props so the row receives stable handler references. <!-- R5 R6 -->
- [x] T009 In `window-row.tsx`: wrap `WindowRow` in `React.memo`. In `index.tsx` (`ServerGroup` body, ~:1223-1236), stabilize the per-`WindowRow` closures (`onSelectWindow`, `onDoubleClickName`, `onKillClick`, drag handlers, `onColorChange`, `isPinnedToBoard`) via identity-arg `useCallback`s + identity props. Preserve the `#259` triage signal (R9), single-source selection (R10), and the existing intra-component `useMemo`s. <!-- R5 R6 R9 R10 -->

### Phase 4: Tests

- [x] T010 Update `app/frontend/src/components/sidebar/window-row.test.tsx`: remove the `nowSeconds` prop from all render helpers; where a deterministic clock is needed for duration assertions use `vi.useFakeTimers()` + `vi.setSystemTime()`. Keep the existing triage-signal and hover-cluster tests green. <!-- R2 R3 R9 -->
- [x] T011 Update `app/frontend/src/components/sidebar/status-panel.test.tsx`: remove the `nowSeconds` prop from all `render(<StatusPanel .../>)` calls; drive the idle-duration tests deterministically via `vi.setSystemTime()` so `useNow()` yields the previously-passed `nowSeconds` value (e.g. `3700`). <!-- R2 R4 -->
- [x] T012 [P] Create `app/frontend/src/components/sidebar/window-row.test.tsx` memo assertion (or a sibling block): render a `React.memo`'d `WindowRow` with a stable prop set, rerender with identical references, and assert the render body did not re-run (render-count spy). <!-- R5 -->
- [x] T013 [P] Create `app/frontend/src/components/sidebar/session-row.test.tsx`: a basic render test plus a memo no-re-render test (stable props across rerender → render body does not re-run). <!-- R5 -->

### Phase 5: Caller-side handler stabilization (rework — R6a)

- [x] T014 In `app/frontend/src/app.tsx` (`AppShell`): wrap the three inline `<Sidebar>` handler props — `onSelectWindow` (~:1099), `onCreateWindow` (~:1111), `onCreateSession` (~:1118) — in `useCallback`s with correct dependency arrays (deps include `server`, `navigateToWindow`, `navigate`, `isMobile`, the already-stable `handleCreateWindow`/`executeCreateWindow`/`handleCreateSessionInstant`/`executeCreateSessionInstant`, and `ctx.sessionsByServer` only where actually read). Pass the stabilized callbacks so the `sidebarElement` no longer recreates them on every SSE tick. Keep the exact branching behavior (current-vs-cross-server) intact. <!-- R6a -->
- [x] T015 In `app/frontend/src/components/board/board-page.tsx`: wrap the inline `onSelectWindow` (~:360) in a `useCallback` (deps `navigate`, `isMobile`, `setSidebarOpen`). NOTE: the plan asserted `onCreateSession` (`handleCreateSession`) was already stable, but it depended on `ctx.sessionsByServer` — a fresh Map every SSE tick — so it churned and defeated `ServerGroup`'s memo on the board route (where `currentServer===null` threads it into every group). Fixed at the root: `handleCreateSession` now reads `ctx.sessionsByServer` via a render-time `sessionsByServerRef`, deps `[executeCreateSession]`. `handleCreateWindow` (`[executeCreateWindow]`) was genuinely already stable. <!-- R6a -->

## Execution Order

- T001 blocks T002, T003, T004 (the hook must exist before consumers/tests import it).
- T003-T005 (now-tick removal) precede T006-T009 (memo) — `nowSeconds` must be gone before memo is meaningful, but the prop-removal in T005 and the call-site memo work in T009 both edit the same `WindowRow` call site, so do T005 before T009.
- T006 blocks T007 (the group memo needs stable handler refs to be effective).
- Tests T010-T013 after their respective implementation tasks.
- T014/T015 (caller-side R6a, rework) complete the memo effectiveness on the SSE-tick path; re-verify T007's group-memo claim after they land. These are leaf edits in `app.tsx`/`board-page.tsx`, independent of the sidebar-internal tasks.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `useNow()` exists in `app/frontend/src/hooks/use-now.ts` (`useNow(): number`), returns `Math.floor(Date.now()/1000)`, ticks at 1s via `setInterval`, clears the interval in the `useEffect` cleanup. Covered by `use-now.test.ts` (3 tests).
- [x] A-002 R2: No `Math.floor(Date.now()/1000)` remains in `Sidebar`/`BottomPanels` (grep-verified absent from `index.tsx`); `nowSeconds` is absent from `ServerGroupProps`, `WindowRowProps`, `WindowPanelProps`, and every call site.
- [x] A-003 R3: `WindowRow` renders duration via the `WindowDuration` leaf (`window-row.tsx:360-365`) that calls `useNow()`; `WindowRowInner` itself does not call `useNow()` (only `WindowDuration` does).
- [x] A-004 R4: `WindowContent` calls `const nowSeconds = useNow()` (`status-panel.tsx:171`) and feeds it to `getProcessLine`; the `run` line idle duration still renders (verified by the `idle 1h` status-panel tests).
- [x] A-005 R5: `WindowRow` (`window-row.tsx:354`), `SessionRow` (`session-row.tsx:200`), and `ServerGroup` (`index.tsx:1280`) are each wrapped in `memo`.
- [x] A-006 R6: Per-`ServerGroup`/per-row handlers are stable `useCallback`s with identity-arg signatures (`handleSessionRowKill`, `handleWindowRowKill`, `handleSessionColorChange`, `handleWindowColorChange`, drag handlers, etc., `index.tsx:723-749`); all dep arrays verified correct (no stale closures). Proven by the render-count `React.memo` tests in `window-row.test.tsx` / `session-row.test.tsx`.
- [x] A-007 R7: `rowTints` (`useMemo([theme.palette])`), `ansiPalette` (`theme.palette.ansi`), `allBoards`/`pinnedSet`/`pinnedToBoard` (from `useWindowPins` — `useState`/`useCallback`, only change on board-change SSE), and `isPinnedToActiveBoardFor` (`useCallback([activeBoardName, pinnedToBoard])`) are all referentially stable across session-SSE ticks. Verified at source.

### Behavioral Correctness

- [x] A-008 R3: For an active window `getWindowDuration` returns `""`, so `WindowDuration` returns `null` (`window-row.tsx:363`) — renders nothing, matching prior behavior.
- [x] A-009 R5: The `React.memo` render-count tests in `window-row.test.tsx` and `session-row.test.tsx` (Profiler commit count: mount-only, no extra commit on identical-prop rerender) prove a memoized row does not re-run its body with stable props.

### Scenario Coverage

- [x] A-010 R1: `use-now.test.ts` exercises first-render value, 1s tick increment (fake timers), and `clearInterval`-on-unmount.
- [x] A-011 R8: The derive-over-store reconcile (`index.tsx:817-823`: `localOrder = override ?? null` + `if (override && arraysEqual(override, sseOrder)) { delete ...; localOrder = null; }`, ref mutation at render) is unchanged; no whole-Map watcher effect was added (the `forceRender` reducer at `:238` is the deliberate replacement, driven by drag events only). `index.test.tsx` (8 tests) passes.
- [x] A-012 R9: `window-row.test.tsx` triage-signal tests (failed-stage red text/dot, PR-fail glyph) all pass; the `fabDisplayState === "failed"` red treatment and `isFailish`-gated glyph are intact in `WindowRowInner`.
- [x] A-013 R10: Single-source `isSelected` derivation (`index.tsx:1196-1201`, URL window-id first / `isActiveWindow` fallback) and the intra-`WindowRow` `useMemo`s (`tint`, `uncoloredSelectedTint`, `borderColor`, `buttonStyle`, `buttonClass`) are unchanged. `index.test.tsx` passes.

### Edge Cases & Error Handling

- [x] A-014 R1: `use-now.test.ts` "clears the interval on unmount (no leak)" asserts `clearInterval` is called on unmount.

### Code Quality

- [x] A-015 Pattern consistency: `useNow` lives in `app/frontend/src/hooks/use-now.ts` alongside the other `use-*.ts` hooks; the identity-arg `useCallback` stabilization mirrors the existing `toggleSession` pattern.
- [x] A-016 No unnecessary duplication: `WindowDuration` reuses `getWindowDuration` (which calls `formatDuration` from `lib/format.ts`); `getProcessLine` is unchanged. No duration-formatting reimplementation.
- [x] A-017 No client polling anti-pattern: `useNow`'s `setInterval` drives a display-only local clock (no fetch), documented as such in the hook JSDoc; does not violate the "no client polling — use the SSE stream" anti-pattern.
- [x] A-018 Type narrowing: no new `as` casts in the touched source files; prop-type changes are clean `nowSeconds` removals.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

- `WindowRowProps.nowSeconds` / `WindowPanelProps.nowSeconds` / `ServerGroupProps.nowSeconds` — already removed by this change; the prop-threading they enabled is fully replaced by the `useNow()` leaf. No residual references remain (grep-verified; only the internal `getProcessLine(win, nowSeconds)` parameter name survives, which is correct).
- The two render-body `const nowSeconds = Math.floor(Date.now()/1000)` computations (former `Sidebar` body + `BottomPanels`) — removed in the same diff; grep confirms no `Math.floor(Date.now()` remains in `index.tsx`/`app.tsx`/`board-page.tsx`.
- The inline-arrow `onSelectWindow`/`onCreateWindow`/`onCreateSession` definitions in `app.tsx` `AppShell` and `board-page.tsx` `BoardPageContent` — replaced (not duplicated) by the named `useCallback`s `handleSidebarSelectWindow`/`handleSidebarCreateWindow`/`handleSidebarCreateSession` (app.tsx) and `handleSelectWindow` (board-page.tsx). No orphaned copies remain.
- None further — this change replaces prop-threading with a leaf hook, hoists handlers to stable `useCallback`s, and adds memoization. The `execute*` functions, `deriveInstantSessionName`, and all optimistic-action hooks remain live and referenced. No orphaned helpers, dead branches, or now-unused exports were introduced by either the original implementation or the R6a rework.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Wrap `WindowRow`/`SessionRow`/`ServerGroup` in `React.memo` and lift the `now` tick into a leaf `useNow()` hook instead of prop-threading `nowSeconds`. | Backlog prescribes both moves verbatim and states they MUST travel together; grep confirms no existing `React.memo` to conflict with. | S:95 R:75 A:95 D:95 |
| 2 | Certain | Preserve the derive-over-store session-order pattern; do not reintroduce a whole-Map watcher effect. | Explicit backlog directive + prior fix `260609-ebks` + memory [[sidebar-session-order-derive-over-store]]. | S:95 R:70 A:95 D:95 |
| 3 | Certain | Wave-1 `sidebar-triage-signal` (#259) already merged; preserve `fabDisplayState==="failed"` red treatment + `isFailish` PR dot. | Verified in git history at intake time. | S:90 R:80 A:95 D:90 |
| 4 | Certain | Place `useNow` at `app/frontend/src/hooks/use-now.ts`. | Confirmed at apply time: `app/frontend/src/hooks/` exists and holds all `use-*.ts` hooks (use-boards, use-is-mobile, etc.). The intake's Tentative assumption is now resolved by direct inspection. | S:90 R:90 A:95 D:90 |
| 5 | Confident | `useNow()` ticks at 1 second via `setInterval`. | Display granularity is seconds (`formatDuration` floors to `Ns`/`Nm`/`Nh`); matches the existing per-render precision. Trivially reversible. | S:70 R:90 A:85 D:80 |
| 6 | Confident | Stabilize per-row handlers via identity-arg `useCallback`s in `Sidebar`, following `toggleSession`. | Codebase already uses this pattern; one stable callback per action. Reversible refactor confined to `index.tsx`. | S:65 R:85 A:80 D:70 |
| 7 | Confident | The `WindowRow` duration consumer is a tiny `WindowDuration` leaf; the `WindowPanel` reads `useNow()` directly in `WindowContent` (no separate panel leaf). | Backlog offers the leaf-or-precompute choice; the row benefits most from a text-node leaf, while the panel's interwoven run-line + single-instance nature makes an in-`WindowContent` `useNow()` the minimal readable change. | S:70 R:85 A:80 D:65 |
| 8 | Confident | Panel/row duration tests use `vi.useFakeTimers()` + `vi.setSystemTime()` to make `useNow()`'s `Date.now()` deterministic, replacing the removed explicit `nowSeconds` prop. | The status-panel test already installs fake timers in `beforeEach`; setting system time reproduces the prior fixed-clock assertions (e.g. `3700` → `1h`) without the prop. Reversible test-only change. | S:65 R:95 A:85 D:75 |

8 assumptions (4 certain, 4 confident, 0 tentative).
