import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PrStatusLine, prDotState } from "./pr-status-line";
import type { WindowInfo } from "@/types";

vi.mock("@/api/client", () => ({
  refreshPrStatus: vi.fn(() => Promise.resolve({ ok: true })),
}));
import { refreshPrStatus } from "@/api/client";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeWindow(overrides: Partial<WindowInfo>): WindowInfo {
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

describe("PrStatusLine", () => {
  it("returns null when not change-bound", () => {
    const { container } = render(
      <PrStatusLine win={makeWindow({ prNumber: 1, fabChange: undefined })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null when there is no prNumber", () => {
    const { container } = render(
      <PrStatusLine win={makeWindow({ fabChange: "260610-x", prNumber: undefined })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders state, checks, and review summary", () => {
    render(
      <PrStatusLine
        win={makeWindow({
          fabChange: "260610-x",
          prNumber: 386,
          prUrl: "https://x/pull/386",
          prState: "open",
          prChecks: "pass",
          prReview: "approved",
        })}
      />,
    );
    const line = screen.getByTestId("pr-status-line");
    expect(line).toHaveTextContent("PR #386");
    expect(line).toHaveTextContent("open");
    expect(line).toHaveTextContent("checks pass");
    expect(line).toHaveTextContent("review: approved");
  });

  it("renders the merged glyph and state for a merged PR", () => {
    render(
      <PrStatusLine
        win={makeWindow({ fabChange: "260610-x", prNumber: 386, prState: "merged" })}
      />,
    );
    const line = screen.getByTestId("pr-status-line");
    expect(line).toHaveTextContent("\u2713"); // ✓
    expect(line).toHaveTextContent("merged");
  });

  it("renders the closed glyph and state for a closed PR", () => {
    render(
      <PrStatusLine
        win={makeWindow({ fabChange: "260610-x", prNumber: 386, prState: "closed" })}
      />,
    );
    const line = screen.getByTestId("pr-status-line");
    expect(line).toHaveTextContent("\u2717"); // ✗
    expect(line).toHaveTextContent("closed");
  });

  it("uses the red token for failing checks", () => {
    render(
      <PrStatusLine
        win={makeWindow({ fabChange: "x", prNumber: 9, prState: "open", prChecks: "fail" })}
      />,
    );
    expect(screen.getByTestId("pr-status-line").className).toContain("text-red-400");
  });

  it("uses the red token when changes are requested", () => {
    render(
      <PrStatusLine
        win={makeWindow({
          fabChange: "x",
          prNumber: 9,
          prState: "open",
          prReview: "changes_requested",
        })}
      />,
    );
    expect(screen.getByTestId("pr-status-line").className).toContain("text-red-400");
  });

  it("triggers refresh when the line (not the link) is clicked", () => {
    render(
      <PrStatusLine
        win={makeWindow({ fabChange: "x", prNumber: 9, prUrl: "https://x/pull/9", prState: "open" })}
      />,
    );
    fireEvent.click(screen.getByTestId("pr-status-line"));
    expect(refreshPrStatus).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when the PR link itself is clicked", () => {
    render(
      <PrStatusLine
        win={makeWindow({ fabChange: "x", prNumber: 9, prUrl: "https://x/pull/9", prState: "open" })}
      />,
    );
    fireEvent.click(screen.getByTestId("pr-status-link"));
    expect(refreshPrStatus).not.toHaveBeenCalled();
  });
});

describe("prDotState precedence", () => {
  it("returns merged first, even with historical failing checks", () => {
    expect(prDotState(makeWindow({ prState: "merged", prChecks: "fail" }))).toBe("merged");
    expect(
      prDotState(makeWindow({ prState: "merged", prReview: "changes_requested" })),
    ).toBe("merged");
  });

  it("returns fail before healthy when checks pass but changes are requested", () => {
    expect(
      prDotState(makeWindow({ prState: "open", prChecks: "pass", prReview: "changes_requested" })),
    ).toBe("fail");
  });

  it("returns fail when checks fail", () => {
    expect(prDotState(makeWindow({ prState: "open", prChecks: "fail" }))).toBe("fail");
  });

  it("returns pending when checks are running", () => {
    expect(prDotState(makeWindow({ prState: "open", prChecks: "pending" }))).toBe("pending");
  });

  it("returns healthy when checks pass", () => {
    expect(prDotState(makeWindow({ prState: "open", prChecks: "pass" }))).toBe("healthy");
  });

  it("returns healthy for a draft with passing checks (green = health, not readiness)", () => {
    expect(
      prDotState(makeWindow({ prState: "open", prIsDraft: true, prChecks: "pass" })),
    ).toBe("healthy");
  });

  it("returns neutral for a closed-unmerged PR (not merged, not purple, not red)", () => {
    expect(prDotState(makeWindow({ prState: "closed" }))).toBe("neutral");
    expect(prDotState(makeWindow({ prState: "closed", prChecks: "none" }))).toBe("neutral");
  });

  it("only `merged` short-circuits historical signals — a closed PR with failing checks still reads fail", () => {
    // Unlike `merged` (which is checked first), `closed` has no early-return, so
    // isFailish runs before the neutral fall-through. This is the specified
    // precedence order: merged → fail → pending → healthy → neutral.
    expect(prDotState(makeWindow({ prState: "closed", prChecks: "fail" }))).toBe("fail");
  });

  it("returns neutral for a bare open PR with no checks signal", () => {
    expect(prDotState(makeWindow({ prState: "open" }))).toBe("neutral");
    expect(prDotState(makeWindow({ prState: "open", prChecks: "none" }))).toBe("neutral");
  });
});
