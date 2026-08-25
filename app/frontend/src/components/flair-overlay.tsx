/** FlairOverlay — the single mount for the flair overlay (decoration-only
 *  channel, globals.css § Flair overlays). Renders the overlay span
 *  (`rk-flair-{value}`, absolute inset-0, clipped, pointer-events-none,
 *  aria-hidden) plus the per-flair CHILD markup the transform-driven
 *  treatments need: cube's nested wrappers + 6-face cube spans, warp's three
 *  starfield planes. Sheet/pseudo flairs (including the tinted `rain`/`scan`)
 *  render the bare span.
 *
 *  `color` sets the --rk-flair-color custom property inline — the tint source
 *  for the flairs that are not self-colored (rain/scan read it; the sprite
 *  flairs ignore it). Pass the row's guarded border color so tinted flairs
 *  match the row's family; omitted, the CSS falls back to --color-border.
 *
 *  DRAG GUARD: cube/warp animate transforms on those child spans, which would
 *  corrupt the HTML5 drag ghost (the row transform ban — see globals.css §
 *  Flair overlays). The uniform guard hides the overlay for EVERY flair
 *  while its row is the drag source (`hidden`), and the reduced-motion gate
 *  in globals.css hides all of it under prefers-reduced-motion.
 *
 *  REDUCED-MOTION JS GATE (custom only): `custom` is the runtime-asset slot —
 *  its image owns the loop (no CSS `animation:`), so the CSS gate cannot stop
 *  it. For `custom` ONLY, the component returns null when
 *  prefers-reduced-motion: reduce matches (a render-time matchMedia read, no
 *  listener — the OS setting changes rarely and the next mount reflects it).
 *  Every other flair's path is byte-identical: the pure-CSS gate in
 *  globals.css. */
import { prefersReducedMotion } from "../lib/motion";

export function FlairOverlay({
  flair,
  hidden,
  color,
}: {
  flair: string | undefined;
  hidden?: boolean;
  color?: string;
}) {
  if (!flair || hidden) return null;
  // The custom-only reduced-motion mount gate (see the header comment) — a
  // raster's own loop cannot be paused from CSS, so not mounting is the only
  // guarantee. prefersReducedMotion carries the jsdom capability guard.
  if (flair === "custom" && prefersReducedMotion()) return null;
  return (
    <span
      aria-hidden="true"
      className={`absolute inset-0 z-[5] overflow-hidden pointer-events-none rk-flair-${flair}`}
      style={color ? ({ "--rk-flair-color": color } as React.CSSProperties) : undefined}
    >
      {flair === "cube" && (
        <span className="rk-cube-x">
          <span className="rk-cube-y">
            <span className="rk-cube">
              <span className="rk-cube-face" />
              <span className="rk-cube-face" />
              <span className="rk-cube-face" />
              <span className="rk-cube-face" />
              <span className="rk-cube-face" />
              <span className="rk-cube-face" />
            </span>
          </span>
        </span>
      )}
      {flair === "warp" && (
        <>
          <span className="rk-warp-plane" />
          <span className="rk-warp-plane" />
          <span className="rk-warp-plane" />
        </>
      )}
    </span>
  );
}
