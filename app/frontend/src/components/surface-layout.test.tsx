import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import { SurfaceLayout } from "./surface-layout";
import { ratiosStorageKey, type Layout, type SurfaceKind } from "@/lib/surface-layout";
import type { WindowInfo } from "@/types";
import { stubMatchMedia } from "@/test-utils/match-media";

// jsdom does not implement matchMedia — Tip's coarse-pointer check needs it.
// Default to the fine-pointer branch (tooltips enabled).
stubMatchMedia(() => false);

// Heavy children are mocked (the RightPanel/app-test precedent): TerminalClient
// opens websockets and pulls in xterm's import-time addon init; the iframe/chat
// renderers are asserted by testid instead. `terminalSpy` records each mount's
// props so the duplicate-tty ref/focus rules are assertable; `codeSpy` does the
// same for the code tile's focus-seam prop (`onInteract`, 260812-wfic R2).
const terminalSpy = vi.hoisted(() => vi.fn());
const codeSpy = vi.hoisted(() => vi.fn());
const iframeSpy = vi.hoisted(() => vi.fn());
vi.mock("@/components/terminal-client", () => ({
  TerminalClient: (props: Record<string, unknown>) => {
    terminalSpy(props);
    return <div data-testid="mock-terminal" />;
  },
}));
vi.mock("@/components/code-surface", () => ({
  CodeSurface: (props: Record<string, unknown>) => {
    codeSpy(props);
    return <div data-testid="mock-code" />;
  },
}));
vi.mock("@/components/iframe-window", () => ({
  IframeWindow: (props: Record<string, unknown>) => {
    iframeSpy(props);
    return <div data-testid="mock-iframe" />;
  },
}));
vi.mock("@/components/chat-view", () => ({
  ChatView: () => <div data-testid="mock-chat" />,
}));

// jsdom lacks pointer capture — the divider drag handlers call it. Stub the
// trio (hasPointerCapture: false also exercises the release-guard branch).
beforeEach(() => {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = function () {};
    Element.prototype.releasePointerCapture = function () {};
    Element.prototype.hasPointerCapture = function () {
      return false;
    };
  }
});

const FULL_WINDOW = {
  rkUrl: "http://localhost:8080",
  chatProvider: "claude",
  gitRoot: "/repo",
};

type LayoutOverrides = {
  layout?: Layout;
  window?: object | null;
  isMobile?: boolean;
  mobileActiveSlot?: number;
  onPromote?: (surface: SurfaceKind) => void;
  onSwap?: (surface: SurfaceKind) => void;
  onClose?: (surface: SurfaceKind) => void;
  onSplitPane?: (horizontal: boolean) => void;
  onClosePane?: () => void;
  onRatioCommit?: () => void;
  onCodeFolderNavigated?: (folder: string) => void;
  zoomToggleRef?: { current: (() => void) | null };
  onZoomChange?: (zoomed: boolean) => void;
  onFocusedKindChange?: (kind: SurfaceKind) => void;
  focusTileRef?: { current: ((kind: SurfaceKind) => void) | null };
  statusWindow?: WindowInfo | null;
  ttyDockContent?: React.ReactNode;
};

/** The minimal WindowInfo the tty header's StatusDot consumes (260812-wfic
 *  R6) — `agentState: "active"` renders the sidebar's active-agent dot. */
const STATUS_WINDOW: WindowInfo = {
  windowId: "@1",
  index: 0,
  name: "win",
  worktreePath: "/repo",
  activity: "idle",
  isActiveWindow: true,
  activityTimestamp: 0,
  agentState: "active",
};

/** The SurfaceLayout element with test-default props (shared by renderLayout
 *  and rerender calls so a prop-driven layout change — e.g. a tile CLOSE —
 *  re-renders the SAME component tree). */
function layoutElement(overrides: LayoutOverrides = {}) {
  return (
    <SurfaceLayout
      layout={overrides.layout ?? { shape: "single", order: ["tty"] }}
      server="srv"
      windowId="@1"
      sessionName="sess"
      window={overrides.window === undefined ? FULL_WINDOW : overrides.window}
      isMobile={overrides.isMobile ?? false}
      mobileActiveSlot={overrides.mobileActiveSlot}
      wsRef={{ current: null }}
      focusRef={{ current: null }}
      scrollLocked={false}
      onSessionNotFound={vi.fn()}
      chat={{
        events: [],
        pending: null,
        connected: true,
        error: null,
        onSend: vi.fn(),
        busy: false,
      }}
      codeReachable
      onSwitchToTty={vi.fn()}
      onPromote={overrides.onPromote ?? vi.fn()}
      onSwap={overrides.onSwap ?? vi.fn()}
      onClose={overrides.onClose ?? vi.fn()}
      onSplitPane={overrides.onSplitPane ?? vi.fn()}
      onClosePane={overrides.onClosePane ?? vi.fn()}
      onRatioCommit={overrides.onRatioCommit}
      onCodeFolderNavigated={overrides.onCodeFolderNavigated}
      zoomToggleRef={overrides.zoomToggleRef}
      onZoomChange={overrides.onZoomChange}
      onFocusedKindChange={overrides.onFocusedKindChange}
      focusTileRef={overrides.focusTileRef}
      statusWindow={overrides.statusWindow}
      ttyDockContent={overrides.ttyDockContent}
    />
  );
}

function renderLayout(overrides: LayoutOverrides = {}) {
  return render(layoutElement(overrides));
}

