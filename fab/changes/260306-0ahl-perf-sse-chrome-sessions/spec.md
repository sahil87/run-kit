# Spec: Performance — SSE, Chrome Context, and Session Enrichment

**Change**: 260306-0ahl-perf-sse-chrome-sessions
**Created**: 2026-03-06
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Switching SSE to WebSocket for session state — SSE remains the transport (architecture decision)
- Diff-based SSE payloads — full snapshots remain (payload is small, client logic stays simple)
- Per-field chrome context splitting (e.g., separate context for each slot) — two contexts (state/dispatch) is sufficient
- Concurrent subprocess throttling — `Promise.all` is safe for the expected session count (<50)

## Server: Session Enrichment Parallelization

### Requirement: Parallel session enrichment

`fetchSessions()` in `src/lib/sessions.ts` SHALL enrich all sessions in parallel using `Promise.all` instead of serial `for...of` iteration. The `hasFabKit()` check and `enrichWindow()` calls for each session SHALL run concurrently across sessions. Within a single session, window enrichment MAY continue to use `Promise.all` (already parallel).

#### Scenario: Multiple fab-kit sessions enriched in parallel

- **GIVEN** 5 tmux sessions, 3 of which have fab-kit projects
- **WHEN** `fetchSessions()` is called
- **THEN** all 5 sessions' `hasFabKit()` checks run concurrently
- **AND** the 3 fab-kit sessions' window enrichment runs concurrently across sessions
- **AND** the returned `ProjectSession[]` preserves original tmux session ordering via indexed assignment

### Requirement: Preserve tmux session ordering

The result array from `fetchSessions()` SHALL preserve the original tmux session ordering using indexed assignment (`result[i] = ...`) rather than `result.push()`. The parallel `Promise.all` makes push order non-deterministic; indexed assignment ensures deterministic output.

#### Scenario: Session order matches tmux list-sessions order

- **GIVEN** tmux reports sessions in order: `alpha`, `beta`, `gamma`
- **WHEN** `fetchSessions()` completes with parallel enrichment
- **THEN** the returned array is `[{name: "alpha", ...}, {name: "beta", ...}, {name: "gamma", ...}]`

## Server: SSE Connection Lifecycle

### Requirement: Timer cleanup on disconnect

The SSE route handler in `src/app/api/sessions/stream/route.ts` SHALL capture the `setTimeout` return value and call `clearTimeout` in the `cancel()` callback. This prevents dangling poll cycles from continuing to spawn `fetchSessions()` subprocesses after client disconnect.

#### Scenario: Client disconnects mid-poll

- **GIVEN** an active SSE connection with a pending `setTimeout` for the next poll
- **WHEN** the client disconnects (browser tab closed, network drop)
- **THEN** `cancel()` fires, `clearTimeout` is called on the pending timer
- **AND** no further `fetchSessions()` calls occur for this connection

### Requirement: Connection lifetime cap

Each SSE connection SHALL have a maximum lifetime of 30 minutes. After 30 minutes, the stream SHALL close itself by calling `controller.close()`. Clients reconnect automatically via `EventSource`'s built-in reconnection.

#### Scenario: Connection reaches lifetime cap

- **GIVEN** an SSE connection that has been active for 30 minutes
- **WHEN** the lifetime timer fires
- **THEN** the stream closes via `controller.close()`
- **AND** the client's `EventSource` triggers `onerror` and auto-reconnects

### Requirement: Deduplicate polling via pub/sub singleton

The SSE route SHALL use a module-level singleton to deduplicate polling across multiple connected clients. The singleton SHALL:

1. Maintain a `Set` of connected `ReadableStreamController` instances
2. Run a single shared poll loop (using the existing `SSE_POLL_INTERVAL`) that calls `fetchSessions()` once per tick
3. Fan out each new snapshot to all registered controllers
4. Start polling when the first client connects
5. Stop polling when the last client disconnects

Each SSE route handler SHALL register its controller with the singleton on connection and deregister on `cancel()`.

#### Scenario: Multiple tabs share one poll loop

- **GIVEN** 3 browser tabs each open an SSE connection to `/api/sessions/stream`
- **WHEN** all 3 connections are active
- **THEN** only 1 `fetchSessions()` call occurs per poll interval
- **AND** all 3 controllers receive the same snapshot data

#### Scenario: Last client disconnects stops polling

