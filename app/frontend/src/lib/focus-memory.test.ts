import { beforeEach, describe, expect, it } from "vitest";
import {
  armGuard,
  disarmGuard,
  focusMemoryKey,
  isGuardArmed,
  recallFocus,
  recordFocus,
  resetFocusMemory,
} from "./focus-memory";

describe("focus-memory", () => {
  beforeEach(() => {
    resetFocusMemory();
  });

  it("recalls undefined for a key that was never recorded (callers default to tty)", () => {
    expect(recallFocus("s:@1")).toBeUndefined();
  });

  it("round-trips a recorded kind", () => {
    recordFocus("s:@1", "compose");
    expect(recallFocus("s:@1")).toBe("compose");
  });

  it("overwrites a previous recording for the same key", () => {
    recordFocus("s:@1", "tty");
    recordFocus("s:@1", "code");
    expect(recallFocus("s:@1")).toBe("code");
  });

  it("keeps keys isolated per window", () => {
    recordFocus("s:@1", "compose");
    expect(recallFocus("s:@2")).toBeUndefined();
    expect(recallFocus("other:@1")).toBeUndefined();
  });

  it("composes keys as `${server}:${windowId}`", () => {
    expect(focusMemoryKey("s", "@1")).toBe("s:@1");
  });

  it("tracks the guard arm/disarm lifecycle per key", () => {
    expect(isGuardArmed("s:@1")).toBe(false);
    armGuard("s:@1");
    expect(isGuardArmed("s:@1")).toBe(true);
    expect(isGuardArmed("s:@2")).toBe(false);
    disarmGuard("s:@1");
    expect(isGuardArmed("s:@1")).toBe(false);
  });

  it("treats re-arming and double-disarm as no-ops", () => {
    armGuard("s:@1");
    armGuard("s:@1");
    expect(isGuardArmed("s:@1")).toBe(true);
    disarmGuard("s:@1");
    disarmGuard("s:@1");
    expect(isGuardArmed("s:@1")).toBe(false);
  });

  it("resetFocusMemory clears both the memory map and the guard set", () => {
    recordFocus("s:@1", "code");
    armGuard("s:@1");
    resetFocusMemory();
    expect(recallFocus("s:@1")).toBeUndefined();
    expect(isGuardArmed("s:@1")).toBe(false);
  });
});
