# Plan: `rk mux panes --json` — `has_agent` per row

**Change**: 260910-7pek-mux-panes-has-agent
**Intake**: `intake.md`

## Requirements

### rk mux: `panes` row liveness

#### R1: `has_agent` is a trailing tri-state key on every `rk mux panes --json` row
`rk mux panes --json` SHALL emit a `has_agent` key on every row object, appended after `agent_state_duration` so the existing 13-key prefix is byte-stable. Its value SHALL be `true` or `false` only for rows whose foreground `command` is a shell (R2) and whose process-tree walk succeeded; it SHALL be `null` for every other row — a non-shell foreground ("not evaluated") or a failed walk (R4). The default table output SHALL NOT change.

- **GIVEN** a shell-foreground pane whose pane-pid tree contains a process classified `agent`
- **WHEN** `rk mux panes --json` runs
- **THEN** that row carries `"has_agent": true` as its last key
- **AND** a shell-foreground pane with no agent node carries `"has_agent": false`
- **AND** a pane whose foreground is `node` (or any non-shell) carries `"has_agent": null`

#### R2: the lazy trigger is `tmux.IsShellCommand`, widened to nine shells
The process-tree walk in `rk mux panes` SHALL run only for rows where `tmux.IsShellCommand(command)` is true. `tmux.shellCommands` SHALL hold exactly `sh bash zsh fish dash ksh tcsh csh nu` and SHALL remain the single shell set; its existing readers (the legacy two-segment reconciler fallback via `agentStateStale`, the `mux send` unknown-state warning) inherit the widened set unchanged.

- **GIVEN** panes whose foreground commands are `nu`, `tcsh`, and `claude`
- **WHEN** `rk mux panes --json` runs
- **THEN** discovery is invoked for the `nu` and `tcsh` rows and NOT for the `claude` row

#### R3: pane pid and agent pid ride the existing `list-panes` call, unserialized
`paneFormat` SHALL gain `#{pane_pid}` as its 12th field; `parsePanes` SHALL require 12 fields, store the pid in `PaneInfo.PanePID`, and store the reconciled agent pid in `PaneInfo.AgentPID` (zeroed on the same `agentStateStale` condition that zeros `AgentState`). Both fields SHALL carry `json:"-"` so the dashboard `/ws/state` payload is unchanged. No per-row `display-message` round trip is added.

- **GIVEN** a 12-field pane line whose agent-state value is `active:1700000000:4242` with the pid alive and `#{pane_pid}` = `1234`
- **WHEN** `parsePanes` runs
- **THEN** the pane's `PanePID` is 1234 and `AgentPID` is 4242
- **AND** with the pid dead, `AgentPID` is 0 alongside the cleared `AgentState`
- **AND** `json.Marshal` of the `PaneInfo` contains neither `panePID` nor `agentPID` keys

#### R4: one shared walk helper; a failed walk yields `null` silently
The tree → agent-pid cross-check → `hasAgentInTree` core SHALL be extracted from `runMuxProcess` into a helper (`paneHasAgent(ctx, pid, agentPID)` returning the tree and the bool) that both `rk mux process` and `rk mux panes` call, discovering through the existing `muxProcessDiscoverFn` seam. In `rk mux panes`, `PanePID == 0` SHALL short-circuit to `null` without calling discovery; a discovery error SHALL yield `null` for that row with no stderr output and no change to the command's exit code. `rk mux process` output SHALL be unchanged by the extraction.

- **GIVEN** a shell-foreground pane whose discovery returns an error
- **WHEN** `rk mux panes --json` runs
- **THEN** exit is 0, stderr is empty, and that row carries `"has_agent": null`
- **AND GIVEN** a shell-foreground pane whose reconciled agent pid names a wrapper node with comm `my-wrapper`, **THEN** the row carries `"has_agent": true`

#### R5: agent classification derives from the runtime registry with a bounded cmdline fallback
`classifyProcess` SHALL take `(comm, cmdline)` and classify `agent` when the lowercased comm basename is in the agent name set OR when the basename of either of the first two whitespace-separated `cmdline` tokens is; tokens beyond the second SHALL never be consulted. The agent name set SHALL be derived from `agentRuntimes()` as the union of every runtime's `binary` and `comm` values plus `claude-code`, excluding `node` (a bare `node` stays `node`). `node`, `git`/`gh`, and `other` classification is unchanged. This applies to `rk mux process` as well.

- **GIVEN** processes with comm `kimi-code`, `opencode`, `agy`, `kimi`
- **WHEN** classified
- **THEN** each is `agent`
- **AND** comm `node` with cmdline `node /usr/local/bin/gemini --yolo` is `agent`
- **AND** comm `node` with cmdline `node server.js "please run claude now"` is `node`

### Documentation

#### R6: the row contract is documented at its primary declaration
`docs/site/skill/mux.md` § `rk mux panes` SHALL list `has_agent` with the tri-state semantics and the consumer predicate `IsShellCommand(command) && has_agent == false`; § `rk mux process` SHALL describe the registry-derived agent names and the two-token cmdline fallback. `scripts/sync-skill.sh` SHALL be run so `app/backend/cmd/rk/skill/mux.md` is byte-identical.

