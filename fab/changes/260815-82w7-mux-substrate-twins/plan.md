# Plan: Mux Substrate Twins (capture / kill / process)

**Change**: 260815-82w7-mux-substrate-twins
**Intake**: `intake.md`

## Requirements

### CLI: Family wiring and shared verb contract

#### R1: Three pane-scoped members join the mux family under the shared contract
`cmd/rk/mux.go` SHALL register `capture`, `kill`, and `process` on `muxCmd` (family grows 6 → 9). All three SHALL: accept exactly the family target grammar via `tmux.ParsePaneTarget` — `%N`, `@N`, `=session:window`, anything else a usage error (exit 2) naming the accepted forms — with window forms resolved to the window's agent pane via `tmux.ResolveAgentPane`; **consume** the inherited `-L/--server` flag through `muxServer()` (they MUST NOT call `muxRejectInheritedServerFlag`); use toolkit exit codes (0 success, 1 operational — including a missing pane, 2 usage — never fab's pane-family 2/3 scheme); emit data/report lines on stdout via the sink's `Dataf` and warnings on stderr via `Notef`; run every tmux subprocess as an `exec.CommandContext` argv slice bounded by `muxCmdTimeout` (5s); and expose package-level `*Fn` seam vars so unit tests run without a live tmux (the `mux_send.go` pattern). The parent's doc comment, `Short`/`Long`, and the `-L` flag help text SHALL be updated to cover the nine members (`-L` scopes the pane-scoped verbs: send/await/capture/kill/process).

- **GIVEN** `rk mux capture mysession:win`
- **WHEN** the target parses
- **THEN** exit 2 with a usage error naming `%N`, `@N`, and `=session:window`
- **AND GIVEN** `rk mux -L work kill %5`, **THEN** the kill targets server `work` (no rejection of `-L`)

### CLI: `rk mux capture`

#### R2: Capture flags, plain content, and output shapes
`rk mux capture <target>` SHALL capture the last N lines of the resolved pane's scrollback as **plain text — no `-e` ANSI escapes** — via a new plain capture primitive (R5), never trimming the content. Flags: `-l/--lines <N>` (default 50; `< 1` usage error), `--json`, `--raw` — the latter two mutually exclusive via `MarkFlagsMutuallyExclusive`. `--raw` prints the captured text only, byte-identical to tmux's output. The default (human) output is the fab-shaped header block:

```
--- pane %5 ---
cwd: /home/x/code/repo | agent: idle (5m)
---
<content>
```

The context line joins only the parts that resolved (` | `-separated); an empty cwd or uninstrumented pane omits its part, and a context line with zero parts is omitted entirely. `--json` SHALL emit (two-space-indented `json.Encoder`): `{"pane": "%5", "lines": 50, "content": "...", "cwd": "...", "agent_state": "idle"|null, "agent_state_duration": "5m"|null}`. A missing pane or tmux failure is operational (exit 1) carrying tmux's stderr diagnostic.

- **GIVEN** a live pane `%5` and `rk mux capture %5 --raw`
- **WHEN** the capture runs
- **THEN** stdout is exactly the captured text (no header), exit 0
- **AND GIVEN** `--json --raw` together, **THEN** cobra rejects the flag combination (usage, exit 2)
- **AND GIVEN** `--lines 0`, **THEN** usage error (exit 2)

#### R3: Capture enrichment is substrate-only and reconciled
The capture header/JSON SHALL carry only substrate facts: the pane's cwd (`#{pane_current_path}`) and the **reconciled** agent state read through the R5 state+epoch primitive (parse + pid-liveness/shell-command reconcile — the `PaneAgentState` semantics; a legacy or dead-pid value reads as unknown, never partial trust). It SHALL NOT carry fab's change/stage fields (choreography facts — cli-layering delegation rule 1). The duration follows rk's sessions semantics: shown for `idle` and `waiting` (epoch > 0), never for `active`, formatted floor `Ns`/`Nm`/`Nh` (the `formatAgentDuration` rules).

