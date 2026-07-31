import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { ShellBadgeReporter } from "./shell-badge-reporter";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import type { ProjectSession, WindowInfo } from "@/types";

function win(agentState?: string): WindowInfo {
  return {
    windowId: "@0",
    index: 0,
    name: "w",
    worktreePath: "/p",
    activity: "idle",
    isActiveWindow: false,
    activityTimestamp: 0,
    agentState,
  };
}

function byServer(states: Record<string, (string | undefined)[]>): Map<string, ProjectSession[]> {
  return new Map(
    Object.entries(states).map(([server, windows]) => [
      server,
      [{ name: "s", windows: windows.map(win) }],
    ]),
  );
}

function bridgeWithBadge(): ReturnType<typeof vi.fn> {
  const set = vi.fn().mockResolvedValue({ ok: true });
  window.runkitShell = { version: "1.2.3", platform: "darwin", badge: { set } };
  return set;
}

function renderReporter(sessions: Map<string, ProjectSession[]>) {
  return render(
    <StandaloneSessionContextProvider value={{ sessionsByServer: sessions }}>
      <ShellBadgeReporter />
    </StandaloneSessionContextProvider>,
  );
}

afterEach(() => {
  cleanup();
  delete window.runkitShell;
});

describe("ShellBadgeReporter", () => {
  it("reports the waiting count across servers on mount", async () => {
    const set = bridgeWithBadge();
    renderReporter(byServer({ alpha: ["waiting", "active"], beta: ["waiting"] }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(2));
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("reports 0 explicitly so clears propagate", async () => {
    const set = bridgeWithBadge();
    const { rerender } = renderReporter(byServer({ alpha: ["waiting"] }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(1));
    rerender(
      <StandaloneSessionContextProvider value={{ sessionsByServer: byServer({ alpha: ["idle"] }) }}>
        <ShellBadgeReporter />
      </StandaloneSessionContextProvider>,
    );
    await waitFor(() => expect(set).toHaveBeenCalledWith(0));
    expect(set).toHaveBeenCalledTimes(2);
  });

  it("does not re-report an unchanged count (change-only reporting)", async () => {
    const set = bridgeWithBadge();
    const { rerender } = renderReporter(byServer({ alpha: ["waiting"] }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(1));
    // A fresh (different-identity) map with the SAME derived count.
    rerender(
      <StandaloneSessionContextProvider
        value={{ sessionsByServer: byServer({ alpha: ["waiting", "idle"] }) }}
      >
        <ShellBadgeReporter />
      </StandaloneSessionContextProvider>,
    );
    // Effects have flushed by now; the count is still 1 → no second call.
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("renders nothing and never throws in a plain browser (no bridge)", () => {
    const { container } = renderReporter(byServer({ alpha: ["waiting"] }));
    expect(container.innerHTML).toBe("");
  });
});
