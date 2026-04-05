# Tasks: Tmux Commands Dialog

**Change**: 260328-6xey-tmux-commands-dialog
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Create `app/frontend/src/components/tmux-commands-dialog.tsx` with component skeleton — accept props `server`, `session`, `window`, `onClose`; render `Dialog` wrapper with title "tmux commands"

## Phase 2: Core Implementation

- [x] T002 Implement command generation logic in `tmux-commands-dialog.tsx` — build three commands (attach, new-window, detach) with conditional `-L {server}` flag when server is not `"default"`
- [x] T003 Implement command row UI in `tmux-commands-dialog.tsx` — label, bordered code block, and copy icon button per command. Copy via `navigator.clipboard.writeText` with `.catch(() => {})`
- [x] T004 Implement copy feedback in `tmux-commands-dialog.tsx` — checkmark icon swap on successful copy with ~1.5s timeout (useState + setTimeout, cleanup on unmount)

## Phase 3: Integration

- [x] T005 Wire dialog into `app/frontend/src/app.tsx` — add `showTmuxCommands` useState boolean, update `copy-tmux-attach` command palette action to set it true with label "Copy: tmux Commands", render `TmuxCommandsDialog` conditionally, add to `dialogOpenRef` check
- [x] T006 Add unit tests in `app/frontend/src/components/tmux-commands-dialog.test.tsx` — verify named server commands include `-L`, default server commands omit `-L`, three rows render, copy button calls clipboard API

---

## Execution Order

- T001 blocks T002-T004
- T002, T003, T004 can be done sequentially within the component
- T005 depends on T001-T004
- T006 depends on T001-T004
