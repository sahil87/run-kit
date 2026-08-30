# Intake: Unify the Compose Send Path

**Change**: 260830-s7wp-unify-compose-send-path
**Created**: 2026-08-30

## Origin

Conversational, via `/fab-discuss`. The discussion began as a mobile UX question (split out as `260830-4904-mobile-sent-history-recall`) and widened when the user reported a live bug:

> "I was not aware that multi-line and single-line heuristics were so different. This is why I sometimes face an issue when I write multi-line prompts. They somehow never reach Claude successfully. Can we have a single algorithm for both situations? Is paste a problem for single line?"

and then, on the shape of the fix:

> "Is the difference between paste and non paste just the action that the server takes on the tmux session? I am guessing yes, which means a large part of the Enter vs Alt+Enter journey remains the same."

The user approved splitting this from the recall work: *"Breaking into 2 changes is okay (1 separately and 2-5 as the other one)"*.

**IN-FLIGHT DEPENDENCY — PR #773 (`260830-nyvm-mux-send-submit-verification`).** Open draft, mergeable, at ship stage as of this intake. It modifies **the same engine and the same function** this change touches: `internal/inject/inject.go` (+162/−16, in `Engine.Send`) plus `api/paste.go` (+5). **Sequence this change after #773 lands; do not work them in parallel.** Three consequences:

