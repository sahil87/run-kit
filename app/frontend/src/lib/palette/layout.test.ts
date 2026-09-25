import { describe, it, expect, vi } from "vitest";
import { buildLayoutActions, buildTileSwitchActions } from "./layout";
import { leaves, type Layout, type Rect, type SurfaceKind } from "../surface-layout";

/**
 * `buildLayoutActions` — the palette's `Tile:`/`Layout:` entries per layout
 * state. Pure-builder tests in the `palette/view.test.ts` pattern.
 * `buildTileSwitchActions` — the mobile `Tile: Switch to <Surface>` entries
 * (the top-bar switch group's palette twin).
 */

const ALL: SurfaceKind[] = ["tty", "web", "code"];

const SINGLE_TTY: Layout = { leaf: "tty" };
const SPLIT_H_TTY_CODE: Layout = {
  dir: "h",
  children: [{ leaf: "tty" }, { leaf: "code" }],
};
/** h(tty,v(code,web)) — main-left with tty main, code over web right. */
const MAIN_LEFT: Layout = {
  dir: "h",
  children: [
    { leaf: "tty" },
    { dir: "v", children: [{ leaf: "code" }, { leaf: "web" }] },
  ],
};

/** Rects for MAIN_LEFT: tty full-height left, code top-right, web
 *  bottom-right. */
const MAIN_LEFT_RECTS = new Map<string, Rect>([
  ["tty", { x: 0, y: 0, w: 800, h: 1000 }],
  ["code", { x: 806, y: 0, w: 794, h: 497 }],
  ["web", { x: 806, y: 503, w: 794, h: 497 }],
]);

function build(
  layout: Layout,
  overrides: Partial<Parameters<typeof buildLayoutActions>[2]> = {},
  available: SurfaceKind[] = ALL,
) {
  return buildLayoutActions(layout, available, {
    zoomed: false,
    zoomEnabled: leaves(layout).length > 1,
    onApply: vi.fn(),
    onZoomToggle: vi.fn(),
    onApplyTemplate: vi.fn(),
    onCycleTemplate: vi.fn(),
    onPromoteLeaf: vi.fn(),
    onSwapDirection: vi.fn(),
    focusedLeafId: undefined,
    leafRects: undefined,
    ...overrides,
  });
}

const ids = (layout: Layout, available: SurfaceKind[] = ALL) =>
  build(layout, {}, available).map((a) => a.id);

describe("buildLayoutActions — shows/hides", () => {
  it("a single tty offers a Show per available non-open surface and NO hides/verbs", () => {
    const actions = ids(SINGLE_TTY);
    expect(actions).toContain("tile-show-web");
    expect(actions).toContain("tile-show-code");
    expect(actions).not.toContain("tile-show-tty"); // already open
    // single: no hides (the last tile never hides), no promote/swaps, no
    // template jumps, no cycle (the ring is empty at one tile).
    expect(actions.some((id) => id.startsWith("tile-hide-"))).toBe(false);
    expect(actions.some((id) => id.startsWith("layout-promote-"))).toBe(false);
    expect(actions.some((id) => id.startsWith("tile-swap-"))).toBe(false);
    expect(actions.some((id) => id.startsWith("layout-template-"))).toBe(false);
    expect(actions).not.toContain("layout-cycle");
  });

  it("show runs addSurface through onApply (1→2 splits the last leaf)", () => {
    const onApply = vi.fn();
    const actions = build(SINGLE_TTY, { onApply });
    actions.find((a) => a.id === "tile-show-code")!.onSelect();
    expect(onApply).toHaveBeenCalledWith(SPLIT_H_TTY_CODE);
  });

  it("at 3 tiles no Show entries are offered (max — the rail disables instead)", () => {
    const actions = ids(MAIN_LEFT);
    expect(actions.some((id) => id.startsWith("tile-show-"))).toBe(false);
    expect(actions).toContain("tile-hide-web");
  });

  it("hide runs closeSurface through onApply (3→2 keeps the h structure)", () => {
    const onApply = vi.fn();
    const actions = build(MAIN_LEFT, { onApply });
    actions.find((a) => a.id === "tile-hide-web")!.onSelect();
    expect(onApply).toHaveBeenCalledWith(SPLIT_H_TTY_CODE);
  });

  it("offers Tile: Show Web on a URL-less window — web is always available", () => {
    // The URL-less window's availableTiles is ["tty","web"]; Show Web opens
    // the onboarding tile.
    const actions = ids(SINGLE_TTY, ["tty", "web"]);
    expect(actions).toContain("tile-show-web");
    expect(actions).not.toContain("tile-show-code");
  });

  it("an unavailable surface gets no Show entry", () => {
    const actions = ids(SINGLE_TTY, ["tty", "web"]);
    expect(actions).toContain("tile-show-web");
    expect(actions).not.toContain("tile-show-code");
  });

  it("Show/Hide labels carry the Tile: prefix; arrangement verbs keep Layout:", () => {
    const actions = build(SPLIT_H_TTY_CODE);
    expect(actions.find((a) => a.id === "tile-hide-code")?.label).toBe("Tile: Hide Code");
    expect(actions.find((a) => a.id === "layout-promote-code")?.label).toBe(
      "Layout: Promote Code",
    );
    expect(actions.some((a) => a.label.startsWith("Layout: Add"))).toBe(false);
    expect(actions.some((a) => a.label.startsWith("Layout: Close"))).toBe(false);
    expect(actions.some((a) => a.label.startsWith("Layout: Focus"))).toBe(false);
  });
});

