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
import { listServers, setPreviewScope as apiSetPreviewScope, type ServerInfo } from "@/api/client";
import type { MetricsSnapshot, ProjectSession, Service, ServicesSnapshot } from "@/types";

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
  /** Health of the host-metrics source that feeds `useHostMetrics()` — true
   *  when host metrics are flowing (260704-9o7k, for the Cockpit connection
   *  dot). When no per-server stream is attached this is the dedicated
   *  `?metrics=1` stream's health; otherwise it derives from whether any
   *  attached server's per-server stream is connected (the metrics fan-out
   *  source). */
  hostMetricsConnected: boolean;
  metricsByServer: Map<string, MetricsSnapshot | null>;
  /** Per-server map of `windowId → pane-text preview` for the tile grid. Only
   *  windows in sessions the client declared expanded (via `setPreviewScope`)
   *  are populated; delivered over the SSE `event: preview`. */
  previewsByServer: Map<string, Record<string, string>>;
  /** Declare which sessions the tile grid has expanded for a server, so the
   *  backend captures previews only for those windows. Posts to
   *  `/api/preview-scope` with the server's SSE connection id. */
  setPreviewScope: (server: string, expanded: string[]) => void;
  currentServer: string | null;
  servers: ServerInfo[];
  refreshServers: () => void;
  /** True once the first `fetchServers()` call has settled (even to an empty
   *  list or a caught error). Lets the route guard distinguish "list still
   *  loading" from "server genuinely absent" — the explicit replacement for
   *  the buggy `servers.length > 0` proxy. */
  serversLoaded: boolean;
  /** The name of a server the user just created and navigated to, which may
   *  not yet appear in `servers` (the refreshed list is in flight). The route
   *  guard renders a brief waiting state for this server instead of "not
   *  found"; it is cleared automatically once the refreshed list contains it
   *  (or on a failed create). `null` when no create is in flight. */
  pendingServer: string | null;
  /** Mark a server as "pending" (just created, awaiting list refresh). */
  markServerPending: (name: string) => void;
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

// Host metrics live in their OWN context, fed by a dedicated server-independent
// EventSource (see the host-metrics effect below). Unlike `MetricsContext`
// (which carries the current server's slice and is `null` on `/`), this context
// carries the host-global `event: metrics` broadcast and is available on EVERY
// route — including `/`, where there is no `currentServer`. The `event: metrics`
// broadcast is server-independent server-side (see api/sse.go poll loop), so a
// single stream suffices regardless of how many servers are attached. Same
// `undefined` sentinel idiom as `MetricsContext` — distinguishes
// "outside provider" (throw) from "no metrics yet" (`null`).
const HostMetricsContext = createContext<MetricsSnapshot | null | undefined>(undefined);

// Host listening-services live in their OWN context, fed by the same
// server-independent broadcast as host metrics (the `event: services` frame
// rides every stream — the dedicated `?metrics=1` stream and each per-server
// stream — exactly like `event: metrics`). Separated from HostMetricsContext so
// the ~2.5s services stream does not cascade re-renders into metrics-only
// consumers. The `undefined` sentinel distinguishes "outside provider" (throw)
// from the valid "no services yet" state (`[]`).
const HostServicesContext = createContext<Service[] | undefined>(undefined);

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
  previews: Record<string, string>;
};

const EMPTY_SLICE: ServerSlice = {
  sessions: [],
  sessionOrder: [],
  isConnected: false,
  metrics: null,
  previews: {},
};

/** Read `currentServer` from the matched route. Returns the server param when
 *  the deepest match has one (AppShell routes), otherwise `null` (board, index). */
