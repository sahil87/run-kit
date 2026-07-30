import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ShortcutsOverlay } from "./shortcuts-overlay";
import { KEYBINDINGS_STORAGE_KEY } from "@/lib/keybindings";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderOverlay(onClose = vi.fn()) {
  render(<ShortcutsOverlay open={true} onClose={onClose} />);
  return onClose;
}

describe("ShortcutsOverlay", () => {
  it("renders nothing when closed", () => {
    render(<ShortcutsOverlay open={false} onClose={() => {}} />);
    expect(screen.queryByTestId("shortcuts-overlay")).toBeNull();
  });

  it("renders the dialog with grouped rows, scope badges, and locked shell rows", () => {
    renderOverlay();
    const overlay = screen.getByTestId("shortcuts-overlay");
    expect(overlay.querySelector('[role="dialog"]')).not.toBeNull();
    // Group headings
    expect(screen.getByText("GLOBAL")).toBeInTheDocument();
    expect(screen.getByText("TERMINAL")).toBeInTheDocument();
    expect(screen.getByText("BOARD")).toBeInTheDocument();
    expect(screen.getByText("SHELL — DESKTOP APP")).toBeInTheDocument();
    // Starter rows
    expect(screen.getByText("New session")).toBeInTheDocument();
    expect(screen.getByText("Next window")).toBeInTheDocument();
    // Scope badges (terminal + board rows carry pills)
    expect(screen.getAllByText("terminal").length).toBeGreaterThan(0);
    // Locked shell rows (accelerators owned by the shell menu)
    expect(screen.getByText("Switch to server 1–9")).toBeInTheDocument();
    expect(
      screen.getAllByLabelText("Locked — bound by the desktop shell menu").length,
    ).toBeGreaterThan(0);
  });

  it("marks browser-reserved rows (jsdom is a browser host)", () => {
    renderOverlay();
    // N/T/W are browser-reserved outside the desktop shell.
    expect(screen.getAllByText("browser").length).toBe(3);
  });

  it("filters rows by the query and hides empty groups", () => {
    renderOverlay();
    fireEvent.change(screen.getByLabelText("Filter shortcuts"), {
      target: { value: "waiting" },
    });
    expect(screen.getByText("Next waiting agent")).toBeInTheDocument();
    expect(screen.queryByText("New session")).toBeNull();
    expect(screen.queryByText("BOARD")).toBeNull();
  });

  it("toggles keycap platform rendering (macOS ↔ Win·Linux)", () => {
    renderOverlay();
    // jsdom detects as non-mac → Shift/Ctrl keycaps present.
    expect(screen.getAllByText("Shift").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("macOS"));
    expect(screen.getAllByText("⇧").length).toBeGreaterThan(0);
  });

  it("click-to-capture rebinds, persists the diff, and shows the modified reset affordance", () => {
    renderOverlay();
    fireEvent.click(screen.getByLabelText("Change binding for Next window"));
    // Modifier-only press keeps capturing; then a valid shifted chord lands.
    fireEvent.keyDown(window, { key: "Shift", code: "ShiftLeft", shiftKey: true });
    fireEvent.keyDown(window, {
      key: "U",
      code: "KeyU",
      shiftKey: true,
      ctrlKey: true,
    });
    expect(JSON.parse(localStorage.getItem(KEYBINDINGS_STORAGE_KEY) ?? "{}")).toEqual({
      "window-next": { code: "KeyU", tier: "shifted" },
    });
    // Reset restores the default and drops the diff.
    fireEvent.click(screen.getByLabelText("Reset binding for Next window"));
    expect(localStorage.getItem(KEYBINDINGS_STORAGE_KEY)).toBeNull();
  });

  it("Escape cancels capture without persisting", () => {
    const onClose = renderOverlay();
    fireEvent.click(screen.getByLabelText("Change binding for Next window"));
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(localStorage.getItem(KEYBINDINGS_STORAGE_KEY)).toBeNull();
    // The capture-phase Escape must not close the overlay (capture-only cancel).
    expect(onClose).not.toHaveBeenCalled();
  });

  it("steal-with-warning: capturing another action's combo unbinds it and flags it", () => {
    renderOverlay();
    fireEvent.click(screen.getByLabelText("Change binding for Next window"));
    // ⇧Ctrl+A is owned by "Next waiting agent".
    fireEvent.keyDown(window, { key: "A", code: "KeyA", shiftKey: true, ctrlKey: true });
    expect(screen.getByText(/now unbound/)).toBeInTheDocument();
    expect(screen.getByTitle("unbound — click to rebind")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEYBINDINGS_STORAGE_KEY) ?? "{}")).toEqual({
      "window-next": { code: "KeyA", tier: "shifted" },
      "agent-next-waiting": null,
    });
  });

  it("reset all clears every override", () => {
    localStorage.setItem(
      KEYBINDINGS_STORAGE_KEY,
      JSON.stringify({ "window-next": { code: "KeyU", tier: "shifted" } }),
    );
    renderOverlay();
    fireEvent.click(screen.getByText("reset all"));
    expect(localStorage.getItem(KEYBINDINGS_STORAGE_KEY)).toBeNull();
  });

  it("Escape (outside capture) and the close button both close the overlay", () => {
    const onClose = renderOverlay();
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
