# Intake: Chat-Send Control-Byte Sanitization

**Change**: 260719-t9uk-chat-send-control-byte-sanitize
**Created**: 2026-07-20

## Origin

<!-- Backlog item [t9uk], picked up by the backlog-bugs sweep (BUG scope). One-shot dispatch; validity re-verified against current code before intake creation. -->

> [t9uk] Chat-send control-byte sanitization (should-fix, OPEN): the send handler does not strip C0 control bytes from body.Text before the tmux buffer paste; bracketed paste neutralizes the common cases, but a defensive sanitize in api/chat.go is the clean fix. (relocated from docs/memory/run-kit/chat.md by /docs-distill-memory)

**Verification (2026-07-20)**: still valid. `handleChatSend` (app/backend/api/chat.go) decodes `body.Text`, applies only a `strings.TrimSpace` emptiness check, and passes the text verbatim through `injectChatMessage` → `SetChatSendBuffer` (`tmux set-buffer -b rk-chat-send -- <text>`, app/backend/internal/tmux/tmux.go:1700) → bracketed `paste-buffer -d -p`. No control-byte stripping exists anywhere on the path. `internal/validate.SanitizeFilename` exists but is filename-scoped and unused here.

## Why

1. **The pain point**: the chat-send injection path pastes client-supplied bytes into a live agent TUI composer. Bracketed paste (`paste-buffer -p`) neutralizes the *common* hazards (raw newlines do not submit per-line; ordinary characters are literal inside the paste guards), but control bytes ride through verbatim. The sharpest residual vector: an ESC (0x1B) in `body.Text` can embed the bracketed-paste **end** sequence `ESC[201~`, terminating paste mode early so the remaining bytes are interpreted by the TUI as live keystrokes — the classic paste-injection attack. Lesser cases: BEL/BS/VT/FF/SUB and friends can garble the composer or trigger stray TUI behavior, and a single-byte C1 CSI (U+009B) is an escape introducer in some terminals.

2. **The consequence if unfixed**: any client that can reach `rk serve` (or a message that merely *contains* pasted-in escape bytes) can break out of the bracketed paste and inject keystrokes into the agent pane — e.g. submit arbitrary input or answer a pending permission dialog. This is exactly the blind-keystroke hazard the send path's echo probe + withheld-Enter design exists to prevent; unsanitized control bytes sidestep that guard.

3. **Why this approach**: a defensive sanitize at the handler boundary (api/chat.go) is the clean fix named by the backlog note. It is one pure helper + one call site, keeps the tmux layer byte-faithful (Constitution §I: the tmux wrappers store argv verbatim — policy belongs to the caller), and makes every downstream consumer of the text (needle derivation, multiline detection, paste, probe) automatically consistent because they all receive the already-sanitized string. Alternatives rejected: sanitizing inside `SetChatSendBufferCtx` (wrong layer — the tmux package is a mechanism-only wrapper and other future callers may legitimately need raw bytes); rejecting requests containing control bytes with a 400 (hostile to legitimate copy-paste content that merely carries stray escapes — stripping is strictly friendlier and loses nothing meaningful).

## What Changes

### Sanitize helper in `app/backend/api/chat.go`

Add a package-level pure helper:

```go
// sanitizeChatText strips terminal control bytes from a chat-send message
// before it is pasted into the agent pane. Bracketed paste makes ordinary
// text inert, but control bytes ride through verbatim — most sharply ESC,
// which can embed the bracketed-paste-end sequence (ESC[201~) and turn the
// tail of the message into live keystrokes. Defense: normalize CR/CRLF to
// \n, then drop every control rune (C0, DEL, and the C1 range — which
// includes the single-byte CSI U+009B) except \n and \t, which are
// legitimate message content (multiline messages and indented code).
func sanitizeChatText(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return r
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, text)
}
```

