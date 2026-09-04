# Intake: Agent-Session Identity Rename

**Change**: 260904-bf1l-agent-session-identity-rename
**Created**: 2026-09-04

## Origin

> Rename the agent-session identity vocabulary off "chat": @rk_pane_chat → @rk_pane_agent_session (new migration generation), with the Go/TS identifier and wire-field ripple (ChatOption/LegacyChatOption, parseChatRef, ChatProvider/ChatSessionRef + chatProvider/chatSessionRef JSON, ResolveChatPane/rollupChat, writeChat/"chat stamp", requiresChatRef, closed-ring chatProvider/chatRef with on-disk read-compat, frontend fields + FORKABLE_CHAT_PROVIDER), folding in the @rk_chat legacy close-out for the chat key (no fab-kit gate — verified zero fab-kit references; fab-kit couples only to @rk_agent_state) and the fork.go stale comment stragglers. Registry + agent-state spec/memory updates ride the change.

Conversational origin: this is the deliberate follow-up to the Chat Lens residual sweep
(`fab/plans/sahil/26-09-04-chat-lens-residual-sweep.md`, changes A1 #823 / B #820 / A2 #825,
all merged 2026-09-04). The sweep renamed every other chat-named cluster
(`internal/chat` → `internal/transcript`, chat-send → agent-send, `ComposeSurface`
`"chat"` → `"broadcast"`) and explicitly parked this one. The user then decided:
`@rk_pane_agent_session` is the better name — "rk_chat and rk_pane_chat are both very
confusing now that the chat lens is gone" — and directed that the remaining work be
queued as this intake. A post-sweep survey at `fd16e6b4` confirmed the identity cluster
is the **only** remaining chat-named vocabulary in the repo.

## Why

