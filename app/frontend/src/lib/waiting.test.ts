import { describe, it, expect } from "vitest";
import { isWaiting, countWaitingWindows, countWaitingInSessions } from "./waiting";
import type { ProjectSession, WindowInfo } from "@/types";

function win(agentState?: string): WindowInfo {
  return {
    windowId: "@0",
    index: 0,
    name: "w",
    worktreePath: "/p",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    agentState,
  };
}

function session(states: (string | undefined)[]): ProjectSession {
  return { name: "s", windows: states.map(win) };
}

describe("isWaiting", () => {
  it("true only for the rolled-up 'waiting' state", () => {
    expect(isWaiting({ agentState: "waiting" })).toBe(true);
    expect(isWaiting({ agentState: "active" })).toBe(false);
    expect(isWaiting({ agentState: "idle" })).toBe(false);
    expect(isWaiting({ agentState: undefined })).toBe(false);
  });
});

describe("countWaitingWindows", () => {
  it("counts waiting windows only", () => {
    expect(countWaitingWindows([win("waiting"), win("active"), win("waiting"), win("idle"), win(undefined)])).toBe(2);
  });
  it("returns 0 for an empty list", () => {
    expect(countWaitingWindows([])).toBe(0);
  });
});

describe("countWaitingInSessions", () => {
  it("sums waiting windows across a server's sessions", () => {
    const sessions = [session(["waiting", "active"]), session(["idle", "waiting", "waiting"])];
    expect(countWaitingInSessions(sessions)).toBe(3);
  });
  it("returns 0 when no session has a waiting window", () => {
    expect(countWaitingInSessions([session(["active", "idle"]), session([undefined])])).toBe(0);
  });
});
