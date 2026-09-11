import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { makeSession, makeWindow } from "@/test-utils/fixtures";
import { WatchedTasks } from "./watched-tasks";

const NOW = Math.floor(Date.now() / 1000);

// The component reads `Date.now()` at render; pin it to the fixture's `NOW`
// so the relative-time strings below cannot roll across a second boundary.
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderTasks(
  opts: Partial<Parameters<typeof WatchedTasks>[0]> & { server: string },
) {
  return render(
    <WatchedTasks
      server={opts.server}
      sessions={opts.sessions ?? []}
      onNavigate={opts.onNavigate ?? vi.fn()}
      dense={opts.dense ?? false}
    />,
  );
}

const MONITORED = makeWindow({
  windowId: "@1",
  name: "worker-one",
  monitored: true,
  monitoredChange: "wuiu",
  monitoredStage: "review",
  monitoredRepo: "/home/user/code/run-kit",
  agentState: "waiting",
  agentIdleDuration: "6m",
});

describe("WatchedTasks", () => {
  it("renders the watched rows and navigates on a row click", () => {
    const onNavigate = vi.fn();
    renderTasks({
      server: "srv1",
      onNavigate,
      sessions: [
        makeSession({ name: "dev", operatorLastTickAt: NOW - 30, windows: [MONITORED] }),
        makeSession({ name: "_rk-operator", windows: [makeWindow({ role: "operator" })] }),
      ],
    });

    expect(screen.getByTestId("watched-tasks")).toBeInTheDocument();
    expect(screen.getAllByTestId("watched-row")).toHaveLength(1);
    expect(screen.getByText("worker-one")).toBeInTheDocument();
    expect(screen.queryByTestId("watched-tasks-hint")).toBeNull();
    expect(screen.queryByTestId("watched-tasks-banner")).toBeNull();

    fireEvent.click(screen.getByTestId("watched-row-navigate"));
    expect(onNavigate).toHaveBeenCalledWith("@1");
  });

  it("shows the pinned banner with the tick age when the watchlist is stale, and dims the table", () => {
    renderTasks({
      server: "srv1",
      sessions: [
        makeSession({
          name: "dev",
          operatorStale: true,
          operatorLastTickAt: NOW - 20 * 60,
          windows: [MONITORED],
        }),
      ],
    });

    const banner = screen.getByTestId("watched-tasks-banner");
    expect(banner).toHaveTextContent("operator tick — last seen 20m ago");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner.className).toContain("text-signal-yellow");
    // The stale verdict passes through to the table's dimming.
    expect(screen.getByTestId("watched-table").className).toContain("opacity-50");
  });

  it("reads `no recent tick` when stale but no session carries a tick", () => {
    renderTasks({
      server: "srv1",
      sessions: [makeSession({ operatorStale: true, windows: [MONITORED] })],
    });
    expect(screen.getByTestId("watched-tasks-banner")).toHaveTextContent(
      "operator tick — no recent tick",
    );
  });

  it("an empty server renders only the `no server resolved` hint", () => {
    renderTasks({ server: "", sessions: [] });
    expect(screen.getByTestId("watched-tasks-hint")).toHaveTextContent(
      "no server resolved — watchlist unavailable",
    );
    expect(screen.queryByTestId("watched-tasks-banner")).toBeNull();
    expect(screen.queryByTestId("watched-table")).toBeNull();
  });

  it("no operator window and no tick renders `No operator on this server`", () => {
    renderTasks({
      server: "srv1",
      sessions: [makeSession({ windows: [makeWindow({ windowId: "@1" })] })],
    });
    expect(screen.getByTestId("watched-tasks-hint")).toHaveTextContent(
      "No operator on this server",
    );
  });

  it("an operator with zero monitored windows renders `No watched workers`", () => {
    renderTasks({
      server: "srv1",
      sessions: [
        makeSession({
          operatorLastTickAt: NOW - 10,
          windows: [makeWindow({ windowId: "@9", role: "operator" })],
        }),
      ],
    });
    expect(screen.getByTestId("watched-tasks-hint")).toHaveTextContent("No watched workers");
  });

  it("passes dense through to the table padding", () => {
    renderTasks({
      server: "srv1",
      dense: true,
      sessions: [makeSession({ name: "dev", windows: [MONITORED] })],
    });
    const row = screen.getByTestId("watched-row");
    expect(row.querySelectorAll("td")[0].className).toContain("py-0.5");
  });
});
