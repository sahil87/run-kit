import { describe, expect, it } from "vitest";
import {
  IDLE_PROGRESS,
  PROGRESS_ERROR,
  PROGRESS_INDETERMINATE,
  PROGRESS_PAUSE,
  PROGRESS_REMOVE,
  PROGRESS_SET,
  isValuedProgress,
  reduceProgress,
  type TtyProgress,
} from "./tty-progress";

describe("reduceProgress", () => {
  it("maps state 1 to determinate at the given value", () => {
    expect(reduceProgress(IDLE_PROGRESS, PROGRESS_SET, 42)).toEqual({
      kind: "determinate",
      value: 42,
    });
  });

  it("clamps determinate values into 0–100", () => {
    expect(reduceProgress(IDLE_PROGRESS, PROGRESS_SET, 250)).toEqual({
      kind: "determinate",
      value: 100,
    });
    expect(reduceProgress(IDLE_PROGRESS, PROGRESS_SET, -5)).toEqual({
      kind: "determinate",
      value: 0,
    });
  });

  it("maps state 0 to idle from any state", () => {
    const active: TtyProgress = { kind: "determinate", value: 80 };
    expect(reduceProgress(active, PROGRESS_REMOVE, 0)).toEqual(IDLE_PROGRESS);
  });

  it("maps state 2 to error, retaining the last-known value on a zero payload", () => {
    const prev: TtyProgress = { kind: "determinate", value: 61 };
    expect(reduceProgress(prev, PROGRESS_ERROR, 0)).toEqual({
      kind: "error",
      value: 61,
    });
    expect(reduceProgress(prev, PROGRESS_ERROR, 30)).toEqual({
      kind: "error",
      value: 30,
    });
  });

  it("maps state 4 to paused, retaining the last-known value on a zero payload", () => {
    const prev: TtyProgress = { kind: "determinate", value: 33 };
    expect(reduceProgress(prev, PROGRESS_PAUSE, 0)).toEqual({
      kind: "paused",
      value: 33,
    });
    expect(reduceProgress(prev, PROGRESS_PAUSE, 90)).toEqual({
      kind: "paused",
      value: 90,
    });
  });

  it("error/pause from idle or indeterminate fall back to 0", () => {
    expect(reduceProgress(IDLE_PROGRESS, PROGRESS_ERROR, 0)).toEqual({
      kind: "error",
      value: 0,
    });
    expect(
      reduceProgress({ kind: "indeterminate" }, PROGRESS_PAUSE, 0),
    ).toEqual({ kind: "paused", value: 0 });
  });

  it("maps state 3 to indeterminate (no value carried)", () => {
    const prev: TtyProgress = { kind: "determinate", value: 50 };
    expect(reduceProgress(prev, PROGRESS_INDETERMINATE, 50)).toEqual({
      kind: "indeterminate",
    });
  });

  it("ignores unknown state codes, keeping the previous state", () => {
    const prev: TtyProgress = { kind: "determinate", value: 12 };
    expect(reduceProgress(prev, 7, 99)).toBe(prev);
    expect(reduceProgress(prev, -1, 0)).toBe(prev);
  });
});

describe("isValuedProgress", () => {
  it("is true for the chip-rendering states (determinate/error/paused)", () => {
    expect(isValuedProgress({ kind: "determinate", value: 62 })).toBe(true);
    expect(isValuedProgress({ kind: "error", value: 40 })).toBe(true);
    expect(isValuedProgress({ kind: "paused", value: 0 })).toBe(true);
  });

  it("is false for idle and indeterminate", () => {
    expect(isValuedProgress(IDLE_PROGRESS)).toBe(false);
    expect(isValuedProgress({ kind: "indeterminate" })).toBe(false);
  });
});
