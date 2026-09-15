import { describe, it, expect } from "vitest";
import {
  buildBreak,
  holePathAt,
  normalizeHole,
  pickImpact,
  radiusFor,
} from "./screen-break-geometry";

const INPUT = { W: 1280, H: 800, P: { x: 640, y: 400 }, R: 134, rings: [227.8, 361.8] };

function serializable(geo: ReturnType<typeof buildBreak>) {
  return {
    P: geo.P,
    R: geo.R,
    W: geo.W,
    H: geo.H,
    crackDs: geo.crackDs,
    ringDs: geo.ringDs,
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

  it("produces 9 cracks, the requested rings, 9 shards, and an 18-vertex hole", () => {
    const geo = buildBreak(INPUT);
    expect(geo.crackDs).toHaveLength(9);
    expect(geo.ringDs).toHaveLength(2);
    expect(geo.shards).toHaveLength(9);
    expect(geo.holePts(1)).toHaveLength(18);
    expect(buildBreak({ ...INPUT, rings: [] }).ringDs).toHaveLength(0);
  });

  it("ends every crack polyline outside the W×H box", () => {
    const geo = buildBreak(INPUT);
    for (const d of geo.crackDs) {
      const last = d.split("L").pop()!.split(" ").map(Number);
      const [x, y] = last;
      expect(x < 0 || x > INPUT.W || y < 0 || y > INPUT.H).toBe(true);
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
    // 18 vertices → 18 coordinate pairs.
    expect(d.slice(1, -1).split("L")).toHaveLength(18);
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
