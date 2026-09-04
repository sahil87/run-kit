# Plan: Chat Lens Residual Renames (Sweep Change A2)

**Change**: 260904-owue-chat-lens-residual-renames
**Intake**: `intake.md`

## Requirements

### Backend: transcript locator package

#### R1: `internal/chat` renames to `internal/transcript`
The Go package `app/backend/internal/chat` SHALL be renamed to
`app/backend/internal/transcript` (directory, package clause, testdata moves
with it). The package-level `chat.TranscriptPath(provider, ref)` SHALL become
`transcript.Path(provider, ref)`; the `TranscriptLocator` interface keeps its
`TranscriptPath(ref)` method name. Error sentinels `ErrInvalidRef` /
`ErrTranscriptNotFound` / `ErrNoAdapter` SHALL keep their names with message
prefixes changed `"chat: …"` → `"transcript: …"`. The sole import site
(`api/operator.go:12`) SHALL be updated, `writeChatReadError` SHALL become
`writeTranscriptError` (all comment references follow), and the
deliberate-duplicate `uuidRe` comments in `internal/riff/shell.go:42–45` and
`api/fork.go:36` SHALL cite `internal/transcript`.

- **GIVEN** the post-A1 package resolves `provider:ref` → transcript JSONL path
- **WHEN** the package and its exported names are renamed
- **THEN** `go build ./...` and `go test ./...` pass with zero behavior change
- **AND** `errors.Is` mappings in operator handlers still match (sentinel
  identity is preserved; only message strings changed)

### Backend: agent-send injection cluster

#### R2: chat-send renames to agent-send
The injection cluster backing `POST /api/windows/{id}/send` SHALL be renamed
chat→agent-send end to end, with no behavior change:

- `internal/tmux/tmux.go:2696–2758`: `ChatSendBuffer = "rk-chat-send"` →
  `AgentSendBuffer = "rk-agent-send"`; `SetChatSendBufferCtx` →
  `SetAgentSendBufferCtx`; `PasteChatSendBufferCtx` → `PasteAgentSendBufferCtx`;
  `PasteChatSendBufferRawCtx` → `PasteAgentSendBufferRawCtx`.
- `api/send.go`: `chatSendEngine` → `agentSendEngine`, `chatSendTmux` →
  `agentSendTmux`, `chatSendTotalBudget` → `agentSendTotalBudget` (usages in
  `api/operator.go` follow).
- `api/router.go:135–137, 539–546` `TmuxOps` seam: `SetChatSendBuffer` →
  `SetAgentSendBuffer`, `PasteChatSendBuffer` → `PasteAgentSendBuffer`,
  `PasteChatSendBufferRaw` → `PasteAgentSendBufferRaw`.
- Test doubles: `api/sessions_test.go` mock fields/methods (`chatCalls` →
  `agentSendCalls`, `setChatBufferText(s)` → `setAgentBufferText(s)`,
  `pasteChatPaneID(s)` → `pasteAgentPaneID(s)`, `setChatBufferHook` →
  `setAgentBufferHook`, renamed seam methods); `api/chat_fixture_test.go`
  renamed to `api/agent_send_fixture_test.go` (`testChatRef` →
  `testTranscriptRef`, `fastChatSendProbe` → `fastAgentSendProbe`,
  `stageFixtureTranscript` kept); `internal/inject/inject_test.go`
  `NewEngine("rk-chat-send")` literals (L280, 329, 437, 457, 486, 526) →
  `"rk-agent-send"`.
- Comment-only "chat-send" references: `cmd/rk/mux_send.go:19, 133`,
  `internal/riff/deliver.go:76`, `internal/tmux/layout.go:474`,
  `internal/sessions/sessions.go:486`, `internal/sessions/sessions_test.go:442`,
  `api/operator.go:768, 826, 885, 994`, `api/operator_test.go:338`.

- **GIVEN** the buffer name is transient tmux runtime state (nothing persists
  it; the CLI uses per-invocation `rk-send-<pid>` names)
- **WHEN** the cluster is renamed including the buffer value
- **THEN** send/operator/inject tests pass unmodified in behavior
- **AND** no `ChatSend`/`chatSend`/`rk-chat-send` identifier remains in
  `app/backend/` outside the KEPT scope (R4)

### Frontend: broadcast Enter policy

