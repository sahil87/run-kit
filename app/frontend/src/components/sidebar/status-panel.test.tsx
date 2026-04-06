import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusPanel } from "./status-panel";
import type { WindowInfo } from "@/types";

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
});
