# Spec: Sidebar Component Decomposition

**Change**: 260405-f8p9-sidebar-component-decomposition
**Created**: 2026-04-06
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- New unit tests for individual sub-components — out of scope for this refactor
- Any behavioral changes to sidebar interactions
- New React contexts, new dependencies, or new API calls
- Changes to the backend or any non-sidebar frontend components

## Frontend: Sidebar Component Structure

### Requirement: Directory Layout

The monolithic `app/frontend/src/components/sidebar.tsx` (709 lines) SHALL be replaced by a `sidebar/` directory with an `index.tsx` orchestrator and four sub-component files:

```
app/frontend/src/components/
  sidebar/
    index.tsx            # Orchestrator — Sidebar component and re-export
    session-row.tsx      # SessionRow sub-component
    window-row.tsx       # WindowRow sub-component
    server-selector.tsx  # ServerSelector sub-component
    kill-dialog.tsx      # KillDialog sub-component
  sidebar.test.tsx       # Existing tests — import paths updated if needed
```

The old `sidebar.tsx` file SHALL be deleted. Vite resolves `@/components/sidebar` to `sidebar/index.tsx` automatically — no consumer (`app.tsx`) changes required.

#### Scenario: Import resolution unchanged
- **GIVEN** a consumer imports `@/components/sidebar`
- **WHEN** the sidebar directory exists with `index.tsx`
- **THEN** Vite and Vitest resolve the import to `sidebar/index.tsx` without any changes to the importing file

### Requirement: Public API Preserved

The `SidebarProps` type and the `Sidebar` component export SHALL remain identical to the current `sidebar.tsx`. Zero changes to `app.tsx` or any other consumer.

#### Scenario: App shell compiles after refactor
- **GIVEN** `app.tsx` imports `{ Sidebar }` from `@/components/sidebar`
- **WHEN** the refactor replaces `sidebar.tsx` with `sidebar/index.tsx`
- **THEN** `tsc --noEmit` passes without errors

### Requirement: KillDialog Sub-Component

A `KillDialog` component SHALL be extracted to `app/frontend/src/components/sidebar/kill-dialog.tsx`. It encapsulates the kill confirmation dialog for both sessions and windows.

Props:
```typescript
type KillDialogProps = {
  killTarget: {
    type: "session" | "window";
    session: string;
    windowId?: string;
    windowIndex?: number;
    windowCount: number;
  };
  onConfirm: () => void;
  onCancel: () => void;
};
```

It SHALL use the existing `<Dialog>` component from `@/components/dialog`.

#### Scenario: Session kill confirmation dialog renders
- **GIVEN** `killTarget.type === "session"` with `windowCount: 3`
- **WHEN** `KillDialog` is rendered
- **THEN** the dialog title is "Kill session?" and body reads "Kill session **{name}** and all 3 windows?"

#### Scenario: Window kill confirmation dialog renders
- **GIVEN** `killTarget.type === "window"`
- **WHEN** `KillDialog` is rendered
- **THEN** the dialog title is "Kill window?" and body reads "Kill this window in **{session}**?"

#### Scenario: Confirm triggers onConfirm callback
- **GIVEN** `KillDialog` is rendered with `onConfirm` and `onCancel`
- **WHEN** the user clicks the "Kill" button
- **THEN** `onConfirm` is called

#### Scenario: Cancel triggers onCancel callback
- **GIVEN** `KillDialog` is rendered
- **WHEN** the user clicks the "Cancel" button or the Dialog's onClose
- **THEN** `onCancel` is called

### Requirement: ServerSelector Sub-Component

A `ServerSelector` component SHALL be extracted to `app/frontend/src/components/sidebar/server-selector.tsx`. It encapsulates the pinned-bottom server dropdown.

Props:
```typescript
type ServerSelectorProps = {
  server: string;
  servers: string[];
  onSwitchServer: (name: string) => void;
  onCreateServer: () => void;
  onRefreshServers: () => void;
};
```

The `serverDropdownOpen`, `refreshingServers` state, the `serverDropdownRef`, and the outside-click `useEffect` SHALL all live inside `ServerSelector`. No state for server dropdown is needed in the orchestrator.

#### Scenario: Dropdown opens on click and refreshes servers
- **GIVEN** the server selector button is visible
- **WHEN** the user clicks the button
- **THEN** `onRefreshServers` is called and the dropdown list renders

#### Scenario: Outside click closes dropdown
- **GIVEN** the server dropdown is open
- **WHEN** a mousedown event fires outside the selector container
- **THEN** the dropdown closes

#### Scenario: Current server highlighted
- **GIVEN** the dropdown is open with `server === "default"` and `servers === ["default", "work"]`
- **WHEN** the list renders
- **THEN** "default" has `text-accent` styling and "work" has `text-text-primary` styling

#### Scenario: Create server action
- **GIVEN** the dropdown is open
- **WHEN** the user clicks "+ tmux server"
- **THEN** `onCreateServer` is called and the dropdown closes

### Requirement: SessionRow Sub-Component

A `SessionRow` component SHALL be extracted to `app/frontend/src/components/sidebar/session-row.tsx`. It renders one session header row.

