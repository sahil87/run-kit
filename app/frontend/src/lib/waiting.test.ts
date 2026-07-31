import { describe, it, expect } from "vitest";
import { isWaiting, countWaitingWindows, countWaitingInSessions, countWaitingAcrossServers } from "./waiting";
import type { ProjectSession, WindowInfo } from "@/types";
import { makeWindow, makeSession } from "@/test-utils/fixtures";

function win(agentState?: string): WindowInfo {
  return makeWindow({ agentState });
}

function session(states: (string | undefined)[]): ProjectSession {
  return makeSession({ windows: states.map(win) });
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

describe("countWaitingAcrossServers", () => {
  it("sums waiting windows across every attached server", () => {
    const byServer = new Map<string, ProjectSession[]>([
      ["alpha", [session(["waiting", "active"])]],
      ["beta", [session(["waiting"]), session(["idle", "waiting"])]],
    ]);
    expect(countWaitingAcrossServers(byServer)).toBe(3);
  });
  it("returns 0 for an empty map and for servers with no waiting windows", () => {
    expect(countWaitingAcrossServers(new Map())).toBe(0);
    expect(
      countWaitingAcrossServers(new Map([["alpha", [session(["active", undefined])]]])),
    ).toBe(0);
  });
});
