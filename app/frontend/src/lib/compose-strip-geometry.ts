/**
 * Pure geometry computation for the compose strip's pane-aligned docking
 * (260812-fryz). Extracted from compose-strip.tsx so the clamp / overhang /
 * containment arithmetic is unit-testable without mounting the strip or a
 * real layout engine — the component measures DOM rects and hands them here.
 */

/** A horizontal span: left edge + width, in the same coordinate space. */
export interface StripRect {
  left: number;
  width: number;
}

/**
 * Minimum usable width of the strip's visible box — wide enough for the
 * placeholder text, the attach button, and the Insert/Send cluster. A pane
 * narrower than this yields a 420px box overhanging its neighbors, centered
 * on the pane's span and shifted to stay inside the strip's bounds.
 */
export const COMPOSE_STRIP_MIN_WIDTH = 420;

/**
 * Compute the aligned horizontal extent of the strip's visible box, relative
 * to the strip's own outer element (the full footer row). `left` is the
 * wrapper's `marginLeft`; `width` its pixel width.
 *
 * Returns `null` when no alignment applies — the caller then renders the
 * strip full width (selection-broadcast mode, no focused target, or an
 * absent/degenerate pane rect, e.g. a registrant that unmounted mid-measure).
 *
 * Rules (R3):
 * - The box tracks the pane's span, but never shrinks below `minWidth` —
 *   a clamped box centers on the pane's span where possible.
 * - The box never overflows the strip's own bounds: the width clamps to the
 *   strip width (degenerate pane wider than the row) and `left` shifts to
 *   keep `[left, left + width]` inside `[0, stripWidth]`.
 */
export function computeStripGeometry(
  paneRect: StripRect | null,
  stripRect: StripRect,
  minWidth: number = COMPOSE_STRIP_MIN_WIDTH,
): { left: number; width: number } | null {
  if (!paneRect || paneRect.width <= 0 || stripRect.width <= 0) return null;

  // Pane-relative coordinates: distance from the strip row's left edge.
  const paneLeft = paneRect.left - stripRect.left;

  const width = Math.min(Math.max(paneRect.width, minWidth), stripRect.width);

  // Track the pane's left edge; when the pane is narrower than the box
  // (min-width clamp), center the overhang on the pane's span instead.
  let left = paneRect.width >= width ? paneLeft : paneLeft + (paneRect.width - width) / 2;

  // Contain within the strip row: shift only as needed.
  left = Math.max(0, Math.min(left, stripRect.width - width));

  return { left, width };
}
