# Intake: Operator Request Seam + Fix Tab Name

**Change**: 260822-fih1-operator-request-fix-tab-name
**Created**: 2026-08-22

## Origin

One-shot `/fab-new` invocation implementing Phase 2 of the backlog detail doc
`fab/plans/sahil/26-08-22-operator-session.md` (items 7–8), written 2026-08-22 after a design
discussion. Phase 1 (physical promotion, `_rk-operator` session) landed on main as
PR #708 (`287b3b3c`). Raw input:

> Implement Phase 2 (the actuation seam) of fab/plans/sahil/26-08-22-operator-session.md: a POST
> operator-request endpoint that pre-derives facts (windowId, window name, JSONL path,
> worktree, change/stage), renders a templated prompt, gates on @rk_agent_state (busy ->
> 409-style reject + toast), and delivers via the existing chat-send machinery to the
> server's operator pane -- no new state, no queue. Plus the first consumer: a 'Fix tab
> name' per-window action (window row menu + palette) that asks the operator to read the
> tab's recent JSONL turns and tmux rename-window it to something accurate; result
> arrives via the normal derive tick.

Key design decisions carried from the plan doc (see Assumptions for grading):

- **The actuation loop is delivery + derive, nothing else** — compose a templated
  prompt with pre-derived facts, deliver via the existing chat-send machinery
  (sanitize, named-buffer paste, novelty echo probe, probe-gated Enter). No response
  channel, no protocol, no reply parsing. Results come back through the ordinary
  derive loop.
- **Busy gate, no queue (v1)** — check `@rk_agent_state` before delivering; busy
  operator ⇒ reject with a toast. A queue is a state store (Constitution II fights it).
- **Transcript source is the chat JSONL, never capture-pane** — agent TUIs run
  alt-screen with zero scrollback; prompts hand the operator the JSONL path.
- **The inside/outside razor** — operator features degrade to *absent* when no
  operator runs, never to blocking. Nothing in the UI request path routes through the
  operator.

## Why

Phase 1 made the operator window a real, physically-promoted home (`_rk-operator`
session, pinned sidebar row). It is currently only a place a human visits. The point of
having an operator — an agent with judgment sitting next to every work tab — is that
run-kit can *hand it work*: tasks that require reading content and making a call, which
run-kit itself must never do (Constitution II/X: run-kit owns the derivable and
deterministic; the operator owns judgment over content).

Without an actuation seam, every Phase 3 control-room feature (auto-name on idle,
standup digest, what's-stuck triage, spawn routing, retire-a-tab) is blocked — each is
just a prompt template once the seam exists. Building the seam with exactly one real
consumer ("Fix tab name") proves the loop end-to-end while keeping the surface minimal:
one POST endpoint, one template, two UI entry points.

Why this approach over alternatives: a request queue or operator mailbox is persistent
state with retry semantics (Constitution II rejects it); a response channel/protocol
would turn the operator into an RPC service and require reply parsing — instead the
operator acts through its shell (`tmux rename-window`) and the result arrives through
the derive loop run-kit already runs. Naive `send-keys` Enter injection into agent TUIs
is known-flaky; the chat-send machinery (sanitize → named-buffer paste → novelty echo
probe → probe-gated Enter) already solved delivery and is reused verbatim.

## What Changes

### Backend — `POST /api/windows/{windowId}/operator-request` (new, `app/backend/api/operator.go`)

A single mutating endpoint (POST per Constitution IX), keyed by the **subject** window
(the window the request is *about*), mirroring the chat-send contract (client supplies
only a windowId + `?server=`; everything else is resolved server-side per request):

```
POST /api/windows/{windowId}/operator-request?server={server}
{"template": "fix-tab-name"}
```

Handler flow (all in one request, no state written anywhere):

1. **Validate**: `parseWindowID` (400 on malformed), decode body (400), template id
   checked against a closed in-code registry (unknown ⇒ 400 — same closed-set posture
   as the `/options` key allowlist, Constitution I). The body carries ONLY the template
   id; no client text ever reaches the rendered prompt.
2. **Resolve** via one `FetchSessions` pass on the server:
   - the subject window by `WindowID` (404 if absent);
   - the operator window — the window with `Role == "operator"` (the server-scoped
     radio Phase 1 enforces). No operator on the server ⇒ 404-class JSON error
     `"no operator on this server"` (the UI hides the action in this state — degrade
     to absent, and the error is the race backstop).
3. **Pre-derive facts** for the template (all server-side, per Constitution X —
   everything here is derivable):
   - subject `windowId` (`@N`) and current window name;
   - transcript JSONL path — from the subject window's reconciled
     `ChatProvider`/`ChatSessionRef` rollup, resolved to an absolute path via a new
     exported seam in `internal/chat` (today's `locateTranscript` in `claude.go` is
     unexported; expose it per-adapter, e.g. an optional `TranscriptPath(ref)`
     capability on the claude adapter reached through the existing registry `Lookup`).
     Subject has no reconciled chat session ⇒ 404-class error (this template cannot
     render without it);
   - worktree path (`WindowInfo.WorktreePath`);
   - fab change + stage (`WindowInfo.FabChange` / `FabStage`), included in the prompt
     only when non-empty.
4. **Busy gate**: read the operator window's rolled-up `AgentState` (already on the
   same `FetchSessions` result). `active` or `waiting` ⇒ `409` with a structured
   message naming the state (e.g. `"operator is busy (active) — request not delivered;
   try again when it is idle"`). `idle` or unknown/empty ⇒ proceed (the novelty echo
   probe remains the final fail-closed guard, exactly as for chat-send). No queue, no
   retry, no state.
