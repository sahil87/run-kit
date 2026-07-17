import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RelayMux } from "./relay-mux";

// MockWebSocket — the terminals-mux transport. Captures the client's frames
// (JSON control text + binary `[u32 BE id][payload]` data) and lets tests drive
// server frames (opened / closed control, binary data). Opens synchronously on
// the next microtask so the mux's onopen (which issues the queued `open` ops)
// fires within the test's await.
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  url: string;
  binaryType = "";
  readyState: number = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string | ArrayBuffer }) => void) | null = null;
  sentText: string[] = [];
  sentBinary: Uint8Array[] = [];
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    });
  }
  send(data: string | Uint8Array) {
    if (typeof data === "string") this.sentText.push(data);
    else this.sentBinary.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
  // Test drivers ---------------------------------------------------------
  /** Push a JSON control frame server→client. */
  emitControl(obj: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  /** Push a binary data frame `[u32 BE id][payload]` server→client. */
  emitData(id: number, payload: Uint8Array) {
    const buf = new Uint8Array(4 + payload.length);
    new DataView(buf.buffer).setUint32(0, id, false);
    buf.set(payload, 4);
    this.onmessage?.({ data: buf.buffer });
  }
  /** Drive a socket-level drop (server dies). */
  drop() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

function parseControls(ws: MockWebSocket): Array<Record<string, unknown>> {
  return ws.sentText.map((s) => JSON.parse(s));
}
function controlsOfOp(ws: MockWebSocket, op: string): Array<Record<string, unknown>> {
  return parseControls(ws).filter((c) => c.op === op);
}

const flush = () => new Promise<void>((r) => queueMicrotask(r));

describe("RelayMux framing + control ops", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "localhost:3000" },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens one socket for multiple streams and issues an open op per stream with client-allocated ids", async () => {
    const mux = new RelayMux();
    mux.openStream({ server: "default", windowId: "@1", cols: 80, rows: 24 });
    mux.openStream({ server: "default", windowId: "@2", cols: 100, rows: 40 });
    await flush();

    expect(MockWebSocket.instances).toHaveLength(1); // ONE socket for both streams
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe("ws://localhost:3000/ws/terminals");
    expect(ws.binaryType).toBe("arraybuffer");

    const opens = controlsOfOp(ws, "open");
    expect(opens).toHaveLength(2);
    expect(opens[0]).toMatchObject({ op: "open", id: 1, server: "default", windowId: "@1", cols: 80, rows: 24 });
    expect(opens[1]).toMatchObject({ op: "open", id: 2, windowId: "@2", cols: 100, rows: 40 });
    // ids are distinct u32s
    expect(opens[0].id).not.toBe(opens[1].id);
    mux.close();
  });

  it("send() emits a binary [u32 BE id][payload] data frame; resize() and close() emit control ops", async () => {
    const mux = new RelayMux();
    const s = mux.openStream({ server: "default", windowId: "@7", cols: 80, rows: 24 });
    await flush();
    const ws = MockWebSocket.instances[0];

    s.send("hi");
    expect(ws.sentBinary).toHaveLength(1);
    const frame = ws.sentBinary[0];
    expect(new DataView(frame.buffer, frame.byteOffset).getUint32(0, false)).toBe(1); // stream id
    expect(new TextDecoder().decode(frame.slice(4))).toBe("hi");

    s.resize(120, 30);
    expect(controlsOfOp(ws, "resize")).toEqual([{ op: "resize", id: 1, cols: 120, rows: 30 }]);

    s.close();
    expect(controlsOfOp(ws, "close")).toEqual([{ op: "close", id: 1 }]);
    mux.close();
  });

  it("setWindowId() sends NO wire op — it only updates the reconnect target (M1)", async () => {
    const mux = new RelayMux();
    const s = mux.openStream({ server: "default", windowId: "@1", cols: 80, rows: 24 });
    await flush();
    const ws = MockWebSocket.instances[0];
    const textFramesBefore = ws.sentText.length;
    const binaryFramesBefore = ws.sentBinary.length;

    s.setWindowId("@9");

    // A same-session ride mutates only the in-memory re-open target — no `open`,
    // `resize`, `close`, or data frame crosses the wire (the live PTY already
    // tracks the new active window).
    expect(ws.sentText.length).toBe(textFramesBefore);
    expect(ws.sentBinary.length).toBe(binaryFramesBefore);
    mux.close();
  });

  it("demuxes inbound binary frames to the addressed stream's onData", async () => {
    const mux = new RelayMux();
    const s1 = mux.openStream({ server: "default", windowId: "@1", cols: 80, rows: 24 });
    const s2 = mux.openStream({ server: "default", windowId: "@2", cols: 80, rows: 24 });
    await flush();
    const ws = MockWebSocket.instances[0];

    const got1: Uint8Array[] = [];
    const got2: Uint8Array[] = [];
    s1.onData((d) => got1.push(d));
    s2.onData((d) => got2.push(d));

    ws.emitData(1, new TextEncoder().encode("for-one"));
    ws.emitData(2, new TextEncoder().encode("for-two"));

    expect(got1).toHaveLength(1);
    expect(got2).toHaveLength(1);
    expect(new TextDecoder().decode(got1[0])).toBe("for-one");
    expect(new TextDecoder().decode(got2[0])).toBe("for-two");
    mux.close();
  });

  it("dispatches a `closed` control event to the right stream's onClosed with code + reason", async () => {
    const mux = new RelayMux();
    const s1 = mux.openStream({ server: "default", windowId: "@1", cols: 80, rows: 24 });
    const s2 = mux.openStream({ server: "default", windowId: "@2", cols: 80, rows: 24 });
    await flush();
    const ws = MockWebSocket.instances[0];

    const closed1: Array<{ code: number; reason: string }> = [];
    const closed2: Array<{ code: number; reason: string }> = [];
    s1.onClosed((code, reason) => closed1.push({ code, reason }));
    s2.onClosed((code, reason) => closed2.push({ code, reason }));

    ws.emitControl({ op: "closed", id: 1, code: 4004, reason: "Window not found" });

    expect(closed1).toEqual([{ code: 4004, reason: "Window not found" }]);
    expect(closed2).toHaveLength(0); // not this stream

    // A closed stream is retired: its onData no longer fires.
    const late: Uint8Array[] = [];
    s1.onData((d) => late.push(d));
    ws.emitData(1, new TextEncoder().encode("too-late"));
    expect(late).toHaveLength(0);
    mux.close();
  });
});

