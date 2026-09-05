import { describe, expect, it, beforeEach } from "vitest";
import {
  ASK_OPERATOR_MIN_QUERY,
  CONSOLE_GEOMETRY_DEFAULT,
  CONSOLE_GEOMETRY_KEY,
  CONSOLE_OPACITY_DEFAULT,
  CONSOLE_OPACITY_KEY,
  clampConsoleGeometry,
  clampConsoleOpacity,
  findOperatorWindow,
  isOperatorConsoleRequest,
  isOperatorConsoleTarget,
  OPERATOR_CONSOLE_ROOT_ATTR,
  readConsoleGeometry,
  readConsoleOpacity,
  resolveConsoleServer,
  shouldShowAskOperatorRow,
  writeConsoleGeometry,
  writeConsoleOpacity,
} from "./operator-console";
import type { ProjectSession, WindowInfo } from "@/types";

function win(overrides: Partial<WindowInfo>): WindowInfo {
  return {
    windowId: "@1",
    index: 0,
    name: "win",
    worktreePath: "/tmp",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    ...overrides,
  };
}

function session(name: string, windows: WindowInfo[]): ProjectSession {
  return { name, windows };
}

describe("resolveConsoleServer", () => {
  it("prefers the route server over every other source", () => {
    expect(resolveConsoleServer("fabKit1", ["a", "fabKit1"], "a")).toBe("fabKit1");
    expect(resolveConsoleServer("fabKit1", [], null)).toBe("fabKit1");
  });

  it("preselects the sole server when exactly one exists", () => {
    expect(resolveConsoleServer(null, ["only"], null)).toBe("only");
    expect(resolveConsoleServer(null, ["only"], "stale")).toBe("only");
  });

  it("defaults to the most recently viewed server when it is still listed", () => {
    expect(resolveConsoleServer(null, ["a", "b"], "b")).toBe("b");
  });

  it("falls back to the first server when lastViewed is stale or absent", () => {
    expect(resolveConsoleServer(null, ["a", "b"], "gone")).toBe("a");
    expect(resolveConsoleServer(null, ["a", "b"], null)).toBe("a");
  });

  it("returns null for an empty server list", () => {
    expect(resolveConsoleServer(null, [], "a")).toBeNull();
    expect(resolveConsoleServer(null, [], null)).toBeNull();
  });
});

describe("findOperatorWindow", () => {
  it("finds the role=operator window across sessions, with its session name", () => {
    const sessions = [
      session("main", [win({ windowId: "@1" }), win({ windowId: "@2" })]),
      session("_rk-operator", [win({ windowId: "@9", role: "operator", name: "operator" })]),
    ];
    expect(findOperatorWindow(sessions)).toEqual({
      window: sessions[1].windows[0],
      sessionName: "_rk-operator",
    });
  });

  it("returns undefined when no window carries the operator role", () => {
    expect(findOperatorWindow([session("main", [win({})])])).toBeUndefined();
    expect(findOperatorWindow([])).toBeUndefined();
  });

  it("ignores an empty windowId (ghost rows never carry a role, belt-and-suspenders)", () => {
    const sessions = [session("main", [win({ windowId: "", role: "operator" })])];
    expect(findOperatorWindow(sessions)).toBeUndefined();
  });
});

describe("shouldShowAskOperatorRow", () => {
  it("shows only at zero matches with an operator and a floor-length query", () => {
    expect(shouldShowAskOperatorRow("hello", 0, true)).toBe(true);
    expect(shouldShowAskOperatorRow("hello", 2, true)).toBe(false);
    expect(shouldShowAskOperatorRow("hello", 0, false)).toBe(false);
  });

  it("enforces the trimmed length floor", () => {
    const short = "x".repeat(ASK_OPERATOR_MIN_QUERY - 1);
    const exact = "x".repeat(ASK_OPERATOR_MIN_QUERY);
    expect(shouldShowAskOperatorRow(short, 0, true)).toBe(false);
    expect(shouldShowAskOperatorRow(exact, 0, true)).toBe(true);
    expect(shouldShowAskOperatorRow(`  ${short}  `, 0, true)).toBe(false);
    expect(shouldShowAskOperatorRow("   ", 0, true)).toBe(false);
  });
});

