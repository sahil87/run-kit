# Intake: Compose-Send TMUX_PANE Env Scrub

**Change**: 260902-8jco-tmux-pane-env-scrub-send-failures
**Created**: 2026-09-02

## Origin

Promptless dispatch from `/fab-proceed`, synthesized from a live investigation conversation in which every fact below was verified by deterministic repro on the affected host.

> Fix compose-strip send failures caused by TMUX_PANE env leakage into tmux subprocesses, plus honest post-paste error surfacing and send-failure logging. Change type: fix.

Interaction mode: one-shot dispatch carrying pre-made decisions (root-cause scrub location, no-global-unsetenv decision, staged-text 409 surfacing, send-failure logging). Key decisions were made during the investigation and are recorded in `## Assumptions` as Certain/Confident rows.

## Why

**User-visible problem**: On the web dashboard, Cmd+Enter in the compose strip intermittently fails on some tmux servers (observed: fails on `shll`, works on `runKit`). The text pastes into the agent pane but Enter never submits, and the UI shows *"Send failed; nothing was delivered. Retrying is safe."* Both claims are false — the text WAS delivered, and retrying stacks duplicate copies into the agent's composer (observed 3× stacked text). Blank-line Cmd+Enter (mode `enter`) fails outright on the affected server.

**Root cause (verified by deterministic repro)**: The rk daemon runs inside a tmux pane on the `rk-daemon` server, so every subprocess inherits `TMUX_PANE` (e.g. `%14`). `TMUX` itself is already unset process-wide by `internal/tmux`'s init (`os.Unsetenv("TMUX")` at `app/backend/internal/tmux/tmux.go:259`; see also `app/backend/cmd/rk/tmux_guard.go:557` comments), but `TMUX_PANE` was missed. tmux 3.7c attributes a CLI command to the pane named by `TMUX_PANE` resolved against the **target** server. Pane IDs are only unique per server, so the daemon's `%14` collides with the target server's own `%14`. On `shll`, that pane sits in a session whose only attached client was the dashboard's read-only `-CC` relay client → tmux refuses mutating commands with `client is read-only`.

- **Asymmetry producing the exact symptom**: `set-buffer`/`paste-buffer` are on tmux's read-only-permitted command list (paste lands), `send-keys` is not (Enter refused).
- **Server-specificity**: `runKit` has no pane `%14`, so it never collides.
- **Intermittency**: fires only while the read-only relay is the client attached to the colliding pane's session.

**Deterministic repro (verified)**: `env -u TMUX TMUX_PANE=%14 tmux -L shll send-keys -t %N x` → exit 1 `client is read-only`; drop `TMUX_PANE` → exit 0. Via the API: `POST /api/windows/{id}/send?server=shll` returned 500 `{"error":"send-keys: exit status 1: client is read-only"}` in ~9ms (mode=enter) and ~93ms (mode=submit, where set-buffer+paste+echo-probe succeeded first).

**Consequence of not fixing**: users on affected servers get intermittent send failures with an actively misleading error message that instructs them to retry — each retry duplicates staged text into the agent's composer. During diagnosis the daemon log was blind (send handlers log nothing on failure), making the issue expensive to trace.

**Why this approach**: scrubbing at the shared tmux runner fixes the root cause for every consumer (dashboard sends AND the `rk mux send` CLI verb when run from inside a tmux pane) without breaking the rk CLI verbs that legitimately read `$TMUX_PANE` for self-identification. The honest-error and logging parts turn any future post-paste failure from a duplicate-text trap into a recoverable, observable state.

## What Changes

Three parts, one change:

### 1. Root cause — scrub `TMUX`/`TMUX_PANE` from tmux subprocess env

In the shared runner `app/backend/internal/tmux/run.go`, `newRunCmd` currently inherits the full process environment when `RunOpts.Env` is nil:

```go
func newRunCmd(ctx context.Context, args []string, opts RunOpts) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "tmux", args...)
	if opts.Env != nil {
		cmd.Env = opts.Env
	}
	cmd.Dir = opts.Dir
	return cmd
}
```

Change: when `opts.Env` is nil (inherit), construct the child env as the current process environment **minus `TMUX` and `TMUX_PANE`**. When `opts.Env` is non-nil, pass it through untouched as today (caller owns it).

