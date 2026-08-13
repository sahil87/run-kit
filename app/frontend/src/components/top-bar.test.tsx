import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor, within } from "@testing-library/react";
import { TopBar } from "./top-bar";
import { TopBarOverflowMenu } from "./top-bar-overflow-menu";
import { TIP_OPEN_DELAY_MS } from "@/components/tip";
import { ChromeProvider } from "@/contexts/chrome-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { SettingsDialogProvider, useSettingsDialog } from "@/contexts/settings-dialog-context";
import { ToastProvider } from "@/components/toast";
import type { ProjectSession, WindowInfo } from "@/types";
import { stubMatchMedia } from "@/test-utils/match-media";

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
        {/* SettingsDialogProvider: the top-bar Settings gear (260812-d1at)
            consumes useSettingsDialog(); the dialog itself is not mounted
            here. */}
        <SettingsDialogProvider>
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
        </SettingsDialogProvider>
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
    stubMatchMedia((query) => query !== "(pointer: coarse)");
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
      stubMatchMedia((query) => query.includes("prefers-color-scheme"));
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
    // The toggle carries the shared FIXED-size token (260731-oiho): 28px fine /
    // 30px coarse squares — fixed `w/h`, not the old `min-*` floors that let
    // rendered sizes drift with content.
    expect(hamburger.className).toContain("w-[28px]");
    expect(hamburger.className).toContain("h-[28px]");
    expect(hamburger.className).toContain("coarse:w-[30px]");
    expect(hamburger.className).toContain("coarse:h-[30px]");
    expect(hamburger.className).not.toContain("min-w-[24px]");
  });

  it("renders the history ◀ ▶ arrows in the LEFT cluster, between the hamburger and the breadcrumb nav (260731-oiho)", () => {
    // macOS convention: sidebar toggle → back → forward → brand crumb. The
    // arrows are OUTSIDE the anchored center heading box now.
    const { container } = renderTopBar();
    const hamburger = screen.getByLabelText("Toggle navigation");
    const back = screen.getByRole("button", { name: "Go back" });
    const nav = container.querySelector('nav[aria-label="Breadcrumb"]')!;
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    // Same left cluster as the hamburger; hamburger → arrows → nav order.
    expect(back.closest("div")).toBe(nav.parentElement);
    expect(follows(hamburger, back)).toBe(true);
    expect(follows(back, nav)).toBe(true);
    // No arrow inside the anchored center heading box (its `sm:min-w-[28ch]`
    // container carries only heading furniture now).
    const anchorBox = container.querySelector(".sm\\:min-w-\\[28ch\\]");
    expect(anchorBox).not.toBeNull();
    expect(anchorBox!.querySelector('[aria-label="Go back"]')).toBeNull();
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

  it("fixed-width is MENU-ONLY (260731-oiho): no in-bar/probe toggle, always a menu checkbox row in terminal mode", () => {
    renderTopBar();
    // The in-bar toggle renders NOWHERE — not the bar, not the measurement
    // probe (menuOnly excludes it from both, the n2n4 mechanism).
    expect(screen.queryByLabelText("Toggle fixed terminal width")).not.toBeInTheDocument();
    // Its checkbox row is ALWAYS in the chevron menu.
    act(() => fireEvent.click(screen.getByLabelText("More controls")));
    const menu = screen.getByRole("menu", { name: "More controls" });
    expect(within(menu).getByRole("menuitemcheckbox", { name: /Fixed width/ })).toBeInTheDocument();
  });

  it("does NOT render the fixed-width row outside terminal mode (server/board/host)", () => {
    // 260704-9o7k: fixed-width is terminal-only; the 900px wrapper + palette
    // action live in AppShell and are untouched.
    const noFixedWidthAnywhere = () => {
      expect(screen.queryByLabelText("Toggle fixed terminal width")).not.toBeInTheDocument();
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      expect(within(menu).queryByRole("menuitemcheckbox", { name: /Fixed width/ })).not.toBeInTheDocument();
    };
    renderTopBar({ mode: "server", currentWindow: null, windowName: "" });
    noFixedWidthAnywhere();
    cleanup();
    renderTopBar({ mode: "board", currentWindow: null, boardName: "b", paneCount: 1, serverCount: 1, boards: [{ name: "b" }] });
    noFixedWidthAnywhere();
    cleanup();
    renderTopBar({ mode: "host", sessions: [], currentSession: null, currentWindow: null, sessionName: "", windowName: "", server: "" });
    noFixedWidthAnywhere();
  });

  it("keeps the L3 pyramid order (Refresh → Gear → chevron, right-most) with the bell still gone from the bar (260812-d1at)", () => {
    // The right cluster is registry-driven (260715-h1ck). As of 260812-d1at the
    // L3 tier is UpdateChip (context-gated) + Refresh + the Settings gear
    // (relocated from the sidebar footer) — Help/Keyboard/Theme moved with it
    // but as menuOnly App-section menu rows, and the bell stays folded into the
    // settings dialog. The always-present overflow chevron terminates the
    // cluster (the trailing exempt block; the rail toggle — absent here —
    // would follow it). Order is asserted via document position (robust to
    // whether each control is currently in-bar or in the hidden measurement
    // probe).
    renderTopBar();
    const cluster = screen.getByTestId("top-bar-right");
    const refresh = screen.getByLabelText("Refresh page");
    const gear = screen.getByLabelText("Open settings");
    const chevron = screen.getByLabelText("More controls");
    // DOCUMENT_POSITION_FOLLOWING (4) means the arg comes AFTER the node.
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(refresh, gear)).toBe(true);
    expect(follows(gear, chevron)).toBe(true);
    // The chevron is the deepest-last element of the trailing exempt block.
    expect(cluster.lastElementChild!.contains(chevron)).toBe(true);
    // The gear is the standard chip idiom (rk-glint + fixed-size border token).
    expect(gear.className).toContain("rk-glint");
    expect(gear.className).toContain("w-[28px]");
    expect(gear.className).toContain("coarse:w-[30px]");
    // Theme/Help render NOWHERE in the bar or probe (menuOnly rows) — and the
    // bell is gone entirely. (The menu itself mounts only when open.)
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

  describe("terminal-font — MENU-ONLY stepper row (260731-oiho)", () => {
    // The in-bar Aa popover (TerminalFontControl) is demoted via `menuOnly`
    // (the n2n4 mechanism — the component stays intact but unreachable; the
    // reset + full stepper also live in the settings dialog and the palette's
    // Increase/Decrease/Reset actions). The chevron menu's stepper row
    // (TerminalFontMenuRow) is the top-bar surface now.
    const FONT_KEY = "runkit-terminal-font-size";

    afterEach(() => {
      localStorage.clear();
    });

    /** Open the chevron menu — the stepper row always renders there. */
    function openMenu() {
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      return screen.getByRole("menu", { name: "More controls" });
    }

    it("renders no in-bar Aa trigger anywhere (bar or probe); the stepper row is in the menu", () => {
      localStorage.setItem(FONT_KEY, "13");
      renderTopBar();
      // The Aa BUTTON renders nowhere — menuOnly excludes bar + probe.
      expect(screen.queryByRole("button", { name: "Terminal font size" })).not.toBeInTheDocument();
      const menu = openMenu();
      expect(within(menu).getByLabelText("Decrease terminal font")).toBeInTheDocument();
      expect(within(menu).getByLabelText("Increase terminal font")).toBeInTheDocument();
      expect(within(menu).getByLabelText("Terminal font size 13 pixels")).toHaveTextContent("13px");
    });

    it("steps and persists on increase / decrease — without closing the menu (plain buttons, no menuitem role)", () => {
      localStorage.setItem(FONT_KEY, "13");
      renderTopBar();
      const menu = openMenu();
      act(() => fireEvent.click(within(menu).getByLabelText("Increase terminal font")));
      expect(within(menu).getByLabelText("Terminal font size 14 pixels")).toBeInTheDocument();
      expect(localStorage.getItem(FONT_KEY)).toBe("14");
      act(() => fireEvent.click(within(menu).getByLabelText("Decrease terminal font")));
      expect(within(menu).getByLabelText("Terminal font size 13 pixels")).toBeInTheDocument();
      expect(localStorage.getItem(FONT_KEY)).toBe("13");
      // The menu stayed open across repeated steps (role-keyed close skips the
      // stepper's plain buttons).
      expect(screen.getByRole("menu", { name: "More controls" })).toBeInTheDocument();
    });

    it("disables the decrease button at the min bound (8)", () => {
      localStorage.setItem(FONT_KEY, "8");
      renderTopBar();
      const menu = openMenu();
      expect(within(menu).getByLabelText("Decrease terminal font")).toBeDisabled();
      expect(within(menu).getByLabelText("Increase terminal font")).not.toBeDisabled();
    });

    it("disables the increase button at the max bound (24)", () => {
      localStorage.setItem(FONT_KEY, "24");
      renderTopBar();
      const menu = openMenu();
      expect(within(menu).getByLabelText("Increase terminal font")).toBeDisabled();
      expect(within(menu).getByLabelText("Decrease terminal font")).not.toBeDisabled();
    });

    it("is shown in terminal mode (a terminal surface to size)", () => {
      renderTopBar({ mode: "terminal" });
      const menu = openMenu();
      expect(within(menu).getByLabelText("Increase terminal font")).toBeInTheDocument();
    });

    it("is shown in board mode (board panes are terminals)", () => {
      renderTopBar({ mode: "board", boardName: "b", paneCount: 1, serverCount: 1, boards: [{ name: "b" }] });
      const menu = openMenu();
      expect(within(menu).getByLabelText("Increase terminal font")).toBeInTheDocument();
    });

    it("is hidden in server mode (dashboard has no terminal)", () => {
      renderTopBar({ mode: "server", currentWindow: null });
      const menu = openMenu();
      expect(within(menu).queryByLabelText("Increase terminal font")).not.toBeInTheDocument();
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

  it("close-pane is MENU-ONLY (260731-oiho): no in-bar ✕, a Close pane menu row when a window is selected", () => {
    renderTopBar();
    // The ✕ BUTTON renders nowhere (menuOnly excludes bar + probe) — it was a
    // destructive control one slot from Refresh (misclick trap).
    expect(screen.queryByLabelText("Close pane")).not.toBeInTheDocument();
    act(() => fireEvent.click(screen.getByLabelText("More controls")));
    const menu = screen.getByRole("menu", { name: "More controls" });
    expect(within(menu).getByRole("menuitem", { name: "Close pane" })).toBeInTheDocument();
  });

  it("does not render the Close pane row on dashboard (no window)", () => {
    renderTopBar({ currentWindow: null, windowName: "" });
    act(() => fireEvent.click(screen.getByLabelText("More controls")));
    const menu = screen.getByRole("menu", { name: "More controls" });
    expect(within(menu).queryByRole("menuitem", { name: "Close pane" })).not.toBeInTheDocument();
  });

  it("calls closePane API when the Close pane menu row is clicked", async () => {
    const { closePane } = await import("@/api/client");
    renderTopBar();
    act(() => fireEvent.click(screen.getByLabelText("More controls")));
    const menu = screen.getByRole("menu", { name: "More controls" });
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Close pane" }));
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

    /** Open the chevron menu — the Kill/Close rows live there (menuOnly). */
    function openMenu() {
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      return screen.getByRole("menu", { name: "More controls" });
    }

    it("the menu row reads 'Kill' and calls onRequestKill (NOT closePane) — the board Kill is consequence-gated", async () => {
      const { closePane } = await import("@/api/client");
      vi.mocked(closePane).mockClear();
      const onRequestKill = vi.fn();
      renderBoard({ onRequestKill });
      // menuOnly (260731-oiho): no in-bar ✕ at all; and the row reads "Kill"
      // (verb discipline) — no old "Close pane"/"Unpin pane from board".
      expect(screen.queryByLabelText("Kill")).not.toBeInTheDocument();
      const menu = openMenu();
      expect(within(menu).queryByRole("menuitem", { name: "Close pane" })).not.toBeInTheDocument();
      expect(within(menu).queryByRole("menuitem", { name: "Unpin pane from board" })).not.toBeInTheDocument();
      const kill = within(menu).getByRole("menuitem", { name: "Kill" });
      await act(async () => {
        fireEvent.click(kill);
      });
      // Routes to the confirm dialog opener, does NOT fire an immediate close-pane.
      expect(onRequestKill).toHaveBeenCalledTimes(1);
      expect(closePane).not.toHaveBeenCalled();
    });

    it("disables the Kill row when there is no focused tile (empty board)", async () => {
      const onRequestKill = vi.fn();
      renderBoard({ focusedPane: null, paneCount: 0, onRequestKill });
      const menu = openMenu();
      const kill = within(menu).getByRole("menuitem", { name: "Kill" });
      expect(kill).toBeDisabled();
      await act(async () => {
        fireEvent.click(kill);
      });
      expect(onRequestKill).not.toHaveBeenCalled();
    });

    it("renders the merged split control on board mode, wired to the focused tile", async () => {
      const { splitWindow } = await import("@/api/client");
      renderBoard();
      // ONE merged control (260731-oiho): primary = split horizontal; the ▾
      // opens the direction menu carrying the vertical action.
      const hsplit = screen.getByLabelText("Split horizontally");
      expect(hsplit).toBeInTheDocument();
      expect(screen.queryByLabelText("Split vertically")).not.toBeInTheDocument();
      await act(async () => {
        fireEvent.click(hsplit);
      });
      expect(splitWindow).toHaveBeenCalledWith("runkit", "@7", true, "~/code/x");
      // ▾ → Split vertical fires the vertical split on the same target.
      // (Attribute query: jsdom keeps the control in the aria-hidden probe.)
      act(() => fireEvent.click(screen.getByLabelText("Split… (choose direction)")));
      const dirMenu = document.querySelector<HTMLElement>('[role="menu"][aria-label="Split direction"]');
      await act(async () => {
        fireEvent.click(within(dirMenu!).getByText("Split vertical"));
      });
      expect(splitWindow).toHaveBeenCalledWith("runkit", "@7", false, "~/code/x");
    });

    it("renders no split control on an empty board (no focused tile)", () => {
      renderBoard({ focusedPane: null, paneCount: 0 });
      expect(screen.queryByLabelText("Split horizontally")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Split… (choose direction)")).not.toBeInTheDocument();
    });

    it("does NOT render the fixed-width row on board mode (terminal-only)", () => {
      renderBoard();
      expect(screen.queryByLabelText("Toggle fixed terminal width")).not.toBeInTheDocument();
      const menu = openMenu();
      expect(within(menu).queryByRole("menuitemcheckbox", { name: /Fixed width/ })).not.toBeInTheDocument();
    });

    it("terminal-mode Close pane row still calls closePane with the current window", async () => {
      const { closePane } = await import("@/api/client");
      renderTopBar(); // terminal mode default
      const menu = openMenu();
      await act(async () => {
        fireEvent.click(within(menu).getByRole("menuitem", { name: "Close pane" }));
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

  describe("merged SplitControl (260731-oiho; terminal menuOnly 260813-w1lf)", () => {
    /** The direction menu by attribute — jsdom keeps the control inside the
     *  aria-hidden probe, which `getByRole` excludes. */
    const splitDirectionMenu = () =>
      document.querySelector<HTMLElement>('[role="menu"][aria-label="Split direction"]');

    /** The SplitControl's IN-BAR form survives on board mode only — terminal
     *  demoted the `split` entry to `menuOnly` (260813-w1lf: pane verbs moved
     *  to the tty tile header's pane segment). The behavior tests below render
     *  the board surface; the terminal-side contract is the first test. */
    function renderBoardSplit(overrides: Partial<React.ComponentProps<typeof TopBar>> = {}) {
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

    it("terminal mode renders NO in-bar split control (menuOnly); the chevron menu carries both direction rows (260813-w1lf)", () => {
      renderTopBar();
      // Not in the bar, and not in the hidden measurement probe either — a
      // menuOnly entry contributes zero width to the fit budget.
      expect(screen.queryByLabelText("Split horizontally")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Split… (choose direction)")).not.toBeInTheDocument();
      expect(document.querySelector('[data-icon="split-horizontal"]')).toBeNull();
      // The menu rows always render (mobile path + muscle-memory fallback).
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      expect(within(menu).getByRole("menuitem", { name: "Split horizontal" })).toBeInTheDocument();
      expect(within(menu).getByRole("menuitem", { name: "Split vertical" })).toBeInTheDocument();
    });

    it("renders ONE split control on board mode: primary = horizontal, ▾ = direction menu", () => {
      renderBoardSplit();
      // Primary segment + ▾ segment; no second per-direction button.
      expect(screen.getByLabelText("Split horizontally")).toBeInTheDocument();
      expect(screen.getByLabelText("Split… (choose direction)")).toBeInTheDocument();
      expect(screen.queryByLabelText("Split vertically")).not.toBeInTheDocument();
      // The ▾ carries menu-trigger a11y and opens the direction menu with BOTH
      // actions (the complete option set, split-button convention).
      const chevron = screen.getByLabelText("Split… (choose direction)");
      expect(chevron).toHaveAttribute("aria-haspopup", "menu");
      expect(chevron).toHaveAttribute("aria-expanded", "false");
      act(() => fireEvent.click(chevron));
      expect(chevron).toHaveAttribute("aria-expanded", "true");
      // jsdom renders the control only in the aria-hidden measurement probe
      // (zero widths → nothing in-bar), which role queries exclude — locate
      // the direction menu by attribute instead.
      const menu = splitDirectionMenu();
      expect(menu).not.toBeNull();
      // Horizontal first (the default), then vertical (260806-2x2h).
      // querySelectorAll — jsdom keeps the control in the aria-hidden probe,
      // which role queries exclude (the existing direction-menu test pattern).
      const rows = Array.from(menu!.querySelectorAll('[role="menuitem"]'));
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent("Split horizontal");
      expect(rows[1]).toHaveTextContent("Split vertical");
    });

    it("does not render the split control on dashboard (no window)", () => {
      renderTopBar({ currentWindow: null, windowName: "" });
      expect(screen.queryByLabelText("Split horizontally")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Split… (choose direction)")).not.toBeInTheDocument();
    });

    it("primary click fires a HORIZONTAL split with the focused tile's coordinates (board)", async () => {
      const { splitWindow } = await import("@/api/client");
      renderBoardSplit();
      await act(async () => {
        fireEvent.click(screen.getByLabelText("Split horizontally"));
      });
      expect(splitWindow).toHaveBeenCalledWith("runkit", "@7", true, "~/code/x");
    });

    it("▾ → Split vertical fires a VERTICAL split and closes the direction menu (board)", async () => {
      const { splitWindow } = await import("@/api/client");
      renderBoardSplit();
      act(() => fireEvent.click(screen.getByLabelText("Split… (choose direction)")));
      await act(async () => {
        fireEvent.click(within(splitDirectionMenu()!).getByText("Split vertical"));
      });
      expect(splitWindow).toHaveBeenCalledWith("runkit", "@7", false, "~/code/x");
      expect(splitDirectionMenu()).toBeNull();
    });

    it("Escape closes the direction menu and refocuses the ▾ (board)", () => {
      renderBoardSplit();
      const chevron = screen.getByLabelText("Split… (choose direction)");
      act(() => fireEvent.click(chevron));
      expect(splitDirectionMenu()).not.toBeNull();
      act(() => fireEvent.keyDown(document, { key: "Escape" }));
      expect(splitDirectionMenu()).toBeNull();
      expect(chevron).toHaveFocus();
    });

    it("the chevron menu carries BOTH split actions as one-action rows", () => {
      renderTopBar();
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      expect(within(menu).getByRole("menuitem", { name: "Split vertical" })).toBeInTheDocument();
      expect(within(menu).getByRole("menuitem", { name: "Split horizontal" })).toBeInTheDocument();
    });

    describe("keycaps (260811-0f3d)", () => {
      afterEach(() => {
        localStorage.clear();
      });

      it("the primary segment's tip carries the registry-resolved split-horizontal keycap (board)", () => {
        vi.useFakeTimers();
        try {
          renderBoardSplit();
          const primary = screen.getByLabelText("Split horizontally");
          act(() => {
            fireEvent.mouseEnter(primary);
            vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
          });
          // jsdom's platform is "other", so the chord renders in the Ctrl
          // spelling.
          const tooltip = screen.getByRole("tooltip");
          expect(tooltip).toHaveTextContent("Split horizontally");
          expect(tooltip!.querySelector("kbd")).toHaveTextContent("Shift+Ctrl+\\");
        } finally {
          vi.useRealTimers();
        }
      });

      it("direction-menu rows carry right-aligned keycaps with their per-direction chords (board)", () => {
        renderBoardSplit();
        act(() => fireEvent.click(screen.getByLabelText("Split… (choose direction)")));
        const rows = Array.from(splitDirectionMenu()!.querySelectorAll('[role="menuitem"]'));
        for (const [row, chord] of [[rows[0], "Shift+Ctrl+\\"], [rows[1], "Shift+Ctrl+-"]] as const) {
          const kbd = row.querySelector("kbd");
          expect(kbd).toHaveTextContent(chord);
          expect(kbd!.className).toContain("ml-auto");
          // Visual education only — the chord stays out of the accessible name.
          expect(kbd).toHaveAttribute("aria-hidden", "true");
        }
      });

      it("omits a row's keycap when its binding is disabled — a dead chord would lie (board)", () => {
        localStorage.setItem("runkit-keybindings", JSON.stringify({ "split-vertical": null }));
        renderBoardSplit();
        act(() => fireEvent.click(screen.getByLabelText("Split… (choose direction)")));
        const rows = Array.from(splitDirectionMenu()!.querySelectorAll('[role="menuitem"]'));
        expect(rows[0].querySelector("kbd")).toHaveTextContent("Shift+Ctrl+\\");
        expect(rows[1].querySelector("kbd")).toBeNull();
      });

      it("the overflow menu's split rows carry the same keycap treatment", () => {
        renderTopBar();
        act(() => fireEvent.click(screen.getByLabelText("More controls")));
        const menu = screen.getByRole("menu", { name: "More controls" });
        const hRow = within(menu).getByRole("menuitem", { name: "Split horizontal" });
        const vRow = within(menu).getByRole("menuitem", { name: "Split vertical" });
        expect(hRow.querySelector("kbd")).toHaveTextContent("Shift+Ctrl+\\");
        expect(vRow.querySelector("kbd")).toHaveTextContent("Shift+Ctrl+-");
        // Rows with no matching registry binding stay keycap-free.
        const closeRow = within(menu).getByRole("menuitem", { name: "Close pane" });
        expect(closeRow.querySelector("kbd")).toBeNull();
      });
    });

    it("shows spinner and disables the primary segment while pending (board)", async () => {
      const { splitWindow } = await import("@/api/client");
      let resolveAction!: () => void;
      vi.mocked(splitWindow).mockImplementation(() => new Promise((r) => { resolveAction = () => r({ ok: true, pane_id: "%1" }); }));

      renderBoardSplit();
      const btn = screen.getByLabelText("Split horizontally");
      await act(async () => {
        fireEvent.click(btn);
        await Promise.resolve();
      });

      // Both segments disable and the primary shows the spinner.
      expect(btn).toBeDisabled();
      expect(screen.getByLabelText("Split… (choose direction)")).toBeDisabled();
      expect(btn.querySelector("svg[viewBox='7 10 50 44']")).toBeTruthy();

      // Resolve the action
      await act(async () => {
        resolveAction();
      });
      expect(btn).not.toBeDisabled();
      expect(btn.querySelector("svg[viewBox='7 10 50 44']")).toBeFalsy();
    });
  });

  // (The old "ClosePaneButton spinner while pending" test retired with the ✕'s
  // menuOnly demotion: the menu row unmounts on the role-keyed close, so its
  // per-instance pending state is not observable across a reopen. The pending
  // discipline is covered by the SplitControl pending test above — the same
  // useOptimisticAction pattern.)

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
      // The merged split entry emits horizontal FIRST (the default,
      // 260806-2x2h), then vertical.
      const hRow = within(menu).getByText("Split horizontal");
      const vRow = within(menu).getByText("Split vertical");
      expect(
        Boolean(hRow.compareDocumentPosition(vRow) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).toBe(true);
      expect(within(menu).getByRole("menuitemcheckbox", { name: /Fixed width/ })).toBeInTheDocument();
      expect(within(menu).getByText("Refresh page")).toBeInTheDocument();
      // The App section's relocated chrome rows (260812-d1at): Settings (the
      // gear's overflow fallback — everything overflows in jsdom), Help,
      // Keyboard shortcuts, Theme…. Notifications stay GONE (folded into the
      // settings dialog, 260724-6j1v).
      expect(within(menu).getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
      expect(within(menu).getByRole("menuitem", { name: /Help — run-kit docs/ })).toBeInTheDocument();
      expect(within(menu).getByRole("menuitem", { name: /Keyboard shortcuts/ })).toBeInTheDocument();
      expect(within(menu).getByRole("menuitem", { name: /Theme…/ })).toBeInTheDocument();
      expect(within(menu).queryByText("Enable notifications")).not.toBeInTheDocument();
      // The fixed version row is always present (last).
      expect(within(menu).getByText("RunKit")).toBeInTheDocument();
    });

    it("groups menu rows under View / Window / App uppercase section labels (260731-oiho)", () => {
      renderTopBar();
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      // The three section labels render (aria-hidden decoration — uppercase via
      // CSS, so the text content is the plain word).
      const viewLabel = within(menu).getByText("View", { exact: true });
      const windowLabel = within(menu).getByText("Window", { exact: true });
      const appLabel = within(menu).getByText("App", { exact: true });
      expect(viewLabel).toHaveAttribute("aria-hidden", "true");
      // Membership + fixed section order: a known View row (Fixed width) sits
      // between the View and Window labels; a Window row (Split vertical)
      // between Window and App; the App section carries Refresh + the relocated
      // chrome rows (260812-d1at: Settings · Help · Keyboard · Theme…) + the
      // version row.
      const follows = (a: Element, b: Element) =>
        Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      const fixedWidthRow = within(menu).getByRole("menuitemcheckbox", { name: /Fixed width/ });
      const splitRow = within(menu).getByRole("menuitem", { name: "Split vertical" });
      const refreshRow = within(menu).getByRole("menuitem", { name: "Refresh page" });
      const settingsRow = within(menu).getByRole("menuitem", { name: "Settings" });
      const helpRow = within(menu).getByRole("menuitem", { name: /Help — run-kit docs/ });
      const keyboardRow = within(menu).getByRole("menuitem", { name: /Keyboard shortcuts/ });
      const themeRow = within(menu).getByRole("menuitem", { name: /Theme…/ });
      expect(follows(viewLabel, fixedWidthRow)).toBe(true);
      expect(follows(fixedWidthRow, windowLabel)).toBe(true);
      expect(follows(windowLabel, splitRow)).toBe(true);
      expect(follows(splitRow, appLabel)).toBe(true);
      expect(follows(appLabel, refreshRow)).toBe(true);
      expect(follows(refreshRow, settingsRow)).toBe(true);
      expect(follows(settingsRow, helpRow)).toBe(true);
      expect(follows(helpRow, keyboardRow)).toBe(true);
      expect(follows(keyboardRow, themeRow)).toBe(true);
      // The fixed version row rides the App section's tail.
      expect(follows(themeRow, within(menu).getByText("RunKit"))).toBe(true);
    });

    it("renders NO section labels when the menu holds only the version row", () => {
      // Direct render with zero rows — the server/host wide-width shape (in
      // jsdom the full TopBar always overflows at least Refresh, so the
      // version-row-only state is only reachable component-level).
      render(
        <ToastProvider>
          <ThemeProvider>
            <ChromeProvider>
              <TopBarOverflowMenu rows={[]} updateOverflowed={false} />
            </ChromeProvider>
          </ThemeProvider>
        </ToastProvider>,
      );
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      expect(within(menu).getByText("RunKit")).toBeInTheDocument();
      expect(within(menu).queryByText("View", { exact: true })).not.toBeInTheDocument();
      expect(within(menu).queryByText("Window", { exact: true })).not.toBeInTheDocument();
      expect(within(menu).queryByText("App", { exact: true })).not.toBeInTheDocument();
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

    it("renders no `View:` lens rows and no `view-toggle` anywhere; the VIEW section still carries Fixed width + Terminal font (260812-0c6o)", () => {
      // The view-switcher registry entry is retired: lens switching is the
      // palette's job (plus the rail's open-tile toggles). No `view-toggle`
      // testid exists anywhere in the DOM (bar, menu, or probe).
      renderTopBar();
      expect(screen.queryByTestId("view-toggle")).not.toBeInTheDocument();
      expect(screen.queryAllByRole("group", { name: "Window view" })).toHaveLength(0);
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      expect(within(menu).queryByRole("menuitemradio", { name: /^View:/ })).not.toBeInTheDocument();
      // The VIEW section survives via the sticky device-preference rows.
      const viewLabel = within(menu).getByText("View", { exact: true });
      const fixedWidthRow = within(menu).getByRole("menuitemcheckbox", { name: /Fixed width/ });
      const terminalFontRow = within(menu).getByRole("group", { name: /Terminal font/ });
      expect(
        Boolean(viewLabel.compareDocumentPosition(fixedWidthRow) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).toBe(true);
      expect(
        Boolean(viewLabel.compareDocumentPosition(terminalFontRow) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).toBe(true);
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

  describe("menu-row leading icons (260801-3q1z)", () => {
    /** Open the chevron menu and return its panel. */
    function openMenu() {
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      return screen.getByRole("menu", { name: "More controls" });
    }

    it("every terminal-mode menu row leads with its data-icon glyph, and row accessible names are unchanged", () => {
      renderTopBar();
      const menu = openMenu();
      // Role+name queries double as the aria-hidden proof: the glyphs must not
      // enter the rows' accessible names.
      expect(
        within(menu)
          .getByRole("menuitem", { name: "Split vertical" })
          .querySelector('[data-icon="split-vertical"]'),
      ).not.toBeNull();
      expect(
        within(menu)
          .getByRole("menuitem", { name: "Split horizontal" })
          .querySelector('[data-icon="split-horizontal"]'),
      ).not.toBeNull();
      expect(
        within(menu)
          .getByRole("menuitem", { name: "Close pane" })
          .querySelector('[data-icon="close-pane"]'),
      ).not.toBeNull();
      expect(
        within(menu)
          .getByRole("menuitem", { name: "Refresh page" })
          .querySelector('[data-icon="refresh"]'),
      ).not.toBeNull();
      expect(
        within(menu)
          .getByRole("menuitemcheckbox", { name: /Fixed width/ })
          .querySelector('[data-icon="fixed-width"]'),
      ).not.toBeNull();
      // The terminal-font glyph is the "Aa" TEXT span (assumption #6), not an SVG.
      const fontGlyph = within(menu)
        .getByRole("group", { name: "Terminal font size" })
        .querySelector('[data-icon="terminal-font"]');
      expect(fontGlyph).not.toBeNull();
      expect(fontGlyph!.tagName).toBe("SPAN");
      expect(fontGlyph).toHaveTextContent("Aa");
      expect(fontGlyph).toHaveAttribute("aria-hidden", "true");
    });

    it("SplitControl popover rows lead with direction glyphs; the primary segment shares the split-horizontal definition", () => {
      // Board mode — the SplitControl's only surviving in-bar surface
      // (terminal demoted the split entry to menuOnly in 260813-w1lf).
      renderTopBar({
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
      });
      // In-bar primary segment renders the SAME shared glyph (one definition).
      expect(
        screen.getByLabelText("Split horizontally").querySelector('[data-icon="split-horizontal"]'),
      ).not.toBeNull();
      act(() => fireEvent.click(screen.getByLabelText("Split… (choose direction)")));
      const dirMenu = document.querySelector<HTMLElement>(
        '[role="menu"][aria-label="Split direction"]',
      );
      expect(dirMenu).not.toBeNull();
      // Text queries: jsdom keeps the control in the aria-hidden probe, which
      // role queries exclude (the existing direction-menu test pattern).
      const vRow = within(dirMenu!).getByText("Split vertical");
      const hRow = within(dirMenu!).getByText("Split horizontal");
      expect(vRow.querySelector('[data-icon="split-vertical"]')).not.toBeNull();
      expect(hRow.querySelector('[data-icon="split-horizontal"]')).not.toBeNull();
    });

    it("in-bar Refresh renders the shared refresh glyph (probe copy carries data-icon)", () => {
      renderTopBar();
      const cluster = screen.getByTestId("top-bar-right");
      const probe = cluster.querySelector('[aria-hidden="true"][inert]');
      expect(probe).not.toBeNull();
      expect(probe!.querySelector('[data-icon="refresh"]')).not.toBeNull();
      // menuOnly entries are excluded from the probe (zero fit-budget width) —
      // terminal mode's split chip joined that set in 260813-w1lf.
      expect(probe!.querySelector('[data-icon="split-horizontal"]')).toBeNull();
    });

    it("Fixed width row keeps a STATIC identity glyph across toggle states — the trailing ✓ is the sole state marker (R5)", () => {
      // ChromeContext persists fixedWidth to localStorage; an earlier menu-action
      // test leaves it ON. Clear so this test starts from the known OFF default.
      window.localStorage.clear();
      renderTopBar();
      const menu = openMenu();
      const row = within(menu).getByRole("menuitemcheckbox", { name: /Fixed width/ });
      expect(row).toHaveAttribute("aria-checked", "false");
      const offMarkup = row.querySelector('[data-icon="fixed-width"]')!.innerHTML;
      expect(within(row).queryByText("✓")).not.toBeInTheDocument();
      // Toggle ON (the checkbox click closes the menu; reopen to observe).
      act(() => fireEvent.click(row));
      const menu2 = openMenu();
      const row2 = within(menu2).getByRole("menuitemcheckbox", { name: /Fixed width/ });
      expect(row2).toHaveAttribute("aria-checked", "true");
      // Leading glyph identical in both states (static identity, never flips)…
      expect(row2.querySelector('[data-icon="fixed-width"]')!.innerHTML).toBe(offMarkup);
      // …while the state moved to the trailing ✓.
      expect(within(row2).getByText("✓")).toBeInTheDocument();
    });

    it("board rows: Autofit panes leads with the UNFILLED identity glyph even when autofit is ON; Kill leads with the close glyph", () => {
      renderTopBar({
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
        autofit: true,
        onToggleAutofit: vi.fn(),
      });
      const menu = openMenu();
      const autofitRow = within(menu).getByRole("menuitemcheckbox", { name: /Autofit panes/ });
      const glyph = autofitRow.querySelector('[data-icon="autofit"]');
      expect(glyph).not.toBeNull();
      // Static identity: the menu glyph never shows the in-bar filled-panes
      // ON variant — state is the trailing ✓ alone.
      expect(glyph!.querySelector('rect[fill="currentColor"]')).toBeNull();
      expect(within(autofitRow).getByText("✓")).toBeInTheDocument();
      expect(
        within(menu).getByRole("menuitem", { name: "Kill" }).querySelector('[data-icon="close-pane"]'),
      ).not.toBeNull();
    });
  });

  describe("safe-area top padding gated on isShell() (260805-9hn1)", () => {
    // isShell() is driven through its REAL seam — window.runkitShell injection/
    // deletion (the shell.test.ts pattern) — not vi.mock, so the structural
    // narrowing in @/lib/shell is exercised too.
    afterEach(() => {
      delete window.runkitShell;
    });

    it("keeps pt-[env(safe-area-inset-top)] on the header in browsers/PWA (bridge absent)", () => {
      renderTopBar();
      expect(screen.getByRole("banner").className).toContain("pt-[env(safe-area-inset-top)]");
    });

    it("drops pt-[env(safe-area-inset-top)] inside the desktop shell (the titlebar strip already reserves the band)", () => {
      window.runkitShell = { version: "1.2.3", platform: "darwin" };
      renderTopBar();
      expect(screen.getByRole("banner").className).not.toContain("pt-[env(safe-area-inset-top)]");
    });
  });

  describe("right-rail toggle (260812-nm4p)", () => {
    it("renders no rail toggle when onToggleRail is absent (board/host/unregistered)", () => {
      renderTopBar();
      expect(screen.queryByLabelText("Toggle panel")).toBeNull();
    });

    it("renders the toggle as the outermost right element (after the overflow chevron) and clicking calls it", () => {
      const onToggleRail = vi.fn();
      renderTopBar({ onToggleRail, railOpen: true });
      const toggle = screen.getByLabelText("Toggle panel");
      // The toggle lives in the trailing exempt block, AFTER the chevron menu.
      const cluster = screen.getByTestId("top-bar-right");
      const buttons = Array.from(cluster.querySelectorAll(":scope > div:last-child > *"));
      expect(buttons[buttons.length - 1]).toBe(toggle);
      fireEvent.click(toggle);
      expect(onToggleRail).toHaveBeenCalledTimes(1);
    });

    it("mirrors the sidebar pictogram: right-column fill tracks the derived visibility flag", () => {
      const { unmount } = renderTopBar({ onToggleRail: vi.fn(), railOpen: true });
      const openFill = screen
        .getByLabelText("Toggle panel")
        .querySelector('rect[fill="currentColor"]');
      expect(openFill).not.toBeNull();
      // Mirrored geometry: the fill column + divider sit at the RIGHT edge
      // (x=11.5), not the sidebar toggle's left column (x=2.5 / 6.5).
      expect(openFill!.getAttribute("x")).toBe("11.5");
      expect(openFill!.getAttribute("fill-opacity")).toBe("0.5");
      const divider = screen.getByLabelText("Toggle panel").querySelector("line");
      expect(divider!.getAttribute("x1")).toBe("11.5");
      unmount();
      renderTopBar({ onToggleRail: vi.fn(), railOpen: false });
      const closedFill = screen
        .getByLabelText("Toggle panel")
        .querySelector('rect[fill="currentColor"]');
      expect(closedFill!.getAttribute("fill-opacity")).toBe("0");
    });
  });

  describe("settings gear + App-section chrome rows (260812-d1at)", () => {
    /** Probe rendering the layout-level settings-dialog state, so a gear/menu
     *  click has an observable effect without mounting the dialog itself. */
    function SettingsState() {
      const { isOpen } = useSettingsDialog();
      return <span data-testid="settings-open-state">{isOpen ? "open" : "closed"}</span>;
    }

    function renderTopBarWithSettingsProbe(
      overrides: Partial<React.ComponentProps<typeof TopBar>> = {},
    ) {
      return render(
        <ToastProvider>
          <ThemeProvider>
            <SettingsDialogProvider>
              <ChromeProvider>
                <SettingsState />
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
            </SettingsDialogProvider>
          </ThemeProvider>
        </ToastProvider>,
      );
    }

    it("renders the Settings gear on ALL four modes (app-global chrome)", () => {
      // jsdom's zero widths overflow everything, so the gear's only copy is in
      // the (aria-hidden) measurement probe — getByLabelText still resolves it.
      renderTopBar();
      expect(screen.getByLabelText("Open settings")).toBeInTheDocument();
      cleanup();
      renderTopBar({ mode: "server", currentWindow: null, windowName: "" });
      expect(screen.getByLabelText("Open settings")).toBeInTheDocument();
      cleanup();
      renderTopBar({ mode: "board", currentWindow: null, boardName: "b", paneCount: 1, serverCount: 1, boards: [{ name: "b" }] });
      expect(screen.getByLabelText("Open settings")).toBeInTheDocument();
      cleanup();
      renderTopBar({ mode: "host", sessions: [], currentSession: null, currentWindow: null, sessionName: "", windowName: "", server: "" });
      expect(screen.getByLabelText("Open settings")).toBeInTheDocument();
    });

    it("clicking the gear opens the settings dialog via useSettingsDialog()", () => {
      renderTopBarWithSettingsProbe();
      expect(screen.getByTestId("settings-open-state")).toHaveTextContent("closed");
      fireEvent.click(screen.getByLabelText("Open settings"));
      expect(screen.getByTestId("settings-open-state")).toHaveTextContent("open");
    });

    it("the gear tip carries the registry-resolved settings-open keycap", () => {
      vi.useFakeTimers();
      try {
        renderTopBar();
        const gear = screen.getByLabelText("Open settings");
        expect(gear).not.toHaveAttribute("title");
        act(() => {
          fireEvent.mouseEnter(gear);
          vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
        });
        const tooltip = screen.getByRole("tooltip");
        expect(tooltip).toHaveTextContent("Settings");
        // jsdom's platform is "other" → the Shift+Ctrl spelling of the
        // `settings-open` browser default (Comma).
        expect(tooltip.querySelector("kbd")).toHaveTextContent("Shift+Ctrl+,");
      } finally {
        vi.useRealTimers();
      }
    });

    it("the Help App-section row is a safe external link to the shared HELP_URL", () => {
      renderTopBar();
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      const help = within(menu).getByRole("menuitem", { name: /Help — run-kit docs/ });
      expect(help.tagName).toBe("A");
      expect(help).toHaveAttribute("href", "https://shll.ai/run-kit");
      expect(help).toHaveAttribute("target", "_blank");
      const rel = help.getAttribute("rel") ?? "";
      expect(rel).toContain("noopener");
      expect(rel).toContain("noreferrer");
    });

    it("the Keyboard shortcuts row dispatches shortcuts-overlay:open and carries the effective chord", () => {
      renderTopBar();
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      const row = within(menu).getByRole("menuitem", { name: "Keyboard shortcuts" });
      // The trailing keycap is aria-hidden (visual education, not part of the
      // name) and shows the host-effective chord (jsdom platform "other").
      expect(row.querySelector("kbd")).toHaveTextContent("Shift+Ctrl+/");
      const openListener = vi.fn();
      document.addEventListener("shortcuts-overlay:open", openListener);
      try {
        act(() => fireEvent.click(row));
        expect(openListener).toHaveBeenCalledTimes(1);
      } finally {
        document.removeEventListener("shortcuts-overlay:open", openListener);
      }
    });

    it("the Theme… row opens the theme selector (click-cycling retired) and shows the effective mode", () => {
      renderTopBar();
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      // Default preference is "system" (the stub matches dark scheme), so the
      // trailing slot reads "system".
      const row = within(menu).getByRole("menuitem", { name: /Theme…/ });
      expect(row).toHaveTextContent("system");
      const openListener = vi.fn();
      document.addEventListener("theme-selector:open", openListener);
      try {
        act(() => fireEvent.click(row));
        expect(openListener).toHaveBeenCalledTimes(1);
      } finally {
        document.removeEventListener("theme-selector:open", openListener);
      }
    });

    it("the Settings menu row (the gear's overflow fallback) also opens the dialog", () => {
      renderTopBarWithSettingsProbe();
      act(() => fireEvent.click(screen.getByLabelText("More controls")));
      const menu = screen.getByRole("menu", { name: "More controls" });
      act(() => fireEvent.click(within(menu).getByRole("menuitem", { name: "Settings" })));
      expect(screen.getByTestId("settings-open-state")).toHaveTextContent("open");
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
    stubMatchMedia((query) => query !== "(pointer: coarse)");
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

/**
 * ▦ Layout chip (260812-ab5v-surface-layout-core R9) — the terminal-route L1
 * registry entry fed by AppShell's `layout`/`onApplyLayout` slot props. In
 * jsdom the fit candidates render only in the aria-hidden measurement probe
 * (zero widths → everything overflows), so the chip button is located by
 * `getByLabelText("Layout")` and its popover by attribute — the established
 * SplitControl direction-menu test pattern.
 */
describe("TopBar layout chip (260812-ab5v R9)", () => {
  beforeEach(() => {
    stubMatchMedia((query) => query !== "(pointer: coarse)");
  });

  afterEach(() => {
    cleanup();
  });

  const splitLayout = { shape: "split-h", order: ["tty", "code"] } as const;
  const mainLeftLayout = { shape: "main-left", order: ["tty", "code", "web"] } as const;

  /** The chip's shape popover — by attribute (jsdom keeps the control inside
   *  the aria-hidden probe, which role queries exclude). */
  const layoutMenu = () =>
    document.querySelector<HTMLElement>('[role="menu"][aria-label="Layout presets"]');

  it("renders the chip on a terminal window route when layout props register; hidden without them", () => {
    renderTopBar({ layout: { ...splitLayout, order: [...splitLayout.order] }, onApplyLayout: vi.fn() });
    expect(screen.getByLabelText("Layout")).toBeInTheDocument();
    expect(screen.getByLabelText("Layout")).toHaveAttribute("data-testid", "layout-chip");

    cleanup();
    renderTopBar();
    expect(screen.queryByLabelText("Layout")).not.toBeInTheDocument();
  });

  it("popover lists exactly the CURRENT arity's presets, current shape marked", () => {
    renderTopBar({ layout: { ...splitLayout, order: [...splitLayout.order] }, onApplyLayout: vi.fn() });
    act(() => fireEvent.click(screen.getByLabelText("Layout")));
    const menu = layoutMenu();
    expect(menu).not.toBeNull();
    const rows = Array.from(menu!.querySelectorAll("[data-testid^='layout-shape-']"));
    // Arity 2 → the two splits only (never single / the 3-tile presets).
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "layout-shape-split-h",
      "layout-shape-split-v",
    ]);
    // Current shape marked (menuitemradio aria-checked + the trailing ✓).
    expect(rows[0].getAttribute("aria-checked")).toBe("true");
    expect(rows[0].textContent).toContain("✓");
    expect(rows[1].getAttribute("aria-checked")).toBe("false");
  });

  it("a 3-tile layout lists the five 3-tile presets", () => {
    renderTopBar({ layout: { ...mainLeftLayout, order: [...mainLeftLayout.order] }, onApplyLayout: vi.fn() });
    act(() => fireEvent.click(screen.getByLabelText("Layout")));
    const rows = Array.from(layoutMenu()!.querySelectorAll("[data-testid^='layout-shape-']"));
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "layout-shape-row",
      "layout-shape-col",
      "layout-shape-main-left",
      "layout-shape-main-right",
      "layout-shape-main-top",
    ]);
    expect(rows[2].getAttribute("aria-checked")).toBe("true");
  });

  it("clicking a glyph jumps DIRECTLY via setShape → onApplyLayout, and closes the popover", () => {
    const onApplyLayout = vi.fn();
    renderTopBar({ layout: { ...splitLayout, order: [...splitLayout.order] }, onApplyLayout });
    act(() => fireEvent.click(screen.getByLabelText("Layout")));
    act(() =>
      fireEvent.click(layoutMenu()!.querySelector("[data-testid='layout-shape-split-v']")!),
    );
    // Shape jump keeps the order; arity never changes.
    expect(onApplyLayout).toHaveBeenCalledWith({ shape: "split-v", order: ["tty", "code"] });
    expect(layoutMenu()).toBeNull();
  });

  it("Escape closes the popover and refocuses the chip", () => {
    renderTopBar({ layout: { ...splitLayout, order: [...splitLayout.order] }, onApplyLayout: vi.fn() });
    const chip = screen.getByLabelText("Layout");
    act(() => fireEvent.click(chip));
    expect(layoutMenu()).not.toBeNull();
    act(() => fireEvent.keyDown(document, { key: "Escape" }));
    expect(layoutMenu()).toBeNull();
    expect(chip).toHaveFocus();
  });

  it("the overflow (chevron) menu carries the chip's `Layout: …` radio rows", () => {
    const onApplyLayout = vi.fn();
    renderTopBar({ layout: { ...splitLayout, order: [...splitLayout.order] }, onApplyLayout });
    act(() => fireEvent.click(screen.getByLabelText("More controls")));
    const menu = screen.getByRole("menu", { name: "More controls" });
    const current = within(menu).getByRole("menuitemradio", { name: "Layout: Split Horizontal" });
    const other = within(menu).getByRole("menuitemradio", { name: "Layout: Split Vertical" });
    expect(current.getAttribute("aria-checked")).toBe("true");
    expect(other.getAttribute("aria-checked")).toBe("false");
    act(() => fireEvent.click(other));
    expect(onApplyLayout).toHaveBeenCalledWith({ shape: "split-v", order: ["tty", "code"] });
  });

  it("the chip is terminal-mode only (no chip on the server route)", () => {
    renderTopBar({
      mode: "server",
      sessionName: "",
      windowName: "",
      currentSession: null,
      currentWindow: null,
      layout: { shape: "single", order: ["tty"] },
      onApplyLayout: vi.fn(),
    });
    expect(screen.queryByLabelText("Layout")).not.toBeInTheDocument();
  });
});
