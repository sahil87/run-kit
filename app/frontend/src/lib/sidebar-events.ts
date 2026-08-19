/**
 * Cross-component signaling for sidebar focus (260819-qwr7 R5).
 *
 * The stateful `sidebar-toggle` chord (⌘B / ⇧Ctrl+B) lives in `shell.tsx`,
 * but focusing the current window's row requires the Sidebar's internals
 * (the `navRef`-scoped `[data-window-id] [aria-current="page"]` query and the
 * roving-cursor sync), and returning focus on hide/Escape requires the
 * terminal route's restore router (`app.tsx`'s `restoreFocus`). Both cross a
 * component boundary that must not be bridged with DOM reach-arounds, so
 * they ride module registries — the same module-slot shape as
 * `compose-strip-events.ts`.
 *
 * The sidebar records NOTHING in focus memory — it is chrome, not a
 * per-window `FocusKind` — so no seam here writes `recordFocus`.
 */

/**
 * Module-level registry for "focus the sidebar's current row". The Sidebar
 * component registers its row focuser on mount (and clears it on unmount iff
 * it is still the registered one — the compose-strip focuser precedent), so
 * a hidden (unmounted) sidebar simply has no focuser.
 */
let rowFocuser: (() => boolean) | null = null;

/**
 * Register the sidebar's row focuser. `focus` returns `true` when a row
 * actually took focus, `false` when no focusable row exists (empty tree).
 * Returns an unregister function that clears the slot ONLY if it still
 * points at this focuser, so a remount that registered a newer focuser is
 * not clobbered by an older instance's cleanup.
 */
export function registerSidebarRowFocuser(focus: () => boolean): () => void {
  rowFocuser = focus;
  return () => {
    if (rowFocuser === focus) rowFocuser = null;
  };
}

/**
 * Focus the sidebar's current row via the registered focuser: the
 * `[aria-current="page"]` window row when one exists, else the tree's
 * roving tab-stop / first focusable row (board/host routes). The focuser
 * syncs the roving cursor alongside the DOM focus — tab-stop and DOM focus
 * must never desync (the Wave-2 #262 invariant). Returns `false` when no
 * sidebar is mounted or no row took focus.
 */
export function focusSidebarCurrentRow(): boolean {
  return rowFocuser?.() ?? false;
}

/**
 * Module-level registry for "return focus to the route's remembered
 * surface". The terminal route (AppShell) registers its `restoreFocus` path;
 * routes without one (board, host, server) register nothing, and callers
 * fall back to a blur. No origin storage — the restore router's
 * `recallFocus(key) ?? "tty"` IS the return target.
 */
let windowFocusRestorer: (() => void) | null = null;

/**
 * Register the route's focus restorer. Returns an unregister function that
 * clears the slot ONLY if it still points at this restorer.
 */
export function registerWindowFocusRestorer(restore: () => void): () => void {
  windowFocusRestorer = restore;
  return () => {
    if (windowFocusRestorer === restore) windowFocusRestorer = null;
  };
}

/**
 * Return focus via the registered route restorer. Returns `true` when a
 * restorer ran, `false` when none is registered — the caller then blurs.
 */
export function restoreWindowFocus(): boolean {
  if (!windowFocusRestorer) return false;
  windowFocusRestorer();
  return true;
}
