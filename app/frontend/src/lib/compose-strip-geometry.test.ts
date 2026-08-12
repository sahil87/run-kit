import { describe, it, expect } from "vitest";
import {
  computeStripGeometry,
  COMPOSE_STRIP_MIN_WIDTH,
} from "./compose-strip-geometry";

// These helpers back the compose strip's pane-aligned docking (R3):
// compose-strip.tsx measures the focused pane's container and its own outer
// row and hands both rects here. Covering the clamp / centering / containment
// arithmetic here proves the alignment math without a real layout engine.

describe("computeStripGeometry (pane-aligned compose strip)", () => {
  it("returns null for a null pane rect (no measurable target → full width)", () => {
    expect(computeStripGeometry(null, { left: 0, width: 1000 })).toBeNull();
  });

  it("returns null for a degenerate pane width (registrant unmounted mid-measure)", () => {
    expect(
      computeStripGeometry({ left: 100, width: 0 }, { left: 0, width: 1000 }),
    ).toBeNull();
  });

  it("tracks the pane's span exactly when the pane is wider than the clamp", () => {
    expect(
      computeStripGeometry({ left: 100, width: 600 }, { left: 0, width: 1000 }),
    ).toEqual({ left: 100, width: 600 });
  });

  it("offsets by the strip's own left edge (coordinates are strip-relative)", () => {
    // Strip row starts at x=220 (sidebar open); pane at x=400 → left 180.
    expect(
      computeStripGeometry({ left: 400, width: 500 }, { left: 220, width: 1000 }),
    ).toEqual({ left: 180, width: 500 });
  });

  it("clamps a narrow pane to the min width, centered on the pane's span", () => {
    // 300px pane at x=100 → 420px box centered: 100 + (300-420)/2 = 40.
    expect(
      computeStripGeometry({ left: 100, width: 300 }, { left: 0, width: 1000 }),
    ).toEqual({ left: 40, width: COMPOSE_STRIP_MIN_WIDTH });
  });

  it("shifts a centered narrow-pane box right to stay inside the strip (left edge)", () => {
    // 300px pane flush at the row's left edge → centered left would be -60;
    // containment shifts it to 0.
    expect(
      computeStripGeometry({ left: 0, width: 300 }, { left: 0, width: 1000 }),
    ).toEqual({ left: 0, width: COMPOSE_STRIP_MIN_WIDTH });
  });

  it("shifts a centered narrow-pane box left to stay inside the strip (right edge)", () => {
    // 300px pane flush at the row's right edge (x=700 of 1000) → centered
    // left would be 640, but 640+420 overflows; containment shifts to 580.
    expect(
      computeStripGeometry({ left: 700, width: 300 }, { left: 0, width: 1000 }),
    ).toEqual({ left: 580, width: COMPOSE_STRIP_MIN_WIDTH });
  });

  it("clamps a pane wider than the strip row to the row's width", () => {
    expect(
      computeStripGeometry({ left: -50, width: 1200 }, { left: 0, width: 1000 }),
    ).toEqual({ left: 0, width: 1000 });
  });

  it("keeps a pane-aligned box inside the strip when the pane overhangs the right edge", () => {
    // Pane extends past the row's right edge (side-scrolling board): the box
    // shifts left so its right edge lands on the row's right edge.
    expect(
      computeStripGeometry({ left: 900, width: 600 }, { left: 0, width: 1000 }),
    ).toEqual({ left: 400, width: 600 });
  });

  it("honors a custom min width", () => {
    expect(
      computeStripGeometry({ left: 100, width: 300 }, { left: 0, width: 1000 }, 500),
    ).toEqual({ left: 0, width: 500 });
  });
});
