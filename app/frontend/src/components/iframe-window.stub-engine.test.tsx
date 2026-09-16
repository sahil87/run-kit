import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, render, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { IframeWindow } from "./iframe-window";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import type { FrameChromeState } from "@/lib/web-frame-engine";

// The chrome's engine boundary is module-mocked: the stub below registers a
// spy handle and reports whatever FrameChromeState the test pushes, so these
// cases exercise the chrome's per-capability rendering and handle routing
// without a real frame. (The real engine's behavior is covered by
// web-frame-iframe.test.tsx; the chrome-over-real-engine cases stay in
// iframe-window.test.tsx.)
const mockEngine = vi.hoisted(() => {
  const handle = {
    kind: "iframe" as const,
    reload: vi.fn(),
    retry: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    find: vi.fn(),
    stopFind: vi.fn(),
  };
  return {
    listeners: new Set<() => void>(),
    state: null as FrameChromeState | null,
    handle,
  };
});

vi.mock("@/components/web-frame-iframe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/web-frame-iframe")>();
  const React = await import("react");
  return {
    // The real default-capabilities constant — re-exported so the stub can
    // never drift from the engine.
    WEB_FRAME_IFRAME_DEFAULT_CAPABILITIES: actual.WEB_FRAME_IFRAME_DEFAULT_CAPABILITIES,
    WebFrameIframe: (props: import("@/lib/web-frame-engine").WebFrameEngineProps) => {
      const [, force] = React.useReducer((x: number) => x + 1, 0);
      React.useEffect(() => {
        const listener = () => force();
        mockEngine.listeners.add(listener);
        return () => {
          mockEngine.listeners.delete(listener);
        };
      }, []);
      React.useEffect(() => {
        props.registerHandle(props.url, mockEngine.handle);
        return () => props.unregisterHandle(props.url);
      }, [props.url]);
      React.useEffect(() => {
        if (mockEngine.state) props.onState(props.url, mockEngine.state);
      });
      return React.createElement("div", { "data-testid": "stub-engine" });
    },
  };
});

const ALL_SUPPORT = {
  history: true,
  find: true,
  meta: true,
  zoomGestures: true,
  devtools: false,
} as const;

const NO_SUPPORT = {
  history: false,
  find: false,
  meta: false,
  zoomGestures: false,
  devtools: false,
} as const;

function chromeState(overrides: Partial<FrameChromeState> = {}): FrameChromeState {
  return {
    loading: false,
    supports: { ...ALL_SUPPORT },
    trackedLocation: null,
    title: null,
    favicon: null,
    tileError: null,
    canGoBack: true,
    canGoForward: true,
    find: null,
    ...overrides,
  };
}

/** Push a new report through every mounted stub engine. */
function pushState(state: FrameChromeState) {
  act(() => {
    mockEngine.state = state;
    mockEngine.listeners.forEach((listener) => listener());
  });
}

function renderChrome(props: React.ComponentProps<typeof IframeWindow> = { tabs: [] }) {
  return render(
    <StandaloneSessionContextProvider
      value={{
        sessionsByServer: new Map([["runkit", []]]),
        sessionOrderByServer: new Map([["runkit", []]]),
        isConnectedByServer: new Map([["runkit", false]]),
        metricsByServer: new Map(),
        currentServer: "runkit",
        servers: [{ name: "runkit", sessionCount: 0 }],
        refreshServers: vi.fn(),
      }}
    >
      <IframeWindow {...props} />
    </StandaloneSessionContextProvider>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockEngine.state = chromeState();
});

