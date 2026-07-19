# Intake: Pointer-Aware Enter Semantics + Insert-Without-Submit

**Change**: 260719-mxvw-pointer-aware-enter-insert-mode
**Created**: 2026-07-19

## Origin

Created by `/fab-proceed` (promptless create-intake dispatch) from a live design conversation. The conversation examined run-kit's two text-input surfaces, verified their current send paths in code, and settled the interaction model. Synthesized input:

> Pointer-aware Enter semantics + insert-without-submit for run-kit's two text-input surfaces (compose strip + chat send form). Fine pointer: Enter = submit, Shift+Enter = newline (unchanged). Coarse pointer: Enter = insert newline; submit via the Send button. Cmd/Ctrl+Enter = submit always, on both surfaces, all devices. `enterkeyhint` must state the truth on both textareas. Add an insert-without-submit mode: compose strip sends bytes without the trailing `\r`; chat send gains an additive optional `submit` boolean (default `true`) that skips the final `send-keys Enter`. The two surfaces must not diverge. Slash-command/skill autocomplete is explicitly out of scope.

Decisions 1–5 below (§ What Changes) were agreed by the user in conversation; the exact insert-only affordance was recommended but not finally pinned (recorded as a Confident assumption, row 5).

## Why

1. **Mobile keyboards cannot express Shift+Enter.** Both surfaces today hard-wire Enter = submit / Shift+Enter = newline. On a touch keyboard there is no Shift+Enter, so a coarse-pointer user physically cannot compose a multiline message — every Enter fires the message at a live agent. An accidental submit to an agent is worse than reaching for the Send button, and the messaging-app convention (WhatsApp/Slack/Telegram/Claude mobile) is Enter = newline on touch with an explicit send button.
2. **`enterkeyhint` currently lies by omission.** Neither textarea sets it, so mobile keyboards show a generic Enter key while Enter actually submits. Once Enter's meaning becomes pointer-dependent, the hint must track it or the keyboard advertises the wrong action.
3. **There is no way to stage text without submitting.** The pre-strip modal ComposeBuffer sent raw-insert (no `\r`); change `260718-dhdj` (docked compose strip) deliberately flipped to always-submit (`compose-strip.tsx` ~line 222: `ws.send(text + "\r")` — the trailing `\r` IS the Enter press). Users lost the "type into the agent's input box but don't press Enter yet" capability — useful for pre-loading a prompt, appending to a queued steer, or leaving text for a human to finish. The chat send path likewise always sends the gated Enter (step 5 of `injectChatMessage`).
4. **If we don't fix it**: touch users keep firing premature messages at agents, the keyboard hint stays wrong, and the only insert-without-submit path is dropping to the raw terminal.

Approach over alternatives: keying on `(pointer: coarse)` (not viewport width) was chosen explicitly — a narrow desktop window still has a hardware keyboard, and a tablet with a hardware keyboard still gets the Cmd/Ctrl+Enter escape hatch. Cmd/Ctrl+Enter as the universal submit avoids inventing a new convention and works on every device class.

## What Changes

Two surfaces, verified current state:

- **Compose strip** — `app/frontend/src/components/compose-strip.tsx`. `send()` does `ws.send(text + "\r")` over the terminal-relay WebSocket (~line 222); `onKeyDown` (~line 232) submits on `Enter && !shiftKey && !isComposing`, `preventDefault` + `stopPropagation`. Empty/whitespace no-op; draft preserved when WS not open; Send button has `coarse:min-h-[36px]`.
- **Chat send form** — `ChatSendForm` in `app/frontend/src/components/chat-view.tsx` (~lines 149–257). Same Enter/Shift+Enter/IME contract (~line 204); `submit()` calls `onSend(text)` → `sendChatMessage(server, windowId, text)` (`src/api/client.ts` ~line 240) → `POST /api/windows/{windowId}/chat/send` with body `{ text }`. Backend `app/backend/api/chat.go`: `chatSendRequest{ Text string }`; `injectChatMessage` runs baseline capture → set-buffer → paste-buffer → novelty echo probe → `SendEnterToPane` (Enter is a discrete, probe-gated final step; probe failure withholds Enter and returns structured 409). Already skips autofocus on `(pointer: coarse)`.

### 1. Pointer-aware Enter (both surfaces)

