/**
 * Pure builder for the chat-view command-palette actions (`View: Chat` /
 * `View: Terminal`) — 260714-r7rq. Extracted from app.tsx so the `chatProvider`
 * gate and the active/inactive-side selection are unit-testable without mounting
 * the shell — mirroring `lib/palette-update.ts` / `lib/palette-move.ts`.
 *
 * Only the INACTIVE side's action is surfaced (match the Fixed/Full Width toggle
 * idiom, which shows the single action that flips the current state), and only
 * when chat is available for the current window.
 */

export type ViewPaletteAction = {
  id: string;
  label: string;
  shortcut: string;
  onSelect: () => void;
};

// Ctrl+` toggles tty↔chat (`useChatViewShortcut`). Surfaced on the palette
// entries so the binding is discoverable (Constitution V; code-review.md
// "new keyboard shortcuts must be documented in the command palette").
const CHAT_VIEW_SHORTCUT = "Ctrl+`";

/**
 * Build the view-toggle palette action(s). Returns an empty array when chat is
 * unavailable (no `chatProvider` on the current window). Otherwise returns the
 * single action that flips the current view: `View: Chat` when currently on the
 * terminal, `View: Terminal` when currently on chat. `onSetView` is the toggle
 * body supplied by the caller (URL nav + pref write, window-preserving).
 */
export function buildViewActions(
  chatAvailable: boolean,
  view: "chat" | "terminal",
  onSetView: (view: "chat" | "terminal") => void,
): ViewPaletteAction[] {
  if (!chatAvailable) return [];
  if (view === "chat") {
    return [
      {
        id: "view-terminal",
        label: "View: Terminal",
        shortcut: CHAT_VIEW_SHORTCUT,
        onSelect: () => onSetView("terminal"),
      },
    ];
  }
  return [
    {
      id: "view-chat",
      label: "View: Chat",
      shortcut: CHAT_VIEW_SHORTCUT,
      onSelect: () => onSetView("chat"),
    },
  ];
}
