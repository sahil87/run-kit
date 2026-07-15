# Plan: Chat Send — message input from the chat view into the agent pane

**Change**: 260714-jdyg-chat-send
**Intake**: `intake.md`

## Requirements

> Derived from `intake.md` (Change 4 — the final change — of the HTML-agent-chat-view
> plan, `fab/plans/sahil/agent-chat-view.md` § Change 4). The busy-policy decision
> (Allow + probe) is resolved in the intake and treated as Certain here.

### Backend: Chat-send endpoint

#### R1: `POST /api/windows/{windowId}/chat/send` handler in the chat route family
The backend SHALL expose a mutating endpoint `POST /api/windows/{windowId}/chat/send?server={server}`
(Constitution IX: mutation ⇒ POST) that accepts a JSON body `{"text": "<message>"}`,
registered in `api/router.go` next to the two GET chat routes and implemented in
`api/chat.go`. The existing `POST /api/windows/{windowId}/keys` endpoint SHALL be left
untouched.

- **GIVEN** a chat-capable window `@N` on server `S`
- **WHEN** a client POSTs `/api/windows/@N/chat/send?server=S` with body `{"text":"hello"}`
- **THEN** the handler validates, resolves the pane, injects the text, and returns
  `200 {"ok":true}` on success — and the `/keys` endpoint's behavior is unchanged.

#### R2: Request validation — windowId and non-empty text
The handler SHALL validate `{windowId}` via `parseWindowID` (returning `400` on a
malformed id) and reject a body whose `text` is empty or whitespace-only with `400`.
Text is otherwise sent verbatim, including multiline and special characters.

- **GIVEN** a request with a malformed window id OR an empty/whitespace-only `text`
- **WHEN** the handler runs
- **THEN** it returns `400` with a JSON `writeError` body and performs no tmux injection.
- **AND GIVEN** a request whose JSON body cannot be decoded, **THEN** it returns `400`.

#### R3: Server-side pane resolution (never trust a client ref)
The handler SHALL re-resolve the window's reconciled chat server-side per request by
extending the `resolveWindowChat` seam to also surface the **resolved pane's `PaneID`**,
derived by the same rollup rule as chat read (`rollupChat`: active-pane-first, else the
first chat-carrying pane). The client SHALL NOT supply a pane id or session ref. A
`FetchSessions` failure SHALL map to `500`; a genuine no-reconciled-chat (window absent,
or window carries no chat pane) SHALL map to `404` — mirroring the read endpoints.

- **GIVEN** a window whose active pane carries `@rk_chat` on pane `%2`
- **WHEN** the handler resolves the target
- **THEN** injection targets `%2` (the resolved `PaneID`), never the window id `@N`.
- **AND GIVEN** `FetchSessions` errors, **THEN** the response is `500`; **AND GIVEN** the
  window has no reconciled chat, **THEN** the response is `404`.

#### R4: Injection sequence targets the PaneID via argv slices
On a resolved pane the handler SHALL inject the message using this exact ordered sequence,
every subprocess call built from argv slices (Constitution I), every step targeting the
resolved `PaneID` (never the window):
1. `set-buffer -b <named-buffer> <text>` — text as a discrete argv element (no shell
   string, no stdin — `tmuxExecServer` has no stdin plumbing); a named buffer avoids
   clobbering the user's buffer stack.
2. `paste-buffer -d -p -b <named-buffer> -t <paneID>` — `-p` bracketed paste (multiline +
   special characters land as one literal block), `-d` deletes the buffer after paste.
3. Probe (R5) — only on success:
4. `send-keys -t <paneID> Enter` — the literal `Enter` key, sent ONLY after a successful
   probe.

There SHALL be no `agentState` gate and no server-side queue (busy policy = Allow + probe;
Constitution II).

- **GIVEN** a resolved pane `%2` and text `"echo Enter"` (containing a would-be key name)
- **WHEN** injection runs
- **THEN** the order is set-buffer → paste-buffer → probe → send-keys, the text is passed
  as one literal argv element (never interpreted as key names), and Enter is a separate
  step gated on the probe.

#### R5: Probe-before-Enter with tolerant echo matching, settle + bounded retry
Before sending Enter the handler SHALL `CapturePane` the target pane and verify the pasted
text **echoed into the live input buffer**, using a tolerant matcher: derive a probe needle
from the text (a distinctive fragment of its last non-empty line, whitespace-normalized,
length-capped so TUI line-wrapping at ~80 cols cannot split it) and require it in the
capture tail. A short settle delay SHALL precede the first capture, followed by a small
bounded retry (named constants, not magic numbers), with total worst-case wait well under
the 5s tmux-op budget (code-review rule). On probe **success** Enter is sent (R4 step 4);
on probe **failure** no Enter is ever sent and the handler returns `409` with a structured
JSON error (e.g. `{"error":"agent input not ready — message pasted but not echoed; Enter withheld"}`);
the pasted text legitimately remains in the TUI input box (visible, recoverable state).

