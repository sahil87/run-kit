import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusDot, dotLabel } from "./status-dot";
import { statusDotState } from "./pr-status-model";
import { makeWindow } from "@/test-utils/fixtures";

afterEach(() => {
  cleanup();
});

// Rendering + labels for the compositional vocabulary (status-pyramid.md):
// hue = phase, shape = liveness (solid = work happening NOW, ring = at rest),
// failed = additive red-center overlay (ring + center at rest; bullseye over
// solid), waiting = additive halo. The dot tells the LOCAL story only — PR
// state never owns the dot (it lives on the row glyph). The state-derivation
// matrix lives in pr-status-model.test.ts.
describe("StatusDot — rendering shapes (compositional vocabulary)", () => {
  it("renders a blue solid circle for a building stage with a live worker (apply + agentState active)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "active", agentState: "active" })} />);
    const dot = screen.getByLabelText("building — worker live");
    expect(dot.className).toContain("text-signal-blue");
    expect(dot.className).not.toContain("text-accent-green");
    expect(dot.className).toContain("rounded-full");
    expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
  });

  it("renders a stage-active fab window with NO live agent as a RING (liveness, not bookkeeping)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "active" })} />);
    const dot = screen.getByLabelText("building — at rest");
    expect(dot.className).toContain("text-signal-blue");
    expect(dot.getAttribute("style")).toContain("transparent");
  });

  it("renders ship (PR-ready) in green", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "ship", fabDisplayState: "active" })} />);
    const dot = screen.getByLabelText("PR-ready — at rest");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.className).not.toContain("text-signal-blue");
  });

  it("renders review (building) in blue — NOT green", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "active", agentState: "active" })} />);
    const dot = screen.getByLabelText("building — worker live");
    expect(dot.className).toContain("text-signal-blue");
    expect(dot.className).not.toContain("text-accent-green");
  });

  it("renders a parked-done change as a green hollow ring (no square anywhere)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "review-pr", fabDisplayState: "done" })} />);
    const dot = screen.getByLabelText("PR-ready — at rest");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.className).not.toContain("rounded-none");
    expect(dot.getAttribute("style")).toContain("transparent");
  });

  it("renders an ad-hoc agent (active) as a yellow solid dot", () => {
    render(<StatusDot win={makeWindow({ agentState: "active" })} />);
    const dot = screen.getByLabelText("agent — active");
    expect(dot.className).toContain("text-signal-yellow");
    expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
  });

  it("renders an ad-hoc agent (idle) as a yellow ring", () => {
    render(<StatusDot win={makeWindow({ agentState: "idle" })} />);
    const dot = screen.getByLabelText("agent — idle");
    expect(dot.className).toContain("text-signal-yellow");
    expect(dot.getAttribute("style")).toContain("transparent");
  });

  it("flagged ring: failed at rest renders a 9px solid-border ring with a red center (no dotted border)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed" })} />);
    const dot = screen.getByLabelText("building — failed — at rest");
    expect(dot.className).toContain("text-signal-blue");
    expect(dot.className).not.toContain("text-signal-red");
    expect(dot.className).toContain("w-[9px]");
    expect(dot.getAttribute("style")).toContain("1.8px solid");
    expect(dot.getAttribute("style")).not.toContain("dotted");
    const center = dot.querySelector("span");
    expect(center!.className).toContain("bg-signal-red");
    expect(center!.className).toContain("w-[3px]");
  });

  it("flagged solid: failed with a live rework agent renders the 9px bullseye (dark gap ring + red center)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed", agentState: "active" })} />);
    const dot = screen.getByLabelText("building — failed — rework live");
    expect(dot.className).toContain("text-signal-blue");
    expect(dot.className).toContain("w-[9px]");
    expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
    expect(dot.getAttribute("style")).not.toContain("dotted");
    // The gap ring: a background-colored circle between fill and red center.
    const gap = dot.querySelector("span");
    expect(gap!.className).toContain("bg-bg-primary");
    const center = gap!.querySelector("span");
    expect(center!.className).toContain("bg-signal-red");
    expect(center!.className).toContain("w-[3px]");
  });

  it("renders a failed review-pr stage in green (the overlay rides the stage hue)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "review-pr", fabDisplayState: "failed", agentState: "active" })} />);
    const dot = screen.getByLabelText("PR-ready — failed — rework live");
    expect(dot.className).toContain("text-accent-green");
  });

  it("unflagged dots keep the uniform 7px footprint; flagged dots step up to 9px", () => {
    render(<StatusDot win={makeWindow({ agentState: "active" })} />);
    const dot = screen.getByLabelText("agent — active");
    expect(dot.className).toContain("w-[7px]");
    expect(dot.className).not.toContain("w-[9px]");
  });

  it("renders a skipped stage via the floor (gray tmux dot, bare activity label)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "skipped", activity: "idle" })} />);
    const dot = screen.getByLabelText("idle");
    expect(dot.className).toContain("text-text-secondary");
    expect(dot.className).not.toContain("text-signal-blue");
  });
});

