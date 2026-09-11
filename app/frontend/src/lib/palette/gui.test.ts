import { describe, it, expect, vi } from "vitest";
import { buildGuiActions, type GuiPaletteInput } from "./gui";

function input(overrides: Partial<GuiPaletteInput> = {}): GuiPaletteInput {
  return {
    enabled: true,
    reachable: true,
    backend: "Xtigervnc",
    tileOpen: true,
    connected: true,
    coarsePointer: false,
    zoom: "fit",
    pointerMode: "touch",
    resizeLocked: false,
    quality: "balanced",
    statsVisible: false,
    geometry: "auto",
    supervisorAvailable: true,
    onTurnOn: vi.fn(),
    onTurnOff: vi.fn(),
    loadDesktopRows: vi.fn().mockResolvedValue([]),
    onLaunch: vi.fn(),
    onResize: vi.fn(),
    onResizeCustom: vi.fn(),
    onMatchTile: vi.fn(),
    onFullscreen: vi.fn(),
    onPaste: vi.fn(),
    onZoom: vi.fn(),
    onPointerMode: vi.fn(),
    onLockChange: vi.fn(),
    onQuality: vi.fn(),
    onStatsVisible: vi.fn(),
    onHidpiChange: vi.fn(),
    onKeyBarVisibleChange: vi.fn(),
    onSendKey: vi.fn(),
    hidpi: false,
    keyBarVisible: true,
    onOpenLogs: vi.fn(),
    onReconnect: vi.fn(),
    ...overrides,
  };
}

const ids = (inp: GuiPaletteInput) => buildGuiActions(inp).map((a) => a.id);

describe("buildGuiActions — switch gating", () => {
  it("offers only GUI: Turn on when the switch is off", () => {
    expect(ids(input({ enabled: false, tileOpen: false }))).toEqual(["gui-turn-on"]);
  });

  it("offers GUI: Turn off (never Turn on) when the switch is on", () => {
    const list = ids(input());
    expect(list).toContain("gui-turn-off");
    expect(list).not.toContain("gui-turn-on");
  });

  it("Turn on / Turn off route to their bodies", () => {
    const off = input({ enabled: false, tileOpen: false });
    buildGuiActions(off)[0].onSelect();
    expect(off.onTurnOn).toHaveBeenCalledOnce();

    const on = input();
    buildGuiActions(on).find((a) => a.id === "gui-turn-off")!.onSelect();
    expect(on.onTurnOff).toHaveBeenCalledOnce();
  });
});

describe("buildGuiActions — tile-open gating", () => {
  it("omits the tile verbs when no gui tile is open", () => {
    const list = ids(input({ tileOpen: false }));
    expect(list).toEqual([
      "gui-turn-off",
      "gui-desktop",
      "gui-open-terminal",
      "gui-open-browser",
      "gui-res-1280x720",
      "gui-res-1600x900",
      "gui-res-1920x1080",
      "gui-res-2560x1440",
      "gui-res-1080x1920",
      "gui-res-custom",
      "gui-quality-sharp",
      "gui-quality-balanced",
      "gui-quality-smooth",
      "gui-logs",
    ]);
  });

  it("the R8 worked example: on + open + connected + fine + fit + unlocked", () => {
    expect(ids(input())).toEqual([
      "gui-turn-off",
      "gui-desktop",
      "gui-open-terminal",
      "gui-open-browser",
      "gui-res-1280x720",
      "gui-res-1600x900",
      "gui-res-1920x1080",
      "gui-res-2560x1440",
      "gui-res-1080x1920",
      "gui-res-match",
      "gui-res-custom",
      "gui-quality-sharp",
      "gui-quality-balanced",
      "gui-quality-smooth",
      "gui-fullscreen",
      "gui-paste",
      "gui-send-key",
      "gui-hidpi-on",
      "gui-zoom-in",
      "gui-view-1to1",
      "gui-lock",
      "gui-stats-show",
      "gui-logs",
    ]);
  });
});

