import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusDot, dotLabel } from "./status-dot";
import { dotTipContent } from "./status-dot-tip";
import { statusDotState, fabPhase, fabShape, prShape } from "./pr-status-model";
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

// Palette v3 (status-pyramid.md) — two families joined at the top plus an
// additive waiting overlay. These cases enumerate the decision-table rows.
describe("statusDotState — two-family ladder (palette v3)", () => {
  it("fab PR: change-bound WITH a PR renders the purple `pr` phase", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", fabStage: "apply", prNumber: 7, prState: "merged" }),
    );
    expect(state).toEqual({ phase: "pr", shape: "done", waiting: false });
  });

  it("fab intake (no PR) → blue", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", fabStage: "intake", fabDisplayState: "active" }),
    );
    expect(state).toEqual({ phase: "intake", shape: "solid", waiting: false });
  });

  it("fab apply/review/hydrate/ship all collapse to the green `apply` phase (green collapse)", () => {
    for (const stage of ["apply", "review", "hydrate", "ship", "review-pr"]) {
      const state = statusDotState(
        makeWindow({ fabChange: "260615-x", fabStage: stage, fabDisplayState: "active" }),
      );
      expect(state).toEqual({ phase: "apply", shape: "solid", waiting: false });
    }
  });

  it("ad-hoc agent active → yellow solid (warm family)", () => {
    const state = statusDotState(makeWindow({ agentState: "active" }));
    expect(state).toEqual({ phase: "agent", shape: "solid", waiting: false });
  });

  it("ad-hoc agent idle → yellow ring", () => {
    const state = statusDotState(makeWindow({ agentState: "idle" }));
    expect(state).toEqual({ phase: "agent", shape: "ring", waiting: false });
  });

  it("ad-hoc agent with a PR → orange `agentPr` phase (shape from prShape)", () => {
    const state = statusDotState(makeWindow({ agentState: "active", prNumber: 9, prState: "open", prChecks: "pass" }));
    expect(state).toEqual({ phase: "agentPr", shape: "solid", waiting: false });
  });

  it("floor: no fab change, no fresh agent — monochrome tmux activity (solid for active)", () => {
    const state = statusDotState(makeWindow({ activity: "active" }));
    expect(state).toEqual({ phase: "none", shape: "solid", waiting: false });
  });

  it("floor: idle → gray ring", () => {
    const state = statusDotState(makeWindow({ activity: "idle" }));
    expect(state).toEqual({ phase: "none", shape: "ring", waiting: false });
  });

  it("D1: a prNumber with NO fab change and NO fresh agent stays on the gray floor (PR never owns a plain pane's dot)", () => {
    const state = statusDotState(makeWindow({ prNumber: 7, prState: "open", activity: "idle" }));
    expect(state).toEqual({ phase: "none", shape: "ring", waiting: false });
  });

  it("D2: a closed-unmerged PR on a live fab change falls back to the green fab tier (not a dead PR)", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", fabStage: "apply", fabDisplayState: "active", prNumber: 7, prState: "closed" }),
    );
    expect(state).toEqual({ phase: "apply", shape: "solid", waiting: false });
  });

  it("D2: a merged PR (retained) still owns the dot as the purple done-square", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", prNumber: 7, prState: "merged" }),
    );
    expect(state).toEqual({ phase: "pr", shape: "done", waiting: false });
  });

  it("waiting is additive: set on every tier, core phase/shape unchanged", () => {
    // fab intake + waiting → blue core kept, waiting flag set.
    expect(statusDotState(makeWindow({ fabChange: "x", fabStage: "intake", fabDisplayState: "active", agentState: "waiting" })))
      .toEqual({ phase: "intake", shape: "solid", waiting: true });
    // fab review failed + waiting → green failed kept.
    expect(statusDotState(makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed", agentState: "waiting" })))
      .toEqual({ phase: "apply", shape: "failed", waiting: true });
    // ad-hoc waiting → yellow solid (mid-turn), waiting flag set.
    expect(statusDotState(makeWindow({ agentState: "waiting" })))
      .toEqual({ phase: "agent", shape: "solid", waiting: true });
  });
});

describe("fabPhase — palette-v3 (green collapse)", () => {
  it("maps intake → intake", () => expect(fabPhase("intake")).toBe("intake"));
  it("maps every other stage → apply (green collapse)", () => {
    for (const s of ["apply", "review", "hydrate", "ship", "review-pr"]) {
      expect(fabPhase(s)).toBe("apply");
    }
  });
  it("maps unknown/absent → apply (a live fab window still reads green, not gray)", () => {
    expect(fabPhase("paused")).toBe("apply");
    expect(fabPhase(undefined)).toBe("apply");
  });
});

