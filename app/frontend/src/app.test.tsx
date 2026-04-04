import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";

/**
 * Tests for move window CmdK actions (T010).
 *
 * These test the action generation logic as it would appear in the palette:
 * - "Window: Move Left" present when not at min index, absent at min
 * - "Window: Move Right" present when not at max index, absent at max
 * - onSelect calls the expected move function
 */

function openPalette() {
  fireEvent.keyDown(document, { key: "k", metaKey: true });
}

/** Build windowActions matching the pattern in app.tsx. */
function buildWindowActions(opts: {
  currentWindowIndex: number;
  minIndex: number;
  maxIndex: number;
  onMoveLeft: () => void;
  onMoveRight: () => void;
}): PaletteAction[] {
  const actions: PaletteAction[] = [];
  if (opts.currentWindowIndex > opts.minIndex) {
    actions.push({
      id: "move-window-left",
      label: "Window: Move Left",
      onSelect: opts.onMoveLeft,
    });
  }
  if (opts.currentWindowIndex < opts.maxIndex) {
    actions.push({
      id: "move-window-right",
      label: "Window: Move Right",
      onSelect: opts.onMoveRight,
    });
  }
  return actions;
}

describe("CmdK Move Window Actions", () => {
  afterEach(cleanup);

  it("shows Move Left and Move Right when window is in the middle", () => {
    const onMoveLeft = vi.fn();
    const onMoveRight = vi.fn();
    const actions = buildWindowActions({
      currentWindowIndex: 1,
      minIndex: 0,
      maxIndex: 2,
      onMoveLeft,
      onMoveRight,
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.getByText("Window: Move Left")).toBeInTheDocument();
    expect(screen.getByText("Window: Move Right")).toBeInTheDocument();
  });

  it("hides Move Left when window is at min index", () => {
    const actions = buildWindowActions({
      currentWindowIndex: 0,
      minIndex: 0,
      maxIndex: 2,
      onMoveLeft: vi.fn(),
      onMoveRight: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText("Window: Move Left")).not.toBeInTheDocument();
    expect(screen.getByText("Window: Move Right")).toBeInTheDocument();
  });

  it("hides Move Right when window is at max index", () => {
    const actions = buildWindowActions({
      currentWindowIndex: 2,
      minIndex: 0,
      maxIndex: 2,
      onMoveLeft: vi.fn(),
      onMoveRight: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.getByText("Window: Move Left")).toBeInTheDocument();
    expect(screen.queryByText("Window: Move Right")).not.toBeInTheDocument();
  });

  it("hides both when session has only one window", () => {
    const actions = buildWindowActions({
      currentWindowIndex: 0,
      minIndex: 0,
      maxIndex: 0,
      onMoveLeft: vi.fn(),
      onMoveRight: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText("Window: Move Left")).not.toBeInTheDocument();
    expect(screen.queryByText("Window: Move Right")).not.toBeInTheDocument();
  });

  it("Move Left onSelect fires correctly", () => {
    const onMoveLeft = vi.fn();
    const actions = buildWindowActions({
      currentWindowIndex: 1,
      minIndex: 0,
      maxIndex: 2,
      onMoveLeft,
      onMoveRight: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    // Filter to Move Left, then Enter
    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "Move Left" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onMoveLeft).toHaveBeenCalledOnce();
  });

  it("Move Right onSelect fires correctly", () => {
    const onMoveRight = vi.fn();
    const actions = buildWindowActions({
      currentWindowIndex: 1,
      minIndex: 0,
      maxIndex: 2,
      onMoveLeft: vi.fn(),
      onMoveRight,
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "Move Right" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onMoveRight).toHaveBeenCalledOnce();
  });
});
