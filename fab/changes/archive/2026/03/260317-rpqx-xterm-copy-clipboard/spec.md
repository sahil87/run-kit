# Spec: Fix xterm Terminal Copy to Clipboard

**Change**: 260317-rpqx-xterm-copy-clipboard
**Created**: 2026-03-17
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Terminal: Clipboard Copy

### Requirement: Clipboard Copy with Fallback

The terminal's Cmd+C / Ctrl+C handler SHALL copy selected text to the system clipboard using `navigator.clipboard.writeText()` as the primary mechanism. When the Clipboard API is unavailable (non-secure context), the handler SHALL fall back to `document.execCommand('copy')` using a temporary off-screen `<textarea>` element.

The handler MUST NOT silently swallow clipboard errors without attempting a fallback.

#### Scenario: Copy in Secure Context (HTTPS/localhost)

- **GIVEN** the terminal is running in a secure context (HTTPS or localhost)
- **WHEN** the user selects text and presses Cmd+C or Ctrl+C
- **THEN** the selected text is copied to the system clipboard via `navigator.clipboard.writeText()`
- **AND** the terminal selection is cleared
- **AND** the SIGINT signal is NOT sent to the terminal

#### Scenario: Copy in Non-Secure Context (HTTP)

- **GIVEN** the terminal is running in a non-secure context (HTTP on a non-localhost host)
- **WHEN** the user selects text and presses Cmd+C or Ctrl+C
- **THEN** `navigator.clipboard.writeText()` fails
- **AND** the handler falls back to `document.execCommand('copy')` with a temporary `<textarea>`
- **AND** the selected text is copied to the system clipboard
- **AND** the terminal selection is cleared

#### Scenario: No Selection — SIGINT Passthrough

- **GIVEN** no text is selected in the terminal
- **WHEN** the user presses Cmd+C or Ctrl+C
- **THEN** the key event passes through to xterm.js (sends SIGINT)
- **AND** no clipboard operation is attempted

#### Scenario: Both Clipboard Mechanisms Fail

- **GIVEN** both `navigator.clipboard.writeText()` and `document.execCommand('copy')` fail
- **WHEN** the user selects text and presses Cmd+C or Ctrl+C
- **THEN** the failure is silently ignored (no user-visible error)
- **AND** the terminal selection is still cleared
- **AND** the SIGINT signal is NOT sent

### Requirement: Fallback Implementation

The `document.execCommand('copy')` fallback SHALL:
1. Create a `<textarea>` element positioned off-screen (`position: fixed; left: -9999px`)
2. Set the textarea's value to the selected terminal text
3. Append the textarea to `document.body`
4. Select the textarea content via `.select()`
5. Execute `document.execCommand('copy')`
6. Remove the textarea from the DOM

The textarea MUST be removed in all cases (success or failure) to prevent DOM leaks.

#### Scenario: Fallback Textarea Cleanup

- **GIVEN** the fallback copy mechanism is invoked
- **WHEN** `document.execCommand('copy')` completes (success or failure)
- **THEN** the temporary `<textarea>` element is removed from the DOM

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `execCommand('copy')` as fallback for non-secure contexts | Confirmed from intake #1 — standard fallback, no other option for HTTP origins | S:80 R:90 A:95 D:95 |
| 2 | Certain | Root cause is Clipboard API failing in non-secure context | Confirmed from intake #2 — HTTP on local network ≠ secure context | S:75 R:90 A:90 D:90 |
| 3 | Confident | Clear terminal selection after successful copy | Confirmed from intake #3 — standard terminal UX, easily reversed | S:60 R:95 A:70 D:80 |
| 4 | Certain | No ClipboardAddon changes needed | Confirmed from intake #4 — OSC 52 is program→clipboard direction | S:85 R:95 A:90 D:95 |
| 5 | Certain | Single file change — `terminal-client.tsx` only | Confirmed from intake #5 — bug isolated to key event handler | S:90 R:95 A:95 D:95 |
| 6 | Certain | Fallback textarea positioned off-screen with `position: fixed; left: -9999px` | Standard off-screen technique — avoids layout shift, works across browsers | S:85 R:95 A:90 D:95 |
| 7 | Certain | Silent failure when both mechanisms fail | No user-visible error for clipboard failures — matches existing behavior intent | S:70 R:95 A:85 D:90 |

7 assumptions (6 certain, 1 confident, 0 tentative, 0 unresolved).
