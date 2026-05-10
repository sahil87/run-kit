# Spec: Multi-Server SessionProvider + Unified Sidebar

**Change**: 260508-dc0t-multiserver-session-provider
**Created**: 2026-05-09
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- **Cross-server window drag-and-drop** — out of scope. tmux's `move-window` does not span servers; supporting it requires `kill-window` + `new-window` + state restoration on the target server, which is a separate design problem with its own concerns. The drag handler SHALL reject cross-server drops with a toast.
- **Wrapping `/api/boards` into the per-server EventSource pool** — `useBoards` is explicitly cross-server; keying it per-server would be wrong. It remains a separate fetch.
- **Backend changes** — the SSE protocol, `/api/sessions/stream?server=X`, and `/api/servers` endpoints are already per-server. The frontend simply opens N connections instead of 1.
- **A literal "back to last server" affordance on the board page** — removing the mini-sidebar drops the `← Sessions` link; the user navigates to a server by clicking that server's tree in the unified sidebar or via the Server panel. A breadcrumb-based affordance MAY be added later as a separate change.
- **Index route (`/`) breadcrumb changes** — the `/` route renders `ServerListPage`, not `AppShell`, so the unified `<Sidebar>` and breadcrumbs do not mount there. No change to `/` as part of this work.

## Domain: SessionProvider Context Shape

### Requirement: Per-server keyed state

The `SessionContextType` SHALL expose per-server state via keyed maps:

```ts
sessionsByServer: Map<string, ProjectSession[]>;
sessionOrderByServer: Map<string, string[]>;
isConnectedByServer: Map<string, boolean>;
metricsByServer: Map<string, MetricsSnapshot | null>;
```

The provider SHALL also expose a single `currentServer: string | null` that identifies the active server for routes that need single-server context (AppShell). On routes without an implicit server (e.g., `/board/$name`), `currentServer` SHALL be `null`.

#### Scenario: Per-server slice retrieval
- **GIVEN** the provider has received SSE updates for two servers `runkit` and `work`
- **WHEN** a consumer reads `sessionsByServer.get("runkit")`
- **THEN** the result contains only the sessions reported by `runkit`'s SSE stream
- **AND** reading `sessionsByServer.get("work")` returns only `work`'s sessions

#### Scenario: currentServer null on board route
- **GIVEN** the user navigates to `/board/my-board`
- **WHEN** the provider re-renders for the new route
- **THEN** `currentServer` is `null`
- **AND** the per-server maps remain populated for any servers already discovered

### Requirement: Lazy EventSource pool

The provider SHALL open one `EventSource` per server in `servers` (the list returned by `/api/servers`), opened lazily when a server is first discovered. Each EventSource SHALL update only its own slice of the per-server maps. When a server disappears from `/api/servers`, the provider SHALL close its EventSource and remove its entries from all per-server maps.

#### Scenario: Lazy attach on server discovery
- **GIVEN** `/api/servers` returns `[{name: "runkit"}, {name: "work"}]` on initial fetch
- **WHEN** the provider receives this list
- **THEN** two EventSource connections are open, one per server
- **AND** each connection's URL includes its respective `?server=` query parameter

#### Scenario: Disappearing server cleanup
- **GIVEN** EventSources are open for `runkit` and `work`
- **WHEN** a subsequent `/api/servers` poll returns only `[{name: "runkit"}]`
- **THEN** `work`'s EventSource is closed
- **AND** `sessionsByServer.has("work")`, `sessionOrderByServer.has("work")`, `isConnectedByServer.has("work")`, and `metricsByServer.has("work")` are all `false`

#### Scenario: Per-server slice isolation under SSE
- **GIVEN** EventSources are open for `runkit` and `work`
- **WHEN** `runkit`'s `sessions` event fires with payload `[A, B]`
- **THEN** `sessionsByServer.get("runkit")` is `[A, B]`
- **AND** `sessionsByServer.get("work")` is unchanged

### Requirement: Reconnect logic per server

The provider SHALL apply the same reconnect / 3-second disconnect-debounce semantics per server as the current single-server implementation. A connection drop on server X SHALL NOT mark other servers as disconnected.

