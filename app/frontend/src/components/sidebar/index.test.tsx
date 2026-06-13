import { StrictMode } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import { Sidebar } from "./index";
import { OptimisticProvider } from "@/contexts/optimistic-context";
import { MetricsProvider, StandaloneSessionContextProvider } from "@/contexts/session-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { ChromeProvider } from "@/contexts/chrome-context";
import { ToastProvider } from "@/components/toast";
import { useWindowStore } from "@/store/window-store";
import type { ProjectSession } from "@/types";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: "/" } }),
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    getAllServerColors: vi.fn().mockResolvedValue({}),
    setServerColor: vi.fn().mockResolvedValue({ ok: true }),
  };
});

// jsdom does not implement matchMedia — ThemeProvider + media-query hooks need it.
vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
  matches: query.includes("prefers-color-scheme: dark"),
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  onchange: null,
})));

const SERVERS = [
  { name: "primary", sessionCount: 1 },
  { name: "alpha", sessionCount: 0 },
  { name: "beta", sessionCount: 0 },
];

const PRIMARY_SESSIONS: ProjectSession[] = [
  {
    name: "main",
    windows: [
      {
        index: 0,
        windowId: "@0",
        name: "shell",
        worktreePath: "~/code/run-kit",
        activity: "active",
        isActiveWindow: true,
        paneCommand: "zsh",
        activityTimestamp: Math.floor(Date.now() / 1000),
      },
    ],
  },
];

type RenderOpts = {
  currentServer?: string | null;
  servers?: { name: string; sessionCount: number }[];
  /** Wrap the tree in <StrictMode> to surface impure state updaters (the
   *  double-invocation the real app gets via main.tsx). Off by default so the
   *  coupling tests keep their single-pass render. */
  strict?: boolean;
};

function renderSidebar(opts: RenderOpts = {}) {
  const currentServer = opts.currentServer === undefined ? "primary" : opts.currentServer;
  const servers = opts.servers ?? SERVERS;
  const sessionsByServer = new Map(
    servers.map((s) => [s.name, s.name === currentServer ? PRIMARY_SESSIONS : []]),
  );
  const tree = (
    <ThemeProvider>
      <ToastProvider>
        <OptimisticProvider>
          <StandaloneSessionContextProvider
            value={{
              sessionsByServer,
              sessionOrderByServer: new Map(servers.map((s) => [s.name, []])),
              isConnectedByServer: new Map(servers.map((s) => [s.name, false])),
              metricsByServer: new Map(),
              currentServer,
              servers,
              refreshServers: vi.fn(),
            }}
          >
            <MetricsProvider value={null}>
              <ChromeProvider>
                <Sidebar
                  currentServer={currentServer}
                  currentSession={currentServer ? "main" : null}
                  currentWindowId={currentServer ? "@0" : null}
                  onSelectWindow={vi.fn()}
                  onCreateWindow={vi.fn()}
                  onCreateSession={vi.fn()}
                  onCreateServer={vi.fn()}
                  onKillServer={vi.fn()}
                />
              </ChromeProvider>
            </MetricsProvider>
          </StandaloneSessionContextProvider>
        </OptimisticProvider>
      </ToastProvider>
    </ThemeProvider>
  );
  return render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree);
}