- **GIVEN** a paste whose text echoes into the capture within the retry budget
- **WHEN** the probe runs
- **THEN** Enter is sent and the response is `200 {"ok":true}`.
- **AND GIVEN** the text never appears in the capture across all retries, **THEN** no Enter
  is sent and the response is `409` with the structured error.
- **AND GIVEN** the pasted text wraps across capture lines, **THEN** the wrap-safe needle
  still matches (length-capped last-line fragment).

#### R6: Error surfaces mirror chat-read; tmux failures are 500
The handler SHALL return, as JSON `writeError` objects: `400` (invalid windowId / empty
text / undecodable body); `404` (no reconciled chat / no adapter-class window); `409`
(probe failure, structured, Enter withheld); `500` (`FetchSessions` or any tmux subprocess
failure). Success is `200 {"ok":true}`.

- **GIVEN** any of the above conditions
- **WHEN** the handler runs
- **THEN** the matching status and JSON shape is returned and no partial/blind Enter is sent
  on a `409`/`500` path.

#### R7: Provider-agnostic injection behind a small function seam
The tmux-injection path SHALL be provider-agnostic (it types into the pane, gated only on
chat presence) and kept behind a small function boundary so Change 5's protocol-based codex
send can later branch on provider without reshaping the handler. v1 makes NO provider branch.

- **GIVEN** the v1 handler
- **WHEN** a message is sent to a `claude` pane
- **THEN** injection runs the tmux path unconditionally (no provider switch), and the
  injection logic is a discrete function the handler calls.

#### R8: New tmux primitives + tmuxOps interface methods
`internal/tmux/` SHALL gain the pane-targeted primitives the injection needs (named
`set-buffer`, `paste-buffer -d -p`, and a literal-key `send-keys Enter`), each via
`exec.CommandContext` with a timeout (Constitution I / Process Execution), with named
constants for the buffer name and probe settle/retry timings. `api/router.go`'s `TmuxOps`
interface (and the production `prodTmuxOps` + the test `mockTmuxOps`) SHALL gain the
corresponding methods so the handler is testable against the fake. `CapturePane` (already
on the tmux package) SHALL be surfaced on `TmuxOps` for the probe. `SendKeys` (the window-
targeted `/keys` helper) SHALL be untouched.

- **GIVEN** the handler under test
- **WHEN** driven with a `mockTmuxOps` fake
- **THEN** each injection primitive is a recordable interface call and the status matrix is
  exercisable without a real tmux.

### Frontend: Chat-send input box