5. **Render** the template — plain Go string composition in the registry entry
   (`func(facts) string`), no user input interpolated.
6. **Deliver** via the existing chat-send machinery, in-process (same `api` package —
   NOT an HTTP self-call): resolve the operator window's chat pane by the same
   active-pane-first rollup rule chat-send uses (share/reuse the `resolveWindowChat`
   pane-resolution helper in `api/chat.go`), then run the shared injection engine
   (`injectChatMessage`, i.e. sanitize → baseline capture → `set-buffer -b rk-chat-send
   --` → bracketed `paste-buffer` → novelty probe → probe-gated Enter, `submit:true`),
   under the engine's existing per-(server,paneID) lock and shared deadline. Probe
   failure surfaces as the same structured `409` chat-send returns (text pasted, Enter
   withheld, recoverable). Operator window has no reconciled chat pane ⇒ 404-class
   error (an operator that isn't a live agent can't receive requests).
7. **Respond** `200 {"ok":true}`. Nothing is awaited beyond delivery: the operator
   renames the window through its shell and the change surfaces on the normal derive
   tick. No SSE wake is needed (rk mutated nothing).

### Template registry — v1 ships exactly one template: `fix-tab-name`

An in-code map `templateID → {requiredFacts, render}`. The v1 prompt (exact wording is
a Tentative starting point — see Assumptions):
<!-- assumed: v1 prompt wording — the plan doc specifies facts + intent but not copy; operator-side behavior may need tuning after first live use -->

```
[run-kit request] Fix the tab name for tmux window @{windowId} (currently "{name}") on this server.

Read the recent conversation in the transcript to see what this tab is actually
working on: {jsonlPath}
(read the tail of the file — the last ~30 JSONL lines are enough)

Context: worktree {worktreePath}{, fab change {change} at stage {stage}}.

Then rename the window to a short, accurate name (2-4 words, kebab-case preferred):
  tmux rename-window -t @{windowId} "<new-name>"

Do not reply to this message or take any other action.
```

The prompt is self-contained (the operator needs no rk-specific knowledge), names the
exact actuation command with the `@N` target (windowId survives moves and is
collision-proof vs name targets), and explicitly bounds the operator's action.

### Frontend — API client (`app/frontend/src/api/client.ts`)

```ts
export async function sendOperatorRequest(
  server: string | null, windowId: string, template: string,
): Promise<void>
```

POST via the established `withServer` + `throwOnError` shape so the structured 409/404
messages surface as the thrown Error's message (same as `sendChatMessage`).

### Frontend — "Fix tab name" window-row action (`components/sidebar/row-flyout-card.tsx`)

