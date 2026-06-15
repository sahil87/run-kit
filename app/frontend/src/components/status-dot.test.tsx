import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusDot } from "./status-dot";
import { statusDotState, fabPhase, fabShape, prShape } from "./pr-status-line";
import type { WindowInfo } from "@/types";

afterEach(() => {
  cleanup();
});

function makeWindow(overrides: Partial<WindowInfo> = {}): WindowInfo {
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

describe("statusDotState precedence (PR > fab > tmux)", () => {
  it("PR wins: change-bound window WITH a PR renders the purple PR phase", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", fabStage: "apply", prNumber: 7, prState: "merged" }),
    );
    expect(state).toEqual({ phase: "pr", shape: "done" });
  });

  it("fab drives when there is a fab change but no PR", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", fabStage: "apply", fabDisplayState: "active" }),
    );
    expect(state).toEqual({ phase: "execution", shape: "solid" });
  });

  it("tmux drives when not change-bound (solid for active)", () => {
    const state = statusDotState(makeWindow({ activity: "active" }));
    expect(state).toEqual({ phase: "none", shape: "solid" });
  });

  it("tmux drives when not change-bound (ring for idle)", () => {
    const state = statusDotState(makeWindow({ activity: "idle" }));
    expect(state).toEqual({ phase: "none", shape: "ring" });
  });

  it("a prNumber without a fabChange does NOT trigger the PR phase (falls to tmux)", () => {
    const state = statusDotState(makeWindow({ prNumber: 7, activity: "idle" }));
    expect(state).toEqual({ phase: "none", shape: "ring" });
  });
});

describe("fabPhase — README 4-phase grouping", () => {
  it("maps intake → intake", () => expect(fabPhase("intake")).toBe("intake"));
  it("maps apply → execution", () => expect(fabPhase("apply")).toBe("execution"));
  it("maps review → execution", () => expect(fabPhase("review")).toBe("execution"));
  it("maps hydrate → completion", () => expect(fabPhase("hydrate")).toBe("completion"));
  it("maps ship → shipping", () => expect(fabPhase("ship")).toBe("shipping"));
  it("maps review-pr → shipping", () => expect(fabPhase("review-pr")).toBe("shipping"));
  it("maps unknown/absent → none", () => {
    expect(fabPhase("paused")).toBe("none");
    expect(fabPhase(undefined)).toBe("none");
  });
});

describe("fabShape — display-state → shape vocabulary", () => {
  it("maps pending → ring", () => expect(fabShape("pending")).toBe("ring"));
  it("maps active → solid", () => expect(fabShape("active")).toBe("solid"));
  it("maps ready → solid", () => expect(fabShape("ready")).toBe("solid"));
  it("maps failed → failed", () => expect(fabShape("failed")).toBe("failed"));
  it("maps done → done", () => expect(fabShape("done")).toBe("done"));
  it("maps skipped → skipped", () => expect(fabShape("skipped")).toBe("skipped"));
  it("defaults unknown/absent → solid (a live fab window still reads live)", () => {
    expect(fabShape("paused")).toBe("solid");
    expect(fabShape(undefined)).toBe("solid");
  });
});

describe("prShape — reuses prDotState semantics", () => {
  it("maps merged → done", () =>
    expect(prShape(makeWindow({ prState: "merged" }))).toBe("done"));
  it("maps failing checks → failed", () =>
    expect(prShape(makeWindow({ prState: "open", prChecks: "fail" }))).toBe("failed"));
  it("maps changes_requested → failed (fail beats healthy)", () =>
    expect(
      prShape(makeWindow({ prState: "open", prChecks: "pass", prReview: "changes_requested" })),
    ).toBe("failed"));
  it("maps pending checks → ring", () =>
    expect(prShape(makeWindow({ prState: "open", prChecks: "pending" }))).toBe("ring"));
  it("maps passing checks (healthy) → solid", () =>
    expect(prShape(makeWindow({ prState: "open", prChecks: "pass" }))).toBe("solid"));
  it("maps an open PR with no decisive signal (neutral) → solid", () =>
    expect(prShape(makeWindow({ prState: "open" }))).toBe("solid"));
  it("maps a closed-unmerged PR (neutral) → skipped (gray ring)", () =>
    expect(prShape(makeWindow({ prState: "closed" }))).toBe("skipped"));
  it("a closed PR with failing checks still reads failed (isFailish wins)", () =>
    expect(prShape(makeWindow({ prState: "closed", prChecks: "fail" }))).toBe("failed"));
});

