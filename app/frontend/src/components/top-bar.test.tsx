import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TopBar } from "./top-bar";
import { ChromeProvider } from "@/contexts/chrome-context";
import type { ProjectSession, WindowInfo } from "@/types";

const nowSeconds = Math.floor(Date.now() / 1000);

const fabWindow: WindowInfo = {
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
};

const nonFabIdleWindow: WindowInfo = {
  index: 0,
  name: "dev",
  worktreePath: "~/code/ao-server",
  activity: "idle",
  isActiveWindow: true,
  paneCommand: "zsh",
  activityTimestamp: nowSeconds - 120,
};

const sessions: ProjectSession[] = [
  {
    name: "run-kit",
    byobu: false,
    windows: [fabWindow],
  },
  {
    name: "ao-server",
    byobu: false,
    windows: [nonFabIdleWindow],
  },
];

function renderTopBar(overrides: Partial<React.ComponentProps<typeof TopBar>> = {}) {
  return render(
    <ChromeProvider>
      <TopBar
        sessions={sessions}
        currentSession={sessions[0]}
        currentWindow={fabWindow}
        sessionName="run-kit"
        windowName="main"
        isConnected={true}
        onNavigate={vi.fn()}
        onToggleSidebar={vi.fn()}
        onToggleDrawer={vi.fn()}
        onCreateSession={vi.fn()}
        onCreateWindow={vi.fn()}
        {...overrides}
      />
    </ChromeProvider>,
  );
}

describe("TopBar Line 1", () => {
  afterEach(cleanup);

  it("renders breadcrumb with session and window names", () => {
    renderTopBar();
    expect(screen.getByText("run-kit")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("shows connection status", () => {
    renderTopBar();
    expect(screen.getByText("live")).toBeInTheDocument();
  });

  it("shows disconnected status", () => {
    renderTopBar({ isConnected: false });
    expect(screen.getByText("disconnected")).toBeInTheDocument();
  });

  it("renders FixedWidthToggle in Line 1", () => {
    renderTopBar();
    expect(screen.getByLabelText("Toggle fixed terminal width")).toBeInTheDocument();
  });

  it("does not render Line 2 elements", () => {
    renderTopBar();
    expect(screen.queryByTestId("line2-status")).not.toBeInTheDocument();
    expect(screen.queryByText("+ Session")).not.toBeInTheDocument();
    expect(screen.queryByText("Rename")).not.toBeInTheDocument();
    expect(screen.queryByText("Kill")).not.toBeInTheDocument();
  });

  it("calls onCreateSession when + New Session dropdown action is clicked", () => {
    const onCreateSession = vi.fn();
    renderTopBar({ onCreateSession });

    // Open the session breadcrumb dropdown
    const sessionDropdown = screen.getByLabelText("Switch session");
    fireEvent.click(sessionDropdown);

    // Click the "+ New Session" action
    const newSessionBtn = screen.getByText("+ New Session");
    expect(newSessionBtn).toBeInTheDocument();
    fireEvent.click(newSessionBtn);

    expect(onCreateSession).toHaveBeenCalledTimes(1);
    // Menu should close after action
    expect(screen.queryByText("+ New Session")).not.toBeInTheDocument();
  });

  it("calls onCreateWindow when + New Window dropdown action is clicked", () => {
    const onCreateWindow = vi.fn();
    renderTopBar({ onCreateWindow });

    // Open the window breadcrumb dropdown
    const windowDropdown = screen.getByLabelText("Switch window");
    fireEvent.click(windowDropdown);

    // Click the "+ New Window" action
    const newWindowBtn = screen.getByText("+ New Window");
    expect(newWindowBtn).toBeInTheDocument();
    fireEvent.click(newWindowBtn);

    expect(onCreateWindow).toHaveBeenCalledWith("run-kit");
    // Menu should close after action
    expect(screen.queryByText("+ New Window")).not.toBeInTheDocument();
  });
});
