import { describe, it, expect, vi } from "vitest";
import type { GuiStatus } from "@/api/client";
import {
  AUTO_WM,
  OTHER_WM,
  DESKTOP_SET_OFF_TOAST,
  buildWMOptions,
  buildDesktopPaletteRows,
  missingWMs,
  isOtherWM,
  guiRestartBody,
} from "./gui-desktop";

function status(overrides: Partial<GuiStatus> = {}): GuiStatus {
  return {
    id: "host",
    enabled: true,
    backend: "Xtigervnc",
    reachable: true,
    display: ":10",
    width: 1920,
    height: 1080,
    viewers: 1,
    wm: "icewm-session",
    locked: false,
    geometry: "auto",
    socket: "/run/host.sock",
    session: "rk-gui",
    reason: "",
    apps: [],
    uptime_seconds: 0,
    ...overrides,
  };
}

const ICEWM = { name: "icewm-session", label: "IceWM", kind: "wm" as const, installed: true };
const LXQT = { name: "startlxqt", label: "LXQt", kind: "session" as const, installed: true };
const XFCE_MISSING = {
  name: "startxfce4",
  label: "XFCE",
  kind: "session" as const,
  installed: false,
  hint: "sudo apt install --no-install-recommends xfce4",
};

describe("buildWMOptions", () => {
  it("orders Auto → candidates by label → Other…", () => {
    expect(buildWMOptions(status({ wm_candidates: [ICEWM, LXQT] }))).toEqual([
      { value: AUTO_WM, label: "Auto (ladder)" },
      { value: "icewm-session", label: "IceWM" },
      { value: "startlxqt", label: "LXQt" },
      { value: OTHER_WM, label: "Other…" },
    ]);
  });

  it("missing desktops become disabled '<label> — not installed' options before Other…", () => {
    expect(buildWMOptions(status({ wm_candidates: [ICEWM, XFCE_MISSING] }))).toEqual([
      { value: AUTO_WM, label: "Auto (ladder)" },
      { value: "icewm-session", label: "IceWM" },
      { value: "startxfce4", label: "XFCE — not installed", disabled: true },
      { value: OTHER_WM, label: "Other…" },
    ]);
  });

  it("an empty candidate list leaves Auto and Other… only", () => {
    expect(buildWMOptions(status({ wm_candidates: [] }))).toEqual([
      { value: AUTO_WM, label: "Auto (ladder)" },
      { value: OTHER_WM, label: "Other…" },
    ]);
  });

  it("an absent wm_candidates (old daemon) reads as empty", () => {
    expect(buildWMOptions(status())).toEqual([
      { value: AUTO_WM, label: "Auto (ladder)" },
      { value: OTHER_WM, label: "Other…" },
    ]);
  });
});

describe("missingWMs", () => {
  it("returns the installed:false rows in document order", () => {
    const plasmaMissing = { ...XFCE_MISSING, name: "startplasma-x11", label: "Plasma" };
    expect(missingWMs(status({ wm_candidates: [ICEWM, XFCE_MISSING, LXQT, plasmaMissing] }))).toEqual([
      XFCE_MISSING,
      plasmaMissing,
    ]);
  });

  it("is empty when everything is installed or the field is absent", () => {
    expect(missingWMs(status({ wm_candidates: [ICEWM] }))).toEqual([]);
    expect(missingWMs(status())).toEqual([]);
  });
});

describe("buildDesktopPaletteRows", () => {
  it("Auto first, candidates in order, the stored pin's row marked current", () => {
    const rows = buildDesktopPaletteRows(
      status({ wm_candidates: [ICEWM, LXQT] }),
      "startlxqt",
      vi.fn(),
    );
    expect(rows.map((r) => [r.label, r.description])).toEqual([
      ["Auto (ladder)", undefined],
      ["IceWM", undefined],
      ["LXQt", "current"],
    ]);
  });

  it("the empty pin marks the Auto row current", () => {
    const rows = buildDesktopPaletteRows(status({ wm_candidates: [ICEWM] }), AUTO_WM, vi.fn());
    expect(rows[0].description).toBe("current");
    expect(rows[1].description).toBeUndefined();
  });

  it("missing desktops trail as disabled '<label> (not installed)' rows with the hint as description", () => {
    const rows = buildDesktopPaletteRows(status({ wm_candidates: [ICEWM, XFCE_MISSING] }), "", vi.fn());
    expect(rows.map((r) => [r.label, r.description, r.disabled ?? false])).toEqual([
      ["Auto (ladder)", "current", false],
      ["IceWM", undefined, false],
      ["XFCE (not installed)", "sudo apt install --no-install-recommends xfce4", true],
    ]);
  });

  it("a missing row with an empty hint omits the description, and its onSelect is inert", () => {
    const onPick = vi.fn();
    const rows = buildDesktopPaletteRows(
      status({ wm_candidates: [{ ...XFCE_MISSING, hint: undefined }] }),
      "",
      onPick,
    );
    expect(rows[1].description).toBeUndefined();
    expect(rows[1].disabled).toBe(true);
    rows[1].onSelect();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("has no Other… row and routes selections to onPick by name", () => {
    const onPick = vi.fn();
    const rows = buildDesktopPaletteRows(status({ wm_candidates: [ICEWM, LXQT] }), "", onPick);
    expect(rows.some((r) => r.label === "Other…")).toBe(false);
    rows[0].onSelect();
    expect(onPick).toHaveBeenCalledWith(AUTO_WM);
    rows[2].onSelect();
    expect(onPick).toHaveBeenCalledWith("startlxqt");
  });
});

describe("isOtherWM", () => {
  it("is false for Auto and for candidate names, true for any other pin", () => {
    const candidates = [ICEWM, LXQT];
    expect(isOtherWM(AUTO_WM, candidates)).toBe(false);
    expect(isOtherWM("icewm-session", candidates)).toBe(false);
    expect(isOtherWM("xfwm4", candidates)).toBe(true);
    expect(isOtherWM(OTHER_WM, candidates)).toBe(true);
  });
});

describe("guiRestartBody", () => {
  it("names the running apps with counts", () => {
    expect(
      guiRestartBody(
        status({
          apps: [
            { name: "chromium", count: 3 },
            { name: "xterm", count: 1 },
          ],
        }),
      ),
    ).toBe("Running apps will close: chromium ×3, xterm ×1");
  });

  it("empty apps read 'No apps are running on display <display>.'", () => {
    expect(guiRestartBody(status())).toBe("No apps are running on display :10.");
  });

  it("a not-running display takes the next-restart line", () => {
    const line = "The desktop is not running — the new desktop starts on the next restart.";
    expect(guiRestartBody(status({ reachable: false, display: "" }))).toBe(line);
    expect(guiRestartBody(status({ reachable: true, display: "" }))).toBe(line);
  });

  it("a failed status GET (null) renders the generic line", () => {
    expect(guiRestartBody(null)).toBe(
      "Couldn't read the desktop status — restarting it closes any running apps.",
    );
  });
});

describe("DESKTOP_SET_OFF_TOAST", () => {
  it("is the off-GUI pick confirmation", () => {
    expect(DESKTOP_SET_OFF_TOAST).toBe("Desktop set — takes effect when the GUI turns on");
  });
});
