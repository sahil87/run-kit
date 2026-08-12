# Plan: Update Runs in a Daemon-Managed tmux Window

**Change**: 260812-z1ya-update-daemon-tmux-window
**Intake**: `intake.md`

## Requirements

### Backend: Managed Job Windows (`internal/daemon`)

#### R1: Job-run primitive
`internal/daemon` SHALL provide a job-run primitive (new file `internal/daemon/jobs.go`) that runs an argv in a managed window of a `rk-jobs` sibling session on the `rk-daemon` socket:

```go
// JobTarget identifies a spawned (or found in-flight) job window.
type JobTarget struct {
    Server   string // tmux socket name: "rk-daemon"
    Session  string // "rk-jobs"
    Window   string // job name, e.g. "update"
    WindowID string // tmux window id, e.g. "@5"
}

// RunJob runs argv in the managed window named window on the rk-jobs session.
// started=false with a nil error means a live job window already exists (in-flight);
// its target is returned so callers can surface it.
func RunJob(ctx context.Context, window string, argv []string) (target JobTarget, started bool, err error)
```

Semantics, in order:

1. **Daemon gate**: if the daemon is not running (`IsRunning()`-equivalent probe on the `rk-daemon` socket), return an error — never birth a tmux server as a side effect.
2. **Session ensure**: create the `rk-jobs` session (`new-session -d -s rk-jobs`) when absent. It is a SIBLING of `rk-daemon`/`rk-code-server`/`rk-remotes` on the same socket, so `daemon.Stop()`'s exact-match `=rk-daemon` kill never touches it.
3. **Window dedup** (exact-match `=rk-jobs:=<window>` targets):
   - window exists with a **live** pane → return its target with `started=false`, nil error (no second spawn),
   - window exists with a **dead** pane (remained after a prior failure) → `kill-window` it, then spawn fresh,
   - window absent → spawn fresh.
4. **Spawn**: `new-window -d -t =rk-jobs: -n <window> -P -F '#{window_id}' <argv…>` through the existing `runTmux`/`runTmuxOutput` seams (`exec.CommandContext` + argument slices + `cmdTimeout`).
5. **Post-spawn window options, best-effort** (a failure logs a warning and never fails the spawn):
   - `set-option -w -t <target> remain-on-exit failed` — pane persists only on non-zero exit (tmux ≥ 3.2),
   - `pipe-pane -o -t <target> 'cat >> ~/.rk/<window>.log'` — durable log continuity with today's `~/.rk/update.log` / `~/.rk/restart.log` (the pipe-pane shell string is composed from the rk-controlled home dir + validated window name only).

- **GIVEN** the rk-daemon tmux server is running and no `update` window exists
- **WHEN** `RunJob(ctx, "update", []string{"shll", "update", "wt"})` is called
- **THEN** an `update` window running the argv exists in the `rk-jobs` session with `remain-on-exit failed` set and output piped to `~/.rk/update.log`, and the returned target carries its `@N` window id with `started=true`

- **GIVEN** an `update` window with a live pane already exists
- **WHEN** `RunJob` is called again for `update`
- **THEN** no second window is spawned and the existing target is returned with `started=false`

- **GIVEN** an `update` window whose pane is dead (remained after a failed run)
- **WHEN** `RunJob` is called for `update`
- **THEN** the dead window is killed and a fresh one is spawned (`started=true`)

- **GIVEN** the rk-daemon tmux server is not running
- **WHEN** `RunJob` is called
- **THEN** it returns an error and no tmux server is created

#### R2: `rk daemon run` subcommand
A new `rk daemon run` subcommand (new file `cmd/rk/daemon_run.go`, registered on the `daemon` parent in `cmd/rk/daemon.go`) SHALL wrap `RunJob` as the standardized CLI surface:

```
rk daemon run --window <name> -- <cmd> [args…]
```