- **GIVEN** 2 active SSE connections sharing the singleton poll loop
- **WHEN** both clients disconnect
- **THEN** the singleton stops its poll loop (clears the interval/timeout)
- **AND** no further `fetchSessions()` calls occur until a new client connects

#### Scenario: Change detection per snapshot

- **GIVEN** the singleton poll loop produces a new snapshot
- **WHEN** the JSON-serialized snapshot differs from the previous snapshot
- **THEN** the snapshot is fanned out to all registered controllers
- **AND** if the snapshot is unchanged, no data is sent (existing dedup logic preserved)

## Client: Chrome Context Split

### Requirement: Split ChromeContext into state and dispatch contexts

`src/contexts/chrome-context.tsx` SHALL be refactored to provide two separate React contexts:

1. **ChromeStateContext** — contains read-only state values: `breadcrumbs`, `line2Left`, `line2Right`, `bottomBar`, `isConnected`, `fullbleed`
2. **ChromeDispatchContext** — contains stable setter functions: `setBreadcrumbs`, `setLine2Left`, `setLine2Right`, `setBottomBar`, `setIsConnected`, `setFullbleed`

The dispatch context value SHALL be a stable reference (created once, never recreated) so consumers that only need setters do not re-render when state changes.

#### Scenario: Setter-only consumers avoid re-renders

- **GIVEN** a page component that calls `useChrome()` and only uses setters (e.g., `setBreadcrumbs`, `setLine2Left`)
- **WHEN** `isConnected` changes from `false` to `true`
- **THEN** the page component does NOT re-render
- **AND** `TopBarChrome` (which reads `isConnected`) DOES re-render

### Requirement: useChrome hook backward compatibility

The existing `useChrome()` hook SHALL continue to work unchanged for consumers that need both state and setters. It SHALL return the merged state + dispatch object. A new `useChromeDispatch()` hook SHALL be exported for consumers that only need setters.

#### Scenario: Existing useChrome callers unchanged

- **GIVEN** `TopBarChrome` calls `useChrome()` and reads `breadcrumbs`, `line2Left`, `line2Right`, `isConnected`
- **WHEN** any of those values change
- **THEN** `TopBarChrome` re-renders with the new values (same behavior as before)

#### Scenario: Optimized dispatch-only consumer

- **GIVEN** `DashboardClient` only needs setters from chrome context in its `useEffect` hooks
- **WHEN** `DashboardClient` uses `useChromeDispatch()` instead of `useChrome()` for setters
- **THEN** `DashboardClient` does not re-render when chrome state changes elsewhere

### Requirement: Dashboard search input rendered inline

`src/app/dashboard-client.tsx` SHALL render the search input directly in its JSX instead of injecting it via `setLine2Left()`. This eliminates the per-keystroke `setLine2Left()` calls that trigger chrome context state updates and cascade re-renders.

The `+ New Session` button SHALL still be injected via `setLine2Left()` (set once on mount, no per-keystroke updates). The search input SHALL be rendered beside it in the dashboard's own component tree.

#### Scenario: Search input does not trigger chrome re-renders

- **GIVEN** the dashboard page is active with the search input rendered inline
- **WHEN** the user types a search query character by character
- **THEN** only the dashboard component re-renders (local `filterQuery` state)
- **AND** `TopBarChrome` does NOT re-render on each keystroke

## Client: Session Provider

### Requirement: Layout-level SessionProvider

A `SessionProvider` context SHALL be created and mounted in `src/app/layout.tsx` (inside `ChromeProvider`). It SHALL:

1. Create exactly one `EventSource` connection to `/api/sessions/stream`
2. Expose `sessions: ProjectSession[]` and `isConnected: boolean` to all descendants
3. Accept optional `initialSessions` for SSR hydration

#### Scenario: Single EventSource for entire app

- **GIVEN** the user navigates from dashboard to project to terminal pages
- **WHEN** each page component mounts
- **THEN** no new `EventSource` connections are created
- **AND** the single layout-level connection remains active throughout

### Requirement: Refactor useSessions to consume SessionProvider

`src/hooks/use-sessions.ts` SHALL be refactored to read from `SessionProvider` context instead of creating its own `EventSource`. The hook SHALL become a thin wrapper: `useSessions()` returns `{ sessions, isConnected }` from the context.

#### Scenario: Page components consume shared session data

- **GIVEN** `DashboardClient`, `ProjectClient`, and `TerminalClient` all call `useSessions()`
- **WHEN** new session data arrives via SSE
- **THEN** all three components receive the same data from the single provider
- **AND** no `setIsConnected(isConnected)` forwarding to ChromeProvider is needed per page

