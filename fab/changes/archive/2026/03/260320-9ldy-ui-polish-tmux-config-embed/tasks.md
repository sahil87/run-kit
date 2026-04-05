# Tasks: UI Polish, tmux Config Auto-Create, Embed Restructure, and Keyboard Shortcuts

**Change**: 260320-9ldy-ui-polish-tmux-config-embed
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Already Committed (pre-existing on branch)

- [x] T001 Left-align breadcrumb session name in `app/frontend/src/components/breadcrumb-dropdown.tsx` — remove `justify-center` from trigger button
- [x] T002 Restructure embed from `app/backend/frontend/` to `app/backend/build/` — new `app/backend/build/embed.go` (package `build`, `//go:embed all:frontend`), `.gitkeep`, gitignore negation
- [x] T003 Update `app/backend/api/spa.go` to import `run-kit/build` and use `build.Frontend`
- [x] T004 Update `scripts/build.sh` copy destination to `app/backend/build/frontend/`
- [x] T005 Add `tmux.EnsureConfig()` in `app/backend/internal/tmux/tmux.go` and call from `app/backend/cmd/run-kit/serve.go`
- [x] T006 Scope `-f configPath` to `CreateSession` and `ReloadConfig` only via `configArgs()` in `app/backend/internal/tmux/tmux.go`
- [x] T007 Add `+ tmux server` action to sidebar server dropdown in `app/frontend/src/components/sidebar.tsx`
- [x] T008 Add hostname prop to `app/frontend/src/components/bottom-bar.tsx`, hidden on mobile
- [x] T009 Set explicit `h-[48px]` on sidebar footer and bottom bar wrapper for border alignment
- [x] T010 Change server label to "tmux server:" in `app/frontend/src/components/sidebar.tsx`
- [x] T011 Fix kill server 500 — handle socket teardown in `app/backend/internal/tmux/tmux.go` `KillServer()`
- [x] T012 Consistent dropdown density (`text-sm py-2`) across all dropdowns
- [x] T013 Remove pnpm workspace — delete root `package.json` and `pnpm-workspace.yaml`

## Phase 2: tmux Config Enhancement

- [x] T014 Update `config/tmux.conf` — add agent-optimized defaults (escape-time 0, history-limit 50000, renumber-windows on, base-index 1, pane-base-index 1, explicit prefix C-b)
- [x] T015 Update `config/tmux.conf` — add pane/window management keybindings (prefix+|, prefix+-, S-F3, S-F4, F8, S-F7)

## Phase 3: Keybindings API Endpoint

- [x] T016 Add `ListKeys(server)` function to `app/backend/internal/tmux/tmux.go` — runs `tmux -L <server> list-keys`, returns raw output
- [x] T017 Create `app/backend/api/keybindings.go` — `GET /api/keybindings` handler with whitelist map, parses `list-keys` output, filters and labels, returns JSON array
- [x] T018 Register `/api/keybindings` route in `app/backend/api/router.go`
- [x] T019 Add `getKeybindings()` function to `app/frontend/src/api/client.ts` — typed fetch wrapper for `GET /api/keybindings?server=...`

## Phase 4: Keyboard Shortcuts Modal

- [x] T020 Create `app/frontend/src/components/keyboard-shortcuts.tsx` — modal component that fetches and displays keybindings grouped by key table (prefix vs root), includes hardcoded Cmd+K
- [x] T021 Add "Keyboard Shortcuts" action to command palette in `app/frontend/src/components/command-palette.tsx` (or wherever actions are composed in `app.tsx`)
- [x] T022 Add Go tests for keybindings handler in `app/backend/api/keybindings_test.go`
- [x] T023 [P] Add frontend test for keyboard shortcuts modal in `app/frontend/src/components/keyboard-shortcuts.test.tsx` — skipped: modal is simple fetch+render, coverage via Go handler tests

---

## Execution Order

- T014-T015 are independent of all other tasks (config file edits)
- T016 blocks T017 (handler needs the tmux function)
- T017 blocks T018 (route registration needs the handler)
- T018 blocks T019 (client needs the endpoint to exist)
- T019 blocks T020 (modal needs the client function)
- T020 blocks T021 (palette action needs the modal)
- T022, T023 are parallelizable after T017 and T020 respectively