beforeEach(() => {
  localStorage.clear();
  terminalSpy.mockClear();
  codeSpy.mockClear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("SurfaceLayout shape rendering", () => {
  it("single renders one tile, no dividers, and NO verb buttons", () => {
    renderLayout();
    expect(screen.getByTestId("surface-layout")).toBeTruthy();
    expect(screen.getByTestId("surface-tile-tty")).toBeTruthy();
    expect(screen.queryByTestId("surface-divider-0")).toBeNull();
    // single renders no ⛶/◧/⇄/✕ (zoom is arity>1-only; closing the last
    // tile is disallowed).
    expect(screen.queryByRole("button", { name: "Zoom Terminal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Promote Terminal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Swap Terminal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close Terminal" })).toBeNull();
  });

  it("split-h renders two tiles and one divider", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "code"] } });
    expect(screen.getByTestId("surface-tile-tty")).toBeTruthy();
    expect(screen.getByTestId("surface-tile-code")).toBeTruthy();
    expect(screen.getByTestId("surface-divider-0")).toBeTruthy();
    expect(screen.queryByTestId("surface-divider-1")).toBeNull();
    expect(screen.getByTestId("mock-terminal")).toBeTruthy();
    expect(screen.getByTestId("mock-code")).toBeTruthy();
  });

  it("split-v renders two tiles and one divider", () => {
    renderLayout({ layout: { shape: "split-v", order: ["tty", "web"] } });
    expect(screen.getByTestId("surface-tile-tty")).toBeTruthy();
    expect(screen.getByTestId("surface-tile-web")).toBeTruthy();
    expect(screen.getByTestId("surface-divider-0")).toBeTruthy();
    expect(screen.queryByTestId("surface-divider-1")).toBeNull();
    expect(screen.getByTestId("mock-iframe")).toBeTruthy();
  });

  it("every 3-tile shape renders three tiles and two dividers", () => {
    for (const shape of ["row", "col", "main-left", "main-right", "main-top"] as const) {
      cleanup();
      renderLayout({ layout: { shape, order: ["tty", "code", "web"] } });
      expect(screen.getByTestId("surface-tile-tty")).toBeTruthy();
      expect(screen.getByTestId("surface-tile-code")).toBeTruthy();
      expect(screen.getByTestId("surface-tile-web")).toBeTruthy();
      expect(screen.getByTestId("surface-divider-0")).toBeTruthy();
      expect(screen.getByTestId("surface-divider-1")).toBeTruthy();
      expect(screen.queryByTestId("surface-divider-2")).toBeNull();
    }
  });

  it("mounts a chat tile via ChatView", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "chat"] } });
    expect(screen.getByTestId("mock-chat")).toBeTruthy();
  });

  it("renders tile meta: git-root basename for code, rkUrl host for web", () => {
    renderLayout({ layout: { shape: "split-h", order: ["code", "web"] } });
    const codeTile = screen.getByTestId("surface-tile-code");
    expect(codeTile.textContent).toContain("repo");
    const webTile = screen.getByTestId("surface-tile-web");
    expect(webTile.textContent).toContain("localhost:8080");
  });
});

describe("SurfaceLayout tile verbs", () => {
  it("verb buttons call the parent's mutation callbacks with the tile kind", () => {
    const onPromote = vi.fn();
    const onSwap = vi.fn();
    const onClose = vi.fn();
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "code"] },
      onPromote,
      onSwap,
      onClose,
    });
    fireEvent.click(screen.getByRole("button", { name: "Promote Code" }));
    expect(onPromote).toHaveBeenCalledWith("code");
    fireEvent.click(screen.getByRole("button", { name: "Swap Terminal" }));
    expect(onSwap).toHaveBeenCalledWith("tty");
    fireEvent.click(screen.getByRole("button", { name: "Close Code" }));
    expect(onClose).toHaveBeenCalledWith("code");
  });

  it("verb buttons are boxed and visible at rest (260812-wfic R4)", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "code"] } });
    const close = screen.getByRole("button", { name: "Close Code" });
    // Rest-visible (~65% opacity) boxed 22×22 buttons (26×26 coarse) — the
    // retired pattern was hover-revealed (`opacity-0 group-hover:opacity-100`).
    expect(close.className).toContain("opacity-65");
    expect(close.className).toContain("h-[22px]");
    expect(close.className).toContain("w-[22px]");
    expect(close.className).toContain("coarse:h-[26px]");
    expect(close.className).toContain("coarse:w-[26px]");
    expect(close.className).not.toContain("opacity-0");
    expect(close.className).not.toContain("group-hover");
    // The destructive verb reddens on hover; the safe verbs brighten.
    expect(close.className).toContain("hover:text-signal-red");
    const swap = screen.getByRole("button", { name: "Swap Code" });
    expect(swap.className).toContain("hover:text-text-primary");
    expect(swap.className).toContain("hover:bg-bg-inset");
  });
});

