import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Service, ProjectSession } from "@/types";
import type { ServerInfo } from "@/api/client";
import { ThemeProvider } from "@/contexts/theme-context";
import { ChromeProvider } from "@/contexts/chrome-context";

// --- Router mock: capture navigate calls. ---
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

// --- API client mock. Partial (importActual) so the real theme-preference
// helpers used by the shared TopBar's ThemeProvider stay available; only the
// server/session/window create + fetch calls this page drives are stubbed. ---
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    createServer: vi.fn().mockResolvedValue({ ok: true }),
    createSession: vi.fn().mockResolvedValue({ ok: true }),
    createWindow: vi.fn().mockResolvedValue({ ok: true }),
    getSessions: vi.fn().mockResolvedValue([]),
    splitWindow: vi.fn().mockResolvedValue({ ok: true }),
    closePane: vi.fn().mockResolvedValue({ ok: true }),
  };
});

// --- Push lib mock: the shared TopBar (cockpit mode) mounts NotificationControl,
// which calls getPushState() on mount. Keep it deterministic + supported-off so
// the bell renders without touching real serviceWorker / Notification. ---
vi.mock("@/lib/push", () => ({
  getPushState: vi.fn().mockResolvedValue("default"),
  enablePushSubscription: vi.fn().mockResolvedValue("subscribed"),
  sendTestNotification: vi.fn().mockResolvedValue(true),
}));