- `--window <name>` is required; the name is validated before becoming a tmux target (same character class as `validate.ValidateToolName` — reject empty, leading `-`, whitespace/control chars).
- A missing `--` command is a usage error.
- Daemon not running → error message naming the fix (`rk daemon is not running — start it with rk serve -d`), non-zero exit.
- Success prints one bounded line (Principle 9) carrying the target: `spawned rk-daemon:rk-jobs:update (@5)`; the already-running outcome prints `already running: rk-daemon:rk-jobs:update (@5)` and exits 0.
- The subcommand MUST pass the toolkit-standards checks that bind every new command surface (help-dump platform-stability, Principle 9 bounded output — constitution § Toolkit Standards, toolkit-standards memory § "A new command surface is checked against help-dump and Principle 9").

- **GIVEN** a running daemon
- **WHEN** `rk daemon run --window update -- shll update wt` is invoked
- **THEN** the job window spawns and one line naming the target is printed

- **GIVEN** no running daemon
- **WHEN** `rk daemon run --window x -- true` is invoked
- **THEN** a non-zero exit with an actionable error message, and no tmux server is born

### Backend: API Handlers (`app/backend/api`)

#### R3: `/api/update` spawns into the managed window
`handleUpdate` (app/backend/api/update.go) SHALL replace the detached `spawnSelfFn` spawn with `daemon.RunJob(ctx, "update", argv)` while preserving every existing gate and side effect:

- **New daemon gate first**: daemon not running → `409 {"error":"updates require the rk daemon — start it with rk serve -d"}`.
- Existing gates unchanged and in their current order within each path: shll-present scoped path (`ValidateToolName`-filtered argv, non-force empty-match 409, force full-roster), shll-absent self path (brew-409, qualify/force 409).
- argv passed to `RunJob`: `[shllPath, "update", tools…]`, `[shllPath, "update"]` (force), or `[selfPath, "update"]` (shll-absent).
- The `RecheckAfter(postRemediationRecheckDelay)` post-remediation re-check stays verbatim.
- Response shapes (Constitution IX unchanged — POST):
  - fresh spawn → `202 {"status":"updating","watch":{"server":"rk-daemon","session":"rk-jobs","window":"update","window_id":"@N"}}`
  - in-flight (`started=false`) → `200 {"status":"already-running","watch":{…}}`
  - `RunJob` error → `502 {"error":…}` (the spawn is no longer fire-and-forget; a failed spawn is reportable before any response commitment).
- The 202-before-spawn ordering inverts: `RunJob` runs BEFORE the response is written (the window survives the daemon restart, so there is no kill-the-server race; the handler can now report spawn failure honestly).

- **GIVEN** a brew daemon with a matched update and the daemon running
- **WHEN** `POST /api/update {}`
- **THEN** `202` with a `watch` target and an `update` job window running the scoped `shll update`

- **GIVEN** an update job already in flight
- **WHEN** `POST /api/update {}`
- **THEN** `200 {"status":"already-running"}` with the existing window's target and no second spawn

- **GIVEN** the daemon tmux server is not running (e.g. bare `rk serve` in a shell)
- **WHEN** `POST /api/update {}`
- **THEN** `409` naming the daemon requirement

#### R4: `/api/restart` migrates onto the same primitive
`handleRestart` (app/backend/api/restart.go) SHALL keep its dev-build 409, add the same daemon-running 409, and run `[selfPath, "daemon", "restart"]` in job window `restart` with the same response contract (`202 {"status":"restarting","watch":{…}}` fresh / `200 already-running` / `502` on spawn error).

- **GIVEN** a non-dev daemon running under tmux
- **WHEN** `POST /api/restart`
- **THEN** `202` with a `watch` target and a `restart` job window running `rk daemon restart`; the window survives the daemon session bounce because it lives in `rk-jobs`

