# Plan: Board-Route PANE & HOST Panels

**Change**: 260720-zx4i-board-route-pane-host-panels
**Intake**: `intake.md`

## Requirements

### Frontend: HOST panel host-metrics fallback

#### R1: HOST panel falls back to host-global metrics
`HostPanel` (`app/frontend/src/components/sidebar/host-panel.tsx`) MUST render the host-global metrics broadcast (`useHostMetrics()`) whenever the server-scoped `useMetrics()` result is `null`. The fallback is general (not board-route-gated): server-scoped metrics win when present.

- **GIVEN** the sidebar is rendered on `/board/$name` (no `server` route param, so `useMetrics()` is `null`)
- **WHEN** the host-global `metrics` broadcast has delivered a snapshot
- **THEN** the HOST panel renders the hostname header and the `HostMetrics` rows from that snapshot instead of "No metrics"
- **AND** on a `/$server/...` route with server-scoped metrics present, the panel renders those unchanged

#### R2: HOST connection dot uses host-metrics health when no current server
`BottomPanels` (`app/frontend/src/components/sidebar/index.tsx`) MUST derive `HostPanel`'s `isConnected` prop from `ctx.hostMetricsConnected` when `currentServer` is `null`, instead of the always-false server-scoped lookup. On server routes the existing `isConnectedByServer` derivation is unchanged.

- **GIVEN** the board route (`currentServer === null`) with host metrics flowing (`hostMetricsConnected === true`)
- **WHEN** the HOST panel header renders
- **THEN** the SSE dot shows connected (green, `title="SSE connected"`)
- **AND** on a server route the dot still reflects that server's subscription state

### Frontend: Focused-pane context

#### R3: New focused-pane context publishes the board's focused tile
A new context module `app/frontend/src/contexts/focused-pane-context.tsx` SHALL exist, mirroring the `top-bar-slot-context` pattern (provider with a referentially-stable dispatcher, read hook that throws outside the provider, register hook that publishes via an effect and clears on unmount, colocated `.test.tsx`). The published value SHALL carry the focused tile's identity plus the thin board-entry data needed for the pin-only fallback: `{ server, windowId, windowName, panes: BoardPaneInfo[] }`, or `null` when no tile is focused. The provider MUST be mounted in `RootWrapper` (`app/frontend/src/app.tsx`) alongside `TopBarSlotProvider` so both the AppShell and board sidebars can read it.

- **GIVEN** `BoardPage` is mounted with a non-empty board
- **WHEN** it registers the focused tile via the register hook
- **THEN** `useFocusedPane()` consumers anywhere under `RootWrapper` read that value
- **AND** when `BoardPage` unmounts (navigation away) the value clears back to `null`
- **AND** with an empty board the registered value is `null` (panels behave as today)

#### R4: BoardPage publishes the focused tile and the stale comment is corrected
`BoardPage` (`app/frontend/src/components/board/board-page.tsx`) MUST publish the focused entry (`entries[focusedIndex]`) into the focused-pane context via the register hook (memoized so the effect re-runs only when the focused entry changes). The comment block above the `focusedPane` memo (~line 458–469) claiming pinned windows "can NOT" be looked up in `ctx.sessionsByServer` MUST be corrected: that limitation applies only to the filtered `_rk-pin-*` pin-session copy; the LINK-based home-session copy IS present in the SSE stream (dual home+pin membership), and `BoardEntry.panes` is used there because it matches terminal-mode's active-pane cwd semantics and is available even for pin-only windows.

- **GIVEN** a board with pinned tiles and `focusedIndex` pointing at one
- **WHEN** the board renders or focus cycles
- **THEN** the context value is `{ server, windowId, windowName, panes }` of the focused entry
- **AND** the corrected comment no longer contradicts the lookup mechanism this change relies on

### Frontend: PANE panel focused-tile fallback

#### R5: BottomPanels falls back to the focused board pane
`BottomPanels` (`app/frontend/src/components/sidebar/index.tsx`) MUST, when the route provides no selected window (`selectedWindow` is `null`) and a focused pane is published, resolve the window by `windowId` across all sessions in `ctx.sessionsByServer.get(server)` and pass the resolved `WindowInfo` to `WindowPanel` unchanged (`WindowPanel` stays a pure `WindowInfo | null` component). The dual home+pin membership guarantees the home-session copy flows through the SSE stream fully enriched (fab/PR/agent registers).

