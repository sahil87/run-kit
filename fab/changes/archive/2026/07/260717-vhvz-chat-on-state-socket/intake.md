# Intake: Chat on State Socket

**Change**: 260717-vhvz-chat-on-state-socket
**Created**: 2026-07-18

## Origin

One-shot `/fab-new` invocation, executing **Change 3 of `fab/plans/sahil/socket-unification.md`** per that plan's own execution model ("draft intakes for `relay-mux` and `chat-on-state-socket` from this plan — each intake's Requirements/Decisions sections should be lifted from §Change 2 / §Change 3 plus §Protocol specifications"). Raw input:

> Implement the chat-on-state-socket change (Change 3 of fab/plans/sahil/socket-unification.md): move chat incremental events onto the state socket as a 'chat' kind subscription (subscribe on chat-lens enter, unsubscribe on leave), retiring the per-view chat SSE (GET /api/windows/{id}/chat/stream, use-chat-stream.ts). Backfill demotes to the existing GET /api/windows/{id}/chat (fetch on lens enter); the subscribe op carries from:<byteOffset> and the ack returns the current offset so fetch+subscribe compose without gaps or duplicates. […] This change depends on and builds on the state-socket protocol machinery from change 1 (260716-qf3j-state-socket, PR #375, now merged to main via #378) […] IMPORTANT: also check memory entry relay-mux-stale-ws-stub-class before writing/updating any e2e specs that mock terminal or socket behavior — old /relay/ or SSE-based test stubs are stale post-socket-unification. This change ships as a normal PR against main (sockets-v2 has already been merged and deleted, unlike changes 1-2).

Plan decisions **D1–D6 are made** (the plan says "do not relitigate in intakes"); the auto-answer policy for this change is standard (Confident → default; Tentative/Unresolved → halt). Evidence: `docs/findings/socket-pool-accounting.md`, `docs/findings/relay-mux-hol.md`, the plan itself.

## Why

1. **The pain point**: the chat lens is the last remaining `EventSource` in the app. Changes 1–2 collapsed every other long-lived stream into the fixed 2-WebSocket budget (`/ws/state` + `/ws/terminals`), but an open chat view still holds a dedicated per-view SSE (`GET /api/windows/{id}/chat/stream`) — one h1 pool slot on plaintext origins, exactly the starvation class the socket-unification plan exists to eliminate (SSE holds a pool slot in every engine; WS handshakes block behind a full pool on Firefox/WebKit).
2. **If we don't fix it**: the plan's goal state ("any route holds ≤ 2 WS + 0 SSE") is never reached; the connection-budget e2e guard can never take its final form; the chat lens stays the one view that can contribute to pool pressure, and the codebase carries two parallel streaming stacks (state-socket envelope + a bespoke per-view SSE) indefinitely.
3. **Why this approach**: change 1 built exactly the machinery this needs — an in-band subscribe/ack protocol whose messages are totally ordered with the event stream (killing the POST-races-the-stream class), a per-connection subscription registry, and a proven frontend `StateSocket` client. Chat becomes one more subscription `kind`. Backfill is deliberately **demoted to the existing `GET /api/windows/{id}/chat`** (D5) rather than riding the socket, so a big transcript can never head-of-line-block session-state events on the shared socket; the byte-offset-tailed JSONL adapter makes an exact, gap-free/duplicate-free fetch→subscribe composition possible.

## What Changes

### Protocol: `chat` subscription kind on `/ws/state`

Per the plan's §Protocol specifications, extended with the offset-composition contract (D5):

```jsonc
// client → server (subscribe on chat-lens enter, unsubscribe on leave)
{"op": "subscribe",   "kind": "chat", "key": "@42", "server": "<tmux server>", "from": 18734, "req": 3}
{"op": "unsubscribe", "kind": "chat", "key": "@42", "server": "<tmux server>"}

// server → client
{"op": "ack", "req": 3, "offset": 18734}                                   // NO snapshot (D5) — offset = where the tail starts
{"op": "event", "kind": "chat", "key": "@42", "type": "chat",       "data": [ /* ChatEvent[] — verbatim payload */ ]}
{"op": "event", "kind": "chat", "key": "@42", "type": "chat-state", "data": { "pending": { /* … */ } }}
{"op": "event", "kind": "chat", "key": "@42", "type": "chat-reset", "data": {}}   // rotation signal — client re-fetches (see below)
{"op": "event", "kind": "chat", "key": "@42", "type": "chat-error", "data": { "error": "…" }}
{"op": "error", "req": 3, "message": "…"}                                  // invalid windowId/server, unknown kind
```

- The `key` is the stable tmux window ID (`@N`), matching the plan's sketch; the tmux **server rides the existing `clientMsg.Server` field** (window IDs are only unique per server; every chat endpoint is server-scoped via `?server=`).
- **Contract-preservation rule** (change 1's load-bearing rule, applied to the surviving events): today's `chat` and `chat-state` SSE payloads move **byte-identical** into the envelope's `data`; `chat-error` keeps its `{error}` shape. `chat-backfill` leaves the wire entirely — backfill is the GET's job now.
- Validation mirrors change 1's rework lesson and the terminals-mux `open` op (Constitution §I): `msg.Key` through the shared `validate.ValidateWindowID`, `msg.Server` through `validate.ValidateServerName`; rejection is an `error` frame carrying `req`, never a silent drop.

### Offset composition — the fetch→subscribe seam (D5)

The lens-enter sequence, designed so fetch+subscribe compose **without gaps or duplicates**:

1. **Fetch**: client GETs `/api/windows/{id}/chat`. The response gains an additive byte-offset field (e.g. `"offset": 18734`) — the transcript byte offset the backfill read up to. The adapter already computes this (`backfillFromPath` returns it; `Backfill` currently discards it).
2. **Subscribe**: client subscribes `kind:"chat"` with `from: <that offset>`. The server-side producer parses `0..from` to prime parser state (turn counter + pending derivation need the full-file walk — backfill and tail share one parser today), **discards** those events, then emits everything from byte `from` onward as incremental `chat` events and tails the file.
3. **Ack**: returns the offset the tail actually starts from (normally `== from`). Events written between fetch and subscribe are covered by the tail (they are ≥ `from`); events before `from` were in the GET body. No overlap, no gap.
4. **Rotation**: if at subscribe time (or any ~2s re-resolve tick) the resolved ref differs, or the file shrank below `from`, the producer emits a small **`chat-reset`** signal (no transcript payload) and the client re-runs the fetch→subscribe composition. Full conversations never ride the socket — a rotation can target a *large* resumed session (`claude --resume` re-stamps `@rk_chat`), so pushing a `Conversation` over the shared socket would break D5's bounded-event-size rationale.
5. **Reconnect**: keeps the established **no-cursor reset contract** (recorded chat design decision: "reconnect = full re-derive; cursor protocol additive later") — on socket reconnect the hook re-runs fetch→subscribe rather than maintaining a per-event resume cursor.

### Backend: hub + `state_ws.go` — the `chat` kind

- New `kindChat` constant beside `kindServer`/`kindMetrics`; `clientMsg` gains `From int64` (`from` JSON field); `ackFrame` gains `Offset` (omitempty — server/metrics acks unchanged).
- `stateSubscribe`/`stateUnsubscribe` grow a `kindChat` arm. Chat subscriptions do **not** join the tmux poll set (transcript appends generate no tmux events — the recorded reason chat got a dedicated stream in the first place). Instead each chat subscription owns a **per-subscription producer goroutine** — the `chatStream` machinery moved essentially unchanged: `resolveWindowChat` + `chat.Lookup`, the ~2s `chatRefResolveInterval` re-resolve (session rotation → fresh target on the same subscription), and the lazy-transcript "not yet" tolerance (`ErrTranscriptNotFound`/`ErrInvalidRef` on a live subscription = retry next tick, never terminal).
- The producer emits `hubEvent{kind: kindChat, key: windowID, …}` values onto the connection's existing send channel (single writer pump, ordered with acks/events — the same idiom as everything else on the socket).
- Teardown: the producer's context is cancelled on `unsubscribe`, on connection drop (`dropStateConn`), and on a repeat subscribe for the same key (new `from` → restart tail). No goroutine outlives its subscription (Constitution II; code-review WebSocket-cleanup rule).
- Resolve failures at subscribe time that today map to HTTP statuses (no chat for window / no adapter / fetch failure) become `error` frames carrying `req` — the GET backfill remains the surface where those show as HTTP statuses.

### Backend: adapter offset seam (`internal/chat`)

- Expose the backfill end offset to the API layer (e.g. `Backfill` returns it, or `Conversation` gains an `offset` field — plan decides the exact seam; the JSON response field is the requirement).
- Add a tail-from-offset entry point (e.g. `TailFrom(ctx, ref, from int64)`) implementing the prime-then-emit behavior above. The existing self-priming `Tail` contract (first Update = Reset with full Conv) is the SSE stream's idiom and can be absorbed/retired with its sole consumer.

### Backend: retirement (D2 — same change)

- Remove `GET /api/windows/{id}/chat/stream` from the router, `handleChatStream`, the `chatStream` struct + `run`/`reresolve`/`subscribe`, `emitChatUpdate`, and the SSE writer helpers (`writeSSE`/`writeSSEJSON`/`writeSSEError`) — chat was their last consumer.
- `sseHeartbeatPeriod`/`maxLifetime` (sse.go:100's comment names the chat SSE as their sole remaining consumer) go with them.
- **Untouched**: `GET /api/windows/{id}/chat` (gains only the offset field), `POST /api/windows/{id}/chat/send` (explicitly out of scope plan-wide), `POST /api/windows/{id}/keys`, the whole send/probe/lock machinery in `chat.go`, and `internal/chat`'s parser/schema.

### Frontend: `StateSocket` + hook swap

- `state-socket.ts`: `subscribeChat({server, windowId, from})`/`unsubscribeChat(...)` (sub id e.g. `chat:<server>:<windowId>`), `from` carried on the subscribe frame, chat `ack` offset + `kind:"chat"` events dispatched to handlers. Reconnect auto-resubscribe must compose with the hook's re-fetch contract (the hook re-runs fetch→subscribe on connection recovery; the plan stage decides whether chat is excluded from blind auto-resubscribe or the repeat subscribe is treated as the reset trigger).
- **Retire `use-chat-stream.ts`**; a successor hook (same return shape `{events, pending, connected, error}`) drives: lens enter → reset state → GET backfill (`applyChatBackfill` REPLACE + pending) → `subscribeChat(from: offset)` → `chat` events through `appendChatEvents` (id-dedup stays as a defensive layer), `chat-state` always applied incl. `null`, `chat-reset` → re-run composition, `chat-error` → inline error. Cleanup unsubscribes on lens leave / window switch / unmount.
- The subscription seam is exposed through `session-context` (owner of the singleton socket), preserving the established pattern that consumers go through context helpers.
- `app.tsx` keeps the single owner-hook call feeding both `ChatView` (pure renderer, unchanged) and the connection dot. **Chat-mode connection dot = (socket connected) AND (chat subscription acked)**, keeping the 3s disconnect debounce.

### Tests

- **Unit (Go)**: offset composition — no gap/duplicate at the fetch→subscribe seam (acceptance 3 of the plan: backfill to offset N, append events, subscribe `from:N`, assert exactly the appended events arrive); hub tests for the `chat` kind (subscribe→ack-with-offset, event routing + payload byte-equality for `chat`/`chat-state`, rotation → `chat-reset`, lazy not-yet tolerance, invalid windowId/server → `error` frame, unsubscribe/disconnect producer teardown).
- **Unit (frontend)**: successor-hook behavior against the mock socket (compose, reset-refetch, dot semantics); `state-socket.ts` chat kind.
- **e2e**: `chat-view.spec.ts` drops its `**/api/windows/*/chat/stream*` `text/event-stream` route mock — extend `_state-socket-mock.ts` to answer chat subscriptions (backfill mocked as a plain GET `page.route`); terminal stubs stay on `/ws/terminals` (memory `relay-mux-stale-ws-stub-class` — no `/relay/` or SSE-based stubs). `connection-budget.spec.ts` takes its **final form**: any route — now including a chat-lens case — holds ≤ 2 WS + 0 SSE. Every touched `.spec.ts` updates its `.spec.md` companion in the same commit (Constitution: Test Companion Docs).
- Chat e2e acceptance (plan §Change 3): backfill renders, incremental events append, pending bubble, send path (POST, untouched), provider-rotation tolerance.

## Affected Memory

- `run-kit/chat`: (modify) — the "Stream endpoint" / "Session rotation re-resolve" / "Lazy-transcript not-yet" / "Dedicated per-view EventSource hook" requirements are superseded by the chat subscription (kind, offset composition, chat-reset contract); the "Dedicated per-view SSE endpoint" and "reset-on-reconnect" design decisions gain their successor rationale.
- `run-kit/architecture`: (modify) — endpoint inventory: chat SSE retired; `/ws/state` gains the `chat` kind; GET backfill gains the offset field; tab budget final form (≤ 2 WS + 0 SSE on every route).
- `run-kit/ui-patterns`: (modify) — chat-lens connection dot now derives from chat-subscription state (socket + acked), not EventSource health.

## Impact

- **Backend**: `api/state_ws.go` (kind, frames, dispatch), `api/sse.go` (hub registry arm + producer wiring), `api/chat.go` (stream half removed; backfill offset field), `api/router.go` (route removal), `internal/chat/adapter.go` + `claude.go` (offset seam, tail-from-offset), corresponding `_test.go` files.
- **Frontend**: `src/lib/state-socket.ts`, `src/contexts/session-context.tsx` (chat seam), `src/hooks/use-chat-stream.ts` (retired → successor hook), `src/app.tsx` (wiring + dot), unit tests alongside.
- **e2e**: `tests/e2e/chat-view.spec.ts` + `.spec.md`, `tests/e2e/_state-socket-mock.ts`, `tests/e2e/connection-budget.spec.ts` + `.spec.md`.
- **Dependencies**: none new. Builds on merged change 1 machinery (`260716-qf3j-state-socket`, via PR #378). Ships as a normal PR against `main`.
- **Scale**: plan calls it "small enough for one review pass".

## Open Questions

None — decisions D1–D6 are made in the plan and the remaining design points are recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Plan decisions D1–D6 stand un-relitigated: chat is a `kind:"chat"` subscription on `/ws/state`; backfill via GET + offset-composed subscribe, not snapshot-in-ack (D5); the chat SSE is retired in this same change (D2); the 2-socket budget holds (D6) | The plan marks these decisions "made — do not relitigate in intakes"; evidence docs + change-1/2 precedent | S:95 R:80 A:95 D:95 |
| 2 | Certain | Ships as a normal PR against `main`; the sole hard dependency (change 1's protocol + hub machinery) is already merged via #378; sockets-v2 no longer exists | Stated explicitly in the invocation; verified in the working tree (state_ws.go/terminals_ws.go present on main-derived branch) | S:95 R:90 A:95 D:95 |
| 3 | Certain | Chat-lens connection dot = (socket connected) AND (chat subscription acked), keeping the 3s disconnect debounce | Plan §Change 3 states it verbatim; mirrors change 1's R11 dot semantics | S:85 R:85 A:90 D:85 |
| 4 | Certain | Client-supplied subscribe key/server validated via the shared `validate.ValidateWindowID` / `ValidateServerName` with an `error` frame on rejection | Change 1's rework cycle installed exactly this barrier for server keys (Constitution §I); the terminals-mux `open` op already validates a WS-supplied windowId the same way | S:70 R:85 A:95 D:90 |
| 5 | Confident | The chat subscribe op carries the tmux server in the existing `clientMsg.Server` field alongside `key:<windowId>` | The plan's sketch shows only `key`, but window IDs are unique per server and every chat endpoint is server-scoped; the field already exists (preview-scope uses it) | S:65 R:75 A:85 D:75 |
| 6 | Confident | `GET /api/windows/{id}/chat` gains an additive byte-offset field supplying the subscribe's `from`; exact offset composition (not client id-dedup of an overlap window) is what satisfies "without gaps or duplicates" | D5 names the byte-offset-tailed adapter as the enabler; `backfillFromPath` already computes the offset and `Backfill` discards it; duplicates-on-the-wire would contradict the plan's wording | S:70 R:70 A:80 D:70 |
| 7 | Confident | Tail-from-offset primes parser state by parsing `0..from` (events discarded) then emits bytes ≥ `from` — turn counter + pending continuity require the full-file walk | Recorded adapter behavior: backfill and tail share one parser so turn/pending stay continuous; emitting without priming would corrupt turn grouping | S:60 R:70 A:80 D:70 |
| 8 | Confident | Rotation emits a small `chat-reset` signal (no transcript payload); the client re-runs fetch→subscribe. Full `Conversation`s never ride the socket | D5's rationale is bounded event sizes on the shared socket; a rotation can target a large resumed session, so pushing the backfill over the socket is unbounded — the GET demotion must cover rotation too | S:55 R:65 A:70 D:55 |
| 9 | Confident | Reconnect keeps the no-cursor reset contract: re-run fetch→subscribe on socket recovery instead of a per-event resume cursor | The chat memory records "reset-on-reconnect (no cursor; cursor additive later)" as a made design decision; change 1's reconnect idiom is likewise fresh-snapshot-per-ack | S:60 R:75 A:80 D:65 |
| 10 | Confident | Each chat subscription owns a per-subscription producer goroutine (tail + 2s re-resolve + lazy not-yet tolerance moved unchanged from `chatStream`), ctx-cancelled on unsubscribe/disconnect; chat never joins the tmux poll set | The plan says the re-resolve + tolerance "move into the chat subscription's server-side producer unchanged"; the poll set is tmux-event-driven and transcript appends generate no tmux events (the recorded reason chat was a dedicated stream) | S:75 R:70 A:85 D:80 |
| 11 | Certain | Surviving event names/payloads move verbatim: `chat` (ChatEvent[]) and `chat-state` ({pending}) byte-identical inside the envelope; `chat-error` keeps `{error}`; `chat-backfill` leaves the wire | Change 1's load-bearing contract-preservation rule, restated by the plan for every migrated stream | S:85 R:80 A:90 D:85 |
| 12 | Certain | e2e stubs: `_state-socket-mock.ts` gains chat-subscription support; `chat-view.spec.ts` drops its SSE route mock; terminal stubs stay on `/ws/terminals`; `connection-budget.spec.ts` tightens to the final any-route ≤ 2 WS + 0 SSE form incl. a chat-lens case; `.spec.md` companions updated in the same commit | Explicitly instructed (memory `relay-mux-stale-ws-stub-class`); Constitution Test Companion Docs; plan acceptance 1 names the final guard form | S:90 R:85 A:90 D:90 |
| 13 | Certain | The orphaned chat-SSE machinery retires with the endpoint: `chatStream` + helpers, `writeSSE`/`writeSSEJSON`/`writeSSEError`, and `sseHeartbeatPeriod`/`maxLifetime`; GET backfill, POST send, `/keys`, and the send/probe/lock machinery are untouched | D2 (retire in the same change); sse.go:100's comment names the chat SSE as those constants' sole remaining consumer; the plan scopes the send path out explicitly | S:70 R:85 A:90 D:85 |

13 assumptions (7 certain, 6 confident, 0 tentative, 0 unresolved).
