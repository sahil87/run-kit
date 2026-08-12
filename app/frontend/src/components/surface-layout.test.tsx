import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { SurfaceLayout } from "./surface-layout";
import { ratiosStorageKey, type Layout, type SurfaceKind } from "@/lib/surface-layout";
import { stubMatchMedia } from "@/test-utils/match-media";

// jsdom does not implement matchMedia — Tip's coarse-pointer check needs it.
// Default to the fine-pointer branch (tooltips enabled).
stubMatchMedia(() => false);

// Heavy children are mocked (the RightPanel/app-test precedent): TerminalClient
// opens websockets and pulls in xterm's import-time addon init; the iframe/chat
// renderers are asserted by testid instead. `terminalSpy` records each mount's
// props so the duplicate-tty ref/focus rules are assertable.
const terminalSpy = vi.hoisted(() => vi.fn());
vi.mock("@/components/terminal-client", () => ({
  TerminalClient: (props: Record<string, unknown>) => {
    terminalSpy(props);
    return <div data-testid="mock-terminal" />;
  },
}));
vi.mock("@/components/code-surface", () => ({
  CodeSurface: () => <div data-testid="mock-code" />,
}));
vi.mock("@/components/iframe-window", () => ({
  IframeWindow: () => <div data-testid="mock-iframe" />,
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
  onRatioCommit?: () => void;
  zoomToggleRef?: { current: (() => void) | null };
  onZoomChange?: (zoomed: boolean) => void;
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
      onRatioCommit={overrides.onRatioCommit}
      zoomToggleRef={overrides.zoomToggleRef}
      onZoomChange={overrides.onZoomChange}
    />
  );
}

function renderLayout(overrides: LayoutOverrides = {}) {
  return render(layoutElement(overrides));
}

beforeEach(() => {
  localStorage.clear();
  terminalSpy.mockClear();
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
    // single renders no ⏶/◧/⇄/✕ (zoom is arity>1-only; closing the last
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

  it("verb buttons fade at rest (hover-cluster pattern)", () => {
    renderLayout({ layout: { shape: "split-h", order: ["tty", "code"] } });
    const button = screen.getByRole("button", { name: "Close Code" });
    expect(button.className).toContain("opacity-0");
    expect(button.className).toContain("group-hover:opacity-100");
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