Decisions made during investigation:
- Do **NOT** add a global `os.Unsetenv("TMUX_PANE")` — rk CLI verbs (`rk role`, `rk tab`, `rk owntab`, and the tmux guard shim path) legitimately read `$TMUX_PANE` to identify their own pane; only spawned tmux children must lose it.
- The existing global `os.Unsetenv("TMUX")` at `tmux.go:259` stays (belt-and-braces; the runner scrub makes the child env robust regardless of process-global state).
- Keep the fix at the shared runner so both consumers of the inject engine (HTTP send routes and the `rk mux send` CLI verb) are covered.

**Regression test**: assert the constructed command env carries no `TMUX`/`TMUX_PANE` even when the parent env sets them (and that an explicit `RunOpts.Env` is passed through verbatim).

Out-of-scope context (noted for the plan, untouched here): three tmux spawn sites bypass run.go — `internal/tmuxctl/client.go:422/535/635` (control-mode client), `internal/tmux/tmux.go:2903` (socket liveness probe), `api/terminals_ws.go:524` (relay pty attach). These are attach/probe paths, not the mutating CLI path that failed; see Assumptions #8.

### 2. Honest post-paste error surfacing

Today any error occurring **after** the paste landed surfaces as a plain 500, and the frontend generic catch (`app/frontend/src/components/compose-strip.tsx`, generic toast at ~line 568) says *"Send failed; nothing was delivered. Retrying is safe."* — driving duplicate pastes.

Fix: in `app/backend/internal/inject/inject.go` `Engine.Send`, classify failures that occur **AFTER `setAndPaste` succeeded** (send-keys error, capture error, ctx deadline during probe/verify) as a staged-text recoverable state, so the HTTP layer (`app/backend/api/send.go` `handleWindowSend`, and the chat send route in `app/backend/api/chat.go`, which shares the engine) returns a structured **409** and the client shows the existing *"Text is staged in the pane but unsent. Pressing Send again would duplicate it."* toast with its "Press Enter in pane" recovery action (the `probe_failure` branch at compose-strip.tsx:540 today).

