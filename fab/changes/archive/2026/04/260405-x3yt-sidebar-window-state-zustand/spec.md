# Spec: Sidebar Window State Zustand

**Change**: 260405-x3yt-sidebar-window-state-zustand
**Created**: 2026-04-05
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- Session and server optimistic state are not migrated — they use name-based keys (not mutable indices) and are not the source of bugs. `OptimisticContext` is slimmed, not deleted.
- URL routing scheme is unchanged — the `/$server/$session/$window` path continues using numeric index.
- `TerminalClient`, `TopBar`, and `ChromeContext` are unchanged — they derive window identity from route params and SSE data, not from the window store.
- Backend API endpoints are unchanged — they still accept `index` in the path (e.g., `DELETE /sessions/{session}/windows/{index}`).

## Backend: tmux Window ID

### Requirement: WindowInfo Must Include Immutable Window ID

`WindowInfo` in `app/backend/internal/tmux/tmux.go` SHALL include a `WindowID string` field
(JSON: `"windowId"`) containing the tmux `#{window_id}` value (e.g., `"@3"`). This value is
assigned by tmux at window creation and is never reused or renumbered.

#### Scenario: ListWindows Returns WindowID
- **GIVEN** a tmux session with two windows having IDs `@1` and `@2`
- **WHEN** `ListWindows()` is called
- **THEN** each returned `WindowInfo` has a non-empty `WindowID` matching the `@N` pattern
- **AND** `WindowID` values are distinct between windows

#### Scenario: WindowID Survives Reorder
- **GIVEN** windows `@1` (index 0) and `@2` (index 1)
- **WHEN** the windows are reordered so `@2` is now at index 0 and `@1` is at index 1
- **AND** `ListWindows()` is called again
- **THEN** the window that was `@2` still has `WindowID == "@2"` regardless of its new index

### Requirement: parseWindows Extracts WindowID From Format Position 0

`parseWindows()` SHALL extract `WindowID` from position 0 of the tab-delimited format output.
The tmux format string in `ListWindows()` SHALL prepend `#{window_id}` as the first field,
shifting all existing fields up by one position.

New field order:
1. `#{window_id}` → `WindowID`
2. `#{window_index}` → `Index`
3. `#{window_name}` → `Name`
4. `#{pane_current_path}` → `WorktreePath`
5. `#{window_activity}` → `ActivityTimestamp`
6. `#{window_active}` → `IsActiveWindow`
7. `#{pane_current_command}` → `PaneCommand`

`parseWindows()` MUST require at least 7 fields (was 6) and fail silently on lines with fewer.

#### Scenario: parseWindows Parses WindowID
- **GIVEN** a tab-delimited line with 7 fields where field 0 is `"@5"`
- **WHEN** `parseWindows` processes the line
- **THEN** the resulting `WindowInfo.WindowID` equals `"@5"`
- **AND** `WindowInfo.Index` equals the integer value from field 1

## Frontend: Window Store (Zustand)

### Requirement: Window State Managed by a Zustand Store

A new Zustand store at `app/frontend/src/store/window-store.ts` SHALL manage all optimistic
window state. This store is the single source of truth for what windows are visible and what
their display names are during the period between a user action and its SSE confirmation.

**Store shape:**

```ts
type WindowEntry = WindowInfo & {
  session: string;
  killed: boolean;        // true = optimistically hidden, pending SSE confirmation
  pendingName: string | null; // non-null = optimistic rename, pending SSE confirmation
};

type GhostWindow = {
  ghostId: string;               // client-generated unique key for React rendering
  session: string;
  name: string;
  createdAt: number;             // Date.now() at creation
  snapshotWindowIds: ReadonlySet<string>; // windowIds present in this session at creation time
};

type WindowStore = {
  windows: Record<string, WindowEntry>;  // keyed by windowId (@N)
  ghosts: GhostWindow[];

  setWindowsForSession(session: string, incoming: WindowInfo[]): void;
  addGhostWindow(session: string, name: string, currentWindowIds: ReadonlySet<string>): string;
  killWindow(session: string, windowId: string): void;
  restoreWindow(session: string, windowId: string): void;
  renameWindow(session: string, windowId: string, newName: string): void;
  clearRename(session: string, windowId: string): void;
  clearSession(session: string): void;
};
```

