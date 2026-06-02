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
1. Validate preconditions: `wt` must be on PATH and `$TMUX` must be set; error out otherwise.
2. Resolve the launcher from `agent.spawn_command` in `fab/project/config.yaml` (same resolution as `fab operator`; falls back to `claude --dangerously-skip-permissions` if the key is absent).
3. Run `wt create --non-interactive --worktree-open skip [wt-flags...]` to create a worktree.
4. Parse the `Path:` line from wt output to get the worktree path.
5. Open a tmux window: `tmux new-window -c <path> "<spawn_command> '<cmd>'"`
6. If `--split` provided: `tmux split-window -h -c <path> "<setup-cmd>; exec zsh"`

This unifies `riff` and `riffs` into a single command — `rk riff` is the basic version, `rk riff --split "just setup"` is the split version.

### 2. Dependencies

- **`wt`** — REQUIRED on PATH; `rk riff` errors out with a clear message if missing. Aligns with constitution's "Wrap, Don't Reinvent" — rk does not fall back to `git worktree add`. <!-- clarified: wt is required; no git-worktree fallback -->
- **`tmux`** — REQUIRED; `rk riff` errors out if `$TMUX` is unset. Matches `fab operator` behavior. <!-- clarified: must run inside tmux; no auto-start -->
- **Launcher** — resolved from `agent.spawn_command` in `fab/project/config.yaml`, falling back to `claude --dangerously-skip-permissions`. No `clauded` dependency; matches `fab operator`. <!-- clarified: launcher reuses agent.spawn_command -->
- **Default `--cmd`** — hardcoded to `/fab-discuss`; overridable via `--cmd` flag. No config key for the default. <!-- clarified: hardcoded default, flag override only -->

## Affected Memory

- `docs/memory/run-kit/architecture.md` (modify) — add `rk riff` to the command registry / subcommand list.
- `docs/memory/run-kit/tmux-sessions.md` (modify) — document `rk riff`'s window-creation flow alongside existing session semantics.
- `docs/memory/run-kit/rk-riff.md` (new) — dedicated file for the `rk riff` subcommand: flags, defaults resolution, dependency chain, error cases.

## Impact

- **`rk` CLI**: New subcommand added to the command registry
- **Dependencies**: Requires `wt` and `tmux` on PATH; launcher resolved from `agent.spawn_command` (fab/project/config.yaml)
- **Existing shell functions**: Users can remove their `riff`/`riffs` shell functions after adopting `rk riff`

## Open Questions

*(All open questions resolved in 2026-04-17 clarification session — see `## Clarifications` below.)*

## Clarifications

### Session 2026-04-17

| # | Question | Answer |
|---|----------|--------|
| 1 | Config model for launcher binary and default `--cmd`? | Reuse `agent.spawn_command` from `fab/project/config.yaml` for the launcher (same as `fab operator`). Hardcode `/fab-discuss` as the default `--cmd`, overridable via flag. No new config keys. |
| 2 | What should `rk riff` do when `wt` is not on PATH? | Error out. Require `wt` — aligns with constitution's "Wrap, Don't Reinvent". No fallback to `git worktree add`. |
| 3 | What should `rk riff` do when `$TMUX` is unset? | Error out. Matches `fab operator` behavior — no auto-start, no detached launch. |
| 4 | Which memory files does the hydrate stage touch? | Modify `run-kit/architecture.md` and `run-kit/tmux-sessions.md`; create new `run-kit/rk-riff.md` for the subcommand reference. |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `rk` is the home for riff, not `fab` or `wt` | Discussed — rk owns tmux window lifecycle, riff creates tmux windows | S:95 R:85 A:90 D:95 |
| 2 | Certain | Unify `riff` and `riffs` into single `rk riff` command with `--split` flag | Discussed — `riffs` is just `riff` + split pane, single command is cleaner | S:90 R:85 A:85 D:90 |
| 3 | Certain | Default `--cmd` is `/fab-discuss` (hardcoded, overridable via flag) | Clarified — user confirmed hardcoded default, no config surface | S:95 R:90 A:75 D:70 |
| 4 | Confident | wt passthrough via `--` separator | Standard CLI pattern for forwarding flags to sub-tools | S:70 R:85 A:80 D:75 |
| 5 | Certain | Launcher resolved from `agent.spawn_command` in `fab/project/config.yaml` (falls back to `claude --dangerously-skip-permissions`) | Clarified — user confirmed; matches `fab operator`, honors Convention Over Configuration | S:95 R:70 A:50 D:45 |
| 6 | Certain | Config mechanism: reuse existing `agent.spawn_command`; no new config keys; flag-only overrides for `--cmd` and `--split` | Clarified — user confirmed | S:95 R:60 A:30 D:25 |
| 7 | Certain | Require `wt` on PATH; error out if missing (no `git worktree add` fallback) | Clarified — user confirmed; "Wrap, Don't Reinvent" | S:95 R:80 A:85 D:90 |
| 8 | Certain | Require `$TMUX` to be set; error out if not in a tmux session | Clarified — user confirmed; matches `fab operator` | S:95 R:85 A:90 D:95 |
| 9 | Certain | Affected memory: modify `run-kit/architecture.md` + `run-kit/tmux-sessions.md`; add new `run-kit/rk-riff.md` | Clarified — user selected all three | S:95 R:75 A:75 D:80 |

9 assumptions (8 certain, 1 confident, 0 tentative, 0 unresolved).
