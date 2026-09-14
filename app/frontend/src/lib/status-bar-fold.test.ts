import { describe, it, expect } from "vitest";
import {
  STATUS_BAR_FOLD_DOT_PX,
  STATUS_BAR_FOLD_GAP_PX,
  STATUS_BAR_FOLD_HYSTERESIS_PX,
  STATUS_BAR_FOLD_PAD_PX,
  computeStatusBarFold,
  type StatusBarFold,
  type StatusBarFoldItem,
} from "./status-bar-fold";

/** The shipped priority table's shape with round-number widths: display
 *  order (left cluster, then right), the R9 priorities, the two truncatable
 *  never-fold items, and a 20px chevron. */
const CHEVRON = 20;
const CHARGE = STATUS_BAR_FOLD_PAD_PX + STATUS_BAR_FOLD_DOT_PX + STATUS_BAR_FOLD_GAP_PX; // 36
const FIXTURE: StatusBarFoldItem[] = [
  { id: "git", widthPx: 60, prio: 9, cluster: "left" },
  { id: "pr", widthPx: 50, prio: null, cluster: "left", truncatable: true },
  { id: "fab", widthPx: 120, prio: null, cluster: "left", truncatable: true },
  { id: "agt", widthPx: 60, prio: 8, cluster: "left" },
  { id: "tmx", widthPx: 40, prio: 3, cluster: "left" },
  { id: "cwd", widthPx: 60, prio: 2, cluster: "left" },
  { id: "zen", widthPx: 40, prio: null, cluster: "right" },
  { id: "metrics", widthPx: 80, prio: 6, cluster: "right" },
  { id: "ld", widthPx: 40, prio: 0, cluster: "right" },
  { id: "clock", widthPx: 60, prio: 4, cluster: "right" },
  { id: "server", widthPx: 50, prio: 5, cluster: "right" },
  { id: "host", widthPx: 60, prio: 10, cluster: "right" },
  { id: "version", widthPx: 40, prio: 7, cluster: "right" },
  { id: "palette", widthPx: 40, prio: 1, cluster: "right" },
  { id: "compose", widthPx: 40, prio: 1, cluster: "right" },
];
/** Left 390 + 5 gaps, right 450 + 8 gaps, plus the fixed PAD+DOT+GAP charge. */
const FULL_FIT = 450 + 546 + CHARGE; // 1032

function fold(available: number, prev: StatusBarFold | null = null) {
  return computeStatusBarFold(FIXTURE, available, CHEVRON, prev);
}

describe("computeStatusBarFold — full fit and the priority ladder", () => {
  it("renders every segment when everything fits — nothing folds, no reserve consulted", () => {
    // Budget exactly equals the rendered width; an always-reserve rule would
    // fold `ld` here (996 > 1032 − 36 − 20 − 12).
    expect(fold(FULL_FIT)).toEqual({ folded: [], truncateId: null });
  });

  it("folds lowest priority first as the budget shrinks — the full ladder order", () => {
    // prev stays null so each probe is the raw (hysteresis-free) decision.
    const expected = [
      "ld", "compose", "palette", "cwd", "tmx", "clock",
      "server", "metrics", "version", "agt", "git", "host",
    ];
    const seen: string[] = [];
    let prevFolded = new Set<string>();
    for (let a = FULL_FIT - 1; a > 0 && seen.length < expected.length; a--) {
      const f = fold(a);
      for (const id of f.folded) if (!prevFolded.has(id)) seen.push(id);
      prevFolded = new Set(f.folded);
    }
    expect(seen).toEqual(expected);
  });

  it("a prio tie folds the rightmost in display order first (compose before palette)", () => {
    const items: StatusBarFoldItem[] = [
      { id: "palette", widthPx: 40, prio: 1, cluster: "right" },
      { id: "compose", widthPx: 40, prio: 1, cluster: "right" },
    ];
    // Rendered 40 + 12 + 40 = 92; a 91 budget is short by one item.
    const r = computeStatusBarFold(items, CHARGE + 91, CHEVRON, null);
    expect(r).toEqual({ folded: ["compose"], truncateId: null });
  });

  it("never-fold items survive at any budget; the rightmost truncatable survivor truncates", () => {
    const r = fold(100);
    expect(r.folded).toHaveLength(12);
    expect(r.folded).not.toContain("pr");
    expect(r.folded).not.toContain("fab");
    expect(r.folded).not.toContain("zen");
    // pr (display 2) and fab (display 3) are both truncatable — fab wins.
    expect(r.truncateId).toBe("fab");
  });

  it("with nothing truncatable the never-fold overflow truncates nothing", () => {
    const items: StatusBarFoldItem[] = [
      { id: "zen", widthPx: 40, prio: null, cluster: "right" },
      { id: "clock", widthPx: 60, prio: null, cluster: "right" },
    ];
    const r = computeStatusBarFold(items, CHARGE + 50, CHEVRON, null);
    expect(r).toEqual({ folded: [], truncateId: null });
  });
});

