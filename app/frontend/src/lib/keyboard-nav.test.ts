import { describe, it, expect } from "vitest";
import { resolveWindowCycle, resolveSessionCycle, realWindows } from "./keyboard-nav";
import type { NavWindow, NavSession } from "./keyboard-nav";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function win(index: number, optimistic = false): NavWindow {
  return { index, ...(optimistic ? { optimistic: true } : {}) };
}

function session(name: string, windows: NavWindow[], optimistic = false): NavSession {
  return { name, windows, ...(optimistic ? { optimistic: true } : {}) };
}

// ---------------------------------------------------------------------------
// realWindows
// ---------------------------------------------------------------------------

describe("realWindows", () => {
  it("excludes ghost windows (index -1)", () => {
    expect(realWindows([win(0), win(-1, true), win(1)])).toEqual([win(0), win(1)]);
  });

  it("excludes optimistic windows even when index > 0", () => {
    expect(realWindows([win(0), win(2, true)])).toEqual([win(0)]);
  });

  it("sorts ascending by index", () => {
    const result = realWindows([win(2), win(0), win(1)]);
    expect(result.map((w) => w.index)).toEqual([0, 1, 2]);
  });

  it("returns empty array when all windows are ghosts", () => {
    expect(realWindows([win(-1, true), win(-1, true)])).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(realWindows([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveWindowCycle — normal cycling
// ---------------------------------------------------------------------------

describe("resolveWindowCycle — normal cycling", () => {
  const windows = [win(0), win(1), win(2)];

  it("down from first wraps to index 0 → 1", () => {
    expect(resolveWindowCycle(windows, "0", "down")).toBe(1);
  });

  it("down from middle advances 1 → 2", () => {
    expect(resolveWindowCycle(windows, "1", "down")).toBe(2);
  });

  it("down from last wraps to first", () => {
    expect(resolveWindowCycle(windows, "2", "down")).toBe(0);
  });

  it("up from last goes to 2 → 1", () => {
    expect(resolveWindowCycle(windows, "2", "up")).toBe(1);
  });

  it("up from middle goes to 1 → 0", () => {
    expect(resolveWindowCycle(windows, "1", "up")).toBe(0);
  });

  it("up from first wraps to last", () => {
    expect(resolveWindowCycle(windows, "0", "up")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// resolveWindowCycle — ghost window scenarios (the original bug)
// ---------------------------------------------------------------------------

describe("resolveWindowCycle — ghost windows are ignored", () => {
  it("ghost window does not become a navigation target (down)", () => {
    // User is on window 0; window 1 is a confirmed window; ghost has index -1.
    const windows = [win(0), win(1), win(-1, true)];
    expect(resolveWindowCycle(windows, "0", "down")).toBe(1);
  });

  it("ghost window does not become a navigation target (up)", () => {
    const windows = [win(0), win(1), win(-1, true)];
    expect(resolveWindowCycle(windows, "1", "up")).toBe(0);
  });

  it("does not navigate to index -1 ever", () => {
    const windows = [win(0), win(-1, true)];
    // Only one confirmed window — should be null, not -1
    expect(resolveWindowCycle(windows, "0", "down")).toBeNull();
  });

  it("newly created window arrives (ghost gone, two real windows) — cycles correctly", () => {
    // After SSE reconciles: ghost removed, real window at index 1 appears
    const windows = [win(0), win(1)];
    expect(resolveWindowCycle(windows, "1", "up")).toBe(0);
    expect(resolveWindowCycle(windows, "0", "down")).toBe(1);
  });

  it("session with only ghost windows returns null", () => {
    const windows = [win(-1, true), win(-1, true)];
    expect(resolveWindowCycle(windows, "0", "down")).toBeNull();
  });

  it("optimistic window with positive index is also excluded", () => {
    const windows = [win(0), win(1, true)];
    expect(resolveWindowCycle(windows, "0", "down")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveWindowCycle — edge cases
// ---------------------------------------------------------------------------

describe("resolveWindowCycle — edge cases", () => {
  it("returns null when there is only one confirmed window", () => {
    expect(resolveWindowCycle([win(0)], "0", "down")).toBeNull();
  });

  it("returns null when window list is empty", () => {
    expect(resolveWindowCycle([], "0", "down")).toBeNull();
  });

  it("returns null when currentWindowIndex is undefined", () => {
    expect(resolveWindowCycle([win(0), win(1)], undefined, "down")).toBeNull();
  });

  it("returns null when currentWindowIndex does not match any real window", () => {
    // URL is still pointing at '-1' (ghost window URL) — should not crash
    expect(resolveWindowCycle([win(0), win(1)], "-1", "down")).toBeNull();
  });

  it("returns null when currentWindowIndex is an unknown index", () => {
    expect(resolveWindowCycle([win(0), win(1)], "99", "down")).toBeNull();
  });

  it("handles non-contiguous indices correctly", () => {
    // tmux can produce gaps: 0, 2, 5
    const windows = [win(5), win(0), win(2)];
    expect(resolveWindowCycle(windows, "0", "down")).toBe(2);
    expect(resolveWindowCycle(windows, "2", "down")).toBe(5);
    expect(resolveWindowCycle(windows, "5", "down")).toBe(0);
  });

  it("two windows cycle back and forth (down)", () => {
    const windows = [win(0), win(1)];
    expect(resolveWindowCycle(windows, "0", "down")).toBe(1);
    expect(resolveWindowCycle(windows, "1", "down")).toBe(0);
  });

  it("two windows cycle back and forth (up)", () => {
    const windows = [win(0), win(1)];
    expect(resolveWindowCycle(windows, "0", "up")).toBe(1);
    expect(resolveWindowCycle(windows, "1", "up")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveSessionCycle — normal cycling
// ---------------------------------------------------------------------------

describe("resolveSessionCycle — normal cycling", () => {
  const sessions = [
    session("alpha", [win(0)]),
    session("bravo", [win(0)]),
    session("charlie", [win(0)]),
  ];

  it("right from first moves to second session", () => {
    const result = resolveSessionCycle(sessions, "alpha", "right");
    expect(result).toEqual({ session: "bravo", windowIndex: 0 });
  });

  it("right from last wraps to first", () => {
    const result = resolveSessionCycle(sessions, "charlie", "right");
    expect(result).toEqual({ session: "alpha", windowIndex: 0 });
  });

  it("left from last moves to second", () => {
    const result = resolveSessionCycle(sessions, "charlie", "left");
    expect(result).toEqual({ session: "bravo", windowIndex: 0 });
  });

  it("left from first wraps to last", () => {
    const result = resolveSessionCycle(sessions, "alpha", "left");
    expect(result).toEqual({ session: "charlie", windowIndex: 0 });
  });

  it("navigates to first real window of target session (not index 0 if gap)", () => {
    const sessions = [
      session("alpha", [win(0)]),
      session("bravo", [win(2), win(5)]),
    ];
    const result = resolveSessionCycle(sessions, "alpha", "right");
    expect(result).toEqual({ session: "bravo", windowIndex: 2 });
  });
});

// ---------------------------------------------------------------------------
// resolveSessionCycle — ghost sessions and ghost windows
// ---------------------------------------------------------------------------

describe("resolveSessionCycle — ghost sessions are ignored", () => {
  it("ghost session is not a navigation target", () => {
    const sessions = [
      session("alpha", [win(0)]),
      session("ghost-session", [win(0)], true),
      session("bravo", [win(0)]),
    ];
    // right from alpha should skip the ghost and go to bravo
    expect(resolveSessionCycle(sessions, "alpha", "right")).toEqual({
      session: "bravo",
      windowIndex: 0,
    });
  });

  it("session with only ghost windows is not navigable", () => {
    const sessions = [
      session("alpha", [win(0)]),
      session("bravo", [win(-1, true)]),  // only a ghost window
      session("charlie", [win(0)]),
    ];
    // bravo should be skipped — it has no confirmed windows
    expect(resolveSessionCycle(sessions, "alpha", "right")).toEqual({
      session: "charlie",
      windowIndex: 0,
    });
  });

  it("newly created session (ghost) does not become a navigation target", () => {
    const sessions = [
      session("alpha", [win(0)]),
      session("new-session", [], true),
    ];
    // Only one navigable session — null
    expect(resolveSessionCycle(sessions, "alpha", "right")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveSessionCycle — edge cases
// ---------------------------------------------------------------------------

describe("resolveSessionCycle — edge cases", () => {
  it("returns null when only one navigable session exists", () => {
    expect(
      resolveSessionCycle([session("alpha", [win(0)])], "alpha", "right"),
    ).toBeNull();
  });

  it("returns null when session list is empty", () => {
    expect(resolveSessionCycle([], "alpha", "right")).toBeNull();
  });

  it("returns null when currentSession is undefined", () => {
    const sessions = [session("alpha", [win(0)]), session("bravo", [win(0)])];
    expect(resolveSessionCycle(sessions, undefined, "right")).toBeNull();
  });

  it("returns null when currentSession is not in the navigable list", () => {
    const sessions = [session("alpha", [win(0)]), session("bravo", [win(0)])];
    expect(resolveSessionCycle(sessions, "unknown", "right")).toBeNull();
  });

  it("two sessions wrap in both directions", () => {
    const sessions = [session("alpha", [win(0)]), session("bravo", [win(0)])];
    expect(resolveSessionCycle(sessions, "alpha", "right")).toEqual({
      session: "bravo",
      windowIndex: 0,
    });
    expect(resolveSessionCycle(sessions, "bravo", "right")).toEqual({
      session: "alpha",
      windowIndex: 0,
    });
    expect(resolveSessionCycle(sessions, "alpha", "left")).toEqual({
      session: "bravo",
      windowIndex: 0,
    });
    expect(resolveSessionCycle(sessions, "bravo", "left")).toEqual({
      session: "alpha",
      windowIndex: 0,
    });
  });
});