describe("buildLayoutActions — tile expand", () => {
  it("offers Expand when enabled and unzoomed, Restore when zoomed — never both", () => {
    expect(ids(SPLIT_H_TTY_CODE)).toContain("layout-zoom");
    expect(ids(SPLIT_H_TTY_CODE)).not.toContain("layout-unzoom");
    const zoomed = build(SPLIT_H_TTY_CODE, { zoomed: true }).map((a) => a.id);
    expect(zoomed).toContain("layout-unzoom");
    expect(zoomed).not.toContain("layout-zoom");
  });

  it("zoom entries are gated on zoomEnabled (single/mobile)", () => {
    expect(ids(SINGLE_TTY)).not.toContain("layout-zoom");
    const mobile = build(SPLIT_H_TTY_CODE, { zoomEnabled: false }).map((a) => a.id);
    expect(mobile).not.toContain("layout-zoom");
  });

  it("the zoom entry fires the toggle seam, not onApply (transient)", () => {
    const onApply = vi.fn();
    const onZoomToggle = vi.fn();
    const actions = build(SPLIT_H_TTY_CODE, { onApply, onZoomToggle });
    actions.find((a) => a.id === "layout-zoom")!.onSelect();
    expect(onZoomToggle).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe("buildLayoutActions — promote", () => {
  it("promote is offered per open kind EXCEPT slot A; no per-kind swap rows remain", () => {
    const actions = ids(MAIN_LEFT);
    expect(actions).not.toContain("layout-promote-tty"); // slot A — a no-op
    expect(actions).toContain("layout-promote-code");
    expect(actions).toContain("layout-promote-web");
    expect(actions.some((id) => id.startsWith("layout-swap-"))).toBe(false);
  });

  it("slot A follows the template's main tile, not reading order", () => {
    // h(v(code,web),tty) — main-right: slot A is tty, the RIGHT tile.
    const mainRight: Layout = {
      dir: "h",
      children: [
        { dir: "v", children: [{ leaf: "code" }, { leaf: "web" }] },
        { leaf: "tty" },
      ],
    };
    const actions = ids(mainRight);
    expect(actions).not.toContain("layout-promote-tty");
    expect(actions).toContain("layout-promote-code");
    expect(actions).toContain("layout-promote-web");
  });

  it("promote fires onPromoteLeaf with the leaf id, never onApply", () => {
    const onApply = vi.fn();
    const onPromoteLeaf = vi.fn();
    const actions = build(SPLIT_H_TTY_CODE, { onApply, onPromoteLeaf });
    actions.find((a) => a.id === "layout-promote-code")!.onSelect();
    expect(onPromoteLeaf).toHaveBeenCalledWith("code");
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe("buildLayoutActions — directional swaps", () => {
  const swapOpts = (focusedLeafId: string) => ({
    focusedLeafId,
    leafRects: () => MAIN_LEFT_RECTS,
  });

  it("h(tty,v(code,web)) with web focused lists Swap Left and Swap Up only", () => {
    const actions = build(MAIN_LEFT, swapOpts("web")).map((a) => a.id);
    // web is bottom-right: left overlaps the full-height tty, up overlaps
    // code; nothing lies right or below.
    expect(actions).toContain("tile-swap-left");
    expect(actions).toContain("tile-swap-up");
    expect(actions).not.toContain("tile-swap-right");
    expect(actions).not.toContain("tile-swap-down");
  });

  it("labels read `Tile: Swap <Direction>` and fire onSwapDirection", () => {
    const onSwapDirection = vi.fn();
    const onApply = vi.fn();
    const actions = build(MAIN_LEFT, { ...swapOpts("web"), onSwapDirection, onApply });
    const left = actions.find((a) => a.id === "tile-swap-left")!;
    expect(left.label).toBe("Tile: Swap Left");
    left.onSelect();
    expect(onSwapDirection).toHaveBeenCalledWith("left");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("a two-tile row offers only the inward direction", () => {
    const rects = new Map<string, Rect>([
      ["tty", { x: 0, y: 0, w: 800, h: 1000 }],
      ["code", { x: 806, y: 0, w: 794, h: 1000 }],
    ]);
    const actions = build(SPLIT_H_TTY_CODE, {
      focusedLeafId: "code",
      leafRects: () => rects,
    }).map((a) => a.id);
    expect(actions).toContain("tile-swap-left");
    expect(actions).not.toContain("tile-swap-right");
    expect(actions).not.toContain("tile-swap-up");
    expect(actions).not.toContain("tile-swap-down");
  });

  it("no directional rows without leafRects (mobile), focusedLeafId, or at one tile", () => {
    expect(
      build(MAIN_LEFT, { focusedLeafId: "web" }).some((a) =>
        a.id.startsWith("tile-swap-"),
      ),
    ).toBe(false);
    expect(
      build(MAIN_LEFT, { leafRects: () => MAIN_LEFT_RECTS }).some((a) =>
        a.id.startsWith("tile-swap-"),
      ),
    ).toBe(false);
    expect(
      build(SINGLE_TTY, swapOpts("tty")).some((a) => a.id.startsWith("tile-swap-")),
    ).toBe(false);
  });
});

describe("buildLayoutActions — templates", () => {
  it("at 2 tiles the template rows are Row and Column only", () => {
    const actions = ids(SPLIT_H_TTY_CODE);
    expect(actions).toContain("layout-template-row");
    expect(actions).toContain("layout-template-col");
    expect(actions).not.toContain("layout-template-main-left");
    expect(actions).not.toContain("layout-template-grid");
  });

  it("at 3 tiles the six structurally distinct templates are listed", () => {
    const actions = ids(MAIN_LEFT);
    for (const name of ["row", "col", "main-left", "main-right", "main-top", "main-bottom"]) {
      expect(actions).toContain(`layout-template-${name}`);
    }
    expect(actions).not.toContain("layout-template-grid");
  });

  it("a template row carries the template label and fires onApplyTemplate", () => {
    const onApplyTemplate = vi.fn();
    const onApply = vi.fn();
    const actions = build(MAIN_LEFT, { onApplyTemplate, onApply });
    const jump = actions.find((a) => a.id === "layout-template-main-right")!;
    expect(jump.label).toBe("Layout: Main Right");
    jump.onSelect();
    expect(onApplyTemplate).toHaveBeenCalledWith("main-right");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("`Layout: Cycle Template` carries the registry actionId and fires onCycleTemplate", () => {
    const onCycleTemplate = vi.fn();
    const onApply = vi.fn();
    const actions = build(MAIN_LEFT, { onCycleTemplate, onApply });
    const cycle = actions.find((a) => a.id === "layout-cycle")!;
    expect(cycle.label).toBe("Layout: Cycle Template");
    cycle.onSelect();
    expect(onCycleTemplate).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("a single tile offers no template rows and no cycle", () => {
    const actions = ids(SINGLE_TTY);
    expect(actions.some((id) => id.startsWith("layout-template-"))).toBe(false);
    expect(actions).not.toContain("layout-cycle");
  });
});

describe("buildLayoutActions — the toggle-chord hint (code-toggle documentation)", () => {
  it("stamps the toggle chord on the chord-target surface's Show/Hide entry", () => {
    // tty-only open: the target (code) is closed → its SHOW entry carries it.
    const added = build(SINGLE_TTY, { toggleTarget: "code", toggleShortcut: "⌘2" });
    expect(added.find((a) => a.id === "tile-show-code")?.shortcut).toBe("⌘2");
    expect(added.find((a) => a.id === "tile-show-web")?.shortcut).toBeUndefined();
    // Target open: its HIDE entry carries the hint instead.
    const closed = build(SPLIT_H_TTY_CODE, { toggleTarget: "code", toggleShortcut: "⌘2" });
    expect(closed.find((a) => a.id === "tile-hide-code")?.shortcut).toBe("⌘2");
  });

  it("omits the hint when the chord is disabled/unbound (empty shortcut)", () => {
    const actions = build(SINGLE_TTY, { toggleTarget: "code", toggleShortcut: "" });
    expect(actions.find((a) => a.id === "tile-show-code")?.shortcut).toBeUndefined();
  });
});

describe("buildLayoutActions — Tile: Focus <Surface>", () => {
  it("offers one Focus entry per open NON-focused kind (the focused one is omitted)", () => {
    const actions = build(SPLIT_H_TTY_CODE, {
      focusedKind: "tty",
      onFocus: vi.fn(),
    }).map((a) => a.id);
    expect(actions).toContain("tile-focus-code");
    expect(actions).not.toContain("tile-focus-tty"); // already focused
  });

  it("a Focus entry fires onFocus with the kind (the focusTileRef seam), never onApply", () => {
    const onApply = vi.fn();
    const onFocus = vi.fn();
    const actions = build(SPLIT_H_TTY_CODE, { onApply, focusedKind: "tty", onFocus });
    const entry = actions.find((a) => a.id === "tile-focus-code")!;
    expect(entry.label).toBe("Tile: Focus Code");
    entry.onSelect();
    expect(onFocus).toHaveBeenCalledWith("code");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("duplicate kinds yield ONE Focus entry (the seam focuses the first leaf)", () => {
    const twoTty: Layout = { dir: "h", children: [{ leaf: "tty" }, { leaf: "tty" }] };
    const actions = build(twoTty, { focusedKind: "code", onFocus: vi.fn() }, [
      "tty",
      "code",
    ]).map((a) => a.id);
    expect(actions.filter((id) => id === "tile-focus-tty")).toHaveLength(1);
  });

  it("hidden at one tile, without onFocus (mobile), and without focusedKind", () => {
    const onFocus = vi.fn();
    expect(
      build(SINGLE_TTY, { focusedKind: "tty", onFocus }).some((a) =>
        a.id.startsWith("tile-focus-"),
      ),
    ).toBe(false);
    expect(
      build(SPLIT_H_TTY_CODE, { focusedKind: "tty" }).some((a) =>
        a.id.startsWith("tile-focus-"),
      ),
    ).toBe(false);
    expect(
      build(SPLIT_H_TTY_CODE, { onFocus }).some((a) => a.id.startsWith("tile-focus-")),
    ).toBe(false);
  });

  it("a 3-tile layout lists both non-focused kinds", () => {
    const actions = build(MAIN_LEFT, { focusedKind: "code", onFocus: vi.fn() }).map(
      (a) => a.id,
    );
    expect(actions).toContain("tile-focus-tty");
    expect(actions).toContain("tile-focus-web");
    expect(actions).not.toContain("tile-focus-code");
  });
});

describe("buildTileSwitchActions — Tile: Switch to <Surface> (mobile)", () => {
  it("offers one entry per available, not-visible surface", () => {
    const actions = buildTileSwitchActions(ALL, "tty", vi.fn());
    expect(actions.map((a) => a.id)).toEqual(["tile-switch-web", "tile-switch-code"]);
  });

  it("labels read `Tile: Switch to <Surface>` and fire onSwitch with the kind", () => {
    const onSwitch = vi.fn();
    const actions = buildTileSwitchActions(["tty", "web"], "tty", onSwitch);
    const entry = actions.find((a) => a.id === "tile-switch-web")!;
    expect(entry.label).toBe("Tile: Switch to Web");
    entry.onSelect();
    expect(onSwitch).toHaveBeenCalledWith("web");
  });

  it("a single-surface window yields no entries (nothing to switch to)", () => {
    expect(buildTileSwitchActions(["tty"], "tty", vi.fn())).toEqual([]);
  });

  it("excludes the visible surface from the destination list", () => {
    const actions = buildTileSwitchActions(["tty", "web", "code"], "web", vi.fn());
    expect(actions.map((a) => a.id)).toEqual(["tile-switch-tty", "tile-switch-code"]);
  });
});
