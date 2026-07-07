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
current writers (resolved inside the `rk agent-hook` binary via the
comm-validated ancestor walk of Writer rule 5 — never raw `$PPID`, which records
the harness's ephemeral hook-wrapper shell, not the agent); it feeds the
PID-liveness reconciler (Reader rule 3). Readers MUST
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
4. **Never require the run-kit *server*, and never fail or block the agent** —
   the hook body SHOULD be the stable `rk agent-hook` interface (a thin wrapper
   installed into harness config; all logic lives in the rk binary). The
   `@rk_agent_state` write happens inside the binary via
   `tmux set-option -pt "$TMUX_PANE" @rk_agent_state "<state>:<epoch>[:<pid>]"`;
   no run-kit **server** need be running at hook-fire time. *(The earlier form
   of this rule banned the rk **binary** too — "depend on nothing but tmux",
   written in reaction to the old `fab hook` model that died outside a fab root.
   That ban is **lifted**: the rule's real intent — hooks must never fail,
   block, or slow the agent, and must not require the run-kit server — is
   preserved, but the logic now living in the binary is what lets a hook fix
   reach running agents on `brew upgrade rk` with no settings churn and no
   session restarts. Rationale: hook logic was formerly frozen twice — once in
   `~/.claude/settings.json` at install time, once in the harness's
   session-start snapshot — so the #320 PID-liveness reconciler and the frozen
   pid-writing hook skewed between #320 and #321 and suppressed agent state
   fleet-wide. Delegating to the binary removes that freeze.)* If the binary is
   missing at fire time the hook is a silent no-op (the wrapper's trailing
   `|| true`) — acceptable, because the PID-liveness reconciler already clears
   state from dead agents and a stranded value clears when the agent/pane dies.
5. **Carry the agent pid, resolved by a comm-validated ancestor walk in the
   binary** — NOT raw `$PPID`: harnesses spawn hook commands through an
   *ephemeral* intermediate shell that exits when the hook finishes (measured
   with Claude Code — raw `$PPID` recorded that dead wrapper, so liveness
   suppressed every value). `rk agent-hook` walks up from `getppid()` (bounded,
   **5 hops** — the delegation adds a wrapper layer: `claude → hook shell →
   sh -c → rk`, and `sh` may or may not exec the final command) until the
   process name equals the agent's comm (a per-agent registry literal selected
   by `--agent`, e.g. `claude`), and omits the pid segment entirely if the walk
   cannot validate an ancestor — a two-segment value that degrades to the
   reader's legacy fallback, never a wrong pid. This is what lets readers trust
   state on *wrapped launches*, where `#{pane_current_command}` reads as a shell
   while the agent runs inside it.

Canonical command — the stable delegating wrapper installed by `rk agent-setup`
(state and comm are fixed registry literals; nothing user-provided is
interpolated; `<abs-rk>` is the absolute rk path resolved at install time, a
stable symlink rather than a version-pinned path):

```sh
sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<abs-rk>" agent-hook --agent claude <state> 2>/dev/null || true'
```

All logic — the comm-validated ancestor walk, the value formatting, the
`tmux set-option` write — lives in `rk agent-hook`, which always exits 0 on
every path (a hook must never fail or block the agent; Claude Code reads a
non-zero hook exit as a warning and exit code 2 as blocking). The subcommand
targets the pane's own tmux server via the socket captured from `$TMUX` before
the process strips it, so it works regardless of whether the hook context
re-exports `$TMUX`.

> **Migration**: this indirection needs **one final** old-style migration —
> re-run `rk agent-setup` (idempotent; it recognizes and replaces both the
> legacy inlined one-liner and the new `rk agent-hook` form in place) **and
> restart agent sessions** (harnesses snapshot hook config at session start, so
> the old frozen strings persist until a fresh session). **Subsequent hook
> *logic* changes need neither** — they ship in the rk binary and take effect on
> `brew upgrade rk`. Only **matcher / event-mapping** changes (which events map
> to which state) still require re-setup + session restart, because that mapping
> lives in the settings entries, not the binary.

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
the rk-owned entries. rk-owned entries are identified by **either** the legacy
`@rk_agent_state` marker (the old inlined one-liner) **or** the new ` agent-hook `
invocation substring (the delegating wrapper) in the command string — matching
both is what lets a re-run on the new binary migrate old-generation entries in
place and lets `--uninstall` remove both generations.