Props:
```typescript
type SessionRowProps = {
  session: ProjectSession | MergedSession;
  isCollapsed: boolean;
  isSessionDropTarget: boolean;
  editingSession: string | null;
  editingSessionName: string;
  sessionInputRef: React.RefObject<HTMLInputElement | null>;
  onToggleCollapse: () => void;
  onSelectFirstWindow: () => void;
  onCreateWindow: () => void;
  onKillClick: (e: React.MouseEvent) => void;
  onDoubleClickName: () => void;
  onSessionNameChange: (value: string) => void;
  onSessionRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSessionRenameBlur: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
};
```

`SessionRow` SHALL be a pure presentational component — all state (collapsed map, editingSession, drag targets) lives in the orchestrator `index.tsx`. All event handlers are passed as props.

#### Scenario: Collapsed state renders expand chevron
- **GIVEN** `isCollapsed === true`
- **WHEN** `SessionRow` renders
- **THEN** the chevron button shows `▶` and has `aria-expanded={false}`

#### Scenario: Expanded state renders collapse chevron
- **GIVEN** `isCollapsed === false`
- **WHEN** `SessionRow` renders
- **THEN** the chevron button shows `▼` and has `aria-expanded={true}`

#### Scenario: Cross-session drag-over shows accent border
- **GIVEN** `isSessionDropTarget === true`
- **WHEN** `SessionRow` renders
- **THEN** the row container has accent border styling (`border: "2px solid var(--color-accent)"`)

#### Scenario: Double-click on session name triggers inline rename
- **GIVEN** `editingSession !== session.name`
- **WHEN** the user double-clicks the session name button
- **THEN** `onDoubleClickName` is called

#### Scenario: Ctrl+click kill bypasses dialog
- **GIVEN** `e.ctrlKey === true` or `e.metaKey === true`
- **WHEN** the user clicks the ✕ kill button on the session row
- **THEN** `onKillClick` is called with the event (orchestrator handles force-kill)

### Requirement: WindowRow Sub-Component

A `WindowRow` component SHALL be extracted to `app/frontend/src/components/sidebar/window-row.tsx`. It renders one window row with all its interactions.

Props:
```typescript
type WindowRowProps = {
  win: ProjectWindow | GhostWindow;  // window from session.windows
  session: string;
  isSelected: boolean;
  isDragOver: boolean;
  nowSeconds: number;
  editingWindow: { session: string; windowId: string } | null;
  editingName: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSelectWindow: () => void;
  onDoubleClickName: () => void;
  onWindowNameChange: (value: string) => void;
  onRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onRenameBlur: () => void;
  onKillClick: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
};
```

