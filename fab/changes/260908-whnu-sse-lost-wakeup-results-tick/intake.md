# Intake: Fix SSE hub lost-wakeup: pending event-driven dispatch swallowed by results-only tick

**Change**: 260908-whnu-sse-lost-wakeup-results-tick
**Created**: 2026-09-09

## Origin

Promptless dispatch (`/fab-proceed` create-new path), synthesized from a live-daemon diagnosis conversation. The description below is the sole source; the diagnosis already isolated root cause, exonerated two suspects, and fixed the remedy shape.

> After `rk riff` (or any external tmux window switch), the terminal view follows tmux instantly (attach semantics) but the sidebar highlight and URL stay on the old tab for up to ~12–14s, so palette/compose input targets the stale route window. Reproduced against the live daemon (v3.19.30) with a headless-Playwright probe parked on the active window of a scratch session while an external `tmux new-window` ran: 18/20 trials the sidebar row and URL followed in ~450–600ms; 2/20 trials both stalled together (5.7s and 14.2s) — i.e. NO sessions snapshot reached the browser at all until the safety poll healed it.

**Type**: fix

## Why

1. **Pain point**: after `rk riff` or any external tmux window switch, the terminal view follows tmux instantly, but the sidebar highlight and the URL can stay on the old tab for up to ~12–14s. During the stall, palette/compose input targets the stale route window — a correctness hazard, not just a cosmetic lag.
2. **Consequence of not fixing**: a classic lost wakeup remains latent in the SSE hub. Reproduction against the live daemon (v3.19.30, headless-Playwright probe parked on the active window of a scratch session while an external `tmux new-window` ran) showed 2/20 trials where NO sessions snapshot reached the browser at all (5.7s and 14.2s stalls) until the 12s safety-net poll healed it; the other 18/20 followed in ~450–600ms. riff hits the race disproportionately because its spawn burst (new-window → split-window → select-layout → select-pane, plus agent-state churn) lands control-mode events mid-poll-unit.
3. **Why this approach**: the diagnosis exonerated the other suspects — the frontend URL-writeback in `app/frontend/src/app.tsx` (tmux-truth-wins design works: when snapshots arrive, the URL follows in <600ms) and the tmuxctl Tier-1 active-window tracker (`internal/tmuxctl`, REST `isActiveWindow` flips within 28ms of the tmux event). The stall is entirely the hub's dispatch scheduling, so the fix is a one-condition change at the fold-only gate, preserving the join-free poll-tick design's no-self-perpetuation property.

Note: the separate 40–64s tmux server wedge on `split-window` (pane-border `#()` fork storm) was already fixed by PR #879 (v3.19.31); this change addresses the remaining stall.

## What Changes

### Root cause (context for the fix — `app/backend/api/sse.go`)

`waitForNext`'s peek consumes the control-mode generation bump: it updates `perServerGen[server] = sub.Generation(server)` and sets `eventDrivenServers[server] = true` (sse.go ~line 2318–2319). But the next dispatch pass skips that server when its poll unit is still in flight (`pollInFlight[server]`, single-flight skip at ~line 1685) or when the `pollSem` concurrency bound is reached (~line 1690). The pending `eventDrivenServers` flag is deliberately retained for a later dispatch — but the unit-completion "results wake" is fold-only:

```go
// sse.go ~line 2344 (current)
resultsOnly = results && !bumped && !woke && !timerFired
```

and a results-only tick skips dispatch entirely (`if !resultsOnly { … dispatch … }` at ~line 1669). With the event's wake already consumed — the next `Wait(after)` is armed at the updated generation — nothing re-dispatches the pending flag until the 12s safety-net timer. A classic lost wakeup.

### Fix: pending event-driven flags keep a results tick dispatch-worthy (`app/backend/api/sse.go`)

Include the pending set in the fold-only condition:

```go
// sse.go ~line 2344 (fixed)
resultsOnly = results && !bumped && !woke && !timerFired && len(eventDrivenServers) == 0
```

so the unit-completion wake — exactly the moment the in-flight skip clears — triggers a full tick that dispatches the retained flag with its cache invalidation.

**No self-perpetuation**: `eventDrivenServers` entries are consumed at dispatch (`delete(eventDrivenServers, server)` before `go h.runPollUnit(...)`, ~line 1703) and only re-set by real generation bumps/wakes, so a results-only wake with an empty pending map stays fold-only exactly as today. The join-free design's anti-self-perpetuation rationale (dispatch → complete → results wake → dispatch …) is preserved: the loop can only re-dispatch while a genuine un-serviced event is pending.

