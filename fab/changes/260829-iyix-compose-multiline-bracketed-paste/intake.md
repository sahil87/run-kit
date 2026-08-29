# Intake: Compose Strip Multi-line Submit via Bracketed Paste

**Change**: 260829-iyix-compose-multiline-bracketed-paste
**Created**: 2026-08-29

## Origin

Conversational. The user reported: *"Sometimes, pushing text using the compose box removes the formatting (I mean end lines). I know for a fact the following text collapses:"* followed by a ~450-byte multi-line block (numbered list + paragraph). After the root-cause assessment below was presented with a recommended fix, the user asked *"Will this impact performance? If no, go ahead"* — answered: no measurable impact (one tmux buffer round-trip + bounded probe, only on multi-line submits), and the go-ahead was given.

> Compose strip: route multi-line submits through bracketed paste (tmux `paste-buffer -p` via `internal/inject`) instead of raw WS bytes.

Key decisions from the discussion:
- Reuse the existing `internal/inject` engine (already behind `POST /api/windows/{id}/chat/send`) rather than adding a frontend-side `ESC[200~ … ESC[201~` wrapper — a frontend wrapper would print escape garbage into a plain shell that never enabled bracketed paste; tmux `paste-buffer -p` brackets **only when the pane's application requested bracketed paste**, so shells stay raw-equivalent.
- Single-line submits, the bare-`\r` empty submit, and Alt+Enter raw insert stay on the existing WebSocket keystroke path unchanged.
- Broadcast (selection-target) mode is out of scope — it already goes through `selectionTarget.onSend` (the chat-send engine per recipient), so it does not have this bug.

## Why

**Problem.** `compose-strip.tsx` `send()` transmits every mode as raw keystroke bytes over the muxed `/ws/terminals` relay stream: submit = `ws.send(text + "\r")`, insert-line = `ws.send(text + "\n")`. A multi-line draft therefore reaches the pane's PTY as one write containing embedded `\n` bytes and **no bracketed-paste envelope**. Claude Code (Ink) distinguishes typed input from pasted input by the `ESC[200~`/`ESC[201~` markers, falling back to a chunk-timing heuristic when they are absent. A whole block arriving as a single non-bracketed chunk is parsed as one key event; the embedded `\n` are treated as return keypresses, not literal newline text, and the lines are joined — the block collapses to one line.

**Why intermittent.** It depends on how the relay/PTY chunks the write: a short block lands in one chunk (collapse); a longer block or a slower link splits into several chunks and Claude's paste heuristic fires (lines preserved). The user's ~450-byte sample sits squarely in the single-chunk zone.

**The header comment's premise is half-true.** `compose-strip.tsx:70` and the memory file state "Claude Code treats a raw `\n` as newline-insert". That holds for a *single* `\n` arriving alone (the insert-line mode's trailing byte after a one-line text), not for `\n` bytes embedded in a burst. The submit path inherited the assumption.

**Consequence of not fixing.** Any structured prompt composed in the strip (lists, numbered steps, code-ish blocks) arrives at the agent mangled, silently — the user only discovers it by reading the pane. The strip is the primary mobile input surface, where composing multi-line text is the norm.

**Why this approach.** The repo already has the exact machinery: `internal/inject.Engine.Send` runs Sanitize → `set-buffer -b <name> -- <text>` → `paste-buffer -d -p -b <name> -t <target>` → NOVELTY echo probe → probe-gated `send-keys Enter`, serialized per `(server, target)`, under one shared context deadline. It is proven against Claude Code via the chat lens and `rk mux send`. The only gap is that its sole HTTP consumer (`/chat/send`) requires a resolved chat session (404 otherwise), while the compose strip targets *any* window. A thin sibling route drops that requirement.

## What Changes

### Backend — `POST /api/windows/{windowId}/paste` (new route)