describe("SurfaceLayout pane segment (260813-w1lf content verbs)", () => {
  it("tty at arity 1 renders the bordered pane segment and zero layout verbs", () => {
    renderLayout({ layout: { shape: "single", order: ["tty"] } });
    const ttyTile = screen.getByTestId("surface-tile-tty");
    const segment = within(ttyTile).getByTestId("pane-segment");
    expect(segment.className).toContain("border");
    expect(segment.className).toContain("rounded");
    expect(within(segment).getByRole("button", { name: "Split pane horizontally" })).toBeTruthy();
    expect(within(segment).getByRole("button", { name: "Split pane vertically" })).toBeTruthy();
    expect(within(segment).getByRole("button", { name: "Close pane" })).toBeTruthy();
    // The layout-verb family stays arity-gated — none render at arity 1.
    expect(screen.queryByRole("button", { name: "Zoom Terminal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Promote Terminal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Swap Terminal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close Terminal" })).toBeNull();
  });

  it("renders only on tty tiles — code/web/chat headers carry no segment", () => {
    renderLayout({ layout: { shape: "row", order: ["code", "web", "chat"] } });
    expect(screen.queryByTestId("pane-segment")).toBeNull();
    cleanup();
    renderLayout({ layout: { shape: "split-h", order: ["tty", "code"] } });
    expect(screen.getAllByTestId("pane-segment")).toHaveLength(1);
    expect(within(screen.getByTestId("surface-tile-code")).queryByTestId("pane-segment")).toBeNull();
  });

  it("stays visible while the tty tile is zoomed (◧/⇄ hide; ✕/⛶ stay)", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "code"] } });
    fireEvent.click(screen.getByRole("button", { name: "Zoom Terminal" }));
    const ttyTile = screen.getByTestId("surface-tile-tty");
    expect(within(ttyTile).getByTestId("pane-segment")).toBeTruthy();
    expect(within(ttyTile).getByRole("button", { name: "Split pane horizontally" })).toBeTruthy();
    expect(within(ttyTile).queryByRole("button", { name: "Promote Terminal" })).toBeNull();
    expect(within(ttyTile).queryByRole("button", { name: "Swap Terminal" })).toBeNull();
    expect(within(ttyTile).getByRole("button", { name: "Close Terminal" })).toBeTruthy();
  });

  it("both duplicate tty tiles carry the segment", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "tty"] } });
    expect(screen.getAllByTestId("pane-segment")).toHaveLength(2);
    expect(within(screen.getByTestId("surface-tile-tty")).getByTestId("pane-segment")).toBeTruthy();
    expect(within(screen.getByTestId("surface-tile-tty-2")).getByTestId("pane-segment")).toBeTruthy();
  });

  it("clicks fire the parent's pane callbacks", () => {
    const onSplitPane = vi.fn();
    const onClosePane = vi.fn();
    renderLayout({ onSplitPane, onClosePane });
    fireEvent.click(screen.getByRole("button", { name: "Split pane horizontally" }));
    expect(onSplitPane).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Split pane vertically" }));
    expect(onSplitPane).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Close pane" }));
    expect(onClosePane).toHaveBeenCalledTimes(1);
  });

  it("Close Pane renders the boxed ⊠ glyph (not the bare ✕) with a red hover; splits use the standard verb hover", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "code"] } });
    const close = screen.getByRole("button", { name: "Close pane" });
    expect(close.querySelector('[data-icon="close-pane-boxed"]')).toBeTruthy();
    expect(close.querySelector('[data-icon="close-pane"]')).toBeNull();
    expect(close.className).toContain("hover:text-signal-red");
    const split = screen.getByRole("button", { name: "Split pane horizontally" });
    expect(split.querySelector('[data-icon="split-horizontal"]')).toBeTruthy();
    expect(split.className).toContain("hover:text-text-primary");
    expect(split.className).not.toContain("accent-green");
    expect(
      screen.getByRole("button", { name: "Split pane vertically" }).querySelector('[data-icon="split-vertical"]'),
    ).toBeTruthy();
  });
});

describe("SurfaceLayout zoom", () => {
  it("zoom hides the other tiles at display level WITHOUT unmounting", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "code"] } });
    fireEvent.click(screen.getByRole("button", { name: "Zoom Code" }));
    const ttyTile = screen.getByTestId("surface-tile-tty");
    expect(ttyTile.classList.contains("hidden")).toBe(true);
    // Still mounted — the terminal's state survives the zoom.
    expect(screen.getByTestId("mock-terminal")).toBeTruthy();
    // Dividers do not render while zoomed.
    expect(screen.queryByTestId("surface-divider-0")).toBeNull();
    // Un-zoom restores the tile.
    fireEvent.click(screen.getByRole("button", { name: "Unzoom Code" }));
    expect(screen.getByTestId("surface-tile-tty").classList.contains("hidden")).toBe(false);
    expect(screen.getByTestId("surface-divider-0")).toBeTruthy();
  });

  it("zoomed tile shows an accent-green ⛶ and hides its promote/swap verbs (260812-wfic R5)", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "code"] } });
    fireEvent.click(screen.getByRole("button", { name: "Zoom Code" }));
    const unzoom = screen.getByRole("button", { name: "Unzoom Code" });
    expect(unzoom.textContent).toBe("⛶");
    expect(unzoom.className).toContain("text-accent-green");
    // Promote/swap are no-ops on a zoomed render — hidden; ✕ stays.
    expect(screen.queryByRole("button", { name: "Promote Code" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Swap Code" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close Code" })).toBeTruthy();
    // Unzoom restores the default glyph color and the hidden verbs.
    fireEvent.click(unzoom);
    const zoom = screen.getByRole("button", { name: "Zoom Code" });
    expect(zoom.className).not.toContain("text-accent-green");
    expect(screen.getByRole("button", { name: "Promote Code" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Swap Code" })).toBeTruthy();
  });
});

describe("SurfaceLayout code tile folder (260813-if5d)", () => {
  it("renders the tile body and header basename from the window's folder (the latch)", () => {
    // The parent hands down the LATCHED folder as `gitRoot`; the tile can no
    // longer see the live derivation, so a pane switch cannot reach these.
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "code"] },
      window: { gitRoot: "/home/user/latched" },
    });
    expect(screen.getByTestId("mock-code")).toBeTruthy();
    expect(codeSpy.mock.calls.at(-1)?.[0]?.gitRoot).toBe("/home/user/latched");
    expect(screen.getByTestId("surface-tile-code").textContent).toContain("latched");
  });

  it("renders no code body (and no meta) when the window carries no folder", () => {
    // Never latched AND nothing derivable — exactly the pre-latch behavior.
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "code"] },
      window: { gitRoot: "" },
    });
    expect(screen.queryByTestId("mock-code")).toBeNull();
  });

  it("passes onCodeFolderNavigated straight through to the code tile", () => {
    const onCodeFolderNavigated = vi.fn();
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "code"] },
      onCodeFolderNavigated,
    });
    const reported = codeSpy.mock.calls.at(-1)?.[0]?.onFolderNavigated;
    expect(typeof reported).toBe("function");
    reported("/home/user/other");
    expect(onCodeFolderNavigated).toHaveBeenCalledWith("/home/user/other");
  });
});

