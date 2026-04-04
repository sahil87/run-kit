# Spec: Optimistic UI Feedback

**Change**: 260403-32la-optimistic-ui-feedback
**Created**: 2026-04-03
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Backend API changes — all feedback is frontend-only; the API contract is unchanged
- Offline support or retry logic — mutations still fail when the backend is unreachable
- Debouncing or rate-limiting user actions — rapid clicks are the user's prerogative
- Animation library dependencies — all transitions use CSS only

## Hooks: useOptimisticAction

### Requirement: Core Hook API

The `useOptimisticAction` hook SHALL accept a generic async action and provide synchronous optimistic state management. The hook SHALL return `{ execute: (...args) => void, isPending: boolean }`.

#### Scenario: Successful mutation

- **GIVEN** a component using `useOptimisticAction` with `action`, `onOptimistic`, and `onSettled` callbacks
- **WHEN** the user triggers `execute()`
- **THEN** `onOptimistic()` SHALL be called synchronously before the API call
- **AND** `isPending` SHALL be `true` for the duration of the API call
- **AND** on API success, `onSettled` SHALL be called and `isPending` SHALL become `false`

#### Scenario: Failed mutation with rollback

- **GIVEN** a component using `useOptimisticAction` with `onOptimistic`, `onRollback`, and `onError` callbacks
- **WHEN** `execute()` is called and the API promise rejects
- **THEN** `onRollback()` SHALL be called to revert the optimistic state
- **AND** `onError(error)` SHALL be called with the error
- **AND** `isPending` SHALL become `false`

#### Scenario: Unmounted component

- **GIVEN** a component using `useOptimisticAction` that unmounts while `isPending` is true
- **WHEN** the API promise settles after unmount
- **THEN** no state updates SHALL be applied (no React state-after-unmount warning)

### Requirement: Hook Signature

The hook SHALL have this TypeScript signature:

```typescript
function useOptimisticAction<TArgs extends unknown[] = []>(options: {
  action: (...args: TArgs) => Promise<unknown>;
  onOptimistic?: (...args: TArgs) => void;
  onRollback?: () => void;
  onSettled?: () => void;
  onError?: (error: Error) => void;
}): {
  execute: (...args: TArgs) => void;
  isPending: boolean;
}
```

All callbacks except `action` SHALL be optional. `onOptimistic` SHALL receive the same arguments as `execute` so callers can apply optimistic state based on the mutation parameters (e.g., the session name being created). The hook SHALL be exported from `app/frontend/src/hooks/use-optimistic-action.ts`.

#### Scenario: Minimal usage (loading state only)

- **GIVEN** a caller that only needs `isPending` and provides only `action`
- **WHEN** the caller passes `{ action: () => someApiCall() }`
- **THEN** the hook SHALL work without `onOptimistic`, `onRollback`, `onSettled`, or `onError`
- **AND** `isPending` SHALL toggle correctly

## Toast: Error Notification

### Requirement: Toast Component

A `Toast` component SHALL render error notifications in the bottom-right corner of the viewport. Toasts SHALL auto-dismiss after 4 seconds. Toasts SHALL support `error` and `info` variants. The component SHALL use the existing theme system (CSS custom properties for colors, monospace font).

#### Scenario: Error toast on failed mutation

- **GIVEN** a mutation wrapped in `useOptimisticAction` with `onError` calling `addToast`
- **WHEN** the API call fails
- **THEN** an error toast SHALL appear in the bottom-right corner
- **AND** the toast SHALL display a concise error message
- **AND** the toast SHALL auto-dismiss after 4 seconds

#### Scenario: Multiple concurrent toasts

- **GIVEN** two mutations fail in quick succession
- **WHEN** both error callbacks fire
- **THEN** both toasts SHALL be visible simultaneously, stacked vertically
- **AND** each SHALL dismiss independently after its own 4-second timeout

### Requirement: Toast Context

A `ToastProvider` context SHALL provide `addToast(message: string, variant?: "error" | "info")` to the component tree. The provider SHALL manage a list of active toasts with unique IDs. The provider SHALL be placed near the root of the app (in `app.tsx`).

#### Scenario: Toast from any depth

- **GIVEN** a deeply nested component calling `useToast()` to get `addToast`
- **WHEN** it calls `addToast("Failed to create window", "error")`
- **THEN** the toast SHALL render in the fixed bottom-right container regardless of component nesting

### Requirement: Toast Styling

