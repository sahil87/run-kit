import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server as mswServer } from "../../tests/msw/server";
import { useBoards, useBoardEntries } from "./use-boards";

beforeAll(() => mswServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  mswServer.resetHandlers();
});
afterAll(() => mswServer.close());

// Stub EventSource so the hook does not attempt to open real SSE connections
// in JSDOM. We capture the registered listener so tests can dispatch events.
type Listener = (ev: MessageEvent) => void;
const listenersByServer = new Map<string, Listener>();

class FakeEventSource {
  public url: string;
  public onerror: ((ev: Event) => void) | null = null;
  public onopen: ((ev: Event) => void) | null = null;
  private listeners = new Map<string, Listener>();
  constructor(url: string) {
    this.url = url;
    // capture by server query string for test-time dispatch
    const u = new URL(url, "http://localhost");
    const server = u.searchParams.get("server") ?? "default";
    queueMicrotask(() => {
      // bind onmessage-style listeners via addEventListener
      const lis = this.listeners.get("board-changed");
      if (lis) listenersByServer.set(server, lis);
    });
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, listener);
    if (type === "board-changed") {
      const u = new URL(this.url, "http://localhost");
      const server = u.searchParams.get("server") ?? "default";
      listenersByServer.set(server, listener);
    }
  }
  removeEventListener() {}
  close() {
    const u = new URL(this.url, "http://localhost");
    const server = u.searchParams.get("server") ?? "default";
    listenersByServer.delete(server);
  }
}

vi.stubGlobal("EventSource", FakeEventSource);

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
    const { result } = renderHook(() => useBoards());
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
    const { result } = renderHook(() => useBoards());
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
    const { result } = renderHook(() => useBoards());
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
    const { result } = renderHook(() => useBoards());
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
    const { result } = renderHook(() => useBoardEntries("main"));
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
