# Tasks: Session Name Inline Rename

**Change**: 260405-3mt2-session-inline-rename
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [ ] T001 Add `renameSession` to the import line in `app/frontend/src/components/sidebar.tsx` (alongside existing `killSession`, `killWindow`, `renameWindow`, `moveWindow`, `moveWindowToSession`)
- [ ] T002 Add `renameSession` mock to `vi.mock("@/api/client")` in `app/frontend/src/components/sidebar.test.tsx`

## Phase 2: Core Implementation

- [ ] T003 Add session-rename state and refs to `sidebar.tsx`: `editingSession` (string | null), `editingSessionName` (string), `sessionInputRef`, `sessionCancelledRef`, `sessionOriginalNameRef`
- [ ] T004 Add `lastRenameSessionRef` and `executeRenameSession` optimistic action in `sidebar.tsx` (mirrors `executeRenameWindow` — uses `renameSession` API, `markRenamed("session", ...)`, `unmarkRenamed`, toast on error)
- [ ] T005 Add `useEffect` in `sidebar.tsx` to focus and select the session rename input when `editingSession` changes (mirrors existing window rename focus effect)
- [ ] T006 Add session rename handlers in `sidebar.tsx`: `handleStartSessionEditing`, `handleSessionRenameCommit`, `handleSessionRenameCancel`, `handleSessionRenameKeyDown`, `handleSessionRenameBlur`
- [ ] T007 Update `handleStartEditing` in `sidebar.tsx` to cross-cancel any active session edit before starting a window edit (set `sessionCancelledRef.current = true`, call `setEditingSession(null)`)
- [ ] T008 Update the session row JSX in `sidebar.tsx`: replace the static `<span className="font-medium truncate">` inside the navigation button with a conditional — when `editingSession === session.name` render `<input aria-label="Rename session">` with stopPropagation on `onClick`/`onMouseDown`; otherwise render the span with `onDoubleClick` handler

## Phase 3: Integration & Edge Cases

- [ ] T009 [P] Add `describe("inline rename session")` test suite in `sidebar.test.tsx` covering: double-click activates input; Enter commits and calls `renameSession`; Escape cancels; blur commits; empty input skips API; unchanged name skips API; double-click session B cancels session A without committing; single-click navigates without edit
- [ ] T010 [P] Verify double-click session edit cancels active window edit (and vice versa) via tests in `sidebar.test.tsx`

---

## Execution Order

- T001 must precede T004 (import needed before use)
- T002 is independent of implementation tasks — can run alongside T003-T008
- T003 must precede T004, T005, T006 (state/refs needed before handlers)
- T006 must precede T007, T008 (handlers needed before use in JSX)
- T009 and T010 require T001-T008 complete
