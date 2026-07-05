import { describe, it, expect } from "vitest";
import {
  deriveEffectiveSessionOrder,
  computeMoveOrder,
  computeWindowMoveTarget,
} from "./palette-move";

// These helpers back the six command-palette Move up/down actions
// (Server / Session / Window). app.tsx calls them directly, so covering the
// order arithmetic + boundary gating here proves the actions' behavior without
// mounting the whole shell.

describe("deriveEffectiveSessionOrder (Session: Move effective order)", () => {
  it("uses the persisted SSE order filtered to live sessions", () => {
    // SSE order [c, a, b]; all three live → effective order follows SSE order.
    expect(deriveEffectiveSessionOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("drops persisted names that are no longer live", () => {
    // "gone" is in the persisted order but not live → filtered out.
    expect(
      deriveEffectiveSessionOrder(["a", "b"], ["gone", "b", "a"]),
    ).toEqual(["b", "a"]);
  });

  it("appends live sessions missing from the persisted order in natural order", () => {
    // "b" and "c" are live but un-ordered → appended after the ordered "a" in
    // their natural (liveNames) order.
    expect(deriveEffectiveSessionOrder(["a", "b", "c"], ["a"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("with no persisted order returns the natural order unchanged", () => {
    expect(deriveEffectiveSessionOrder(["a", "b", "c"], [])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("computeMoveOrder (Server / Session: Move up/down swap)", () => {
  it("moves an element up one position (delta -1)", () => {
    // Move "b" (idx 1) up → [b, a, c].
    expect(computeMoveOrder(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
  });

  it("moves an element down one position (delta +1)", () => {
    // Move "b" (idx 1) down → [a, c, b].
    expect(computeMoveOrder(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("moves the first element down (idx 0, delta +1)", () => {
    expect(computeMoveOrder(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("moves the last element up (last idx, delta -1)", () => {
    expect(computeMoveOrder(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
  });

  it("returns null at the top boundary (idx 0, delta -1) — no wraparound", () => {
    expect(computeMoveOrder(["a", "b", "c"], 0, -1)).toBeNull();
  });

  it("returns null at the bottom boundary (last idx, delta +1) — no wraparound", () => {
    expect(computeMoveOrder(["a", "b", "c"], 2, 1)).toBeNull();
  });

  it("returns null for an out-of-range index (e.g. infra server idx -1)", () => {
    // Server: Move on an infra/absent server resolves currentRegularIdx to -1,
    // which must be a no-op (the action is hidden, but the guard is belt+braces).
    expect(computeMoveOrder(["a", "b"], -1, -1)).toBeNull();
    expect(computeMoveOrder(["a", "b"], -1, 1)).toBeNull();
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b", "c"];
    computeMoveOrder(input, 1, -1);
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("computes over the regular class only (infra excluded upstream)", () => {
    // The caller passes the regular-class order (infra filtered out), so a move
    // never displaces an infra server — moving "web" (idx 1) up yields the full
    // new regular order to POST.
    expect(computeMoveOrder(["api", "web", "db"], 1, -1)).toEqual([
      "web",
      "api",
      "db",
    ]);
  });
});

describe("computeWindowMoveTarget (Window: Move up/down/left/right)", () => {
  it("returns index-1 for a move toward the start within range", () => {
    expect(computeWindowMoveTarget(2, -1, 0, 3)).toBe(1);
  });

  it("returns index+1 for a move toward the end within range", () => {
    expect(computeWindowMoveTarget(1, 1, 0, 3)).toBe(2);
  });

  it("returns null at the minimum boundary (no wraparound)", () => {
    expect(computeWindowMoveTarget(0, -1, 0, 3)).toBeNull();
  });

  it("returns null at the maximum boundary (no wraparound)", () => {
    expect(computeWindowMoveTarget(3, 1, 0, 3)).toBeNull();
  });

  it("honors a non-zero minimum index (tmux windows can start above 0)", () => {
    // A session whose windows start at index 1: moving the first (idx 1) up is a
    // boundary no-op; moving it down goes to 2.
    expect(computeWindowMoveTarget(1, -1, 1, 4)).toBeNull();
    expect(computeWindowMoveTarget(1, 1, 1, 4)).toBe(2);
  });
});