`addGhostWindow` returns the `ghostId` (for rollback via `removeGhost` equivalent).
A `removeGhost(ghostId)` action SHALL also be provided for API-failure rollback.

#### Scenario: Store Initialises Empty
- **GIVEN** the application loads
- **WHEN** the window store is accessed for the first time
- **THEN** `windows` is an empty object and `ghosts` is an empty array

### Requirement: setWindowsForSession Reconciles by windowId

`setWindowsForSession(session, incoming)` SHALL merge the incoming SSE window list into the
store using `windowId` as the stable key. It MUST NOT use `index` as a merge key at any point.

**Merge behaviour:**
1. For each incoming `WindowInfo`: upsert into `windows[windowId]` with `session` attached.
   If an entry already exists for this `windowId`, preserve `killed` and `pendingName` from
   the existing entry (SSE does not override optimistic state — the optimistic action owns
   the override until it is explicitly cleared).
2. Remove entries from `windows` whose `windowId` is absent from `incoming` AND whose
   `session` matches. This is the authoritative deletion signal — the window is gone from tmux.
   Kill-marked entries that disappear from SSE are removed without requiring an explicit clear.
3. Reconcile ghost windows: compute `newIds = incomingIds − priorKnownIds` for this session.
   For each ghost (oldest first by `createdAt`) whose `snapshotWindowIds` does not contain any
   element of `newIds`: remove the ghost (the new window corresponds to it). Process at most
   `newIds.size` ghost removals per call.
4. `priorKnownIds` is the set of `windowId` values already in `windows` for this `session`
   before the merge begins (snapshot taken at start of the function).

#### Scenario: SSE Update Preserves Kill Marker
- **GIVEN** window `@3` is in the store with `killed: true` (user clicked kill, API in-flight)
- **WHEN** `setWindowsForSession` is called with an SSE update that still includes `@3`
- **THEN** `windows["@3"].killed` remains `true`
- **AND** the window remains hidden from the sidebar

#### Scenario: Window Removal Cleans Store
- **GIVEN** window `@3` exists in the store
- **WHEN** `setWindowsForSession` is called with an SSE update that does NOT include `@3`
- **THEN** `windows["@3"]` is removed from the store

#### Scenario: Kill Marker Does Not Linger After Deletion
- **GIVEN** window `@3` is in the store with `killed: true`
- **WHEN** `setWindowsForSession` is called with an SSE update that does NOT include `@3`
- **THEN** `windows["@3"]` is removed entirely (no dangling kill entry)

#### Scenario: SSE Preserves Pending Rename
- **GIVEN** window `@3` has `pendingName: "editor"` (user renamed, API in-flight)
- **WHEN** `setWindowsForSession` is called with SSE data where `@3` still has its old name
- **THEN** `windows["@3"].pendingName` remains `"editor"`

### Requirement: Kill and Restore Actions for Optimistic Hide

`killWindow(session, windowId)` SHALL set `windows[windowId].killed = true`. If the entry
does not exist (window not yet in store), the action is a no-op.

`restoreWindow(session, windowId)` SHALL set `windows[windowId].killed = false`. Used by
API error rollback and `onAlwaysSettled`. If the entry does not exist, no-op.

#### Scenario: Kill Hides Window
- **GIVEN** window `@3` exists in the store with `killed: false`
- **WHEN** `killWindow("dev", "@3")` is called
- **THEN** `windows["@3"].killed` is `true`

#### Scenario: Restore Shows Window
- **GIVEN** window `@3` has `killed: true`
- **WHEN** `restoreWindow("dev", "@3")` is called
- **THEN** `windows["@3"].killed` is `false`

#### Scenario: Kill-Then-SSEConfirm Removes Entry
- **GIVEN** window `@3` has `killed: true`
- **WHEN** `setWindowsForSession` receives an SSE update without `@3`
- **THEN** `windows["@3"]` is removed from the store
- **AND** `restoreWindow` on the (now absent) windowId is a no-op

### Requirement: Rename and ClearRename for Optimistic Display Name

`renameWindow(session, windowId, newName)` SHALL set `windows[windowId].pendingName = newName`.
`clearRename(session, windowId)` SHALL set `windows[windowId].pendingName = null`. Used on
`onRollback` or `onSettled` after a rename API call.

