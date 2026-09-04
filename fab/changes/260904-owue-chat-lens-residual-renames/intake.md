# Intake: Chat Lens Residual Renames (Sweep Change A2)

**Change**: 260904-owue-chat-lens-residual-renames
**Created**: 2026-09-04

## Origin

One-shot `/fab-new` invocation by the operator, dispatching Change A2 of the
authored plan `fab/plans/sahil/26-09-04-chat-lens-residual-sweep.md`:

> Chat Lens residual sweep - Change A2 (pure renames). Read and follow
> fab/plans/sahil/26-09-04-chat-lens-residual-sweep.md, Change A2 section
> (A2.1-A2.3 plus the A2 hydrate scope) exactly. This worktree is freshly
> branched off main AFTER both A1 (code trim, PR #823) and B (docs sweep,
> PR #820) merged, so their changes are already present - no cherry-pick or
> rebase needed. This is a pure rename change - internal/chat ->
> internal/transcript, chat-send -> agent-send cluster, ComposeSurface chat ->
> broadcast - no behavior change anywhere. Re-verify every referenced location
> against current HEAD before editing, since line numbers may have shifted
> after A1/B landed.

The plan is the design authority; this intake records the plan's A2 section
re-verified against current HEAD (`c7e53140`, post-A1/post-B). Every location
below was grep-confirmed at intake time — line numbers cited here are CURRENT,
superseding the plan's `a8c24104`-era numbers.

## Why

Change `260904-39bp-remove-chat-lens` (PR #817) removed the Chat Lens (the
`?view=chat` frontend, chat backfill endpoint, `kind:"chat"` subscription) and
Change A1 (PR #823) trimmed the dead code. What remains is **naming debt**:
three clusters still carry "chat" names for things that have nothing to do with
the removed chat view.

1. **`internal/chat`** now does exactly one job — resolve `provider:ref` to a
   transcript JSONL path — but its name still implies the removed chat
   subsystem. Readers grep for "chat", find it, and must re-derive that the
   chat view is gone (the memory file `docs/memory/run-kit/chat.md` has the
   same problem at the docs layer).
2. **The chat-send injection cluster** (`rk-chat-send` buffer,
   `ChatSendBuffer`/`SetChatSendBufferCtx`/…, `chatSendEngine`/`chatSendTmux`/
   `chatSendTotalBudget`, the `TmuxOps` seam methods) backs
   `POST /api/windows/{id}/send` — whose agent-targeted mode is literally
   `target:"agent"`. The name predates the endpoint merge and no longer matches
   the surface it serves.
3. **`ComposeSurface: "chat"`** now names only the selection-broadcast Enter
   policy (plain Enter = local newline); no chat form exists. `"broadcast"` is
   what the value actually means.

If not fixed, every future reader pays the "wait, wasn't chat removed?" tax,
and the misnamed identifiers invite accidental re-coupling to the retired
taxonomy. Doing it as a separate pure-rename change (rather than folding into
A1) keeps the review question trivially checkable: *is this a pure rename — no
behavior change anywhere?*

## What Changes

Three rename clusters, zero behavior change. All verified consumer lists below
are from grep at current HEAD.

### A2.1 — `internal/chat` → `internal/transcript`

Post-A1 the package (module path `rk/internal/chat`) is only `adapter.go`
(provider registry + `TranscriptLocator` capability + package-level
`TranscriptPath(provider, ref)`), `claude.go` (UUID guard + transcript glob),
`claude_test.go`, and `testdata/claude_session.jsonl`.

- Rename directory `app/backend/internal/chat/` → `app/backend/internal/transcript/`,
  package `chat` → `transcript`.
- API shape: `chat.TranscriptPath(provider, ref)` → `transcript.Path(provider, ref)`
  (drops the stutter; the plan offers this as the preferred option). The
  `TranscriptLocator` interface keeps its `TranscriptPath(ref)` method name —
  only the package-level function de-stutters. Error sentinels follow:
  `ErrInvalidRef` / `ErrTranscriptNotFound` / `ErrNoAdapter` keep their names;
  their message prefixes change `"chat: …"` → `"transcript: …"` (internal
  strings, not a wire contract).
- **Sole Go import site**: `api/operator.go:12` (`rk/internal/chat`) — usages at
  operator.go:30, 62, 670, 790, 792, 813, 817, 899. (The plan's `a8c24104`-era
  list named fork/closed/auto_name as importers too; post-A1 they no longer
  import the package — they reach transcripts through operator's derivations.)
- `api/operator.go:812` `writeChatReadError` → `writeTranscriptError` (comment
  references at operator.go:690, 796, 901 follow).
- Deliberate-duplicate `uuidRe` comments that cite `internal/chat`:
  `internal/riff/shell.go:42–45`, `api/fork.go:36`.
- `testdata/claude_session.jsonl` moves with the directory;
  `api/chat_fixture_test.go` reads it via the package path (see A2.2's file
  rename).

### A2.2 — chat-send → agent-send cluster

The injection binding backing `POST /api/windows/{id}/send` and the
operator-request routes. The tmux buffer name is transient runtime state —
nothing persists it; the CLI already uses per-invocation names
(`mux_send.go:135` `rk-send-<pid>`), so renaming the constant's value is safe.

- `internal/tmux/tmux.go:2696–2758` — `ChatSendBuffer = "rk-chat-send"` →
  `AgentSendBuffer = "rk-agent-send"`; `SetChatSendBufferCtx` →
  `SetAgentSendBufferCtx`; `PasteChatSendBufferCtx` → `PasteAgentSendBufferCtx`;
  `PasteChatSendBufferRawCtx` → `PasteAgentSendBufferRawCtx` (doc comments
  follow).
- `api/send.go` — `chatSendEngine` → `agentSendEngine`, `chatSendTmux` →
  `agentSendTmux`, `chatSendTotalBudget` → `agentSendTotalBudget` (usages at
  send.go:65, 89, 92–98, 157–169; `chatSendTotalBudget` is also used in
  `api/operator.go`).
- `api/router.go:135–137, 539–546` — `TmuxOps` seam: `SetChatSendBuffer` →
  `SetAgentSendBuffer`, `PasteChatSendBuffer` → `PasteAgentSendBuffer`,
  `PasteChatSendBufferRaw` → `PasteAgentSendBufferRaw` (prod impl follows).
- Test doubles:
  - `api/sessions_test.go` mock (~L254–292, 381, 722–742): `chatCalls` →
    `agentSendCalls` (or similar), `setChatBufferText`/`setChatBufferTexts`,
    `pasteChatPaneID`/`pasteChatPaneIDs`, `setChatBufferHook`, and the mock
    `SetChatSendBuffer`/`PasteChatSendBuffer` methods (must match the renamed
    seam).
  - `api/chat_fixture_test.go` → rename file to `agent_send_fixture_test.go`;
    `testChatRef` / `fastChatSendProbe` / `stageFixtureTranscript` follow
    (e.g. `testTranscriptRef` / `fastAgentSendProbe`; `stageFixtureTranscript`
    is already transcript-named — keep).
  - `internal/inject/inject_test.go` — `NewEngine("rk-chat-send")` literals at
    L280, 329, 437, 457, 486, 526 → `"rk-agent-send"`.
- Comment-only references that follow the rename (verified at HEAD):
  `cmd/rk/mux_send.go:19, 133`; `internal/riff/deliver.go:76`;
  `internal/tmux/layout.go:474` ("mirrors set-buffer in SetChatSendBuffer");
  plus sites the plan didn't enumerate: `internal/sessions/sessions.go:486`,
  `internal/sessions/sessions_test.go:442`, `api/operator.go:768, 826, 885,
  994`, `api/operator_test.go:338` — all say "chat-send" in prose comments.

### A2.3 — `ComposeSurface: "chat"` → `"broadcast"`

- `app/frontend/src/lib/compose-keys.ts:45` —
  `export type ComposeSurface = "strip" | "chat"` → `"strip" | "broadcast"`;
  doc comments at L16, L44 follow.
- `app/frontend/src/components/compose-strip.tsx:717` —
  `isSelectionTarget ? "chat" : "strip"` → `"broadcast"`; comments at L68,
  L703, L1056 follow ("the chat Enter policy" → "the broadcast Enter policy").
- `app/frontend/src/lib/compose-keys.test.ts` — `SURFACES` array (L21),
  test names/assertions (L25, 31, 33, …).
- `app/frontend/src/components/compose-strip.test.tsx` — the `"chat"`-surface
  assertion (plan cited L233; re-locate by grep).

### Out of scope — deliberately KEPT (do not touch)

- `@rk_pane_chat` pane option, `ChatProvider`/`ChatSessionRef` fields (Go +
  JSON wire + snapshot ring), `sessions.ResolveChatPane`/`rollupChat`, the
  agent-hook chat stamp — here "chat" = the agent's conversation session,
  still accurate, and a cross-repo contract with fab-kit mid-migration from
  legacy `@rk_chat` (`docs/specs/agent-state.md`).
- Regression pins asserting the chat-lens removal (`router-url.test.ts`,
  `surface-layout.test.ts`, `use-shell-notifications.test.tsx`,
  `window-heading.spec.ts`).
- False positives: `chatter`/`outputSink.chatter` (Principle 9 stderr channel),
  `chat.disableAIFeatures` (code-server settings key), `"chatty"` fixture name.

### A2 hydrate scope (memory + specs)

- `docs/memory/run-kit/chat.md` — retitle/reframe around the surviving halves
  (transcript locator + agent-send path). **Rename the file** (plan
  recommendation: "chat" as a domain name no longer earns its slot) to
  `agent-send.md`; tombstone per `docs/memory/_shared/removed-domains.md`
  convention; update inbound links (verified at HEAD:
  `agent-messaging.md:47, 133`; `operator-actuation.md:20, 229, 252`;
  `ui/compose-and-bottom-bar.md:43`; `ui/sidebar.md:330`;
  `tmux-sessions.md:270, 273`; `architecture.md:144`; `index.md` regenerates
  via `fab memory-index`).
- `docs/specs/api.md:246–275` — the `POST /api/windows/:windowId/paste` block
  documents a route that does not exist (router has only
  `POST /api/windows/{windowId}/send`, router.go:824) and contrasts
  `/chat/send` twice; replace with the real `POST /send` contract
  (`mode`/`target` body, `rk-agent-send` buffer name at the L265 mechanics
  line).
- `docs/memory/run-kit/agent-messaging.md:574–576` — the DD already argues
  "chat" doesn't describe the mechanics; add the forward pointer to the
  completed rename. Buffer-name mentions at L141, 638, 643 follow.
- DD headings naming the retired surface:
  `ui/compose-and-bottom-bar.md:215` ("composes in chat" → broadcast; the
  `"chat"` policy mentions at L39, 43, 49, 51, 56 follow) and
  `ui/sidebar.md:670–672` ("the CHAT half of the Enter classifier" →
  broadcast).
- `docs/memory/run-kit/operator-actuation.md` — `writeChatReadError` (L232,
  268), `chatSendTotalBudget` (L175, 297), `chat.TranscriptPath` (L163, 228,
  456, 515, 940), "chat-send" prose (L909) follow the renames.
- `docs/memory/run-kit/tmux-sessions.md:270–273` — injection-primitive names
  (`SetChatSendBuffer`/`PasteChatSendBufferCtx`/`rk-chat-send`/
  `chatSendTotalBudget`) follow.
- `docs/memory/run-kit/architecture.md:144` — the `internal/chat` row renames
  to `internal/transcript` with the new function name.

## Affected Memory

- `run-kit/chat.md`: (remove) renamed to `agent-send.md` — retitled/reframed
  around transcript locator + agent-send path; tombstoned in
  `_shared/removed-domains.md`
- `run-kit/agent-send.md`: (new) the renamed/reframed chat.md content with
  post-rename identifiers
- `run-kit/architecture.md`: (modify) `internal/chat` row → `internal/transcript`
- `run-kit/agent-messaging.md`: (modify) DD forward pointer + buffer-name and
  inbound-link updates
- `run-kit/operator-actuation.md`: (modify) `writeTranscriptError` /
  `agentSendTotalBudget` / `transcript.Path` references
- `run-kit/tmux-sessions.md`: (modify) injection-primitive names + chat.md links
- `run-kit/ui/compose-and-bottom-bar.md`: (modify) DD heading + `"broadcast"`
  policy naming + chat.md link
- `run-kit/ui/sidebar.md`: (modify) DD L670 heading + chat.md link at L330
- `_shared/removed-domains.md`: (modify) tombstone row for chat.md → agent-send.md

(Also in hydrate scope, spec side: `docs/specs/api.md` — replace the phantom
`/paste` block with the real `POST /send` contract.)

## Impact

- **Backend Go** (`app/backend/`): `internal/chat/` (directory rename, 2 source
  + 1 test file + testdata), `internal/tmux/tmux.go`, `api/send.go`,
  `api/router.go`, `api/operator.go`, `api/chat_fixture_test.go` (file rename),
  `api/sessions_test.go`, `internal/inject/inject_test.go`, plus comment-only
  edits in `cmd/rk/mux_send.go`, `internal/riff/deliver.go`,
  `internal/riff/shell.go`, `internal/tmux/layout.go`, `api/fork.go`,
  `internal/sessions/sessions.go`, `internal/sessions/sessions_test.go`,
  `api/operator_test.go`.
- **Frontend TS** (`app/frontend/src/`): `lib/compose-keys.ts`,
  `lib/compose-keys.test.ts`, `components/compose-strip.tsx`,
  `components/compose-strip.test.tsx`.
- **No API/wire contract change**: HTTP surface, JSON shapes, tmux option
  names, and SSE/WS payloads are untouched. The tmux paste-buffer name
  (`rk-chat-send` → `rk-agent-send`) is transient per-operation runtime state.
- **No behavior change** — the review question is "is this a pure rename?".
- Verification gates per `fab/project/code-quality.md`: `go test ./...`,
  `tsc --noEmit`, `just test` (e2e must keep passing unmodified — it pins the
  `?view=chat` heal behavior), `just build`.

## Open Questions

None — the authored plan plus HEAD re-verification resolved all decision
points; remaining naming micro-choices are recorded as graded assumptions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Pure rename — no behavior change anywhere; KEPT list (`@rk_pane_chat`, `ChatProvider`/`ChatSessionRef`, `ResolveChatPane`/`rollupChat`, regression pins, false positives) untouched | Plan mandate, stated twice (plan header + invocation args) | S:95 R:90 A:95 D:95 |
| 2 | Confident | Package-level `chat.TranscriptPath` → `transcript.Path`; `TranscriptLocator` interface method keeps `TranscriptPath(ref)` | Plan offers both options, lists `transcript.Path` first; Go idiom avoids `transcript.TranscriptPath` stutter; interface method has no stutter so keeping it minimizes churn | S:70 R:85 A:85 D:70 |
| 3 | Confident | Error sentinel names unchanged; message prefixes `"chat: …"` → `"transcript: …"` | Plan says "errors follow"; messages are internal strings (operator handlers map via `errors.Is`, never string-match), so prefix change is behavior-neutral | S:65 R:90 A:85 D:75 |
| 4 | Certain | Additional comment-only "chat-send" sites found at HEAD (sessions.go:486, sessions_test.go:442, operator.go:768/826/885/994, operator_test.go:338, mux_send.go:19) are in scope | Plan's comment-reference list was explicitly non-exhaustive for a rename sweep; leaving them would defeat the change's purpose; comment-only, zero risk | S:80 R:95 A:90 D:85 |
| 5 | Certain | Memory `chat.md` renames to `agent-send.md` with tombstone + inbound-link updates (incl. architecture.md:144 and tmux-sessions.md:270–273 beyond the plan's list) | Plan states "Recommendation: rename"; inbound links grep-verified at HEAD; hydrate follows the same completeness rule as assumption 4 | S:75 R:80 A:85 D:80 |
| 6 | Confident | Mock/test-double namings: `chatCalls`→`agentSendCalls`, `setChatBufferText`→`setAgentBufferText` (pattern: chat→agent-send/agent), `testChatRef`→`testTranscriptRef`, `fastChatSendProbe`→`fastAgentSendProbe`; `stageFixtureTranscript` kept | Plan gives examples ("e.g."), leaving exact spellings to apply; mechanical mirror of the production renames; test-internal, trivially reversible | S:60 R:95 A:90 D:70 |
| 7 | Certain | Buffer value `"rk-chat-send"` → `"rk-agent-send"` is safe: transient tmux runtime state, nothing persists it, CLI uses per-invocation `rk-send-<pid>` names | Plan states it; verified at HEAD (mux_send.go:133–135 comment + code) | S:85 R:80 A:90 D:90 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).
