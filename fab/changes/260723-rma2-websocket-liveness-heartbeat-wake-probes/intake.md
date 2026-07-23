# Intake: WebSocket Liveness — Heartbeat + Wake Probes for State Socket and Relay Mux

**Change**: 260723-rma2-websocket-liveness-heartbeat-wake-probes
**Created**: 2026-07-23

## Origin

Dispatched promptless via `/fab-proceed` from a user conversation that diagnosed the bug and explicitly approved the fix scope. Synthesized description (faithful capture — sole source):

> After a long break (laptop sleep / backgrounded tab), run-kit becomes unresponsive until a full page refresh. Symptom: switching windows "switches back" — the pending-switch confirmation machinery in `app/frontend/src/app.tsx` never receives state-socket confirmation, so after the 5s confirmation window `bouncePendingSwitch` bounces the URL back to the stale notion of the active window with a "Window switch didn't confirm" toast. The `selectWindow` POST itself succeeds (fresh HTTP connection — tmux really switches); only the push channels are dead.
>
> Root cause (verified in code): both per-tab WebSockets — `/ws/state` (`app/frontend/src/lib/state-socket.ts`, class `StateSocket`) and `/ws/terminals` (`app/frontend/src/lib/relay-mux.ts`, class `RelayMux`) — already have exponential-backoff reconnect (1s→15s and 1s→30s caps) that resubscribes/re-opens everything on reconnect. But reconnect triggers ONLY on `ws.onclose`. After machine sleep the TCP connection dies silently (half-open); `onclose` never fires; `readyState` stays OPEN; the socket is deaf forever. Nothing detects death: no ping/pong at any layer (the Go handlers `app/backend/api/state_ws.go` / `app/backend/api/terminals_ws.go` never send WebSocket pings and set no idle read deadline; the client has no app-level heartbeat), and no wake probes (zero `visibilitychange` / `online` / `pageshow` listeners in the frontend). A stale comment at `app/backend/api/sse.go:105` claims these sockets "handle keepalive + liveness at the WebSocket layer" — they don't.
>
> User explicitly approved scope items 1+2+3: (1) client heartbeat on `/ws/state` — client sends `{op:"ping"}` every ~30s, server replies `{op:"pong"}`, client tracks last-inbound-frame time (any frame counts), silence past ~2 intervals → force-close so the EXISTING reconnect path takes over; (2) wake probes on both sockets — on `visibilitychange`→visible / `online` / `pageshow`, ping-with-~3s-deadline if OPEN, and fire a pending reconnect timer immediately with backoff reset to base; (3) the same heartbeat + wake-probe treatment for the relay mux via a ping/pong JSON control op (no stream id), preserving the mux's deliberate idle-stays-closed behavior. Rejected: server-initiated protocol-level WS pings alone (browsers auto-answer them invisibly to JS — client-initiated app-level ping is required). Deferred (out of scope): item 4 — server-side idle read deadline + reaping of silent connections and the `sse.go:105` comment fix; item 5 — suppressing the 5s window-switch bounce timer while the state socket reports disconnected.

All code claims above were re-verified against the current tree during intake (file/line references confirmed; see Impact).

## Why

1. **Pain point**: after laptop sleep or a long-backgrounded tab, every push channel in run-kit is silently dead while claiming to be healthy. The most visible failure is the window switcher: the POST succeeds and tmux really switches, but the state socket never delivers the confirming event, so after `CONFIRMATION_WINDOW_MS` (5000ms, `app/frontend/src/app.tsx:401`) `bouncePendingSwitch` yanks the URL back and shows "Window switch didn't confirm — back to the active window" (`app.tsx:852`). Terminals likewise stop painting. The only user remedy is a full page refresh.

2. **Consequence of not fixing**: run-kit's core promise — a live dashboard you can leave open and return to — is broken for the single most common usage pattern (walk away, laptop sleeps, come back). Every return-from-sleep requires a manual refresh, and the switch-bounce actively fights the user's navigation.

3. **Why this approach**: both sockets already have complete, tested recovery machinery (exponential-backoff reconnect that re-subscribes every state subscription and transparently re-opens every terminal stream flicker-free). The ONLY missing piece is *detecting* that a half-open socket is dead so that machinery can run — `ws.onclose` never fires for a silently-dropped TCP connection while `readyState` stays `OPEN`. A client-initiated app-level heartbeat plus event-driven wake probes is the minimal detection layer that converts "deaf forever" into "reconnected within seconds of wake". Server-initiated protocol-level WS pings cannot solve this: browsers answer protocol pings in the network stack, invisibly to JS, so they detect death only server-side — the client would still trust its dead socket. Client-initiated application-level ping/pong is therefore required, and wake probes directly target the sleep/wake case while sidestepping background-tab timer throttling.

