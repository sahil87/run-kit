import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";

// Context seam: the merged update-notification shape the hook reads. Tests flip
// `feed` to drive the two click-routing branches without mounting a provider.
const updateNow = vi.fn();
const forceUpdateNow = vi.fn();
let feed: { manualOnly: boolean; key: string | null } = { manualOnly: false, key: "run-kit@3.9.0" };
vi.mock("@/contexts/session-context", () => ({
  useUpdateNotification: () => ({
    updateNow: (...args: unknown[]) => updateNow(...args),
    forceUpdateNow: (...args: unknown[]) => forceUpdateNow(...args),
    manualOnly: feed.manualOnly,
    key: feed.key,
  }),
}));

// Toast seam: capture failure messages without mounting the provider.
const addToast = vi.fn();
vi.mock("@/components/toast", () => ({
  useToast: () => ({ addToast }),
}));

// Router seam: capture watch-target navigations without mounting a router.
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

import { useUpdateClick, consumeUpdateWatchTarget } from "./use-update-click";

const WATCH = { server: "rk-daemon", session: "rk-jobs", window: "update", window_id: "@5" };

beforeEach(() => {
  updateNow.mockReset().mockResolvedValue({ status: "updating" });
  forceUpdateNow.mockReset().mockResolvedValue({ status: "updating" });
  addToast.mockReset();
  mockNavigate.mockReset();
  feed = { manualOnly: false, key: "run-kit@3.9.0" };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useUpdateClick — click routing by feed (260807-s6zs)", () => {
  it("runs the SCOPED update when the ambient feed is the lit one", async () => {
    const { result } = renderHook(() => useUpdateClick());
    act(() => result.current.triggerUpdate());
    await waitFor(() => expect(updateNow).toHaveBeenCalledTimes(1));
    expect(forceUpdateNow).not.toHaveBeenCalled();
    expect(result.current.updating).toBe(true);
  });

  it("runs the FORCE update when the surface is lit from the manual feed only", async () => {
    feed = { manualOnly: true, key: "tu@0.9.2" };
    const { result } = renderHook(() => useUpdateClick());
    act(() => result.current.triggerUpdate());
    await waitFor(() => expect(forceUpdateNow).toHaveBeenCalledTimes(1));
    expect(updateNow).not.toHaveBeenCalled();
  });

  it("is single-flight — a second click while updating is a no-op", async () => {
    const { result } = renderHook(() => useUpdateClick());
    act(() => result.current.triggerUpdate());
    await waitFor(() => expect(result.current.updating).toBe(true));
    act(() => result.current.triggerUpdate());
    expect(updateNow).toHaveBeenCalledTimes(1);
  });
});

describe("useUpdateClick — failure + completion (unchanged shape)", () => {
  it("clears updating and toasts on a scoped-path rejection", async () => {
    updateNow.mockRejectedValue(new Error("not a Homebrew install"));
    const { result } = renderHook(() => useUpdateClick());
    act(() => result.current.triggerUpdate());
    await waitFor(() => expect(addToast).toHaveBeenCalled());
    expect(addToast).toHaveBeenCalledWith("not a Homebrew install", "error");
    expect(result.current.updating).toBe(false);
  });

  it("clears updating and toasts on a manual force-path rejection", async () => {
    feed = { manualOnly: true, key: "tu@0.9.2" };
    forceUpdateNow.mockRejectedValue(new Error("update failed"));
    const { result } = renderHook(() => useUpdateClick());
    act(() => result.current.triggerUpdate());
    await waitFor(() => expect(addToast).toHaveBeenCalled());
    expect(addToast).toHaveBeenCalledWith("update failed", "error");
    expect(result.current.updating).toBe(false);
  });

  it("clears updating when the effective key changes away from the click-time key (R13)", async () => {
    const { result, rerender } = renderHook(() => useUpdateClick());
    act(() => result.current.triggerUpdate());
    await waitFor(() => expect(result.current.updating).toBe(true));

    // The post-remediation re-check broadcasts a cleared verdict.
    feed = { manualOnly: false, key: null };
    rerender();
    await waitFor(() => expect(result.current.updating).toBe(false));
  });

  it("keeps updating while the effective key is unchanged", async () => {
    const { result, rerender } = renderHook(() => useUpdateClick());
    act(() => result.current.triggerUpdate());
    await waitFor(() => expect(result.current.updating).toBe(true));

    rerender();
    expect(result.current.updating).toBe(true);
  });
});

describe("useUpdateClick — watch-target affordance (260812-z1ya)", () => {
  it("navigates straight to the job window on already-running", async () => {
    updateNow.mockResolvedValue({ status: "already-running", watch: WATCH });
    const { result } = renderHook(() => useUpdateClick());
    act(() => result.current.triggerUpdate());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$server/$window",
      params: { server: "rk-daemon", window: "@5" },
    });
    // Navigation, not a toast action.
    expect(addToast).not.toHaveBeenCalled();
  });

  it("offers a Watch toast action on a fresh 202 spawn", async () => {
    updateNow.mockResolvedValue({ status: "updating", watch: WATCH });
    const { result } = renderHook(() => useUpdateClick());
    act(() => result.current.triggerUpdate());
    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    const [message, variant, action] = addToast.mock.calls[0] as [
      string,
      string,
      { label: string; onSelect: () => void },
    ];
    expect(variant).toBe("info");
    expect(message).toContain("rk-jobs:update");
    expect(action.label).toBe("Watch");
    // The action navigates to the job window's terminal route.
    action.onSelect();
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$server/$window",
      params: { server: "rk-daemon", window: "@5" },
    });
  });

  it("old daemon (no watch) — no toast action, no navigation", async () => {
    updateNow.mockResolvedValue({ status: "updating" });
    const { result } = renderHook(() => useUpdateClick());
    act(() => result.current.triggerUpdate());
    await waitFor(() => expect(result.current.updating).toBe(true));
    expect(addToast).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe("consumeUpdateWatchTarget (shared helper)", () => {
  it("restart result navigates on already-running, same as update", () => {
    const restartWatch = { ...WATCH, window: "restart", window_id: "@9" };
    consumeUpdateWatchTarget({ status: "already-running", watch: restartWatch }, mockNavigate, addToast);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/$server/$window",
      params: { server: "rk-daemon", window: "@9" },
    });
    expect(addToast).not.toHaveBeenCalled();
  });
});
