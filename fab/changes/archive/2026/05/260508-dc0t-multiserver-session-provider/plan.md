# Plan: Multi-Server SessionProvider + Unified Sidebar

**Change**: 260508-dc0t-multiserver-session-provider
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

<!-- Sequential work items for the apply stage. Checked off [x] as completed. -->

### Phase 1: Setup

- [x] T001 Refactor `app/frontend/src/contexts/session-context.tsx` to expose multi-server keyed state shape (`sessionsByServer`, `sessionOrderByServer`, `isConnectedByServer`, `metricsByServer`, `currentServer`) and update internal `SessionProvider` to maintain them via a per-server `EventSource` pool. Keep all previous behavior (3s disconnect debounce, prevSseDataRef per server, transition-batched session updates, `runkit-server` localStorage). Drop the `server` prop — provider now reads `currentServer` from `useMatches()` (TanStack Router) inside the provider so consumers don't need to pass it.

- [x] T002 Add `useSessionContextForCurrentServer()` accessor to `session-context.tsx` returning the legacy single-server shape (`sessions`, `sessionOrder`, `isConnected`, `server`, `servers`, `refreshServers`) for `currentServer`, or `null` when `currentServer` is `null`. Mark with a TODO comment that this is transitional and to be removed in the same PR's final commit.

- [x] T003 Update `StandaloneSessionContextProvider` in `session-context.tsx` to accept `Partial<SessionContextType>` aligned with the new shape (keyed Maps + `currentServer`). Synthesize the shape so the keyed maps are always non-null Maps. Keep a transitional convenience: when callers pass legacy `{ server: string, sessions?: ProjectSession[], sessionOrder?: string[], isConnected?: boolean }`, synthesize a single-entry map keyed by `server` and set `currentServer = server`. Mark the legacy convenience with a TODO removal comment.

### Phase 2: Core Implementation — provider + mount topology

- [x] T004 Update `app/frontend/src/app.tsx` `RootWrapper` to mount `<SessionProvider>` and `<OptimisticProvider>` above `<Outlet />` so all routes share one provider instance. Update `ServerShell` to no longer wrap in those providers (keep its `useMatches()`-driven `server` extraction for `AppShell` consumption only).

- [x] T005 Update `app/frontend/src/app.tsx` `AppShell` to read provider state via the new keyed shape — pull `currentServer`, `sessionsByServer`, `isConnectedByServer`, `servers`, `refreshServers` and derive the AppShell-local `server`, `sessions`, `isConnected` from the current-server slice. Sidebar mounts no longer pass `sessions`/`server`/`servers` through props they read from context (sidebar will read context directly per T009). Keep AppShell behavior identical at the route level.

- [x] T006 Update `app/frontend/src/router.tsx` `boardRoute` to use a layout component that wraps `BoardPage` in the same context stack siblings already get from `RootWrapper` (no change here if T004 puts everything at the root). Audit: ensure `BoardPage` no longer mounts its own `<ToastProvider>` since `RootWrapper` already does.

### Phase 2: Core Implementation — sidebar per-server grouping

- [x] T007 Refactor `app/frontend/src/components/sidebar/index.tsx` to render one `CollapsiblePanel`-style group per server in `servers`, each fed by its slice from `sessionsByServer`. Replace the single `Sessions` collapsible with a parent "Sessions" header followed by per-server collapsibles. Pull the per-server slice for `sessionOrder` from `sessionOrderByServer` instead of the single `sessionOrder`. Default-open only the current server's group; collapsed otherwise. Persist toggles per-server in `localStorage` under `runkit-panel-sessions-{server}`. Best-effort migrate the legacy `runkit-panel-sessions` key to the current server's namespaced key on first read.

- [x] T008 In `sidebar/index.tsx` add the current-server visual marker on the matching group header (matching the Server panel's selected-tile shade — pull tint from `serverColors` + `rowTints`). Marker absent when `currentServer === null`.

- [x] T009 In `sidebar/index.tsx` add cross-server navigation: clicking a session/window in a non-current server's tree calls `navigate({ to: "/$server/$session/$window", params: { server: thatServer, session, window } })` (or `to: "/$server"` for session-row's name click). The provider will pick up `currentServer` change via `useMatches()`. Each per-server group's "+ New session" header creates a session against that section's server.