function getServerGroupHeader(name: string): HTMLElement | null {
  return screen.queryByRole("button", { name: new RegExp(`Collapse ${name} sessions|Expand ${name} sessions`) });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Sidebar — Server Pane / Sessions Pane coupling", () => {
  it("renders all ServerGroups when the Server Pane is collapsed (default)", () => {
    // No localStorage write → defaults to collapsed (defaultOpen=false).
    renderSidebar();

    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getServerGroupHeader("beta")).toBeInTheDocument();
  });

  it("renders only the current server's ServerGroup when the Server Pane is open and currentServer is resolved", () => {
    localStorage.setItem("runkit-panel-server", "true");
    renderSidebar({ currentServer: "primary" });

    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).not.toBeInTheDocument();
    expect(getServerGroupHeader("beta")).not.toBeInTheDocument();

    // Force-open: primary's group header reads "Collapse" (chevron points down).
    const primaryHeader = screen.getByRole("button", { name: /Collapse primary sessions/ });
    expect(primaryHeader).toHaveAttribute("aria-expanded", "true");
  });

  it("renders the empty-state hint when the Server Pane is open and currentServer is null", () => {
    localStorage.setItem("runkit-panel-server", "true");
    renderSidebar({ currentServer: null });

    expect(getServerGroupHeader("primary")).not.toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).not.toBeInTheDocument();

    const hint = screen.getByText("Select a server above to see its sessions.");
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveClass("text-text-secondary", "text-xs", "py-4", "text-center");
  });

  it("does not overwrite persisted per-server collapse keys when force-opening the current group", () => {
    // User has the primary group collapsed in the multi-server tree.
    localStorage.setItem("runkit-panel-sessions-primary", "false");
    localStorage.setItem("runkit-panel-server", "true");
    renderSidebar({ currentServer: "primary" });

    // The persisted value is unchanged after rendering with force-open in effect.
    expect(localStorage.getItem("runkit-panel-sessions-primary")).toBe("false");

    // And the rendered state is open (force-open dominates).
    const primaryHeader = screen.getByRole("button", { name: /Collapse primary sessions/ });
    expect(primaryHeader).toHaveAttribute("aria-expanded", "true");
  });

  it("re-renders the Sessions Pane within the same tab when the Server Pane is toggled", () => {
    renderSidebar({ currentServer: "primary" });

    // Initially collapsed → all groups visible.
    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getServerGroupHeader("beta")).toBeInTheDocument();

    // Toggle the Server Pane open by clicking its header.
    const serverPaneToggle = screen.getByRole("button", { name: /^Server/ });
    fireEvent.click(serverPaneToggle);

    // Tree narrows to the current server only — in-module pub/sub propagates.
    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).not.toBeInTheDocument();
    expect(getServerGroupHeader("beta")).not.toBeInTheDocument();

    // Toggle it closed again → all groups return.
    fireEvent.click(serverPaneToggle);
    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getServerGroupHeader("beta")).toBeInTheDocument();
  });

  it("falls back to 'No servers' when the server list is empty regardless of Server Pane state", () => {
    localStorage.setItem("runkit-panel-server", "true");
    renderSidebar({ servers: [], currentServer: null });

    // Two "No servers" empty-states render: ServerPanel's tile grid and the
    // Sessions Pane's group list. The Sessions Pane variant has the centered
    // `py-4 text-center` classes; the ServerPanel variant uses `py-1`.
    const sessionsEmpty = screen.getAllByText("No servers").find(
      (el) => el.className.includes("py-4") && el.className.includes("text-center"),
    );
    expect(sessionsEmpty).toBeDefined();
    expect(screen.queryByText("Select a server above to see its sessions.")).not.toBeInTheDocument();
  });

  it("propagates Server Pane state via the in-module pub/sub to sibling subscribers", () => {
    renderSidebar({ currentServer: "primary" });

    // The Server Pane header (ServerPanel's CollapsiblePanel chevron) and the
    // Sessions Pane list are sibling subscribers to the same `runkit-panel-server`
    // key via the shared hook's in-module pub/sub. Clicking the header writes
    // through that hook; the Sessions Pane must observe the change and re-render.
    // Asserting both the persisted value and the Sessions Pane DOM confirms the
    // pub/sub fans the update out to a non-clicking subscriber in the same tick.
    const serverPaneToggle = screen.getByRole("button", { name: /^Server/ });
    fireEvent.click(serverPaneToggle);

    expect(localStorage.getItem("runkit-panel-server")).toBe("true");
    expect(getServerGroupHeader("alpha")).not.toBeInTheDocument();
  });
});

