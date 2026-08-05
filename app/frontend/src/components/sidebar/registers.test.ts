import { describe, it, expect } from "vitest";
import { getOutputLine, getAgentLine, getFabLine, getPrSegments } from "./registers";
import { makeWindow, makeWindowWithPanes } from "@/test-utils/fixtures";

// 93dy: the register-line resolvers were extracted from status-panel.tsx into
// this shared module so the PANE panel and the row-hover flyout card render
// from one source. These tests pin the extracted behavior (the panel's own
// rendering coverage lives in status-panel.test.tsx and must keep passing
// unchanged).

describe("getOutputLine (L0)", () => {
  it("active window with a command: 'active · <command>'", () => {
    expect(getOutputLine(makeWindowWithPanes({ activity: "active" }), 1000)).toBe("active · zsh");
  });

  it("active window without a command: bare 'active'", () => {
    expect(getOutputLine(makeWindow({ activity: "active" }), 1000)).toBe("active");
  });

  it("idle window with command + timestamp: '<command> — idle Xs since last output'", () => {
    expect(getOutputLine(makeWindowWithPanes({ activity: "idle", activityTimestamp: 970 }), 1000)).toBe(
      "zsh — idle 30s since last output",
    );
  });

  it("idle window with no command but a timestamp: 'idle Xs since last output'", () => {
    expect(getOutputLine(makeWindow({ activity: "idle", activityTimestamp: 940 }), 1000)).toBe(
      "idle 1m since last output",
    );
  });

  it("idle window with neither command nor timestamp: bare 'idle'", () => {
    expect(getOutputLine(makeWindow({ activity: "idle", activityTimestamp: 0 }), 1000)).toBe("idle");
  });
});

describe("getAgentLine (L1)", () => {
  it("null when no agentState", () => {
    expect(getAgentLine(makeWindow({}))).toBeNull();
  });

  it("state + duration when the rk-computed duration is present", () => {
    expect(getAgentLine(makeWindow({ agentState: "waiting", agentIdleDuration: "3m" }))).toBe(
      "waiting 3m",
    );
  });

  it("bare state when no duration (active agents have none)", () => {
    expect(getAgentLine(makeWindow({ agentState: "active" }))).toBe("active");
  });
});

describe("getFabLine (L2)", () => {
  it("null when no fab change", () => {
    expect(getFabLine(makeWindow({}))).toBeNull();
  });

  it("null when a fab change exists but no stage", () => {
    expect(getFabLine(makeWindow({ fabChange: "260805-93dy-row-flyout" }))).toBeNull();
  });

  it("id + slug + stage without displayState", () => {
    expect(getFabLine(makeWindow({ fabChange: "260805-93dy-row-flyout", fabStage: "apply" }))).toBe(
      "93dy row-flyout · apply",
    );
  });

  it("appends the displayState segment when present", () => {
    expect(
      getFabLine(
        makeWindow({ fabChange: "260805-93dy-row-flyout", fabStage: "review", fabDisplayState: "failed" }),
      ),
    ).toBe("93dy row-flyout · review · failed");
  });
});

describe("getPrSegments (L3)", () => {
  it("null without a prNumber (the only gate — never fabChange)", () => {
    expect(getPrSegments(makeWindow({}))).toBeNull();
    expect(getPrSegments(makeWindow({ fabChange: "260805-93dy-x", prState: "open" }))).toBeNull();
  });

  it("open PR: number, state, checks, review — each with its vocabulary color", () => {
    const segs = getPrSegments(
      makeWindow({ prNumber: 241, prState: "open", prChecks: "pass", prReview: "approved" }),
    );
    expect(segs).toEqual([
      { text: "#241", color: "text-text-primary" },
      { text: "open", color: "text-accent-green" },
      { text: "checks pass", color: "text-accent-green" },
      { text: "review: approved", color: "text-accent-green" },
    ]);
  });

  it("merged PR suppresses historical checks/review", () => {
    const segs = getPrSegments(
      makeWindow({ prNumber: 241, prState: "merged", prChecks: "fail", prReview: "changes_requested" }),
    );
    expect(segs).toEqual([
      { text: "#241", color: "text-text-primary" },
      { text: "merged", color: "text-purple-400" },
    ]);
  });

  it("draft suffix rides the state segment and keeps the state color", () => {
    const segs = getPrSegments(makeWindow({ prNumber: 7, prState: "open", prIsDraft: true }));
    expect(segs?.[1]).toEqual({ text: "open (draft)", color: "text-accent-green" });
  });

  it("failing signals color red; review underscores become spaces", () => {
    const segs = getPrSegments(
      makeWindow({ prNumber: 7, prState: "open", prChecks: "fail", prReview: "changes_requested" }),
    );
    expect(segs?.[2]).toEqual({ text: "checks fail", color: "text-red-400" });
    expect(segs?.[3]).toEqual({ text: "review: changes requested", color: "text-red-400" });
  });
});
