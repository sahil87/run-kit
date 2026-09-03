# Intake: Post-Enter submit verification for pane injection

**Change**: 260830-nyvm-mux-send-submit-verification
**Created**: 2026-08-30

## Origin

Backlog entry `[nyvm]` (`fab/backlog.md`, 2026-08-30), raised from a live incident and brought
in via `/fab-new` with two design forks answered interactively by the user before drafting.

> Fix rk mux send delivery for the printed-prompt trap (backlog nyvm, fab/backlog.md). Bug: when
> an agent self-issues a continuation nudge (e.g. "keep going") into its own prompt during a long
> fab-fff native-dispatch observer loop, the text is typed into the input box but Enter sometimes
> does not submit it -- it sits printed at the prompt line, unsent, until something external
> notices and re-sends. Observed 20+ times in one run (apply+review+hydrate+ship stages) on
> run-kit changes srec/nip5, 2026-08-30, always recoverable manually via: send C-u (clear the
> line), retype the text, send Enter. Root fix candidate per the backlog entry: bake this
> probe+retry (or an equivalent submission-verification) into rk mux send itself [...] rather
> than relying on every caller to notice and hand-recover. Investigate: after sending text +
> Enter, capture the pane and confirm the input line cleared / the message was actually submitted
> (not just that the keys were transmitted to tmux); if it did not submit, retry with C-u +
> retype + Enter, bounded (e.g. 1-2 retries) before surfacing a delivery failure to the caller.

Raw backlog line:

> `[nyvm]` 2026-08-30: rk mux send delivery doesn't reliably detect/recover the printed-prompt
> trap for a self-issued 'keep going' nudge -- Enter doesn't land after text is typed into the
> prompt, staying printed at the input line unsent; recurred 20+ times in one long-running
> fab-fff native-dispatch observer phase (apply+review+hydrate+ship) on the same pane, real
> underlying progress between occurrences. Recovered each time via C-u + retype + Enter (manual
> workaround, not automated). Seen on run-kit srec/nip5 changes 2026-08-30, session marker_rework
> panes %82/%85.

**Interaction mode**: conversational. Codebase was read before questions were asked; two forks
were put to the user and both were answered with the recommended option:

1. **Scope — "Shared inject engine"** (over a CLI-only fix). The verification lands in
   `app/backend/internal/inject`'s `Engine.Send`, so all five injection consumers inherit it:
   `rk mux send`, `POST /api/windows/{id}/chat/send`, the two operator-actuation routes, and
   the compose-strip `POST /api/windows/{id}/paste`. Rationale accepted: the package exists so
   "BOTH the daemon route and the CLI verb drive ONE implementation", and the daemon routes
   carry the identical latent bug.
2. **Retry gate — "Evidence-gated retry"** (over an unconditional bounded retry). A retry fires
   ONLY on positive evidence that nothing was submitted. An inconclusive verification reports an
   unverified delivery and retries nothing, so a false negative can never double-post.

A third constraint arrived from the user mid-drafting and reshaped the timing design:

> While you are building this note that this would be used against a variety of different UIs,
> OpenSpec, Claude, Gemini, Kimi and so on. Each with different start-up timings with different
> trust walls. This command needs to be both resilient and fast.

This promoted provider-agnosticism from a hoped-for property to a hard requirement (§ 2, row 15),
replaced the flat probe cadence with escalating backoff and early exit (§ 2b, row 16), and drew
an explicit boundary around trust walls and cold starts as the readiness gate's territory
(§ 2b, row 18).

## Why

**The problem.** `internal/inject` verifies the *paste*, not the *submit*. Its sequence today is
`baseline capture → set-buffer → paste-buffer (-d -p) → NOVELTY echo probe → Enter`. The novelty
echo probe proves the text newly appeared in the pane's live input buffer — that is a **pre-Enter**
check. Once the probe passes, `t.SendEnter(...)` is called and the engine returns `nil`; whether
that Enter actually submitted anything is never observed. `rk mux send` then prints `delivered %N`
and exits 0 on the strength of a tmux subprocess having succeeded.

