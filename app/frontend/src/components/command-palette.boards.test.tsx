import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommandPalette, type PaletteAction } from "./command-palette";
import { buildUpdateActions } from "@/lib/palette-update";

/**
 * Tests for the board-related palette entries — covers conditional visibility
 * rules and selection actions. The `buildBoardActions` helper below is a hand-
 * written mirror that draws from TWO distinct production sources, not one:
 *   - `boardRouteActions` in `components/board/board-page.tsx` — the palette the
 *     board route mounts (it does not render AppShell — DD-8). Source of the
 *     Switch/Leave/Cycle entries and the unconditional "View: Refresh Page"
 *     entry (R4).
 *   - `boardActions` in `app.tsx` — the AppShell-mounted palette's board block.
 *     Source of the Pin/Unpin Current Window entries (gated on
 *     `hasCurrentWindow`/`isCurrentWindowPinned`), which do NOT exist in
 *     `boardRouteActions`, and of the "hides Leave/Cycle when not on a board
 *     route" rule (`boardRouteActions` renders Leave unconditionally).
 *
 * The mirror is deliberately partial and does NOT reproduce production 1:1: it
 * omits `boardRouteActions`' `fontEntries` (terminal-font trio) + `helpEntry`
 * and positions `refreshEntry` right after `conditional` rather than after
 * `fontEntries` as production does. It also never executes either production
 * `onSelect` (the mirror wires its own stubs). So these tests verify the
 * entry-shape and visibility RULES the mirror reproduces — not full parity, and
 * not the production selection wiring; treat them as rule checks, not a drift
 * alarm for the parts left out.
 *
 * The update entries (`run-kit: Update to v…` / `run-kit: Dismiss Update
 * Notice`) are the newest AppShell-duplicated block folded into
 * `boardRouteActions` (260713-4zap) — below `sm` the top-bar UpdateChip is
 * hidden, so the board palette is a phone user's ONLY update surface. Production
 * builds them via `buildUpdateActions` (unit-tested in `lib/palette-update.test`
 * — the source of truth for their shape/gating/wiring); here the mirror only
 * verifies the qualify-gated presence RULE, matching the `refreshEntry`
 * treatment.
 */

function openPalette() {
  fireEvent.keyDown(document, { key: "k", metaKey: true });
}

interface BuildOpts {
  boards: Array<{ name: string }>;
  currentBoardName?: string;
  isOnBoardRoute?: boolean;
  hasCurrentWindow?: boolean;
  isCurrentWindowPinned?: boolean;
  onSwitch?: (name: string) => void;
  onPinCurrent?: () => void;
  onUnpinCurrent?: () => void;
  onLeaveBoardView?: () => void;
  onCycleNext?: () => void;
  onCyclePrev?: () => void;
  onRefresh?: () => void;
  /** Board has ≥1 pinned entry — production gates the cycle + unpin-focused
   *  entries on `entries.length > 0`. Defaults true so existing cases (which
   *  assume a populated board) are unaffected. */
  hasEntries?: boolean;
  onUnpinFocused?: () => void;
  /** A qualifying pending update exists (`qualifies && latest`). Production folds
   *  the update entries in via `buildUpdateActions`, gated on `qualifies` alone
   *  (dismissal-independent). Defaults false. */
  updateLatest?: string | null;
  onUpdate?: () => void;
  onDismissUpdate?: () => void;
}

