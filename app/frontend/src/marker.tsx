// ── Left-edge marker (3×3 mode × stage) ──────────────────────────────────────
// The window marker carries two orthogonal axes: MODE (categorical shape) ×
// STAGE (ordinal width/count). Stored in `@rk_win_marker` as
// `<mode>[:<stage>]`; a bare mode means stage 1. Markers are fully static.

import type { CSSProperties } from "react";

/** The marker modes (vertical axis, categorical). */
export const MARKER_MODES = ["manual", "auto", "blocked"] as const;
export type MarkerMode = (typeof MARKER_MODES)[number];

/** The marker stages (horizontal axis, ordinal). */
export const MARKER_STAGES = [1, 2, 3] as const;
export type MarkerStage = (typeof MARKER_STAGES)[number];

/** One-word stage glosses. */
export const MARKER_STAGE_GLOSS: Record<MarkerStage, string> = { 1: "early", 2: "mid", 3: "done" };

export type Marker = { mode: MarkerMode; stage: MarkerStage };

export const MARKER_INK = "var(--color-marker-ink)";
export const MARKER_STAGE_WIDTHS: Record<MarkerStage, number> = { 1: 7, 2: 15, 3: 22 };
export const MARKER_CHEVRON_WIDTH = 4.2;
export const MARKER_CHEVRON_HEIGHT = 10;
export const MARKER_CHEVRON_PITCH = 7.2;
export const MARKER_CHEVRON_STROKE = 1.8;
export const MARKER_WELL_BACKGROUND =
  "color-mix(in srgb, var(--color-marker-ink) 12%, transparent)";
export const MARKER_WELL_EDGE =
  "1px solid color-mix(in srgb, var(--color-marker-ink) 30%, transparent)";

function isMarkerMode(value: string): value is MarkerMode {
  return (MARKER_MODES as readonly string[]).includes(value);
}

function isMarkerStage(value: number): value is MarkerStage {
  return (MARKER_STAGES as readonly number[]).includes(value);
}

/** Parse the stored `@rk_win_marker` value (`<mode>[:<stage>]`). A bare mode
 *  means stage 1; empty, malformed, or outside the mode × stage vocabulary
 *  parses to null.
 *
 *  This reads only the mode × stage vocabulary. Flat compatibility tokens parse
 *  to null here because `tmux.NormalizeMarker` maps them before the payload
 *  reaches the frontend.
 *
 *  Within its own vocabulary it is deliberately more permissive than the
 *  backend validator, which is whitespace-intolerant: this is a read of
 *  whatever tmux holds, so it tolerates surrounding space and a zero-padded
 *  stage, and it never throws. The value crosses an untyped JSON boundary
 *  before it gets here, so the string check is a runtime guard, not a redundant
 *  restatement of the parameter type. */
export function parseMarker(value: string | null | undefined): Marker | null {
  if (typeof value !== "string") return null;
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

/** Return the full-height fill style for modes that paint a tiled or solid shape. */
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

/** Draw one right-pointing chevron per automatic stage. */
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
      {Array.from({ length: count }, (_, index) => {
        const x = index * MARKER_CHEVRON_PITCH + inset;
        const tipX = x + MARKER_CHEVRON_WIDTH - inset;
        return (
          <path
            key={index}
            d={`M ${x} ${inset} L ${tipX} ${half} L ${x} ${MARKER_CHEVRON_HEIGHT - inset}`}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}
