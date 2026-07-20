# Intake: Relay Mux — one terminal WebSocket per tab

**Change**: 260717-803u-relay-mux
**Created**: 2026-07-17

## Origin

One-shot `/fab-new` invocation, plan-driven — this is **Change 2 of 3** in
`fab/plans/sahil/socket-unification.md` (authored 2026-07-16, spikes run and verified same day).
Change 1 (`260716-qf3j-state-socket`) is review-pr DONE and merged (PR #375, commit `d05b47b1`).
Per the plan's execution model, this intake lifts its Requirements/Decisions from the plan's
§Change 2, §Protocol specifications › Terminal socket, the Decisions table (D1–D6), and the
Risk register — the plan states those sections are written to be liftable, and decisions D1–D6
are **made**; they must not be re-opened downstream.

> Implement the relay-mux change (Change 2 of fab/plans/sahil/socket-unification.md): a new
> /ws/terminals WebSocket handler consolidating all pane relay connections into one socket per
> tab, with per-stream bounded queues and a fair scheduler server-side (per spike 2's finding
> that a shared FIFO causes 1.66s typing latency under flood). Requirements/Decisions lifted
> from the plan (§Change 2, §Protocol specifications › Terminal socket, D1–D6, Risk register).
> Evidence: docs/findings/socket-pool-accounting.md + docs/findings/relay-mux-hol.md.
> IMPORTANT: this change's eventual PR must target the 'sockets-v2' branch, not main.

**Evidence documents** (read before planning):
- `docs/findings/socket-pool-accounting.md` — established WS holds NO h1 pool slot in any engine;
  WS *handshakes* block behind a full pool on Firefox/WebKit; pool is shared across tabs
  (Chromium/WebKit). Consequence: the terminal mux is connection hygiene (TCP count, one
  reconnect path, fewer handshakes), while change 1 carried the user-facing pool fix.
- `docs/findings/relay-mux-hol.md` — on a muxed terminal socket, a shared FIFO gives **1.66s**
  interactive echo p50 under a co-stream flood at 1 Mbps; per-stream bounded queues + non-FIFO
  scheduler give **32ms** at identical throughput (fairness costs zero goodput). **Per-stream
  queues + scheduler are a v1 protocol requirement, not an optimization.**

## Why

1. **Problem**: today every live pane opens its own `/relay/{windowId}` WebSocket
   (`terminal-client.tsx:813` → `relay.go` `handleRelay`). A board with N panes holds N TCP
   connections, N independent reconnect paths, and N upgrade handshakes. On Firefox/WebKit a
   transiently full h1 pool blocks new WS *handshakes* entirely (spike 1, case C), so every extra
   handshake is another exposure to that failure mode on plaintext origins.
2. **Consequence if unfixed**: the socket-unification goal (a fixed 2-WebSocket budget per tab)
   is unmet — the e2e connection guard cannot tighten past "1 state WS + N relay WSs"; pane churn
   (IntersectionObserver suspension, board resize/drag) keeps paying full socket
   setup/teardown, which is the cost behind the board pane-resize suspension drop
   (memory `board-pane-resize-suspension-drop`); and reconnect behavior stays N independent
   backoff loops instead of one.
3. **Why this approach**: spike 2 proved the mux's one risk (head-of-line blocking) is fully
   mitigated by per-stream bounded queues + a fair scheduler — 50–65× latency improvement under
   flood at zero throughput cost — so the protocol ships with them in v1 (decision D3). The
   terminals socket stays **separate** from `/ws/state` (D6): bulk binary output must not share
   a send buffer/scheduler with state events. Old endpoints are retired in the same change (D2):
   the frontend is the sole consumer (personal tool, no API compatibility contract;
   constitution IV — minimal surface).

## What Changes

### Backend — new `/ws/terminals` handler

One WebSocket per tab carrying all pane relay streams. New handler in `app/backend/api/`
(gorilla/websocket, already a dependency), registered in `router.go`. Connection registry +
per-stream `startStream` extracted from `handleRelay`'s guts (resolve → select → attach → pump).

**Wire protocol** (lifted verbatim from the plan §Terminal socket):

Binary data frames `[u32 BE streamId][payload]` both directions (output server→client,
keystrokes client→server). JSON text frames for control:

```jsonc
// client → server
{"op": "open", "id": 7, "server": "<tmux server>", "windowId": "@42", "cols": 120, "rows": 32}
{"op": "resize", "id": 7, "cols": 100, "rows": 40}
{"op": "close", "id": 7}
// server → client
{"op": "opened", "id": 7}
{"op": "closed", "id": 7, "code": 4004 | 4001 | 1000, "reason": "Window not found" | "Failed to attach to tmux session" | "closed"}
```

Stream IDs are client-allocated u32s, unique within a socket connection (the `open` op carries
the client's chosen `id`).

**Per-stream behavior preserves `handleRelay` exactly** (`relay.go:49-208`):
- Window-ID validation via the shared decode helper (`decodeWindowID` — the same helper the REST
  entry points use, so entry points cannot drift; constitution §I: validate before any tmux
  interaction). Under the mux, validation happens per `open` op — a malformed ID yields a
  `closed` control event for that stream, not a socket teardown.
- `ResolveWindowSession` (5s timeout) → **session-scoped** `SelectWindowInSession` — the
  group-ambiguity rationale at `relay.go:88-99` still applies verbatim: a bare `select-window -t @N`
  is ambiguous inside a tmux session group; select and attach must agree on the same session.
- `forceTERM` (TERM=xterm-256color replaces any inherited value), best-effort config reload
  (`tmux.ReloadConfig`), PTY attach (`pty.StartWithSize`) at the `open` frame's initial
  `cols`/`rows` (replacing today's wait-for-first-resize-message dance — the size now rides the
  open op).
- Cleanup on stream close: cancel + ptmx close + process kill (`sync.Once` guarded), exactly as
  today — no orphaned attach processes (review rule: WS connections must have corresponding
  cleanup).
- Today's WS close codes **4004** ("Window not found") and **4001** ("Failed to attach to tmux
  session") become `closed` control events with the same `code`/`reason` — **the socket itself
  never closes for stream-level failures**.

### Backend — write path: per-stream bounded queues + fair scheduler (v1 requirement, D3)

- Per-stream bounded send queue (**8 × 4096B**) + a **single writer goroutine** scheduling
  round-robin across ready streams; control frames and short frames never queue behind another
  stream's bulk output.
- A full queue **pauses that stream's PTY reader** (backpressure into tmux's per-client
  buffering — the same mechanism a stalled per-pane TCP socket exerts today) — **never drops
  bytes** (dropping mid-stream corrupts VT state).
- The existing relay read loop (`buf := make([]byte, 4096)` at `relay.go:173`) becomes the
  per-stream producer.
- The kernel TCP send buffer is a shared tail after the scheduler; default autotuning is
  acceptable (the scheduler bounds everything above it — spike finding).

### Backend — HOL scheduler Go test

Port the spike's harness assertion into a unit test on the scheduler (no real network): with
stream A flooding through a **paced writer** (injectable pacing seam), a stream B echo frame is
written within a bounded number of frames. Relay behaviors re-asserted in `relay_test.go`
equivalents: 4004-equivalent `closed` on bad window, initial-size attach, TERM forcing.

### Backend — retire `/relay/{windowId}` (D2)

`handleRelay` and its route are removed in this same change. No deprecation shim — the frontend
is the only consumer. (`api/socketsweep_test.go` and any other tests asserting the old route are
updated in the same commit.)

### Frontend — `RelayMux` singleton

New module owning the one terminals socket per tab, exposing (shape from the plan, verbatim):

```
openStream({server, windowId, cols, rows}) → handle {send, resize, close, onData, onClosed}
```

Socket-level reconnect: `RelayMux` reconnects with backoff; each live `TerminalClient` re-issues
`open` through its existing per-pane reconnect path (the deferred per-connection reset already
handles re-init). `terminal-client.tsx:813` is the **only** socket-creation site to replace.

### Frontend — `TerminalClient` port (the four delicate seams)

`TerminalClient` keeps its exact external behavior but consumes a stream handle:

1. **Confirmation-gated window-switch** (change `260715-38kg`): "first write" keys on socket
   `onmessage` today → becomes **first data frame for this stream id**. The gate state machine is
   pure; only the receipt source changes. Guarded by the window-switch-transition e2e suite.
2. **Connect-select alignment** (memory `relay-connect-select-alignment`: epoch-tagged in-flight
   receipt, CI-only race where same-session redraw bytes race the select POST): now anchors on
   the `open`→`opened` exchange, which is ordered in-band — verify the epoch logic simplifies
   rather than breaks (behavior preserved either way).
3. **IntersectionObserver pane suspension** = `close`/`open` stream ops (no socket churn) —
   also removes the board pane-resize suspension drop's reconnect cost
   (memory `board-pane-resize-suspension-drop`).
4. **Per-stream reset**: the deferred per-connection reset becomes per-stream, reusing the
   existing per-pane reconnect path.

### Tests & e2e

- **Connection guard tightens**: `app/frontend/tests/e2e/connection-budget.spec.ts` asserts a
  board with N panes holds exactly **2 WebSockets total** (`/ws/state` + `/ws/terminals`) and
  zero `text/event-stream` responses. `.spec.md` companion updated in the same commit
  (constitution: Test Companion Docs).
- **Window-switch-transition e2e suite green** (confirmation gate, bounce-back, grace mask).
  Known pre-existing flake: the `window-heading` history-arrows test is flaky on clean main
  (memory `window-heading-history-arrows-flaky-main`) — do not attribute it to this change.
- Scheduler Go test green (above).
- Manual/e2e: two panes on one board, one running `yes` — typing latency in the other stays
  interactive (the spike's scenario, in vivo; also exercises risk 3: PTY-reader pause
  backpressure behaves like a stalled socket because it is the same mechanism — unread PTY,
  tmux buffers per client).

### Ship — PR base branch

**The PR for this change MUST target the `sockets-v2` branch, not `main`** — downstream
ship-stage execution uses `gh pr create --base sockets-v2` (explicit user instruction in the
invocation; `sockets-v2` verified to exist on origin at `d05b47b1`).

### Acceptance (from plan §Change 2, binding)

1. A board with N panes holds exactly **2 WebSockets total** (state + terminals) — e2e
   connection guard updated.
2. Full window-switch-transition e2e suite green (confirmation gate, bounce-back, grace mask).
3. Scheduler Go test green; relay behaviors (4004 on bad window, initial-size attach, TERM
   forcing) re-asserted in `relay_test.go` equivalents.
4. Manual/e2e: two panes on one board, one running `yes`, typing latency in the other stays
   interactive.

### Non-goals / out of scope (plan-explicit)

- Chat SSE (change 3, `chat-on-state-socket` — requires only change 1; not this change).
- Merging the two WebSockets into one (D6 — decided against).
- SharedWorker socket ownership; ws-over-h2 (RFC 8441); TLS/HTTPS changes;
  proxied-iframe (`/proxy/{port}/`) pool consumption (documented residual).
- Any change to `/ws/state`, the chat send path, or Web Push.

## Affected Memory

- `run-kit/architecture`: (modify) — API surface: `/relay/{windowId}` retired, replaced by the
  `/ws/terminals` mux (connection registry, per-stream bounded queues + fair scheduler, control
  protocol, close-code → `closed`-event mapping); tab connection budget becomes 2 WS.
- `run-kit/ui-patterns`: (modify) — relay connection identity / adaptive write flush / deferred
  per-connection reset entries become per-stream; window-switch confirmation-gate receipt source
  changes from socket `onmessage` to per-stream first data frame; new `RelayMux` singleton.
- `run-kit/tmux-sessions`: (modify) — light touch: the direct-attach relay semantics
  (resolve → session-scoped select → attach) are unchanged, but references to the per-pane
  relay transport need updating to the muxed stream.

## Impact

- **Backend**: `app/backend/api/relay.go` (retired/absorbed), new terminals-WS handler + test in
  `app/backend/api/` (sibling of `state_ws.go`), `router.go` (route swap),
  `relay_test.go` (ported to per-stream equivalents), `socketsweep_test.go` (route inventory).
- **Frontend**: `app/frontend/src/components/terminal-client.tsx` (socket-creation site :813 and
  the four seams), new `RelayMux` module, board suspension seam (`board-page.tsx`) only insofar
  as it mounts/unmounts `TerminalClient`.
- **Tests**: `connection-budget.spec.ts` + `.spec.md`, window-switch-transition suite (guard,
  unchanged), new Go scheduler test.
- **Dependencies**: none new (gorilla/websocket, creack/pty already present).
- **Sequencing**: no hard dependency remaining — change 1 is merged. Change 3
  (`chat-on-state-socket`) is queued behind this change in the operator's implicit chaining,
  because both edit the same e2e connection guard (keeps guard evolution conflict-free).
- **Risk register** (plan, applicable rows): #2 confirmation-gate port (gate is pure — swap only
  the receipt source; e2e suite is the guard), #3 PTY-pause backpressure vs tmux (same mechanism;
  verify manually per acceptance 4), #4 reconnect storms (one socket drop now drops all panes —
  backoff + per-pane re-open is simpler than today's N paths; RefreshButton remains the manual
  recovery affordance), #5 e2e specs asserting transport internals churn (update spec +
  `.spec.md` same commit), #6 Vite HMR WS shares the dev origin (guard counts only rk endpoints).

