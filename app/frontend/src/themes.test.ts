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
  HUE_FAMILIES,
  PICKER_COLOR_VALUES,
  MARKER_STATES,
  markerStripeStyle,
  UNCOLORED_SELECTED_KEY,
  parseColorValue,
  formatColorValue,
  colorValueToHex,
  resolveFamily,
  familyToLegacy,
  oklchToHex,
  oklchInGamut,
  oklchToHexInGamut,
  themeColorStats,
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

describe("owned hue families", () => {
  it("defines exactly 10 families in the documented order with unique names/hues", () => {
    expect(HUE_FAMILIES.map((f) => f.name)).toEqual([
      "red", "orange", "amber", "olive", "green", "teal", "blue", "purple", "magenta", "slate",
    ]);
    // The picker values are the 20 family/shade values in PAIRED order — each
    // family's normal|dark shades adjacent, so the 4-wide grid pairs them.
    expect(PICKER_COLOR_VALUES).toEqual([
      "red", "red-dark", "orange", "orange-dark", "amber", "amber-dark",
      "olive", "olive-dark", "green", "green-dark", "teal", "teal-dark",
      "blue", "blue-dark", "purple", "purple-dark", "magenta", "magenta-dark",
      "slate", "slate-dark",
    ]);
    expect(new Set(HUE_FAMILIES.map((f) => f.name)).size).toBe(10);
    // slate is the only near-neutral family.
    expect(HUE_FAMILIES.filter((f) => f.neutral).map((f) => f.name)).toEqual(["slate"]);
  });

  it("maps every legacy color value 1:1 onto its family", () => {
    const legacyMap: Record<string, string> = {
      "1": "red", "1+3": "orange", "3": "amber", "1+2": "olive", "2": "green",
      "6": "teal", "4": "blue", "1+4": "purple", "5": "magenta", "3+4": "slate",
    };
    for (const [legacy, name] of Object.entries(legacyMap)) {
      expect(resolveFamily(legacy)?.name).toBe(name);
      // The family name resolves to itself.
      expect(resolveFamily(name)?.name).toBe(name);
    }
  });

  it("familyToLegacy maps a family name to its stored legacy descriptor (the write seam)", () => {
    // Each family name → its legacy descriptor (the vocabulary the backend stores
    // and validates). This is what every color write seam funnels through.
    for (const f of HUE_FAMILIES) {
      expect(familyToLegacy(f.name)).toBe(f.legacy);
    }
    // Idempotent / passthrough: an already-legacy value or an unknown string is
    // returned unchanged, and null (Clear) stays null.
    expect(familyToLegacy("1+3")).toBe("1+3");
    expect(familyToLegacy("4")).toBe("4");
    expect(familyToLegacy("nope")).toBe("nope");
    expect(familyToLegacy(null)).toBeNull();
  });

  it("parseColorValue accepts family names AND legacy aliases; formatColorValue returns the name", () => {
    const byName = parseColorValue("orange");
    expect(byName?.family.name).toBe("orange");
    expect(formatColorValue(byName!)).toBe("orange");
    // Legacy alias resolves to the same family and canonicalizes to the name.
    const byLegacy = parseColorValue("1+3");
    expect(byLegacy?.family.name).toBe("orange");
    expect(formatColorValue(byLegacy!)).toBe("orange");
    // Whitespace and leading-zero legacy forms are tolerated.
    expect(parseColorValue(" 4 ")?.family.name).toBe("blue");
    expect(parseColorValue("01")?.family.name).toBe("red");
  });

  it("returns null for values matching no family", () => {
    for (const bad of [null, undefined, "", "x", "1+", "+3", "1+2+3", "1.5", "99", "teal-ish"]) {
      expect(parseColorValue(bad)).toBeNull();
      expect(resolveFamily(bad)).toBeNull();
    }
  });

  it("colorValueToHex resolves a family name and its legacy alias to the SAME hex", () => {
    const p = DEFAULT_DARK_THEME.palette;
    expect(colorValueToHex("orange", p)).toBe(colorValueToHex("1+3", p));
    expect(colorValueToHex("blue", p)).toBe(colorValueToHex("4", p));
    expect(colorValueToHex("slate", p)).toBe(colorValueToHex("3+4", p));
    expect(colorValueToHex("nope", p)).toBeNull();
  });

  it("colorValueToHex produces a valid in-gamut hex for every family on every theme", () => {
    for (const theme of THEMES) {
      for (const value of PICKER_COLOR_VALUES) {
        const hex = colorValueToHex(value, theme.palette)!;
        expect(hex).toMatch(HEX_RE);
      }
    }
  });

  it("slate renders at a near-neutral chroma (much lower than a chromatic family)", () => {
    const p = DEFAULT_DARK_THEME.palette;
    const slate = hexToOklab(colorValueToHex("slate", p)!);
    const blue = hexToOklab(colorValueToHex("blue", p)!);
    const slateC = Math.hypot(slate.a, slate.b);
    const blueC = Math.hypot(blue.a, blue.b);
    expect(slateC).toBeLessThan(blueC);
  });
});

