/**
 * ScreenBreak — the one-shot, whole-viewport Easter-egg event layer. Renders
 * `null` while idle; while a flight is in progress it renders the layer stack
 * around the glass (the `.app-root` div, registered into the store via a ref
 * callback): the dark inside-ground + hole-clipped creature BELOW the glass,
 * and — ABOVE it — the dead-pixel LCD lines, the evenodd-clipped cracks (a
 * frost circle over the crushed zone, then dark cores and offset highlights),
 * the released creature, the shards, and the flash. The glass itself receives
 * only inline `clip-path` / `transform` (plus `position`/`z-index` when it
 * computes `static`) — all removed on finish, on unmount, and on cancel.
 *
 * The layer MUST be a sibling of the glass, never a descendant: `clip-path`
 * on an ancestor clips fixed descendants and `transform` re-anchors them, so
 * mounting inside `.app-root` would clip/re-anchor the layer's own fixed
 * fragments.
 *
 * Discipline (copied from FlairOverlay): aria-hidden, pointer-events none,
 * per-frame writes are transforms / opacity / filter / SVG attributes only,
 * ONE requestAnimationFrame loop drives the 12 s flight, no other timers;
 * the single permitted event listener is a passive `pointermove` while the
 * eye is in flight. Under prefers-reduced-motion the store's `fire` never
 * starts a flight, so this layer never mounts (no static fallback — a
 * non-animating crack reads as a broken UI).
 */

