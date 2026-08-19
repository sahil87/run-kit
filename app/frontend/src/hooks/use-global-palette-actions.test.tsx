import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { useGlobalPaletteActions } from "./use-global-palette-actions";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";
import { ChromeProvider } from "@/contexts/chrome-context";
import { SettingsDialogProvider, useSettingsDialog } from "@/contexts/settings-dialog-context";
import { ToastProvider } from "@/components/toast";
import { registerSidebarRowFocuser } from "@/lib/sidebar-events";

/**
 * Tests for the layout-level global palette groups (260811-239r) — the hook
 * behind the single AppLayout-mounted CommandPalette. Verifies the group
 * composition/ordering (R9/R11: nav → font → refresh → help → shortcuts →
 * settings), the route-walk-driven nav mode (`Go: tmux Server` on terminal
 * routes only), and the settings-dialog deep-link wiring (260818-bncw: the
 * `shortcuts-overlay` entry toggles the dialog's Shortcuts tab; `Settings:
 * Open` is a tab-less pure opener; `Settings: Appearance` deep-links).
 */

let mockMatches: Array<{ params: Record<string, string> }> = [{ params: {} }];
const mockNavigate = vi.fn();
const mockBack = vi.fn();
const mockForward = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useMatches: () => mockMatches,
  useNavigate: () => mockNavigate,
  useRouter: () => ({ history: { back: () => mockBack(), forward: () => mockForward() } }),
}));

let captured: PaletteAction[] = [];
// Dialog-state probe so entry bodies can be asserted against the context.
let dialogState: { isOpen: boolean; activeTab: string } = { isOpen: false, activeTab: "general" };

function Probe() {
  const actions = useGlobalPaletteActions();
  captured = actions;
  const { isOpen, activeTab } = useSettingsDialog();
  dialogState = { isOpen, activeTab };
  return <CommandPalette actions={actions} />;
}

function renderHook() {
  render(
    <ToastProvider>
      <ChromeProvider>
        <SettingsDialogProvider>
          <Probe />
        </SettingsDialogProvider>
      </ChromeProvider>
    </ToastProvider>,
  );
}

function openPalette() {
  fireEvent.keyDown(document, { key: "k", code: "KeyK", metaKey: true });
}

function ids(): string[] {
  return captured.map((a) => a.id);
}

