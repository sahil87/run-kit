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

// Stub EventSource so the hook does not attempt to open real SSE connections
// in JSDOM. We capture the `board-changed` listener per server so tests can
// dispatch events. SessionProvider opens these on behalf of useBoards now.
type Listener = (ev: MessageEvent) => void;
const listenersByServer = new Map<string, Listener>();

class FakeEventSource {
  public url: string;
  public onerror: ((ev: Event) => void) | null = null;
  public onopen: ((ev: Event) => void) | null = null;
  private listeners = new Map<string, Listener>();
  // The server key this ES registered a `board-changed` listener under, if any.
  // Only a per-server stream (`?server=<name>`) registers one; the dedicated
  // metrics-only stream (`?metrics=1`, no `server`) does not — so on close it
  // must NOT clobber a real server's entry (it has none of its own).
  private boardServer: string | null = null;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, listener);
    if (type === "board-changed") {
      const u = new URL(this.url, "http://localhost");
      const server = u.searchParams.get("server") ?? "default";
      this.boardServer = server;
      listenersByServer.set(server, listener);
    }
  }
  removeEventListener() {}
  close() {
    // Only remove the entry this ES actually registered. A metrics-only stream
    // never registered a `board-changed` listener, so it removes nothing —
    // closing it must not evict a real per-server stream's listener.
    if (this.boardServer !== null) {
      listenersByServer.delete(this.boardServer);
    }
  }
}

beforeEach(() => {
  listenersByServer.clear();
  vi.stubGlobal("EventSource", FakeEventSource);
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
    // Dispatch a synthetic board-changed event via the fake EventSource.
    await waitFor(() => expect(listenersByServer.get("runkit")).toBeDefined());
    act(() => {
      const lis = listenersByServer.get("runkit");
      lis?.(new MessageEvent("board-changed", { data: "{}" }));
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

    await waitFor(() => expect(listenersByServer.get("default")).toBeDefined());
    act(() => {
      const lis = listenersByServer.get("default");
      // 3 rapid events within debounce window.
      for (let i = 0; i < 3; i++) {
        lis?.(new MessageEvent("board-changed", { data: "{}" }));
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

    await waitFor(() => expect(listenersByServer.get("default")).toBeDefined());
    act(() => {
      const lis = listenersByServer.get("default");
      lis?.(new MessageEvent("board-changed", { data: "{}" }));
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
    await waitFor(() => expect(listenersByServer.get("default")).toBeDefined());
    act(() => {
      const lis = listenersByServer.get("default");
      lis?.(new MessageEvent("board-changed", { data: "{}" }));
    });
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
  });
});
