import { describe, it, expect, beforeEach } from "vitest";
import {
  ALL_SHAPES,
  SHAPE_ARITY,
  SURFACE_RAIL_HIDDEN,
  addSurface,
  availableTiles,
  closeSurface,
  cycleShape,
  degradeLayout,
  hintLayout,
  layoutStorageKey,
  parseLayout,
  promote,
  ratiosStorageKey,
  readStoredLayout,
  readStoredRatios,
  resolveLayout,
  seedLayoutFromLegacy,
  serializeLayout,
  setShape,
  shapesForArity,
  swapWithNext,
  translateLegacyParams,
  writeStoredLayout,
  writeStoredRatios,
  type Layout,
} from "./surface-layout";
import type { ViewWindow } from "./window-view";

const plain: ViewWindow = {};
const webWin: ViewWindow = { rkUrl: "http://localhost:8080" };
const iframeWin: ViewWindow = { rkType: "iframe", rkUrl: "http://localhost:8080" };
const fullWin: ViewWindow = {
  rkUrl: "http://localhost:8080",
  chatProvider: "claude",
  gitRoot: "/repo",
};

describe("parseLayout / serializeLayout", () => {
  it("round-trips every shape byte-identically", () => {
    const samples = [
      "single:tty",
      "split-h:tty,code",
      "split-v:tty,web",
      "row:tty,code,web",
      "col:tty,web,chat",
      "main-left:tty,code,web",
      "main-right:web,tty,code",
      "main-top:chat,tty,tty",
    ];
    for (const s of samples) {
      const parsed = parseLayout(s);
      expect(parsed).not.toBeNull();
      expect(serializeLayout(parsed!)).toBe(s);
    }
  });

  it("parses main-left:tty,code,web into shape + order", () => {
    expect(parseLayout("main-left:tty,code,web")).toEqual({
      shape: "main-left",
      order: ["tty", "code", "web"],
    });
  });

  it("rejects unknown shapes and unknown surfaces", () => {
    expect(parseLayout("grid:tty,code")).toBeNull();
    expect(parseLayout("single:terminal")).toBeNull();
    expect(parseLayout("single:")).toBeNull();
    expect(parseLayout("tty")).toBeNull();
    expect(parseLayout("")).toBeNull();
    expect(parseLayout(undefined)).toBeNull();
    expect(parseLayout(null)).toBeNull();
  });

  it("rejects arity mismatches", () => {
    expect(parseLayout("main-left:tty,code")).toBeNull();
    expect(parseLayout("single:tty,code")).toBeNull();
    expect(parseLayout("split-h:tty,code,web")).toBeNull();
  });

  it("rejects repeated non-tty kinds but allows duplicate tty tiles", () => {
    expect(parseLayout("row:tty,web,web")).toBeNull();
    expect(parseLayout("split-h:code,code")).toBeNull();
    expect(parseLayout("split-h:tty,tty")).toEqual({
      shape: "split-h",
      order: ["tty", "tty"],
    });
    expect(parseLayout("row:tty,code,tty")).not.toBeNull();
  });
});

describe("availableTiles", () => {
  it("always lists tty first, then web/chat/code per capability", () => {
    expect(availableTiles(plain)).toEqual(["tty"]);
    expect(availableTiles(webWin)).toEqual(["tty", "web"]);
    expect(availableTiles(fullWin)).toEqual(["tty", "web", "chat", "code"]);
    expect(availableTiles(null)).toEqual(["tty"]);
  });

  it("still lists chat for a chat-capable window — the rail demotion (SURFACE_RAIL_HIDDEN) filters at RENDER, not at availability", () => {
    // 260812-0c6o: chat is palette-only. `availableTiles` deliberately keeps
    // chat so the palette's `Layout: Add Chat` / `Layout: Close Chat` entries
    // keep working as chat's entry points.
    expect(availableTiles(fullWin)).toContain("chat");
    expect(SURFACE_RAIL_HIDDEN.has("chat")).toBe(true);
    expect(SURFACE_RAIL_HIDDEN.has("tty")).toBe(false);
    expect(SURFACE_RAIL_HIDDEN.has("web")).toBe(false);
    expect(SURFACE_RAIL_HIDDEN.has("code")).toBe(false);
  });
});

