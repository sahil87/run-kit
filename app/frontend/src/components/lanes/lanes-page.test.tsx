import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { LanePin } from "@/hooks/use-pinned-lanes";

// ── Mock usePinnedLanes to control pin state ─────────────────────────────────

const mockUnpinWindow = vi.fn();
const mockPinWindow = vi.fn();
const mockClearPins = vi.fn();
let mockPins: LanePin[] = [];

vi.mock("@/hooks/use-pinned-lanes", () => ({
  usePinnedLanes: () => ({
    pins: mockPins,
    pinWindow: mockPinWindow,
    unpinWindow: mockUnpinWindow,
    isPinned: (pin: LanePin) =>
      mockPins.some(
        (p) =>
          p.server === pin.server &&
          p.session === pin.session &&
          p.windowIndex === pin.windowIndex,
      ),
    clearPins: mockClearPins,
    movePinToIndex: vi.fn(),
  }),
}));

// ── Mock Lane component to avoid xterm.js complexity ─────────────────────────

vi.mock("@/components/lanes/lane", () => ({
  Lane: ({
    pin,
    focused,
    onFocus,
    onUnpin,
    closed,
  }: {
    pin: LanePin;
    focused: boolean;
    onFocus: () => void;
    onUnpin: () => void;
    closed?: boolean;
    hideHeader?: boolean;
    fitMode?: boolean;
    maximized?: boolean;
    hidden?: boolean;
    onDoubleClickHeader?: () => void;
    windowInfo?: unknown;
    isDragOver?: boolean;
    onDragStart?: () => void;
    onDragOver?: () => void;
    onDragEnd?: () => void;
  }) => (
    <div
      data-testid={`lane-${pin.server}:${pin.session}:${pin.windowIndex}`}
      data-focused={focused}
      data-closed={closed}
      onClick={onFocus}
    >
      <button data-testid={`unpin-${pin.server}:${pin.session}:${pin.windowIndex}`} onClick={onUnpin}>
        Unpin
      </button>
    </div>
  ),
}));

// ── Mock theme context ───────────────────────────────────────────────────────

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

// ── Import after mocks are defined ───────────────────────────────────────────

import { LanesPage } from "./lanes-page";

// jsdom doesn't implement scrollIntoView or EventSource
Element.prototype.scrollIntoView = vi.fn();
globalThis.EventSource = vi.fn(() => ({
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  close: vi.fn(),
})) as unknown as typeof EventSource;

describe("LanesPage", () => {
  beforeEach(() => {
    mockPins = [];
    mockUnpinWindow.mockReset();
    mockPinWindow.mockReset();
    mockClearPins.mockReset();
    try { sessionStorage.clear(); } catch { /* ignore */ }

    // Stub EventSource so SSE logic does not throw
    vi.stubGlobal(
      "EventSource",
      vi.fn().mockImplementation(function () {
        return {
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          close: vi.fn(),
        };
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders empty state when no pins exist", () => {
    mockPins = [];
    render(<LanesPage />);

    expect(screen.getByText("No panes pinned")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pin windows from the sidebar or command palette to monitor them here",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Back to server list")).toBeInTheDocument();
  });

  it("renders correct number of lanes when pins exist", () => {
    mockPins = [
      { server: "default", session: "work", windowIndex: 0 },
      { server: "default", session: "work", windowIndex: 1 },
      { server: "remote", session: "build", windowIndex: 0 },
    ];
    render(<LanesPage />);

    expect(screen.getByTestId("lane-default:work:0")).toBeInTheDocument();
    expect(screen.getByTestId("lane-default:work:1")).toBeInTheDocument();
    expect(screen.getByTestId("lane-remote:build:0")).toBeInTheDocument();
  });

  it("top bar shows Lanes title when pins exist", () => {
    mockPins = [
      { server: "default", session: "work", windowIndex: 0 },
      { server: "default", session: "work", windowIndex: 1 },
    ];
    render(<LanesPage />);

    expect(screen.getByText("Lanes")).toBeInTheDocument();
  });

  it("focus indicator (ring class) applied to the first lane by default", () => {
    mockPins = [
      { server: "default", session: "work", windowIndex: 0 },
      { server: "default", session: "work", windowIndex: 1 },
    ];
    render(<LanesPage />);

    const lane0 = screen.getByTestId("lane-default:work:0");
    const lane1 = screen.getByTestId("lane-default:work:1");
    expect(lane0.getAttribute("data-focused")).toBe("true");
    expect(lane1.getAttribute("data-focused")).toBe("false");
  });

  it("clicking a lane changes focus to that lane", () => {
    mockPins = [
      { server: "default", session: "work", windowIndex: 0 },
      { server: "default", session: "work", windowIndex: 1 },
    ];
    render(<LanesPage />);

    const lane1 = screen.getByTestId("lane-default:work:1");
    fireEvent.click(lane1);

    expect(lane1.getAttribute("data-focused")).toBe("true");
    const lane0 = screen.getByTestId("lane-default:work:0");
    expect(lane0.getAttribute("data-focused")).toBe("false");
  });

  it("has 'Lanes' title in chrome", () => {
    mockPins = [];
    render(<LanesPage />);

    expect(screen.getByText("Lanes")).toBeInTheDocument();
  });

  it("has 'Lanes' title in chrome when pins exist", () => {
    mockPins = [{ server: "default", session: "work", windowIndex: 0 }];
    render(<LanesPage />);

    expect(screen.getByText("Lanes")).toBeInTheDocument();
  });

  it("calls unpinWindow when lane's unpin callback fires", () => {
    mockPins = [{ server: "default", session: "work", windowIndex: 0 }];
    render(<LanesPage />);

    const unpinBtn = screen.getByTestId("unpin-default:work:0");
    fireEvent.click(unpinBtn);

    expect(mockUnpinWindow).toHaveBeenCalledWith({
      server: "default",
      session: "work",
      windowIndex: 0,
    });
  });

  it("keyboard Ctrl+] cycles focus to next lane", () => {
    mockPins = [
      { server: "default", session: "work", windowIndex: 0 },
      { server: "default", session: "work", windowIndex: 1 },
      { server: "remote", session: "build", windowIndex: 0 },
    ];
    render(<LanesPage />);

    // Initially lane 0 is focused
    expect(
      screen.getByTestId("lane-default:work:0").getAttribute("data-focused"),
    ).toBe("true");

    // Press Ctrl+]
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "]",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });

    expect(
      screen.getByTestId("lane-default:work:1").getAttribute("data-focused"),
    ).toBe("true");
  });

  it("keyboard Ctrl+[ cycles focus to previous lane (with wrap)", () => {
    mockPins = [
      { server: "default", session: "work", windowIndex: 0 },
      { server: "default", session: "work", windowIndex: 1 },
    ];
    render(<LanesPage />);

    // Lane 0 is focused; Ctrl+[ should wrap to lane 1
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "[",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });

    expect(
      screen.getByTestId("lane-default:work:1").getAttribute("data-focused"),
    ).toBe("true");
  });

  it("shows keyboard shortcut hint in chrome", () => {
    mockPins = [{ server: "default", session: "work", windowIndex: 0 }];
    render(<LanesPage />);

    expect(screen.getByText("Ctrl+]/[")).toBeInTheDocument();
  });

  it("renders back link to root in chrome", () => {
    mockPins = [{ server: "default", session: "work", windowIndex: 0 }];
    render(<LanesPage />);

    const backLink = screen.getByText("Run Kit");
    expect(backLink).toBeInTheDocument();
    expect(backLink.closest("a")).toHaveAttribute("href", "/");
  });
});
