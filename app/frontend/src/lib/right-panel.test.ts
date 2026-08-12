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
  clampRatio,
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
  // Since 260812-ab5v (R8) the registry is the SHARED tileable-surface
  // registry (`availableTiles`): `tty` is always available and listed FIRST,
  // then `web`/`chat`/`code` per capability.
  it("offers tty first, then web exactly when hasWebUrl holds", () => {
    expect(availableSurfaces(webWin)).toEqual(["tty", "web"]);
  });

  it("offers only tty without a usable rkUrl", () => {
    expect(availableSurfaces(plain)).toEqual(["tty"]);
    expect(availableSurfaces(whitespaceWin)).toEqual(["tty"]);
    expect(availableSurfaces(null)).toEqual(["tty"]);
    expect(availableSurfaces(undefined)).toEqual(["tty"]);
  });

  it("offers chat exactly when the window carries a chatProvider", () => {
    expect(availableSurfaces({ chatProvider: "claude" })).toEqual(["tty", "chat"]);
  });

  // The `code` surface (260811-k3vp, simplified by 260811-a2bo) mirrors the
  // view registry's gate: gitRoot derived (the port resolves by convention).
  // Registry order is tty, web, chat, code (surface-layout R8).
  it("offers code exactly when gitRoot is set", () => {
    const codeWin: ViewWindow = { gitRoot: "/repo" };
    expect(availableSurfaces(codeWin)).toEqual(["tty", "code"]);
    expect(availableSurfaces({ rkUrl: "http://localhost:8080", chatProvider: "claude", gitRoot: "/repo" }))
      .toEqual(["tty", "web", "chat", "code"]);
  });

  it("gates code off without a gitRoot", () => {
    expect(availableSurfaces(plain)).toEqual(["tty"]);
    expect(availableSurfaces(null)).toEqual(["tty"]);
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

  // The `code` surface (260811-k3vp, simplified by 260811-a2bo): same
  // precedence chain, gated by the gitRoot-derived availability rule.
  it("resolves code when available, drops it when not", () => {
    const codeWin: ViewWindow = { gitRoot: "/repo" };
    expect(resolvePanel("code", undefined, codeWin)).toBe("code");
    expect(resolvePanel(undefined, "code", codeWin)).toBe("code");
    expect(resolvePanel("code", undefined, plain)).toBeNull(); // no gitRoot
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

describe("clampRatio", () => {
  // The divider-boundary clamp (260812-ab5v R5): the 280px floor bounds BOTH
  // sides, so the range is [floor, 100 − floor] — no 65% cap (a dominant main
  // tile is legitimate in `main-*` shapes).
  it("passes through an in-range percentage", () => {
    expect(clampRatio(50, 1000)).toBe(50);
  });

  it("applies the 280px floor on both sides of the boundary", () => {
    // 280px on a 1000px container = 28% on each side.
    expect(clampRatio(10, 1000)).toBeCloseTo(28);
    expect(clampRatio(90, 1000)).toBeCloseTo(72);
  });

  it("allows dominant tiles past the panel's 65% cap", () => {
    expect(clampRatio(80, 2000)).toBe(80);
  });

  it("skips the floor when the container is unmeasured", () => {
    expect(clampRatio(10, 0)).toBe(10);
    expect(clampRatio(90, 0)).toBe(90);
  });

  it("collapses to 50/50 when the container cannot fit two floors", () => {
    // Below 2 × 280px the range [floor, 100 − floor] inverts; the boundary
    // must stay inside [0, 100] and treat both tiles alike.
    expect(clampRatio(10, 500)).toBe(50); // floor = 56%
    expect(clampRatio(90, 500)).toBe(50);
    expect(clampRatio(50, 200)).toBe(50); // floor = 140%
    expect(clampRatio(10, 200)).toBe(50);
  });

  it("still honors the floor at exactly two floors of width", () => {
    // 560px = 2 × 280px — the last width where the range is non-empty.
    expect(clampRatio(10, 560)).toBeCloseTo(50);
    expect(clampRatio(90, 560)).toBeCloseTo(50);
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
