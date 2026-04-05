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

/**
 * Tests for quick session/window launch actions (260405-gle4-quick-session-launch).
 *
 * These test the session/window creation action generation logic as it would
 * appear in the palette — mirrors the pattern used by the move-window tests above.
 */

/** Build sessionActions matching the pattern in app.tsx. */
function buildSessionActions(opts: {
  sessionName: string | undefined;
  onCreateInstant: () => void;
  onCreateAtFolder: () => void;
  onRenameSession?: () => void;
  onKillSession?: () => void;
}): PaletteAction[] {
  const actions: PaletteAction[] = [
    { id: "create-session", label: "Session: Create", onSelect: opts.onCreateInstant },
    { id: "create-session-at-folder", label: "Session: Create at Folder", onSelect: opts.onCreateAtFolder },
  ];
  if (opts.sessionName) {
    actions.push(
      { id: "rename-session", label: "Session: Rename", onSelect: opts.onRenameSession ?? vi.fn() },
      { id: "kill-session", label: "Session: Kill", onSelect: opts.onKillSession ?? vi.fn() },
    );
  }
  return actions;
}

/** Build window creation actions matching the pattern in app.tsx. */
function buildWindowCreationActions(opts: {
  sessionName: string | undefined;
  onCreateWindow: () => void;
  onCreateWindowAtFolder: () => void;
}): PaletteAction[] {
  if (!opts.sessionName) return [];
  return [
    { id: "create-window", label: "Window: Create", onSelect: opts.onCreateWindow },
    { id: "create-window-at-folder", label: "Window: Create at Folder", onSelect: opts.onCreateWindowAtFolder },
  ];
}

describe("CmdK Session Creation Actions", () => {
  afterEach(cleanup);

  it("Session: Create triggers instant creation (calls onCreateInstant, not a dialog)", () => {
    const onCreateInstant = vi.fn();
    const onCreateAtFolder = vi.fn();
    const actions = buildSessionActions({ sessionName: undefined, onCreateInstant, onCreateAtFolder });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "Session: Create" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreateInstant).toHaveBeenCalledOnce();
    expect(onCreateAtFolder).not.toHaveBeenCalled();
  });

  it("Session: Create at Folder appears in palette and calls onCreateAtFolder", () => {
    const onCreateInstant = vi.fn();
    const onCreateAtFolder = vi.fn();
    const actions = buildSessionActions({ sessionName: "my-session", onCreateInstant, onCreateAtFolder });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "Create at Folder" } });

    expect(screen.getByText("Session: Create at Folder")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreateAtFolder).toHaveBeenCalledOnce();
    expect(onCreateInstant).not.toHaveBeenCalled();
  });

  it("both Session: Create and Session: Create at Folder appear when searching 'create'", () => {
    const actions = buildSessionActions({
      sessionName: "my-session",
      onCreateInstant: vi.fn(),
      onCreateAtFolder: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "create" } });

    expect(screen.getByText("Session: Create")).toBeInTheDocument();
    expect(screen.getByText("Session: Create at Folder")).toBeInTheDocument();
  });
});

describe("CmdK Window At-Folder Action", () => {
  afterEach(cleanup);

  it("Window: Create at Folder appears when session is active", () => {
    const onCreateWindowAtFolder = vi.fn();
    const actions = buildWindowCreationActions({
      sessionName: "my-session",
      onCreateWindow: vi.fn(),
      onCreateWindowAtFolder,
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.getByText("Window: Create at Folder")).toBeInTheDocument();
  });

  it("Window: Create at Folder is absent when no session is active", () => {
    const actions = buildWindowCreationActions({
      sessionName: undefined,
      onCreateWindow: vi.fn(),
      onCreateWindowAtFolder: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText("Window: Create at Folder")).not.toBeInTheDocument();
  });

  it("Window: Create at Folder onSelect fires correctly", () => {
    const onCreateWindowAtFolder = vi.fn();
    const actions = buildWindowCreationActions({
      sessionName: "my-session",
      onCreateWindow: vi.fn(),
      onCreateWindowAtFolder,
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "Window: Create at Folder" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreateWindowAtFolder).toHaveBeenCalledOnce();
  });
});
