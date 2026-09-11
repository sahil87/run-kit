import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  GUI_QUALITY_PRESETS,
  GUI_ZOOM_STEPS,
  readGuiQuality,
  readGuiStatsVisible,
  readGuiZoom,
  writeGuiQuality,
  writeGuiStatsVisible,
  writeGuiZoom,
  stepGuiZoom,
  readGuiPointerMode,
  writeGuiPointerMode,
  readGuiResizeLocked,
  writeGuiResizeLocked,
  readGuiWmStripDismissed,
  writeGuiWmStripDismissed,
} from "./gui-posture";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("gui zoom posture (rk-gui-zoom)", () => {
  it("defaults to fit when absent or invalid", () => {
    expect(readGuiZoom()).toBe("fit");
    localStorage.setItem("rk-gui-zoom", "999");
    expect(readGuiZoom()).toBe("fit");
    localStorage.setItem("rk-gui-zoom", "zoom");
    expect(readGuiZoom()).toBe("fit");
    localStorage.setItem("rk-gui-zoom", "100.5");
    expect(readGuiZoom()).toBe("fit");
  });

  it("reads each stored percentage as its number", () => {
    for (const step of GUI_ZOOM_STEPS) {
      localStorage.setItem("rk-gui-zoom", String(step));
      expect(readGuiZoom()).toBe(step);
    }
  });

  it("round-trips every step and fit", () => {
    for (const step of GUI_ZOOM_STEPS) {
      writeGuiZoom(step);
      expect(readGuiZoom()).toBe(step);
      expect(localStorage.getItem("rk-gui-zoom")).toBe(String(step));
    }
    writeGuiZoom("fit");
    expect(readGuiZoom()).toBe("fit");
    expect(localStorage.getItem("rk-gui-zoom")).toBe("fit");
  });

  it("migrates a legacy rk-gui-view of 1:1 to 100", () => {
    localStorage.setItem("rk-gui-view", "1:1");
    expect(readGuiZoom()).toBe(100);
  });

  it("reads fit over a legacy rk-gui-view of fit", () => {
    localStorage.setItem("rk-gui-view", "fit");
    expect(readGuiZoom()).toBe("fit");
  });

  it("ignores the legacy key once rk-gui-zoom exists", () => {
    localStorage.setItem("rk-gui-view", "1:1");
    writeGuiZoom(150);
    expect(localStorage.getItem("rk-gui-view")).toBeNull();
    localStorage.setItem("rk-gui-view", "1:1");
    expect(readGuiZoom()).toBe(150);
  });

  it("swallows a localStorage read failure, returning fit", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readGuiZoom()).toBe("fit");
  });

  it("swallows a localStorage write failure silently", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => writeGuiZoom(125)).not.toThrow();
  });
});

describe("stepGuiZoom", () => {
  it("steps up fit→100→125→150→200 and saturates at 200", () => {
    expect(stepGuiZoom("fit", 1)).toBe(100);
    expect(stepGuiZoom(50, 1)).toBe(75);
    expect(stepGuiZoom(75, 1)).toBe(100);
    expect(stepGuiZoom(100, 1)).toBe(125);
    expect(stepGuiZoom(125, 1)).toBe(150);
    expect(stepGuiZoom(150, 1)).toBe(200);
    expect(stepGuiZoom(200, 1)).toBe(200);
  });

  it("steps down 200→150→125→100→75→50→fit and saturates at fit", () => {
    expect(stepGuiZoom(200, -1)).toBe(150);
    expect(stepGuiZoom(150, -1)).toBe(125);
    expect(stepGuiZoom(125, -1)).toBe(100);
    expect(stepGuiZoom(100, -1)).toBe(75);
    expect(stepGuiZoom(75, -1)).toBe(50);
    expect(stepGuiZoom(50, -1)).toBe("fit");
    expect(stepGuiZoom("fit", -1)).toBe("fit");
  });
});

describe("gui pointer mode posture (rk-gui-pointer)", () => {
  it("defaults by pointer class when absent: trackpad on coarse, touch on fine", () => {
    expect(readGuiPointerMode(true)).toBe("trackpad");
    expect(readGuiPointerMode(false)).toBe("touch");
  });

  it("defaults by pointer class when invalid", () => {
    localStorage.setItem("rk-gui-pointer", "mouse");
    expect(readGuiPointerMode(true)).toBe("trackpad");
    expect(readGuiPointerMode(false)).toBe("touch");
  });

  it("a stored value wins over the pointer-class default", () => {
    localStorage.setItem("rk-gui-pointer", "touch");
    expect(readGuiPointerMode(true)).toBe("touch");
    localStorage.setItem("rk-gui-pointer", "trackpad");
    expect(readGuiPointerMode(false)).toBe("trackpad");
  });

  it("round-trips both modes", () => {
    writeGuiPointerMode("trackpad");
    expect(readGuiPointerMode(false)).toBe("trackpad");
    writeGuiPointerMode("touch");
    expect(readGuiPointerMode(true)).toBe("touch");
  });

  it("falls to the pointer-class default on a localStorage read failure", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readGuiPointerMode(true)).toBe("trackpad");
    expect(readGuiPointerMode(false)).toBe("touch");
  });

  it("swallows a localStorage write failure silently", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => writeGuiPointerMode("touch")).not.toThrow();
  });
});