describe("isOperatorConsoleRequest", () => {
  it("accepts both actions and rejects foreign details", () => {
    expect(isOperatorConsoleRequest({ action: "toggle" })).toBe(true);
    expect(isOperatorConsoleRequest({ action: "open", server: "a", send: "hi" })).toBe(true);
    expect(isOperatorConsoleRequest({ action: "close" })).toBe(false);
    expect(isOperatorConsoleRequest(null)).toBe(false);
    expect(isOperatorConsoleRequest("open")).toBe(false);
    expect(isOperatorConsoleRequest(undefined)).toBe(false);
  });
});

describe("console geometry store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the defaults when nothing is stored", () => {
    expect(readConsoleGeometry()).toEqual(CONSOLE_GEOMETRY_DEFAULT);
  });

  it("round-trips a written geometry", () => {
    writeConsoleGeometry({ heightVh: 70, widthPx: 900 });
    expect(readConsoleGeometry()).toEqual({ heightVh: 70, widthPx: 900 });
  });

  it("degrades to defaults on corrupt JSON", () => {
    localStorage.setItem(CONSOLE_GEOMETRY_KEY, "{not json");
    expect(readConsoleGeometry()).toEqual(CONSOLE_GEOMETRY_DEFAULT);
  });

  it("degrades to defaults on a wrong shape", () => {
    localStorage.setItem(CONSOLE_GEOMETRY_KEY, JSON.stringify({ heightVh: "70", widthPx: 900 }));
    expect(readConsoleGeometry()).toEqual(CONSOLE_GEOMETRY_DEFAULT);
  });

  it("clamps out-of-range stored values instead of rejecting them", () => {
    localStorage.setItem(CONSOLE_GEOMETRY_KEY, JSON.stringify({ heightVh: 99, widthPx: 100 }));
    expect(readConsoleGeometry()).toEqual({ heightVh: 85, widthPx: 420 });
  });

  it("clamps width against the 96vw ceiling", () => {
    const clamped = clampConsoleGeometry({ heightVh: 55, widthPx: 2000 }, 1000);
    expect(clamped.widthPx).toBe(960);
  });

  it("clamps height into 25–85vh", () => {
    expect(clampConsoleGeometry({ heightVh: 10, widthPx: 760 }).heightVh).toBe(25);
    expect(clampConsoleGeometry({ heightVh: 90, widthPx: 760 }).heightVh).toBe(85);
  });
});

describe("console opacity store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the default 0.90 when nothing is stored", () => {
    expect(readConsoleOpacity()).toBe(CONSOLE_OPACITY_DEFAULT);
  });

  it("round-trips a written opacity", () => {
    writeConsoleOpacity(0.8);
    expect(readConsoleOpacity()).toBe(0.8);
  });

  it("degrades to the default on a non-numeric value", () => {
    localStorage.setItem(CONSOLE_OPACITY_KEY, "opaque-ish");
    expect(readConsoleOpacity()).toBe(CONSOLE_OPACITY_DEFAULT);
  });

  it("clamps into 0.75–1.0", () => {
    expect(clampConsoleOpacity(0.2)).toBe(0.75);
    expect(clampConsoleOpacity(1.4)).toBe(1.0);
    localStorage.setItem(CONSOLE_OPACITY_KEY, "0.5");
    expect(readConsoleOpacity()).toBe(0.75);
  });
});

describe("isOperatorConsoleTarget", () => {
  it("recognizes targets inside the console root and rejects everything else", () => {
    const root = document.createElement("div");
    root.setAttribute(OPERATOR_CONSOLE_ROOT_ATTR, "");
    const inner = document.createElement("textarea");
    root.appendChild(inner);
    document.body.appendChild(root);

    expect(isOperatorConsoleTarget(inner)).toBe(true);
    expect(isOperatorConsoleTarget(root)).toBe(true);
    expect(isOperatorConsoleTarget(document.body)).toBe(false);
    expect(isOperatorConsoleTarget(null)).toBe(false);
    root.remove();
  });
});
