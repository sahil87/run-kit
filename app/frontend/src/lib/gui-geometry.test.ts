import { describe, it, expect } from "vitest";
import {
  GUI_GEOMETRY_PRESETS,
  GEOMETRY_INPUT_ERROR,
  presetLabel,
  parseGeometryInput,
  closestAspectPreset,
} from "./gui-geometry";

describe("GUI_GEOMETRY_PRESETS", () => {
  it("is the five documented presets in display order", () => {
    expect(GUI_GEOMETRY_PRESETS).toEqual([
      "1280x720",
      "1600x900",
      "1920x1080",
      "2560x1440",
      "1080x1920",
    ]);
  });
});

describe("presetLabel", () => {
  it("renders the multiplication glyph", () => {
    expect(presetLabel("1280x720")).toBe("1280×720");
    expect(presetLabel("2560x1440")).toBe("2560×1440");
  });

  it("marks the portrait preset", () => {
    expect(presetLabel("1080x1920")).toBe("1080×1920 (portrait)");
  });
});

describe("parseGeometryInput", () => {
  it("accepts x, ×, and whitespace separators, ignoring surrounding whitespace", () => {
    for (const raw of ["1440x900", "1440×900", "1440 900", " 1440x900 "]) {
      expect(parseGeometryInput(raw)).toEqual({ w: 1440, h: 900, geometry: "1440x900" });
    }
  });

  it("accepts the boundary sizes", () => {
    expect(parseGeometryInput("320x320")).toEqual({ w: 320, h: 320, geometry: "320x320" });
    expect(parseGeometryInput("7680x7680")).toEqual({ w: 7680, h: 7680, geometry: "7680x7680" });
  });

  it("rejects out-of-range sides with the one error string", () => {
    expect(parseGeometryInput("100x100")).toBe(GEOMETRY_INPUT_ERROR);
    expect(parseGeometryInput("100x100")).toBe("Width×Height, 320–7680 per side");
    expect(parseGeometryInput("319x1080")).toBe(GEOMETRY_INPUT_ERROR);
    expect(parseGeometryInput("1920x7681")).toBe(GEOMETRY_INPUT_ERROR);
  });

  it("rejects malformed input with the same error string", () => {
    for (const raw of ["abc", "", "1440x", "x900", "1440x900x1", "-5x600", "1440.5x900"]) {
      expect(parseGeometryInput(raw)).toBe(GEOMETRY_INPUT_ERROR);
    }
  });
});

describe("closestAspectPreset", () => {
  it("picks the portrait preset for a phone-shaped tile", () => {
    expect(closestAspectPreset(375, 812)).toBe("1080x1920");
  });

  it("picks the smallest covering preset among aspect ties", () => {
    expect(closestAspectPreset(1440, 900)).toBe("1600x900");
  });

  it("returns the preset itself for an exact preset size", () => {
    expect(closestAspectPreset(1920, 1080)).toBe("1920x1080");
    expect(closestAspectPreset(1080, 1920)).toBe("1080x1920");
  });

  it("matches a 16:9 tile to a 16:9 preset, never the portrait one", () => {
    expect(closestAspectPreset(800, 450)).toBe("1280x720");
  });
});