#### R3: `ComposeSurface: "chat"` renames to `"broadcast"`
`app/frontend/src/lib/compose-keys.ts:45` SHALL define
`export type ComposeSurface = "strip" | "broadcast"`. The `"chat"` argument at
`components/compose-strip.tsx:717` (`isSelectionTarget ? "chat" : "strip"`)
SHALL become `"broadcast"`. Doc comments follow (compose-keys.ts L16/L44;
compose-strip.tsx L68, L703, L1056). Tests follow: `lib/compose-keys.test.ts`
(SURFACES array L21, test names/assertions) and
`components/compose-strip.test.tsx` (the `"chat"`-surface assertion).

- **GIVEN** the `"chat"` value names only the selection-broadcast Enter policy
- **WHEN** the value renames to `"broadcast"`
- **THEN** `tsc --noEmit` and Vitest pass; plain Enter in selection-broadcast
  mode still classifies as `"default"` (local newline)

### Sweep: pure-rename invariant

#### R4: No behavior change; KEPT scope untouched
The change SHALL be a pure rename: no logic, control flow, wire contract, HTTP
surface, tmux option name, or test behavior changes. The KEPT scope MUST remain
untouched: `@rk_pane_chat` pane option, `ChatProvider`/`ChatSessionRef` fields,
`sessions.ResolveChatPane`/`rollupChat`, the agent-hook chat stamp,
`testdata/claude_session.jsonl` content, the chat-lens removal regression pins
(`router-url.test.ts`, `surface-layout.test.ts`,
`use-shell-notifications.test.tsx`, `window-heading.spec.ts`), and the false
positives (`chatter`/`outputSink.chatter`, `chat.disableAIFeatures`, `"chatty"`
fixture).

- **GIVEN** the full verification suite (`go test ./...`, `tsc --noEmit`,
  `just test`, `just build`) is green on main
- **WHEN** the rename lands
- **THEN** the same suite is green with no test modified beyond identifier
  renames — the e2e `?view=chat` heal pins pass unmodified

### Non-Goals

- Memory/spec doc updates (`chat.md` rename to `agent-send.md`, `api.md` `/paste`
  block, DD headings) — hydrate-stage work, not apply tasks.
- Anything in the KEPT scope above; the legacy `@rk_chat` migration window.

### Design Decisions

#### Package-level `transcript.Path`, interface method unchanged
**Decision**: `chat.TranscriptPath(provider, ref)` → `transcript.Path(provider, ref)`; `TranscriptLocator.TranscriptPath(ref)` keeps its method name.
**Why**: `transcript.TranscriptPath` stutters (Go naming idiom); the interface method reads fine unqualified and keeping it minimizes churn.
**Rejected**: keeping `TranscriptPath` at package level (stutter); renaming the interface method to `Path` (`loc.Path(ref)` loses the "transcript path" reading at call sites and churns the adapter for no clarity gain).
*Introduced by*: 260904-owue-chat-lens-residual-renames

#### Cluster name "agent-send", buffer `rk-agent-send`
**Decision**: the injection cluster renames to agent-send (`AgentSendBuffer = "rk-agent-send"`, `agentSendEngine`, seam `SetAgentSendBuffer`, …).
**Why**: matches the endpoint's `target:"agent"` vocabulary and the agent-messaging DD that "chat" doesn't describe the mechanics; the buffer value is transient runtime state so the rename is contract-free.
**Rejected**: `compose-send` (the operator routes consume the same cluster — it is not compose-specific); keeping the `rk-chat-send` value while renaming identifiers (leaves the greppable residue the sweep exists to remove).
*Introduced by*: 260904-owue-chat-lens-residual-renames