The printed-prompt trap (documented as the operator's manual workaround in `_cli-agents.md` §
Delivery Probe) is exactly the case where that inference is wrong: the pane's `❯` line can be
stale *printed output* rather than a live composer, so the paste echoes into a frame that looks
right and the Enter lands on nothing. The text sits at the prompt, unsent, and every layer above
reports success.

**The consequence of not fixing it.** The failure is silent and the recovery is entirely manual.
In the 2026-08-30 `fab-fff` run it recurred 20+ times across apply/review/hydrate/ship on panes
`%82`/`%85` — each occurrence stalling the observer loop until a human noticed a pane that had
gone quiet and hand-ran `C-u` + retype + Enter. The cost compounds because the standing contract
tells callers to trust the report: `agent-messaging.md` R7 defines `delivered %N` as
"probe-confirmed submit", which is currently a claim the engine cannot substantiate. Pushing the
recovery onto every caller means every present and future consumer must independently rediscover
the trap and re-implement the workaround — the daemon chat-send, the two operator routes and the
compose-strip paste have not done so, so today they simply lose the message.

**Why this approach.** The manual recipe already exists and is proven (`_cli-agents.md` § Delivery
Probe steps 3–4: `C-u` clear → retype → Enter → confirm the screen advanced), and fab-kit's
`fab pane deliver --text` already mechanizes it with one retry. What is missing is the same
mechanization on the run-kit side of the seam, in the one place all five consumers share. Putting
it in the engine rather than in `cmd/rk/mux_send.go` preserves the package's founding property
(one implementation) and fixes four daemon consumers that were never going to grow their own copy.

**Why evidence-gated rather than unconditional retry.** The retry is `C-u` + retype + Enter. If
the verdict "not submitted" is wrong — the agent *did* submit but rendered nothing the probe could
see inside the settle window — then `C-u` clears a composer that is already empty and the retype
posts the message a **second** time. `C-u` can un-type, but it cannot un-submit. Gating the retry
on positive evidence of non-submission (the frame did not change AND the needle is still on
screen) makes the duplicate-submission case unreachable: the retry only runs in the state where
nothing landed.

## What Changes

### 1. `inject.Engine.Send` gains a post-Enter verification phase

The sequence becomes:

```
baseline capture
  → set-buffer → paste-buffer (-d -p)
  → NOVELTY echo probe                     (existing, unchanged — pre-Enter)
  → PRE-ENTER FRAME snapshot               (new — reuse the probe's winning capture)
  → send-keys Enter
  → SUBMIT VERIFY                          (new — bounded settle + re-capture)
  → [evidence-gated retry cycle]           (new — at most SubmitRetries times)
```

`submit=false` (insert-without-submit) is **unchanged**: no Enter is sent, so no verification
phase runs and the existing "verified paste staged in the composer" return is byte-identical.
`--key` sends in `rk mux send` are also unchanged — they are post-gate raw `send-keys` with no
paste and no probe, and key names have no echo to verify.

### 2. The verification predicate

**Design constraint (stated by the user during intake): this runs against a variety of agent TUIs
— Claude Code, Codex, Gemini, Kimi, OpenCode — with different startup timings and different
first-run trust walls, and it must be both resilient and fast.** Two properties follow, and they
are requirements, not preferences:

- **Provider-agnostic by construction.** The predicate must not parse a composer region, match a
  prompt glyph, or recognize a paste-collapse chip — all of which are per-TUI. (Note the existing
  `pasteCollapseRe` is already Claude-Code-specific; the verification phase must not add a second
  such dependency.) Frame comparison over the `stripForProbe`-normalized capture is the choice
  precisely because it assumes nothing about the TUI beyond "a submit repaints something".
- **Fast in the success case, patient only in the failure case.** See § 2b — the phase early-exits
  on the first changed frame, so a responsive TUI pays one short settle, and only a pane that is
  genuinely not advancing spends the full budget.

