import { describe, it, expect, beforeEach } from "vitest";
import {
  availableSurfaces,
  panelStorageKey,
  readStoredPanel,
  clampBoundary,
  clampRatio,
} from "./right-panel";
import type { ViewWindow } from "./window-view";

const webWin: ViewWindow = { webTabs: ["http://localhost:8080"] };
const plain: ViewWindow = {};

beforeEach(() => {
  localStorage.clear();
});

describe("availableSurfaces", () => {
  // The registry is the SHARED tileable-surface
  // registry (`availableTiles`): `tty` and `web` are always available (`tty`
  // first), then `code` per capability.
  it("offers tty first, then web — unconditionally (260821-zqlq)", () => {
    expect(availableSurfaces(webWin)).toEqual(["tty", "web"]);
    expect(availableSurfaces(plain)).toEqual(["tty", "web"]);
    expect(availableSurfaces(null)).toEqual(["tty", "web"]);
    expect(availableSurfaces(undefined)).toEqual(["tty", "web"]);
  });

  // The `code` surface (260811-k3vp, simplified by 260811-a2bo) mirrors the
  // view registry's gate: gitRoot derived (the port resolves by convention).
  // Registry order is tty, code, web (surface-layout R8).
  it("offers code exactly when gitRoot is set", () => {
    const codeWin: ViewWindow = { gitRoot: "/repo" };
    expect(availableSurfaces(codeWin)).toEqual(["tty", "code", "web"]);
    expect(availableSurfaces({ webTabs: ["http://localhost:8080"], gitRoot: "/repo" }))
      .toEqual(["tty", "code", "web"]);
  });

  it("gates code off without a gitRoot", () => {
    expect(availableSurfaces(plain)).toEqual(["tty", "web"]);
    expect(availableSurfaces(null)).toEqual(["tty", "web"]);
  });
});

describe("legacy panel storage key (read-only seed)", () => {
  it("builds the value-bearing per-window key", () => {
    expect(panelStorageKey("srv", "@3")).toBe("runkit-window-panel:srv:@3");
  });

  it("reads a stored surface under the window's key (absent = undefined)", () => {
    expect(readStoredPanel("srv", "@3")).toBeUndefined();
    localStorage.setItem(panelStorageKey("srv", "@3"), "web");
    expect(readStoredPanel("srv", "@3")).toBe("web");
  });

  it("scopes the key per server + window", () => {
    localStorage.setItem(panelStorageKey("srv", "@3"), "web");
    expect(readStoredPanel("srv", "@4")).toBeUndefined();
    expect(readStoredPanel("other", "@3")).toBeUndefined();
  });
});

describe("clampRatio", () => {
  // The divider-boundary clamp (260812-ab5v R5): the 280px floor bounds BOTH
  // sides, so the range is [floor, 100 − floor] — no 65% cap (a dominant main
  // tile is legitimate in `main-*` shapes).
  it("passes through an in-range percentage", () => {
    expect(clampRatio(50, 1000)).toBe(50);
  });

  it("applies the 280px floor on both sides of the boundary", () => {
    // 280px on a 1000px container = 28% on each side.
    expect(clampRatio(10, 1000)).toBeCloseTo(28);
    expect(clampRatio(90, 1000)).toBeCloseTo(72);
  });

  it("allows dominant tiles (no upper cap short of the far floor)", () => {
    expect(clampRatio(80, 2000)).toBe(80);
  });

  it("skips the floor when the container is unmeasured", () => {
    expect(clampRatio(10, 0)).toBe(10);
    expect(clampRatio(90, 0)).toBe(90);
  });

  it("collapses to 50/50 when the container cannot fit two floors", () => {
    // Below 2 × 280px the range [floor, 100 − floor] inverts; the boundary
    // must stay inside [0, 100] and treat both tiles alike.
    expect(clampRatio(10, 500)).toBe(50); // floor = 56%
    expect(clampRatio(90, 500)).toBe(50);
    expect(clampRatio(50, 200)).toBe(50); // floor = 140%
    expect(clampRatio(10, 200)).toBe(50);
  });

  it("still honors the floor at exactly two floors of width", () => {
    // 560px = 2 × 280px — the last width where the range is non-empty.
    expect(clampRatio(10, 560)).toBeCloseTo(50);
    expect(clampRatio(90, 560)).toBeCloseTo(50);
  });
});