After a successful rename, SSE will deliver the new name in the `Name` field; at that point
`clearRename` is called and the SSE name is authoritative. Components SHALL display
`pendingName ?? name` for window titles.

#### Scenario: Rename Shows Pending Name
- **GIVEN** window `@3` has `name: "build"` and `pendingName: null`
- **WHEN** `renameWindow("dev", "@3", "backend")` is called
- **THEN** the display name for `@3` is `"backend"`

#### Scenario: ClearRename Reverts To SSE Name
- **GIVEN** window `@3` has `pendingName: "backend"`
- **WHEN** `clearRename("dev", "@3")` is called
- **AND** the SSE `name` for `@3` is `"build"` (API failed) or `"backend"` (API succeeded)
- **THEN** the display name for `@3` is the SSE `name` value

### Requirement: Ghost Windows Reconcile by windowId Set Difference

`addGhostWindow(session, name, currentWindowIds)` SHALL create a `GhostWindow` entry in
`ghosts` with `snapshotWindowIds = currentWindowIds` and return a `ghostId`.

The caller MUST pass `currentWindowIds` as the set of `windowId` values currently known for
the session at the moment the create action fires. `app.tsx` derives this from the window
store before dispatching.

Ghost reconciliation in `setWindowsForSession` (Requirement above) removes the ghost when
a new `windowId` appears that was not in the ghost's `snapshotWindowIds`. This is more
reliable than count-based reconciliation: it does not produce false positives if a window is
deleted immediately after creation (the count would be the same, but the ID set differs).

`removeGhost(ghostId)` SHALL remove the ghost entry by `ghostId`. Used on API failure rollback.

#### Scenario: Ghost Appears Immediately
- **GIVEN** a ghost window is added for session `"dev"` with name `"zsh"`
- **WHEN** `ghosts` is read
- **THEN** one entry exists with `session: "dev"`, `name: "zsh"`
- **AND** it has `killed: false` (ghost windows are never killed-marked)

#### Scenario: Ghost Clears On New windowId
- **GIVEN** a ghost for `"dev"` with `snapshotWindowIds = {"@1", "@2"}`
- **WHEN** `setWindowsForSession("dev", [..., {windowId: "@3", ...}])` is called
- **THEN** the ghost is removed from `ghosts`

#### Scenario: Ghost Not Cleared By Existing windowId
- **GIVEN** a ghost for `"dev"` with `snapshotWindowIds = {"@1", "@2"}`
- **WHEN** `setWindowsForSession("dev", [{windowId: "@1"}, {windowId: "@2"}])` is called (no new IDs)
- **THEN** the ghost remains in `ghosts`

#### Scenario: API Failure Removes Ghost
- **GIVEN** a ghost for `"dev"` with `ghostId: "ghost-1"`
- **WHEN** the create window API call fails and `removeGhost("ghost-1")` is called
- **THEN** the ghost is removed from `ghosts`

### Requirement: clearSession Removes All State for a Session

`clearSession(session)` SHALL remove all `windows` entries and `ghosts` entries for the
given session. Called when a session is destroyed or the user navigates away from a server.

#### Scenario: clearSession Removes All Session Data
- **GIVEN** windows `@1` and `@2` exist for session `"dev"`, and one ghost for `"dev"`
- **WHEN** `clearSession("dev")` is called
- **THEN** no entries remain in `windows` or `ghosts` for `"dev"`
- **AND** entries for other sessions are unaffected

## Frontend: Window Store Sync with SSE

### Requirement: AppShell Drives setWindowsForSession on Every SSE Update

`app.tsx` (inside `AppShell`) SHALL call `windowStore.setWindowsForSession(session.name, session.windows)`
for each session in `rawSessions` whenever `rawSessions` changes. This ensures the Zustand
store stays in sync with the SSE ground truth.

This sync happens via a `useEffect` that depends on `rawSessions`:

```ts
const { setWindowsForSession } = useWindowStore();
useEffect(() => {
  for (const s of rawSessions) {
    setWindowsForSession(s.name, s.windows);
  }
}, [rawSessions, setWindowsForSession]);
```

#### Scenario: Store Updates on SSE Arrival
- **GIVEN** a new SSE message delivers updated window data for session `"dev"`
- **WHEN** `rawSessions` changes and the effect fires
- **THEN** `windowStore.windows` reflects the updated data for `"dev"`