Toasts SHALL use `bg-bg-card border border-border text-text-primary` for theming. Error variant SHALL have a left accent border using the theme's red ANSI color (`var(--color-ansi-1)`). Info variant SHALL use the theme's blue ANSI color (`var(--color-ansi-4)`). Toasts SHALL have `font-mono text-xs` matching the app's monospace convention.

#### Scenario: Theme change while toast is visible

- **GIVEN** a visible toast and the user switches themes
- **WHEN** CSS custom properties update
- **THEN** the toast colors SHALL update reactively (no stale colors)

## Optimistic State: Session/Window CRUD

### Requirement: Optimistic Provider

An `OptimisticProvider` context SHALL manage optimistic session and window entries. The provider SHALL expose functions to add/remove optimistic entries and a merged state accessor. The provider SHALL wrap `SessionProvider` output so consumers see a combined view of real + optimistic data.

#### Scenario: Merged state in sidebar

- **GIVEN** SSE delivers 2 sessions and an optimistic "create session" entry exists
- **WHEN** the sidebar reads the session list
- **THEN** it SHALL see 3 sessions (2 real + 1 ghost)
- **AND** the ghost session SHALL have an `optimistic: true` flag

### Requirement: Ghost Session Entry

When the user creates a session, the UI SHALL immediately insert a ghost session entry into the sidebar. The ghost entry SHALL render with `opacity-50` and a `animate-pulse` CSS class. When SSE delivers a session matching the ghost's name, the ghost SHALL be replaced by the real entry. If the API call fails, the ghost SHALL be removed and an error toast SHALL appear.

#### Scenario: Create session optimistic flow

- **GIVEN** the user is on the dashboard with sessions listed in the sidebar
- **WHEN** the user submits the "Create Session" dialog with name "my-session"
- **THEN** a ghost entry "my-session" SHALL appear immediately in the sidebar with `opacity-50 animate-pulse`
- **AND** the dialog SHALL close immediately
- **AND** when SSE delivers a session named "my-session", the ghost styling SHALL be removed

#### Scenario: Create session failure rollback

- **GIVEN** the user submitted "Create Session" and a ghost entry appeared
- **WHEN** the API call rejects (e.g., network error or tmux failure)
- **THEN** the ghost entry SHALL be removed from the sidebar
- **AND** an error toast SHALL appear: "Failed to create session"

### Requirement: Ghost Window Entry

When the user creates a window (via sidebar "+", breadcrumb dropdown, or command palette), the UI SHALL immediately insert a ghost window entry under the target session. Same visual treatment as ghost sessions (`opacity-50 animate-pulse`). SSE reconciliation and failure rollback follow the same pattern.

#### Scenario: Create window via sidebar "+"

- **GIVEN** a session "dev" with 2 windows in the sidebar
- **WHEN** the user clicks "+" next to "dev"
- **THEN** a ghost window entry SHALL appear under "dev" immediately
- **AND** when SSE delivers a new window in "dev", the ghost SHALL be replaced

### Requirement: Optimistic Kill

When the user kills a session or window, the entry SHALL be removed from the UI immediately. If the API call fails, the entry SHALL reappear and an error toast SHALL be shown.

#### Scenario: Kill session optimistic flow

- **GIVEN** 3 sessions in the sidebar
- **WHEN** the user confirms killing session "old-session"
- **THEN** "old-session" SHALL disappear from the sidebar immediately
- **AND** the kill confirmation dialog SHALL close
- **AND** if SSE no longer includes "old-session", no further action needed

#### Scenario: Kill session failure rollback

- **GIVEN** session "old-session" was optimistically removed
- **WHEN** the kill API call fails
- **THEN** "old-session" SHALL reappear in the sidebar
- **AND** an error toast SHALL appear: "Failed to kill session"

### Requirement: Optimistic Rename

When the user renames a session or window, the new name SHALL appear immediately in the UI. If the API call fails, the old name SHALL be restored and an error toast shown.

#### Scenario: Rename session optimistic flow

- **GIVEN** a session named "dev" in the sidebar
- **WHEN** the user renames it to "staging" via the rename dialog
- **THEN** the sidebar SHALL show "staging" immediately
- **AND** when SSE delivers a session named "staging", no further change needed

#### Scenario: Rename failure rollback

- **GIVEN** the session was optimistically renamed from "dev" to "staging"
- **WHEN** the rename API call fails
- **THEN** the sidebar SHALL revert to showing "dev"
- **AND** an error toast SHALL appear: "Failed to rename session"

### Requirement: Optimistic Server Create/Kill

