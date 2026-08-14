/**
 * Pure helpers for the window-view lens model (change 260714-t97o-web-view-lens).
 *
 * The model (docs/specs/window-views.md): a window ROW is a substrate (a tmux
 * pane); a VIEW is a lens over one derivable output of that pane. Which lenses a
 * window offers is a capability set derived from window options (Constitution
 * II/X); which lens YOU look through is per-viewer client state carried in the
 * URL + localStorage — never a server-side `@rk_type` mutation.
 *
 * Everything here is pure and DOM-free (the localStorage read is a thin
 * try/catch wrapper) — the same pure-helper + colocated-unit-test pattern as
 * `window-transition.ts` / `navigation.ts`. Lens RESOLUTION lives in
 * `surface-layout.ts`'s `resolveLayout` ladder; this module owns the
 * capability predicates, the default-view hint, and the legacy stored-view
 * seed it reads, so the rail, the layout, and the palette share one
 * capability source (no drift) with no React/DOM dependency.
 */

/**
 * A lens over a window's substrate. `tty`, `web`, `chat`, and `code` are
 * implemented; the registry (spec § The View Registry) is open-ended —
 * `desktop` adds a member here, a capability in `availableViews`, and a hint
 * in `defaultView`.
 */
export type ViewName = "tty" | "web" | "chat" | "code";

/**
 * The minimal window shape the view helpers need. Structural (assignable from
 * `WindowInfo`) so these stay pure and easy to unit-test without constructing a
 * whole `WindowInfo`. `gitRoot` is the backend-derived git toplevel (the
 * window's active-pane cwd walked to its repo root) — the code lens's
 * availability half that lives per-window.
 */
export type ViewWindow = {
  rkType?: string;
  rkUrl?: string;
  chatProvider?: string;
  gitRoot?: string;
};

/**
 * Ordered default-view HINT precedence (spec R5): `desktop > chat > web > tty`.
 * `chat`/`web`/`tty` are wired today (`desktop` slots in later without a new
 * code path). The list is the single source of truth for both availability
 * ordering and default-hint precedence. NOTE: `chat` appears here for capability
 * ORDERING only — it contributes no default HINT clause in `defaultView` (a
 * chat-capable window still defaults to `tty` unless the viewer chose chat),
 * matching #351's terminal-default behavior. `code` (260811-k3vp) follows the
 * same rule: capability ordering only, NO default hint — a code-capable window
 * still defaults to `tty`.
 */
const HINT_ORDER: ViewName[] = ["chat", "code", "web", "tty"];

/**
 * Whether a window carries a usable web URL. Requires non-whitespace content:
 * `@rk_url` can be set to whitespace via an external `tmux set-option`, and a
 * bare-truthy check would then expose the web lens and later render an iframe
 * with a blank/whitespace `src`. Matches the `.trim()` guard on the URL-bar
 * submit (`iframe-window.tsx`). The single source of truth for web
 * availability — `availableViews`, `defaultView`, and the `app.tsx` render gate
 * all key off this so they cannot drift.
 */
export function hasWebUrl(win: ViewWindow | null | undefined): boolean {
  return (win?.rkUrl ?? "").trim().length > 0;
}

/**
 * Whether a window offers the chat lens (spec R1) — its pane carries a
 * `chatProvider` (the SSE-derived routing key, e.g. `claude`). The gate is a
 * non-empty check, mirroring the backend's own `resolveWindowChat` gating. The
 * single source of truth for chat availability — `availableViews` keys off it.
 */
export function hasChat(win: ViewWindow | null | undefined): boolean {
  return (win?.chatProvider ?? "").length > 0;
}

/**
 * Whether a window offers the code lens (spec right-panel.md § Surface
 * Registry, amended by 260811-k3vp, simplified by 260811-a2bo): AVAILABILITY =
 * the window's `gitRoot` derived non-empty — the one STABLE capability signal.
 * The host-side leg (a resolvable code-server port) is always true since a2bo:
 * the port resolves by convention (`RK_PORT+2`) unless a preset override wins,
 * so "configured" no longer gates anything. code-server REACHABILITY is
 * deliberately NOT part of this gate — it fluctuates, and gating on it would
 * strobe the switcher; reachability instead selects the surface's CONTENT
 * (live iframe vs the not-running empty state). The single source of truth for
 * code availability — `availableViews` and `right-panel.ts`'s
 * `availableSurfaces` both key off it.
 */
