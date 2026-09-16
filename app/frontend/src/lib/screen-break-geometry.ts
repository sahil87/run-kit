/**
 * Seeded screen-break geometry — a pure, dependency-free port of the design
 * study's `buildBreak` (docs/wiki/screen-break-crack-realism-studies.html).
 * One impact point drives everything: 8–10 uneven radial primaries that taper
 * and sometimes stop mid-pane, branches and sub-branches forking off them,
 * partial arcs stitching neighbouring primaries, a crushed zone of
 * micro-cracks around the impact, a 2n-vertex jagged hole polygon, n
 * glass-shard sectors, and 5–8 dead-pixel LCD lines. Every stroke carries its
 * own `{start, dur, ease, s0, s1}` window on the 0–1 flight so the web creeps
 * in over seconds instead of snapping in. The seed is FIXED (default 7); only
 * the impact point varies per run, so a given `{W, H, P, R}` always produces
 * byte-identical output (the determinism unit test). No DOM, no React.
 */

export type BreakPoint = { x: number; y: number };

export type BreakStroke = {
  /** SVG path data, px space. */
  d: string;
  /** Dark core stroke width, px. */
  w: number;
  /** White highlight stroke width, px. */
  lw: number;
  /** Fraction of the flight at which this crack starts drawing. */
  start: number;
  /** Fraction of the flight the whole crack takes to draw. */
  dur: number;
  /** This piece's fractional span of its parent crack … */
  s0: number;
  /** … so tapered pieces draw sequentially as ONE crack. */
  s1: number;
  ease: "smooth" | "out";
};

export type BreakLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** One of the LCD palette (`LINE_COLORS`). */
  color: string;
  /** 1 (hairline) or 2–4 (band). */
  w: number;
  /** .9 (hairline) or .45 (band). */
  op: number;
  /** Fraction of the flight; pops in instantly. */
  start: number;
  /** Flicker phase, 0–100. */
  flick: number;
};

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
  /** Primaries = shards, 8–10. */
  n: number;
  /** Primaries (3 pieces each) + branches + sub-branches + arcs + micro-cracks. */
  strokes: BreakStroke[];
  /** Dead-pixel lines, 5–8. */
  lines: BreakLine[];
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
const TAU = Math.PI * 2;

// ── Tuning constants (the generator's only numbers) ─────────────────────────

const CORNER_MARGIN_PX = 80; // maxD extends this far past the farthest corner
const VIEW_MARGIN_PX = 40; // inView's off-screen allowance

const PRIMARY_COUNT_BASE = 8; // n = 8 + floor(rand * PRIMARY_COUNT_RAND)
const PRIMARY_COUNT_RAND = 3;
const PRIMARY_ANGLE_JITTER = 0.9; // fraction of the even spacing
const PRIMARY_FULL_CHANCE = 0.65; // the rest stop mid-pane
const PRIMARY_SHORT_MIN = 0.3; // fraction of maxD for a short primary …
const PRIMARY_SHORT_RAND = 0.4;
const PRIMARY_STEP_BASE = 16; // px per walk step …
const PRIMARY_STEP_RAND = 30;
const PRIMARY_DRIFT = 0.22; // rad of heading drift per step
const PRIMARY_KINK = 0.6; // rad, on a KINK_CHANCE roll
const KINK_CHANCE = 0.1;
const PRIMARY_CUTS = [0.3, 0.62]; // taper split points along the polyline
const PRIMARY_CORE_W = [3.0, 1.9, 1.0];
const PRIMARY_HI_W = [1.1, 0.8, 0.5];
const PRIMARY_START_BASE = 0.025; // flight fractions …
const PRIMARY_START_RAND = 0.05;
const PRIMARY_DUR_BASE = 0.12;
const PRIMARY_DUR_RAND = 0.06;
const HOLE_J_BASE = 0.82; // hole vertex radial jitter …
const HOLE_J_RAND = 0.36;
const HOLE_K_BASE = 0.5;
const HOLE_K_RAND = 0.25;

