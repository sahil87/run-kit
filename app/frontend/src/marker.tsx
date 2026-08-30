// ── Left-edge marker (3×3 mode × stage) ──────────────────────────────────────
// The window marker carries two orthogonal axes: MODE (categorical — manual /
// auto / blocked) × STAGE (ordinal — 1 / 2 / 3). Stored in `@rk_win_marker` as
// `<mode>[:<stage>]`; a bare mode means stage 1. This module is the single home
// for the vocabulary, so every later consumer reads one definition. Markers are
// FULLY STATIC — all row motion lives on the flair axis.

/** The marker modes (vertical axis, categorical). */
export const MARKER_MODES = ["manual", "auto", "blocked"] as const;
export type MarkerMode = (typeof MARKER_MODES)[number];

/** The marker stages (horizontal axis, ordinal). */
export const MARKER_STAGES = [1, 2, 3] as const;
export type MarkerStage = (typeof MARKER_STAGES)[number];

/** One-word stage glosses. */
export const MARKER_STAGE_GLOSS: Record<MarkerStage, string> = { 1: "early", 2: "mid", 3: "done" };

export type Marker = { mode: MarkerMode; stage: MarkerStage };

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
 *  This reads ONLY the mode × stage vocabulary. A flat token such as `solid` —
 *  which the backend still accepts and still hands through on the read path —
 *  parses to null here by design: `tmux.NormalizeMarker` owns the forward map,
 *  and flat values are expected to be normalized before they reach this parser.
 *  Until that happens they are drawn by the older stripe renderer, not by this
 *  module, so a null here is "not mine to draw", not "unrecognized".
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
