import { useEffect, useRef, useState, useCallback } from "react";
import { listBoards, getBoard, type BoardSummary } from "@/api/boards";
import { useSessionContext } from "@/contexts/session-context";

/**
 * Aggregate pin state across all boards. Returns:
 *   - boards: alphabetical board summaries
 *   - pinnedSet: Set<"<server>:<windowId>"> — windows pinned to ANY board
 *   - pinnedToBoard: (board, server, windowId) → boolean — pinned to a specific
 *     board
 *
 * Used by sidebar/window-row to render the pin icon (filled vs outline) and
 * the active-board highlight.
 *
 * Implementation: refreshes the full board map on every board-changed
 * event from any server (debounced). For each board listed, we fetch its
 * entries; the result is a flat map.
 *
 * Cost: O(boards) HTTP calls per refresh — acceptable since the typical user
 * has a small number of boards (<10) and refreshes only fire on actual pin
 * mutations, not on every poll-tick.
 */
const REFETCH_DEBOUNCE_MS = 50;

export interface WindowPinsResult {
  boards: BoardSummary[];
  pinnedSet: Set<string>;
  pinnedToBoard: (board: string, server: string, windowId: string) => boolean;
  /**
   * The single board a window is pinned to, or undefined if unpinned (co9z). A
   * window has exactly one `_rk-pin-*` pin-session → exactly one board, so the
   * reverse lookup is unambiguous. Powers the sidebar pinned-row → board
   * navigation affordance.
   */
  boardForWindow: (server: string, windowId: string) => string | undefined;
  isLoading: boolean;
}

function pinKey(server: string, windowId: string): string {
  return `${server}:${windowId}`;
}

export function useWindowPins(): WindowPinsResult {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [pinnedSet, setPinnedSet] = useState<Set<string>>(() => new Set());
  const [perBoard, setPerBoard] = useState<Map<string, Set<string>>>(() => new Map());
  // pinKey → board name (reverse lookup; one pin-session per window → one board).
  const [windowToBoard, setWindowToBoard] = useState<Map<string, string>>(() => new Map());
  const [isLoading, setIsLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const list = await listBoards();
      const safe = Array.isArray(list) ? list : [];
      setBoards(safe);
      const newPerBoard = new Map<string, Set<string>>();
      const newPinned = new Set<string>();
      const newWindowToBoard = new Map<string, string>();
      // Fetch all board entries in parallel for the union view.
      const results = await Promise.all(
        safe.map(async (b) => {
          try {
            const entries = await getBoard(b.name);
            return { name: b.name, entries };
          } catch {
            return { name: b.name, entries: [] };
          }
        }),
      );
      for (const { name, entries } of results) {
        const set = new Set<string>();
        for (const e of entries) {
          const k = pinKey(e.server, e.windowId);
          set.add(k);
          newPinned.add(k);
          // One pin-session per window → one board. If a window somehow appears
          // on two boards (should not happen), first-listed wins; harmless for
          // the navigation affordance.
          if (!newWindowToBoard.has(k)) newWindowToBoard.set(k, name);
        }
        newPerBoard.set(name, set);
      }
      setPerBoard(newPerBoard);
      setPinnedSet(newPinned);
      setWindowToBoard(newWindowToBoard);
    } catch {
      // best effort — preserve previous values
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchAll]);

  // Subscribe to board-changed events through the SessionProvider's state
  // socket; every attached server's events ride the one muxed connection, so
  // no per-server connections are opened here.
  // Attach all known servers so board-changed events from non-current servers
  // are received — boards are explicitly cross-server.
  const { servers, attachServer, subscribeBoardChange } = useSessionContext();
  useEffect(() => {
    for (const s of servers) attachServer(s.name);
  }, [servers, attachServer]);
  useEffect(() => {
    return subscribeBoardChange(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchAll();
      }, REFETCH_DEBOUNCE_MS);
    });
  }, [subscribeBoardChange, fetchAll]);

  const pinnedToBoard = useCallback(
    (board: string, server: string, windowId: string): boolean => {
      const set = perBoard.get(board);
      if (!set) return false;
      return set.has(pinKey(server, windowId));
    },
    [perBoard],
  );

  const boardForWindow = useCallback(
    (server: string, windowId: string): string | undefined =>
      windowToBoard.get(pinKey(server, windowId)),
    [windowToBoard],
  );

  return { boards, pinnedSet, pinnedToBoard, boardForWindow, isLoading };
}