- **GIVEN** the edited `docs/site/skill/mux.md`
- **WHEN** `scripts/sync-skill.sh` runs
- **THEN** `diff docs/site/skill/mux.md app/backend/cmd/rk/skill/mux.md` is empty and the § panes text names `has_agent`

### Non-Goals

- Switching `fab operator tick-start --diff` to consume `has_agent`, or updating fab-kit's `_cli-fab.md` mirror — fab-kit companion work; fab's own `tmux list-panes` fallback decouples shipping.
- A `has_agent` column in the default table.
- Walking non-shell rows (`has_agent` stays `null` there until a consumer needs it).
- Batching darwin `ps` snapshots across rows — deferred until measured.

### Design Decisions

#### Lazy shell-row liveness walk with a tri-state `has_agent`
**Decision**: `rk mux panes` walks the pane-pid process tree only for rows whose foreground command is a shell, and reports `has_agent` as `true`/`false` for those rows and `null` everywhere else (non-shell foreground, or a failed walk).
**Why**: the consumer's question ("did the agent exit?") is open only when a shell owns the tty — an agent TUI in the foreground is not a candidate — so the cost is bounded to the rows where the answer matters, and `null` states honestly that rk has no evidence rather than guessing.
**Rejected**: walking every row (pays the darwin `ps` cost on rows nobody consults); deriving liveness from `agent_state` alone (a legacy value can outlive its agent — the reason the walk exists); a new bulk `rk mux process --all` verb (a second enumeration surface).
*Introduced by*: `260910-7pek-mux-panes-has-agent`

#### Agent classification derives from the agent runtime registry
**Decision**: `classifyProcess`'s agent name set is the union of `agentRuntimes()` binary and comm names plus `claude-code` (minus `node`), with a bounded first-two-token cmdline fallback.
**Why**: once fab stops walking, rk's table is the only defense for uninstrumented agents (no agent-state pid to cross-check); the registry is the one existing source of harness names, and the cmdline fallback catches node-hosted CLIs (gemini) exactly as fab's walker does today, so the hand-off does not regress detection.
**Rejected**: a second hand-written comm table (drifts from the registry); matching the whole cmdline (prompt text in argv becomes liveness evidence).
*Introduced by*: `260910-7pek-mux-panes-has-agent`

#### `#{pane_pid}` rides `paneFormat`, unserialized
**Decision**: the pane pid and the reconciled agent pid are carried on `PaneInfo` from the existing `list-panes` call, tagged `json:"-"`.
**Why**: zero extra tmux subprocesses per row; the dashboard payload — which pre-renders and fans out `PaneInfo` — stays byte-identical.
**Rejected**: a per-row `display-message -p '#{pane_pid}'` round trip (N extra subprocesses on every enumeration).
*Introduced by*: `260910-7pek-mux-panes-has-agent`

## Tasks

### Phase 1: Substrate

- [x] T001 `app/backend/internal/tmux/tmux.go`: widen `shellCommands` to `sh bash zsh fish dash ksh tcsh csh nu`; add `#{pane_pid}` as `paneFormat`'s 12th field (update the format comment); add `PanePID int` and `AgentPID int` (`json:"-"`) to `PaneInfo`; in `parsePanes` require 12 fields, parse `parts[11]` into `PanePID`, store the reconciled agent pid in `AgentPID` (zeroed with `AgentState`). Update the 11-field fixtures in `app/backend/internal/tmux/pane_target_test.go` (and any in `tmux_test.go`) to 12 fields; extend `TestIsShellCommand` with the four new names; add assertions for `PanePID`/`AgentPID` (live and dead pid) and a `json.Marshal` check that neither key is serialized. Run `just test-backend`. <!-- R2 R3 -->

### Phase 2: Classification and the shared walk

- [x] T002 `app/backend/cmd/rk/mux_process.go`: add `agentCommNames()` deriving the set from `agentRuntimes()` (binary ∪ comm, plus `claude-code`, minus `node`); change `classifyProcess(comm string)` to `classifyProcess(comm, cmdline string)` with the bounded first-two-token basename fallback; update the call sites in `mux_process_linux.go` and `mux_process_darwin.go`; update the `--help` text and the package comment's classification list. Extend `TestClassifyProcess` in `mux_process_test.go` for `kimi-code`/`opencode`/`agy`/`kimi`/`copilot`, the `node …/gemini` cmdline hit, and the third-token miss. <!-- R5 -->
- [x] T003 `app/backend/cmd/rk/mux_process.go`: extract `paneHasAgent(ctx context.Context, pid, agentPID int) ([]processNode, bool, error)` (discover via `muxProcessDiscoverFn`, `markAgentPID` when `agentPID > 0`, `hasAgentInTree`) and make `runMuxProcess` call it; existing `mux_process_test.go` tests must pass unchanged. <!-- R4 -->

### Phase 3: Enumeration wiring