Server create and kill on the server list page SHALL follow the same optimistic patterns as sessions. Ghost server cards use `opacity-50 animate-pulse`. Kill removes the card immediately with rollback on failure.

#### Scenario: Create server optimistic flow

- **GIVEN** the server list page with 2 servers
- **WHEN** the user creates server "test-server"
- **THEN** a ghost server card SHALL appear immediately
- **AND** navigation to `/$server` happens optimistically

## Button Loading: Fire-and-Forget Actions

### Requirement: Split Pane Loading State

The `SplitButton` components in the top bar SHALL show a loading state while the split API call is in-flight. The button SHALL be disabled and its icon SHALL be replaced with a small spinner (CSS animation) during `isPending`.

#### Scenario: Split pane button feedback

- **GIVEN** a terminal view with split buttons visible in the top bar
- **WHEN** the user clicks the vertical split button
- **THEN** the button icon SHALL be replaced with a spinner
- **AND** the button SHALL be `disabled`
- **AND** when the promise settles, the original icon SHALL restore and the button re-enables

### Requirement: Close Pane Loading State

The `ClosePaneButton` in the top bar SHALL follow the same spinner/disabled pattern as `SplitButton`.

#### Scenario: Close pane button feedback

- **GIVEN** a terminal view with the close pane button visible
- **WHEN** the user clicks the close pane button
- **THEN** the button SHALL show a spinner and be disabled until the promise settles

### Requirement: Config Reload Feedback

When "Config: Reload tmux" or "Config: Reset tmux to default" is triggered from the command palette, the command palette item SHALL show brief feedback. Since the palette closes on action, the feedback SHALL be an info toast: "Tmux config reloaded" on success, error toast on failure.

#### Scenario: Reload config feedback

- **GIVEN** the user opens the command palette
- **WHEN** the user selects "Config: Reload tmux"
- **THEN** an info toast SHALL appear: "Tmux config reloaded" on success
- **OR** an error toast SHALL appear on failure

## Inline Progress: Existing Gaps

### Requirement: File Upload Indicator

The existing `uploading` boolean from `use-file-upload.ts` SHALL be rendered as a visible indicator. When `uploading` is true, a small "Uploading..." badge SHALL appear near the terminal area (above the bottom bar). The badge SHALL use `text-xs text-text-secondary` styling.

#### Scenario: Drag-and-drop upload feedback

- **GIVEN** the user is in a terminal view
- **WHEN** the user drops a file onto the terminal
- **THEN** an "Uploading..." badge SHALL appear immediately
- **AND** the badge SHALL disappear when `uploading` becomes false

### Requirement: Directory Autocomplete Spinner

The path input in `CreateSessionDialog` SHALL show a small spinner in its trailing slot while directory suggestions are being fetched (during the 300ms debounce + network time). The spinner SHALL use `text-text-secondary` and be 14px.

#### Scenario: Directory suggestions loading

- **GIVEN** the create session dialog is open and the user is typing a path
- **WHEN** directory suggestions are being fetched
- **THEN** a small spinner SHALL appear at the right end of the path input
- **AND** the spinner SHALL disappear when suggestions arrive or the request completes

### Requirement: Server List Refresh Spinner

When the server dropdown in the sidebar triggers a refresh, a small spinner SHALL appear on the dropdown trigger button while the server list is being re-fetched.

#### Scenario: Server dropdown refresh

- **GIVEN** the sidebar server dropdown is opened
- **WHEN** the server list refresh is in-flight
- **THEN** a spinner SHALL appear on the dropdown trigger
- **AND** the spinner SHALL disappear when fresh data arrives

## Integration: Mutation Call Site Migration

### Requirement: Replace Fire-and-Forget Pattern

All existing `.catch(() => {})` mutation call sites SHALL be replaced with `useOptimisticAction`. Each call site SHALL provide at minimum an `action` callback. Call sites for CRUD operations SHALL also provide `onOptimistic` and `onRollback` callbacks. Call sites for fire-and-forget actions SHALL use `isPending` for button state.

#### Scenario: Sidebar create window migration

- **GIVEN** the sidebar "+" button currently calls `createWindow(...).catch(() => {})`
- **WHEN** this change is applied
- **THEN** the button SHALL use `useOptimisticAction` with `onOptimistic` inserting a ghost window and `onError` showing a toast

#### Scenario: Top bar split button migration

- **GIVEN** the split button currently calls `splitWindow(...).catch(() => {})`
- **WHEN** this change is applied
- **THEN** the button SHALL use `useOptimisticAction` with `isPending` driving the disabled/spinner state

