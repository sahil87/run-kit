# Plan: Compose-Send TMUX_PANE Env Scrub

**Change**: 260902-8jco-tmux-pane-env-scrub-send-failures
**Intake**: `intake.md`

## Requirements

### tmux runner: child environment scrub

#### R1: Subprocess env drops TMUX and TMUX_PANE on the inherit path
`newRunCmd` in `app/backend/internal/tmux/run.go` SHALL, when `RunOpts.Env` is nil (the inherit path), set the child environment to the current process environment with `TMUX` and `TMUX_PANE` removed. When `RunOpts.Env` is non-nil, it SHALL pass the caller's slice through verbatim (caller owns it). Every other environment variable SHALL pass through unchanged on the inherit path.

- **GIVEN** the parent process environment carries `TMUX=/tmp/tmux-1001/rk-daemon,5131,14` and `TMUX_PANE=%14`
- **WHEN** `Run`/`RunOutput` builds a tmux subprocess with `RunOpts{}`
- **THEN** the constructed `exec.Cmd.Env` contains neither `TMUX` nor `TMUX_PANE`, and other variables (e.g. `PATH`) are intact
- **AND** when `RunOpts.Env` is explicitly provided, the constructed `cmd.Env` equals it verbatim, including any `TMUX*` entries the caller chose to include

#### R2: No global TMUX_PANE unset
The fix SHALL NOT add a process-global `os.Unsetenv("TMUX_PANE")`. The existing `os.Unsetenv("TMUX")` in `internal/tmux`'s init (`tmux.go:259`) SHALL remain. rk CLI verbs (`rk role`, `rk tab`, `rk owntab`, the tmux guard shim path) keep reading `$TMUX_PANE` to identify their own pane.

- **GIVEN** an rk CLI verb that self-identifies via `$TMUX_PANE`
- **WHEN** the fix is in place
- **THEN** the verb still reads the variable from its own process env, while any tmux subprocess it spawns through `run.go` no longer inherits it

### inject engine: post-paste failure classification

#### R3: Staged-text sentinel for post-paste, pre-Enter failures
`app/backend/internal/inject/inject.go` SHALL add a `StagedSendFailure` error type wrapping an underlying cause (`Unwrap() error`), and `Engine.Send` SHALL return it for failures that occur AFTER `setAndPaste` succeeded but BEFORE Enter was sent: a probe `CapturePane` error, a ctx cancellation/deadline during the probe, and a `SendEnter` subprocess error (Enter refused ⇒ not delivered). The clean probe miss remains `ProbeFailure` (unchanged). Pre-paste failures (baseline capture, set-buffer, paste-buffer errors) SHALL keep today's plain wrapped-error returns.

- **GIVEN** a send whose paste landed and whose `send-keys Enter` subprocess fails (e.g. `client is read-only`)
- **WHEN** `Engine.Send` returns
- **THEN** the error is a `StagedSendFailure` wrapping the send-keys error (matchable via `errors.As`), never a bare wrapped error
- **AND GIVEN** a set-buffer or paste-buffer failure (nothing delivered), **THEN** the error is NOT a `StagedSendFailure`

#### R4: Post-Enter failures map to SubmitUnverified
Failures occurring AFTER Enter was sent — a `verifySubmit` capture error or ctx deadline, and errors inside `retrySubmit` after its own Enter — SHALL surface as `SubmitUnverified` (wrapping the cause) rather than `StagedSendFailure`: Enter has been sent, so "press Enter in pane" would be wrong advice; "may or may not have landed, check the pane" is the honest state. Within `retrySubmit`, failures after the re-paste but before the retry's Enter follow R3 (staged).

- **GIVEN** a send where Enter was delivered and the post-Enter observation's capture errors (or the shared deadline fires mid-observation)
- **WHEN** `Engine.Send` returns
- **THEN** the error satisfies `errors.As(&SubmitUnverified{})`, and the handler surfaces the existing submit-unconfirmed 409, not a 500 and not the staged-text 409