File: `app/backend/api/windows.go` (handler) or a new `app/backend/api/paste.go` (preferred — keeps `windows.go` from growing; mirror `chat.go`'s handler shape). Registered in `app/backend/api/router.go` next to `/api/windows/{windowId}/keys` (line ~760).

Body:
```json
{ "text": "line one\nline two", "submit": true }
```
- `text` — required; sanitized with `inject.Sanitize` **before** the emptiness check (exactly like `handleChatSend`); all-control or whitespace-only → `400 "Text cannot be empty"`.
- `submit` — optional, defaults to `true` (absent ⇒ true; only explicit `false` skips the gated Enter). Same additive contract as `chatSendRequest.Submit`.
- `{windowId}` validated by `parseWindowID` (`400 "Invalid window ID"`); `?server=` via `serverFromRequest`.

Target resolution — the window's **active pane**, not the chat pane:
- `s.sessions.FetchSessions(ctx, server)` → find `WindowID == windowID` → pick the pane with `IsActive` (fallback: first pane). `FetchSessions` error → `500`; window not found / no panes → `404 "window not found"`.
- Rationale: the compose strip is terminal-faithful — its WS keystrokes land in whatever pane is active in the attached window, so the paste must target the same pane. `sessions.ResolveChatPane` (chat-provider-first) is the wrong rule here; `tmux.SelectAgentPane` (agent-state-first) is also wrong for a plain-shell window. Implement as a small pure helper `activePaneID(panes []tmux.PaneInfo) string` in `api/paste.go` with a unit test.

Injection — the **same** engine and adapter as chat send:
- Rename/refactor the adapter so both routes share it without duplication: `chatSendTmux` → keep the type, but the paste handler calls the same `injectChatMessage`-style seam. Concretely: extract `func (s *Server) injectIntoPane(ctx, server, paneID, text string, submit bool) error { return chatSendEngine.Send(ctx, chatSendTmux{s.tmux}, server, paneID, text, submit) }` and make `injectChatMessage` delegate to it (or rename `injectChatMessage` → `injectIntoPane` and update its one chat call site + tests). Shared named buffer `tmux.ChatSendBuffer` is fine — the engine's set→paste critical section is already globally serialized across panes.
- Same shared deadline: `context.WithTimeout(r.Context(), chatSendTotalBudget)` (4s, under the 5s route rule).
- Errors: `inject.ProbeFailure` → `409` with `probeErr.Error()` (Enter withheld, text left visible in the pane composer — recoverable); other tmux error → `500`; success → `200 {"ok":true}`.
- `paste-buffer -p` brackets only if the pane app requested bracketed paste — a plain shell receives the raw bytes and executes per line exactly as the raw WS path does today, so non-agent panes keep today's behavior.

Go tests (`app/backend/api/paste_test.go`, mirroring `chat_send_test.go` fixtures — `mockSessionFetcher`, `mockTmuxOps.capturePaneResults`, `fastChatSendProbe`, `NewTestRouter`):
1. success: multi-line text, echo probe passes → 200; call order `capture-pane,set-buffer,paste-buffer,capture-pane,send-keys`; buffer text verbatim; target = the **active** pane id (fixture with two panes, inactive first, active second).
2. `submit:false` → order ends at the probe capture, no `send-keys`.
3. probe failure (capture never shows the needle) → 409, no `send-keys`.
4. `400` on empty / whitespace-only / all-control text; `400` invalid window id; `404` unknown window; `500` when `FetchSessions` errors.
5. No chat session required: fixture window has no `ChatProvider` and still gets 200.

### Frontend — `api/client.ts` helper

```ts
export async function pasteToWindow(server: string, windowId: string, text: string, submit = true): Promise<{ ok: boolean }>
```
Same shape as `sendChatMessage` (body `{ text }`, `submit: false` serialized only when false, `withServer`, `throwOnError` surfaces the 409 message). Unit tests in `client.test.ts` mirroring the three `sendChatMessage` cases (URL + body, `submit:false`, 409 throw).

### Frontend — `compose-strip.tsx` `send()` routing

In `send(mode)`, after the selection-broadcast branch and the empty-policy check, add the multi-line fork **before** the `ws` guard:

```ts
const isMultiline = text.includes("\n");
if (isMultiline && (mode === "submit" || mode === "insert-line") && focused) {
  // Bracketed paste via POST /paste — see header comment.
  void pasteToWindow(focused.server, focused.windowId, text, mode === "submit")
    .then(() => {
      pushComposeSentHistory(draftKey, text);
      clearComposeDraft(draftKey);
      endRecall();
      // + the existing blob-URL revoke / attachments clear the WS path performs after a delivered send
    })
    .catch((err) => { /* keep the draft; surface err.message via the existing toast/error seam if the strip has one, else console.warn — the draft staying put IS the recovery */ });
  return;
}
```
- Keyed on the literal `text.includes("\n")` — **not** the layout `multiline` flag (`wrapped` is a visual wrap probe, not a newline).
- `submit` mode → `submit: true` (paste + probe + Enter). `insert-line` mode → `submit: false` (paste only, staged in the composer — the multi-line analogue of today's `text + "\n"`; the trailing newline is dropped because a bracketed paste of N lines already stages N lines).
- `insert` (Alt+Enter raw) stays byte-exact on the WS path even when multi-line — it is the documented escape hatch for "send exactly these bytes".
- Single-line text in every mode and the empty bare-`\r` submit are untouched (WS path).
- Guard order: the WS-open guard is irrelevant to the POST path; a failed POST keeps the draft (mirrors the guard-blocked early return — nothing recorded, nothing cleared). Success clears exactly as the WS path does, including the sent-history push **before** the clear.
- The `send` callback is `useCallback`-memoized — add `focused` (already in scope) and the new helper to the dependency list as needed.
- Header comment: revise the premise "Claude Code treats a raw `\n` as newline-insert" to state it holds for a single trailing `\n` only; multi-line text rides `POST /paste` (bracketed paste) so embedded newlines survive as literal newlines in the agent composer.

Vitest (`compose-strip.test.tsx`, existing `Harness`/`FocusSetter`/`makeWs` scaffolding; mock `pasteToWindow` via `vi.mock("@/api/client")`):
1. multi-line + Cmd/Ctrl+Enter → `pasteToWindow("srv","@1", text, true)` called, `ws.send` NOT called, draft cleared after resolve, sent history pushed.
2. multi-line + plain Enter (insert-line) → `pasteToWindow(..., false)`.
3. multi-line + Alt+Enter → `ws.send(text)` (raw path), `pasteToWindow` not called.
4. single-line + Cmd/Ctrl+Enter → `ws.send(text + "\r")`, `pasteToWindow` not called (regression pin).
5. rejected POST → draft preserved, nothing pushed to history.

### Playwright e2e — `app/frontend/tests/e2e/compose-strip.spec.ts`

Add one `test()` (with the constitution-mandated Proves/Steps JSDoc): with the e2e pane running a line-echoing shell (`cat` — the existing specs use capture-pane markers), type two marker lines separated by Shift+Enter, press Cmd/Ctrl+Enter, poll `capture-pane` until **both** markers appear on separate lines. Proves the multi-line submit path delivers every line (for a non-bracketed shell, `paste-buffer -p` degrades to raw bytes, so this verifies delivery + line integrity, not bracketing itself — bracketing is verified by the Go call-order test asserting `paste-buffer`). Existing compose-strip e2e tests send single-line text and are unaffected; grep confirmed no e2e asserts on multi-line raw WS bytes.

### Docs

- `docs/specs/api.md`: add `POST /api/windows/:windowId/paste` next to the `keys` route (body, resolution rule, 200/400/404/409/500).
- Memory (hydrate): `docs/memory/run-kit/ui/compose-and-bottom-bar.md` § Docked Compose Strip — rewrite the "Two distinct send paths" paragraph and the Enter-semantics bullets to current truth (multi-line submit/insert-line → `POST /paste`; single-line/raw/bare-`\r` → WS), add a Design Decision (four-field); `docs/memory/run-kit/api-and-sockets.md` route table row; `docs/memory/run-kit/chat.md` § Send Path — note the engine's second HTTP consumer.

## Affected Memory

- `run-kit/ui/compose-and-bottom-bar`: (modify) send paths — multi-line submit/insert-line ride `POST /paste` (bracketed paste via the inject engine); single-line, raw insert, bare-`\r` stay on the relay WS; revise the raw-`\n` premise; new Design Decision
- `run-kit/api-and-sockets`: (modify) add the `POST /api/windows/{windowId}/paste` route row (body, active-pane resolution, status codes)
- `run-kit/chat`: (modify) § Send Path — the `internal/inject` engine now has a second daemon HTTP consumer (`/paste`, no chat-session requirement); the `injectChatMessage` seam is shared

## Impact

- **Backend**: `app/backend/api/paste.go` (new, ~80 lines), `app/backend/api/router.go` (+1 route), `app/backend/api/chat.go` (adapter seam shared — rename/delegate only, behavior unchanged), `app/backend/api/paste_test.go` (new). No `internal/tmux` changes — `SetChatSendBuffer`/`PasteChatSendBuffer`/`SendEnterToPane`/`CapturePane` already exist on `TmuxOps`.
- **Frontend**: `app/frontend/src/api/client.ts` (+1 helper), `client.test.ts`, `app/frontend/src/components/compose-strip.tsx` (routing fork in `send()` + header comment), `compose-strip.test.tsx`, `app/frontend/tests/e2e/compose-strip.spec.ts` (+1 test).
- **Performance**: the new path fires only for multi-line submit/insert-line; cost is the chat-send sequence (2 captures + set + paste + optional Enter, ≤ ~240ms probe worst case, 4s hard budget). Single-line typing latency unchanged.
- **Security**: text is a discrete argv element to `set-buffer -- <text>` (Constitution I), sanitized of control bytes; no new exec surface beyond the existing `TmuxOps` methods.
- **Constitution IX**: mutating route is `POST`.

## Open Questions

- None blocking. (Whether `insert-line` on multi-line text should paste-without-Enter vs. paste-then-`\n` was decided: paste-without-Enter — a bracketed N-line paste already stages N lines; appending a newline keystroke would add an empty trailing line.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Reuse `internal/inject` engine + `tmux paste-buffer -p` rather than a frontend `ESC[200~` wrapper | Discussed — user accepted the recommendation; `-p` is conditional on the pane app, so shells stay raw-equivalent; frontend wrapper would print escapes into non-bracketed shells | S:90 R:70 A:95 D:95 |
| 2 | Certain | Single-line submits, bare-`\r` empty submit, and Alt+Enter raw insert stay on the WS keystroke path | Discussed — scope explicitly limited to multi-line submit; keeps typing latency and byte-exact semantics untouched | S:90 R:90 A:95 D:95 |
| 3 | Confident | New route `POST /api/windows/{windowId}/paste` (sibling of `/keys` and `/chat/send`) instead of relaxing `/chat/send`'s 404 | `/chat/send` semantics (chat-pane resolution, 404 without chat) are documented and tested; a sibling route with active-pane resolution is additive and Constitution IX-conformant | S:75 R:80 A:85 D:75 |
| 4 | Confident | Target = the window's **active** pane (fallback first pane), not `ResolveChatPane`/`SelectAgentPane` | The strip's WS keystrokes land in the active pane; the paste must hit the same pane to be terminal-faithful | S:70 R:85 A:85 D:75 |
| 5 | Confident | `insert-line` on multi-line text → `POST /paste` with `submit:false` (no trailing newline keystroke) | A bracketed N-line paste stages N lines already; appending `\n` would add an empty line. Reversible one-flag change | S:60 R:90 A:80 D:70 |
| 6 | Certain | Fork keyed on `text.includes("\n")`, not the layout `multiline` flag | `wrapped` is a visual wrap probe; only literal newlines suffer the collapse | S:85 R:95 A:95 D:95 |
| 7 | Certain | Selection-broadcast mode out of scope | It already routes through per-recipient chat-send (`selectionTarget.onSend`) and is unaffected | S:85 R:95 A:95 D:90 |
| 8 | Confident | Failed POST (409/500/network) keeps the draft and records no sent-history entry, surfacing the error message | Mirrors the existing guard-blocked-send contract ("draft preserved, nothing lost"); 409 text already explains the recoverable state | S:70 R:90 A:85 D:80 |
| 9 | Confident | Share the engine via one `Server` seam (`injectIntoPane`, chat delegating to it) and the existing `tmux.ChatSendBuffer` | Engine already serializes set→paste globally; a second buffer name buys nothing; avoids duplicated-logic parsimony finding | S:65 R:85 A:85 D:80 |
| 10 | Confident | e2e test uses a `cat` pane and asserts both lines via `capture-pane`; bracketing itself is asserted by the Go call-order test | The e2e rig has no Claude pane; a shell degrades `-p` to raw bytes, which still proves line integrity of the new path | S:60 R:85 A:80 D:70 |

10 assumptions (4 certain, 6 confident, 0 tentative, 0 unresolved).
