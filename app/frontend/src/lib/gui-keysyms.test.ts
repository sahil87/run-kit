import { describe, expect, it } from "vitest";
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
} from "./gui-keysyms";

describe("gui-keysyms constants", () => {
  it("matches the X11 keysym table", () => {
    expect(KEYSYM_ESCAPE).toBe(0xff1b);
    expect(KEYSYM_TAB).toBe(0xff09);
    expect(KEYSYM_RETURN).toBe(0xff0d);
    expect(KEYSYM_BACKSPACE).toBe(0xff08);
    expect(KEYSYM_LEFT).toBe(0xff51);
    expect(KEYSYM_UP).toBe(0xff52);
    expect(KEYSYM_RIGHT).toBe(0xff53);
    expect(KEYSYM_DOWN).toBe(0xff54);
    expect(KEYSYM_SHIFT_L).toBe(0xffe1);
    expect(KEYSYM_CONTROL_L).toBe(0xffe3);
    expect(KEYSYM_ALT_L).toBe(0xffe9);
  });
});

describe("keysymForChar", () => {
  it("maps an ASCII printable to its code point", () => {
    expect(keysymForChar("c")).toBe(0x63);
  });

  it("maps a Latin-1 character to its code point", () => {
    expect(keysymForChar("é")).toBe(0xe9);
  });

  it("maps a non-Latin-1 character into the unicode fallback range", () => {
    expect(keysymForChar("€")).toBe(0x01000000 | 0x20ac);
  });
});
