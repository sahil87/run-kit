import { describe, expect, it } from "vitest";
import {
  ASK_OPERATOR_MIN_QUERY,
  findOperatorWindow,
  isOperatorConsoleRequest,
  resolveConsoleServer,
  shouldShowAskOperatorRow,
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
