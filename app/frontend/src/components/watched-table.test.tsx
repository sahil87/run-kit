import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { makeWindow } from "@/test-utils/fixtures";
import { NOTE_STALE_SECONDS } from "@/components/sidebar/row-flyout-card";
import { WatchedTable } from "./watched-table";

const NOW = 1_800_000_000;

afterEach(cleanup);

function renderTable(
  rows: Parameters<typeof WatchedTable>[0]["rows"],
  opts: { stale?: boolean; onNavigate?: (windowId: string) => void; dense?: boolean } = {},
) {
  return render(
    <WatchedTable
      rows={rows}
      stale={opts.stale ?? false}
      nowSeconds={NOW}
      onNavigate={opts.onNavigate ?? vi.fn()}
      dense={opts.dense ?? false}
    />,
  );
}

describe("WatchedTable", () => {
  it("renders one row per entry with the six columns, and navigates on name click", () => {
    const onNavigate = vi.fn();
    renderTable(
      [
        {
          session: "dev",
          win: makeWindow({
            windowId: "@1",
            name: "worker-one",
            monitored: true,
            monitoredChange: "wuiu",
            monitoredStage: "review",
            monitoredRepo: "/home/user/code/run-kit",
            agentState: "waiting",
            agentIdleDuration: "6m",
          }),
        },
        { session: "ops", win: makeWindow({ windowId: "@3", name: "worker-two" }) },
      ],
      { onNavigate },
    );

    const rows = screen.getAllByTestId("watched-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("worker-one")).toBeInTheDocument();
    expect(screen.getByText("worker-two")).toBeInTheDocument();
    // The six headers.
    for (const col of ["status", "session", "change", "awaiting", "note", "repo"]) {
      expect(screen.getByText(col)).toBeInTheDocument();
    }

    fireEvent.click(screen.getAllByTestId("watched-row-navigate")[0]);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("@1");
  });

  it("renders the registry cells: change + stage badge, awaiting, note, repo basename", () => {
    renderTable([
      {
        session: "dev",
        win: makeWindow({
          windowId: "@1",
          monitored: true,
          monitoredChange: "wuiu",
          monitoredStage: "review",
          monitoredRepo: "/home/user/code/run-kit",
          agentState: "waiting",
          agentIdleDuration: "6m",
          note: "blocked on flaky e2e",
          noteEpoch: NOW - 3600,
        }),
      },
    ]);

    expect(screen.getByText("dev")).toBeInTheDocument();
    expect(screen.getByText("wuiu")).toBeInTheDocument();
    expect(screen.getByText("review").className).toContain("bg-accent/10");
    expect(screen.getByText("waiting 6m").className).toContain("text-signal-yellow");
    expect(screen.getByText(/blocked on flaky e2e · 1h ago/)).toBeInTheDocument();
    expect(screen.getByText("run-kit")).toBeInTheDocument();
  });

  it("dims the whole table when stale", () => {
    renderTable([{ session: "dev", win: makeWindow({ windowId: "@1", monitored: true }) }], {
      stale: true,
    });
    expect(screen.getByTestId("watched-table").className).toContain("opacity-50");
  });

  it("dims a note older than NOTE_STALE_SECONDS", () => {
    renderTable([
      {
        session: "dev",
        win: makeWindow({
          windowId: "@1",
          monitored: true,
          note: "old note",
          noteEpoch: NOW - NOTE_STALE_SECONDS - 60,
        }),
      },
    ]);
    const noteCell = screen.getByText(/old note/).closest("td");
    expect(noteCell?.className).toContain("opacity-50");
  });

  it("renders — for absent facets and unknown agent state", () => {
    renderTable([{ session: "dev", win: makeWindow({ windowId: "@1", monitored: true }) }]);
    const row = screen.getByTestId("watched-row");
    expect(row.querySelectorAll("td")[2]).toHaveTextContent("—");
    expect(row.querySelectorAll("td")[3]).toHaveTextContent("—");
    expect(row.querySelectorAll("td")[4]).toHaveTextContent("—");
    expect(row.querySelectorAll("td")[5]).toHaveTextContent("—");
  });

  it("the dense variant tightens cell and header padding (py-0.5 / pr-2), columns kept", () => {
    renderTable([{ session: "dev", win: makeWindow({ windowId: "@1", monitored: true }) }], {
      dense: true,
    });

    const header = screen.getByText("status");
    expect(header.className).toContain("pr-2");
    expect(header.className).not.toContain("pr-3");
    const row = screen.getByTestId("watched-row");
    const cells = row.querySelectorAll("td");
    expect(cells).toHaveLength(6);
    expect(cells[0].className).toContain("py-0.5");
    expect(cells[0].className).toContain("pr-2");
    expect(cells[5].className).toContain("py-0.5");
  });

  it("the default variant keeps the Server page padding (py-1 / pr-3)", () => {
    renderTable([{ session: "dev", win: makeWindow({ windowId: "@1", monitored: true }) }]);
    const row = screen.getByTestId("watched-row");
    expect(row.querySelectorAll("td")[0].className).toContain("py-1");
    expect(row.querySelectorAll("td")[0].className).toContain("pr-3");
  });
});
