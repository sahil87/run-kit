import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { SessionProvider, useSessionContext } from "./session-context";
import { ChromeProvider } from "./chrome-context";

vi.mock("@/api/client", () => ({
  listServers: vi.fn().mockResolvedValue([]),
}));

// MockEventSource captures registered listeners so tests can drive SSE events
// synchronously. addEventListener is the only API SessionProvider uses.
type Listener = (e: MessageEvent) => void;
const listenersByEvent = new Map<string, Listener>();
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onerror: unknown = null;
  onopen: unknown = null;
  constructor(url: string) {
    this.url = url;
    listenersByEvent.clear();
    MockEventSource.instances.push(this);
  }
  addEventListener(event: string, handler: Listener) {
    listenersByEvent.set(event, handler);
  }
  close() {}
  emit(event: string, data: unknown) {
    const handler = listenersByEvent.get(event);
    if (!handler) return;
    handler({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function Wrapper({ server, children }: { server: string; children: ReactNode }) {
  return (
    <ChromeProvider>
      <SessionProvider server={server}>{children}</SessionProvider>
    </ChromeProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SessionProvider — session-order SSE event", () => {
  it("populates sessionOrder when an SSE event arrives for the active server", () => {
    const { result } = renderHook(() => useSessionContext(), {
      wrapper: ({ children }) => <Wrapper server="default">{children}</Wrapper>,
    });

    expect(result.current.sessionOrder).toEqual([]);

    act(() => {
      const es = MockEventSource.instances.at(-1)!;
      es.emit("session-order", { server: "default", order: ["main", "dev", "scratch"] });
    });

    expect(result.current.sessionOrder).toEqual(["main", "dev", "scratch"]);
  });

  it("ignores events whose `server` field doesn't match the active server", () => {
    const { result } = renderHook(() => useSessionContext(), {
      wrapper: ({ children }) => <Wrapper server="default">{children}</Wrapper>,
    });

    act(() => {
      const es = MockEventSource.instances.at(-1)!;
      es.emit("session-order", { server: "staging", order: ["other"] });
    });

    expect(result.current.sessionOrder).toEqual([]);
  });

  it("treats a non-array `order` payload as empty", () => {
    const { result } = renderHook(() => useSessionContext(), {
      wrapper: ({ children }) => <Wrapper server="default">{children}</Wrapper>,
    });

    act(() => {
      const es = MockEventSource.instances.at(-1)!;
      es.emit("session-order", { server: "default", order: "not-an-array" });
    });

    expect(result.current.sessionOrder).toEqual([]);
  });

  it("resets sessionOrder when the server prop changes", () => {
    let currentServer = "default";
    const DynamicWrapper = ({ children }: { children: ReactNode }) => (
      <Wrapper server={currentServer}>{children}</Wrapper>
    );

    const { result, rerender } = renderHook(() => useSessionContext(), {
      wrapper: DynamicWrapper,
    });

    act(() => {
      const es = MockEventSource.instances.at(-1)!;
      es.emit("session-order", { server: "default", order: ["main"] });
    });
    expect(result.current.sessionOrder).toEqual(["main"]);

    currentServer = "staging";
    rerender();

    expect(result.current.sessionOrder).toEqual([]);
  });
});
