import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readGuiViewMode,
  writeGuiViewMode,
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

describe("gui view mode posture (rk-gui-view)", () => {
  it("defaults to fit when absent or invalid", () => {
    expect(readGuiViewMode()).toBe("fit");
    localStorage.setItem("rk-gui-view", "zoom");
    expect(readGuiViewMode()).toBe("fit");
  });

  it("round-trips 1:1 and fit", () => {
    writeGuiViewMode("1:1");
    expect(readGuiViewMode()).toBe("1:1");
    writeGuiViewMode("fit");
    expect(readGuiViewMode()).toBe("fit");
  });

  it("swallows a localStorage read failure, returning fit", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readGuiViewMode()).toBe("fit");
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
