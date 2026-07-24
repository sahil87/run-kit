import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor, within } from "@testing-library/react";
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

// Drive the Open-in-App entry deterministically: mock the fetch-once hook so
// each test seeds the sshHost/registry context directly (no real fetch). The
// default is the empty context — the common deployment where the entry hides.
const mockOpenCtx: { sshHost: string; hostApps: { id: string; label: string; kind?: string }[] } = {
  sshHost: "",
  hostApps: [],
};
vi.mock("@/hooks/use-open-targets", () => ({
  useOpenTargets: () => ({ sshHost: mockOpenCtx.sshHost, hostApps: mockOpenCtx.hostApps }),
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
    // ThemeProvider needs matchMedia. Query-sensitive on ONE query: everything
    // matches (dark scheme, reduced motion — keeps sweeps skipped) EXCEPT
    // `(pointer: coarse)`, which must be false or every Tip suppresses itself
    // (fine-pointer is the test default; tip.test.tsx covers coarse).
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: query !== "(pointer: coarse)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the server name as the centered `tmux Server:` heading on the tmux Server (no window), not 'Dashboard' or a left leaf crumb", () => {
    // server mode, no window \u2192 move-don't-copy: the server name is the CENTERED
    // heading leaf, NOT a left `aria-current` crumb (260704-pr0p).
    renderTopBar({ mode: "server", sessionName: "", windowName: "", currentSession: null, currentWindow: null, server: "runkit" });
    // The literal "Dashboard" label is gone in every mode.
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    // The server name renders as the centered `tmux Server: <server>` heading
    // (display-only \u2014 no rename). Its accessible name carries the type prefix.
    const heading = screen.getByLabelText("tmux Server runkit");
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
    // Server crumb is a link back to the tmux Server.
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
      // is shown by the switcher's `View:` menu rows, not the heading). The hierarchy ▾ splits
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

    it("renders `tmux Server: <server>` display heading (no rename) in server mode", () => {
      renderTopBar({ mode: "server", currentWindow: null, windowName: "" });
      expect(screen.getByLabelText("tmux Server runkit")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Rename/ })).not.toBeInTheDocument();
    });

    it("renders the solo `Host` word (no prefix, no name) in host mode", () => {
      renderTopBar({
        mode: "host",
        sessions: [],
        currentSession: null,
        currentWindow: null,
        sessionName: "",
        windowName: "",
        server: "",
      });
      const solo = screen.getByLabelText("Host");
      expect(solo).toBeInTheDocument();
      expect(solo).toHaveTextContent("Host");
      // No `tmux Server:` / `Board:` / `Window:` prefix on the solo word.
      expect(screen.queryByText(/tmux Server:|Board:|Window:/)).not.toBeInTheDocument();
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

    it("renders the history arrows on the host (solo) heading too — history is global", () => {
      renderTopBar({
        mode: "host",
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

    it("renders a hierarchy ▾ on the terminal route listing the ancestor chain (tmux Server → Host)", () => {
      renderTopBar();
      const trigger = screen.getByLabelText("Switch hierarchy");
      expect(trigger).toBeInTheDocument();
      fireEvent.click(trigger);
      // Ancestors only — nearest-first — no window/lateral entries. The item
      // label carries the `tmux Server:` type prefix (assumption #6).
      expect(screen.getByRole("menuitem", { name: "tmux Server: runkit" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Host" })).toBeInTheDocument();
    });

    it("hierarchy ▾ navigates up when an ancestor is chosen (never enters rename)", () => {
      renderTopBar();
      fireEvent.click(screen.getByLabelText("Switch hierarchy"));
      fireEvent.click(screen.getByRole("menuitem", { name: "tmux Server: runkit" }));
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/$server", params: { server: "runkit" } });
      // The rename edit input never appeared.
      expect(screen.queryByRole("textbox", { name: "Window name" })).not.toBeInTheDocument();
    });

    it("board/server hierarchy ▾ lists only Host (no tmux Server ancestor)", () => {
      renderTopBar({ mode: "server", currentWindow: null, windowName: "" });
      fireEvent.click(screen.getByLabelText("Switch hierarchy"));
      expect(screen.getByRole("menuitem", { name: "Host" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: /tmux Server/ })).not.toBeInTheDocument();
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

  it("names each crumb's level via a styled Tip — no native title attributes (260722-73al)", () => {
    renderTopBar();
    const brand = screen.getByLabelText("RunKit home");
    const serverCrumb = screen.getByText("runkit").closest("a");
    const sessionSwitch = screen.getByLabelText("Switch session");
    const windowSwitch = screen.getByLabelText("Switch window");
    // Native `title=` is removed wherever Tip lands (never both, or the OS
    // bubble doubles the styled tip). Tooltip behavior itself is pinned once
    // in tip.test.tsx; here we assert the migration contract per crumb.
    for (const el of [brand, serverCrumb, sessionSwitch, windowSwitch]) {
      expect(el).not.toHaveAttribute("title");
    }
    // Representative behavior check: keyboard focus opens the styled tier-1
    // tip naming the crumb's level.
    act(() => {
      fireEvent.focus(brand);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Host");
  });

  it("carries the tmux Server identity on the centered heading in server mode (no window)", () => {
    // The server-name leaf moved to the center heading (260704-pr0p); its
    // accessible name is the `tmux Server <server>` heading rather than a
    // left crumb with a `title` tooltip.
    renderTopBar({ mode: "server", sessionName: "", windowName: "", currentSession: null, currentWindow: null });
    expect(screen.getByLabelText("tmux Server runkit")).toBeInTheDocument();
  });

  it("renders the brand as the left-most root crumb linking to / (and no right-side RunKit anchor)", () => {
    const { container } = renderTopBar();
    const brand = screen.getByLabelText("RunKit home");
    expect(brand.tagName).toBe("A");
    expect(brand).toHaveAttribute("href", "/");
    // The brand is the FIRST element inside the breadcrumb nav.
    const nav = container.querySelector('nav[aria-label="Breadcrumb"]')!;
    expect(nav.firstElementChild).toBe(brand);
    // There is exactly ONE anchor to "/" (the left brand) \u2014 the old right-side
    // RunKit anchor is gone.
    const homeAnchors = Array.from(container.querySelectorAll('a[href="/"]'));
    expect(homeAnchors).toHaveLength(1);
  });

  it("renders the hamburger as the first left-cluster element, before and OUTSIDE the breadcrumb nav (260720-ap63)", () => {
    // Terminal mode \u2192 hasSidebar true \u2192 the hamburger renders. It is a drawer
    // toggle, not a breadcrumb item: it precedes the nav landmark as a sibling
    // and is never a descendant of it.
    const { container } = renderTopBar();
    const hamburger = screen.getByLabelText("Toggle navigation");
    const nav = container.querySelector('nav[aria-label="Breadcrumb"]')!;
    expect(hamburger.closest('nav[aria-label="Breadcrumb"]')).toBeNull();
    // Same left cluster, hamburger first, nav after it in document order.
    const cluster = nav.parentElement!;
    expect(cluster.firstElementChild).toBe(hamburger);
    expect(
      Boolean(hamburger.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    // Coarse touch target joins the top-bar 24px-fine / 30px-coarse button
    // vocabulary (fine-pointer minimum stays 24px).
    expect(hamburger.className).toContain("coarse:min-w-[30px]");
    expect(hamburger.className).toContain("coarse:min-h-[30px]");
    expect(hamburger.className).toContain("min-w-[24px]");
    expect(hamburger.className).toContain("min-h-[24px]");
  });

  it("does not show 'live' or 'disconnected' text", () => {
    renderTopBar();
    expect(screen.queryByText("live")).not.toBeInTheDocument();
    expect(screen.queryByText("disconnected")).not.toBeInTheDocument();
  });

  it("renders no connection dot — it moved to the sidebar footer (260724-6j1v)", () => {
    renderTopBar();
    expect(screen.queryByLabelText("Connected")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Disconnected")).not.toBeInTheDocument();
    expect(screen.getByTestId("top-bar-right").querySelector('[role="status"]')).toBeNull();
  });

  it("renders FixedWidthToggle in terminal mode (L1 terminal-only button)", () => {
    renderTopBar();
    expect(screen.getByLabelText("Toggle fixed terminal width")).toBeInTheDocument();
  });

  it("does NOT render FixedWidthToggle outside terminal mode (server/board/host)", () => {
    // 260704-9o7k: the fixed-width BUTTON is terminal-only now; the 900px
    // wrapper + palette action live in AppShell and are untouched.
    renderTopBar({ mode: "server", currentWindow: null, windowName: "" });
    expect(screen.queryByLabelText("Toggle fixed terminal width")).not.toBeInTheDocument();
    cleanup();
    renderTopBar({ mode: "board", currentWindow: null, boardName: "b", paneCount: 1, serverCount: 1, boards: [{ name: "b" }] });
    expect(screen.queryByLabelText("Toggle fixed terminal width")).not.toBeInTheDocument();
    cleanup();
    renderTopBar({ mode: "host", sessions: [], currentSession: null, currentWindow: null, sessionName: "", windowName: "", server: "" });
    expect(screen.queryByLabelText("Toggle fixed terminal width")).not.toBeInTheDocument();
  });

  it("keeps the L3 pyramid order (Refresh → chevron, right-most) with theme/help/bell gone from the bar (260724-6j1v)", () => {
    // The right cluster is registry-driven (260715-h1ck). After 260724-6j1v the
    // L3 tier is UpdateChip (context-gated) + Refresh only — theme/help moved to
    // the sidebar footer and the bell folded into the settings dialog. The
    // always-present overflow chevron is the right-most element (the trailing
    // exempt block; the connection dot left the bar too). Order is asserted via
    // document position (robust to whether each control is currently in-bar or
    // in the hidden measurement probe).
    renderTopBar();
    const cluster = screen.getByTestId("top-bar-right");
    const refresh = screen.getByLabelText("Refresh page");
    const chevron = screen.getByLabelText("More controls");
    // DOCUMENT_POSITION_FOLLOWING (4) means the arg comes AFTER the node.
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(refresh, chevron)).toBe(true);
    // The chevron is the deepest-last element of the trailing exempt block.
    expect(cluster.lastElementChild!.contains(chevron)).toBe(true);
    // The moved chrome renders NOWHERE in the top bar (bar, probe, or menu).
    expect(screen.queryByLabelText(/Notifications/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/theme/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Help — run-kit docs")).not.toBeInTheDocument();
    expect(cluster.querySelector('[role="status"]')).toBeNull();
  });

  it("renders the hamburger toggle on terminal/server/board but NOT on the host", () => {
    renderTopBar();
    expect(screen.getByLabelText("Toggle navigation")).toBeInTheDocument();
    cleanup();
    // Host has no sidebar, so no hamburger.
    renderTopBar({ mode: "host", sessions: [], currentSession: null, currentWindow: null, sessionName: "", windowName: "", server: "" });
    expect(screen.queryByLabelText("Toggle navigation")).not.toBeInTheDocument();
  });

  it("renders NO connection dot in ANY of the four modes (260724-6j1v: the dot moved to the sidebar footer)", () => {
    // Terminal.
    const { container } = renderTopBar();
    expect(container.querySelector('[role="status"]')).toBeNull();
    cleanup();
    // Server (tmux Server).
    renderTopBar({ mode: "server", currentWindow: null, windowName: "" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    cleanup();
    // Board.
    renderTopBar({ mode: "board", currentWindow: null, boardName: "b", paneCount: 1, serverCount: 1, boards: [{ name: "b" }] });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    cleanup();
    // Host — loses its indicator entirely (`/` has no sidebar; intake assumption).
    renderTopBar({ mode: "host", sessions: [], currentSession: null, currentWindow: null, sessionName: "", windowName: "", server: "" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  describe("host mode (Server List home)", () => {
    /** Host passes tolerant-empty session/server props (board-mode shape). */
    function renderHost() {
      return renderTopBar({
        mode: "host",
        sessions: [],
        currentSession: null,
        currentWindow: null,
        sessionName: "",
        windowName: "",
        server: "",
      });
    }

    it("renders the brand link and the surviving L3 always-block (Refresh), without erroring on empty props", () => {
      renderHost();
      // Brand root crumb links home.
      expect(screen.getByLabelText("RunKit home")).toHaveAttribute("href", "/");
      // Refresh is the surviving L3 always-block control; theme + help moved to
      // the sidebar footer (260724-6j1v) and never render in the bar.
      expect(screen.getByLabelText("Refresh page")).toBeInTheDocument();
      expect(screen.queryByLabelText(/theme/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Help — run-kit docs")).not.toBeInTheDocument();
      // The fixed-width BUTTON is terminal-only now (260704-9o7k).
      expect(screen.queryByLabelText("Toggle fixed terminal width")).not.toBeInTheDocument();
    });

    it("renders no hamburger, no terminal-font control, no split/close/fixed-width buttons, and no dot (260724-6j1v)", () => {
      renderHost();
      expect(screen.queryByLabelText("Toggle navigation")).not.toBeInTheDocument();
      // The dot moved to the sidebar footer; the Host page has no sidebar.
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Terminal font size")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Split vertically")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Split horizontally")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Close pane")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Toggle fixed terminal width")).not.toBeInTheDocument();
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

    it("is hidden in server mode (dashboard has no terminal)", () => {
      renderTopBar({ mode: "server", currentWindow: null });
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

  it("renders 'RunKit' branding text", () => {
    renderTopBar();
    expect(screen.getByText("RunKit")).toBeInTheDocument();
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

  describe("board-mode ✕ = consequence-gated Kill (co9z)", () => {
    /** Board mode passes tolerant-empty session props plus the focused-tile
     *  split/kill target (`focusedPane`) the top bar keys on, and `onRequestKill`
     *  (co9z) which routes the ✕ to BoardPage's confirm dialog. */
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
        onRequestKill: vi.fn(),
        ...overrides,
      });
    }

    it("labels the board ✕ as 'Kill' and calls onRequestKill (NOT closePane) — the board Kill is consequence-gated", async () => {
      const { closePane } = await import("@/api/client");
      vi.mocked(closePane).mockClear();
      const onRequestKill = vi.fn();
      renderBoard({ onRequestKill });
      // The board ✕ reads "Kill" (verb discipline) — no old "Close pane"/"Unpin pane from board".
      expect(screen.queryByLabelText("Close pane")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Unpin pane from board")).not.toBeInTheDocument();
      const kill = screen.getByLabelText("Kill");
      await act(async () => {
        fireEvent.click(kill);
      });
      // Routes to the confirm dialog opener, does NOT fire an immediate close-pane.
      expect(onRequestKill).toHaveBeenCalledTimes(1);
      expect(closePane).not.toHaveBeenCalled();
    });

    it("disables the board ✕ when there is no focused tile (empty board)", async () => {
      const onRequestKill = vi.fn();
      renderBoard({ focusedPane: null, paneCount: 0, onRequestKill });
      const kill = screen.getByLabelText("Kill");
      expect(kill).toBeDisabled();
      await act(async () => {
        fireEvent.click(kill);
      });
      expect(onRequestKill).not.toHaveBeenCalled();
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

    it("still renders the refresh button on the tmux Server (no window) — it moved to the always block (260704-9o7k)", () => {
      renderTopBar({ mode: "server", currentWindow: null, windowName: "" });
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

  describe("Open-in-App entry (260722-6d0f)", () => {
    afterEach(() => {
      mockOpenCtx.sshHost = "";
      mockOpenCtx.hostApps = [];
      localStorage.clear();
    });

    // jsdom overflows every candidate into the chevron menu (zero widths), so
    // the entry's rendered form here is its OpenMenuRows representation — the
    // deterministic assertion surface, same as the overflow describe below.
    it("renders Open: rows when host targets are available (terminal mode)", () => {
      mockOpenCtx.hostApps = [{ id: "vscode", label: "VS Code", kind: "editor" }];
      renderTopBar();
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      // jsdom's hostname is localhost → local view → host section only, no
      // "(on host)" suffix (single-kind list).
      expect(within(menu).getByRole("menuitem", { name: "Open: VS Code" })).toBeInTheDocument();
    });

    it("renders nothing with zero targets (empty registry, no sshHost — the default deployment)", () => {
      renderTopBar();
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      expect(within(menu).queryByRole("menuitem", { name: /^Open:/ })).not.toBeInTheDocument();
      // Nor an in-bar/probe split-button.
      expect(screen.queryByTitle("Open in app")).not.toBeInTheDocument();
    });

    it("is local-gated: sshHost alone yields no targets on a localhost client", () => {
      // Deeplinks are remote-only; jsdom's localhost hostname means the
      // deeplink section stays hidden even with sshHost configured.
      mockOpenCtx.sshHost = "devbox";
      renderTopBar();
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      expect(within(menu).queryByRole("menuitem", { name: /^Open:/ })).not.toBeInTheDocument();
    });

    it("does not render on the board route (terminal-only v1)", () => {
      mockOpenCtx.hostApps = [{ id: "vscode", label: "VS Code" }];
      renderTopBar({ mode: "board", currentWindow: null, boardName: "b", paneCount: 1, serverCount: 1, boards: [{ name: "b" }] });
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      expect(within(menu).queryByRole("menuitem", { name: /^Open:/ })).not.toBeInTheDocument();
    });
  });

  describe("overflow chevron + menu (260715-h1ck)", () => {
    // jsdom reports zero element widths, so the fit math overflows EVERYTHING
    // into the menu — convenient for asserting menu contents deterministically.
    it("renders the always-visible chevron in all four page modes", () => {
      renderTopBar();
      expect(screen.getByLabelText("More controls")).toBeInTheDocument();
      cleanup();
      renderTopBar({ mode: "server", currentWindow: null, windowName: "" });
      expect(screen.getByLabelText("More controls")).toBeInTheDocument();
      cleanup();
      renderTopBar({ mode: "board", currentWindow: null, boardName: "b", paneCount: 1, serverCount: 1, boards: [{ name: "b" }] });
      expect(screen.getByLabelText("More controls")).toBeInTheDocument();
      cleanup();
      renderTopBar({ mode: "host", sessions: [], currentSession: null, currentWindow: null, sessionName: "", windowName: "", server: "" });
      expect(screen.getByLabelText("More controls")).toBeInTheDocument();
    });

    it("places the chevron as the right-most element of the cluster (no dot after it, 260724-6j1v)", () => {
      renderTopBar();
      const cluster = screen.getByTestId("top-bar-right");
      const chevron = screen.getByLabelText("More controls");
      // The trailing exempt block is the cluster's last child and holds ONLY
      // the chevron — the connection dot moved to the sidebar footer.
      expect(cluster.lastElementChild!.contains(chevron)).toBe(true);
      expect(cluster.querySelector('[role="status"]')).toBeNull();
    });

    it("carries menu-button a11y (aria-haspopup / aria-expanded) and toggles expanded on open", () => {
      renderTopBar();
      const chevron = screen.getByLabelText("More controls");
      expect(chevron).toHaveAttribute("aria-haspopup", "true");
      expect(chevron).toHaveAttribute("aria-expanded", "false");
      act(() => fireEvent.click(chevron));
      expect(chevron).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("menu", { name: "More controls" })).toBeInTheDocument();
    });

    it("opens a menu listing overflowed controls plus the always-present version row", () => {
      renderTopBar();
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      // Everything overflows in jsdom → the terminal-tier rows are present.
      expect(within(menu).getByText("Split vertical")).toBeInTheDocument();
      expect(within(menu).getByText("Split horizontal")).toBeInTheDocument();
      expect(within(menu).getByRole("menuitemcheckbox", { name: /Fixed width/ })).toBeInTheDocument();
      expect(within(menu).getByText("Refresh page")).toBeInTheDocument();
      // Theme / Help / Notifications rows are GONE (260724-6j1v — theme+help
      // moved to the sidebar footer, the bell folded into the settings dialog).
      expect(within(menu).queryByText(/Theme:/)).not.toBeInTheDocument();
      expect(within(menu).queryByText("Help / Documentation")).not.toBeInTheDocument();
      expect(within(menu).queryByText("Enable notifications")).not.toBeInTheDocument();
      // The fixed version row is always present (last).
      expect(within(menu).getByText("RunKit")).toBeInTheDocument();
    });

    it("closes on Escape and returns focus to the chevron", () => {
      renderTopBar();
      const chevron = screen.getByLabelText("More controls");
      act(() => fireEvent.click(chevron));
      expect(screen.getByRole("menu", { name: "More controls" })).toBeInTheDocument();
      act(() => fireEvent.keyDown(document, { key: "Escape" }));
      expect(screen.queryByRole("menu", { name: "More controls" })).not.toBeInTheDocument();
      expect(chevron).toHaveFocus();
    });

    it("runs a menu action (fixed-width toggle) from the menu", () => {
      // The theme row left the menu (260724-6j1v) — the fixed-width checkbox
      // row is the representative stateful menu action now.
      renderTopBar();
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      const row = within(menu).getByRole("menuitemcheckbox", { name: /Fixed width/ });
      expect(row).toHaveAttribute("aria-checked", "false");
      act(() => fireEvent.click(row));
      // The checkbox toggle closes the menu (role-keyed close); reopen to
      // observe the flipped state.
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu2 = screen.getByRole("menu", { name: "More controls" });
      expect(
        within(menu2).getByRole("menuitemcheckbox", { name: /Fixed width/ }),
      ).toHaveAttribute("aria-checked", "true");
    });

    it("Refresh page row reloads the page", () => {
      const originalLocation = window.location;
      const reloadMock = vi.fn();
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: { ...originalLocation, reload: reloadMock },
      });
      try {
        renderTopBar();
        act(() => fireEvent.click(screen.getByLabelText("More controls")));
        const menu = screen.getByRole("menu", { name: "More controls" });
        act(() => fireEvent.click(within(menu).getByText("Refresh page")));
        expect(reloadMock).toHaveBeenCalledTimes(1);
      } finally {
        Object.defineProperty(window, "location", {
          configurable: true,
          writable: true,
          value: originalLocation,
        });
      }
    });

    it("represents the menu-only ViewSwitcher as per-view `View:` menu rows on a multi-view window (260722-n2n4)", () => {
      const onSelectView = vi.fn();
      renderTopBar({ availableViews: ["tty", "web"], activeView: "tty", onSelectView });
      // The view-switcher entry is `menuOnly` (260722-n2n4): the pill renders
      // NOWHERE — not in the bar and, unlike the former overflow-candidate state
      // (260717-6anu), not even in the aria-hidden measurement probe. So there
      // is no `view-toggle` testid anywhere in the DOM and no group named
      // "Window view" in or out of the accessibility tree.
      expect(screen.queryByTestId("view-toggle")).not.toBeInTheDocument();
      expect(screen.queryAllByRole("group", { name: "Window view" })).toHaveLength(0);
      // …and the switcher is represented as one `View: {label}` row per view.
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      const ttyRow = within(menu).getByRole("menuitemradio", { name: "View: Terminal" });
      const webRow = within(menu).getByRole("menuitemradio", { name: "View: Web" });
      expect(ttyRow).toBeInTheDocument();
      expect(webRow).toBeInTheDocument();
      // The active (tty) row is marked; the inactive (web) row is not.
      expect(ttyRow).toHaveAttribute("aria-checked", "true");
      expect(webRow).toHaveAttribute("aria-checked", "false");
      // Clicking a non-active row switches the lens via the same onSelectView.
      act(() => fireEvent.click(webRow));
      expect(onSelectView).toHaveBeenCalledWith("web");
    });

    it("keeps the menuOnly view-switcher out of the measurement probe and leads the menu with its rows (260722-n2n4)", () => {
      renderTopBar({ availableViews: ["tty", "web"], activeView: "web", onSelectView: vi.fn() });
      // Probe exclusion: the probe renders only FIT candidates, index-aligned
      // with the widths array the fit reads — a menuOnly entry contributes no
      // probe child. The probe is the aria-hidden off-screen row inside the
      // right cluster; it must carry the other candidates' copies (e.g. the
      // splits) but no `view-toggle`.
      const cluster = screen.getByTestId("top-bar-right");
      const probe = cluster.querySelector('[aria-hidden="true"][inert]');
      expect(probe).not.toBeNull();
      expect(probe!.querySelector('[data-testid="view-toggle"]')).toBeNull();
      expect(probe!.querySelector('[aria-label="Split vertically"]')).not.toBeNull();
      // Registry order: the view-switcher is the FIRST registry entry, so its
      // `View:` rows lead the menu-row order (before the split rows that jsdom's
      // zero widths also overflow).
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      // querySelectorAll preserves DOM order across the mixed menuitem/
      // menuitemradio/menuitemcheckbox row roles (getAllByRole takes one role).
      const rows = Array.from(menu.querySelectorAll('[role^="menuitem"]'));
      const texts = rows.map((r) => r.textContent ?? "");
      const firstView = texts.findIndex((t) => t.startsWith("View:"));
      const firstSplit = texts.findIndex((t) => t.startsWith("Split"));
      expect(firstView).toBeGreaterThanOrEqual(0);
      expect(firstSplit).toBeGreaterThan(firstView);
      // The active (web) lens row is marked even though no pill exists.
      expect(within(menu).getByRole("menuitemradio", { name: "View: Web" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    it("contributes no `View:` menu row for a single-view (tty-only) window (260717-6anu)", () => {
      renderTopBar({ availableViews: ["tty"], activeView: "tty", onSelectView: vi.fn() });
      expect(screen.queryByTestId("view-toggle")).not.toBeInTheDocument();
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      expect(within(menu).queryByRole("menuitemradio", { name: /^View:/ })).not.toBeInTheDocument();
    });
  });

  describe("overflow menu version row (260715-h1ck)", () => {
    it("shows plain `RunKit` when the daemon version is unknown (no vundefined)", () => {
      renderTopBar(); // no SessionProvider → daemonVersion null
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      const versionRow = within(menu).getByText("RunKit");
      expect(versionRow).toBeInTheDocument();
      expect(within(menu).queryByText(/vundefined/)).not.toBeInTheDocument();
    });
  });
});

// Centered, highlighted, editable window heading (change 260703-5ilm).
describe("WindowHeading (centered, editable, terminal mode)", () => {
  beforeEach(() => {
    // Clear call history between tests (the renameWindow module mock persists
    // its calls across tests otherwise).
    vi.clearAllMocks();
    // Same query-sensitive stub as the suite root: all-match EXCEPT
    // `(pointer: coarse)` (false), or Tips would self-suppress.
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: query !== "(pointer: coarse)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
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
    renderTopBar({ mode: "server", currentWindow: null, windowName: "" });
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

  it("live-converts typed unsafe chars (space → underscore, hyphen kept)", async () => {
    const { renameWindow } = await import("@/api/client");
    renderTopBar();
    act(() => fireEvent.click(screen.getByRole("button", { name: "Rename window main" })));
    const input = screen.getByRole("textbox", { name: "Window name" }) as HTMLInputElement;
    // WYSIWYG (260722-ln4n): the input shows the safe form as the user types —
    // spaces convert to "_", hyphens are KEPT (window-kind rule).
    act(() => fireEvent.change(input, { target: { value: "riff-my problem" } }));
    expect(input.value).toBe("riff-my_problem");
    act(() => fireEvent.keyDown(input, { key: "Enter" }));
    await waitFor(() => {
      expect(renameWindow).toHaveBeenCalledWith("runkit", "@0", "riff-my_problem");
    });
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
