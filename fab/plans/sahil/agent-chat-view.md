# Plan: HTML Agent Chat View (chat-over-pane)

**Authored**: 2026-07-13
**Author**: discussion session with Claude (`/fab-discuss`)
**Executor**: agents picking up changes one by one, each via the normal fab pipeline
**Status**: Plan only — no changes drafted yet

## Goal

A web-based, HTML-rendered chat experience for coding agents running in run-kit —
message bubbles, markdown, tool-call cards — as a **second view over the same tmux
pane**, next to the existing terminal view. Read-only chat first, send later,
Claude Code first, Codex/Gemini as optional adapters.

## Strategic framing (why this shape)

Per `docs/wiki/competitive-landscape.md`: run-kit's defensible lane is the
agent-agnostic, tmux-native console — NOT "remote access to an agent conversation"
(Happy / Omnara / CC Remote Control own that). A chat **substrate** that replaces the
pane would move us into Lineage B. A chat **view** over the pane does the opposite:

- The agent's parent process stays the tmux pane, never the rk server (Constitution VI).
- Nobody in the competitive matrix has "flip between raw terminal and HTML chat of the
  *same live session*."
- It fixes run-kit's worst mobile ergonomic (80-col tmux overflow on a phone).

## Architecture facts (verified 2026-07-13 — re-verify at pickup, this space drifts)

Checked against code.claude.com docs during the planning session:

