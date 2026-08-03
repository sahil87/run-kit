import { useCallback, useEffect, useRef, type Ref, type RefObject } from "react";
import { prefersReducedMotion } from "@/lib/motion";

// Rest pattern of the border ring: lit trio {5, 0, 1}, dark trio {2, 3, 4}
// (clockwise, centered on segment 0). The static fills below double as the
// hover sweep's rest pattern — trio membership is derived from them.
const LIT_FILL = "#b4b4b4";
const DARK_FILL = "#2a2a2a";

const BORDER_SEGMENTS = [
  { points: "44,11.2 56,32 47.5,32 39.5,17.2", staticFill: LIT_FILL },
  { points: "56,32 44,52.8 39.5,46.8 47.5,32", staticFill: LIT_FILL },
  { points: "44,52.8 20,52.8 24.5,46.8 39.5,46.8", staticFill: DARK_FILL },
  { points: "20,52.8 8,32 16.5,32 24.5,46.8", staticFill: DARK_FILL },
  { points: "8,32 20,11.2 24.5,17.2 16.5,32", staticFill: DARK_FILL },
  { points: "20,11.2 44,11.2 39.5,17.2 24.5,17.2", staticFill: LIT_FILL },
];

const INNER_FACES = [
  { points: "24.5,17.2 39.5,17.2 47.5,32 32,32", fill: "#888888" },
  { points: "47.5,32 39.5,46.8 24.5,46.8 32,32", fill: "#737373" },
  { points: "24.5,46.8 16.5,32 24.5,17.2 32,32", fill: "#545454" },
];

const ANIM_FILL = LIT_FILL;

const SEGMENT_COUNT = BORDER_SEGMENTS.length;

/* ── Brand hover sweep: "detach, orbit, land" ──────────────────────────────
   The brand crumb's hover treatment (hover-animation vocabulary: glitch =
   brand; the logo ring rides it with this JS-driven white glow sweep — the
   same segment-illumination language as the loading chase, so the logo has
   one motion vocabulary). A white glow blob detaches from the lit half,
   orbits the ring 3 laps decelerating over 900ms while the lit half dims,
   and lands exactly on the lit half where it crossfades into the rest
   pattern — the frames at p=0 and p=1 compute to exactly the rest fills, so
   start and landing are seamless. JS precedent: typed-label.tsx / the boot
   sweep in top-bar.tsx. */
const SWEEP_DURATION_MS = 900;
const SWEEP_LAPS = 3;
const SWEEP_SIGMA = 0.85;
// Settle envelope: settled (rest pattern) at both ends, 0 mid-flight —
// detaches over the first 10%, lands over the last 22% (from p = 0.78).
const SWEEP_DETACH_END = 0.1;
const SWEEP_LAND_START = 0.78;
const SWEEP_LAND_SPAN = 0.22;

type Rgb = readonly [number, number, number];
const WHITE_RGB: Rgb = [255, 255, 255];
const LIT_RGB: Rgb = [180, 180, 180]; // #b4b4b4
const DARK_RGB: Rgb = [42, 42, 42]; // #2a2a2a

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/**
 * Fill of border segment `i` at sweep progress `p` (0..1). Pure — exported
 * for unit tests. The p=0 and p=1 frames equal the rest fills exactly (no
 * restore snap): the integer lap count parks the head on segment 0, the lit
 * trio's center, so the blob's landing spot IS the rest pattern's position.
 */
export function sweepSegmentFill(i: number, p: number): string {
  // Head position: ease-out cubic over 3 laps — continuous (fractional).
  const ease = 1 - (1 - p) ** 3;
  const h = (ease * SWEEP_LAPS * SEGMENT_COUNT) % SEGMENT_COUNT;
  // Settled parameter: 1 at both ends (rest pattern), 0 mid-flight (glow).
  const s = Math.max(
    1 - smoothstep(p / SWEEP_DETACH_END),
    smoothstep((p - SWEEP_LAND_START) / SWEEP_LAND_SPAN),
  );
  const delta = Math.abs(h - i);
  const d = Math.min(delta, SEGMENT_COUNT - delta); // circular distance
  const gauss = Math.exp(-(d * d) / (2 * SWEEP_SIGMA * SWEEP_SIGMA));
  const rest = BORDER_SEGMENTS[i].staticFill === LIT_FILL ? 1 : 0;
  const brightness = gauss * (1 - s) + rest * s;
  // White glow in flight crossfades to the lit gray as it settles; each
  // segment sits between the dark base and that bright target.
  const bright = mixRgb(WHITE_RGB, LIT_RGB, s);
  const fill = mixRgb(DARK_RGB, bright, brightness);
  return `rgb(${Math.round(fill[0])}, ${Math.round(fill[1])}, ${Math.round(fill[2])})`;
}

