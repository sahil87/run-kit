/**
 * ScreenBreak — the one-shot, whole-viewport Easter-egg event layer. Renders
 * `null` while idle; while a flight is in progress it renders the six-layer
 * stack around the glass (the `.app-root` div, registered into the store via
 * a ref callback): the dark inside-ground + hole-clipped creature BELOW the
 * glass, and the evenodd-clipped cracks, the released creature, the shards,
 * and the flash ABOVE it. The glass itself receives only inline `clip-path` /
 * `transform` (plus `position`/`z-index` when it computes `static`) — all
 * removed on finish, on unmount, and on cancel.
 *
 * The layer MUST be a sibling of the glass, never a descendant: `clip-path`
 * on an ancestor clips fixed descendants and `transform` re-anchors them, so
 * mounting inside `.app-root` would clip/re-anchor the layer's own fixed
 * fragments.
 *
 * Discipline (copied from FlairOverlay): aria-hidden, pointer-events none,
 * per-frame writes are transforms / opacity / filter / SVG attributes only,
 * ONE requestAnimationFrame loop drives the 4.2 s flight, no other timers;
 * the single permitted event listener is a passive `pointermove` while the
 * eye is in flight. Under prefers-reduced-motion the store's `fire` never
 * starts a flight, so this layer never mounts (no static fallback — a
 * non-animating crack reads as a broken UI).
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  finish,
  getGlass,
  getState,
  subscribe,
  type ScreenBreakFlight,
} from "@/lib/screen-break-store";
import {
  buildBreak,
  clamp,
  easeIn,
  easeOut,
  holePathAt,
  smooth,
  type BreakGeometry,
} from "@/lib/screen-break-geometry";
import { useScreenBreakTriggers } from "@/hooks/use-screen-break-triggers";
import { EyeSprite, FistSprite } from "./screen-break-sprites";

const FLIGHT_MS = 4200;
const SHARD_GRAVITY = 420;

const GLOW: Record<ScreenBreakFlight["egg"], string> = {
  smash: "rgba(34,197,94,.3)",
  peek: "rgba(192,132,252,.25)",
};

function pathLength(el: SVGPathElement): number {
  // jsdom has no SVG geometry — the unit tests run through this fallback.
  return typeof el.getTotalLength === "function" ? el.getTotalLength() || 1 : 1;
}

export function ScreenBreak() {
  const flight = useSyncExternalStore(subscribe, getState).flight;
  if (!flight) return null;
  // key restarts the layer (fresh geometry, fresh rAF) if a later fire lands
  // on the same tick as a finish.
  return <ScreenBreakFlight key={flight.startedAt} flight={flight} />;
}

function ScreenBreakFlight({ flight }: { flight: ScreenBreakFlight }) {
  const geo = useMemo<BreakGeometry>(
    () =>
      buildBreak({
        W: flight.W,
        H: flight.H,
        P: flight.P,
        R: flight.R,
        rings: [flight.R * 1.7, flight.R * 2.7],
      }),
    [flight],
  );

  const appPathRef = useRef<SVGPathElement>(null);
  const holePathRef = useRef<SVGPathElement>(null);
  const groundRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const cracksSvgRef = useRef<SVGSVGElement>(null);
  const shardsRef = useRef<(SVGPolygonElement | null)[]>([]);
  const darkStrokesRef = useRef<(SVGPathElement | null)[]>([]);
  const liteStrokesRef = useRef<(SVGPathElement | null)[]>([]);
  const insideCreatureRef = useRef<HTMLDivElement>(null);
  const insideSpriteRef = useRef<HTMLDivElement>(null);
  const aboveCreatureRef = useRef<HTMLDivElement>(null);
  const aboveSpriteRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const isFist = flight.egg === "smash";
  const sprite = isFist ? <FistSprite /> : <EyeSprite />;

  useEffect(() => {
    const glass = getGlass();
    if (glass) {
      glass.style.clipPath = "url(#rk-sb-appclip)";
      // A fixed ground can only paint UNDER the glass if the glass is
      // positioned with a higher z-index; set position only when it computes
      // static (under html.fullbleed the glass is already fixed).
      if (window.getComputedStyle(glass).position === "static") {
        glass.style.position = "relative";
      }
      glass.style.zIndex = "1";
    }

    const dark = darkStrokesRef.current;
    const lite = liteStrokesRef.current;
    const strokes = geo.crackDs.map((_, i) => ({
      a: dark[i],
      b: lite[i],
      len: dark[i] ? pathLength(dark[i]) : 1,
      ring: false,
    }));
    for (let i = 0; i < geo.ringDs.length; i++) {
      const j = geo.crackDs.length + i;
      const el = dark[j];
      strokes.push({ a: el, b: lite[j], len: el ? pathLength(el) : 1, ring: true });
    }
    for (const s of strokes) {
      for (const el of [s.a, s.b]) {
        if (!el) continue;
        el.style.strokeDasharray = `${s.len}`;
        el.style.strokeDashoffset = `${s.len}`;
      }
    }

    const onPointer = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    if (!isFist) window.addEventListener("pointermove", onPointer, { passive: true });

    const f1 = (n: number) => n.toFixed(1);
    const writeSprite = (
      spriteEl: HTMLDivElement | null,
      scale: number,
      rotate: number,
      scaleY = 1,
    ) => {
      if (!spriteEl) return;
      spriteEl.style.transform = `translate(${f1(flight.P.x)}px,${f1(flight.P.y)}px)`;
      const svg = spriteEl.firstElementChild;
      if (svg instanceof SVGSVGElement) {
        svg.style.transform = `translate(-50%,-50%) scale(${scale.toFixed(3)})${scaleY === 1 ? "" : ` scaleY(${scaleY.toFixed(3)})`} rotate(${f1(rotate)}deg)`;
      }
    };

    const applyFrame = (t: number) => {
      const flash = t < 0.05 ? 1 - t / 0.05 : 0;
      const shake = t < 0.16 ? 1 - t / 0.16 : 0;
      const cracks = easeOut(t / 0.2);
      const rings = easeOut((t - 0.05) / 0.22);
      const hole = easeOut((t - 0.05) / 0.15) * (1 - easeIn((t - 0.76) / 0.16));
      const sp = clamp((t - 0.07) / 0.45);
      const em = smooth((t - 0.22) / 0.3) * (1 - smooth((t - 0.6) / 0.2));
      const cracksFade = 1 - clamp((t - 0.88) / 0.12);

      const holeD = holePathAt(geo, hole);
      appPathRef.current?.setAttribute("d", "M0 0H1V1H0Z " + holeD);
      holePathRef.current?.setAttribute("d", holeD);

      for (const s of strokes) {
        const off = s.len * (1 - (s.ring ? rings : cracks));
        s.a?.style.setProperty("stroke-dashoffset", `${off}`);
        s.b?.style.setProperty("stroke-dashoffset", `${off}`);
      }
      if (cracksSvgRef.current) cracksSvgRef.current.style.opacity = `${cracksFade}`;

      geo.shards.forEach((s, i) => {
        const el = shardsRef.current[i];
        if (!el) return;
        const tx = s.dir.x * s.speed * sp;
        const ty = s.dir.y * s.speed * sp + SHARD_GRAVITY * sp * sp;
        el.setAttribute(
          "transform",
          `translate(${f1(tx)} ${f1(ty)}) rotate(${f1(s.spin * sp)} ${f1(s.cx)} ${f1(s.cy)})`,
        );
        el.style.opacity = t > 0.06 ? `${1 - smooth((sp - 0.45) / 0.55)}` : "0";
      });

      if (groundRef.current) groundRef.current.style.opacity = `${Math.min(1, hole * 1.6)}`;
      if (flashRef.current) flashRef.current.style.opacity = `${flash * 0.7}`;
      if (glass) {
        glass.style.transform = shake
          ? `translate(${f1(Math.sin(t * 420) * 5 * shake)}px,${f1(Math.cos(t * 330) * 4 * shake)}px)`
          : "none";
      }

      const inside = insideCreatureRef.current;
      const above = aboveCreatureRef.current;
      if (isFist) {
        const s = (0.1 + 1.15 * em) * (flight.R / 76);
        const rotate = (1 - em) * -28;
        const released = em > 0.4;
        const opacity = (hole > 0.02 || released) && em > 0 ? "1" : "0";
        // Release = lose the hole clip AND rise above the glass in the same
        // frame — two stacked creature slots swap visibility (losing the clip
        // alone is not enough: the inside slot still paints under the glass).
        writeSprite(insideSpriteRef.current, s, rotate);
        writeSprite(aboveSpriteRef.current, s, rotate);
        if (inside) inside.style.opacity = released ? "0" : opacity;
        if (above) above.style.opacity = released ? opacity : "0";
        const shadow = released ? `drop-shadow(0 ${f1(16 * em)}px ${f1(20 * em)}px rgba(0,0,0,.65))` : "none";
        for (const el of [insideSpriteRef.current, aboveSpriteRef.current]) {
          const svg = el?.firstElementChild;
          if (svg instanceof SVGSVGElement) svg.style.filter = shadow;
        }
      } else {
        const blink = (c: number) => {
          const d = Math.abs(t - c);
          return d < 0.03 ? 1 - d / 0.03 : 0;
        };
        const b = Math.max(blink(0.4), blink(0.585));
        const pointer = pointerRef.current;
        const look = pointer
          ? {
              x: clamp((pointer.x - flight.P.x) / 260, -1, 1) * 22,
              y: clamp((pointer.y - flight.P.y) / 180, -1, 1) * 14,
            }
          : { x: Math.sin(t * 9) * 16, y: Math.cos(t * 6) * 8 };
        writeSprite(insideSpriteRef.current, 0.78 * (flight.R / 76), 0, 1 - b);
        const pupil = insideSpriteRef.current?.querySelector('[data-part="pupil"]');
        pupil?.setAttribute("transform", `translate(${f1(look.x)} ${f1(look.y)})`);
        if (inside) inside.style.opacity = hole > 0.02 ? `${Math.min(1, hole * 2)}` : "0";
        if (above) above.style.opacity = "0";
      }
    };

    const clearGlass = () => {
      if (!glass) return;
      glass.style.clipPath = "";
      glass.style.transform = "";
      glass.style.position = "";
      glass.style.zIndex = "";
    };

    let raf = 0;
    const frame = (now: number) => {
      const t = clamp((now - flight.startedAt) / FLIGHT_MS);
      applyFrame(t);
      if (t < 1) {
        raf = requestAnimationFrame(frame);
      } else {
        clearGlass();
        finish();
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      clearGlass();
      if (!isFist) window.removeEventListener("pointermove", onPointer);
    };
    // The flight is fixed at mount (keyed on startedAt); geometry derives from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div data-testid="screen-break" aria-hidden="true" style={{ display: "contents" }}>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <clipPath id="rk-sb-appclip" clipPathUnits="objectBoundingBox">
            <path ref={appPathRef} clipRule="evenodd" d="M0 0H1V1H0Z" />
          </clipPath>
          <clipPath id="rk-sb-hole" clipPathUnits="objectBoundingBox">
            <path ref={holePathRef} d="M0 0" />
          </clipPath>
        </defs>
      </svg>

      <div className="rk-sb-below">
        <div
          ref={groundRef}
          className="rk-sb-ground"
          style={{
            opacity: 0,
            backgroundImage: `radial-gradient(circle at ${flight.P.x}px ${flight.P.y}px, ${GLOW[flight.egg]}, rgba(3,4,10,0) 48%)`,
          }}
        />
        <div
          ref={insideCreatureRef}
          className="rk-sb-creature"
          data-part="creature-inside"
          style={{ clipPath: "url(#rk-sb-hole)", opacity: 0 }}
        >
          <div ref={insideSpriteRef} className="rk-sb-sprite">
            {sprite}
          </div>
        </div>
      </div>

      <div className="rk-sb-above">
        <svg
          ref={cracksSvgRef}
          className="rk-sb-cracks"
          viewBox={`0 0 ${flight.W} ${flight.H}`}
          preserveAspectRatio="none"
          style={{ clipPath: "url(#rk-sb-appclip)" }}
        >
          <g className="rk-sb-crack-dark">
            {geo.crackDs.map((d, i) => (
              <path
                key={`d${i}`}
                d={d}
                ref={(el) => {
                  darkStrokesRef.current[i] = el;
                }}
              />
            ))}
            {geo.ringDs.map((d, i) => (
              <path
                key={`dr${i}`}
                d={d}
                className="rk-sb-ring"
                ref={(el) => {
                  darkStrokesRef.current[geo.crackDs.length + i] = el;
                }}
              />
            ))}
          </g>
          <g className="rk-sb-crack-lite" transform="translate(0.8 0.8)">
            {geo.crackDs.map((d, i) => (
              <path
                key={`l${i}`}
                d={d}
                ref={(el) => {
                  liteStrokesRef.current[i] = el;
                }}
              />
            ))}
            {geo.ringDs.map((d, i) => (
              <path
                key={`lr${i}`}
                d={d}
                className="rk-sb-ring"
                ref={(el) => {
                  liteStrokesRef.current[geo.crackDs.length + i] = el;
                }}
              />
            ))}
          </g>
        </svg>
        <div
          ref={aboveCreatureRef}
          className="rk-sb-creature"
          data-part="creature-above"
          style={{ opacity: 0 }}
        >
          <div ref={aboveSpriteRef} className="rk-sb-sprite">
            {sprite}
          </div>
        </div>
        <svg
          className="rk-sb-shards"
          viewBox={`0 0 ${flight.W} ${flight.H}`}
          preserveAspectRatio="none"
        >
          {geo.shards.map((s, i) => (
            <polygon
              key={i}
              points={s.points}
              style={{ opacity: 0 }}
              ref={(el) => {
                shardsRef.current[i] = el;
              }}
            />
          ))}
        </svg>
        <div ref={flashRef} className="rk-sb-flash" style={{ opacity: 0 }} />
      </div>
    </div>
  );
}

/** The layout-level mount: the layer plus its automatic triggers. Mounted once
 *  in AppLayoutContent, beside the glass it clips. */
export function ScreenBreakController() {
  useScreenBreakTriggers();
  return <ScreenBreak />;
}
