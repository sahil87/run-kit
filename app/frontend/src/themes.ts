import themeDefs from "@configs/themes.json";

// ── Types ────────────────────────────────────────────────────────────────────

export type ThemePalette = {
  foreground: string;
  background: string;
  cursorColor: string;
  cursorText: string;
  selectionBackground: string;
  selectionForeground: string;
  /** ANSI 0-15: black, red, green, yellow, blue, magenta, cyan, white,
   *  brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite */
  ansi: readonly [
    string, string, string, string, string, string, string, string,
    string, string, string, string, string, string, string, string,
  ];
};

export type UIColors = {
  bgPrimary: string;
  bgCard: string;
  bgInset: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  accent: string;
  accentGreen: string;
};

export type Theme = {
  id: string;
  name: string;
  category: "dark" | "light";
  palette: ThemePalette;
};

// ── CSS property mapping ─────────────────────────────────────────────────────

/** Maps UIColors keys to CSS custom property names. */
export const COLOR_CSS_MAP: Record<keyof UIColors, string> = {
  bgPrimary: "--color-bg-primary",
  bgCard: "--color-bg-card",
  bgInset: "--color-bg-inset",
  textPrimary: "--color-text-primary",
  textSecondary: "--color-text-secondary",
  border: "--color-border",
  accent: "--color-accent",
  accentGreen: "--color-accent-green",
};

// ── Color helpers (module-private) ───────────────────────────────────────────

type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function rgbToHex(rgb: RGB): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    "#" +
    clamp(rgb.r).toString(16).padStart(2, "0") +
    clamp(rgb.g).toString(16).padStart(2, "0") +
    clamp(rgb.b).toString(16).padStart(2, "0")
  );
}

function lightenHex(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  const factor = amount / 100;
  return rgbToHex({
    r: rgb.r + (255 - rgb.r) * factor,
    g: rgb.g + (255 - rgb.g) * factor,
    b: rgb.b + (255 - rgb.b) * factor,
  });
}

function darkenHex(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  const factor = amount / 100;
  return rgbToHex({
    r: rgb.r * (1 - factor),
    g: rgb.g * (1 - factor),
    b: rgb.b * (1 - factor),
  });
}

function blendHex(fg: string, bg: string, ratio: number): string {
  const fgRgb = hexToRgb(fg);
  const bgRgb = hexToRgb(bg);
  return rgbToHex({
    r: fgRgb.r * ratio + bgRgb.r * (1 - ratio),
    g: fgRgb.g * ratio + bgRgb.g * (1 - ratio),
    b: fgRgb.b * ratio + bgRgb.b * (1 - ratio),
  });
}

// ── Derivation functions ─────────────────────────────────────────────────────

/** Derive the 8 UI CSS colors from a full theme palette. */
export function deriveUIColors(palette: ThemePalette, category: "dark" | "light"): UIColors {
  const isDark = category === "dark";
  return {
    bgPrimary: palette.background,
    bgCard: isDark ? lightenHex(palette.background, 8) : darkenHex(palette.background, 3),
    bgInset: isDark ? darkenHex(palette.background, 5) : darkenHex(palette.background, 6),
    textPrimary: palette.foreground,
    textSecondary: palette.ansi[8],
    border: blendHex(palette.foreground, palette.background, 0.25),
    accent: palette.ansi[4],
    accentGreen: palette.ansi[2],
  };
}

/** Derive an xterm.js ITheme from a full theme palette. */
export function deriveXtermTheme(palette: ThemePalette) {
  return {
    background: palette.background,
    foreground: palette.foreground,
    cursor: palette.cursorColor,
    cursorAccent: palette.cursorText,
    selectionBackground: palette.selectionBackground,
    selectionForeground: palette.selectionForeground,
    black: palette.ansi[0],
    red: palette.ansi[1],
    green: palette.ansi[2],
    yellow: palette.ansi[3],
    blue: palette.ansi[4],
    magenta: palette.ansi[5],
    cyan: palette.ansi[6],
    white: palette.ansi[7],
    brightBlack: palette.ansi[8],
    brightRed: palette.ansi[9],
    brightGreen: palette.ansi[10],
    brightYellow: palette.ansi[11],
    brightBlue: palette.ansi[12],
    brightMagenta: palette.ansi[13],
    brightCyan: palette.ansi[14],
    brightWhite: palette.ansi[15],
  };
}

// ── Theme data (loaded from configs/themes.json) ─────────────────────────────

export const THEMES: Theme[] = (themeDefs as unknown as Theme[]);

// ── Lookup helpers ───────────────────────────────────────────────────────────

export function getThemeById(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

export const DEFAULT_DARK_THEME: Theme = THEMES.find((t) => t.id === "default-dark")!;
export const DEFAULT_LIGHT_THEME: Theme = THEMES.find((t) => t.id === "default-light")!;