describe("RelayMux reconnect", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "localhost:3000" },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reconnects with backoff and re-issues open for every live stream", async () => {
    const mux = new RelayMux();
    mux.openStream({ server: "default", windowId: "@1", cols: 80, rows: 24 });
    mux.openStream({ server: "default", windowId: "@2", cols: 80, rows: 24 });
    await vi.runAllTicks();
    const ws1 = MockWebSocket.instances[0];
    expect(controlsOfOp(ws1, "open")).toHaveLength(2);

    // Socket-level drop → schedule reconnect (streams are still live).
    ws1.drop();
    expect(MockWebSocket.instances).toHaveLength(1); // not yet reconnected

    vi.advanceTimersByTime(1000); // backoff base
    await vi.runAllTicks();
    expect(MockWebSocket.instances).toHaveLength(2);
    const ws2 = MockWebSocket.instances[1];

    // Both live streams re-issue their open op on the new socket (same ids).
    const opens2 = controlsOfOp(ws2, "open");
    expect(opens2).toHaveLength(2);
    expect(opens2.map((o) => o.id).sort()).toEqual([1, 2]);
    mux.close();
  });

  it("re-issues the reconnect open with the stream's LATEST windowId after a same-session ride (M1)", async () => {
    const mux = new RelayMux();
    const s = mux.openStream({ server: "default", windowId: "@0", cols: 80, rows: 24 });
    await vi.runAllTicks();
    const ws1 = MockWebSocket.instances[0];
    expect(controlsOfOp(ws1, "open")[0]).toMatchObject({ id: 1, windowId: "@0" });

    // Same-session window switch rides the live stream (no wire op) but updates
    // the re-open target — the regression M1 caught was reconnect re-opening the
    // STALE @0 (which SelectWindowInSession would yank the pane back to).
    s.setWindowId("@5");

    // Socket-level drop → reconnect must re-open @5, not @0.
    ws1.drop();
    vi.advanceTimersByTime(1000);
    await vi.runAllTicks();
    const ws2 = MockWebSocket.instances[1];
    const reopen = controlsOfOp(ws2, "open");
    expect(reopen).toHaveLength(1);
    expect(reopen[0]).toMatchObject({ id: 1, windowId: "@5" });
    mux.close();
  });

  it("does not reconnect when no streams remain (idle tab drops its socket)", async () => {
    const mux = new RelayMux();
    const s = mux.openStream({ server: "default", windowId: "@1", cols: 80, rows: 24 });
    await vi.runAllTicks();
    const ws1 = MockWebSocket.instances[0];

    s.close(); // last stream gone
    ws1.drop();
    vi.advanceTimersByTime(30000);
    await vi.runAllTicks();
    expect(MockWebSocket.instances).toHaveLength(1); // no reconnect
    mux.close();
  });
});
