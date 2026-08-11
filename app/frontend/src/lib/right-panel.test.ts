import { describe, it, expect, beforeEach } from "vitest";
import {
  availableSurfaces,
  resolvePanel,
  panelStorageKey,
  readStoredPanel,
  writeStoredPanel,
  removeStoredPanel,
  PANEL_WIDTH_STORAGE_KEY,
  DEFAULT_PANEL_WIDTH_PCT,
  MIN_PANEL_WIDTH_PX,
  MAX_PANEL_WIDTH_PCT,
  clampPanelWidth,
  readStoredPanelWidth,
  writeStoredPanelWidth,
} from "./right-panel";
import type { ViewWindow } from "./window-view";

const webWin: ViewWindow = { rkUrl: "http://localhost:8080" };
const whitespaceWin: ViewWindow = { rkUrl: "  \t " };
const plain: ViewWindow = {};

beforeEach(() => {
  localStorage.clear();
});

describe("availableSurfaces", () => {
  it("offers web exactly when hasWebUrl holds", () => {
    expect(availableSurfaces(webWin)).toEqual(["web"]);
  });

  it("offers nothing without a usable rkUrl", () => {
    expect(availableSurfaces(plain)).toEqual([]);
    expect(availableSurfaces(whitespaceWin)).toEqual([]);
    expect(availableSurfaces(null)).toEqual([]);
    expect(availableSurfaces(undefined)).toEqual([]);
  });

  // The `code` surface (260811-k3vp) mirrors the view registry's gate: gitRoot
  // derived AND the host's code-server port configured. Registry order is
  // web-then-code (spec § Surface Registry row order).
  it("offers code exactly when gitRoot is set AND the port is configured", () => {
    const codeWin: ViewWindow = { gitRoot: "/repo" };
    expect(availableSurfaces(codeWin, 8080)).toEqual(["code"]);
    expect(availableSurfaces({ rkUrl: "http://localhost:8080", gitRoot: "/repo" }, 8080))
      .toEqual(["web", "code"]);
  });

  it("gates code off without a port or without a gitRoot", () => {
    expect(availableSurfaces({ gitRoot: "/repo" })).toEqual([]); // port unset (0)
    expect(availableSurfaces(plain, 8080)).toEqual([]); // no gitRoot
    expect(availableSurfaces(null, 8080)).toEqual([]);
  });
});

describe("resolvePanel", () => {
  it("prefers the URL param over localStorage", () => {
    expect(resolvePanel("web", undefined, webWin)).toBe("web");
    // A stored value loses to a valid param — there is only one phase-1
    // surface, so this is the param-wins smoke check.
    expect(resolvePanel("web", "web", webWin)).toBe("web");
  });

  it("falls back to the stored surface when no param", () => {
    expect(resolvePanel(undefined, "web", webWin)).toBe("web");
  });

  it("resolves null (closed) with neither param nor stored value", () => {
    expect(resolvePanel(undefined, undefined, webWin)).toBeNull();
  });

  it("drops unknown values and falls through", () => {
    expect(resolvePanel("bogus", undefined, webWin)).toBeNull();
    expect(resolvePanel("bogus", "web", webWin)).toBe("web");
    expect(resolvePanel(undefined, "bogus", webWin)).toBeNull();
  });

  it("drops unavailable values — ?panel=web on a window with no rkUrl closes", () => {
    expect(resolvePanel("web", undefined, plain)).toBeNull();
    expect(resolvePanel("web", "web", whitespaceWin)).toBeNull();
    expect(resolvePanel(undefined, "web", null)).toBeNull();
  });

  // The `code` surface (260811-k3vp): same precedence chain, gated by the
  // gitRoot ∧ configured-port availability rule.
  it("resolves code when available, drops it when not", () => {
    const codeWin: ViewWindow = { gitRoot: "/repo" };
    expect(resolvePanel("code", undefined, codeWin, 8080)).toBe("code");
    expect(resolvePanel(undefined, "code", codeWin, 8080)).toBe("code");
    expect(resolvePanel("code", undefined, codeWin)).toBeNull(); // port unset
    expect(resolvePanel("code", undefined, plain, 8080)).toBeNull(); // no gitRoot
  });
});

describe("panel storage keys", () => {
  it("builds the value-bearing per-window key", () => {
    expect(panelStorageKey("srv", "@3")).toBe("runkit-window-panel:srv:@3");
  });

  it("writes, reads, and removes the open surface (absent = closed)", () => {
    expect(readStoredPanel("srv", "@3")).toBeUndefined();
    writeStoredPanel("srv", "@3", "web");
    expect(readStoredPanel("srv", "@3")).toBe("web");
    removeStoredPanel("srv", "@3");
    // Closing REMOVES the key rather than storing a sentinel.
    expect(localStorage.getItem("runkit-window-panel:srv:@3")).toBeNull();
    expect(readStoredPanel("srv", "@3")).toBeUndefined();
  });

  it("scopes the key per server + window", () => {
    writeStoredPanel("srv", "@3", "web");
    expect(readStoredPanel("srv", "@4")).toBeUndefined();
    expect(readStoredPanel("other", "@3")).toBeUndefined();
  });
});

describe("clampPanelWidth", () => {
  it("passes through an in-range percentage", () => {
    expect(clampPanelWidth(38, 1000)).toBe(38);
  });

  it("applies the 280px floor as a percentage of the container", () => {
    // 280px on a 1000px row = 28%.
    expect(clampPanelWidth(10, 1000)).toBeCloseTo(28);
    expect(clampPanelWidth(MIN_PANEL_WIDTH_PX / 10, 1000)).toBeCloseTo(28);
  });

  it("applies the 65% cap", () => {
    expect(clampPanelWidth(90, 1000)).toBe(MAX_PANEL_WIDTH_PCT);
    expect(clampPanelWidth(90, 2000)).toBe(MAX_PANEL_WIDTH_PCT);
  });

  it("lets the floor win over the cap on narrow containers (CSS clamp semantics)", () => {
    // 280px on a 400px row = 70% > the 65% cap — the floor wins.
    expect(clampPanelWidth(50, 400)).toBe(70);
  });

  it("applies only the cap when the container is unmeasured", () => {
    expect(clampPanelWidth(10, 0)).toBe(10);
    expect(clampPanelWidth(90, 0)).toBe(MAX_PANEL_WIDTH_PCT);
  });
});

describe("panel width storage", () => {
  it("defaults to 38% when unset", () => {
    expect(readStoredPanelWidth()).toBe(DEFAULT_PANEL_WIDTH_PCT);
  });

  it("round-trips a written percentage", () => {
    writeStoredPanelWidth(42.5);
    expect(readStoredPanelWidth()).toBe(42.5);
  });

  it("falls back to the default for garbage/non-positive values", () => {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, "abc");
    expect(readStoredPanelWidth()).toBe(DEFAULT_PANEL_WIDTH_PCT);
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, "-5");
    expect(readStoredPanelWidth()).toBe(DEFAULT_PANEL_WIDTH_PCT);
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, "0");
    expect(readStoredPanelWidth()).toBe(DEFAULT_PANEL_WIDTH_PCT);
  });
});