describe("fabShape — display-state → shape vocabulary (unchanged)", () => {
  it("maps pending → ring", () => expect(fabShape("pending")).toBe("ring"));
  it("maps active → solid", () => expect(fabShape("active")).toBe("solid"));
  it("maps ready → solid", () => expect(fabShape("ready")).toBe("solid"));
  it("maps failed → failed", () => expect(fabShape("failed")).toBe("failed"));
  it("maps done → done", () => expect(fabShape("done")).toBe("done"));
  it("maps skipped → skipped", () => expect(fabShape("skipped")).toBe("skipped"));
  it("defaults unknown/absent → solid", () => {
    expect(fabShape("paused")).toBe("solid");
    expect(fabShape(undefined)).toBe("solid");
  });
});

describe("prShape — reuses prDotState semantics (unchanged)", () => {
  it("merged → done", () => expect(prShape(makeWindow({ prState: "merged" }))).toBe("done"));
  it("failing checks → failed", () =>
    expect(prShape(makeWindow({ prState: "open", prChecks: "fail" }))).toBe("failed"));
  it("pending checks → ring", () =>
    expect(prShape(makeWindow({ prState: "open", prChecks: "pending" }))).toBe("ring"));
  it("passing checks (healthy) → solid", () =>
    expect(prShape(makeWindow({ prState: "open", prChecks: "pass" }))).toBe("solid"));
  it("closed-unmerged (neutral) → skipped", () =>
    expect(prShape(makeWindow({ prState: "closed" }))).toBe("skipped"));
});

describe("StatusDot — rendering shapes (palette v3)", () => {
  it("renders a green solid circle for an active fab stage (apply → green)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "active" })} />);
    const dot = screen.getByLabelText("apply — active");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.className).not.toContain("text-amber-400");
    expect(dot.className).toContain("rounded-full");
    expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
  });

  it("renders intake in blue", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "intake", fabDisplayState: "active" })} />);
    expect(screen.getByLabelText("intake — active").className).toContain("text-blue-400");
  });

  it("renders review (green collapse) in green — NOT amber", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "active" })} />);
    const dot = screen.getByLabelText("review — active");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.className).not.toContain("text-amber-400");
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

  it("renders a failed fab stage as a green dotted ring + red center (no whole-dot red)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed" })} />);
    const dot = screen.getByLabelText("review — failed");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.className).not.toContain("text-red-400");
    expect(dot.getAttribute("style")).toContain("dotted");
    const center = dot.querySelector("span");
    expect(center!.className).toContain("bg-red-400");
  });

  it("renders a gray hollow ring for a skipped stage regardless of phase", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "skipped" })} />);
    const dot = screen.getByLabelText("apply — skipped");
    expect(dot.className).toContain("text-text-secondary");
    expect(dot.className).not.toContain("text-accent-green");
  });
});

describe("StatusDot — additive waiting halo", () => {
  it("wraps a waiting dot in the constant-yellow halo, core hue+shape kept (blue intake stays blue)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "intake", fabDisplayState: "active", agentState: "waiting", agentIdleDuration: "3m" })} />);
    const dot = screen.getByLabelText("intake — active — agent waiting 3m");
    // Core hue kept.
    expect(dot.className).toContain("text-blue-400");
    // Additive halo class present (constant-yellow ring; static under reduced-motion via globals.css).
    expect(dot.className).toContain("rk-waiting-halo");
  });

  it("waiting on a green-failed review keeps the failed shape + green hue, adds the halo", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed", agentState: "waiting" })} />);
    const dot = screen.getByLabelText("review — failed — agent waiting");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.getAttribute("style")).toContain("dotted");
    expect(dot.className).toContain("rk-waiting-halo");
  });

  it("a non-waiting dot has no halo class", () => {
    render(<StatusDot win={makeWindow({ agentState: "active" })} />);
    expect(screen.getByLabelText("agent — active").className).not.toContain("rk-waiting-halo");
  });
});

