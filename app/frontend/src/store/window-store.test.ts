import { describe, it, expect, beforeEach } from "vitest";
import { useWindowStore } from "./window-store";
import type { WindowInfo } from "@/types";

function makeWindow(overrides: Partial<WindowInfo> & { windowId: string; index: number }): WindowInfo {
  return {
    name: "zsh",
    worktreePath: "/tmp",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    ...overrides,
  };
}

function getStore() {
  return useWindowStore.getState();
}

function resetStore() {
  useWindowStore.setState({ entries: new Map(), ghosts: [] });
}

describe("window-store", () => {
  beforeEach(() => {
    resetStore();
  });

  describe("setWindowsForSession", () => {
    it("adds windows for a session", () => {
      const { setWindowsForSession } = getStore();
      const windows = [
        makeWindow({ windowId: "@0", index: 0, name: "main" }),
        makeWindow({ windowId: "@1", index: 1, name: "dev" }),
      ];
      setWindowsForSession("alpha", windows);

      const entries = useWindowStore.getState().entries;
      expect(entries.size).toBe(2);
      expect(entries.get("@0")?.name).toBe("main");
      expect(entries.get("@1")?.name).toBe("dev");
      expect(entries.get("@0")?.session).toBe("alpha");
    });

    it("replaces windows when session is updated", () => {
      const { setWindowsForSession } = getStore();
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0, name: "old" }),
      ]);

      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@1", index: 0, name: "new" }),
      ]);

      const entries = useWindowStore.getState().entries;
      expect(entries.size).toBe(1);
      expect(entries.has("@0")).toBe(false);
      expect(entries.get("@1")?.name).toBe("new");
    });

    it("preserves pendingName across updates", () => {
      const { setWindowsForSession, renameWindow } = getStore();
      setWindowsForSession("alpha", [makeWindow({ windowId: "@0", index: 0, name: "main" })]);
      renameWindow("alpha", "@0", "renamed");

      // Update from SSE — same window
      setWindowsForSession("alpha", [makeWindow({ windowId: "@0", index: 0, name: "main" })]);

      const entry = useWindowStore.getState().entries.get("@0");
      expect(entry?.pendingName).toBe("renamed");
    });

    it("preserves killed state across updates", () => {
      const { setWindowsForSession, killWindow } = getStore();
      setWindowsForSession("alpha", [makeWindow({ windowId: "@0", index: 0, name: "main" })]);
      killWindow("alpha", "@0");

      setWindowsForSession("alpha", [makeWindow({ windowId: "@0", index: 0, name: "main" })]);

      const entry = useWindowStore.getState().entries.get("@0");
      expect(entry?.killed).toBe(true);
    });

    it("does not affect windows from other sessions", () => {
      const { setWindowsForSession } = getStore();
      setWindowsForSession("alpha", [makeWindow({ windowId: "@0", index: 0 })]);
      setWindowsForSession("beta", [makeWindow({ windowId: "@1", index: 0 })]);

      // Update only alpha
      setWindowsForSession("alpha", [makeWindow({ windowId: "@2", index: 0 })]);

      const entries = useWindowStore.getState().entries;
      expect(entries.has("@1")).toBe(true); // beta window still there
      expect(entries.has("@0")).toBe(false); // old alpha window removed
      expect(entries.has("@2")).toBe(true); // new alpha window added
    });
  });

  describe("addGhostWindow", () => {
    it("adds a ghost window for a session and returns optimisticId", () => {
      const { addGhostWindow } = getStore();
      const id = addGhostWindow("alpha", "new-win");

      const ghosts = useWindowStore.getState().ghosts;
      expect(ghosts).toHaveLength(1);
      expect(ghosts[0].optimisticId).toBe(id);
      expect(ghosts[0].session).toBe("alpha");
      expect(ghosts[0].name).toBe("new-win");
      expect(id).toMatch(/^ghost-win-/);
    });

    it("snapshots current windowIds at ghost creation time", () => {
      const { setWindowsForSession, addGhostWindow } = getStore();
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0 }),
        makeWindow({ windowId: "@1", index: 1 }),
      ]);

      addGhostWindow("alpha", "new-win");

      const ghost = useWindowStore.getState().ghosts[0];
      expect(ghost.snapshotWindowIds.has("@0")).toBe(true);
      expect(ghost.snapshotWindowIds.has("@1")).toBe(true);
    });

    it("snapshot for empty session is empty set", () => {
      const { addGhostWindow } = getStore();
      addGhostWindow("alpha", "new-win");

      const ghost = useWindowStore.getState().ghosts[0];
      expect(ghost.snapshotWindowIds.size).toBe(0);
    });
  });

  describe("killWindow / restoreWindow", () => {
    it("marks a window as killed", () => {
      const { setWindowsForSession, killWindow } = getStore();
      setWindowsForSession("alpha", [makeWindow({ windowId: "@0", index: 0 })]);
      killWindow("alpha", "@0");

      expect(useWindowStore.getState().entries.get("@0")?.killed).toBe(true);
    });

    it("restores a killed window", () => {
      const { setWindowsForSession, killWindow, restoreWindow } = getStore();
      setWindowsForSession("alpha", [makeWindow({ windowId: "@0", index: 0 })]);
      killWindow("alpha", "@0");
      restoreWindow("alpha", "@0");

      expect(useWindowStore.getState().entries.get("@0")?.killed).toBe(false);
    });

    it("no-op when window not found", () => {
      const { killWindow } = getStore();
      expect(() => killWindow("alpha", "@999")).not.toThrow();
    });

    it("no-op when session mismatch", () => {
      const { setWindowsForSession, killWindow } = getStore();
      setWindowsForSession("alpha", [makeWindow({ windowId: "@0", index: 0 })]);
      killWindow("beta", "@0"); // wrong session

      expect(useWindowStore.getState().entries.get("@0")?.killed).toBe(false);
    });
  });

  describe("renameWindow / clearRename", () => {
    it("applies a pending name", () => {
      const { setWindowsForSession, renameWindow } = getStore();
      setWindowsForSession("alpha", [makeWindow({ windowId: "@0", index: 0, name: "main" })]);
      renameWindow("alpha", "@0", "editor");

      expect(useWindowStore.getState().entries.get("@0")?.pendingName).toBe("editor");
    });

    it("clears pending name", () => {
      const { setWindowsForSession, renameWindow, clearRename } = getStore();
      setWindowsForSession("alpha", [makeWindow({ windowId: "@0", index: 0, name: "main" })]);
      renameWindow("alpha", "@0", "editor");
      clearRename("alpha", "@0");

      expect(useWindowStore.getState().entries.get("@0")?.pendingName).toBeUndefined();
    });
  });

  describe("removeGhost", () => {
    it("removes ghost by optimisticId", () => {
      const { addGhostWindow, removeGhost } = getStore();
      const id = addGhostWindow("alpha", "new");
      removeGhost(id);

      expect(useWindowStore.getState().ghosts).toHaveLength(0);
    });

    it("does not remove other ghosts", () => {
      const { addGhostWindow, removeGhost } = getStore();
      const id1 = addGhostWindow("alpha", "win1");
      addGhostWindow("alpha", "win2");
      removeGhost(id1);

      const ghosts = useWindowStore.getState().ghosts;
      expect(ghosts).toHaveLength(1);
      expect(ghosts[0].name).toBe("win2");
    });
  });

  describe("clearSession", () => {
    it("removes all entries and ghosts for a session", () => {
      const { setWindowsForSession, addGhostWindow, clearSession } = getStore();
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0 }),
        makeWindow({ windowId: "@1", index: 1 }),
      ]);
      setWindowsForSession("beta", [makeWindow({ windowId: "@2", index: 0 })]);
      addGhostWindow("alpha", "ghost");

      clearSession("alpha");

      const state = useWindowStore.getState();
      expect(state.entries.has("@0")).toBe(false);
      expect(state.entries.has("@1")).toBe(false);
      expect(state.entries.has("@2")).toBe(true); // beta unaffected
      expect(state.ghosts).toHaveLength(0);
    });
  });

  describe("ghost reconciliation in setWindowsForSession", () => {
    it("claims a ghost when new window arrives (snapshot does not intersect newIds)", () => {
      const { setWindowsForSession, addGhostWindow } = getStore();

      // Session starts with one window
      setWindowsForSession("alpha", [makeWindow({ windowId: "@0", index: 0 })]);

      // Add ghost (snapshot = {@0})
      addGhostWindow("alpha", "new-win");
      expect(useWindowStore.getState().ghosts).toHaveLength(1);

      // New window @1 arrives — @1 not in snapshot, should claim ghost
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0 }),
        makeWindow({ windowId: "@1", index: 1 }),
      ]);

      expect(useWindowStore.getState().ghosts).toHaveLength(0);
    });

    it("does not claim ghost when no new windows arrive", () => {
      const { setWindowsForSession, addGhostWindow } = getStore();

      setWindowsForSession("alpha", [makeWindow({ windowId: "@0", index: 0 })]);
      addGhostWindow("alpha", "new-win");

      // Same windows — no new arrivals
      setWindowsForSession("alpha", [makeWindow({ windowId: "@0", index: 0 })]);

      expect(useWindowStore.getState().ghosts).toHaveLength(1);
    });

    it("claims only one ghost per new window (oldest first)", () => {
      const { setWindowsForSession, addGhostWindow } = getStore();

      setWindowsForSession("alpha", [makeWindow({ windowId: "@0", index: 0 })]);

      // Add two ghosts
      addGhostWindow("alpha", "win1");
      addGhostWindow("alpha", "win2");
      expect(useWindowStore.getState().ghosts).toHaveLength(2);

      // Only one new window arrives — should claim only one ghost
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0 }),
        makeWindow({ windowId: "@1", index: 1 }),
      ]);

      expect(useWindowStore.getState().ghosts).toHaveLength(1);
    });

    it("claims two ghosts when two new windows arrive", () => {
      const { setWindowsForSession, addGhostWindow } = getStore();

      setWindowsForSession("alpha", [makeWindow({ windowId: "@0", index: 0 })]);
      addGhostWindow("alpha", "win1");
      addGhostWindow("alpha", "win2");

      // Two new windows arrive
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0 }),
        makeWindow({ windowId: "@1", index: 1 }),
        makeWindow({ windowId: "@2", index: 2 }),
      ]);

      expect(useWindowStore.getState().ghosts).toHaveLength(0);
    });
  });

  describe("pane sync", () => {
    it("syncs panes from incoming WindowInfo", () => {
      const { setWindowsForSession } = getStore();
      const pane = { paneId: "%5", paneIndex: 0, cwd: "/home/user", command: "zsh", isActive: true };
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0, panes: [pane] }),
      ]);

      const entry = useWindowStore.getState().entries.get("@0");
      expect(entry?.panes).toHaveLength(1);
      expect(entry?.panes[0].paneId).toBe("%5");
      expect(entry?.panes[0].cwd).toBe("/home/user");
      expect(entry?.panes[0].isActive).toBe(true);
    });

    it("defaults panes to [] when WindowInfo.panes is absent", () => {
      const { setWindowsForSession } = getStore();
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0 }), // no panes field
      ]);

      const entry = useWindowStore.getState().entries.get("@0");
      expect(entry?.panes).toEqual([]);
    });

    it("replaces panes on re-sync (no stale data)", () => {
      const { setWindowsForSession } = getStore();
      const pane1 = { paneId: "%5", paneIndex: 0, cwd: "/home/user", command: "zsh", isActive: true };
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0, panes: [pane1] }),
      ]);

      // Second SSE tick with updated CWD
      const pane2 = { paneId: "%5", paneIndex: 0, cwd: "/home/user/code", command: "zsh", isActive: true };
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0, panes: [pane2] }),
      ]);

      const entry = useWindowStore.getState().entries.get("@0");
      expect(entry?.panes[0].cwd).toBe("/home/user/code");
    });

    it("stores multiple panes", () => {
      const { setWindowsForSession } = getStore();
      const panes = [
        { paneId: "%5", paneIndex: 0, cwd: "/home/user", command: "zsh", isActive: true },
        { paneId: "%6", paneIndex: 1, cwd: "/home/user/code", command: "vim", isActive: false },
      ];
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0, panes }),
      ]);

      const entry = useWindowStore.getState().entries.get("@0");
      expect(entry?.panes).toHaveLength(2);
      expect(entry?.panes[1].paneId).toBe("%6");
    });
  });

  describe("swapWindowOrder", () => {
    it("swaps index values of two windows in the same session", () => {
      const { setWindowsForSession, swapWindowOrder } = getStore();
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0, name: "main" }),
        makeWindow({ windowId: "@1", index: 1, name: "dev" }),
        makeWindow({ windowId: "@2", index: 2, name: "logs" }),
      ]);

      swapWindowOrder("alpha", 0, 2);

      const entries = useWindowStore.getState().entries;
      expect(entries.get("@0")?.index).toBe(2);
      expect(entries.get("@2")?.index).toBe(0);
      // Middle window untouched
      expect(entries.get("@1")?.index).toBe(1);
    });

    it("no-op when source entry is missing", () => {
      const { setWindowsForSession, swapWindowOrder } = getStore();
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0, name: "main" }),
      ]);

      swapWindowOrder("alpha", 5, 0);

      const entries = useWindowStore.getState().entries;
      expect(entries.get("@0")?.index).toBe(0);
    });

    it("no-op when destination entry is missing", () => {
      const { setWindowsForSession, swapWindowOrder } = getStore();
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0, name: "main" }),
      ]);

      swapWindowOrder("alpha", 0, 5);

      const entries = useWindowStore.getState().entries;
      expect(entries.get("@0")?.index).toBe(0);
    });

    it("re-swap (rollback) restores original indices", () => {
      const { setWindowsForSession, swapWindowOrder } = getStore();
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0, name: "main" }),
        makeWindow({ windowId: "@1", index: 1, name: "dev" }),
      ]);

      // Forward swap
      swapWindowOrder("alpha", 0, 1);
      expect(useWindowStore.getState().entries.get("@0")?.index).toBe(1);
      expect(useWindowStore.getState().entries.get("@1")?.index).toBe(0);

      // Reverse swap (rollback)
      swapWindowOrder("alpha", 1, 0);
      expect(useWindowStore.getState().entries.get("@0")?.index).toBe(0);
      expect(useWindowStore.getState().entries.get("@1")?.index).toBe(1);
    });

    it("does not affect windows from other sessions", () => {
      const { setWindowsForSession, swapWindowOrder } = getStore();
      setWindowsForSession("alpha", [
        makeWindow({ windowId: "@0", index: 0, name: "main" }),
        makeWindow({ windowId: "@1", index: 1, name: "dev" }),
      ]);
      setWindowsForSession("beta", [
        makeWindow({ windowId: "@2", index: 0, name: "other" }),
      ]);

      swapWindowOrder("alpha", 0, 1);

      expect(useWindowStore.getState().entries.get("@2")?.index).toBe(0);
    });
  });

  describe("core regression: index renumbering after window deletion", () => {
    it("killing @2 does not suppress renumbered @3 that moves to index 1", () => {
      // Regression: the old index-based key `session:1` would suppress the renumbered window
      // at index 1 even though it's a completely different window (@3).
      const { setWindowsForSession, killWindow, restoreWindow } = getStore();

      // Session "dev" starts with three windows
      setWindowsForSession("dev", [
        makeWindow({ windowId: "@1", index: 0, name: "zsh" }),
        makeWindow({ windowId: "@2", index: 1, name: "build" }),
        makeWindow({ windowId: "@3", index: 2, name: "logs" }),
      ]);

      // User kills @2 — optimistic hide
      killWindow("dev", "@2");

      // Verify @2 is hidden
      const afterKill = useWindowStore.getState().entries;
      expect(afterKill.get("@2")?.killed).toBe(true);

      // Simulate API settling — restore marker (onAlwaysSettled)
      restoreWindow("dev", "@2");

      // SSE confirms deletion: @2 is gone, @3 is now at index 1
      setWindowsForSession("dev", [
        makeWindow({ windowId: "@1", index: 0, name: "zsh" }),
        makeWindow({ windowId: "@3", index: 1, name: "logs" }),
      ]);

      const state = useWindowStore.getState();

      // @2 must be fully gone (no lingering kill entry)
      expect(state.entries.has("@2")).toBe(false);

      // @3 must be visible with correct name — the critical assertion
      const entry3 = state.entries.get("@3");
      expect(entry3).toBeDefined();
      expect(entry3?.killed).toBe(false);
      expect(entry3?.name).toBe("logs");
      expect(entry3?.index).toBe(1);

      // @1 still present
      expect(state.entries.get("@1")?.name).toBe("zsh");
    });
  });
});
