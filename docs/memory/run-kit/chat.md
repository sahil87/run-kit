---
type: memory
description: "The chat subsystem — rk-owned neutral chat event schema (Event/Pending/turn counter), the Adapter interface + provider registry, the Claude JSONL adapter (UUID-glob locate, tolerant line-by-line parse, byte-offset tail), the two window-keyed read/stream endpoints, the frontend consumer: the `?view=chat` chat view over the terminal route (dedicated per-view EventSource, four-event contract consumption, react-markdown bubbles + collapsible tool cards + tail pending bubble), AND the SEND path (Change 4, chat-send): POST /api/windows/{windowId}/chat/send — pane-targeted named-buffer paste + NOVELTY echo probe + gated Enter, per-(server,paneID) whole-sequence lock, allow+probe busy policy, and the ChatView send-form input box. Read stays derive-from-disk-per-request (Constitution II); send types into the pane exactly as a human typist (Constitution VI — the pane stays the agent's parent, no SDK/session ownership)"
---
# Chat Subsystem

**Domain**: run-kit

## Overview

`internal/chat` turns a window's reconciled `@rk_chat = <provider>:<session-ref>`
(from [agent-state](/run-kit/agent-state.md) § Chat Session Identity, Change 1)
into the conversation it names. It is a **read-only** view over the agent pane —
the pane stays the agent's parent process (Constitution VI); rk only ever *reads*
the transcript — and derives everything from disk at request/stream time with
**nothing cached beyond the connection** (Constitution II). The schema is rk-owned
and provider-neutral from day one so Codex/Gemini adapters are backend-only
additions. v1 ships the **Claude** adapter and two window-keyed GET endpoints
(backfill + SSE stream). No send path, no SDK hosting, no SessionStore/DB (all
routes are GET). *Shipped by `260714-pmfh-chat-read-backend` (Change 2 of the
HTML-agent-chat-view stack).*

