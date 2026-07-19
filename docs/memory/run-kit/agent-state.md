---
description: "The `@rk_agent_state` pane-option convention: two-tier ownership, three-state value schema, writer/reader rules, shell reconciler, and window rollup. Covers the hooks-only `rk agent-setup` installer (settings-hooks merge plus a one-release legacy `rk-display` skill cleanup) and its `rk agent-hook` binary indirection, plus the sibling `@rk_chat` chat-session-identity convention whose reconciliation shares agent-state's per-pane liveness."
type: memory
---
# Agent-State Tier (`@rk_agent_state`)

The generic agent-lifecycle tier: a tmux **pane** user option that any agent
harness writes and run-kit reads natively. (`260705-dmex`) The cross-repo
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

Per constitution **Principle X — Hooks Carry Only the Underivable**, hooks push
only ephemeral in-flight lifecycle state; everything derivable (PR links,
branches, worktrees) is derived server-side — which is why PR links use branch→PR
derivation (see [architecture](/run-kit/architecture.md)
§ Backend Libraries → `internal/prstatus`, § Branch→PR Derivation). (`260705-dmex`)

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
PID-liveness reconciler); the schema is `<state>:<epoch>[:<pid>]`, formatted by
the pure `formatAgentStateValue(state, epoch, pid)` in `cmd/rk/agent_hook.go`. The
option name and the three
state tokens are declared **once** in `app/backend/internal/tmux/tmux.go`
(constants `AgentStateOption`, `AgentStateActive`/`Waiting`/`Idle`);
`cmd/rk/agent_setup.go` **and** `cmd/rk/agent_hook.go` alias them rather than
re-declaring the convention strings (one source of truth per binary, A-021).

**State semantics**: `active` = a turn is in progress; `waiting` = blocked on a
**human** (permission prompt, elicitation/question dialog) — the highest-urgency,
most notification-worthy state; `idle` = turn complete, at rest.

## Backend Native Read (`internal/tmux`)

`#{@rk_agent_state}` is field 6 (0-indexed) of the `paneFormat` `list-panes`
format string — **7 fields** (`window_index`, `pane_id`,
`pane_index`, `pane_current_path`, `pane_current_command`, `pane_active`,
`@rk_agent_state`). It costs **zero extra subprocess** — it rides the existing
`list-panes` call `ListWindows` already issues per session.

`PaneInfo` carries two fields: `AgentState string` (`json:"agentState,omitempty"`,
`active|waiting|idle`, empty = unknown) and `AgentStateEpoch int64`
(`json:"agentStateEpoch,omitempty"`, 0 = unknown). Both are parsed and reconciled
in `parsePanes` (which requires `< 7` fields to skip a line):

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

`WindowInfo.AgentState` / `AgentIdleDuration` (JSON `agentState` /
`agentIdleDuration`) are a window-level rollup over the window's panes
(post-reconciler) computed rk-side in `FetchSessions`.

- **`rollupAgentState(panes []tmux.PaneInfo, nowUnix int64) (state, duration string)`**
  — pure helper (mirrors the `parseWindows`/`parsePanes`/`applyActiveWindow`
  split). Precedence `waiting > active > idle` via `agentStatePrecedence`
  (`waiting`=3, `active`=2, `idle`=1, unknown/empty=0) — the highest-ranked pane
  wins, so a split window with one `waiting` pane is a `waiting` window. Panes
  with no agent contribute nothing.
- **Duration** is computed from the winning pane's `AgentStateEpoch` for `idle`
  **and** `waiting` (both are durations a human cares about — how long at rest /
  how long the human has been the blocker); `active` and unknown produce `""`.
- **`formatAgentDuration(elapsedSeconds int64) string`** — the `Ns`/`Nm`/`Nh`
  floor-division style (`<60s`→`Ns`, `<3600s`→`Nm`, else `Nh`;
  non-positive → `""`), byte-compatible with fab's duration-string format so the
  frontend surface is unchanged.

`FetchSessions` calls the rollup per window inside the enrichment loop
(`nowUnix := time.Now().Unix()` captured once for the whole loop).

## `rk agent-hook` — Hook Logic in the Binary (`cmd/rk/agent_hook.go`)