describe("buildGuiActions — the desktop picker row", () => {
  it("sits right after GUI: Turn off, before the launch rows, when enabled", () => {
    const list = ids(input());
    expect(list.indexOf("gui-desktop")).toBe(list.indexOf("gui-turn-off") + 1);
    expect(list.indexOf("gui-desktop")).toBeLessThan(list.indexOf("gui-open-terminal"));

    const closed = ids(input({ tileOpen: false }));
    expect(closed.indexOf("gui-desktop")).toBe(closed.indexOf("gui-turn-off") + 1);
  });

  it("exists whenever the switch is on — even unreachable", () => {
    expect(ids(input({ reachable: false }))).toContain("gui-desktop");
  });

  it("is absent when the switch is off", () => {
    expect(ids(input({ enabled: false }))).not.toContain("gui-desktop");
  });

  it("carries the lazy sub-list over the caller's loader", () => {
    const inp = input();
    const row = buildGuiActions(inp).find((a) => a.id === "gui-desktop")!;
    expect(row.label).toBe("GUI: Desktop…");
    expect(row.subList?.placeholder).toBe("Pick a desktop — Enter select · Esc cancel");
    expect(row.subList?.rows).toBe(inp.loadDesktopRows);
  });
});

describe("buildGuiActions — launch rows", () => {
  it("sits right after the desktop picker, before the tile-open verbs, regardless of tileOpen", () => {
    const open = ids(input({ tileOpen: true }));
    expect(open.indexOf("gui-open-terminal")).toBe(open.indexOf("gui-desktop") + 1);
    expect(open.indexOf("gui-open-browser")).toBe(open.indexOf("gui-open-terminal") + 1);
    expect(open.indexOf("gui-open-browser")).toBeLessThan(open.indexOf("gui-fullscreen"));

    const closed = ids(input({ tileOpen: false }));
    expect(closed.indexOf("gui-open-terminal")).toBe(closed.indexOf("gui-desktop") + 1);
  });

  it("omits both rows when unreachable", () => {
    const list = ids(input({ reachable: false }));
    expect(list).not.toContain("gui-open-terminal");
    expect(list).not.toContain("gui-open-browser");
  });

  it("omits both rows on the screen-sharing mirror (no display to launch into)", () => {
    const list = ids(input({ backend: "screen-sharing" }));
    expect(list).not.toContain("gui-open-terminal");
    expect(list).not.toContain("gui-open-browser");
  });

  it("omits both rows when the switch is off", () => {
    const list = ids(input({ enabled: false }));
    expect(list).not.toContain("gui-open-terminal");
    expect(list).not.toContain("gui-open-browser");
  });

  it("onSelect routes the role to onLaunch", () => {
    const inp = input();
    const actions = buildGuiActions(inp);
    actions.find((a) => a.id === "gui-open-terminal")!.onSelect();
    expect(inp.onLaunch).toHaveBeenCalledWith("terminal");
    actions.find((a) => a.id === "gui-open-browser")!.onSelect();
    expect(inp.onLaunch).toHaveBeenCalledWith("browser");
    expect(inp.onLaunch).toHaveBeenCalledTimes(2);
  });
});

describe("buildGuiActions — connection gating", () => {
  it("a disconnected open tile swaps Paste for Reconnect", () => {
    const list = ids(input({ connected: false }));
    expect(list).not.toContain("gui-paste");
    expect(list).toContain("gui-reconnect");
  });

  it("Reconnect routes to its body", () => {
    const inp = input({ connected: false });
    buildGuiActions(inp).find((a) => a.id === "gui-reconnect")!.onSelect();
    expect(inp.onReconnect).toHaveBeenCalledOnce();
  });
});

