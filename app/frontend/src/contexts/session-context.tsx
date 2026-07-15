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
import { listServers, compareServersRanked, setPreviewScope as apiSetPreviewScope, triggerUpdate, triggerForceUpdate, triggerRestart, type ServerInfo } from "@/api/client";
import type { MetricsSnapshot, ProjectSession, Service, ServicesSnapshot } from "@/types";

const SERVER_STORAGE_KEY = "runkit-server";
// localStorage key for per-version update-notice dismissal. The value is the
// dismissed `latest` version string (e.g. "0.6.0"); a later release with a
// different version re-shows the chip. No server state (Constitution II).
const UPDATE_DISMISSED_KEY = "runkit-update-dismissed";
// Sentinel running version for local (non-ldflags) builds — the update chip and
// palette actions are suppressed for it.
const DEV_VERSION = "dev";

/** Pure reload-guard predicate: given the FIRST {version, boot} this tab observed
 *  and the NEXT `version` event, decide whether to reload. Reloads when a version
 *  was already seen AND EITHER the version OR the boot id differs — a version
 *  change means new assets; a same-version boot change means a plain daemon
 *  restart (config change, wedge recovery, restart from SSH) that reconnected
 *  this tab to a new process holding possibly-stale in-memory state. Never
 *  reloads on the first connect (firstVersion === null), so there is no reload
 *  loop.
 *
 *  DEV SUPPRESSION: when the running version is `"dev"`, a boot change is IGNORED
 *  — under `just dev`, air recompiles the backend on every save, minting a new
 *  boot id each time; reloading every dev tab on every recompile would be a
 *  reload storm. A version change is still honored (moot in practice — a dev
 *  version never changes — but keeps the predicate honest). `nextBoot` may be
 *  null when an older daemon sends a boot-less payload (mixed-version window):
 *  a null boot never triggers the boot branch.
 *
 *  Exported for unit testing; the provider wraps it with refs + `location.reload()`. */
