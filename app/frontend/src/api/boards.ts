import { deduplicatedFetch, throwOnError } from "./client";

/** Pane info aggregated from list-panes for an entry's window. Mirrors the backend's PaneInfo. */
export interface BoardPaneInfo {
  paneId: string;
  paneIndex: number;
  cwd: string;
  command: string;
  isActive: boolean;
  gitBranch?: string;
}

/** Board summary (list view). Returned alphabetically by `name`. */
export interface BoardSummary {
  name: string;
  pinCount: number;
}

/** A single pinned-window entry on a board, joined with live window data for rendering. */
export interface BoardEntry {
  server: string;
  windowId: string;
  session: string;
  windowIndex: number;
  windowName: string;
  orderKey: string;
  panes?: BoardPaneInfo[];
}

/** Response from POST /api/boards/{name}/reorder. */
export interface ReorderResponse {
  ok: true;
  newOrderKey: string;
}

/** GET /api/boards — aggregated across all servers, sorted by name. */
export async function listBoards(): Promise<BoardSummary[]> {
  const res = await deduplicatedFetch("/api/boards");
  if (!res.ok) await throwOnError(res);
  return res.json();
}

/** GET /api/boards/{name} — entries for a single board, sorted by orderKey. */
export async function getBoard(name: string): Promise<BoardEntry[]> {
  const res = await deduplicatedFetch(`/api/boards/${encodeURIComponent(name)}`);
  if (!res.ok) await throwOnError(res);
  return res.json();
}

/**
 * POST /api/boards/{name}/pin — pin a window on a specific server to the
 * named board. `server` is the FIRST positional arg per the project's
 * server-routing contract; it travels in the JSON body, not the query.
 */
export async function pinWindow(
  server: string,
  windowId: string,
  board: string,
): Promise<{ ok: true }> {
  const res = await fetch(`/api/boards/${encodeURIComponent(board)}/pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ server, windowId }),
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

/** POST /api/boards/{name}/unpin — symmetric with pinWindow. */
export async function unpinWindow(
  server: string,
  windowId: string,
  board: string,
): Promise<{ ok: true }> {
  const res = await fetch(`/api/boards/${encodeURIComponent(board)}/unpin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ server, windowId }),
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

/**
 * POST /api/boards/{name}/reorder — server computes the new order key via
 * fractional indexing. `before` and `after` are sibling windowIds on the
 * board (or null for prepend/append).
 */
export async function reorderPin(
  server: string,
  windowId: string,
  board: string,
  before: string | null,
  after: string | null,
): Promise<ReorderResponse> {
  // `before`/`after` are sent as JSON `null` for prepend/append per the
  // documented API contract. The backend accepts both `null` and `""` for
  // backward compatibility, but `null` is the canonical wire form.
  const res = await fetch(`/api/boards/${encodeURIComponent(board)}/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      server,
      windowId,
      before,
      after,
    }),
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}
