# Plan: rk mux send + rk mux await — agent-to-agent messaging verbs

**Change**: 260815-a5vf-rk-send-await-agent-messaging
**Intake**: [intake.md](intake.md)

## Requirements

### CLI: the `rk mux` family

- **R1**: `root.go` MUST register a `muxCmd` parent (`Use: "mux"`, short: tmux substrate operations) carrying a persistent `-L/--server` string flag inherited by its subcommands (the `fab pane` pattern). This change adds exactly two members: `send` and `await`. Moving existing root commands under `mux` is out of scope (docs/specs/cli-layering.md owns that plan).
  - GIVEN `rk mux -h` WHEN printed THEN it lists `send` and `await` with the shared `-L` flag; `rk -h` gains one `mux` row.

### `rk mux send`

- **R2 (target grammar)**: The `<target>` argument MUST accept exactly three forms — pane ID (`%N`), window ID (`@N`), and exact session:window (`=session:window`) — and reject everything else (usage error, exit 2). Bare `session:window` names are rejected (tmux target-grammar collision footgun). Window forms resolve server-side to the window's **agent pane**: the pane whose `@rk_agent_state` parses to a known state (after pid-liveness reconcile), falling back to the window's active pane.
  - GIVEN `rk mux send mysession:win "hi"` THEN usage error exit 2 naming the three accepted forms. GIVEN `@3` where pane `%7` carries `@rk_agent_state` THEN injection targets `%7`.
- **R3 (payload forms)**: Exactly one payload kind MUST be supplied — a positional `<message>`, the literal `-` (read message from stdin), or one-or-more repeatable `--key <name>` flags (tmux key names: `Enter`, `Up`, `C-c`, …). Zero payloads or mixed kinds is a usage error (exit 2).
  - GIVEN `rk mux send %5 -` with a multi-line heredoc on stdin THEN the full text is delivered as one bracketed paste. GIVEN both a message and `--key` THEN usage error.
- **R4 (agent-state gate)**: Before any delivery the command MUST read the target pane's `@rk_agent_state` (via the shared `internal/tmux` parse + pid-liveness reconcile) and apply this matrix — fab-kit's `idleGate` verbatim:

  | State | plain | `--answer` |
  |-------|-------|------------|
  | unknown (absent/unparseable/reconciled-away) | warn to stderr + send | warn + send |
  | `idle` | send | send |
  | `waiting` | refuse | send |
  | `active` | refuse | refuse |

  Refusals name the state, go to stderr, exit 1. `--force` skips the gate (target existence still validated). `--answer` and `--force` MUST be mutually exclusive (cobra `MarkFlagsMutuallyExclusive` — usage error, not silent precedence).
  - GIVEN a pane with `@rk_agent_state=active:…` WHEN `rk mux send %5 "x" --answer` THEN refusal naming `active`, exit 1, no tmux mutation.
