# Plan: Chat-Send Control-Byte Sanitization

**Change**: 260719-t9uk-chat-send-control-byte-sanitize
**Intake**: `intake.md`

## Requirements

### Chat Send: Control-byte sanitization at the handler boundary

#### R1: `sanitizeChatText` strips terminal control bytes
`app/backend/api/chat.go` SHALL define a package-level pure helper
`sanitizeChatText(text string) string` that (a) normalizes `\r\n` and lone `\r` to
`\n`, then (b) drops every control rune per `unicode.IsControl` (C0 U+0000–U+001F,
DEL U+007F, and the C1 range U+0080–U+009F — which includes the single-byte CSI
U+009B) EXCEPT `\n` and `\t`, which are legitimate message content. Ordinary text,
non-ASCII text (accents, emoji), `\n`, and `\t` pass through unchanged.

- **GIVEN** a message containing an ESC (`0x1B`) that would embed the
  bracketed-paste-end sequence `\x1b[201~`
- **WHEN** `sanitizeChatText` runs on it
- **THEN** the ESC is stripped, leaving the inert literal `[201~`, so the paste
  cannot be terminated early to inject live keystrokes.
- **AND GIVEN** input containing NUL/BEL/BS/VT/FF/SUB, DEL (`0x7F`), or the C1 CSI
  (`U+009B`), **THEN** each such control rune is removed.
- **AND GIVEN** input containing `\r\n` or a lone `\r`, **THEN** it is normalized to
  `\n` (line structure preserved, not dropped).
- **AND GIVEN** input containing `\n`, `\t`, accented characters, or emoji,
  **THEN** those runes are preserved verbatim.
- **AND GIVEN** input consisting entirely of control runes, **THEN** the result is
  the empty string.

#### R2: `handleChatSend` sanitizes before the emptiness check
`handleChatSend` SHALL apply `sanitizeChatText` to `body.Text` immediately after the
JSON decode and BEFORE the whitespace-only emptiness check, so that (a) every
downstream consumer (`chatProbeNeedle`, the `multiline` detection via
`strings.Contains(text, "\n")`, `setAndPaste`, the echo probe) operates on the
already-sanitized text, and (b) a message that is entirely control bytes collapses
to empty and takes the existing `400` path without touching tmux.

- **GIVEN** a `POST /chat/send` whose text carries embedded control bytes around
  legitimate content
- **WHEN** `handleChatSend` runs and injection succeeds
- **THEN** the text recorded at the `set-buffer` step is the sanitized form (control
  bytes stripped, CR/CRLF normalized), never the raw client bytes.
- **AND GIVEN** a send whose text is entirely control bytes
- **THEN** the handler returns `400` ("Message text cannot be empty") and performs
  no tmux injection.

### Design Decisions

#### Control-byte policy: sanitize-only, all-control-except-\n/\t
**Decision**: Strip all `unicode.IsControl` runes (C0 + DEL + C1) except `\n` and
`\t`, normalizing CR/CRLF to `\n` first, at the `api/chat.go` handler boundary —
sanitize, never reject-with-400-for-control-bytes.
**Why**: Bracketed paste neutralizes ordinary text but control bytes ride through
verbatim; ESC is the sharpest vector (embeds `\x1b[201~` to break out of the paste).
Stripping at the handler makes every downstream consumer automatically consistent and
keeps the tmux layer byte-faithful (Constitution I — the wrappers store argv
verbatim; policy belongs to the caller). Sanitize is strictly friendlier than
rejecting legitimate copy-paste content that merely carries stray escapes.
**Rejected**: Sanitizing inside `SetChatSendBufferCtx` (wrong layer — the tmux
package is a mechanism-only wrapper; future callers may legitimately need raw bytes);
rejecting control-byte requests with a 400 (hostile to legitimate paste content).
*Introduced by*: `260719-t9uk-chat-send-control-byte-sanitize`

## Tasks

### Phase 2: Core Implementation

- [x] T001 Add the `unicode` import and the package-level `sanitizeChatText(text string) string` helper to `app/backend/api/chat.go` (normalize `\r\n`/`\r` → `\n`, then `strings.Map` dropping `unicode.IsControl` runes except `\n`/`\t`) <!-- R1 -->
- [x] T002 In `handleChatSend` (`app/backend/api/chat.go`), call `body.Text = sanitizeChatText(body.Text)` immediately after the JSON decode and before the `strings.TrimSpace(body.Text) == ""` emptiness check <!-- R2 -->

### Phase 3: Integration & Edge Cases (tests)

