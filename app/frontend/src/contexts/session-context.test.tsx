import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import {
  SessionProvider,
  useSessionContext,
  useHostMetrics,
  useHostServices,
  useMetrics,
  StandaloneSessionContextProvider,
  shouldReloadOnVersion,
} from "./session-context";
import { ChromeProvider } from "./chrome-context";
import type { MetricsSnapshot } from "@/types";

// Keep the real module (so pure helpers like `compareServers` — exercised by
// the infra-sort test below — run for real); only `listServers` is stubbed.
vi.mock("@/api/client", async (importActual) => ({
  ...(await importActual<typeof import("@/api/client")>()),
  listServers: vi.fn().mockResolvedValue([]),
}));

import { listServers } from "@/api/client";

// Mock TanStack Router's useMatches so the provider can compute currentServer
// without spinning up a real router. Tests can flip the matched route shape
// via `setMockMatches`.
let mockMatches: Array<{ params?: Record<string, string> }> = [];
function setMockMatches(matches: Array<{ params?: Record<string, string> }>) {
  mockMatches = matches;
}
vi.mock("@tanstack/react-router", () => ({
  useMatches: () => mockMatches,
}));

// MockWebSocket — the state socket transport (change 260716-qf3j). The provider
// opens ONE socket to /ws/state; the mock captures the client's ops (hello /
// subscribe / unsubscribe / preview-scope) and lets tests drive server frames
// (event / ack / gone). A `Facade` mirrors the old MockEventSource API so the
// per-server test assertions read the same: `forServer(name).emit(type, data)`
// pushes a `kind:"server"` event; `forHostMetrics().emit(type, data)` pushes a
// `kind:"global"` event; `emit("server-gone")` pushes a `gone` frame.
type WSListener = (e: MessageEvent) => void;
const WS_OPEN = 1;
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static current: MockWebSocket | null = null;
  // When true, newly-constructed sockets stay CONNECTING (never fire onopen) —
  // simulates a genuine outage so the provider's disconnect debounce can fire
  // instead of being masked by an instant reconnect.
  static outage = false;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  url: string;
  readyState = WS_OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: WSListener | null = null;
  sent: string[] = [];
  // Requests seen, mapped req → {kind, key} so tests can ack them (append-only).
  subs: Array<{ req: number; kind: string; key?: string }> = [];
  // Active subscription ids, add on subscribe / remove on unsubscribe — reflects
  // the CURRENT wire state (unlike `subs`, which is the full history).
  active = new Set<string>();
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    MockWebSocket.current = this;
    if (MockWebSocket.outage) {
      this.readyState = MockWebSocket.CONNECTING;
      return; // never opens — simulates an unreachable server
    }
    // Open synchronously on the next microtask so the provider's onopen fires
    // and sends hello + resubscribes within the test's act().
    queueMicrotask(() => {
      this.onopen?.();
    });
  }
  send(raw: string) {
    this.sent.push(raw);
    try {
      const m = JSON.parse(raw);
      const id = m.kind === "metrics" ? "metrics" : "server:" + m.key;
      if (m.op === "subscribe") {
        this.subs.push({ req: m.req, kind: m.kind, key: m.key });
        this.active.add(id);
      } else if (m.op === "unsubscribe") {
        this.active.delete(id);
      }
    } catch {
      // ignore
    }
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  // Deliver a raw server frame to the provider.
  deliver(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }
  // Ack the most recent subscribe matching kind (+ key), with an optional snapshot.
  ack(kind: string, key: string | undefined, snapshot: unknown) {
    const sub = [...this.subs].reverse().find((s) => s.kind === kind && s.key === key);
    if (!sub) return;
    this.deliver({ op: "ack", req: sub.req, snapshot });
  }
  static reset() {
    MockWebSocket.instances = [];
    MockWebSocket.current = null;
  }
}

// Facade giving the old per-server / host-metrics emit API over the single WS.
class ServerFacade {
  constructor(private ws: MockWebSocket, private server: string) {}
  emit(type: string, data: unknown) {
    if (type === "sessions") {
      // The provider treats the subscribe ack's snapshot as the sessions
      // payload; deliver both an ack (so isConnected flips) and an event.
      this.ws.ack("server", this.server, data);
      this.ws.deliver({ op: "event", kind: "server", key: this.server, type: "sessions", data });
      return;
    }
    if (type === "server-gone") {
      this.ws.deliver({ op: "gone", kind: "server", key: this.server, reason: "server-exited" });
      return;
    }
    this.ws.deliver({ op: "event", kind: "server", key: this.server, type, data });
  }
  get closed() {
    // A server "closes" when the socket closes; single-socket model has no
    // per-server socket, so report the socket's state.
    return this.ws.readyState === MockWebSocket.CLOSED;
  }
  set onerror(_fn: (() => void) | null) {
    /* per-server onerror has no analog on the single socket; drop */
  }
}

