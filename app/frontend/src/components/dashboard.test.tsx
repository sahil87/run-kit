import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Dashboard } from "./dashboard";
import type { ProjectSession } from "@/types";

const nowSeconds = Math.floor(Date.now() / 1000);

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
        paneCommand: "claude",
        activityTimestamp: nowSeconds - 5,
        agentState: "active",
        fabChange: "260313-txna-rich-sidebar-window-status",
        fabStage: "apply",
      },
      {
        index: 1,
        name: "scratch",
        worktreePath: "~/code/run-kit",
        activity: "idle",
        isActiveWindow: false,
        paneCommand: "zsh",
        activityTimestamp: nowSeconds - 120,
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
        activityTimestamp: nowSeconds - 3600,
      },
    ],
  },
];

function renderDashboard(
  overrides: Partial<React.ComponentProps<typeof Dashboard>> = {},
) {
  return render(
    <Dashboard
      sessions={sessions}
      onNavigate={vi.fn()}
      onCreateSession={vi.fn()}
      onCreateWindow={vi.fn()}
      {...overrides}
    />,
  );
}

describe("Dashboard", () => {
  afterEach(cleanup);

  it("renders stats line with session and window counts", () => {
    renderDashboard();
    expect(screen.getByText(/2 sessions/)).toBeInTheDocument();
    expect(screen.getByText(/3 windows/)).toBeInTheDocument();
  });

  it("renders session cards", () => {
    renderDashboard();
    expect(screen.getByText("run-kit")).toBeInTheDocument();
    expect(screen.getByText("ao-server")).toBeInTheDocument();
  });

  it("shows window count and activity summary on session cards", () => {
    renderDashboard();
    expect(screen.getByText(/2 windows/)).toBeInTheDocument();
    expect(screen.getByText(/1 active, 1 idle/)).toBeInTheDocument();
    expect(screen.getByText(/1 window/)).toBeInTheDocument();
    expect(screen.getByText(/0 active, 1 idle/)).toBeInTheDocument();
  });

  it("expands to show window cards on click", () => {
    renderDashboard();
    // Windows not visible initially
    expect(screen.queryByText("main")).not.toBeInTheDocument();

    // Expand run-kit
    fireEvent.click(screen.getByLabelText("Expand run-kit"));
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("scratch")).toBeInTheDocument();
  });

  it("collapses expanded session card on click", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Expand run-kit"));
    expect(screen.getByText("main")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Collapse run-kit"));
    expect(screen.queryByText("main")).not.toBeInTheDocument();
  });

  it("calls onNavigate when window card is clicked", () => {
    const onNavigate = vi.fn();
    renderDashboard({ onNavigate });

    fireEvent.click(screen.getByLabelText("Expand run-kit"));
    fireEvent.click(screen.getByTestId("window-card-run-kit-0"));
    expect(onNavigate).toHaveBeenCalledWith("run-kit", 0);
  });

  it("shows paneCommand on window cards", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Expand run-kit"));
    expect(screen.getByText("claude")).toBeInTheDocument();
  });

  it("shows fab stage badge on window cards", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Expand run-kit"));
    expect(screen.getByText("apply")).toBeInTheDocument();
  });

  it("shows fab info (id and slug) on window cards", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Expand run-kit"));
    expect(screen.getByText(/txna/)).toBeInTheDocument();
  });

  it("shows activity dot and label on window cards", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Expand run-kit"));
    // "active" appears in window card activity label and session summary
    const activeTexts = screen.getAllByText(/active/);
    expect(activeTexts.length).toBeGreaterThanOrEqual(1);
    // "idle" appears in window card and session summaries
    const idleTexts = screen.getAllByText(/idle/);
    expect(idleTexts.length).toBeGreaterThanOrEqual(1);
  });

  it("calls onCreateSession when New Session button is clicked", () => {
    const onCreateSession = vi.fn();
    renderDashboard({ onCreateSession });
    fireEvent.click(screen.getByText("+ New Session"));
    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it("shows New Window button in expanded session card", () => {
    const onCreateWindow = vi.fn();
    renderDashboard({ onCreateWindow });
    fireEvent.click(screen.getByLabelText("Expand run-kit"));
    fireEvent.click(screen.getByText("+ New Window"));
    expect(onCreateWindow).toHaveBeenCalledWith("run-kit");
  });

  it("root element className contains min-h-0", () => {
    const { container } = renderDashboard();
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("min-h-0");
  });

  it("renders empty state with New Session button when no sessions", () => {
    const onCreateSession = vi.fn();
    renderDashboard({ sessions: [], onCreateSession });
    expect(screen.getByText(/0 sessions/)).toBeInTheDocument();
    expect(screen.getByText(/0 windows/)).toBeInTheDocument();
    const btn = screen.getByText("+ New Session");
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onCreateSession).toHaveBeenCalledTimes(1);
  });

  it("allows multiple sessions to be expanded simultaneously", () => {
    renderDashboard();
    fireEvent.click(screen.getByLabelText("Expand run-kit"));
    fireEvent.click(screen.getByLabelText("Expand ao-server"));
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("dev")).toBeInTheDocument();
  });
});
