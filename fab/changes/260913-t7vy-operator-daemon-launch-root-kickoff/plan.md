# Plan: rk operator -L — Project-Root Launch Dir and Kickoff Visibility

**Change**: 260913-t7vy-operator-daemon-launch-root-kickoff
**Intake**: `intake.md`

## Requirements

### CLI: server-mode launch directory (`app/backend/cmd/rk/operator.go`)

#### R1: Derived launch root from the server's user sessions
In `-L/--server` mode, `rk operator` MUST derive the operator window's working directory from the target server's user-role sessions instead of `os.UserHomeDir()`. Candidates are `tmux.ListSessionFacts(ctx, server)` rows with `Role == tmux.SessionRoleUser`, in enumeration order. Each candidate's `Path` is collapsed to its main checkout by `gitinfo.MainWorktreeRoot` through a package seam `operatorMainRootFn` (default `gitinfo.MainWorktreeRoot`; `""` = not a repo, dropped). A root qualifies when `hasOperatorSkill(root)` is true: `.agents/skills/fab-operator/SKILL.md` OR `.claude/skills/fab-operator/SKILL.md` exists under it (`os.Stat`, no subprocess). The pure picker SHALL have the shape `operatorLaunchRoot(candidates []tmux.SessionFacts, rootOf func(string) string, hasOperatorSkill func(string) bool) (root, rung string)`, distinct-root keyed (two sessions on one root are one root carrying the max `Attached`/`Windows` across them).

- **GIVEN** server `runKit` has user sessions `runKit` (path `/home/u/code/run-kit`) and `completed` (path `/home/u/code/run-kit.worktrees/foo`), plus `_rk-operator`, `_rk-ctl`
- **WHEN** `rk operator -L runKit` runs and both paths collapse to `/home/u/code/run-kit`, which carries the skill
- **THEN** `new-window -c /home/u/code/run-kit` is issued, the infrastructure sessions are never candidates, and the rung is `sole`

#### R2: Ranking among qualifying roots
Among qualifying distinct roots the picker SHALL choose: exactly one → it (rung `sole`); else the highest `Attached` (rung `most-attached`); ties → highest `Windows` (rung `most-windows`); ties → the root whose first session appears earliest in enumeration order (rung `first`). Rung tokens are a closed set: `sole | most-attached | most-windows | first | home | explicit`, declared as named constants (the `sessionRung*` precedent).

- **GIVEN** two qualifying roots A (Attached 0, Windows 5) and B (Attached 1, Windows 2)
- **WHEN** the picker runs
- **THEN** B wins with rung `most-attached`
- **GIVEN** A (Attached 1, Windows 5) and B (Attached 1, Windows 2)
- **THEN** A wins with rung `most-windows`
- **GIVEN** A and B identical on both counts, A enumerated first
- **THEN** A wins with rung `first`

#### R3: Home fallback and agent-resolution root
When no candidate qualifies (no user session, no repo, or no synced skill tree) the window directory MUST fall back to `os.UserHomeDir()` exactly as today (rung `home`), and the agent-resolution root stays `""`. When a root is derived (or `--dir` is given), `operatorResolveAgentFn(ctx, root, operatorTier)` MUST receive that root so `fab agent operator -o yaml` resolves the project's `providers:` table. The interactive (no `-L`) path's git-root-of-cwd rule is unchanged. Session enumeration goes through a seam `operatorSessionFactsFn` (default `tmux.ListSessionFacts`); an enumeration error degrades to the `home` fallback (never a failed command — the window is still worth opening).

- **GIVEN** server `x` has only `_rk-*` sessions
- **WHEN** `rk operator -L x` runs
- **THEN** `new-window -c <home>` is issued, `operatorResolveAgentFn` receives root `""`, rung `home`
- **GIVEN** a qualifying root `/p` was derived
- **THEN** `operatorResolveAgentFn` receives `/p`

