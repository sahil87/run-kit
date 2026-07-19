import { describe, it, expect } from "vitest";
import {
  computeReorderNeighbors,
  computeMoveNeighbors,
  focusedIndexForKey,
  shouldFocusPane,
} from "./board-reorder";

// These helpers back the command-palette Move Focused Pane Left/Right actions.
// (The drag-and-drop hook, use-board-pane-reorder, deliberately derives
// neighbours inline from its final optimistic override and does NOT import this
// module — see board-reorder.ts.) Covering the insert-before neighbour
// arithmetic + boundary gating here proves the reorder POST's before/after are
// correct without mounting the board (mirrors palette-move.test.ts).

describe("computeReorderNeighbors (drag insert-before → POST before/after)", () => {
  it("moves an item to the end (drag first over last)", () => {
    // [a,b,c], drag a (idx 0) over c (idx 2) → [b,c,a]: a lands last.
    expect(computeReorderNeighbors(["a", "b", "c"], 0, 2)).toEqual({
      before: "c",
      after: null,
    });
  });

  it("moves an item to the start (drag last over first)", () => {
    // [a,b,c], drag c (idx 2) over a (idx 0) → [c,a,b]: c lands first.
    expect(computeReorderNeighbors(["a", "b", "c"], 2, 0)).toEqual({
      before: null,
      after: "a",
    });
  });

  it("moves a middle item up one (drag b over a)", () => {
    // [a,b,c], drag b (idx 1) over a (idx 0) → [b,a,c]: b lands first.
    expect(computeReorderNeighbors(["a", "b", "c"], 1, 0)).toEqual({
      before: null,
      after: "a",
    });
  });

  it("moves a middle item down one (drag b over c)", () => {
    // [a,b,c], drag b (idx 1) over c (idx 2) → [a,c,b]: b lands last.
    expect(computeReorderNeighbors(["a", "b", "c"], 1, 2)).toEqual({
      before: "c",
      after: null,
    });
  });

  it("lands between two siblings (4-item, drag first to idx 2)", () => {
    // [a,b,c,d], drag a (idx 0) to idx 2 → [b,c,a,d]: a between c and d.
    expect(computeReorderNeighbors(["a", "b", "c", "d"], 0, 2)).toEqual({
      before: "c",
      after: "d",
    });
  });

  it("returns null for a self-move (same slot)", () => {
    expect(computeReorderNeighbors(["a", "b", "c"], 1, 1)).toBeNull();
  });

  it("returns null for an out-of-range fromIdx", () => {
    expect(computeReorderNeighbors(["a", "b"], -1, 0)).toBeNull();
    expect(computeReorderNeighbors(["a", "b"], 2, 0)).toBeNull();
  });

  it("returns null for an out-of-range toIdx", () => {
    expect(computeReorderNeighbors(["a", "b"], 0, 2)).toBeNull();
    expect(computeReorderNeighbors(["a", "b"], 0, -1)).toBeNull();
  });

  it("does not mutate the input array", () => {
    const input = ["a", "b", "c"];
    computeReorderNeighbors(input, 0, 2);
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("works with composite server:windowId keys", () => {
    const ids = ["srv1:@1", "srv1:@2", "srv2:@3"];
    // Drag srv1:@1 (idx 0) over srv2:@3 (idx 2) → lands last.
    expect(computeReorderNeighbors(ids, 0, 2)).toEqual({
      before: "srv2:@3",
      after: null,
    });
  });
});

describe("computeMoveNeighbors (palette Move Left/Right, boundary-gated)", () => {
  it("move right (delta +1) from a middle index", () => {
    // [a,b,c], move b (idx 1) right → [a,c,b]: b lands last.
    expect(computeMoveNeighbors(["a", "b", "c"], 1, 1)).toEqual({
      before: "c",
      after: null,
    });
  });

  it("move left (delta -1) from a middle index", () => {
    // [a,b,c], move b (idx 1) left → [b,a,c]: b lands first.
    expect(computeMoveNeighbors(["a", "b", "c"], 1, -1)).toEqual({
      before: null,
      after: "a",
    });
  });

  it("move first-left is a boundary no-op (null, no wraparound)", () => {
    expect(computeMoveNeighbors(["a", "b", "c"], 0, -1)).toBeNull();
  });

  it("move last-right is a boundary no-op (null, no wraparound)", () => {
    expect(computeMoveNeighbors(["a", "b", "c"], 2, 1)).toBeNull();
  });

  it("move right from index 0 lands the item at index 1", () => {
    // [a,b,c], move a (idx 0) right → [b,a,c]: a between b and c.
    expect(computeMoveNeighbors(["a", "b", "c"], 0, 1)).toEqual({
      before: "b",
      after: "c",
    });
  });

  it("returns null for an out-of-range index", () => {
    expect(computeMoveNeighbors(["a", "b"], -1, 1)).toBeNull();
    expect(computeMoveNeighbors(["a", "b"], 5, -1)).toBeNull();
  });
});

describe("focusedIndexForKey (focus follows the moved pane by key, T013)", () => {
  const keys = ["srv1:@a", "srv1:@b", "srv2:@c"];

  it("returns the new index of the focused key after a reorder (own move echo)", () => {
    // Focused pane srv1:@a moved to the end: [b, c, a]. Key follows to idx 2.
    const reordered = ["srv1:@b", "srv2:@c", "srv1:@a"];
    expect(focusedIndexForKey(reordered, "srv1:@a", 0)).toBe(2);
  });

  it("keeps focus on the same pane for a reorder from another client", () => {
    // A DIFFERENT pane moved (b→front): [b, a, c]. Focused srv1:@a is now idx 1,
    // NOT the fallback index 0 (which an index-bump model would wrongly keep).
    const reordered = ["srv1:@b", "srv1:@a", "srv2:@c"];
    expect(focusedIndexForKey(reordered, "srv1:@a", 0)).toBe(1);
  });

  it("falls back to the (clamped) index when the key is absent (pane unpinned)", () => {
    // Focused pane was removed; fall back to the given index, clamped in range.
    expect(focusedIndexForKey(keys, "srv9:@gone", 1)).toBe(1);
    expect(focusedIndexForKey(keys, "srv9:@gone", 9)).toBe(0); // out of range → 0
  });

  it("falls back to the clamped index when no key is tracked yet", () => {
    expect(focusedIndexForKey(keys, null, 2)).toBe(2);
    expect(focusedIndexForKey(keys, null, -1)).toBe(0);
  });

  it("returns 0 for an empty board regardless of key/fallback", () => {
    expect(focusedIndexForKey([], "srv1:@a", 3)).toBe(0);
    expect(focusedIndexForKey([], null, 0)).toBe(0);
  });
});

describe("shouldFocusPane (imperative focus gated on intent AND index change, 6dh9)", () => {
  it("does NOT focus on board load (index unchanged from its 0 seed)", () => {
    // First settled render: focusedIndex 0, prevFocusedIndexRef seeded to 0. No
    // user intent yet either — false on both dimensions.
    expect(shouldFocusPane(false, 0, 0)).toBe(false);
    expect(shouldFocusPane(true, 0, 0)).toBe(false);
  });

  it("does NOT focus on an SSE refetch that leaves the focused index put", () => {
    // A board-changed refetch (pin/unpin/remote reorder on another board) re-runs
    // the effect with the same focusedIndex and no intent — no DOM focus steal.
    expect(shouldFocusPane(false, 1, 1)).toBe(false);
    expect(shouldFocusPane(false, 2, 2)).toBe(false);
  });

  it("does NOT focus on a REMOTE reconcile that shifts the focused index (the fix)", () => {
    // A remote reorder — or a remote pin/unpin ahead of the focused pane — from
    // another client bumps the focused pane's index via the key-reconcile. Intent
    // is false (the local user did nothing), so despite the index change no focus
    // is stolen. This is the 6dh9 focus-steal case the index-only proxy missed.
    expect(shouldFocusPane(false, 0, 1)).toBe(false);
    expect(shouldFocusPane(false, 2, 0)).toBe(false);
  });

  it("does NOT focus on a same-index render even with intent set", () => {
    // Intent alone is not sufficient: a set flag riding a render that did not
    // move the index must not re-focus (same-index user actions are handled
    // imperatively at the call sites, without the flag).
    expect(shouldFocusPane(true, 1, 1)).toBe(false);
  });

  it("focuses when intent is set AND the index changed (cycle, click, own-move echo)", () => {
    // Cycle right: 0→1. Click to a different pane: 1→2. Own-move echo bumps the
    // index to the moved pane's new slot with the intent flag set at initiation:
    // each is a real index change carrying intent → focus fires.
    expect(shouldFocusPane(true, 0, 1)).toBe(true);
    expect(shouldFocusPane(true, 1, 2)).toBe(true);
    expect(shouldFocusPane(true, 2, 0)).toBe(true);
  });
});
