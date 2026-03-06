# Quality Checklist: Performance — SSE, Chrome Context, and Session Enrichment

**Change**: 260306-0ahl-perf-sse-chrome-sessions
**Generated**: 2026-03-06
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Parallel session enrichment: `fetchSessions()` uses `Promise.all` across sessions
- [ ] CHK-002 Indexed assignment: Result array preserves tmux session ordering
- [ ] CHK-003 SSE timer cleanup: `cancel()` calls `clearTimeout` on pending poll timer
- [ ] CHK-004 SSE lifetime cap: Connection self-closes after 30 minutes
- [ ] CHK-005 SSE pub/sub singleton: Single poll loop shared across all SSE clients
- [ ] CHK-006 Chrome context split: `ChromeStateContext` and `ChromeDispatchContext` exist as separate contexts
- [ ] CHK-007 `useChromeDispatch()` hook: Exported and returns stable setter reference
- [ ] CHK-008 `useChrome()` backward compat: Existing callers unchanged, returns merged state + dispatch
- [ ] CHK-009 Dashboard search inline: Search input rendered in component JSX, not via `setLine2Left()`
- [ ] CHK-010 SessionProvider: Single `EventSource` at layout level, exposes sessions + isConnected
- [ ] CHK-011 SessionProvider isConnected forwarding: Forwards to ChromeProvider internally
- [ ] CHK-012 `useSessions()` refactored: Reads from SessionProvider context, no own EventSource
- [ ] CHK-013 ResizeObserver debounce: Uses rAF, single fit per animation frame
- [ ] CHK-014 useModifierState memoized: Return object wrapped in `useMemo`
- [ ] CHK-015 Shortcuts memoized: Dashboard and project page `shortcuts` objects wrapped in `useMemo`
- [ ] CHK-016 WebSocket reconnection: Exponential backoff (1s-30s), visual indicator, resize on reconnect

## Behavioral Correctness

- [ ] CHK-017 Per-page `setIsConnected` forwarding removed: All 3 pages no longer forward isConnected
- [ ] CHK-018 Dashboard `setLine2Left` no longer called per-keystroke: Only called once on mount for button
- [ ] CHK-019 SSE singleton fan-out: All connected controllers receive same snapshot on change
- [ ] CHK-020 SSE singleton lifecycle: Polling starts on first client, stops on last disconnect

## Scenario Coverage

- [ ] CHK-021 Multiple tabs share poll: Opening multiple tabs results in single `fetchSessions()` per interval
- [ ] CHK-022 Client disconnect cleanup: Disconnecting cleans up controller from singleton set
- [ ] CHK-023 Search typing does not re-render TopBarChrome: Verified in dev tools / React profiler
- [ ] CHK-024 WebSocket reconnect after drop: Terminal reconnects and resumes output after WS close

## Edge Cases & Error Handling

- [ ] CHK-025 SSE singleton with zero clients: No polling occurs, no errors
- [ ] CHK-026 WebSocket reconnect on unmount: No reconnect attempted when component unmounts
- [ ] CHK-027 SessionProvider before first SSE event: Returns empty sessions array, isConnected false
- [ ] CHK-028 ResizeObserver during unmount: rAF cancelled, no fit on disposed terminal

## Code Quality

- [ ] CHK-029 Pattern consistency: New code follows naming and structural patterns of surrounding code
- [ ] CHK-030 No unnecessary duplication: Existing utilities reused where applicable
- [ ] CHK-031 `execFile` with argument arrays: No `exec` or shell strings introduced (constitution §I)
- [ ] CHK-032 No `useEffect` for data fetching: SessionProvider uses useEffect only for EventSource lifecycle
- [ ] CHK-033 No polling from client: SSE stream used, no `setInterval` + fetch (anti-pattern check)
- [ ] CHK-034 No in-memory caches without justification: SSE singleton is justified (shared poll dedup)

## Security

- [ ] CHK-035 No new subprocess calls without timeout: Any new `execFile` calls include timeout parameter
- [ ] CHK-036 SSE endpoint handles disconnection without throwing: Controller errors caught gracefully

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
