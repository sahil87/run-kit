import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectSession, WindowInfo } from "@/types";
import { SessionContext, useCurrentServerFromRoute } from "@/contexts/session-context";

/**
 * Operator console support — pure helpers for the pull-down operator console
 * overlay (components/operator-console.tsx) plus its entry-point seams:
 *
 *  - `resolveConsoleServer` — the server-context rule: the route's server on
 *    Server/Terminal routes; on Host/Board the sole server when exactly one
 *    exists, else the most recently viewed server (then the first) as the
 *    picker default.
 *  - `findOperatorWindow` — client-side operator discovery from the sessions
 *    payload (`role === "operator"` — server-scoped radio, enforced
 *    backend-side, so the first hit is the only hit).
 *  - `shouldShowAskOperatorRow` — the palette free-text fallback gate: zero
 *    action matches + an operator on the resolved server + a trimmed query at
 *    or above the length floor (short typo fragments never fire a send).
 *  - `requestOperatorConsole` — the document-event seam every entry point
 *    (chord dispatch, palette action, overflow-menu row, sidebar pinned row,
 *    palette fallback row) funnels through to the single layout-mounted
 *    console. An event, not a callback chain: the entry points live in route
 *    shells the layout does not compose directly.
 *  - Per-viewer persisted preferences (geometry, opacity) — localStorage
 *    stores with the in-module pub/sub idiom (`use-local-storage-enum.ts`).
 *  - The open-state slot, the console-origin event predicate, and
 *    `useOperatorConsoleContext` — the read-only server/target resolution the
 *    top-bar button and mobile tongue share with the console.
 */

/** Minimum trimmed query length before the palette's Ask-operator row appears. */
export const ASK_OPERATOR_MIN_QUERY = 3;

/** Document event name carrying `OperatorConsoleRequest` details. */
export const OPERATOR_CONSOLE_EVENT = "rk:operator-console";

export type OperatorConsoleRequest = {
  /** `toggle` flips open/closed; `open` always opens. */
  action: "toggle" | "open";
  /** Pin the console to this server (the sidebar pinned row passes its own
   *  server's name). Absent = resolve from the route/server list. */
  server?: string;
  /** Text to deliver on open, once the operator window resolves (the sessions
   *  slice can lag the open). Never delivered when the resolved server has no
   *  operator window — the console's hint line is the answer there. */
  send?: string;
};

/** Dispatch a console request to the layout-mounted OperatorConsole. */
export function requestOperatorConsole(req: OperatorConsoleRequest): void {
  document.dispatchEvent(new CustomEvent<OperatorConsoleRequest>(OPERATOR_CONSOLE_EVENT, { detail: req }));
}

/** Type guard for the event detail (tolerant of foreign CustomEvents). */
export function isOperatorConsoleRequest(detail: unknown): detail is OperatorConsoleRequest {
  if (typeof detail !== "object" || detail === null) return false;
  const d = detail as Record<string, unknown>;
  return d.action === "toggle" || d.action === "open";
}

/**
 * Resolve the console's server context. `routeServer` (the current route's
 * server param, when any) always wins; Host/Board routes fall to the sole
 * server, then `lastViewed` (still-listed), then the first listed server.
 * `null` only when the server list is empty (still loading or genuinely
 * server-less) — the console degrades to its hint line there.
 */
export function resolveConsoleServer(
  routeServer: string | null,
  servers: readonly string[],
  lastViewed: string | null,
): string | null {
  if (routeServer) return routeServer;
  if (servers.length === 1) return servers[0];
  if (lastViewed && servers.includes(lastViewed)) return lastViewed;
  return servers[0] ?? null;
}

export type OperatorWindowTarget = {
  window: WindowInfo;
  /** The window's session name — TerminalClient's `sessionName` prop. */
  sessionName: string;
};

/**
 * Find the operator window in one server's sessions payload. Ghost/optimistic
 * rows never carry `role`, so a plain field check suffices.
 */
export function findOperatorWindow(sessions: readonly ProjectSession[]): OperatorWindowTarget | undefined {
  for (const session of sessions) {
    for (const win of session.windows) {
      if (win.role === "operator" && win.windowId !== "") {
        return { window: win, sessionName: session.name };
      }
    }
  }
  return undefined;
}

/** The palette fallback-row gate: zero matches, operator present, query at floor. */
export function shouldShowAskOperatorRow(query: string, matchCount: number, hasOperator: boolean): boolean {
  return matchCount === 0 && hasOperator && query.trim().length >= ASK_OPERATOR_MIN_QUERY;
}

// ── Per-viewer persisted preferences (Constitution IV — localStorage) ────────
//
// Two stores, both following the in-module pub/sub idiom of
// `use-local-storage-enum.ts` (the native `storage` event fires only across
// tabs, so same-tab subscribers — the console and the settings-dialog row —
// need the dispatch). Values are continuous, so the enum hook's allowed-list
// validation is replaced by numeric clamping; absent/corrupt/out-of-clamp
// values resolve to the defaults without error.

