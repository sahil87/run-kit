# Tasks: Quick Session/Window Launch Without Folder Selection

**Change**: 260405-gle4-quick-session-launch
**Spec**: `spec.md`
**Intake**: `intake.md`

<!--
  TASK FORMAT: - [ ] {ID} [{markers}] {Description with file paths}

  Markers (optional, combine as needed):
    [P]   — Parallelizable (different files, no dependencies on other [P] tasks in same group)

  IDs are sequential: T001, T002, ...
  Include exact file paths in descriptions.
  Each task should be completable in one focused session.

  Tasks are grouped by phase. Phases execute sequentially.
  Within a phase, [P] tasks can execute in parallel.
-->

## Phase 1: Setup

<!-- Scaffolding, dependencies, configuration. No business logic. -->

- [x] T001 Export `deriveNameFromPath` and `toTmuxSafeName` from `app/frontend/src/components/create-session-dialog.tsx` — add `export` keyword to both functions so they are importable in `app.tsx`

## Phase 2: Core Implementation

<!-- Primary functionality. Order by dependency — earlier tasks are prerequisites for later ones. -->

- [x] T002 Add `defaultPath?: string` prop to `CreateSessionDialog` in `app/frontend/src/components/create-session-dialog.tsx` — change `useState("")` for `path` to `useState(defaultPath ?? "")`, update `CreateSessionDialogProps` type

- [x] T003 Add `mode?: "session" | "window"` prop to `CreateSessionDialog` in `app/frontend/src/components/create-session-dialog.tsx` — add `session?: string` prop (required when `mode === "window"`); when mode is `"window"`: change dialog title to "Create window at folder", hide the session name input, change `handleCreate` to call `createWindow(session, "zsh", path.trim() || undefined)` instead of `createSession`; update imports to include `createWindow` from `@/api/client`

- [x] T004 Add `deriveInstantSessionName` helper and `executeCreateSessionInstant` action in `app/frontend/src/app.tsx` — import `createSession` alongside other api imports; import `deriveNameFromPath` from `@/components/create-session-dialog`; implement `deriveInstantSessionName(cwd: string | undefined, existingNames: string[]): string` (uses `deriveNameFromPath`, fallback `"session"`, deduplicates with `-2`…`-10` suffix then `-11`); set up `useOptimisticAction` for `executeCreateSessionInstant` mirroring the `executeCreateWindow` pattern (ghost session via `addGhostSession`/`removeGhost` from `useOptimisticContext`, error toast); <!-- clarified: `addGhostSession` must be added to the `useOptimisticContext()` destructure at line 129 of `app.tsx` — currently only `removeGhost, addGhostServer, markKilled, unmarkKilled` are destructured; `addGhostSession` is exported from `optimistic-context.tsx` and available, it just needs to be pulled in --> this task depends on T001

- [x] T005 Wire `executeCreateSessionInstant` to all primary session creation entry points in `app/frontend/src/app.tsx`:
  - Replace `dialogs.openCreateDialog` with the instant handler in `sessionActions` "Session: Create" `onSelect`
  - Replace `dialogs.openCreateDialog` with the instant handler in the `onCreateSession` prop for both desktop `<Sidebar>` instances (inline and mobile drawer)
  - Replace `dialogs.openCreateDialog` with the instant handler in `<TopBar onCreateSession=...>`
  - Replace `dialogs.openCreateDialog` with the instant handler in `<Dashboard onCreateSession=...>`
  - The instant handler MUST read `currentWindow?.worktreePath` at call time (use `useCallback` with `currentWindow` in deps); this task depends on T004

- [x] T006 Add "Session: Create at Folder" and "Window: Create at Folder" actions to `app/frontend/src/app.tsx`:
  - Add `showCreateSessionAtFolderDialog` and `showCreateWindowAtFolderDialog` state booleans (two `useState(false)` calls)
  - Add `"Session: Create at Folder"` palette action (`id: "create-session-at-folder"`) that sets `showCreateSessionAtFolderDialog(true)` — appears after "Session: Create" in `sessionActions`
  - Add `"Window: Create at Folder"` palette action (`id: "create-window-at-folder"`) that sets `showCreateWindowAtFolderDialog(true)` — only present when `sessionName` is defined (inside the existing `sessionName ? [...]` guard in `windowActions`)
  - Render `<CreateSessionDialog>` for the at-folder session dialog: `showCreateSessionAtFolderDialog && <Suspense>...<CreateSessionDialog sessions={sessions} defaultPath={currentWindow?.worktreePath} onClose={...} /></Suspense>`
  - Render `<CreateSessionDialog>` for the at-folder window dialog with `mode="window"` and `session={sessionName}`: `showCreateWindowAtFolderDialog && sessionName && <Suspense>...<CreateSessionDialog sessions={sessions} mode="window" session={sessionName} defaultPath={currentWindow?.worktreePath} onClose={...} /></Suspense>`
  - Update `dialogOpenRef.current` assignment to include the two new dialog booleans
  - Update `paletteActions` deps array to include the new state setters if needed; this task depends on T005

## Phase 3: Integration & Edge Cases

<!-- Wire components together. Handle error states, edge cases, validation. -->

- [x] T007 Verify `deriveInstantSessionName` edge cases in `app/frontend/src/app.tsx`:
  - `worktreePath` is `undefined` → name is `"session"`
  - `worktreePath` is `"/"` or `"~"` (i.e. `deriveNameFromPath` returns `""`) → name is `"session"`
  - All ten suffixes taken → use base name with `-11` suffix (no loop guard needed beyond this)
  - `createSession` called with no `cwd` arg when `worktreePath` is undefined (matches spec "No active window" scenario)
  - Confirm the instant handler passes `cwd` as `undefined` (not empty string) when not available

- [x] T008 [P] Update `app/frontend/src/components/sidebar.test.tsx` — verify that the existing "shows empty state with + New Session button" test still passes after the prop change (the `onCreateSession` mock is already a `vi.fn()`); add a test that confirms `onCreateSession` is called when the `+` button is clicked in the session header (if such a button exists in sidebar); verify no test asserts that `CreateSessionDialog` is opened from sidebar

- [x] T009 [P] Update `app/frontend/src/app.test.tsx` (the command-palette integration test) — add test cases verifying that "Session: Create" action calls instant creation (not `dialogs.openCreateDialog`) and that "Session: Create at Folder" and "Window: Create at Folder" appear in the palette when a session is active; verify "Window: Create at Folder" is absent when no session is active

## Phase 4: Polish

<!-- Documentation, cleanup, performance. Only include if warranted by the change scope. -->

- [x] T010 Audit `app/frontend/src/app.tsx` `dialogOpenRef.current` assignment — confirm it now includes `showCreateSessionAtFolderDialog` and `showCreateWindowAtFolderDialog` so the active-window sync effect is suppressed while dialogs are open; also confirm the useMemo deps arrays for `sessionActions` and `windowActions` include any new state variables or setters introduced in T006

---

## Execution Order

- T001 must complete before T004 (export required before import)
- T002 and T003 are independent and can run in parallel (both edit `create-session-dialog.tsx`; stage sequentially to avoid conflicts)
- T004 depends on T001
- T005 depends on T004
- T006 depends on T005 (needs the instant handler in place before wiring at-folder dialogs)
- T007 is a verification pass after T005; no code changes unless edge cases reveal bugs
- T008 and T009 are independent test tasks, can run in parallel after T006
- T010 is a final audit pass, depends on T006