const BRANCH_COUNT_BASE = 1; // per primary: 1 + floor(rand * BRANCH_COUNT_RAND)
const BRANCH_COUNT_RAND = 3;
const BRANCH_MIN_R_MULT = 1.25; // ×R — no branch inside the crushed zone
const BRANCH_FROM_MIN = 0.25; // fraction of the parent's length …
const BRANCH_FROM_RAND = 0.5;
const BRANCH_SKIP_FRAC = 0.9; // skip a branch that would start past this
const BRANCH_ANGLE_BASE = 0.35; // rad off the parent's local heading …
const BRANCH_ANGLE_RAND = 0.5;
const BRANCH_MIN_LEN = 28; // px
const BRANCH_LEN_MIN = 0.15; // fraction of the remaining parent …
const BRANCH_LEN_RAND = 0.35;
const BRANCH_STEP_BASE = 12;
const BRANCH_STEP_RAND = 22;
const BRANCH_DRIFT = 0.25;
const BRANCH_KINK = 0.5;
const BRANCH_CUT = 0.45;
const BRANCH_CORE_W = [1.5, 0.8];
const BRANCH_HI_W = [0.6, 0.4];
const BRANCH_START_BASE = 0.17;
const BRANCH_START_RAND = 0.35;
const BRANCH_DUR_BASE = 0.06;
const BRANCH_DUR_RAND = 0.12;
const SUB_BRANCH_CHANCE = 0.35;
const SUB_BRANCH_LEN_MIN = 0.3; // fraction of the remaining branch …
const SUB_BRANCH_LEN_RAND = 0.3;
const SUB_BRANCH_CORE_W = [0.9, 0.5];
const SUB_BRANCH_HI_W = [0.4, 0.3];
const SUB_BRANCH_START_PARENT_FRAC = 0.6;
const SUB_BRANCH_START_RAND = 0.1;
const TIP_MIN_R_MULT = 1.4; // ×R — tips closer to the impact spawn no line

const ARC_RADII_MULTS = [1.35, 2.1, 3.2, 4.6, 6.5]; // ×R
const ARC_OCCUPANCY = 0.5; // rand above this skips the pair
const ARC_R_JITTER_BASE = 0.92;
const ARC_R_JITTER_RAND = 0.16;
const ARC_STEPS_BASE = 3; // intermediate points: 3 + floor(rand * 3)
const ARC_STEPS_RAND = 3;
const ARC_MID_JITTER_BASE = 0.95;
const ARC_MID_JITTER_RAND = 0.1;
const ARC_W_BASE = 1.0; // core width falls with radius …
const ARC_W_PER_MULT = 0.06;
const ARC_HI_W = 0.5;
const ARC_START_BASE = 0.17;
const ARC_START_RAND = 0.4;
const ARC_DUR_BASE = 0.04;
const ARC_DUR_RAND = 0.08;

const MICRO_COUNT = 26;
const MICRO_R_MIN = 1.02; // ×R annulus …
const MICRO_R_RAND = 0.4;
const MICRO_LEN_MIN = 5; // px …
const MICRO_LEN_RAND = 12;
const MICRO_W = 0.8;
const MICRO_HI_W = 0.4;
const MICRO_START_BASE = 0.01;
const MICRO_START_RAND = 0.06;
const MICRO_DUR = 0.04;

const SHARD_INNER_R = 0.2; // ×R …
const SHARD_OUTER_R = 0.24;
const SHARD_SPEED_MIN = 90;
const SHARD_SPEED_RAND = 170;
const SHARD_SPIN_RANGE = 520;

