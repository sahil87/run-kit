// ── Left-edge marker (3×3 mode × stage) ──────────────────────────────────────
// The window marker carries two orthogonal axes: MODE (categorical — manual /
// auto / blocked, encoded by SHAPE: solid fill / chevrons / hatch) × STAGE
// (ordinal — 1 / 2 / 3, encoded by WIDTH or chevron COUNT as ⅓ / ⅔ / full of
// the 22px well). Stored in `@rk_win_marker` as `<mode>[:<stage>]`; a bare mode
// renders at stage 1. Both the row well and the marker pad cells consume these
// helpers so the vocabulary lives in exactly one place. Markers are FULLY
// STATIC — all row motion lives on the flair axis (the motion split).

import type { CSSProperties } from "react";

/** The marker modes (vertical axis, categorical). */
export const MARKER_MODES = ["manual", "auto", "blocked"] as const;
export type MarkerMode = (typeof MARKER_MODES)[number];

/** The marker stages (horizontal axis, ordinal: ⅓ / ⅔ / full of the well). */
export const MARKER_STAGES = [1, 2, 3] as const;
export type MarkerStage = (typeof MARKER_STAGES)[number];

/** One-word stage glosses for the pad header. */
export const MARKER_STAGE_GLOSS: Record<MarkerStage, string> = { 1: "early", 2: "mid", 3: "done" };

export type Marker = { mode: MarkerMode; stage: MarkerStage };

/** The single fixed ink every marker paints in — a theme-paired token, never
 *  the row's family hue and never gray. */
export const MARKER_INK = "var(--color-marker-ink)";

/** Solid/hatch fill widths per stage: ⅓ / ⅔ / full of the 22px well. */
export const MARKER_STAGE_WIDTHS: Record<MarkerStage, number> = { 1: 7, 2: 15, 3: 22 };

/** Chevron geometry for `auto`: nominal 4.2px-wide × 10px-tall glyphs at 7.2px
 *  pitch, ~1.8px stroke — three at pitch span ≈18.6px of the 22px well. */
export const MARKER_CHEVRON_WIDTH = 4.2;
export const MARKER_CHEVRON_HEIGHT = 10;
export const MARKER_CHEVRON_PITCH = 7.2;
export const MARKER_CHEVRON_STROKE = 1.8;

function isMarkerMode(value: string): value is MarkerMode {
  return (MARKER_MODES as readonly string[]).includes(value);
}

function isMarkerStage(value: number): value is MarkerStage {
  return (MARKER_STAGES as readonly number[]).includes(value);
}

/** Parse the stored `@rk_win_marker` value (`<mode>[:<stage>]`). A bare mode
 *  renders at stage 1; anything outside the closed set — empty or malformed —
 *  parses to null. */
export function parseMarker(value: string | null | undefined): Marker | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parts = trimmed.split(":");
  if (parts.length > 2) return null;
  const [modePart, stagePart] = parts;
  if (!isMarkerMode(modePart)) return null;
  if (stagePart === undefined) return { mode: modePart, stage: 1 };
  if (!/^\d+$/.test(stagePart)) return null;
  const stage = Number(stagePart);
  if (!isMarkerStage(stage)) return null;
  return { mode: modePart, stage };
}

/** The stored form of a marker — `"auto:2"`. parseMarker ∘ formatMarker is the identity. */
export function formatMarker(marker: Marker): string {
  return `${marker.mode}:${marker.stage}`;
}

/** Style for the solid/hatch fill element inside the well (from x=0, full row
 *  height so stacked rows weld). `auto` renders no fill — its chevrons are drawn
 *  by MarkerChevrons. The 45° hatch is a NON-repeating
 *  45° linear-gradient with 25/50/75% stops: it phase-aligns across every 12px tile
 *  boundary (the same math the .rk-hazard wedge relies on) — a
 *  repeating-linear-gradient would not (12/√2 is no multiple of its period). */
export function markerFillStyle(marker: Marker): CSSProperties | undefined {
  const width = MARKER_STAGE_WIDTHS[marker.stage];
  switch (marker.mode) {
    case "manual":
      return { width, background: MARKER_INK };
    case "blocked":
      return {
        width,
        backgroundImage: `linear-gradient(45deg, ${MARKER_INK} 0 25%, transparent 25% 50%, ${MARKER_INK} 50% 75%, transparent 75%)`,
        backgroundSize: "12px 12px",
        backgroundRepeat: "repeat",
      };
    default:
      return undefined;
  }
}

/** The `auto` mode shape: 1 / 2 / 3 right-pointing chevrons, left-aligned in
 *  the well and vertically centered by the caller (single row, never tiled —
 *  chevrons do not weld across stacked rows). */
export function MarkerChevrons({ count }: { count: MarkerStage }) {
  const width = (count - 1) * MARKER_CHEVRON_PITCH + MARKER_CHEVRON_WIDTH;
  const half = MARKER_CHEVRON_HEIGHT / 2;
  const inset = MARKER_CHEVRON_STROKE / 2;
  return (
    <svg
      aria-hidden
      width={width}
      height={MARKER_CHEVRON_HEIGHT}
      viewBox={`0 0 ${width} ${MARKER_CHEVRON_HEIGHT}`}
      fill="none"
      stroke={MARKER_INK}
      strokeWidth={MARKER_CHEVRON_STROKE}
    >
      {Array.from({ length: count }, (_, i) => {
        const x = i * MARKER_CHEVRON_PITCH + inset;
        const tipX = x + MARKER_CHEVRON_WIDTH - inset;
        return (
          <path
            key={i}
            d={`M ${x} ${inset} L ${tipX} ${half} L ${x} ${MARKER_CHEVRON_HEIGHT - inset}`}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}