- [x] T004 `app/backend/cmd/rk/mux_panes.go`: add `HasAgent *bool \`json:"has_agent"\`` as the last `muxPanesRow` field; in the row loop, when `tmux.IsShellCommand(p.Command)`: `PanePID == 0` → leave nil, else call `paneHasAgent(ctx, p.PanePID, p.AgentPID)` and set the pointer on success, leave nil on error (no stderr); update the package comment. In `mux_panes_test.go`: update `TestMuxPanesJSONShape`'s expected string (default fixture: `%5` `node` → `null`; `%6` `zsh` with `PanePID` set → `true` via the default discover fixture) and give the default `%6` fixture in `mux_send_test.go`'s `installMuxFakes` a `PanePID`; add tests for shell row without agent → `false`, `PanePID == 0` → `null`, `discoverErr` → `null` with empty stderr and exit 0, agent-pid cross-check on a wrapper node → `true`, non-shell row never invokes discovery (record calls on the fake), and table output unchanged. Run `just test-backend`. <!-- R1 R2 R4 -->

### Phase 4: Documentation

- [x] T005 `docs/site/skill/mux.md`: § `rk mux panes` — add `has_agent` to the row key list with the tri-state table (shell foreground → true/false; non-shell → null; failed walk → null) and the consumer predicate; § `rk mux process` — replace the fixed classification list with the registry-derived names + two-token cmdline fallback. Run `scripts/sync-skill.sh` and verify `diff docs/site/skill/mux.md app/backend/cmd/rk/skill/mux.md` is empty. <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: every `rk mux panes --json` row carries `has_agent` as its last key; shell-foreground rows with/without an agent node read `true`/`false`, non-shell rows read `null`
- [x] A-002 R2: `tmux.IsShellCommand` accepts all nine shells and is the only shell set in the tree; discovery is invoked only for shell-foreground rows
- [x] A-003 R3: `paneFormat` has 12 fields ending in `#{pane_pid}`; `parsePanes` populates `PanePID` and `AgentPID`; neither appears in the marshaled `PaneInfo`
- [x] A-004 R4: `runMuxProcess` and `runMuxPanes` both call `paneHasAgent`; no second tree/cross-check implementation exists
- [x] A-005 R5: `classifyProcess(comm, cmdline)` classifies every registry binary/comm (except `node`) as `agent` and honours the two-token cmdline fallback
- [x] A-006 R6: `docs/site/skill/mux.md` documents `has_agent` and the classification rule; the embedded copy is byte-identical

### Behavioral Correctness

- [x] A-007 R1: the default table output of `rk mux panes` is unchanged (header and columns identical to before)
- [x] A-008 R4: `rk mux process` human and JSON output are unchanged by the helper extraction (existing tests pass without edits)
- [x] A-009 R3: the dashboard `/ws/state` pane payload gains no new keys

### Scenario Coverage

- [x] A-010 R4: a discovery error on a shell row yields `null`, empty stderr, exit 0 (test)
- [x] A-011 R4: a wrapper-launched agent identified only by the agent-state pid yields `true` on the panes row (test)
- [x] A-012 R5: `node /usr/local/bin/gemini` classifies `agent`; a third-token `claude` in argv does not (test)

### Edge Cases & Error Handling

- [x] A-013 R4: `PanePID == 0` on a shell row yields `null` and never calls discovery
- [x] A-014 R3: a legacy 11-field pane line is skipped by `parsePanes` (the field guard), not mis-parsed

### Code Quality

- [x] A-015 Pattern consistency: new code follows the mux verb conventions (package-level `*Fn` seams, `newSink` stdout/stderr split, `muxCmdTimeout` context)
- [x] A-016 No unnecessary duplication: the shell set and the walk each exist once; the agent name set derives from `agentRuntimes()`
- [x] A-017 Subprocess safety: no new subprocess calls outside `exec.CommandContext` with argument slices
- [x] A-018 Comments state constraints, not narration: no change IDs or PR numbers in code comments
- [x] A-019 Tests cover the added behavior (`*_test.go` alongside each touched file)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (the old comm-only classification switch in `classifyProcess` was replaced in place, not left alongside). The one intended future deletion — fab-kit's `pane_process.go` tree walk once `fab operator tick-start --diff` consumes `has_agent` — is cross-repo companion work, explicitly out of scope here.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `paneHasAgent` returns the discovered tree alongside the bool so `rk mux process` keeps printing the tree from one discovery call | Avoids a second discovery per `process` invocation; the tree is already in hand | S:70 R:90 A:90 D:80 |
| 2 | Confident | The default `%6` test fixture gains a `PanePID` so the shape test exercises the `true` path through the default discover fixture (which already contains a `claude` child) | Reuses the existing fake; keeps one canonical expected-JSON string | S:65 R:90 A:85 D:75 |
| 3 | Confident | `parsePanes` keeps a strict `< 12` field guard (a legacy 11-field line is skipped) rather than tolerating a missing trailing field | Both readers ship in the same binary — no cross-version line can arrive; matches the existing strict-guard style | S:60 R:85 A:85 D:70 |

3 assumptions (0 certain, 3 confident, 0 tentative).
