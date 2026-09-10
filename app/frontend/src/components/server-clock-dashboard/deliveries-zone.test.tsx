import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { CronDelivery } from "@/api/client";
import { DeliveriesZone } from "./deliveries-zone";

function makeDelivery(overrides: Partial<CronDelivery> = {}): CronDelivery {
  return {
    ts: Math.floor(Date.now() / 1000),
    entry: "aaaa",
    name: "operator tick",
    target: "%1",
    reason: "schedule",
    outcome: "delivered",
    ...overrides,
  };
}

afterEach(cleanup);

describe("DeliveriesZone", () => {
  it("renders rows newest-first as served: HH:MM · name → outcome", () => {
    const first = new Date();
    first.setHours(14, 2, 0, 0);
    render(
      <DeliveriesZone
        deliveries={[
          makeDelivery({ ts: first.getTime() / 1000, outcome: "delivered" }),
          makeDelivery({ entry: "bbbb", name: "nightly", outcome: "missed" }),
        ]}
      />,
    );
    const rows = screen.getAllByTestId("delivery-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("14:02 · operator tick → delivered ✓");
    expect(rows[1]).toHaveTextContent("nightly → missed");
  });

  it("renders `(deleted entry)` when the delivery's name is empty", () => {
    render(<DeliveriesZone deliveries={[makeDelivery({ name: "" })]} />);
    expect(screen.getByTestId("delivery-row")).toHaveTextContent("(deleted entry)");
  });

  it("renders failure outcomes verbatim in signal red", () => {
    render(
      <DeliveriesZone deliveries={[makeDelivery({ outcome: "respawn-failed: exit 1" })]} />,
    );
    const row = screen.getByTestId("delivery-row");
    expect(row).toHaveTextContent("respawn-failed: exit 1");
    expect(row.querySelector(".text-signal-red")).not.toBeNull();
  });

  it("renders day dividers only when the log spans days, labelled today/yesterday", () => {
    const today = new Date();
    today.setHours(14, 2, 0, 0);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 50, 0, 0);
    render(
      <DeliveriesZone
        deliveries={[
          makeDelivery({ ts: today.getTime() / 1000 }),
          makeDelivery({ ts: yesterday.getTime() / 1000, outcome: "respawn-failed: exit 1" }),
        ]}
      />,
    );
    const dividers = screen.getAllByTestId("delivery-day-divider");
    expect(dividers.map((d) => d.textContent)).toEqual(["today", "yesterday"]);
    cleanup();

    // A single-day log renders no dividers.
    render(
      <DeliveriesZone
        deliveries={[makeDelivery({ ts: today.getTime() / 1000 }), makeDelivery()]}
      />,
    );
    expect(screen.queryAllByTestId("delivery-day-divider")).toHaveLength(0);
  });

  it("side slot reports the newest delivery's age; empty state shows none", () => {
    const ts = Math.floor(Date.now() / 1000) - 300;
    render(<DeliveriesZone deliveries={[makeDelivery({ ts })]} />);
    expect(screen.getByText("last 5m ago")).toBeInTheDocument();
    cleanup();

    render(<DeliveriesZone deliveries={[]} />);
    expect(screen.getByText("No deliveries yet")).toBeInTheDocument();
    expect(screen.queryByText(/last .* ago/)).toBeNull();
  });
});
