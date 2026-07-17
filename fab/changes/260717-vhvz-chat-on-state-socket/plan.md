# Plan: Chat on State Socket

**Change**: 260717-vhvz-chat-on-state-socket
**Intake**: `intake.md`

## Requirements

Chat's incremental live stream moves off its dedicated per-view SSE
(`GET /api/windows/{id}/chat/stream`) and onto the existing state socket
(`/ws/state`) as a new `kind:"chat"` subscription. Backfill demotes to the
existing GET, which gains an additive byte-offset field so the client's
fetch→subscribe(`from`) composes gap-free and duplicate-free. The chat SSE
machinery is retired in the same change (D2). This lifts §Change 3 + §Protocol
specifications of `fab/plans/sahil/socket-unification.md`; decisions D1–D6 are
made and not relitigated.

### Backend: `chat` subscription kind on `/ws/state`

#### R1: `chat` subscribe/unsubscribe protocol on the state socket
`state_ws.go`/`sse.go` SHALL accept a `kind:"chat"` subscribe carrying
`key:<windowId>`, `server:<tmux server>` (the existing `clientMsg.Server`
field), `from:<byteOffset>` (new `clientMsg.From int64`, `from` JSON field), and
`req`. The subscribe ack SHALL carry the tail-start byte offset (`ackFrame` gains
`Offset int64`, `omitempty`) and NO transcript snapshot (D5) — the transcript
came from the GET backfill. Chat events ride the connection's existing
`hubEvent` channel through the single writer pump, ordered with acks/events.

- **GIVEN** a state-socket connection with a resolvable chat window
- **WHEN** it sends `{op:"subscribe",kind:"chat",key:"@1",server:"default",from:0,req:3}`
- **THEN** the server replies `{op:"ack",req:3,offset:<N>}` (no `snapshot`) and
  begins emitting `kind:"chat"` events from byte `from` onward.

