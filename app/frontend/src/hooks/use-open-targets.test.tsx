import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useOpenTargets, resetOpenTargetsCacheForTest } from "./use-open-targets";
import { getHealth, getOpenApps } from "@/api/client";

vi.mock("@/api/client", () => ({
  getHealth: vi.fn(),
  getOpenApps: vi.fn(),
}));

describe("useOpenTargets", () => {
  beforeEach(() => {
    resetOpenTargetsCacheForTest();
    vi.mocked(getHealth).mockReset();
    vi.mocked(getOpenApps).mockReset();
  });

  it("fetches sshHost + sshUser + registry when enabled", async () => {
    vi.mocked(getHealth).mockResolvedValue({
      status: "ok",
      hostname: "h",
      sshHost: "devbox",
      sshUser: "sahil",
    });
    vi.mocked(getOpenApps).mockResolvedValue([{ id: "vscode", label: "VS Code" }]);

    const { result } = renderHook(() => useOpenTargets(true));

    await waitFor(() => {
      expect(result.current.sshHost).toBe("devbox");
    });
    expect(result.current.sshUser).toBe("sahil");
    expect(result.current.hostApps).toEqual([{ id: "vscode", label: "VS Code" }]);
  });

  it("defaults sshUser to empty when the health response omits it", async () => {
    vi.mocked(getHealth).mockResolvedValue({ status: "ok", hostname: "h" });
    vi.mocked(getOpenApps).mockResolvedValue([]);

    const { result } = renderHook(() => useOpenTargets(true));

    await waitFor(() => {
      expect(getOpenApps).toHaveBeenCalledTimes(1);
    });
    expect(result.current.sshUser).toBe("");
  });

  it("does not fetch when disabled", async () => {
    renderHook(() => useOpenTargets(false));
    await Promise.resolve();
    expect(getHealth).not.toHaveBeenCalled();
    expect(getOpenApps).not.toHaveBeenCalled();
  });

  it("fetches once across multiple consumers (module cache)", async () => {
    vi.mocked(getHealth).mockResolvedValue({ status: "ok", hostname: "h" });
    vi.mocked(getOpenApps).mockResolvedValue([]);

    const a = renderHook(() => useOpenTargets(true));
    const b = renderHook(() => useOpenTargets(true));

    await waitFor(() => {
      expect(getOpenApps).toHaveBeenCalledTimes(1);
    });
    expect(getHealth).toHaveBeenCalledTimes(1);
    a.unmount();
    b.unmount();
  });

  it("degrades to empty sshHost + sshUser when the health read fails", async () => {
    vi.mocked(getHealth).mockRejectedValue(new Error("network down"));
    vi.mocked(getOpenApps).mockResolvedValue([{ id: "iterm", label: "iTerm" }]);

    const { result } = renderHook(() => useOpenTargets(true));

    await waitFor(() => {
      expect(result.current.hostApps).toEqual([{ id: "iterm", label: "iTerm" }]);
    });
    expect(result.current.sshHost).toBe("");
    expect(result.current.sshUser).toBe("");
  });
});