describe("Sidebar — per-server group toggle under StrictMode (mss7)", () => {
  // Regression guard for mss7: clicking Expand on a non-current server's group
  // did nothing because `toggleServerSection` performed a `localStorage.setItem`
  // INSIDE the `setServerSectionsOpen` updater. React 19 StrictMode (active in
  // the real app via main.tsx, and in e2e) double-invokes state updaters; the
  // second pass observed the first pass's localStorage write and inverted the
  // computed `next`, so a single click was a net no-op and the group never
  // opened. This test renders under <StrictMode> — the exact condition the
  // existing coupling tests omit — and would fail against the pre-fix impure
  // updater. The fix moves the side-effects out of the updater (pure commit).
  it("opens a collapsed non-current group on first click and collapses it on the second", () => {
    // Server Pane key unset → defaults collapsed → all groups render, and
    // non-current groups (alpha) start collapsed (aria-expanded="false").
    renderSidebar({ currentServer: "primary", strict: true });

    const alphaToggle = screen.getByRole("button", { name: /Expand alpha sessions/ });
    expect(alphaToggle).toHaveAttribute("aria-expanded", "false");

    // First click: the group must open (the no-op bug manifested here).
    fireEvent.click(alphaToggle);
    expect(
      screen.getByRole("button", { name: /Collapse alpha sessions/ }),
    ).toHaveAttribute("aria-expanded", "true");
    // Side-effect ran exactly once and agrees with the rendered state.
    expect(localStorage.getItem("runkit-panel-sessions-alpha")).toBe("true");

    // Second click: the group must collapse again (full toggle cycle).
    fireEvent.click(screen.getByRole("button", { name: /Collapse alpha sessions/ }));
    expect(
      screen.getByRole("button", { name: /Expand alpha sessions/ }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("runkit-panel-sessions-alpha")).toBe("false");
  });
});

describe("Sidebar — mobile drawer current-row focus bonus (R9 / T007)", () => {
  // The global matchMedia stub (top of file) reports non-mobile, so the bonus
  // effect never runs in the other suites. Here we force mobile + an open
  // drawer and drive the deferred (requestAnimationFrame) focus synchronously
  // to prove the scoped selector focuses the selected WINDOW row — and, by the
  // selector's construction, would NOT match the active BoardsSection row
  // (which carries aria-current="page" but has no [data-window-id] ancestor).

  function makeMatchMedia(mobile: boolean) {
    return vi.fn().mockImplementation((query: string) => ({
      // ThemeProvider always needs prefers-color-scheme; in mobile mode the
      // width/coarse queries also match so useIsMobile() reports mobile.
      matches:
        query.includes("prefers-color-scheme: dark") ||
        (mobile && (query.includes("max-width") || query.includes("pointer: coarse"))),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
    }));
  }

  function stubMobileMatchMedia() {
    vi.stubGlobal("matchMedia", makeMatchMedia(true));
  }

  // Restore the file-default non-mobile matchMedia stub so this block's mobile
  // override never leaks into a later-running test (the file's shared afterEach
  // does not unstub globals).
  afterEach(() => {
    vi.stubGlobal("matchMedia", makeMatchMedia(false));
  });

  it("scroll+focuses the [aria-current=\"page\"] window row when the drawer is open on mobile", () => {
    stubMobileMatchMedia();
    // ChromeProvider seeds sidebarOpen from this key — open the drawer.
    localStorage.setItem("runkit-sidebar-open", "true");
    // Run the deferred focus synchronously instead of waiting a real frame.
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });

    try {
      // currentWindowId "@0" → that window row's button gets aria-current="page".
      renderSidebar({ currentServer: "primary" });

      const row = document.querySelector<HTMLElement>(
        '[data-window-id] [aria-current="page"]',
      );
      expect(row).not.toBeNull();
      // The match is the row button, nested under a [data-window-id] wrapper —
      // i.e. a window row, not the BoardsSection active row (which has no such
      // ancestor and is therefore excluded by the scoped selector).
      expect(row!.closest("[data-window-id]")).not.toBeNull();
      // The bonus moved focus to the selected window row.
      expect(document.activeElement).toBe(row);
      expect(rafSpy).toHaveBeenCalled();
    } finally {
      rafSpy.mockRestore();
    }
  });
});

