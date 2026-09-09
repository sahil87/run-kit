import { describe, it, expect, vi } from "vitest";
import { buildGuiActions, type GuiPaletteInput } from "./gui";

function input(overrides: Partial<GuiPaletteInput> = {}): GuiPaletteInput {
  return {
    enabled: true,
    tileOpen: true,
    connected: true,
    coarsePointer: false,
    viewMode: "fit",
    resizeLocked: false,
    supervisorAvailable: true,
    onTurnOn: vi.fn(),
    onTurnOff: vi.fn(),
    onFullscreen: vi.fn(),
    onPaste: vi.fn(),
    onViewMode: vi.fn(),
    onLockChange: vi.fn(),
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
    expect(list).toEqual(["gui-turn-off", "gui-logs"]);
  });

  it("the R8 worked example: on + open + connected + fine + fit + unlocked", () => {
    expect(ids(input())).toEqual([
      "gui-turn-off",
      "gui-fullscreen",
      "gui-paste",
      "gui-view-1to1",
      "gui-lock",
      "gui-logs",
    ]);
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

describe("buildGuiActions — destination-only pairs", () => {
  it("shows GUI: 1:1 in fit mode and GUI: Fit in 1:1 mode", () => {
    const fit = buildGuiActions(input({ viewMode: "fit" }));
    const fitEntry = fit.find((a) => a.id === "gui-view-1to1")!;
    expect(fitEntry.label).toBe("GUI: 1:1");
    expect(fit.some((a) => a.id === "gui-view-fit")).toBe(false);

    const oneToOne = buildGuiActions(input({ viewMode: "1:1" }));
    const back = oneToOne.find((a) => a.id === "gui-view-fit")!;
    expect(back.label).toBe("GUI: Fit");
    expect(oneToOne.some((a) => a.id === "gui-view-1to1")).toBe(false);
  });

  it("the view entries call onViewMode with the destination mode", () => {
    const inp = input({ viewMode: "fit" });
    buildGuiActions(inp).find((a) => a.id === "gui-view-1to1")!.onSelect();
    expect(inp.onViewMode).toHaveBeenCalledWith("1:1");

    const back = input({ viewMode: "1:1" });
    buildGuiActions(back).find((a) => a.id === "gui-view-fit")!.onSelect();
    expect(back.onViewMode).toHaveBeenCalledWith("fit");
  });

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
