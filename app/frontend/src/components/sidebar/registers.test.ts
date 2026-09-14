import { describe, it, expect } from "vitest";
import {
  getOutputLine,
  getAgentLine,
  getFabParts,
  getFabLine,
  getOperatorParts,
  getPrParts,
  getPrSegments,
  getTmxLabel,
  splitDatePrefix,
} from "./registers";
import { makeWindow, makeWindowWithPanes } from "@/test-utils/fixtures";

describe("getTmxLabel (tmx identity row)", () => {
  // paneIndex values start at 1 here: tmux's #{pane_index} honours
  // pane-base-index, and the ordinal must not be derived from it.
  it("a single pane reads its id alone — no pane n/m for the common case", () => {
    const win = makeWindow({
      panes: [{ paneId: "%107", paneIndex: 1, cwd: "/home", command: "zsh", isActive: true }],
    });
    expect(getTmxLabel(win)).toBe("%107");
  });

  it("multi-pane: the id leads and the ordinal only disambiguates", () => {
    const win = makeWindow({
      panes: [
        { paneId: "%107", paneIndex: 1, cwd: "/home", command: "zsh", isActive: false },
        { paneId: "%108", paneIndex: 2, cwd: "/home", command: "zsh", isActive: false },
        { paneId: "%109", paneIndex: 3, cwd: "/home", command: "claude", isActive: true },
      ],
    });
    expect(getTmxLabel(win)).toBe("%109 · 3/3");
  });

  it("single pane with an empty paneId reads empty", () => {
    const win = makeWindow({
      panes: [{ paneId: "", paneIndex: 1, cwd: "/home", command: "zsh", isActive: true }],
    });
    expect(getTmxLabel(win)).toBe("");
  });

  it("no panes reads empty (nothing to say, nothing to copy)", () => {
    expect(getTmxLabel(makeWindow({}))).toBe("");
    expect(getTmxLabel(makeWindow({ panes: [] }))).toBe("");
  });

  it("panes but none active: ordinal falls back to 1 and NO id is shown (the id comes only from the active pane)", () => {
    const win = makeWindow({
      panes: [
        { paneId: "%107", paneIndex: 1, cwd: "/home", command: "zsh", isActive: false },
        { paneId: "%108", paneIndex: 2, cwd: "/home", command: "zsh", isActive: false },
      ],
    });
    expect(getTmxLabel(win)).toBe("1/2");
  });

  it("multi-pane with an empty active paneId: the ordinal alone disambiguates", () => {
    const win = makeWindow({
      panes: [
        { paneId: "%107", paneIndex: 1, cwd: "/home", command: "zsh", isActive: false },
        { paneId: "", paneIndex: 2, cwd: "/home", command: "zsh", isActive: true },
      ],
    });
    expect(getTmxLabel(win)).toBe("2/2");
  });
});

// The register-line resolvers live in this shared module so the PANE panel,
// the row-hover flyout card, and the status bar render from one source. These
// tests pin the resolver behavior; the panel's own rendering coverage lives in
// status-panel.test.tsx.