describe("SurfaceLayout focused tile (260812-wfic R2)", () => {
  it("defaults to slot A: accent border + glyph there, and the callback reports its kind", () => {
    const onFocusedKindChange = vi.fn();
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "code"] },
      onFocusedKindChange,
    });
    expect(screen.getByTestId("surface-tile-tty").className).toContain("border-accent-green");
    expect(screen.getByTestId("surface-tile-code").className).toContain("rk-card-border");
    expect(screen.getByTestId("surface-tile-code").className).not.toContain(
      "border-accent-green",
    );
    expect(onFocusedKindChange).toHaveBeenLastCalledWith("tty");
  });

  it("pointerdown in a tile moves the accent border and reports the kind", () => {
    const onFocusedKindChange = vi.fn();
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "code"] },
      onFocusedKindChange,
    });
    fireEvent.pointerDown(screen.getByTestId("surface-tile-code"));
    expect(screen.getByTestId("surface-tile-code").className).toContain("border-accent-green");
    expect(screen.getByTestId("surface-tile-tty").className).not.toContain(
      "border-accent-green",
    );
    expect(onFocusedKindChange).toHaveBeenLastCalledWith("code");
  });

  it("focusin on a tile (e.g. the code iframe gaining focus) moves the focus", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "code"] } });
    fireEvent.focusIn(screen.getByTestId("surface-tile-code"));
    expect(screen.getByTestId("surface-tile-code").className).toContain("border-accent-green");
  });

  it("the code tile's onInteract seam (editor keydown/pointerdown) moves the focus", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "code"] } });
    const onInteract = codeSpy.mock.calls.at(-1)?.[0]?.onInteract;
    expect(typeof onInteract).toBe("function");
    act(() => onInteract());
    expect(screen.getByTestId("surface-tile-code").className).toContain("border-accent-green");
  });

  it("the web tile's onInteract seam (in-iframe click/keydown) moves the focus", () => {
    const onFocusedKindChange = vi.fn();
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "web"] },
      onFocusedKindChange,
    });
    const onInteract = iframeSpy.mock.calls.at(-1)?.[0]?.onInteract;
    expect(typeof onInteract).toBe("function");
    act(() => onInteract());
    expect(screen.getByTestId("surface-tile-web").className).toContain("border-accent-green");
    expect(onFocusedKindChange).toHaveBeenLastCalledWith("web");
  });

  it("closing the focused tile falls back to slot A (no stale highlight)", () => {
    const { rerender } = renderLayout({
      layout: { shape: "main-left", order: ["tty", "code", "web"] },
    });
    fireEvent.pointerDown(screen.getByTestId("surface-tile-web"));
    expect(screen.getByTestId("surface-tile-web").className).toContain("border-accent-green");
    // The parent applies the close: web leaves, the layout collapses 3→2.
    rerender(layoutElement({ layout: { shape: "split-h", order: ["tty", "code"] } }));
    expect(screen.getByTestId("surface-tile-tty").className).toContain("border-accent-green");
    expect(screen.getByTestId("surface-tile-code").className).not.toContain(
      "border-accent-green",
    );
  });

  it("arity 1 suppresses the highlight but still reports the kind (single:tty reads tty-focused)", () => {
    const onFocusedKindChange = vi.fn();
    renderLayout({ layout: { shape: "single", order: ["tty"] }, onFocusedKindChange });
    expect(screen.getByTestId("surface-tile-tty").className).not.toContain(
      "border-accent-green",
    );
    expect(onFocusedKindChange).toHaveBeenLastCalledWith("tty");
  });

  it("the focusTileRef seam focuses the first slot of a kind (the palette's path)", () => {
    const focusTileRef: { current: ((kind: SurfaceKind) => void) | null } = { current: null };
    const onFocusedKindChange = vi.fn();
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "code"] },
      focusTileRef,
      onFocusedKindChange,
    });
    expect(focusTileRef.current).not.toBeNull();
    act(() => focusTileRef.current?.("code"));
    expect(screen.getByTestId("surface-tile-code").className).toContain("border-accent-green");
    expect(onFocusedKindChange).toHaveBeenLastCalledWith("code");
    // A kind that is not open is a no-op.
    act(() => focusTileRef.current?.("chat"));
    expect(screen.getByTestId("surface-tile-code").className).toContain("border-accent-green");
  });
});

describe("SurfaceLayout header chrome (260812-wfic R3)", () => {
  it("renders the kind glyph, a 30px bg-bg-card header, and the meta as an inset chip", () => {
    renderLayout({ layout: { shape: "split-h", order: ["code", "web"] } });
    const codeTile = screen.getByTestId("surface-tile-code");
    const header = codeTile.firstElementChild!;
    expect(header.className).toContain("h-[30px]");
    expect(header.className).toContain("bg-bg-card");
    expect(header.className).toContain("text-[11px]");
    // The SURFACE_GLYPH kind glyph precedes the label.
    expect(header.textContent).toContain("{}");
    expect(header.textContent).toContain("Code");
    // The meta text is an inset chip, subordinate to the label.
    const chip = within(codeTile as HTMLElement).getByText("repo");
    expect(chip.className).toContain("bg-bg-inset");
    expect(chip.className).toContain("rounded");
    expect(chip.className).toContain("px-1.5");
    expect(chip.className).toContain("text-[10px]");
    expect(chip.className).toContain("truncate");
  });
});

describe("SurfaceLayout tty header status dot (260812-wfic R6)", () => {
  it("renders the StatusDot in tty headers only, and only when statusWindow is set", () => {
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "code"] },
      statusWindow: STATUS_WINDOW,
    });
    expect(
      within(screen.getByTestId("surface-tile-tty")).getByRole("img"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("surface-tile-code")).queryByRole("img"),
    ).toBeNull();
  });

  it("a null statusWindow renders no dot", () => {
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "code"] },
      statusWindow: null,
    });
    expect(
      within(screen.getByTestId("surface-tile-tty")).queryByRole("img"),
    ).toBeNull();
  });
});