#### R5: Detached-spawn machinery removal
`spawnSelfFn`, `openRkLog`, `updateLogRelPath`, and `restartLogRelPath` in update.go SHALL be deleted — both consumers migrated, no fallback fork (intake decision 1). Log continuity is owned by R1's `pipe-pane` tee to the same `~/.rk/update.log` / `~/.rk/restart.log` paths. Handler tests currently seamed through `spawnSelfFn` are rewritten against a `RunJob` seam (package var `runJobFn` in api, mirroring the existing seam style).

- **GIVEN** the migrated handlers
- **WHEN** grepping app/backend/api for `Setsid`, `spawnSelfFn`, `openRkLog`
- **THEN** no occurrences remain

### Frontend: Watch-Target Navigation

#### R6: Client helpers surface the watch target
`triggerUpdate()`, `triggerForceUpdate()`, and `triggerRestart()` (app/frontend/src/api/client.ts) SHALL parse the response body and resolve with a typed result instead of `void`:

```ts
export type UpdateWatchTarget = { server: string; session: string; window: string; window_id: string };
export type UpdateTriggerResult = { status: string; watch?: UpdateWatchTarget };
```

Tolerant parse: a missing/malformed `watch` key resolves with `watch: undefined` (old-daemon compat); non-2xx still rejects with the server message. A `200 already-running` is a RESOLVED result (status `"already-running"`), not a rejection.

- **GIVEN** a daemon returning the new response shape
- **WHEN** `triggerUpdate()` resolves
- **THEN** the result carries `status` and the `watch` target; against an old daemon body `{"status":"updating"}` it resolves with `watch` undefined

#### R7: Jump-to-window affordance
The shared `useUpdateClick()` hook (app/frontend/src/hooks/use-update-click.ts) and the restart action's `.catch` wrapper site SHALL consume the result minimally (intake decision: navigation, no new components/SSE):

