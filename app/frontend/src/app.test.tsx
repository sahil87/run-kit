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

/** Build move-to-session actions matching the pattern in app.tsx. */
function buildMoveToSessionActions(opts: {
  sessions: { name: string }[];
  currentSession: string | null;
  hasCurrentWindow: boolean;
  onMove: (targetSession: string) => void;
}): PaletteAction[] {
  if (!opts.hasCurrentWindow || !opts.currentSession || opts.sessions.length < 2) {
    return [];
  }
  return opts.sessions
    .filter((s) => s.name !== opts.currentSession)
    .map((s) => ({
      id: `move-window-to-session-${s.name}`,
      label: `Window: Move to ${s.name}`,
      onSelect: () => opts.onMove(s.name),
    }));
}

describe("CmdK Move Window to Session Actions", () => {
  afterEach(cleanup);

  it("shows one Move to action when two sessions exist", () => {
    const onMove = vi.fn();
    const actions = buildMoveToSessionActions({
      sessions: [{ name: "alpha" }, { name: "bravo" }],
      currentSession: "alpha",
      hasCurrentWindow: true,
      onMove,
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.getByText("Window: Move to bravo")).toBeInTheDocument();
    expect(screen.queryByText("Window: Move to alpha")).not.toBeInTheDocument();
  });

  it("shows two Move to actions when three sessions exist", () => {
    const onMove = vi.fn();
    const actions = buildMoveToSessionActions({
      sessions: [{ name: "alpha" }, { name: "bravo" }, { name: "charlie" }],
      currentSession: "alpha",
      hasCurrentWindow: true,
      onMove,
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.getByText("Window: Move to bravo")).toBeInTheDocument();
    expect(screen.getByText("Window: Move to charlie")).toBeInTheDocument();
    expect(screen.queryByText("Window: Move to alpha")).not.toBeInTheDocument();
  });

  it("shows no Move to actions when only one session exists", () => {
    const onMove = vi.fn();
    const actions = buildMoveToSessionActions({
      sessions: [{ name: "alpha" }],
      currentSession: "alpha",
      hasCurrentWindow: true,
      onMove,
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText(/Window: Move to/)).not.toBeInTheDocument();
  });

  it("shows no Move to actions when no window is selected", () => {
    const onMove = vi.fn();
    const actions = buildMoveToSessionActions({
      sessions: [{ name: "alpha" }, { name: "bravo" }],
      currentSession: "alpha",
      hasCurrentWindow: false,
      onMove,
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText(/Window: Move to/)).not.toBeInTheDocument();
  });

  it("onSelect fires with correct target session", () => {
    const onMove = vi.fn();
    const actions = buildMoveToSessionActions({
      sessions: [{ name: "alpha" }, { name: "bravo" }],
      currentSession: "alpha",
      hasCurrentWindow: true,
      onMove,
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "Move to bravo" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onMove).toHaveBeenCalledWith("bravo");
  });
});
