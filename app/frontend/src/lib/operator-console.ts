import type { ProjectSession, WindowInfo } from "@/types";

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