#### Scenario: Per-server disconnect signal
- **GIVEN** EventSources are open for `runkit` and `work`, both connected
- **WHEN** `work`'s EventSource emits `onerror` and remains errored for ≥3 seconds
- **THEN** `isConnectedByServer.get("work")` becomes `false`
- **AND** `isConnectedByServer.get("runkit")` remains `true`

### Requirement: Transitional accessor

The provider SHALL export a `useSessionContextForCurrentServer()` helper that returns the slice for `currentServer`, or `null` if `currentServer` is null. This helper exists solely to stage the migration of the ~9 existing `useSessionContext` consumers; once all consumers have migrated, the helper SHALL be removed.

The shape returned by `useSessionContextForCurrentServer()` SHALL match the legacy single-server `SessionContextType`:

```ts
{
  sessions: ProjectSession[];
  sessionOrder: string[];
  isConnected: boolean;
  server: string;
  servers: ServerInfo[];
  refreshServers: () => void;
} | null
```

#### Scenario: Accessor returns currentServer slice
- **GIVEN** `currentServer === "runkit"` and `sessionsByServer.get("runkit") === [A, B]`
- **WHEN** a consumer calls `useSessionContextForCurrentServer()`
- **THEN** the result is non-null, with `server === "runkit"` and `sessions === [A, B]`

#### Scenario: Accessor returns null on board route
- **GIVEN** `currentServer === null`
- **WHEN** a consumer calls `useSessionContextForCurrentServer()`
- **THEN** the result is `null`

### Requirement: Persisted last-used server unchanged

The `runkit-server` localStorage key MUST continue to track the user's most recently active server (the one corresponding to `currentServer` when an AppShell route is mounted). Behavior is preserved from the current single-server provider — the key is not split into a multi-server structure.

## Domain: SessionProvider Mount Topology

### Requirement: Provider mounts at the root

The `SessionProvider` SHALL mount above the route outlet so that all routes — including `/board/$name`, `/$server/...`, and child routes — share a single provider instance. The provider SHALL NOT be re-mounted on server switches; switching servers updates `currentServer` rather than tearing down the provider.

#### Scenario: Provider survives server-route switches
- **GIVEN** the user is on `/runkit/sessA/0` with `sessionsByServer` populated for `runkit` and `work`
- **WHEN** the user navigates to `/work/sessB/0`
- **THEN** the provider does NOT unmount
- **AND** `sessionsByServer.get("work")` retains its prior data (no rebuild from scratch)
- **AND** `currentServer` becomes `"work"`

#### Scenario: Board route reuses the provider
- **GIVEN** the user is on `/runkit/sessA/0`
- **WHEN** the user navigates to `/board/my-board`
- **THEN** the same `SessionProvider` instance is mounted
- **AND** `currentServer` becomes `null`
- **AND** all open EventSources remain open

### Requirement: Route-driven currentServer dispatch

`currentServer` SHALL be dispatched from the matched route. The mapping is:

| Route | currentServer |
|-------|---------------|
| `/$server/...` | `params.server` |
| `/board/$name` | `null` |
| `/` (`ServerListPage`) | `null` |

The dispatch SHALL be implemented inside the provider (e.g., reading `useMatches`) so consumers do not need to forward props.

#### Scenario: Switching servers updates currentServer
- **GIVEN** the user is on `/runkit/sessA/0` with `currentServer === "runkit"`
- **WHEN** they navigate to `/work`
- **THEN** `currentServer` becomes `"work"`

#### Scenario: Cross-server window navigation
- **GIVEN** the user is on `/runkit/sessA/0` and clicks a window in `work`'s sidebar tree
- **WHEN** the navigation completes to `/work/sessB/0`
- **THEN** `currentServer` becomes `"work"`

#### Scenario: Index route yields null currentServer
- **GIVEN** the user navigates to `/` (which renders `ServerListPage`)
- **WHEN** the provider re-renders for the matched route
- **THEN** `currentServer` is `null`
- **AND** the per-server maps remain populated for any servers already discovered
<!-- clarified: added explicit scenario for `/` route to complete coverage of all three dispatch-table entries (`/$server/...`, `/board/$name`, `/`). -->

## Domain: Sidebar Per-Server Grouping

### Requirement: One collapsible group per server

The `Sidebar` SHALL render one collapsible group per server present in `servers`, using the existing `CollapsiblePanel` pattern (matching Server / Boards panels). Within each group, the existing session/window tree structure is preserved.

