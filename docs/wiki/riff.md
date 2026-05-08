# `rk riff` — spawn agent workspaces

`rk riff` creates a git worktree, opens a new tmux window inside it, and launches one or more Claude Code panes — all in a single command. It's the primary way to start agent work in run-kit.

A "riff" is one disposable workspace: one branch, one worktree, one tmux window, one or more agent panes. Tear it down by closing the window and deleting the worktree (`wt delete`).

## Prerequisites

- You must be running inside a tmux session (`$TMUX` set).
- [`wt`](https://github.com/sahil87/wt) must be on your `PATH`.
- The launcher (`claude --dangerously-skip-permissions` by default) must be available.

The launcher can be overridden per-project via `agent.spawn_command` in `fab/project/config.yaml`.

## Quick start

```bash
rk riff                                   # 1 pane, default skill (/fab-discuss)
rk riff --skill /review                   # 1 pane, specific slash-command
rk riff --skill /fab-fff --cmd "just dev" # 2 panes (agent + dev server)
```

Open the resulting window in the browser to drive it from the run-kit UI, or stay in tmux — both work, since the agent is just a tmux pane.

## Pane array model

`--skill` and `--cmd` are repeatable. Argv order (left to right) becomes pane order (pane 0, pane 1, …). The flags can be interleaved:

```bash
rk riff --skill /a --cmd htop --skill /b --cmd "tail -f log"
# pane 0: claude /a   pane 1: htop   pane 2: claude /b   pane 3: tail
```

- **Bare `--skill`** (no value) launches a blank Claude session.
- **Bare `--cmd`** drops into `$SHELL` (fallback `/bin/sh`).

## Layouts

`--layout` controls pane arrangement. Default is `auto` (1 pane = none, 2 = even-horizontal, 3+ = tiled).

| Name | Shortform | Shape |
|------|-----------|-------|
| `auto` | `a` | pane-count-based default |
| `tiled` | `t` | grid |
| `even-horizontal` | `h` | side-by-side |
| `even-vertical` | `v` | stacked |
| `main-horizontal` | `deck-h` | main on top, deck below |
| `main-vertical` | `deck-v` | main on left, deck on right |

```bash
rk riff --skill /a --cmd x --cmd y --layout main-vertical
```

## Presets

Define common pane shapes in `fab/project/config.yaml` under `riff.presets.<name>`:

```yaml
riff:
  presets:
    ship:
      layout: main-vertical
      panes:
        - skill: /fab-fff
        - cmd: just dev
        - cmd: just test-e2e --ui
      wt_args: ["--base", "main"]
```

Invoke by name (positional or via `--preset`):

```bash
rk riff ship                # positional preset name
rk riff --preset ship       # explicit form
rk riff --list-presets      # list all defined presets
```

CLI `--skill` / `--cmd` flags **replace** the preset's panes entirely; CLI `--layout` overrides the preset's layout.

## Parallel spawning with `--count`

`-N <N>` (or `--count <N>`) creates N worktree/window pairs in parallel, each with the same pane shape:

```bash
rk riff ship --count 3      # 3 parallel ship workspaces
rk riff -N 5 --skill /fab-fff
```

Worktree names come from `wt`'s adjective-noun generator (e.g. `swift-fox`, `zippy-yak`). On any failure, successful worktrees and windows are rolled back before exit.

## Passing flags to `wt`

Anything after `--` is forwarded verbatim to `wt create`. Useful for:

```bash
rk riff -- --worktree-name pacing-canyon   # name the worktree
rk riff -- --base main                     # branch off main
rk riff -- --reuse                         # reuse an existing branch
```

Run `wt create --help` for the full passthrough flag list.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | success |
| 2 | precondition failure (`$TMUX` unset, `wt` not found) |
| 3 | subprocess failure (`wt` or `tmux` non-zero, parse failure, timeout) |

## Common patterns

```bash
# Solo planning session
rk riff --skill /fab-discuss

# Implement + watch dev server + watch tests
rk riff --skill /fab-fff --cmd "just dev" --cmd "just test-watch" --layout main-vertical

# Three parallel attempts at the same change
rk riff ship --count 3

# Investigate a bug with a shell pane handy
rk riff --skill /fab-discuss --cmd

# Branch off a specific base
rk riff --skill /fab-fff -- --base release/v2
```
