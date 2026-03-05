# Intake: 2/3 Bottom Bar + Compose Buffer

**Change**: 260305-fjh1-bottom-bar-compose-buffer
**Created**: 2026-03-05
**Status**: Draft

## Origin

> Part 2 of the UI design philosophy implementation (see `docs/specs/design.md`). After change 1/3 (fixed chrome architecture) establishes the layout skeleton with a bottom slot, this change fills that slot on the terminal page with modifier keys, arrow keys, and a compose buffer for latency-tolerant input.

Interaction mode: conversational (arose from design philosophy discussion). All decisions resolved during discussion.

**Depends on**: `260305-emla-fixed-chrome-architecture` (change 1/3) — needs the `ChromeProvider` bottom slot and layout-owned flex-col skeleton.

## Why

1. **Browser terminals can't capture modifier keys reliably**: F1-F12, Ctrl+C, Esc are intercepted by the browser or OS. No way to send these to a remote terminal without virtual buttons.
2. **Mobile has no arrow keys**: On iOS there is no Up/Down/Left/Right. Command history (`↑`/`↓`) and cursor movement (`←`/`→`) are impossible without virtual buttons.
3. **Latency kills direct input on remote servers**: xterm is a `<canvas>`, not a native text input. iOS dictation, autocorrect, paste all fail in canvas. Character-by-character streaming over a laggy WebSocket is painful. The compose buffer solves this with local composition + burst send.
4. **No way to use speech-to-text**: Dictation requires a native `<textarea>`. The compose buffer provides one.

If we don't do this: terminal pages are unusable on mobile and painful on desktop with remote servers.

## What Changes

### Bottom Bar Component (`src/components/bottom-bar.tsx`)

A single row of `<kbd>` styled buttons, terminal page only:

```
Ctrl  Alt  Cmd  │  ← → ↑ ↓  │  Fn▾  Esc  Tab  ✎
```

**Modifier toggles** (`Ctrl`, `Alt`, `Cmd`):
- Click to arm (visual "armed" state — `accent` bg or bright border)
- Armed modifier combines with the next keypress sent through WebSocket
- Auto-clears after the next key is sent
- Click again while armed to disarm

**Arrow keys** (`← → ↑ ↓`):
- Compact group of 4 buttons
- Each sends the corresponding ANSI escape sequence through WebSocket
- Respects armed modifiers (e.g., Ctrl+↑)

