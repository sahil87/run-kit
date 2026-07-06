# Agent-State Convention (`@rk_agent_state`)

> The cross-repo contract for generic agent-lifecycle state. run-kit is the
> writer (`rk agent-setup` installs the hooks) and native reader (backend
> `internal/tmux`/`internal/sessions`); fab-kit's `fab pane send`/`pane map`
> become convention *readers* against this same option (fab-kit backlog
> `[ioku]`). This spec is the coordination point — implement against it, not
> against either repo's internals.

---

## Two-Tier Ownership

Agent status splits into two tiers with distinct owners:

- **Tier 1 — fab pipeline state** (change / stage / display-state): owned by the
  fab pipeline, read from `.status.yaml`. Stays fab's.
- **Tier 2 — generic agent-lifecycle state** (active / waiting / idle): owned by
  run-kit, carried in the `@rk_agent_state` tmux pane user option, written by
  agent-harness hooks for **any** agent (Claude, codex, copilot, gemini,
  opencode, …) in **any** directory under **any** workflow.

This inverts the previous model, where run-kit consumed a Claude-only,
fab-root-coupled `_agents` pipeline via `fab pane map`. Per constitution
**Principle X — Hooks Carry Only the Underivable**, hooks push only ephemeral
in-flight lifecycle state; everything derivable (PR links, branches, worktrees)
is derived server-side.

---

## The Option

| Property | Value |
|----------|-------|
| Name | `@rk_agent_state` |
| Scope | tmux **pane** user option (`set-option -p`) |
| Value | `"<state>:<epoch_seconds>[:<pid>]"` |
| States | `active` \| `waiting` \| `idle` |
| Example | `waiting:1751790000:48213` |

The epoch segment is **mandatory** — readers compute idle/waiting duration from
it. The pid segment is the **agent process's pid** and SHOULD be written by all
current writers (`$PPID` inside the hook's `sh -c` — the shell's parent IS the
agent); it feeds the PID-liveness reconciler (Reader rule 3). Readers MUST
tolerate its absence (legacy two-segment values). A malformed value — wrong
segment count, unknown state, non-integer epoch, or a malformed/non-positive
pid — is wholly unknown; readers never partially trust it.

### State semantics

| State | Meaning |
|-------|---------|
| `active` | A turn is in progress (the agent is working). |
| `waiting` | The agent is blocked on a **human** — a permission prompt, an elicitation/question dialog. This is the highest-urgency, most notification-worthy state. |
| `idle` | The turn is complete; the agent is at rest. |

---

## Writer Rules

Hook commands that write the option MUST:

1. **Self-locate via `$TMUX_PANE`** — the harness sets it for the pane the agent
   runs in.
2. **No-op outside tmux** — `[ -n "$TMUX_PANE" ] || exit 0` (a hook may fire when
   the agent is not inside a tmux pane).
3. **Never fail the agent** — every path exits 0 (`… 2>/dev/null || true`); a
   broken hook must never break the agent's turn.
4. **Depend on nothing but tmux** — write via plain
   `tmux set-option -pt "$TMUX_PANE" @rk_agent_state "<state>:<epoch>:<pid>"`.
   No `rk` binary and no run-kit server need be running at hook-fire time.
5. **Carry the agent pid, resolved by a comm-validated ancestor walk** — NOT
   raw `$PPID`: harnesses spawn hook commands through an *ephemeral*
   intermediate shell that exits when the hook finishes (measured with Claude
   Code — raw `$PPID` recorded that dead wrapper, so liveness suppressed every
   value). The hook walks up from `$PPID` (bounded, 3 hops) until the process
   name equals the agent's comm (a per-agent registry literal, e.g. `claude`),
   and omits the pid segment entirely if the walk cannot validate an ancestor —
   a two-segment value that degrades to the reader's legacy fallback, never a
   wrong pid. This is what lets readers trust state on *wrapped launches*,
   where `#{pane_current_command}` reads as a shell while the agent runs
   inside it.

