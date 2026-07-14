import { useEffect, useRef } from "react";

/**
 * Ctrl+` toggles tty↔chat on the terminal route (260714-r7rq; Constitution V —
 * keyboard parity for the top-bar `[tty|chat]` chip). Plain Ctrl on BOTH
 * platforms — NOT Cmd: Cmd+` is macOS window cycling and must not be bound. The
 * association is VS Code's "toggle terminal".
 *
 * Modeled on `useSidebarKeyboardToggle` (shell.tsx) — a document-level capture —
 * but WITHOUT its xterm-focus suppression: this shortcut's whole job is escaping
 * the terminal, so it MUST fire while xterm owns focus. It still bails on a
 * "real" text input (INPUT/TEXTAREA/contentEditable that is NOT the xterm helper
 * textarea) so it never steals the backtick from the window-rename input or a
 * dialog field.
 *
 * `enabled` gates the whole thing (terminal route + a chat-capable window); when
 * false the listener is a no-op. `toggle` receives the NEXT view to switch to.
 */
export function useChatViewShortcut(
  enabled: boolean,
  currentView: "chat" | "terminal",
  toggle: (next: "chat" | "terminal") => void,
) {
  // Hold the latest view/toggle in refs so the listener effect depends only on
  // `enabled` (re-registering on every view flip would be churn, and the flip
  // itself is what the handler causes).
  const viewRef = useRef(currentView);
  viewRef.current = currentView;
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      // Backtick, plain Ctrl only (no Cmd/Alt/Shift). `e.key` reads the resolved
      // character; on most layouts Ctrl+` yields "`". Shift is excluded
      // explicitly so Ctrl+Shift+` never fires (layouts where Shift+` still
      // resolves to "`" would otherwise slip through the key check).
      if (e.key !== "`") return;
      if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

      // Bail only for a "real" text input that is NOT the xterm helper textarea
      // (xterm focuses a hidden `.xterm-helper-textarea` whenever a terminal is
      // mounted — that is the common focus state and the whole point of this
      // shortcut, so we must NOT bail there). Mirrors shell.tsx, inverted intent.
      const target = e.target;
      if (target instanceof HTMLElement) {
        const insideXterm = target.closest(".xterm") != null;
        if (!insideXterm) {
          const tag = target.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
        }
      }

      e.preventDefault();
      toggleRef.current(viewRef.current === "chat" ? "terminal" : "chat");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
