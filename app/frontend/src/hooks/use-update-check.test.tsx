import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";

// API seam: capture the source argument and control the check result.
const checkForUpdates = vi.fn();
vi.mock("@/api/client", () => ({
  checkForUpdates: (...args: unknown[]) => checkForUpdates(...args),
}));

// Context seam: a brew, non-dev daemon (Update Now action eligible). The
// manual-feed persistence seam is read via `useContext(SessionContext)`, so the
// mock supplies a real context whose DEFAULT value carries the captured setter
// (no provider is mounted in these renderHook calls).
const forceUpdateNow = vi.fn();
const applyManualCheckResult = vi.fn();
vi.mock("@/contexts/session-context", async () => {
  const { createContext } = await import("react");
  return {
    SessionContext: createContext<{
      applyManualCheckResult: (tools: unknown[], source: string) => void;
    } | null>({
      applyManualCheckResult: (tools: unknown[], source: string) =>
        applyManualCheckResult(tools, source),
    }),
    useUpdateNotification: () => ({
      brew: true,
      daemonVersion: "3.8.0",
      forceUpdateNow: (...args: unknown[]) => forceUpdateNow(...args),
    }),
  };
});

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
  applyManualCheckResult.mockReset();
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

describe("useUpdateCheck manual-feed persistence (260807-s6zs)", () => {
  const notableRunKit = {
    tool: "run-kit",
    current: "3.8.0",
    latest: "3.9.0",
    updateAvailable: true,
    notable: true,
  };
  const subThresholdTu = {
    tool: "tu",
    current: "0.9.1",
    latest: "0.9.2",
    updateAvailable: true,
    notable: false,
  };

  it("persists the incl.-patches updatable subset + echoed source alongside the toast", async () => {
    checkForUpdates.mockResolvedValue({
      tools: [notableRunKit, subThresholdTu],
      key: "",
      source: "github",
    });
    const { result } = renderHook(() => useUpdateCheck());
    act(() => result.current.runUpdateCheck(true));
    await waitFor(() => expect(applyManualCheckResult).toHaveBeenCalled());

    expect(applyManualCheckResult).toHaveBeenCalledWith([notableRunKit, subThresholdTu], "github");
    // The toast flow is unchanged — persistence is IN ADDITION to it.
    expect(addToast).toHaveBeenCalledTimes(1);
    expect((addToast.mock.calls[0] as [string, string])[1]).toBe("info");
  });

  it("persists only the NOTABLE rows for the default check (matching its toast filter)", async () => {
    checkForUpdates.mockResolvedValue({
      tools: [notableRunKit, subThresholdTu],
      key: "",
      source: "released",
    });
    const { result } = renderHook(() => useUpdateCheck());
    act(() => result.current.runUpdateCheck(false));
    await waitFor(() => expect(applyManualCheckResult).toHaveBeenCalled());

    expect(applyManualCheckResult).toHaveBeenCalledWith([notableRunKit], "released");
  });

  it("persists an EMPTY set when the default check finds only sub-threshold bumps (clears a stale positive)", async () => {
    checkForUpdates.mockResolvedValue({
      tools: [subThresholdTu],
      key: "",
      source: "released",
    });
    const { result } = renderHook(() => useUpdateCheck());
    act(() => result.current.runUpdateCheck(false));
    await waitFor(() => expect(applyManualCheckResult).toHaveBeenCalled());

    expect(applyManualCheckResult).toHaveBeenCalledWith([], "released");
    expect((addToast.mock.calls[0] as [string])[0]).toBe("All tools up to date");
  });

  it("persists an EMPTY set for an all-up-to-date verdict", async () => {
    const { result } = renderHook(() => useUpdateCheck());
    act(() => result.current.runUpdateCheck(true));
    await waitFor(() => expect(applyManualCheckResult).toHaveBeenCalled());

    expect(applyManualCheckResult).toHaveBeenCalledWith([], "released");
  });

  it("persists nothing when the check FAILS (the error toast is the only outcome)", async () => {
    checkForUpdates.mockRejectedValue(new Error("update check unavailable"));
    const { result } = renderHook(() => useUpdateCheck());
    act(() => result.current.runUpdateCheck(true));
    await waitFor(() => expect(addToast).toHaveBeenCalled());

    expect(applyManualCheckResult).not.toHaveBeenCalled();
  });
});