Enter behavior keyed on the **pointer type** — `window.matchMedia("(pointer: coarse)")` — NOT viewport width (explicitly not the shared narrow-width-OR-coarse `isMobileViewport()` rule):

- **Fine pointer (desktop)**: Enter = submit, Shift+Enter = newline — unchanged.
- **Coarse pointer (touch)**: Enter = insert newline (do not intercept — the textarea default); submit via the existing Send button.

The IME-composition guard (`!e.nativeEvent.isComposing`) and the empty/whitespace-only no-op apply unchanged. Detection should be live (a `matchMedia` change listener shared by the keydown policy and the `enterkeyhint` render), so plugging in a mouse/keyboard mid-session updates behavior and hint together.

### 2. Cmd/Ctrl+Enter = submit — universal

On **both** surfaces, **all** devices, all pointer types: `(metaKey || ctrlKey) + Enter` submits. This is the escape hatch for a hardware keyboard on a touch device (coarse pointer + real modifier). Shift+Enter = newline always.

### 3. Truthful `enterkeyhint`

Both textareas set `enterkeyhint` to match what Enter actually does: `enterkeyhint="send"` when Enter submits (fine pointer); `enterkeyhint="enter"` (the default action) when Enter inserts a newline (coarse pointer). Neither textarea sets it today.

### 4. Insert-without-submit mode

A secondary "send to the pane's input box WITHOUT pressing Enter" action on both surfaces; submit stays the default:

- **Compose strip**: insert-only sends the text bytes with **no trailing `\r`** — re-adding the old modal ComposeBuffer's raw-insert as a secondary affordance. Same delivery guards (open WS, non-empty text) and same clear-on-delivery as submit.
- **Chat send**: additive optional `submit` boolean on the POST body — `{ "text": "...", "submit": false }`, default `true` (absent field ⇒ current behavior; older clients unaffected). `submit: false` skips ONLY injection step 5 (`SendEnterToPane`); the named-buffer paste, control-byte sanitization, novelty echo probe (probe failure still 409s), per-pane send lock, and the single `chatSendTotalBudget` deadline are all unchanged. `sendChatMessage` in `client.ts` grows the corresponding parameter.
- **Affordance** (recommended in conversation, not finally pinned — see Assumptions row 5): **Alt+Enter** chord (Cmd/Ctrl+Enter is taken by universal submit) plus a secondary **"Insert" button** next to "Send" on both surfaces — touch users have no modifier, and Constitution V requires every action keyboard-reachable on desktop (the chord satisfies it; new shortcuts must be documented in the command-palette registration per code-review policy, or exempted with rationale in the plan).

### 5. Consistency requirement

The two surfaces deliberately mirror each other's interaction model. Enter/Shift+Enter/Cmd+Enter/Alt+Enter semantics and the `enterkeyhint` policy MUST NOT diverge between the compose strip and the chat send form (a shared hook/helper is the natural shape — plan decides).

### 6. Out of scope (user's explicit call)

- Slash-command/skill autocomplete or suggestions in the compose box.
- Multiline raw-bytes caveat (acknowledged in conversation, **no change requested**): embedded `\n` sent as raw bytes to a plain shell pane executes per line; Claude Code treats it as newline insert. Insert-only is only truly Enter-free for single-line text on non-TUI panes. Document, don't guard.

## Affected Memory

- `run-kit/chat`: (modify) Send Path — the `submit` boolean on `POST .../chat/send` (default true; `false` skips the gated Enter, probe semantics unchanged), and ChatSendForm's pointer-aware Enter/Cmd+Enter/Alt+Enter/`enterkeyhint` contract
- `run-kit/ui-patterns`: (modify) Docked Compose Strip section — pointer-aware Enter policy, universal Cmd/Ctrl+Enter, insert-only (no-`\r`) send, Insert button, truthful `enterkeyhint`, shared cross-surface interaction model

## Impact

