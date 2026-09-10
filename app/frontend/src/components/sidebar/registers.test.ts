import { describe, it, expect } from "vitest";
import { getOutputLine, getAgentLine, getFabParts, getFabLine, getOperatorParts, getPrSegments } from "./registers";
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
      { text: "merged", color: "text-signal-purple" },
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
    expect(segs?.[2]).toEqual({ text: "checks fail", color: "text-signal-red" });
    expect(segs?.[3]).toEqual({ text: "review: changes requested", color: "text-signal-red" });
  });
});

// The parts resolvers feed the row-hover flyout card, which composes the fab
// and pr registers across multiple lines; the joined formatters above are
// pinned byte-identical for the PANE panel (status-panel.tsx) and status bar.
describe("getFabParts", () => {
  it("null under the same gate as getFabLine (no parseable change or no stage)", () => {
    expect(getFabParts(makeWindow({}))).toBeNull();
    expect(getFabParts(makeWindow({ fabChange: "260805-93dy-row-flyout" }))).toBeNull();
  });

  it("resolves id, slug, stage separately; displayState only when present", () => {
    expect(
      getFabParts(
        makeWindow({ fabChange: "260805-93dy-row-flyout", fabStage: "review", fabDisplayState: "failed" }),
      ),
    ).toEqual({ id: "93dy", slug: "row-flyout", stage: "review", displayState: "failed" });
    expect(getFabParts(makeWindow({ fabChange: "260805-93dy-row-flyout", fabStage: "apply" }))).toEqual({
      id: "93dy",
      slug: "row-flyout",
      stage: "apply",
    });
  });
});

describe("getPrSegments", () => {
  it("null without a prNumber — even with a bare prUrl", () => {
    expect(getPrSegments(makeWindow({}))).toBeNull();
    expect(getPrSegments(makeWindow({ prUrl: "https://github.com/o/r/pull/9" }))).toBeNull();
  });

  it("one flat list: number, state, then checks and review", () => {
    expect(
      getPrSegments(makeWindow({ prNumber: 241, prState: "open", prChecks: "pass", prReview: "approved" })),
    ).toEqual([
      { text: "#241", color: "text-text-primary" },
      { text: "open", color: "text-accent-green" },
      { text: "checks pass", color: "text-accent-green" },
      { text: "review: approved", color: "text-accent-green" },
    ]);
  });

  it("a merged PR drops checks and review — they are history once it lands", () => {
    expect(
      getPrSegments(
        makeWindow({ prNumber: 241, prState: "merged", prChecks: "fail", prReview: "changes_requested" }),
      ),
    ).toEqual([
      { text: "#241", color: "text-text-primary" },
      { text: "merged", color: "text-signal-purple" },
    ]);
  });

  it("an open draft keeps every segment — the widest line the register produces", () => {
    expect(
      getPrSegments(
        makeWindow({
          prNumber: 540,
          prState: "open",
          prIsDraft: true,
          prChecks: "pending",
          prReview: "changes_requested",
        }),
      )!.map((s) => s.text),
    ).toEqual(["#540", "open (draft)", "checks pending", "review: changes requested"]);
  });
});

describe("getOperatorParts (L4)", () => {
  it("null unless win.monitored === true", () => {
    expect(getOperatorParts(makeWindow({}), { stale: false, lastTickAt: 900 }, 1000)).toBeNull();
    expect(getOperatorParts(makeWindow({ monitored: false }), { stale: false }, 1000)).toBeNull();
  });

  it("head leads with the decisive tokens; facets are repo · branch", () => {
    const parts = getOperatorParts(
      makeWindow({
        monitored: true,
        monitoredStage: "apply",
        monitoredRepo: "run-kit",
        monitoredBranch: "fab/wuiu",
      }),
      { stale: false, lastTickAt: 880 },
      1000,
    );
    expect(parts).toEqual({ head: "watched · apply · tick 2m ago", facets: "run-kit · fab/wuiu" });
  });

  it("omits the stage segment when absent and the tick segment when lastTickAt is 0/undefined or operator is undefined", () => {
    expect(
      getOperatorParts(makeWindow({ monitored: true, monitoredStage: "review" }), { stale: false }, 1000),
    ).toEqual({ head: "watched · review" });
    expect(
      getOperatorParts(makeWindow({ monitored: true, monitoredStage: "review" }), { stale: false, lastTickAt: 0 }, 1000),
    ).toEqual({ head: "watched · review" });
    expect(getOperatorParts(makeWindow({ monitored: true, monitoredStage: "review" }), undefined, 1000)).toEqual({
      head: "watched · review",
    });
  });

  it("tick without a stage reads 'watched · tick <age> ago'; facets undefined when both absent", () => {
    expect(
      getOperatorParts(makeWindow({ monitored: true }), { stale: true, lastTickAt: 540 }, 1000),
    ).toEqual({ head: "watched · tick 7m ago" });
  });

  it("ages via formatDuration; a non-positive elapsed renders 'tick 0s ago'", () => {
    expect(
      getOperatorParts(makeWindow({ monitored: true }), { stale: false, lastTickAt: 1000 }, 1000)?.head,
    ).toBe("watched · tick 0s ago");
    expect(
      getOperatorParts(makeWindow({ monitored: true }), { stale: false, lastTickAt: 900 }, 700)?.head,
    ).toBe("watched · tick 0s ago");
  });

  it("omits empty facet segments", () => {
    expect(
      getOperatorParts(makeWindow({ monitored: true, monitoredRepo: "run-kit" }), undefined, 1000),
    ).toEqual({ head: "watched", facets: "run-kit" });
  });
});
