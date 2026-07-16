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
import { listServers, compareServersRanked, triggerUpdate, triggerForceUpdate, triggerRestart, type ServerInfo } from "@/api/client";
import { StateSocket } from "@/lib/state-socket";
import type { MetricsSnapshot, ProjectSession, Service, ServicesSnapshot } from "@/types";

// Internal ref-set key for the host-metrics subscription (distinct from any
// real tmux server name, which never contains a NUL).
const METRICS_SUB = "\x00metrics";

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

/** Multi-server SessionContext shape. State is keyed by server name. A single
 *  `/ws/state` WebSocket (the StateSocket) carries every stream for the tab; a
 *  per-server *subscription* on that socket is opened lazily per *attached*
 *  server (current server is always attached automatically; non-current servers
 *  attach when a consumer calls `attachServer(name)` — typically when a sidebar
 *  group is expanded). Muxing onto one established WebSocket is what clears the
 *  browser's 6-per-origin HTTP/1.1 pool that the old per-server + metrics
 *  EventSources saturated (an established WS holds no pool slot — change
 *  260716-qf3j-state-socket). Other hooks (`useBoards`, `useWindowPins`)
 *  subscribe to this provider's `subscribeBoardChange` API rather than opening
 *  their own streams. `currentServer` is dispatched by the matched route —
 *  `params.server` for `/$server/...`, `null` for `/board/$name` and `/`. */
export type SessionContextType = {
  sessionsByServer: Map<string, ProjectSession[]>;
  sessionOrderByServer: Map<string, string[]>;
  isConnectedByServer: Map<string, boolean>;
  /** Health of the host-metrics source that feeds `useHostMetrics()` — true
   *  when host metrics are flowing (260704-9o7k, for the Host connection
   *  dot). Keys on the state socket: when no server is attached it is (socket
   *  connected AND the dedicated `metrics` subscription acked); otherwise it
   *  derives from whether any attached server's subscription is acked (the
   *  metrics fan-out source, since metrics ride every subscription). */
  hostMetricsConnected: boolean;
  metricsByServer: Map<string, MetricsSnapshot | null>;
  /** Per-server map of `windowId → pane-text preview` for the tile grid. Only
   *  windows in sessions the client declared expanded (via `setPreviewScope`)
   *  are populated; delivered over the state socket's `preview` event. */
  previewsByServer: Map<string, Record<string, string>>;
  /** Declare which sessions the tile grid has expanded for a server, so the
   *  backend captures previews only for those windows. Sends the in-band
   *  `preview-scope` op over the state socket, addressed by the socket's own
   *  conn id (the same identity the retained `POST /api/preview-scope` uses). */
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
  /** Mark a server as "attached" so the provider opens its state-socket
   *  subscription. Idempotent. The current server is auto-attached; this is for
   *  non-current servers (sidebar groups expanded by the user). */
  attachServer: (name: string) => void;
  /** Subscribe to board-changed events on any attached server. Returns an
   *  unsubscribe function. The handler receives the source server name. */
  subscribeBoardChange: (handler: (server: string) => void) => () => void;
  /** Subscribe to the server-global `board-order` event (board list display
   *  order changed). Returns an unsubscribe function. Delivered once over the
   *  state socket as a `kind:"global"` event (host-global — never duplicated
   *  per subscription). */
  subscribeBoardOrder: (handler: () => void) => () => void;
  /** Subscribe to the server-global `status-refresh` event (a manual PR-status
   *  refresh completed). Returns an unsubscribe function. Delivered once over
   *  the state socket as a `kind:"global"` event (host-global, broadcast-only,
   *  no cached payload). The PANE-header refresh button subscribes to clear its
   *  spinner on completion. */
  subscribeStatusRefresh: (handler: () => void) => () => void;
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
   *  restart then drops the state socket, and the reconnect's differing
   *  `version` drives the reload guard. Rejects on a non-2xx so the caller can
   *  surface an error. */
  updateNow: () => Promise<void>;
  /** Dismiss the update notice for the current pending `latest`, persisted
   *  per-version in localStorage. A later release re-shows the chip. */
  dismissUpdate: () => void;
  /** Whether the daemon is a Homebrew install, from the server-global
   *  `event: version` `brew` field. `false` until the first version event —
   *  gates the palette-only `run-kit: Update Now` (force-update) entry. */
  brew: boolean;
  /** Force a self-upgrade regardless of the qualifying snapshot: POST
   *  /api/update `{"force":true}`. Best-effort — the ensuing restart drops the
   *  state socket and the reconnect's differing version/boot drives the reload.
   *  Rejects on a non-2xx (e.g. 409 not-brew) so the caller can catch it. */
  forceUpdateNow: () => Promise<void>;
  /** Restart the daemon: POST /api/restart. Best-effort — the restart drops the
   *  state socket and the reconnect's differing `boot` drives the reload guard
   *  even at the same version. Rejects on a non-2xx (e.g. 409 on a dev build). */
  restartNow: () => Promise<void>;
};