#### R4: `--dir <path>` explicit override
`rk operator` SHALL accept `--dir <path>` in both modes. The value MUST be an absolute path to an existing directory; otherwise a usage error (exit 2, `usageError`-wrapped, before any subprocess) with a message naming which check failed. When valid, it is used verbatim as the window directory (rung `explicit`) and its git root (`config.FindGitRoot(dir)`, falling back to `dir` itself) becomes the agent-resolution root. The derivation of R1 does not run when `--dir` is given.

- **GIVEN** `--dir relative/path`
- **THEN** exit 2 before `list-windows`
- **GIVEN** `--dir /nonexistent`
- **THEN** exit 2 before `list-windows`
- **GIVEN** `--dir /etc/hostname` (a file)
- **THEN** exit 2 before `list-windows`
- **GIVEN** `--dir /tmp/proj` exists and is a git checkout
- **WHEN** `rk operator -L s --dir /tmp/proj --json`
- **THEN** `new-window -c /tmp/proj`, agent root `/tmp/proj`, receipt `dir_rung: explicit`

#### R5: Receipt fields and help text
The `--json` created receipt SHALL carry `dir` (the chosen window directory) and `dir_rung` (the rung token) as additive fields; both MUST be omitted on a singleton hit (`created: false`) via `omitempty`. `rk operator --help` MUST describe the server-mode directory rule (derived project root → home fallback) under the `-L/--server` paragraph and document `--dir`; the flag description for `-L` MUST no longer say "the window opens in the home directory".

- **GIVEN** a created window in server mode with derived root `/p` by rung `most-attached`
- **THEN** stdout is exactly one JSON document whose result includes `"dir":"/p","dir_rung":"most-attached"`
- **GIVEN** a singleton hit in server mode with `--json`
- **THEN** the result has no `dir`/`dir_rung` keys

### Inject: readiness wait rides out a wall (`app/backend/internal/inject/ready.go`)

