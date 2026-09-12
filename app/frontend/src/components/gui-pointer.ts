/**
 * The gui tile's trackpad-mode translation layer (spec docs/specs/gui.md §
 * The tile). While attached it OWNS every canvas/desktop touch on the wrapper
 * in the capture phase — `stopPropagation` + `preventDefault`, so noVNC's
 * GestureHandler and its touchstart→focusCanvas listener never see them; the
 * layer calls `rfb.focus()` itself on a gesture's first touch — and re-emits
 * them as synthetic DOM events on noVNC's canvas. The guest-facing input path
 * is the public listener surface only: MouseEvents (noVNC maps `ev.buttons`
 * through `_convertButtonMask`) and px WheelEvents (noVNC accumulates them
 * into 50px wheel steps). No RFB private is ever called.
 *
 * The virtual cursor is a canvas-relative CSS-px point (seeded at the tile
 * centre, clamped to the canvas box) noVNC knows nothing about — its local
 * cursor is a CSS `cursor`, invisible under touch — so the caller-owned
 * indicator element (`gui-trackpad-cursor`, pointer-events none) is
 * positioned here in the wrapper's CONTENT coordinates (it rides the scroll
 * content). `canvas.width`/`height` carry the framebuffer size, so
 * rect/attribute is the live zoom scale for the framebuffer-coordinate
 * conversion. A relative move that would put the cursor outside the wrapper's
 * visible window calls the `ensureCursorVisible(fbX, fbY)` hook (the tile's
 * cursor-follow pan) so the viewport scrolls the cursor back inside.
 *
 * Gesture set (constants below): one-finger drag = relative move at
 * TRACKPAD_GAIN; tap / two-finger tap = left / right click at the cursor;
 * two-finger drag = 1:1 wheel deltas (no momentum); long-press = a held
 * mousedown (drag-and-drop); pinch = rk zoom steps via `onZoomStep`. A
 * two-finger gesture leaves the TAP_MAX_PX dead zone classified once and
 * locked: pinch when the inter-finger distance change exceeds the centroid
 * movement, scroll otherwise. The dead zone counts toward scroll deltas
 * (they emit from gesture start) but NOT toward pinch steps — a step is one
 * PINCH_STEP_PX of distance change BEYOND the dead zone, so a 160px spread
 * from rest steps exactly three times (R9's fit→100→125→150). A finger left
 * over after a multi-finger gesture is inert until fully lifted (no click, no
 * drag) — a drag start never produces a click (A-023).
 *
 * Chrome pass-through: touches targeted inside the wrapper's own chrome (the
 * key bar, the toolbar pill and its menus, the bare-WM strip) are never owned — swallowing
 * their touchstart would suppress the compatibility mouse events and leave
 * the buttons untappable. A touch keeps its start target for its whole life,
 * so the per-event target check decides ownership per gesture: a canvas drag
 * passing over the bar stays owned, a bar tap never enters gesture state.
 *
 * jsdom has no TouchEvent constructor — the handlers read only the
 * `touches`/`changedTouches` point lists ({ identifier, clientX, clientY }),
 * so tests dispatch plain Events with those props assigned.
 */
import { clampZoom } from "@/lib/zoom-gesture";

/** Finger-delta multiplier for relative cursor moves (plan window 1.0–1.5). */
export const TRACKPAD_GAIN = 1.25;
/** A lift within this window (and TAP_MAX_PX) is a tap, not a drag. */
export const TAP_MAX_MS = 180;
/** Movement dead zone: under this a gesture is a tap, not a drag/scroll/pinch. */
export const TAP_MAX_PX = 10;
/** A one-finger hold this long without leaving the dead zone presses and holds. */
export const LONG_PRESS_MS = 500;
/** Inter-finger distance change per rk zoom step, beyond the dead zone. */
export const PINCH_STEP_PX = 40;

/** DOM `buttons` bitmask values noVNC's `_convertButtonMask` reads. */
const DOM_BUTTONS_LEFT = 1;
const DOM_BUTTONS_RIGHT = 2;

/** The only RFB surface the layer touches — everything else reaches noVNC as
 *  DOM events on the canvas. */
export interface GuiPointerRfb {
  focus(): void;
}

export interface GuiPointerOptions {
  rfb: GuiPointerRfb;
  /** Canvas lookup; defaults to the wrapper's first canvas (noVNC's). */
  getCanvas?: () => HTMLCanvasElement | null;
  /** Caller-owned cursor indicator; the layer only positions it (left/top). */
  cursorEl?: HTMLElement | null;
  /** Override for TRACKPAD_GAIN (constant by design, not user-exposed). */
  gain?: number;
  onZoomStep: (direction: 1 | -1) => void;
  ensureCursorVisible: (fbX: number, fbY: number) => void;
}

