import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  startTransition,
} from "react";
import { useMatches } from "@tanstack/react-router";
import { useChromeDispatch } from "./chrome-context";
import { listServers, type ServerInfo } from "@/api/client";
import type { MetricsSnapshot, ProjectSession } from "@/types";

const SERVER_STORAGE_KEY = "runkit-server";

/** Multi-server SessionContext shape. State is keyed by server name; one
 *  EventSource is opened lazily per *attached* server (current server is
 *  always attached automatically; non-current servers attach when a consumer
 *  calls `attachServer(name)` — typically when a sidebar group is expanded).
 *  Lazy-attach is required because the browser caps concurrent HTTP/1.1
 *  connections per origin at 6, and other hooks (`useBoards`,
 *  `useWindowPins`) historically opened their own per-server EventSources
 *  for `board-changed` events; those hooks now subscribe to this provider's
 *  `subscribeBoardChange` API to avoid duplicating ES connections.
 *  `currentServer` is dispatched by the matched route — `params.server` for
 *  `/$server/...`, `null` for `/board/$name` and `/`. */
export type SessionContextType = {
  sessionsByServer: Map<string, ProjectSession[]>;
  sessionOrderByServer: Map<string, string[]>;
  isConnectedByServer: Map<string, boolean>;
  metricsByServer: Map<string, MetricsSnapshot | null>;
  currentServer: string | null;
  servers: ServerInfo[];
  refreshServers: () => void;
  /** Mark a server as "attached" so the provider opens its EventSource. Idempotent.
   *  The current server is auto-attached; this is for non-current servers
   *  (sidebar groups expanded by the user). */
  attachServer: (name: string) => void;
  /** Subscribe to board-changed events on any attached server. Returns an
   *  unsubscribe function. The handler receives the source server name. */
  subscribeBoardChange: (handler: (server: string) => void) => () => void;
};

export const SessionContext = createContext<SessionContextType | null>(null);

// Metrics live in a separate context so that the ~2.5s metrics stream does not
// cascade re-renders through the whole app tree — only HostPanel subscribes.
// The default sentinel is `undefined` so `useMetrics()` can distinguish
// "outside provider" (throw) from the valid "no metrics yet" state (`null`).
const MetricsContext = createContext<MetricsSnapshot | null | undefined>(undefined);

type SessionProviderProps = {
  children: React.ReactNode;
};

/** Per-server state slice held inside the provider. Lives in plain state
 *  (immutable Maps re-created on update so consumers see new references). */
type ServerSlice = {
  sessions: ProjectSession[];
  sessionOrder: string[];
  isConnected: boolean;
  metrics: MetricsSnapshot | null;
};

const EMPTY_SLICE: ServerSlice = {
  sessions: [],
  sessionOrder: [],
  isConnected: false,
  metrics: null,
};

/** Read `currentServer` from the matched route. Returns the server param when
 *  the deepest match has one (AppShell routes), otherwise `null` (board, index). */