describe("computeStatusBarFold — the two-pass chevron reserve", () => {
  it("one px over budget folds ld alone when the reserve still fits", () => {
    // 1031: budget 995, folding ld (40 + a 12 gap) lands at 944 ≤ 995; the
    // reserved re-fit (995 − 20 − 12 = 963) still holds.
    expect(fold(FULL_FIT - 1).folded).toEqual(["ld"]);
  });

  it("the reserve may cost one more item than the unreserved pass", () => {
    // 980: the unreserved pass folds ld (996 − 40 − 12 = 944 ≤ 944) and
    // stops; the reserved re-fit (944 − 20 − 12 = 912) folds compose too.
    expect(fold(980).folded).toEqual(["ld", "compose"]);
  });
});

describe("computeStatusBarFold — per-cluster gap charging", () => {
  const pair = (cluster: "left" | "right"): StatusBarFoldItem[] => [
    { id: "a", widthPx: 20, prio: 1, cluster },
    { id: "b", widthPx: 20, prio: 1, cluster },
  ];

  it("charges GAP × (n−1) inside a cluster", () => {
    // Same cluster: 20 + 12 + 20 = 52 rendered.
    expect(computeStatusBarFold(pair("left"), CHARGE + 52, 0, null).folded).toEqual([]);
    expect(computeStatusBarFold(pair("left"), CHARGE + 51, 0, null).folded).toEqual(["b"]);
  });

  it("charges no gap across the ml-auto spring", () => {
    const items: StatusBarFoldItem[] = [
      { id: "a", widthPx: 20, prio: 1, cluster: "left" },
      { id: "b", widthPx: 20, prio: 1, cluster: "right" },
    ];
    // One item per cluster: 20 + 20 = 40 rendered, no gap.
    expect(computeStatusBarFold(items, CHARGE + 40, 0, null).folded).toEqual([]);
    expect(computeStatusBarFold(items, CHARGE + 39, 0, null).folded).toEqual(["b"]);
  });
});

describe("computeStatusBarFold — last-survivor truncation", () => {
  it("the never-fold set overflowing picks the rightmost truncatable item", () => {
    // Only never-fold items present; nothing can fold, so the overflow goes
    // to truncation — fab (display 3) before pr (display 2).
    const items: StatusBarFoldItem[] = [
      { id: "pr", widthPx: 50, prio: null, cluster: "left", truncatable: true },
      { id: "fab", widthPx: 120, prio: null, cluster: "left", truncatable: true },
    ];
    const r = computeStatusBarFold(items, CHARGE + 100, CHEVRON, null);
    expect(r).toEqual({ folded: [], truncateId: "fab" });
  });

  it("pr truncates only when fab is absent", () => {
    const items: StatusBarFoldItem[] = [
      { id: "pr", widthPx: 50, prio: null, cluster: "left", truncatable: true },
      { id: "zen", widthPx: 40, prio: null, cluster: "right" },
    ];
    const r = computeStatusBarFold(items, CHARGE + 40, CHEVRON, null);
    expect(r).toEqual({ folded: [], truncateId: "pr" });
  });
});