The engine already holds the capture that satisfied the echo probe. Call that the **pre-Enter
frame**. After `SendEnter`, capture again (same `ProbeCaptureLines` tail, same `stripForProbe`
normalization) and classify on the first capture that resolves:

| Post-Enter observation | Verdict | Action |
|---|---|---|
| Normalized frame **differs** from the pre-Enter frame | **submitted** | return `nil` — `delivered` |
| Frame **identical** AND needle still present, budget exhausted | **provably not submitted** | evidence-gated retry (below) |
| Frame identical AND needle **absent**, budget exhausted | **inconclusive** | no retry — return `SubmitUnverified` |

Frame comparison uses the existing `stripForProbe` normalization (ANSI escapes stripped, all
whitespace removed) so a cursor-position or styling-only repaint is not mistaken for progress.
Rationale for "frame changed ⇒ submitted": a real submit at minimum clears the composer, which
always alters the frame; the trap's Enter lands on printed output and alters nothing. The pane is
never `active` at this point (the agent-state gate refuses `active` sends), so there is no spinner
to make the frame churn on its own.

### 2b. Escalating-backoff verification cadence (resilient AND fast)

The probe's flat `80ms × 3` cadence is wrong for this phase: it is simultaneously too slow for a
TUI that repaints in 30ms and too impatient for one that takes half a second to redraw after
Enter. Verification instead uses **escalating backoff with early exit**:

```go
// SubmitBackoff is the verification cadence: sleep, capture, compare; return
// the instant the frame differs. Escalating so a fast TUI (Claude Code) pays
// only the first step, while a slow or cold-started one (Gemini, Kimi) still
// gets a patient tail before the phase concludes "not advancing".
var SubmitBackoff = []time.Duration{
    40 * time.Millisecond,
    80 * time.Millisecond,
    160 * time.Millisecond,
    320 * time.Millisecond,
    640 * time.Millisecond,
}
```

| Case | Cost |
|---|---|
| Responsive TUI, submit landed | **~40ms** — first capture already differs, phase returns |
| Slow / cold TUI, submit landed | 120ms / 280ms / 600ms — whichever step it repaints on |
| Printed-prompt trap (frame never changes) | full ~1.24s of sleeps, then the retry cycle |

The success path — overwhelmingly the common one — therefore costs roughly one capture plus 40ms,
which is *less* than the flat cadence would have cost. The full budget is spent only on panes that
are provably not advancing, which is exactly where patience is worth paying for: a 640ms tail is
what keeps a slow-repainting TUI from being misdiagnosed as trapped and sent a needless (though
still non-duplicating) retry.

All sleeps go through the existing `sleepCtx`, so the caller's deadline still truncates the tail.

**Boundary — trust walls and cold starts are the readiness gate's problem, not this phase's.** A
pane parked behind a first-run trust dialog or still booting fails the *echo probe* (the paste
never reaches a live composer), which already returns `ProbeFailure` before any Enter is sent —
so this change neither improves nor regresses that case. `rk mux send` deliberately has no
readiness gate of its own; `fab dispatch open → ready → deliver` owns pre-delivery classification
(`_cli-agents.md` § Delivery Probe, `_preamble.md` § The pane readiness gate). The verification
phase's only obligation toward per-provider startup variance is not to *mistake* a slow post-Enter
repaint for a trap — which is what the escalating tail buys.

### 3. The evidence-gated retry cycle

Runs only on the **provably not submitted** verdict, at most `SubmitRetries` times:

```
CLEAR LOOP, up to ClearAttempts (3) times:
    send-keys C-u
      → re-capture, VERIFY THE CLEAR   (the needle must be gone)
          needle gone      → break, composer is empty
          needle present   → loop
  → clear loop exhausted → ABORT the retry, return SubmitUnverified (never re-paste)
  → set-buffer → paste-buffer          (retype)
  → NOVELTY echo probe                 (same probe, fresh baseline = the post-clear capture)
  → send-keys Enter
  → SUBMIT VERIFY                      (truncated backoff, below)
```

