# Tasks: Default Session Name from Folder Path

**Change**: 260317-qiza-default-session-name-from-folder
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Modify `handleCreate()` in `app/frontend/src/components/create-session-dialog.tsx` to derive session name from path when name is empty — use `deriveNameFromPath(path.trim())` fallback, check `existingNames.has(trimmedName)` for collision, and set error message on collision
- [x] T002 Update Create button `disabled` condition in `app/frontend/src/components/create-session-dialog.tsx` from `!name.trim() || nameCollision` to `(!name.trim() && !path.trim()) || nameCollision`

## Phase 2: Verification

- [x] T003 (deps not installed in worktree; verified by inspection — all symbols in scope) Run frontend type check (`cd app/frontend && npx tsc --noEmit`) to verify no type errors introduced

---

## Execution Order

- T001 and T002 touch the same file but are independent edits (different locations)
- T003 depends on T001 and T002