describe("useGlobalPaletteActions", () => {
  beforeEach(() => {
    mockMatches = [{ params: {} }];
    mockNavigate.mockReset();
    mockBack.mockReset();
    mockForward.mockReset();
    captured = [];
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("builds the global groups in the canonical relative order (nav → font → refresh → help → shortcuts → settings)", () => {
    renderHook();
    const order = ids();
    const expectInOrder = [
      "go-back",
      "go-forward",
      "go-host",
      "terminal-font-increase",
      "terminal-font-decrease",
      "terminal-font-reset",
      "refresh-page",
      "help-documentation",
      "shortcuts-overlay",
      "settings-open",
      "settings-appearance",
    ];
    expect(order.slice(0, expectInOrder.length)).toEqual(expectInOrder);
  });

  it("offers Go: tmux Server only on a terminal route (window param present)", () => {
    mockMatches = [{ params: { server: "alpha" } }, { params: { server: "alpha", window: "@1" } }];
    renderHook();
    expect(ids()).toContain("go-tmux-server");

    cleanup();
    mockMatches = [{ params: { name: "main" } }];
    renderHook();
    expect(ids()).not.toContain("go-tmux-server");
    expect(ids()).toContain("go-host");
  });

  it("nav entries drive router history / navigation", () => {
    renderHook();
    const byId = new Map(captured.map((a) => [a.id, a]));
    byId.get("go-back")?.onSelect();
    expect(mockBack).toHaveBeenCalledOnce();
    byId.get("go-forward")?.onSelect();
    expect(mockForward).toHaveBeenCalledOnce();
    byId.get("go-host")?.onSelect();
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("the shortcuts-overlay entry toggles the dialog's Shortcuts tab (260818-bncw three-state rule)", () => {
    renderHook();
    const fire = () => captured.find((a) => a.id === "shortcuts-overlay")?.onSelect();
    // Closed → open on Shortcuts.
    act(() => fire());
    expect(dialogState).toEqual({ isOpen: true, activeTab: "shortcuts" });
    // Open on Shortcuts → close.
    act(() => fire());
    expect(dialogState.isOpen).toBe(false);
    // Open on ANOTHER tab → switch to Shortcuts, no close.
    act(() => captured.find((a) => a.id === "settings-appearance")?.onSelect());
    expect(dialogState).toEqual({ isOpen: true, activeTab: "appearance" });
    act(() => fire());
    expect(dialogState).toEqual({ isOpen: true, activeTab: "shortcuts" });
  });

  it("Settings: Open is a pure opener — re-fire while open never closes and never yanks the tab", () => {
    renderHook();
    const open = () => captured.find((a) => a.id === "settings-open")?.onSelect();
    act(() => open());
    expect(dialogState).toEqual({ isOpen: true, activeTab: "general" });
    // Re-fire while open on Shortcuts: no close, no tab reset.
    act(() => captured.find((a) => a.id === "shortcuts-overlay")?.onSelect());
    expect(dialogState.activeTab).toBe("shortcuts");
    act(() => open());
    expect(dialogState).toEqual({ isOpen: true, activeTab: "shortcuts" });
  });

  it("Settings: Appearance deep-links the Appearance tab (id settings-appearance)", () => {
    renderHook();
    const entry = captured.find((a) => a.id === "settings-appearance");
    expect(entry?.label).toBe("Settings: Appearance");
    act(() => entry?.onSelect());
    expect(dialogState).toEqual({ isOpen: true, activeTab: "appearance" });
  });

  it("renders the global entries through the palette (id/label identity)", () => {
    renderHook();
    openPalette();
    expect(screen.getByText("Go: Back")).toBeInTheDocument();
    expect(screen.getByText("Increase terminal font")).toBeInTheDocument();
    expect(screen.getByText("View: Refresh Page")).toBeInTheDocument();
    expect(screen.getByText("Help: Documentation")).toBeInTheDocument();
    expect(screen.getByText("Help: Keyboard Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Settings: Open")).toBeInTheDocument();
    expect(screen.getByText("Settings: Appearance")).toBeInTheDocument();
  });

  it("registers the four Panel: Toggle actions, each flipping its section's persisted boolean (iha5 R6)", () => {
    renderHook();
    const byId = new Map(captured.map((a) => [a.id, a]));
    expect(byId.get("panel-toggle-boards")?.label).toBe("Panel: Toggle Boards");
    expect(byId.get("panel-toggle-server")?.label).toBe("Panel: Toggle Server");
    expect(byId.get("panel-toggle-pane")?.label).toBe("Panel: Toggle Pane");
    expect(byId.get("panel-toggle-host")?.label).toBe("Panel: Toggle Host");

    // Defaults: boards/server on, pane/host off.
    act(() => byId.get("panel-toggle-pane")?.onSelect());
    expect(localStorage.getItem("runkit-sidebar-section-pane")).toBe("true");
    expect(localStorage.getItem("runkit-sidebar-section-host")).toBeNull();

    act(() => byId.get("panel-toggle-boards")?.onSelect());
    expect(localStorage.getItem("runkit-sidebar-section-boards")).toBe("false");
  });

  it("Sidebar: Toggle flips the persisted visibility; Sidebar: Focus is the show+focus arm", () => {
    // jsdom ships no rAF without pretendToBeVisual — run the deferred focus
    // synchronously (the logo-spinner/terminal-client stub precedent).
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    renderHook();
    const fire = (id: string) => captured.find((a) => a.id === id)?.onSelect();
    const byId = new Map(captured.map((a) => [a.id, a]));
    expect(byId.get("sidebar-toggle")?.label).toBe("Sidebar: Toggle");
    expect(byId.get("sidebar-focus")?.label).toBe("Sidebar: Focus");
    // The id = actionId join decorates Toggle with the effective sidebar
    // chord; Focus (id ≠ actionId) carries no hint.
    expect(byId.get("sidebar-toggle")?.shortcut).toBeTruthy();
    expect(byId.get("sidebar-focus")?.shortcut).toBeUndefined();

    // Toggle flips the persisted boolean both ways (jsdom default: open).
    act(() => fire("sidebar-toggle"));
    expect(localStorage.getItem("runkit-sidebar-open")).toBe("false");
    act(() => fire("sidebar-toggle"));
    expect(localStorage.getItem("runkit-sidebar-open")).toBe("true");

    // Focus on a visible sidebar routes through the registered row focuser
    // without touching visibility.
    const focus = vi.fn(() => true);
    const unregister = registerSidebarRowFocuser(focus);
    act(() => fire("sidebar-focus"));
    expect(focus).toHaveBeenCalledOnce();
    expect(localStorage.getItem("runkit-sidebar-open")).toBe("true");

    // Focus on a hidden sidebar opens it first, then focuses on the deferred
    // frame (the focuser registers on the sidebar's mount).
    focus.mockClear();
    act(() => fire("sidebar-toggle")); // hide
    expect(localStorage.getItem("runkit-sidebar-open")).toBe("false");
    act(() => fire("sidebar-focus"));
    expect(localStorage.getItem("runkit-sidebar-open")).toBe("true");
    expect(focus).toHaveBeenCalledOnce();
    unregister();
  });
});
