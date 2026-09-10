import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { CronEntry } from "@/api/client";
import { resetFlyoutWarmState } from "@/components/sidebar/row-flyout-card";
import { makeSession, makeWindow } from "@/test-utils/fixtures";
import { CronsZone } from "./crons-zone";

const NOW = Math.floor(Date.now() / 1000);

// The zone reads `Date.now()` at render; pin it to the fixture's `NOW` so the
// exact relative-time strings below cannot roll across a second boundary
// between module load and render.
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function makeEntry(overrides: Partial<CronEntry> = {}): CronEntry {
  return {
    id: "aaaa",
    name: "operator tick",
    schedule: { kind: "backoff", min: "60s", max: "30m" },
    target: { kind: "role", role: "operator" },
    payload: "tick",
    lastFired: 0,
    ...overrides,
  };
}

function renderZone(
  entries: CronEntry[],
  handlers: Partial<{
    onCreate: () => void;
    onMute: (entry: CronEntry) => void;
    onPin: (entry: CronEntry) => void;
    onDelete: (entry: CronEntry) => void;
  }> = {},
  sessions: Parameters<typeof CronsZone>[0]["sessions"] = [],
) {
  return render(
    <CronsZone
      entries={entries}
      sessions={sessions}
      onCreate={handlers.onCreate ?? vi.fn()}
      onMute={handlers.onMute ?? vi.fn()}
      onPin={handlers.onPin ?? vi.fn()}
      onDelete={handlers.onDelete ?? vi.fn()}
    />,
  );
}

beforeEach(resetFlyoutWarmState);
afterEach(() => {
  cleanup();
  resetFlyoutWarmState();
});

describe("CronsZone", () => {
  it("renders rows in registry order (due → scheduled → undated → orphaned → muted)", () => {
    renderZone([
      makeEntry({ id: "c", name: "muted-one", muted: true, nextFire: NOW + 120 }),
      makeEntry({ id: "a", name: "scheduled", nextFire: NOW + 300 }),
      makeEntry({ id: "e", name: "undated" }),
      makeEntry({ id: "b", name: "past-due", nextFire: NOW - 60 }),
      makeEntry({ id: "d", name: "orphan", orphaned: true }),
    ]);
    const names = screen
      .getAllByTestId("crons-row")
      .map((row) => row.querySelector("td")?.textContent);
    expect(names).toEqual(["past-due", "scheduled", "undated", "orphan", "muted-one"]);
  });

  it("renders the registry columns: target chip, plain-words schedule, state, last, next", () => {
    renderZone([
      makeEntry({
        id: "a",
        name: "operator tick",
        rung: 3,
        nextFire: NOW + 300,
        lastFired: NOW - 120,
      }),
    ]);
    const row = screen.getByTestId("crons-row");
    expect(row).toHaveTextContent("role: operator");
    expect(row).toHaveTextContent("backs off from 1 minute up to 30 minutes");
    expect(screen.getByTestId("crons-row-state")).toHaveTextContent("rung 3");
    expect(row).toHaveTextContent("2m ago ✓");
    expect(row).toHaveTextContent("in 5m");
  });

  it("marks the schedule cell with the deliver policy only when it is not immediate", () => {
    // Undated entries sort by name — the aaa/bbb/ccc names pin the row order.
    renderZone([
      makeEntry({ id: "a", name: "aaa-default", deliver: "immediate" }),
      makeEntry({ id: "b", name: "bbb-unset" }),
      makeEntry({ id: "c", name: "ccc-dropper", deliver: "skip-if-busy" }),
    ]);
    const rows = screen.getAllByTestId("crons-row");
    expect(rows[0].querySelector('[data-testid="crons-row-deliver"]')).toBeNull();
    expect(rows[1].querySelector('[data-testid="crons-row-deliver"]')).toBeNull();
    expect(rows[2].querySelector('[data-testid="crons-row-deliver"]')).toHaveTextContent(
      "skip-if-busy",
    );
  });

  it("dims and strikes muted/orphaned rows", () => {
    renderZone([makeEntry({ id: "a", name: "quiet", muted: true })]);
    const row = screen.getByTestId("crons-row");
    expect(row.className).toContain("opacity-50");
    expect(row.querySelector("td span")?.className).toContain("line-through");
  });

  it("reads the derived state column: held (busy) / due from the wire facts", () => {
    const sessions = [
      makeSession({
        windows: [makeWindow({ role: "operator", agentState: "active" })],
      }),
    ];
    renderZone(
      [makeEntry({ id: "a", deliver: "when-idle", nextFire: NOW - 30 })],
      {},
      sessions,
    );
    expect(screen.getByTestId("crons-row-state")).toHaveTextContent("held (busy)");
  });

  it("side slot omits zero counts and singularizes `1 entry`", () => {
    renderZone([
      makeEntry({ id: "a" }),
      makeEntry({ id: "b" }),
      makeEntry({ id: "c", muted: true }),
    ]);
    expect(screen.getByText("3 entries · 1 muted")).toBeInTheDocument();
    cleanup();
    renderZone([makeEntry({ id: "a" })]);
    expect(screen.getByText("1 entry")).toBeInTheDocument();
  });

  it("empty state reads `No cron entries` and still renders + New entry", () => {
    const onCreate = vi.fn();
    renderZone([], { onCreate });
    expect(screen.getByText("No cron entries")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("crons-new-entry"));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("+ New entry calls onCreate", () => {
    const onCreate = vi.fn();
    renderZone([makeEntry({ id: "a" })], { onCreate });
    fireEvent.click(screen.getByTestId("crons-new-entry"));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("keeps rows out of the tab order, and focusing the … button does not open the flyout", () => {
    renderZone([makeEntry({ id: "a" })]);
    expect(screen.getByTestId("crons-row")).not.toHaveAttribute("tabindex");
    fireEvent.focus(screen.getByTestId("crons-row-actions"));
    expect(screen.queryByTestId("row-flyout-card")).not.toBeInTheDocument();
  });

  it("the … button opens the row-flyout card; Unmute calls onMute with the entry and closes", () => {
    const entry = makeEntry({ id: "a", name: "quiet", muted: true });
    const onMute = vi.fn();
    renderZone([entry], { onMute });

    fireEvent.click(screen.getByTestId("crons-row-actions"));
    const mute = screen.getByTestId("row-flyout-mute-action");
    expect(mute).toHaveTextContent("Unmute");
    fireEvent.click(mute);

    expect(onMute).toHaveBeenCalledTimes(1);
    expect(onMute).toHaveBeenCalledWith(entry);
    expect(screen.queryByTestId("row-flyout-card")).not.toBeInTheDocument();
  });

  it("flyout Pin and Delete (danger) call their handlers", () => {
    const entry = makeEntry({ id: "a" });
    const onPin = vi.fn();
    const onDelete = vi.fn();
    renderZone([entry], { onPin, onDelete });

    fireEvent.click(screen.getByTestId("crons-row-actions"));
    fireEvent.click(screen.getByTestId("row-flyout-pin-action"));
    expect(onPin).toHaveBeenCalledWith(entry);

    fireEvent.click(screen.getByTestId("crons-row-actions"));
    const del = screen.getByTestId("row-flyout-delete-action");
    expect(del.className).toContain("hover:text-signal-red");
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledWith(entry);
  });
});
