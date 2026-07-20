# Intake: Hub Wake Seam for Option Mutations

**Change**: 260718-xpur-hub-wake-option-mutations
**Created**: 2026-07-18

## Origin

Promptless dispatch (`/fab-proceed` create-intake, `{questioning-mode} = promptless-defer`) from a user conversation that diagnosed the root cause in code and approved the fix this session:

> Fix 5–10s latency applying session/window row colors — add a hub wake seam so user-option mutations trigger an immediate state-socket snapshot rebuild.

Key conversation decisions (user-approved):

- **Implement the root-cause backend fix ONLY** — a hub wake seam (e.g. `sseHub.wake(server)`) called from the two option-mutation handlers after a successful tmux write.
- **Explicitly rejected**: a frontend optimistic update — user said "Don't do the optional polish, just the wake seam." An optimistic update would mask only the local tab and leave every other surface (other tabs, boards, session tiles) lagging. No frontend changes are in scope.
- Constraints surfaced: wake must be per-server (`serverFromRequest(r)`), non-blocking from the HTTP handler, must not busy-loop or break the existing event-driven/safety-net select semantics, and new behavior must include Go tests.

## Why

**The pain point**: applying a color to a sidebar session/window row takes 5–10 seconds to render. The picker POSTs, closes, and the row sits unchanged long enough that users re-click, assuming the action failed.

**The causal chain** (each link verified in code this session):