### send routes: HTTP mapping and logging

#### R5: Handlers map StagedSendFailure to a structured 409
`api/send.go` (`handleWindowSend`), `api/chat.go` (`handleChatSend`), and the operator-request routes in `api/operator.go` that map injection errors SHALL map `StagedSendFailure` to `409` with code `staged_send_failure` via `writeErrorCode`, message stating the text is staged in the pane and a resend would duplicate it. The existing `probe_failure` and `submit_unverified` mappings are unchanged.

- **GIVEN** the engine returns `StagedSendFailure` on a compose send
- **WHEN** the handler writes the response
- **THEN** the client receives `409 {"code":"staged_send_failure", ...}`, never a generic 500

#### R6: Send failures are logged
`handleWindowSend` and `handleChatSend` SHALL log every injection failure via slog before responding: `Warn` for 409-class recoverable outcomes (`probe_failure`, `submit_unverified`, `staged_send_failure`), `Error` for 500-class failures. Fields: `server`, `windowID`, `paneID`, `mode` (window-send only), and `err`.

- **GIVEN** a send that fails at any injection step
- **WHEN** the handler responds
- **THEN** a structured slog line with those fields exists (the daemon log is no longer blind to send failures); successes log nothing new

### frontend: honest toast routing

#### R7: staged_send_failure routes to the staged-text toast
`app/frontend/src/components/compose-strip.tsx` SHALL route `ApiError` code `staged_send_failure` to the SAME branch as `probe_failure` (the "Text is staged in the pane but unsent. Pressing Send again would duplicate it." toast with its "Press Enter in pane" recovery action, under the same in-flight `sending` lock). The generic "Send failed; nothing was delivered. Retrying is safe." toast remains only for failures where nothing was delivered (network errors, 4xx/5xx without a recognized code). The chat lens's send form error surface SHALL be checked and, if it shows an equivalent "nothing was delivered"-style generic message for these codes, given the same routing.

- **GIVEN** a compose send that returns `409 staged_send_failure`
- **WHEN** the toast renders
- **THEN** it is the staged-text toast with the "Press Enter in pane" action, and the draft is preserved
- **AND GIVEN** a pre-delivery failure (e.g. network error), **THEN** the generic "nothing was delivered; retrying is safe" toast still shows

### Non-Goals

- The three tmux spawn sites that bypass `run.go` (`internal/tmuxctl/client.go:422/535/635` control-mode client, `internal/tmux/tmux.go:2903` socket liveness probe, `api/terminals_ws.go:524` relay pty attach) — attach/probe paths, not the failing mutating-CLI path; tracked as the intake's open question
- Deployment/release work — ships through a normal release
- Changes to `inject.Sanitize`, the probe/observation algorithm, or the 4s `chatSendTotalBudget`

### Design Decisions

#### Scrub at the subprocess runner, not process-global
**Decision**: Remove `TMUX`/`TMUX_PANE` from the child env inside `newRunCmd`'s inherit path; no global `os.Unsetenv("TMUX_PANE")`.
**Why**: rk CLI verbs legitimately read `$TMUX_PANE` to self-identify; only spawned tmux children must lose it. The runner is the single shared seam, so the daemon's HTTP sends and the `rk mux send` CLI verb are both covered by one change.
**Rejected**: Global unset (breaks `rk role`/`rk tab`/`rk owntab` self-identification); per-call-site scrubbing (34+ call sites, one missed site reintroduces the bug).
*Introduced by*: 260902-8jco-tmux-pane-env-scrub-send-failures