- **R5 (delivery = shared injection engine)**: Text payloads MUST be delivered through the extracted injection engine (R9): sanitize → named-buffer `set-buffer --` → bracketed `paste-buffer -d -p` → novelty echo probe → probe-gated Enter. `--no-enter` skips only the Enter (text stays staged). The CLI path uses a per-invocation buffer name `rk-send-<pid>` (never the daemon's `rk-chat-send`). Probe failure sends no Enter, prints the recoverable-state message (text remains staged in the composer; a resend would duplicate it) to stderr, exits 1. Key payloads (`--key`) are sent post-gate as raw `send-keys` key names — no paste, no probe.
  - GIVEN a pane showing a permission dialog (paste never echoes) THEN no Enter is sent, stderr carries the staged-text warning, exit 1.
- **R6 (composed ask-and-wait)**: `--await[=<states>]` (default `idle,waiting`) MUST, after a successful submit, first watch for the pane's state to flip to `active` under a bounded grace (~10s; if the grace expires without a flip, fall through to the await — the grace window closes the stale-state race), then run the R8 observer with `--until <states>`, printing the await report word as the final stdout line. `--timeout` bounds the await phase (observer only). `--await` with `--no-enter` is a usage error (nothing was submitted to wait on).
  - GIVEN `rk mux send %5 "question" --await --timeout 120` WHEN the peer answers within budget THEN stdout ends with `waiting` or `idle`; WHEN not THEN `running`, exit 0.
- **R7 (output contract)**: stdout carries exactly one report line: `delivered %N` on probe-confirmed submit, `staged %N` under `--no-enter`, `sent %N` for `--key` sends, or the R6 await report word when `--await` is used. Diagnostics/warnings go to stderr. Exit codes: 0 success, 1 operational failure (refusal, probe failure, missing target, tmux failure), 2 usage — the toolkit convention, not fab's pane-family 2/3 scheme.

### `rk mux await`

- **R8 (observer)**: `rk mux await <target> [--until <state>[,<state>]] [--file <path>] [--after-active] [--timeout <secs>] [--notify[=msg]]` MUST block until any waitable signal fires and print a one-word report (mirroring `fab pane await`'s proven contract):
  - a state in the `--until` set (default `idle`) was reached → report that state, exit 0
  - `--file` path exists (OR-composed) → `file`, exit 0
  - `--timeout` (default 300; 0 = indefinite) expired → `running`, exit 0 (the timeout bounds the OBSERVER, never the pane)
  - the pane died mid-wait → `gone`, exit 1 (toolkit operational-failure convention; a fired signal wins over a mid-tick death)
  Contract details: the first check runs before any sleep (an already-fired signal returns immediately); internal poll tick ~2s (not configurable); an uninstrumented pane (no `@rk_agent_state`) with no `--file` errors immediately (exit 1 — nothing observable); `--after-active` requires observing `active` at least once before an `--until` state counts; `--notify[=msg]` sends a Web Push via the existing notify path when a signal fires (default message `agent <target> is <report>`), fail-silent per the rk notify contract. `waiting` in the `--until` set reports `waiting` when reached.
  - GIVEN an already-idle instrumented pane THEN `idle` prints immediately with no sleep. GIVEN `--after-active` on that pane THEN the observer keeps waiting until an active→idle round-trip is seen.

### Shared injection engine (extraction)

- **R9**: The injection sequence currently inlined in `api/chat.go` (`injectChatMessage` + `setAndPaste` + the novelty probe with needle derivation, collapse-chip matching, settle/retry, the per-(server,pane) lock map, and the set→paste critical-section mutex) MUST move to a new `internal/inject` package with: a small `inject.Tmux` interface (capture / set-buffer / paste-buffer / send-Enter, context-bound) so both consumers stay testable; the buffer name as a parameter (daemon passes `rk-chat-send`, CLI passes `rk-send-<pid>`); the sanitize helper exported (both callers sanitize at their boundary); all probe timing knobs carried over as package vars. `handleChatSend` MUST become a thin consumer — behavior-preserving: the existing chat-send tests (400/404/409/500/200 matrix, injection order, probe semantics, lock serialization) keep passing with at most mechanical seam updates. The cross-pane set→paste mutex applies per buffer-name owner (the CLI's unique buffer needs no cross-process guard; same-pane cross-process paste races are accepted as inherent).
  - GIVEN the existing `api/chat.go` test suite WHEN run post-extraction THEN it passes; GIVEN the engine driven by a fake `inject.Tmux` THEN order baseline→set→paste→probe→Enter and fail-closed probe are assertable without tmux.

### tmux primitives + target resolution

- **R10**: `internal/tmux` MUST gain the small primitives the verbs need, all `exec.CommandContext` argv slices under the caller's context: read one pane's `@rk_agent_state` (reusing `parseAgentState` + the pid-liveness reconcile already in `tmux.go`), send named keys to a pane, check pane existence/liveness, and resolve a window target (`@N` / `=session:window`) to its agent pane (R2 rule). Target-form validation lives in `internal/validate` or beside the resolver — strict forms only.
  - GIVEN a pane with a legacy two-segment or dead-pid state value THEN the gate reads `unknown` (never partial trust), matching the sessions-path reconcile.

### Conformance

- **R11**: The new surface MUST pass the toolkit checks: help-dump test updated for the `mux` tree (platform-stable, nothing hidden), Principle 9 (stdout = the single report line, `--quiet`-immune; chatter to stderr via the `outputSink` convention), a `mux` topic page registered in `skillTopics` (+ `docs/site/skill/mux.md` and a topic-index line in the core bundle), and the standards check run against the HEAD build (`bin/rk`, never the installed brew binary).

### Non-Goals

- Moving `reaper`/`snapshot`/`tmux-guard`/`init-conf` under `mux` (cli-layering.md parts 3–4).
- The fab-kit half (operator/helper migration, `fab pane send`/`await` deletion — part 5).
- Any web-UI surfacing; protocol-based (non-tmux) sends.

### Design Decisions

- **Decision**: Engine package named `internal/inject`. **Why**: mechanics-named like `internal/present`; "chat" no longer describes it once the CLI consumes it. **Rejected**: `internal/agentsend` (couples name to one consumer). *Introduced by 260815-a5vf.*
- **Decision**: CLI probe failure = staged text + stderr message + exit 1 (the 409's CLI analog). **Why**: strictly better than a blind Enter; message steers away from a duplicating resend. **Rejected**: exit 0 with `staged` (hides the failure from scripts). *Introduced by 260815-a5vf.*
- **Decision**: `--await` grace expiry falls through to the await rather than erroring. **Why**: hooks may lag or the peer may finish within the grace; erroring would flake. **Rejected**: hard error on no active flip. *Introduced by 260815-a5vf.*

## Tasks

### Phase 1: Extraction & primitives

- [x] T001 Extract the injection engine from `app/backend/api/chat.go` into new `app/backend/internal/inject/` (engine func + `Tmux` interface + lock map + set→paste mutex + sanitize + probe constants/vars as parameters/package vars; buffer name parameterized); refactor `handleChatSend`/`injectChatMessage` to consume it; keep the full existing chat-send test matrix green (mechanical seam updates only) <!-- R9 -->
- [x] T002 Add `internal/tmux` primitives: single-pane `@rk_agent_state` read (reusing `parseAgentState` + liveness reconcile), pane key-name send, pane existence/liveness check, window→agent-pane resolution + strict target-form validation (%N / @N / =session:window) <!-- R10, R2 -->

### Phase 2: The verbs

- [x] T003 Create `app/backend/cmd/rk/mux.go`: `muxCmd` parent with persistent `-L/--server`, registered in `root.go` <!-- R1 -->
- [x] T004 Create `app/backend/cmd/rk/mux_send.go`: target parsing (R2), payload XOR validation (R3), gate matrix + `--answer`/`--force` exclusivity (R4), engine delivery with `rk-send-<pid>` buffer + `--no-enter` + probe-failure path (R5), `--key` raw-key arm (R5), output contract + exit codes (R7); unit tests via seam fns (the `present.go` pattern) covering the gate matrix, payload validation, and report lines <!-- R2 R3 R4 R5 R7 -->
- [x] T005 <!-- rework: 5s command ctx bounds the whole observer — run observer under parent ctx, per-read timeout inside readState --> Create `app/backend/cmd/rk/mux_await.go`: observer loop with `--until` set, `--file` OR-composition, `--after-active`, `--timeout` (running@0-exit), `gone` exit 1, first-check-before-sleep, uninstrumented+no-file immediate error, `--notify` fail-silent via the existing notify send; unit tests over a fake observer clock/reader <!-- R8 -->
- [x] T006 <!-- rework: same 5s ctx kills the 10s grace; also uninstrumented-pane --await must fall through, not error post-delivery --> Wire `--await[=<states>]` composition into mux_send: post-submit active-flip grace (~10s) then the R8 observer; usage error with `--no-enter`; await report word as final stdout line <!-- R6 -->

### Phase 3: Conformance & polish

- [x] T007 Update the help-dump test for the `mux` tree; route both verbs through the `outputSink` convention (stdout = report line only; stderr chatter honors `--quiet`) <!-- R11 -->
- [x] T008 Add the `mux` skill topic page (`docs/site/skill/mux.md` + `skillTopics` registration + core-bundle topic-index line) documenting both verbs' contracts for agent consumers <!-- R11 -->
- [x] T009 Run the gates: `cd app/backend && go test ./...`, `just build`, and the standards new-surface check against `bin/rk` <!-- R11 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk mux -h` lists `send`/`await`; both inherit `-L`; `rk -h` gains exactly one `mux` row
- [x] A-002 R2: all three target forms accepted, bare names rejected with exit 2; window forms resolve to the agent pane with active-pane fallback
- [x] A-003 R3: message / `-` stdin / `--key` are XOR-validated; multi-line stdin arrives as one bracketed paste
- [x] A-004 R4: gate matrix matches the table for all 4 states × 2 modes; `--force` skips; `--answer --force` is a usage error
- [x] A-005 R5: delivery runs sanitize→set→paste→probe→Enter with `rk-send-<pid>`; `--no-enter` stages; probe failure = no Enter + stderr message + exit 1; `--key` bypasses paste/probe
- [x] A-006 R6: `--await` observes the active flip under grace then awaits; grace expiry falls through; `--await --no-enter` errors — FIXED: the 5s bounded ctx now covers only the delivery phase (`mux_send.go:217`); `muxSendAwaitPeer` rides the parent context (`mux_send.go:289`), so the 10s grace and the full `--timeout` await are reachable; covered by TestMuxSendAwaitComposition / GraceFallsThrough / PeerGone
- [x] A-007 R8: await reports idle/file/running/gone per contract; timeout exits 0; gone exits 1; immediate return on pre-fired signal; uninstrumented+no-file errors; `--after-active` requires the round-trip; `--notify` fires fail-silent — FIXED: the observer rides the parent context (`mux_await.go:175`) with only per-read timeouts inside `prodAwaitDeps.readState` (`mux_await.go:109-113`); pinned by TestAwaitObserverDeadlineIsItsOwnTimeout (observer outlives nothing but its own `--timeout`) and TestAwaitParentCancelAborts; the other reports remain unit-tested and correct
- [x] A-008 R9: existing chat-send tests pass post-extraction; engine order + fail-closed probe assertable against a fake `inject.Tmux`

### Behavioral Correctness

- [x] A-009 R4/R10: legacy two-segment and dead-pid state values read as unknown (warn+send), matching the sessions reconcile
- [x] A-010 R7: stdout is exactly the one report line under all outcomes; exit codes follow 0/1/2 — FIXED with the context split above: awaits outliving 5s now reach `running` (exit 0) or the reached state; verified via unit tests over the observer and the cobra path, plus a live HEAD-build check of usage-error exit 2 and the mutually-exclusive-flag exit 2

### Scenario Coverage

- [x] A-011 R5: permission-dialog pane (no echo) → staged text, no Enter, exit 1 — covered by TestMuxSendProbeFailure (probe failure = no Enter + staged-text stderr + exit 1) plus the handler-side 409 matrix
- [x] A-012 R8: already-idle pane returns `idle` with no sleep

### Code Quality

- [x] A-013 All new subprocess calls are `exec.CommandContext` argv slices with bounded contexts (Constitution I; no shell strings)
- [x] A-014 No new state stores: verbs derive everything from tmux at invocation time (Constitution II); no polling loops beyond the await observer's documented tick
- [x] A-015 Pattern consistency: cobra layout, seam-var testing, and `outputSink` usage match `present.go`/`role.go`; no duplication of `internal/tmux` utilities
- [x] A-016 New behavior is test-covered (gate matrix, payload validation, observer reports, engine order) per code-quality baseline

### Security

- [x] A-017 R5/R9: sanitize strips control bytes (incl. paste-end ESC sequences) on the CLI path exactly as the handler path; text reaches `set-buffer` as one `--`-terminated argv element

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Engine package `internal/inject` with a 4-method `Tmux` interface | Mechanics-named like `internal/present`; keeps both consumers testable | S:60 R:85 A:85 D:75 |
| 2 | Confident | CLI probe failure = staged + stderr + exit 1 | The 409's CLI analog; scripts must see the failure | S:55 R:85 A:85 D:75 |
| 3 | Confident | `--await` grace ~10s, expiry falls through to await | Hooks lag; erroring would flake; window closes the stale-state race | S:50 R:85 A:75 D:70 |
| 4 | Confident | `--key` sends report `sent %N` (no probe available for key names) | Key names have no echo to probe; distinct word keeps the contract honest | S:50 R:90 A:85 D:80 |
| 5 | Confident | Await poll tick ~2s, not configurable | fab pane await / dispatch wait precedent; internal knob | S:55 R:90 A:90 D:85 |

5 assumptions (0 certain, 5 confident, 0 tentative, 0 unresolved).

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The inlined chat-send engine it replaced (`injectChatMessage` internals, `sanitizeChatText`, `chatProbeFailure`, `chatSendLocks`, `chatSetPasteMu`, probe helpers in `api/chat.go`) was removed by the same apply diff; the fixed-buffer wrappers `SetChatSendBufferCtx`/`PasteChatSendBufferCtx` remain in use via the `TmuxOps` seam (`api/router.go:101-102,392`).
