# Intake: Mux Substrate Twins (capture / kill / process)

**Change**: 260815-82w7-mux-substrate-twins
**Created**: 2026-08-15

## Origin

One-shot `/fab-new` invocation (autonomous full-pipeline run requested):

> Add substrate twins to the rk mux family: rk mux capture, rk mux kill, rk mux process, mechanics ported/twinned from fab pane capture/kill/process (in the fab-kit repo), agent-state-aware where applicable. This is Part 6 of the cross-repo CLI-layering execution plan documented in docs/specs/cli-layering.md in this repo — read that file's Execution Plan section (Part 6 row) plus the Substrate/Choreography ownership tables before starting for full context on scope, naming, and precedent (Part 1's rk mux send/rk mux await, merged as PR #617, is the pattern to follow for parent-command wiring, gating, and help-dump conventions). No release gate for this part — only depends on Part 1 which is already merged and released. Run the full pipeline (apply through review-pr) and report when ready to merge.

Key context sources read at intake: `docs/specs/cli-layering.md` (Part 6 row, ownership tables, delegation rules), `docs/memory/run-kit/agent-messaging.md` (the shipped six-member `rk mux` family contract), fab-kit sources `src/go/fab/cmd/fab/pane_capture.go` / `pane_kill.go` / `pane_process.go` / `pane_process_linux.go` / `pane_process_darwin.go` and `internal/pane/pane.go` (the port sources), and run-kit's `cmd/rk/mux.go` / `mux_send.go` / `internal/tmux/pane_target.go` (the Part 1 precedent).

## Why

Per `docs/specs/cli-layering.md`, rk owns the **substrate** layer — tmux conventions, agent instrumentation, and pane interaction verbs — while fab owns choreography. Today the generic pane-mechanics verbs (`capture`, `kill`, `process`) exist only as `fab pane` commands, so:

1. **Layer inversion**: operators and skills that need substrate facts (what's on a pane's screen, what process tree runs in it, remove a pane) must reach for fab, coupling substrate work to fab-kit's installation and its pane-family conventions (including its divergent 2/3 exit-code scheme).
2. **Blocked downstream parts**: Part 7 (fab-kit re-points its skill guidance at rk and demotes its own copies to dispatch-internal) and Part 8 (`rk mux panes` + killing the `sessions.go` cached `fab pane map` join) both depend on these twins existing in rk.
3. **Missing agent-awareness**: fab's copies are agent-state consumers only where fab needed them; rk, as the owner of the `@rk_agent_state` convention, can make these verbs first-party readers (gate a kill on a live agent, tag the instrumented agent process in a tree, show reconciled state in captures).

If we don't ship this, the mux family stays a messaging-only surface and the fab-kit cleanup in Parts 7–8 has nothing to point at.

## What Changes

