import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isComposeStripFocused,
  registerComposeStripFocuser,
  runComposeToggleChord,
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

describe("runComposeToggleChord — the stateful compose chord (260819-qwr7 R6)", () => {
  // Module-global slots under test: the strip's live focus flag and the
  // registered textarea focuser. Both must be reset between tests.
  let unregister: (() => void) | undefined;
  afterEach(() => {
    unregister?.();
    unregister = undefined;
    setComposeStripFocused(false);
  });

  it("strip disabled → toggles on (the off→on transition marks focus-on-open)", () => {
    const toggle = vi.fn();
    const focuser = vi.fn(() => true);
    unregister = registerComposeStripFocuser(focuser);

    runComposeToggleChord(false, toggle);

    expect(toggle).toHaveBeenCalledTimes(1);
    // The off arm never consults the focuser — focus rides focus-on-open.
    expect(focuser).not.toHaveBeenCalled();
  });

  it("strip enabled + textarea unfocused + focuser accepts → focuses, no toggle", () => {
    const toggle = vi.fn();
    const focuser = vi.fn(() => true);
    unregister = registerComposeStripFocuser(focuser);

    runComposeToggleChord(true, toggle);

    expect(focuser).toHaveBeenCalledTimes(1);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("strip enabled + textarea unfocused + focuser DECLINES → falls back to the toggle (never a dead press)", () => {
    const toggle = vi.fn();
    const focuser = vi.fn(() => false); // the disabled no-target state
    unregister = registerComposeStripFocuser(focuser);

    runComposeToggleChord(true, toggle);

    expect(focuser).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("strip enabled + no focuser registered (strip unmounted) → falls back to the toggle", () => {
    const toggle = vi.fn();

    runComposeToggleChord(true, toggle);

    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("strip enabled + textarea focused → toggles off without consulting the focuser", () => {
    const toggle = vi.fn();
    const focuser = vi.fn(() => true);
    unregister = registerComposeStripFocuser(focuser);
    setComposeStripFocused(true); // the textarea owns focus

    runComposeToggleChord(true, toggle);

    expect(toggle).toHaveBeenCalledTimes(1);
    expect(focuser).not.toHaveBeenCalled();
  });
});
