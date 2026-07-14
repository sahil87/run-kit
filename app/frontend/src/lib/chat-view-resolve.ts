/**
 * Pure chat-view URL/pref resolution (260714-r7rq). Extracted from `router.tsx`
 * so it is unit-testable without evaluating the router module (which pulls in
 * the whole app tree) — mirroring the `lib/*` pure-helper convention. `router.tsx`
 * re-exports these and wires `validateTerminalSearch` into the terminal route's
 * `validateSearch`.
 */

/**
 * The terminal route's search-param shape. `view` is the codebase's first
 * search param — either the literal `"chat"` or absent. Any other value
 * normalizes to `undefined`, so the URL only ever carries `?view=chat` or no
 * `view` at all.
 */
export type TerminalSearch = { view?: "chat" };

/**
 * Normalize an arbitrary search input into `TerminalSearch`. Only the exact
 * string `"chat"` survives; everything else (missing, other strings,
 * non-strings) drops the param.
 */
export function validateTerminalSearch(search: Record<string, unknown>): TerminalSearch {
  return search.view === "chat" ? { view: "chat" } : {};
}

/**
 * Resolve the active view for a terminal-route window, with precedence: explicit
 * URL `view` param > per-window localStorage pref > terminal default. `urlView`
 * is the normalized route search value; `storedPref` is `true` when the
 * per-window persistence key is present (see `use-chat-view-pref.ts`).
 *
 * The caller is responsible for the `chatProvider` gate — a chat-less window
 * renders the terminal regardless of this result (the param/pref stay inert).
 * This resolver only composes the URL-vs-pref precedence.
 */
export function resolveChatView(
  urlView: "chat" | undefined,
  storedPref: boolean,
): "chat" | "terminal" {
  if (urlView === "chat") return "chat";
  return storedPref ? "chat" : "terminal";
}
