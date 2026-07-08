---
description: "The `@rk_agent_state` pane-option convention — two-tier ownership, three-state value schema, writer/reader rules, shell reconciler, window rollup, and the `rk agent-setup` installer + `rk agent-hook` binary indirection (stable settings interface, logic in the binary, comm-validated ancestor walk)"
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
it. Values MAY carry a third `:<pid>` segment (the agent process's pid, for the
PID-liveness reconciler); the schema is `<state>:<epoch>[:<pid>]` and is
**unchanged** by the `rk agent-hook` indirection (`260707-qfps`) — the pure
`formatAgentStateValue(state, epoch, pid)` in `cmd/rk/agent_hook.go` reproduces
it byte-for-byte, and every reader is untouched. The option name and the three
state tokens are declared **once** in `app/backend/internal/tmux/tmux.go`
(constants `AgentStateOption`, `AgentStateActive`/`Waiting`/`Idle`);
`cmd/rk/agent_setup.go` **and** `cmd/rk/agent_hook.go` alias them rather than
re-declaring the convention strings (one source of truth per binary, A-021).

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

## `rk agent-hook` — Hook Logic in the Binary (`cmd/rk/agent_hook.go`)

Since `260707-qfps` the hook body installed into harness settings is a stable
*interface* (`agentStateHookCommand` above) and **all logic lives in this Go
subcommand** — so a hook fix reaches every running agent on `brew upgrade rk`
with no settings churn and no session restarts. `rk agent-hook --agent <name>
<state>` (registered in `root.go` `init()`) is what the installed wrapper
invokes; `<state>` ∈ `active | waiting | idle`, `--agent` selects the harness
whose comm literal drives pid resolution (v1: `claude`, default).

**Never-fail contract — always exit 0.** Claude Code treats hook exit code 2 as
blocking and other non-zero exits as warnings, and `main`'s `execute()`
`os.Exit(1)`s on any error `rootCmd.Execute()` returns — so the command must
swallow **every** cobra parse-error class ITSELF, before it can propagate. Cobra
surfaces four distinct classes before `RunE`, each needing its own neutralizer:

- `RunE` always returns `nil` (arg-count is re-checked inside it → silent no-op).
- `Args: cobra.ArbitraryArgs` disables cobra's arg-count validation.
- `FParseErrWhitelist{UnknownFlags: true}` absorbs unknown flags.
- `SetFlagErrorFunc(… → nil)` (in `init()`) swallows KNOWN-flag parse errors
  (e.g. `--agent` present with its value missing) — the one class the other three
  miss.

Plus `SilenceErrors`/`SilenceUsage` so cobra prints nothing on any of these
paths. (Locked in by `TestAgentHookCmdNeverErrorsOnMalformedInvocation`.)

**Flow** (`runAgentHook`, the testable core): (1) `$TMUX_PANE` guard — unset →
exit 0 with no subprocess (defense in depth; the wrapper also short-circuits on
it); (2) validate `<state>` via the aliased `isAgentState` (unknown → no write);
(3) resolve the agent's comm from the registry via `agentCommForName(home, agent)`
(unknown `--agent` → no write; it reuses the same `agentRegistry` as the installer
so the writer's `--agent` set and the installed hooks never diverge); (4) resolve
the pid via the ancestor walk; (5) write the pane option. Every failure path is
silent and returns without error.

**Comm-validated ancestor walk** (`resolveAgentPID(ctx, startPPID, comm)`, bound
**5**): walks up from `os.Getppid()` comparing each ancestor's comm against the
registry literal, returning the first match's pid or **0** (→ pid segment omitted,
never a wrong pid). The bound rose 3→5 vs. the former shell hook because the
delegation adds a wrapper layer (`claude → hook shell → sh -c → rk`, and `sh` may
or may not exec the final `rk`). Raw `$PPID` is wrong here — harnesses spawn hooks
through an *ephemeral* shell that exits when the hook finishes, so `$PPID` records
that dead wrapper (the reader's PID-liveness check would then suppress every
value). The process-inspection primitives:

- **comm** (`processCommImpl`) **delegates to `resolveCommand`** in
  `daemon_portowner.go` (same package — Linux reads `/proc/<pid>/comm` with no
  subprocess, else shells to `ps -o comm=`), reused rather than re-implemented so
  the two comm-resolution sites can't drift.