describe("StatusDot — PR phase (purple fab / orange agent)", () => {
  it("fab merged → purple square (done)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "260615-x", prNumber: 386, prState: "merged", prChecks: "fail" })} />);
    const dot = screen.getByLabelText("PR — merged");
    expect(dot.className).toContain("text-purple-400");
    expect(dot.className).toContain("rounded-none");
  });

  it("ad-hoc agent PR (open/healthy) → orange solid", () => {
    render(<StatusDot win={makeWindow({ agentState: "active", prNumber: 9, prState: "open", prChecks: "pass" })} />);
    const dot = screen.getByLabelText("PR — open");
    expect(dot.className).toContain("text-orange-400");
    expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
  });

  it("fab PR wins over a failed fab stage (reads purple, no whole-dot red)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "260615-x", prNumber: 386, prState: "open", prChecks: "pass", fabStage: "review", fabDisplayState: "failed" })} />);
    const dot = screen.getByLabelText("PR — open");
    expect(dot.className).toContain("text-purple-400");
    expect(dot.className).not.toContain("text-red-400");
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

describe("dotLabel — attention composition", () => {
  it("composes '{stage} — {status}' for fab windows (no native title)", () => {
    render(<StatusDot win={makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "pending" })} />);
    const dot = screen.getByLabelText("apply — pending");
    expect(dot.getAttribute("aria-label")).toBe("apply — pending");
    expect(dot.getAttribute("role")).toBe("img");
    expect(dot.getAttribute("title")).toBeNull();
  });

  it("appends the agent-waiting suffix on every tier (with duration)", () => {
    const state = statusDotState(makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed", agentState: "waiting", agentIdleDuration: "3m" }));
    expect(dotLabel(makeWindow({ fabChange: "x", fabStage: "review", fabDisplayState: "failed", agentState: "waiting", agentIdleDuration: "3m" }), state))
      .toBe("review — failed — agent waiting 3m");
  });

  it("no attention suffix when not waiting", () => {
    const win = makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "active" });
    expect(dotLabel(win, statusDotState(win))).toBe("apply — active");
  });

  it("ad-hoc agent idle label reads 'agent — idle' (agent-native, not fab 'pending')", () => {
    const win = makeWindow({ agentState: "idle" });
    expect(dotLabel(win, statusDotState(win))).toBe("agent — idle");
  });
});

describe("dotTipContent — hover-card content resolution", () => {
  it("fab PR dot with a prUrl yields one 'Open PR #N' link", () => {
    const win = makeWindow({ fabChange: "260615-x", prNumber: 386, prState: "open", prChecks: "pass", prUrl: "https://github.com/o/r/pull/386" });
    const state = statusDotState(win);
    expect(state.phase).toBe("pr");
    const content = dotTipContent(win, state);
    expect(content.links).toEqual([{ label: "Open PR #386", href: "https://github.com/o/r/pull/386", testid: "dot-tip-pr-link" }]);
  });

  it("ad-hoc agentPr dot with a prUrl also yields the 'Open PR #N' link", () => {
    const win = makeWindow({ agentState: "active", prNumber: 9, prState: "open", prChecks: "pass", prUrl: "https://github.com/o/r/pull/9" });
    const state = statusDotState(win);
    expect(state.phase).toBe("agentPr");
    expect(dotTipContent(win, state).links).toHaveLength(1);
  });

  it("adds the agent line on every tier when an agentState exists", () => {
    const win = makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "active", agentState: "waiting", agentIdleDuration: "3m" });
    expect(dotTipContent(win, statusDotState(win)).agent).toBe("agent: waiting 3m");
  });

  it("omits the agent line when no agentState", () => {
    const win = makeWindow({ fabChange: "x", fabStage: "apply", fabDisplayState: "active" });
    expect(dotTipContent(win, statusDotState(win)).agent).toBeNull();
  });

  it("floor dot yields no links and the bare activity label", () => {
    const win = makeWindow({ activity: "active" });
    const content = dotTipContent(win, statusDotState(win));
    expect(content.links).toHaveLength(0);
    expect(content.label).toBe("active");
  });

  it("a gray-floor pane WITH a prUrl still offers the 'Open PR #N' link (D1 universal derivation)", () => {
    // A plain window (no fab change, no fresh agent) stays on the gray floor —
    // its PR never OWNS the dot's hue (D1) — but the derived PR is UNIVERSAL
    // (Principle X), so the tip still surfaces the "Open PR" link.
    const win = makeWindow({ activity: "idle", prNumber: 7, prState: "open", prUrl: "https://github.com/o/r/pull/7" });
    const state = statusDotState(win);
    expect(state.phase).toBe("none"); // gray floor — PR does not own the dot
    expect(dotTipContent(win, state).links).toEqual([
      { label: "Open PR #7", href: "https://github.com/o/r/pull/7", testid: "dot-tip-pr-link" },
    ]);
  });

  // Freshness line (260715-nwla) — fetchedAtEpoch resolution.
  it("parses prFetchedAt to fetchedAtEpoch (seconds)", () => {
    const win = makeWindow({ prFetchedAt: "2026-07-15T10:00:00Z" });
    const content = dotTipContent(win, statusDotState(win));
    expect(content.fetchedAtEpoch).toBe(Math.floor(Date.parse("2026-07-15T10:00:00Z") / 1000));
  });

  it("fetchedAtEpoch is null when prFetchedAt is absent", () => {
    const win = makeWindow({});
    expect(dotTipContent(win, statusDotState(win)).fetchedAtEpoch).toBeNull();
  });

  it("fetchedAtEpoch is null when prFetchedAt is unparseable", () => {
    const win = makeWindow({ prFetchedAt: "not-a-date" });
    expect(dotTipContent(win, statusDotState(win)).fetchedAtEpoch).toBeNull();
  });
});
