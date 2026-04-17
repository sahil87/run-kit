# Intake: Add rk riff Command

**Change**: 260416-r1j6-add-riff-command
**Created**: 2026-04-16
**Status**: Draft

## Origin

> User currently has `riff` and `riffs` as shell functions that compose three tools (wt, tmux, clauded) into a "spin up an isolated AI workspace in one shot" launcher. Wants to incorporate these into run-kit as proper `rk` subcommands, making them distributable and discoverable.

Discussion in a separate fab-kit session evaluated four placement options (`rk`, `fab`, `wt`, keep as shell functions). Consensus: `rk` is the strongest fit because rk already owns the tmux window lifecycle — `riff` is fundamentally "create a tmux window with the right setup."

## Why

Today `riff` and `riffs` are shell functions defined in the user's personal dotfiles. They compose three tools into a powerful one-liner: create a git worktree → open a tmux window in it → launch a Claude Code session with a command.

This workflow is the primary way the user starts new AI development sessions, but:
1. **Not distributable** — lives in personal dotfiles, not available to other run-kit users
2. **Not discoverable** — `rk --help` doesn't show it, new users won't find it
3. **Not composable** — shell functions can't leverage rk's existing server, SSE reactivity, or iframe capabilities
4. **Fragile** — relies on `clauded` alias and specific `wt` flags that may change

Making this a proper `rk` subcommand makes the "spin up an AI workspace" workflow a first-class citizen of the run-kit toolkit.

## What Changes

### 1. New subcommand: `rk riff`

Creates a worktree, opens a new tmux window, and launches a Claude Code session.

**Current shell function** (reference implementation):
```sh
riff() {
  local cmd="${1:-/fab-discuss}"
  shift 2>/dev/null
  local output wt_path
  output=$(wt create --non-interactive --worktree-open skip "$@" 2>&1)
  wt_path=$(echo "$output" | grep '^Path:' | cut -d' ' -f2)
  [[ -n "$wt_path" && -d "$wt_path" ]] || { echo "$output"; return 1; }
  tmux new-window -c "$wt_path" "clauded '$cmd'"
}
```

**Proposed `rk riff` behavior**:
```
rk riff [--cmd <command>] [--split <setup-cmd>] [-- <wt-flags...>]
```

| Flag | Default | Purpose |
|------|---------|---------|
| `--cmd <command>` | `/fab-discuss` | Claude Code command/skill to launch with |
| `--split <setup-cmd>` | *(none)* | If provided, split the window and run this command in the right pane (replaces `riffs`) |
| `-- <wt-flags>` | *(none)* | Passthrough flags to `wt create` (e.g., `--worktree-name`, `--base`, `--reuse`) |

Steps:
1. Run `wt create --non-interactive --worktree-open skip [wt-flags...]` to create a worktree
2. Parse the `Path:` line from wt output to get the worktree path
3. Open a tmux window: `tmux new-window -c <path> "clauded '<cmd>'"`
4. If `--split` provided: `tmux split-window -h -c <path> "<setup-cmd>; exec zsh"`

This unifies `riff` and `riffs` into a single command — `rk riff` is the basic version, `rk riff --split "just setup"` is the split version.

### 2. Dependencies

- **`wt`** — must be available on PATH (run-kit already documents wt as a companion tool)
- **`clauded`** — the Claude Code launcher script. Should be configurable or discoverable (e.g., fall back to `claude --dangerously-skip-permissions` if `clauded` not found)
- **`tmux`** — required (rk already depends on tmux)

## Affected Memory

- To be determined based on run-kit's memory structure

## Impact

- **`rk` CLI**: New subcommand added to the command registry
- **Dependencies**: Requires `wt` and `clauded` (or `claude`) on PATH
- **Existing shell functions**: Users can remove their `riff`/`riffs` shell functions after adopting `rk riff`

## Open Questions

- Should `rk riff` auto-detect the Claude launcher (`clauded` → `claude --dangerously-skip-permissions` → `claude`) or require explicit configuration?
- Should the default `--cmd` be configurable (e.g., in a `.rk-config.yaml` or similar)?
- Should `rk riff` work without `wt` by falling back to `git worktree add` directly?
- What happens if not inside a tmux session? Error, or auto-start tmux?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `rk` is the home for riff, not `fab` or `wt` | Discussed — rk owns tmux window lifecycle, riff creates tmux windows | S:95 R:85 A:90 D:95 |
| 2 | Certain | Unify `riff` and `riffs` into single `rk riff` command with `--split` flag | Discussed — `riffs` is just `riff` + split pane, single command is cleaner | S:90 R:85 A:85 D:90 |
| 3 | Confident | Default command is `/fab-discuss` | Matches current shell function default; reasonable starting point | S:75 R:90 A:75 D:70 |
| 4 | Confident | wt passthrough via `--` separator | Standard CLI pattern for forwarding flags to sub-tools | S:70 R:85 A:80 D:75 |
| 5 | Tentative | `clauded` as the default launcher with fallback chain | User currently uses `clauded` but other users may not have it; needs fallback strategy | S:50 R:70 A:50 D:45 |
| 6 | Unresolved | Configuration mechanism for defaults (cmd, launcher) | Multiple valid approaches: env vars, config file, flags only — user preference needed | S:30 R:60 A:30 D:25 |

6 assumptions (2 certain, 2 confident, 1 tentative, 1 unresolved). Run /fab-clarify to review.
