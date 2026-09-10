/**
 * X11 keysyms for the gui key bar (spec gui.md § The tile). noVNC 1.7.0's
 * `exports` field exposes only the package root, so its KeyTable/keysyms
 * modules are unimportable — the handful the key bar needs is declared here.
 * Character mapping rule: a printable character's keysym is its Latin-1 code
 * point when it has one, else `0x01000000 | codePoint` (the X11 unicode
 * fallback range).
 */

export const KEYSYM_ESCAPE = 0xff1b;
export const KEYSYM_TAB = 0xff09;
export const KEYSYM_RETURN = 0xff0d;
export const KEYSYM_BACKSPACE = 0xff08;
export const KEYSYM_LEFT = 0xff51;
export const KEYSYM_UP = 0xff52;
export const KEYSYM_RIGHT = 0xff53;
export const KEYSYM_DOWN = 0xff54;
export const KEYSYM_SHIFT_L = 0xffe1;
export const KEYSYM_CONTROL_L = 0xffe3;
export const KEYSYM_ALT_L = 0xffe9;

const UNICODE_KEYSYM_PREFIX = 0x01000000;
const LATIN1_MAX = 0xff;

export function keysymForChar(ch: string): number {
  const codePoint = ch.codePointAt(0) ?? 0;
  return codePoint <= LATIN1_MAX
    ? codePoint
    : UNICODE_KEYSYM_PREFIX | codePoint;
}