const LINE_COLORS = ["#ff3ad6", "#ff3ad6", "#35e8ff", "#35e8ff", "#62ff6a", "#ffffff", "#ffd23d"];
const LINE_MIN_TIPS = 5; // below this, primaries add fallback sources
const LINE_FALLBACK_LEN = 0.7; // fraction of the primary …
const LINE_FALLBACK_R_MULT = 2.5; // ×R cap
const LINE_FALLBACK_START = 0.2;
const LINE_COUNT_BASE = 5; // 5 + floor(rand * 4)
const LINE_COUNT_RAND = 4;
const LINE_VERTICAL_CHANCE = 0.6;
const LINE_FULL_CHANCE = 0.5;
const LINE_BAND_CHANCE = 0.3;
const LINE_BAND_W_MIN = 2;
const LINE_BAND_W_RAND = 2;
const LINE_BAND_OP = 0.45;
const LINE_HAIR_OP = 0.9;
const LINE_START_MIN = 0.17;
const LINE_START_MAX = 0.55;
const LINE_START_RAND = 0.1;
const LINE_FLICK_RAND = 100;

// ── Internals ────────────────────────────────────────────────────────────────

type WalkPoint = { x: number; y: number; r: number };

/** A primary crack: walk polyline plus its hole/timing records. */
type Primary = {
  pts: WalkPoint[];
  len: number;
  j: number;
  k: number;
  start: number;
  dur: number;
};

/** A branch or sub-branch crack: polyline plus its timing window. */
type Branch = { pts: WalkPoint[]; start: number; dur: number };