The hook body installed into harness settings is a stable
*interface* (`agentStateHookCommand` above) and **all logic lives in this Go
subcommand** — so a hook fix reaches every running agent on `brew upgrade rk`
with no settings churn and no session restarts. (`260707-qfps`) `rk agent-hook --agent <name>
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
never a wrong pid). The bound is **5** because the delegation adds a wrapper layer
(`claude → hook shell → sh -c → rk`, and `sh` may
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
installer that writes into an agent harness's **user-global** config so any
session of that agent, anywhere, reports state. Modeled on guppi's explicit
`agent-setup` command rather than a silent sync ("explicit feels honest").

**Consent flags** (toolkit Principle 1/5): because it mutates
`~/.claude/settings.json`, the confirmation is
gated through a `consent` struct (`yes` / `dryRun` / `stdinIsTTY`) resolved once
per run in the `RunE` and threaded through `runAgentSetup` → `applyAgentConfig`
→ `applyAgentHooks` / `removeLegacySkill`. The single decision point is
`consent.authorizeWrite(out, reader, dryRunNote, promptSuffix) (bool, error)`:
(`260717-c424`)

- **`--dry-run`** → print the dry-run note, write nothing, return `(false, nil)`.
  Needs no consent, and **wins over `--yes`** (a preview must never mutate).
- **`--yes` / `-y`** → return `(true, nil)` without prompting (non-interactive consent).
- **neither, stdin is a TTY** → print `promptSuffix` and defer to the interactive
  `confirm()` `[y/N]` read.
- **neither, stdin is NOT a TTY** → **refuse**: return
  `(false, errNonInteractiveConsent)`, an error naming `--yes`, nothing written
  (a success-looking silent no-op is the exact agent trap Principle 1 targets;
  reference impl: `shll uninstall`).

The `promptSuffix` (`"Write these changes? [y/N] "` / `"Remove … directory? [y/N] "`)
is emitted **only** on the interactive path — the auto-answered `--yes`/`--dry-run`
paths never read it, so printing `[y/N] ` there would read as a hang in an agent's
transcript. `renderArtifactDiff` does not append the suffix for this reason.

**TTY detection uses `term.IsTerminal`, NOT a bare `os.ModeCharDevice` check**
(`isTerminal(r io.Reader)`): a char-device test alone classifies `/dev/null`
(`agent-setup </dev/null` — the exact non-interactive shape an agent uses) as a
terminal, which would make the refusal silently not fire. A non-`*os.File` reader
(a test's `strings.Reader` or a pipe) is not a TTY, so tests default to the
non-interactive path unless they set `stdinIsTTY` explicitly. Pinned by
`TestIsTerminalRejectsNonTTYFiles`.

**It installs exactly ONE artifact: the settings-hooks merge** (described here).
The command surface is `rk agent-setup` / `rk agent-setup --uninstall`. The
visual-display context-injection role belongs to the **`rk skill` bundle** (served
by the `skill` subcommand, aggregated by the coming `shll agent-setup`), described
in [architecture](/run-kit/architecture.md) § CLI Subcommands; the only skill trace
in agent-setup is a **one-release legacy cleanup** that removes a stale
`rk-display` copy left by an older run-kit (see § Legacy `rk-display` Cleanup).
(`260717-agst`)

**Per-agent registry** (`agentRegistry(home) []agentConfig`): each `agentConfig`
carries a display `name`, a `settingsPath`, the agent binary's `comm` (process
name, e.g. `"claude"` — threaded into both the installed wrapper's `--agent` value
and `agent_hook.go`'s pid-resolution walk), and an ordered
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

**Hook command** (`agentStateHookCommand(rkPath, state, comm)`): a **stable
delegating wrapper** that keeps all logic in the rk binary (see § `rk agent-hook`
below) —

```sh
sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<abs-rk>" agent-hook --agent claude <state> 2>/dev/null || true'
```

The `$TMUX_PANE` guard stays in the wrapper as a cheap short-circuit (no binary
spawn outside tmux); `|| true` preserves the never-fail contract even if the
binary is missing or moved (silent no-op is acceptable — the PID-liveness
reconciler clears stranded values). state and comm are fixed registry literals;
the only machine-derived interpolation is `<abs-rk>`, closed by
`validateHookPath` (below). Delegating to the binary means hook *logic* changes
ship with the binary on `brew upgrade rk`, no settings churn, no session
restarts. (`260707-qfps`)

**Install-time path resolution** (`resolveRkPath()`): the `<abs-rk>` embedded in
the wrapper is resolved once per `runAgentSetup` invocation. It prefers
`exec.LookPath("run-kit")` (the canonical name), then falls back to
`exec.LookPath("rk")`, then `os.Executable()`. Either LookPath hit yields the
STABLE Homebrew symlink (`/home/linuxbrew/.linuxbrew/bin/{run-kit,rk}` or
`/opt/homebrew/bin/{run-kit,rk}`, NOT the version-pinned Cellar path) — both
stable symlinks resolve to the same binary, so the order is functionally
equivalent, and the `resolveRkPath` test is order-agnostic (asserts only
non-empty + absolute). The `os.Executable()` fallback runs **without**
`filepath.EvalSymlinks` (resolution would pin the Cellar version and re-freeze the
hook). **Installed hooks embedding `…/bin/rk` remain valid indefinitely**: `rk`
stays a real on-PATH symlink (per the canonical-swap invariants — see
[architecture](/run-kit/architecture.md) § Homebrew Distribution), so a hook
resolved to `/opt/homebrew/bin/rk` keeps working. (`260709-gidk`) Before any merge
the path is run through `validateHookPath`: a path containing any of `' " $ ` backslash (all
shell-active inside the wrapper's double-in-single quoting) **fails the install
with a clear error** — reject-don't-escape (escaping would have to survive three
nested quoting layers; such paths never occur under Homebrew/conventional
layouts, so the error is essentially unreachable in practice and a caller — human
at a TTY or agent passing `--yes` — sees it and acts).

**JSON-merge install** (`mergeHooks`/`unmergeHooks`, pure functions over
`map[string]any` so tests skip the filesystem/prompt):

- Merges under the Claude shape
  `hooks → <Event> → [ { matcher?, hooks: [ { type:"command", command } ] } ]`.
- **Idempotent**: for each touched event array it **first** strips every existing
  rk-owned entry (once per event — an event may carry multiple rk hooks, e.g.
  `Notification` maps to both `waiting` and `idle`), **then** appends the fresh
  entries — so a re-run replaces in place and never duplicates.
- rk-owned entries are identified by `isRkEntry`, which
  matches **either generation** of the command string: the LEGACY marker
  `rkHookMarker` (which *is* `tmux.AgentStateOption`, `@rk_agent_state` — the old
  inlined one-liner carried the option name) **or** the const
  `rkHookMarkerAgentHook` (`" agent-hook "`, spaces included so it can't match an
  unrelated token). Matching both lets a re-run strip
  old-generation entries and replace them **in place** (no duplication), and lets
  `--uninstall` remove **both** generations. Non-rk hooks carry neither marker and
  are preserved untouched. (`260707-qfps`)
- `--uninstall` runs `unmergeHooks`, removing exactly the rk-owned entries; an
  event array that empties is deleted, and a `hooks` object that empties is
  deleted.