describe("computeStatusBarFold — expand-edge hysteresis", () => {
  // Two same-cluster items (30px each, equal prio — the rightmost folds
  // first). Full fit: 30 + 12 + 30 = 72 rendered, available 108.
  const ITEMS: StatusBarFoldItem[] = [
    { id: "a", widthPx: 30, prio: 5, cluster: "left" },
    { id: "b", widthPx: 30, prio: 5, cluster: "left" },
  ];
  const FITS = CHARGE + 72; // 108
  const expanded: StatusBarFold = { folded: [], truncateId: null };
  const collapsed: StatusBarFold = { folded: ["b"], truncateId: null };

  it("collapses immediately at the threshold (no hysteresis on the fold edge)", () => {
    expect(computeStatusBarFold(ITEMS, FITS - 1, 0, expanded)).toEqual(collapsed);
  });

  it("holds the folded state until the width clears the threshold by the margin", () => {
    expect(computeStatusBarFold(ITEMS, FITS, 0, collapsed)).toEqual(collapsed);
    expect(
      computeStatusBarFold(ITEMS, FITS + STATUS_BAR_FOLD_HYSTERESIS_PX - 1, 0, collapsed),
    ).toEqual(collapsed);
    expect(
      computeStatusBarFold(ITEMS, FITS + STATUS_BAR_FOLD_HYSTERESIS_PX, 0, collapsed),
    ).toEqual(expanded);
  });

  it("an expand that the margin-shrunk budget cannot hold returns prev", () => {
    // Raw says expanded at 130, but 130 − 24 fits only one item.
    expect(computeStatusBarFold(ITEMS, 130, 0, collapsed)).toEqual(collapsed);
  });

  it("truncation turning off counts as an expand and carries the same margin", () => {
    const items: StatusBarFoldItem[] = [
      { id: "pr", widthPx: 50, prio: null, cluster: "left", truncatable: true },
      { id: "fab", widthPx: 120, prio: null, cluster: "left", truncatable: true },
    ];
    // Rendered 50 + 12 + 120 = 182; fits at CHARGE + 182 = 218.
    const truncating: StatusBarFold = { folded: [], truncateId: "fab" };
    expect(computeStatusBarFold(items, 218, 0, truncating)).toEqual(truncating);
    expect(
      computeStatusBarFold(items, 218 + STATUS_BAR_FOLD_HYSTERESIS_PX, 0, truncating),
    ).toEqual({ folded: [], truncateId: null });
  });
});

describe("computeStatusBarFold — degenerate inputs", () => {
  it("keeps the previous state when every probe width reads zero (jsdom)", () => {
    const prev: StatusBarFold = { folded: ["ld"], truncateId: null };
    const zeroed = FIXTURE.map((i) => ({ ...i, widthPx: 0 }));
    expect(computeStatusBarFold(zeroed, 500, CHEVRON, prev)).toEqual(prev);
  });

  it("the cold default is fully expanded (the safe cold answer)", () => {
    const zeroed = FIXTURE.map((i) => ({ ...i, widthPx: 0 }));
    expect(computeStatusBarFold(zeroed, 0, CHEVRON, null)).toEqual({ folded: [], truncateId: null });
  });

  it("an empty item list returns prev, or the empty fold when cold", () => {
    const prev: StatusBarFold = { folded: ["ld"], truncateId: null };
    expect(computeStatusBarFold([], 500, CHEVRON, prev)).toEqual(prev);
    expect(computeStatusBarFold([], 500, CHEVRON, null)).toEqual({ folded: [], truncateId: null });
  });
});
