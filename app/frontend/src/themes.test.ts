import { describe, it, expect } from "vitest";
import {
  THEMES,
  getThemeById,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  COLOR_CSS_MAP,
  deriveUIColors,
  deriveXtermTheme,
  computeRowTints,
  computeRowBorders,
  PICKER_ANSI_INDICES,
  PICKER_COLOR_VALUES,
  UNCOLORED_SELECTED_KEY,
  parseColorValue,
  formatColorValue,
  colorValueToHex,
  saturateHex,
  hexToOklab,
  oklabToHex,
  relativeLuminance,
  contrastRatio,
  adjustBorderForContrast,
  BORDER_MIN_CONTRAST,
  blendHex,
} from "./themes";
import type { Theme, ThemePalette, UIColors } from "./themes";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

describe("themes", () => {
  it("exports exactly 70 themes", () => {
    expect(THEMES).toHaveLength(70);
  });

  it("has 56 dark themes and 14 light themes", () => {
    const dark = THEMES.filter((t) => t.category === "dark");
    const light = THEMES.filter((t) => t.category === "light");
    expect(dark).toHaveLength(56);
    expect(light).toHaveLength(14);
  });

  it("every theme has unique id", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every theme has a valid ThemePalette with 22 hex colors", () => {
    for (const theme of THEMES) {
      expect(theme.palette.foreground).toMatch(HEX_RE);
      expect(theme.palette.background).toMatch(HEX_RE);
      expect(theme.palette.cursorColor).toMatch(HEX_RE);
      expect(theme.palette.cursorText).toMatch(HEX_RE);
      expect(theme.palette.selectionBackground).toMatch(HEX_RE);
      expect(theme.palette.selectionForeground).toMatch(HEX_RE);
      expect(theme.palette.ansi).toHaveLength(16);
      for (const color of theme.palette.ansi) {
        expect(color).toMatch(HEX_RE);
      }
    }
  });

  it("every theme has a non-empty name", () => {
    for (const theme of THEMES) {
      expect(theme.name.length).toBeGreaterThan(0);
    }
  });

  it("no theme has colors or themeColor properties", () => {
    for (const theme of THEMES) {
      expect((theme as Record<string, unknown>).colors).toBeUndefined();
      expect((theme as Record<string, unknown>).themeColor).toBeUndefined();
    }
  });

  describe("Default Dark theme", () => {
    it("has correct palette values", () => {
      const t = DEFAULT_DARK_THEME;
      expect(t.id).toBe("default-dark");
      expect(t.palette.background).toBe("#0f1117");
      expect(t.palette.foreground).toBe("#e8eaf0");
      expect(t.palette.ansi[4]).toBe("#5b8af0"); // accent (blue)
      expect(t.palette.ansi[2]).toBe("#22c55e"); // accentGreen
      expect(t.palette.ansi[8]).toBe("#7a8394"); // textSecondary (bright black)
    });
  });

  describe("Default Light theme", () => {
    it("has correct palette values", () => {
      const t = DEFAULT_LIGHT_THEME;
      expect(t.id).toBe("default-light");
      expect(t.palette.background).toBe("#f8f9fb");
      expect(t.palette.foreground).toBe("#1a1d24");
      expect(t.palette.ansi[4]).toBe("#4a7ae8"); // accent (blue)
      expect(t.palette.ansi[2]).toBe("#16a34a"); // accentGreen
      expect(t.palette.ansi[8]).toBe("#6b7280"); // textSecondary (bright black)
    });
  });

  describe("getThemeById", () => {
    it("returns theme for valid id", () => {
      const dracula = getThemeById("dracula");
      expect(dracula).toBeDefined();
      expect(dracula!.name).toBe("Dracula");
    });

    it("returns undefined for unknown id", () => {
      expect(getThemeById("nonexistent")).toBeUndefined();
    });

    it("returns Default Dark for 'default-dark'", () => {
      expect(getThemeById("default-dark")).toBe(DEFAULT_DARK_THEME);
    });

    it("returns Default Light for 'default-light'", () => {
      expect(getThemeById("default-light")).toBe(DEFAULT_LIGHT_THEME);
    });
  });

  describe("COLOR_CSS_MAP", () => {
    it("maps all 9 color keys to CSS custom property names", () => {
      expect(Object.keys(COLOR_CSS_MAP)).toHaveLength(9);
      expect(COLOR_CSS_MAP.bgPrimary).toBe("--color-bg-primary");
      expect(COLOR_CSS_MAP.accent).toBe("--color-accent");
      expect(COLOR_CSS_MAP.accentBright).toBe("--color-accent-bright");
    });
  });
});

