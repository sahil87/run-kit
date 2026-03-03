# tmux Session Enumeration

## Core Problem: Byobu Session Groups

tmux has a **session groups** feature. When byobu attaches to a session, it creates a *new tmux session in the same group* rather than attaching directly. This means `tmux list-sessions` returns both the original and derived copies:

```
devshell     grouped=1  group=devshell    ← primary
devshell-82  grouped=1  group=devshell    ← byobu-created copy
run-kit      grouped=0  group=            ← standalone (no group)
```

Grouped sessions share the same windows, so displaying both is incorrect — it shows duplicate projects in the dashboard.

## How We Filter

`listSessions()` in `src/lib/tmux.ts` fetches three format variables per session:

| Variable | Meaning |
|----------|---------|
| `#{session_name}` | The session name (e.g., `devshell-82`) |
| `#{session_grouped}` | `1` if the session belongs to ANY group, `0` otherwise |
| `#{session_group}` | The group name (e.g., `devshell`) — empty if not grouped |

**Filter rule**: keep sessions where `grouped=0` OR `name === group`.

- `devshell` → grouped=1, name=group → **keep** (primary)
- `devshell-82` → grouped=1, name≠group → **filter out** (derived copy)
- `run-kit` → grouped=0 → **keep** (standalone)

## Why `session_grouped` Alone Isn't Enough

`session_grouped=1` for ALL members of a group — including the primary session. You cannot simply filter out `grouped=1` sessions without also losing the primaries. The `name === group` check distinguishes primaries from copies.

## Byobu Behavior Details

- Byobu creates groups automatically on `byobu attach` or `byobu-tmux attach`
- The derived session name uses the pattern `{original}-{number}` (e.g., `devshell-82`)
- The number is a tmux-internal counter, not meaningful
- Multiple byobu clients attached to the same session create multiple derived copies
- All copies share the same window list — operations on windows affect all sessions in the group

## Impact on Other Operations

- `listWindows(session)` — works correctly with primary session name
- `createSession(name)` — no group involvement, creates standalone
- `killSession(session)` — kills only the named session; other group members survive but become orphaned (byobu cleans these up on disconnect)
- `sendKeys(session, window, keys)` — targets the correct window regardless of group membership

## Related Files

- `src/lib/tmux.ts` — `listSessions()` implements the filter
- `src/lib/sessions.ts` — calls `listSessions()` to build the dashboard view
