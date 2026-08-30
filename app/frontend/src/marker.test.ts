import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  MARKER_CHEVRON_PITCH,
  MARKER_CHEVRON_WIDTH,
  MARKER_INK,
  MARKER_MODES,
  MARKER_STAGE_WIDTHS,
  MARKER_STAGES,
  MARKER_STAGE_GLOSS,
  MarkerChevrons,
  formatMarker,
  markerFillStyle,
  parseMarker,
  type Marker,
} from "./marker";

const ALL_PAIRS: Marker[] = MARKER_MODES.flatMap((mode) =>
  MARKER_STAGES.map((stage) => ({ mode, stage })),
);

describe("marker vocabulary", () => {
  it("covers nine mode x stage pairs", () => {
    expect(MARKER_MODES).toEqual(["manual", "auto", "blocked"]);
    expect(MARKER_STAGES).toEqual([1, 2, 3]);
    expect(ALL_PAIRS).toHaveLength(9);
  });

  it("glosses every stage", () => {
    for (const stage of MARKER_STAGES) {
      expect(MARKER_STAGE_GLOSS[stage]).toBeTruthy();
    }
  });
});

describe("formatMarker", () => {
  it("always emits the explicit mode:stage form", () => {
    expect(formatMarker({ mode: "manual", stage: 1 })).toBe("manual:1");
    expect(formatMarker({ mode: "auto", stage: 2 })).toBe("auto:2");
    expect(formatMarker({ mode: "blocked", stage: 3 })).toBe("blocked:3");
  });
});

describe("parseMarker", () => {
  it("round-trips every mode x stage pair through formatMarker", () => {
    for (const marker of ALL_PAIRS) {
      expect(parseMarker(formatMarker(marker))).toEqual(marker);
    }
  });

  it("reads a bare mode as stage 1", () => {
    for (const mode of MARKER_MODES) {
      expect(parseMarker(mode)).toEqual({ mode, stage: 1 });
    }
  });

  it("returns null for unset, malformed, and out-of-range values", () => {
    for (const value of [
      null,
      undefined,
      "",
      "  ",
      "manual:0",
      "manual:4",
      "manual:",
      "manual:1:2",
      "manual:one",
      "manual:-1",
      "solid", // a flat pre-mode:stage token is not a parseable marker
      "MANUAL",
      "auto stage",
    ]) {
      expect(parseMarker(value)).toBeNull();
    }
  });

  // The backend closed set is whitespace-intolerant and rejects a zero-padded
  // stage; this reader accepts both. The asymmetry is deliberate — a write must
  // be canonical, a read must survive whatever tmux holds — so pin it rather
  // than assume the two ends agree.
  it("is more permissive than the backend validator", () => {
    expect(parseMarker(" manual ")).toEqual({ mode: "manual", stage: 1 });
    expect(parseMarker("auto:01")).toEqual({ mode: "auto", stage: 1 });
  });

  it("never throws", () => {
    for (const value of ["::::", ":", "manual:999999999999999999999", " "]) {
      expect(() => parseMarker(value)).not.toThrow();
    }
  });

  // The value crosses an untyped JSON boundary (the window payload) before it
  // reaches here, so a non-string is reachable at runtime even though the
  // parameter type forbids it. It must read as unset, not throw.
  it("returns null for non-string runtime values instead of throwing", () => {
    for (const value of [0, 1, NaN, true, {}, [], { mode: "manual" }, ["manual", 1], () => "manual"]) {
      const read = () => parseMarker(value as unknown as string);
      expect(read).not.toThrow();
      expect(read()).toBeNull();
    }
  });
});

describe("marker rendering", () => {
  it("renders every mode x stage pair with the specified extent", () => {
    for (const marker of ALL_PAIRS) {
      const style = markerFillStyle(marker);
      if (marker.mode === "auto") {
        expect(style).toBeUndefined();
        continue;
      }

      expect(style?.width).toBe(MARKER_STAGE_WIDTHS[marker.stage]);
      if (marker.mode === "manual") {
        expect(style?.background).toBe(MARKER_INK);
      } else {
        expect(style?.backgroundImage).toContain("linear-gradient(45deg");
        expect(style?.backgroundImage).not.toContain("repeating-linear-gradient");
        expect(style?.backgroundSize).toBe("12px 12px");
        expect(style?.backgroundRepeat).toBe("repeat");
      }
    }
  });

  it("draws one chevron per stage at the shared pitch", () => {
    for (const count of MARKER_STAGES) {
      const html = renderToStaticMarkup(createElement(MarkerChevrons, { count }));
      const width = (count - 1) * MARKER_CHEVRON_PITCH + MARKER_CHEVRON_WIDTH;
      expect(html.match(/<path/g)).toHaveLength(count);
      expect(html).toContain(`width="${width}"`);
      expect(html).toContain(`stroke="${MARKER_INK}"`);
    }
  });
});
