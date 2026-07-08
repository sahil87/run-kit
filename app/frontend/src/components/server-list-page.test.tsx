import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Service, ProjectSession } from "@/types";
import type { ServerInfo } from "@/api/client";
import { ThemeProvider } from "@/contexts/theme-context";
import { ChromeProvider } from "@/contexts/chrome-context";
import { TopBarSlotProvider } from "@/contexts/top-bar-slot-context";

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
    // Cockpit connection dot source (260704-9o7k) — gray in these tests; the
    // dot's presence (not its color) is what the TopBar tests assert.
    hostMetricsConnected: false,
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
        <TopBarSlotProvider>
          <ServerListPage />
        </TopBarSlotProvider>
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

  it("enables 'Open in window' for ANY listed port when a server exists (backend now broadcasts only HTTP responders — no client-side denylist)", async () => {
    // 5432 (PostgreSQL) was formerly on the NON_HTTP_PORTS denylist. Now the
    // backend probes and only broadcasts HTTP responders, so any port that
    // reaches the frontend is provably HTTP — every tile is clickable when a
    // server exists. The denylist and its "Not a web service" gate are gone.
    mockServices = [{ port: 5432 }, { port: 6379 }];
    mockServers = [{ name: "runkit", sessionCount: 1 }];
    mockSessionsByServer = new Map([["runkit", [{ name: "main", windows: [] }]]]);
    renderPage();
    expect(screen.getByText(":5432")).toBeTruthy();
    expect(screen.getByText(":6379")).toBeTruthy();

    const buttons = screen.getAllByRole("button", { name: "Open in window" }) as HTMLButtonElement[];
    for (const btn of buttons) {
      expect(btn.disabled).toBe(false);
      // No "Not a web service" hint remains — the only gate is server existence.
      expect(btn.title).toBe("");
    }
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

describe("ServerListPage — TopBar mount moved to root (260707-4vq2)", () => {
  // The cockpit-mode TopBar mount was lifted to the persistent root layout
  // (`RootTopBar` in app.tsx). `ServerListPage` no longer renders a TopBar of
  // its own — it only publishes the connection-dot data into the slot context.
  // The TopBar's own rendering (brand crumb, controls, `Cockpit` heading,
  // no-hamburger) is now covered by top-bar.test.tsx (which renders TopBar in
  // cockpit mode directly) and the top-bar-persistence e2e; asserting those
  // internals on this component — which no longer mounts them — would be a
  // false test (Test Integrity: tests conform to the current structure).

  it("renders NO TopBar of its own — the brand crumb / controls / heading are not this component's DOM", () => {
    renderPage();
    // None of the shared TopBar's landmarks render from ServerListPage now.
    expect(screen.queryByLabelText("Run Kit home")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Refresh page")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cockpit")).not.toBeInTheDocument();
  });

  it("still renders no in-page PageHeading row — the Cockpit identity lives in the root top-bar center heading (260704-pr0p)", () => {
    renderPage();
    // The old `[ cockpit ]` <h1> PageHeading row remains gone; the page body
    // carries no level-1 heading of its own (page identity rides the root bar).
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
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