/**
 * Driver for the brand crumb's hover sweep. Attach `svgRef` to a
 * `<LogoSpinner loading={false} svgRef={...} />` and `onMouseEnter` to the
 * hover target (the brand crumb anchor). Re-trigger while running is
 * ignored; under prefers-reduced-motion the sweep is skipped entirely — the
 * rest state IS the reduced-motion state (TypedLabel convention).
 */
export function useBrandLogoSweep(): {
  svgRef: RefObject<SVGSVGElement | null>;
  onMouseEnter: () => void;
} {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const onMouseEnter = useCallback(() => {
    // Re-trigger while running is ignored — no restart.
    if (runningRef.current) return;
    if (prefersReducedMotion()) return;
    const svg = svgRef.current;
    if (!svg) return;
    const polys = Array.from(
      svg.querySelectorAll<SVGPolygonElement>("polygon[data-ring-segment]"),
    );
    if (polys.length !== SEGMENT_COUNT) return;

    runningRef.current = true;
    // The rest state's inline `transition: fill 0.5s` would smear the
    // per-frame fills into crossfades — suspend it in flight, restore on
    // landing.
    const prevTransitions = polys.map((el) => el.style.transition);
    for (const el of polys) el.style.transition = "none";

    let start: number | null = null;
    const frame = (now: number) => {
      if (start === null) start = now;
      const p = Math.min(1, (now - start) / SWEEP_DURATION_MS);
      polys.forEach((el, i) => {
        el.setAttribute("fill", sweepSegmentFill(i, p));
      });
      if (p < 1) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }
      // Numerical safety net: the p=1 frame already computes to the rest
      // fills; park the literal hex values so the DOM matches what React
      // rendered, and restore the suspended transitions.
      polys.forEach((el, i) => {
        el.setAttribute("fill", BORDER_SEGMENTS[i].staticFill);
        el.style.transition = prevTransitions[i];
      });
      rafRef.current = null;
      runningRef.current = false;
    };
    rafRef.current = requestAnimationFrame(frame);
  }, []);

  return { svgRef, onMouseEnter };
}

export function LogoSpinner({
  size = 16,
  loading = true,
  svgRef,
}: {
  size?: number;
  loading?: boolean;
  /** Lets JS reach the border segments (the brand crumb's hover sweep). */
  svgRef?: Ref<SVGSVGElement>;
}) {
  return (
    <svg
      ref={svgRef}
      viewBox="7 10 50 44"
      width={size}
      height={size}
      aria-hidden="true"
      role="img"
    >
      {BORDER_SEGMENTS.map((seg, i) => (
        <polygon
          key={i}
          data-ring-segment={i}
          points={seg.points}
          fill={loading ? ANIM_FILL : seg.staticFill}
          style={{
            // Negative delays start every segment mid-cycle, so the chase is
            // in steady state from the first rendered frame (positive delays
            // held segments at full opacity until their delay elapsed — a
            // one-bright-side start transient on every spinner mount).
            animation: loading
              ? `logo-chase 1.2s ease-in-out ${i * 0.2 - 1.2}s infinite`
              : "none",
            transition: loading ? "none" : "opacity 0.5s ease-out, fill 0.5s ease-out",
            opacity: loading ? undefined : 1,
          }}
        />
      ))}
      {INNER_FACES.map((face, i) => (
        <polygon key={`face-${i}`} points={face.points} fill={face.fill} />
      ))}
    </svg>
  );
}
