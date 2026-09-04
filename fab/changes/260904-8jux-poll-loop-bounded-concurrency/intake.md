# Intake: Poll Loop Bounded Concurrency

**Change**: 260904-8jux-poll-loop-bounded-concurrency
**Created**: 2026-09-04

## Origin

One-shot `/fab-new` invocation, executing Change C of the six-change daemon-reliability plan
`fab/plans/sahil/26-09-04-daemon-blocking-reliability.md` (authored from the 2026-09-04 live
incident diagnosis + two code audits):

> Daemon reliability - Change C: bound the poll loop head-of-line blocking (only after B merges).
> Read and follow fab/plans/sahil/26-09-04-daemon-blocking-reliability.md, Change C section
> exactly. Files: app/backend/api/sse.go (+tests). Structural change, design freedom in apply -
> fan the per-server poll body out with bounded concurrency (parallelism across servers, never
> within one tmux server), emit each server's events as it completes, move the global broadcasts
> ahead of or independent of the server loop, consider a per-tick time budget. This worktree is
> freshly branched off main AFTER Change B (sseHub race fixes, PR #831) merged, so B is already
> present - rebase not needed. Re-verify all line numbers against current HEAD before editing
> since B may have shifted them - plan numbers are as of fd16e6b4.

Prerequisite verified at intake: PR #831 (`857fb06f fix: sseHub Race Fixes + Wake on Cold
Subscribe`) is an ancestor of this worktree's HEAD (`6abc7433`), and the B change (jjda) is
archived. All B-era locking (every `h.cache` access under `h.mu`, cold-subscribe wake, membership
wake) is present in the file being changed. Line numbers below are re-verified against current
HEAD — the plan's numbers (as of `fd16e6b4`) have shifted.

## Why

1. **The pain point**: `poll()` (`app/backend/api/sse.go:1417`) is the daemon's only snapshot
   producer and walks all subscribed tmux servers **sequentially** in a single goroutine
   (`for _, server := range servers` at `:1471`). Per server it runs `FetchSessions`
   (background ctx, a subprocess exec with up to 10s of inner execs, `:1501`) and then
   `capturePreviews` (one `capture-pane` exec per expanded window, serial, `:1624`). One slow or
   overloaded server therefore head-of-line blocks every other server's snapshot. Worse, the
   host-global broadcasts — metrics (`:1787`), services (`:1803`), code-server (`:1822`) — are
   emitted only **after** the whole server loop, so one hung server freezes every tab's metrics,
   including tabs viewing entirely different servers.

2. **The consequence if unfixed**: during the 2026-09-04 incident, a `go test ./cmd/rk/` run in
   one worktree created tmux test servers at >1/s; each entered the poll set and multiplied the
   sequential workload. The primary `rK` server's snapshot went stale, its execs were killed at
   their context deadlines (`SSE poll error err="signal: killed" server=rK` in the daemon log),
   and the dashboard degraded across **all** servers — even though tmux itself answered
   `display-message` in ≤15ms throughout. The tmux layer was never slow; the loss is queueing
   inside the daemon's single poll goroutine. Any future heavy workload in one worktree
   re-triggers this.

3. **Why this approach**: the sibling changes fix leaks (A), races (B, merged), probe-timeout
   misclassification (D, merged), socket hygiene (E), and the git-fallback storm (F) — but none
   of them removes the structural serialization. Bounded concurrency across servers directly
   removes the head-of-line coupling while respecting tmux's per-server single-threaded nature
   (parallelism must never occur *within* one tmux server — its command channel serializes
   anyway, and concurrent execs against one server only pile up forks). B's race fixes are the
   prerequisite that makes fan-out safe to build: every shared-map access in the loop body is now
   consistently under `h.mu`.

## What Changes

All changes are in `app/backend/api/sse.go` (+ its tests). Structural rework of `poll()`;
design freedom in apply within the constraints below.

### 1. Fan the per-server poll body out with bounded concurrency

The per-server loop body (`sse.go:1471–1708` today: cache check/invalidate → `FetchSessions` →
`attachPRStatus` → waiting-push/auto-name/operator-queue advance → sessions marshal + dedup +
fan-out → previews → order bootstrap → disappearance WARN) becomes a per-server unit of work
executed by a bounded worker pool (or equivalent semaphore-bounded goroutines) each tick.

Constraints:

- **Parallelism across servers, never within one server.** One in-flight unit of work per server
  at a time — including across ticks: a tick MUST NOT start a server's unit while the previous
  tick's unit for that same server is still running (a slow server gets skipped/carried, not
  doubled up). Within a unit, the existing serial shape stays serial (`capturePreviews`' one
  exec per window remains sequential).
- **Bounded.** A named-constant concurrency bound (small, e.g. 4–8 workers) so a `go test` storm
  creating dozens of servers cannot fork-storm the daemon. <!-- assumed: exact bound value and
  whether it needs to be settings-registry-exposed is apply's decision; a named constant with a
  code comment is the floor -->
- **The `metricsOnlyServer` sentinel** (`:1476`) keeps its skip — it has no tmux server and no
  unit of work.
- **`eventDrivenServers` / `perServerGen`** are poll-goroutine-owned maps today; the dispatch
  path must keep them single-owner (read/consume at dispatch time in the poll goroutine, or
  hand each unit an immutable snapshot) rather than sharing them mutably with workers.

### 2. Emit each server's events as its unit completes

Today a server's `sessions`/`preview`/`session-order` events are emitted inline as the loop
reaches it — so server N's freshness waits on servers 1..N-1. Under fan-out, each unit emits its
own server's events when it completes (the existing per-server emit code already takes `h.mu`
around every shared-state touch, per B). The ack-ordering invariant MUST hold per-server:
`h.previousJSON[server]` is updated before that tick's fan-out for that server
(`TestStateWS_SubscribeAckNotStaleUnderPollInterleave` guards this).

### 3. Global broadcasts ahead of / independent of the server loop

The metrics (`:1787–1799`), services (`:1803–1815`), and code-server (`:1822–1831`) broadcasts
move ahead of the per-server work (or onto an independent emission point) so they are emitted
every tick regardless of how slow any server's fetch is. Their existing shape is otherwise
unchanged: pre-rendered once (`preRendered`), cached-slot update + `broadcastGlobalLocked` under
`h.mu`.

### 4. Post-loop sweeps become a join point

The end-of-tick work consumes the **whole tick's** accumulated results and must run after all
units complete (or are accounted for):

- `h.waitingPush.retain(liveWaitingKeys, reapableServers)` (`:1726`), `autoName.retain`
  (`:1731`), `operatorQueue.retain` (`:1734`) — their reap-scoping semantics (only servers
  actually observed this tick: `polledServers` + `deadServers`; transient-failure servers in
  neither) MUST be preserved exactly. A server whose unit was skipped this tick (still running
  from a prior tick, or over budget) counts as *not observed* — its episodes must not be reaped.
- The dead-server reap (`:1747–1783`) — `gone` events, deletion from `h.clients` and all
  per-server maps, wake-channel drop — stays a single post-join block under one write lock,
  exactly as today ("never mid-range, never across FetchSessions").
- The per-tick accumulators (`deadServers`, `liveWaitingKeys`, `liveAutoNameKeys`,
  `polledServers`) become per-unit results merged at the join (or a mutex-guarded collector) —
  worker goroutines must not write loop-local maps concurrently.
- The three advance trackers (`waitingPushTracker`, `autoNameTracker`, operator queue) are each
  internally mutex-guarded (`waiting_push.go:66`, `auto_name.go:61`, `operator_queue.go:59`),
  so concurrent per-server `notifyWaiting`/`advance` calls from units are safe as-is.

`h.waitForNext(servers, perServerGen, eventDrivenServers)` (`:1843`) remains a single call by
the poll goroutine after the join.

### 5. Per-tick time budget (optional, apply decides)

The plan says "consider a per-tick time budget so one server cannot own the tick". With
bounded concurrency + per-unit emission, one slow server already cannot delay others' events or
the global broadcasts — the budget's residual value is keeping the *join* (and thus the
post-loop sweeps and `waitForNext` re-arm) from waiting on one straggler. If included, a
budget-expired straggler's unit keeps running to completion in the background (its server is
"not observed" for that tick's retain sweep; its one-unit-in-flight guard prevents a pileup) and
the tick joins without it. Apply decides whether the added complexity is warranted or whether
the skip-while-running guard alone suffices.
<!-- assumed: time budget is optional — the two mandatory mechanisms (bounded fan-out,
independent global broadcasts) already remove the user-visible head-of-line blocking; a budget
only bounds join latency for the sweeps/waitForNext re-arm -->

### 6. Tests

- Unit tests proving: (a) one artificially slow server (blocking fetcher stub) does not delay
  another server's `sessions` emission, and (b) does not delay the global metrics broadcast —
  the plan's review question ("can one slow server still delay another server's snapshot or the
  global broadcasts?") expressed as tests.
- A test that a server never has two concurrent `FetchSessions` in flight (single-threadedness
  per server, including across ticks).
- Retain-scoping regression: a skipped/failed server's waiting-push episodes are not reaped.
- Keep/extend `-race` coverage on the package (B's tests already run under `-race`; the fan-out
  is exactly the kind of change `-race` exists for).

## Affected Memory

- `run-kit/api-and-sockets.md`: (modify) § State Socket poll/broadcast prose — the poll loop's
  per-server walk becomes bounded-concurrent with per-unit emission; global broadcasts
  (metrics/services/code-server) become independent of the server loop; cold-subscribe wake and
  pre-render idioms unchanged but their surrounding loop shape is re-described.
- `run-kit/tmux-sessions.md`: (modify) § SSE Poll-Set Lifecycle — the dead-server reap's
  concurrency contract ("collected during the loop, reaped after, never mid-range") is restated
  over per-unit results merged at a join point.

## Impact

- **Code**: `app/backend/api/sse.go` — structural rework of `poll()` (`:1417`) and the
  per-server loop body (`:1471–1708`); global broadcast blocks (`:1787–1831`) relocated;
  new bounded-concurrency scaffolding (worker pool / semaphore + per-unit result type).
  `app/backend/api/sse_test.go` (and siblings, e.g. `state_ws_test.go` where poll interleaving
  is asserted) — new concurrency tests; existing tests must keep passing unchanged (they pin
  the event contract, not the loop shape).
- **Behavior**: no API/event-contract change — same events, same envelopes, same dedup, same
  reap semantics. Freshness improves: a slow server no longer delays other servers' snapshots
  or host-global broadcasts. Fork pressure is bounded by the concurrency constant.
- **Risk**: concurrency bugs in the hottest path of the daemon. Mitigated by B's now-consistent
  locking discipline, internally-locked trackers, single-owner rules for the poll-local maps,
  the join-point design for sweeps, and `-race` test coverage.
- **Dependencies**: none new. B (PR #831) already merged and present; no rebase needed.

## Open Questions

- None blocking. The review-stage focus question from the plan: *can one slow server still
  delay another server's snapshot or the global broadcasts?* — to be answered "no" with tests.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | B prerequisite satisfied; build directly on current HEAD, no rebase | Verified: PR #831 (857fb06f) is an ancestor of HEAD (6abc7433); B change jjda archived; B's locking present in sse.go | S:95 R:90 A:100 D:100 |
| 2 | Certain | Plan line numbers re-anchored to current HEAD: poll() :1417, server loop :1471, FetchSessions :1501, capturePreviews :1624, global broadcasts :1787–1831, waitForNext :1843 | Verified by reading sse.go at HEAD; plan's :1349 etc. were as of fd16e6b4 | S:90 R:95 A:100 D:100 |
| 3 | Confident | Fan-out shape: bounded worker pool / semaphore across servers; one in-flight unit per server incl. across ticks; serial within a unit | Direction given verbatim by the plan + invocation ("parallelism across servers, never within one"); cross-tick single-flight is the necessary reading of per-server single-threadedness | S:85 R:60 A:80 D:75 |
| 4 | Confident | Global broadcasts (metrics/services/code-server) emitted ahead of / independent of per-server work each tick | Directed by the plan; existing broadcast blocks are self-contained and relocatable | S:85 R:70 A:85 D:80 |
| 5 | Confident | Per-server events emitted as each unit completes, not batched at tick end | Directed by the plan ("emit each server's events as it completes"); per-server emit code already locks correctly post-B | S:85 R:60 A:80 D:80 |
| 6 | Confident | Concurrency bound is a small named constant (order 4–8); not settings-registry-exposed | Plan gives no number; a constant is trivially tunable later and Constitution VII prefers convention over configuration | S:40 R:85 A:65 D:50 |
| 7 | Tentative | Per-tick time budget is optional; apply decides after the two mandatory mechanisms land | Plan says "consider"; residual value is join latency only, and a straggler guard (skip-while-running) may suffice | S:45 R:55 A:50 D:30 |
| 8 | Confident | Per-tick accumulators become per-unit results merged at a join; retain sweeps and dead-server reap run post-join with semantics preserved; trackers called concurrently as-is (internally locked) | Read from code: trackers carry their own mutexes (waiting_push.go:66, auto_name.go:61, operator_queue.go:59); retain scoping semantics documented in-code and load-bearing | S:70 R:65 A:85 D:70 |

8 assumptions (2 certain, 5 confident, 1 tentative, 0 unresolved).
