import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";

// API seam: capture the source argument and control the check result.
const checkForUpdates = vi.fn();
vi.mock("@/api/client", () => ({
  checkForUpdates: (...args: unknown[]) => checkForUpdates(...args),
}));

// Context seam: a brew, non-dev daemon (Update Now action eligible).
const forceUpdateNow = vi.fn();
vi.mock("@/contexts/session-context", () => ({
  useUpdateNotification: () => ({
    brew: true,
    daemonVersion: "3.8.0",
    forceUpdateNow: (...args: unknown[]) => forceUpdateNow(...args),
  }),
}));

// Toast seam: capture composed messages without mounting the provider.
const addToast = vi.fn();
vi.mock("@/components/toast", () => ({
  useToast: () => ({ addToast }),
}));

import { useUpdateCheck } from "./use-update-check";

beforeEach(() => {
  checkForUpdates.mockReset().mockResolvedValue({ tools: [], key: "", source: "released" });
  addToast.mockReset();
  forceUpdateNow.mockReset();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useUpdateCheck source mapping (260720-wb3n)", () => {
  it("maps the default check to a source-less checkForUpdates()", async () => {
    const { result } = renderHook(() => useUpdateCheck());
    act(() => result.current.runUpdateCheck(false));
    await waitFor(() => expect(addToast).toHaveBeenCalled());
    expect(checkForUpdates).toHaveBeenCalledWith(undefined);
  });

  it('maps includePatches to checkForUpdates("github")', async () => {
    const { result } = renderHook(() => useUpdateCheck());
    act(() => result.current.runUpdateCheck(true));
    await waitFor(() => expect(addToast).toHaveBeenCalled());
    expect(checkForUpdates).toHaveBeenCalledWith("github");
  });

  it("passes the echoed source into the toast: a github non-notable row is NOT annotated", async () => {
    checkForUpdates.mockResolvedValue({
      tools: [
        { tool: "run-kit", current: "3.8.7", latest: "3.9.1", updateAvailable: true, notable: false },
      ],
      key: "",
      source: "github",
    });
    const { result } = renderHook(() => useUpdateCheck());
    act(() => result.current.runUpdateCheck(true));
    await waitFor(() => expect(addToast).toHaveBeenCalled());
    const [message, kind] = addToast.mock.calls[0] as [string, string];
    expect(message).toBe("run-kit v3.8.7 → v3.9.1");
    expect(message).not.toContain("(patch — below notify threshold)");
    expect(kind).toBe("info");
  });

  it("keeps the annotation for a released-sourced non-notable row", async () => {
    checkForUpdates.mockResolvedValue({
      tools: [
        { tool: "tu", current: "0.9.1", latest: "0.9.2", updateAvailable: true, notable: false },
      ],
      key: "",
      source: "released",
    });
    const { result } = renderHook(() => useUpdateCheck());
    act(() => result.current.runUpdateCheck(true));
    await waitFor(() => expect(addToast).toHaveBeenCalled());
    const [message] = addToast.mock.calls[0] as [string];
    expect(message).toBe("tu v0.9.1 → v0.9.2 (patch — below notify threshold)");
  });

  it("surfaces a failed check as an error toast (fail-loud manual path)", async () => {
    checkForUpdates.mockRejectedValue(new Error("update check unavailable — shll not found"));
    const { result } = renderHook(() => useUpdateCheck());
    act(() => result.current.runUpdateCheck(true));
    await waitFor(() => expect(addToast).toHaveBeenCalled());
    expect(addToast).toHaveBeenCalledWith("update check unavailable — shll not found", "error");
  });
});
