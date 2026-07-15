import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { prDotState } from "./pr-status-line";
import type { WindowInfo } from "@/types";

// NOTE (260715-jykd): the `PrStatusLine` component (and its render tests) were
// retired — it had zero live mount sites. This module now exercises the RETAINED
// exports of pr-status-line.tsx; the `prDotState` precedence coverage below is
// the live behavior that still ships.

afterEach(() => {
  cleanup();
});

function makeWindow(overrides: Partial<WindowInfo>): WindowInfo {
  return {
    windowId: "@0",
    index: 0,
    name: "win",
    worktreePath: "/p",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    ...overrides,
  };
}

describe("prDotState precedence", () => {
  it("returns merged first, even with historical failing checks", () => {
    expect(prDotState(makeWindow({ prState: "merged", prChecks: "fail" }))).toBe("merged");
    expect(
      prDotState(makeWindow({ prState: "merged", prReview: "changes_requested" })),
    ).toBe("merged");
  });

  it("returns fail before healthy when checks pass but changes are requested", () => {
    expect(
      prDotState(makeWindow({ prState: "open", prChecks: "pass", prReview: "changes_requested" })),
    ).toBe("fail");
  });

  it("returns fail when checks fail", () => {
    expect(prDotState(makeWindow({ prState: "open", prChecks: "fail" }))).toBe("fail");
  });

  it("returns pending when checks are running", () => {
    expect(prDotState(makeWindow({ prState: "open", prChecks: "pending" }))).toBe("pending");
  });

  it("returns healthy when checks pass", () => {
    expect(prDotState(makeWindow({ prState: "open", prChecks: "pass" }))).toBe("healthy");
  });

  it("returns healthy for a draft with passing checks (green = health, not readiness)", () => {
    expect(
      prDotState(makeWindow({ prState: "open", prIsDraft: true, prChecks: "pass" })),
    ).toBe("healthy");
  });

  it("returns neutral for a closed-unmerged PR (not merged, not purple, not red)", () => {
    expect(prDotState(makeWindow({ prState: "closed" }))).toBe("neutral");
    expect(prDotState(makeWindow({ prState: "closed", prChecks: "none" }))).toBe("neutral");
  });

  it("only `merged` short-circuits historical signals — a closed PR with failing checks still reads fail", () => {
    // Unlike `merged` (which is checked first), `closed` has no early-return, so
    // isFailish runs before the neutral fall-through. This is the specified
    // precedence order: merged → fail → pending → healthy → neutral.
    expect(prDotState(makeWindow({ prState: "closed", prChecks: "fail" }))).toBe("fail");
  });

  it("returns neutral for a bare open PR with no checks signal", () => {
    expect(prDotState(makeWindow({ prState: "open" }))).toBe("neutral");
    expect(prDotState(makeWindow({ prState: "open", prChecks: "none" }))).toBe("neutral");
  });
});