The **clear-verify step is load-bearing**: it is what makes the retry incapable of duplicating.
The engine re-pastes only after *observing* that the composer is empty — it never assumes a
keystroke worked.

The clear is a **bounded repeat-until-clear loop rather than a single `C-u`**, because `C-u`
semantics vary by TUI: in a readline-style composer it kills to line start, so a multi-line
staged paste (or a collapsed `[Pasted text #N +M lines]` chip, which some TUIs render as several
rows) may need one `C-u` per line. Repeating until the capture shows the needle gone makes the
design independent of how any particular TUI models its composer — the same provider-agnosticism
requirement that shapes the verification predicate (§ 2). `ClearAttempts = 3`, a package var.
Exhausting it is not a failure of nerve but the correct terminal state: a composer that will not
clear is one we must not paste into.

Retry budget: `SubmitRetries = 1` (i.e. two submit attempts total), matching `fab pane deliver`'s
one-retry precedent. Declared as a package var alongside `ProbeSettle`/`ProbeGap` so tests can
vary it and a future tuning is a one-line change.

The retry's own verification uses a **truncated backoff** — the first three `SubmitBackoff` steps
(40/80/160ms) rather than the full five. By this point the first verification has already spent
the patient tail on this pane and learned it is not a slow repainter, so re-spending 640ms buys
nothing and would push the daemon path against its route budget (§ 8).

### 4. New sentinel error: `inject.SubmitUnverified`

A second sentinel alongside `ProbeFailure`, with a distinct meaning and distinct caller guidance:

| Sentinel | State of the world | Caller guidance |
|---|---|---|
| `ProbeFailure` | Text pasted, **Enter withheld** — definitely not submitted | Text is staged; a resend would duplicate it |
| `SubmitUnverified` | Enter **was sent**, submission could not be confirmed after the retry budget | Ambiguous — the message may or may not have landed; capture the pane before resending |

```go
// SubmitUnverified is the sentinel for an Enter that was sent but whose
// submission could not be confirmed within the retry budget.
type SubmitUnverified struct{}

func (SubmitUnverified) Error() string {
    return "submit not confirmed — Enter was sent but the pane did not advance. " +
        "The message may or may not have been submitted; capture the pane before resending."
}
```

### 5. The `inject.Tmux` interface grows a fifth method

`C-u` needs a pane-scoped, ctx-bound key send. `internal/tmux` already has
`SendKeysToPane(ctx, paneID, server, keys...)` (`pane_target.go:187`) — the CLI adapter
(`cliInjectTmux`) wires straight onto it. The daemon adapter (`chatSendTmux` over `TmuxOps`,
`api/chat.go:143`) needs a matching pane-scoped seam: `TmuxOps` today exposes only
`SendKeys(windowID, keys, server string) error` (`api/router.go:62`) — window-scoped and
ctx-less, which is the wrong shape. Add a `SendKeysToPane(ctx, paneID, server string, keys ...string) error`
method to `TmuxOps` and implement it on the concrete ops type over the existing
`tmux.SendKeysToPane`.

```go
type Tmux interface {
	CapturePane(ctx context.Context, paneID string, lines int, server string) (string, error)
	SetBuffer(ctx context.Context, name, text, server string) error
	PasteBuffer(ctx context.Context, name, paneID, server string) error
	SendEnter(ctx context.Context, paneID, server string) error
	SendKeys(ctx context.Context, paneID, server string, keys ...string) error  // new
}
```

Every existing test fake of `inject.Tmux` / `TmuxOps` gains the method.

### 6. `rk mux send` report contract gains `unverified`

`agent-messaging.md` R7 fixes the one-line stdout report vocabulary. It becomes four words plus
the await form:

| Report | Meaning | Exit |
|---|---|---|
| `delivered %N` | submit **confirmed** (frame advanced) — the claim is now substantiated | 0 |
| `unverified %N` | Enter sent, submission unconfirmed after the retry budget | 1 |
| `staged %N` | `--no-enter` | 0 |
| `sent %N` | `--key` sends | 0 |

