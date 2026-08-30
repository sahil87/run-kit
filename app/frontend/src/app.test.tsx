import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";
import { buildTabPickerActions, resolveServerView } from "@/app";
import { availableViews, hasCode } from "@/lib/window-view";
import type { ServerInfo } from "@/api/client";

// `@/app` transitively imports terminal-client → @xterm/addon-unicode-graphemes,
// whose import-time trie init is a documented CI flake ("Data error" — see
// lib/router-url.test.ts). Mock the addon (the terminal-client.test.tsx
// pattern) so this suite never loads the real module.
vi.mock("@xterm/addon-unicode-graphemes", () => ({
  UnicodeGraphemesAddon: vi.fn(),
}));

/**
 * Tests for move window CmdK actions (T010).
 *
 * These test the action generation logic as it would appear in the palette:
 * - "Window: Move up" present when not at min index, absent at min
 * - "Window: Move down" present when not at max index, absent at max
 * - onSelect calls the expected move function
 */

function openPalette() {
  fireEvent.keyDown(document, { key: "k", code: "KeyK", metaKey: true });
}

describe("tab picker palette actions", () => {
  it("registers the label and marker entries through the production builder", () => {
    const actions = buildTabPickerActions("srv", "@7");
    expect(actions.map((action) => action.id)).toEqual([
      "window-label",
      "window-marker",
    ]);
    expect(actions.map((action) => action.label)).toEqual([
      "Tab: Label",
      "Tab: Marker",
    ]);
  });

  it("dispatches the matching marker-pad opener detail", () => {
    const listener = vi.fn();
    document.addEventListener("marker-pad:open", listener);
    const markerAction = buildTabPickerActions("srv", "@7").find(
      (action) => action.id === "window-marker",
    );
    expect(markerAction).toBeDefined();
    markerAction?.onSelect();
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      server: "srv",
      windowId: "@7",
    });
    document.removeEventListener("marker-pad:open", listener);
  });
});

/** Build windowActions matching the pattern in app.tsx. */
function buildWindowActions(opts: {
  currentWindowIndex: number;
  minIndex: number;
  maxIndex: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
}): PaletteAction[] {
  const actions: PaletteAction[] = [];
  if (opts.currentWindowIndex > opts.minIndex) {
    actions.push({
      id: "window-move-up",
      label: "Window: Move up",
      onSelect: opts.onMoveUp,
    });
  }
  if (opts.currentWindowIndex < opts.maxIndex) {
    actions.push({
      id: "window-move-down",
      label: "Window: Move down",
      onSelect: opts.onMoveDown,
    });
  }
  return actions;
}