- **GIVEN** a pane whose `@rk_agent_state` is `waiting:<epoch 2m ago>:<live-pid>`
- **WHEN** `rk mux capture %5` runs
- **THEN** the context line contains `agent: waiting (2m)` and no `change:`/`stage:` parts
- **AND GIVEN** a dead-pid value, **THEN** no `agent:` part appears (reconciled to unknown)

### CLI: `rk mux kill`

#### R4: Agent-state-gated pane kill
`rk mux kill <target>` SHALL read the resolved pane's reconciled agent state before killing: `active` and `waiting` REFUSE (stderr names the state, exit 1, no tmux mutation); `idle` and unknown proceed; `--force` skips the gate (the target's existence is still validated via `tmux.PaneExists`, missing pane = exit 1). The kill runs through a new pane-kill primitive (R5). On success stdout carries exactly one report line: `killed %N` (no separate `server:` line). A tmux kill failure is operational (exit 1) with tmux's stderr.

- **GIVEN** a pane with `@rk_agent_state=active:<epoch>:<live-pid>`
- **WHEN** `rk mux kill %5` runs
- **THEN** it refuses naming `active`, exits 1, and the pane survives
- **AND WHEN** `rk mux kill %5 --force` runs, **THEN** the pane is killed and stdout is `killed %5`

### CLI: `rk mux process`

#### R5a: Process tree discovery and output
`rk mux process <target>` SHALL resolve the pane's shell PID (`#{pane_pid}`), discover its process tree — **linux**: `/proc` walk (`comm`, NUL-joined `cmdline`, children via `/proc/<pid>/task/<tid>/children`, unreadable children skipped); **darwin**: two-pass `ps` (one `pid,ppid,comm -ax` enumeration + one `pid=,args=` cmdline pass joined by PID; comm basename'd; a PID missing from the cmdline pass degrades to `""`) with the pure `parsePSCmdlines` parser in an un-tagged file so it unit-tests on every platform — and print it. Human output: `Pane %5 (PID 1234)`, indented `PID comm [class]` lines (tag omitted for `other`), trailing `Agent process detected.` when `has_agent`. `--json`: `{"pane", "pane_pid", "processes": [{pid, ppid, comm, cmdline, classification, children}], "has_agent"}` (two-space indent).

- **GIVEN** a pane running `zsh → claude`
- **WHEN** `rk mux process %5 --json` runs
- **THEN** the tree has the shell root with a child classified `agent` and `has_agent` is `true`

#### R5b: Classification with agent-state pid cross-check
Classification by lowercased comm SHALL be: `agent` for `claude`, `claude-code`, `codex`, `gemini`, `copilot`; `node` for `node`; `git` for `git`, `gh`; else `other`. Additionally, when the pane's reconciled `@rk_agent_state` carries a live pid (3-segment value), the tree node with that PID SHALL be classified `agent` regardless of comm (instrumentation is authoritative; comm heuristics are fallback). `has_agent` is true iff any node classifies `agent` by either route.

- **GIVEN** an agent launched through a wrapper whose comm is `my-wrapper`, with `@rk_agent_state=active:<epoch>:<that-pid>`
- **WHEN** `rk mux process %5` runs
- **THEN** that node is tagged `[agent]` and `Agent process detected.` prints

### internal/tmux: pane primitives