export function shouldReloadOnVersion(
  firstVersion: string | null,
  firstBoot: string | null,
  nextVersion: string,
  nextBoot: string | null,
): boolean {
  if (firstVersion === null) return false; // never reload on first connect
  if (nextVersion !== firstVersion) return true; // new binary/assets
  // Same version: a boot change means a plain restart — reload UNLESS this is a
  // dev build (air recompile storm guard). A null nextBoot (older daemon) or an
  // unchanged boot never triggers.
  if (nextVersion === DEV_VERSION) return false;
  return nextBoot !== null && nextBoot !== firstBoot;
}

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
  /** Subscribe to the server-global `board-order` event (board list display
   *  order changed). Returns an unsubscribe function. Fired from both the
   *  per-server pool streams and the dedicated `?metrics=1` stream, since the
   *  event is host-global (identical on every stream). */
  subscribeBoardOrder: (handler: () => void) => () => void;
  /** The running daemon version reported over the server-global `event: version`
   *  (no leading "v"). `null` until the first `version` event. */
  daemonVersion: string | null;
  /** A pending qualifying (minor/major) update, from the server-global
   *  `event: update-available`. `null` when no update is pending. */
  updateAvailable: { current: string; latest: string } | null;
  /** The latest version the user dismissed the update notice for (localStorage
   *  `runkit-update-dismissed`), or `null` when none. The chip hides when this
   *  equals `updateAvailable.latest`; the palette action ignores it. */
  updateDismissedVersion: string | null;
  /** Trigger a one-click update: POST /api/update. Best-effort — the daemon
   *  restart then drops SSE, and the reconnect's differing `version` drives the
   *  reload guard. Rejects on a non-2xx so the caller can surface an error. */
  updateNow: () => Promise<void>;
  /** Dismiss the update notice for the current pending `latest`, persisted
   *  per-version in localStorage. A later release re-shows the chip. */
  dismissUpdate: () => void;
  /** Whether the daemon is a Homebrew install, from the server-global
   *  `event: version` `brew` field. `false` until the first version event —
   *  gates the palette-only `run-kit: Update Now` (force-update) entry. */
  brew: boolean;
  /** Force a self-upgrade regardless of the qualifying snapshot: POST
   *  /api/update `{"force":true}`. Best-effort — the ensuing restart drops SSE
   *  and the reconnect's differing version/boot drives the reload. Rejects on a
   *  non-2xx (e.g. 409 not-brew) so the caller can catch it. */
  forceUpdateNow: () => Promise<void>;
  /** Restart the daemon: POST /api/restart. Best-effort — the restart drops SSE
   *  and the reconnect's differing `boot` drives the reload guard even at the
   *  same version. Rejects on a non-2xx (e.g. 409 on a dev build). */
  restartNow: () => Promise<void>;
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
  // Running daemon version from the server-global `event: version` (no leading
  // "v"). `null` until the first event. Drives the reload guard + update chip.
  const [daemonVersion, setDaemonVersion] = useState<string | null>(null);
  // Whether the daemon is a Homebrew install, from the server-global
  // `event: version` `brew` field. `false` until the first version event (the
  // brew-gated `run-kit: Update Now` palette entry stays hidden until observed).
  const [isBrew, setIsBrew] = useState(false);
  // Pending qualifying update from the server-global `event: update-available`.
  const [updateAvailable, setUpdateAvailable] = useState<{ current: string; latest: string } | null>(null);
  // The latest version the user dismissed the notice for (localStorage-backed).
  const [updateDismissedVersion, setUpdateDismissedVersion] = useState<string | null>(() => {
    try {
      return localStorage.getItem(UPDATE_DISMISSED_KEY);
    } catch {
      return null;
    }
  });
  const { setIsConnected: setChromeConnected } = useChromeDispatch();
  const currentServer = useCurrentServerFromRoute();

  // Reload guard: remember the FIRST {version, boot} this tab observed. When a
  // LATER `version` event (after an SSE reconnect following a daemon restart or
  // upgrade) differs in EITHER field, the running process changed under this open
  // tab — a version change means new embedded assets, a same-version boot change
  // means a plain restart reconnecting the tab to a new process — so reload once
  // to pick up fresh assets / drop stale in-memory state. Never reload on the
  // first connect (firstVersionRef unset), so there is no reload loop. Held in
  // refs (not state) so the apply callback is stable and the comparison never
  // re-runs an effect. The boot-based branch self-suppresses on `dev` (air
  // recompile storm guard) inside shouldReloadOnVersion.
  const firstVersionRef = useRef<string | null>(null);
  const firstBootRef = useRef<string | null>(null);
  const applyVersion = useCallback((version: string, boot: string | null, brew: boolean) => {
    if (!version) return;
    setDaemonVersion(version);
    setIsBrew(brew);
    if (shouldReloadOnVersion(firstVersionRef.current, firstBootRef.current, version, boot)) {
      // New process behind the same tab — reload to load fresh assets / drop
      // stale in-memory state.
      location.reload();
      return;
    }
    // Remember the first {version, boot} seen (only on the first connect); a
    // later differing pair is handled by the reload branch above.
    if (firstVersionRef.current === null) {
      firstVersionRef.current = version;
      firstBootRef.current = boot;
    }
  }, []);

  // Apply an `event: update-available` payload. Server-global (identical on every
  // stream): the backend delivers it as a cached-on-connect slot (once per SSE
  // connection, so once per attached server on multi-server routes) and only
  // re-broadcasts when the qualifying latest changes — NOT on every check tick.
  // Setting the same {current, latest} object is cheap and idempotent (React
  // bails out only on identical references, but re-broadcasts are bounded to an
  // actual version change, far rarer than the ~6h check cadence, so no dedup
  // guard is needed).
  const applyUpdateAvailable = useCallback((current: string, latest: string) => {
    if (!latest) return;
    setUpdateAvailable((prev) =>
      prev && prev.current === current && prev.latest === latest ? prev : { current, latest },
    );
  }, []);

  const dismissUpdate = useCallback(() => {
    const latest = updateAvailable?.latest;
    if (!latest) return;
    try {
      localStorage.setItem(UPDATE_DISMISSED_KEY, latest);
    } catch {
      // localStorage unavailable — dismissal is best-effort.
    }
    setUpdateDismissedVersion(latest);
  }, [updateAvailable]);

  const updateNow = useCallback(() => triggerUpdate(), []);
  // Maintenance actions (palette-only): force a self-upgrade regardless of the
  // qualifying snapshot, and bounce the daemon. Thin wrappers over the client
  // helpers — same shape as updateNow. The ensuing SSE drop + boot/version-driven
  // reload IS the feedback; the caller catches rejections (no toast).
  const forceUpdateNow = useCallback(() => triggerForceUpdate(), []);
  const restartNow = useCallback(() => triggerRestart(), []);

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

  // Apply a server-global `event: server-order` payload: stamp each named
  // server's rank from its position in `order`, drop the rank of any server not
  // listed (so a removed-from-order server falls to the unranked tail), then
  // re-sort with the same rank-aware comparator used at fetch time — a state
  // update, no /api/servers refetch. Always produces a fresh array; churn here
  // is bounded to explicit reorder events, not per-tick SSE, so no dedup guard
  // is needed. Shared by the per-server pool streams and the dedicated
  // `?metrics=1` stream, since the event is server-global (identical on every
  // stream).
  const applyServerOrder = useCallback((order: string[]) => {
    const rankByName = new Map<string, number>();
    order.forEach((name, i) => rankByName.set(name, i));
    setServers((prev) => {
      const next = prev.map((s) => ({
        ...s,
        rank: rankByName.has(s.name) ? rankByName.get(s.name)! : null,
      }));
      next.sort(compareServersRanked);
      return next;
    });
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

  // Board-order event subscribers (server-global). Same ref-of-handlers pattern
  // as boardChangeSubscribersRef so the pool + metrics-stream listeners can fire
  // them without re-running on every subscriber registration.
  const boardOrderSubscribersRef = useRef<Set<() => void>>(new Set());
  const subscribeBoardOrder = useCallback((handler: () => void) => {
    boardOrderSubscribersRef.current.add(handler);
    return () => {
      boardOrderSubscribersRef.current.delete(handler);
    };
  }, []);
  const fireBoardOrder = useCallback(() => {
    for (const handler of boardOrderSubscribersRef.current) {
      try {
        handler();
      } catch {
        // ignore individual subscriber errors
      }
    }
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
      // Sort once at the single ingestion point so every consumer of ctx.servers
      // inherits the effective (infra-class, rank, name) ordering. /api/servers
      // stays alphabetical (asserted API contract) and carries each entry's
      // rank; display order — including user-defined rank — is a frontend
      // concern applied here.
      setServers(Array.isArray(data) ? [...data].sort(compareServersRanked) : []);
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

      // server-order — server-global (identical on every stream, like metrics/
      // services). Re-sort the held `servers` list with the new rank order.
      // No `data.server` filter: this is a host-global concern, not per-server.
      es.addEventListener("server-order", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { order?: string[] };
          if (Array.isArray(data.order)) applyServerOrder(data.order);
        } catch {
          // Malformed event — skip
        }
      });

      // board-order — server-global (identical on every stream). Fire the
      // subscribers so useBoards re-fetches the backend-sorted board list. No
      // `data.server` filter: host-global, like server-order.
      es.addEventListener("board-order", () => {
        fireBoardOrder();
      });

      // version — server-global (sent on connect on every stream). Track the
      // running daemon version + boot id + brew flag and drive the post-restart
      // reload guard. `boot`/`brew` are parsed tolerantly (an older daemon sends
      // a boot-less/brew-less payload — mixed-version window — which must not
      // break). No `data.server` filter: host-global, like server-order/board-order.
      es.addEventListener("version", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { version?: string; boot?: string; brew?: boolean };
          if (typeof data.version === "string") {
            applyVersion(
              data.version,
              typeof data.boot === "string" ? data.boot : null,
              data.brew === true,
            );
          }
        } catch {
          // Malformed version event — skip
        }
      });

      // update-available — server-global (a pending qualifying update). Store
      // {current, latest} for the chip + palette. Host-global, no server filter.
      es.addEventListener("update-available", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { current?: string; latest?: string };
          if (typeof data.current === "string" && typeof data.latest === "string") {
            applyUpdateAvailable(data.current, data.latest);
          }
        } catch {
          // Malformed update-available event — skip
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
  }, [attachedSet, updateSlice, fetchServers, applyHostMetrics, applyHostServices, applyServerOrder, fireBoardOrder, applyVersion, applyUpdateAvailable]);

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
    // `event: server-order` rides the same server-global broadcast, so the bare
    // `/` Cockpit (zero attached servers) still re-sorts its tile grid live.
    es.addEventListener("server-order", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { order?: string[] };
        if (Array.isArray(data.order)) applyServerOrder(data.order);
      } catch {
        // Malformed server-order event — skip
      }
    });
    // `event: board-order` also rides the server-global broadcast — the Cockpit
    // BOARDS zone renders with zero attached servers, so the metrics stream must
    // carry it too or a reorder from another client would not surface on `/`.
    es.addEventListener("board-order", () => {
      fireBoardOrder();
    });
    // `event: version` / `event: update-available` are server-global too, so the
    // bare `/` Cockpit (zero attached servers) must still learn the daemon
    // version (reload guard) and any pending update (chip/palette). Mirror the
    // per-server listeners above.
    es.addEventListener("version", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { version?: string; boot?: string; brew?: boolean };
        if (typeof data.version === "string") {
          applyVersion(
            data.version,
            typeof data.boot === "string" ? data.boot : null,
            data.brew === true,
          );
        }
      } catch {
        // Malformed version event — skip
      }
    });
    es.addEventListener("update-available", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { current?: string; latest?: string };
        if (typeof data.current === "string" && typeof data.latest === "string") {
          applyUpdateAvailable(data.current, data.latest);
        }
      } catch {
        // Malformed update-available event — skip
      }
    });
    // No cleanup close() here — the open/close is driven by `hostMetricsWanted`
    // (the effect body closes the stream when it flips false), not by effect
    // teardown. A cleanup close() would tear down the connection on every
    // StrictMode remount and orphan the ref-guarded reopen.
  }, [hostMetricsWanted, applyHostMetrics, applyHostServices, applyServerOrder, fireBoardOrder, applyVersion, applyUpdateAvailable]);

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
      subscribeBoardOrder,
      daemonVersion,
      updateAvailable,
      updateDismissedVersion,
      updateNow,
      dismissUpdate,
      brew: isBrew,
      forceUpdateNow,
      restartNow,
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
      subscribeBoardOrder,
      daemonVersion,
      updateAvailable,
      updateDismissedVersion,
      updateNow,
      dismissUpdate,
      isBrew,
      forceUpdateNow,
      restartNow,
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

