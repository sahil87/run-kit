import { describe, it, expect } from "vitest";
import { nextWaitingTarget, chatSearchForTarget, type WaitingTarget } from "./palette-agent-nav";

const A: WaitingTarget = { server: "s1", windowId: "@1" };
const B: WaitingTarget = { server: "s1", windowId: "@2" };
const C: WaitingTarget = { server: "s2", windowId: "@9" };

describe("nextWaitingTarget", () => {
  it("returns null for an empty list (caller shows the 'no agents waiting' hint)", () => {
    expect(nextWaitingTarget([], "s1", "@1")).toBeNull();
  });

  it("returns the FIRST target when the current window is not itself waiting", () => {
    expect(nextWaitingTarget([A, B, C], "s1", "@nope")).toEqual(A);
  });

  it("advances to the NEXT target when the current window is a waiting target", () => {
    expect(nextWaitingTarget([A, B, C], "s1", "@1")).toEqual(B);
    expect(nextWaitingTarget([A, B, C], "s1", "@2")).toEqual(C);
  });

  it("wraps past the end back to the first", () => {
    expect(nextWaitingTarget([A, B, C], "s2", "@9")).toEqual(A);
  });

  it("keys on BOTH server and windowId (same id on another server is not the current)", () => {
    // current is (s2, @9); an entry (s1, @1) with a different server must not match as current.
    expect(nextWaitingTarget([C, A], "s2", "@9")).toEqual(A);
  });

  it("a single-element list returns that element (self-cycle is a harmless no-op nav)", () => {
    expect(nextWaitingTarget([A], "s1", "@1")).toEqual(A);
  });

  it("handles an undefined current window (returns the first)", () => {
    expect(nextWaitingTarget([A, B], undefined, undefined)).toEqual(A);
  });
});

describe("chatSearchForTarget", () => {
  it("appends ?view=chat for a chat-capable target", () => {
    expect(chatSearchForTarget(true)).toEqual({ view: "chat" });
  });

  it("returns empty search for a non-chat target", () => {
    expect(chatSearchForTarget(false)).toEqual({});
  });
});
