import { describe, expect, it, vi } from "vitest";
import {
  GUI_SEND_KEY_MIRROR_REFUSAL,
  SUGGESTED_CHORDS,
  parseKeyChord,
  sendKeyChord,
} from "./gui-send-key";
import {
  KEYSYM_ALT_L,
  KEYSYM_CONTROL_L,
  KEYSYM_DELETE,
  KEYSYM_F1,
  KEYSYM_PRINT,
  KEYSYM_SUPER_L,
} from "./gui-keysyms";
import type { SendKey } from "../components/gui-keybar";

function callsOf(spy: ReturnType<typeof vi.fn<SendKey>>) {
  return spy.mock.calls.map(([keysym, code, down]) => [keysym, code, down]);
}

describe("SUGGESTED_CHORDS", () => {
  it("is the five quick-picks in order", () => {
    expect([...SUGGESTED_CHORDS]).toEqual(["Ctrl+Alt+Del", "Ctrl+Alt+T", "Alt+F4", "Super", "Print"]);
  });

  it("every suggestion parses", () => {
    for (const chord of SUGGESTED_CHORDS) {
      expect(parseKeyChord(chord)).not.toBeNull();
    }
  });
});

describe("parseKeyChord", () => {
  it("parses Ctrl+Alt+Del with modifiers in order", () => {
    expect(parseKeyChord("Ctrl+Alt+Del")).toEqual({
      modifiers: [
        { keysym: KEYSYM_CONTROL_L, code: "ControlLeft" },
        { keysym: KEYSYM_ALT_L, code: "AltLeft" },
      ],
      key: { keysym: KEYSYM_DELETE, code: "Delete" },
    });
  });

  it("is case-insensitive and accepts modifier aliases", () => {
    expect(parseKeyChord("ctrl+alt+del")).toEqual(parseKeyChord("Ctrl+Alt+Del"));
    expect(parseKeyChord("Control+Delete")).toEqual(parseKeyChord("Ctrl+Del"));
    expect(parseKeyChord("Win")).toEqual(parseKeyChord("Super"));
    expect(parseKeyChord("Meta")).toEqual(parseKeyChord("Super"));
  });

  it("parses a free-typed function key and single characters", () => {
    expect(parseKeyChord("Ctrl+Alt+F4")?.key).toEqual({ keysym: KEYSYM_F1 + 3, code: "F4" });
    expect(parseKeyChord("Ctrl+Alt+T")?.key).toEqual({ keysym: 0x74, code: null });
  });

  it("accepts a modifiers-only chord (Super presses and releases)", () => {
    expect(parseKeyChord("Super")).toEqual({
      modifiers: [],
      key: { keysym: KEYSYM_SUPER_L, code: "SuperLeft" },
    });
  });

  it("rejects empty input, a trailing +, and unknown tokens", () => {
    expect(parseKeyChord("")).toBeNull();
    expect(parseKeyChord("Ctrl+")).toBeNull();
    expect(parseKeyChord("Foo+Bar")).toBeNull();
    expect(parseKeyChord("Ctrl++Del")).toBeNull();
  });
});

describe("sendKeyChord", () => {
  it("Ctrl+Alt+Del: downs in order, key press+release, ups reversed", () => {
    const sendKey = vi.fn<SendKey>();
    const chord = parseKeyChord("Ctrl+Alt+Del");
    expect(chord).not.toBeNull();
    if (chord) sendKeyChord(sendKey, chord);
    expect(callsOf(sendKey)).toEqual([
      [KEYSYM_CONTROL_L, "ControlLeft", true],
      [KEYSYM_ALT_L, "AltLeft", true],
      [KEYSYM_DELETE, "Delete", undefined],
      [KEYSYM_ALT_L, "AltLeft", false],
      [KEYSYM_CONTROL_L, "ControlLeft", false],
    ]);
  });

  it("Alt+F4: Alt down, F4 press+release, Alt up", () => {
    const sendKey = vi.fn<SendKey>();
    const chord = parseKeyChord("Alt+F4");
    expect(chord).not.toBeNull();
    if (chord) sendKeyChord(sendKey, chord);
    expect(callsOf(sendKey)).toEqual([
      [KEYSYM_ALT_L, "AltLeft", true],
      [KEYSYM_F1 + 3, "F4", undefined],
      [KEYSYM_ALT_L, "AltLeft", false],
    ]);
  });

  it("Super: a single press+release", () => {
    const sendKey = vi.fn<SendKey>();
    const chord = parseKeyChord("Super");
    expect(chord).not.toBeNull();
    if (chord) sendKeyChord(sendKey, chord);
    expect(callsOf(sendKey)).toEqual([[KEYSYM_SUPER_L, "SuperLeft", undefined]]);
  });

  it("Print: a single press+release", () => {
    const sendKey = vi.fn<SendKey>();
    const chord = parseKeyChord("Print");
    expect(chord).not.toBeNull();
    if (chord) sendKeyChord(sendKey, chord);
    expect(callsOf(sendKey)).toEqual([[KEYSYM_PRINT, "PrintScreen", undefined]]);
  });

  it("Ctrl+Alt+T: the character's keysym is its code point", () => {
    const sendKey = vi.fn<SendKey>();
    const chord = parseKeyChord("Ctrl+Alt+T");
    expect(chord).not.toBeNull();
    if (chord) sendKeyChord(sendKey, chord);
    expect(callsOf(sendKey)).toEqual([
      [KEYSYM_CONTROL_L, "ControlLeft", true],
      [KEYSYM_ALT_L, "AltLeft", true],
      [0x74, null, undefined],
      [KEYSYM_ALT_L, "AltLeft", false],
      [KEYSYM_CONTROL_L, "ControlLeft", false],
    ]);
  });
});

describe("GUI_SEND_KEY_MIRROR_REFUSAL", () => {
  it("is the backend's gui <verb> template with verb send key", () => {
    expect(GUI_SEND_KEY_MIRROR_REFUSAL).toBe(
      "gui send key is not supported on macOS in v1 — the GUI mirrors your live session view-only",
    );
  });
});
