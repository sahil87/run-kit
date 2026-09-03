# Plan: Post-Enter submit verification for pane injection

**Change**: 260830-nyvm-mux-send-submit-verification
**Intake**: `intake.md`

## Requirements

### Injection Engine: submit verification

#### R1: `Engine.Send` SHALL detect non-submission; it SHALL NOT claim submission
When `submit` is true, `inject.Engine.Send` SHALL run a bounded post-Enter observation phase whose
only positive finding is **non-submission**. It SHALL return `SubmitUnverified` when it observed
that nothing happened at all and bounded recovery failed to change that. In every other case —
including a frame that changed for any reason — it SHALL return `nil` after a successful
`SendEnter`, exactly as before this change. When `submit` is false the observation phase SHALL NOT
run and behavior SHALL be byte-identical to today.

The asymmetry is the whole design (R9 owns why): "the pane repainted" does not distinguish a submit
from a spinner, but "the pane did not change one byte for the full ladder" is only consistent with
an Enter that did nothing.

- **GIVEN** a pane whose `❯` line is stale printed output (the printed-prompt trap) and whose frame
  is unchanged across every backoff step
- **WHEN** `Send(ctx, t, server, pane, text, true)` runs and the echo probe passes
- **THEN** Enter is sent, non-submission is detected, bounded recovery runs, and — if recovery does
  not clear and re-deliver — the call returns `SubmitUnverified`
- **AND GIVEN** a frame that changed at any backoff step, **THEN** the call returns `nil` with no
  recovery, no `SendKeys`, and no claim about whether the submit landed
- **AND GIVEN** `submit=false`, **THEN** no `SendEnter`, no observation capture, and no `SendKeys`
  call is made, and the existing staged-paste return is unchanged

#### R9: There SHALL be no pre-Enter quiescence gate; the claim SHALL carry the soundness instead
A pre-Enter quiescence sample SHALL NOT be taken. Soundness comes from what the phase is allowed to
conclude, not from an attempt to prove the pane was still.

A sampled gate cannot work at a cost anyone would pay: a status line or spinner ticking every 100ms
sits unchanged through a 40ms sample and then repaints after a trapped Enter, and widening the
sample to cover the verification ladder would put ~1.2s of latency in front of every single send.
Making the *changed* branch claim nothing removes the need for the gate entirely — a churning pane
and a submitting pane both land in the no-claim branch, which returns `nil`, which is what both
should return.

