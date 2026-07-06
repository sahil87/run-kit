---
description: "The `@rk_agent_state` pane-option convention — two-tier ownership, three-state value schema, writer/reader rules, shell reconciler, window rollup, and the `rk agent-setup` per-agent hook registry"
type: memory
---
# Agent-State Tier (`@rk_agent_state`)

The generic agent-lifecycle tier: a tmux **pane** user option that any agent
harness writes and run-kit reads natively, replacing the Claude-only,
fab-root-coupled `_agents` pipeline that run-kit previously consumed via
`fab pane map`. Landed by `260705-dmex-generic-agent-state-tier`. The cross-repo
contract lives in [`docs/specs/agent-state.md`](../../specs/agent-state.md) (this
memory file records what run-kit actually implemented).

## Two-Tier Ownership Model

Agent status splits into two tiers with distinct owners:

- **Tier 1 — fab pipeline state** (change / stage / display-state): owned by the
  fab pipeline, read from `.status.yaml`, still joined via `fab pane map`
  (`paneMapEntry.Change`/`Stage`/`DisplayState`). Stays fab's.
- **Tier 2 — generic agent-lifecycle state** (`active` / `waiting` / `idle`):
  owned by run-kit, carried in the `@rk_agent_state` tmux pane user option,
  written by agent-harness hooks for **any** agent (Claude, codex, copilot,
  gemini, opencode, …) in **any** directory under **any** workflow.

This inverts the previous model where run-kit consumed a Claude-only,
fab-root-coupled `_agents` pipeline (`fab hook` dies outside a fab root; hooks
are registered in Claude settings only). Per constitution **Principle X — Hooks
Carry Only the Underivable** (amended to v1.4.0 for this change), hooks push only
ephemeral in-flight lifecycle state; everything derivable (PR links, branches,
worktrees) is derived server-side — which is why PR links moved to branch→PR
derivation in the same change (see [architecture](/run-kit/architecture.md)
§ Backend Libraries → `internal/prstatus`, § Branch→PR Derivation).

## The Convention

| Property | Value |
|----------|-------|
| Option | `@rk_agent_state` (const `tmux.AgentStateOption`) |
| Scope | tmux **pane** user option (`set-option -p`) — a new scope class alongside window (`-w`), server (`-s`), and session-scoped options |
| Value | `"<state>:<epoch_seconds>"` |
| States | `active` (`tmux.AgentStateActive`) \| `waiting` (`tmux.AgentStateWaiting`) \| `idle` (`tmux.AgentStateIdle`) |
| Example | `waiting:1751790000` |

The epoch suffix is **mandatory** — readers compute idle/waiting duration from
it. The option name and the three state tokens are declared **once** in
`app/backend/internal/tmux/tmux.go` (constants `AgentStateOption`,
`AgentStateActive`/`Waiting`/`Idle`); `cmd/rk/agent_setup.go` aliases them rather
than re-declaring the convention strings (one source of truth per binary, A-021).

**State semantics**: `active` = a turn is in progress; `waiting` = blocked on a
**human** (permission prompt, elicitation/question dialog) — the highest-urgency,
most notification-worthy state; `idle` = turn complete, at rest.

## Backend Native Read (`internal/tmux`)

`#{@rk_agent_state}` is field 6 (0-indexed) of the `paneFormat` `list-panes`
format string — **7 fields** since this change (`window_index`, `pane_id`,
`pane_index`, `pane_current_path`, `pane_current_command`, `pane_active`,
`@rk_agent_state`). It costs **zero extra subprocess** — it rides the existing
`list-panes` call `ListWindows` already issues per session.

`PaneInfo` gained two fields: `AgentState string` (`json:"agentState,omitempty"`,
`active|waiting|idle`, empty = unknown) and `AgentStateEpoch int64`
(`json:"agentStateEpoch,omitempty"`, 0 = unknown). Both are parsed and reconciled
in `parsePanes` (which now requires `< 7` fields to skip a line, up from 6):

- **`parseAgentState(raw string) (string, int64)`** — pure helper. Trims, splits
  on the **last** `:` (defensive; state tokens never contain a colon so it equals
  a first-colon split for valid input), validates the state via `isAgentState`
  and the epoch via `strconv.ParseInt(base 10, 64)`. An empty value, a value
  lacking the colon, an unknown state token, or a non-integer epoch all yield
  `("", 0)` — degrades to unknown, never panics.
