/**
 * The gui tile's coarse-pointer key bar (spec docs/specs/gui.md § The tile):
 * a single-row strip docked UNDER the noVNC canvas as a flex sibling of the
 * host div (the bare-WM strip is the above-precedent; the fit subtracts its
 * height), carrying `Esc Tab Ctrl Alt ⇧ ← ↑ ↓ → ⌨` as `Control` chips.
 * Rendered by GuiSurface only on coarse pointers in the canvas state — the
 * empty/credentials states and fine pointers never see it.
 *
 * Modifier latching is a pure state machine (`latchModifier`): off → armed →
 * locked → off. Armed composes into the next non-modifier key's chord and
 * returns to off; locked composes into every chord until tapped off. A chord
 * (`composeChord`) wraps the key's press+release (`sendKey(keysym, code)`,
 * down undefined) in the latched modifiers' downs and ups (MODIFIERS order
 * down, reverse up). Every key rides the parent-supplied `sendKey`; with none
 * (no live RFB) the bar is inert without throwing (A-024) — noVNC's own
 * sendKey also no-ops unless connected and not viewOnly.
 *
 * `⌨` raises the platform on-screen keyboard through a visually-hidden input
 * (the noVNC-UI trick): printable characters forward via beforeinput/input
 * (keysym = Latin-1 code point, else the X11 unicode fallback — see
 * gui-keysyms.ts) and never accumulate in the input; Enter/Backspace/Tab/
 * Escape/arrows forward via keydown (preventDefault so Tab can't move focus).
 * Both paths compose with the latched modifiers. Tapping ⌨ again or blurring
 * releases the input.
 */
import { useRef, useState } from "react";
import { Control } from "./control";
import {
  KEYSYM_ALT_L,
  KEYSYM_BACKSPACE,
  KEYSYM_CONTROL_L,
  KEYSYM_DOWN,
  KEYSYM_ESCAPE,
  KEYSYM_LEFT,
  KEYSYM_RETURN,
  KEYSYM_RIGHT,
  KEYSYM_SHIFT_L,
  KEYSYM_TAB,
  KEYSYM_UP,
  keysymForChar,
} from "@/lib/gui-keysyms";

export type KeyModifier = "ctrl" | "alt" | "shift";
export type LatchState = "off" | "armed" | "locked";
export type LatchMap = Record<KeyModifier, LatchState>;

export const LATCH_ALL_OFF: LatchMap = { ctrl: "off", alt: "off", shift: "off" };

/** One latch step: off → armed → locked → off. */
const nextLatch = (s: LatchState): LatchState =>
  s === "off" ? "armed" : s === "armed" ? "locked" : "off";

/** Pure latch reducer: tap `mod` once to arm, again to lock, again to release. */
export function latchModifier(state: LatchMap, mod: KeyModifier): LatchMap {
  return { ...state, [mod]: nextLatch(state[mod]) };
}

export type SendKey = (keysym: number, code: string | null, down?: boolean) => void;

interface ModifierSpec {
  id: KeyModifier;
  keysym: number;
  code: string;
  label: string;
}

/** Chord order: downs in this order, ups reversed. */
const MODIFIERS: readonly ModifierSpec[] = [
  { id: "ctrl", keysym: KEYSYM_CONTROL_L, code: "ControlLeft", label: "Ctrl" },
  { id: "alt", keysym: KEYSYM_ALT_L, code: "AltLeft", label: "Alt" },
  { id: "shift", keysym: KEYSYM_SHIFT_L, code: "ShiftLeft", label: "⇧" },
];

/** Wrap a key's press+release in every latched modifier's down/up. Armed
 *  modifiers are consumed by the chord; locked persist. */
export function composeChord(
  sendKey: SendKey,
  latch: LatchMap,
  keysym: number,
  code: string | null,
): LatchMap {
  const active = MODIFIERS.filter((m) => latch[m.id] !== "off");
  for (const m of active) sendKey(m.keysym, m.code, true);
  sendKey(keysym, code);
  for (const m of [...active].reverse()) sendKey(m.keysym, m.code, false);
  const next = { ...latch };
  for (const m of active) {
    if (latch[m.id] === "armed") next[m.id] = "off";
  }
  return next;
}