describe("clampBoundary", () => {
  // Sibling-boundary chaining is a row/col property only — those shapes'
  // two ratios are same-axis dividers. A main-* shape's ratios live on
  // DIFFERENT axes (main-left/right: 0 = x column, 1 = y row; main-top
  // swaps), so each clamps to clampRatio's own-axis band alone.

  it("frees a main-left y-seam the same-axis chain used to pin (short viewport)", () => {
    // 700px-tall grid → floorY = 40%. Chaining against the x ratio (22)
    // would make the band [62, 60] — empty, pinned at 62. The own-axis band
    // is [40, 60] and the seam follows the pointer within it.
    expect(clampBoundary("main-left", [22, 37], 1, 10, 700)).toBeCloseTo(40);
    expect(clampBoundary("main-left", [22, 37], 1, 50, 700)).toBe(50);
    expect(clampBoundary("main-left", [22, 37], 1, 90, 700)).toBeCloseTo(60);
  });

  it("clamps each main-* boundary independently of the other ratio", () => {
    // 1000px axis → floor = 28%. For every main-* shape and both indices,
    // the result must not change when the OTHER ratio moves.
    for (const shape of ["main-left", "main-right", "main-top"] as const) {
      for (const raw of [5, 50, 95]) {
        expect(clampBoundary(shape, [10, 50], 1, raw, 1000)).toBe(
          clampBoundary(shape, [80, 50], 1, raw, 1000),
        );
        expect(clampBoundary(shape, [50, 10], 0, raw, 1000)).toBe(
          clampBoundary(shape, [50, 80], 0, raw, 1000),
        );
      }
      // The band is exactly clampRatio's: no cap short of the far floor.
      expect(clampBoundary(shape, [50, 10], 0, 90, 1000)).toBeCloseTo(72);
    }
  });

  it("keeps row/col sibling chaining: a divider never crosses its neighbor", () => {
    // 1000px axis → floor = 28%. Divider 0 of [30, 60] may reach at most
    // 60 − 28 = 32; divider 1 may reach down to 30 + 28 = 58 and up to 72.
    expect(clampBoundary("row", [30, 60], 0, 80, 1000)).toBeCloseTo(32);
    expect(clampBoundary("row", [30, 60], 0, 5, 1000)).toBeCloseTo(28);
    expect(clampBoundary("col", [30, 60], 1, 40, 1000)).toBeCloseTo(58);
    expect(clampBoundary("col", [30, 60], 1, 95, 1000)).toBeCloseTo(72);
  });

  it("degenerates an inverted row/col sibling band to the near floor edge", () => {
    // Divider 0 of [30, 45]: band [28, 45 − 28 = 17] is empty — the boundary
    // pins at prev + floor (28) instead of crossing or stranding the sibling.
    expect(clampBoundary("col", [30, 45], 0, 40, 1000)).toBeCloseTo(28);
    expect(clampBoundary("col", [30, 45], 0, 5, 1000)).toBeCloseTo(28);
  });

  it("collapses a degenerate independent axis to 50/50 via clampRatio", () => {
    // Below 2 × 280px on the boundary's own axis the floor band inverts and
    // clampRatio's 50/50 collapse applies — for split-* and main-* alike.
    expect(clampBoundary("split-v", [40], 0, 10, 500)).toBe(50);
    expect(clampBoundary("main-left", [22, 37], 1, 90, 500)).toBe(50);
  });
});