describe("SurfaceLayout close/reopen identity (P3)", () => {
  it("a closed tile hides WITHOUT unmounting and reopens as the SAME element", () => {
    // Regression guard for the two-array render pitfall: visible + hidden
    // tiles must come from ONE flat keyed array — split `{arr1}{arr2}`
    // expression slots reconcile positionally and would remount a tile that
    // moves between them, discarding iframe/terminal state (caught by the
    // right-panel e2e element-identity assertion).
    const { rerender } = renderLayout({
      layout: { shape: "split-h", order: ["tty", "web"] },
    });
    const before = screen.getByTestId("mock-iframe");
    // Close the web tile (the parent re-renders with the collapsed layout).
    rerender(layoutElement({ layout: { shape: "single", order: ["tty"] } }));
    expect(screen.getByTestId("surface-tile-web").classList.contains("hidden")).toBe(true);
    expect(screen.getByTestId("mock-iframe")).toBe(before);
    // Reopen — still the identical element.
    rerender(layoutElement({ layout: { shape: "split-h", order: ["tty", "web"] } }));
    expect(screen.getByTestId("surface-tile-web").classList.contains("hidden")).toBe(false);
    expect(screen.getByTestId("mock-iframe")).toBe(before);
  });
});

describe("SurfaceLayout degradation + availability guards", () => {
  it("a tile whose capability vanished renders an empty body, never a broken iframe", () => {
    // The ladder's degradation should have dropped `code` already; the
    // component is the second line of defense.
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "code"] },
      window: { rkUrl: "http://localhost:8080" }, // no gitRoot
    });
    expect(screen.getByTestId("surface-tile-code")).toBeTruthy();
    expect(screen.queryByTestId("mock-code")).toBeNull();
  });
});

describe("SurfaceLayout duplicate tty tiles", () => {
  it("mounts two TerminalClients; only the first owns the shared refs/focus", () => {
    const wsRef: { current: WebSocket | null } = { current: null };
    const focusRef: { current: (() => void) | null } = { current: null };
    render(
      <SurfaceLayout
        layout={{ shape: "split-h", order: ["tty", "tty"] }}
        server="srv"
        windowId="@1"
        sessionName="sess"
        window={FULL_WINDOW}
        isMobile={false}
        wsRef={wsRef}
        focusRef={focusRef}
        scrollLocked={false}
        onSessionNotFound={vi.fn()}
        chat={{
          events: [],
          pending: null,
          connected: true,
          error: null,
          onSend: vi.fn(),
          busy: false,
        }}
        codeReachable
        onSwitchToTty={vi.fn()}
        onPromote={vi.fn()}
        onSwap={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("surface-tile-tty")).toBeTruthy();
    expect(screen.getByTestId("surface-tile-tty-2")).toBeTruthy();
    // Two mounted terminals (the spy fires per RENDER — count DOM mounts and
    // assert against the final render's two calls, in tile order).
    expect(screen.getAllByTestId("mock-terminal")).toHaveLength(2);
    const [primary, duplicate] = terminalSpy.mock.calls.slice(-2).map(([props]) => props);
    expect(primary.wsRef).toBe(wsRef);
    expect(primary.focusRef).toBe(focusRef);
    expect(primary.registerFocus).toBe(true);
    // The duplicate gets a dummy ws bucket, no focusRef, and must not fight
    // over the shell's focused-terminal slot.
    expect(duplicate.wsRef).not.toBe(wsRef);
    expect(duplicate.focusRef).toBeUndefined();
    expect(duplicate.registerFocus).toBe(false);
  });
});

describe("SurfaceLayout tty dock slot (260813-j3jb)", () => {
  const dock = <div data-testid="tty-dock">dock</div>;

  it("renders ttyDockContent inside the tty tile, after the terminal body", () => {
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "web"] },
      ttyDockContent: dock,
    });
    const tile = screen.getByTestId("surface-tile-tty");
    const mounted = within(tile).getByTestId("tty-dock");
    // Inside the tile frame — and the LAST child of the tile's flex column
    // (below the terminal body, above the tile's bottom edge).
    expect(mounted.parentElement).toBe(
      screen.getByTestId("mock-terminal").parentElement!.parentElement,
    );
    expect(mounted.parentElement!.lastElementChild).toBe(mounted);
    // The other tile hosts nothing.
    expect(
      within(screen.getByTestId("surface-tile-web")).queryByTestId("tty-dock"),
    ).toBeNull();
  });

  it("duplicate tty tiles: only the FIRST hosts the dock", () => {
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "tty"] },
      ttyDockContent: dock,
    });
    expect(
      within(screen.getByTestId("surface-tile-tty")).getByTestId("tty-dock"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("surface-tile-tty-2")).queryByTestId("tty-dock"),
    ).toBeNull();
  });

  it("renders nothing extra when ttyDockContent is absent", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "web"] } });
    expect(screen.queryByTestId("tty-dock")).toBeNull();
  });

  it("mobile never renders the dock (tile chrome is off there)", () => {
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "web"] },
      isMobile: true,
      ttyDockContent: dock,
    });
    expect(screen.queryByTestId("tty-dock")).toBeNull();
  });
});

