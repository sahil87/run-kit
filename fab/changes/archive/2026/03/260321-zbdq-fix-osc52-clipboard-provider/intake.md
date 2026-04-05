# Intake: Fix OSC 52 Clipboard Provider

**Change**: 260321-zbdq-fix-osc52-clipboard-provider
**Created**: 2026-03-21
**Status**: Draft

## Origin

> Fix OSC 52 clipboard copy: tmux sends `]52;;base64` (empty selection parameter) but xterm.js ClipboardAddon only writes to clipboard when selection is explicitly `"c"`. Fix by providing a custom ClipboardProvider to the ClipboardAddon that treats empty string the same as `"c"`.

Interaction mode: conversational (`/fab-discuss` session). Diagnosed through live debugging:

1. Confirmed tmux copy-mode yank (`v` → `y`) puts text in tmux's paste buffer but not the browser clipboard
2. Added an OSC 52 watcher to the browser console that intercepts `MessageEvent.prototype.data` on WebSocket frames
3. Observed tmux **is** sending the OSC 52 sequence: `]52;;dGVzdAo=` (base64 for "test\n")
4. Read the `@xterm/addon-clipboard` source (`addon-clipboard.mjs`) and found the `BrowserClipboardProvider.writeText()` method guards on `selection !== "c"` — returning early for empty string
5. Tmux sends `]52;;` (empty selection = "default/all") per the OSC 52 spec, but the addon only accepts `]52;c;` (explicit clipboard target)

## Why

1. **Problem**: When a user yanks text in tmux copy mode (or any program sends OSC 52 with an empty selection parameter), the text does not reach the browser's system clipboard. The OSC 52 sequence arrives correctly over the WebSocket relay but the ClipboardAddon silently discards it.

2. **Consequence**: Users cannot copy text from tmux using its native copy mode (`v` to select, `y` to yank). This is the expected workflow for tmux power users and is especially important since mouse-based selection is unreliable in tmux (tmux's mouse mode intercepts and clears selections).

3. **Approach**: The `ClipboardAddon` constructor accepts a custom `ClipboardProvider` as its second argument. Provide a custom provider that accepts both `""` (empty/default) and `"c"` (explicit clipboard) as valid selection targets, passing them through to `navigator.clipboard`. This is a minimal, targeted fix that doesn't modify the addon source or change any other behavior.

## What Changes

### Custom ClipboardProvider for ClipboardAddon

In `app/frontend/src/components/terminal-client.tsx` at line 160, replace:

```typescript
terminal.loadAddon(new ClipboardAddon());
```

With:

```typescript
terminal.loadAddon(new ClipboardAddon(undefined, {
  async readText(selection: string) {
    if (selection !== "c" && selection !== "") return "";
    return navigator.clipboard.readText();
  },
  async writeText(selection: string, text: string) {
    if (selection !== "c" && selection !== "") return;
    return navigator.clipboard.writeText(text);
  },
}));
```

The `ClipboardAddon` constructor signature is `(base64?, provider?)`. We pass `undefined` for the default base64 handler and override only the provider. The custom provider:

- Accepts selection `"c"` (explicit clipboard) — same as default
- Accepts selection `""` (empty/default) — the fix, matching tmux's behavior
- Rejects all other selections (`"p"`, `"s"`, `"0"`-`"7"`) — same as default

### tmux configuration reference

`configs/tmux/default.conf` already has the correct settings:
- Line 27: `set -g set-clipboard on` — enables OSC 52 emission on yank
- Line 72: `bind-key -T copy-mode-vi y send-keys -X copy-selection-and-cancel` — vi-mode yank

No tmux config changes needed.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document OSC 52 clipboard provider customization and tmux copy-mode integration

## Impact

- **Files**: `app/frontend/src/components/terminal-client.tsx` — single line change (line 160, ClipboardAddon instantiation)
- **No backend changes** — the WebSocket relay already passes OSC 52 sequences through correctly
- **No new dependencies** — uses the existing `@xterm/addon-clipboard` API
- **No tmux config changes** — `set-clipboard on` and vi-mode yank already configured
- **Risk**: Very low — the custom provider is strictly more permissive than the default (adds `""` acceptance), with identical behavior for all other selection values

## Open Questions

- None — root cause diagnosed and fix verified against addon source code.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is ClipboardAddon rejecting empty selection parameter | Diagnosed — read addon source, `writeText` guards `selection !== "c"`, tmux sends `""` | S:95 R:95 A:95 D:95 |
| 2 | Certain | Use custom ClipboardProvider (second constructor arg) | Discussed — addon API supports this, avoids patching addon source | S:90 R:95 A:90 D:95 |
| 3 | Certain | Accept both `""` and `"c"` as valid clipboard targets | Discussed — `""` means "default" per OSC 52 spec, `"c"` is explicit clipboard | S:90 R:95 A:90 D:90 |
| 4 | Certain | No tmux config changes needed | Verified — `set-clipboard on` already in `configs/tmux/default.conf` line 27 | S:95 R:95 A:95 D:95 |
| 5 | Certain | Single file change (`terminal-client.tsx`) | Diagnosed — only the addon instantiation needs to change | S:95 R:95 A:95 D:95 |

5 assumptions (5 certain, 0 confident, 0 tentative, 0 unresolved).
