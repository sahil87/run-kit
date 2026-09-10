# Intake: `rk mux panes --json` — `has_agent` per row

**Change**: 260910-7pek-mux-panes-has-agent
**Created**: 2026-09-10

## Origin

Backlog item `[7pek]` (fab/backlog.md, 2026-09-10, "fab-kit operator follow-up"), one-shot `/fab-new 7pek` with no prior discussion in the conversation:

> rk mux panes --json: add `has_agent` (bool) per row so consumers get liveness with the enumeration. mux_panes.go rows carry command/cwd/agent_state/agent_state_duration; mux_process.go already computes has_agent from the pane-pid process tree with the agent-state-pid cross-check. Because agent_state can retain a stale value after the agent exits, fab's `fab operator tick-start --diff` re-implements the tree walk to emit its agent_exited delta (fab-kit _cli-fab.md § fab operator tick-start, detection semantics: shell foreground AND no live agent in the tree) — the most intricate code in that binary. With has_agent on the row, fab drops the walk: agent_exited := command is a shell basename && has_agent == false. Cost note: one tree walk per pane per enumeration — do it lazily only for rows whose command is a shell (sh/bash/zsh/fish/dash/ksh/tcsh/csh/nu), same trigger fab uses today; null when the walk fails. Document in rk skill mux § panes and the identity-key contract fab mirrors.

Gap analysis: no existing mechanism covers this. `rk mux process <target> --json` computes `has_agent` for ONE pane (a target-scoped verb, one tmux round trip plus a tree walk per call); `rk mux panes --json` carries `agent_state` but that option is instrumentation, not liveness (a legacy two-segment value can outlive its agent, and the pid-carrying form is reconciled to `null` — "unknown", not "no agent"). Nothing today gives a consumer per-row liveness from the enumeration.

## Why

**Problem.** fab's operator tick (`fab operator tick-start --diff`) needs to know, per monitored pane, whether the agent that was running there has exited so it can emit `agent_exited`. Its enumeration source is already `rk mux panes --json` (cli-layering Part 8 delegation), but the row set does not answer the liveness question, so fab re-implements the pane-pid process-tree walk itself — `pane_process.go` (`agentBinaryNames`, `classifyProcess` with a bounded cmdline fallback, `paneAgentAlive`) plus the shell-foreground trigger in `operator_tick_start.go`. That is the most intricate code in the fab binary and it duplicates a walk rk already owns in `mux_process.go` (`discoverProcessTree` on linux via `/proc`, on darwin via two `ps` passes; `markAgentPID` cross-check against the reconciled agent-state pid; `hasAgentInTree`).

