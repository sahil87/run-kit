import { describe, it, expect, beforeEach } from "vitest";
import { useWindowStore, entryKey } from "./window-store";
import type { WindowInfo } from "@/types";

const SRV = "test";

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

/** Read an entry by (server, windowId) — wraps the composite-key lookup. */
function get(server: string, windowId: string) {
  return useWindowStore.getState().entries.get(entryKey(server, windowId));
}
function has(server: string, windowId: string) {
  return useWindowStore.getState().entries.has(entryKey(server, windowId));
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
      setWindowsForSession(SRV, "alpha", windows);

      const entries = useWindowStore.getState().entries;
      expect(entries.size).toBe(2);
      expect(get(SRV, "@0")?.name).toBe("main");
      expect(get(SRV, "@1")?.name).toBe("dev");
      expect(get(SRV, "@0")?.session).toBe("alpha");
      expect(get(SRV, "@0")?.server).toBe(SRV);
    });

    it("replaces windows when session is updated", () => {
      const { setWindowsForSession } = getStore();
      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@0", index: 0, name: "old" }),
      ]);

      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@1", index: 0, name: "new" }),
      ]);

      const entries = useWindowStore.getState().entries;
      expect(entries.size).toBe(1);
      expect(has(SRV, "@0")).toBe(false);
      expect(get(SRV, "@1")?.name).toBe("new");
    });

    it("preserves pendingName across updates", () => {
      const { setWindowsForSession, renameWindow } = getStore();
      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@0", index: 0, name: "main" })]);
      renameWindow(SRV, "alpha", "@0", "renamed");

      // Update from SSE — same window
      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@0", index: 0, name: "main" })]);

      expect(get(SRV, "@0")?.pendingName).toBe("renamed");
    });

    it("preserves killed state across updates", () => {
      const { setWindowsForSession, killWindow } = getStore();
      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@0", index: 0, name: "main" })]);
      killWindow(SRV, "alpha", "@0");

      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@0", index: 0, name: "main" })]);

      expect(get(SRV, "@0")?.killed).toBe(true);
    });

    it("does not affect windows from other sessions", () => {
      const { setWindowsForSession } = getStore();
      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@0", index: 0 })]);
      setWindowsForSession(SRV, "beta", [makeWindow({ windowId: "@1", index: 0 })]);

      // Update only alpha
      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@2", index: 0 })]);

      expect(has(SRV, "@1")).toBe(true); // beta window still there
      expect(has(SRV, "@0")).toBe(false); // old alpha window removed
      expect(has(SRV, "@2")).toBe(true); // new alpha window added
    });
  });

  describe("multi-server isolation", () => {
    // tmux windowIds (`@1`, `@2`, ...) are unique per server only. Two
    // tmux servers can each have a window `@1` belonging to identically
    // named sessions. The store MUST keep them separate.

    it("does not let server B overwrite server A's identically-id'd window", () => {
      const { setWindowsForSession } = getStore();
      setWindowsForSession("a", "loom", [makeWindow({ windowId: "@1", index: 0, name: "wd-api" })]);
      setWindowsForSession("b", "0", [makeWindow({ windowId: "@1", index: 0, name: "zsh" })]);

      expect(get("a", "@1")?.name).toBe("wd-api");
      expect(get("b", "@1")?.name).toBe("zsh");
      expect(useWindowStore.getState().entries.size).toBe(2);
    });

    it("clearSession on one server does not touch the other", () => {
      const { setWindowsForSession, clearSession } = getStore();
      setWindowsForSession("a", "x", [makeWindow({ windowId: "@1", index: 0 })]);
      setWindowsForSession("b", "x", [makeWindow({ windowId: "@1", index: 0 })]);

      clearSession("a", "x");

      expect(has("a", "@1")).toBe(false);
      expect(has("b", "@1")).toBe(true);
    });

    it("killWindow for the wrong server is a no-op", () => {
      const { setWindowsForSession, killWindow } = getStore();
      setWindowsForSession("a", "x", [makeWindow({ windowId: "@1", index: 0 })]);

      killWindow("b", "x", "@1"); // wrong server

      expect(get("a", "@1")?.killed).toBe(false);
    });

    it("renameWindow for the wrong server is a no-op", () => {
      const { setWindowsForSession, renameWindow } = getStore();
      setWindowsForSession("a", "x", [makeWindow({ windowId: "@1", index: 0, name: "orig" })]);

      renameWindow("b", "x", "@1", "wrong"); // wrong server

      expect(get("a", "@1")?.pendingName).toBeUndefined();
    });

    it("setWindowsForSession on server A does not delete server B's same-name session entries", () => {
      // The bug we just fixed: server B's SSE tick was clearing server A's
      // entries because the prior-known sweep was scoped only by session name.
      const { setWindowsForSession } = getStore();
      setWindowsForSession("a", "0", [
        makeWindow({ windowId: "@1", index: 0, name: "a-win" }),
      ]);
      setWindowsForSession("b", "0", [
        makeWindow({ windowId: "@1", index: 0, name: "b-win" }),
      ]);

      // Re-tick server A — server B's "0" session must remain untouched.
      setWindowsForSession("a", "0", [
        makeWindow({ windowId: "@1", index: 0, name: "a-win" }),
      ]);

      expect(get("a", "@1")?.name).toBe("a-win");
      expect(get("b", "@1")?.name).toBe("b-win");
    });
  });

  describe("addGhostWindow", () => {
    it("adds a ghost window for a session and returns optimisticId", () => {
      const { addGhostWindow } = getStore();
      const id = addGhostWindow(SRV, "alpha", "new-win");

      const ghosts = useWindowStore.getState().ghosts;
      expect(ghosts).toHaveLength(1);
      expect(ghosts[0].optimisticId).toBe(id);
      expect(ghosts[0].server).toBe(SRV);
      expect(ghosts[0].session).toBe("alpha");
      expect(ghosts[0].name).toBe("new-win");
      expect(id).toMatch(/^ghost-win-/);
    });

    it("snapshots current windowIds at ghost creation time (server-scoped)", () => {
      const { setWindowsForSession, addGhostWindow } = getStore();
      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@0", index: 0 }),
        makeWindow({ windowId: "@1", index: 1 }),
      ]);
      // Same windowIds on a different server must NOT leak into the snapshot.
      setWindowsForSession("other", "alpha", [
        makeWindow({ windowId: "@5", index: 0 }),
      ]);

      addGhostWindow(SRV, "alpha", "new-win");

      const ghost = useWindowStore.getState().ghosts[0];
      expect(ghost.snapshotWindowIds.has("@0")).toBe(true);
      expect(ghost.snapshotWindowIds.has("@1")).toBe(true);
      expect(ghost.snapshotWindowIds.has("@5")).toBe(false);
    });

    it("snapshot for empty session is empty set", () => {
      const { addGhostWindow } = getStore();
      addGhostWindow(SRV, "alpha", "new-win");

      const ghost = useWindowStore.getState().ghosts[0];
      expect(ghost.snapshotWindowIds.size).toBe(0);
    });
  });

  describe("killWindow / restoreWindow", () => {
    it("marks a window as killed", () => {
      const { setWindowsForSession, killWindow } = getStore();
      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@0", index: 0 })]);
      killWindow(SRV, "alpha", "@0");

      expect(get(SRV, "@0")?.killed).toBe(true);
    });

    it("restores a killed window", () => {
      const { setWindowsForSession, killWindow, restoreWindow } = getStore();
      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@0", index: 0 })]);
      killWindow(SRV, "alpha", "@0");
      restoreWindow(SRV, "alpha", "@0");

      expect(get(SRV, "@0")?.killed).toBe(false);
    });

    it("no-op when window not found", () => {
      const { killWindow } = getStore();
      expect(() => killWindow(SRV, "alpha", "@999")).not.toThrow();
    });

    it("no-op when session mismatch", () => {
      const { setWindowsForSession, killWindow } = getStore();
      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@0", index: 0 })]);
      killWindow(SRV, "beta", "@0"); // wrong session

      expect(get(SRV, "@0")?.killed).toBe(false);
    });
  });

  describe("renameWindow / clearRename", () => {
    it("applies a pending name", () => {
      const { setWindowsForSession, renameWindow } = getStore();
      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@0", index: 0, name: "main" })]);
      renameWindow(SRV, "alpha", "@0", "editor");

      expect(get(SRV, "@0")?.pendingName).toBe("editor");
    });

    it("clears pending name", () => {
      const { setWindowsForSession, renameWindow, clearRename } = getStore();
      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@0", index: 0, name: "main" })]);
      renameWindow(SRV, "alpha", "@0", "editor");
      clearRename(SRV, "alpha", "@0");

      expect(get(SRV, "@0")?.pendingName).toBeUndefined();
    });
  });

  describe("removeGhost", () => {
    it("removes ghost by optimisticId", () => {
      const { addGhostWindow, removeGhost } = getStore();
      const id = addGhostWindow(SRV, "alpha", "new");
      removeGhost(id);

      expect(useWindowStore.getState().ghosts).toHaveLength(0);
    });

    it("does not remove other ghosts", () => {
      const { addGhostWindow, removeGhost } = getStore();
      const id1 = addGhostWindow(SRV, "alpha", "win1");
      addGhostWindow(SRV, "alpha", "win2");
      removeGhost(id1);

      const ghosts = useWindowStore.getState().ghosts;
      expect(ghosts).toHaveLength(1);
      expect(ghosts[0].name).toBe("win2");
    });
  });

  describe("clearSession", () => {
    it("removes all entries and ghosts for a (server, session)", () => {
      const { setWindowsForSession, addGhostWindow, clearSession } = getStore();
      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@0", index: 0 }),
        makeWindow({ windowId: "@1", index: 1 }),
      ]);
      setWindowsForSession(SRV, "beta", [makeWindow({ windowId: "@2", index: 0 })]);
      addGhostWindow(SRV, "alpha", "ghost");

      clearSession(SRV, "alpha");

      expect(has(SRV, "@0")).toBe(false);
      expect(has(SRV, "@1")).toBe(false);
      expect(has(SRV, "@2")).toBe(true); // beta unaffected
      expect(useWindowStore.getState().ghosts).toHaveLength(0);
    });
  });

  describe("ghost reconciliation in setWindowsForSession", () => {
    it("claims a ghost when new window arrives (snapshot does not intersect newIds)", () => {
      const { setWindowsForSession, addGhostWindow } = getStore();

      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@0", index: 0 })]);

      addGhostWindow(SRV, "alpha", "new-win");
      expect(useWindowStore.getState().ghosts).toHaveLength(1);

      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@0", index: 0 }),
        makeWindow({ windowId: "@1", index: 1 }),
      ]);

      expect(useWindowStore.getState().ghosts).toHaveLength(0);
    });

    it("does not claim ghost when no new windows arrive", () => {
      const { setWindowsForSession, addGhostWindow } = getStore();

      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@0", index: 0 })]);
      addGhostWindow(SRV, "alpha", "new-win");

      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@0", index: 0 })]);

      expect(useWindowStore.getState().ghosts).toHaveLength(1);
    });

    it("claims only one ghost per new window (oldest first)", () => {
      const { setWindowsForSession, addGhostWindow } = getStore();

      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@0", index: 0 })]);

      addGhostWindow(SRV, "alpha", "win1");
      addGhostWindow(SRV, "alpha", "win2");
      expect(useWindowStore.getState().ghosts).toHaveLength(2);

      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@0", index: 0 }),
        makeWindow({ windowId: "@1", index: 1 }),
      ]);

      expect(useWindowStore.getState().ghosts).toHaveLength(1);
    });

    it("claims two ghosts when two new windows arrive", () => {
      const { setWindowsForSession, addGhostWindow } = getStore();

      setWindowsForSession(SRV, "alpha", [makeWindow({ windowId: "@0", index: 0 })]);
      addGhostWindow(SRV, "alpha", "win1");
      addGhostWindow(SRV, "alpha", "win2");

      setWindowsForSession(SRV, "alpha", [
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
      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@0", index: 0, panes: [pane] }),
      ]);

      const entry = get(SRV, "@0");
      expect(entry?.panes).toHaveLength(1);
      expect(entry?.panes[0].paneId).toBe("%5");
      expect(entry?.panes[0].cwd).toBe("/home/user");
      expect(entry?.panes[0].isActive).toBe(true);
    });

    it("defaults panes to [] when WindowInfo.panes is absent", () => {
      const { setWindowsForSession } = getStore();
      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@0", index: 0 }), // no panes field
      ]);

      expect(get(SRV, "@0")?.panes).toEqual([]);
    });

    it("replaces panes on re-sync (no stale data)", () => {
      const { setWindowsForSession } = getStore();
      const pane1 = { paneId: "%5", paneIndex: 0, cwd: "/home/user", command: "zsh", isActive: true };
      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@0", index: 0, panes: [pane1] }),
      ]);

      const pane2 = { paneId: "%5", paneIndex: 0, cwd: "/home/user/code", command: "zsh", isActive: true };
      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@0", index: 0, panes: [pane2] }),
      ]);

      expect(get(SRV, "@0")?.panes[0].cwd).toBe("/home/user/code");
    });

    it("stores multiple panes", () => {
      const { setWindowsForSession } = getStore();
      const panes = [
        { paneId: "%5", paneIndex: 0, cwd: "/home/user", command: "zsh", isActive: true },
        { paneId: "%6", paneIndex: 1, cwd: "/home/user/code", command: "vim", isActive: false },
      ];
      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@0", index: 0, panes }),
      ]);

      const entry = get(SRV, "@0");
      expect(entry?.panes).toHaveLength(2);
      expect(entry?.panes[1].paneId).toBe("%6");
    });
  });

  describe("moveWindowOrder", () => {
    it("moves window forward (insert before): [a b c d] move 0→2 gives [b a c d]", () => {
      const { setWindowsForSession, moveWindowOrder } = getStore();
      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@0", index: 0, name: "a" }),
        makeWindow({ windowId: "@1", index: 1, name: "b" }),
        makeWindow({ windowId: "@2", index: 2, name: "c" }),
        makeWindow({ windowId: "@3", index: 3, name: "d" }),
      ]);

      moveWindowOrder(SRV, "alpha", 0, 2);

      expect(get(SRV, "@1")?.index).toBe(0); // b shifted left
      expect(get(SRV, "@0")?.index).toBe(1); // a inserted before c
      expect(get(SRV, "@2")?.index).toBe(2); // c unchanged
      expect(get(SRV, "@3")?.index).toBe(3); // d unchanged
    });

    it("moves window backward: [a b c d] move 3→1 gives [a d b c]", () => {
      const { setWindowsForSession, moveWindowOrder } = getStore();
      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@0", index: 0, name: "a" }),
        makeWindow({ windowId: "@1", index: 1, name: "b" }),
        makeWindow({ windowId: "@2", index: 2, name: "c" }),
        makeWindow({ windowId: "@3", index: 3, name: "d" }),
      ]);

      moveWindowOrder(SRV, "alpha", 3, 1);

      expect(get(SRV, "@0")?.index).toBe(0); // a unchanged
      expect(get(SRV, "@3")?.index).toBe(1); // d took b's slot
      expect(get(SRV, "@1")?.index).toBe(2); // b shifted right
      expect(get(SRV, "@2")?.index).toBe(3); // c shifted right
    });

    it("no-op when source entry is missing", () => {
      const { setWindowsForSession, moveWindowOrder } = getStore();
      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@0", index: 0, name: "main" }),
      ]);

      moveWindowOrder(SRV, "alpha", 5, 0);

      expect(get(SRV, "@0")?.index).toBe(0);
    });

    it("no-op when destination entry is missing", () => {
      const { setWindowsForSession, moveWindowOrder } = getStore();
      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@0", index: 0, name: "main" }),
      ]);

      moveWindowOrder(SRV, "alpha", 0, 5);

      expect(get(SRV, "@0")?.index).toBe(0);
    });

    it("does not affect windows from other sessions", () => {
      const { setWindowsForSession, moveWindowOrder } = getStore();
      setWindowsForSession(SRV, "alpha", [
        makeWindow({ windowId: "@0", index: 0, name: "main" }),
        makeWindow({ windowId: "@1", index: 1, name: "dev" }),
      ]);
      setWindowsForSession(SRV, "beta", [
        makeWindow({ windowId: "@2", index: 0, name: "other" }),
      ]);

      moveWindowOrder(SRV, "alpha", 0, 1);

      expect(get(SRV, "@2")?.index).toBe(0);
    });
  });

  describe("core regression: index renumbering after window deletion", () => {
    it("killing @2 does not suppress renumbered @3 that moves to index 1", () => {
      const { setWindowsForSession, killWindow, restoreWindow } = getStore();

      setWindowsForSession(SRV, "dev", [
        makeWindow({ windowId: "@1", index: 0, name: "zsh" }),
        makeWindow({ windowId: "@2", index: 1, name: "build" }),
        makeWindow({ windowId: "@3", index: 2, name: "logs" }),
      ]);

      killWindow(SRV, "dev", "@2");
      expect(get(SRV, "@2")?.killed).toBe(true);

      restoreWindow(SRV, "dev", "@2");

      // SSE confirms deletion: @2 is gone, @3 is now at index 1
      setWindowsForSession(SRV, "dev", [
        makeWindow({ windowId: "@1", index: 0, name: "zsh" }),
        makeWindow({ windowId: "@3", index: 1, name: "logs" }),
      ]);

      // @2 must be fully gone (no lingering kill entry)
      expect(has(SRV, "@2")).toBe(false);

      // @3 must be visible with correct name — the critical assertion
      const entry3 = get(SRV, "@3");
      expect(entry3).toBeDefined();
      expect(entry3?.killed).toBe(false);
      expect(entry3?.name).toBe("logs");
      expect(entry3?.index).toBe(1);

      // @1 still present
      expect(get(SRV, "@1")?.name).toBe("zsh");
    });
  });
});