describe("SurfaceLayout hide-never-unmount (P3)", () => {
  it("a closed tile stays mounted at display level for the route's lifetime", () => {
    const { rerender } = render(
      <SurfaceLayout
        layout={{ shape: "split-h", order: ["tty", "web"] }}
        server="srv"
        windowId="@1"
        sessionName="sess"
        window={FULL_WINDOW}
        isMobile={false}
        wsRef={{ current: null }}
        focusRef={{ current: null }}
        scrollLocked={false}
        onSessionNotFound={vi.fn()}
        chat={{
          events: [],
          pending: null,
          connected: true,
          error: null,
          onSend: vi.fn(),
          busy: false,
        }}
        codeReachable
        onSwitchToTty={vi.fn()}
        onPromote={vi.fn()}
        onSwap={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("mock-iframe")).toBeTruthy();

    rerender(
      <SurfaceLayout
        layout={{ shape: "single", order: ["tty"] }}
        server="srv"
        windowId="@1"
        sessionName="sess"
        window={FULL_WINDOW}
        isMobile={false}
        wsRef={{ current: null }}
        focusRef={{ current: null }}
        scrollLocked={false}
        onSessionNotFound={vi.fn()}
        chat={{
          events: [],
          pending: null,
          connected: true,
          error: null,
          onSend: vi.fn(),
          busy: false,
        }}
        codeReachable
        onSwitchToTty={vi.fn()}
        onPromote={vi.fn()}
        onSwap={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const webTile = screen.getByTestId("surface-tile-web");
    expect(webTile.classList.contains("hidden")).toBe(true);
    // The iframe is STILL MOUNTED — its in-memory state survives the close.
    expect(screen.getByTestId("mock-iframe")).toBeTruthy();
  });
});

describe("SurfaceLayout dividers (R5)", () => {
  it("persists ratios per (window, shape) on drag RELEASE only", () => {
    const onRatioCommit = vi.fn();
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "code"] },
      onRatioCommit,
    });
    const divider = screen.getByTestId("surface-divider-0");
    // jsdom's getBoundingClientRect is all zeros, so the move no-ops on the
    // unmeasured container; the release still commits the (default) ratios.
    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 300 });
    expect(localStorage.getItem(ratiosStorageKey("srv", "@1", "split-h"))).toBeNull();
    expect(onRatioCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(divider, { pointerId: 1 });
    expect(onRatioCommit).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(localStorage.getItem(ratiosStorageKey("srv", "@1", "split-h")) ?? "null"),
    ).toEqual([50]);
  });

  it("restores a persisted ratio for the (window, shape)", () => {
    localStorage.setItem(ratiosStorageKey("srv", "@1", "split-h"), JSON.stringify([70]));
    renderLayout({ layout: { shape: "split-h", order: ["tty", "code"] } });
    expect(
      screen.getByTestId("surface-divider-0").getAttribute("aria-valuenow"),
    ).toBe("70");
  });
});

describe("SurfaceLayout gap-seam tile chrome (260814-011r R1/R5; inset cede 260814-ldbs R8)", () => {
  it("the desktop grid keeps the 6px gutter but cedes the ground inset + ground to the Shell stage", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "code"] } });
    const grid = screen.getByTestId("surface-layout");
    expect(grid.className).toContain("gap-[6px]");
    // 260814-ldbs: the stage owns the 6px ground inset + the bg-bg-inset
    // ground now — the tile grid carries NEITHER (no double inset). Token
    // match: `gap-[6px]` would false-positive a naive `p-[6px]` substring.
    expect(grid.className.split(" ")).not.toContain("p-[6px]");
    expect(grid.className).not.toContain("bg-bg-inset");
    expect(grid.className).not.toContain("gap-[3px]");
  });

  it("the gutter applies at EVERY arity, including single (the stage supplies the inset)", () => {
    renderLayout({ layout: { shape: "single", order: ["tty"] } });
    const grid = screen.getByTestId("surface-layout");
    expect(grid.className).toContain("gap-[6px]");
    expect(grid.className.split(" ")).not.toContain("p-[6px]");
  });

  it("desktop tiles are 6px-radius cards with the dimmed rest border; the focused tile keeps full accent-green", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "code"] } });
    const ttyTile = screen.getByTestId("surface-tile-tty"); // focused (slot A default)
    const codeTile = screen.getByTestId("surface-tile-code");
    for (const tile of [ttyTile, codeTile]) {
      expect(tile.className).toContain("rounded-md");
    }
    expect(ttyTile.className).toContain("border-accent-green");
    expect(ttyTile.className).not.toContain("rk-card-border");
    expect(codeTile.className).toContain("rk-card-border");
    expect(codeTile.className).not.toContain("border-accent-green");
  });

  it("the mobile branch stays chrome-free (R5): flex-1 only, no gutter/inset/radius/border", () => {
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "code"] },
      isMobile: true,
    });
    const grid = screen.getByTestId("surface-layout");
    expect(grid.className).not.toContain("gap-[6px]");
    expect(grid.className).not.toContain("p-[6px]");
    const ttyTile = screen.getByTestId("surface-tile-tty");
    expect(ttyTile.className).toContain("flex-1");
    expect(ttyTile.className).not.toContain("rounded-md");
    expect(ttyTile.className).not.toContain("rk-card-border");
  });
});

describe("SurfaceLayout divider sash + grips (260814-011r R2)", () => {
  it("each divider carries the axis-aware sash pill and 3 pointer-events-none grip dots on a 14px hit zone", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "code"] } });
    const divider = screen.getByTestId("surface-divider-0");
    expect(divider.className).toContain("rk-divider");
    expect(divider.className).toContain("w-3.5"); // 14px hit zone (was w-1.5)
    expect(divider.className).toContain("cursor-col-resize");
    const sash = divider.querySelector(".rk-sash")!;
    expect(sash.className).toContain("rk-sash-v"); // x-axis divider → vertical pill
    expect(sash.className).toContain("pointer-events-none");
    const grips = divider.querySelector(".rk-grips")!;
    expect(grips.className).toContain("rk-grips-v");
    expect(grips.className).toContain("pointer-events-none");
    expect(grips.querySelectorAll("i")).toHaveLength(3);
    // Nothing is lit at rest — dots only, no sash.
    expect(divider.className).not.toContain("rk-sash-lit");
  });

  it("a y-axis divider orients the pill and dots horizontally", () => {
    renderLayout({ layout: { shape: "split-v", order: ["tty", "web"] } });
    const divider = screen.getByTestId("surface-divider-0");
    expect(divider.className).toContain("h-3.5");
    expect(divider.className).toContain("cursor-row-resize");
    expect(divider.querySelector(".rk-sash")!.className).toContain("rk-sash-h");
    expect(divider.querySelector(".rk-grips")!.className).toContain("rk-grips-h");
  });

  it("dragging lights the sash immediately (rk-sash-lit, zero delay); release unlights", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "code"] } });
    const divider = screen.getByTestId("surface-divider-0");
    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 500 });
    expect(divider.className).toContain("rk-sash-lit");
    fireEvent.pointerUp(divider, { pointerId: 1 });
    expect(divider.className).not.toContain("rk-sash-lit");
  });
});