#### Scenario: Multiple servers, multiple groups
- **GIVEN** `servers === [{name: "runkit"}, {name: "work"}, {name: "home"}]`
- **WHEN** the sidebar renders
- **THEN** three collapsible groups appear under the Sessions heading
- **AND** each group contains only that server's sessions

#### Scenario: Single server unchanged shape
- **GIVEN** `servers === [{name: "runkit"}]`
- **WHEN** the sidebar renders
- **THEN** one collapsible group appears for `runkit`
- **AND** its open/collapse default still respects current-server precedence (open by default)

### Requirement: Default collapse state — current open, others collapsed

By default, the current server's group SHALL be open and all other groups SHALL be collapsed. User toggles SHALL persist per-server in `localStorage` under a key namespaced by server name (e.g., `runkit-panel-sessions-{server}`). On routes where `currentServer` is `null` (e.g., `/board/$name`), no group has the "current" visual marker; default collapse follows persisted state, falling back to "all collapsed".

#### Scenario: Default collapse on AppShell route
- **GIVEN** `currentServer === "runkit"` and no persisted toggles in `localStorage`
- **WHEN** the sidebar renders for the first time
- **THEN** `runkit`'s group is open
- **AND** other servers' groups are collapsed

#### Scenario: User toggle persistence per server
- **GIVEN** the user expands `work`'s group while on `/runkit/...`
- **WHEN** the user later returns to the same route
- **THEN** `work`'s group is still expanded (read from `localStorage`)
- **AND** `runkit`'s group state is independently tracked

### Requirement: Current-server visual marker

The current server's group header SHALL be visually distinguished (matching the Server panel's selected-tile shade convention) so the user can identify which server's chrome the breadcrumbs and `/$server/...` route refer to.

#### Scenario: Marker tracks currentServer
- **GIVEN** the user is on `/runkit/...`
- **WHEN** the sidebar renders
- **THEN** `runkit`'s group header carries the current-server styling
- **AND** other groups do not

#### Scenario: Marker absent on board route
- **GIVEN** the user is on `/board/my-board` (`currentServer === null`)
- **WHEN** the sidebar renders
- **THEN** no group carries the current-server styling

### Requirement: Cross-server window navigation

Clicking a session or window in a non-current server's tree SHALL navigate to that server's route (`/{otherServer}/{session}/{windowIndex}`). The provider SHALL update `currentServer` as a side effect of route dispatch.

#### Scenario: Click-to-switch
- **GIVEN** the user is on `/runkit/sessA/0` and `work`'s group shows session `sessB` with window 0
- **WHEN** the user clicks `sessB` window 0 in `work`'s group
- **THEN** the URL becomes `/work/sessB/0`
- **AND** `currentServer` becomes `"work"`
- **AND** `runkit`'s sidebar group remains visible (collapsed per default rules)

### Requirement: Per-server "+ New session" affordance

Each server section header SHALL include a "+ New session" affordance. Activating it SHALL create a session on that section's server (regardless of `currentServer`).

#### Scenario: Create session on non-current server
- **GIVEN** `currentServer === "runkit"` and the user clicks "+" in `work`'s group header
- **WHEN** the create flow completes
- **THEN** the new session is created on `work`'s tmux server
- **AND** `currentServer` is unchanged (remains `"runkit"`)

### Requirement: Within-server drag-and-drop preserved

Existing drag-and-drop behaviors SHALL be preserved verbatim within a server's group:
- Within-session window reorder
- Within-server cross-session window move
- Within-server session reorder

#### Scenario: Within-server reorder unchanged
- **GIVEN** the user drags window `w1` to a new position within session `sessA` on server `runkit`
- **WHEN** the drop completes
- **THEN** the existing `executeMoveWindow(server, ...)` call fires with `server === "runkit"`
- **AND** the resulting order is reflected in `sessionsByServer.get("runkit")`

### Requirement: Cross-server drag rejection

A drag whose source and drop-target servers differ SHALL be rejected with a toast: `"Moving windows across tmux servers isn't supported yet"`. The drop SHALL NOT call any move API.

#### Scenario: Cross-server drop rejected
- **GIVEN** the user starts dragging a window from `runkit`'s tree
- **WHEN** they drop onto a session row in `work`'s group
- **THEN** no move API call fires
- **AND** a toast displays the rejection message

