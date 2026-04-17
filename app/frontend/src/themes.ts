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
  source: string;
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

export function blendHex(fg: string, bg: string, ratio: number): string {
  const fgRgb = hexToRgb(fg);
  const bgRgb = hexToRgb(bg);
  return rgbToHex({
    r: fgRgb.r * ratio + bgRgb.r * (1 - ratio),
    g: fgRgb.g * ratio + bgRgb.g * (1 - ratio),
    b: fgRgb.b * ratio + bgRgb.b * (1 - ratio),
  });
}

function rgbToHsl(rgb: RGB): { h: number; s: number; l: number } {
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb(hsl: { h: number; s: number; l: number }): RGB {
  const { h, s, l } = hsl;
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hh = h / 360;
  return {
    r: hue2rgb(p, q, hh + 1 / 3) * 255,
    g: hue2rgb(p, q, hh) * 255,
    b: hue2rgb(p, q, hh - 1 / 3) * 255,
  };
}

/** Multiply the HSL saturation of a hex color by a factor, clamped to [0, 1]. */
export function saturateHex(hex: string, factor: number): string {
  const hsl = rgbToHsl(hexToRgb(hex));
  hsl.s = Math.max(0, Math.min(1, hsl.s * factor));
  return rgbToHex(hslToRgb(hsl));
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
    textSecondary: blendHex(palette.foreground, palette.ansi[8], 0.3),
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

// ── Row tint computation ────────────────────────────────────────────────────

/** ANSI palette indices available in the color picker.
 *  6 colors: the standard hues (red, green, yellow, blue, magenta, cyan).
 *  Excludes 0 (black), 7 (white), 8 (gray — reused internally for uncolored
 *  selected rows), 15 (bright white), and all bright variants (9-14) which
 *  are near-identical to normal at low blend ratios. */
export const PICKER_ANSI_INDICES = [1, 2, 3, 4, 5, 6] as const;

/** ANSI index used to render uncolored rows in the selected state. */
export const UNCOLORED_SELECTED_ANSI = 8;

/** Pre-blended row tint colors for a single ANSI index at three states. */
export type RowTint = {
  base: string;     // 14% saturated-ANSI into background
  hover: string;    // 22% saturated-ANSI into background
  selected: string; // 32% saturated-ANSI into background
};

/**
 * Pre-compute blended hex values for all picker ANSI indices.
 * The ANSI hue is saturated (×1.5) before blending so row tints read as their
 * intended color rather than grayish, while blend ratios stay muted.
 * Gray (ANSI 8) is not saturated (near-zero saturation by definition) and uses
 * a 0.5 selected ratio so uncolored selected rows beat the bg-card/50 hover.
 */
export function computeRowTints(palette: ThemePalette): Map<number, RowTint> {
  const bg = palette.background;
  const tints = new Map<number, RowTint>();

  const indices = [...PICKER_ANSI_INDICES, UNCOLORED_SELECTED_ANSI];
  for (const idx of indices) {
    const fg = idx === UNCOLORED_SELECTED_ANSI
      ? palette.ansi[idx]
      : saturateHex(palette.ansi[idx], 1.5);
    const selectedRatio = idx === UNCOLORED_SELECTED_ANSI ? 0.5 : 0.32;
    tints.set(idx, {
      base: blendHex(fg, bg, 0.14),
      hover: blendHex(fg, bg, 0.22),
      selected: blendHex(fg, bg, selectedRatio),
    });
  }

  return tints;
}

// ── Theme data (loaded from configs/themes.json) ─────────────────────────────

export const THEMES: Theme[] = (themeDefs as unknown as Theme[]);

// ── Lookup helpers ───────────────────────────────────────────────────────────

export function getThemeById(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

export const DEFAULT_DARK_THEME: Theme = THEMES.find((t) => t.id === "default-dark")!;
export const DEFAULT_LIGHT_THEME: Theme = THEMES.find((t) => t.id === "default-light")!;
