# Intake: Chat Send — message input from the chat view into the agent pane

**Change**: 260714-jdyg-chat-send
**Created**: 2026-07-14

## Origin

> chat-send — see fab/plans/sahil/agent-chat-view.md Change 4: chat-send. This is the
> FINAL change in the chat-view stack. Depends on Change 3 (chat-read-frontend, merged)
> — now also building on top of the web-view-lens view-switcher retrofit (PR #352,
> merged), which changed how the tty/view switcher works. Re-verify the current
> view-switcher architecture before planning, since it may differ from what the plan
> originally assumed. Reference the plan explicitly in the intake.

Invoked via `/fab-new` (interactive). This is **Change 4 — the final change — of the
HTML-agent-chat-view plan** ([`fab/plans/sahil/agent-chat-view.md`](../../plans/sahil/agent-chat-view.md)
§ Change 4). Dependencies verified merged to main: Change 1 `260713-nh86-chat-session-identity`
(PR #339), Change 2 `260714-pmfh-chat-read-backend`, Change 3 `260714-r7rq-chat-read-frontend`
(PR #351) — all three `review-pr:done` — plus the `260714-t97o-web-view-lens` switcher
retrofit (PR #352). The plan's Decision-log entries are treated as Certain per the plan's
pickup protocol.

**Architecture re-verified at pickup (2026-07-14)** — the plan's original switcher
assumptions are superseded by PR #352, and the current state was confirmed against code:

- **View switching is the unified lens model** (`docs/specs/window-views.md`), not the
  chat plan's original two-state chip: pure helpers in
  `app/frontend/src/lib/window-view.ts` (`availableViews`/`defaultView`/`resolveView`,
  value-bearing `runkit-window-view:{server}:{windowId}` localStorage), a generic
  tty-first `ViewSwitcher` L1 chip, ONE validated `?view=web|chat` search param,
  `Cmd/Ctrl+.` cycle + `Ctrl+\`` tty↔chat toggle, heading follows the lens.
  **Chat-send touches none of that plumbing** — its frontend surface is *inside*
  `ChatView` (`app/frontend/src/components/chat-view.tsx`, whose disabled footer at
  lines 108–119 / `data-testid="chat-send-disabled"` is the exact slot the input box
  replaces), plus a send callback wired from `AppShell` (`app.tsx` owns the single
  `useChatStream` at ~line 903 and the `ChatView` render branch at ~line 2179).
- **Pane-level identity exists on the backend**: `tmux.PaneInfo` carries `PaneID`,
  `AgentState` (reconciled `active|waiting|idle`), and `ChatProvider`/`ChatSessionRef`
  (`internal/tmux/tmux.go:369–397`); `rollupChat` (`internal/sessions/sessions.go:513`,
  active-pane-first else first chat pane) rolls them up to the window;
  `resolveWindowChat` (`api/chat.go:36`) re-resolves server-side per request.
  `CapturePane(paneID, lines, server)` exists (`tmux.go:1657`, used by tile previews).
- **A generic keys endpoint already exists and is NOT suitable**:
  `POST /api/windows/{windowId}/keys` → `tmux send-keys -t <windowID> <keys> Enter`
  (`api/windows.go:443`, `internal/tmux/tmux.go:1531`; client `sendKeys` in
  `client.ts:213` currently has zero frontend callers). Inadequate for chat send on
  four counts: window-targeted (tmux routes a window target to the *active* pane — in a
  split, possibly not the agent pane), no `-l` literal flag (message text like `Enter`
  or `C-c` would be interpreted as key names), unconditional trailing Enter (exactly the
  stale-prompt trap the plan forbids), no multiline. It stays untouched.
- `tmuxExecServer` uses `cmd.Output()` with no stdin plumbing — so buffer loading uses
  `set-buffer` (text as an argv element), not `load-buffer -` (stdin).

**Decision asked and resolved during intake** (the plan's one flagged
"decide at intake" item for this change — busy-agent handling): the plan text
recommended reject-while-busy, but that predates a relevant fact: Claude Code's TUI
natively queues messages typed while the agent works (steering), and probe-before-Enter
already blocks the genuinely unsafe cases. User chose **Allow + probe**: no server-side
busy gate, always paste → verify echo → Enter; the UI shows a non-blocking
"agent is working — message will be queued" hint while the window's `agentState` is
`active`. No server-side queue in any variant (Constitution II).

## Why

1. **The chat view is half a loop.** Change 3 shipped a read-only chat view — on a phone
   (the view's primary ergonomic win, escaping 80-col tmux overflow) you can *read* the
   agent but must flip back to the raw terminal, with its overflow and tiny touch
   targets, to *answer* it. The pending-question deep link (push notification →
   `?view=chat`) currently lands you somewhere you cannot act.
2. **Without it, the stack is unfinished.** Changes 1–3 built session identity, the
   event schema/stream, and the renderer explicitly so that mobile-friendly two-way
   interaction could land; stopping at read-only leaves the plan's headline capability
   ("flip between raw terminal and HTML chat of the same live session" — and act in
   either) unshipped.
3. **Why tmux injection rather than an agent API**: the pane stays the agent's parent
   (Constitution VI); rk sends keystrokes *into the pane* exactly as a human typist
   would — no SDK hosting, no session ownership, no queue state (Constitution II). The
   plan's decision log binds this shape ("chat is a view over the pane, not a
   substrate"). Protocol-based send (Codex JSON-RPC) is Change 5's business, not ours.

## What Changes

### Backend — `POST /api/windows/{windowId}/chat/send` (`api/chat.go`)

New handler in the existing chat route family (`router.go` next to the two GET chat
routes). Constitution IX: mutation ⇒ POST.

- **Request**: `POST /api/windows/{windowId}/chat/send?server={server}` with JSON body
  `{"text": "<message>"}`. Text is sent verbatim (multiline allowed); a body whose
  `text` is empty or whitespace-only is rejected `400`.
- **Resolution**: validate `{windowId}` (`parseWindowID`, `400` on malformed), then
  re-resolve the window's reconciled chat **server-side per request** — extending the
  `resolveWindowChat` seam (or a sibling) to also surface the **resolved pane's
  `PaneID`** from the same rollup rule (`rollupChat`: active-pane-first, else first
  chat-carrying pane). The client never supplies a pane or session ref. Distinguish
  `FetchSessions` failure (`500`) from genuine no-chat (`404`), mirroring the read
  endpoints.
- **Injection sequence** (all argv slices via `tmuxExecServer`, Constitution I; every
  step targets the resolved `PaneID`, never the window):
  1. `set-buffer -b <named-buffer> <text>` — text as a discrete argv element (no shell
     string, no stdin); a named buffer avoids clobbering the user's buffer stack.
  2. `paste-buffer -d -p -b <named-buffer> -t <paneID>` — `-p` bracketed paste (the
     Claude Code TUI requests bracketed paste, so multiline + special characters land
     as one literal block, no per-line submission), `-d` deletes the buffer after paste.
  3. **Probe** (below) — only on success:
  4. `send-keys -t <paneID> Enter`.
- **Busy policy (user-decided: Allow + probe)**: no `agentState` gate on the server.
  A busy (`active`) agent receives the paste into its TUI input box, which Claude Code
  queues natively (steering). The probe is the sole guard.
- **Error surfaces** (`writeError` JSON shape, mirroring chat-read): `400` invalid
  windowId / empty text; `404` no reconciled chat; `409` probe failure (structured,
  e.g. `{"error":"agent input not ready — message pasted but not echoed; Enter withheld"}`);
  `500` FetchSessions/tmux failures. Success: `200 {"ok":true}`.
- **Provider seam**: the tmux-injection path is mechanically provider-agnostic (it
  types into the pane), gated only on chat presence. Keep the injection behind a small
  function boundary so Change 5's protocol-based codex send can later branch on
  provider without reshaping the handler. v1 makes no provider branch.
- The existing generic `POST /api/windows/{windowId}/keys` endpoint is left untouched
  (different contract, possible external callers).

### Backend — probe-before-Enter (`internal/tmux` + handler logic)

Mandatory per the plan (risk register #2) and the operator lesson (a visible `❯ <text>`
line can be stale printed output, not the live input buffer — a bare Enter then submits
an empty no-op or worse).

- After the paste, `CapturePane` the target pane (existing helper) and verify the
  pasted text **echoed into the live input buffer** before sending Enter.
- **Tolerant matching**: derive a probe needle from the text (e.g. a distinctive
  fragment of its last non-empty line, whitespace-normalized, length-capped so TUI
  line-wrapping at 80 cols can't split it) and require it in the capture tail. Exact
  heuristic is apply's call; the requirement is: *Enter is sent only after a successful
  echo check*.
- **Settle timing**: a short delay before the first capture plus a small bounded retry
  (order ~50–150ms, 1–2 retries) to let the TUI redraw after paste; constants named,
  not magic (code-quality). Total worst-case wait stays well under the 5s tmux-op
  budget (code-review rule).
- **On probe failure**: no Enter is ever sent; return `409` with the structured error.
  The pasted text may legitimately remain sitting in the TUI input box — that is
  visible, recoverable state in the terminal view, strictly better than a blind Enter.
  The failure is surfaced, never silent (plan acceptance: "sending while busy fails
  visibly, never silently" generalizes to "sending that cannot be verified fails
  visibly").
- **Accepted race**: the capture→Enter gap is inherently TOCTOU-racy; best-effort
  verification matches operator practice and is the accepted worst case.

### Frontend — input box in `ChatView` (`components/chat-view.tsx`)

Replace the disabled footer (`data-testid="chat-send-disabled"`, lines 108–119) with a
send form, keeping `ChatView` a **pure component over passed props** (the shipped
pattern): `AppShell` supplies an `onSend(text) => Promise<void>` callback (wrapping a
new `sendChatMessage(server, windowId, text)` in `src/api/client.ts`, same
`withServer` + `throwOnError` shape as `sendKeys`) plus the busy signal derived from
`currentWindow.agentState === "active"`.

- **Input**: an auto-growing monospace `<textarea>` in the house aesthetic (bounded
  max-height ~6 lines, then internal scroll), placeholder e.g. `Message the agent…`.
- **Submission**: Enter sends; Shift+Enter inserts a newline; an explicit send button
  (house chip style, CRT-glint vocabulary) for touch/mouse. Keyboard-first
  (Constitution V) is satisfied by the input itself being the affordance — Enter is the
  action; no new palette entry or global chord is required. Typing in the textarea must
  not trigger global chords (`shouldSuppressViewChord` already suppresses TEXTAREA —
  verify the `Ctrl+\`` toggle hook coexists sanely with input focus).
- **In-flight**: submit disabled + subtle sending state while the POST is pending
  (double-Enter must not double-send); the textarea keeps its text until the POST
  succeeds — clear on success, keep on failure.
- **Errors**: a failed send renders an inline `role="alert"` line above the input
  (reusing the chat-error styling vocabulary), showing the server's structured error
  (e.g. the 409 probe message). Never a silent failure.
- **Busy hint**: while the window's `agentState` is `active`, a non-blocking hint near
  the input ("agent is working — message will be queued"); input stays enabled
  (user-decided policy). The existing tail pending-question bubble already covers
  `waiting` context — no extra treatment.
- **Focus**: on desktop (fine pointer), focus the input when the chat lens activates
  (the natural continuation of `Ctrl+\``/switcher flip); skip auto-focus on
  mobile/coarse pointers so the virtual keyboard doesn't pop unbidden.
- **Read-only regression guard**: the disabled-footer testid is removed; chat-view
  e2e/`.spec.md` assertions referencing it are updated in the same commit.

### Mobile input ergonomics

The existing `useVisualViewport` pin (`--app-height`/`--app-offset-top` + fullbleed on
the root layout) already resizes the app to the visual viewport when the on-screen
keyboard opens; `ChatView` is a `flex-1 min-h-0` column with a `shrink-0` footer, so
the input stays above the keyboard and the transcript keeps its stick-to-bottom
auto-follow. Obligation: verify at 375×812 (keyboard interplay, no clipped input, no
horizontal overflow) AND desktop per the project Playwright-driven workflow — plus that
the single-row mobile budgets are unaffected (the input lives inside the pane, not the
bars).

### Plan tracking table (`fab/plans/sahil/agent-chat-view.md`)

Per the plan's pickup protocol: fill row 4 (`chat-send` → change folder
`260714-jdyg-chat-send`; PR link at ship) in the same PR. Also correct the stale rows
2–3 (both show "in progress"; both are merged — row 3 is PR #351) and add row 2's PR
link. Mark row 4 Done only when the PR merges.

### Tests

- **Go unit tests** (`api/chat_send_test.go` or colocated): handler status matrix
  (400/404/409/500/200) against fake tmux ops (the `tmuxOps` interface seam in
  `router.go`); injection-sequence order (set-buffer → paste-buffer → probe →
  conditional Enter); probe matcher cases (echo present / absent / wrapped multiline);
  no-Enter-on-probe-failure.
- **Frontend unit tests** (colocated `.test.tsx`): input submission semantics
  (Enter/Shift+Enter/button), in-flight lock, clear-on-success / keep-on-failure,
  inline error render, busy hint gating.
- **Playwright e2e + sibling `.spec.md`** (constitution): extend/append to the
  fully-route-mocked pattern of `tests/e2e/chat-view.spec.ts` — mock
  `POST **/api/windows/*/chat/send*` (trailing `*` — the client appends `?server=`;
  see the glob-fallthrough trap) and assert: typing + Enter fires exactly one POST with
  the typed body; a mocked 409 surfaces the inline error and keeps the text; success
  clears the input; the busy hint renders when the mocked window's `agentState` is
  `active`. Both 375px and desktop viewports. `just test-e2e` / `just pw` only (port
  3020 isolation).

Acceptance (from the plan, adjusted for the resolved busy policy): a message sent from
the chat view arrives in the agent exactly as typed (incl. multiline + special chars);
a send that cannot be verified (probe failure) fails visibly, never silently; sending
while busy is allowed and its queued nature is hinted; e2e coverage per above.

## Affected Memory

- `run-kit/chat`: (modify) add the send path — endpoint contract, pane-targeted
  injection sequence, probe-before-Enter semantics, allow+probe busy policy, and the
  ChatView input-box requirements (the § Chat View Frontend read-only framing changes)
- `run-kit/architecture`: (modify) API-endpoints inventory gains
  `POST /api/windows/{windowId}/chat/send`; internal/chat description no longer
  "read-only subsystem"
- `run-kit/tmux-sessions`: (modify) new pane-targeted tmux primitives (named
  set-buffer/paste-buffer, probed Enter) alongside the existing SendKeys note

## Impact

- **Backend**: `api/chat.go` (+ send handler, pane-resolution extension),
  `api/router.go` (route + `tmuxOps` interface methods), `internal/tmux/tmux.go`
  (set-buffer/paste-buffer/probe helpers; `SendKeys` untouched), colocated Go tests.
- **Frontend**: `components/chat-view.tsx` (input form), `app.tsx` (onSend wiring +
  busy prop), `src/api/client.ts` (`sendChatMessage`), colocated unit tests,
  `tests/e2e/chat-view.spec.ts` + `.spec.md` (or a sibling `chat-send` spec pair).
- **Docs/plan**: `fab/plans/sahil/agent-chat-view.md` tracking table; memory files per
  Affected Memory at hydrate.
- **No changes** to: the lens/switcher machinery (`window-view.ts`, `ViewSwitcher`,
  search-param validation), the chat read endpoints/stream, `@rk_chat` stamping
  (Change 1), the generic keys endpoint.
- **Dependencies**: none new — no SDK, no node runtime; pure tmux + existing stack.

## Open Questions

- (none — the plan's one flagged intake decision, busy-agent handling, was asked and
  resolved: Allow + probe.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Endpoint is `POST /api/windows/{windowId}/chat/send?server=` with `{"text"}` body; window-keyed, ref+pane re-resolved server-side per request (client never supplies pane/ref) | Plan decision log + Constitution IX + the shipped window-keyed chat route family and its "never trust a client ref" design decision | S:90 R:75 A:95 D:90 |
| 2 | Certain | Busy policy: allow + probe — no server-side busy gate, no queue (Constitution II); UI shows a non-blocking "will be queued" hint while `agentState` is `active` | Asked — user chose "Allow + probe" over the plan's reject recommendation; Claude Code TUI natively queues typed input, probe guards the unsafe cases | S:95 R:70 A:90 D:95 |
| 3 | Confident | Send targets the `PaneID` resolved by the same rollup rule as chat read (active-pane-first, else first chat pane), never the window target | A window target routes to the active pane, which in a split may not be the agent pane; `rollupChat`/`PaneInfo.PaneID` already exist — extending `resolveWindowChat` is the obvious seam | S:70 R:75 A:90 D:80 |
| 4 | Confident | Injection = named `set-buffer` (argv, no stdin) + `paste-buffer -d -p -b <name> -t <pane>` + probed separate `send-keys Enter`; multiline rides bracketed paste | Plan names paste-buffer + Enter; `-p` matches the TUI's bracketed-paste support; `tmuxExecServer` has no stdin so `set-buffer` beats `load-buffer -`; named buffer avoids clobbering the user's buffer stack | S:75 R:80 A:80 D:70 |
| 5 | Confident | Probe = tolerant capture-pane echo check (needle from last non-empty line, wrap-safe, short settle + bounded retry, <5s total); failure → 409, Enter withheld, text left visible in the TUI input | Plan mandates probe-before-Enter; exact heuristic is agent-decidable and easily tuned; leaving pasted text on failure is visible recoverable state | S:80 R:70 A:75 D:65 |
| 6 | Certain | ChatView stays a pure component — AppShell supplies `onSend` + busy signal; input UX = auto-grow textarea, Enter sends / Shift+Enter newline / visible send button, in-flight lock, clear-on-success keep-on-failure, inline `role="alert"` error | Shipped ChatView/AppShell ownership pattern + house form conventions + standard chat UX; keyboard-first satisfied by the input itself | S:70 R:85 A:85 D:75 |
| 7 | Confident | Desktop-only autofocus of the input when the chat lens activates; no autofocus on coarse pointers (keyboard pop) | Natural continuation of the `Ctrl+\``/switcher flip and trivially reversible, but an unprompted focus change is a UX judgment call | S:40 R:90 A:70 D:55 |
| 8 | Confident | E2E strategy: fully route-mocked Playwright (mock the send POST with trailing-`*` glob) for UI semantics; injection/probe correctness carried by Go unit tests against the `tmuxOps` fake | The shipped chat-view.spec.ts pattern is fully mocked (no real tmux in e2e); a live claude pane in e2e is infeasible; the glob trap is a recorded project lesson | S:65 R:80 A:85 D:75 |
| 9 | Certain | Leave `POST /api/windows/{windowId}/keys` untouched | Different contract (window-target, key-name interpretation, unconditional Enter) and possible external callers; chat send is additive | S:60 R:85 A:90 D:85 |
| 10 | Confident | v1 send is the provider-agnostic tmux-injection path gated on chat presence, kept behind a small function seam for Change 5's protocol send | Plan: codex send "bypasses tmux send-keys entirely" — a seam now avoids a reshape later at near-zero cost; no v1 provider branch | S:60 R:75 A:80 D:70 |
| 11 | Certain | Update the plan tracking table (fill row 4, correct stale rows 2–3 statuses/PR links) in the same PR | Plan pickup protocol step 5 verbatim; rows 2–3 verified merged (`review-pr:done`, #351) | S:95 R:95 A:100 D:95 |

11 assumptions (5 certain, 6 confident, 0 tentative, 0 unresolved).