describe("degradeLayout", () => {
  it("keeps an already-available layout untouched", () => {
    const layout: Layout = { shape: "main-left", order: ["tty", "code", "web"] };
    expect(degradeLayout(layout, fullWin)).toEqual(layout);
  });

  it("drops an unavailable surface 3→2 as split-h, preserving order with slot A kept", () => {
    const layout: Layout = { shape: "main-left", order: ["tty", "code", "web"] };
    // No gitRoot → code unavailable; rkUrl present → web stays.
    expect(degradeLayout(layout, webWin)).toEqual({
      shape: "split-h",
      order: ["tty", "web"],
    });
  });

  it("drops unavailable surfaces 3→2→1 down to single", () => {
    const layout: Layout = { shape: "row", order: ["web", "chat", "code"] };
    expect(degradeLayout(layout, webWin)).toEqual({ shape: "single", order: ["web"] });
  });

  it("returns null when nothing is available (fully invalid → next ladder rung)", () => {
    const layout: Layout = { shape: "single", order: ["web"] };
    expect(degradeLayout(layout, plain)).toBeNull();
  });

  it("keeps slot A even when a later tile drops", () => {
    const layout: Layout = { shape: "main-left", order: ["code", "tty", "web"] };
    // code unavailable (no gitRoot) — slot A drops, first AVAILABLE stays first.
    expect(degradeLayout(layout, webWin)).toEqual({
      shape: "split-h",
      order: ["tty", "web"],
    });
  });
});

describe("hintLayout", () => {
  it("yields single:web for a legacy @rk_type=iframe window, single:tty otherwise", () => {
    expect(hintLayout(iframeWin)).toEqual({ shape: "single", order: ["web"] });
    expect(hintLayout(plain)).toEqual({ shape: "single", order: ["tty"] });
    expect(hintLayout(webWin)).toEqual({ shape: "single", order: ["tty"] });
  });
});

describe("translateLegacyParams", () => {
  it("maps ?view=X to single:X", () => {
    expect(translateLegacyParams("code", undefined)).toBe("single:code");
  });

  it("maps ?view=X&panel=Y to split-h:X,Y (X in slot A)", () => {
    expect(translateLegacyParams("code", "web")).toBe("split-h:code,web");
  });

  it("maps a bare ?panel=Y against the tty default main slot", () => {
    expect(translateLegacyParams(undefined, "web")).toBe("split-h:tty,web");
  });

  it("returns undefined when neither legacy param is present", () => {
    expect(translateLegacyParams(undefined, undefined)).toBeUndefined();
  });
});

describe("resolveLayout", () => {
  it("prefers a valid URL layout over storage and the hint", () => {
    expect(resolveLayout("split-h:tty,web", "single:web", iframeWin)).toEqual({
      shape: "split-h",
      order: ["tty", "web"],
    });
  });

  it("falls to stored when the URL value is absent or malformed", () => {
    expect(resolveLayout(undefined, "single:web", iframeWin)).toEqual({
      shape: "single",
      order: ["web"],
    });
    expect(resolveLayout("grid:tty", "single:web", iframeWin)).toEqual({
      shape: "single",
      order: ["web"],
    });
  });

  it("falls through a fully-invalid URL value to the next rung", () => {
    // web unavailable on a plain window — the URL value degrades to nothing.
    expect(resolveLayout("single:web", undefined, plain)).toEqual({
      shape: "single",
      order: ["tty"],
    });
  });

  it("degrades a partially-available URL value tile-by-tile in place", () => {
    expect(resolveLayout("main-left:tty,code,web", undefined, webWin)).toEqual({
      shape: "split-h",
      order: ["tty", "web"],
    });
  });

  it("uses the hint rung when URL and storage are silent", () => {
    expect(resolveLayout(undefined, undefined, iframeWin)).toEqual({
      shape: "single",
      order: ["web"],
    });
    expect(resolveLayout(undefined, undefined, plain)).toEqual({
      shape: "single",
      order: ["tty"],
    });
  });
});

describe("storage keys + read/write", () => {
  beforeEach(() => localStorage.clear());

  it("uses rk-layout:{server}:{windowId} and rk-layout-ratios:{server}:{windowId}:{shape}", () => {
    expect(layoutStorageKey("s", "@1")).toBe("rk-layout:s:@1");
    expect(ratiosStorageKey("s", "@1", "split-h")).toBe("rk-layout-ratios:s:@1:split-h");
  });

  it("round-trips a stored layout string", () => {
    writeStoredLayout("s", "@1", { shape: "split-h", order: ["tty", "code"] });
    expect(readStoredLayout("s", "@1")).toBe("split-h:tty,code");
    expect(readStoredLayout("s", "@2")).toBeUndefined();
  });

  it("round-trips ratios; rejects garbage", () => {
    writeStoredRatios("s", "@1", "split-h", [62]);
    expect(readStoredRatios("s", "@1", "split-h")).toEqual([62]);
    expect(readStoredRatios("s", "@1", "main-left")).toBeUndefined();

    localStorage.setItem("rk-layout-ratios:s:@1:row", "not-json");
    expect(readStoredRatios("s", "@1", "row")).toBeUndefined();
    localStorage.setItem("rk-layout-ratios:s:@1:row", "[0,-5]");
    expect(readStoredRatios("s", "@1", "row")).toBeUndefined();
    localStorage.setItem("rk-layout-ratios:s:@1:row", "[]");
    expect(readStoredRatios("s", "@1", "row")).toBeUndefined();
  });
});

