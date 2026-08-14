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
// change 260714-t97o-web-view-lens; chat lens folded in from 260714-r7rq; the
// `code` lens joined in 260811-k3vp). It is per-VIEWER client state, NOT part
// of the window's identity — no new route (Constitution IV). `web`, `chat`, and
// `code` are the valid values (`tty` is the absence of the param — the
// always-available default lens); any other/unknown value is DROPPED (treated
// as absent), never errored, so a stale/garbage deep link degrades to the
// default view rather than a route error. The registry is open-ended:
// `desktop` extends this union when it ships.
//
// The `?panel=` search param (260811-2r1w-right-panel-shell-web-surface, spec
// right-panel.md P1) carries the per-viewer RIGHT-PANEL surface — handled
// exactly like `?view=`: `web` and `code` are the valid values (closed is the
// absence of the param), unknown values are dropped here and availability-gated
// downstream by the layout ladder's degradation (`resolveLayout`, after the
// legacy shim translates the param). `view` and `panel` are independent slots and
// may both be present (`?view=web&panel=code`).
//
// The `?layout=` search param (260812-ab5v-surface-layout-core, spec
// surface-layout.md L1) SUBSUMES and retires both: `?layout=<shape>:<a>,<b>[,<c>]`
// is the whole tile layout. `view`/`panel` remain ACCEPTED (the permanent
// translation shim in `lib/surface-layout.ts` maps them to an equivalent
// layout) but the route mirrors the resolved layout back as `?layout=` only.
// The value is passed through as a raw string — validation/degradation lives
// in `resolveLayout` (this module is a deliberately dependency-free leaf, so
// the parse helpers can't be imported here).
export type TerminalSearch = {
  view?: "web" | "chat" | "code";
  panel?: "web" | "code";
  layout?: string;
};

// Exported as a pure function so the unknown-value drop is unit-testable.
export function validateTerminalSearch(
  search: Record<string, unknown>,
): TerminalSearch {
  const out: TerminalSearch = {};
  if (search.view === "web" || search.view === "chat" || search.view === "code") {
    out.view = search.view;
  }
  if (search.panel === "web" || search.panel === "code") out.panel = search.panel;
  if (typeof search.layout === "string" && search.layout.length > 0) {
    out.layout = search.layout;
  }
  return out;
}
