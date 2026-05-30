import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { useEffect } from "react";
import {
  StandaloneSessionContextProvider,
  useSessionContext,
} from "@/contexts/session-context";
import type { ServerInfo } from "@/api/client";
import { resolveServerGuard, ServerWaiting, ServerNotFound } from "@/app";

/**
 * Route-guard tests (T013) for the three-way server guard.
 *
 * `resolveServerGuard` is the single source of truth for the guard decision in
 * AppShell, so the matrix is asserted on it directly. `GuardHarness` then drives
 * that decision through `StandaloneSessionContextProvider` and mirrors AppShell's
 * clear-on-appearance effect, so the waiting→view swap and pending-clear lifecycle
 * (spec case a) and the later-deletion case (A-015) are exercised end-to-end
 * without rendering the heavy full AppShell subtree.
 */

const SRV = (name: string): ServerInfo => ({ name, sessionCount: 0 });

/** Minimal harness: reads the session context (fed by the standalone provider),
 *  applies the exact exported guard decision, and mirrors AppShell's
 *  clear-on-appearance effect. */
function GuardHarness({ server }: { server: string }) {
  const { servers, serversLoaded, pendingServer, markServerPending } = useSessionContext();

  useEffect(() => {
    if (pendingServer && servers.some((s) => s.name === pendingServer)) {
      markServerPending(null);
    }
  }, [servers, pendingServer, markServerPending]);

  const outcome = resolveServerGuard({ server, servers, serversLoaded, pendingServer });
  if (outcome === "waiting") return <ServerWaiting serverName={server} />;
  if (outcome === "notfound") return <ServerNotFound serverName={server} />;
  return <div data-testid="server-view">server view: {server}</div>;
}

afterEach(cleanup);

describe("resolveServerGuard — three-way matrix", () => {
  it("renders (falls through) when the server is present", () => {
    expect(
      resolveServerGuard({
        server: "test2",
        servers: [SRV("test2")],
        serversLoaded: true,
        pendingServer: null,
      }),
    ).toBe("render");
  });

  it("(a) waits for a just-created server absent from the list", () => {
    expect(
      resolveServerGuard({
        server: "test2",
        servers: [SRV("runkit")],
        serversLoaded: true,
        pendingServer: "test2",
      }),
    ).toBe("waiting");
  });

  it("(a) renders once the pending server appears in the list", () => {
    expect(
      resolveServerGuard({
        server: "test2",
        servers: [SRV("runkit"), SRV("test2")],
        serversLoaded: true,
        pendingServer: "test2",
      }),
    ).toBe("render");
  });

  it("(b) not-found immediately for an unknown server when loaded and not pending", () => {
    expect(
      resolveServerGuard({
        server: "typo",
        servers: [SRV("runkit")],
        serversLoaded: true,
        pendingServer: null,
      }),
    ).toBe("notfound");
  });

  it("(c) never condemns before the first fetch settles", () => {
    expect(
      resolveServerGuard({
        server: "typo",
        servers: [],
        serversLoaded: false,
        pendingServer: null,
      }),
    ).toBe("render");
  });

  it("(A-015) not-found for a previously-pending server later deleted (pending cleared)", () => {
    // pendingServer was cleared to null after the server appeared+was removed.
    expect(
      resolveServerGuard({
        server: "test2",
        servers: [SRV("runkit")],
        serversLoaded: true,
        pendingServer: null,
      }),
    ).toBe("notfound");
  });
});

describe("ServerWaiting / ServerNotFound components", () => {
  it("ServerWaiting shows a waiting message referencing the server name + spinner", () => {
    const { container } = render(<ServerWaiting serverName="test2" />);
    expect(screen.getByText(/Creating/i)).toBeInTheDocument();
    expect(screen.getByText("test2")).toBeInTheDocument();
    // LogoSpinner renders an svg.
    expect(container.querySelector("svg")).toBeInTheDocument();
    // Reuses the centered full-screen layout idiom.
    expect(container.querySelector(".h-screen.bg-bg-primary")).toBeInTheDocument();
  });

  it("ServerNotFound shows the not-found message", () => {
    render(<ServerNotFound serverName="typo" />);
    expect(screen.getByText("Server not found")).toBeInTheDocument();
    expect(screen.getByText("typo")).toBeInTheDocument();
  });
});

describe("GuardHarness — lifecycle via StandaloneSessionContextProvider", () => {
  it("(a) shows ServerWaiting first, then the view, clearing pendingServer on appearance", () => {
    let pending: string | null = "test2";
    const markServerPending = (name: string | null) => {
      pending = name;
    };

    // Initial: serversLoaded, test2 pending and absent → ServerWaiting.
    const { rerender } = render(
      <StandaloneSessionContextProvider
        value={{
          servers: [SRV("runkit")],
          serversLoaded: true,
          pendingServer: pending,
          markServerPending,
        }}
      >
        <GuardHarness server="test2" />
      </StandaloneSessionContextProvider>,
    );
    expect(screen.getByText(/Creating/i)).toBeInTheDocument();
    expect(screen.queryByTestId("server-view")).not.toBeInTheDocument();

    // Refresh lands: test2 now present → effect clears pending, view renders.
    act(() => {
      rerender(
        <StandaloneSessionContextProvider
          value={{
            servers: [SRV("runkit"), SRV("test2")],
            serversLoaded: true,
            pendingServer: pending,
            markServerPending,
          }}
        >
          <GuardHarness server="test2" />
        </StandaloneSessionContextProvider>,
      );
    });

    expect(screen.getByTestId("server-view")).toBeInTheDocument();
    expect(screen.queryByText(/Creating/i)).not.toBeInTheDocument();
    // Clear-on-appearance fired.
    expect(pending).toBe(null);
  });

  it("(b) shows ServerNotFound immediately for an unknown server", () => {
    render(
      <StandaloneSessionContextProvider
        value={{ servers: [SRV("runkit")], serversLoaded: true, pendingServer: null }}
      >
        <GuardHarness server="typo" />
      </StandaloneSessionContextProvider>,
    );
    expect(screen.getByText("Server not found")).toBeInTheDocument();
    expect(screen.queryByText(/Creating/i)).not.toBeInTheDocument();
  });

  it("(c) shows neither error nor non-pending waiting before the first fetch settles", () => {
    render(
      <StandaloneSessionContextProvider
        value={{ servers: [], serversLoaded: false, pendingServer: null }}
      >
        <GuardHarness server="typo" />
      </StandaloneSessionContextProvider>,
    );
    expect(screen.queryByText("Server not found")).not.toBeInTheDocument();
    expect(screen.queryByText(/Creating/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("server-view")).toBeInTheDocument();
  });
});