describe("gui resize lock posture (rk-gui-lock)", () => {
  it("defaults to unlocked when absent", () => {
    expect(readGuiResizeLocked()).toBe(false);
  });

  it("round-trips the lock; unlock removes the key", () => {
    writeGuiResizeLocked(true);
    expect(readGuiResizeLocked()).toBe(true);
    writeGuiResizeLocked(false);
    expect(readGuiResizeLocked()).toBe(false);
    expect(localStorage.getItem("rk-gui-lock")).toBeNull();
  });
});

describe("gui quality posture (rk-gui-quality)", () => {
  it("maps the three names to their tuples", () => {
    expect(GUI_QUALITY_PRESETS).toEqual({
      sharp: { qualityLevel: 8, compressionLevel: 1 },
      balanced: { qualityLevel: 6, compressionLevel: 2 },
      smooth: { qualityLevel: 3, compressionLevel: 7 },
    });
  });

  it("defaults by pointer class when absent: balanced on fine, smooth on coarse", () => {
    expect(readGuiQuality(false)).toBe("balanced");
    expect(readGuiQuality(true)).toBe("smooth");
  });

  it("defaults by pointer class when invalid", () => {
    localStorage.setItem("rk-gui-quality", "ultra");
    expect(readGuiQuality(false)).toBe("balanced");
    expect(readGuiQuality(true)).toBe("smooth");
  });

  it("a stored value wins over the pointer-class default", () => {
    localStorage.setItem("rk-gui-quality", "sharp");
    expect(readGuiQuality(true)).toBe("sharp");
    localStorage.setItem("rk-gui-quality", "smooth");
    expect(readGuiQuality(false)).toBe("smooth");
  });

  it("round-trips every preset", () => {
    writeGuiQuality("sharp");
    expect(readGuiQuality(false)).toBe("sharp");
    expect(localStorage.getItem("rk-gui-quality")).toBe("sharp");
    writeGuiQuality("balanced");
    expect(readGuiQuality(false)).toBe("balanced");
    writeGuiQuality("smooth");
    expect(readGuiQuality(false)).toBe("smooth");
  });

  it("falls to the pointer-class default on a localStorage read failure", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readGuiQuality(false)).toBe("balanced");
    expect(readGuiQuality(true)).toBe("smooth");
  });

  it("swallows a localStorage write failure silently", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => writeGuiQuality("sharp")).not.toThrow();
  });
});

describe("gui stats overlay visibility (rk-gui-stats-visible)", () => {
  it("defaults to hidden when absent", () => {
    expect(readGuiStatsVisible()).toBe(false);
  });

  it("round-trips the flag; hiding removes the key", () => {
    writeGuiStatsVisible(true);
    expect(readGuiStatsVisible()).toBe(true);
    expect(localStorage.getItem("rk-gui-stats-visible")).toBe("1");
    writeGuiStatsVisible(false);
    expect(readGuiStatsVisible()).toBe(false);
    expect(localStorage.getItem("rk-gui-stats-visible")).toBeNull();
  });

  it("reads a stray non-'1' value as hidden", () => {
    localStorage.setItem("rk-gui-stats-visible", "yes");
    expect(readGuiStatsVisible()).toBe(false);
  });

  it("swallows a localStorage read failure, returning hidden", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readGuiStatsVisible()).toBe(false);
  });
});

describe("gui bare-WM strip dismissal (runkit-gui-wm-strip-dismissed)", () => {
  it("defaults to not dismissed when absent", () => {
    expect(readGuiWmStripDismissed()).toBe(false);
  });

  it("round-trips the dismissal; clearing removes the key", () => {
    writeGuiWmStripDismissed(true);
    expect(readGuiWmStripDismissed()).toBe(true);
    expect(localStorage.getItem("runkit-gui-wm-strip-dismissed")).toBe("1");
    writeGuiWmStripDismissed(false);
    expect(readGuiWmStripDismissed()).toBe(false);
    expect(localStorage.getItem("runkit-gui-wm-strip-dismissed")).toBeNull();
  });

  it("swallows a localStorage read failure, returning not dismissed", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readGuiWmStripDismissed()).toBe(false);
  });

  it("swallows a localStorage write failure silently", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => writeGuiWmStripDismissed(true)).not.toThrow();
  });
});