describe("getOutputLine (L0)", () => {
  it("active window with a command: '<cmd> · flowing'", () => {
    expect(getOutputLine(makeWindowWithPanes({ activity: "active" }), 1000)).toBe("zsh · flowing");
  });

  it("active window without a command: bare 'flowing'", () => {
    expect(getOutputLine(makeWindow({ activity: "active" }), 1000)).toBe("flowing");
  });

  it("idle window with command + timestamp: '<cmd> · idle Xm' — no narration", () => {
    expect(getOutputLine(makeWindowWithPanes({ activity: "idle", activityTimestamp: 760 }), 1000)).toBe(
      "zsh · idle 4m",
    );
  });

  it("idle window with no command but a timestamp: 'idle Xm'", () => {
    expect(getOutputLine(makeWindow({ activity: "idle", activityTimestamp: 940 }), 1000)).toBe(
      "idle 1m",
    );
  });

  it("idle window with a command but no usable timestamp: bare '<cmd>'", () => {
    expect(getOutputLine(makeWindowWithPanes({ activity: "idle", activityTimestamp: 0 }), 1000)).toBe("zsh");
    expect(getOutputLine(makeWindowWithPanes({ activity: "idle", activityTimestamp: 1000 }), 1000)).toBe(
      "zsh",
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

  it("the slug is written once: a branch carrying the change drops it", () => {
    const win = makeWindow({
      fabChange: "260805-93dy-row-flyout",
      fabStage: "review",
      fabDisplayState: "failed",
    });
    expect(getFabLine(win, "260805-93dy-row-flyout")).toBe("93dy · review · failed");
  });

  it("a branch NOT carrying the change keeps the slug (the off-branch signal)", () => {
    const win = makeWindow({ fabChange: "260805-93dy-row-flyout", fabStage: "apply" });
    expect(getFabLine(win, "main")).toBe("93dy row-flyout · apply");
    expect(getFabLine(win, "t7vy-launch")).toBe("93dy row-flyout · apply");
    // A same-suffix-but-different-id branch is not the change's branch.
    expect(getFabLine(win, "260901-zzzz-row-flyout")).toBe("93dy row-flyout · apply");
  });
});

describe("splitDatePrefix", () => {
  it("splits a leading six-digit date prefix", () => {
    expect(splitDatePrefix("260913-png4-compose-default-on")).toEqual({
      prefix: "260913-",
      rest: "png4-compose-default-on",
    });
  });

  it("no prefix: empty prefix, the whole branch as rest", () => {
    expect(splitDatePrefix("main")).toEqual({ prefix: "", rest: "main" });
    expect(splitDatePrefix("26091-short")).toEqual({ prefix: "", rest: "26091-short" });
    expect(splitDatePrefix("")).toEqual({ prefix: "", rest: "" });
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

  it("a branch carrying the change yields no slug", () => {
    const win = makeWindow({ fabChange: "260805-93dy-row-flyout", fabStage: "apply" });
    expect(getFabParts(win, "260805-93dy-row-flyout")).toEqual({ id: "93dy", stage: "apply" });
  });

  it("`main` and no branch argument both keep the slug", () => {
    const win = makeWindow({ fabChange: "260805-93dy-row-flyout", fabStage: "apply" });
    expect(getFabParts(win, "main")?.slug).toBe("row-flyout");
    expect(getFabParts(win)?.slug).toBe("row-flyout");
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

describe("getPrParts (L3 identity/health split)", () => {
  it("null without a prNumber — even with a bare prUrl", () => {
    expect(getPrParts(makeWindow({}))).toBeNull();
    expect(getPrParts(makeWindow({ prUrl: "https://github.com/o/r/pull/9" }))).toBeNull();
  });

  it("open PR: identity is number + state, health is checks + review", () => {
    const win = makeWindow({ prNumber: 241, prState: "open", prChecks: "pass", prReview: "approved" });
    expect(getPrParts(win)).toEqual({
      identity: [
        { text: "#241", color: "text-text-primary" },
        { text: "open", color: "text-accent-green" },
      ],
      health: [
        { text: "checks pass", color: "text-accent-green" },
        { text: "review: approved", color: "text-accent-green" },
      ],
    });
  });

  it("checks-only and review-only leave the other half out; `none` counts as absent", () => {
    expect(getPrParts(makeWindow({ prNumber: 7, prState: "open", prChecks: "fail" }))?.health).toEqual([
      { text: "checks fail", color: "text-signal-red" },
    ]);
    expect(
      getPrParts(makeWindow({ prNumber: 7, prState: "open", prChecks: "none", prReview: "approved" }))?.health,
    ).toEqual([{ text: "review: approved", color: "text-accent-green" }]);
    expect(getPrParts(makeWindow({ prNumber: 7, prState: "open", prChecks: "none", prReview: "none" }))?.health).toEqual([]);
  });

  it("a draft's suffix rides the identity state segment", () => {
    expect(getPrParts(makeWindow({ prNumber: 7, prState: "open", prIsDraft: true }))?.identity[1]).toEqual({
      text: "open (draft)",
      color: "text-accent-green",
    });
  });

  it("merged/closed: health is EMPTY — checks and review are history once the PR leaves open", () => {
    const merged = getPrParts(
      makeWindow({ prNumber: 241, prState: "merged", prChecks: "fail", prReview: "changes_requested" }),
    );
    expect(merged?.identity.map((s) => s.text)).toEqual(["#241", "merged"]);
    expect(merged?.health).toEqual([]);
    expect(getPrParts(makeWindow({ prNumber: 241, prState: "closed", prChecks: "pass" }))?.health).toEqual([]);
  });

  it("no state yet: identity is the bare number and health still renders (the PR is treated as open)", () => {
    const parts = getPrParts(makeWindow({ prNumber: 9, prChecks: "pending" }));
    expect(parts?.identity.map((s) => s.text)).toEqual(["#9"]);
    expect(parts?.health.map((s) => s.text)).toEqual(["checks pending"]);
  });

  it("getPrSegments is exactly identity followed by health", () => {
    for (const win of [
      makeWindow({ prNumber: 241, prState: "open", prChecks: "pass", prReview: "approved" }),
      makeWindow({ prNumber: 540, prState: "open", prIsDraft: true, prChecks: "pending", prReview: "changes_requested" }),
      makeWindow({ prNumber: 241, prState: "merged", prChecks: "fail" }),
      makeWindow({ prNumber: 9 }),
    ]) {
      const parts = getPrParts(win)!;
      expect(getPrSegments(win)).toEqual([...parts.identity, ...parts.health]);
    }
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

  it("owner-only window resolves to the done head — no facets, no tick, operator facts ignored", () => {
    expect(
      getOperatorParts(makeWindow({ owner: "operator" }), { stale: true, lastTickAt: 880 }, 1000),
    ).toEqual({ head: "done · operator-touched" });
  });

  it("monitored wins over owner — the watched head, owner ignored", () => {
    expect(
      getOperatorParts(
        makeWindow({ monitored: true, monitoredStage: "apply", owner: "operator" }),
        { stale: false, lastTickAt: 880 },
        1000,
      ),
    ).toEqual({ head: "watched · apply · tick 2m ago" });
  });

  it("neither monitored nor owner → null", () => {
    expect(getOperatorParts(makeWindow({}), undefined, 1000)).toBeNull();
  });
});
