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

// The `?view=` / `?panel=` / `?layout=` search params are RETIRED as state
// carriers: the tab's layout is the shared `@rk_win_layout` window option and
// the URL is the bare route. They stay ACCEPTED inbound for one release as
// translation-only inputs — the route-entry translation effect in app.tsx
// translates them into the option (when unset), then replaces the URL with
// the bare route. Nothing in the frontend writes them. Unknown `view`/`panel`
// values are DROPPED here (treated as absent), never errored, so a
// stale/garbage deep link degrades to the default layout rather than a route
// error. `layout` passes through as a raw string — validation lives in
// `lib/surface-layout.ts`'s `parseLayout` (this module is a deliberately
// dependency-free leaf, so the parse helpers can't be imported here).
export type TerminalSearch = {
  view?: "web" | "code";
  panel?: "web" | "code";
  layout?: string;
};

// Exported as a pure function so the unknown-value drop is unit-testable.
export function validateTerminalSearch(
  search: Record<string, unknown>,
): TerminalSearch {
  const out: TerminalSearch = {};
  if (search.view === "web" || search.view === "code") {
    out.view = search.view;
  }
  if (search.panel === "web" || search.panel === "code") out.panel = search.panel;
  if (typeof search.layout === "string" && search.layout.length > 0) {
    out.layout = search.layout;
  }
  return out;
}