function useCurrentServerFromRoute(): string | null {
  const matches = useMatches();
  // Walk matches from deepest first looking for a `server` param. This is
  // resilient to the route-tree shape — `/$server/$window` puts
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
  // False until the first `fetchServers()` settles. The route guard uses this
  // (not `servers.length > 0`) to know the list has loaded.
  const [serversLoaded, setServersLoaded] = useState(false);
  // Name of a just-created server awaiting the list refresh (waiting state).
  const [pendingServer, setPendingServer] = useState<string | null>(null);
  // Lazy-attach set: which servers should have an EventSource open. The
  // current server is automatically included; non-current servers must opt
  // in (typically when their sidebar group is expanded). See the
  // `SessionContextType` doc for why eager-attach blows past the browser's
  // 6-connection-per-origin cap.
  const [attachedNonCurrent, setAttachedNonCurrent] = useState<Set<string>>(() => new Set());
  // Latest host-global metrics snapshot from the dedicated server-independent
  // stream (see the host-metrics effect below). `null` until the first tick.
  const [hostMetrics, setHostMetrics] = useState<MetricsSnapshot | null>(null);
  // Health of the DEDICATED `?metrics=1` stream (260704-9o7k). Set true on its
  // first metrics event, cleared via a 3s debounce on error — mirrors the
  // per-server slice `isConnected` lifecycle. Only meaningful while the
  // dedicated stream is the host-metrics source (attached set empty); when a
  // per-server stream carries the fan-out the derived value below reads from
  // per-server connectedness instead. `false` until the first dedicated event.
  const [dedicatedMetricsConnected, setDedicatedMetricsConnected] = useState(false);
  // Latest host-global listening services from the same server-independent
  // broadcast (`event: services`). Empty array until the first tick — never
  // null, so `/` consumers can map over it unconditionally.
  const [hostServices, setHostServices] = useState<Service[]>([]);
  const { setIsConnected: setChromeConnected } = useChromeDispatch();
  const currentServer = useCurrentServerFromRoute();

  // Last raw host-metrics event payload applied to `hostMetrics`, shared across
  // ALL sources (every per-server stream's `metrics` fan-out + the dedicated
  // `?metrics=1` stream). The `event: metrics` broadcast is server-global —
  // identical on every stream — so on multi-server routes (boards) the same
  // payload arrives once per attached server per tick. Without this guard, each
  // arrival would call `setHostMetrics` with a freshly-parsed (referentially-
  // new) object, forcing a redundant HostMetricsContext re-render per attached
  // server per tick. Deduping on the raw event string collapses those to one
  // state update per distinct payload.
  const hostMetricsPrevRef = useRef<string>("");
  const applyHostMetrics = useCallback((raw: string, snap: MetricsSnapshot) => {
    if (raw === hostMetricsPrevRef.current) return;
    hostMetricsPrevRef.current = raw;
    setHostMetrics(snap);
  }, []);

  // Same raw-payload dedup as `applyHostMetrics`, for `event: services`. The
  // services broadcast is server-global (identical on every stream), so on
  // multi-server routes the same payload arrives once per attached server per
  // tick; deduping on the raw string collapses those to one state update.
  const hostServicesPrevRef = useRef<string>("");
  const applyHostServices = useCallback((raw: string, services: Service[]) => {
    if (raw === hostServicesPrevRef.current) return;
    hostServicesPrevRef.current = raw;
    setHostServices(services);
  }, []);

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
    } finally {
      // The fetch attempt has settled (success, empty, or caught error) — the
      // list is now "loaded" for the purposes of the route guard. A permanent
      // false here would hang the guard's not-found branch forever.
      setServersLoaded(true);
    }
  }, []);

  // Set the pending server. An empty string clears it (`null`) — used by the
  // create flow's rollback path so a failed create never strands the waiting
  // state. A real route's `server` param is never empty, so a cleared `null`
  // can never spuriously match the guard.
  const markServerPending = useCallback((name: string) => {
    setPendingServer(name || null);
  }, []);

  // Clear the pending marker once the refreshed list contains it, so the
  // waiting state swaps to the server view automatically and a *later* genuine
  // deletion of that same server correctly shows "Server not found" again
  // (rather than spinning on a stale marker). Runs as an effect, never during
  // render. No timer — event-driven on the list changing.
  useEffect(() => {
    if (pendingServer && servers.some((s) => s.name === pendingServer)) {
      setPendingServer(null);
    }
  }, [pendingServer, servers]);

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
    /** Client-generated id for THIS SSE connection, passed as `&conn=` on the
     *  stream URL and reused in `setPreviewScope` POSTs so the backend keys the
     *  per-connection preview-scope state to the right stream. */
    connId: string;
  };
  type Pool = Map<string, PoolEntry>;
  const poolRef = useRef<Pool>(new Map());

  // Per-server SSE connection id, mirrored out of the pool so `setPreviewScope`
  // (a context method, not inside the pool effect) can read the current id.
  const connIdByServerRef = useRef<Map<string, string>>(new Map());

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
      const connId = crypto.randomUUID();
      const es = new EventSource(
        `/api/sessions/stream?server=${encodeURIComponent(name)}&conn=${encodeURIComponent(connId)}`,
      );
      const entry: PoolEntry = {
        es,
        prevSseData: "",
        disconnectTimer: null,
        connId,
      };
      pool.set(name, entry);
      connIdByServerRef.current.set(name, connId);

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
        // Fallback for a catastrophic socket death the backend couldn't signal
        // with a `server-gone` event (e.g. the daemon itself is mid-restart):
        // re-query /api/servers so a genuinely-gone server drops out of the
        // list and `resolveServerView` flips to the not-found view. Idempotent
        // — if the server is still alive it simply reappears in the list.
        fetchServers();
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
          // The `event: metrics` broadcast is server-global (identical payload
          // on every per-server stream — see api/sse.go poll loop), so any
          // attached server's metrics event is a valid host-metrics source.
          // Feed it into hostMetrics too, so `useHostMetrics()` stays live
          // WITHOUT the dedicated `?metrics=1` stream: that stream is closed
          // whenever a per-server stream is open (see the host-metrics effect
          // below), and this fan-out supplies host metrics in its place.
          // Dedupe on the raw payload so multiple attached servers delivering
          // the same server-global snapshot in one tick set state only once.
          applyHostMetrics(e.data, data);
        } catch {
          // Malformed metrics event — skip
        }
      });

      // `event: services` is server-global too (same payload on every stream —
      // see api/sse.go poll loop), so any attached server's stream is a valid
      // host-services source. Feed it into hostServices via the shared dedup so
      // `useHostServices()` stays live WITHOUT the dedicated `?metrics=1` stream
      // (which is closed whenever a per-server stream is open). Mirrors the
      // metrics fan-out above.
      es.addEventListener("services", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as ServicesSnapshot;
          applyHostServices(e.data, Array.isArray(data.services) ? data.services : []);
        } catch {
          // Malformed services event — skip
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

      // preview — pane-text snapshots for the tile grid, keyed by windowId.
      // Bounded server-side to the sessions this connection declared expanded
      // (setPreviewScope).
      es.addEventListener("preview", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as Record<string, string>;
          // Merge into the existing previews rather than replacing: a preview
          // event carries only the subset of windows captured this tick (a
          // window omitted due to a capture error is absent from `data`), so a
          // wholesale replace would clobber previously-received previews for
          // the other windows in the expanded set.
          setSlicesByServer((prev) => {
            const existing = prev.get(name);
            if (!existing) return prev;
            const next = new Map(prev);
            next.set(name, {
              ...existing,
              previews: { ...existing.previews, ...data },
            });
            return next;
          });
        } catch {
          // Malformed preview event — skip
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

      // server-gone — the backend reaped this server from its poll set because
      // its tmux socket is gone. Tear down the stream exactly like the pool-diff
      // cleanup below (clear timer, close ES, drop pool + slice), then re-query
      // /api/servers so the now-absent server drops from the list and
      // `resolveServerView` flips a viewer to the existing not-found view.
      es.addEventListener("server-gone", () => {
        if (entry.disconnectTimer) clearTimeout(entry.disconnectTimer);
        entry.es.close();
        pool.delete(name);
        connIdByServerRef.current.delete(name);
        setSlicesByServer((prev) => {
          if (!prev.has(name)) return prev;
          const next = new Map(prev);
          next.delete(name);
          return next;
        });
        fetchServers();
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
      connIdByServerRef.current.delete(name);
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
  }, [attachedSet, updateSlice, fetchServers, applyHostMetrics, applyHostServices]);

  // Dedicated server-independent host-metrics stream, opened ONLY when no
  // per-server stream is open (`attachedSet` empty — the bare `/` case with
  // zero attached servers). It exists purely to receive the server-global
  // `event: metrics` broadcast so host health is available on `/`, where there
  // is no `currentServer` and no per-server stream to carry metrics.
  //
  // Whenever ANY server is attached the dedicated stream is REDUNDANT — the
  // per-server `metrics` listener above already fans the same server-global
  // payload into `hostMetrics` — and it would only cost a permanent +1 against
  // the browser's HTTP/1.1 6-per-origin connection budget on EVERY route,
  // including the connection-starvation-fragile board route (which attaches all
  // known servers). So we CLOSE it once `attachedSet` is non-empty and REOPEN
  // it if the attached set drains back to empty. `useHostMetrics()` stays live
  // across the switch: dedicated stream when nothing is attached, per-server
  // fan-out otherwise.
  //
  // We pass `?metrics=1` (and no `server`): the backend routes this to a
  // server-neutral, metrics-only client that is never session-polled or reaped,
  // so it keeps receiving the broadcast with zero attached servers.
  const hostMetricsESRef = useRef<EventSource | null>(null);
  // 3s disconnect debounce for the dedicated stream (mirrors the per-server
  // pool's `disconnectTimer`) so a transient socket blip doesn't flicker the
  // Cockpit dot. Held in a ref so the effect can clear it on reconnect/close.
  const dedicatedDisconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostMetricsWanted = attachedSet.size === 0;
  useEffect(() => {
    if (!hostMetricsWanted) {
      // A per-server stream now carries host metrics (via the fan-out above) —
      // close the redundant dedicated stream to free its connection slot. The
      // derived `hostMetricsConnected` reads from per-server connectedness in
      // this state, so reset the dedicated flag (and its timer) here.
      if (dedicatedDisconnectTimerRef.current) {
        clearTimeout(dedicatedDisconnectTimerRef.current);
        dedicatedDisconnectTimerRef.current = null;
      }
      if (hostMetricsESRef.current) {
        hostMetricsESRef.current.close();
        hostMetricsESRef.current = null;
      }
      setDedicatedMetricsConnected(false);
      return;
    }
    // Wanted (no server attached). StrictMode-safe: the ref survives the dev
    // cleanup→re-run cycle, so a second run reuses the existing connection
    // instead of opening a duplicate.
    if (hostMetricsESRef.current) return;
    const es = new EventSource("/api/sessions/stream?metrics=1");
    hostMetricsESRef.current = es;
    es.addEventListener("metrics", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as MetricsSnapshot;
        // Shared dedup with the per-server fan-out above — routing both sources
        // through applyHostMetrics keeps the guard authoritative across the
        // dedicated-stream ↔ per-server-fan-out switch.
        applyHostMetrics(e.data, data);
        // First (or recovered) metrics event — the stream is flowing. Clear any
        // pending disconnect debounce and mark connected.
        if (dedicatedDisconnectTimerRef.current) {
          clearTimeout(dedicatedDisconnectTimerRef.current);
          dedicatedDisconnectTimerRef.current = null;
        }
        setDedicatedMetricsConnected(true);
      } catch {
        // Malformed metrics event — skip
      }
    });
    es.onerror = () => {
      // 3s debounce before flipping the dot gray — mirrors the per-server pool.
      if (!dedicatedDisconnectTimerRef.current) {
        dedicatedDisconnectTimerRef.current = setTimeout(() => {
          dedicatedDisconnectTimerRef.current = null;
          setDedicatedMetricsConnected(false);
        }, 3000);
      }
    };
    // `event: services` rides the same dedicated stream (it fans out to every
    // client). Add the listener here too so host services stay live on the bare
    // `/` route with zero attached servers, mirroring the metrics listener.
    es.addEventListener("services", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as ServicesSnapshot;
        applyHostServices(e.data, Array.isArray(data.services) ? data.services : []);
      } catch {
        // Malformed services event — skip
      }
    });
    // No cleanup close() here — the open/close is driven by `hostMetricsWanted`
    // (the effect body closes the stream when it flips false), not by effect
    // teardown. A cleanup close() would tear down the connection on every
    // StrictMode remount and orphan the ref-guarded reopen.
  }, [hostMetricsWanted, applyHostMetrics, applyHostServices]);

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

  // Host-metrics source health (260704-9o7k) — the Cockpit connection dot.
  // When no server is attached the dedicated `?metrics=1` stream IS the source,
  // so use its debounced health. Otherwise the per-server metrics fan-out
  // carries host metrics, so derive from whether ANY attached server slice is
  // connected — that server is delivering the server-global `event: metrics`.
  const hostMetricsConnected = useMemo(() => {
    if (hostMetricsWanted) return dedicatedMetricsConnected;
    for (const slice of slicesByServer.values()) {
      if (slice.isConnected) return true;
    }
    return false;
  }, [hostMetricsWanted, dedicatedMetricsConnected, slicesByServer]);

  const metricsByServer = useMemo(() => {
    const m = new Map<string, MetricsSnapshot | null>();
    for (const [name, slice] of slicesByServer) m.set(name, slice.metrics);
    return m;
  }, [slicesByServer]);

  const previewsByServer = useMemo(() => {
    const m = new Map<string, Record<string, string>>();
    for (const [name, slice] of slicesByServer) m.set(name, slice.previews);
    return m;
  }, [slicesByServer]);

  // Declare the tile grid's expanded-session set for a server. Best-effort —
  // reads the server's current SSE connection id and POSTs it; a missing id
  // (stream not yet open) simply skips (the next tick after connect + a
  // re-declare covers it). Errors are swallowed (a preview is a nicety).
  const setPreviewScope = useCallback((server: string, expanded: string[]) => {
    const conn = connIdByServerRef.current.get(server);
    if (!conn) return;
    void apiSetPreviewScope(server, conn, expanded).catch(() => {});
  }, []);

  const value = useMemo<SessionContextType>(
    () => ({
      sessionsByServer,
      sessionOrderByServer,
      isConnectedByServer,
      hostMetricsConnected,
      metricsByServer,
      previewsByServer,
      setPreviewScope,
      currentServer,
      servers,
      refreshServers: fetchServers,
      serversLoaded,
      pendingServer,
      markServerPending,
      attachServer,
      subscribeBoardChange,
    }),
    [
      sessionsByServer,
      sessionOrderByServer,
      isConnectedByServer,
      hostMetricsConnected,
      metricsByServer,
      previewsByServer,
      setPreviewScope,
      currentServer,
      servers,
      fetchServers,
      serversLoaded,
      pendingServer,
      markServerPending,
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
        <HostMetricsContext.Provider value={hostMetrics}>
          <HostServicesContext.Provider value={hostServices}>
            {children}
          </HostServicesContext.Provider>
        </HostMetricsContext.Provider>
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

/** Host-global metrics from the dedicated server-independent stream. Unlike
 *  `useMetrics()` (current-server-scoped, `null` on `/`), this is available on
 *  EVERY route — the Cockpit host-console home (`/`) consumes it. `null` before
 *  the first metrics tick. */
export function useHostMetrics(): MetricsSnapshot | null {
  const ctx = useContext(HostMetricsContext);
  if (ctx === undefined) throw new Error("useHostMetrics must be used within SessionProvider");
  return ctx;
}

/** Host-global listening services from the server-independent broadcast.
 *  Available on EVERY route — the Cockpit host-console home (`/`) consumes it
 *  for the SERVICES zone. Returns `[]` before the first services tick (never
 *  null), so consumers can map over it unconditionally. */
export function useHostServices(): Service[] {
  const ctx = useContext(HostServicesContext);
  if (ctx === undefined) throw new Error("useHostServices must be used within SessionProvider");
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
    hostMetricsConnected: value.hostMetricsConnected ?? false,
    metricsByServer: value.metricsByServer ?? new Map(),
    previewsByServer: value.previewsByServer ?? new Map(),
    setPreviewScope: value.setPreviewScope ?? (() => {}),
    currentServer: value.currentServer ?? null,
    servers: value.servers ?? [],
    refreshServers: value.refreshServers ?? (() => {}),
    serversLoaded: value.serversLoaded ?? false,
    pendingServer: value.pendingServer ?? null,
    markServerPending: value.markServerPending ?? (() => {}),
    attachServer: value.attachServer ?? (() => {}),
    subscribeBoardChange: value.subscribeBoardChange ?? (() => () => {}),
  };
  return <SessionContext.Provider value={fullValue}>{children}</SessionContext.Provider>;
}
