import { StrictMode } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import { Sidebar } from "./index";
import { OptimisticProvider } from "@/contexts/optimistic-context";
import { HostMetricsProvider, MetricsProvider, StandaloneSessionContextProvider } from "@/contexts/session-context";
import { FocusedPaneProvider, useRegisterFocusedPane, type FocusedPane } from "@/contexts/focused-pane-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { InstanceAccentValueProvider, type InstanceAccent } from "@/contexts/instance-accent-context";
import { ChromeProvider } from "@/contexts/chrome-context";
import { ToastProvider } from "@/components/toast";
import { useWindowStore } from "@/store/window-store";
import { getAllServerColors, setServerColor } from "@/api/client";
import {
  computeRowTints,
  computeRowBorders,
  UNCOLORED_SELECTED_KEY,
  DEFAULT_DARK_THEME,
} from "@/themes";
import type { MetricsSnapshot, ProjectSession } from "@/types";

// HostPanel (inside Sidebar) consumes the instance-accent context; inject a
// static null accent so sidebar tests need no fetching provider (1etw).
const NULL_ACCENT: InstanceAccent = {
  color: null,
  isExplicit: false,
  stripeHex: null,
  washHex: null,
  setColor: () => {},
};


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
  /** Publish a focused board pane into the FocusedPaneProvider (260720-zx4i) —
   *  simulates BoardPage's registration. `undefined` = no registrant mounted. */
  focusedPane?: FocusedPane;
  /** Override the derived per-server sessions map (board-route tests need
   *  session data on a NON-current server). */
  sessionsByServer?: Map<string, ProjectSession[]>;
  /** Host-metrics source health for the HOST dot (defaults false). */
  hostMetricsConnected?: boolean;
  /** Host-global metrics snapshot fed to HostMetricsProvider (defaults null). */
  hostMetrics?: MetricsSnapshot | null;
  /** Override the Sidebar's onKillServer prop (x4sf) — the header ✕ routes
   *  through it; tests assert the invocation, never a direct kill call. */
  onKillServer?: (name: string) => void;
};

/** Mounts BoardPage's registration seam inside the provider (260720-zx4i). */
function FocusedPaneRegistrant({ pane }: { pane: FocusedPane }) {
  useRegisterFocusedPane(pane);
  return null;
}

