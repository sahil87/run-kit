# Plan: Chat Read Backend (neutral event schema + Claude adapter + read/stream API)

**Change**: 260714-pmfh-chat-read-backend
**Intake**: `intake.md`

## Requirements

### Chat Schema: rk-owned neutral event types

#### R1: Provider-neutral chat event schema
The package `app/backend/internal/chat` SHALL define provider-neutral Go types
(`Role`, `Event`, `Pending`) that every adapter normalizes into, with the exact
field set and JSON tags recorded in the intake (`type`, `id`, `turn`, `role`,
`text`, `toolUseId`, `toolName`, `toolInput` as `json.RawMessage`, `toolOutput`,
`isError`, `ts`; `Pending{toolUseId, toolName, text}`). `Event.Type` MUST be one
of `message` | `tool_use` | `tool_result`. `Role` MUST be one of `user` |
`assistant` | `system`.

- **GIVEN** an adapter has parsed a provider transcript
- **WHEN** it emits an rk-schema event
- **THEN** the event marshals to JSON with the intake's field names/omitempty
  rules and a stable `id` (the provider line uuid) usable as a dedup key.

#### R2: Turn counter assigned by the adapter
Each `Event.Turn` SHALL be a monotonic per-conversation counter assigned by the
adapter, incrementing at each **user-initiated** message (a user-role message
that is NOT a tool_result carrier). Renderers group by it; no synthetic boundary
events are emitted.

- **GIVEN** a transcript with N user prompts interleaved with assistant turns and
  tool traffic
- **WHEN** the adapter assigns turns
- **THEN** every event carries the turn number of the user prompt that opened its
  turn, and a user message carrying only tool_result blocks does NOT increment
  the counter.

#### R3: Pending derived from an unpaired tool_use at the tail
`Pending` SHALL be derived (not hook-pushed): when the last conversational
`tool_use` in a backfill has no matching `tool_result`, the adapter emits a
`Pending{toolUseId, toolName, text}`. `text` SHALL be populated from a
human-readable question when derivable (e.g. `AskUserQuestion` input), else left
empty. Idle sessions ending in a `text` block yield no `Pending`.

- **GIVEN** a transcript whose tail is an `AskUserQuestion` tool_use with no
  following tool_result
- **WHEN** the adapter backfills
- **THEN** the result carries a non-nil `Pending` naming that tool_use id/name.
- **AND GIVEN** a transcript whose tail is a `text` block, **THEN** `Pending` is
  nil.

### Adapter Seam: interface + registry

#### R4: Adapter interface and provider registry
`adapter.go` SHALL declare one `Adapter` interface exposing per-ref **backfill**
and **tail** operations, and a `map[provider]Adapter` registry. v1 registers
`claude`. Lookup is by the `@rk_chat` provider prefix. A well-formed but
unregistered provider SHALL return a sentinel "no adapter" error the API layer
maps to a 404-class JSON error — presence-gating stays provider-agnostic.

- **GIVEN** a chat ref with provider `codex` (unregistered in v1)
- **WHEN** the registry is asked for an adapter
- **THEN** it returns the "no adapter" sentinel error, not a panic or a generic
  failure.

### Claude Adapter: locate / parse / tail

