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

import { useUpdateClick } from "./use-update-click";

beforeEach(() => {
  updateNow.mockReset().mockResolvedValue(undefined);
  forceUpdateNow.mockReset().mockResolvedValue(undefined);
  addToast.mockReset();
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
