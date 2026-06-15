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
  accentBright: string;
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
  accentBright: "--color-accent-bright",
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

/** Derive the 9 UI CSS colors from a full theme palette. */
export function deriveUIColors(palette: ThemePalette, category: "dark" | "light"): UIColors {
  const isDark = category === "dark";
  const accent = palette.ansi[4];
  return {
    bgPrimary: palette.background,
    bgCard: isDark ? lightenHex(palette.background, 8) : darkenHex(palette.background, 3),
    bgInset: isDark ? darkenHex(palette.background, 5) : darkenHex(palette.background, 6),
    textPrimary: palette.foreground,
    textSecondary: blendHex(palette.foreground, palette.ansi[8], 0.3),
    border: blendHex(palette.foreground, palette.background, 0.25),
    accent,
    // "bright" = more salient than accent relative to the theme background:
    // lighter on dark, darker + more saturated on light (lighter would wash out).
    accentBright: isDark ? lightenHex(accent, 25) : saturateHex(darkenHex(accent, 12), 1.15),
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

// ── OKLab + WCAG color math (ported verbatim from scripts/audit-swatch-colors.ts) ─
// These are the design-evidence reference implementations. They are pure
// arithmetic (no trig / lookup tables) and are used by the contrast guardrail.

type OKLab = { L: number; a: number; b: number };

/** sRGB channel (0..255) → linear-light (0..1). The gamma step people skip. */
function srgbToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Convert a hex sRGB color to OKLab (Björn Ottosson, 2020). */
export function hexToOklab(hex: string): OKLab {
  const { r, g, b } = hexToRgb(hex);
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

/** Convert OKLab back to a hex sRGB color (inverse of hexToOklab). */
export function oklabToHex(c: OKLab): string {
  const l_ = c.L + 0.3963377774 * c.a + 0.2158037573 * c.b;
  const m_ = c.L - 0.1055613458 * c.a - 0.0638541728 * c.b;
  const s_ = c.L - 0.0894841775 * c.a - 1.291485548 * c.b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const enc = (channel: number) => {
    const v = channel <= 0.0031308 ? 12.92 * channel : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  };
  const h = (n: number) => enc(n).toString(16).padStart(2, "0");
  return "#" + h(lr) + h(lg) + h(lb);
}

/** WCAG 2.x relative luminance from linear-light sRGB. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG 2.x contrast ratio (1..21). */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1), l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Minimum WCAG contrast for UI components / large graphics (the 8px border). */
export const BORDER_MIN_CONTRAST = 3.0;

/** Number of OKLab lightness-nudge steps before giving up (best effort at cap). */
const CONTRAST_ADJUST_MAX_STEPS = 24;
const CONTRAST_ADJUST_STEP = 0.03;

/**
 * Return a border color that clears `min` contrast vs bg, nudging OKLab L if
 * needed. isDark ⇒ push lighter; light theme ⇒ push darker. Preserves hue and
 * chroma (only L moves) so the swatch keeps its identity. Caps at 24 steps.
 * Ported from scripts/audit-swatch-colors.ts (adjustBorderForContrast).
 */
export function adjustBorderForContrast(border: string, bg: string, isDark: boolean, min: number): string {
  if (contrastRatio(border, bg) >= min) return border;
  const lab = hexToOklab(border);
  const step = isDark ? CONTRAST_ADJUST_STEP : -CONTRAST_ADJUST_STEP;
  let L = lab.L;
  for (let i = 0; i < CONTRAST_ADJUST_MAX_STEPS; i++) {
    L = Math.max(0, Math.min(1, L + step));
    const candidate = oklabToHex({ L, a: lab.a, b: lab.b });
    if (contrastRatio(candidate, bg) >= min) return candidate;
    if (L <= 0 || L >= 1) break;
  }
  return oklabToHex({ L, a: lab.a, b: lab.b }); // best effort at the cap
}

// ── Row tint computation ────────────────────────────────────────────────────

/** ANSI palette indices available as single-hue swatches in the color picker.
 *  6 colors: the standard hues (red, green, yellow, blue, magenta, cyan).
 *  Excludes 0 (black), 7 (white), 8 (gray — reused internally for uncolored
 *  selected rows), 15 (bright white), and all bright variants (9-14) which
 *  are near-identical to normal at low blend ratios (audit-confirmed). */
export const PICKER_ANSI_INDICES = [1, 2, 3, 4, 5, 6] as const;

/** A picker color is either a single ANSI index or a 50/50 blend of two indices.
 *  `b` is undefined for a single index, present for a blend. */
export type PickerColor = { a: number; b?: number };

/** The picker palette: the 6 single hues first, then the 4 locked two-hue
 *  blends in stable display order — orange (1+3), purple (1+4), slate (3+4),
 *  olive (1+2). Locked from the audit across 70 themes (distinct on 83–96%).
 *  Brights (9–14) are rejected (collapse onto 1–6 on the majority of themes). */
export const PICKER_BLEND_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 3], // orange
  [1, 4], // purple
  [3, 4], // slate
  [1, 2], // olive
] as const;

/** Display-ordered list of every picker color value (string descriptors). */
export const PICKER_COLOR_VALUES: readonly string[] = [
  ...PICKER_ANSI_INDICES.map((i) => `${i}`),
  ...PICKER_BLEND_PAIRS.map(([a, b]) => `${a}+${b}`),
];

/** ANSI index used to render uncolored rows in the selected state. */
export const UNCOLORED_SELECTED_ANSI = 8;
/** Sentinel color-value key for the uncolored-selected gray tint. */
export const UNCOLORED_SELECTED_KEY = `${UNCOLORED_SELECTED_ANSI}`;