`unverified` prints its report line on stdout (report words are data) with the explanatory
`SubmitUnverified` text on stderr, and exits **1** (toolkit operational-failure convention —
consistent with how `ProbeFailure` already exits 1). A retry that *succeeded* reports plain
`delivered` — the recovery is invisible by design; the fact that a retry happened goes to stderr
as a diagnostic honoring `--quiet` via the `outputSink` convention.

Composition with `--await` is unchanged in shape: a `SubmitUnverified` delivery does not proceed
to the await phase (there is nothing confirmed to wait on), mirroring today's `ProbeFailure`
early return.

### 7. Daemon consumers: HTTP mapping

All four daemon consumers map `SubmitUnverified` to **409 Conflict** with the sentinel's message,
alongside the existing `ProbeFailure → 409`. 409 remains the right class — a valid request that
left the pane in a recoverable-but-ambiguous state — and the distinct message body is what tells
the two apart:

- `api/chat.go` `handleChatSend`
- `api/operator.go` operator-request delivery (~:798)
- `api/operator.go` operator-prompt delivery (~:916)
- `api/paste.go` compose-strip paste

### 8. Timing budget

`chatSendTotalBudget` (`api/chat.go:132`) is the daemon's shared injection deadline, currently
**4s**, chosen to sit under `code-review.md`'s "API routes must not block on tmux operations
longer than 5 seconds" rule with headroom over the probe's 240ms of sleeps.

Because the verification early-exits (§ 2b), the **success** path — the overwhelming majority of
sends — adds roughly **one capture + 40ms**, so the typical route gets *faster* relative to a
flat-cadence design and is barely distinguishable from today. The budget only has to accommodate
the pathological path:

| Phase | Worst case |
|---|---|
| Existing: baseline capture + set + paste + probe + Enter | ~0.35s |
| New: first verification, full backoff (1.24s sleeps + 5 captures) | ~1.5s |
| New: retry cycle (clear loop, ≤3× `C-u`+capture, + set + paste + probe + Enter) | ~0.55s |
| New: retry verification, truncated backoff (0.28s sleeps + 3 captures) | ~0.5s |
| **Total** | **~3.0s** |

That fits inside the existing **4s** `chatSendTotalBudget`, and the budget is
**not** raised — raising it toward `code-review.md`'s 5s route-blocking rule would trade a rare
recovery against a rule violation. The backoff truncation on the retry pass (§ 3) is what keeps
the total under the line; without it the worst case lands around 3.7s, which is too close.

The engine threads the caller's single ctx deadline through the new phase exactly as the probe
does (`sleepCtx`), so a tight deadline truncates the tail and aborts the retry cleanly rather than
overrunning — a deadline-aborted verification surfaces as the ctx error, never as a false
`SubmitUnverified`. The **CLI** path rides `muxCmdTimeout` (5s, `cmd/rk/mux_send.go:45`), which
also accommodates the ~2.8s worst case; neither timeout constant changes.

### 9. Tests

- `internal/inject`: verify-passes (frame advanced), verify-fails-then-retry-succeeds,
  retry-exhausted → `SubmitUnverified`, inconclusive → `SubmitUnverified` **with no retry
  attempted** (the no-duplicate invariant — assert no second `PasteBuffer` call),
  clear-loop succeeds on the 2nd `C-u` → retry proceeds, clear-loop exhausted → abort with
  **no re-paste** (assert no second `PasteBuffer` call), `submit=false` → no verification phase at all,
  ctx cancellation during verify → ctx error not `SubmitUnverified`.
- **Early exit / cadence** (`SubmitBackoff` shrunk by the test, as `ProbeSettle`/`ProbeGap`
  already are): a fake whose frame differs on capture #1 must issue exactly one verification
  capture (asserting the fast path is actually fast, not just nominally early-exiting); a fake
  that differs only on capture #4 must still verify (asserting the patient tail is real);
  the retry pass must issue at most 3 verification captures (asserting the truncation).
