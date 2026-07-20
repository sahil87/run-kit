import { describe, it, expect } from "vitest";
import { resolveFocusedWindow, thinWindowFromFocusedPane } from "./focused-pane-window";
import type { ProjectSession, WindowInfo } from "@/types";
import type { FocusedPane } from "@/contexts/focused-pane-context";

function win(windowId: string, name: string, extra?: Partial<WindowInfo>): WindowInfo {
  return {
    windowId,
    index: 0,
    name,
    worktreePath: "/home/u/code/x",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 100,
    ...extra,
  };
}

const SESSIONS: ProjectSession[] = [
  { name: "alpha", windows: [win("@1", "one"), win("@2", "two")] },
  { name: "beta", windows: [win("@7", "seven", { fabChange: "260720-zx4i-x" })] },
];

describe("resolveFocusedWindow", () => {
  it("finds a window by windowId in the first session", () => {
    expect(resolveFocusedWindow(SESSIONS, "@2")?.name).toBe("two");
  });

  it("finds a window across sessions (enriched copy intact)", () => {
    const found = resolveFocusedWindow(SESSIONS, "@7");
    expect(found?.name).toBe("seven");
    expect(found?.fabChange).toBe("260720-zx4i-x");
  });

  it("returns null on a miss (pin-only window)", () => {
    expect(resolveFocusedWindow(SESSIONS, "@99")).toBeNull();
  });

  it("returns null for an empty session list", () => {
    expect(resolveFocusedWindow([], "@1")).toBeNull();
  });
});

describe("thinWindowFromFocusedPane", () => {
  const focused: NonNullable<FocusedPane> = {
    server: "rk",
    windowId: "@42",
    windowName: "pinned-win",
    panes: [
      { paneId: "%9", paneIndex: 0, cwd: "/srv/a", command: "vim", isActive: false },
      {
        paneId: "%10",
        paneIndex: 1,
        cwd: "/srv/b",
        command: "zsh",
        isActive: true,
        gitBranch: "main",
      },
    ],
  };

  it("maps identity + panes and takes the ACTIVE pane's cwd as worktreePath", () => {
    const w = thinWindowFromFocusedPane(focused);
    expect(w.windowId).toBe("@42");
    expect(w.name).toBe("pinned-win");
    expect(w.worktreePath).toBe("/srv/b");
    expect(w.panes).toHaveLength(2);
    expect(w.panes?.[1].gitBranch).toBe("main");
  });

  it("uses activityTimestamp 0 so the out register shows no fabricated idle duration", () => {
    const w = thinWindowFromFocusedPane(focused);
    expect(w.activityTimestamp).toBe(0);
    expect(w.activity).toBe("idle");
  });

  it("leaves enrichment-only registers absent (agt/fab/PR honestly unknown)", () => {
    const w = thinWindowFromFocusedPane(focused);
    expect(w.agentState).toBeUndefined();
    expect(w.fabChange).toBeUndefined();
    expect(w.prNumber).toBeUndefined();
  });

  it("falls back to the first pane when none is active", () => {
    const w = thinWindowFromFocusedPane({
      ...focused,
      panes: focused.panes.map((p) => ({ ...p, isActive: false })),
    });
    expect(w.worktreePath).toBe("/srv/a");
  });

  it("handles an empty panes list (windowId fallback name, empty worktreePath)", () => {
    const w = thinWindowFromFocusedPane({
      server: "rk",
      windowId: "@5",
      windowName: "",
      panes: [],
    });
    expect(w.name).toBe("@5");
    expect(w.worktreePath).toBe("");
    expect(w.panes).toEqual([]);
  });
});