The surrounding doc comments that state the fold-only contract (`waitForNext`'s `resultsOnly` return doc ~line 2227–2232, the peek's `isResults` comment ~line 2299–2304, and the pre-`resultsOnly` comment ~line 2340–2343) must be updated to state the amended condition — a results-only tick is fold-only *only when no event-driven flags are pending*.

### Test: race coverage for the in-flight bump (`app/backend/api/sse_race_test.go`)

Add coverage in `app/backend/api/sse_race_test.go` (the existing race-test home) simulating a generation bump landing while the server's poll unit is in flight, asserting the follow-up broadcast arrives promptly after the unit completes — rather than only after the safety timer.

### Explicitly out of scope (exonerated by the diagnosis — do not change)

- `app/frontend/src/app.tsx` URL-writeback (tmux-truth-wins design works)
- `internal/tmuxctl` Tier-1 active-window tracker (flips within 28ms)

## Affected Memory

- `run-kit/api-and-sockets`: (modify) the /ws/state hub's "Join-free poll tick: async per-server units + fold-at-tick-top + results wake" design decision — its "a wait ended solely by unit completions yields a results-only tick that folds without dispatching" contract gains the pending-flag exception (a results tick with pending `eventDrivenServers` entries dispatches), and the lost-wakeup rationale is recorded. This file owns the SSE hub poll-loop contract (verified: the Join-free poll tick DD lives in `docs/memory/run-kit/api-and-sockets.md`).

## Impact

- **Code**: `app/backend/api/sse.go` — one condition at the `resultsOnly` computation in `waitForNext` (~line 2344) plus the doc comments stating the fold-only contract. No API surface, no frontend, no new state.
- **Tests**: `app/backend/api/sse_race_test.go` — one new race test (bump-lands-mid-unit → prompt post-completion broadcast).
- **Behavioral blast radius**: only the scheduling of already-pending event-driven dispatches changes (they fire at unit completion instead of the 12s safety timer). Steady-state tick cadence, debounce behavior, and the empty-pending results-only fold path are unchanged.
- **Systems**: fixes the remaining post-riff sidebar/URL stall (the tmux-wedge half was PR #879, v3.19.31).

## Open Questions

- (none — the diagnosis fixed the remedy, the test home, and the exoneration boundaries; no decision points scored Unresolved)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix is exactly the fold-only condition amendment: `resultsOnly = results && !bumped && !woke && !timerFired && len(eventDrivenServers) == 0` in `waitForNext` | Given verbatim in the diagnosis, and verified against current sse.go (~line 2344): `eventDrivenServers` is loop-owned, consumed-at-dispatch, so the condition is race-free and non-self-perpetuating | S:95 R:85 A:95 D:95 |
| 2 | Certain | New race test lives in `app/backend/api/sse_race_test.go`, simulating a bump landing while the server's unit is in flight and asserting a prompt post-completion broadcast | Test home and scenario stated explicitly in the description; file exists and is the established race-test home | S:95 R:90 A:90 D:95 |
| 3 | Certain | Frontend URL-writeback (`app/frontend/src/app.tsx`) and `internal/tmuxctl` active-window tracker are untouched | Explicitly exonerated by the diagnosis with measured evidence (<600ms follow, 28ms flip) | S:95 R:90 A:95 D:95 |
| 4 | Confident | Affected memory is `run-kit/api-and-sockets` (not `architecture`) — the description left this fork open ("whichever file owns the SSE hub poll loop contract") | Resolved by inspection: the "Join-free poll tick" Design Decision and the `resultsOnly` contract live in `docs/memory/run-kit/api-and-sockets.md`; `architecture.md` defers API/sockets to it | S:70 R:90 A:90 D:80 |
| 5 | Confident | The fold-only doc comments in sse.go (waitForNext's `resultsOnly` return doc, the peek `isResults` comment, the pre-computation comment) are updated to state the amended condition | The comments currently assert the exact invariant the fix amends; leaving them stale would contradict the code. Comment scope, easily adjusted at apply | S:60 R:95 A:90 D:85 |
| 6 | Confident | Memory update amends the existing "Join-free poll tick" DD entry rather than adding a parallel DD | The pending-flag exception refines that entry's own contract sentence; FKF present-truth style favors amending the owning decision. Hydrate-stage detail, cheap to redo | S:55 R:90 A:85 D:75 |
| 7 | Confident | Test mechanics (how the in-flight unit is held open — e.g. a blocking fetcher or pollSem occupancy) are decided at apply using the existing `sse_race_test.go` harness patterns | Standard decide-and-record territory: the assertion contract is fixed by the description, only the simulation plumbing is open, and the existing race tests supply the pattern | S:65 R:90 A:80 D:70 |

7 assumptions (3 certain, 4 confident, 0 tentative, 0 unresolved).
