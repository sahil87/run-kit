# Plan: Boot-ready signal + spawn-and-inject composite

**Change**: 260903-4czh-boot-ready-spawn-inject
**Intake**: `intake.md`

> **Base branch**: `260903-7ajq-typed-kickoff-fix` (PR #806) — this change deletes/replaces code that exists only there. Merge order: #806 first.

## Requirements

### Agent-state: the boot stamp

#### R1: SessionStart also stamps `idle`
The claude registry row `{event: "SessionStart", state: agentHookStampToken}` SHALL, in addition to today's `@rk_pane_chat` stamp, write `@rk_pane_agent_state idle:<epoch>[:<pid>]` inside the `rk agent hook` binary, under the spec's Writer Rules verbatim: self-locate via `$TMUX_PANE`, no-op outside tmux, never fail the agent, pid from the existing comm-validated ancestor walk with the pid segment omitted when the walk fails. No new state value, no schema change, no settings-file churn (the installed SessionStart hook line already delegates to the binary).

- **GIVEN** a claude agent with rk hooks installed starting (or resuming) inside a tmux pane
- **WHEN** its SessionStart hook fires
- **THEN** the pane carries both the `@rk_pane_chat` stamp and `@rk_pane_agent_state idle:<epoch>[:<pid>]`
- **AND** a stale `waiting`/`active` value from a previous agent in the same pane is overwritten

### internal/inject: the readiness primitive

#### R2: `AwaitReady` + `DeliverWhenReady` (`internal/inject/ready.go`, new file)
`internal/inject` SHALL gain:

```go
type Readiness int          // ReadyByState | ReadyBySettle
type ReadyOpts struct {
    State        func(ctx context.Context, paneID, server string) (string, error) // nil = state signal disabled
    Deadline     time.Duration // default 25s
    PollInterval time.Duration // default 600ms
    Sleep        func(time.Duration) // test seam; default time.Sleep
}
func AwaitReady(ctx context.Context, t Tmux, server, paneID string, opts ReadyOpts) (Readiness, error)
func DeliverWhenReady(ctx context.Context, t Tmux, server, paneID, text string, submit bool, e *Engine, opts ReadyOpts) (Readiness, error)
```

`AwaitReady` polls two signals, first hit wins: **state-present** — `opts.State` returns a valid reconciled state (any of idle/waiting/active; presence means hooks fired so the TUI is up; errors and empty values are "not yet", never fatal); **capture-settle** — `t.CapturePane` text is non-blank and byte-identical across two consecutive polls (the #806 heuristic, now living in one place). On deadline it SHALL return a typed error (`ErrNotReady` sentinel wrapped with the last capture's trailing snippet). `DeliverWhenReady` = `AwaitReady` then `e.Send(ctx, t, server, paneID, text, submit)`, returning the Readiness on success and the first error otherwise. The state reader is an injected func — `internal/inject` SHALL NOT import the tmux state layer. Pure-logic parts (signal arbitration, settle comparison) MUST be table-testable with a fake `Tmux` and scripted captures.

- **GIVEN** a fake pane whose captures settle on poll 3 and whose state func always errors
- **WHEN** `AwaitReady` runs
- **THEN** it returns `ReadyBySettle` before the deadline
- **GIVEN** a fake pane whose state func returns `idle:…` on poll 2 while captures never settle
- **WHEN** `AwaitReady` runs
- **THEN** it returns `ReadyByState`
- **GIVEN** neither signal fires
- **WHEN** the deadline passes
- **THEN** `errors.Is(err, ErrNotReady)` and the error text carries a capture snippet

### CLI: `rk mux await --ready`

#### R3: the `--ready` condition
`rk mux await` SHALL accept `--ready`: wait until the single target pane is boot-ready per R2 (state reader = `tmux.PaneAgentState`; the settle fallback active), honoring the existing `--timeout` and `--notify` machinery. `--ready` is mutually exclusive with `--until`, `--file`, and `--after-active` (usage error, exit 2, matching the family's flag-conflict style). Success reports which signal fired: `ready %5 (state)` or `ready %5 (settled)`; timeout keeps the family's existing timeout report/exit contract. Help text and the shll help-dump surface update accordingly.

- **GIVEN** a pane that stamps agent state during boot
- **WHEN** `rk mux await --ready %5` runs
- **THEN** it exits 0 printing `ready %5 (state)`
- **GIVEN** a hook-less agent whose screen settles
- **WHEN** `rk mux await --ready %5` runs
- **THEN** it exits 0 printing `ready %5 (settled)`

### rk tutorial: migrate to the composite

#### R4: tutorial delivery via `DeliverWhenReady`
`cmd/rk/tutorial.go` SHALL delete the hand-rolled `deliverTutorialKickoff` machinery (settle loop, `paneEchoesKickoff`, `stripToAlnum`, raw send-keys + Enter retry) and deliver the kickoff via `inject.DeliverWhenReady` with a per-invocation engine (`inject.NewEngine("rk-send-"+pid)` — the `rk mux send` buffer pattern), the CLI's inject `Tmux` adapter (reuse/share `cliInjectTmux` from `mux_send.go`; do not duplicate it), and state reader `tmux.PaneAgentState`. The behavior contract is unchanged from #806: bare launcher window, verified typed kickoff, and on ANY delivery failure a stderr paste-it-yourself note carrying the exact kickoff text with exit 0. Tests rewrite against the new seams and MUST still pass under `env -u TMUX -u TMUX_PANE go test ./cmd/rk/`.

- **GIVEN** no `tutorial` window and a booting agent
- **WHEN** `rk tutorial` runs
- **THEN** the kickoff is delivered through the inject engine (bracketed paste + echo probe + probe-gated Enter) after readiness, and the degrade note appears only on failure

### internal/riff: claude-gated task delivery

#### R5: non-claude task delivery is typed
riff's task injection SHALL branch at the composition seam on `launcherCommandName(launcher)`:

- `"claude"` → **byte-identical to today**: the task rides `buildSkillShellString` as the positional argument (instant, race-free; zero regression).
- anything else + non-empty task → the skill pane composes **bare**, and after the window spawns the task is delivered to the window's captured pane-0 id via `inject.DeliverWhenReady` (same engine/adapter/state-reader wiring as R4).

A pure helper (e.g. `taskDeliveryMode(launcher, task) → positional | typed | none`) SHALL own the branch and be unit-tested. `spawnRiffReturningName` SHALL return the captured pane id (it already holds it internally) so both frontends can target delivery; `Result` gains a `PaneID` field. Bare-skill panes (`--skill` with no value) and `--cmd` panes are untouched. The fork path (`ResumeSessionRef`, already claude-gated by `resumeForkLauncher`) keeps today's positional/flags composition.

- **GIVEN** launcher `kimi --auto` and task `do X`
- **WHEN** the spawn composes
- **THEN** the pane command carries no positional task, and after spawn the task is typed and verified into pane 0
- **GIVEN** launcher `claude --dangerously-skip-permissions` and task `do X`
- **WHEN** the spawn composes
- **THEN** the shell string is byte-identical to today's positional composition and no typed delivery runs

#### R6: delivery locus per frontend
- **CLI path** (`riff.Run` count==1 and the `runCount` fan-out): typed delivery runs synchronously per window (inside the existing per-window goroutine on fan-out). A delivery failure prints a stderr warning naming the window and carrying the task text (the tutorial degrade pattern) and DOES NOT fail the spawn or trigger rollback — the window and agent exist.
- **Daemon path** (`riff.Spawn` — POST /api/riff and the fork route): the HTTP response SHALL NOT block on boot; typed delivery runs in a background goroutine with `context.Background()`-derived bounds (not the request context, which cancels at response write), failure logged server-side (`log.Printf` with server/window/pane identifiers). Response shape unchanged.

- **GIVEN** a non-claude spawn with a task via POST /api/riff
- **WHEN** the handler returns
- **THEN** the response arrives without waiting for agent boot, and the task lands (or a failure is logged) afterward
- **GIVEN** `rk riff --skill 'do X'` fan-out with a non-claude launcher and one window's delivery failing
- **WHEN** the run completes
- **THEN** all windows exist, the failing window's warning names it, and the exit code reflects spawn success

### Docs

#### R7: discoverability + spec
`fab/project/code-quality.md`'s duplicate-utilities anti-pattern line SHALL name `internal/inject/` among the check-first locations. `docs/specs/agent-state.md` SHALL gain a short **Boot-ready** subsection: SessionStart's idle stamp, the readiness definition (state-present preferred, capture-settle fallback), and the `await --ready && send --force` composition for hook-less agents.

- **GIVEN** the code-quality anti-pattern list
- **WHEN** an agent checks utilities before writing delivery code
- **THEN** `internal/inject/` is named

### Non-Goals

- fab-kit changes (operator launcher migration, `fab dispatch ready/deliver` delegation to `rk mux`) — follow-up in the fab-kit repo consuming this change's CLI surface.
- New `rk mux send` gate modes — hook-less composition is documented as `await --ready && send --force`.
- New agent-state values or schema changes; registry coverage beyond Claude.
- `fab dispatch ready` changes — untouched here.

### Design Decisions

#### Boot-ready is state-presence, stamped as `idle` at SessionStart
**Decision**: readiness for registry agents = a valid reconciled `@rk_pane_agent_state` exists; the existing SessionStart hook row stamps `idle` to make that true at boot.
**Why**: no new state value or reader change; `idle` is semantically true at session start; binary delegation ships the new write fleet-wide on upgrade; the stamp also clears stale state from a pane's previous agent.
**Rejected**: a new `ready`/`boot` state value (schema churn, every reader must learn it); a separate `@rk_pane_boot` option (second option to reconcile and clean).
*Introduced by*: 260903-4czh-boot-ready-spawn-inject

#### The state reader is injected into `internal/inject`
**Decision**: `ReadyOpts.State` is a caller-supplied func; inject never imports the tmux state layer.
**Why**: inject stays the dependency-light delivery core shared by daemon and CLI; callers already know their state source (`tmux.PaneAgentState`).
**Rejected**: inject importing `internal/tmux` for `PaneAgentState` (dependency inversion for one func; complicates the daemon's mocked seams).
*Introduced by*: 260903-4czh-boot-ready-spawn-inject

#### riff keeps positional injection for claude only
**Decision**: task delivery branches on `launcherCommandName`: claude → positional (today's bytes), otherwise typed via the composite.
**Why**: positional is instant and race-free where it works; the claude gate has the `resumeForkLauncher` precedent; typed-everywhere would add a boot wait to the dominant path for no correctness gain.
**Rejected**: typed delivery for all launchers (regresses claude UX and adds an HTTP-async path where none is needed); a per-provider prompt-flag table (rk would own provider CLI schemas — constitution §III).
*Introduced by*: 260903-4czh-boot-ready-spawn-inject

#### Daemon-path delivery is fire-and-forget
**Decision**: `riff.Spawn` returns without waiting for boot; delivery runs in a background goroutine off `context.Background()` with its own deadline, failures logged.
**Why**: an HTTP response blocking up to ~25s on agent boot is unacceptable; the degrade posture ("window and agent exist either way") already tolerates undelivered prompts.
**Rejected**: blocking the handler (timeout risk, terrible UX); a delivery-status side channel (no consumer today; SSE/window state already shows the agent).
*Introduced by*: 260903-4czh-boot-ready-spawn-inject

## Tasks

### Phase 1: The primitive

- [x] T001 [P] `app/backend/internal/inject/ready.go` + `ready_test.go`: `Readiness`, `ReadyOpts` (injected `State` func, `Deadline` 25s, `PollInterval` 600ms, `Sleep` seam), `AwaitReady` (state-present OR capture-settle, typed `ErrNotReady` with last-capture snippet), `DeliverWhenReady` composite; table tests with fake `Tmux` + scripted captures/state (state wins, settle wins, deadline, state-func errors tolerated) <!-- R2 -->
- [x] T002 [P] `app/backend/cmd/rk/agent_hook.go` (+ `agent_hook_test.go`): the SessionStart stamp token additionally writes `@rk_pane_agent_state idle:<epoch>[:<pid>]` under the Writer Rules (reuse the existing comm-walk pid resolution; never fail; `$TMUX_PANE` self-locate); verify `agent_setup.go` registry row/help text stays accurate <!-- R1 -->

### Phase 2: Surfaces and migrations

- [x] T003 `app/backend/cmd/rk/mux_await.go` (+ tests): `--ready` flag — mutual exclusion with `--until`/`--file`/`--after-active` (usage error, exit 2), wiring to `inject.AwaitReady` with `tmux.PaneAgentState`, reports `ready %N (state)` / `ready %N (settled)`, existing `--timeout`/`--notify` honored; update Long help <!-- R3 -->
- [x] T004 Share the CLI inject adapter: lift `cliInjectTmux` (mux_send.go) to a form reusable by tutorial/await (same package — rename/move only if needed); no behavior change to `rk mux send` <!-- R4 -->
- [x] T005 `app/backend/cmd/rk/tutorial.go` + `tutorial_test.go`: replace `deliverTutorialKickoff` internals with `inject.DeliverWhenReady` (per-invocation engine `rk-send-<pid>`, shared adapter, `tmux.PaneAgentState` reader); delete `paneEchoesKickoff`/`stripToAlnum`/the settle+Enter-retry loop; keep the degrade-note contract and exit codes; rewrite tests on the new seams (still green under `env -u TMUX -u TMUX_PANE`) <!-- R4 -->
- [x] T006 `app/backend/internal/riff`: pure `taskDeliveryMode(launcher, task)` helper + unit tests; `spawnRiffReturningName` returns pane-0 id; `Result.PaneID` field; composition seam branches — claude keeps byte-identical positional composition (pin with a test), non-claude+task composes bare <!-- R5 -->
- [x] T007 `app/backend/internal/riff` CLI path (`Run`/`runCount`): synchronous typed delivery per window for non-claude+task via `inject.DeliverWhenReady`; stderr warning (window name + task text) on failure, spawn still succeeds, no rollback; fan-out delivers inside the existing per-window goroutines <!-- R5, R6 -->
- [x] T008 `app/backend/internal/riff` daemon path (`Spawn`): background-goroutine delivery off `context.Background()` with its own deadline; server-side log on failure naming server/window/pane; HTTP response shape unchanged (verify `api/riff.go` needs no edit); fork path untouched <!-- R5, R6 -->

### Phase 3: Integration & Edge Cases

- [x] T009 Riff tests for both delivery paths (seamed inject calls — no live tmux): non-claude task → bare compose + delivery invoked with captured pane id; claude task → positional, zero delivery calls; CLI failure → warning + exit 0; daemon path → handler returns before delivery completes (goroutine seam) <!-- R5, R6 -->
- [x] T010 Verification gates: `go build ./...`; `go test ./internal/inject/ ./internal/riff/ ./cmd/rk/`; `env -u TMUX -u TMUX_PANE go test ./cmd/rk/`; existing inject/chat/actuation tests pass unmodified <!-- R2, R4 -->

### Phase 4: Polish

- [x] T011 [P] Docs: `fab/project/code-quality.md` check-first line gains `internal/inject/`; `docs/specs/agent-state.md` gains the **Boot-ready** subsection (SessionStart idle stamp, readiness definition, `await --ready && send --force` composition) <!-- R7 -->

## Execution Order

- T001 blocks T003, T005, T007, T008 (they call AwaitReady/DeliverWhenReady)
- T004 blocks T005 (shared adapter)
- T006 blocks T007–T009 (pane-id plumbing + mode helper)
- T002 and T011 are independent

## Acceptance

### Functional Completeness

- [x] A-001 R1: SessionStart fires → pane carries both the chat stamp and `idle:<epoch>[:<pid>]` agent state, written under the Writer Rules (never-fail, comm-walk pid, pid omitted on walk failure)
- [x] A-002 R2: `inject.AwaitReady`/`DeliverWhenReady` exist with the injected state reader, both signals, defaults 25s/600ms, and typed `ErrNotReady`
- [x] A-003 R3: `rk mux await --ready` works end-to-end with both report forms and flag exclusivity (exit 2 on conflict)
- [x] A-004 R4: tutorial delivery goes through `inject.DeliverWhenReady`; the hand-rolled loop, `paneEchoesKickoff`, and `stripToAlnum` are gone from `tutorial.go`
- [x] A-005 R5: non-claude launcher + task → bare composition + typed delivery to the captured pane-0 id; `Result.PaneID` populated
- [x] A-006 R6: CLI delivery is synchronous with the stderr degrade warning; daemon delivery never blocks the HTTP response
- [x] A-007 R7: code-quality check-first line names `internal/inject/`; agent-state spec carries the Boot-ready subsection

### Behavioral Correctness

- [x] A-008 R5: claude launcher + task composes a shell string byte-identical to pre-change output (pinned by test), with zero typed-delivery calls
- [x] A-009 R1: a stale `waiting` value in a reused pane is overwritten to `idle` at the next SessionStart
- [x] A-010 R4: tutorial's user-facing contract is unchanged — bare launcher window, verified kickoff, stderr paste-note + exit 0 on delivery failure

### Scenario Coverage

- [x] A-011 R2: unit tests cover state-wins, settle-wins, deadline (ErrNotReady + snippet), and state-func-errors-tolerated
- [x] A-012 R5/R6: riff tests cover both frontends' delivery paths and the failure/degrade behaviors without live tmux
- [x] A-013 R4: cmd/rk suite green under `env -u TMUX -u TMUX_PANE go test ./cmd/rk/`

### Edge Cases & Error Handling

- [x] A-014 R2: a settled first-run dialog false-firing readiness is caught downstream — `DeliverWhenReady` surfaces the engine's ProbeFailure and callers degrade (tutorial note / riff warning / logged)
- [x] A-015 R6: daemon-path delivery uses background-context bounds, not the request context (delivery survives response write)
- [x] A-016 R5: fan-out with one failed delivery leaves all windows alive, warns once for the failed one, and triggers no rollback

### Code Quality

- [x] A-017 Pattern consistency: new code matches sibling shapes (mux family flag style, riff pure-helper style, inject test style)
- [x] A-018 No unnecessary duplication: one readiness implementation (inject), one CLI adapter (shared), tutorial/riff contain no local delivery loops
- [x] A-019 Subprocess discipline: every tmux call remains argv-slice with bounded contexts; no shell strings beyond the documented launcher exception
- [x] A-020 Tests cover the added behavior (code-quality baseline)

### Security

- [x] A-021 R5: the typed task text goes through the engine's sanitize + named-buffer paste (never into a shell string); the claude positional path keeps the existing single-quote escaping; no user input reaches the unescaped launcher element

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- **Stacking**: base is PR #806's branch. Do not rebase onto main mid-change; ship stacks the PR on #806.

## Deletion Candidates

- `readHookSessionID` (`app/backend/cmd/rk/agent_hook.go:289`) — production path migrated to `readHookInput`; only its own tests still call it (tests could target `readHookInput` directly)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `AwaitReady` treats state-func errors/empties as "not yet", never fatal | A hook-less pane must fall through to the settle signal; erroring would defeat the fallback | S:75 R:85 A:90 D:85 |
| 2 | Confident | `Result.PaneID` is additive (json omitempty-compatible); no API handler changes needed | riff.Result feeds the HTTP response builder — an added field is backward-compatible; verify at T008 | S:60 R:85 A:80 D:75 |
| 3 | Confident | The settle heuristic parameters stay at #806's values (25s/600ms; two identical non-blank captures) | Field-proven this week on the real fast tier; tunable vars remain for tests | S:65 R:85 A:80 D:80 |
| 4 | Confident | The SessionStart idle write is withheld for `source=compact` (parsed payload) and for unparseable payloads | The spec documents that compact fires mid-turn, where an idle write would clobber a live `active` — the plan's boot-stamp intent covers startup/resume/clear; fail-safe skip preserves the anti-clobber invariant the stamp token was created for | S:70 R:85 A:85 D:80 |
| 5 | Confident | Typed delivery (riff CLI path, tutorial) targets the tmux server by the `-L` label derived from the $TMUX socket basename — the mux family's `muxServer` derivation — not the restored-$TMUX env the spawn calls use | internal/tmux's name-parameterized inject/buffer primitives address servers by label only; label and restored-env targeting coincide for the default and `-L`-named servers (a custom `-S` path outside the default dir is misaddressed — the mux family already accepts this) | S:55 R:80 A:80 D:70 |
| 6 | Confident | The typed-composition branch applies to pane 0 only; split panes (1..N) with skill values keep positional composition | Only the pane-0 id is captured at spawn, so only pane 0 has a delivery target; multi-pane non-claude skill values stay as-is (pre-existing latent gap, out of scope) | S:65 R:80 A:85 D:75 |
| 7 | Confident | `--ready` is also mutually exclusive with `--any` (beyond the plan's `--until`/`--file`/`--after-active` list) | `--ready` is defined for the single target pane; a multi-target boot-wait has no coherent report shape in the family | S:55 R:85 A:85 D:70 |

7 assumptions (1 certain, 6 confident, 0 tentative).