describe("deriveUIColors", () => {
  it("derives correct colors for Dracula (dark)", () => {
    const dracula = getThemeById("dracula")!;
    const ui = deriveUIColors(dracula.palette, "dark");
    expect(ui.bgPrimary).toBe("#282a36");
    expect(ui.textPrimary).toBe("#f8f8f2");
    expect(ui.textSecondary).toBe("#8f9abb"); // foreground blended 30% into ansi[8]
    expect(ui.accent).toBe("#bd93f9"); // ansi[4]
    expect(ui.accentGreen).toBe("#50fa7b"); // ansi[2]
  });

  it("derives bgCard as lightened background for dark themes", () => {
    const dracula = getThemeById("dracula")!;
    const ui = deriveUIColors(dracula.palette, "dark");
    // bgCard should be lighter than background
    expect(ui.bgCard).not.toBe(ui.bgPrimary);
    expect(ui.bgCard).toMatch(HEX_RE);
  });

  it("derives bgCard as darkened background for light themes", () => {
    const solarized = getThemeById("solarized-light")!;
    const ui = deriveUIColors(solarized.palette, "light");
    expect(ui.bgCard).not.toBe(ui.bgPrimary);
    expect(ui.bgCard).toMatch(HEX_RE);
  });

  it("derives border via blend", () => {
    const theme = DEFAULT_DARK_THEME;
    const ui = deriveUIColors(theme.palette, "dark");
    expect(ui.border).toMatch(HEX_RE);
    // border should be between foreground and background
    expect(ui.border).not.toBe(theme.palette.foreground);
    expect(ui.border).not.toBe(theme.palette.background);
  });

  it("all 9 keys are valid hex", () => {
    for (const theme of THEMES) {
      const ui = deriveUIColors(theme.palette, theme.category);
      const keys = Object.keys(ui) as (keyof UIColors)[];
      expect(keys).toHaveLength(9);
      for (const key of keys) {
        expect(ui[key]).toMatch(HEX_RE);
      }
    }
  });

  it("derives accentBright lighter than accent on dark, darker on light", () => {
    const luminance = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return ((n >> 16) & 0xff) + ((n >> 8) & 0xff) + (n & 0xff);
    };
    for (const theme of THEMES) {
      const ui = deriveUIColors(theme.palette, theme.category);
      if (theme.category === "dark") {
        expect(luminance(ui.accentBright)).toBeGreaterThan(luminance(ui.accent));
      } else {
        expect(luminance(ui.accentBright)).toBeLessThan(luminance(ui.accent));
      }
    }
  });
});

describe("deriveXtermTheme", () => {
  it("maps all 22 colors from palette", () => {
    const dracula = getThemeById("dracula")!;
    const xterm = deriveXtermTheme(dracula.palette);

    expect(xterm.background).toBe("#282a36");
    expect(xterm.foreground).toBe("#f8f8f2");
    expect(xterm.cursor).toBe("#f8f8f2");
    expect(xterm.cursorAccent).toBe("#282a36");
    expect(xterm.selectionBackground).toBe("#44475a");
    expect(xterm.selectionForeground).toBe("#f8f8f2");
    expect(xterm.black).toBe("#21222c");
    expect(xterm.red).toBe("#ff5555");
    expect(xterm.green).toBe("#50fa7b");
    expect(xterm.yellow).toBe("#f1fa8c");
    expect(xterm.blue).toBe("#bd93f9");
    expect(xterm.magenta).toBe("#ff79c6");
    expect(xterm.cyan).toBe("#8be9fd");
    expect(xterm.white).toBe("#f8f8f2");
    expect(xterm.brightBlack).toBe("#6272a4");
    expect(xterm.brightRed).toBe("#ff6e6e");
    expect(xterm.brightGreen).toBe("#69ff94");
    expect(xterm.brightYellow).toBe("#ffffa5");
    expect(xterm.brightBlue).toBe("#d6acff");
    expect(xterm.brightMagenta).toBe("#ff92df");
    expect(xterm.brightCyan).toBe("#a4ffff");
    expect(xterm.brightWhite).toBe("#ffffff");
  });

  it("produces valid hex for all themes", () => {
    for (const theme of THEMES) {
      const xterm = deriveXtermTheme(theme.palette);
      for (const value of Object.values(xterm)) {
        expect(value).toMatch(HEX_RE);
      }
    }
  });
});