export const SessionContext = createContext<SessionContextType | null>(null);

// Metrics live in a separate context so that the ~2.5s metrics stream does not
// cascade re-renders through the whole app tree — only HostPanel subscribes.
// The default sentinel is `undefined` so `useMetrics()` can distinguish
// "outside provider" (throw) from the valid "no metrics yet" state (`null`).
const MetricsContext = createContext<MetricsSnapshot | null | undefined>(undefined);

// Host metrics live in their OWN context, fed by the host-global `metrics`
// event over the state socket (delivered as a `kind:"global"` frame — see the
// StateSocket handlers below). Unlike `MetricsContext` (which carries the
// current server's slice and is `null` on `/`), this context carries the
// host-global metrics broadcast and is available on EVERY route — including
// `/`, where there is no `currentServer`. The metrics broadcast is
// server-independent server-side (see api/sse.go poll loop), so the single
// socket delivers it once regardless of how many servers are subscribed. Same
// `undefined` sentinel idiom as `MetricsContext` — distinguishes
// "outside provider" (throw) from "no metrics yet" (`null`).
const HostMetricsContext = createContext<MetricsSnapshot | null | undefined>(undefined);

// Host listening-services live in their OWN context, fed by the same
// host-global broadcast as host metrics (the `services` event is a
// `kind:"global"` frame delivered once over the state socket, exactly like
// `metrics`). Separated from HostMetricsContext so the ~2.5s services stream
// does not cascade re-renders into metrics-only consumers. The `undefined`
// sentinel distinguishes "outside provider" (throw) from the valid "no services
// yet" state (`[]`).
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
  // Lazy-attach set: which servers should have a state-socket subscription
  // open. The current server is automatically included; non-current servers
  // must opt in (typically when their sidebar group is expanded). See the
  // `SessionContextType` doc for why eager-attach blows past the browser's
  // 6-connection-per-origin cap that the pre-socket EventSources hit.
  const [attachedNonCurrent, setAttachedNonCurrent] = useState<Set<string>>(() => new Set());
  // Latest host-global metrics snapshot from the state socket's `metrics` global
  // event (see the StateSocket handlers below). `null` until the first tick.
  const [hostMetrics, setHostMetrics] = useState<MetricsSnapshot | null>(null);
  // Health of the DEDICATED `metrics` subscription (260704-9o7k). Set true when
  // that subscription acks over a connected socket, cleared via a 3s debounce on
  // socket disconnect — mirrors the per-server slice `isConnected` lifecycle.
  // Only meaningful while the dedicated metrics subscription is the host-metrics
  // source (attached set empty); when a server subscription carries the fan-out
  // the derived value below reads from per-server connectedness instead. `false`
  // until the first metrics ack.
  const [dedicatedMetricsConnected, setDedicatedMetricsConnected] = useState(false);
  // Latest host-global listening services from the same host-global broadcast
  // (the `services` global event). Empty array until the first tick — never
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
  // LATER `version` event (after a state-socket reconnect following a daemon
  // restart or upgrade) differs in EITHER field, the running process changed under this open
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

  // Apply an `update-available` payload. Host-global (a `kind:"global"` event):
  // the backend delivers it as a cached-on-connect global slot (once per socket
  // connection) and only re-broadcasts when the qualifying latest changes — NOT
  // on every check tick. Setting the same {current, latest} object is cheap and
  // idempotent (React bails out only on identical references, but re-broadcasts
  // are bounded to an actual version change, far rarer than the ~6h check
  // cadence, so no dedup guard is needed).
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
  // helpers — same shape as updateNow. The ensuing state-socket drop +
  // boot/version-driven reload IS the feedback; the caller catches rejections
  // (no toast).
  const forceUpdateNow = useCallback(() => triggerForceUpdate(), []);
  const restartNow = useCallback(() => triggerRestart(), []);

  // Last raw host-metrics payload applied to `hostMetrics`. The `metrics` event
  // is host-global — the muxed socket delivers it ONCE per tick as a
  // `kind:"global"` event (vs. the old per-stream fan-out that arrived once per
  // attached server). This guard still earns its keep: a reconnect replays the
  // cached metrics slot, and the ack snapshot can repeat the current payload, so
  // deduping on the raw event string collapses identical payloads to one state
  // update — without it each arrival would call `setHostMetrics` with a
  // freshly-parsed (referentially-new) object, forcing a redundant
  // HostMetricsContext re-render.
  const hostMetricsPrevRef = useRef<string>("");
  const applyHostMetrics = useCallback((raw: string, snap: MetricsSnapshot) => {
    if (raw === hostMetricsPrevRef.current) return;
    hostMetricsPrevRef.current = raw;
    setHostMetrics(snap);
  }, []);

  // Same raw-payload dedup as `applyHostMetrics`, for the `services` event. It
  // is host-global too — delivered once per tick as a `kind:"global"` event —
  // but a reconnect replay can repeat the current payload; deduping on the raw
  // string collapses identical payloads to one state update.
  const hostServicesPrevRef = useRef<string>("");
  const applyHostServices = useCallback((raw: string, services: Service[]) => {
    if (raw === hostServicesPrevRef.current) return;
    hostServicesPrevRef.current = raw;
    setHostServices(services);
  }, []);

  // Apply a host-global `server-order` payload: stamp each named server's rank
  // from its position in `order`, drop the rank of any server not listed (so a
  // removed-from-order server falls to the unranked tail), then re-sort with the
  // same rank-aware comparator used at fetch time — a state update, no
  // /api/servers refetch. Always produces a fresh array; churn here is bounded
  // to explicit reorder events, not per-tick events, so no dedup guard is
  // needed. Delivered once over the state socket as a `kind:"global"` event.
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

  // Board-changed event subscribers. Stored in a ref so the state socket's
  // per-server event handler can fire all subscribers without re-running on
  // every subscriber registration.
  const boardChangeSubscribersRef = useRef<Set<(server: string) => void>>(new Set());
  const subscribeBoardChange = useCallback((handler: (server: string) => void) => {
    boardChangeSubscribersRef.current.add(handler);
    return () => {
      boardChangeSubscribersRef.current.delete(handler);
    };
  }, []);

  // Board-order event subscribers (host-global). Same ref-of-handlers pattern
  // as boardChangeSubscribersRef so the socket's global-event handler can fire
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

  // Status-refresh completion subscribers (host-global). Same ref-of-handlers
  // pattern as boardOrderSubscribersRef: a manual PR-status refresh completing
  // server-side fans out `status-refresh` as a `kind:"global"` event over the
  // socket, and the PANE-header refresh button subscribes to clear its spinner
  // (it spins click→event, not click→POST).
  const statusRefreshSubscribersRef = useRef<Set<() => void>>(new Set());
  const subscribeStatusRefresh = useCallback((handler: () => void) => {
    statusRefreshSubscribersRef.current.add(handler);
    return () => {
      statusRefreshSubscribersRef.current.delete(handler);
    };
  }, []);
  const fireStatusRefresh = useCallback(() => {
    for (const handler of statusRefreshSubscribersRef.current) {
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
  // server's subscription state. Single-server behavior preserved.
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

  // Single state socket (`/ws/state`) carrying ALL session-state + host-metrics
  // streams (change 260716-qf3j). Replaces the per-server EventSource pool + the
  // dedicated `?metrics=1` stream. An established WebSocket holds no HTTP/1.1
  // pool slot (docs/findings/socket-pool-accounting.md), so one socket clears
  // the pool starvation that blocked terminal handshakes on Firefox/WebKit.
  //
  // Held in a ref so the socket survives effect re-runs / StrictMode remounts.
  // `attachServer` / `subscribe*` and every consumer above these seams are
  // unchanged — the socket demuxes the envelope back into the same per-server /
  // host-global apply paths the SSE listeners used.
  const socketRef = useRef<StateSocket | null>(null);
  // Socket-level connection state — true between onopen and onclose. The
  // per-server dot derives from (socket connected AND that server's subscription
  // acked); host-metrics health derives from the metrics subscription's ack.
  const socketConnectedRef = useRef(false);
  // 3s disconnect debounce (mirrors the old per-server `onerror` debounce) so a
  // transient socket blip doesn't flicker the connection dots gray.
  const socketDisconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which servers currently have an acked subscription (drives per-server
  // isConnected). A plain Set in a ref — connection-dot state is derived from
  // it plus socketConnectedRef; we still call updateSlice to publish isConnected.
  const ackedServersRef = useRef<Set<string>>(new Set());
  // Servers with an active per-server subscription (diffed against attachedSet).
  // Declared here (above the event handlers) so handleGlobalEvent can fan the
  // host-global metrics snapshot into each attached server's per-server slice.
  const subscribedServersRef = useRef<Set<string>>(new Set());

  // Stable event handlers held in a ref so the socket is constructed ONCE
  // (the apply* callbacks are stable useCallbacks; we thread them through a ref
  // to keep the socket-construction effect dependency-free).
  const handleServerEvent = useCallback(
    (type: string, key: string, data: unknown) => {
      switch (type) {
        case "sessions": {
          const sessions = data as ProjectSession[];
          startTransition(() => {
            updateSlice(key, { sessions, isConnected: true }, true);
          });
          break;
        }
        case "session-order": {
          const d = data as { server?: string; order?: string[] };
          if (d.server !== key) return; // defensive misroute guard (parity with SSE)
          updateSlice(key, { sessionOrder: Array.isArray(d.order) ? d.order : [] }, true);
          break;
        }
        case "preview": {
          const d = data as Record<string, string>;
          // Merge, don't replace — a preview event carries only the subset of
          // windows captured this tick (parity with the SSE preview listener).
          setSlicesByServer((prev) => {
            const existing = prev.get(key);
            if (!existing) return prev;
            const next = new Map(prev);
            next.set(key, { ...existing, previews: { ...existing.previews, ...d } });
            return next;
          });
          break;
        }
        case "board-changed": {
          for (const handler of boardChangeSubscribersRef.current) {
            try {
              handler(key);
            } catch {
              // ignore individual subscriber errors
            }
          }
          break;
        }
        default:
          break;
      }
    },
    [updateSlice],
  );

  const handleGlobalEvent = useCallback(
    (type: string, data: unknown) => {
      switch (type) {
        case "metrics": {
          const snap = data as MetricsSnapshot;
          // Dedupe on the raw payload (parity with applyHostMetrics's SSE
          // dedup): the metrics broadcast is host-global.
          applyHostMetrics(JSON.stringify(data), snap);
          // Also populate every attached server's per-server slice metrics, so
          // `useMetrics()` (current-server-scoped — the sidebar Host panel) stays
          // fed. Under SSE this rode each per-server stream's `metrics` listener;
          // the muxed socket delivers metrics ONCE as a global, so fan it into the
          // subscribed servers' slices here (parity with the old per-server write).
          for (const name of subscribedServersRef.current) {
            updateSlice(name, { metrics: snap }, true);
          }
          break;
        }
        case "services": {
          const d = data as ServicesSnapshot;
          applyHostServices(JSON.stringify(data), Array.isArray(d.services) ? d.services : []);
          break;
        }
        case "server-order": {
          const d = data as { order?: string[] };
          if (Array.isArray(d.order)) applyServerOrder(d.order);
          break;
        }
        case "board-order":
          fireBoardOrder();
          break;
        case "status-refresh":
          fireStatusRefresh();
          break;
        case "version": {
          const d = data as { version?: string; boot?: string; brew?: boolean };
          if (typeof d.version === "string") {
            applyVersion(d.version, typeof d.boot === "string" ? d.boot : null, d.brew === true);
          }
          break;
        }
        case "update-available": {
          const d = data as { current?: string; latest?: string };
          if (typeof d.current === "string" && typeof d.latest === "string") {
            applyUpdateAvailable(d.current, d.latest);
          }
          break;
        }
        default:
          break;
      }
    },
    [applyHostMetrics, applyHostServices, applyServerOrder, fireBoardOrder, fireStatusRefresh, applyVersion, applyUpdateAvailable, updateSlice],
  );

  // Latest handlers, kept in a ref so the one-time socket-construction effect
  // never needs to re-run when a handler identity changes.
  const eventRef = useRef({ handleServerEvent, handleGlobalEvent, fetchServers });
  eventRef.current = { handleServerEvent, handleGlobalEvent, fetchServers };

  // Construct + connect the socket exactly once (mount → unmount). All state is
  // routed through eventRef so this effect has no changing dependencies.
  useEffect(() => {
    const applyServerConnected = () => {
      // A subscription is "connected" only while the socket itself is up.
      const up = socketConnectedRef.current;
      for (const name of ackedServersRef.current) {
        updateSlice(name, { isConnected: up }, true);
      }
      setDedicatedMetricsConnected(up && ackedServersRef.current.has(METRICS_SUB));
    };

    const socket = new StateSocket({
      onEvent: (ev) => {
        if (ev.kind === "server" && ev.key) {
          eventRef.current.handleServerEvent(ev.type, ev.key, ev.data);
        } else if (ev.kind === "global") {
          eventRef.current.handleGlobalEvent(ev.type, ev.data);
        }
      },
      onAck: (_req, kind, key, snapshot) => {
        if (kind === "metrics") {
          ackedServersRef.current.add(METRICS_SUB);
          setDedicatedMetricsConnected(socketConnectedRef.current);
          // The metrics ack snapshot is the cached metrics payload (or null).
          if (snapshot) {
            eventRef.current.handleGlobalEvent("metrics", snapshot);
          }
          return;
        }
        if (!key) return;
        ackedServersRef.current.add(key);
        // The server ack snapshot is the sessions payload (parity with the
        // first `event: sessions`). null means "no snapshot yet".
        const sessions = Array.isArray(snapshot) ? (snapshot as ProjectSession[]) : [];
        startTransition(() => {
          updateSlice(key, { sessions, isConnected: socketConnectedRef.current }, true);
        });
      },
      onGone: (key) => {
        ackedServersRef.current.delete(key);
        // Also release the subscription itself — drop it from the active set and
        // the StateSocket's ref-count. Otherwise, if the server stays in
        // attachedSet (a still-attached server that only transiently went gone,
        // or one fetchServers keeps returning), the diff effect would see the
        // name already in subscribedServersRef and never re-subscribe — leaving
        // that server's UI permanently dead until detach/reload. Releasing here
        // lets the diff effect re-subscribe cleanly when attachedSet recomputes
        // (fetchServers below drives that) and the server is still desired.
        subscribedServersRef.current.delete(key);
        socketRef.current?.unsubscribeServer(key);
        setSlicesByServer((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        eventRef.current.fetchServers();
      },
      onConnectionChange: (connected) => {
        if (connected) {
          socketConnectedRef.current = true;
          if (socketDisconnectTimerRef.current) {
            clearTimeout(socketDisconnectTimerRef.current);
            socketDisconnectTimerRef.current = null;
          }
          applyServerConnected();
        } else {
          // 3s debounce before flipping dots gray (parity with the old
          // per-server / dedicated-stream onerror debounce).
          if (!socketDisconnectTimerRef.current) {
            socketDisconnectTimerRef.current = setTimeout(() => {
              socketDisconnectTimerRef.current = null;
              socketConnectedRef.current = false;
              applyServerConnected();
              // Fallback for a catastrophic drop the backend couldn't signal
              // with `gone` (e.g. the daemon itself is mid-restart): re-query
              // the server list so a genuinely-gone server drops out.
              eventRef.current.fetchServers();
            }, 3000);
          }
        }
      },
    });
    socketRef.current = socket;
    socket.connect();
    return () => {
      if (socketDisconnectTimerRef.current) {
        clearTimeout(socketDisconnectTimerRef.current);
        socketDisconnectTimerRef.current = null;
      }
      socket.close();
      socketRef.current = null;
      // Reset the subscription guard refs so a remount re-subscribes on the NEW
      // socket. StrictMode double-mounts the provider (dev + e2e run under
      // <StrictMode>): this effect destroys+recreates the socket, but the guard
      // refs below live OUTSIDE the effect and survive the remount. Without this
      // reset, mount 2's diff effect (`subscribedServersRef`) and metrics effect
      // (`metricsSubscribedRef`) would see their guards already true and never
      // subscribe on the fresh socket — permanently losing the metrics
      // subscription on `/` (Host dot dead, poll loop never started when this is
      // the hub's only client). `ackedServersRef` is cleared too since nothing
      // is acked on the new socket until fresh acks arrive. These effects re-run
      // on every remount regardless of dep changes, so cleared guards make them
      // re-subscribe. (`dedicatedMetricsConnected` is React state, reset by the
      // metrics effect's own `setDedicatedMetricsConnected(false)` path when it
      // re-runs; the fresh metrics ack re-establishes it.)
      metricsSubscribedRef.current = false;
      subscribedServersRef.current.clear();
      ackedServersRef.current.clear();
    };
  }, [updateSlice]);

  // Diff the desired attach set against active server subscriptions. Newly
  // attached servers subscribe (seeding an empty slice for a stable initial
  // value); removed servers unsubscribe and drop their slice.
  // (subscribedServersRef is declared above, next to ackedServersRef.)
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const desired = attachedSet;
    const active = subscribedServersRef.current;

    for (const name of desired) {
      if (active.has(name)) continue;
      active.add(name);
      updateSlice(name, EMPTY_SLICE);
      socket.subscribeServer(name);
    }
    for (const name of Array.from(active)) {
      if (desired.has(name)) continue;
      active.delete(name);
      ackedServersRef.current.delete(name);
      socket.unsubscribeServer(name);
      setSlicesByServer((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Map(prev);
        next.delete(name);
        return next;
      });
    }
  }, [attachedSet, updateSlice]);

  // Host-metrics subscription — opened ONLY when no server is attached (the bare
  // `/` case with zero attached servers). When a server is attached its
  // subscription already carries the host-global `metrics`/`services` broadcasts
  // (they fan out to every connection), so a separate metrics subscription is
  // redundant. This mirrors the old dedicated-`?metrics=1`-stream open/close.
  const hostMetricsWanted = attachedSet.size === 0;
  const metricsSubscribedRef = useRef(false);
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    if (hostMetricsWanted && !metricsSubscribedRef.current) {
      metricsSubscribedRef.current = true;
      socket.subscribeMetrics();
    } else if (!hostMetricsWanted && metricsSubscribedRef.current) {
      metricsSubscribedRef.current = false;
      ackedServersRef.current.delete(METRICS_SUB);
      setDedicatedMetricsConnected(false);
      socket.unsubscribeMetrics();
    }
  }, [hostMetricsWanted]);

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

  // Host-metrics source health (260704-9o7k) — the Host connection dot.
  // When no server is attached the dedicated `metrics` subscription IS the
  // source, so use its debounced health. Otherwise the host-global metrics
  // broadcast rides every server subscription, so derive from whether ANY
  // attached server slice is connected — that subscription is delivering the
  // host-global `metrics` event.
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

  // Declare the tile grid's expanded-session set for a server. Sent in-band over
  // the state socket (addressed by the socket's own conn id — decision D4), so
  // there is no POST-races-the-stream window. Best-effort: a not-yet-open socket
  // simply drops the frame (the next re-declare after connect covers it).
  const setPreviewScope = useCallback((server: string, expanded: string[]) => {
    socketRef.current?.sendPreviewScope(server, expanded);
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
      subscribeStatusRefresh,
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
      subscribeStatusRefresh,
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
 *   - `current` — the currently-running version at the time the update was
 *     announced (`updateAvailable?.current ?? null`), so the chip can render the
 *     `v{current} → v{latest}` transition.
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

/** Host-global metrics from the state socket's `metrics` global event. Unlike
 *  `useMetrics()` (current-server-scoped, `null` on `/`), this is available on
 *  EVERY route — the Host host-console home (`/`) consumes it. `null` before
 *  the first metrics tick. */
export function useHostMetrics(): MetricsSnapshot | null {
  const ctx = useContext(HostMetricsContext);
  if (ctx === undefined) throw new Error("useHostMetrics must be used within SessionProvider");
  return ctx;
}

/** Host-global listening services from the state socket's `services` global
 *  event. Available on EVERY route — the Host host-console home (`/`) consumes
 *  it for the SERVICES zone. Returns `[]` before the first services tick (never
 *  null), so consumers can map over it unconditionally. */
export function useHostServices(): Service[] {
  const ctx = useContext(HostServicesContext);
  if (ctx === undefined) throw new Error("useHostServices must be used within SessionProvider");
  return ctx;
}

// Standalone provider for tests and storybook — supplies a `null` or fake
// metrics value without requiring the full SessionProvider (which opens the
// state socket).
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
 *  without opening the state socket. Counterpart to `MetricsProvider` above.
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
    subscribeStatusRefresh: value.subscribeStatusRefresh ?? (() => () => {}),
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
