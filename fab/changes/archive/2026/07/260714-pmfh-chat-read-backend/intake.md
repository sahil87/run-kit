# Intake: Chat Read Backend (neutral event schema + Claude adapter + read/stream API)

**Change**: 260714-pmfh-chat-read-backend
**Created**: 2026-07-14

## Origin

> chat-read-backend — see fab/plans/sahil/agent-chat-view.md Change 2: chat-read-backend. Depends on Change 1 (chat-session-identity, merged to main as of this spawn). Reference the plan explicitly in the intake.

One-shot invocation against a pre-authored plan: **`fab/plans/sahil/agent-chat-view.md`** (authored 2026-07-13 in a `/fab-discuss` session). This change is **Change 2 — `chat-read-backend`** of the HTML-agent-chat-view stack. Its dependency, **Change 1 (`260713-nh86-chat-session-identity`), is merged to main** (PR #339, commit `0b3dfd4`) — this branch was fast-forwarded onto it at intake time. Per the pickup protocol:

- The plan's **Decision log** entries are treated as **Certain** (row 1 below); Change 1's merged contract is likewise Certain because it is verified in code (row 2).
- The plan's flagged **"THE decision to resolve at intake"** — the Go↔SDK read boundary — was **asked interactively; the user chose the Go JSONL tail** (row 3).
- Architecture facts were **re-verified 2026-07-14** against code.claude.com: `listSessions()`/`getSessionMessages()` exist (TS + Python) but are **one-shot reads with no tail/subscribe API**; the experimental V2 session API (`createSession()` send/stream) was **removed** in TS SDK 0.3.142 (the SDK read surface itself churns); the transcript **location** convention is now officially documented — `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, overridable root via `$CLAUDE_CONFIG_DIR`, `<encoded-cwd>` = absolute cwd with every non-alphanumeric char replaced by `-` — while the **line format remains internal/unsupported**.

## Why

**Change 1 gave every agent pane a live session key; nothing can read by it yet.** `@rk_chat = claude:<session-uuid>` now arrives per-pane and per-window over `GET /api/sessions` and SSE, but rk has no way to turn that ref into the conversation it names. This change is the substrate the user-facing chat view (Change 3) renders and the send path (Change 4) replies into: an rk-owned, provider-neutral chat event schema, a Claude adapter that reads + tails the transcript, and GET/SSE endpoints that serve it.

**Consequence of not doing it**: the chat stack stalls at identity — Change 3 has no data to render, and the plan's core differentiator ("flip between raw terminal and HTML chat of the *same live session*") stays theoretical.

**Why this shape**: the schema is rk-owned and neutral from day one so Codex/Gemini adapters (plan changes 5–6) are backend-only additions; reads derive from disk at request/stream time with nothing cached beyond the connection (Constitution II), so an `rk serve` restart mid-conversation loses nothing; the agent's parent process stays the tmux pane (Constitution VI) — rk only ever *reads* the transcript. The plan's binding anti-decision stands: no Agent-SDK hosting inside the Go backend, no SessionStore/DB.

## What Changes

### 1. rk-owned neutral chat event schema — new package `app/backend/internal/chat`

Provider-neutral Go types every adapter normalizes into (`schema.go`):

```go
type Role string // "user" | "assistant" | "system"

// Event is one rk-schema chat event; Type discriminates.
type Event struct {
    Type       string          `json:"type"`                 // "message" | "tool_use" | "tool_result"
    ID         string          `json:"id,omitempty"`         // provider line uuid — stable dedup key
    Turn       int             `json:"turn"`                 // monotonic turn counter (see below)
    Role       Role            `json:"role,omitempty"`       // message events
    Text       string          `json:"text,omitempty"`       // markdown text content
    ToolUseID  string          `json:"toolUseId,omitempty"`  // pairs tool_use ↔ tool_result
    ToolName   string          `json:"toolName,omitempty"`   // tool_use
    ToolInput  json.RawMessage `json:"toolInput,omitempty"`  // tool_use input, verbatim provider JSON
    ToolOutput string          `json:"toolOutput,omitempty"` // tool_result, flattened to text
    IsError    bool            `json:"isError,omitempty"`    // tool_result error flag
    Timestamp  string          `json:"ts,omitempty"`         // RFC3339, from the provider line
}

// Pending is the "agent is waiting on the user" marker — a retractable STATE,
// not an append-only event (it resolves when the matching tool_result lands).
type Pending struct {
    ToolUseID string `json:"toolUseId"`
    ToolName  string `json:"toolName"`
    Text      string `json:"text,omitempty"` // human-readable question, when derivable
}
```

- **Turn boundaries** are encoded as a per-event `turn` counter assigned by the adapter (increments at each user-initiated message, i.e. a user-role message that is not a tool_result carrier) — renderers group by it; no synthetic boundary events. Explicit-turn protocols (Codex/ACP) map their native boundaries onto the same counter.
- **Pending question** is *derived, not hook-pushed*: an unpaired `tool_use` at the transcript tail (typically `AskUserQuestion` or a permission-gated tool) yields a `Pending`. **Verified at intake against a live transcript** (this intake session's own `AskUserQuestion` round-trip): the `tool_use` line sits unpaired at the tail while the question is open, and the matching `tool_result` lands when answered; idle sessions end in `text` blocks, so no false pending. Constitution X is untouched — when a fact is derivable from disk, derivation wins; `@rk_agent_state=waiting` remains the independent lifecycle signal Change 3 can cross-check.
- **Adapter seam** (`adapter.go`): one `Adapter` interface (backfill + tail, per-ref) and a `map[provider]Adapter` registry; v1 registers `claude`. Routing key is the `@rk_chat` provider prefix (plan Decision log). Unknown-but-well-formed providers return a clean "no adapter" JSON error — presence-gating stays provider-agnostic.

### 2. Claude adapter — Go JSONL read + tail (`internal/chat/claude.go`)

**The user-decided boundary (asked at intake): parse the transcript directly in Go.** No node runtime, no SDK package distribution problem, natural live tailing; the cost — the line format is officially internal — is mitigated exactly as plan risk #1 prescribes: a **tolerant parser** plus a **pinned fixture test**.

- **Locate**: transcript root = `$CLAUDE_CONFIG_DIR` if set, else `~/.claude`; file found by glob `{root}/projects/*/<ref>.jsonl` (the UUID *is* the filename — no encoded-cwd derivation, robust to slug-rule drift). Before any filesystem use the ref MUST match strict UUID shape (`[0-9a-f-]{36}`) — a path-traversal guard on top of Change 1's reader validation (Constitution I posture applied to file paths).
- **Parse (tolerant by design) — format verified at intake (2026-07-14) against live transcripts on this host**: line-by-line scan; each line decoded into a loose envelope — verified fields `type`, `uuid`, `parentUuid`, `timestamp`, `isSidechain`, `sessionId`, `message{role, content}`. Verified line-type inventory: `assistant` and `user` carry the conversation; `permission-mode`, `mode`, `custom-title`, `agent-name`, `last-prompt`, `attachment`, `file-history-snapshot`, `file-history-delta` (and `summary`/`system` in older/compacted sessions) are non-conversation lines the parser skips. **`message.content` is EITHER an array of blocks OR a plain string** (observed: slash-command user messages are string-content) — the parser handles both. Verified block types: `text` (→ message Event), `tool_use` (→ tool_use Event), `tool_result` (→ tool_result Event), `thinking` (skipped in v1 — additive later). Unknown line types → skipped; unknown block types → skipped; malformed lines → skipped (debug-logged, counted). `isSidechain: true` lines (subagent traffic) are excluded from the v1 stream. Format can still drift across Claude Code versions — tolerance + fixture pinning stay mandatory regardless of today's verification.
- **Fixture pinning**: a sanitized real transcript captured at apply time lands in `internal/chat/testdata/` with the producing Claude Code version recorded; parser tests run against it plus synthetic drift cases (unknown line type, unknown block, malformed line, truncated final line).
- **Tail**: after backfill the adapter remembers the byte offset and stat-polls the file (~300–500ms cadence) for the life of the stream; growth → read from offset, parse only complete lines (partial final line held until its newline arrives); shrink/rewrite → full re-derive and re-backfill. No fsnotify dependency — one stat per tick per open stream is negligible and dependency-free.
- **No caching**: nothing outlives the request/stream — per-connection offset only (Constitution II). Restarting `rk serve` mid-conversation and reconnecting re-derives everything from disk.

### 3. Read/stream API — `app/backend/api/chat.go` + two routes in `router.go`

Both keyed by window, mirroring the existing `/api/windows/{windowId}/*` convention (`?server=` query), so URLs carry no session UUIDs and the backend always re-resolves the **reconciled** `@rk_chat` rollup (active pane first, else first set — Change 1's rule) rather than trusting a client-supplied ref:

| Route | Verb | Behavior |
|-------|------|----------|
| `/api/windows/{windowId}/chat` | GET | Backfill: full conversation as rk-schema JSON — `{"provider", "sessionRef", "events": [...], "pending": {...}\|null}`. curl-able (plan acceptance). |
| `/api/windows/{windowId}/chat/stream` | GET | SSE: on connect, a `chat-backfill` event carrying the same object; then incremental `chat` events (appended rk-schema events) and `chat-state` events (pending transitions) as the transcript grows. |

- Reads are GET (Constitution IX — no mutation anywhere in this change).
- **Dedicated per-view SSE endpoint, not the shared sessions hub**: the hub wakes on tmux control-mode events + a 12s safety ticker — transcript appends generate no tmux events, so chat on the hub would need a new wake source anyway; a chat stream exists only while a chat view is open (bounded +1 connection on the terminal route — well inside the 6-per-origin plaintext budget that bit the board route, and board-pane chat is out of scope plan-wide). The preview precedent is mirrored in *how the event vocabulary is added*, not by riding the same connection.
- **Session rotation**: session ids rotate on `/clear`/`/compact` and the window's `@rk_chat` re-stamps within one hook fire. The stream re-resolves the window's ref on a slower cadence (~2s); on change it emits a fresh `chat-backfill` (reset semantics) for the new session on the same connection — a deep-linked chat view survives `/clear` without reconnecting.
- **Errors**: window has no reconciled chat → 404 JSON error; well-formed unknown provider → 404-class "no adapter for provider" JSON error; transcript file missing for a live ref → surfaced as a read error (per Change 1's no-disk-validation rationale, this endpoint is where a missing transcript naturally shows).
- **SSE hygiene** (code-review.md rules): client disconnect handled via request context without throwing; heartbeat comments on idle, mirroring the existing SSE handler's conventions; stream writes behind `http.Flusher`.
- No new goroutine outlives its connection; every tmux resolution goes through existing `internal/tmux` helpers (`exec.CommandContext` + timeout, Constitution I).

### 4. Plan tracking table

Fill row 2 of the tracking table in `fab/plans/sahil/agent-chat-view.md` with this folder name (done at intake, rides this change's PR); flip row 1's status to Done (its PR #339 is merged — the row lagged); mark row 2 Done when this PR merges.

## Affected Memory

- `run-kit/chat`: (new) chat-read subsystem — rk event schema (Event/Pending/turn counter), adapter interface + provider registry, Claude JSONL adapter (locate/parse/tail rules, fixture pinning), the two window-keyed endpoints, stream contract (backfill → append → state, rotation reset), derive-don't-cache lifecycle
- `run-kit/architecture`: (modify) backend libraries gain `internal/chat`; API endpoint list gains `GET /api/windows/{windowId}/chat` + `GET /api/windows/{windowId}/chat/stream`

## Impact

**Backend only — no frontend work** (Change 3 owns the UI). Touched areas:

- `app/backend/internal/chat/` (new): `schema.go`, `adapter.go`, `claude.go` + tests + `testdata/` fixture
- `app/backend/api/chat.go` (new) + `chat_test.go`: both handlers, provider routing, SSE loop
- `app/backend/api/router.go`: two GET routes
- `fab/plans/sahil/agent-chat-view.md`: tracking-table rows 1–2
- No changes to `internal/tmux`, `internal/sessions`, the SSE hub, or any existing endpoint

**Acceptance (from the plan)**: for a live `claude` pane, curl of the backfill endpoint returns the conversation as rk-schema JSON; the stream emits new turns live; killing and restarting `rk serve` mid-conversation loses nothing (full re-derive on reconnect); the SSE endpoint handles client disconnect without throwing; Go unit tests including the pinned-fixture parser suite.

## Open Questions

- One narrow residual on pending derivation (row 9): the unpaired-`tool_use`-at-tail mechanics are verified for `AskUserQuestion` (observed live at intake); whether a *permission-gated* tool's `tool_use` line is persisted before the permission is granted (vs. only after) was not directly observed — check empirically at apply. Worst case `Pending` under-fills for that prompt class in v1 while `@rk_agent_state=waiting` still drives the badge (schema slot stays).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Chat is a read-only view over the pane; rk-owned neutral schema from day one; backend routes on the `@rk_chat` provider prefix; no SDK hosting, no SessionStore/DB, no send path | Plan Decision log + anti-decision — binding per pickup protocol; Constitution II/VI | S:95 R:80 A:95 D:95 |
| 2 | Certain | Read key contract: `@rk_chat = claude:<session-uuid>`, consumed via Change 1's pre-split reconciled `ChatProvider`/`ChatSessionRef` (per-pane + window rollup) | Merged in main (PR #339); verified in `docs/specs/agent-state.md` § Chat Session Identity and `internal/tmux`/`internal/sessions` code | S:90 R:85 A:95 D:90 |
| 3 | Certain | Go↔SDK boundary: **tail the JSONL directly in Go** — no node shim, no sidecar | Asked — user chose Go tail (recommended). SDK read APIs re-verified one-shot with no subscribe (live tail under a shim = poll-respawn); SDK surface churns (V2 removed in 0.3.142); rk stays a single brew-installed binary; tolerant parser + pinned fixture per plan risk #1 | S:90 R:60 A:85 D:95 |
| 4 | Confident | Endpoints are window-keyed — `GET /api/windows/{windowId}/chat` + `/chat/stream` with `?server=` — resolving the reconciled rollup server-side | Mirrors every existing `/api/windows/{windowId}/*` route; keeps UUIDs out of URLs; never trusts a client-supplied ref over the reconciler | S:60 R:70 A:80 D:65 |
| 5 | Confident | Live stream is a dedicated per-view SSE endpoint, not a scope on the sessions hub | Hub wakes on tmux events + 12s safety net — transcript appends generate no tmux events, so the hub needs a new wake source either way; +1 bounded connection per open chat view is inside the plaintext 6-slot budget (board chat out of scope); per-connection offset is stream-scoped state (Constitution II) | S:55 R:55 A:80 D:60 |
| 6 | Confident | Stream contract: connect ⇒ full `chat-backfill`, then incremental `chat` appends + `chat-state` pending transitions; no cursor protocol in v1; reconnect = full re-derive | Matches plan acceptance verbatim ("loses nothing — full re-derive on reconnect"); avoids a backfill/tail gap race; cursors are additive later | S:60 R:70 A:80 D:70 |
| 7 | Confident | Rotation handling: stream re-resolves the window's `@rk_chat` (~2s cadence); on ref change emits a fresh backfill (reset) on the same connection | Session ids rotate on /clear + /compact (Change 1, verified); a deep-linked chat view must survive rotation; re-resolve reuses existing tmux read helpers | S:50 R:75 A:75 D:65 |
| 8 | Confident | Schema shape: flat `Event` (type/id/turn/role/text/toolUseId/toolName/toolInput/toolOutput/isError/ts) + retractable `Pending`; turn boundaries as a per-event counter, no synthetic events | rk-owned and additive (consumers not built yet — Change 3 adapts cheaply); flat discriminated struct is house JSON style; explicit-turn protocols map onto the counter | S:55 R:75 A:80 D:60 |
| 9 | Confident | Pending question derived from an unpaired `tool_use` at transcript tail; no new hook plumbing | Verified live at intake for `AskUserQuestion` (this session's own round-trip: unpaired at tail while open, paired on answer; idle sessions end in `text` — no false pending); permission-gated-tool persistence timing is the one unobserved case (Open Questions); derivation-over-hooks per Constitution X | S:55 R:60 A:70 D:65 |
| 10 | Certain | JSONL line format: envelope `uuid`/`parentUuid`/`timestamp`/`isSidechain`/`sessionId`/`message{role,content}`; conversation lines `assistant`/`user` among a wider skipped inventory; content string-or-array; blocks text/thinking/tool_use/tool_result | Verified at intake (2026-07-14) by direct inspection of live transcripts on this host, incl. this session's own; tolerant parser + pinned fixture still mandatory for cross-version drift | S:75 R:75 A:90 D:80 |
| 11 | Confident | `isSidechain` (subagent) lines are excluded from the v1 stream | Main-conversation-only matches the chat-view product intent (Task tool_use cards still render); inclusion is an additive filter flag later | S:45 R:80 A:70 D:70 |
| 12 | Confident | Transcript lookup: `$CLAUDE_CONFIG_DIR` honored (else `~/.claude`); locate by glob `projects/*/<ref>.jsonl`; ref must be strict-UUID before filesystem use | Root override + path convention now officially documented (re-verified 2026-07-14); glob avoids encoded-cwd derivation drift; UUID gate is the path-traversal guard | S:55 R:85 A:80 D:75 |
| 13 | Certain | No derived state cached beyond request/stream lifetime; `rk serve` restart ⇒ full re-derive on reconnect | Constitution II verbatim + plan acceptance; per-connection byte offset is the only state and dies with the connection | S:85 R:80 A:95 D:90 |
| 14 | Confident | Tail mechanism: stat/offset polling ~300–500ms per open stream; partial-line hold; shrink ⇒ reset; no fsnotify dependency | One stat per tick per open stream is negligible; avoids a new dependency for a marginal latency win; cadence constants named and tunable | S:45 R:80 A:75 D:60 |

14 assumptions (5 certain, 9 confident, 0 tentative, 0 unresolved).
