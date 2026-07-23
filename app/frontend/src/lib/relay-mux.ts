// RelayMux — the single per-tab WebSocket carrying all terminal pane streams
// (change 260717-803u-relay-mux).
//
// Replaces the per-pane `/relay/{windowId}` WebSocket (retired handleRelay). A
// board with N panes previously held N TCP connections, N reconnect paths, and
// N upgrade handshakes; the mux collapses them onto ONE `/ws/terminals` socket
// (connection hygiene — see docs/findings/socket-pool-accounting.md). The one
// residual protocol risk (head-of-line blocking across streams) is handled
// server-side by per-stream bounded queues + a fair scheduler
// (docs/findings/relay-mux-hol.md); the client just frames and demuxes.
//
// Wire protocol (verbatim from fab/plans/sahil/socket-unification.md
// §Terminal socket): binary `[u32 BE streamId][payload]` data frames both
// directions + JSON control ops open/opened/resize/close/closed. Stream ids are
// client-allocated u32s, unique within a socket connection.

/** A live pane stream on the mux. Returned by openStream. */
export type RelayStream = {
  /** Send a keystroke / input payload as a binary data frame for this stream. */
  send: (data: string | ArrayBufferView | ArrayBuffer) => void;
  /** Send a resize control op for this stream. */
  resize: (cols: number, rows: number) => void;
  /** Update the stream's target window WITHOUT reconnecting. A same-session
   *  window switch rides the live stream (tmux moves the attached PTY's active
   *  window in place), but the mux must remember the NEW windowId so a later
   *  socket-level drop re-issues `open` for the window the user is looking at
   *  NOW — not the stale open-time one (which would make the server
   *  SelectWindowInSession the old window and yank the pane back). */
  setWindowId: (windowId: string) => void;
  /** Close this stream (sends a close control op) and detach its callbacks. */
  close: () => void;
  /** Register the inbound-data callback (binary payloads for this stream). */
  onData: (cb: (data: Uint8Array) => void) => void;
  /** Register the stream-opened callback (the server's `opened` control event).
   *  Fires once per open→opened exchange — the INITIAL open AND every
   *  transparent re-open after a socket-level reconnect. TerminalClient anchors
   *  its connect-select alignment epoch and re-arms its deferred per-stream
   *  reset here so a reconnect repaints flicker-free on the incoming first data
   *  frame. */
  onOpened: (cb: () => void) => void;
  /** Register the stream-closed callback (the server's `closed` control event,
   *  carrying the close code — 4004 window-not-found, 4001 attach-failed, 1000
   *  normal). Fired at most once per open; a socket-level drop does NOT fire it
   *  (the mux re-opens the stream transparently on reconnect). */
  onClosed: (cb: (code: number, reason: string) => void) => void;
};

export type OpenStreamOpts = {
  server: string;
  windowId: string;
  cols: number;
  rows: number;
};

type StreamState = {
  id: number;
  opts: OpenStreamOpts;
  onData: ((data: Uint8Array) => void) | null;
  onOpened: (() => void) | null;
  onClosed: ((code: number, reason: string) => void) | null;
};

const RECONNECT_BASE_MS = 1000;
const RECONNECT_CAP_MS = 30000;

// Client-side liveness (change 260723-rma2-websocket-liveness), mirroring
// state-socket.ts. After machine sleep the TCP connection can die silently
// (half-open): `onclose` never fires and readyState stays OPEN, so the
// reconnect machinery never runs. Detection is a client-initiated app-level
// heartbeat — {op:"ping"} / {op:"pong"} as JSON control ops carrying NO stream
// id — where ANY inbound frame (binary data AND text control both) counts as
// proof of life, so a busy terminal never needs a pong. Silence is judged only
// against pings actually sent (an outstanding-ping clock), immune to
// background-tab timer throttling. The heartbeat runs only while the socket is
// open AND ≥1 live stream exists — it never resurrects the deliberately-closed
// idle socket.
export const HEARTBEAT_INTERVAL_MS = 30000;
export const LIVENESS_TIMEOUT_MS = 2 * HEARTBEAT_INTERVAL_MS;
export const WAKE_PROBE_TIMEOUT_MS = 3000;

/** Build the `/ws/terminals` URL from the current origin (ws/wss per protocol),
 *  mirroring state-socket.ts's stateSocketURL(). */
