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
import { StateSocket, type ChatSubscribeArgs, type ChatUnsubscribeArgs } from "@/lib/state-socket";
import type { MetricsSnapshot, ProjectSession, Service, ServicesSnapshot } from "@/types";

export type { ChatSubscribeArgs, ChatUnsubscribeArgs };

/** Handlers a chat-lens owner hook registers for one window's chat frames
 *  (260717-vhvz). Routed from the state socket's onEvent/onAck (kind "chat").
 *  `data` is the parsed event payload (verbatim from the server envelope). */
export type ChatFrameHandlers = {
  /** A `kind:"chat"` event: type is "chat" | "chat-state" | "chat-reset" |
   *  "chat-error"; data is its parsed payload. */
  onEvent: (type: string, data: unknown) => void;
  /** The chat subscribe ack: offset is the tail-start byte position (D5 — no
   *  snapshot). */
  onAck: (offset: number) => void;
};

const SERVER_STORAGE_KEY = "runkit-server";
// localStorage key for composite update-notice dismissal. The value is the
// dismissed composite `key` — the sorted `tool@latest` pairs (e.g.
// "fab-kit@2.17.0,run-kit@3.9.0"); any change to the matched set (a newer latest
// or a newly-matching tool) changes the key and re-shows the chip. No server
// state (Constitution II).
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

/** One toolkit tool in the update-available payload: `tool` is the roster name
 *  (e.g. "run-kit", "fab-kit"), `current` its installed version, `latest` the
 *  newest release. The payload carries the FULL per-tool verdict list — every
 *  tool with a pending update, including sub-threshold rows — so each entry
 *  also carries the two verdict flags. A missing flag (an old daemon's payload,
 *  which listed only matched tools) is treated as `true`. */
export type UpdateTool = {
  tool: string;
  current: string;
  latest: string;
  /** installed < latest. Missing (old-daemon payload) ⇒ treated as true. */
  updateAvailable?: boolean;
  /** The bump crosses the tool's notify threshold — the set that lights the
   *  chip. Missing (old-daemon payload) ⇒ treated as true. */
  notable?: boolean;
};

/** A pending toolkit update, from the server-global `event: update-available`.
 *  `tools` is the full per-tool verdict list (chip/palette consumers filter the
 *  notable subset via `useUpdateNotification`); `key` is the composite
 *  dismissal key over the NOTABLE set (sorted `tool@latest`, comma-joined).
 *  `current`/`latest` are the legacy run-kit-row fields, retained for
 *  transitional compat (populated only when run-kit is in the notable set). */
export type UpdateAvailable = {
  tools: UpdateTool[];
  key: string;
  current: string;
  latest: string;
};