**Change 3 added the frontend consumer** (`260714-r7rq-chat-read-frontend`): a
read-only HTML chat view over the SAME agent pane, addressed by a `?view=chat`
search param on the existing `/$server/$window` terminal route (Constitution IV
— no new route). It is a SECOND view over the tmux pane, never a substrate — the
pane stays the agent's parent (Constitution VI) and the view only *renders* the
streamed transcript, with nothing cached beyond React state that dies with the
view (Constitution II analog). Chat is the `chat` LENS of the unified window-view
model — its view-state plumbing (the `?view=` param, ViewSwitcher chip,
value-bearing localStorage, palette/`Ctrl+`` parity, chat-health
connection dot) is the shared lens machinery in
[ui-patterns](/run-kit/ui-patterns.md) § Window Views (Lens Model) / § Chat View.
(The top-bar center heading no longer names the lens — since
`260714-uco1-topbar-heading-anchor-nav` it reads a static `Window: <window>` in
every lens; lens indication belongs to the L1 ViewSwitcher, not the heading.)
the § Chat View Frontend requirements below own only the DATA-layer consumer half
(schema types, EventSource lifecycle, renderer). The push deep-link URL +
service-worker navigation lives in [architecture](/run-kit/architecture.md)
§ Web Push Notifications.

**Change 4 added the SEND path** (`260714-jdyg-chat-send`, the FINAL change of the
stack): a mutating `POST /api/windows/{windowId}/chat/send` and a send-form input
box replacing ChatView's read-only disabled footer. Send does NOT make the
subsystem an agent substrate — rk still never *owns* the session; it types the
message *into the pane* exactly as a human typist would (a named-buffer bracketed
paste + a gated Enter), so the pane stays the agent's parent process (Constitution
VI) and there is no SDK hosting, no SessionStore/queue (Constitution II). The two
GET read endpoints, the stream, and the schema are unchanged; the generic
`POST /api/windows/{windowId}/keys` endpoint is left untouched. Protocol-based send
(Codex JSON-RPC) is a later change — v1 makes no provider branch (§ Send Path).

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
routing key), `Backfill(ctx, ref) (*Conversation, error)`, `Tail(ctx, ref)
(<-chan Update, error)` — plus a `Conversation` result (`Provider`, `SessionRef`,
`Events []Event`, `Pending *Pending`, marshalling to `{"provider","sessionRef",
"events","pending"}`), an `Update` increment (see below), a package-level
`map[string]Adapter` registry guarded by a `sync.RWMutex`, `Register`/`Lookup`,
and the `ErrNoAdapter` sentinel. Lookup is by the `@rk_chat` provider prefix; a
well-formed but unregistered provider returns `ErrNoAdapter` (the API layer maps
it to a 404-class JSON error, so presence-gating stays provider-agnostic and
codex/gemini adapters are additive). v1 registers `claude` from `claude.go`'s
`init()`.

**`Update` (the tail increment)**: exactly one shape per Update — `Events`
(newly-appended events; `Pending` carries the current pending state AFTER them,
sent as `chat-state`) OR `Reset: true` with a full `Conv` (a fresh backfill
replacing the client's view — file shrink/rewrite). The Claude `Tail`'s **first**
Update on the channel is ALWAYS a `Reset` carrying the full backfill, so a stream
handler drives both the initial `chat-backfill` and subsequent increments off the
one channel.

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

### Requirement: Byte-offset tail with partial-line and rewrite handling
After backfill the adapter SHALL remember the file byte offset and stat-poll the
file at a named `tailPollInterval = 400ms` cadence (midpoint of the intake's
~300–500ms range; **no fsnotify** — one stat per tick per open stream is
negligible and dependency-free) for the life of the stream. On **growth**
(`size > offset`) it reads from the offset and `consume` parses ONLY complete
(newline-terminated) lines — a partial final line without a trailing newline is
held (its bytes excluded from the consumed count) until its newline arrives next
tick. On **shrink/rewrite** (`size < offset`) it emits a `Reset` (full re-derive +
re-backfill on the same stream). A vanished file (transient stat error — session
rotated/cleared) is tolerated: hold the offset and keep polling; the API layer's
ref re-resolve drives the actual reset. The poll goroutine exits and closes the
channel when `ctx` is cancelled — **no goroutine outlives the stream, no state
beyond the per-connection offset** (Constitution II). Backfill and tail-increments
share one `parser`, so the turn counter and pending derivation stay continuous
across the stream.

#### Scenario: A partial final line is withheld until its newline lands
- **GIVEN** an open tail and the transcript grows by one complete line then a
  partial line
- **WHEN** the next poll tick fires
- **THEN** the complete line is emitted and the partial line is withheld until its
  newline arrives.

### Requirement: Backfill endpoint `GET /api/windows/{windowId}/chat` (`api/chat.go`)
`handleChatBackfill` SHALL validate the `{windowId}` (`parseWindowID`, `400` on
malformed), resolve the window's **reconciled** `@rk_chat` rollup server-side via
`resolveWindowChat` (`FetchSessions` + a window lookup by stable `WindowID`,
reading the rolled-up `ChatProvider`/`ChatSessionRef` — Change 1's active-pane-
first / else-first-pane rule), route to the provider adapter, and return
`{"provider","sessionRef","events","pending"}` as JSON. It NEVER trusts a
client-supplied ref (URLs carry no session UUIDs). It is a GET (Constitution IX)
and curl-able. `resolveWindowChat` distinguishes a **FetchSessions failure**
(non-nil error → `500`, mirroring `handleSessionsList`) from a **genuine no-chat**
(`ok=false`, nil error → `404`) — a transient tmux fault is never misreported as
"no chat session".

#### Scenario: Live claude window returns rk-schema JSON
- **GIVEN** a live `claude` window with a reconciled `@rk_chat`
- **WHEN** a client GETs the backfill route
- **THEN** it returns `200` with the conversation as rk-schema JSON.

### Requirement: Stream endpoint `GET /api/windows/{windowId}/chat/stream`
`handleChatStream` SHALL open a **dedicated per-view SSE stream** (NOT the shared
sessions hub). It resolves the window's chat and the adapter BEFORE committing SSE
headers so a genuine no-chat/no-adapter/fetch-failure is still an HTTP status.
Then it sets `text/event-stream` headers, writes behind `http.Flusher`, and runs
the `chatStream.run` select loop: on connect the tail's first `Reset` becomes a
`chat-backfill` event, then each increment becomes a `chat` event (appended
events) followed by a `chat-state` event (the pending transition — always emitted,
including `nil`, so the client can clear a resolved marker). Heartbeat comments on
idle; a `maxLifetime` cap mirrors the sessions SSE handler. It terminates cleanly
on client disconnect (request context) **without throwing** (code-review.md SSE
rule — `writeSSE` returns false on a failed write and the loop returns). **No
goroutine outlives its connection**: `chatStream` owns exactly one tail context at
a time, cancelling the prior before starting the next, and a deferred closure
cancels the latest on every return path.

#### Scenario: A new transcript turn is emitted live; disconnect leaves no goroutine
- **GIVEN** a connected chat stream and a new transcript turn on disk
- **THEN** a `chat` event is emitted live on the open connection.
- **AND GIVEN** the client disconnects, **THEN** the handler returns without panic
  and leaves no goroutine running.

### Requirement: Session rotation re-resolve with in-stream reset
The stream SHALL re-resolve the window's `@rk_chat` ref on `chatRefResolveInterval
= 2s` (a package **`var`**, not a `const`, solely so tests can shrink the cadence;
production always uses 2s). On a ref (or provider) change — session rotation via
`/clear`/`/compact`, which re-stamps `@rk_chat` within one hook fire — it
(re)subscribes on the SAME connection, so the new tail's first `Reset` delivers a
fresh `chat-backfill` for the new session: **a deep-linked chat view survives
rotation without reconnecting.** `reresolve` resolves the adapter for a *changed*
provider (`chat.Lookup`) BEFORE committing `ref`/`provider`/`adapter`; a Lookup
miss keeps the current subscription untouched and retries next tick (never commits
a ref it cannot serve, never calls the OLD adapter with the NEW ref). A mid-stream
`FetchSessions` failure or a window that lost its chat is tolerated (headers are
already committed — no HTTP status possible — so keep the connection open and
retry next tick), not surfaced.

#### Scenario: A re-stamped ref emits a fresh backfill on the same connection
- **GIVEN** an open chat stream whose window `@rk_chat` re-stamps to a new UUID
- **WHEN** the ~2s re-resolve tick observes the change
- **THEN** a fresh `chat-backfill` for the new ref is emitted on the same
  connection.

### Requirement: Lazy-transcript "not yet" tolerance (rework-discovered)
Claude Code writes a session's `.jsonl` **lazily** — only on the first prompt —
while `@rk_chat` re-stamps at `SessionStart`, BEFORE any prompt. So immediately
after a real `/clear` (and on a brand-new/just-cleared session at initial connect)
the transcript does not exist yet. A `Tail` returning `ErrTranscriptNotFound` OR
`ErrInvalidRef` on a **live stream** SHALL therefore be treated as **"not yet",
not terminal**: `chatStream.subscribe` commits the target ref, leaves `cs.updates`
nil, and the ~2s re-resolve tick retries the current ref each pass until the file
appears — then the tail's first `Reset` delivers the backfill. This holds the
connection open through the no-file window (no `chat-error`) and applies on BOTH
initial connect and rotation. It mirrors `tailLoop`'s own stat-vanish tolerance.
`ErrInvalidRef` was exported (from `errInvalidRef`) alongside `ErrTranscriptNotFound`
so the API layer can classify a malformed reconciled ref (client only supplied a
windowID) as a 404-class response rather than a 500. *Both cases covered by
`TestChatStreamInitialConnectTranscriptNotYet` and
`TestChatStreamRotationTranscriptNotYet`.*

#### Scenario: A just-cleared session with no transcript yet keeps the stream open
- **GIVEN** an open (or connecting) chat stream whose `@rk_chat` points at a
  session whose transcript file does not exist yet
- **WHEN** each ~2s re-resolve tick fires
- **THEN** the connection stays open with no `chat-error`, and once Claude Code
  writes the first line a fresh `chat-backfill` for that ref lands on the same
  connection.

### Requirement: Error surfaces
The handlers SHALL return, as JSON error objects (`writeError` shape): `400` on
invalid `{windowId}`; `404` when the window has no reconciled chat; a 404-class
"no adapter for provider" for a well-formed unknown provider; and a 404-class
response (via `writeChatReadError`) when the transcript is missing
(`ErrTranscriptNotFound`) or the reconciled ref is malformed (`ErrInvalidRef`) for
a live ref — because the client only ever supplies a windowID, a bad ref is a
property of the reconciled `@rk_chat`, not a server fault; any other adapter read
error is a `500`. After SSE headers are committed, an unrecoverable tail error is
emitted as a best-effort `event: chat-error` frame (`writeSSEError`).

## Send Path (`260714-jdyg-chat-send`)

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
implemented as `handleChatSend`. The JSON body is `{"text": "<message>"}`; the
handler validates `{windowId}` (`parseWindowID`, `400`), rejects an
empty/whitespace-only or undecodable body (`400`), then re-resolves the target pane
server-side (§ Server-resolved pane) before injecting. Success is
`200 {"ok":true}`. The existing generic `POST /api/windows/{windowId}/keys`
endpoint SHALL be left untouched (different contract, possible external callers).

#### Scenario: Malformed id or empty text is rejected before any injection
- **GIVEN** a request with a malformed `{windowId}`, an undecodable body, OR a
  `text` that is empty/whitespace-only
- **WHEN** `handleChatSend` runs
- **THEN** it returns `400` with a `writeError` JSON body and performs no tmux
  injection.

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
   successful probe.

There SHALL be NO `agentState` gate and NO server-side queue (busy policy =
Allow + probe, Constitution II). Text is delivered verbatim, including newlines,
tmux key names (`Enter`, `C-c`), and leading dashes — never interpreted as
keys/flags nor submitted per-line.

#### Scenario: Key-name / leading-dash text is delivered literally
- **GIVEN** a resolved pane and text `"--force is broken\necho Enter"`
- **WHEN** injection runs
- **THEN** the order is baseline → set-buffer (`--`-terminated) → paste-buffer →
  probe → send-keys, the text is one literal argv element (never parsed as
  flags/keys), and Enter is a separate step gated on the probe.

### Requirement: NOVELTY echo probe (fail-closed), settle + bounded retry
Before Enter the handler SHALL verify the pasted text ECHOED into the pane's live
input buffer, using **novelty**, not mere presence: it counts a probe **needle**
(and, for multiline text only, the paste-collapse placeholder) in the pre-paste
**baseline** capture, then requires that count to strictly INCREASE in a post-paste
capture. The needle is derived from the LAST non-empty line of the text,
whitespace-stripped (both needle and capture stripped of ANSI + all whitespace so
an ~80-col TUI wrap cannot split the fragment) and capped to the last
`chatSendNeedleMaxLen = 40` runes. The multiline paste-collapse placeholder
(`[Pasted text #N +M lines]`, matched whitespace-stripped) counts as a successful
echo — but ONLY for multiline text (single-line pastes never collapse) and ONLY as
a *fresh* occurrence vs baseline. A short settle (`chatSendProbeSettle = 80ms`)
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
- **AND GIVEN** the text (or its multiline paste-collapse chip) newly appears within
  the retry budget, **THEN** Enter is sent and the response is `200 {"ok":true}`.

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

## Chat View Frontend (`260714-r7rq-chat-read-frontend`, send form `260714-jdyg-chat-send`)

The read-only frontend consumer of the backend contract above. The pure schema
+ derivation helpers live in `app/frontend/src/lib/chat-stream.ts`; the
`EventSource` lifecycle in `app/frontend/src/hooks/use-chat-stream.ts`; the
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
events, pending}`, `pending` nullable). `toolInput` is typed `unknown` (verbatim
provider JSON, rendered pretty-printed) — type narrowing over `as` casts
(code-quality Frontend rule). No client parsing change was needed for the
`WindowInfo` gate fields — the backend already emits `chatProvider`/
`chatSessionRef` on every `/api/sessions` response + SSE `sessions` event; Change
3 only *typed* them on `WindowInfo` (`types.ts`).

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

### Requirement: Dedicated per-view `EventSource` hook (`use-chat-stream.ts`)
`useChatStream(server, windowId)` SHALL own EXACTLY ONE `EventSource` per open
chat view (NOT the shared per-server sessions pool) on `GET
/api/windows/{windowId}/chat/stream?server={server}` (both segments
`encodeURIComponent`-escaped). It consumes the landed four-event contract:
`chat-backfill` (parse `Conversation` → `applyChatBackfill` REPLACE + set
pending), `chat` (parse `ChatEvent[]` → `appendChatEvents` dedup), `chat-state`
(parse `{pending}` → set pending, **always applied incl. `null`** so a resolved
question clears), `chat-error` (parse `{error?|message?}` → set `error` for an
inline error state). A malformed data frame on any of the three data events is
swallowed (the stream stays open). It returns `{events, pending, connected,
error}`. **Health** mirrors the established 3s disconnect debounce
(`session-context.tsx` `es.onerror`): `onopen` does NOT flip `connected` (wait
for the first data frame — "data flowing", not "socket opened"); a first
successful frame marks connected; a sustained `onerror` (>3s, via a single
`setTimeout` cleared on any frame) marks disconnected — a transient blip during
`EventSource` auto-reconnect never flaps the dot. `EventSource` auto-reconnect
handles retry; a reconnect delivers a fresh `chat-backfill` (no cursor). The
effect **resets view state** (`events=[]`, `pending=null`, `connected=false`,
`error=null`) at the top of every `[server, windowId]` run so a window switch
never shows the prior conversation before the first backfill, and its cleanup
`es.close()`s on unmount AND on any `server`/`windowId` change — no connection
outlives the view (Constitution II analog; the only retained state dies with the
component).

#### Scenario: Backfill replaces, appends dedup, unmount closes
- **GIVEN** an open chat view
- **WHEN** a `chat-backfill` then a `chat` append then a `chat-state` arrive
- **THEN** the view replaces its event list on backfill, appends deduped-by-`id`
  on `chat`, and reflects/clears pending on `chat-state`.
- **AND GIVEN** the view unmounts (or `windowId`/`server` changes), **THEN** the
  `EventSource` is closed (no leaked connection).

### Requirement: Read-only renderer (`chat-view.tsx`)
`ChatView` SHALL be a **pure renderer over passed stream state** (`{events,
pending, connected, error}`) — `AppShell` owns the single `useChatStream` call
so ONE `EventSource` feeds both the renderer and the connection dot (§ Web Push
/ ui-patterns § Chat View). It renders in the house aesthetic (monospace,
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
- **Send form footer** — a `shrink-0` `ChatSendForm` (§ Send-form input box,
  `260714-jdyg-chat-send`); it REPLACED the earlier read-only disabled footer
  (the `chat-send-disabled` testid is gone).
- **`chat-error`** — an inline `role="alert"` error state.

#### Scenario: Markdown bubble, collapsed tool card, tail pending
- **GIVEN** a conversation with markdown messages, a tool_use/tool_result pair,
  and a tail pending
- **WHEN** `ChatView` renders
- **THEN** bubbles render markdown, the tool card is collapsed by default and
  expands on click, and the pending bubble shows at the tail and clears when
  `pending` becomes null.

### Requirement: Send-form input box — pure `ChatSendForm`, AppShell-wired (`260714-jdyg-chat-send`)
`ChatView` SHALL stay a **pure component over passed props**. A `ChatSendForm`
child replaces the read-only disabled footer; `AppShell` supplies an
`onSend(text): Promise<void>` callback (wrapping the `sendChatMessage(server,
windowId, text)` client — `client.ts`, POSTs `{text}` via the shipped
`withServer` + `throwOnError` shape so the server's structured error, including the
409 probe message, surfaces as the thrown Error's message) plus a `busy` boolean
derived from `currentWindow.agentState === "active"`. `ChatView` calls the client
directly for nothing — it delegates to `onSend`. The lens/switcher machinery
(`window-view.ts`, `ViewSwitcher`, search-param validation — [ui-patterns](/run-kit/ui-patterns.md)
§ Window Views) is NOT touched. The input UX:
- An auto-growing monospace `<textarea>` (`.rk-chat-input`, placeholder
  `Message the agent…`), bounded max-height then internal scroll, plus a house-chip
  (`rk-glint`) send button for touch/mouse.
- **Enter submits; Shift+Enter inserts a newline**; an empty/whitespace-only
  textarea does not submit. `keydown` **stops propagation** so a `Ctrl+`` toggle or
  other global chord never hijacks a keystroke while typing — and the textarea is
  explicitly EXEMPTED from the `Ctrl+`` view-toggle suppression via its
  `.rk-chat-input` class (see [ui-patterns](/run-kit/ui-patterns.md) § Window Views;
  the toggle must still fire from inside the chat input or the user is trapped).
- **In-flight lock**: while a send POST is pending, the submit path is locked
  (double-Enter / double-click cannot double-send). The textarea KEEPS its text
  until the POST succeeds — cleared on success, kept on failure.
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
- **GIVEN** the send form with typed text
- **WHEN** the user presses Enter and the POST resolves ok
- **THEN** exactly one POST fires with the typed body, the textarea clears, and any
  prior error clears; **AND GIVEN** a second Enter while in flight, **THEN** no
  second POST fires; **AND GIVEN** the POST rejects `409`, **THEN** the text is
  retained and the server's message renders in a `role="alert"` element.
- **AND GIVEN** the agent is `active`, **THEN** the queued-message hint is visible
  and the input stays enabled.

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
client-supplied ref over the reconciler — the same reconciliation Change 1 applied
in `FetchSessions`.
**Rejected**: Ref-in-URL (stale/spoofable).
*Introduced by*: `260714-pmfh-chat-read-backend`

### Dedicated per-view SSE endpoint, not the sessions hub
**Decision**: The live stream is its own SSE endpoint, not a scope on the shared
sessions hub.
**Why**: The hub wakes on tmux control-mode events + a 12s safety ticker, and
transcript appends generate NO tmux events — the hub would need a new wake source
either way. A chat stream exists only while a chat view is open (+1 bounded
connection per open view, well inside the 6-per-origin plaintext budget that bit
the board route; board-pane chat is out of scope plan-wide), keeping the
per-connection byte offset stream-scoped (Constitution II).
**Rejected**: A scope on the shared hub.
*Introduced by*: `260714-pmfh-chat-read-backend`

### Reset-on-reconnect stream contract (no cursor)
**Decision**: Connect ⇒ full `chat-backfill`, then `chat`/`chat-state` appends;
reconnect (or an `rk serve` restart mid-conversation) = full re-derive from disk.
**Why**: Matches the plan acceptance ("loses nothing — full re-derive on
reconnect") and avoids a backfill/tail gap race; the only retained state is the
per-connection byte offset, which dies with the connection.
**Rejected**: A cursor protocol (additive later).
*Introduced by*: `260714-pmfh-chat-read-backend`

### Dedicated per-view `EventSource` on the frontend, not the sessions pool
**Decision**: `useChatStream` opens its OWN `EventSource` per open chat view,
distinct from the per-server sessions SSE pool.
**Why**: Matches the backend's dedicated per-view stream design (§ Dedicated
per-view SSE endpoint) and keeps within the 6-per-origin plaintext budget — one
bounded connection that exists only while a chat view is open (board-pane chat
is out of scope plan-wide, so at most one per tab). The sessions pool carries no
transcript-append signal, so scoping onto it would need a new event source
anyway.
**Rejected**: A scope on the shared sessions hub (would bloat its dedup/order
machinery with transcript text and couple chat cadence to structural ticks).
*Introduced by*: `260714-r7rq-chat-read-frontend`

### `react-markdown` + `remark-gfm` — the frontend's first markdown renderer
**Decision**: Render message-bubble markdown via `react-markdown` + `remark-gfm`
(net-new deps — the frontend had no markdown renderer), scoped to a
`.chat-markdown` wrapper whose typography rules live in `globals.css`; code
blocks render as plain monospace `<pre>` with no syntax-highlighting dependency
in v1.
**Why**: React-idiomatic, no `dangerouslySetInnerHTML` (no XSS surface),
swappable behind the one `MarkdownText` component. Under Tailwind v4 preflight
the raw markdown elements render flat (zero margins, no list bullets, uniform
heading size), so the `.chat-markdown` globals.css rules are load-bearing — they
restore document flow (paragraph/list/heading/blockquote/table spacing, disc/
decimal list markers) in the house monospace aesthetic (headings sized by weight
+ color, not scale jumps), all riding the theme custom properties so both light
and dark are covered. *(This was a review rework: the first cut shipped the class
with no CSS rules.)*
**Rejected**: A raw-HTML markdown lib (XSS); a syntax-highlighter dependency
(v1 minimal-deps ethos — the terminal aesthetic is plain monospace).
*Introduced by*: `260714-r7rq-chat-read-frontend`

### `ChatView` is a pure renderer; `AppShell` owns the single stream
**Decision**: `AppShell` calls `useChatStream` once (only when the chat view is
actually active for a chat-capable window) and passes `{events, pending,
connected, error}` into `ChatView` as props; `ChatView` opens no stream itself.
**Why**: ONE `EventSource` feeds BOTH the renderer AND the connection-dot health
(ui-patterns § Chat View → the dot reports chat-stream health in chat mode) — a
second stream would double the connection and desync the two health readings.
**Rejected**: `ChatView` owning its own hook (two streams, desynced dot).
*Introduced by*: `260714-r7rq-chat-read-frontend`

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

### NOVELTY echo probe before Enter, fail-closed
**Decision**: Never send Enter blindly. Capture the pane tail BEFORE the paste, then
require a probe needle's (or the multiline paste-collapse chip's) occurrence count
to strictly INCREASE after the paste; on failure withhold Enter and return `409`
with the text left recoverable in the composer.
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

### Follow-ups (non-blocking, recorded at hydrate)
Recorded for a later change, accepted as non-blocking by review:
- **Control-byte sanitization of `body.Text`** (should-fix, OPEN): the send handler
  does not strip C0 control bytes from the message before the buffer paste — a
  bracketed paste neutralizes the common cases, but a defensive sanitize is the
  clean fix. Not yet implemented.
- **Long-single-line paste-collapse assumption** (unverified): the probe only counts
  the paste-collapse placeholder for MULTILINE text, on the assumption a long
  single line does not collapse into the chip; not empirically re-verified across
  TUI widths.
- **`sendKeys` client wrapper** — a pre-existing zero-production-caller deletion
  candidate (`app/frontend/src/api/client.ts`; the backend `/keys` endpoint stays —
  possible external callers — only the frontend wrapper + its test are candidates).
  Not made redundant *by* this change; chat-send provides the pane-targeted
  alternative for the only contemplated UI use.
*Introduced by*: `260714-jdyg-chat-send`
