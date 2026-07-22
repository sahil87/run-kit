import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readInstanceColorEcho,
  writeInstanceColorEcho,
  deriveAccentHexes,
  applyThemeColorMeta,
  setAccentThemeColor,
  INSTANCE_COLOR_STORAGE_KEY,
} from "./instance-accent";
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "./themes";

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = '<meta name="theme-color" content="#000000" />';
});

afterEach(() => {
  // Reset the module's writer state so tests don't leak accents into each other.
  setAccentThemeColor(null);
  localStorage.clear();
  document.head.innerHTML = "";
});

function metaContent(): string | null {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null;
}

describe("instance color echo", () => {
  it("round-trips a {value, hex} payload", () => {
    writeInstanceColorEcho({ value: "1+3", hex: "#aa5522" });
    expect(readInstanceColorEcho()).toEqual({ value: "1+3", hex: "#aa5522" });
  });

  it("clears on null", () => {
    writeInstanceColorEcho({ value: "4", hex: "#3355aa" });
    writeInstanceColorEcho(null);
    expect(readInstanceColorEcho()).toBeNull();
    expect(localStorage.getItem(INSTANCE_COLOR_STORAGE_KEY)).toBeNull();
  });

  it("ignores malformed or wrong-shape values silently", () => {
    for (const bad of ["not json{", "42", '"just a string"', '{"value":7,"hex":true}', '{"value":"4"}']) {
      localStorage.setItem(INSTANCE_COLOR_STORAGE_KEY, bad);
      expect(readInstanceColorEcho()).toBeNull();
    }
  });

  it("returns null when nothing is stored", () => {
    expect(readInstanceColorEcho()).toBeNull();
  });
});

describe("deriveAccentHexes", () => {
  it("derives stripe and wash hexes for single and blend descriptors, per theme", () => {
    for (const value of ["4", "1+3"]) {
      for (const theme of [DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME]) {
        const hexes = deriveAccentHexes(value, theme);
        expect(hexes).not.toBeNull();
        expect(hexes?.stripeHex).toMatch(/^#[0-9a-f]{6}$/i);
        expect(hexes?.washHex).toMatch(/^#[0-9a-f]{6}$/i);
        // The wash is a near-background blend, never the raw accent.
        expect(hexes?.washHex).not.toBe(hexes?.stripeHex);
      }
    }
  });

  it("returns null for an unrecognized value", () => {
    expect(deriveAccentHexes("99", DEFAULT_DARK_THEME)).toBeNull();
  });

  it("recomputes per palette (dark vs light differ)", () => {
    const dark = deriveAccentHexes("4", DEFAULT_DARK_THEME);
    const light = deriveAccentHexes("4", DEFAULT_LIGHT_THEME);
    expect(dark?.washHex).not.toBe(light?.washHex);
  });
});

describe("theme-color meta writer (single writer, last-wins content)", () => {
  it("writes the background when no accent is set", () => {
    applyThemeColorMeta("#101010");
    expect(metaContent()).toBe("#101010");
  });

  it("accent wins over a later theme apply (the clobber fix)", () => {
    setAccentThemeColor("#aa3311");
    applyThemeColorMeta("#101010");
    expect(metaContent()).toBe("#aa3311");
  });

  it("clearing the accent restores the recorded background", () => {
    applyThemeColorMeta("#101010");
    setAccentThemeColor("#aa3311");
    expect(metaContent()).toBe("#aa3311");
    setAccentThemeColor(null);
    expect(metaContent()).toBe("#101010");
  });
});