1. **Claude Code has no codex-server equivalent** — no local daemon owning sessions
   over JSON-RPC. `claude mcp serve` exposes tools only; Remote Control is
   Anthropic-only plumbing, not reusable by third-party UIs.
   (https://code.claude.com/docs/en/remote-control.md)
2. **Sessions are disk-owned, not process-owned.** Every session persists live to
   `~/.claude/projects/<cwd-slug>/<session-id>.jsonl`; any process in the same cwd can
   resume by ID (`--resume`, SDK `resume`). Only an in-flight turn dies with the parent.
   (https://code.claude.com/docs/en/sessions.md)
3. **The Agent SDK (TS/Python) has official read APIs** — `listSessions()` and
   `getSessionMessages()` — the supported way to read a session's messages. The raw
   JSONL format is explicitly internal/unstable; direct parsing is unsupported.
   (https://code.claude.com/docs/en/agent-sdk/sessions.md)
4. **Hooks receive `transcript_path` (and session id) in their input JSON** — the
   pane→session mapping keystone. (https://code.claude.com/docs/en/headless.md, hooks docs)
5. **Restart-survival:** tmux is our "codex-server." The pane supervises the agent, so
   an rk restart kills nothing — not even the in-flight turn. On boot rk re-derives
   everything from tmux + disk (Constitution II).

**Anti-decision (binding):** do NOT host the Agent SDK inside the Go backend as the
session owner, and do NOT add a `SessionStore`-to-DB hosting pattern. Both violate
Constitution II (no DB) and VI (tmux independence), even though the SDK docs recommend
them for generic web apps.

## Decision log (committed by this plan — intakes should treat these as Certain)

- **Chat is a view over the pane, not a substrate.** The pane remains the agent's parent.
- **Provider-tagged pane option**: `@rk_chat = <provider>:<session-ref>`
  (e.g. `claude:<session-uuid>`, `codex:<thread-id>`). rk owns the convention; each
  provider's hook/handshake populates it. Frontend gates on presence; backend routes on
  the prefix to a per-provider adapter.
- **View state lives in the URL**: `?view=chat` search param on the existing
  `/$server/$window` route. No new routes (Constitution IV). This makes the
  push-notification → pending-question deep link addressable.
- **Switcher UX**: compact two-state segmented chip (`[tty|chat]`, active side
  inverse-video) in the top-bar right cluster's **L1 tier** (terminal-route-only, where
  splits + fixed-width live). Rendered only when `@rk_chat` is present on the window's
  pane. Palette parity (`View: Chat` / `View: Terminal`) + a keyboard shortcut are
  mandatory (Constitution V). Center heading follows the view: `Chat: <window>`.
- **Connection dot semantics unchanged**: in chat mode the dot reports chat
  event-stream health ("dot-everywhere = per-page live-data health").
- **Persistence**: last view per window in localStorage, `board-autofit`-style
  (key present = chat, absent = terminal default).
- **Read-first**: the read-only view ships before any send path. Send is its own change.
- **rk-owned neutral chat event schema** from day one (roles, text, tool_use/tool_result,
  turn boundaries, pending question) so Codex/Gemini adapters are backend-only work.

## The change stack

Linear dependency order for 1→4. Each row becomes one fab change / one PR.
Agents: fill in your row when you create the change; mark Done when the PR merges.

| # | Slug (suggested) | Depends on | Change folder | PR | Status |
|---|------------------|-----------|---------------|----|--------|
| 1 | `chat-session-identity` | — | `260713-nh86-chat-session-identity` | [#339](https://github.com/sahil87/run-kit/pull/339) | Done |
| 2 | `chat-read-backend` | 1 | `260714-pmfh-chat-read-backend` | | in progress |
| 3 | `chat-read-frontend` | 2 | `260714-r7rq-chat-read-frontend` | | in progress |
| 4 | `chat-send` | 3 | | | not started |
| 5 | `chat-codex-adapter` (optional) | 2, 3 | | | not started |
| 6 | `chat-gemini-acp-adapter` (optional) | 2, 3 | | | not started |

---

### Change 1 — `chat-session-identity`

**Purpose**: the keystone. Define and populate the `@rk_chat` pane-option convention so
rk can map a pane to its live agent chat session.

**Scope**:
- Amend `docs/specs/agent-state.md` with the `@rk_chat` convention: value schema
  (`<provider>:<session-ref>`), writer rules, clearing/reconciliation rules (mirror the
  `@rk_agent_state` shell-reconciler pattern — a dead agent process must not leave a
  stale `@rk_chat`).
- `rk agent-setup` installs the Claude hook that stamps it (hook input carries session
  id + `transcript_path`; decide at intake whether the ref is the session UUID, the
  transcript path, or both).
- Surface the field in `GET /api/sessions` and the SSE payload (per-window/pane).

**Decisions to resolve at intake**: session-ref format; which hook event(s) stamp it
(SessionStart vs first tool-use); clearing trigger; whether the reconciler validates
the referenced session still exists on disk.

**Acceptance**: a pane running `claude` carries `@rk_chat` within seconds of session
start; a shell/htop pane never does; the field arrives over SSE; Go unit tests; spec
updated. No frontend work.

**Read first**: `docs/specs/agent-state.md`, `internal/` agent-state code,
Constitution X (hooks carry only the underivable — the *live* session identity
qualifies: multiple transcripts can share a cwd, so which one is live is ambiguous
from disk alone).

---

### Change 2 — `chat-read-backend`

**Purpose**: normalized chat event schema + Claude read adapter + read/stream API.

**Scope**:
- rk-owned provider-neutral event schema (Go types): message roles, text content,
  tool_use/tool_result pairs, turn boundaries, pending permission question.
- Claude adapter: read + tail a session's messages, keyed off `@rk_chat`.
- API: `GET` backfill endpoint + live stream (dedicated SSE event or per-pane stream —
  mirror how `event: preview` was added). Reads are GET; no mutations in this change.

**THE decision to resolve at intake — the Go↔SDK boundary.** The official read APIs
(`getSessionMessages`) are TypeScript/Python; the backend is Go. Options:
  (a) small node shim invoked via `exec.CommandContext` (supported API; adds a node
      runtime dependency to the backend);
  (b) tail the JSONL directly in Go (no new dependency; format is explicitly
      unsupported/unstable — needs a tolerant parser that skips unknown line types
      and a pinned-version test fixture);
  (c) pane-resident sidecar process (most moving parts; defer unless a/b fail).
Whichever wins: all subprocess calls use `exec.CommandContext` with timeouts
(Constitution I), and no derived state is cached beyond request/stream lifetime
(Constitution II).

**Acceptance**: for a live `claude` pane, a curl of the backfill endpoint returns the
conversation as rk-schema JSON; the stream emits new turns live; killing and
restarting `rk serve` mid-conversation loses nothing (full re-derive on reconnect);
SSE endpoint handles client disconnect without throwing (code-review.md rule).

---

### Change 3 — `chat-read-frontend`

**Purpose**: the user-facing chat view, read-only.

**Scope**:
- `?view=chat` search param on `/$server/$window` (TanStack Router search param).
- `[tty|chat]` segmented chip in the L1 top-bar tier, gated on `@rk_chat` presence;
  palette actions + keyboard shortcut; heading `Chat: <window>`; localStorage
  per-window last-view persistence.
- Renderer: markdown + code blocks, collapsible tool-call cards, streaming turn
  rendering. Match the house terminal aesthetic (monospace, hover-animation vocabulary,
  three-mode theme).
- Waiting integration: pending question renders as the top bubble; WaitingBadge and
  Web Push notifications deep-link to `?view=chat`.
- Connection dot reflects chat stream health in chat mode.
- No input box (or a visibly disabled one pointing at the terminal view) — send is
  change 4.

**Obligations**: Playwright e2e + sibling `.spec.md` companions (constitution);
verify 375px AND desktop viewports; use `just test-e2e` / `just pw` only (port 3020
isolation — never bare playwright).

**Acceptance**: toggle appears only on agent panes; flipping views preserves the
window; deep link `?view=chat` cold-loads into chat; reduced-motion honored;
no new routes.

---

### Change 4 — `chat-send`

**Purpose**: send a message from the chat view into the interactive agent pane.

**Scope**:
- `POST /api/.../chat/send` (Constitution IX: POST) → `tmux paste-buffer` +
  `send-keys Enter` into the pane.
- **Probe-before-Enter discipline is mandatory**: a `❯ <text>` line visible in
  capture-pane can be stale printed output rather than the live input buffer — a bare
  Enter then submits an empty no-op or worse. Verify the input buffer is live (probe
  keystroke / pane state check) before committing.
- Input box in the chat view; busy-agent handling (decide at intake: reject-with-state
  vs queue — recommend reject + surface busy, no server-side queue per Constitution II);
  multiline via paste-buffer / bracketed paste.
- Mobile input ergonomics (visualViewport interplay with the existing
  `useVisualViewport` pin).

**Acceptance**: message sent from the chat view arrives in the agent exactly as typed
(incl. multiline + special chars); sending while busy fails visibly, never silently;
e2e coverage.

---

### Change 5 (optional) — `chat-codex-adapter`

**Purpose**: Codex support via the codex-server shape.

**Shape**: run `codex-server` (OpenAI's session-owning JSON-RPC server, evolved from
`codex app-server`) **inside a tmux pane** — tmux supervises it, so it survives rk
restarts like everything else. rk backend speaks JSON-RPC to it: session identity from
the protocol handshake (no hook needed → stamps `@rk_chat = codex:<thread-id>`), reads
and sends over the protocol (send bypasses tmux send-keys entirely, so this change does
NOT depend on change 4).

**UX nuance**: a codex-server pane is headless — its terminal view is just server logs.
Keep both toggle sides (watching the raw process is the run-kit ethos) but default such
panes to `?view=chat` (default derived from the provider prefix).

**Verify at pickup (post-knowledge-cutoff)**: current codex-server invocation, protocol
surface (thread create/resume/subscribe), and whether an interactive `codex` TUI session
can be observed at all (rollout JSONL in `~/.codex/sessions/` has no official read API;
the `notify` hook payload was NOT verified to carry session identity). v1 scope:
Codex chat requires the codex-server shape; interactive-TUI Codex panes stay
terminal-only.

---

### Change 6 (optional) — `chat-gemini-acp-adapter`

**Purpose**: Gemini CLI support — and generalization — via ACP (Agent Client Protocol,
JSON-RPC; Gemini CLI speaks it natively, Claude Code has a `claude-code-acp` adapter).

**Shape**: same as change 5 with a different protocol: an ACP-speaking agent process in
a pane, rk as ACP client, normalized into the rk chat schema. Consider building this as
a *generic* ACP adapter rather than Gemini-specific — that makes "add any ACP agent"
zero-frontend work.

**Verify at pickup**: ACP spec maturity + Gemini CLI's ACP server mode invocation.

---

## Pickup protocol (for the agent taking the next change)

1. Read this plan in full, plus: `fab/project/constitution.md`,
   `docs/specs/agent-state.md`, the `ui-patterns` and `architecture` memory files,
   and `docs/wiki/competitive-landscape.md` (the "why").
2. Check the tracking table above + `fab change list` — take the lowest-numbered
   change whose dependencies are **merged to main** (not just PR-open).
3. Draft it: `/fab-new <slug from the table>` (or `/fab-draft` if not activating).
   Reference this plan (`fab/plans/sahil/agent-chat-view.md`) in the intake.
4. Treat the **Decision log** entries as Certain in SRAD scoring; the per-change
   "decisions to resolve at intake" are where clarification effort goes. Re-verify
   the "Architecture facts" that your change depends on — docs drift.
5. Fill in your row in the tracking table (change folder name) in the same PR;
   mark it Done when the PR merges.
6. Then run the normal pipeline (`/fab-fff` or stage-by-stage `/fab-continue`).

## Out of scope (entire plan)

- Board-pane chat toggle (per-pane `[tty|chat]` flip on `/board/$name`) — great later,
  multiplies renderer work now.
- Auto-defaulting mobile to chat view (let the deep link + remembered choice do it).
- Chat over interactive Codex TUI panes (no supported read seam — see change 5).
- Any conversation storage in rk (DB, caches, SessionStore) — constitutionally barred.
- Wrapping/replacing the agent process; run-kit stays below the agent.

## Risk register

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Claude transcript/SDK read API drift (formats + APIs are young) | Change 2 pins a version + fixture tests; tolerant parser skips unknown event types; re-verify docs at pickup |
| 2 | send-keys injection is lossy (stale-prompt trap) | Probe-before-Enter is a hard requirement in change 4's acceptance; read-only value ships first regardless |
| 3 | node-runtime dependency creep in the Go backend (option a in change 2) | Contained behind one adapter interface; option b (Go JSONL tail) is the fallback; decision documented at intake |
| 4 | Stale `@rk_chat` after agent death → dead toggle in UI | Reconciler clearing rules are in change 1's acceptance, not an afterthought |
| 5 | Scope creep toward agent-coupling (Lineage B drift) | The Decision log's view-over-pane framing is binding; anything wrapping the agent process is out of scope |
| 6 | codex-server / ACP surfaces changed since 2026-07 | Changes 5/6 are optional and start with a verification pass; nothing in 1–4 depends on them |
