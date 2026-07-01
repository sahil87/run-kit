import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Service, ProjectSession } from "@/types";

// --- Router mock: capture navigate calls. ---
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

// --- API client mock. ---
vi.mock("@/api/client", () => ({
  listServers: vi.fn().mockResolvedValue([]),
  createServer: vi.fn().mockResolvedValue({ ok: true }),
  createSession: vi.fn().mockResolvedValue({ ok: true }),
  createWindow: vi.fn().mockResolvedValue({ ok: true }),
}));

// --- Toast mock. ---
const addToastMock = vi.fn();
vi.mock("@/components/toast", () => ({
  useToast: () => ({ addToast: addToastMock }),
}));

// --- Context hooks mock: drive host services + the session map directly. ---
let mockServices: Service[] = [];
let mockSessionsByServer: Map<string, ProjectSession[]> = new Map();
vi.mock("@/contexts/session-context", () => ({
  useHostMetrics: () => null,
  useHostServices: () => mockServices,
  useSessionContext: () => ({ sessionsByServer: mockSessionsByServer }),
}));

// HostMetrics is rendered only when hostMetrics is non-null (it is null here),
// but import it lazily-safe by stubbing.
vi.mock("@/components/host-metrics", () => ({
  HostMetrics: () => null,
}));

import { ServerListPage } from "./server-list-page";
import { listServers, createSession, createWindow } from "@/api/client";

beforeEach(() => {
  vi.clearAllMocks();
  mockServices = [];
  mockSessionsByServer = new Map();
});

afterEach(cleanup);

describe("ServerListPage — Services zone", () => {
  it("renders a 'No services' fallback when the services list is empty", async () => {
    mockServices = [];
    render(<ServerListPage />);
    await waitFor(() => expect(vi.mocked(listServers)).toHaveBeenCalled());
    expect(screen.getByText("No services")).toBeTruthy();
  });

  it("renders a tile per service with port primary and process secondary", async () => {
    mockServices = [{ port: 5173 }, { port: 8080, process: "api" }];
    render(<ServerListPage />);
    await waitFor(() => expect(vi.mocked(listServers)).toHaveBeenCalled());

    expect(screen.getByText(":5173")).toBeTruthy();
    expect(screen.getByText(":8080")).toBeTruthy();
    expect(screen.getByText("api")).toBeTruthy();
  });

  it("disables 'Open in window' with a hint when zero servers exist", async () => {
    mockServices = [{ port: 5173 }];
    vi.mocked(listServers).mockResolvedValue([]);
    render(<ServerListPage />);
    await waitFor(() => expect(screen.getByText(":5173")).toBeTruthy());

    const btn = screen.getByRole("button", { name: "Open in window" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("Create a server first");
  });

  it("creates an instant session + iframe window and navigates when a server has no sessions", async () => {
    mockServices = [{ port: 5173 }];
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 0 }]);
    render(<ServerListPage />);
    await waitFor(() => expect(screen.getByText(":5173")).toBeTruthy());

    const btn = screen.getByRole("button", { name: "Open in window" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);

    await waitFor(() => expect(vi.mocked(createWindow)).toHaveBeenCalled());
    // A session was created first (server had none known).
    expect(vi.mocked(createSession)).toHaveBeenCalledWith("runkit", "services");
    // The iframe window points at the proxy for that port.
    expect(vi.mocked(createWindow)).toHaveBeenCalledWith(
      "runkit",
      "services",
      ":5173",
      undefined,
      "iframe",
      "/proxy/5173/",
    );
    expect(navigateMock).toHaveBeenCalledWith({ to: "/$server", params: { server: "runkit" } });
  });

  it("reuses an existing session (no createSession) when the target server has one", async () => {
    mockServices = [{ port: 8080 }];
    vi.mocked(listServers).mockResolvedValue([{ name: "runkit", sessionCount: 1 }]);
    mockSessionsByServer = new Map([["runkit", [{ name: "main", windows: [] }]]]);
    render(<ServerListPage />);
    await waitFor(() => expect(screen.getByText(":8080")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Open in window" }));

    await waitFor(() => expect(vi.mocked(createWindow)).toHaveBeenCalled());
    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
    expect(vi.mocked(createWindow)).toHaveBeenCalledWith(
      "runkit",
      "main",
      ":8080",
      undefined,
      "iframe",
      "/proxy/8080/",
    );
  });
});
