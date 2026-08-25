# Plan: rk mux await --any — multi-target any-of wait mode

**Change**: 260823-tqkt-mux-await-any-multi-target
**Intake**: `intake.md`

## Requirements

### CLI: `--any` surface

#### R1: `--any` mode flag and multi-target arguments
`rk mux await` SHALL gain a bool flag `--any` switching the positional target contract from exactly-one to one-or-more. Without `--any`, exactly one target is required and behavior is byte-identical to today. With `--any`, at least one target is accepted (a single target is allowed and uses the multi-target report format); each target uses the existing grammar (`%N`, `@N`, `=session:window`; bare names rejected, exit 2) and is resolved to a pane ID up front via `resolvePaneTarget` before the wait begins, all on the one resolved `-L` server. Two targets resolving to the same pane ID SHALL be a usage error (exit 2). The `Use` string and `Long` help SHALL document the mode.

- **GIVEN** `rk mux await --any %1 @3 --until waiting,idle`
- **WHEN** the command parses and `@3`'s agent pane resolves to `%7`
- **THEN** the observer watches `{%1, %7}`;
- **AND GIVEN** `rk mux await %1 %2` (no `--any`), **THEN** usage error (exit 2);
- **AND GIVEN** `--any %1 @3` where `@3` resolves to `%1`, **THEN** usage error (exit 2) naming the duplicate.

#### R2: Any-of observer sweep
Under `--any` the observer SHALL, per ~2s tick and with the first sweep running BEFORE any sleep (the poll-after-arm guarantee — MUST (b) of backlog `[tqkt]`): check the single global `--file` signal first, then read each target pane's reconciled `@rk_agent_state` in listed order; the first pane whose state is in `--until` wins the tick. `--after-active` SHALL be tracked per pane — each target must individually be observed `active` before ITS `--until` state counts. `--timeout` remains one whole-invocation observer bound; expiry reports `running`, exit 0.

- **GIVEN** `--any %1 %5 --until idle` with `%1` active and `%5` already idle
- **WHEN** the first sweep runs
- **THEN** the wake fires for `%5` before any sleep;
- **AND GIVEN** `--after-active` with `%5` idle since arm and never seen active, **THEN** `%5` does not fire until an active→idle round-trip is observed on `%5` itself.

#### R3: Multi-target report contract
Under `--any` stdout SHALL stay ONE line with the report word as the FIRST token: a reached state appends the firing pane (`waiting %5`, exit 0); a target death with no same-tick signal reports `gone %N`, exit 1; `file` and `running` stay bare (no pane), exit 0. Without `--any` the report stays the bare single word (existing contract untouched). Exit codes follow the toolkit convention throughout.

- **GIVEN** `--any %1 %5` and `%5` flips to `waiting`
- **WHEN** the wake fires
- **THEN** stdout is exactly `waiting %5` and exit is 0;
- **AND GIVEN** the same wait timing out, **THEN** stdout is `running`, exit 0.

#### R4: Death semantics — first gone target wakes; fired signal wins the tick
The first target observed gone SHALL wake the whole await with `gone %N`, exit 1 — no drop-and-continue. Within one sweep a fired signal wins over a death: the sweep records the first gone pane but continues reading remaining targets, and a state signal (or the already-checked file signal) found in the same sweep is reported instead of the death.

- **GIVEN** `--any %1 %5` where the tick finds `%1` gone and `%5` in an `--until` state
- **WHEN** the sweep completes
- **THEN** the report is `<state> %5`, exit 0;
- **AND GIVEN** no signal fires that sweep, **THEN** `gone %1`, exit 1.

#### R5: Unobservable member fails the arm
On the first sweep, any target carrying no `@rk_agent_state` when no `--file` was given SHALL fail the whole invocation immediately (exit 1) with an error naming that pane — the multi-target extension of the existing "nothing observable to wait on" rule.

- **GIVEN** `--any %1 %9` where `%9` is uninstrumented and no `--file`
- **WHEN** the first sweep runs
- **THEN** the command errors naming `%9`, exit 1;
- **AND GIVEN** the same set with `--file /tmp/x`, **THEN** the wait proceeds.

#### R6: `--notify` composition
`--notify[=msg]` SHALL compose unchanged (fail-silent Web Push on every wake). Under `--any` the default message SHALL carry the firing pane when one exists (`agent %N is <state>`, including `agent %N is gone`) and the mode otherwise (`await --any is <report>` for `file`/`running`). The single-target default message is unchanged.

- **GIVEN** `--any %1 %5 --notify` waking on `waiting %5`
- **WHEN** the push fires
- **THEN** the default body is `agent %5 is waiting`.

