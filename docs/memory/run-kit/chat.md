---
type: memory
description: "The chat subsystem — rk-owned neutral event schema (Event/Pending/turn), Adapter registry, the Claude JSONL adapter (UUID-glob, tolerant parse, TailFrom offset-tail). Read: GET .../chat backfill + a kind:chat sub on /ws/state; ?view=chat lens with a pointer-aware Enter/Insert send form. Send: POST .../chat/send — sanitize, named-buffer paste + novelty echo probe + Enter gated on probe AND an additive submit flag (submit:false = insert-without-submit). Read derives from disk; send types in."
---
# Chat Subsystem

**Domain**: run-kit

## Overview

`internal/chat` turns a window's reconciled `@rk_chat = <provider>:<session-ref>`
(from [agent-state](/run-kit/agent-state.md) § Chat Session Identity) into the
conversation it names. It is a **read-only** view over the agent pane plus a
narrow **send** path: the pane stays the agent's parent process (Constitution VI);
rk only ever *reads* the transcript and *types into* the pane exactly as a human
typist would — never owning the agent's session. Everything derives from disk at
request/stream time with **nothing cached beyond the connection** (Constitution
II): all read routes are GET, the send path holds no SDK/session/queue state. The
schema is rk-owned and provider-neutral so Codex/Gemini adapters are backend-only
additions; the **Claude** adapter is the one registered provider (protocol-based
send such as Codex JSON-RPC branches behind the `injectChatMessage` seam later).

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
lens machinery in [ui-patterns](/run-kit/ui-patterns.md) § Window Views (Lens
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
lone accepted worst case — `@rk_agent_state=waiting` still drives the badge).

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
sentinel. Lookup is by the `@rk_chat` provider prefix; a well-formed but
unregistered provider returns `ErrNoAdapter` (the API layer maps it to a
404-class JSON error, so presence-gating stays provider-agnostic and
codex/gemini adapters are additive). The one registered provider is `claude`, from
`claude.go`'s `init()`. Tail is exposed as `TailFrom` (§ Design Decisions →
`TailFrom` supersedes the self-priming `Tail`).

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
malformed), resolve the window's **reconciled** `@rk_chat` rollup server-side via
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
- **GIVEN** a live `claude` window with a reconciled `@rk_chat`
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
  session rotation via `/clear`/`/compact` re-stamps `@rk_chat` within one hook
  fire — sees a fresh ref) OR a **shrink** (`TailFrom`'s `Reset`), the producer
  cancels the tail and — crucially — does NOT re-tail the new ref from 0 (that
  would re-stream a whole conversation over the shared socket, violating D5).
  It emits a single `chat-reset` **ONLY once the rotated-to transcript EXISTS**
  (probed via `transcriptExists`, a `TailFrom(ref,0)` cancelled immediately —
  tolerant of `ErrTranscriptNotFound`/`ErrInvalidRef`), re-emitting each tick
  until the client's re-subscribe REPLACES this producer with a fresh tail. This
  preserves the **lazy-transcript "not yet" tolerance** (Claude Code writes the
  `.jsonl` only on the first prompt while `@rk_chat` re-stamps at `SessionStart`)
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
- **AND GIVEN** the window's `@rk_chat` re-stamps to a session whose transcript
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
property of the reconciled `@rk_chat`, not a server fault; any other adapter read
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
`writeError`/status-mapping vocabulary. Everything lives in `api/chat.go`
(handler + probe/lock orchestration) over new pane-targeted `internal/tmux`
primitives; the read endpoints, stream, and schema are untouched.

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
`handleChatSend` SHALL sanitize `body.Text` via the pure package helper
`sanitizeChatText` (`api/chat.go`) immediately after the JSON decode and BEFORE the
whitespace-only emptiness check. `sanitizeChatText` normalizes `\r\n` and lone `\r`
to `\n`, then drops every control rune per `unicode.IsControl` — C0 (U+0000–U+001F),
DEL (U+007F), and the C1 range (U+0080–U+009F, including the single-byte CSI
U+009B) — EXCEPT `\n` and `\t`, which are legitimate message content (multiline
messages and indented code). Ordinary text, non-ASCII runes (accents, emoji), `\n`,
and `\t` pass through unchanged. Because the sanitize runs before the emptiness
check, a message that is entirely control bytes collapses to the empty string and
takes the existing `400` path without touching tmux. Because it runs before pane
resolution and injection, every downstream consumer (`chatProbeNeedle`, the
`multiline` detection via `strings.Contains(text, "\n")`, `setAndPaste`, the echo
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
On a resolved pane the handler SHALL inject the message through a discrete
provider-agnostic seam (`injectChatMessage`) running this exact ordered sequence,
every subprocess an argv slice (Constitution I) targeting the `paneID`:
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

`injectChatMessage(ctx, server, paneID, text, submit bool)` carries the resolved
boolean. **`submit:false` (insert-without-submit) skips ONLY step 5** — the baseline
capture, handler-boundary sanitize, named-buffer set/paste, novelty echo probe (a
probe failure still returns the structured `409`, Enter irrelevant but the text left
recoverable in the composer), per-`(server,paneID)` whole-sequence lock,
`chatSetPasteMu`, and the single `chatSendTotalBudget` deadline are all unchanged.
The insert-only path still requires a passing probe (the paste must have echoed); it
just leaves the text staged in the pane's input box without pressing Enter, so a
human — or a later submit — completes it.

There SHALL be NO `agentState` gate and NO server-side queue (busy policy =
Allow + probe, Constitution II). The text reaching `set-buffer` is the
handler-sanitized string (§ Send-text sanitization) — control bytes stripped,
CR/CRLF normalized to `\n`; from that point delivery to tmux is verbatim. Newlines,
tmux key names (`Enter`, `C-c`), and leading dashes in the sanitized text are all
delivered literally — never interpreted as keys/flags nor submitted per-line.

#### Scenario: Key-name / leading-dash text is delivered literally
- **GIVEN** a resolved pane and text `"--force is broken\necho Enter"`
- **WHEN** injection runs
- **THEN** the order is baseline → set-buffer (`--`-terminated) → paste-buffer →
  probe → send-keys, the text is one literal argv element (never parsed as
  flags/keys), and Enter is a separate step gated on the probe.
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
`chatSendNeedleMaxLen = 40` runes. A paste is **collapsible** when it is multiline
OR a single line of at least `chatSendCollapseMinRunes = 200` runes — the Claude
Code TUI collapses such a paste into a chip, so the chip is a valid fresh-echo
signal. `pasteCollapseRe` matches BOTH chip forms whitespace-stripped:
`[Pasted text #N +M lines]` (multiline collapse) and the suffix-less
`[Pasted text #N]` (long-single-line collapse), with the `+M lines` suffix optional.
The chip counts as a successful echo ONLY when the paste is collapsible and ONLY as
a *fresh* occurrence vs baseline; a short single-line send keeps exact-needle-only
matching. A short settle (`chatSendProbeSettle = 80ms`)
precedes the first capture, then up to `chatSendProbeAttempts = 3` captures with a
`chatSendProbeGap = 80ms` gap (settle/gap are package **vars** solely so tests can
shrink them). The probe **fails closed**: an empty needle, a pane that scrolls
between baseline and probe, or a count that never rises → `chatProbeFailure` → no
Enter, `409`. This is the guard against a blind Enter into e.g. a permission
dialog. A `CapturePane` subprocess error is distinct (→ `500`, not a clean miss).

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

### Requirement: 409 on probe failure — Enter withheld, text left recoverable
On probe failure the handler SHALL send no Enter and return `409` with a structured
message that names the recoverable state and steers away from a duplicating retry:
`"agent input not ready — message pasted but not echoed; Enter withheld. The text
remains in the agent's input — check the terminal view before retrying, as a
resend would duplicate it."` The pasted text legitimately remains in the TUI input
box (visible, recoverable) — strictly better than a blind Enter. The failure is
surfaced, never silent. The retry hint matters because the paste (not the Enter)
already landed, so an identical resend would paste a SECOND copy and submit doubled
text.

#### Scenario: Probe failure leaves the paste visible and withholds Enter
- **GIVEN** a paste whose echo cannot be verified across all retries
- **WHEN** the probe exhausts
- **THEN** no Enter is sent, the response is `409` with the retry-hinted message,
  and the pasted text stays in the agent's composer.

### Requirement: Per-(server,paneID) whole-sequence lock + shared-buffer mutex
Concurrent sends SHALL be serialized so no two cross texts or double-submit. The
handler holds a **per-(server,paneID) mutex** (a guarded, never-evicted
`map[string]*sync.Mutex`, keyed `server\x00paneID`) across the WHOLE sequence
(baseline → set → paste → probe → Enter/409) so a second send to the SAME pane only
begins after the first fully finishes — closing the same-pane double-paste window
(two sends racing one composer both pasting before either probes → merged
submission). DISTINCT panes stay fully concurrent (each takes its own lock). Because
the named tmux buffer (`rk-chat-send`) is a single server-wide resource with rk as
its sole writer, the set → paste critical section is ADDITIONALLY guarded by a small
package-level mutex (`chatSetPasteMu`) **nested inside** the per-pane lock — held
only for those two fast subprocesses — so cross-pane sends cannot interleave as
A-set / B-set / A-paste (pane A would receive B's text; B's own `-d` paste would
500 on the already-deleted buffer).

#### Scenario: Same-pane sends serialize; distinct panes stay concurrent
- **GIVEN** two concurrent sends to the same `(server,paneID)`
- **WHEN** both run
- **THEN** the second observes the first's completed sequence (never an in-flight
  paste), so no doubled submission and no crossed text; **AND GIVEN** two sends to
  DIFFERENT panes, **THEN** they run concurrently (only the brief shared set→paste
  window serializes across panes).

### Requirement: One shared injection deadline (route stays under 5s)
The whole injection sequence — up to 6 tmux subprocesses plus the settle/retry
sleeps — SHALL run under ONE shared context deadline (`chatSendTotalBudget`,
default `4s`, a package var only so tests can shrink it), derived from the request
context (a client disconnect also cancels the subprocesses). The individual tmux
primitives are the caller's-context `*Ctx` variants that do NOT each impose their
own 10s timeout — so the route can never block for the old worst case of 6 × 10s,
staying comfortably under the code-review 5s route-blocking rule (probe sleeps
alone are ≤ 240ms).

#### Scenario: A stalled tmux cannot block the route past the budget
- **GIVEN** a tmux subprocess that stalls
- **WHEN** the shared deadline elapses
- **THEN** the sequence aborts (the ctx cancels every remaining subprocess) rather
  than blocking the route for multiples of 5s.

### Requirement: New pane-targeted tmux primitives on `TmuxOps`
`internal/tmux` SHALL carry the pane-targeted primitives the injection needs
(`SetChatSendBufferCtx`, `PasteChatSendBufferCtx`, `SendEnterToPaneCtx`, plus the
`ChatSendBuffer` name constant — see [tmux-sessions](/run-kit/tmux-sessions.md)),
and `api/router.go`'s `TmuxOps` interface (with `prodTmuxOps` + the test
`mockTmuxOps`) SHALL surface them as `SetChatSendBuffer` / `PasteChatSendBuffer` /
`SendEnterToPane` / `CapturePane` so the handler is fully testable against the fake
— the needle-derivation + settle/retry orchestration lives in `api/chat.go`, the
individual tmux calls are recordable interface methods. `SendKeys` (the
window-targeted `/keys` helper) is untouched.