1. **It already solves what was item 4 here (non-doubling recovery)** — and better than either option originally listed. Its recovery re-pastes only after a capture proves the composer is clear, via `stripForProbe` equality against the pre-paste baseline, explicitly *not* occurrence counting (which has neither occurrence identity — a reflow can scroll a stale match out while the live echo survives — nor multi-line coverage, since the needle is only the paste's last line). Item 4 below defers to it rather than duplicating it.
2. **It documents a SECOND failure mode this intake originally missed.** #773's trap is a pane whose `❯` line is stale printed output rather than a live composer: the Enter lands on nothing, the text sits unsent, and **every layer reports success — a 200, not a 409**. It recurred 20+ times in one `fab-fff` run. That is a different mechanism from the invisible-409 path described in Why below, and it produces the identical user-visible symptom. See the matching memory entry `operator-stale-prompt-text-vs-buffer`. #773 adds an `inject.SubmitUnverified` sentinel (deliberately distinct from `ProbeFailure` — the two give opposite resend advice), mapped to 409 on all four daemon consumers including `/paste`.
3. **It consumes budget this change was planning to spend.** #773 adds an escalating post-Enter observation tail (`40/80/160/320/640ms` ≈ 1240ms worst case, early-exit on any frame change) *without* raising `chatSendTotalBudget` (4s) or `muxCmdTimeout` (5s). Any widening of the PRE-Enter `probeEcho` budget here must fit alongside that tail, not ignore it — see Open Questions.

Note also that #773 reached the same underwarn conclusion independently: its stated Known Limitation is that a busy pane which swallows an Enter stays undetected *by design*, because detecting it would 409 every chat send to a working agent.

**Direct predecessor.** `260829-iyix-compose-multiline-bracketed-paste` shipped 2026-08-29 — one day before this intake. It built `POST /api/windows/{windowId}/paste` and routed **multi-line** submit / insert-line through `inject.Engine.Send`, deliberately scoping single-line, bare-`\r`, and Alt+Enter raw insert to stay on the WebSocket path (its Certain assumption #2: *"keeps typing latency and byte-exact semantics untouched"*). That was a reasonable call with the information available. This change revisits it with new evidence.

**Key decisions from the discussion:**

- The current fork is on the **wrong axis**. `text.includes("\n")` decides which transport is used, so whether a send is *verified* depends on whether the user happened to press Shift+Enter while composing. The same prompt is unverified as one line and verified with a line break. That is an accident of content, not a design.
- The fork is also in the **wrong layer** — the decisive point, raised by the user after reviewing the control-flow diagram:

  > "I think the front-end should just be sending the text, not worrying about how the text was, what the backend is supposed to be doing to enter the text. Whether it's a paste or not seems like a backend decision, right? Why is the front end deciding for the back end?"

  Correct. `compose-strip.tsx` currently knows that Claude Code collapses newlines in a non-bracketed write, that tmux has named buffers, and that `paste-buffer -p` brackets conditionally. That is substrate knowledge in a React component. The proof it does not belong there: **`rk mux send` already does it right** — the CLI hands text to `inject` and lets the engine decide. The frontend is the only client picking the mechanism itself.
- **The line: the frontend owns INTENT, the backend owns MECHANISM.** Intent (`submit` / `insert-line` / raw / bare-Enter) comes from the user's chord and nothing else knows it, so it is legitimately the frontend's. How that intent becomes bytes in a pane is not. The current design conflates the two.
- Therefore the fork does not move from content to intent *within the frontend* (this intake's first draft) — it **leaves the frontend entirely**. The frontend makes one call carrying `{ text, mode }`; the backend switches on mode.
- The user's multi-line failures have TWO candidate mechanisms, not one: the invisible 409 traced in Why below, and PR #773's stale-prompt trap where Enter lands on nothing and the stack reports 200. Both give the identical symptom. This intake originally asserted the first with confidence; that was premature — see the #773 note above.
- Unifying makes delivery status a **synchronous 200-vs-409** on a response the client already awaits. A separately-considered post-hoc "unwitnessed send" probe (client-side timer, `bufferedAmount` gating, a server-side retry endpoint, a history-schema migration for marks) was designed in detail during the discussion and then **dropped entirely** — unification dissolves it into machinery that already exists.
- Where a delivery-confidence signal is still ambiguous, the agreed bias is **underwarn**: never mark a send as failed on doubt. Silence is the current behavior, so a missed mark costs nothing new, while a false mark costs trust in the affordance and invites double-sends.

## Why

**The reported problem.** Multi-line prompts "never reach Claude." The mechanism, traced during the discussion:

1. `inject.Engine.Send` (`inject.go:162`) runs baseline capture → `setAndPaste` → `probeEcho` → gated `SendEnter`. **`setAndPaste` runs before the probe** — so on probe failure the text has *already been pasted into the pane's composer*; only the Enter is withheld.
2. `handleWindowPaste` maps `inject.ProbeFailure` to **409** (`paste.go:74`).
3. `pasteToWindow` surfaces it via `throwOnError` — and `ComposeStrip`'s handler is:
   ```js
   .catch((err: unknown) => { console.warn("compose paste failed; draft kept", err); });
   ```
   **A `console.warn`. No toast, no marker, nothing user-visible.**

So from the user's seat: press Send → nothing appears to happen → the text is still in the compose box (the draft is deliberately kept) → press Send again → a **second copy** is pasted into Claude's composer. Either it eventually submits doubled, or it sits staged forever while the user gives up.

**Why the probe fails at all.** Its budget is `ProbeSettle` 80ms + `ProbeAttempts` 3 = **240ms worst case** (`inject.go:38-44`). Against a Claude Code that is mid-stream and repainting, that is far too tight — and it fails *closed* by design ("If the pane scrolls between baseline and probe the count cannot rise, so it fails CLOSED"). A correctly-delivered paste is therefore routinely reported as a failure.

**The consequence if unfixed.** The user keeps hitting a bug whose only symptom is silence, and whose natural response (press Send again) actively makes it worse by duplicating text into the agent's input. Before `iyix` the multi-line failure mode was *collapsed newlines*; after it, the failure mode is *silently staged text*. The trade is not obviously better until the 409 is visible.

**Why unify rather than patch.** Half the sends already use the verified transport. The inconsistency is itself the defect: unifying is not adding a mechanism, it is deleting the second one. It also removes the need for any post-hoc verification apparatus, because the answer arrives synchronously in a response the client already handles.

## What Changes

### 1. Surface the 409 (independently shippable — do this first)

Replace the `console.warn` catch in `ComposeStrip.send()` (`compose-strip.tsx`, the `pasteToWindow(...).catch(...)` arm, ~`:530`) with a user-visible signal.

- The message must say the text is **staged in the pane**, not merely that the send failed. The distinction is the whole point: the bytes are in Claude's composer, and the correct next action is to press Enter in the pane (or clear it there) — **not** to press Send again.
- Distinguish a `ProbeFailure` 409 from a 500/network error. A 500 means nothing landed; a 409 means the text landed but was not submitted. They warrant different copy and different recovery.
- The draft continues to be kept on failure (existing behavior, correct).
- Use the repo's existing toast/notification surface; do not invent one.
- **Lock Send while a send is in flight.** This is the real double-send guard — not a short probe budget. Today nothing stops a second Send during the probe window, and a second Send is a second paste. With the button locked, the probe ceiling can be generous without reopening the doubling hazard. Required regardless of what the budget lands on.

### 2. Move the delivery decision to the backend

**Not** a re-keyed fork inside `send()` — the fork leaves the frontend.

**Frontend.** `ComposeStrip.send()` (`compose-strip.tsx:443`) collapses to one call for every non-`default` mode:

```js
sendToWindow(server, windowId, text, mode)   // mode: "submit" | "insert-line" | "raw" | "enter"
```

Delete from the component: the `text.includes("\n")` test, the `focused.wsRef.current.send(...)` arm, and every reference to pasting. `classifyComposeEnter` still produces the mode — that is the frontend's job and does not move. Everything below the call (`finishDeliveredSend` → `pushComposeSentHistory` → `clearComposeDraft` → `endRecall`) is untouched.

**Backend.** One route owns the strategy switch:

```
POST /api/windows/{windowId}/send   { text, mode }
```

| mode | strategy | probe? |
|------|----------|--------|
| `raw` | literal byte-exact write | no — byte-exactness is the promise |
| `enter` | `SendKeys` Enter, no text | no |
| `submit` | `inject.Engine.Send(submit: true)` | yes |
| `insert-line` | `inject.Engine.Send(submit: false)` | yes |

**Both primitives already exist server-side** — `POST /api/windows/{windowId}/keys` (window-targeted `SendKeys`, `router.go:760`) and `POST /api/windows/{windowId}/paste` (the inject engine). This consolidates two existing doors behind one intent-shaped route rather than building a new mechanism. Apply may either add `/send` and retire the two, or generalize `/paste` — the decision belongs in the plan, but the *frontend contract* is fixed: one call, mode-carrying, mechanism-blind.

The empty bare-`\r` carve-out survives as a mode (`enter`) rather than as a transport special-case — the frontend still never learns why.

**Latent bug this closes.** The two doors resolve their target pane differently: the WS writes to whatever pane the *attached client* has active, while `/paste` resolves the window's active pane via `FetchSessions` (`resolveWindowActivePane`). Two derivations of "the active pane", computed at different moments, which can drift. One backend door means one targeting rule.

**Scope boundary.** The terminal's real keystrokes stay on the relay WebSocket — you cannot POST per keystroke. Only the compose box moves off it. The resulting split is clean: **the WebSocket is for being a terminal; the API is for injecting text.** The compose box was only ever on the WS because the socket happened to be open.

### 3. Widen the probe budget

`ProbeSettle` / `ProbeGap` / `ProbeAttempts` (`inject.go:38-44`) are package vars specifically so tests can shrink them. 240ms does not survive a streaming agent.

- Raise the retry budget materially (the whole sequence is already bounded by `chatSendTotalBudget` = 4s, and the route must stay under the 5s rule in `code-review.md`).
- Prefer more attempts over a longer single settle — a busy TUI redraws repeatedly, so sampling more often within a wider window beats one late look.
- **This now applies to every submit, not just multi-line**, so the latency budget matters more than it did under `iyix`. Measure before choosing values.

### 4. Non-doubling recovery — DEFERRED TO PR #773

**Do not implement engine-side recovery here.** PR #773 solves it: recovery re-pastes only after a capture proves the composer is clear (baseline equality via `stripForProbe`), and fails closed — a genuinely submitted message sits in the transcript, so the frame can never match the baseline and recovery aborts rather than re-sending. Build on that; do not add a second mechanism.

What remains in scope here is the **client-side** half:

- The 409 response reports that the text is staged, and the client offers "press Enter in the pane" — which after unification is **one more call to the same route with `mode: "enter"`**, not a special-case transport. Recovery reuses the normal path.
- The client must distinguish #773's `SubmitUnverified` 409 from a `ProbeFailure` 409. They arrive on the same status code and give **opposite resend advice**: `ProbeFailure` means the paste may not have landed, `SubmitUnverified` means it landed and was not submitted. Do not collapse them into one message.

### 5. Single-line hazards to handle

Newly relevant now that short single-line text is routed to a probed strategy:

- **Short/common needles.** Under `CollapseMinRunes` (200) `collapsible` is false → exact-needle-only matching (`inject.go:175`). A `y` or `ok` is likely already on screen; the strict-increase rule usually saves it, but a repaint that drops an old occurrence while adding the new one leaves the count flat → **false ProbeFailure** on exactly the short replies mobile users fire most. Needs a test and likely a mitigation.
- **Serialization.** Rapid-fire sends to one pane now queue behind the per-pane mutex (`lockFor`, `inject.go:122`). Correct, but each waits for the previous full sequence.
- **Latency.** WS is one RTT with no server-side work; paste is a POST plus ~80–240ms of probe. Acceptable for verified delivery, but it is a real regression in feel for quick replies and should be measured, not assumed.
- Bracketed paste itself is **not** a hazard for single-line: `paste-buffer -p` brackets only when the app requested it, and zsh stages rather than executes, then the gated Enter submits. Same outcome.

## Affected Memory

- `run-kit/ui/compose-and-bottom-bar`: (modify) § Docked Compose Strip — rewrite the send-path paragraphs `iyix` just wrote: the fork is now mode-keyed, not newline-keyed; add a Design Decision for fork-on-intent-not-content and one for the visible 409 / staged-text recovery contract
- `run-kit/chat`: (modify) § Send Path — the inject engine's probe timing constants changed and its HTTP consumer set widened to all non-raw compose submits
- `run-kit/api-and-sockets`: (modify) the `/paste` route row — no longer multi-line-only

## Impact

- `app/frontend/src/components/compose-strip.tsx` — `send()` (`:443`) fork condition and the `.catch` arm. **Note**: `260830-4904` also touches this file, in the chip/render region (~`:1000+`). Different regions; whoever lands second rebases.
- `app/backend/internal/inject/inject.go` — probe timing constants; possibly retry idempotency.
- `app/backend/api/paste.go` — possibly a richer 409 body distinguishing staged-text from other failures.
- `app/frontend/src/api/client.ts` — `pasteToWindow` error shape if the 409 body changes.
- Toast/notification surface for the visible failure.
- Tests: `paste_test.go` and `inject_test.go` (probe timing, short-needle behavior, retry idempotency); `compose-strip.test.tsx` for the new fork matrix — **including the existing regression pin** at `iyix`'s frontend test 4 (*"single-line + Cmd/Ctrl+Enter → `ws.send(text + "\r")`, `pasteToWindow` not called"*), which this change **deliberately inverts** and must update rather than delete; `client.test.ts` if the error shape moves. e2e: the multi-line delivery spec `iyix` added should be extended to a single-line case.
- **Constitution check**: `/paste` remains a POST (Principle IX). No new env vars (settings-home rule). Per Test Integrity, the `iyix` regression pin is updated because the *spec* changed — not to accommodate the implementation.

## Open Questions

- What probe budget actually survives a streaming Claude Code? Needs measurement against a live busy pane, not a guess. Must stay inside `chatSendTotalBudget` (4s) and the 5s route rule.

  **User guidance (offered as a starting point, explicitly not a decided number):** *"This is all on the same machine - no network latency. So maybe in case of no guidance, the max we should wait before assuming error is probably around 1/2 a second."*

  Three things frame that number:

  1. **The budget is a CEILING, not a delay.** `probeEcho` returns on the first successful capture, so a normally-landing send resolves in ~80ms (`ProbeSettle` + one capture) regardless of the ceiling. Raising it costs nothing on the success path — only on the failure path. Do not treat a wider budget as added latency per send.
  2. **Local execution does not shrink it much.** The probe waits on the TUI's *repaint*, not on transport. `capture-pane` is a few ms locally; a mid-stream Claude Code that has not yet yielded is the dominant variable.
  3. **Underwarn pulls the ceiling longer.** A false 409 is precisely the defect this change exists to fix, so err toward waiting rather than toward reporting failure. ~500ms is the right answer to "how long before the UI must say something"; it is likely too short for "how long before we conclude the paste never landed."

  Suggested shape to measure against: keep `ProbeSettle` short (~80ms) so the common case stays instant, and buy the extra room with **more attempts rather than a longer first wait** — a busy TUI redraws repeatedly, so more samples across a wider window beats one late look. That lands the ceiling near 1–1.5s. Measure before fixing the values.

  **Budget now shared with PR #773.** #773 adds a post-Enter observation tail of ~1240ms worst case (`40/80/160/320/640ms`, early-exit) without raising `chatSendTotalBudget` (4s). A pre-Enter probe widened to ~1.5s plus that tail plus 4-6 tmux subprocess spawns leaves little headroom under 4s and the 5s route rule. Measure the two phases TOGETHER against a busy pane; if they do not both fit, the pre-Enter budget yields first (#773 detects the harder failure).
- Is a false ProbeFailure on short/common needles frequent enough in practice to need a mitigation beyond the strict-increase rule, or is a test pinning the behavior sufficient?
- Does the added per-send latency change how the compose box feels for rapid `y`/`1`/`continue` replies enough to warrant an escape hatch? (No escape hatch is proposed; flagging because it reverses `iyix`'s stated rationale.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The invisible 409 is A cause of the reported multi-line failure — not established as THE cause | Traced in-session: `setAndPaste` precedes `probeEcho`, so the text is already pasted and the client only `console.warn`s. Downgraded from Certain after PR #773 surfaced a competing mechanism (stale prompt line, Enter lands on nothing, stack reports 200) with the identical symptom. Both are real; which one the user hit is unestablished | S:80 R:85 A:85 D:70 |
| 2 | Certain | Surfacing the 409 is item one and is independently shippable | User agreed to ship it ahead of the rest; it is near-trivial and stops the double-send loop on its own | S:95 R:95 A:95 D:95 |
| 3 | Certain | The failure message must say the text is STAGED IN THE PANE, not just "send failed" | The correct recovery is Enter in the pane, not a second Send — the current silence actively invites duplication | S:95 R:90 A:90 D:95 |
| 4 | Certain | The delivery decision moves OUT of the frontend to the backend, not merely onto a different frontend key | User's call on reviewing the control-flow diagram: mechanism is substrate knowledge. `rk mux send` already does it right; the frontend is the odd client out | S:95 R:80 A:90 D:95 |
| 5 | Certain | The frontend owns intent (mode), the backend owns mechanism | Intent comes from the user's chord and nothing else knows it; how it becomes bytes in a pane is not the component's business | S:95 R:85 A:95 D:95 |
| 6 | Certain | The frontend contract is one mode-carrying call; whether that is a new `/send` or a generalized `/paste` is a plan decision | Both primitives already exist (`/keys` `router.go:760`, `/paste`); the consolidation shape is an implementation choice, the mechanism-blind frontend is not | S:90 R:85 A:85 D:85 |
| 7 | Certain | Byte-exact raw and the bare `\r` survive as MODES, not as transport special-cases | Preserves both promises while keeping the frontend from learning why they differ | S:90 R:90 A:90 D:90 |
| 8 | Certain | The terminal's real keystrokes stay on the relay WebSocket | Per-keystroke HTTP is not viable; the split is "WS = be a terminal, API = inject text" | S:95 R:95 A:95 D:95 |
| 9 | Confident | Unifying also closes a latent target-pane inconsistency | The WS path never calls a resolve — it selects the window ONCE at attach (`SelectWindowInSession`, `terminals_ws.go:496`) and thereafter tmux routes each write to the attached client's live active pane. `/paste` instead resolves per request from a `FetchSessions` snapshot (`resolveWindowActivePane`). Two authorities computing "the active pane" at two different moments; they can drift. Do not go looking for a resolve call on the WS path — there is none | S:80 R:80 A:80 D:75 |
| 10 | Certain | The post-hoc "unwitnessed send" probe is dropped, not deferred | Unification makes delivery status synchronous (200 vs 409); the whole apparatus — client timer, `bufferedAmount` gate, retry endpoint, history-schema migration — becomes redundant | S:90 R:85 A:90 D:90 |
| 11 | Certain | Where delivery confidence is ambiguous, bias to underwarn | User chose this explicitly; silence is today's behavior so a missed mark costs nothing new, a false mark costs trust | S:95 R:90 A:90 D:95 |
| 12 | Certain | This reverses `iyix` Certain assumption #2, knowingly | New evidence: the user is hitting the failure, and the content-keyed fork is the deeper defect. Must be stated in the plan, not slipped in | S:90 R:80 A:90 D:95 |
| 13 | Confident | 240ms is too tight for a streaming agent and must widen; the budget is a CEILING, so a wider one costs nothing on the success path | Success exits on the first good capture (~80ms) regardless of ceiling; retries run only when failing. User offered ~500ms as a starting point, explicitly as guidance — underwarn argues longer (~1-1.5s). Measure against a busy pane | S:85 R:85 A:80 D:70 |
| 14 | Confident | Retry-after-failure must not re-paste; prefer a bare `\r` recovery over engine changes | Keeps the shared engine untouched and matches "the text is already staged" | S:80 R:80 A:80 D:75 |
| 15 | Confident | Bracketed paste is not itself a hazard for single-line text | `paste-buffer -p` brackets only on request; zsh stages then the gated Enter submits — same outcome | S:85 R:85 A:85 D:80 |
| 16 | Tentative | Short/common needles need a mitigation beyond the existing strict-increase rule | A flat count across a repaint is plausible but unquantified; may need only a pinning test | S:60 R:75 A:65 D:55 |
| 17 | Confident | Added per-send latency is acceptable without an escape hatch | Initially graded Tentative on the assumption that every send paid the full probe budget. It does not — success returns in ~80ms; only failing sends pay the ceiling. `iyix`'s latency rationale is answered rather than overridden | S:80 R:80 A:80 D:75 |

17 assumptions (11 certain, 5 confident, 1 tentative, 0 unresolved).
