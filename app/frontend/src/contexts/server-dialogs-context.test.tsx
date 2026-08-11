import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ServerDialogsProvider, useServerDialogs } from "./server-dialogs-context";

function Probe() {
  const {
    createServerOpen,
    killServerTarget,
    openCreateServer,
    requestKillServer,
    closeCreateServer,
    clearKillServerTarget,
  } = useServerDialogs();
  return (
    <div>
      <span data-testid="create">{createServerOpen ? "open" : "closed"}</span>
      <span data-testid="kill">{killServerTarget ?? "none"}</span>
      <button onClick={openCreateServer}>open-create</button>
      <button onClick={closeCreateServer}>close-create</button>
      <button onClick={() => requestKillServer("rk")}>kill-rk</button>
      <button onClick={clearKillServerTarget}>clear-kill</button>
    </div>
  );
}

describe("ServerDialogsContext", () => {
  afterEach(cleanup);

  it("starts closed; openCreateServer/closeCreateServer toggle the create dialog", () => {
    render(
      <ServerDialogsProvider>
        <Probe />
      </ServerDialogsProvider>,
    );
    expect(screen.getByTestId("create").textContent).toBe("closed");
    fireEvent.click(screen.getByText("open-create"));
    expect(screen.getByTestId("create").textContent).toBe("open");
    fireEvent.click(screen.getByText("close-create"));
    expect(screen.getByTestId("create").textContent).toBe("closed");
  });

  it("requestKillServer sets the target; clearKillServerTarget resets it", () => {
    render(
      <ServerDialogsProvider>
        <Probe />
      </ServerDialogsProvider>,
    );
    expect(screen.getByTestId("kill").textContent).toBe("none");
    fireEvent.click(screen.getByText("kill-rk"));
    expect(screen.getByTestId("kill").textContent).toBe("rk");
    fireEvent.click(screen.getByText("clear-kill"));
    expect(screen.getByTestId("kill").textContent).toBe("none");
  });

  it("triggers are referentially stable across state changes", () => {
    const seen: unknown[] = [];
    function StabilityProbe() {
      const { openCreateServer, requestKillServer } = useServerDialogs();
      seen.push(openCreateServer, requestKillServer);
      return (
        <button onClick={() => {
          openCreateServer();
          requestKillServer("rk");
        }}>
          fire
        </button>
      );
    }
    render(
      <ServerDialogsProvider>
        <StabilityProbe />
      </ServerDialogsProvider>,
    );
    fireEvent.click(screen.getByText("fire"));
    expect(seen.length).toBeGreaterThan(2);
    expect(new Set(seen.filter((_, i) => i % 2 === 0)).size).toBe(1);
    expect(new Set(seen.filter((_, i) => i % 2 === 1)).size).toBe(1);
  });

  it("useServerDialogs throws outside the provider", () => {
    // Silence React's error boundary noise for the expected throw.
    const spy = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Probe />)).toThrow(
        "useServerDialogs must be used within ServerDialogsProvider",
      );
    } finally {
      console.error = spy;
    }
  });
});