(Exact comment wording free to vary; behavior as specified. `unicode.IsControl` covers C0 (U+0000–U+001F), DEL (U+007F), and C1 (U+0080–U+009F).)

### Call site in `handleChatSend`

Apply immediately after the JSON decode and **before** the emptiness check, so a message that is entirely control bytes collapses to empty and takes the existing 400 path:

```go
if err := json.NewDecoder(r.Body).Decode(&body); err != nil { ... }
body.Text = sanitizeChatText(body.Text)
if strings.TrimSpace(body.Text) == "" {
	writeError(w, http.StatusBadRequest, "Message text cannot be empty")
	return
}
```

Everything downstream (`chatProbeNeedle`, the `multiline` detection via `strings.Contains(text, "\n")`, `setAndPaste`, the echo probe) operates on the sanitized text — no other call-site changes. CR-normalization (rather than bare stripping) means a CRLF-origin multiline message still counts as multiline and keeps its line structure.

### Tests in `app/backend/api/chat_send_test.go`

- **Unit (table-driven) for `sanitizeChatText`**: plain text unchanged; `\n` and `\t` preserved; `\r\n` → `\n` and lone `\r` → `\n`; ESC stripped (input containing `\x1b[201~` loses the ESC, leaving inert literal `[201~`); NUL/BEL/BS/VT/FF/SUB stripped; DEL (0x7F) stripped; C1 CSI (U+009B) stripped; non-ASCII text (emoji, accents) preserved; all-control input → empty string.
- **Handler-level**: a send whose text carries embedded control bytes asserts the recorded `set-buffer` text is the sanitized form (via the existing fake/recording tmux seam in chat_send_test.go); a send whose text is entirely control bytes returns 400 without touching tmux.

## Affected Memory

- `run-kit/chat`: (modify) — the send-path description gains the sanitize step (control-byte stripping at the handler boundary before the named-buffer paste); this closes the OPEN should-fix noted when the item was relocated to the backlog.

## Impact

- `app/backend/api/chat.go` — one new helper + one call-site line in `handleChatSend`.
- `app/backend/api/chat_send_test.go` — new unit table + handler-level assertions.
- No API-shape change, no frontend change, no tmux-layer change. Behavior changes only for messages containing control bytes (previously pasted verbatim, now stripped/normalized).
- Backlog: `[t9uk]` marked done on ship.

## Open Questions

_None._

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Sanitize lives in api/chat.go `handleChatSend`, applied to `body.Text` right after decode and before the emptiness check | Backlog note names api/chat.go; ordering makes all-control text hit the existing 400 path naturally | S:90 R:90 A:95 D:90 |
| 2 | Confident | Strip set = all control runes (`unicode.IsControl`: C0 + DEL + C1) except `\n`/`\t` — slightly broader than the note's literal "C0" | Same defensive intent; C1 includes single-byte CSI (escape introducer); Go-idiomatic one-liner; trivially narrowed if ever needed | S:70 R:90 A:85 D:65 |
| 3 | Certain | `\n` and `\t` are preserved; CR/CRLF normalized to `\n` rather than dropped | Multiline is a supported send feature (the probe's paste-collapse placeholder logic keys on `\n`); tabs are legitimate content; normalization preserves line structure from CRLF clients | S:85 R:90 A:95 D:85 |
| 4 | Certain | Scope is the send path only — backfill/read endpoints and the tmux wrappers stay byte-faithful | Backlog note scopes to the send handler; tmux layer is mechanism-only (Constitution §I comment says buffers store text verbatim) | S:90 R:95 A:95 D:90 |
| 5 | Certain | No additional validation (length caps, rejection-with-400 for control bytes) — sanitize-only | Minimal surface area (Constitution §IV posture); stripping is friendlier than rejecting for legitimate paste content; nothing in the note asks for more | S:80 R:95 A:90 D:80 |

5 assumptions (4 certain, 1 confident, 0 tentative, 0 unresolved).
