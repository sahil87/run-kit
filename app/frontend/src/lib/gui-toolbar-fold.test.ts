import { describe, it, expect } from "vitest";
import {
  GUI_TOOLBAR_FOLD_HYSTERESIS_PX,
  computeGuiToolbarFold,
  guiToolbarFolded,
  type GuiToolbarFold,
  type GuiToolbarFoldItem,
} from "./gui-toolbar-fold";

/** The shipped ladder's shape with round-number widths: size 90/50, quality
 *  80/24, every verb 24, three group dividers of 5, a 29px pinned block. */
const DIVIDER = 5;
const PINNED = 29;
const LADDER: GuiToolbarFoldItem[] = [
  { full: 90, short: 50, group: "size" },
  { full: 24, group: "zoom" },
  { full: 24, group: "zoom" },
  { full: 24, group: "zoom" },
  { full: 80, short: 24, group: "quality" },
  { full: 24, group: "actions" },
  { full: 24, group: "actions" },
  { full: 24, group: "actions" },
  { full: 24, group: "actions" },
  { full: 24, group: "actions" },
  { full: 24, group: "actions" },
];
/** 90 + 5 + 72 + 5 + 80 + 5 + 144. */
const FULL_WIDTH = 401;
/** Fully degraded: 50 + 5 + 72 + 5 + 24 + 5 + 144. */
const DEGRADED_WIDTH = 305;

function fold(available: number, prev: GuiToolbarFold | null = null) {
  return computeGuiToolbarFold(available, LADDER, PINNED, DIVIDER, prev);
}

describe("computeGuiToolbarFold — full fit and degradation", () => {
  it("renders every item at full labels when everything fits", () => {
    const r = fold(FULL_WIDTH);
    expect(r).toEqual({ visibleCount: LADDER.length, degradeFrom: LADDER.length });
    expect(guiToolbarFolded(r, LADDER.length)).toBe(false);
  });

  it("spends the quality label first — degradation before any fold, least important first", () => {
    // Full needs 401; degrading quality alone saves 56 → 345.
    const r = fold(350);
    expect(r).toEqual({ visibleCount: LADDER.length, degradeFrom: 4 });
    expect(guiToolbarFolded(r, LADDER.length)).toBe(false);
  });

  it("spends the size label second — both degrade before anything folds", () => {
    // Quality+size degraded need 305; at 320 quality alone (345) is not enough.
    const r = fold(320);
    expect(r).toEqual({ visibleCount: LADDER.length, degradeFrom: 0 });
    expect(guiToolbarFolded(r, LADDER.length)).toBe(false);
  });

  it("folds from the tail only after all degradation is spent", () => {
    // Fully degraded needs 305; at 300 pass 1 folds the last item
    // (reconnect), which lights the reserve — pass 2 at 271 folds stats too.
    const r = fold(300);
    expect(r.visibleCount).toBe(LADDER.length - 2);
    expect(r.degradeFrom).toBe(0);
    expect(guiToolbarFolded(r, LADDER.length)).toBe(true);
  });
});

describe("computeGuiToolbarFold — the two-pass reserve", () => {
  it("reserves nothing when every item fits (degradation allowed) — no ⚙", () => {
    // 305 fits the fully-degraded ladder with NO reserve; an always-reserve
    // rule would fold an item here (305 − 29 = 276 < 305).
    const r = fold(DEGRADED_WIDTH);
    expect(r.visibleCount).toBe(LADDER.length);
    expect(guiToolbarFolded(r, LADDER.length)).toBe(false);
  });

  it("re-fits with the pinned reserve once something folds — the reserve can cost one more item", () => {
    // 304 folds reconnect with no reserve (281 ≤ 304); pass 2 at 304−29 = 275
    // folds stats too (281 > 275, 257 ≤ 275).
    const r = fold(DEGRADED_WIDTH - 1);
    expect(r.visibleCount).toBe(LADDER.length - 2);
    expect(guiToolbarFolded(r, LADDER.length)).toBe(true);
  });
});

describe("computeGuiToolbarFold — divider charging", () => {
  it("charges a divider only between rendered items of DIFFERENT groups", () => {
    const items: GuiToolbarFoldItem[] = [
      { full: 20, group: "a" },
      { full: 20, group: "b" },
    ];
    // 20 + 5 + 20 = 45; at 44 the second item folds.
    expect(
      computeGuiToolbarFold(45, items, 0, DIVIDER, null).visibleCount,
    ).toBe(2);
    expect(
      computeGuiToolbarFold(44, items, 0, DIVIDER, null).visibleCount,
    ).toBe(1);
  });

  it("charges no divider inside a group", () => {
    const items: GuiToolbarFoldItem[] = [
      { full: 20, group: "a" },
      { full: 20, group: "a" },
    ];
    expect(computeGuiToolbarFold(40, items, 0, DIVIDER, null).visibleCount).toBe(2);
    expect(computeGuiToolbarFold(39, items, 0, DIVIDER, null).visibleCount).toBe(1);
  });

  it("a group boundary with a folded tail charges no dangling divider", () => {
    // Two one-item groups, budget fits only the first: no divider is charged
    // against the folded one.
    const items: GuiToolbarFoldItem[] = [
      { full: 20, group: "a" },
      { full: 20, group: "b" },
    ];
    const r = computeGuiToolbarFold(20, items, 0, DIVIDER, null);
    expect(r.visibleCount).toBe(1);
  });
});

