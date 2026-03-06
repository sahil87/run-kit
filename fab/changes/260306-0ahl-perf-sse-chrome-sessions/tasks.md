# Tasks: Performance — SSE, Chrome Context, and Session Enrichment

**Change**: 260306-0ahl-perf-sse-chrome-sessions
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Server-Side Performance

- [x] T001 Parallelize session enrichment in `src/lib/sessions.ts`: Replace serial `for...of` loop (lines 48-60) with `Promise.all` + `sessionWindows.map()`. Pre-allocate `result` array with length `sessionWindows.length` and use indexed assignment (`result[i] = ...`) to preserve tmux ordering.

- [x] T002 [P] Create SSE pub/sub singleton in `src/app/api/sessions/stream/route.ts`: Add module-level `SessionPoller` object with a `Set<ReadableStreamController>` for connected clients. Single poll loop calls `fetchSessions()` at `SSE_POLL_INTERVAL`, fans out changed snapshots to all controllers. Starts on first `add()`, stops on last `remove()`. Capture `setTimeout` handle for cleanup.

- [x] T003 [P] Refactor SSE route handler in `src/app/api/sessions/stream/route.ts`: Replace per-connection poll loop with singleton registration. `start(controller)` → register with singleton. `cancel()` → deregister + clearTimeout. Add 30-minute lifetime timer that calls `controller.close()` on expiry.

## Phase 2: Client-Side Context Architecture

- [x] T004 Split ChromeContext in `src/contexts/chrome-context.tsx`: Create `ChromeStateContext` (read-only state) and `ChromeDispatchContext` (stable setters). `ChromeProvider` provides both. Export `useChrome()` (state + dispatch merged, backward compat) and `useChromeDispatch()` (dispatch only). Dispatch context value created with `useRef` + initial setter functions for stable reference.

- [x] T005 Create SessionProvider in `src/contexts/session-context.tsx`: New context with single `EventSource` connection to `/api/sessions/stream`. Exposes `{ sessions: ProjectSession[], isConnected: boolean }`. Forward `isConnected` to `ChromeProvider` via `useChromeDispatch().setIsConnected` internally. Accept optional `initialSessions` prop.

- [x] T006 Mount SessionProvider in `src/app/layout.tsx`: Wrap children with `SessionProvider` inside `ChromeProvider`. Import and add the provider to the component tree.

## Phase 3: Consumer Migration

- [x] T007 Refactor `src/hooks/use-sessions.ts`: Replace `EventSource` logic with `useContext(SessionContext)`. Return `{ sessions, isConnected }` from context. Remove `useState`, `useEffect`, and `useRef` for EventSource management.

- [x] T008 [P] Update `src/app/dashboard-client.tsx`: (a) Use `useChromeDispatch()` for setter-only calls. (b) Move search input from `setLine2Left()` to inline JSX — keep `+ New Session` button in `setLine2Left()` (set once on mount). (c) Remove `setIsConnected(isConnected)` forwarding useEffect. (d) Wrap `shortcuts` object (lines 87-91) in `useMemo`.

- [x] T009 [P] Update `src/app/p/[project]/project-client.tsx`: (a) Use `useChromeDispatch()` for setter-only calls. (b) Remove `setIsConnected(isConnected)` forwarding useEffect. (c) Wrap `shortcuts` object (lines 52-63) in `useMemo`.

- [x] T010 [P] Update `src/app/p/[project]/[window]/terminal-client.tsx`: (a) Use `useChromeDispatch()` for setter-only calls. (b) Remove `setIsConnected(isConnected)` forwarding useEffect.

- [x] T011 [P] Update `src/components/top-bar-chrome.tsx`: Use `useChrome()` (reads state — no change needed, but verify it works with split contexts).

- [x] T012 [P] Update `src/components/bottom-bar.tsx`: Verify works with split contexts (reads via `useModifierState`, not chrome context — likely no change).

## Phase 4: Performance Optimizations

- [x] T013 Debounce ResizeObserver in `src/app/p/[project]/[window]/terminal-client.tsx` (lines 223-234): Wrap `fitAddon.fit()` + WS resize message in `requestAnimationFrame`. Use a pending rAF ref to cancel on rapid-fire and only execute the last one.

- [x] T014 [P] Memoize useModifierState return in `src/hooks/use-modifier-state.ts` (lines 33-41): Wrap return object in `useMemo` keyed on `stateRef.current.ctrl`, `stateRef.current.alt`, `stateRef.current.cmd` and the stable callbacks.

- [x] T015 [P] Add WebSocket reconnection in `src/app/p/[project]/[window]/terminal-client.tsx`: Implement exponential backoff (1s, 2s, 4s, 8s, 16s, max 30s) on unexpected `ws.onclose`. Show `[reconnecting...]` in gray via `terminal.write()`. Re-send resize on successful reconnect. Reset backoff on success. Skip reconnect if component is unmounting.

## Phase 5: Verification

- [x] T016 Run `npx tsc --noEmit` — verify zero type errors across all changed files.
- [x] T017 Run `pnpm build` — verify production build succeeds (catches SSR issues, missing imports).

---

## Execution Order

- T001 is independent (server-side only)
- T002 blocks T003 (singleton must exist before route handler refactor)
- T004 blocks T005 (SessionProvider uses `useChromeDispatch` from split context)
- T005 blocks T006 (provider must exist before mounting)
- T004 + T006 block T007-T012 (consumers need both split context and SessionProvider available)
- T007 is independent of T008-T012 (hook refactor vs component updates)
- T008-T012 are parallelizable (independent component files)
- T013-T015 are parallelizable and independent of T001-T012
- T016-T017 must run after all other tasks complete