## Domain: BoardPage Sidebar Unification

### Requirement: BoardPage renders the unified Sidebar

`BoardPage` SHALL replace its mini-sidebar (`<aside>` at lines 202-234 of `app/frontend/src/components/board/board-page.tsx`) with `<Sidebar />`. The unified Sidebar already renders the Boards section and per-server session trees; no special-case is needed.

To enable this, the `BoardRoute` SHALL be wrapped in the same provider stack used by `ServerShell` (`SessionProvider` + `OptimisticProvider`). The provider mount uses `currentServer = null` because the board route has no `$server` param.

#### Scenario: Board route renders Sidebar
- **GIVEN** the user navigates to `/board/my-board`
- **WHEN** the page renders
- **THEN** the unified `<Sidebar>` renders with per-server session groups
- **AND** the Boards section shows `my-board` as the current board (existing behavior of `useActiveBoardName`)
- **AND** no mini-sidebar `<aside>` is rendered

#### Scenario: Pinning from board route works
- **GIVEN** the user is on `/board/my-board` and `runkit` has session `sessA` with window 0
- **WHEN** the user opens the pin popover on `runkit`/`sessA`/window 0 from the sidebar
- **THEN** the existing pin flow operates with `server === "runkit"`
- **AND** the pin appears on `my-board` after SSE reconciliation

### Requirement: Removed `← Sessions` back link

The `← Sessions` link in the deleted mini-sidebar is removed without replacement. Users navigate back to a server by clicking that server's tree in the unified Sidebar or selecting it from the Server panel.

#### Scenario: No back-link present
- **GIVEN** the user is on `/board/my-board`
- **WHEN** they inspect the unified Sidebar
- **THEN** no element labelled `← Sessions` is rendered

### Requirement: Existing BoardPage chrome preserved

The board's top bar (`Board ▸ {name} ▾` switcher) and pane area (`DesktopRow` / `MobileCarousel`) SHALL remain unchanged. Only the leftmost mini-sidebar `<aside>` is removed and replaced.

#### Scenario: Board top-bar switcher still works
- **GIVEN** the user is on `/board/my-board` with multiple boards available
- **WHEN** they click the `▾` switcher
- **THEN** the dropdown shows the existing board list and `← Sessions` entry
- **AND** selecting another board navigates correctly

## Domain: Top Bar / Breadcrumbs

### Requirement: Breadcrumbs read currentServer

Top-bar breadcrumbs (in `top-bar.tsx`) SHALL continue to use the `server` value passed in by `AppShell`. After this change, that value is sourced from `currentServer` (via the transitional accessor or the new keyed shape) rather than from a route param prop chain.

This is a non-functional refactor for AppShell routes — visible breadcrumb output is unchanged.

#### Scenario: AppShell breadcrumbs unchanged
- **GIVEN** the user is on `/runkit/sessA/0`
- **WHEN** the top bar renders
- **THEN** breadcrumbs display `runkit / sessA / window` consistent with prior behavior
- **AND** the connection dot reflects `isConnectedByServer.get("runkit")`

#### Scenario: Board-route breadcrumbs unchanged
- **GIVEN** the user is on `/board/my-board`
- **WHEN** the page renders
- **THEN** the existing `Board ▸ my-board ▾` header from `board-page.tsx` is shown
- **AND** the unified Sidebar is mounted alongside (this change), but no AppShell `<TopBar>` is added to the board route

## Domain: Consumer Migration

### Requirement: Migrate existing useSessionContext consumers

The following ~9 consumer files SHALL migrate to either (a) the new keyed shape directly when they need cross-server data, or (b) `useSessionContextForCurrentServer()` for legacy single-server semantics:

