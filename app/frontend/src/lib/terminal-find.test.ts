import { describe, it, expect, vi } from "vitest";
import type { SearchAddon } from "@xterm/addon-search";
import {
  TERMINAL_FIND_OPEN_EVENT,
  TERMINAL_FIND_SCOPE_NOTE,
  buildSearchOptions,
  runFind,
} from "@/lib/terminal-find";
import { DEFAULT_DARK_THEME } from "@/themes";

const RRGGBB = /^#[0-9a-f]{6}$/i;
const palette = DEFAULT_DARK_THEME.palette;

describe("terminal-find — event + scope note", () => {
  it("exports the open-event name and the buffer-scope note", () => {
    expect(TERMINAL_FIND_OPEN_EVENT).toBe("terminal-find:open");
    expect(TERMINAL_FIND_SCOPE_NOTE).toContain("since attach");
  });
});

describe("buildSearchOptions", () => {
  it("maps the Aa toggle to caseSensitive and the .* toggle to regex", () => {
    const on = buildSearchOptions({ caseSensitive: true, regex: true }, palette);
    expect(on.caseSensitive).toBe(true);
    expect(on.regex).toBe(true);
    const off = buildSearchOptions({ caseSensitive: false, regex: false }, palette);
    expect(off.caseSensitive).toBe(false);
    expect(off.regex).toBe(false);
  });

  it("always enables decorations: amber matches, accent-green active, theme-derived #RRGGBB", () => {
    const { decorations } = buildSearchOptions(
      { caseSensitive: false, regex: false },
      palette,
    );
    expect(decorations).toBeDefined();
    const d = decorations!;
    // Ruler ticks at full strength: ansi[3] amber, ansi[2] accent green.
    expect(d.matchOverviewRuler).toBe(palette.ansi[3]);
    expect(d.activeMatchColorOverviewRuler).toBe(palette.ansi[2]);
    // Buffer fills are the same hues blended into the background.
    expect(d.matchBackground).not.toBe(palette.ansi[3]);
    expect(d.activeMatchBackground).not.toBe(palette.ansi[2]);
    for (const c of [
      d.matchBackground,
      d.matchOverviewRuler,
      d.activeMatchBackground,
      d.activeMatchColorOverviewRuler,
    ]) {
      expect(c).toMatch(RRGGBB);
    }
  });
});

describe("runFind", () => {
  const stubAddon = (over: Partial<SearchAddon> = {}) =>
    ({ findNext: vi.fn(() => true), findPrevious: vi.fn(() => true), ...over }) as unknown as SearchAddon;

  it("drives findNext on direction 1 and findPrevious on -1 with the given options", () => {
    const addon = stubAddon();
    const options = buildSearchOptions({ caseSensitive: true, regex: false }, palette);
    expect(runFind(addon, "FAIL", 1, options)).toBe(true);
    expect(addon.findNext).toHaveBeenCalledWith("FAIL", options);
    expect(runFind(addon, "FAIL", -1, options)).toBe(true);
    expect(addon.findPrevious).toHaveBeenCalledWith("FAIL", options);
  });

  it("no-ops on an absent addon or empty query", () => {
    const addon = stubAddon();
    const options = buildSearchOptions({ caseSensitive: false, regex: false }, palette);
    expect(runFind(null, "x", 1, options)).toBe(false);
    expect(runFind(addon, "", 1, options)).toBe(false);
    expect(addon.findNext).not.toHaveBeenCalled();
  });

  it("returns false instead of throwing on an invalid regex pattern", () => {
    const addon = stubAddon({
      findNext: vi.fn(() => {
        throw new Error("Invalid regular expression");
      }),
    });
    const options = buildSearchOptions({ caseSensitive: false, regex: true }, palette);
    expect(runFind(addon, "([", 1, options)).toBe(false);
  });
});
