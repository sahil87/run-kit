# Intake: Sidebar Window State Zustand

**Change**: 260405-x3yt-sidebar-window-state-zustand
**Created**: 2026-04-05
**Status**: Draft

## Origin

Conversational. User identified index-based window tracking as the root cause of deletion/rename
bugs in the sidebar. A focused discussion concluded on approach before change creation.

> Clean up the way the right panel state is maintained. Rewrite it from scratch — keep the
> actions (changes you can make to the store) surface area as small as possible. Right now
> there are a lot of errors that occur when deleting a window for example. This happens
> because we are modifying the store via indexes. If possible we should stop using indexes
> to refer to individual windows. Indices mutate on index removal or addition. We need to
> use an identifier that's immutable. (Tmux window no that starts with % maybe?)
>
> Decisions from follow-up discussion:
> - State management library: **Zustand**
> - Identifier: **tmux window_id (`@N`)** — the `@` prefix form, not `%` (which is pane ID)
> - Scope: **left sidebar window list** and its optimistic state layer
> - Backend must expose `window_id` in the API response
> - Tests must be updated/added

## Why

Windows in tmux are ordered by a mutable integer index. When any window is deleted, tmux
renumbers all higher-indexed windows. The frontend currently tracks all window operations
(`kill`, `rename`, `ghost`) using `"${session}:${index}"` string keys. This means:

- Killing window at index 1 stores key `"mysession:1"`. After deletion tmux renumbers window 2
  → index 1. The stale kill-marker now incorrectly suppresses the *new* window 1.
- Rename markers have the same race: a rename recorded as `"mysession:2:newname"` breaks as
  soon as a lower-indexed window is removed.
- Ghost window reconciliation uses `previousWindowCount` as a workaround, but this is
  fragile and hard to reason about.

The consequence is incorrect sidebar rendering — windows appearing killed, renamed, or
phantom-present — until the next clean SSE update arrives.

The fix is structural: use `window_id` (`@N`) as the primary key everywhere. `@N` values are
assigned by tmux at window creation and never change — they survive reordering, deletion of
other windows, and session renames. No custom ID generation is needed; tmux already provides
this for free.

Zustand is chosen as the replacement for `OptimisticContext` because:
- Plain React Context forces re-renders on every state update to all consumers
- Zustand provides selector-based subscriptions (components re-render only on relevant slices)
- The action surface is explicit and minimal — no reducer boilerplate
- It is the standard choice for client-side state in React 19+ projects of this scale

## What Changes

### Backend — `app/backend/internal/tmux/tmux.go`

Add `window_id` (`@N`, e.g., `"@3"`) to `WindowInfo`:

```go
type WindowInfo struct {
    WindowID          string `json:"windowId"`      // NEW — immutable tmux @N identifier
    Index             int    `json:"index"`          // kept — tmux ordering only
    Name              string `json:"name"`
    WorktreePath      string `json:"worktreePath"`
    Activity          string `json:"activity"`
    IsActiveWindow    bool   `json:"isActiveWindow"`
    PaneCommand       string `json:"paneCommand,omitempty"`
    ActivityTimestamp int64  `json:"activityTimestamp"`
    AgentState        string `json:"agentState,omitempty"`
    AgentIdleDuration string `json:"agentIdleDuration,omitempty"`
    FabChange         string `json:"fabChange,omitempty"`
    FabStage          string `json:"fabStage,omitempty"`
}
```

Add `"#{window_id}"` to the tmux format string in `ListWindows()` and parse it in
`parseWindows()`.

### Frontend — New Zustand store

New file: `app/frontend/src/store/window-store.ts`

```ts
// Minimal action surface
type WindowStore = {
  // State
  windows: Record<string, WindowEntry>;   // keyed by windowId (@N)
  ghosts: GhostWindow[];                  // optimistic creates (no windowId yet)

  // Actions — the ONLY ways to mutate window state
  setWindowsForSession(session: string, incoming: WindowInfo[]): void;
  addGhostWindow(session: string, name: string): void;
  killWindow(session: string, windowId: string): void;
  renameWindow(session: string, windowId: string, newName: string): void;
  clearSession(session: string): void;
};

type WindowEntry = WindowInfo & {
  session: string;
  killed: boolean;
  pendingName: string | null;
};

type GhostWindow = {
  ghostId: string;       // client-generated, for React key only
  session: string;
  name: string;
  createdAt: number;
};
```

`setWindowsForSession` is the SSE reconciliation action. It:
1. Merges incoming windows (by `windowId`) into the store, preserving `killed` and
   `pendingName` overrides
2. Drops `killed: true` entries only after their `windowId` is absent from the server
   response (i.e., tmux confirmed deletion) — no index-based heuristics
3. Reconciles ghosts: removes a ghost when a new `windowId` entry appears in the session
   that wasn't there before (matching on `previousWindowCount` is dropped entirely)

### Frontend — Remove `OptimisticContext`

