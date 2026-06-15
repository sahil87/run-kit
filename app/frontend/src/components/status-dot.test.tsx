import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusDot } from "./status-dot";
import { statusDotState } from "./pr-status-line";
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

describe("statusDotState precedence", () => {
  it("returns the pr kind when the window is change-bound AND has a PR", () => {
    const state = statusDotState(
      makeWindow({ fabChange: "260615-x", prNumber: 7, prState: "merged" }),
    );
    expect(state.kind).toBe("pr");
    if (state.kind === "pr") expect(state.pr).toBe("merged");
  });

  it("falls back to activity when there is no prNumber", () => {
    const state = statusDotState(makeWindow({ fabChange: "260615-x", activity: "active" }));
    expect(state).toEqual({ kind: "activity", active: true });
  });

  it("falls back to activity when not change-bound (even with a prNumber)", () => {
    const state = statusDotState(makeWindow({ prNumber: 7, activity: "idle" }));
    expect(state).toEqual({ kind: "activity", active: false });
  });
});

describe("StatusDot — PR branch", () => {
  const prWin = (overrides: Partial<WindowInfo>) =>
    makeWindow({ fabChange: "260615-x", prNumber: 386, ...overrides });

  it("renders a purple solid merged dot (first match wins over historical checks)", () => {
    render(<StatusDot win={prWin({ prState: "merged", prChecks: "fail" })} />);
    const dot = screen.getByLabelText("PR merged");
    expect(dot.className).toContain("text-purple-400");
    expect(dot.textContent).toBe("●"); // ● solid glyph
  });

  it("renders a red solid fail dot when checks fail", () => {
    render(<StatusDot win={prWin({ prState: "open", prChecks: "fail" })} />);
    const dot = screen.getByLabelText(
      "PR needs attention — checks failing or changes requested",
    );
    expect(dot.className).toContain("text-red-400");
    expect(dot.textContent).toBe("●");
  });

  it("renders a red fail dot when review is changes_requested (fail beats healthy)", () => {
    render(
      <StatusDot win={prWin({ prState: "open", prChecks: "pass", prReview: "changes_requested" })} />,
    );
    const dot = screen.getByLabelText(
      "PR needs attention — checks failing or changes requested",
    );
    expect(dot.className).toContain("text-red-400");
  });

  it("renders a yellow pending dot when checks are running", () => {
    render(<StatusDot win={prWin({ prState: "open", prChecks: "pending" })} />);
    const dot = screen.getByLabelText("PR checks running");
    expect(dot.className).toContain("text-yellow-400");
    expect(dot.textContent).toBe("●");
  });

  it("renders a green solid healthy dot when checks pass", () => {
    render(<StatusDot win={prWin({ prState: "open", prChecks: "pass" })} />);
    const dot = screen.getByLabelText("PR checks passing");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.textContent).toBe("●");
  });

  it("renders a dim hollow neutral ring for an open PR with no decisive signal", () => {
    render(<StatusDot win={prWin({ prState: "open" })} />);
    const dot = screen.getByLabelText("PR open");
    expect(dot.className).toContain("text-text-secondary");
    // Hollow ring (border + transparent fill), no glyph — distinct from the
    // solid ● the live states use. jsdom normalizes `transparent`, so assert on
    // the raw style attribute string.
    expect(dot.getAttribute("style")).toContain("border");
    expect(dot.getAttribute("style")).toContain("transparent");
    expect(dot.textContent).toBe("");
  });

  it("keeps the PR_DOT_COLOR token even when the fab change failed (no red override on PR branch)", () => {
    // A PR window whose fab stage failed must still read its PR color, not red.
    render(
      <StatusDot win={prWin({ prState: "open", prChecks: "pass", fabDisplayState: "failed" })} />,
    );
    const dot = screen.getByLabelText("PR checks passing");
    expect(dot.className).toContain("text-accent-green");
    expect(dot.className).not.toContain("text-red-400");
  });
});

describe("StatusDot — activity fallback", () => {
  it("renders a gray filled dot for an active non-PR window (no green)", () => {
    render(<StatusDot win={makeWindow({ activity: "active" })} />);
    const dot = screen.getByLabelText("active");
    expect(dot.className).toContain("text-text-secondary");
    expect(dot.className).not.toContain("accent-green");
    // Filled: currentColor background, no transparent-fill ring (jsdom
    // serializes `border: none` as `border: medium`, so assert on the fill
    // distinction rather than the literal border string).
    expect(dot.getAttribute("style")).toContain("background-color: currentcolor");
    expect(dot.getAttribute("style")).not.toContain("transparent");
  });

  it("renders a gray hollow ring for an idle non-PR window", () => {
    render(<StatusDot win={makeWindow({ activity: "idle" })} />);
    const dot = screen.getByLabelText("idle");
    expect(dot.className).toContain("text-text-secondary");
    expect(dot.getAttribute("style")).toContain("border");
    expect(dot.getAttribute("style")).toContain("transparent");
  });

  it("colors the activity dot red when fabDisplayState is failed", () => {
    render(<StatusDot win={makeWindow({ activity: "idle", fabDisplayState: "failed" })} />);
    const dot = screen.getByLabelText("idle");
    expect(dot.className).toContain("text-red-400");
    expect(dot.className).not.toContain("text-text-secondary");
  });

  it("does not render any PR label for an activity-fallback window", () => {
    render(<StatusDot win={makeWindow({ activity: "active" })} />);
    expect(screen.queryByLabelText("PR open")).toBeNull();
    expect(screen.queryByLabelText("PR merged")).toBeNull();
  });
});
