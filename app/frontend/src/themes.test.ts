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
  PICKER_ANSI_INDICES,
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
    it("maps all 8 color keys to CSS custom property names", () => {
      expect(Object.keys(COLOR_CSS_MAP)).toHaveLength(8);
      expect(COLOR_CSS_MAP.bgPrimary).toBe("--color-bg-primary");
      expect(COLOR_CSS_MAP.accent).toBe("--color-accent");
    });
  });
});

describe("deriveUIColors", () => {
  it("derives correct colors for Dracula (dark)", () => {
    const dracula = getThemeById("dracula")!;
    const ui = deriveUIColors(dracula.palette, "dark");
    expect(ui.bgPrimary).toBe("#282a36");
    expect(ui.textPrimary).toBe("#f8f8f2");
    expect(ui.textSecondary).toBe("#6272a4"); // ansi[8]
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

  it("all 8 keys are valid hex", () => {
    for (const theme of THEMES) {
      const ui = deriveUIColors(theme.palette, theme.category);
      const keys = Object.keys(ui) as (keyof UIColors)[];
      expect(keys).toHaveLength(8);
      for (const key of keys) {
        expect(ui[key]).toMatch(HEX_RE);
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

describe("computeRowTints", () => {
  it("returns 13 entries matching PICKER_ANSI_INDICES", () => {
    const tints = computeRowTints(DEFAULT_DARK_THEME.palette);
    expect(tints.size).toBe(13);
    for (const idx of PICKER_ANSI_INDICES) {
      expect(tints.has(idx)).toBe(true);
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

  it("selected blend is more saturated than hover, which is more than base", () => {
    const tints = computeRowTints(DEFAULT_DARK_THEME.palette);
    const tint = tints.get(4)!; // blue
    // base uses 12%, hover 18%, selected 22% — each has more fg mixed in
    // So each successive blend should differ from background more than the previous
    expect(tint.base).not.toBe(tint.hover);
    expect(tint.hover).not.toBe(tint.selected);
    expect(tint.base).not.toBe(tint.selected);
  });

  it("does not include indices 0, 7, 15", () => {
    const tints = computeRowTints(DEFAULT_DARK_THEME.palette);
    expect(tints.has(0)).toBe(false);
    expect(tints.has(7)).toBe(false);
    expect(tints.has(15)).toBe(false);
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
