import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { ConsoleSegments, TerminalActivityTabs, SEGMENTS } from "./terminal-activity-tabs";
import { validateTerminalSearch } from "@/lib/router-url";

// The wrapper drives the router `tab` search param; navigations are recorded.
let mockSearch: Record<string, unknown> = {};
const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => mockSearch,
}));

beforeEach(() => {
  mockSearch = {};
  mockNavigate.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ConsoleSegments (controlled strip)", () => {
  it("renders the four segments in order: Operator Terminal, Operator Tasks, Cron List, Cron Log", () => {
    render(<ConsoleSegments value="terminal" onChange={() => {}} />);

    const strip = screen.getByTestId("terminal-activity-tabs");
    expect(strip).toHaveAttribute("role", "tablist");
    const tabs = within(strip).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Operator Terminal",
      "Operator Tasks",
      "Cron List",
      "Cron Log",
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(tabs[2]).toHaveAttribute("aria-selected", "false");
    expect(tabs[3]).toHaveAttribute("aria-selected", "false");
  });

  it("sizes labels for the four-label set: nowrap, no truncation, content-sized", () => {
    render(<ConsoleSegments value="terminal" onChange={() => {}} />);

    for (const tab of screen.getAllByRole("tab")) {
      expect(tab.className).toContain("whitespace-nowrap");
      expect(tab.className).not.toContain("truncate");
      // Content-sized (shrink-0, no equal-share flex-1) so no label can be
      // squeezed below its content width.
      expect(tab.className).toContain("shrink-0");
      expect(tab.className).not.toContain("flex-1");
    }
  });

  it("calls onChange with the clicked tab and leaves selection to the owner (controlled)", () => {
    const onChange = vi.fn();
    render(<ConsoleSegments value="terminal" onChange={onChange} />);

    fireEvent.click(screen.getByRole("tab", { name: "Operator Tasks" }));
    expect(onChange).toHaveBeenCalledWith("tasks");
    fireEvent.click(screen.getByRole("tab", { name: "Cron List" }));
    expect(onChange).toHaveBeenCalledWith("list");
    // Controlled: without a value change the selection does not move.
    expect(screen.getByRole("tab", { name: "Operator Terminal" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("renders Cron Log selected when the value prop says so", () => {
    render(<ConsoleSegments value="log" onChange={() => {}} />);

    expect(screen.getByRole("tab", { name: "Cron Log" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Operator Terminal" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("the segment union agrees with the tab values validateTerminalSearch accepts", () => {
    // The strip's SEGMENTS, `OperatorConsoleRequest.segment`, and router-url.ts's
    // literal union are three spellings of the same set — this guard fails the
    // moment any one of them drifts (a probe of candidate values is the only
    // way to read the leaf module's accepted set). The legacy `activity`
    // alias normalizes to `log`, so it must NOT be in the accepted set.
    const candidates = ["terminal", "tasks", "list", "log", "activity", "bogus", ""];
    const accepted = candidates.filter((v) => validateTerminalSearch({ tab: v }).tab === v);
    expect(SEGMENTS.map((s) => s.tab)).toEqual(accepted);
  });
});

describe("TerminalActivityTabs (router-driven wrapper)", () => {
  it("reads the active tab from the ?tab= search param (absent = terminal)", () => {
    mockSearch = { tab: "log" };
    render(<TerminalActivityTabs />);
    expect(screen.getByRole("tab", { name: "Cron Log" })).toHaveAttribute("aria-selected", "true");
    cleanup();

    mockSearch = { tab: "list" };
    render(<TerminalActivityTabs />);
    expect(screen.getByRole("tab", { name: "Cron List" })).toHaveAttribute("aria-selected", "true");
    cleanup();

    mockSearch = { tab: "tasks" };
    render(<TerminalActivityTabs />);
    expect(screen.getByRole("tab", { name: "Operator Tasks" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    cleanup();

    mockSearch = {};
    render(<TerminalActivityTabs />);
    expect(screen.getByRole("tab", { name: "Operator Terminal" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("a segment click writes the tab search param in place (to: '.', replace)", () => {
    mockSearch = { from: "@1" };
    render(<TerminalActivityTabs />);

    fireEvent.click(screen.getByRole("tab", { name: "Cron List" }));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0][0] as {
      to: string;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
      replace: boolean;
    };
    expect(call.to).toBe(".");
    expect(call.replace).toBe(true);
    // The updater merges over the existing search — the ?from= survives.
    expect(call.search({ from: "@1" })).toEqual({ from: "@1", tab: "list" });
  });
});
