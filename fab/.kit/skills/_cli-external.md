---
name: _cli-external
description: "External CLI tool reference — wt (worktree manager), tmux, and /loop. Loaded by operator skills only."
user-invocable: false
disable-model-invocation: true
metadata:
  internal: true
---
# External CLI Tool Reference

> Loaded by operator skills only (not part of the always-load layer). Documents non-fab CLI tools used for multi-agent coordination.

---

## wt (Worktree Manager)

`wt` manages git worktrees for parallel development. Binary at `fab/.kit/bin/wt`.

### Commands

| Command | Usage | Purpose |
|---------|-------|---------|
| `list` | `fab/.kit/bin/wt list` | List all worktrees: names, branches, paths |
| `list --path` | `fab/.kit/bin/wt list --path <name>` | Check if a worktree exists. Exit 0 = exists (prints path), exit 1 = not found |
| `create` | `fab/.kit/bin/wt create --non-interactive [flags] [branch]` | Create a new worktree (see flags below) |
| `delete` | `fab/.kit/bin/wt delete <name>` | Delete a worktree. Destructive — confirm first |

### `wt create` Flags

| Flag | Purpose |
|------|---------|
| `--non-interactive` | Required for operator use — suppresses prompts |
| `--worktree-name <name>` | Override the auto-generated worktree directory name |
| `--reuse` | Reuse an existing worktree if one matches. Useful for autopilot respawns |
| `--base <ref>` | Branch from a specific ref instead of the default. Used for sequenced autopilot (branch from prior change) |
| `[branch]` | Positional — the git branch to create/checkout in the worktree |

**Example — known change**: `fab/.kit/bin/wt create --non-interactive --worktree-name <name> <change-folder-name>`
**Example — autopilot respawn**: `fab/.kit/bin/wt create --non-interactive --reuse --worktree-name <name> <branch> --base <prev-change>`

---

## tmux

Terminal multiplexer commands used by the operator for agent observation and interaction.

### Commands

| Command | Usage | Purpose |
|---------|-------|---------|
| `capture-pane` | `tmux capture-pane -t <pane> -p [-l N]` | Capture terminal output. `-p` prints to stdout. `-l N` limits to last N lines |
| `send-keys` | `tmux send-keys -t <pane> "<text>" Enter` | Send keystrokes to a pane. Always validate pane exists + agent idle first |
| `new-window` | `tmux new-window -n <name> -c <dir> "<cmd>"` | Open a new tmux tab with a command running in a specific directory |

### Usage Notes

- **`capture-pane -l 20`** is the standard capture window for question detection (wide enough to handle line wrapping and verbose preambles)
- **`send-keys`** requires pre-send validation: pane must exist and agent must be idle. Sending to a busy agent risks corrupting its work
- **`new-window`** is used for spawning new agent sessions: `tmux new-window -n "fab-<id>" -c <worktree> "claude --dangerously-skip-permissions '<command>'"`

---

## /loop

Recurring check skill — invokes a prompt at a regular interval.

### Usage

```
/loop <interval> "<prompt>"
```

- **`<interval>`** — duration between ticks (e.g., `5m`, `2m`)
- **`<prompt>`** — the instruction to execute on each tick

### Constraints

- **One loop at a time** — there SHALL be at most one active `/loop` in a session
- **Start**: when the first change is enrolled in monitoring and no loop is running
- **Stop**: when the monitored set becomes empty, or on explicit user command
- **Autopilot override**: autopilot uses its own cadence (default 2m); replaces any existing monitoring loop
