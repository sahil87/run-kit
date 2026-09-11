/**
 * `GUI: Send key…` (spec gui.md § The tile): chord parsing and sending for
 * keys a browser keyboard cannot express (`Ctrl+Alt+Del`, `Alt+F4`, `Super`).
 * The send is viewer-side through noVNC's `sendKey` — no server round trip —
 * so on the macOS view-only mirror the caller refuses with
 * `GUI_SEND_KEY_MIRROR_REFUSAL` instead of sending (the relay would silently
 * drop the input, leaving the user guessing).
 *
 * Chord grammar: `+`-joined tokens, case-insensitive; leading tokens are
 * modifiers (`Ctrl`/`Control`, `Alt`, `Shift`, `Super`/`Win`/`Meta`) and the
 * final token is the key — a named key (`Del`/`Delete`, `F1`–`F12`,
 * `Print`/`PrtSc`, `Esc`/`Escape`, `Tab`, `Enter`/`Return`, `Space`,
 * `Backspace`, the arrows), a single printable character (via
 * `keysymForChar`), or a modifier (a modifiers-only chord like `Super`
 * presses and releases the modifier).
 *
 * `sendKeyChord` reuses the key bar's `composeChord` ordering: modifier downs
 * in order, the key's press+release (`sendKey(keysym, code)` with `down`
 * undefined), modifier ups in reverse.
 */
import {
  KEYSYM_ALT_L,
  KEYSYM_BACKSPACE,
  KEYSYM_CONTROL_L,
  KEYSYM_DELETE,
  KEYSYM_DOWN,
  KEYSYM_ESCAPE,
  KEYSYM_F1,
  KEYSYM_LEFT,
  KEYSYM_PRINT,
  KEYSYM_RETURN,
  KEYSYM_RIGHT,
  KEYSYM_SHIFT_L,
  KEYSYM_SPACE,
  KEYSYM_SUPER_L,
  KEYSYM_TAB,
  KEYSYM_UP,
  keysymForChar,
} from "./gui-keysyms";
import type { SendKey } from "../components/gui-keybar";

/** The quick-pick row in the Send key prompt. */
export const SUGGESTED_CHORDS = ["Ctrl+Alt+Del", "Ctrl+Alt+T", "Alt+F4", "Super", "Print"] as const;

/** The backend's `gui <verb> is not supported…` template with verb `send key`. */
export const GUI_SEND_KEY_MIRROR_REFUSAL =
  "gui send key is not supported on macOS in v1 — the GUI mirrors your live session view-only";

interface ChordKey {
  keysym: number;
  code: string | null;
}

export interface KeyChord {
  modifiers: ChordKey[];
  key: ChordKey;
}

const MODIFIER_KEYS: Record<string, ChordKey> = {
  ctrl: { keysym: KEYSYM_CONTROL_L, code: "ControlLeft" },
  control: { keysym: KEYSYM_CONTROL_L, code: "ControlLeft" },
  alt: { keysym: KEYSYM_ALT_L, code: "AltLeft" },
  shift: { keysym: KEYSYM_SHIFT_L, code: "ShiftLeft" },
  super: { keysym: KEYSYM_SUPER_L, code: "SuperLeft" },
  win: { keysym: KEYSYM_SUPER_L, code: "SuperLeft" },
  meta: { keysym: KEYSYM_SUPER_L, code: "SuperLeft" },
};

const NAMED_KEYS: Record<string, ChordKey> = {
  del: { keysym: KEYSYM_DELETE, code: "Delete" },
  delete: { keysym: KEYSYM_DELETE, code: "Delete" },
  print: { keysym: KEYSYM_PRINT, code: "PrintScreen" },
  prtsc: { keysym: KEYSYM_PRINT, code: "PrintScreen" },
  esc: { keysym: KEYSYM_ESCAPE, code: "Escape" },
  escape: { keysym: KEYSYM_ESCAPE, code: "Escape" },
  tab: { keysym: KEYSYM_TAB, code: "Tab" },
  enter: { keysym: KEYSYM_RETURN, code: "Enter" },
  return: { keysym: KEYSYM_RETURN, code: "Enter" },
  space: { keysym: KEYSYM_SPACE, code: "Space" },
  backspace: { keysym: KEYSYM_BACKSPACE, code: "Backspace" },
  left: { keysym: KEYSYM_LEFT, code: "ArrowLeft" },
  up: { keysym: KEYSYM_UP, code: "ArrowUp" },
  right: { keysym: KEYSYM_RIGHT, code: "ArrowRight" },
  down: { keysym: KEYSYM_DOWN, code: "ArrowDown" },
  arrowleft: { keysym: KEYSYM_LEFT, code: "ArrowLeft" },
  arrowup: { keysym: KEYSYM_UP, code: "ArrowUp" },
  arrowright: { keysym: KEYSYM_RIGHT, code: "ArrowRight" },
  arrowdown: { keysym: KEYSYM_DOWN, code: "ArrowDown" },
};

function keyForToken(token: string): ChordKey | null {
  const named = NAMED_KEYS[token];
  if (named) return named;
  const fn = /^f([1-9]|1[0-2])$/.exec(token);
  if (fn) {
    const n = Number(fn[1]);
    return { keysym: KEYSYM_F1 + (n - 1), code: `F${n}` };
  }
  // A single printable character: the keysym is its code point (or the X11
  // unicode fallback); noVNC needs no DOM code for plain characters (the key
  // bar's hidden-input path passes null the same way).
  if ([...token].length === 1 && token !== "+") {
    return { keysym: keysymForChar(token), code: null };
  }
  return null;
}

/**
 * Parse a `+`-joined chord. Returns null on an empty input, a trailing or
 * doubled `+`, an unknown token, or a non-modifier before the final key. A
 * final modifier token yields a modifiers-only chord (the modifier is the
 * pressed-and-released key).
 */
export function parseKeyChord(text: string): KeyChord | null {
  const tokens = text.split("+").map((t) => t.trim().toLowerCase());
  if (tokens.some((t) => t === "")) return null;
  const keyToken = tokens[tokens.length - 1];
  // A modifier as the final token is a modifiers-only chord (Super alone).
  const key = MODIFIER_KEYS[keyToken] ?? keyForToken(keyToken);
  if (!key) return null;
  const modifiers: ChordKey[] = [];
  for (const token of tokens.slice(0, -1)) {
    const mod = MODIFIER_KEYS[token];
    if (!mod) return null;
    modifiers.push(mod);
  }
  return { modifiers, key };
}

/** Modifier downs in order, the key's press+release, modifier ups in reverse. */
export function sendKeyChord(sendKey: SendKey, chord: KeyChord): void {
  for (const m of chord.modifiers) sendKey(m.keysym, m.code, true);
  sendKey(chord.key.keysym, chord.key.code);
  for (const m of [...chord.modifiers].reverse()) sendKey(m.keysym, m.code, false);
}
