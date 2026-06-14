import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { TopBar } from "./top-bar";
import { ChromeProvider } from "@/contexts/chrome-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { ToastProvider } from "@/components/toast";
import type { ProjectSession, WindowInfo } from "@/types";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    splitWindow: vi.fn().mockResolvedValue({ ok: true, pane_id: "%1" }),
    closePane: vi.fn().mockResolvedValue({ ok: true }),
  };
});

const nowSeconds = Math.floor(Date.now() / 1000);

const fabWindow: WindowInfo = {
  index: 0,
  windowId: "@0",
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
  windowId: "@1",
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
    windows: [fabWindow],
  },
  {
    name: "ao-server",
    windows: [nonFabIdleWindow],
  },
];

function renderTopBar(overrides: Partial<React.ComponentProps<typeof TopBar>> = {}) {
  return render(
    <ToastProvider>
      <ThemeProvider>
        <ChromeProvider>
          <TopBar
            sessions={sessions}
            currentSession={sessions[0]}
            currentWindow={fabWindow}
            sessionName="run-kit"
            windowName="main"
            isConnected={true}
            sidebarOpen={false}
            server="runkit"
            onNavigate={vi.fn()}
            onToggleSidebar={vi.fn()}
            onCreateSession={vi.fn()}
            onCreateWindow={vi.fn()}
            {...overrides}
          />
        </ChromeProvider>
      </ThemeProvider>
    </ToastProvider>,
  );
}

