/**
 * Shared gesture→zoom-step reduction (260823-cwvv R6).
 *
 * Both tiles (terminal font, web content zoom) step their zoom from the same
 * gestures — Ctrl/Cmd+wheel and touchpad pinch — so the gesture→step
 * reduction lives here once. Pure and DOM-free: callers own the listeners
 * (non-passive `wheel`, Safari `gesturestart`/`gesturechange`) and feed the
 * events' deltas in; this module owns ONLY the accumulation math.
 *
 * Two reduction FAMILIES, chosen by what the consumer's zoom state can hold:
 *
 * STEPPED (the terminal's integer font sizes): the accumulator/gesture-arm
 * pair below reduces gestures to discrete ±1 steps.
 *
 * 1. Ctrl-wheel — pinch on a touchpad arrives as `wheel` events with
 *    `ctrlKey: true` (every browser but Safari), as does an explicit
 *    Ctrl-scroll. Small deltas accumulate; one `+1`/`-1` step emits per
 *    `WHEEL_STEP_THRESHOLD` of accumulated `|deltaY|`, the remainder carries
 *    (a long pinch emits multiple steps, a short one at most one), and a
 *    direction flip resets the accumulator (no phantom step from the
 *    leftover of the reversed direction).
 * 2. Safari `gesturechange` — Safari's pinch events carry a `scale` ratio
 *    instead of ctrl-wheel deltas; the arm reduces the cumulative ratio
 *    against the level consumed at the last step, emitting one step per
 *    `GESTURE_STEP_RATIO` (~1.1×) of movement.
 *
 * CONTINUOUS (the web tile's float zoom factor, 260824-iafo): gestures track
 * the fingers like Chrome/macOS — no thresholds, no ladder. `applyWheelZoom`
 * maps each wheel event multiplicatively (`exp(-deltaY * sensitivity)` — equal
 * deltas multiply equally, so in/out feel symmetric); Safari needs no module
 * state at all (its `scale` is cumulative from `gesturestart`, so the consumer
 * computes `clampZoom(base * scale)` directly). The stepped family stays for
 * consumers whose zoom state is inherently discrete.
 */

/** Accumulated ctrl-wheel `deltaY` per zoom step — matches the common
 *  editor/browser pinch feel (plan assumption #2). */
export const WHEEL_STEP_THRESHOLD = 50;

/** The gesture `scale` ratio per zoom step (~1.1×) for the Safari arm. */
export const GESTURE_STEP_RATIO = 1.1;

/** Continuous wheel→zoom sensitivity: each wheel event multiplies the factor
 *  by `exp(-deltaY * sensitivity)` (the Chrome-like mapping). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Clamp a zoom factor into `[min, max]`. */
export function clampZoom(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Continuous wheel mapping: the next zoom factor for one ctrl/meta-wheel
 * event. Wheel/pinch up (negative deltaY) zooms in — the same sign convention
 * as the stepped accumulator. Exponential, so equal deltas multiply equally
 * and a gesture reversed halfway returns exactly to its start.
 */
export function applyWheelZoom(current: number, deltaY: number, min: number, max: number): number {
  return clampZoom(current * Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY), min, max);
}

export type ZoomGestureStep = 1 | -1;

/**
 * Create a wheel-delta accumulator. `feed(deltaY)` returns the number of
 * steps the delta completes (signed: positive = zoom in, negative = zoom
 * out) — usually 0 or ±1, more for a fast flick. Wheel-up (negative deltaY)
 * zooms in, matching every browser's Ctrl-scroll convention.
 */
export function createWheelAccumulator(): (deltaY: number) => number {
  let accumulated = 0;
  return (deltaY: number): number => {
    // Direction flip: drop the leftover from the reversed direction so a
    // reversal can't phantom-step on its own first deltas.
    if (accumulated !== 0 && Math.sign(deltaY) !== Math.sign(accumulated)) {
      accumulated = 0;
    }
    accumulated += deltaY;
    const steps = Math.trunc(accumulated / WHEEL_STEP_THRESHOLD);
    accumulated -= steps * WHEEL_STEP_THRESHOLD;
    // deltaY < 0 (wheel/pinch up) = zoom in.
    return steps === 0 ? 0 : -steps;
  };
}

/**
 * A Safari `gesture*` arm. `arm()` returns the change handler: feed it each
 * `gesturechange` event's cumulative `scale` and it returns the signed step
 * count completed since the last call (usually 0 or ±1). `reset()` (the
 * `gesturestart` handler) re-bases the arm for a new pinch — Safari's scale
 * is cumulative from gesturestart, so the consumed level must reset with it.
 */
export function createGestureArm(): { reset: () => void; change: (scale: number) => number } {
  // The scale level already consumed by emitted steps — a new pinch starts
  // at 1 (Safari resets scale at gesturestart).
  let consumed = 1;
  return {
    reset: () => {
      consumed = 1;
    },
    change: (scale: number): number => {
      let steps = 0;
      while (scale >= consumed * GESTURE_STEP_RATIO) {
        consumed *= GESTURE_STEP_RATIO;
        steps += 1;
      }
      while (scale <= consumed / GESTURE_STEP_RATIO) {
        consumed /= GESTURE_STEP_RATIO;
        steps -= 1;
      }
      return steps;
    },
  };
}
