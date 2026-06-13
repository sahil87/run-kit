import { StrictMode } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { Sidebar } from "./index";
import { OptimisticProvider } from "@/contexts/optimistic-context";
import { MetricsProvider, StandaloneSessionContextProvider } from "@/contexts/session-context";
import { ThemeProvider } from "@/contexts/theme-context";
import { ChromeProvider } from "@/contexts/chrome-context";
import { ToastProvider } from "@/components/toast";
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
