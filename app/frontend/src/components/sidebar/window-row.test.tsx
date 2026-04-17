import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../../../tests/msw/server";
import { WindowRow } from "./window-row";
import type { WindowInfo } from "@/types";
import type { MergedWindow } from "@/store/window-store";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

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

type RenderOpts = {
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onSelectWindow?: () => void;
};

function renderRow(win: WindowInfo, opts: RenderOpts = {}) {
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
      isExpanded={opts.isExpanded ?? false}
      onToggleExpand={opts.onToggleExpand}
      onSelectWindow={opts.onSelectWindow ?? noop}
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

describe("WindowRow", () => {
  it("renders window name", () => {
    const win = makeWindow({ windowId: "@0", index: 0, name: "my-shell" });
    renderRow(win);
    expect(screen.getByText("my-shell")).toBeInTheDocument();
  });

  it("does not render tooltip (removed in favor of status panel)", () => {
    const win = makeWindow({ windowId: "@0", index: 0 });
    const { container } = renderRow(win);
    const tooltip = container.querySelector(".top-full.opacity-0.group-hover\\:opacity-100");
    expect(tooltip).toBeNull();
  });

  it("renders ghost window with reduced opacity", () => {
    const win = makeGhostWindow();
    const { container } = renderGhostRow(win);
    expect(container.querySelector(".opacity-50.animate-pulse")).not.toBeNull();
  });
});

describe("WindowRow — last-line preview", () => {
  it("renders lastLine when non-empty", () => {
    const win = makeWindow({ windowId: "@0", index: 0, lastLine: "npm run build" });
    renderRow(win);
    expect(screen.getByTestId("window-last-line")).toHaveTextContent("npm run build");
  });

  it("does not render element when lastLine is undefined", () => {
    const win = makeWindow({ windowId: "@0", index: 0 });
    renderRow(win);
    expect(screen.queryByTestId("window-last-line")).toBeNull();
  });

  it("does not render element when lastLine is empty string", () => {
    const win = makeWindow({ windowId: "@0", index: 0, lastLine: "" });
    renderRow(win);
    expect(screen.queryByTestId("window-last-line")).toBeNull();
  });
});

describe("WindowRow — peek toggle", () => {
  it("does not render toggle when onToggleExpand is missing (ghost)", () => {
    const win = makeGhostWindow();
    renderGhostRow(win);
    expect(screen.queryByLabelText(/peek/i)).toBeNull();
  });

  it("shows collapsed chevron when not expanded", () => {
    const win = makeWindow({ windowId: "@0", index: 0, name: "main" });
    renderRow(win, { onToggleExpand: noop, isExpanded: false });
    const btn = screen.getByLabelText("Expand output peek for main");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveTextContent("\u25B8");
  });

  it("shows expanded chevron when expanded", () => {
    const win = makeWindow({ windowId: "@0", index: 0, name: "main" });
    renderRow(win, { onToggleExpand: noop, isExpanded: true });
    const btn = screen.getByLabelText("Collapse output peek for main");
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(btn).toHaveTextContent("\u25BE");
  });

  it("clicking toggle does not trigger onSelectWindow", () => {
    const win = makeWindow({ windowId: "@0", index: 0, name: "main" });
    const onSelectWindow = vi.fn();
    const onToggleExpand = vi.fn();
    renderRow(win, { onToggleExpand, onSelectWindow, isExpanded: false });
    fireEvent.click(screen.getByLabelText("Expand output peek for main"));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    expect(onSelectWindow).not.toHaveBeenCalled();
  });
});

describe("WindowRow — expanded peek block", () => {
  it("shows Loading\u2026 then rendered lines on expand", async () => {
    server.use(
      http.get("/api/sessions/:session/windows/:index/capture", () => {
        return HttpResponse.json({
          content: "line1\nline2\nline3",
          lines: ["line1", "line2", "line3"],
        });
      }),
    );
    const win = makeWindow({ windowId: "@0", index: 0, name: "main" });
    renderRow(win, { onToggleExpand: noop, isExpanded: true });

    // Peek block is visible; initial state is "loading".
    expect(screen.getByTestId("window-peek")).toHaveTextContent("Loading");

    await waitFor(() => {
      expect(screen.getByTestId("window-peek")).toHaveTextContent("line1");
    });
    expect(screen.getByTestId("window-peek")).toHaveTextContent("line2");
    expect(screen.getByTestId("window-peek")).toHaveTextContent("line3");
  });

  it("shows 'Unable to load output' on fetch error", async () => {
    server.use(
      http.get("/api/sessions/:session/windows/:index/capture", () => {
        return HttpResponse.json({ error: "boom" }, { status: 500 });
      }),
    );
    const win = makeWindow({ windowId: "@0", index: 0, name: "main" });
    renderRow(win, { onToggleExpand: noop, isExpanded: true });

    await waitFor(() => {
      expect(screen.getByTestId("window-peek")).toHaveTextContent("Unable to load output");
    });
  });

  it("does not render peek block when collapsed", () => {
    const win = makeWindow({ windowId: "@0", index: 0, name: "main" });
    renderRow(win, { onToggleExpand: noop, isExpanded: false });
    expect(screen.queryByTestId("window-peek")).toBeNull();
  });

  it("re-fetches on lastLine change while expanded", async () => {
    let callCount = 0;
    server.use(
      http.get("/api/sessions/:session/windows/:index/capture", () => {
        callCount++;
        return HttpResponse.json({
          content: `tick ${callCount}`,
          lines: [`tick ${callCount}`],
        });
      }),
    );
    const win = makeWindow({ windowId: "@0", index: 0, name: "main", lastLine: "first" });
    const { rerender } = renderRow(win, { onToggleExpand: noop, isExpanded: true });
    await waitFor(() => {
      expect(screen.getByTestId("window-peek")).toHaveTextContent("tick 1");
    });

    // Change lastLine to a new non-empty value → triggers re-fetch.
    const win2 = { ...win, lastLine: "second" };
    rerender(
      <WindowRow
        win={win2}
        session="alpha"
        isSelected={false}
        isDragOver={false}
        nowSeconds={0}
        editingWindow={null}
        editingName=""
        inputRef={{ current: null }}
        isExpanded={true}
        onToggleExpand={noop}
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

    await waitFor(() => {
      expect(screen.getByTestId("window-peek")).toHaveTextContent("tick 2");
    });
  });

  it("does not re-fetch when lastLine transitions to empty/undefined", async () => {
    let callCount = 0;
    server.use(
      http.get("/api/sessions/:session/windows/:index/capture", () => {
        callCount++;
        return HttpResponse.json({ content: "c", lines: ["c"] });
      }),
    );
    const win = makeWindow({ windowId: "@0", index: 0, name: "main", lastLine: "something" });
    const { rerender } = renderRow(win, { onToggleExpand: noop, isExpanded: true });
    await waitFor(() => expect(callCount).toBe(1));

    const win2 = { ...win, lastLine: "" };
    rerender(
      <WindowRow
        win={win2}
        session="alpha"
        isSelected={false}
        isDragOver={false}
        nowSeconds={0}
        editingWindow={null}
        editingName=""
        inputRef={{ current: null }}
        isExpanded={true}
        onToggleExpand={noop}
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
    // Give it a chance to (erroneously) fetch.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(callCount).toBe(1);
  });

  it("discards state on collapse", async () => {
    server.use(
      http.get("/api/sessions/:session/windows/:index/capture", () => {
        return HttpResponse.json({ content: "hello", lines: ["hello"] });
      }),
    );
    const win = makeWindow({ windowId: "@0", index: 0, name: "main" });
    const { rerender } = renderRow(win, { onToggleExpand: noop, isExpanded: true });
    await waitFor(() => expect(screen.getByTestId("window-peek")).toHaveTextContent("hello"));

    // Collapse
    rerender(
      <WindowRow
        win={win}
        session="alpha"
        isSelected={false}
        isDragOver={false}
        nowSeconds={0}
        editingWindow={null}
        editingName=""
        inputRef={{ current: null }}
        isExpanded={false}
        onToggleExpand={noop}
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

    expect(screen.queryByTestId("window-peek")).toBeNull();
  });
});

describe("WindowRow — multiple simultaneous expansions", () => {
  it("two rows maintain independent peek state", async () => {
    let callLog: string[] = [];
    server.use(
      http.get("/api/sessions/:session/windows/:index/capture", ({ params }) => {
        callLog.push(`${params.index}`);
        return HttpResponse.json({
          content: `w${params.index}`,
          lines: [`w${params.index}`],
        });
      }),
    );
    const w0 = makeWindow({ windowId: "@0", index: 0, name: "w0" });
    const w1 = makeWindow({ windowId: "@1", index: 1, name: "w1" });
    render(
      <div>
        <WindowRow
          win={w0}
          session="alpha"
          isSelected={false}
          isDragOver={false}
          nowSeconds={0}
          editingWindow={null}
          editingName=""
          inputRef={{ current: null }}
          isExpanded={true}
          onToggleExpand={noop}
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
        />
        <WindowRow
          win={w1}
          session="alpha"
          isSelected={false}
          isDragOver={false}
          nowSeconds={0}
          editingWindow={null}
          editingName=""
          inputRef={{ current: null }}
          isExpanded={true}
          onToggleExpand={noop}
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
        />
      </div>,
    );
    await waitFor(() => {
      const peeks = screen.getAllByTestId("window-peek");
      expect(peeks).toHaveLength(2);
      expect(peeks[0]).toHaveTextContent("w0");
      expect(peeks[1]).toHaveTextContent("w1");
    });
    expect(callLog.sort()).toEqual(["0", "1"]);
  });
});