This is what makes the change safe for the four daemon consumers, which deliberately have **no
agent-state gate** (`chat.md` § Pane-targeted injection sequence: "There SHALL be NO `agentState`
gate"; busy policy is Allow + probe) and so routinely inject into a mid-turn pane. Such a pane
reaches the no-claim branch and its request succeeds as before — it never produces a spurious 409,
and it never has a trapped Enter reported as confirmed, because nothing is ever reported as
confirmed.

The same rule applies to every Enter the engine sends, including recovery's: a retry Enter needs no
pre-Enter gate either, for the same reason.

- **GIVEN** a daemon pane mid-turn with a spinner repainting on its own
- **WHEN** `Send` runs with `submit` true and the Enter is trapped
- **THEN** the frame differs at some step, the phase makes no claim, no recovery runs, and `Send`
  returns `nil` — the pre-change behavior, never a false confirmation and never a spurious failure
- **AND GIVEN** any Enter sent by recovery, **THEN** no pre-Enter quiescence capture precedes it

#### R2: The no-claim test SHALL be provider-agnostic; the evidence predicate SHALL mirror the probe
The phase has two classifications and they carry different obligations.

**No-claim (frame changed)** — SHALL be a comparison of the whole normalized captured frame
(`stripForProbe`: ANSI escapes stripped, all whitespace removed) against the probe's winning
capture. It SHALL NOT parse a composer region, match a prompt glyph, consult `pasteCollapseRe`, or
introduce any other TUI-specific pattern. The only property it assumes of an agent TUI is that a
pane doing something repaints something — and because this branch concludes nothing, being wrong
about it costs only a missed recovery.

**Non-submission (frame unchanged across every step)** — the branch that acts. It additionally
requires the paste's echo to still be present, reusing the echo probe's own predicate
`CountOccurrences(capture, needle, collapsible)` against the same baseline floor, **including its
paste-collapse-chip term**. The evidence question is "is the echo the probe established still on
screen?", so it MUST be asked with the same predicate that established it: a raw-needle-only count
would fail to see a collapsed paste's chip on a chip-rendering TUI and would withhold recovery from
exactly the long and multi-line sends this change exists to protect. On a TUI that renders no chip
the term matches nothing, so the reuse narrows portability by nothing.

- **GIVEN** captures from differently shaped TUIs (bare-prompt composer, boxed composer,
  chip-collapsing composer, one whose only change is a status line)
- **WHEN** each is classified
- **THEN** every one whose post-Enter frame differs reaches the no-claim branch and `Send` returns
  `nil`
- **AND** the frame comparison references no prompt glyph, composer region, or `pasteCollapseRe`
- **AND GIVEN** a collapsible paste on a chip-rendering TUI whose frame never changes and whose
  chip is still in frame, **THEN** the evidence classification returns non-submission (recovery may
  run) rather than no-claim
- **AND GIVEN** the same unchanged frame on a TUI that renders no chip, **THEN** the chip term
  contributes zero and the raw-needle count decides

#### R3: The observation phase SHALL use escalating backoff and SHALL exit early on any change
The phase SHALL sleep-then-capture over an escalating ladder (`SubmitBackoff`, default
`40ms, 80ms, 160ms, 320ms, 640ms`) and SHALL return the no-claim verdict on the FIRST capture whose
normalized frame differs from the probe's winning capture, without sleeping any remaining step.
Only a frame that is unchanged through EVERY step reaches the non-submission branch. Recovery's own
observation SHALL use the first three steps of the ladder. All sleeps SHALL go through `sleepCtx`
so the caller's deadline truncates the tail, and a ctx expiry SHALL surface as the ctx error, never
as `SubmitUnverified`.

- **GIVEN** a fake whose frame differs on the first capture
- **WHEN** the phase runs
- **THEN** exactly one observation capture is issued, only the first backoff step is slept, and the
  verdict is no-claim
- **AND GIVEN** a fake whose frame is unchanged through all five steps, **THEN** the verdict is
  non-submission and the full ladder was walked
- **AND GIVEN** a ctx cancelled mid-phase, **THEN** the returned error is the ctx error, not
  `SubmitUnverified`

#### R4: Recovery SHALL confirm the clear by frame equality with the pre-paste baseline
Recovery SHALL run only on the non-submission verdict, at most `SubmitRetries` times (default 1).

The clear SHALL be confirmed by comparing the normalized post-clear frame with the **pre-paste
baseline frame** — the capture `Send` already takes before `SetBuffer` — and SHALL be treated as
cleared only on equality. Occurrence counting SHALL NOT be used to decide this.

Counting cannot decide it, for two independent reasons. It has no identity: a clear-induced reflow
can scroll a stale baseline occurrence out of the capture window while the live echo survives,
dropping the count to the baseline with the composer still populated. And it has no coverage: the
needle is only the paste's LAST non-empty line, so on a TUI that kills one line per `C-u` a
three-line paste's count reaches the baseline once the last line goes and stays there while the two
earlier lines remain staged. Frame equality has both properties for free — it compares the entire
captured region and asks the only question that matters, "is the pane back to how it looked before
I pasted?", which is true exactly when every staged line is gone.

The loop SHALL send `C-u` and re-capture up to `ClearAttempts` times (default 4), returning as soon
as the frames match. It SHALL fail closed: if the budget is exhausted without equality, the cycle
SHALL abort with `SubmitUnverified` and SHALL NOT call `SetBuffer` or `PasteBuffer` again. A false
negative here costs a missed recovery; a false positive would submit doubled text, so equality —
strict, whole-frame, and unattainable while anything remains staged — is the correct bar.

Note this predicate also protects the one case R1's asymmetry cannot: if a genuinely submitted
message were ever misread as non-submission (a TUI that repaints nothing for the full ladder), the
frame would carry the submitted message in its transcript and could never equal the pre-paste
baseline, so recovery aborts instead of re-sending.

- **GIVEN** a trapped pane whose frame never changed and whose echoed text is still on screen
- **WHEN** recovery presses `C-u` until the frame matches the pre-paste baseline
- **THEN** the text is re-pasted, re-probed, Enter re-sent, and re-observed
- **AND GIVEN** a three-line paste on a TUI that clears one line per `C-u`, **THEN** equality is
  reached only after every line is gone — the count reaching the baseline early does not end the
  loop
- **AND GIVEN** a frame that never returns to the pre-paste baseline within `ClearAttempts`,
  **THEN** `SetBuffer` and `PasteBuffer` are NOT called again and the call returns
  `SubmitUnverified`
- **AND GIVEN** a non-submission verdict whose echo is no longer on screen, **THEN** no `C-u` is
  sent, no re-paste occurs, and the call returns `SubmitUnverified`

#### R5: `SubmitUnverified` SHALL be a distinct sentinel from `ProbeFailure`
`inject` SHALL export a `SubmitUnverified` error type whose message names the ambiguous state and
steers the caller to capture the pane before resending. It SHALL NOT reuse or wrap `ProbeFailure`,
whose message asserts the text is staged and a resend would duplicate — advice that is wrong for
an Enter that was actually sent.

- **GIVEN** a call that exhausts the submit-verification budget
- **WHEN** the caller inspects the error with `errors.As`
- **THEN** it matches `inject.SubmitUnverified` and NOT `inject.ProbeFailure`
- **AND** the message states the submit could not be confirmed and that the message may or may not
  have landed

### Substrate: pane-scoped key send

#### R6: `inject.Tmux` and `TmuxOps` SHALL expose a pane-scoped, ctx-bound key send
`inject.Tmux` SHALL gain `SendKeys(ctx, paneID, server string, keys ...string) error`. The CLI
adapter SHALL implement it over the existing `tmux.SendKeysToPane`. `api/router.go`'s `TmuxOps`
SHALL gain `SendKeysToPane(ctx, paneID, server string, keys ...string) error` (implemented on
`prodTmuxOps` over the same primitive, and on the test `mockTmuxOps`), which `chatSendTmux` SHALL
adapt. The existing window-targeted, ctx-less `TmuxOps.SendKeys(windowID, keys, server)` SHALL be
left untouched.

- **GIVEN** the engine needs to send `C-u` to a pane
- **WHEN** it calls `t.SendKeys(ctx, paneID, server, "C-u")`
- **THEN** both adapters route it to `tmux.SendKeysToPane` with the caller's ctx and an argv slice
- **AND** `TmuxOps.SendKeys(windowID, keys, server)` retains its existing signature and callers

### CLI: `rk mux send` report contract

#### R7: `rk mux send` SHALL report `unverified` and exit 1 on a detected non-submission
On `SubmitUnverified` — the engine detected that nothing happened and recovery did not fix it —
the command SHALL print exactly one stdout report line `unverified %N`, put
the sentinel's explanatory text on stderr, and exit 1 (toolkit operational-failure convention).
A send that recovery re-delivered, and every send the phase made no claim about, SHALL report
plain `delivered %N` and exit 0; when recovery ran, that fact SHALL be carried on stderr as a
diagnostic honoring `--quiet`. An `unverified` outcome SHALL NOT enter the `--await` phase. `--key` sends and `--no-enter` staging
SHALL be unaffected.

- **GIVEN** a trapped pane whose frame never changed and which recovery could not re-deliver into
- **WHEN** `rk mux send %5 "keep going"` runs
- **THEN** stdout is exactly `unverified %5`, stderr carries the explanation, and the exit code
  is 1
- **AND GIVEN** the same send with `--await`, **THEN** the await observer is not started
- **AND GIVEN** a send re-delivered by recovery, **THEN** stdout is `delivered %5` and the exit is 0

### Daemon: HTTP error mapping

#### R10: The published `rk mux send` contract SHALL match the new outcome set
`rk mux send`'s documented output/exit-code contract is consumed by other agents through
`rk skill`, so a stale bundle is not cosmetic — it publishes exactly the false confirmation this
change removes. Every surface that states the contract SHALL be updated together: the `mux` parent
command's `Long` help (`app/backend/cmd/rk/mux.go`), the canonical skill pages
(`docs/site/skill/mux.md`, `docs/site/skill.md`), and their embedded copies under
`app/backend/cmd/rk/skill/`. `delivered` SHALL no longer be described as a probe-confirmed submit,
and `unverified` SHALL be documented as a report word with its exit-1 meaning. Per the
constitution's Toolkit Standards clause, the wording SHALL be checked against `shll standards`
before the edit.

- **GIVEN** an agent reading `rk skill mux` to learn the send contract
- **WHEN** it looks up what `delivered` guarantees
- **THEN** it finds the no-claim semantics, not "probe-confirmed submit"
- **AND** it finds `unverified %N` documented with exit 1 and the capture-before-resending guidance
- **AND** the canonical pages and their embedded copies are byte-consistent

#### R8: All four daemon injection consumers SHALL map `SubmitUnverified` to 409
`handleChatSend` (`api/chat.go`), both operator-actuation delivery paths (`api/operator.go`), and
the compose-strip paste (`api/paste.go`) SHALL each map `inject.SubmitUnverified` to
`409 Conflict` carrying the sentinel's message, alongside their existing `ProbeFailure → 409`
branch. The two 409 cases SHALL remain distinguishable by message text.

- **GIVEN** an injection through any of the four routes that ends in `SubmitUnverified`
- **WHEN** the handler maps the error
- **THEN** the response is `409` with the submit-unconfirmed message, not a `500`
- **AND** a `ProbeFailure` on the same route still returns its own distinct 409 message

### Non-Goals

- The `--key` send path — post-gate raw `send-keys` with no paste and no echo to verify.
- `submit=false` staging — no Enter is sent, so there is nothing to verify.
- Readiness classification (trust dialogs, login walls, cold starts). A pane behind a wall fails
  the existing echo probe before any Enter is sent; pre-delivery classification belongs to
  `fab dispatch open → ready → deliver`.
- The agent-state gate matrix in `rk mux send`, and the deliberate absence of an agent-state gate
  on the daemon chat path.
- `rk mux await`, and fab-kit's `fab pane deliver` (which already mechanizes this on its side).
- Raising `chatSendTotalBudget` or `muxCmdTimeout`.

### Design Decisions

#### The phase detects non-submission; it never claims submission

**Decision**: Make the observation phase asymmetric. A frame that changed yields NO conclusion and
`Send` returns `nil`; only a frame that is byte-identical through the entire ladder yields a
verdict, and that verdict is "nothing happened".
**Why**: "The pane repainted" is consistent with a submit, a spinner, streaming output, and a
ticking clock, so it can never prove a submit — and the daemon consumers deliberately have no
agent-state gate, so their target pane is routinely mid-turn. Inverting the claim makes the
soundness structural rather than probabilistic: a churning pane and a submitting pane both land in
the branch that concludes nothing and returns `nil`, which is what both should return anyway. The
useful half survives intact, because the reported failure — text sitting unsent at a prompt — is
precisely a pane doing nothing.
**Rejected**: (a) A pre-Enter quiescence sample: a 40ms sample cannot exclude a 100ms spinner tick,
and widening it to cover the ladder would put ~1.2s in front of every send; (b) claiming
confirmation and documenting the active-pane case as a caveat — it makes `Send`'s contract false on
four of the five consumers; (c) treating a churning pane as a failure (`SubmitUnverified`) — it
would turn every send to a busy pane into a 409 for the chat UI and an exit 1 for the CLI;
(d) testing "the needle left the composer" instead of comparing frames — unusable, because a
submitted message re-renders into the transcript and the occurrence count stays flat;
(e) reading `@rk_pane_agent_state` for an `active` flip — a genuinely independent signal, but it
works only on instrumented panes, lags hook delivery, and the daemon chat path deliberately has no
agent-state gate at all, so wiring state reads into the shared engine would contradict a standing
requirement.
*Introduced by*: 260830-nyvm-mux-send-submit-verification

#### The clear is confirmed by frame equality with the pre-paste baseline, not by counting

**Decision**: Recovery treats the composer as cleared only when the normalized post-clear frame
equals the pre-paste baseline capture `Send` already takes before `SetBuffer`.
**Why**: Counting fails twice over. It has no identity — a clear-induced reflow can scroll a stale
baseline occurrence out of frame while the live echo survives — and no coverage, because the needle
is only the paste's last non-empty line, so a multi-line paste's count bottoms out while earlier
lines are still staged. Frame equality asks the question that actually matters ("is the pane back
to how it looked before I pasted?"), which is true exactly when every staged line is gone, and it
needs no per-TUI knowledge. It also fails closed in the one direction that matters: a genuinely
submitted message leaves its text in the transcript, so the frame can never match the baseline and
recovery aborts rather than re-sending.
**Rejected**: (a) A threshold on the occurrence count — unsound on both axes above; (b) draining
until the count stops falling — fixes identity but not coverage, and still re-pastes over a
partially cleared multi-line composer; (c) refusing recovery whenever the baseline count is
non-zero — sound but disables recovery for a repeated nudge whose earlier copy is still in the
transcript, which is the reported incident's own shape.
*Introduced by*: 260830-nyvm-mux-send-submit-verification

#### The evidence arm reuses the probe's predicate; only the no-claim arm is chip-free

**Decision**: Split the provider-agnosticism obligation across verification's two classifications.
The *no-claim* test is pure whole-frame comparison with no TUI-specific pattern. The
*non-submission* evidence test, reached only after the frame proved unchanged through every step,
reuses the echo
probe's `CountOccurrences(capture, needle, collapsible)` including its paste-collapse-chip term.
**Why**: The evidence question is "is the echo the probe established still on screen?", and it is
only meaningful when asked with the predicate that established it. A chip-rendering TUI shows a
`[Pasted text #N]` chip instead of the raw text for a collapsed paste, so a raw-needle-only
evidence count would report the echo gone, classify `inconclusive`, and withhold recovery from
precisely the long and multi-line sends this change exists to protect. On a TUI that renders no
chip the term matches nothing, so it costs no portability.
**Rejected**: Forbidding `pasteCollapseRe` from both arms — symmetrical-sounding and what the
requirement first said, but it would silently disable recovery for collapsed pastes on the one
TUI whose behavior is actually documented, while improving nothing anywhere else.
*Introduced by*: 260830-nyvm-mux-send-submit-verification

#### Escalating backoff with early exit rather than the probe's flat cadence

**Decision**: Verification walks `40/80/160/320/640ms`, returning on the first differing frame;
the retry pass uses only the first three steps.
**Why**: The two pressures pull opposite ways — a responsive TUI must not pay a fixed tax, and a
slow or cold-started one must not be misdiagnosed as trapped. Early exit puts the common success
path at ~40ms (cheaper than the probe's flat 80ms first settle), while the tail is spent only on a
pane that is provably not advancing. Truncating the retry pass keeps the pathological worst case
(~3.0s) inside the existing 4s `chatSendTotalBudget`; the untruncated version lands near 3.7s,
which leaves no margin under the 5s route-blocking rule.
**Rejected**: Reusing `ProbeSettle`/`ProbeGap` (flat 80ms × 3) — simultaneously too slow for a
30ms repaint and too impatient for a 500ms one, and it gives the trap case only 240ms of evidence
before acting.
*Introduced by*: 260830-nyvm-mux-send-submit-verification

#### Recovery is evidence-gated rather than unconditional

**Decision**: Recovery fires only on the non-submission verdict — the frame unchanged through every
backoff step with the paste's echo still present. Any other outcome returns `SubmitUnverified`
without touching the pane.
**Why**: `C-u` can un-type but cannot un-submit, so a wrong "nothing happened" verdict followed by
a retype posts the message twice. Requiring positive evidence makes the duplicate path unreachable
by construction rather than merely improbable. (How the clear itself is proven is a separate
decision — see "The clear is confirmed by frame equality with the pre-paste baseline".)
**Rejected**: The backlog's sketch of an unconditional 1–2 retries on any unverified submit —
maximally self-healing, but it converts a rare false negative into a duplicated message, which is
worse than the silent failure it replaces.
*Introduced by*: 260830-nyvm-mux-send-submit-verification

#### The fix lands in the shared engine, not in `rk mux send`

**Decision**: Implement in `internal/inject`'s `Engine.Send` so all five consumers inherit it —
the CLI verb plus the four daemon routes.
**Why**: The package's stated purpose is that "BOTH the daemon route and the CLI verb drive ONE
implementation". The daemon routes carry the identical latent bug and were never going to grow
their own copy of the recovery.
**Rejected**: Layering it in `cmd/rk/mux_send.go` — zero daemon blast radius, but it forks the
delivery choreography and leaves `chat/send`, both operator routes, and the compose-strip paste
silently losing messages in the trap.
*Introduced by*: 260830-nyvm-mux-send-submit-verification

## Tasks

### Phase 1: Substrate seam

- [x] T001 [P] Add `SendKeys(ctx context.Context, paneID, server string, keys ...string) error` to the `inject.Tmux` interface in `app/backend/internal/inject/inject.go`; implement it on `cliInjectTmux` in `app/backend/cmd/rk/mux_send.go` over `tmux.SendKeysToPane`. <!-- R6 -->
- [x] T002 [P] Add `SendKeysToPane(ctx context.Context, paneID, server string, keys ...string) error` to the `TmuxOps` interface in `app/backend/api/router.go`, implement it on `prodTmuxOps` over `tmux.SendKeysToPane` and on the test `mockTmuxOps`, and adapt it in `chatSendTmux.SendKeys` (`app/backend/api/chat.go`). Leave the existing window-targeted `SendKeys(windowID, keys, server)` untouched. <!-- R6 -->

### Phase 2: Core engine

> Task text below describes the shape as first built. Cycle 3 replaced the count-based clear with
> baseline-frame equality and inverted the verdict set (see R1/R4/R9 and `### Design Decisions`);
> `ClearAttempts` is now 4. Read the requirements, not these entries, for current behavior.

- [x] T003 Add the `SubmitUnverified` sentinel type and its `Error()` message to `app/backend/internal/inject/inject.go`, next to `ProbeFailure`; add the tunables `SubmitBackoff` (`[]time.Duration{40,80,160,320,640}ms`, package var), `SubmitRetries` (1), `SubmitRetryBackoffSteps` (3), and `ClearAttempts` (3), each with a comment stating the constraint it encodes. <!-- R3 R5 -->
- [x] T004 Change `probeEcho` in `app/backend/internal/inject/inject.go` to return the winning capture alongside its error, so the pre-Enter frame is available to the verification phase without an extra capture; update its call site. <!-- R1 R2 -->
- [x] T005 Implement `verifySubmit(ctx, t, server, paneID, preFrame, needle string, collapsible bool, baseCount int, steps []time.Duration) (verdict, error)` in `app/backend/internal/inject/inject.go`: walk the backoff steps via `sleepCtx`, capture, and return `submitted` on the first `stripForProbe`-normalized frame that differs from `preFrame`; on exhaustion return `notSubmitted` when the echo is still present (`CountOccurrences > baseCount`) and `inconclusive` otherwise. A `CapturePane` error propagates verbatim. <!-- R1 R2 R3 -->
- [x] T006 Implement `clearComposer(ctx, t, server, paneID, needle string, collapsible bool, baseCount int) (string, error)` in `app/backend/internal/inject/inject.go`: up to `ClearAttempts` iterations of `SendKeys(ctx, paneID, server, "C-u")` then `CapturePane`, returning the post-clear capture as soon as the echo is gone; report exhaustion so the caller aborts without re-pasting. <!-- R4 -->
- [x] T007 Wire the verification phase and the evidence-gated retry loop into `Engine.Send` in `app/backend/internal/inject/inject.go`: run only when `submit` is true; on `notSubmitted` run up to `SubmitRetries` cycles of clear → re-`setAndPaste` → `probeEcho` → `SendEnter` → `verifySubmit` (truncated ladder); return `SubmitUnverified{}` on `inconclusive`, on clear-loop exhaustion, and on retry exhaustion. Hold the existing per-pane lock across the whole extended sequence. <!-- R1 R4 R5 -->

### Phase 3: Consumers

- [x] T008 In `app/backend/cmd/rk/mux_send.go`, branch on `inject.SubmitUnverified` after the engine call: set the report word to `unverified`, print the sentinel text to stderr via the sink, skip the `--await` composition, and return an error that yields exit 1. Emit a stderr diagnostic when a retry ran and succeeded, keeping the report word `delivered`. <!-- R7 -->
- [x] T009 [P] Map `inject.SubmitUnverified` to `409` with the sentinel message in `app/backend/api/chat.go` (`handleChatSend`), both delivery paths in `app/backend/api/operator.go`, and `app/backend/api/paste.go`, alongside each existing `ProbeFailure` branch. <!-- R8 -->
- [x] T010 [P] Update the `rk mux send` command `Long` help text in `app/backend/cmd/rk/mux_send.go` to describe verified submission and the `unverified` report word; check the wording against `shll standards` for the CLI-surface standards before finalizing. <!-- R7 -->

### Phase 4: Tests

- [x] T011 Add engine tests to `app/backend/internal/inject/inject_test.go`: submit confirmed on first capture (assert exactly one verification capture — the early-exit contract), confirmed only on the fourth capture, trap → retry → confirmed, retry exhausted → `SubmitUnverified`, inconclusive → `SubmitUnverified` with no second `PasteBuffer` call, clear loop succeeding on the second `C-u`, clear loop exhausted → `SubmitUnverified` with no second `PasteBuffer` call, `submit=false` → no `SendEnter`/`SendKeys`/verification capture, ctx cancelled mid-verify → ctx error. Shrink `SubmitBackoff` in tests as the existing tests shrink `ProbeSettle`/`ProbeGap`. <!-- R1 R3 R4 R5 -->
- [x] T012 [P] Add a table-driven provider-shape test to `app/backend/internal/inject/inject_test.go` covering synthetic pre/post frames from differently shaped composers (bare prompt, boxed, chip-collapsing, status-line-only change): every differing frame classifies as submitted, and none of the cases relies on `pasteCollapseRe`. <!-- R2 -->
- [x] T013 [P] Add CLI tests to `app/backend/cmd/rk/mux_send_test.go`: `unverified %N` on stdout with exit 1, no await observer started on that path, `delivered %N` after a successful retry, `--key` and `--no-enter` paths unchanged. <!-- R7 -->
- [x] T014 [P] Add handler tests asserting `409` + the submit-unconfirmed message for `SubmitUnverified` on the chat-send, operator, and paste routes, and that `ProbeFailure` still returns its own 409 message. <!-- R8 -->
- [x] T015 Run the verification gates from `fab/project/code-quality.md`: `just test-backend`, then `cd app/frontend && npx tsc --noEmit` (unchanged surface, expected clean), and confirm no `exec.Command` without context was introduced. <!-- R1 R6 R7 R8 -->

### Phase 5: Rework — R2 split (cycle 1)

- [x] T016 In `app/backend/internal/inject/inject.go`, add a comment at `verifySubmit`'s evidence branch (the `CountOccurrences` call reached after the frame comparison has failed on every step) stating the invariant the code cannot show: the evidence question must be asked with the same predicate that established the echo, the chip term is what lets a collapsed paste on a chip-rendering TUI stay recovery-eligible, and it matches nothing on a TUI that renders no chip — so it costs no portability. Keep the frame comparison itself free of any TUI-specific pattern. <!-- R2 -->
- [x] T017 [P] Add an evidence-classification test to `app/backend/internal/inject/inject_test.go`: a collapsible paste whose paste-collapse chip is still present in an unchanged post-Enter frame classifies as not-submitted (recovery runs), and a chip-free unchanged frame is decided by the raw-needle count alone. <!-- R2 -->

### Phase 6: Rework — quiescence gate and drain clear (cycle 2, SUPERSEDED)

> Both mechanisms these tasks added were later shown unsound and were removed by Phase 7 — the
> pre-Enter quiescence gate (T018) and the count-based drain clear (T019), with T020's tests
> rewritten alongside them. The entries are kept as the work record; read R1/R4/R9 and the
> `### Design Decisions` for what the code actually does.


- [x] T018 In `app/backend/internal/inject/inject.go`, add the pre-Enter quiescence gate to `Engine.Send`: after `probeEcho` succeeds and only when `submit` is true, sleep `SubmitBackoff[0]` via `sleepCtx` and re-capture; if the new capture's `stripForProbe` form differs from the probe capture's, send Enter and return `nil` without any verification or recovery. Otherwise use the NEW capture as `preFrame` and continue into `verifySubmit`. A capture error propagates verbatim. <!-- R9 -->
- [x] T019 Rework `clearComposer` in `app/backend/internal/inject/inject.go` from a threshold test to a drain test: iterate up to `ClearAttempts`, tracking the previous count; the composer counts as cleared only when the count is `<= baseCount` AND the latest `C-u` produced no further decrease. Exhausting the budget while the count is still falling, or ending above `baseCount`, returns `errComposerNotCleared` so `retrySubmit` aborts without a second `SetBuffer`/`PasteBuffer`. Raise the `ClearAttempts` default from 3 to 4: the drain rule spends one press purely on confirming no further decrease, so the stale-occurrence case needs three presses plus the confirming one and would otherwise sit exactly at the old budget with no margin. <!-- R4 -->
- [x] T020 [P] Add tests to `app/backend/internal/inject/inject_test.go`: a non-quiescent pane (probe capture != pre-Enter capture) sends Enter, returns nil, and takes NO verification capture and NO `SendKeys`; a quiescent pane proceeds and compares against the later capture; and the drain case — baseline 1, counts 2 -> 1 (stale occurrence scrolled out) -> 0 -> 0 — must issue the extra `C-u` and only then re-paste, while a still-falling count at budget exhaustion aborts with `SubmitUnverified` and no second `PasteBuffer`. <!-- R4 R9 -->
- [x] T021 [P] Remove the narrating comment at `app/backend/api/chat_send_test.go:223` (it explains the assertion on the next line). If the capture count there is non-obvious, state the invariant that makes it four rather than narrating the assertion. <!-- R9 -->

### Phase 7: Rework — asymmetric claim and baseline-equality clear (cycle 3)

- [x] T022 In `app/backend/internal/inject/inject.go`, REMOVE the pre-Enter quiescence gate added in the previous cycle: delete the `SubmitBackoff[0]` sleep, the extra `CapturePane`, the `quiescent` boolean, and the `if !quiescent { return nil }` branch. `Send` returns to probe → `SendEnter` → observation, with the probe's winning capture as the frame the observation compares against. <!-- R9 -->
- [x] T023 In `app/backend/internal/inject/inject.go`, invert `verifySubmit`'s conclusions so a changed frame concludes nothing: rename the verdict set to make the branches self-describing (a no-claim verdict in place of `submitConfirmed`), and have `Send` and `retrySubmit` return `nil` on it. Only an unchanged-through-every-step frame with the echo still present may reach the non-submission branch that triggers recovery; keep the existing inconclusive-with-echo-gone case returning `SubmitUnverified` without recovery. Update the doc comments on `Send`, `verifySubmit`, and `SubmitUnverified` so none of them claims a submit was confirmed. <!-- R1 R9 -->
- [x] T024 Rework `clearComposer` in `app/backend/internal/inject/inject.go` to take the pre-paste baseline capture and confirm the clear by `stripForProbe` equality with it, dropping the count/drain logic entirely; thread the baseline from `Send` through `retrySubmit`. Keep `ClearAttempts` at 4 and keep exhaustion returning `errComposerNotCleared` so `retrySubmit` aborts without a second `SetBuffer`/`PasteBuffer`. <!-- R4 -->
- [x] T025 Update the affected tests in `app/backend/internal/inject/inject_test.go`, `app/backend/cmd/rk/mux_send_test.go`, and `app/backend/api/chat_send_test.go` for the removed quiescence capture and the inverted verdict, and add: a changed frame at step 1 returns nil with exactly one observation capture and no `SendKeys`; a frame unchanged through all five steps triggers recovery; a three-line paste on a fake that clears one line per `C-u` reaches equality only after the third press and re-pastes only then; a fake whose frame never returns to baseline aborts with `SubmitUnverified` and no second `PasteBuffer`; a fake whose post-Enter frame contains the submitted message in its transcript can never clear, so recovery aborts rather than re-sending. <!-- R1 R3 R4 R9 -->
- [x] T026 [P] Update `## Assumptions` row 7 in `fab/changes/260830-nyvm-mux-send-submit-verification/plan.md`: it still names `ClearAttempts = 3` and asserts under-provisioning can never duplicate, both of which the current design supersedes. Restate it against the baseline-equality predicate and the current default of 4. <!-- R4 -->

### Phase 8: Rework — retry-ladder capture assertion (cycle 4)

- [x] T027 In `app/backend/internal/inject/inject_test.go`, extend `TestSendRetryExhaustionIsUnverified` (or add a sibling) so it asserts the NUMBER of observation captures recovery's pass issues, proving the truncated three-step ladder is what runs rather than the full five. Today the test asserts only the `SubmitUnverified` outcome, so a regression that dropped the truncation would pass unnoticed. Shrink `SubmitBackoff` in the test as the neighbouring tests already do, and count captures on the fake the same way the early-exit test does. <!-- R3 -->

### Phase 9: Rework — published contract sync (cycle 5)

- [x] T028 Update the `mux` parent command's `Long` help in `app/backend/cmd/rk/mux.go` (the `send` clause currently reads "with probe-verified delivery") so it no longer implies a confirmed submit; describe delivery as paste-probed with post-Enter non-submission detection. <!-- R10 -->
- [x] T029 Update the canonical skill pages `docs/site/skill/mux.md` (the **Delivery** and **stdout is one report line** paragraphs) and `docs/site/skill.md` (the `rk mux send` bullet and the "prints exactly one report line" contract bullet): drop "probe-confirmed submit", state that a changed frame yields no claim, document `unverified %N` as a fourth report word meaning the engine detected the Enter submitted nothing and bounded recovery did not fix it (exit 1, capture the pane before resending — a resend may duplicate), and note that recovery re-delivery still reports `delivered`. Check the wording against `shll standards` first, then sync the embedded copies at `app/backend/cmd/rk/skill/mux.md` and `app/backend/cmd/rk/skill/skill.md` so canonical and embedded are byte-consistent. <!-- R10 -->

## Execution Order

- T001/T002 are independent of each other but both block T007 (the engine calls `SendKeys`).
- T004 blocks T005 (the pre-Enter frame comes from `probeEcho`'s return).
- T005 and T006 block T007.
- T007 blocks T008 and T009.
- T011–T014 follow their respective implementation tasks; T015 runs last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `Engine.Send` runs a post-Enter observation phase when `submit` is true, returns `SubmitUnverified` only on a detected non-submission that recovery did not fix, and returns `nil` in every other case including a changed frame.
- [x] A-002 R2: The no-claim classification is whole-frame `stripForProbe` comparison referencing no prompt glyph, composer region, or `pasteCollapseRe`; the non-submission evidence classification reuses `CountOccurrences(capture, needle, collapsible)`, and a comment at that call site states why the chip term belongs there and costs no portability.
- [x] A-003 R3: `SubmitBackoff` exists as an escalating package-var ladder, the phase returns no-claim on the first differing capture without sleeping remaining steps, and only an unchanged-through-every-step frame reaches the non-submission branch; recovery uses the truncated ladder.
- [x] A-004 R4: Recovery is gated on frame-unchanged-through-every-step AND echo-still-present, and re-pastes only after a capture equals the pre-paste baseline.
- [x] A-005 R5: `inject.SubmitUnverified` exists as a distinct sentinel with its own message and does not wrap `ProbeFailure`.
- [x] A-006 R6: `inject.Tmux` and `TmuxOps` each expose a pane-scoped ctx-bound key send, implemented on both adapters plus the test mock.
- [x] A-007 R7: `rk mux send` reports `unverified %N` with exit 1 on a detected non-submission recovery could not fix, and `delivered %N` otherwise — including after a successful recovery and when the phase made no claim.
- [x] A-008 R8: All four daemon injection consumers map `SubmitUnverified` to `409` with the sentinel message.

### Behavioral Correctness

- [x] A-009 R1: `submit=false` behavior is byte-identical to before — no `SendEnter`, no `SendKeys`, no observation capture.
- [x] A-010 R3: A ctx cancelled during the observation phase surfaces the ctx error, never `SubmitUnverified`.
- [x] A-011 R7: An `unverified` outcome does not start the `--await` observer; `--key` and `--no-enter` paths are unchanged.
- [x] A-012 R6: The pre-existing window-targeted `TmuxOps.SendKeys(windowID, keys, server)` signature and its callers are untouched.

### Scenario Coverage

- [x] A-013 R2: A table-driven test exercises differently shaped composer frames; every differing-frame case reaches the no-claim branch and returns `nil`, so the status-line case asserts no submission and blesses nothing.
- [x] A-013b R2: A test proves a collapsible paste whose chip is still in an unchanged frame classifies as not-submitted (recovery eligible), and that a chip-free TUI's unchanged frame is decided by the raw-needle count alone.
- [x] A-014 R3: Tests prove both the early exit (exactly one observation capture when the first frame differs) and the patient tail (a frame unchanged through all five steps reaching the non-submission branch), AND that recovery's own observation is capped at the truncated three-step ladder by asserting its capture count.
- [x] A-015 R4: A test proves the full trap → `C-u` → baseline-equality clear → re-paste → re-probe → Enter → re-delivered recovery path.

### Edge Cases & Error Handling

- [x] A-026 R9: No pre-Enter quiescence capture exists on any path — neither in `Send` nor in `retrySubmit` — and a pane whose frame changes at any step returns `nil` with no `SendKeys` and no recovery.
- [x] A-027 R1: No doc comment, verdict name, or report string asserts that a submit was confirmed; the phase's positive finding is non-submission only.
- [x] A-028 R4: The clear is confirmed by `stripForProbe` equality with the pre-paste baseline capture and uses no occurrence counting; a three-line paste on a one-line-per-`C-u` fake re-pastes only after every line is gone.
- [x] A-029 R4: A frame that never returns to the pre-paste baseline within `ClearAttempts` aborts with `SubmitUnverified` and no second `PasteBuffer` call — including the case where the transcript now holds the submitted message.

- [x] A-016 R4: On clear-loop exhaustion and on the inconclusive verdict, no second `PasteBuffer` call is made — the no-duplicate invariant is asserted, not assumed.
- [x] A-017 R4: `SubmitRetries` bounds the retry cycles; exhaustion returns `SubmitUnverified`.
- [x] A-018 R1: A `CapturePane` subprocess error during the observation phase propagates verbatim and is distinguishable from a clean non-submission verdict.

- [x] A-030 R10: The `mux` parent help no longer describes send as probe-verified in a way that implies a confirmed submit.
- [x] A-031 R10: `docs/site/skill/mux.md` and `docs/site/skill.md` document the `unverified` report word with exit 1 and no longer call `delivered` a probe-confirmed submit.
- [x] A-032 R10: The embedded skill copies under `app/backend/cmd/rk/skill/` are byte-consistent with their canonical `docs/site/` sources.

### Code Quality

- [x] A-019 Pattern consistency: New engine code follows the file's existing shape — package vars for test-shrinkable timings, `sleepCtx` for every sleep, sentinel error types for recoverable states, and comments that state constraints rather than narrate lines.
- [x] A-020 No unnecessary duplication: The verification reuses `stripForProbe`, `CountOccurrences`, `Needle`, `setAndPaste`, and `probeEcho` rather than reimplementing capture normalization or paste mechanics.
- [x] A-021 Subprocess safety: All new tmux interaction goes through `internal/tmux` primitives with the caller's context and argv slices — no shell strings, no `exec.Command` without a context (Constitution I, code-quality Go principle).
- [x] A-022 Named constants: The backoff ladder, retry budget, and clear-attempt bound are named package vars/consts, not magic numbers at their use sites.
- [x] A-023 Test coverage: The bug fix ships with tests covering the changed behavior at both the engine and consumer layers (code-quality "New features and bug fixes MUST include tests").
- [x] A-024 No comment narration: New comments state invariants and cross-file contracts (the no-duplicate guarantee, the budget constraint) and cite no change IDs or PR numbers.

### Security

- [x] A-025 R4: The `C-u` key send passes the key name as a discrete argv element through `tmux.SendKeysToPane`; no user-controlled text reaches a key-name position.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the current diff adds submit verification and bounded recovery without making an existing symbol, file, branch, or configuration redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The observation phase runs inside the existing per-`(server,paneID)` lock, extending the serialized window rather than adding a second lock | The lock's documented purpose is that "a second send to the SAME pane only begins after the first finished"; releasing it before the retry would reopen exactly the doubled-submission window it closes | S:85 R:85 A:90 D:85 |
| 2 | Certain | `probeEcho` returns its winning capture so the pre-Enter frame costs no extra `CapturePane` | The capture already exists in hand; re-capturing would both waste a subprocess and risk the frame having advanced between probe and snapshot, which would poison the comparison | S:85 R:90 A:90 D:85 |
| 3 | Confident | A re-probe failure inside a retry cycle returns `ProbeFailure`, not `SubmitUnverified` | After a verified clear the state matches `ProbeFailure`'s exact meaning — text pasted (or not) with Enter withheld — so its "check before retrying" advice is the correct advice | S:70 R:80 A:80 D:70 |
| 4 | Confident | The `inconclusive` verdict (frame unchanged, echo no longer present) is a defensive branch, near-unreachable in practice | Under exact normalized-frame equality the occurrence count is equal too, so the branch fires only on a capture anomaly such as a scroll or resize. It is kept because reading such an anomaly as evidence to retype is precisely the mistake the evidence gate exists to prevent — but it should not be described as a common path | S:60 R:85 A:70 D:60 |
| 5 | Confident | The retry's stderr diagnostic is emitted through the existing `outputSink` `Notef` seam so `--quiet` governs it | Matches the file's stated convention that "chatter honors `--quiet`; the report line is data" | S:75 R:90 A:85 D:80 |
| 6 | Tentative | `SubmitBackoff`'s five steps and the three-step retry truncation are correct as first values | Derived from the 4s route budget, not measured against real TUIs. Package vars so apply or a later change can retune from observation without restructuring <!-- assumed: backoff ladder values reasoned from the budget, not measured --> | S:45 R:90 A:45 D:50 |
| 7 | Tentative | `ClearAttempts = 4` covers the realistic worst-case composer under the baseline-equality predicate | A many-line staged paste in a composer that kills one line per `C-u` can exceed it. Exhaustion is fail-closed — the frames never match, so recovery aborts without re-pasting — so under-provisioning costs a missed recovery, not a duplicate; the earlier count-based predicate could not make that claim honestly <!-- assumed: 4 C-u presses suffice for realistic multi-line composer states --> | S:50 R:90 A:50 D:55 |

7 assumptions (2 certain, 3 confident, 2 tentative).
