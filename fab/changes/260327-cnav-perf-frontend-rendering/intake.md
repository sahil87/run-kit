# Intake: Performance Phase 3 — Frontend Rendering

**Change**: 260327-cnav-perf-frontend-rendering
**Created**: 2026-03-27
**Status**: Draft

## Origin

> Performance Phase 3 — Frontend Rendering: (1) Diff SSE state before setSessions() + startTransition() in contexts/session-context.tsx, (2) Split useChrome() into state/dispatch hooks in contexts/chrome-context.tsx, (3) Memoize palette actions by splitting into stable groups in app.tsx, (4) Batch xterm.js writes with requestAnimationFrame in components/terminal-client.tsx. See fab/plans/performance-improvements.md Phase 3 for full details.

One-shot invocation following the performance improvement plan triaged on 2026-03-27. Phase 1 (backend hot paths) and Phase 2 (SSE infrastructure) are separate changes. This change covers the four frontend rendering optimizations identified as Phase 3.

## Why

The frontend re-renders excessively under normal operation. Every SSE tick (every 2.5s) replaces the entire sessions array even when data is unchanged, triggering a full component tree re-render (Sidebar, Dashboard, TopBar, AppShell). The `paletteActions` useMemo in AppShell has 11+ dependencies and rebuilds ~140 lines of action objects on every SSE event. Components using `useChrome()` for state-only reads also subscribe to dispatch changes unnecessarily. Terminal output under high throughput triggers individual `terminal.write()` calls per WebSocket message, causing excessive xterm.js renders.

Without these fixes, the UI remains sluggish during routine polling and high-throughput terminal output — noticeable as jank during typing, command palette interactions, and fast scrolling builds/logs.

## What Changes

### 3.1 Diff SSE state before `setSessions()` + `startTransition()`

**File**: `app/frontend/src/contexts/session-context.tsx` (lines 82-89)

Currently, the SSE `sessions` event handler at line 82 parses the JSON and calls `setSessions(data)` unconditionally. Every 2.5s tick triggers a full state replacement and React re-render of the entire tree below `SessionProvider`, even when session data hasn't changed.

**Fix**:
1. Store the previous SSE JSON string in a `useRef<string>`. Before parsing, compare `e.data` against the stored string. If identical, skip `setSessions()` entirely.
2. When data has changed, wrap `setSessions()` in `React.startTransition()` so the state update is non-urgent and won't block user input (typing, command palette).

```tsx
const prevDataRef = useRef<string>("");

es.addEventListener("sessions", (e) => {
  try {
    if (e.data === prevDataRef.current) {
      markConnected();
      return;
    }
    prevDataRef.current = e.data;
    const data = JSON.parse(e.data) as ProjectSession[];
    startTransition(() => {
      setSessions(data);
    });
    markConnected();
  } catch {
    // Malformed event — skip
  }
});
```

This eliminates redundant re-renders on ~90%+ of SSE ticks (most polls return unchanged data).

### 3.2 Export `useChromeState()` hook

**File**: `app/frontend/src/contexts/chrome-context.tsx`

**Important discovery**: The underlying context split is already implemented — `ChromeStateContext` and `ChromeDispatchContext` are separate contexts (lines 47-48), and `useChromeDispatch()` is already exported (lines 104-108). What's missing is a `useChromeState()` hook for consumers that only need state.

Currently, `useChrome()` (line 97) merges state + dispatch via `useMemo(() => ({ ...state, ...dispatch }), [state, dispatch])`. Consumers using `useChrome()` for state-only destructuring (e.g., `const { sidebarOpen, drawerOpen, fixedWidth } = useChrome()` in `app.tsx:91`) still create a merged object on every state change.

**Fix**:
1. Add `useChromeState()` that returns `ChromeState` directly from `ChromeStateContext`.
2. Update consumers that only destructure state properties to use `useChromeState()`:
   - `app.tsx:91` — `const { sidebarOpen, drawerOpen, fixedWidth } = useChromeState()`
   - `top-bar.tsx:410` — `const { fixedWidth } = useChromeState()`
3. Keep `useChrome()` as a convenience alias for consumers needing both.

### 3.3 Split `paletteActions` into stable groups

**File**: `app/frontend/src/app.tsx` (lines 341-477)

The single `paletteActions` useMemo has 11 dependencies: `sessionName`, `currentWindow`, `flatWindows`, `navigateToWindow`, `handleCreateWindow`, `dialogs`, `fixedWidth`, `toggleFixedWidth`, `themeActions`, `servers`, `server`, `handleSwitchServer`. Any dependency change rebuilds all ~140 lines of action objects.

**Fix**: Split into independent action groups, each memoized with only its relevant dependencies:

1. **`sessionActions`** — depends on `sessionName`, `dialogs` (create/rename/kill session)
2. **`windowActions`** — depends on `sessionName`, `currentWindow`, `dialogs` (create/rename/kill/split window, close pane, copy tmux attach)
3. **`viewActions`** — depends on `sessionName`, `fixedWidth`, `toggleFixedWidth` (text input, fixed width toggle)
4. **`configActions`** — stable (reload tmux config, reset, keyboard shortcuts) — empty deps
5. **`serverActions`** — depends on `servers`, `server`, `handleSwitchServer` (create/kill/switch server)
6. **`terminalActions`** — depends on `flatWindows`, `navigateToWindow` (terminal navigation)
7. **`themeActions`** — already separate (lines 285-303)

