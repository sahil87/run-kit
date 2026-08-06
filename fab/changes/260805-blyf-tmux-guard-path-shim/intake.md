# Intake: tmux Guard PATH Shim

**Change**: 260805-blyf-tmux-guard-path-shim
**Created**: 2026-08-05

## Origin

> tmux PATH shim via rk agent-setup guarding kill-server without -L/-S

Conversational — created via `/fab-draft` immediately after a live post-mortem of the fabKit1 tmux-server death (2026-08-05 21:38 IST). The user asked "what other mechanisms might there be so that doesn't happen (…) any other non-prose based approach?", endorsed the PATH-shim option ("both 2 and 4 good ideas"), and asked for this intake. Key discussion decisions:

- A deterministic, **non-prose** guard is required — prose (CLAUDE.md, fab preamble, agent memory) has now failed to prevent four separate agent-caused tmux-server deaths on this box.
- The shim must cover **all harnesses** (Claude Code subagents, codex workers, raw shells), which is precisely what a Claude-Code-only PreToolUse hook cannot do — that hook is a separate, complementary mechanism outside this change's scope.
- The proven kill mechanic: tmux socket resolution is `-L`/`-S` > `$TMUX` > `TMUX_TMPDIR`. Inside a pane `$TMUX` is always set, so `TMUX_TMPDIR=… tmux kill-server` silently routes to the host server. An agent that *tried* to isolate still killed the host.

## Why