describe("TopBar", () => {
  beforeEach(() => {
    // ThemeProvider needs matchMedia
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows Dashboard text when no session is selected", () => {
    renderTopBar({ sessionName: "", windowName: "", currentSession: null, currentWindow: null });
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    // Should not show session/window breadcrumbs
    expect(screen.queryByText("run-kit")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Switch session")).not.toBeInTheDocument();
  });

  it("shows breadcrumbs when session is selected (not Dashboard)", () => {
    renderTopBar();
    expect(screen.getByText("run-kit")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

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

  describe("TerminalFontControl", () => {
    const FONT_KEY = "runkit-terminal-font-size";

    afterEach(() => {
      localStorage.clear();
    });

    /** The stepper lives inside a popover; open it via the "Aa" trigger first. */
    function openFontPopover() {
      act(() => fireEvent.click(screen.getByLabelText("Terminal font size")));
    }

    it("hides the stepper until the Aa trigger is clicked, then reveals all three buttons", () => {
      localStorage.setItem(FONT_KEY, "13");
      renderTopBar();
      // Collapsed: only the trigger is present, no stepper buttons.
      expect(screen.getByLabelText("Terminal font size")).toBeInTheDocument();
      expect(screen.queryByLabelText("Decrease terminal font")).not.toBeInTheDocument();
      openFontPopover();
      expect(screen.getByLabelText("Decrease terminal font")).toBeInTheDocument();
      expect(screen.getByLabelText("Increase terminal font")).toBeInTheDocument();
      expect(screen.getByLabelText("Reset terminal font")).toBeInTheDocument();
      expect(screen.getByLabelText("Terminal font size 13 pixels")).toHaveTextContent("13px");
    });

    it("steps and persists on increase / decrease", () => {
      localStorage.setItem(FONT_KEY, "13");
      renderTopBar();
      openFontPopover();
      act(() => fireEvent.click(screen.getByLabelText("Increase terminal font")));
      expect(screen.getByLabelText("Terminal font size 14 pixels")).toBeInTheDocument();
      expect(localStorage.getItem(FONT_KEY)).toBe("14");
      act(() => fireEvent.click(screen.getByLabelText("Decrease terminal font")));
      expect(screen.getByLabelText("Terminal font size 13 pixels")).toBeInTheDocument();
      expect(localStorage.getItem(FONT_KEY)).toBe("13");
    });

    it("disables the decrease button at the min bound (8)", () => {
      localStorage.setItem(FONT_KEY, "8");
      renderTopBar();
      openFontPopover();
      expect(screen.getByLabelText("Decrease terminal font")).toBeDisabled();
      expect(screen.getByLabelText("Increase terminal font")).not.toBeDisabled();
    });

    it("disables the increase button at the max bound (24)", () => {
      localStorage.setItem(FONT_KEY, "24");
      renderTopBar();
      openFontPopover();
      expect(screen.getByLabelText("Increase terminal font")).toBeDisabled();
      expect(screen.getByLabelText("Decrease terminal font")).not.toBeDisabled();
    });

    it("reset clears the stored preference (forget)", () => {
      localStorage.setItem(FONT_KEY, "18");
      renderTopBar();
      openFontPopover();
      expect(screen.getByLabelText("Terminal font size 18 pixels")).toBeInTheDocument();
      act(() => fireEvent.click(screen.getByLabelText("Reset terminal font")));
      expect(localStorage.getItem(FONT_KEY)).toBeNull();
    });

    it("closes the popover on Escape and returns focus to the trigger", () => {
      localStorage.setItem(FONT_KEY, "13");
      renderTopBar();
      openFontPopover();
      expect(screen.getByLabelText("Decrease terminal font")).toBeInTheDocument();
      act(() => fireEvent.keyDown(document, { key: "Escape" }));
      expect(screen.queryByLabelText("Decrease terminal font")).not.toBeInTheDocument();
      expect(screen.getByLabelText("Terminal font size")).toHaveFocus();
    });
  });

  it("renders hamburger icon (not logo img) as navigation toggle", () => {
    renderTopBar();
    const toggleBtn = screen.getByLabelText("Toggle navigation");
    expect(toggleBtn).toBeInTheDocument();
    // Should contain an SVG, not an img
    expect(toggleBtn.querySelector("svg")).toBeTruthy();
    expect(toggleBtn.querySelector("img")).toBeNull();
  });

  it("fills the sidebar-slot pictogram when the sidebar is open", () => {
    // The nav toggle is a Notion-style panel pictogram: a rounded-rect outline
    // plus a left-column "slot" rect whose fill-opacity tracks sidebarOpen.
    // The slot is the only rect carrying an explicit fill — the outer panel
    // inherits the svg's fill="none".
    const slotFillOpacity = () =>
      screen
        .getByLabelText("Toggle navigation")
        .querySelector("svg rect[fill='currentColor']")!
        .getAttribute("fill-opacity");

    renderTopBar({ sidebarOpen: true });
    expect(slotFillOpacity()).toBe("0.5");

    cleanup();

    renderTopBar({ sidebarOpen: false });
    expect(slotFillOpacity()).toBe("0");
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

  it("renders ClosePaneButton when a window is selected", () => {
    renderTopBar();
    expect(screen.getByLabelText("Close pane")).toBeInTheDocument();
  });

  it("does not render ClosePaneButton on dashboard (no window)", () => {
    renderTopBar({ currentWindow: null, windowName: "" });
    expect(screen.queryByLabelText("Close pane")).not.toBeInTheDocument();
  });

  it("calls closePane API when ClosePaneButton is clicked", async () => {
    const { closePane } = await import("@/api/client");
    renderTopBar();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Close pane"));
    });
    expect(closePane).toHaveBeenCalledWith("runkit", "@0");
  });

  it("renders SplitButton (vertical and horizontal) when window is selected", () => {
    renderTopBar();
    expect(screen.getByLabelText("Split vertically")).toBeInTheDocument();
    expect(screen.getByLabelText("Split horizontally")).toBeInTheDocument();
  });

  it("does not render SplitButtons on dashboard (no window)", () => {
    renderTopBar({ currentWindow: null, windowName: "" });
    expect(screen.queryByLabelText("Split vertically")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Split horizontally")).not.toBeInTheDocument();
  });

  it("calls splitWindow API when SplitButton is clicked", async () => {
    const { splitWindow } = await import("@/api/client");
    renderTopBar();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Split vertically"));
    });
    expect(splitWindow).toHaveBeenCalledWith("runkit", "@0", false, "~/code/run-kit");
  });

  it("shows spinner and disables SplitButton while pending", async () => {
    const { splitWindow } = await import("@/api/client");
    let resolveAction!: () => void;
    vi.mocked(splitWindow).mockImplementation(() => new Promise((r) => { resolveAction = () => r({ ok: true, pane_id: "%1" }); }));

    renderTopBar();
    const btn = screen.getByLabelText("Split vertically");
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });

    // Button should be disabled and show spinner
    expect(btn).toBeDisabled();
    expect(btn.querySelector("svg[viewBox='7 10 50 44']")).toBeTruthy();

    // Resolve the action
    await act(async () => {
      resolveAction();
    });
    expect(btn).not.toBeDisabled();
    expect(btn.querySelector("svg[viewBox='7 10 50 44']")).toBeFalsy();
  });

  it("shows spinner and disables ClosePaneButton while pending", async () => {
    const { closePane } = await import("@/api/client");
    let resolveAction!: () => void;
    vi.mocked(closePane).mockImplementation(() => new Promise((r) => { resolveAction = () => r({ ok: true }); }));

    renderTopBar();
    const btn = screen.getByLabelText("Close pane");
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });

    expect(btn).toBeDisabled();
    expect(btn.querySelector("svg[viewBox='7 10 50 44']")).toBeTruthy();

    await act(async () => {
      resolveAction();
    });
    expect(btn).not.toBeDisabled();
    expect(btn.querySelector("svg[viewBox='7 10 50 44']")).toBeFalsy();
  });
});
