# Intake: Status Refresh Feedback

**Change**: 260715-nwla-status-refresh-feedback
**Created**: 2026-07-15

## Origin

Created via `/fab-proceed` promptless dispatch from a live conversation about a user-reported feedback gap in the just-merged Manual Status Refresh feature (change `260715-jykd-manual-status-refresh`, PR #358, now on main). The conversation diagnosed the root cause, weighed alternatives, and the user explicitly chose the scope: "1+2 with 3 included" — (1) a server-global SSE completion event driving honest button feedback, (2) a distinguished 202 body (`started`/`coalesced`/`throttled`), and (3) freshness surfacing ("PR checked Xs ago") in the StatusDotTip hover card. No questions were asked (promptless contract); every decision point is recorded as a graded assumption in `## Assumptions`.

> Clicking the PANE-header refresh button gives no perceptible indication that anything is happening or that anything updated. The spinner is tied to the POST, which returns 202 in milliseconds by design; the real gh work runs 1–10s in a detached goroutine and lands via SSE with nothing connecting it to the click. Add the honest in-progress + completion signal (server-global SSE event), distinguish throttled clicks (tri-state 202 body), and surface PR freshness ambiently (checked-Xs-ago in the hover card).

## Why

**The problem.** The shipped Manual Status Refresh design (jykd) is deliberately fire-and-forget: `POST /api/status/refresh` returns `202 {"status":"refreshing"}` in milliseconds, and the two poller passes (viewer collector + branch refresher, both `gh` calls) run 1–10s in a detached goroutine (`app/backend/api/status_refresh.go`), with fresh data reaching clients via the existing SSE stream. The PANE-header refresh button (`PaneRefreshButton` in `app/frontend/src/components/sidebar/status-panel.tsx`) sets `busy` on click and clears it when the POST settles — so the spinner is a ~50ms blink. Updated dots land seconds later with nothing connecting them to the click. Two signals are missing: "something is happening" and "something finished — you're current". Additionally, throttled/coalesced clicks are indistinguishable from started ones (all return the identical 202 body), so a user who clicks during the 10s throttle window gets the same blink and nothing else, ever.

**Consequence if unfixed.** The feature reads as broken. Users click, see a blink, see nothing change (correctly — PR state often didn't change), and conclude the button does nothing. The honest work the backend does is invisible.

**Why this approach.** The exact completion seam already exists: `finishStatusRefresh()` (`status_refresh.go:79`) runs at the end of the detached goroutine — broadcasting a server-global SSE event there is a natural fit for the established `event: server-order`/`board-order`/`version`/`update-available` broadcast pattern in `app/backend/api/sse.go`. The tri-state body is purely additive: `startStatusRefresh()` (`status_refresh.go:62`) already computes the started/coalesced/throttled distinction internally and collapses it to a bool. Freshness display costs nothing new: `PRStatus.FetchedAt` (`app/backend/internal/prstatus/prstatus.go:50`) is already stamped on every collector rebuild — it just isn't plumbed into the window payload. Rejected alternatives:

- **Minimum-spin-duration hack** (a hardcoded ~2.5s spin, no backend change) — rejected as dishonest: doesn't track the real refresh, provides no completion or throttle signal.
- **Toasts and StatusDot flash-on-change** — rejected as invasive; the button checkmark suffices. If PR state didn't change, dots staying identical is correct — the checkmark says "refresh completed, you're current" without pretending anything changed.

This deliberately revisits the jykd intake's "client never distinguishes started/coalesced/throttled" decision (jykd intake, What Changes + Assumption 4). That decision predates observing the UX gap; the change is purely additive (same 202, same fire-and-forget, richer body).

## What Changes

### 1. Server-global SSE completion event (backend + frontend)

**Backend.** Broadcast a server-global SSE event when the detached refresh pass completes. The seam is `finishStatusRefresh()` (`app/backend/api/status_refresh.go:79`), called at the end of the detached goroutine after both poller passes. Event shape:

```
event: status-refresh
data: {"completedAt":"2026-07-15T10:23:41Z"}
```

Follow the established server-global broadcast pattern in `app/backend/api/sse.go` — existing precedents: `event: server-order` (`broadcastServerOrder`, sse.go:501), `event: board-order`, `event: version`, `event: update-available`. These fan out to EVERY registered client including `?metrics=1` streams. Whether this event needs replay-on-connect (a cached slot like `cachedServerOrderJSON`) or is broadcast-only is an apply-time decision — broadcast-only is the front-runner since part 3 covers freshness display independently, so a late-connecting client loses nothing.

**Frontend.** The PANE-header refresh button spins from click until the `status-refresh` event arrives (NOT until the POST settles), with a timeout fallback: the backend's detached pass is bounded by `statusRefreshTimeout` = 60s (`app/backend/api/router.go:38`); a shorter practical UI fallback of ~15–20s is acceptable — apply decides the exact value. On event arrival (or fallback), the spinner clears.

**Post-completion feedback.** After the SSE event clears the spinner, show a brief checkmark on the button ("done — you're current"). This closes the "refresh completed ≠ anything changed" loop honestly without toasts or dot-flashing.

The palette action (`PR: Refresh Status`, pure builder `app/frontend/src/lib/palette-status-refresh.ts`) fires the same POST; whether it gains any feedback beyond the button's shared state is apply's call — the button is the primary surface.

### 2. Distinguished 202 body (backend + frontend)

**Backend.** `startStatusRefresh()` currently returns a bool that collapses coalesce and throttle; it already computes the distinction internally (in-flight check → coalesce; min-interval check → throttle). Change the response body to:

```
202 {"status": "started"}    — a new pass began; a status-refresh event will follow
202 {"status": "coalesced"}  — a pass is already in flight; ITS completion event will follow
202 {"status": "throttled"}  — nothing started (within statusRefreshMinInterval = 10s); NO event will come
```

All still 202; still fire-and-forget; no new endpoint (Constitution §IX satisfied — body change on the existing POST).

**Frontend behavior per status:**

- `started`: spin until the SSE completion event (part 1), then checkmark.
- `coalesced`: also spin — the in-flight refresh's completion event will arrive and clear it, then checkmark.
- `throttled`: nothing was started and no event will come — show a brief "already fresh" state (e.g. checkmark flash) instead of spinning. Without this branch a throttled click would spin until the timeout fallback.

### 3. Freshness surfacing — "PR checked Xs ago" (backend plumb + frontend display)

`PRStatus.FetchedAt` (`app/backend/internal/prstatus/prstatus.go:50`, stamped `now` on each collector rebuild at prstatus.go:167) already exists on the viewer collector snapshot. Plumb it through the SSE hub's URL-keyed collector join (`app/backend/api/sse.go:810-856` — the same place `w.PrChecks`, `w.PrReview`, `w.PrIsDraft` are set from `st`) onto the window payload: a new field on the `Window` struct (`app/backend/internal/tmux/tmux.go:~429`, alongside `PrChecks`/`PrReview`/`PrIsDraft`, e.g. `PrFetchedAt *time.Time \`json:"prFetchedAt,omitempty"\``), mirrored on the frontend `WindowInfo` type (`app/frontend/src/types.ts:91-96`).

Display it in the `StatusDotTip` hover card (`app/frontend/src/components/status-dot-tip.tsx`) as a relative "checked Xs ago" line on windows that have a PR join. After a manual refresh the timestamp visibly resets — the ambient version of the same trust signal, useful without clicking. Reuse the existing relative-time convention: `formatDuration` in `app/frontend/src/lib/format.ts` (Ns / Nm / Nh floor-division formatting) rather than adding a new formatter.

Reset semantics note: like `PrChecks`/`PrReview`, the field is collector-join-owned — reset alongside them in the join (sse.go:848) so a URL-miss window carries no stale timestamp.

### Testing

- **Backend** (`code-quality.md`: new behavior MUST include tests): extend `app/backend/api/status_refresh_test.go` using the existing injected seams (function fields on `api.Server`, injected clock `s.now`) — (a) tri-state body: started vs coalesced vs throttled responses, (b) broadcast-on-completion: the `status-refresh` event is emitted when the detached pass finishes (via the hub seam), (c) existing coalesce/throttle behavior unchanged. Extend the sse.go join tests for `FetchedAt` plumbing (hit sets it, miss resets it).
- **Frontend** (Vitest): button spin-until-event, throttled → checkmark flash without spin, post-completion checkmark, StatusDotTip renders the "checked Xs ago" line when `prFetchedAt` present and omits it when absent.
- **Playwright**: any `.spec.ts` changes require sibling `.spec.md` updates in the same commit (constitution, Test Companion Docs).

## Affected Memory

- `run-kit/architecture`: (modify) SSE server-global event list gains `event: status-refresh`; `POST /api/status/refresh` body contract becomes tri-state; `FetchedAt` plumbing through the collector join into the window payload
- `run-kit/ui-patterns`: (modify) PANE-header refresh button feedback states (spin-until-event, throttled checkmark flash, post-completion checkmark); StatusDotTip freshness line

## Impact

- `app/backend/api/status_refresh.go` — tri-state return from `startStatusRefresh()`, body change, completion broadcast call in the detached goroutine
- `app/backend/api/sse.go` — new server-global `status-refresh` broadcast (pattern: `broadcastServerOrder`); `FetchedAt` added to the collector join
- `app/backend/api/router.go` — no new routes (existing POST, existing constants)
- `app/backend/internal/tmux/tmux.go` — `PrFetchedAt` field on `Window`
- `app/backend/api/status_refresh_test.go`, sse join tests — extended
- `app/frontend/src/components/sidebar/status-panel.tsx` — `PaneRefreshButton` state machine (idle → spinning → checkmark; throttled short-circuit)
- `app/frontend/src/types.ts` — `prFetchedAt` on `WindowInfo`
- `app/frontend/src/components/status-dot-tip.tsx` — freshness line
- `app/frontend/src/api/client.ts` — `refreshStatus()` return type carries the tri-state body
- SSE event consumption in the frontend session-context/SSE layer (wherever `server-order`/`update-available` events are handled) — route `status-refresh` to the button state

Constraints honored: Constitution §IX (no new endpoints — body change + SSE event only); Constitution II (no new state stores — completion event is broadcast-from-memory, `FetchedAt` already exists); SSE not client polling (`code-quality.md` anti-patterns).

## Open Questions

- None blocking. Apply-time decisions (explicitly delegated in the conversation): replay-on-connect vs broadcast-only for the `status-refresh` event; exact UI timeout fallback duration (~15–20s); whether the palette action gains feedback beyond the button's shared state.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is parts 1+2+3 together (SSE completion event + tri-state 202 body + FetchedAt freshness line) | Discussed — user explicitly chose "1+2 with 3 included" | S:95 R:85 A:90 D:95 |
| 2 | Certain | Completion signal = server-global SSE `event: status-refresh` broadcast from `finishStatusRefresh()`, following the `server-order`/`board-order`/`version`/`update-available` pattern in sse.go | Discussed — seam and precedent named in conversation; codebase confirms both | S:90 R:80 A:90 D:90 |
| 3 | Certain | 202 body becomes tri-state `{"status": started/coalesced/throttled}` — same 202, same fire-and-forget, no new endpoint; deliberately revisits jykd's "client never distinguishes" (additive, predates the observed gap) | Discussed — user chose the tri-state body over keeping the opaque 202 | S:90 R:85 A:90 D:90 |
| 4 | Certain | Button spins click→event (not click→POST-settle); throttled shows checkmark flash instead of spinning; post-completion brief checkmark | Discussed — per-status behavior specified verbatim in conversation | S:90 R:85 A:90 D:90 |
| 5 | Certain | Rejected: minimum-spin-duration hack (dishonest) and toasts/dot-flashing (invasive) | Discussed — user rejected both; checkmark suffices | S:90 R:90 A:90 D:95 |
| 6 | Certain | Freshness = plumb existing `PRStatus.FetchedAt` through the sse.go collector join onto the window payload; display in StatusDotTip as relative "checked Xs ago" on PR-joined windows | Discussed — field exists (prstatus.go:50), join site verified (sse.go:810-856) | S:90 R:80 A:90 D:90 |
| 7 | Confident | `status-refresh` event is broadcast-only (no replay-on-connect cached slot) | Discussed as apply-time decision with broadcast-only the stated front-runner — part 3 covers freshness independently, so late connectors lose nothing; easily added later | S:70 R:85 A:80 D:70 |
| 8 | Confident | UI spinner timeout fallback ~15–20s (exact value apply's choice; backend bound is `statusRefreshTimeout`=60s) | Discussed — user stated the range is acceptable and delegated the exact value to apply | S:75 R:90 A:85 D:75 |
| 9 | Confident | Palette action fires the same POST and gains no dedicated feedback beyond the button's shared state | Discussed — delegated to apply with "the button is the primary surface"; trivially reversible | S:70 R:90 A:80 D:75 |
| 10 | Confident | Reuse `formatDuration` (`lib/format.ts`) for the "checked Xs ago" line rather than adding a new relative-time formatter | Conversation said "check lib/ before adding one"; verified `formatDuration` exists and matches the Ns/Nm/Nh convention | S:70 R:95 A:90 D:85 |
| 11 | Confident | `PrFetchedAt` is collector-join-owned: set on URL hit, reset alongside `PrChecks`/`PrReview`/`PrIsDraft` on miss (`sse.go:848`) | Codebase pattern is unambiguous — the three sibling fields already follow exactly this ownership rule | S:65 R:85 A:90 D:85 |
| 12 | Confident | Coalesced clicks spin too (the in-flight pass's completion event clears them) — no distinct "coalesced" visual | Discussed — specified in conversation; behaviorally indistinguishable from started for the user, which is honest | S:75 R:90 A:85 D:80 |

12 assumptions (6 certain, 6 confident, 0 tentative, 0 unresolved).
