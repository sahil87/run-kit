import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError, type WindowSendMode } from "@/api/client";
import {
  deliverUtterance,
  resolveTargetPaneId,
  routeIsAgentWindow,
  VOICE_SHELL_COMMAND_TEMPLATE,
} from "./voice-delivery";

const sendToWindowMock = vi.fn<
  (server: string, windowId: string, text: string, mode: WindowSendMode, pane?: string) => Promise<{ ok: boolean }>
>();
const sendOperatorRequestMock = vi.fn<
  (server: string, windowId: string, template: string, text?: string) => Promise<void>
>();
vi.mock("@/api/client", async (orig) => {
  const actual = await orig<typeof import("@/api/client")>();
  return {
    ...actual,
    sendToWindow: (...args: Parameters<typeof actual.sendToWindow>) => sendToWindowMock(...args),
    sendOperatorRequest: (...args: Parameters<typeof actual.sendOperatorRequest>) =>
      sendOperatorRequestMock(...args),
  };
});

beforeEach(() => {
  sendToWindowMock.mockReset().mockResolvedValue({ ok: true });
  sendOperatorRequestMock.mockReset().mockResolvedValue(undefined);
});

describe("routeIsAgentWindow", () => {
  it("is true only for a non-empty chatSessionRef", () => {
    expect(routeIsAgentWindow({ chatSessionRef: "claude-abc" })).toBe(true);
    expect(routeIsAgentWindow({ chatSessionRef: "" })).toBe(false);
    expect(routeIsAgentWindow({ chatSessionRef: null })).toBe(false);
    expect(routeIsAgentWindow({})).toBe(false);
  });
});

describe("resolveTargetPaneId", () => {
  it("picks the active pane, falls back to the first, then null", () => {
    expect(
      resolveTargetPaneId({
        panes: [
          { paneId: "%7", isActive: false },
          { paneId: "%8", isActive: true },
        ],
      }),
    ).toBe("%8");
    expect(
      resolveTargetPaneId({
        panes: [
          { paneId: "%7", isActive: false },
          { paneId: "%8", isActive: false },
        ],
      }),
    ).toBe("%7");
    expect(resolveTargetPaneId({ panes: [] })).toBeNull();
    expect(resolveTargetPaneId({})).toBeNull();
  });
});

describe("deliverUtterance", () => {
  it("agent window: window send with submit mode and the pinned pane", async () => {
    const onBusy = vi.fn();
    await deliverUtterance({
      server: "rk",
      windowId: "@3",
      paneId: "%12",
      text: "restart the api",
      isAgentWindow: true,
      onBusy,
    });
    expect(sendToWindowMock).toHaveBeenCalledWith("rk", "@3", "restart the api", "submit", "%12");
    expect(sendOperatorRequestMock).not.toHaveBeenCalled();
    expect(onBusy).not.toHaveBeenCalled();
  });

  it("agent window without a pane passes undefined (active-pane behavior)", async () => {
    await deliverUtterance({
      server: "rk",
      windowId: "@3",
      paneId: null,
      text: "hi",
      isAgentWindow: true,
      onBusy: vi.fn(),
    });
    expect(sendToWindowMock).toHaveBeenCalledWith("rk", "@3", "hi", "submit", undefined);
  });

  it("agent window errors rethrow without busy handling", async () => {
    sendToWindowMock.mockRejectedValue(new ApiError("conflict", 409));
    const onBusy = vi.fn();
    await expect(
      deliverUtterance({
        server: "rk",
        windowId: "@3",
        paneId: null,
        text: "hi",
        isAgentWindow: true,
        onBusy,
      }),
    ).rejects.toThrow("conflict");
    expect(onBusy).not.toHaveBeenCalled();
  });

  it("shell window: operator request with the voice template and the text", async () => {
    const onBusy = vi.fn();
    await deliverUtterance({
      server: "rk",
      windowId: "@5",
      paneId: null,
      text: "restart the api",
      isAgentWindow: false,
      onBusy,
    });
    expect(sendOperatorRequestMock).toHaveBeenCalledWith(
      "rk",
      "@5",
      VOICE_SHELL_COMMAND_TEMPLATE,
      "restart the api",
    );
    expect(sendToWindowMock).not.toHaveBeenCalled();
    expect(onBusy).not.toHaveBeenCalled();
  });

  it("shell window busy 409 routes to onBusy and resolves", async () => {
    sendOperatorRequestMock.mockRejectedValue(new ApiError("operator is busy", 409));
    const onBusy = vi.fn();
    await deliverUtterance({
      server: "rk",
      windowId: "@5",
      paneId: null,
      text: "restart the api",
      isAgentWindow: false,
      onBusy,
    });
    expect(onBusy).toHaveBeenCalledTimes(1);
  });

  it("shell window non-busy errors rethrow", async () => {
    sendOperatorRequestMock.mockRejectedValue(new ApiError("no operator on this server", 404));
    const onBusy = vi.fn();
    await expect(
      deliverUtterance({
        server: "rk",
        windowId: "@5",
        paneId: null,
        text: "hi",
        isAgentWindow: false,
        onBusy,
      }),
    ).rejects.toThrow("no operator on this server");
    expect(onBusy).not.toHaveBeenCalled();

    sendOperatorRequestMock.mockRejectedValue(new Error("network down"));
    await expect(
      deliverUtterance({
        server: "rk",
        windowId: "@5",
        paneId: null,
        text: "hi",
        isAgentWindow: false,
        onBusy: vi.fn(),
      }),
    ).rejects.toThrow("network down");
  });
});
