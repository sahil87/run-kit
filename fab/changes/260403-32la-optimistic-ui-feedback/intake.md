# Intake: Optimistic UI Feedback

**Change**: 260403-32la-optimistic-ui-feedback
**Created**: 2026-04-03
**Status**: Draft

## Origin

> Add optimistic UI feedback for all mutating actions. Currently every mutation (create/kill/rename session/window/server, split/close pane, config reload, file upload) is fire-and-forget with zero visual feedback — the user clicks and nothing happens until SSE updates arrive 100-500ms later.

Conversational — preceded by a deep `/fab-discuss` audit of all frontend API calls and backend endpoint latency. The audit identified 15 distinct "dead zones" where user actions produce no visual feedback while waiting for backend tmux operations to complete.

## Why

Every mutating API call in the frontend follows a `.catch(() => {})` fire-and-forget pattern. The user clicks a button (create window, kill session, split pane, etc.) and sees **zero visual change** until the SSE stream delivers an updated session state 100-500ms later. This creates a perception of sluggishness that is disproportionate to the actual latency — a 150ms delay feels like a broken button when there's no feedback, but feels instant with an optimistic UI update.

If we don't fix this: the app feels unresponsive despite acceptable backend performance. Users double-click buttons, question whether actions registered, and lose confidence in the tool. This is particularly bad on the "+" create window button and kill confirmation dialogs, which are the most frequent mutation paths.

The approach chosen — optimistic UI with SSE reconciliation — matches the existing architecture (SSE is already the state delivery mechanism) and avoids adding loading state management to every component individually.

## What Changes

### A. `useOptimisticAction` Hook (`app/frontend/src/hooks/use-optimistic-action.ts`)

New hook that wraps any mutating API call with immediate visual feedback and rollback on failure:

```typescript
function useOptimisticAction<T>(options: {
  action: () => Promise<T>;
  onOptimistic: () => void;      // Apply optimistic state immediately
  onRollback: () => void;        // Revert if API fails
  onError?: (error: Error) => void; // Show error toast
}): { execute: () => void; isPending: boolean }
```

- Calls `onOptimistic()` synchronously before the API call
- Sets `isPending: true` for the duration
- On API success: does nothing (SSE will reconcile real state)
- On API failure: calls `onRollback()`, then `onError()` with the error
- Replaces the `.catch(() => {})` pattern across all mutation call sites

### B. Pattern A — Optimistic Mutations with Ghost Entries

For CRUD operations that produce visible sidebar/dashboard entries:

**Create session**: Instantly insert a ghost session entry (dimmed/pulsing opacity) into the sidebar. SSE confirms and ghost becomes real. On failure: ghost removed + error toast.

**Create window**: Instantly insert a ghost window entry under the session in the sidebar. Same lifecycle.

**Create server**: Instantly insert a ghost server card on the server list page. Same lifecycle.

**Kill session**: Instantly remove the session from sidebar (fade-out or strikethrough). SSE confirms removal. On failure: entry fades back in + error toast.

**Kill window**: Same pattern as kill session, applied to window entries.

**Kill server**: Same pattern, applied to server cards.

**Rename session/window**: Instantly update the displayed name. SSE confirms. On failure: revert to old name + error toast.

Ghost entries are tracked in a React state layer (likely in `SessionProvider` or a new `OptimisticProvider` context) that merges optimistic entries with the real SSE-delivered state. When SSE delivers an update that matches the optimistic entry (by name/id), the optimistic entry is cleared.

### C. Pattern B — Button Loading States

For fire-and-forget actions that don't produce new entries:

**Split pane** (top bar buttons): Button icon swaps to a small spinner, button disabled. Restores when promise settles.

**Close pane** (top bar button): Same spinner/disabled pattern.

**Reload tmux config** (command palette): Palette action shows a brief "Reloading..." status or the palette stays open with a spinner on the item.

**Reset tmux config** (command palette): Same pattern.

These use `isPending` from `useOptimisticAction` to drive the button's disabled/spinner state.

### D. Pattern C — Inline Progress Indicators

**File upload**: Wire the existing `uploading` boolean from `use-file-upload.ts` to a visible indicator near the terminal (small progress bar or "Uploading..." badge). The hook already tracks this state — it just needs to be rendered.

**Directory autocomplete**: Show a small spinner in the trailing slot of the path input in `create-session-dialog.tsx` while directory suggestions are being fetched.

**Server list refresh**: Show a subtle spinner on the server dropdown trigger in the sidebar while re-fetching the server list.

### E. Error Toast System

A lightweight toast/notification component for surfacing errors that are currently silently swallowed. Positioned bottom-right, auto-dismiss after 3-5 seconds, supports error and info variants. Used by `useOptimisticAction`'s `onError` callback. No external dependency — a simple internal component matching the existing design system (monospace, theme-aware).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the optimistic UI patterns, ghost entry convention, and error toast system

## Impact

- **Frontend**: All mutation call sites in `app.tsx`, `sidebar.tsx`, `top-bar.tsx`, `create-session-dialog.tsx`, `server-list-page.tsx`, `terminal-client.tsx`, `use-dialog-state.ts`
- **API client**: `src/api/client.ts` — no changes (API layer stays the same, the hook wraps it)
- **Backend**: No changes — this is purely a frontend concern
- **New files**: `use-optimistic-action.ts` hook, toast component, possibly `OptimisticProvider` context
- **Testing**: Unit tests for the hook, integration tests for ghost entry reconciliation with SSE

## Open Questions

- None — the three-pattern approach and hook design were discussed and agreed in the preceding conversation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | SSE remains the source of truth for state | Constitution mandates state derived from tmux at request time; optimistic state is a UI-only overlay | S:95 R:95 A:95 D:95 |
| 2 | Certain | No backend changes required | All feedback is frontend-only — the API contract stays the same | S:90 R:95 A:95 D:95 |
| 3 | Certain | Use existing theme system for ghost/toast styling | Context.md and ui-patterns memory confirm monospace + theme-aware design system | S:90 R:90 A:95 D:90 |
| 4 | Certain | `useOptimisticAction` hook is the central abstraction | Clarified — user confirmed | S:95 R:80 A:75 D:80 |
| 5 | Certain | Ghost entries use pulsing/dimmed opacity for visual distinction | Clarified — user confirmed | S:95 R:90 A:70 D:70 |
| 6 | Certain | Error toast is a new internal component, not a library | Clarified — user confirmed | S:95 R:85 A:80 D:75 |
| 7 | Certain | Optimistic state lives in a context provider, not per-component | Clarified — user confirmed | S:95 R:75 A:70 D:65 |
| 8 | Certain | Kill operations use immediate removal (not strikethrough then remove) | Clarified — user confirmed | S:95 R:90 A:65 D:70 |
| 9 | Certain | Toast auto-dismisses after 3-5 seconds | Clarified — user chose option 1 (auto-dismiss) | S:95 R:95 A:50 D:60 |
<!-- clarified: all assumptions confirmed by user during intake review -->

9 assumptions (9 certain, 0 confident, 0 tentative, 0 unresolved).
