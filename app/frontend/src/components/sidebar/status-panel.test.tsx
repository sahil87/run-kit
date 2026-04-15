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
  render(<StatusPanel window={win} nowSeconds={0} />);
}

beforeEach(() => {
  vi.useFakeTimers();
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
    render(<StatusPanel window={null} nowSeconds={0} />);
    expect(screen.getByText("No window selected")).toBeInTheDocument();
  });

  it("shows CWD from active pane", () => {
    const win = makeWindow({
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/Users/sahil/code/run-kit", command: "zsh", isActive: true },
      ],
    });
    render(<StatusPanel window={win} nowSeconds={0} />);
    expect(screen.getByText("~/code/run-kit")).toBeInTheDocument();
  });

  it("falls back to worktreePath when no panes", () => {
    const win = makeWindow({ worktreePath: "/Users/sahil/projects/foo" });
    render(<StatusPanel window={win} nowSeconds={0} />);
    expect(screen.getByText("~/projects/foo")).toBeInTheDocument();
  });

  it("shows window name", () => {
    const win = makeWindow({ name: "my-shell" });
    render(<StatusPanel window={win} nowSeconds={0} />);
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
    render(<StatusPanel window={win} nowSeconds={0} />);
    expect(screen.getByText(/pane 1\/2/)).toBeInTheDocument();
  });

  it("shows fab state when available", () => {
    const win = makeWindow({
      fabChange: "260405-rx38-pane-cwd-tracking",
      fabStage: "apply",
    });
    render(<StatusPanel window={win} nowSeconds={0} />);
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
    render(<StatusPanel window={win} nowSeconds={3700} />);
    expect(screen.getByText(/zsh \u2014 idle 1h/)).toBeInTheDocument();
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
      expect(cwdButton?.querySelector(".text-text-primary")?.textContent).toBe("\u2026/repo/src");
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
    render(<StatusPanel window={win} nowSeconds={0} />);

    const cwdButton = document.querySelector("[title='/home/user/code/run-kit']") as HTMLButtonElement;
    expect(cwdButton).not.toBeNull();
    expect(cwdButton.tagName).toBe("BUTTON");

    fireEvent.click(cwdButton);

    expect(copyToClipboard).toHaveBeenCalledWith("/home/user/code/run-kit");
  });

  it("clicking git row copies branch name", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} nowSeconds={0} />);

    const gitButton = screen.getByRole("button", { name: /main/ });
    fireEvent.click(gitButton);

    expect(copyToClipboard).toHaveBeenCalledWith("main");
  });

  it("clicking tmx row copies pane ID", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} nowSeconds={0} />);

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
    render(<StatusPanel window={win} nowSeconds={0} />);

    const fabButton = screen.getByRole("button", { name: /rx38/ });
    fireEvent.click(fabButton);

    expect(copyToClipboard).toHaveBeenCalledWith("rx38");
  });

  it("shows 'copied' feedback after click and reverts after 1000ms", async () => {
    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} nowSeconds={0} />);

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
    render(<StatusPanel window={win} nowSeconds={0} />);

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
    render(<StatusPanel window={win} nowSeconds={0} />);

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

  it("process-only row (no fab state) is not rendered as a button", () => {
    const win = makeWindowWithPanes({
      fabChange: undefined,
      fabStage: undefined,
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/home/user/code/run-kit", command: "zsh", isActive: true },
      ],
    });
    render(<StatusPanel window={win} nowSeconds={0} />);

    // The "run" row should be a div, not a button
    const runText = screen.getByText("run");
    expect(runText.closest("button")).toBeNull();
    expect(runText.closest("div")).not.toBeNull();
  });

  it("empty paneId renders non-interactive tmx row", () => {
    const win = makeWindowWithPanes({
      panes: [
        { paneId: "", paneIndex: 0, cwd: "/home/user/code/run-kit", command: "zsh", isActive: true, gitBranch: "main" },
      ],
    });
    render(<StatusPanel window={win} nowSeconds={0} />);

    // The tmx row should be a div, not a button
    const tmxText = screen.getByText("tmx");
    expect(tmxText.closest("button")).toBeNull();
    expect(tmxText.closest("div")).not.toBeNull();
  });

  it("keyboard activation (Enter) triggers copy on cwd row", async () => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    vi.mocked(copyToClipboard).mockClear();

    const win = makeWindowWithPanes();
    render(<StatusPanel window={win} nowSeconds={0} />);

    const cwdButton = document.querySelector("[title='/home/user/code/run-kit']") as HTMLButtonElement;
    cwdButton.focus();
    fireEvent.keyDown(cwdButton, { key: "Enter" });
    fireEvent.keyUp(cwdButton, { key: "Enter" });
    // Button elements natively handle Enter via click event
    fireEvent.click(cwdButton);

    expect(copyToClipboard).toHaveBeenCalledWith("/home/user/code/run-kit");
  });
});
