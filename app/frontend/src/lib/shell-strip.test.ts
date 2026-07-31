import { describe, it, expect } from "vitest";
import type { ShellServer } from "@/lib/shell";
import {
  activeShellHostName,
  hostAcceleratorHint,
  MAX_SHELL_SWITCHER_HINTS,
  shellHostMenuRows,
  stripInsets,
  stripLabelColor,
  stripSwitcherEnabled,
} from "./shell-strip";

describe("stripLabelColor", () => {
  it("picks the light text over dark strip backgrounds", () => {
    expect(stripLabelColor("#0f1117")).toBe("#e5e7eb");
    expect(stripLabelColor("#20304a")).toBe("#e5e7eb");
  });

  it("picks the dark text over light strip backgrounds", () => {
    expect(stripLabelColor("#f8f9fb")).toBe("#111827");
    expect(stripLabelColor("#ffffff")).toBe("#111827");
  });
});

describe("stripInsets", () => {
  it("uses a fixed symmetric 80px inset on darwin (traffic lights)", () => {
    expect(stripInsets("darwin")).toEqual({ left: "80px", right: "80px" });
  });

  it("uses titlebar-area env expressions elsewhere (WCO overlay)", () => {
    const insets = stripInsets("win32");
    expect(insets.left).toContain("titlebar-area-x");
    expect(insets.right).toContain("titlebar-area-width");
    expect(stripInsets("linux")).toEqual(insets);
  });
});

describe("activeShellHostName", () => {
  const a: ShellServer = { id: "a", name: "studio-mac", url: "http://a:3000", active: false };
  const b: ShellServer = { id: "b", name: "gcp-box", url: "http://b:3000", active: true };

  it("returns the active entry's name", () => {
    expect(activeShellHostName([a, b])).toBe("gcp-box");
  });

  it("returns null when no entry is active", () => {
    expect(activeShellHostName([a])).toBeNull();
  });

  it("returns null for an unavailable list (older shell / denial)", () => {
    expect(activeShellHostName(null)).toBeNull();
    expect(activeShellHostName([])).toBeNull();
  });
});

describe("hostAcceleratorHint", () => {
  it("maps darwin to the ⌥⌘ shell tier, index-ordered", () => {
    expect(hostAcceleratorHint("darwin", 0)).toBe("⌥⌘1");
    expect(hostAcceleratorHint("darwin", 8)).toBe("⌥⌘9");
  });

  it("maps every other platform to the ⇧Ctrl shell tier", () => {
    expect(hostAcceleratorHint("win32", 0)).toBe("⇧Ctrl+1");
    expect(hostAcceleratorHint("linux", 2)).toBe("⇧Ctrl+3");
  });

  it("returns null past the 9-cap and for out-of-range indices", () => {
    expect(hostAcceleratorHint("darwin", MAX_SHELL_SWITCHER_HINTS)).toBeNull();
    expect(hostAcceleratorHint("win32", 42)).toBeNull();
    expect(hostAcceleratorHint("darwin", -1)).toBeNull();
  });
});

describe("shellHostMenuRows", () => {
  const host = (id: string, name: string, url: string, active = false): ShellServer => ({
    id,
    name,
    url,
    active,
  });

  it("derives id/name/origin/active/hint per entry, list order preserved", () => {
    const rows = shellHostMenuRows(
      [host("a", "studio-mac", "http://a:3000", true), host("b", "gcp-box", "http://b:3000")],
      "darwin",
    );
    expect(rows).toEqual([
      { id: "a", name: "studio-mac", origin: "http://a:3000", active: true, hint: "⌥⌘1" },
      { id: "b", name: "gcp-box", origin: "http://b:3000", active: false, hint: "⌥⌘2" },
    ]);
  });

  it("keeps duplicate names apart via distinct origins", () => {
    const rows = shellHostMenuRows(
      [host("a", "dev", "http://one:3000", true), host("b", "dev", "https://two.example.com")],
      "linux",
    );
    expect(rows[0].origin).toBe("http://one:3000");
    expect(rows[1].origin).toBe("https://two.example.com");
    expect(rows[1].hint).toBe("⇧Ctrl+2");
  });

  it("falls back to the raw url string when the url is unparseable", () => {
    const rows = shellHostMenuRows([host("a", "broken", "not a url")], "darwin");
    expect(rows[0].origin).toBe("not a url");
  });

  it("gives hosts beyond the ninth no hint", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      host(`h${i}`, `host-${i}`, `http://h${i}:3000`, i === 0),
    );
    const rows = shellHostMenuRows(many, "darwin");
    expect(rows[8].hint).toBe("⌥⌘9");
    expect(rows[9].hint).toBeNull();
  });
});

describe("stripSwitcherEnabled", () => {
  it("is false for an unavailable or empty list (older shell / denial)", () => {
    expect(stripSwitcherEnabled(null)).toBe(false);
    expect(stripSwitcherEnabled([])).toBe(false);
  });

  it("is true for a non-empty list", () => {
    const a: ShellServer = { id: "a", name: "studio-mac", url: "http://a:3000", active: true };
    expect(stripSwitcherEnabled([a])).toBe(true);
  });
});