- **Frontend**: `app/frontend/src/components/compose-strip.tsx` + `compose-strip.test.tsx`; `app/frontend/src/components/chat-view.tsx` + `chat-view.test.tsx`; `app/frontend/src/api/client.ts` (`sendChatMessage` gains the submit flag); possibly a small shared coarse-pointer/Enter-policy hook (new file + colocated test).
- **Backend**: `app/backend/api/chat.go` (`chatSendRequest` gains `Submit *bool`/defaulted field; `injectChatMessage` or its caller gates step 5) + `chat_send_test.go` / `chat_test.go`.
- **E2E**: `app/frontend/tests/e2e/compose-strip.spec.ts` and `chat-view.spec.ts` (+ their **`.spec.md` companions in the same commit** — constitutional requirement). Coarse-pointer Enter behavior is primarily unit-tested (jsdom `matchMedia` mock); e2e covers fine-pointer semantics + the Insert affordance.
- **No route changes, no new endpoints** (existing POST body extended — Constitution IX satisfied), no DB, no tmux-layer changes beyond skipping an existing step.

## Open Questions

- None blocking. The one user-unpinned point (the exact insert-only affordance) is recorded as Confident assumption 5 — review via `/fab-clarify` if a different affordance is preferred.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Enter behavior keyed on `(pointer: coarse)` pointer type, not viewport width: fine ⇒ Enter submits / Shift+Enter newline; coarse ⇒ Enter inserts newline, Send button submits | Discussed — user chose pointer-type keying over width; matches messaging-app convention; accidental agent submit is the costlier error | S:90 R:80 A:90 D:90 |
| 2 | Certain | Cmd/Ctrl+Enter = submit always, both surfaces, all devices; Shift+Enter = newline always | Discussed — user agreed; universal escape hatch covering hardware keyboard on a tablet | S:90 R:85 A:90 D:95 |
| 3 | Certain | `enterkeyhint="send"` when Enter submits (fine pointer), `enterkeyhint="enter"` when Enter inserts (coarse pointer), on both textareas | Discussed — user required the hint to state the truth; neither textarea sets it today | S:85 R:95 A:90 D:90 |
| 4 | Certain | Insert-only semantics: compose strip sends bytes without trailing `\r`; chat send gains additive optional `submit` boolean (default `true`), `submit:false` skips only the final `send-keys Enter` — paste, sanitize, echo probe (409 on failure), locks, budget unchanged | Discussed — user specified both halves, including default and probe retention | S:90 R:75 A:85 D:90 |
| 5 | Confident | Insert-only affordance = Alt+Enter chord + an always-visible secondary "Insert" button next to "Send" on both surfaces | Recommended in conversation but NOT finally pinned by user; Cmd/Ctrl+Enter is taken, touch needs a button, Constitution V needs a desktop chord; pure-UI, cheap to change | S:50 R:85 A:70 D:55 |
| 6 | Confident | Pointer detection is a live `matchMedia("(pointer: coarse)")` subscription (shared hook) driving both the keydown policy and the `enterkeyhint` value, replacing per-site mount-time checks | User excluded width-based keying; hint must re-render on capability change; existing coarse check in ChatSendForm autofocus gives the pattern | S:70 R:90 A:80 D:70 |
| 7 | Certain | Existing guards extend unchanged to new chords: IME `isComposing` suppression, empty/whitespace no-op, compose-strip draft preservation on closed WS, chat in-flight lock | Direct extension of verified current behavior; no signal anywhere to change them | S:70 R:90 A:90 D:85 |
| 8 | Certain | Two surfaces keep mirrored Enter/chord/`enterkeyhint` semantics — divergence is a defect | Discussed — explicit user requirement (decision 5) | S:90 R:80 A:90 D:90 |
| 9 | Certain | Out of scope: slash-command/skill autocomplete in the compose box; multiline raw-bytes per-line-execution caveat documented, not guarded | Discussed — user's explicit scope calls | S:95 R:90 A:95 D:95 |
| 10 | Confident | Insert-only delivery clears the local draft/textarea on success, same as submit (the text now lives in the pane's input box) | Not explicitly discussed; consistent with "delivered ⇒ clear" on both surfaces; trivially reversible | S:55 R:90 A:80 D:70 |
| 11 | Confident | Test split: coarse-pointer Enter behavior covered by colocated unit tests (jsdom `matchMedia` mock); e2e specs updated for fine-pointer semantics + Insert affordance, with `.spec.md` companions in the same commit | code-quality.md mandates unit tests for new behavior + e2e where possible; pointer emulation is fragile in e2e, cheap in jsdom | S:60 R:90 A:80 D:70 |

11 assumptions (7 certain, 4 confident, 0 tentative, 0 unresolved).
