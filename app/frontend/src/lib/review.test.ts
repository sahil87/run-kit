import { beforeEach, describe, expect, it } from "vitest";
import {
  isSuggestionOnlyBody,
  isUnhandled,
  lineRef,
  quotedCodeSpans,
  readViewed,
  splitPath,
  statusLabel,
  suggestionBody,
  threadState,
  threadsForFile,
  unhandledCount,
  viewedStorageKey,
  writeViewed,
  type ReviewDocument,
  type ReviewThread,
} from "./review";

function thread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "T1",
    isResolved: false,
    isOutdated: false,
    path: "a.go",
    line: 12,
    side: "RIGHT",
    comments: [
      {
        id: "C1",
        databaseId: 101,
        author: "reviewer",
        body: "fix this",
        createdAt: "2026-09-19T10:00:00Z",
        eyes: false,
      },
    ],
    ...overrides,
  };
}

describe("isUnhandled — actor-blind", () => {
  it("admits an open, unmarked thread", () => {
    expect(isUnhandled(thread())).toBe(true);
  });

  it("refuses a thread marked by ANYONE — the predicate does no identity join", () => {
    for (const author of ["me", "someone-else", ""]) {
      const marked = thread({
        comments: [{ ...thread().comments[0], author, eyes: true }],
      });
      expect(isUnhandled(marked)).toBe(false);
    }
  });

  it("refuses resolved and outdated threads", () => {
    expect(isUnhandled(thread({ isResolved: true }))).toBe(false);
    expect(isUnhandled(thread({ isOutdated: true }))).toBe(false);
  });

  it("refuses a zero-comment thread — no marker target, and the digest drops it too", () => {
    expect(isUnhandled(thread({ comments: [] }))).toBe(false);
  });

  it("admits a thread the viewer wrote themselves — commenting on your own PR is the primary use case", () => {
    const own = thread({ comments: [{ ...thread().comments[0], author: "me" }] });
    expect(isUnhandled(own)).toBe(true);
  });
});

describe("threadState", () => {
  it("stays dispatched after a reply lands — the backend never re-queues on one", () => {
    const marked = thread({ comments: [{ ...thread().comments[0], eyes: true }] });
    expect(threadState(marked)).toBe("dispatched");

    const replied = thread({
      comments: [
        { ...thread().comments[0], eyes: true },
        { ...thread().comments[0], id: "C2", eyes: false, body: "still broken" },
      ],
    });
    expect(threadState(replied)).toBe("dispatched");
  });

  it("resolved and outdated take precedence over the marker", () => {
    expect(threadState(thread({ isResolved: true }))).toBe("resolved");
    expect(threadState(thread({ isOutdated: true }))).toBe("outdated");
    expect(threadState(thread())).toBe("open");
  });
});

describe("suggestion blocks", () => {
  const fence = "```suggestion\nreturn nil\n```";

  it("recognizes a suggestion-only body and extracts it", () => {
    expect(isSuggestionOnlyBody(fence)).toBe(true);
    expect(suggestionBody(fence)).toBe("return nil");
  });

  it("an argument plus a suggestion is not suggestion-only", () => {
    const mixed = `this is wrong because…\n${fence}`;
    expect(isSuggestionOnlyBody(mixed)).toBe(false);
    expect(suggestionBody(mixed)).toBe("return nil");
  });

  it("other fences and unterminated fences are not suggestions", () => {
    expect(isSuggestionOnlyBody("```go\nreturn nil\n```")).toBe(false);
    expect(isSuggestionOnlyBody("```suggestion\nreturn nil")).toBe(false);
    expect(suggestionBody("plain prose")).toBeUndefined();
  });
});

describe("quotedCodeSpans — what a reviewer is pointing at", () => {
  it("pulls backtick-quoted symbols out of prose, deduped", () => {
    expect(quotedCodeSpans("rename `reviewMeta` to match `hasCode`")).toEqual([
      "reviewMeta",
      "hasCode",
    ]);
    expect(quotedCodeSpans("`a` and `a` again")).toEqual(["a"]);
  });

  it("stops at a fence — a suggestion is a replacement, not a reference", () => {
    expect(quotedCodeSpans("see `prUrl`:\n```suggestion\nreturn `x`\n```")).toEqual(["prUrl"]);
    expect(quotedCodeSpans("no quotes here")).toEqual([]);
    expect(quotedCodeSpans("an empty `` pair")).toEqual([]);
  });
});

