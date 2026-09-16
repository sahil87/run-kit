/**
 * Web-tile guest registry pure logic — which guest WebContentsView exists for
 * which (window, host, tabKey), the SPA-requested visibility and parked bounds
 * each entry carries, and the attach/detach plans that make the registry the
 * z-order authority over the window's contentView.
 *
 * Deliberately electron-free (the `views.ts` precedent): the actual
 * `WebContentsView` is an opaque generic handle `H`, so the sibling
 * `web-views.test.ts` covers the decision logic under plain `node --test`.
 * The impure glue — view construction, `addChildView`/`removeChildView`,
 * `setBounds`/`setVisible`, `webContents.close()` — lives in `main.ts`.
 *
 * Identity: entries key on (hostContentsId, tabKey) for IPC resolution — the
 * sender of a `web:*` call IS the owning host view's webContents, and two
 * windows showing one host are two host webContents, so tabKeys never collide
 * across windows — with (windowId, hostId) carried alongside for the
 * window/host-scoped teardowns. `webContentsId` is the guest's own
 * webContents id, the navigation guard's membership key.
 *
 * Z-order: guests are SIBLINGS of the host view on `win.contentView` (a child
 * of the host view never paints — Electron 43/Linux), and
 * `addChildView(host)` raises the host above every guest, so a host switch
 * buries the returning host's own guests. `hostDetachPlan` lists the outgoing
 * host's guests to hide; `hostAttachPlan` lists the incoming host's guests to
 * re-add (raising them) and re-show — executed by `attachHostView` on EVERY
 * attach, including a same-host re-attach.
 */

export interface WebViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebViewEntry<H> {
  /** The BrowserWindow id this guest's host view is attached to. */
  windowId: number;
  hostId: string;
  /** The OWNING host view's webContents id — the IPC sender key. */
  hostContentsId: number;
  /** SPA-chosen per-tab identity, unique under one host webContents. */
  tabKey: string;
  /** The guest's own webContents id — the navigation guard's membership key. */
  webContentsId: number;
  /** Opaque view handle (the WebContentsView in main.ts). */
  handle: H;
  /** The SPA-requested visibility (`web:visible`). Independent of the host
   *  detach hide, so a re-attach restores exactly what the SPA asked for. */
  visible: boolean;
  /** Last `web:bounds` rect (rounded DIPs, relative to the host view = the
   *  window content area). Parked while hidden; applied on show — `setBounds`
   *  on a hidden view re-shows it (Electron 43/Linux), so main must not apply
   *  it before `setVisible(true)`. */
  bounds: WebViewBounds;
}

export interface WebViewsState<H> {
  /** Insertion order = creation order = z-order among one host's guests. */
  entries: WebViewEntry<H>[];
}

export function emptyWebViews<H>(): WebViewsState<H> {
  return { entries: [] };
}

export function getWebView<H>(
  state: WebViewsState<H>,
  hostContentsId: number,
  tabKey: string,
): WebViewEntry<H> | null {
  return (
    state.entries.find(
      (e) => e.hostContentsId === hostContentsId && e.tabKey === tabKey,
    ) ?? null
  );
}

/**
 * The IPC resolution: the sender IS the owning host webContents, so a tabKey
 * created by another host webContents resolves to null (the membership gate).
 */
export function findWebViewBySender<H>(
  state: WebViewsState<H>,
  senderContentsId: number,
  tabKey: string,
): WebViewEntry<H> | null {
  return getWebView(state, senderContentsId, tabKey);
}

/** True exactly for a registered guest's own webContents id. */
export function isGuestContents<H>(
  state: WebViewsState<H>,
  webContentsId: number,
): boolean {
  return state.entries.some((e) => e.webContentsId === webContentsId);
}

/**
 * Register a freshly created guest. Create-once per (hostContentsId, tabKey):
 * an existing pair is left unchanged — the caller checks `getWebView` first
 * and destroys + recreates on a collision.
 */
export function addWebView<H>(
  state: WebViewsState<H>,
  entry: Pick<
    WebViewEntry<H>,
    "windowId" | "hostId" | "hostContentsId" | "tabKey" | "webContentsId" | "handle"
  >,
): WebViewsState<H> {
  if (getWebView(state, entry.hostContentsId, entry.tabKey) !== null) return state;
  return {
    entries: [
      ...state.entries,
      { ...entry, visible: true, bounds: { x: 0, y: 0, width: 0, height: 0 } },
    ],
  };
}

/**
 * Record the SPA-requested visibility. Pure record, no side effects — the
 * caller reads it to order `setBounds` before `setVisible(true)`. Unknown key
 * is a no-op.
 */