- **ppid** (`processPPIDImpl`): Linux reads the `PPid:` line of
  `/proc/<pid>/status` (line-keyed, so the `/proc/<pid>/stat` comm-with-parens
  field-indexing hazard does NOT apply — via the pure `parseProcStatusPPID`);
  elsewhere `ps -o ppid= -p` via `exec.CommandContext` with `agentHookCmdTimeout`
  (5s). The `/proc` fast paths avoid ~4 subprocess spawns per hook fire on the
  common Linux host.
- Both are indirected through package-level func-var seams (`processCommFn` /
  `processPPIDFn`) so the walk is unit-testable without a real ancestor chain
  (mirrors `agentProcessAlive` / `findPortOwner`).

**Write** (`writeAgentStateImpl`): `tmux [-S <socket>] set-option -pt "$TMUX_PANE"
@rk_agent_state <value>` via `exec.CommandContext` with a 5s timeout
(Constitution §I) — value formatted by the pure `formatAgentStateValue`. The
server is targeted via `-S <socket>` derived from **`tmux.OriginalTMUX`, NOT
`os.Getenv("TMUX")`**: `internal/tmux`'s `init()` strips `$TMUX` from the process
(so the daemon's bare tmux calls hit the default socket), and importing that
package here triggers that strip; `OriginalTMUX` captures the caller's real socket
in a var initializer that runs before `init()`. This is the established seam —
same one `riff.go` / `context.go` use. Deriving `-S` from it (rather than relying
on the child re-exporting `$TMUX`) also survives hook contexts like
`tmux run-shell` that set `$TMUX_PANE` but not `$TMUX`. `tmuxSocketArgs` splits
the `<socket>,<pid>,<session>` `$TMUX` value on the first comma; empty/malformed →
bare invocation (default socket, best effort — the wrapper's `|| true` holds).

## `rk agent-setup` — Hook Installer (`cmd/rk/agent_setup.go`)

`rk agent-setup` (registered in `root.go` `init()`) is the explicit opt-in
installer that writes the hook commands into an agent harness's **user-global**
config so any session of that agent, anywhere, reports state. Modeled on guppi's
explicit `agent-setup` command rather than a silent sync ("explicit feels
honest").

**Per-agent registry** (`agentRegistry(home) []agentConfig`): each `agentConfig`
carries a display `name`, a `settingsPath`, the agent binary's `comm` (process
name, e.g. `"claude"` — threaded into both the installed wrapper's `--agent` value
and `agent_hook.go`'s pid-resolution walk since `260707-qfps`), and an ordered
`[]agentHook` (event + optional matcher + fixed state token). v1 ships **Claude
Code only** (`~/.claude/settings.json` via `claudeSettingsRelPath`); codex/
copilot/gemini/opencode are additive registry rows. The Claude event→state
mapping:

| Event | Matcher | State |
|-------|---------|-------|
| `UserPromptSubmit` | — | `active` |
| `PreToolUse` | — | `active` (heartbeat; also covers subagent tool churn) |
| `Notification` | `permission_prompt\|elicitation_dialog\|agent_needs_input` | `waiting` |
| `Notification` | `idle_prompt` | `idle` (backstop — `Stop` doesn't fire on every turn-end path, e.g. Esc-interrupt) |
| `Stop` | — | `idle` |

**Hook command** (`agentStateHookCommand(rkPath, state, comm)`): since
`260707-qfps` a **stable delegating wrapper** that keeps all logic in the rk
binary (see § `rk agent-hook` below) instead of inlining it —

```sh
sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<abs-rk>" agent-hook --agent claude <state> 2>/dev/null || true'
```

The `$TMUX_PANE` guard stays in the wrapper as a cheap short-circuit (no binary
spawn outside tmux); `|| true` preserves the never-fail contract even if the
binary is missing or moved (silent no-op is acceptable — the PID-liveness
reconciler clears stranded values). state and comm are fixed registry literals;
the only machine-derived interpolation is `<abs-rk>`, closed by
`validateHookPath` (below). This replaces the former self-contained one-liner
that inlined `tmux set-option … @rk_agent_state "<state>:$(date +%s)"` — that
form was **frozen twice** (once in `~/.claude/settings.json` at install time,
once in the harness's session-start snapshot), so a hook bug fix shipped in the
binary reached zero running agents until every session was restarted (the
#320↔#321 skew: the settings-side raw-`$PPID` writer and the binary-side #320
PID-liveness reconciler diverged and suppressed agent state fleet-wide). The
delegating wrapper lifts that freeze — hook *logic* changes now ship with the
binary on `brew upgrade rk`, no settings churn, no session restarts.

**Install-time path resolution** (`resolveRkPath()`): the `<abs-rk>` embedded in
the wrapper is resolved once per `runAgentSetup` invocation — prefer
`exec.LookPath("rk")` (on Homebrew this yields the STABLE symlink
`/home/linuxbrew/.linuxbrew/bin/rk` or `/opt/homebrew/bin/rk`, NOT the
version-pinned Cellar path), falling back to `os.Executable()` **without**
`filepath.EvalSymlinks` (resolution would pin the Cellar version and re-freeze
the hook — the exact failure this change removes). Before any merge the path is
run through `validateHookPath`: a path containing any of `' " $ ` backslash (all
shell-active inside the wrapper's double-in-single quoting) **fails the install
with a clear error** — reject-don't-escape (escaping would have to survive three
nested quoting layers; such paths never occur under Homebrew/conventional
layouts; agent-setup is interactive so the user sees the error and acts).

**JSON-merge install** (`mergeHooks`/`unmergeHooks`, pure functions over
`map[string]any` so tests skip the filesystem/prompt):

- Merges under the Claude shape
  `hooks → <Event> → [ { matcher?, hooks: [ { type:"command", command } ] } ]`.
- **Idempotent**: for each touched event array it **first** strips every existing
  rk-owned entry (once per event — an event may carry multiple rk hooks, e.g.
  `Notification` maps to both `waiting` and `idle`), **then** appends the fresh
  entries — so a re-run replaces in place and never duplicates.
- rk-owned entries are identified by `isRkEntry`, which since `260707-qfps`
  matches **either generation** of the command string: the LEGACY marker
  `rkHookMarker` (which *is* `tmux.AgentStateOption`, `@rk_agent_state` — the old
  inlined one-liner carried the option name) **or** the NEW-form const
  `rkHookMarkerAgentHook` (`" agent-hook "`, spaces included so it can't match an
  unrelated token). Matching both is what lets a re-run on the new binary strip
  old-generation entries and replace them **in place** (no duplication), and lets
  `--uninstall` remove **both** generations. Non-rk hooks carry neither marker and
  are preserved untouched. *(The legacy arm is transitional — once the fleet's
  one-time re-setup migration is complete, no settings file carries the old
  inlined one-liner and the `@rk_agent_state` match becomes removable.)*
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

## UI Surfacing (landed — `260706-y1ar-status-pyramid-ui-surfacing`)

#314 shipped the `waiting` value but nothing rendered it (the UI redesign was
deferred out per #314's Assumption 11). `260706-y1ar` is that deferred work — the
`agentState` three-state value is now a first-class UI input across every surface
(design authority `docs/specs/status-pyramid.md`, palette v3). What consumes it:

- **`StatusDot` (palette-v3 two-family ladder)**: a fresh `agentState` on a
  non-fab window drives the **warm ad-hoc-agent family** — yellow working / orange
  PR (vs the cool fab family blue/green/purple, vs the gray floor). A `waiting`
  window of ANY tier gets an **additive constant-yellow pulsing halo** (core hue +
  shape untouched — never a hue-flip). `agentState === "idle"` is a ring;
  `active`/`waiting` are solid (mid-turn). See
  [ui-patterns](/run-kit/ui-patterns.md) § Status Dot.
- **Row Minimalism**: the sidebar window row's trailing stage-word + duration
  cluster was removed — the `StatusDot` is now the row's ONLY status signal
  (§ Window rows).
- **PANE panel L1 `agent` register**: the four-register view (output/agent/fab/PR)
  renders `agent waiting <dur>` on its own line, never muted by flowing output
  (the pierce rule); the `StatusDotTip` gains an `agent:` line on every tier
  (§ Pane panel four-register view, § Status Dot hover-card).
- **Attention rollups + nav**: `waiting` counts propagate as `WaitingBadge` chips
  (session row, Cockpit server tile, board header, and — since
  `260708-4li7-sidebar-server-tile-waiting-badge` — the sidebar SERVER-panel
  server tile, the fourth badge surface), a pulsing board-pane seam, and the
  `Agent: Next waiting` command-palette navigation (§ Attention Surfacing). See
  [ui-patterns](/run-kit/ui-patterns.md) § Attention Surfacing for the surface
  list and the sidebar tile's inline-flex placement (distinct from the Cockpit
  tile's absolute top-right, to avoid the sidebar tile's hover-action cluster).
- **Web Push on sustained waiting**: the SSE hub fires one push per sustained
  (≥15s) waiting episode — see [architecture](/run-kit/architecture.md)
  § Web Push on Sustained Waiting.

The window-level rollup + `waiting > active > idle` precedence + the
`formatAgentDuration` value (present for `waiting`/`idle`) documented above are
what these surfaces consume — unchanged by `260706-y1ar`, which only added
consumers.

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
*Extended by*: `260707-qfps-rk-agent-hook-indirection` — `cmd/rk/agent_hook.go`
(the new writer) aliases the same `tmux.AgentState*` constants and reuses
`agentRegistry`, so writer and reader still have one source per binary.

### Stable interface in settings, logic in the binary (`rk agent-hook`)
**Decision**: install a thin, never-changing wrapper into harness settings that
delegates to a new `rk agent-hook` subcommand; put ALL logic (comm-validated
ancestor walk, value formatting, `tmux set-option` write) in the Go binary.
**Why**: the whole point of the change — a hook logic fix reaches every running
agent on `brew upgrade rk`, with no settings churn and no session restarts. Hook
logic was formerly frozen twice (in `~/.claude/settings.json` at install time and
in the harness's session-start snapshot), so the #320 PID-liveness reconciler
(binary-updated) and the raw-`$PPID` hook (settings-frozen) skewed between #320
and #321 and suppressed agent state fleet-wide.
**Rejected**: keep raw one-liners + drift detection (a doctor check / UI
surfacing — mitigates *discovery* of the skew, not the fleet-wide migration
itself); dual-path hook (binary-if-present + pure-tmux fallback inline — the
fallback string IS the frozen logic being removed, and doubles the surface). No
pure-tmux fallback when the binary is missing: silence is acceptable because the
PID-liveness reconciler already clears state from dead agents and a stranded
value clears when the agent/pane dies.
*Migration*: one final old-style migration is needed now (re-run
`rk agent-setup`, restart sessions — the snapshot still pins old strings);
subsequent *logic* changes need neither. Matcher / event-mapping changes still
need re-setup + restart (that mapping lives in the settings matchers).
*Introduced by*: `260707-qfps-rk-agent-hook-indirection`

### Event→state mapping stays in settings; state-literal args + `--agent` flag
**Decision**: v1 keeps the event→state mapping (which harness event installs which
state, including the two `Notification` matchers) in the settings matchers; the
wrapper passes a fixed state literal + `--agent <comm>`. Reading the harness's
hook JSON on stdin to derive state in-binary is deferred as an additive
follow-up.
**Why**: the mapping churns far less than the logic, and matcher changes require a
settings write regardless; stdin-JSON parsing would not change the installed
command shape, so deferring it loses nothing.
*Introduced by*: `260707-qfps-rk-agent-hook-indirection`

### Reject (don't escape) shell-unsafe rk paths; never Cellar-pin
**Decision**: resolve `<abs-rk>` via `LookPath("rk")` → `os.Executable()` without
`EvalSymlinks`, and `validateHookPath`-reject any path containing `' " $ `
backslash with a clear install-time error rather than escaping it or silently
falling back to bare `rk`.
**Why**: hook-env PATH is untrustworthy, so the absolute path must be embedded;
`EvalSymlinks` would pin the version-locked Cellar path and re-freeze the hook
(defeating the whole change); escaping would have to survive three nested quoting
layers (shell-in-shell-in-JSON — fragile to write and review); a bare-`rk`
fallback reintroduces the PATH dependency the absolute path exists to remove. Such
paths never occur under Homebrew/conventional layouts, and agent-setup is
interactive so the user sees the error and can act.
*Introduced by*: `260707-qfps-rk-agent-hook-indirection`

### Target the pane's server via `tmux.OriginalTMUX`, not `$TMUX`
**Decision**: derive the `-S <socket>` server-targeting prefix from
`tmux.OriginalTMUX`, not `os.Getenv("TMUX")`.
**Why**: `internal/tmux`'s `init()` unsets `$TMUX` on import (so the daemon's bare
tmux calls hit the default socket); `OriginalTMUX` captures the caller's real
socket in a var initializer that runs before that `init()`. It is the established
seam (same as `riff.go` / `context.go`). Deriving `-S` from it also survives hook
contexts like `tmux run-shell` that set `$TMUX_PANE` but not `$TMUX`.
*Introduced by*: `260707-qfps-rk-agent-hook-indirection`