**Consequence of not fixing.** Two binaries keep two tree walkers with drifting classification tables (rk's comm table today knows `claude`/`claude-code`/`codex`/`gemini`/`copilot`; fab's knows `claude`/`claude-code` plus every configured provider's `interactive_command` binary and matches the first two cmdline tokens). The layering rule — rk owns the tmux/agent substrate, fab owns choreography — is violated on exactly the substrate fact ("is there a live agent process in this pane?") where drift hurts most: a false `agent_exited` respawns or escalates a live worker.

**Why this approach.** Put the liveness bit on the enumeration row rk already emits. Consumers then get identity + state + liveness in one call, and fab's detection collapses to a predicate over the row: `agent_exited := IsShellCommand(command) && has_agent == false`. The walk is lazy — only rows whose foreground command is a shell are walked, which is precisely the trigger fab uses today, so the added cost is bounded to the rows where the question is open (an agent TUI in the foreground is not a candidate for "exited"). Alternatives rejected: (a) a new `rk mux process --all` bulk verb — a second enumeration surface duplicating `panes`; (b) walking every row unconditionally — pays the darwin `ps` cost on rows whose answer nobody consumes; (c) deriving liveness from `agent_state` alone — the stale-value problem is the reason the walk exists.

## What Changes

### 1. `has_agent` on the `rk mux panes --json` row

`muxPanesRow` (app/backend/cmd/rk/mux_panes.go) gains one trailing field:

```go
type muxPanesRow struct {
	// ... existing 13 fields unchanged, same order ...
	AgentStateDuration *string `json:"agent_state_duration"`
	HasAgent           *bool   `json:"has_agent"`
}
```

Semantics (tri-state, always present as a key):

| Row's foreground `command` | Walk runs? | `has_agent` |
|---|---|---|
| shell basename (`sh` `bash` `zsh` `fish` `dash` `ksh` `tcsh` `csh` `nu`) | yes | `true` when the pane-pid process tree contains a node classified `agent` (comm/cmdline table OR the agent-state pid cross-check); `false` otherwise |
| shell basename, but the walk fails (pane pid unavailable/0, discovery error) | attempted | `null` |
| anything else (`node`, `claude`, `htop`, …) | no | `null` — "not evaluated", not "no agent" |

`true`/`false` is therefore only ever asserted for shell-foreground rows; `null` means rk offers no liveness evidence for that row. A consumer's "exited" predicate is `IsShellCommand(command) && has_agent == false`; a `null` on a shell row is a failed walk and the consumer decides how to fail (fab today fails toward emitting).

Example (`rk mux panes --json`, a live claude worker behind a wrapper shell, an idle shell pane, and an agent TUI in the foreground):

```json
[
  {
    "session": "work", "session_id": "$3",
    "window_index": 0, "window_id": "@3", "window_name": "editor", "window_active": true,
    "pane": "%5", "pane_index": 0, "pane_active": true,
    "command": "zsh", "cwd": "/home/x/code/repo",
    "agent_state": "active", "agent_state_duration": null,
    "has_agent": true
  },
  {
    "session": "work", "session_id": "$3",
    "window_index": 0, "window_id": "@3", "window_name": "editor", "window_active": true,
    "pane": "%6", "pane_index": 1, "pane_active": false,
    "command": "zsh", "cwd": "/home/x/code/repo",
    "agent_state": null, "agent_state_duration": null,
    "has_agent": false
  },
  {
    "session": "work", "session_id": "$3",
    "window_index": 1, "window_id": "@4", "window_name": "agent", "window_active": false,
    "pane": "%7", "pane_index": 0, "pane_active": true,
    "command": "node", "cwd": "/home/x/code/repo",
    "agent_state": "idle", "agent_state_duration": "5m",
    "has_agent": null
  }
]
```

The key is appended LAST so the existing 13-key prefix is byte-stable; fab's `rkPaneRow` (pane_map.go) decodes with `encoding/json` defaults and ignores unknown keys, so an older fab keeps working against a newer rk. The default table output is unchanged — no new column (the table is the human view; `command` + `AGENT` already read well, and `has_agent` is a machine field for the enumeration consumer). <!-- assumed: table unchanged — JSON-only field; a human column can be added later without breaking anything -->

### 2. Lazy trigger: `tmux.IsShellCommand` widened to the nine shells

`internal/tmux/tmux.go` `shellCommands` today holds `bash zsh fish sh dash`. It becomes the nine-name set the backlog specifies — `sh bash zsh fish dash ksh tcsh csh nu` — and stays the ONE predicate (its own comment forbids copying the set). The three existing readers (the legacy two-segment reconciler fallback, the `mux send` unknown-state warning, and the sessions rollup) inherit the widened set, which is correct for all of them: a `ksh`/`tcsh`/`csh`/`nu` foreground is as much "no agent, plain shell" as `bash` is. `#{pane_current_command}` is already a basename, so no path-stripping is added.

### 3. Per-pane pid + agent pid ride the existing `list-panes` call

To walk lazily without an extra tmux round trip per row, `paneFormat` (internal/tmux/tmux.go) gains a 12th field `#{pane_pid}`, and `PaneInfo` gains two fields that are NOT serialized (the dashboard `/ws/state` payload must not change):

```go
type PaneInfo struct {
	// ... existing fields ...
	// PanePID is the pane's shell PID (#{pane_pid}) — the root of the process
	// tree the mux verbs walk. AgentPID is the pid segment of a 3-segment
	// agent-state value after reconciliation (0 when absent or stale) — the
	// instrumented agent's pid used to cross-check the walk. Neither is a
	// dashboard field.
	PanePID  int `json:"-"`
	AgentPID int `json:"-"`
}
```

`parsePanes` already parses the agent pid (`parseAgentState` returns it; the reconciler consumes it) — it now also stores it; `AgentPID` is zeroed on the same `agentStateStale` condition that zeros `AgentState`. The field-count guard and every `parsePanes` fixture in `tmux_test.go` move from 11 to 12 fields. `rk mux process` keeps using `PanePIDCtx`/`PaneFactsCtx` (single-pane round trips) — those are the right shape for a target-scoped verb.

### 4. One shared walk helper, used by `process` and `panes`

Extract the "tree → cross-check → has_agent" core from `runMuxProcess` into a helper in mux_process.go:

```go
// paneHasAgent discovers pid's process tree, reclassifies the agentPID node
// as agent when agentPID > 0 (instrumentation beats heuristics), and reports
// whether any node classifies agent. Discovery goes through
// muxProcessDiscoverFn so both verbs share one seam and one fake.
func paneHasAgent(ctx context.Context, pid, agentPID int) (bool, error)
```

`runMuxProcess` calls it (behavior unchanged, still prints the tree it discovered — so the helper returns the tree too, or the tree walk is split into discover + classify; the plan chooses). `runMuxPanes` calls it only when `tmux.IsShellCommand(p.Command)`, passing `p.PanePID` and `p.AgentPID`; `PanePID == 0` short-circuits to `null` without calling discovery. A helper error → `null` for that row, no stderr line (stderr stays silent on success per the R3 test; the enumeration never fails because one walk failed). Every walk runs under the existing `muxCmdTimeout` context.

### 5. Classification parity with fab's current detection

fab's `agentBinaryNames` + `classifyProcess` (fab-kit `pane_process.go`) recognize `claude`/`claude-code` plus every provider's `interactive_command` leading binary, matching comm first and then the first two cmdline token basenames. rk's `classifyProcess` (mux_process.go) is comm-only over `claude claude-code codex gemini copilot`. Once fab drops its walk, rk's table is the only line of defense for UNINSTRUMENTED agents (no agent-state pid to cross-check — a hook-less spawn, or a pane whose state reconciled away), so rk must be at least as strong or `has_agent` regresses fab:

- The agent name set is derived from `agentRuntimes()` (cmd/rk/agent_registry.go): the union of each runtime's `binary` and `comm` values (`claude codex gemini copilot kimi kimi-code opencode agy`) plus `claude-code`, EXCLUDING `node` (gemini's comm — a bare `node` is not agent evidence; it stays classified `node`). One derivation, no second hand-written table.
- A bounded cmdline fallback mirrors fab: when comm does not match, the basenames of the first two `cmdline` tokens are checked against the same set (so `node /usr/local/bin/gemini` classifies `agent`); tokens beyond the second are never consulted — prompt text in argv must not become liveness evidence.