describe("SurfaceLayout intersection zone (260814-011r R3)", () => {
  /** jsdom's rects are all zeros — mock the grid's box so the two-axis drag
   *  math has a measured container. 1200×1200 keeps the 280px floor at
   *  23.33…%, clear of the default boundaries. */
  function mockGridRect() {
    const grid = screen.getByTestId("surface-layout");
    vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1200,
      height: 1200,
      right: 1200,
      bottom: 1200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  }

  it("renders only in the main-* shapes (never single/split-*/row/col)", () => {
    for (const shape of ["main-left", "main-right", "main-top"] as const) {
      cleanup();
      renderLayout({ layout: { shape, order: ["tty", "code", "web"] } });
      expect(screen.getByTestId("surface-divider-intersection")).toBeTruthy();
    }
    const noJunction: [Layout["shape"], SurfaceKind[]][] = [
      ["single", ["tty"]],
      ["split-h", ["tty", "code"]],
      ["split-v", ["tty", "code"]],
      ["row", ["tty", "code", "web"]],
      ["col", ["tty", "code", "web"]],
    ];
    for (const [shape, order] of noJunction) {
      cleanup();
      renderLayout({ layout: { shape, order } });
      expect(screen.queryByTestId("surface-divider-intersection")).toBeNull();
    }
  });

  it("never renders while zoomed or on mobile", () => {
    renderLayout({ layout: { shape: "main-left", order: ["tty", "code", "web"] } });
    fireEvent.click(screen.getByRole("button", { name: "Zoom Terminal" }));
    expect(screen.queryByTestId("surface-divider-intersection")).toBeNull();
    cleanup();
    renderLayout({
      layout: { shape: "main-left", order: ["tty", "code", "web"] },
      isMobile: true,
    });
    expect(screen.queryByTestId("surface-divider-intersection")).toBeNull();
  });

  it("sits centered on the junction of the two dividers, z-ordered above them, with cursor: move", () => {
    renderLayout({ layout: { shape: "main-left", order: ["tty", "code", "web"] } });
    const zone = screen.getByTestId("surface-divider-intersection");
    // main-left defaults [100/3, 200/3]: the junction is (r0%, r1%).
    expect(zone.style.left).toBe(`${100 / 3}%`);
    expect(zone.style.top).toBe(`${200 / 3}%`);
    expect(zone.className).toContain("z-20"); // above the z-10 dividers
    expect(zone.className).toContain("-translate-x-1/2");
    expect(zone.className).toContain("-translate-y-1/2");
    expect(zone.className).toContain("w-5"); // the ~20px hit zone
    expect(zone.className).toContain("h-5");
    expect(zone.className).toContain("cursor-move");
    expect(zone.style.touchAction).toBe("none");
  });

  it("hovering the zone lights BOTH sashes (150ms-delayed hot state); leaving unlights them", () => {
    renderLayout({ layout: { shape: "main-left", order: ["tty", "code", "web"] } });
    const zone = screen.getByTestId("surface-divider-intersection");
    // React synthesizes pointerenter/leave from native pointerover/out.
    fireEvent.pointerOver(zone);
    expect(screen.getByTestId("surface-divider-0").className).toContain("rk-sash-hot");
    expect(screen.getByTestId("surface-divider-1").className).toContain("rk-sash-hot");
    expect(screen.getByTestId("surface-divider-0").className).not.toContain("rk-sash-lit");
    fireEvent.pointerOut(zone, { relatedTarget: document.body });
    expect(screen.getByTestId("surface-divider-0").className).not.toContain("rk-sash-hot");
    expect(screen.getByTestId("surface-divider-1").className).not.toContain("rk-sash-hot");
  });

  it("a diagonal drag moves BOTH ratios and persists both on RELEASE only (main-left: x→r0, y→r1)", () => {
    const onRatioCommit = vi.fn();
    renderLayout({
      layout: { shape: "main-left", order: ["tty", "code", "web"] },
      onRatioCommit,
    });
    mockGridRect();
    const zone = screen.getByTestId("surface-divider-intersection");
    const key = ratiosStorageKey("srv", "@1", "main-left");
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 400, clientY: 800 });
    // Both sashes light the moment the drag starts (zero delay).
    expect(screen.getByTestId("surface-divider-0").className).toContain("rk-sash-lit");
    expect(screen.getByTestId("surface-divider-1").className).toContain("rk-sash-lit");
    // (480, 720) on a 1200² grid → r0 = 40, r1 = 60 (both inside their clamps).
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 480, clientY: 720 });
    expect(screen.getByTestId("surface-divider-0").getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByTestId("surface-divider-1").getAttribute("aria-valuenow")).toBe("60");
    // Mid-drag: nothing persisted, no commit callback.
    expect(localStorage.getItem(key)).toBeNull();
    expect(onRatioCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(zone, { pointerId: 1 });
    expect(onRatioCommit).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual([40, 60]);
  });

  it("clamps each axis independently at the 280px floor", () => {
    renderLayout({ layout: { shape: "main-left", order: ["tty", "code", "web"] } });
    mockGridRect();
    const zone = screen.getByTestId("surface-divider-intersection");
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 400, clientY: 800 });
    // Drag to the extremes: x → the 23.33% floor, y → the 76.67% ceiling.
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 0, clientY: 1200 });
    expect(screen.getByTestId("surface-divider-0").getAttribute("aria-valuenow")).toBe("23");
    expect(screen.getByTestId("surface-divider-1").getAttribute("aria-valuenow")).toBe("77");
    fireEvent.pointerUp(zone, { pointerId: 1 });
  });

  /** The 20px zone: jsdom needs it measured for the release-point hit test. */
  function mockZoneRect(zone: HTMLElement, left: number, top: number) {
    vi.spyOn(zone, "getBoundingClientRect").mockReturnValue({
      left,
      top,
      width: 20,
      height: 20,
      right: left + 20,
      bottom: top + 20,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect);
  }

  it("a drag released OFF the junction unlights both sashes (capture eats pointerleave)", () => {
    renderLayout({ layout: { shape: "main-left", order: ["tty", "code", "web"] } });
    mockGridRect();
    const zone = screen.getByTestId("surface-divider-intersection");
    mockZoneRect(zone, 390, 790);
    fireEvent.pointerOver(zone);
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 400, clientY: 800 });
    // Drag past both clamps: the junction stops following, so the release
    // lands far from the zone with no leave event to clear the hot state.
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 0, clientY: 1200 });
    fireEvent.pointerUp(zone, { pointerId: 1, clientX: 0, clientY: 1200 });
    for (const id of ["surface-divider-0", "surface-divider-1"]) {
      expect(screen.getByTestId(id).className).not.toContain("rk-sash-hot");
      expect(screen.getByTestId(id).className).not.toContain("rk-sash-lit");
    }
  });

  it("a drag released ON the junction keeps both sashes hot", () => {
    renderLayout({ layout: { shape: "main-left", order: ["tty", "code", "web"] } });
    mockGridRect();
    const zone = screen.getByTestId("surface-divider-intersection");
    mockZoneRect(zone, 390, 790);
    fireEvent.pointerOver(zone);
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 400, clientY: 800 });
    fireEvent.pointerUp(zone, { pointerId: 1, clientX: 400, clientY: 800 });
    for (const id of ["surface-divider-0", "surface-divider-1"]) {
      expect(screen.getByTestId(id).className).toContain("rk-sash-hot");
      expect(screen.getByTestId(id).className).not.toContain("rk-sash-lit");
    }
  });

  it("a mid-drag pointercancel releases cleanly without stranding drag state", () => {
    renderLayout({ layout: { shape: "main-left", order: ["tty", "code", "web"] } });
    mockGridRect();
    const zone = screen.getByTestId("surface-divider-intersection");
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 400, clientY: 800 });
    fireEvent.pointerCancel(zone, { pointerId: 1 });
    // The cancel ran the end path: sashes unlit, and a stray move is a no-op.
    expect(screen.getByTestId("surface-divider-0").className).not.toContain("rk-sash-lit");
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 480, clientY: 720 });
    expect(screen.getByTestId("surface-divider-0").getAttribute("aria-valuenow")).toBe("33");
  });

  it("main-top maps y → ratio 0 and x → ratio 1", () => {
    renderLayout({ layout: { shape: "main-top", order: ["tty", "code", "web"] } });
    mockGridRect();
    const zone = screen.getByTestId("surface-divider-intersection");
    // main-top junction: (r1%, r0%).
    expect(zone.style.left).toBe(`${200 / 3}%`);
    expect(zone.style.top).toBe(`${100 / 3}%`);
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 800, clientY: 400 });
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 720, clientY: 480 });
    // y → r0 = 40 (within [23.33, 43.33]); x → r1 = 60 (within [56.67, 76.67]).
    expect(screen.getByTestId("surface-divider-0").getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByTestId("surface-divider-1").getAttribute("aria-valuenow")).toBe("60");
    fireEvent.pointerUp(zone, { pointerId: 1 });
    expect(
      JSON.parse(localStorage.getItem(ratiosStorageKey("srv", "@1", "main-top")) ?? "null"),
    ).toEqual([40, 60]);
  });
});

