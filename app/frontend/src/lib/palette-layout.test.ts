import { describe, it, expect, vi } from "vitest";
import { buildLayoutActions } from "./palette-layout";
import type { Layout, SurfaceKind } from "./surface-layout";

/**
 * `buildLayoutActions` (260812-ab5v R11) — the palette's `Layout:` entries per
 * layout state. Pure-builder tests in the `palette-view.test.ts` pattern.
 */

const ALL: SurfaceKind[] = ["tty", "web", "chat", "code"];

function build(
  layout: Layout,
  overrides: Partial<Parameters<typeof buildLayoutActions>[2]> = {},
  available: SurfaceKind[] = ALL,
) {
  return buildLayoutActions(layout, available, {
    zoomed: false,
    zoomEnabled: layout.order.length > 1,
    onApply: vi.fn(),
    onZoomToggle: vi.fn(),
    ...overrides,
  });
}

const ids = (layout: Layout, available: SurfaceKind[] = ALL) =>
  build(layout, {}, available).map((a) => a.id);

describe("buildLayoutActions — adds/closes (R10/R11)", () => {
  it("single:tty offers an Add per available non-open surface and NO closes/verbs", () => {
    const actions = ids({ shape: "single", order: ["tty"] });
    expect(actions).toContain("layout-add-web");
    expect(actions).toContain("layout-add-chat");
    expect(actions).toContain("layout-add-code");
    expect(actions).not.toContain("layout-add-tty"); // already open
    // single: no closes (the last tile never closes), no promote/swap/zoom,
    // no shape jumps, no cycle (the arity-1 ring is degenerate).
    expect(actions.some((id) => id.startsWith("layout-close-"))).toBe(false);
    expect(actions.some((id) => id.startsWith("layout-promote-"))).toBe(false);
    expect(actions.some((id) => id.startsWith("layout-swap-"))).toBe(false);
    expect(actions).not.toContain("layout-zoom");
    expect(actions).not.toContain("layout-shape-split-h");
    expect(actions).not.toContain("layout-cycle");
  });

  it("add runs addSurface through onApply (1→2 grows to split-h)", () => {
    const onApply = vi.fn();
    const actions = build({ shape: "single", order: ["tty"] }, { onApply });
    actions.find((a) => a.id === "layout-add-code")!.onSelect();
    expect(onApply).toHaveBeenCalledWith({ shape: "split-h", order: ["tty", "code"] });
  });

  it("at 3 tiles no Add entries are offered (max — the rail disables instead)", () => {
    const actions = ids({ shape: "main-left", order: ["tty", "code", "web"] });
    expect(actions.some((id) => id.startsWith("layout-add-"))).toBe(false);
    expect(actions).toContain("layout-close-web");
  });

  it("close runs closeSurface through onApply (3→2 collapses to split-h)", () => {
    const onApply = vi.fn();
    const actions = build(
      { shape: "main-left", order: ["tty", "code", "web"] },
      { onApply },
    );
    actions.find((a) => a.id === "layout-close-web")!.onSelect();
    expect(onApply).toHaveBeenCalledWith({ shape: "split-h", order: ["tty", "code"] });
  });

  it("an unavailable surface gets no Add entry", () => {
    const actions = ids({ shape: "single", order: ["tty"] }, ["tty", "web"]);
    expect(actions).toContain("layout-add-web");
    expect(actions).not.toContain("layout-add-code");
  });
});

