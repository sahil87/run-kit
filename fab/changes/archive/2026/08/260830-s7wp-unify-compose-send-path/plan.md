# Plan: Unify the Compose Send Path

**Change**: 260830-s7wp-unify-compose-send-path
**Intake**: `intake.md`

> **In-flight dependency cleared**: PR #773 (`260830-nyvm-mux-send-submit-verification`) is
> MERGED — it is `7882acbc`, the tip this branch is cut from. `inject.SubmitUnverified`, the
> escalating post-Enter observation tail, and the evidence-gated recovery all exist. Build on
> them; add no second recovery mechanism (intake § What Changes item 4).

## Requirements

### Frontend: the compose strip stops choosing a transport

#### R1: `ComposeStrip.send()` makes ONE mechanism-blind call per non-`default` mode
`ComposeStrip.send()` (`app/frontend/src/components/compose-strip.tsx`) SHALL deliver every
terminal-target send through a single call — `sendToWindow(server, windowId, text, mode)` — and
SHALL NOT branch on the text's shape. The `text.includes("\n")` transport test, the
`focused.wsRef.current.send(...)` arm, and every reference to pasting SHALL be deleted from the
component. `classifyComposeEnter` and the `ComposeEnterAction` type are UNCHANGED — the frontend
still owns intent.

The classifier's action maps to the wire mode at the call boundary only:

| `ComposeEnterAction` | condition | wire `mode` |
|----------------------|-----------|-------------|
| `submit` | text non-empty after trim | `submit` |
| `submit` | text empty/whitespace-only | `enter` |
| `insert-line` | (empty returns early) | `insert-line` |
| `insert` | (empty returns early) | `raw` |

Everything below the call is untouched: `finishDeliveredSend` → `pushComposeSentHistory` →
`clearComposeDraft` → `endRecall`, the async-resolution guard that only clears a draft still equal
in BOTH text and attachments, and the selection-broadcast arm (which never reaches this call).

- **GIVEN** a single-line draft `y` and Cmd/Ctrl+Enter
- **WHEN** `send("submit")` runs against an open terminal target
- **THEN** exactly one `sendToWindow("srv", "@1", "y", "submit")` is issued and NOTHING is written
  to `focused.wsRef.current`
- **AND GIVEN** a multi-line draft and plain Enter, **THEN** `sendToWindow(…, "insert-line")` is
  issued (same call, different mode — no shape test anywhere)
- **AND GIVEN** Alt+Enter on any draft, **THEN** `sendToWindow(…, "raw")` is issued
- **AND GIVEN** an empty/whitespace-only composer and the Send button, **THEN**
  `sendToWindow(…, "enter")` is issued with the empty text and the draft is not recorded to history

#### R2: Send is locked while a send is in flight
The strip SHALL hold a single in-flight flag covering BOTH the terminal and selection-broadcast
arms (the existing `selectionSending` state, renamed `sending`). While it is set, `send()` SHALL
early-return without issuing a second request, `canSubmit`/`canInsert` SHALL be false, and the Send
chip SHALL read `Sending…`. The flag SHALL clear in a `finally` on every outcome — success,
failure, and rejection alike.

This — not a short probe budget — is the double-send guard: a second Send during the probe window
is a second paste into the agent's composer.

- **GIVEN** a send whose promise has not settled
- **WHEN** the user presses Cmd/Ctrl+Enter again or clicks Send
- **THEN** no second `sendToWindow` call is made and the chip reads `Sending…`
- **AND GIVEN** the request rejects, **THEN** the flag clears and the next Send is accepted

#### R3: A failed send is VISIBLE and names the recovery
The `console.warn` catch SHALL be replaced by a toast (`useToast`, `app/frontend/src/components/toast.tsx`,
already mounted above the strip at `app/frontend/src/app.tsx`) whose copy is keyed on the failure
kind, never a single generic message. The draft SHALL continue to be kept on every failure
(existing behavior).

| kind | copy must say | action button |
|------|---------------|---------------|
| `probe_failure` (409) | the text is **staged in the pane**, unsent; pressing Send again would duplicate it | `Press Enter in pane` → re-issues the same call with `mode: "enter"` |
| `submit_unverified` (409) | Enter **was** sent; the message may or may not have landed — check the pane before resending | none (a blind Enter could double-submit) |
| anything else (500, network) | the send failed and **nothing was delivered**; retrying is safe | none |

`probe_failure` and `submit_unverified` MUST NOT be collapsed into one message: they give opposite
resend advice.

- **GIVEN** `sendToWindow` rejects with an `ApiError{status: 409, code: "probe_failure"}`
- **WHEN** the catch runs
- **THEN** an error toast appears naming the staged text, carrying a `Press Enter in pane` action,
  and the draft is still in the composer
- **AND GIVEN** `code: "submit_unverified"`, **THEN** the toast copy says Enter was sent and offers
  NO Enter action