describe("buildGuiActions — zoom and pointer rows", () => {
  it("zoom fit + fine pointer: Zoom in and 1:1 show; Zoom out, Zoom to fit, and both pointer rows hide", () => {
    const list = ids(input({ zoom: "fit" }));
    expect(list).toContain("gui-zoom-in");
    expect(list).toContain("gui-view-1to1");
    expect(list).not.toContain("gui-zoom-out");
    expect(list).not.toContain("gui-zoom-fit");
    expect(list).not.toContain("gui-pointer-trackpad");
    expect(list).not.toContain("gui-pointer-touch");
  });

  it("zoom 200 + coarse pointer in trackpad: Zoom out, Zoom to fit, 1:1, and Pointer → Touch show; Zoom in and Pointer → Trackpad hide", () => {
    const list = ids(input({ zoom: 200, coarsePointer: true, pointerMode: "trackpad" }));
    expect(list).toContain("gui-zoom-out");
    expect(list).toContain("gui-zoom-fit");
    expect(list).toContain("gui-view-1to1");
    expect(list).toContain("gui-pointer-touch");
    expect(list).not.toContain("gui-zoom-in");
    expect(list).not.toContain("gui-pointer-trackpad");
  });

  it("GUI: 1:1 is the 100% alias — onSelect calls onZoom(100) and the row hides at zoom 100", () => {
    const inp = input({ zoom: "fit" });
    const row = buildGuiActions(inp).find((a) => a.id === "gui-view-1to1")!;
    expect(row.description).toBe("100% — same as zoom");
    row.onSelect();
    expect(inp.onZoom).toHaveBeenCalledWith(100);

    expect(ids(input({ zoom: 100 }))).not.toContain("gui-view-1to1");
  });

  it("Zoom in / Zoom out step the ladder through onZoom", () => {
    const fit = input({ zoom: "fit" });
    buildGuiActions(fit).find((a) => a.id === "gui-zoom-in")!.onSelect();
    expect(fit.onZoom).toHaveBeenCalledWith(100);

    const zoomed = input({ zoom: 150 });
    buildGuiActions(zoomed).find((a) => a.id === "gui-zoom-in")!.onSelect();
    expect(zoomed.onZoom).toHaveBeenCalledWith(200);
    buildGuiActions(zoomed).find((a) => a.id === "gui-zoom-out")!.onSelect();
    expect(zoomed.onZoom).toHaveBeenCalledWith(125);

    const top = input({ zoom: 200 });
    buildGuiActions(top).find((a) => a.id === "gui-zoom-fit")!.onSelect();
    expect(top.onZoom).toHaveBeenCalledWith("fit");
  });

  it("the pointer pair is coarse-only and destination-only, routing the destination mode", () => {
    expect(ids(input({ coarsePointer: true, pointerMode: "touch" }))).toContain(
      "gui-pointer-trackpad",
    );
    expect(ids(input({ coarsePointer: true, pointerMode: "trackpad" }))).toContain(
      "gui-pointer-touch",
    );
    for (const fine of [input({ pointerMode: "touch" }), input({ pointerMode: "trackpad" })]) {
      expect(ids(fine)).not.toContain("gui-pointer-trackpad");
      expect(ids(fine)).not.toContain("gui-pointer-touch");
    }

    const touch = input({ coarsePointer: true, pointerMode: "touch" });
    const trackpadRow = buildGuiActions(touch).find((a) => a.id === "gui-pointer-trackpad")!;
    expect(trackpadRow.description).toBe(
      "one finger moves, tap clicks, two-finger tap right-clicks, two-finger drag scrolls",
    );
    trackpadRow.onSelect();
    expect(touch.onPointerMode).toHaveBeenCalledWith("trackpad");

    const trackpad = input({ coarsePointer: true, pointerMode: "trackpad" });
    const touchRow = buildGuiActions(trackpad).find((a) => a.id === "gui-pointer-touch")!;
    expect(touchRow.description).toBe("tap where you touch");
    touchRow.onSelect();
    expect(trackpad.onPointerMode).toHaveBeenCalledWith("touch");
  });

  it("the zoom and pointer rows are tileOpen-gated", () => {
    const list = ids(input({ tileOpen: false, coarsePointer: true }));
    expect(list).not.toContain("gui-zoom-in");
    expect(list).not.toContain("gui-view-1to1");
    expect(list).not.toContain("gui-pointer-trackpad");
    expect(list).not.toContain("gui-pointer-touch");
  });
});

describe("buildGuiActions — destination-only pairs", () => {
  it("shows Lock when unlocked and Unlock when locked, routing the target state", () => {
    const unlocked = input({ resizeLocked: false });
    expect(ids(unlocked)).toContain("gui-lock");
    expect(ids(unlocked)).not.toContain("gui-unlock");
    buildGuiActions(unlocked).find((a) => a.id === "gui-lock")!.onSelect();
    expect(unlocked.onLockChange).toHaveBeenCalledWith(true);

    const locked = input({ resizeLocked: true });
    expect(ids(locked)).toContain("gui-unlock");
    expect(ids(locked)).not.toContain("gui-lock");
    buildGuiActions(locked).find((a) => a.id === "gui-unlock")!.onSelect();
    expect(locked.onLockChange).toHaveBeenCalledWith(false);
  });

  it("omits the lock pair entirely on a coarse pointer", () => {
    const list = ids(input({ coarsePointer: true }));
    expect(list).not.toContain("gui-lock");
    expect(list).not.toContain("gui-unlock");
  });
});

