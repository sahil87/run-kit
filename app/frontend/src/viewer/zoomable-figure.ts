/**
 * The zoomable figure — the DOM half of viewer pan/zoom (`pan-zoom.ts` is the
 * math). A rendered SVG (an excalidraw scene, a mermaid diagram) is wrapped in
 * a clipping viewport whose only magnification is a CSS transform on the SVG:
 * vector text stays crisp at any scale and nothing re-renders.
 *
 * Two layout modes: "canvas" fills the frame viewport (one excalidraw scene
 * per document, contain-fit); "inline" sits in flowing markdown at the fitted
 * height (width-fit) with an Expand toggle to the viewport height.
 *
 * Ownership boundary with the web tile: the tile attaches its own ctrl/meta
 * wheel arm at the frame DOCUMENT's capture phase on every load. This module
 * claims figure gestures one level up — WINDOW capture — and stops them, so
 * over a figure the figure zooms and the tile never sees the event, while
 * every other wheel in the document still zooms the tile exactly as before.
 * Plain keys only (`+ - 0`, arrows): every tile chord is on a modifier tier,
 * so unmodified keys are never reclaimed from the frame, and the modifier
 * variants belong to the browser and the desktop shell.
 */

import {
  FIGURE_ZOOM_MAX,
  PAN_STEP_PX,
  PAN_STEP_SHIFT_FACTOR,
  type FitMode,
  type Point,
  type Size,
  type ZoomState,
  clampTranslation,
  fitScale,
  fitState,
  formatPercent,
  isPannable,
  minScale,
  parseViewBox,
  pinchScale,
  sameScale,
  stepScale,
  wheelScale,
  zoomAboutPoint,
} from "./pan-zoom";

export type FigureMode = "canvas" | "inline";

export interface ZoomableFigureOptions {
  mode: FigureMode;
  /** The accessible name stem, e.g. "Scene" or "Diagram 2". */
  label: string;
}

/** The CSS class every figure carries (the holder keeps its renderer class). */
export const FIGURE_CLASS = "viewer-figure";
const VIEWPORT_CLASS = "viewer-figure-viewport";
const CONTROLS_CLASS = "viewer-figure-controls";
const EXPANDED_ATTR = "data-expanded";
/** The inline Expand box height: the frame viewport minus a breathing margin. */
const EXPANDED_HEIGHT = "calc(100vh - 2rem)";

interface FigureController {
  /** Applies a wheel/pinch scale change anchored at a client point. */
  zoomAt(nextScale: number, client: Point): void;
  /** Pinch base capture (Safari gesturestart / two-pointer start). */
  currentScale(): number;
  minScale(): number;
}

const controllers = new WeakMap<Element, FigureController>();

function naturalSizeOf(svg: SVGSVGElement): Size {
  const fromViewBox = parseViewBox(svg.getAttribute("viewBox"));
  if (fromViewBox !== null) return fromViewBox;
  const w = Number(svg.getAttribute("width"));
  const h = Number(svg.getAttribute("height"));
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h };
  // No usable size: a 1×1 natural size fits at 1 and pans nowhere.
  return { w: 1, h: 1 };
}

function button(label: string, glyph: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.textContent = glyph;
  return b;
}