A new row in the window flyout card's sectioned action list (the existing
change-color / fork / pin / kill list), following the `ForkActionRow` pattern: own
in-flight guard, `stopPropagation`, sub-hint text. Visibility is the derived
availability rule (degrade to absent):

- shown only when the server has an operator window (`windows.some(w => w.role ===
  "operator")`) AND the subject window has a reconciled chat session
  (`chatSessionRef` non-empty — the template needs the JSONL) AND the subject is not
  itself the operator window;
- on click: `sendOperatorRequest(...)` → success toast (`"Sent to operator — tab will
  rename shortly"`); error (409 busy, probe 409, 404 race) → error toast with the
  server's message. The result itself arrives via the normal SSE derive tick (the row
  re-renders when tmux reports the new name); no spinner beyond the in-flight guard.

### Frontend — palette action (`app.tsx`)

A per-window palette entry beside the existing `Tab: Rename` (app.tsx:2519), e.g.
`Tab: Fix name (ask operator)`, gated by the same availability rule as the flyout row
(omitted from the palette when unavailable — palette lists are already
availability-filtered). Selecting it fires the same `sendOperatorRequest` + toast path.
<!-- assumed: palette label "Tab: Fix name (ask operator)" — follows the "Tab:" namespace; exact copy is cosmetic -->

### Tests

- **Go** (`api/operator_test.go`, patterned on `chat_send_test.go` / `mockTmuxOps`):
  the full status matrix — 400 (bad id / body / unknown template), 404 (no subject
  window, no operator, subject without chat, operator without chat), 409 (operator
  `active`, operator `waiting`, probe failure ⇒ no Enter), 200 (delivery order:
  baseline → set-buffer → paste → probe → Enter targeting the OPERATOR's resolved
  pane, never the subject's); rendered prompt contains the derived facts (windowId,
  name, JSONL path, worktree, change/stage) and no client-supplied text.
- **`internal/chat`**: unit test for the exported transcript-path seam (valid UUID →
  glob path; invalid ref → `ErrInvalidRef` before any filesystem access — the existing
  guard must keep holding through the new export).