#### R2: chat events — verbatim payloads plus `chat-reset` and `chat-error`
The producer SHALL emit `kind:"chat"` `event` frames whose `type`/`data` are
BYTE-IDENTICAL to today's SSE `data:` bodies for the surviving events: `chat`
(a `ChatEvent[]` — the appended events) and `chat-state` (`{pending}`, always
emitted incl. `null`). It SHALL emit a new lightweight `chat-reset` event
(`data:{}`, no transcript payload) on rotation/shrink, and a `chat-error`
(`{error}`) for an unrecoverable failure on a live subscription. `chat-backfill`
SHALL NOT ride the socket (backfill is the GET's job now).

- **GIVEN** an acked chat subscription and a new complete transcript line
- **WHEN** the producer's tail reads it
- **THEN** a `{op:"event",kind:"chat",key:"@1",type:"chat",data:[…]}` frame is
  emitted, followed by `{…,type:"chat-state",data:{pending:…}}`.
- **AND GIVEN** the resolved ref rotates (or the file shrinks below `from`),
  **THEN** a `{…,type:"chat-reset",data:{}}` frame is emitted instead of a
  transcript payload.

#### R3: per-subscription producer goroutine (tail + rotate + not-yet)
Each chat subscription SHALL own a per-subscription producer goroutine bound to a
`context.Context` that is cancelled on unsubscribe, on connection drop
(`dropStateConn`), and on a repeat subscribe for the same key (new `from` →
restart tail). The producer moves the `chatStream` machinery essentially
unchanged: `resolveWindowChat` + `chat.Lookup`, the ~2s `chatRefResolveInterval`
re-resolve (session rotation → fresh target on the same subscription, emitting
`chat-reset`), and the lazy-transcript "not yet" tolerance
(`ErrTranscriptNotFound`/`ErrInvalidRef` on a live subscription = retry next
tick, never terminal). Chat subscriptions SHALL NOT join the tmux poll set
(transcript appends generate no tmux events). No goroutine outlives its
subscription (Constitution II).

- **GIVEN** an acked chat subscription
- **WHEN** the client unsubscribes, disconnects, or repeat-subscribes the same key
- **THEN** the producer goroutine's context is cancelled and the goroutine exits.
- **AND GIVEN** the window's `@rk_chat` re-stamps to a session whose transcript
  does not exist yet, **THEN** the subscription stays live (no `chat-error`) and
  once the file appears a fresh `chat-reset` is emitted so the client re-composes.

#### R4: validate `key` and `server`; reject with an `error` frame
A chat subscribe/unsubscribe SHALL validate `msg.Key` via
`validate.ValidateWindowID` and `msg.Server` via `validate.ValidateServerName`
(mirrors the terminals-mux `open` op and the server-kind arm; Constitution §I).
An invalid value SHALL be rejected with an `error` frame carrying the offending
`req`, never a silent drop, and SHALL NOT create a subscription record or start a
producer.

- **GIVEN** a chat subscribe with a `key` that fails `ValidateWindowID` (or a
  `server` that fails `ValidateServerName`)
- **WHEN** the hub handles it
- **THEN** it emits `{op:"error",req:<req>,message:…}` and creates no
  subscription/producer.

#### R5: resolve-failure at subscribe time → `error` frame carrying `req`
A subscribe-time resolve failure that today maps to an HTTP status (no chat for
the window / no adapter / a `FetchSessions` fault) SHALL become an `error` frame
carrying `req` — the GET backfill remains the surface where those show as HTTP
statuses. It SHALL NOT leave a zombie producer.

- **GIVEN** a chat subscribe for a window with no reconciled chat (or an
  unregistered provider)
- **WHEN** the hub handles it
- **THEN** it emits an `{op:"error",req:<req>,…}` frame and starts no producer.

### Backend: adapter offset seam (`internal/chat`)

#### R6: GET backfill response gains an additive byte-offset field
`Conversation` SHALL gain an additive `Offset int64` field (`offset` JSON tag)
carrying the transcript byte offset the backfill read up to. `Backfill` SHALL
populate it (it currently discards the end offset that `backfillFromPath`
computes). Existing fields are unchanged (additive — older readers unaffected).

- **GIVEN** a live `claude` window backfilled via `GET /api/windows/{id}/chat`
- **WHEN** the response is marshalled
- **THEN** it carries `offset:<N>` equal to the byte length consumed by the
  backfill parse, alongside the unchanged `provider`/`sessionRef`/`events`/`pending`.

#### R7: tail-from-offset entry point primes parser state then emits bytes ≥ from
The Claude adapter SHALL expose a tail-from-offset entry point
(`TailFrom(ctx, ref, from int64) (<-chan Update, error)`) that primes parser
state by parsing bytes `0..from` (turn counter + pending continuity require the
full-file walk — backfill and tail share one parser), DISCARDS those primed
events, then emits ONLY bytes `≥ from` as incremental `Events` updates and tails
the file for growth. Its first emission SHALL NOT be a full-`Conv` `Reset` (that
is the self-priming `Tail` idiom, retired with its sole SSE consumer). A file
that is already shorter than `from` at prime time SHALL emit a `Reset`
(shrink signal) so the producer surfaces `chat-reset`.

- **GIVEN** a transcript of byte length `N` and `TailFrom(ctx, ref, N)`
- **WHEN** a new complete line is appended
- **THEN** the ONLY events delivered are the newly-appended ones (nothing from
  `0..N` is re-emitted), and their turn numbers are continuous with the primed
  prefix.

#### R8: gap-free / duplicate-free fetch→subscribe composition
The `GET`-offset → `TailFrom(from)` composition SHALL be gap-free and
duplicate-free: events with byte position `< from` are in the GET body; events
`≥ from` are the tail's; events written between the fetch and the subscribe are
covered by the tail (they are `≥ from`). There SHALL be no overlap window
requiring client id-dedup to hide duplicates.

- **GIVEN** a backfill returning offset `N`, then M events appended after `N`,
  then a `TailFrom(from:N)`
- **WHEN** the tail runs
- **THEN** exactly the M appended events arrive — no gap (none missing), no
  duplicate (none from `0..N`).

### Backend: retirement (D2, same change)

#### R9: retire the chat SSE endpoint and its orphaned machinery
The change SHALL remove: the `GET /api/windows/{id}/chat/stream` route from
`router.go`; `handleChatStream`; the `chatStream` struct + `run`/`reresolve`/
`subscribe`; `emitChatUpdate`; the SSE writer helpers `writeSSE`/`writeSSEJSON`/
`writeSSEError` (chat was their last consumer); and `sseHeartbeatPeriod`/
`maxLifetime` from `sse.go` (the chat SSE was their sole remaining consumer). The
self-priming `Tail` method SHALL be retired with its sole consumer (superseded by
`TailFrom`). UNTOUCHED: `GET /api/windows/{id}/chat` (gains only R6's offset
field), `POST /api/windows/{id}/chat/send` and all probe/lock/injection
machinery, `POST /api/windows/{id}/keys`, and `internal/chat`'s parser/schema
semantics.

- **GIVEN** the codebase after this change
- **WHEN** the router and `api`/`internal/chat` packages are compiled and vetted
- **THEN** none of the retired identities exist, no dead code references them, and
  the send/probe/lock machinery and the GET backfill (plus offset) still work.

### Frontend: StateSocket + hook swap

#### R10: `StateSocket` gains chat subscribe/unsubscribe + chat event dispatch
`state-socket.ts` SHALL expose `subscribeChat({server, windowId, from})` and
`unsubscribeChat({server, windowId})` (sub id `chat:<server>:<windowId>`), carry
`from` on the subscribe frame, surface the chat ack's `offset` and dispatch
`kind:"chat"` events to handlers. Because chat's `from` is stateful, chat
subscriptions SHALL be excluded from the socket's blind reconnect
auto-resubscribe loop (the owner hook re-runs fetch→subscribe on reconnect
instead — R12). The `onAck` handler SHALL surface the chat ack's `offset`; a new
handler seam SHALL deliver chat events keyed by `kind:"chat"`.

- **GIVEN** an open state socket
- **WHEN** `subscribeChat({server:"default",windowId:"@1",from:18734})` is called
- **THEN** it sends `{op:"subscribe",kind:"chat",key:"@1",server:"default",from:18734,req:<n>}`,
  and a subsequent `kind:"chat"` event frame is dispatched to the chat handler.
- **AND GIVEN** the socket reconnects, **THEN** the chat subscription is NOT
  blindly re-sent with a stale `from`.

#### R11: chat subscription seam exposed via `session-context`
`session-context.tsx` (owner of the singleton socket) SHALL expose the chat
subscription seam so consumers go through context helpers (the established
pattern): a `subscribeChat`/`unsubscribeChat` pair (or an imperative helper) that
proxies to the socket, plus a socket-connected signal the successor hook consumes
to compose the chat-lens connection dot. It SHALL NOT open a chat subscription on
its own — the owner hook drives lifecycle.

- **GIVEN** the successor hook mounted under the provider
- **WHEN** it enters/leaves the chat lens
- **THEN** it drives subscribe/unsubscribe through the context seam (never a
  direct socket handle), and reads socket-connected state from the context.

#### R12: successor hook `useChatSubscription` — same return shape, GET+subscribe
A successor hook SHALL replace `use-chat-stream.ts` with the SAME return shape
`{events, pending, connected, error}` consumed unchanged by `app.tsx`/`ChatView`.
On chat-lens enter it SHALL: reset view state → `GET /api/windows/{id}/chat`
backfill (`applyChatBackfill` REPLACE + set pending) → `subscribeChat(from:
offset)` → apply `chat` events via `appendChatEvents` (id-dedup retained as a
defensive layer), apply `chat-state` always (incl. `null`), on `chat-reset`
re-run the fetch→subscribe composition, on `chat-error` set the inline error. On
socket reconnect it SHALL re-run the fetch→subscribe composition (no cursor —
the no-cursor reset contract). Cleanup SHALL unsubscribe on lens leave / window
switch / unmount (no subscription outlives the view; Constitution II).

- **GIVEN** the chat lens activates for `(server, windowId)`
- **WHEN** the hook runs
- **THEN** it GETs the backfill, replaces the event list, subscribes with
  `from:<offset>`, and appends subsequent `chat` events without gaps/duplicates.
- **AND GIVEN** a `chat-reset` arrives (rotation), **THEN** the hook re-runs the
  fetch→subscribe composition on the same lens.
- **AND GIVEN** the lens is left or the window switches, **THEN** the chat
  subscription is released.

#### R13: chat-lens connection dot = (socket connected) AND (chat acked), 3s debounce
`app.tsx` SHALL keep a single owner-hook call feeding both `ChatView` (pure
renderer, unchanged) and the connection dot. The chat-mode connection dot SHALL
be `connected = (socket connected) AND (chat subscription acked)`, keeping the 3s
disconnect debounce (mirrors change 1's dot semantics). `ChatView` stays a pure
renderer over the returned `{events, pending, connected, error}`.

- **GIVEN** the chat lens is active
- **WHEN** the socket is connected and the chat subscription is acked
- **THEN** `chatStream.connected` is true and the dot reads connected; a socket
  drop flips it after the 3s debounce.

### Tests

#### R14: backend unit tests — offset composition + hub `chat` kind
Go unit tests SHALL cover: the offset composition seam (backfill to offset `N`,
append events, `TailFrom(from:N)`, assert exactly the appended events with no
gap/duplicate and continuous turns — R8); and the hub `chat` kind
(subscribe→ack-with-offset-no-snapshot, event routing + `chat`/`chat-state`
payload byte-equality, rotation → `chat-reset`, lazy not-yet tolerance, invalid
`key`/`server` → `error` frame, subscribe-time resolve failure → `error` frame,
unsubscribe/disconnect/repeat-subscribe producer teardown).

- **GIVEN** the new backend code
- **WHEN** `just test-backend` runs
- **THEN** the composition and hub-chat-kind tests pass.

#### R15: frontend unit tests — successor hook + socket chat kind
Frontend unit tests SHALL cover: the successor hook against a mock socket
(compose fetch→subscribe, `chat-reset` re-fetch, dot semantics = socket ∧ acked);
and `state-socket.ts` chat kind (subscribe frame shape incl. `from`, chat ack
offset surfaced, chat event dispatch, reconnect does not blindly resubscribe
chat).

- **GIVEN** the new frontend code
- **WHEN** `just test-frontend` runs
- **THEN** the hook and socket chat-kind tests pass.

#### R16: e2e — chat-view over the state-socket mock; connection-budget final form
`chat-view.spec.ts` SHALL drop its `**/api/windows/*/chat/stream*`
`text/event-stream` route mock and drive chat through an extended
`_state-socket-mock.ts` that answers chat subscriptions (backfill mocked as a
plain `GET /api/windows/*/chat*` `page.route`); terminal stubs stay on
`/ws/terminals` (memory `relay-mux-stale-ws-stub-class` — NEVER add `/relay/` or
SSE-based stubs). `connection-budget.spec.ts` SHALL take its final any-route ≤2
WS + 0 SSE form including a chat-lens case. Every touched `.spec.ts` SHALL update
its sibling `.spec.md` in the same change (Constitution: Test Companion Docs).

- **GIVEN** the e2e suites after this change
- **WHEN** `just test-e2e "chat-view"` and `just test-e2e "connection-budget"` run
- **THEN** chat-view drives chat over `/ws/state` (no SSE stub), and the budget
  guard confirms a chat-lens route holds ≤2 WS + 0 SSE.

### Non-Goals

- The chat send path (`POST .../chat/send`) and all probe/lock/injection
  machinery — out of scope plan-wide (untouched).
- `POST /api/windows/{id}/keys` — untouched.
- `internal/chat` parser/schema semantics (turn counter, pending derivation,
  tolerant JSONL parse) — unchanged beyond the additive offset field + the
  `TailFrom` entry point.
- A per-event resume cursor on reconnect — the no-cursor reset contract holds
  (cursor is a recorded later-additive).
- Merging the two WebSockets or any terminals-socket change.

### Design Decisions

1. **Chat producer runs off a hub `chatResolver` seam, not a `*Server`
   back-pointer**: the producer needs `resolveWindowChat` (a `*Server` method
   over `s.sessions`). Rather than give the hub a `*Server`, inject a resolver
   function field on `sseHub` (default built from `h.fetcher` +
   `sessions.ResolveChatPane`), mirroring the existing `captureFn`/`fetcher`
   injection pattern — *Why*: keeps the hub decoupled from `*Server`, matches the
   house injection idiom, and makes the producer unit-testable with a stub
   fetcher. *Rejected*: a `*Server` field on the hub (couples hub to the HTTP
   layer, breaks the existing constructor signature and every test that builds a
   bare hub).
2. **Chat subscription is registered on `stateConn`, NOT in `h.clients` (the
   poll set)**: chat has no tmux-event source, so it must not enter the
   per-server poll routing. Track chat producers in a per-connection map on
   `stateConn` (keyed by the chat sub id), separate from `subs` (the server/
   metrics routing records) — *Why*: R3 forbids joining the poll set; a chat sub
   is a goroutine+cancel, not a routing record. *Rejected*: reusing the `sseClient`
   record type for chat (its whole purpose is `h.clients` fan-out — wrong shape).
3. **`chat-reset` carries `data:{}` (no payload)**: rotation can target a large
   resumed session, so pushing a `Conversation` over the shared socket breaks
   D5's bounded-event-size rationale — the client re-runs the GET on reset. *Why*:
   D5. *Rejected*: pushing the full backfill on the socket (unbounded event size).
4. **`TailFrom` supersedes `Tail`**: `Tail`'s self-priming first-`Reset`-with-Conv
   contract existed only for the SSE stream; with backfill demoted to the GET,
   the tail's job is purely "emit bytes ≥ from". Retire `Tail` with its consumer.
   *Why*: D2 + D5. *Rejected*: keeping `Tail` alongside `TailFrom` (dead code —
   the `Adapter` interface method would have no caller).
5. **Chat excluded from `StateSocket` blind reconnect resubscribe; owner hook
   re-composes**: chat's `from` is a stateful cursor that a blind resubscribe
   would send stale. So the socket does not auto-resubscribe chat; the owner hook
   re-runs GET→subscribe on `onConnectionChange(true)`. *Why*: no-cursor reset
   contract + a stale `from` after a reconnect would gap/duplicate. *Rejected*:
   auto-resubscribing chat with the last `from` (stale after a restart that
   rotated the transcript).

## Tasks

### Phase 1: Backend — adapter offset seam (`internal/chat`)

- [x] T001 Add `Offset int64` (`json:"offset"`) to `Conversation` in `app/backend/internal/chat/adapter.go`; update the `Adapter` interface doc to add `TailFrom(ctx, ref, from int64) (<-chan Update, error)` and mark the self-priming `Tail` for retirement (remove the method from the interface). <!-- R6 R7 R9 -->
- [x] T002 In `app/backend/internal/chat/claude.go`: populate `Conversation.Offset` from `backfillFromPath`'s end offset in `Backfill`; implement `TailFrom(ctx, ref, from)` (prime `0..from` into a fresh parser discarding emitted events, then a `tailFromLoop` that seeks to `from`, emits only bytes ≥ `from` as `Events` updates, handles growth/shrink→`Reset`, and a file already shorter than `from`→immediate `Reset`); remove the self-priming `Tail` method + its `tailLoop`'s initial-Reset behavior (repurpose the poll loop into `tailFromLoop`). Keep `backfillFromPath`/`readFromOffset`/`send`/parser untouched in semantics. <!-- R6 R7 R8 R9 -->

### Phase 2: Backend — hub `chat` kind + producer (`sse.go`, `state_ws.go`)

- [x] T003 In `app/backend/api/state_ws.go`: add `kindChat` const; add `From int64` (`json:"from"`) to `clientMsg`; add `Offset int64` (`json:"offset,omitempty"`) to `ackFrame`. <!-- R1 -->
- [x] T004 In `app/backend/api/sse.go`: add a `chatResolver func(ctx, server, windowID) (provider, ref string, ok bool, err error)` field on `sseHub` (default in `newSSEHub` built from `h.fetcher.FetchSessions` + `sessions.ResolveChatPane`); add a per-connection chat-producer registry on `stateConn` (`chatProducers map[string]*chatProducer` keyed by chat sub id `<server>\x00<windowId>`, guarded by `h.mu`). <!-- R3 -->
- [x] T005 In `app/backend/api/sse.go`: add a `chatProducer` type (windowID/server/provider/ref/adapter + `context.CancelFunc`) and a `runChatProducer` method that reproduces `chatStream`'s loop over the state-socket channel: initial resolve+`Lookup`+`TailFrom(from)`, ~2s `chatRefResolveInterval` re-resolve emitting `chat-reset` on ref/provider change, lazy not-yet tolerance, `TailFrom` `Reset`→`chat-reset` / `Events`→`chat` + `chat-state`, delivering `hubEvent{kind:kindChat,key:windowID,typ:…,data:…}` via `sendConnLocked`. Bind to a ctx cancelled on teardown. <!-- R2 R3 --> <!-- rework (cycle 1): MUST-FIX — on rotation the producer emits chat-reset then re-tails the NEW ref with from:0, so the rotated-to transcript's full pre-existing contents ride the socket as one giant `chat` frame (violates R2/D5: chat-reset is emitted INSTEAD OF a transcript payload; full conversations never ride the socket), and on the /clear path the early chat-reset 404s the client's re-compose GET with NO fresh chat-reset when the file appears (R3 THEN-clause unimplemented) while the from-0 tail appends the new session onto the stale view. Fix: on rotation (and shrink-detected reset) go DORMANT — cancel the tail, do NOT re-tail from 0 — and emit the single chat-reset only once the new ref's transcript is resolvable/existing, leaving the fresh tail to the client's re-subscribe (which replaces this producer with a fresh from). ALSO (should-fix, directed): a dropped kindChat hubEvent in sendConnLocked (channel full) is a permanently missing message — map a dropped chat/chat-state event to a one-shot chat-reset for that subscription so the client re-composes. -->
- [x] T006 In `app/backend/api/sse.go` `stateSubscribe`: add a `kindChat` arm — validate `msg.Key` (`ValidateWindowID`) and `msg.Server` (`ValidateServerName`) → `emitError(req)` on failure; resolve the window's chat + `Lookup` the adapter (resolve failure → `emitError(req)`, no producer); cancel+replace any existing producer for the same sub id (repeat-subscribe restart); start the producer goroutine with `msg.From`; ack with `ackFrame{Offset: from}` and NO snapshot, ordered on the channel. Extend `stateUnsubscribe` with a `kindChat` arm (validate, cancel+drop the producer). <!-- R1 R2 R3 R4 R5 --> <!-- rework (cycle 1): SHOULD-FIX — the kindChat subscribe arm calls h.chatResolver (FetchSessions, up to 5s on a stalled tmux) synchronously on the state-socket read loop, freezing ALL of that connection's ops; mirror the terminals-mux S2 pattern: register a placeholder under h.mu, move resolve+ack into the producer-start goroutine, preserving ack-before-first-emit ordering by enqueueing the ack under h.mu before the producer's first emit. -->
- [x] T007 In `app/backend/api/sse.go` `dropStateConn`: cancel every chat producer on the connection and clear `chatProducers`, so a disconnect leaves no goroutine (Constitution II). Extend `renderEnvelope`/the kindChat event path so a `kindChat` hubEvent renders as `{op:"event",kind:"chat",key,type,data}` (kindChat already flows through the existing `eventFrame` path — confirm `key` is carried). <!-- R2 R3 -->

### Phase 3: Backend — retirement + router (`chat.go`, `router.go`, `sse.go`)

- [x] T008 In `app/backend/api/router.go`: remove the `r.Get("/api/windows/{windowId}/chat/stream", s.handleChatStream)` route. Leave the GET backfill + POST send routes. <!-- R9 -->
- [x] T009 In `app/backend/api/chat.go`: delete `handleChatStream`, the `chatStream` struct + `run`/`reresolve`/`subscribe`, `emitChatUpdate`, `chatState`, and the SSE writer helpers `writeSSE`/`writeSSEJSON`/`writeSSEError`. Keep `chatRefResolveInterval` (now consumed by the producer in sse.go — move/keep the var accessible to the api package), `resolveWindowChat`, `handleChatBackfill`, `writeChatReadError`, and the entire send half. <!-- R9 -->
- [x] T010 In `app/backend/api/sse.go`: remove `sseHeartbeatPeriod` and `maxLifetime` consts (chat SSE was their sole consumer) and update the trailing comment. <!-- R9 -->

### Phase 4: Frontend — socket + hook + context + wiring

- [x] T011 In `app/frontend/src/lib/state-socket.ts`: add a `chat` `Subscription` variant + `subscribeChat`/`unsubscribeChat` (sub id `chat:<server>:<windowId>`) sending `from` on the subscribe frame; extend `onAck` to surface the chat ack `offset` (add `offset` to the ack handler signature or a dedicated `onChatAck`); dispatch `kind:"chat"` events (extend `StateEvent.kind` union + `handleFrame`); EXCLUDE chat subs from the `onopen` blind resubscribe loop (keep them out of `this.subs`, or guard the resubscribe). <!-- R10 -->
- [x] T012 In `app/frontend/src/api/client.ts`: add `getWindowChat(server, windowId): Promise<Conversation>` GETting `/api/windows/{id}/chat?server=` (returns the offset-bearing backfill). Add `offset` to the `Conversation` type in `app/frontend/src/lib/chat-stream.ts`. <!-- R6 R12 -->
- [x] T013 In `app/frontend/src/contexts/session-context.tsx`: expose the chat subscription seam on `SessionContextType` — `subscribeChat`/`unsubscribeChat` proxying to `socketRef.current`, an `onChatEvent`/`onChatAck` registration seam (a ref-of-handlers like `subscribeBoardChange`), and a `socketConnected` signal for the dot. Wire the socket's chat event/ack callbacks into the ref-of-handlers. <!-- R10 R11 R13 -->
- [x] T014 Add `app/frontend/src/hooks/use-chat-subscription.ts` (successor to `use-chat-stream.ts`) returning `{events, pending, connected, error}`: on `[server, windowId]` run → reset state → `getWindowChat` (REPLACE + pending) → `subscribeChat(from: conv.offset)`; consume chat events via the context seam (`chat`→`appendChatEvents`, `chat-state`→set pending incl. null, `chat-reset`→re-run composition, `chat-error`→set error); connected = (socketConnected) AND (chat acked) with the 3s disconnect debounce; re-run composition on socket reconnect; cleanup unsubscribes. Delete `app/frontend/src/hooks/use-chat-stream.ts`. <!-- R12 R13 --> <!-- rework (cycle 1): MUST-FIX — the socket-reconnect effect (use-chat-subscription.ts:146-164) duplicates compose() inline WITHOUT the main effect's gen/cancelled guards: a reconnect GET still in flight when the user switches windows/leaves the lens REPLACEs the new window's state with the OLD conversation and re-subscribes the OLD (server,windowId) after its cleanup already unsubscribed — an ownerless server-side producer leaks until socket teardown (violates R12/A-011). Fix: hoist ONE guarded compose (e.g. behind a ref carrying the current generation) and reuse it from the reconnect effect so stale completions are discarded and no subscribe fires for a torn-down identity. -->
- [x] T015 In `app/frontend/src/app.tsx`: swap the `useChatStream` import + call for `useChatSubscription` (same call site, same returned shape feeding `ChatView` + `dotConnected`). No `ChatView` change. <!-- R12 R13 -->

### Phase 5: Tests + companions

- [x] T016 [P] Backend unit tests: in `app/backend/internal/chat/claude_test.go` add a `TailFrom` offset-composition test (backfill→offset N, append M events, `TailFrom(N)` → exactly M events, continuous turns, no gap/dup; plus a shrink-below-`from`→`Reset` case). <!-- R14 --> <!-- rework (cycle 1): SHOULD-FIX — the composition test hand-computes from := len(initial) instead of consuming Backfill().Offset, and nothing asserts Conversation.Offset == bytes consumed (or that the GET body carries offset); a regression to Offset=0 would stay green while production re-streams the whole backfill as socket duplicates. Assert Offset in TestBackfillFromDisk and derive `from` from Backfill().Offset in the composition test. -->
- [x] T017 [P] Backend unit tests: in `app/backend/api/state_ws_test.go` (and/or a new `chat_ws_test.go`) add hub chat-kind tests: subscribe→ack-with-offset-no-snapshot, `chat`/`chat-state` payload byte-equality, rotation→`chat-reset`, lazy not-yet tolerance, invalid key/server→error frame, resolve-failure→error frame, unsubscribe/disconnect/repeat-subscribe producer teardown. Update any chat_test.go tests that referenced the retired stream handler. <!-- R14 --> <!-- rework (cycle 1): MUST-FIX companion — TestChatWS_LazyNotYetTolerance (chat_ws_test.go:196-235) pins the NON-conformant whole-file-as-append behavior; rewrite it (and the rotation test) to the corrected contract: rotation/lazy-appearance yields a single chat-reset once the new transcript exists (no transcript bytes over the socket, no from-0 appends), restoring the coverage the deleted TestChatStreamRotationTranscriptNotYet provided. Add a dropped-chat-event→one-shot chat-reset test for the T005 backpressure fix. -->
- [x] T018 [P] Frontend unit tests: `app/frontend/src/lib/state-socket.test.ts` (chat subscribe frame incl. `from`, ack offset surfaced, chat event dispatch, reconnect doesn't blindly resubscribe chat) and `app/frontend/src/hooks/use-chat-subscription.test.ts` (compose fetch→subscribe against a mock socket seam, `chat-reset` re-fetch, dot = socket∧acked). Remove any obsolete `use-chat-stream` unit test. <!-- R15 --> <!-- rework (cycle 1): MUST-FIX companion — add a reconnect-recompose unit test proving the T014 fix: reconnect with an in-flight GET followed by a window switch must NOT apply the stale conversation and must NOT re-subscribe the old (server,windowId) after its cleanup ran (assert unsubscribe parity / no leaked subscription). -->
- [x] T019 Extend `app/frontend/tests/e2e/_state-socket-mock.ts`: answer `kind:"chat"` subscribe with an ack carrying `offset` (no snapshot); optionally emit `chat`/`chat-state`/`chat-reset` events on demand via options. <!-- R16 -->
- [x] T020 In `app/frontend/tests/e2e/chat-view.spec.ts`: drop the `**/api/windows/*/chat/stream*` `text/event-stream` mock; add a `**/api/windows/*/chat*` plain-GET backfill mock (offset-bearing) and drive incremental/pending via the extended state-socket mock; keep the `/ws/terminals` stub. Update `chat-view.spec.md` in the same change. <!-- R16 -->
- [x] T021 In `app/frontend/tests/e2e/connection-budget.spec.ts`: add a chat-lens route case (`/$server/$window?view=chat`) asserting ≤2 WS (state + terminals) + 0 SSE — its final any-route form. Update `connection-budget.spec.md` in the same change. <!-- R16 -->

## Execution Order

- Phase 1 (T001–T002) blocks Phase 2 (the producer calls `TailFrom` + reads the offset).
- Phase 2 (T003–T007) blocks Phase 3's retirement of the SSE stream (the replacement must exist first) and blocks the backend hub tests.
- Phase 4 depends on Phase 1–3 being wire-complete (client + socket + hook consume the new protocol). T011→T013→T014→T015 are ordered (socket → context seam → hook → app wiring); T012 is independent within Phase 4.
- Phase 5: T016–T018 are `[P]` (independent files); T019 blocks T020 (the spec drives through the extended mock); T020/T021 each require their sibling `.spec.md` updated in the same change.

## Acceptance

### Functional Completeness

- [x] A-001 R1: A `kind:"chat"` subscribe carrying `key`/`server`/`from`/`req` is accepted; the ack carries the tail-start `offset` and no `snapshot`. *(chat_ws.go `startChatSubscribe`; `TestChatWS_SubscribeAcksWithOffsetNoSnapshot`)*
- [x] A-002 R2: The producer emits `chat` (`ChatEvent[]`), `chat-state` (`{pending}`), `chat-reset` (`{}`) frames; `chat-backfill` never rides the socket. **Rework verified (cycle 2)**: the producer is now a TAIL/DORMANT machine — rotation/shrink cancels the tail and never re-tails from 0; `chat-reset` is emitted only once the rotated-to transcript exists (`chat_ws.go` `tick`/`enterDormant`/`transcriptExists`). *(`TestChatWS_RotationEmitsChatResetNotTranscript` asserts no `chat` frame rides the rotation; `TestChatWS_EventPayloadByteEquality` covers `chat`/`chat-state`.)* Note: `chat-error` remains a protocol-surface reservation the producer never emits — every failure path now converges via dormant→`chat-reset` instead of a terminal error (nice-to-have finding).
- [x] A-003 R3: Each chat subscription owns a producer goroutine that never joins the tmux poll set and is cancelled on unsubscribe/disconnect/repeat-subscribe. *(chatProducers map separate from h.clients; teardown tests `TestChatWS_{Unsubscribe,RepeatSubscribe,Disconnect}*`)*
- [x] A-004 R4: An invalid `key` (`ValidateWindowID`) or `server` (`ValidateServerName`) is rejected with an `error` frame carrying `req` and creates no subscription/producer. *(`TestChatWS_InvalidKeyRejected`/`_InvalidServerRejected`)*
- [x] A-005 R5: A subscribe-time resolve failure (no chat / no adapter / fetch fault) becomes an `error` frame carrying `req`, leaving no producer. *(`TestChatWS_ResolveFailureRejected`)*
- [x] A-006 R6: `GET /api/windows/{id}/chat` returns an additive `offset` field equal to the backfilled byte length. *(claude.go `Backfill` populates `Offset: n`; `TestBackfillFromDisk` now asserts `Offset == len(fixture)` and the composition test derives `from` from `Backfill().Offset` — prior cycle's should-fix resolved)*
- [x] A-007 R7: `TailFrom(ctx, ref, from)` primes `0..from`, discards those events, and emits only bytes ≥ `from` with continuous turns. *(`TestTailFromEmitsOnlyBytesAfterOffset`, `TestTailFromPrimesTurnContinuity`)*
- [x] A-008 R9: The chat SSE endpoint/`handleChatStream`/`chatStream`/`emitChatUpdate`/`writeSSE*`/`sseHeartbeatPeriod`/`maxLifetime`/self-priming `Tail` are removed; the GET backfill, POST send, `/keys`, and parser/schema are intact. *(grep sweep clean — prose comments naming the retired identities remain, no code references)*
- [x] A-009 R10: `state-socket.ts` sends the chat subscribe with `from`, surfaces the ack `offset`, dispatches `kind:"chat"` events, and does not blindly resubscribe chat on reconnect. *(state-socket.test.ts — all four asserted)*
- [x] A-010 R11: The chat subscription seam is exposed through `session-context`; the successor hook drives lifecycle only through it. *(`subscribeChat`/`unsubscribeChat`/`registerChatHandlers`/`socketConnected` on SessionContextType; hook holds no socket handle)*
- [x] A-011 R12: `useChatSubscription` returns `{events, pending, connected, error}`, composes GET→subscribe(from) gap-free, re-composes on `chat-reset` and on reconnect, and unsubscribes on lens leave/switch/unmount; `use-chat-stream.ts` is deleted. **Rework verified (cycle 2)**: one guarded `compose` (gen/cancelled guards) shared via `composeRef` by both the mount and reconnect effects; cleanup resets the ref to a no-op. *(Unit tests: "re-composes on socket reconnect" + "a reconnect GET in flight across a window switch does NOT apply the stale conversation or re-subscribe the old identity" — asserts no stale apply, no extra subscribe, unsubscribe parity.)*
- [x] A-012 R13: `app.tsx` feeds one owner-hook to `ChatView` + the dot; the chat dot is (socket connected) AND (chat acked) with the 3s debounce; `ChatView` is unchanged. *(app.tsx swap is call-site-only; chat-view.tsx diff is comments-only)*

### Behavioral Correctness

- [x] A-013 R8: The fetch→subscribe composition is gap-free and duplicate-free — exactly the post-offset events arrive, unit-proven. *(`TestTailFromEmitsOnlyBytesAfterOffset`)*
- [x] A-014 R3: A session rotation (`@rk_chat` re-stamp) surfaces a `chat-reset` on the same subscription; a not-yet transcript keeps the subscription live with no `chat-error`. **Rework verified (cycle 2)**: the dormant machine emits the reset only once the rotated-to transcript EXISTS (re-emitted each tick until the re-subscribe replaces the producer), so the client's re-compose GET cannot 404-wedge — and the hook additionally retries a 404 on a 500ms backoff (`NOT_YET_RETRY_MS`). *(`TestChatWS_RotationNotYetHoldsThenResets` restores the retired `TestChatStreamRotationTranscriptNotYet` coverage; `TestChatWS_InitialNotYetEmitsResetWhenFileAppears` covers the initial-subscribe case.)*

### Removal Verification

- [x] A-015 R9: `grep` finds no references to `handleChatStream`, `chatStream`, `emitChatUpdate`, `writeSSE`, `writeSSEJSON`, `writeSSEError`, `sseHeartbeatPeriod`, `maxLifetime`, or the `Tail(` adapter method; no `text/event-stream` on any rk route; the `/chat/stream` route is gone from `router.go`. *(verified — remaining hits are retirement-note prose comments only)*

### Scenario Coverage

- [x] A-016 R14: `just test-backend` passes, including the offset-composition and hub chat-kind tests. *(ok rk/api 31.8s, rk/internal/chat — run at review)*
- [x] A-017 R15: `just test-frontend` passes, including the successor-hook and socket chat-kind tests. *(80 files / 1385 tests passed at cycle-2 review; tsc clean)*
- [x] A-018 R16: `just test-e2e "chat-view"` and `just test-e2e "connection-budget"` pass; chat-view uses no SSE/`/relay/` stub; the budget guard covers a chat-lens route at ≤2 WS + 0 SSE. *(12/12 + 5/5 passed on port 3020; note the chat-lens budget case runs `?view=chat` on a window with no `@rk_chat` — lens falls back to tty, documented in the .spec.md)*

### Edge Cases & Error Handling

- [x] A-019 R7: A file already shorter than `from` at prime time emits a `Reset` so the producer surfaces `chat-reset` (client re-composes). *(`TestTailFromFileShorterThanOffset`; producer maps Reset→`chat-reset` in `emitUpdate`)*
- [x] A-020 R3: A repeat subscribe for the same key with a new `from` cancels the prior producer and restarts the tail (no goroutine leak). *(`TestChatWS_RepeatSubscribeRestartsProducer`)*

### Code Quality

- [x] A-021 Pattern consistency: New code follows the surrounding hub/producer/injection patterns (`chatResolver`/`captureFn` idiom, ref-of-handlers context seam, `hubEvent` channel single-writer discipline).
- [x] A-022 No unnecessary duplication: The producer reuses `resolveWindowChat`'s rollup rule (via the injected `chatResolver` default, per Design Decision 1)/`chat.Lookup`/`TailFrom`; the frontend hook reuses `applyChatBackfill`/`appendChatEvents`; no reimplemented parsing. *(cycle-2: the reconnect effect now reuses the one guarded `compose` via `composeRef` — prior residual resolved; small remaining overlap: the default `chatResolver`'s window-scan loop mirrors `resolveWindowChat`'s, sanctioned by Design Decision 1 — nice-to-have)*
- [x] A-023 Test companion docs: Every touched `.spec.ts` (`chat-view`, `connection-budget`) has its sibling `.spec.md` updated in the same change (Constitution: Test Companion Docs).
- [x] A-024 WebSocket cleanup: Every chat producer goroutine has a corresponding cancel on unsubscribe/disconnect/repeat-subscribe — no orphaned goroutine (code-review WebSocket-cleanup rule; Constitution II). *(server-side proven by tests; the client-side reconnect-race leak was fixed in cycle 2 — the window-switch-race unit test asserts unsubscribe parity, no leaked subscription)*

### Security

- [x] A-025 R4: Client-supplied `key`/`server` are validated through the shared `validate.ValidateWindowID`/`ValidateServerName` before reaching any tmux subprocess or hub state (Constitution §I). *(validation precedes the resolver's `FetchSessions`; empty server defaults via `serverFromRequestValue`, matching the terminals-mux idiom)*

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `chat.Update.Conv` (`app/backend/internal/chat/adapter.go` `Update` struct) — no producer populates it anymore: `TailFrom`'s Reset is a bounded signal with `Conv` always nil (the full-`Conv` Reset died with the self-priming `Tail`), and no production code reads it; only tests assert it is nil (`claude_test.go:402,435`). Remove the field plus its doc references.
- `chatEventError` (`app/backend/api/chat_ws.go:54`) — declared but never emitted: every producer failure path now converges via dormant→`chat-reset` instead of a terminal `chat-error`, so the Go-side constant has zero call sites (the client's `"chat-error"` handling in `use-chat-subscription.ts` keys on the string literal). Either wire a genuinely-unrecoverable emit path or drop the const + its comment (the client handler can stay as protocol tolerance).
- `hubEvent.String()` (`app/backend/api/state_ws_test.go:27`, test-only legacy SSE-frame renderer) — pre-existing candidate flagged in `docs/memory/run-kit/architecture.md` § Hub edge refactor; already relocated to the test file, and this change's new hub tests decode via `renderEnvelope()`, not `String()`, reinforcing it. Not made redundant *by* this change — carried for visibility.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Chat is a `kind:"chat"` subscription on `/ws/state`; backfill via GET+offset-composed subscribe (D5); chat SSE retired same change (D2); 2-socket budget holds (D6). | Plan marks D1–D6 "made — do not relitigate"; intake assumption 1. | S:95 R:80 A:95 D:95 |
| 2 | Certain | Surviving events move verbatim (`chat` = `ChatEvent[]`, `chat-state` = `{pending}` byte-identical; `chat-error` = `{error}`); `chat-backfill` leaves the wire; new `chat-reset` = `{}`. | Change 1's contract-preservation rule restated by the plan; intake assumption 11 + §Protocol. | S:90 R:80 A:90 D:90 |
| 3 | Certain | Validate `key` via `ValidateWindowID`, `server` via `ValidateServerName`; reject with an `error` frame carrying `req` (mirrors terminals-mux open + server-kind arm). | Constitution §I; the exact barrier change 1 installed; intake assumption 4. | S:75 R:85 A:95 D:90 |
| 4 | Confident | The chat producer resolves via a `chatResolver` function field injected on `sseHub` (default over `h.fetcher` + `sessions.ResolveChatPane`), not a `*Server` back-pointer. | Hub has no `*Server`; matches the `captureFn`/`fetcher` injection idiom and keeps `newSSEHub` + bare-hub tests intact. | S:60 R:70 A:80 D:70 |
| 5 | Confident | Chat producers are tracked in a per-connection `chatProducers` map on `stateConn`, separate from `subs`/`h.clients` (the poll set); chat never enters the poll routing. | R3 forbids joining the poll set (no tmux event source); a producer is a goroutine+cancel, not an `h.clients` fan-out record. | S:65 R:70 A:80 D:70 |
| 6 | Confident | `TailFrom(ctx, ref, from)` supersedes the self-priming `Tail`; `Tail` is removed from the `Adapter` interface with its sole SSE consumer. | D2 + D5 — `Tail`'s first-Reset-with-Conv contract existed only for the SSE stream; keeping it is dead code (no caller). Intake assumption 7. | S:60 R:70 A:80 D:70 |
| 7 | Confident | `chat-reset` carries `{}` (no transcript); the client re-runs the GET+subscribe composition on reset AND on socket reconnect (no cursor). | D5 bounded-event-size rationale (rotation can target a large resumed session); the recorded no-cursor reset contract. Intake assumptions 8, 9. | S:60 R:65 A:75 D:60 |
| 8 | Confident | `StateSocket` excludes chat from the blind reconnect auto-resubscribe; the owner hook re-runs fetch→subscribe on `onConnectionChange(true)`. | A blind resubscribe would send a stale `from` (gap/duplicate after a restart that rotated the transcript); the plan defers the reconnect handling to the frontend stage. Intake assumption 9 + §Frontend. | S:55 R:70 A:75 D:60 |
| 9 | Confident | The frontend needs a new `getWindowChat` client fn + a `Conversation.offset` type field (no GET backfill fetch exists today — the SSE hook streamed the backfill). | The old hook consumed `chat-backfill` over SSE, so client.ts has no GET backfill fetch; R6/R12 require the composed fetch. | S:65 R:75 A:80 D:75 |
| 10 | Confident | The chat subscription seam + socket-connected signal + a chat event/ack handler ride `session-context` via a ref-of-handlers (like `subscribeBoardChange`); the successor hook consumes them, keeping the singleton-socket ownership pattern. | Intake §Frontend ("seam exposed via session-context, owner of the singleton socket"); mirrors the established `subscribe*` context helpers. | S:65 R:70 A:80 D:70 |
| 11 | Certain | e2e: extend `_state-socket-mock.ts` for chat; drop chat-view's SSE stub; keep terminals on `/ws/terminals` (no `/relay/`/SSE stubs); connection-budget takes final ≤2 WS + 0 SSE incl. a chat-lens case; `.spec.md` companions updated same change. | Explicit intake instruction (memory `relay-mux-stale-ws-stub-class`); Constitution Test Companion Docs; plan acceptance 1. Intake assumption 12. | S:90 R:85 A:90 D:90 |

11 assumptions (4 certain, 7 confident, 0 tentative).