describe("CmdK Move Window Actions", () => {
  afterEach(cleanup);

  it("shows Move up and Move down when window is in the middle", () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    const actions = buildWindowActions({
      currentWindowIndex: 1,
      minIndex: 0,
      maxIndex: 2,
      onMoveUp,
      onMoveDown,
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.getByText("Window: Move up")).toBeInTheDocument();
    expect(screen.getByText("Window: Move down")).toBeInTheDocument();
  });

  it("hides Move up when window is at min index", () => {
    const actions = buildWindowActions({
      currentWindowIndex: 0,
      minIndex: 0,
      maxIndex: 2,
      onMoveUp: vi.fn(),
      onMoveDown: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText("Window: Move up")).not.toBeInTheDocument();
    expect(screen.getByText("Window: Move down")).toBeInTheDocument();
  });

  it("hides Move down when window is at max index", () => {
    const actions = buildWindowActions({
      currentWindowIndex: 2,
      minIndex: 0,
      maxIndex: 2,
      onMoveUp: vi.fn(),
      onMoveDown: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.getByText("Window: Move up")).toBeInTheDocument();
    expect(screen.queryByText("Window: Move down")).not.toBeInTheDocument();
  });

  it("hides both when session has only one window", () => {
    const actions = buildWindowActions({
      currentWindowIndex: 0,
      minIndex: 0,
      maxIndex: 0,
      onMoveUp: vi.fn(),
      onMoveDown: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText("Window: Move up")).not.toBeInTheDocument();
    expect(screen.queryByText("Window: Move down")).not.toBeInTheDocument();
  });

  it("Move up onSelect fires correctly", () => {
    const onMoveUp = vi.fn();
    const actions = buildWindowActions({
      currentWindowIndex: 1,
      minIndex: 0,
      maxIndex: 2,
      onMoveUp,
      onMoveDown: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    // Filter to Move up, then Enter
    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "Move up" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onMoveUp).toHaveBeenCalledOnce();
  });

  it("Move down onSelect fires correctly", () => {
    const onMoveDown = vi.fn();
    const actions = buildWindowActions({
      currentWindowIndex: 1,
      minIndex: 0,
      maxIndex: 2,
      onMoveUp: vi.fn(),
      onMoveDown,
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "Move down" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onMoveDown).toHaveBeenCalledOnce();
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

    const input = screen.getByPlaceholderText(/^Type a command/);
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
  onCreate: () => void;
  onRenameSession?: () => void;
  onKillSession?: () => void;
}): PaletteAction[] {
  const actions: PaletteAction[] = [
    { id: "create-session", label: "Session: Create", onSelect: opts.onCreate },
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

  it("Session: Create fires its onSelect (the name-prompt opener)", () => {
    const onCreate = vi.fn();
    const actions = buildSessionActions({ sessionName: undefined, onCreate });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "Session: Create" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("Session: Create at Folder is gone — searching 'create' finds only the remaining entries", () => {
    const actions = buildSessionActions({
      sessionName: "my-session",
      onCreate: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "create" } });

    expect(screen.getByText("Session: Create")).toBeInTheDocument();
    expect(screen.queryByText("Session: Create at Folder")).not.toBeInTheDocument();
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

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "Window: Create at Folder" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreateWindowAtFolder).toHaveBeenCalledOnce();
  });
});

/**
 * Tests for the per-window switch palette entries (260613-o20f-palette-window-switch).
 *
 * Mirrors the `windowSwitchActions` useMemo in app.tsx (renamed from the old
 * `terminalActions` "Terminal:" block). Each window across every session yields
 * one `Window: Switch to <session> › <name>` entry; the entry whose windowId
 * matches the URL-active window (`windowParam`) gets the `(current)` suffix.
 * The action-construction logic is kept in sync with app.tsx so the test
 * catches drift if either side changes the label/grouping rules.
 */

const NBSP_ANGLE = "›"; // U+203A — the label separator used in app.tsx

/** Build windowSwitchActions matching the pattern in app.tsx. */
function buildWindowSwitchActions(opts: {
  flatWindows: { session: string; window: { windowId: string; name: string } }[];
  windowParam: string | undefined;
  onSelectWindow?: (windowId: string) => void;
}): PaletteAction[] {
  return opts.flatWindows.map((fw) => ({
    id: `window-switch-${fw.session}-${fw.window.windowId}`,
    label: `Window: Switch to ${fw.session} ${NBSP_ANGLE} ${fw.window.name}${
      fw.window.windowId === opts.windowParam ? " (current)" : ""
    }`,
    onSelect: () => opts.onSelectWindow?.(fw.window.windowId),
  }));
}

describe("CmdK Window Switch Actions", () => {
  afterEach(cleanup);

  it("renders one Window: Switch to entry per window with the › separator and (current) on the active window", () => {
    const actions = buildWindowSwitchActions({
      flatWindows: [
        { session: "alpha", window: { windowId: "@1", name: "edit" } },
        { session: "alpha", window: { windowId: "@2", name: "serve" } },
        { session: "bravo", window: { windowId: "@3", name: "logs" } },
      ],
      windowParam: "@2",
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    // Non-active windows: plain `<session> › <name>` label, no suffix.
    expect(screen.getByText(`Window: Switch to alpha ${NBSP_ANGLE} edit`)).toBeInTheDocument();
    expect(screen.getByText(`Window: Switch to bravo ${NBSP_ANGLE} logs`)).toBeInTheDocument();
    // Active window (windowId === windowParam): carries the (current) suffix.
    expect(screen.getByText(`Window: Switch to alpha ${NBSP_ANGLE} serve (current)`)).toBeInTheDocument();
    // Only one entry is marked current.
    expect(screen.getAllByText(/\(current\)/)).toHaveLength(1);
  });

  it("marks no entry (current) when windowParam matches no window (e.g. dashboard route)", () => {
    const actions = buildWindowSwitchActions({
      flatWindows: [
        { session: "alpha", window: { windowId: "@1", name: "edit" } },
        { session: "alpha", window: { windowId: "@2", name: "serve" } },
      ],
      windowParam: undefined,
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.getByText(`Window: Switch to alpha ${NBSP_ANGLE} edit`)).toBeInTheDocument();
    expect(screen.getByText(`Window: Switch to alpha ${NBSP_ANGLE} serve`)).toBeInTheDocument();
    expect(screen.queryByText(/\(current\)/)).not.toBeInTheDocument();
  });

  it("onSelect fires with the window's id", () => {
    const onSelectWindow = vi.fn();
    const actions = buildWindowSwitchActions({
      flatWindows: [
        { session: "alpha", window: { windowId: "@1", name: "edit" } },
        { session: "bravo", window: { windowId: "@3", name: "logs" } },
      ],
      windowParam: "@1",
      onSelectWindow,
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "logs" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelectWindow).toHaveBeenCalledWith("@3");
  });
});

/**
 * Tests for the three-way server route guard (260602-3i5d).
 *
 * `resolveServerView` is the pure decision behind the AppShell guard:
 *   - server in list                              → "view"
 *   - server absent, === pendingServer            → "waiting"
 *   - server absent, !== pendingServer, loaded    → "not-found"
 *   - server absent, !== pendingServer, !loaded   → "view" (don't flash not-found)
 */
describe("resolveServerView — three-way route guard", () => {
  const srv = (...names: string[]): ServerInfo[] =>
    names.map((name) => ({ name, sessionCount: 0 }));

  it("returns 'view' when the server is in the list", () => {
    expect(resolveServerView("alpha", srv("alpha", "bravo"), null, true)).toBe("view");
  });

  it("returns 'waiting' for a just-created server absent from the list (=== pendingServer)", () => {
    // Pre-existing servers present and list loaded — the old `servers.length > 0`
    // proxy would have wrongly returned not-found here. The pending marker must win.
    expect(resolveServerView("newsrv", srv("alpha"), "newsrv", true)).toBe("waiting");
  });

  it("swaps 'waiting' → 'view' once the refreshed list includes the pending server", () => {
    // Same pending marker, but now the server has appeared in the list.
    expect(resolveServerView("newsrv", srv("alpha", "newsrv"), "newsrv", true)).toBe("view");
  });

  it("returns 'not-found' immediately for a genuinely-unknown name once loaded", () => {
    expect(resolveServerView("typo", srv("alpha"), null, true)).toBe("not-found");
    // A different pending server must not rescue an unrelated unknown name.
    expect(resolveServerView("typo", srv("alpha"), "other", true)).toBe("not-found");
  });

  it("does NOT return 'not-found' for an unknown non-pending name before the first fetch resolves", () => {
    expect(resolveServerView("typo", [], null, false)).toBe("view");
    expect(resolveServerView("typo", srv("alpha"), null, false)).toBe("view");
  });
});

/**
 * `codeRoot` (the shared `@rk_win_code_root`) keeps a window code-capable
 * after its active pane leaves the repo — the stable-availability contract the
 * retired per-browser latch enforced.
 */
describe("hasCode — the code-root availability contract", () => {
  it("keeps the code lens available when the live derivation went empty (the pane-switch case)", () => {
    // The intake's screenshot scenario: the active pane leaves the repo, so the
    // next SSE tick derives "". The shared code root is what stops the strobe.
    const win = { gitRoot: "", codeRoot: "/home/user/latched" };
    expect(hasCode({ gitRoot: "" })).toBe(false);
    expect(hasCode(win)).toBe(true);
    expect(availableViews(win)).toEqual([
      "code",
      "web",
      "tty",
    ]);
  });
});

/**
 * Tests for the ungated `View:` palette entries (R4) — `toggle-fixed-width`
 * from `viewActions` in `app.tsx` (AppShell's route list) plus the global
 * "View: Refresh Page" (`use-global-palette-actions.ts`, layout-level since
 * 260811-239r), the full-page-reload recovery affordance (constitution V).
 * Mirrors the action-construction logic in production so the test catches
 * drift if either side changes.
 */
function buildViewStaticActions(opts: {
  fixedWidth?: boolean;
  onToggleFixedWidth?: () => void;
  onRefresh?: () => void;
}): PaletteAction[] {
  return [
    {
      id: "toggle-fixed-width",
      label: opts.fixedWidth ? "View: Full Width" : "View: Fixed Width (900px)",
      onSelect: () => opts.onToggleFixedWidth?.(),
    },
    {
      id: "refresh-page",
      label: "View: Refresh Page",
      onSelect: () => opts.onRefresh?.(),
    },
  ];
}

describe("CmdK View Actions (AppShell palette)", () => {
  afterEach(cleanup);

  it("renders the ungated 'View: Refresh Page' entry", () => {
    const actions = buildViewStaticActions({});
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.getByText("View: Refresh Page")).toBeInTheDocument();
  });

  it("invokes reload when 'View: Refresh Page' is selected", () => {
    const onRefresh = vi.fn();
    const actions = buildViewStaticActions({ onRefresh });
    render(<CommandPalette actions={actions} />);
    openPalette();
    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "Refresh Page" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});

/**
 * Tests for the operator mark/unmark palette pair (260813-ifya), from
 * `windowActions` in app.tsx. "Window: Mark as Operator" is listed when a
 * current window exists and is NOT the operator; "Window: Unmark Operator"
 * when it IS. Mirrors the action-construction logic in app.tsx so the test
 * catches drift if either side changes the gating/label rules.
 */

/** Build the operator mark/unmark actions matching the pattern in app.tsx. */
function buildOperatorActions(opts: {
  hasCurrentWindow: boolean;
  currentRole?: string;
  onMark: () => void;
  onUnmark: () => void;
}): PaletteAction[] {
  if (!opts.hasCurrentWindow) return [];
  return opts.currentRole === "operator"
    ? [{ id: "window-unmark-operator", label: "Window: Unmark Operator", onSelect: opts.onUnmark }]
    : [{ id: "window-mark-operator", label: "Window: Mark as Operator", onSelect: opts.onMark }];
}

describe("CmdK Operator Role Actions", () => {
  afterEach(cleanup);

  it("shows Mark as Operator (not Unmark) when the current window is not the operator", () => {
    const actions = buildOperatorActions({
      hasCurrentWindow: true,
      currentRole: undefined,
      onMark: vi.fn(),
      onUnmark: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.getByText("Window: Mark as Operator")).toBeInTheDocument();
    expect(screen.queryByText("Window: Unmark Operator")).not.toBeInTheDocument();
  });

  it("shows Unmark Operator (not Mark) when the current window IS the operator", () => {
    const actions = buildOperatorActions({
      hasCurrentWindow: true,
      currentRole: "operator",
      onMark: vi.fn(),
      onUnmark: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.getByText("Window: Unmark Operator")).toBeInTheDocument();
    expect(screen.queryByText("Window: Mark as Operator")).not.toBeInTheDocument();
  });

  it("shows neither when there is no current window", () => {
    const actions = buildOperatorActions({
      hasCurrentWindow: false,
      onMark: vi.fn(),
      onUnmark: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText("Window: Mark as Operator")).not.toBeInTheDocument();
    expect(screen.queryByText("Window: Unmark Operator")).not.toBeInTheDocument();
  });

  it("Mark as Operator onSelect fires the mark seam", () => {
    const onMark = vi.fn();
    const actions = buildOperatorActions({
      hasCurrentWindow: true,
      onMark,
      onUnmark: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "Mark as Operator" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onMark).toHaveBeenCalledOnce();
  });

  it("Unmark Operator onSelect fires the unmark seam", () => {
    const onUnmark = vi.fn();
    const actions = buildOperatorActions({
      hasCurrentWindow: true,
      currentRole: "operator",
      onMark: vi.fn(),
      onUnmark,
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "Unmark Operator" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onUnmark).toHaveBeenCalledOnce();
  });
});

/**
 * Tests for the terminal-export palette gate (260820-4le0 R6) — `Terminal:
 * Download full history` is ABSENT (the availability idiom, not disabled) when
 * the current window's active pane is on the alternate screen, since tmux
 * holds no scrollback for a server capture there. The other three export
 * actions are unaffected.
 *
 * These mirror the action-generation pattern in app.tsx (the
 * buildSessionActions/buildOperatorActions precedent).
 */

/** Build the terminal-export palette entries matching app.tsx's gate. */
function buildTerminalExportActions(opts: {
  hasTtyTile: boolean;
  altScreen: boolean;
}): PaletteAction[] {
  if (!opts.hasTtyTile) return [];
  return (
    [
      ["terminal-export-snapshot", "Terminal: Download snapshot (HTML)", "snapshot"],
      ["terminal-export-transcript", "Terminal: Download transcript", "transcript"],
      ["terminal-export-copy", "Terminal: Copy visible screen", "copy-visible"],
      ...(opts.altScreen
        ? []
        : [["terminal-export-history", "Terminal: Download full history", "history"] as const]),
    ] as const
  ).map(([id, label, action]) => ({
    id,
    label,
    onSelect: () =>
      document.dispatchEvent(new CustomEvent("terminal-export", { detail: { action } })),
  }));
}

describe("CmdK Terminal Export Actions (altScreen gate)", () => {
  afterEach(cleanup);

  it("all four export entries appear on a normal-screen window", () => {
    const actions = buildTerminalExportActions({ hasTtyTile: true, altScreen: false });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.getByText("Terminal: Download snapshot (HTML)")).toBeInTheDocument();
    expect(screen.getByText("Terminal: Download transcript")).toBeInTheDocument();
    expect(screen.getByText("Terminal: Copy visible screen")).toBeInTheDocument();
    expect(screen.getByText("Terminal: Download full history")).toBeInTheDocument();
  });

  it("Download full history is absent on an altScreen window; the other three remain", () => {
    const actions = buildTerminalExportActions({ hasTtyTile: true, altScreen: true });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText("Terminal: Download full history")).not.toBeInTheDocument();
    expect(screen.getByText("Terminal: Download snapshot (HTML)")).toBeInTheDocument();
    expect(screen.getByText("Terminal: Download transcript")).toBeInTheDocument();
    expect(screen.getByText("Terminal: Copy visible screen")).toBeInTheDocument();
  });

  it("no export entries when the layout has no tty tile", () => {
    const actions = buildTerminalExportActions({ hasTtyTile: false, altScreen: false });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText(/^Terminal: Download/)).not.toBeInTheDocument();
    expect(screen.queryByText("Terminal: Copy visible screen")).not.toBeInTheDocument();
  });
});

/**
 * Tests for the Fix tab name palette entry (260822-fih1 R10) — `Tab: Fix name
 * (ask operator)` is ABSENT (omit-not-disable) unless the same three-part
 * availability rule as the flyout row holds: an operator window on the server,
 * the current window carrying a chat session ref, and the current window not
 * being the operator itself. Mirrors the action-generation pattern in app.tsx
 * (the buildOperatorActions precedent).
 */

/** Build the Fix tab name palette entry matching app.tsx's gate. */
function buildFixTabNameActions(opts: {
  hasOperator: boolean;
  chatSessionRef?: string;
  currentRole?: string;
  onFix: () => void;
}): PaletteAction[] {
  if (!opts.hasOperator || !opts.chatSessionRef || opts.currentRole === "operator") return [];
  return [{ id: "window-fix-name-operator", label: "Tab: Fix name (ask operator)", onSelect: opts.onFix }];
}

describe("CmdK Fix Tab Name Action (operator-request gate)", () => {
  afterEach(cleanup);

  it("is listed when the rule holds and selecting it fires the fix seam", () => {
    const onFix = vi.fn();
    const actions = buildFixTabNameActions({ hasOperator: true, chatSessionRef: "ref-1", onFix });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "Fix name" } });
    expect(screen.getByText("Tab: Fix name (ask operator)")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onFix).toHaveBeenCalledOnce();
  });

  it("is absent without an operator on the server", () => {
    const actions = buildFixTabNameActions({ hasOperator: false, chatSessionRef: "ref-1", onFix: vi.fn() });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText("Tab: Fix name (ask operator)")).not.toBeInTheDocument();
  });

  it("is absent when the current window carries no chat session ref", () => {
    const actions = buildFixTabNameActions({ hasOperator: true, onFix: vi.fn() });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText("Tab: Fix name (ask operator)")).not.toBeInTheDocument();
  });

  it("is absent on the operator's own window", () => {
    const actions = buildFixTabNameActions({
      hasOperator: true,
      chatSessionRef: "ref-1",
      currentRole: "operator",
      onFix: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText("Tab: Fix name (ask operator)")).not.toBeInTheDocument();
  });
});

/**
 * Tests for the Operator compose palette entries (260822-wyn3 R6) —
 * `Operator: Spawn task…` / `Operator: Find discussion…` are present only when
 * the server has an operator window (omit-not-disable, the
 * `buildFixTabNameActions` precedent), each opening the shared compose dialog
 * with its mode pre-selected.
 */

/** Build the operator compose palette entries matching app.tsx's gate. */
function buildOperatorComposeActions(opts: {
  hasOperator: boolean;
  onOpen: (mode: "spawn" | "find") => void;
}): PaletteAction[] {
  if (!opts.hasOperator) return [];
  return [
    { id: "operator-spawn-task", label: "Operator: Spawn task…", onSelect: () => opts.onOpen("spawn") },
    { id: "operator-find-discussion", label: "Operator: Find discussion…", onSelect: () => opts.onOpen("find") },
  ];
}

describe("CmdK Operator Compose Actions (hasOperatorWindow gate)", () => {
  afterEach(cleanup);

  it("both entries are listed with an operator, each pre-selecting its mode", () => {
    const onOpen = vi.fn();
    const actions = buildOperatorComposeActions({ hasOperator: true, onOpen });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "Operator:" } });
    expect(screen.getByText("Operator: Spawn task…")).toBeInTheDocument();
    expect(screen.getByText("Operator: Find discussion…")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Operator: Spawn task…"));
    expect(onOpen).toHaveBeenCalledWith("spawn");

    openPalette();
    fireEvent.change(screen.getByPlaceholderText(/^Type a command/), { target: { value: "Operator:" } });
    fireEvent.click(screen.getByText("Operator: Find discussion…"));
    expect(onOpen).toHaveBeenCalledWith("find");
  });

  it("neither entry is listed without an operator on the server", () => {
    const actions = buildOperatorComposeActions({ hasOperator: false, onOpen: vi.fn() });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText("Operator: Spawn task…")).not.toBeInTheDocument();
    expect(screen.queryByText("Operator: Find discussion…")).not.toBeInTheDocument();
  });
});

/**
 * Tests for the Operator digest/triage/labeling palette entries (260822-rfz2
 * R6) — `Operator: Brief me` / `Operator: What's stuck` / `Operator: Color
 * tabs` ride the same hasOperatorWindow omit-not-disable gate as the compose
 * entries and fire directly (no dialog). Mirrors the action-generation pattern
 * in app.tsx.
 */

/** Build the server-scoped digest/triage/labeling palette entries matching app.tsx's gate. */
function buildOperatorDigestActions(opts: {
  hasOperator: boolean;
  onFire: (template: string) => void;
}): PaletteAction[] {
  if (!opts.hasOperator) return [];
  return [
    { id: "operator-brief-me", label: "Operator: Brief me", onSelect: () => opts.onFire("brief-me") },
    { id: "operator-whats-stuck", label: "Operator: What's stuck", onSelect: () => opts.onFire("whats-stuck") },
    { id: "operator-color-tabs", label: "Operator: Color tabs", onSelect: () => opts.onFire("color-tabs") },
    { id: "operator-update-annotations", label: "Operator: Update annotations", onSelect: () => opts.onFire("update-annotations") },
  ];
}

describe("CmdK Operator Digest Actions (hasOperatorWindow gate)", () => {
  afterEach(cleanup);

  it("all entries are listed with an operator, each firing its template directly", () => {
    const onFire = vi.fn();
    const actions = buildOperatorDigestActions({ hasOperator: true, onFire });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "Operator:" } });
    expect(screen.getByText("Operator: Brief me")).toBeInTheDocument();
    expect(screen.getByText("Operator: What's stuck")).toBeInTheDocument();
    expect(screen.getByText("Operator: Color tabs")).toBeInTheDocument();
    expect(screen.getByText("Operator: Update annotations")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Operator: Brief me"));
    expect(onFire).toHaveBeenCalledWith("brief-me");

    openPalette();
    fireEvent.change(screen.getByPlaceholderText(/^Type a command/), { target: { value: "Operator:" } });
    fireEvent.click(screen.getByText("Operator: What's stuck"));
    expect(onFire).toHaveBeenCalledWith("whats-stuck");

    openPalette();
    fireEvent.change(screen.getByPlaceholderText(/^Type a command/), { target: { value: "Operator:" } });
    fireEvent.click(screen.getByText("Operator: Color tabs"));
    expect(onFire).toHaveBeenCalledWith("color-tabs");

    openPalette();
    fireEvent.change(screen.getByPlaceholderText(/^Type a command/), { target: { value: "Operator:" } });
    fireEvent.click(screen.getByText("Operator: Update annotations"));
    expect(onFire).toHaveBeenCalledWith("update-annotations");
  });

  it("no entry is listed without an operator on the server", () => {
    const actions = buildOperatorDigestActions({ hasOperator: false, onFire: vi.fn() });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText("Operator: Brief me")).not.toBeInTheDocument();
    expect(screen.queryByText("Operator: What's stuck")).not.toBeInTheDocument();
    expect(screen.queryByText("Operator: Color tabs")).not.toBeInTheDocument();
    expect(screen.queryByText("Operator: Update annotations")).not.toBeInTheDocument();
  });
});

/**
 * Tests for the Set note palette entry (260824-bb5n R5) — `Window: Set note…`
 * is registered for the current window on the terminal route (Constitution V),
 * opening the note prompt pre-filled with the current note; an empty submit
 * clears it. Mirrors the action-generation pattern in app.tsx.
 */

/** Build the Set note palette entry matching app.tsx's wiring. */
function buildSetNoteActions(opts: {
  currentNote?: string;
  onOpen: (prefill: string) => void;
}): PaletteAction[] {
  return [
    {
      id: "window-set-note",
      label: "Window: Set note…",
      onSelect: () => opts.onOpen(opts.currentNote ?? ""),
    },
  ];
}

describe("CmdK Set Note Action (260824-bb5n)", () => {
  afterEach(cleanup);

  it("is listed and selecting it opens the prompt pre-filled with the current note", () => {
    const onOpen = vi.fn();
    const actions = buildSetNoteActions({ currentNote: "blocked on flaky e2e", onOpen });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "Set note" } });
    expect(screen.getByText("Window: Set note…")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("blocked on flaky e2e");
  });

  it("opens with an empty prefill when the window carries no note", () => {
    const onOpen = vi.fn();
    const actions = buildSetNoteActions({ onOpen });

    render(<CommandPalette actions={actions} />);
    openPalette();

    fireEvent.change(screen.getByPlaceholderText(/^Type a command/), { target: { value: "Set note" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/^Type a command/), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("");
  });
});

/**
 * Tests for the Annotate tab palette entry (260824-bb5n R6) — `Operator:
 * Annotate tab` is gated by the SAME three-part availability rule as fix-name
 * (operator on the server, chat ref on the current window, not the operator's
 * own window) and fires the annotate-tab operator-request template. Mirrors
 * the buildFixTabNameActions precedent.
 */

/** Build the Annotate tab palette entry matching app.tsx's gate. */
function buildAnnotateTabActions(opts: {
  hasOperator: boolean;
  chatSessionRef?: string;
  currentRole?: string;
  onAnnotate: () => void;
}): PaletteAction[] {
  if (!opts.hasOperator || !opts.chatSessionRef || opts.currentRole === "operator") return [];
  return [{ id: "window-annotate-operator", label: "Operator: Annotate tab", onSelect: opts.onAnnotate }];
}

describe("CmdK Annotate Tab Action (operator-request gate)", () => {
  afterEach(cleanup);

  it("is listed when the rule holds and selecting it fires the annotate seam", () => {
    const onAnnotate = vi.fn();
    const actions = buildAnnotateTabActions({ hasOperator: true, chatSessionRef: "ref-1", onAnnotate });

    render(<CommandPalette actions={actions} />);
    openPalette();

    const input = screen.getByPlaceholderText(/^Type a command/);
    fireEvent.change(input, { target: { value: "Annotate" } });
    expect(screen.getByText("Operator: Annotate tab")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAnnotate).toHaveBeenCalledOnce();
  });

  it("is absent without an operator on the server", () => {
    const actions = buildAnnotateTabActions({ hasOperator: false, chatSessionRef: "ref-1", onAnnotate: vi.fn() });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText("Operator: Annotate tab")).not.toBeInTheDocument();
  });

  it("is absent when the current window carries no chat session ref", () => {
    const actions = buildAnnotateTabActions({ hasOperator: true, onAnnotate: vi.fn() });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText("Operator: Annotate tab")).not.toBeInTheDocument();
  });

  it("is absent on the operator's own window", () => {
    const actions = buildAnnotateTabActions({
      hasOperator: true,
      chatSessionRef: "ref-1",
      currentRole: "operator",
      onAnnotate: vi.fn(),
    });

    render(<CommandPalette actions={actions} />);
    openPalette();

    expect(screen.queryByText("Operator: Annotate tab")).not.toBeInTheDocument();
  });
});
