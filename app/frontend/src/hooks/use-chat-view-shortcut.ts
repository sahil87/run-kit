import { useEffect, useRef } from "react";
import type { ViewName } from "@/lib/window-view";
import { matchesCombo, shouldSuppressChord } from "@/lib/keybindings";
import { useKeybindings } from "@/hooks/use-keybindings";

/**
 * Ctrl+` toggles tty↔chat on the terminal route (260714-r7rq; Constitution V —
 * keyboard parity for the top-bar chip's chat segment). Plain Ctrl on BOTH
 * platforms — NOT Cmd: Cmd+` is macOS window cycling and must not be bound. The
 * association is VS Code's "toggle terminal".
 *
 * The chord comes from the keybinding registry (`chat-toggle`, ctrl tier,
 * per-device rebindable — 260730-g40a). Input gating is the shared
 * `shouldSuppressChord` predicate, whose carve-outs are exactly this hook's
 * historical ones: it must fire while xterm owns focus (escaping the terminal
 * is its whole job) and from within the chat-send `.rk-chat-input` textarea
 * (the chat lens's focus target — bailing there would trap the user), while a
 * "real" text input (window-rename, dialog fields) still suppresses it.
 *
 * `enabled` gates the whole thing (terminal route + a chat-capable window); when
 * false the listener is a no-op. `currentView`/`toggle` speak the unified
 * `ViewName` vocabulary (`"tty"`, not `"terminal"`): the handler flips between
 * `chat` and `tty` and passes the target to `toggle` (wired to `switchView`).
 */
export function useChatViewShortcut(
  enabled: boolean,
  currentView: ViewName,
  toggle: (next: ViewName) => void,
) {
  // Hold the latest view/toggle/binding in refs so the listener effect depends
  // only on `enabled` (re-registering on every view flip would be churn, and
  // the flip itself is what the handler causes).
  const viewRef = useRef(currentView);
  viewRef.current = currentView;
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const { byAction } = useKeybindings();
  const bindingRef = useRef(byAction.get("chat-toggle"));
  bindingRef.current = byAction.get("chat-toggle");

  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      const binding = bindingRef.current;
      if (!binding?.enabled || !matchesCombo(e, binding)) return;
      if (shouldSuppressChord(e.target)) return;

      e.preventDefault();
      toggleRef.current(viewRef.current === "chat" ? "tty" : "chat");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
