import { useEffect, useRef, useState, useCallback } from "react";
import {
  listBoards,
  getBoard,
  type BoardSummary,
  type BoardEntry,
} from "@/api/boards";
import { useSessionContext } from "@/contexts/session-context";

/** Debounce window for coalescing rapid SSE events into one re-fetch. */
const REFETCH_DEBOUNCE_MS = 50;

interface UseBoardsResult {
  boards: BoardSummary[];
  isLoading: boolean;
  error: Error | null;
}

interface UseBoardEntriesResult {
  entries: BoardEntry[];
  isLoading: boolean;
  error: Error | null;
  /** Force a re-fetch of this board's entries, bypassing the SSE debounce.
   *  Used for board-mode self-heal (260715-6jwn): a top-bar ✕ that kills the
   *  last pane of a window collapses its pin-session WITHOUT emitting a
   *  `board-changed` event, so the caller schedules this refetch to drop the
   *  now-dead tile (`getBoard` skips vanished pin-sessions). */
  refetch: () => void;
}

/**
 * Subscribe to board-changed events across all running tmux servers. Returns a
 * function that dispatches the supplied callback when an event arrives.
 * Re-subscribes when the server list changes. Reuses SessionProvider's
 * EventSource pool via attachServer/subscribeBoardChange so we share the
 * per-server SSE connections and stay under the 6-connection cap.
 *
 * Boards are server-scoped (a pinned window's pin-session lives on a single
 * tmux server), but the board LIST is summarized across every reachable server,
 * so we attach all known servers to receive each one's pin/unpin/reorder events.
 */
function useBoardChangedSubscription(onEvent: () => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // Use SessionProvider's EventSource pool instead of opening per-server
  // connections here. We attach all known servers so each server's
  // board-changed events arrive (the board list spans servers).
  const { servers: ctxServers, attachServer, subscribeBoardChange } = useSessionContext();
  useEffect(() => {
    for (const s of ctxServers) attachServer(s.name);
  }, [ctxServers, attachServer]);
  useEffect(() => {
    return subscribeBoardChange(() => {
      onEventRef.current();
    });
  }, [subscribeBoardChange]);
}

/**
 * Subscribe to the server-global `board-order` event (board list display order
 * changed by a reorder on this or another client). Reuses the SessionProvider
 * SSE pool via subscribeBoardOrder — no new EventSource. The event is
 * server-global, so no per-server attach is needed here.
 */
function useBoardOrderSubscription(onEvent: () => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const { subscribeBoardOrder } = useSessionContext();
  useEffect(() => {
    return subscribeBoardOrder(() => {
      onEventRef.current();
    });
  }, [subscribeBoardOrder]);
}

/**
 * useBoards returns the display-ordered list of boards aggregated across servers
 * with live updates. The backend-sorted `GET /api/boards` response IS the
 * display order (single sort choke point). Initial fetch on mount, plus
 * subscription to board-changed events on every server AND the server-global
 * board-order event (a reorder re-sorts every client via a debounced re-fetch).
 *
 * Multiple rapid events are debounced into a single re-fetch (REFETCH_DEBOUNCE_MS)
 * so cross-server SSE chatter doesn't trigger N requests.
 */
export function useBoards(): UseBoardsResult {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchBoards = useCallback(async () => {
    try {
      const data = await listBoards();
      setBoards(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      // Preserve previous boards on transient error; only update error state.
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoards();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchBoards]);

  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchBoards();
    }, REFETCH_DEBOUNCE_MS);
  }, [fetchBoards]);

  useBoardChangedSubscription(scheduleRefetch);
  useBoardOrderSubscription(scheduleRefetch);

  return { boards, isLoading, error };
}

/**
 * useBoardEntries fetches and live-updates a specific board's entries.
 * Subscribes to board-changed events on every server (the board list spans
 * servers, so a pin/unpin on any server may affect this board).
 */
export function useBoardEntries(name: string): UseBoardEntriesResult {
  const [entries, setEntries] = useState<BoardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchEntries = useCallback(async () => {
    if (!name) return;
    try {
      const data = await getBoard(name);
      setEntries(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [name]);

  useEffect(() => {
    fetchEntries();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchEntries]);

  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchEntries();
    }, REFETCH_DEBOUNCE_MS);
  }, [fetchEntries]);

  useBoardChangedSubscription(scheduleRefetch);

  return { entries, isLoading, error, refetch: fetchEntries };
}
