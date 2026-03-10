import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";

function makeActions(labels: string[]): PaletteAction[] {
  return labels.map((label, i) => ({
    id: `action-${i}`,
    label,
    onSelect: vi.fn(),
  }));
}

function openPalette() {
  fireEvent.keyDown(document, { key: "k", metaKey: true });
}

describe("CommandPalette", () => {
  afterEach(() => {
    cleanup();
  });

  it("is hidden by default", () => {
    const actions = makeActions(["New Session", "Kill Window"]);
    const { container } = render(<CommandPalette actions={actions} />);
    expect(container.innerHTML).toBe("");
  });

  it("opens on Cmd+K", () => {
    const actions = makeActions(["New Session"]);
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.getByPlaceholderText("Type a command...")).toBeInTheDocument();
  });

  it("focuses the search input when opened", () => {
    const actions = makeActions(["New Session"]);
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.getByPlaceholderText("Type a command...")).toHaveFocus();
  });

  it("opens on Ctrl+K", () => {
    const actions = makeActions(["New Session"]);
    render(<CommandPalette actions={actions} />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText("Type a command...")).toBeInTheDocument();
  });

  it("filters actions by search query (case-insensitive)", () => {
    const actions = makeActions(["New Session", "Kill Window", "New Window"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "new" } });

    expect(screen.getByText("New Session")).toBeInTheDocument();
    expect(screen.getByText("New Window")).toBeInTheDocument();
    expect(screen.queryByText("Kill Window")).not.toBeInTheDocument();
  });

  it("shows 'No results' when filter matches nothing", () => {
    const actions = makeActions(["New Session"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "zzzzz" } });

    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("selects action with Enter and closes palette", () => {
    const actions = makeActions(["New Session", "Kill Window"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(actions[0].onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByPlaceholderText("Type a command...")).not.toBeInTheDocument();
  });

  it("navigates with ArrowDown and ArrowUp", () => {
    const actions = makeActions(["First", "Second", "Third"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText("Type a command...");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(actions[2].onSelect).toHaveBeenCalledOnce();
  });

  it("ArrowUp from first item stays at first", () => {
    const actions = makeActions(["First", "Second"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(actions[0].onSelect).toHaveBeenCalledOnce();
  });

  it("closes on Escape", () => {
    const actions = makeActions(["New Session"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByPlaceholderText("Type a command...")).not.toBeInTheDocument();
  });

  it("closes on backdrop click", () => {
    const actions = makeActions(["New Session"]);
    render(<CommandPalette actions={actions} />);
    openPalette();

    fireEvent.click(screen.getByTestId("palette-overlay"));

    expect(screen.queryByPlaceholderText("Type a command...")).not.toBeInTheDocument();
  });

  it("renders shortcut badges when provided", () => {
    const actions: PaletteAction[] = [
      { id: "a1", label: "New Session", shortcut: "N", onSelect: vi.fn() },
    ];
    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.getByText("N")).toBeInTheDocument();
  });

  it("toggles closed with second Cmd+K", () => {
    const actions = makeActions(["New Session"]);
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.getByPlaceholderText("Type a command...")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.queryByPlaceholderText("Type a command...")).not.toBeInTheDocument();
  });
});