function terminalsSocketURL(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/terminals`;
}

/** RelayMux owns one WebSocket to `/ws/terminals`. Each openStream allocates a
 *  fresh u32 id and issues an `open` op (once the socket is open). On a
 *  socket-level drop it reconnects with exponential backoff and re-issues
 *  `open` for every still-live stream — the mux re-attaches server-side, and
 *  each TerminalClient's deferred per-stream reset repaints on the incoming
 *  first data frame, so a reconnect is flicker-free without any per-stream
 *  onClosed. Stream ids are NOT reused across reconnects within a live stream
 *  (the same id re-opens); a closed stream's id is simply retired. */
export class RelayMux {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly streams = new Map<number, StreamState>();
  private backoff = RECONNECT_BASE_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  // Liveness (260723-rma2), mirroring state-socket.ts: `outstandingPingSince`
  // is set when a ping goes out with no prior ping outstanding and cleared by
  // ANY inbound frame; outstanding ≥ LIVENESS_TIMEOUT_MS ⇒ forceClose() into
  // the existing reconnect path. The heartbeat is stream-gated (OPEN ∧
  // streams.size > 0) via syncHeartbeat().
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

  /** Open a new pane stream. Idempotently connects the socket on first use. */
  openStream(opts: OpenStreamOpts): RelayStream {
    const id = this.nextId++;
    const state: StreamState = { id, opts, onData: null, onOpened: null, onClosed: null };
    this.streams.set(id, state);

    this.connect();
    // If the socket is already open, issue the open op now; otherwise it is
    // (re)issued in ws.onopen for every live stream.
    this.sendOpen(state);
    // First stream on an already-open socket restarts the stream-gated
    // heartbeat (onopen handles the fresh-connect case).
    this.syncHeartbeat();

    return {
      send: (data) => this.sendData(id, data),
      resize: (cols, rows) => {
        const s = this.streams.get(id);
        if (s) {
          s.opts = { ...s.opts, cols, rows };
        }
        this.sendControl({ op: "resize", id, cols, rows });
      },
      setWindowId: (windowId) => {
        // Keep the stream's re-open target fresh on a same-session ride. No wire
        // op — the live PTY already tracks the new active window; this only
        // updates what a later reconnect will re-`open` (M1 fix).
        const s = this.streams.get(id);
        if (s) {
          s.opts = { ...s.opts, windowId };
        }
      },
      close: () => this.closeStream(id),
      onData: (cb) => {
        const s = this.streams.get(id);
        if (s) s.onData = cb;
      },
      onOpened: (cb) => {
        const s = this.streams.get(id);
        if (s) s.onOpened = cb;
      },
      onClosed: (cb) => {
        const s = this.streams.get(id);
        if (s) s.onClosed = cb;
      },
    };
  }

  /** Permanently close the mux (tab unload). No reconnect after. Also tears
   *  down the heartbeat/wake-probe timers and listeners. */
  close(): void {
    this.closed = true;
    this.removeWakeListeners();
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.streams.clear();
    if (this.ws) {
      this.ws.onclose = null; // suppress the reconnect path on an intentional close
      this.ws.close();
      this.ws = null;
    }
  }

  /** True while the underlying socket is open (consumed by the wsRef adapter's
   *  readyState shim in terminal-client.tsx). */
  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private connect(): void {
    if (this.closed) return;
    this.registerWakeListeners();
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    const ws = new WebSocket(terminalsSocketURL());
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = RECONNECT_BASE_MS;
      // Re-issue open for every live stream. On a fresh connect this is the
      // sole open; on a reconnect the mux re-attaches each stream server-side
      // (fresh PTY), and the TerminalClient's deferred reset repaints on the
      // first incoming data frame — flicker-free, no per-stream teardown.
      for (const s of this.streams.values()) {
        this.sendOpen(s);
      }
      this.syncHeartbeat();
    };

    ws.onmessage = (e: MessageEvent) => {
      // ANY inbound frame — binary data or text control — is proof of life
      // (a busy terminal never needs a pong to prove liveness).
      this.noteInbound();
      if (typeof e.data === "string") {
        this.handleControl(e.data);
      } else {
        this.handleData(e.data as ArrayBuffer);
      }
    };

    ws.onclose = () => {
      this.stopHeartbeat();
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose follows onerror in every engine; let it drive the reconnect.
    };
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    // No live streams → let the socket stay closed; the next openStream
    // reconnects. This keeps an idle tab from holding a terminals socket open.
    if (this.streams.size === 0) {
      this.ws = null;
      return;
    }
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, RECONNECT_CAP_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // --- Liveness: heartbeat + wake probes (260723-rma2) ----------------------

  /** Record proof of life: ANY inbound frame clears the outstanding-ping clock
   *  and cancels a pending wake-probe deadline. */
  private noteInbound(): void {
    this.outstandingPingSince = null;
    if (this.wakeProbeTimer) {
      clearTimeout(this.wakeProbeTimer);
      this.wakeProbeTimer = null;
    }
  }

  /** Reconcile the stream-gated heartbeat with the current state: running iff
   *  the socket is OPEN and ≥1 live stream exists. Idempotent — called from
   *  every gate transition (onopen, openStream, closeStream, a stream-level
   *  `closed`, onclose, close()). Never connects a closed socket. */
  private syncHeartbeat(): void {
    const shouldRun =
      !this.closed && this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.streams.size > 0;
    if (shouldRun && !this.heartbeatTimer) {
      this.outstandingPingSince = null;
      this.heartbeatTimer = setInterval(() => this.heartbeatTick(), HEARTBEAT_INTERVAL_MS);
    } else if (!shouldRun && this.heartbeatTimer) {
      this.stopHeartbeat();
    }
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
   *  (hidden-tab guard — timer throttling delaying our own pings can never
   *  force-close a healthy socket) and any inbound frame clears it. */
  private heartbeatTick(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.streams.size === 0) return;
    if (
      this.outstandingPingSince !== null &&
      Date.now() - this.outstandingPingSince >= LIVENESS_TIMEOUT_MS
    ) {
      this.forceClose();
      return;
    }
    this.sendPing();
  }

  /** Send a liveness ping (a JSON control op with NO stream id), starting the
   *  outstanding-ping clock if none is outstanding. */
  private sendPing(): void {
    this.sendControl({ op: "ping" });
    if (this.outstandingPingSince === null) {
      this.outstandingPingSince = Date.now();
    }
  }

  /** Force-close a presumed half-open dead socket so the EXISTING reconnect
   *  machinery takes over. Distinct from public close(): does NOT set `closed`
   *  and does NOT null `ws.onclose` — a local ws.close() fires `onclose`
   *  client-side even when the TCP peer is gone, driving scheduleReconnect()
   *  and the re-`open` of every live stream. */
  private forceClose(): void {
    if (this.closed || !this.ws) return;
    this.ws.close();
  }

  /** Wake probe (visibilitychange→visible / online / pageshow). No-ops with
   *  zero live streams — the idle socket deliberately stays closed and is never
   *  resurrected. Otherwise: a pending reconnect timer fires immediately with
   *  backoff reset to base; an OPEN socket gets a probe ping with a short
   *  deadline (any inbound frame cancels; silence force-closes). */
  private handleWake(): void {
    if (this.closed || this.streams.size === 0) return;
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
   *  permanent close()). Environment-guarded — test stubs and non-browser
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

  private sendOpen(s: StreamState): void {
    this.sendControl({
      op: "open",
      id: s.id,
      server: s.opts.server,
      windowId: s.opts.windowId,
      cols: s.opts.cols,
      rows: s.opts.rows,
    });
  }

  private closeStream(id: number): void {
    const s = this.streams.get(id);
    if (!s) return;
    this.streams.delete(id);
    this.sendControl({ op: "close", id });
    // Last stream gone ⇒ the stream-gated heartbeat stops (the idle socket is
    // deliberately left alone).
    this.syncHeartbeat();
  }

  private sendControl(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
    // If not open yet, the op is (re)issued on ws.onopen (for `open`) or simply
    // dropped for resize/close of a not-yet-opened stream — a resize before
    // open is subsumed by the open op's cols/rows (kept current in openStream's
    // resize handler above), and a close before open removes the stream so its
    // eventual open (on a race) targets nothing.
  }

  /** Encode + send a binary data frame `[u32 BE streamId][payload]`. */
  private sendData(id: number, data: string | ArrayBufferView | ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payload = toBytes(data);
    const frame = new Uint8Array(4 + payload.length);
    new DataView(frame.buffer).setUint32(0, id, false); // big-endian
    frame.set(payload, 4);
    this.ws.send(frame);
  }

  private handleControl(raw: string): void {
    let msg: { op?: string; id?: number; code?: number; reason?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // malformed control frame — skip
    }
    // The id-less `pong` control op MUST be handled before the stream-id guard
    // below (it addresses the socket, not a stream). The liveness bookkeeping
    // already happened in onmessage (any frame counts) — just swallow it.
    if (msg.op === "pong") return;
    if (typeof msg.id !== "number") return;
    const s = this.streams.get(msg.id);
    if (!s) return;
    switch (msg.op) {
      case "opened":
        s.onOpened?.();
        break;
      case "closed": {
        // A stream-level close (window not found, attach failed, or a graceful
        // close). Fire onClosed and retire the stream — the mux does not
        // re-open it (unlike a socket-level drop, handled in ws.onopen).
        this.streams.delete(msg.id);
        s.onClosed?.(typeof msg.code === "number" ? msg.code : 1000, msg.reason ?? "closed");
        // The stream-gated heartbeat stops when the last stream retires.
        this.syncHeartbeat();
        break;
      }
      default:
        break;
    }
  }

  private handleData(buf: ArrayBuffer): void {
    if (buf.byteLength < 4) return;
    const view = new DataView(buf);
    const id = view.getUint32(0, false); // big-endian
    const s = this.streams.get(id);
    if (!s || !s.onData) return;
    s.onData(new Uint8Array(buf, 4));
  }
}

/** Normalize a send payload to bytes. Strings are UTF-8 encoded (keystrokes,
 *  SGR sequences, pasted text — the same wire form the old relay sent as a
 *  string frame, now carried as binary under the mux). */
const encoder = new TextEncoder();
function toBytes(data: string | ArrayBufferView | ArrayBuffer): Uint8Array {
  if (typeof data === "string") return encoder.encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** The process-wide singleton terminals mux. One socket per tab, lazily
 *  connected on the first openStream. */
export const relayMux = new RelayMux();