- **Shell-command reconciler** — applied in `parsePanes` right after parse: if
  `isShellCommand(command)` (the pane's `#{pane_current_command}` is one of the
  set `shellCommands = {bash, zsh, fish, sh, dash}`, matched case-sensitively),
  **both** `AgentState` and `AgentStateEpoch` are zeroed regardless of a leftover
  option value. This auto-clears a stranded `active` left by an Esc-interrupted or
  killed agent (the guppi lesson) — a real agent command like `claude` keeps its
  state.

## Window Rollup + Duration (`internal/sessions`)

`WindowInfo.AgentState` / `AgentIdleDuration` keep their JSON field names
(`agentState` / `agentIdleDuration`) but **change source**: they are now a
window-level rollup over the window's panes (post-reconciler) computed rk-side in
`FetchSessions`, no longer joined from `fab pane map`.

- **`rollupAgentState(panes []tmux.PaneInfo, nowUnix int64) (state, duration string)`**
  — pure helper (mirrors the `parseWindows`/`parsePanes`/`applyActiveWindow`
  split). Precedence `waiting > active > idle` via `agentStatePrecedence`
  (`waiting`=3, `active`=2, `idle`=1, unknown/empty=0) — the highest-ranked pane
  wins, so a split window with one `waiting` pane is a `waiting` window. Panes
  with no agent contribute nothing.
- **Duration** is computed from the winning pane's `AgentStateEpoch` for `idle`
  **and** `waiting` (both are durations a human cares about — how long at rest /
  how long the human has been the blocker); `active` and unknown produce `""`.
- **`formatAgentDuration(elapsedSeconds int64) string`** — reproduces fab's
  `Ns`/`Nm`/`Nh` floor-division style (`<60s`→`Ns`, `<3600s`→`Nm`, else `Nh`;
  non-positive → `""`) so the frontend duration string surface is byte-compatible
  with the previously fab-formatted value.

`FetchSessions` calls the rollup per window inside the enrichment loop
(`nowUnix := time.Now().Unix()` captured once for the whole loop).

## `rk agent-setup` — Hook Installer (`cmd/rk/agent_setup.go`)