/** Turn `holder` (which already contains `svg`) into a zoomable figure. */
export function mountZoomableFigure(holder: HTMLElement, svg: SVGSVGElement, opts: ZoomableFigureOptions): void {
  const natural = naturalSizeOf(svg);
  const fitMode: FitMode = opts.mode === "canvas" ? "contain" : "width";

  // Explicit natural sizing: mermaid emits width="100%" plus an inline
  // max-width, and the old stylesheet fitted by max-width — both would make
  // the layout box track the container and fight the transform. With the box
  // pinned to the natural size, the transform is the ONLY magnification.
  svg.setAttribute("width", String(natural.w));
  svg.setAttribute("height", String(natural.h));
  svg.style.maxWidth = "none";
  svg.style.transformOrigin = "0 0";

  holder.classList.add(FIGURE_CLASS);
  holder.dataset.mode = opts.mode;
  holder.tabIndex = 0;
  holder.setAttribute("role", "group");
  holder.dataset.testid = "viewer-figure";

  const viewport = document.createElement("div");
  viewport.className = VIEWPORT_CLASS;
  viewport.append(svg);

  const controls = document.createElement("div");
  controls.className = CONTROLS_CLASS;
  controls.setAttribute("role", "toolbar");
  controls.setAttribute("aria-label", "Zoom controls");
  const zoomOut = button("Zoom out", "−");
  const readout = document.createElement("output");
  readout.dataset.testid = "viewer-figure-readout";
  readout.setAttribute("aria-live", "polite");
  const zoomIn = button("Zoom in", "+");
  const fit = button("Fit to view", "⤢");
  controls.append(zoomOut, readout, zoomIn, fit);
  let expand: HTMLButtonElement | null = null;
  if (opts.mode === "inline") {
    expand = button("Expand", "⤡");
    expand.setAttribute("aria-pressed", "false");
    controls.append(expand);
  }

  holder.replaceChildren(viewport, controls);

  const containerSize = (): Size => {
    const r = viewport.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  // Inline figures own their height: the fitted height at rest (today's look,
  // no clipping), the expanded height while Expand is pressed. Canvas figures
  // take their height from the stylesheet (the frame viewport).
  const applyInlineHeight = (): void => {
    if (opts.mode !== "inline") return;
    if (holder.getAttribute(EXPANDED_ATTR) === "true") {
      viewport.style.height = EXPANDED_HEIGHT;
      return;
    }
    const w = viewport.getBoundingClientRect().width;
    const s = fitScale(natural, { w, h: Number.POSITIVE_INFINITY }, "width");
    viewport.style.height = `${natural.h * s}px`;
  };

  applyInlineHeight();
  let container = containerSize();
  let fit0 = fitScale(natural, container, fitMode);
  let state: ZoomState = fitState(natural, container, fitMode);

  const apply = (next: ZoomState): void => {
    state = clampTranslation(next, natural, container);
    svg.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
    // Strict boundary tests: every path lands exactly on the fit (fitState)
    // or exactly on a clamp bound (clampZoom), so no tolerance is needed here
    // and one would misreport a real, if tiny, change. `sameScale` is for the
    // refit-vs-reclamp decision only.
    const zoomed = state.scale > fit0;
    holder.dataset.zoomed = zoomed ? "true" : "false";
    // At fit the page must still scroll under a finger over an inline diagram;
    // once zoomed the figure owns every touch (drag pan, two-finger pinch).
    viewport.style.touchAction = zoomed ? "none" : "pan-x pan-y";
    const pct = formatPercent(state.scale);
    readout.value = pct;
    holder.setAttribute("aria-label", `${opts.label}, zoom ${pct}`);
    zoomOut.disabled = state.scale <= minScale(fit0);
    zoomIn.disabled = state.scale >= FIGURE_ZOOM_MAX;
  };

  const refit = (): void => {
    applyInlineHeight();
    container = containerSize();
    fit0 = fitScale(natural, container, fitMode);
    apply(fitState(natural, container, fitMode));
  };

  const viewportPoint = (client: Point): Point => {
    const r = viewport.getBoundingClientRect();
    return { x: client.x - r.left, y: client.y - r.top };
  };

  const zoomAt = (nextScale: number, client: Point): void => {
    apply(zoomAboutPoint(state, nextScale, viewportPoint(client)));
  };

  const zoomAtCenter = (nextScale: number): void => {
    const r = viewport.getBoundingClientRect();
    zoomAt(nextScale, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  };

  const pannable = (): boolean => isPannable(state.scale, natural, container);

  const panBy = (dx: number, dy: number): void => {
    apply({ scale: state.scale, tx: state.tx + dx, ty: state.ty + dy });
  };

  controllers.set(holder, {
    zoomAt,
    currentScale: () => state.scale,
    minScale: () => minScale(fit0),
  });

  zoomIn.addEventListener("click", () => zoomAtCenter(stepScale(state.scale, "in", minScale(fit0))));
  zoomOut.addEventListener("click", () => zoomAtCenter(stepScale(state.scale, "out", minScale(fit0))));
  fit.addEventListener("click", () => refit());
  expand?.addEventListener("click", () => {
    const on = holder.getAttribute(EXPANDED_ATTR) !== "true";
    holder.setAttribute(EXPANDED_ATTR, on ? "true" : "false");
    expand.setAttribute("aria-pressed", on ? "true" : "false");
    applyInlineHeight();
    // The box changed size under the same scale: re-measure and re-clamp, and
    // if we were at fit, stay at fit for the new box.
    const wasAtFit = sameScale(state.scale, fit0);
    container = containerSize();
    fit0 = fitScale(natural, container, fitMode);
    apply(wasAtFit ? fitState(natural, container, fitMode) : state);
    holder.scrollIntoView({ block: "nearest" });
  });

  // Pointer: one pointer drags when pannable; two pointers pinch about their
  // midpoint. Pointer capture keeps a fast drag from escaping the viewport.
  const pointers = new Map<number, Point>();
  let pinchBase = 0;
  let pinchStartDist = 0;
  let dragLast: Point | null = null;

  const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
  const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  viewport.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    holder.focus({ preventScroll: true });
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewport.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchBase = state.scale;
      pinchStartDist = distance(a, b);
      dragLast = null;
    } else if (pointers.size === 1 && pannable()) {
      dragLast = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  });

  viewport.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinchStartDist > 0) {
      const [a, b] = [...pointers.values()];
      const ratio = distance(a, b) / pinchStartDist;
      zoomAt(pinchScale(pinchBase, ratio, minScale(fit0)), midpoint(a, b));
      return;
    }
    if (dragLast !== null) {
      panBy(e.clientX - dragLast.x, e.clientY - dragLast.y);
      dragLast = { x: e.clientX, y: e.clientY };
    }
  });

  const release = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
    if (pointers.size < 2) pinchStartDist = 0;
    if (pointers.size === 0) dragLast = null;
  };
  viewport.addEventListener("pointerup", release);
  viewport.addEventListener("pointercancel", release);

  // Keyboard: plain keys only (see the module comment). Handled while focus is
  // anywhere inside the figure, including its toolbar buttons.
  holder.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const step = e.shiftKey ? PAN_STEP_PX * PAN_STEP_SHIFT_FACTOR : PAN_STEP_PX;
    switch (e.key) {
      case "+":
      case "=":
        zoomAtCenter(stepScale(state.scale, "in", minScale(fit0)));
        break;
      case "-":
      case "_":
        zoomAtCenter(stepScale(state.scale, "out", minScale(fit0)));
        break;
      case "0":
        refit();
        break;
      case "ArrowLeft":
        if (!pannable()) return;
        panBy(step, 0);
        break;
      case "ArrowRight":
        if (!pannable()) return;
        panBy(-step, 0);
        break;
      case "ArrowUp":
        if (!pannable()) return;
        panBy(0, step);
        break;
      case "ArrowDown":
        if (!pannable()) return;
        panBy(0, -step);
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  // Resize: at fit, follow the container; when zoomed, keep the scale and
  // only re-clamp so content edges stay pinned.
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (sameScale(state.scale, fit0)) {
        refit();
        return;
      }
      applyInlineHeight();
      container = containerSize();
      fit0 = fitScale(natural, container, fitMode);
      apply(state);
    });
    ro.observe(viewport);
  }

  apply(state);
}