describe("computeGuiToolbarFold — expand-edge hysteresis", () => {
  const ITEMS: GuiToolbarFoldItem[] = [
    { full: 30, group: "a" },
    { full: 30, group: "a" },
    { full: 30, group: "a" },
    { full: 30, group: "a" },
  ];

  it("collapses immediately at the threshold (no hysteresis on the fold edge)", () => {
    const expanded = { visibleCount: 4, degradeFrom: 4 };
    // 4 items need 120; at 119 the tail folds with no margin required.
    expect(computeGuiToolbarFold(119, ITEMS, 0, 0, expanded)).toEqual({
      visibleCount: 3,
      degradeFrom: 3,
    });
  });

  it("holds the folded state until the width clears the threshold by the margin", () => {
    const collapsed = { visibleCount: 3, degradeFrom: 3 };
    // At exactly the 120 threshold (and 143 = 120 + margin − 1) the expand is
    // not re-proven — the fold holds.
    expect(computeGuiToolbarFold(120, ITEMS, 0, 0, collapsed)).toEqual(collapsed);
    expect(
      computeGuiToolbarFold(120 + GUI_TOOLBAR_FOLD_HYSTERESIS_PX - 1, ITEMS, 0, 0, collapsed),
    ).toEqual(collapsed);
    // At 120 + margin the expand edge is proven.
    expect(
      computeGuiToolbarFold(120 + GUI_TOOLBAR_FOLD_HYSTERESIS_PX, ITEMS, 0, 0, collapsed),
    ).toEqual({ visibleCount: 4, degradeFrom: 4 });
  });

  it("an expand that the margin-shrunk budget cannot hold keeps the previous state", () => {
    // Raw says 4 at 130, but 130 − 24 = 106 fits only 3 — hold prev.
    const collapsed = { visibleCount: 3, degradeFrom: 3 };
    expect(computeGuiToolbarFold(130, ITEMS, 0, 0, collapsed)).toEqual(collapsed);
  });

  it("never expands below the previous state while re-proving", () => {
    const prev = { visibleCount: 2, degradeFrom: 2 };
    // Raw expands to 3 (90 ≤ 95); the guarded pass at 71 fits only 2 — the
    // result must not regress below prev, it holds prev.
    expect(computeGuiToolbarFold(95, ITEMS, 0, 0, prev)).toEqual(prev);
  });

  it("the same margin gates the ⚙ appearing/disappearing boundary", () => {
    // prev unfolded; shrink 1px past the fully-degraded width → folds at once.
    const unfolded = { visibleCount: LADDER.length, degradeFrom: 0 };
    const justFolded = fold(DEGRADED_WIDTH - 1, unfolded);
    expect(guiToolbarFolded(justFolded, LADDER.length)).toBe(true);
    // Widening back to the raw threshold holds the fold until +margin.
    const back = computeGuiToolbarFold(305, LADDER, PINNED, DIVIDER, justFolded);
    expect(guiToolbarFolded(back, LADDER.length)).toBe(true);
  });
});

describe("computeGuiToolbarFold — degenerate inputs", () => {
  it("a genuinely zero spring (real measurements) collapses to the pinned block alone", () => {
    // available 0 with real item widths is a REAL measurement, not an
    // unmeasured environment: everything folds, ⚙ carries the ladder.
    expect(fold(0, { visibleCount: 5, degradeFrom: 0 })).toEqual({ visibleCount: 0, degradeFrom: 0 });
  });

  it("keeps the previous state when every probe width reads zero (jsdom)", () => {
    const prev = { visibleCount: 2, degradeFrom: 2 };
    const zeroed = LADDER.map((i) => ({ ...i, full: 0, short: undefined }));
    expect(computeGuiToolbarFold(500, zeroed, 0, DIVIDER, prev)).toEqual(prev);
  });

  it("the cold default is fully expanded (the safe cold answer)", () => {
    const zeroed = LADDER.map((i) => ({ ...i, full: 0, short: undefined }));
    expect(computeGuiToolbarFold(0, zeroed, 0, DIVIDER, null)).toEqual({
      visibleCount: LADDER.length,
      degradeFrom: LADDER.length,
    });
  });

  it("an empty ladder folds to nothing", () => {
    expect(computeGuiToolbarFold(100, [], 0, DIVIDER, null)).toEqual({
      visibleCount: 0,
      degradeFrom: 0,
    });
  });
});