describe("buildGuiActions — supervisor logs", () => {
  it("is enabled when the supervisor session resolves", () => {
    const inp = input();
    const row = buildGuiActions(inp).find((a) => a.id === "gui-logs")!;
    expect(row.disabled).toBeFalsy();
    row.onSelect();
    expect(inp.onOpenLogs).toHaveBeenCalledOnce();
  });

  it("renders disabled with the not-running reason when the supervisor is absent", () => {
    const row = buildGuiActions(input({ supervisorAvailable: false })).find(
      (a) => a.id === "gui-logs",
    )!;
    expect(row.disabled).toBe(true);
    expect(row.description).toBe("supervisor not running");
  });
});

describe("buildGuiActions — resolution rows", () => {
  it("the R12 worked example: fixed geometry orders the rows and pins the Lock row disabled", () => {
    const actions = buildGuiActions(input({ geometry: "1920x1080" }));
    expect(actions.map((a) => a.id)).toEqual([
      "gui-turn-off",
      "gui-desktop",
      "gui-open-terminal",
      "gui-open-browser",
      "gui-res-1280x720",
      "gui-res-1600x900",
      "gui-res-1920x1080",
      "gui-res-2560x1440",
      "gui-res-1080x1920",
      "gui-res-match",
      "gui-res-custom",
      "gui-res-auto",
      "gui-quality-sharp",
      "gui-quality-balanced",
      "gui-quality-smooth",
      "gui-fullscreen",
      "gui-paste",
      "gui-send-key",
      "gui-hidpi-on",
      "gui-zoom-in",
      "gui-view-1to1",
      "gui-lock",
      "gui-stats-show",
      "gui-logs",
    ]);
    expect(actions.find((a) => a.id === "gui-res-1920x1080")!.description).toBe("current");
    const lock = actions.find((a) => a.id === "gui-lock")!;
    expect(lock.disabled).toBe(true);
    expect(lock.description).toBe(
      "resolution is fixed (1920×1080) — pick Auto to follow the tile",
    );
  });

  it("renders one labeled row per preset, marking only the current one", () => {
    const actions = buildGuiActions(input({ geometry: "1280x720" }));
    expect(actions.find((a) => a.id === "gui-res-1280x720")!.label).toBe(
      "GUI: Resolution → 1280×720",
    );
    expect(actions.find((a) => a.id === "gui-res-1080x1920")!.label).toBe(
      "GUI: Resolution → 1080×1920 (portrait)",
    );
    expect(actions.find((a) => a.id === "gui-res-1280x720")!.description).toBe("current");
    expect(actions.find((a) => a.id === "gui-res-1600x900")!.description).toBeUndefined();
  });

  it("an empty geometry (a stream entry without the field) never pins the Lock row as fixed", () => {
    const lock = buildGuiActions(input({ geometry: "" })).find((a) => a.id === "gui-lock")!;
    expect(lock.disabled).toBeFalsy();
    expect(lock.description).toBeUndefined();
  });

  it("under auto the Auto row hides and the Lock row stays enabled with no description", () => {
    const actions = buildGuiActions(input({ geometry: "auto" }));
    expect(actions.some((a) => a.id === "gui-res-auto")).toBe(false);
    const lock = actions.find((a) => a.id === "gui-lock")!;
    expect(lock.disabled).toBeFalsy();
    expect(lock.description).toBeUndefined();
  });

  it("under a fixed geometry the Unlock row renders disabled with the same fixed copy", () => {
    const row = buildGuiActions(input({ geometry: "1600x900", resizeLocked: true })).find(
      (a) => a.id === "gui-unlock",
    )!;
    expect(row.disabled).toBe(true);
    expect(row.description).toBe(
      "resolution is fixed (1600×900) — pick Auto to follow the tile",
    );
  });

  it("Match this tile requires an open tile; presets, Custom…, and Auto remain", () => {
    const list = ids(input({ tileOpen: false, geometry: "1920x1080" }));
    expect(list).not.toContain("gui-res-match");
    expect(list).toContain("gui-res-1280x720");
    expect(list).toContain("gui-res-custom");
    expect(list).toContain("gui-res-auto");
  });

  it("no gui-res-* rows on the screen-sharing mirror or when unreachable", () => {
    for (const gated of [input({ backend: "screen-sharing" }), input({ reachable: false })]) {
      expect(ids(gated).some((id) => id.startsWith("gui-res-"))).toBe(false);
    }
  });

  it("no gui-res-* rows when the switch is off", () => {
    expect(ids(input({ enabled: false })).some((id) => id.startsWith("gui-res-"))).toBe(false);
  });

  it("onSelect routes: presets and Auto to onResize, Custom… to onResizeCustom, Match to onMatchTile", () => {
    const inp = input({ geometry: "1920x1080" });
    const actions = buildGuiActions(inp);
    actions.find((a) => a.id === "gui-res-1600x900")!.onSelect();
    expect(inp.onResize).toHaveBeenCalledWith("1600x900");
    actions.find((a) => a.id === "gui-res-auto")!.onSelect();
    expect(inp.onResize).toHaveBeenCalledWith("auto");
    expect(inp.onResize).toHaveBeenCalledTimes(2);
    actions.find((a) => a.id === "gui-res-custom")!.onSelect();
    expect(inp.onResizeCustom).toHaveBeenCalledOnce();
    actions.find((a) => a.id === "gui-res-match")!.onSelect();
    expect(inp.onMatchTile).toHaveBeenCalledOnce();
  });

  it("the Auto row carries the follow description", () => {
    const row = buildGuiActions(input({ geometry: "1920x1080" })).find(
      (a) => a.id === "gui-res-auto",
    )!;
    expect(row.label).toBe("GUI: Resolution → Auto (follow this tile)");
    expect(row.description).toBe(
      "today's behavior — the desktop follows the focused fine-pointer viewer",
    );
  });
});

