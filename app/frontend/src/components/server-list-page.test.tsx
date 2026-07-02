import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Service, ProjectSession } from "@/types";
import type { ServerInfo } from "@/api/client";

// --- Router mock: capture navigate calls. ---
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

// --- API client mock. ---
vi.mock("@/api/client", () => ({
  createServer: vi.fn().mockResolvedValue({ ok: true }),
  createSession: vi.fn().mockResolvedValue({ ok: true }),
  createWindow: vi.fn().mockResolvedValue({ ok: true }),
  getSessions: vi.fn().mockResolvedValue([]),
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

import { ServerListPage } from "./server-list-page";
import { createSession, createWindow, getSessions } from "@/api/client";

beforeEach(() => {
  vi.clearAllMocks();
  mockServices = [];
  mockServers = [];
  mockSessionsByServer = new Map();
});

afterEach(cleanup);

describe("ServerListPage — Services zone", () => {
  it("renders a 'No services' fallback when the services list is empty", async () => {
    mockServices = [];
    render(<ServerListPage />);
    expect(screen.getByText("No services")).toBeTruthy();
  });

  it("renders a tile per service with port primary and process secondary", async () => {
    mockServices = [{ port: 5173 }, { port: 8080, process: "api" }];
    render(<ServerListPage />);

    expect(screen.getByText(":5173")).toBeTruthy();
    expect(screen.getByText(":8080")).toBeTruthy();
    expect(screen.getByText("api")).toBeTruthy();
  });

  it("disables 'Open in window' with a hint when zero servers exist", async () => {
    mockServices = [{ port: 5173 }];
    mockServers = [];
    render(<ServerListPage />);
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
    render(<ServerListPage />);
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
    render(<ServerListPage />);
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
    render(<ServerListPage />);
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
    render(<ServerListPage />);
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
    render(<ServerListPage />);
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
    render(<ServerListPage />);
    expect(screen.getByText(":5173")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open in window" }));

    await waitFor(() => expect(vi.mocked(createWindow)).toHaveBeenCalled());
    const windowName = vi.mocked(createWindow).mock.calls[0][2];
    expect(windowName).toBe("port-5173");
    expect(windowName).not.toContain(":");
    expect(windowName).not.toContain(".");
  });
});