`WindowRow` SHALL be a pure presentational component. Ghost window detection (`isGhostWindow`) can be called inside `WindowRow` using the passed `win` prop (it's a pure predicate with no side effects), or the `ghost` boolean can be passed as a prop — either is acceptable as long as the behavior is identical.

#### Scenario: Selected window has accent styling
- **GIVEN** `isSelected === true`
- **WHEN** `WindowRow` renders
- **THEN** the button has `bg-accent/15 text-text-primary font-medium` classes

#### Scenario: Active window shows green dot
- **GIVEN** `win.activity === "active"`
- **WHEN** `WindowRow` renders
- **THEN** the activity dot has `bg-accent-green` class

#### Scenario: Drag-over shows top border indicator
- **GIVEN** `isDragOver === true`
- **WHEN** `WindowRow` renders
- **THEN** the container has `borderTop: "2px solid var(--color-accent)"` style

#### Scenario: Kill button hidden on desktop, visible on touch
- **GIVEN** a non-ghost window
- **WHEN** `WindowRow` renders
- **THEN** the kill button has `opacity-0 group-hover:opacity-100 coarse:opacity-100` classes

#### Scenario: Ghost window is not draggable and kill is no-op
- **GIVEN** `isGhostWindow(win) === true`
- **WHEN** `WindowRow` renders
- **THEN** `draggable` is `false` and clicking kill does nothing

#### Scenario: Inline rename input shown when editing this window
- **GIVEN** `editingWindow.session === session` and `editingWindow.windowId === win.windowId`
- **WHEN** `WindowRow` renders
- **THEN** a text input is shown pre-filled with `editingName` instead of the name span

### Requirement: Orchestrator Owns All State

`sidebar/index.tsx` SHALL contain all state and hook wiring currently in `sidebar.tsx`:

- `collapsed`, `killTarget`, `editingWindow`, `editingName`, `editingSession`, `editingSessionName`, `dragSource`, `dropTarget`, `sessionDropTarget`
- All `useRef` instances (`inputRef`, `cancelledRef`, `originalNameRef`, `sessionInputRef`, `sessionCancelledRef`, `sessionOriginalNameRef`, `lastKillSessionRef`, `lastKillWindowRef`, `killTargetRef`, `lastRenameSessionRef`, `lastRenameWindowRef`)
- All `useOptimisticAction` hooks (`executeKillSession`, `executeKillWindow`, `executeKillFromDialog`, `executeRenameSession`, `executeRenameWindow`)
- The `toggleSession` `useCallback`
- The `handleKill` function and all rename/drag event handler functions

The orchestrator SHALL pass computed props down to each sub-component. No sub-component may import `useOptimisticAction`, `useOptimisticContext`, `useWindowStore`, or `useToast` directly.

#### Scenario: State stays in orchestrator after refactor
- **GIVEN** the `Sidebar` component is fully refactored
- **WHEN** `tsc --noEmit` is run
- **THEN** no TypeScript errors are reported and sub-components have no direct hook imports for optimistic/store logic

### Requirement: Existing Tests Pass Unmodified (or with import-only changes)

The existing `app/frontend/src/components/sidebar.test.tsx` (810 lines) SHALL continue to pass. Import paths in the test file MAY be updated if needed (e.g., if any type is re-exported from a sub-component file), but no test logic SHALL change.

#### Scenario: All existing sidebar tests pass after refactor
- **GIVEN** the refactor is complete
- **WHEN** `just test-frontend` is run
- **THEN** all tests in `sidebar.test.tsx` pass with exit code 0

### Requirement: No Behavioral Changes

Every interaction currently supported by `sidebar.tsx` SHALL behave identically after the refactor:
- Single-click session name → navigate to first window
- Double-click session name → inline rename
- Single-click window row → navigate to window
- Double-click window name → inline rename
- Ctrl/Cmd+click session ✕ → force-kill session
- Ctrl/Cmd+click window ✕ → force-kill window
- Normal click ✕ (session or window) → open kill dialog
- Drag window within session → reorder
- Drag window onto different session header → cross-session move
- Ghost window/session opacity and non-interactivity

#### Scenario: Full behavioral parity
- **GIVEN** the refactored sidebar is rendered with identical props
- **WHEN** any interaction is performed
- **THEN** the behavior, visual output, and side effects are identical to the pre-refactor sidebar

## Design Decisions

1. **Pure presentational sub-components with all state in orchestrator**
   - *Why*: Keeps sub-components prop-driven and independently testable without hook mocking. Avoids splitting optimistic action logic across files, which would create tangled rollback/commit paths.
   - *Rejected*: Moving some state into sub-components (e.g., `serverDropdownOpen` into `ServerSelector`) — accepted for `ServerSelector` only because its state is fully self-contained (no cross-component interactions).

2. **`ServerSelector` owns its own dropdown state**
   - *Why*: `serverDropdownOpen`, `refreshingServers`, and the outside-click `useEffect` are entirely local to the server selector. Moving them into `ServerSelector` reduces orchestrator complexity without creating any coupling.
   - *Rejected*: Keeping server dropdown state in orchestrator — would mean orchestrator passes 3 extra props for state that it never needs to read.

3. **Passing `sessionInputRef` and `inputRef` as props to sub-components**
   - *Why*: The `useEffect` for auto-focus lives in the orchestrator and depends on these refs. Keeping refs in the orchestrator and threading them as props is the minimal change.
   - *Rejected*: Moving auto-focus `useEffect` into sub-components — would require sub-components to own more state/refs, complicating the refactor scope.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `sidebar/` directory with `index.tsx` barrel | Vite resolves directory imports to `index.tsx` — confirmed standard pattern in this codebase (`command-palette.tsx` etc.) | S:90 R:95 A:95 D:95 |
| 2 | Certain | Keep `SidebarProps` type unchanged | Description explicitly: "no user-facing changes" and "existing consumers (`app.tsx`) require zero changes" | S:95 R:90 A:90 D:95 |
| 3 | Certain | Use kebab-case filenames (`session-row.tsx`) | Confirmed from intake #3 — codebase convention: `logo-spinner.tsx`, `command-palette.tsx` | S:85 R:95 A:95 D:95 |
| 4 | Certain | No new React contexts | Confirmed from intake #6 — constitution IV (minimal surface), code-quality (no context for one-level nesting) | S:85 R:85 A:90 D:90 |
| 5 | Confident | State and optimistic hooks stay in orchestrator `index.tsx` | Confirmed from spec analysis — sub-components are purely presentational. Exception: `ServerSelector` owns its own self-contained state | S:85 R:80 A:80 D:75 |
| 6 | Confident | Existing `sidebar.test.tsx` stays as integration tests, no new unit tests | Confirmed from intake #5 — scope is "pure refactor", new tests are explicitly out of scope | S:80 R:85 A:75 D:80 |
| 7 | Confident | Drag-and-drop handlers split between `SessionRow` and `WindowRow` | Confirmed from code analysis — `handleSessionDragOver/Leave/Drop` scoped to session header; `handleDragStart/Over/Drop/End` scoped to window items | S:75 R:80 A:85 D:75 |
| 8 | Confident | `ServerSelector` owns its dropdown state internally | Self-contained state — `serverDropdownOpen`, `refreshingServers`, `serverDropdownRef`. No cross-component reads from orchestrator needed | S:80 R:85 A:85 D:80 |
| 9 | Certain | `isGhostWindow` import used in `WindowRow` or passed as a `ghost` boolean prop | Pure predicate, no side effects — can be called anywhere. Implementation choice is free | S:80 R:95 A:95 D:90 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
