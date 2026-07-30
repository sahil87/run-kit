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

describe("ShortcutsOverlay CUSTOM section (260730-hbyh)", () => {
  const DISCUSS = {
    actionId: "macro:discuss",
    kind: "macro",
    label: "riff: discuss",
    target: { type: "riff", preset: "discuss" },
  };

  function renderWithTargets(opts?: {
    presets?: string[] | null;
    targets?: { id: string; label: string }[];
  }) {
    render(
      <ShortcutsOverlay
        open={true}
        onClose={vi.fn()}
        paletteTargets={opts?.targets ?? [{ id: "create-window", label: "Window: Create" }]}
        riffPresetNames={opts?.presets ?? ["discuss"]}
      />,
    );
  }

  it("renders no CUSTOM section when no macros exist and no targets are provided", () => {
    renderOverlay();
    expect(screen.queryByTestId("macro-section")).toBeNull();
  });

  it("renders macro rows with the command preview and an unbound state", () => {
    localStorage.setItem("runkit-macros", JSON.stringify([DISCUSS]));
    renderWithTargets();
    expect(screen.getByText("CUSTOM")).toBeInTheDocument();
    expect(screen.getByText("riff: discuss")).toBeInTheDocument();
    expect(screen.getByText("rk riff --preset discuss")).toBeInTheDocument();
    // No combo diff stored → unbound affordance.
    expect(screen.getByTitle("unbound — click to bind")).toBeInTheDocument();
    expect(screen.queryByText("missing preset")).toBeNull();
  });

  it("shows the missing-preset badge when the preset is absent from the known list", () => {
    localStorage.setItem(
      "runkit-macros",
      JSON.stringify([{ ...DISCUSS, target: { type: "riff", preset: "gone" } }]),
    );
    renderWithTargets({ presets: ["discuss"] });
    expect(screen.getByText("missing preset")).toBeInTheDocument();
  });

  it("shows no missing-preset badge when the preset list is unknown (null)", () => {
    localStorage.setItem("runkit-macros", JSON.stringify([DISCUSS]));
    renderWithTargets({ presets: null });
    expect(screen.queryByText("missing preset")).toBeNull();
  });

  it("add flow: pick a target, name it, add — macro persists and capture arms", () => {
    renderWithTargets();
    fireEvent.click(screen.getByText("+ bind a key to a palette action or riff preset…"));
    // Target list offers riff presets + palette actions (macros excluded).
    fireEvent.change(screen.getByLabelText("Search macro targets"), {
      target: { value: "discuss" },
    });
    fireEvent.click(screen.getByText("riff: discuss"));
    // Name pre-fills from the picked target; keep it and add.
    expect(screen.getByLabelText("Macro name")).toHaveValue("riff: discuss");
    fireEvent.click(screen.getByText("add + capture key"));

    const stored = JSON.parse(localStorage.getItem("runkit-macros") ?? "[]");
    expect(stored).toEqual([
      {
        actionId: "macro:riff-discuss",
        kind: "macro",
        label: "riff: discuss",
        target: { type: "riff", preset: "discuss" },
      },
    ]);
    // Capture armed on the fresh row.
    expect(screen.getByText("press keys…")).toBeInTheDocument();
    // Land a chord — the combo persists as an ordinary keybindings diff.
    fireEvent.keyDown(window, { code: "KeyD", key: "D", shiftKey: true, ctrlKey: true });
    expect(JSON.parse(localStorage.getItem(KEYBINDINGS_STORAGE_KEY) ?? "{}")).toEqual({
      "macro:riff-discuss": { code: "KeyD", tier: "shifted" },
    });
  });

  it("delete removes the macro definition and its keybindings diff", () => {
    localStorage.setItem("runkit-macros", JSON.stringify([DISCUSS]));
    localStorage.setItem(
      KEYBINDINGS_STORAGE_KEY,
      JSON.stringify({ "macro:discuss": { code: "KeyD", tier: "shifted" } }),
    );
    renderWithTargets();
    fireEvent.click(screen.getByLabelText("Delete macro riff: discuss"));
    expect(screen.queryByText("rk riff --preset discuss")).toBeNull();
    expect(localStorage.getItem("runkit-macros")).toBeNull();
    expect(localStorage.getItem(KEYBINDINGS_STORAGE_KEY)).toBeNull();
  });

  it("capturing a builtin's combo for a macro steals it and flags the victim", () => {
    localStorage.setItem("runkit-macros", JSON.stringify([DISCUSS]));
    renderWithTargets();
    fireEvent.click(screen.getByTitle("unbound — click to bind"));
    fireEvent.keyDown(window, { code: "KeyL", key: "L", shiftKey: true, ctrlKey: true });
    // Steal warning names the victim; the builtin is now unbound.
    expect(screen.getByText(/took Shift\+Ctrl\+L from “Next window”/)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEYBINDINGS_STORAGE_KEY) ?? "{}")).toEqual({
      "macro:discuss": { code: "KeyL", tier: "shifted" },
      "window-next": null,
    });
  });

  it("hides the add row when no paletteTargets prop is provided (board mount)", () => {
    localStorage.setItem("runkit-macros", JSON.stringify([DISCUSS]));
    renderOverlay();
    // Rows still render (view/rebind/delete), but no add flow.
    expect(screen.getByText("rk riff --preset discuss")).toBeInTheDocument();
    expect(
      screen.queryByText("+ bind a key to a palette action or riff preset…"),
    ).toBeNull();
  });
});