### Requirement: isConnected forwarded to ChromeProvider

The `SessionProvider` SHALL forward `isConnected` to `ChromeProvider` via `setIsConnected()`. This eliminates the per-page `useEffect(() => setIsConnected(isConnected), ...)` pattern currently in all three page components.

#### Scenario: Connection status reflected in top bar

- **GIVEN** the SSE connection drops
- **WHEN** `EventSource.onerror` fires
- **THEN** `SessionProvider` sets `isConnected = false` and calls `setIsConnected(false)`
- **AND** `TopBarChrome` shows "disconnected" without any page-level forwarding

## Client: ResizeObserver Debounce

### Requirement: Debounce terminal resize

The `ResizeObserver` callback in `src/app/p/[project]/[window]/terminal-client.tsx` SHALL debounce `fitAddon.fit()` and the WebSocket resize message using `requestAnimationFrame` (or a ~100ms timeout). This prevents dozens of reflows during window resize.

#### Scenario: Window resize triggers single fit

- **GIVEN** the terminal page is active and the user drags the window border
- **WHEN** the `ResizeObserver` fires multiple times in rapid succession
- **THEN** `fitAddon.fit()` is called at most once per animation frame (or per 100ms window)
- **AND** only one WebSocket resize message is sent per debounce window

## Client: useModifierState Memoization

### Requirement: Memoize useModifierState return value

`src/hooks/use-modifier-state.ts` SHALL wrap its return object in `useMemo` to produce a stable reference when the modifier state has not changed. This prevents downstream consumers (`sendWithMods`, `sendSpecial`, `sendArrow` in `BottomBar`) from recreating their `useCallback` closures on every render.

#### Scenario: BottomBar callbacks stable across renders

- **GIVEN** `BottomBar` is rendered and no modifier state has changed
- **WHEN** a parent component triggers a re-render of `BottomBar`
- **THEN** `sendWithMods`, `sendSpecial`, and `sendArrow` callback references remain stable
- **AND** no keydown listeners are detached/re-attached

## Client: Stabilize Shortcuts Objects

### Requirement: Memoize useKeyboardNav shortcuts

The `shortcuts` objects passed to `useKeyboardNav` in `src/app/dashboard-client.tsx` and `src/app/p/[project]/project-client.tsx` SHALL be wrapped in `useMemo`. This prevents `useKeyboardNav` from detaching and re-attaching its `keydown` event listener on every render.

#### Scenario: Dashboard shortcuts object stable

- **GIVEN** `DashboardClient` renders with a `shortcuts` object containing `c` and `/` handlers
- **WHEN** the component re-renders due to SSE session data update
- **THEN** the `shortcuts` object reference is unchanged
- **AND** `useKeyboardNav`'s `keydown` listener is NOT removed and re-added

## Client: WebSocket Reconnection

### Requirement: Exponential backoff reconnection

The WebSocket connection in `src/app/p/[project]/[window]/terminal-client.tsx` SHALL implement automatic reconnection with exponential backoff when the WebSocket closes unexpectedly (`ws.onclose` fires without the component unmounting).

Backoff schedule: 1s, 2s, 4s, 8s, 16s, max 30s. On successful reconnect, reset backoff to 1s. On reconnect, re-send the current terminal dimensions via resize message.

#### Scenario: WebSocket drops and reconnects

- **GIVEN** an active terminal session with a WebSocket connection
- **WHEN** the WebSocket closes unexpectedly (server restart, network blip)
- **THEN** after 1 second, a new WebSocket connection is attempted
- **AND** on successful reconnect, a resize message with current `terminal.cols` and `terminal.rows` is sent
- **AND** terminal output resumes normally

#### Scenario: Repeated failures use exponential backoff

- **GIVEN** a WebSocket that has failed to reconnect twice (1s and 2s attempts)
- **WHEN** the third reconnect attempt also fails
- **THEN** the next attempt waits 4 seconds
- **AND** the backoff continues doubling up to a maximum of 30 seconds

### Requirement: Visual reconnection indicator

While the WebSocket is disconnected and reconnection is pending, a visual indicator SHALL be shown in the terminal. This SHOULD be a gray `[reconnecting...]` message written to the terminal via `terminal.write()`.

#### Scenario: User sees reconnection status