/** Parse a stored color value ("4" or "1+3") into a {a, b?} descriptor, or null
 *  when malformed. Tolerant of surrounding whitespace; rejects empty parts,
 *  non-numeric parts, and more than two indices. */
export function parseColorValue(value: string | null | undefined): PickerColor | null {
  if (value == null) return null;
  const parts = value.trim().split("+");
  if (parts.length < 1 || parts.length > 2) return null;
  const nums = parts.map((p) => {
    const t = p.trim();
    if (t === "" || !/^\d+$/.test(t)) return NaN;
    return Number(t);
  });
  if (nums.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 1) return { a: nums[0] };
  return { a: nums[0], b: nums[1] };
}

/** Format a {a, b?} descriptor back into its string color value ("4" / "1+3"). */
export function formatColorValue(color: PickerColor): string {
  return color.b == null ? `${color.a}` : `${color.a}+${color.b}`;
}

/** Resolve a color value's full-saturation source hex from a palette: a single
 *  index is `ansi[a]`; a blend is `blendHex(ansi[a], ansi[b], 0.5)`. Returns
 *  null when the value is malformed or an index is out of palette range. */
export function colorValueToHex(value: string, palette: ThemePalette): string | null {
  const parsed = parseColorValue(value);
  if (!parsed) return null;
  const { a, b } = parsed;
  if (a < 0 || a >= palette.ansi.length) return null;
  if (b == null) return palette.ansi[a];
  if (b < 0 || b >= palette.ansi.length) return null;
  return blendHex(palette.ansi[a], palette.ansi[b], 0.5);
}

/** Pre-blended row tint colors for a single picker color at three states. */
export type RowTint = {
  base: string;     // 14% saturated-source into background
  hover: string;    // 22% saturated-source into background
  selected: string; // 32% saturated-source into background
};

const TINT_SATURATE_FACTOR = 1.5;
const TINT_BASE_RATIO = 0.14;
const TINT_HOVER_RATIO = 0.22;
const TINT_SELECTED_RATIO = 0.32;
/** Uncolored selected rows use a deeper ratio so they beat the bg-card/50 hover. */
const UNCOLORED_SELECTED_RATIO = 0.5;

/**
 * Pre-compute blended hex values for all picker colors, keyed by string color
 * value ("4", "1+3", and the uncolored-selected sentinel "8").
 * The source hue is saturated (×1.5) before blending so row tints read as their
 * intended color rather than grayish, while blend ratios stay muted. A two-hue
 * blend's source is `blendHex(ansi[a], ansi[b], 0.5)` *before* the saturate step.
 * Gray (ANSI 8) is not saturated (near-zero saturation by definition) and uses
 * a 0.5 selected ratio so uncolored selected rows beat the bg-card/50 hover.
 */
export function computeRowTints(palette: ThemePalette): Map<string, RowTint> {
  const bg = palette.background;
  const tints = new Map<string, RowTint>();

  for (const value of PICKER_COLOR_VALUES) {
    const src = colorValueToHex(value, palette);
    if (src == null) continue;
    const fg = saturateHex(src, TINT_SATURATE_FACTOR);
    tints.set(value, {
      base: blendHex(fg, bg, TINT_BASE_RATIO),
      hover: blendHex(fg, bg, TINT_HOVER_RATIO),
      selected: blendHex(fg, bg, TINT_SELECTED_RATIO),
    });
  }

  // Uncolored-selected gray sentinel (not saturated; deeper selected ratio).
  const gray = palette.ansi[UNCOLORED_SELECTED_ANSI];
  tints.set(UNCOLORED_SELECTED_KEY, {
    base: blendHex(gray, bg, TINT_BASE_RATIO),
    hover: blendHex(gray, bg, TINT_HOVER_RATIO),
    selected: blendHex(gray, bg, UNCOLORED_SELECTED_RATIO),
  });

  return tints;
}

/**
 * Pre-compute the contrast-adjusted full-saturation left-border color for every
 * picker color value (plus the uncolored-selected sentinel), keyed by color
 * value string. Each border is the value's full-saturation source hex passed
 * through the WCAG contrast guardrail (nudge OKLab L until it clears
 * BORDER_MIN_CONTRAST vs the theme background) so the 8px window-row border
 * stays visible on every theme. Computed once per theme alongside computeRowTints.
 */
export function computeRowBorders(palette: ThemePalette, category: "dark" | "light"): Map<string, string> {
  const bg = palette.background;
  const isDark = category === "dark";
  const borders = new Map<string, string>();

  for (const value of PICKER_COLOR_VALUES) {
    const src = colorValueToHex(value, palette);
    if (src == null) continue;
    borders.set(value, adjustBorderForContrast(src, bg, isDark, BORDER_MIN_CONTRAST));
  }

  borders.set(
    UNCOLORED_SELECTED_KEY,
    adjustBorderForContrast(palette.ansi[UNCOLORED_SELECTED_ANSI], bg, isDark, BORDER_MIN_CONTRAST),
  );

  return borders;
}

// ── Theme data (loaded from configs/themes.json) ─────────────────────────────

export const THEMES: Theme[] = (themeDefs as unknown as Theme[]);

// ── Lookup helpers ───────────────────────────────────────────────────────────

export function getThemeById(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

export const DEFAULT_DARK_THEME: Theme = THEMES.find((t) => t.id === "default-dark")!;
export const DEFAULT_LIGHT_THEME: Theme = THEMES.find((t) => t.id === "default-light")!;
