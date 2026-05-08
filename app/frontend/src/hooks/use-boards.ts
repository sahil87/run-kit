import { useEffect, useRef, useState, useCallback } from "react";
import {
  listBoards,
  getBoard,
  type BoardSummary,
  type BoardEntry,
} from "@/api/boards";
import { listServers } from "@/api/client";

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
}

/**
 * Subscribe to the union of board-changed events across all running tmux
 * servers. Returns a function that dispatches the supplied callback when an
 * event arrives. Re-subscribes when the server list changes. Each connection
 * is its own EventSource — mirrors the per-server SSE pattern in
 * session-context.tsx (boards span servers, so we open multiple).
 */
function useBoardChangedSubscription(onEvent: () => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const [serverNames, setServerNames] = useState<string[]>([]);
  const refreshServers = useCallback(async () => {
    try {
      const list = await listServers();
      setServerNames(list.map((s) => s.name).sort());
    } catch {
      // best-effort: SSE will retry on next mount cycle
    }
  }, []);

  useEffect(() => {
    refreshServers();
  }, [refreshServers]);

  useEffect(() => {
    if (serverNames.length === 0) return;
    const sources: EventSource[] = serverNames.map((server) => {
      const es = new EventSource(`/api/sessions/stream?server=${encodeURIComponent(server)}`);
      es.addEventListener("board-changed", () => {
        onEventRef.current();
      });
      return es;
    });
    return () => {
      for (const es of sources) es.close();
    };
  }, [serverNames]);
}

/**
 * useBoards returns the alphabetical list of boards aggregated across servers
 * with live updates. Initial fetch on mount, plus subscription to
 * board-changed events on every server.
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

  return { boards, isLoading, error };
}

/**
 * useBoardEntries fetches and live-updates a specific board's entries.
 * Subscribes to board-changed events on every server (boards span servers).
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

  return { entries, isLoading, error };
}