## Open Questions

None — decisions D1–D6 are made in the plan and must not be re-opened; the invocation resolved
scope, evidence, and the PR base branch explicitly.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | PR targets `sockets-v2`, not main (`gh pr create --base sockets-v2` at ship) | Explicit user instruction in the invocation; branch verified to exist on origin | S:95 R:90 A:95 D:95 |
| 2 | Certain | Wire protocol lifted verbatim from plan §Terminal socket: binary `[u32 BE streamId][payload]` + JSON control `open/opened/resize/close/closed`; 4004/4001 become `closed` events; socket never closes on stream-level failure | Plan decision (do-not-relitigate); sole consumer is our frontend | S:90 R:75 A:95 D:95 |
| 3 | Certain | v1 ships per-stream bounded queues (8 × 4096B) + fair scheduler; full queue pauses that stream's PTY reader, never drops bytes | D3, spike-2 measured (1.66s → 32ms at zero throughput cost); dropping corrupts VT state | S:95 R:80 A:95 D:95 |
| 4 | Certain | `/relay/{windowId}` + `handleRelay` retired in this same change, no compat shim | D2; frontend is sole consumer; constitution IV | S:95 R:70 A:95 D:95 |
| 5 | Certain | Terminals socket stays separate from `/ws/state` — no merge | D6; bulk binary must not share a send buffer/scheduler with state events | S:95 R:75 A:95 D:95 |
| 6 | Certain | Stream IDs are client-allocated u32s unique per socket connection; on socket reconnect each live pane re-issues `open` (fresh ids) | Protocol examples show client-chosen `id`; plan's reconnect paragraph specifies re-open via existing per-pane path | S:85 R:85 A:90 D:85 |
| 7 | Confident | File layout: new handler as a sibling of `state_ws.go` in `app/backend/api/` (e.g. `terminals_ws.go` + test); frontend `RelayMux` as a new module near the api/lib layer | Plan names no files; change-1 precedent (`state_ws.go`) is the obvious convention; trivially renameable at apply | S:55 R:95 A:80 D:70 |
| 8 | Confident | Scheduler discipline: round-robin across ready streams with control/short frames prioritized ahead of bulk; exact variant (plain vs deficit RR) left to apply within the bounded-HOL test constraint | Plan says "round-robin (or deficit round-robin)"; spike proved the two-queue priority shape; the Go test pins the observable bound, not the algorithm | S:75 R:90 A:80 D:65 |
| 9 | Certain | Frontend API shape: singleton `RelayMux` exposing `openStream({server, windowId, cols, rows}) → {send, resize, close, onData, onClosed}`; `terminal-client.tsx:813` is the only creation site replaced | Shape given verbatim in the plan; creation-site uniqueness verified by grep | S:85 R:85 A:90 D:85 |
| 10 | Confident | The four TerminalClient seams port as specified (gate receipt = first stream data frame; select-alignment epoch anchors on `open`→`opened`, simplify only if provably equivalent; suspension = stream close/open; per-stream deferred reset) | Plan specifies all four, but equivalence is empirical — window-switch-transition e2e suite is the guard; gate module is pure | S:80 R:70 A:75 D:70 |
| 11 | Certain | e2e guard evolution: `connection-budget.spec.ts` tightens to exactly 2 WS + 0 SSE; `.spec.md` updated same commit | Plan acceptance 1 + constitution Test Companion Docs; guard file exists and already counts WS by URL | S:90 R:90 A:90 D:90 |
| 12 | Certain | HOL assertion ported as a Go unit test with an injectable paced writer (stream-B echo written within a bounded number of frames while stream A floods); no real network | Plan §Change 2 scope states this form explicitly; spike harness is the reference implementation | S:85 R:90 A:85 D:85 |

12 assumptions (9 certain, 3 confident, 0 tentative, 0 unresolved).
