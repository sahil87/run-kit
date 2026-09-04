# Intake: Await-Ready Parked Classification (Agent-Messaging Part B)

**Change**: 260904-r7uk-await-ready-parked-classification
**Created**: 2026-09-04

## Origin

One-shot `/fab-new` invocation, executing **Part B (gap 2)** of the agent-messaging
execution plan in `docs/specs/agent-messaging.md` (commit `c36cfbd8` on main — the spec
is not yet on this branch; rebase brings it in). Governing spec sections: **Spawn and
trust walls — the readiness standard** (item 1, sentinel classification) and **Gaps from
current state** item 2.

> Agent-messaging Part B: parked classification (gap 2). Add a sentinel echo classifier
> to inject.AwaitReady, used by rk mux await --ready: when no reconciled agent state
> exists and the screen settles, type a harmless sentinel, check whether it echoes, then
> C-u clear. Echo at an input box means ready %N (echo). No echo on a settled non-blank
> screen means parked %N, exit 0, with the screen snippet on stderr. booting never
> returns from await --ready; it blocks through boot churn and only returns on ready,
> parked, gone, or timeout (running). The sentinel is typed only into pre-delivery panes
> — no agent state yet, nothing delivered — the same carve-out fab's dispatch gate uses;
> against a live delivered worker, readiness verbs stay illegal. This run-kit part
> intrinsically includes: the standards audit (shll standards), the help-dump test
> update for rk mux await -h, and rk skill messaging topic-page updates per the
> Execution plan table in the same spec. No dependency on Part A, but Part A touches the
> same internal/inject area — rebase against main before shipping if A has already merged.

## Why

1. **The pain point**: `inject.AwaitReady`'s capture-settle fallback (the signal for
   hook-less panes) declares a pane "ready" when its screen is non-blank and
   byte-identical across two consecutive polls. A **settled trust dialog, survey, theme
   picker, or login wall satisfies exactly that predicate** — the pane reports
   `ready %N (settled)` while it is in fact parked behind a wall that will eat or
   misroute any delivered prompt. The false-fire is documented in `ready.go` itself
   ("Settle caveat: a settled FIRST-RUN dialog can false-fire readiness") and is only
   caught later, by the delivery engine's echo probe failing closed.

2. **The consequence if unfixed**: callers (fab's dispatch gate, `rk mux await --ready`
   users, riff/kickoff spawn flows) cannot distinguish "boot finished, input box live"
   from "boot finished into a wall" without spending a real delivery attempt. The fab
   dispatch gate keeps carrying its own classification half instead of delegating to rk
   (spec gap 5 / Part D is blocked on this change), and every `--ready` consumer must
   treat `(settled)` as a maybe.

3. **Why this approach**: the sentinel echo probe converts the ambiguous "settled" state
   into an honest two-way classification using machinery the engine already trusts —
   type a harmless sentinel, look for its echo, clear with `C-u`. Echo means a live
   input box (`ready (echo)`); no echo on a settled non-blank screen means a wall
   (`parked`). Classification stays mechanical and rk-owned; **judgment stays
   caller-side** (what the wall wants — trust prompt vs survey — is decided by the
   caller from the snippet; login walls escalate to a human, rk never auto-answers).
   The alternative — teaching rk to recognize wall types — was rejected by the spec's
   layering ("Policy | Callers … Never encoded in the binary").

## What Changes

### 1. `internal/inject` — sentinel echo classifier in `AwaitReady`

File: `app/backend/internal/inject/ready.go` (current: two signals, first hit wins —
`ReadyByState` from the injected state reader, `ReadyBySettle` from two identical
non-blank captures).

Target behavior of the poll loop:

- **State-present** (unchanged, preferred, touch-nothing): the injected `opts.State`
  reader returns a non-empty state → `ReadyByState`. Checked first every poll, so the
  sentinel is only ever typed into a pane with **no reconciled agent state** — the
  mechanical half of the scope rule.
- **Sentinel classification** (replaces the settle *return*; settle becomes the
  *trigger*): when no state appears and the capture settles (non-blank, unchanged
  across consecutive polls), run the sentinel echo probe:
  1. Type a harmless sentinel into the pane (through the engine's existing typing
     machinery — named-buffer bracketed paste; the single-engine invariant holds
     because the classifier lives in `internal/inject`).
  2. Capture and check whether the sentinel **echoes** (novelty counting against a
     pre-probe baseline, the `CountOccurrences`/`Needle` discipline the engine's
     `probeEcho` already uses, so a stale same-text occurrence on screen cannot
     satisfy the probe).
  3. Clear with `C-u` (best-effort composer clear; the engine's `clearComposer`
     pattern).
  - **Echo** → return the readiness value for echo (`ready … (echo)` at the CLI). The
    `ReadyBySettle` value and its `(settled)` report word **retire** — no code path
    returns them anymore.
  - **No echo, screen still settled and non-blank** → **parked**: surfaced from inject
    as a typed sentinel error carrying the screen snippet (the `ErrNotReady` /
    `ProbeFailure` pattern — see Assumption 3), so `DeliverWhenReady` and every other
    consumer fails closed on it without special-casing.