- **Provider-shape independence**: a table of synthetic pre/post frames modelled on differently
  shaped TUIs (a bare-prompt composer, a boxed composer, a chip-collapsing composer, one whose
  only change is a status line) must all classify as submitted — no case may depend on
  `pasteCollapseRe` or on any prompt glyph.
- `cmd/rk/mux_send_test.go`: `unverified %N` report + exit 1; `delivered` after a successful
  retry; `--key` path untouched; `--await` not entered on `SubmitUnverified`.
- `api`: 409 + distinct message for `SubmitUnverified` on all four routes.

## Affected Memory

- `run-kit/agent-messaging.md`: (modify) `rk mux send` — R5 (delivery through the shared
  injection engine) gains the post-Enter verification and evidence-gated retry; R7 (one-line
  stdout report contract) gains the `unverified` report word and its exit-1 mapping; the
  `delivered` definition ("probe-confirmed submit") becomes literally true.
- `run-kit/chat.md`: (modify) § Send Path — the pane-targeted injection sequence description
  (`sanitize → paste → probe → gated-Enter`) extends with the verify/retry phase; the "409 on
  probe failure" section gains the second 409 case (`SubmitUnverified`); the `injectIntoPane`
  seam's consumer list is unchanged but all consumers now inherit the new failure mode.
- `run-kit/operator-actuation.md`: (modify) the operator-request and operator-prompt delivery
  paths gain the `SubmitUnverified → 409` mapping.
- `run-kit/api-and-sockets.md`: (modify) the compose-strip `POST /api/windows/{id}/paste`
  endpoint's error vocabulary gains the second 409 case.

## Impact

**Go — backend:**

| Area | Change |
|---|---|
| `app/backend/internal/inject/inject.go` | Verification phase, retry cycle, `SubmitUnverified`, `Tmux` interface 5th method, `SubmitAttempts`/`SubmitRetries` tunables |
| `app/backend/internal/inject/inject_test.go` | New cases per § 9; every `Tmux` fake grows `SendKeys` |
| `app/backend/cmd/rk/mux_send.go` | `SubmitUnverified` branch, `unverified` report word, `cliInjectTmux.SendKeys` |
| `app/backend/cmd/rk/mux_send_test.go` | Report/exit assertions |
| `app/backend/api/chat.go` | `chatSendTmux.SendKeys`; `SubmitUnverified → 409` |
| `app/backend/api/router.go` | `TmuxOps` gains `SendKeysToPane` (+ concrete impl, + test fakes) |
| `app/backend/api/operator.go` | Two `SubmitUnverified → 409` branches |
| `app/backend/api/paste.go` | `SubmitUnverified → 409` |

**Contract surfaces:** `rk mux send` stdout vocabulary (additive: a new word, no existing word
changes meaning); four HTTP routes' 409 message set (additive). No route/verb changes
(Constitution IX untouched), no new env vars or config keys (Constitution IV untouched), no new
state (Constitution II untouched). All new subprocess calls go through existing
`exec.CommandContext`-backed `internal/tmux` primitives with the caller's ctx (Constitution I).

**Not in scope:** the `--key` send path; `submit=false` staging; `rk mux await`; the agent-state
gate matrix; fab-kit's `fab pane deliver` (already mechanizes this on its own side); the
`_cli-agents.md` manual-recipe documentation, which lives in fab-kit, not this repo.

**Toolkit standards:** `rk mux send --help` text changes (new report word) — check against
`shll standards` before the CLI-surface edit, per the constitution's Toolkit Standards clause.

## Open Questions

- Is `ClearAttempts = 3` enough for the worst realistic composer state (a many-line staged paste
  in a readline-style composer that kills one line per `C-u`)? Under-provisioning costs a missed
  recovery, never a duplicate, and the value is a package var — but if a common TUI needs more,
  the loop should be re-bounded on observation during apply.
