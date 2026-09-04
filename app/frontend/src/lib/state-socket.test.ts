import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  StateSocket,
  HEARTBEAT_INTERVAL_MS,
  LIVENESS_TIMEOUT_MS,
  WAKE_PROBE_TIMEOUT_MS,
  type StateSocketHandlers,
} from "./state-socket";

// Unit tests for StateSocket. A minimal mock WebSocket captures the client's
// outgoing frames and lets the test deliver server frames, so we can assert the
// wire shape and reconnect behavior without a backend. (The server/metrics kinds
// are covered end-to-end by session-context.test.tsx; this file focuses on
// socket-level behavior.)

const WS_OPEN = 1;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static current: MockWebSocket | null = null;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  url: string;
  readyState = WS_OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  sent: Array<Record<string, unknown>> = [];
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    MockWebSocket.current = this;
    // Open synchronously so connect() sends hello immediately (no queueMicrotask —
    // these tests drive the socket directly, not through React effects).
    this.readyState = WS_OPEN;
  }
  fireOpen() {
    this.onopen?.();
  }
  send(raw: string) {
    try {
      this.sent.push(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      // ignore
    }
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  deliver(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }
  /** All frames sent with the given op. */
  sentWith(op: string): Array<Record<string, unknown>> {
    return this.sent.filter((m) => m.op === op);
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  MockWebSocket.current = null;
  vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  // Close every socket the test opened (close() is idempotent) so the
  // instance-owned wake-probe listeners (260723-rma2) never leak onto the
  // shared jsdom document/window across tests.
  for (const s of openedSockets.splice(0)) {
    s.close();
  }
  vi.unstubAllGlobals();
});

const openedSockets: StateSocket[] = [];

/** Construct a StateSocket, connect, and fire the initial open so hello is sent. */
function open(handlers: StateSocketHandlers) {
  const sock = new StateSocket(handlers, "conn-test");
  openedSockets.push(sock);
  sock.connect();
  MockWebSocket.current!.fireOpen();
  return { sock, ws: MockWebSocket.current! };
}

// Liveness: heartbeat + wake probes (260723-rma2). Fake timers drive the ping
// cadence and the outstanding-ping liveness clock; jsdom's real document/window
// carry the wake-probe events. Every test closes its socket so the instance-
// owned listeners never leak across tests.
describe("StateSocket liveness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends {op:\"ping\"} every HEARTBEAT_INTERVAL_MS while OPEN", () => {
    const { sock, ws } = open({ onEvent: () => {} });
    expect(ws.sentWith("ping")).toHaveLength(0);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(ws.sentWith("ping")).toHaveLength(1);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(ws.sentWith("ping")).toHaveLength(2);
    sock.close();
  });

  it("any inbound frame counts as liveness — unanswered pings with events flowing never force-close", () => {
    const { sock, ws } = open({ onEvent: () => {} });

    // Three full intervals, each with a (non-pong) frame delivered in between:
    // the outstanding-ping clock is cleared by ANY frame, so no force-close
    // even though no pong ever arrives.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      ws.deliver({ op: "event", kind: "global", type: "metrics", data: {} });
    }
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

    expect(ws.readyState).toBe(MockWebSocket.OPEN);
    expect(MockWebSocket.instances).toHaveLength(1); // no reconnect happened
    sock.close();
  });

  it("silence past LIVENESS_TIMEOUT_MS force-closes and the reconnect machinery resubscribes (closed stays false)", () => {
    const { sock, ws } = open({ onEvent: () => {} });
    sock.subscribeServer("srv1");

    // Tick 1 sends the ping and starts the outstanding clock; tick 2 is within
    // the timeout; tick 3 sees the ping outstanding ≥ LIVENESS_TIMEOUT_MS and
    // force-closes.
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(ws.readyState).toBe(MockWebSocket.OPEN);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);

    // forceClose did NOT set `closed`, so onclose scheduled a reconnect;
    // advancing past the base backoff builds a FRESH socket that resubscribes.
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
    const ws2 = MockWebSocket.current!;
    expect(ws2).not.toBe(ws);
    ws2.fireOpen();
    expect(ws2.sentWith("hello")).toHaveLength(1);
    expect(ws2.sentWith("subscribe").some((m) => m.kind === "server" && m.key === "srv1")).toBe(true);
    sock.close();
  });

  it("wake probe pings an OPEN socket and force-closes when nothing arrives within the deadline", () => {
    const { sock, ws } = open({ onEvent: () => {} });

    window.dispatchEvent(new Event("online"));
    expect(ws.sentWith("ping")).toHaveLength(1);
    expect(ws.readyState).toBe(MockWebSocket.OPEN);

    vi.advanceTimersByTime(WAKE_PROBE_TIMEOUT_MS);
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);

    // The existing reconnect path takes over.
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
    sock.close();
  });

  it("any inbound frame before the wake-probe deadline cancels the force-close", () => {
    const { sock, ws } = open({ onEvent: () => {} });

    document.dispatchEvent(new Event("visibilitychange")); // jsdom is "visible"
    expect(ws.sentWith("ping")).toHaveLength(1);

    ws.deliver({ op: "pong" });
    vi.advanceTimersByTime(WAKE_PROBE_TIMEOUT_MS + 1000);

    expect(ws.readyState).toBe(MockWebSocket.OPEN);
    expect(MockWebSocket.instances).toHaveLength(1);
    sock.close();
  });

  it("wake probe fires a pending reconnect timer immediately with backoff reset to base", () => {
    const { sock, ws } = open({ onEvent: () => {} });

    // Two drops grow the backoff (1s spent, next delay 2s).
    ws.close();
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
    MockWebSocket.current!.close();

    // Mid-backoff wake: reconnects NOW (no timer advance) with backoff reset.
    window.dispatchEvent(new Event("pageshow"));
    expect(MockWebSocket.instances).toHaveLength(3);

    // Backoff was reset to base: the next drop reconnects after 1s, not 4s.
    MockWebSocket.current!.close();
    vi.advanceTimersByTime(999);
    expect(MockWebSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(MockWebSocket.instances).toHaveLength(4);
    sock.close();
  });

  it("close() tears down the heartbeat and wake-probe listeners permanently", () => {
    const { sock, ws } = open({ onEvent: () => {} });
    sock.close();

    vi.advanceTimersByTime(3 * HEARTBEAT_INTERVAL_MS);
    expect(ws.sentWith("ping")).toHaveLength(0);

    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(LIVENESS_TIMEOUT_MS);
    expect(MockWebSocket.instances).toHaveLength(1); // no reconnect, no probe socket
  });
});
