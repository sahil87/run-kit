import { describe, it, expect } from "vitest";
import {
  DEFAULT_BINDINGS,
  resolveBindings,
  type EffectiveBinding,
  type KeyBinding,
} from "@/lib/keybindings";
import { buildWebChordTable, type WebChordSpec } from "./web-chord-table";

// buildWebChordTable is the native engine's half of the reclaim predicate: it
// must expand tiers exactly as matchesCombo accepts them, apply the same
// kind-"web" gating hasReclaimableMatch applies (ttyOnly/guiOnly out, webOnly
// in, disabled out), and always end with the focus-return Escape spec.

function binding(overrides: Partial<KeyBinding> & { enabled?: boolean }): EffectiveBinding {
  const { enabled = true, ...rest } = overrides;
  return {
    actionId: "x",
    code: "KeyX",
    tier: "cmd",
    scope: "global",
    kind: "builtin",
    label: "x",
    ...rest,
    enabled,
    isDefault: true,
  };
}

describe("buildWebChordTable tier expansion", () => {
  it("expands cmd to plain Ctrl and Meta without Shift", () => {
    expect(buildWebChordTable([binding({ code: "KeyK", tier: "cmd" })])).toEqual([
      { code: "KeyK", ctrl: true, meta: false, shift: false, alt: false },
      { code: "KeyK", ctrl: false, meta: true, shift: false, alt: false },
      { code: "Escape", ctrl: false, meta: false, shift: false, alt: false },
    ]);
  });

  it("expands shifted to Shift+Ctrl and Shift+Meta", () => {
    expect(buildWebChordTable([binding({ code: "KeyN", tier: "shifted" })])).toEqual([
      { code: "KeyN", ctrl: true, meta: false, shift: true, alt: false },
      { code: "KeyN", ctrl: false, meta: true, shift: true, alt: false },
      { code: "Escape", ctrl: false, meta: false, shift: false, alt: false },
    ]);
  });

  it("expands ctrl to plain Ctrl only", () => {
    expect(buildWebChordTable([binding({ code: "Equal", tier: "ctrl" })])).toEqual([
      { code: "Equal", ctrl: true, meta: false, shift: false, alt: false },
      { code: "Escape", ctrl: false, meta: false, shift: false, alt: false },
    ]);
  });
});

describe("buildWebChordTable gating", () => {
  it("skips disabled, ttyOnly, and guiOnly bindings; keeps webOnly and ungated ones", () => {
    const table = buildWebChordTable([
      binding({ actionId: "off", code: "KeyO", tier: "cmd", enabled: false }),
      binding({ actionId: "tty", code: "KeyT", tier: "cmd", ttyOnly: true }),
      binding({ actionId: "gui", code: "KeyG", tier: "ctrl", guiOnly: true }),
      binding({ actionId: "web", code: "KeyF", tier: "cmd", webOnly: true }),
      binding({ actionId: "global", code: "KeyK", tier: "cmd" }),
    ]);
    const codes = table.map((s) => s.code);
    expect(codes).not.toContain("KeyO");
    expect(codes).not.toContain("KeyT");
    expect(codes).not.toContain("KeyG");
    expect(codes).toContain("KeyF");
    expect(codes).toContain("KeyK");
  });

  it("skips a keyless binding (code empty — palette-only on this host)", () => {
    expect(buildWebChordTable([binding({ code: "" })])).toEqual([
      { code: "Escape", ctrl: false, meta: false, shift: false, alt: false },
    ]);
  });
});

describe("buildWebChordTable table shape", () => {
  it("dedupes by the five-tuple and keeps registry order, Escape last", () => {
    const table = buildWebChordTable([
      binding({ actionId: "a", code: "KeyK", tier: "cmd" }),
      binding({ actionId: "b", code: "KeyK", tier: "ctrl" }), // dupes a's ctrl arm
      binding({ actionId: "c", code: "KeyK", tier: "shifted" }),
    ]);
    const tuple = (s: WebChordSpec) => `${s.code}:${s.ctrl}:${s.meta}:${s.shift}:${s.alt}`;
    expect(new Set(table.map(tuple)).size).toBe(table.length);
    expect(table).toEqual([
      { code: "KeyK", ctrl: true, meta: false, shift: false, alt: false },
      { code: "KeyK", ctrl: false, meta: true, shift: false, alt: false },
      { code: "KeyK", ctrl: true, meta: false, shift: true, alt: false },
      { code: "KeyK", ctrl: false, meta: true, shift: true, alt: false },
      { code: "Escape", ctrl: false, meta: false, shift: false, alt: false },
    ]);
    expect(table[table.length - 1]?.code).toBe("Escape");
  });
});