- `app/frontend/src/app.tsx` — uses keyed shape (needs `currentServer` and per-server slices for the unified sidebar)
- `app/frontend/src/components/sidebar/index.tsx` — uses keyed shape (renders all servers' groups)
- `app/frontend/src/components/sidebar/boards-section.tsx` — no migration needed (does not consume `useSessionContext` directly; uses `useBoards`)
- `app/frontend/src/components/create-session-dialog.tsx` — uses transitional accessor (single-server intent)
- `app/frontend/src/components/iframe-window.tsx` — uses transitional accessor
- `app/frontend/src/components/keyboard-shortcuts.tsx` — uses transitional accessor
- `app/frontend/src/hooks/use-dialog-state.ts` — uses transitional accessor
- `app/frontend/src/hooks/use-sessions.ts` — uses transitional accessor
- `app/frontend/src/hooks/use-file-upload.ts` — already accepts `serverOverride`; falls back to transitional accessor

Migration SHALL be staged: introduce the multi-server provider with the transitional accessor first, migrate consumers commit-by-commit, then delete the accessor in a final commit. The whole change ships as one PR but the commit history reflects the staging.

#### Scenario: Single-PR, multi-commit history
- **GIVEN** the change is reviewed
- **WHEN** the reviewer inspects the commit log on the PR
- **THEN** there are multiple commits: provider introduction, per-consumer migrations, and accessor removal
- **AND** each commit compiles and passes the existing test suite

### Requirement: Accessor removed before merge

By the time the PR is merged, no production code SHALL import `useSessionContextForCurrentServer`. The accessor MAY remain exported during intermediate commits but SHALL be removed in the final commit of the PR.

#### Scenario: No transitional accessor in final state
- **GIVEN** the PR is at the head commit
- **WHEN** `git grep useSessionContextForCurrentServer app/frontend/src` runs
- **THEN** the only matches are in the deletion commit's diff (no remaining references)

## Domain: Tests

### Requirement: SessionProvider unit tests cover multi-server shape

`app/frontend/src/contexts/session-context.test.tsx` SHALL be rewritten to assert:
1. `sessionsByServer` is populated per-server when SSE events arrive on each server's stream
2. `isConnectedByServer` reflects per-server connection state independently
3. `metricsByServer` is updated only for the server whose stream emitted
4. `sessionOrderByServer` updates only for the matching server
5. Lazy attach: an EventSource is opened only after a server appears in `/api/servers`
6. Cleanup: when a server disappears from `/api/servers`, its EventSource is closed and its map entries removed
7. `currentServer` follows route changes (mock router or directly drive the dispatch input)
8. Reconnect / 3-second disconnect debounce applies per server

#### Scenario: Per-server SSE isolation test
- **GIVEN** a test mounts the provider with two MockEventSources for `runkit` and `work`
- **WHEN** the test emits a `sessions` event on `runkit`'s instance with `[A]`
- **THEN** `sessionsByServer.get("runkit")` equals `[A]`
- **AND** `sessionsByServer.get("work")` is `undefined` (no event yet) or `[]` (initial empty)

#### Scenario: Cleanup on server removal
- **GIVEN** EventSources are open for `runkit` and `work`
- **WHEN** the next `listServers()` resolves with only `[{name: "runkit"}]`
- **THEN** `work`'s EventSource `close()` is called
- **AND** `sessionsByServer.has("work") === false`

### Requirement: Sidebar unit tests cover per-server groups

`app/frontend/src/components/sidebar.test.tsx` (and any sub-component test under `sidebar/`) SHALL be updated to:
1. Pass the multi-server context shape (or use a `StandaloneSessionContextProvider` updated for the new shape)
2. Assert one group per server renders
3. Assert current-server marker appears only on the current group
4. Assert default collapse rules
5. Assert click-to-switch fires the correct navigate call with the target server

#### Scenario: Three-server render test
- **GIVEN** test wrapper supplies `sessionsByServer` for `a`, `b`, `c` and `currentServer === "a"`
- **WHEN** the sidebar renders
- **THEN** three group headers appear with text matching server names
- **AND** the `a` group header has the current-server class/marker
- **AND** the `b` and `c` groups have collapse state per default rules

### Requirement: StandaloneSessionContextProvider updated

The `StandaloneSessionContextProvider` test helper (in `session-context.tsx`) SHALL accept the multi-server shape as `Partial<SessionContextType>` with the new keyed maps. For backwards compatibility within tests during migration, it MAY accept a legacy `server: string + sessions: ProjectSession[]` form and synthesize a single-entry map; this convenience form SHALL be removed in the same PR's final commit alongside the transitional accessor.

#### Scenario: Test helper accepts new shape
- **GIVEN** a test passes `{ sessionsByServer: new Map([["runkit", [A]]]), currentServer: "runkit" }`
- **WHEN** a child consumes `useSessionContext()`
- **THEN** the child sees the supplied keyed maps and `currentServer === "runkit"`

### Requirement: E2E unchanged for single-server

The Playwright e2e suite (which runs against the isolated `rk-e2e` tmux server) SHALL pass without modification. Single-server is the `N=1` case of the multi-server shape; no existing e2e assertion is invalidated.

#### Scenario: Existing e2e green
- **GIVEN** the change is applied
- **WHEN** `just test-e2e` runs
- **THEN** all existing tests pass without modification

### Requirement: New e2e for multi-server rendering

A new e2e test SHALL exercise multi-server sidebar rendering by spawning a second tmux server (e.g., `tmux -L rk-e2e-multi-{digits}`) inside the test fixture and asserting both servers render in the sidebar. This follows the established pattern in `app/frontend/tests/e2e/boards-multi-server.spec.ts`, which already creates a secondary `rk-e2e-multi-*` tmux server in `beforeAll` and tears it down in `afterAll`. No network-layer mocking infrastructure (e.g., Playwright `page.route` for `/api/servers` / SSE streams) is currently present in the e2e suite, so a real second tmux server is the only available approach.
<!-- clarified: e2e approach selected as (B) — spawn second tmux server. Verified by inspecting tests/e2e/: existing `boards-multi-server.spec.ts` already uses `rk-e2e-multi-*` second server pattern; no `page.route`/MSW mocking found in e2e dir (msw is unit-test only). -->

The chosen approach SHALL be documented in the test's `.spec.md` companion file (per constitution Test Companion Docs requirement).

#### Scenario: Multi-server sidebar e2e
- **GIVEN** two tmux servers are visible to the frontend (real or mocked)
- **WHEN** the user opens `http://localhost:3020/{firstServer}`
- **THEN** the sidebar shows two server groups
- **AND** clicking a session in the second server's group navigates to `/{secondServer}/...`

## Domain: Constitution & Quality Gates

### Requirement: Verification gates

Before the PR is opened, the change SHALL pass:
1. `cd app/backend && go test ./...` — backend untouched, baseline check
2. `cd app/frontend && npx tsc --noEmit` — TypeScript clean
3. `just test` — backend + frontend + e2e green
4. `just build` — production build green

#### Scenario: All gates green
- **GIVEN** the apply stage is complete
- **WHEN** all four gates run
- **THEN** every gate exits 0
- **AND** no new warnings are introduced

### Requirement: Constitution alignment unchanged

The change SHALL NOT introduce:
- New routes (Constitution IV: Minimal Surface Area)
- New configuration knobs (Constitution VII: Convention Over Configuration)
- Database / persistence layer (Constitution II: No Database)
- Backend changes (already enforced by intake — backend untouched)
- New `exec.Command` calls or shell strings (Constitution I: Security First) — N/A, frontend-only change
- Justfile recipe complexity (Constitution VIII) — N/A, no justfile changes

The change SHALL preserve:
- Keyboard-First (Constitution V) — palette entries (`Server: Switch to ...`) already exist; adding cross-server click-through in the sidebar is keyboard-reachable via existing tab navigation
- SSE-driven state derivation — provider derives state from existing SSE endpoints; no in-memory caches added beyond the per-server keyed maps necessary for state shape

#### Scenario: Constitutional review pass
- **GIVEN** the change is reviewed against constitution
- **WHEN** each principle is checked
- **THEN** no violation is found
- **AND** the change either preserves or simplifies surface area

### Requirement: hdjr prerequisite enforced

This change SHALL NOT be merged before the hdjr change (`260508-hdjr-relay-grouped-sessions-board-panes`, which introduces the `rk-relay-*` filter) lands on `main`. Without that filter, the multi-server sidebar would surface ephemeral relay sessions across all servers as user-visible rows.

#### Scenario: hdjr ordering check
- **GIVEN** the dc0t PR is opened
- **WHEN** the reviewer checks `main`'s git log
- **THEN** the hdjr commit is present on `main` before dc0t merges
- **AND** the dc0t PR description references the hdjr dependency

## Design Decisions

1. **Single root-mounted SessionProvider, route-driven `currentServer`**:
   - *Why*: Eliminates the unmount/remount cost on server switches and lets multiple routes (board, server, future cross-server views) share one EventSource pool.
   - *Rejected*: Keeping per-route providers and bridging state via a sibling cross-server context. Adds two contexts and double-fetches `/api/servers`; doesn't solve the BoardPage sidebar reuse problem cleanly.

2. **Per-server keyed Maps, not nested objects**:
   - *Why*: `Map<string, T>` gives `O(1)` per-server lookup, clear "missing key" semantics (`undefined`), and avoids the `{ [server]: T }` object pattern that pollutes diff readability and risks accidental prototype keys.
   - *Rejected*: Plain `Record<string, T>` indexed objects. Marginally simpler types but worse semantics for "server unknown" vs "server known with empty value".

3. **Transitional accessor (`useSessionContextForCurrentServer`)**:
   - *Why*: Lets the migration land as one PR with multiple reviewable commits. Each consumer migration is small and obviously correct.
   - *Rejected*: Big-bang rewrite of all consumers in one commit. Larger blast radius, harder to bisect if a bug surfaces.

4. **Default-closed-except-current per-server collapse state**:
   - *Why*: Quieter UI, less DOM, matches the convention of "collapse what you're not using". Persistent toggles in localStorage cover the power-user case who keeps multiple servers expanded.
   - *Rejected*: All-open by default. Visually noisy on users with many servers; adds DOM weight from sessions/windows the user isn't currently working with.

5. **BoardPage wrapped in `SessionProvider` with `currentServer === null`**:
   - *Why*: Lets BoardPage reuse `<Sidebar>` directly without prop-drilling a fake "current server" or rendering chrome that misleads the user. The provider's "null currentServer = no AppShell single-server context" is the honest model.
   - *Rejected*: Synthesizing a "current server" for the board route from last-viewed-server / first-server-in-list. Subtle UX failure modes (sidebar showing the wrong server's tree when the user pinned from a server they haven't recently visited) — see intake's "hybrid last-viewed-server" rejection.

6. **EventSource concurrency: lazy-attach if/when problematic**:
   - *Why*: HTTP/2 lifts the 6-connection per-origin limit, and the project's chi backend supports HTTP/2. Most users have ≤6 servers, so eager-attach is fine for the common case. If production telemetry shows users with 10+ servers hitting connection limits, lazy-attach (open SSE only when a server's group is first expanded) is a backwards-compatible mitigation.
   - *Rejected*: Lazy-attach from day one. Adds complexity (need to handle "sessions arrive out-of-order from group expansion"; need to re-emit SSE history on attach) for a problem that doesn't yet exist.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | SessionContext exposes `sessionsByServer`, `sessionOrderByServer`, `isConnectedByServer`, `metricsByServer` (Maps) plus `currentServer: string \| null` | Confirmed from intake #1 — chosen approach explicit | S:95 R:80 A:90 D:95 |
