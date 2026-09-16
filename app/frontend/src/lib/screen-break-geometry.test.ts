import { describe, it, expect } from "vitest";
import {
  buildBreak,
  holePathAt,
  normalizeHole,
  pickImpact,
  radiusFor,
} from "./screen-break-geometry";

const INPUT = { W: 1280, H: 800, P: { x: 640, y: 400 }, R: 134 };

const LINE_COLORS = ["#ff3ad6", "#ff3ad6", "#35e8ff", "#35e8ff", "#62ff6a", "#ffffff", "#ffd23d"];

function serializable(geo: ReturnType<typeof buildBreak>) {
  return {
    P: geo.P,
    R: geo.R,
    W: geo.W,
    H: geo.H,
    n: geo.n,
    strokes: geo.strokes,
    lines: geo.lines,
    shards: geo.shards,
    hole0: geo.holePts(0),
    holeHalf: geo.holePts(0.5),
    hole1: geo.holePts(1),
  };
}

describe("buildBreak", () => {
  it("is deterministic: identical input yields identical output", () => {
    expect(serializable(buildBreak(INPUT))).toEqual(serializable(buildBreak(INPUT)));
  });

  it("produces 8–10 primaries, n shards, and a 2n-vertex hole", () => {
    const geo = buildBreak(INPUT);
    expect(geo.n).toBeGreaterThanOrEqual(8);
    expect(geo.n).toBeLessThanOrEqual(10);
    expect(geo.shards).toHaveLength(geo.n);
    expect(geo.holePts(1)).toHaveLength(2 * geo.n);
  });

  it("emits each primary as three smooth pieces chaining s0 = 0 → s1 = 1", () => {
    const geo = buildBreak(INPUT);
    const groups = new Map<string, { s0: number; s1: number }[]>();
    for (const s of geo.strokes.filter((s) => s.ease === "smooth")) {
      const key = `${s.start}|${s.dur}`;
      groups.set(key, [...(groups.get(key) ?? []), { s0: s.s0, s1: s.s1 }]);
    }
    expect(groups.size).toBe(geo.n);
    for (const pieces of groups.values()) {
      expect(pieces).toHaveLength(3);
      pieces.sort((a, b) => a.s0 - b.s0);
      expect(pieces[0].s0).toBe(0);
      expect(pieces[2].s1).toBe(1);
      expect(pieces[1].s0).toBeCloseTo(pieces[0].s1, 10);
      expect(pieces[2].s0).toBeCloseTo(pieces[1].s1, 10);
    }
  });

  it("keeps every stroke inside its timing envelope with positive widths", () => {
    const geo = buildBreak(INPUT);
    expect(geo.strokes.length).toBeGreaterThan(0);
    for (const s of geo.strokes) {
      expect(s.start).toBeGreaterThanOrEqual(0);
      expect(s.dur).toBeGreaterThan(0);
      expect(s.start + s.dur).toBeLessThanOrEqual(1);
      expect(s.w).toBeGreaterThan(0);
      expect(s.lw).toBeGreaterThan(0);
      expect(s.s0).toBeGreaterThanOrEqual(0);
      expect(s.s1).toBeLessThanOrEqual(1);
    }
  });

  it("produces 5–8 dead-pixel lines, in bounds, in the palette, in the start window", () => {
    const geo = buildBreak(INPUT);
    expect(geo.lines.length).toBeGreaterThanOrEqual(5);
    expect(geo.lines.length).toBeLessThanOrEqual(8);
    for (const l of geo.lines) {
      for (const [x, y] of [
        [l.x1, l.y1],
        [l.x2, l.y2],
      ]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(INPUT.W);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(INPUT.H);
      }
      expect(l.start).toBeGreaterThanOrEqual(0.17);
      expect(l.start).toBeLessThanOrEqual(0.55);
      expect(LINE_COLORS).toContain(l.color);
    }
  });

  it("gives every shard a unit dir, speed in [90,260], and spin in [-260,260]", () => {
    const geo = buildBreak(INPUT);
    for (const s of geo.shards) {
      expect(Math.hypot(s.dir.x, s.dir.y)).toBeCloseTo(1, 6);
      expect(s.speed).toBeGreaterThanOrEqual(90);
      expect(s.speed).toBeLessThanOrEqual(260);
      expect(Math.abs(s.spin)).toBeLessThanOrEqual(260);
    }
  });
});

describe("normalizeHole / holePathAt", () => {
  it("normalizes every coordinate into [0, 1]", () => {
    const geo = buildBreak(INPUT);
    const d = holePathAt(geo, 1);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    for (const tok of d.slice(1, -1).split("L")) {
      const [x, y] = tok.split(" ").map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    // 2n vertices → 2n coordinate pairs.
    expect(d.slice(1, -1).split("L")).toHaveLength(2 * geo.n);
  });

  it("matches normalizeHole over the raw points", () => {
    const geo = buildBreak(INPUT);
    expect(holePathAt(geo, 0.5)).toBe(normalizeHole(geo.holePts(0.5), INPUT.W, INPUT.H));
  });
});

describe("pickImpact", () => {
  it("picks uniformly inside the central 25–75 % box", () => {
    expect(pickImpact(1440, 900, () => 0)).toEqual({ x: 360, y: 225 });
    expect(pickImpact(1440, 900, () => 1)).toEqual({ x: 1080, y: 675 });
    const mid = pickImpact(1440, 900, () => 0.5);
    expect(mid.x).toBeCloseTo(720);
    expect(mid.y).toBeCloseTo(450);
  });
});

describe("radiusFor", () => {
  it("is ~10.5 % of the viewport width, clamped to [64, 160]", () => {
    expect(radiusFor(1440)).toBeCloseTo(151.2);
    expect(radiusFor(400)).toBe(64);
    expect(radiusFor(2000)).toBe(160);
  });
});
