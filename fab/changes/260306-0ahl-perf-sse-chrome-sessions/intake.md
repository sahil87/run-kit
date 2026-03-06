# Intake: Performance — SSE, Chrome Context, and Session Enrichment

**Change**: 260306-0ahl-perf-sse-chrome-sessions
**Created**: 2026-03-06
**Status**: Draft

## Origin

> Performance review of `src/` using parallel review agents. Two agents audited server-side (lib/, API routes, terminal relay) and client-side (components, hooks, contexts) code independently, producing a consolidated report with 4 high, 9 medium, and 6 low severity findings.

Conversational mode — findings discussed and triaged before creating this change. The top 3 recommendations were selected for this change based on impact and feasibility.

## Why

1. **Serial session enrichment blocks page loads.** `fetchSessions()` checks `hasFabKit()` sequentially for each tmux session, then enriches windows serially. With 10 sessions, this serializes 10+ subprocess calls that could run in parallel. Every SSE poll and every page load pays this cost.

2. **SSE connections leak resources.** Each browser tab opens an independent `EventSource` and triggers independent polling. If a client disconnects without clean `cancel()` (browser crash, network drop), the polling loop runs forever — spawning `execFile` subprocesses every 2.5s. With 3 tabs open, that's 3x the subprocess load for identical data.

3. **ChromeContext causes cascade re-renders.** All chrome state (breadcrumbs, line2Left, line2Right, bottomBar, isConnected, fullbleed) lives in one context. Any state change re-renders every consumer. The dashboard's search input calls `setLine2Left()` with new JSX on every keystroke, triggering a full chrome re-render cascade per keypress.

If left unfixed: performance degrades linearly with session count and open tabs. Resource leaks from orphaned SSE connections accumulate over time. Keystroke latency on the dashboard search becomes noticeable with complex chrome trees.

## What Changes

### Server-Side: Parallelize Session Enrichment

Replace the serial `for...of` loop in `src/lib/sessions.ts` (lines 46-57) with `Promise.all`:

```typescript
// Before: serial
for (const { sessionName, windows } of sessionWindows) {
  const projectRoot = windows[0]?.worktreePath ?? "";
  if (projectRoot && (await hasFabKit(projectRoot))) {
    await Promise.all(windows.map((win) => enrichWindow(win, projectRoot)));
  }
  result.push({ name: sessionName, windows });
}

// After: parallel across sessions
await Promise.all(
  sessionWindows.map(async ({ sessionName, windows }) => {
    const projectRoot = windows[0]?.worktreePath ?? "";
    if (projectRoot && (await hasFabKit(projectRoot))) {
      await Promise.all(windows.map((win) => enrichWindow(win, projectRoot)));
    }
    result.push({ name: sessionName, windows });
  }),
);
```

Note: push order becomes non-deterministic. Sort by session name afterward if ordering matters.

### Server-Side: SSE Connection Lifecycle

In `src/app/api/sessions/stream/route.ts`:

1. **Timer cleanup**: Capture the `setTimeout` handle and `clearTimeout` in `cancel()` to prevent dangling polls after client disconnect.
2. **Connection lifetime cap**: Add a maximum lifetime (e.g., 30 minutes) after which the stream self-closes, forcing clients to reconnect.
3. **Deduplicate polling across clients**: Implement a simple pub/sub pattern — one shared poll loop that fans out to all connected SSE streams. When no clients are connected, polling stops.

### Client-Side: Split ChromeContext

Split `src/contexts/chrome-context.tsx` into narrower contexts to prevent cross-slot re-renders:

- **ChromeStateContext** — read-only state values (breadcrumbs, line2Left, line2Right, bottomBar, isConnected, fullbleed)
- **ChromeDispatchContext** — stable setter functions (setBreadcrumbs, setLine2Left, etc.)

Consumers that only call setters (most page `useEffect` hooks) subscribe to dispatch context only — no re-renders when state changes. Consumers that read state (TopBarChrome, BottomSlot) subscribe to the state they need.

Additionally, fix the dashboard search input pattern: stop pumping new JSX into the chrome context on every `filterQuery` change. Options:
- Render the search input inline in the dashboard component instead of via chrome slot
- Or store `filterQuery` as a string in context and render the input inside TopBarChrome

### Client-Side: Lift useSessions to Layout Level

Move the SSE connection from per-page `useSessions()` hooks to a `SessionProvider` at the layout level (`src/app/layout.tsx`). Benefits:

- Exactly one `EventSource` for the entire app
- Eliminates the `setIsConnected(isConnected)` forwarding in all three page components
- Session data available immediately on route transitions (no flash of stale data)
- Cleaner separation: pages consume session data, layout owns the connection

### Client-Side: Additional Optimizations