**Function keys** (`Fn ▾`):
- Dropdown containing F1–F12, PgUp, PgDn, Home, End
- Closes after each selection (Resolved Decision #6)
- Each sends the corresponding escape sequence

**Special keys** (`Esc`, `Tab`):
- Direct send through WebSocket

**Compose** (`✎`):
- Opens the compose buffer overlay (see below)

**Styling**:
- All buttons use `<kbd>` element styling consistent with the existing `⌘K` badge
- Minimum 44px tap height (iOS HIG) for mobile usability
- Fixed height, `shrink-0`, rendered via the `setBottomBar()` context from ChromeProvider

### Modifier State Hook (`src/hooks/use-modifier-state.ts`)

Manages the sticky modifier state:

```typescript
type ModifierState = {
  ctrl: boolean;
  alt: boolean;
  cmd: boolean;
  arm: (mod: 'ctrl' | 'alt' | 'cmd') => void;
  disarm: (mod: 'ctrl' | 'alt' | 'cmd') => void;
  toggle: (mod: 'ctrl' | 'alt' | 'cmd') => void;
  consume: () => { ctrl: boolean; alt: boolean; cmd: boolean }; // returns current state and clears all
};
```

`consume()` is called when sending a key — it returns which modifiers were armed, then clears them. This ensures the "armed → combine with next key → auto-clear" flow.

### Compose Buffer (`src/components/compose-buffer.tsx`)

A native `<textarea>` overlay triggered by the `✎` button:

```
┌──────────────────────────┐
│ top chrome               │
├──────────────────────────┤
│ terminal output (dimmed) │
│ ...                      │
├──────────────────────────┤
│ ┌──────────────────────┐ │
│ │ Your message here... │ │  ← native <textarea>
│ │                      │ │
│ │              [Send]  │ │
│ └──────────────────────┘ │
├──────────────────────────┤
│ Ctrl  Alt  ✎  Fn▾  Esc  │
├──────────────────────────┤
│ iOS keyboard (if mobile) │
└──────────────────────────┘
```

**Behavior**:
1. Tap `✎` → textarea slides up from bottom bar, terminal dims (`opacity-50`)
2. Full native input: iOS dictation, autocorrect, paste, multiline all work (real DOM element)
3. `Send` button (or `Cmd+Enter` on desktop) → entire text pushed through WebSocket as one burst
4. Textarea dismisses, terminal resumes focus
5. On desktop: `i` key (when terminal has focus) toggles compose mode

**Technical**:
- Send transmits the text as a single WebSocket message
- The terminal relay writes it to the pty in one `write()` call (no character-by-character streaming)
- Textarea gets `autoFocus` when opened

### iOS Keyboard Detection (`src/hooks/use-visual-viewport.ts`)

Uses the `visualViewport` API to detect the iOS on-screen keyboard and constrain the app height:

```typescript
function useVisualViewport() {
  // Listen to window.visualViewport.resize
  // Return { height: number, offsetTop: number }
  // Set document height to visualViewport.height
  // This keeps the bottom bar pinned above the keyboard
}
```

The modifier bar sits above the iOS keyboard. The terminal (`flex-1`) shrinks as the keyboard takes space. xterm's FitAddon refits to remaining height. The prompt stays visible right above the modifier keys.

### Terminal Page Integration

The terminal client component (`terminal-client.tsx`) calls `setBottomBar(<BottomBar wsRef={wsRef} />)` on mount. The bottom bar receives the WebSocket ref to send keystrokes directly.

On unmount (navigating away from terminal), `setBottomBar(null)` clears the slot — Dashboard and Project pages have no bottom bar.

## Affected Memory

- `run-kit/architecture`: (modify) Note bottom bar component, compose buffer, modifier state hook, visualViewport hook
- `run-kit/ui-patterns`: (modify) Document bottom bar layout, compose buffer interaction, modifier key behavior

## Impact

- **New files**: `src/components/bottom-bar.tsx`, `src/components/compose-buffer.tsx`, `src/hooks/use-modifier-state.ts`, `src/hooks/use-visual-viewport.ts`
- **Modified files**: `src/app/p/[project]/[window]/terminal-client.tsx` (integrate bottom bar via context)
- **Depends on**: Change 1/3 (`ChromeProvider` bottom slot, layout-owned flex-col)
- **WebSocket protocol**: May need to handle burst text messages in the terminal relay (`src/relay.ts` or equivalent) — verify relay already handles multi-byte writes

## Open Questions

None — all decisions resolved during design discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Bottom bar layout: `Ctrl Alt Cmd │ ← → ↑ ↓ │ Fn▾ Esc Tab ✎` | Discussed — Resolved Decision #10 in design spec | S:95 R:90 A:90 D:95 |
| 2 | Certain | Sticky modifiers with visual armed state | Discussed — Resolved Decision #3 | S:90 R:90 A:85 D:90 |
| 3 | Certain | Fn dropdown closes after each selection | Discussed — Resolved Decision #6 | S:90 R:95 A:90 D:95 |
| 4 | Certain | Compose buffer as native textarea overlay | Discussed — full design in spec § Compose Buffer | S:95 R:85 A:90 D:90 |
| 5 | Certain | Bottom bar terminal page only | Discussed — Resolved Decision #1 | S:90 R:90 A:90 D:95 |
| 6 | Certain | Modifier bar pins above iOS keyboard via visualViewport | Discussed — Resolved Decision #7 | S:90 R:80 A:80 D:85 |
| 7 | Confident | 44px minimum tap height for all bottom bar buttons | Apple HIG standard, discussed in Principle 6 (Phone-Usable) | S:70 R:90 A:90 D:85 |
| 8 | Confident | Desktop compose toggle via `i` key | Vim-like mental model mentioned in discussion, easily changed | S:55 R:95 A:75 D:70 |
| 9 | Confident | Relay handles burst text (single write call) | Current relay uses node-pty write — should handle multi-byte, needs verification | S:50 R:80 A:75 D:80 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).
