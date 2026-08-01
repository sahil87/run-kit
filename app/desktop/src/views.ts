/**
 * Per-host view registry pure logic — which renderer view exists for which
 * host, which one is attached (active), the per-view badge-count and
 * theme-color caches that the switch seam repaints from, and the load-failure
 * flag transitions the remote-tunnel heal gates its reload on.
 *
 * Deliberately electron-free (the `hosts.ts` / `window-open.ts` /
 * `local-daemon.ts` / `update-check.ts` / `strip.ts` / `badge.ts` precedent):
 * the actual `WebContentsView` is an opaque generic handle `H`, so the
 * sibling `views.test.ts` covers the decision logic under plain
 * `node --test`. The impure glue — view construction, attach/detach on the
 * window's contentView, `setBounds`, `setTitleBarOverlay`, badge painting —
 * lives in `main.ts`.
 *
 * Identity: entries key on the immutable host id (one view per registered
 * host entry — several entries may share one ORIGIN, so origin is never a
 * key here). `webContentsId` is carried so IPC reports (`badge:set`), whose
 * sender is a webContents, resolve to their view without an origin lookup.
 */

export interface ViewEntry<H> {
  hostId: string;
  /** The view's webContents id — the IPC sender key (origins can be shared). */
  webContentsId: number;
  /** Opaque view handle (the WebContentsView in main.ts). */
  handle: H;
  /** Last `badge:set` report from this view's page (0 = none/cleared). */
  badgeCount: number;
  /** Last theme color observed from this view (null = none observed yet). */
  themeColor: string | null;
}

export interface ViewsState<H> {
  /** Insertion order = first-visit order. */
  entries: ViewEntry<H>[];
  /** Host whose view is attached to the window; null = welcome / none. */
  activeHostId: string | null;
}

export function emptyViews<H>(): ViewsState<H> {
  return { entries: [], activeHostId: null };
}

export function getView<H>(state: ViewsState<H>, hostId: string): ViewEntry<H> | null {
  return state.entries.find((e) => e.hostId === hostId) ?? null;
}

/** Resolve an IPC sender (a webContents id) to its view entry. */
export function findViewByWebContentsId<H>(
  state: ViewsState<H>,
  webContentsId: number,
): ViewEntry<H> | null {
  return state.entries.find((e) => e.webContentsId === webContentsId) ?? null;
}

/** The attached view's entry, when a host view is showing. */
export function activeView<H>(state: ViewsState<H>): ViewEntry<H> | null {
  if (state.activeHostId === null) return null;
  return getView(state, state.activeHostId);
}

/**
 * Register a freshly created view for a host. A host that already has a view
 * is left unchanged (views are created lazily, exactly once per host) — the
 * caller must check `getView` first and reuse the existing handle.
 */
export function addView<H>(
  state: ViewsState<H>,
  hostId: string,
  handle: H,
  webContentsId: number,
): ViewsState<H> {
  if (getView(state, hostId) !== null) return state;
  return {
    ...state,
    entries: [
      ...state.entries,
      { hostId, webContentsId, handle, badgeCount: 0, themeColor: null },
    ],
  };
}

/** Mark a host's view as the attached one. Unknown host is a no-op. */
export function activateView<H>(state: ViewsState<H>, hostId: string): ViewsState<H> {
  if (getView(state, hostId) === null) return state;
  return { ...state, activeHostId: hostId };
}

/** No view attached (welcome showing). Caches are kept. */
export function deactivateViews<H>(state: ViewsState<H>): ViewsState<H> {
  if (state.activeHostId === null) return state;
  return { ...state, activeHostId: null };
}

/**
 * Drop a host's view entry (host removed, or teardown). Returns the removed
 * entry so the caller can detach + close its webContents; clears the active
 * pointer when it pointed at the removed host.
 */
export function removeView<H>(
  state: ViewsState<H>,
  hostId: string,
): { state: ViewsState<H>; removed: ViewEntry<H> | null } {
  const removed = getView(state, hostId);
  if (removed === null) return { state, removed: null };
  return {
    state: {
      entries: state.entries.filter((e) => e.hostId !== hostId),
      activeHostId: state.activeHostId === hostId ? null : state.activeHostId,
    },
    removed,
  };
}

/**
 * Record a `badge:set` report for a view. Background views' reports update
 * their cache silently — whether to PAINT is the caller's decision (only the
 * active view's count reaches the OS badge). Unknown host is a no-op.
 */
export function setViewBadge<H>(
  state: ViewsState<H>,
  hostId: string,
  count: number,
): ViewsState<H> {
  if (getView(state, hostId) === null) return state;
  return {
    ...state,
    entries: state.entries.map((e) =>
      e.hostId === hostId ? { ...e, badgeCount: count } : e,
    ),
  };
}

/** Record the last observed theme color for a view. Unknown host is a no-op. */
export function setViewThemeColor<H>(
  state: ViewsState<H>,
  hostId: string,
  color: string | null,
): ViewsState<H> {
  if (getView(state, hostId) === null) return state;
  return {
    ...state,
    entries: state.entries.map((e) =>
      e.hostId === hostId ? { ...e, themeColor: color } : e,
    ),
  };
}

// ─── Load-failure flag (the remote-tunnel heal's reload gate) ────────────────

/** Chromium's "navigation superseded by another" — never a real failure. */
export const ERR_ABORTED = -3;

/** The main-frame load lifecycle events that drive the failure flag. */
export type LoadFlagEvent =
  | { kind: "did-fail-load"; isMainFrame: boolean; errorCode: number }
  | { kind: "did-navigate" }
  | { kind: "did-finish-load" };

/**
 * Next value of a view's "last main-frame load failed" flag — the gate the
 * remote-tunnel heal reads to decide whether a healed host's view needs a
 * reload (a warm view keeps its live renderer state, never reloaded).
 *
 * Set by a real main-frame `did-fail-load` (ERR_ABORTED excluded — a
 * superseded navigation is not a failure). Cleared ONLY by `did-navigate`,
 * the commit of a real server response, which never fires for Chromium's
 * own error page. `did-finish-load` NEVER clears: Chromium fires it for the
 * error page immediately after `did-fail-load` (verified against a live
 * WebContentsView), so clearing there would wipe the flag before the
 * background `rk remote connect` heal completes — the reload gate would
 * never fire and a dead-tunnel view would stay stuck on its error page.
 */
export function nextLoadFailed(prev: boolean, event: LoadFlagEvent): boolean {
  switch (event.kind) {
    case "did-fail-load":
      return event.isMainFrame && event.errorCode !== ERR_ABORTED ? true : prev;
    case "did-navigate":
      return false;
    case "did-finish-load":
      return prev;
  }
}

/**
 * What to repaint when attaching a host's view: its cached badge count
 * (0 — i.e. clear — when the view is fresh or unknown) and its cached theme
 * color (null → the caller applies the default strip color). This is the
 * switch-time decision: state comes from the INCOMING view's caches, never
 * carried over from the outgoing one.
 */
export function switchPaint<H>(
  state: ViewsState<H>,
  hostId: string,
): { badgeCount: number; themeColor: string | null } {
  const entry = getView(state, hostId);
  if (entry === null) return { badgeCount: 0, themeColor: null };
  return { badgeCount: entry.badgeCount, themeColor: entry.themeColor };
}