- **GIVEN** the WebSocket disconnects unexpectedly
- **WHEN** the reconnection backoff is in progress
- **THEN** the terminal displays `[reconnecting...]` in gray text
- **AND** on successful reconnect, normal output resumes

## Design Decisions

1. **Module-level singleton for SSE pub/sub**: Shared poll loop with a `Set<Controller>`
   - *Why*: Simplest approach for single-process Next.js. One poll loop, fan-out to N clients.
   - *Rejected*: `BroadcastChannel` — adds cross-process serialization overhead for no benefit in a single-process server.

2. **Two Chrome contexts (state/dispatch) not per-field**: Split into state and dispatch rather than one context per field
   - *Why*: Two contexts covers the primary optimization (setter-only consumers skip re-renders) with minimal API surface change. Per-field splitting creates ~12 contexts for marginal additional benefit.
   - *Rejected*: Per-field contexts (12 individual contexts) — excessive fragmentation, complex provider tree.

3. **Indexed assignment for parallel enrichment ordering**: `result[i] = session` instead of sort
   - *Why*: Preserves original tmux ordering without introducing a sort key assumption. Zero runtime cost.
   - *Rejected*: Post-sort by session name — changes existing behavior (tmux natural order) to alphabetical.

4. **requestAnimationFrame for ResizeObserver debounce**: Rather than a fixed timeout
   - *Why*: Naturally aligns with browser paint cycles. One fit per frame during resize drag.
   - *Rejected*: Fixed 100ms timeout — arbitrary and may still allow multiple reflows within one paint cycle.

5. **SessionProvider forwards isConnected to ChromeProvider**: Rather than having each page forward it
   - *Why*: Eliminates identical `useEffect(() => setIsConnected(isConnected), ...)` in 3 page components.
   - *Rejected*: Keep per-page forwarding — duplicated boilerplate, easy to forget in new pages.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `Promise.all` for session enrichment parallelization | Confirmed from intake #1 — direct replacement of serial loop | S:95 R:90 A:95 D:95 |
| 2 | Certain | Split ChromeContext into state/dispatch contexts | Confirmed from intake #2 — standard React pattern | S:90 R:85 A:90 D:90 |
| 3 | Certain | Lift useSessions to layout-level SessionProvider | Confirmed from intake #3 — eliminates redundant SSE connections | S:90 R:80 A:90 D:85 |
| 4 | Certain | Debounce ResizeObserver with requestAnimationFrame | Upgraded from intake #4 — rAF preferred over fixed timeout per design decision | S:90 R:95 A:90 D:90 |
| 5 | Certain | Memoize useModifierState return value | Confirmed from intake #5 — prevents cascading callback recreation | S:85 R:95 A:90 D:95 |
| 6 | Certain | SSE pub/sub uses module-level singleton pattern | Confirmed from intake #6 — clarified by user | S:95 R:80 A:75 D:65 |
| 7 | Certain | Add 30-minute SSE connection lifetime cap | Confirmed from intake #7 — clarified by user | S:95 R:90 A:70 D:65 |
| 8 | Certain | WebSocket reconnection uses exponential backoff (1s, 2s, 4s, max 30s) | Confirmed from intake #8 — clarified by user | S:95 R:85 A:80 D:70 |
| 9 | Certain | Dashboard search input rendered inline instead of via chrome slot | Confirmed from intake #9 — clarified by user | S:95 R:85 A:80 D:60 |
| 10 | Certain | Session order preserved via indexed assignment | Confirmed from intake #10 — user chose indexed assignment | S:95 R:90 A:60 D:50 |
| 11 | Certain | useChrome backward compat + new useChromeDispatch hook | Required for incremental migration — existing useChrome consumers unchanged | S:90 R:90 A:90 D:85 |
| 12 | Certain | SessionProvider forwards isConnected to ChromeProvider internally | Eliminates per-page forwarding boilerplate — design decision #5 | S:85 R:85 A:90 D:90 |
| 13 | Certain | requestAnimationFrame over fixed timeout for resize debounce | Design decision #4 — aligns with browser paint cycles | S:90 R:95 A:85 D:80 |
| 14 | Confident | SessionProvider exposes full ProjectSession[] without selectors | Open question from intake — selectors add complexity for marginal benefit at current scale (<50 sessions). Can be added later if profiling shows need | S:75 R:90 A:75 D:65 |

14 assumptions (13 certain, 1 confident, 0 tentative, 0 unresolved).