Design detail (graded in Assumptions #5, apply may refine): whether to reuse the existing `probe_failure` code, extend `ProbeFailure`, or add a new error code such as `staged_send_failure`. <!-- assumed: default pick is a new distinct sentinel + `staged_send_failure` code routed to the existing staged-text toast, matching the codebase's one-sentinel-per-failure-class pattern (ProbeFailure→probe_failure, SubmitUnverified→submit_unverified) --> The client contract requirement is only: **post-paste failures stop claiming "nothing was delivered / retrying is safe"**.

Pre-paste failures (including a mode=`enter` send-keys failure where nothing was pasted) keep the existing generic path — there "nothing was delivered; retrying is safe" is true.

**Tests**: frontend unit test for the new toast branch; Go tests for the post-paste classification (post-`setAndPaste` send-keys error, capture error, and ctx-deadline cases map to the staged-text error; pre-paste errors do not).

### 3. Send-failure observability

The send handlers log nothing on failure — the daemon log was blind during diagnosis. Add slog warn/error logging on send failure in `app/backend/api/send.go`'s `handleWindowSend` (and the chat-send route in `api/chat.go`, which shares the gap): fields include server, windowID/paneID, mode, and the error.

## Affected Memory

- `run-kit/chat`: (modify) send-engine failure taxonomy — post-paste staged-text classification joins the existing probe/submit-unverified 409s; env-scrub note on the delivery substrate
- `run-kit/api-and-sockets`: (modify) send-route error contract (new/extended 409 code) and failure logging on `/api/windows/{id}/send` + chat send route
- `run-kit/ui/compose-and-bottom-bar`: (modify) staged-text recovery now also covers post-paste failures; generic "retrying is safe" toast narrowed to genuinely-nothing-delivered failures
- `run-kit/architecture`: (modify) tmux runner core scrubs `TMUX`/`TMUX_PANE` from child env (inherit path only)
- `run-kit/operator-actuation`: (modify, minor) shared injection-engine delivery — the new failure class is visible to operator actuation's 409 taxonomy

## Impact

- **Backend**: `app/backend/internal/tmux/run.go` (+ test), `app/backend/internal/inject/inject.go` (+ tests), `app/backend/api/send.go`, `app/backend/api/chat.go` (409 mapping + slog)
- **Frontend**: `app/frontend/src/components/compose-strip.tsx` (route the new code to the staged-text toast branch; + unit test); chat send form path if it shares the generic catch
- **CLI**: `rk mux send` gains the same root-cause fix for free via the shared runner (no CLI surface change)
- **Constraints**: Constitution §I (exec.CommandContext, argv slices) unchanged by the env scrub; Test Integrity (tests conform to spec); code-quality.md requires tests for the changed behavior. Constitution §IX: the 409 is a response status on an existing POST route — no new verbs.
- **Deployment**: none in this change — the running production daemon is brew v3.18.20; the fix ships through a normal release.

## Open Questions

- Should the `TMUX`/`TMUX_PANE` scrub later extend to the three non-run.go tmux spawn sites (`internal/tmuxctl/client.go`, the `tmux.go:2903` probe, `api/terminals_ws.go:524` relay attach) as hardening? Out of scope here (Assumptions #8); non-blocking.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scrub `TMUX` and `TMUX_PANE` in `newRunCmd` only on the inherit path (`RunOpts.Env == nil`); explicit `Env` passes through verbatim | Dispatched decision from verified live investigation; deterministic repro proves the mechanism | S:90 R:85 A:90 D:90 |
| 2 | Certain | No global `os.Unsetenv("TMUX_PANE")`; the existing global `os.Unsetenv("TMUX")` stays | Discussed — rk CLI verbs (`rk role`/`rk tab`/`rk owntab`, guard shim) legitimately read `$TMUX_PANE` to self-identify; only tmux children must lose it | S:90 R:70 A:90 D:85 |
| 3 | Certain | Fix lives at the shared runner (`run.go`) so both the HTTP send routes and `rk mux send` CLI are covered | Discussed — inject engine is shared with the CLI verb; one seam covers both consumers | S:90 R:80 A:85 D:85 |
| 4 | Confident | `Engine.Send` classifies failures after `setAndPaste` succeeded (send-keys error, capture error, ctx deadline during probe/verify) as staged-text recoverable → structured 409 → existing staged-text toast with "Press Enter in pane" action | Dispatched decision; exact wiring is apply detail. Contract: post-paste failures stop claiming "nothing was delivered / retrying is safe" | S:80 R:75 A:80 D:70 |
| 5 | Confident | Error-code shape: add a new distinct sentinel + `staged_send_failure` code routed to the existing staged-text toast branch (rather than reusing `probe_failure` or widening `ProbeFailure`) | Deliberately left open by dispatcher with authority to pick; codebase pattern is one sentinel per failure class (`probe_failure`, `submit_unverified`) — apply may refine if wiring favors reuse | S:60 R:80 A:75 D:55 |
| 6 | Confident | Logging: slog Warn for 409-class recoverable outcomes, Error for 5xx-path failures, in `handleWindowSend` and the chat send route; fields: server, windowID/paneID, mode, error | Dispatched requirement (server/window/pane/mode/error named); level split is the conventional mapping | S:65 R:90 A:80 D:70 |
| 7 | Certain | Tests: run.go regression test (child env carries no `TMUX`/`TMUX_PANE` even when parent sets them), Go classification tests, frontend unit test for the new toast branch | Dispatched requirement; code-quality.md mandates tests for changed behavior | S:85 R:90 A:90 D:90 |
| 8 | Confident | Scope: scrub only run.go; the three bypass spawn sites (`tmuxctl/client.go:422/535/635`, `tmux.go:2903` probe, `terminals_ws.go:524` relay pty attach) stay untouched | Dispatch scoped the fix to the shared runner; bypass sites are attach/probe paths, not the failing mutating-CLI path; easy to extend later — recorded as a non-blocking open question | S:50 R:80 A:65 D:55 |
| 9 | Certain | No deployment work — fix ships through a normal release (production daemon is brew v3.18.20) | Explicitly stated in dispatch | S:90 R:90 A:90 D:95 |
| 10 | Confident | Pre-paste failures (incl. mode=`enter` send-keys failure with nothing pasted) keep the existing generic "nothing was delivered; retrying is safe" path | Only post-paste failures were classified as dishonest; pre-paste the claim is true. Root fix makes the observed `enter`-mode failure disappear entirely | S:70 R:80 A:80 D:75 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).
