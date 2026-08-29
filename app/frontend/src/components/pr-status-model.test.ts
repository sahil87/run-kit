import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { prOwnsGlyph, prGlyphColor, PR_STATE_COLORS } from "./pr-status-model";
import { makeWindow } from "@/test-utils/fixtures";

// NOTE (260715-jykd): the `PrStatusLine` component (and its render tests) were
// retired — it had zero live mount sites. This module exercises the RETAINED
// exports of pr-status-model.ts. (The `prDotState` five-state enum was retired
// too — its only live read collapsed into `prGlyphColor`'s `isFailish` branch,
// so precedence coverage lives on the `prGlyphColor` suite below.)

afterEach(() => {
  cleanup();
});

// aqo6 → xuej: `prOwnsDot` renamed `prOwnsGlyph` — after PR eviction the
// predicate gates ONLY the rest-state PR glyph (window row + session tiles),
// never any dot tier. The gate is a positive allowlist (`open`/`merged`/
// `closed`): closed owns in its distinct red ✕ form; an
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

  // Closed earns the glyph — rendered red with the distinct ✕ icon.
  it("owns for a closed-unmerged PR (red ✕ glyph, D2)", () => {
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

// Glyph color follows the shared vocabulary — a SIX-way chain: red for a
// CLOSED PR (GitHub's closed red, agreeing with PR_STATE_COLORS.closed; the ✕
// icon, not the color, separates closed from fail-ish), red for fail-ish, then gray for an
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
      "text-signal-purple",
    );
    expect(
      prGlyphColor(makeWindow({ prNumber: 7, prState: "merged", prReview: "changes_requested" })),
    ).toBe("text-signal-purple");
  });

  it("checks pending → yellow (checks running — the NEW glyph state)", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "open", prChecks: "pending" }))).toBe(
      "text-signal-yellow",
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
      "text-signal-red",
    );
  });

  it("changes requested → red (isFailish covers review too)", () => {
    expect(
      prGlyphColor(
        makeWindow({ prNumber: 7, prState: "open", prChecks: "pass", prReview: "changes_requested" }),
      ),
    ).toBe("text-signal-red");
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
    ).toBe("text-signal-red");
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
    ).toBe("text-signal-red");
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
      "text-signal-purple",
    );
  });

  // The closed branch — GitHub red, ABOVE fail (stale checks on a dead PR are
  // noise; closed-with-passing-checks must not fall through to green). Closed
  // and fail-ish share red; the ✕ icon separates them, and closed's red vs
  // draft's gray separates those two.
  it("closed → red (GitHub's closed coloring; agrees with PR_STATE_COLORS.closed)", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "closed" }))).toBe("text-signal-red");
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "closed" }))).toBe(PR_STATE_COLORS.closed);
  });

  it("closed + passing checks → red (closed wins over the open-green fall-through)", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "closed", prChecks: "pass" }))).toBe(
      "text-signal-red",
    );
  });

  it("closed + failing checks → red via the closed branch (closed sits above isFailish)", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "closed", prChecks: "fail" }))).toBe(
      "text-signal-red",
    );
  });

  it("closed + changes requested → red (closed branch, not the isFailish one, owns it)", () => {
    expect(
      prGlyphColor(makeWindow({ prNumber: 7, prState: "closed", prReview: "changes_requested" })),
    ).toBe("text-signal-red");
  });

  it("closed + draft → red (closed wins over the open-gated draft branch)", () => {
    expect(prGlyphColor(makeWindow({ prNumber: 7, prState: "closed", prIsDraft: true }))).toBe(
      "text-signal-red",
    );
  });
});
