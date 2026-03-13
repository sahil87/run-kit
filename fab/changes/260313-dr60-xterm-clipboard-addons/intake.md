# Intake: xterm Clipboard & Addons

**Change**: 260313-dr60-xterm-clipboard-addons
**Created**: 2026-03-13
**Status**: Draft

## Origin

> User reported that copy doesn't work in the xterm.js-based terminal UI (paste works fine). Discussion explored the available xterm.js addons and the user chose to enable clipboard support via `attachCustomKeyEventHandler` plus activate the already-installed but unused `@xterm/addon-web-links`.

Interaction mode: conversational (`/fab-discuss` → `/fab-new`). Key decisions made during discussion:
- Option 3 (Cmd+C intercept with selection check) chosen over option 2 (auto-copy on selection)
- `@xterm/addon-web-links` already in `package.json` but never loaded — should be activated
- `@xterm/addon-clipboard` to be added for proper clipboard integration
- `@xterm/addon-webgl` to be added for GPU-accelerated rendering with silent fallback

## Why

1. **Problem**: Users cannot copy text from the terminal. `Cmd+C` sends SIGINT to the running process instead of copying selected text to the clipboard. This is a fundamental usability gap for a terminal UI — users expect copy to work.
2. **Consequence**: Users must resort to right-click context menu copy or cannot copy terminal output at all. This violates the keyboard-first constitution principle.
3. **Approach**: Use xterm.js's `attachCustomKeyEventHandler` to intercept `Cmd+C`/`Ctrl+C` and branch on whether text is selected — matching the behavior of native terminals (iTerm2, Terminal.app). Also activate an already-installed addon (`web-links`) that adds value at zero dependency cost.

## What Changes

### Clipboard copy via key handler

Add `attachCustomKeyEventHandler` to the terminal instance in `terminal-client.tsx`:

```typescript
terminal.attachCustomKeyEventHandler((event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'c' && event.type === 'keydown') {
    if (terminal.hasSelection()) {
      navigator.clipboard.writeText(terminal.getSelection());
      return false; // prevent xterm from sending SIGINT
    }
  }
  return true; // let xterm handle normally (SIGINT when no selection)
});
```

Behavior:
- `Cmd+C` (macOS) / `Ctrl+C` (Linux) **with** text selected → copies to clipboard, no signal sent
- `Cmd+C` / `Ctrl+C` **without** selection → sends SIGINT as normal
- All other keys pass through unchanged

### Load @xterm/addon-clipboard

Install and load `@xterm/addon-clipboard` alongside the existing FitAddon:

```typescript
const { ClipboardAddon } = await import("@xterm/addon-clipboard");
terminal.loadAddon(new ClipboardAddon());
```

This provides the underlying clipboard read/write API that xterm.js uses for OSC 52 clipboard sequences (programs like tmux, vim, and SSH sessions can write to the clipboard).

### Activate @xterm/addon-web-links

`@xterm/addon-web-links` is already in `package.json` but never instantiated. Load it:

```typescript
const { WebLinksAddon } = await import("@xterm/addon-web-links");
terminal.loadAddon(new WebLinksAddon());
```

This makes URLs in terminal output clickable — useful when agents print links to PRs, docs, or error references.

### Enable @xterm/addon-webgl for GPU-accelerated rendering

Install and load `@xterm/addon-webgl` with a try/catch fallback — WebGL2 context creation can fail on some hardware or when too many contexts are active:

```typescript
try {
  const { WebglAddon } = await import("@xterm/addon-webgl");
  terminal.loadAddon(new WebglAddon());
} catch {
  // canvas renderer continues working — no action needed
}
```

This is a pure performance upgrade — same visual output, significantly faster rendering for high-throughput agent output. The silent fallback means zero risk.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document terminal addon configuration and keyboard shortcut behavior

## Impact

- **Files**: `app/frontend/src/components/terminal-client.tsx` (primary)
- **Dependencies**: Add `@xterm/addon-clipboard` and `@xterm/addon-webgl` to `package.json` (new); `@xterm/addon-web-links` already present
- **APIs**: No backend changes
- **Risk**: Low — addons are loaded lazily via dynamic import, matching existing FitAddon pattern. The key handler is additive and the fallthrough (`return true`) preserves all existing behavior.

## Open Questions

- None — approach was discussed and decided in conversation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `attachCustomKeyEventHandler` for Cmd+C copy | Discussed — user chose option 3 (Cmd+C intercept) over option 2 (auto-copy on select) | S:95 R:90 A:90 D:95 |
| 2 | Certain | Load `@xterm/addon-web-links` | Discussed — already installed, user confirmed activation | S:90 R:95 A:95 D:95 |
| 3 | Certain | Install `@xterm/addon-clipboard` | Discussed — user explicitly said "Enable clipboard addon" | S:95 R:90 A:85 D:90 |
| 4 | Confident | Use `navigator.clipboard.writeText` for the copy operation | Standard web API, used by xterm.js examples; requires secure context (HTTPS or localhost) which run-kit uses | S:70 R:90 A:85 D:80 |
| 5 | Confident | Dynamic import pattern for new addons (matching FitAddon) | Existing codebase pattern — all xterm imports are dynamic in the async `init()` function | S:75 R:95 A:90 D:90 |
| 6 | Confident | Handle both `metaKey` (macOS) and `ctrlKey` (Linux) | Standard cross-platform terminal behavior; run-kit constitution doesn't restrict to macOS only | S:65 R:90 A:80 D:85 |
| 7 | Certain | Enable `@xterm/addon-webgl` with try/catch fallback | Discussed — user confirmed, no downside with silent fallback to canvas renderer | S:90 R:95 A:90 D:95 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).
