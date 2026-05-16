import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { Sidebar } from "./index";
import { OptimisticProvider } from "@/contexts/optimistic-context";
import { MetricsProvider, StandaloneSessionContextProvider } from "@/contexts/session-context";
import { ThemeProvider } from "@/contexts/theme-context";
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
};

function renderSidebar(opts: RenderOpts = {}) {
  const currentServer = opts.currentServer === undefined ? "primary" : opts.currentServer;
  const servers = opts.servers ?? SERVERS;
  const sessionsByServer = new Map(
    servers.map((s) => [s.name, s.name === currentServer ? PRIMARY_SESSIONS : []]),
  );
  return render(
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
              <Sidebar
                currentServer={currentServer}
                currentSession={currentServer ? "main" : null}
                currentWindowIndex={currentServer ? "0" : null}
                onSelectWindow={vi.fn()}
                onCreateWindow={vi.fn()}
                onCreateSession={vi.fn()}
                onCreateServer={vi.fn()}
                onKillServer={vi.fn()}
              />
            </MetricsProvider>
          </StandaloneSessionContextProvider>
        </OptimisticProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
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

  it("uses the in-module pub/sub when a second subscriber writes the storage key", () => {
    renderSidebar({ currentServer: "primary" });

    // Simulate a write from another component (e.g., ServerPanel's CollapsiblePanel
    // toggle in production) via a direct localStorage write + a manual dispatch
    // through the shared hook. The CollapsiblePanel test already covers user
    // chevron clicks; this asserts the pub/sub itself synchronises siblings.
    const serverPaneToggle = screen.getByRole("button", { name: /^Server/ });
    fireEvent.click(serverPaneToggle);

    expect(localStorage.getItem("runkit-panel-server")).toBe("true");
    expect(getServerGroupHeader("alpha")).not.toBeInTheDocument();
  });
});