- fresh spawn (`202`, `watch` present) → info toast with an action slot **"Watch"** that navigates to the terminal route `/$server/$window` (window param = the `@N` id, which the route's `parse`/`stringify` already handles — router.tsx:85);
- `already-running` (`watch` present) → navigate straight to the window (the second click IS navigation);
- `watch` absent (old daemon) → today's behavior unchanged (no toast action, no navigation);
- restart uses the same result type; its toast action is harmless (the post-restart reload discards it) and no special-casing is added.

The existing `updating…` busy state, failure toasts, and the two `updating`-clearing paths are unchanged.

- **GIVEN** an in-flight update and a chip click
- **WHEN** the POST resolves `already-running`
- **THEN** the app navigates to `/rk-daemon/{N}` for the update window

- **GIVEN** a fresh update trigger
- **WHEN** the 202 resolves with a watch target
- **THEN** an info toast offers "Watch" which navigates to the job window's terminal route

### Non-Goals

- No generic cross-server/pane exec surface — the subcommand is daemon-scoped by design (intake decision 2).
- No timer- or reaper-based cleanup of stale failed windows — next-run reap + manual kill only (intake decision 5).
- No SSE additions, new routes, or new frontend components — the terminal route already renders the window.
- CLI `rk update` / `rk daemon restart` invoked directly in a shell are unchanged.
- No change to update-verdict plumbing (checker, RecheckAfter, chip clearing paths — intake decision 6).

### Design Decisions

#### Jobs live in a sibling session, not the daemon session
**Decision**: All job windows go in a `rk-jobs` session on the `rk-daemon` socket, sibling to `rk-daemon`/`rk-code-server`/`rk-remotes`.
**Why**: `daemon.Stop()` kills the `=rk-daemon` session (C-c + kill-session fallback), and the update job itself triggers a daemon restart mid-run — a window inside the daemon session would kill itself. Sibling sessions survive (codeserver.go documents the mechanism; Constitution VI's spirit).
**Rejected**: a window inside `=rk-daemon:` (self-terminating, above); one session per job like `rk-code-server` (needless sidebar sprawl for short-lived jobs — `rk-remotes` already demonstrates the windows-in-one-session shape).
*Introduced by*: 260812-z1ya-update-daemon-tmux-window

#### Handlers call the primitive in-process; the CLI wraps the same function
**Decision**: `handleUpdate`/`handleRestart` call `daemon.RunJob` directly (behind an api-package seam for tests); `rk daemon run` is a thin cobra wrapper over the identical function.
**Why**: the handlers live in the same process — shelling out to `rk daemon run` would add a subprocess hop, argv re-quoting, and output re-parsing for zero benefit. The subcommand exists as the standardized external surface (scripts, other toolkit tools, debugging).
**Rejected**: handler execs the subcommand (hop + parse for nothing); subcommand only, no exported primitive (untestable handlers).
*Introduced by*: 260812-z1ya-update-daemon-tmux-window

#### Spawn-before-respond replaces respond-before-spawn
**Decision**: `RunJob` runs before the HTTP response is written; spawn failures return 502.
**Why**: the old accept-then-spawn ordering existed only because the detached child killed the serving process — the client had to get its 202 first. The job window survives the restart independently, so the handler can report spawn failure honestly instead of committing 202 and logging.
**Rejected**: keeping accept-first (perpetuates the fire-and-forget blind spot the change exists to remove).
*Introduced by*: 260812-z1ya-update-daemon-tmux-window

#### Already-running is a 200 result, not an error
**Decision**: a live in-flight window resolves `200 {"status":"already-running","watch":…}`; the frontend navigates to it.
**Why**: intake decision 4 — window existence is derived in-flight state (Constitution II); the double-click becomes navigation instead of a footgun or a confusing 409.
**Rejected**: 409 (treats a truthful answer as an error); silent re-spawn (today's behavior — the opacity being removed).
*Introduced by*: 260812-z1ya-update-daemon-tmux-window

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/internal/daemon/jobs.go`: `JobTarget` type, `JobsSessionName = "rk-jobs"` const, `RunJob` skeleton with the daemon gate + session-ensure + spawn path (no dedup yet), using existing `runTmux`/`runTmuxOutput` seams and package-var test seams mirroring codeserver.go's style <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Complete `RunJob` in `app/backend/internal/daemon/jobs.go`: exact-match window dedup (live → return `started=false`; dead pane → kill-window + respawn; absent → spawn), best-effort `remain-on-exit failed` + `pipe-pane` post-spawn options with warn-only failure handling <!-- R1 -->
- [x] T003 Add `app/backend/internal/daemon/jobs_test.go`: seam-driven unit tests for the daemon gate, session ensure, all three dedup branches, best-effort option failures, and argv construction (no live tmux) <!-- R1 -->
- [x] T004 [P] Create `app/backend/cmd/rk/daemon_run.go` (+ register in `cmd/rk/daemon.go`): `--window` flag with name validation, `--` argv separation, not-running error, bounded one-line spawned/already-running output; add `cmd/rk` tests for arg parsing + validation <!-- R2 -->
- [x] T005 Migrate `app/backend/api/update.go`: daemon-running 409 gate, replace `spawnSelfFn` with an api-package `runJobFn` seam over `daemon.RunJob`, spawn-before-respond with 202/200-already-running/502 response shapes carrying `watch`, keep all existing gates + `RecheckAfter`; delete `spawnSelfFn`/`openRkLog`/`updateLogRelPath`/`restartLogRelPath` <!-- R3, R5 -->
- [x] T006 Migrate `app/backend/api/restart.go` onto the same `runJobFn` seam: keep dev-409, add daemon-running 409, window `restart`, same response contract <!-- R4 -->
- [x] T007 Rewrite `app/backend/api/update_test.go` (and restart handler tests) against the `runJobFn` seam: cover the new 409, 202+watch, 200 already-running, 502 spawn-error, and all preserved gates; verify no `Setsid`/`spawnSelfFn`/`openRkLog` references remain in `app/backend/api/` <!-- R3, R4, R5 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Update `app/frontend/src/api/client.ts`: `UpdateWatchTarget`/`UpdateTriggerResult` types, tolerant body parse in `triggerUpdate`/`triggerForceUpdate`/`triggerRestart` (missing `watch` → undefined; non-2xx still rejects), update `client.test.ts` <!-- R6 -->
- [x] T009 Update `app/frontend/src/hooks/use-update-click.ts` + the restart action wrapper (use-global-palette-actions.ts site): already-running → navigate to `/$server/$window` (@N id via existing param stringify), fresh 202 → info toast with "Watch" action navigating; old-daemon (no watch) behavior unchanged; unit tests for both branches <!-- R7 -->
- [x] T010 Verify the new CLI surface against toolkit standards: `rk daemon run` appears in help-dump output platform-stably, output is Principle 9-bounded; adjust help text if the check flags it <!-- R2 -->

### Phase 4: Polish

- [x] T011 Run the verification gates in order (code-quality.md): `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, targeted frontend unit tests (`client`, `use-update-click`), then `just build` <!-- R1, R3, R6 -->

## Execution Order

- T001 → T002 → T003 (primitive before its tests); T004 depends on T001 only (wraps the exported function) and can run alongside T002/T003
- T005/T006 depend on T002; T007 depends on T005+T006
- T008 blocks T009; T010 depends on T004; T011 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `daemon.RunJob` exists with the specified signature and all five semantic steps (gate, session ensure, three-branch dedup, argv spawn, best-effort options)
- [x] A-002 R2: `rk daemon run --window <name> -- <cmd>` spawns a managed job window and prints the bounded target line; missing `--window`/command are usage errors
- [x] A-003 R3: `POST /api/update` spawns into the `update` job window and returns `202` with a populated `watch` target
- [x] A-004 R4: `POST /api/restart` spawns `rk daemon restart` into the `restart` job window with the same response contract
- [x] A-005 R6: the three client helpers resolve `UpdateTriggerResult` with a tolerant `watch` parse
- [x] A-006 R7: chip/palette update click navigates on already-running and offers a "Watch" toast action on fresh spawn

### Behavioral Correctness

- [x] A-007 R3: all pre-existing update gates behave byte-identically (scoped match 409, brew 409, qualify 409, force semantics, `RecheckAfter` scheduling)
- [x] A-008 R3: daemon-not-running now yields `409` (new gate) instead of a doomed detached spawn
- [x] A-009 R1: a second trigger while in-flight returns the existing window (`started=false`) — no duplicate window, no duplicate process

### Removal Verification

- [x] A-010 R5: `spawnSelfFn`, `openRkLog`, `updateLogRelPath`, `restartLogRelPath`, and the `Setsid` detachment are gone from `app/backend/api/` with no dead references

### Scenario Coverage

- [x] A-011 R1: unit tests cover all three dedup branches plus the daemon-gate error (seam-driven, no live tmux)
- [x] A-012 R3: handler tests cover 202+watch, 200 already-running, 502 spawn-error, and the new 409
- [x] A-013 R7: frontend unit tests cover the navigate and toast-action branches plus the old-daemon no-watch fallback

### Edge Cases & Error Handling

- [x] A-014 R1: a dead-pane window from a prior failure is killed and replaced on the next run; `remain-on-exit`/`pipe-pane` set failures warn without failing the spawn
- [x] A-015 R2: window names are validated before becoming tmux targets (leading `-`, whitespace, control chars, empty all rejected)

### Code Quality

- [x] A-016 Pattern consistency: jobs.go follows codeserver.go's seam style; daemon_run.go follows the one-file-per-subcommand convention; frontend changes follow the existing pure-helper + hook extraction patterns
- [x] A-017 No unnecessary duplication: tmux interaction rides existing `runTmux`/`runTmuxOutput`; validation reuses/extends `internal/validate`; no new toast or navigation primitives
- [x] A-018 All subprocess calls use `exec.CommandContext` with timeouts via existing seams — no shell strings constructed in Go
- [x] A-019 New behavior is test-covered (Go seam tests + frontend unit tests) per code-quality.md's tests-required rule

### Security

- [x] A-020 R1: nothing user-controlled reaches tmux targets or the pipe-pane shell string unvalidated; the `new-window` argv words are rk-controlled or `ValidateToolName`-validated (Constitution I)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `docs/memory/run-kit/architecture.md` § "Shared detached spawn-self seam (`spawnSelfFn`)" (~line 668) plus the `/api/update`, `/api/restart`, and `triggerRestart()` endpoint/client rows (~lines 207, 209, 329) — describe the deleted detached-`Setsid` spawn and the old `Promise<void>` client contract; superseded by the `daemon.RunJob` managed-window mechanism (hydrate-stage rewrite).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `RunJob(ctx, window, argv) (JobTarget, started bool, error)` signature with a boolean rather than a sentinel error for in-flight | Already-running is a success outcome (intake decision 4), not an error; boolean keeps the handler branch trivial | S:65 R:90 A:85 D:75 |
| 2 | Confident | Session name `rk-jobs`, window names `update`/`restart` | Follows rk-remotes/rk-code-server naming; trivially renameable pre-merge | S:70 R:95 A:85 D:80 |
| 3 | Confident | Fresh-spawn affordance is a toast "Watch" action; only already-running navigates immediately | Auto-navigating on every update click would be disruptive; toast action slot is the established pattern (check-toast precedent) | S:65 R:90 A:80 D:70 |
| 4 | Confident | Restart shares the identical result/affordance path with no special-casing | Post-restart reload discards the toast harmlessly; special-casing adds code for no behavior | S:60 R:90 A:85 D:75 |
| 5 | Confident | Spawn-before-respond with 502 on spawn failure replaces accept-then-spawn | The ordering existed only for the detached child's process-death race, which the window removes; honest errors beat committed 202s | S:70 R:85 A:90 D:80 |
| 6 | Certain | Dead-pane detection via tmux pane_dead over the exact-match target | The only tmux-native way to distinguish a remained-on-exit pane from a live one | S:80 R:90 A:95 D:90 |
| 7 | Confident | Window-state probe is ONE `display-message -p -t <target> '#{window_id} #{pane_dead}'` call (error ⇒ absent) | One round-trip carries both dedup fields; the exact-match target makes a lookup error unambiguous | S:65 R:85 A:85 D:75 |
| 8 | Confident | `RunJob` validates the window name (ValidateToolName class) and rejects empty argv itself, not only the CLI | The name also flows into the pipe-pane shell string — defense-in-depth at the primitive keeps API callers safe by construction | S:70 R:85 A:85 D:80 |
| 9 | Confident | Session-ensure tolerates a `duplicate session` create error as the ensured state | Two rapid clicks race has-session→new-session; the race outcome is the desired state | S:60 R:85 A:80 D:75 |
| 10 | Confident | Restart's daemon-gate 409 reads "restart requires the rk daemon — start it with `rk serve -d`" (update's message keeps the R3-verbatim "updates require…") | R4 says "the same daemon-running 409" — same gate and shape, but an update-worded message on the restart endpoint would mislead | S:65 R:80 A:80 D:75 |
| 11 | Confident | Fresh-spawn toast text is the neutral "<session>:<window> is running" shared by update and restart | One message keeps the shared helper special-case-free (assumption 4 above); the window name identifies the job | S:55 R:85 A:75 D:70 |
| 12 | Confident | The CLI's invalid-`--window` error wraps ValidateToolName's message verbatim ("invalid --window name: Tool name …") | Reuses the single shared validator (A-017); the slightly generic inner wording beats forking the rule | S:55 R:85 A:75 D:70 |

12 assumptions (1 certain, 11 confident, 0 tentative).