function buildBoardActions(opts: BuildOpts): PaletteAction[] {
  const switchEntries: PaletteAction[] = opts.boards.map((b) => ({
    id: `board-switch-${b.name}`,
    label: `Board: Switch to ${b.name}${b.name === opts.currentBoardName ? " (current)" : ""}`,
    onSelect: () => opts.onSwitch?.(b.name),
  }));

  const conditional: PaletteAction[] = [];

  if (opts.hasCurrentWindow) {
    conditional.push({
      id: "board-pin-current",
      label: "Board: Pin Current Window",
      onSelect: () => opts.onPinCurrent?.(),
    });
  }

  if (opts.isCurrentWindowPinned) {
    conditional.push({
      id: "board-unpin-current",
      label: "Board: Unpin Current Window",
      onSelect: () => opts.onUnpinCurrent?.(),
    });
  }

  if (opts.isOnBoardRoute) {
    conditional.push({
      id: "board-leave",
      label: "Board: Leave Board View",
      onSelect: () => opts.onLeaveBoardView?.(),
    });
    // Cycle + unpin-focused are gated on the board having entries in production
    // (`entries.length > 0`). Mirror that with `hasEntries` (default true).
    if (opts.hasEntries !== false) {
      conditional.push({
        id: "board-cycle-next",
        label: "Board: Cycle Pane Focus →",
        onSelect: () => opts.onCycleNext?.(),
      });
      conditional.push({
        id: "board-cycle-prev",
        label: "Board: Cycle Pane Focus ←",
        onSelect: () => opts.onCyclePrev?.(),
      });
      // Board: Unpin Focused Pane — keyboard parity for the top-bar ✕
      // (260704-9o7k). Present only with entries; unpins the focused pane.
      conditional.push({
        id: "board-unpin-focused",
        label: "Board: Unpin Focused Pane",
        onSelect: () => opts.onUnpinFocused?.(),
      });
    }
  }

  // Always-present in boardRouteActions (unconditional refreshEntry) — the board
  // route mounts its own palette, so the AppShell "View: Refresh Page" entry is
  // unreachable here and is duplicated in (R4).
  const refreshEntry: PaletteAction = {
    id: "refresh-page",
    label: "View: Refresh Page",
    onSelect: () => opts.onRefresh?.(),
  };

  // Update entries — folded into boardRouteActions after refresh/help (260713-4zap).
  // Built via the SAME production helper (`buildUpdateActions`), gated on a
  // qualifying pending update, dismissal-independent.
  const updateEntries = buildUpdateActions(
    opts.updateLatest != null,
    opts.updateLatest ?? null,
    () => opts.onUpdate?.(),
    () => opts.onDismissUpdate?.(),
  );

  return [...switchEntries, ...conditional, refreshEntry, ...updateEntries];
}