### Requirement: Preserve Existing Behavior

Mutations that already have proper error handling (e.g., `CreateSessionDialog` with inline error display) SHALL continue to show inline errors. The `useOptimisticAction` hook SHALL be used in addition to, not instead of, existing error handling where it exists.

#### Scenario: CreateSessionDialog retains inline errors

- **GIVEN** the create session dialog shows inline errors on failure
- **WHEN** migrated to `useOptimisticAction`
- **THEN** inline error display SHALL be preserved
- **AND** a ghost sidebar entry SHALL be added via `onOptimistic`
- **AND** on failure, the ghost SHALL be removed, the inline error SHALL display, and no duplicate toast

## Design Decisions

1. **Single hook over per-pattern hooks**: One `useOptimisticAction` hook covers all three patterns (ghost entries, button loading, inline progress) rather than separate `useOptimisticCreate`, `useLoadingAction`, etc.
   - *Why*: All patterns share the same lifecycle (optimistic → pending → settle/rollback). A single generic hook reduces API surface and is easier to learn.
   - *Rejected*: Per-pattern hooks — would share 90% of logic, introducing unnecessary duplication.

2. **OptimisticProvider context over per-component state**: Optimistic entries live in a shared context rather than each component managing its own ghost state.
   - *Why*: Ghost sessions/windows must be visible across sidebar, dashboard, and top bar simultaneously. Per-component state would require prop drilling or duplicated ghost tracking.
   - *Rejected*: Lifting state to individual parents — sidebar and dashboard are siblings, requiring a common ancestor. A context is cleaner.

3. **CSS-only animations over animation libraries**: Ghost entry pulsing and toast transitions use Tailwind's built-in `animate-pulse` and CSS transitions.
   - *Why*: Constitution mandates minimal surface area. Framer Motion or similar would add a dependency for simple opacity transitions.
   - *Rejected*: Animation libraries — overkill for pulse + fade.

4. **Toast over inline error expansion**: Failed fire-and-forget actions show toasts rather than expanding error text inline on the triggering button.
   - *Why*: Fire-and-forget actions (split, close pane, config reload) have no natural inline error location — the button is small and the action is non-modal. A toast provides consistent error visibility without layout shifts.
   - *Rejected*: Inline error text — no space in the top bar button row; would cause layout reflow.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | SSE remains the source of truth for state | Confirmed from intake #1 — constitution mandates state derived from tmux | S:95 R:95 A:95 D:95 |
| 2 | Certain | No backend changes required | Confirmed from intake #2 — frontend-only change | S:90 R:95 A:95 D:95 |
| 3 | Certain | Use existing theme system for styling | Confirmed from intake #3 — monospace + CSS custom properties | S:90 R:90 A:95 D:90 |
| 4 | Certain | useOptimisticAction is the central abstraction | Confirmed from intake #4 — user confirmed single hook approach | S:95 R:80 A:75 D:80 |
| 5 | Certain | Ghost entries use opacity-50 + animate-pulse | Confirmed from intake #5 — user confirmed visual pattern | S:95 R:90 A:70 D:70 |
| 6 | Certain | Error toast is internal, no library | Confirmed from intake #6 — minimal surface area per constitution | S:95 R:85 A:80 D:75 |
| 7 | Certain | Optimistic state lives in a context provider | Confirmed from intake #7 — shared across sidebar/dashboard/top bar | S:95 R:75 A:70 D:65 |
| 8 | Certain | Kill operations use immediate removal | Confirmed from intake #8 — fade-out, not strikethrough | S:95 R:90 A:65 D:70 |
| 9 | Certain | Toast auto-dismisses after 4 seconds | Confirmed from intake #9 — user chose auto-dismiss, refined to 4s (middle of 3-5s range) | S:95 R:95 A:50 D:60 |
| 10 | Certain | Hook receives same args as execute for onOptimistic | Spec-level decision — callers need mutation params (session name, etc.) to apply correct optimistic state | S:85 R:90 A:90 D:90 |
| 11 | Certain | CreateSessionDialog retains inline errors alongside optimistic UI | Codebase shows existing inline error pattern — preserve, don't replace | S:90 R:85 A:90 D:85 |
| 12 | Certain | Config reload uses info toast for success feedback | No inline location for feedback — palette closes on action | S:80 R:90 A:85 D:80 |

12 assumptions (12 certain, 0 confident, 0 tentative, 0 unresolved).
