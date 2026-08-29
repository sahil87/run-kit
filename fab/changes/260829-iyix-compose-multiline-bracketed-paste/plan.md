# Plan: Compose Strip Multi-line Submit via Bracketed Paste

**Change**: 260829-iyix-compose-multiline-bracketed-paste
**Intake**: `intake.md`

## Requirements

### Backend: `POST /api/windows/{windowId}/paste`

#### R1: Paste route injects text into the window's active pane via the shared inject engine
The daemon SHALL expose `POST /api/windows/{windowId}/paste` (Constitution IX) with JSON body `{ "text": string, "submit"?: boolean }`. It MUST sanitize `text` with `inject.Sanitize` before the emptiness check, resolve the window's **active** pane (fallback: first pane) from `SessionFetcher.FetchSessions`, and drive the SAME `internal/inject` engine instance and `TmuxOps` adapter the chat-send route uses (set-buffer → `paste-buffer -d -p` → novelty echo probe → probe-gated Enter), under the shared `chatSendTotalBudget` deadline. `submit` defaults to `true`; only an explicit `false` skips the gated Enter. The route MUST NOT require a chat session on the window.

- **GIVEN** a window `@1` whose panes are `%1` (inactive) and `%2` (active), neither carrying a chat provider
- **WHEN** `POST /api/windows/@1/paste` with `{"text":"a\nb"}`
- **THEN** tmux calls run in order `capture-pane, set-buffer, paste-buffer, capture-pane, send-keys`, every pane-targeted call targets `%2`, the buffer text is `"a\nb"` verbatim, and the response is `200 {"ok":true}`

- **GIVEN** the same window
- **WHEN** the body is `{"text":"a\nb","submit":false}`
- **THEN** the sequence ends after the probe capture with no `send-keys`

#### R2: Paste route error contract
The route SHALL return `400` for an invalid window id or for text that is empty/whitespace-only after sanitization, `404` when the window is not found (or has no panes), `500` when `FetchSessions` or a tmux subprocess fails, and `409` with `inject.ProbeFailure`'s message when the echo probe fails (Enter withheld, text left in the composer).

- **GIVEN** the pane capture never shows the pasted needle
- **WHEN** `POST /paste` with multi-line text
- **THEN** the response is `409`, no `send-keys` ran, and the body carries the probe-failure message

#### R3: Chat send and paste share one injection seam
`handleChatSend` and the paste handler MUST call one `Server` method (`injectIntoPane`) wrapping `chatSendEngine.Send(ctx, chatSendTmux{s.tmux}, …)`; chat-send behavior and its tests stay unchanged.

- **GIVEN** the existing `chat_send_test.go` suite
- **WHEN** the seam is shared
- **THEN** every chat-send test still passes and the engine/adapter are constructed once

### Frontend: compose strip multi-line routing

