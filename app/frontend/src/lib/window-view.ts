/**
 * Pure helpers for the window-view lens model (change 260714-t97o-web-view-lens).
 *
 * The model (docs/specs/window-views.md): a window ROW is a substrate (a tmux
 * pane); a VIEW is a lens over one derivable output of that pane. Which lenses a
 * window offers is a capability set derived from window options (Constitution
 * II/X); which lens YOU look through is per-viewer client state carried in the
 * URL + localStorage — never a server-side `@rk_type` mutation.
 *
 * Everything here is pure and DOM-free (the localStorage read/write are thin
 * try/catch wrappers) — the same pure-helper + colocated-unit-test pattern as
 * `window-transition.ts` / `navigation.ts`. The render branch in `app.tsx` AND
 * the window-switch transition classification both call `resolveView`, so this
 * logic MUST live in one place (no drift) and MUST not depend on React/DOM.
 */

/**
 * A lens over a window's substrate. Only `tty` and `web` are implemented today;
 * the registry (spec § The View Registry) is open-ended — `chat`/`desktop` add
 * a member here, a capability in `availableViews`, and a hint in `defaultView`.
 */
export type ViewName = "tty" | "web";

/**
 * The minimal window shape the view helpers need. Structural (assignable from
 * `WindowInfo`) so these stay pure and easy to unit-test without constructing a
 * whole `WindowInfo`.
 */
export type ViewWindow = {
  rkType?: string;
  rkUrl?: string;
};

/**
 * Ordered default-view HINT precedence (spec R5): `desktop > chat > web > tty`.
 * Only `web`/`tty` are wired today; later lenses slot in here rather than
 * branching a new code path. The list is the single source of truth for both
 * availability ordering and default-hint precedence.
 */
const HINT_ORDER: ViewName[] = ["web", "tty"];

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
 * The capability set a window offers (spec R1/R3). `tty` is ALWAYS available;
 * `web` is available exactly when `rkUrl` is non-empty — decoupled from
 * `@rk_type` (an iframe-typed window with no URL offers only `tty`, matching the
 * pre-existing render gate's AND-condition, so no existing window changes
 * behavior). Returned in the registry's fixed order (`web` before `tty`).
 */
export function availableViews(win: ViewWindow | null | undefined): ViewName[] {
  const views: ViewName[] = [];
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
    if (view === "web" && win?.rkType === "iframe" && hasWebUrl(win)) return "web";
    // (desktop/chat hint clauses slot in here in registry order.)
    if (view === "tty") break; // tty is the terminal fallback, returned below.
  }
  // Fallback: the always-available tty lens (`availableViews` always includes it).
  return "tty";
}

/**
 * Resolve the effective view (spec R2) with precedence:
 *   URL `?view=` (when that view is available) → localStorage (when available)
 *   → `defaultView(win)`.
 * Any value that is not currently available falls through; the terminal chain
 * always bottoms out at `tty` (always available), so an unavailable `?view=web`
 * deep link (e.g. a window with no `rkUrl`) renders the terminal, never a
 * broken iframe.
 *
 * `searchView`/`stored` are untrusted strings (URL param, localStorage) — they
 * are validated against the capability set here, so callers may pass raw values.
 */
export function resolveView(
  searchView: string | undefined,
  stored: string | undefined,
  win: ViewWindow | null | undefined,
): ViewName {
  const available = availableViews(win);
  const isAvailable = (v: string | undefined): v is ViewName =>
    v === "tty" || v === "web" ? available.includes(v) : false;

  if (isAvailable(searchView)) return searchView;
  if (isAvailable(stored)) return stored;
  return defaultView(win);
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
 * Input-gating predicate for the `Cmd/Ctrl+.` view-cycle chord — the same rule
 * as `shell.tsx`'s sidebar toggle. Suppress the chord only when a "real"
 * (non-xterm) text input has focus: xterm's hidden helper textarea is the
 * terminal's NORMAL focus state, so bailing on every TEXTAREA would break the
 * chord in the common case. Returns `true` when the chord SHOULD be suppressed.
 * Pure over the event target (no DOM globals) so the gating is unit-testable.
 */
export function shouldSuppressViewChord(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const insideXterm = target.closest(".xterm") != null;
  if (insideXterm) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  // `isContentEditable` is the browser truth; fall back to the attribute value
  // (`"true"` / `""`) since jsdom does not implement the `isContentEditable`
  // getter. Coerced to a boolean so the predicate never leaks `undefined`.
  return target.isContentEditable || target.contentEditable === "true";
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
 * URL is filtered by `resolveView`'s availability check).
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

/**
 * Persist a window's chosen view. Best-effort — a localStorage failure (private
 * mode / quota / SSR) is swallowed (try/catch-noop, `chrome-context.tsx`).
 */
export function writeStoredView(
  server: string,
  windowId: string,
  view: ViewName,
): void {
  try {
    localStorage.setItem(windowViewStorageKey(server, windowId), view);
  } catch {
    /* noop — best-effort persistence */
  }
}