describe("SurfaceLayout mobile (R13 seam)", () => {
  it("renders only slot A full-width — no dividers, no verb chrome", () => {
    renderLayout({
      layout: { shape: "main-left", order: ["tty", "code", "web"] },
      isMobile: true,
    });
    const ttyTile = screen.getByTestId("surface-tile-tty");
    expect(ttyTile.classList.contains("hidden")).toBe(false);
    // The remaining resolved surfaces stay mounted-hidden (T014 turns them
    // into sheet tabs).
    expect(screen.getByTestId("surface-tile-code").classList.contains("hidden")).toBe(true);
    expect(screen.getByTestId("surface-tile-web").classList.contains("hidden")).toBe(true);
    expect(screen.queryByTestId("surface-divider-0")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close Code" })).toBeNull();
  });

  it("mobileActiveSlot swaps the shown surface WITHOUT touching the layout (T014)", () => {
    renderLayout({
      layout: { shape: "main-left", order: ["tty", "code", "web"] },
      isMobile: true,
      mobileActiveSlot: 1,
    });
    // Slot 1 (code) shows; the rest stay mounted-hidden.
    expect(screen.getByTestId("surface-tile-code").classList.contains("hidden")).toBe(false);
    expect(screen.getByTestId("surface-tile-tty").classList.contains("hidden")).toBe(true);
    expect(screen.getByTestId("surface-tile-web").classList.contains("hidden")).toBe(true);
  });

  it("an out-of-range mobileActiveSlot falls back to slot A", () => {
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "code"] },
      isMobile: true,
      mobileActiveSlot: 9,
    });
    expect(screen.getByTestId("surface-tile-tty").classList.contains("hidden")).toBe(false);
    expect(screen.getByTestId("surface-tile-code").classList.contains("hidden")).toBe(true);
  });
});

describe("SurfaceLayout zoom palette seam (T012/R11)", () => {
  it("registers a slot-A toggle and reports zoom flips via onZoomChange", () => {
    const zoomToggleRef: { current: (() => void) | null } = { current: null };
    const onZoomChange = vi.fn();
    renderLayout({
      layout: { shape: "split-h", order: ["tty", "code"] },
      zoomToggleRef,
      onZoomChange,
    });
    expect(zoomToggleRef.current).not.toBeNull();
    // The seam toggles slot A's zoom; flips are reported for the palette's
    // `Layout: Zoom`/`Unzoom` label gating.
    act(() => zoomToggleRef.current!());
    expect(onZoomChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId("surface-tile-code").classList.contains("hidden")).toBe(true);
    act(() => zoomToggleRef.current!());
    expect(onZoomChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId("surface-tile-code").classList.contains("hidden")).toBe(false);
  });
});
