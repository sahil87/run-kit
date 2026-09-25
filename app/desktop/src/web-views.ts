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
 *
 * Parking: a guest whose tile unmounted is PARKED, not destroyed — main
 * hides it and moves it to `state.parked`, keyed by (windowId, hostId,
 * identity) where identity is the opaque SPA-computed retention string
 * naming "this web tab as shown in this desktop window" (`web:create`'s
 * identity field). A `web:create` whose identity matches a parked entry
 * ADOPTS it (the entry is re-bound to the new tabKey/hostContentsId) instead
 * of building a new view. At most PARKED_WEB_VIEW_CAP entries stay parked;
 * parking beyond the cap evicts the least-recently-parked entry. Parked
 * entries are excluded from the attach/detach plans — a parked view must
 * never paint, including across a host re-attach — but INCLUDED in every
 * scoped removal and in `isGuestContents` (a parked guest still browses
 * under the guest scheme allowlist).
 */

export interface WebViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

import type { ChordSpec } from "./chords";

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
  /** The SPA-computed retention identity (`web:create`), opaque to main —
   *  the parked set is keyed by (windowId, hostId, identity). Null for an
   *  identity-less create: such a guest can never park. */
  identity: string | null;
  /** The SPA-uploaded reclaimable chord table (`web:chords`) — the guest's
   *  `before-input-event` matcher in main.ts reads it per keydown. Empty until
   *  the SPA sends one. */
  chords: ChordSpec[];
  /** The last `web:zoom` factor — recorded so adoption re-applies it after a
   *  park. 1 until the SPA sends one. */
  zoomFactor: number;
  /** The SPA-requested visibility (`web:visible`). Independent of the host
   *  detach hide, so a re-attach restores exactly what the SPA asked for.
   *  Parking keeps the flag untouched — adoption re-shows only a visible
   *  entry. */
  visible: boolean;
  /** Last `web:bounds` rect (rounded DIPs, relative to the host view = the
   *  window content area). Parked while hidden; applied on show — `setBounds`
   *  on a hidden view re-shows it (Electron 43/Linux), so main must not apply
   *  it before `setVisible(true)`. */
  bounds: WebViewBounds;
}

/** A retained guest: a WebViewEntry with a non-null retention identity. */
export interface ParkedWebViewEntry<H> extends WebViewEntry<H> {
  identity: string;
}

/** The retained-guest bound — a named constant, not a setting. */
export const PARKED_WEB_VIEW_CAP = 4;

export interface WebViewsState<H> {
  /** Insertion order = creation order = z-order among one host's guests. */
  entries: WebViewEntry<H>[];
  /** Hidden retained guests; array order is park order (index 0 = least
   *  recently parked — the LRU eviction victim). */
  parked: ParkedWebViewEntry<H>[];
}

