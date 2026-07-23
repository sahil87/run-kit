// StateSocket — the single per-tab WebSocket carrying all session-state and
// host-metrics streams (change 260716-qf3j-state-socket).
//
// Replaces the per-server + metrics-only EventSource pool. One established
// WebSocket holds NO slot in the browser's 6-per-origin HTTP/1.1 pool (see
// docs/findings/socket-pool-accounting.md), so consolidating the state streams
// onto it clears the pool starvation that blocked terminal-relay handshakes on
// Firefox/WebKit for plaintext origins.
//
// Contract-preservation: the server delivers today's SSE event names/payloads
// verbatim inside the envelope's `type`/`data`, so consumers above the
// session-context seams are unchanged — this module just demuxes the envelope
// back into (kind, type, key, data) callbacks.

/** A decoded server → client event, matching the retired SSE `event: <type>`
 *  with its `data:` JSON parsed. `key` is the server name for per-server events
 *  (kind "server"), the window ID for chat events (kind "chat"), and undefined
 *  for host-global events (kind "global"). */
export type StateEvent = {
  kind: "server" | "global" | "chat";
  type: string;
  key?: string;
  data: unknown;
};

export type StateSocketHandlers = {
  /** A demuxed event (kind/type/key/data). */
  onEvent: (ev: StateEvent) => void;
  /** A subscription was acked. `key` is the server name for a server
   *  subscription, the window ID for a chat subscription, and undefined for the
   *  metrics subscription. `snapshot` carries the sessions/metrics payload for
   *  server/metrics kinds; `offset` carries the chat tail-start byte offset (D5
   *  — chat acks carry no snapshot). */
  onAck?: (
    req: number,
    kind: string,
    key: string | undefined,
    snapshot: unknown,
    offset?: number,
  ) => void;
  /** A subscribed server's tmux socket is gone (replaces SSE `server-gone`). */
  onGone?: (key: string) => void;
  /** Socket-level connection state changed (open ⇢ true, close/error ⇢ false).
   *  Drives the connection-dot debounce in the provider. */
  onConnectionChange?: (connected: boolean) => void;
};

/** The window ID a chat frame (event or ack) addresses, so the owner hook can
 *  route it to the right chat lens. */
export type ChatSubscribeArgs = { server: string; windowId: string; from: number };
export type ChatUnsubscribeArgs = { server: string; windowId: string };

type Subscription =
  | { kind: "server"; key: string }
  | { kind: "metrics" };

const RECONNECT_BASE_MS = 1000;
const RECONNECT_CAP_MS = 15000;

// Client-side liveness (change 260723-rma2-websocket-liveness). After machine
// sleep the TCP connection can die silently (half-open): `onclose` never fires
// and readyState stays OPEN, so the reconnect machinery never runs and the
// socket is deaf forever. Detection is a client-initiated app-level heartbeat —
// {op:"ping"} every HEARTBEAT_INTERVAL_MS, answered by {op:"pong"} — where ANY
// inbound frame counts as proof of life (pongs are not correlated). Silence is
// judged only against pings actually sent (an outstanding-ping clock), so
// background-tab timer throttling delaying our OWN pings can never force-close
// a healthy socket. Protocol-level WS pings cannot do this job: browsers
// auto-answer them in the network stack, invisibly to JS.
export const HEARTBEAT_INTERVAL_MS = 30000;
export const LIVENESS_TIMEOUT_MS = 2 * HEARTBEAT_INTERVAL_MS;
// Wake probes (visibilitychange→visible / online / pageshow) ping an OPEN
// socket and force-close it if nothing arrives within this deadline — the
// sleep/wake fast path that doesn't wait out a full heartbeat interval.
export const WAKE_PROBE_TIMEOUT_MS = 3000;

/** Build the `/ws/state` URL from the current origin (ws/wss per protocol),
 *  mirroring terminal-client.tsx's relay URL construction. */
