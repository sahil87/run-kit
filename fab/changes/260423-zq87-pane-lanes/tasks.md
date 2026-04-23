# Tasks: Pane Lanes

**Change**: 260423-zq87-pane-lanes
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Create `usePinnedLanes` hook at `app/frontend/src/hooks/use-pinned-lanes.ts` — pin data model `{ server, session, windowIndex }`, localStorage persistence under `runkit-lanes-pins`, cross-tab sync via `storage` event, duplicate prevention, `{ pins, pinWindow, unpinWindow, isPinned, clearPins }` API
- [x] T002 [P] Create `app/frontend/src/hooks/use-pinned-lanes.test.ts` — unit tests for pin/unpin, duplicate prevention, localStorage serialization, cross-tab sync
- [x] T003 [P] Add `/lanes` route to `app/frontend/src/router.tsx` — new `lanesRoute` as child of `rootRoute`, import placeholder `LanesPage` component
- [x] T004 [P] Scaffold `app/frontend/src/components/lanes/` directory — create `lanes-page.tsx` (empty-state placeholder), `lane.tsx` (stub), `lane-header.tsx` (stub), `context-menu.tsx` (stub)

## Phase 2: Core Implementation

- [x] T005 Implement `LanesPage` component at `app/frontend/src/components/lanes/lanes-page.tsx` — minimal chrome (top bar with title, pin count, theme toggle, back link), horizontal scroll container (`flex-row overflow-x-auto scroll-snap-type: x mandatory`), maps pinned lanes to `Lane` components, renders empty state when no pins
- [x] T006 Implement `Lane` component at `app/frontend/src/components/lanes/lane.tsx` — xterm.js terminal instance with WebSocket relay connection (`/relay/:session/:window?server=:server`), connection lifecycle (connect on mount, reconnect with backoff, close on unmount), FitAddon integration, resizable width via right-edge drag handle, width persisted in localStorage under `runkit-lanes-widths`, default 480px, min 280px
- [x] T007 Implement `LaneHeader` component at `app/frontend/src/components/lanes/lane-header.tsx` — shows `server · session · window`, connection status dot (green/gray), unpin button (✕), "open in terminal" link navigating to `/$server/$session/$window`
- [x] T008 Implement focus management in `LanesPage` — click-to-focus (click lane terminal area), hover-to-focus (mouseenter on lane), keyboard cycling (`Ctrl+]` next, `Ctrl+[` previous, wrap-around), focused lane gets `ring-2 ring-accent` visual indicator

## Phase 3: Integration & Pin Discovery

- [x] T009 Add pin icon button to `app/frontend/src/components/sidebar/window-row.tsx` — hover-reveal pin icon (filled when pinned, outline when not), `coarse:opacity-100` for touch, calls `pinWindow`/`unpinWindow` from `usePinnedLanes` hook. Requires `server` prop threaded through from sidebar context
- [x] T010 [P] Implement right-click context menu component at `app/frontend/src/components/lanes/context-menu.tsx` — positioned at cursor, "Pin to Lanes"/"Unpin from Lanes" toggle, dismiss on outside click/Escape/selection. Wire to `window-row.tsx` via `onContextMenu` handler
- [x] T011 [P] Register command palette actions in `app/frontend/src/app.tsx` — `lanes-pin` ("Lanes: Pin Current Window", conditional on currentWindow + not pinned), `lanes-unpin` ("Lanes: Unpin Current Window", conditional on pinned), `lanes-open` ("View: Open Lanes", on server routes inside AppShell, navigates to `/lanes`)
- [x] T012 Implement SSE multi-server subscription in `LanesPage` — one SSE connection per unique server among pinned lanes, detect window kills, show "window closed" overlay on affected lane, auto-unpin after 5s delay

## Phase 4: Polish

- [x] T013 [P] Add tests for `Lane` component at `app/frontend/src/components/lanes/lane.test.tsx` — mount/unmount lifecycle, WebSocket connection setup, resize persistence
- [x] T014 [P] Add tests for `LanesPage` at `app/frontend/src/components/lanes/lanes-page.test.tsx` — empty state, pin rendering, focus management, horizontal scroll
- [x] T015 [P] Add e2e test at `app/frontend/tests/e2e/lanes.spec.ts` + `app/frontend/tests/e2e/lanes.spec.md` — navigate to /lanes, verify empty state, pin a window, verify lane appears with terminal content, unpin, verify removal

---

## Execution Order

- T001 blocks T005, T006, T008, T009, T011 (all consumers of `usePinnedLanes`)
- T003 + T004 block T005 (route and component scaffolds needed)
- T005 blocks T006, T007, T008, T012 (LanesPage hosts lanes)
- T006 blocks T007, T008 (Lane component needed for header and focus)
- T009, T010, T011 are independent of each other (different files)
- T013, T014, T015 depend on Phase 2+3 being complete