#### R9: `sendChatMessage` API client function
`app/frontend/src/api/client.ts` SHALL export `sendChatMessage(server, windowId, text): Promise<{ok: boolean}>`
that POSTs to `/api/windows/{windowId}/chat/send` with `{"text": text}` using the shipped
`withServer` + `throwOnError` shape (so the server's structured error text — including the
409 probe message — surfaces as the thrown Error's message).

- **GIVEN** a mocked `409` response with `{"error":"…not ready…"}`
- **WHEN** `sendChatMessage` is called
- **THEN** it throws an Error whose message is the server's `error` string.

#### R10: ChatView send form — pure component, AppShell-supplied callback + busy signal
`ChatView` SHALL remain a **pure component over passed props**. The disabled footer
(`data-testid="chat-send-disabled"`, `components/chat-view.tsx` ~lines 108–119) SHALL be
replaced by a send form. `AppShell` (`app.tsx`) SHALL supply an `onSend(text): Promise<void>`
callback (wrapping `sendChatMessage(server, windowId, text)`) plus a `busy` signal derived
from `currentWindow.agentState === "active"`. The lens/switcher machinery (`window-view.ts`,
`ViewSwitcher`, search-param validation) SHALL NOT be touched.

- **GIVEN** the chat lens active on a chat-capable window
- **WHEN** ChatView renders
- **THEN** it shows an input form (no `chat-send-disabled` testid) and delegates sends to the
  `onSend` prop; AppShell owns the wiring and busy derivation.

#### R11: Input UX — auto-grow textarea, Enter sends / Shift+Enter newline, send button
The input SHALL be an auto-growing monospace `<textarea>` in the house aesthetic (bounded
max-height ~6 lines then internal scroll, placeholder e.g. `Message the agent…`). Enter SHALL
submit; Shift+Enter SHALL insert a newline; an explicit send button (house chip style, CRT-
glint vocabulary) SHALL be present for touch/mouse. Typing in the textarea SHALL NOT trigger
global chords (`shouldSuppressViewChord` already suppresses TEXTAREA — the `Ctrl+\`` toggle
must coexist with input focus without hijacking a newline; no new palette entry or global
chord is added — Enter itself is the keyboard-first affordance, Constitution V).

- **GIVEN** focus in the textarea
- **WHEN** the user presses Enter (no Shift)
- **THEN** the message submits and the default newline is prevented.
- **AND GIVEN** Shift+Enter, **THEN** a newline is inserted and nothing submits.
- **AND GIVEN** an empty/whitespace-only textarea, **THEN** Enter does NOT submit.

#### R12: In-flight lock, clear-on-success, keep-on-failure, inline error
While a send POST is pending the submit path SHALL be locked (double-Enter / double-click must
not double-send) with a subtle sending state. The textarea SHALL keep its text until the POST
succeeds — cleared on success, kept on failure. A failed send SHALL render an inline
`role="alert"` line above the input (reusing the chat-error styling vocabulary) showing the
server's structured error (e.g. the 409 probe message). A failure SHALL never be silent.

- **GIVEN** a send in flight
- **WHEN** the user presses Enter again
- **THEN** no second POST fires.
- **AND GIVEN** the POST resolves ok, **THEN** the textarea clears and any prior error clears.
- **AND GIVEN** the POST rejects, **THEN** the text is retained and the error message renders in
  a `role="alert"` element.

#### R13: Busy hint (non-blocking) while the window agent is active
While `currentWindow.agentState === "active"` a non-blocking hint (e.g. "agent is working —
message will be queued") SHALL render near the input; the input SHALL stay ENABLED (Allow +
probe policy). The tail pending-question bubble already covers `waiting` context — no extra
treatment is added.

- **GIVEN** the busy signal is true
- **WHEN** ChatView renders
- **THEN** the queued-message hint is visible and the input/submit remain enabled.
- **AND GIVEN** the busy signal is false, **THEN** the hint is absent.

#### R14: Desktop-only autofocus on chat-lens activation
On desktop (fine pointer) the input SHALL be focused when the chat lens activates (the natural
continuation of the `Ctrl+\``/switcher flip); on coarse pointers autofocus SHALL be skipped so
the virtual keyboard does not pop unbidden.

- **GIVEN** a fine-pointer device and the chat lens becoming active
- **WHEN** the view mounts/activates
- **THEN** the input receives focus.
- **AND GIVEN** a coarse pointer, **THEN** the input is NOT auto-focused.

#### R15: Mobile input ergonomics unchanged elsewhere
The send form SHALL live inside the `ChatView` pane (a `shrink-0` footer of the existing
`flex-1 min-h-0` column) so the existing `useVisualViewport` pin keeps the input above the
on-screen keyboard and the transcript keeps its stick-to-bottom auto-follow; the single-row
top/bottom bar budgets SHALL be unaffected (the input is in the pane, not the bars). Verified
at 375×812 and desktop.

- **GIVEN** the 375px viewport with the chat lens active
- **WHEN** the keyboard opens
- **THEN** the input stays visible above the keyboard, no clipped input, no horizontal page
  overflow, and the bar budgets are unchanged.

### Docs / plan tracking

#### R16: Plan tracking-table update
`fab/plans/sahil/agent-chat-view.md` SHALL have row 4 (`chat-send`) filled with change folder
`260714-jdyg-chat-send`, and the stale rows 2–3 corrected: both are merged (row 3 = PR #351;
row 2's PR number resolved from `git log` on main for the chat-read-backend merge). Row 4 is
marked Done only when its PR merges (left "in progress"/not-done in this change).

- **GIVEN** the tracking table
- **WHEN** this change updates it
- **THEN** row 4 carries the folder name and rows 2–3 read Done with their PR links.

### Non-Goals

- No changes to the lens/switcher machinery (`window-view.ts`, `ViewSwitcher`, search-param
  validation), the chat read endpoints/stream, `@rk_chat` stamping (Change 1), or the generic
  `POST /api/windows/{windowId}/keys` endpoint.
- No provider branch in v1 (codex protocol send is Change 5).
- No server-side queue or busy gate (Constitution II; Allow + probe).
- No new route, no new dependency (pure tmux + existing stack).

### Design Decisions

1. **Pane-targeted injection, not window-targeted**: a window `-t` target routes to the active
   pane which in a split may not be the agent pane — *Why*: `rollupChat`/`PaneInfo.PaneID`
   already exist; extend the `resolveWindowChat` seam to surface the resolved PaneID —
   *Rejected*: reusing `/keys` (window-target, key-name interpretation, unconditional Enter).
2. **`set-buffer` (argv) + `paste-buffer -d -p` + probed `send-keys Enter`**: multiline rides
   bracketed paste — *Why*: `tmuxExecServer` has no stdin so `set-buffer` beats `load-buffer -`;
   named buffer avoids clobbering the user's buffer stack; `-p` matches the TUI's bracketed-
   paste support — *Rejected*: `load-buffer -` (no stdin), unconditional Enter (stale-prompt trap).
3. **Probe primitives on `TmuxOps`, matcher/orchestration in the handler**: the individual tmux
   calls (set-buffer / paste-buffer / capture-pane / send-keys-Enter) are interface methods; the
   needle derivation + settle/retry loop live in `api/chat.go` — *Why*: makes the status matrix
   and probe cases testable against `mockTmuxOps` without a live claude pane — *Rejected*: a
   single opaque `SendChat` tmux method (untestable probe branches).
4. **ChatView pure, AppShell wires**: `onSend` + `busy` props — *Why*: the shipped ChatView/
   AppShell ownership pattern (AppShell already owns the single `useChatStream`) — *Rejected*:
   ChatView calling the client directly (breaks the pure-renderer contract).

## Tasks

### Phase 1: Backend tmux primitives

- [x] T001 Add pane-targeted tmux primitives to `app/backend/internal/tmux/tmux.go`: `SetBuffer(bufferName, text, server)` (`set-buffer -b <name> <text>`) <!-- rework: review must-fix — set-buffer lacks a `--` option terminator, so leading-dash text ("--force is broken") is parsed as tmux flags → hard 500, violating R2/A-015 verbatim delivery. Fix: `set-buffer -b <name> -- <text>` (verified on tmux 3.6a) -->, `PasteBuffer(bufferName, paneID, server)` (`paste-buffer -d -p -b <name> -t <paneID>`), `SendEnter(paneID, server)` (`send-keys -t <paneID> Enter`), each via `exec.CommandContext`+`withTimeout`; add a named buffer-name constant (e.g. `ChatSendBufferName = "rk-chat-send"`). Leave `SendKeys`/`CapturePane` unchanged. <!-- R8 -->
- [x] T002 Add `internal/tmux` unit tests (`tmux_test.go` or colocated) for the argv-building of the new primitives where a pure builder is used, or document that they are thin `exec.CommandContext` wrappers exercised via the handler tests; ensure timeouts are present. <!-- R8 -->

### Phase 2: Backend pane resolution seam

- [x] T003 Add an exported chat-pane rollup helper in `app/backend/internal/sessions/sessions.go` — `ResolveChatPane(panes) (provider, ref, paneID string)` applying active-pane-first / else-first-chat-pane; refactor `rollupChat` to delegate (single source of the rule). Add/extend `sessions_test.go` cases asserting the paneID is the active chat pane (else first). <!-- R3 -->
- [x] T004 Extend `resolveWindowChat` in `app/backend/api/chat.go` to also return the resolved `paneID` (via the window's `Panes` + `sessions.ResolveChatPane`), preserving the existing `(provider, ref, ok, err)` distinctions (500 vs 404). Update the two existing GET call sites to ignore the new return (or keep a thin wrapper) without behavior change. <!-- R3 -->

### Phase 3: Backend send handler + interface wiring

- [x] T005 Add `TmuxOps` interface methods in `app/backend/api/router.go` — `SetBuffer`, `PasteBuffer`, `SendEnter`, `CapturePane(paneID, lines, server) (string, error)` — and implement them on `prodTmuxOps` (delegating to the tmux package). <!-- R8 -->
- [x] T006 Add the matching methods to `mockTmuxOps` in `app/backend/api/sessions_test.go` (record calls + call order; a settable `capturePaneResult`/`capturePaneResults` for probe cases; error-injection fields). <!-- R8 -->
- [x] T007 Implement `handleChatSend` in `app/backend/api/chat.go`: <!-- rework cycle 2 (review must-fix): (a) probe verifies PRESENCE not NOVELTY — take a pre-paste baseline capture and require the needle/placeholder occurrence count to INCREASE post-paste (fails closed), and gate the paste-collapse-placeholder branch on multiline text (single-line pastes never collapse); (b) the single global named buffer races under concurrent sends (A-set/B-set/A-paste ⇒ wrong text into wrong pane) — serialize the set→paste critical section with a package-level mutex OR use a per-request unique buffer name with delete-on-error; (c) should-fix: the injection chains up to 6 sequential subprocesses each with a 10s timeout — thread one shared deadline through the sequence (worst case well under 5s) or shrink the probe-capture timeouts, and correct the stale budget comment --> parse+validate windowId (400) and body `text` (400 empty/whitespace/undecodable); resolve pane (500 fetch / 404 no-chat); run the injection sequence via a discrete provider-agnostic function (`injectChatMessage` seam, R7) — set-buffer → paste-buffer → probe → conditional Enter; map tmux failures to 500; probe failure to a structured 409 with Enter withheld; success 200 `{"ok":true}`. Add named settle/retry constants. <!-- R1 R2 R4 R5 R6 R7 -->
- [x] T008 Register `r.Post("/api/windows/{windowId}/chat/send", s.handleChatSend)` in `app/backend/api/router.go` next to the two GET chat routes; leave `/keys` untouched. <!-- R1 -->
- [x] T009 Add the probe matcher as a pure helper <!-- rework cycle 1 (done): accept the "[Pasted text #N +M lines]" paste-collapse placeholder --> <!-- rework cycle 2 (must-fix): matcher semantics become novelty-based — pure helpers that COUNT needle/placeholder occurrences so the handler can compare a pre-paste baseline capture vs the post-paste capture (count increase = echo; fails closed); placeholder counting applies only to multiline text (single-line pastes never collapse) --> in `app/backend/api/chat.go` (e.g. `chatProbeNeedle(text) string` + `captureContainsNeedle(capture, needle) bool`) — last-non-empty-line fragment, whitespace-normalized, length-capped for wrap-safety. <!-- R5 -->

### Phase 4: Backend tests

- [x] T010 Add `app/backend/api/chat_send_test.go`: handler status matrix <!-- rework cycle 1 (done): leading-dash regression --> <!-- rework cycle 2: add (a) stale-echo false-positive regression — a capture already containing a paste-collapse chip / the needle BEFORE the paste must NOT pass (baseline comparison → 409, no Enter); (b) concurrency safety — two interleaved sends never cross texts (mutex or unique-name scheme; run with -race); (c) shared-deadline behavior --> (400 invalid windowId, 400 empty text, 404 no chat, 409 probe failure, 500 fetch error, 200 success) against the `mockTmuxOps` fake; assert injection order (set-buffer → paste-buffer → capture → conditional Enter); assert NO Enter on probe failure; multiline/special-char text passed literally. <!-- R1 R2 R4 R5 R6 -->
- [x] T011 Add pure probe-matcher unit tests (echo present / absent / wrapped-multiline) in `chat_send_test.go`. <!-- R5 --> <!-- rework cycle 1 (done): placeholder cases --> <!-- rework cycle 2: occurrence-counting cases (baseline 1 → post 2 passes; baseline 1 → post 1 fails; single-line text ignores placeholder counts; short needles like "y"/"ok" fail closed against stale content) -->

### Phase 5: Frontend client + ChatView form

- [x] T012 Add `sendChatMessage(server, windowId, text)` to `app/frontend/src/api/client.ts` (POST `/api/windows/{windowId}/chat/send`, `{text}` body, `withServer`+`throwOnError`). <!-- R9 -->
- [x] T013 Replace the disabled footer in `app/frontend/src/components/chat-view.tsx` with a send form: props `onSend(text): Promise<void>` + `busy: boolean`; auto-grow monospace textarea (bounded max-height + internal scroll, placeholder), Enter submits / Shift+Enter newline / house-chip send button; in-flight lock; clear-on-success / keep-on-failure; inline `role="alert"` error; non-blocking busy hint when `busy`; desktop-only autofocus on chat-lens activation (skip on coarse pointers). Remove the `chat-send-disabled` testid; add stable testids for the form/textarea/button/error/busy-hint. <!-- R10 R11 R12 R13 R14 R15 -->
- [x] T014 Wire `AppShell` (`app/frontend/src/app.tsx`) to pass `onSend={(text) => sendChatMessage(server, windowParam, text)}` and `busy={currentWindow?.agentState === "active"}` into `<ChatView>`; do not touch the lens/switcher machinery. <!-- R10 R13 --> <!-- rework cycle 2 (should-fix): key <ChatView> by the window (key={windowParam}) so switching chat-lens windows remounts the form — no draft/stale-error carryover to the new pane, autofocus re-fires; cover with a unit or e2e assertion -->

### Phase 6: Frontend + e2e tests

- [x] T015 Add colocated `app/frontend/src/components/chat-view.test.tsx`: submission semantics (Enter submits / Shift+Enter newline / empty no-op / button click), in-flight lock (no double-send), clear-on-success vs keep-on-failure, inline error render (surfacing the server message), busy-hint gating. <!-- R11 R12 R13 -->
- [x] T016 Extend `app/frontend/tests/e2e/chat-view.spec.ts` <!-- rework cycle 2 (nice-to-have): await the mockChatSend page.route registration (currently `void`-ed) for registration-race hygiene and pattern consistency with mockBackend --> (fully route-mocked; mock `POST **/api/windows/*/chat/send*` with the trailing `*`): typing + Enter fires exactly one POST with the typed body and clears on success; a mocked `409` surfaces the inline error and keeps the text; the busy hint renders when the mocked window `agentState` is `active`. Cover 375px and desktop. Remove/replace the `chat-send-disabled` assertions (read-only regression guard). <!-- R10 R11 R12 R13 R15 R16 -->
- [x] T017 Update the sibling `app/frontend/tests/e2e/chat-view.spec.md` in the same commit (Test Companion Docs) — document the new send tests (what each proves + steps) and drop the disabled-footer references. <!-- R16 -->
- [x] T019 Add a `use-chat-view-shortcut.test.ts` case covering the `.rk-chat-input` exemption (Ctrl+` fires from within the chat textarea; plain textareas still bail). <!-- R11 --> <!-- rework: review should-fix — the new third branch was untested -->
- [x] T020 Add a `sendChatMessage` case to `app/frontend/src/api/client.test.ts` (POST shape + a non-ok response throwing the server's error message), mirroring the sibling `sendKeys` test. <!-- R9 --> <!-- rework: review nice-to-have — pattern symmetry, trivial -->

**Phase 5: Review rework cycle 3 (plan revision — parsimony cleanup + carryover hardening)**

- [x] T021 Delete the zero-call-site context-free tmux wrappers `PasteChatSendBuffer` and `SendEnterToPane` in `app/backend/internal/tmux/tmux.go` (~14 lines) — production goes exclusively through the `*Ctx` variants via `prodTmuxOps` after the shared-deadline refactor; keep `SetChatSendBuffer` only if it still has a real caller (the live round-trip test) — otherwise migrate that test to the Ctx variant and delete it too. Run `go build ./... && go test ./...`. <!-- R8 --> <!-- rework cycle 3 (review must-fix, parsimony zero-call-sites): the ctx refactor superseded these wrappers; the plan lacked a cleanup task -->
- [x] T022 Change the ChatView remount key in `app/frontend/src/app.tsx` to the composite `key={`${server}:${windowParam}`}` — two servers can share a window id (@1↔@1), and the window-only key fails to remount the form across a server switch (draft/stale-error carryover into a different server's pane). Extend the keyed-remount unit test to cover the same-windowId/different-server case. <!-- R13 R14 --> <!-- rework cycle 3 (review should-fix) -->
- [x] T023 Scope the send serialization per pane and extend it across the whole injection (baseline→paste→probe→Enter), e.g. a per-`(server,paneID)` mutex map replacing the global set→paste-only `chatSendMu` — closes the same-pane double-paste window (two rk sends racing the same composer both pasting before either probes ⇒ merged submission), while keeping distinct panes concurrent. Extend the `-race` concurrency test with a same-pane case asserting the second send observes the first's completed sequence. <!-- R4 R5 --> <!-- rework cycle 3 (review should-fix, cascade-corroborated) -->
- [x] T024 Append a retry hint to the 409 probe-failure error message (the pasted text remains in the composer, so an identical retry would paste a second copy and submit doubled text — e.g. "…; the text remains in the agent's input — check the terminal view before retrying"). Update the e2e/unit assertions that match the 409 message. <!-- R5 R6 --> <!-- rework cycle 3 (review nice-to-have — cheap UX guard; full behavior documented at hydrate) -->

### Phase 7: Docs / plan tracking

- [x] T018 Update `fab/plans/sahil/agent-chat-view.md` tracking table: fill row 4 (`chat-send` → `260714-jdyg-chat-send`), correct rows 2–3 to Done with PR links (row 3 = #351; resolve row 2's chat-read-backend PR number from `git log --oneline` on main). Leave row 4 status not-Done (PR merges later). <!-- R16 -->

## Execution Order

- T001 → T005 → T007 (primitives, then interface, then handler).
- T003 → T004 → T007 (pane rollup helper, then seam, then handler).
- T005 → T006 (interface method set must match the mock).
- T007/T008/T009 before T010/T011 (handler before its tests).
- T012 → T013 → T014 (client, then component, then wiring).
- T013 before T015/T016 (form before its tests).
- T016 and T017 in the same commit (constitution: Test Companion Docs).
- T018 is independent (docs).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `POST /api/windows/{windowId}/chat/send` is registered in the chat route family and returns `200 {"ok":true}` on a successful send; `/keys` is unchanged.
- [x] A-002 R2: A malformed windowId, an undecodable body, or empty/whitespace-only `text` returns `400` with no injection.
- [x] A-003 R3: The target pane is resolved server-side by the active-pane-first rollup rule (surfacing `PaneID`); the client supplies no pane/ref; fetch failure → 500, no-chat → 404.
- [x] A-004 R4: Injection runs set-buffer → paste-buffer (`-d -p`) → probe → `send-keys Enter`, all argv slices targeting the `PaneID`, no `agentState` gate, no queue.
- [x] A-005 R5: A successful echo probe sends Enter (200); a failed probe withholds Enter and returns a structured `409`. <!-- MET (rework cycle 2): the probe is now NOVELTY-based — injectChatMessage takes a pre-paste baseline capture and requires the needle/placeholder occurrence COUNT to strictly INCREASE post-paste (fails closed under scroll), and the paste-collapse placeholder is counted only for multiline text. A stale chip or short/common needle already in-frame is a floor to beat, not a false positive. Regression tests TestChatSendStaleEchoNoBlindEnter (stale chip + short "ok" needle → 409, no Enter) and TestCountProbeOccurrences_ShortNeedleFailsClosed pin the guarantee; the multiline placeholder novelty case (TestChatSendMultilinePlaceholderNovelty) still 200s. -->.
- [x] A-006 R7: Injection is provider-agnostic behind a discrete function seam with no v1 provider branch.
- [x] A-007 R8: New pane-targeted tmux primitives exist with timeouts + named constants; `TmuxOps` (prod + mock) carry them and `CapturePane`; `SendKeys` untouched.
- [x] A-008 R9: `sendChatMessage` POSTs the `{text}` body via `withServer`+`throwOnError`, surfacing the server's structured error as the thrown message.
- [x] A-009 R10: `ChatView` is a pure component; the disabled footer is replaced by a send form fed by `AppShell`'s `onSend` + `busy` props; lens/switcher machinery untouched.
- [x] A-010 R11: Enter submits, Shift+Enter inserts a newline, an empty textarea does not submit, and a house-style send button is present.
- [x] A-011 R12: The submit is in-flight-locked (no double-send); text clears on success and is kept on failure; a failed send renders an inline `role="alert"` error with the server message.
- [x] A-012 R13: A non-blocking busy hint renders while `agentState === "active"` and the input stays enabled.
- [x] A-013 R14: The input auto-focuses on chat-lens activation on fine pointers and does not on coarse pointers.
- [x] A-014 R16: The plan tracking table row 4 is filled and rows 2–3 corrected to Done with PR links.

### Behavioral Correctness

- [x] A-015 R4: Text containing tmux key names (e.g. `Enter`, `C-c`), newlines, OR a leading dash (`--force is broken`) is delivered literally (argv element + `--`-terminated bracketed paste), never interpreted as keys/flags or submitted per-line. <!-- MET (rework cycle 1): `SetChatSendBufferCtx` passes `--` before the text; live round-trip test `TestSetChatSendBuffer_LeadingDash` (internal/tmux, now driving the Ctx variant after the cycle-3 parsimony deletion of the context-free wrapper) proves leading-dash text stores verbatim, and `TestChatSendLeadingDashText` (api) proves the handler passes such text through unmangled with a full 200 injection. -->
- [x] A-016 R5: On probe failure the pasted text is left visible in the TUI input box (no blind Enter) and the failure is surfaced, never silent. <!-- REINFORCED (rework cycle 3, T024): the 409 message now names the recoverable state explicitly ("the text remains in the agent's input — check the terminal view before retrying, as a resend would duplicate it") so the surfaced failure also steers the user away from a doubled retry. -->

<!-- rework cycle 3: the Deletion Candidates note re the NEWLY-added dead wrappers `tmux.PasteChatSendBuffer`/`tmux.SendEnterToPane` (+ the context-free `SetChatSendBuffer`) is now RESOLVED — T021 deleted all three; production goes through the `*Ctx` variants via prodTmuxOps, and the live round-trip test drives `SetChatSendBufferCtx`. -->

### Scenario Coverage

- [x] A-017 R1/R2/R4/R5/R6: A Go handler test exercises the full status matrix (400/404/409/500/200), injection order, and no-Enter-on-probe-failure against the `mockTmuxOps` fake.
- [x] A-018 R5: Pure probe-matcher unit tests cover echo present / absent / wrapped-multiline.
- [x] A-019 R10/R11/R12/R13: A colocated `chat-view.test.tsx` covers submission semantics, in-flight lock, clear/keep, inline error, and busy-hint gating.
- [x] A-020 R10/R12/R13/R15: A Playwright e2e (route-mocked, trailing-`*` send POST glob) asserts one POST on Enter + clear-on-success, a 409 inline error + text kept, and the busy hint at `agentState==="active"`, on 375px and desktop; sibling `.spec.md` updated in the same commit.

### Edge Cases & Error Handling

- [x] A-021 R6: Every error path returns the documented status + JSON `writeError` shape and performs no partial/blind Enter.
- [x] A-022 R11: Typing in the textarea does not trigger global chords and the `Ctrl+\`` toggle coexists with input focus.

### Code Quality

- [x] A-023 Pattern consistency: New Go/TS code follows the surrounding chat-read/handler/client patterns (writeError shapes, `withServer`+`throwOnError`, pure-component + AppShell wiring).
- [x] A-024 No unnecessary duplication: The pane-rollup rule lives in one place (`ResolveChatPane`, `rollupChat` delegates); existing `CapturePane`/`withServer` utilities reused, no reimplementation.
- [x] A-025 Security (exec/injection): All subprocess calls use `exec.CommandContext` with argv slices and timeouts; the message text is a discrete argv element (no shell string), never interpolated; `send-keys Enter` is a literal key, gated on the probe.
- [x] A-026 No inline tmux construction: all tmux interaction goes through `internal/tmux/` helpers; the API layer only orchestrates via `TmuxOps`.
- [x] A-027 UI e2e: the UI change ships Playwright e2e coverage on both 375px and desktop viewports with the sibling `.spec.md` companion.

## Notes

- Check items as reviewed: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/api/client.ts:213` (`sendKeys`) — pre-existing zero-production-caller client wrapper for `POST /api/windows/{windowId}/keys` (re-verified at the cycle-3 re-review: only its own `client.test.ts` case references it); chat-send now provides the pane-targeted alternative for the only contemplated UI use. Not made redundant *by* this change (it was already uncalled), and the backend `/keys` endpoint itself stays (possible external callers) — only the frontend wrapper + its test are candidates.

Otherwise: None — this change adds new functionality without making existing code redundant (the `chat-send-disabled` footer it supersedes was removed in place by the change itself; no other symbol lost its last caller). *(The cycle-2 dead wrappers `tmux.PasteChatSendBuffer`/`tmux.SendEnterToPane`/`tmux.SetChatSendBuffer` were DELETED in rework cycle 3 (T021) — verified gone at the cycle-3 re-review: `internal/tmux` carries only the `*Ctx` variants, each with real callers (`prodTmuxOps`; the live round-trip test drives `SetChatSendBufferCtx`), and every other newly added symbol in the diff has call sites.)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Endpoint `POST /api/windows/{windowId}/chat/send?server=` with `{"text"}` body; window-keyed, pane+ref re-resolved server-side per request (client supplies neither) | Intake Assumption 1 (Certain) + Constitution IX + the shipped window-keyed chat route family | S:90 R:75 A:95 D:90 |
| 2 | Certain | Busy policy = allow + probe: no server-side gate, no queue (Constitution II); non-blocking "will be queued" hint while `agentState==="active"` | Intake Assumption 2 (Certain, user-decided) — Claude Code TUI queues typed input natively; probe guards the unsafe cases | S:95 R:70 A:90 D:95 |
| 3 | Confident | Send targets the `PaneID` from the same rollup rule as chat read (active-pane-first, else first chat pane), never the window target | Intake Assumption 3; a window target routes to the active pane (in a split maybe not the agent pane); `rollupChat`/`PaneInfo.PaneID` already exist | S:70 R:75 A:90 D:80 |
| 4 | Confident | Injection = named `set-buffer` (argv) + `paste-buffer -d -p -b <name> -t <pane>` + probed literal `send-keys Enter`; multiline rides bracketed paste | Intake Assumption 4; `tmuxExecServer` has no stdin so `set-buffer` beats `load-buffer -`; `-p` matches the TUI's bracketed paste; named buffer avoids clobbering the user's stack | S:75 R:80 A:80 D:70 |
| 5 | Confident | Probe = tolerant capture-pane echo check (needle = wrap-safe fragment of the last non-empty line; short settle + bounded retry <5s); failure → 409, Enter withheld, text left visible | Intake Assumption 5; plan mandates probe-before-Enter; exact heuristic is agent-decidable; leaving pasted text on failure is recoverable state | S:80 R:70 A:75 D:65 |
| 6 | Confident | Probe primitives (set-buffer/paste-buffer/capture-pane/send-Enter) are `TmuxOps` interface methods; the needle+retry orchestration lives in the handler | Makes the status matrix + probe branches testable against `mockTmuxOps` without a live claude pane; mirrors the existing chat-read fake-driven tests | S:75 R:80 A:85 D:75 |
| 7 | Certain | ChatView stays a pure component — AppShell supplies `onSend` + busy; UX = auto-grow textarea, Enter sends / Shift+Enter newline / visible send button, in-flight lock, clear-on-success keep-on-failure, inline `role="alert"` error, busy hint | Intake Assumption 6 (Certain) — shipped ChatView/AppShell ownership pattern + house form conventions | S:70 R:85 A:85 D:75 |
| 8 | Confident | Desktop-only autofocus of the input on chat-lens activation; no autofocus on coarse pointers | Intake Assumption 7; natural continuation of the switcher flip, trivially reversible, but an unprompted focus change is a UX judgment call | S:40 R:90 A:70 D:55 |
| 9 | Confident | E2E = fully route-mocked Playwright (send POST with trailing-`*` glob) for UI semantics; injection/probe correctness carried by Go unit tests against the `mockTmuxOps` fake | Intake Assumption 8; the shipped chat-view.spec.ts pattern is fully mocked; a live claude pane in e2e is infeasible; the trailing-`*` glob trap is a recorded project lesson | S:65 R:80 A:85 D:75 |
| 10 | Certain | Leave `POST /api/windows/{windowId}/keys` untouched; v1 makes no provider branch (kept behind a small injection seam for Change 5) | Intake Assumptions 9 + 10 — different contract / possible external callers; the seam avoids a later reshape at near-zero cost | S:60 R:80 A:85 D:80 |
| 11 | Confident | Add an exported `sessions.ResolveChatPane(panes)` returning provider/ref/paneID; refactor `rollupChat` to delegate (single source of the active-pane-first rule) | The rule already lives in `rollupChat`; surfacing the paneID via a shared helper keeps it DRY and matches the intake's "extend the resolveWindowChat seam" instruction | S:70 R:80 A:85 D:75 |

11 assumptions (4 certain, 7 confident, 0 tentative).
