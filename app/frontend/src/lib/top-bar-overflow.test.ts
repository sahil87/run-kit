import { describe, it, expect } from "vitest";
import { computeVisibleCount } from "./top-bar-overflow";

describe("computeVisibleCount", () => {
  it("returns all items when everything fits", () => {
    // 3 items of 20px + 2 gaps of 4px = 68px, plenty of budget.
    expect(computeVisibleCount(500, [20, 20, 20], 0, 4)).toBe(3);
  });

  it("returns 0 when available width is zero", () => {
    expect(computeVisibleCount(0, [20, 20], 0, 4)).toBe(0);
  });

  it("returns 0 when available width is negative", () => {
    expect(computeVisibleCount(-50, [20], 0, 4)).toBe(0);
  });

  it("returns 0 when the reserved width consumes the whole budget", () => {
    // reserved (exempt items + chevron + dot) leaves nothing for items.
    expect(computeVisibleCount(30, [20, 20], 30, 4)).toBe(0);
  });

  it("returns 0 when the budget cannot fit even the first item", () => {
    // budget = 100 - 90 = 10, first item is 20 → nothing fits.
    expect(computeVisibleCount(100, [20, 20], 90, 4)).toBe(0);
  });

  it("fits only the first K leading items under pressure", () => {
    // budget = 100. Items [30, 30, 30] with 4px gaps:
    //  1 item  = 30
    //  2 items = 30 + 4 + 30 = 64
    //  3 items = 64 + 4 + 30 = 98  (fits!) → but tighten to force K=2 below.
    expect(computeVisibleCount(98, [30, 30, 30], 0, 4)).toBe(3);
    expect(computeVisibleCount(97, [30, 30, 30], 0, 4)).toBe(2);
    expect(computeVisibleCount(63, [30, 30, 30], 0, 4)).toBe(1);
  });

  it("charges a gap only BETWEEN rendered items (n items → n-1 gaps)", () => {
    // Single item: no gap charged. 20px item fits exactly in a 20px budget.
    expect(computeVisibleCount(20, [20, 20], 0, 4)).toBe(1);
    // Two items need one 4px gap: 20 + 4 + 20 = 44.
    expect(computeVisibleCount(44, [20, 20], 0, 4)).toBe(2);
    expect(computeVisibleCount(43, [20, 20], 0, 4)).toBe(1);
  });

  it("subtracts reserved space before fitting (exempt items + chevron + dot)", () => {
    // reserved 40px for exempt block; 60px available → 20px budget → 1 of two 20px items.
    expect(computeVisibleCount(60, [20, 20], 40, 4)).toBe(1);
    // Widen so both fit: 40 reserved + 20 + 4 + 20 = 84.
    expect(computeVisibleCount(84, [20, 20], 40, 4)).toBe(2);
  });

  it("respects varied (measured, non-uniform) child widths in order", () => {
    // Items with different real widths (ViewSwitcher-like, chip-like, coarse sizing).
    // budget = 120. [50, 30, 24, 24] with 4px gaps:
    //  1 = 50
    //  2 = 50 + 4 + 30 = 84
    //  3 = 84 + 4 + 24 = 112
    //  4 = 112 + 4 + 24 = 140 (> 120) → K=3
    expect(computeVisibleCount(120, [50, 30, 24, 24], 0, 4)).toBe(3);
  });

  it("returns 0 for an empty item list regardless of budget", () => {
    expect(computeVisibleCount(500, [], 0, 4)).toBe(0);
  });
});
