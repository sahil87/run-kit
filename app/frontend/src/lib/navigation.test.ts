import { describe, it, expect } from "vitest";
import { computeKillRedirect } from "./navigation";

describe("computeKillRedirect", () => {
  const windows = [
    { index: 0, windowId: "@0" },
    { index: 1, windowId: "@1" },
    { index: 2, windowId: "@2" },
    { index: 3, windowId: "@3" },
  ];

  it("returns null when not connected", () => {
    expect(
      computeKillRedirect({
        sessionName: "sess",
        windowId: "@1",
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
        windowId: "@1",
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
        windowId: "@1",
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
        windowId: "@1",
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
        windowId: "@0",
        currentSessionWindows: [],
        currentWindowExists: false,
        isConnected: true,
      }),
    ).toEqual({ to: "dashboard" });
  });

  it("navigates to a surviving neighbor by windowId when a window is killed", () => {
    // Kill window @2 — surviving siblings (list order) [@0, @1, @3]; the
    // redirect targets the first surviving window by its stable windowId.
    const siblings = [
      { index: 0, windowId: "@0" },
      { index: 1, windowId: "@1" },
      { index: 3, windowId: "@3" },
    ];
    const result = computeKillRedirect({
      sessionName: "sess",
      windowId: "@2",
      currentSessionWindows: siblings,
      currentWindowExists: false,
      isConnected: true,
    });
    expect(result).toEqual({ to: "window", session: "sess", windowId: "@0" });
  });

  it("navigates to the first surviving window when the first window is killed", () => {
    const siblings = [
      { index: 1, windowId: "@1" },
      { index: 2, windowId: "@2" },
      { index: 3, windowId: "@3" },
    ];
    const result = computeKillRedirect({
      sessionName: "sess",
      windowId: "@0",
      currentSessionWindows: siblings,
      currentWindowExists: false,
      isConnected: true,
    });
    expect(result).toEqual({ to: "window", session: "sess", windowId: "@1" });
  });

  it("does not redirect when URL (session, window) was never observed (stale SSE)", () => {
    // Freshly navigated URL: isConnected=true but first SSE payload didn't
    // include our session yet (stale cached data from previous URL/state).
    // Must wait for fresh data before redirecting.
    expect(
      computeKillRedirect({
        sessionName: "fresh-session",
        windowId: "@0",
        currentSessionWindows: null,
        currentWindowExists: false,
        isConnected: true,
        currentWindowEverSeen: false,
      }),
    ).toBeNull();
  });

  it("does not redirect when URL never observed and session briefly has empty windows", () => {
    // Transient SSE state: session is present but its windows enumeration
    // hasn't populated yet. Without the ever-seen guard this would fire the
    // "window gone, no siblings remain" → dashboard branch.
    expect(
      computeKillRedirect({
        sessionName: "fresh-session",
        windowId: "@0",
        currentSessionWindows: [],
        currentWindowExists: false,
        isConnected: true,
        currentWindowEverSeen: false,
      }),
    ).toBeNull();
  });

  it("redirects to dashboard when URL was observed and session is now gone", () => {
    // URL was valid earlier, now the session has been killed — safe to redirect.
    expect(
      computeKillRedirect({
        sessionName: "killed-session",
        windowId: "@0",
        currentSessionWindows: null,
        currentWindowExists: false,
        isConnected: true,
        currentWindowEverSeen: true,
      }),
    ).toEqual({ to: "dashboard" });
  });

  it("navigates to the only remaining sibling by windowId", () => {
    const siblings = [{ index: 5, windowId: "@5" }];
    const result = computeKillRedirect({
      sessionName: "my-session",
      windowId: "@0",
      currentSessionWindows: siblings,
      currentWindowExists: false,
      isConnected: true,
    });
    expect(result).toEqual({ to: "window", session: "my-session", windowId: "@5" });
  });
});
