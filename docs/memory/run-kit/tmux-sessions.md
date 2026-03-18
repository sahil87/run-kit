# tmux Session Enumeration

## Multi-Server Architecture

run-kit uses a **dedicated tmux server** named `runkit` (via `tmux -L runkit`) for sessions it creates. It also discovers sessions on the user's **default tmux server** for read-only display. `ListSessions()` queries both servers and merges the results, tagging each `SessionInfo` with a `Server` field (`"runkit"` or `"default"`).

## Session-Group Filtering

tmux has a **session groups** feature. When multiple clients attach to the same session (e.g., via byobu or `tmux attach`), tmux may create derived session-group copies. This means `tmux list-sessions` returns both the original and derived copies:

```
devshell     grouped=1  group=devshell    ← primary
devshell-82  grouped=1  group=devshell    ← derived copy
run-kit      grouped=0  group=            ← standalone (no group)
```

Grouped sessions share the same windows, so displaying both is incorrect — it shows duplicate projects in the dashboard.

## How We Filter

`parseSessions()` in `internal/tmux/tmux.go` parses three format variables per session:

| Variable | Meaning |
|----------|---------|
| `#{session_name}` | The session name (e.g., `devshell-82`) |
| `#{session_grouped}` | `1` if the session belongs to ANY group, `0` otherwise |
| `#{session_group}` | The group name (e.g., `devshell`) — empty if not grouped |

**Filter rule**: keep sessions where `grouped=0` OR `name === group`. Applied identically to both the runkit and default server results.

- `devshell` → grouped=1, name=group → **keep** (primary)
- `devshell-82` → grouped=1, name≠group → **filter out** (derived copy)
- `run-kit` → grouped=0 → **keep** (standalone)

## Why `session_grouped` Alone Isn't Enough

`session_grouped=1` for ALL members of a group — including the primary session. You cannot simply filter out `grouped=1` sessions without also losing the primaries. The `name === group` check distinguishes primaries from copies.

## Impact on Other Operations

- `ListWindows(session, server)` — accepts a `server` parameter (`"runkit"` or `"default"`) to route the query to the correct tmux server
- `CreateSession(name, cwd)` — creates sessions on the runkit server using plain `tmux new-session` (no byobu dependency). Sessions get the runkit server's custom config (`config/tmux.conf`)
- `killSession(session)` — kills only the named session on the runkit server; other group members survive
- `sendKeys(session, window, keys)` — targets the correct window on the runkit server regardless of group membership

## Related Files

- `app/backend/internal/tmux/tmux.go` — `ListSessions()` queries both servers, `parseSessions()` implements the filter, `CreateSession()` creates on the runkit server
- `app/backend/internal/sessions/sessions.go` — calls `ListSessions()` to build the dashboard view, propagates `Server` field to `ProjectSession`
- `config/tmux.conf` — tmux configuration for the runkit server (dark-themed status bar, F2/F3/F4 keybindings)

## Changelog

| Date | Change | Reference |
|------|--------|-----------|
| 2026-03-18 | Rewrote for multi-server architecture — dedicated `runkit` tmux server replaces byobu integration. `ListSessions()` queries both runkit and default servers. `parseSessions()` extracted as testable function with server tagging. `CreateSession()` uses plain `tmux new-session` (byobu dependency removed). `ListWindows()` accepts server parameter. | `260318-0gjh-dedicated-tmux-server` |
