import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusDot, dotLabel } from "./status-dot";
import { statusDotState, fabPhase, fabShape } from "./pr-status-model";
import { makeWindow } from "@/test-utils/fixtures";

afterEach(() => {
  cleanup();
});

// Compositional vocabulary (aqo6 — status-pyramid.md): two families joined at
// the top plus an additive waiting overlay. The dot tells the LOCAL story only
// — PR state never owns the dot (it lives on the row glyph). These cases
// enumerate the decision-table rows.
describe("statusDotState — two-family ladder (compositional vocabulary)", () => {
  it("PR eviction: a change-bound window with a merged PR renders the FAB arm, never a PR phase", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", fabStage: "apply", prNumber: 7, prState: "merged" }),
    );
    expect(state).toEqual({ phase: "building", shape: "solid", waiting: false });
  });

  it("fab building: intake/apply/review (no PR consulted) → blue", () => {
    for (const stage of ["intake", "apply", "review"]) {
      const state = statusDotState(
        makeWindow({ fabChange: "260615-x", fabStage: stage, fabDisplayState: "active" }),
      );
      expect(state).toEqual({ phase: "building", shape: "solid", waiting: false });
    }
  });

  it("fab PR-ready: ship/review-pr/done → green (the two-stop split)", () => {
    for (const stage of ["ship", "review-pr", "done"]) {
      const state = statusDotState(
        makeWindow({ fabChange: "260615-x", fabStage: stage, fabDisplayState: "active" }),
      );
      expect(state).toEqual({ phase: "prReady", shape: "solid", waiting: false });
    }
  });

  it("parked-done change → green resting ring (done maps to ring, not a square)", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", fabStage: "review-pr", fabDisplayState: "done" }),
    );
    expect(state).toEqual({ phase: "prReady", shape: "ring", waiting: false });
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

  it("waiting is additive: set on every tier, core phase/shape unchanged", () => {
    // fab intake + waiting → blue core kept, waiting flag set.
    expect(statusDotState(makeWindow({ fabChange: "x", fabStage: "intake", fabDisplayState: "active", agentState: "waiting" })))
      .toEqual({ phase: "building", shape: "solid", waiting: true });
    // fab review failed + waiting → blue failed kept.
    expect(statusDotState(makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed", agentState: "waiting" })))
      .toEqual({ phase: "building", shape: "failed", waiting: true });
    // ad-hoc waiting → yellow solid (mid-turn), waiting flag set.
    expect(statusDotState(makeWindow({ agentState: "waiting" })))
      .toEqual({ phase: "agent", shape: "solid", waiting: true });
  });
});

describe("fabPhase — the two-stop split (stage-based, never PR-based)", () => {
  it("maps intake/apply/review → building", () => {
    for (const s of ["intake", "apply", "review"]) {
      expect(fabPhase(s)).toBe("building");
    }
  });
  it("maps ship/review-pr/done → prReady", () => {
    for (const s of ["ship", "review-pr", "done"]) {
      expect(fabPhase(s)).toBe("prReady");
    }
  });
  it("maps unknown/absent → prReady (a live fab window still reads green, not gray)", () => {
    expect(fabPhase("hydrate")).toBe("prReady");
    expect(fabPhase("paused")).toBe("prReady");
    expect(fabPhase(undefined)).toBe("prReady");
  });
});

describe("fabShape — display-state → shape vocabulary (three shapes)", () => {
  it("maps pending → ring", () => expect(fabShape("pending")).toBe("ring"));
  it("maps active → solid", () => expect(fabShape("active")).toBe("solid"));
  it("maps ready → solid", () => expect(fabShape("ready")).toBe("solid"));
  it("maps failed → failed", () => expect(fabShape("failed")).toBe("failed"));
  it("maps done → ring (parked = resting)", () => expect(fabShape("done")).toBe("ring"));
  it("defaults unknown/absent → solid", () => {
    expect(fabShape("paused")).toBe("solid");
    expect(fabShape(undefined)).toBe("solid");
  });
});

