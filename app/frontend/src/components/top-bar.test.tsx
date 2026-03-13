import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
        view="terminal"
        onNavigate={vi.fn()}
        onRename={vi.fn()}
        onKill={vi.fn()}
        onToggleSidebar={vi.fn()}
        onToggleDrawer={vi.fn()}
        onCreateSession={vi.fn()}
        onCreateWindow={vi.fn()}
        {...overrides}
      />
    </ChromeProvider>,
  );
}

describe("TopBar Line 2 enriched status", () => {
  afterEach(cleanup);

  it("shows full status for fab window", () => {
    renderTopBar();
    const status = screen.getByTestId("line2-status");
    expect(status).toBeInTheDocument();
    // Activity
    expect(screen.getByText("active")).toBeInTheDocument();
    // Pane command
    expect(screen.getByText("claude")).toBeInTheDocument();
    // Fab stage badge
    expect(screen.getByText("apply")).toBeInTheDocument();
    // Fab change ID and slug
    expect(screen.getByText("txna")).toBeInTheDocument();
    expect(screen.getByText("rich-sidebar-window-status")).toBeInTheDocument();
  });

  it("shows non-fab window status with duration", () => {
    renderTopBar({ currentWindow: nonFabIdleWindow, currentSession: sessions[1], sessionName: "ao-server" });
    const status = screen.getByTestId("line2-status");
    expect(status).toBeInTheDocument();
    // Activity
    expect(screen.getByText("idle")).toBeInTheDocument();
    // Pane command
    expect(screen.getByText("zsh")).toBeInTheDocument();
    // Duration: 120s → "2m"
    expect(screen.getByText("2m")).toBeInTheDocument();
    // No fab fields
    expect(screen.queryByText("apply")).not.toBeInTheDocument();
    expect(screen.queryByText("txna")).not.toBeInTheDocument();
  });

  it("omits pane command when empty", () => {
    const winNoPaneCmd: WindowInfo = {
      ...fabWindow,
      paneCommand: undefined,
    };
    renderTopBar({ currentWindow: winNoPaneCmd });
    expect(screen.queryByText("claude")).not.toBeInTheDocument();
  });

  it("omits fab fields when no fabStage", () => {
    const winNoFab: WindowInfo = {
      ...fabWindow,
      fabStage: undefined,
      fabChange: undefined,
    };
    renderTopBar({ currentWindow: winNoFab });
    expect(screen.queryByText("apply")).not.toBeInTheDocument();
    expect(screen.queryByText("txna")).not.toBeInTheDocument();
  });

  it("parses ID and slug from fabChange correctly", () => {
    renderTopBar();
    // "260313-txna-rich-sidebar-window-status" → id: "txna", slug: "rich-sidebar-window-status"
    expect(screen.getByText("txna")).toBeInTheDocument();
    expect(screen.getByText("rich-sidebar-window-status")).toBeInTheDocument();
  });

  it("renders enriched status hidden on mobile via hidden sm:flex", () => {
    renderTopBar();
    const status = screen.getByTestId("line2-status");
    expect(status.className).toContain("hidden");
    expect(status.className).toContain("sm:flex");
  });

  it("shows no status when no current window", () => {
    renderTopBar({ currentWindow: null });
    expect(screen.queryByTestId("line2-status")).not.toBeInTheDocument();
  });
});

describe("TopBar view-dependent breadcrumbs", () => {
  afterEach(cleanup);

  it("dashboard: shows only logo, no session or window breadcrumbs", () => {
    renderTopBar({ view: "dashboard", sessionName: "", windowName: "" });
    // No session or window text in breadcrumb
    expect(screen.queryByText("run-kit")).not.toBeInTheDocument();
    expect(screen.queryByText("main")).not.toBeInTheDocument();
  });

  it("project page: shows session breadcrumb, no window breadcrumb", () => {
    renderTopBar({ view: "project", sessionName: "run-kit", windowName: "", currentWindow: null });
    expect(screen.getByText("run-kit")).toBeInTheDocument();
    // No window name
    expect(screen.queryByText("main")).not.toBeInTheDocument();
  });

  it("terminal: shows both session and window breadcrumbs", () => {
    renderTopBar({ view: "terminal" });
    expect(screen.getByText("run-kit")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });
});

describe("TopBar view-dependent Line 2 actions", () => {
  afterEach(cleanup);

  it("dashboard: shows only + Session button", () => {
    renderTopBar({ view: "dashboard", sessionName: "", windowName: "", currentWindow: null });
    expect(screen.getByText("+ Session")).toBeInTheDocument();
    expect(screen.queryByText("+ Window")).not.toBeInTheDocument();
    expect(screen.queryByText("Rename")).not.toBeInTheDocument();
    expect(screen.queryByText("Kill")).not.toBeInTheDocument();
  });

  it("project page: shows + Session and + Window buttons", () => {
    renderTopBar({ view: "project", sessionName: "run-kit", windowName: "", currentWindow: null });
    expect(screen.getByText("+ Session")).toBeInTheDocument();
    expect(screen.getByText("+ Window")).toBeInTheDocument();
    expect(screen.queryByText("Rename")).not.toBeInTheDocument();
    expect(screen.queryByText("Kill")).not.toBeInTheDocument();
  });

  it("terminal: shows + Session, Rename, and Kill buttons", () => {
    renderTopBar({ view: "terminal" });
    expect(screen.getByText("+ Session")).toBeInTheDocument();
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Kill")).toBeInTheDocument();
    expect(screen.queryByText("+ Window")).not.toBeInTheDocument();
  });

  it("terminal: hides status and fixed-width toggle on non-terminal views", () => {
    renderTopBar({ view: "dashboard", sessionName: "", windowName: "", currentWindow: null });
    expect(screen.queryByTestId("line2-status")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Toggle fixed terminal width")).not.toBeInTheDocument();
  });

  it("terminal: shows fixed-width toggle on terminal view", () => {
    renderTopBar({ view: "terminal" });
    expect(screen.getByLabelText("Toggle fixed terminal width")).toBeInTheDocument();
  });
});