/** Point at radial distance `r` along a crack polyline (linear interpolation). */
function at(c: { pts: WalkPoint[] }, r: number): BreakPoint {
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
  seed = 7,
}: {
  W: number;
  H: number;
  P: BreakPoint;
  R: number;
  seed?: number;
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
    ) + CORNER_MARGIN_PX;
  const inView = (p: BreakPoint) =>
    p.x > -VIEW_MARGIN_PX && p.x < W + VIEW_MARGIN_PX && p.y > -VIEW_MARGIN_PX && p.y < H + VIEW_MARGIN_PX;

  /** Local heading of the segment containing `r` (last segment's past the end). */
  const dirAt = (c: { pts: WalkPoint[] }, r: number): number => {
    const p = c.pts;
    for (let i = 1; i < p.length; i++) {
      if (p[i].r >= r) return Math.atan2(p[i].y - p[i - 1].y, p[i].x - p[i - 1].x);
    }
    const a = p[p.length - 1];
    const b = p[p.length - 2];
    return Math.atan2(a.y - b.y, a.x - b.x);
  };

  const walk = (
    from: BreakPoint,
    a: number,
    len: number,
    step: [number, number],
    drift: number,
    kink: number,
  ): WalkPoint[] => {
    const pts: WalkPoint[] = [{ x: from.x, y: from.y, r: 0 }];
    let r = 0;
    while (r < len) {
      r += step[0] + rand() * step[1];
      a += (rand() - 0.5) * drift;
      if (rand() < KINK_CHANCE) a += (rand() - 0.5) * kink;
      const prev = pts[pts.length - 1];
      pts.push({ x: prev.x + Math.cos(a) * (r - prev.r), y: prev.y + Math.sin(a) * (r - prev.r), r });
    }
    return pts;
  };

  // Primaries — uneven angular spacing, ~35 % stop mid-pane.
  const n = PRIMARY_COUNT_BASE + Math.floor(rand() * PRIMARY_COUNT_RAND);
  const base = rand() * TAU;
  const angles = Array.from(
    { length: n },
    (_, i) => base + (i * TAU) / n + (rand() - 0.5) * PRIMARY_ANGLE_JITTER * (TAU / n),
  ).sort((a, b) => a - b);
  const primaries: Primary[] = angles.map((a0) => {
    const full = rand() < PRIMARY_FULL_CHANCE;
    const len = full ? maxD : maxD * (PRIMARY_SHORT_MIN + rand() * PRIMARY_SHORT_RAND);
    const pts = walk(P, a0, len, [PRIMARY_STEP_BASE, PRIMARY_STEP_RAND], PRIMARY_DRIFT, PRIMARY_KINK);
    // Re-key every point's r to its true distance from the impact point.
    for (const p of pts) p.r = Math.hypot(p.x - P.x, p.y - P.y);
    return {
      pts,
      len: pts[pts.length - 1].r,
      j: HOLE_J_BASE + rand() * HOLE_J_RAND,
      k: HOLE_K_BASE + rand() * HOLE_K_RAND,
      start: PRIMARY_START_BASE + rand() * PRIMARY_START_RAND,
      dur: PRIMARY_DUR_BASE + rand() * PRIMARY_DUR_RAND,
    };
  });

  /** Split a polyline into pieces at the given fractions of its total r. */
  const split = (pts: WalkPoint[], cuts: number[]): WalkPoint[][] => {
    const total = pts[pts.length - 1].r;
    const out: WalkPoint[][] = [];
    let seg = [pts[0]];
    let ci = 0;
    for (let i = 1; i < pts.length; i++) {
      seg.push(pts[i]);
      if (ci < cuts.length && pts[i].r >= total * cuts[ci]) {
        out.push(seg);
        seg = [pts[i]];
        ci++;
      }
    }
    if (seg.length > 1) out.push(seg);
    return out;
  };

  const dOf = (pts: BreakPoint[]) => "M" + pts.map((p) => `${f1(p.x)} ${f1(p.y)}`).join("L");

  const strokes: BreakStroke[] = [];
  const addTapered = (
    pts: WalkPoint[],
    widths: number[],
    lws: number[],
    start: number,
    dur: number,
    ease: "smooth" | "out" = "out",
  ) => {
    const pieces = split(pts, widths.length === 3 ? PRIMARY_CUTS : [BRANCH_CUT]);
    const total = pts[pts.length - 1].r;
    let acc = 0;
    pieces.forEach((seg, i) => {
      const span = (seg[seg.length - 1].r - seg[0].r) / total;
      strokes.push({
        d: dOf(seg),
        w: widths[Math.min(i, widths.length - 1)],
        lw: lws[Math.min(i, lws.length - 1)],
        start,
        dur,
        s0: acc,
        s1: acc + span,
        ease,
      });
      acc += span;
    });
  };
  primaries.forEach((c) => addTapered(c.pts, PRIMARY_CORE_W, PRIMARY_HI_W, c.start, c.dur, "smooth"));

  // Branches — fork off outside the crushed zone; on-screen tips feed the
  // dead-pixel line sources. A skipped branch still counts toward nb.
  const tips: { x: number; y: number; start: number }[] = [];
  const branch = (parent: Primary | Branch, depth: 0 | 1) => {
    const parentLen = parent.pts[parent.pts.length - 1].r;
    const nb =
      depth === 0
        ? BRANCH_COUNT_BASE + Math.floor(rand() * BRANCH_COUNT_RAND)
        : rand() < SUB_BRANCH_CHANCE
          ? 1
          : 0;
    for (let b = 0; b < nb; b++) {
      const startR = Math.max(
        R * BRANCH_MIN_R_MULT,
        parentLen * (BRANCH_FROM_MIN + rand() * BRANCH_FROM_RAND),
      );
      if (startR >= parentLen * BRANCH_SKIP_FRAC) continue;
      const p0 = at(parent, startR);
      if (!inView(p0)) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const a = dirAt(parent, startR) + side * (BRANCH_ANGLE_BASE + rand() * BRANCH_ANGLE_RAND);
      const remaining = parentLen - startR;
      const blen = Math.max(
        BRANCH_MIN_LEN,
        remaining * (depth === 0 ? BRANCH_LEN_MIN + rand() * BRANCH_LEN_RAND : SUB_BRANCH_LEN_MIN + rand() * SUB_BRANCH_LEN_RAND),
      );
      const pts = walk(p0, a, blen, [BRANCH_STEP_BASE, BRANCH_STEP_RAND], BRANCH_DRIFT, BRANCH_KINK);
      const start =
        depth === 0
          ? BRANCH_START_BASE + rand() * BRANCH_START_RAND
          : parent.start + parent.dur * SUB_BRANCH_START_PARENT_FRAC + rand() * SUB_BRANCH_START_RAND;
      const dur = BRANCH_DUR_BASE + rand() * BRANCH_DUR_RAND;
      const br: Branch = { pts, start, dur };
      addTapered(
        pts,
        depth === 0 ? BRANCH_CORE_W : SUB_BRANCH_CORE_W,
        depth === 0 ? BRANCH_HI_W : SUB_BRANCH_HI_W,
        start,
        dur,
      );
      const tip = pts[pts.length - 1];
      if (inView(tip) && Math.hypot(tip.x - P.x, tip.y - P.y) > R * TIP_MIN_R_MULT) {
        tips.push({ x: tip.x, y: tip.y, start: start + dur });
      }
      if (depth === 0) branch(br, 1);
    }
  };
  primaries.forEach((c) => branch(c, 0));

  // Partial arcs — stitch neighbouring primaries at a few radii (replace the
  // phase-1 full rings).
  for (const mult of ARC_RADII_MULTS) {
    const rr = mult * R;
    for (let i = 0; i < n; i++) {
      if (rand() > ARC_OCCUPANCY) continue;
      const c1 = primaries[i];
      const c2 = primaries[(i + 1) % n];
      const r1 = rr * (ARC_R_JITTER_BASE + rand() * ARC_R_JITTER_RAND);
      const r2 = rr * (ARC_R_JITTER_BASE + rand() * ARC_R_JITTER_RAND);
      if (c1.len < r1 || c2.len < r2) continue;
      const v1 = at(c1, r1);
      const v2 = at(c2, r2);
      if (!inView(v1) && !inView(v2)) continue;
      const a1 = Math.atan2(v1.y - P.y, v1.x - P.x);
      let a2 = Math.atan2(v2.y - P.y, v2.x - P.x);
      if (a2 < a1) a2 += TAU;
      const m = ARC_STEPS_BASE + Math.floor(rand() * ARC_STEPS_RAND);
      const pts: WalkPoint[] = [{ ...v1, r: 0 }];
      for (let k = 1; k < m; k++) {
        const f = k / m;
        const a = a1 + (a2 - a1) * f;
        const r = (r1 + (r2 - r1) * f) * (ARC_MID_JITTER_BASE + rand() * ARC_MID_JITTER_RAND);
        pts.push({ x: P.x + Math.cos(a) * r, y: P.y + Math.sin(a) * r, r: k });
      }
      pts.push({ ...v2, r: m });
      strokes.push({
        d: dOf(pts),
        w: ARC_W_BASE - mult * ARC_W_PER_MULT,
        lw: ARC_HI_W,
        start: ARC_START_BASE + rand() * ARC_START_RAND,
        dur: ARC_DUR_BASE + rand() * ARC_DUR_RAND,
        s0: 0,
        s1: 1,
        ease: "out",
      });
    }
  }

  // Crushed zone — micro-cracks just outside the hole (the frost disc is
  // rendered by the layer from P/R, not geometry).
  for (let i = 0; i < MICRO_COUNT; i++) {
    const a = rand() * TAU;
    const r0 = R * (MICRO_R_MIN + rand() * MICRO_R_RAND);
    const l = MICRO_LEN_MIN + rand() * MICRO_LEN_RAND;
    const d = rand() * TAU;
    const x = P.x + Math.cos(a) * r0;
    const y = P.y + Math.sin(a) * r0;
    strokes.push({
      d: `M${f1(x)} ${f1(y)}L${f1(x + Math.cos(d) * l)} ${f1(y + Math.sin(d) * l)}`,
      w: MICRO_W,
      lw: MICRO_HI_W,
      start: MICRO_START_BASE + rand() * MICRO_START_RAND,
      dur: MICRO_DUR,
      s0: 0,
      s1: 1,
      ease: "out",
    });
  }

  // Hole + shards — the shipped rule, keyed to the n primaries.
  const holePts = (h: number): BreakPoint[] => {
    const Rt = Math.max(R * h, 0.02);
    const out: BreakPoint[] = [];
    for (let i = 0; i < n; i++) {
      const c = primaries[i];
      const c2 = primaries[(i + 1) % n];
      const v1 = at(c, Rt * c.j);
      const v2 = at(c2, Rt * c2.j);
      const a1 = Math.atan2(v1.y - P.y, v1.x - P.x);
      let a2 = Math.atan2(v2.y - P.y, v2.x - P.x);
      if (a2 < a1) a2 += TAU;
      const am = (a1 + a2) / 2;
      out.push(v1, { x: P.x + Math.cos(am) * Rt * c.k, y: P.y + Math.sin(am) * Rt * c.k });
    }
    return out;
  };

  const finalHole = holePts(1);
  const shards: BreakShard[] = [];
  for (let i = 0; i < n; i++) {
    const c = primaries[i];
    const c2 = primaries[(i + 1) % n];
    const poly = [
      at(c, R * SHARD_INNER_R),
      finalHole[2 * i],
      finalHole[2 * i + 1],
      finalHole[(2 * i + 2) % (2 * n)],
      at(c2, R * SHARD_OUTER_R),
    ];
    const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    const dl = Math.hypot(cx - P.x, cy - P.y) || 1;
    shards.push({
      points: poly.map((p) => `${f1(p.x)},${f1(p.y)}`).join(" "),
      cx,
      cy,
      dir: { x: (cx - P.x) / dl, y: (cy - P.y) / dl },
      speed: SHARD_SPEED_MIN + rand() * SHARD_SPEED_RAND,
      spin: (rand() - 0.5) * SHARD_SPIN_RANGE,
    });
  }

  // Dead-pixel lines — from branch tips (fallback: primary points), popping
  // in instantly with a flicker. Every endpoint lands inside [0,W] × [0,H].
  const lines: BreakLine[] = [];
  const sources =
    tips.length >= LINE_MIN_TIPS
      ? [...tips]
      : [
          ...tips,
          ...primaries.map((c) => ({
            ...at(c, Math.min(c.len * LINE_FALLBACK_LEN, R * LINE_FALLBACK_R_MULT)),
            start: LINE_FALLBACK_START,
          })),
        ];
  const nl = LINE_COUNT_BASE + Math.floor(rand() * LINE_COUNT_RAND);
  for (let i = 0; i < nl && sources.length; i++) {
    const s = sources.splice(Math.floor(rand() * sources.length), 1)[0];
    if (!inView(s)) {
      i--;
      if (!sources.length) break;
      continue;
    }
    const vertical = rand() < LINE_VERTICAL_CHANCE;
    const full = rand() < LINE_FULL_CHANCE;
    const band = rand() < LINE_BAND_CHANCE;
    const x = clamp(s.x, 0, W);
    const y = clamp(s.y, 0, H);
    let x1: number;
    let y1: number;
    let x2: number;
    let y2: number;
    if (vertical) {
      x1 = x2 = x;
      if (full) {
        y1 = 0;
        y2 = H;
      } else if (s.y < P.y) {
        y1 = 0;
        y2 = y;
      } else {
        y1 = y;
        y2 = H;
      }
    } else {
      y1 = y2 = y;
      if (full) {
        x1 = 0;
        x2 = W;
      } else if (s.x < P.x) {
        x1 = 0;
        x2 = x;
      } else {
        x1 = x;
        x2 = W;
      }
    }
    lines.push({
      x1,
      y1,
      x2,
      y2,
      color: LINE_COLORS[Math.floor(rand() * LINE_COLORS.length)],
      w: band ? LINE_BAND_W_MIN + rand() * LINE_BAND_W_RAND : 1,
      op: band ? LINE_BAND_OP : LINE_HAIR_OP,
      start: Math.max(LINE_START_MIN, Math.min(LINE_START_MAX, s.start + rand() * LINE_START_RAND)),
      flick: rand() * LINE_FLICK_RAND,
    });
  }

  return { P, R, W, H, n, strokes, lines, shards, holePts };
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

/** Hole radius: ~10.5 % of the viewport width, clamped to [64, 160] px. */
export function radiusFor(W: number): number {
  return clamp(0.105 * W, 64, 160);
}
