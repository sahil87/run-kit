# Tasks: Inline Tab Rename on Double-Click

**Change**: 260318-dcl9-inline-tab-rename-double-click
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Add inline editing state and double-click handler to `app/frontend/src/components/sidebar.tsx` — add `editingWindow` state (`{ session: string; index: number } | null`), `editingName` state, `onDoubleClick` handler on the window name `<span>` at line 146 that sets editing state, and conditional rendering of a text `<input>` when editing is active (auto-focused, text selected via `inputRef.current?.select()`)
- [x] T002 Add commit and cancel handlers to `app/frontend/src/components/sidebar.tsx` — implement `handleRenameCommit` (calls `renameWindow` from `api/client.ts` if name changed and non-empty, clears editing state) and `handleRenameCancel` (clears editing state without API call). Wire `onKeyDown` (Enter → commit, Escape → cancel) and `onBlur` (commit) to the inline input

## Phase 2: Edge Cases

- [x] T003 Handle empty/whitespace input and unchanged name in `app/frontend/src/components/sidebar.tsx` — ensure `handleRenameCommit` skips the API call when input is empty/whitespace-only or identical to original name, and reverts to original name display
- [x] T004 Ensure only one edit active at a time in `app/frontend/src/components/sidebar.tsx` — when `editingWindow` changes (new double-click), the previous edit is implicitly cancelled by React re-render (old input unmounts, new one mounts)

## Phase 3: Tests

- [x] T005 Add unit tests for inline rename behavior in `app/frontend/src/components/sidebar.test.tsx` — test double-click activates input, Enter commits rename, Escape cancels, blur commits, empty input cancels, single-click navigates (no edit)

---

## Execution Order

- T001 blocks T002 (input must exist before handlers)
- T003 and T004 depend on T002
- T005 depends on all prior tasks
