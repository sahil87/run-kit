# Tasks: Rename Action + Kill Label Cleanup

**Change**: 260307-r3yv-action-buttons-rename-kill
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Backend

- [x] T001 [P] Add `renameWindow(session, index, name)` to `src/lib/tmux.ts` — wraps `tmux rename-window -t {session}:{index} {name}` via `tmuxExec`
- [x] T002 [P] Add `renameWindow` action case to `POST /api/sessions` in `src/app/api/sessions/route.ts` — validate session, index, name; call `renameWindow`; import the new function

## Phase 2: UI — Terminal Page

- [x] T003 Change kill button label from `"Kill Window"` to `"Kill"` in `src/app/p/[project]/[window]/terminal-client.tsx` (line 2 left slot)
- [x] T004 Change kill palette action label from `"Kill this window"` to `"Kill window"` in `src/app/p/[project]/[window]/terminal-client.tsx` (paletteActions array)
- [x] T005 Add rename state (`showRenameDialog`, `renameName`), rename handler, rename dialog, and "Rename" button to Line 2 left in `src/app/p/[project]/[window]/terminal-client.tsx` — pre-fill with `windowName`, auto-select, Enter to submit, focus terminal after close
- [x] T006 Add `"Rename window"` palette action with shortcut `r` to terminal page paletteActions in `src/app/p/[project]/[window]/terminal-client.tsx`

## Phase 3: UI — Project Page

- [x] T007 Add rename state (`showRenameDialog`, `renameTarget`, `renameName`), rename handler, and rename dialog to `src/app/p/[project]/project-client.tsx` — pre-fill with focused window name, auto-select, Enter to submit
- [x] T008 Add "Rename" button to Line 2 left slot in `src/app/p/[project]/project-client.tsx` — disabled when no windows, same styling as "Send Message" button
- [x] T009 Add `"Rename focused window"` palette action with shortcut `r` to project page paletteActions, and add `r` to shortcuts map in `src/app/p/[project]/project-client.tsx`

---

## Execution Order

- T001 and T002 are parallel (T002 depends on T001 being importable, but both are small — do T001 first)
- T003, T004 are independent label changes — can run with T005/T006
- T005 blocks T006 (state must exist before palette action references it)
- T007 blocks T008 and T009 (state and handler must exist first)