### Docs: skill page

#### R7: `skill/mux.md` documents `--any` and the fleet-wake protocol
The await section of `app/backend/cmd/rk/skill/mux.md` SHALL gain `--any` usage examples, the multi-target report table, and a short fleet-wake protocol note carrying the caller obligations from backlog `[tqkt]`: (a) exclude already-waiting panes at arm (rk does NOT filter — an already-fired `--until` state returns immediately by design); (b) the first-check-before-sleep sweep closes the arm-gap (rk guarantee); (c) re-arm after resume/`/clear`; (d) kill+re-arm on target-set changes; (e) debounce re-arms against waiting↔active flap. Gotchas SHALL note: `gone %N` names the dead pane (exit 1) under `--any`; an uninstrumented member fails the whole arm; all targets share one `-L` server.

- **GIVEN** an agent reading `rk skill mux`
- **WHEN** it plans a fleet wake
- **THEN** the page states the `--any` report shapes and all five caller/rk obligations.

### Non-Goals

- `rk mux send --await` stays single-target; its grace-watch composition is untouched.
- No daemon/SSE subscription — the observer stays a direct-tmux poll loop (no-daemon-dependency property of the mux family).
- No rk-side `--settle`/`--debounce` or arm-time filtering flags (caller protocol per the intake's MUST mapping).
- No fab-kit changes (operator skill wiring is separate work in that repo).

### Design Decisions

#### MUST list (a)/(c)/(d)/(e) live in the caller protocol, (b) is an rk guarantee
**Decision**: rk implements no exclusion filtering, no re-arm logic, and no debounce; it guarantees the first sweep runs before any sleep and documents the five-point protocol in the skill page.
**Why**: (c)/(d) are explicitly caller-side in the backlog; rk-side at-arm baselining would reopen the exact edge-trigger gap (b) exists to close; a single invocation wakes once, so inter-wake spacing is inherently the re-armer's property.
**Rejected**: at-arm state baselining (loses wakes that fired between the caller's last read and the arm); a `--settle` flag (suppresses legitimate wakes).
*Introduced by*: 260823-tqkt-mux-await-any-multi-target

#### Report word stays the first stdout token; firing pane appended
**Decision**: `--any` reports `<state> %N` / `gone %N`, with `file`/`running` bare; single-target output is unchanged.
**Why**: callers need pane identity; keeping the report word first preserves the family's one-word-parse habit (first token discriminates the outcome in both modes).
**Rejected**: `%N <state>` ordering (breaks first-token parsing); JSON output (heavier than the family's one-line report contract).
*Introduced by*: 260823-tqkt-mux-await-any-multi-target

#### First dead target wakes the await; no drop-and-continue
**Decision**: a gone member reports `gone %N` (exit 1) rather than being dropped from the set.
**Why**: consistent with single-target `gone`; pane death is wake-worthy for the fleet caller (beats the ~10m heartbeat the C1 spec accepted), and the caller re-arms minus the dead pane per MUST (d).
**Rejected**: drop-and-continue with gone-only-when-empty (silently narrows the watched set; the caller's set model drifts from reality).
*Introduced by*: 260823-tqkt-mux-await-any-multi-target

## Tasks

### Phase 1: Setup

- [x] T001 Add the `--any` bool flag, update `Use`/`Long`, and relax cobra Args to `usageArgs(cobra.MinimumNArgs(1))` with a RunE guard enforcing exactly one target without `--any` (usage error otherwise) in `app/backend/cmd/rk/mux_await.go` <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Parse and resolve ALL targets up front (loop `tmux.ParsePaneTarget` + `resolvePaneTarget`, one bounded ctx per resolution) and reject duplicate resolved pane IDs as a usage error, in `app/backend/cmd/rk/mux_await.go` <!-- R1 -->
- [x] T003 Generalize the observer to a pane slice (`awaitObserve` takes `panes []string`, returns `(report, firedPane string, err error)`): per-tick sweep = file first, then per-pane reads in listed order via the existing `deps.readState`; first `--until` match wins; per-pane `seenActive` map for `--after-active`; first-sweep instrumentation check errors naming the first uninstrumented pane when no `--file`; a gone pane is recorded but the sweep continues, and `gone %N` is returned only when no signal fired that sweep; timeout → `running` unchanged, in `app/backend/cmd/rk/mux_await.go` <!-- R2 -->
- [x] T004 Compose the report line and `--notify` in `runMuxAwait`: under `--any` append the fired pane to state/gone reports (bare `file`/`running`); default notify body `agent %N is <state>` when a pane fired, `await --any is <report>` otherwise; single-target output byte-identical to today, in `app/backend/cmd/rk/mux_await.go` <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Extend the test fake for per-pane scripts (e.g. `awaitScript` gains an optional per-pane state map keyed by pane ID, falling back to the existing single-script list) and mechanically adapt existing `awaitObserve` call sites to the slice signature, in `app/backend/cmd/rk/mux_await_test.go` <!-- R2 -->
- [x] T006 Add multi-target observer tests: any-of wake on the second pane (`<state> %N`); already-fired member returns before any sleep; per-pane `--after-active` isolation; same-sweep state signal beats an earlier pane's death; `gone %N` exit 1 when nothing fired; unobservable member fails fast naming the pane; timeout → `running`, in `app/backend/cmd/rk/mux_await_test.go` <!-- R4 -->
- [x] T007 Add cobra end-to-end tests: `--any` report format on stdout; two targets without `--any` exit 2; duplicate resolved targets exit 2; `--notify` default message carries the firing pane; explicit single-target no-`--any` output-format guard (bare word), in `app/backend/cmd/rk/mux_await_test.go` <!-- R3 -->

### Phase 4: Polish

- [x] T008 Update `app/backend/cmd/rk/skill/mux.md`: `--any` examples + multi-target report table in the await section, the five-point fleet-wake protocol note ((a)–(e) homes as specced), and the three Gotchas additions <!-- R7 -->

## Execution Order

- T001 → T002 → T003 → T004 (same file, dependency-ordered)
- T005 blocks T006/T007; T008 is independent

## Acceptance

### Functional Completeness

- [x] A-001 R1: `--any` accepts one-or-more targets with full grammar per member; without it, exactly-one is enforced and behavior is unchanged
- [x] A-002 R2: the any-of sweep wakes on the first `--until` match in listed order, first sweep before any sleep, per-pane `--after-active`
- [x] A-003 R7: `skill/mux.md` documents `--any` (examples, report table, five-point protocol, Gotchas)

### Behavioral Correctness

- [x] A-004 R3: `--any` reports are `<state> %N` / `gone %N` / bare `file` / bare `running` with toolkit exit codes; single-target output is byte-identical to before
- [x] A-005 R6: `--notify` default body names the firing pane under `--any` (`agent %5 is waiting`)

### Scenario Coverage

- [x] A-006 R1: tests cover duplicate-target rejection (exit 2) and multi-target-without-`--any` rejection (exit 2)
- [x] A-007 R2: tests cover the already-fired-member-returns-immediately (poll-after-arm) guarantee on the multi-target path

### Edge Cases & Error Handling

- [x] A-008 R4: a same-sweep fired signal wins over another member's death; otherwise the first gone member reports `gone %N` with exit 1
- [x] A-009 R5: an uninstrumented member with no `--file` fails the arm on the first sweep, naming the pane, exit 1

### Code Quality

- [x] A-010 Pattern consistency: the extension follows the existing observer/seam patterns (`awaitDeps`, `usageArgs`, sink report lines); comments state constraints only, no narration
- [x] A-011 No unnecessary duplication: target resolution, state reads, sleep, and notify reuse the existing helpers (`resolvePaneTarget`, `muxReadPaneState`, `sleepCtxCmd`, `sendNotify`); no parallel observer copy left behind
- [x] A-012 Tests: new/changed behavior is covered by `go test` cases (seam-driven, tmux-free) per code-quality.md
- [x] A-013 Bounded subprocesses: every tmux read stays an `exec.CommandContext` under `awaitCmdTimeout`; no unbounded per-read contexts introduced

### Security

- [x] A-014 R1: all targets are validated through `tmux.ParsePaneTarget` before any subprocess use; no shell-string construction

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant (the observer was generalized in place; the old single-target signature has no leftover callers).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Observer generalizes in place to a pane slice returning the fired pane (single-target callers pass a one-element slice) rather than a parallel `awaitObserveAny` | One loop keeps the contract single-sourced; test churn is mechanical; behavior for len==1 provably identical | S:55 R:85 A:80 D:70 |
| 2 | Confident | `--any` no-pane notify default is `await --any is <report>` (file/running) | Intake left the phrasing open; keeps the `agent %N is <state>` shape for pane wakes and stays truthful when no pane fired | S:45 R:90 A:70 D:60 |
| 3 | Certain | Test fake extends with an optional per-pane map, existing single-script behavior preserved as fallback | Pure test infrastructure; existing tests must keep passing unmodified in intent | S:60 R:95 A:90 D:85 |

3 assumptions (1 certain, 2 confident, 0 tentative).