describe("unhandledCount + threadsForFile", () => {
  const doc = {
    threads: [
      thread({ id: "T1" }),
      thread({ id: "T2", isResolved: true }),
      thread({ id: "T3", path: "b.ts" }),
    ],
  } as ReviewDocument;

  it("counts only unhandled threads, so the signal goes quiet as work is claimed", () => {
    expect(unhandledCount(doc)).toBe(2);
    expect(unhandledCount(null)).toBe(0);
  });

  it("leaves the dot quiet for a zero-comment thread the listener would never dispatch", () => {
    const malformed = { threads: [thread({ id: "T4", comments: [] })] } as ReviewDocument;
    expect(unhandledCount(malformed)).toBe(0);
  });

  it("scopes threads to their file", () => {
    expect(threadsForFile(doc, "a.go").map((t) => t.id)).toEqual(["T1", "T2"]);
    expect(threadsForFile(doc, "nope.go")).toEqual([]);
  });
});

describe("viewed state — per viewer, reset by the head sha", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips and clears", () => {
    expect(readViewed("pr", "sha1", "a.go")).toBe(false);
    writeViewed("pr", "sha1", "a.go", true);
    expect(readViewed("pr", "sha1", "a.go")).toBe(true);
    writeViewed("pr", "sha1", "a.go", false);
    expect(readViewed("pr", "sha1", "a.go")).toBe(false);
  });

  it("a new head sha reads as not-viewed — the push reset, matching GitHub", () => {
    writeViewed("pr", "sha1", "a.go", true);
    expect(readViewed("pr", "sha2", "a.go")).toBe(false);
    // The old key survives; nothing has to be swept because the sha keys it.
    expect(readViewed("pr", "sha1", "a.go")).toBe(true);
  });

  it("a malformed stored value reads as not-viewed", () => {
    localStorage.setItem(viewedStorageKey("pr", "sha1", "a.go"), "yes-please");
    expect(readViewed("pr", "sha1", "a.go")).toBe(false);
  });
});

describe("display helpers", () => {
  it("renders GitHub's own line reference", () => {
    expect(lineRef("R", 264)).toBe("R264");
    expect(lineRef("L", 120)).toBe("L120");
  });

  it("splits a path into a dim directory and a bold name", () => {
    expect(splitPath("app/backend/api/router.go")).toEqual({
      dir: "app/backend/api/",
      name: "router.go",
    });
    expect(splitPath("README.md")).toEqual({ dir: "", name: "README.md" });
  });

  it("labels gh file statuses", () => {
    expect(statusLabel("added")).toBe("Added");
    expect(statusLabel("removed")).toBe("Removed");
    expect(statusLabel("renamed")).toBe("Renamed");
    expect(statusLabel("modified")).toBe("Modified");
    expect(statusLabel("whatever-new")).toBe("Modified");
  });
});

describe("eager expansion — what the server decided, and what the tile does with it", () => {
  // The wire contract the surface seeds from. A file carrying `rows` was
  // expanded by the server's budget and costs the tile nothing to open; a file
  // carrying `collapsed` was declined and must still say so on screen.
  const expandedFile = {
    path: "small.go",
    status: "modified",
    additions: 4,
    deletions: 1,
    hasPatch: true,
    rowCount: 6,
    rows: [{ kind: "hunk" as const, header: "@@ -1,2 +1,5 @@", left: 0, right: 0, at: 0, l: 0, side: "R" as const }],
  };
  const largeFile = {
    path: "pnpm-lock.yaml",
    status: "modified",
    additions: 9000,
    deletions: 12,
    hasPatch: true,
    rowCount: 9012,
    collapsed: "large" as const,
  };
  const budgetFile = {
    path: "tail.go",
    status: "modified",
    additions: 3,
    deletions: 0,
    hasPatch: true,
    rowCount: 3,
    collapsed: "budget" as const,
  };

  it("distinguishes an expanded file from the two collapsed reasons", () => {
    expect(expandedFile.rows).toBeDefined();
    expect("collapsed" in expandedFile).toBe(false);
    // A collapsed file never ships rows — that is the whole saving.
    expect("rows" in largeFile).toBe(false);
    expect("rows" in budgetFile).toBe(false);
    // …but it always ships its height, so the placeholder is sized right.
    expect(largeFile.rowCount).toBeGreaterThan(0);
    expect(budgetFile.rowCount).toBeGreaterThan(0);
  });

  it("carries structure without spans, so opening the PR buys no colour", () => {
    for (const row of expandedFile.rows) {
      expect(row).not.toHaveProperty("spans");
    }
  });
});