- **Diff + confirm before write**: `applyAgentHooks` (the hooks step
  `applyAgentConfig` runs — see § Installer Structure) renders `current` vs
  `proposed` as sorted indented JSON via the shared `renderArtifactDiff` helper; a
  no-op (identical) is reported and skipped without prompting; otherwise it routes
  the write decision through `consent.authorizeWrite` (see the § `rk agent-setup`
  consent flags above) — `--dry-run` shows the diff and skips the write,
  `--yes`/`-y` writes without prompting, an interactive TTY reads a `[y/N]` answer
  (`confirm`, default No) from the injected `io.Reader` (testable without a TTY),
  and a non-TTY invocation with neither flag **refuses** (error naming `--yes`,
  nothing written). On confirm, `writeSettings` writes mode **0600** (matching
  user-config sensitivity), creating `~/.claude/` via `MkdirAll` if absent. The
  legacy-skill cleanup (`removeLegacySkill`) is gated through the same
  `authorizeWrite` seam, so `--yes` authorizes the `os.RemoveAll` of the legacy
  `rk-display/` directory and `--dry-run` leaves it in place.

**Tolerant read** (`readSettings`): a missing, empty, or all-whitespace settings
file is treated as an empty object (never an error — install must work on a fresh
machine). A genuinely malformed (non-empty, non-JSON) file **surfaces an error
without writing** — anti-clobber: silently treating it as empty would overwrite
user config.

## Installer Structure — Hooks + Legacy Cleanup (`applyAgentConfig`)

`rk agent-setup` applies each agent through a thin `applyAgentConfig` wrapper that
runs, in order:

1. **`applyAgentHooks`** — the settings-hooks merge (the sole INSTALLED artifact,
   described above). Always runs.
2. **`removeLegacySkill`** — the one-release cleanup of the legacy `rk-display`
   skill (below). Runs only when the agent's `skillsDir` is non-empty.

Each step runs **independently** — its own tolerant read, diff/prompt, and no-op
report — so declining or no-op-ing one does not skip the other. `agentConfig`
carries a `skillsDir string` field; the Claude Code registry row sets it to
`filepath.Join(home, ".claude", "skills")`, and an **empty `skillsDir` means "no
legacy skill to clean for that agent"** — only the hooks merge runs (future
codex/copilot/gemini/opencode rows may leave it empty). `skillsDir` exists
**solely to locate the legacy skill for cleanup**.

### Legacy `rk-display` Cleanup (`removeLegacySkill`, one release only)

`removeLegacySkill` is a **cleanup-only** flow that removes a stale
user-global Claude Code skill at `{skillsDir}/rk-display/SKILL.md` (so
`~/.claude/skills/rk-display/SKILL.md` for Claude Code) left by an older run-kit
that once installed it. The visual-display context-injection role belongs to the
**`rk skill` bundle**, aggregated by the coming `shll agent-setup`. (`260717-agst`)

- **Runs on BOTH the install and uninstall passes.** `removeLegacySkill` is called
  from `applyAgentConfig` regardless of `--uninstall`. Rationale: re-running plain
  `rk agent-setup` is the documented upgrade action (`docs/site/install.md`), so
  most machines only ever reach the install path — a cleanup gated on `--uninstall`
  would never fire for them, stranding the file forever.
- **Uniform behavior across both passes** (keyed on the file's state, not the mode):
  - **Absent** file → **silent** in both modes. A fresh machine produces zero
    rk-display output.
  - **Marker-less** (user-rewritten) file → **left untouched with a skip note** (rk
    only removes files it owns).
  - **Marker-owned** file → **offer removal** (confirm prompt), then `os.RemoveAll`
    the whole `rk-display/` directory. Confirmed first because it deletes the entire
    directory, including any user-added files within it.
- **Recognition machinery**: the marker constants `rkDisplaySkillDir`/`rkDisplaySkillFile`/
  `skillManagedByMarker`, the tolerant `readSkill` (missing → empty, never an
  error), and the whole-file `skillHasMarker` predicate (the whole-file analogue of
  `isRkEntry` — rk owns the entire file, so a `managed-by: rk agent-setup`
  frontmatter-marker presence check gates the destructive removal). No content
  literal exists — the cleanup only LOCATEs and RECOGNIZEs, never writes.

## Lifecycle

Pane options die with the pane — **no GC, no state file, no cross-pane
ambiguity**. An option lives on exactly one pane of exactly one tmux server;
killing the pane (or the server) removes it. This is why the shell-command
reconciler is the only cleanup needed: a killed agent's pane either dies (option
gone) or reverts to a shell (reconciler zeros it).

## Migration — Clean Swap, No Dual-Source Fallback

The pane-map join carries only fab pipeline state: `paneMapEntry` holds
`change`/`stage`/`display_state` (not `agent_state`, `agent_idle_duration`,
`pr_url`, or `pr_number`), and `dedupEntries` priority is `Change > first-seen`.
See [architecture](/run-kit/architecture.md) § `internal/sessions`.

There is **no dual-source fallback**: until `rk agent-setup` has been run on a
machine, agent columns read unknown (`—`). Accepted for a single-operator
deployment — rollout is "deploy rk, run `rk agent-setup` once per machine"
(fallback code would contradict minimal-surface §IV and would linger). fab-kit
keeps writing `.fab-runtime.yaml` `_agents` until its own reader-side change
(fab-kit backlog `[ioku]`) lands — harmless coexistence, run-kit simply stops
reading the old sink.

## UI Surfacing

The `agentState` three-state value is a first-class UI input across every surface
(design authority `docs/specs/status-pyramid.md`, palette v3). (`260706-y1ar`) What consumes it:

- **`StatusDot` (palette-v3 two-family ladder)**: a fresh `agentState` on a
  non-fab window drives the **warm ad-hoc-agent family** — yellow working / orange
  PR (vs the cool fab family blue/green/purple, vs the gray floor). A `waiting`
  window of ANY tier gets an **additive constant-yellow pulsing halo** (core hue +
  shape untouched — never a hue-flip). `agentState === "idle"` is a ring;
  `active`/`waiting` are solid (mid-turn). See
  [ui-patterns](/run-kit/ui-patterns.md) § Status Dot.
- **Row Minimalism**: the `StatusDot` is the sidebar window row's ONLY status
  signal — no trailing stage-word + duration cluster (§ Window rows).
- **PANE panel L1 `agent` register**: the four-register view (output/agent/fab/PR)
  renders `agent waiting <dur>` on its own line, never muted by flowing output
  (the pierce rule); the `StatusDotTip` gains an `agent:` line on every tier
  (§ Pane panel four-register view, § Status Dot hover-card).
- **Attention rollups + nav**: `waiting` counts propagate as `WaitingBadge` chips
  (session row, Host-page server tile, board header, and — since
  `260708-4li7-sidebar-server-tile-waiting-badge` — the sidebar SERVER-panel
  server tile, the fourth badge surface), a pulsing board-pane seam, and the
  `Agent: Next waiting` command-palette navigation (§ Attention Surfacing). See
  [ui-patterns](/run-kit/ui-patterns.md) § Attention Surfacing for the surface
  list and the sidebar tile's inline-flex placement (distinct from the Host-page
  tile's absolute top-right, to avoid the sidebar tile's hover-action cluster).
- **Web Push on sustained waiting**: the SSE hub fires one push per sustained
  (≥15s) waiting episode — see [architecture](/run-kit/architecture.md)
  § Web Push on Sustained Waiting.

These surfaces consume the window-level rollup + `waiting > active > idle`
precedence + the `formatAgentDuration` value (present for `waiting`/`idle`)
documented above.

## Chat Session Identity (`@rk_chat`)

