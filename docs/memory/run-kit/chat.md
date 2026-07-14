---
type: memory
description: "The chat-read subsystem — rk-owned neutral chat event schema (Event/Pending/turn counter), the Adapter interface + provider registry, the Claude JSONL adapter (UUID-glob locate, tolerant line-by-line parse, byte-offset tail), and the two window-keyed read/stream endpoints — a READ-ONLY, derive-from-disk-per-request view over an agent pane's transcript (Constitution II/VI)"
---
# Chat Read Subsystem

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