#### Scenario: The status matrix is exercisable against a fake tmux
- **GIVEN** the handler driven by `mockTmuxOps`
- **WHEN** the test injects capture results / errors per primitive
- **THEN** the full 400/404/409/500/200 matrix, injection order, and
  no-Enter-on-probe-failure are exercisable with no live claude pane.

## Chat View Frontend

The read-only frontend consumer of the backend contract above. The pure schema
+ derivation helpers live in `app/frontend/src/lib/chat-stream.ts`; the
subscription lifecycle in `app/frontend/src/hooks/use-chat-subscription.ts`
(GET-backfill→state-socket-subscribe); the
renderer in `app/frontend/src/components/chat-view.tsx`. The view-state
plumbing (the `?view=` param, ViewSwitcher chip, heading, value-bearing
persistence, palette, `Ctrl+`` shortcut, connection dot) is the UNIFIED lens
machinery documented in [ui-patterns](/run-kit/ui-patterns.md) § Window Views
(Lens Model) / § Chat View — this section owns the DATA-layer consumer half only.

### Requirement: Frontend mirrors the rk-owned schema as TS types
`chat-stream.ts` SHALL define TypeScript types mirroring the backend schema
one-to-one: `ChatEvent` (`type`/`id?`/`turn`/`role?`/`text?`/`toolUseId?`/
`toolName?`/`toolInput?: unknown`/`toolOutput?`/`isError?`/`ts?` — every field
except `type`/`turn` optional, matching the backend `omitempty`), `ChatPending`
(`toolUseId?`/`toolName?`/`text?`), and `Conversation` (`{provider, sessionRef,
events, pending, offset}`, `pending` nullable; `offset: number` is the backfill
byte offset the subscription tails `from`). `toolInput` is typed `unknown`
(verbatim provider JSON, rendered pretty-printed) — type narrowing over `as` casts
(code-quality Frontend rule). The `WindowInfo` gate fields `chatProvider`/
`chatSessionRef` are typed on `WindowInfo` (`types.ts`); the backend emits them on
every `/api/sessions` response + SSE `sessions` event, needing no client parsing.

#### Scenario: An event with no `id` is still rendered
- **GIVEN** a `ChatEvent` whose optional `id` is absent
- **WHEN** the append/render pipeline runs
- **THEN** it is not deduped away (dedup keys on `id`; a missing `id` always
  appends) and it renders like any other event.

### Requirement: Pure derivation helpers (dedup / turn-group / tool-pair / pending)
`chat-stream.ts` SHALL export the pure helpers the hook + renderer compose, each
unit-tested without an `EventSource` or a mounted component (mirroring the
`palette-move.ts` / `palette-agent-nav.ts` extraction pattern):
- `applyChatBackfill(conv)` — returns `conv.events` verbatim (backfill REPLACES,
  never appends).
- `appendChatEvents(existing, incoming)` — appends `incoming` deduped by `id`
  (an event with no `id` is always appended); preserves order; returns the same
  array reference when nothing is added (render-stability).
- `groupEventsByTurn(events)` — groups into ascending-`turn` blocks, events in
  arrival order within a turn (the counter IS the boundary — no synthetic events).
- `pairToolEvents(events)` — one `ToolCard` (`{use, result}`) per `tool_use` in
  arrival order, joined to the FIRST matching `tool_result` by `toolUseId`
  (`result: null` when unpaired); a `tool_result` matching no `tool_use` is
  dropped (defensive against a mid-append partial stream).
- `derivePendingBubble(pending)` — returns `{label, toolName?}` preferring
  `pending.text`, falling back to `toolName` when text is empty, else `null` so
  the renderer clears a resolved marker.

#### Scenario: A tool_use/tool_result pair collapses into one card
- **GIVEN** a turn with a `tool_use` and its matching `tool_result` (same
  `toolUseId`)
- **WHEN** `pairToolEvents` runs
- **THEN** it returns exactly one `ToolCard` joining them, and the renderer
  draws one collapsible card (the paired `tool_result` is not drawn separately).

### Requirement: `useChatSubscription` hook (`use-chat-subscription.ts`)
`useChatSubscription(server, windowId)` SHALL return the shape
`{events, pending, connected, error}` consumed by `app.tsx`/`ChatView`.
It drives its lifecycle through the `session-context` chat seam
(`subscribeChat`/`unsubscribeChat`/`registerChatHandlers`/`socketConnected`) — it
holds NO socket handle (R11). On chat-lens enter it **composes fetch→subscribe**
(gap-free/duplicate-free, D5): reset view state → `getWindowChat(server, windowId)`
(`applyChatBackfill` REPLACE + set pending; the response carries the transcript
byte `offset`) → `subscribeChat({server, windowId, from: conv.offset})`. Live
frames via the context handler seam: `chat` → `appendChatEvents` (id-dedup
retained as a defensive layer), `chat-state` → set pending **always incl. `null`**,
`chat-reset` → **re-run the composition** (rotation / shrink / dropped-frame
recovery — no transcript rode the socket), `chat-error` → set the inline `error`.
`getWindowChat` throws `HttpError`; a **404 is treated as wait-and-retry** on a
`NOT_YET_RETRY_MS = 500` backoff (a lazy transcript not yet written, e.g. right
after `/clear`) rather than wedging on an error — so `/clear` converges (a later
`chat-reset` re-triggers compose too, doubly assuring convergence).

**ONE guarded `compose`** (behind a `composeRef` carrying the current generation,
`cancelled`/`gen` guards) is shared by BOTH the mount effect AND the reconnect
effect (rework cycle 1 MUST-FIX): a reconnect GET still in flight when the user
switches windows / leaves the lens must NOT REPLACE the new window's state with the
old conversation, and must NOT re-subscribe the torn-down `(server,windowId)` after
its cleanup already unsubscribed (which would leak an ownerless server-side
producer). Stale completions are discarded; no subscribe fires for a torn-down
identity; cleanup resets the ref to a no-op. On socket reconnect it re-runs the
composition (no cursor — the no-cursor reset contract). Cleanup unsubscribes on
lens leave / window switch / unmount — no subscription outlives the view
(Constitution II). **Health** = `(socketConnected) AND (this window's chat
subscription acked)`, keeping the established 3s disconnect debounce.

#### Scenario: Compose gap-free; reconnect-across-switch discards the stale identity
- **GIVEN** the chat lens activates for `(server, windowId)`
- **WHEN** the hook runs
- **THEN** it GETs the offset-bearing backfill, REPLACES the event list, subscribes
  `from:<offset>`, and appends subsequent `chat` events without gaps/duplicates.
- **AND GIVEN** a `chat-reset` (rotation) arrives, **THEN** the hook re-runs the
  fetch→subscribe composition on the same lens.
- **AND GIVEN** a reconnect GET is in flight and the window then switches, **THEN**
  the stale conversation is NOT applied and the old `(server,windowId)` is NOT
  re-subscribed after cleanup (unsubscribe parity — no leaked subscription).

### Requirement: Read-only renderer (`chat-view.tsx`)
`ChatView` SHALL be a **pure renderer over passed stream state** (`{events,
pending, connected, error}`) — `AppShell` owns the single owner-hook call
(`useChatSubscription`) so ONE chat subscription feeds both the renderer and the
connection dot (§ Web Push / ui-patterns § Chat View). It renders in the house
aesthetic (monospace,
three-mode theme tokens, animation behind `prefers-reduced-motion`):
- **Message bubbles** grouped by `turn` (`groupEventsByTurn`), user vs assistant
  visually distinct (right/left, distinct backgrounds); markdown + fenced code
  via `react-markdown` + `remark-gfm` scoped to a `.chat-markdown` wrapper (whose
  typography rules live in `globals.css` — code blocks render as plain monospace
  `<pre>`, no syntax highlighting in v1; links open `target="_blank"
  rel="noopener noreferrer"`).
- **Tool-call cards** — one collapsible card per `tool_use`/`tool_result` pair
  (`pairToolEvents`), **collapsed by default** (`aria-expanded`); header shows
  `toolName`, body shows pretty-printed `toolInput` JSON + `toolOutput` text; an
  `isError` result styled as an error. A rare orphan `tool_result` (no matching
  `tool_use` in its turn) renders bare.
- **Pending question** — an attention-styled (`role="status"`) bubble at the
  conversation **tail** carrying `derivePendingBubble`'s label; cleared when
  `chat-state` sets `pending: null`.
- **Streaming** — stick-to-bottom auto-follow (a `stickRef` gated on ~40px
  from-bottom + a `useLayoutEffect` on `[events, pendingBubble]`) unless the user
  has scrolled up.
- **Send form footer** — a `shrink-0` `ChatSendForm` (§ Send-form input box).
- **`chat-error`** — an inline `role="alert"` error state.

#### Scenario: Markdown bubble, collapsed tool card, tail pending
- **GIVEN** a conversation with markdown messages, a tool_use/tool_result pair,
  and a tail pending
- **WHEN** `ChatView` renders
- **THEN** bubbles render markdown, the tool card is collapsed by default and
  expands on click, and the pending bubble shows at the tail and clears when
  `pending` becomes null.

### Requirement: Send-form input box — pure `ChatSendForm`, AppShell-wired
`ChatView` SHALL stay a **pure component over passed props**. A `ChatSendForm`
child is the footer; `AppShell` supplies an
`onSend(text, submit): Promise<void>` callback (wrapping the `sendChatMessage(server,
windowId, text, submit)` client — `client.ts`, POSTs `{text}` (plus `submit:false`
only when false) via the shipped `withServer` + `throwOnError` shape so the server's
structured error, including the 409 probe message, surfaces as the thrown Error's
message) plus a `busy` boolean derived from `currentWindow.agentState === "active"`.
`ChatView` calls the client directly for nothing — it delegates to `onSend`. The
lens/switcher machinery (`window-view.ts`, `ViewSwitcher`, search-param validation —
[ui-patterns](/run-kit/ui-patterns.md) § Window Views) is NOT touched. The input UX:
- An auto-growing monospace `<textarea>` (`.rk-chat-input`, placeholder
  `Message the agent…`), bounded max-height then internal scroll, plus house-chip
  (`rk-glint`) **Insert** and **Send** buttons for touch/mouse (Insert left of Send,
  `data-testid="chat-send-insert"`, same enable/disable as Send, `title` documenting
  the Alt+Enter chord). Insert routes through the shared in-flight-locked submission
  with `submit:false` (`onSend(text, false)`); Send with `submit:true`.
- **Pointer-aware Enter, shared with the compose strip** (260719-mxvw): the keydown
  routes through the shared pure `classifyComposeEnter` (`lib/compose-keys.ts`) fed the
  live `useCoarsePointer()` value — the SAME hook + classifier both surfaces use, so
  the two cannot diverge (divergence is a defect). **Fine pointer**: Enter = submit,
  Shift+Enter = newline (unchanged). **Coarse pointer (touch)**: Enter = newline (NOT
  intercepted — the textarea default; the Send button submits). **Cmd/Ctrl+Enter =
  submit ALWAYS**, all devices (the escape hatch for a hardware keyboard on a touch
  device). **Alt+Enter = insert-without-submit ALWAYS** (`submit:false`, the chord
  peer of the Insert button). Precedence: non-Enter/IME-composing → default; meta/ctrl
  → submit; alt → insert; shift → default; coarse → default; else → submit. The
  empty/whitespace-only no-op is unchanged. `keydown` **stops propagation** so a
  `Ctrl+`` toggle or other global chord never hijacks a keystroke while typing — and
  the textarea is explicitly EXEMPTED from the `Ctrl+`` view-toggle suppression via its
  `.rk-chat-input` class (see [ui-patterns](/run-kit/ui-patterns.md) § Window Views;
  the toggle must still fire from inside the chat input or the user is trapped).
- **Truthful `enterKeyHint`** (260719-mxvw): `enterKeyHint="send"` when Enter submits
  (fine pointer), `enterKeyHint="enter"` when Enter inserts a newline (coarse pointer)
  — driven by the same live `useCoarsePointer()` value, so a mid-session pointer-capability
  change updates the keydown policy and the keyboard hint together.
- **In-flight lock**: while a send POST is pending, the submit path is locked
  (double-Enter / double-click cannot double-send). It guards insert-mode sends
  identically — insert reuses the one lock/clear/error state machine, not a parallel
  one. The textarea KEEPS its text until the POST succeeds — cleared on success, kept
  on failure (identically for submit and insert modes).
- **Inline error**: a failed send renders an inline `role="alert"`
  (`chat-send-error`) above the input carrying the server's structured error
  (e.g. the 409 message). Never silent.
- **Busy hint**: while `busy` (agent `active`), a non-blocking
  "will be queued" hint (`chat-send-busy-hint`) renders and the input STAYS ENABLED
  (Allow + probe policy — Claude Code queues typed input natively).
- **Desktop-only autofocus**: the textarea auto-focuses on mount (the chat lens
  just activated) UNLESS `(pointer: coarse)` matches — coarse pointers skip
  autofocus so the on-screen keyboard does not pop unbidden.
- **Per-(server,windowId) remount**: `AppShell` keys `<ChatView>` by the composite
  `` `${server}:${windowParam}` `` so switching chat-lens windows — including the
  same window id across DIFFERENT servers (`@1`↔`@1`) — remounts the form, dropping
  any draft/stale-error carryover and re-firing autofocus.

#### Scenario: Enter submits and clears; a 409 keeps the text and shows the error
- **GIVEN** the send form with typed text on a fine pointer
- **WHEN** the user presses Enter and the POST resolves ok
- **THEN** exactly one POST fires with the typed body (no `submit` field), the
  textarea clears, and any prior error clears; **AND GIVEN** a second Enter while in
  flight, **THEN** no second POST fires; **AND GIVEN** the POST rejects `409`, **THEN**
  the text is retained and the server's message renders in a `role="alert"` element.
- **AND GIVEN** the agent is `active`, **THEN** the queued-message hint is visible
  and the input stays enabled.
- **AND GIVEN** a coarse pointer, **WHEN** the user presses plain Enter, **THEN** no
  POST fires and the textarea gains a newline (Cmd/Ctrl+Enter and the Send button
  still submit).
- **AND GIVEN** the user clicks Insert (or presses Alt+Enter), **THEN** exactly one
  POST fires with `{text, submit:false}` and clears on success / keeps the text with
  the inline error on failure — identical to the submit path.

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
reconciled `@rk_chat` rollup server-side per request/tick.
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

### `react-markdown` + `remark-gfm` — the frontend's markdown renderer
**Decision**: Render message-bubble markdown via `react-markdown` + `remark-gfm`,
scoped to a `.chat-markdown` wrapper whose typography rules live in `globals.css`;
code blocks render as plain monospace `<pre>` with no syntax-highlighting
dependency in v1.
**Why**: React-idiomatic, no `dangerouslySetInnerHTML` (no XSS surface),
swappable behind the one `MarkdownText` component. Under Tailwind v4 preflight
the raw markdown elements render flat (zero margins, no list bullets, uniform
heading size), so the `.chat-markdown` globals.css rules are load-bearing — they
restore document flow (paragraph/list/heading/blockquote/table spacing, disc/
decimal list markers) in the house monospace aesthetic (headings sized by weight
+ color, not scale jumps), all riding the theme custom properties so both light
and dark are covered.
**Rejected**: A raw-HTML markdown lib (XSS); a syntax-highlighter dependency
(v1 minimal-deps ethos — the terminal aesthetic is plain monospace).
*Introduced by*: `260714-r7rq-chat-read-frontend`

### `ChatView` is a pure renderer; `AppShell` owns the single owner-hook
**Decision**: `AppShell` calls the owner hook (`useChatSubscription`) once (only
when the chat view is actually active for a chat-capable window) and passes
`{events, pending, connected, error}` into `ChatView` as props; `ChatView` opens
no stream itself.
**Why**: ONE owner-hook feeds BOTH the renderer AND the connection-dot health
(ui-patterns § Chat View → the dot reports chat health in chat mode) — a
second hook would desync the two health readings.
**Rejected**: `ChatView` owning its own hook (two subscriptions, desynced dot).
*Introduced by*: `260714-r7rq-chat-read-frontend`

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

### One guarded `compose` shared by mount + reconnect
**Decision**: `useChatSubscription` hoists ONE guarded `compose` (behind a
`composeRef` carrying the current generation, with `gen`/`cancelled` guards) reused
by both the mount effect and the socket-reconnect effect.
**Why**: the first cut duplicated `compose()` inline in the reconnect effect WITHOUT
the mount effect's guards — a reconnect GET still in flight when the user switched
windows / left the lens REPLACEd the new window's state with the OLD conversation
and re-subscribed the OLD `(server,windowId)` after cleanup had already
unsubscribed, leaking an ownerless server-side producer until socket teardown
(violating R12: no subscription outlives the view, Constitution II). The shared
guarded compose discards stale completions and fires no subscribe for a torn-down
identity.
**Rejected**: an inline unguarded reconnect compose (the leak above).
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
TUI), so the injection sits behind a small `injectChatMessage` seam that a later
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
a pure `sanitizeChatText` helper (normalize CR/CRLF to `\n`, then drop every
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

### Collapse-chip gate at 200 runes, a conservative lower bound
**Decision**: Count the paste-collapse chip whenever the paste is *collapsible* —
multiline OR a single line of at least `chatSendCollapseMinRunes = 200` runes — and
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
(`active`) agent receives the paste into its TUI input box; the probe is the sole
guard. The UI shows a non-blocking "will be queued" hint while `active` but keeps
the input enabled.
**Why**: User-decided at intake (over the original plan's reject-while-busy
recommendation) — Claude Code's TUI natively queues messages typed while the agent
works (steering), and probe-before-Enter already blocks the genuinely unsafe cases.
A server-side queue is forbidden by Constitution II (no persistent state store).
**Rejected**: reject-while-busy (unnecessary given native steering); a server-side
send queue (Constitution II).
*Introduced by*: `260714-jdyg-chat-send`

### Per-(server,paneID) whole-sequence lock + nested shared-buffer mutex
**Decision**: Serialize the whole injection sequence per `(server, paneID)` with a
never-evicted mutex map, and nest a small package-level mutex around just the
set → paste critical section (which uses the one server-wide named buffer).
**Why**: Two sends to the SAME pane racing one composer could each paste before
either probes+Enters, merging into one doubled submission — the per-pane
whole-sequence lock closes that window while keeping DISTINCT panes concurrent. The
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
tmux variants, rather than granting each of the up-to-6 subprocesses its own 10s
timeout.
**Why**: The old per-subprocess-10s design could block the route for a 6 × 10s worst
case; the code-review 5s route-blocking rule requires one bounded deadline. Deriving
from the request context also cancels the tmux subprocesses on client disconnect.
**Rejected**: independent per-primitive timeouts (unbounded route block).
*Introduced by*: `260714-jdyg-chat-send`

### Additive `submit` flag gates only the final Enter; serialized only when false
**Decision**: Insert-without-submit is an additive optional `submit *bool` on the
chat-send POST body (default true), and `sendChatMessage` serializes `submit:false`
into the body ONLY when false — the default body stays exactly `{ text }`.
`submit:false` skips ONLY the final `SendEnterToPane`; baseline/set/paste/probe/lock/
budget are unchanged, and a failing probe still 409s.
**Why**: Keeps the default wire shape byte-identical so older clients and every
existing test/mocked body are untouched (a missing field and `true` are the same
server-side via `*bool` nil-or-true, so serializing `true` adds noise without
meaning). Gating only step 5 reuses the whole hardened injection path — the paste
must still echo before the text is left staged in the composer, so an insert is a
verified paste minus the keypress, not a weaker second path. It restores the
capability the docked-compose-strip cutover (`260718-dhdj`) removed when it flipped
to always-submit: staging text in the agent's input box (pre-load a prompt, append
to a queued steer, leave a draft for a human) without firing it.
**Rejected**: always serializing the field (churns every existing mocked body for
zero information); a separate insert endpoint (a new POST route for a one-step
delta — Constitution IV/IX prefer the additive body); a parallel insert-mode state
machine on the form (a second lock/clear/error path is the cross-surface divergence
the intake forbids).
*Introduced by*: 260719-mxvw-pointer-aware-enter-insert-mode

### Pointer-aware Enter via one shared classifier + one pointer hook
**Decision**: Both text-input surfaces (chat send form, docked compose strip) route
Enter through ONE pure `classifyComposeEnter(key, coarse)` (`lib/compose-keys.ts`)
fed the live `useCoarsePointer()` value (`hooks/use-coarse-pointer.ts`), driving both
the keydown policy and the `enterKeyHint`. Enter is pointer-type-keyed — fine = submit,
coarse = newline (Send button submits) — with universal Cmd/Ctrl+Enter submit and
universal Alt+Enter insert; `enterKeyHint` tracks it (`"send"`/`"enter"`).
**Why**: Mobile keyboards cannot express Shift+Enter, so a coarse-pointer user could
not compose multiline text — every Enter fired a premature message at a live agent
(the costlier error). Keying on `(pointer: coarse)`, NOT viewport width, is deliberate:
a narrow desktop window still has a hardware keyboard, and a tablet with one still
gets the Cmd/Ctrl+Enter escape hatch. The intake makes cross-surface divergence a
defect, so a single shared decision path (pure + unit-testable without a mount, the
`palette-move.ts` extraction pattern) makes divergence structurally impossible — the
two handlers had already drifted once. A live `matchMedia` subscription (not a
mount-time check) keeps the keydown policy and the keyboard hint in lockstep when the
pointer capability changes mid-session.
**Rejected**: keying on viewport width (a narrow desktop window loses hardware-keyboard
Enter); per-surface inline branching (the two handlers drift); a mount-time pointer
read (a stale hint after plugging in a mouse). The new focused-textarea chords are
NOT registered in the command palette (the palette steals focus from the textarea it
would act on, and these are editing chords like the already-unregistered Shift+Enter);
each Insert button's `title` documents its chord, satisfying Constitution V.
*Introduced by*: 260719-mxvw-pointer-aware-enter-insert-mode