- **Boot churn never returns**: a still-changing screen keeps polling (this is today's
  behavior — "booting" is the non-settled state). The wait returns only on ready,
  parked, gone, or deadline expiry (`ErrNotReady`, which the CLI maps to `running`).
- **Pane death mid-wait** → gone: today a dead pane's capture errors are tolerated as
  "not yet" until the deadline. Target: a "can't find pane" class failure returns a
  gone verdict (the CLI's `muxReadPaneState` already maps this string for the state
  observer; the readiness path gains the equivalent).
- **Probe infrastructure errors** (capture/paste failure mid-probe) are "not yet" —
  re-enter polling, bounded by the deadline. Never a false `parked` or false `ready`.
- `DeliverWhenReady` (same file) needs no signature change: a parked classification is
  an `AwaitReady` error, so delivery is never attempted into a wall — an improvement
  over today, where the real prompt is staged and the engine's probe fails closed
  after the fact.

### 2. `rk mux await --ready` — report contract

File: `app/backend/cmd/rk/mux_await.go` (`runMuxAwaitReady`, `muxAwaitReadyFn`, the
`--ready` flag help, the command `Long`).

| Verdict | stdout report | exit | stderr |
|---------|--------------|------|--------|
| state present | `ready %N (state)` | 0 | — |
| sentinel echoed | `ready %N (echo)` | 0 | — |
| settled, no echo | `parked %N` | 0 | the screen snippet (so the caller can judge what the wall wants) |
| timeout expired | `running` | 0 | — (family contract unchanged: the timeout bounds the observer, never the pane) |
| pane died mid-wait | `gone` | 1 | diagnostics (family contract) |

- `ready %N (settled)` disappears from the surface.
- `parked` **returns immediately** — it is wake-worthy; the caller must act. It does
  NOT keep polling until timeout. Exit 0: classification succeeded, this is a report,
  not a failure.
- The indefinite-timeout re-arm loop (`--timeout 0` re-running the bounded primitive
  after each `ErrNotReady`) keeps re-arming on `ErrNotReady` only — parked and gone
  break the loop.
- `--notify` fires on every report including `parked` (the family's deliberate
  "woken when the wait ends, however it ends" rule).
- The documented hook-less composition is unchanged:
  `rk mux await --ready %5 && rk mux send --force %5 '<prompt>'` — `send` gains no new
  gate mode; a `parked` exit is 0, so callers composing with `&&` must branch on the
  report word, which the help text and skill page state explicitly.
- **Scope rule documentation**: the sentinel is typed only into pre-delivery panes (no
  agent state, nothing delivered) — the same carve-out fab's dispatch gate uses.
  Against a live delivered worker, readiness verbs stay illegal; use `await --until` /
  `capture`. rk enforces the state-absence half mechanically (state is checked before
  every probe); the nothing-delivered half is documented caller policy in the help
  text and skill page — `rk mux await` has no delivery ledger to consult.

### 3. Intrinsic CLI-surface obligations (per the spec's Execution plan preamble)

- **Standards audit**: run `shll standards`, check the changed surface (`rk mux await`
  help/report contract) against the governing standards (help-dump, Principle 9
  data-vs-chatter, report-word/exit-code conventions) before ship.
- **Help-dump test update for `rk mux await -h`**: the help text (`Long`, `--ready`
  flag help) changes; update the CLI tests pinning the `--ready` report lines —
  `app/backend/cmd/rk/mux_await_test.go` currently asserts
  `ready %5 (state)` / `ready %5 (settled)` (~line 661) — plus any help-shape
  assertions. `help-dump` publishes `UsageString`/`Long` mechanically, so the audit is
  a check, not a code change.
- **`rk skill` topic-page updates**: `docs/site/skill/mux.md` (canonical; the await
  section's `--ready` example line and prose currently teach
  `ready %5 (state)` or `ready %5 (settled)`) and `docs/site/skill.md` (the report-word
  summary line) gain `(echo)`/`parked` and lose `(settled)`; re-run
  `scripts/sync-skill.sh` to refresh the embedded copies under
  `app/backend/cmd/rk/skill/`. **Out of scope**: the new dedicated *messaging topic
  page* teaching the channel matrix — that is Part C (gap 3), which depends on B
  precisely because "the topic page documents `parked`".

### 4. Downstream inject consumers (behavior-preserving fail-closed)

- `app/backend/cmd/rk/agent_kickoff.go` (`DeliverWhenReady` consumer) and the riff
  claude-gated task-injection fallback: a parked classification surfaces as an error
  before delivery. Callers keep their existing failure handling; the prompt is no
  longer staged into a wall first. No caller may treat parked as retriable-blind.

### 5. Coordination with Part A (send hardening)

Part A (pane-mode guard + foreground-naming warning) touches the same
`internal/inject` area and owns the `#{pane_in_mode}` probe-and-cancel guard on every
delivery path **including the sentinel probe**. B does not implement that guard. If A
has merged by ship time, rebase against main and route the sentinel typing through
whatever guarded seam A introduced. Parallel-safe otherwise (spec: "A ∥ B → C").

