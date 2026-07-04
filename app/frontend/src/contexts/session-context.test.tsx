import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  SessionProvider,
  useSessionContext,
  useHostMetrics,
  useHostServices,
  useMetrics,
  StandaloneSessionContextProvider,
} from "./session-context";
import { ChromeProvider } from "./chrome-context";
import type { MetricsSnapshot } from "@/types";

vi.mock("@/api/client", () => ({
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

// MockEventSource — multi-instance, indexed by URL so per-server tests can
// drive each stream independently. `addEventListener` is the only API the
// provider uses to register handlers; `emit` invokes them synchronously.
type Listener = (e: MessageEvent) => void;
class MockEventSource {
  static byUrl: Map<string, MockEventSource> = new Map();
  static all: MockEventSource[] = [];
  url: string;
  listeners: Map<string, Listener> = new Map();
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockEventSource.byUrl.set(url, this);
    MockEventSource.all.push(this);
  }
  addEventListener(event: string, handler: Listener) {
    this.listeners.set(event, handler);
  }
  close() {
    this.closed = true;
  }
  emit(event: string, data: unknown) {
    const handler = this.listeners.get(event);
    if (!handler) return;
    handler({ data: JSON.stringify(data) } as MessageEvent);
  }
  static reset() {
    MockEventSource.byUrl.clear();
    MockEventSource.all = [];
  }
  static forServer(server: string): MockEventSource | undefined {
    // Match by the `server=` query param. The stream URL now also carries a
    // per-connection `&conn=<uuid>` (preview-scope correlation), so an exact
    // full-URL lookup no longer works — scan for the matching server param.
    const want = `server=${encodeURIComponent(server)}`;
    return MockEventSource.all.find((es) => {
      const q = es.url.split("?")[1] ?? "";
      return q.split("&").includes(want);
    });
  }
  // The dedicated server-independent host-metrics stream opens at the
  // metrics-only endpoint (`?metrics=1`, no `server` query param).
  static forHostMetrics(): MockEventSource | undefined {
    return MockEventSource.byUrl.get("/api/sessions/stream?metrics=1");
  }
}

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

beforeEach(() => {
  vi.clearAllMocks();
  MockEventSource.reset();
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  setMockMatches([]); // default: no route — currentServer null
  vi.mocked(listServers).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SessionProvider — multi-server EventSource pool", () => {
  it("opens an EventSource for the current server (lazy-attach for non-current)", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }, { name: "work", sessionCount: 0 }]);

    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // currentServer is auto-attached, non-current servers stay detached
    // until `attachServer` is called.
    expect(MockEventSource.forServer("runkit")).toBeDefined();
    expect(MockEventSource.forServer("work")).toBeUndefined();
    expect(result.current.currentServer).toBe("runkit");

    // Explicitly attach `work` — the second EventSource opens.
    await act(async () => { result.current.attachServer("work"); });
    expect(MockEventSource.forServer("work")).toBeDefined();
  });

  it("isolates SSE updates per server (sessions event)", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }, { name: "work", sessionCount: 0 }]);

    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    act(() => {
      MockEventSource.forServer("runkit")!.emit("sessions", [{ name: "A", windows: [] }]);
    });

    const runkitSlice = result.current.sessionsByServer.get("runkit") ?? [];
    expect(runkitSlice.map((s) => s.name)).toEqual(["A"]);
    // `work` not yet emitted — slice should be empty (initialized via lazy attach).
    const workSlice = result.current.sessionsByServer.get("work") ?? [];
    expect(workSlice.map((s) => s.name)).toEqual([]);
  });

  it("populates sessionOrderByServer for the matching server only", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }, { name: "work", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    act(() => {
      MockEventSource.forServer("runkit")!.emit("session-order", { server: "runkit", order: ["main", "dev"] });
    });

    expect(result.current.sessionOrderByServer.get("runkit")).toEqual(["main", "dev"]);
    expect(result.current.sessionOrderByServer.get("work") ?? []).toEqual([]);
  });

  it("ignores session-order events whose server field doesn't match the stream", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    act(() => {
      MockEventSource.forServer("runkit")!.emit("session-order", { server: "staging", order: ["other"] });
    });

    expect(result.current.sessionOrderByServer.get("runkit") ?? []).toEqual([]);
  });

  it("reports per-server isConnected independently", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }, { name: "work", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    act(() => {
      MockEventSource.forServer("runkit")!.emit("sessions", []);
    });

    expect(result.current.isConnectedByServer.get("runkit")).toBe(true);
    expect(result.current.isConnectedByServer.get("work") ?? false).toBe(false);
  });

  it("handles server-gone: closes the ES, clears the slice, and re-queries listServers", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Seed a slice so we can observe it being cleared.
    act(() => {
      MockEventSource.forServer("runkit")!.emit("sessions", [{ name: "A", windows: [] }]);
    });
    expect(result.current.sessionsByServer.has("runkit")).toBe(true);

    const es = MockEventSource.forServer("runkit")!;
    const callsBefore = vi.mocked(listServers).mock.calls.length;

    // Backend reaped the server — emit server-gone on its stream.
    await act(async () => {
      es.emit("server-gone", {});
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(es.closed).toBe(true);
    expect(result.current.sessionsByServer.has("runkit")).toBe(false);
    expect(result.current.isConnectedByServer.has("runkit")).toBe(false);
    // refreshServers() → listServers re-queried after the event.
    expect(vi.mocked(listServers).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("onerror → markDisconnected timer triggers refreshServers as a fallback", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
      setMockMatches([{ params: { server: "runkit" } }]);
      const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      const es = MockEventSource.forServer("runkit")!;
      const callsBefore = vi.mocked(listServers).mock.calls.length;

      // Trigger onerror — arms the 3s disconnect timer.
      act(() => { es.onerror?.(); });
      // Before the timer elapses, no extra fetch and still connected-by-default.
      expect(vi.mocked(listServers).mock.calls.length).toBe(callsBefore);

      // Advance past the 3s timer — markDisconnected fires.
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

      expect(result.current.isConnectedByServer.get("runkit")).toBe(false);
      expect(vi.mocked(listServers).mock.calls.length).toBeGreaterThan(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the EventSource and clears keyed entries when a server disappears from /api/servers", async () => {
    vi.mocked(listServers).mockResolvedValueOnce([{ name: "runkit", sessionCount: 0 }, { name: "work", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Attach `work` so it has an EventSource.
    await act(async () => { result.current.attachServer("work"); });
    expect(MockEventSource.forServer("work")).toBeDefined();

    // Refresh with a smaller list — `work` is no longer in `servers`, so the
    // attachedSet intersection drops it; the pool closes its ES.
    vi.mocked(listServers).mockResolvedValueOnce([{ name: "runkit", sessionCount: 0 }]);
    await act(async () => {
      result.current.refreshServers();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(MockEventSource.forServer("work")?.closed).toBe(true);
    expect(result.current.sessionsByServer.has("work")).toBe(false);
    expect(result.current.isConnectedByServer.has("work")).toBe(false);
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
    // First fetch: empty list (server not yet created).
    vi.mocked(listServers).mockResolvedValueOnce([]);
    setMockMatches([{ params: { server: "newsrv" } }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.pendingServer).toBe(null);

    // Mark pending (mirrors handleCreateServer after a create).
    act(() => { result.current.markServerPending("newsrv"); });
    expect(result.current.pendingServer).toBe("newsrv");

    // Refresh resolves with the new server present — the clear-effect fires.
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
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    act(() => { result.current.markServerPending("ghost"); });
    expect(result.current.pendingServer).toBe("ghost");

    // Empty string clears to null without the server ever appearing.
    act(() => { result.current.markServerPending(""); });
    expect(result.current.pendingServer).toBe(null);
  });
});

describe("SessionProvider — serversLoaded flag", () => {
  it("flips false → true after the first fetch resolves (even to an empty list)", async () => {
    vi.mocked(listServers).mockResolvedValue([]);
    setMockMatches([{ params: {} }]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });

    // Synchronously after mount the promise has not settled yet.
    expect(result.current.serversLoaded).toBe(false);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Settled to an empty list — still counts as "loaded".
    expect(result.current.serversLoaded).toBe(true);
    expect(result.current.servers).toEqual([]);
  });
});

describe("SessionProvider — server-independent host metrics", () => {
  it("opens a dedicated host-metrics EventSource on mount with no currentServer", async () => {
    // No route match → currentServer null (the `/` case). No servers attached.
    setMockMatches([{ params: {} }]);
    renderHook(() => useHostMetrics(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // The bare (server-less) stream is open even though nothing is attached.
    expect(MockEventSource.forHostMetrics()).toBeDefined();
  });

  it("useHostMetrics() returns the broadcast snapshot; useMetrics() stays null on /", async () => {
    setMockMatches([{ params: {} }]); // `/` — no currentServer
    const { result } = renderHook(
      () => ({ host: useHostMetrics(), current: useMetrics() }),
      { wrapper: Wrapper },
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Before the first tick both are null.
    expect(result.current.host).toBeNull();
    expect(result.current.current).toBeNull();

    act(() => {
      MockEventSource.forHostMetrics()!.emit("metrics", FAKE_METRICS);
    });

    // Host metrics populate on `/`; the current-server-scoped hook stays null.
    expect(result.current.host?.hostname).toBe("test-box");
    expect(result.current.host?.cpu.current).toBe(42);
    expect(result.current.current).toBeNull();
  });

  it("does not open the dedicated host-metrics stream while a server is attached; host metrics come from the per-server fan-out", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useHostMetrics(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // With a per-server stream open, the dedicated `?metrics=1` stream is
    // redundant (the `event: metrics` broadcast fans out to every per-server
    // stream) and must NOT be left open — it would cost a permanent +1 against
    // the browser's 6-per-origin connection budget on the fragile board route.
    // A dedicated stream may briefly open during the mount-time window before
    // the server list resolves; once `runkit` attaches it MUST be closed. So
    // assert that no dedicated `?metrics=1` stream is currently live.
    const liveBare = MockEventSource.all.filter(
      (es) => es.url === "/api/sessions/stream?metrics=1" && !es.closed,
    );
    expect(liveBare.length).toBe(0);
    expect(MockEventSource.forServer("runkit")).toBeDefined();

    // useHostMetrics() still returns live metrics — sourced from the per-server
    // stream's metrics fan-out rather than the (absent) dedicated stream.
    act(() => {
      MockEventSource.forServer("runkit")!.emit("metrics", FAKE_METRICS);
    });
    expect(result.current?.hostname).toBe("test-box");
  });

  it("dedupes identical host-metrics payloads across multiple attached servers", async () => {
    // On a multi-server route the same server-global `metrics` payload arrives
    // once per attached server per tick. The host-metrics fan-out must set state
    // (and re-render HostMetricsContext consumers) only once per distinct
    // payload — not once per server — so a second server delivering the same
    // snapshot in the same tick does not re-render a host-metrics-only consumer.
    //
    // The probe reads ONLY useHostMetrics() (not useSessionContext), so its
    // render count reflects HostMetricsContext updates alone — a per-server
    // slice update from the duplicate metrics event does not touch it. A
    // separate hook holds the context handle used to attach the second server.
    vi.mocked(listServers).mockResolvedValue([
      { name: "runkit", sessionCount: 0 },
      { name: "work", sessionCount: 0 },
    ]);
    setMockMatches([{ params: { server: "runkit" } }]);
    let hostRenders = 0;
    // Mutable holder: assigning through an object property (rather than a bare
    // `let`) keeps TS control-flow analysis from narrowing the value to `null`
    // at the assertion sites below, where CFA can't see the closure runs later.
    const host: { latest: MetricsSnapshot | null } = { latest: null };
    function HostProbe() {
      hostRenders += 1;
      host.latest = useHostMetrics();
      return null;
    }
    const { result } = renderHook(() => useSessionContext(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Wrapper>
          <HostProbe />
          {children}
        </Wrapper>
      ),
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Attach the second server so both per-server streams are open.
    await act(async () => { result.current.attachServer("work"); });
    await act(async () => { await Promise.resolve(); });

    // First payload from runkit → host metrics populate (one state update).
    act(() => {
      MockEventSource.forServer("runkit")!.emit("metrics", FAKE_METRICS);
    });
    expect(host.latest?.hostname).toBe("test-box");
    const rendersAfterFirst = hostRenders;

    // The SAME payload arrives from `work` in the same tick. Deduped on the raw
    // string → no new state update, so the host-metrics-only consumer does not
    // re-render again for the duplicate.
    act(() => {
      MockEventSource.forServer("work")!.emit("metrics", FAKE_METRICS);
    });
    expect(hostRenders).toBe(rendersAfterFirst);
    expect(host.latest?.hostname).toBe("test-box");

    // A genuinely different payload DOES update the host-metrics consumer.
    act(() => {
      MockEventSource.forServer("work")!.emit("metrics", { ...FAKE_METRICS, hostname: "other-box" });
    });
    expect(host.latest?.hostname).toBe("other-box");
    expect(hostRenders).toBeGreaterThan(rendersAfterFirst);
  });

  it("opens the dedicated stream on / then closes it once a server attaches", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([{ params: {} }]); // `/` — no currentServer, nothing attached
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // No server attached → the dedicated stream carries host metrics.
    const dedicated = MockEventSource.forHostMetrics();
    expect(dedicated).toBeDefined();
    expect(dedicated!.closed).toBe(false);

    // Attach a server → the per-server fan-out takes over and the dedicated
    // stream is closed to free its connection slot.
    await act(async () => { result.current.attachServer("runkit"); });
    expect(dedicated!.closed).toBe(true);
    expect(MockEventSource.forServer("runkit")).toBeDefined();
  });
});

describe("SessionProvider — hostMetricsConnected (Cockpit dot, 260704-9o7k)", () => {
  it("is false before the first dedicated metrics event, true after (no server attached)", async () => {
    setMockMatches([{ params: {} }]); // `/` — dedicated stream is the source
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Before the first tick the dedicated stream hasn't delivered — gray.
    expect(result.current.hostMetricsConnected).toBe(false);

    act(() => {
      MockEventSource.forHostMetrics()!.emit("metrics", FAKE_METRICS);
    });

    // First metrics event → the stream is flowing → green.
    expect(result.current.hostMetricsConnected).toBe(true);
  });

  it("flips back to false after a 3s disconnect debounce on the dedicated stream's error", async () => {
    vi.useFakeTimers();
    try {
      setMockMatches([{ params: {} }]);
      const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      act(() => {
        MockEventSource.forHostMetrics()!.emit("metrics", FAKE_METRICS);
      });
      expect(result.current.hostMetricsConnected).toBe(true);

      // Error arms the 3s debounce — not yet gray.
      act(() => { MockEventSource.forHostMetrics()!.onerror?.(); });
      expect(result.current.hostMetricsConnected).toBe(true);

      // After 3s with no recovery → gray.
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
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // A server is attached (dedicated stream closed). Until the per-server
    // stream emits `sessions`, the slice is not connected → gray.
    expect(result.current.hostMetricsConnected).toBe(false);

    act(() => {
      MockEventSource.forServer("runkit")!.emit("sessions", []);
    });

    // The attached server's stream is now connected → host metrics flow via the
    // fan-out → green.
    expect(result.current.isConnectedByServer.get("runkit")).toBe(true);
    expect(result.current.hostMetricsConnected).toBe(true);
  });
});

describe("SessionProvider — server-independent host services", () => {
  const FAKE_SERVICES = { services: [{ port: 5173 }, { port: 8080, process: "api" }] };

  it("returns [] before the first services tick", async () => {
    setMockMatches([{ params: {} }]); // `/` — dedicated stream, no servers
    const { result } = renderHook(() => useHostServices(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current).toEqual([]);
  });

  it("populates from the dedicated `?metrics=1` stream on /", async () => {
    setMockMatches([{ params: {} }]); // `/` — no currentServer, nothing attached
    const { result } = renderHook(() => useHostServices(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    act(() => {
      MockEventSource.forHostMetrics()!.emit("services", FAKE_SERVICES);
    });

    expect(result.current.map((s) => s.port)).toEqual([5173, 8080]);
    expect(result.current[1].process).toBe("api");
  });

  it("populates from the per-server fan-out when a server is attached", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([{ params: { server: "runkit" } }]);
    const { result } = renderHook(() => useHostServices(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // The dedicated stream is closed with a server attached; the per-server
    // stream carries `event: services`.
    act(() => {
      MockEventSource.forServer("runkit")!.emit("services", FAKE_SERVICES);
    });

    expect(result.current.map((s) => s.port)).toEqual([5173, 8080]);
  });

  it("dedupes identical services payloads across multiple attached servers", async () => {
    vi.mocked(listServers).mockResolvedValue([
      { name: "runkit", sessionCount: 0 },
      { name: "work", sessionCount: 0 },
    ]);
    setMockMatches([{ params: { server: "runkit" } }]);
    let renders = 0;
    let latest: ReturnType<typeof useHostServices> = [];
    function Probe() {
      renders += 1;
      latest = useHostServices();
      return null;
    }
    const { result } = renderHook(() => useSessionContext(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Wrapper>
          <Probe />
          {children}
        </Wrapper>
      ),
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { result.current.attachServer("work"); });
    await act(async () => { await Promise.resolve(); });

    act(() => {
      MockEventSource.forServer("runkit")!.emit("services", FAKE_SERVICES);
    });
    expect(latest.map((s) => s.port)).toEqual([5173, 8080]);
    const rendersAfterFirst = renders;

    // Same payload from `work` in the same tick — deduped, no extra render.
    act(() => {
      MockEventSource.forServer("work")!.emit("services", FAKE_SERVICES);
    });
    expect(renders).toBe(rendersAfterFirst);

    // A different payload updates the consumer.
    act(() => {
      MockEventSource.forServer("work")!.emit("services", { services: [{ port: 3000 }] });
    });
    expect(latest.map((s) => s.port)).toEqual([3000]);
    expect(renders).toBeGreaterThan(rendersAfterFirst);
  });

  it("skips a malformed services event without throwing", async () => {
    setMockMatches([{ params: {} }]);
    const { result } = renderHook(() => useHostServices(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    act(() => {
      // emit raw non-JSON by driving the handler directly with a bad payload.
      const handler = MockEventSource.forHostMetrics()!.listeners.get("services");
      handler?.({ data: "not json" } as MessageEvent);
    });

    // No throw, still the empty default.
    expect(result.current).toEqual([]);
  });
});

describe("StandaloneSessionContextProvider — pending-server fallbacks", () => {
  it("supplies safe no-op/default values for the new fields", () => {
    function Probe() {
      const ctx = useSessionContext();
      // Exercise the no-op so it is covered (must not throw).
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
