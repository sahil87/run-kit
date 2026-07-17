import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  StandaloneSessionContextProvider,
  type ChatFrameHandlers,
} from "@/contexts/session-context";
import type { Conversation } from "@/lib/chat-stream";

// getWindowChat is the GET backfill the hook composes with subscribeChat.
const getWindowChatMock = vi.fn<(server: string, windowId: string) => Promise<Conversation>>();
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, getWindowChat: (s: string, w: string) => getWindowChatMock(s, w) };
});

import { useChatSubscription } from "./use-chat-subscription";

// A controllable chat seam: records subscribe/unsubscribe calls and lets the test
// drive the registered handlers (event/ack) exactly as the real socket would.
type SubCall = { server: string; windowId: string; from: number };
function makeSeam(socketConnected = true) {
  const subscribes: SubCall[] = [];
  const unsubscribes: Array<{ server: string; windowId: string }> = [];
  let handlers: ChatFrameHandlers | null = null;
  return {
    subscribes,
    unsubscribes,
    get handlers() {
      return handlers;
    },
    value: {
      socketConnected,
      subscribeChat: (a: SubCall) => subscribes.push(a),
      unsubscribeChat: (a: { server: string; windowId: string }) => unsubscribes.push(a),
      registerChatHandlers: (_windowId: string, h: ChatFrameHandlers) => {
        handlers = h;
        return () => {
          if (handlers === h) handlers = null;
        };
      },
    },
  };
}

function conv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    provider: "claude",
    sessionRef: "uuid",
    events: [],
    pending: null,
    offset: 0,
    ...overrides,
  };
}

function wrapperFor(seam: ReturnType<typeof makeSeam>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StandaloneSessionContextProvider value={seam.value}>
        {children}
      </StandaloneSessionContextProvider>
    );
  };
}