describe("buildLayoutActions — zoom (R6/R11)", () => {
  it("offers Zoom when enabled and unzoomed, Unzoom when zoomed — never both", () => {
    const layout: Layout = { shape: "split-h", order: ["tty", "code"] };
    expect(ids(layout)).toContain("layout-zoom");
    expect(ids(layout)).not.toContain("layout-unzoom");
    const zoomed = build(layout, { zoomed: true }).map((a) => a.id);
    expect(zoomed).toContain("layout-unzoom");
    expect(zoomed).not.toContain("layout-zoom");
  });

  it("zoom entries are gated on zoomEnabled (single/mobile)", () => {
    expect(ids({ shape: "single", order: ["tty"] })).not.toContain("layout-zoom");
    const mobile = build(
      { shape: "split-h", order: ["tty", "code"] },
      { zoomEnabled: false },
    ).map((a) => a.id);
    expect(mobile).not.toContain("layout-zoom");
  });

  it("the zoom entry fires the toggle seam, not onApply (transient — R6)", () => {
    const onApply = vi.fn();
    const onZoomToggle = vi.fn();
    const actions = build(
      { shape: "split-h", order: ["tty", "code"] },
      { onApply, onZoomToggle },
    );
    actions.find((a) => a.id === "layout-zoom")!.onSelect();
    expect(onZoomToggle).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe("buildLayoutActions — verbs + shapes (R7/R9)", () => {
  it("promote is offered per open kind EXCEPT slot A; swap per open kind", () => {
    const actions = ids({ shape: "main-left", order: ["tty", "code", "web"] });
    expect(actions).not.toContain("layout-promote-tty"); // slot A — a no-op
    expect(actions).toContain("layout-promote-code");
    expect(actions).toContain("layout-swap-tty");
    expect(actions).toContain("layout-swap-web");
  });

  it("promote/swap run the pure mutations through onApply", () => {
    const onApply = vi.fn();
    const layout: Layout = { shape: "split-h", order: ["tty", "code"] };
    const actions = build(layout, { onApply });
    actions.find((a) => a.id === "layout-promote-code")!.onSelect();
    expect(onApply).toHaveBeenCalledWith({ shape: "split-h", order: ["code", "tty"] });
    actions.find((a) => a.id === "layout-swap-tty")!.onSelect();
    expect(onApply).toHaveBeenCalledWith({ shape: "split-h", order: ["code", "tty"] });
  });

  it("shape jumps list the CURRENT arity's other presets only", () => {
    const two = ids({ shape: "split-h", order: ["tty", "code"] });
    expect(two).toContain("layout-shape-split-v");
    expect(two).not.toContain("layout-shape-split-h"); // never the current
    expect(two).not.toContain("layout-shape-main-left"); // wrong arity

    const three = ids({ shape: "main-left", order: ["tty", "code", "web"] });
    for (const s of ["row", "col", "main-right", "main-top"]) {
      expect(three).toContain(`layout-shape-${s}`);
    }
    expect(three).not.toContain("layout-shape-main-left");
    expect(three).not.toContain("layout-shape-single");
  });

  it("shape labels read `Layout: <Shape>` and jumps run setShape", () => {
    const onApply = vi.fn();
    const actions = build({ shape: "split-h", order: ["tty", "code"] }, { onApply });
    const jump = actions.find((a) => a.id === "layout-shape-split-v")!;
    expect(jump.label).toBe("Layout: Split Vertical");
    jump.onSelect();
    expect(onApply).toHaveBeenCalledWith({ shape: "split-v", order: ["tty", "code"] });
  });

  it("`Layout: Cycle Shape` carries the registry actionId and cycles same-arity", () => {
    const onApply = vi.fn();
    const actions = build(
      { shape: "main-left", order: ["tty", "code", "web"] },
      { onApply },
    );
    const cycle = actions.find((a) => a.id === "layout-cycle")!;
    expect(cycle.label).toBe("Layout: Cycle Shape");
    cycle.onSelect();
    expect(onApply).toHaveBeenCalledWith({
      shape: "main-right",
      order: ["tty", "code", "web"],
    });
  });
});

describe("buildLayoutActions — the ⇧⌘. hint (panel-toggle documentation)", () => {
  it("stamps the toggle chord on the chord-target surface's Add/Close entry", () => {
    // tty-only open: the target (web) is closed → its ADD entry carries it.
    const added = build(
      { shape: "single", order: ["tty"] },
      { toggleTarget: "web", toggleShortcut: "⇧⌘." },
    );
    expect(added.find((a) => a.id === "layout-add-web")?.shortcut).toBe("⇧⌘.");
    expect(added.find((a) => a.id === "layout-add-code")?.shortcut).toBeUndefined();
    // Target open: its CLOSE entry carries the hint instead.
    const closed = build(
      { shape: "split-h", order: ["tty", "web"] },
      { toggleTarget: "web", toggleShortcut: "⇧⌘." },
    );
    expect(closed.find((a) => a.id === "layout-close-web")?.shortcut).toBe("⇧⌘.");
  });

  it("omits the hint when the chord is disabled/unbound (empty shortcut)", () => {
    const actions = build(
      { shape: "single", order: ["tty"] },
      { toggleTarget: "web", toggleShortcut: "" },
    );
    expect(actions.find((a) => a.id === "layout-add-web")?.shortcut).toBeUndefined();
  });
});

describe("buildLayoutActions — Layout: Focus <Surface> (260812-wfic R10)", () => {
  it("offers one Focus entry per open NON-focused kind (the focused one is omitted)", () => {
    const actions = build(
      { shape: "split-h", order: ["tty", "code"] },
      { focusedKind: "tty", onFocus: vi.fn() },
    ).map((a) => a.id);
    expect(actions).toContain("layout-focus-code");
    expect(actions).not.toContain("layout-focus-tty"); // already focused
  });

  it("a Focus entry fires onFocus with the kind (the focusTileRef seam), never onApply", () => {
    const onApply = vi.fn();
    const onFocus = vi.fn();
    const actions = build(
      { shape: "split-h", order: ["tty", "code"] },
      { onApply, focusedKind: "tty", onFocus },
    );
    const entry = actions.find((a) => a.id === "layout-focus-code")!;
    expect(entry.label).toBe("Layout: Focus Code");
    entry.onSelect();
    expect(onFocus).toHaveBeenCalledWith("code");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("duplicate kinds yield ONE Focus entry (the seam focuses the first slot)", () => {
    const actions = build(
      { shape: "split-h", order: ["tty", "tty"] },
      { focusedKind: "code", onFocus: vi.fn() },
      ["tty", "code"],
    ).map((a) => a.id);
    expect(actions.filter((id) => id === "layout-focus-tty")).toHaveLength(1);
  });

  it("hidden at arity 1, without onFocus (mobile), and without focusedKind", () => {
    const onFocus = vi.fn();
    expect(
      build({ shape: "single", order: ["tty"] }, { focusedKind: "tty", onFocus })
        .some((a) => a.id.startsWith("layout-focus-")),
    ).toBe(false);
    expect(
      build({ shape: "split-h", order: ["tty", "code"] }, { focusedKind: "tty" })
        .some((a) => a.id.startsWith("layout-focus-")),
    ).toBe(false);
    expect(
      build({ shape: "split-h", order: ["tty", "code"] }, { onFocus })
        .some((a) => a.id.startsWith("layout-focus-")),
    ).toBe(false);
  });

  it("a 3-tile layout lists both non-focused kinds", () => {
    const actions = build(
      { shape: "main-left", order: ["tty", "code", "web"] },
      { focusedKind: "code", onFocus: vi.fn() },
    ).map((a) => a.id);
    expect(actions).toContain("layout-focus-tty");
    expect(actions).toContain("layout-focus-web");
    expect(actions).not.toContain("layout-focus-code");
  });
});
