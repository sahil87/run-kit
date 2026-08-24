import { describe, it, expect, vi } from "vitest";
import { resolveZenToggle } from "./zen-mode";

/**
 * `resolveZenToggle` (260820-o8cr R4/R6) — the zen-mode state machine behind
 * AppShell's `toggleZen` (the chord, the palette entries, and the status-bar
 * exit button all resolve it). Pure-function tests in the
 * `palette/view.test.ts` precedent.
 */

const OFF = { zenActive: false, zenZoomed: false, layoutZoomed: false };

describe("resolveZenToggle — enter (R4/R6)", () => {
  it("activates zen at arity 1 with NO zoom attempt (the chrome hide still applies)", () => {
    expect(resolveZenToggle(OFF, 1)).toEqual({
      zenActive: true,
      zenZoomed: false,
      fireZoomToggle: false,
    });
  });

  it("activates zen AND zooms the focused tile at arity > 1 with no zoom in effect", () => {
    expect(resolveZenToggle(OFF, 2)).toEqual({
      zenActive: true,
      zenZoomed: true,
      fireZoomToggle: true,
    });
  });

  it("does NOT zoom on enter when the user already zoomed — the pre-existing zoom is not claimed as zen-initiated", () => {
    expect(resolveZenToggle({ ...OFF, layoutZoomed: true }, 2)).toEqual({
      zenActive: true,
      zenZoomed: false,
      fireZoomToggle: false,
    });
  });
});

describe("resolveZenToggle — exit (R4)", () => {
  it("deactivates zen and undoes a zen-initiated zoom that is still in effect", () => {
    expect(resolveZenToggle({ zenActive: true, zenZoomed: true, layoutZoomed: true }, 2)).toEqual({
      zenActive: false,
      zenZoomed: false,
      fireZoomToggle: true,
    });
  });

  it("a user zoom made BEFORE entering zen survives exit (no unzoom)", () => {
    expect(resolveZenToggle({ zenActive: true, zenZoomed: false, layoutZoomed: true }, 2)).toEqual({
      zenActive: false,
      zenZoomed: false,
      fireZoomToggle: false,
    });
  });

  it("a manual unzoom while in zen is not toggled back INTO a zoom on exit", () => {
    expect(resolveZenToggle({ zenActive: true, zenZoomed: true, layoutZoomed: false }, 2)).toEqual({
      zenActive: false,
      zenZoomed: false,
      fireZoomToggle: false,
    });
  });

  it("exits cleanly at arity 1 (no zoom was ever attempted)", () => {
    expect(resolveZenToggle({ zenActive: true, zenZoomed: false, layoutZoomed: false }, 1)).toEqual({
      zenActive: false,
      zenZoomed: false,
      fireZoomToggle: false,
    });
  });

  it("a tile added while in zen causes no retroactive zoom (arity only matters on enter)", () => {
    // Entered at arity 1 (zenZoomed false, no zoom), layout now 2 tiles —
    // exit simply deactivates.
    expect(resolveZenToggle({ zenActive: true, zenZoomed: false, layoutZoomed: false }, 2)).toEqual({
      zenActive: false,
      zenZoomed: false,
      fireZoomToggle: false,
    });
  });
});

describe("round-trip", () => {
  it("enter → exit at arity > 1 returns to the exact pre-zen state", () => {
    const entered = resolveZenToggle(OFF, 2);
    const exited = resolveZenToggle(
      { zenActive: entered.zenActive, zenZoomed: entered.zenZoomed, layoutZoomed: entered.fireZoomToggle },
      2,
    );
    expect(exited.zenActive).toBe(false);
    expect(exited.fireZoomToggle).toBe(true); // undoes the zoom it made
  });
});