#### R6: Three context-bounded primitives
`internal/tmux` SHALL gain: (1) a **plain capture** (`capture-pane -p -S -N`, no `-e`) alongside `CapturePaneCtx` — a new function, not a behavior change to the `-e` variant the chat echo probe uses; (2) a **pane kill** by pane ID (`kill-pane -t %N`); (3) a **state+epoch single-pane agent-state read** returning the reconciled `(state, epoch)` — same one-shot `display-message` read and `agentStateStale` reconcile as `PaneAgentState` (which stays; the new read is its superset or its replacement-with-wrapper, implementer's choice) — plus a pane cwd read (`#{pane_current_path}`) if no equivalent exists. All run under the caller's context via the `tmuxExec*` helpers (Constitution §I).

- **GIVEN** the new plain capture on a pane with colored output
- **WHEN** it runs
- **THEN** the returned text contains no ANSI escape sequences, while `CapturePaneCtx` (with `-e`) is unchanged

### Surface conformance: help-dump, skill page, standards

#### R7: Help-dump and family tests track nine members
`cmd/rk/help_dump_test.go` SHALL assert the mux family captures exactly **9** subcommands including `capture`, `kill`, `process`; any `cmd/rk/mux_test.go` member-list assertions update likewise.

- **GIVEN** `go test ./cmd/rk/`
- **WHEN** the help-dump test runs against the real tree
- **THEN** it passes with the 9-member assertion

#### R8: Skill topic page updated in sync
`docs/site/skill/mux.md` (canonical) and the embedded `cmd/rk/skill/mux.md` SHALL both gain sections for the three verbs (targets, capture flags/output, the kill gate, process classification, report lines, exit codes), staying byte-identical (the existing `TestSkillMuxEmbedMatchesCanonical` drift guard enforces this). The page's framing line broadens beyond "talking to other agents" to cover pane inspection/removal. The README's command inventory is checked and updated if it enumerates mux members.

- **GIVEN** the updated pages
- **WHEN** `go test ./cmd/rk/ -run TestSkillMux` runs
- **THEN** the embed-matches-canonical guard passes

### Non-Goals

- `rk mux panes` (enumeration) — Part 8.
- No fab-kit changes (Part 7), no deprecation aliases (nothing moves), no daemon/HTTP surface.

### Design Decisions

#### Kill gate refuses active AND waiting
**Decision**: `rk mux kill` refuses `active` and `waiting` panes without `--force`; `idle`/unknown kill.
**Why**: the send gate's never-interrupt posture applied to destruction — a waiting pane holds a pending human question; killing it silently loses that. `--force` keeps the operator path one flag away.
**Rejected**: fab's ungated twin (rk owns the state convention — its verbs should be first-party readers); gating only `active` (waiting loss is the subtler footgun).
*Introduced by*: 260815-82w7-mux-substrate-twins

#### Capture enrichment is substrate-only
**Decision**: capture carries cwd + reconciled agent state/duration; fab's change/stage fields are dropped.
**Why**: cli-layering delegation rule 1 — change/stage come from `.fab-status.yaml`, fab's layer; rk must not reimplement the read. Part 7 re-points guidance knowing the twins differ here.
**Rejected**: shelling out to `fab pane capture` for the join (inverts the dependency); porting the `.fab-status.yaml` parse (reimplements fab's layer).
*Introduced by*: 260815-82w7-mux-substrate-twins

#### Duration semantics follow rk's sessions rollup, not fab's idle-only
**Decision**: the capture duration shows for `idle` and `waiting` (JSON field `agent_state_duration`), not fab's idle-only `agent_idle_duration`.
**Why**: rk's own reader semantics (`rollupAgentState`: "how long the human has been the blocker / how long at rest"); one convention inside rk beats byte-parity with a copy being demoted to dispatch-internal.
**Rejected**: fab's idle-only field (would make rk's CLI disagree with rk's dashboard on what waiting duration means).
*Introduced by*: 260815-82w7-mux-substrate-twins

#### Plain capture is a new primitive, not a flag change
**Decision**: add a no-`-e` capture function alongside `CapturePaneCtx` instead of parameterizing or changing it.
**Why**: the `-e` variant is load-bearing for the chat echo probe (SGR-aware novelty detection); a boolean parameter would put the distinction at every call site (the SendLiteralArgs/SendKeyArgs lesson).
**Rejected**: stripping escapes downstream (fragile, and `--raw` must stay byte-identical to tmux output).
*Introduced by*: 260815-82w7-mux-substrate-twins

## Tasks

### Phase 1: Setup (internal/tmux primitives)

- [x] T001 Add plain (no `-e`) pane capture primitive next to `CapturePaneCtx` in `app/backend/internal/tmux/tmux.go`; unit test in `tmux_test.go` asserting the argv has no `-e` (builder-level, no live tmux needed — follow existing argv-builder test patterns) <!-- R6 -->
- [x] T002 [P] Add `KillPaneCtx(ctx, paneID, server)` (`kill-pane -t %N`) in `app/backend/internal/tmux/tmux.go` near `KillActivePane`; unit test <!-- R6 -->
- [x] T003 [P] Add the reconciled state+epoch single-pane read (and a pane cwd/`#{pane_current_path}` read if none exists) in `app/backend/internal/tmux/pane_target.go`, sharing `parseAgentState` + `agentStateStale` with `PaneAgentState`; unit tests via the existing exec seams in `pane_target_test.go` <!-- R6 -->

### Phase 2: Core Implementation

- [x] T004 Create `app/backend/cmd/rk/mux_capture.go`: cobra command (`Use`, `Short`, `Long`, `Example`), flags (`-l/--lines` 50, `--json`/`--raw` mutually exclusive), seam vars, `runMuxCapture` (parse → resolve → capture → enrich → render human/json/raw) <!-- R2 -->
- [x] T005 Create `app/backend/cmd/rk/mux_capture_test.go`: target/flag validation (exit classes), `--raw` byte-parity, `--json` shape incl. nulls, context-line part omission (no cwd / uninstrumented / dead-pid), duration for idle+waiting, none for active <!-- R2, R3 -->
- [x] T006 Create `app/backend/cmd/rk/mux_kill.go`: gate (active/waiting refuse naming the state; idle/unknown kill; `--force` skips gate but validates existence), kill via T002 primitive, `killed %N` report via sink <!-- R4 -->
- [x] T007 Create `app/backend/cmd/rk/mux_kill_test.go`: full gate matrix, `--force` on missing pane, refusal performs no kill (seam call assertion), report line exactness <!-- R4 -->
- [x] T008 Create `app/backend/cmd/rk/mux_process.go`: command + `--json`, `ProcessNode`/JSON structs, classification table (`claude`/`claude-code`/`codex`/`gemini`/`copilot` → agent; `node`; `git`/`gh` → git), `parsePSCmdlines` (un-tagged), agent-state pid cross-check + `has_agent`, human tree printer <!-- R5a, R5b -->
- [x] T009 Create `app/backend/cmd/rk/mux_process_linux.go` + `mux_process_darwin.go`: port fab's `/proc` walk and two-pass `ps` discovery (TOCTOU-free darwin cmdline join) <!-- R5a -->
- [x] T010 Create `app/backend/cmd/rk/mux_process_test.go`: classification table, `parsePSCmdlines`, tree build from stub data, pid cross-check overriding comm, `has_agent` both routes, JSON shape <!-- R5a, R5b -->

### Phase 3: Integration & Edge Cases

- [x] T011 Wire the three commands in `app/backend/cmd/rk/mux.go` (`AddCommand` ×3); update the family doc comment, parent `Short`/`Long`, and the `-L` flag help text to the pane-scoped-verbs wording; update any member-list assertions in `mux_test.go` <!-- R1 -->
- [x] T012 Update `app/backend/cmd/rk/help_dump_test.go`: mux member count 6 → 9, add `capture`/`kill`/`process` to the captured-children names <!-- R7 -->

### Phase 4: Polish

- [x] T013 Update `docs/site/skill/mux.md` and byte-sync to `app/backend/cmd/rk/skill/mux.md`: sections for the three verbs, broadened framing line; check README's command inventory for a mux enumeration <!-- R8 -->
- [x] T014 Conformance pass: run `shll standards` and audit the new surface (help-dump, Principle 9 `--quiet`/report-line posture, exit codes); run `cd app/backend && go test ./...` and `go vet ./...` green <!-- R1, R7, R8 -->

## Execution Order

- T001–T003 before T004/T006 (commands consume the primitives)
- T008 before T009 (platform files implement `discoverProcessTree` against T008's types)
- T011–T012 after all commands exist; T013–T014 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk mux capture|kill|process` exist under the family, accept `%N`/`@N`/`=session:window`, consume `-L`, and reject bare `session:window` as usage (exit 2)
- [x] A-002 R2: capture supports `--lines` (default 50, `<1` usage error), `--raw` (byte-identical), `--json` (documented shape), human header block
- [x] A-003 R4: kill enforces the gate matrix (active/waiting refuse, idle/unknown kill, `--force` skips with existence check) and reports `killed %N`
- [x] A-004 R5a: process discovers the tree on linux (`/proc`) and darwin (two-pass `ps`), rendering human and JSON shapes
- [x] A-005 R6: the three internal/tmux primitives exist, context-bounded, with the plain capture leaving `CapturePaneCtx` untouched

### Behavioral Correctness

- [x] A-006 R3: capture enrichment carries cwd + reconciled agent state/duration only — no change/stage fields; dead-pid/legacy values render as unknown
- [x] A-007 R5b: classification covers the extended agent set and the agent-state pid cross-check overrides comm; `has_agent` true on either route
- [x] A-008 R1: all three verbs use toolkit exit codes — a missing pane exits 1 (not fab's 2), usage errors exit 2

### Scenario Coverage

- [x] A-009 R2/R4/R5b: unit tests exercise the R2 flag-exclusivity scenario, the R4 active-refusal + force scenario, and the R5b wrapper-comm cross-check scenario via seam vars (no live tmux)

### Edge Cases & Error Handling

- [x] A-010 R2/R4: tmux failures surface the child's stderr diagnostic (exit 1); capture context line omits empty parts and disappears when all parts are empty; kill refusal provably performs no tmux mutation

### Code Quality

- [x] A-011 Pattern consistency: new commands mirror `mux_send.go`'s structure (contract doc comment, flag vars, seam vars, testable `runMuxX` core, sink usage, `usageError`/`usageArgs`)
- [x] A-012 No unnecessary duplication: tmux interaction only through `internal/tmux` primitives; `parseAgentState`/`agentStateStale` reused, never re-implemented; no inline tmux argv construction in `cmd/rk`
- [x] A-013 exec discipline: every subprocess is `exec.CommandContext` with an argv slice under a bounded context (Constitution §I); no shell strings
- [x] A-014 Tests included: new behavior is covered by unit tests in the same package (`*_test.go` siblings), runnable without a live tmux server

### Security

- [x] A-015 R1: target strings pass through `ParsePaneTarget` validation before reaching any tmux argv; no user input is shell-interpolated

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (`PaneAgentState` stays as a one-line wrapper over the new `PaneFactsCtx` superset read; `formatAgentDuration` was exported as `FormatAgentDuration` in place — no copy left behind. Demoting fab-kit's own `fab pane` copies is Part 7's scope, not this change's.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | JSON duration field named `agent_state_duration` (covers idle AND waiting), diverging from fab's `agent_idle_duration` | rk's sessions rollup already computes waiting durations; internal consistency beats parity with a to-be-demoted copy | S:55 R:80 A:75 D:60 |
| 2 | Confident | The state+epoch read lives in `pane_target.go` beside `PaneAgentState`, reusing `parseAgentState`+`agentStateStale`; whether it wraps or supersedes `PaneAgentState` is implementer's choice | Pure placement/refactor choice, fully reversible, no external contract | S:60 R:90 A:85 D:75 |
| 3 | Confident | Kill validates existence under `--force` via `tmux.PaneExists` (the `mux_send.go --force` pattern) rather than a fab-style ValidatePane port | The family already has this exact pattern in-tree | S:65 R:85 A:85 D:80 |
| 4 | Certain | Process discovery needs no new platform build tags beyond linux/darwin | fab's twins ship exactly these two; rk targets the same platforms (brew + gcp linux) | S:70 R:85 A:90 D:85 |

4 assumptions (1 certain, 3 confident, 0 tentative).