1. **Pain point**: Agents running inside run-kit-managed tmux panes keep killing the host tmux server they live in. Four documented death vectors to date; the latest (fabKit1, 2026-08-05) destroyed a 9-window operator session mid-flight, killed three active fab workers, and cost a manual forensic restore. The fatal command was `TMUX_TMPDIR=/tmp/ap2 tmux kill-server` — the agent believed `TMUX_TMPDIR` isolated it, but `$TMUX` takes precedence and routed the kill to the host.
2. **Consequence of not fixing**: Every agent that tests tmux behavior (fab-kit's own pane-dispatch work guarantees more of this) is one command away from destroying all live sessions on a server. Restores depend on luck (this one worked only because the fab operator happened to log a pane map 54s before death).
3. **Why this approach**: tmux itself has no ACL and its hooks fire after the fact — there is no server-side veto. Prose guidance is advisory and demonstrably insufficient. A PATH shim in front of the real `tmux` binary is deterministic, harness-agnostic (works for any process that spawns a shell with the user's profile), and centrally deployable/removable via run-kit's existing per-agent install surface (`rk agent-setup`).

## What Changes

### 1. New guard subcommand: `rk tmux-guard`

A new `rk` subcommand that fronts the real tmux binary:

```
rk tmux-guard [tmux args...]
```

Behavior:

- Resolve the **real** tmux binary by scanning `PATH` while skipping the shim directory itself (so the guard never recurses into its own shim).
- Parse the tmux argv far enough to detect: presence of `-L <name>` / `-S <path>` (global socket flags precede the command word in tmux grammar) and the command word(s) being invoked (including commands issued after a semicolon separator — tmux accepts `cmd ; cmd` chains, and each command in the chain is checked).
- **Block rule (v1)**: if the invocation includes a `kill-server` command and carries **no explicit `-L`/`-S`**, refuse to exec. Exit non-zero with a message that states the resolution-precedence trap and the remedy:

  ```
  rk tmux-guard: BLOCKED: `tmux kill-server` without an explicit -L/-S socket.
  Socket resolution is -L/-S > $TMUX > TMUX_TMPDIR — inside a tmux pane this
  command targets the HOST server ($TMUX), even under TMUX_TMPDIR.
  Re-run with an explicit socket:  tmux -L <scratch-name> kill-server
  Bypass (you are sure):           RK_TMUX_GUARD=off tmux kill-server
  ```

  The block applies whether or not `$TMUX` is set: a bare `kill-server` with `$TMUX` unset targets the *default* host server, which is equally destructive (the utils2 incident). Explicit `-L`/`-S` always passes — including `-L` naming the host server; the guard enforces *explicitness*, not policy.
- **Pass rule**: everything else execs the real tmux verbatim (`syscall.Exec` / `exec.CommandContext` passthrough preserving argv, stdio, and exit code). `kill-session`, `kill-window`, `kill-pane` are NOT blocked in v1 — they are scoped destructions tmux users legitimately run bare; only whole-server destruction is guarded.
- **Escape hatch**: `RK_TMUX_GUARD=off` in the environment disables the guard for that invocation (exec passthrough, no message). This keeps deliberate host-server teardown possible without uninstalling.
- Guard decision logic lives in Go with unit tests (table-driven over argvs: flags before/after command word, `;`-chained commands, `send-keys` strings containing the words `kill-server` as data — which must NOT trigger the guard since they are arguments, not command words).

### 2. Shim installation via `rk agent-setup`

`rk agent-setup` (the existing per-agent hook registry, `app/backend/cmd/rk/agent_setup.go`) gains a second managed artifact — the tmux shim:

- Write an executable shim at `~/.local/share/rk/shims/tmux` containing exactly:

  ```sh
  #!/bin/sh
  # managed-by: rk agent-setup (tmux guard shim)
  exec rk tmux-guard "$@"
  ```

- Wire `PATH` by appending a **marker-owned block** to the user's shell startup file that non-interactive shells also read (`~/.zshenv` for zsh; `~/.bash_profile`+`~/.bashrc` handling mirrors how other shll tools install):

  ```sh
  # >>> rk tmux guard >>>
  export PATH="$HOME/.local/share/rk/shims:$PATH"
  # <<< rk tmux guard <<<
  ```

  Marker-owned means: idempotent re-install (replace in place, never duplicate) and exact removal on `--uninstall` — the same contract agent-setup already implements for its settings.json hook entries.
- Same UX contract as the existing agent-setup artifacts: show a diff, ask for confirmation before writing (it mutates user-global files), `--uninstall` removes both the shim file and the PATH block.
- `rk doctor` gains a check reporting whether the shim is installed and whether `command -v tmux` actually resolves to it (detects PATH-ordering regressions).

### 3. Non-goals (v1)

- No guarding of `kill-session`/`kill-window`/`kill-pane` (scoped kills; revisit only if a real incident implicates them).
- No Claude Code PreToolUse hook — a separate, complementary mechanism with a different owner surface; may become its own change.
- No attempt to guard `tmux` invocations that bypass PATH (absolute paths like `/usr/bin/tmux`). A determined absolute-path invocation is out of scope; the shim targets the accidental case, which is empirically how all four deaths happened.

## Affected Memory

- `run-kit/tmux-guard-shim`: (new) The guard's block rule, socket-resolution precedence rationale, shim install/uninstall contract, and escape hatch.
- `run-kit/agent-state`: (modify) agent-setup is no longer a hooks-only installer — the tmux guard shim (shim file + PATH blocks) is a second managed artifact family alongside the settings hooks.

## Impact

- `app/backend/cmd/rk/` — new `tmux_guard.go` (+ tests); `agent_setup.go` extended with the shim artifact (+ tests); `doctor.go` check.
- `~/.local/share/rk/shims/` and `~/.zshenv` (user machines, via agent-setup install).
- Constitution §I (Security First): guard runs the real tmux via exec with an argument slice — no shell string construction; the shim script itself contains nothing user-interpolated.
- No API, frontend, or daemon changes. No new routes.

## Open Questions

- Should `rk riff` / rk-spawned agent panes get the shim PATH prepended directly (pane-level env) so protection doesn't depend on the user's shell profile being read?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Guard is a PATH shim + `rk tmux-guard` Go subcommand, installed/removed by `rk agent-setup` | Discussed — user chose this option explicitly over prose approaches; agent-setup is the established managed-artifact surface | S:90 R:85 A:90 D:90 |
| 2 | Confident | Block only `kill-server` lacking `-L`/`-S`; scoped kills (session/window/pane) pass in v1 | All four incidents were whole-server kills; scoped kills are routine and blocking them would cause false positives | S:70 R:90 A:80 D:70 |
| 3 | Confident | Block applies regardless of `$TMUX` (bare kill-server with $TMUX unset hits the default host server) | utils2 incident shape; enforcing explicitness is simpler and safer than env-conditional logic | S:65 R:90 A:85 D:75 |
| 4 | Confident | Escape hatch is `RK_TMUX_GUARD=off` per-invocation env var | Deliberate teardown must stay possible; env-var bypass is the conventional shape | S:60 R:95 A:85 D:80 |
| 5 | Tentative | PATH wiring via marker-owned block in `~/.zshenv` (read by non-interactive zsh) | Covers agent Bash tools that skip `.zshrc`; exact file-per-shell matrix needs verification during apply | S:50 R:80 A:55 D:45 |
| 6 | Tentative | `send-keys`/string arguments containing "kill-server" as data must not trigger the guard; parser distinguishes command words from argument strings | Correctness requirement inferred from tmux grammar; parsing depth is an implementation judgment | S:45 R:85 A:60 D:55 |

6 assumptions (1 certain, 3 confident, 2 tentative, 0 unresolved).