1. **Debounce ResizeObserver** in `src/app/p/[project]/[window]/terminal-client.tsx` (lines 223-234): Wrap `fitAddon.fit()` + WS resize message in a ~100ms debounce or `requestAnimationFrame` to prevent dozens of reflows during window resize.

2. **Memoize `useModifierState` return** in `src/hooks/use-modifier-state.ts` (lines 33-41): Wrap the return object in `useMemo` to prevent cascading callback recreation (`sendWithMods`, `sendSpecial`, `sendArrow`).

3. **Stabilize shortcuts objects** in `src/app/dashboard-client.tsx` (lines 87-91) and `src/app/p/[project]/project-client.tsx` (lines 52-63): Wrap in `useMemo` to prevent `useKeyboardNav` from detaching/re-attaching keydown listeners every render.

4. **WebSocket reconnection** in `src/app/p/[project]/[window]/terminal-client.tsx` (lines 205-213): Add exponential backoff reconnection when the WebSocket closes unexpectedly, with a visual indicator. Re-send resize on reconnect.

## Affected Memory

- `run-kit/architecture`: (modify) Update SSE design decision to reflect pub/sub dedup, document SessionProvider pattern, update ChromeProvider section for split contexts
- `run-kit/ui-patterns`: (modify) Update ChromeProvider section to reflect split contexts, add note about SessionProvider

## Impact

- **`src/lib/sessions.ts`** — `fetchSessions` parallelization
- **`src/app/api/sessions/stream/route.ts`** — SSE lifecycle, pub/sub polling
- **`src/contexts/chrome-context.tsx`** — split into multiple contexts
- **`src/app/layout.tsx`** — add SessionProvider
- **`src/hooks/use-sessions.ts`** — refactor for shared connection
- **`src/app/dashboard-client.tsx`** — consume from SessionProvider, fix search input pattern, stabilize shortcuts
- **`src/app/p/[project]/project-client.tsx`** — consume from SessionProvider, stabilize shortcuts
- **`src/app/p/[project]/[window]/terminal-client.tsx`** — consume from SessionProvider, debounce ResizeObserver, add WS reconnect
- **`src/hooks/use-modifier-state.ts`** — memoize return value
- **`src/components/top-bar-chrome.tsx`** — consume split context
- **`src/components/bottom-bar.tsx`** — consume split context

## Open Questions

- Should the SSE pub/sub dedup use a module-level singleton or a more structured pattern (e.g., `BroadcastChannel`)? Module-level singleton is simpler for a single-process Next.js server.
- Should `SessionProvider` expose the full `ProjectSession[]` or also provide per-project/per-window selectors to further reduce re-renders?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `Promise.all` for session enrichment parallelization | Discussed — direct replacement of serial loop, no ordering dependency | S:95 R:90 A:95 D:95 |
| 2 | Certain | Split ChromeContext into state/dispatch contexts | Discussed — standard React pattern for avoiding re-render cascades | S:90 R:85 A:90 D:90 |
| 3 | Certain | Lift useSessions to layout-level SessionProvider | Discussed — eliminates redundant SSE connections and forwarding boilerplate | S:90 R:80 A:90 D:85 |
| 4 | Certain | Debounce ResizeObserver fitAddon.fit at ~100ms | Discussed — prevents reflow storms during window resize | S:85 R:95 A:90 D:90 |
| 5 | Certain | Memoize useModifierState return value | Discussed — prevents cascading callback recreation | S:85 R:95 A:90 D:95 |
| 6 | Confident | SSE pub/sub uses module-level singleton pattern | Module-level singleton is simplest for single-process Next.js; BroadcastChannel adds complexity without benefit | S:75 R:80 A:75 D:65 |
| 7 | Confident | Add 30-minute SSE connection lifetime cap | Reasonable default; forces reconnect to prevent indefinite orphan accumulation. Exact value can be tuned | S:70 R:90 A:70 D:65 |
| 8 | Confident | WebSocket reconnection uses exponential backoff (1s, 2s, 4s, max 30s) | Standard pattern; exact intervals are tunable | S:70 R:85 A:80 D:70 |
| 9 | Confident | Dashboard search input rendered inline instead of via chrome slot | Simpler fix than storing filterQuery in context; avoids per-keystroke context updates | S:75 R:85 A:80 D:60 |
| 10 | Tentative | Session push order preserved via post-sort by session name | Parallel `Promise.all` makes push order non-deterministic; sorting by name provides stable UI order. Alternative: use indexed assignment | S:60 R:90 A:60 D:50 |
<!-- assumed: Sort by session name — parallel push makes order non-deterministic, name sort provides stable display order -->

10 assumptions (5 certain, 4 confident, 1 tentative, 0 unresolved).
