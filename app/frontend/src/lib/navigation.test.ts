import { describe, it, expect } from "vitest";
import { computeKillRedirect } from "./navigation";

describe("computeKillRedirect", () => {
  const windows = [
    { index: 0 },
    { index: 1 },
    { index: 2 },
    { index: 3 },
  ];

  it("returns null when not connected", () => {
    expect(
      computeKillRedirect({
        sessionName: "sess",
        windowIndex: "1",
        currentSessionWindows: windows,
        currentWindowExists: false,
        isConnected: false,
      }),
    ).toBeNull();
  });

  it("returns null when no session name", () => {
    expect(
      computeKillRedirect({
        sessionName: undefined,
        windowIndex: "1",
        currentSessionWindows: windows,
        currentWindowExists: false,
        isConnected: true,
      }),
    ).toBeNull();
  });

  it("returns null when current window still exists", () => {
    expect(
      computeKillRedirect({
        sessionName: "sess",
        windowIndex: "1",
        currentSessionWindows: windows,
        currentWindowExists: true,
        isConnected: true,
      }),
    ).toBeNull();
  });

  it("returns dashboard when session is gone", () => {
    expect(
      computeKillRedirect({
        sessionName: "sess",
        windowIndex: "1",
        currentSessionWindows: null,
        currentWindowExists: false,
        isConnected: true,
      }),
    ).toEqual({ to: "dashboard" });
  });

  it("returns dashboard when window killed and no siblings remain", () => {
    expect(
      computeKillRedirect({
        sessionName: "sess",
        windowIndex: "0",
        currentSessionWindows: [],
        currentWindowExists: false,
        isConnected: true,
      }),
    ).toEqual({ to: "dashboard" });
  });

  it("navigates to nearest sibling when middle window killed", () => {
    // Kill window 2 — siblings [0, 1, 3], nearest is 1 or 3 (both distance 1)
    const siblings = [{ index: 0 }, { index: 1 }, { index: 3 }];
    const result = computeKillRedirect({
      sessionName: "sess",
      windowIndex: "2",
      currentSessionWindows: siblings,
      currentWindowExists: false,
      isConnected: true,
    });
    expect(result).toEqual({ to: "window", session: "sess", windowIndex: 1 });
  });

  it("navigates to next window when first window killed", () => {
    const siblings = [{ index: 1 }, { index: 2 }, { index: 3 }];
    const result = computeKillRedirect({
      sessionName: "sess",
      windowIndex: "0",
      currentSessionWindows: siblings,
      currentWindowExists: false,
      isConnected: true,
    });
    expect(result).toEqual({ to: "window", session: "sess", windowIndex: 1 });
  });

  it("navigates to previous window when last window killed", () => {
    const siblings = [{ index: 0 }, { index: 1 }, { index: 2 }];
    const result = computeKillRedirect({
      sessionName: "sess",
      windowIndex: "3",
      currentSessionWindows: siblings,
      currentWindowExists: false,
      isConnected: true,
    });
    expect(result).toEqual({ to: "window", session: "sess", windowIndex: 2 });
  });

  it("navigates to only remaining sibling", () => {
    const siblings = [{ index: 5 }];
    const result = computeKillRedirect({
      sessionName: "my-session",
      windowIndex: "0",
      currentSessionWindows: siblings,
      currentWindowExists: false,
      isConnected: true,
    });
    expect(result).toEqual({ to: "window", session: "my-session", windowIndex: 5 });
  });
});