function useCurrentServerFromRoute(): string | null {
  const matches = useMatches();
  // Walk matches from deepest first looking for a `server` param. This is
  // resilient to the route-tree shape — `/$server/$session/$window` puts
  // `server` on the layout match while child matches inherit it.
  for (let i = matches.length - 1; i >= 0; i--) {
    const params = (matches[i]?.params ?? {}) as Record<string, string | undefined>;
    if (typeof params.server === "string" && params.server.length > 0) {
      return params.server;
    }
  }
  return null;
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [slicesByServer, setSlicesByServer] = useState<Map<string, ServerSlice>>(
    () => new Map(),
  );
  const [servers, setServers] = useState<ServerInfo[]>([]);
  // Lazy-attach set: which servers should have an EventSource open. The
  // current server is automatically included; non-current servers must opt
  // in (typically when their sidebar group is expanded). See the
  // `SessionContextType` doc for why eager-attach blows past the browser's
  // 6-connection-per-origin cap.
  const [attachedNonCurrent, setAttachedNonCurrent] = useState<Set<string>>(() => new Set());
  const { setIsConnected: setChromeConnected } = useChromeDispatch();
  const currentServer = useCurrentServerFromRoute();

  const attachServer = useCallback((name: string) => {
    setAttachedNonCurrent((prev) => {
      if (prev.has(name)) return prev;
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  }, []);

  // Board-changed event subscribers. Stored in a ref so the SSE listener
  // (set up inside the pool effect) can fire all subscribers without
  // re-running on every subscriber registration.
  const boardChangeSubscribersRef = useRef<Set<(server: string) => void>>(new Set());
  const subscribeBoardChange = useCallback((handler: (server: string) => void) => {
    boardChangeSubscribersRef.current.add(handler);
    return () => {
      boardChangeSubscribersRef.current.delete(handler);
    };
  }, []);

  // Effective attach set = currentServer ∪ attachedNonCurrent ∩ knownServers.
  // We intersect with known servers so that disappeared servers don't keep ES open.
  const attachedSet = useMemo(() => {
    const set = new Set<string>();
    const known = new Set(servers.map((s) => s.name));
    if (currentServer && known.has(currentServer)) set.add(currentServer);
    for (const n of attachedNonCurrent) {
      if (known.has(n)) set.add(n);
    }
    return set;
  }, [currentServer, attachedNonCurrent, servers]);

  // Persist last-used server to localStorage when on an AppShell route.
  useEffect(() => {
    if (!currentServer) return;
    try {
      localStorage.setItem(SERVER_STORAGE_KEY, currentServer);
    } catch {
      // localStorage unavailable
    }
  }, [currentServer]);

  // Mirror the current server's connection state into ChromeContext so the
  // existing connection dot in the top bar continues to reflect the active
  // server's SSE state. Single-server behavior preserved.
  useEffect(() => {
    if (!currentServer) {
      setChromeConnected(false);
      return;
    }
    const slice = slicesByServer.get(currentServer);
    setChromeConnected(slice?.isConnected ?? false);
  }, [currentServer, slicesByServer, setChromeConnected]);

  const fetchServers = useCallback(async () => {
    try {
      const data = await listServers();
      setServers(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  /** Helper — apply a partial update to a server's slice, replacing the Map
   *  reference so React picks up the change. Skips the update if the server
   *  no longer exists (race: cleanup happened mid-update). */
  const updateSlice = useCallback(
    (server: string, partial: Partial<ServerSlice>, requireExisting = false) => {
      setSlicesByServer((prev) => {
        const existing = prev.get(server);
        if (requireExisting && !existing) return prev;
        const next = new Map(prev);
        next.set(server, { ...EMPTY_SLICE, ...existing, ...partial });
        return next;
      });
    },
    [],
  );

  // EventSource pool — open one per server in `servers`, close when a server
  // disappears. Tracked by a stable ref of {server -> {es, prevSseData,
  // disconnectTimer}} so reconnect/cleanup are deterministic.
  type PoolEntry = {
    es: EventSource;
    prevSseData: string;
    disconnectTimer: ReturnType<typeof setTimeout> | null;
  };
  type Pool = Map<string, PoolEntry>;
  const poolRef = useRef<Pool>(new Map());

  // Single combined effect that maintains the pool diff-style. The cleanup
  // closes ALL pooled EventSources — important for Strict Mode dev where the
  // effect runs cleanup-then-effect; without close() in cleanup, the second
  // run would skip opening (pool.has) and the SSE handlers from the first run
  // would be orphans pointing at closed connections.
  useEffect(() => {
    const pool = poolRef.current;
    // Open ES only for *attached* servers. `attachedSet` is the
    // intersection of (currentServer ∪ user-expanded sidebar groups) and the
    // known servers list. Lazy-attach keeps us under the 6-connection cap.
    const desired = attachedSet;

    // Open EventSources for newly-attached servers.
    for (const name of desired) {
      if (pool.has(name)) continue;
      const es = new EventSource(
        `/api/sessions/stream?server=${encodeURIComponent(name)}`,
      );
      const entry: PoolEntry = {
        es,
        prevSseData: "",
        disconnectTimer: null,
      };
      pool.set(name, entry);

      // Initialize the slice so consumers see a stable empty value before
      // the first event arrives. Use updateSlice with a known-empty shape;
      // subsequent updates merge into it.
      updateSlice(name, EMPTY_SLICE);

      const markConnected = () => {
        if (entry.disconnectTimer) {
          clearTimeout(entry.disconnectTimer);
          entry.disconnectTimer = null;
        }
        updateSlice(name, { isConnected: true }, true);
      };

      const markDisconnected = () => {
        updateSlice(name, { isConnected: false }, true);
      };

      es.addEventListener("sessions", (e: MessageEvent) => {
        try {
          if (e.data === entry.prevSseData) {
            markConnected();
            return;
          }
          entry.prevSseData = e.data;
          const data = JSON.parse(e.data) as ProjectSession[];
          // Batch sessions + connected in the same transition so consumers
          // never see isConnected=true with stale/empty sessions.
          startTransition(() => {
            updateSlice(name, { sessions: data, isConnected: true }, true);
            if (entry.disconnectTimer) {
              clearTimeout(entry.disconnectTimer);
              entry.disconnectTimer = null;
            }
          });
        } catch {
          // Malformed event — skip
        }
      });

      es.addEventListener("metrics", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as MetricsSnapshot;
          updateSlice(name, { metrics: data }, true);
        } catch {
          // Malformed metrics event — skip
        }
      });

      es.addEventListener("session-order", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { server?: string; order?: string[] };
          // Backend already filters by client.server; double-check here so a
          // misrouted event (e.g., due to a bug or proxy reorder) cannot
          // contaminate another server's order.
          if (data.server !== name) return;
          updateSlice(
            name,
            { sessionOrder: Array.isArray(data.order) ? data.order : [] },
            true,
          );
        } catch {
          // Malformed event — skip
        }
      });

      // board-changed — re-broadcast to any registered subscriber.
      // useBoards / useWindowPins consume this instead of opening their own
      // per-server EventSources, which would otherwise multiply connections
      // past the browser's HTTP/1.1 6-per-origin cap.
      es.addEventListener("board-changed", () => {
        for (const handler of boardChangeSubscribersRef.current) {
          try {
            handler(name);
          } catch {
            // ignore individual subscriber errors
          }
        }
      });

      es.onerror = () => {
        if (!entry.disconnectTimer) {
          entry.disconnectTimer = setTimeout(markDisconnected, 3000);
        }
      };

      es.onopen = () => {
        // Don't markConnected() here — wait for the first "sessions" event
        // so consumers see isConnected=true only when session data is
        // available. Mirrors the previous single-server behavior.
      };
    }

    // Close EventSources for servers that disappeared.
    for (const [name, entry] of pool) {
      if (desired.has(name)) continue;
      if (entry.disconnectTimer) clearTimeout(entry.disconnectTimer);
      entry.es.close();
      pool.delete(name);
      setSlicesByServer((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Map(prev);
        next.delete(name);
        return next;
      });
    }

    // No cleanup — pool persists across effect re-runs and unmount/remount
    // cycles in Strict Mode dev. Real cleanup happens implicitly when the
    // window unloads. The pool dedupes via `pool.has(name)` so re-runs are
    // safe without close-then-reopen.
  }, [attachedSet, updateSlice]);

  // Derive per-field Maps from the slice Map. Memoized so unrelated re-renders
  // don't churn consumer references. Each Map is a fresh reference whenever
  // any slice changes — that's intentional: a consumer reading `sessionsByServer`
  // wants to re-render when any server's sessions change. Per-server fine-grained
  // memoization is a future optimization if needed.
  const sessionsByServer = useMemo(() => {
    const m = new Map<string, ProjectSession[]>();
    for (const [name, slice] of slicesByServer) m.set(name, slice.sessions);
    return m;
  }, [slicesByServer]);

  const sessionOrderByServer = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [name, slice] of slicesByServer) m.set(name, slice.sessionOrder);
    return m;
  }, [slicesByServer]);

  const isConnectedByServer = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const [name, slice] of slicesByServer) m.set(name, slice.isConnected);
    return m;
  }, [slicesByServer]);

  const metricsByServer = useMemo(() => {
    const m = new Map<string, MetricsSnapshot | null>();
    for (const [name, slice] of slicesByServer) m.set(name, slice.metrics);
    return m;
  }, [slicesByServer]);

  const value = useMemo<SessionContextType>(
    () => ({
      sessionsByServer,
      sessionOrderByServer,
      isConnectedByServer,
      metricsByServer,
      currentServer,
      servers,
      refreshServers: fetchServers,
      attachServer,
      subscribeBoardChange,
    }),
    [
      sessionsByServer,
      sessionOrderByServer,
      isConnectedByServer,
      metricsByServer,
      currentServer,
      servers,
      fetchServers,
      attachServer,
      subscribeBoardChange,
    ],
  );

  // Provide metrics for the current server only — HostPanel and other current-
  // server-scoped consumers continue to call `useMetrics()` unchanged.
  const currentMetrics = currentServer ? metricsByServer.get(currentServer) ?? null : null;

  return (
    <SessionContext.Provider value={value}>
      <MetricsContext.Provider value={currentMetrics}>
        {children}
      </MetricsContext.Provider>
    </SessionContext.Provider>
  );
}