describe("StatusDot — rendering shapes (compositional vocabulary)", () => {
  it("renders a blue solid circle for an active building stage (apply → blue)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "active" })} />);
    const dot = screen.getByLabelText("building — active");
    expect(dot.className).toContain("text-blue-400");
    expect(dot.className).not.toContain("text-accent-green");
    expect(dot.className).toContain("rounded-full");
    expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
  });

  it("renders ship (PR-ready) in green", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "ship", fabDisplayState: "active" })} />);
    const dot = screen.getByLabelText("PR-ready — active");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.className).not.toContain("text-blue-400");
  });

  it("renders review (building) in blue — NOT green", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "active" })} />);
    const dot = screen.getByLabelText("building — active");
    expect(dot.className).toContain("text-blue-400");
    expect(dot.className).not.toContain("text-accent-green");
  });

  it("renders a parked-done change as a green hollow ring (no square anywhere)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "review-pr", fabDisplayState: "done" })} />);
    const dot = screen.getByLabelText("PR-ready — parked");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.className).not.toContain("rounded-none");
    expect(dot.getAttribute("style")).toContain("transparent");
  });

  it("renders an ad-hoc agent (active) as a yellow solid dot", () => {
    render(<StatusDot win={makeWindow({ agentState: "active" })} />);
    const dot = screen.getByLabelText("agent — active");
    expect(dot.className).toContain("text-yellow-400");
    expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
  });

  it("renders an ad-hoc agent (idle) as a yellow ring", () => {
    render(<StatusDot win={makeWindow({ agentState: "idle" })} />);
    // Agent-native word: the idle ad-hoc agent reads "agent — idle" (NOT the
    // fab-stage "pending"), per the module doc + docs/site/status-dot.md.
    const dot = screen.getByLabelText("agent — idle");
    expect(dot.className).toContain("text-yellow-400");
    expect(dot.getAttribute("style")).toContain("transparent");
  });

  it("renders a failed building stage as a blue dotted ring + red center (no whole-dot red)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed" })} />);
    const dot = screen.getByLabelText("building — failed");
    expect(dot.className).toContain("text-blue-400");
    expect(dot.className).not.toContain("text-red-400");
    expect(dot.getAttribute("style")).toContain("dotted");
    const center = dot.querySelector("span");
    expect(center!.className).toContain("bg-red-400");
  });

  it("renders a failed review-pr stage as a green dotted ring + red center", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "review-pr", fabDisplayState: "failed" })} />);
    const dot = screen.getByLabelText("PR-ready — failed");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.getAttribute("style")).toContain("dotted");
  });

  it("renders a skipped stage via the floor (gray tmux dot, bare activity label)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "skipped", activity: "idle" })} />);
    const dot = screen.getByLabelText("idle");
    expect(dot.className).toContain("text-text-secondary");
    expect(dot.className).not.toContain("text-blue-400");
  });
});

describe("StatusDot — PR eviction (the dot never renders PR state)", () => {
  it("fab window with a merged PR renders its fab tier, never purple", () => {
    render(<StatusDot win={makeWindow({ fabChange: "260615-x", fabStage: "review-pr", fabDisplayState: "done", prNumber: 386, prState: "merged", prChecks: "fail" })} />);
    expect(screen.queryByLabelText(/PR — /)).toBeNull();
    const dot = screen.getByLabelText("PR-ready — parked");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.className).not.toContain("text-purple-400");
    expect(dot.className).not.toContain("rounded-none");
  });

  it("ad-hoc agent with an open PR stays a yellow agent dot, never orange", () => {
    render(<StatusDot win={makeWindow({ agentState: "active", prNumber: 9, prState: "open", prChecks: "pass" })} />);
    const dot = screen.getByLabelText("agent — active");
    expect(dot.className).toContain("text-yellow-400");
    expect(dot.className).not.toContain("text-orange-400");
  });

  it("a failing PR never turns the dot: the fab stage keeps its shape (glyph-red carries the failure)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "260615-x", fabStage: "ship", fabDisplayState: "active", prNumber: 386, prState: "open", prChecks: "fail" })} />);
    const dot = screen.getByLabelText("PR-ready — active");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
  });
});

