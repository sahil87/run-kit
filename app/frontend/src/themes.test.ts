import { describe, it, expect } from "vitest";
import {
  THEMES,
  getThemeById,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  COLOR_CSS_MAP,
} from "./themes";
import type { Theme } from "./themes";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

describe("themes", () => {
  it("exports exactly 20 themes", () => {
    expect(THEMES).toHaveLength(20);
  });

  it("has 14 dark themes and 6 light themes", () => {
    const dark = THEMES.filter((t) => t.category === "dark");
    const light = THEMES.filter((t) => t.category === "light");
    expect(dark).toHaveLength(14);
    expect(light).toHaveLength(6);
  });

  it("every theme has unique id", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every theme has valid 8 hex color strings and a valid themeColor", () => {
    for (const theme of THEMES) {
      const colorKeys = Object.keys(COLOR_CSS_MAP) as (keyof Theme["colors"])[];
      expect(Object.keys(theme.colors)).toHaveLength(8);
      for (const key of colorKeys) {
        expect(theme.colors[key]).toMatch(HEX_RE);
      }
      expect(theme.themeColor).toMatch(HEX_RE);
    }
  });

  it("every theme has a non-empty name", () => {
    for (const theme of THEMES) {
      expect(theme.name.length).toBeGreaterThan(0);
    }
  });

  describe("Default Dark theme", () => {
    it("matches globals.css dark values", () => {
      const t = DEFAULT_DARK_THEME;
      expect(t.id).toBe("default-dark");
      expect(t.colors.bgPrimary).toBe("#0f1117");
      expect(t.colors.bgCard).toBe("#171b24");
      expect(t.colors.bgInset).toBe("#0a0c12");
      expect(t.colors.textPrimary).toBe("#e8eaf0");
      expect(t.colors.textSecondary).toBe("#7a8394");
      expect(t.colors.border).toBe("#454d66");
      expect(t.colors.accent).toBe("#5b8af0");
      expect(t.colors.accentGreen).toBe("#22c55e");
    });
  });

  describe("Default Light theme", () => {
    it("matches globals.css light values", () => {
      const t = DEFAULT_LIGHT_THEME;
      expect(t.id).toBe("default-light");
      expect(t.colors.bgPrimary).toBe("#f8f9fb");
      expect(t.colors.bgCard).toBe("#ffffff");
      expect(t.colors.bgInset).toBe("#e8eaef");
      expect(t.colors.textPrimary).toBe("#1a1d24");
      expect(t.colors.textSecondary).toBe("#6b7280");
      expect(t.colors.border).toBe("#d1d5db");
      expect(t.colors.accent).toBe("#4a7ae8");
      expect(t.colors.accentGreen).toBe("#16a34a");
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