This also upgrades `rk mux process` (same function) — its skill paragraph's classification list is updated accordingly.

### 6. Documentation

- `docs/site/skill/mux.md` (the source; `scripts/sync-skill.sh` copies it to `app/backend/cmd/rk/skill/mux.md` — both must end identical): § `rk mux panes` adds `has_agent` to the row key list with the tri-state semantics table above and the consumer predicate; § `rk mux process` updates the classification list (registry-derived names + the two-token cmdline fallback). The row schema paragraph is the primary declaration of the identity-key contract fab mirrors (fab-kit `_cli-fab.md` § `fab pane map`: "rk mux panes --json is the primary declaration").
- Memory (hydrate): `docs/memory/run-kit/agent-messaging.md` — the `rk mux panes` requirement's exact key set and nullability, the `rk mux process` requirement's classification rule, and a Design Decision for the lazy shell-row trigger + tri-state null.

Out of scope here (fab-kit companion work, to be filed there): switching `fab operator tick-start --diff` to consume `has_agent` and deleting fab's `pane_process.go` walk; updating fab's `_cli-fab.md` mirror of the row schema. fab's fallback (rk absent or pre-`has_agent` rk → its own `tmux list-panes`) means the two sides can ship independently.

## Affected Memory

- `run-kit/agent-messaging`: (modify) `rk mux panes` requirement — row key set gains trailing `has_agent` (`*bool`: true/false for shell-foreground rows, null otherwise/on walk failure); `rk mux process` requirement — classification derives from the agent runtime registry with a bounded two-token cmdline fallback; new Design Decision "lazy shell-row liveness walk, tri-state `has_agent`"
- `run-kit/agent-state`: (modify) reader rules — `IsShellCommand` set widened to nine shells (the legacy reconciler fallback and send-gate warning inherit it)
- `run-kit/architecture`: (modify) tmux library data model — `paneFormat` 12 fields (`#{pane_pid}` added), `PaneInfo.PanePID`/`AgentPID` non-serialized