export function hasCode(win: ViewWindow | null | undefined): boolean {
  return (win?.gitRoot ?? "").length > 0;
}

/**
 * The capability set a window offers (spec R1/R3). `tty` is ALWAYS available;
 * `web` is available exactly when `rkUrl` is non-empty — decoupled from
 * `@rk_type` (an iframe-typed window with no URL offers only `tty`, matching the
 * pre-existing render gate's AND-condition, so no existing window changes
 * behavior); `chat` is available exactly when the window carries a
 * `chatProvider`; `code` is available exactly when `hasCode` holds (gitRoot
 * derived). Capabilities are orthogonal and stack (spec R5). Returned in
 * the registry's fixed order (HINT_ORDER).
 */
export function availableViews(
  win: ViewWindow | null | undefined,
): ViewName[] {
  const views: ViewName[] = [];
  if (hasChat(win)) views.push("chat");
  if (hasCode(win)) views.push("code");
  if (hasWebUrl(win)) views.push("web");
  views.push("tty");
  // Return in HINT_ORDER so the switcher segment order is stable/registry-driven.
  return HINT_ORDER.filter((v) => views.includes(v));
}

/**
 * The window's default lens (spec R5) — a derived HINT, not a lock. Applies only
 * when the URL carries no `?view=` and localStorage has no entry. `@rk_type` is
 * demoted from identity to this creation-time hint: a legacy `@rk_type=iframe`
 * window with a URL defaults to `web`; everything else defaults to `tty`. No
 * data migration — existing windows keep working.
 *
 * Structured as the ordered hint walk so desktop/chat later add a hint clause
 * without a new branch.
 */
export function defaultView(win: ViewWindow | null | undefined): ViewName {
  for (const view of HINT_ORDER) {
    // `chat` contributes NO default hint (a chat-capable window still defaults
    // to `tty` unless the viewer chose chat — preserves #351's terminal
    // default). It sits in HINT_ORDER only for capability ORDERING.
    if (view === "web" && win?.rkType === "iframe" && hasWebUrl(win)) return "web";
    // (a desktop hint clause slots in here in registry order.)
    if (view === "tty") break; // tty is the terminal fallback, returned below.
  }
  // Fallback: the always-available tty lens (`availableViews` always includes it).
  return "tty";
}

/**
 * The next view in the cycle (spec R8 — `Cmd/Ctrl+.` cycles lenses). Advances to
 * the element after `current` in `available`, wrapping around (tty→web→tty for
 * the two-view case). Returns `null` when there is nothing to cycle: fewer than
 * two views available, or `current` is not in the list (defensive — the caller
 * passes the resolved active view, which is always available). Pure so the
 * cycle order is unit-testable without a DOM/keydown event.
 */
export function nextView(
  available: ViewName[],
  current: ViewName,
): ViewName | null {
  if (available.length <= 1) return null;
  const idx = available.indexOf(current);
  if (idx < 0) return null;
  return available[(idx + 1) % available.length];
}

/**
 * Value-bearing per-window localStorage key (spec R2). Stores the chosen view
 * NAME; absence means "use the window's default view". Supersedes the chat
 * plan's key-present `board-autofit`-style convention — value-bearing
 * generalizes past two states for desktop/chat.
 */
export function windowViewStorageKey(server: string, windowId: string): string {
  return `runkit-window-view:${server}:${windowId}`;
}

/**
 * Read the persisted last-view for a window. Returns `undefined` when absent or
 * when localStorage is unavailable (SSR/jsdom/quota) — the try/catch-noop
 * pattern from `chrome-context.tsx`. The value is NOT validated against the
 * window's current capabilities here (a stored `web` for a window that lost its
 * URL is filtered by the consumer — `surface-layout.ts`'s legacy seed feeds
 * the `resolveLayout` ladder, whose availability degradation drops it).
 */
export function readStoredView(
  server: string,
  windowId: string,
): string | undefined {
  try {
    return localStorage.getItem(windowViewStorageKey(server, windowId)) ?? undefined;
  } catch {
    return undefined;
  }
}
