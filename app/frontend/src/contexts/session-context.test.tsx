import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  SessionProvider,
  StandaloneSessionContextProvider,
  useSessionContext,
} from "./session-context";
import { ChromeProvider } from "./chrome-context";

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
    return MockEventSource.byUrl.get(`/api/sessions/stream?server=${encodeURIComponent(server)}`);
  }
}

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

describe("SessionProvider — provisioning state (serversLoaded / pendingServer)", () => {
  it("flips serversLoaded false → true after the first fetch resolves with servers", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });

    // Before the first fetch settles the flag is false.
    expect(result.current.serversLoaded).toBe(false);

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.serversLoaded).toBe(true);
    expect(result.current.servers.map((s) => s.name)).toEqual(["runkit"]);
  });

  it("sets serversLoaded true when the first fetch resolves empty", async () => {
    vi.mocked(listServers).mockResolvedValue([]);
    setMockMatches([]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });

    expect(result.current.serversLoaded).toBe(false);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.serversLoaded).toBe(true);
    expect(result.current.servers).toEqual([]);
  });

  it("sets serversLoaded true even when the first fetch rejects (silent catch)", async () => {
    vi.mocked(listServers).mockRejectedValue(new Error("network down"));
    setMockMatches([]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });

    expect(result.current.serversLoaded).toBe(false);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // The fetch settled (rejected) — the guard must not hang in a loading state.
    expect(result.current.serversLoaded).toBe(true);
    expect(result.current.servers).toEqual([]);
  });

  it("never reverts serversLoaded to false on a subsequent refresh", async () => {
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    setMockMatches([]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.serversLoaded).toBe(true);

    await act(async () => {
      result.current.refreshServers();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.serversLoaded).toBe(true);
  });

  it("markServerPending sets and clears pendingServer (observable via context)", async () => {
    setMockMatches([]);
    const { result } = renderHook(() => useSessionContext(), { wrapper: Wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.pendingServer).toBe(null);

    act(() => { result.current.markServerPending("test2"); });
    expect(result.current.pendingServer).toBe("test2");

    act(() => { result.current.markServerPending(null); });
    expect(result.current.pendingServer).toBe(null);
  });
});

describe("StandaloneSessionContextProvider — provisioning fallbacks", () => {
  function StandaloneWrapper({ children }: { children: ReactNode }) {
    // Partial value intentionally omits serversLoaded / pendingServer /
    // markServerPending to exercise the safe defaults.
    return (
      <StandaloneSessionContextProvider value={{ servers: [] }}>
        {children}
      </StandaloneSessionContextProvider>
    );
  }

  it("supplies safe defaults and a no-op markServerPending when omitted", () => {
    const { result } = renderHook(() => useSessionContext(), { wrapper: StandaloneWrapper });

    expect(result.current.serversLoaded).toBe(false);
    expect(result.current.pendingServer).toBe(null);
    // Calling the fallback must not throw and must leave pendingServer null
    // (no backing state in the standalone provider).
    expect(() => act(() => { result.current.markServerPending("anything"); })).not.toThrow();
    expect(result.current.pendingServer).toBe(null);
  });
});