## Impact

**Code (Go backend, `app/backend/`)**

- `cmd/rk/mux_panes.go` — `HasAgent *bool` row field; lazy walk call in the row loop
- `cmd/rk/mux_process.go` — extract `paneHasAgent` helper; registry-derived agent name set; two-token cmdline fallback in `classifyProcess`
- `cmd/rk/agent_registry.go` — read-only consumer (`agentRuntimes()`); possibly a small accessor for the name set
- `internal/tmux/tmux.go` — `shellCommands` nine names; `paneFormat` + `#{pane_pid}`; `PaneInfo.PanePID`/`AgentPID` (`json:"-"`); `parsePanes` field-count 12, stores both pids
- Tests: `cmd/rk/mux_panes_test.go` (JSON shape gains the trailing key; new cases: shell row with agent child → `true`, shell row without → `false`, non-shell row → `null`, `PanePID == 0` → `null`, discovery error → `null`, agent-state pid cross-check on a wrapper → `true`; table output unchanged; stderr silent), `cmd/rk/mux_process_test.go` (registry names classify `agent`, e.g. `kimi-code`/`opencode`/`agy`; cmdline fallback on `node …/gemini`; third-token prompt text does NOT classify), `internal/tmux/tmux_test.go` (12-field fixtures; `IsShellCommand("nu")` etc.), `cmd/rk/mux_send_test.go` fake — `muxFake.discoverTree`/`discoverErr`/`panePIDs` already exist; panes tests reuse them through `muxProcessDiscoverFn`; the default `paneWindows` fixture gains `PanePID` values
- Run via `just test-backend`

**Contracts**

- `rk mux panes --json`: additive key, appended last — backward compatible for fab's `rkPaneRow`
- `rk mux process`: classification recognizes more agents (registry names, cmdline fallback) — strictly more `[agent]` tags / `has_agent: true`; no key changes
- Dashboard `/ws/state` payload: unchanged (`json:"-"` on the new `PaneInfo` fields)
- `tmux.IsShellCommand`: four more shells count as "plain shell" for the legacy reconciler fallback and the send-gate warning

**Cost**

- Per enumeration: one `/proc` walk (linux) or two `ps` spawns (darwin) per SHELL-foreground row only; rows with an agent TUI or any other program in the foreground are not walked. Darwin batching (one `ps` snapshot per enumeration shared across rows) is deferred until measured. <!-- assumed: per-row discovery in v1; shell rows are few and the darwin ps cost is bounded by muxCmdTimeout -->

**Docs**: `docs/site/skill/mux.md` → sync → `app/backend/cmd/rk/skill/mux.md`; memory via hydrate.

**Cross-repo**: fab-kit consumer switch + `_cli-fab.md` mirror update are a companion item in fab-kit, not this change.

