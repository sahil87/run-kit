import { describe, expect, it } from "vitest";
import { cycleWindowTarget, sessionJumpTarget, type CycleSession } from "./window-cycle";

function win(id: string, active = false) {
  return { windowId: id, isActiveWindow: active };
}

function session(...windows: { windowId: string; isActiveWindow: boolean }[]): CycleSession {
  return { windows };
}

// Two-session fixture: A (a1, a2) then B (b1) in sidebar order — b1 active.
const A_B = [session(win("a1"), win("a2")), session(win("b1", true))];

describe("cycleWindowTarget — flattened cross-session step", () => {
  it("steps one row within a session", () => {
    expect(cycleWindowTarget(A_B, "a1", 1)).toBe("a2");
  });

  it("crosses a session boundary to the adjacent session's edge window", () => {
    // Down from A's last window lands on B's first; up from B's first lands on A's last.
    expect(cycleWindowTarget(A_B, "a2", 1)).toBe("b1");
    expect(cycleWindowTarget(A_B, "b1", -1)).toBe("a2");
  });

  it("wraps at both ends of the flattened list", () => {
    expect(cycleWindowTarget(A_B, "b1", 1)).toBe("a1");
    expect(cycleWindowTarget(A_B, "a1", -1)).toBe("b1");
  });

  it("single-session shape cycles its windows with wraparound", () => {
    const solo = [session(win("w1"), win("w2"))];
    expect(cycleWindowTarget(solo, "w1", 1)).toBe("w2");
    expect(cycleWindowTarget(solo, "w2", 1)).toBe("w1");
    expect(cycleWindowTarget(solo, "w1", -1)).toBe("w2");
  });

  it("single-window shape stays put", () => {
    expect(cycleWindowTarget([session(win("only"))], "only", 1)).toBe("only");
  });

  it("resolves null when the current window is missing or nothing is mounted", () => {
    expect(cycleWindowTarget(A_B, null, 1)).toBeNull();
    expect(cycleWindowTarget(A_B, undefined, 1)).toBeNull();
    expect(cycleWindowTarget(A_B, "ghost", 1)).toBeNull();
    expect(cycleWindowTarget([], "a1", 1)).toBeNull();
    expect(cycleWindowTarget([session()], "a1", 1)).toBeNull();
  });
});

describe("sessionJumpTarget — adjacent-session hop to the active window", () => {
  it("jumps to the adjacent session's tmux-active window, not its first row", () => {
    const sessions = [session(win("a1"), win("a2", true)), session(win("b1", true))];
    // From any window of A, next lands on b1 (B's active window).
    expect(sessionJumpTarget(sessions, "a1", 1)).toBe("b1");
    // From B, next wraps to A's ACTIVE window a2 (not first-in-sidebar a1).
    expect(sessionJumpTarget(sessions, "b1", 1)).toBe("a2");
    expect(sessionJumpTarget(sessions, "b1", -1)).toBe("a2");
  });

  it("falls back to the target session's first window when no window is active (stale SSE)", () => {
    const sessions = [session(win("a1", true)), session(win("b1"), win("b2"))];
    expect(sessionJumpTarget(sessions, "a1", 1)).toBe("b1");
  });

  it("resolves null in a single-session shape (nothing to jump to)", () => {
    const solo = [session(win("w1"), win("w2"))];
    expect(sessionJumpTarget(solo, "w1", 1)).toBeNull();
    expect(sessionJumpTarget(solo, "w1", -1)).toBeNull();
  });

  it("skips windowless sessions — they never join the jump ring", () => {
    const sessions = [session(win("a1", true)), session(), session(win("b1", true))];
    expect(sessionJumpTarget(sessions, "a1", 1)).toBe("b1");
    expect(sessionJumpTarget(sessions, "b1", -1)).toBe("a1");
  });

  it("resolves null when the current window is missing or resolves to no session", () => {
    expect(sessionJumpTarget(A_B, null, 1)).toBeNull();
    expect(sessionJumpTarget(A_B, undefined, 1)).toBeNull();
    expect(sessionJumpTarget(A_B, "ghost", 1)).toBeNull();
    expect(sessionJumpTarget([], "a1", 1)).toBeNull();
  });
});
