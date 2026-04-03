import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Sidebar } from "./sidebar";
import { OptimisticProvider } from "@/contexts/optimistic-context";
import { ToastProvider } from "@/components/toast";
import type { ProjectSession } from "@/types";

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    renameWindow: vi.fn().mockResolvedValue({ ok: true }),
  };
});

const sessions: ProjectSession[] = [
  {
    name: "run-kit",
    windows: [
      {
        index: 0,
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
    ],
  },
  {
    name: "ao-server",
    windows: [
      {
        index: 0,
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
          servers={["runkit"]}
          onSwitchServer={vi.fn()}
          onCreateServer={vi.fn()}
          onRefreshServers={vi.fn()}
          {...overrides}
        />
      </OptimisticProvider>
    </ToastProvider>,
  );
}

describe("Sidebar", () => {
  afterEach(cleanup);

  it("renders all sessions", () => {
    renderSidebar();
    expect(screen.getByText("run-kit")).toBeInTheDocument();
    expect(screen.getByText("ao-server")).toBeInTheDocument();
  });

  it("renders windows for expanded sessions", () => {
    renderSidebar();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("scratch")).toBeInTheDocument();
    expect(screen.getByText("dev")).toBeInTheDocument();
  });

  it("collapse/expand sessions via chevron click", () => {
    renderSidebar();
    // Windows are visible by default
    expect(screen.getByText("main")).toBeInTheDocument();

    // Click chevron to collapse
    fireEvent.click(screen.getByLabelText(/Collapse run-kit/));
    expect(screen.queryByText("main")).not.toBeInTheDocument();

    // Click chevron again to expand
    fireEvent.click(screen.getByLabelText(/Expand run-kit/));
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("session name click navigates to first window (not toggles)", () => {
    const onSelectWindow = vi.fn();
    renderSidebar({ onSelectWindow });

    // Click the session name text
    fireEvent.click(screen.getByLabelText("Navigate to run-kit"));
    expect(onSelectWindow).toHaveBeenCalledWith("run-kit", 0);

    // Windows should still be visible (not collapsed)
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("highlights selected window", () => {
    renderSidebar();
    const mainBtn = screen.getByText("main").closest("button");
    expect(mainBtn?.className).toContain("bg-accent/10");
    expect(mainBtn?.className).toContain("border-accent");
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
    expect(screen.getByText(/2 window/)).toBeInTheDocument();
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

  // Inline rename tests (dcl9)
  describe("inline rename", () => {
    it("double-click on window name activates inline input", () => {
      renderSidebar();
      const nameSpan = screen.getByText("main");
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
      fireEvent.keyDown(input, { key: "Enter" });

      expect(screen.queryByLabelText("Rename window")).not.toBeInTheDocument();
      expect(renameWindowMock).toHaveBeenCalledWith("run-kit", 1, "new-name");
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
      fireEvent.blur(input);

      expect(screen.queryByLabelText("Rename window")).not.toBeInTheDocument();
      expect(renameWindowMock).toHaveBeenCalledWith("run-kit", 1, "blur-name");
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
      // Start editing "main"
      fireEvent.doubleClick(screen.getByText("main"));
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

  it("does not show external marker (removed in single-server model)", () => {
    renderSidebar();
    expect(screen.queryByLabelText("external session")).not.toBeInTheDocument();
  });
});