interface Point {
  x: number;
  y: number;
}

interface ActiveTouch extends Point {
  id: number;
  startX: number;
  startY: number;
  /** Max displacement from the touchdown point over the touch's life. */
  moved: number;
}

interface TwoFingerGesture {
  kind: "two";
  startTime: number;
  startDist: number;
  startCentroid: Point;
  /** Distance baseline for step consumption: startDist ± the dead zone, set
   *  at classification; steps count BEYOND it (see the header). */
  distAtLastStep: number;
  lastCentroid: Point;
  classified: "pinch" | "scroll" | null;
  /** The first of the two fingers lifted inside the tap window. */
  pendingTap: boolean;
}

type Gesture =
  | { kind: "idle" }
  | {
      kind: "single";
      id: number;
      startTime: number;
      /** Long-press fired: the left button is held down until the lift. */
      held: boolean;
      longPressTimer: ReturnType<typeof setTimeout> | null;
    }
  | TwoFingerGesture
  /** A leftover finger after a multi-finger gesture, or 3+ fingers: inert. */
  | { kind: "ignored" };

/** jsdom-free touch-point shape: real Touch objects and plain test objects. */
interface RawTouch {
  identifier?: number;
  clientX: number;
  clientY: number;
}

function readPoints(list: ArrayLike<RawTouch>): { id: number; x: number; y: number }[] {
  const out: { id: number; x: number; y: number }[] = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    out.push({ id: t.identifier ?? i, x: t.clientX, y: t.clientY });
  }
  return out;
}

const CHROME_SELECTOR =
  '[data-testid="gui-keybar"], [data-testid="gui-wm-strip"], [data-testid="gui-surface-credentials"]';

/** The layer owns only canvas/desktop touches. Touches targeted at the
 *  wrapper's own chrome (the key bar's buttons, the bare-WM strip's
 *  controls, the credentials prompt's field and button) pass through
 *  untouched — swallowing them (or preventDefault'ing their touchstart)
 *  would suppress the compatibility mouse events, making the controls
 *  untappable. Ownership is decided at touchstart and a touch keeps its
 *  start target for its whole life, so a per-event target check covers the
 *  full gesture: a canvas drag passing OVER the bar stays owned, a bar tap
 *  never enters the gesture state. */
