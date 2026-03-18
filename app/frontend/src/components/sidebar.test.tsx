import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Sidebar } from "./sidebar";
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
    byobu: false,
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
    byobu: false,
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
    <Sidebar
      sessions={sessions}
      currentSession="run-kit"
      currentWindowIndex="0"
      onSelectWindow={vi.fn()}
      onCreateWindow={vi.fn()}
      onCreateSession={vi.fn()}
      {...overrides}
    />,
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

  // T009: ring class on isActiveWindow dot
  it("shows green ring on active isActiveWindow dot", () => {
    renderSidebar();
    // "main" window: isActiveWindow=true, activity=active → green ring
    const dots = screen.getAllByLabelText("active");
    // Find the dot that has ring-accent-green
    const greenRingDot = dots.find((d) => d.className.includes("ring-accent-green"));
    expect(greenRingDot).toBeTruthy();
    expect(greenRingDot?.className).toContain("ring-1");
  });

  it("shows dim ring on idle isActiveWindow dot", () => {
    renderSidebar();
    // "dev" window: isActiveWindow=true, activity=idle → dim ring
    const idleDots = screen.getAllByLabelText("idle");
    const dimRingDot = idleDots.find((d) => d.className.includes("ring-text-secondary/40"));
    expect(dimRingDot).toBeTruthy();
    expect(dimRingDot?.className).toContain("ring-1");
  });

  it("shows no ring on non-focused window dot", () => {
    renderSidebar();
    // "scratch" window: isActiveWindow=false, activity=idle → no ring
    const idleDots = screen.getAllByLabelText("idle");
    // Find one without ring class
    const noRingDot = idleDots.find((d) => !d.className.includes("ring-1"));
    expect(noRingDot).toBeTruthy();
  });

  // T009: duration display
  it("shows duration for idle fab windows", () => {
    renderSidebar();
    // scratch: idle with agentIdleDuration "3m"
    expect(screen.getByText("3m")).toBeInTheDocument();
  });

  it("shows duration for idle non-fab windows", () => {
    renderSidebar();
    // dev: idle, non-fab, 3600s ago → "1h"
    expect(screen.getByText("1h")).toBeInTheDocument();
  });

  it("omits duration for active windows", () => {
    renderSidebar();
    // "main" window is active — should have no duration text
    // (duration would only be something like "5s" if shown — but active windows skip duration)
    const mainRow = screen.getByText("main").closest("button");
    // The active window should NOT have a duration span as a sibling
    expect(mainRow?.textContent).not.toMatch(/\d+s$/);
  });

  // T009: info button
  it("renders info button for each window", () => {
    renderSidebar();
    const infoButtons = screen.getAllByLabelText(/Info for/);
    expect(infoButtons.length).toBe(3); // main, scratch, dev
  });

  it("opens and closes popover on info button click", () => {
    renderSidebar();
    const infoBtn = screen.getByLabelText("Info for main");

    // Open popover
    fireEvent.click(infoBtn);
    expect(screen.getByText("Process")).toBeInTheDocument();
    expect(screen.getByText("claude")).toBeInTheDocument();
    expect(screen.getByText("Path")).toBeInTheDocument();

    // Re-tap to close
    fireEvent.click(infoBtn);
    expect(screen.queryByText("Process")).not.toBeInTheDocument();
  });

  it("popover shows Change row for fab windows", () => {
    renderSidebar();
    const infoBtn = screen.getByLabelText("Info for main");
    fireEvent.click(infoBtn);

    expect(screen.getByText("Change")).toBeInTheDocument();
    // Should show parsed id and slug
    expect(screen.getByText(/txna/)).toBeInTheDocument();
    expect(screen.getByText(/rich-sidebar-window-status/)).toBeInTheDocument();
  });

  it("popover omits Change row for non-fab windows", () => {
    renderSidebar();
    const infoBtn = screen.getByLabelText("Info for dev");
    fireEvent.click(infoBtn);

    // "Change" label should not be present for non-fab
    const allText = screen.getByText("Path").closest("[data-info-popover]")?.textContent ?? "";
    expect(allText).not.toContain("Change");
  });

  it("dismisses popover on Escape", () => {
    renderSidebar();
    const infoBtn = screen.getByLabelText("Info for main");
    fireEvent.click(infoBtn);
    expect(screen.getByText("Process")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Process")).not.toBeInTheDocument();
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

    it("single-click navigates without triggering edit", () => {
      const onSelectWindow = vi.fn();
      renderSidebar({ onSelectWindow });
      fireEvent.click(screen.getByText("scratch"));

      expect(onSelectWindow).toHaveBeenCalledWith("run-kit", 1);
      expect(screen.queryByLabelText("Rename window")).not.toBeInTheDocument();
    });
  });
});
