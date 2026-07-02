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

// Drive the NotificationControl deterministically: mock the push lib so each
// test picks the reported state without touching real serviceWorker / Notification.
const getPushState = vi.fn();
const enablePushSubscription = vi.fn();
const sendTestNotification = vi.fn();
vi.mock("@/lib/push", () => ({
  getPushState: (...a: unknown[]) => getPushState(...a),
  enablePushSubscription: (...a: unknown[]) => enablePushSubscription(...a),
  sendTestNotification: (...a: unknown[]) => sendTestNotification(...a),
}));

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
    // NotificationControl's hook calls getPushState() on mount; default it to a
    // resolved promise so every render is safe even in tests that don't touch
    // notifications (afterEach's restoreAllMocks would otherwise leave it
    // returning undefined → `undefined.then` on the next render).
    getPushState.mockResolvedValue("default");
    enablePushSubscription.mockResolvedValue("subscribed");
    sendTestNotification.mockResolvedValue(true);
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

  it("shows the server name as the current-page leaf on the Server Cabin (no window), not 'Dashboard'", () => {
    // root mode, no window \u2192 the server crumb IS the leaf.
    renderTopBar({ mode: "root", sessionName: "", windowName: "", currentSession: null, currentWindow: null, server: "runkit" });
    // The literal "Dashboard" label is gone in every mode.
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    // The server name renders as a non-link current-page leaf.
    const leaf = screen.getByText("runkit");
    expect(leaf).toHaveAttribute("aria-current", "page");
    expect(leaf.tagName).not.toBe("A");
    // No session/window breadcrumbs.
    expect(screen.queryByLabelText("Switch session")).not.toBeInTheDocument();
  });

  it("shows the server crumb as a link to /$server plus session/window breadcrumbs on a terminal route", () => {
    renderTopBar();
    // Server crumb is a link back to the Server Cabin.
    const serverLink = screen.getByText("runkit").closest("a")!;
    expect(serverLink).toHaveAttribute("href", "/runkit");
    // Session + window crumbs present; no "Dashboard".
    expect(screen.getByText("run-kit")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("renders breadcrumb with session and window names", () => {
    renderTopBar();
    expect(screen.getByText("run-kit")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
  });

  it("uses \u203A (U+203A) as the breadcrumb separator (not / or the old chevron)", () => {
    renderTopBar();
    // The new separator appears between crumb levels.
    expect(screen.getAllByText("\u203A").length).toBeGreaterThan(0);
    // No `/` text separator and no old \u276F chevron remain.
    expect(screen.queryByText("/")).not.toBeInTheDocument();
    expect(screen.queryByText("\u276F")).not.toBeInTheDocument();
  });

  it("renders the brand as the left-most root crumb linking to / (and no right-side Run Kit anchor)", () => {
    const { container } = renderTopBar();
    const brand = screen.getByLabelText("Run Kit home");
    expect(brand.tagName).toBe("A");
    expect(brand).toHaveAttribute("href", "/");
    // The brand is the FIRST element inside the breadcrumb nav.
    const nav = container.querySelector('nav[aria-label="Breadcrumb"]')!;
    expect(nav.firstElementChild).toBe(brand);
    // There is exactly ONE anchor to "/" (the left brand) \u2014 the old right-side
    // Run Kit anchor is gone.
    const homeAnchors = Array.from(container.querySelectorAll('a[href="/"]'));
    expect(homeAnchors).toHaveLength(1);
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

  it("renders the hamburger toggle on terminal/root/board but NOT on the cockpit", () => {
    renderTopBar();
    expect(screen.getByLabelText("Toggle navigation")).toBeInTheDocument();
    cleanup();
    // Cockpit has no sidebar, so no hamburger.
    renderTopBar({ mode: "cockpit", sessions: [], currentSession: null, currentWindow: null, sessionName: "", windowName: "", server: "" });
    expect(screen.queryByLabelText("Toggle navigation")).not.toBeInTheDocument();
  });

  it("renders the connection dot as the right-most element on terminal/root, hidden on board and cockpit", () => {
    const { container } = renderTopBar();
    // The dot's status wrapper is the LAST child of the right-hand control cluster.
    const dotStatus = container.querySelector('[role="status"]')!;
    expect(dotStatus).toBeInTheDocument();
    const cluster = dotStatus.parentElement!;
    expect(cluster.lastElementChild).toBe(dotStatus);
    cleanup();
    renderTopBar({ mode: "board", boardName: "b", paneCount: 1, serverCount: 1, boards: [{ name: "b" }] });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    cleanup();
    renderTopBar({ mode: "cockpit", sessions: [], currentSession: null, currentWindow: null, sessionName: "", windowName: "", server: "" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  describe("cockpit mode (Server List home)", () => {
    /** Cockpit passes tolerant-empty session/server props (board-mode shape). */
    function renderCockpit() {
      return renderTopBar({
        mode: "cockpit",
        sessions: [],
        currentSession: null,
        currentWindow: null,
        sessionName: "",
        windowName: "",
        server: "",
      });
    }

    it("renders the brand link and the route-agnostic controls, without erroring on empty props", () => {
      renderCockpit();
      // Brand root crumb links home.
      expect(screen.getByLabelText("Run Kit home")).toHaveAttribute("href", "/");
      // Route-agnostic controls stay.
      expect(screen.getByLabelText("Toggle fixed terminal width")).toBeInTheDocument();
      expect(screen.getByLabelText(/theme/i)).toBeInTheDocument();
    });

    it("renders no hamburger, no connection dot, no terminal-font control, no split/close buttons", () => {
      renderCockpit();
      expect(screen.queryByLabelText("Toggle navigation")).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Terminal font size")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Split vertically")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Split horizontally")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Close pane")).not.toBeInTheDocument();
    });
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

    it("is shown in terminal mode (a terminal surface to size)", () => {
      renderTopBar({ mode: "terminal" });
      expect(screen.getByLabelText("Terminal font size")).toBeInTheDocument();
    });

    it("is shown in board mode (board panes are terminals)", () => {
      renderTopBar({ mode: "board", boardName: "b", paneCount: 1, serverCount: 1, boards: [{ name: "b" }] });
      expect(screen.getByLabelText("Terminal font size")).toBeInTheDocument();
    });

    it("is hidden in root mode (dashboard has no terminal)", () => {
      renderTopBar({ mode: "root", currentWindow: null });
      expect(screen.queryByLabelText("Terminal font size")).not.toBeInTheDocument();
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

  describe("NotificationControl", () => {
    beforeEach(() => {
      getPushState.mockReset().mockResolvedValue("default");
      enablePushSubscription.mockReset().mockResolvedValue("subscribed");
      sendTestNotification.mockReset().mockResolvedValue(true);
    });

    /** Render and flush the mount-time getPushState() promise. */
    async function renderWithState(state: string) {
      getPushState.mockResolvedValue(state);
      let utils!: ReturnType<typeof renderTopBar>;
      await act(async () => {
        utils = renderTopBar();
        await Promise.resolve();
      });
      return utils;
    }

    it("renders the bell trigger labeled 'off' when not subscribed", async () => {
      await renderWithState("default");
      expect(screen.getByLabelText("Notifications off")).toBeInTheDocument();
      expect(screen.queryByLabelText("Notifications on")).not.toBeInTheDocument();
    });

    it("renders the bell labeled 'on' when subscribed", async () => {
      await renderWithState("subscribed");
      expect(screen.getByLabelText("Notifications on")).toBeInTheDocument();
    });

    it("announces the blocked state distinctly to screen readers when denied", async () => {
      await renderWithState("denied");
      expect(screen.getByLabelText("Notifications blocked")).toBeInTheDocument();
      expect(screen.queryByLabelText("Notifications off")).not.toBeInTheDocument();
    });

    it("hides itself entirely when push is unsupported", async () => {
      await renderWithState("unsupported");
      expect(screen.queryByLabelText("Notifications off")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Notifications on")).not.toBeInTheDocument();
    });

    it("opens a dropdown with Enable + (disabled) Test when not subscribed", async () => {
      await renderWithState("default");
      act(() => fireEvent.click(screen.getByLabelText("Notifications off")));
      expect(screen.getByText("Enable notifications")).toBeInTheDocument();
      // Test is present but disabled until subscribed.
      expect(screen.getByText("Send test notification").closest("button")).toBeDisabled();
    });

    it("calls enablePushSubscription when Enable is clicked", async () => {
      await renderWithState("default");
      act(() => fireEvent.click(screen.getByLabelText("Notifications off")));
      await act(async () => {
        fireEvent.click(screen.getByText("Enable notifications"));
        await Promise.resolve();
      });
      expect(enablePushSubscription).toHaveBeenCalledTimes(1);
    });

    it("enables the Test action and calls sendTestNotification when subscribed", async () => {
      await renderWithState("subscribed");
      act(() => fireEvent.click(screen.getByLabelText("Notifications on")));
      // No Enable item when already subscribed.
      expect(screen.queryByText("Enable notifications")).not.toBeInTheDocument();
      const testBtn = screen.getByText("Send test notification").closest("button")!;
      expect(testBtn).not.toBeDisabled();
      await act(async () => {
        fireEvent.click(testBtn);
        await Promise.resolve();
      });
      expect(sendTestNotification).toHaveBeenCalledTimes(1);
    });

    it("includes a Notifications help link to the GitHub guide (new tab)", async () => {
      await renderWithState("default");
      act(() => fireEvent.click(screen.getByLabelText("Notifications off")));
      const help = screen.getByText("Notifications help…").closest("a")!;
      expect(help).toHaveAttribute("href", expect.stringContaining("docs/site/notifications.md"));
      expect(help).toHaveAttribute("target", "_blank");
      expect(help).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("closes the dropdown on Escape and returns focus to the bell", async () => {
      await renderWithState("subscribed");
      const trigger = screen.getByLabelText("Notifications on");
      act(() => fireEvent.click(trigger));
      expect(screen.getByText("Send test notification")).toBeInTheDocument();
      act(() => fireEvent.keyDown(document, { key: "Escape" }));
      expect(screen.queryByText("Send test notification")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });
});
