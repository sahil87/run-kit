import { describe, it, expect, beforeEach } from "vitest";
import {
  availableSurfaces,
  panelStorageKey,
  readStoredPanel,
  clampRatio,
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

describe("legacy panel storage key (read-only seed)", () => {
  it("builds the value-bearing per-window key", () => {
    expect(panelStorageKey("srv", "@3")).toBe("runkit-window-panel:srv:@3");
  });

  it("reads a stored surface under the window's key (absent = undefined)", () => {
    expect(readStoredPanel("srv", "@3")).toBeUndefined();
    localStorage.setItem(panelStorageKey("srv", "@3"), "web");
    expect(readStoredPanel("srv", "@3")).toBe("web");
  });

  it("scopes the key per server + window", () => {
    localStorage.setItem(panelStorageKey("srv", "@3"), "web");
    expect(readStoredPanel("srv", "@4")).toBeUndefined();
    expect(readStoredPanel("other", "@3")).toBeUndefined();
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

  it("allows dominant tiles (no upper cap short of the far floor)", () => {
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