#### Surface value `"broadcast"`
**Decision**: `ComposeSurface = "strip" | "broadcast"`.
**Why**: the value's one consumer is the selection-broadcast mode; the name states the policy's actual scope instead of a removed UI.
**Rejected**: `"selection"` (names the trigger, not the surface policy); keeping `"chat"` (the sweep's whole point).
*Introduced by*: 260904-owue-chat-lens-residual-renames

## Tasks

### Phase 2: Core Implementation

- [x] T001 [P] Rename `app/backend/internal/chat/` → `app/backend/internal/transcript/` (package clause, `TranscriptPath` → `Path`, sentinel message prefixes, testdata moves); update `api/operator.go` (import, usages, `writeChatReadError` → `writeTranscriptError` + comments at 690/796/901); update `uuidRe` comments in `internal/riff/shell.go:42–45` and `api/fork.go:36` <!-- R1 -->
- [x] T002 [P] Rename the agent-send cluster atomically: `internal/tmux/tmux.go:2696–2758` buffer const + 3 funcs; `api/send.go` engine/adapter/budget; `api/router.go` seam + prod impl; `api/operator.go` budget usages; test doubles (`api/sessions_test.go` mock, `api/chat_fixture_test.go` → `api/agent_send_fixture_test.go` with `testTranscriptRef`/`fastAgentSendProbe`, `internal/inject/inject_test.go` buffer literals); comment sweep (`cmd/rk/mux_send.go`, `internal/riff/deliver.go`, `internal/tmux/layout.go:474`, `internal/sessions/sessions.go:486`, `internal/sessions/sessions_test.go:442`, `api/operator_test.go:338`) <!-- R2 -->
- [x] T003 [P] Frontend rename `"chat"` → `"broadcast"`: `app/frontend/src/lib/compose-keys.ts` (type + comments), `components/compose-strip.tsx:717` (+ comments 68/703/1056), `lib/compose-keys.test.ts`, `components/compose-strip.test.tsx` <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T004 Residual sweep + verification gates: grep `app/backend app/frontend/src` for `ChatSend|chatSend|rk-chat-send|internal/chat|writeChatReadError|ComposeSurface.*"chat"` — zero hits outside KEPT/false-positive scope; then `cd app/backend && go test ./...`, `cd app/frontend && npx tsc --noEmit`, `just test`, `just build` <!-- R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `internal/transcript` exists (no `internal/chat`); `transcript.Path` is the package-level resolver; `api/operator.go` compiles against it with `writeTranscriptError`; riff/fork comments cite the new path
- [x] A-002 R2: every chat-send identifier (const, funcs, seam methods, engine/adapter/budget, mock fields, fixture-test helpers, buffer literals) carries its agent-send name; `api/agent_send_fixture_test.go` replaces `api/chat_fixture_test.go`
- [x] A-003 R3: `ComposeSurface = "strip" | "broadcast"`; compose-strip passes `"broadcast"` in selection mode; both frontend test files renamed accordingly

### Behavioral Correctness

- [x] A-004 R4: the diff contains identifier/comment/doc-string renames only — no logic, signature-shape, wire, or test-behavior change; sentinel `errors.Is` mappings intact

### Removal Verification

- [x] A-005 R4: grep sweep finds zero retired names (`rk-chat-send`, `ChatSend*`, `chatSend*`, `writeChatReadError`, `internal/chat`, surface `"chat"`) in `app/backend/` + `app/frontend/src/` outside the KEPT/false-positive list

### Scenario Coverage

- [x] A-006 R4: `go test ./...`, `tsc --noEmit`, `just test`, `just build` all green; e2e `?view=chat` heal pins pass unmodified

### Edge Cases & Error Handling

- [x] A-007 R1: operator transcript-read error paths still map `ErrInvalidRef`/`ErrTranscriptNotFound`/`ErrNoAdapter` to their HTTP classes (identity-based `errors.Is`, message-prefix change irrelevant)
- [x] A-008 R4: KEPT scope untouched — `@rk_pane_chat`, `ChatProvider`/`ChatSessionRef`, `ResolveChatPane`/`rollupChat`, testdata fixture content, regression pins, `chatter`/`chat.disableAIFeatures`/`"chatty"`

### Code Quality

- [x] A-009 Pattern consistency: renamed identifiers follow surrounding naming conventions (Go exported/unexported, `*Ctx` suffixes, TS literal unions)
- [x] A-010 No comment narration: updated comments state constraints, none narrate the rename or cite this change ID
- [x] A-011 No duplication: no shim/alias left behind (old names deleted, not forwarded)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change IS the removal sweep: the retired identifiers are deleted in place (no shims or aliases), and nothing outside the renamed clusters became redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Tasks grouped per rename cluster (A2.1/A2.2/A2.3 + one gate task) rather than per file — each Go cluster must land atomically to compile | Splitting a cluster across tasks creates non-compiling intermediate states; the plan document's own structure is the cluster | S:70 R:90 A:85 D:75 |
| 2 | Certain | Mock field spellings: `agentSendCalls`, `setAgentBufferText(s)`, `pasteAgentPaneID(s)`, `setAgentBufferHook` — mirror the production names minus the `Send` where the field already omitted it | Mechanical mirror of intake assumption 6; test-internal | S:70 R:95 A:90 D:80 |
| 3 | Certain | Grep-sweep KEPT allowlist for A-005: `@rk_pane_chat`, `ChatProvider`, `ChatSessionRef`, `ResolveChatPane`, `rollupChat`, `chatter`, `chat.disableAIFeatures`, `"chatty"`, `@rk_chat` legacy migration code, chat-lens removal regression pins | Verbatim from the plan's KEPT/false-positive inventory | S:85 R:90 A:90 D:90 |

3 assumptions (2 certain, 1 confident, 0 tentative).
