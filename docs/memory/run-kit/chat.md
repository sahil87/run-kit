---
type: memory
description: "The chat subsystem backend — neutral event schema, adapter registry, transcript backfill/tail, and pane-typed send. Send uses sanitized named-buffer paste, novelty echo probing, probe-gated Enter, asymmetric post-Enter observation, and evidence-gated recovery; probe, staged-send, and submit-unverified failures are distinct 409s. The chat lens frontend lives in ui/chat-view.md."
---
# Chat Subsystem

**Domain**: run-kit

## Overview

`internal/chat` turns a window's reconciled `@rk_pane_chat = <provider>:<session-ref>`
(from [agent-state](/run-kit/agent-state.md) § Chat Session Identity) into the
conversation it names. It is a **read-only** view over the agent pane plus a
narrow **send** path: the pane stays the agent's parent process (Constitution VI);
rk only ever *reads* the transcript and *types into* the pane exactly as a human
typist would — never owning the agent's session. Everything derives from disk at
request/stream time with **nothing cached beyond the connection** (Constitution
II): all read routes are GET, the send path holds no SDK/session/queue state. The
schema is rk-owned and provider-neutral so Codex/Gemini adapters are backend-only
additions; the **Claude** adapter is the one registered provider (protocol-based
send such as Codex JSON-RPC branches behind the `injectChatMessage` adapter
seam — a thin wrapper over the shared `internal/inject` engine — later).

The read surface is a window-keyed `GET /api/windows/{windowId}/chat` backfill and
a live incremental stream carried as a `kind:"chat"` subscription on `/ws/state`
(subscribed on chat-lens enter, unsubscribed on leave), so a tab holds a fixed
2 WebSockets + 0 SSE on every route (D6). Backfill carries an additive byte
`offset`; the subscribe carries `from:<offset>` and its ack returns the tail-start
offset with NO snapshot, so `GET(offset)→subscribe(from)` composes gap-free and
duplicate-free — a full `Conversation` never rides the shared socket (§ Live
stream; § Design Decisions → Chat live stream on the state socket). The generic
`POST /api/windows/{windowId}/keys` endpoint is a distinct contract, untouched by
the send path.

