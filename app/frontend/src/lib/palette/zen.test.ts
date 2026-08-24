import { describe, it, expect, vi } from "vitest";
import { buildZenActions } from "./zen";

/**
 * `buildZenActions` (260820-o8cr R7) — the palette's `View: Enter/Exit Zen
 * Mode` entries. Exactly one form renders, keyed on live zen state (the
 * `Layout: Expand`/`Restore` one-form precedent); the caller gates the offer on
 * `windowParam && !isMobile`, so the builder itself is arity-agnostic.
 * Pure-builder tests in the `palette/view.test.ts` pattern.
 */

describe("buildZenActions — one-form gating (R7)", () => {
  it("offers `View: Enter Zen Mode` while zen is inactive", () => {
    const actions = buildZenActions(false, { onToggle: vi.fn() });
    expect(actions.map((a) => a.id)).toEqual(["view-zen-enter"]);
    expect(actions[0].label).toBe("View: Enter Zen Mode");
  });

  it("offers `View: Exit Zen Mode` while zen is active (exactly one form)", () => {
    const actions = buildZenActions(true, { onToggle: vi.fn() });
    expect(actions.map((a) => a.id)).toEqual(["view-zen-exit"]);
    expect(actions[0].label).toBe("View: Exit Zen Mode");
  });

  it("is findable by searching \"zen\"", () => {
    for (const active of [false, true]) {
      const [entry] = buildZenActions(active, { onToggle: vi.fn() });
      expect(entry.label.toLowerCase()).toContain("zen");
    }
  });

  it("both forms resolve the shared toggle body", () => {
    const onToggle = vi.fn();
    buildZenActions(false, { onToggle })[0].onSelect();
    buildZenActions(true, { onToggle })[0].onSelect();
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});

describe("buildZenActions — shortcut hint (R7)", () => {
  it("carries the ⇧⌘⏎ hint when the binding resolves one", () => {
    const [entry] = buildZenActions(false, { onToggle: vi.fn(), shortcut: "⇧⌘⏎" });
    expect(entry.shortcut).toBe("⇧⌘⏎");
  });

  it("renders no hint when the binding is disabled/unbound", () => {
    const [entry] = buildZenActions(true, { onToggle: vi.fn(), shortcut: undefined });
    expect(entry.shortcut).toBeUndefined();
  });
});
