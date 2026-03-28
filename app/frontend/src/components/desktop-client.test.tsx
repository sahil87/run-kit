import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DesktopClient } from "./desktop-client";

// Use vi.hoisted to ensure the mock constructor is defined before vi.mock factory
const { mockRFB, mockDisconnect } = vi.hoisted(() => {
  const mockDisconnect = vi.fn();
  const mockRFB = vi.fn(function (this: Record<string, unknown>) {
    this.scaleViewport = false;
    this.resizeSession = false;
    this.background = "";
    this.disconnect = mockDisconnect;
    this.addEventListener = vi.fn();
  });
  return { mockRFB, mockDisconnect };
});

vi.mock("@novnc/novnc/lib/rfb", () => ({
  __esModule: true,
  default: mockRFB,
}));

// Pre-warm the mock cache to prevent ESM resolution race
beforeAll(async () => {
  await import("@novnc/novnc/lib/rfb");
});

describe("DesktopClient", () => {
  beforeEach(() => {
    mockRFB.mockClear();
    mockDisconnect.mockClear();
  });

  afterEach(cleanup);

  it("renders a container with correct aria label", () => {
    render(
      <DesktopClient
        sessionName="devshell"
        windowIndex="2"
        server="runkit"
      />,
    );
    expect(screen.getByRole("application")).toBeInTheDocument();
    expect(screen.getByLabelText("Desktop: devshell/2")).toBeInTheDocument();
  });

  it("calls onRfbRef callback when RFB instance is created", async () => {
    const onRfbRef = vi.fn();
    render(
      <DesktopClient
        sessionName="devshell"
        windowIndex="2"
        server="runkit"
        onRfbRef={onRfbRef}
      />,
    );

    // Wait for async import and connection
    await vi.waitFor(() => {
      expect(mockRFB).toHaveBeenCalled();
    });

    expect(onRfbRef).toHaveBeenCalled();
  });

  it("configures scaleViewport on the RFB instance", async () => {
    render(
      <DesktopClient
        sessionName="devshell"
        windowIndex="2"
        server="runkit"
      />,
    );

    await vi.waitFor(() => {
      expect(mockRFB).toHaveBeenCalled();
    });

    // The constructor was called with `new`; check that scaleViewport was set on the instance
    const instance = mockRFB.mock.instances[0];
    expect(instance.scaleViewport).toBe(true);
  });

  it("disconnects RFB on unmount", async () => {
    const { unmount } = render(
      <DesktopClient
        sessionName="devshell"
        windowIndex="2"
        server="runkit"
      />,
    );

    await vi.waitFor(() => {
      expect(mockRFB).toHaveBeenCalled();
    });

    unmount();
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