## Affected Memory

- `run-kit/agent-messaging`: (modify) `rk mux await --ready` semantics — sentinel echo
  classification, `ready (echo)` / `parked` report words, `(settled)` retirement, gone
  detection, scope rule
- `run-kit/architecture`: (modify) the inject library description (boot-ready
  AwaitReady signal set changes from state/settle to state/echo/parked)
- `run-kit/agent-send`: (modify) the injection-engine section, if the sentinel
  classifier extracts/reuses probe primitives in a way that changes the engine's
  described seams (baseline novelty counting reused outside `Send`)

## Impact

- `app/backend/internal/inject/ready.go` + `ready_test.go` — the classifier core
- `app/backend/internal/inject/inject.go` — only if probe primitives need a
  probe-only export/refactor for reuse (no behavior change to `Send`)
- `app/backend/cmd/rk/mux_await.go` + `mux_await_test.go` — report mapping, exit
  codes, stderr snippet, help text
- `app/backend/cmd/rk/agent_kickoff.go` (+ its tests) — parked error handling on the
  `DeliverWhenReady` path
- `docs/site/skill/mux.md`, `docs/site/skill.md` → `scripts/sync-skill.sh` →
  `app/backend/cmd/rk/skill/*` (embedded copies) + `skill_test.go` byte-identity
- Standards audit (`shll standards`) — check-only unless it surfaces a violation
- Cross-repo (informational, NOT this change): fab-kit's dispatch gate delegation is
  Part D, gated on B *releasing* (brew-installable), not merely merging

## Open Questions

*(none — the spec and invocation resolve every blocking decision; remaining choices
are graded assumptions below)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Report contract: `ready %N (state)` / `ready %N (echo)` / `parked %N` (exit 0, snippet on stderr) / `running` (exit 0) / `gone` (exit 1); `(settled)` retires | Spec-decided verbatim (agent-messaging.md readiness standard item 1 + frozen report-word contract) | S:95 R:70 A:95 D:95 |
| 2 | Certain | Sentinel scope: rk mechanically enforces only the no-agent-state half (state checked before every probe); the nothing-delivered half is documented caller policy, not a delivery ledger in rk | Spec's scope rule + layering table (policy is caller-side); `rk mux await` has no delivery record to consult | S:90 R:75 A:90 D:90 |
| 3 | Confident | Parked surfaces from inject as a typed sentinel error carrying the snippet (the `ErrNotReady`/`ProbeFailure` pattern), not a new `Readiness` value, so `DeliverWhenReady` and all consumers fail closed without signature changes | Matches the package's existing error-shape conventions; a Readiness value would let a naive consumer deliver into a wall | S:70 R:80 A:85 D:75 |
| 4 | Confident | Sentinel typing reuses the engine's probe primitives (named-buffer bracketed paste, `Sanitize`/`Needle`/`CountOccurrences` baseline novelty counting) + `C-u` clear via the `clearComposer` pattern, all inside `internal/inject` | Single-engine invariant (spec Mechanism layer: "no exceptions"); novelty counting is what makes echo detection sound against stale on-screen text | S:75 R:70 A:85 D:70 |
| 5 | Tentative | Exact sentinel text and settle depth before spending a probe (how many identical polls, whether to re-settle after a churn interruption) are apply-time tuning | Spec says only "a harmless sentinel"; values are trivially adjustable constants, apply decides-and-records | S:45 R:60 A:45 D:40 |
| 6 | Confident | Pane death mid-wait returns gone (exit 1) from the `--ready` path, mapping the "can't find pane" failure class as `muxReadPaneState` already does | Spec return set names gone explicitly; family contract fixes exit 1; the mapping precedent exists in the same file | S:70 R:80 A:80 D:80 |
| 7 | Confident | Probe infrastructure errors (capture/paste failure mid-probe) classify as "not yet" — re-enter polling bounded by the deadline; never a false parked/ready | Consistent with AwaitReady's existing capture-error tolerance; a wrong parked verdict would misdirect the caller's judgment round | S:65 R:80 A:80 D:75 |
| 8 | Certain | `--notify` fires on `parked` exactly as on every other report | Family contract already documented: woken when the wait ends, however it ends | S:85 R:90 A:95 D:90 |
| 9 | Certain | The new dedicated messaging topic page is Part C and out of scope; B updates the existing `mux.md`/`skill.md` `--ready` mentions + sync-skill only | Spec execution plan: C depends on B because "the topic page documents `parked`" | S:75 R:85 A:80 D:80 |
| 10 | Certain | Part A owns the pane-mode guard on the sentinel path; B implements no `#{pane_in_mode}` guard and rebases against main before ship if A merged | Spec assigns the guard to gap 1/Part A ("the sentinel probe" listed under A's delivery paths); invocation states the rebase rule | S:80 R:80 A:85 D:85 |

10 assumptions (5 certain, 4 confident, 1 tentative, 0 unresolved).