// --- Toast mock. ---
const addToastMock = vi.fn();
vi.mock("@/components/toast", () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

// --- Context hooks mock: drive host services + the server list + session map
// directly. Since 260701-f4e5, ServerListPage reads `servers`/`serversLoaded`
// from SessionContext (not its own listServers() fetch), so the servers are
// supplied here rather than via an API mock. ---
let mockServices: Service[] = [];
let mockServers: ServerInfo[] = [];
let mockSessionsByServer: Map<string, ProjectSession[]> = new Map();
const refreshServersMock = vi.fn();
const markServerPendingMock = vi.fn();
vi.mock("@/contexts/session-context", () => ({
  useHostMetrics: () => null,
  useHostServices: () => mockServices,
  useSessionContext: () => ({
    servers: mockServers,
    serversLoaded: true,
    refreshServers: refreshServersMock,
    markServerPending: markServerPendingMock,
    sessionsByServer: mockSessionsByServer,
  }),
}));

// HostMetrics is rendered only when hostMetrics is non-null (it is null here),
// but import it lazily-safe by stubbing.
vi.mock("@/components/host-metrics", () => ({
  HostMetrics: () => null,
}));

// --- Boards hook mock: the BOARDS zone consumes useBoards(); the real hook
// needs the SessionContext SSE pool (attachServer/subscribeBoardChange), which
// the context mock above deliberately omits — mock at the hook seam instead. ---
let mockBoards: { name: string; pinCount: number }[] = [];
vi.mock("@/hooks/use-boards", () => ({
  useBoards: () => ({ boards: mockBoards, isLoading: false, error: null }),
}));

import { ServerListPage } from "./server-list-page";
import { createSession, createWindow, getSessions } from "@/api/client";

/**
 * Render the page inside the providers the shared cockpit-mode TopBar depends on
 * (Theme + Chrome). Toast + router are module-mocked above; the push lib is
 * mocked so NotificationControl mounts cleanly.
 */
function renderPage() {
  return render(
    <ThemeProvider>
      <ChromeProvider>
        <ServerListPage />
      </ChromeProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockServices = [];
  mockServers = [];
  mockBoards = [];
  mockSessionsByServer = new Map();
  // ThemeProvider reads matchMedia on mount.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ServerListPage — Services zone", () => {
  it("renders a 'No services' fallback when the services list is empty", async () => {
    mockServices = [];
    renderPage();
    expect(screen.getByText("No services")).toBeTruthy();
  });

  it("renders a tile per service with port primary and process secondary", async () => {
    mockServices = [{ port: 5173 }, { port: 8080, process: "api" }];
    renderPage();

    expect(screen.getByText(":5173")).toBeTruthy();
    expect(screen.getByText(":8080")).toBeTruthy();
    expect(screen.getByText("api")).toBeTruthy();
  });

  it("disables 'Open in window' with a hint when zero servers exist", async () => {
    mockServices = [{ port: 5173 }];
    mockServers = [];
    renderPage();
    expect(screen.getByText(":5173")).toBeTruthy();

    const btn = screen.getByRole("button", { name: "Open in window" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("Create a server first");
  });

  it("creates an instant session + iframe window and navigates when a server genuinely has no sessions", async () => {
    mockServices = [{ port: 5173 }];
    mockServers = [{ name: "runkit", sessionCount: 0 }];
    // SSE cache empty AND the authoritative fetch confirms no sessions.
    vi.mocked(getSessions).mockResolvedValue([]);
    renderPage();
    expect(screen.getByText(":5173")).toBeTruthy();

    const btn = screen.getByRole("button", { name: "Open in window" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);

    await waitFor(() => expect(vi.mocked(createWindow)).toHaveBeenCalled());
    // The authoritative fetch was consulted before creating anything.
    expect(vi.mocked(getSessions)).toHaveBeenCalledWith("runkit");
    // Then a session was created (server had none, confirmed by the fetch).
    expect(vi.mocked(createSession)).toHaveBeenCalledWith("runkit", "services");
    // The iframe window points at the proxy for that port.
    expect(vi.mocked(createWindow)).toHaveBeenCalledWith(
      "runkit",
      "services",
      "port-5173",
      undefined,
      "iframe",
      "/proxy/5173/",
    );
    expect(navigateMock).toHaveBeenCalledWith({ to: "/$server", params: { server: "runkit" } });
  });

  it("fetches an existing session (no createSession) when the SSE cache is empty on a fresh load", async () => {
    // The bug: on a fresh `/` load no per-server stream is attached, so
    // `sessionsByServer` is empty even though the server HAS a session. The old
    // code would then createSession("services"), which 500s if it already
    // exists. The fix falls back to an authoritative getSessions() fetch.
    mockServices = [{ port: 3000 }];
    mockServers = [{ name: "runkit", sessionCount: 1 }];
    mockSessionsByServer = new Map(); // SSE cache not yet populated
    vi.mocked(getSessions).mockResolvedValue([{ name: "existing", windows: [] }]);
    renderPage();
    expect(screen.getByText(":3000")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open in window" }));

    await waitFor(() => expect(vi.mocked(createWindow)).toHaveBeenCalled());
    expect(vi.mocked(getSessions)).toHaveBeenCalledWith("runkit");
    // No session created — the fetch surfaced the existing one.
    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
    expect(vi.mocked(createWindow)).toHaveBeenCalledWith(
      "runkit",
      "existing",
      "port-3000",
      undefined,
      "iframe",
      "/proxy/3000/",
    );
  });

  it("reuses the SSE-cached session (no fetch, no createSession) when the target server has one", async () => {
    mockServices = [{ port: 8080 }];
    mockServers = [{ name: "runkit", sessionCount: 1 }];
    mockSessionsByServer = new Map([["runkit", [{ name: "main", windows: [] }]]]);
    renderPage();
    expect(screen.getByText(":8080")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open in window" }));

    await waitFor(() => expect(vi.mocked(createWindow)).toHaveBeenCalled());
    // Cache hit short-circuits the fallback fetch entirely.
    expect(vi.mocked(getSessions)).not.toHaveBeenCalled();
    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
    expect(vi.mocked(createWindow)).toHaveBeenCalledWith(
      "runkit",
      "main",
      "port-8080",
      undefined,
      "iframe",
      "/proxy/8080/",
    );
  });

  it("disables 'Open in window' with a 'Not a web service' hint for a well-known non-HTTP port, even when a server exists", async () => {
    mockServices = [{ port: 5432 }]; // PostgreSQL — in the non-HTTP denylist
    mockServers = [{ name: "runkit", sessionCount: 1 }];
    mockSessionsByServer = new Map([["runkit", [{ name: "main", windows: [] }]]]);
    renderPage();
    expect(screen.getByText(":5432")).toBeTruthy();

    const btn = screen.getByRole("button", { name: "Open in window" }) as HTMLButtonElement;
    // A server exists, but the port is non-HTTP → click is gated with the port hint.
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("Not a web service");
  });

  it("gates only the non-HTTP tile, leaving HTTP-likely ports clickable", async () => {
    mockServices = [{ port: 5173 }, { port: 6379 }]; // vite (clickable) + redis (gated)
    mockServers = [{ name: "runkit", sessionCount: 1 }];
    mockSessionsByServer = new Map([["runkit", [{ name: "main", windows: [] }]]]);
    renderPage();
    expect(screen.getByText(":5173")).toBeTruthy();

    const buttons = screen.getAllByRole("button", { name: "Open in window" }) as HTMLButtonElement[];
    // Tiles render in service order: 5173 first (enabled), 6379 second (disabled).
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
    expect(buttons[1].title).toBe("Not a web service");
    // Both ports still SHOW as tiles — only the click is gated.
    expect(screen.getByText(":6379")).toBeTruthy();
  });

  it("names the iframe window without colons or periods (tmux ValidateName rejects them)", async () => {
    // Regression: the window name was `:${port}`, which tmux rejects ("Window
    // name cannot contain colons or periods"). It must be a valid tmux name.
    mockServices = [{ port: 5173 }];
    mockServers = [{ name: "runkit", sessionCount: 1 }];
    mockSessionsByServer = new Map([["runkit", [{ name: "main", windows: [] }]]]);
    renderPage();
    expect(screen.getByText(":5173")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open in window" }));

    await waitFor(() => expect(vi.mocked(createWindow)).toHaveBeenCalled());
    const windowName = vi.mocked(createWindow).mock.calls[0][2];
    expect(windowName).toBe("port-5173");
    expect(windowName).not.toContain(":");
    expect(windowName).not.toContain(".");
  });
});

describe("ServerListPage — Cockpit TopBar", () => {
  it("renders the shared TopBar (brand home crumb) instead of the old ad-hoc header", () => {
    renderPage();
    // The shared TopBar's brand root crumb links home.
    const brand = screen.getByLabelText("Run Kit home");
    expect(brand).toHaveAttribute("href", "/");
    // Route-agnostic controls are reachable on `/`.
    expect(screen.getByLabelText("Toggle fixed terminal width")).toBeInTheDocument();
    expect(screen.getByLabelText(/theme/i)).toBeInTheDocument();
  });

  it("renders no hamburger and no connection dot in cockpit mode", () => {
    renderPage();
    // The Cockpit has no sidebar → no hamburger; no per-server SSE → no dot.
    expect(screen.queryByLabelText("Toggle navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders the retro 'cockpit' page heading (lowercase, bracket-tag idiom)", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: "cockpit" }),
    ).toBeInTheDocument();
  });
});

describe("ServerListPage — BOARDS zone", () => {
  it("renders board tiles above TMUX SERVERS and navigates on click", () => {
    mockBoards = [
      { name: "main", pinCount: 3 },
      { name: "review", pinCount: 1 },
    ];
    renderPage();

    // Section order: Host Health → Boards → Tmux Servers → Services.
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual([
      "Host Health",
      "Boards",
      "Tmux Servers",
      "Services",
    ]);

    expect(screen.getByText("2 boards")).toBeInTheDocument();
    expect(screen.getByText("3 pins")).toBeInTheDocument();

    fireEvent.click(screen.getByText("main"));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/board/$name",
      params: { name: "main" },
    });
  });

  it("shows the pin-to-start hint when no boards exist (section stays visible)", () => {
    renderPage();
    expect(screen.getByText("0 boards")).toBeInTheDocument();
    expect(
      screen.getByText("Pin a window to start a board"),
    ).toBeInTheDocument();
  });
});