1. **The pain point**: `@rk_pane_chat` (and its retired unscoped ancestor `@rk_chat`,
   still dual-read/dual-written) name the pane → agent-conversation identity. With the
   Chat Lens removed (PR #817) and every other "chat" cluster renamed by the sweep,
   "chat" no longer corresponds to any feature — a reader meeting `ChatSessionRef`,
   `ResolveChatPane`, or `requiresChatRef` today reasonably concludes it is dead code
   from the removed lens, when it is in fact the live keystone of fork, closed-resume,
   operator transcript reads, auto-name, and `target:"agent"` sends. Two coexisting
   legacy generations (`@rk_chat` + `@rk_pane_chat`) compound the confusion.
2. **If we don't fix it**: the misleading vocabulary persists indefinitely at the
   center of the agent-identity data flow, and the `@rk_chat` dual-write/dual-read
   machinery (meant as a one-release window per the 26-08-28 scope-naming plan) never
   gets closed out for this key.
3. **Why this approach**: the repo already has proven rename machinery — the
   `MigrateLegacyOptions` copy-forward sweep, hook dual-write, dual-read parsing with
   new-field-wins — built by change 260828-5jlp for exactly this key. This change adds
   one more generation (`@rk_pane_chat` → `@rk_pane_agent_session`) through the same
   machinery and simultaneously retires the `@rk_chat` generation for this key, so the
   ladder ends at two live names (new + one-release fallback), not three.

## What Changes

The option **value schema is untouched**: `<provider>:<session-ref>`
(e.g. `claude:5d80479e-8f25-46cd-a0d4-e51435508a37`). Only the key name and the code
vocabulary around it change. **No behavior change anywhere** — this is a pure rename
plus the legacy-generation close-out.

### 1. The tmux option: new generation `@rk_pane_agent_session`

In `app/backend/internal/tmux/tmux.go`:

- `ChatOption = "@rk_pane_chat"` → `AgentSessionOption = "@rk_pane_agent_session"`;
  the current `ChatOption` value becomes the legacy constant (e.g.
  `LegacyAgentSessionOption = "@rk_pane_chat"`), replacing today's
  `LegacyChatOption = "@rk_chat"` in the read fallback role.
- The pane format list (currently carrying both `#{@rk_chat}` and `#{@rk_pane_chat}`)
  carries `#{@rk_pane_agent_session}` and `#{@rk_pane_chat}`; the `@rk_chat` field is
  **dropped** (see § 3). New field wins; `@rk_pane_chat` is the fallback.
- `parseChatRef` / `isChatProvider` / `isChatRef` → `parseAgentSessionRef` /
  `isAgentProvider` / `isAgentSessionRef` (same validation logic, verbatim).
- The liveness reconciliation is unchanged: the option borrows the same pane's
  agent-state pid liveness, a dead agent zeros both fields, a plain-shell pane never
  surfaces the identity.

### 2. Migration sweep (`app/backend/internal/tmux/legacy_options.go`)

- **Add** row: `{Old: "@rk_pane_chat", New: "@rk_pane_agent_session", Scope: pane, CopyOnly: true}`.
- **Keep** the existing `@rk_chat` → `@rk_pane_chat` CopyOnly row for one more release,
  ordered **before** the new row, so a pane still carrying only `@rk_chat` chains
  forward transitively (`@rk_chat` → `@rk_pane_chat` → `@rk_pane_agent_session`) in a
  single sweep pass. Verify the sweep applies rows in table order (it iterates the
  slice; confirm at implementation and pin with a chained-copy test).

### 3. Writer: the agent hook (`app/backend/cmd/rk/agent_hook.go`)

- `writeChat` / `writeChatImpl` / `writeChatFn` / `chatOption` →
  `writeAgentSession` / `writeAgentSessionImpl` / etc.
- The dual-write pair **rotates one generation**: today it writes
  (`@rk_pane_chat`, `@rk_chat`); after this change it writes
  (`@rk_pane_agent_session`, `@rk_pane_chat`). `@rk_chat` is no longer written.
  This is the `@rk_chat` close-out for this key: safe because the writer is always the
  same `rk` binary the hooks invoke (gen-3 hook text names no option — it calls
  `rk agent hook`), so writer and reader upgrade atomically per host.
- **No fab-kit coordination required** (verified 2026-09-04): fab-kit contains zero
  references to `@rk_chat`/`@rk_pane_chat`; its only `@rk_*` coupling is
  `@rk_agent_state` (`src/go/fab/cmd/fab/panemap.go`). The 26-08-28 plan's Change-4
  gate binds the **agent-state** key only. `@rk_pane_agent_state` and `@rk_agent_state`
  are untouched by this change.

### 4. Go identifier + wire-field ripple

- `tmux.PaneInfo` / `tmux.WindowInfo`: `ChatProvider`/`ChatSessionRef` →
  `AgentProvider`/`AgentSessionRef` (exact spelling is an apply-stage decision; see
  Assumptions #4), with JSON tags renamed in lockstep (`chatProvider`/`chatSessionRef`
  → `agentProvider`/`agentSessionRef`).
  <!-- assumed: identifier spellings AgentProvider/AgentSessionRef and wire agentProvider/agentSessionRef — several defensible variants; apply decides-and-records --> No dual-key emission: the SPA and desktop
  shell are served by the same daemon binary that produces the payload, so frontend
  and backend rename atomically.
- `internal/sessions`: `ResolveChatPane` → `ResolveAgentPane`, `rollupChat` →
  `rollupAgentSession` (active-pane-first rule unchanged).
- `api/`: `requiresChatRef` → `requiresAgentSessionRef` (operator template registry),
  plus every consumer-side field access in `fork.go`, `closed.go`, `operator.go`,
  `auto_name.go`, `send.go`, `waiting_push.go`, and their tests (mock fields, fixture
  helpers like `paneLineChat`, `captureChat`, `testChatRef` in the agent-send fixture
  file follow the rename).

### 5. Frontend ripple (`app/frontend/`)

- `src/types.ts` + `src/api/client.ts`: `chatProvider`/`chatSessionRef` (window) and
  `chatProvider`/`chatRef` (closed-window record) follow the new wire names; the
  doc comments re-anchor on "agent session identity".
- `FORKABLE_CHAT_PROVIDER` (`sidebar/row-flyout-card.tsx`) →
  `FORKABLE_AGENT_PROVIDER`; gate logic unchanged.
- e2e fixtures and state-socket mocks that seed `chatProvider`/`chatSessionRef`
  (`row-flyout.spec.ts`, `operator-digest.spec.ts`, unit-test window factories).

### 6. Closed-window ring: on-disk read-compat

`internal/snapshot/closed.go` records persist `chatProvider`/`chatRef` JSON keys in
`$XDG_STATE_HOME/run-kit/snapshots/{server}.closed/`. Existing records must not lose
their resume affordance on upgrade: read both key generations (coalesce old → new on
load; Go stdlib JSON has no alias, so either a second struct field pair with a
post-unmarshal coalesce, or a custom `UnmarshalJSON`), write only the new keys.
Fallback posture if implementation friction is high: Constitution II classifies the
ring as a non-authoritative recovery artifact (absent/corrupt degrades to cold start),
so dropping read-compat is *permissible* — but the coalesce is cheap and preferred.
See Assumptions #5.
<!-- assumed: closed-ring dual-read with coalesce over dropping read-compat — either is constitution-compliant; coalesce preserves resume affordances -->

### 7. User-facing strings and labels

- API error vocabulary: `"no chat session for this window"` /
  `"no chat session for this window — nothing to fork"` /
  `"malformed chat session ref for this window"` /
  `"operator window has no chat session"` → "agent session" phrasing (exact strings
  are asserted in Go tests and quoted in memory GWT scenarios — update both).
- `rk agent setup` diff label `"chat stamp + idle (boot-ready)"` →
  `"session stamp + idle (boot-ready)"` (pinned in `agent_setup_test.go`).
- **No hook-text bump**: gen-3 hook text names no option, so no shim/hook generation
  change and no doctor migration row.

### 8. Comment stragglers (fold-in from the sweep)

`api/fork.go` comments still use the retired `@rk_chat` spelling and reference "the
chat endpoints' … posture" (the endpoints removed by #817) — these lines are inside
this change's rename blast radius; rewrite them against `@rk_pane_agent_session` and
the transcript-error vocabulary. Sweep the repo for any remaining `@rk_chat` /
`@rk_pane_chat` prose in comments after the mechanical rename
(`grep -rn 'rk_chat\|rk_pane_chat'` over `app/` must return only the legacy constant,
the migration row, and their tests).

### 9. Docs: registry, specs, memory

- `docs/memory/run-kit/tmux-sessions.md` § the `@rk_<scope>_<name>` registry: the
  chat row becomes `@rk_pane_agent_session`; the migration-sweep table gains the new
  row and keeps the chained `@rk_chat` row with its close-out state noted.
- `docs/specs/agent-state.md` § Chat Session Identity → § Agent Session Identity
  (key name, writer/reader rules, the reader-fallback window).
- `docs/specs/api.md` (`target:"agent"` row cites the `@rk_pane_chat` rollup) and
  `docs/specs/ui-state.md` (§ substrate facts, `@rk_pane_chat` listing).
- Memory files carrying the vocabulary: see Affected Memory.

## Affected Memory

- `run-kit/agent-state`: (modify) the option convention sections — key name, writer
  rules, dual-read window, the `@rk_chat` close-out for this key
- `run-kit/tmux-sessions`: (modify) `@rk_*` registry row + migration sweep table
- `run-kit/agent-send`: (modify) `ResolveChatPane` / `@rk_pane_chat` references in the
  send-path and `target:"agent"` sections
- `run-kit/operator-actuation`: (modify) `requiresChatRef` vocabulary, error-string
  GWT scenarios, `ResolveChatPane` references
- `run-kit/architecture`: (modify) `writeChatImpl` / identifier mentions
- `run-kit/api-and-sockets`: (modify) chat-identity wire-field mentions (also fixes
  the pre-existing retired `@rk_chat` spelling there)
- `run-kit/layout-snapshots`: (modify) `ChatProvider`/`ChatRef` in the ClosedWindow
  record + the new read-compat rule
- `run-kit/ui/status-signals`: (modify) `chatProvider === "claude"` fork-gate mentions
- `run-kit/ui/sidebar`: (modify) same gate vocabulary
- `run-kit/ui/keyboard-and-palette`: (modify) `chatSessionRef` gate mentions

## Impact

- **Backend**: `internal/tmux` (tmux.go, legacy_options.go + tests, test fixture
  builders `paneLineChat`/`paneLineFull`), `internal/sessions`, `internal/snapshot`
  (closed.go + tests), `api/` (fork, closed, operator, auto_name, send, waiting_push,
  router seam names untouched — those were renamed by A2 — plus the mock TmuxOps
  fields and the agent-send fixture file), `cmd/rk/agent_hook.go` + `agent_setup.go`
  + tests.
- **Frontend**: `types.ts`, `api/client.ts`, `app.tsx`, sidebar components, e2e
  fixtures/mocks.
- **Scale**: ~30–45 files, overwhelmingly mechanical; the only *logic* additions are
  the new migration row, the closed-ring read-coalesce, and the chained-copy test.
- **Compatibility**: tmux options migrate via the sweep (chained copy); wire fields
  rename atomically (same-binary SPA); closed-ring records dual-read for one release;
  `@rk_chat` stops being written and read — acceptable because writer/reader share one
  binary per host, and the sweep has already copied old values forward on any server
  the daemon has touched since 260828-5jlp shipped.
- **Out of scope**: `@rk_pane_agent_state` / `@rk_agent_state` (fab-kit-coupled; the
  26-08-28 ladder's Change 4 owns that), the `transcript` package, agent-send naming,
  any behavior change.

## Open Questions

- None — direction and target name are user-decided; remaining choices are graded
  assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New option name is `@rk_pane_agent_session` | User decided explicitly in the originating discussion | S:95 R:70 A:95 D:95 |
| 2 | Certain | Rename rides the existing migration machinery: new CopyOnly sweep row + hook dual-write rotated one generation + dual-read with new-field-wins | Established pattern (260828-5jlp, `legacy_options.go`, context.md registry rules) applies verbatim | S:85 R:80 A:95 D:90 |
| 3 | Confident | `@rk_chat` close-out folds in: stop writing it, drop its read field; keep its CopyOnly sweep row (ordered before the new row) so stale values chain forward | Verified fab-kit has zero chat-key references; writer=reader=one binary per host; sweep already copied values forward. Chain-order behavior must be pinned by a test | S:80 R:60 A:85 D:80 |
| 4 | Tentative | Go/TS/JSON spellings: `AgentProvider`/`AgentSessionRef`, wire `agentProvider`/`agentSessionRef`; resolver `ResolveAgentPane`; template flag `requiresAgentSessionRef` | Multiple defensible spellings (`AgentSessionProvider`, `sessionProvider`, …); apply decides-and-records, trivially reversible pre-merge | S:60 R:75 A:55 D:40 |
| 5 | Tentative | Closed-ring records: dual-read old `chatProvider`/`chatRef` keys with coalesce, write new keys only | Constitution II would also permit dropping read-compat (ring is non-authoritative), but the coalesce is cheap and preserves resume affordances across the upgrade | S:55 R:70 A:70 D:45 |
| 6 | Confident | Wire fields rename atomically with no dual-key emission | SPA and desktop shell are served by the daemon binary that emits the payload; e2e fixtures updated in the same change | S:70 R:65 A:85 D:80 |
| 7 | Confident | User-facing error strings and the `rk agent setup` diff label move to "agent session" phrasing in the same change | They are part of the same vocabulary; tests and memory GWTs quoting them are updated together | S:70 R:80 A:85 D:75 |

7 assumptions (2 certain, 3 confident, 2 tentative, 0 unresolved).