`app/frontend/src/contexts/optimistic-context.tsx` and its type definitions are deleted.
All consumers (`sidebar.tsx`, `app.tsx`, `use-dialog-state.ts`) replace `useOptimistic*()`
hooks with selectors from the Zustand store.

### Frontend — Update `WindowInfo` type

`app/frontend/src/types.ts`: add `windowId: string` to `WindowInfo`. The `index` field
remains as a display-only ordering property.

### Frontend — Update sidebar

`sidebar.tsx` replaces all `useOptimistic*()` calls with Zustand selectors. Window
operations (`kill`, `rename`, `create`) dispatch store actions. Drag-and-drop reorder
calls the API then relies on the next SSE update (no store mutation needed for ordering).

### Frontend — Update routing / navigation

URL routing continues to use `index` (e.g., `/$server/$session/2`) — this is unchanged.
When navigating "next/prev window" in `app.tsx`, the current window is looked up by
`windowId` in the store, its index is read, and navigation uses `index ± 1`.

### Tests

- **Backend**: Add test in `tmux_test.go` that `parseWindows` correctly extracts `WindowID`
  from the `#{window_id}` format field, and that it survives round-trip through `ListWindows`.
- **Frontend unit**: Replace `optimistic-context.test.tsx` with `window-store.test.ts`
  covering: SSE reconciliation with stable IDs, ghost creation/reconciliation, kill
  correctness after out-of-order index renumbering (the core regression scenario), rename
  persistence across reorder.
- **E2E**: Existing window kill/rename/create e2e tests should pass without modification
  (they test behavior, not internals).

## Affected Memory

- `run-kit/ui-patterns`: (modify) add Zustand store pattern, remove OptimisticContext section
- `run-kit/architecture`: (modify) update frontend state management section

## Impact

- `app/backend/internal/tmux/tmux.go` — format string + struct + parser
- `app/backend/internal/tmux/tmux_test.go` — new test cases
- `app/frontend/src/types.ts` — `WindowInfo` type update
- `app/frontend/src/contexts/optimistic-context.tsx` — deleted
- `app/frontend/src/contexts/optimistic-context.test.tsx` — deleted (replaced)
- `app/frontend/src/store/window-store.ts` — new file
- `app/frontend/src/store/window-store.test.ts` — new file
- `app/frontend/src/components/sidebar.tsx` — consumer update
- `app/frontend/src/app.tsx` — consumer update
- `app/frontend/src/hooks/use-dialog-state.ts` — consumer update

## Open Questions

- Are there any other consumers of `OptimisticContext` besides `sidebar.tsx`, `app.tsx`,
  and `use-dialog-state.ts`? (Likely no, but needs verification at spec time.)
- Should the `TerminalClient` or `TopBar` also read window state from the Zustand store,
  or do they continue to derive from the `SessionContext` + route params? (Likely keep
  as-is — scoping to sidebar for now.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use Zustand for window list state | Explicitly chosen by user in pre-change discussion | S:95 R:90 A:90 D:95 |
| 2 | Certain | Use `window_id` (@N) as immutable identifier, not pane ID (%) | Explicitly decided in discussion; @N is the correct tmux window identifier | S:95 R:90 A:90 D:95 |
| 3 | Certain | Backend must expose `window_id` in WindowInfo / API response | Confirmed by code exploration — field is absent from format string and struct | S:95 R:85 A:95 D:95 |
| 4 | Certain | `index` remains on WindowInfo as a display/ordering property | User explicitly stated: "index might be there additionally just to indicate tmux ordering" | S:95 R:90 A:90 D:95 |
| 5 | Certain | Update and add tests as part of this change | User explicitly requested test updates and additions | S:95 R:90 A:90 D:95 |
| 6 | Certain | Delete OptimisticContext entirely; Zustand store is its replacement | "Rewrite from scratch" — the optimistic context IS the thing being replaced | S:90 R:80 A:85 D:90 |
| 7 | Confident | URL routing continues to use `index` (no URL scheme change) | User scoped to "sidebar window list state"; URL is a routing concern, not a state concern. Changing URLs would break existing links. | S:75 R:70 A:80 A:80 |
| 8 | Confident | Minimal store actions: `setWindowsForSession`, `addGhostWindow`, `killWindow`, `renameWindow`, `clearSession` | Derived from current OptimisticContext surface plus "keep surface area as small as possible" directive | S:80 R:75 A:80 D:80 |
| 9 | Confident | `SessionContext` and `ChromeContext` remain as-is (React Context) | Only the window list / optimistic layer is in scope; other contexts are not index-based | S:75 R:75 A:80 D:80 |
| 10 | Tentative | Ghost reconciliation matches on session window-count delta (new window appeared = ghost resolved) | <!-- assumed: ghost reconciliation strategy — current approach uses previousWindowCount; cleaner approach ties to windowId appearing, but ghosts have no ID yet --> This is the trickiest part and may need clarification at spec time | S:50 R:55 A:60 D:45 |

10 assumptions (6 certain, 3 confident, 1 tentative, 0 unresolved). Run /fab-clarify to review.