describe("shade axis (normal + dark)", () => {
  it("parseColorValue/formatColorValue round-trip both shades; legacy is always normal", () => {
    const dark = parseColorValue("blue-dark");
    expect(dark?.family.name).toBe("blue");
    expect(dark?.shade).toBe("dark");
    expect(formatColorValue(dark!)).toBe("blue-dark");
    const normal = parseColorValue("blue");
    expect(normal?.shade).toBe("normal");
    expect(formatColorValue(normal!)).toBe("blue");
    // Legacy descriptors have no shade slot — they parse as the normal shade.
    const legacy = parseColorValue("1+3");
    expect(legacy?.family.name).toBe("orange");
    expect(legacy?.shade).toBe("normal");
    expect(formatColorValue(legacy!)).toBe("orange");
    // Whitespace tolerated like every other stored form.
    expect(parseColorValue(" slate-dark ")?.shade).toBe("dark");
  });

  it("resolveFamily accepts -dark names (hue identity — the shade is dropped)", () => {
    expect(resolveFamily("blue-dark")?.name).toBe("blue");
    expect(resolveFamily("slate-dark")?.name).toBe("slate");
  });

  it("rejects shade near-misses", () => {
    for (const bad of ["blue-light", "bluish-dark", "-dark", "dark", "1+3-dark"]) {
      expect(parseColorValue(bad)).toBeNull();
      expect(resolveFamily(bad)).toBeNull();
    }
  });

  it("familyToLegacy passes dark values through verbatim (no legacy form exists)", () => {
    expect(familyToLegacy("blue-dark")).toBe("blue-dark");
    expect(familyToLegacy("slate-dark")).toBe("slate-dark");
    // Normal picks keep the legacy write mapping (zero migration).
    expect(familyToLegacy("blue")).toBe("4");
  });

  it("dark shades render at mean-L − 0.14 with the family hue preserved", () => {
    const p = DEFAULT_DARK_THEME.palette;
    const stats = themeColorStats(p);
    for (const name of ["red", "teal", "purple"]) {
      const normal = hexToOklab(colorValueToHex(name, p)!);
      const dark = hexToOklab(colorValueToHex(`${name}-dark`, p)!);
      // Lightness drops by ≈ 0.14 from the theme mean (8-bit rounding + any
      // gamut chroma-reduction keep L itself exact, so a tight tolerance).
      expect(dark.L).toBeCloseTo(stats.L - 0.14, 1);
      expect(dark.L).toBeLessThan(normal.L);
      // Hue angle preserved (chroma may reduce for gamut, hue must not move).
      const hue = (c: { a: number; b: number }) => (Math.atan2(c.b, c.a) * 180) / Math.PI;
      const diff = Math.abs(hue(dark) - hue(normal));
      expect(Math.min(diff, 360 - diff)).toBeLessThan(6);
    }
  });

  it("slate-dark keeps the near-neutral chroma rule (an intentional gray ramp)", () => {
    const p = DEFAULT_DARK_THEME.palette;
    const slateDark = hexToOklab(colorValueToHex("slate-dark", p)!);
    const blueDark = hexToOklab(colorValueToHex("blue-dark", p)!);
    expect(Math.hypot(slateDark.a, slateDark.b)).toBeLessThan(Math.hypot(blueDark.a, blueDark.b));
  });

  it("dark rendering is in-gamut on every theme (chroma-reduced, never clamped)", () => {
    for (const theme of THEMES) {
      const stats = themeColorStats(theme.palette);
      for (const family of HUE_FAMILIES) {
        const hex = colorValueToHex(`${family.name}-dark`, theme.palette)!;
        expect(hex).toMatch(HEX_RE);
        // The encoded result reconstructs to (about) the intended lightness —
        // proof no sRGB channel-clamping shifted it.
        const lab = hexToOklab(hex);
        expect(Math.abs(lab.L - (stats.L - 0.14))).toBeLessThan(0.05);
      }
    }
  });
});