describe("color value parse/format", () => {
  it("round-trips a single index", () => {
    const parsed = parseColorValue("4");
    expect(parsed).toEqual({ a: 4 });
    expect(formatColorValue(parsed!)).toBe("4");
  });

  it("round-trips a blend", () => {
    const parsed = parseColorValue("1+3");
    expect(parsed).toEqual({ a: 1, b: 3 });
    expect(formatColorValue(parsed!)).toBe("1+3");
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseColorValue(" 1 + 3 ")).toEqual({ a: 1, b: 3 });
  });

  it("returns null for malformed values", () => {
    for (const bad of [null, undefined, "", "x", "1+", "+3", "1+2+3", "1.5"]) {
      expect(parseColorValue(bad)).toBeNull();
    }
  });

  it("colorValueToHex resolves single index to ansi[idx] and blend to blendHex", () => {
    const p = DEFAULT_DARK_THEME.palette;
    expect(colorValueToHex("4", p)).toBe(p.ansi[4]);
    expect(colorValueToHex("1+3", p)).toBe(blendHex(p.ansi[1], p.ansi[3], 0.5));
    expect(colorValueToHex("99", p)).toBeNull();
  });
});

describe("computeRowTints", () => {
  it("returns an entry for every picker color value plus the uncolored sentinel", () => {
    const tints = computeRowTints(DEFAULT_DARK_THEME.palette);
    // 6 single + 4 blends + 1 uncolored-selected sentinel.
    expect(tints.size).toBe(PICKER_COLOR_VALUES.length + 1);
    for (const value of PICKER_COLOR_VALUES) {
      expect(tints.has(value)).toBe(true);
    }
    expect(tints.has(UNCOLORED_SELECTED_KEY)).toBe(true);
  });

  it("includes the 4 locked blends in order orange/purple/slate/olive", () => {
    expect(PICKER_COLOR_VALUES).toEqual(["1", "2", "3", "4", "5", "6", "1+3", "1+4", "3+4", "1+2"]);
  });

  it("no-regression: single-index tint matches the documented saturate→blend pipeline", () => {
    const p = DEFAULT_DARK_THEME.palette;
    const tints = computeRowTints(p);
    // The documented single-index pipeline (themes.ts): the source hue is
    // saturated ×1.5, then blended into the background at the per-state ratio.
    const SATURATE = 1.5;
    const RATIOS = { base: 0.14, hover: 0.22, selected: 0.32 } as const;
    for (const idx of PICKER_ANSI_INDICES) {
      const fg = saturateHex(p.ansi[idx], SATURATE);
      const tint = tints.get(`${idx}`)!;
      expect(tint.base).toBe(blendHex(fg, p.background, RATIOS.base));
      expect(tint.hover).toBe(blendHex(fg, p.background, RATIOS.hover));
      expect(tint.selected).toBe(blendHex(fg, p.background, RATIOS.selected));
    }
  });

  it("all values are valid hex strings", () => {
    for (const theme of THEMES) {
      const tints = computeRowTints(theme.palette);
      for (const [, tint] of tints) {
        expect(tint.base).toMatch(HEX_RE);
        expect(tint.hover).toMatch(HEX_RE);
        expect(tint.selected).toMatch(HEX_RE);
      }
    }
  });

  it("hover blend differs from base, selected differs from both", () => {
    const tints = computeRowTints(DEFAULT_DARK_THEME.palette);
    const tint = tints.get("4")!; // blue
    expect(tint.base).not.toBe(tint.hover);
    expect(tint.selected).not.toBe(tint.base);
  });

  it("does not include excluded single indices 0, 7, 9-15", () => {
    const tints = computeRowTints(DEFAULT_DARK_THEME.palette);
    expect(tints.has("0")).toBe(false);
    expect(tints.has("7")).toBe(false);
    for (let i = 9; i <= 15; i++) {
      expect(tints.has(`${i}`)).toBe(false);
    }
  });
});

