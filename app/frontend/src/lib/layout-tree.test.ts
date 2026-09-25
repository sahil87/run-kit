import { describe, expect, it } from "vitest";
import {
  insertBeside,
  isCanonicalTree,
  layoutDividers,
  layoutRects,
  leafIds,
  leaves,
  normalise,
  parseLayoutTree,
  pathOf,
  removeLeaf,
  serializeLayoutTree,
  slotOrder,
  structureSig,
  swapLeaves,
  templateOf,
  templatesFor,
  TEMPLATES,
  MAX_LAYOUT_LEN,
  MAX_TILES,
  type LayoutNode,
  type SplitDir,
  type SurfaceKind,
} from "./layout-tree";
import fixtures from "./layout-tree.fixtures.json";

// ── enumeration of every canonical placement (the study's 4 / 36 / 528) ────

const KINDS4: SurfaceKind[] = ["tty", "web", "code", "gui"];

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([item, ...p]);
  });
  return out;
}

/** Ordered partitions of n into ≥2 positive parts. */
function compositions(n: number): number[][] {
  if (n < 2) return [];
  const out: number[][] = [];
  for (let first = 1; first < n; first++) {
    const rest = n - first;
    if (rest === 1) {
      out.push([first, 1]);
    } else {
      out.push([first, rest]);
      for (const tail of compositions(rest)) out.push([first, ...tail]);
    }
  }
  return out;
}

/** Every canonical node whose reading-order leaves are exactly `kinds`, as a
 *  child of a `parentDir` split (null = root). Children of a split cover
 *  contiguous reading-order segments, and a multi-leaf child of a split must
 *  split on the opposite direction. */
function treesOverSegment(kinds: SurfaceKind[], parentDir: SplitDir | null): LayoutNode[] {
  if (kinds.length === 1) return [{ leaf: kinds[0] }];
  const dirs: SplitDir[] = parentDir === null ? ["h", "v"] : [parentDir === "h" ? "v" : "h"];
  const out: LayoutNode[] = [];
  for (const dir of dirs) {
    for (const comp of compositions(kinds.length)) {
      let offset = 0;
      let acc: LayoutNode[][] = [[]];
      for (const part of comp) {
        const options = treesOverSegment(kinds.slice(offset, offset + part), dir);
        offset += part;
        acc = acc.flatMap((prefix) => options.map((o) => [...prefix, o]));
      }
      for (const children of acc) out.push({ dir, children });
    }
  }
  return out;
}

function allPlacements(n: number): LayoutNode[] {
  return permutations(KINDS4.slice(0, n)).flatMap((p) => treesOverSegment(p, null));
}

const sortedKinds = (t: LayoutNode) => [...leaves(t)].sort();

// ── shared fixture table (also read by the Go layoutspec tests) ─────────────