1. The frontend color picker POSTs (`setSessionColorApi` / `setWindowColorApi`, `app/frontend/src/app.tsx:2911`/`:2915`) and closes; there is no optimistic update — the row repaints only when the next state-socket snapshot carries the new `@color`/`@session_color` tmux option.
2. The backend snapshot poll loop is event-driven: `waitForNext` (`app/backend/api/sse.go:1454`) blocks until a tmux control-mode notification bumps a per-server generation counter (via the tmuxctl subscriber's `Wait(server, after)` channels), with a safety-net timer backstop of **12s** (`safetyPollInterval`, `sse.go:74`) when the server is covered by a control-mode client — the normal production case. (Uncovered servers poll at the 2.5s `legacyPollInterval`.)
3. tmux emits **no control-mode notification for user-option changes** — `set-option @color`/`@session_color` is invisible to the tmuxctl parser, which handles only session/window add/close/rename/active-window/layout events.
4. Neither mutation handler pokes the hub after writing: `handleWindowOptions` (`app/backend/api/windows.go:389` — `@color`/`@rk_url`/`@rk_type` via `POST /api/windows/{windowId}/options`) and `handleSessionColor` (`app/backend/api/sessions.go:86` — `POST /api/sessions/{session}/color`) both perform the tmux write and return `{"ok": true}`.
5. Net effect: the color lands on the next safety tick — uniformly 0–12s after the click, mean ~6s, matching the reported 5–10s.

**If we don't fix it**: every user-option mutation surface (`@color`, `@session_color`, and the `@rk_url`/`@rk_type` mutations through the same `/options` endpoint) keeps this perceived-broken lag, and pressure builds toward per-surface frontend patches that mask rather than fix.

**Why this approach over alternatives**: one backend wake seam repaints **every** consumer — sidebar rows, session tiles, boards, other tabs — within one poll pass, and covers `@rk_type`/`@rk_url` mutations for free. The rejected alternative (frontend optimistic update) fixes only the mutating tab and leaves the actual staleness in place.

## What Changes

### 1. `sseHub.wake(server)` — per-server wake seam (`app/backend/api/sse.go`)

New hub state and method:

```go
// sseHub fields (alongside subscriber/safetyInterval)
wakeMu sync.Mutex
wakes  map[string]chan struct{} // per-server wake signal; closed = wake pending

// wake marks the server for an immediate snapshot pass. Non-blocking and safe
// from any goroutine; called by mutation handlers after a successful tmux write.
func (h *sseHub) wake(server string) {
	h.wakeMu.Lock()
	defer h.wakeMu.Unlock()
	ch, ok := h.wakes[server]
	if !ok {
		ch = make(chan struct{})
		h.wakes[server] = ch
	}
	select {
	case <-ch: // already closed — a wake is already pending; coalesce
	default:
		close(ch)
	}
}
```

Semantics:

- **Non-blocking from HTTP handlers** — `wake` never waits on the poll loop; it flips a signal and returns.
- **Per-server** — keyed by `serverFromRequest(r)`, never global. A wake for a server with no connected clients (not in the poll set) is a harmless no-op.
- **Coalescing, at-least-once** — N wakes before consumption trigger 1..N rebuild passes; redundant passes are harmless (the `previousJSON` dedup suppresses no-change broadcasts).
- **Close-based signal channels** (not buffered-token sends) — chosen to match the existing select machinery; see § 2 and Assumptions #3.

### 2. `waitForNext` / `selectFirst` integration (`sse.go:1454`–~1530)

- `waitForNext` builds a wake wait-case for every polled server **alongside** the subscriber cases and **independent of `h.subscriber`** — wake must work when `subscriber == nil` (unit-test hubs, PTY-unavailable hosts), where today the code short-circuits to a timer-only wait.
- **Why close-based channels are required**: `selectFirst`'s fan-in goroutines and `waitForNext`'s non-blocking "peek" loop over non-winning cases both re-read the same channel and rely on fired-channels-stay-readable (subscriber `Wait` channels fire by close). A buffered-token (send-based) wake channel breaks this: a fan-in goroutine can consume the token for a case that doesn't win, silently losing the wake.
- **Consumption contract** — when a wake case is observed fired (as the winner or in the peek loop), `waitForNext` must:
  - (a) **replace** the server's closed channel with a fresh open one (under `wakeMu`) *before* the next fetch pass runs. This gives at-least-once semantics: a wake landing between observation and fetch closes the fresh channel and triggers one more pass — never lost, and never a busy-loop (the closed channel is retired the moment it is observed).
  - (b) mark `eventDrivenServers[server] = true` so `poll()` invalidates that server's 500ms fetch cache (`sseCacheTTL`, `sse.go:99`; invalidation at `sse.go:1183`). Without this the woken pass can serve a <500ms-old **pre-mutation** cached fetch and the fix silently degrades to the safety tick.
- Wake cases must **not** enter the subscriber bookkeeping: the peek loop calls `h.subscriber.Generation(c.server)` for fired cases — wake cases skip `perServerGen` updates entirely (and must not nil-panic when `subscriber == nil`). Tag the wait cases (or keep wake cases in a parallel list) so the two kinds are distinguished.
- Everything else is preserved byte-for-byte in behavior: subscriber wins still update `perServerGen`, the timer path is unchanged, `safetyIntervalEffective`/`Covers` are untouched, and the tmuxctl bridge (`app/backend/api/tmuxctl_bridge.go`) is not modified — `supervisorSubscriber.Wait`'s deliberate never-closing `neverChan()` contract for uncovered servers stays exactly as is.

### 3. Call sites — the two option-mutation handlers

Both follow the established `initSSEHub`-then-hub-call pattern (`handleSessionOrderPost`, `sessions.go:171–172`):

- **`handleWindowOptions`** (`app/backend/api/windows.go:389`): after a successful `s.tmux.SetWindowOptions(ctx, windowID, server, ops)` and before `writeJSON`, add `s.initSSEHub(); s.sseHub.wake(server)`. Covers `@color`, `@rk_url`, `@rk_type` via `POST /api/windows/{windowId}/options`.
- **`handleSessionColor`** (`app/backend/api/sessions.go:86`): after a successful `SetSessionColor`/`UnsetSessionColor`, same two lines. Covers `@session_color` via `POST /api/sessions/{session}/color`.
- No wake on validation failure or tmux error (the handlers return early). Response bodies are unchanged (`{"ok": true}`) — no API contract change.

### 4. Tests (Go, alongside code per `fab/project/code-quality.md`)

New/extended `*_test.go` in `app/backend/api` (`sse_subscriber_test.go` already exercises the wait loop with a short per-hub `safetyInterval` — reuse that harness):

- `wake(server)` triggers a snapshot rebuild well before the safety interval (short-`safetyInterval` hub; assert broadcast arrives promptly after wake).
- Wake works with `subscriber == nil` (the timer-only path today).
- Wake for a server with no clients / unknown server is a safe no-op.
- Coalescing/no-busy-loop: multiple wakes before a pass produce bounded fetches (assert fetch count does not spin after the wake is served).
- Wake invalidates the poked server's fetch cache: a mutation is visible in the woken pass despite a <500ms-old cached fetch.
- Handler seam: successful `POST .../options` and `POST .../color` wake the request's server; failed validation does not.

Run via `just test-backend`.

### Non-Goals

- No frontend changes — the optimistic update was explicitly rejected by the user.
- No new tmux polling, no change to the 12s/2.5s cadences, no tmuxctl parser or `supervisorSubscriber` changes.
- No new endpoints; request/response contracts unchanged.

## Affected Memory

- `run-kit/architecture`: (modify) state-socket/SSE hub description gains the wake seam — user-option mutations (`@color`/`@session_color`/`@rk_url`/`@rk_type`) now trigger an immediate snapshot pass via `sseHub.wake(server)` instead of waiting for the 12s safety tick.

## Impact

- `app/backend/api/sse.go` — hub state + `wake()` + `waitForNext`/`selectFirst` integration (the core of the change).
- `app/backend/api/windows.go` — `handleWindowOptions` wake call (2 lines).
- `app/backend/api/sessions.go` — `handleSessionColor` wake call (2 lines).
- `app/backend/api/*_test.go` — new tests as above.
- No frontend files, no `internal/tmuxctl`, no API surface change. Expected user-visible effect: color-apply latency drops from 0–12s (mean ~6s) to one poll pass (sub-second — the tmux write has already landed when the wake fires; the pass is a fetch + broadcast).

## Open Questions

(none — all decisions were resolved in the originating conversation or by code inspection; see Assumptions)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Backend-only wake seam; no frontend optimistic update | User explicitly decided: "Don't do the optional polish, just the wake seam" — rejected alternative recorded in Origin | S:95 R:90 A:95 D:95 |
| 2 | Certain | Wake is per-server (`serverFromRequest(r)`), never global | User-stated constraint; matches the hub's per-server poll-set architecture | S:90 R:85 A:90 D:90 |
| 3 | Confident | Wake mechanism = close-based per-server signal channels (close = pending, consumer replaces on observation), not buffered-token sends | User said "e.g. … per-server wake channel" leaving mechanics open; code inspection shows `selectFirst` fan-in + the peek loop assume fired-channels-stay-readable (subscriber `Wait` fires by close) — a send token can be consumed by a non-winning fan-in goroutine and lost | S:70 R:80 A:85 D:65 |
| 4 | Confident | A consumed wake marks `eventDrivenServers[server] = true` to invalidate the 500ms fetch cache | Derived from `poll()` at `sse.go:1183` — the existing subscriber-win semantics; without it the woken pass can serve a pre-mutation cached fetch | S:65 R:80 A:85 D:75 |
| 5 | Confident | `waitForNext` builds wake cases independent of `h.subscriber` (wake works when subscriber is nil) | Code inspection: current nil-subscriber path is timer-only; test hubs and PTY-unavailable hosts must still honor wakes; peek-loop `Generation()` calls must be guarded for wake cases | S:60 R:80 A:85 D:75 |
| 6 | Certain | Call sites are exactly `handleWindowOptions` + `handleSessionColor` | User-approved: "Call it from the mutation handlers after a successful tmux write: handleWindowOptions and handleSessionColor"; other mutations (rename/kill/create/move) already emit control-mode notifications | S:80 R:85 A:85 D:80 |
| 7 | Certain | Wake fires after the successful tmux write, before writing the 200 response, via `s.initSSEHub(); s.sseHub.wake(server)` | Deterministic from the codebase — mirrors the established `handleSessionOrderPost` pattern (`sessions.go:171–172`) | S:75 R:95 A:90 D:85 |
| 8 | Certain | New behavior ships with Go tests alongside the code, run via `just test-backend` | User-stated constraint + `code-quality.md` mandate ("New features and bug fixes MUST include tests"); `sse_subscriber_test.go` harness already exists | S:85 R:90 A:95 D:90 |
| 9 | Confident | Memory impact is a single modify to `run-kit/architecture` (no new memory file) | The wake seam is a freshness-contract detail of the already-documented state-socket/SSE hub section; too small for its own file | S:60 R:85 A:80 D:70 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