class GlobalFacade {
  constructor(private ws: MockWebSocket) {}
  emit(type: string, data: unknown) {
    if (type === "metrics") this.ws.ack("metrics", undefined, undefined);
    this.ws.deliver({ op: "event", kind: "global", type, data });
  }
  // Emit a raw (possibly malformed) frame for the malformed-payload test.
  emitRaw(type: string, raw: string) {
    this.ws.onmessage?.({
      data: JSON.stringify({ op: "event", kind: "global", type, data: JSON.parse(raw || "null") }),
    } as MessageEvent);
  }
  get listeners() {
    // Back-compat shim for the malformed-services test: return a Map whose
    // `get` yields a handler that feeds a bad payload through the socket.
    return {
      get: (type: string) => (e: MessageEvent) => {
        // e.data is a bad raw string; wrap it as a global event with unparsable
        // data so the provider's tolerant parse skips it without throwing.
        this.ws.onmessage?.({
          data: `{"op":"event","kind":"global","type":"${type}","data":${
            typeof e.data === "string" ? "0" : "0"
          }}`,
        } as MessageEvent);
      },
    };
  }
}

// Helpers mirroring the old MockEventSource statics.
const WS = {
  forServer(server: string): ServerFacade | undefined {
    const ws = MockWebSocket.current;
    if (!ws) return undefined;
    // A server is "present" only while its subscription is currently active.
    if (!ws.active.has("server:" + server)) return undefined;
    return new ServerFacade(ws, server);
  },
  forHostMetrics(): GlobalFacade | undefined {
    const ws = MockWebSocket.current;
    if (!ws) return undefined;
    if (!ws.active.has("metrics")) return undefined;
    return new GlobalFacade(ws);
  },
  // Emit a host-global event regardless of a metrics subscription (globals fan
  // out to every connection; a server-only route still receives them).
  global(): GlobalFacade | undefined {
    const ws = MockWebSocket.current;
    return ws ? new GlobalFacade(ws) : undefined;
  },
};

const FAKE_METRICS: MetricsSnapshot = {
  hostname: "test-box",
  cpu: { samples: [10, 20, 30], current: 42, cores: 8 },
  memory: { used: 4 * 1024 ** 3, total: 16 * 1024 ** 3 },
  load: { avg1: 1.5, avg5: 1.0, avg15: 0.5, cpus: 8 },
  disk: { used: 100 * 1024 ** 3, total: 500 * 1024 ** 3 },
  uptime: 90000,
};

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <ChromeProvider>
      <SessionProvider>{children}</SessionProvider>
    </ChromeProvider>
  );
}

