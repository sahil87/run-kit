import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import { Sidebar } from "./sidebar";
import { OptimisticProvider, useOptimisticContext } from "@/contexts/optimistic-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { ToastProvider } from "@/components/toast";
import { useWindowStore } from "@/store/window-store";
import type { ProjectSession } from "@/types";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    killWindow: vi.fn().mockResolvedValue({ ok: true }),
    killSession: vi.fn().mockResolvedValue({ ok: true }),
    renameWindow: vi.fn().mockResolvedValue({ ok: true }),
    renameSession: vi.fn().mockResolvedValue({ ok: true }),
    moveWindow: vi.fn().mockResolvedValue({ ok: true }),
    moveWindowToSession: vi.fn().mockResolvedValue({ ok: true }),
    setSessionColor: vi.fn().mockResolvedValue({ ok: true }),
    setWindowColor: vi.fn().mockResolvedValue({ ok: true }),
  };
});

// Mock matchMedia for ThemeProvider
vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
  matches: true,
  media: "(prefers-color-scheme: dark)",
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  onchange: null,
}));

const sessions: ProjectSession[] = [
  {
    name: "run-kit",
    windows: [
      {
        index: 0,
        windowId: "@0",
        name: "main",
        worktreePath: "~/code/run-kit",
        activity: "active",
        isActiveWindow: true,
        fabStage: "apply",
        fabChange: "260313-txna-rich-sidebar-window-status",
        agentState: "active",
        paneCommand: "claude",
        activityTimestamp: Math.floor(Date.now() / 1000) - 5,
      },
      {
        index: 1,
        windowId: "@1",
        name: "scratch",
        worktreePath: "~/code/run-kit",
        activity: "idle",
        isActiveWindow: false,
        fabStage: "apply",
        fabChange: "260313-txna-rich-sidebar-window-status",
        agentState: "idle",
        agentIdleDuration: "3m",
        paneCommand: "zsh",
        activityTimestamp: Math.floor(Date.now() / 1000) - 180,
      },
      {
        index: 2,
        windowId: "@2",
        name: "logs",
        worktreePath: "~/code/run-kit",
        activity: "idle",
        isActiveWindow: false,
        paneCommand: "tail",
        activityTimestamp: Math.floor(Date.now() / 1000) - 300,
      },
    ],
  },
  {
    name: "ao-server",
    windows: [
      {
        index: 0,
        windowId: "@3",
        name: "dev",
        worktreePath: "~/code/ao-server",
        activity: "idle",
        isActiveWindow: true,
        paneCommand: "zsh",
        activityTimestamp: Math.floor(Date.now() / 1000) - 3600,
      },
    ],
  },
];

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  return render(
    <ThemeProvider>
    <ToastProvider>
      <OptimisticProvider>
        <Sidebar
          sessions={sessions}
          currentSession="run-kit"
          currentWindowIndex="0"
          onSelectWindow={vi.fn()}
          onCreateWindow={vi.fn()}
          onCreateSession={vi.fn()}
          server="runkit"
          servers={[{ name: "runkit", sessionCount: 0 }]}
          onSwitchServer={vi.fn()}
          onCreateServer={vi.fn()}
          onKillServer={vi.fn()}
          onRefreshServers={vi.fn()}
          {...overrides}
        />
      </OptimisticProvider>
    </ToastProvider>
    </ThemeProvider>,
  );
}

// The session name appears inside the SessionRow's "Navigate to {name}" button.
// The Sessions panel header also renders the current session name, so `getByText`
// would ambiguously match both. This helper scopes to the row.
function getSessionRowNameSpan(name: string): HTMLElement {
  const btn = screen.getByLabelText(`Navigate to ${name}`);
  return within(btn).getByText(name);
}

