import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isComposeStripFocused,
  setComposeStripFocused,
  subscribeComposeStripFocus,
} from "./compose-strip-events";

describe("compose-focus module store (260814-ink6)", () => {
  afterEach(() => {
    // The flag is module-global — never let one test's focus state leak into
    // the next (a stuck `true` would hide the bottom bar in a later test).
    setComposeStripFocused(false);
  });

  it("publishes focus/blur transitions to subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeComposeStripFocus(listener);

    expect(isComposeStripFocused()).toBe(false);
    setComposeStripFocused(true);
    expect(isComposeStripFocused()).toBe(true);
    setComposeStripFocused(false);
    expect(isComposeStripFocused()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("a no-change set notifies nobody (idempotent)", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeComposeStripFocus(listener);

    setComposeStripFocused(false); // already false
    setComposeStripFocused(true);
    setComposeStripFocused(true); // already true
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("an unsubscribed listener stops receiving transitions", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeComposeStripFocus(listener);
    unsubscribe();

    setComposeStripFocused(true);
    expect(listener).not.toHaveBeenCalled();
  });
});