function figureOf(target: EventTarget | null): FigureController | null {
  if (!(target instanceof Element)) return null;
  const holder = target.closest(`.${FIGURE_CLASS}`);
  return holder === null ? null : (controllers.get(holder) ?? null);
}

// Safari reports pinch as gesture* events with a cumulative scale from
// gesturestart; the base is captured there per figure.
let gestureBase: FigureController | null = null;
let gestureBaseScale = 1;

/**
 * Install the viewer-wide gesture arm once. Window capture runs before the
 * tile's document-capture arm; only events over a figure are claimed.
 */
export function installFigureGestureArm(): void {
  window.addEventListener(
    "wheel",
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const figure = figureOf(e.target);
      if (figure === null) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      figure.zoomAt(wheelScale(figure.currentScale(), e.deltaY, figure.minScale()), {
        x: e.clientX,
        y: e.clientY,
      });
    },
    { capture: true, passive: false },
  );

  window.addEventListener(
    "gesturestart",
    (e) => {
      const figure = figureOf(e.target);
      if (figure === null) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      gestureBase = figure;
      gestureBaseScale = figure.currentScale();
    },
    { capture: true, passive: false },
  );

  window.addEventListener(
    "gesturechange",
    (e) => {
      const figure = figureOf(e.target);
      if (figure === null || figure !== gestureBase) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const ge = e as Event & { scale?: number; clientX?: number; clientY?: number };
      figure.zoomAt(pinchScale(gestureBaseScale, ge.scale ?? 1, figure.minScale()), {
        x: ge.clientX ?? 0,
        y: ge.clientY ?? 0,
      });
    },
    { capture: true, passive: false },
  );

  window.addEventListener(
    "gestureend",
    () => {
      gestureBase = null;
    },
    { capture: true },
  );
}