describe("Sidebar", () => {
  afterEach(cleanup);

  it("renders all sessions", () => {
    renderSidebar();
    expect(getSessionRowNameSpan("run-kit")).toBeInTheDocument();
    expect(getSessionRowNameSpan("ao-server")).toBeInTheDocument();
  });

  it("renders windows for expanded sessions", () => {
    renderSidebar();
    // "main" appears in both tree and status panel (selected window)
    expect(screen.getAllByText("main").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("scratch")).toBeInTheDocument();
    expect(screen.getByText("dev")).toBeInTheDocument();
  });

  it("collapse/expand sessions via chevron click", () => {
    renderSidebar();
    // "main" appears in tree + status panel
    expect(screen.getAllByText("main").length).toBeGreaterThanOrEqual(2);

    // Click chevron to collapse — tree row gone, status panel still shows it
    fireEvent.click(screen.getByLabelText(/Collapse run-kit/));
    expect(screen.getAllByText("main")).toHaveLength(1); // only status panel

    // Click chevron again to expand
    fireEvent.click(screen.getByLabelText(/Expand run-kit/));
    expect(screen.getAllByText("main").length).toBeGreaterThanOrEqual(2);
  });

  it("session name click navigates to first window (not toggles)", () => {
    const onSelectWindow = vi.fn();
    renderSidebar({ onSelectWindow });

    // Click the session name text
    fireEvent.click(screen.getByLabelText("Navigate to run-kit"));
    expect(onSelectWindow).toHaveBeenCalledWith("run-kit", 0);

    // Windows should still be visible (not collapsed)
    expect(screen.getAllByText("main").length).toBeGreaterThanOrEqual(1);
  });

  it("highlights selected window", () => {
    renderSidebar();
    // First "main" is in the tree row
    const mainBtn = screen.getAllByText("main")[0].closest("button");
    expect(mainBtn?.getAttribute("aria-current")).toBe("page");
    expect(mainBtn?.className).toContain("font-medium");
  });

  it("calls onSelectWindow when clicking a window", () => {
    const onSelectWindow = vi.fn();
    renderSidebar({ onSelectWindow });
    fireEvent.click(screen.getByText("scratch"));
    expect(onSelectWindow).toHaveBeenCalledWith("run-kit", 1);
  });

  it("shows fab stage text on windows", () => {
    renderSidebar();
    // Both fab windows show "apply"
    const applySpans = screen.getAllByText("apply");
    expect(applySpans.length).toBeGreaterThanOrEqual(1);
  });

  it("does not render + New Session button when sessions exist", () => {
    renderSidebar();
    expect(screen.queryByText("+ New Session")).not.toBeInTheDocument();
  });

  it("shows kill button for each session", () => {
    renderSidebar();
    const killButtons = screen.getAllByLabelText(/Kill session/);
    expect(killButtons).toHaveLength(2);
  });

  it("shows kill confirmation dialog when kill button is clicked", () => {
    renderSidebar();
    fireEvent.click(screen.getByLabelText("Kill session run-kit"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Kill session?")).toBeInTheDocument();
    expect(screen.getByText(/3 window/)).toBeInTheDocument();
  });

  it("shows empty state with + New Session button when no sessions", () => {
    const onCreateSession = vi.fn();
    renderSidebar({ sessions: [], onCreateSession });
    expect(screen.getByText("No sessions")).toBeInTheDocument();
    const btn = screen.getByText("+ New Session");
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it("empty state + New Session button calls onCreateSession directly (no dialog)", () => {
    const onCreateSession = vi.fn();
    renderSidebar({ sessions: [], onCreateSession });
    const btn = screen.getByText("+ New Session");
    fireEvent.click(btn);
    // onCreateSession is called directly — no CreateSessionDialog should appear
    expect(onCreateSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Inline rename tests (dcl9)
  describe("inline rename", () => {
    it("double-click on window name activates inline input", () => {
      renderSidebar();
      const nameSpan = screen.getAllByText("main")[0];
      fireEvent.doubleClick(nameSpan);
      const input = screen.getByLabelText("Rename window");
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue("main");
    });

    it("Enter commits rename and calls renameWindow", async () => {
      const { renameWindow: renameWindowMock } = await import("@/api/client");
      vi.mocked(renameWindowMock).mockResolvedValue({ ok: true });

      renderSidebar();
      fireEvent.doubleClick(screen.getByText("scratch"));
      const input = screen.getByLabelText("Rename window");
      fireEvent.change(input, { target: { value: "new-name" } });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });

      expect(screen.queryByLabelText("Rename window")).not.toBeInTheDocument();
      expect(renameWindowMock).toHaveBeenCalledWith("runkit", "run-kit", 1, "new-name");
    });

    it("Escape cancels without calling renameWindow", async () => {
      const { renameWindow: renameWindowMock } = await import("@/api/client");
      vi.mocked(renameWindowMock).mockClear();

      renderSidebar();
      fireEvent.doubleClick(screen.getByText("scratch"));
      const input = screen.getByLabelText("Rename window");
      fireEvent.change(input, { target: { value: "new-name" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(screen.queryByLabelText("Rename window")).not.toBeInTheDocument();
      expect(renameWindowMock).not.toHaveBeenCalled();
    });

    it("blur commits rename", async () => {
      const { renameWindow: renameWindowMock } = await import("@/api/client");
      vi.mocked(renameWindowMock).mockResolvedValue({ ok: true });

      renderSidebar();
      fireEvent.doubleClick(screen.getByText("scratch"));
      const input = screen.getByLabelText("Rename window");
      fireEvent.change(input, { target: { value: "blur-name" } });
      await act(async () => {
        fireEvent.blur(input);
      });

      expect(screen.queryByLabelText("Rename window")).not.toBeInTheDocument();
      expect(renameWindowMock).toHaveBeenCalledWith("runkit", "run-kit", 1, "blur-name");
    });

    it("empty input cancels without API call", async () => {
      const { renameWindow: renameWindowMock } = await import("@/api/client");
      vi.mocked(renameWindowMock).mockClear();

      renderSidebar();
      fireEvent.doubleClick(screen.getByText("scratch"));
      const input = screen.getByLabelText("Rename window");
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(screen.queryByLabelText("Rename window")).not.toBeInTheDocument();
      expect(renameWindowMock).not.toHaveBeenCalled();
    });

    it("unchanged name skips API call", async () => {
      const { renameWindow: renameWindowMock } = await import("@/api/client");
      vi.mocked(renameWindowMock).mockClear();

      renderSidebar();
      fireEvent.doubleClick(screen.getByText("scratch"));
      const input = screen.getByLabelText("Rename window");
      // Don't change the value — just press Enter
      fireEvent.keyDown(input, { key: "Enter" });

      expect(renameWindowMock).not.toHaveBeenCalled();
    });

    it("double-click on window B cancels active edit on window A without committing", async () => {
      const { renameWindow: renameWindowMock } = await import("@/api/client");
      vi.mocked(renameWindowMock).mockClear();

      renderSidebar();
      // Start editing "main" (first occurrence is in tree)
      fireEvent.doubleClick(screen.getAllByText("main")[0]);
      const inputA = screen.getByLabelText("Rename window");
      fireEvent.change(inputA, { target: { value: "renamed-main" } });

      // Now double-click "scratch" — should cancel A's edit without committing
      fireEvent.doubleClick(screen.getByText("scratch"));
      const inputB = screen.getByLabelText("Rename window");
      expect(inputB).toHaveValue("scratch");

      // A's changed value should NOT have been committed
      expect(renameWindowMock).not.toHaveBeenCalled();
    });

    it("single-click navigates without triggering edit", () => {
      const onSelectWindow = vi.fn();
      renderSidebar({ onSelectWindow });
      fireEvent.click(screen.getByText("scratch"));

      expect(onSelectWindow).toHaveBeenCalledWith("run-kit", 1);
      expect(screen.queryByLabelText("Rename window")).not.toBeInTheDocument();
    });
  });

  describe("inline rename session", () => {
    it("double-click on session name activates inline input", () => {
      renderSidebar();
      const nameSpan = getSessionRowNameSpan("run-kit");
      fireEvent.doubleClick(nameSpan);
      const input = screen.getByLabelText("Rename session");
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue("run-kit");
    });

    it("Enter commits rename and calls renameSession", async () => {
      const { renameSession: renameSessionMock } = await import("@/api/client");
      vi.mocked(renameSessionMock).mockResolvedValue({ ok: true });

      renderSidebar();
      fireEvent.doubleClick(getSessionRowNameSpan("run-kit"));
      const input = screen.getByLabelText("Rename session");
      fireEvent.change(input, { target: { value: "staging" } });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });

      expect(screen.queryByLabelText("Rename session")).not.toBeInTheDocument();
      expect(renameSessionMock).toHaveBeenCalledWith("runkit", "run-kit", "staging");
    });

    it("Escape cancels without calling renameSession", async () => {
      const { renameSession: renameSessionMock } = await import("@/api/client");
      vi.mocked(renameSessionMock).mockClear();

      renderSidebar();
      fireEvent.doubleClick(getSessionRowNameSpan("run-kit"));
      const input = screen.getByLabelText("Rename session");
      fireEvent.change(input, { target: { value: "staging" } });
      fireEvent.keyDown(input, { key: "Escape" });

      expect(screen.queryByLabelText("Rename session")).not.toBeInTheDocument();
      expect(renameSessionMock).not.toHaveBeenCalled();
    });

    it("blur commits rename", async () => {
      const { renameSession: renameSessionMock } = await import("@/api/client");
      vi.mocked(renameSessionMock).mockResolvedValue({ ok: true });

      renderSidebar();
      fireEvent.doubleClick(getSessionRowNameSpan("run-kit"));
      const input = screen.getByLabelText("Rename session");
      fireEvent.change(input, { target: { value: "blur-session" } });
      await act(async () => {
        fireEvent.blur(input);
      });

      expect(screen.queryByLabelText("Rename session")).not.toBeInTheDocument();
      expect(renameSessionMock).toHaveBeenCalledWith("runkit", "run-kit", "blur-session");
    });

    it("empty input cancels without API call", async () => {
      const { renameSession: renameSessionMock } = await import("@/api/client");
      vi.mocked(renameSessionMock).mockClear();

      renderSidebar();
      fireEvent.doubleClick(getSessionRowNameSpan("run-kit"));
      const input = screen.getByLabelText("Rename session");
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });

      expect(screen.queryByLabelText("Rename session")).not.toBeInTheDocument();
      expect(renameSessionMock).not.toHaveBeenCalled();
    });

    it("unchanged name skips API call", async () => {
      const { renameSession: renameSessionMock } = await import("@/api/client");
      vi.mocked(renameSessionMock).mockClear();

      renderSidebar();
      fireEvent.doubleClick(getSessionRowNameSpan("run-kit"));
      const input = screen.getByLabelText("Rename session");
      // Don't change the value — just press Enter
      fireEvent.keyDown(input, { key: "Enter" });

      expect(renameSessionMock).not.toHaveBeenCalled();
    });

    it("double-click session B cancels session A edit without committing", async () => {
      const { renameSession: renameSessionMock } = await import("@/api/client");
      vi.mocked(renameSessionMock).mockClear();

      renderSidebar();
      // Start editing "run-kit"
      fireEvent.doubleClick(getSessionRowNameSpan("run-kit"));
      const inputA = screen.getByLabelText("Rename session");
      fireEvent.change(inputA, { target: { value: "renamed-run-kit" } });

      // Now double-click "ao-server" — should cancel A's edit without committing
      fireEvent.doubleClick(screen.getByText("ao-server"));
      const inputB = screen.getByLabelText("Rename session");
      expect(inputB).toHaveValue("ao-server");

      // A's changed value should NOT have been committed
      expect(renameSessionMock).not.toHaveBeenCalled();
    });

    it("single-click navigates without triggering edit", () => {
      const onSelectWindow = vi.fn();
      renderSidebar({ onSelectWindow });
      fireEvent.click(screen.getByLabelText("Navigate to run-kit"));

      expect(onSelectWindow).toHaveBeenCalledWith("run-kit", 0);
      expect(screen.queryByLabelText("Rename session")).not.toBeInTheDocument();
    });
  });

  describe("cross-cancellation session↔window", () => {
    it("starting session edit cancels active window edit without committing", async () => {
      const { renameWindow: renameWindowMock } = await import("@/api/client");
      vi.mocked(renameWindowMock).mockClear();

      renderSidebar();
      // Start editing window "scratch"
      fireEvent.doubleClick(screen.getByText("scratch"));
      const windowInput = screen.getByLabelText("Rename window");
      fireEvent.change(windowInput, { target: { value: "renamed-scratch" } });

      // Double-click on session name — should cancel window edit without committing
      fireEvent.doubleClick(getSessionRowNameSpan("run-kit"));
      expect(screen.queryByLabelText("Rename window")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Rename session")).toBeInTheDocument();
      expect(renameWindowMock).not.toHaveBeenCalled();
    });

    it("starting window edit cancels active session edit without committing", async () => {
      const { renameSession: renameSessionMock } = await import("@/api/client");
      vi.mocked(renameSessionMock).mockClear();

      renderSidebar();
      // Start editing session "run-kit"
      fireEvent.doubleClick(getSessionRowNameSpan("run-kit"));
      const sessionInput = screen.getByLabelText("Rename session");
      fireEvent.change(sessionInput, { target: { value: "renamed-run-kit" } });

      // Double-click on window name — should cancel session edit without committing
      fireEvent.doubleClick(screen.getByText("scratch"));
      expect(screen.queryByLabelText("Rename session")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Rename window")).toBeInTheDocument();
      expect(renameSessionMock).not.toHaveBeenCalled();
    });
  });

  it("does not show external marker (removed in single-server model)", () => {
    renderSidebar();
    expect(screen.queryByLabelText("external session")).not.toBeInTheDocument();
  });

  describe("drag-and-drop window reorder", () => {
    it("window items have draggable attribute", () => {
      renderSidebar();
      // The "main" window button's parent div should be draggable
      const mainBtn = screen.getAllByText("main")[0].closest("button");
      const draggableDiv = mainBtn?.closest("[draggable]");
      expect(draggableDiv).toBeTruthy();
      expect(draggableDiv?.getAttribute("draggable")).toBe("true");
    });

    it("onDragStart sets JSON data with session, index, windowId, and name", () => {
      renderSidebar();
      const mainBtn = screen.getAllByText("main")[0].closest("button");
      const draggableDiv = mainBtn?.closest("[draggable]") as HTMLElement;

      let transferredData = "";
      const dataTransfer = {
        setData: vi.fn((_type: string, data: string) => {
          transferredData = data;
        }),
        effectAllowed: "",
      };

      fireEvent.dragStart(draggableDiv, { dataTransfer });

      expect(dataTransfer.setData).toHaveBeenCalledWith(
        "application/json",
        JSON.stringify({ session: "run-kit", index: 0, windowId: "@0", name: "main" }),
      );
      const parsed = JSON.parse(transferredData);
      expect(parsed.session).toBe("run-kit");
      expect(parsed.index).toBe(0);
      expect(parsed.windowId).toBe("@0");
      expect(parsed.name).toBe("main");
    });

    it("drop on same position does not call moveWindow", async () => {
      const { moveWindow: moveWindowMock } = await import("@/api/client");
      vi.mocked(moveWindowMock).mockClear();

      renderSidebar();
      const mainBtn = screen.getAllByText("main")[0].closest("button");
      const draggableDiv = mainBtn?.closest("[draggable]") as HTMLElement;

      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue(JSON.stringify({ session: "run-kit", index: 0 })),
        effectAllowed: "",
        dropEffect: "",
      };

      // Drag and drop on same element (index 0 -> index 0)
      fireEvent.dragStart(draggableDiv, { dataTransfer });
      fireEvent.dragOver(draggableDiv, { dataTransfer });
      fireEvent.drop(draggableDiv, { dataTransfer });

      expect(moveWindowMock).not.toHaveBeenCalled();
    });

    it("drop on different window in same session calls moveWindow", async () => {
      const { moveWindow: moveWindowMock } = await import("@/api/client");
      vi.mocked(moveWindowMock).mockClear();

      const onSelectWindow = vi.fn();
      renderSidebar({ onSelectWindow });

      const mainBtn = screen.getAllByText("main")[0].closest("button");
      const mainDraggable = mainBtn?.closest("[draggable]") as HTMLElement;
      const scratchBtn = screen.getByText("scratch").closest("button");
      const scratchDraggable = scratchBtn?.closest("[draggable]") as HTMLElement;

      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue(JSON.stringify({ session: "run-kit", index: 0 })),
        effectAllowed: "",
        dropEffect: "",
      };

      // Drag from main (index 0) to scratch (index 1)
      fireEvent.dragStart(mainDraggable, { dataTransfer });
      fireEvent.dragOver(scratchDraggable, { dataTransfer });
      await act(async () => {
        fireEvent.drop(scratchDraggable, { dataTransfer });
      });

      expect(moveWindowMock).toHaveBeenCalledWith("runkit", "run-kit", 0, 1);
    });

    it("drop on window in different session does not call moveWindow", async () => {
      const { moveWindow: moveWindowMock } = await import("@/api/client");
      vi.mocked(moveWindowMock).mockClear();

      renderSidebar();

      const mainBtn = screen.getAllByText("main")[0].closest("button");
      const mainDraggable = mainBtn?.closest("[draggable]") as HTMLElement;
      const devBtn = screen.getByText("dev").closest("button");
      const devDraggable = devBtn?.closest("[draggable]") as HTMLElement;

      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue(JSON.stringify({ session: "run-kit", index: 0 })),
        effectAllowed: "",
        dropEffect: "",
      };

      // Drag from run-kit (main) to ao-server (dev) — cross-session
      fireEvent.dragStart(mainDraggable, { dataTransfer });
      // dragOver on dev should not be allowed (different session)
      fireEvent.dragOver(devDraggable, { dataTransfer });
      fireEvent.drop(devDraggable, { dataTransfer });

      expect(moveWindowMock).not.toHaveBeenCalled();
    });

    it("dragEnd clears drag state", () => {
      renderSidebar();
      const mainBtn = screen.getAllByText("main")[0].closest("button");
      const draggableDiv = mainBtn?.closest("[draggable]") as HTMLElement;

      const dataTransfer = {
        setData: vi.fn(),
        effectAllowed: "",
      };

      fireEvent.dragStart(draggableDiv, { dataTransfer });
      fireEvent.dragEnd(draggableDiv);

      // After dragEnd, no drop indicators should be visible
      // Check that no elements have the accent border style
      const allDraggables = document.querySelectorAll("[draggable]");
      allDraggables.forEach((el) => {
        expect((el as HTMLElement).style.borderTop).not.toContain("2px solid");
      });
    });
  });

  describe("cross-session drag-and-drop", () => {
    beforeEach(() => {
      mockNavigate.mockClear();
      // Seed the window store so killWindow/restoreWindow/addGhostWindow have entries
      useWindowStore.setState({ entries: new Map(), ghosts: [] });
      useWindowStore.getState().setWindowsForSession("run-kit", [
        { windowId: "@0", index: 0, name: "main", worktreePath: "~/code/run-kit", activity: "active", isActiveWindow: true, activityTimestamp: Math.floor(Date.now() / 1000) - 5 },
        { windowId: "@1", index: 1, name: "scratch", worktreePath: "~/code/run-kit", activity: "idle", isActiveWindow: false, activityTimestamp: Math.floor(Date.now() / 1000) - 180 },
      ]);
      useWindowStore.getState().setWindowsForSession("ao-server", [
        { windowId: "@2", index: 0, name: "dev", worktreePath: "~/code/ao-server", activity: "idle", isActiveWindow: true, activityTimestamp: Math.floor(Date.now() / 1000) - 3600 },
      ]);
    });

    it("drop on different session header calls moveWindowToSession and triggers optimistic update", async () => {
      const { moveWindowToSession: moveWindowToSessionMock } = await import("@/api/client");
      vi.mocked(moveWindowToSessionMock).mockResolvedValue({ ok: true });

      renderSidebar();

      const bravoHeader = screen.getByLabelText("Navigate to ao-server").closest(".flex.items-center.justify-between.group") as HTMLElement;

      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue(JSON.stringify({ session: "run-kit", index: 0, windowId: "@0", name: "main" })),
        effectAllowed: "",
        dropEffect: "",
      };

      const mainBtn = screen.getAllByText("main")[0].closest("button");
      const mainDraggable = mainBtn?.closest("[draggable]") as HTMLElement;
      fireEvent.dragStart(mainDraggable, { dataTransfer });

      fireEvent.dragOver(bravoHeader, { dataTransfer });
      await act(async () => {
        fireEvent.drop(bravoHeader, { dataTransfer });
      });

      // Source window should be killed optimistically
      expect(useWindowStore.getState().entries.get("@0")?.killed).toBe(true);
      // Ghost window should be added to target session
      expect(useWindowStore.getState().ghosts.some((g) => g.session === "ao-server" && g.name === "main")).toBe(true);
      // Navigate to server dashboard
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/$server", params: { server: "runkit" } });
      // API was called
      expect(moveWindowToSessionMock).toHaveBeenCalledWith("runkit", "run-kit", 0, "ao-server");
    });

    it("drop on same session header is no-op", async () => {
      const { moveWindowToSession: moveWindowToSessionMock } = await import("@/api/client");
      vi.mocked(moveWindowToSessionMock).mockClear();

      renderSidebar();

      const alphaHeader = screen.getByLabelText("Navigate to run-kit").closest(".flex.items-center.justify-between.group") as HTMLElement;

      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue(JSON.stringify({ session: "run-kit", index: 0, windowId: "@0", name: "main" })),
        effectAllowed: "",
        dropEffect: "",
      };

      const mainBtn = screen.getAllByText("main")[0].closest("button");
      const mainDraggable = mainBtn?.closest("[draggable]") as HTMLElement;
      fireEvent.dragStart(mainDraggable, { dataTransfer });

      fireEvent.dragOver(alphaHeader, { dataTransfer });
      fireEvent.drop(alphaHeader, { dataTransfer });

      expect(moveWindowToSessionMock).not.toHaveBeenCalled();
    });

    it("API failure rolls back: restoreWindow + removeGhost + toast", async () => {
      const { moveWindowToSession: moveWindowToSessionMock } = await import("@/api/client");
      vi.mocked(moveWindowToSessionMock).mockRejectedValue(new Error("server error"));

      renderSidebar();

      const bravoHeader = screen.getByLabelText("Navigate to ao-server").closest(".flex.items-center.justify-between.group") as HTMLElement;

      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue(JSON.stringify({ session: "run-kit", index: 0, windowId: "@0", name: "main" })),
        effectAllowed: "",
        dropEffect: "",
      };

      const mainBtn = screen.getAllByText("main")[0].closest("button");
      const mainDraggable = mainBtn?.closest("[draggable]") as HTMLElement;
      fireEvent.dragStart(mainDraggable, { dataTransfer });

      // Before drop — source window is not killed
      expect(useWindowStore.getState().entries.get("@0")?.killed).toBe(false);

      await act(async () => {
        fireEvent.drop(bravoHeader, { dataTransfer });
      });

      // After API rejection settles, window should be restored (not killed)
      expect(useWindowStore.getState().entries.get("@0")?.killed).toBe(false);
      // Ghost should be removed
      expect(useWindowStore.getState().ghosts.some((g) => g.session === "ao-server" && g.name === "main")).toBe(false);
      // Error toast should be shown
      expect(screen.getByText("server error")).toBeInTheDocument();
    });

    it("visual feedback shows accent border on valid cross-session hover", () => {
      renderSidebar();

      const bravoHeader = screen.getByLabelText("Navigate to ao-server").closest(".flex.items-center.justify-between.group") as HTMLElement;

      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue(JSON.stringify({ session: "run-kit", index: 0, windowId: "@0", name: "main" })),
        effectAllowed: "",
        dropEffect: "",
      };

      const mainBtn = screen.getAllByText("main")[0].closest("button");
      const mainDraggable = mainBtn?.closest("[draggable]") as HTMLElement;
      fireEvent.dragStart(mainDraggable, { dataTransfer });

      fireEvent.dragOver(bravoHeader, { dataTransfer });

      expect(bravoHeader.style.boxShadow).toContain("2px");
    });

    it("within-session window drag still works after cross-session support", async () => {
      const { moveWindow: moveWindowMock } = await import("@/api/client");
      vi.mocked(moveWindowMock).mockClear();

      const onSelectWindow = vi.fn();
      renderSidebar({ onSelectWindow });

      const mainBtn = screen.getAllByText("main")[0].closest("button");
      const mainDraggable = mainBtn?.closest("[draggable]") as HTMLElement;
      const scratchBtn = screen.getByText("scratch").closest("button");
      const scratchDraggable = scratchBtn?.closest("[draggable]") as HTMLElement;

      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue(JSON.stringify({ session: "run-kit", index: 0, windowId: "@0", name: "main" })),
        effectAllowed: "",
        dropEffect: "",
      };

      fireEvent.dragStart(mainDraggable, { dataTransfer });
      fireEvent.dragOver(scratchDraggable, { dataTransfer });
      await act(async () => {
        fireEvent.drop(scratchDraggable, { dataTransfer });
      });

      expect(moveWindowMock).toHaveBeenCalledWith("runkit", "run-kit", 0, 1);
    });
  });

  describe("window kill clears optimistic state on success", () => {
    it("Ctrl+click kill: killed entry is removed after API call resolves", async () => {
      const { killWindow: killWindowMock } = await import("@/api/client");
      vi.mocked(killWindowMock).mockResolvedValue({ ok: true });

      let killedCount = -1;

      function KilledCountDisplay() {
        const ctx = useOptimisticContext();
        killedCount = ctx.killed.length;
        return <span data-testid="killed-count">{ctx.killed.length}</span>;
      }

      render(
        <ThemeProvider>
        <ToastProvider>
          <OptimisticProvider>
            <KilledCountDisplay />
            <Sidebar
              sessions={sessions}
              currentSession="run-kit"
              currentWindowIndex="0"
              onSelectWindow={vi.fn()}
              onCreateWindow={vi.fn()}
              onCreateSession={vi.fn()}
              server="runkit"
              servers={[{ name: "runkit", sessionCount: 0 }]}
              onSwitchServer={vi.fn()}
              onCreateServer={vi.fn()}
              onKillServer={vi.fn()}
              onRefreshServers={vi.fn()}
            />
          </OptimisticProvider>
        </ToastProvider>
        </ThemeProvider>,
      );

      // Ctrl+click the X button for "scratch" window (index 1)
      await act(async () => {
        fireEvent.click(screen.getByLabelText("Kill window scratch"), { ctrlKey: true });
      });

      // API was called
      expect(killWindowMock).toHaveBeenCalledWith("runkit", "run-kit", 1);
      // After the API call resolves, the killed entry must be removed (unmarkKilled called)
      expect(killedCount).toBe(0);
    });
  });

  describe("optimistic drag-drop reorder", () => {
    beforeEach(() => {
      // Seed the window store so moveWindowOrder has entries to operate on.
      // Need 3+ windows to test insert-before semantics (2-item forward move is a no-op).
      useWindowStore.setState({ entries: new Map(), ghosts: [] });
      useWindowStore.getState().setWindowsForSession("run-kit", [
        { windowId: "@0", index: 0, name: "main", worktreePath: "~/code/run-kit", activity: "active", isActiveWindow: true, activityTimestamp: Math.floor(Date.now() / 1000) - 5 },
        { windowId: "@1", index: 1, name: "scratch", worktreePath: "~/code/run-kit", activity: "idle", isActiveWindow: false, activityTimestamp: Math.floor(Date.now() / 1000) - 180 },
        { windowId: "@2", index: 2, name: "logs", worktreePath: "~/code/run-kit", activity: "idle", isActiveWindow: false, activityTimestamp: Math.floor(Date.now() / 1000) - 300 },
      ]);
    });

    it("optimistic move updates window store indices synchronously on drop", async () => {
      const { moveWindow: moveWindowMock } = await import("@/api/client");
      // Use a deferred promise so API stays pending during assertion
      let resolveApi!: () => void;
      vi.mocked(moveWindowMock).mockImplementation(() => new Promise<{ ok: boolean }>((r) => { resolveApi = () => r({ ok: true }); }));

      const onSelectWindow = vi.fn();
      renderSidebar({ onSelectWindow });

      // Drag main(@0, index 0) onto logs(@2, index 2)
      // Insert-before: [main scratch logs] → [scratch main logs]
      const mainBtn = screen.getAllByText("main")[0].closest("button");
      const mainDraggable = mainBtn?.closest("[draggable]") as HTMLElement;
      const logsBtn = screen.getByText("logs").closest("button");
      const logsDraggable = logsBtn?.closest("[draggable]") as HTMLElement;

      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue(JSON.stringify({ session: "run-kit", index: 0, windowId: "@0", name: "main" })),
        effectAllowed: "",
        dropEffect: "",
      };

      fireEvent.dragStart(mainDraggable, { dataTransfer });
      fireEvent.dragOver(logsDraggable, { dataTransfer });
      fireEvent.drop(logsDraggable, { dataTransfer });

      // Synchronous: store indices should reflect insert-before (before API resolves)
      const entries = useWindowStore.getState().entries;
      expect(entries.get("@1")?.index).toBe(0); // scratch shifted left
      expect(entries.get("@0")?.index).toBe(1); // main inserted before logs
      expect(entries.get("@2")?.index).toBe(2); // logs unchanged

      // Reorder should not change selection
      expect(onSelectWindow).not.toHaveBeenCalled();

      // Clean up: flush microtask to let action() run (assigns resolveApi), then resolve
      await act(async () => { await Promise.resolve(); });
      await act(async () => { resolveApi(); });
    });

    it("rollback on API failure restores original window order", async () => {
      const { moveWindow: moveWindowMock } = await import("@/api/client");
      vi.mocked(moveWindowMock).mockRejectedValue(new Error("server error"));

      renderSidebar();

      // Drag main(@0, index 0) onto logs(@2, index 2)
      const mainBtn = screen.getAllByText("main")[0].closest("button");
      const mainDraggable = mainBtn?.closest("[draggable]") as HTMLElement;
      const logsBtn = screen.getByText("logs").closest("button");
      const logsDraggable = logsBtn?.closest("[draggable]") as HTMLElement;

      const dataTransfer = {
        setData: vi.fn(),
        getData: vi.fn().mockReturnValue(JSON.stringify({ session: "run-kit", index: 0, windowId: "@0", name: "main" })),
        effectAllowed: "",
        dropEffect: "",
      };

      fireEvent.dragStart(mainDraggable, { dataTransfer });
      fireEvent.dragOver(logsDraggable, { dataTransfer });

      // Drop triggers optimistic move + API call
      await act(async () => {
        fireEvent.drop(logsDraggable, { dataTransfer });
      });

      // After API rejection settles, indices should be restored
      const entries = useWindowStore.getState().entries;
      expect(entries.get("@0")?.index).toBe(0);
      expect(entries.get("@1")?.index).toBe(1);
      expect(entries.get("@2")?.index).toBe(2);
    });
  });

  describe("ghost entries", () => {
    it("renders ghost session with opacity-50 and animate-pulse", () => {
      const ghostSessions = [
        ...sessions,
        {
          name: "ghost-session",
          windows: [],
          optimistic: true,
          optimisticId: "ghost-1",
        },
      ];
      renderSidebar({ sessions: ghostSessions });
      const ghostName = screen.getByText("ghost-session");
      // Find the session container (the outer div wrapping the session header)
      const sessionContainer = ghostName.closest("[class*='opacity-50']");
      expect(sessionContainer).toBeTruthy();
      expect(sessionContainer?.className).toContain("animate-pulse");
    });

    it("renders ghost window with opacity-50 and animate-pulse", () => {
      const sessionsWithGhostWindow = [
        {
          ...sessions[0],
          windows: [
            ...sessions[0].windows,
            {
              index: 99,
              windowId: "",
              name: "ghost-win",
              worktreePath: "",
              activity: "idle" as const,
              isActiveWindow: false,
              activityTimestamp: 0,
              optimistic: true,
              optimisticId: "ghost-w-1",
            },
          ],
        },
        sessions[1],
      ];
      renderSidebar({ sessions: sessionsWithGhostWindow });
      const ghostWin = screen.getByText("ghost-win");
      const windowRow = ghostWin.closest("[class*='opacity-50']");
      expect(windowRow).toBeTruthy();
      expect(windowRow?.className).toContain("animate-pulse");
    });

    it("ghost window uses optimisticId as key (not index)", () => {
      const sessionsWithGhostWindow = [
        {
          ...sessions[0],
          windows: [
            ...sessions[0].windows,
            {
              index: 0, // same index as real window — key collision without optimisticId
              windowId: "",
              name: "new-window",
              worktreePath: "",
              activity: "idle" as const,
              isActiveWindow: false,
              activityTimestamp: 0,
              optimistic: true,
              optimisticId: "ghost-w-2",
            },
          ],
        },
      ];
      // Should not throw from duplicate React keys
      renderSidebar({ sessions: sessionsWithGhostWindow });
      expect(screen.getByText("new-window")).toBeInTheDocument();
    });
  });
});