/** localStorage key for the desktop drawer geometry (`{heightVh, widthPx}`). */
export const CONSOLE_GEOMETRY_KEY = "runkit-operator-console-geometry";
/** localStorage key for the desktop drawer background opacity. */
export const CONSOLE_OPACITY_KEY = "runkit-operator-console-opacity";

export type ConsoleGeometry = { heightVh: number; widthPx: number };

export const CONSOLE_GEOMETRY_DEFAULT: ConsoleGeometry = { heightVh: 55, widthPx: 760 };
export const CONSOLE_HEIGHT_MIN_VH = 25;
export const CONSOLE_HEIGHT_MAX_VH = 85;
export const CONSOLE_WIDTH_MIN_PX = 420;
/** Width ceiling as a fraction of the viewport (96vw). */
export const CONSOLE_WIDTH_MAX_VW = 0.96;

export const CONSOLE_OPACITY_DEFAULT = 0.9;
export const CONSOLE_OPACITY_MIN = 0.75;
export const CONSOLE_OPACITY_MAX = 1.0;

function viewportWidthPx(): number | undefined {
  return typeof window !== "undefined" && Number.isFinite(window.innerWidth)
    ? window.innerWidth
    : undefined;
}

/** Clamp geometry into the supported envelope (25–85vh, 420px–96vw). */
export function clampConsoleGeometry(
  geometry: ConsoleGeometry,
  viewportWidth: number | undefined = viewportWidthPx(),
): ConsoleGeometry {
  const heightVh = Math.min(CONSOLE_HEIGHT_MAX_VH, Math.max(CONSOLE_HEIGHT_MIN_VH, geometry.heightVh));
  const maxWidth = viewportWidth !== undefined ? viewportWidth * CONSOLE_WIDTH_MAX_VW : Infinity;
  const widthPx = Math.min(maxWidth, Math.max(CONSOLE_WIDTH_MIN_PX, geometry.widthPx));
  return { heightVh, widthPx: Math.round(widthPx) };
}

/** Clamp opacity into the supported envelope (0.75–1.0). */
export function clampConsoleOpacity(opacity: number): number {
  return Math.min(CONSOLE_OPACITY_MAX, Math.max(CONSOLE_OPACITY_MIN, opacity));
}

export function readConsoleGeometry(): ConsoleGeometry {
  try {
    const raw = localStorage.getItem(CONSOLE_GEOMETRY_KEY);
    if (raw != null) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        const g = parsed as Record<string, unknown>;
        if (
          typeof g.heightVh === "number" && Number.isFinite(g.heightVh) &&
          typeof g.widthPx === "number" && Number.isFinite(g.widthPx)
        ) {
          return clampConsoleGeometry({ heightVh: g.heightVh, widthPx: g.widthPx });
        }
      }
    }
  } catch {
    // localStorage unavailable (privacy mode, sandboxed iframe) or corrupt JSON
  }
  return CONSOLE_GEOMETRY_DEFAULT;
}

export function readConsoleOpacity(): number {
  try {
    const raw = localStorage.getItem(CONSOLE_OPACITY_KEY);
    if (raw != null) {
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) return clampConsoleOpacity(parsed);
    }
  } catch {
    // localStorage unavailable
  }
  return CONSOLE_OPACITY_DEFAULT;
}

const prefSubscribers = new Map<string, Set<() => void>>();

function notifyPref(storageKey: string): void {
  const listeners = prefSubscribers.get(storageKey);
  if (!listeners) return;
  for (const listener of listeners) listener();
}

function subscribePref(storageKey: string, listener: () => void): () => void {
  let listeners = prefSubscribers.get(storageKey);
  if (!listeners) {
    listeners = new Set();
    prefSubscribers.set(storageKey, listeners);
  }
  listeners.add(listener);
  return () => {
    const set = prefSubscribers.get(storageKey);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) prefSubscribers.delete(storageKey);
  };
}

export function writeConsoleGeometry(geometry: ConsoleGeometry): void {
  const clamped = clampConsoleGeometry(geometry);
  try {
    localStorage.setItem(CONSOLE_GEOMETRY_KEY, JSON.stringify(clamped));
  } catch {
    // localStorage unavailable
  }
  notifyPref(CONSOLE_GEOMETRY_KEY);
}

export function writeConsoleOpacity(opacity: number): void {
  const clamped = clampConsoleOpacity(opacity);
  try {
    localStorage.setItem(CONSOLE_OPACITY_KEY, String(clamped));
  } catch {
    // localStorage unavailable
  }
  notifyPref(CONSOLE_OPACITY_KEY);
}

/** Shared subscribe effect: re-read on same-tab notify, cross-tab `storage`,
 *  and once on mount (in case another subscriber wrote between render and
 *  effect — the use-local-storage-enum resync). */