export function emptyWebViews<H>(): WebViewsState<H> {
  return { entries: [], parked: [] };
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

/** True exactly for a registered guest's own webContents id — mounted or
 *  parked (a parked guest still browses under the guest scheme allowlist). */
export function isGuestContents<H>(
  state: WebViewsState<H>,
  webContentsId: number,
): boolean {
  return (
    state.entries.some((e) => e.webContentsId === webContentsId) ||
    state.parked.some((e) => e.webContentsId === webContentsId)
  );
}

/**
 * The registry-current MOUNTED entry for a guest's own webContents id. The
 * guest relay in main.ts resolves through it per event: the id is stable
 * across park/adopt, so an adopted guest relays under its NEW tabKey to its
 * NEW host webContents, and a parked guest (off the mounted set) relays
 * nothing.
 */
export function findWebViewByContents<H>(
  state: WebViewsState<H>,
  webContentsId: number,
): WebViewEntry<H> | null {
  return state.entries.find((e) => e.webContentsId === webContentsId) ?? null;
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
  > &
    Partial<Pick<WebViewEntry<H>, "identity">>,
): WebViewsState<H> {
  if (getWebView(state, entry.hostContentsId, entry.tabKey) !== null) return state;
  return {
    ...state,
    entries: [
      ...state.entries,
      {
        ...entry,
        identity: entry.identity ?? null,
        chords: [],
        zoomFactor: 1,
        visible: true,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      },
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
    ...state,
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
    ...state,
    entries: state.entries.map((e) =>
      e.hostContentsId === hostContentsId && e.tabKey === tabKey
        ? { ...e, bounds }
        : e,
    ),
  };
}

/**
 * Record the SPA-uploaded chord table. Pure record, no side effects — the
 * `before-input-event` matcher in main.ts reads the registry-current entry per
 * keydown. Unknown key is a no-op (the `setWebViewBounds` shape).
 */
export function setWebViewChords<H>(
  state: WebViewsState<H>,
  hostContentsId: number,
  tabKey: string,
  chords: ChordSpec[],
): WebViewsState<H> {
  if (getWebView(state, hostContentsId, tabKey) === null) return state;
  return {
    ...state,
    entries: state.entries.map((e) =>
      e.hostContentsId === hostContentsId && e.tabKey === tabKey
        ? { ...e, chords }
        : e,
    ),
  };
}

/**
 * Record the last `web:zoom` factor so adoption re-applies it after a park.
 * Pure record, no side effects (the `setWebViewBounds` shape). Unknown key is
 * a no-op.
 */
export function setWebViewZoomFactor<H>(
  state: WebViewsState<H>,
  hostContentsId: number,
  tabKey: string,
  zoomFactor: number,
): WebViewsState<H> {
  if (getWebView(state, hostContentsId, tabKey) === null) return state;
  return {
    ...state,
    entries: state.entries.map((e) =>
      e.hostContentsId === hostContentsId && e.tabKey === tabKey
        ? { ...e, zoomFactor }
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
      ...state,
      entries: state.entries.filter(
        (e) => !(e.hostContentsId === hostContentsId && e.tabKey === tabKey),
      ),
    },
    removed,
  };
}

/**
 * Park one mounted guest: move it off the mounted set into the parked set
 * (keyed by (windowId, hostId, identity)) as the most-recently-parked entry.
 * The caller hides the handle and closes every returned `evicted` entry —
 * any stale parked entry under the same key, then the least-recently-parked
 * overflow beyond PARKED_WEB_VIEW_CAP. Unknown key — or an identity-less
 * entry, which can never park — is a no-op. The entry's `visible` record is
 * NOT touched: adoption re-shows only what the SPA last asked for.
 */
export function parkWebView<H>(
  state: WebViewsState<H>,
  hostContentsId: number,
  tabKey: string,
): {
  state: WebViewsState<H>;
  parked: ParkedWebViewEntry<H> | null;
  evicted: ParkedWebViewEntry<H>[];
} {
  const entry = getWebView(state, hostContentsId, tabKey);
  if (entry === null || entry.identity === null) return { state, parked: null, evicted: [] };
  const identity = entry.identity;
  const parkedEntry: ParkedWebViewEntry<H> = { ...entry, identity };
  const sameKey = (p: ParkedWebViewEntry<H>): boolean =>
    p.windowId === entry.windowId && p.hostId === entry.hostId && p.identity === identity;
  const evicted = state.parked.filter(sameKey);
  let parked = [...state.parked.filter((p) => !sameKey(p)), parkedEntry];
  while (parked.length > PARKED_WEB_VIEW_CAP) {
    const victim = parked[0];
    if (victim === undefined) break; // unreachable — length guard above
    evicted.push(victim);
    parked = parked.slice(1);
  }
  return {
    state: {
      entries: state.entries.filter(
        (e) => !(e.hostContentsId === hostContentsId && e.tabKey === tabKey),
      ),
      parked,
    },
    parked: parkedEntry,
    evicted,
  };
}

/**
 * Adopt a parked guest for a remounting frame: the parked entry matching
 * (windowId, hostId, identity) — the scope main derives from the sender's
 * host view — is re-bound to the new (hostContentsId, tabKey) and re-joined
 * to the END of the mounted set (a fresh mount is topmost, like a create).
 * Returns null on no match, leaving the state untouched; the caller then
 * takes the plain create path. Also null (no-op) when the new
 * (hostContentsId, tabKey) pair is already taken — the create-once rule.
 * Everything else on the entry survives: bounds, chords, zoomFactor, visible,
 * and the identity itself (a later re-park needs it).
 */
export function adoptParkedWebView<H>(
  state: WebViewsState<H>,
  windowId: number,
  hostId: string,
  identity: string,
  hostContentsId: number,
  tabKey: string,
): { state: WebViewsState<H>; adopted: WebViewEntry<H> | null } {
  const match = state.parked.find(
    (p) => p.windowId === windowId && p.hostId === hostId && p.identity === identity,
  );
  if (match === undefined) return { state, adopted: null };
  if (getWebView(state, hostContentsId, tabKey) !== null) return { state, adopted: null };
  const adopted: WebViewEntry<H> = { ...match, hostContentsId, tabKey };
  return {
    state: {
      entries: [...state.entries, adopted],
      parked: state.parked.filter((p) => p !== match),
    },
    adopted,
  };
}

/**
 * Drop every guest of ONE host webContents (the host page committed a
 * navigation — the SPA renderer that owned the tabKeys is gone), parked
 * entries included (a host SPA reload discards the frames that would adopt
 * them). Returns the removed entries so the caller can detach + close them.
 */
export function removeHostWebViews<H>(
  state: WebViewsState<H>,
  hostContentsId: number,
): { state: WebViewsState<H>; removed: WebViewEntry<H>[] } {
  const removed: WebViewEntry<H>[] = [
    ...state.entries.filter((e) => e.hostContentsId === hostContentsId),
    ...state.parked.filter((e) => e.hostContentsId === hostContentsId),
  ];
  if (removed.length === 0) return { state, removed: [] };
  return {
    state: {
      entries: state.entries.filter((e) => e.hostContentsId !== hostContentsId),
      parked: state.parked.filter((e) => e.hostContentsId !== hostContentsId),
    },
    removed,
  };
}

/**
 * Drop every guest in ONE window (the window is closing), parked entries
 * included. Returns the removed entries so the caller can close their
 * webContents.
 */
export function removeWindowWebViews<H>(
  state: WebViewsState<H>,
  windowId: number,
): { state: WebViewsState<H>; removed: WebViewEntry<H>[] } {
  const removed: WebViewEntry<H>[] = [
    ...state.entries.filter((e) => e.windowId === windowId),
    ...state.parked.filter((e) => e.windowId === windowId),
  ];
  if (removed.length === 0) return { state, removed: [] };
  return {
    state: {
      entries: state.entries.filter((e) => e.windowId !== windowId),
      parked: state.parked.filter((e) => e.windowId !== windowId),
    },
    removed,
  };
}

/**
 * Drop every guest of ONE host across ALL windows (the host is removed or
 * re-pointed), parked entries included. Returns the removed entries so the
 * caller can detach + close them.
 */
export function removeHostWebViewsEverywhere<H>(
  state: WebViewsState<H>,
  hostId: string,
): { state: WebViewsState<H>; removed: WebViewEntry<H>[] } {
  const removed: WebViewEntry<H>[] = [
    ...state.entries.filter((e) => e.hostId === hostId),
    ...state.parked.filter((e) => e.hostId === hostId),
  ];
  if (removed.length === 0) return { state, removed: [] };
  return {
    state: {
      entries: state.entries.filter((e) => e.hostId !== hostId),
      parked: state.parked.filter((e) => e.hostId !== hostId),
    },
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
