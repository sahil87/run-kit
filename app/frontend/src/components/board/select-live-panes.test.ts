import { describe, it, expect } from "vitest";
import { selectLivePanes } from "./select-live-panes";

const CAP = 4;

describe("selectLivePanes", () => {
  it("keeps all visible panes live when within the cap", () => {
    const live = selectLivePanes({
      visible: new Set([0, 1, 2]),
      focusedIndex: 0,
      mruOrder: [0],
      cap: CAP,
    });
    expect(live).toEqual(new Set([0, 1, 2]));
  });

  it("never exceeds the cap when more panes are visible", () => {
    const live = selectLivePanes({
      visible: new Set([0, 1, 2, 3, 4, 5]),
      focusedIndex: 0,
      mruOrder: [0, 1, 2, 3, 4, 5],
      cap: CAP,
    });
    expect(live.size).toBe(CAP);
  });

  it("pauses the least-recently-focused visible panes first beyond the cap", () => {
    // 6 panes visible, cap 4, focused = 0. MRU order means 1,2,3 are the most
    // recently focused after the focused pane; 4 and 5 are least-recent and get
    // paused.
    const live = selectLivePanes({
      visible: new Set([0, 1, 2, 3, 4, 5]),
      focusedIndex: 0,
      mruOrder: [0, 1, 2, 3, 4, 5],
      cap: CAP,
    });
    expect(live).toEqual(new Set([0, 1, 2, 3]));
    expect(live.has(4)).toBe(false);
    expect(live.has(5)).toBe(false);
  });

  it("respects an out-of-index MRU order for eviction", () => {
    // Visible 6 panes; recent focus order is 5,4,3 (then unranked 1,2).
    // Focused = 0 (always live). Remaining slots: 5,4,3 by MRU; 1,2 evicted.
    const live = selectLivePanes({
      visible: new Set([1, 2, 3, 4, 5, 0]),
      focusedIndex: 0,
      mruOrder: [0, 5, 4, 3],
      cap: CAP,
    });
    expect(live).toEqual(new Set([0, 5, 4, 3]));
  });

  it("always keeps the focused pane live even when it is off-screen", () => {
    // Focused pane (9) is NOT in the visible set — it must still be live.
    const live = selectLivePanes({
      visible: new Set([0, 1, 2]),
      focusedIndex: 9,
      mruOrder: [9, 0, 1, 2],
      cap: CAP,
    });
    expect(live.has(9)).toBe(true);
    expect(live).toEqual(new Set([9, 0, 1, 2]));
  });

  it("keeps the focused pane live even when the cap is already filled by others", () => {
    // Focused = 9 (off-screen), 4 visible panes that would fill the cap. The
    // focused pane is exempt from the cap, so the result is cap-1 visible panes
    // plus the focused pane = cap total, with the focused pane guaranteed.
    const live = selectLivePanes({
      visible: new Set([0, 1, 2, 3]),
      focusedIndex: 9,
      mruOrder: [9, 0, 1, 2, 3],
      cap: CAP,
    });
    expect(live.has(9)).toBe(true);
    expect(live.size).toBe(CAP);
    // The least-recently-focused visible pane (3) is evicted to make room.
    expect(live).toEqual(new Set([9, 0, 1, 2]));
  });

  it("yields only the focused pane when nothing else is visible", () => {
    const live = selectLivePanes({
      visible: new Set<number>(),
      focusedIndex: 2,
      mruOrder: [2],
      cap: CAP,
    });
    expect(live).toEqual(new Set([2]));
  });

  it("keeps the focused pane live even with a cap of zero", () => {
    // Defensive: the focused pane is exempt from the cap.
    const live = selectLivePanes({
      visible: new Set([0, 1]),
      focusedIndex: 1,
      mruOrder: [1, 0],
      cap: 0,
    });
    expect(live).toEqual(new Set([1]));
  });

  it("does not double-count the focused pane when it is also visible", () => {
    const live = selectLivePanes({
      visible: new Set([0, 1, 2, 3, 4]),
      focusedIndex: 2,
      mruOrder: [2, 0, 1, 3, 4],
      cap: CAP,
    });
    expect(live.has(2)).toBe(true);
    expect(live.size).toBe(CAP);
    // Focused (2) + top-3 MRU visible (0,1,3); 4 is evicted.
    expect(live).toEqual(new Set([2, 0, 1, 3]));
  });
});
