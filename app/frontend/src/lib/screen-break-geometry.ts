/**
 * Seeded screen-break geometry — a pure, dependency-free port of the design
 * study's `buildBreak` (docs/wiki/screen-break-easter-egg-studies.html). One
 * impact point drives everything: 9 radial crack polylines, jittered ring
 * cracks, an 18-vertex jagged hole polygon, and 9 glass-shard sectors. The
 * seed is FIXED (default 7); only the impact point varies per run, so a given
 * `{W, H, P, R}` always produces byte-identical output (the determinism unit
 * test). No DOM, no React.
 */

export type BreakPoint = { x: number; y: number };

export type BreakShard = {
  /** Polygon `points` attribute, px space (`"x,y x,y …"`). */
  points: string;
  cx: number;
  cy: number;
  /** Unit radial direction away from the impact point. */
  dir: BreakPoint;
  /** px, 90–260. */
  speed: number;
  /** degrees, ±260. */
  spin: number;
};

export type BreakGeometry = {
  P: BreakPoint;
  R: number;
  W: number;
  H: number;
  crackDs: string[];
  ringDs: string[];
  shards: BreakShard[];
  /** The jagged hole polygon at open amount `h ∈ [0,1]`, in px space. */
  holePts: (h: number) => BreakPoint[];
};

export function clamp(v: number, a = 0, b = 1): number {
  return Math.max(a, Math.min(b, v));
}

export function smooth(x: number): number {
  const c = clamp(x);
  return c * c * (3 - 2 * c);
}

export function easeOut(x: number): number {
  return 1 - Math.pow(1 - clamp(x), 3);
}

export function easeIn(x: number): number {
  return Math.pow(clamp(x), 3);
}

/** Fixed-seed LCG — identical streams make identical frames. */
function seededRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const f1 = (n: number) => n.toFixed(1);
const f4 = (n: number) => n.toFixed(4);

type Crack = { pts: { x: number; y: number; r: number }[]; j: number; k: number };

/** Point at radial distance `r` along a crack polyline (linear interpolation). */
function at(c: Crack, r: number): BreakPoint {
  const p = c.pts;
  for (let i = 1; i < p.length; i++) {
    if (p[i].r >= r) {
      const f = (r - p[i - 1].r) / (p[i].r - p[i - 1].r);
      return { x: p[i - 1].x + (p[i].x - p[i - 1].x) * f, y: p[i - 1].y + (p[i].y - p[i - 1].y) * f };
    }
  }
  return p[p.length - 1];
}

export function buildBreak({
  W,
  H,
  P,
  R,
  n = 9,
  seed = 7,
  rings = [],
}: {
  W: number;
  H: number;
  P: BreakPoint;
  R: number;
  n?: number;
  seed?: number;
  rings?: number[];
}): BreakGeometry {
  const rand = seededRng(seed);
  const maxD =
    Math.max(
      ...([
        [0, 0],
        [W, 0],
        [0, H],
        [W, H],
      ] as const).map(([x, y]) => Math.hypot(x - P.x, y - P.y)),
    ) + 80;
  const base = rand() * Math.PI * 2;
  const angles = Array.from({ length: n }, (_, i) => base + (i * 2 * Math.PI) / n + (rand() - 0.5) * 0.4).sort(
    (a, b) => a - b,
  );
  const cracks: Crack[] = angles.map((a0) => {
    const pts = [{ x: P.x, y: P.y, r: 0 }];
    let r = 0;
    let a = a0;
    while (r < maxD) {
      r += 24 + rand() * 40;
      a += (rand() - 0.5) * 0.28;
      pts.push({ x: P.x + Math.cos(a) * r, y: P.y + Math.sin(a) * r, r });
    }
    return { pts, j: 0.82 + rand() * 0.36, k: 0.5 + rand() * 0.25 };
  });

  const holePts = (h: number): BreakPoint[] => {
    const Rt = Math.max(R * h, 0.02);
    const out: BreakPoint[] = [];
    for (let i = 0; i < n; i++) {
      const c = cracks[i];
      const c2 = cracks[(i + 1) % n];
      const v1 = at(c, Rt * c.j);
      const v2 = at(c2, Rt * c2.j);
      const a1 = Math.atan2(v1.y - P.y, v1.x - P.x);
      let a2 = Math.atan2(v2.y - P.y, v2.x - P.x);
      if (a2 < a1) a2 += 2 * Math.PI;
      const am = (a1 + a2) / 2;
      out.push(v1, { x: P.x + Math.cos(am) * Rt * c.k, y: P.y + Math.sin(am) * Rt * c.k });
    }
    return out;
  };

  const crackDs = cracks.map((c) => "M" + c.pts.map((p) => `${f1(p.x)} ${f1(p.y)}`).join("L"));
  const ringDs = rings.map((rr) => {
    const pts: string[] = [];
    const m = 18;
    for (let i = 0; i < m; i++) {
      const a = (i * 2 * Math.PI) / m + (rand() - 0.5) * 0.15;
      const r = rr * (0.88 + rand() * 0.24);
      pts.push(`${f1(P.x + Math.cos(a) * r)} ${f1(P.y + Math.sin(a) * r)}`);
    }
    return "M" + pts.join("L") + "Z";
  });

  const finalHole = holePts(1);
  const shards: BreakShard[] = [];
  for (let i = 0; i < n; i++) {
    const c = cracks[i];
    const c2 = cracks[(i + 1) % n];
    const poly = [at(c, R * 0.2), finalHole[2 * i], finalHole[2 * i + 1], finalHole[(2 * i + 2) % (2 * n)], at(c2, R * 0.24)];
    const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    const dl = Math.hypot(cx - P.x, cy - P.y) || 1;
    shards.push({
      points: poly.map((p) => `${f1(p.x)},${f1(p.y)}`).join(" "),
      cx,
      cy,
      dir: { x: (cx - P.x) / dl, y: (cy - P.y) / dl },
      speed: 90 + rand() * 170,
      spin: (rand() - 0.5) * 520,
    });
  }
  return { P, R, W, H, crackDs, ringDs, shards, holePts };
}

/** The hole polygon normalized to 0–1 for `objectBoundingBox` clip paths. */
export function normalizeHole(pts: BreakPoint[], W: number, H: number): string {
  return "M" + pts.map((p) => `${f4(p.x / W)} ${f4(p.y / H)}`).join("L") + "Z";
}

/** The normalized hole path string at open amount `h`. */
export function holePathAt(geo: BreakGeometry, h: number): string {
  return normalizeHole(geo.holePts(h), geo.W, geo.H);
}

/** Impact point: uniform inside the central box of the viewport. */
export function pickImpact(W: number, H: number, rand: () => number = Math.random): BreakPoint {
  return { x: (0.25 + rand() * 0.5) * W, y: (0.25 + rand() * 0.5) * H };
}

/** Hole radius: ~10.5 % of viewport width, clamped to [64, 160] px. */
export function radiusFor(W: number): number {
  return clamp(0.105 * W, 64, 160);
}