const PLAIN_KEYS: readonly { label: string; keysym: number; code: string }[] = [
  { label: "Esc", keysym: KEYSYM_ESCAPE, code: "Escape" },
  { label: "Tab", keysym: KEYSYM_TAB, code: "Tab" },
  { label: "←", keysym: KEYSYM_LEFT, code: "ArrowLeft" },
  { label: "↑", keysym: KEYSYM_UP, code: "ArrowUp" },
  { label: "↓", keysym: KEYSYM_DOWN, code: "ArrowDown" },
  { label: "→", keysym: KEYSYM_RIGHT, code: "ArrowRight" },
];

/** The hidden input's keydown forwards (printables arrive via input instead). */
const INPUT_SPECIAL_KEYS: Record<string, { keysym: number; code: string }> = {
  Enter: { keysym: KEYSYM_RETURN, code: "Enter" },
  Backspace: { keysym: KEYSYM_BACKSPACE, code: "Backspace" },
  Tab: { keysym: KEYSYM_TAB, code: "Tab" },
  Escape: { keysym: KEYSYM_ESCAPE, code: "Escape" },
  ArrowLeft: { keysym: KEYSYM_LEFT, code: "ArrowLeft" },
  ArrowUp: { keysym: KEYSYM_UP, code: "ArrowUp" },
  ArrowRight: { keysym: KEYSYM_RIGHT, code: "ArrowRight" },
  ArrowDown: { keysym: KEYSYM_DOWN, code: "ArrowDown" },
};

const NOOP_SEND_KEY: SendKey = () => {};

interface GuiKeyBarProps {
  /** RFB-bound sendKey from the parent; absent ⇒ inert (no live RFB). */
  sendKey?: SendKey;
}

export function GuiKeyBar({ sendKey = NOOP_SEND_KEY }: GuiKeyBarProps) {
  const [latch, setLatch] = useState<LatchMap>(LATCH_ALL_OFF);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pressKey = (keysym: number, code: string | null) => {
    setLatch(composeChord(sendKey, latch, keysym, code));
  };

  const forwardText = (text: string) => {
    for (const ch of text) pressKey(keysymForChar(ch), null);
  };

  const toggleKeyboard = () => {
    const input = inputRef.current;
    if (!input) return;
    if (document.activeElement === input) input.blur();
    else input.focus();
  };

  return (
    <div
      data-testid="gui-keybar"
      className="flex items-center gap-1 px-1 py-1 border-t border-border overflow-x-auto select-none font-mono"
    >
      {PLAIN_KEYS.slice(0, 2).map((k) => (
        <Control key={k.code} variant="chip" onClick={() => pressKey(k.keysym, k.code)}>
          {k.label}
        </Control>
      ))}
      {MODIFIERS.map((m) => (
        <Control
          key={m.id}
          variant="chip"
          pressed={latch[m.id] !== "off"}
          onClick={() => setLatch(latchModifier(latch, m.id))}
        >
          {latch[m.id] === "locked" ? `${m.label} ●` : m.label}
        </Control>
      ))}
      {PLAIN_KEYS.slice(2).map((k) => (
        <Control key={k.code} variant="chip" onClick={() => pressKey(k.keysym, k.code)}>
          {k.label}
        </Control>
      ))}
      <Control
        variant="chip"
        pressed={keyboardOpen}
        aria-label="Toggle on-screen keyboard"
        onClick={toggleKeyboard}
      >
        ⌨
      </Control>
      {/* The platform-OSK focus target: keystrokes forward through sendKey and
          never accumulate here. */}
      <input
        ref={inputRef}
        aria-label="On-screen keyboard"
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        className="sr-only"
        onFocus={() => setKeyboardOpen(true)}
        onBlur={() => setKeyboardOpen(false)}
        onBeforeInput={(e) => {
          const native = e.nativeEvent;
          const data = "data" in native && typeof native.data === "string" ? native.data : null;
          if (data === null || data.length === 0) return;
          // Forward, never accumulate: the input stays empty.
          e.preventDefault();
          forwardText(data);
        }}
        onChange={(e) => {
          // A path that bypassed beforeinput (paste, autocomplete) still
          // forwards and resets.
          const value = e.target.value;
          if (value.length === 0) return;
          forwardText(value);
          e.target.value = "";
        }}
        onKeyDown={(e) => {
          const special = INPUT_SPECIAL_KEYS[e.key];
          if (!special) return;
          e.preventDefault();
          pressKey(special.keysym, special.code);
        }}
      />
    </div>
  );
}
