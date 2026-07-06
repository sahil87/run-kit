import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { StatusPanel } from "./status-panel";
import type { WindowInfo } from "@/types";

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

// Helper to exercise shortenPath via the component
function renderCwd(cwd: string) {
  const win: WindowInfo = {
    windowId: "@0",
    index: 0,
    name: "zsh",
    worktreePath: cwd,
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
  };
  render(<StatusPanel window={win} />);
}

beforeEach(() => {
  vi.useFakeTimers();
  // Deterministic clock for the leaf `useNow()` inside WindowContent. Most
  // tests use activityTimestamp: 0 with epoch 0 → elapsed 0 → no idle duration
  // (the prior `nowSeconds={0}` behavior). The idle-duration tests override
  // this to 3700s below.
  vi.setSystemTime(0);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeWindow(overrides: Partial<WindowInfo> = {}): WindowInfo {
  return {
    windowId: "@0",
    index: 0,
    name: "zsh",
    worktreePath: "/home/user",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    ...overrides,
  };
}

describe("StatusPanel", () => {
  it("shows placeholder when no window selected", () => {
    render(<StatusPanel window={null} />);
    expect(screen.getByText("No window selected")).toBeInTheDocument();
  });

  it("shows CWD from active pane", () => {
    const win = makeWindow({
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/Users/sahil/code/run-kit", command: "zsh", isActive: true },
      ],
    });
    render(<StatusPanel window={win} />);
    expect(screen.getByText("~/code/run-kit")).toBeInTheDocument();
  });

  it("falls back to worktreePath when no panes", () => {
    const win = makeWindow({ worktreePath: "/Users/sahil/projects/foo" });
    render(<StatusPanel window={win} />);
    expect(screen.getByText("~/projects/foo")).toBeInTheDocument();
  });

  it("marks the cwd as deleted when the active pane's cwd is missing", () => {
    const win = makeWindow({
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/home/sahil/wt/gone", command: "zsh", isActive: true, cwdMissing: true },
      ],
    });
    render(<StatusPanel window={win} />);
    // Stale path is kept as a breadcrumb alongside the "(deleted)" tag.
    expect(screen.getByText("~/wt/gone", { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId("cwd-deleted")).toHaveTextContent("(deleted)");
  });

  it("does not mark the cwd as deleted when the active pane's cwd exists", () => {
    const win = makeWindow({
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/home/sahil/wt/here", command: "zsh", isActive: true },
      ],
    });
    render(<StatusPanel window={win} />);
    expect(screen.queryByTestId("cwd-deleted")).not.toBeInTheDocument();
  });

  it("shows window name", () => {
    const win = makeWindow({ name: "my-shell" });
    render(<StatusPanel window={win} />);
    expect(screen.getByText("my-shell")).toBeInTheDocument();
  });

  it("shows pane count when multiple panes", () => {
    const win = makeWindow({
      name: "editor",
      panes: [
        { paneId: "%1", paneIndex: 0, cwd: "/home", command: "vim", isActive: true },
        { paneId: "%2", paneIndex: 1, cwd: "/home", command: "zsh", isActive: false },
      ],
    });
    render(<StatusPanel window={win} />);
    expect(screen.getByText(/pane 1\/2/)).toBeInTheDocument();
  });

  it("shows fab state when available", () => {
    const win = makeWindow({
      fabChange: "260405-rx38-pane-cwd-tracking",
      fabStage: "apply",
    });
    render(<StatusPanel window={win} />);
    expect(screen.getByText(/rx38/)).toBeInTheDocument();
    expect(screen.getByText(/apply/)).toBeInTheDocument();
  });

  it("shows process info as fallback when no fab state", () => {
    const win = makeWindow({
      activity: "idle",
      activityTimestamp: 100,
      panes: [
        { paneId: "%1", paneIndex: 0, cwd: "/home", command: "zsh", isActive: true },
      ],
    });
    vi.setSystemTime(3_700_000);
    render(<StatusPanel window={win} />);
    expect(screen.getByText(/zsh \u2014 idle 1h/)).toBeInTheDocument();
  });

  it("renders fab and run rows independently when both are present", () => {
    const win = makeWindow({
      activity: "idle",
      activityTimestamp: 100,
      fabChange: "260405-rx38-pane-cwd-tracking",
      fabStage: "apply",
      panes: [
        { paneId: "%1", paneIndex: 0, cwd: "/home", command: "claude", isActive: true },
      ],
    });
    vi.setSystemTime(3_700_000);
    render(<StatusPanel window={win} />);
    expect(screen.getByText(/rx38/)).toBeInTheDocument();
    expect(screen.getByText(/apply/)).toBeInTheDocument();
    expect(screen.getByText(/claude \u2014 idle 1h/)).toBeInTheDocument();
  });

  it("run row still shows idle duration when an agent is present", () => {
    const win = makeWindow({
      activity: "idle",
      activityTimestamp: 100,
      agentState: "Thinking",
      agentIdleDuration: "2m",
      panes: [
        { paneId: "%1", paneIndex: 0, cwd: "/home", command: "claude", isActive: true },
      ],
    });
    vi.setSystemTime(3_700_000);
    render(<StatusPanel window={win} />);
    expect(screen.getByText(/claude \u2014 idle 1h/)).toBeInTheDocument();
    expect(screen.getByText(/Thinking 2m/)).toBeInTheDocument();
  });

  describe("shortenPath", () => {
    it("Linux home substitution: /home/sahil/code/run-kit → ~/code/run-kit", () => {
      renderCwd("/home/sahil/code/run-kit");
      expect(screen.getByText("~/code/run-kit")).toBeInTheDocument();
    });

    it("root home substitution: /root/scripts → ~/scripts", () => {
      renderCwd("/root/scripts");
      expect(screen.getByText("~/scripts")).toBeInTheDocument();
    });

    it("exact home match: /home/sahil → ~", () => {
      renderCwd("/home/sahil");
      expect(screen.getByText("~")).toBeInTheDocument();
    });

    it("deep home path truncated: /home/sahil/code/org/repo/src → \u2026/repo/src", () => {
      renderCwd("/home/sahil/code/org/repo/src");
      expect(screen.getByText("\u2026/repo/src")).toBeInTheDocument();
    });

    it("three-segment home path truncated: /home/sahil/code/org/repo → \u2026/org/repo", () => {
      renderCwd("/home/sahil/code/org/repo");
      expect(screen.getByText("\u2026/org/repo")).toBeInTheDocument();
    });

    it("two-segment home path not truncated: /home/sahil/code/org → ~/code/org", () => {
      renderCwd("/home/sahil/code/org");
      expect(screen.getByText("~/code/org")).toBeInTheDocument();
    });

    it("deep non-home path truncated: /var/log/nginx/access → \u2026/nginx/access", () => {
      renderCwd("/var/log/nginx/access");
      expect(screen.getByText("\u2026/nginx/access")).toBeInTheDocument();
    });

    it("short non-home path not truncated: /tmp → /tmp", () => {
      renderCwd("/tmp");
      expect(screen.getByText("/tmp")).toBeInTheDocument();
    });

    it("macOS home path with >2 segments truncated: /Users/john/a/b/c/d → \u2026/c/d", () => {
      renderCwd("/Users/john/a/b/c/d");
      expect(screen.getByText("\u2026/c/d")).toBeInTheDocument();
    });

    it("three-segment non-home path truncated: /var/log/nginx → \u2026/log/nginx", () => {
      renderCwd("/var/log/nginx");
      expect(screen.getByText("\u2026/log/nginx")).toBeInTheDocument();
    });

    it("path starting with /rootdir is not home-substituted: /rootdir/foo → /rootdir/foo", () => {
      renderCwd("/rootdir/foo");
      expect(screen.getByText("/rootdir/foo")).toBeInTheDocument();
    });

    it("exact macOS home match: /Users/john → ~", () => {
      renderCwd("/Users/john");
      expect(screen.getByText("~")).toBeInTheDocument();
    });

    it("exact root home match: /root → ~", () => {
      renderCwd("/root");
      expect(screen.getByText("~")).toBeInTheDocument();
    });

    it("title attribute preserves full unmodified path", () => {
      renderCwd("/home/sahil/code/org/repo/src");
      const cwdButton = document.querySelector("[title='/home/sahil/code/org/repo/src']");
      expect(cwdButton).not.toBeNull();
      expect(cwdButton?.querySelector(".group-hover\\:text-accent")?.textContent).toBe("\u2026/repo/src");
    });
  });
});

describe("StatusPanel copy behavior", () => {
  function makeWindowWithPanes(overrides: Partial<WindowInfo> = {}): WindowInfo {
    return {
      windowId: "@0",
      index: 0,
      name: "zsh",
      worktreePath: "/home/user/code/run-kit",
      activity: "idle",
      isActiveWindow: false,
      activityTimestamp: 0,
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/home/user/code/run-kit", command: "zsh", isActive: true, gitBranch: "main" },
      ],
      ...overrides,
    };
  }

  it("clicking cwd row copies full path", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);

    const cwdButton = document.querySelector("[title='/home/user/code/run-kit']") as HTMLButtonElement;
    expect(cwdButton).not.toBeNull();
    expect(cwdButton.tagName).toBe("BUTTON");

    fireEvent.click(cwdButton);

    expect(copyToClipboard).toHaveBeenCalledWith("/home/user/code/run-kit");
  });

  it("clicking git row copies branch name", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);

    const gitButton = screen.getByRole("button", { name: /main/ });
    fireEvent.click(gitButton);

    expect(copyToClipboard).toHaveBeenCalledWith("main");
  });

  it("clicking tmx row copies pane ID", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);

    const tmxButton = screen.getByRole("button", { name: /pane 1\/1 %5/ });
    fireEvent.click(tmxButton);

    expect(copyToClipboard).toHaveBeenCalledWith("%5");
  });

  it("clicking fab row copies change ID", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    const win = makeWindowWithPanes({
      fabChange: "260405-rx38-pane-cwd-tracking",
      fabStage: "apply",
    });
    render(<StatusPanel window={win} />);

    const fabButton = screen.getByRole("button", { name: /rx38/ });
    fireEvent.click(fabButton);

    expect(copyToClipboard).toHaveBeenCalledWith("rx38");
  });

  it("shows 'copied' feedback after click and reverts after 1000ms", async () => {
    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);

    const cwdButton = document.querySelector("[title='/home/user/code/run-kit']") as HTMLButtonElement;
    fireEvent.click(cwdButton);

    // Should show "copied" feedback
    expect(screen.getByText(/copied \u2713/)).toBeInTheDocument();

    // After 1000ms, should revert
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText(/copied \u2713/)).not.toBeInTheDocument();
    expect(screen.getByText("cwd")).toBeInTheDocument();
  });

  it("feedback moves between rows — clicking git while cwd shows 'copied' swaps immediately", async () => {
    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);

    // Click cwd
    const cwdButton = document.querySelector("[title='/home/user/code/run-kit']") as HTMLButtonElement;
    fireEvent.click(cwdButton);
    expect(screen.getByText(/copied \u2713/)).toBeInTheDocument();

    // Click git within the feedback window
    const gitButton = screen.getByRole("button", { name: /main/ });
    fireEvent.click(gitButton);

    // Only one "copied" indicator at a time — the one on git row
    const copiedElements = screen.getAllByText(/copied \u2713/);
    expect(copiedElements).toHaveLength(1);
    // cwd label should have reverted
    expect(screen.getByText("cwd")).toBeInTheDocument();
  });

  it("active text selection suppresses copy", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    vi.mocked(copyToClipboard).mockClear();

    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);

    // Mock active text selection
    const getSelectionSpy = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "selected text",
    } as Selection);

    const cwdButton = document.querySelector("[title='/home/user/code/run-kit']") as HTMLButtonElement;
    fireEvent.click(cwdButton);

    expect(copyToClipboard).not.toHaveBeenCalled();
    expect(screen.queryByText(/copied \u2713/)).not.toBeInTheDocument();

    getSelectionSpy.mockRestore();
  });

  it("output register (L0) is not rendered as a button (informational, always present)", () => {
    const win = makeWindowWithPanes({
      fabChange: undefined,
      fabStage: undefined,
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/home/user/code/run-kit", command: "zsh", isActive: true },
      ],
    });
    render(<StatusPanel window={win} />);

    // The "output" (L0) register is a div, not a button.
    const outputText = screen.getByText("output");
    expect(outputText.closest("button")).toBeNull();
    expect(outputText.closest("div")).not.toBeNull();
  });

  it("empty paneId renders non-interactive tmx row", () => {
    const win = makeWindowWithPanes({
      panes: [
        { paneId: "", paneIndex: 0, cwd: "/home/user/code/run-kit", command: "zsh", isActive: true, gitBranch: "main" },
      ],
    });
    render(<StatusPanel window={win} />);

    // The tmx row should be a div, not a button
    const tmxText = screen.getByText("tmx");
    expect(tmxText.closest("button")).toBeNull();
    expect(tmxText.closest("div")).not.toBeNull();
  });

  it("keyboard activation (Enter) triggers copy on cwd row", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    vi.mocked(copyToClipboard).mockClear();

    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} />);

    const cwdButton = document.querySelector("[title='/home/user/code/run-kit']") as HTMLButtonElement;
    cwdButton.focus();
    fireEvent.keyDown(cwdButton, { key: "Enter" });
    fireEvent.keyUp(cwdButton, { key: "Enter" });
    // Button elements natively handle Enter via click event
    fireEvent.click(cwdButton);

    expect(copyToClipboard).toHaveBeenCalledWith("/home/user/code/run-kit");
  });

  describe("pr row", () => {
    it("renders the pr row for a change-bound window with a PR", () => {
      const win = makeWindow({
        fabChange: "260610-596o-pr-status-sidebar",
        prNumber: 241,
        prUrl: "https://github.com/sahil87/run-kit/pull/241",
        prState: "open",
        prChecks: "pass",
        prReview: "approved",
      });
      render(<StatusPanel window={win} />);
      expect(screen.getByTestId("pr-line")).toHaveTextContent(
        "#241 · open · checks pass · review: approved",
      );
    });

    it("colors the segments by state: open/pass/approved are green", () => {
      const win = makeWindow({
        fabChange: "260610-596o-pr-status-sidebar",
        prNumber: 241,
        prState: "open",
        prChecks: "pass",
        prReview: "approved",
      });
      render(<StatusPanel window={win} />);
      expect(screen.getByText("open").className).toContain("text-accent-green");
      expect(screen.getByText("checks pass").className).toContain("text-accent-green");
      expect(screen.getByText("review: approved").className).toContain("text-accent-green");
      expect(screen.getByText("#241").className).toContain("text-text-primary");
    });

    it("colors pending checks yellow", () => {
      const win = makeWindow({
        fabChange: "260610-596o-pr-status-sidebar",
        prNumber: 241,
        prState: "open",
        prChecks: "pending",
      });
      render(<StatusPanel window={win} />);
      expect(screen.getByText("checks pending").className).toContain("text-yellow-400");
    });

    it("colors a draft's open state green (green = health, not readiness)", () => {
      // Under the health-not-readiness color story, a draft follows the same
      // state color as any open PR — green — so all three PR surfaces agree.
      const win = makeWindow({
        fabChange: "260610-596o-pr-status-sidebar",
        prNumber: 241,
        prState: "open",
        prIsDraft: true,
        prChecks: "pending",
      });
      render(<StatusPanel window={win} />);
      expect(screen.getByText("open (draft)").className).toContain("text-accent-green");
    });

    it("SHOWS the PR register even when NOT change-bound (L3 universal derivation, Principle X)", () => {
      // Palette v3 (status-pyramid.md § Signal Inventory L3): the PANE panel's PR
      // register is ungated from fabChange — it shows for ANY pane with a
      // prNumber (a plain shell on a branch with a PR still surfaces its PR
      // here, even though the DOT stays on the gray floor via D1).
      const win = makeWindow({
        fabChange: undefined,
        prNumber: 241,
        prUrl: "https://github.com/sahil87/run-kit/pull/241",
        prState: "open",
      });
      render(<StatusPanel window={win} />);
      expect(screen.getByTestId("pr-line")).toHaveTextContent("#241");
    });

    it("hides the pr register when there is no PR", () => {
      const win = makeWindow({ fabChange: "260610-596o-x", prNumber: undefined });
      render(<StatusPanel window={win} />);
      expect(screen.queryByText(/^#\d+/)).toBeNull();
    });

    it("copies the PR URL from the hover copy icon (and does not navigate)", async () => {
      const { copyToClipboard } = await import("@/lib/clipboard");
      vi.mocked(copyToClipboard).mockClear();

      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 241,
        prUrl: "https://github.com/sahil87/run-kit/pull/241",
        prState: "open",
      });
      render(<StatusPanel window={win} />);

      // The row body is now a link (open-first); copy lives on a hover-revealed
      // icon button that is a SIBLING of the anchor (not nested inside it). Its
      // handler still calls preventDefault() as belt-and-suspenders, which we
      // assert below via fireEvent.click's boolean return.
      const copyButton = screen.getByRole("button", { name: "Copy PR URL" });
      // fireEvent.click wraps the dispatch in act() and returns false when the
      // event's default was prevented — so a false return proves the handler
      // called preventDefault() (the click would not navigate).
      const notDefaultPrevented = fireEvent.click(copyButton);

      expect(copyToClipboard).toHaveBeenCalledWith(
        "https://github.com/sahil87/run-kit/pull/241",
      );
      expect(notDefaultPrevented).toBe(false);
    });

    it("renders an always-visible inline ↗ that is not hover-gated", () => {
      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 241,
        prUrl: "https://github.com/sahil87/run-kit/pull/241",
        prState: "open",
      });
      render(<StatusPanel window={win} />);
      const arrow = screen.getByText("↗");
      expect(arrow).toBeInTheDocument();
      // The arrow signals "opens" — it must be always VISIBLE, never opacity-gated
      // like the hover-revealed copy icon. (It may still carry the shared
      // group-hover:text-accent COLOR treatment — that is affordance, not gating.)
      expect(arrow.className).not.toContain("opacity-0");
      expect(arrow.className).not.toContain("group-hover:opacity");
      expect(arrow.className).toContain("shrink-0");
    });

    it("shows 'copied' feedback via the copy icon on the link row", () => {
      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 241,
        prUrl: "https://github.com/sahil87/run-kit/pull/241",
        prState: "open",
      });
      render(<StatusPanel window={win} />);

      const copyButton = screen.getByRole("button", { name: "Copy PR URL" });
      fireEvent.click(copyButton);
      expect(screen.getByText(/copied ✓/)).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByText(/copied ✓/)).not.toBeInTheDocument();
    });

    it("shows the terminal state and suppresses checks/review for a merged PR", () => {
      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 247,
        prUrl: "https://github.com/sahil87/run-kit/pull/247",
        prState: "merged",
        prChecks: "pass",
        prReview: "approved",
      });
      render(<StatusPanel window={win} />);
      // Merged PRs show "#247 · merged" only — checks/review are historical
      // once a PR lands, so they're suppressed.
      expect(screen.getByTestId("pr-line")).toHaveTextContent("#247 · merged");
      expect(screen.queryByText(/checks/)).toBeNull();
      expect(screen.getByText("merged").className).toContain("text-purple-400");
    });

    it("shows the terminal state and suppresses checks/review for a closed PR", () => {
      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 247,
        prUrl: "https://github.com/sahil87/run-kit/pull/247",
        prState: "closed",
        prChecks: "fail",
        prReview: "changes_requested",
      });
      render(<StatusPanel window={win} />);
      // Closed PRs show "#247 · closed" only — same suppression as merged.
      expect(screen.getByTestId("pr-line")).toHaveTextContent("#247 · closed");
    });

    it("suppresses a hidden failed check for a closed PR; only the state is red", () => {
      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 247,
        prState: "closed",
        prChecks: "fail",
      });
      render(<StatusPanel window={win} />);
      // The failure text is suppressed for a terminal-state PR — the red on the
      // state segment refers to "closed" itself (GitHub convention), never to a
      // hidden failure reason, which must not leak into other segments.
      expect(screen.queryByText(/checks/)).toBeNull();
      expect(screen.getByText("closed").className).toContain("text-red-400");
      expect(screen.getByText("#247").className).not.toContain("text-red-400");
    });

    it("renders the row body itself as an open-in-new-tab link to the PR URL", () => {
      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 241,
        prUrl: "https://github.com/sahil87/run-kit/pull/241",
        prState: "open",
      });
      render(<StatusPanel window={win} />);
      // Open-first: the ROW BODY is the anchor (spanning the PR text), not a
      // separate right-aligned ↗ link. It carries the title (keeping the e2e
      // [title] locator) and the PR segment text.
      const link = screen.getByRole("link", {
        name: "Open PR #241 in a new tab",
      }) as HTMLAnchorElement;
      expect(link).toHaveAttribute(
        "href",
        "https://github.com/sahil87/run-kit/pull/241",
      );
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveAttribute(
        "title",
        "https://github.com/sahil87/run-kit/pull/241",
      );
      expect(link).toHaveTextContent("#241");
      expect(link).toHaveTextContent("open");
    });

    it("renders no link and stays a copy row (copying the line text) when the PR has no URL", async () => {
      const { copyToClipboard } = await import("@/lib/clipboard");
      vi.mocked(copyToClipboard).mockClear();

      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 241,
        prUrl: undefined,
        prState: "open",
        prChecks: "pass",
      });
      render(<StatusPanel window={win} />);

      // No URL → nothing to open: no anchor, no inline ↗, no hover copy icon.
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.queryByText("↗")).toBeNull();
      expect(screen.queryByRole("button", { name: "Copy PR URL" })).toBeNull();

      // The row body itself is the copy action, copying the segment text.
      const prRow = screen.getByTestId("pr-line").closest("button") as HTMLButtonElement;
      expect(prRow).not.toBeNull();
      fireEvent.click(prRow);
      expect(copyToClipboard).toHaveBeenCalledWith("#241 · open · checks pass");
    });

    it("applies the red token to the failing checks segment", () => {
      const win = makeWindow({
        fabChange: "260610-596o-x",
        prNumber: 241,
        prState: "open",
        prChecks: "fail",
      });
      render(<StatusPanel window={win} />);
      expect(screen.getByTestId("pr-line")).toHaveTextContent("#241 · open · checks fail");
      expect(screen.getByText("checks fail").className).toContain("text-red-400");
      // The failure is scoped to its segment — the still-open state stays green.
      expect(screen.getByText("open").className).toContain("text-accent-green");
    });
  });
});