describe("buildWebChordTable over the default registry", () => {
  // The shipped defaults resolved for a Win/Linux shell host: browser-reserved
  // chords stay enabled inside the shell, so the full set is in play.
  const bindings = resolveBindings(DEFAULT_BINDINGS, {}, { platform: "other", shell: true });

  it("contains the ⌘K palette chord's ctrl and meta arms", () => {
    const table = buildWebChordTable(bindings);
    expect(table).toContainEqual({ code: "KeyK", ctrl: true, meta: false, shift: false, alt: false });
    expect(table).toContainEqual({ code: "KeyK", ctrl: false, meta: true, shift: false, alt: false });
  });

  it("contains the webOnly ⌘F/⌘L arms and no ttyOnly/guiOnly codes", () => {
    const table = buildWebChordTable(bindings);
    expect(table).toContainEqual({ code: "KeyF", ctrl: true, meta: false, shift: false, alt: false });
    expect(table).toContainEqual({ code: "KeyL", ctrl: true, meta: false, shift: false, alt: false });
    // The ttyOnly split pair and the guiOnly zoom trio are pane/gui chords —
    // they must not be reclaimed from a web guest.
    expect(table.find((s) => s.code === "Backslash")).toBeUndefined();
    expect(table.find((s) => s.code === "Equal")).toBeUndefined();
    expect(table.find((s) => s.code === "Minus" && s.ctrl && !s.shift)).toBeUndefined();
  });

  it("released includes the capture toggle's shifted arms — it is web-reclaimable now", () => {
    const table = buildWebChordTable(bindings);
    expect(table).toContainEqual({ code: "KeyG", ctrl: true, meta: false, shift: true, alt: false });
    expect(table).toContainEqual({ code: "KeyG", ctrl: false, meta: true, shift: true, alt: false });
    expect(table[table.length - 1]?.code).toBe("Escape");
  });
});

describe("buildWebChordTable captured mode (the web capture latch)", () => {
  const bindings = resolveBindings(DEFAULT_BINDINGS, {}, { platform: "other", shell: true });

  it("emits only the toggle binding's two specs — and no Escape", () => {
    expect(buildWebChordTable(bindings, { captured: true })).toEqual([
      { code: "KeyG", ctrl: true, meta: false, shift: true, alt: false },
      { code: "KeyG", ctrl: false, meta: true, shift: true, alt: false },
    ]);
  });

  it("a rebound toggle moves the captured table to its rebound specs", () => {
    const rebound = resolveBindings(
      DEFAULT_BINDINGS,
      { "gui-capture-toggle": { code: "KeyU", tier: "cmd" } },
      { platform: "other", shell: true },
    );
    expect(buildWebChordTable(rebound, { captured: true })).toEqual([
      { code: "KeyU", ctrl: true, meta: false, shift: false, alt: false },
      { code: "KeyU", ctrl: false, meta: true, shift: false, alt: false },
    ]);
  });

  it("a disabled toggle yields an empty table — the button and palette row are the exits", () => {
    const disabled = resolveBindings(
      DEFAULT_BINDINGS,
      { "gui-capture-toggle": null },
      { platform: "other", shell: true },
    );
    expect(buildWebChordTable(disabled, { captured: true })).toEqual([]);
  });

  it("captured ignores every non-toggle binding, including ungated and webOnly ones", () => {
    const table = buildWebChordTable(
      [
        binding({ actionId: "global", code: "KeyK", tier: "cmd" }),
        binding({ actionId: "web", code: "KeyF", tier: "cmd", webOnly: true }),
        binding({ actionId: "toggle", code: "KeyG", tier: "shifted", captureSurface: true }),
      ],
      { captured: true },
    );
    expect(table).toEqual([
      { code: "KeyG", ctrl: true, meta: false, shift: true, alt: false },
      { code: "KeyG", ctrl: false, meta: true, shift: true, alt: false },
    ]);
  });
});