- **GIVEN** `/board/$name` with a focused tile whose home session is alive on the SSE stream
- **WHEN** the sidebar bottom panels render
- **THEN** the PANE panel shows the focused window's enriched registers (tmx/cwd/git + out/agt/fab/PR as present) instead of "No window selected"
- **AND** cycling tile focus follows the new focused tile

#### R6: Pin-only windows get a thin render from board-entry data
When the `windowId` lookup misses (pin-only window — home session died while pinned), `BottomPanels` MUST fall back to a thin `WindowInfo` synthesized from the published board-entry data (`windowName` + `panes`: paneId/paneIndex/cwd/command/isActive/gitBranch), rendered through the same pure `WindowPanel`. Enrichment-only registers (fab/PR/agent) are honestly absent. The resolution + synthesis SHALL live as pure exported helpers in `app/frontend/src/lib/focused-pane-window.ts` with a colocated unit test (pure-helper convention, mirrors `lib/board-reorder.ts`).

- **GIVEN** a focused tile whose `windowId` appears in no session of `ctx.sessionsByServer.get(server)`
- **WHEN** the PANE panel renders
- **THEN** it shows the tmx (pane index/id), cwd, and git rows from the entry's pane data with no fab/PR/agent registers
- **AND** the synthesized window uses `activityTimestamp: 0` so the `out` register shows the command without a bogus idle duration
- **AND** with no focused pane at all (empty board) the panel shows "No window selected" as today

### Non-Goals

- No backend/API changes, no new endpoints, no new routes (Constitution IV) — the fill is a pure client-side join.
- No server-side enrichment of `GET /api/boards/{name}` (explicitly rejected in the intake: staleness between `board-changed` refetches + duplicates live SSE enrichment).
- No per-pane selection inside multi-pane tiles — tile focus = selection; `WindowPanel` renders the active pane as today.
- No change to the PANE-header refresh button (server-global, renders regardless).

### Design Decisions

