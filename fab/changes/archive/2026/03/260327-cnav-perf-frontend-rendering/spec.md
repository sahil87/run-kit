# Spec: Performance Phase 3 — Frontend Rendering

**Change**: 260327-cnav-perf-frontend-rendering
**Created**: 2026-03-27
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Backend SSE polling optimization (Phase 1/2 — separate changes)
- Lazy-loading or bundle splitting (Phase 4 — separate change)
- Adding React DevTools profiling or performance measurement infrastructure
- Changing the SSE polling interval or protocol

## SSE State Diffing

### Requirement: Deduplicate SSE session updates

The `SessionProvider` SSE event handler (`app/frontend/src/contexts/session-context.tsx`) SHALL compare incoming SSE event data against the previously received data before updating state. When the incoming `e.data` JSON string is identical to the previous event's string, `setSessions()` SHALL NOT be called.

The previous data string SHALL be stored in a `useRef<string>` initialized to `""`.

#### Scenario: SSE event with unchanged data
- **GIVEN** the SSE stream has previously delivered session data
- **WHEN** a new `sessions` event arrives with identical `e.data` JSON string
- **THEN** `setSessions()` is not called
- **AND** `markConnected()` is still called (connection liveness tracking unaffected)

#### Scenario: SSE event with changed data
- **GIVEN** the SSE stream has previously delivered session data
- **WHEN** a new `sessions` event arrives with different `e.data` JSON string
- **THEN** the ref is updated to the new string
- **AND** `setSessions()` is called with the parsed data

#### Scenario: First SSE event
- **GIVEN** the ref is initialized to `""`
- **WHEN** the first `sessions` event arrives
- **THEN** `setSessions()` is called (empty string never matches valid JSON)

### Requirement: Wrap session state updates in startTransition

When `setSessions()` is called (data has changed), it SHALL be wrapped in `React.startTransition()` to mark the update as non-urgent. This allows React to keep user interactions (typing, palette navigation) responsive while the component tree re-renders.

`startTransition` SHALL be imported from `"react"` at the module level.

#### Scenario: User typing during SSE update
- **GIVEN** the user is typing in a dialog input field
- **WHEN** an SSE event triggers `setSessions()` inside `startTransition()`
- **THEN** the input remains responsive (React may defer the session re-render)

#### Scenario: startTransition wrapping
- **GIVEN** incoming SSE data differs from previous
- **WHEN** the handler processes the event
- **THEN** `setSessions(data)` is called inside `startTransition(() => { ... })`
- **AND** `markConnected()` is called outside `startTransition` (connection state is urgent)

## Chrome Context Hooks

### Requirement: Export useChromeState hook

`app/frontend/src/contexts/chrome-context.tsx` SHALL export a `useChromeState()` function that returns `ChromeState` from `ChromeStateContext`. It SHALL throw if used outside `ChromeProvider`.

The existing `useChrome()` convenience hook SHALL be retained (returns `ChromeState & ChromeDispatch`). The existing `useChromeDispatch()` hook is already exported and requires no changes.

#### Scenario: Component reads only state
- **GIVEN** a component only needs `sidebarOpen`, `drawerOpen`, or `fixedWidth`
- **WHEN** it calls `useChromeState()`
- **THEN** it receives `ChromeState` without subscribing to dispatch identity changes

#### Scenario: useChrome backward compatibility
- **GIVEN** existing consumers use `useChrome()` for combined state + dispatch
- **WHEN** `useChromeState()` is added
- **THEN** `useChrome()` continues to work identically

### Requirement: Migrate state-only consumers to useChromeState

Components that destructure only state properties from `useChrome()` SHALL be migrated to `useChromeState()`:

1. `app/frontend/src/app.tsx` line 91: `const { sidebarOpen, drawerOpen, fixedWidth } = useChrome()` → `useChromeState()`
2. `app/frontend/src/components/top-bar.tsx` line 410: `const { fixedWidth } = useChrome()` → `useChromeState()`

Import statements SHALL be updated to import `useChromeState` instead of (or in addition to) `useChrome`.

#### Scenario: AppShell state consumption
- **GIVEN** `AppShell` in `app.tsx` destructures `{ sidebarOpen, drawerOpen, fixedWidth }`
- **WHEN** migrated to `useChromeState()`
- **THEN** it no longer re-renders when dispatch identity changes (though dispatch is already stable via useRef, this removes the merged-object allocation)

