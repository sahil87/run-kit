# Intake: Fix xterm Terminal Copy to Clipboard

**Change**: 260317-rpqx-xterm-copy-clipboard
**Created**: 2026-03-17
**Status**: Draft

## Origin

> Add the ability to be able to copy text from xterm terminal in the web interface. Right now the text selects correctly, but it doesn't copy into the system on which the run-kit UI is running on a browswer.

One-shot request. User reports that text selection works in the xterm.js terminal but the copy-to-clipboard action fails silently.

## Why

1. **The pain point**: Users can select text in the xterm terminal but cannot copy it to their system clipboard. This breaks a fundamental terminal workflow — selecting output to paste elsewhere (another terminal, editor, chat).

2. **The consequence**: Without working copy, users must manually retype terminal output or find alternative ways to extract text, severely degrading the utility of the web-based terminal.

3. **The approach**: The existing implementation at `app/frontend/src/components/terminal-client.tsx:145-160` uses `navigator.clipboard.writeText()` which requires a **secure context** (HTTPS or localhost). run-kit is typically accessed over HTTP on a local network (e.g., `http://192.168.x.x:port`), which is NOT a secure context — so `navigator.clipboard.writeText()` silently fails (the error is swallowed by `.catch(() => {})`). The fix needs a fallback mechanism for non-secure contexts.

   Additionally, the `@xterm/addon-clipboard` (ClipboardAddon) handles OSC 52 sequences — this is for programs _writing_ to clipboard (e.g., tmux `set-clipboard`), not for user selection → copy. So it doesn't help with this issue.

## What Changes

### Robust clipboard copy with fallback

In `app/frontend/src/components/terminal-client.tsx`, the Cmd+C / Ctrl+C handler (lines 145-160) needs to:

1. **Try `navigator.clipboard.writeText()` first** — works in secure contexts (HTTPS, localhost)
2. **Fall back to `document.execCommand('copy')`** — the legacy API that works in non-secure HTTP contexts. This requires:
   - Creating a temporary off-screen `<textarea>` element
   - Setting its value to the selected text
   - Selecting the textarea content
   - Calling `document.execCommand('copy')`
   - Removing the temporary element
3. **Clear the terminal selection after successful copy** — `term.clearSelection()` for visual feedback that copy worked

The pattern is well-established: try the modern Clipboard API, catch the error, fall back to `execCommand('copy')`. The `.catch(() => {})` that currently swallows errors silently is the root cause — it should trigger the fallback instead.

### File changes

- **`app/frontend/src/components/terminal-client.tsx`**: Modify the `attachCustomKeyEventHandler` callback to use a clipboard helper with fallback

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update Keyboard Shortcuts section to note the fallback copy mechanism

## Impact

- **Affected code**: `app/frontend/src/components/terminal-client.tsx` — the custom key event handler (lines 145-160)
- **No backend changes** — this is purely a frontend clipboard API issue
- **No new dependencies** — uses built-in browser APIs (`navigator.clipboard`, `document.execCommand`)
- **No API changes** — no new endpoints or WebSocket messages

## Open Questions

- None — the fix is straightforward with well-known browser APIs.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `execCommand('copy')` as fallback for non-secure contexts | This is the standard fallback pattern — no other option exists for HTTP origins | S:80 R:90 A:95 D:95 |
| 2 | Certain | Root cause is `navigator.clipboard.writeText()` failing in non-secure context | run-kit is accessed over HTTP on local network; Clipboard API requires secure context | S:75 R:90 A:90 D:90 |
| 3 | Confident | Clear terminal selection after successful copy | Standard UX pattern for terminal copy — visual confirmation that copy succeeded | S:60 R:95 A:70 D:80 |
| 4 | Certain | No changes needed to ClipboardAddon (OSC 52) | OSC 52 handles program→clipboard direction, not user selection→clipboard | S:85 R:95 A:90 D:95 |
| 5 | Certain | Single file change — `terminal-client.tsx` only | The bug is isolated to the key event handler's clipboard call | S:90 R:95 A:95 D:95 |

5 assumptions (4 certain, 1 confident, 0 tentative, 0 unresolved).
