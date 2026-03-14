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
        sidebarOpen={false}
        drawerOpen={false}
        onNavigate={vi.fn()}
        onToggleSidebar={vi.fn()}
        onToggleDrawer={vi.fn()}
        onCreateSession={vi.fn()}
        onCreateWindow={vi.fn()}
        onOpenCompose={vi.fn()}
        {...overrides}
      />
    </ChromeProvider>,
  );
}

describe("TopBar", () => {
  afterEach(cleanup);

  it("renders breadcrumb with session and window names", () => {
    renderTopBar();
    expect(screen.getByText("run-kit")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("uses / as breadcrumb separator (not chevron)", () => {
    renderTopBar();
    expect(screen.getByText("/")).toBeInTheDocument();
    // No chevron separators
    expect(screen.queryByText("\u276F")).not.toBeInTheDocument();
  });

  it("does not show 'live' or 'disconnected' text", () => {
    renderTopBar();
    expect(screen.queryByText("live")).not.toBeInTheDocument();
    expect(screen.queryByText("disconnected")).not.toBeInTheDocument();
  });

  it("shows connection dot without text label", () => {
    renderTopBar({ isConnected: false });
    expect(screen.queryByText("live")).not.toBeInTheDocument();
    expect(screen.queryByText("disconnected")).not.toBeInTheDocument();
    // The dot exists with an aria-label
    expect(screen.getByLabelText("Disconnected")).toBeInTheDocument();
  });

  it("renders FixedWidthToggle", () => {
    renderTopBar();
    expect(screen.getByLabelText("Toggle fixed terminal width")).toBeInTheDocument();
  });

  it("renders hamburger icon (not logo img) as navigation toggle", () => {
    renderTopBar();
    const toggleBtn = screen.getByLabelText("Toggle navigation");
    expect(toggleBtn).toBeInTheDocument();
    // Should contain an SVG, not an img
    expect(toggleBtn.querySelector("svg")).toBeTruthy();
    expect(toggleBtn.querySelector("img")).toBeNull();
  });

  it("renders compose button in top bar", () => {
    renderTopBar();
    expect(screen.getByLabelText("Compose text")).toBeInTheDocument();
  });

  it("calls onOpenCompose when compose button is clicked", () => {
    const onOpenCompose = vi.fn();
    renderTopBar({ onOpenCompose });
    fireEvent.click(screen.getByLabelText("Compose text"));
    expect(onOpenCompose).toHaveBeenCalledTimes(1);
  });

  it("renders 'Run Kit' branding text", () => {
    renderTopBar();
    expect(screen.getByText("Run Kit")).toBeInTheDocument();
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

    // Open the session breadcrumb dropdown (session name is the trigger)
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

    // Open the window breadcrumb dropdown (window name is the trigger)
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
