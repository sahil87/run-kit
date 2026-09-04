# Plan: Chat Lens residual sweep — three changes

**Authored**: 2026-09-04
**Author**: discussion session with Claude (post-removal sweep)
**Executor**: the operator, dispatching agents per change via the normal fab pipeline
(`/fab-new` → `/fab-fff`), each change in its own worktree.
**Status**: Changes A1, A2, B open for pickup. **A1 ∥ B in parallel; A2 only after A1
merges** (same files). Prefer merging B before A2 starts so A2's hydrate does not
collide with B's memory edits.

## Context

Change `260904-39bp-remove-chat-lens` (PR #817, commit `a8c24104`) removed the Chat Lens:
the `?view=chat` frontend (chat-view, use-chat-subscription, chat-stream, ChatSendForm,
the `chat` surface kind, `Chat:` heading prefix, `chat-toggle` keybinding), the backend
`GET /api/windows/{id}/chat` backfill + state-socket `kind:"chat"` subscription
(api/chat.go, api/chat_ws.go), and merged the chat-send handler into
`POST /api/windows/{id}/send` (with `target:"agent"`).

A full-repo sweep (source + docs, conducted 2026-09-04 at `a8c24104`) found the residuals
inventoried below. **All line numbers are as of `a8c24104`** — re-verify before editing.

### Deliberately KEPT — do not "clean up"

- `@rk_pane_chat` pane option + `ChatProvider`/`ChatSessionRef` fields (Go, JSON wire,
  snapshot closed-ring), `sessions.ResolveChatPane`/`rollupChat`, the agent-hook chat
  stamp. Here "chat" = *the agent's conversation session*, still accurate. The option is
  a cross-repo contract with fab-kit (`docs/specs/agent-state.md`) and mid-migration from
  legacy `@rk_chat` (dual-read/dual-write live). **Out of scope for all three changes.**
  Revisit only when the `@rk_chat` legacy window closes.
- `internal/chat/testdata/claude_session.jsonl` — still read by `api/chat_fixture_test.go`
  for operator/send/auto-name tests.
- Regression pins asserting the removal: `router-url.test.ts:48` (`?view=chat` heal),
  `surface-layout.test.ts` chat-layout heal tests, `use-shell-notifications.test.tsx:66`
  (stale deep link), `window-heading.spec.ts` retired-prefix assertions.

### False positives — not chat residuals

- `chatter` / `outputSink.chatter` everywhere — the Principle 9 stderr channel.
- `chat.disableAIFeatures` in `internal/daemon/codeserver.go` — a code-server settings key.
- `"chatty"` fixture name in `waiting_push_test.go`.

---

## Change A1 — trim: dead code, the layoutspec divergence, stale comments

**One question for review**: *is everything deleted actually consumer-free, and does every
stored-layout path still heal?* Delete-only plus comment edits; no renames.

### A1.1 — `internal/layoutspec` still accepts the removed `chat` surface

`layoutspec.go:42` has `"chat": true` while the frontend `ViewName` is
`"tty" | "web" | "code"` (`window-view.ts:24`) — so `rk tab layout set/--add` can write a
layout the frontend parse-rejects and heals to `single:tty`. Remove `chat` from
`surfaceKinds`. Safe: every Go caller heals a parse failure to `Default()`
(`tab_web.go:213`, `tab_layout.go:120`). Update:

- `layoutspec_test.go` — chat appears in *valid* fixtures (L15, L18, L96, L125, L175, L268)
- `cmd/rk/tab_test.go:262/291` — `--add chat`/`--promote chat` currently fail for
  full/absent reasons; after removal they fail as unknown-surface (different message)
- `cmd/rk/tab_test.go:384` — uses `main-left:tty,code,chat` as a *valid* stored layout;
  needs a new third surface or a heal expectation
- `internal/tabaddr/tabaddr.go:24` — surface-list comment includes `"chat"`

### A1.2 — `internal/chat` dead code (~700 of ~850 lines)

Outside its own tests, the package is consumed **only** for `chat.TranscriptPath` and the
error sentinels `ErrInvalidRef` / `ErrTranscriptNotFound` / `ErrNoAdapter` (consumers:
operator actuation, fork, closed-resume, auto-name). Zero production references to:
`Adapter.Backfill` / `Adapter.TailFrom`, `Conversation`, `Update`, `Event`, `Pending`,
`Role`, and the whole JSONL parser (`parser`, `consume`, `parseLine`, `decodeContent`,
`appendBlockEvent`, `pending`, `closeToolUse`, `tailFromLoop`, `primeTo`,
`readFromOffset`, `deriveQuestion`, `flattenToolResult`, …). Delete: all of `schema.go`;
shrink `adapter.go` to the provider registry + `TranscriptLocator`; shrink `claude.go` to
the UUID guard + transcript glob + `TranscriptPath`. Delete the dead halves of
`claude_test.go` / `schema_test.go`. Keep `testdata/claude_session.jsonl` (see KEPT).

### A1.3 — dead frontend dependencies

`react-markdown` and `remark-gfm` in `app/frontend/package.json` — zero imports anywhere
in `src/` (ChatView renderer only). `pnpm remove` both.

### A1.4 — stale comments pointing at deleted code

| Location | Stale reference |
|---|---|
| `internal/inject/inject.go:2` (also ~L24, L176) | "chat-send HTTP handler (api/chat.go)" — now `api/send.go` |
| `api/fork.go:28` | "the chat endpoints (api/chat.go), whose contract this mirrors" |
| `internal/chat/adapter.go:11–45` | doc header describes the removed backfill endpoint + `kind:"chat"` subscription (largely deleted by A1.2 anyway) |
| `internal/chat/claude.go:105` | "state-socket chat subscription can compose GET(offset)→TailFrom" |
| `compose-strip.tsx:166, 664` | "mirrors ChatSendForm" / "the SAME helper ChatSendForm uses" |
| `readline-keys.ts:3` | "shared with … the chat send form" — compose strip is now the sole consumer |
| `use-coarse-pointer.ts:5` | names "the chat send" as a consumer |
| `right-panel.ts:27` | "`tty` … and `chat` are surfaces like any other" |
| `app.tsx:1408, 2015, 2020` | "(web iframe or chat)" — mechanism real, example dead; say web/code |
| `tip.tsx:94` | "the compose/chat Enter" |
| `types.ts:181` | "the SOLE gate for every chat affordance" — affordances are now fork/operator actions |

### A1 hydrate scope (memory)

- `docs/memory/run-kit/chat.md` — remove the now-deleted normative sections: L35–54
  (event schema), L56–71 (turn counter), L73–91 (Pending), the `Backfill`/`TailFrom`
  halves of L93–133, L158–184 (parser), L186–212 (offset tail), and DDs L590–633 that
  describe them. The live remainder: Claude adapter UUID/traversal guard (L135–156),
  `TranscriptLocator` + registry, and the entire Send Path (L214–588, already accurate).
- `docs/memory/run-kit/architecture.md:144` — the `internal/chat` row recites the dead
  type surface as live and uses retired `@rk_chat`; rewrite as transcript-locator row.
- `docs/memory/run-kit/architecture.md:152` — layoutspec row: restore the "port of
  surface-layout.ts" claim to true (A1.1) and drop `chat` from the surface list.

---

## Change A2 — renames: transcript locator, agent-send cluster, broadcast policy

**Depends on A1** (same files). **One question for review**: *is this a pure rename —
no behavior change anywhere?*

### A2.1 — `internal/chat` → `internal/transcript`

After A1's trim the package is "resolve provider:ref → transcript JSONL path". Rename to
`internal/transcript` (`transcript.Path(provider, ref)` or keep `TranscriptPath` →
`transcript.Path`; errors follow). Ripple: import sites in `api/` (operator, fork,
closed, auto_name); `api/operator.go:812` `writeChatReadError` → `writeTranscriptError`;
the deliberate-duplicate `uuidRe` comments in `internal/riff/shell.go:42` and
`api/fork.go:36` that cite `internal/chat`.

### A2.2 — chat-send → agent-send

The injection binding is chat-named end to end; its consumers are compose `/send`,
operator requests, auto-name. Rename the cluster to **agent-send** (matches the
endpoint's `target:"agent"`):

- `internal/tmux/tmux.go:2696–2758` — `ChatSendBuffer = "rk-chat-send"` →
  `AgentSendBuffer = "rk-agent-send"`, plus `SetChatSendBufferCtx` /
  `PasteChatSendBufferCtx` / `PasteChatSendBufferRawCtx`. The buffer name is transient
  tmux runtime state — nothing persists it; the CLI already uses per-invocation names.
- `api/send.go` — `chatSendEngine`, `chatSendTmux`, `chatSendTotalBudget`
- `api/router.go:135–137, 539–546` — the TmuxOps seam methods
- test doubles: `api/sessions_test.go` mock fields (`chatCalls`, `setChatBufferText`,
  `pasteChatPaneID`, …), `api/chat_fixture_test.go` (file rename too, e.g.
  `agent_send_fixture_test.go`; `testChatRef` / `fastChatSendProbe` /
  `stageFixtureTranscript` follow), `inject_test.go` `NewEngine("rk-chat-send")` literals
- comment references: `cmd/rk/mux_send.go:126, 133`, `internal/riff/deliver.go:76`,
  `internal/tmux/layout.go:474`

### A2.3 — `ComposeSurface: "chat"` → `"broadcast"`

`compose-keys.ts:45` — the `"chat"` value now names only the selection-broadcast Enter
policy. Rename to `"broadcast"`: `compose-keys.ts`, `compose-strip.tsx:718` (+ comments
L68, L704, L1057), `compose-keys.test.ts`, `compose-strip.test.tsx:233`.

### A2 hydrate scope (memory + specs)

- `docs/memory/run-kit/chat.md` — retitle/reframe around the surviving halves
  (transcript locator + agent-send path). Consider whether the file itself renames
  (e.g. `agent-send.md`) — if so, tombstone per `_shared/removed-domains.md` convention
  and update inbound links (`agent-messaging.md:47/133`, `operator-actuation.md`).
  Recommendation: rename; "chat" as a domain name no longer earns its slot.
- `docs/specs/api.md:246–275` — the `POST /api/windows/:windowId/paste` block documents
  a route that does not exist and contrasts `/chat/send` twice; replace with the real
  `POST /send` contract (`mode`/`target` body, new buffer name at L265).
- `docs/memory/run-kit/agent-messaging.md:576` — the DD already argues "chat" doesn't
  describe the mechanics; add the forward pointer to the completed rename.
- DD headings that name the retired surface: `ui/compose-and-bottom-bar.md:215`
  ("composes in chat" → broadcast), `ui/sidebar.md:670` ("the CHAT half of the Enter
  classifier").
- `docs/memory/run-kit/operator-actuation.md` — `writeChatReadError` /
  `chatSendTotalBudget` references follow the renames.

---

## Change B — docs: lens-taxonomy sweep (parallel with A1)

Docs-only; touches **no file A1/A2 touches in code**, and no memory file A1's hydrate
rewrites. **One question for review**: *does any doc still present the chat lens, chat
surface, or chat endpoints as present/planned?*

### B.1 — `docs/specs/window-views.md` (the worst file) + `docs/specs/index.md:38`

The chat lens is one of the three founding features the spec unifies. Add a removal note
up top; then: purpose statement (L7–8), problem table row (L34), view-registry `chat`
row presented as committed `[target]` (L65), R4 examples/rows (L119, L127, L139), R6
connection-dot "chat → chat stream" (L150), Two Species lead example (L164), boards-pin
aside (L185), migration-map row claiming chat "change 1 in progress" (L196). Keep L133
(explicitly historical). Fix the `specs/index.md:38` one-liner (advertises chat twice).

### B.2 — one-paragraph fixes

- `docs/specs/agent-state.md:299–303` — the section's thesis justifies `@rk_pane_chat`
  by the removed chat-view stack; swap the justification to the live consumers
  (operator actuation, fork/resume, closed-resume, auto-name, agent-targeted send).
  The option itself is untouched (cross-repo contract).
- `docs/specs/agent-state.md:392` + memory `agent-state.md:618` and `:1028` — the same
  "the (later) chat-read endpoint surfaces a missing transcript" clause, three times.

### B.3 — one-liners

| File:line | Fix |
|---|---|
| `docs/specs/ui-state.md:69` | drop `chat` from the surface-kind enumeration |
| `docs/specs/surface-layout.md:164` | drop "(… chat gets no button)" parenthetical |
| `docs/memory/run-kit/operator-actuation.md:48, 63` | "registered … beside the chat routes" — no chat routes remain |
| `docs/memory/run-kit/operator-actuation.md:204` | "mirroring the chat endpoints" (plural) |
| `docs/memory/run-kit/ui/boards.md:247` | drop the `View: Chat` palette row + the `chatProvider` gate claim (`availableViews` gates on `hasCode` only, `window-view.ts:100`) |
| `docs/memory/run-kit/ui/compose-and-bottom-bar.md:60` | "shared with the chat send form" — compose strip is sole consumer of readline-keys |
| `docs/memory/run-kit/ui/visual-design.md:466` | "the chat form's autofocus skip" — consumer gone |
| `docs/memory/run-kit/ui/visual-design.md:527` | "chat warning body" example dead; waiting badge survives |
| `docs/memory/run-kit/api-and-sockets.md:27` | optional: retired `@rk_chat` → `@rk_pane_chat` (pre-existing drift) |
| `docs/memory/run-kit/ui/lenses-and-layout.md:91` | optional clause: `?view=chat` is a *dropped* legacy value, not translated |

Verified clean, nothing needed: `agent-messaging.md` (until A2), `tmux-sessions.md`,
`desktop-shell.md`, `layout-snapshots.md`, `keyboard-and-palette.md`,
`status-signals.md`, `code-bridge.md`, `findings/socket-pool-accounting.md` (dated
spike; conclusions hold), README, docs/site, docs/ao, docs/wiki,
`_shared/removed-domains.md` (exemplary tombstone).

---

## Sequencing for the operator

```
A1 (code trim)  ──┐
                  ├──►  A2 (renames; after A1 merges, ideally after B too)
B  (docs sweep) ──┘
```

- **A1 and B start now, in parallel** (disjoint files).
- **A2 starts only after A1 is merged**; rebase over B if B merged meanwhile (B touches
  `operator-actuation.md` / `agent-state.md` lines A2's hydrate may also brush).
- Each change: own worktree, `/fab-new` → `/fab-fff`, normal review/hydrate/ship gates.
- Verification gates per `fab/project/code-quality.md` (Go tests, tsc, `just test`,
  `just build`); A1/A2 must leave `just test` green — the e2e suite still pins the
  `?view=chat` heal behavior and must keep passing unmodified.