## Frontend: useMergedSessions Uses Window Store

### Requirement: useMergedSessions Derives Windows From Zustand Store

`useMergedSessions` in `app/frontend/src/contexts/optimistic-context.tsx` SHALL be updated
to obtain window data for each session from the Zustand window store rather than from
`session.windows` directly.

For each real session, the merged window list SHALL be:
1. All windows from `windowStore.windows` where `entry.session === session.name` and `entry.killed === false`
2. Display name: `entry.pendingName ?? entry.name`
3. Windows sorted by `index` ascending (to maintain sidebar order)
4. Ghost windows for this session appended at the end (as before)

`MergedWindow` type SHALL include `windowId: string` (required, non-optional).

The `isGhostWindow` type guard remains unchanged.

#### Scenario: Killed Window Hidden In Merged Output
- **GIVEN** window `@3` in session `"dev"` has `killed: true` in the store
- **WHEN** `useMergedSessions` derives the window list for `"dev"`
- **THEN** `@3` is absent from the returned window list

#### Scenario: Pending Rename Applied In Merged Output
- **GIVEN** window `@3` has `name: "build"` and `pendingName: "backend"` in the store
- **WHEN** `useMergedSessions` derives the window list for `"dev"`
- **THEN** the returned window for `@3` has `name: "backend"`

#### Scenario: Core Regression — No Index Collision After Window Deletion
- **GIVEN** session `"dev"` has windows `@1` (idx 0), `@2` (idx 1), `@3` (idx 2)
- **WHEN** window `@2` is killed (optimistically) and `setWindowsForSession` is called with
  tmux's renumbered output: `@1` (idx 0), `@3` (idx 1)
- **AND** `@2` is absent from the SSE data (tmux confirmed deletion)
- **THEN** `@3` is visible in the sidebar with name `"logs"` at index 1
- **AND** `@2` is absent from the sidebar (confirmed deleted)
- **AND** the old kill entry for `@2` no longer exists in the store (not shadowing `@3`)

## Frontend: OptimisticContext Slimmed to Session/Server Scope

### Requirement: Window Methods Removed From OptimisticContext

`OptimisticContext` SHALL have all window-specific actions and state removed. The following
SHALL be removed from the context interface:

- `addGhostWindow` (replaced by `windowStore.addGhostWindow`)
- `markKilled("window", ...)` calls for windows (replaced by `windowStore.killWindow`)
- `markRenamed("window", ...)` calls for windows (replaced by `windowStore.renameWindow`)
- `MergedWindow` type (moved to `window-store.ts` or a shared types location)

Session and server state in `OptimisticContext` SHALL remain unchanged:
- `addGhostSession`, `addGhostServer`, `removeGhost` (for sessions/servers only)
- `markKilled("session"/"server", ...)`, `unmarkKilled`
- `markRenamed("session", ...)`, `unmarkRenamed`
- `ghosts` (session and server ghosts only), `killed`, `renamed`

> Note: This is a spec-level override of intake assumption #6 ("Delete OptimisticContext
> entirely"). The deeper analysis shows that session/server state in `OptimisticContext`
> is not broken (uses name-based keys), and keeping it avoids unnecessary scope expansion.
> The window slice is fully replaced by Zustand — the stated goal of "rewrite from scratch"
> for window state is fully achieved.

#### Scenario: Session Ghost Unaffected By This Change
- **GIVEN** `addGhostSession("staging")` is called
- **WHEN** `useMergedSessions` runs
- **THEN** `"staging"` appears as an optimistic session in the merged output

## Frontend: Sidebar Uses windowId for All Window Actions

### Requirement: Sidebar Dispatches Kill/Rename Via windowId

`sidebar.tsx` SHALL use `windowId` as the identifier in all window kill and rename calls.
The local component state tracking killed/renamed windows is replaced by Zustand reads.

**Kill flow:**
```ts
// onOptimistic: (session, windowId) => windowStore.killWindow(session, windowId)
// onAlwaysRollback: () => windowStore.restoreWindow(session, windowId)
// onAlwaysSettled: () => windowStore.restoreWindow(session, windowId)
```

**Rename flow:**
```ts
// onOptimistic: (session, windowId, newName) => windowStore.renameWindow(session, windowId, newName)
// onRollback: () => windowStore.clearRename(session, windowId)
// onSettled: () => windowStore.clearRename(session, windowId)
```