describe("CmdK Board Actions", () => {
  afterEach(cleanup);

  it("renders one Switch entry per board with (current) on the active one", () => {
    const actions = buildBoardActions({
      boards: [{ name: "main" }, { name: "deploy" }, { name: "staging" }],
      currentBoardName: "main",
      isOnBoardRoute: true,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.getByText("Board: Switch to main (current)")).toBeInTheDocument();
    expect(screen.getByText("Board: Switch to deploy")).toBeInTheDocument();
    expect(screen.getByText("Board: Switch to staging")).toBeInTheDocument();
  });

  it("hides Pin Current Window when there is no current window", () => {
    const actions = buildBoardActions({
      boards: [{ name: "main" }],
      hasCurrentWindow: false,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.queryByText("Board: Pin Current Window")).not.toBeInTheDocument();
  });

  it("shows Pin Current Window when on a window route with a current window", () => {
    const actions = buildBoardActions({
      boards: [{ name: "main" }],
      hasCurrentWindow: true,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.getByText("Board: Pin Current Window")).toBeInTheDocument();
  });

  it("shows Unpin Current Window when current window is already pinned", () => {
    const actions = buildBoardActions({
      boards: [{ name: "main" }],
      hasCurrentWindow: true,
      isCurrentWindowPinned: true,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.getByText("Board: Unpin Current Window")).toBeInTheDocument();
  });

  it("hides Unpin Current Window when current window is not pinned", () => {
    const actions = buildBoardActions({
      boards: [{ name: "main" }],
      hasCurrentWindow: true,
      isCurrentWindowPinned: false,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.queryByText("Board: Unpin Current Window")).not.toBeInTheDocument();
  });

  it("hides Leave Board View and Cycle Pane Focus when not on a board route", () => {
    const actions = buildBoardActions({
      boards: [{ name: "main" }],
      isOnBoardRoute: false,
      hasCurrentWindow: true,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.queryByText("Board: Leave Board View")).not.toBeInTheDocument();
    expect(screen.queryByText("Board: Cycle Pane Focus →")).not.toBeInTheDocument();
    expect(screen.queryByText("Board: Cycle Pane Focus ←")).not.toBeInTheDocument();
  });

  it("shows Leave Board View and Cycle Pane Focus on a board route", () => {
    const actions = buildBoardActions({
      boards: [{ name: "main" }],
      currentBoardName: "main",
      isOnBoardRoute: true,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.getByText("Board: Leave Board View")).toBeInTheDocument();
    expect(screen.getByText("Board: Cycle Pane Focus →")).toBeInTheDocument();
    expect(screen.getByText("Board: Cycle Pane Focus ←")).toBeInTheDocument();
  });

  it("invokes onSelect when a Switch entry is selected", () => {
    const onSwitch = vi.fn();
    const actions = buildBoardActions({
      boards: [{ name: "main" }, { name: "deploy" }],
      currentBoardName: "main",
      isOnBoardRoute: true,
      onSwitch,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    // Filter to deploy entry to get a deterministic Enter target.
    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "deploy" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSwitch).toHaveBeenCalledWith("deploy");
  });

  it("Reorder Pane is NOT in v1 — entry must not be present", () => {
    const actions = buildBoardActions({
      boards: [{ name: "main" }],
      isOnBoardRoute: true,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.queryByText(/Board: Reorder Pane/)).not.toBeInTheDocument();
  });

  it("always renders the 'View: Refresh Page' entry (R4)", () => {
    const actions = buildBoardActions({
      boards: [{ name: "main" }],
      isOnBoardRoute: true,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.getByText("View: Refresh Page")).toBeInTheDocument();
  });

  it("invokes reload when 'View: Refresh Page' is selected (R4)", () => {
    const onRefresh = vi.fn();
    const actions = buildBoardActions({
      boards: [{ name: "main" }],
      isOnBoardRoute: true,
      onRefresh,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "Refresh Page" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("folds in 'run-kit: Update to v…' + 'Dismiss Update Notice' when an update qualifies (260713-4zap)", () => {
    const actions = buildBoardActions({
      boards: [{ name: "main" }],
      isOnBoardRoute: true,
      updateLatest: "0.6.0",
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.getByText("run-kit: Update to v0.6.0")).toBeInTheDocument();
    expect(screen.getByText("run-kit: Dismiss Update Notice")).toBeInTheDocument();
  });

  it("omits the update entries when no update qualifies (260713-4zap)", () => {
    const actions = buildBoardActions({
      boards: [{ name: "main" }],
      isOnBoardRoute: true,
      updateLatest: null,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.queryByText(/run-kit: Update to/)).not.toBeInTheDocument();
    expect(screen.queryByText("run-kit: Dismiss Update Notice")).not.toBeInTheDocument();
  });

  it("invokes the update handler when 'run-kit: Update to v…' is selected (260713-4zap)", () => {
    const onUpdate = vi.fn();
    const actions = buildBoardActions({
      boards: [{ name: "main" }],
      isOnBoardRoute: true,
      updateLatest: "0.6.0",
      onUpdate,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "Update to v0.6.0" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("shows 'Board: Unpin Focused Pane' on a board route with entries (260704-9o7k)", () => {
    const actions = buildBoardActions({
      boards: [{ name: "main" }],
      currentBoardName: "main",
      isOnBoardRoute: true,
      hasEntries: true,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.getByText("Board: Unpin Focused Pane")).toBeInTheDocument();
  });

  it("hides 'Board: Unpin Focused Pane' when the board has zero entries", () => {
    const actions = buildBoardActions({
      boards: [{ name: "main" }],
      currentBoardName: "main",
      isOnBoardRoute: true,
      hasEntries: false,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    expect(screen.queryByText("Board: Unpin Focused Pane")).not.toBeInTheDocument();
  });

  it("invokes the unpin-focused handler when 'Board: Unpin Focused Pane' is selected", () => {
    const onUnpinFocused = vi.fn();
    const actions = buildBoardActions({
      boards: [{ name: "main" }],
      currentBoardName: "main",
      isOnBoardRoute: true,
      hasEntries: true,
      onUnpinFocused,
    });
    render(<CommandPalette actions={actions} />);
    openPalette();
    const input = screen.getByPlaceholderText("Type a command...");
    fireEvent.change(input, { target: { value: "Unpin Focused" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onUnpinFocused).toHaveBeenCalledOnce();
  });
});
