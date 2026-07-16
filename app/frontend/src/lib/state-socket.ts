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
 *  (kind "server") and undefined for host-global events (kind "global"). */
export type StateEvent = {
  kind: "server" | "global";
  type: string;
  key?: string;
  data: unknown;
};

export type StateSocketHandlers = {
  /** A demuxed event (kind/type/key/data). */
  onEvent: (ev: StateEvent) => void;
  /** A subscription was acked with a fresh snapshot. `key` is the server name
   *  for a server subscription; undefined for the metrics subscription. */
  onAck?: (req: number, kind: string, key: string | undefined, snapshot: unknown) => void;
  /** A subscribed server's tmux socket is gone (replaces SSE `server-gone`). */
  onGone?: (key: string) => void;
  /** Socket-level connection state changed (open ⇢ true, close/error ⇢ false).
   *  Drives the connection-dot debounce in the provider. */
  onConnectionChange?: (connected: boolean) => void;
};

type Subscription =
  | { kind: "server"; key: string }
  | { kind: "metrics" };

const RECONNECT_BASE_MS = 1000;
const RECONNECT_CAP_MS = 15000;

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
  private backoff = RECONNECT_BASE_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

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
      this.handlers.onConnectionChange?.(true);
    };

    ws.onmessage = (e: MessageEvent) => {
      this.handleFrame(e.data);
    };

    ws.onclose = () => {
      // Pending subscribe reqs belong to the dead connection and will never be
      // acked — reconnect resubscribes with fresh req numbers. Clear them so
      // repeated drop-while-pending cycles can't grow reqToKey unbounded.
      this.reqToKey.clear();
      this.handlers.onConnectionChange?.(false);
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose follows onerror in every engine; let it drive the reconnect so
      // we don't schedule twice.
      this.handlers.onConnectionChange?.(false);
    };
  }

  /** Close permanently (tab unload / provider unmount). No reconnect after. */
  close(): void {
    this.closed = true;
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

  private handleFrame(raw: string): void {
    let msg: {
      op?: string;
      kind?: string;
      key?: string;
      type?: string;
      data?: unknown;
      req?: number;
      snapshot?: unknown;
      reason?: string;
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // malformed frame — skip
    }
    switch (msg.op) {
      case "event":
        if (typeof msg.type === "string" && (msg.kind === "server" || msg.kind === "global")) {
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
        // reqToKey entry so the map doesn't leak one row per rejected subscribe.
        if (typeof msg.req === "number") {
          this.reqToKey.delete(msg.req);
        }
        break;
      default:
        break;
    }
  }
}