// Flush microtasks (socket onopen is queued via queueMicrotask) + React effects.
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  MockWebSocket.reset();
  MockWebSocket.outage = false;
  vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  setMockMatches([]); // default: no route — currentServer null
  vi.mocked(listServers).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SessionProvider — single state socket, per-server subscriptions", () => {
  it("subscribes to the current server (lazy-attach for non-current)", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }, { name: "work", sessionCount: 0 }]);

    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await settle();

    // Exactly one socket, subscribed to the current server; non-current stays
    // detached until attachServer.
    expect(MockWebSocket.instances.length).toBe(1);
    expect(WS.forServer("runkit")).toBeDefined();
    expect(WS.forServer("work")).toBeUndefined();
    expect(result.current.currentServer).toBe("runkit");

    await act(async () => {
      result.current.attachServer("work");
    });
    expect(WS.forServer("work")).toBeDefined();
    // Still a single socket — attaching a second server does not open a new one.
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it("isolates state per server (sessions event)", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }, { name: "work", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await settle();

    act(() => {
      WS.forServer("runkit")!.emit("sessions", [{ name: "A", windows: [] }]);
    });

    expect((result.current.sessionsByServer.get("runkit") ?? []).map((s) => s.name)).toEqual(["A"]);
    expect((result.current.sessionsByServer.get("work") ?? []).map((s) => s.name)).toEqual([]);
  });

  it("populates sessionOrderByServer for the matching server only", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }, { name: "work", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await settle();

    act(() => {
      WS.forServer("runkit")!.emit("session-order", { server: "runkit", order: ["main", "dev"] });
    });

    expect(result.current.sessionOrderByServer.get("runkit")).toEqual(["main", "dev"]);
    expect(result.current.sessionOrderByServer.get("work") ?? []).toEqual([]);
  });

  it("re-sorts ctx.servers on a server-order event without a listServers refetch", async () => {
    vi.mocked(listServers).mockResolvedValue([
      { name: "runkit", sessionCount: 0 },
      { name: "work", sessionCount: 0 },
    ]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await settle();

    expect(result.current.servers.map((s) => s.name)).toEqual(["runkit", "work"]);
    const callsBefore = vi.mocked(listServers).mock.calls.length;

    act(() => {
      WS.global()!.emit("server-order", { order: ["work", "runkit"] });
    });

    expect(result.current.servers.map((s) => s.name)).toEqual(["work", "runkit"]);
    expect(vi.mocked(listServers).mock.calls.length).toBe(callsBefore);
  });

  it("ignores session-order events whose server field doesn't match the key", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await settle();

    act(() => {
      WS.forServer("runkit")!.emit("session-order", { server: "staging", order: ["other"] });
    });

    expect(result.current.sessionOrderByServer.get("runkit") ?? []).toEqual([]);
  });

  it("reports per-server isConnected independently", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }, { name: "work", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await settle();

    act(() => {
      WS.forServer("runkit")!.emit("sessions", []);
    });

    expect(result.current.isConnectedByServer.get("runkit")).toBe(true);
    expect(result.current.isConnectedByServer.get("work") ?? false).toBe(false);
  });

  it("handles gone: clears the slice and re-queries listServers", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await settle();

    act(() => {
      WS.forServer("runkit")!.emit("sessions", [{ name: "A", windows: [] }]);
    });
    expect(result.current.sessionsByServer.has("runkit")).toBe(true);

    const callsBefore = vi.mocked(listServers).mock.calls.length;
    vi.mocked(listServers).mockResolvedValueOnce([]);
    await act(async () => {
      WS.forServer("runkit")!.emit("server-gone", {});
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.sessionsByServer.has("runkit")).toBe(false);
    expect(result.current.isConnectedByServer.has("runkit")).toBe(false);
    expect(vi.mocked(listServers).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("gone on a still-attached server releases the subscription so the diff effect re-subscribes", async () => {
    // A transient `gone` where listServers STILL returns the server (it never
    // leaves attachedSet). onGone must release the subscription (drop it from
    // subscribedServersRef + the socket ref-count) so the diff effect — which
    // re-runs when attachedSet recomputes after fetchServers — re-subscribes.
    // Without the release the server would stay in subscribedServersRef, the
    // diff effect would skip it, and its UI would be permanently dead.
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await settle();

    act(() => {
      WS.forServer("runkit")!.emit("sessions", [{ name: "A", windows: [] }]);
    });
    expect(WS.forServer("runkit")).toBeDefined();

    const ws = MockWebSocket.current!;
    const subscribesBefore = ws.sent.filter(
      (s) => s.includes('"op":"subscribe"') && s.includes('"key":"runkit"'),
    ).length;

    // gone arrives, but listServers keeps returning runkit (still attached).
    await act(async () => {
      WS.forServer("runkit")!.emit("server-gone", {});
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The subscription was released and then re-issued: a fresh subscribe was
    // sent and the subscription is active again (so the server is NOT dead).
    const subscribesAfter = ws.sent.filter(
      (s) => s.includes('"op":"subscribe"') && s.includes('"key":"runkit"'),
    ).length;
    expect(subscribesAfter).toBeGreaterThan(subscribesBefore);
    expect(ws.active.has("server:runkit")).toBe(true);
    expect(WS.forServer("runkit")).toBeDefined();

    // And the slice re-populates on the next sessions event (UI recovers).
    act(() => {
      WS.forServer("runkit")!.emit("sessions", [{ name: "B", windows: [] }]);
    });
    expect((result.current.sessionsByServer.get("runkit") ?? []).map((s) => s.name)).toEqual(["B"]);
    expect(result.current.isConnectedByServer.get("runkit")).toBe(true);
  });

  it("socket drop → 3s debounce flips isConnected false and re-queries listServers", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
      setMockMatches([{ params: { server: "runkit" } }]);
      const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      // Ack the subscription so it is connected.
      act(() => { WS.forServer("runkit")!.emit("sessions", []); });
      expect(result.current.isConnectedByServer.get("runkit")).toBe(true);

      const callsBefore = vi.mocked(listServers).mock.calls.length;
      // Drop the socket into a genuine outage so the auto-reconnect stays
      // CONNECTING (never re-opens) and the disconnect debounce can fire.
      MockWebSocket.outage = true;
      act(() => { MockWebSocket.current!.close(); });
      // Before the 3s debounce elapses, still connected.
      expect(result.current.isConnectedByServer.get("runkit")).toBe(true);
      expect(vi.mocked(listServers).mock.calls.length).toBe(callsBefore);

      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(result.current.isConnectedByServer.get("runkit")).toBe(false);
      expect(vi.mocked(listServers).mock.calls.length).toBeGreaterThan(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the subscription + slice when a server disappears from /api/servers", async () => {
    vi.mocked(listServers).mockResolvedValueOnce([{ name: "runkit", sessionCount: 0 }, { name: "work", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await settle();

    await act(async () => { result.current.attachServer("work"); });
    expect(WS.forServer("work")).toBeDefined();

    vi.mocked(listServers).mockResolvedValueOnce([{ name: "runkit", sessionCount: 0 }]);
    await act(async () => {
      result.current.refreshServers();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.sessionsByServer.has("work")).toBe(false);
    expect(result.current.isConnectedByServer.has("work")).toBe(false);
  });

  it("sorts fetched servers infra-last (daemon + test sockets after regular)", async () => {
    vi.mocked(listServers).mockResolvedValue([
      { name: "alpha", sessionCount: 0 },
      { name: "rk-daemon", sessionCount: 0 },
      { name: "rk-test-e2e", sessionCount: 0 },
      { name: "zeta", sessionCount: 0 },
    ]);
    setMockMatches([{ params: { server: "alpha" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await settle();

    expect(result.current.servers.map((s) => s.name)).toEqual([
      "alpha",
      "zeta",
      "rk-daemon",
      "rk-test-e2e",
    ]);
  });
});

describe("SessionProvider — currentServer follows route", () => {
  it("derives currentServer from the matched route's server param", async () => {
    setMockMatches([{ params: { server: "alpha" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    expect(result.current.currentServer).toBe("alpha");
  });

  it("returns null when no matched route has a server param", async () => {
    setMockMatches([{ params: {} }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    expect(result.current.currentServer).toBe(null);
  });
});

describe("SessionProvider — pendingServer marker", () => {
  it("markServerPending sets pendingServer; appearing in the refreshed list clears it", async () => {
    vi.mocked(listServers).mockResolvedValueOnce([]);
    setMockMatches([{ params: { server: "newsrv" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await settle();

    expect(result.current.pendingServer).toBe(null);

    act(() => { result.current.markServerPending("newsrv"); });
    expect(result.current.pendingServer).toBe("newsrv");

    vi.mocked(listServers).mockResolvedValueOnce([{ name: "newsrv", sessionCount: 0 }]);
    await act(async () => {
      result.current.refreshServers();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.servers.some((s) => s.name === "newsrv")).toBe(true);
    expect(result.current.pendingServer).toBe(null);
  });

  it("markServerPending('') clears the marker (failed-create rollback path)", async () => {
    vi.mocked(listServers).mockResolvedValue([]);
    setMockMatches([{ params: {} }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await settle();

    act(() => { result.current.markServerPending("ghost"); });
    expect(result.current.pendingServer).toBe("ghost");

    act(() => { result.current.markServerPending(""); });
    expect(result.current.pendingServer).toBe(null);
  });
});

describe("SessionProvider — serversLoaded flag", () => {
  it("flips false → true after the first fetch resolves (even to an empty list)", async () => {
    vi.mocked(listServers).mockResolvedValue([]);
    setMockMatches([{ params: {} }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });

    expect(result.current.serversLoaded).toBe(false);
    await settle();
    expect(result.current.serversLoaded).toBe(true);
    expect(result.current.servers).toEqual([]);
  });
});

describe("SessionProvider — server-independent host metrics", () => {
  it("subscribes to metrics on / with no currentServer", async () => {
    setMockMatches([{ params: {} }]);
    renderHook(() => useHostMetrics(), { wrapper: Wrapper });
    await settle();

    // The metrics subscription is open with zero servers attached.
    expect(WS.forHostMetrics()).toBeDefined();
  });

  it("useHostMetrics() returns the broadcast snapshot; useMetrics() stays null on /", async () => {
    setMockMatches([{ params: {} }]);
    const { result } = renderHook(
      () => ({ host: useHostMetrics(), current: useMetrics() }),
      { wrapper: Wrapper },
    );
    await settle();

    expect(result.current.host).toBeNull();
    expect(result.current.current).toBeNull();

    act(() => {
      WS.forHostMetrics()!.emit("metrics", FAKE_METRICS);
    });

    expect(result.current.host?.hostname).toBe("test-box");
    expect(result.current.host?.cpu.current).toBe(42);
    expect(result.current.current).toBeNull();
  });

  it("does not open a metrics subscription while a server is attached; host metrics come from the per-server fan-out", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useHostMetrics(), { wrapper: Wrapper });
    await settle();

    // With a server attached, the metrics subscription is redundant and NOT open.
    expect(WS.forHostMetrics()).toBeUndefined();
    expect(WS.forServer("runkit")).toBeDefined();

    // Host metrics still flow — as a host-global event over the socket.
    act(() => {
      WS.global()!.emit("metrics", FAKE_METRICS);
    });
    expect(result.current?.hostname).toBe("test-box");
  });

  it("dedupes identical host-metrics payloads (idempotent on the raw payload)", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    let hostRenders = 0;
    const host: { latest: MetricsSnapshot | null } = { latest: null };
    function HostProbe() {
      hostRenders += 1;
      host.latest = useHostMetrics();
      return null;
    }
    renderHook(() => useSessionContext(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Wrapper>
          <HostProbe />
          {children}
        </Wrapper>
      ),
    });
    await settle();

    act(() => { WS.global()!.emit("metrics", FAKE_METRICS); });
    expect(host.latest?.hostname).toBe("test-box");
    const rendersAfterFirst = hostRenders;

    // The SAME payload again — deduped on the raw string, no extra render.
    act(() => { WS.global()!.emit("metrics", FAKE_METRICS); });
    expect(hostRenders).toBe(rendersAfterFirst);
    expect(host.latest?.hostname).toBe("test-box");

    // A genuinely different payload DOES update.
    act(() => { WS.global()!.emit("metrics", { ...FAKE_METRICS, hostname: "other-box" }); });
    expect(host.latest?.hostname).toBe("other-box");
    expect(hostRenders).toBeGreaterThan(rendersAfterFirst);
  });

  it("opens the metrics subscription on / then drops it once a server attaches", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([{ params: {} }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await settle();

    expect(WS.forHostMetrics()).toBeDefined();

    await act(async () => { result.current.attachServer("runkit"); });
    // Metrics subscription released; per-server fan-out takes over.
    expect(WS.forServer("runkit")).toBeDefined();
    // The most recent op should include an unsubscribe of metrics.
    const ws = MockWebSocket.current!;
    expect(ws.sent.some((s) => s.includes('"op":"unsubscribe"') && s.includes('"kind":"metrics"'))).toBe(true);
  });
});

describe("SessionProvider — StrictMode double-mount re-subscribes on the new socket", () => {
  // <StrictMode> intentionally mounts → unmounts → remounts the provider (dev +
  // e2e run under it). The socket-construction effect destroys+recreates the
  // StateSocket across that remount; the subscription guard refs must reset in
  // its cleanup so the metrics/diff effects re-subscribe on the NEW socket. The
  // pre-fix bug: the guards survived the remount and the effects saw them already
  // true, so the metrics subscription was NEVER opened on the live socket —
  // permanently dead Host dot / poll loop on `/`.
  //
  // NOTE: this uses render(<StrictMode>…) with a context-capturing probe, NOT
  // renderHook({ wrapper: <StrictMode> }). Testing Library's renderHook does NOT
  // simulate the StrictMode mount→unmount→remount for a wrapper — only a direct
  // render() of a <StrictMode> root double-invokes the effects (verified). The
  // probe writes the live context into `captured` on every render.

  it("re-establishes the metrics subscription on the live socket after remount (/ host case)", async () => {
    setMockMatches([{ params: {} }]); // `/` — no server, metrics subscription is the source
    const captured: { ctx: ReturnType<typeof useSessionContext> | null } = { ctx: null };
    function Probe() {
      captured.ctx = useSessionContext();
      return null;
    }
    render(
      <StrictMode>
        <ChromeProvider>
          <SessionProvider>
            <Probe />
          </SessionProvider>
        </ChromeProvider>
      </StrictMode>,
    );
    await settle();

    // StrictMode double-mounted: more than one socket was constructed, but the
    // CURRENT (live) one must carry the metrics subscription. Pre-fix this failed
    // (the guard ref survived the remount and blocked re-subscription): the live
    // socket's `active` set never gained "metrics".
    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
    const live = MockWebSocket.current!;
    expect(live.readyState).not.toBe(MockWebSocket.CLOSED);
    expect(live.active.has("metrics")).toBe(true);
    expect(WS.forHostMetrics()).toBeDefined();

    // And it functions end-to-end: a metrics event on the live socket flips the
    // Host dot connected.
    expect(captured.ctx!.hostMetricsConnected).toBe(false);
    act(() => {
      WS.forHostMetrics()!.emit("metrics", FAKE_METRICS);
    });
    expect(captured.ctx!.hostMetricsConnected).toBe(true);
  });

  it("re-subscribes the current server on the live socket after remount", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const captured: { ctx: ReturnType<typeof useSessionContext> | null } = { ctx: null };
    function Probe() {
      captured.ctx = useSessionContext();
      return null;
    }
    render(
      <StrictMode>
        <ChromeProvider>
          <SessionProvider>
            <Probe />
          </SessionProvider>
        </ChromeProvider>
      </StrictMode>,
    );
    await settle();

    const live = MockWebSocket.current!;
    expect(live.readyState).not.toBe(MockWebSocket.CLOSED);
    // The server subscription rode the remount onto the live socket.
    expect(live.active.has("server:runkit")).toBe(true);
    expect(WS.forServer("runkit")).toBeDefined();

    act(() => {
      WS.forServer("runkit")!.emit("sessions", [{ name: "A", windows: [] }]);
    });
    expect((captured.ctx!.sessionsByServer.get("runkit") ?? []).map((s) => s.name)).toEqual(["A"]);
    expect(captured.ctx!.isConnectedByServer.get("runkit")).toBe(true);
  });
});

describe("SessionProvider — hostMetricsConnected (Host dot, 260704-9o7k)", () => {
  it("is false before the first metrics ack, true after (no server attached)", async () => {
    setMockMatches([{ params: {} }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await settle();

    expect(result.current.hostMetricsConnected).toBe(false);

    act(() => {
      WS.forHostMetrics()!.emit("metrics", FAKE_METRICS);
    });

    expect(result.current.hostMetricsConnected).toBe(true);
  });

  it("flips back to false after a 3s disconnect debounce on socket drop", async () => {
    vi.useFakeTimers();
    try {
      setMockMatches([{ params: {} }]);
      const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      act(() => { WS.forHostMetrics()!.emit("metrics", FAKE_METRICS); });
      expect(result.current.hostMetricsConnected).toBe(true);

      MockWebSocket.outage = true;
      act(() => { MockWebSocket.current!.close(); });
      expect(result.current.hostMetricsConnected).toBe(true);

      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(result.current.hostMetricsConnected).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("derives from per-server connectedness (fan-out fallback) when a server is attached", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await settle();

    expect(result.current.hostMetricsConnected).toBe(false);

    act(() => {
      WS.forServer("runkit")!.emit("sessions", []);
    });

    expect(result.current.isConnectedByServer.get("runkit")).toBe(true);
    expect(result.current.hostMetricsConnected).toBe(true);
  });
});

describe("SessionProvider — server-independent host services", () => {
  const FAKE_SERVICES = { services: [{ port: 5173 }, { port: 8080, process: "api" }] };

  it("returns [] before the first services tick", async () => {
    setMockMatches([{ params: {} }]);
    const { result } = renderHook(() => useHostServices(), { wrapper: Wrapper });
    await settle();
    expect(result.current).toEqual([]);
  });

  it("populates from the metrics subscription on /", async () => {
    setMockMatches([{ params: {} }]);
    const { result } = renderHook(() => useHostServices(), { wrapper: Wrapper });
    await settle();

    act(() => {
      WS.forHostMetrics()!.emit("services", FAKE_SERVICES);
    });

    expect(result.current.map((s) => s.port)).toEqual([5173, 8080]);
    expect(result.current[1].process).toBe("api");
  });

  it("populates from the per-server fan-out when a server is attached", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useHostServices(), { wrapper: Wrapper });
    await settle();

    act(() => {
      WS.global()!.emit("services", FAKE_SERVICES);
    });

    expect(result.current.map((s) => s.port)).toEqual([5173, 8080]);
  });

  it("dedupes identical services payloads", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    let renders = 0;
    let latest: ReturnType<typeof useHostServices> = [];
    function Probe() {
      renders += 1;
      latest = useHostServices();
      return null;
    }
    renderHook(() => useSessionContext(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Wrapper>
          <Probe />
          {children}
        </Wrapper>
      ),
    });
    await settle();

    act(() => { WS.global()!.emit("services", FAKE_SERVICES); });
    expect(latest.map((s) => s.port)).toEqual([5173, 8080]);
    const rendersAfterFirst = renders;

    act(() => { WS.global()!.emit("services", FAKE_SERVICES); });
    expect(renders).toBe(rendersAfterFirst);

    act(() => { WS.global()!.emit("services", { services: [{ port: 3000 }] }); });
    expect(latest.map((s) => s.port)).toEqual([3000]);
    expect(renders).toBeGreaterThan(rendersAfterFirst);
  });

  it("skips a malformed services event without throwing", async () => {
    setMockMatches([{ params: {} }]);
    const { result } = renderHook(() => useHostServices(), { wrapper: Wrapper });
    await settle();

    act(() => {
      // Deliver a services event whose data is not a services object; the
      // provider's tolerant guard treats a missing services array as [].
      MockWebSocket.current!.onmessage?.({
        data: '{"op":"event","kind":"global","type":"services","data":{"nope":true}}',
      } as MessageEvent);
    });

    expect(result.current).toEqual([]);
  });
});

describe("StandaloneSessionContextProvider — pending-server fallbacks", () => {
  it("supplies safe no-op/default values for the new fields", () => {
    function Probe() {
      const ctx = useSessionContext();
      ctx.markServerPending("x");
      return (
        <div>
          <span data-testid="pending">{String(ctx.pendingServer)}</span>
          <span data-testid="loaded">{String(ctx.serversLoaded)}</span>
        </div>
      );
    }
    render(
      <StandaloneSessionContextProvider value={{}}>
        <Probe />
      </StandaloneSessionContextProvider>,
    );
    expect(screen.getByTestId("pending").textContent).toBe("null");
    expect(screen.getByTestId("loaded").textContent).toBe("false");
  });
});

describe("shouldReloadOnVersion — boot-aware reload guard", () => {
  it("never reloads on the first connect (first-seen unset), regardless of boot", () => {
    expect(shouldReloadOnVersion(null, null, "0.5.3", "b1")).toBe(false);
    expect(shouldReloadOnVersion(null, "b0", "0.5.3", "b1")).toBe(false);
  });

  it("does not reload when both version and boot are unchanged", () => {
    expect(shouldReloadOnVersion("0.5.3", "b1", "0.5.3", "b1")).toBe(false);
  });

  it("reloads when the version changes (regression), even if boot is unchanged", () => {
    expect(shouldReloadOnVersion("0.5.3", "b1", "0.6.0", "b1")).toBe(true);
  });

  it("reloads on a same-version boot change (plain daemon restart)", () => {
    expect(shouldReloadOnVersion("0.5.3", "b1", "0.5.3", "b2")).toBe(true);
  });

  it("suppresses the boot-based reload on the dev version (air recompile storm guard)", () => {
    expect(shouldReloadOnVersion("dev", "b1", "dev", "b2")).toBe(false);
  });

  it("tolerates a boot-less payload (older daemon): a null next boot never reloads at the same version", () => {
    expect(shouldReloadOnVersion("0.5.3", "b1", "0.5.3", null)).toBe(false);
    expect(shouldReloadOnVersion("0.5.3", "b1", "0.6.0", null)).toBe(true);
  });

  it("tolerates a null first boot (first payload was boot-less), reloading when a boot later appears", () => {
    expect(shouldReloadOnVersion("0.5.3", null, "0.5.3", "b2")).toBe(true);
  });
});
