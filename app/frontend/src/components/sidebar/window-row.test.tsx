import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WindowRow } from "./window-row";
import type { WindowInfo } from "@/types";
import type { MergedWindow } from "@/store/window-store";

afterEach(() => {
  cleanup();
});

function makeWindow(overrides: Partial<WindowInfo> & { windowId: string; index: number }): WindowInfo {
  return {
    name: "zsh",
    worktreePath: "/home/user",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    ...overrides,
  };
}

const noop = () => {};
const noopDrag = (e: React.DragEvent) => { e.preventDefault(); };

function renderRow(win: WindowInfo) {
  return render(
    <WindowRow
      win={win}
      session="alpha"
      isSelected={false}
      isDragOver={false}
      nowSeconds={0}
      editingWindow={null}
      editingName=""
      inputRef={{ current: null }}
      onSelectWindow={noop}
      onDoubleClickName={noop}
      onWindowNameChange={noop}
      onRenameKeyDown={noop as React.KeyboardEventHandler<HTMLInputElement>}
      onRenameBlur={noop}
      onKillClick={noop as React.MouseEventHandler}
      onDragStart={noopDrag}
      onDragOver={noopDrag}
      onDrop={noopDrag}
      onDragEnd={noop}
    />,
  );
}

function makeGhostWindow(overrides: Partial<MergedWindow> = {}): MergedWindow {
  return {
    name: "ghost-win",
    worktreePath: "",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    index: -1,
    windowId: "",
    optimistic: true,
    optimisticId: "ghost-1",
    ...overrides,
  };
}

function renderGhostRow(win: MergedWindow) {
  return render(
    <WindowRow
      win={win}
      session="alpha"
      isSelected={false}
      isDragOver={false}
      nowSeconds={0}
      editingWindow={null}
      editingName=""
      inputRef={{ current: null }}
      onSelectWindow={noop}
      onDoubleClickName={noop}
      onWindowNameChange={noop}
      onRenameKeyDown={noop as React.KeyboardEventHandler<HTMLInputElement>}
      onRenameBlur={noop}
      onKillClick={noop as React.MouseEventHandler}
      onDragStart={noopDrag}
      onDragOver={noopDrag}
      onDrop={noopDrag}
      onDragEnd={noop}
    />,
  );
}

describe("WindowRow tooltip", () => {
  it("renders tooltip div with opacity-0 class (hidden at rest)", () => {
    const win = makeWindow({ windowId: "@0", index: 0 });
    const { container } = renderRow(win);
    // The tooltip div should exist in the DOM (opacity-0 means hidden via CSS, positioned below the row)
    const tooltip = container.querySelector(".top-full.opacity-0.group-hover\\:opacity-100");
    expect(tooltip).not.toBeNull();
  });

  it("ghost window does not render tooltip", () => {
    const win = makeGhostWindow();
    const { container } = renderGhostRow(win);
    // Ghost windows (optimisticId defined, optimistic: true) must not render the tooltip div
    const tooltip = container.querySelector(".top-full.opacity-0.group-hover\\:opacity-100");
    expect(tooltip).toBeNull();
  });

  it("shows cwd from active pane when panes are present", () => {
    const win = makeWindow({
      windowId: "@0",
      index: 0,
      worktreePath: "/fallback",
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/home/user/code/run-kit", command: "zsh", isActive: true },
        { paneId: "%6", paneIndex: 1, cwd: "/home/user", command: "vim", isActive: false },
      ],
    });
    renderRow(win);
    expect(screen.getByText(/\/home\/user\/code\/run-kit/)).toBeInTheDocument();
  });

  it("falls back to worktreePath when panes is absent", () => {
    const win = makeWindow({
      windowId: "@0",
      index: 0,
      worktreePath: "/my/worktree",
    });
    renderRow(win);
    expect(screen.getByText(/\/my\/worktree/)).toBeInTheDocument();
  });

  it("falls back to worktreePath when panes is empty", () => {
    const win = makeWindow({
      windowId: "@0",
      index: 0,
      worktreePath: "/my/worktree",
      panes: [],
    });
    renderRow(win);
    expect(screen.getByText(/\/my\/worktree/)).toBeInTheDocument();
  });

  it("shows pane list with asterisk for active pane", () => {
    const win = makeWindow({
      windowId: "@0",
      index: 0,
      panes: [
        { paneId: "%5", paneIndex: 0, cwd: "/home/user", command: "zsh", isActive: true },
        { paneId: "%6", paneIndex: 1, cwd: "/home/user/code", command: "vim", isActive: false },
      ],
    });
    renderRow(win);
    // Active pane marked with *
    expect(screen.getByText(/%5 \(0\)\*/)).toBeInTheDocument();
    // Inactive pane without *
    expect(screen.getByText(/%6 \(1\)/)).toBeInTheDocument();
  });

  it("shows em-dash when panes is absent", () => {
    const win = makeWindow({ windowId: "@0", index: 0 });
    renderRow(win);
    // em-dash (—) shown for panes row when no pane data
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows win index and windowId", () => {
    const win = makeWindow({ windowId: "@5", index: 3 });
    renderRow(win);
    expect(screen.getByText(/3 \(@5\)/)).toBeInTheDocument();
  });
});
