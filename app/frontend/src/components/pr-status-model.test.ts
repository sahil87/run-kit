import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { prDotState, prOwnsGlyph, prGlyphColor } from "./pr-status-model";
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

// aqo6 → xuej: `prOwnsDot` renamed `prOwnsGlyph` — after PR eviction the
// predicate gates ONLY the rest-state PR glyph (window row + session tiles),
// never any dot tier. The gate is a positive allowlist (`open`/`merged`/
// `closed`): closed owns in its distinct muted ✕ form (xuej); an
// unknown/absent state still never owns — the backend's branch channel maps
// an unconfident state to "" (MapBranchState, serialized absent), and a
// stateless PR must not earn a glyph.
describe("prOwnsGlyph — owned-PR gate", () => {
  it("owns for an open PR", () => {
    expect(prOwnsGlyph(makeWindow({ prNumber: 7, prState: "open" }))).toBe(true);
  });

  it("owns for a merged PR (durable purple glyph)", () => {
    expect(prOwnsGlyph(makeWindow({ prNumber: 7, prState: "merged" }))).toBe(true);
  });

  it("owns for a failing open PR", () => {
    expect(prOwnsGlyph(makeWindow({ prNumber: 7, prState: "open", prChecks: "fail" }))).toBe(true);
  });

  // xuej: closed earns the glyph — rendered muted with the distinct ✕ icon.
  it("owns for a closed-unmerged PR (muted ✕ glyph, D2)", () => {
    expect(prOwnsGlyph(makeWindow({ prNumber: 7, prState: "closed" }))).toBe(true);
  });

  it("never owns without a prNumber", () => {
    expect(prOwnsGlyph(makeWindow({ prState: "open" }))).toBe(false);
    expect(prOwnsGlyph(makeWindow({}))).toBe(false);
  });

  it("never owns with an unknown/absent prState (unconfident branch fallback)", () => {
    // MapBranchState maps an unrecognized GitHub state to "" (omitempty →
    // absent on the wire): prNumber set with no confident state must not
    // render a glyph — `!== "closed"` would wrongly admit it.
    expect(prOwnsGlyph(makeWindow({ prNumber: 7 }))).toBe(false);
  });
});

// 93dy → aqo6 → xuej: glyph color follows the shared vocabulary — a SIX-way
// chain: muted for a CLOSED PR (dead — stale checks are noise; the ✕ icon,
// not the color, says "closed"), red ONLY for fail-ish, then gray for an
// OPEN DRAFT (e30p), then YELLOW for open with checks pending (the
// checks-running state that replaced the dot's retired purple pending ring),
// then GitHub-style by state: green for open, purple for merged. The draft
// branch is gated on `prState === "open"` and sits ABOVE pending, so drafts
// stay muted even while their checks run.
describe("prGlyphColor — rest-glyph color mapping", () => {
  it("open + passing checks → green", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "open", prChecks: "pass" }))).toBe(
      "text-accent-green",
    );
  });

  it("merged → purple (historical failing checks ignored — merged wins)", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "merged", prChecks: "fail" }))).toBe(
      "text-purple-400",
    );
  });

  it("checks pending → yellow (checks running — the NEW glyph state)", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "open", prChecks: "pending" }))).toBe(
      "text-yellow-400",
    );
  });

  it("open with no decisive checks signal → green (pending requires prChecks === 'pending')", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "open" }))).toBe("text-accent-green");
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "open", prChecks: "none" }))).toBe(
      "text-accent-green",
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

  // e30p: the draft branch — gray, below fail, gated on `prState === "open"`.
  // Glyph-only by construction post-eviction: the DOT never renders PR state
  // at all, so draft (like every PR fact) lives solely on the glyph.
  it("open + draft → gray (GitHub renders drafts gray; the inert token)", () => {
    expect(
      prGlyphColor(makeWindow({ prNumber: 7, prState: "open", prIsDraft: true, prChecks: "pass" })),
    ).toBe("text-text-secondary");
  });

  it("draft + failing checks → red (fail still wins over draft)", () => {
    expect(
      prGlyphColor(makeWindow({ prNumber: 7, prState: "open", prIsDraft: true, prChecks: "fail" })),
    ).toBe("text-red-400");
  });

  it("draft + changes requested → red (isFailish covers review too)", () => {
    expect(
      prGlyphColor(
        makeWindow({
          prNumber: 7,
          prState: "open",
          prIsDraft: true,
          prChecks: "pass",
          prReview: "changes_requested",
        }),
      ),
    ).toBe("text-red-400");
  });

  it("draft + checks pending → gray (draft outranks the pending-yellow branch)", () => {
    expect(
      prGlyphColor(
        makeWindow({ prNumber: 7, prState: "open", prIsDraft: true, prChecks: "pending" }),
      ),
    ).toBe("text-text-secondary");
  });

  it("merged + draft → purple (unreachable in practice; pins the open-gate)", () => {
    // GitHub un-drafts on merge, so this window shape never occurs live. The
    // assertion pins that the draft branch is `prState === "open"`-gated, which
    // is what keeps merged→purple untouched BY CONSTRUCTION rather than by luck.
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "merged", prIsDraft: true }))).toBe(
      "text-purple-400",
    );
  });

  // xuej: the closed branch — muted, ABOVE fail (stale checks on a dead PR
  // are noise). GitHub-exact red was rejected by the user (anti-clutter); the
  // ✕ icon, not the color, separates closed from failing and from draft.
  it("closed → muted gray (dead PR — the inert token)", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "closed" }))).toBe("text-text-secondary");
  });

  it("closed + failing checks → muted (closed wins over fail — stale checks are noise)", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "closed", prChecks: "fail" }))).toBe(
      "text-text-secondary",
    );
  });

  it("closed + changes requested → muted (isFailish review signal ignored for a dead PR)", () => {
    expect(
      prGlyphColor(makeWindow({ prNumber: 7, prState: "closed", prReview: "changes_requested" })),
    ).toBe("text-text-secondary");
  });

  it("closed + draft → muted (closed wins over the open-gated draft branch)", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "closed", prIsDraft: true }))).toBe(
      "text-text-secondary",
    );
  });
});