Final `paletteActions` useMemo composes only the group refs:

```tsx
const paletteActions = useMemo(
  () => [...sessionActions, ...windowActions, ...viewActions, ...themeActions, ...configActions, ...serverActions, ...terminalActions],
  [sessionActions, windowActions, viewActions, themeActions, configActions, serverActions, terminalActions],
);
```

When SSE fires, only `terminalActions` (from `flatWindows`) and potentially `sessionActions`/`windowActions` rebuild. Config, view, theme, and server groups remain stable.

### 3.4 Batch xterm.js writes with `requestAnimationFrame`

**File**: `app/frontend/src/components/terminal-client.tsx` (lines 365-372)

Currently, the WebSocket `onmessage` handler calls `terminal.write()` on every message individually:

```tsx
ws.onmessage = (event) => {
  if (typeof event.data === "string") terminal.write(event.data);
  else terminal.write(new Uint8Array(event.data));
};
```

Under fast output (builds, log tailing), this triggers many separate xterm.js render passes.

**Fix**: Accumulate incoming data in a buffer and flush once per animation frame:

1. Maintain a `string` buffer and an optional `Uint8Array[]` array for binary data.
2. On each `onmessage`, append to the buffer(s) and schedule a `requestAnimationFrame` flush if one isn't already pending.
3. On flush, write the accumulated string (and any binary chunks) to the terminal in a single call, then clear the buffers.

```tsx
let textBuffer = "";
let binaryBuffers: Uint8Array[] = [];
let flushScheduled = false;

function flushToTerminal() {
  flushScheduled = false;
  if (textBuffer) {
    terminal.write(textBuffer);
    textBuffer = "";
  }
  for (const buf of binaryBuffers) {
    terminal.write(buf);
  }
  binaryBuffers = [];
}

ws.onmessage = (event) => {
  if (cancelled) return;
  if (needsReset) {
    needsReset = false;
    terminal.reset();
  }
  if (typeof event.data === "string") {
    textBuffer += event.data;
  } else {
    binaryBuffers.push(new Uint8Array(event.data));
  }
  if (!flushScheduled) {
    flushScheduled = true;
    requestAnimationFrame(flushToTerminal);
  }
};
```

This coalesces multiple WebSocket messages into a single xterm.js render pass per frame, smoothing terminal rendering under high throughput.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update context hook usage patterns to reflect `useChromeState()` export

## Impact

- **`app/frontend/src/contexts/session-context.tsx`** — SSE handler change (diff + startTransition)
- **`app/frontend/src/contexts/chrome-context.tsx`** — New `useChromeState()` export
- **`app/frontend/src/app.tsx`** — Palette actions split into groups, `useChrome()` → `useChromeState()`, `startTransition` import
- **`app/frontend/src/components/top-bar.tsx`** — `useChrome()` → `useChromeState()` import
- **`app/frontend/src/components/terminal-client.tsx`** — WebSocket write buffering

All changes are frontend-only. No API changes. No new dependencies. Existing tests should continue passing — behavior is identical, only rendering frequency changes.

## Open Questions

(none — the performance plan specifies all four changes with concrete implementation details)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use string comparison for SSE diff (compare `e.data` JSON strings) | Plan specifies this approach; simpler and cheaper than deep object comparison. JSON strings from the same backend are deterministic | S:90 R:95 A:90 D:95 |
| 2 | Certain | Wrap `setSessions()` in `startTransition()` | Plan specifies; React 19 standard API for non-urgent state updates | S:90 R:95 A:95 D:95 |
| 3 | Certain | Add `useChromeState()` hook, keep `useChrome()` as convenience alias | Code inspection confirms contexts already split; plan says to keep `useChrome()` | S:95 R:95 A:95 D:95 |
| 4 | Certain | Only two consumers need `useChrome()` → `useChromeState()` update | Grep confirms: `app.tsx:91` and `top-bar.tsx:410` are the only `useChrome()` call sites beyond the definition | S:95 R:95 A:95 D:95 |
| 5 | Confident | Split palette actions into 7 groups (session, window, view, theme, config, server, terminal) | Grouping derived from logical categories in the existing monolithic useMemo; exact group boundaries are a judgment call but follow the action ID prefixes | S:80 R:90 A:75 D:70 |
| 6 | Confident | Use `requestAnimationFrame` for xterm.js write batching | Plan specifies rAF; standard approach for coalescing DOM-adjacent writes. Alternative (microtask/setTimeout) would work but rAF aligns with rendering | S:85 R:90 A:85 D:80 |
| 7 | Confident | Separate text and binary buffer paths for xterm.js batching | xterm.js `write()` accepts both `string` and `Uint8Array` — mixing them in a single buffer would require encoding overhead. Separate paths avoid unnecessary conversion | S:70 R:90 A:80 D:75 |
| 8 | Certain | No new dependencies required | All techniques use React built-ins (startTransition, useMemo, useRef) and browser APIs (requestAnimationFrame) | S:95 R:95 A:95 D:95 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
