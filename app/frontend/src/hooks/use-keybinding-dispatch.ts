import { useEffect, useRef } from "react";
import { findMatches, shouldSuppressChord } from "@/lib/keybindings";
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
 *  2. Only enabled effective bindings match; `findMatches` orders them
 *     scoped-beats-global (260730-n789), and the FIRST match with a handler
 *     at this mount fires — so on macOS, where the board pane-cycle pair and
 *     the global back/forward share ⌘[/⌘] by design, the board route keeps
 *     pane-cycle while a paneless board (handlers absent) falls to history.
 *  3. When NO match has a handler the chord falls through untouched — no
 *     `preventDefault` — so browser/pane behavior is preserved where a route
 *     has no context for an action (e.g. ⇧⌘H on the board route).
 *  4. `shouldSuppressChord` gates real text inputs (with the `.xterm` and
 *     `.rk-chat-input` carve-outs) unless the binding opts out via
 *     `ignoreInputs` (⌘K, the overlay toggle). A suppressed match YIELDS to
 *     later matches (exactly like a handler-less one), so a shared-chord
 *     `ignoreInputs` binding still fires inside inputs instead of being
 *     shadowed by a suppressed higher-precedence match.
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
      for (const binding of findMatches(e, bindingsRef.current)) {
        const handler = handlersRef.current[binding.actionId];
        if (!handler) continue;
        if (!binding.ignoreInputs && shouldSuppressChord(e.target)) continue;
        e.preventDefault();
        handler();
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