| 2 | Certain | One EventSource per known server, opened lazily as `/api/servers` discovers servers; closed when servers disappear | Confirmed from intake #2 — backend already serves per-server SSE | S:95 R:85 A:90 D:90 |
| 3 | Certain | Sidebar renders one collapsible group per server using existing `CollapsiblePanel` pattern | Confirmed from intake #3 — pattern in repo | S:95 R:85 A:90 D:95 |
| 4 | Certain | BoardPage's mini-sidebar (lines 202-234 of `board-page.tsx`) is removed; BoardPage renders the unified `<Sidebar>` wrapped in `SessionProvider` with `currentServer === null` | Confirmed from intake #4 + spec-level analysis (provider must wrap board route) | S:95 R:85 A:90 D:95 |
| 5 | Certain | Cross-server window drag-and-drop is OUT OF SCOPE; rejected with toast | Confirmed from intake #5 — tmux move-window doesn't span servers | S:95 R:80 A:90 D:95 |
| 6 | Certain | hdjr (`rk-relay-*` filter) is a hard prerequisite — must land on `main` before dc0t merges | Confirmed from intake #6 — without it, ephemerals surface in the multi-server sidebar | S:95 R:90 A:95 D:95 |
| 7 | Certain | `currentServer` is dispatched by route: `params.server` for `/$server/...`, `null` for `/board/$name` and `/`. Provider mounts at the root and reads route params via `useMatches` | Confirmed from intake #7 — natural route mapping. Spec adds: provider lives at root, not per-route | S:95 R:85 A:90 D:95 |
| 8 | Certain | Backend unchanged — SSE protocol and `/api/servers` already per-server; frontend opens N connections instead of 1 | Confirmed from intake #8 — verified in source: SSE route accepts `?server=` | S:95 R:95 A:95 D:95 |
| 9 | Certain | Transitional accessor `useSessionContextForCurrentServer` exists during migration; deleted in final commit of the PR | Confirmed from intake #9 — staged migration plan | S:95 R:85 A:85 D:90 |
| 10 | Certain | Default collapse: only `currentServer`'s group open; others collapsed. Persistence per-server in `localStorage` under `runkit-panel-sessions-{server}` | Confirmed from intake #10 — quieter UX, saves DOM | S:95 R:80 A:80 D:80 |
| 11 | Certain | EventSource concurrency: eager-attach for now; lazy-attach reserved as a backwards-compatible mitigation if N>6 becomes common | Confirmed from intake #11 — HTTP/2 + chi support; mitigation is BC | S:95 R:80 A:80 D:80 |
| 12 | Certain | `useBoards` / `/api/boards` remains a separate cross-server fetch, NOT wrapped into the per-server SSE pool | Confirmed from intake #12 — boards are explicitly cross-server | S:95 R:85 A:85 D:85 |
| 13 | Certain | Migration order: provider introduced with accessor, consumers migrated commit-by-commit, accessor removed in final commit. All in one PR | Confirmed from intake #13 — staging keeps each diff reviewable | S:95 R:85 A:85 D:85 |
| 14 | Certain | Within-server drag-drop preserved verbatim; only cross-server is rejected | Confirmed from intake #14 — preserves existing common-path UX | S:95 R:90 A:90 D:90 |
| 15 | Confident | Top-bar breadcrumbs sourced from `currentServer` (via accessor or keyed shape); AppShell route output unchanged. Index route `/` is unchanged because it renders `ServerListPage`, not AppShell | Refined from intake #15 — corrected: `/` has no breadcrumbs to update | S:85 R:90 A:85 D:85 |
| 16 | Certain | All `useSessionContext` consumers (~9 files: `app.tsx`, `sidebar/index.tsx`, `create-session-dialog`, `iframe-window`, `keyboard-shortcuts`, `use-dialog-state`, `use-sessions`, `use-file-upload`, `session-context.test`) migrate during this change. `boards-section.tsx` does NOT consume `useSessionContext` directly | Refined from intake #16 — verified via `grep`. `boards-section` uses `useBoards`, not session context | S:95 R:85 A:85 D:85 |
| 17 | Certain | E2E suite passes unchanged for single-server (`rk-e2e`). New e2e exercises multi-server rendering | Confirmed from intake #17 — multi-server is `N=1` generalization | S:95 R:90 A:85 D:85 |
| 18 | Certain | New multi-server e2e uses approach (B) — spawn a second `tmux -L rk-e2e-multi-{digits}` server in the test fixture, mirroring the existing `boards-multi-server.spec.ts` pattern | Clarified: verified no network-mocking infra exists in `tests/e2e/` (no `page.route`, no MSW handlers for `/api/servers`); existing `boards-multi-server.spec.ts` already establishes the second-tmux-server pattern | S:95 R:80 A:90 D:95 |
| 19 | Confident | `StandaloneSessionContextProvider` test helper accepts the new keyed shape; the legacy single-server convenience form is removed in the final commit of the PR alongside the accessor | New (spec-level): downstream of assumption #9 | S:80 R:85 A:80 D:80 |
| 20 | Confident | Server section "+ New session" affordance creates on that section's server, regardless of `currentServer` | New (spec-level): natural UX; aligns with intake's "+New session moves into each server section header" | S:85 R:80 A:85 D:85 |
| 21 | Confident | Per-server localStorage key uses `runkit-panel-sessions-{server}` namespacing; the existing `runkit-panel-sessions` key SHALL be migrated to the current server's namespaced key on first read (best-effort, no error if missing) | New (spec-level): preserves existing user state on the current server through the upgrade | S:75 R:75 A:80 D:75 |

21 assumptions (19 certain, 2 confident, 0 tentative, 0 unresolved).