## What Changes

### 1. Client heartbeat on `/ws/state` (`app/frontend/src/lib/state-socket.ts`)

- While the socket is `OPEN`, `StateSocket` sends `{op:"ping"}` every ~30s (named constant, e.g. `HEARTBEAT_INTERVAL_MS = 30000`).
- Track a `lastInbound` timestamp updated on **every** inbound frame in `onmessage` — events, acks, `gone`, `error`, and the new `pong` all count. Pongs are not individually matched/correlated.
- Liveness check: when inbound silence exceeds ~2 intervals (named constant, e.g. `LIVENESS_TIMEOUT_MS = 2 * HEARTBEAT_INTERVAL_MS`), the socket is presumed half-open dead → **force-close** it so the existing `onclose` → `scheduleReconnect()` path (backoff 1s→15s cap, blind resubscribe of `subs`, chat re-composition by the owner hook) takes over unchanged.
- **Critical constraint**: `StateSocket.close()` sets `closed = true` permanently, nulls `ws.onclose`, and suppresses all reconnects (`state-socket.ts:145-157`). The liveness force-close MUST be a distinct internal path (e.g. a private `forceClose()`) that does **not** set `closed`, does **not** null `ws.onclose`, and closes the raw WebSocket so the normal `onclose` handler fires (a local `ws.close()` fires `onclose` client-side even when the TCP peer is gone) and drives cleanup + reconnect. Public `close()` semantics are unchanged; `close()` also tears down heartbeat timers and wake-probe listeners.
- Guard against background-tab false positives: browser timer throttling can delay both the ping timer and the check timer in hidden tabs; a force-close must not fire merely because throttling delayed *our own* pings (see Assumptions #8 — silence is judged only when a ping actually went out, or enforcement defers to the wake probe while hidden).

### 2. Wake probes (both sockets)

On `document.addEventListener("visibilitychange", …)` (only the →visible transition), `window "online"`, and `window "pageshow"`:

- **(a) Socket claims OPEN** → send an immediate `{op:"ping"}` and arm a short deadline (~3s, named constant, e.g. `WAKE_PROBE_TIMEOUT_MS = 3000`). If **any** inbound frame arrives before the deadline, the socket is alive — cancel the deadline. If not → force-close (same internal path as the heartbeat), letting the existing reconnect machinery recover.
- **(b) A reconnect backoff timer is pending** → clear it, reset `backoff` to `RECONNECT_BASE_MS`, and call `connect()` immediately. (Waking from a long sleep mid-backoff must not wait out a 15s/30s cap.)
- **(c) RelayMux idle case** → if the mux has zero live streams and no socket (the deliberate idle-stays-closed state, `relay-mux.ts:199-201`), the wake probe does nothing — it never resurrects an idle socket.

Listeners are owned per socket instance: registered when the socket becomes active, removed on permanent `close()`, and environment-guarded so jsdom/unit tests and non-browser contexts don't break.

### 3. Heartbeat on `/ws/terminals` (`app/frontend/src/lib/relay-mux.ts`)

- Same client heartbeat + wake-probe logic as the state socket, with the mux's wire shape: `{op:"ping"}` / `{op:"pong"}` as JSON **control ops carrying no stream id** (text frames on the otherwise-binary-data socket).
- `lastInbound` updates on every inbound frame — **binary data frames AND text control frames both count** (a busy terminal never needs a pong to prove liveness).
- Client control handling: `handleControl()` currently early-returns unless `typeof msg.id === "number"` (`relay-mux.ts:257`) — the `pong` op (no id) must be handled **before** that guard.
- **Idle behavior preserved**: heartbeat runs only while the socket is open AND `streams.size > 0`; it stops when the last stream closes; it never connects a closed socket. With zero live streams the mux deliberately lets the socket stay closed (`scheduleReconnect`'s `streams.size === 0` branch) — heartbeat and wake probes must not change that.
- Recovery needs no new work: on reconnect the mux already re-issues `open` for every live stream and each `TerminalClient`'s deferred reset repaints flicker-free on the first data frame.

### 4. Server-side ping handling (implied by 1+3)

- **`app/backend/api/state_ws.go`**: add a `ping` op to the client-op constants and the read-loop dispatch (`switch msg.Op` at ~line 269, alongside `subscribe`/`unsubscribe`/`preview-scope`/`hello`). Reply `{op:"pong"}`. The reply MUST be enqueued through the connection's existing single-writer pump (the buffered events channel consumed by the writer goroutine) — never written directly from the read loop (gorilla/websocket permits one concurrent writer). Note: today an unknown op gets an `error` frame reply; after this change `ping` is a known op.
- **`app/backend/api/terminals_ws.go`**: add a `ping` case to the JSON control-op dispatch (`switch ctl.Op` at ~line 256, alongside `open`/`resize`/`close`; unknown ops are currently ignored for forward-compat). Reply `{op:"pong"}` (no `id`), enqueued through the connection's existing writer path (`runWriter` pump).
- No server-side idle read deadline, no reaping of silent connections, and no `sse.go:105` comment fix — all explicitly deferred (out-of-scope item 4).

### 5. Tests

- **Frontend**: extend the existing colocated Vitest suites `app/frontend/src/lib/state-socket.test.ts` and `app/frontend/src/lib/relay-mux.test.ts` (both exist and MUST keep passing) with fake-timer coverage: ping cadence, any-frame liveness refresh, silence → force-close → reconnect (with `closed` still false), wake-probe ping + 3s deadline force-close, wake-probe immediate-reconnect + backoff reset, mux idle socket untouched by heartbeat/wake probes, `close()` tearing down timers/listeners.
- **Backend**: Go tests alongside the handlers (`state_ws_test.go`, `terminals_ws_test.go` conventions) covering ping → pong on both endpoints.
- All test runs via `just` recipes only (`just test-frontend`, `just test-backend`) — never direct `go test`/`pnpm test`/`playwright` invocations.
- No Playwright e2e: machine sleep / half-open TCP is not reproducible in the e2e harness; behavior is fully unit-testable with fake timers and mock sockets.

### Explicitly out of scope (user chose 1+2+3 only)

- Server→client protocol-level WS pings alone — rejected (browsers auto-answer invisibly to JS; cannot drive client-side death detection).
- **Item 4**: server-side idle read deadline + reaping of silent connections, and the stale `sse.go:105` comment fix — deferred to a future change.
- **Item 5**: suppressing the 5s window-switch bounce timer while the state socket reports disconnected — skipped; with 1+2 in place the socket recovers within the confirmation window.

## Affected Memory

- `run-kit/architecture`: (modify) — the `/ws/state` socket and `/ws/terminals` relay mux sections gain the client heartbeat (`{op:"ping"}`/`{op:"pong"}`), any-frame liveness tracking, force-close-into-reconnect, and wake-probe behavior.
- `run-kit/tmux-sessions`: (modify) — the muxed `/ws/terminals` wire protocol gains the id-less ping/pong control op alongside open/opened/resize/close/closed.

## Impact

- **Frontend** (`app/frontend/src/lib/`): `state-socket.ts` (heartbeat, `lastInbound`, internal force-close, wake probes), `relay-mux.ts` (same + pong-before-id-guard in `handleControl`, stream-gated heartbeat lifecycle), `state-socket.test.ts` + `relay-mux.test.ts` (extended; must keep passing). No changes to `app.tsx`'s pending-switch machinery (item 5 skipped) or to `terminal-client.tsx` (mux reconnect recovery already transparent).
- **Backend** (`app/backend/api/`): `state_ws.go` (ping op + pong reply via writer pump), `terminals_ws.go` (ping control op + pong reply), plus their colocated Go tests. `sse.go` untouched (item 4 deferred).
- **Wire protocol**: additive on both sockets — new `ping`/`pong` ops; no existing op or frame shape changes. Version skew is benign (see Assumptions #10): client and server ship in one binary (the Go server serves the SPA), and old servers either ignore (`/ws/terminals`) or error-frame (`/ws/state`, which itself counts as inbound liveness) an unexpected `ping`.
- **Specific agreed values**: ping interval ~30s; liveness timeout ~2 missed intervals; wake-probe deadline ~3s; backoff reset to base on wake-triggered reconnect. All as named constants (no magic numbers).
- **Constitution fit**: no new routes, no database, no polling from the client (heartbeat is socket-level liveness, not data polling — the anti-pattern bans `setInterval` + fetch for data), no tmux-layer coupling.

## Open Questions

- None — scope, mechanism, and values were explicitly settled in the originating conversation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is exactly approved items 1+2+3 (state-socket heartbeat, wake probes on both sockets, mux heartbeat) plus the implied server-side pong replies; item 4 (idle read deadline/reaping + `sse.go:105` comment) and item 5 (bounce-timer suppression) stay out | Discussed — user explicitly approved 1+2+3 and rejected/deferred the rest | S:95 R:85 A:90 D:95 |
| 2 | Certain | Constants: ping interval ~30s, liveness timeout ~2 missed intervals (~60s silence), wake-probe deadline ~3s, backoff reset to `RECONNECT_BASE_MS` on wake-triggered reconnect; all named constants | Specific values agreed in the conversation; code-quality bans magic numbers | S:90 R:90 A:90 D:90 |
| 3 | Certain | Death detection is client-initiated app-level `{op:"ping"}`→`{op:"pong"}` JSON ops, not server protocol-level WS pings | Alternative explicitly rejected in discussion — browsers auto-answer protocol pings invisibly to JS | S:90 R:85 A:95 D:90 |
| 4 | Certain | Any inbound frame refreshes last-inbound liveness (events/acks/gone/error/pong on state; binary data + control text on mux) — pongs are not correlated | User stated "any frame counts, not just pongs" | S:90 R:85 A:90 D:90 |
| 5 | Confident | Liveness force-close is a new internal path (private `forceClose()`-style) that closes the raw WebSocket without setting `closed = true` and without nulling `ws.onclose`, so the existing onclose → scheduleReconnect machinery recovers; public `close()` unchanged | Constraint stated by user; exact mechanism inferred from verified code (`close()` permanently suppresses reconnect; local `ws.close()` fires `onclose` even with a dead peer) | S:80 R:75 A:85 D:75 |
| 6 | Confident | Mux heartbeat runs only while the socket is open AND ≥1 live stream exists, stops when the last stream closes, and never connects a closed socket; mux wake probes no-op in the idle zero-stream state | User: heartbeat must not resurrect an idle socket; lifecycle mechanics inferred from `scheduleReconnect`'s `streams.size === 0` branch | S:80 R:80 A:80 D:75 |
| 7 | Confident | Server pong replies are enqueued through each handler's existing single-writer pump (state_ws writer channel; terminals_ws `runWriter` path), never written directly from the read loop | Inferred from handler structure + gorilla/websocket's one-concurrent-writer rule | S:70 R:80 A:85 D:80 |
| 8 | Confident | Hidden-tab guard: liveness enforcement must not force-close merely because background timer throttling delayed the client's own pings — silence is judged only against pings actually sent (or enforcement defers to the wake probe while `document.hidden`); exact guard shape decided at apply | Description targets sleep/wake via wake probes and names timer throttling; the guard mechanics are implementation detail | S:50 R:80 A:65 D:50 |
| 9 | Certain | Mux `pong` frames carry no stream id, so client `handleControl` processes `{op:"pong"}` before the existing `typeof msg.id !== "number"` early-return | User specified "no stream id"; guard location verified at `relay-mux.ts:257` | S:85 R:85 A:90 D:85 |
| 10 | Confident | No version-skew gating: an old server ignores unknown `/ws/terminals` control ops and replies an `error` frame (itself inbound liveness) on `/ws/state`; client+server ship in one binary so skew is transient | Inferred from verified server dispatch behavior (unknown-op paths) and the SPA-served-by-Go deployment model | S:60 R:70 A:75 D:65 |
| 11 | Certain | Testing: extend colocated Vitest suites (`state-socket.test.ts`, `relay-mux.test.ts`) with fake timers (existing tests must keep passing); Go tests alongside both handlers; run only via `just` recipes; no Playwright e2e (sleep/half-open TCP not reproducible in e2e) | Constraints stated in the conversation + project code-quality/context docs | S:80 R:85 A:85 D:80 |
| 12 | Confident | Wake-probe listeners are instance-owned (registered when the socket becomes active, removed on permanent `close()`), environment-guarded for jsdom/non-browser contexts | Standard pattern; keeps the singleton `relayMux` and provider-owned `StateSocket` lifecycles self-contained | S:55 R:85 A:70 D:60 |

12 assumptions (6 certain, 6 confident, 0 tentative, 0 unresolved).