Canonical command (state and comm are fixed registry literals; nothing
user-provided is interpolated):

```sh
sh -c '[ -n "$TMUX_PANE" ] || exit 0; p=$PPID; i=0; while [ $i -lt 3 ] && [ -n "$p" ] && [ "$(ps -o comm= -p "$p" 2>/dev/null)" != "claude" ]; do p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d " "); i=$((i+1)); done; [ "$(ps -o comm= -p "$p" 2>/dev/null)" = "claude" ] || p=""; tmux set-option -pt "$TMUX_PANE" @rk_agent_state "<state>:$(date +%s)${p:+:$p}" 2>/dev/null || true'
```

> **Migration**: updating the hook strings requires re-running `rk agent-setup`
> (idempotent — rk-owned entries are replaced in place) and **restarting agent
> sessions** (harnesses snapshot hook config at session start).

---

## Reader Rules

1. **Absent option → unknown** — render `—` (no agent, or an agent whose harness
   has no hooks installed).
2. **Duration from epoch** — readers compute idle/waiting duration from the
   epoch suffix; they MAY apply staleness heuristics on top.
3. **Reconciler** — clears stranded state from dead agents, in two forms:
   - **PID liveness (primary — pid-carrying values)**: the state is trusted iff
     the agent process is alive (`kill(pid, 0)`; `ESRCH` = dead → treat as no
     agent; `EPERM` counts as alive). The pane's command name is IRRELEVANT for
     these values — a wrapped launch (`#{pane_current_command}` = `bash` while
     the agent runs inside a non-exec'ing wrapper) reports correctly, and a
     killed/crashed agent clears precisely.
   - **Shell-command fallback (legacy two-segment values only)**: a pane whose
     `#{pane_current_command}` is a plain shell (`bash` \| `zsh` \| `fish` \|
     `sh` \| `dash`) is treated as having **no agent**, regardless of a leftover
     option value (the guppi lesson). Known false negative: wrapped launches —
     which is why the pid form is preferred.
   An Esc-interrupted agent (alive, at rest) is corrected by the hooks
   themselves (`Notification: idle_prompt` rewrites to `idle` after ~60s) — the
   reconciler's job is only the dead-process case.
4. **Window rollup** — a window with multiple panes rolls up to a single state
   with precedence `waiting > active > idle` (a split window with one waiting
   pane is a waiting window). A per-pane truth is preserved for future pane/board
   surfaces.

---

## Lifecycle

Pane options die with the pane — there is **no GC, no state file, no cross-pane
ambiguity**. An option lives on exactly one pane of exactly one tmux server.
Killing the pane (or the server) removes it.

---

## Per-Agent Event-Mapping Registry

`rk agent-setup` installs hook commands into an agent's **user-global** config so
any session of that agent reports state. It is structured as a per-agent registry
(agent name → config path + config format + event→state mapping); v1 ships
Claude Code, with codex / copilot / gemini / opencode as additive follow-ups.

### Claude Code (`~/.claude/settings.json`)

| Event | Matcher | Writes |
|-------|---------|--------|
| `UserPromptSubmit` | — | `active:<now>` |
| `PreToolUse` | — | `active:<now>` (heartbeat refresh; also covers subagent tool churn) |
| `Notification` | `permission_prompt\|elicitation_dialog\|agent_needs_input` | `waiting:<now>` |
| `Notification` | `idle_prompt` | `idle:<now>` (backstop — `Stop` does not fire on every turn-end path, e.g. Esc-interrupt) |
| `Stop` | — | `idle:<now>` |

The hooks merge into the Claude settings shape
`hooks → <Event> → [ { matcher?, hooks: [ { type: "command", command } ] } ]`.
`rk agent-setup` is idempotent (re-run replaces the rk-owned entries in place,
never duplicates, never touches non-rk hooks), shows the settings diff and asks
for confirmation before writing, and supports `--uninstall` to remove exactly
the rk-owned entries. rk-owned entries are identified by the `@rk_agent_state`
marker in the command string.