- **Frontend unit** (Vitest): flyout row + palette entry availability gating (hidden
  without operator / without chat ref / on the operator's own row), in-flight guard,
  success + error toast paths (mocked client).
- **e2e**: none for the live loop (needs a real agent TUI answering; not CI-viable).
  UI gating is covered by unit tests; if an e2e is added it asserts only
  hidden/visible states against the mocked API. Playwright specs, if any, ship with
  their `.spec.md` companion (constitution).

### Non-goals (guardrails from the plan doc)

- No request queue, no persisted mailbox, no retry semantics (Constitution II).
- No response channel or reply parsing — delivery + derive only.
- No operator dependency in any existing UI request path.
- No rate limiting in v1 (manual per-click action; the busy gate + per-pane injection
  lock bound the blast radius). Rate limiting arrives with Phase 3's auto-name-on-idle.
- No second template; the registry exists so Phase 3 items are additive rows.

## Affected Memory

- `run-kit/operator-actuation`: (new) the operator-request seam — endpoint contract,
  fact derivation, template registry, busy gate, delivery reuse, degrade-to-absent
  availability rule
- `run-kit/chat`: (modify) note the exported transcript-path seam on the claude
  adapter and the second in-process consumer of the injection path
- `run-kit/ui/sidebar`: (modify) the new flyout action row + availability gating
- `run-kit/ui/keyboard-and-palette`: (modify) the new palette entry
- `run-kit/architecture`: (modify) API-surface listing gains the operator-request
  endpoint

## Impact

- **Backend**: new `app/backend/api/operator.go` + `operator_test.go`; route in
  `api/router.go`; small refactor in `api/chat.go` to share the window→chat-pane
  resolution; one exported seam in `internal/chat/claude.go` (+ `adapter.go` if the
  capability-interface route is taken). `internal/sessions` / `internal/tmux`
  untouched (all needed facts already ride `WindowInfo`/`PaneInfo`).
- **Frontend**: `api/client.ts`, `components/sidebar/row-flyout-card.tsx` (+ its
  test), `app.tsx` palette wiring, toast usage (existing `useToast`).
- **Docs/specs**: `docs/specs/api.md` is human-curated; the endpoint should be added
  there by the human or flagged at hydrate.
- **Risk**: low blast radius — one additive endpoint, no changes to existing chat
  read/send contracts; the injection engine is reused behind its existing locks. The
  riskiest surface is the shared-helper refactor in `api/chat.go` (covered by the
  existing chat-send test matrix, which must stay green).

## Open Questions

- None — the plan doc resolves the architectural questions; remaining unknowns are
  graded Tentative below (prompt copy, palette label) and are cheap to revise.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delivery reuses the chat-send injection machinery in-process (sanitize → named-buffer paste → novelty probe → probe-gated Enter), no new injection path | Plan doc names it explicitly ("the existing chat-send machinery"); same `api` package makes in-process reuse the obvious form | S:95 R:80 A:95 D:90 |
| 2 | Certain | No queue, no persisted state, no response channel; busy ⇒ reject; result via derive tick | Verbatim plan-doc decisions ("Busy gate, no queue (v1)", "delivery + derive, nothing else"), backed by Constitution II | S:95 R:85 A:95 D:95 |
| 3 | Certain | Prompt hands the operator the JSONL path, not capture-pane content | Plan doc: alt-screen panes have zero scrollback; the path is derivable server-side from `@rk_chat` | S:90 R:85 A:95 D:90 |
| 4 | Confident | Endpoint shape: `POST /api/windows/{windowId}/operator-request?server=` keyed by the SUBJECT window, body `{"template": id}` only | Mirrors the established window-keyed, server-resolved chat-send contract; Constitution IX (POST); closed template set keeps client input out of the prompt (Constitution I) | S:70 R:70 A:85 D:75 |
| 5 | Confident | Busy = operator rollup `active` OR `waiting`; `idle`/unknown proceeds (probe stays the final guard) | Plan says "busy ⇒ reject" without defining busy; `waiting` means a human-blocking dialog is up — typing into it is exactly what the probe-flakiness lesson warns about; unknown must pass or a hookless operator could never receive requests | S:55 R:75 A:70 D:60 |
| 6 | Confident | No operator on server ⇒ 404-class error; UI hides the action entirely (flyout row + palette) via `role === "operator"` presence + subject `chatSessionRef` presence | The plan's inside/outside razor: operator features degrade to absent, never blocking; both gating facts already ride the sessions payload | S:75 R:80 A:85 D:80 |
| 7 | Confident | Transcript path exposed via a new exported seam on `internal/chat` (per-adapter capability reached through the registry), reusing `locateTranscript` + its UUID guard | `locateTranscript` is unexported today; the path-traversal guard must stay in front of any export; exact export shape (method vs optional interface) is a plan-level detail | S:65 R:80 A:80 D:65 |
| 8 | Confident | Fix-tab-name requires the subject window to have a reconciled chat session; otherwise 404 + action hidden | The template's whole job is reading the transcript; without a ref there is nothing to read — declared per-template (`requiredFacts`) so future templates can differ | S:70 R:80 A:80 D:75 |
| 9 | Confident | Success UX is fire-and-forget: `200` ⇒ toast "Sent to operator", rename surfaces via SSE later; failure ⇒ error toast with the server's structured message | Plan doc: "result arrives via the normal derive tick"; toast machinery (`useToast`) exists; no progress state would be derivable anyway | S:80 R:85 A:85 D:80 |
| 10 | Tentative | v1 prompt wording (the exact template text in What Changes, incl. "last ~30 JSONL lines" and the do-not-reply bound) | The plan specifies facts + intent, not copy; wording will likely be tuned after first live use — trivially reversible (in-code string) | S:40 R:90 A:55 D:45 |
| 11 | Tentative | Palette label `Tab: Fix name (ask operator)`; flyout row label "Fix tab name" | Follows the existing `Tab:` namespace and flyout row style; pure copy, trivially changed | S:40 R:95 A:60 D:50 |
| 12 | Confident | Test scope: full Go status-matrix + frontend unit gating; no live-operator e2e | A real agent answering in CI is not viable; the injection machinery's own e2e-adjacent risks are already covered by the chat-send suite | S:60 R:75 A:80 D:70 |

12 assumptions (3 certain, 7 confident, 2 tentative, 0 unresolved).
