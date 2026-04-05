# Tasks: Ctrl+Click Force Kill Window

**Change**: 260403-d3i1-ctrl-click-force-kill-window
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 Add Ctrl/Cmd modifier check to session × button click handler in `app/frontend/src/components/sidebar.tsx` (line ~177-189). When `e.ctrlKey || e.metaKey`, call `killSessionApi(session.name).catch(() => {})` directly and return, bypassing `setKillTarget`.
- [x] T002 Add Ctrl/Cmd modifier check to window × button click handler in `app/frontend/src/components/sidebar.tsx` (line ~260-271). When `e.ctrlKey || e.metaKey`, call `killWindowApi(session.name, win.index).catch(() => {})` directly, stop propagation, and return, bypassing `setKillTarget`.

## Phase 2: Verification

- [x] T003 Run frontend type check (`cd app/frontend && npx tsc --noEmit`) to verify no type errors introduced.
- [x] T004 Run frontend tests (`just test-frontend`) to verify no regressions (pre-existing failures in themes/top-bar/tmux-commands-dialog — none related to sidebar changes).

---

## Execution Order

- T001 and T002 are independent ([P] — different click handlers in the same file)
- T003 and T004 depend on T001+T002 completion