The API calls remain index-based:
```ts
killWindowApi(session, win.index)       // unchanged — tmux API uses index
renameWindow(session, win.index, name)  // unchanged
```

Drag-and-drop reorder (`moveWindow`) continues to use index for the API call. No store
mutation is needed for reorder — the next SSE update will reflect the new order.

`editingWindow` local state in `sidebar.tsx` tracks `{ session: string; windowId: string }`
instead of `{ session: string; index: number }`.

#### Scenario: Kill Uses windowId Not Index
- **GIVEN** the user ctrl-clicks window `@3` (currently at index 1 in session `"dev"`)
- **WHEN** the kill action fires
- **THEN** `windowStore.killWindow("dev", "@3")` is called
- **AND** `killWindowApi("dev", 1)` is called with the index (for tmux)

#### Scenario: Kill Rollback On API Error
- **GIVEN** `killWindow("dev", "@3")` was called optimistically
- **WHEN** the kill API call returns an error
- **THEN** `windowStore.restoreWindow("dev", "@3")` is called
- **AND** `@3` becomes visible again in the sidebar

#### Scenario: Rename Uses windowId Not Index
- **GIVEN** window `@5` has name `"build"` and the user renames it to `"backend"`
- **WHEN** the rename commits
- **THEN** `windowStore.renameWindow("dev", "@5", "backend")` is called
- **AND** `renameWindow("dev", win.index, "backend")` is called for the API
- **AND** the sidebar immediately shows `"backend"` as the window name

## Frontend: useDialogState Uses windowId

### Requirement: useDialogState Dispatches Kill/Rename Via windowId

`use-dialog-state.ts` SHALL accept `windowId: string | undefined` instead of
`windowIndex: number | undefined` in `UseDialogStateOptions`. All window kill and rename
flows SHALL dispatch via the Zustand window store following the same pattern as `sidebar.tsx`.

The API calls within `useOptimisticAction` actions still use `windowIndex` (passed through
alongside `windowId` for the API call only).

#### Scenario: Dialog Kill Uses windowId
- **GIVEN** the kill window dialog confirms for window `@3` (index 1)
- **WHEN** `handleKillWindow` is called
- **THEN** `windowStore.killWindow(session, "@3")` fires optimistically
- **AND** `killWindowApi(session, 1)` fires for the backend

## Frontend: app.tsx Uses windowStore for Ghost Windows

### Requirement: app.tsx Uses windowStore for Create Window Ghost

In `app.tsx`, the `executeCreateWindow` optimistic action SHALL use the window store for
ghost management instead of `OptimisticContext.addGhostWindow`:

```ts
const { addGhostWindow, removeGhost, setWindowsForSession } = useWindowStore();

const handleCreateWindow = (session: string) => {
  const currentIds = getCurrentWindowIds(session); // from windowStore
  const ghostId = addGhostWindow(session, "zsh", currentIds);
  // ... on rollback: removeGhost(ghostId)
};
```

`addGhostServer` and server kill/restore remain in `OptimisticContext` (unchanged scope).

#### Scenario: Create Window Ghost Appears Then Clears
- **GIVEN** session `"dev"` has windows `@1` and `@2`
- **WHEN** `executeCreateWindow("dev")` fires optimistically
- **THEN** a ghost appears in the sidebar for `"dev"`
- **WHEN** SSE delivers the new session data including `@3` (new windowId)
- **THEN** the ghost is removed and `@3` appears as a real window

## Frontend: types.ts WindowInfo Includes windowId

### Requirement: WindowInfo Has Non-Optional windowId Field

`app/frontend/src/types.ts` SHALL add `windowId: string` to `WindowInfo`. The field is
non-optional — the backend always returns it after this change.

```ts
export type WindowInfo = {
  windowId: string;     // NEW — immutable tmux @N identifier, e.g. "@3"
  index: number;        // tmux ordering only — DO NOT use as a store key
  name: string;
  // ... rest unchanged
};
```

#### Scenario: WindowInfo Type Includes windowId
- **GIVEN** the TypeScript compiler processes the types
- **WHEN** `WindowInfo` is used
- **THEN** accessing `.windowId` compiles without error
- **AND** accessing a `WindowInfo` without `windowId` set causes a compile error