describe("Sidebar — tree ARIA + roving keyboard navigation (wt1v)", () => {
  // A single server with one session "main" carrying two windows, plus a second
  // session "other" with one window — enough to exercise cross-session traversal,
  // expand/collapse, and end-of-list stops.
  const KB_SESSIONS: ProjectSession[] = [
    {
      name: "main",
      windows: [
        { index: 0, windowId: "@0", name: "edit", worktreePath: "~/a", activity: "idle", isActiveWindow: false, activityTimestamp: 0 },
        { index: 1, windowId: "@1", name: "test", worktreePath: "~/a", activity: "idle", isActiveWindow: false, activityTimestamp: 0 },
      ],
    },
    {
      name: "other",
      windows: [
        { index: 0, windowId: "@2", name: "run", worktreePath: "~/b", activity: "idle", isActiveWindow: false, activityTimestamp: 0 },
      ],
    },
  ];

  const onSelectWindow = vi.fn();

  // Build the provider tree for a given sessions snapshot so a test can
  // `rerender` with a CHANGED sessions Map (simulating a passive SSE tick).
  function treeUI(sessions: ProjectSession[]) {
    const servers = [{ name: "primary", sessionCount: 2 }];
    const sessionsByServer = new Map([["primary", sessions]]);
    return (
      <ThemeProvider>
        <ToastProvider>
          <OptimisticProvider>
            <StandaloneSessionContextProvider
              value={{
                sessionsByServer,
                sessionOrderByServer: new Map([["primary", []]]),
                isConnectedByServer: new Map([["primary", true]]),
                metricsByServer: new Map(),
                currentServer: "primary",
                servers,
                refreshServers: vi.fn(),
              }}
            >
              <MetricsProvider value={null}>
                <ChromeProvider>
                  <Sidebar
                    currentServer="primary"
                    currentSession="main"
                    currentWindowId={null}
                    onSelectWindow={onSelectWindow}
                    onCreateWindow={vi.fn()}
                    onCreateSession={vi.fn()}
                    onCreateServer={vi.fn()}
                    onKillServer={vi.fn()}
                  />
                </ChromeProvider>
              </MetricsProvider>
            </StandaloneSessionContextProvider>
          </OptimisticProvider>
        </ToastProvider>
      </ThemeProvider>
    );
  }

  function renderTree() {
    return render(treeUI(KB_SESSIONS));
  }

  function tree(): HTMLElement {
    return screen.getByRole("tree");
  }

  function visibleRows(): HTMLElement[] {
    return Array.from(tree().querySelectorAll<HTMLElement>('[role="treeitem"]'));
  }

  function rowKey(el: HTMLElement): string | null {
    return el.getAttribute("data-window-id") ?? el.getAttribute("data-session-row");
  }

  function rovingKeyNow(): string | null {
    const tabbable = visibleRows().find((r) => r.getAttribute("tabindex") === "0");
    return tabbable ? rowKey(tabbable) : null;
  }

  beforeEach(() => {
    localStorage.clear();
    onSelectWindow.mockClear();
    useWindowStore.setState({ entries: new Map(), ghosts: [] });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    useWindowStore.setState({ entries: new Map(), ghosts: [] });
  });

  it("renders a role=tree inside the Sessions nav landmark", () => {
    renderTree();
    const nav = screen.getByRole("navigation", { name: "Sessions" });
    const treeEl = within(nav).getByRole("tree");
    expect(treeEl).toBeInTheDocument();
    expect(treeEl).toHaveAttribute("aria-label", "Session tree");
  });

  it("wires each session row's aria-controls to a role=group window list with the matching id", () => {
    renderTree();
    const sessionRows = visibleRows().filter((r) => r.getAttribute("aria-level") === "1");
    expect(sessionRows.length).toBe(2);
    for (const sr of sessionRows) {
      const controls = sr.getAttribute("aria-controls");
      expect(controls).toBeTruthy();
      const group = document.getElementById(controls!);
      expect(group).not.toBeNull();
      expect(group).toHaveAttribute("role", "group");
    }
  });

  it("establishes exactly one tab stop (tabIndex=0) — the first visible row", () => {
    renderTree();
    const tabbable = visibleRows().filter((r) => r.getAttribute("tabindex") === "0");
    expect(tabbable.length).toBe(1);
    // First visible row is the "main" session header.
    expect(rowKey(tabbable[0])).toBe("primary:main");
  });

  it("ArrowDown/ArrowUp move the roving tab stop and stop at the ends (no wrap)", () => {
    renderTree();
    const t = tree();
    // Order: main (session) → @0 → @1 → other (session) → @2
    expect(rovingKeyNow()).toBe("primary:main");

    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); });
    expect(rovingKeyNow()).toBe("@0");
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); });
    expect(rovingKeyNow()).toBe("@1");

    // ArrowUp moves back.
    act(() => { fireEvent.keyDown(t, { key: "ArrowUp" }); });
    expect(rovingKeyNow()).toBe("@0");

    // Up at... walk to the very top and assert it stops (no wrap to the bottom).
    act(() => { fireEvent.keyDown(t, { key: "ArrowUp" }); }); // → main
    expect(rovingKeyNow()).toBe("primary:main");
    act(() => { fireEvent.keyDown(t, { key: "ArrowUp" }); }); // stop
    expect(rovingKeyNow()).toBe("primary:main");
  });

  it("Home/End jump to the first/last visible row", () => {
    renderTree();
    const t = tree();
    act(() => { fireEvent.keyDown(t, { key: "End" }); });
    expect(rovingKeyNow()).toBe("@2"); // last visible row (other's only window)
    act(() => { fireEvent.keyDown(t, { key: "Home" }); });
    expect(rovingKeyNow()).toBe("primary:main");
  });

  it("ArrowRight expands a collapsed session, then descends to its first window", () => {
    renderTree();
    const t = tree();
    // Collapse "main" first via its chevron so we can re-expand by keyboard.
    const mainChevron = screen.getByRole("button", { name: /Collapse main/ });
    act(() => { fireEvent.click(mainChevron); });
    // "main" is collapsed → its windows are gone; roving stays on "main".
    expect(rovingKeyNow()).toBe("primary:main");
    let mainRow = visibleRows().find((r) => rowKey(r) === "primary:main")!;
    expect(mainRow).toHaveAttribute("aria-expanded", "false");

    // ArrowRight expands it (focus stays on the session row).
    act(() => { fireEvent.keyDown(t, { key: "ArrowRight" }); });
    mainRow = visibleRows().find((r) => rowKey(r) === "primary:main")!;
    expect(mainRow).toHaveAttribute("aria-expanded", "true");
    expect(rovingKeyNow()).toBe("primary:main");

    // ArrowRight again descends to the first window child.
    act(() => { fireEvent.keyDown(t, { key: "ArrowRight" }); });
    expect(rovingKeyNow()).toBe("@0");
  });

  it("ArrowLeft collapses an expanded session and moves a window to its parent", () => {
    renderTree();
    const t = tree();
    // Move roving to @0 then ArrowLeft → parent session "main".
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); }); // @0
    expect(rovingKeyNow()).toBe("@0");
    act(() => { fireEvent.keyDown(t, { key: "ArrowLeft" }); }); // → parent main
    expect(rovingKeyNow()).toBe("primary:main");

    // ArrowLeft on the expanded session collapses it.
    act(() => { fireEvent.keyDown(t, { key: "ArrowLeft" }); });
    const mainRow = visibleRows().find((r) => rowKey(r) === "primary:main")!;
    expect(mainRow).toHaveAttribute("aria-expanded", "false");
  });

  it("Enter on a window row activates onSelectWindow with (server, session, windowId)", () => {
    renderTree();
    const t = tree();
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); }); // → @0
    act(() => { fireEvent.keyDown(t, { key: "Enter" }); });
    expect(onSelectWindow).toHaveBeenCalledWith("primary", "main", "@0");
  });

  it("Space on a window row also activates it", () => {
    renderTree();
    const t = tree();
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); }); // → @0
    act(() => { fireEvent.keyDown(t, { key: " " }); });
    expect(onSelectWindow).toHaveBeenCalledWith("primary", "main", "@0");
  });

  it("does not hijack arrows originating from a rename input", () => {
    renderTree();
    const t = tree();
    const before = rovingKeyNow();
    // Enter rename mode on the "main" session via double-click on its name.
    const nameBtn = screen.getByRole("button", { name: "Navigate to main" });
    act(() => { fireEvent.doubleClick(nameBtn); });
    const input = screen.getByLabelText("Rename session") as HTMLInputElement;
    // An ArrowDown whose target is the input must NOT move the roving cursor.
    act(() => { fireEvent.keyDown(input, { key: "ArrowDown" }); });
    expect(rovingKeyNow()).toBe(before);
  });

  // T014(b): the focus-movement half of R6 — an arrow keypress must move
  // document.activeElement onto the new roving row's DOM node.
  it("moves document.activeElement onto the roving row after an arrow keypress", () => {
    renderTree();
    const t = tree();
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); }); // → @0
    expect(rovingKeyNow()).toBe("@0");
    const focused = document.activeElement as HTMLElement | null;
    expect(focused).not.toBeNull();
    // The focused element is the @0 window-row treeitem.
    expect(focused!.getAttribute("data-window-id")).toBe("@0");
  });

  // T014(a): the SSE-tick invariant (would have caught MF-1). A passive SSE tick
  // re-renders the tree with a CHANGED sessions Map but the SAME visible-row SET.
  // It must NOT change the roving row and must NOT pull focus into the tree.
  it("a passive SSE tick (changed sessions Map, no keypress) does not change roving or steal focus", () => {
    const { rerender } = renderTree();
    // Initial roving row is the first visible row ("main"); no keypress yet, so
    // focus is NOT in the tree.
    expect(rovingKeyNow()).toBe("primary:main");
    expect(tree().contains(document.activeElement)).toBe(false);

    // Simulate a passive SSE tick: a NEW sessions Map + new window objects (the
    // SSE snapshot is always fresh refs) with the SAME windowId set — only an
    // activity field churns, the visible-row SET is unchanged.
    const ticked: ProjectSession[] = KB_SESSIONS.map((s) => ({
      ...s,
      windows: s.windows.map((w) => ({ ...w, activityTimestamp: w.activityTimestamp + 1 })),
    }));
    act(() => { rerender(treeUI(ticked)); });

    // Roving row + the single tabIndex=0 row are unchanged.
    expect(rovingKeyNow()).toBe("primary:main");
    expect(visibleRows().filter((r) => r.getAttribute("tabindex") === "0").length).toBe(1);
    // Focus was NOT pulled into the tree by the passive tick.
    expect(tree().contains(document.activeElement)).toBe(false);
  });

  // T015 (SF-2): Enter on a REAL window row calls onSelectWindow with the
  // (server, session, windowId) derived from the roving identity — a direct
  // handler call, not a synthesized DOM click.
  it("Enter on a real window row calls onSelectWindow with the roving identity", () => {
    renderTree();
    const t = tree();
    act(() => { fireEvent.keyDown(t, { key: "End" }); }); // → @2 (other's window)
    expect(rovingKeyNow()).toBe("@2");
    act(() => { fireEvent.keyDown(t, { key: "Enter" }); });
    expect(onSelectWindow).toHaveBeenCalledWith("primary", "other", "@2");
  });

  // T015 (SF-3): Enter/Space on a ghost/optimistic window row (key `ghost-…`,
  // empty windowId) is a no-op — no onSelectWindow call.
  it("Enter/Space on a ghost window row does not call onSelectWindow", () => {
    // Seed the window store's real "main" windows FIRST, then add the ghost.
    // The ghost captures @0/@1 in its snapshot, so the mount-time
    // setWindowsForSession sees NO new windowIds and preserves the ghost
    // (ghosts are otherwise consumed when an unknown real window arrives).
    const store = useWindowStore.getState();
    store.setWindowsForSession("primary", "main", KB_SESSIONS[0].windows);
    const ghostId = store.addGhostWindow("primary", "main", "deploying");
    const ghostKey = `ghost-${ghostId}`;

    renderTree();
    const t = tree();
    // The ghost row is the last child of "main"'s window group (after @0, @1).
    const ghostRow = visibleRows().find((r) => rowKey(r) === ghostKey);
    expect(ghostRow, "ghost window row should be rendered").toBeTruthy();

    // Walk roving onto the ghost row: main → @0 → @1 → ghost.
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); }); // @0
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); }); // @1
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); }); // ghost
    expect(rovingKeyNow()).toBe(ghostKey);

    act(() => { fireEvent.keyDown(t, { key: "Enter" }); });
    act(() => { fireEvent.keyDown(t, { key: " " }); });
    expect(onSelectWindow).not.toHaveBeenCalled();
  });
});
