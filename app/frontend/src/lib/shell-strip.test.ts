import { describe, it, expect } from "vitest";
import type { ShellServer } from "@/lib/shell";
import { activeShellHostName, stripInsets, stripLabelColor } from "./shell-strip";

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