#### R5: Locate the transcript by UUID glob with a path-traversal guard
The Claude adapter SHALL resolve the transcript root as `$CLAUDE_CONFIG_DIR` if
set, else `~/.claude`, and locate the file by glob `{root}/projects/*/<ref>.jsonl`.
Before ANY filesystem use, `<ref>` MUST match strict UUID shape
(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`). A non-UUID ref
SHALL be rejected before touching disk.

- **GIVEN** a ref containing `../` or any non-UUID character
- **WHEN** the adapter is asked to locate the transcript
- **THEN** it returns an error without performing any glob/stat/open.
- **AND GIVEN** a valid UUID with no matching file, **THEN** it returns a
  distinguishable "not found" read error.

#### R6: Tolerant line-by-line JSONL parse
The parser SHALL scan line-by-line, decoding each line into a loose envelope
(`type`, `uuid`, `parentUuid`, `timestamp`, `isSidechain`, `sessionId`,
`message{role, content}`). It SHALL handle `message.content` as EITHER a JSON
array of blocks OR a plain string. Conversation lines are `type` `assistant` and
`user`; all other line types are skipped. Block types `text` → message Event,
`tool_use` → tool_use Event, `tool_result` → tool_result Event; `thinking` is
skipped in v1. `tool_result.content` SHALL be flattened to text whether it is a
string or an array of text blocks. Unknown line types, unknown block types, and
malformed lines SHALL be skipped (malformed lines debug-logged and counted, never
fatal). Lines with `isSidechain: true` SHALL be excluded from the v1 stream.

- **GIVEN** a transcript containing unknown line types, an unknown block type, a
  malformed (non-JSON) line, a string-content user message, and a sidechain line
- **WHEN** the parser runs
- **THEN** it yields only the conversational events, skips the rest without error,
  and the malformed-line count is > 0.

#### R7: Byte-offset tail with partial-line and rewrite handling
After backfill the adapter SHALL remember the file byte offset and stat-poll the
file (~300–500ms cadence, named constants) for the life of the stream. On growth
it reads from the offset and parses only COMPLETE lines (a partial final line
without a trailing newline is held until its newline arrives). On shrink/rewrite
(size < offset) it SHALL full-re-derive and re-backfill. No fsnotify dependency.

- **GIVEN** an open tail and the transcript grows by one complete line then a
  partial line
- **WHEN** the next poll tick fires
- **THEN** the complete line is emitted and the partial line is withheld until its
  newline lands.
- **AND GIVEN** the file is truncated/rewritten below the offset, **THEN** the
  adapter signals a reset (full re-backfill).

#### R8: No caching beyond stream lifetime
No derived state SHALL outlive the request/stream. The only retained state is the
per-connection byte offset, which dies with the connection (Constitution II).

- **GIVEN** `rk serve` is restarted mid-conversation
- **WHEN** a client reconnects
- **THEN** the backfill is re-derived from disk in full — nothing is lost, nothing
  was cached across the restart.

### Read/Stream API: two window-keyed GET routes

#### R9: Backfill endpoint `GET /api/windows/{windowId}/chat`
The handler SHALL resolve the window's **reconciled** `@rk_chat` rollup
server-side (active pane first, else first pane carrying one — Change 1's
`rollupChat` via `FetchSessions`), route to the provider adapter, and return
`{"provider", "sessionRef", "events": [...], "pending": {...}|null}` as JSON. It
SHALL be a GET (Constitution IX). It SHALL be curl-able.

- **GIVEN** a live `claude` window with a reconciled `@rk_chat`
- **WHEN** a client GETs the backfill route
- **THEN** it returns 200 with the conversation as rk-schema JSON.

#### R10: Stream endpoint `GET /api/windows/{windowId}/chat/stream`
The handler SHALL open a dedicated per-view SSE stream (NOT the shared sessions
hub). On connect it SHALL emit one `chat-backfill` event carrying the same object
as R9, then incremental `chat` events (appended rk-schema events) and
`chat-state` events (pending transitions) as the transcript grows. It SHALL set
`text/event-stream` headers, write behind `http.Flusher`, send heartbeat comments
on idle, and terminate cleanly on client disconnect (request context) WITHOUT
throwing (code-review.md rule). No goroutine SHALL outlive its connection.

- **GIVEN** a connected chat stream and a new transcript turn
- **WHEN** the turn lands on disk
- **THEN** a `chat` event is emitted live on the open connection.
- **AND GIVEN** the client disconnects, **THEN** the handler returns without panic
  and leaves no goroutine running.

#### R11: Session rotation reset on the same connection
The stream SHALL re-resolve the window's `@rk_chat` ref on a slower cadence
(~2s, named constant). On a ref change (session rotation via `/clear`/`/compact`)
it SHALL emit a fresh `chat-backfill` (reset semantics) for the new session on the
SAME connection — a deep-linked chat view survives rotation without reconnecting.

- **GIVEN** an open chat stream whose window `@rk_chat` re-stamps to a new UUID
- **WHEN** the ~2s re-resolve tick observes the change
- **THEN** a fresh `chat-backfill` for the new ref is emitted on the same
  connection.

#### R12: Error surfaces
The handlers SHALL return: 404 JSON error when the window has no reconciled chat;
a 404-class "no adapter for provider" JSON error for a well-formed unknown
provider; and a read error when the transcript file is missing for a live ref.
An invalid `{windowId}` SHALL be a 400 (mirroring existing window handlers).

- **GIVEN** a window with no `@rk_chat`
- **WHEN** a client hits either chat route
- **THEN** the response is a 404 JSON error object.

### Plan tracking table

#### R13: Tracking-table rows (already done at intake)
Row 1 of the tracking table in `fab/plans/sahil/agent-chat-view.md` is marked Done
and row 2 carries this folder name. This is ALREADY complete (intake) — no further
edit is required by apply. Row 2 flips to Done when this PR merges (out of apply
scope).

- **GIVEN** the tracking table
- **WHEN** apply runs
- **THEN** no tracking-table edit is performed (already done at intake).

### Non-Goals

- No frontend work (Change 3 owns the UI).
- No send path / mutations (Change 4; all routes here are GET).
- No SDK hosting, SessionStore, DB, or caches beyond stream lifetime.
- No `thinking`-block rendering, no sidechain inclusion, no cursor protocol (all
  additive later).
- No changes to `internal/tmux`, `internal/sessions`, the SSE hub, or any existing
  endpoint.

### Design Decisions

1. **Go JSONL tail, not a node SDK shim**: parse the transcript directly in Go —
   *Why*: no node runtime dependency, natural live tailing, rk stays one
   brew-installed binary; the SDK read surface churns and is one-shot only —
   *Rejected*: node shim via `exec.CommandContext` (dependency creep,
   poll-respawn for tail), pane-resident sidecar (most moving parts). Mitigated by
   a tolerant parser + pinned fixture (plan risk #1).
2. **Window-keyed routes, server-resolved ref**: URLs carry no session UUIDs; the
   backend always re-resolves the reconciled `@rk_chat` rollup — *Why*: mirrors
   every `/api/windows/{windowId}/*` route and never trusts a client-supplied ref
   over the reconciler — *Rejected*: ref-in-URL (stale/spoofable).
3. **Dedicated per-view SSE endpoint, not the sessions hub**: transcript appends
   generate no tmux events, so the hub would need a new wake source anyway; a chat
   stream exists only while a chat view is open (+1 bounded connection) — *Why*:
   keeps per-connection offset state stream-scoped (Constitution II) and inside
   the plaintext 6-slot budget — *Rejected*: scope on the shared hub.
4. **Reset-on-reconnect stream contract (no cursor)**: connect ⇒ full backfill,
   then appends; reconnect = full re-derive — *Why*: matches plan acceptance
   ("loses nothing") and avoids a backfill/tail gap race — *Rejected*: cursor
   protocol (additive later).

## Tasks

### Phase 1: Setup

- [x] T001 Create package `app/backend/internal/chat/schema.go` with `Role`, `Event`, `Pending` types (exact fields/JSON tags per intake), plus the `EventType*`/`Role*` string constants. <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 In `app/backend/internal/chat/adapter.go`, define the `Adapter` interface (`Backfill(ctx, ref) (*Conversation, error)` and a tail seam returning a channel/iterator of incremental events + pending transitions bounded by ctx), a `Conversation` result struct (`Provider`, `SessionRef`, `Events`, `Pending`), the `map[string]Adapter` registry with `Register`/`Lookup`, and the `ErrNoAdapter` sentinel. <!-- R4 -->
- [x] T003 In `app/backend/internal/chat/claude.go`, implement transcript location: root = `$CLAUDE_CONFIG_DIR` else `~/.claude`; strict-UUID guard on the ref BEFORE any filesystem call; glob `projects/*/<ref>.jsonl`; distinguishable not-found error. <!-- R5 -->
- [x] T004 In `claude.go`, implement the tolerant line-by-line parser: loose envelope decode, string-or-array `message.content`, block mapping (text/tool_use/tool_result; thinking skipped), tool_result flatten (string or text-block array), skip unknown line/block types and malformed lines (debug-log + count), exclude `isSidechain`. Assign the per-event `turn` counter (R2) and derive `Pending` from an unpaired tail tool_use with `AskUserQuestion` question text when derivable (R3). <!-- R6 --> <!-- rework: delete dead parser field seenFirstMsg (claude.go:297, written at :382 but never read) — must-fix parsimony -->
- [x] T005 In `claude.go`, implement `Backfill` (parse whole file → `Conversation`, remember byte offset) and the tail loop: stat-poll at a named ~300–500ms cadence, read-from-offset parsing only complete lines (hold partial final line), full re-derive on shrink/rewrite, no fsnotify, no state beyond the per-stream offset; register `claude` in the registry. <!-- R7 --> <!-- rework: remove unreachable io.EOF newline arm in tail read loop (claude.go:336-341, bufio.ReadBytes never returns EOF for a delimiter-bearing line) — nice-to-have folded in -->

### Phase 3: Integration & Edge Cases

- [x] T006 Create `app/backend/api/chat.go` `handleChatBackfill` for `GET /api/windows/{windowId}/chat`: validate windowId (parseWindowID), resolve the reconciled `@rk_chat` rollup server-side via `FetchSessions` + a window lookup, 404 when absent, `ErrNoAdapter`→404-class, transcript-missing→read error, else return `{"provider","sessionRef","events","pending"}`. <!-- R9 --> <!-- rework: resolveWindowChat must distinguish FetchSessions failure (500) from genuinely-no-chat (404) (chat.go:33-35); delete dead alias chatBackfillPayload (chat.go:24) — must-fix parsimony + should-fix -->
- [x] T007 In `api/chat.go` add `handleChatStream` for `GET /api/windows/{windowId}/chat/stream`: dedicated SSE (text/event-stream, Flusher, heartbeat), emit `chat-backfill` then `chat`/`chat-state` events off the adapter tail; ~2s ref re-resolve emitting a fresh `chat-backfill` on ref change (R11); client-disconnect via request context without throwing; no goroutine outlives the connection. <!-- R10 --> <!-- rework: MUST-FIX R11/A-011 — treat ErrTranscriptNotFound as "not yet" on live stream (lazy transcript creation post-/clear: keep connection open, retry until file appears, mirroring tailLoop stat-vanish tolerance) on BOTH rotation tick (chat.go:188-193) and initial connect (chat.go:140-146); fix provider-change branch ordering (chat.go:175-183 — do not commit ref before adapter Lookup succeeds) -->
- [x] T008 Wire the two GET routes in `app/backend/api/router.go` (next to the other `/api/windows/{windowId}/*` routes). <!-- R9 -->
- [x] T009 Error-surface pass across `api/chat.go`: 404 no-chat, 404-class no-adapter, transcript read error, 400 invalid windowId — as JSON error objects matching `writeError` shape. <!-- R12 --> <!-- rework: malformed claude ref under a valid window should surface 404-class, not 500 err.Error() (chat.go:84-90) — client only supplied windowId -->

### Phase 4: Tests & Fixture

- [x] T010 Capture a SANITIZED real transcript sample from `~/.claude/projects/` into `app/backend/internal/chat/testdata/` (structural shape preserved, sensitive text scrubbed); record the producing Claude Code version in a `testdata/README.md` (or header comment). <!-- R6 -->
- [x] T011 [P] Write `app/backend/internal/chat/schema_test.go` + `claude_test.go`: parser tests against the pinned fixture plus synthetic drift cases (unknown line type, unknown block, malformed line, truncated final line, string-content message, sidechain exclusion), turn-counter, pending-derivation (AskUserQuestion tail vs text tail), tool_result string+array flatten, and the strict-UUID / path-traversal guard. <!-- R6 -->
- [x] T012 [P] Write `app/backend/api/chat_test.go`: backfill handler (happy path via a stub SessionFetcher, 404 no-chat, 404 no-adapter, 400 invalid windowId) and the stream handler (backfill event on connect, client-disconnect returns without throwing). <!-- R10 -->

## Execution Order

- T001 → T002 → (T003, T004) → T005 (core adapter chain; T004 depends on T001 types, T005 depends on T003/T004).
- T006/T007 depend on T002–T005; T008 wires T006/T007; T009 refines T006/T007.
- T010 before T011 (fixture feeds parser tests). T011/T012 are `[P]` once their subjects exist.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `internal/chat/schema.go` defines `Role`, `Event`, `Pending` with the intake's exact fields and JSON tags; `toolInput` is `json.RawMessage`.
- [x] A-002 R2: Every event carries the turn of its opening user prompt; a tool_result-only user message does not increment the counter (unit-tested).
- [x] A-003 R3: An `AskUserQuestion` tail yields a non-nil `Pending` (with question text when derivable); a `text` tail yields nil `Pending` (unit-tested).
- [x] A-004 R4: `adapter.go` exposes the `Adapter` interface + `map[provider]Adapter` registry; `claude` is registered; an unregistered well-formed provider returns `ErrNoAdapter`.
- [x] A-005 R5: The Claude adapter honors `$CLAUDE_CONFIG_DIR`/`~/.claude`, locates by `projects/*/<ref>.jsonl`, and rejects a non-UUID ref before any filesystem call (unit-tested).
- [x] A-006 R6: The tolerant parser yields only conversational events and skips unknown line types, unknown blocks, malformed lines, and sidechain lines; string-or-array content both parse (fixture + drift tests pass).
- [x] A-007 R7: The tail reads from the byte offset, holds a partial final line, and re-derives on shrink/rewrite; cadence constants are named; no fsnotify import.
- [x] A-008 R8: No state is cached beyond the per-stream byte offset; a full re-derive occurs on reconnect (no package-level cache map introduced).
- [x] A-009 R9: `GET /api/windows/{windowId}/chat` returns `{"provider","sessionRef","events","pending"}` for a live claude window and is curl-able (handler test passes).
- [x] A-010 R10: `GET /api/windows/{windowId}/chat/stream` is a dedicated SSE emitting `chat-backfill` then `chat`/`chat-state`, behind `http.Flusher`, with heartbeat and clean client-disconnect (handler test passes).
- [x] A-011 R11: The stream re-resolves the ref on a ~2s cadence and emits a fresh `chat-backfill` on ref change (logic present + named `chatRefResolveInterval`). **Met (rework)**: a `Tail` `ErrTranscriptNotFound`/`ErrInvalidRef` is now treated as "not yet" rather than terminal — the connection is held open and the same re-resolve tick retries the current ref until the lazily-created transcript appears, then delivers its `chat-backfill` (`chatStream.subscribe` not-yet branch in api/chat.go). Applied on BOTH initial connect and rotation. Covered by `TestChatStreamInitialConnectTranscriptNotYet` and `TestChatStreamRotationTranscriptNotYet` (stream stays open through the no-file window with no `chat-error`, then a fresh backfill for the new ref lands on the same connection).
- [x] A-012 R13: No tracking-table edit is performed during apply (already done at intake).

### Behavioral Correctness

- [x] A-013 R7: A partial final line (no trailing newline) is withheld from tail output until its newline arrives (unit-tested).
- [x] A-014 R6: `tool_result.content` flattens to `toolOutput` text for BOTH the string and text-block-array forms (unit-tested).

### Edge Cases & Error Handling

- [x] A-015 R12: Window with no reconciled chat → 404 JSON error; well-formed unknown provider → 404-class JSON error; invalid windowId → 400.
- [x] A-016 R5: A missing transcript for a valid-UUID live ref surfaces as a read error (not a silent empty conversation).
- [x] A-017 R10: The SSE handler returns without panic on client disconnect and starts no goroutine that outlives the connection.

### Security

- [x] A-018 R5: The strict-UUID gate blocks path traversal (`../`, absolute paths, glob metacharacters) before any filesystem access.
- [x] A-019 R9: All new routes are GET only; no mutation is introduced (Constitution IX).

### Code Quality

- [x] A-020 Pattern consistency: New code follows the naming/structure of `api/preview.go`, `api/sse.go`, and `internal/tmux`/`internal/sessions` (error handling via `writeError`/`writeJSON`, exported-doc-comment style).
- [x] A-021 No unnecessary duplication: Window resolution reuses `parseWindowID`/`FetchSessions`/`rollupChat` (Change 1) rather than re-reading `@rk_chat` from tmux directly.
- [x] A-022 exec/subprocess: Any subprocess (tmux resolution) goes through existing `internal/tmux` helpers using `exec.CommandContext` with timeouts; no shell strings (Constitution I).
- [x] A-023 No database/caches: No DB/ORM import and no in-memory cache beyond the per-stream offset (Constitution II).
- [x] A-024 SSE hygiene: The stream handler handles client disconnection without throwing and writes behind `http.Flusher` (code-review.md).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (Re-review after rework cycle 1: the two zero-call-site symbols the prior review flagged — `chatBackfillPayload` and `seenFirstMsg` — were deleted during rework; no remaining symbol in the diff is unused, and no pre-existing code was made redundant.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Adapter interface exposes `Backfill(ctx, ref) (*Conversation, error)` plus a ctx-bounded tail seam (channel of incremental events + pending transitions); registry is `map[string]Adapter` keyed by provider prefix with an `ErrNoAdapter` sentinel | Intake §1 names "one Adapter interface (backfill + tail, per-ref) and a map[provider]Adapter registry"; the concrete Go signature is house style (ctx-first, error-last), the only under-specified detail | S:80 R:70 A:85 D:80 |
| 2 | Certain | `Conversation` result struct carries `Provider`, `SessionRef`, `Events []Event`, `Pending *Pending` and marshals to the intake's `{"provider","sessionRef","events","pending"}` backfill object | Intake §3 states the exact JSON object shape; the Go struct is the direct mapping | S:85 R:75 A:90 D:85 |
| 3 | Confident | Tail seam returns incremental events over a Go channel closed on ctx cancel (no fsnotify), driven by a stat/offset poll goroutine that exits with the stream | Intake §2 mandates stat/offset polling, no fsnotify, "no goroutine outlives its connection"; channel-per-stream is the idiomatic Go seam for that lifecycle | S:60 R:70 A:80 D:65 |
| 4 | Confident | Tail poll cadence = 400ms (`tailPollInterval`); ref re-resolve cadence = 2s (`refResolveInterval`) — named constants, midpoints of the intake's ~300–500ms / ~2s ranges | Intake gives ranges, not exact values; midpoint is the neutral pick and the constant name makes it tunable | S:55 R:85 A:80 D:70 |
| 5 | Confident | `tool_result.content` is flattened to `toolOutput` text by concatenating text-block `text` fields (array form) or using the string verbatim (string form); non-text inner blocks are dropped | Verified at apply against live transcripts: content is a string OR an array of `{type:text,text:...}`; intake says "flattened to text"; dropping non-text inner blocks matches the v1 text-only scope | S:70 R:75 A:80 D:70 |
| 6 | Confident | Window resolution in the handlers reuses `FetchSessions(ctx, server)` then finds the window by `WindowID` and reads its rolled-up `ChatProvider`/`ChatSessionRef` (Change 1's `rollupChat` already applied in FetchSessions) | Change 1 computes the rollup in FetchSessions and exposes it on `WindowInfo`; re-deriving avoids trusting a client ref and reuses the merged contract (A-021) | S:65 R:75 A:85 D:75 |
| 7 | Confident | `Pending.Text` for `AskUserQuestion` is derived from the first question's prompt text in the tool_use `input.questions` array; other unpaired tool_use tails set `toolUseId`/`toolName` with empty `text` | Verified at apply: AskUserQuestion input has a `questions` key; intake says text "when derivable"; other tools have no standard question field so empty text is correct | S:55 R:70 A:75 D:65 |
| 8 | Confident | Permission-gated-tool pending (intake Open Question) is handled by the same unpaired-tail rule with no special-casing; if such a tool_use is not persisted until granted, Pending under-fills for that class in v1 (accepted; `@rk_agent_state=waiting` still drives the badge) | Intake Open Questions row 9 explicitly accepts this worst case for v1; no extra code is warranted for an unobserved persistence-timing case | S:50 R:75 A:70 D:70 |
| 9 | Confident | Turn counter starts at 1 and increments on each user-role message whose content is NOT solely tool_result blocks (a tool_result-carrier user line keeps the current turn); string-content user messages (slash commands) DO open a turn | Intake §1 defines the increment rule ("user-initiated message that is not a tool_result carrier"); string-content user lines are genuine user prompts (verified: slash commands), so they open turns | S:55 R:70 A:75 D:65 |
| 10 | Confident | Handler test seam reuses the existing `NewTestRouter` + a stub `SessionFetcher`/`TmuxOps` (as in preview_test/windows_test); the Claude adapter is tested directly against fixtures rather than through a live filesystem in the handler test | Mirrors the established api test pattern (mockSessionFetcher); keeps handler tests hermetic without a real `~/.claude` | S:60 R:85 A:80 D:75 |
| 11 | Confident | (Rework) The lazy-transcript "not yet" tolerance treats BOTH `chat.ErrTranscriptNotFound` AND `chat.ErrInvalidRef` as non-terminal on a live stream (hold open, retry the current ref each ~2s tick). `errInvalidRef` was exported to `chat.ErrInvalidRef` so the API layer can classify it | A just-cleared session's re-stamped `@rk_chat` can momentarily present as either shape; both are transient-on-a-live-ref, so both are held rather than killing the stream. Export mirrors the existing `ErrTranscriptNotFound`/`ErrNoAdapter` sentinels the API already switches on | S:60 R:70 A:80 D:70 |
| 12 | Confident | (Rework) On rotation the handler resolves the new provider's adapter via `chat.Lookup` BEFORE committing `ref`/`provider`/`adapter`; a Lookup miss for a changed provider keeps the current subscription untouched and retries next tick (never commits a ref it cannot serve, never calls the OLD adapter with the NEW ref) | Fixes SHOULD-FIX 1 (the prior code committed `ref` before Lookup, making the "retry next tick" comment unreachable and calling the old adapter with the new ref) | S:70 R:75 A:85 D:80 |
| 13 | Confident | (Rework) `chatRefResolveInterval` is a package `var` (not a `const`) solely so tests can shrink it; production always uses 2s. It remains a single named, tunable value (A-011's "named constant" intent preserved) | A `const` cannot be overridden per-test; the not-yet-transcript tests need a fast retry cadence to run in <1s instead of multi-second waits. The name and single-source-of-truth property are unchanged | S:55 R:85 A:80 D:70 |
| 14 | Confident | (Rework) A FetchSessions failure in `resolveWindowChat` returns a distinct `error` (mapped to 500, mirroring `handleSessionsList`); ok=false with nil error remains the genuine 404 (window absent / no reconciled chat). Mid-stream (post-header) fetch failures are tolerated (retry next tick), not surfaced | Fixes SHOULD-FIX 2 — a transient tmux fault must not be misreported as "no chat session" (404). Pre-header it is a 500; post-header no HTTP status can be set, so the tolerant-retry path matches the lazy-transcript handling | S:70 R:75 A:85 D:80 |

14 assumptions (2 certain, 12 confident, 0 tentative).
