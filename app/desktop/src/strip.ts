/**
 * Titlebar-strip pure logic — the hidden-titlebar foundation's shared
 * constants, the Windows/Linux overlay symbol-color derivation, the
 * version-skew fallback strip CSS, and its injection gating predicate.
 *
 * Deliberately electron-free (the `hosts.ts` / `window-open.ts` /
 * `local-daemon.ts` / `update-check.ts` precedent) so the sibling
 * `strip.test.ts` covers it under plain `node --test`. The impure glue —
 * BrowserWindow options, the `did-change-theme-color` listener, the
 * `insertCSS` call — lives in `main.ts`.
 *
 * The SPA draws the real strip (a 28px accent band above its top bar) and
 * marks `<html>` with the `rk-shell-strip` class. An OLDER SPA under the new
 * hidden-titlebar shell has no strip and therefore no drag surface, so the
 * shell injects `fallbackStripCss(...)` on every registered-host load; its
 * selectors are keyed on `html:not(.rk-shell-strip)`, so the injected rules
 * self-disable the moment the real strip mounts (CSS is live — no probing,
 * no timing race).
 */

/** Height of the page-drawn titlebar strip AND the Windows/Linux
 *  window-controls overlay — one value so native controls composite over the
 *  strip's right end exactly. */
export const STRIP_HEIGHT_PX = 28;

/** The SPA-set marker class on <html> that disables the injected fallback. */
export const STRIP_MARKER_CLASS = "rk-shell-strip";

/** Default strip/overlay color before any theme-color is observed — the
 *  shell's window backgroundColor (dark theme background). */
export const DEFAULT_STRIP_COLOR = "#0f1117";

const SYMBOL_LIGHT = "#e5e7eb";
const SYMBOL_DARK = "#111827";

/** WCAG relative luminance of a #rrggbb hex (0 for unparseable input). */
function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 0;
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Contrast-derived symbol color for the Windows/Linux window-controls
 * overlay: light glyphs over a dark strip, dark glyphs over a light one.
 * Unparseable input reads as dark (the shell's own default background).
 */
export function symbolColorFor(bgHex: string): string {
  return relativeLuminance(bgHex) > 0.5 ? SYMBOL_DARK : SYMBOL_LIGHT;
}

/**
 * Version-skew fallback: minimal CSS giving an older (strip-less) SPA a
 * draggable titlebar band under the hidden native titlebar. Keyed on
 * `html:not(.rk-shell-strip)` so a strip-drawing SPA no-ops it.
 */
export function fallbackStripCss(bgHex: string): string {
  const color = /^#([0-9a-fA-F]{6})$/.test(bgHex.trim()) ? bgHex.trim() : DEFAULT_STRIP_COLOR;
  return [
    `html:not(.${STRIP_MARKER_CLASS}) body { padding-top: ${STRIP_HEIGHT_PX}px; }`,
    `html:not(.${STRIP_MARKER_CLASS}) body::before {`,
    `  content: "";`,
    `  position: fixed;`,
    `  top: 0; left: 0; right: 0;`,
    `  height: ${STRIP_HEIGHT_PX}px;`,
    `  background: ${color};`,
    `  -webkit-app-region: drag;`,
    `  z-index: 2147483647;`,
    `}`,
  ].join("\n");
}

/**
 * Whether the fallback strip CSS should be injected into a just-loaded page:
 * only pages served from a registered host origin (the pages that carry the
 * SPA). The welcome file:// page has its own static strip; foreign or
 * unparseable URLs get nothing.
 */
export function shouldInjectFallbackStrip(
  url: string,
  origins: ReadonlySet<string>,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return origins.has(parsed.origin);
}
