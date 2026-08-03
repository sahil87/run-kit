import { render, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LogoSpinner, sweepSegmentFill, useBrandLogoSweep } from "./logo-spinner";

// jsdom has no `matchMedia`, so `prefersReducedMotion()`'s capability guard
// returns false and the sweep RUNS by default here. The reduced-motion test
// stubs matchMedia to exercise the JS skip (same seam as typed-label.test).

const REST_LIT = "rgb(180, 180, 180)"; // #b4b4b4
const REST_DARK = "rgb(42, 42, 42)"; // #2a2a2a
const LIT_TRIO = [5, 0, 1];
const DARK_TRIO = [2, 3, 4];
const SWEEP_MS = 900;
const REST_TRANSITION = "opacity 0.5s ease-out, fill 0.5s ease-out";

function ringSegments(container: HTMLElement): SVGPolygonElement[] {
  return Array.from(
    container.querySelectorAll<SVGPolygonElement>("polygon[data-ring-segment]"),
  );
}

/** Parse an `rgb(x, x, x)` fill and return the (achromatic) channel value. */
function channel(fill: string): number {
  const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(fill);
  expect(m, `fill: ${fill}`).not.toBeNull();
  // All logo grays mix to grays — every sweep fill is achromatic.
  expect(m![2]).toBe(m![1]);
  expect(m![3]).toBe(m![1]);
  return Number(m![1]);
}

describe("LogoSpinner loading chase", () => {
  it("staggers segments with negative delays so the chase starts in steady state", () => {
    const { container } = render(<LogoSpinner loading />);
    const segs = ringSegments(container);
    expect(segs).toHaveLength(6);
    segs.forEach((el, i) => {
      const m = /^logo-chase 1\.2s ease-in-out (-[\d.]+)s infinite$/.exec(
        el.style.animation,
      );
      // The leading `-` in the pattern is the point: every segment starts
      // mid-cycle (delay i·0.2 − 1.2 ≤ −0.2s), so there is no first-lap
      // one-bright-side transient. Keyframes/duration/stagger unchanged.
      expect(m, `segment ${i} animation: ${el.style.animation}`).not.toBeNull();
      expect(Number(m![1])).toBeCloseTo(i * 0.2 - 1.2, 9);
    });
  });
});

describe("sweepSegmentFill", () => {
  it("computes exactly the rest fills at p=0 and p=1 (no snap at either seam)", () => {
    for (const p of [0, 1]) {
      for (const i of LIT_TRIO) expect(sweepSegmentFill(i, p)).toBe(REST_LIT);
      for (const i of DARK_TRIO) expect(sweepSegmentFill(i, p)).toBe(REST_DARK);
    }
  });

  it("glows near-white at the head mid-flight while the lit half dims", () => {
    // p=0.5: ease(0.5)=0.875 → h = (0.875·18) mod 6 = 3.75; envelope s = 0
    // (mid-flight). Segment 4 (d=0.25) sits under the blob; segment 0
    // (d=2.25) is dim even though it is lit at rest.
    expect(channel(sweepSegmentFill(4, 0.5))).toBeGreaterThan(240);
    expect(channel(sweepSegmentFill(0, 0.5))).toBeLessThan(60);
  });
});

function Harness() {
  const sweep = useBrandLogoSweep();
  return (
    <a data-testid="brand" onMouseEnter={sweep.onMouseEnter}>
      <LogoSpinner size={20} loading={false} svgRef={sweep.svgRef} />
    </a>
  );
}

describe("useBrandLogoSweep", () => {
  let rafQueue: FrameRequestCallback[] = [];

  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    // No `globals: true` in vitest.config, so RTL's auto-cleanup never
    // registers — clean up explicitly or renders accumulate across tests.
    // Unmount BEFORE unstubbing so the hook's effect cleanup cancels its
    // queued frame against the stubbed cAF (same order as
    // terminal-client.test.tsx).
    cleanup();
    vi.unstubAllGlobals();
  });

  /** Drain the pending frame callbacks, passing `now` as the timestamp. */
  function runFrame(now: number) {
    const cbs = rafQueue;
    rafQueue = [];
    for (const cb of cbs) cb(now);
  }

  it("drives the segment fills over 900ms and lands back on the literal rest fills", () => {
    const { getByTestId, container } = render(<Harness />);
    const segs = ringSegments(container);
    expect(segs.map((el) => el.getAttribute("fill"))).toEqual([
      "#b4b4b4", "#b4b4b4", "#2a2a2a", "#2a2a2a", "#2a2a2a", "#b4b4b4",
    ]);

    fireEvent.mouseEnter(getByTestId("brand"));
    expect(rafQueue).toHaveLength(1);

    // First frame (p=0): computes to the exact rest values — visually
    // seamless — and the rest-state fill transition is suspended so later
    // frames apply instantly instead of smearing through 0.5s crossfades.
    runFrame(1000);
    expect(segs[0].getAttribute("fill")).toBe(REST_LIT);
    expect(segs[2].getAttribute("fill")).toBe(REST_DARK);
    for (const el of segs) expect(el.style.transition).toBe("none");

    // Mid-flight (p=0.5): blob near segment 4, lit trio dimmed.
    runFrame(1000 + SWEEP_MS / 2);
    expect(channel(segs[4].getAttribute("fill")!)).toBeGreaterThan(240);
    expect(channel(segs[0].getAttribute("fill")!)).toBeLessThan(60);

    // Landing (p=1): literal static fills restored (numerical safety net)
    // and the suspended transition put back; no further frame scheduled.
    runFrame(1000 + SWEEP_MS);
    expect(segs.map((el) => el.getAttribute("fill"))).toEqual([
      "#b4b4b4", "#b4b4b4", "#2a2a2a", "#2a2a2a", "#2a2a2a", "#b4b4b4",
    ]);
    for (const el of segs) expect(el.style.transition).toBe(REST_TRANSITION);
    expect(rafQueue).toHaveLength(0);
  });

  it("ignores a re-trigger while a sweep is running (guard, no restart)", () => {
    const { getByTestId, container } = render(<Harness />);
    const segs = ringSegments(container);
    const brand = getByTestId("brand");

    fireEvent.mouseEnter(brand);
    runFrame(1000);
    expect(rafQueue).toHaveLength(1);

    // Re-enter mid-flight: no second sweep starts, no restart.
    fireEvent.mouseEnter(brand);
    expect(rafQueue).toHaveLength(1);

    // The original timeline completes at start + 900ms — a restart would
    // still be mid-flight here.
    runFrame(1000 + SWEEP_MS);
    expect(segs[0].getAttribute("fill")).toBe("#b4b4b4");
    expect(rafQueue).toHaveLength(0);

    // Guard released after landing: a fresh hover sweeps again.
    fireEvent.mouseEnter(brand);
    expect(rafQueue).toHaveLength(1);
  });

  it("skips the sweep entirely under prefers-reduced-motion (rest state IS the reduced state)", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const { getByTestId, container } = render(<Harness />);
    const segs = ringSegments(container);

    fireEvent.mouseEnter(getByTestId("brand"));
    expect(rafQueue).toHaveLength(0);
    expect(segs[0].getAttribute("fill")).toBe("#b4b4b4");
    expect(segs[0].style.transition).toBe(REST_TRANSITION);
  });
});