export function useSessionContext(): SessionContextType {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSessionContext must be used within SessionProvider");
  return ctx;
}

export function useMetrics(): MetricsSnapshot | null {
  const ctx = useContext(MetricsContext);
  if (ctx === undefined) throw new Error("useMetrics must be used within SessionProvider");
  return ctx;
}

// Standalone provider for tests and storybook — supplies a `null` or fake
// metrics value without requiring the full SessionProvider (which opens an
// EventSource).
export function MetricsProvider({
  value,
  children,
}: {
  value: MetricsSnapshot | null;
  children: React.ReactNode;
}) {
  return <MetricsContext.Provider value={value}>{children}</MetricsContext.Provider>;
}

/** Standalone provider for tests — supplies a static SessionContext value
 *  without opening an EventSource. Counterpart to `MetricsProvider` above.
 *  Accepts a partial multi-server shape and fills missing fields with safe
 *  defaults. */
export function StandaloneSessionContextProvider({
  value,
  children,
}: {
  value: Partial<SessionContextType>;
  children: React.ReactNode;
}) {
  const fullValue: SessionContextType = {
    sessionsByServer: value.sessionsByServer ?? new Map(),
    sessionOrderByServer: value.sessionOrderByServer ?? new Map(),
    isConnectedByServer: value.isConnectedByServer ?? new Map(),
    metricsByServer: value.metricsByServer ?? new Map(),
    currentServer: value.currentServer ?? null,
    servers: value.servers ?? [],
    refreshServers: value.refreshServers ?? (() => {}),
    attachServer: value.attachServer ?? (() => {}),
    subscribeBoardChange: value.subscribeBoardChange ?? (() => () => {}),
  };
  return <SessionContext.Provider value={fullValue}>{children}</SessionContext.Provider>;
}