describe("buildGuiActions — quality rows", () => {
  it("renders all three presets in Sharp/Balanced/Smooth order right after the Resolution rows, marking the current one", () => {
    const actions = buildGuiActions(input({ quality: "balanced" }));
    const qualityIds = actions.map((a) => a.id).filter((id) => id.startsWith("gui-quality-"));
    expect(qualityIds).toEqual(["gui-quality-sharp", "gui-quality-balanced", "gui-quality-smooth"]);
    const resIds = actions.map((a) => a.id).filter((id) => id.startsWith("gui-res-"));
    expect(actions.map((a) => a.id).indexOf("gui-quality-sharp")).toBe(
      actions.map((a) => a.id).indexOf(resIds[resIds.length - 1]) + 1,
    );
    expect(actions.find((a) => a.id === "gui-quality-sharp")!.description).toBe(
      "more detail, more bytes",
    );
    expect(actions.find((a) => a.id === "gui-quality-balanced")!.description).toBe(
      "default · current",
    );
    expect(actions.find((a) => a.id === "gui-quality-smooth")!.description).toBe(
      "fewer bytes, smoother motion on slow links",
    );
  });

  it("the current marker follows the quality posture", () => {
    const actions = buildGuiActions(input({ quality: "smooth" }));
    expect(actions.find((a) => a.id === "gui-quality-smooth")!.description).toBe(
      "fewer bytes, smoother motion on slow links · current",
    );
    expect(actions.find((a) => a.id === "gui-quality-balanced")!.description).toBe("default");
  });

  it("onSelect routes the preset to onQuality", () => {
    const inp = input();
    const actions = buildGuiActions(inp);
    actions.find((a) => a.id === "gui-quality-smooth")!.onSelect();
    expect(inp.onQuality).toHaveBeenCalledWith("smooth");
    actions.find((a) => a.id === "gui-quality-sharp")!.onSelect();
    expect(inp.onQuality).toHaveBeenCalledWith("sharp");
  });

  it("shares the launch rows' gate — absent on the screen-sharing mirror, when unreachable, and when off", () => {
    for (const gated of [
      input({ backend: "screen-sharing" }),
      input({ reachable: false }),
      input({ enabled: false }),
    ]) {
      expect(ids(gated).some((id) => id.startsWith("gui-quality-"))).toBe(false);
    }
  });
});

