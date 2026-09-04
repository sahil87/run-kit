# Intake: sseHub Race Fixes + Wake on Cold Subscribe

**Change**: 260904-jjda-ssehub-races-cold-subscribe-wake
**Created**: 2026-09-04

## Origin

One-shot `/fab-new` invocation executing Change B of an authored plan:

> Daemon reliability - Change B: sseHub race fixes + wake on cold subscribe. Read and follow fab/plans/sahil/26-09-04-daemon-blocking-reliability.md, Change B section (B.1-B.3) exactly. Files: app/backend/api/sse.go, app/backend/api/tmuxctl_bridge.go (+tests). Add or keep -race coverage on touched packages. Re-verify all line numbers against current HEAD before editing - plan numbers are as of fd16e6b4.

The plan (`fab/plans/sahil/26-09-04-daemon-blocking-reliability.md`) is the design authority for this change — it was authored from a live incident diagnosis (2026-09-04) plus two code audits. Change B is one of six changes; it is in Wave 1 (parallel, disjoint files) and is a prerequisite for Change C (structural `poll()` rework, same file — **out of scope here**). The plan's stance: **B is surgical, C is structural.**

All plan line numbers are as of `fd16e6b4`. At intake time they were spot-verified against current HEAD `b53e0cad` (only docs/chore commits in between — every cited structure confirmed present, minor drift of a few lines). Apply MUST re-verify against its own HEAD before editing.

## Why

During the 2026-09-04 incident, the daemon's SSE layer showed two distinct failure classes that this change owns:

1. **Crash-class data races.** The `sseHub` cache map and the `subscriber` field are accessed from multiple goroutines with inconsistent synchronization. A detected concurrent map read/write is a Go runtime **throw** — the entire daemon process dies, taking every dashboard client with it. This is latent today and can fire under exactly the load the incident produced (poll ticks racing subscribe/preview-scope handlers and the dead-server reap).

2. **Cold-subscribe staleness.** A newly subscribed server can wait out the full `safetyPollInterval = 12s` before its first snapshot, because nothing wakes the parked poll loop when a subscriber arrives for a server not in the previous poll set. The user sees the switch mask ("waiting logo") hang for seconds on tab navigation — one of the incident's headline symptoms.

If unfixed: the daemon remains one unlucky interleaving away from a hard crash, and cold navigation to a not-recently-polled server stays visibly slow. Change C (bounded-concurrency poll rework) rebases on this change, so landing B first keeps C's structural diff clean.

The plan's review question for this change: *is every `h.cache` access now under a consistent lock, and does a cold subscribe get a snapshot promptly without waking storms?*

## What Changes

Three fixes, exactly per plan § Change B (B.1–B.3). Files: `app/backend/api/sse.go`, `app/backend/api/tmuxctl_bridge.go`, plus tests.

### B.1 — `h.cache` unsynchronized map access (daemon-killer)

`poll()` accesses `h.cache` (declared ~`sse.go:229`, `map[string]*cachedResult` — per-server session fetch cache, 500ms TTL) **without** holding `h.mu`:

- `delete(h.cache, server)` in the event-driven invalidation branch (~`:1416`)
- the cache read `if cached, ok := h.cache[server]` (~`:1420`)
- the cache write `h.cache[server] = &cachedResult{...}` (~`:1438`)

Handler goroutines access the same map **under** `h.mu`: `sendCachedPreviewLocked` (~`:1157`, reached from subscribe/preview-scope) and the dead-server reap `delete(h.cache, server)` (~`:1676`).

There is also a **value-level race**: `attachPRStatus` (~`:1459`) mutates the cached `WindowInfo` slice **in place** (documented as intentional in the comment block ~`:1447-1457` — `result` and `h.cache[server].data` are the same slice) while handler goroutines read that data via `sendCachedPreviewLocked`.

**Fix**: consistent locking — bring `poll()`'s map accesses and the `attachPRStatus` in-place mutation under `h.mu` (or the equivalent: hand copies out of the poll goroutine). The plan offers "move cache ownership entirely into the poll goroutine" as an alternative; the surgical-vs-structural split (B vs C) steers toward consistent locking here, leaving ownership restructuring to Change C. Keep lock hold times minimal — do NOT hold `h.mu` across `FetchSessions` (a subprocess exec, up to 10s): lock only around the map/value accesses.

### B.2 — `subscriber` field race

`s.sseHub.subscriber = sub` is a plain write in `SetWindowChangeSubscriber` (`tmuxctl_bridge.go:209`), racing `poll()`-side plain reads (`safetyIntervalEffective` ~`sse.go:384,393`, `waitForNext` ~`:1869,1871`).

**Fix**: per plan — "set before the hub starts or guard it." Either guarantee the write happens-before the poll goroutine starts (note: `initSSEHub` is invoked from `SetWindowChangeSubscriber` itself, but the hub can also be materialized earlier by a client connect, so pure ordering is fragile), or guard the field (read/write under `h.mu`, or an atomic). Apply picks the mechanism after re-verifying the hub start path; the guard must cover **all** reader sites.

### B.3 — cold subscribe waits out the 12s safety timer