Three new members join the `rk mux` family (`cmd/rk/mux.go`), bringing it from six to nine. All three are **pane-scoped** verbs and therefore behave like the messaging tier (send/await): they **consume** the parent's persistent `-L/--server` flag via `muxServer()` (they do NOT call `muxRejectInheritedServerFlag`), they accept the family's strict target grammar, and they follow toolkit exit codes (0 success, 1 operational, 2 usage — never fab's pane-family 2/3 scheme, per the Part 1 decision recorded in `docs/memory/run-kit/agent-messaging.md`).

**Shared mechanics (all three verbs)**:
- Target grammar via `tmux.ParsePaneTarget`: exactly `%N` (pane), `@N` (window), `=session:window` (exact); bare `session:window` rejected as usage error (exit 2) naming the accepted forms. Window forms resolve to the window's **agent pane** via `tmux.ResolveAgentPane` (the pane carrying a known post-reconcile `@rk_agent_state`, falling back to the active pane) — same as send/await.
- Every subprocess is an `exec.CommandContext` argv slice bounded by `muxCmdTimeout` (5s) — Constitution §I. No daemon dependency (the `rk present` pattern) — Constitution §II/VI.
- Package-level `*Fn` seam vars for unit tests without a live tmux (the `mux_send.go` / `present.go` pattern).
- Output via the `newSink(cmd)` convention: the report/data on stdout (`Dataf`, survives `--quiet`), warnings/chatter on stderr (`Notef`).
- Usage errors wrapped via `usageError(...)`; arg-count via `usageArgs(...)`.

### `rk mux capture <target>` (ported from `fab pane capture`)

```
rk mux capture %5                 # last 50 lines, human header + content
rk mux capture @3 --lines 200     # window target → its agent pane
rk mux capture %5 --raw           # captured text only, byte-identical
rk mux capture %5 --json          # JSON with metadata
```

- Flags: `-l/--lines <N>` (default **50**; `< 1` is a usage error), `--json`, `--raw` — `--json` and `--raw` mutually exclusive via `MarkFlagsMutuallyExclusive`.
- Capture is the last N lines of scrollback (`capture-pane -p -S -N`), **plain text — no `-e` ANSI color escapes** (fab parity; agent-friendly output). rk's existing `tmux.CapturePaneCtx` hardcodes `-e` for the chat echo probe — add a plain variant (or parameterize) in `internal/tmux` rather than stripping escapes downstream. Content is never trimmed (`--raw` stays byte-identical to tmux's output).
- **Enrichment is substrate-only** (layer ownership, delegation rule 1 of cli-layering.md): the header/JSON carry the pane's cwd (`#{pane_current_path}`) and the **reconciled** agent state + duration — NOT fab's change/stage fields (those are choreography facts owned by fab; rk must not reimplement the `.fab-status.yaml` read).
- Default (human) output, fab-shaped:
  ```
  --- pane %5 ---
  cwd: /home/x/code/repo | agent: idle (5m)
  ---
  <content>
  ```
  The context line prints only the parts that resolved (cwd empty → omitted; uninstrumented pane → no `agent:` part; a context line with no parts is omitted entirely).