function usePrefSubscription(storageKey: string, reread: () => void): void {
  useEffect(() => {
    const unsubscribe = subscribePref(storageKey, reread);
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) reread();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("storage", onStorage);
    }
    reread();
    return () => {
      unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("storage", onStorage);
      }
    };
    // reread is a stable setState-derived callback at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
}

/** The desktop drawer's persisted geometry — `[value, setter]` like the other
 *  localStorage hooks. Mobile never resizes (the sheet stays full-height). */
export function useConsoleGeometry(): [ConsoleGeometry, (next: ConsoleGeometry) => void] {
  const [value, setValue] = useState<ConsoleGeometry>(readConsoleGeometry);
  usePrefSubscription(CONSOLE_GEOMETRY_KEY, () => setValue(readConsoleGeometry()));
  return [value, writeConsoleGeometry];
}

/** The desktop drawer's persisted background opacity (0.75–1.0, default 0.90).
 *  1.0 disables the backdrop blur entirely — the zero-cost opaque path. */
export function useConsoleOpacity(): [number, (next: number) => void] {
  const [value, setValue] = useState<number>(readConsoleOpacity);
  usePrefSubscription(CONSOLE_OPACITY_KEY, () => setValue(readConsoleOpacity()));
  return [value, writeConsoleOpacity];
}

// ── Console open-state slot ──────────────────────────────────────────────────
//
// The console's open/closed flag is ephemeral component state, but two
// surfaces need to read it without owning it: the mobile tongue (hidden while
// the sheet covers it) and the file-paste guard. A module slot, published by
// the single layout-mounted console — the compose-strip module-store idiom.

let consoleOpen = false;
const openListeners = new Set<(open: boolean) => void>();

export function isOperatorConsoleOpen(): boolean {
  return consoleOpen;
}

export function setOperatorConsoleOpen(open: boolean): void {
  if (consoleOpen === open) return;
  consoleOpen = open;
  for (const listener of openListeners) listener(open);
}

export function useOperatorConsoleOpen(): boolean {
  const [open, setOpen] = useState(isOperatorConsoleOpen);
  useEffect(() => {
    const listener = (next: boolean) => setOpen(next);
    openListeners.add(listener);
    setOpen(isOperatorConsoleOpen());
    return () => {
      openListeners.delete(listener);
    };
  }, []);
  return open;
}

// ── Console-origin event predicate ───────────────────────────────────────────

/** Attribute on the console's root element, used to recognize paste/drop
 *  events originating inside the console (the route terminals' document-level
 *  file-paste forward must skip them — the console owns its own file path). */
export const OPERATOR_CONSOLE_ROOT_ATTR = "data-operator-console";

/** True when an event target sits inside the console dialog (its xterm helper
 *  textarea and compose textarea both resolve here). */
export function isOperatorConsoleTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${OPERATOR_CONSOLE_ROOT_ATTR}]`) !== null;
}

// ── Shared console-context resolution ────────────────────────────────────────

/**
 * Pure resolution shared by the console's read-only surfaces (the top-bar
 * operator button, the mobile tongue): the console's server rule (route
 * server wins, then sole/last-viewed/first listed) plus the operator-window
 * lookup on the resolved server's sessions payload.
 */
export function resolveOperatorConsoleTarget(
  routeServer: string | null,
  servers: readonly string[],
  sessionsByServer: ReadonlyMap<string, readonly ProjectSession[]> | undefined,
  lastViewed: string | null,
): { server: string | null; target: OperatorWindowTarget | undefined } {
  const server = resolveConsoleServer(routeServer, servers, lastViewed);
  const target = server ? findOperatorWindow(sessionsByServer?.get(server) ?? []) : undefined;
  return { server, target };
}

/**
 * The console's resolved server + operator window for surfaces that only READ
 * the context and lack their own route server (the mobile tongue) — wraps
 * `resolveOperatorConsoleTarget` with the shared route-server walk.
 * `lastViewed` is tracked ephemerally per consumer (no persistence —
 * Constitution IV), matching the console's own ref.
 *
 * Tolerant of a missing provider: the button/tongue are chrome that must
 * degrade to "no operator" (never crash) when mounted outside SessionProvider
 * — e.g. isolated component tests (the useUpdateNotification precedent).
 */
export function useOperatorConsoleContext(): {
  server: string | null;
  target: OperatorWindowTarget | undefined;
} {
  const ctx = useContext(SessionContext);
  const routeServer = useCurrentServerFromRoute();
  const lastViewedRef = useRef<string | null>(null);
  if (routeServer) lastViewedRef.current = routeServer;
  const servers = ctx?.servers ?? [];
  const serverNames = useMemo(() => servers.map((s) => s.name), [servers]);
  const sessionsByServer = ctx?.sessionsByServer;
  return useMemo(
    () => resolveOperatorConsoleTarget(routeServer, serverNames, sessionsByServer, lastViewedRef.current),
    [routeServer, serverNames, sessionsByServer],
  );
}
