/** Shared pin glyph — THE single pin shape for every board-pin affordance
 *  (sidebar window-row pin button, board tile-header unpin). Lucide-style
 *  thumbtack viewed face-on: round-cornered cap, narrow neck flaring into wide
 *  shoulders, centered needle. Native 16×16 viewBox so strokes pixel-align
 *  symmetrically when rendered at 12px. Hand-rolled inline SVG per the
 *  project's no-icon-library pattern (top-bar SplitButton).
 *
 *  Variants:
 *  - `filled` — pinned-state indicator (sidebar rows: outline = not pinned,
 *    filled = pinned to any board).
 *  - `slashed` — unpin affordance (board tile header): the outline thumbtack
 *    crossed by a diagonal line, the pin-off convention. Used unfilled — a
 *    currentColor slash over a currentColor fill would vanish in the overlap.
 */
export function PinIcon({ filled = false, slashed = false }: { filled?: boolean; slashed?: boolean }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Bell silhouette: cap → neck → flared shoulders */}
      <path
        d="M6 2.5
           Q6 2 6.5 2
           H9.5
           Q10 2 10 2.5
           V5
           L13 9
           Q13 9.5 12.5 9.5
           H3.5
           Q3 9.5 3 9
           L6 5
           Z"
        fill={filled ? "currentColor" : "none"}
      />
      {/* Needle — centered vertical from flange to tip */}
      <path d="M8 9.5 V14" />
      {/* Diagonal slash = unpin */}
      {slashed && <line x1="2" y1="2" x2="14" y2="14" />}
    </svg>
  );
}
