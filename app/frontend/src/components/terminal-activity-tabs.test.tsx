import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { ConsoleSegments, TerminalActivityTabs } from "./terminal-activity-tabs";

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
  it("renders both tabs with aria-selected following the value prop", () => {
    render(<ConsoleSegments value="terminal" onChange={() => {}} />);

    const strip = screen.getByTestId("terminal-activity-tabs");
    expect(strip).toHaveAttribute("role", "tablist");
    expect(within(strip).getByRole("tab", { name: "Terminal" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(strip).getByRole("tab", { name: "Activity" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("calls onChange with the clicked tab and leaves selection to the owner (controlled)", () => {
    const onChange = vi.fn();
    render(<ConsoleSegments value="terminal" onChange={onChange} />);

    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
    expect(onChange).toHaveBeenCalledWith("activity");
    // Controlled: without a value change the selection does not move.
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
  });

  it("renders Activity selected when the value prop says so", () => {
    render(<ConsoleSegments value="activity" onChange={() => {}} />);

    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "false");
  });
});

describe("TerminalActivityTabs (router-driven wrapper)", () => {
  it("reads the active tab from the ?tab= search param (absent = terminal)", () => {
    mockSearch = { tab: "activity" };
    render(<TerminalActivityTabs />);

    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
    cleanup();

    mockSearch = {};
    render(<TerminalActivityTabs />);
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
  });

  it("a segment click writes the tab search param in place (to: '.', replace)", () => {
    mockSearch = { from: "@1" };
    render(<TerminalActivityTabs />);

    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0][0] as {
      to: string;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
      replace: boolean;
    };
    expect(call.to).toBe(".");
    expect(call.replace).toBe(true);
    // The updater merges over the existing search — the ?from= survives.
    expect(call.search({ from: "@1" })).toEqual({ from: "@1", tab: "activity" });
  });
});
