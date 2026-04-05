# Quality Checklist: Dedicated Tmux Server

**Change**: 260318-0gjh-dedicated-tmux-server
**Generated**: 2026-03-18
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Dedicated tmux server: all tmuxExec/tmuxExecRaw calls prepend `-L runkit`
- [x] CHK-002 Config file: `-f <RK_TMUX_CONF>` included when env var is set
- [x] CHK-003 Config file: `-f` omitted when RK_TMUX_CONF is unset/empty
- [x] CHK-004 tmux.conf: file exists at `config/tmux.conf` with status bar, keybindings, mouse, 256color
- [x] CHK-005 Multi-server listing: ListSessions queries both runkit and default servers
- [x] CHK-006 Default server query: uses raw exec without `-L` flag
- [x] CHK-007 SessionInfo: `Server string` field replaces `Byobu bool`
- [x] CHK-008 ProjectSession (Go): `Server string` replaces `Byobu bool`
- [x] CHK-009 ProjectSession (TS): `server: "runkit" | "default"` replaces `byobu: boolean`
- [x] CHK-010 Sidebar: byobu "b" marker removed
- [x] CHK-011 Sidebar: `↗` marker shown for default-server sessions
- [x] CHK-012 Sidebar: no marker for runkit sessions
- [x] CHK-013 CreateSession: byobu dependency removed, always uses tmux via runkit server
- [x] CHK-014 Relay: attach command includes `-L runkit`
- [x] CHK-015 RK_TMUX_CONF: defined in `.env`

## Behavioral Correctness
- [x] CHK-016 ListSessions returns sessions from both servers with correct Server field values
- [x] CHK-017 Default server not running: ListSessions returns only runkit sessions (no error)
- [x] CHK-018 Runkit server not running: ListSessions returns only default sessions (no error)
- [x] CHK-019 Session group filtering still works for default-server byobu groups

## Removal Verification
- [x] CHK-020 `hasByobu` sync.OnceValue removed from tmux.go
- [x] CHK-021 `exec.LookPath("byobu")` call removed
- [x] CHK-022 Byobu branch in CreateSession removed
- [x] CHK-023 `Byobu bool` field removed from SessionInfo and ProjectSession (Go)
- [x] CHK-024 `byobu: boolean` field removed from ProjectSession (TS)
- [x] CHK-025 Green "b" marker JSX removed from sidebar.tsx

## Scenario Coverage
- [x] CHK-026 parseSessions tests verify Server field for both "runkit" and "default"
- [x] CHK-027 Multi-server merge test: sessions from both servers in result
- [x] CHK-028 Sidebar test: external session shows ↗ marker
- [x] CHK-029 Sidebar test: runkit session shows no marker
- [x] CHK-030 MSW handlers use `server` field instead of `byobu`

## Edge Cases & Error Handling
- [x] CHK-031 RK_TMUX_CONF empty/unset: tmux commands work with only `-L runkit`
- [x] CHK-032 Both servers down: ListSessions returns empty (no panic)

## Code Quality
- [x] CHK-033 Pattern consistency: new code follows exec.CommandContext + argument slices pattern
- [x] CHK-034 No unnecessary duplication: tmuxExecDefault reuses parsing logic from tmuxExec
- [x] CHK-035 All exec.CommandContext calls include context with timeout
- [x] CHK-036 No shell string construction for tmux commands
- [x] CHK-037 No magic strings — server names use named constants or clear literals

## Security
- [x] CHK-038 RK_TMUX_CONF path not passed through shell — used only as exec argument
- [x] CHK-039 All new exec.CommandContext calls use argument slices (not shell strings)

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