describe("shared fixture table (layout-tree.fixtures.json)", () => {
  for (const { input, expect: expected } of fixtures.parse) {
    it(`parse ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      const parsed = parseLayoutTree(input);
      expect(parsed === null ? null : serializeLayoutTree(parsed)).toBe(expected);
    });
  }
});

// ── grammar and canonical form ──────────────────────────────────────────────

describe("parseLayoutTree", () => {
  it("parses a nested tree into nodes", () => {
    expect(parseLayoutTree("h(tty,v(code,web))")).toEqual({
      dir: "h",
      children: [{ leaf: "tty" }, { dir: "v", children: [{ leaf: "code" }, { leaf: "web" }] }],
    });
  });

  it("round-trips every canonical tree with ≤ MAX_TILES leaves", () => {
    for (const n of [1, 2, 3]) {
      for (const t of allPlacements(n)) {
        expect(parseLayoutTree(serializeLayoutTree(t))).toEqual(t);
      }
    }
  });

  it("does not attach sizes to parsed trees", () => {
    const t = parseLayoutTree("h(tty,v(code,web))");
    expect(t && !("sizes" in t)).toBe(true);
  });

  it("rejects over-length input before recursing (the depth cap)", () => {
    const deep = "h(".repeat(200) + "tty" + ")".repeat(200);
    expect(deep.length).toBeGreaterThan(MAX_LAYOUT_LEN);
    expect(parseLayoutTree(deep)).toBeNull();
  });
});

describe("leafIds", () => {
  it("uses the kind for unique kinds and occurrence suffixes for duplicates", () => {
    expect(leafIds(parseLayoutTree("h(tty,v(code,web))")!)).toEqual(["tty", "code", "web"]);
    expect(leafIds(parseLayoutTree("h(tty,tty)")!)).toEqual(["tty", "tty#2"]);
  });
});

// ── exhaustive invariants over the study's enumeration (N ≤ 4) ─────────────

describe("exhaustive invariants (4 / 36 / 528 placements)", () => {
  it("enumerates the study's placement counts", () => {
    expect(allPlacements(2)).toHaveLength(4);
    expect(allPlacements(3)).toHaveLength(36);
    expect(allPlacements(4)).toHaveLength(528);
  });

  it("normalise is a fixpoint on canonical trees", () => {
    for (const n of [2, 3, 4]) {
      for (const t of allPlacements(n)) expect(normalise(t)).toEqual(t);
    }
  });

  it("swapLeaves is a canonical involution keeping the leaf multiset", () => {
    for (const n of [2, 3, 4]) {
      for (const t of allPlacements(n)) {
        const ids = leafIds(t);
        for (const a of ids) {
          for (const b of ids) {
            if (a === b) continue;
            const once = swapLeaves(t, a, b);
            expect(isCanonicalTree(once, n)).toBe(true);
            expect(sortedKinds(once)).toEqual(sortedKinds(t));
            expect(swapLeaves(once, a, b)).toEqual(t);
          }
        }
      }
    }
  });

  it("removeLeaf keeps canonical form and drops exactly one leaf", () => {
    for (const n of [2, 3, 4]) {
      for (const t of allPlacements(n)) {
        for (const id of leafIds(t)) {
          const out = removeLeaf(t, id);
          expect(out).not.toBeNull();
          expect(isCanonicalTree(out!, n)).toBe(true);
          expect(leaves(out!)).toHaveLength(n - 1);
        }
      }
    }
    expect(removeLeaf({ leaf: "tty" }, "tty")).toBeNull();
    expect(removeLeaf(parseLayoutTree("h(tty,web)")!, "gui")).toBeNull();
  });

  it("insertBeside keeps canonical form and adds exactly one leaf", () => {
    for (const n of [1, 2, 3]) {
      for (const t of allPlacements(n)) {
        for (const id of leafIds(t)) {
          for (const side of ["left", "right", "top", "bottom"] as const) {
            const out = insertBeside(t, pathOf(t, id)!, side, { leaf: "tty" });
            expect(isCanonicalTree(out, n + 1)).toBe(true);
            expect(leaves(out)).toHaveLength(n + 1);
          }
        }
      }
    }
  });

  it("insertBeside into a same-direction parent merges into it", () => {
    const t = parseLayoutTree("h(tty,web)")!;
    expect(serializeLayoutTree(insertBeside(t, [1], "right", { leaf: "code" }))).toBe(
      "h(tty,web,code)",
    );
    expect(serializeLayoutTree(insertBeside(t, [1], "bottom", { leaf: "code" }))).toBe(
      "h(tty,v(web,code))",
    );
  });

  it("the N = 3 closure is the five presets plus main-bottom", () => {
    const reachable = new Set(allPlacements(3).map(structureSig));
    const indexSlots: SurfaceKind[] = ["tty", "web", "code"];
    const templated = new Set(
      templatesFor(3).map((name) => structureSig(TEMPLATES[name](indexSlots))),
    );
    expect(reachable).toEqual(templated);
    expect(templated.size).toBe(6);
  });
});

// ── templates ───────────────────────────────────────────────────────────────

describe("templates", () => {
  it("templatesFor lists the structurally distinct templates in registry order", () => {
    expect(templatesFor(1)).toEqual([]);
    expect(templatesFor(2)).toEqual(["row", "col"]);
    expect(templatesFor(3)).toEqual([
      "row",
      "col",
      "main-left",
      "main-right",
      "main-top",
      "main-bottom",
    ]);
  });

  it("templateOf identifies main-bottom with slot A first", () => {
    expect(templateOf(parseLayoutTree("v(h(code,web),tty)")!)).toEqual({
      name: "main-bottom",
      slots: ["tty", "code", "web"],
    });
  });

  it("templateOf identifies main-right and single", () => {
    expect(templateOf(parseLayoutTree("main-right:tty,code,web")!)).toEqual({
      name: "main-right",
      slots: ["tty", "code", "web"],
    });
    expect(templateOf(parseLayoutTree("tty")!)).toEqual({ name: "single", slots: ["tty"] });
  });

  it("templateOf reports custom beyond the template structures", () => {
    const four: LayoutNode = {
      dir: "h",
      children: [
        { leaf: "tty" },
        { dir: "v", children: [{ leaf: "web" }, { dir: "h", children: [{ leaf: "code" }, { leaf: "gui" }] }] },
      ],
    };
    expect(templateOf(four).name).toBe("custom");
    expect(slotOrder(four)).toEqual(["tty", "web", "code", "gui"]);
  });

  it("template trees carry the main fraction and survive normalise", () => {
    const t = TEMPLATES["main-left"](["tty", "code", "web"]);
    expect(t).toMatchObject({ dir: "h" });
    const sizes = t && "sizes" in t ? t.sizes : undefined;
    expect(sizes?.[0]).toBeCloseTo(0.58);
    expect(sizes?.[1]).toBeCloseTo(0.42);
    const normed = normalise(t);
    // normalise keeps the structure and the outer sizes, making the inner
    // split's implicit equal shares explicit
    expect(serializeLayoutTree(normed)).toBe("h(tty,v(code,web))");
    expect(isCanonicalTree(normed)).toBe(true);
  });
});

// ── geometry ────────────────────────────────────────────────────────────────

describe("layoutRects", () => {
  it("splits the box with the 6px gutter", () => {
    const rects = layoutRects(parseLayoutTree("h(tty,web)")!, { x: 0, y: 0, w: 1600, h: 1000 });
    expect(rects.get("tty")).toEqual({ x: 0, y: 0, w: 797, h: 1000 });
    expect(rects.get("web")).toEqual({ x: 803, y: 0, w: 797, h: 1000 });
  });

  it("honours the per-split sizes override in pre-order", () => {
    const tree = parseLayoutTree("h(tty,v(code,web))")!;
    const rects = layoutRects(tree, { x: 0, y: 0, w: 1600, h: 1000 }, [[0.75, 0.25], [0.5, 0.5]]);
    const tty = rects.get("tty")!;
    expect(tty.w).toBeCloseTo((1600 - 6) * 0.75);
    const code = rects.get("code")!;
    expect(code.h).toBeCloseTo((1000 - 6) * 0.5);
  });

  it("ignores a mis-shaped override entry", () => {
    const tree = parseLayoutTree("h(tty,web)")!;
    const rects = layoutRects(tree, { x: 0, y: 0, w: 1600, h: 1000 }, [[1, 2, 3]]);
    expect(rects.get("tty")!.w).toBeCloseTo(797);
  });
});

describe("layoutDividers", () => {
  it("derives one divider per sibling pair plus the T-junction intersection", () => {
    const tree = parseLayoutTree("h(tty,v(code,web))")!;
    const { dividers, intersections } = layoutDividers(tree, { x: 0, y: 0, w: 1600, h: 1000 });
    expect(dividers).toHaveLength(2);
    expect(dividers[0]).toMatchObject({ splitPath: [], boundary: 1, dir: "h" });
    expect(dividers[1]).toMatchObject({ splitPath: [1], boundary: 1, dir: "v" });
    expect(intersections).toHaveLength(1);
    expect(intersections[0].dividers).toEqual([0, 1]);
    expect(intersections[0].x).toBeCloseTo(797 + 3);
    expect(intersections[0].y).toBeCloseTo(497 + 3);
  });

  it("derives no intersections for a flat row", () => {
    const tree = parseLayoutTree("h(tty,code,web)")!;
    const { dividers, intersections } = layoutDividers(tree, { x: 0, y: 0, w: 1600, h: 1000 });
    expect(dividers).toHaveLength(2);
    expect(intersections).toHaveLength(0);
  });
});
