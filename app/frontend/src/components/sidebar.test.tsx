import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Sidebar } from "./sidebar";
import type { ProjectSession } from "@/types";

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
      },
      {
        index: 1,
        name: "scratch",
        worktreePath: "~/code/run-kit",
        activity: "idle",
        isActiveWindow: false,
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

  it("collapse/expand sessions on click", () => {
    renderSidebar();
    // Windows are visible by default
    expect(screen.getByText("main")).toBeInTheDocument();

    // Click session name to collapse
    fireEvent.click(screen.getByLabelText(/Collapse run-kit/));
    expect(screen.queryByText("main")).not.toBeInTheDocument();

    // Click again to expand
    fireEvent.click(screen.getByLabelText(/Expand run-kit/));
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("highlights selected window", () => {
    renderSidebar();
    const mainBtn = screen.getByText("main").closest("button");
    expect(mainBtn?.className).toContain("bg-card");
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
    expect(screen.getByText("apply")).toBeInTheDocument();
  });

  it("does not render a footer with + New Session button", () => {
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

  it("shows empty state when no sessions", () => {
    renderSidebar({ sessions: [] });
    expect(screen.getByText("No sessions")).toBeInTheDocument();
  });
});
