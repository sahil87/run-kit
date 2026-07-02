import { describe, it, expect } from "vitest";
import { classToColor, palette256 } from "./ansi-text";
import type { ThemePalette } from "@/themes";

// A synthetic palette with recognizable per-index values, so a mapping bug
// (off-by-one, normal/bright swap) shows up as the wrong sentinel color rather
// than a plausible-looking real one.
const PALETTE: ThemePalette = {
  foreground: "#fgfgfg",
  background: "#bgbgbg",
  cursorColor: "#000000",
  cursorText: "#000000",
  selectionBackground: "#000000",
  selectionForeground: "#000000",
  ansi: [
    "#a00000", // 0 black
    "#a00001", // 1 red
    "#a00002", // 2 green
    "#a00003", // 3 yellow
    "#a00004", // 4 blue
    "#a00005", // 5 magenta
    "#a00006", // 6 cyan
    "#a00007", // 7 white
    "#b00008", // 8 bright black
    "#b00009", // 9 bright red
    "#b0000a", // 10 bright green
    "#b0000b", // 11 bright yellow
    "#b0000c", // 12 bright blue
    "#b0000d", // 13 bright magenta
    "#b0000e", // 14 bright cyan
    "#b0000f", // 15 bright white
  ],
};

describe("classToColor", () => {
  it("maps the 8 normal colors to ansi[0-7]", () => {
    expect(classToColor("ansi-red", null, PALETTE)).toBe("#a00001");
    expect(classToColor("ansi-blue", null, PALETTE)).toBe("#a00004");
    expect(classToColor("ansi-white", null, PALETTE)).toBe("#a00007");
  });

  it("maps the 8 bright colors to ansi[8-15]", () => {
    expect(classToColor("ansi-bright-black", null, PALETTE)).toBe("#b00008");
    expect(classToColor("ansi-bright-red", null, PALETTE)).toBe("#b00009");
    expect(classToColor("ansi-bright-white", null, PALETTE)).toBe("#b0000f");
  });

  it("maps 256-palette classes via palette256", () => {
    // Index 9 folds back to the theme palette (bright red).
    expect(classToColor("ansi-palette-9", null, PALETTE)).toBe("#b00009");
    // A cube index produces a literal hex.
    expect(classToColor("ansi-palette-196", null, PALETTE)).toBe(
      palette256(196, PALETTE),
    );
  });

  it("maps truecolor to rgb() from the sidecar value", () => {
    expect(classToColor("ansi-truecolor", "100, 150, 200", PALETTE)).toBe(
      "rgb(100, 150, 200)",
    );
    // Malformed/absent sidecar → no color rather than a broken rgb().
    expect(classToColor("ansi-truecolor", null, PALETTE)).toBeUndefined();
  });

  it("returns undefined for no class or an unknown class", () => {
    expect(classToColor(null, null, PALETTE)).toBeUndefined();
    expect(classToColor("ansi-bogus", null, PALETTE)).toBeUndefined();
  });
});

describe("palette256", () => {
  it("folds indices 0-15 back to the theme palette", () => {
    expect(palette256(0, PALETTE)).toBe("#a00000");
    expect(palette256(1, PALETTE)).toBe("#a00001");
    expect(palette256(15, PALETTE)).toBe("#b0000f");
  });

  it("computes the 6×6×6 color cube (16-231)", () => {
    // 16 is the cube origin → pure black.
    expect(palette256(16, PALETTE)).toBe("#000000");
    // 231 is the cube max → pure white.
    expect(palette256(231, PALETTE)).toBe("#ffffff");
    // 196 = red corner (r=255, g=0, b=0): i=180 → r-step 5(255), g 0, b 0.
    expect(palette256(196, PALETTE)).toBe("#ff0000");
  });

  it("computes the grayscale ramp (232-255)", () => {
    // 232 is the darkest gray (value 8), 255 the lightest (value 238).
    expect(palette256(232, PALETTE)).toBe("#080808");
    expect(palette256(255, PALETTE)).toBe("#eeeeee");
  });
});