export type SessionContextType = {
  sessionsByServer: Map<string, ProjectSession[]>;
  sessionOrderByServer: Map<string, string[]>;
  isConnectedByServer: Map<string, boolean>;
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
  /** Open a chat subscription for a window on the singleton state socket
   *  (260717-vhvz). `from` is the transcript byte offset the client's GET
   *  backfill read up to, so the server tails gap-free. The owner hook
   *  (`useChatSubscription`) drives this; consumers never touch the socket
   *  directly (the established singleton-socket ownership pattern). */
  subscribeChat: (args: ChatSubscribeArgs) => void;
  /** Close a window's chat subscription (cancels its server-side producer). */
  unsubscribeChat: (args: ChatUnsubscribeArgs) => void;
  /** Register handlers for a window's chat frames (event/ack), scoped by window
   *  ID. Returns an unregister function. The owner hook registers on lens enter
   *  and unregisters on leave. Chat frames are routed here from the socket's
   *  onEvent/onAck (kind "chat"); a `chat` event carries `ChatEvent[]`,
   *  `chat-state` carries `{pending}`, `chat-reset` carries `{}`, `chat-error`
   *  carries `{error}`; the ack carries the tail-start byte offset. */
  registerChatHandlers: (windowId: string, handlers: ChatFrameHandlers) => () => void;
  /** Whether the state socket is currently open (undebounced). The chat-lens
   *  connection dot is (this) AND (the chat subscription acked); the owner hook
   *  applies the 3s disconnect debounce. */
  socketConnected: boolean;
  /** The running daemon version reported over the server-global `event: version`
   *  (no leading "v"). `null` until the first `version` event. */
  daemonVersion: string | null;
  /** A pending toolkit update (matched tools + composite key), from the
   *  server-global `event: update-available`. `null` when no update is pending. */
  updateAvailable: UpdateAvailable | null;
  /** The composite `key` the user dismissed the update notice for (localStorage
   *  `runkit-update-dismissed`), or `null` when none. The chip hides when this
   *  equals `updateAvailable.key`; the palette action ignores it. */
  updateDismissedKey: string | null;
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
  // Undebounced state-socket open/closed signal (260717-vhvz). Exposed so the
  // chat-lens owner hook can compose the chat dot = (socket connected) AND (chat
  // acked) and apply its own 3s disconnect debounce. Distinct from
  // `socketConnectedRef` (a ref used by the per-server dot apply path) — this is
  // React state so the hook re-renders on a socket transition.
  const [socketConnected, setSocketConnected] = useState(false);
  // Chat frame handlers, keyed by window ID (260717-vhvz). Stored in a ref so the
  // socket's onEvent/onAck chat branch can route a frame to the owning lens
  // without re-running on every registration (same idiom as
  // boardChangeSubscribersRef).
  const chatHandlersRef = useRef<Map<string, ChatFrameHandlers>>(new Map());
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
  // Pending toolkit update from the server-global `event: update-available`.
  const [updateAvailable, setUpdateAvailable] = useState<UpdateAvailable | null>(null);
  // The composite key the user dismissed the notice for (localStorage-backed).
  const [updateDismissedKey, setUpdateDismissedKey] = useState<string | null>(() => {
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
  // connection) and re-broadcasts whenever the composite key changes — including
  // to EMPTY when a match is consumed (R7/R8). Deduping on the composite `key`
  // collapses an idempotent replay (a reconnect re-sends the cached slot) to no
  // state change, so a re-delivery of the same matched set does not churn
  // consumers.
  //
  // A CLEARED payload (empty key) clears the stored state so the chip hides —
  // it MUST NOT early-return (the old bug that left a consumed match advertised
  // forever after a siblings-only update, which never restarts the daemon). A
  // non-empty key stores/dedups as before.
  const applyUpdateAvailable = useCallback((next: UpdateAvailable) => {
    if (!next.key) {
      setUpdateAvailable((prev) => (prev === null ? prev : null));
      return;
    }
    setUpdateAvailable((prev) => (prev && prev.key === next.key ? prev : next));
  }, []);

  const dismissUpdate = useCallback(() => {
    const key = updateAvailable?.key;
    if (!key) return;
    try {
      localStorage.setItem(UPDATE_DISMISSED_KEY, key);
    } catch {
      // localStorage unavailable — dismissal is best-effort.
    }
    setUpdateDismissedKey(key);
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

  // Chat subscription seam (260717-vhvz). The owner hook registers a window's
  // handlers, then drives subscribe/unsubscribe through these helpers — never a
  // direct socket handle (the singleton-socket ownership pattern). Chat frames
  // are routed to `chatHandlersRef` from the socket's onEvent/onAck chat branch.
  const registerChatHandlers = useCallback(
    (windowId: string, handlers: ChatFrameHandlers) => {
      chatHandlersRef.current.set(windowId, handlers);
      return () => {
        // Only clear if still ours — a fast re-register for the same window id
        // (StrictMode double-run) must not delete the newer registration.
        if (chatHandlersRef.current.get(windowId) === handlers) {
          chatHandlersRef.current.delete(windowId);
        }
      };
    },
    [],
  );
  const subscribeChat = useCallback((args: ChatSubscribeArgs) => {
    socketRef.current?.subscribeChat(args);
  }, []);
  const unsubscribeChat = useCallback((args: ChatUnsubscribeArgs) => {
    socketRef.current?.unsubscribeChat(args);
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
  // acked).
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
          const d = data as {
            tools?: {
              tool?: string;
              current?: string;
              latest?: string;
              updateAvailable?: boolean;
              notable?: boolean;
            }[];
            key?: string;
            current?: string;
            latest?: string;
          };
          if (typeof d.key === "string" && Array.isArray(d.tools)) {
            const tools: UpdateTool[] = d.tools
              .filter(
                (t): t is UpdateTool =>
                  typeof t.tool === "string" &&
                  typeof t.current === "string" &&
                  typeof t.latest === "string",
              )
              .map((t) => ({
                tool: t.tool,
                current: t.current,
                latest: t.latest,
                // The verdict flags ride only when the daemon sends booleans —
                // an old daemon's flag-less payload leaves them undefined, which
                // consumers treat as true (every listed tool was matched).
                ...(typeof t.updateAvailable === "boolean"
                  ? { updateAvailable: t.updateAvailable }
                  : {}),
                ...(typeof t.notable === "boolean" ? { notable: t.notable } : {}),
              }));
            applyUpdateAvailable({
              tools,
              key: d.key,
              current: typeof d.current === "string" ? d.current : "",
              latest: typeof d.latest === "string" ? d.latest : "",
            });
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
    };

    const socket = new StateSocket({
      onEvent: (ev) => {
        if (ev.kind === "server" && ev.key) {
          eventRef.current.handleServerEvent(ev.type, ev.key, ev.data);
        } else if (ev.kind === "global") {
          eventRef.current.handleGlobalEvent(ev.type, ev.data);
        } else if (ev.kind === "chat" && ev.key) {
          // Route to the owning lens's handlers (keyed by window id). A frame for
          // a window with no live registration (a late frame after unsubscribe)
          // is dropped.
          chatHandlersRef.current.get(ev.key)?.onEvent(ev.type, ev.data);
        }
      },
      onAck: (_req, kind, key, snapshot, offset) => {
        if (kind === "metrics") {
          // The metrics ack snapshot is the cached metrics payload (or null).
          if (snapshot) {
            eventRef.current.handleGlobalEvent("metrics", snapshot);
          }
          return;
        }
        if (kind === "chat") {
          // A chat ack carries the tail-start byte offset, no snapshot (D5).
          if (key) chatHandlersRef.current.get(key)?.onAck(offset ?? 0);
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
        // Undebounced socket-open signal for the chat-lens dot (the owner hook
        // applies its own 3s disconnect debounce; the per-server dots keep the
        // debounce below).
        setSocketConnected(connected);
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
      // subscription on `/` (host-metrics data dead, poll loop never started
      // when this is the hub's only client). `ackedServersRef` is cleared too
      // since nothing is acked on the new socket until fresh acks arrive. These
      // effects re-run on every remount regardless of dep changes, so cleared
      // guards make them re-subscribe.
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
      subscribeChat,
      unsubscribeChat,
      registerChatHandlers,
      socketConnected,
      daemonVersion,
      updateAvailable,
      updateDismissedKey,
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
      subscribeChat,
      unsubscribeChat,
      registerChatHandlers,
      socketConnected,
      daemonVersion,
      updateAvailable,
      updateDismissedKey,
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

/** The run-kit manifest/roster tool name — the single tool that keeps today's
 *  `⬆ v{latest}` chip form (any other single tool, or multiple, uses a count
 *  form). Mirrors the backend's `runKitTool` constant. */
const RUN_KIT_TOOL = "run-kit";

/** Frozen module-level empty tools list — the stable fallback for
 *  `updateAvailable?.tools ?? EMPTY_TOOLS` in `useUpdateNotification`, so a
 *  no-update render returns the SAME array reference every time instead of
 *  minting a fresh `[]` (which would defeat referential-equality memoization in
 *  consumers and churn the top bar's fit effect). Frozen at runtime (no consumer
 *  mutates it); typed as the mutable `UpdateTool[]` to match the exported
 *  `tools` contract without a readonly ripple through its consumers. */
const EMPTY_TOOLS: UpdateTool[] = Object.freeze([]) as unknown as UpdateTool[];

/** Derived view of the update-notification state, shared by the top-bar chip and
 *  the command-palette actions so their gating can never drift.
 *   - `qualifies` — a NOTABLE pending update exists AND the daemon is not the
 *     `dev` sentinel. (This is the palette's gate; the palette IGNORES
 *     dismissal — dismissal silences only the ambient chip.)
 *   - `showChip` — `qualifies` AND the composite `key` is not dismissed. This is
 *     the chip's visibility gate. Sub-threshold (`notable: false`) verdicts in
 *     the payload never light the chip — a patch-only finding is toast-only
 *     (surfaced by the palette check commands), by policy.
 *   - `tools` — the NOTABLE tools (each `{tool, current, latest}`), filtered
 *     from the payload's full verdict list (a missing flag — old-daemon payload
 *     — counts as notable). Empty when nothing notable is pending.
 *   - `key` — the composite dismissal key (or `null`).
 *   - `singleRunKit` — true when exactly one tool matched and it is run-kit, so
 *     the chip keeps today's `⬆ v{latest}` form; otherwise a count form.
 *   - `latest` / `current` — the run-kit row versions when `singleRunKit`, else
 *     `null`; kept for the single-run-kit chip/palette wording.
 *   - `updateNow` / `dismissUpdate` — the context actions, re-exported.
 *   - `daemonVersion` — the running version (or `null`), for the dev-gate.
 *   - `brew` — whether the daemon is a Homebrew install, gating the force-update
 *     maintenance entry (`false` until the first version event).
 *   - `forceUpdateNow` / `restartNow` — the maintenance actions, re-exported. */
export function useUpdateNotification(): {
  qualifies: boolean;
  showChip: boolean;
  tools: UpdateTool[];
  key: string | null;
  singleRunKit: boolean;
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
  // — e.g. isolated component tests. Mirrors how usePushSubscription (the
  // settings dialog's Notifications row) never throws without a provider.
  const ctx = useContext(SessionContext);
  const daemonVersion = ctx?.daemonVersion ?? null;
  const updateAvailable = ctx?.updateAvailable ?? null;
  const updateDismissedKey = ctx?.updateDismissedKey ?? null;
  const updateNow = ctx?.updateNow ?? (() => Promise.resolve());
  const dismissUpdate = ctx?.dismissUpdate ?? (() => {});
  const brew = ctx?.brew ?? false;
  const forceUpdateNow = ctx?.forceUpdateNow ?? (() => Promise.resolve());
  const restartNow = ctx?.restartNow ?? (() => Promise.resolve());
  const isDev = daemonVersion === DEV_VERSION;
  // The payload's tools list is the FULL verdict list (incl. sub-threshold
  // rows); chip/palette consumers care about the NOTABLE subset only. A missing
  // flag (old-daemon payload — it listed only matched tools) counts as notable.
  // Memoized with identity preserved when nothing filters out, so a no-op
  // filter never mints a fresh array (same referential-equality concern as
  // EMPTY_TOOLS — see its comment).
  const tools = useMemo(() => {
    const all = updateAvailable?.tools ?? EMPTY_TOOLS;
    const notable = all.filter((t) => t.notable !== false);
    return notable.length === all.length ? all : notable;
  }, [updateAvailable]);
  const key = updateAvailable?.key ?? null;
  const singleRunKit = tools.length === 1 && tools[0].tool === RUN_KIT_TOOL;
  // The run-kit row versions, surfaced only for the single-run-kit chip/palette
  // wording (`⬆ v{latest}` / `run-kit: Update to v{latest}`). Null otherwise —
  // a multi/non-run-kit chip uses the count form and per-tool detail.
  const latest = singleRunKit ? tools[0].latest : null;
  const current = singleRunKit ? tools[0].current : null;
  const qualifies = !isDev && tools.length > 0;
  const showChip = qualifies && key !== updateDismissedKey;
  return {
    qualifies,
    showChip,
    tools,
    key,
    singleRunKit,
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

/** Standalone provider for tests and storybook — supplies a `null` or fake
 *  host-global metrics value without requiring the full SessionProvider.
 *  Counterpart to `MetricsProvider` above, for the `useHostMetrics()` seam. */
export function HostMetricsProvider({
  value,
  children,
}: {
  value: MetricsSnapshot | null;
  children: React.ReactNode;
}) {
  return <HostMetricsContext.Provider value={value}>{children}</HostMetricsContext.Provider>;
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
    subscribeChat: value.subscribeChat ?? (() => {}),
    unsubscribeChat: value.unsubscribeChat ?? (() => {}),
    registerChatHandlers: value.registerChatHandlers ?? (() => () => {}),
    socketConnected: value.socketConnected ?? false,
    daemonVersion: value.daemonVersion ?? null,
    updateAvailable: value.updateAvailable ?? null,
    updateDismissedKey: value.updateDismissedKey ?? null,
    updateNow: value.updateNow ?? (() => Promise.resolve()),
    dismissUpdate: value.dismissUpdate ?? (() => {}),
    brew: value.brew ?? false,
    forceUpdateNow: value.forceUpdateNow ?? (() => Promise.resolve()),
    restartNow: value.restartNow ?? (() => Promise.resolve()),
  };
  return <SessionContext.Provider value={fullValue}>{children}</SessionContext.Provider>;
}