function renderSidebar(opts: RenderOpts = {}) {
  const currentServer = opts.currentServer === undefined ? "primary" : opts.currentServer;
  const servers = opts.servers ?? SERVERS;
  const sessionsByServer = opts.sessionsByServer ?? new Map(
    servers.map((s) => [s.name, s.name === currentServer ? PRIMARY_SESSIONS : []]),
  );
  const tree = (
    <ThemeProvider>
      <InstanceAccentValueProvider value={NULL_ACCENT}>
      <ToastProvider>
        <OptimisticProvider>
          <StandaloneSessionContextProvider
            value={{
              sessionsByServer,
              sessionOrderByServer: new Map(servers.map((s) => [s.name, []])),
              isConnectedByServer: new Map(servers.map((s) => [s.name, false])),
              hostMetricsConnected: opts.hostMetricsConnected ?? false,
              metricsByServer: new Map(),
              currentServer,
              servers,
              refreshServers: vi.fn(),
            }}
          >
            <MetricsProvider value={null}>
              <HostMetricsProvider value={opts.hostMetrics ?? null}>
                <FocusedPaneProvider>
                  {opts.focusedPane !== undefined && (
                    <FocusedPaneRegistrant pane={opts.focusedPane} />
                  )}
                  <ChromeProvider>
                    <Sidebar
                      currentServer={currentServer}
                      currentSession={currentServer ? "main" : null}
                      currentWindowId={currentServer ? "@0" : null}
                      onSelectWindow={vi.fn()}
                      onCreateWindow={vi.fn()}
                      onCreateSession={vi.fn()}
                      onCreateServer={vi.fn()}
                      onKillServer={opts.onKillServer ?? vi.fn()}
                    />
                  </ChromeProvider>
                </FocusedPaneProvider>
              </HostMetricsProvider>
            </MetricsProvider>
          </StandaloneSessionContextProvider>
        </OptimisticProvider>
      </ToastProvider>
    </InstanceAccentValueProvider>
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

function getScopeChip(): HTMLElement {
  return screen.getByRole("button", { name: "Toggle sessions scope" });
}

describe("Sidebar — sessions-pane scope (runkit-panel-sessions-scope)", () => {
  it("renders all ServerGroups by default (scope `all`, no stored value)", () => {
    renderSidebar();

    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getServerGroupHeader("beta")).toBeInTheDocument();
    expect(getScopeChip()).toHaveTextContent("ALL");
  });

  it("renders only the current server's ServerGroup in `current` scope, force-opened", () => {
    localStorage.setItem("runkit-panel-sessions-scope", "current");
    renderSidebar({ currentServer: "primary" });

    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).not.toBeInTheDocument();
    expect(getServerGroupHeader("beta")).not.toBeInTheDocument();
    expect(getScopeChip()).toHaveTextContent("CUR");

    // Force-open: primary's group header reads "Collapse" (chevron points down).
    const primaryHeader = screen.getByRole("button", { name: /Collapse primary sessions/ });
    expect(primaryHeader).toHaveAttribute("aria-expanded", "true");
  });

  it("falls back to all servers in `current` scope when currentServer is null (board route) — no hint", () => {
    localStorage.setItem("runkit-panel-sessions-scope", "current");
    renderSidebar({ currentServer: null });

    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getServerGroupHeader("beta")).toBeInTheDocument();
    expect(
      screen.queryByText("Select a server above to see its sessions."),
    ).not.toBeInTheDocument();
  });

  it("falls back to all servers in `current` scope when currentServer is missing from the list", () => {
    localStorage.setItem("runkit-panel-sessions-scope", "current");
    // Stale/deleted route param: currentServer names a server not in `servers`.
    renderSidebar({ currentServer: "gone" });

    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getServerGroupHeader("beta")).toBeInTheDocument();
  });

  it("treats an unrecognized stored scope value as `all`", () => {
    localStorage.setItem("runkit-panel-sessions-scope", "bogus");
    renderSidebar({ currentServer: "primary" });

    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getScopeChip()).toHaveTextContent("ALL");
  });

  it("does not overwrite persisted per-server collapse keys when force-opening the current group", () => {
    // User has the primary group collapsed in the multi-server tree.
    localStorage.setItem("runkit-panel-sessions-primary", "false");
    localStorage.setItem("runkit-panel-sessions-scope", "current");
    renderSidebar({ currentServer: "primary" });

    // The persisted value is unchanged after rendering with force-open in effect.
    expect(localStorage.getItem("runkit-panel-sessions-primary")).toBe("false");

    // And the rendered state is open (force-open dominates).
    const primaryHeader = screen.getByRole("button", { name: /Collapse primary sessions/ });
    expect(primaryHeader).toHaveAttribute("aria-expanded", "true");
  });

  it("chip click narrows the tree, persists `current`, and a second click restores `all`", () => {
    renderSidebar({ currentServer: "primary" });

    // Initially scope `all` → all groups visible.
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getServerGroupHeader("beta")).toBeInTheDocument();

    fireEvent.click(getScopeChip());

    // Narrowed to the current server; value persisted; chip reflects state.
    expect(localStorage.getItem("runkit-panel-sessions-scope")).toBe("current");
    expect(getScopeChip()).toHaveTextContent("CUR");
    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).not.toBeInTheDocument();
    expect(getServerGroupHeader("beta")).not.toBeInTheDocument();

    fireEvent.click(getScopeChip());

    // Restored: all groups return, value persisted back to `all`.
    expect(localStorage.getItem("runkit-panel-sessions-scope")).toBe("all");
    expect(getScopeChip()).toHaveTextContent("ALL");
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getServerGroupHeader("beta")).toBeInTheDocument();
  });

  it("SERVER panel expansion no longer affects the sessions tree (delink regression)", () => {
    // The old coupling filtered the tree when the SERVER panel was open. The
    // scope state is now the only filter input — the panel key must be inert.
    localStorage.setItem("runkit-panel-server", "true");
    renderSidebar({ currentServer: "primary" });

    expect(getServerGroupHeader("primary")).toBeInTheDocument();
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    expect(getServerGroupHeader("beta")).toBeInTheDocument();

    // Toggling the SERVER panel live changes nothing in the tree either.
    const serverPaneToggle = screen.getByRole("button", { name: /^Server/ });
    fireEvent.click(serverPaneToggle);
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
    fireEvent.click(serverPaneToggle);
    expect(getServerGroupHeader("alpha")).toBeInTheDocument();
  });

  it("falls back to 'No servers' when the server list is empty regardless of scope", () => {
    localStorage.setItem("runkit-panel-sessions-scope", "current");
    renderSidebar({ servers: [], currentServer: null });

    // Two "No servers" empty-states render: ServerPanel's tile grid and the
    // Sessions Pane's group list. The Sessions Pane variant has the centered
    // `py-4 text-center` classes; the ServerPanel variant uses `py-1`.
    const sessionsEmpty = screen.getAllByText("No servers").find(
      (el) => el.className.includes("py-4") && el.className.includes("text-center"),
    );
    expect(sessionsEmpty).toBeDefined();
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
        <InstanceAccentValueProvider value={NULL_ACCENT}>
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
                <HostMetricsProvider value={null}>
                  <FocusedPaneProvider>
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
                  </FocusedPaneProvider>
                </HostMetricsProvider>
              </MetricsProvider>
            </StandaloneSessionContextProvider>
          </OptimisticProvider>
        </ToastProvider>
        </InstanceAccentValueProvider>
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
    // Mirrors production rowKeyOf: the globally-unique roving handle is
    // `data-row-key` (window rows, `${server}:${windowId}`) or `data-session-row`
    // (session rows, `${server}:${name}`) — NOT the bare `data-window-id`.
    return el.getAttribute("data-row-key") ?? el.getAttribute("data-session-row");
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
    expect(rovingKeyNow()).toBe("primary:@0");
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); });
    expect(rovingKeyNow()).toBe("primary:@1");

    // ArrowUp moves back.
    act(() => { fireEvent.keyDown(t, { key: "ArrowUp" }); });
    expect(rovingKeyNow()).toBe("primary:@0");

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
    expect(rovingKeyNow()).toBe("primary:@2"); // last visible row (other's only window)
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
    expect(rovingKeyNow()).toBe("primary:@0");
  });

  it("ArrowLeft collapses an expanded session and moves a window to its parent", () => {
    renderTree();
    const t = tree();
    // Move roving to @0 then ArrowLeft → parent session "main".
    act(() => { fireEvent.keyDown(t, { key: "ArrowDown" }); }); // @0
    expect(rovingKeyNow()).toBe("primary:@0");
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
    expect(rovingKeyNow()).toBe("primary:@0");
    const focused = document.activeElement as HTMLElement | null;
    expect(focused).not.toBeNull();
    // The focused element is the @0 window-row treeitem. (data-window-id stays
    // the bare tmux id; the globally-unique roving handle is data-row-key.)
    expect(focused!.getAttribute("data-window-id")).toBe("@0");
    expect(focused!.getAttribute("data-row-key")).toBe("primary:@0");
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
    expect(rovingKeyNow()).toBe("primary:@2");
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
    // Roving key is the globally-unique handle: `${server}:ghost-${optimisticId}`.
    const ghostKey = `primary:ghost-${ghostId}`;

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

describe("Sidebar — session-reorder self-target drop acceptance (i41e snap-back fix)", () => {
  // Mirror of use-server-reorder.test.ts's self-target case for the sidebar
  // session-reorder handler (`handleSessionReorderOver`). The bug: a dragover on
  // the dragged row itself bailed BEFORE preventDefault, so HTML5 DnD played the
  // native cancelled-drag snap-back. The fix hoists preventDefault/dropEffect
  // above the self-name check. fireEvent.dragOver returns `false` when the
  // handler called preventDefault() (the event was cancelled), so drop
  // acceptance is observable without stubbing the native method.

  /** A minimal mutable dataTransfer bag, mirroring the hook test's makeDragEvent. */
  function makeDataTransfer(types: string[] = []) {
    const store = new Map<string, string>();
    const t = [...types];
    return {
      setData: (type: string, data: string) => {
        store.set(type, data);
        if (!t.includes(type)) t.push(type);
      },
      getData: (type: string) => store.get(type) ?? "",
      get types() {
        return t;
      },
      dropEffect: "none",
      effectAllowed: "none",
    };
  }

  it("accepts a session-reorder dragover on the dragged row itself (preventDefault called, dropEffect move)", () => {
    // PRIMARY_SESSIONS has one session "main" in the (force-open current)
    // "primary" group, rendered as a draggable row with data-session-row.
    renderSidebar({ currentServer: "primary" });

    const row = document.querySelector('[data-session-row="primary:main"]');
    expect(row).toBeTruthy();

    // dragStart seeds sessionDragSource = { server: "primary", name: "main" }.
    // Shared dataTransfer bag so the dragover sees the session-reorder MIME the
    // start handler wrote.
    const dataTransfer = makeDataTransfer();
    act(() => {
      fireEvent.dragStart(row!, { dataTransfer });
    });
    expect(dataTransfer.types).toContain("application/x-session-reorder");

    // dragover on the SAME row (self-target). The handler must still accept the
    // drop: fireEvent returns false when preventDefault() was called.
    let notPrevented: boolean;
    act(() => {
      notPrevented = fireEvent.dragOver(row!, { dataTransfer });
    });
    expect(notPrevented!).toBe(false); // preventDefault() was called → drop accepted
    expect(dataTransfer.dropEffect).toBe("move");
  });

  it("does not accept a session-reorder dragover before any drag started (source guard)", () => {
    renderSidebar({ currentServer: "primary" });
    const row = document.querySelector('[data-session-row="primary:main"]');
    expect(row).toBeTruthy();

    // No dragStart → sessionDragSource is null → the source guard rejects before
    // acceptance (no preventDefault).
    const dataTransfer = makeDataTransfer(["application/x-session-reorder"]);
    let notPrevented: boolean;
    act(() => {
      notPrevented = fireEvent.dragOver(row!, { dataTransfer });
    });
    expect(notPrevented!).toBe(true); // default NOT prevented → not accepted
  });
});

describe("BottomPanels — board-route focused-pane fallback + HOST dot (zx4i)", () => {
  // Sessions live on server "boardsrv" (NOT the current server — the board
  // route has currentServer=null). The enriched window @9 carries fab data the
  // thin fallback could never synthesize, so its presence proves the lookup hit.
  const BOARD_SESSIONS: ProjectSession[] = [
    {
      name: "home",
      windows: [
        {
          index: 0,
          windowId: "@9",
          name: "pinned-live",
          worktreePath: "/home/u/code/live",
          activity: "idle",
          isActiveWindow: false,
          activityTimestamp: 0,
          fabChange: "260720-zx4i-board-route-pane-host-panels",
          fabStage: "apply",
          panes: [
            {
              paneId: "%77",
              paneIndex: 0,
              cwd: "/home/u/code/live",
              command: "zsh",
              isActive: true,
              gitBranch: "zx4i-branch",
            },
          ],
        },
      ],
    },
  ];

  const boardServers = [{ name: "boardsrv", sessionCount: 1 }];
  const boardSessionsMap = new Map([["boardsrv", BOARD_SESSIONS]]);

  function paneHeader(): HTMLElement {
    return screen.getByRole("button", { name: /^Pane/ });
  }

  it("renders the ENRICHED home-session copy when the focused pane resolves by windowId", () => {
    renderSidebar({
      currentServer: null,
      servers: boardServers,
      sessionsByServer: boardSessionsMap,
      focusedPane: {
        server: "boardsrv",
        windowId: "@9",
        windowName: "pinned-live",
        panes: [
          { paneId: "%77", paneIndex: 0, cwd: "/tmp/thin", command: "zsh", isActive: true },
        ],
      },
    });
    expect(screen.queryByText("No window selected")).not.toBeInTheDocument();
    // The fab register renders — only the enriched SSE copy carries fabChange,
    // so this proves the windowId lookup (not the thin fallback) supplied it.
    expect(screen.getByText(/zx4i board-route-pane-host-panels · apply/)).toBeInTheDocument();
    // Identity from the enriched copy, not the thin panes (cwd differs:
    // /home/u/code/live shortens to ~/code/live; the thin pane cwd is /tmp/thin).
    expect(screen.getByText("~/code/live")).toBeInTheDocument();
    expect(screen.queryByText("/tmp/thin")).not.toBeInTheDocument();
  });

  it("thin-renders from the board entry's panes when the lookup misses (pin-only window)", () => {
    renderSidebar({
      currentServer: null,
      servers: boardServers,
      sessionsByServer: boardSessionsMap,
      focusedPane: {
        server: "boardsrv",
        windowId: "@404", // absent from BOARD_SESSIONS
        windowName: "pin-only",
        panes: [
          {
            paneId: "%88",
            paneIndex: 0,
            cwd: "/srv/pin-only",
            command: "vim",
            isActive: true,
            gitBranch: "orphan-branch",
          },
        ],
      },
    });
    expect(screen.queryByText("No window selected")).not.toBeInTheDocument();
    // Identity rows from the entry's own pane data.
    expect(paneHeader().textContent).toContain("pin-only");
    expect(screen.getByText(/%88/)).toBeInTheDocument();
    expect(screen.getByText("orphan-branch")).toBeInTheDocument();
    // Enrichment-only registers honestly absent.
    expect(screen.queryByTestId("register-agent")).not.toBeInTheDocument();
    expect(screen.queryByText(/· apply/)).not.toBeInTheDocument();
  });

  it("never falls back to the focused pane on a server route (unresolved route window)", () => {
    // Server route (currentServer set) whose route window can't resolve yet —
    // the sessions snapshot hasn't arrived (empty list). A stale focused pane
    // is still published (clear-on-unmount lands a commit later). The PANE
    // panel must show the empty state, NOT the board-focused window: the
    // fallback is gated on the board route itself, not on `!routeWindow`.
    renderSidebar({
      currentServer: "primary",
      servers: [{ name: "primary", sessionCount: 0 }, ...boardServers],
      sessionsByServer: new Map([["primary", []], ["boardsrv", BOARD_SESSIONS]]),
      focusedPane: {
        server: "boardsrv",
        windowId: "@9",
        windowName: "pinned-live",
        panes: [
          { paneId: "%77", paneIndex: 0, cwd: "/tmp/thin", command: "zsh", isActive: true },
        ],
      },
    });
    expect(screen.getByText("No window selected")).toBeInTheDocument();
    expect(paneHeader().textContent).not.toContain("pinned-live");
  });

  it("keeps 'No window selected' when no focused pane is published (empty board)", () => {
    renderSidebar({
      currentServer: null,
      servers: boardServers,
      sessionsByServer: boardSessionsMap,
      focusedPane: null,
    });
    expect(screen.getByText("No window selected")).toBeInTheDocument();
  });

  const HOST_METRICS: MetricsSnapshot = {
    hostname: "board-host",
    cpu: { samples: [10], current: 10, cores: 4 },
    memory: { used: 1024 ** 3, total: 8 * 1024 ** 3 },
    load: { avg1: 0.1, avg5: 0.1, avg15: 0.1, cpus: 4 },
    disk: { used: 10 * 1024 ** 3, total: 100 * 1024 ** 3 },
    uptime: 60,
  };

  it("HOST dot follows hostMetricsConnected when currentServer is null (board route)", () => {
    renderSidebar({
      currentServer: null,
      servers: boardServers,
      sessionsByServer: boardSessionsMap,
      focusedPane: null,
      hostMetrics: HOST_METRICS,
      hostMetricsConnected: true,
    });
    // The host-global fallback fills the panel (no server-scoped metrics on a
    // board route) and the dot reads the host-metrics source health, not the
    // always-false server-scoped signal.
    expect(screen.getByText("board-host")).toBeInTheDocument();
    expect(screen.getByTitle("SSE connected")).toBeInTheDocument();
    expect(screen.queryByText("No metrics")).not.toBeInTheDocument();
  });

  it("HOST dot shows disconnected when host metrics are stale on the board route", () => {
    renderSidebar({
      currentServer: null,
      servers: boardServers,
      sessionsByServer: boardSessionsMap,
      focusedPane: null,
      hostMetrics: HOST_METRICS,
      hostMetricsConnected: false,
    });
    expect(screen.getByTitle("SSE disconnected")).toBeInTheDocument();
  });
});

describe("Sidebar — tinted server-group header fill (t1ca)", () => {
  // Variant D: each SESSIONS-pane server-group header is a filled bar carrying
  // the server's color, resolved through the SAME precomputed maps the SERVER
  // panel tiles use (computeRowTints/computeRowBorders — dual-keyed under
  // family names and legacy descriptors). Expected values are computed from
  // the default dark theme (the theme the jsdom matchMedia stub resolves), so
  // no hex is hardcoded here either.
  const palette = DEFAULT_DARK_THEME.palette;
  const tints = computeRowTints(palette);
  const borders = computeRowBorders(palette, DEFAULT_DARK_THEME.category);

  /** jsdom normalizes inline style colors to `rgb(r, g, b)`. */
  function rgb(hex: string): string {
    const h = hex.replace("#", "");
    return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
  }

  function headerContainer(server: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(`[data-server='${server}']`);
    expect(el, `header container for ${server}`).toBeTruthy();
    return el!;
  }

  function toggleButton(server: string): HTMLElement {
    return within(headerContainer(server)).getByRole("button", {
      name: new RegExp(`(Collapse|Expand) ${server} sessions`),
    });
  }

  /** Render and flush the getAllServerColors effect promise. */
  async function renderWithColors(colors: Record<string, string>, currentServer = "primary") {
    vi.mocked(getAllServerColors).mockResolvedValue(colors);
    renderSidebar({ currentServer });
    await act(async () => {});
  }

  afterEach(() => {
    // Restore the file-default empty color map so this block's colors never
    // leak into other suites.
    vi.mocked(getAllServerColors).mockResolvedValue({});
  });

  it("colored non-current header carries the base tint fill, accent text, and accent top border", async () => {
    await renderWithColors({ alpha: "4" });

    const container = headerContainer("alpha");
    expect(container.style.backgroundColor).toBe(rgb(tints.get("4")!.base));
    expect(container.style.borderTopWidth).toBe("1px");
    expect(container.style.borderTopColor).toBe(rgb(borders.get("4")!));

    // Header text is the contrast-guarded accent, not text-secondary classes.
    const button = toggleButton("alpha");
    expect(button.style.color).toBe(rgb(borders.get("4")!));
    expect(button.className).not.toContain("text-text-primary");
  });

  it("current server reads deeper: selected tint fill + text-text-primary (no inline accent)", async () => {
    await renderWithColors({ primary: "4", alpha: "1" });

    // Current server: deeper selected shade + brightest text.
    const current = headerContainer("primary");
    expect(current.style.backgroundColor).toBe(rgb(tints.get("4")!.selected));
    const currentButton = toggleButton("primary");
    expect(currentButton.className).toContain("text-text-primary");
    expect(currentButton.style.color).toBe("");

    // Non-current sits at base with accent text — the strength distinction.
    expect(headerContainer("alpha").style.backgroundColor).toBe(rgb(tints.get("1")!.base));
    expect(toggleButton("alpha").style.color).toBe(rgb(borders.get("1")!));
  });

  it("uncolored server falls back to the gray sentinel with the same heavier treatment", async () => {
    await renderWithColors({}); // no colors assigned at all

    const container = headerContainer("beta");
    const grayTint = tints.get(UNCOLORED_SELECTED_KEY)!;
    const grayBorder = borders.get(UNCOLORED_SELECTED_KEY)!;
    expect(container.style.backgroundColor).toBe(rgb(grayTint.base));
    expect(container.style.borderTopColor).toBe(rgb(grayBorder));

    // Identical heavier element class: taller header, weight 600, coarse floor.
    const button = toggleButton("beta");
    expect(button.className).toContain("min-h-[26px]");
    expect(button.className).toContain("coarse:min-h-[28px]");
    expect(button.className).toContain("font-semibold");
  });

  it("unrecognized color descriptors degrade to the gray sentinel, never an unstyled header", async () => {
    await renderWithColors({ alpha: "bogus-color" });

    const container = headerContainer("alpha");
    expect(container.style.backgroundColor).toBe(rgb(tints.get(UNCOLORED_SELECTED_KEY)!.base));
    expect(container.style.borderTopColor).toBe(rgb(borders.get(UNCOLORED_SELECTED_KEY)!));
  });

  it("non-current header deepens to the hover shade on mouseenter and restores on leave; current stays flat", async () => {
    await renderWithColors({ primary: "4", alpha: "1" });

    const alpha = headerContainer("alpha");
    fireEvent.mouseEnter(alpha);
    expect(alpha.style.backgroundColor).toBe(rgb(tints.get("1")!.hover));
    fireEvent.mouseLeave(alpha);
    expect(alpha.style.backgroundColor).toBe(rgb(tints.get("1")!.base));

    // Current server: no hover swap — selected is already the deepest shade.
    const primary = headerContainer("primary");
    fireEvent.mouseEnter(primary);
    expect(primary.style.backgroundColor).toBe(rgb(tints.get("4")!.selected));
  });

  it("keeps header semantics: aria labels, expand/collapse, and the + button on the tinted bar", async () => {
    await renderWithColors({ alpha: "4" });

    // Toggle still works on the tinted header.
    const toggle = screen.getByRole("button", { name: /Expand alpha sessions/ });
    fireEvent.click(toggle);
    expect(
      screen.getByRole("button", { name: /Collapse alpha sessions/ }),
    ).toHaveAttribute("aria-expanded", "true");

    // The + new-session button still renders inside the tinted container.
    expect(
      within(headerContainer("alpha")).getByRole("button", { name: "New session on alpha" }),
    ).toBeInTheDocument();
  });
});

describe("Sidebar — server-group header action cluster (x4sf)", () => {
  // The header hosts a three-button server action cluster — palette, plus,
  // close, in that fixed order — reusing the SERVER-tile machinery wholesale:
  // SwatchPopover + the shared onServerColorChange seam for color, the lifted
  // onKillServer confirmation flow for kill. Queries are scoped WITHIN the
  // header container ([data-server]) because the SERVER-panel tiles carry the
  // same aria wording for the same actions.
  const palette = DEFAULT_DARK_THEME.palette;
  const tints = computeRowTints(palette);
  const borders = computeRowBorders(palette, DEFAULT_DARK_THEME.category);

  /** jsdom normalizes inline style colors to `rgb(r, g, b)`. */
  function rgb(hex: string): string {
    const h = hex.replace("#", "");
    return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
  }

  function headerContainer(server: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(`[data-server='${server}']`);
    expect(el, `header container for ${server}`).toBeTruthy();
    return el!;
  }

  /** Render and flush the getAllServerColors effect promise. */
  async function renderWithColors(
    colors: Record<string, string>,
    opts: { currentServer?: string; onKillServer?: (name: string) => void } = {},
  ) {
    vi.mocked(getAllServerColors).mockResolvedValue(colors);
    renderSidebar({ currentServer: opts.currentServer ?? "primary", onKillServer: opts.onKillServer });
    await act(async () => {});
  }

  afterEach(() => {
    // Restore the file-default mocks so this block's state never leaks.
    vi.mocked(getAllServerColors).mockResolvedValue({});
    vi.mocked(setServerColor).mockClear();
  });

  it("renders the cluster in palette → plus → close DOM order after the toggle", async () => {
    await renderWithColors({ alpha: "4" });

    const buttons = within(headerContainer("alpha")).getAllByRole("button");
    expect(buttons).toHaveLength(4);
    expect(buttons[0]).toHaveAccessibleName(/(Expand|Collapse) alpha sessions/);
    expect(buttons[1]).toHaveAccessibleName("Set color for server alpha");
    expect(buttons[2]).toHaveAccessibleName("New session on alpha");
    expect(buttons[3]).toHaveAccessibleName("Kill server alpha");
  });

  it("hover-reveals the palette with the coarse touch fallback; + and ✕ stay always visible", async () => {
    await renderWithColors({ alpha: "4" });

    const container = headerContainer("alpha");
    // The reveal is driven by group-hover on the header container itself.
    expect(container.className).toContain("group");

    const paletteBtn = within(container).getByRole("button", { name: "Set color for server alpha" });
    for (const cls of ["opacity-0", "group-hover:opacity-100", "coarse:opacity-100", "focus-visible:opacity-100"]) {
      expect(paletteBtn.className).toContain(cls);
    }
    const plus = within(container).getByRole("button", { name: "New session on alpha" });
    const close = within(container).getByRole("button", { name: "Kill server alpha" });
    for (const btn of [plus, close]) {
      expect(btn.className).not.toContain("opacity-0");
      expect(btn.className).not.toContain("group-hover:opacity-100");
    }
  });

  it("cluster rest color follows the header text treatment (accent wrapper, inherited by buttons)", async () => {
    await renderWithColors({ primary: "4", alpha: "1" });

    // Non-current: the cluster wrapper carries the contrast-guarded accent as
    // an inline color; the buttons themselves carry NO inline color so their
    // hover: classes (text-text-primary / text-red-400) can win on hover.
    const alphaPalette = within(headerContainer("alpha")).getByRole("button", {
      name: "Set color for server alpha",
    });
    const alphaWrapper = alphaPalette.parentElement as HTMLElement;
    expect(alphaWrapper.style.color).toBe(rgb(borders.get("1")!));
    const alphaClose = within(headerContainer("alpha")).getByRole("button", {
      name: "Kill server alpha",
    });
    expect(alphaClose.style.color).toBe("");
    expect(alphaClose.className).toContain("hover:text-red-400");

    // Current: brightest text via class, no inline accent.
    const primaryPalette = within(headerContainer("primary")).getByRole("button", {
      name: "Set color for server primary",
    });
    const primaryWrapper = primaryPalette.parentElement as HTMLElement;
    expect(primaryWrapper.className).toContain("text-text-primary");
    expect(primaryWrapper.style.color).toBe("");
  });

  it("palette toggle opens a color-only SwatchPopover portalled to document.body", async () => {
    await renderWithColors({ alpha: "4" });

    const container = headerContainer("alpha");
    fireEvent.click(within(container).getByRole("button", { name: "Set color for server alpha" }));

    // Color-only picker (no marker column) — distinguished from the SERVER
    // panel's role=listbox tile grid by its accessible name.
    const popover = screen.getByRole("listbox", { name: "Color picker" });
    // Portalled: escapes the header (and the sessions list's overflow clip).
    expect(container.contains(popover)).toBe(false);
    expect(document.body.contains(popover)).toBe(true);
  });

  it("a swatch pick funnels through the shared seam: optimistic tint repaint + POST, then closes", async () => {
    await renderWithColors({}); // alpha starts uncolored (gray sentinel)

    const container = headerContainer("alpha");
    expect(container.style.backgroundColor).toBe(rgb(tints.get(UNCOLORED_SELECTED_KEY)!.base));

    fireEvent.click(within(container).getByRole("button", { name: "Set color for server alpha" }));
    const popover = screen.getByRole("listbox", { name: "Color picker" });
    fireEvent.click(within(popover).getByRole("option", { name: "Color blue" }));

    // The single write seam maps the family to its legacy descriptor ("4")
    // and the shared handler POSTs + repaints the header tint optimistically
    // (non-current ⇒ base shade) without waiting for any poll.
    expect(vi.mocked(setServerColor)).toHaveBeenCalledExactlyOnceWith("alpha", "4");
    expect(container.style.backgroundColor).toBe(rgb(tints.get("4")!.base));
    expect(screen.queryByRole("listbox", { name: "Color picker" })).not.toBeInTheDocument();
  });

  it("Clear color clears the optimistic entry back to the gray sentinel and POSTs null", async () => {
    await renderWithColors({ alpha: "4" });

    const container = headerContainer("alpha");
    expect(container.style.backgroundColor).toBe(rgb(tints.get("4")!.base));

    fireEvent.click(within(container).getByRole("button", { name: "Set color for server alpha" }));
    fireEvent.click(
      within(screen.getByRole("listbox", { name: "Color picker" })).getByRole("option", {
        name: "Clear color",
      }),
    );

    expect(vi.mocked(setServerColor)).toHaveBeenCalledExactlyOnceWith("alpha", null);
    expect(container.style.backgroundColor).toBe(rgb(tints.get(UNCOLORED_SELECTED_KEY)!.base));
  });

  it("✕ invokes the lifted onKillServer prop with the server name (confirmation is the parent's)", async () => {
    const onKillServer = vi.fn();
    await renderWithColors({ alpha: "4" }, { onKillServer });

    fireEvent.click(
      within(headerContainer("alpha")).getByRole("button", { name: "Kill server alpha" }),
    );

    expect(onKillServer).toHaveBeenCalledExactlyOnceWith("alpha");
    // No sidebar-owned dialog: the kill confirmation lives in the parent
    // (app.tsx / board-page.tsx killServerTarget), so nothing renders here.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the toggle dominant and the existing header semantics intact", async () => {
    await renderWithColors({ alpha: "4" });

    const container = headerContainer("alpha");
    const toggle = within(container).getByRole("button", { name: /Expand alpha sessions/ });
    expect(toggle.className).toContain("flex-1");
    fireEvent.click(toggle);
    expect(
      within(container).getByRole("button", { name: /Collapse alpha sessions/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });
});
