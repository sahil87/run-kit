/** FlairOverlay — the single mount for the flair overlay (decoration-only
 *  channel, globals.css § Flair overlays). Renders the overlay span
 *  (`rk-flair-{value}`, absolute inset-0, clipped, pointer-events-none,
 *  aria-hidden) plus one CHILD span per moving layer of the treatment — the
 *  compositor-only rule: every flair animation animates transform/opacity on a
 *  real child element, never background-position on a pseudo. DOM order is the
 *  paint order (ambient layers first, the character last).
 *
 *  FLAIR_LAYERS is the per-flair layer table; a layer with `sheet` is a
 *  stepped sprite: a frame-box span (one frame's geometry, overflow-hidden,
 *  carrying the traversal) holding an inner sheet span (the full sheet,
 *  carrying the frame stepper). cube/warp/nemo keep their bespoke nested
 *  markup below the table.
 *
 *  --rk-flair-w: pixel-art traversals are quantized with steps() counts equal
 *  to their px distance, so they need the overlay's rounded integer width —
 *  a shared ResizeObserver writes it straight to the element's inline style
 *  (no React state, no re-render). The CSS falls back to 240 before the first
 *  observation.
 *
 *  `color` sets the --rk-flair-color custom property inline — the tint source
 *  for the flairs that are not self-colored (rain/scan read it; the sprite
 *  flairs ignore it). Pass the row's guarded border color so tinted flairs
 *  match the row's family; omitted, the CSS falls back to --color-border.
 *
 *  DRAG GUARD: an animated transform range grows the compositor layer beyond
 *  the row box and the HTML5 drag-ghost snapshot would carry a sliver of the
 *  neighboring row. Every flair now animates transforms on children, so the
 *  uniform guard hides the overlay for EVERY flair while its row is the drag
 *  source (`hidden`), and the reduced-motion gate in globals.css hides all of
 *  it under prefers-reduced-motion. */
import { useEffect, useRef } from "react";
import { FLAIR_STATES, type FlairState } from "@/themes";

type FlairLayer = {
  /** Frame-box (or plain tile) span class — flair-scoped and stable. */
  className: string;
  /** Inner sheet span class for a stepped sprite inside its frame box. */
  sheet?: string;
};

const FLAIR_LAYERS: Partial<Record<FlairState, readonly FlairLayer[]>> = {
  rain: [{ className: "rk-rain-lane-a" }, { className: "rk-rain-lane-b" }],
  scan: [{ className: "rk-scan-crawl" }, { className: "rk-scan-band" }],
  nyan: [
    { className: "rk-nyan-stars", sheet: "rk-nyan-stars-sheet" },
    { className: "rk-nyan-cat", sheet: "rk-nyan-cat-sheet" },
    { className: "rk-nyan-trail", sheet: "rk-nyan-trail-sheet" },
  ],
  naruto: [
    { className: "rk-naruto-streaks" },
    { className: "rk-naruto-runner", sheet: "rk-naruto-runner-sheet" },
    { className: "rk-naruto-trail", sheet: "rk-naruto-trail-sheet" },
  ],
  onepiece: [
    { className: "rk-onepiece-wave-a" },
    { className: "rk-onepiece-wave-b" },
    { className: "rk-onepiece-ship", sheet: "rk-onepiece-ship-sheet" },
  ],
  pacman: [
    { className: "rk-pacman-ghost", sheet: "rk-pacman-ghost-sheet" },
    { className: "rk-pacman-dots" },
    { className: "rk-pacman-chomp", sheet: "rk-pacman-chomp-sheet" },
  ],
  matrix: [
    { className: "rk-matrix-fall-a" },
    { className: "rk-matrix-fall-b" },
    { className: "rk-matrix-fall-c" },
  ],
  aquarium: [
    { className: "rk-aquarium-bubbles" },
    { className: "rk-aquarium-weed", sheet: "rk-aquarium-weed-sheet" },
    { className: "rk-aquarium-blue", sheet: "rk-aquarium-blue-sheet" },
    { className: "rk-aquarium-orange", sheet: "rk-aquarium-orange-sheet" },
  ],
  roadrunner: [
    { className: "rk-roadrunner-streaks" },
    { className: "rk-roadrunner-bird", sheet: "rk-roadrunner-bird-sheet" },
  ],
  invaders: [{ className: "rk-invaders-trio", sheet: "rk-invaders-trio-sheet" }],
  spidey: [
    { className: "rk-spidey-city" },
    { className: "rk-spidey-figure", sheet: "rk-spidey-figure-sheet" },
  ],
  ironman: [
    { className: "rk-ironman-city-far" },
    { className: "rk-ironman-city-near" },
    { className: "rk-ironman-figure", sheet: "rk-ironman-figure-sheet" },
  ],
  noon: [
    { className: "rk-noon-dust" },
    { className: "rk-noon-wordmark", sheet: "rk-noon-wordmark-sheet" },
  ],
};

let widthObserver: ResizeObserver | null = null;

function sharedWidthObserver(): ResizeObserver {
  if (!widthObserver) {
    widthObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target instanceof HTMLElement) {
          entry.target.style.setProperty(
            "--rk-flair-w",
            String(Math.round(entry.contentRect.width)),
          );
        }
      }
    });
  }
  return widthObserver;
}

function isFlairState(value: string): value is FlairState {
  return (FLAIR_STATES as readonly string[]).includes(value);
}

export function FlairOverlay({
  flair,
  hidden,
  color,
}: {
  flair: string | undefined;
  hidden?: boolean;
  color?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = sharedWidthObserver();
    observer.observe(el);
    return () => observer.unobserve(el);
  }, [flair, hidden]);
  if (!flair || hidden) return null;
  const layers = isFlairState(flair) ? FLAIR_LAYERS[flair] : undefined;
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={`absolute inset-0 z-[5] overflow-hidden pointer-events-none rk-flair-${flair}`}
      style={color ? ({ "--rk-flair-color": color } as React.CSSProperties) : undefined}
    >
      {layers?.map((layer) => (
        <span key={layer.className} className={layer.className}>
          {layer.sheet && <span className={layer.sheet} />}
        </span>
      ))}
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
      {flair === "nemo" && (
        <>
          <span className="rk-nemo-bubbles" />
          <span className="rk-nemo-fish rk-nemo-orange">
            <span className="rk-nemo-tail" />
            <span className="rk-nemo-fin" />
            <span className="rk-nemo-body" />
          </span>
          <span className="rk-nemo-fish rk-nemo-blue">
            <span className="rk-nemo-tail" />
            <span className="rk-nemo-fin" />
            <span className="rk-nemo-body" />
          </span>
          <span className="rk-nemo-weed">
            <span className="rk-nemo-blade" />
            <span className="rk-nemo-blade" />
            <span className="rk-nemo-blade" />
          </span>
        </>
      )}
    </span>
  );
}
