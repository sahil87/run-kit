import { describe, it, expect } from "vitest";
import {
  deriveCrumbsCollapsed,
  CRUMB_MIN_USEFUL_CH,
  CRUMB_COLLAPSE_HYSTERESIS_PX,
} from "./crumb-collapse";

const H = CRUMB_COLLAPSE_HYSTERESIS_PX;

describe("CRUMB_MIN_USEFUL_CH", () => {
  // The canonical home of the useful-width floor. The value also lives in
  // Tailwind arbitrary-value literals in top-bar.tsx (`max-w-[6ch]` on the
  // collapse probe, `min-w-[calc(6ch+0.875rem)]` on the crumb boxes), which
  // cannot import a JS constant — this pin is the tripwire keeping the
  // literals in sync with the constant.
  it("is 6 — the floor the top-bar 6ch Tailwind literals encode", () => {
    expect(CRUMB_MIN_USEFUL_CH).toBe(6);
  });
});

describe("deriveCrumbsCollapsed", () => {
  it("collapses when the available width drops below the min-useful threshold", () => {
    expect(deriveCrumbsCollapsed(99, 100, false)).toBe(true);
  });

  it("stays expanded at and above the threshold", () => {
    expect(deriveCrumbsCollapsed(100, 100, false)).toBe(false);
    expect(deriveCrumbsCollapsed(160, 100, false)).toBe(false);
  });

  it("stays collapsed inside the hysteresis band above the threshold", () => {
    // Expanded-at-100 would flip; collapsed stays collapsed until 100 + H.
    expect(deriveCrumbsCollapsed(100, 100, true)).toBe(true);
    expect(deriveCrumbsCollapsed(100 + H - 1, 100, true)).toBe(true);
  });

  it("re-expands once the available width clears threshold + hysteresis", () => {
    expect(deriveCrumbsCollapsed(100 + H, 100, true)).toBe(false);
    expect(deriveCrumbsCollapsed(100 + H + 40, 100, true)).toBe(false);
  });

  it("does not flap when the width hovers on the boundary", () => {
    // Walk the boundary back and forth: the state only ever changes once per
    // crossing direction, never per callback.
    let collapsed = deriveCrumbsCollapsed(99, 100, false);
    expect(collapsed).toBe(true);
    collapsed = deriveCrumbsCollapsed(100, 100, collapsed);
    expect(collapsed).toBe(true); // hysteresis holds
    collapsed = deriveCrumbsCollapsed(99, 100, collapsed);
    expect(collapsed).toBe(true);
    collapsed = deriveCrumbsCollapsed(100 + H, 100, collapsed);
    expect(collapsed).toBe(false); // clears the band
    collapsed = deriveCrumbsCollapsed(100, 100, collapsed);
    expect(collapsed).toBe(false); // expanded edge has no hysteresis…
    collapsed = deriveCrumbsCollapsed(99, 100, collapsed);
    expect(collapsed).toBe(true); // …collapse re-engages strictly below
  });

  it("keeps the previous state when either measurement is unavailable", () => {
    // jsdom / pre-mount / display:none probes all read 0 — the expanded
    // default must survive rather than collapsing on phantom zeros.
    expect(deriveCrumbsCollapsed(0, 100, false)).toBe(false);
    expect(deriveCrumbsCollapsed(100, 0, false)).toBe(false);
    expect(deriveCrumbsCollapsed(0, 0, false)).toBe(false);
    expect(deriveCrumbsCollapsed(0, 100, true)).toBe(true);
    expect(deriveCrumbsCollapsed(100, 0, true)).toBe(true);
  });

  it("honors an explicit hysteresis override", () => {
    expect(deriveCrumbsCollapsed(105, 100, true, 10)).toBe(true);
    expect(deriveCrumbsCollapsed(110, 100, true, 10)).toBe(false);
  });
});
