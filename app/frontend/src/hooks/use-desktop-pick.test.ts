import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, waitFor, act } from "@testing-library/react";
import type { GuiStatus } from "@/api/client";
import { DESKTOP_SET_OFF_TOAST } from "@/lib/gui-desktop";

// Confirm seam: the AppLayout-mounted dialog's request, captured without a
// provider mount.
const request = vi.fn();
vi.mock("@/contexts/gui-restart-context", () => ({
  useGuiRestartRequest: () => ({ request }),
}));

// Toast seam: capture the off-GUI info toast without the provider.
const addToast = vi.fn();
vi.mock("@/components/toast", () => ({
  useToast: () => ({ addToast }),
}));

vi.mock("@/api/client", async (importActual) => ({
  ...(await importActual<typeof import("@/api/client")>()),
  fetchGuiStatus: vi.fn(),
}));

import { fetchGuiStatus } from "@/api/client";
import { useDesktopPick } from "./use-desktop-pick";

function status(overrides: Partial<GuiStatus> = {}): GuiStatus {
  return {
    id: "host",
    enabled: true,
    backend: "Xtigervnc",
    reachable: true,
    display: ":10",
    width: 1920,
    height: 1080,
    viewers: 1,
    wm: "icewm-session",
    locked: false,
    geometry: "auto",
    socket: "/run/host.sock",
    session: "rk-gui",
    reason: "",
    apps: [],
    uptime_seconds: 0,
    ...overrides,
  };
}

beforeEach(() => {
  request.mockReset().mockResolvedValue(true);
  addToast.mockReset();
  vi.mocked(fetchGuiStatus).mockReset();
});

afterEach(cleanup);

describe("useDesktopPick", () => {
  it("runs the caller's write before anything else; a rejected write stops the flow", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    const { result } = renderHook(() => useDesktopPick());
    const order: string[] = [];
    const write = vi.fn().mockImplementation(() => {
      order.push("write");
      return Promise.resolve();
    });
    vi.mocked(fetchGuiStatus).mockImplementation(() => {
      order.push("fetch");
      return Promise.resolve(status());
    });
    await act(() => result.current("startlxqt", write));
    expect(order).toEqual(["write", "fetch"]);
    expect(write).toHaveBeenCalledWith("startlxqt");

    const failing = vi.fn().mockRejectedValue(new Error("save failed"));
    await expect(
      act(async () => {
        await result.current("startlxqt", failing);
      }),
    ).rejects.toThrow("save failed");
    expect(vi.mocked(fetchGuiStatus)).toHaveBeenCalledTimes(1);
  });

  it("an enabled GUI requests the restart confirm after the write", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    const { result } = renderHook(() => useDesktopPick());
    const write = vi.fn().mockResolvedValue(undefined);
    await act(() => result.current("startlxqt", write));
    expect(request).toHaveBeenCalledOnce();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("a disabled GUI skips the confirm and toasts the takes-effect-later line", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status({ enabled: false, reachable: false, display: "" }));
    const { result } = renderHook(() => useDesktopPick());
    const write = vi.fn().mockResolvedValue(undefined);
    await act(() => result.current("startlxqt", write));
    expect(write).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(DESKTOP_SET_OFF_TOAST, "info");
  });

  it("a Later verdict (request resolves false) ends the flow — the write stands", async () => {
    vi.mocked(fetchGuiStatus).mockResolvedValue(status());
    request.mockResolvedValue(false);
    const { result } = renderHook(() => useDesktopPick());
    const write = vi.fn().mockResolvedValue(undefined);
    await act(() => result.current("startlxqt", write));
    expect(request).toHaveBeenCalledOnce();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("a failed status fetch still opens the confirm (treated as enabled/unknown)", async () => {
    vi.mocked(fetchGuiStatus).mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useDesktopPick());
    const write = vi.fn().mockResolvedValue(undefined);
    await act(() => result.current("startlxqt", write));
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(addToast).not.toHaveBeenCalled();
  });
});