#### Scenario: TopBar FixedWidthToggle state consumption
- **GIVEN** `FixedWidthToggle` area in `top-bar.tsx` destructures `{ fixedWidth }`
- **WHEN** migrated to `useChromeState()`
- **THEN** the import of `useChrome` is removed from `top-bar.tsx` (only `useChromeDispatch` and `useChromeState` needed)

## Palette Action Memoization

### Requirement: Split palette actions into independent groups

The monolithic `paletteActions` useMemo in `app/frontend/src/app.tsx` (lines 341-477) SHALL be split into independently memoized action groups. Each group SHALL be a separate `useMemo` with only its relevant dependencies.

The groups SHALL be:

| Group | Depends on | Contents |
|-------|-----------|----------|
| `sessionActions` | `sessionName`, `dialogs` | Create/rename/kill session |
| `windowActions` | `sessionName`, `currentWindow`, `dialogs` | Create/rename/kill window, split, close pane, copy tmux attach |
| `viewActions` | `sessionName`, `fixedWidth`, `toggleFixedWidth` | Text input, fixed width toggle |
| `configActions` | (none — stable) | Reload tmux config, reset, keyboard shortcuts |
| `serverActions` | `servers`, `server`, `handleSwitchServer` | Create/kill/switch server |
| `terminalActions` | `flatWindows`, `navigateToWindow` | Terminal navigation entries |
| `themeActions` | (already separate) | Theme selection — already memoized independently |

A final `paletteActions` useMemo SHALL compose the groups:

```tsx
const paletteActions = useMemo(
  () => [...sessionActions, ...windowActions, ...viewActions, ...themeActions,
         ...configActions, ...serverActions, ...terminalActions],
  [sessionActions, windowActions, viewActions, themeActions,
   configActions, serverActions, terminalActions],
);
```

#### Scenario: SSE event with unchanged session structure
- **GIVEN** an SSE event arrives but `flatWindows` reference is unchanged (sessions array identity same due to diff guard)
- **WHEN** React evaluates the memoized groups
- **THEN** all groups return cached values (no rebuilding)

#### Scenario: SSE event with changed session data
- **GIVEN** an SSE event delivers changed session data
- **WHEN** `flatWindows` reference changes
- **THEN** only `terminalActions` rebuilds
- **AND** `configActions`, `themeActions`, `serverActions`, `viewActions` remain cached

#### Scenario: User opens a window
- **GIVEN** the user navigates to a window (setting `currentWindow`)
- **WHEN** `currentWindow` changes
- **THEN** only `windowActions` rebuilds (gains window-specific entries)
- **AND** other groups remain cached

### Requirement: Preserve action ordering

The composed `paletteActions` array SHALL maintain the same action ordering as the current monolithic useMemo: session actions first, then window actions, view actions, theme actions, config actions, server actions, terminal actions last.

#### Scenario: Command palette action order
- **GIVEN** the user opens the command palette
- **WHEN** actions are displayed
- **THEN** the order matches the pre-refactor order (session → window → view → theme → config → server → terminal)

## Terminal Write Batching

### Requirement: Buffer WebSocket messages with requestAnimationFrame

The WebSocket `onmessage` handler in `app/frontend/src/components/terminal-client.tsx` SHALL accumulate incoming data in buffers and flush to `terminal.write()` once per animation frame, rather than writing each message individually.

#### Scenario: Multiple rapid WebSocket messages
- **GIVEN** the WebSocket receives 10 messages within a single animation frame
- **WHEN** the rAF callback fires
- **THEN** all text data is written in a single `terminal.write()` call
- **AND** binary data chunks are written sequentially after the text

#### Scenario: Single message between frames
- **GIVEN** the WebSocket receives one message
- **WHEN** the next rAF callback fires
- **THEN** the message is written normally (no functional difference from unbuffered)

### Requirement: Separate text and binary buffer paths

String messages (`typeof event.data === "string"`) SHALL be concatenated into a single string buffer. Binary messages (`ArrayBuffer`) SHALL be collected as `Uint8Array` entries in a separate array.

On flush:
1. Write the accumulated text string (if non-empty) via `terminal.write(textBuffer)`
2. Write each binary chunk sequentially via `terminal.write(chunk)`
3. Clear both buffers