#### Error taxonomy splits on the Enter boundary
**Decision**: Post-paste failures classify by whether Enter was sent: before Enter → new `StagedSendFailure` (`staged_send_failure` 409, staged-text toast with Enter recovery); after Enter → existing `SubmitUnverified` now wrapping the cause (`submit_unverified` 409). Pre-paste failures keep the generic path.
**Why**: The two states demand opposite resend advice — staged text wants a recovery Enter and warns a resend duplicates; a sent Enter may already have submitted, so a recovery Enter could double-submit. This mirrors the existing `ProbeFailure`/`SubmitUnverified` split (one sentinel per failure class).
**Rejected**: One catch-all staged code for everything post-paste (gives "press Enter in pane" advice after Enter already ran); reusing `probe_failure` for infrastructure errors (conflates a clean echo miss with a tmux fault, and the memory contract keeps them distinct 409s).
*Introduced by*: 260902-8jco-tmux-pane-env-scrub-send-failures

## Tasks

### Phase 2: Core Implementation

- [x] T001 [P] Scrub `TMUX`/`TMUX_PANE` from the child env in `newRunCmd`'s inherit path (`app/backend/internal/tmux/run.go`); explicit `RunOpts.Env` passes through verbatim <!-- R1, R2 -->
- [x] T002 [P] Regression test in `app/backend/internal/tmux/run_test.go` (or the package's existing test file): parent env with `TMUX`/`TMUX_PANE` set yields a cmd env without them (other vars intact); explicit `RunOpts.Env` is verbatim <!-- R1 -->
- [x] T003 Add `StagedSendFailure{Err}` sentinel with `Error()`/`Unwrap()` to `app/backend/internal/inject/inject.go`; classify post-paste pre-Enter failures (probe capture error, ctx error during probe, `SendEnter` error) as `StagedSendFailure`, and post-Enter failures (verify capture/ctx errors, retrySubmit's post-Enter errors) as `SubmitUnverified` wrapping the cause; `retrySubmit` re-paste-to-Enter window classifies staged <!-- R3, R4 -->
- [x] T004 Classification tests in `app/backend/internal/inject/inject_test.go`: send-keys error → StagedSendFailure; probe capture error → StagedSendFailure; verify capture error → SubmitUnverified; set-buffer/paste-buffer error → neither; existing ProbeFailure cases unchanged <!-- R3, R4 -->

### Phase 3: Integration & Edge Cases

- [x] T005 Map `StagedSendFailure` → `409 staged_send_failure` in `app/backend/api/send.go` and `app/backend/api/chat.go`; extend the operator-request error mapping in `app/backend/api/operator.go` the same way <!-- R5 -->
- [x] T006 Add slog failure logging (Warn for 409-class, Error for 500-class; fields server/windowID/paneID/mode/err) to `handleWindowSend` and `handleChatSend` <!-- R6 -->
- [x] T007 Handler tests in `app/backend/api/send_test.go` (and chat/operator tests as applicable): engine StagedSendFailure yields 409 + `staged_send_failure` code; existing 409 codes unchanged <!-- R5 -->
- [x] T008 Route `staged_send_failure` to the staged-text toast branch in `app/frontend/src/components/compose-strip.tsx` (shared branch with `probe_failure`, same "Press Enter in pane" action + sending lock); check the chat lens send form's error surface and align it if it shows a generic nothing-was-delivered message for recognized codes <!-- R7 -->
- [x] T009 Frontend unit test in `app/frontend/src/components/compose-strip.test.tsx`: `staged_send_failure` renders the staged-text toast with the recovery action; generic failures keep the generic toast <!-- R7 -->

### Phase 4: Polish

- [x] T010 Verification gates: `cd app/backend && go test ./internal/tmux/... ./internal/inject/... ./api/...`, then `go test ./...`; `cd app/frontend && npx tsc --noEmit`; targeted vitest for compose-strip <!-- R1 -->

## Execution Order

- T001/T002 are independent of T003–T009
- T003 blocks T004 and T005; T005 blocks T007; T005 blocks T008 (code string contract); T008 blocks T009
- T010 runs last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `newRunCmd` inherit path builds a child env without `TMUX`/`TMUX_PANE`; explicit `RunOpts.Env` is passed through verbatim
- [x] A-002 R2: no global `os.Unsetenv("TMUX_PANE")` was added; the existing `os.Unsetenv("TMUX")` remains
- [x] A-003 R3: `StagedSendFailure` exists with `Unwrap`, returned for post-paste pre-Enter failures (probe capture error, probe ctx error, SendEnter error)
- [x] A-004 R4: post-Enter capture/ctx failures surface as `SubmitUnverified` wrapping the cause
- [x] A-005 R5: `handleWindowSend`, `handleChatSend`, and the operator routes map `StagedSendFailure` to `409` code `staged_send_failure`
- [x] A-006 R6: send failures produce slog lines (Warn 409-class / Error 500-class) with server, windowID, paneID, mode (window-send), err
- [x] A-007 R7: compose-strip routes `staged_send_failure` to the staged-text toast with the "Press Enter in pane" action

### Behavioral Correctness

- [x] A-008 R1: with `TMUX_PANE` set in the daemon's process env, a tmux subprocess no longer inherits it (the cross-server read-only collision cannot recur through `run.go`)
- [x] A-009 R3: a `send-keys Enter` failure after a landed paste no longer returns a generic 500 or the "nothing was delivered; retrying is safe" toast
- [x] A-010 R7: pre-delivery failures (network, unrecognized codes) still show the generic toast; drafts are preserved on every failure

### Scenario Coverage

- [x] A-011 R1: regression test proves the env scrub against a parent env that sets both variables
- [x] A-012 R3: inject tests cover the classification matrix (staged vs unverified vs plain) including the retrySubmit windows
- [x] A-013 R7: frontend unit test covers the new toast branch and the untouched generic branch

### Edge Cases & Error Handling

- [x] A-014 R4: a ctx deadline firing mid-observation (after Enter) yields `submit_unverified`, never `staged_send_failure`
- [x] A-015 R3: whitespace-only/empty-needle early return (fail-closed `ProbeFailure` before any buffer mutation) is unchanged

### Code Quality

- [x] A-016 Pattern consistency: new sentinel follows the `ProbeFailure`/`SubmitUnverified` idiom (value type, Error() message with resend guidance); logging uses the codebase's slog style
- [x] A-017 No unnecessary duplication: the 409 mapping reuses `writeErrorCode`; the frontend reuses the existing staged-text toast branch rather than duplicating it
- [x] A-018 Type narrowing over assertions: frontend code checks `err instanceof ApiError && err.code === ...` (no `as` casts)
- [x] A-019 No new env vars, no polling, no database; all subprocess calls remain `exec.CommandContext` argv slices with caller-owned contexts

### Security

- [x] A-020 R1: the env scrub removes variables only — no shell strings, no new subprocess surface; sanitize and validation order in the handlers unchanged

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds a new failure class, env scrub, and logging without making existing code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Post-Enter failures map to `SubmitUnverified` (wrapping the cause), not `StagedSendFailure` — refines intake #4/#5 within its stated contract | "Press Enter in pane" after Enter already ran risks a double submit; the intake's contract is only that post-paste failures stop claiming nothing was delivered, which submit_unverified satisfies | S:75 R:80 A:85 D:75 |
| 2 | Confident | Operator-request routes in `api/operator.go` get the same `staged_send_failure` mapping | They share the injection engine and already map the two existing sentinels; leaving them at 500 for the new class would be an inconsistent taxonomy (intake affected-memory names operator-actuation) | S:65 R:85 A:80 D:70 |
| 3 | Certain | Env scrub = filter `os.Environ()` by `TMUX=`/`TMUX_PANE=` prefixes in `newRunCmd` when `opts.Env == nil` | Smallest change at the single shared seam; verified live that removing the vars fixes the refusal | S:90 R:85 A:90 D:90 |
| 4 | Confident | Chat-lens send form alignment is investigate-and-align (T008), not a guaranteed edit | Intake scoped it as "if it shares the generic catch"; the exact surface is confirmed at apply | S:60 R:85 A:80 D:65 |

4 assumptions (1 certain, 3 confident, 0 tentative).
