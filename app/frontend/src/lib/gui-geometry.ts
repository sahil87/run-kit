/**
 * The `gui.geometry` frontend helpers (spec docs/specs/gui.md § Resize
 * policy): the preset list the palette's `GUI: Resolution →` rows render, the
 * Custom… prompt's input parser, and the aspect matcher behind `Match this
 * tile`. Pure module — the palette rows and the prompt stay unit-testable
 * without a DOM. The backend owns the authoritative validation
 * (`internal/gui` ParseGeometry); the client-side range check exists so the
 * prompt can refuse bad input before the POST.
 */

/** The palette's resolution presets, in display order (V-D2: 16:9 covers
 *  laptops and monitors; the portrait preset is the phone-first session). */
export const GUI_GEOMETRY_PRESETS = [
  "1280x720",
  "1600x900",
  "1920x1080",
  "2560x1440",
  "1080x1920",
] as const;

/** The client-side per-side bounds (the backend's GeometryMin/GeometryMax). */
export const GEOMETRY_MIN_SIDE = 320;
export const GEOMETRY_MAX_SIDE = 7680;

/** The prompt's one validation message, shown verbatim under the input. */
export const GEOMETRY_INPUT_ERROR = "Width×Height, 320–7680 per side";

/** The parsed result of an accepted geometry input. */
export type ParsedGeometry = { w: number; h: number; geometry: string };

// The accepted input shape: digits, then a separator of `x`, `×`, or
// whitespace (optionally padded), then digits. Surrounding whitespace is
// ignored; anything else is the error string.
const GEOMETRY_INPUT_RE = /^([0-9]+)(?:\s*[x×]\s*|\s+)([0-9]+)$/;

/** Parse a Custom… prompt input (`1440x900`, `1440×900`, `1440 900`) into its
 *  normalized `WxH` form, enforcing the per-side bounds. Returns the error
 *  string (never throws) on any other input. */
export function parseGeometryInput(input: string): ParsedGeometry | string {
  const m = GEOMETRY_INPUT_RE.exec(input.trim());
  if (!m) return GEOMETRY_INPUT_ERROR;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w < GEOMETRY_MIN_SIDE || w > GEOMETRY_MAX_SIDE || h < GEOMETRY_MIN_SIDE || h > GEOMETRY_MAX_SIDE) {
    return GEOMETRY_INPUT_ERROR;
  }
  return { w, h, geometry: `${w}x${h}` };
}

/** `1280x720` → `1280×720`; a taller-than-wide preset reads
 *  `1080×1920 (portrait)`. An unparsable preset passes through unchanged. */
export function presetLabel(preset: string): string {
  const parsed = parseGeometryInput(preset);
  if (typeof parsed === "string") return preset;
  const label = `${parsed.w}×${parsed.h}`;
  return parsed.h > parsed.w ? `${label} (portrait)` : label;
}

function presetSize(preset: string): { w: number; h: number } {
  const parsed = parseGeometryInput(preset);
  return typeof parsed === "string" ? { w: 0, h: 0 } : parsed;
}

/** Prefer `a` over `b` (negative return) as the match for a `w`×`h` tile.
 *  Primary key is aspect-ratio distance, compared exactly by
 *  cross-multiplication (`|w·ph − pw·h| / (h·ph)`, the common `h` dropped).
 *  On a tie — e.g. the four 16:9 presets against any 16:9 tile — prefer a
 *  preset that covers the tile in both dimensions (fit downscales crisply
 *  rather than upscaling), the smaller area among covers, and the larger
 *  area when neither covers. */
function comparePresetFit(w: number, h: number, a: string, b: string): number {
  const pa = presetSize(a);
  const pb = presetSize(b);
  const da = Math.abs(w * pa.h - pa.w * h) * pb.h;
  const db = Math.abs(w * pb.h - pb.w * h) * pa.h;
  if (da !== db) return da - db;
  const aCovers = pa.w >= w && pa.h >= h;
  const bCovers = pb.w >= w && pb.h >= h;
  if (aCovers !== bCovers) return aCovers ? -1 : 1;
  const areaA = pa.w * pa.h;
  const areaB = pb.w * pb.h;
  if (areaA === areaB) return 0;
  return aCovers ? areaA - areaB : areaB - areaA;
}

/** The preset whose aspect ratio is nearest the given size's — the geometry
 *  `Match this tile` posts for the measured tile. */
export function closestAspectPreset(w: number, h: number): string {
  let best: string = GUI_GEOMETRY_PRESETS[0];
  for (const preset of GUI_GEOMETRY_PRESETS.slice(1)) {
    if (comparePresetFit(w, h, preset, best) < 0) best = preset;
  }
  return best;
}
