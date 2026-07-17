import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { server as mswServer } from "../../tests/msw/server";
import { useBoards, useBoardEntries } from "./use-boards";
import { SessionProvider } from "@/contexts/session-context";
import { ChromeProvider } from "@/contexts/chrome-context";

beforeAll(() => mswServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  mswServer.resetHandlers();
  vi.unstubAllGlobals();
});
afterAll(() => mswServer.close());

// Mock TanStack Router so SessionProvider can compute currentServer without
// a real router. The hook tests don't depend on a specific currentServer —
// `useBoards` calls `attachServer(name)` for every known server, so the
// provider opens ES for them regardless.
vi.mock("@tanstack/react-router", () => ({
  useMatches: () => [],
}));

// Stub WebSocket so the hook does not open a real /ws/state connection in JSDOM.
// SessionProvider opens ONE socket and subscribes to each known server (useBoards
// calls attachServer for every server). Tests dispatch a `board-changed` server
// event via `dispatchBoardChanged(server)`; `activeServers` reflects the current
// per-server subscriptions so a test can wait until a server is subscribed.
const WS_OPEN = 1;
let currentWS: MockWS | null = null;
const activeServers = new Set<string>();

class MockWS {
  static readonly OPEN = 1;
  url: string;
  readyState = WS_OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    currentWS = this;
    queueMicrotask(() => this.onopen?.());
  }
  send(raw: string) {
    try {
      const m = JSON.parse(raw);
      if (m.op === "subscribe" && m.kind === "server") activeServers.add(m.key);
      else if (m.op === "unsubscribe" && m.kind === "server") activeServers.delete(m.key);
    } catch {
      // ignore
    }
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  deliver(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }
}

// Dispatch a `board-changed` server event for the given server over the socket.
function dispatchBoardChanged(server: string) {
  currentWS?.deliver({ op: "event", kind: "server", key: server, type: "board-changed", data: {} });
}

beforeEach(() => {
  currentWS = null;
  activeServers.clear();
  vi.stubGlobal("WebSocket", MockWS as unknown as typeof WebSocket);
});

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <ChromeProvider>
      <SessionProvider>{children}</SessionProvider>
    </ChromeProvider>
  );
}

describe("useBoards", () => {
  it("performs initial fetch on mount", async () => {
    let calls = 0;
    mswServer.use(
      http.get("/api/servers", () => HttpResponse.json([{ name: "default", sessionCount: 0 }])),
      http.get("/api/boards", () => {
        calls++;
        return HttpResponse.json([{ name: "main", pinCount: 1 }]);
      }),
    );
    const { result } = renderHook(() => useBoards(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.boards).toEqual([{ name: "main", pinCount: 1 }]);
    expect(calls).toBe(1);
  });

  it("re-fetches on board-changed SSE event from any server", async () => {
    let calls = 0;
    let payload: { name: string; pinCount: number }[] = [];
    mswServer.use(
      http.get("/api/servers", () => HttpResponse.json([{ name: "runkit", sessionCount: 0 }])),
      http.get("/api/boards", () => {
        calls++;
        return HttpResponse.json(payload);
      }),
    );
    const { result } = renderHook(() => useBoards(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(calls).toBe(1);
    expect(result.current.boards).toEqual([]);

    payload = [{ name: "main", pinCount: 1 }];
    // Dispatch a synthetic board-changed event via the mocked state socket.
    await waitFor(() => expect(activeServers.has("runkit")).toBe(true));
    act(() => {
      dispatchBoardChanged("runkit");
    });
    await waitFor(() => {
      expect(calls).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      expect(result.current.boards).toEqual([{ name: "main", pinCount: 1 }]);
    });
  });

  it("debounces multiple rapid SSE events into a single re-fetch", async () => {
    let calls = 0;
    mswServer.use(
      http.get("/api/servers", () => HttpResponse.json([{ name: "default", sessionCount: 0 }])),
      http.get("/api/boards", () => {
        calls++;
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHook(() => useBoards(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(calls).toBe(1);

    await waitFor(() => expect(activeServers.has("default")).toBe(true));
    act(() => {
      // 3 rapid events within debounce window.
      for (let i = 0; i < 3; i++) {
        dispatchBoardChanged("default");
      }
    });
    await waitFor(() => expect(calls).toBe(2), { timeout: 200 });
    // Still 2 (initial + one debounced re-fetch), not 4.
    expect(calls).toBe(2);
  });

  it("preserves last good boards on transient error", async () => {
    let counter = 0;
    mswServer.use(
      http.get("/api/servers", () => HttpResponse.json([{ name: "default", sessionCount: 0 }])),
      http.get("/api/boards", () => {
        counter++;
        if (counter === 1) {
          return HttpResponse.json([{ name: "main", pinCount: 1 }]);
        }
        return HttpResponse.json({ error: "boom" }, { status: 500 });
      }),
    );
    const { result } = renderHook(() => useBoards(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.boards).toHaveLength(1));

    await waitFor(() => expect(activeServers.has("default")).toBe(true));
    act(() => {
      dispatchBoardChanged("default");
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    // boards still equal the last-good value.
    expect(result.current.boards).toEqual([{ name: "main", pinCount: 1 }]);
  });
});

describe("useBoardEntries", () => {
  it("fetches by name and updates on SSE", async () => {
    let payload: unknown[] = [];
    let calls = 0;
    mswServer.use(
      http.get("/api/servers", () => HttpResponse.json([{ name: "default", sessionCount: 0 }])),
      http.get("/api/boards/:name", () => {
        calls++;
        return HttpResponse.json(payload);
      }),
    );
    const { result } = renderHook(() => useBoardEntries("main"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(calls).toBe(1);

    payload = [
      {
        server: "default",
        windowId: "@1234",
        session: "dev",
        windowIndex: 2,
        windowName: "agent",
        orderKey: "a",
      },
    ];
    await waitFor(() => expect(activeServers.has("default")).toBe(true));
    act(() => {
      dispatchBoardChanged("default");
    });
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
  });
});