`rk agent-setup` (registered in `root.go` `init()`) is the explicit opt-in
installer that writes the hook commands into an agent harness's **user-global**
config so any session of that agent, anywhere, reports state. Modeled on guppi's
explicit `agent-setup` command rather than a silent sync ("explicit feels
honest").

**Per-agent registry** (`agentRegistry(home) []agentConfig`): each `agentConfig`
carries a display `name`, a `settingsPath`, and an ordered `[]agentHook` (event +
optional matcher + fixed state token). v1 ships **Claude Code only**
(`~/.claude/settings.json` via `claudeSettingsRelPath`); codex/copilot/gemini/
opencode are additive registry rows. The Claude event→state mapping:

| Event | Matcher | State |
|-------|---------|-------|
| `UserPromptSubmit` | — | `active` |
| `PreToolUse` | — | `active` (heartbeat; also covers subagent tool churn) |
| `Notification` | `permission_prompt\|elicitation_dialog\|agent_needs_input` | `waiting` |
| `Notification` | `idle_prompt` | `idle` (backstop — `Stop` doesn't fire on every turn-end path, e.g. Esc-interrupt) |
| `Stop` | — | `idle` |

**Hook command** (`agentStateHookCommand(state)`): a fixed self-contained
one-liner per state, **no rk/server dependency at hook-fire time** —
`sh -c '[ -n "$TMUX_PANE" ] || exit 0; tmux set-option -pt "$TMUX_PANE" @rk_agent_state "<state>:$(date +%s)" 2>/dev/null || true'`.
It no-ops outside tmux, never fails the agent (every path exits 0), and the state
is a fixed literal — nothing user-provided is interpolated, so there is no
injection surface (Constitution §I).

**JSON-merge install** (`mergeHooks`/`unmergeHooks`, pure functions over
`map[string]any` so tests skip the filesystem/prompt):

- Merges under the Claude shape
  `hooks → <Event> → [ { matcher?, hooks: [ { type:"command", command } ] } ]`.
- **Idempotent**: for each touched event array it **first** strips every existing
  rk-owned entry (once per event — an event may carry multiple rk hooks, e.g.
  `Notification` maps to both `waiting` and `idle`), **then** appends the fresh
  entries — so a re-run replaces in place and never duplicates.
- rk-owned entries are identified by the **`rkHookMarker`** (which *is*
  `tmux.AgentStateOption`, `@rk_agent_state`) appearing in a nested command
  string — `isRkEntry`; non-rk hooks never carry it and are preserved untouched.
- `--uninstall` runs `unmergeHooks`, removing exactly the rk-owned entries; an
  event array that empties is deleted, and a `hooks` object that empties is
  deleted.
- **Diff + confirm before write**: `applyAgentConfig` renders `current` vs
  `proposed` as sorted indented JSON; a no-op (identical) is reported and skipped
  without prompting; otherwise it prints the diff and reads a y/N answer
  (`confirm`, default No) from an injected `io.Reader` (testable without a TTY).
  On confirm, `writeSettings` writes mode **0600** (matching user-config
  sensitivity), creating `~/.claude/` via `MkdirAll` if absent.

**Tolerant read** (`readSettings`): a missing, empty, or all-whitespace settings
file is treated as an empty object (never an error — install must work on a fresh
machine). A genuinely malformed (non-empty, non-JSON) file **surfaces an error
without writing** — anti-clobber: silently treating it as empty would overwrite
user config.

## Lifecycle

Pane options die with the pane — **no GC, no state file, no cross-pane
ambiguity**. An option lives on exactly one pane of exactly one tmux server;
killing the pane (or the server) removes it. This is why the shell-command
reconciler is the only cleanup needed: a killed agent's pane either dies (option
gone) or reverts to a shell (reconciler zeros it).

## Migration — Clean Swap, No Dual-Source Fallback

The pane-map join was **slimmed** in the same change:
`paneMapEntry` dropped `agent_state`, `agent_idle_duration`, `pr_url`, and
`pr_number`; the join consumes only `change`/`stage`/`display_state`; and
`dedupEntries` priority simplified from `Change > AgentState > first-seen` to
`Change > first-seen` (the AgentState tiebreak arm is dead — agent state no longer
rides the map). See [architecture](/run-kit/architecture.md) § `internal/sessions`.

There is **no dual-source fallback**: until `rk agent-setup` has been run on a
machine, agent columns read unknown (`—`). Accepted for a single-operator
deployment — rollout is "deploy rk, run `rk agent-setup` once per machine"
(fallback code would contradict minimal-surface §IV and would linger). fab-kit
keeps writing `.fab-runtime.yaml` `_agents` until its own reader-side change
(fab-kit backlog `[ioku]`) lands — harmless coexistence, run-kit simply stops
reading the old sink.

## UI Surfacing (deferred)

The richer `waiting` value flows through existing surfaces **without new UI**
(Non-Goal — UI surfacing redesign is deferred per intake Assumption 11): the pane
panel's `agt` line renders `waiting <dur>` state-agnostically. But the sidebar
window-row duration text and `StatusDot` still gate on `idle`/existing inputs — a
known deferred gap, not widened here. See
[ui-patterns](/run-kit/ui-patterns.md) § Window rows (Duration display) and
§ Status Dot.

## Design Decisions

### Reconciler at `parsePanes` time (`internal/tmux`), rollup at `internal/sessions`
**Decision**: parse + shell-command reconcile the option in the pure `parsePanes`
helper (which already has both the pane command and the option value on one line);
compute the window-level rollup + duration in `internal/sessions` pure helpers.
**Why**: keeps each rule colocated with its data and unit-testable, mirroring the
existing `parseWindows`/`parsePanes` / sessions-enrichment split. `AgentState`/
`AgentIdleDuration` are already window-level JSON fields consumed by the frontend,
and the sessions package already owns the per-window pane enrichment loop.
**Rejected**: reconciling in `internal/sessions` (would duplicate the shell-name
set and split the rule from its data); computing the rollup in `internal/tmux`
(window-level rollup is enrichment, not raw tmux parsing).
*Introduced by*: `260705-dmex-generic-agent-state-tier`

### Explicit `rk agent-setup` opt-in, not silent sync
**Decision**: an explicit installer command that shows a diff and asks for
confirmation before mutating user-global config, with `--uninstall`.
**Why**: it mutates `~/.claude/settings.json` (user-global) — the user chose
"explicit feels honest" over agentdock's silent sync. A marker-keyed idempotent
merge is the only way "update rk entries in place, never touch non-rk hooks" is
satisfiable.
**Rejected**: silent background sync (surprising for a user-config mutation);
per-project install (defeats the "any session anywhere" goal — the whole point is
user-global registration).
*Introduced by*: `260705-dmex-generic-agent-state-tier`

### One source of truth per binary for the convention strings
**Decision**: `cmd/rk/agent_setup.go` aliases `tmux.AgentStateOption` /
`tmux.AgentState*` rather than re-declaring `"@rk_agent_state"` and the state
literals locally.
**Why**: the option name and states are the cross-repo contract; a second copy in
the installer would let the writer and the reader drift (A-021, resolved at
rework cycle 1 after review flagged the local re-declaration).
*Introduced by*: `260705-dmex-generic-agent-state-tier`