## Tests

### Requirement: Backend parseWindows Test Coverage

`app/backend/internal/tmux/tmux_test.go` SHALL include test cases for `parseWindows` that:
1. Verify `WindowID` is extracted from field 0 of the 7-field format
2. Verify the `@N` value is preserved exactly (e.g., `"@5"`)
3. Verify existing fields (`Index`, `Name`, etc.) parse correctly from their shifted positions
4. Verify lines with fewer than 7 fields are skipped

The `windowLine` test helper SHALL be updated to include `windowId` as the first field.

#### Scenario: parseWindows Extracts windowId
- **GIVEN** a format line `"@5\t1\tmywin\t/tmp\t1234\t1\tzsh"`
- **WHEN** `parseWindows([]string{line}, now)` is called
- **THEN** the result has `WindowID: "@5"`, `Index: 1`, `Name: "mywin"`

### Requirement: Frontend Window Store Test Coverage

`app/frontend/src/store/window-store.test.ts` SHALL cover all store actions with unit tests:

1. **Initial state** — store starts empty
2. **setWindowsForSession** — basic upsert; kill preservation; rename preservation; deletion when absent from SSE
3. **Kill/restore round-trip** — kill hides; restore shows; kill + SSE confirm = entry removed
4. **Rename/clearRename round-trip** — rename sets pending name; clearRename nulls it; SSE updates base name while pendingName is active (pendingName preserved)
5. **Ghost create/reconcile** — ghost appears; new windowId in SSE clears ghost; no new windowId leaves ghost; API failure + removeGhost removes ghost
6. **Core regression** — window deletion index renumbering: kill `@2`, SSE delivers `@1`+`@3` (renumbered), verify `@3` visible and `@2` absent (no false suppression)
7. **clearSession** — removes all data for that session

`app/frontend/src/contexts/optimistic-context.test.tsx` SHALL be updated to:
- Remove all window-specific test cases (kill window, rename window, ghost window reconciliation)
- Retain session and server test cases
- Update `baseSessions` test data to include `windowId` in `WindowInfo`

#### Scenario: Core Regression Test Passes
- **GIVEN** store has `@1` (idx 0, "zsh") and `@2` (idx 1, "build") and `@3` (idx 2, "logs") for session `"dev"`
- **WHEN** `killWindow("dev", "@2")` is called then `setWindowsForSession("dev", [{windowId:"@1",...}, {windowId:"@3", index:1,...}])` is called
- **THEN** `getWindowsForDisplay("dev")` returns `@1` and `@3` only
- **AND** `@2` has been removed from the store
- **AND** `@3` is visible with its correct name `"logs"` (no false suppression from old index-1 kill marker)

## Design Decisions

1. **Partial OptimisticContext migration (not full deletion)**
   - *Why*: Sessions use name-based keys and are not broken. Deleting the entire context adds unnecessary scope, risk, and test churn to code that works correctly. The window slice is completely replaced by Zustand — the fix is fully delivered.
   - *Rejected*: Full Zustand migration of all optimistic state — would work, but expands blast radius with no additional correctness benefit for this change.

2. **windowId (@N) as store key, not session:windowId compound**
   - *Why*: `@N` values are globally unique across all tmux sessions on a server. Using bare `windowId` as the key eliminates the need to ever form compound keys. `session` is stored as a field on the entry for scoped queries.
   - *Rejected*: `session:windowId` compound key — unnecessary for correctness, adds key formatting logic.

3. **Ghost reconciliation via snapshotWindowIds set-difference**
   - *Why*: Count-based reconciliation (`previousWindowCount`) produces false negatives when a window is deleted right as another is created (count stays the same). Set-difference detects the exact new windowId regardless of concurrent deletions.
   - *Rejected*: Matching ghost by name against incoming windows — false positives when creating a window with a name that already exists in the session.

4. **Kill entry removed by SSE absence, not by explicit "confirm" action**
   - *Why*: Simplifies the store. The SSE ground truth is authoritative — when the windowId is absent, tmux has confirmed deletion. `restoreWindow` is only needed for API error rollback (before SSE arrives).
   - *Rejected*: Explicit `confirmKill(windowId)` action — extra API layer that duplicates SSE information.