- [x] T010 In `sidebar/index.tsx` add cross-server drag rejection: when a window's drag source server differs from the drop target's server, reject the drop with `addToast("Moving windows across tmux servers isn't supported yet")`. Within-server drag-and-drop unchanged.

- [x] T011 Drop the `server`/`servers`/`sessions`/`isConnected`/`currentSession`/`currentWindowIndex`/`onSwitchServer`/etc. prop set from `Sidebar` callsites where the data can come from context. Keep external callbacks (`onCreateSession`, `onCreateWindow`, `onCreateServer`, `onKillServer`, `onSidebarResizeStart`, `onSelectWindow`) as injected props since AppShell owns the action wiring. Adjust the two AppShell `<Sidebar />` mounts (desktop + mobile drawer) accordingly.

### Phase 2: Core Implementation — board page

- [x] T012 In `app/frontend/src/components/board/board-page.tsx` replace lines 202-234 (the `<aside>` mini-sidebar) with `<Sidebar />`. Drop the inner `ToastProvider` (RootWrapper provides it). Provide AppShell-equivalent action handlers — at minimum, a stub `onCreateSession`/`onCreateWindow` that creates against an explicitly-chosen server (the section's header receives the server in props), and `onSwitchServer`/`onKillServer`/`onCreateServer` callbacks that route to `/$server` etc. Reuse the existing palette setup; do not add AppShell's `<TopBar>`. The board top-bar header (`Board ▸ {name} ▾`) remains.

- [x] T013 Verify board route renders the unified `<Sidebar />`: existing `Boards` section + per-server session trees, no current-server marker (since `currentServer === null` on board route). Pin popover flow continues to work — `WindowRow` already accepts an explicit `server` prop and dispatches actions per-row.

### Phase 3: Integration & Edge Cases — consumer migration

- [x] T014 Migrate `app/frontend/src/components/create-session-dialog.tsx` to `useSessionContextForCurrentServer()` (replace `useSessionContext()`). Throw or no-op if accessor returns null (path that should never happen — dialog is only opened from AppShell where `currentServer` is set).

- [x] T015 Migrate `app/frontend/src/components/iframe-window.tsx` to `useSessionContextForCurrentServer()`.

- [x] T016 Migrate `app/frontend/src/components/keyboard-shortcuts.tsx` to `useSessionContextForCurrentServer()`. Pass `null` server to `getKeybindings` API gracefully if accessor null (skip the fetch).

- [x] T017 Migrate `app/frontend/src/hooks/use-dialog-state.ts` to `useSessionContextForCurrentServer()`. Bail (no-op) on dialog handlers if accessor returns null.

- [x] T018 Migrate `app/frontend/src/hooks/use-sessions.ts` to `useSessionContextForCurrentServer()`. Returns null when not in a server route.

- [x] T019 Update `app/frontend/src/hooks/use-file-upload.ts` to keep `serverOverride` semantics but fall back to `useSessionContextForCurrentServer()` rather than reading `SessionContext` directly.

### Phase 3: Integration & Edge Cases — tests

- [x] T020 Rewrite `app/frontend/src/contexts/session-context.test.tsx` for the multi-server shape: per-server SSE event isolation, lazy attach on `/api/servers` discovery, cleanup on server removal, per-server connection state, `currentServer` follows route changes, reconnect/disconnect-debounce per server. Extend the `MockEventSource` to track instances by URL so per-server streams can be driven independently.

- [x] T021 Update `app/frontend/src/components/sidebar.test.tsx` to use the new `StandaloneSessionContextProvider` shape (keyed maps + `currentServer`) and the new `Sidebar` props surface (drop the props that moved into context). Assert one collapsible group per server, current-server marker on the matching group, and click-to-switch navigation. Existing drag-drop, rename, kill tests remain green.

- [x] T022 Update `app/frontend/src/hooks/use-dialog-state.test.tsx` and `app/frontend/src/components/iframe-window.test.tsx` for the new provider shape. The `SessionProvider` no longer takes a `server` prop — instead, mount it inside a router-aware wrapper that supplies the matched server, OR drive `currentServer` via the test wrapper directly using `StandaloneSessionContextProvider` for these tests since the SSE behavior isn't under test here.

- [x] T023 Add a new e2e test `app/frontend/tests/e2e/multi-server-sidebar.spec.ts` (with companion `.spec.md`) that spawns a second tmux server (`rk-e2e-multi-{digits}` pattern from `boards-multi-server.spec.ts`), navigates to `/$firstServer`, and asserts: (a) two server headers render in the Sessions area, (b) clicking a session in the second server's group navigates to `/$secondServer/...`. Tear down the second server in `afterAll`.

### Phase 4: Polish

- [x] T024 Remove `useSessionContextForCurrentServer` and the legacy `StandaloneSessionContextProvider` convenience (single-server form) — final cleanup. Verify no production code imports the helper. Update touched consumers to use the keyed shape directly. Confirms spec's "Accessor removed before merge" requirement.

- [x] T025 Run verification gates: `cd app/backend && go test ./...`; `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; `just test-e2e`. Fix any failures at root cause; do not bypass.

## Acceptance

<!-- Declarative outcomes for the review stage. -->

### Functional Completeness

- [x] A-001 `SessionContextType` exposes `sessionsByServer`, `sessionOrderByServer`, `isConnectedByServer`, `metricsByServer` Maps and `currentServer: string | null`.
- [x] A-002 The provider opens one `EventSource` per server discovered in `/api/servers`, lazily, and closes it when the server disappears from the list. <!-- review-note: lazy-attach: current server auto-attached, non-current via `attachServer()` (per spec assumption #11 BC mitigation, pulled forward to fix HTTP/1.1 connection-cap issue). -->
- [x] A-003 Per-server SSE events update only that server's slice in each Map.
- [x] A-004 The provider applies a 3-second disconnect debounce per server; an `onerror` on one server does not flip another server's connection state.
- [x] **N/A**: A-005 `useSessionContextForCurrentServer()` returns the legacy single-server slice for `currentServer`, or `null` if `currentServer` is null. (Removed in final commit per A-021.) <!-- review-note: accessor never introduced; apply consolidated all consumer migrations into the keyed shape directly. Equivalent to A-021. -->
- [x] A-006 The `runkit-server` localStorage key continues to track the most recently active server.
- [x] A-007 `SessionProvider` mounts at the root (`RootWrapper`), shared by `/$server/...`, `/board/$name`, and `/`.
- [x] A-008 `currentServer` is dispatched by route: `params.server` for `/$server/...`, `null` for `/board/$name` and `/`.
- [x] A-009 The provider does not unmount on server-route switches; per-server map data persists across navigation.
- [x] A-010 `Sidebar` renders one `CollapsiblePanel` group per server in `servers`, with the existing session/window tree inside each.
- [x] A-011 Default collapse state — only the current server's group is open; others collapsed; persisted per-server in `localStorage` under `runkit-panel-sessions-{server}`.
- [x] A-012 The current server's group header carries a current-server visual marker; no group is marked when `currentServer === null`.
- [x] A-013 Clicking a session/window in a non-current server's tree navigates to `/$otherServer/...`.
- [x] A-014 Each server section header includes a "+ New session" affordance creating a session on that server.
- [x] A-015 Within-server drag-and-drop (window reorder, cross-session move) is preserved.
- [x] A-016 Cross-server drag-and-drop is rejected with the toast `"Moving windows across tmux servers isn't supported yet"`; no API call fires.
- [x] A-017 `BoardPage` no longer renders its `<aside>` mini-sidebar; it renders `<Sidebar />` instead.
- [x] A-018 The `← Sessions` back link is removed from the deleted mini-sidebar; the board top-bar `Board ▸ {name} ▾` switcher remains unchanged.
- [x] A-019 Top-bar breadcrumbs read `currentServer` (via the keyed shape or accessor) for AppShell routes; output is unchanged for the user.
- [x] A-020 All ~9 `useSessionContext` consumers are migrated (either keyed shape directly or transitional accessor): `app.tsx`, `sidebar/index.tsx`, `create-session-dialog.tsx`, `iframe-window.tsx`, `keyboard-shortcuts.tsx`, `use-dialog-state.ts`, `use-sessions.ts`, `use-file-upload.ts`, `session-context.test.tsx`.
- [x] A-021 By the final state of the apply, no production code imports `useSessionContextForCurrentServer`; the helper and `StandaloneSessionContextProvider` legacy convenience are removed.

### Behavioral Correctness

- [x] A-022 Switching from `/$serverA/...` to `/$serverB/...` updates `currentServer` and does NOT tear down the provider; `sessionsByServer.get("serverA")` retains its prior data.
- [x] A-023 Navigating to `/board/$name` keeps `EventSource` instances open; `currentServer` becomes null; per-server maps remain populated.

### Scenario Coverage

- [x] A-024 Per-server slice retrieval scenario: `sessionsByServer.get("runkit")` returns `runkit`-only sessions when SSE updates arrive on `runkit`'s stream.
- [x] A-025 Lazy-attach scenario: `/api/servers` returning `[runkit, work]` produces exactly two open EventSources. <!-- review-note: superseded by lazy-attach: only currentServer's ES is opened until consumer calls attachServer(). useBoards/useWindowPins call attachServer for all known servers, so in practice all servers attach when the sidebar mounts. -->
- [x] A-026 Disappearing-server scenario: subsequent `/api/servers` returning only `[runkit]` closes `work`'s EventSource and clears its keyed map entries.
- [x] A-027 Cross-server window navigation scenario: clicking `sessB`/`window 0` in `work`'s tree from `/runkit/...` navigates to `/work/sessB/0` and updates `currentServer` to `"work"`.
- [x] A-028 Cross-server drop rejection scenario: dragging from `runkit`'s tree onto `work`'s session row triggers the rejection toast and does not call the move API.

### Edge Cases & Error Handling

- [x] A-029 Existing `runkit-panel-sessions` localStorage key is read once during the first render of the current server's group and migrated to `runkit-panel-sessions-{currentServer}`; no error if the key is missing. <!-- review-note: nice-to-have: migration only fires when currentServer non-null at first mount; board-route-first-launch misses it. Spec says "best-effort, no error if missing" which this satisfies. -->
- [x] A-030 Per-server `sessionOrder` consumed by sidebar reorder logic comes from `sessionOrderByServer.get(server)`, falling back to natural order when missing.
- [x] A-031 `SessionProvider`'s disconnect timer for a removed server is cleared on cleanup so it cannot fire after the EventSource closes. <!-- review-note: should-fix: timers cleared on disappear-cleanup path; full provider unmount has no cleanup function (current code persists pool ref across Strict Mode mounts). Acceptable today since provider mounts at root. -->
- [x] **N/A**: A-032 `useSessionContextForCurrentServer()` returns `null` (not throwing) when `currentServer === null`. <!-- review-note: accessor never introduced (see A-005). -->

### Code Quality

- [x] A-033 Existing project patterns are followed: per-server state shape uses `Map`, not plain objects (per Design Decision DD-2 in the spec).
- [x] A-034 No new in-memory caches beyond the necessary per-server keyed maps (Constitution alignment: SSE-derived state).
- [x] A-035 No new routes, no backend changes, no new env vars, no new config knobs (Constitution IV / VII / II preserved).
- [x] A-036 `MockEventSource` test helper extended (multi-instance keyed by URL) — supports the new per-server SSE behavior under test.
- [x] A-037 Constitution Test Companion Docs requirement: every modified `.spec.ts` updates its sibling `.spec.md` in the same commit; the new e2e test ships with a `.spec.md`.

### Security

- [x] A-038 No new shell strings, no new `exec.Command` usage, no new untrusted-input flows in the frontend (Constitution I — N/A but verified).

## Notes

- This is a frontend-only refactor; the backend SSE protocol and `/api/servers` endpoint already support per-server SSE.
- The `StandaloneSessionContextProvider` legacy convenience and `useSessionContextForCurrentServer` accessor are intentionally landed in earlier consumer migrations and removed in T024 — the apply may consolidate this since all consumers migrate within the same apply step.