`stateSubscribe`/`addClient` never call `h.wake(key)` — all existing wake call sites are mutation handlers (`/options`, web-tab verbs, `/api/servers/wake`, etc.). If `poll()` is parked in `waitForNext` (~`:1859`) on the *previous* server list, a newly subscribed server's first snapshot waits up to `safetyPollInterval = 12s` (`sse.go:80`; coverage gate `safetyIntervalEffective` ~`:380-405`).

**Fix**: in the subscribe ack path (~`:723-745`, where the handler reads `h.previousJSON[key]` under `h.mu` to build the ack snapshot) — when no `previousJSON[key]` exists (cold server: ack carries `null`), call `h.wake(key)` for that server so the parked loop re-derives its server list and produces the first snapshot promptly. The no-cached-snapshot condition is the storm guard: a warm resubscribe (snapshot present) does not wake. Note `wake()`'s existing new-entry gating (entry allocated only when `h.clients[server]` is non-empty — see memory `run-kit/api-and-sockets` § Hub wakes gate new-entry allocation) is satisfied here: `addClient` has already registered the subscription before the ack path runs.

### Tests + `-race`

- Regression tests for B.1/B.2: concurrent exercise of poll-side and handler-side cache access (and subscriber set vs. poll reads) that fails under `-race` before the fix.
- Test for B.3: hub parked in `waitForNext`, new subscription for an uncovered server → first snapshot arrives promptly (not after the safety interval); warm resubscribe does not wake.
- **`-race` coverage in CI scope**: no `-race` exists anywhere today (`just test-backend` → `go test ./...`; CI runs `just test-backend`). Add `-race` for the touched package (`app/backend/api`) — plan: "Run B's tests with `-race` in CI scope for this package if not already." Exact vehicle (targeted `go test -race ./api/...` step vs. race-enabling the whole backend recipe) decided at apply; targeted is the plan's stated minimum. <!-- assumed: -race vehicle — plan mandates CI-scope -race for this package but not the invocation shape -->

## Affected Memory

- `run-kit/api-and-sockets`: (modify) SSE hub freshness contract — cold subscribe now wakes the poll loop (the "waits for the 12s safety poll" statements gain the subscribe-time wake path); cache/subscriber locking contract as a Design Decision if the hydrate judges it spec-level
- `run-kit/daemon-lifecycle`: (modify) only if the `SetWindowChangeSubscriber` wiring guarantee changes shape (B.2); likely a one-line touch or nothing

## Impact

- **Code**: `app/backend/api/sse.go` (poll loop locking, subscribe-ack wake), `app/backend/api/tmuxctl_bridge.go` (subscriber write guard), `app/backend/api/*_test.go` (new/extended tests), possibly `justfile`/`.github/workflows/ci.yml` (the `-race` step).
- **Behavior**: no API surface change; no new endpoints; latency improvement on cold subscribe (first snapshot ≤ one poll pass instead of up to 12s); crash-class races eliminated.
- **Concurrency contract**: `h.mu` becomes the consistent guard for `h.cache` (and the subscriber field, if that mechanism is chosen). Lock hold times must stay small — never across `FetchSessions`/`capturePreviews` execs.
- **Downstream**: Change C rebases on this change (same file). Keep the diff surgical to minimize C's rebase burden.
- **Constitution**: Principle II untouched (the 500ms cache is an existing, justified in-memory cache; this change only synchronizes it). Test Integrity: tests verify the spec'd behavior (plan § B), not fixtures.

## Open Questions

- None — the plan section is prescriptive; remaining choices (locking shape for B.2, `-race` vehicle) are graded assumptions apply decides and records.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly plan Change B (B.1–B.3); Change C's structural `poll()` rework is out of scope | Plan explicitly sequences C after B merges ("B is surgical, C is structural"); user said "Change B section exactly" | S:95 R:90 A:95 D:95 |
| 2 | Certain | B.3 mechanism: wake `h.wake(key)` from the subscribe-ack path when `previousJSON[key]` is absent | Plan prescribes this exact fix and call site | S:90 R:85 A:90 D:90 |
| 3 | Certain | Apply re-verifies all plan line numbers against its HEAD before editing | User instruction; verified at intake against b53e0cad — structures confirmed, minor drift | S:95 R:95 A:95 D:95 |
| 4 | Confident | B.1 via consistent `h.mu` locking (poll-side map ops + `attachPRStatus` mutation under lock), not cache-ownership restructuring | Plan offers both; surgical-vs-structural split reserves restructuring for C; lock never held across execs | S:70 R:75 A:80 D:65 |
| 5 | Confident | B.2 via guarding the `subscriber` field (under `h.mu` or atomic) rather than relying on set-before-start ordering alone | Hub can be materialized by an early client connect, so ordering is fragile; plan allows either; final mechanism picked at apply after re-verifying the start path | S:65 R:80 A:75 D:60 |
| 6 | Confident | Cold-only wake is the storm guard: warm resubscribes (snapshot present) never wake | Derived from the plan's review question ("without waking storms"); the ack path already distinguishes the two cases | S:70 R:80 A:80 D:70 |
| 7 | Confident | `-race` added targeted to the touched package in CI scope (`go test -race` over `app/backend/api` at minimum); exact invocation shape decided at apply | No `-race` exists today anywhere in justfile/scripts/CI; plan mandates CI-scope `-race` "for this package" | S:70 R:85 A:80 D:65 |

7 assumptions (3 certain, 4 confident, 0 tentative, 0 unresolved).
