import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { TopBar } from "./top-bar";
import { ChromeProvider } from "@/contexts/chrome-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { ToastProvider } from "@/components/toast";
import type { ProjectSession, WindowInfo } from "@/types";

// TopBar is rendered without a RouterProvider here, so stub the two router
// hooks it (and its sub-components: BoardSwitcher, HierarchyDropdown, HistoryNav)
// consume — `useNavigate` and `useRouter().history.back()/.forward()` (the
// 260714-uco1 history arrows). Mirrors the sidebar tests' router-mock pattern.
const mockNavigate = vi.fn();
const mockHistoryBack = vi.fn();
const mockHistoryForward = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouter: () => ({ history: { back: mockHistoryBack, forward: mockHistoryForward } }),
}));

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    splitWindow: vi.fn().mockResolvedValue({ ok: true, pane_id: "%1" }),
    closePane: vi.fn().mockResolvedValue({ ok: true }),
    renameWindow: vi.fn().mockResolvedValue({ ok: true }),
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

  it("shows the server name as the centered `Server Cabin:` heading on the Server Cabin (no window), not 'Dashboard' or a left leaf crumb", () => {
    // root mode, no window \u2192 move-don't-copy: the server name is the CENTERED
    // heading leaf, NOT a left `aria-current` crumb (260704-pr0p).
    renderTopBar({ mode: "root", sessionName: "", windowName: "", currentSession: null, currentWindow: null, server: "runkit" });
    // The literal "Dashboard" label is gone in every mode.
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    // The server name renders as the centered `Server Cabin: <server>` heading
    // (display-only \u2014 no rename). Its accessible name carries the type prefix.
    const heading = screen.getByLabelText("Server Cabin runkit");
    expect(heading).toBeInTheDocument();
    // It is NOT inside the left breadcrumb nav (the left nav ends at the parent).
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).not.toContainElement(heading);
    // And it is not a link and not an aria-current leaf.
    expect(heading.tagName).not.toBe("A");
    expect(heading).not.toHaveAttribute("aria-current");
    // No session/window breadcrumbs.
    expect(screen.queryByLabelText("Switch session")).not.toBeInTheDocument();
  });

  it("shows the server crumb as a link to /$server plus the session crumb on a terminal route (breadcrumb ends at session)", () => {
    renderTopBar();
    // Server crumb is a link back to the Server Cabin.
    const serverLink = screen.getByText("runkit").closest("a")!;
    expect(serverLink).toHaveAttribute("href", "/runkit");
    // Session crumb present; no "Dashboard".
    expect(screen.getByText("run-kit")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    // The breadcrumb ends at the session — the window name is NOT a trailing
    // breadcrumb crumb anymore (260703-5ilm moved it to the centered heading).
    // It lives in the heading button, not the Breadcrumb nav.
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav.textContent).not.toContain("main");
  });

  it("renders the window name once, in the centered editable heading (not duplicated in the breadcrumb)", () => {
    renderTopBar();
    expect(screen.getByText("run-kit")).toBeInTheDocument();
    // The window name renders as the centered heading — a click-to-rename button.
    const heading = screen.getByRole("button", { name: "Rename window main" });
    expect(heading).toHaveTextContent("main");
    // Appears exactly once (no breadcrumb + center duplication).
    expect(screen.getAllByText("main")).toHaveLength(1);
  });

  describe("universal center heading (260704-pr0p)", () => {
    it("renders a static `Window:` prefix sibling OUTSIDE the rename button on terminal routes", () => {
      renderTopBar();
      const heading = screen.getByRole("button", { name: "Rename window main" });
      // The prefix is a static `Window:` in every lens (260714-uco1 — the
      // lens-following `Terminal:`/`Web:`/`Chat:` prefix was retired; the lens
      // is shown by the ViewSwitcher, not the heading). The hierarchy ▾ splits
      // the prefix DOM between the word and its colon (`Window ▾:` — intake §3),
      // so the word ("Window") and the colon (":") render as separate text runs
      // rather than a single contiguous `Window:` node; assert the word run.
      const prefix = screen.getByText("Window", { exact: true });
      expect(prefix).toBeInTheDocument();
      // The hierarchy ▾ sits between the word and the colon, inside the prefix
      // region (`Window ▾: name`).
      expect(screen.getByLabelText("Switch hierarchy")).toBeInTheDocument();
      // …but the prefix is NOT inside the rename button (clicking it must not
      // start an edit — the button binds only to the name).
      expect(heading).not.toContainElement(prefix);
    });

    it("renders `Board: <name>` display heading + a ▾ board switcher in board mode", () => {
      renderTopBar({
        mode: "board",
        currentWindow: null,
        windowName: "",
        boardName: "ops-wall",
        paneCount: 2,
        serverCount: 1,
        boards: [{ name: "ops-wall" }, { name: "review" }],
      });
      // Display-only heading (no rename button); its accessible name carries the
      // `Board` type prefix.
      expect(screen.getByLabelText("Board ops-wall")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Rename/ })).not.toBeInTheDocument();
      // The ▾ board switcher relocated to the center beside the name.
      expect(screen.getByLabelText("Switch board")).toBeInTheDocument();
    });

    it("renders `Server Cabin: <server>` display heading (no rename) in root mode", () => {
      renderTopBar({ mode: "root", currentWindow: null, windowName: "" });
      expect(screen.getByLabelText("Server Cabin runkit")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Rename/ })).not.toBeInTheDocument();
    });

    it("renders the solo `Cockpit` word (no prefix, no name) in cockpit mode", () => {
      renderTopBar({
        mode: "cockpit",
        sessions: [],
        currentSession: null,
        currentWindow: null,
        sessionName: "",
        windowName: "",
        server: "",
      });
      const solo = screen.getByLabelText("Cockpit");
      expect(solo).toBeInTheDocument();
      expect(solo).toHaveTextContent("Cockpit");
      // No `Server Cabin:` / `Board:` / `Window:` prefix on the solo word.
      expect(screen.queryByText(/Server Cabin:|Board:|Window:/)).not.toBeInTheDocument();
    });
  });

  describe("boot sweep hover — single owner for the whole heading", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // The sweep must actually RUN here: re-stub matchMedia query-sensitively
      // (the suite default stubs `matches: true` for EVERY query, which makes
      // `prefersReducedMotion()` true and skips the sweep entirely). Dark theme
      // still matches; reduced-motion does not.
      vi.stubGlobal(
        "matchMedia",
        vi.fn().mockImplementation((query: string) => ({
          matches: query.includes("prefers-color-scheme"),
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // `Window: main` = 7 prefix + 1 space + 4 name cells at 28ms/cell; the
    // mount replay (name-effect null seed) must be flushed before hovering.
    const SWEEP_MS = (7 + 1 + 4 + 2) * 28;
    const INTENT_MS = 140;

    function renderAndSettle() {
      renderTopBar();
      act(() => {
        vi.advanceTimersByTime(SWEEP_MS + 100);
      });
      const button = screen.getByRole("button", { name: "Rename window main" });
      const wrapper = button.parentElement!;
      const prefixWord = screen.getByText("Window", { exact: true });
      // Structure: ONE wrapper span owns both the prefix and the name button —
      // it is the single hover owner for the sweep.
      expect(wrapper).toContainElement(prefixWord);
      return { button, wrapper, prefixWord };
    }

    const cursorIn = (wrapper: HTMLElement) => wrapper.querySelector(".rk-typed-cursor");

    it("does NOT restart the sweep when the pointer crosses the prefix → name boundary", () => {
      const { button, wrapper, prefixWord } = renderAndSettle();

      // Enter the heading over the prefix: hover-intent delay, then sweep starts.
      fireEvent.mouseOver(prefixWord, { relatedTarget: document.body });
      act(() => {
        vi.advanceTimersByTime(INTENT_MS + 28 * 2);
      });
      expect(cursorIn(wrapper)).not.toBeNull();

      // Cross from the prefix onto the name button. With per-sibling hover
      // handlers this fired resolve() (cursor snapped away) plus a deferred
      // replay; with the wrapper as the single owner it is a non-event — the
      // in-flight sweep continues uninterrupted.
      fireEvent.mouseOut(prefixWord, { relatedTarget: button });
      fireEvent.mouseOver(button, { relatedTarget: prefixWord });
      expect(cursorIn(wrapper)).not.toBeNull();

      // The same pass runs to completion and settles to rest.
      act(() => {
        vi.advanceTimersByTime(SWEEP_MS + 100);
      });
      expect(cursorIn(wrapper)).toBeNull();
      expect(wrapper.textContent).toContain("Window");
      expect(wrapper.textContent).toContain("main");
    });

    it("resolves the sweep when the pointer leaves the whole heading", () => {
      const { button, wrapper } = renderAndSettle();

      fireEvent.mouseOver(button, { relatedTarget: document.body });
      act(() => {
        vi.advanceTimersByTime(INTENT_MS + 28);
      });
      expect(cursorIn(wrapper)).not.toBeNull();

      // Leaving the wrapper entirely resolves immediately to rest.
      fireEvent.mouseOut(button, { relatedTarget: document.body });
      expect(cursorIn(wrapper)).toBeNull();
      expect(wrapper.textContent).toContain("main");
    });
  });

  describe("history nav arrows + hierarchy dropdown (260714-uco1)", () => {
    beforeEach(() => {
      mockNavigate.mockReset();
      mockHistoryBack.mockReset();
      mockHistoryForward.mockReset();
    });

    it("renders ◀ ▶ browser-history arrows on the terminal route and wires them to router.history", () => {
      renderTopBar();
      const back = screen.getByRole("button", { name: "Go back" });
      const forward = screen.getByRole("button", { name: "Go forward" });
      fireEvent.click(back);
      fireEvent.click(forward);
      expect(mockHistoryBack).toHaveBeenCalledTimes(1);
      expect(mockHistoryForward).toHaveBeenCalledTimes(1);
    });

    it("renders the history arrows on the cockpit (solo) heading too — history is global", () => {
      renderTopBar({
        mode: "cockpit",
        sessions: [],
        currentSession: null,
        currentWindow: null,
        sessionName: "",
        windowName: "",
        server: "",
      });
      expect(screen.getByRole("button", { name: "Go back" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Go forward" })).toBeInTheDocument();
      // …but NO hierarchy ▾ on the root of the hierarchy.
      expect(screen.queryByLabelText("Switch hierarchy")).not.toBeInTheDocument();
    });

    it("renders a hierarchy ▾ on the terminal route listing the ancestor chain (Server Cabin → Cockpit)", () => {
      renderTopBar();
      const trigger = screen.getByLabelText("Switch hierarchy");
      expect(trigger).toBeInTheDocument();
      fireEvent.click(trigger);
      // Ancestors only — nearest-first — no window/lateral entries. The item
      // label carries the `Server Cabin:` type prefix (assumption #6).
      expect(screen.getByRole("menuitem", { name: "Server Cabin: runkit" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Cockpit" })).toBeInTheDocument();
    });

    it("hierarchy ▾ navigates up when an ancestor is chosen (never enters rename)", () => {
      renderTopBar();
      fireEvent.click(screen.getByLabelText("Switch hierarchy"));
      fireEvent.click(screen.getByRole("menuitem", { name: "Server Cabin: runkit" }));
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/$server", params: { server: "runkit" } });
      // The rename edit input never appeared.
      expect(screen.queryByRole("textbox", { name: "Window name" })).not.toBeInTheDocument();
    });

    it("board/root hierarchy ▾ lists only Cockpit (no Server Cabin ancestor)", () => {
      renderTopBar({ mode: "root", currentWindow: null, windowName: "" });
      fireEvent.click(screen.getByLabelText("Switch hierarchy"));
      expect(screen.getByRole("menuitem", { name: "Cockpit" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: /Server Cabin/ })).not.toBeInTheDocument();
    });
  });

  it("uses \u203A (U+203A) as the breadcrumb separator (not / or the old chevron)", () => {
    renderTopBar();
    // The new separator appears between crumb levels.
    expect(screen.getAllByText("\u203A").length).toBeGreaterThan(0);
    // No `/` text separator and no old \u276F chevron remain.
    expect(screen.queryByText("/")).not.toBeInTheDocument();
    expect(screen.queryByText("\u276F")).not.toBeInTheDocument();
  });

  it("names each crumb's level via a native title tooltip (Cockpit / Server Cabin / Session / Window)", () => {
    renderTopBar();
    expect(screen.getByLabelText("Run Kit home")).toHaveAttribute("title", "Cockpit");
    expect(screen.getByText("runkit").closest("a")).toHaveAttribute("title", "Server Cabin");
    expect(screen.getByLabelText("Switch session")).toHaveAttribute("title", "Session");
    expect(screen.getByLabelText("Switch window")).toHaveAttribute("title", "Window");
  });

  it("carries the Server Cabin identity on the centered heading in root mode (no window)", () => {
    // The server-name leaf moved to the center heading (260704-pr0p); its
    // accessible name is the `Server Cabin <server>` heading rather than a
    // left crumb with a `title` tooltip.
    renderTopBar({ mode: "root", sessionName: "", windowName: "", currentSession: null, currentWindow: null });
    expect(screen.getByLabelText("Server Cabin runkit")).toBeInTheDocument();
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

  it("renders FixedWidthToggle in terminal mode (L1 terminal-only button)", () => {
    renderTopBar();
    expect(screen.getByLabelText("Toggle fixed terminal width")).toBeInTheDocument();
  });

  it("does NOT render FixedWidthToggle outside terminal mode (root/board/cockpit)", () => {
    // 260704-9o7k: the fixed-width BUTTON is terminal-only now; the 900px
    // wrapper + palette action live in AppShell and are untouched.
    renderTopBar({ mode: "root", currentWindow: null, windowName: "" });
    expect(screen.queryByLabelText("Toggle fixed terminal width")).not.toBeInTheDocument();
    cleanup();
    renderTopBar({ mode: "board", currentWindow: null, boardName: "b", paneCount: 1, serverCount: 1, boards: [{ name: "b" }] });
    expect(screen.queryByLabelText("Toggle fixed terminal width")).not.toBeInTheDocument();
    cleanup();
    renderTopBar({ mode: "cockpit", sessions: [], currentSession: null, currentWindow: null, sessionName: "", windowName: "", server: "" });
    expect(screen.queryByLabelText("Toggle fixed terminal width")).not.toBeInTheDocument();
  });

  it("renders the L3 always block in Notification → Theme → Refresh → Help order, dot right-most (260704-9o7k pyramid)", () => {
    const { container } = renderTopBar();
    const cluster = container.querySelector('.justify-self-end')!;
    // Collect the ordered accessible landmarks of the always block + dot.
    const bell = screen.getByLabelText(/Notifications/);
    const theme = screen.getByLabelText(/theme/i);
    const refresh = screen.getByLabelText("Refresh page");
    const help = screen.getByLabelText("Help — run-kit docs");
    const dot = cluster.querySelector('[role="status"]')!;
    // DOCUMENT_POSITION_FOLLOWING (4) means the arg comes AFTER the node.
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(bell, theme)).toBe(true);
    expect(follows(theme, refresh)).toBe(true);
    expect(follows(refresh, help)).toBe(true);
    expect(follows(help, dot)).toBe(true);
    // Dot is the last child of the cluster.
    expect(cluster.lastElementChild).toBe(dot);
  });

  it("renders the hamburger toggle on terminal/root/board but NOT on the cockpit", () => {
    renderTopBar();
    expect(screen.getByLabelText("Toggle navigation")).toBeInTheDocument();
    cleanup();
    // Cockpit has no sidebar, so no hamburger.
    renderTopBar({ mode: "cockpit", sessions: [], currentSession: null, currentWindow: null, sessionName: "", windowName: "", server: "" });
    expect(screen.queryByLabelText("Toggle navigation")).not.toBeInTheDocument();
  });

  it("renders the connection dot as the right-most element in ALL four modes (260704-9o7k: dot everywhere)", () => {
    // Terminal.
    const { container } = renderTopBar();
    const dotStatus = container.querySelector('[role="status"]')!;
    expect(dotStatus).toBeInTheDocument();
    const cluster = dotStatus.parentElement!;
    expect(cluster.lastElementChild).toBe(dotStatus);
    cleanup();
    // Root (Server Cabin).
    renderTopBar({ mode: "root", currentWindow: null, windowName: "" });
    expect(screen.getByRole("status")).toBeInTheDocument();
    cleanup();
    // Board — dot now renders (per-page "live data flowing"; caller derives it).
    renderTopBar({ mode: "board", currentWindow: null, boardName: "b", paneCount: 1, serverCount: 1, boards: [{ name: "b" }] });
    expect(screen.getByRole("status")).toBeInTheDocument();
    cleanup();
    // Cockpit — dot now renders (host-metrics stream health).
    renderTopBar({ mode: "cockpit", sessions: [], currentSession: null, currentWindow: null, sessionName: "", windowName: "", server: "" });
    expect(screen.getByRole("status")).toBeInTheDocument();
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

    it("renders the brand link and the L3 always-block controls, without erroring on empty props", () => {
      renderCockpit();
      // Brand root crumb links home.
      expect(screen.getByLabelText("Run Kit home")).toHaveAttribute("href", "/");
      // L3 always-block controls stay (Refresh + Help promoted here; Theme).
      expect(screen.getByLabelText(/theme/i)).toBeInTheDocument();
      expect(screen.getByLabelText("Refresh page")).toBeInTheDocument();
      expect(screen.getByLabelText("Help — run-kit docs")).toBeInTheDocument();
      // The fixed-width BUTTON is terminal-only now (260704-9o7k).
      expect(screen.queryByLabelText("Toggle fixed terminal width")).not.toBeInTheDocument();
    });

    it("renders no hamburger, no terminal-font control, no split/close/fixed-width buttons; dot IS present (host-metrics health)", () => {
      renderCockpit();
      expect(screen.queryByLabelText("Toggle navigation")).not.toBeInTheDocument();
      // 260704-9o7k: the dot now renders on Cockpit (host-metrics stream health).
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.queryByLabelText("Terminal font size")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Split vertically")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Split horizontally")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Close pane")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Toggle fixed terminal width")).not.toBeInTheDocument();
    });
  });

  describe("HelpLink", () => {
    it("renders a help anchor pointing at the run-kit docs, opening in a new tab safely", () => {
      renderTopBar();
      const help = screen.getByLabelText("Help — run-kit docs");
      // Anchor (not button) so external nav never unloads the live dashboard.
      expect(help.tagName).toBe("A");
      expect(help).toHaveAttribute("href", "https://shll.ai/run-kit");
      expect(help).toHaveAttribute("target", "_blank");
      // rel must carry both tokens: noopener severs window.opener, noreferrer
      // strips the Referer header — both needed for a safe external new tab.
      const rel = help.getAttribute("rel") ?? "";
      expect(rel).toContain("noopener");
      expect(rel).toContain("noreferrer");
      // The native tooltip mirrors the accessible name so mouse + AT users see
      // the same label.
      expect(help).toHaveAttribute("title", "Help — run-kit docs");
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

  describe("board-mode ✕ = close the focused tile's pane (260715-6jwn)", () => {
    /** Board mode passes tolerant-empty session props plus the focused-tile
     *  split/close target (`focusedPane`) the top bar now keys on. */
    function renderBoard(overrides: Partial<React.ComponentProps<typeof TopBar>> = {}) {
      return renderTopBar({
        mode: "board",
        sessions: [],
        currentSession: null,
        currentWindow: null,
        sessionName: "",
        windowName: "",
        server: "",
        boardName: "b",
        paneCount: 1,
        serverCount: 1,
        boards: [{ name: "b" }],
        focusedPane: { server: "runkit", windowId: "@7", cwd: "~/code/x" },
        ...overrides,
      });
    }

    it("labels the ✕ as 'Close pane' (uniform with terminal) and calls closePane with the focused tile's target, not any unpin", async () => {
      const { closePane } = await import("@/api/client");
      renderBoard();
      // The board ✕ carries the terminal label now (no more "Unpin pane from board").
      expect(screen.queryByLabelText("Unpin pane from board")).not.toBeInTheDocument();
      const close = screen.getByLabelText("Close pane");
      await act(async () => {
        fireEvent.click(close);
      });
      expect(closePane).toHaveBeenCalledWith("runkit", "@7");
    });

    it("fires onPaneClosed after a successful board ✕ kill (self-heal seam)", async () => {
      const onPaneClosed = vi.fn();
      renderBoard({ onPaneClosed });
      await act(async () => {
        fireEvent.click(screen.getByLabelText("Close pane"));
      });
      expect(onPaneClosed).toHaveBeenCalledTimes(1);
    });

    it("disables the ✕ when the board has no focused tile (empty board)", async () => {
      const { closePane } = await import("@/api/client");
      const before = vi.mocked(closePane).mock.calls.length;
      renderBoard({ focusedPane: null, paneCount: 0 });
      const close = screen.getByLabelText("Close pane");
      expect(close).toBeDisabled();
      await act(async () => {
        fireEvent.click(close);
      });
      expect(vi.mocked(closePane).mock.calls.length).toBe(before);
    });

    it("renders both SplitButtons on board mode, wired to the focused tile", async () => {
      const { splitWindow } = await import("@/api/client");
      renderBoard();
      const vsplit = screen.getByLabelText("Split vertically");
      const hsplit = screen.getByLabelText("Split horizontally");
      expect(vsplit).toBeInTheDocument();
      expect(hsplit).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(vsplit);
      });
      expect(splitWindow).toHaveBeenCalledWith("runkit", "@7", false, "~/code/x");
    });

    it("renders no SplitButtons on an empty board (no focused tile)", () => {
      renderBoard({ focusedPane: null, paneCount: 0 });
      expect(screen.queryByLabelText("Split vertically")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Split horizontally")).not.toBeInTheDocument();
    });

    it("does NOT render FixedWidthToggle on board mode (terminal-only)", () => {
      renderBoard();
      expect(screen.queryByLabelText("Toggle fixed terminal width")).not.toBeInTheDocument();
    });

    it("terminal-mode ✕ still calls closePane (kill) with the current window", async () => {
      const { closePane } = await import("@/api/client");
      renderTopBar(); // terminal mode default
      await act(async () => {
        fireEvent.click(screen.getByLabelText("Close pane"));
      });
      expect(closePane).toHaveBeenCalledWith("runkit", "@0");
    });
  });

  describe("RefreshButton", () => {
    // jsdom's window.location.reload is a non-configurable own property, so
    // vi.spyOn(window.location, "reload") throws "Cannot redefine property".
    // Instead replace window.location wholesale with a plain object exposing a
    // mock reload. The original location is restored in afterEach.
    let originalLocation: Location;
    let reloadMock: ReturnType<typeof vi.fn>;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      originalLocation = window.location;
      reloadMock = vi.fn();
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: { ...originalLocation, reload: reloadMock },
      });
      // forceReload's cache-busting fetch; jsdom has no fetch, so stub it.
      // (Safe alongside the suite's matchMedia stub: that one is re-stubbed in
      // the outer beforeEach on every test, so unstubAllGlobals below cannot
      // strand a later test without it.)
      fetchMock = vi.fn(() => Promise.resolve());
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    });

    it("renders the refresh button when a window is selected", () => {
      renderTopBar();
      expect(screen.getByLabelText("Refresh page")).toBeInTheDocument();
    });

    it("still renders the refresh button on the Server Cabin (no window) — it moved to the always block (260704-9o7k)", () => {
      renderTopBar({ mode: "root", currentWindow: null, windowName: "" });
      expect(screen.getByLabelText("Refresh page")).toBeInTheDocument();
    });

    it("has no disabled state and no spinner (synchronous, non-destructive action)", () => {
      renderTopBar();
      const btn = screen.getByLabelText("Refresh page");
      expect(btn).not.toBeDisabled();
      // No LogoSpinner (its viewBox is the tell used by the Split/Close tests).
      expect(btn.querySelector("svg[viewBox='7 10 50 44']")).toBeFalsy();
    });

    // The stub also sees unrelated app fetches (e.g. ThemeProvider's
    // /api/settings/theme on mount), so assertions filter to forceReload's
    // signature call — second arg { cache: "reload" } — not total counts.
    const forceCalls = () =>
      fetchMock.mock.calls.filter((c) => c[1]?.cache === "reload");

    it("calls window.location.reload() when clicked (no cache-busting fetch)", () => {
      renderTopBar();
      fireEvent.click(screen.getByLabelText("Refresh page"));
      expect(reloadMock).toHaveBeenCalledTimes(1);
      expect(forceCalls()).toHaveLength(0);
    });

    it("Shift+click force-reloads: cache-busting fetch settles, then reload", async () => {
      renderTopBar();
      fireEvent.click(screen.getByLabelText("Refresh page"), { shiftKey: true });
      expect(forceCalls()).toHaveLength(1);
      // The reload rides the fetch promise's .finally — not yet fired…
      expect(reloadMock).not.toHaveBeenCalled();
      await act(async () => {});
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it("Shift+click still reloads when the cache-busting fetch rejects", async () => {
      fetchMock.mockReturnValueOnce(Promise.reject(new Error("offline")));
      renderTopBar();
      fireEvent.click(screen.getByLabelText("Refresh page"), { shiftKey: true });
      await act(async () => {});
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });

    it("Shift+click still reloads when the fetch hangs (timeout wins the race)", async () => {
      // A stalled socket: the fetch promise never resolves nor rejects. The
      // reload must still fire — via forceReload's timeout branch — exactly
      // once, honoring the "never blocked by a failing network" contract.
      vi.useFakeTimers();
      try {
        fetchMock.mockReturnValueOnce(new Promise(() => {})); // never settles
        renderTopBar();
        fireEvent.click(screen.getByLabelText("Refresh page"), {
          shiftKey: true,
        });
        expect(reloadMock).not.toHaveBeenCalled();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000);
        });
        expect(reloadMock).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
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

// Centered, highlighted, editable window heading (change 260703-5ilm).
describe("WindowHeading (centered, editable, terminal mode)", () => {
  beforeEach(() => {
    // Clear call history between tests (the renameWindow module mock persists
    // its calls across tests otherwise), then re-arm the push-lib fns.
    vi.clearAllMocks();
    getPushState.mockResolvedValue("default");
    enablePushSubscription.mockResolvedValue("subscribed");
    sendTestNotification.mockResolvedValue(true);
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

  it("renders the current window name at rest as a click-to-rename button (weight-600, primary color)", () => {
    renderTopBar();
    const heading = screen.getByRole("button", { name: "Rename window main" });
    expect(heading).toHaveTextContent("main");
    expect(heading).toHaveClass("font-semibold", "text-text-primary");
  });

  it("renders no editable (click-to-rename) heading outside terminal mode — the center carries a display-only heading instead", () => {
    renderTopBar({ mode: "root", currentWindow: null, windowName: "" });
    expect(screen.queryByRole("button", { name: /Rename window/ })).not.toBeInTheDocument();
  });

  it("clicking the name swaps to an inline input pre-filled with the name", () => {
    renderTopBar();
    act(() => fireEvent.click(screen.getByRole("button", { name: "Rename window main" })));
    const input = screen.getByRole("textbox", { name: "Window name" }) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("main");
  });

  it("Enter commits a non-empty trimmed name via renameWindow()", async () => {
    const { renameWindow } = await import("@/api/client");
    renderTopBar();
    act(() => fireEvent.click(screen.getByRole("button", { name: "Rename window main" })));
    const input = screen.getByRole("textbox", { name: "Window name" });
    act(() => fireEvent.change(input, { target: { value: "  renamed  " } }));
    act(() => fireEvent.keyDown(input, { key: "Enter" }));
    await waitFor(() => {
      expect(renameWindow).toHaveBeenCalledWith("runkit", "@0", "renamed");
    });
    // Reverts to display state.
    expect(screen.queryByRole("textbox", { name: "Window name" })).not.toBeInTheDocument();
  });

  it("Escape cancels with no API call and restores the original name", async () => {
    const { renameWindow } = await import("@/api/client");
    renderTopBar();
    act(() => fireEvent.click(screen.getByRole("button", { name: "Rename window main" })));
    const input = screen.getByRole("textbox", { name: "Window name" });
    act(() => fireEvent.change(input, { target: { value: "abandoned" } }));
    act(() => fireEvent.keyDown(input, { key: "Escape" }));
    expect(renameWindow).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Rename window main" })).toBeInTheDocument();
  });

  it("commit of an empty / whitespace-only value cancels (no rename call)", async () => {
    const { renameWindow } = await import("@/api/client");
    renderTopBar();
    act(() => fireEvent.click(screen.getByRole("button", { name: "Rename window main" })));
    const input = screen.getByRole("textbox", { name: "Window name" });
    act(() => fireEvent.change(input, { target: { value: "   " } }));
    act(() => fireEvent.keyDown(input, { key: "Enter" }));
    expect(renameWindow).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Rename window main" })).toBeInTheDocument();
  });

  it("blur commits (like Enter)", async () => {
    const { renameWindow } = await import("@/api/client");
    renderTopBar();
    act(() => fireEvent.click(screen.getByRole("button", { name: "Rename window main" })));
    const input = screen.getByRole("textbox", { name: "Window name" });
    act(() => fireEvent.change(input, { target: { value: "viaBlur" } }));
    act(() => fireEvent.blur(input));
    await waitFor(() => {
      expect(renameWindow).toHaveBeenCalledWith("runkit", "@0", "viaBlur");
    });
  });

  it("the `window-heading:rename` CustomEvent enters inline edit (command-palette keyboard path)", () => {
    renderTopBar();
    expect(screen.queryByRole("textbox", { name: "Window name" })).not.toBeInTheDocument();
    act(() => {
      document.dispatchEvent(new CustomEvent("window-heading:rename"));
    });
    expect(screen.getByRole("textbox", { name: "Window name" })).toBeInTheDocument();
  });

  it("relocated ▾ window switcher offers + New Window", () => {
    const onCreateWindow = vi.fn();
    renderTopBar({ onCreateWindow });
    const windowDropdown = screen.getByLabelText("Switch window");
    act(() => fireEvent.click(windowDropdown));
    const newWindowBtn = screen.getByText("+ New Window");
    act(() => fireEvent.click(newWindowBtn));
    expect(onCreateWindow).toHaveBeenCalledWith("run-kit");
  });
});