function stateSocketURL(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/state`;
}

/** StateSocket owns one WebSocket to `/ws/state`. On open it sends `hello` with
 *  a client-generated conn id, then (re)subscribes every active subscription;
 *  each subscribe re-acks with a fresh snapshot. On drop it reconnects with
 *  exponential backoff (1s → 15s cap) and resubscribes all. Subscriptions are
 *  ref-counted so overlapping consumers (e.g. current server + an expanded
 *  sidebar group naming the same server) share one wire subscription. */
export class StateSocket {
  private ws: WebSocket | null = null;
  private readonly handlers: StateSocketHandlers;
  private readonly connID: string;
  // Ref-counted subscriptions keyed by a stable id ("server:<name>" | "metrics").
  private readonly refCounts = new Map<string, number>();
  private readonly subs = new Map<string, Subscription>();
  private nextReq = 1;
  private reqToKey = new Map<number, string>();
  // Chat subscriptions are deliberately NOT tracked in `subs` (so the onopen
  // blind-resubscribe loop never re-sends a chat subscribe with a stale `from`).
  // The owner hook re-runs its fetch→subscribe composition on reconnect instead
  // (decision D5 / the no-cursor reset contract). We only remember the pending
  // subscribe req → windowId so a chat ack can be routed back to its lens.
  private reqToChatWindow = new Map<number, string>();
  private backoff = RECONNECT_BASE_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  // Liveness (260723-rma2). `outstandingPingSince` is the outstanding-ping
  // clock: set when a ping goes out with no prior ping outstanding, cleared by
  // ANY inbound frame. A ping outstanding ≥ LIVENESS_TIMEOUT_MS ⇒ the socket is
  // presumed half-open dead ⇒ forceClose() into the existing reconnect path.
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private outstandingPingSince: number | null = null;
  private wakeProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeListenersRegistered = false;
  private readonly onWakeEvent = () => this.handleWake();
  private readonly onVisibilityEvent = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      this.handleWake();
    }
  };

  constructor(handlers: StateSocketHandlers, connID?: string) {
    this.handlers = handlers;
    this.connID =
      connID ??
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `conn-${Math.random().toString(36).slice(2)}`);
  }

  /** Open the socket. Idempotent — a second call while open/connecting is a
   *  no-op. */
  connect(): void {
    if (this.closed) return;
    this.registerWakeListeners();
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const ws = new WebSocket(stateSocketURL());
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = RECONNECT_BASE_MS;
      this.send({ op: "hello", conn: this.connID });
      // Resubscribe every active subscription; each re-acks with a fresh
      // snapshot (the reconnect recovery path).
      for (const sub of this.subs.values()) {
        this.sendSubscribe(sub);
      }
      this.startHeartbeat();
      this.handlers.onConnectionChange?.(true);
    };

    ws.onmessage = (e: MessageEvent) => {
      this.noteInbound();
      this.handleFrame(e.data);
    };

    ws.onclose = () => {
      // Pending subscribe reqs belong to the dead connection and will never be
      // acked — reconnect resubscribes with fresh req numbers. Clear them so
      // repeated drop-while-pending cycles can't grow the maps unbounded. Chat
      // reqs are cleared too; the owner hook re-runs its fetch→subscribe
      // composition on reconnect (chat is not blindly resubscribed here).
      this.reqToKey.clear();
      this.reqToChatWindow.clear();
      this.stopHeartbeat();
      this.handlers.onConnectionChange?.(false);
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose follows onerror in every engine; let it drive the reconnect so
      // we don't schedule twice.
      this.handlers.onConnectionChange?.(false);
    };
  }

  /** Close permanently (tab unload / provider unmount). No reconnect after.
   *  Also tears down the heartbeat/wake-probe timers and listeners. */
  close(): void {
    this.closed = true;
    this.removeWakeListeners();
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // suppress the reconnect path on an intentional close
      this.ws.close();
      this.ws = null;
    }
  }

  /** Subscribe to a tmux server's state (idempotent, ref-counted). */
  subscribeServer(name: string): void {
    this.addSub("server:" + name, { kind: "server", key: name });
  }

  /** Unsubscribe from a tmux server (ref-counted; the wire unsubscribe fires
   *  only when the last consumer releases). */
  unsubscribeServer(name: string): void {
    this.removeSub("server:" + name, { kind: "server", key: name });
  }

  /** Subscribe to the host-metrics + services stream (the `?metrics=1`
   *  replacement). Ref-counted. */
  subscribeMetrics(): void {
    this.addSub("metrics", { kind: "metrics" });
  }

  /** Unsubscribe from the host-metrics stream (ref-counted). */
  unsubscribeMetrics(): void {
    this.removeSub("metrics", { kind: "metrics" });
  }

  /** Declare the tile grid's expanded-session set for a server (in-band twin of
   *  POST /api/preview-scope, addressed by this socket's own conn id). */
  sendPreviewScope(server: string, expanded: string[]): void {
    this.send({ op: "preview-scope", server, expanded });
  }

  /** Subscribe to a chat window's incremental stream (260717-vhvz). Carries the
   *  transcript byte `from` offset the client's GET backfill read up to, so the
   *  server's tail composes gap-free with the fetch. NOT ref-counted and NOT
   *  tracked in `subs`: chat's `from` is a stateful cursor a blind reconnect
   *  resubscribe would send stale, so the owner hook re-runs fetch→subscribe on
   *  reconnect instead. A no-op if the socket is not OPEN (the hook re-issues on
   *  reconnect) — the pending req is recorded ONLY when the frame is actually sent,
   *  so a not-OPEN call leaves no lingering reqToChatWindow row. */
  subscribeChat({ server, windowId, from }: ChatSubscribeArgs): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const req = this.nextReq++;
    this.reqToChatWindow.set(req, windowId);
    this.send({ op: "subscribe", kind: "chat", key: windowId, server, from, req });
  }

  /** Unsubscribe a chat window (cancels its server-side producer). */
  unsubscribeChat({ server, windowId }: ChatUnsubscribeArgs): void {
    this.send({ op: "unsubscribe", kind: "chat", key: windowId, server });
  }

  private addSub(id: string, sub: Subscription): void {
    const prev = this.refCounts.get(id) ?? 0;
    this.refCounts.set(id, prev + 1);
    if (prev === 0) {
      this.subs.set(id, sub);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendSubscribe(sub);
      }
    }
  }

  private removeSub(id: string, sub: Subscription): void {
    const prev = this.refCounts.get(id) ?? 0;
    if (prev <= 1) {
      this.refCounts.delete(id);
      this.subs.delete(id);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (sub.kind === "server") {
          this.send({ op: "unsubscribe", kind: "server", key: sub.key });
        } else {
          this.send({ op: "unsubscribe", kind: "metrics" });
        }
      }
    } else {
      this.refCounts.set(id, prev - 1);
    }
  }

  private sendSubscribe(sub: Subscription): void {
    const req = this.nextReq++;
    if (sub.kind === "server") {
      this.reqToKey.set(req, "server:" + sub.key);
      this.send({ op: "subscribe", kind: "server", key: sub.key, req });
    } else {
      this.reqToKey.set(req, "metrics");
      this.send({ op: "subscribe", kind: "metrics", req });
    }
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, RECONNECT_CAP_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // --- Liveness: heartbeat + wake probes (260723-rma2) ----------------------

  /** Record proof of life: ANY inbound frame clears the outstanding-ping clock
   *  and cancels a pending wake-probe deadline (pongs are not correlated —
   *  events/acks/gone/error all count). */
  private noteInbound(): void {
    this.outstandingPingSince = null;
    if (this.wakeProbeTimer) {
      clearTimeout(this.wakeProbeTimer);
      this.wakeProbeTimer = null;
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.outstandingPingSince = null;
    this.heartbeatTimer = setInterval(() => this.heartbeatTick(), HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.outstandingPingSince = null;
    if (this.wakeProbeTimer) {
      clearTimeout(this.wakeProbeTimer);
      this.wakeProbeTimer = null;
    }
  }

  /** One heartbeat tick: enforce liveness against the outstanding ping, then
   *  send this tick's ping. The clock starts only when a ping ACTUALLY goes out
   *  (hidden-tab guard: browser timer throttling delaying our own pings can
   *  never force-close a healthy socket — a live server answers whenever the
   *  ping is finally sent, and any inbound frame clears the clock). */
  private heartbeatTick(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (
      this.outstandingPingSince !== null &&
      Date.now() - this.outstandingPingSince >= LIVENESS_TIMEOUT_MS
    ) {
      this.forceClose();
      return;
    }
    this.sendPing();
  }

  /** Send a liveness ping, starting the outstanding-ping clock if no ping is
   *  already outstanding (the clock tracks the OLDEST unanswered ping). */
  private sendPing(): void {
    this.send({ op: "ping" });
    if (this.outstandingPingSince === null) {
      this.outstandingPingSince = Date.now();
    }
  }

  /** Force-close a presumed half-open dead socket so the EXISTING reconnect
   *  machinery takes over. Deliberately distinct from public close(): it does
   *  NOT set `closed` and does NOT null `ws.onclose` — a local ws.close() fires
   *  `onclose` client-side even when the TCP peer is gone, which drives cleanup
   *  + scheduleReconnect() + blind resubscribe. */
  private forceClose(): void {
    if (this.closed || !this.ws) return;
    this.ws.close();
  }

  /** Wake probe (visibilitychange→visible / online / pageshow). A pending
   *  reconnect backoff timer fires immediately with backoff reset to base
   *  (waking mid-backoff must not wait out the 15s cap); an OPEN socket gets a
   *  probe ping with a short deadline — any inbound frame cancels it, silence
   *  force-closes into the reconnect path. */
  private handleWake(): void {
    if (this.closed) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.backoff = RECONNECT_BASE_MS;
      this.connect();
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.wakeProbeTimer) {
      this.sendPing();
      this.wakeProbeTimer = setTimeout(() => {
        this.wakeProbeTimer = null;
        this.forceClose();
      }, WAKE_PROBE_TIMEOUT_MS);
    }
  }

  /** Register the instance-owned wake-probe listeners (idempotent; removed on
   *  permanent close()). Environment-guarded — jsdom test stubs and non-browser
   *  contexts without addEventListener are silently skipped. */
  private registerWakeListeners(): void {
    if (this.wakeListenersRegistered) return;
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", this.onVisibilityEvent);
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", this.onWakeEvent);
      window.addEventListener("pageshow", this.onWakeEvent);
    }
    this.wakeListenersRegistered = true;
  }

  private removeWakeListeners(): void {
    if (!this.wakeListenersRegistered) return;
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", this.onVisibilityEvent);
    }
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("online", this.onWakeEvent);
      window.removeEventListener("pageshow", this.onWakeEvent);
    }
    this.wakeListenersRegistered = false;
  }

  private handleFrame(raw: string): void {
    let msg: {
      op?: string;
      kind?: string;
      key?: string;
      type?: string;
      data?: unknown;
      req?: number;
      snapshot?: unknown;
      offset?: number;
      reason?: string;
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // malformed frame — skip
    }
    switch (msg.op) {
      case "event":
        if (
          typeof msg.type === "string" &&
          (msg.kind === "server" || msg.kind === "global" || msg.kind === "chat")
        ) {
          this.handlers.onEvent({
            kind: msg.kind,
            type: msg.type,
            key: msg.key,
            data: msg.data,
          });
        }
        break;
      case "ack": {
        const req = typeof msg.req === "number" ? msg.req : -1;
        // A chat ack is routed by the pending req → windowId we recorded on
        // subscribeChat (chat subs are not in `subs`). It carries an `offset`
        // (the tail-start byte position, D5) and NO snapshot.
        const chatWindow = this.reqToChatWindow.get(req);
        if (chatWindow !== undefined) {
          this.reqToChatWindow.delete(req);
          this.handlers.onAck?.(req, "chat", chatWindow, undefined, msg.offset);
          break;
        }
        const id = this.reqToKey.get(req);
        this.reqToKey.delete(req);
        // Derive the acked subscription's kind/key from the id we recorded.
        let kind = "server";
        let key: string | undefined;
        if (id === "metrics") {
          kind = "metrics";
        } else if (id?.startsWith("server:")) {
          kind = "server";
          key = id.slice("server:".length);
        }
        this.handlers.onAck?.(req, kind, key, msg.snapshot);
        break;
      }
      case "gone":
        if (typeof msg.key === "string") {
          this.handlers.onGone?.(msg.key);
        }
        break;
      case "error":
        // Non-fatal protocol error (e.g. an invalid server key or unknown op).
        // The socket stays live. When the error carries the offending `req`, the
        // server rejected a subscribe that will never ack — drop its pending
        // reqToKey / reqToChatWindow entry so the maps don't leak one row per
        // rejected subscribe.
        if (typeof msg.req === "number") {
          this.reqToKey.delete(msg.req);
          this.reqToChatWindow.delete(msg.req);
        }
        break;
      default:
        break;
    }
  }
}
