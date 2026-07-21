// Pure URL-mapping helpers for the route tree, extracted from router.tsx so
// their unit tests import a leaf module instead of the whole app: router.tsx →
// app.tsx → terminal-client → @xterm/addon-unicode-graphemes, whose
// import-time trie inflate is a documented CI flake ("Data error") that killed
// the suite before any test ran. Keep this module dependency-free.

// The terminal route serializes the tmux window id (`@N`) as its numeric part
// only (`N`) in the URL — `/testServer/0`, not `/testServer/%400`. tmux window
// ids are always `@` + digits, so stripping the `@` for display is a lossless,
// bijective mapping; the `@N` form is restored by parse and remains the window
// identity everywhere in code. These are the two directions of that mapping,
// exported as pure functions so they are unit-testable.

/** stringify direction: param `@N` → URL segment `N` (strip the leading `@`). */
export function windowIdToUrlSegment(windowId: string): string {
  return windowId.replace(/^@/, "");
}

/**
 * parse direction: URL segment `N` → param `@N` (prepend `@`). Idempotent — a
 * segment that already carries `@` (an old bookmarked `/testServer/%400` deep
 * link, whose segment decodes to `@0`) is returned unchanged, so it resolves to
 * `@0` and never `@@0`.
 */
export function urlSegmentToWindowId(segment: string): string {
  return segment.startsWith("@") ? segment : `@${segment}`;
}

// The `?view=` search param carries the per-viewer window-view lens (spec R2,
// change 260714-t97o-web-view-lens; chat lens folded in from 260714-r7rq). It is
// per-VIEWER client state, NOT part of the window's identity — no new route
// (Constitution IV). `web` and `chat` are the valid values (`tty` is the absence
// of the param — the always-available default lens); any other/unknown value is
// DROPPED (treated as absent), never errored, so a stale/garbage deep link
// degrades to the default view rather than a route error. The registry is
// open-ended: `desktop` extends this union when it ships.
export type TerminalSearch = { view?: "web" | "chat" };

// Exported as a pure function so the unknown-value drop is unit-testable.
export function validateTerminalSearch(
  search: Record<string, unknown>,
): TerminalSearch {
  return search.view === "web" || search.view === "chat"
    ? { view: search.view }
    : {};
}