describe("seedLayoutFromLegacy", () => {
  beforeEach(() => localStorage.clear());

  it("seeds rk-layout from legacy view + panel keys when no layout key exists", () => {
    localStorage.setItem("runkit-window-view:s:@1", "code");
    localStorage.setItem("runkit-window-panel:s:@1", "web");
    seedLayoutFromLegacy("s", "@1");
    expect(localStorage.getItem("rk-layout:s:@1")).toBe("split-h:code,web");
    // Legacy keys are left in place (other tabs may run older code).
    expect(localStorage.getItem("runkit-window-view:s:@1")).toBe("code");
  });

  it("seeds a single-tile layout from a legacy view key alone", () => {
    localStorage.setItem("runkit-window-view:s:@1", "web");
    seedLayoutFromLegacy("s", "@1");
    expect(localStorage.getItem("rk-layout:s:@1")).toBe("single:web");
  });

  it("does not overwrite an existing layout key", () => {
    localStorage.setItem("rk-layout:s:@1", "row:tty,code,web");
    localStorage.setItem("runkit-window-view:s:@1", "code");
    seedLayoutFromLegacy("s", "@1");
    expect(localStorage.getItem("rk-layout:s:@1")).toBe("row:tty,code,web");
  });

  it("no-ops without legacy keys or with a malformed seed", () => {
    seedLayoutFromLegacy("s", "@1");
    expect(localStorage.getItem("rk-layout:s:@1")).toBeNull();
    localStorage.setItem("runkit-window-view:s:@1", "nonsense");
    seedLayoutFromLegacy("s", "@1");
    expect(localStorage.getItem("rk-layout:s:@1")).toBeNull();
  });
});

describe("mutations", () => {
  const three: Layout = { shape: "main-left", order: ["tty", "code", "web"] };
  const two: Layout = { shape: "split-h", order: ["tty", "code"] };
  const one: Layout = { shape: "single", order: ["tty"] };

  it("promote moves a surface to slot A, shape unchanged", () => {
    expect(promote(three, "code")).toEqual({
      shape: "main-left",
      order: ["code", "tty", "web"],
    });
    expect(promote(three, "tty")).toEqual(three); // already slot A
    expect(promote(three, "chat")).toEqual(three); // absent
  });

  it("swapWithNext exchanges with the next neighbor, wrapping at the end", () => {
    expect(swapWithNext(three, "tty")).toEqual({
      shape: "main-left",
      order: ["code", "tty", "web"],
    });
    expect(swapWithNext(three, "web")).toEqual({
      shape: "main-left",
      order: ["web", "code", "tty"],
    });
    expect(swapWithNext(one, "tty")).toEqual(one); // single never swaps
  });

  it("closeSurface collapses arity preserving remaining order; single refuses", () => {
    expect(closeSurface(three, "code")).toEqual({
      shape: "split-h",
      order: ["tty", "web"],
    });
    expect(closeSurface(two, "tty")).toEqual({ shape: "single", order: ["code"] });
    expect(closeSurface(one, "tty")).toBeNull();
    expect(closeSurface(two, "web")).toBeNull(); // absent
  });

  it("addSurface grows 1→2 as split-h and 2→3 as main-left", () => {
    expect(addSurface(one, "code")).toEqual({ shape: "split-h", order: ["tty", "code"] });
    expect(addSurface(two, "web")).toEqual({
      shape: "main-left",
      order: ["tty", "code", "web"],
    });
  });

  it("addSurface refuses at 3 tiles and on repeated non-tty kinds", () => {
    expect(addSurface(three, "chat")).toBeNull();
    expect(addSurface(two, "code")).toBeNull();
    // duplicate tty is legal (muxed relay supports N clients)
    expect(addSurface(two, "tty")).toEqual({
      shape: "main-left",
      order: ["tty", "code", "tty"],
    });
  });

  it("cycleShape walks the same-arity ring keeping order", () => {
    expect(cycleShape(three)).toEqual({ shape: "main-right", order: three.order });
    expect(cycleShape({ shape: "main-right", order: three.order })).toEqual({
      shape: "main-top",
      order: three.order,
    });
    expect(cycleShape({ shape: "main-top", order: three.order })).toEqual({
      shape: "row",
      order: three.order,
    });
    expect(cycleShape(two)).toEqual({ shape: "split-v", order: two.order });
    expect(cycleShape(one)).toEqual(one);
  });

  it("setShape jumps within the arity only", () => {
    expect(setShape(three, "col")).toEqual({ shape: "col", order: three.order });
    expect(setShape(three, "split-h")).toBeNull();
    expect(setShape(two, "single")).toBeNull();
  });

  it("shapesForArity matches the arity table", () => {
    expect(shapesForArity(1)).toEqual(["single"]);
    expect(shapesForArity(2)).toEqual(["split-h", "split-v"]);
    expect(shapesForArity(3)).toHaveLength(5);
    for (const shape of ALL_SHAPES) {
      expect(shapesForArity(SHAPE_ARITY[shape])).toContain(shape);
    }
  });
});