describe("StatusDot — additive waiting halo", () => {
  it("wraps a waiting dot in the constant-yellow halo, core hue+shape kept (blue building stays blue)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "intake", fabDisplayState: "active", agentState: "waiting", agentIdleDuration: "3m" })} />);
    const dot = screen.getByLabelText("building — active — agent waiting 3m");
    // Core hue kept.
    expect(dot.className).toContain("text-blue-400");
    // Additive halo class present (constant-yellow ring; static under reduced-motion via globals.css).
    expect(dot.className).toContain("rk-waiting-halo");
  });

  it("waiting on a failed review keeps the failed shape + blue hue, adds the halo", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed", agentState: "waiting" })} />);
    const dot = screen.getByLabelText("building — failed — agent waiting");
    expect(dot.className).toContain("text-blue-400");
    expect(dot.getAttribute("style")).toContain("dotted");
    expect(dot.className).toContain("rk-waiting-halo");
  });

  it("a non-waiting dot has no halo class", () => {
    render(<StatusDot win={makeWindow({ agentState: "active" })} />);
    expect(screen.getByLabelText("agent — active").className).not.toContain("rk-waiting-halo");
  });
});

describe("StatusDot — floor (monochrome)", () => {
  it("gray filled dot for an active plain window", () => {
    render(<StatusDot win={makeWindow({ activity: "active" })} />);
    const dot = screen.getByLabelText("active");
    expect(dot.className).toContain("text-text-secondary");
    expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
  });

  it("gray hollow ring for an idle plain window, bare activity label", () => {
    render(<StatusDot win={makeWindow({ activity: "idle" })} />);
    const dot = screen.getByLabelText("idle");
    expect(dot.className).toContain("text-text-secondary");
    expect(dot.getAttribute("style")).toContain("transparent");
  });
});

describe("dotLabel — hue-word + status-word composition", () => {
  it("composes '{hue-word} — {status}' for fab windows (no native title)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "pending" })} />);
    const dot = screen.getByLabelText("building — pending");
    expect(dot.getAttribute("aria-label")).toBe("building — pending");
    expect(dot.getAttribute("role")).toBe("img");
    expect(dot.getAttribute("title")).toBeNull();
  });

  it("uses the displayState-derived status word (ready reads 'ready')", () => {
    const win = makeWindow({ fabChange: "x", fabStage: "intake", fabDisplayState: "ready" });
    expect(dotLabel(win, statusDotState(win))).toBe("building — ready");
  });

  it("appends the agent-waiting suffix on every tier (with duration)", () => {
    const win = makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed", agentState: "waiting", agentIdleDuration: "3m" });
    expect(dotLabel(win, statusDotState(win))).toBe("building — failed — agent waiting 3m");
  });

  it("no attention suffix when not waiting", () => {
    const win = makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "active" });
    expect(dotLabel(win, statusDotState(win))).toBe("building — active");
  });

  it("never uses PR words — a merged-PR parked change reads 'PR-ready — parked'", () => {
    const win = makeWindow({ fabChange: "x", fabStage: "review-pr", fabDisplayState: "done", prNumber: 7, prState: "merged" });
    expect(dotLabel(win, statusDotState(win))).toBe("PR-ready — parked");
  });

  it("ad-hoc agent idle label reads 'agent — idle' (agent-native, not fab 'pending')", () => {
    const win = makeWindow({ agentState: "idle" });
    expect(dotLabel(win, statusDotState(win))).toBe("agent — idle");
  });
});

// The hover-card content-resolution suite moved with the surface: the
// per-dot StatusDotTip was replaced by the sidebar row flyout card (93dy) —
// see sidebar/row-flyout-card.test.tsx for the card content coverage.