#### Context value carries thin board-entry data, not just identity
**Decision**: The focused-pane context value is `{ server, windowId, windowName, panes }` (identity + the board entry's thin pane data), not the bare `{ server, windowId, cwd }` triple the top-bar slot carries.
**Why**: The pin-only fallback (R6) needs `windowName` + `panes` at the consumer; publishing them with the identity keeps `BottomPanels` free of any board-API knowledge and avoids a second channel.
**Rejected**: Publishing only `{server, windowId}` and having the sidebar fetch/join board entries — reintroduces board-data plumbing into the sidebar and a fetch the board page already holds.
*Introduced by*: 260720-zx4i-board-route-pane-host-panels

#### Thin fallback synthesizes a partial WindowInfo (no dedicated markup)
**Decision**: The pin-only fallback synthesizes a `WindowInfo` from `BoardPaneInfo[]` and renders it through the unchanged pure `WindowPanel`, rather than adding dedicated fallback markup to `status-panel.tsx`.
**Why**: Keeps `WindowPanel` a pure `WindowInfo | null` component (intake assumption 6); the register view already renders absent layers as absent, which is exactly the honest presentation the intake wants.
**Rejected**: A dedicated thin-render branch inside `WindowPanel` — duplicates row markup and couples the panel to board types.
*Introduced by*: 260720-zx4i-board-route-pane-host-panels

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/contexts/focused-pane-context.tsx` — `FocusedPaneProvider`, `useFocusedPane()`, `useRegisterFocusedPane()`, exported `FocusedPane` type `{ server, windowId, windowName, panes: BoardPaneInfo[] } | null`; stable-dispatcher + effect-register + clear-on-unmount shape mirroring `top-bar-slot-context.tsx` <!-- R3 -->
- [x] T002 [P] Mount `FocusedPaneProvider` in `RootWrapper` (`app/frontend/src/app.tsx`), alongside `TopBarSlotProvider` <!-- R3 -->
- [x] T003 [P] Add a standalone `HostMetricsProvider` test-provider export to `app/frontend/src/contexts/session-context.tsx` (counterpart to `MetricsProvider`, supplies `HostMetricsContext` without the state socket) <!-- R1 -->

### Phase 2: Core Implementation

- [x] T004 Create pure helpers in `app/frontend/src/lib/focused-pane-window.ts`: `resolveFocusedWindow(sessions, windowId)` (windowId lookup across sessions) and `thinWindowFromFocusedPane(focused)` (synthesize partial `WindowInfo` from `windowName` + `panes`, `activityTimestamp: 0`) <!-- R6 -->
- [x] T005 `app/frontend/src/components/board/board-page.tsx`: publish the focused entry via `useRegisterFocusedPane` (memoized `{server, windowId, windowName, panes}` from `entries[focusedIndex]`); correct the stale ~:458–469 comment above the `focusedPane` memo <!-- R4 -->
- [x] T006 `app/frontend/src/components/sidebar/index.tsx` `BottomPanels`: consume `useFocusedPane()`; when `selectedWindow` is null fall back to `resolveFocusedWindow` then `thinWindowFromFocusedPane`; derive `isConnected` from `ctx.hostMetricsConnected` when `currentServer` is null <!-- R5, R6, R2 -->
- [x] T007 [P] `app/frontend/src/components/sidebar/host-panel.tsx`: fall back to `useHostMetrics()` when `useMetrics()` is null <!-- R1 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T008 [P] Colocated unit test `app/frontend/src/contexts/focused-pane-context.test.tsx` (default null, publish, clear-on-unmount, last-writer-wins, throws outside provider — mirrors `top-bar-slot-context.test.tsx`) <!-- R3 -->
- [x] T009 [P] Colocated unit test `app/frontend/src/lib/focused-pane-window.test.ts` (lookup hit across sessions, miss → null, thin synthesis field mapping incl. active-pane handling and `activityTimestamp: 0`) <!-- R6 -->
- [x] T010 [P] Colocated unit test `app/frontend/src/components/sidebar/host-panel.test.tsx` (server-scoped metrics win; host fallback renders rows when server-scoped is null; "No metrics" when both null; dot reflects `isConnected` prop) <!-- R1 -->
- [x] T011 Extend `app/frontend/src/components/sidebar/index.test.tsx` with a board-route BottomPanels describe (currentServer null + registered focused pane): enriched lookup renders window name/registers; pin-only publishes thin render; no focused pane → "No window selected"; wrap existing harnesses in `FocusedPaneProvider` + `HostMetricsProvider`; also wrap the two harnesses in `app/frontend/src/components/sidebar.test.tsx` <!-- R5, R6, R2 -->
- [x] T012 E2E: add a board-route panels test to `app/frontend/tests/e2e/sidebar-panels.spec.ts` (pin a window via API, goto `/board/$name`, assert PANE shows tmx/cwd rows + window name and HOST shows cpu/mem rows; unpin cleanup) and update `sidebar-panels.spec.md` in the same commit <!-- R1, R2, R5 -->

### Phase 4: Polish

- [x] T013 Run gates: `just test-frontend`, `cd app/frontend && npx tsc --noEmit`, `just test-e2e "sidebar-panels.spec.ts"` (plus a board spec sanity run if touched files warrant) <!-- R1, R2, R3, R4, R5, R6 -->

## Execution Order

- T001 blocks T002, T005, T006, T008
- T003 blocks T010, T011
- T004 blocks T006, T009
- T006 blocks T011, T012

## Acceptance

### Functional Completeness

- [x] A-001 R1: On `/board/$name` the HOST panel renders host-global metrics rows (not "No metrics") once the broadcast ticks; server routes render server-scoped metrics unchanged
- [x] A-002 R2: On `/board/$name` the HOST header dot reflects `hostMetricsConnected`; on `/$server/...` it still reflects that server's subscription state
- [x] A-003 R3: `focused-pane-context.tsx` exists with provider/read/register hooks mirroring the top-bar-slot pattern, and `FocusedPaneProvider` is mounted in `RootWrapper`
- [x] A-004 R4: `BoardPage` registers the focused entry (memoized) and clears on unmount; the stale "can NOT be looked up" comment is corrected to the dual-membership truth
- [x] A-005 R5: On `/board/$name` the PANE panel renders the focused tile's enriched `WindowInfo` resolved by `windowId` from `ctx.sessionsByServer`, and follows focus cycling
- [x] A-006 R6: A pin-only focused tile renders the thin synthesized window (tmx/cwd/git from `BoardEntry.panes`) with fab/PR/agent registers absent

### Behavioral Correctness

- [x] A-007 R5: `WindowPanel` remains a pure `WindowInfo | null` component — no board-specific props or markup added to `status-panel.tsx`
- [x] A-008 R6: Empty board (no focused pane) leaves PANE at "No window selected" and HOST still shows host metrics via the fallback

### Scenario Coverage

- [x] A-009 R3: Unit tests cover context default/publish/clear/last-writer-wins/throw-outside-provider
- [x] A-010 R6: Unit tests cover lookup hit, lookup miss → thin synthesis, and the `activityTimestamp: 0` out-register behavior
- [x] A-011 R1: Unit tests cover server-scoped-wins, host-fallback, and both-null "No metrics" branches
- [x] A-012 R5: E2E exercises the real board route: pinned window's identity rows visible in PANE, metrics rows visible in HOST; `.spec.md` companion updated in the same commit

### Edge Cases & Error Handling

- [x] A-013 R6: `thinWindowFromFocusedPane` handles an entry with empty `panes` (renders without crashing; cwd falls back to empty) and picks the active pane (fallback: first)
- [x] A-014 R2: `hostMetricsConnected === false` on board renders the gray "SSE disconnected" dot (no crash, no stale green)

### Code Quality

- [x] A-015 Pattern consistency: new context mirrors `top-bar-slot-context` (stable dispatcher, effect registration); pure helpers follow the `lib/` pure-builder convention with colocated tests
- [x] A-016 No unnecessary duplication: reuses `WindowPanel`, `HostMetrics`, existing `useHostMetrics()`/`hostMetricsConnected` seams; no new streams or polling (SSE-derived only, no client `setInterval`)
- [x] A-017 No polling from the client: the fill is a pure join over already-streamed SSE state
- [x] A-018 Type narrowing over assertions: helpers and context use discriminated null checks, no `as` casts on window/pane data

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (a focused-pane context, two pure helpers, a test-only `HostMetricsProvider`, and fallback branches in existing components) without making existing code redundant. The stale board-page comment was corrected in place, not deleted; the existing `focusedPane` memo (top-bar slot triple) is still consumed by the palette split/kill actions and remains distinct from the new richer context value.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Context value shape is `{server, windowId, windowName, panes}` (richer than the top-bar slot's `{server, windowId, cwd}`) so the pin-only thin render needs no second data channel | Intake assumption 5 left presentation apply-time; the panes data must reach the consumer somehow and the register hook is the natural carrier | S:85 R:90 A:85 D:80 |
| 2 | Confident | Read hook throws outside the provider (strict mirror of `top-bar-slot-context`), with `FocusedPaneProvider` mounted in `RootWrapper`; existing sidebar unit-test harnesses gain the provider wrap | The intake names the top-bar-slot pattern as the mirror; that pattern is throw-outside-provider with a root mount | S:85 R:90 A:85 D:80 |
| 3 | Confident | HOST dot source keys on `currentServer === null` in `BottomPanels` (route-shape), not on the metrics fallback state inside `HostPanel` | Matches intake §1 ("on the board route the dot reflects host-metrics health"); keeps `HostPanel`'s `isConnected` prop semantics = "health of whatever source feeds this panel" | S:80 R:90 A:85 D:75 |
| 4 | Certain | Thin synthesized window uses `activityTimestamp: 0` and `activity: "idle"` so `getOutputLine` shows the command without a fabricated idle duration | Verified in code: `getOutputLine` guards `if (win.activityTimestamp)` — 0 is falsy, yielding `command \|\| "idle"` | S:90 R:95 A:90 D:90 |
| 5 | Confident | A standalone `HostMetricsProvider` export is added to session-context.tsx for unit tests (counterpart to the existing `MetricsProvider`) | `useHostMetrics()` throws without `SessionProvider`; existing sidebar tests use `MetricsProvider` for exactly this reason — same idiom, no production behavior change | S:85 R:90 A:90 D:85 |

5 assumptions (1 certain, 4 confident, 0 tentative).
