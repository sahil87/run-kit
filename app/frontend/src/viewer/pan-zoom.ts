/**
 * Pure, DOM-free pan/zoom math for the viewer's zoomable figures (the
 * `viewer/format.ts` module contract). A figure is an SVG at its NATURAL size
 * whose only magnification is `transform: translate(tx, ty) scale(scale)` with
 * origin 0 0 inside a clipping viewport; this module owns every derivation
 * over that state and knows nothing about elements or events.
 *
 * The only import is the app's dependency-free gesture math, so the viewer
 * chunk pulls no app code. The tile-level zoom ladder (`lib/web-zoom.ts`) is
 * deliberately NOT reused: it caps at 3× and drags `web-url.ts` along.
 */

import { applyWheelZoom, clampZoom } from "@/lib/zoom-gesture";

export interface Size {
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ZoomState {
  scale: number;
  tx: number;
  ty: number;
}

/** "width" fits the container width (an inline diagram in flowing text);
 *  "contain" fits both axes (a full-viewport canvas). Neither upscales past
 *  natural size at rest. */
export type FitMode = "width" | "contain";

/** Max magnification as a multiple of the SVG's natural size. */
export const FIGURE_ZOOM_MAX = 8;

/** Discrete ladder for button/keyboard steps: the browser ladder's shape,
 *  extended below 50% (wide scenes fit far below it) and up to the figure
 *  max. Gesture zoom is continuous and never consults it. */
export const FIGURE_ZOOM_LEVELS: readonly number[] = [
  0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8,
];

/** Keyboard pan distance per arrow press, in container CSS px (Shift ×5). */
export const PAN_STEP_PX = 40;

/** The Shift multiplier for arrow-key panning. */
export const PAN_STEP_SHIFT_FACTOR = 5;

function isDegenerate(size: Size): boolean {
  return !(size.w > 0) || !(size.h > 0);
}

/** The rest scale for a figure. Returns 1 for a degenerate natural or
 *  container size so a broken measurement never produces NaN transforms. */
export function fitScale(natural: Size, container: Size, mode: FitMode): number {
  if (isDegenerate(natural) || isDegenerate(container)) return 1;
  const byWidth = container.w / natural.w;
  if (mode === "width") return Math.min(1, byWidth);
  return Math.min(1, byWidth, container.h / natural.h);
}

/** The minimum scale is the fit itself: the at-a-glance fit IS the overview,
 *  so there is no zoom-out below it. */
export function minScale(fit: number): number {
  return fit;
}

/** Re-anchor the translation so the content point under `point` (container
 *  coordinates) stays under it at `nextScale`. Does not clamp — callers clamp
 *  next, so a zoom at the content edge still pins the edge afterwards. */
export function zoomAboutPoint(state: ZoomState, nextScale: number, point: Point): ZoomState {
  const ratio = nextScale / state.scale;
  return {
    scale: nextScale,
    tx: point.x - (point.x - state.tx) * ratio,
    ty: point.y - (point.y - state.ty) * ratio,
  };
}

function clampAxis(t: number, containerLen: number, scaledLen: number): number {
  // Content smaller than the container centers; larger content clamps so its
  // edges never leave the container edges (no blank margins while panning).
  if (scaledLen <= containerLen) return (containerLen - scaledLen) / 2;
  return Math.min(0, Math.max(containerLen - scaledLen, t));
}

/** Per-axis center-or-clamp of the translation for the given scale. */
export function clampTranslation(state: ZoomState, natural: Size, container: Size): ZoomState {
  return {
    scale: state.scale,
    tx: clampAxis(state.tx, container.w, natural.w * state.scale),
    ty: clampAxis(state.ty, container.h, natural.h * state.scale),
  };
}

/** The rest state: fit scale, centered/clamped translation. */
export function fitState(natural: Size, container: Size, mode: FitMode): ZoomState {
  const scale = fitScale(natural, container, mode);
  return clampTranslation({ scale, tx: 0, ty: 0 }, natural, container);
}

/** Button/keyboard step: the next ladder level STRICTLY beyond `current` in
 *  `direction`, clamped to [min, FIGURE_ZOOM_MAX]. No snap-then-step: the rest
 *  scale is an arbitrary fit value (e.g. 0.43), and snapping first would
 *  overshoot (0.43 → 0.5 → 0.67). */
export function stepScale(current: number, direction: "in" | "out", min: number): number {
  const epsilon = 1e-9;
  let next: number | undefined;
  if (direction === "in") {
    next = FIGURE_ZOOM_LEVELS.find((level) => level > current + epsilon);
  } else {
    for (let i = FIGURE_ZOOM_LEVELS.length - 1; i >= 0; i--) {
      const level = FIGURE_ZOOM_LEVELS[i];
      if (level < current - epsilon) {
        next = level;
        break;
      }
    }
  }
  const target = next ?? (direction === "in" ? FIGURE_ZOOM_MAX : min);
  return clampZoom(target, min, FIGURE_ZOOM_MAX);
}

/** Continuous ctrl/meta-wheel mapping — the tile's exponential feel, bounded
 *  by the figure's [min, max]. */
export function wheelScale(current: number, deltaY: number, min: number): number {
  return applyWheelZoom(current, deltaY, min, FIGURE_ZOOM_MAX);
}

/** Pinch mapping: the scale captured at gesture start times the gesture's
 *  cumulative ratio, bounded. */
export function pinchScale(base: number, ratio: number, min: number): number {
  return clampZoom(base * ratio, min, FIGURE_ZOOM_MAX);
}

/** The readout: percent of natural size, 100% = natural. */
export function formatPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/** Parse an SVG viewBox ("minx miny w h") into its size; null when absent,
 *  malformed, or non-positive. */
export function parseViewBox(viewBox: string | null): Size | null {
  if (viewBox === null) return null;
  const parts = viewBox.trim().split(/[\s,]+/);
  if (parts.length !== 4) return null;
  const w = Number(parts[2]);
  const h = Number(parts[3]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

/** True when the scaled content exceeds the container on either axis, i.e.
 *  there is somewhere to pan. */
export function isPannable(scale: number, natural: Size, container: Size): boolean {
  return natural.w * scale > container.w || natural.h * scale > container.h;
}

/** Two scales agree within float noise — the "still at fit" test. */
export function sameScale(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}