#### R4: `pasteToWindow` client helper
`src/api/client.ts` SHALL export `pasteToWindow(server, windowId, text, submit = true)` posting to `withServer("/api/windows/{id}/paste", server)` with body `{ text }` plus `submit: false` only when false, surfacing non-2xx via `throwOnError` (the 409 probe message becomes the thrown Error's message).

- **GIVEN** `fetch` resolves `409 {"error":"agent input not ready …"}`
- **WHEN** `pasteToWindow` is awaited
- **THEN** it rejects with that message

#### R5: Multi-line submit and insert-line ride the paste route; everything else stays on the WS
In `compose-strip.tsx` `send(mode)`, when `text.includes("\n")` and `mode` is `submit` or `insert-line` (terminal target, non-broadcast), the strip MUST call `pasteToWindow(focused.server, focused.windowId, text, mode === "submit")` instead of `ws.send`; on resolve it pushes sent history then clears the draft/attachments exactly like a delivered WS send; on reject it keeps the draft and records no history. Single-line text in every mode, the empty bare-`\r` submit, and Alt+Enter raw `insert` (even multi-line) MUST keep today's `ws.send` bytes. The header comment MUST state the raw-`\n` premise holds for a single trailing newline only.

- **GIVEN** a focused terminal target and draft `"one\ntwo"`
- **WHEN** Cmd/Ctrl+Enter
- **THEN** `pasteToWindow("srv","@1","one\ntwo",true)` is called, `ws.send` is not, and after resolve the textarea is empty and ↑ recalls `"one\ntwo"`

- **GIVEN** the same draft
- **WHEN** plain Enter (insert-line)
- **THEN** `pasteToWindow(…, false)` is called

- **GIVEN** the same draft
- **WHEN** Alt+Enter
- **THEN** `ws.send("one\ntwo")` is called and `pasteToWindow` is not

- **GIVEN** draft `"one"`
- **WHEN** Cmd/Ctrl+Enter
- **THEN** `ws.send("one\r")` and `pasteToWindow` is not called

- **GIVEN** `pasteToWindow` rejects
- **WHEN** Cmd/Ctrl+Enter on a multi-line draft
- **THEN** the textarea still holds the draft and nothing was pushed to sent history

#### R6: End-to-end line integrity
A Playwright test in `compose-strip.spec.ts` SHALL prove a two-line strip submit lands both lines in the pane (poll `capture-pane` for both markers), with the constitution-mandated Proves/Steps JSDoc.

- **GIVEN** the e2e pane runs `cat`
- **WHEN** two marker lines (Shift+Enter between) are submitted with Cmd/Ctrl+Enter
- **THEN** `capture-pane` eventually contains both markers

### Docs

#### R7: API spec documents the route
`docs/specs/api.md` SHALL list `POST /api/windows/:windowId/paste` (body, active-pane rule, 200/400/404/409/500) alongside the `keys` route.

- **GIVEN** the spec's window-endpoint section
- **WHEN** read
- **THEN** the paste route is present with its contract

### Non-Goals
- Selection-broadcast mode — already per-recipient chat-send, unaffected
- Changing `/chat/send` resolution or its 404 contract
- Frontend-side `ESC[200~` wrapping — would corrupt non-bracketed shells

### Design Decisions

#### Multi-line compose sends ride tmux bracketed paste, not raw relay bytes
**Decision**: Multi-line submit/insert-line from the compose strip POST to `/api/windows/{id}/paste`, which pastes via `paste-buffer -d -p` through the shared `internal/inject` engine; single-line and raw-insert sends stay raw WS bytes.
**Why**: A multi-line block written to the PTY as one non-bracketed chunk is parsed by Claude Code as a single key event whose embedded `\n` collapse; `paste-buffer -p` brackets only when the pane app requested bracketed paste, so agents get a literal block and shells get today's bytes.
**Rejected**: Wrapping in `ESC[200~…201~` on the frontend — prints escapes into shells without bracketed paste; relaxing `/chat/send` — its chat-pane resolution and 404 are a documented contract.
*Introduced by*: 260829-iyix-compose-multiline-bracketed-paste

## Tasks

### Phase 2: Core Implementation

- [x] T001 Backend route: add `app/backend/api/paste.go` with `handleWindowPaste` (parse id, decode `{text,submit}`, `inject.Sanitize`, empty→400, `FetchSessions` window lookup → `activePaneID(panes)` helper with first-pane fallback, 404/500 mapping, shared `chatSendTotalBudget` ctx, `inject.ProbeFailure`→409, tmux error→500, 200 `{"ok":true}`); extract `injectIntoPane` in `app/backend/api/chat.go` and make `injectChatMessage` delegate (or replace its call site); register `r.Post("/api/windows/{windowId}/paste", s.handleWindowPaste)` in `app/backend/api/router.go` next to `/keys`. <!-- R1, R2, R3 -->
- [x] T002 Backend tests: `app/backend/api/paste_test.go` — success order + active-pane targeting (two-pane fixture, no chat provider), `submit:false` no Enter, probe failure 409, 400 empty/whitespace/all-control, 400 bad id, 404 unknown window, 500 fetch error; `activePaneID` unit cases. Run `just test-backend` (or `go test ./api/...` scoped first). <!-- R1, R2, R3 -->
- [x] T003 Frontend client: `pasteToWindow` in `app/frontend/src/api/client.ts` + three cases in `app/frontend/src/api/client.test.ts` (URL/body, `submit:false`, 409 rejection). <!-- R4 -->
- [x] T004 Compose strip routing: fork in `send()` of `app/frontend/src/components/compose-strip.tsx` (multi-line + submit/insert-line → `pasteToWindow`; success = history push → clear draft/attachments/recall like the WS path; reject = keep draft), header-comment premise revision; vitest cases in `compose-strip.test.tsx` per R5 scenarios (mock `@/api/client`). Run the two vitest files via `just test-frontend` scoped. <!-- R5 --> <!-- rework: paste fork must skip whitespace-only drafts (bare \r contract) and must not clear text typed during the in-flight POST -->
- [x] T005 e2e + spec: add the two-line submit `test()` with Proves/Steps JSDoc to `app/frontend/tests/e2e/compose-strip.spec.ts` (run `just test-e2e "compose-strip.spec.ts"`); document the route in `docs/specs/api.md`. <!-- R6, R7 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `POST /api/windows/{id}/paste` exists, sanitizes, resolves the active pane, and drives the shared engine with the shared deadline; `submit` defaults true
- [x] A-002 R2: 400/404/409/500 mapping implemented as specified
- [x] A-003 R3: one `injectIntoPane` seam serves both routes; no duplicated engine/adapter construction
- [x] A-004 R4: `pasteToWindow` exported with the `sendChatMessage`-shaped contract
- [x] A-005 R5: multi-line submit/insert-line call `pasteToWindow`; single-line/raw/bare-`\r` unchanged — the fork (`compose-strip.tsx:515`) is gated on `!empty`, so a whitespace-only multi-line draft (e.g. `"\n"`) still takes the bare-`\r` WS submit; pinned by the vitest "newline-only draft is EMPTY" case. All R5 sub-cases verified by vitest.
- [x] A-006 R6: e2e two-line submit test present with Proves/Steps JSDoc
- [x] A-007 R7: `docs/specs/api.md` documents the route

### Behavioral Correctness

- [x] A-008 R5: success path pushes sent history before clearing; failure path keeps the draft and pushes nothing
- [x] A-009 R1: pane-targeted tmux calls target the ACTIVE pane even when it is not the first pane

### Scenario Coverage

- [x] A-010 R1: Go test asserts call order `capture-pane,set-buffer,paste-buffer,capture-pane,send-keys` and verbatim buffer text
- [x] A-011 R2: Go test asserts 409 with no `send-keys` on probe failure
- [x] A-012 R5: vitest covers the five R5 scenarios

### Edge Cases & Error Handling

- [x] A-013 R2: all-control-byte text sanitizes to empty → 400 (not a paste of nothing)
- [x] A-014 R1: window with a single pane (no `IsActive` flag set) still resolves (first-pane fallback) — the handler reuses the existing `activePaneID` (`api/preview.go:26`) whose fallback case is covered by `preview_test.go`

### Code Quality

- [x] A-015 Pattern consistency: handler mirrors `handleChatSend` shape (parseWindowID, writeError, serverFromRequest); client helper mirrors `sendChatMessage`
- [x] A-016 No unnecessary duplication: reuses `inject`, `chatSendTmux`, `chatSendEngine`, `chatSendTotalBudget`, `TmuxOps` chat primitives; no new `internal/tmux` command construction (also reuses the existing `activePaneID` helper instead of adding a second one)
- [x] A-017 Comments state constraints, not narration; no change-ids/PR numbers in code comments
- [x] A-018 All subprocess use is via existing `exec.CommandContext` helpers; route stays under the 5s tmux-blocking rule (4s budget)
- [x] A-019 New behavior has tests (Go handler tests, vitest, e2e); existing chat-send and compose tests remain green

### Security

- [x] A-020 R1: text reaches tmux only as a discrete argv element via existing helpers; control bytes stripped

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant (re-verified on rework cycle 1: the WS keystroke path still serves single-line/raw/empty sends; `injectChatMessage` was renamed, not duplicated — `injectIntoPane` is its sole successor with all three call sites updated; the planned new `activePaneID` helper was avoided by reusing the existing one in `api/preview.go`)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | New handler lives in `api/paste.go`, not appended to `windows.go` | `windows.go` is already ~800 lines; `chat.go` precedent for a per-feature file | S:70 R:95 A:90 D:85 |
| 2 | Confident | Attachments (uploaded file paths already in the text) need no special handling on the paste path | Upload inserts paths into the textarea text; the paste carries the text verbatim | S:65 R:90 A:85 D:80 |

2 assumptions (0 certain, 2 confident, 0 tentative).
