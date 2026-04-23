import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { Lane } from "./lane";
import type { LanePin } from "@/hooks/use-pinned-lanes";

// ── Mock xterm-related modules (same pattern as terminal-client.test.tsx) ────

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(function () {
    return {
      loadAddon: vi.fn(),
      open: vi.fn(),
      onData: vi.fn(),
      attachCustomKeyEventHandler: vi.fn(),
      dispose: vi.fn(),
      focus: vi.fn(),
      reset: vi.fn(),
      write: vi.fn(),
      scrollToBottom: vi.fn(),
      cols: 80,
      rows: 24,
      options: { fontSize: 13 },
      unicode: { activeVersion: "6" },
      hasSelection: vi.fn().mockReturnValue(false),
      getSelection: vi.fn().mockReturnValue(""),
      clearSelection: vi.fn(),
    };
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(function () {
    return { fit: vi.fn(), dispose: vi.fn() };
  }),
}));

vi.mock("@xterm/addon-clipboard", () => ({
  ClipboardAddon: vi.fn().mockImplementation(function () {
    return { dispose: vi.fn() };
  }),
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(function () {
    return { dispose: vi.fn() };
  }),
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(function () {
    return { dispose: vi.fn() };
  }),
}));

vi.mock("@xterm/addon-unicode-graphemes", () => ({
  UnicodeGraphemesAddon: vi.fn().mockImplementation(function () {
    return { dispose: vi.fn() };
  }),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.mock("@/contexts/theme-context", () => ({
  useTheme: () => ({
    theme: { palette: {} },
    preference: "dark",
    resolved: "dark",
    themeDark: "dark",
    themeLight: "light",
  }),
  useThemeActions: () => ({ setTheme: vi.fn() }),
}));

vi.mock("@/themes", () => ({
  deriveXtermTheme: () => ({}),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/components/terminal-client", () => ({
  clipboardProvider: {
    readText: vi.fn().mockResolvedValue(""),
    writeText: vi.fn().mockResolvedValue(undefined),
  },
}));

const testPin: LanePin = {
  server: "default",
  session: "work",
  windowIndex: 2,
};

function renderLane(overrides: Partial<React.ComponentProps<typeof Lane>> = {}) {
  return render(
    <Lane
      pin={testPin}
      focused={false}
      onFocus={vi.fn()}
      onUnpin={vi.fn()}
      {...overrides}
    />,
  );
}

describe("Lane", () => {
  let mockWs: {
    readyState: number;
    binaryType: string;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    onopen: ((ev: Event) => void) | null;
    onmessage: ((ev: MessageEvent) => void) | null;
    onclose: ((ev: CloseEvent) => void) | null;
    onerror: ((ev: Event) => void) | null;
  };

  beforeEach(() => {
    mockWs = {
      readyState: 0,
      binaryType: "",
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    };

    vi.stubGlobal(
      "WebSocket",
      vi.fn().mockImplementation(function () {
        return mockWs;
      }),
    );

    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        media: "",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    );

    vi.stubGlobal(
      "ResizeObserver",
      vi.fn().mockImplementation(function () {
        return {
          observe: vi.fn(),
          unobserve: vi.fn(),
          disconnect: vi.fn(),
        };
      }),
    );

    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mounts and renders a terminal container div", () => {
    const { container } = renderLane();
    const terminalDiv = container.querySelector(
      "[aria-label='Lane: default/work/2']",
    );
    expect(terminalDiv).toBeTruthy();
  });

  it("constructs the WebSocket URL correctly from pin props", async () => {
    renderLane();

    // The init is async (dynamic imports). Wait for WebSocket constructor to be called.
    await waitFor(() => {
      expect(vi.mocked(WebSocket)).toHaveBeenCalled();
    });

    const wsUrl = vi.mocked(WebSocket).mock.calls[0]?.[0] as string;
    // Should contain the relay path with session and window index, plus server query param
    expect(wsUrl).toContain("/relay/work/2");
    expect(wsUrl).toContain("server=default");
  });

  it("constructs correct WebSocket URL with special characters in pin", async () => {
    const specialPin: LanePin = {
      server: "my server",
      session: "dev/main",
      windowIndex: 0,
    };

    render(
      <Lane
        pin={specialPin}
        focused={false}
        onFocus={vi.fn()}
        onUnpin={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(vi.mocked(WebSocket)).toHaveBeenCalled();
    });

    const wsUrl = vi.mocked(WebSocket).mock.calls[0]?.[0] as string;
    // Session should be URI-encoded
    expect(wsUrl).toContain(encodeURIComponent("dev/main"));
    // Server should be URI-encoded
    expect(wsUrl).toContain(`server=${encodeURIComponent("my server")}`);
  });

  it("renders the resize handle with col-resize cursor", () => {
    const { container } = renderLane();
    const handle = container.querySelector(".cursor-col-resize");
    expect(handle).toBeTruthy();
  });

  it("renders the 'closed' overlay when closed prop is true", () => {
    const { getByText } = renderLane({ closed: true });
    expect(getByText("Window closed")).toBeTruthy();
    expect(getByText("Unpin")).toBeTruthy();
  });

  it("does not render the 'closed' overlay when closed prop is false", () => {
    const { queryByText } = renderLane({ closed: false });
    expect(queryByText("Window closed")).toBeNull();
  });

  it("applies ring classes when focused", () => {
    const { container } = renderLane({ focused: true });
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("ring-2");
    expect(root.className).toContain("ring-accent");
  });

  it("does not apply ring classes when not focused", () => {
    const { container } = renderLane({ focused: false });
    const root = container.firstChild as HTMLElement;
    expect(root.className).not.toContain("ring-2");
  });

  it("calls onFocus when clicked", () => {
    const onFocus = vi.fn();
    const { container } = renderLane({ onFocus });
    const root = container.firstChild as HTMLElement;

    act(() => {
      root.click();
    });

    expect(onFocus).toHaveBeenCalled();
  });

  it("calls onUnpin when closed overlay unpin button is clicked", () => {
    const onUnpin = vi.fn();
    const { getByText } = renderLane({ closed: true, onUnpin });
    const unpinButton = getByText("Unpin");

    act(() => {
      unpinButton.click();
    });

    expect(onUnpin).toHaveBeenCalled();
  });

  it("cleans up WebSocket on unmount", async () => {
    const { unmount } = renderLane();

    await waitFor(() => {
      expect(vi.mocked(WebSocket)).toHaveBeenCalled();
    });

    unmount();

    expect(mockWs.close).toHaveBeenCalled();
  });

  it("uses persisted width from localStorage", () => {
    const widths = { "default:work:2": 600 };
    localStorage.setItem("runkit-lanes-widths", JSON.stringify(widths));

    const { container } = renderLane();
    const root = container.firstChild as HTMLElement;
    expect(root.style.width).toBe("600px");
  });

  it("uses default width when no persisted width exists", () => {
    const { container } = renderLane();
    const root = container.firstChild as HTMLElement;
    expect(root.style.width).toBe("480px");
  });

  it("renders LaneHeader with correct pin data", () => {
    const { getByText, getByLabelText } = renderLane();
    // Header shows server, session, and window index
    expect(getByText("default")).toBeTruthy();
    expect(getByText("work")).toBeTruthy();
    expect(getByText("2")).toBeTruthy();
    // Header has unpin button
    expect(getByLabelText("Unpin lane")).toBeTruthy();
  });
});