describe("StatusDot — PR eviction (the dot never renders PR state)", () => {
  it("fab window with a merged PR renders its fab tier, never purple", () => {
    render(<StatusDot win={makeWindow({ fabChange: "260615-x", fabStage: "review-pr", fabDisplayState: "done", prNumber: 386, prState: "merged", prChecks: "fail" })} />);
    expect(screen.queryByLabelText(/PR — /)).toBeNull();
    const dot = screen.getByLabelText("PR-ready — at rest");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.className).not.toContain("text-signal-purple");
    expect(dot.className).not.toContain("rounded-none");
  });

  it("ad-hoc agent with an open PR stays a yellow agent dot, never orange", () => {
    render(<StatusDot win={makeWindow({ agentState: "active", prNumber: 9, prState: "open", prChecks: "pass" })} />);
    const dot = screen.getByLabelText("agent — active");
    expect(dot.className).toContain("text-signal-yellow");
    expect(dot.className).not.toContain("text-orange-400");
  });

  it("a failing PR never turns the dot: the fab liveness shape is unchanged (glyph-red carries the PR failure)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "260615-x", fabStage: "ship", fabDisplayState: "active", agentState: "active", prNumber: 386, prState: "open", prChecks: "fail" })} />);
    const dot = screen.getByLabelText("PR-ready — worker live");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
  });
});

describe("StatusDot — additive waiting halo", () => {
  it("wraps a waiting dot in the constant-yellow halo over the RING base (blocked is at rest)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "intake", fabDisplayState: "active", agentState: "waiting", agentIdleDuration: "3m" })} />);
    const dot = screen.getByLabelText("building — at rest — agent waiting 3m");
    // Core hue kept.
    expect(dot.className).toContain("text-signal-blue");
    // Ring base — waiting never renders solid.
    expect(dot.getAttribute("style")).toContain("transparent");
    // Additive halo class present (signal-yellow ring — semantic constant, value
    // per-theme via --color-signal-yellow; static under reduced-motion via globals.css).
    expect(dot.className).toContain("rk-waiting-halo");
  });

  it("waiting on a failed review keeps the red-center overlay + blue hue, adds the halo", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed", agentState: "waiting" })} />);
    const dot = screen.getByLabelText("building — failed — at rest — agent waiting");
    expect(dot.className).toContain("text-signal-blue");
    expect(dot.getAttribute("style")).not.toContain("dotted");
    expect(dot.querySelector("span")!.className).toContain("bg-signal-red");
    expect(dot.className).toContain("rk-waiting-halo");
  });

  it("a waiting ad-hoc agent renders ring + halo, never solid", () => {
    render(<StatusDot win={makeWindow({ agentState: "waiting", agentIdleDuration: "2m" })} />);
    const dot = screen.getByLabelText("agent — idle — agent waiting 2m");
    expect(dot.getAttribute("style")).toContain("transparent");
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

describe("dotLabel — hue-word + liveness-word + flags composition", () => {
  it("composes '{hue-word} — {liveness}' for fab windows (no native title)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "pending" })} />);
    const dot = screen.getByLabelText("building — at rest");
    expect(dot.getAttribute("aria-label")).toBe("building — at rest");
    expect(dot.getAttribute("role")).toBe("img");
    expect(dot.getAttribute("title")).toBeNull();
  });

  it("solid fab dot reads 'worker live'", () => {
    const win = makeWindow({ fabChange: "x", fabStage: "intake", fabDisplayState: "ready", agentState: "active" });
    expect(dotLabel(win, statusDotState(win))).toBe("building — worker live");
  });

  it("appends the agent-waiting suffix on every tier (with duration)", () => {
    const win = makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed", agentState: "waiting", agentIdleDuration: "3m" });
    expect(dotLabel(win, statusDotState(win))).toBe("building — failed — at rest — agent waiting 3m");
  });

  it("no attention suffix when not waiting", () => {
    const win = makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "active" });
    expect(dotLabel(win, statusDotState(win))).toBe("building — at rest");
  });

  it("never uses PR words — a merged-PR parked change reads 'PR-ready — at rest'", () => {
    const win = makeWindow({ fabChange: "x", fabStage: "review-pr", fabDisplayState: "done", prNumber: 7, prState: "merged" });
    expect(dotLabel(win, statusDotState(win))).toBe("PR-ready — at rest");
  });

  it("ad-hoc agent idle label reads 'agent — idle' (agent-native, not a fab-stage word)", () => {
    const win = makeWindow({ agentState: "idle" });
    expect(dotLabel(win, statusDotState(win))).toBe("agent — idle");
  });
});

// The hover-card content-resolution suite moved with the surface: the
// per-dot StatusDotTip was replaced by the sidebar row flyout card —
// see sidebar/row-flyout-card.test.tsx for the card content coverage.