The frontend consumer is the `chat` LENS: a read-only HTML view over the SAME
agent pane, addressed by a `?view=chat` search param on the existing
`/$server/$window` terminal route (Constitution IV — no new route). It renders the
streamed transcript with nothing cached beyond React state that dies with the
view. Its view-state plumbing (the `?view=` param, ViewSwitcher chip, value-bearing
localStorage, palette/`Ctrl+`` parity, chat-health connection dot) is the shared
lens machinery in [ui/lenses-and-layout](/run-kit/ui/lenses-and-layout.md) § Window Views (Lens
Model) / § Chat View; the top-bar center heading reads a static `Window: <window>`
in every lens (lens indication belongs to the L1 ViewSwitcher). The § Chat View
Frontend requirements below own only the DATA-layer consumer half (schema types,
subscription lifecycle, renderer). The push deep-link URL + service-worker
navigation lives in [architecture](/run-kit/architecture.md) § Web Push
Notifications.

## Requirements

### Requirement: rk-owned neutral event schema (`schema.go`)
`internal/chat` SHALL define provider-neutral Go types every adapter normalizes
into. `Event` is a flat discriminated struct — `Type` (`message` | `tool_use` |
`tool_result`), `ID` (provider line uuid — the stable dedup key), `Turn`
(monotonic counter), `Role` (`user` | `assistant` | `system`), `Text`,
`ToolUseID`, `ToolName`, `ToolInput` (`json.RawMessage`, verbatim provider JSON),
`ToolOutput`, `IsError`, `Timestamp` (RFC3339, JSON tag `ts`). All optional fields
carry `omitempty` so each event marshals minimally. `Pending` is the **retractable
"agent is waiting on the user" STATE** (not an append-only event) — `ToolUseID`,
`ToolName`, `Text` — derived from an unpaired tool_use at the tail and resolving
when the matching tool_result lands. String constants (`RoleUser`/`RoleAssistant`/
`RoleSystem`, `EventMessage`/`EventToolUse`/`EventToolResult`) are the single
source of truth. `RoleSystem` is reserved — the v1 Claude adapter filters system
lines and never emits it.

#### Scenario: Event marshals with a stable dedup key
- **GIVEN** an adapter has parsed a provider transcript line
- **WHEN** it emits an rk-schema `Event`
- **THEN** the JSON carries the intake's field names + omitempty rules and an `id`
  (the provider line uuid) usable to dedup on the client.

### Requirement: Turn counter assigned by the adapter (`turn` rule)
Each `Event.Turn` SHALL be a monotonic per-conversation counter the adapter
assigns, incrementing at each **user-initiated** message — a user-role message
whose content is NOT solely `tool_result` blocks. A user message carrying only
tool_result blocks (a tool-result *carrier*) continues the current turn; a
string-content user message (a slash command) DOES open a turn (verified: slash
commands are genuine user prompts). Renderers group by the counter; **no synthetic
boundary events** are emitted. The counter starts at 0 and is incremented before a
turn's events are appended (the first real user prompt lands events at turn 1).

#### Scenario: A tool-result-carrier user message does not open a turn
- **GIVEN** a transcript with N user prompts interleaved with assistant turns and
  tool traffic
- **WHEN** the adapter assigns turns
- **THEN** every event carries the turn of the user prompt that opened it, and a
  user message that is solely tool_result blocks does NOT increment the counter.

### Requirement: Pending derived from an unpaired tail tool_use
`Pending` SHALL be derived, never hook-pushed (Constitution X — derivation wins
when a fact is on disk). When a conversational `tool_use` has no matching
`tool_result`, the parser tracks it as *open*; `pending()` returns the
**most-recently-opened** still-unpaired tool_use (walking the open set from the
tail). `Text` is populated when derivable — for `AskUserQuestion` the first
question's `question`/`prompt`/`header` string — else left empty (the marker still
carries `toolUseId`/`toolName`). An idle session ending in a `text` block yields
`nil` Pending. Permission-gated tools fall under the same unpaired-tail rule with
no special-casing; if such a tool's `tool_use` is not persisted until the
permission is granted, Pending under-fills for that class in v1 (the intake's
lone accepted worst case — `@rk_pane_agent_state=waiting` still drives the badge).

#### Scenario: AskUserQuestion tail vs. text tail
- **GIVEN** a transcript whose tail is an `AskUserQuestion` tool_use with no
  following tool_result
- **THEN** the backfill carries a non-nil `Pending` naming that tool_use with the
  derived question text.
- **AND GIVEN** a transcript whose tail is a `text` block, **THEN** `Pending` is nil.

### Requirement: Adapter interface + provider registry (`adapter.go`)
`adapter.go` SHALL declare one `Adapter` interface — `Provider() string` (the
routing key), `Backfill(ctx, ref) (*Conversation, error)`, `TailFrom(ctx, ref,
from int64) (<-chan Update, error)` — plus a `Conversation` result (`Provider`,
`SessionRef`, `Events []Event`, `Pending *Pending`, **`Offset int64`**,
marshalling to `{"provider","sessionRef","events","pending","offset"}`), an
`Update` increment (see below), a package-level `map[string]Adapter` registry
guarded by a `sync.RWMutex`, `Register`/`Lookup`, and the `ErrNoAdapter`
sentinel. Lookup is by the `@rk_pane_chat` provider prefix; a well-formed but
unregistered provider returns `ErrNoAdapter` (the API layer maps it to a
404-class JSON error, so presence-gating stays provider-agnostic and
codex/gemini adapters are additive). The one registered provider is `claude`, from
`claude.go`'s `init()`. Tail is exposed as `TailFrom` (§ Design Decisions →
`TailFrom` supersedes the self-priming `Tail`).

Beside the core interface, `adapter.go` declares the OPTIONAL `TranscriptLocator`
capability — `TranscriptPath(ref string) (string, error)`, resolving a session
ref to its transcript's absolute on-disk path — plus a package-level
`TranscriptPath(provider, ref)` convenience that routes through `Lookup` and
type-asserts to the capability, returning `ErrNoAdapter` for an unregistered
provider or one without it. The capability stays OFF the `Adapter` interface so
the interface remains provider-neutral (a future protocol-based provider may
have no on-disk transcript), and the implementing adapter MUST keep the
ref-format guard in front of every path resolution (§ Claude adapter below).
Its consumer is the operator-request handler's fact pre-derivation
([operator-actuation](/run-kit/operator-actuation.md)). (260822-fih1)

**`Update` (the tail increment)**: exactly one shape per Update — `Events`
(newly-appended events; `Pending` carries the current pending state AFTER them,
emitted as `chat`+`chat-state`) OR `Reset: true`. Under `TailFrom`, a **`Reset` is
a bounded SHRINK/rewrite signal** — its `Conv` is always nil (the producer maps
`Reset`→`chat-reset`, no transcript payload). `TailFrom(ref, from)` primes parser
state by parsing bytes `0..from` (discarded), then emits ONLY bytes `≥ from` as
`Events` — its first emission is NOT a full backfill (the backfill came from the
GET, D5). *(Deletion candidate, recorded by review: `Update.Conv` has no producer
that populates it and no production reader — only tests assert it is nil; a
follow-up may remove the field.)* (260717-vhvz)

#### Scenario: Unregistered provider returns the sentinel
- **GIVEN** a chat ref with an unregistered provider (`codex` in v1)
- **WHEN** the registry is asked for an adapter
- **THEN** `Lookup` returns `ErrNoAdapter`, not a panic or a generic failure.

### Requirement: Claude adapter — locate by UUID glob with a path-traversal guard (`claude.go`)
The Claude adapter SHALL resolve the transcript root as `$CLAUDE_CONFIG_DIR` if
set, else `~/.claude`, and locate the file by glob `{root}/projects/*/<ref>.jsonl`
(the session UUID *is* the filename — no encoded-cwd derivation, robust to
slug-rule drift). **Before ANY filesystem use** the ref MUST match strict UUID
shape (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, `uuidRe`)
— this is the path-traversal guard (Constitution I applied to file paths): a value
carrying `/`, `..`, or glob metacharacters can never reach the glob. A non-UUID
ref returns `ErrInvalidRef` before touching disk; a valid UUID with no matching
file returns the distinguishable `ErrTranscriptNotFound`. Multiple matches (a
resumed session copied across cwds) → first match (they name the same session).
The adapter also implements the registry's optional `TranscriptLocator`
capability (§ Adapter interface): `TranscriptPath(ref)` delegates to
`locateTranscript`, so the strict UUID guard stays in front of the one path
resolution site reachable through the export (its caller is the
operator-request seam — [operator-actuation](/run-kit/operator-actuation.md)).
(260822-fih1)

#### Scenario: A non-UUID ref is rejected before any filesystem access
- **GIVEN** a ref containing `../`, an absolute path, or glob metacharacters
- **WHEN** the adapter is asked to locate the transcript
- **THEN** it returns `ErrInvalidRef` with no glob/stat/open performed.

### Requirement: Tolerant line-by-line JSONL parse
The parser SHALL scan line-by-line, decoding each line into a **loose envelope**
(`type`, `uuid`, `parentUuid`, `timestamp`, `isSidechain`, `sessionId`,
`message{role, content}`) where every field is optional. **`message.content` is
EITHER a JSON array of blocks OR a plain string** (observed: slash-command user
messages are string-content) — `decodeContent` branches on the first non-space
byte (`"` → single text block, `[` → block array; anything else → no blocks). Only
`type` `assistant` and `user` carry the conversation; every other line type
(`permission-mode`, `mode`, `custom-title`, `agent-name`, `last-prompt`,
`attachment`, `file-history-*`, `summary`, `system`, …) is skipped. Block mapping:
`text` → message Event (empty text skipped), `tool_use` → tool_use Event,
`tool_result` → tool_result Event (`content` flattened to text via
`flattenToolResult` — a string verbatim, or the joined `text` of an array of text
blocks, non-text inner blocks dropped for the v1 text-only scope); `thinking` is
skipped in v1 (additive later). Unknown line types, unknown block types, and
malformed (non-JSON) lines are skipped — malformed lines `slog.Debug`-logged and
**counted** (`parser.malformed`, observability), never fatal. Lines with
`isSidechain: true` (subagent traffic) are **excluded** from the v1 stream (an
additive filter flag later; the Task tool_use card in the main conversation still
renders).

#### Scenario: Mixed transcript yields only conversational events
- **GIVEN** a transcript with unknown line types, an unknown block type, a
  malformed line, a string-content user message, and a sidechain line
- **WHEN** the parser runs
- **THEN** it yields only the conversational events, skips the rest without error,
  and the malformed-line count is > 0.

### Requirement: `TailFrom(ctx, ref, from)` — prime-then-emit offset tail
The adapter SHALL expose `TailFrom(ctx, ref, from int64) (<-chan Update, error)`
(the `tailFromLoop`) that **primes parser state by parsing bytes `0..from` and
DISCARDS those events** (turn counter + pending continuity require the full-file
walk — backfill and the tail share one `parser`), then emits ONLY bytes `≥ from`
as `Events` updates and stat-polls the file at the named `tailPollInterval = 400ms`
cadence (**no fsnotify** — one stat per tick per open stream is negligible and
dependency-free) for the life of the stream. Its first emission is NOT a full-`Conv`
`Reset` (the backfill came from the GET, D5).
On **growth** (`size > offset`) it reads from the offset and `consume` parses ONLY
complete (newline-terminated) lines — a partial final line without a trailing
newline is held (its bytes excluded from the consumed count) until its newline
arrives next tick. On **shrink/rewrite** (`size < offset`), AND when the file is
already shorter than `from` at prime time, it emits a bounded `Reset` (a
SHRINK SIGNAL — `Conv` nil; the producer maps it to `chat-reset` so the client
re-composes). A vanished file (transient stat error — session rotated/cleared) is
tolerated: hold the offset and keep polling. The goroutine exits and closes the
channel when `ctx` is cancelled — **no goroutine outlives the stream, no state
beyond the per-connection offset** (Constitution II). Because priming replays
`0..from`, the emitted-tail turn numbers are continuous with the primed prefix.

#### Scenario: A partial final line is withheld; nothing ≤ from is re-emitted
- **GIVEN** `TailFrom(ref, N)` on a transcript of byte length `N`, then a complete
  line appended followed by a partial line
- **WHEN** the next poll tick fires
- **THEN** the ONLY events delivered are the newly-appended complete line (nothing
  from `0..N` is re-emitted, its turn continuous with the primed prefix) and the
  partial line is withheld until its newline arrives.

### Requirement: Backfill endpoint `GET /api/windows/{windowId}/chat` (`api/chat.go`)
`handleChatBackfill` SHALL validate the `{windowId}` (`parseWindowID`, `400` on
malformed), resolve the window's **reconciled** `@rk_pane_chat` rollup server-side via
`resolveWindowChat` (`FetchSessions` + a window lookup by stable `WindowID`,
reading the rolled-up `ChatProvider`/`ChatSessionRef` by the active-pane-first /
else-first-pane rule), route to the provider adapter, and return
`{"provider","sessionRef","events","pending","offset"}` as JSON. The **`offset`
field** carries the transcript byte offset the backfill parse read up to —
`Backfill` populates it from `backfillFromPath`'s end offset. It supplies the
state-socket subscribe's `from`, so `GET(offset)→subscribe(from)` composes
gap-free/duplicate-free (§ Live stream). (260717-vhvz)
It NEVER trusts a client-supplied ref (URLs carry no session UUIDs). It is a GET
(Constitution IX) and curl-able. `resolveWindowChat` distinguishes a
**FetchSessions failure**
(non-nil error → `500`, mirroring `handleSessionsList`) from a **genuine no-chat**
(`ok=false`, nil error → `404`) — a transient tmux fault is never misreported as
"no chat session".

#### Scenario: Live claude window returns rk-schema JSON
- **GIVEN** a live `claude` window with a reconciled `@rk_pane_chat`
- **WHEN** a client GETs the backfill route
- **THEN** it returns `200` with the conversation as rk-schema JSON.

## Live stream — `kind:"chat"` subscription on `/ws/state`

The live incremental stream is a subscription kind on the state socket
(§ Design Decisions → Chat live stream on the state socket). The backend lives in
`app/backend/api/chat_ws.go`; the wire
envelope + `stateSubscribe`/`stateUnsubscribe` dispatch are in
[architecture](/run-kit/architecture.md) § State Socket. The `kind:"chat"` arm
does NOT join the tmux poll set — transcript appends generate no tmux events (the
recorded reason chat had a dedicated stream) — so each subscription instead owns
a per-subscription producer goroutine.

### Requirement: `kind:"chat"` subscribe/ack (offset composition, D5)
A `kind:"chat"` subscribe SHALL carry `key:<windowId>`, `server:<tmux server>`
(the existing `clientMsg.Server`), `from:<byteOffset>` (`clientMsg.From int64`,
`from` JSON), and `req`. `startChatSubscribe` (`chat_ws.go`) SHALL validate
`msg.Key` via `validate.ValidateWindowID` and `msg.Server` via
`validate.ValidateServerName` (Constitution §I) — an invalid value → an `error`
frame carrying `req`, no subscription/producer. Following the **terminals-mux S2
pattern**, it registers a placeholder producer synchronously under `h.mu`, then
does resolve+`Lookup`+ack **in the producer goroutine** (never on the socket read
loop — a stalled `FetchSessions` must not freeze the connection's other ops). The
ack SHALL carry the tail-start byte `offset` (`ackFrame.Offset int64`,
`omitempty`) and **NO snapshot** (D5 — the transcript came from the GET backfill);
the ack is enqueued before the producer's first emit (ack-before-first-emit
ordering). A repeat subscribe for the same `(server,windowId)` cancels+replaces
the prior producer (new `from` → fresh tail).

- **GIVEN** a state-socket connection and a resolvable chat window
- **WHEN** it sends `{op:"subscribe",kind:"chat",key:"@1",server:"default",from:0,req:3}`
- **THEN** the server replies `{op:"ack",req:3,offset:<N>}` (no `snapshot`) and
  begins emitting `kind:"chat"` events from byte `from` onward.

### Requirement: chat events — verbatim `chat`/`chat-state` + lightweight `chat-reset`
The producer SHALL emit `kind:"chat"` `event` frames with two data-bearing types:
`chat` (`ChatEvent[]` — appended events) and `chat-state` (`{pending}`, always
emitted incl. `null`). On rotation/shrink it SHALL emit a lightweight `chat-reset`
(`data:{}`, no transcript payload — a rotation can target a large resumed session,
so pushing a `Conversation` over the shared socket would break D5's
bounded-event-size rationale; the client re-runs its GET-backfill→subscribe on
reset). `chat-backfill` SHALL NOT ride the socket (backfill is the GET's job).
A `chat-error` (`{error}`) constant exists as **client-facing protocol tolerance**
(the hook renders it inline) but **the producer never emits it today** — every
failure path converges via DORMANT→`chat-reset` or the subscribe-time `error`
frame instead of a terminal chat-error (recorded honestly; `chatEventError` is a
zero-emit deletion candidate — § Design Decisions / plan Deletion Candidates).

- **GIVEN** an acked chat subscription and a new complete transcript line
- **THEN** a `{…,type:"chat",data:[…]}` frame is emitted, followed by
  `{…,type:"chat-state",data:{pending:…}}`.
- **AND GIVEN** the resolved ref rotates (or the file shrinks below `from`),
  **THEN** a `{…,type:"chat-reset",data:{}}` frame is emitted instead of a
  transcript payload.

### Requirement: per-subscription TAIL/DORMANT producer (rotation, not-yet, backpressure)
Each chat subscription SHALL own a `chatProducer` goroutine bound to a
`context.Context` cancelled on unsubscribe, on connection drop (`dropStateConn`),
and on a repeat subscribe for the same key — **no goroutine outlives its
subscription** (Constitution II). It runs a two-phase machine:
- **TAIL**: an incremental `TailFrom(ref, from)` ships ONLY the bytes the client's
  GET did not carry (`Events` → `chat`+`chat-state`).
- **DORMANT**: on a **rotation** (the ~2s `chatRefResolveInterval` re-resolve —
  session rotation via `/clear`/`/compact` re-stamps `@rk_pane_chat` within one hook
  fire — sees a fresh ref) OR a **shrink** (`TailFrom`'s `Reset`), the producer
  cancels the tail and — crucially — does NOT re-tail the new ref from 0 (that
  would re-stream a whole conversation over the shared socket, violating D5).
  It emits a single `chat-reset` **ONLY once the rotated-to transcript EXISTS**
  (probed via `transcriptExists`, a `TailFrom(ref,0)` cancelled immediately —
  tolerant of `ErrTranscriptNotFound`/`ErrInvalidRef`), re-emitting each tick
  until the client's re-subscribe REPLACES this producer with a fresh tail. This
  preserves the **lazy-transcript "not yet" tolerance** (Claude Code writes the
  `.jsonl` only on the first prompt while `@rk_pane_chat` re-stamps at `SessionStart`)
  on BOTH the initial subscribe and rotation — the client cannot 404-wedge because
  no `chat-reset` fires until the file is resolvable (and the hook additionally
  retries a GET 404 on a 500ms backoff).
- **Backpressure recovery**: a dropped `chat`/`chat-state` `hubEvent` (send channel
  full — `sendConnLockedOK` returns false) sets `pendingReset`, flushed as ONE
  `chat-reset` when the channel drains (`flushPendingReset`), so a lost incremental
  frame converges the client via re-composition rather than a permanent gap.

- **GIVEN** an acked chat subscription
- **WHEN** the client unsubscribes, disconnects, or repeat-subscribes the same key
- **THEN** the producer goroutine's context is cancelled and it exits.
- **AND GIVEN** the window's `@rk_pane_chat` re-stamps to a session whose transcript
  does not exist yet, **THEN** the subscription stays live (no `chat-error`) and
  once the file appears a single `chat-reset` fires so the client re-composes.

### Requirement: subscribe-time resolve failure → `error` frame carrying `req`
A subscribe-time resolve failure that today maps to an HTTP status (no chat for
the window / no adapter / a `FetchSessions` fault) SHALL become a state-socket
`error` frame carrying `req` (`failSubscribe`) — the GET backfill remains the
surface where those show as HTTP statuses — and SHALL leave no zombie producer
(the placeholder is dropped).

- **GIVEN** a chat subscribe for a window with no reconciled chat (or an
  unregistered provider)
- **THEN** the hub emits an `{op:"error",req:<req>,…}` frame and starts no producer.

### Requirement: Error surfaces
The **GET backfill** SHALL return, as JSON error objects (`writeError` shape):
`400` on invalid `{windowId}`; `404` when the window has no reconciled chat; a
404-class "no adapter for provider" for a well-formed unknown provider; and a
404-class response (via `writeChatReadError`) when the transcript is missing
(`ErrTranscriptNotFound`) or the reconciled ref is malformed (`ErrInvalidRef`) for
a live ref — because the client only ever supplies a windowID, a bad ref is a
property of the reconciled `@rk_pane_chat`, not a server fault; any other adapter read
error is a `500`. On the **state-socket subscription**, the equivalent
subscribe-time failures surface as an `error` frame carrying `req` (above), and a
transient/not-yet tail failure goes DORMANT (converging via `chat-reset`) rather
than surfacing a terminal error — there is no terminal `chat-error` frame.

> **Residual (should-fix, OPEN).** A subscribe `error`
> frame is currently **swallowed client-side**: the R5-path transient resolve
> fault (a fault between the GET backfill and the async producer resolve) leaves
> the lens wedged un-acked (gray dot, no inline error, no retry) until a lens
> toggle or socket reconnect. Fix direction: route `req`-mapped error frames
> through the chat handler seam so the hook sets `error` or re-composes.
>
> **Residual protocol races (record-only).** (1) Byte offsets carry no file
> identity, so a rotation landing in the GET→subscribe window onto an EXISTING
> LONGER transcript whose byte-`from` coincides with a line boundary tails a
> DIFFERENT conversation with no reset (every other alignment is caught by
> `TailFrom`'s `offset<from`→`Reset`); fix if ever needed: echo `sessionRef` on
> the subscribe frame for a compare-only equality check. (2) Chat frames route by
> `windowId` alone client-side (no server scoping), so a stale in-flight frame
> from server A's `@1` can route into server B's `@1` lens in a narrow reorder
> window — self-heals on the next backfill REPLACE.

## Send Path

The mutating half of the subsystem: a single `POST` endpoint that injects a typed
message into the window's resolved agent pane. It reuses the read side's
window-keyed / server-resolved contract (the client supplies only a windowID + the
text; the pane is re-resolved server-side per request) and the same
`writeError`/status-mapping vocabulary. The handler lives in `api/chat.go` over
pane-targeted `internal/tmux` primitives. The
`injectIntoPane` (`api/chat.go`) is the thin adapter over `chatSendEngine` +
`chatSendTmux` used by chat send and the two operator-request routes. The operator-request handlers
(`api/operator.go`) deliver rendered prompts through the SAME engine
(`submit:true`) into the OPERATOR window's resolved pane — same
per-(server,paneID) lock, shared deadline, sanitize, novelty probe, observation,
and recovery — after their own session resolution and busy gate
([operator-actuation](/run-kit/operator-actuation.md); that endpoint's busy
policy is REJECT, unlike this path's Allow + probe below) (260822-fih1). The
compose strip's `POST /api/windows/{windowId}/send` (`api/send.go`) resolves the
window's **active** pane with no chat-session requirement. Its text-bearing modes
all use this engine and adapter: `submit`/`insert-line` call `Engine.Send`, while
`raw` calls `Engine.SendRaw`; `enter` calls `Engine.PressEnter`. Thus every compose
send enters the same per-pane serialization domain, while probed modes retain the
sanitize → paste → probe → optional Enter → observation/recovery contract and
machine-readable 409 mapping
([api-and-sockets](/run-kit/api-and-sockets.md);
[ui/compose-and-bottom-bar](/run-kit/ui/compose-and-bottom-bar.md)) (260830-s7wp).

**Two frontend consumers, one unchanged per-window contract.** The chat lens's
own send form (§ Send-form input box) is the single-window one. The second is the
sidebar selection's **bulk prompt broadcast** (`Selection: Send prompt to N agents`
→ `executeBulkSend` — [ui/sidebar](/run-kit/ui/sidebar.md) § Window-Row
Multi-Select): one `sendChatMessage(server, windowId, text)` per selected window,
**N-sequentially** and continue-on-error, each request carrying its own
`?server=` (a selection may span tmux servers) and the default `submit:true`. It
is a client-side fan-out only — there is **no batch endpoint and no batch body**,
and every per-request semantic is untouched: the whole-sequence lock, the shared
injection deadline, sanitize pass, novelty probe, post-Enter observation, and
evidence-gated recovery all run per window. A probe failure or submit-unverified
outcome surfaces as that window's structured `409` (§ Injection 409 outcomes),
which the batch records as one recipient's failure and steps past rather than
aborting the remaining sends. The
broadcast's own `200` count is what the frontend calls **delivered**, and it
drives whether the composed prompt is cleared or retained for a retry.
(260808-ebgs)

### Requirement: Send endpoint `POST /api/windows/{windowId}/chat/send`
The backend SHALL expose `POST /api/windows/{windowId}/chat/send?server={server}`
(mutation ⇒ POST, Constitution IX), registered next to the two GET chat routes and
implemented as `handleChatSend`. The JSON body is `{"text": "<message>", "submit"?:
bool}` — `chatSendRequest{ Text string; Submit *bool }`. The **`submit` boolean is
additive and optional, defaulting to `true` when absent** (`submit := body.Submit ==
nil || *body.Submit`), so an older client's `{"text": …}` body is byte-for-byte the
current always-submit behavior. `submit:false` is **insert-without-submit**: the text
is pasted into the pane's input box but the final gated Enter is skipped (§ Pane-targeted
injection sequence). The handler validates `{windowId}` (`parseWindowID`, `400`),
rejects an empty/whitespace-only or undecodable body (`400`), then re-resolves the
target pane server-side (§ Server-resolved pane) before injecting. Success is
`200 {"ok":true}` for both modes. The existing generic `POST /api/windows/{windowId}/keys`
endpoint SHALL be left untouched (different contract, possible external callers).

#### Scenario: Malformed id or empty text is rejected before any injection
- **GIVEN** a request with a malformed `{windowId}`, an undecodable body, OR a
  `text` that is empty/whitespace-only
- **WHEN** `handleChatSend` runs
- **THEN** it returns `400` with a `writeError` JSON body and performs no tmux
  injection.
- **AND GIVEN** a body carrying no `submit` field (or `submit:true`), **THEN**
  `submit` resolves to `true` and behavior is byte-identical to the always-submit
  path; **AND GIVEN** `{"text":…,"submit":false}`, **THEN** the paste/probe run but
  the final Enter is withheld.

### Requirement: Send-text sanitization at the handler boundary
`handleChatSend` SHALL sanitize `body.Text` via the exported pure helper
`inject.Sanitize` (`internal/inject`) immediately after the JSON decode and BEFORE the
whitespace-only emptiness check. `inject.Sanitize` normalizes `\r\n` and lone `\r`
to `\n`, then drops every control rune per `unicode.IsControl` — C0 (U+0000–U+001F),
DEL (U+007F), and the C1 range (U+0080–U+009F, including the single-byte CSI
U+009B) — EXCEPT `\n` and `\t`, which are legitimate message content (multiline
messages and indented code). Ordinary text, non-ASCII runes (accents, emoji), `\n`,
and `\t` pass through unchanged. Because the sanitize runs before the emptiness
check, a message that is entirely control bytes collapses to the empty string and
takes the existing `400` path without touching tmux. Because it runs before pane
resolution and injection, every downstream consumer (`inject.Needle`, the
collapsible-paste detection via `strings.Contains(text, "\n")`, the engine's
set→paste critical section, the echo
probe) operates on the already-sanitized text. The sanitize is caller-side policy
only — the `internal/tmux` wrappers stay byte-faithful (Constitution I), and the
read/backfill endpoints are untouched.

#### Scenario: ESC and other control bytes stripped; all-control text 400s
- **GIVEN** a send whose text embeds an ESC (`0x1B`) that would form the
  bracketed-paste-end sequence `\x1b[201~`
- **WHEN** `handleChatSend` sanitizes it
- **THEN** the ESC is stripped (leaving the inert literal `[201~`), so the text
  recorded at `set-buffer` cannot terminate the paste early to inject live
  keystrokes; C0/DEL/C1 controls are likewise removed while `\n`/`\t`/accents/emoji
  survive and `\r\n`/`\r` become `\n`.
- **AND GIVEN** a send whose text is entirely control bytes, **THEN** it collapses
  to empty and the handler returns `400` ("Message text cannot be empty") with no
  tmux injection.

### Requirement: Server-resolved pane (never trust a client ref)
The handler SHALL derive the target **pane** server-side by extending
`resolveWindowChat` to also return the resolved `paneID` — the pane picked by the
SAME rollup rule as chat read (active-pane-first, else the first chat-carrying
pane), now the single `sessions.ResolveChatPane(panes) (provider, ref, paneID)`
helper that `rollupChat` delegates to. Injection targets that `paneID`, NEVER the
window id: a window `-t` target routes to the session's *active* pane, which in a
split may not be the agent pane. The client supplies neither a pane nor a session
ref. A `FetchSessions` failure maps to `500`; a window that is absent or carries no
reconciled chat maps to `404` — mirroring the read endpoints.

#### Scenario: Injection targets the resolved pane, not the window
- **GIVEN** a window `@N` whose reconciled chat pane is `%2`
- **WHEN** the handler resolves the target
- **THEN** every injection subprocess targets `%2` (the resolved `PaneID`), never
  `@N`; **AND GIVEN** `FetchSessions` errors → `500`; **AND GIVEN** no reconciled
  chat → `404`.

### Requirement: Pane-targeted injection sequence via argv slices
On a resolved pane the handler SHALL inject the message through the shared
`internal/inject` engine — reached via the thin provider-agnostic adapter seam
(`injectChatMessage`, `api/chat.go`, delegating to the package-level
`chatSendEngine = inject.NewEngine(tmux.ChatSendBuffer)`) — running this exact
ordered sequence,
every subprocess an argv slice (Constitution I) targeting the `paneID`, each
spawned through the shared runner core with `TMUX`/`TMUX_PANE` stripped from the
child env ([architecture](/run-kit/architecture.md) § tmux Runner Core):
1. **Baseline capture** — `CapturePane` the pane tail BEFORE mutating anything (the
   probe floor, § Novelty echo probe).
2. `set-buffer -b rk-chat-send -- <text>` — text as one discrete argv element (no
   shell string, no stdin — `tmuxExecServer` has no stdin plumbing). The **`--`
   option terminator is load-bearing**: without it a message that starts with a
   dash (`--force is broken`) is parsed as `set-buffer` flags and hard-fails; with
   it, leading-dash text stores verbatim (verified tmux 3.6a). A **named** buffer
   (`tmux.ChatSendBuffer = "rk-chat-send"`) avoids clobbering the user's anonymous
   buffer stack.
3. `paste-buffer -d -p -b rk-chat-send -t <paneID>` — `-p` bracketed paste (the
   Claude Code TUI enables bracketed paste, so multiline + special characters land
   as one literal block, no per-line submission); `-d` deletes the buffer after
   pasting so the buffer set stays clean.
4. **Probe** (§ Novelty echo probe) — only on success:
5. `send-keys -t <paneID> Enter` — the literal `Enter` key, sent ONLY after a
   successful probe **AND** when `submit` is true.
6. **Post-Enter observation** — sleep then capture over `SubmitBackoff`
   (`40/80/160/320/640ms`), exiting on the first normalized frame change. A
   changed frame makes no claim about submission and returns success. Only a
   frame unchanged through every step with the established paste echo still
   present is evidence of non-submission.
7. **Evidence-gated recovery** — only on that non-submission verdict, send
   pane-scoped `C-u` up to `ClearAttempts = 4` until the normalized frame equals
   the pre-paste baseline, then re-paste, re-probe, send Enter, and observe over
   the first `SubmitRetryBackoffSteps = 3` ladder steps. `SubmitRetries = 1`.

`injectChatMessage(ctx, server, paneID, text, submit bool)` is the thin adapter
that forwards the resolved boolean to `inject.Engine.Send`. **`submit:false`
(insert-without-submit) skips steps 5–7** — the baseline
capture, handler-boundary sanitize, named-buffer set/paste, novelty echo probe (a
probe failure still returns the structured `409`, Enter irrelevant but the text left
recoverable in the composer), the engine's per-`(server,paneID)` whole-sequence lock
and set→paste critical-section mutex, and the handler's single
`chatSendTotalBudget` deadline still apply.
The insert-only path still requires a passing probe (the paste must have echoed); it
just leaves the text staged in the pane's input box without pressing Enter, so a
human — or a later submit — completes it.

There SHALL be NO `agentState` gate and NO server-side queue (busy policy =
Allow + probe, Constitution II). The text reaching `set-buffer` is the
handler-sanitized string (§ Send-text sanitization) — control bytes stripped,
CR/CRLF normalized to `\n`; from that point delivery to tmux is verbatim. Newlines,
tmux key names (`Enter`, `C-c`), and leading dashes in the sanitized text are all
delivered literally — never interpreted as keys/flags nor submitted per-line.
There SHALL be NO pre-Enter quiescence gate on either the initial or recovery
path.

#### Scenario: Key-name / leading-dash text is delivered literally
- **GIVEN** a resolved pane and text `"--force is broken\necho Enter"`
- **WHEN** injection runs
- **THEN** the order is baseline → set-buffer (`--`-terminated) → paste-buffer →
  probe → send-keys → observation, the text is one literal argv element (never
  parsed as flags/keys), and Enter is a separate step gated on the probe.
- **AND GIVEN** `submit:false` with a passing probe, **THEN** set-buffer/paste/probe
  all run against the resolved pane and `SendEnterToPane` is NEVER called (response
  still `200 {"ok":true}`); **AND GIVEN** `submit:false` with a failing probe,
  **THEN** the response is `409` and no Enter is sent.

### Requirement: NOVELTY echo probe (fail-closed), settle + bounded retry
Before Enter the handler SHALL verify the pasted text ECHOED into the pane's live
input buffer, using **novelty**, not mere presence: it counts a probe **needle**
(and, when the paste is *collapsible*, the paste-collapse placeholder) in the
pre-paste **baseline** capture, then requires that count to strictly INCREASE in a
post-paste capture. The needle is derived from the LAST non-empty line of the text,
whitespace-stripped (both needle and capture stripped of ANSI + all whitespace so
an ~80-col TUI wrap cannot split the fragment) and capped to the last
`inject.NeedleMaxLen = 40` runes. A paste is **collapsible** when it is multiline
OR a single line of at least `inject.CollapseMinRunes = 200` runes — the Claude
Code TUI collapses such a paste into a chip, so the chip is a valid fresh-echo
signal. `pasteCollapseRe` matches BOTH chip forms whitespace-stripped:
`[Pasted text #N +M lines]` (multiline collapse) and the suffix-less
`[Pasted text #N]` (long-single-line collapse), with the `+M lines` suffix optional.
The chip counts as a successful echo ONLY when the paste is collapsible and ONLY as
a *fresh* occurrence vs baseline; a short single-line send keeps exact-needle-only
matching. A short settle (`inject.ProbeSettle = 80ms`)
precedes the first capture, then up to `inject.ProbeAttempts = 8` captures with an
`inject.ProbeGap = 80ms` gap (settle/gap are package **vars** solely so tests can
shrink them). The wall-clock probe ceiling is about 640ms (`80 + 7*80`), shared
with the post-Enter observation tail and bounded recovery under the caller's 4s
deadline; the first successful capture still returns after one settle. The probe
**fails closed**: an empty needle, a pane that scrolls
between baseline and probe, or a count that never rises → `inject.ProbeFailure` → no
Enter, `409`. This is the guard against a blind Enter into e.g. a permission
dialog. A probe `CapturePane` subprocess error or context failure is NOT a clean
miss — the paste already landed, so it surfaces as `inject.StagedSendFailure` →
`409` (§ Injection 409 outcomes), the staged-text recoverable state. (Pre-paste
failures — baseline capture, set-buffer, paste-buffer — keep the plain
wrapped-error → `500` path: nothing was delivered.)
(260830-s7wp)

#### Scenario: A stale chip / common needle already in-frame does not false-pass
- **GIVEN** a baseline capture that ALREADY contains the needle or a paste-collapse
  chip (e.g. a prior send's 409 left its text in the composer, or a short needle
  like `ok`)
- **WHEN** the paste does not add a fresh occurrence (or the pane scrolls)
- **THEN** the count does not strictly increase, so no Enter is sent and the
  response is `409` — the stale occurrence is a floor to beat, not a false positive.
- **AND GIVEN** the text (or, for a collapsible paste, its paste-collapse chip in
  either form) newly appears within the retry budget, **THEN** Enter is sent and the
  response is `200 {"ok":true}`.

### Requirement: Post-Enter observation detects non-submission only
After each Enter the engine SHALL compare `stripForProbe`-normalized whole-pane
captures with the echo probe's winning capture. The first changed frame SHALL
return success immediately without claiming that submission occurred. Only a
frame unchanged through every `SubmitBackoff` step with the paste echo still
present under `CountOccurrences(capture, needle, collapsible)` SHALL authorize
recovery. Any unchanged frame without that echo SHALL return
`inject.SubmitUnverified` without recovery. Context cancellation and capture
errors during observation SHALL surface as `inject.SubmitUnverified` wrapping the
cause — Enter was already sent, so submit-unconfirmed is the honest state.

Recovery SHALL re-paste only after a post-`C-u` capture is normalized-equal to
the pre-paste baseline. It SHALL make at most `SubmitRetries = 1` retry, use the
first three observation steps after that retry, and return
`inject.SubmitUnverified` when the clear cannot be established or the retry
still has no changed frame. Within a retry, a failure after the re-paste but
before the retry's Enter classifies staged (`inject.StagedSendFailure`); a
failure after the retry's Enter is submit-unverified. A frame change caused by a spinner, streaming output,
a status line, or a submit follows the same no-claim success branch.

#### Scenario: Changed frames never authorize recovery
- **GIVEN** a pane whose frame changes at any observation step
- **WHEN** the engine observes it after Enter
- **THEN** the request succeeds with no `C-u` or re-paste and with no assertion
  that submission was confirmed.
- **AND GIVEN** a frame byte-identical through every step with the paste echo
  still present, **THEN** recovery runs only after a baseline-equal clear.

### Requirement: Injection 409 outcomes remain distinguishable
On probe failure the handler SHALL send no Enter and return `409` with a structured
message that names the recoverable state and steers away from a duplicating retry:
`"agent input not ready — message pasted but not echoed; Enter withheld. The text
remains in the agent's input — check the terminal view before retrying, as a
resend would duplicate it."` The pasted text legitimately remains in the TUI input
box (visible, recoverable) — strictly better than a blind Enter. The failure is
surfaced, never silent. The retry hint matters because the paste (not the Enter)
already landed, so an identical resend would paste a SECOND copy and submit doubled
text.

On `inject.StagedSendFailure` — an infrastructure failure AFTER the paste landed
but BEFORE Enter was sent (a probe capture error, a context failure mid-probe,
or a refused `send-keys Enter`) — the handler SHALL return `409` with code
`staged_send_failure` and the sentinel's staged-text message: the text IS staged
in the pane, a resend would duplicate it, and the recovery is pressing Enter in
the pane.

On `inject.SubmitUnverified` the handler SHALL return `409` with the sentinel's
distinct submit-unconfirmed message, wrapping the underlying cause when one
exists (post-Enter capture/deadline faults surface here). Enter has been sent in
this case, so the message SHALL state that the payload may or may not have
landed and direct the caller to capture the pane before resending.
`ProbeFailure`, `StagedSendFailure`, and `SubmitUnverified` SHALL remain
distinct error types because they give different resend guidance.

#### Scenario: Probe failure leaves the paste visible and withholds Enter
- **GIVEN** a paste whose echo cannot be verified across all retries
- **WHEN** the probe exhausts
- **THEN** no Enter is sent, the response is `409` with the retry-hinted message,
  and the pasted text stays in the agent's composer.
- **AND GIVEN** a post-paste, pre-Enter infrastructure failure (e.g. a refused
  `send-keys Enter`), **THEN** the response is `409` with code
  `staged_send_failure` and the staged text stays in the agent's composer.
- **AND GIVEN** post-Enter non-submission whose bounded recovery does not produce
  a changed frame, **THEN** the response is `409` with the submit-unconfirmed
  message.

### Requirement: Per-(server,paneID) whole-sequence lock + shared-buffer mutex
Concurrent injections SHALL be serialized so no two cross texts or double-submit. The
`internal/inject` engine holds a **per-(server,paneID) mutex** (a guarded, never-evicted
`map[string]*sync.Mutex`, keyed `server\x00paneID`) across the WHOLE sequence
(baseline → set → paste → probe → Enter → observation/recovery → return) so a
second send to the SAME pane only
begins after the first fully finishes — closing the same-pane double-paste window
(two sends racing one composer both pasting before either probes → merged
submission). `Engine.SendRaw` holds that lock across set-buffer → raw paste, and
`Engine.PressEnter` holds it across the Enter, so neither primitive can interleave
with a probed sequence on the same pane. DISTINCT panes stay fully concurrent
(each takes its own lock). Because
the named tmux buffer (`rk-chat-send`) is a single server-wide resource with rk as
its sole writer, the set → paste critical section is ADDITIONALLY guarded by a small
per-engine mutex (the engine's `setPasteMu`) **nested inside** the per-pane lock — held
only for those two fast subprocesses, including `SendRaw` — so cross-pane sends cannot interleave as
A-set / B-set / A-paste (pane A would receive B's text; B's own `-d` paste would
500 on the already-deleted buffer). (260830-s7wp)

#### Scenario: Same-pane sends serialize; distinct panes stay concurrent
- **GIVEN** two concurrent sends to the same `(server,paneID)`
- **WHEN** both run
- **THEN** the second observes the first's completed sequence (never an in-flight
  paste), so no doubled submission and no crossed text; **AND GIVEN** two sends to
  DIFFERENT panes, **THEN** they run concurrently (only the brief shared set→paste
  window serializes across panes).

### Requirement: One shared injection deadline (route stays under 5s)
The whole injection sequence — every tmux subprocess plus the probe and submit
backoffs — SHALL run under ONE shared context deadline (`chatSendTotalBudget`,
default `4s`, a package var only so tests can shrink it), derived from the request
context (a client disconnect also cancels the subprocesses). The individual tmux
primitives are the caller's-context `*Ctx` variants that do NOT each impose their
own timeout, keeping the route under the code-review 5s route-blocking rule. The
full observation ladder exits early on a changed frame; recovery uses only its
first three steps. `muxCmdTimeout` remains 5s on the CLI path.

#### Scenario: A stalled tmux cannot block the route past the budget
- **GIVEN** a tmux subprocess that stalls
- **WHEN** the shared deadline elapses
- **THEN** the sequence aborts (the ctx cancels every remaining subprocess) rather
  than blocking the route for multiples of 5s.

### Requirement: Pane-targeted tmux primitives and the injection interface
`internal/tmux` SHALL carry the pane-targeted primitives the injection needs:
`SetChatSendBufferCtx`, bracketed `PasteChatSendBufferCtx`, raw
`PasteChatSendBufferRawCtx`, `SendEnterToPaneCtx`, and the `ChatSendBuffer` name
constant (see [tmux-sessions](/run-kit/tmux-sessions.md)). The generic raw primitive
is `PasteBufferRawCtx(ctx, name, paneID, server)`, issuing
`paste-buffer -d -r -b <name> -t <pane>`: `-r` preserves LF bytes and the absence
of `-p` avoids bracketed-paste markers. `inject.Tmux` SHALL expose the matching
`PasteBufferRaw` method beside `PasteBuffer`.

`api/router.go`'s `TmuxOps` interface (with `prodTmuxOps` + the test `mockTmuxOps`)
SHALL surface these as `SetChatSendBuffer` / `PasteChatSendBuffer` /
`PasteChatSendBufferRaw` / `SendEnterToPane` / `SendKeysToPane` / `CapturePane` so
the handlers are fully testable against the fake. `SendKeysToPane` is context-bound
and sends recovery's `C-u` to the resolved pane. `SendKeys` remains the separate
window-targeted `/keys` helper. (260830-s7wp)

#### Scenario: The status matrix is exercisable against a fake tmux
- **GIVEN** the handler driven by `mockTmuxOps`
- **WHEN** the test injects capture results / errors per primitive
- **THEN** the full 400/404/409/500/200 matrix, injection order, and
  no-Enter-on-probe-failure are exercisable with no live agent pane.

## Design Decisions

### Go JSONL tail, not a node SDK shim
**Decision**: Parse the Claude transcript directly in Go — locate by UUID glob,
tolerant line-by-line parse, byte-offset stat-poll tail.
**Why**: No node runtime dependency, natural live tailing, rk stays one
brew-installed binary. The Agent SDK read surface (`listSessions`/
`getSessionMessages`) is one-shot with no tail/subscribe and churns (the
experimental V2 session API was removed in TS SDK 0.3.142); a live tail under a
shim would be poll-respawn.
**Rejected**: A node shim via `exec.CommandContext` (dependency creep,
poll-respawn); a pane-resident sidecar (most moving parts).
**Cost + mitigation**: The JSONL line format is officially internal/unsupported
and can drift across Claude Code versions — mitigated by a **tolerant parser**
(skip-don't-fail on every unknown/malformed shape) plus a **pinned fixture** test
(`testdata/claude_session.jsonl`, sanitized, recording the producing Claude Code
version — **2.1.209** at ship) run against synthetic drift cases (unknown line
type, unknown block, malformed line, truncated final line, string-content message,
sidechain exclusion). Re-verify and re-pin on a version whose transcript shape
changes.
*Introduced by*: `260714-pmfh-chat-read-backend`

### Window-keyed routes, server-resolved ref
**Decision**: Both endpoints key on `{windowId}` (mirroring every
`/api/windows/{windowId}/*` route, `?server=` query); the backend re-resolves the
reconciled `@rk_pane_chat` rollup server-side per request/tick.
**Why**: URLs carry no session UUIDs, and the backend never trusts a
client-supplied ref over the reconciler — the same reconciliation `FetchSessions`
applies.
**Rejected**: Ref-in-URL (stale/spoofable).
*Introduced by*: `260714-pmfh-chat-read-backend`

### Reset-on-reconnect stream contract (no cursor)
**Decision**: The stream carries no per-event resume cursor. The owner hook
re-runs GET-backfill→subscribe on socket reconnect (or an `rk serve` restart
mid-conversation) and on `chat-reset` — a full re-derive from disk composed with
`subscribe(from:offset)`.
**Why**: Matches the plan acceptance ("loses nothing — full re-derive on
reconnect") and avoids a backfill/tail gap race; the only retained state is the
per-connection byte offset, which dies with the connection.
**Rejected**: A cursor protocol (additive later).
*Introduced by*: `260714-pmfh-chat-read-backend`

### Chat live stream on the state socket, backfill demoted to the GET
**Decision**: The chat live stream is a `kind:"chat"` subscription on `/ws/state`,
not a dedicated SSE endpoint. Backfill demotes to the existing
`GET /api/windows/{id}/chat` (which gains an additive byte `offset`); the subscribe
carries `from:<offset>` and the ack returns the tail-start offset (NO snapshot),
so `GET(offset)→subscribe(from)` composes gap-free/duplicate-free. `chat-reset`
(`{}`, no transcript) signals rotation/shrink; the client re-runs the composition.
**Why**: chat was the app's last `EventSource` — one HTTP/1.1 pool slot on
plaintext origins, the exact starvation socket-unification exists to eliminate
(the tab is now a fixed 2 WS + 0 SSE, D6). Demoting backfill to the GET (D5) keeps
a big transcript from head-of-line-blocking session-state events on the shared
socket, and a rotation can target a large resumed session — so a full
`Conversation` must never ride `/ws/state`; the byte-offset-tailed JSONL adapter
makes exact gap-free composition possible without client id-dedup of an overlap
window.
**Rejected**: snapshot-in-ack (unbounded event size on a rotation to a large
session — D5); pushing the full backfill on `chat-reset` (same); merging `/ws/state`
and `/ws/terminals` (D6, decided against plan-wide).
*Introduced by*: `260717-vhvz-chat-on-state-socket`

### `TailFrom(from)` is the sole tail method (no self-priming `Tail`)
**Decision**: The adapter exposes only `TailFrom(ctx, ref, from)` (primes `0..from`
discarding those events, then emits ONLY bytes `≥ from`); the `Adapter` interface
carries no self-priming `Tail` whose first Update is a full-`Conv` `Reset`. Under
`TailFrom`, `Reset` is a bounded SHRINK signal with `Conv` always nil.
**Why**: The tail's job is purely "emit bytes ≥ from" — backfill is the GET's job,
so the tail never needs to prime a first-`Reset`-with-`Conv`. A self-priming `Tail`
alongside `TailFrom` would be dead code (no caller once backfill is the GET's).
**Rejected**: keeping both methods on the interface (the `Tail` method would have
no caller).
*Introduced by*: `260717-vhvz-chat-on-state-socket`

### Rotation goes DORMANT, never re-tails from 0
**Decision**: On a rotation (~2s re-resolve sees a fresh ref) or a shrink, the
per-subscription producer CANCELS the tail and goes DORMANT — it does NOT re-tail
the new ref from `0`. It emits a single `chat-reset` ONLY once the rotated-to
transcript EXISTS (probed via `transcriptExists`), re-emitting each tick until the
client's re-subscribe REPLACES the producer with a fresh `from`.
**Why**: the first cut re-tailed the new ref from `from:0`, so the rotated-to
transcript's whole pre-existing contents rode the socket as one giant `chat` frame
(violating "chat-reset is emitted INSTEAD OF a transcript payload; full
conversations never ride the socket"); on the `/clear` path an early `chat-reset`
404'd the client's re-compose GET with no fresh reset when the file finally
appeared, while the `from:0` tail appended the new session onto the stale view.
Going dormant + gating the reset on transcript existence preserves the
lazy-transcript "not yet" tolerance (initial subscribe AND rotation) and leaves the
fresh tail to the client's re-subscribe. A dropped `chat`/`chat-state` `hubEvent`
under channel pressure similarly maps to a one-shot `chat-reset` (`pendingReset`
flushed on drain) so a lost frame converges by re-composition, never a permanent gap.
**Rejected**: re-tailing the new ref from 0 (streams a whole conversation); emitting
`chat-reset` before the transcript exists (404-wedges the client's re-compose).
*Introduced by*: `260717-vhvz-chat-on-state-socket`

### `chat-error` is protocol tolerance, currently never emitted
**Decision**: `chat-error` (`{error}`) stays in the client-facing protocol (the hook
renders it inline) but the producer NEVER emits it today — every failure path
converges via subscribe-time `error` frame (carrying `req`) or DORMANT→`chat-reset`.
The Go-side `chatEventError` const therefore has zero call sites.
**Why**: recorded honestly rather than pretending a symmetric error path exists.
The dormant/reset convergence is strictly better than a terminal error for the
not-yet/transient cases, and the subscribe-time `error` frame covers the hard
resolve failures. `chatEventError` is a zero-emit **deletion candidate** (plan
Deletion Candidates): a follow-up either wires a genuinely-unrecoverable emit path
or drops the const (the client handler can stay as tolerance).
**Rejected**: forcing a terminal `chat-error` on transient faults (loses the
self-healing re-composition).
*Introduced by*: `260717-vhvz-chat-on-state-socket`

### Tmux keystroke injection, not an agent SDK/API send
**Decision**: Send types the message *into the resolved pane* — a named-buffer
bracketed paste (`set-buffer -b rk-chat-send -- <text>` → `paste-buffer -d -p`)
plus a probed `send-keys Enter` — rather than hosting the agent's session or
calling a provider send API.
**Why**: The pane stays the agent's parent process (Constitution VI); rk sends
keystrokes exactly as a human typist would — no SDK hosting, no session ownership,
no queue state (Constitution II). Mechanically provider-agnostic (it types into any
TUI), so the injection lives in the shared `internal/inject` engine behind the
handler's small `injectChatMessage` adapter seam that a later
protocol-based send (Codex JSON-RPC) can branch on without reshaping the handler;
v1 makes NO provider branch. `set-buffer` (text as a discrete argv element) beats
`load-buffer -` because `tmuxExecServer` has no stdin plumbing; the `--` terminator
is load-bearing for leading-dash text; a NAMED buffer avoids clobbering the user's
anonymous buffer stack; `-p` matches the TUI's bracketed-paste support so multiline
lands as one literal block.
**Rejected**: an agent SDK/protocol send in v1 (session ownership, dependency creep
— deferred to a later change behind the seam); reusing `POST /keys` (window-target
routes to the active pane, key-name interpretation of message text, unconditional
Enter — the stale-prompt trap); `load-buffer -` (no stdin).
*Introduced by*: `260714-jdyg-chat-send`

### Control-byte sanitize at the handler boundary, sanitize-not-reject
**Decision**: Strip terminal control bytes from `body.Text` in `handleChatSend` via
the exported pure `inject.Sanitize` helper (`internal/inject` — normalize CR/CRLF to
`\n`, then drop every
`unicode.IsControl` rune — C0 + DEL + C1 — except `\n`/`\t`), applied right after the
JSON decode and before the emptiness check — sanitize, never reject-with-400 for the
mere presence of control bytes.
**Why**: Bracketed paste makes ordinary text inert, but control bytes ride through
verbatim; ESC is the sharpest vector — it can embed the bracketed-paste-end sequence
`ESC[201~`, terminating paste mode early so the message tail is interpreted as live
keystrokes (the paste-injection break-out that would sidestep the echo-probe +
withheld-Enter guard). Sanitizing at the handler makes every downstream consumer
(needle, multiline detection, paste, probe) automatically consistent and keeps the
tmux layer byte-faithful (Constitution I — the wrappers store argv verbatim; policy
belongs to the caller). Running before the emptiness check makes an all-control
message collapse to empty and take the existing `400` path. Stripping is strictly
friendlier than rejecting legitimate copy-paste content that merely carries stray
escapes, and CR-normalization (rather than bare stripping) keeps a CRLF-origin
multiline message's line structure so it still counts as multiline.
**Rejected**: sanitizing inside `SetChatSendBufferCtx` (wrong layer — the tmux
package is a mechanism-only wrapper; future callers may legitimately need raw bytes);
rejecting control-byte requests with a `400` (hostile to legitimate paste content).
*Introduced by*: `260719-t9uk-chat-send-control-byte-sanitize`

### NOVELTY echo probe before Enter, fail-closed
**Decision**: Never send Enter blindly. Capture the pane tail BEFORE the paste, then
require a probe needle's (or, for a collapsible paste, the paste-collapse chip's in
either form) occurrence count to strictly INCREASE after the paste; on failure
withhold Enter and return `409` with the text left recoverable in the composer.
**Why**: A visible `❯ <text>` line in a capture can be STALE printed output, not the
live input buffer (a recorded operator lesson) — a mere-presence check would false
pass on a stale chip (this very handler's 409 path leaves pasted text in-frame) or a
short/common needle (`ok`), and Enter into e.g. a permission dialog is the exact
hazard. Novelty (baseline count → strict increase) makes a stale occurrence a floor
to beat rather than a false positive, and if the pane scrolls between baseline and
probe the count cannot rise, so it fails CLOSED. Leaving the pasted text on failure
is visible recoverable state, strictly better than a blind Enter; the 409 message
names it and warns that a resend would duplicate (the paste, not the Enter, already
landed).
**Cost / accepted races**: the capture→Enter gap is inherently TOCTOU-racy (accepted
worst case, matches operator practice); and because busy sends are ALLOWED, agent
output could coincidentally add a needle occurrence between baseline and probe — a
reachable but low-consequence false-positive.
**Rejected**: mere-presence matching (stale/short-needle false positives);
reject-while-busy (superseded — Claude Code queues typed input natively, and the
probe already guards the unsafe cases).
*Introduced by*: `260714-jdyg-chat-send`

### Changed frames make no submission claim
**Decision**: Post-Enter observation is asymmetric. A normalized frame change at
any backoff step returns success without interpreting the cause; only a frame
unchanged through the full ladder can support a non-submission verdict. Neither
the initial Enter nor a recovery Enter has a pre-Enter quiescence gate.
**Why**: A repaint can be a submit, spinner, streaming transcript, or ticking
status line. The daemon routes deliberately accept mid-turn panes with no
`agentState` gate, so treating change as confirmation or failure would make the
shared engine unsound for routine traffic. The unchanged full-ladder case is the
only observation that identifies the printed-prompt trap when the established
paste echo also remains present.
**Rejected**: A sampled quiescence gate (a slow spinner can outlive the sample,
while a ladder-length gate adds about 1.2s to every send); treating any change as
confirmed submission; treating a churning pane as `SubmitUnverified`.
*Introduced by*: 260830-nyvm-mux-send-submit-verification

### Composer clear requires equality with the pre-paste baseline
**Decision**: Recovery permits a re-paste only when `stripForProbe` makes the
post-`C-u` capture equal to the pre-paste baseline capture.
**Why**: Equality identifies the complete pane state and covers every staged line.
It also fails closed when a submitted message appears in the transcript: that
frame cannot equal the baseline, so recovery cannot re-send it.
**Rejected**: Needle occurrence thresholds (a reflow can remove a stale occurrence
while the live echo remains); count-drain logic (the needle is only the last
non-empty line, so earlier lines can remain staged after its count bottoms out).
*Introduced by*: 260830-nyvm-mux-send-submit-verification

### Recovery requires positive non-submission evidence
**Decision**: Recovery runs only when every observation frame is unchanged and
the paste echo remains present. An unchanged frame without the echo returns
`SubmitUnverified` without modifying the pane; a changed frame returns success
with no claim and no recovery.
**Why**: `C-u` can remove staged input but cannot undo a submitted message.
Positive evidence plus a baseline-equal clear makes a duplicate re-paste
structurally unavailable.
**Rejected**: An unconditional bounded retry for any unverified Enter (a false
negative posts the message twice even with a retry limit).
*Introduced by*: 260830-nyvm-mux-send-submit-verification

### Non-submission evidence reuses the echo probe predicate
**Decision**: The unchanged-frame evidence arm checks the echo with
`CountOccurrences(capture, needle, collapsible)`, including the paste-collapse
chip term; the changed-frame no-claim arm remains pure whole-frame comparison.
**Why**: The evidence question must use the same predicate that established the
echo. A chip-rendering TUI replaces a collapsed paste's raw text with a chip, while
the chip term matches nothing on TUIs that do not render one.
**Rejected**: Raw-needle-only evidence (classifies collapsed long or multi-line
pastes as echo-absent and withholds recovery); using chip recognition in the
changed-frame comparison (adds provider shape where none is needed).
*Introduced by*: 260830-nyvm-mux-send-submit-verification

### Collapse-chip gate at 200 runes, a conservative lower bound
**Decision**: Count the paste-collapse chip whenever the paste is *collapsible* —
multiline OR a single line of at least `inject.CollapseMinRunes = 200` runes — and
make the `+M lines` suffix optional in `pasteCollapseRe` so both the multiline chip
(`[Pasted text #N +M lines]`) and the suffix-less long-single-line chip
(`[Pasted text #N]`) match.
**Why**: Claude Code collapses a single-line paste over 800 chars into a suffix-less
chip (empirical, CC 2.1.215, width-independent, observed threshold 801), so its raw
needle never echoes and the probe would 409 for a paste that demonstrably reached
the buffer. Gating chip-counting on `collapsible` (not merely on the presence of a
newline) is what makes the long-single-line chip a valid echo signal. The NOVELTY
strict-increase-over-baseline design is
unchanged and is what keeps chip-counting sound: a stale chip is in the pre-paste
floor, so only THIS paste's fresh occurrence can satisfy the probe — soundness is
independent of whether the text is multiline. 200 is a deliberate conservative lower
bound (vs the observed 801) so an upstream threshold reduction cannot silently
rebreak long-single-line sends, while short interactive sends keep exact-needle-only
matching.
**Rejected**: keying the gate to the exact observed 801 (brittle — an upstream
Claude Code release can lower it silently); counting the chip unconditionally for
ALL sends (needlessly widens the concurrent-fresh-chip false-positive window to
short interactive sends that never collapse).
*Introduced by*: `260719-yxi0-chat-send-single-line-collapse-probe`

### Allow + probe busy policy — no server-side gate, no queue
**Decision**: There is NO `agentState` gate on send and NO server-side queue. A busy
(`active`) agent receives the paste into its TUI input box; the novelty probe is
the sole pre-Enter guard, and post-Enter observation makes no claim when the busy
pane repaints. The UI shows a non-blocking "will be queued" hint while `active`
but keeps the input enabled.
**Why**: Claude Code's TUI natively queues messages typed while the agent works
(steering). Probe-before-Enter blocks unsafe blind submission, while the
asymmetric observation contract lets routine mid-turn repainting return success.
A server-side queue is forbidden by Constitution II (no persistent state store).
**Rejected**: reject-while-busy (unnecessary given native steering); a server-side
send queue (Constitution II).
*Introduced by*: `260714-jdyg-chat-send`

### Per-(server,paneID) whole-sequence lock + nested shared-buffer mutex
**Decision**: Serialize the whole injection sequence per `(server, paneID)` with a
never-evicted mutex map, and nest a small engine mutex around just the set → paste
critical section (which uses the one server-wide named buffer). Raw injection and
bare Enter take the same per-pane lock; raw injection also takes the buffer mutex.
**Why**: Two sends to the SAME pane racing one composer could each paste before
either completes probing, Enter, observation, and recovery, merging into one
doubled submission — the per-pane whole-sequence lock closes that window while
keeping DISTINCT panes concurrent. The
named buffer `rk-chat-send` is a single server-wide resource with rk as sole writer,
so without the nested set→paste mutex two cross-pane sends could interleave as
A-set / B-set / A-paste (wrong text into pane A; B's `-d` paste 500s on the deleted
buffer). Division of labour: per-pane lock = same-pane sequence ordering; global
mutex = shared-buffer atomicity across panes. Both are held briefly relative to the
slow probe captures, so cross-pane throughput stays high.
**Rejected**: a global set→paste-only lock (leaves the same-pane double-paste window
open); a per-request unique buffer name (works but the whole-sequence lock is needed
anyway for the same-pane merge, and a shared named buffer is simpler); evicting map
entries (reintroduces a drop-last-reference race between two same-pane sends).
*Introduced by*: `260714-jdyg-chat-send`

### One shared injection deadline threads all subprocesses
**Decision**: The handler derives ONE `context.WithTimeout(r.Context(),
chatSendTotalBudget)` (default 4s) and threads it through every step via the `*Ctx`
tmux variants, including observation captures, `C-u`, and re-paste operations.
**Why**: The code-review 5s route-blocking rule requires one bounded deadline for
the entire operation. Deriving from the request context also cancels the tmux
subprocesses and backoff sleeps on client disconnect.
**Rejected**: independent per-primitive timeouts (unbounded route block).
*Introduced by*: `260714-jdyg-chat-send`

### Additive `submit` flag gates the submission phase; serialized only when false
**Decision**: Insert-without-submit is an additive optional `submit *bool` on the
chat-send POST body (default true), and `sendChatMessage` serializes `submit:false`
into the body ONLY when false — the default body stays exactly `{ text }`.
`submit:false` skips Enter, post-Enter observation, and recovery;
baseline/set/paste/probe/lock/budget still apply, and a failing probe still 409s.
**Why**: A missing field and `true` have the same server-side meaning via `*bool`
nil-or-true, so serializing `true` adds no information. Reusing the hardened paste
path ensures staged text demonstrably echoed before it is left for a human or a
later submit, without running any submission-only work.
**Rejected**: always serializing the field (churns every existing mocked body for
zero information); a separate insert endpoint (a new POST route for a one-step
delta — Constitution IV/IX prefer the additive body); a parallel insert-mode state
machine on the form (a second lock/clear/error path is the cross-surface divergence
the intake forbids).
*Introduced by*: 260719-mxvw-pointer-aware-enter-insert-mode

### Failure taxonomy splits on the Enter boundary
**Decision**: Post-paste failures classify by whether Enter was sent. Before
Enter (a probe capture error, a context failure mid-probe, or a refused
`send-keys Enter`) → `StagedSendFailure` (`staged_send_failure` 409 — staged
text, a resend duplicates, recovery is a human Enter). After Enter (observation
capture/context faults, recovery failures) → `SubmitUnverified` wrapping the
cause (`submit_unverified` 409). Pre-paste failures keep the plain wrapped-error
→ 500 path, where "nothing was delivered; retrying is safe" is true. A clean
echo miss remains `ProbeFailure`.
**Why**: The two post-paste states demand opposite resend advice — staged text
wants a recovery Enter and warns that a resend duplicates; a sent Enter may
already have submitted, so a recovery Enter could double-submit. One sentinel
per failure class keeps the handler mapping mechanical and the client toasts
honest about what was delivered.
**Rejected**: One catch-all staged code for everything post-paste (gives "press
Enter in pane" advice after Enter already ran); reusing `probe_failure` for
infrastructure errors (conflates a clean echo miss with a tmux fault — the
memory contract keeps them distinct 409s).
*Introduced by*: 260902-8jco-tmux-pane-env-scrub-send-failures
