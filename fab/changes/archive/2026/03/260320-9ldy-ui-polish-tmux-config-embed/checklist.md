# Quality Checklist: UI Polish, tmux Config, Embed Restructure, and Keyboard Shortcuts

**Change**: 260320-9ldy-ui-polish-tmux-config-embed
**Generated**: 2026-03-20
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Breadcrumb left-alignment: Session names truncate from the right, not center-cropped
- [ ] CHK-002 Embed restructure: `app/backend/build/embed.go` exists with package `build` and `//go:embed all:frontend`
- [ ] CHK-003 SPA handler: `api/spa.go` imports `run-kit/build` and uses `build.Frontend`
- [ ] CHK-004 Build script: copies to `app/backend/build/frontend/`
- [ ] CHK-005 Config auto-create: `EnsureConfig()` writes default config if missing, no-op if exists
- [ ] CHK-006 Config flag scoping: `-f` only in `CreateSession` and `ReloadConfig`, not in `serverArgs()`
- [ ] CHK-007 Server dropdown: `+ tmux server` action appears at top of sidebar server dropdown
- [ ] CHK-008 Hostname: displayed in bottom bar, hidden on mobile via `hidden sm:inline`
- [ ] CHK-009 Border alignment: sidebar footer and bottom bar both use `h-[48px]`
- [ ] CHK-010 Server label: reads "tmux server:" (lowercase tmux)
- [ ] CHK-011 Kill server: `KillServer()` returns nil when socket disappears during kill
- [ ] CHK-012 Dropdown density: all dropdowns use `text-sm py-2`
- [ ] CHK-013 tmux config: escape-time 0, history-limit 50000, renumber-windows on, base-index 1, pane-base-index 1, prefix C-b
- [ ] CHK-014 tmux keybindings: prefix+|, prefix+-, S-F3, S-F4, F8, S-F7 present in config
- [ ] CHK-015 Keybindings endpoint: `GET /api/keybindings` returns filtered JSON with label, key, table, command
- [ ] CHK-016 Keyboard shortcuts modal: opens from command palette, shows grouped bindings
- [ ] CHK-017 Keybindings whitelist: only whitelisted commands appear in response (no built-in prefix bindings leak)

## Behavioral Correctness

- [ ] CHK-018 Config flag: `ListSessions`, `ListWindows`, `KillServer` do NOT include `-f` in arguments
- [ ] CHK-019 Keybindings: prefix-table bindings display as "Ctrl+B, <key>", root-table as "<key>"
- [ ] CHK-020 Modal fetch: each open triggers a fresh `GET /api/keybindings` (no caching)

## Scenario Coverage

- [ ] CHK-021 Fresh worktree: `go build ./cmd/run-kit` succeeds with only `.gitkeep` in embed dir
- [ ] CHK-022 First run: `EnsureConfig()` creates `~/.run-kit/tmux.conf` from embedded default
- [ ] CHK-023 Subsequent run: `EnsureConfig()` preserves existing config file
- [ ] CHK-024 No tmux server: `GET /api/keybindings` returns empty array, not error
- [ ] CHK-025 Shortcuts modal: includes hardcoded `Cmd+K` entry alongside tmux bindings

## Edge Cases & Error Handling

- [ ] CHK-026 Stale socket: kill server handles dead socket without 500
- [ ] CHK-027 list-keys failure: keybindings handler returns empty array on tmux error

## Code Quality

- [ ] CHK-028 Pattern consistency: keybindings handler follows existing handler patterns (chi router, `serverFromRequest`, JSON response)
- [ ] CHK-029 No unnecessary duplication: `ListKeys()` uses existing `tmuxExecServer()` helper
- [ ] CHK-030 Subprocess safety: `ListKeys` uses `exec.CommandContext` with argument slices and timeout
- [ ] CHK-031 No shell strings: no `sh -c` or template string construction in new code

## Security

- [ ] CHK-032 Server param validation: `?server=` validated via `serverFromRequest()` before passing to tmux

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
