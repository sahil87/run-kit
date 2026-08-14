/**
 * The shared flair overlay (decoration-only channel): an always-on, ambient,
 * CSS-only animation layer mounted whenever a row/tile carries a flair value
 * — in EVERY state (rest, hover, selected). Same overlay discipline as the
 * marker textures (dedicated clipped inner element, never the root,
 * pointer-events-none, z-5); composes with any color tint and any marker
 * overlay. Hidden entirely under prefers-reduced-motion (globals.css § Flair
 * overlays).
 *
 * The component is deliberately TOTAL: ANY non-empty string renders the span
 * — the CSS decides what paints (an unknown value simply mounts a class that
 * matches nothing). Vocabulary gating lives at the call sites: row components
 * gate tile-only values out (FLAIR_STATES membership check in
 * sidebar/index.tsx), server tiles mount every SERVER_FLAIR_STATES value.
 *
 * MARKUP CONTRACT (fixed with globals.css — the treatments key on these exact
 * child spans):
 *  - Universal states + `tetris` + `invaders`: the bare overlay span, no
 *    children (sheet treatments paint from the overlay's own backgrounds).
 *  - `dvd`: a bouncing logo — `.rk-dvd` wrapper carrying `.rk-dvd-logo`.
 *  - `cube`: a CSS-3D box — `.rk-cube` carrying SIX `.rk-cube-face` children
 *    (one per face of the preserve-3d transform).
 *  - `warp`: three layered starfield planes — THREE `.rk-warp-plane` children.
 * Extra/missing children would paint a broken treatment, so the branches below
 * are exhaustive over the multi-span states and everything else falls through
 * to the bare span.
 */
export function FlairOverlay({ flair }: { flair?: string }) {
  if (!flair) return null; // undefined and "" are the rest state — no overlay.

  const base = `absolute inset-0 z-[5] overflow-hidden pointer-events-none rk-flair-${flair}`;

  if (flair === "dvd") {
    return (
      <span aria-hidden="true" className={base}>
        <span className="rk-dvd">
          <span className="rk-dvd-logo" />
        </span>
      </span>
    );
  }
  if (flair === "cube") {
    return (
      <span aria-hidden="true" className={base}>
        <span className="rk-cube">
          <span className="rk-cube-face" />
          <span className="rk-cube-face" />
          <span className="rk-cube-face" />
          <span className="rk-cube-face" />
          <span className="rk-cube-face" />
          <span className="rk-cube-face" />
        </span>
      </span>
    );
  }
  if (flair === "warp") {
    return (
      <span aria-hidden="true" className={base}>
        <span className="rk-warp-plane" />
        <span className="rk-warp-plane" />
        <span className="rk-warp-plane" />
      </span>
    );
  }
  return <span aria-hidden="true" className={base} />;
}