#### Scenario: Mixed text and binary messages
- **GIVEN** the WebSocket receives 3 string messages and 2 binary messages
- **WHEN** the rAF flush executes
- **THEN** one `terminal.write(combinedText)` call is made for all strings
- **AND** two `terminal.write(chunk)` calls are made for the binary data

### Requirement: Clean up rAF on disconnect

When the WebSocket closes or the effect cleans up, any pending `requestAnimationFrame` callback SHALL be cancelled via `cancelAnimationFrame()`, and any buffered data SHALL be flushed immediately (to avoid losing the last partial frame of output).

#### Scenario: WebSocket closes with buffered data
- **GIVEN** the text buffer contains unflushed data
- **WHEN** the WebSocket `onclose` fires
- **THEN** buffered data is flushed to the terminal before cleanup completes

#### Scenario: Component unmount with pending rAF
- **GIVEN** a rAF flush is scheduled
- **WHEN** the effect cleanup runs (component unmounts or session changes)
- **THEN** the rAF is cancelled via `cancelAnimationFrame()`

### Requirement: Preserve terminal reset behavior

The existing `needsReset` flag behavior SHALL be preserved. When `needsReset` is true, `terminal.reset()` SHALL be called before any buffered write, and the flag set to false. The reset check happens in the `onmessage` handler (before buffering), not in the flush callback.

#### Scenario: First message after connect triggers reset
- **GIVEN** a new WebSocket connection has opened (`needsReset = true`)
- **WHEN** the first message arrives
- **THEN** `terminal.reset()` is called immediately
- **AND** the message data is buffered normally for rAF flush

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | String equality for SSE diff (`e.data === prevRef.current`) | Confirmed from intake #1. Backend produces deterministic JSON serialization; string comparison is O(n) but avoids parse+deep-compare overhead. Easily reversed if structural diff needed later | S:90 R:95 A:90 D:95 |
| 2 | Certain | `startTransition` for `setSessions()`, `markConnected()` outside transition | Confirmed from intake #2. Connection liveness is urgent (affects UI indicators); session data is non-urgent. React 19 built-in | S:90 R:95 A:95 D:95 |
| 3 | Certain | Add `useChromeState()`, keep `useChrome()` as convenience alias | Confirmed from intake #3. Context split already done; hook is a 4-line addition. No breaking changes | S:95 R:95 A:95 D:95 |
| 4 | Certain | Two consumers migrate: `app.tsx:91` and `top-bar.tsx:410` | Confirmed from intake #4 via grep — these are the only `useChrome()` call sites that destructure only state | S:95 R:95 A:95 D:95 |
| 5 | Confident | 7 palette action groups with specified dependency sets | Upgraded from intake #5. Group boundaries follow action ID prefixes and logical domains. The `configActions` group has empty deps (all callbacks are stable or module-level). Exact group membership is a judgment call but preserves existing action order | S:85 R:90 A:80 D:75 |
| 6 | Certain | `requestAnimationFrame` for xterm write batching | Upgraded from intake #6. rAF aligns with xterm.js's internal rendering cycle (canvas/WebGL paints happen on rAF). Alternative approaches (microtask, setTimeout) would not align with the rendering pipeline | S:90 R:90 A:90 D:90 |
| 7 | Confident | Separate text/binary buffers, text concatenated, binary kept as chunks | Confirmed from intake #7. xterm.js `write()` accepts `string | Uint8Array`. String concatenation is cheap; merging Uint8Arrays requires allocation. Separate paths avoid unnecessary copying | S:80 R:90 A:85 D:80 |
| 8 | Certain | No new dependencies | Confirmed from intake #8. All APIs are React built-ins or browser built-ins | S:95 R:95 A:95 D:95 |
| 9 | Confident | Flush buffered data on WebSocket close before cleanup | New. Prevents losing the last partial frame of terminal output. Small risk: flush during teardown could throw if terminal is already disposed — guard with try/catch | S:75 R:85 A:80 D:75 |
| 10 | Certain | `needsReset` check happens in onmessage, not in flush | New. Reset must happen before any data is written; deferring it to rAF could show stale terminal content for one frame. Keeping it in onmessage preserves current behavior exactly | S:90 R:90 A:90 D:95 |

10 assumptions (6 certain, 4 confident, 0 tentative, 0 unresolved).
