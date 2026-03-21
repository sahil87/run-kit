# Spec: Fix OSC 52 Clipboard Provider

**Change**: 260321-zbdq-fix-osc52-clipboard-provider
**Created**: 2026-03-21
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Terminal: OSC 52 Clipboard Provider

### Requirement: Accept Empty Selection Parameter in OSC 52

The `ClipboardAddon` instantiation in `app/frontend/src/components/terminal-client.tsx` SHALL use a custom `ClipboardProvider` that accepts both `"c"` (explicit clipboard) and `""` (empty/default) as valid selection targets for `readText` and `writeText` operations.

The custom provider SHALL reject all other selection values (`"p"`, `"s"`, `"0"`–`"7"`) by returning `""` for reads and returning early for writes — matching the default provider's behavior for non-clipboard selections.

#### Scenario: Tmux yank with empty selection parameter
- **GIVEN** a tmux session with `set-clipboard on` and vi copy-mode bindings
- **WHEN** the user enters copy mode, selects text with `v`, and yanks with `y`
- **THEN** tmux sends an OSC 52 sequence with an empty selection parameter (`\x1b]52;;{base64}\x07`)
- **AND** the custom ClipboardProvider receives `selection=""` and `text={decoded}`
- **AND** `navigator.clipboard.writeText(text)` is called
- **AND** the text is available on the system clipboard

#### Scenario: Explicit clipboard selection parameter
- **GIVEN** a program sends OSC 52 with `c` selection (`\x1b]52;c;{base64}\x07`)
- **WHEN** the ClipboardAddon processes the sequence
- **THEN** the custom provider calls `navigator.clipboard.writeText(text)` — same as default behavior

#### Scenario: Non-clipboard selection parameter rejected
- **GIVEN** a program sends OSC 52 with `p` selection (primary) (`\x1b]52;p;{base64}\x07`)
- **WHEN** the ClipboardAddon processes the sequence
- **THEN** the custom provider returns early without calling `navigator.clipboard.writeText()`

### Requirement: Preserve Default Base64 Handler

The `ClipboardAddon` constructor SHALL receive `undefined` as the first argument (base64 handler), preserving the addon's built-in base64 encoding/decoding.

#### Scenario: Base64 decoding uses addon defaults
- **GIVEN** the ClipboardAddon is instantiated with `new ClipboardAddon(undefined, customProvider)`
- **WHEN** an OSC 52 sequence arrives with base64-encoded text
- **THEN** the addon decodes the base64 using its built-in handler before passing the decoded text to the custom provider

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is ClipboardAddon rejecting empty selection parameter | Confirmed from intake #1 — diagnosed via addon source, `writeText` guards `selection !== "c"` | S:95 R:95 A:95 D:95 |
| 2 | Certain | Use custom ClipboardProvider (second constructor arg) | Confirmed from intake #2 — addon API supports this, avoids patching addon source | S:90 R:95 A:90 D:95 |
| 3 | Certain | Accept both `""` and `"c"` as valid clipboard targets | Confirmed from intake #3 — `""` means "default" per OSC 52 spec | S:90 R:95 A:90 D:90 |
| 4 | Certain | No tmux config changes needed | Confirmed from intake #4 — `set-clipboard on` already configured | S:95 R:95 A:95 D:95 |
| 5 | Certain | Single file change (`terminal-client.tsx`) | Confirmed from intake #5 — only addon instantiation changes | S:95 R:95 A:95 D:95 |

5 assumptions (5 certain, 0 confident, 0 tentative, 0 unresolved).