- **AND GIVEN** a 500 or a network failure, **THEN** the toast says nothing was delivered
- **AND GIVEN** the user clicks `Press Enter in pane`, **THEN** exactly one
  `sendToWindow(server, windowId, "", "enter")` is issued

#### R4: `sendToWindow` replaces `pasteToWindow` and throws a discriminable error
`app/frontend/src/api/client.ts` SHALL export
`sendToWindow(server, windowId, text, mode: WindowSendMode)` posting
`{ text, mode }` to `/api/windows/{windowId}/send`, and SHALL export
`type WindowSendMode = "submit" | "insert-line" | "raw" | "enter"`. `pasteToWindow` SHALL be
deleted.

`throwOnError` SHALL throw an `ApiError extends Error` carrying `status: number` and
`code?: string` (read from the response body's optional `code` field), keeping `message` exactly as
today so every existing caller is unaffected.

- **GIVEN** a 409 body `{"error":"…","code":"probe_failure"}`
- **WHEN** `throwOnError` runs
- **THEN** it throws an `ApiError` with `status === 409`, `code === "probe_failure"`, and the
  server's `error` string as `message`
- **AND GIVEN** a body with no `code`, **THEN** `code` is `undefined` and `message` is unchanged
- **AND GIVEN** any existing caller catching the throw, **THEN** `err.message` reads exactly as before

### Backend: one intent-shaped route owns the mechanism

#### R5: `POST /api/windows/{windowId}/send` is the single compose door
The backend SHALL expose `POST /api/windows/{windowId}/send?server={server}` (mutation ⇒ POST,
Constitution IX) in a new `app/backend/api/send.go`, with body
`{"text": string, "mode": "submit"|"insert-line"|"raw"|"enter"}`. The handler SHALL own the
strategy switch:

| `mode` | strategy | probe? | Enter? |
|--------|----------|--------|--------|
| `submit` | `inject.Engine.Send(…, submit: true)` | yes | yes, probe-gated |
| `insert-line` | `inject.Engine.Send(…, submit: false)` | yes | no |
| `raw` | `inject.Engine.SendRaw` — unbracketed, LF-preserving paste | no (byte-exactness is the promise) | no |
| `enter` | `inject.Engine.PressEnter` — a single `Enter` key, no text | no | yes |

Validation order: `parseWindowID` → JSON decode → **mode allow-list** → `inject.Sanitize(text)` →
emptiness. An unknown or absent `mode` is `400`. The emptiness check applies to `submit`,
`insert-line`, and `raw` ONLY — `enter` carries no text and SHALL be accepted with an empty body
`text`. Pane resolution (`resolveWindowActivePane`), the single shared
`chatSendTotalBudget` deadline covering the WHOLE route, `404` on a missing window, and `500` on a
`FetchSessions` failure are carried over from the retired `/paste` handler unchanged.

Because all four modes now resolve the target through `resolveWindowActivePane`, there is exactly
ONE derivation of "the window's active pane" for compose delivery (the intake's latent
target-pane inconsistency: the relay WS selected the window once at attach and thereafter wrote to
the attached client's live active pane).

- **GIVEN** `{"text":"hi","mode":"submit"}` on a resolvable window
- **WHEN** the handler runs
- **THEN** `inject.Engine.Send` is called with `submit: true` against the resolved pane and the
  response is `200 {"ok":true}`
- **AND GIVEN** `mode: "insert-line"`, **THEN** `Send` is called with `submit: false`
- **AND GIVEN** `mode: "raw"`, **THEN** `SendRaw` is called and no probe or Enter runs
- **AND GIVEN** `mode: "enter"` with `text: ""`, **THEN** `PressEnter` is called, the emptiness
  check does not fire, and the response is `200`
- **AND GIVEN** a malformed window id, undecodable body, unknown `mode`, or empty-after-sanitize
  text on a text mode, **THEN** the response is `400` and NO tmux subprocess runs
- **AND GIVEN** an absent window, **THEN** `404`; **AND GIVEN** a `FetchSessions` error, **THEN** `500`

#### R6: The 409 outcomes carry a machine-readable `code`
The handler SHALL map `inject.ProbeFailure` → `409` with `code: "probe_failure"` and
`inject.SubmitUnverified` → `409` with `code: "submit_unverified"`, using a new
`writeErrorCode(w, status, code, msg)` helper in `app/backend/api/router.go` that writes
`{"error": msg, "code": code}`. The existing `writeError` SHALL be left untouched, so no other
route's body shape changes. Any other injection error is `500`.

- **GIVEN** the engine returns `inject.ProbeFailure`
- **WHEN** the handler maps it
- **THEN** the response is `409` with body `{"error": "<the sentinel's message>", "code": "probe_failure"}`
- **AND GIVEN** `inject.SubmitUnverified`, **THEN** `409` with `code: "submit_unverified"` and the
  sentinel's distinct message
- **AND GIVEN** a tmux subprocess error, **THEN** `500` (no `code`)

#### R7: `raw` and `enter` are engine primitives, serialized on the same per-pane lock
`app/backend/internal/inject/inject.go` SHALL gain:

- `(*Engine).SendRaw(ctx, t Tmux, server, paneID, text string) error` — takes the per-`(server,paneID)`
  lock, then runs `SetBuffer` → `PasteBufferRaw` inside the engine's `setPasteMu` critical section
  (the named buffer is shared across panes). No baseline capture, no probe, no Enter.
- `(*Engine).PressEnter(ctx, t Tmux, server, paneID string) error` — takes the per-`(server,paneID)`
  lock, then `SendEnter`. No buffer traffic.

The `Tmux` interface SHALL gain `PasteBufferRaw(ctx, name, paneID, server string) error`, wired to
`paste-buffer -d -r -b <name> -t <pane>` — **no `-p`** (unbracketed: the byte-for-byte equivalent
of the retired raw WS write) and **`-r`** (no LF→CR replacement, so an embedded newline stays a
newline). Verified against tmux 3.7c: `paste-buffer -r` delivers `x\ty\n` byte-exact.

Every implementer of `inject.Tmux` SHALL be extended: `chatSendTmux` (`app/backend/api/chat.go`),
`cliInjectTmux` (`app/backend/cmd/rk/mux_send.go`), and the test fakes. `TmuxOps`
(`app/backend/api/router.go`) SHALL gain `PasteChatSendBufferRaw`, implemented by `prodTmuxOps`
over a new `tmux.PasteBufferRawCtx` / `tmux.PasteChatSendBufferRawCtx` pair in
`app/backend/internal/tmux/tmux.go`.

Routing `raw` and `enter` through the engine — rather than calling `TmuxOps` directly from the
handler — is load-bearing: a raw insert that landed inside a concurrent submit's
set→paste→probe→Enter window would change the frame and produce a false `ProbeFailure`, or worse,
interleave on the shared named buffer.

- **GIVEN** `SendRaw` on pane `%1` with text `"a\tb\nc"`
- **WHEN** it runs
- **THEN** the calls are exactly `SetBuffer` then `PasteBufferRaw` on `%1`, with no `CapturePane`
  and no `SendEnter`, and the per-pane lock is held across both
- **AND GIVEN** `PressEnter` on `%1`, **THEN** exactly one `SendEnter` runs and no buffer command does
- **AND GIVEN** a `SendRaw` and a `Send` racing the same pane, **THEN** they serialize (the second
  observes no interleaved buffer traffic)

#### R8: The pre-Enter probe budget widens to ~640ms
`inject.ProbeAttempts` SHALL rise from `3` to `8`, keeping `ProbeSettle` and `ProbeGap` at 80ms.
The probe's wall-clock ceiling becomes `settle + (attempts-1)*gap = 80 + 7*80 = 640ms` (was 240ms).
The doc comment on the timing block SHALL state the new arithmetic and that the ceiling is shared
with #773's post-Enter `SubmitBackoff` tail (~1240ms) under the one 4s `chatSendTotalBudget`.

The budget is a CEILING, not a delay: `probeEcho` returns on the first capture whose occurrence
count beats the baseline, so a normally-landing send still resolves in ~80ms. Only the failure path
pays the ceiling.

- **GIVEN** a pane that echoes the paste on the first capture
- **WHEN** the probe runs
- **THEN** it returns after one settle (~80ms) — the wider budget costs the success path nothing
- **AND GIVEN** a pane that never echoes, **THEN** the probe makes 8 capture attempts before
  returning `ProbeFailure`
- **AND GIVEN** the worst case (640ms probe + the full `SubmitBackoff` tail + bounded recovery),
  **THEN** the whole sequence still completes inside `chatSendTotalBudget` (4s) and the route stays
  under the 5s rule (`fab/project/code-review.md`)

#### R9: The short/common-needle flat-count behavior is pinned by test
Now that single-line text is probed, a short needle (`y`, `ok`) already on screen relies on the
strict-increase rule. `inject_test.go` SHALL pin BOTH arms explicitly: a repaint that adds a fresh
occurrence passes, and a repaint that leaves the count flat (an old occurrence scrolled out as the
new one appeared) returns `ProbeFailure` — no Enter. No further mitigation is added: occurrence
identity is exactly what #773 rejected, and R3's visible, recoverable 409 is the mitigation that
matters.

- **GIVEN** a baseline capture already containing the needle `ok` once
- **WHEN** the post-paste capture also contains it exactly once
- **THEN** the probe fails closed with `ProbeFailure` and no Enter is sent
- **AND GIVEN** the post-paste capture contains it twice, **THEN** the probe passes and Enter is sent

### Non-Goals

- **`POST /api/windows/{windowId}/keys` is untouched** — a window-targeted key-NAME contract with
  possible external callers, deliberately left alone since `260714-jdyg`. It is not a compose door.
- **The relay WebSocket keeps the terminal's real keystrokes** — per-keystroke HTTP is not viable.
  The split is: the WebSocket is for *being a terminal*, the API is for *injecting text*.
- **No engine-side recovery is added** — #773 owns it (baseline-equality-gated re-paste).
- **No post-hoc "unwitnessed send" apparatus** — dropped, not deferred (intake assumption 10):
  unification makes delivery status a synchronous 200-vs-409 on a response the client already awaits.
- **`vis(3)` sanitization on the bracketed submit path is not revisited** — `paste-buffer` without
  `-S` is today's shipped behavior for submit/insert-line and stays as-is.
- **No latency escape hatch for rapid short replies** — the success path is unchanged at ~80ms
  (intake assumption 17).

### Design Decisions

#### The frontend owns intent; the backend owns mechanism
**Decision**: `ComposeStrip` sends `{ text, mode }` to one route and never learns how the mode
becomes bytes. The backend switches on mode: probed bracketed paste for `submit`/`insert-line`,
unbracketed byte-exact paste for `raw`, a bare `Enter` key for `enter`.
**Why**: Intent comes from the user's chord and nothing else knows it, so it is legitimately the
component's. How intent becomes bytes in a pane is substrate knowledge — `compose-strip.tsx`
currently knows that Claude Code collapses newlines in a non-bracketed write, that tmux has named
buffers, and that `paste-buffer -p` brackets conditionally. `rk mux send` already does it right
(hands text to `inject` and lets the engine decide); the frontend was the only client picking the
mechanism itself. The old fork was also keyed on the wrong axis — `text.includes("\n")` made
*whether a send is verified* depend on whether the user happened to press Shift+Enter.
**Rejected**: Re-keying the fork on `mode` *inside* the frontend — it keeps substrate knowledge in a
React component and keeps two transports alive. Keeping `raw` on the WebSocket "because it is
byte-exact" — that is a mechanism argument, and `paste-buffer -r` is byte-exact too.
*Introduced by*: 260830-s7wp-unify-compose-send-path

#### A new `/send` route retires `/paste` rather than generalizing it
**Decision**: Add `POST /api/windows/{windowId}/send` and delete `POST /api/windows/{windowId}/paste`.
**Why**: `/paste` is named after the mechanism this change is removing from the client's vocabulary;
a route carrying a `mode` field while named `paste` would be the same conflation at the URL. The
route count is net-zero (Constitution IV), and `/paste` shipped one day earlier (`260829-iyix`) with
exactly one caller — the SPA is served by the same binary, so there is no version-skew window to
bridge.
**Rejected**: Generalizing `/paste` with a `mode` field — cheaper diff, wrong name, and it would
leave `submit`-vs-`paste` vocabulary drift in the memory and the API spec forever. Keeping both
routes for a deprecation period — no external caller exists, and Constitution IV resists surface.
*Introduced by*: 260830-s7wp-unify-compose-send-path

#### `raw` is an unbracketed `paste-buffer -r`, not `send-keys -l`
**Decision**: Byte-exact raw insert is `set-buffer -b <name> -- <text>` then
`paste-buffer -d -r -b <name> -t <pane>`.
**Why**: It reuses the buffer machinery already proven byte-verbatim here (the `--` terminator makes
leading-dash text safe — verified on tmux 3.6a), it takes the same `setPasteMu`/per-pane locks as
every other injection, and `-r` (no LF→CR replacement) with no `-p` (no bracketing) is exactly the
byte stream the retired raw WS write produced. Verified on tmux 3.7c: `x\ty\n` arrives byte-exact,
tab included.
**Rejected**: `send-keys -l -- <text>` — a second, unlocked door into the pane whose literal-escape
semantics vary across tmux versions, for no benefit.
*Introduced by*: 260830-s7wp-unify-compose-send-path

#### The probe ceiling widens to 640ms, bought with attempts rather than a longer settle
**Decision**: `ProbeAttempts` 3 → 8; `ProbeSettle`/`ProbeGap` stay at 80ms.
**Why**: 240ms does not survive a mid-stream Claude Code repaint, and a false `ProbeFailure` is
precisely the defect this change exists to fix (bias: underwarn). A busy TUI redraws repeatedly, so
sampling more often across a wider window beats one late look. The ceiling costs the success path
nothing — `probeEcho` returns on the first winning capture. 640ms is what fits: the pre-Enter probe
now shares the 4s `chatSendTotalBudget` with #773's ~1240ms post-Enter tail AND a bounded recovery
pass that runs a *second* probe, so a 1–1.5s ceiling would put the worst case over the deadline and
turn a recoverable 409 into a context-cancelled 500.
**Rejected**: The intake's ~1–1.5s target — it does not fit alongside #773's tail plus recovery
under 4s, and the intake itself says the pre-Enter budget yields first when the two do not both fit.
Raising `chatSendTotalBudget` — the 5s route rule (`code-review.md`) leaves no useful headroom.
Lengthening `ProbeSettle` — it would tax every send's success path, which is the one path that is
not broken.
*Introduced by*: 260830-s7wp-unify-compose-send-path

#### The visible 409 distinguishes staged text from an unconfirmed submit
**Decision**: The backend labels its two 409s with a `code`, and the toast renders different copy
and a different affordance for each: `probe_failure` offers `Press Enter in pane`;
`submit_unverified` offers nothing.
**Why**: They give opposite resend advice. `probe_failure` means the paste landed and Enter was
withheld — the correct recovery is Enter in the pane, and a second Send would duplicate the text.
`submit_unverified` means Enter *was* sent and the outcome is unknown — a second Enter could
double-submit. Discriminating on the message string would be fragile; a `code` field is the contract.
**Rejected**: One generic "send failed" toast — it invites the exact double-send loop the silence
already invites. Auto-retrying the Enter on `probe_failure` — the underwarn bias says never act on
doubt; the user presses the button.
*Introduced by*: 260830-s7wp-unify-compose-send-path

### Deprecated Requirements

#### `POST /api/windows/{windowId}/paste`
**Reason**: Replaced by the intent-shaped `POST /api/windows/{windowId}/send`, which owns all four
delivery strategies rather than only the bracketed-paste one.
**Migration**: `sendToWindow(server, windowId, text, "submit"|"insert-line")` is the byte-identical
replacement for `pasteToWindow(server, windowId, text, submit)`. No external callers exist.

#### Multi-line compose sends ride a different transport from single-line sends
**Reason**: The transport fork keyed on `text.includes("\n")` made delivery verification an accident
of content — the same prompt was unverified as one line and verified with a line break. It also
placed substrate knowledge in a React component.
**Migration**: All four modes ride `POST /api/windows/{windowId}/send`. The `260829-iyix` frontend
regression pin (*"single-line + Cmd/Ctrl+Enter → `ws.send(text + "\r")`, `pasteToWindow` not
called"*, `compose-strip.test.tsx:2194`) is **deliberately inverted and rewritten in place**, not
deleted — the spec changed, so the test follows it (Constitution § Test Integrity).

## Tasks

### Phase 1: Backend primitives

- [x] T001 Add `PasteBufferRawCtx(ctx, name, paneID, server)` (`paste-buffer -d -r -b <name> -t <pane>` — no `-p`) and `PasteChatSendBufferRawCtx(ctx, paneID, server)` to `app/backend/internal/tmux/tmux.go`, next to their bracketed siblings, with a doc comment stating why `-r` and no `-p` are the byte-exact pair <!-- R7 --> <!-- rework: the added doc comments must state a constraint the code cannot show, not mirror the sibling one-liner -->
- [x] T002 Extend `inject.Tmux` with `PasteBufferRaw(ctx, name, paneID, server string) error` and add `(*Engine).SendRaw` (per-pane lock → `setPasteMu` → `SetBuffer` → `PasteBufferRaw`, no capture/probe/Enter) and `(*Engine).PressEnter` (per-pane lock → `SendEnter`) in `app/backend/internal/inject/inject.go` <!-- R7 -->
- [x] T003 Wire the new interface method through every implementer: `chatSendTmux` (`app/backend/api/chat.go`), `TmuxOps` + `prodTmuxOps` (`app/backend/api/router.go`, method `PasteChatSendBufferRaw`), and `cliInjectTmux` (`app/backend/cmd/rk/mux_send.go`) <!-- R7 -->
- [x] T004 Raise `inject.ProbeAttempts` from 3 to 8 in `app/backend/internal/inject/inject.go` and rewrite the timing-block doc comment with the new 640ms arithmetic and the shared-budget note (probe ceiling + `SubmitBackoff` tail + bounded recovery under `chatSendTotalBudget`) <!-- R8 -->

### Phase 2: The `/send` route

- [x] T005 Add `writeErrorCode(w, status, code, msg)` to `app/backend/api/router.go` writing `{"error":…,"code":…}`, leaving `writeError` untouched <!-- R6 -->
- [x] T006 Create `app/backend/api/send.go` with `handleWindowSend`: `parseWindowID` → decode `{text, mode}` → mode allow-list (`400` on unknown/absent) → `inject.Sanitize` → emptiness check for `submit`/`insert-line`/`raw` only → shared `chatSendTotalBudget` ctx → `resolveWindowActivePane` → strategy switch per R5; move `resolveWindowActivePane` here from `paste.go` <!-- R5 -->
- [x] T007 Map the engine outcomes in `handleWindowSend`: `inject.ProbeFailure` → `409 code:"probe_failure"`, `inject.SubmitUnverified` → `409 code:"submit_unverified"`, anything else → `500` <!-- R6 -->
- [x] T008 Register `r.Post("/api/windows/{windowId}/send", s.handleWindowSend)` and delete the `/api/windows/{windowId}/paste` registration in `app/backend/api/router.go`; delete `app/backend/api/paste.go` <!-- R5 -->

### Phase 3: Frontend

- [x] T009 In `app/frontend/src/api/client.ts`: add `export type WindowSendMode` and `sendToWindow(server, windowId, text, mode)` posting `{text, mode}` to `/api/windows/{windowId}/send`; delete `pasteToWindow`; add `export class ApiError extends Error` with `status`/`code` and have `throwOnError` throw it (message unchanged) <!-- R4 --> <!-- rework: the sendToWindow JSDoc must state the mode-chooses-mechanism + ApiError code contract, not restate the signature -->
- [x] T010 Rewrite the terminal arm of `ComposeStrip.send()` (`app/frontend/src/components/compose-strip.tsx`) to the single `sendToWindow` call with the R1 action→mode map; delete the `text.includes("\n")` test, the `ws.send(...)` arm, the `wsRef.readyState` guard, and the paste-transport comment block <!-- R1 -->
- [x] T011 Rename `selectionSending` → `sending` and use it for BOTH arms: guard `send()`, gate `canSubmit`/`canInsert`, drive the `Sending…` chip label, and clear it in a `finally` on every path <!-- R2 -->
- [x] T012 Replace the `console.warn` catch with the kind-keyed toast per R3 (`useToast`), including the `Press Enter in pane` action that re-issues `sendToWindow(server, windowId, "", "enter")` <!-- R3 -->

### Phase 4: Tests

- [x] T013 [P] Replace `app/backend/api/paste_test.go` with `app/backend/api/send_test.go`: the four-mode strategy matrix, `enter` with empty text accepted, `400` on bad id / bad JSON / unknown mode / empty-after-sanitize text mode, `404`/`500` pane resolution, and both 409 `code` values <!-- R5 R6 -->
- [x] T014 [P] Extend `app/backend/internal/inject/inject_test.go`: `SendRaw` call sequence + no probe/Enter, `PressEnter` sequence, same-pane serialization, the `ProbeAttempts`-8 capture count on a never-echoing pane, and the R9 short-needle flat-count vs fresh-occurrence pin <!-- R7 R8 R9 -->
- [x] T015 Update `app/frontend/src/components/compose-strip.test.tsx`: replace the `pasteToWindow` mock with `sendToWindow`, invert the `260829-iyix` single-line regression pin in place (`:2194`), add the four-mode matrix incl. empty-submit→`enter`, the in-flight lock, and one toast assertion per failure kind <!-- R1 R2 R3 -->
- [x] T016 [P] Add `ApiError`/`throwOnError` coverage to `app/frontend/src/api/client.test.ts` (status + code parsed, message unchanged, absent `code` tolerated) <!-- R4 -->
- [x] T017 Extend the compose-strip e2e delivery spec (`app/frontend/tests/e2e/compose-strip.spec.ts`) to cover a SINGLE-line submit reaching the pane via `/send`, with the JSDoc **Proves:**/**Steps:** intent block the constitution requires <!-- R1 R5 -->

### Phase 5: Verification

- [x] T018 Run the `fab/project/code-quality.md` gates in order: `just test-backend`, `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, then `just test-e2e "compose-strip"` <!-- R1 R5 -->
- [x] T019 Sweep the diff for comment provenance: no `R#`/`T#`/`A-#`/change-id/PR-number comments in `app/backend/` or `app/frontend/` (src AND tests) — git history owns provenance (`code-quality.md` § Anti-Patterns) <!-- R1 --> <!-- rework: extend the sweep to the narration/sibling-mirroring half of the anti-pattern, not just provenance -->

## Execution Order

- T001 → T002 → T003 (interface method must exist before implementers compile)
- T005, T006, T007 → T008 (route deleted only once its replacement exists)
- T009 → T010 → T011 → T012 (the component compiles against the new client surface)
- Phase 4 tasks follow their subjects; T013/T014/T016 are independent of each other
- T018 and T019 run last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ComposeStrip.send()` contains no `text.includes("\n")` test, no `wsRef.current.send(...)`, and no paste vocabulary; every terminal-target mode reaches one `sendToWindow` call
- [x] A-002 R2: A single `sending` flag guards both send arms, gates `canSubmit`/`canInsert`, drives the `Sending…` label, and clears in a `finally` on success, failure, and rejection
- [x] A-003 R3: Each of the three failure kinds renders distinct toast copy, and only `probe_failure` carries the `Press Enter in pane` action
- [x] A-004 R4: `sendToWindow` + `WindowSendMode` are exported, `pasteToWindow` is gone, and `throwOnError` throws an `ApiError` carrying `status` and `code`
- [x] A-005 R5: `POST /api/windows/{windowId}/send` serves all four modes with the R5 strategy mapping and validation order
- [x] A-006 R6: Both 409 outcomes carry their distinct `code`, written through `writeErrorCode`; `writeError`'s body shape is unchanged
- [x] A-007 R7: `Engine.SendRaw` and `Engine.PressEnter` exist, hold the per-pane lock, and every `inject.Tmux` implementer provides `PasteBufferRaw`
- [x] A-008 R8: `inject.ProbeAttempts` is 8 and the timing doc comment states the 640ms ceiling and the shared budget
- [x] A-009 R9: `inject_test.go` pins both the flat-count failure and the fresh-occurrence pass for a short needle

### Behavioral Correctness

- [x] A-010 R1: A single-line Cmd/Ctrl+Enter submit is delivered by `sendToWindow(…, "submit")` and writes nothing to the websocket — the `260829-iyix` pin is inverted in place, not deleted
- [x] A-011 R1: An empty/whitespace-only Send issues `sendToWindow(…, "enter")` and records no history
- [x] A-012 R5: `raw` performs no probe and sends no Enter; `enter` sends only the Enter key and accepts empty text
- [x] A-013 R8: A send whose paste echoes on the first capture still resolves in ~one settle — the wider ceiling does not slow the success path
- [x] A-014 R5: `/api/windows/{windowId}/paste` no longer exists in the router and `api/paste.go` is deleted, with no dangling references anywhere in `app/`

### Removal Verification

- [x] A-015 R5: A repo-wide sweep for `pasteToWindow`, `handleWindowPaste`, and `/paste` finds no live references in `app/backend/`, `app/frontend/src/`, or `app/frontend/tests/e2e/`
- [x] A-016 R1: No dead transport code remains in `compose-strip.tsx` — the websocket reference in `send()` is gone along with its guard and comments

### Scenario Coverage

- [x] A-017 R5: `send_test.go` exercises the full mode matrix, all `400` arms, `404`, `500`, and both `409` codes
- [x] A-018 R7: `inject_test.go` proves `SendRaw`'s exact call sequence, `PressEnter`'s, and same-pane serialization against a concurrent `Send`
- [x] A-019 R1 R3: `compose-strip.test.tsx` covers the four-mode matrix, the in-flight lock, and one toast assertion per failure kind
- [x] A-020 R1: The e2e spec proves a single-line submit reaches the pane through `/send`, and carries its **Proves:**/**Steps:** JSDoc block

### Edge Cases & Error Handling

- [x] A-021 R5: An unknown or absent `mode` is rejected `400` before any tmux subprocess runs
- [x] A-022 R3: Every failure keeps the draft in the composer and records nothing to sent history
- [x] A-023 R4: A 409 body with no `code` field still throws an `ApiError` whose `message` is the server's `error` string
- [x] A-024 R8: The worst-case sequence (640ms probe + `SubmitBackoff` tail + bounded recovery) completes inside `chatSendTotalBudget` and the route stays under the 5s rule

### Code Quality

- [x] A-025 Pattern consistency: New Go code follows the surrounding handler shape (`parseWindowID` → decode → validate → shared ctx → resolve → inject → map) and the frontend follows the existing client/toast idioms
- [x] A-026 No unnecessary duplication: `resolveWindowActivePane`, `inject.Sanitize`, `chatSendTotalBudget`, and the engine's lock machinery are reused, not reimplemented
- [x] A-027 Process execution: every new tmux call is an `exec.CommandContext` argv slice through `internal/tmux/` — no shell strings, no inline tmux construction (Constitution I, `code-quality.md`)
- [x] A-028 Type narrowing: the frontend discriminates failure kinds with `instanceof ApiError` + field guards, not `as` casts
- [x] A-029 Test coverage: every changed behavior has a test; the `260829-iyix` pin is updated to the new spec rather than removed (Constitution § Test Integrity)
- [x] A-030 Comment discipline: no comment narrates the next line or cites a change ID, PR number, or `R#`/`T#`/`A-#` identifier (`code-quality.md` § Anti-Patterns)
- [x] A-031 Uniform HTTP verb: `/send` is a POST and no `PUT`/`PATCH`/`DELETE` is introduced (Constitution IX)
- [x] A-032 Minimal surface area: the route count is net-zero — `/send` added, `/paste` removed — and no new env var or settings key appears (Constitution IV)
- [x] A-033 Verification gates: `just test-backend`, `npx tsc --noEmit`, `just test-frontend`, and the compose-strip e2e spec all pass

### Security

- [x] A-034 R5: Text still reaches tmux as a discrete argv element via the `--`-terminated named buffer — no shell string, no key-name interpretation, and `inject.Sanitize` still runs before the emptiness check (Constitution I)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the apply diff already removes the superseded `/paste` route, handler, tests, client helper, and compose WebSocket branch; no additional redundant live code remains.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | A new `/send` route retires `/paste` rather than generalizing it | Intake assumption 6 left the shape to the plan. `/paste` names the mechanism the change removes from the client vocabulary, has exactly one caller shipped one day earlier, and the SPA is served by the same binary — no skew window. Route count is net-zero (Constitution IV) | S:90 R:85 A:90 D:85 |
| 2 | Certain | Wire mode vocabulary is `submit`/`insert-line`/`raw`/`enter`; the classifier's `insert` maps to `raw` at the call boundary | The intake fixes this vocabulary verbatim; `raw` is unambiguous next to `insert-line` where `insert` is not. One-line map, `ComposeEnterAction` untouched | S:95 R:90 A:90 D:90 |
| 3 | Certain | `raw` is `paste-buffer -d -r` (unbracketed, LF-preserving), not `send-keys -l` | Verified against tmux 3.7c in-session: `paste-buffer -r` delivers `x\ty\n` byte-exact. Reuses the `--`-terminated named-buffer machinery and the engine's locks; `send-keys -l` would be a second unlocked door with version-varying escape semantics | S:85 R:85 A:90 D:85 |
| 4 | Certain | `raw` and `enter` route through `inject.Engine` (per-pane lock), not straight to `TmuxOps` | A raw insert landing inside a concurrent submit's set→paste→probe→Enter window would change the frame (false `ProbeFailure`) or interleave on the shared named buffer. The engine is where that lock lives | S:90 R:85 A:95 D:90 |
| 5 | Confident | `ProbeAttempts` 3 → 8 (640ms ceiling), not the intake's ~1–1.5s | The pre-Enter probe shares the 4s `chatSendTotalBudget` with #773's ~1240ms post-Enter tail AND a recovery pass that runs a SECOND probe. A 1.2s ceiling puts the worst case near/over the deadline, converting a recoverable 409 into a context-cancelled 500. The intake itself rules that the pre-Enter budget yields first. 640ms is a 2.7× widening that fits; not measured against a live streaming pane (no such pane in this run) | S:75 R:85 A:70 D:70 |
| 6 | Certain | The two 409s are discriminated by a `code` field, not by message-string matching | They give opposite resend advice (intake § What Changes item 4) and message strings are not a contract. `writeErrorCode` is additive — `writeError`'s body shape and every other route are untouched | S:90 R:90 A:90 D:90 |
| 7 | Confident | `throwOnError` throws an `ApiError` subclass rather than a new parallel helper | `message` is preserved exactly, so every existing caller is unaffected while the compose path gains `status`/`code`. A second error path would leave two error vocabularies in one client module | S:80 R:85 A:85 D:80 |
| 8 | Confident | `selectionSending` is renamed to one `sending` flag serving both arms | The selection arm already guards on it and already relabels the chip `Sending…`; extending it to the terminal arm is behavior-identical there and avoids two states for one concept. The terminal arm gains the lock the intake requires | S:80 R:90 A:85 D:80 |
| 9 | Confident | `probe_failure` offers a `Press Enter in pane` action; `submit_unverified` offers none | Underwarn bias: on `probe_failure` the paste landed and Enter was withheld, so Enter is the exact recovery; on `submit_unverified` Enter was already sent and a second one could double-submit, so the user must look at the pane first | S:85 R:85 A:85 D:80 |
| 10 | Confident | Short/common needles get a pinning test and no further mitigation | Occurrence identity is exactly what #773 rejected (a reflow can scroll a stale match out while the live echo survives), and the real mitigation is R3's now-visible, recoverable 409. Resolves intake assumption 16 (Tentative) toward test-only | S:75 R:80 A:80 D:70 |
| 11 | Certain | `POST /api/windows/{windowId}/keys` stays untouched | Window-targeted key NAMES with possible external callers, deliberately preserved since `260714-jdyg`; it is not a compose door and folding it in would change an unrelated contract | S:90 R:90 A:90 D:90 |
| 12 | Certain | The `260829-iyix` single-line regression pin is inverted in place, not deleted | The spec changed, so the test follows it — Constitution § Test Integrity, and the intake names this pin explicitly | S:95 R:90 A:95 D:95 |
| 13 | Confident | `enter` mode accepts empty `text` and skips the emptiness check | It carries no text by construction; rejecting it would break the empty-submit bare-`\r` contract the strip has today and the toast's recovery action, which posts `text: ""` | S:85 R:85 A:85 D:85 |

13 assumptions (8 certain, 5 confident, 0 tentative).