describe("markerStripeStyle", () => {
  const color = "#123456";

  it("covers all six states with the documented widths", () => {
    expect(markerStripeStyle("", color)).toBeUndefined();
    expect(markerStripeStyle("solid", color)).toEqual({ borderLeft: `3px solid ${color}` });
    expect(markerStripeStyle("double", color)).toEqual({ borderLeft: `6px double ${color}` });
    expect(markerStripeStyle("thick", color)).toEqual({ borderLeft: `6px solid ${color}` });
    expect(markerStripeStyle("unknown", color)).toBeUndefined();
  });

  it("dotted is a one-period fixed tile (3px 6px, repeat-y) — element-height independent", () => {
    const s = markerStripeStyle("dotted", color)!;
    // A plain linear-gradient of ONE period repeated with repeat-y: the tile
    // height is fixed (6px), so the rhythm holds at ANY element height (the
    // 18px picker preview cells included) — not just the 24/36px rows the old
    // `3px 100%` + no-repeat form happened to weld on.
    expect(s.backgroundImage).toBe(`linear-gradient(to bottom, ${color} 0 3px, transparent 3px 6px)`);
    expect(s.backgroundSize).toBe("3px 6px");
    expect(s.backgroundRepeat).toBe("repeat-y");
  });

  it("dashed is a one-period fixed tile (8px dash / 4px gap, 12px period)", () => {
    const s = markerStripeStyle("dashed", color)!;
    expect(s.backgroundImage).toBe(`linear-gradient(to bottom, ${color} 0 8px, transparent 8px 12px)`);
    expect(s.backgroundSize).toBe("3px 12px");
    expect(s.backgroundRepeat).toBe("repeat-y");
  });

  it("MARKER_STATES is the closed set in display order (empty first)", () => {
    expect(MARKER_STATES).toEqual(["", "dotted", "dashed", "solid", "double", "thick"]);
  });
});

describe("OKLCH helpers", () => {
  it("oklchToHex round-trips a mid hue/chroma through OKLab back to a close OKLCH", () => {
    const hex = oklchToHex(0.6, 0.1, 55); // orange-ish
    expect(hex).toMatch(HEX_RE);
    const lab = hexToOklab(hex);
    // Reconstructed hue angle ≈ 55° (within 8-bit rounding tolerance).
    const hueDeg = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
    expect(Math.abs(hueDeg - 55)).toBeLessThan(3);
  });

  it("oklchInGamut flags an obviously out-of-gamut high-chroma triple", () => {
    // A very high chroma at mid lightness cannot fit in sRGB.
    expect(oklchInGamut(0.6, 0.5, 25)).toBe(false);
    // A modest chroma easily fits.
    expect(oklchInGamut(0.6, 0.05, 25)).toBe(true);
  });

  it("oklchToHexInGamut reduces chroma (never hue) until in gamut", () => {
    const L = 0.6, hue = 25, tooMuch = 0.5;
    expect(oklchInGamut(L, tooMuch, hue)).toBe(false);
    const hex = oklchToHexInGamut(L, tooMuch, hue);
    expect(hex).toMatch(HEX_RE);
    // The result's hue angle stays ≈ 25° — chroma moved, hue did not.
    const lab = hexToOklab(hex);
    const hueDeg = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
    expect(Math.abs(hueDeg - 25)).toBeLessThan(5);
  });

  it("themeColorStats averages L/C over ansi[1..6] and floors chroma at 0.05", () => {
    const stats = themeColorStats(DEFAULT_DARK_THEME.palette);
    expect(stats.L).toBeGreaterThan(0);
    expect(stats.L).toBeLessThan(1);
    expect(stats.C).toBeGreaterThanOrEqual(0.05);
    // A synthetic near-monochrome palette hits the floor.
    const mono: typeof DEFAULT_DARK_THEME.palette = {
      ...DEFAULT_DARK_THEME.palette,
      ansi: Array(16).fill("#808080") as unknown as typeof DEFAULT_DARK_THEME.palette.ansi,
    };
    expect(themeColorStats(mono).C).toBe(0.05);
  });
});

