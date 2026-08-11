import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ServerDialogs } from "./server-dialogs";
import { ServerDialogsProvider, useServerDialogs } from "@/contexts/server-dialogs-context";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import { OptimisticProvider } from "@/contexts/optimistic-context";
import { ToastProvider } from "@/components/toast";
import * as client from "@/api/client";

/**
 * Tests for the single layout-mounted server dialogs (260811-239r) — the
 * AppShell-derived superset now shared by every route: input sanitization on
 * change + finalize on submit, post-create pending marker + `/$server`
 * navigation, the `DAEMON_SERVER` warning on the kill confirm (previously
 * missing on board routes — drift), and post-kill navigation to `/` ONLY when
 * the killed server is SessionContext's `currentServer` (null on board routes,
 * so a board kill never navigates).
 */

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    createServer: vi.fn(),
    killServer: vi.fn(),
  };
});

const createServer = client.createServer as unknown as ReturnType<typeof vi.fn>;
const killServer = client.killServer as unknown as ReturnType<typeof vi.fn>;

/** Test-side trigger panel standing in for the sidebar/palette call sites. */
function Triggers() {
  const { openCreateServer, requestKillServer } = useServerDialogs();
  return (
    <div>
      <button onClick={openCreateServer}>open-create</button>
      <button onClick={() => requestKillServer("alpha")}>kill-alpha</button>
      <button onClick={() => requestKillServer(client.DAEMON_SERVER)}>kill-daemon</button>
    </div>
  );
}

function renderDialogs(opts?: {
  currentServer?: string | null;
  markServerPending?: (name: string) => void;
  refreshServers?: () => void;
}) {
  render(
    <ToastProvider>
      <StandaloneSessionContextProvider
        value={{
          currentServer: opts?.currentServer ?? null,
          markServerPending: opts?.markServerPending ?? vi.fn(),
          refreshServers: opts?.refreshServers ?? vi.fn(),
        }}
      >
        <OptimisticProvider>
          <ServerDialogsProvider>
            <Triggers />
            <ServerDialogs />
          </ServerDialogsProvider>
        </OptimisticProvider>
      </StandaloneSessionContextProvider>
    </ToastProvider>,
  );
}

describe("ServerDialogs", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    createServer.mockReset();
    killServer.mockReset();
    createServer.mockResolvedValue({ name: "x" });
    killServer.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("opens the create dialog via the context trigger and sanitizes input on change", () => {
    renderDialogs();
    fireEvent.click(screen.getByText("open-create"));
    const input = screen.getByLabelText("Server name");
    // Unsafe chars convert live (toSafeServerName) — the board twin previously
    // stored the raw value (drift fixed by the single implementation).
    fireEvent.change(input, { target: { value: "my server!" } });
    expect((input as HTMLInputElement).value).toBe("my_server_");
  });

  it("submits the finalized name, marks it pending, navigates to /$server, and closes", async () => {
    const markServerPending = vi.fn();
    const refreshServers = vi.fn();
    renderDialogs({ markServerPending, refreshServers });
    fireEvent.click(screen.getByText("open-create"));
    const input = screen.getByLabelText("Server name");
    // Trailing separator stays visible while typing; finalizeSafeName trims it
    // at commit.
    fireEvent.change(input, { target: { value: "my server " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(markServerPending).toHaveBeenCalledWith("my_server");
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/$server", params: { server: "my_server" } });
    expect(screen.queryByLabelText("Server name")).not.toBeInTheDocument();
    // The POST itself is deferred a microtask inside useOptimisticAction; the
    // post-create server-list refresh rides onAlwaysSettled after it resolves.
    await waitFor(() => expect(createServer).toHaveBeenCalledWith("my_server"));
    await waitFor(() => expect(refreshServers).toHaveBeenCalled());
  });

  it("renders the DAEMON_SERVER warning only when the kill target is the daemon server", () => {
    renderDialogs();
    fireEvent.click(screen.getByText("kill-daemon"));
    expect(screen.getByText(/hosts the run-kit daemon serving this dashboard/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));

    fireEvent.click(screen.getByText("kill-alpha"));
    expect(screen.getByText(/Kill server/)).toBeInTheDocument();
    expect(screen.queryByText(/hosts the run-kit daemon serving this dashboard/)).not.toBeInTheDocument();
  });

  it("navigates to / after killing the current server (terminal-route rule)", async () => {
    renderDialogs({ currentServer: "alpha" });
    fireEvent.click(screen.getByText("kill-alpha"));
    fireEvent.click(screen.getByText("Kill"));
    // The POST is deferred a microtask inside useOptimisticAction.
    await waitFor(() => expect(killServer).toHaveBeenCalledWith("alpha"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
    await waitFor(() => expect(screen.queryByText(/Kill server/)).not.toBeInTheDocument());
  });

  it("does NOT navigate after a kill when currentServer is null (board route)", async () => {
    renderDialogs({ currentServer: null });
    fireEvent.click(screen.getByText("kill-alpha"));
    fireEvent.click(screen.getByText("Kill"));
    await waitFor(() => expect(killServer).toHaveBeenCalledWith("alpha"));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does NOT navigate after killing a non-current server", async () => {
    renderDialogs({ currentServer: "beta" });
    fireEvent.click(screen.getByText("kill-alpha"));
    fireEvent.click(screen.getByText("Kill"));
    await waitFor(() => expect(killServer).toHaveBeenCalledWith("alpha"));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