describe("buildGuiActions — stats rows", () => {
  it("is a destination-only pair routing the target visibility", () => {
    const hidden = input({ statsVisible: false });
    expect(ids(hidden)).toContain("gui-stats-show");
    expect(ids(hidden)).not.toContain("gui-stats-hide");
    buildGuiActions(hidden).find((a) => a.id === "gui-stats-show")!.onSelect();
    expect(hidden.onStatsVisible).toHaveBeenCalledWith(true);

    const shown = input({ statsVisible: true });
    expect(ids(shown)).toContain("gui-stats-hide");
    expect(ids(shown)).not.toContain("gui-stats-show");
    buildGuiActions(shown).find((a) => a.id === "gui-stats-hide")!.onSelect();
    expect(shown.onStatsVisible).toHaveBeenCalledWith(false);
  });

  it("is tileOpen-gated", () => {
    const list = ids(input({ tileOpen: false }));
    expect(list).not.toContain("gui-stats-show");
    expect(list).not.toContain("gui-stats-hide");
  });
});

describe("buildGuiActions — Send key row", () => {
  it("is gated on tile open AND connected (the paste gate)", () => {
    expect(ids(input())).toContain("gui-send-key");
    expect(ids(input({ tileOpen: false }))).not.toContain("gui-send-key");
    expect(ids(input({ connected: false }))).not.toContain("gui-send-key");
    expect(ids(input({ enabled: false }))).not.toContain("gui-send-key");
  });

  it("onSelect routes to onSendKey", () => {
    const inp = input();
    buildGuiActions(inp).find((a) => a.id === "gui-send-key")!.onSelect();
    expect(inp.onSendKey).toHaveBeenCalledOnce();
  });
});

describe("buildGuiActions — HiDPI pair", () => {
  it("is destination-only and tile-open-gated, routing the target state", () => {
    const off = input({ hidpi: false });
    expect(ids(off)).toContain("gui-hidpi-on");
    expect(ids(off)).not.toContain("gui-hidpi-off");
    const on = buildGuiActions(off).find((a) => a.id === "gui-hidpi-on")!;
    expect(on.label).toBe("GUI: HiDPI on");
    expect(on.description).toBe("render at device pixels — 1:1 is crisp on a Retina display");
    on.onSelect();
    expect(off.onHidpiChange).toHaveBeenCalledWith(true);

    const onState = input({ hidpi: true });
    expect(ids(onState)).toContain("gui-hidpi-off");
    expect(ids(onState)).not.toContain("gui-hidpi-on");
    buildGuiActions(onState).find((a) => a.id === "gui-hidpi-off")!.onSelect();
    expect(onState.onHidpiChange).toHaveBeenCalledWith(false);

    expect(ids(input({ tileOpen: false }))).not.toContain("gui-hidpi-on");
  });
});

describe("buildGuiActions — key bar pair", () => {
  it("is destination-only and coarse-only, routing the target visibility", () => {
    const shown = input({ coarsePointer: true, keyBarVisible: true });
    expect(ids(shown)).toContain("gui-keybar-hide");
    expect(ids(shown)).not.toContain("gui-keybar-show");
    buildGuiActions(shown).find((a) => a.id === "gui-keybar-hide")!.onSelect();
    expect(shown.onKeyBarVisibleChange).toHaveBeenCalledWith(false);

    const hidden = input({ coarsePointer: true, keyBarVisible: false });
    expect(ids(hidden)).toContain("gui-keybar-show");
    expect(ids(hidden)).not.toContain("gui-keybar-hide");
    buildGuiActions(hidden).find((a) => a.id === "gui-keybar-show")!.onSelect();
    expect(hidden.onKeyBarVisibleChange).toHaveBeenCalledWith(true);
  });

  it("is absent on a fine pointer and without an open tile", () => {
    const fine = ids(input({ coarsePointer: false }));
    expect(fine).not.toContain("gui-keybar-hide");
    expect(fine).not.toContain("gui-keybar-show");
    const closed = ids(input({ tileOpen: false, coarsePointer: true }));
    expect(closed).not.toContain("gui-keybar-hide");
    expect(closed).not.toContain("gui-keybar-show");
  });
});