- `--json` shape: `{"pane": "%5", "lines": 50, "content": "...", "cwd": "...", "agent_state": "idle"|null, "agent_state_duration": "5m"|null}` (two-space indent, `json.Encoder`).
- Agent state is the **reconciled** read (parse + pid-liveness, the `tmux.PaneAgentState` semantics) — never raw-option trust. The duration is derived from the state's epoch (floor `Ns`/`Nm`/`Nh`, fab's `FormatIdleDuration` rules); `idle` and `waiting` carry a duration, `active` does not. This needs a state+epoch variant of the single-pane read in `internal/tmux` (today's `PaneAgentState` returns state only).
- Missing pane / tmux failure = operational error (exit 1) carrying tmux's stderr diagnostic.

### `rk mux kill <target>` (ported from `fab pane kill`, gains the agent-state gate)

```
rk mux kill %12
rk mux kill %12 --force        # skip the agent-state gate
rk mux kill @3                 # window target → its agent pane
```

- Kills the resolved pane via a new `internal/tmux` pane-kill primitive (`kill-pane -t %N`; today only `KillActivePane(windowID)` exists).
- **Agent-state gate** (the "agent-state-aware" application for kill — rk's twin is safer than fab's ungated copy): read the reconciled state first; `active` and `waiting` **refuse** (stderr names the state, exit 1, no tmux mutation — never kill a working agent or one holding a pending human question); `idle` and unknown kill; `--force` skips the gate (target existence still validated). This mirrors the send-gate philosophy; there is no `--answer` analog (kill answers nothing).
- Report: exactly one stdout line `killed %N` (no separate `server:` line — rk's one-report-line convention, unlike fab's two-line form).
- Missing pane = operational error (exit 1); tmux kill failure = exit 1 with tmux's stderr.

### `rk mux process <target>` (ported from `fab pane process`)

```
rk mux process %5
rk mux process %5 --json
```

- Resolves the pane's shell PID (`#{pane_pid}`), then discovers the process tree:
  - **linux**: `/proc` walk (`/proc/<pid>/comm`, `/proc/<pid>/cmdline` NUL-join, children via `/proc/<pid>/task/<tid>/children`) — port of fab's `pane_process_linux.go`.
  - **darwin**: two-pass `ps` — one `ps -o pid,ppid,comm -ax` enumeration + one `ps -axo pid=,args=` cmdline pass joined by PID during the tree walk (port of fab's TOCTOU-free darwin implementation, including the pure `parsePSCmdlines` helper in an un-tagged file so it unit-tests on every platform).
- Classification by comm (lowercased): `agent` for known agent CLIs — fab's `claude`/`claude-code` **extended** with `codex`, `gemini`, `copilot` (rk's multi-agent posture; the chat/@rk_chat layer already treats codex/gemini adapters as additive); `node`; `git` (`git`, `gh`); else `other`.
- **Agent-state pid cross-check** (the "agent-state-aware" application for process): when the pane's reconciled `@rk_agent_state` carries a live pid (3-segment values), the tree node with that PID is classified `agent` regardless of comm — the instrumented agent is authoritative, comm heuristics are fallback.
- `has_agent` = any node classified `agent` (comm-derived or pid-derived).
- Human output: `Pane %5 (PID 1234)` + indented tree lines `PID comm [class]` (class tag omitted for `other`) + trailing `Agent process detected.` when `has_agent`.
- `--json` shape: `{"pane": "%5", "pane_pid": 1234, "processes": [{pid, ppid, comm, cmdline, classification, children:[…]}], "has_agent": true}`.

### Wiring, help, docs, tests

- `cmd/rk/mux.go`: `muxCmd.AddCommand` grows by three; the family doc-comment and the parent's `Short`/`Long` gain the three verbs; the `-L` flag help text updates (it no longer scopes "messaging verbs only" — it scopes the pane-scoped verbs: send/await/capture/kill/process).
- New files `cmd/rk/mux_capture.go`, `mux_kill.go`, `mux_process.go` (+ `mux_process_linux.go`, `mux_process_darwin.go`) with sibling `_test.go` files, following `mux_send.go`'s structure (doc-comment contract header, flag vars, seam vars, testable `runMuxX` core).
- `internal/tmux`: plain (no `-e`) capture variant; pane-kill-by-ID primitive; state+epoch single-pane agent-state read. All context-bound, in `pane_target.go`/`tmux.go` per existing placement.
- `cmd/rk/help_dump_test.go`: mux member count assertions 6 → 9 (+ the three names in the captured-children check).
- `docs/site/skill/mux.md` + the embedded `cmd/rk/skill/mux.md` (byte-synced — the existing drift-guard test `TestSkillMuxEmbedMatchesCanonical` enforces this): add sections for the three verbs (targets, gate, report lines, exit codes). The topic page's framing line ("Depth for one job: talking to other agents") broadens to cover pane inspection/removal.
- Standards conformance (Constitution § Toolkit Standards, mandatory per the execution-plan row): `shll standards` audit of the new surface — help-dump capture, Principle 9 (`--quiet` honored: report lines are data, chatter is stderr), ten-principles check on flags/exit codes.
- README: check whether the CLI command list enumerates mux members; update if so.

### Non-goals

- `rk mux panes` (enumeration) — that is Part 8.
- No fab-kit changes (guidance re-point is Part 7).
- No deprecation aliases needed — these are new verbs, nothing moves.
- No daemon/HTTP surface — CLI only.

## Affected Memory

- `run-kit/agent-messaging`: (modify) family grows 6 → 9 members; document the three twins' contracts (target grammar reuse, kill gate matrix, capture enrichment scope, process classification + pid cross-check); the "-L scopes messaging verbs only" claims update to the pane-scoped set
- `run-kit/toolkit-standards`: (modify) help-dump + Principle 9 new-surface posture now covers the nine-member mux family
- `run-kit/architecture`: (modify) CLI subcommand inventory mentions the grown mux family (light touch)

## Impact

- **Backend Go only** (`app/backend/`): `cmd/rk/` (3 new command files + 2 platform files + tests, `mux.go` wiring, `help_dump_test.go`, embedded `skill/mux.md`), `internal/tmux/` (3 small primitives + tests).
- **Docs**: `docs/site/skill/mux.md`, possibly README.
- **No frontend, no API, no daemon changes.** No release gate; depends only on merged/released Part 1 (and coexists with Parts 2–4's merged moves).
- Tests: `just test-backend` scope (Go); no e2e impact.

## Open Questions

- None — the spec row, Part 1 precedent, and fab-kit port sources resolve the design space; remaining choices are recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Toolkit exit codes 0/1/2 for all three verbs — a missing pane is operational (1), never fab's pane-family 2/3 scheme | Decided for the family in Part 1 and recorded in agent-messaging memory ("never fab's pane-family 2/3 scheme"); toolkit standards bind rk's surface | S:70 R:80 A:95 D:90 |
| 2 | Certain | All three twins accept the family target grammar (%N/@N/=session:window, window→agent-pane resolution) and consume the inherited `-L` like send/await | They are pane-scoped verbs; the family precedent is explicit and silently diverging grammars inside one family would be a footgun | S:75 R:80 A:90 D:85 |
| 3 | Certain | Flag/output parity with fab where not overridden: capture `--lines` default 50 + `--json`/`--raw` mutually exclusive, process `--json`, JSON field shapes ported | "Mechanics ported/twinned" is the request verbatim; fab's flag surface is the contract Part 7 will re-point guidance at | S:80 R:85 A:90 D:85 |
| 4 | Certain | Help-dump test update (6→9), `rk skill mux` topic page update (canonical + embedded sync), and `shll standards` audit ship in this change | The execution plan states every CLI-surface part intrinsically includes these; the drift-guard test forces the sync | S:85 R:85 A:90 D:90 |
| 5 | Confident | `capture` drops fab's change/stage enrichment and carries only substrate facts (cwd + reconciled agent state/idle duration) | cli-layering delegation rule 1: neither tool reimplements the other's layer — change/stage come from `.fab-status.yaml`, a choreography fact; agent state is rk-owned | S:60 R:75 A:80 D:70 |
| 6 | Confident | `kill` gains an agent-state gate: refuse `active` and `waiting` (exit 1, names the state), kill on `idle`/unknown, `--force` skips | The one meaningful "agent-state-aware where applicable" reading for kill; mirrors the send gate's never-interrupt posture; fab's ungated copy remains for its own callers | S:55 R:75 A:70 D:55 |
| 7 | Confident | `capture` output is plain text (no `-e` ANSI escapes), matching fab byte-for-byte on `--raw` | fab's Capture has no `-e`; escape-laden output is hostile to the agent consumers these verbs serve; rk's `-e` capture exists only for the echo probe | S:55 R:85 A:75 D:70 |
| 8 | Confident | `process` cross-checks the reconciled `@rk_agent_state` pid: a tree node with that PID classifies as `agent` regardless of comm; feeds `has_agent` | rk owns the state schema (3-segment values carry the agent pid); instrumentation is a stronger signal than comm heuristics — the natural agent-state-aware upgrade | S:60 R:80 A:75 D:65 |
| 9 | Confident | Agent comm classification extends fab's `claude`/`claude-code` with `codex`, `gemini`, `copilot` | rk's multi-agent posture (chat adapters, agent-state provider-agnosticism) signals the broader set; easily tuned later — a pure classifier-table edit | S:45 R:85 A:55 D:45 |

9 assumptions (4 certain, 5 confident, 0 tentative, 0 unresolved).
