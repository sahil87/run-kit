import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { prDotState, prOwnsDot, prGlyphColor } from "./pr-status-model";
import { makeWindow } from "@/test-utils/fixtures";

// NOTE (260715-jykd): the `PrStatusLine` component (and its render tests) were
// retired — it had zero live mount sites. This module now exercises the RETAINED
// exports of pr-status-model.ts; the `prDotState` precedence coverage below is
// the live behavior that still ships.

afterEach(() => {
  cleanup();
});

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

// 93dy: prOwnsDot is now exported — the sidebar row's rest-state PR glyph
// reuses it as its gate (any owned PR: open, failing, merged; never closed).
describe("prOwnsDot — owned-PR gate", () => {
  it("owns for an open PR", () => {
    expect(prOwnsDot(makeWindow({ prNumber: 7, prState: "open" }))).toBe(true);
  });

  it("owns for a merged PR (durable done square)", () => {
    expect(prOwnsDot(makeWindow({ prNumber: 7, prState: "merged" }))).toBe(true);
  });

  it("owns for a failing open PR", () => {
    expect(prOwnsDot(makeWindow({ prNumber: 7, prState: "open", prChecks: "fail" }))).toBe(true);
  });

  it("never owns for a closed-unmerged PR (D2)", () => {
    expect(prOwnsDot(makeWindow({ prNumber: 7, prState: "closed" }))).toBe(false);
  });

  it("never owns without a prNumber", () => {
    expect(prOwnsDot(makeWindow({ prState: "open" }))).toBe(false);
    expect(prOwnsDot(makeWindow({}))).toBe(false);
  });
});

// 93dy: glyph color follows the shared vocabulary — red ONLY for fail-ish,
// purple for every other owned state (open / merged / pending).
describe("prGlyphColor — rest-glyph color mapping", () => {
  it("open + passing checks → purple", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "open", prChecks: "pass" }))).toBe(
      "text-purple-400",
    );
  });

  it("merged → purple (historical failing checks ignored — merged wins)", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "merged", prChecks: "fail" }))).toBe(
      "text-purple-400",
    );
  });

  it("checks pending → purple (pending is not failure)", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "open", prChecks: "pending" }))).toBe(
      "text-purple-400",
    );
  });

  it("failing checks → red", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "open", prChecks: "fail" }))).toBe(
      "text-red-400",
    );
  });

  it("changes requested → red (isFailish covers review too)", () => {
    expect(
      prGlyphColor(
        makeWindow({ prNumber: 7, prState: "open", prChecks: "pass", prReview: "changes_requested" }),
      ),
    ).toBe("text-red-400");
  });
});
