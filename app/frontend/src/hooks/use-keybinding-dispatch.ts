import { useEffect, useRef } from "react";
import { findMatch, shouldSuppressChord } from "@/lib/keybindings";
import { useKeybindings } from "@/hooks/use-keybindings";

/** A handler map keyed by binding actionId. `undefined` entries (or missing
 *  keys) mean "this mount has no context for that action" — the chord falls
 *  through untouched. */
export type KeybindingHandlers = Record<string, (() => void) | undefined>;

/**
 * The app-wide keybinding dispatch seam (260730-g40a): ONE window-level
 * keydown listener per route shell (AppShell mounts one; BoardPage mounts its
 * own — the two routes never co-mount), consulting the effective registry +
 * the caller's handler map + the shared suppression predicate.
 *
 * Rules, in order:
 *  1. Events something else already claimed (`defaultPrevented` — e.g. the
 *     overlay's capture-phase rebind listener) are ignored.
 *  2. Only enabled effective bindings match (`findMatch` is `e.code`-based).
 *  3. A matched binding WITHOUT a handler falls through untouched — no
 *     `preventDefault` — so browser/pane behavior is preserved where a route
 *     has no context for an action (e.g. ⇧⌘H on the board route).
 *  4. `shouldSuppressChord` gates real text inputs (with the `.xterm` and
 *     `.rk-chat-input` carve-outs) unless the binding opts out via
 *     `ignoreInputs` (⌘K, the overlay toggle).
 *
 * Handlers and bindings live in refs so the listener registers once per mount
 * — SSE ticks re-rendering the shell never churn the window listener.
 */
export function useKeybindingDispatch(handlers: KeybindingHandlers): void {
  const { bindings } = useKeybindings();

  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const binding = findMatch(e, bindingsRef.current);
      if (!binding) return;
      const handler = handlersRef.current[binding.actionId];
      if (!handler) return;
      if (!binding.ignoreInputs && shouldSuppressChord(e.target)) return;
      e.preventDefault();
      handler();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