describe("computeRowTints", () => {
  it("returns an entry for every family/shade value plus the uncolored sentinel", () => {
    const tints = computeRowTints(DEFAULT_DARK_THEME.palette);
    // Each of the 10 families' NORMAL shade is keyed under BOTH its family name
    // AND its legacy descriptor (20 keys); each DARK shade under its
    // `{family}-dark` value only (10 keys — no legacy form exists); plus the 1
    // uncolored-selected sentinel = 31 entries.
    expect(tints.size).toBe(HUE_FAMILIES.length * 3 + 1);
    for (const value of PICKER_COLOR_VALUES) {
      expect(tints.has(value)).toBe(true);
    }
    expect(tints.has(UNCOLORED_SELECTED_KEY)).toBe(true);
  });

  it("dark tints derive from the dark source hex through the same pipeline (distinct from normal)", () => {
    const p = DEFAULT_DARK_THEME.palette;
    const tints = computeRowTints(p);
    const fg = saturateHex(colorValueToHex("blue-dark", p)!, 1.5);
    expect(tints.get("blue-dark")!.base).toBe(blendHex(fg, p.background, 0.14));
    expect(tints.get("blue-dark")!.selected).toBe(blendHex(fg, p.background, 0.4));
    // The dark entry is its own tint, not an alias of the normal one.
    expect(tints.get("blue-dark")).not.toBe(tints.get("blue"));
    expect(tints.get("blue-dark")!.base).not.toBe(tints.get("blue")!.base);
  });

  it("keys tints under BOTH the family name AND its legacy descriptor (same entry)", () => {
    const tints = computeRowTints(DEFAULT_DARK_THEME.palette);
    // Consumers look up the RAW stored value, and the backend still emits legacy
    // forms ("1+3"/"4"), so both vocabularies MUST be keys pointing at the same
    // tint — a family-name-only map would leave every pre-existing colored row
    // untinted (the must-fix-2 regression).
    expect(tints.has("orange")).toBe(true);
    expect(tints.has("1+3")).toBe(true); // orange's legacy descriptor
    expect(tints.has("4")).toBe(true); // blue's legacy descriptor
    expect(tints.get("1+3")).toBe(tints.get("orange"));
    expect(tints.get("4")).toBe(tints.get("blue"));
  });

  it("no-regression: a family tint matches the documented saturate→blend pipeline (selected=0.40)", () => {
    const p = DEFAULT_DARK_THEME.palette;
    const tints = computeRowTints(p);
    const SATURATE = 1.5;
    const RATIOS = { base: 0.14, hover: 0.22, selected: 0.4 } as const;
    for (const value of PICKER_COLOR_VALUES) {
      const fg = saturateHex(colorValueToHex(value, p)!, SATURATE);
      const tint = tints.get(value)!;
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
    const tint = tints.get("blue")!;
    expect(tint.base).not.toBe(tint.hover);
    expect(tint.selected).not.toBe(tint.base);
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
  it("returns a contrast-adjusted border per family/shade under every stored vocabulary + sentinel", () => {
    const borders = computeRowBorders(DEFAULT_DARK_THEME.palette, DEFAULT_DARK_THEME.category);
    // Each family's normal shade keyed under its name AND its legacy descriptor
    // (20 keys), each dark shade under `{family}-dark` (10 keys), + the
    // uncolored-selected sentinel — mirroring computeRowTints so consumers keyed
    // by the raw stored value hit regardless of the stored vocabulary.
    expect(borders.size).toBe(HUE_FAMILIES.length * 3 + 1);
    for (const value of PICKER_COLOR_VALUES) {
      expect(borders.has(value)).toBe(true);
    }
    for (const [, hex] of borders) {
      expect(hex).toMatch(HEX_RE);
    }
    // The two normal-shade vocabularies point at the same border; dark is its own.
    expect(borders.get("1+3")).toBe(borders.get("orange"));
    expect(borders.get("orange-dark")).not.toBe(borders.get("orange"));
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