/** Derived view of the update-notification state, shared by the top-bar chip and
 *  the command-palette actions so their gating can never drift.
 *   - `qualifies` — a pending update exists AND the daemon is not the `dev`
 *     sentinel. (This is the palette's gate; the palette IGNORES dismissal —
 *     dismissal silences only the ambient chip.)
 *   - `showChip` — `qualifies` AND not dismissed for the current `latest`. This
 *     is the chip's visibility gate.
 *   - `latest` — the pending latest version string (or `null`).
 *   - `updateNow` / `dismissUpdate` — the context actions, re-exported for
 *     convenience.
 *   - `daemonVersion` — the running version (or `null`), so the maintenance
 *     palette entries can dev-gate.
 *   - `brew` — whether the daemon is a Homebrew install, gating the force-update
 *     maintenance entry (`false` until the first version event).
 *   - `forceUpdateNow` / `restartNow` — the maintenance actions, re-exported for
 *     the palette. */
export function useUpdateNotification(): {
  qualifies: boolean;
  showChip: boolean;
  latest: string | null;
  current: string | null;
  updateNow: () => Promise<void>;
  dismissUpdate: () => void;
  daemonVersion: string | null;
  brew: boolean;
  forceUpdateNow: () => Promise<void>;
  restartNow: () => Promise<void>;
} {
  // Tolerant of a missing provider: the update chip/palette are chrome that must
  // degrade to "no update" (never crash) when mounted outside SessionProvider
  // — e.g. isolated component tests. Mirrors how NotificationControl's
  // usePushSubscription never throws without a provider.
  const ctx = useContext(SessionContext);
  const daemonVersion = ctx?.daemonVersion ?? null;
  const updateAvailable = ctx?.updateAvailable ?? null;
  const updateDismissedVersion = ctx?.updateDismissedVersion ?? null;
  const updateNow = ctx?.updateNow ?? (() => Promise.resolve());
  const dismissUpdate = ctx?.dismissUpdate ?? (() => {});
  const brew = ctx?.brew ?? false;
  const forceUpdateNow = ctx?.forceUpdateNow ?? (() => Promise.resolve());
  const restartNow = ctx?.restartNow ?? (() => Promise.resolve());
  const isDev = daemonVersion === DEV_VERSION;
  const latest = updateAvailable?.latest ?? null;
  // The version the daemon is currently on, per the pending update-available
  // event. Surfaced so the UpdateChip can render the `v{current} → v{latest}`
  // transition instead of only the target. Null when no update is pending (the
  // chip falls back to target-only wording).
  const current = updateAvailable?.current ?? null;
  const qualifies = !isDev && latest !== null;
  const showChip = qualifies && latest !== updateDismissedVersion;
  return {
    qualifies,
    showChip,
    latest,
    current,
    updateNow,
    dismissUpdate,
    daemonVersion,
    brew,
    forceUpdateNow,
    restartNow,
  };
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
    subscribeBoardOrder: value.subscribeBoardOrder ?? (() => () => {}),
    daemonVersion: value.daemonVersion ?? null,
    updateAvailable: value.updateAvailable ?? null,
    updateDismissedVersion: value.updateDismissedVersion ?? null,
    updateNow: value.updateNow ?? (() => Promise.resolve()),
    dismissUpdate: value.dismissUpdate ?? (() => {}),
    brew: value.brew ?? false,
    forceUpdateNow: value.forceUpdateNow ?? (() => Promise.resolve()),
    restartNow: value.restartNow ?? (() => Promise.resolve()),
  };
  return <SessionContext.Provider value={fullValue}>{children}</SessionContext.Provider>;
}