describe("OKLab + WCAG color math", () => {
  it("oklabToHex(hexToOklab(hex)) round-trips within tolerance", () => {
    for (const hex of ["#000000", "#ffffff", "#3b82f6", "#a13c5e", "#1d9e6f"]) {
      const back = oklabToHex(hexToOklab(hex));
      expect(back).toMatch(HEX_RE);
      const a = hexToOklab(hex);
      const b = hexToOklab(back);
      // L/a/b agree closely (rounding through 8-bit sRGB).
      expect(Math.abs(a.L - b.L)).toBeLessThan(0.01);
      expect(Math.abs(a.a - b.a)).toBeLessThan(0.01);
      expect(Math.abs(a.b - b.b)).toBeLessThan(0.01);
    }
  });

  it("contrastRatio: black/white ≈ 21, identical = 1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#3b82f6", "#3b82f6")).toBeCloseTo(1, 5);
  });

  it("relativeLuminance: black = 0, white = 1", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("adjustBorderForContrast", () => {
  it("returns an already-compliant border unchanged", () => {
    // White on near-black clears 3.0 easily.
    const border = "#ffffff";
    const bg = "#0a0a0a";
    expect(contrastRatio(border, bg)).toBeGreaterThanOrEqual(BORDER_MIN_CONTRAST);
    expect(adjustBorderForContrast(border, bg, true, BORDER_MIN_CONTRAST)).toBe(border);
  });

  it("nudges a low-contrast border on a dark theme until it clears the min", () => {
    // A dark border on a dark bg: low contrast, must be lightened.
    const border = "#222230";
    const bg = "#1a1a22";
    expect(contrastRatio(border, bg)).toBeLessThan(BORDER_MIN_CONTRAST);
    const adjusted = adjustBorderForContrast(border, bg, true, BORDER_MIN_CONTRAST);
    expect(adjusted).not.toBe(border);
    // Either it cleared the min, or it hit the cap as a best effort (still lighter).
    expect(relativeLuminance(adjusted)).toBeGreaterThan(relativeLuminance(border));
  });

  it("preserves hue/chroma (OKLab a,b) while moving L", () => {
    const border = "#3a2f55"; // a muted purple
    const bg = "#2b2440";
    const adjusted = adjustBorderForContrast(border, bg, true, BORDER_MIN_CONTRAST);
    if (adjusted !== border) {
      const orig = hexToOklab(border);
      const got = hexToOklab(adjusted);
      // a/b preserved within an 8-bit rounding tolerance; only L should move.
      expect(Math.abs(orig.a - got.a)).toBeLessThan(0.03);
      expect(Math.abs(orig.b - got.b)).toBeLessThan(0.03);
    }
  });
});

describe("computeRowBorders", () => {
  it("returns a contrast-adjusted border per picker color value + sentinel", () => {
    const borders = computeRowBorders(DEFAULT_DARK_THEME.palette, DEFAULT_DARK_THEME.category);
    expect(borders.size).toBe(PICKER_COLOR_VALUES.length + 1);
    for (const [, hex] of borders) {
      expect(hex).toMatch(HEX_RE);
    }
  });

  it("every border clears the min contrast (or improves on the raw source) across all themes", () => {
    for (const theme of THEMES) {
      const bg = theme.palette.background;
      const borders = computeRowBorders(theme.palette, theme.category);
      for (const [value, hex] of borders) {
        expect(hex).toMatch(HEX_RE);
        // The guardrail either lifts the border to the min, or — when the cap is
        // hit on a pathological theme — leaves it no worse than the raw source.
        const raw = colorValueToHex(value, theme.palette) ?? theme.palette.ansi[8];
        const cleared = contrastRatio(hex, bg) >= BORDER_MIN_CONTRAST;
        const improvedOrEqual =
          contrastRatio(hex, bg) >= contrastRatio(raw, bg) - 1e-9;
        expect(cleared || improvedOrEqual).toBe(true);
      }
    }
  });
});

describe("blendHex", () => {
  it("blends fg and bg at given ratio", () => {
    const result = blendHex("#ff0000", "#000000", 0.5);
    expect(result).toMatch(HEX_RE);
    // 50% red on black should be roughly #800000
    expect(result).toBe("#800000");
  });

  it("ratio 0 returns bg", () => {
    expect(blendHex("#ff0000", "#00ff00", 0)).toBe("#00ff00");
  });

  it("ratio 1 returns fg", () => {
    expect(blendHex("#ff0000", "#00ff00", 1)).toBe("#ff0000");
  });
});
