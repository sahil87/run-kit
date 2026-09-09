import { describe, expect, it } from "vitest";
import {
  FIGURE_ZOOM_LEVELS,
  FIGURE_ZOOM_MAX,
  clampTranslation,
  fitScale,
  fitState,
  formatPercent,
  isPannable,
  minScale,
  parseViewBox,
  pinchScale,
  sameScale,
  stepScale,
  wheelScale,
  zoomAboutPoint,
} from "./pan-zoom";

const WIDE = { w: 3000, h: 1200 };
const SMALL = { w: 200, h: 100 };
const BOX = { w: 800, h: 600 };

describe("fitScale", () => {
  it("fits the width in width mode and both axes in contain mode", () => {
    expect(fitScale(WIDE, BOX, "width")).toBeCloseTo(800 / 3000, 6);
    expect(fitScale(WIDE, BOX, "contain")).toBeCloseTo(Math.min(800 / 3000, 600 / 1200), 6);
  });

  it("never upscales small content past natural size", () => {
    expect(fitScale(SMALL, BOX, "width")).toBe(1);
    expect(fitScale(SMALL, BOX, "contain")).toBe(1);
  });

  it("returns 1 for a degenerate natural or container size", () => {
    expect(fitScale({ w: 0, h: 0 }, BOX, "width")).toBe(1);
    expect(fitScale(WIDE, { w: 0, h: 600 }, "contain")).toBe(1);
    expect(fitScale({ w: NaN, h: 10 }, BOX, "width")).toBe(1);
  });

  it("minScale is the fit itself", () => {
    expect(minScale(0.43)).toBe(0.43);
  });
});

describe("zoomAboutPoint", () => {
  it("keeps the content point under the anchor fixed when zooming in", () => {
    const next = zoomAboutPoint({ scale: 0.5, tx: 0, ty: 0 }, 1, { x: 100, y: 50 });
    expect(next.scale).toBe(1);
    expect(next.tx).toBeCloseTo(-100, 6);
    expect(next.ty).toBeCloseTo(-50, 6);
    // Content coordinate under (100, 50): (100 - tx) / scale is invariant.
    expect((100 - next.tx) / next.scale).toBeCloseTo((100 - 0) / 0.5, 6);
  });

  it("keeps the anchor fixed when zooming out from an offset state", () => {
    const state = { scale: 2, tx: -300, ty: -120 };
    const anchor = { x: 250, y: 90 };
    const before = { x: (anchor.x - state.tx) / state.scale, y: (anchor.y - state.ty) / state.scale };
    const next = zoomAboutPoint(state, 1.25, anchor);
    expect((anchor.x - next.tx) / next.scale).toBeCloseTo(before.x, 6);
    expect((anchor.y - next.ty) / next.scale).toBeCloseTo(before.y, 6);
  });
});

describe("clampTranslation", () => {
  it("centers on an axis where the scaled content fits and clamps where it overflows", () => {
    // scale 0.5: 1500×600 in 800×600 → x overflows, y exactly fits (centered at 0).
    const clamped = clampTranslation({ scale: 0.5, tx: 500, ty: 999 }, WIDE, BOX);
    expect(clamped.tx).toBe(0);
    expect(clamped.ty).toBe(0);
    const far = clampTranslation({ scale: 0.5, tx: -5000, ty: 0 }, WIDE, BOX);
    expect(far.tx).toBe(800 - 1500);
  });

  it("centers small content on both axes", () => {
    const c = clampTranslation({ scale: 1, tx: -40, ty: 12 }, SMALL, BOX);
    expect(c.tx).toBe((800 - 200) / 2);
    expect(c.ty).toBe((600 - 100) / 2);
  });

  it("fitState is the fit scale with a centered translation", () => {
    const s = fitState(WIDE, BOX, "contain");
    expect(s.scale).toBeCloseTo(600 / 1200 < 800 / 3000 ? 600 / 1200 : 800 / 3000, 6);
    expect(s.tx).toBeCloseTo((800 - 3000 * s.scale) / 2, 6);
    expect(s.ty).toBeCloseTo((600 - 1200 * s.scale) / 2, 6);
  });
});

describe("stepScale", () => {
  it("steps to the next ladder level strictly beyond an off-ladder fit, without snapping first", () => {
    expect(stepScale(0.43, "in", 0.43)).toBe(0.5);
    expect(stepScale(0.5, "in", 0.43)).toBe(0.67);
  });

  it("clamps at the fit minimum and at the figure max", () => {
    expect(stepScale(0.5, "out", 0.43)).toBe(0.43);
    expect(stepScale(0.43, "out", 0.43)).toBe(0.43);
    expect(stepScale(8, "in", 0.43)).toBe(FIGURE_ZOOM_MAX);
    expect(stepScale(6, "in", 0.43)).toBe(8);
  });

  it("in then out from a ladder stop returns to that stop", () => {
    for (const level of FIGURE_ZOOM_LEVELS.slice(1, -1)) {
      expect(stepScale(stepScale(level, "in", 0.1), "out", 0.1)).toBeCloseTo(level, 9);
    }
  });
});

describe("wheelScale / pinchScale", () => {
  it("maps a −60 wheel to exp(0.6) and clamps at the bounds", () => {
    expect(wheelScale(1, -60, 0.2)).toBeCloseTo(Math.exp(0.6), 6);
    expect(wheelScale(7.9, -600, 0.2)).toBe(FIGURE_ZOOM_MAX);
    expect(wheelScale(0.25, 600, 0.2)).toBe(0.2);
  });

  it("pinch multiplies the gesture-start base and clamps", () => {
    expect(pinchScale(0.5, 2, 0.2)).toBe(1);
    expect(pinchScale(0.5, 0.1, 0.4)).toBe(0.4);
    expect(pinchScale(5, 3, 0.2)).toBe(FIGURE_ZOOM_MAX);
  });
});

describe("formatPercent / parseViewBox / isPannable / sameScale", () => {
  it("rounds the percent readout", () => {
    expect(formatPercent(0.2667)).toBe("27%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(1.006)).toBe("101%");
  });

  it("parses a valid viewBox and rejects garbage", () => {
    expect(parseViewBox("0 0 3000 1200")).toEqual({ w: 3000, h: 1200 });
    expect(parseViewBox("-10, -5, 400.5, 200")).toEqual({ w: 400.5, h: 200 });
    expect(parseViewBox(null)).toBeNull();
    expect(parseViewBox("0 0 3000")).toBeNull();
    expect(parseViewBox("0 0 0 100")).toBeNull();
    expect(parseViewBox("a b c d")).toBeNull();
  });

  it("isPannable is true only when the scaled content exceeds the container", () => {
    expect(isPannable(800 / 3000, WIDE, BOX)).toBe(false);
    expect(isPannable(0.5, WIDE, BOX)).toBe(true);
    expect(isPannable(1, SMALL, BOX)).toBe(false);
    // Exactly equal on both axes is not pannable.
    expect(isPannable(1, { w: 800, h: 600 }, BOX)).toBe(false);
  });

  it("sameScale tolerates float noise", () => {
    expect(sameScale(0.1 + 0.2, 0.3)).toBe(true);
    expect(sameScale(0.3, 0.31)).toBe(false);
  });
});