#### R6: `ReadyOpts.WaitThroughWalls`
`inject.ReadyOpts` SHALL gain `WaitThroughWalls bool` (default false = today's fail-fast). When true, a parked classification does not return: `AwaitReady` remembers the parked frame and keeps polling; it probes again only after the screen has changed from that frame and re-settled (so a static wall is not re-pasted every poll), and returns `ReadyByEcho`/`ReadyByState` when the pane becomes ready, `ErrGone` promptly when the pane dies, `NarrowError` as today, and at deadline expiry the LAST classification: the most recent `ParkedError` (with its snippet) when the pane is still on that parked frame, else `ErrNotReady`.

- **GIVEN** `WaitThroughWalls: true`, a frame that settles on a trust dialog, then changes to a prompt that echoes the sentinel
- **THEN** `AwaitReady` returns `ReadyByEcho`
- **GIVEN** `WaitThroughWalls: true`, a wall that never changes
- **THEN** at the deadline the error `errors.As` a `*ParkedError` whose `Snippet` is the wall text
- **GIVEN** `WaitThroughWalls: false` (default) and the same wall
- **THEN** `ParkedError` returns on the first parked probe (today's behavior; existing tests unchanged)
- **GIVEN** `WaitThroughWalls: true` and a capture error matching `IsGone` mid-wall
- **THEN** `ErrGone` returns promptly

#### R7: Server-mode delivery opts
`rk operator` in server mode SHALL deliver with `WaitThroughWalls: true` and `Deadline: operatorServerDeliverDeadline` (a package var, `60 * time.Second`); interactive mode keeps `WaitThroughWalls: false` and `operatorDeliverDeadline` (25 s). The opts SHALL be threaded through `deliverAgentKickoff` (new `opts inject.ReadyOpts` parameter carrying Deadline + WaitThroughWalls; `tutorial.go` passes `inject.ReadyOpts{Deadline: tutorialDeliverDeadline}`) into the delivery seam, whose type `kickoffDeliverFn` gains the `opts` argument, so tests assert the opts through the recorder. The context budget stays `opts.Deadline + cmdTimeout`.

- **GIVEN** server mode
- **WHEN** delivery runs
- **THEN** the recorded opts have `WaitThroughWalls == true` and `Deadline == 60s`
- **GIVEN** interactive mode
- **THEN** `WaitThroughWalls == false`, `Deadline == 25s`

### Visibility: the kickoff miss is surfaced

#### R8: Structured `kickoff:` stderr line (`operator.go`)
On an undelivered kickoff in `--json` mode, `rk operator` SHALL emit, in addition to the existing prose degrade note, one stderr line `kickoff: undelivered reason=<reason> prompt=<kickoff> dir=<windowDir>` where `<reason>` ∈ `parked | narrow | gone | timeout | send-error`, mapped by a pure `kickoffReason(err error) string`: `inject.ErrParked` → `parked`, `inject.ErrNarrow` → `narrow`, `inject.ErrGone` → `gone`, `inject.ErrNotReady` or `context.DeadlineExceeded` → `timeout`, anything else → `send-error`. stdout keeps the exactly-one-JSON-document contract. Without `--json` only the prose note prints.

- **GIVEN** `--json` and the delivery seam returns a `*inject.ParkedError`
- **THEN** stderr contains `kickoff: undelivered reason=parked prompt=/fab-operator dir=/home/u` and stdout is one JSON document

#### R9: Daemon-side WARN + notify (`app/backend/api/operator_start.go`)
`runOperatorStartExec`'s post-receipt `cmd.Wait()` goroutine SHALL parse the captured stderr for a `kickoff:` line (pure `parseKickoffNote(stderr string) (reason, dir string, ok bool)`) and, when present, log `slog.Warn("operator kickoff undelivered", "server", …, "window", …, "reason", …, "dir", …)` and invoke a caller-supplied completion callback so the handler can broadcast. The exec seam signature becomes `operatorStartRunFn func(ctx, argv []string, onExit operatorStartExitFn) (receipt, stderr, err)` with `type operatorStartExitFn func(receipt operatorStartReceipt, stderr string, exitErr error)`; `handleOperatorStart` passes `s.operatorKickoffExit(server)` which on a `kickoff:` line calls `s.initSSEHub()` then `s.sseHub.broadcastNotify(title, body, url)` with title `Operator kickoff not delivered`, body `Operator on <server> started in <dir> but /fab-operator was not delivered (<reason>) — paste it into the operator terminal`, and `url` the operator route for that server (`/` + server + `/operator` if that route exists in the frontend router; else empty). A clean exit with no `kickoff:` line logs nothing and broadcasts nothing. `operatorStartReceipt` gains `Dir`/`DirRung` (`omitempty`) so the parse tolerates the new fields.

- **GIVEN** the exec seam's stderr carries `kickoff: undelivered reason=parked prompt=/fab-operator dir=/home/u`
- **WHEN** the post-receipt callback fires
- **THEN** exactly one WARN entry is logged and one `notify` event is broadcast
- **GIVEN** stderr without a `kickoff:` line
- **THEN** no WARN, no broadcast

#### R10: Quake-terminal toast for the operator-kickoff notify
The `notify` payload SHALL gain an optional `tag` field (`json:"tag,omitempty"`; `broadcastNotify` gains a variant or option to set it — `broadcastNotifyTagged(title, body, url, tag)` — leaving the two existing producers byte-identical on the wire). The quake terminal SHALL subscribe via `useSessionContext().subscribeNotify` and, for `tag === "operator-kickoff"`, surface `body` through its existing `useOptionalToast` seam; other tags/untagged payloads are ignored there (the shell OS-notification path is untouched).

- **GIVEN** the quake terminal is mounted and a `notify` event `{tag:"operator-kickoff", body:"…"}` arrives
- **THEN** one toast with that body appears
- **GIVEN** an untagged `notify` event
- **THEN** the quake terminal shows no toast

#### R11: Cron respawn detail
`internal/cron`'s respawn success branch (`tick.go` ~line 394) SHALL log `respawned (kickoff undelivered: <reason>)` instead of bare `respawned` when the captured output tail contains a `kickoff: undelivered reason=<reason>` line; the outcome MUST still start with `respawned` so `orphan.go`'s `strings.HasPrefix(outcome, "respawned")` and `tick.go`'s outcome-class counting keep classifying it as a respawn. Implement as a pure `respawnSuccessOutcome(output []byte) string` beside `respawnDetail`.

- **GIVEN** the respawn exec exits 0 with output containing `kickoff: undelivered reason=parked …`
- **THEN** the log line's outcome is `respawned (kickoff undelivered: parked)`
- **GIVEN** exit 0 with no such line
- **THEN** the outcome is `respawned`

### Non-Goals

- No change to the interactive `rk operator` cwd rule, singleton probe, role stamp, or promote flow.
- No new `internal/settings` key; `--dir` is the only override.
- No auto-answering of the trust dialog or any wall.
- No change to the operator-tick cron entry, its respawn argv, or fab-kit's seed.
- No user-level skill install (fab-kit follow-up).
- The drawer's stuck `starting…` state (`260913-e20j`) is out of scope.

### Design Decisions

#### Derive the launch root from live sessions, not a setting
**Decision**: the daemon-invocable launch picks its cwd from the server's user-role sessions (main-worktree root + skill-tree presence), with `$HOME` only as the last resort.
**Why**: those directories are exactly the ones the user has already trusted and `fab sync`ed; rk already owns the facts (Constitution II/VII) and `rk tab new` #966 introduced the same helpers.
**Rejected**: a `settings` key for the operator project (a 17th key for something derivable); fixing it in the HTTP handler or cron tick (two launch sites would drift).
*Introduced by*: 260913-t7vy-operator-daemon-launch-root-kickoff

#### Skill presence is the qualification test
**Decision**: a root qualifies when `.agents/skills/fab-operator/SKILL.md` or `.claude/skills/fab-operator/SKILL.md` exists.
**Why**: the skill is what the booted agent needs; a fab project without a synced skill tree fails identically to `$HOME`.
**Rejected**: `fab/project/config.yaml` presence (does not guarantee a synced skill tree); a `fab` subprocess probe (a subprocess per candidate for a fact `os.Stat` answers).
*Introduced by*: 260913-t7vy-operator-daemon-launch-root-kickoff

#### Wait through walls only where nobody is watching
**Decision**: `WaitThroughWalls` is an opt-in on `ReadyOpts`; only `rk operator -L` sets it, with a 60 s server-mode deadline.
**Why**: `rk mux await --ready` and the cron session respawn are classifiers that must fail fast; the daemon launch has no human at the pane yet, so the wait should ride out a wall the user clears from the drawer. 60 s + 10 s stays under both 90 s caller bounds.
**Rejected**: re-probing every poll while walled (noisy paste/clear into a dialog); a separate `AwaitReadyThroughWalls` function (duplicated loop).
*Introduced by*: 260913-t7vy-operator-daemon-launch-root-kickoff

#### Kickoff miss surfaces through the existing `notify` broadcast, tagged
**Decision**: the daemon WARN-logs the `kickoff:` line and broadcasts the host-global `notify` event with a new optional `tag: "operator-kickoff"`; the quake terminal toasts tagged payloads.
**Why**: the hub's shell-notification shape is host-global (`kind:"global"`), not server-addressable — the body names the server. The web UI has no toast consumer for `notify` today (only the desktop shell's OS notification), so a tag lets the quake terminal render exactly this class without toasting every push.
**Rejected**: a new socket event kind (more surface for one message); `push.Notify` OS push alone (the user who clicked Start is looking at the drawer).
*Introduced by*: 260913-t7vy-operator-daemon-launch-root-kickoff

## Tasks

### Phase 1: Setup

- [x] T001 Add `WaitThroughWalls bool` to `inject.ReadyOpts` and implement the ride-out loop in `AwaitReady` (`app/backend/internal/inject/ready.go`): remember the parked frame, skip probing while the frame is unchanged, re-probe after change+settle, return the last `ParkedError` at expiry when still on that frame, else `ErrNotReady`; `IsGone`/`NarrowError`/state paths unchanged <!-- R6 -->
- [x] T002 [P] Add `dir`/`dir_rung` (`omitempty`) to `operatorReceipt` (`app/backend/cmd/rk/operator.go`) and `operatorStartReceipt` (`app/backend/api/operator_start.go`); declare the `dirRung*` constants and the `--dir` flag var <!-- R5 -->

### Phase 2: Core Implementation

- [x] T003 Implement the pure `operatorLaunchRoot` picker plus `hasOperatorSkill(root string) bool` (two `os.Stat`s) and the `operatorSessionFactsFn` / `operatorMainRootFn` seams in `app/backend/cmd/rk/operator.go` <!-- R1 -->
- [x] T004 Wire the server-mode branch of `runOperator`: `--dir` validation (absolute, exists, is a dir → `usageError` before `list-windows`); else derive via `operatorSessionFactsFn` → user-role filter → `operatorLaunchRoot`; `home` fallback on none/enumeration error; set `root` for `operatorResolveAgentFn` (derived root, `--dir`'s git root via `config.FindGitRoot` falling back to the dir, or `""` on home); emit `dir`/`dir_rung` in the created receipt <!-- R3 -->
- [x] T005 Thread `inject.ReadyOpts` through `deliverAgentKickoff` and `kickoffDeliverFn` (`app/backend/cmd/rk/agent_kickoff.go`), update `tutorialDeliverFn`/`tutorial.go` call site to pass `inject.ReadyOpts{Deadline: tutorialDeliverDeadline}`, and have `operatorDeliverFn` merge `State`/`BufferName` with the caller's opts; add `operatorServerDeliverDeadline = 60 * time.Second`; server mode passes `WaitThroughWalls: true` + 60 s, interactive passes 25 s fail-fast <!-- R7 -->
- [x] T006 Add pure `kickoffReason(err) string` and emit the `kickoff: undelivered reason=… prompt=… dir=…` stderr line in `--json` mode after the prose note (`app/backend/cmd/rk/operator.go`) <!-- R8 -->
- [x] T007 In `app/backend/api/operator_start.go`: add `operatorStartExitFn`, extend `operatorStartRunFn`/`runOperatorStartExec` to invoke it from the post-receipt `cmd.Wait()` goroutine with the receipt, stderr, and exit error; add pure `parseKickoffNote`; add `(s *Server) operatorKickoffExit(server string) operatorStartExitFn` that WARN-logs and broadcasts via the hub <!-- R9 -->
- [x] T008 Add `tag` (`omitempty`) to `notifyPayload` and a `broadcastNotifyTagged(title, body, url, tag string)` (with `broadcastNotify` delegating with `tag=""`) in `app/backend/api/sse.go`; `operatorKickoffExit` uses tag `operator-kickoff` <!-- R10 -->
- [x] T009 [P] In `app/backend/internal/cron/respawn.go` add pure `respawnSuccessOutcome(output []byte) string` and use it at the `respawned` success branch in `tick.go` <!-- R11 -->

### Phase 3: Integration & Edge Cases

- [x] T010 Frontend: in `app/frontend/src/components/quake-terminal.tsx` subscribe via `subscribeNotify` and toast `body` for payloads with `tag === "operator-kickoff"` (type-narrowed, no `as`), ignoring others; add a Vitest case in the quake terminal's existing test file (or a new `quake-terminal-kickoff.test.tsx`) proving tagged → toast, untagged → none <!-- R10 -->
- [x] T011 Tests `app/backend/cmd/rk/operator_test.go`: convert `TestOperatorServerFlagCreatesWithoutTMUX` into the `home` fallback (no qualifying session); add table tests for `operatorLaunchRoot` (sole, most-attached, most-windows, first, worktree collapsing to main root, non-repo dropped, no-skill dropped, two sessions one root); `--dir` valid + three usage errors before any subprocess; agent resolution receives the derived root / dir git root / `""`; receipt carries `dir`/`dir_rung` on create and omits on singleton; `kickoffReason` table; `kickoff:` stderr line per reason in `--json` and absent without; server-mode opts `WaitThroughWalls:true`/60s vs interactive false/25s via the recorder <!-- R1 -->
- [x] T012 [P] Tests `app/backend/internal/inject/ready_test.go`: `WaitThroughWalls` parked-then-echo → `ReadyByEcho`; walled through deadline → `*ParkedError` with the wall snippet; no re-probe while the parked frame is unchanged (count `PasteBuffer` calls); default false keeps first-parked return; `IsGone` mid-wall → `ErrGone` promptly <!-- R6 -->
- [x] T013 [P] Tests `app/backend/api/operator_start_test.go`: update the exec-seam stubs for the new signature; `parseKickoffNote` table; `operatorKickoffExit` with a `kickoff:` line → one WARN (capture via a `slog.Handler` on the test router's logger or a recording handler) and one `notify` frame with `tag:"operator-kickoff"` on a subscribed state client; without the line → neither; `TestRunOperatorStartExec` covers the callback firing after exit; receipt parse tolerates `dir`/`dir_rung`. Tests `app/backend/internal/cron/respawn_test.go`: `respawnSuccessOutcome` with and without the line; a tick-level assertion that the outcome still counts as `respawned` <!-- R9 -->
- [x] T014 Update `rk operator --help` `Long` + the `-L` flag description (drop "home directory", add the derived-root paragraph) and register `--dir` with its description; run the help-dump test and, if `shll` is on PATH, read `shll standards help-dump` and check the `operator` surface still conforms <!-- R5 -->

### Phase 4: Polish

- [x] T015 Run gates: `just test-backend`, `just test-frontend`; `cd app/frontend && npx tsc --noEmit`; fix anything red <!-- R1 -->

## Execution Order

- T001 blocks T005 (opts field must exist) and T012
- T002 blocks T004 and T007
- T003 blocks T004; T004/T005/T006 block T011
- T007 blocks T008's consumer wiring and T013
- T009 and T010 are independent of the operator.go chain

## Acceptance

### Functional Completeness

- [x] A-001 R1: In server mode the `new-window -c` argument is the derived main-worktree root of a qualifying user-role session; `_rk-*` sessions are never candidates
- [x] A-002 R2: The picker ranks sole → most-attached → most-windows → first over distinct roots, with the closed rung token set as constants
- [x] A-003 R3: With no qualifying root the window opens in `$HOME`, rung `home`, agent root `""`; with a derived root the agent resolver receives it
- [x] A-004 R4: `--dir` validates absolute/exists/is-dir as a usage error before any subprocess and drives both the window dir and the agent-resolution root
- [x] A-005 R5: The created `--json` receipt carries `dir` and `dir_rung`; the singleton receipt omits both; help text documents the rule and `--dir`
- [x] A-006 R6: `ReadyOpts.WaitThroughWalls` rides out a parked classification and returns the last classification at expiry; default false is byte-identical to today
- [x] A-007 R7: Server mode delivers with `WaitThroughWalls: true` and a 60 s deadline; interactive mode keeps fail-fast 25 s; tutorial is unaffected
- [x] A-008 R8: `--json` undelivered kickoff emits the `kickoff:` stderr line with the mapped reason; stdout stays one JSON document
- [x] A-009 R9: The daemon WARN-logs and broadcasts a tagged `notify` on a `kickoff:` line after the receipt; nothing on a clean delivery
- [x] A-010 R10: The quake terminal toasts `operator-kickoff`-tagged notify bodies and ignores other notify payloads
- [x] A-011 R11: A respawn whose output carries the `kickoff:` line logs `respawned (kickoff undelivered: <reason>)` and still counts as a respawn

### Behavioral Correctness

- [x] A-012 R3: `TestOperatorServerFlagCreatesWithoutTMUX` now asserts the `home` fallback only when no session qualifies (not unconditionally)
- [x] A-013 R7: The delivery context budget remains `Deadline + cmdTimeout`, so 60 s + 10 s stays under `operatorStartProcessTimeout` and `cron.DefaultRespawnTimeout` (both 90 s)

### Scenario Coverage

- [x] A-014 R1: A worktree session path in `<repo>.worktrees/<name>` collapses to the main checkout via the stubbed `operatorMainRootFn`
- [x] A-015 R6: No re-paste of the sentinel while the parked frame is unchanged (paste count asserted)
- [x] A-016 R9: `TestRunOperatorStartExec` proves the exit callback fires with the receipt and stderr after the process exits

### Edge Cases & Error Handling

- [x] A-017 R3: A session-enumeration error degrades to the `home` fallback rather than failing the command
- [x] A-018 R6: `IsGone` mid-wall returns `ErrGone` promptly under `WaitThroughWalls`
- [x] A-019 R8: `context.DeadlineExceeded` and `inject.ErrNotReady` both map to `timeout`; unknown errors map to `send-error`

### Code Quality

- [x] A-020 Pattern consistency: seams follow the `tabNewMainRootFn`/`operator*Fn` package-var pattern; rung tokens are named constants; no `as` casts in the frontend change
- [x] A-021 No unnecessary duplication: `gitinfo.MainWorktreeRoot`, `tmux.ListSessionFacts`, `config.FindGitRoot`, `broadcastNotify`'s marshal path and the existing toast seam are reused, not reimplemented
- [x] A-022 Security: no new subprocess; `os.Stat` for skill presence; `--dir` is validated before any tmux call and never enters a shell string
- [x] A-023 Tests: every new behavior (picker, `--dir`, receipt fields, `WaitThroughWalls`, `kickoff:` line, WARN + notify, toast, respawn outcome) has a unit test
- [x] A-024 Comments state constraints, not narration; no change IDs or PR numbers in code comments

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The home-directory branch it replaces survives as the explicit `home` fallback; `operatorDeliverDeadline` (25 s) remains the interactive and cron-session-respawn bound; both `broadcastNotify` producers keep their signature via delegation to `broadcastNotifyTagged`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | After a parked classification under `WaitThroughWalls`, re-probe only once the screen changes from the parked frame and re-settles (not every 600 ms poll) | Intake fixed "keeps polling" but not the re-probe cadence; repeated paste/clear into a static dialog is noise; the wall clearing changes the frame, which re-arms the probe | S:60 R:90 A:80 D:70 |
| 2 | Confident | The `notify` event is host-global, so the body names the server and a new optional `tag` field lets the quake terminal toast only the operator-kickoff class | Intake row 8 anticipated the host-global shape and allowed a "handful of lines" in quake-terminal.tsx; the web UI has no toast consumer for `notify` today (only the desktop shell's OS path) | S:60 R:85 A:75 D:65 |
| 3 | Confident | Extend the exec seam to `operatorStartRunFn(ctx, argv, onExit)` with a receipt-carrying callback instead of a package-level hook | The post-receipt goroutine lives inside `runOperatorStartExec` with no `*Server`; a callback carrying the receipt gives the handler the window id without a data race; stub updates are mechanical | S:55 R:90 A:85 D:70 |
| 4 | Confident | A session-enumeration error in server mode degrades to the `home` fallback | Intake says the window must still appear for the user to act on; a tmux read failure at this point is exactly the case where opening something and surfacing the miss beats exit 3 | S:55 R:90 A:80 D:70 |
| 5 | Certain | `kickoffReason` maps `ErrNotReady` and `context.DeadlineExceeded` to `timeout`; unknown errors to `send-error` | The five-token set is fixed by intake; the only two deadline-shaped errors are these | S:75 R:95 A:90 D:85 |
| 6 | Confident | Thread `inject.ReadyOpts` through `deliverAgentKickoff` (new parameter) rather than a parallel helper; tutorial passes its 25 s deadline | One helper, one path; the tutorial call site changes by one argument with identical behavior | S:60 R:95 A:85 D:80 |
| 7 | Confident | The notify `url` points at the server's operator route when the frontend router exposes one; otherwise empty | The desktop-shell OS notification deep-links via `url`; an empty url is the existing `handleNotify` precedent | S:50 R:95 A:70 D:65 |
| 8 | Confident | The frontend router exposes no `/<server>/operator` route, so the notify `url` deep-links to the operator window's terminal route `/<server>/<window-sans-@>` (e.g. `/runKit/7`) | Row 7's "otherwise empty" loses the deep link entirely; the operator window's own `/$server/$window` route exists and is the destination the user needs — the existing `broadcastNotify` deep-link shape (`/utils2/5`) is the precedent | S:60 R:90 A:75 D:60 |

8 assumptions (1 certain, 7 confident, 0 tentative).