## Open Questions

- None blocking. Whether `rk mux panes` should later walk ALL rows (so `has_agent` is never `null` for a non-shell foreground) is deferred until a consumer needs it; the lazy trigger is the backlog's explicit design.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `has_agent` is an additive JSON key appended after `agent_state_duration`; the table output is untouched by the key itself | encoding/json consumers (fab's `rkPaneRow`) ignore unknown keys; appending keeps the existing key prefix byte-stable for the shape test | S:90 R:90 A:95 D:95 |
| 2 | Confident | Tri-state `*bool`: `true`/`false` only for shell-foreground rows; `null` for non-shell rows ("not evaluated") and for a failed walk | Follows directly from the backlog's lazy trigger + "null when the walk fails"; `null` on non-walked rows is honest (no evidence) and fab's predicate only consults shell rows | S:75 R:85 A:75 D:65 |
| 3 | Certain | The trigger is `tmux.IsShellCommand`, widened in place to `sh bash zsh fish dash ksh tcsh csh nu`; no second shell set | The backlog names the nine shells; the existing predicate's own comment forbids copying the set; widening is correct for its other readers | S:85 R:85 A:85 D:80 |
| 4 | Confident | `#{pane_pid}` joins `paneFormat` (12th field) and lands in `PaneInfo.PanePID` with `json:"-"`, instead of a per-row `display-message` round trip | Zero extra subprocesses; the dashboard payload stays unchanged via `json:"-"`; fixtures need the 12-field update | S:60 R:75 A:80 D:65 |
| 5 | Confident | `PaneInfo.AgentPID` (`json:"-"`) exposes the already-parsed, reconciled agent pid for the walk's cross-check | Mirrors `rk mux process`'s `markAgentPID` path; `parsePanes` already has the value in hand | S:65 R:85 A:85 D:75 |
| 6 | Certain | One shared helper (`paneHasAgent`) extracted from `runMuxProcess`, discovery through the existing `muxProcessDiscoverFn` seam | code-quality.md forbids duplicating utilities; the seam already exists and the `muxFake` already carries `discoverTree`/`discoverErr` | S:70 R:85 A:90 D:80 |
| 7 | Confident | Classification parity: agent names derived from `agentRuntimes()` (binary ∪ comm, minus `node`, plus `claude-code`) and a bounded first-two-token cmdline fallback; applies to `rk mux process` too | Without it, dropping fab's walk regresses uninstrumented kimi/opencode/agy/gemini detection (fab matches provider binaries + cmdline; rk's table is comm-only over five names); the registry is the single existing source of harness names | S:55 R:70 A:75 D:60 |
| 8 | Confident | Default table output gains no `has_agent` column | Human view; `command` + `AGENT` columns already convey the case; a column is additive later | S:40 R:90 A:55 D:40 |
| 9 | Confident | Per-row discovery in v1 (darwin: two `ps` spawns per shell row); no per-enumeration `ps` batching yet | Shell-foreground rows are few; bounded by `muxCmdTimeout`; batching is a measured follow-up | S:45 R:85 A:45 D:45 |
| 10 | Certain | A failed walk yields `null` silently — no stderr note, the enumeration never fails because of one row | Existing R3 test requires stderr silent on success; a consumer (fab) already fails toward emitting on missing evidence | S:80 R:90 A:85 D:85 |
| 11 | Certain | Docs land in `docs/site/skill/mux.md` (source) and are synced to `cmd/rk/skill/mux.md` via `scripts/sync-skill.sh`; memory via hydrate | `sync-skill.sh` declares the direction; the two files are identical today | S:85 R:95 A:90 D:90 |
| 12 | Certain | fab-kit's consumer switch and `_cli-fab.md` mirror are out of scope (companion item in fab-kit) | Cross-repo; fab's silent fallback lets the sides ship independently; this repo's change is the primary declaration | S:80 R:90 A:85 D:85 |

12 assumptions (6 certain, 6 confident, 0 tentative, 0 unresolved).