export function setWebViewVisible<H>(
  state: WebViewsState<H>,
  hostContentsId: number,
  tabKey: string,
  visible: boolean,
): WebViewsState<H> {
  if (getWebView(state, hostContentsId, tabKey) === null) return state;
  return {
    entries: state.entries.map((e) =>
      e.hostContentsId === hostContentsId && e.tabKey === tabKey
        ? { ...e, visible }
        : e,
    ),
  };
}

/**
 * Record the SPA-requested bounds. Pure record, no side effects — the caller
 * applies them now (visible entry) or parks them (hidden entry). Unknown key
 * is a no-op.
 */
export function setWebViewBounds<H>(
  state: WebViewsState<H>,
  hostContentsId: number,
  tabKey: string,
  bounds: WebViewBounds,
): WebViewsState<H> {
  if (getWebView(state, hostContentsId, tabKey) === null) return state;
  return {
    entries: state.entries.map((e) =>
      e.hostContentsId === hostContentsId && e.tabKey === tabKey
        ? { ...e, bounds }
        : e,
    ),
  };
}

/**
 * Drop one guest. Returns the removed entry so the caller can detach + close
 * it. Unknown key is a no-op.
 */
export function removeWebView<H>(
  state: WebViewsState<H>,
  hostContentsId: number,
  tabKey: string,
): { state: WebViewsState<H>; removed: WebViewEntry<H> | null } {
  const removed = getWebView(state, hostContentsId, tabKey);
  if (removed === null) return { state, removed: null };
  return {
    state: {
      entries: state.entries.filter(
        (e) => !(e.hostContentsId === hostContentsId && e.tabKey === tabKey),
      ),
    },
    removed,
  };
}

/**
 * Drop every guest of ONE host webContents (the host page committed a
 * navigation — the SPA renderer that owned the tabKeys is gone). Returns the
 * removed entries so the caller can detach + close them.
 */
export function removeHostWebViews<H>(
  state: WebViewsState<H>,
  hostContentsId: number,
): { state: WebViewsState<H>; removed: WebViewEntry<H>[] } {
  const removed = state.entries.filter((e) => e.hostContentsId === hostContentsId);
  if (removed.length === 0) return { state, removed: [] };
  return {
    state: {
      entries: state.entries.filter((e) => e.hostContentsId !== hostContentsId),
    },
    removed,
  };
}

/**
 * Drop every guest in ONE window (the window is closing). Returns the removed
 * entries so the caller can close their webContents.
 */
export function removeWindowWebViews<H>(
  state: WebViewsState<H>,
  windowId: number,
): { state: WebViewsState<H>; removed: WebViewEntry<H>[] } {
  const removed = state.entries.filter((e) => e.windowId === windowId);
  if (removed.length === 0) return { state, removed: [] };
  return {
    state: { entries: state.entries.filter((e) => e.windowId !== windowId) },
    removed,
  };
}

/**
 * Drop every guest of ONE host across ALL windows (the host is removed or
 * re-pointed). Returns the removed entries so the caller can detach + close
 * them.
 */
export function removeHostWebViewsEverywhere<H>(
  state: WebViewsState<H>,
  hostId: string,
): { state: WebViewsState<H>; removed: WebViewEntry<H>[] } {
  const removed = state.entries.filter((e) => e.hostId === hostId);
  if (removed.length === 0) return { state, removed: [] };
  return {
    state: { entries: state.entries.filter((e) => e.hostId !== hostId) },
    removed,
  };
}

/**
 * The handles to `setVisible(false)` when a host view leaves a window's
 * contentView (host switch away, showWelcome): every guest of that
 * (window, host), regardless of `visible` — the SPA-requested flag is NOT
 * touched, so a re-attach restores exactly what the SPA asked for.
 */
export function hostDetachPlan<H>(
  state: WebViewsState<H>,
  windowId: number,
  hostId: string,
): H[] {
  return state.entries
    .filter((e) => e.windowId === windowId && e.hostId === hostId)
    .map((e) => e.handle);
}

/**
 * The guests of a (window, host) to re-raise on attach, in entries order
 * (creation order = z-order). The caller re-adds each to `win.contentView`
 * (re-adding an existing child raises it above the just-added host view),
 * then applies `bounds` + `setVisible(true)` for `visible: true` entries and
 * `setVisible(false)` for the rest (idempotent — keeps a stale shown state
 * from leaking over the incoming host).
 */
export function hostAttachPlan<H>(
  state: WebViewsState<H>,
  windowId: number,
  hostId: string,
): { handle: H; visible: boolean; bounds: WebViewBounds }[] {
  return state.entries
    .filter((e) => e.windowId === windowId && e.hostId === hostId)
    .map((e) => ({ handle: e.handle, visible: e.visible, bounds: e.bounds }));
}