function targetsChrome(e: Event): boolean {
  return e.target instanceof Element && e.target.closest(CHROME_SELECTOR) !== null;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function attachGuiPointer(wrapper: HTMLElement, opts: GuiPointerOptions): () => void {
  const gain = opts.gain ?? TRACKPAD_GAIN;
  const getCanvas = opts.getCanvas ?? (() => wrapper.querySelector("canvas"));

  const touches = new Map<number, ActiveTouch>();
  let gesture: Gesture = { kind: "idle" };
  /** Canvas-relative CSS px; seeded lazily (the canvas may not exist at
   *  attach time) at the tile centre. */
  let cursor: Point | null = null;

  const positionIndicator = () => {
    const el = opts.cursorEl;
    const canvas = getCanvas();
    if (!el || !canvas || !cursor) return;
    const rect = canvas.getBoundingClientRect();
    const wRect = wrapper.getBoundingClientRect();
    // Content coordinates: the indicator is a child of the scroll container.
    el.style.left = `${rect.left - wRect.left + wrapper.scrollLeft + cursor.x}px`;
    el.style.top = `${rect.top - wRect.top + wrapper.scrollTop + cursor.y}px`;
  };

  const ensureCursor = (): Point | null => {
    if (cursor) return cursor;
    const canvas = getCanvas();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const wRect = wrapper.getBoundingClientRect();
    cursor = {
      x: clampZoom(wRect.left + wrapper.clientWidth / 2 - rect.left, 0, rect.width),
      y: clampZoom(wRect.top + wrapper.clientHeight / 2 - rect.top, 0, rect.height),
    };
    positionIndicator();
    return cursor;
  };

  const dispatchMouse = (type: "mousemove" | "mousedown" | "mouseup", button: 0 | 2, buttons: number) => {
    const canvas = getCanvas();
    const c = ensureCursor();
    if (!canvas || !c) return;
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new MouseEvent(type, {
        clientX: rect.left + c.x,
        clientY: rect.top + c.y,
        button,
        buttons,
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  const clickAt = (button: 0 | 2) => {
    dispatchMouse("mousedown", button, button === 0 ? DOM_BUTTONS_LEFT : DOM_BUTTONS_RIGHT);
    dispatchMouse("mouseup", button, 0);
  };

  const dispatchWheel = (dx: number, dy: number) => {
    const canvas = getCanvas();
    const c = ensureCursor();
    if (!canvas || !c) return;
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: dx,
        deltaY: dy,
        deltaMode: 0,
        clientX: rect.left + c.x,
        clientY: rect.top + c.y,
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  const moveCursorBy = (dx: number, dy: number) => {
    const canvas = getCanvas();
    const c = ensureCursor();
    if (!canvas || !c) return;
    const rect = canvas.getBoundingClientRect();
    c.x = clampZoom(c.x + dx * gain, 0, rect.width);
    c.y = clampZoom(c.y + dy * gain, 0, rect.height);
    // Cursor-edge follow: a move that lands outside the visible window pans
    // the viewport instead of losing the cursor (framebuffer coordinates:
    // canvas.width/height carry the fb size, rect carries the scaled size).
    const scale = canvas.width > 0 ? rect.width / canvas.width : 1;
    const wRect = wrapper.getBoundingClientRect();
    const screenX = rect.left + c.x;
    const screenY = rect.top + c.y;
    if (screenX < wRect.left || screenX > wRect.right || screenY < wRect.top || screenY > wRect.bottom) {
      opts.ensureCursorVisible(c.x / scale, c.y / scale);
    }
    positionIndicator();
  };

  const clearLongPress = (g: Extract<Gesture, { kind: "single" }>) => {
    if (g.longPressTimer !== null) {
      clearTimeout(g.longPressTimer);
      g.longPressTimer = null;
    }
  };

  const releaseHeld = (g: Extract<Gesture, { kind: "single" }>) => {
    if (!g.held) return;
    g.held = false;
    dispatchMouse("mouseup", 0, 0);
  };

  const beginSingle = (p: ActiveTouch) => {
    const g: Extract<Gesture, { kind: "single" }> = {
      kind: "single",
      id: p.id,
      startTime: Date.now(),
      held: false,
      longPressTimer: null,
    };
    g.longPressTimer = setTimeout(() => {
      g.longPressTimer = null;
      const t = touches.get(g.id);
      if (!t || t.moved >= TAP_MAX_PX) return;
      g.held = true;
      dispatchMouse("mousedown", 0, DOM_BUTTONS_LEFT);
    }, LONG_PRESS_MS);
    gesture = g;
  };

  const beginTwo = (): void => {
    const [a, b] = [...touches.values()];
    if (!a || !b) return;
    gesture = {
      kind: "two",
      startTime: Date.now(),
      startDist: dist(a, b),
      startCentroid: centroid(a, b),
      distAtLastStep: dist(a, b),
      lastCentroid: centroid(a, b),
      classified: null,
      pendingTap: false,
    };
  };

  /** Sync the touch map with a move event; returns per-touch deltas. */
  const applyMoves = (e: TouchEvent): Map<number, Point> => {
    const deltas = new Map<number, Point>();
    for (const p of readPoints(e.changedTouches)) {
      const t = touches.get(p.id);
      if (!t) continue;
      t.moved = Math.max(t.moved, Math.hypot(p.x - t.startX, p.y - t.startY));
      deltas.set(p.id, { x: p.x - t.x, y: p.y - t.y });
      t.x = p.x;
      t.y = p.y;
    }
    return deltas;
  };

  const handleTwoMove = (g: TwoFingerGesture) => {
    const [a, b] = [...touches.values()];
    if (!a || !b) return;
    const d = dist(a, b);
    const c = centroid(a, b);
    if (g.classified === null) {
      const distChange = Math.abs(d - g.startDist);
      const centroidMove = Math.hypot(c.x - g.startCentroid.x, c.y - g.startCentroid.y);
      if (Math.max(distChange, centroidMove) < TAP_MAX_PX) return;
      g.classified = distChange > centroidMove ? "pinch" : "scroll";
      if (g.classified === "pinch") {
        // Steps count BEYOND the dead zone (see the header / R9's ladder).
        g.distAtLastStep = g.startDist + Math.sign(d - g.startDist) * TAP_MAX_PX;
      }
    }
    if (g.classified === "pinch") {
      while (d - g.distAtLastStep >= PINCH_STEP_PX) {
        opts.onZoomStep(1);
        g.distAtLastStep += PINCH_STEP_PX;
      }
      while (g.distAtLastStep - d >= PINCH_STEP_PX) {
        opts.onZoomStep(-1);
        g.distAtLastStep -= PINCH_STEP_PX;
      }
    } else {
      // 1:1 with the centroid, from gesture start (the dead zone included) —
      // no momentum, nothing more after the lift.
      dispatchWheel(c.x - g.lastCentroid.x, c.y - g.lastCentroid.y);
      g.lastCentroid = c;
    }
  };

  const swallow = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const onTouchStart = (e: TouchEvent) => {
    if (targetsChrome(e)) return;
    swallow(e);
    const added = readPoints(e.changedTouches);
    if (touches.size === 0 && added.length > 0) opts.rfb.focus();
    for (const p of added) {
      touches.set(p.id, { id: p.id, x: p.x, y: p.y, startX: p.x, startY: p.y, moved: 0 });
    }
    if (touches.size === 1) {
      if (gesture.kind === "idle") {
        const only = touches.values().next().value;
        if (only) beginSingle(only);
      }
    } else if (touches.size === 2) {
      if (gesture.kind === "single") {
        // A second finger converts the pending tap/long-press into a
        // two-finger gesture; a held button releases first (A-023).
        clearLongPress(gesture);
        releaseHeld(gesture);
        beginTwo();
      } else if (gesture.kind === "idle") {
        // Both contacts arriving in ONE touchstart (coalesced delivery).
        beginTwo();
      }
    } else {
      if (gesture.kind === "single") {
        clearLongPress(gesture);
        releaseHeld(gesture);
      }
      gesture = { kind: "ignored" };
    }
  };

  const onTouchMove = (e: TouchEvent) => {
    if (targetsChrome(e)) return;
    swallow(e);
    const deltas = applyMoves(e);
    if (gesture.kind === "single") {
      const t = touches.get(gesture.id);
      const delta = deltas.get(gesture.id);
      if (!t || !delta) return;
      if (t.moved >= TAP_MAX_PX) clearLongPress(gesture);
      moveCursorBy(delta.x, delta.y);
      dispatchMouse("mousemove", 0, gesture.held ? DOM_BUTTONS_LEFT : 0);
    } else if (gesture.kind === "two" && touches.size >= 2) {
      handleTwoMove(gesture);
    }
  };

  const finishTouch = (e: TouchEvent, cancelled: boolean) => {
    if (targetsChrome(e)) return;
    swallow(e);
    // Capture the lifted touches' records before dropping them — the tap
    // classifier needs their lifetime movement.
    const lifted = readPoints(e.changedTouches).map((p) => ({ p, rec: touches.get(p.id) }));
    for (const { p } of lifted) touches.delete(p.id);

    if (gesture.kind === "single") {
      const g = gesture;
      const own = lifted.find(({ p }) => p.id === g.id);
      if (!own) return;
      const wasHeld = g.held;
      clearLongPress(g);
      releaseHeld(g);
      // A drag start never produces a click: a long-press lift only releases.
      if (!cancelled && !wasHeld && own.rec) {
        const elapsed = Date.now() - g.startTime;
        if (elapsed <= TAP_MAX_MS && own.rec.moved < TAP_MAX_PX) clickAt(0);
      }
      // Extra fingers still down: the gesture continues inert until all lift.
      gesture = touches.size === 0 ? { kind: "idle" } : { kind: "ignored" };
      return;
    }
    if (gesture.kind === "two") {
      const g = gesture;
      // Both fingers of a two-finger tap lift within the window — whether in
      // one touchend (2→0) or two (2→1→0) — and neither left the dead zone:
      // right-click once the last one is up.
      const withinWindow = Date.now() - g.startTime <= TAP_MAX_MS;
      const allStill = [...touches.values(), ...lifted.map(({ rec }) => rec)].every(
        (t) => t !== undefined && t.moved < TAP_MAX_PX,
      );
      if (!cancelled && g.classified === null && touches.size <= 1 && withinWindow && allStill) {
        g.pendingTap = true;
      }
      if (touches.size === 0) {
        if (!cancelled && g.pendingTap && withinWindow) clickAt(2);
        gesture = { kind: "idle" };
      }
      return;
    }
    if (gesture.kind === "ignored" && touches.size === 0) {
      gesture = { kind: "idle" };
    }
  };

  const onTouchEnd = (e: TouchEvent) => finishTouch(e, false);
  const onTouchCancel = (e: TouchEvent) => finishTouch(e, true);

  // Capture-phase, non-passive: noVNC's canvas-attached GestureHandler and
  // focusCanvas listener never see a touch while the layer is attached.
  const listen = { capture: true, passive: false } as const;
  wrapper.addEventListener("touchstart", onTouchStart, listen);
  wrapper.addEventListener("touchmove", onTouchMove, listen);
  wrapper.addEventListener("touchend", onTouchEnd, listen);
  wrapper.addEventListener("touchcancel", onTouchCancel, listen);

  return () => {
    wrapper.removeEventListener("touchstart", onTouchStart, listen);
    wrapper.removeEventListener("touchmove", onTouchMove, listen);
    wrapper.removeEventListener("touchend", onTouchEnd, listen);
    wrapper.removeEventListener("touchcancel", onTouchCancel, listen);
    if (gesture.kind === "single") {
      clearLongPress(gesture);
      releaseHeld(gesture);
    }
    touches.clear();
    gesture = { kind: "idle" };
  };
}