import { Fragment, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
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
import { getSettingsEntries } from "@/api/client";
import { setEasterEggsEnabled } from "@/lib/screen-break-store";
import { EyeSprite, FistSprite } from "./screen-break-sprites";

const FLIGHT_MS = 12000;
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
    () => buildBreak({ W: flight.W, H: flight.H, P: flight.P, R: flight.R }),
    [flight],
  );

  const appPathRef = useRef<SVGPathElement>(null);
  const holePathRef = useRef<SVGPathElement>(null);
  const groundRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const frostRef = useRef<SVGCircleElement>(null);
  const cracksSvgRef = useRef<SVGSVGElement>(null);
  const lcdSvgRef = useRef<SVGSVGElement>(null);
  const shardsRef = useRef<(SVGPolygonElement | null)[]>([]);
  const darkStrokesRef = useRef<(SVGPathElement | null)[]>([]);
  const liteStrokesRef = useRef<(SVGPathElement | null)[]>([]);
  const lineCoreRef = useRef<(SVGLineElement | null)[]>([]);
  const lineGlowRef = useRef<(SVGLineElement | null)[]>([]);
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

    const strokes = geo.strokes.map((s, i) => ({
      ...s,
      a: darkStrokesRef.current[i],
      b: liteStrokesRef.current[i],
      len: darkStrokesRef.current[i] ? pathLength(darkStrokesRef.current[i]) : 1,
    }));
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

    // Timeline (fractions of the 12 s flight; seconds in brackets):
    //   flash / shake   t < 0.025, decaying 1 − t/0.025                      [0–0.3 s]
    //   frost           0.9 · easeOut((t − 0.008)/0.045)                     [0.1–0.6 s]
    //   per stroke      own {start, dur, ease, s0, s1} window (dash rule below)
    //   hole            easeOut((t − 0.17)/0.1) · (1 − easeIn((t − 0.76)/0.1))   [open 2.0–3.2 s, close 9.1–10.3 s]
    //   shards          sp = clamp((t − 0.18)/0.25), visible once t > 0.17   [2.2–5.2 s]
    //   creature        em = smooth((t − 0.3)/0.14) · (1 − smooth((t − 0.64)/0.12))  [in 3.6–5.3 s, out 7.7–9.1 s]
    //   eye blinks      centres 0.47 and 0.58, ±0.03 — inside em's plateau  [5.6 s, 7.0 s]
    //   per LCD line    on at its start, pops in instantly, flickers
    //   fade            1 − clamp((t − 0.87)/0.13) — cracks AND lcd SVGs     [10.4–12 s]
    const applyFrame = (t: number) => {
      const flash = t < 0.025 ? 1 - t / 0.025 : 0;
      const shake = t < 0.025 ? 1 - t / 0.025 : 0;
      const hole = easeOut((t - 0.17) / 0.1) * (1 - easeIn((t - 0.76) / 0.1));
      const sp = clamp((t - 0.18) / 0.25);
      const em = smooth((t - 0.3) / 0.14) * (1 - smooth((t - 0.64) / 0.12));
      const fade = 1 - clamp((t - 0.87) / 0.13);

      const holeD = holePathAt(geo, hole);
      appPathRef.current?.setAttribute("d", "M0 0H1V1H0Z " + holeD);
      holePathRef.current?.setAttribute("d", holeD);

      // Each stroke draws over its own window; the tapered pieces of one crack
      // chain via s0/s1 so they draw back-to-back as a single travelling crack.
      for (const s of strokes) {
        const p = (s.ease === "smooth" ? smooth : easeOut)((t - s.start) / s.dur);
        const q = clamp((p - s.s0) / (s.s1 - s.s0 || 1));
        const off = s.len * (1 - q);
        s.a?.style.setProperty("stroke-dashoffset", `${off}`);
        s.b?.style.setProperty("stroke-dashoffset", `${off}`);
      }
      if (frostRef.current) {
        frostRef.current.style.opacity = `${0.9 * easeOut((t - 0.008) / 0.045)}`;
      }

      geo.lines.forEach((l, i) => {
        const core = lineCoreRef.current[i];
        const glow = lineGlowRef.current[i];
        const on = t >= l.start;
        // LCD lines pop in instantly and flicker a little.
        const flick = on ? (Math.sin(t * 900 + l.flick) > 0.92 ? 0.55 : 1) : 0;
        if (core) core.style.opacity = on ? `${l.op * flick}` : "0";
        if (glow) glow.style.opacity = on ? `${0.22 * flick}` : "0";
      });

      if (cracksSvgRef.current) cracksSvgRef.current.style.opacity = `${fade}`;
      if (lcdSvgRef.current) lcdSvgRef.current.style.opacity = `${fade}`;

      geo.shards.forEach((s, i) => {
        const el = shardsRef.current[i];
        if (!el) return;
        const tx = s.dir.x * s.speed * sp;
        const ty = s.dir.y * s.speed * sp + SHARD_GRAVITY * sp * sp;
        el.setAttribute(
          "transform",
          `translate(${f1(tx)} ${f1(ty)}) rotate(${f1(s.spin * sp)} ${f1(s.cx)} ${f1(s.cy)})`,
        );
        el.style.opacity = t > 0.17 ? `${1 - smooth((sp - 0.45) / 0.55)}` : "0";
      });

      if (groundRef.current) groundRef.current.style.opacity = `${Math.min(1, hole * 1.6)}`;
      if (flashRef.current) flashRef.current.style.opacity = `${flash * 0.7}`;
      if (glass) {
        glass.style.transform = shake
          ? `translate(${f1(Math.sin(t * 840) * 5 * shake)}px,${f1(Math.cos(t * 660) * 4 * shake)}px)`
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
        const b = Math.max(blink(0.47), blink(0.58));
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
          <radialGradient
            id="rk-sb-frost"
            gradientUnits="userSpaceOnUse"
            cx={flight.P.x}
            cy={flight.P.y}
            r={flight.R * 1.5}
          >
            <stop offset="0.6" stopColor="rgba(255,255,255,0.16)" />
            <stop offset="1" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
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
        {/* The LCD layer sits below the glass cracks: dead pixels read as the
            panel underneath, and both SVGs share the app clip and the fade. */}
        <svg
          ref={lcdSvgRef}
          className="rk-sb-lcd"
          viewBox={`0 0 ${flight.W} ${flight.H}`}
          preserveAspectRatio="none"
          style={{ clipPath: "url(#rk-sb-appclip)" }}
        >
          <g className="rk-sb-lines">
            {geo.lines.map((l, i) => (
              <Fragment key={i}>
                <line
                  x1={l.x1}
                  y1={l.y1}
                  x2={l.x2}
                  y2={l.y2}
                  stroke={l.color}
                  strokeWidth={l.w + 2.5}
                  style={{ opacity: 0 }}
                  ref={(el) => {
                    lineGlowRef.current[i] = el;
                  }}
                />
                <line
                  x1={l.x1}
                  y1={l.y1}
                  x2={l.x2}
                  y2={l.y2}
                  stroke={l.color}
                  strokeWidth={l.w}
                  style={{ opacity: 0 }}
                  ref={(el) => {
                    lineCoreRef.current[i] = el;
                  }}
                />
              </Fragment>
            ))}
          </g>
        </svg>
        <svg
          ref={cracksSvgRef}
          className="rk-sb-cracks"
          viewBox={`0 0 ${flight.W} ${flight.H}`}
          preserveAspectRatio="none"
          style={{ clipPath: "url(#rk-sb-appclip)" }}
        >
          <circle
            ref={frostRef}
            className="rk-sb-frost"
            cx={flight.P.x}
            cy={flight.P.y}
            r={flight.R * 1.5}
            fill="url(#rk-sb-frost)"
            style={{ opacity: 0 }}
          />
          <g className="rk-sb-crack-dark">
            {geo.strokes.map((s, i) => (
              <path
                key={`d${i}`}
                d={s.d}
                strokeWidth={s.w}
                ref={(el) => {
                  darkStrokesRef.current[i] = el;
                }}
              />
            ))}
          </g>
          {/* Width is a per-piece presentation attribute, not a class: a CSS
              stroke-width rule would override every attribute. */}
          <g className="rk-sb-crack-lite" transform="translate(0.7 0.7)">
            {geo.strokes.map((s, i) => (
              <path
                key={`l${i}`}
                d={s.d}
                strokeWidth={s.lw}
                ref={(el) => {
                  liteStrokesRef.current[i] = el;
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
 *  in AppLayoutContent, beside the glass it clips. One mount GET seeds the
 *  store's `easter_eggs` gate — no polling, no SSE; other browsers pick a flip
 *  up on reload. A missing key or a rejected fetch keeps the default (on). */
export function ScreenBreakController() {
  useEffect(() => {
    let cancelled = false;
    getSettingsEntries()
      .then((entries) => {
        if (cancelled) return;
        const entry = entries.find((e) => e.key === "easter_eggs");
        setEasterEggsEnabled(entry === undefined || entry.value !== false);
      })
      .catch(() => {
        // Fetch failure keeps the store enabled (default on).
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useScreenBreakTriggers();
  return <ScreenBreak />;
}
