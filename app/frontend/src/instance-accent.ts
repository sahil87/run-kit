import {
  adjustBorderForContrast,
  blendHex,
  colorValueToHex,
  BORDER_MIN_CONTRAST,
} from "@/themes";
import type { Theme } from "@/themes";

/**
 * Instance accent ("host color") primitives — pure helpers shared by the
 * InstanceAccentProvider (contexts/instance-accent-context.tsx), the
 * theme-context meta write, and the index.html pre-paint script's echo
 * contract.
 *
 * The accent is a property of the INSTANCE (stored on its host in
 * ~/.rk/settings.yaml `instance_color`), not the viewer — every device viewing
 * the instance sees the same accent. Resolution order: explicit setting →
 * localStorage echo (paint cache only, never authoritative) → hostname hash.
 */

/** localStorage key echoing the resolved accent (paint cache only). The value
 *  is JSON `{"value": "<descriptor>", "hex": "#rrggbb"}` — `hex` is the final
 *  theme-color meta content so the index.html blocking script can tint the PWA
 *  titlebar before any fetch resolves. */
export const INSTANCE_COLOR_STORAGE_KEY = "runkit-instance-color";

/** Ratio of the accent blended into the theme background for the top-bar wash
 *  (intake latitude: ~6-7%; one trivially-tunable constant). */
export const INSTANCE_WASH_RATIO = 0.065;

/** Zero-config identity default: hash the hostname onto one of the six
 *  standard ANSI hues — legacy descriptors "1".."6" (red/green/amber/blue/
 *  magenta/teal via the owned-family mapping). FNV-1a 32-bit: tiny, stable
 *  across loads and devices (pure function of hostname). Returns null for an
 *  empty hostname (no accent rather than a misleading constant color). */
export function hashHostnameColor(hostname: string): string | null {
  if (!hostname) return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < hostname.length; i++) {
    h ^= hostname.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return String(1 + (h % 6));
}

export type InstanceColorEcho = { value: string; hex: string };

function isEcho(v: unknown): v is InstanceColorEcho {
  if (typeof v !== "object" || v === null) return false;
  if (!("value" in v) || !("hex" in v)) return false;
  return typeof v.value === "string" && typeof v.hex === "string";
}

/** Read the echoed accent, tolerating absence, malformed JSON, and a wrong
 *  shape (all → null). Paint cache only — never authoritative. */
export function readInstanceColorEcho(): InstanceColorEcho | null {
  try {
    const raw = localStorage.getItem(INSTANCE_COLOR_STORAGE_KEY);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isEcho(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Write (or clear, with null) the accent echo. */
export function writeInstanceColorEcho(echo: InstanceColorEcho | null): void {
  try {
    if (echo == null) {
      localStorage.removeItem(INSTANCE_COLOR_STORAGE_KEY);
    } else {
      localStorage.setItem(INSTANCE_COLOR_STORAGE_KEY, JSON.stringify(echo));
    }
  } catch {
    // localStorage unavailable
  }
}

/** Theme-derived hexes for the accent surfaces: `stripeHex` is the
 *  contrast-guarded family hex (top-bar stripe, HOST hostname tint, and the
 *  theme-color meta content), `washHex` the subtle top-bar background blend.
 *  Accepts family names and legacy descriptors incl. blends ("1+3") via the
 *  owned-family mapping. Null when the value maps to no owned family. */
export function deriveAccentHexes(
  value: string,
  theme: Theme,
): { stripeHex: string; washHex: string } | null {
  const src = colorValueToHex(value, theme.palette);
  if (src == null) return null;
  const bg = theme.palette.background;
  return {
    stripeHex: adjustBorderForContrast(src, bg, theme.category === "dark", BORDER_MIN_CONTRAST),
    washHex: blendHex(src, bg, INSTANCE_WASH_RATIO),
  };
}

// ── Single theme-color meta writer ───────────────────────────────────────────
// React passive effects run child-first: ThemeProvider's applyThemeToDOM effect
// fires AFTER any child accent effect on a theme switch and would clobber an
// accent-tinted meta tag with the bare background. Both writers therefore
// funnel through this module's shared state — last-write-wins over one content
// derivation (accent hex when an accent is set, else the theme background).

let currentAccentHex: string | null = null;
let lastBackground: string | null = null;

function writeMeta(): void {
  const content = currentAccentHex ?? lastBackground;
  if (content == null) return;
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.setAttribute("content", content);
}

/** Theme-side write: record the active theme background and re-apply. Called
 *  by theme-context's applyThemeToDOM on every theme application. */
export function applyThemeColorMeta(background: string): void {
  lastBackground = background;
  writeMeta();
}

/** Accent-side write: record the accent meta hex (null = no accent) and
 *  re-apply. Called by the InstanceAccentProvider on accent/theme changes. */
export function setAccentThemeColor(hex: string | null): void {
  currentAccentHex = hex;
  writeMeta();
}