- Are there agent TUIs among the target set (Claude Code, Codex, Gemini, Kimi, OpenCode) whose
  composer does **not** repaint the frame on submit, which would make them chronically
  "inconclusive"? The failure mode is a spurious `unverified` (never a duplicate), so this is a
  false-positive-rate question, not a correctness one. Apply should spot-check the post-Enter
  repaint on at least Claude Code and one non-Claude TUI, and record the observed repaint
  latency against the `SubmitBackoff` steps.
- Is the five-step `SubmitBackoff` tail (1.24s) long enough for the slowest of the target TUIs
  under a cold start, and short enough that a trapped pane recovers promptly? The two pressures
  pull opposite ways and the numbers here are a reasoned first cut, not measured. They are a
  package var precisely so apply can retune from observation without a structural change.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The fix lands in `internal/inject`'s `Engine.Send` (shared by all five consumers), not in `cmd/rk/mux_send.go` alone | Asked and answered by the user (fork 1, "Shared inject engine"); also the package's documented founding purpose — "BOTH the daemon route and the CLI verb drive ONE implementation" | S:95 R:75 A:90 D:95 |
| 2 | Certain | Retry is evidence-gated: it fires only on positive proof nothing was submitted (frame unchanged AND needle present), never on a merely inconclusive verification | Asked and answered by the user (fork 2, "Evidence-gated retry"); the alternative admits a duplicate-submission path that `C-u` cannot undo | S:95 R:70 A:90 D:95 |
| 3 | Certain | `submit=false` and `--key` send paths are untouched — no verification phase runs when no Enter is sent | No Enter means nothing to verify; key names have no echo to probe (`agent-messaging.md` R3 states this for `--key`) | S:90 R:95 A:95 D:95 |
| 4 | Confident | The submit signal is "the normalized frame changed vs. the pre-Enter frame", not "the needle left the composer" | A real submit always clears the composer, so the frame always changes; a needle-count test fails because Claude Code re-renders the submitted text into the transcript, keeping the count flat. Frame comparison also needs no TUI-specific composer-region parsing, which is what satisfies the provider-agnosticism requirement (row 15) | S:70 R:65 A:80 D:70 |
| 5 | Confident | The retry cycle verifies the `C-u` clear BEFORE re-pasting, and aborts (returning `SubmitUnverified`) if the composer is not empty | This is what makes the retry structurally incapable of duplicating — a stronger guarantee than the retry bound alone. Mirrors the existing engine posture of failing closed rather than sending blind | S:75 R:80 A:85 D:75 |
| 6 | Confident | `SubmitRetries = 1` (two submit attempts total), as a package var next to `ProbeSettle`/`ProbeGap` | Matches `fab pane deliver`'s one-retry precedent and fits the 4s daemon budget; the backlog said "1-2" and left it open. A var keeps retuning to one line | S:65 R:90 A:75 D:70 |
| 7 | Confident | A new `inject.SubmitUnverified` sentinel rather than reusing `ProbeFailure` | The two states differ in the one way that matters to a caller: `ProbeFailure` means definitely-not-submitted (resend duplicates), `SubmitUnverified` means unknown (capture first). Collapsing them would give callers advice that is wrong half the time | S:80 R:85 A:85 D:80 |
| 8 | Confident | `SubmitUnverified` maps to HTTP **409** on all four daemon routes, distinguished from `ProbeFailure` by message text | 409 is already this codebase's "valid request, recoverable wrong state" class for exactly the sibling case; a new status code would be a larger contract change for a distinction the body already carries | S:75 R:80 A:85 D:70 |
| 9 | Confident | `rk mux send` reports `unverified %N` on stdout and exits 1 | Extends R7's report vocabulary additively; exit 1 matches the toolkit operational-failure convention already used for `ProbeFailure`, keeping first-token parsers working | S:75 R:85 A:85 D:75 |
| 10 | Confident | `chatSendTotalBudget` (4s) and `muxCmdTimeout` (5s) both stay as they are; the new phase fits inside them | Raising either pushes toward `code-review.md`'s 5s route-blocking rule. Early exit means the success path adds ~40ms, and the ~2.8s pathological worst case fits with headroom; a tight ctx truncates the tail via the existing `sleepCtx` pattern | S:65 R:75 A:85 D:70 |
| 11 | Confident | `TmuxOps` gains a pane-scoped ctx-bound `SendKeysToPane`; the existing window-scoped ctx-less `SendKeys(windowID, keys, server)` is left untouched | The engine is pane-targeted throughout ("every step targets paneID, never the window") and every other primitive is ctx-bound; reusing the window-scoped method would break both properties. Leaving the old method alone avoids touching possible external callers | S:75 R:75 A:90 D:80 |
| 12 | Certain | The composer clear is a bounded repeat-until-clear loop (`C-u` → capture → repeat, `ClearAttempts = 3`), not a single `C-u`; exhaustion aborts the retry without re-pasting | Removes the empirical dependency entirely rather than guessing at per-TUI `C-u` semantics: the engine observes the composer is empty instead of assuming a keystroke worked. Same provider-agnosticism requirement as row 15, and the abort path preserves the no-duplicate invariant either way | S:80 R:85 A:85 D:80 |
| 13 | Tentative | Every TUI in the target set repaints the frame on submit, so the "frame changed" signal generalizes beyond Claude Code | Verified by reasoning for Claude Code only; Codex/Gemini/Kimi/OpenCode composers are unexamined. A non-repainting TUI yields spurious `unverified` (never a duplicate), so the blast radius is false-positive rate. Apply is asked to spot-check one non-Claude TUI <!-- assumed: all target agent TUIs repaint on submit — unverified outside Claude Code --> | S:45 R:75 A:35 D:45 |
| 14 | Tentative | A successful retry reports plain `delivered` (recovery invisible on stdout), with the retry noted only as a stderr diagnostic | Keeps R7's stdout contract to one data word per outcome; an argument exists for a distinct `recovered` word so callers can measure trap frequency, but that widens the contract for telemetry the stderr line already carries <!-- assumed: successful retry reports `delivered`, not a distinct `recovered` word --> | S:50 R:80 A:55 D:45 |
| 15 | Certain | The verification predicate must be provider-agnostic — no composer-region parsing, prompt-glyph matching, or paste-chip recognition, and no new dependency on the existing Claude-specific `pasteCollapseRe` | Stated as a requirement by the user mid-intake: the command runs against Claude Code, Codex, Gemini, Kimi and OpenCode. Frame comparison assumes only "a submit repaints something", which is the weakest assumption available | S:90 R:70 A:85 D:90 |
| 16 | Confident | Verification uses escalating backoff with early exit rather than the probe's flat 80ms×3 cadence | Directly serves the user's "resilient AND fast" constraint against providers with different startup and repaint timings: the success path returns on the first differing capture (~40ms, faster than a flat cadence), and only a provably-stalled pane spends the patient tail | S:75 R:85 A:80 D:75 |
| 17 | Tentative | The specific ladder `40/80/160/320/640ms`, truncated to the first three steps on the retry pass | A reasoned first cut, not measured — chosen so the total worst case lands ~2.8s against the 4s route budget. Declared a package var so apply can retune from observed repaint latencies without a structural change <!-- assumed: SubmitBackoff ladder values — reasoned from the budget, not measured against real TUIs --> | S:40 R:90 A:40 D:45 |
| 18 | Certain | Trust walls, login prompts, and cold-start readiness stay out of scope — they are the readiness gate's concern, and the existing echo probe already fails closed on them before any Enter is sent | A pane behind a trust dialog never gets the paste into a live composer, so `ProbeFailure` fires first and this change neither helps nor harms that path. `rk mux send` has no readiness gate by design; `fab dispatch open → ready → deliver` owns pre-delivery classification | S:85 R:85 A:90 D:85 |

18 assumptions (6 certain, 9 confident, 3 tentative, 0 unresolved).
