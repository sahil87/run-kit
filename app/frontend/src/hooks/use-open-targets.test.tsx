import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  invalidateOpenContext,
  resetOpenTargetsCacheForTest,
  useOpenTargets,
} from "./use-open-targets";
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

  // Unmount leftover hooks so their store subscriptions don't leak across
  // tests (the listener set is module-level, like the cache).
  afterEach(() => {
    cleanup();
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

  it("invalidateOpenContext refetches and pushes fresh data to mounted consumers", async () => {
    vi.mocked(getHealth).mockResolvedValue({
      status: "ok",
      hostname: "h",
      sshHost: "sahil@runner-mini.bat-ordinal.ts.net",
      sshUser: "sahil",
    });
    vi.mocked(getOpenApps).mockResolvedValue([]);

    const { result } = renderHook(() => useOpenTargets(true));
    await waitFor(() => {
      expect(result.current.sshHost).toBe("sahil@runner-mini.bat-ordinal.ts.net");
    });

    // The settings commit changed the SSH host server-side; invalidation must
    // deliver the fresh value to the still-mounted consumer without a reload.
    vi.mocked(getHealth).mockResolvedValue({
      status: "ok",
      hostname: "h",
      sshHost: "sahil@mini",
      sshUser: "sahil",
    });
    act(() => {
      invalidateOpenContext();
    });

    await waitFor(() => {
      expect(result.current.sshHost).toBe("sahil@mini");
    });
    expect(getHealth).toHaveBeenCalledTimes(2);
    expect(getOpenApps).toHaveBeenCalledTimes(2);
  });

  it("zero-subscriber invalidation drops the cache so the next mount fetches fresh", async () => {
    vi.mocked(getHealth).mockResolvedValue({
      status: "ok",
      hostname: "h",
      sshHost: "stale-host",
      sshUser: "sahil",
    });
    vi.mocked(getOpenApps).mockResolvedValue([]);

    const first = renderHook(() => useOpenTargets(true));
    await waitFor(() => {
      expect(first.result.current.sshHost).toBe("stale-host");
    });
    first.unmount();

    vi.mocked(getHealth).mockResolvedValue({
      status: "ok",
      hostname: "h",
      sshHost: "fresh-host",
      sshUser: "sahil",
    });
    invalidateOpenContext();
    // No consumer is mounted — no eager refetch, just the cache drop.
    expect(getHealth).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useOpenTargets(true));
    await waitFor(() => {
      expect(second.result.current.sshHost).toBe("fresh-host");
    });
    expect(getHealth).toHaveBeenCalledTimes(2);
  });
});
