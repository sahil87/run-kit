# Tasks: Copy tmux Attach Command

**Change**: 260327-k4l2-copy-tmux-attach-command
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Add "Copy: tmux Attach Command" palette action to the `currentWindow` conditional block in `app/frontend/src/app.tsx` — ID `copy-tmux-attach`, label `Copy: tmux Attach Command`, constructs `tmux attach-session -t {sessionName}:{currentWindow.name}` and copies via `navigator.clipboard.writeText().catch(() => {})`

## Phase 2: Tests

- [x] T002 Add test in `app/frontend/src/components/command-palette.test.tsx` verifying the "Copy: tmux Attach Command" action appears when a window is selected and copies the correct tmux command to clipboard

---

## Execution Order

- T001 blocks T002