5. **URL routing keeps numeric index**
   - *Why*: Changing the URL scheme is a breaking change for shared links and is out of scope. The store lookup path is: URL index → find window in `windowStore.windows` where `window.session === sessionName && window.index === parseInt(windowIndex)`.
   - *Rejected*: Switching URLs to `/@N` — breaks existing links, larger scope change.

## Deprecated Requirements

### Window-Keyed OptimisticContext Methods
**Reason**: Replaced by Zustand window store actions.
**Migration**: `markKilled("window", ...)` → `windowStore.killWindow(session, windowId)`;
`markRenamed("window", ...)` → `windowStore.renameWindow(session, windowId, newName)`;
`addGhostWindow(...)` → `windowStore.addGhostWindow(session, name, currentIds)`.

### useMergedSessions Window Filtering
**Reason**: `useMergedSessions` no longer filters/renames windows from `OptimisticContext`.
Window display state comes entirely from Zustand.
**Migration**: Consumers of `useMergedSessions` continue to receive `MergedSession[]` with the
same shape — the source of window data changes internally, the interface is unchanged.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use Zustand for window list state | Confirmed from intake #1 — explicitly chosen by user | S:95 R:90 A:90 D:95 |
| 2 | Certain | Use `window_id` (@N) as immutable store key | Confirmed from intake #2 — correct tmux identifier; globally unique per server | S:95 R:90 A:90 D:95 |
| 3 | Certain | Backend must expose `window_id` in WindowInfo / API response | Confirmed from intake #3 — code exploration confirmed field is absent; added at position 0 in format string | S:95 R:85 A:95 D:95 |
| 4 | Certain | `index` remains on WindowInfo as display/ordering property | Confirmed from intake #4 — user explicitly stated this | S:95 R:90 A:90 D:95 |
| 5 | Certain | Update and add tests | Confirmed from intake #5 — backend tests, store unit tests, regression test | S:95 R:90 A:90 D:95 |
| 6 | Confident | OptimisticContext slimmed (not deleted); window slice fully replaced by Zustand | Override of intake #6 (Certain → Confident). Spec analysis shows session/server state in OptimisticContext is not broken — deleting it adds scope with no correctness benefit. Window state is fully rewritten in Zustand. | S:85 R:75 A:85 D:80 |
| 7 | Certain | URL routing continues to use `index` (no URL scheme change) | Confirmed from intake #7 — URLs are stable; `/$server/$session/$window` unchanged | S:95 R:85 A:90 D:95 |
| 8 | Certain | Store actions: `setWindowsForSession`, `addGhostWindow`, `killWindow`, `restoreWindow`, `renameWindow`, `clearRename`, `clearSession`, `removeGhost` | Derived from full code reading of all consumers; minimal set to replace OptimisticContext window methods | S:90 R:85 A:90 D:90 |
| 9 | Certain | `SessionContext` and `ChromeContext` remain as React Context | Confirmed from intake #9 — not index-based, not in scope | S:95 R:90 A:90 D:95 |
| 10 | Certain | Ghost reconciliation uses snapshotWindowIds set-difference | Upgraded from intake #10 (Tentative → Certain). Spec analysis confirms this is the correct approach: more reliable than count-based, handles concurrent creates/deletes without false positives | S:90 R:85 A:90 D:85 |
| 11 | Certain | Kill entries are cleaned by SSE absence (not explicit confirm); `restoreWindow` is only for API error rollback | New assumption from spec — derived from reading current `onAlwaysSettled` behavior and the cleaner model enabled by ID-based tracking | S:90 R:85 A:90 D:85 |
| 12 | Certain | `editingWindow` in sidebar tracks `{ session, windowId }` not `{ session, index }` | New assumption — the inline edit state must use windowId to avoid index collisions | S:90 R:85 A:90 D:90 |
| 13 | Confident | useDialogState receives windowId instead of windowIndex for window operations | New assumption — consistent with sidebar refactor; dialog kill/rename must also use windowId | S:80 R:75 A:85 D:85 |
| 14 | Confident | AppShell drives setWindowsForSession via useEffect on rawSessions | New assumption — cleanest integration point; keeps SessionContext pure and avoids circular dependencies | S:80 R:80 A:85 D:80 |

14 assumptions (11 certain, 3 confident, 0 tentative, 0 unresolved).
