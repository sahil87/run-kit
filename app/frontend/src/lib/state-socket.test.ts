import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StateSocket, type StateEvent, type StateSocketHandlers } from "./state-socket";

// Unit tests for the StateSocket chat kind (260717-vhvz). A minimal mock
// WebSocket captures the client's outgoing frames and lets the test deliver
// server frames, so we can assert the chat subscribe/ack/event wire shape and the
// reconnect behavior without a backend. (The server/metrics kinds are covered end
// -to-end by session-context.test.tsx; this file focuses on the chat additions.)

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
  vi.unstubAllGlobals();
});

/** Construct a StateSocket, connect, and fire the initial open so hello is sent. */
function open(handlers: StateSocketHandlers) {
  const sock = new StateSocket(handlers, "conn-test");
  sock.connect();
  MockWebSocket.current!.fireOpen();
  return { sock, ws: MockWebSocket.current! };
}

describe("StateSocket chat kind", () => {
  it("subscribeChat sends a chat subscribe frame carrying key/server/from", () => {
    const { sock, ws } = open({ onEvent: () => {} });
    sock.subscribeChat({ server: "default", windowId: "@42", from: 18734 });

    const subs = ws.sentWith("subscribe").filter((m) => m.kind === "chat");
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      op: "subscribe",
      kind: "chat",
      key: "@42",
      server: "default",
      from: 18734,
    });
    expect(typeof subs[0].req).toBe("number");
  });

  it("routes a chat ack (offset, no snapshot) to onAck with kind=chat and the window key", () => {
    const acks: Array<{ kind: string; key?: string; snapshot: unknown; offset?: number }> = [];
    const { sock, ws } = open({
      onEvent: () => {},
      onAck: (_req, kind, key, snapshot, offset) => acks.push({ kind, key, snapshot, offset }),
    });
    sock.subscribeChat({ server: "default", windowId: "@42", from: 500 });
    const req = ws.sentWith("subscribe").find((m) => m.kind === "chat")!.req as number;

    ws.deliver({ op: "ack", req, offset: 500 });

    expect(acks).toHaveLength(1);
    expect(acks[0]).toEqual({ kind: "chat", key: "@42", snapshot: undefined, offset: 500 });
  });

  it("dispatches a kind:chat event to onEvent (key = window id)", () => {
    const events: StateEvent[] = [];
    const { ws } = open({ onEvent: (ev) => events.push(ev) });
    ws.deliver({
      op: "event",
      kind: "chat",
      key: "@42",
      type: "chat",
      data: [{ type: "message", turn: 1, text: "hi" }],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "chat", key: "@42", type: "chat" });
    expect(events[0].data).toEqual([{ type: "message", turn: 1, text: "hi" }]);
  });

  it("dispatches chat-reset and chat-error events by type", () => {
    const events: StateEvent[] = [];
    const { ws } = open({ onEvent: (ev) => events.push(ev) });
    ws.deliver({ op: "event", kind: "chat", key: "@1", type: "chat-reset", data: {} });
    ws.deliver({ op: "event", kind: "chat", key: "@1", type: "chat-error", data: { error: "boom" } });
    expect(events.map((e) => e.type)).toEqual(["chat-reset", "chat-error"]);
    expect((events[1].data as { error: string }).error).toBe("boom");
  });

  it("does NOT blindly resubscribe chat on reconnect (server/metrics only)", () => {
    vi.useFakeTimers();
    try {
      const { sock, ws } = open({ onEvent: () => {} });
      // A server subscription (blind-resubscribed) plus a chat subscription (not).
      sock.subscribeServer("srv1");
      sock.subscribeChat({ server: "default", windowId: "@42", from: 100 });

      // Drop → the reconnect is scheduled via setTimeout (exponential backoff);
      // advance past it so connect() builds a FRESH socket, then fire its open.
      ws.close();
      vi.runOnlyPendingTimers();
      const ws2 = MockWebSocket.current!;
      expect(ws2).not.toBe(ws); // a genuinely new socket
      ws2.fireOpen();

      const resubscribes = ws2.sentWith("subscribe");
      // The server sub is re-sent on the fresh socket; the chat sub is NOT (its
      // `from` is stale — the owner hook re-runs fetch→subscribe instead).
      expect(resubscribes.some((m) => m.kind === "server" && m.key === "srv1")).toBe(true);
      expect(resubscribes.some((m) => m.kind === "chat")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("unsubscribeChat sends a chat unsubscribe frame", () => {
    const { sock, ws } = open({ onEvent: () => {} });
    sock.subscribeChat({ server: "default", windowId: "@7", from: 0 });
    sock.unsubscribeChat({ server: "default", windowId: "@7" });
    const unsub = ws.sentWith("unsubscribe").filter((m) => m.kind === "chat");
    expect(unsub).toHaveLength(1);
    expect(unsub[0]).toMatchObject({ op: "unsubscribe", kind: "chat", key: "@7", server: "default" });
  });
});
