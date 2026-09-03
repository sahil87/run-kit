import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { prOwnsGlyph, prGlyphColor, PR_STATE_COLORS, statusDotState, fabPhase } from "./pr-status-model";
import { makeWindow } from "@/test-utils/fixtures";

afterEach(() => {
  cleanup();
});

// Compositional vocabulary (status-pyramid.md): two families joined at the
// top. Hue = phase; shape = LIVENESS derived per family (journey hues read the
// rolled-up agentState ONLY — solid iff "active"; the output-flowing L0
// fallback is the gray floor's alone); `failed` and `waiting` are additive
// overlay flags. The dot tells the LOCAL story only — PR state never owns the
// dot (it lives on the row glyph).
describe("statusDotState — two-family ladder, shape = liveness", () => {
  it("PR eviction: a change-bound window with a merged PR renders the FAB arm, never a PR phase", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", fabStage: "apply", prNumber: 7, prState: "merged" }),
    );
    expect(state).toEqual({ phase: "building", shape: "ring", failed: false, waiting: false });
  });

  it("fab building: intake/apply/review (no PR consulted) → blue", () => {
    for (const stage of ["intake", "apply", "review"]) {
      const state = statusDotState(
        makeWindow({ fabChange: "260615-x", fabStage: stage, fabDisplayState: "active" }),
      );
      expect(state).toEqual({ phase: "building", shape: "ring", failed: false, waiting: false });
    }
  });

  it("fab PR-ready: ship/review-pr/done → green (the two-stop split)", () => {
    for (const stage of ["ship", "review-pr", "done"]) {
      const state = statusDotState(
        makeWindow({ fabChange: "260615-x", fabStage: stage, fabDisplayState: "active" }),
      );
      expect(state).toEqual({ phase: "prReady", shape: "ring", failed: false, waiting: false });
    }
  });

  it("fab hue + live agent (agentState active) → solid in the stage hue", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", fabStage: "apply", fabDisplayState: "active", agentState: "active" }),
    );
    expect(state).toEqual({ phase: "building", shape: "solid", failed: false, waiting: false });
  });

  it("the stale-active case: a stage-active fab window with an idle agent renders a RING", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", fabStage: "ship", fabDisplayState: "active", agentState: "idle" }),
    );
    expect(state).toEqual({ phase: "prReady", shape: "ring", failed: false, waiting: false });
  });

  it("flowing output never makes a journey hue solid (L0 is the floor's alone)", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", fabStage: "apply", fabDisplayState: "active", activity: "active" }),
    );
    expect(state.shape).toBe("ring");
  });

  it("parked-done change → green resting ring", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", fabStage: "review-pr", fabDisplayState: "done" }),
    );
    expect(state).toEqual({ phase: "prReady", shape: "ring", failed: false, waiting: false });
  });

  it("failed displayState → the additive failed flag, composed with EITHER shape", () => {
    expect(
      statusDotState(
        makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed", agentState: "active" }),
      ),
    ).toEqual({ phase: "building", shape: "solid", failed: true, waiting: false });
    expect(
      statusDotState(
        makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed", agentState: "idle" }),
      ),
    ).toEqual({ phase: "building", shape: "ring", failed: true, waiting: false });
    expect(
      statusDotState(
        makeWindow({ fabChange: "x", fabStage: "review-pr", fabDisplayState: "failed" }),
      ),
    ).toEqual({ phase: "prReady", shape: "ring", failed: true, waiting: false });
  });

  it("skipped displayState: NOT a fab-owned dot — falls through to the gray floor", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", fabStage: "apply", fabDisplayState: "skipped", activity: "idle" }),
    );
    expect(state).toEqual({ phase: "none", shape: "ring", waiting: false });
  });

  it("skipped displayState with a fresh agent: the ladder continues to the agent arm", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", fabStage: "apply", fabDisplayState: "skipped", agentState: "active" }),
    );
    expect(state).toEqual({ phase: "agent", shape: "solid", waiting: false });
  });

  it("ad-hoc agent active → yellow solid (warm family)", () => {
    const state = statusDotState(makeWindow({ agentState: "active" }));
    expect(state).toEqual({ phase: "agent", shape: "solid", waiting: false });
  });

  it("ad-hoc agent idle → yellow ring", () => {
    const state = statusDotState(makeWindow({ agentState: "idle" }));
    expect(state).toEqual({ phase: "agent", shape: "ring", waiting: false });
  });

  it("ad-hoc agent with a PR → still the yellow agent arm (no agentPr phase)", () => {
    const state = statusDotState(makeWindow({ agentState: "active", prNumber: 9, prState: "open", prChecks: "pass" }));
    expect(state).toEqual({ phase: "agent", shape: "solid", waiting: false });
  });

  it("floor: no fab change, no fresh agent — monochrome tmux activity (solid for active)", () => {
    const state = statusDotState(makeWindow({ activity: "active" }));
    expect(state).toEqual({ phase: "none", shape: "solid", waiting: false });
  });

  it("floor: idle → gray ring", () => {
    const state = statusDotState(makeWindow({ activity: "idle" }));
    expect(state).toEqual({ phase: "none", shape: "ring", waiting: false });
  });

  it("a prNumber with NO fab change and NO fresh agent stays on the gray floor (the glyph carries the PR)", () => {
    const state = statusDotState(makeWindow({ prNumber: 7, prState: "open", activity: "idle" }));
    expect(state).toEqual({ phase: "none", shape: "ring", waiting: false });
  });

  it("waiting is additive AND at rest: ring base + waiting flag on every tier", () => {
    // fab intake + waiting → blue ring, waiting flag set.
    expect(statusDotState(makeWindow({ fabChange: "x", fabStage: "intake", fabDisplayState: "active", agentState: "waiting" })))
      .toEqual({ phase: "building", shape: "ring", failed: false, waiting: true });
    // fab review failed + waiting → blue ring + failed flag + halo.
    expect(statusDotState(makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed", agentState: "waiting" })))
      .toEqual({ phase: "building", shape: "ring", failed: true, waiting: true });
    // ad-hoc waiting → yellow ring (blocked is at rest), waiting flag set.
    expect(statusDotState(makeWindow({ agentState: "waiting" })))
      .toEqual({ phase: "agent", shape: "ring", waiting: true });
  });
});

describe("fabPhase — the two-stop split (stage-based, never PR-based)", () => {
  it.each([
    { stages: ["intake", "apply", "review"], want: "building" },
    { stages: ["ship", "review-pr", "done"], want: "prReady" },
    { stages: ["hydrate", "paused", undefined], want: "prReady" },
  ] as const)("maps $stages to $want", ({ stages, want }) => {
    for (const stage of stages) expect(fabPhase(stage)).toBe(want);
  });
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
  it.each([
    { label: "plain", fields: {} },
    { label: "passing checks", fields: { prChecks: "pass" } },
    { label: "failing checks", fields: { prChecks: "fail" } },
    { label: "changes requested", fields: { prReview: "changes_requested" } },
    { label: "draft", fields: { prIsDraft: true } },
  ] as const)("closed + $label stays red", ({ fields }) => {
    const color = prGlyphColor(makeWindow({ prNumber: 7, prState: "closed", ...fields }));
    expect(color).toBe("text-signal-red");
    expect(color).toBe(PR_STATE_COLORS.closed);
  });
});