describe("StatusDot — rendering shapes", () => {
  it("renders a solid filled circle in the phase hue for an active fab stage", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "active" })} />);
    const dot = screen.getByLabelText("apply — active");
    expect(dot.className).toContain("text-amber-400");
    expect(dot.className).toContain("rounded-full");
    expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
  });

  it("renders intake in blue", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "intake", fabDisplayState: "active" })} />);
    expect(screen.getByLabelText("intake — active").className).toContain("text-blue-400");
  });

  it("renders shipping (ship) in green", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "ship", fabDisplayState: "active" })} />);
    expect(screen.getByLabelText("ship — active").className).toContain("text-accent-green");
  });

  it("renders hydrate (completion) in the SAME amber as execution", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "hydrate", fabDisplayState: "active" })} />);
    expect(screen.getByLabelText("hydrate — active").className).toContain("text-amber-400");
  });

  it("renders a hollow ring (transparent fill + border) for a pending stage", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "pending" })} />);
    const dot = screen.getByLabelText("apply — pending");
    expect(dot.className).toContain("text-amber-400");
    expect(dot.getAttribute("style")).toContain("border");
    expect(dot.getAttribute("style")).toContain("transparent");
    expect(dot.textContent).toBe("");
  });

  it("renders a dashed ring + a red center dot for a failed stage (NOT a whole-dot red)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed" })} />);
    const dot = screen.getByLabelText("review — failed");
    // Outer ring stays in the phase hue (amber), dashed border, transparent fill.
    expect(dot.className).toContain("text-amber-400");
    expect(dot.className).not.toContain("text-red-400");
    expect(dot.getAttribute("style")).toContain("dashed");
    expect(dot.getAttribute("style")).toContain("transparent");
    // The ONLY red is the small center child dot.
    const center = dot.querySelector("span");
    expect(center).not.toBeNull();
    expect(center!.className).toContain("bg-red-400");
  });

  it("renders a rounded square (not a circle) for a done stage", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "ship", fabDisplayState: "done" })} />);
    const dot = screen.getByLabelText("ship — done");
    expect(dot.className).toContain("rounded-[1px]");
    expect(dot.className).not.toContain("rounded-full");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
  });

  it("renders a gray hollow ring for a skipped stage regardless of phase", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "skipped" })} />);
    const dot = screen.getByLabelText("apply — skipped");
    expect(dot.className).toContain("text-text-secondary");
    expect(dot.className).not.toContain("text-amber-400");
    expect(dot.getAttribute("style")).toContain("border");
    expect(dot.getAttribute("style")).toContain("transparent");
  });
});

describe("StatusDot — PR phase (purple, same shape language)", () => {
  const prWin = (overrides: Partial<WindowInfo>) =>
    makeWindow({ fabChange: "260615-x", prNumber: 386, ...overrides });

  it("merged → purple rounded square (done)", () => {
    render(<StatusDot win={prWin({ prState: "merged", prChecks: "fail" })} />);
    const dot = screen.getByLabelText("PR — merged");
    expect(dot.className).toContain("text-purple-400");
    expect(dot.className).toContain("rounded-[1px]");
  });

  it("open/healthy → purple solid circle", () => {
    render(<StatusDot win={prWin({ prState: "open", prChecks: "pass" })} />);
    const dot = screen.getByLabelText("PR — open");
    expect(dot.className).toContain("text-purple-400");
    expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
  });

  it("checks pending → purple ring", () => {
    render(<StatusDot win={prWin({ prState: "open", prChecks: "pending" })} />);
    const dot = screen.getByLabelText("PR — checks running");
    expect(dot.className).toContain("text-purple-400");
    expect(dot.getAttribute("style")).toContain("transparent");
  });

  it("failing → purple dashed ring + red center", () => {
    render(<StatusDot win={prWin({ prState: "open", prChecks: "fail" })} />);
    const dot = screen.getByLabelText("PR — failing");
    expect(dot.className).toContain("text-purple-400");
    expect(dot.getAttribute("style")).toContain("dashed");
    expect(dot.querySelector("span")!.className).toContain("bg-red-400");
  });

  it("closed-unmerged → gray skipped ring labelled 'PR — closed'", () => {
    render(<StatusDot win={prWin({ prState: "closed" })} />);
    const dot = screen.getByLabelText("PR — closed");
    // `skipped` forces gray regardless of the purple PR phase, rendered as a
    // hollow ring (transparent fill + border), matching docs/specs/status-dot.md.
    expect(dot.className).toContain("text-text-secondary");
    expect(dot.className).not.toContain("text-purple-400");
    expect(dot.getAttribute("style")).toContain("border");
    expect(dot.getAttribute("style")).toContain("transparent");
  });

  it("PR wins over a failed fab stage (no whole-dot red, reads purple)", () => {
    render(<StatusDot win={prWin({ prState: "open", prChecks: "pass", fabStage: "review", fabDisplayState: "failed" })} />);
    const dot = screen.getByLabelText("PR — open");
    expect(dot.className).toContain("text-purple-400");
    expect(dot.className).not.toContain("text-red-400");
  });
});

describe("StatusDot — tmux fallback (monochrome)", () => {
  it("renders a gray filled dot for an active plain window (no color)", () => {
    render(<StatusDot win={makeWindow({ activity: "active" })} />);
    const dot = screen.getByLabelText("active");
    expect(dot.className).toContain("text-text-secondary");
    expect(dot.className).not.toContain("accent-green");
    expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
    expect(dot.getAttribute("style")).not.toContain("transparent");
  });

  it("renders a gray hollow ring for an idle plain window", () => {
    render(<StatusDot win={makeWindow({ activity: "idle" })} />);
    const dot = screen.getByLabelText("idle");
    expect(dot.className).toContain("text-text-secondary");
    expect(dot.getAttribute("style")).toContain("border");
    expect(dot.getAttribute("style")).toContain("transparent");
  });

  it("uses the bare activity word as the label (no journey)", () => {
    render(<StatusDot win={makeWindow({ activity: "active" })} />);
    expect(screen.queryByLabelText(/—/)).toBeNull(); // no "phase — status" composition
    expect(screen.getByLabelText("active")).toBeInTheDocument();
  });
});

describe("StatusDot — accessibility label composition", () => {
  it("composes '{stage} — {status}' for fab windows", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "pending" })} />);
    const dot = screen.getByLabelText("apply — pending");
    expect(dot.getAttribute("title")).toBe("apply — pending");
    expect(dot.getAttribute("role")).toBe("img");
  });

  it("composes 'PR — {status}' for the PR phase (PR-native words)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", prNumber: 9, prState: "merged" })} />);
    const dot = screen.getByLabelText("PR — merged");
    expect(dot.getAttribute("title")).toBe("PR — merged");
  });
});