- [x] T003 Add a table-driven unit test for `sanitizeChatText` in `app/backend/api/chat_send_test.go` covering: plain text unchanged; `\n`/`\t` preserved; `\r\n` → `\n` and lone `\r` → `\n`; ESC stripped from `\x1b[201~` leaving `[201~`; NUL/BEL/BS/VT/FF/SUB stripped; DEL (`0x7F`) stripped; C1 CSI (`U+009B`) stripped; emoji/accents preserved; all-control → empty <!-- R1 -->
- [x] T004 Add a handler-level test to `app/backend/api/chat_send_test.go` asserting the recorded `set-buffer` text is the sanitized form for a send whose text carries embedded control bytes (via the existing `mockTmuxOps` recording seam) <!-- R2 -->
- [x] T005 Add a handler-level test to `app/backend/api/chat_send_test.go` asserting an all-control-byte text returns `400` and fires no tmux injection (`len(ops.chatCalls) == 0`) <!-- R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `sanitizeChatText` exists in `api/chat.go`, normalizes CR/CRLF to `\n`, and drops all `unicode.IsControl` runes except `\n`/`\t`
- [x] A-002 R2: `handleChatSend` applies `sanitizeChatText` to `body.Text` right after decode and before the emptiness check

### Behavioral Correctness

- [x] A-003 R1: An ESC-carrying message loses the ESC (the `\x1b[201~` breakout sequence is neutralized to inert `[201~`); C1 CSI (U+009B), DEL, and C0 controls are all stripped
- [x] A-004 R1: CR/CRLF normalize to `\n` (line structure preserved), while `\n`, `\t`, accents, and emoji pass through unchanged
- [x] A-005 R2: The recorded `set-buffer` text for a control-byte-carrying send is the sanitized form, not the raw client bytes

### Scenario Coverage

- [x] A-006 R1: The table-driven `sanitizeChatText` unit test covers ESC/`\x1b[201~`, NUL/BEL/BS/DEL, C1 CSI, CRLF/CR normalization, preserved `\n`/`\t`/unicode, and all-control→empty
- [x] A-007 R2: A handler-level test proves all-control text returns `400` with no tmux injection

### Edge Cases & Error Handling

- [x] A-008 R2: An entirely-control-byte message collapses to empty via sanitize and takes the existing 400 path without touching tmux

### Code Quality

- [x] A-009 Pattern consistency: The helper and its comment match the surrounding `api/chat.go` style (comment density, naming, pure-helper placement near `chatProbeNeedle`)
- [x] A-010 No unnecessary duplication: `unicode.IsControl` + `strings.Map` are used rather than a hand-rolled control-rune table; the new tests reuse the existing `mockTmuxOps`/`chatSessions`/`sendReq` seam (minor: `sendReqRaw` re-inlines the request URL instead of delegating to `sendReq` — reported as should-fix, does not block)
- [x] A-011 No shell string construction: no new subprocess calls introduced (sanitize is pure string logic; the tmux layer is untouched, staying byte-faithful per Constitution I)

## Notes

- No API-shape change, no frontend change, no tmux-layer change. Behavior changes only for messages containing control bytes.
- The tmux wrappers deliberately stay byte-faithful — sanitization is caller-side policy only.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant (the sanitize is an additive defense at the handler boundary; `internal/validate.SanitizeFilename` remains filename-scoped and unrelated, and no existing send-path code became dead).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Sanitize lives in `api/chat.go` `handleChatSend`, applied to `body.Text` right after decode and before the emptiness check | Intake names api/chat.go; ordering makes all-control text hit the existing 400 path naturally | S:90 R:90 A:95 D:90 |
| 2 | Confident | Strip set = all control runes (`unicode.IsControl`: C0 + DEL + C1) except `\n`/`\t`, slightly broader than the note's literal "C0" | Same defensive intent; C1 includes single-byte CSI (escape introducer); Go-idiomatic one-liner; trivially narrowed if ever needed | S:70 R:90 A:85 D:65 |
| 3 | Certain | `\n`/`\t` preserved; CR/CRLF normalized to `\n` rather than dropped | Multiline is a supported send feature (probe's paste-collapse logic keys on `\n`); tabs are legitimate content; normalization preserves line structure from CRLF clients | S:85 R:90 A:95 D:85 |
| 4 | Certain | Scope is the send path only — read endpoints and tmux wrappers stay byte-faithful | Intake scopes to the send handler; tmux layer is mechanism-only (Constitution I — buffers store text verbatim) | S:90 R:95 A:95 D:90 |
| 5 | Certain | No additional validation (length caps, control-byte rejection) — sanitize-only | Minimal surface area (Constitution IV); stripping is friendlier than rejecting for legitimate paste content | S:80 R:95 A:90 D:80 |

5 assumptions (4 certain, 1 confident, 0 tentative).