describe("IframeWindow over a stub engine", () => {
  it("an all-false capability report hides back/forward, keeps refresh and the ⌕ button enabled, and disables the open bar with the hint", () => {
    mockEngine.state = chromeState({ supports: { ...NO_SUPPORT }, canGoBack: false, canGoForward: false });
    renderChrome({ tabs: ["/proxy/8080/docs"] });
    expect(screen.queryByLabelText("Back")).toBeNull();
    expect(screen.queryByLabelText("Forward")).toBeNull();
    expect(screen.getByLabelText("Refresh")).toBeTruthy();

    const findButton = screen.getByLabelText("Find in page") as HTMLButtonElement;
    expect(findButton.disabled).toBe(false);
    fireEvent.click(findButton);
    expect(screen.getByText("page is cross-origin — find unavailable")).toBeTruthy();
    expect((screen.getByLabelText("Find query") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByLabelText("Match count")).toBeNull();
  });

  it("history support with canGoBack false renders Back disabled and Forward enabled", () => {
    mockEngine.state = chromeState({ canGoBack: false, canGoForward: true });
    renderChrome({ tabs: ["/proxy/8080/docs"] });
    expect((screen.getByLabelText("Back") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Forward") as HTMLButtonElement).disabled).toBe(false);
  });

  it("a pushed title renders as the tab label and reaches onPageMeta", () => {
    const onPageMeta = vi.fn();
    renderChrome({ tabs: ["/proxy/8080/docs"], onPageMeta });
    pushState(chromeState({ title: "Docs" }));
    expect(screen.getByTestId("web-tab").textContent).toContain("Docs");
    expect(onPageMeta).toHaveBeenLastCalledWith({ title: "Docs" });
  });

  it("Refresh/Back/Forward/Retry drive the registered handle; a pushed dead-port error renders its surface", () => {
    renderChrome({ tabs: ["/proxy/8080/docs"] });
    fireEvent.click(screen.getByLabelText("Refresh"));
    expect(mockEngine.handle.reload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Back"));
    expect(mockEngine.handle.back).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Forward"));
    expect(mockEngine.handle.forward).toHaveBeenCalledTimes(1);

    pushState(chromeState({ tileError: { kind: "dead-port", port: 4000 } }));
    const box = screen.getByTestId("web-tile-error");
    expect(box.textContent).toContain("nothing listening on :4000");
    fireEvent.click(screen.getByLabelText("Retry"));
    expect(mockEngine.handle.retry).toHaveBeenCalledTimes(1);
  });

  it("a pushed refused error renders the refusal copy with the Open in browser escape hatch (no Retry)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      renderChrome({ tabs: ["/proxy/8080/docs"] });
      pushState(
        chromeState({
          tileError: { kind: "refused", host: "github.com", reason: "X-Frame-Options: DENY" },
        }),
      );
      const box = screen.getByTestId("web-tile-error");
      expect(box.textContent).toContain("github.com refuses embedding");
      expect(box.textContent).toContain(
        "X-Frame-Options: DENY — this site can't render inside a tile",
      );
      expect(within(box).queryByLabelText("Retry")).toBeNull();
      fireEvent.click(within(box).getByLabelText("Open in browser"));
      expect(open).toHaveBeenCalledWith("/proxy/8080/docs", "_blank", "noopener");
    } finally {
      open.mockRestore();
    }
  });

  it("a pushed unreachable error renders the connection-error copy with the Open in browser escape hatch (no Retry)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      renderChrome({ tabs: ["/proxy/8080/docs"] });
      pushState(
        chromeState({
          tileError: {
            kind: "unreachable",
            host: "dead.example",
            reason: "connect failed: connection refused",
          },
        }),
      );
      const box = screen.getByTestId("web-tile-error");
      expect(box.textContent).toContain("dead.example can't be reached");
      expect(box.textContent).toContain("connect failed: connection refused");
      expect(within(box).queryByLabelText("Retry")).toBeNull();
      fireEvent.click(within(box).getByLabelText("Open in browser"));
      expect(open).toHaveBeenCalledWith("/proxy/8080/docs", "_blank", "noopener");
    } finally {
      open.mockRestore();
    }
  });

  it("the find bar drives find/stopFind on the handle and renders a pushed match counter", () => {
    renderChrome({ tabs: ["/proxy/8080/docs"] });
    fireEvent.click(screen.getByLabelText("Find in page"));
    const input = screen.getByLabelText("Find query");

    // Typing (re)starts the search on the engine.
    fireEvent.change(input, { target: { value: "foo" } });
    expect(mockEngine.handle.find).toHaveBeenLastCalledWith("foo", {
      forward: true,
      findNext: false,
    });
    // Enter steps forward, ⇧Enter backward.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockEngine.handle.find).toHaveBeenLastCalledWith("foo", {
      forward: true,
      findNext: true,
    });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(mockEngine.handle.find).toHaveBeenLastCalledWith("foo", {
      forward: false,
      findNext: true,
    });

    // The counter renders the engine's reported {active, total} (0-based in,
    // 1-based out).
    pushState(chromeState({ find: { active: 1, total: 3 } }));
    expect(screen.getByLabelText("Match count").textContent).toBe("2/3");

    // Closing the bar stops the search.
    mockEngine.handle.stopFind.mockClear();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("web-find-bar")).toBeNull();
    expect(mockEngine.handle.stopFind).toHaveBeenCalledTimes(1);
  });
});