beforeEach(() => {
  getWindowChatMock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useChatSubscription", () => {
  it("composes GET backfill → subscribeChat(from: offset) and REPLACEs events", async () => {
    getWindowChatMock.mockResolvedValue(
      conv({
        offset: 4242,
        events: [{ type: "message", turn: 1, id: "m1", text: "hello" }],
        pending: { toolName: "AskUserQuestion", text: "Ship it?" },
      }),
    );
    const seam = makeSeam(true);
    const { result } = renderHook(() => useChatSubscription("default", "@1"), {
      wrapper: wrapperFor(seam),
    });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0].text).toBe("hello");
    expect(result.current.pending?.text).toBe("Ship it?");
    // The subscribe carried the GET's offset as `from`.
    expect(seam.subscribes).toEqual([{ server: "default", windowId: "@1", from: 4242 }]);
  });

  it("appends `chat` events and applies `chat-state` (incl. null) from the seam", async () => {
    getWindowChatMock.mockResolvedValue(conv({ offset: 1, events: [{ type: "message", turn: 1, id: "m1", text: "a" }] }));
    const seam = makeSeam(true);
    const { result } = renderHook(() => useChatSubscription("default", "@1"), {
      wrapper: wrapperFor(seam),
    });
    await waitFor(() => expect(seam.handlers).not.toBeNull());

    act(() => {
      seam.handlers!.onEvent("chat", [{ type: "message", turn: 2, id: "m2", text: "b" }]);
    });
    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(result.current.events.map((e) => e.id)).toEqual(["m1", "m2"]);

    act(() => {
      seam.handlers!.onEvent("chat-state", { pending: { toolName: "AskUserQuestion", text: "q?" } });
    });
    await waitFor(() => expect(result.current.pending?.text).toBe("q?"));

    // chat-state pending:null clears (always applied).
    act(() => {
      seam.handlers!.onEvent("chat-state", { pending: null });
    });
    await waitFor(() => expect(result.current.pending).toBeNull());
  });

  it("re-runs the fetch→subscribe composition on chat-reset (rotation)", async () => {
    getWindowChatMock
      .mockResolvedValueOnce(conv({ offset: 10 }))
      .mockResolvedValueOnce(conv({ offset: 20, events: [{ type: "message", turn: 1, id: "r1", text: "rotated" }] }));
    const seam = makeSeam(true);
    const { result } = renderHook(() => useChatSubscription("default", "@1"), {
      wrapper: wrapperFor(seam),
    });
    await waitFor(() => expect(seam.subscribes).toHaveLength(1));
    expect(seam.subscribes[0].from).toBe(10);

    act(() => {
      seam.handlers!.onEvent("chat-reset", {});
    });
    // A second GET runs and a second subscribe fires from the fresh offset.
    await waitFor(() => expect(seam.subscribes).toHaveLength(2));
    expect(seam.subscribes[1].from).toBe(20);
    await waitFor(() => expect(result.current.events.map((e) => e.id)).toEqual(["r1"]));
  });

  it("surfaces a chat-error as the inline error", async () => {
    getWindowChatMock.mockResolvedValue(conv());
    const seam = makeSeam(true);
    const { result } = renderHook(() => useChatSubscription("default", "@1"), {
      wrapper: wrapperFor(seam),
    });
    await waitFor(() => expect(seam.handlers).not.toBeNull());
    act(() => {
      seam.handlers!.onEvent("chat-error", { error: "stream blew up" });
    });
    await waitFor(() => expect(result.current.error).toBe("stream blew up"));
  });

  it("connected = (socket connected) AND (chat acked); undebounced true, 3s-debounced false", async () => {
    vi.useFakeTimers();
    getWindowChatMock.mockResolvedValue(conv());
    const seam = makeSeam(true);
    const { result } = renderHook(() => useChatSubscription("default", "@1"), {
      wrapper: wrapperFor(seam),
    });
    // Flush the mount effect + the resolved GET promise.
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    // Not connected until the ack arrives (socket up, but chat not acked).
    expect(result.current.connected).toBe(false);

    act(() => {
      seam.handlers!.onAck(0);
    });
    // Live (socket ∧ acked) → connected true immediately (no debounce on the way up).
    expect(result.current.connected).toBe(true);
  });

  it("unsubscribes on unmount", async () => {
    getWindowChatMock.mockResolvedValue(conv());
    const seam = makeSeam(true);
    const { unmount } = renderHook(() => useChatSubscription("default", "@1"), {
      wrapper: wrapperFor(seam),
    });
    await waitFor(() => expect(seam.subscribes).toHaveLength(1));
    unmount();
    expect(seam.unsubscribes).toEqual([{ server: "default", windowId: "@1" }]);
  });

  it("re-composes on socket reconnect (false→true) via the shared guarded compose", async () => {
    getWindowChatMock.mockResolvedValue(conv({ offset: 7 }));
    // Mutable socket-connected flag the wrapper reads each render, so a rerender
    // can flip it false→true to simulate a reconnect.
    let connected = false;
    const seam = makeSeam(false);
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <StandaloneSessionContextProvider value={{ ...seam.value, socketConnected: connected }}>
        {children}
      </StandaloneSessionContextProvider>
    );
    const { rerender } = renderHook(() => useChatSubscription("default", "@1"), { wrapper: Wrapper });
    // Mount composes once (the enter path fires regardless of socket state).
    await waitFor(() => expect(seam.subscribes).toHaveLength(1));

    // Reconnect: flip connected true and rerender → the reconnect effect re-runs
    // the SAME guarded compose (a second subscribe from the fresh offset).
    connected = true;
    rerender();
    await waitFor(() => expect(seam.subscribes).toHaveLength(2));
    expect(seam.subscribes[1]).toEqual({ server: "default", windowId: "@1", from: 7 });
  });

  it("a reconnect GET in flight across a window switch does NOT apply the stale conversation or re-subscribe the old identity", async () => {
    // Deferred GET so we control exactly when the reconnect's backfill resolves.
    let resolveOld: (c: Conversation) => void = () => {};
    const oldConv = conv({ offset: 99, events: [{ type: "message", turn: 1, id: "OLD", text: "old-window" }] });

    // Window @1 mounts connected (its initial GET resolves immediately); @2 (after
    // switch) also resolves immediately. Only the RECONNECT GET for @1 is deferred.
    let getCount = 0;
    getWindowChatMock.mockImplementation((_s, w) => {
      getCount++;
      if (w === "@1" && getCount >= 2) {
        // The reconnect GET for @1 — hang it until we resolve manually.
        return new Promise<Conversation>((res) => {
          resolveOld = res;
        });
      }
      if (w === "@2") return Promise.resolve(conv({ offset: 5, events: [{ type: "message", turn: 1, id: "NEW", text: "new-window" }] }));
      return Promise.resolve(conv({ offset: 1 }));
    });

    let connected = true;
    let windowId = "@1";
    const seam = makeSeam(true);
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <StandaloneSessionContextProvider value={{ ...seam.value, socketConnected: connected }}>
        {children}
      </StandaloneSessionContextProvider>
    );
    const { result, rerender } = renderHook(() => useChatSubscription("default", windowId), { wrapper: Wrapper });
    await waitFor(() => expect(seam.subscribes).toHaveLength(1)); // @1 initial subscribe

    // Trigger a reconnect for @1 (drop→up) — its reconnect GET is now in flight.
    connected = false;
    rerender();
    connected = true;
    rerender();
    // The deferred reconnect GET is pending; no new subscribe yet.

    // Window SWITCH to @2 BEFORE the @1 reconnect GET resolves. This tears down the
    // @1 identity (cleanup unsubscribes @1, invalidates its gen) and mounts @2.
    windowId = "@2";
    rerender();
    await waitFor(() => expect(result.current.events.map((e) => e.id)).toEqual(["NEW"]));

    const subscribesBefore = seam.subscribes.length;
    // Now the STALE @1 reconnect GET finally resolves — it must be discarded.
    act(() => {
      resolveOld(oldConv);
    });
    await Promise.resolve();
    await Promise.resolve();

    // The @2 conversation is intact (NOT replaced by the old @1 backfill).
    expect(result.current.events.map((e) => e.id)).toEqual(["NEW"]);
    // No extra subscribe fired for the torn-down @1 identity.
    expect(seam.subscribes.length).toBe(subscribesBefore);
    expect(seam.subscribes.filter((s) => s.windowId === "@1" && s.from === 99)).toHaveLength(0);
    // @1 was unsubscribed on the switch (no leaked server-side producer).
    expect(seam.unsubscribes.some((u) => u.windowId === "@1")).toBe(true);
  });
});
