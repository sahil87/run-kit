import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { useGlobalPaletteActions } from "./use-global-palette-actions";
import { CommandPalette, type PaletteAction } from "@/components/command-palette";
import { ChromeProvider } from "@/contexts/chrome-context";
import { SettingsDialogProvider } from "@/contexts/settings-dialog-context";
import { ToastProvider } from "@/components/toast";

/**
 * Tests for the layout-level global palette groups (260811-239r) — the hook
 * behind the single AppLayout-mounted CommandPalette. Verifies the group
 * composition/ordering (R9/R11: nav → font → refresh → help → shortcuts →
 * settings → update/check/maintenance/version), the route-walk-driven nav
 * mode (`Go: tmux Server` on terminal routes only), and the layout-lifted
 * shortcuts-overlay toggle wiring (R12).
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
let toggleOverlay: () => void = () => {};

function Probe() {
  const actions = useGlobalPaletteActions({ onToggleShortcutsOverlay: () => toggleOverlay() });
  captured = actions;
  return <CommandPalette actions={actions} />;
}

function renderHook(mockToggle: () => void = () => {}) {
  toggleOverlay = mockToggle;
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

  it("wires the shortcuts-overlay entry to the layout-lifted toggle (R12)", () => {
    const onToggle = vi.fn();
    renderHook(onToggle);
    const entry = captured.find((a) => a.id === "shortcuts-overlay");
    expect(entry?.label).toBe("Help: Keyboard Shortcuts");
    entry?.onSelect();
    expect(onToggle).toHaveBeenCalledOnce();
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
});
