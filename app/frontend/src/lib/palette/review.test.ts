import { describe, expect, it, vi } from "vitest";
import { buildReviewActions, type ReviewPaletteSeams } from "./review";

function seams(): { seams: ReviewPaletteSeams; calls: string[] } {
  const calls: string[] = [];
  const record = (name: string) => () => {
    calls.push(name);
  };
  return {
    calls,
    seams: {
      toggleListen: record("toggleListen"),
      toggleTree: record("toggleTree"),
      nextFile: record("nextFile"),
      previousFile: record("previousFile"),
      expandFocusedFile: record("expandFocusedFile"),
      commentOnFocusedLine: record("commentOnFocusedLine"),
      replyToFocusedThread: record("replyToFocusedThread"),
      resolveFocusedThread: record("resolveFocusedThread"),
      markFocusedViewed: record("markFocusedViewed"),
      refresh: record("refresh"),
    },
  };
}

describe("buildReviewActions", () => {
  it("covers every verb the spec requires to be palette-reachable", () => {
    const { seams: s } = seams();
    const ids = buildReviewActions(s, false).map((a) => a.id);
    expect(ids).toEqual([
      "review-listen",
      "review-tree",
      "review-next-file",
      "review-previous-file",
      "review-expand-file",
      "review-comment",
      "review-reply",
      "review-resolve",
      "review-mark-viewed",
      "review-refresh",
    ]);
  });

  it("names the destination state on the listen row, not the current one", () => {
    const { seams: s } = seams();
    expect(buildReviewActions(s, false)[0].label).toBe("Review: Listen for comments");
    expect(buildReviewActions(s, true)[0].label).toBe("Review: Stop listening for comments");
  });

  it("every entry runs its seam and claims no chord", () => {
    const { seams: s, calls } = seams();
    const actions = buildReviewActions(s, false);
    for (const action of actions) {
      expect(action.shortcut).toBe("");
      action.onSelect();
    }
    expect(calls).toEqual([
      "toggleListen",
      "toggleTree",
      "nextFile",
      "previousFile",
      "expandFocusedFile",
      "commentOnFocusedLine",
      "replyToFocusedThread",
      "resolveFocusedThread",
      "markFocusedViewed",
      "refresh",
    ]);
  });

  it("mounts nothing while the tile is absent — a predictably no-op entry is worse than none", () => {
    expect(buildReviewActions(null, false)).toEqual([]);
  });

  it("labels are prefixed so the group is findable by typing `Review:`", () => {
    const { seams: s } = seams();
    for (const action of buildReviewActions(s, false)) {
      expect(action.label.startsWith("Review: ")).toBe(true);
    }
  });
});

describe("palette parity", () => {
  it("has no duplicate ids", () => {
    const { seams: s } = seams();
    const ids = buildReviewActions(s, true).map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not throw when a seam is invoked twice (the entries are idempotent wrappers)", () => {
    const { seams: s } = seams();
    const listen = buildReviewActions(s, false)[0];
    expect(() => {
      listen.onSelect();
      listen.onSelect();
    }).not.toThrow();
    expect(vi.isMockFunction(listen.onSelect)).toBe(false);
  });
});