A **second** pane user option, written by the **same** `rk agent-hook` binary on
the same hook fires, ties a pane to the **live** agent chat session running in
it. It is the keystone of the HTML-agent-chat-view stack (chat as a **view over
the pane** — the pane stays the agent's parent process, Constitution VI): the
chat-read backend has no key to read a transcript by, and a frontend toggle
nothing to gate on, without it. The scope here is backend + hooks + spec — there
is no frontend and no read/stream endpoint. The
cross-repo contract is in [`docs/specs/agent-state.md`](../../specs/agent-state.md)
§ Chat Session Identity; this section records what run-kit actually implemented.
(`260713-nh86`)

**Why a hook, not derivation.** Claude Code sessions are disk-owned — each
persists to `~/.claude/projects/<cwd-slug>/<session-id>.jsonl` and any process in
the cwd can resume by id — but *multiple transcripts share a cwd*, so "which
session is live in this pane" is underivable from disk/tmux/git. It exists only
in the hook input JSON, exactly the class of fact **Principle X** reserves for
hooks.

### The Convention

| Property | Value |
|----------|-------|
| Option | `@rk_chat` (const `tmux.ChatOption`) |
| Scope | tmux **pane** user option (`set-option -p`) |
| Value | `"<provider>:<session-ref>"` |
| Example | `claude:6f0d9e2a-1c3b-4f7e-9a2d-8b5c4e1f0a37` |

- **`<provider>`** — a lowercase token (`[a-z][a-z0-9_-]*`) equal to the
  `rk agent-setup` registry agent name (v1: `claude`; codex/gemini are additive).
  The backend routes on this prefix; the frontend gates on presence.
- **`<session-ref>`** — a provider-defined opaque reference. For `claude` it is
  the **session UUID only** — NOT the transcript path (the path is derivable from
  the UUID by glob, so Principle X says carry only the UUID; a colon-free value
  also keeps parsing trivial). The value is split on the **first** colon
  (providers never contain a colon; a ref might in principle, so the tail is the
  ref verbatim).
- `tmux.ChatOption = "@rk_chat"` is declared **once** in `internal/tmux/tmux.go`;
  `cmd/rk/agent_hook.go` aliases it (`chatOption = tmux.ChatOption`) rather than
  re-declaring — one source of truth per binary (A-021), same discipline as
  `AgentStateOption`.

### Reader: parse + reconcile (`internal/tmux`)

- **`paneFormat` carries an 8th field `#{@rk_chat}`** (after `#{@rk_agent_state}`);
  `parsePanes`'s skip-guard is `< 8`. Zero extra subprocess — it rides
  the existing per-session `list-panes` call.
- **`PaneInfo` carries `ChatProvider string`** (`json:"chatProvider,omitempty"`)
  **and `ChatSessionRef string`** (`json:"chatSessionRef,omitempty"`), parsed once
  in Go so no consumer re-splits the raw value.
- **`parseChatRef(raw) (provider, ref string)`** — pure helper: trims, splits on
  the first colon, validates the provider via `isChatProvider` (`[a-z][a-z0-9_-]*`,
  non-empty) and the ref via `isChatRef` (non-empty, no whitespace/control). Any
  violation ⇒ `("", "")` (wholly unknown, mirroring `parseAgentState` tolerance).
  A well-formed **unregistered** provider (e.g. `codex:…`) is NOT rejected —
  presence-gating is provider-agnostic; adapters are additive.
- **Chat reconciliation shares agent-state's per-pane liveness decision.**
  `@rk_chat` carries **no pid of its own** (the two-segment schema is fixed), so
  liveness comes from the **same pane's `@rk_agent_state`**, written by the same
  binary on the same fires. The `parsePanes` reconciler uses a single shared
  `stale` boolean:
  - agent-state carries a pid (3-segment): `stale = !agentProcessAlive(pid)`.
  - otherwise (no agent-state yet, or a legacy 2-segment value):
    `stale = isShellCommand(command)`.
  - when `stale`, **both** the agent-state fields **and** the chat fields are
    zeroed. A dead pid zeroes both; a plain-shell/htop pane never surfaces chat.
  Accepted **false-negative class** (mirrors the agent-state legacy fallback): a
  *wrapped* launch (`pane_current_command` = `bash` with claude inside) that
  `SessionStart` stamped but which has no pid-bearing agent-state yet suppresses
  chat until the first state write lands a pid — it self-heals at the first
  prompt. A live pid-bearing agent under a `bash` wrapper keeps its chat
  (liveness wins over the shell heuristic).
- **No disk validation** — the reconciler does NOT stat
  `~/.claude/projects/**/<ref>.jsonl`. Per-pane-per-poll filesystem I/O guarding a
  pathological case; a live agent's transcript exists by construction, and the
  later chat-read endpoint surfaces a missing transcript naturally as a read
  error.

### Writer: `rk agent-hook` stdin-JSON seam + chat stamp (`cmd/rk/agent_hook.go`)

The hook reads a `session_id` from the harness's hook JSON on stdin, scoped to
session identity only — state still comes from the positional arg and pid from the
process tree, and state derivation stays in the settings matchers. The stdin seam:

- **`readHookSessionID(r io.Reader) string`** — the conservative stdin parse:
  - **TTY guard** — if `r` is an `*os.File` in char-device mode
    (`os.ModeCharDevice`), it is NOT read, so a manual `rk agent-hook` invocation
    in a terminal never blocks on stdin.
  - **Bounded** — reads through `io.LimitReader(r, hookStdinReadLimit)` where
    `hookStdinReadLimit = 1 << 20` (~1 MiB), so a hung/pathological producer can't
    stall the agent's turn.
  - **Single object** — `json.Decoder.Decode` into `hookInput{SessionID string
    json:"session_id"}` returns after ONE complete JSON object, with no dependence
    on stdin EOF (which the harness docs don't guarantee). Unknown JSON keys are
    tolerated.
  - **Validated** — `isValidSessionID` (non-empty, no whitespace/control) mirrors
    the reader's `isChatRef` so a value the reader would reject is never stamped.
    (The rule is duplicated in the hook binary because the reader's `isChatRef` is
    unexported — small and stable, deliberate.)
  - Injected via the `hookStdinFn` package-var seam (`func() io.Reader { return
    os.Stdin }`) so tests supply an in-memory reader.
  - Every failure path returns `""` (no stamp) — never an error.
- **`writeChat` / `writeChatImpl`** (behind the `writeChatFn` seam, mirroring
  `writeAgentStateFn`): runs `tmux [-S <socket>] set-option -pt <pane> @rk_chat
  <provider>:<sessionID>` via `exec.CommandContext` + `agentHookCmdTimeout` (5s),
  socket derived from **`tmux.OriginalTMUX`** (not `os.Getenv("TMUX")`, same
  reason as the agent-state write — see § Target the pane's server). `provider` is
  a fixed registry comm literal and `sessionID` a pre-validated discrete argv
  element — nothing user-derived is interpolated into a shell string
  (Constitution I). Errors are swallowed (never-fail).
- **Token dispatch** — `runAgentHook` takes a **token** param.
  `writeState := isAgentState(token)`; a token that is neither a canonical
  state nor `agentHookStampToken` is a silent no-op. Ordering:
  1. `active|waiting|idle` → resolve pid via the ancestor walk, `writeAgentState`,
     **then** stamp `@rk_chat` if stdin yielded a session id. The chat stamp is
     **ordered after** the agent-state write, so the reader always has the pid it
     needs to judge chat liveness.
  2. **stamp-only token** (`agentHookStampToken = "stamp"`) → stamp `@rk_chat`
     ONLY, no agent-state write. This is the token the SessionStart row uses.
  3. anything else → no-op.
- **Stamp on EVERY fire that yields a session id** (states and the stamp token
  alike), not SessionStart-only, because **session ids rotate on `/clear` and
  `/compact`** (a one-time stamp goes stale mid-pane-lifetime); every-fire refresh
  also stamps already-running agents on `brew upgrade rk` with zero settings churn
  (the `260707-qfps` indirection dividend — the installed wrappers already pipe
  stdin through to the binary).
- The never-fail/always-exit-0 contract
  (`TestAgentHookCmdNeverErrorsOnMalformedInvocation`) holds — the stdin
  seam adds no new error path.

### Installer: SessionStart registry row (`cmd/rk/agent_setup.go`)

The Claude `agentRegistry` carries a SessionStart entry:

| Event | Matcher | Writes |
|-------|---------|--------|
| `SessionStart` | — | `@rk_chat` **stamp only** (token `stamp`; **no** `@rk_agent_state`) |

- The installed command uses the standard `agentStateHookCommand(rkPath, state, comm)`
  wrapper — the positional-token `state` parameter carries the
  `stamp` literal from `h.state = agentHookStampToken`, producing
  `sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<abs-rk>" agent-hook --agent claude stamp 2>/dev/null || true'`.
  The `isRkEntry` marker
  (`" agent-hook "`) matches it, so idempotent re-run replacement and
  `--uninstall` need no marker changes.
- **SessionStart writes no agent-state** because `source=compact` fires
  **mid-turn** — an `idle` state write there would clobber a live `active` state.
  Stamp-only is correct for all four sources (`startup`/`resume`/`clear`/
  `compact`). SessionStart fires within seconds of session start, so the option
  appears **before any prompt is submitted** (the acceptance bar) and re-stamps on
  every session-id rotation.
- **No `SessionEnd` registration** — writer-side clearing is rejected. Reader-side
  reconciliation must exist anyway for crash/kill paths, so a `SessionEnd` clear
  would add a settings entry without removing any reader logic.

### Surfacing: window rollup (`internal/sessions`)

- **`WindowInfo` carries `ChatProvider`/`ChatSessionRef`** (same JSON tags), filled
  in `FetchSessions` beside the `rollupAgentState` call by the pure
  **`rollupChat(panes) (provider, ref string)`** helper: the **active pane's**
  reconciled chat if set, else the **first pane** (in tmux pane order) carrying
  one; `("", "")` when none. Deterministic — the common case is one agent pane per
  window; a later change can revisit the multi-pane rule without a backend
  contract break because **per-pane truth also ships** on
  `PaneInfo.ChatProvider/ChatSessionRef`.
- Both `GET /api/sessions` and the SSE `event: sessions` payload carry these
  fields via the existing `ProjectSession` marshal — **per window
  and per pane** — with no new endpoint and no new SSE event type. See
  [architecture](/run-kit/architecture.md) § API Layer.

### Lifecycle

Same as `@rk_agent_state`: pane options die with the pane — **no GC, no state
file**. Reader-side reconciliation is the only clearing path (there is
deliberately no writer-side clear and no `SessionEnd` row, per above).

### Migration — two independent seams

Mirrors the `@rk_agent_state` binary-vs-settings split:

- **Every-fire stamping is binary-only** — it ships in `rk agent-hook` and reaches
  already-running agents on `brew upgrade rk` with **no settings churn and no
  session restarts** (the installed wrappers already pipe stdin through).
- **The `SessionStart` registry row is an event-mapping change** and follows the
  established rule: **one `rk agent-setup` re-run + session restarts** (harnesses
  snapshot hook config at session start). Until that re-run lands, running agents
  still get `@rk_chat` from the every-fire stamping on their existing
  `active`/`waiting`/`idle` hooks; the SessionStart row only advances *when* the
  first stamp lands (within seconds of start, before any prompt).

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
confirmation before mutating user-global config, with `--uninstall`. Each artifact
(today: the hooks merge, plus the cleanup-only `removeLegacySkill`) runs its own
diff-and-confirm through `applyAgentConfig`, so declining or no-op-ing one does not
skip the other.
**Why**: it mutates `~/.claude/settings.json` (user-global) — the user chose
"explicit feels honest" over agentdock's silent sync. A marker-keyed idempotent
merge is the only way "update rk entries in place, never touch non-rk hooks" is
satisfiable.
**Rejected**: silent background sync (surprising for a user-config mutation);
per-project install (defeats the "any session anywhere" goal — the whole point is
user-global registration).
*Introduced by*: `260705-dmex-generic-agent-state-tier`

### Non-interactive consent: `--yes`/`--dry-run` + non-TTY refusal (not a silent decline)
**Decision**: gate every `agent-setup` write through a `consent` struct
(`yes`/`dryRun`/`stdinIsTTY`) and one `authorizeWrite` decision point:
`--dry-run` shows the diff and writes nothing (and **wins over `--yes`**),
`--yes`/`-y` writes without prompting, a TTY with neither flag reads `[y/N]`, and
a **non-TTY with neither flag REFUSES** with an error naming `--yes` (nothing
written). Detect the TTY with `term.IsTerminal`, not a bare `os.ModeCharDevice`
check.
**Why**: toolkit Principle 1 requires a warranted confirmation be satisfiable
by a flag AND a non-TTY invocation refuse rather than hang or silently succeed —
the prior behavior (a non-TTY invocation hit EOF on the `[y/N]` read and silently
declined, exiting 0) is a success-looking no-op, the exact agent trap the
principle targets (an agent "installs" the hooks, gets exit 0, and nothing
happened). Principle 5 requires a destructive write support `--dry-run`, and a
dry-run that could still write would break its accurate-preview promise, so
dry-run wins under contradictory intent. `term.IsTerminal` (a real ioctl) is
required because `os.ModeCharDevice` classifies `/dev/null` — the exact
`agent-setup </dev/null` shape an agent uses — as a terminal, which would make the
refusal silently not fire. The `[y/N]` prompt suffix is emitted only on the
interactive path so the auto-answered paths don't dangle an unread prompt that
reads as a hang in a transcript.
**Rejected**: keeping the silent EOF-decline (the agent trap); a `--dry-run` that
still writes when combined with `--yes` (violates the preview promise); a bare
`os.ModeCharDevice` TTY check (false-classifies `/dev/null`, refusal never fires).
*Introduced by*: `260717-c424-toolkit-standards-conformance`

### Whole-file skill ownership by frontmatter marker; thin pointer, not embedded recipe
**Decision**: the legacy `rk-display` skill is a whole file rk owns outright (no
merge), recognized by the `managed-by: rk agent-setup` frontmatter marker checked
by `skillHasMarker`. `removeLegacySkill` uses that marker to gate the destructive
directory removal (`os.RemoveAll` on `rk-display/`).
**Why**: the marker is the whole-file analogue of `isRkEntry` — it gates the
destructive removal so a user rewrite that drops the marker is left untouched,
without any out-of-band ownership manifest (Constitution §II — no persistent state
store). The visual-display capability content ships in the binary via the `rk skill`
bundle / `rk context` rather than a frozen skill file (the **same anti-freeze
principle as `rk agent-hook`**): capability content reaches agents on
`brew upgrade rk` with no skill-file churn.
**Rejected**: tracking ownership in a manifest/state file (Constitution §II);
embedding the recipe/server-URL/pane-identity in a skill body (re-freezes the exact
content `rk context` exists to keep current); a SessionStart hook / CLAUDE.md
pointer / launch-time `--append-system-prompt` injection / MCP `display_html` tool
(all rejected in intake — compaction cost, passivity, missing hand-launched agents,
and Constitution §IV minimal surface respectively).
*Introduced by*: `260714-popk-rk-display-skill-agent-setup` (marker-recognition
repurposed for cleanup by `260717-agst`)

### One source of truth per binary for the convention strings
**Decision**: `cmd/rk/agent_setup.go` aliases `tmux.AgentStateOption` /
`tmux.AgentState*` rather than re-declaring `"@rk_agent_state"` and the state
literals locally; `cmd/rk/agent_hook.go` (the writer) likewise aliases the same
`tmux.AgentState*` constants and reuses `agentRegistry`, so writer and reader have
one source per binary. (`260707-qfps`)
**Why**: the option name and states are the cross-repo contract; a second copy in
the installer would let the writer and the reader drift (A-021, resolved at
rework cycle 1 after review flagged the local re-declaration).
*Introduced by*: `260705-dmex-generic-agent-state-tier`

### Stable interface in settings, logic in the binary (`rk agent-hook`)
**Decision**: install a thin, never-changing wrapper into harness settings that
delegates to a new `rk agent-hook` subcommand; put ALL logic (comm-validated
ancestor walk, value formatting, `tmux set-option` write) in the Go binary.
**Why**: a hook logic fix reaches every running agent on `brew upgrade rk`, with
no settings churn and no session restarts. An inlined one-liner would be frozen
twice (in `~/.claude/settings.json` at install time and in the harness's
session-start snapshot), letting a binary-updated reconciler and a settings-frozen
writer skew and suppress agent state fleet-wide.
**Rejected**: keep raw one-liners + drift detection (a doctor check / UI
surfacing — mitigates *discovery* of the skew, not the fleet-wide migration
itself); dual-path hook (binary-if-present + pure-tmux fallback inline — the
fallback string IS the frozen logic being removed, and doubles the surface). No
pure-tmux fallback when the binary is missing: silence is acceptable because the
PID-liveness reconciler already clears state from dead agents and a stranded
value clears when the agent/pane dies.
*Migration*: *logic* changes need no re-setup or restart. Matcher / event-mapping
changes still need re-setup + restart (that mapping lives in the settings matchers).
*Introduced by*: `260707-qfps-rk-agent-hook-indirection`

### Event→state mapping stays in settings; state-literal args + `--agent` flag
**Decision**: the event→state mapping (which harness event installs which
state, including the two `Notification` matchers) lives in the settings matchers;
the wrapper passes a fixed state literal + `--agent <comm>`. The binary reads the
harness's hook JSON on stdin **only** to extract `session_id` for the `@rk_chat`
stamp — NOT to derive state, which stays driven by the settings matchers + the
positional token (see § Chat Session Identity → Writer). (`260713-nh86`)
**Why**: the mapping churns far less than the logic, and matcher changes require a
settings write regardless; stdin-JSON parsing does not change the installed
command shape, so state derivation via stdin gains nothing over the matchers.
*Introduced by*: `260707-qfps-rk-agent-hook-indirection`

### Reject (don't escape) shell-unsafe rk paths; never Cellar-pin
**Decision**: resolve `<abs-rk>` via `LookPath("run-kit")` → `LookPath("rk")` →
`os.Executable()` without `EvalSymlinks`, and `validateHookPath`-reject any path
containing `' " $ ` backslash with a clear install-time error rather than escaping
it or silently falling back to bare `rk`.
**Why**: hook-env PATH is untrustworthy, so the absolute path must be embedded;
`EvalSymlinks` would pin the version-locked Cellar path and re-freeze the hook
(defeating the whole change); escaping would have to survive three nested quoting
layers (shell-in-shell-in-JSON — fragile to write and review); a bare-`rk`
fallback reintroduces the PATH dependency the absolute path exists to remove. Such
paths never occur under Homebrew/conventional layouts, so the install-time error is
essentially unreachable, and whatever caller triggered the install — a human at a
TTY or an agent passing `--yes` — sees the error and can act.
*Introduced by*: `260707-qfps-rk-agent-hook-indirection`

### Session-ref = the session UUID only (not the transcript path)
**Decision**: `@rk_chat`'s `<session-ref>` for `claude` is the session UUID
alone, not the transcript path and not both.
**Why**: the UUID is the official identity for the SDK read APIs, and the
transcript path is **derivable** from the UUID (the filename IS the UUID —
`~/.claude/projects/<cwd-slug>/<uuid>.jsonl`, findable by glob), so **Principle X**
("hooks carry only the underivable") says carry only the UUID. A colon-free value
also keeps the first-colon split trivial.
**Rejected**: stamping the full path (redundant with the UUID, and path is
derivable); stamping both (schema bloat, two sources to keep in sync).
*Introduced by*: `260713-nh86-chat-session-identity`

### Liveness borrowed from the same pane's `@rk_agent_state` (no pid on `@rk_chat`)
**Decision**: `@rk_chat` carries no pid segment; the chat reconciler reuses the
same pane's agent-state pid/shell reconciler outcome (a single shared `stale`
boolean in `parsePanes`) rather than adding a second liveness source.
**Why**: one liveness signal per pane, written by the same binary on the same
fires — a dead agent must zero BOTH agent-state and chat, and it does so from one
decision. The reconciler restructure (`agentPID > 0 ? !alive : isShellCommand`
→ `stale`, then zero both field-sets when `stale`) keeps the two tiers provably in
lockstep.
**Rejected**: adding a `:<pid>` segment to `@rk_chat` (schema bloat + a duplicate,
potentially-skewing liveness source); a separate chat-only liveness heuristic.
*Introduced by*: `260713-nh86-chat-session-identity`

### Every-fire stamp + stamp-only `SessionStart`; no `SessionEnd`
**Decision**: stamp `@rk_chat` on **every** hook fire that yields a `session_id`
(the binary reads stdin JSON), **plus** a new SessionStart registry row that is
**stamp-only** (writes `@rk_chat`, never `@rk_agent_state`). Clearing is
**reader-side reconciliation only** — no writer-side clear, no `SessionEnd` row.
**Why**: session ids rotate on `/clear` and `/compact` (re-verified 2026-07-13),
so a one-time stamp goes stale mid-pane-lifetime — every-fire refresh fixes that
AND reaches already-running agents on `brew upgrade rk` with zero settings churn
(binary-only). SessionStart gives "within seconds of session start" before any
prompt, and is stamp-only because `source=compact` fires mid-turn where an `idle`
write would clobber a live `active`. Reader reconciliation is mandatory anyway for
crash/kill paths, so a `SessionEnd` clear adds a settings entry without removing
any reader logic (mirrors agent-state's no-GC lifecycle).
**Rejected**: SessionStart-only stamping (goes stale on id rotation); a
SessionStart *agent-state* write (clobbers a live `active` on compact); a
`SessionEnd` writer-side clear (redundant with mandatory reconciliation).
*Introduced by*: `260713-nh86-chat-session-identity`

### Bounded, TTY-guarded, single-object stdin parse; validated before write
**Decision**: `readHookSessionID` is TTY-guarded (`os.ModeCharDevice` — a manual
terminal invocation is never read), bounded (`io.LimitReader`, ~1 MiB), decodes a
**single** JSON object (`json.Decoder.Decode`, no EOF dependence), and validates
`session_id` with the same rule the reader applies to a ref before stamping.
Every failure is silent — no stamp — and the agent-state write still proceeds.
**Why**: the harness docs don't guarantee stdin EOF semantics, so a single-object
Decode (not `io.ReadAll`) is the correct primitive; the TTY guard keeps a manual
`rk agent-hook` from blocking; the bound guards a hung producer; validating before
write keeps a value the reader would reject from ever being stamped (writer/reader
symmetry). This preserves the tested never-fail contract with no new error path.
**Rejected**: `io.ReadAll` to EOF (can block indefinitely — no EOF guarantee);
stamping the raw `session_id` unvalidated (a whitespace/control value the
reconciler would silently drop).
*Introduced by*: `260713-nh86-chat-session-identity`

### Subagent (Task-tool) fires carry the ROOT session id — no event restriction
**Decision**: stamp `@rk_chat` on **all** registered events (no restriction to
`UserPromptSubmit`/`SessionStart`/`Stop`); the stdin `session_id` on subagent /
`PreToolUse` fires is treated as the pane's ROOT session, not a sidechain id.
**Why**: this was the change's one open question (intake Assumption 10, Tentative —
the harness docs are silent on subagent hook payloads). **Resolved empirically at
apply**: across **1489** subagent (Task-tool) transcript files on this host, every
sidechain line carried `sessionId` = the PARENT/root session UUID (subagent
transcripts nest under `<root-uuid>/subagents/agent-*.jsonl`); **zero** carried a
distinct id. Root-session identity is exactly what stamping needs, so no event
restriction is required — upgraded Tentative → Confident.
**Rejected (as unneeded)**: restricting stamping to
`UserPromptSubmit`/`SessionStart`/`Stop` — the worst case it guarded against (a
transiently-wrong sidechain ref that the next main-session fire corrects) does not
occur.
*Introduced by*: `260713-nh86-chat-session-identity`

### Window rollup: active pane first, else first set; per-pane truth also ships
**Decision**: `rollupChat(panes)` returns the active pane's chat if set, else the
first pane (in tmux order) carrying one; the per-pane `ChatProvider`/
`ChatSessionRef` are serialized alongside the window rollup.
**Why**: additive JSON with consumers not yet built (cheap to revise later), the
common case is one agent pane per window, and shipping per-pane truth means a
later multi-pane rule change needs no backend contract break. Mirrors
`rollupAgentState`'s active-first precedence and pure-helper shape.
**Rejected**: a window-only rollup with no per-pane fields (would force a contract
break to revisit the multi-pane rule).
*Introduced by*: `260713-nh86-chat-session-identity`

### No disk validation of the referenced transcript
**Decision**: the reconciler does NOT stat `~/.claude/projects/**/<ref>.jsonl`.
**Why**: it would add per-pane-per-poll filesystem I/O to guard a pathological
case; a live agent's transcript exists by construction, and the later chat-read
endpoint surfaces a missing transcript naturally as a read error. Keeps chat
identity derived purely from tmux pane options at request time (Constitution II).
**Rejected**: stat-on-reconcile (I/O cost with no correctness gain for the live
case).
*Introduced by*: `260713-nh86-chat-session-identity`

### Target the pane's server via `tmux.OriginalTMUX`, not `$TMUX`
**Decision**: derive the `-S <socket>` server-targeting prefix from
`tmux.OriginalTMUX`, not `os.Getenv("TMUX")`.
**Why**: `internal/tmux`'s `init()` unsets `$TMUX` on import (so the daemon's bare
tmux calls hit the default socket); `OriginalTMUX` captures the caller's real
socket in a var initializer that runs before that `init()`. It is the established
seam (same as `riff.go` / `context.go`). Deriving `-S` from it also survives hook
contexts like `tmux run-shell` that set `$TMUX_PANE` but not `$TMUX`.
*Introduced by*: `260707-qfps-rk-agent-hook-indirection`
