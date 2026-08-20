/**
 * Window-registry pure logic — the multi-window decision layer: New Window
 * duplication targets, window titles (`host — route-leaf`), windows.json
 * record ordering for save, cold-start restore-target resolution, and the
 * per-window fallback after a host removal. The STORE for the window set is
 * ./windows (windows.json) — deliberately a separate module: that one owns
 * file persistence, this one owns decisions.
 *
 * Deliberately electron-free (the `hosts.ts` / `views.ts` precedent), so the
 * sibling `window-registry.test.ts` covers every decision under plain
 * `node --test`. The impure glue — BrowserWindow construction, focus events,
 * `setTitle`, bounds reads — lives in `main.ts`.
 */

import { HostEntry, HostList, resolveActiveHost } from "./hosts";
import { WindowBounds, WindowRecord, WindowSet } from "./windows";

// ─── Window titles (`host — route-leaf`) ─────────────────────────────────────

/**
 * The last non-empty path segment of a route remainder (`/utils2/rk-dev` →
 * `rk-dev`, `/utils2` → `utils2`); null for a bare origin / empty path, so
 * the title falls back to the host name alone. Query and hash never leaf.
 */
export function routeLeaf(route: string): string | null {
  const path = route.split("?")[0].split("#")[0];
  const segments = path.split("/").filter((s) => s !== "");
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

/**
 * A window's title — what the OS-native switching surfaces (⌘` cycle, Dock
 * window list, App Exposé, Alt+Tab) and the mac Window-menu list show:
 * `{host name} — {route leaf}`, the bare host name at the origin root, and
 * the plain product name for a welcome window.
 */
export function windowTitle(
  productName: string,
  hostName: string | null,
  route: string,
): string {
  if (hostName === null) return productName;
  const leaf = routeLeaf(route);
  return leaf === null ? hostName : `${hostName} — ${leaf}`;
}

// ─── New Window duplication ──────────────────────────────────────────────────

/** What a New Window opens: the SOURCE window's host and current route. */
export interface NewWindowTarget {
  /** The host to attach; null = welcome (source window was on welcome). */
  hostId: string | null;
  /** The route to load the fresh view at ("" = bare origin / lastPath). */
  route: string;
}

/**
 * The duplicate-of-current-window decision: the new window opens the source
 * window's host at the source window's CURRENT route — in a FRESH,
 * independent view (never a shared or moved one; that is the caller's
 * construction discipline). A welcome source duplicates as welcome.
 */
export function newWindowTarget(source: {
  hostId: string | null;
  route: string;
}): NewWindowTarget {
  if (source.hostId === null) return { hostId: null, route: "" };
  return { hostId: source.hostId, route: source.route };
}

// ─── Record capture ordering ─────────────────────────────────────────────────

/** One live window's contribution to the saved set (windowId keys ordering). */
export interface WindowCapture {
  windowId: number;
  record: WindowRecord;
}

/**
 * The ordered record array for `saveWindows`: creation order (the caller's
 * array order), with the LAST-FOCUSED window's record moved to the END —
 * restore creates windows in array order, so the last-created window takes
 * focus without a `focused` field in the schema. An unknown/null focused id
 * leaves the order untouched.
 */
export function orderRecordsForSave(
  captures: WindowCapture[],
  focusedWindowId: number | null,
): WindowRecord[] {
  const focused = captures.findIndex((c) => c.windowId === focusedWindowId);
  const ordered =
    focused >= 0
      ? [...captures.filter((_, i) => i !== focused), captures[focused]]
      : captures;
  return ordered.map((c) => c.record);
}

// ─── Window-set capture (quit accumulation + close-one drop) ─────────────────

/**
 * Capture or drop one window's record in the accumulated set (records key on
 * windowId). A null record REMOVES the id — that is both the dev-sentinel
 * case (sentinel windows never persist) and the close-one-of-N case (the
 * closed window drops out of the saved set). Pure: the electron glue
 * (main.ts) reads routes/bounds off live windows and applies the transitions
 * at each window's `close`.
 */
export function captureWindowRecord(
  captured: ReadonlyMap<number, WindowRecord>,
  windowId: number,
  record: WindowRecord | null,
): Map<number, WindowRecord> {
  const next = new Map(captured);
  if (record === null) next.delete(windowId);
  else next.set(windowId, record);
  return next;
}

/**
 * The window set to persist from a capture map: every captured record,
 * ordered by the caller's creation-order id list, with the LAST-FOCUSED
 * window's record moved to the end (orderRecordsForSave — restore creates in
 * array order, so the last-created window takes focus). Ids without a
 * captured record are skipped (sentinel windows; windows closed outside a
 * quit). An empty capture map saves an empty set (macOS window-all-closed —
 * the next dock-reopen falls back to hosts.json).
 */
export function windowSetForSave(
  captured: ReadonlyMap<number, WindowRecord>,
  creationOrder: readonly number[],
  focusedWindowId: number | null,
): WindowSet {
  const captures: WindowCapture[] = [];
  for (const windowId of creationOrder) {
    const record = captured.get(windowId);
    if (record !== undefined) captures.push({ windowId, record });
  }
  for (const [windowId, record] of captured) {
    if (!creationOrder.includes(windowId)) captures.push({ windowId, record });
  }
  return { version: 1, windows: orderRecordsForSave(captures, focusedWindowId) };
}

// ─── Cold-start restore ──────────────────────────────────────────────────────

/** One window to create at startup / dock-reopen. */
export interface RestoreTarget {
  /** The host to attach; null = welcome. */
  hostId: string | null;
  /** The route to load the fresh view at ("" = bare origin). */
  route: string;
  /** Recorded bounds; null for the no-records fallback window (default size). */
  bounds: WindowBounds | null;
}

/**
 * What windows to open from a loaded `windows.json` set: one target per
 * record, in array order. A record's non-empty route wins; an empty route
 * falls back to the host's `lastPath` (the per-window record is absent's
 * mirror — the host-level memory is the fallback, never the other way
 * around). A record whose host no longer exists degrades THAT window to the
 * resolveActiveHost/welcome fallback rather than failing. An empty set (the
 * corrupt→empty outcome included) opens exactly ONE fallback window — the
 * active host (the cosmetic last-focused `activeId`, else first) or welcome.
 */
export function restoreTargets(set: WindowSet, list: HostList): RestoreTarget[] {
  const fallback = resolveActiveHost(list);
  if (set.windows.length === 0) {
    return [
      fallback
        ? { hostId: fallback.id, route: fallback.lastPath ?? "", bounds: null }
        : { hostId: null, route: "", bounds: null },
    ];
  }
  return set.windows.map((record) => {
    const host =
      record.hostId !== null
        ? (list.hosts.find((h) => h.id === record.hostId) ?? null)
        : null;
    if (host === null) {
      if (record.hostId === null) {
        return { hostId: null, route: "", bounds: record.bounds };
      }
      // The recorded host was removed while the app was closed.
      return fallback
        ? { hostId: fallback.id, route: fallback.lastPath ?? "", bounds: record.bounds }
        : { hostId: null, route: "", bounds: record.bounds };
    }
    return {
      hostId: host.id,
      route: record.route !== "" ? record.route : (host.lastPath ?? ""),
      bounds: record.bounds,
    };
  });
}

// ─── Host-removal fallback (per window) ──────────────────────────────────────

/** Where a window lands after a host removal. */
export type RemovedFallback =
  | { kind: "unchanged" }
  | { kind: "host"; host: HostEntry }
  | { kind: "welcome" };

/**
 * The per-window decision after `removedId` was deleted (list AFTER the
 * removal): a window not showing the removed host is unchanged; a window
 * that was showing it falls to the first remaining host (resolveActiveHost
 * on the post-removal list — removal promotes the first remaining entry),
 * or to welcome when none remain.
 */
export function hostRemovedFallback(
  listAfter: HostList,
  removedId: string,
  windowHostId: string | null,
): RemovedFallback {
  if (windowHostId !== removedId) return { kind: "unchanged" };
  const fallback = resolveActiveHost(listAfter);
  return fallback ? { kind: "host", host: fallback } : { kind: "welcome" };
}

// ─── macOS Window-menu list model ────────────────────────────────────────────

/** One row of the mac Window menu's manual per-window list section. */
export interface WindowListItem {
  windowId: number;
  label: string;
  focused: boolean;
}

/**
 * The manual window list for the mac Window menu (the custom template
 * forgoes AppKit's automatic list): one item per open window, in the
 * caller's (creation) order, labeled by the window's current title, checked
 * on the focused one. Rebuilt by the caller on open/close/focus/title
 * changes.
 */
export function windowListItems(
  windows: { windowId: number; title: string; focused: boolean }[],
): WindowListItem[] {
  return windows.map((w) => ({ windowId: w.windowId, label: w.title, focused: w.focused }));
}
