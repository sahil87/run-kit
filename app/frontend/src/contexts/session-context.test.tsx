import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  SessionProvider,
  useSessionContext,
  StandaloneSessionContextProvider,
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
