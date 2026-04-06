import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusPanel } from "./status-panel";
import type { WindowInfo } from "@/types";

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

afterEach(() => {
  cleanup();
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
    expect(screen.getByText(/pane 1 of 2/)).toBeInTheDocument();
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
      const cwdDiv = document.querySelector("[title='/home/sahil/code/org/repo/src']");
      expect(cwdDiv).not.toBeNull();
      expect(cwdDiv?.querySelector(".text-text-primary")?.textContent).toBe("\u2026/repo/src");
    });
  });
});
