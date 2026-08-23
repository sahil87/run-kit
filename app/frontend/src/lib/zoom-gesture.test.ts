import { describe, it, expect } from "vitest";
import {
  GESTURE_STEP_RATIO,
  WHEEL_STEP_THRESHOLD,
  createGestureArm,
  createWheelAccumulator,
} from "./zoom-gesture";

describe("createWheelAccumulator (R6)", () => {
  it("emits one step when the accumulated |deltaY| crosses the threshold", () => {
    const feed = createWheelAccumulator();
    expect(feed(-WHEEL_STEP_THRESHOLD + 1)).toBe(0);
    expect(feed(-1)).toBe(1); // crossed — wheel-up zooms in
  });

  it("wheel-down (positive deltaY) zooms out", () => {
    const feed = createWheelAccumulator();
    expect(feed(WHEEL_STEP_THRESHOLD)).toBe(-1);
  });

  it("a rapid pinch emitting 2× the threshold emits exactly two steps", () => {
    const feed = createWheelAccumulator();
    let total = 0;
    // Many small deltas summing to just over two thresholds.
    for (let i = 0; i < 5; i++) total += feed(-Math.ceil((2 * WHEEL_STEP_THRESHOLD + 4) / 5));
    expect(total).toBe(2);
  });

  it("carries the remainder across feeds", () => {
    const feed = createWheelAccumulator();
    expect(feed(-WHEEL_STEP_THRESHOLD - 10)).toBe(1); // 10 carries
    expect(feed(-30)).toBe(0); // 40 accumulated — below the threshold
    expect(feed(-10)).toBe(1); // 50 → one more step
  });

  it("resets on direction flip — no phantom step from the reversed leftover", () => {
    const feed = createWheelAccumulator();
    expect(feed(-WHEEL_STEP_THRESHOLD + 1)).toBe(0); // 49 zoom-in accumulated
    expect(feed(1)).toBe(0); // flip: leftover dropped, 1 accumulated
    expect(feed(WHEEL_STEP_THRESHOLD - 1)).toBe(-1); // 50 → one zoom-out step
  });

  it("a single small tick never steps", () => {
    const feed = createWheelAccumulator();
    expect(feed(-5)).toBe(0);
    expect(feed(5)).toBe(0);
  });
});

describe("createGestureArm (R6 — Safari pinch)", () => {
  it("emits one step per GESTURE_STEP_RATIO of cumulative scale", () => {
    const arm = createGestureArm();
    arm.reset();
    expect(arm.change(GESTURE_STEP_RATIO - 0.01)).toBe(0);
    expect(arm.change(GESTURE_STEP_RATIO)).toBe(1);
    expect(arm.change(GESTURE_STEP_RATIO * GESTURE_STEP_RATIO)).toBe(1);
  });

  it("pinch-in (scale < 1) emits negative steps", () => {
    const arm = createGestureArm();
    arm.reset();
    expect(arm.change(1 / GESTURE_STEP_RATIO)).toBe(-1);
  });

  it("reset re-bases the arm for a new pinch", () => {
    const arm = createGestureArm();
    arm.reset();
    expect(arm.change(GESTURE_STEP_RATIO)).toBe(1);
    // New gesture: Safari's scale restarts at 1, so the consumed level must too.
    arm.reset();
    expect(arm.change(GESTURE_STEP_RATIO)).toBe(1);
  });
});
