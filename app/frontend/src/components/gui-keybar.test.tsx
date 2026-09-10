import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import {
  GuiKeyBar,
  composeChord,
  latchModifier,
  LATCH_ALL_OFF,
  type LatchMap,
  type SendKey,
} from "./gui-keybar";
import {
  KEYSYM_CONTROL_L,
  KEYSYM_ESCAPE,
  KEYSYM_TAB,
} from "@/lib/gui-keysyms";

afterEach(cleanup);

const armedCtrl: LatchMap = { ...LATCH_ALL_OFF, ctrl: "armed" };
const lockedCtrl: LatchMap = { ...LATCH_ALL_OFF, ctrl: "locked" };

describe("latchModifier", () => {
  it("steps off → armed → locked → off", () => {
    let state = LATCH_ALL_OFF;
    state = latchModifier(state, "ctrl");
    expect(state.ctrl).toBe("armed");
    state = latchModifier(state, "ctrl");
    expect(state.ctrl).toBe("locked");
    state = latchModifier(state, "ctrl");
    expect(state.ctrl).toBe("off");
    expect(state.alt).toBe("off");
  });
});

describe("composeChord", () => {
  it("wraps the key's press+release in the modifier down/up, in order", () => {
    const sendKey = vi.fn();
    const next = composeChord(sendKey, armedCtrl, KEYSYM_ESCAPE, "Escape");
    expect(sendKey.mock.calls).toEqual([
      [KEYSYM_CONTROL_L, "ControlLeft", true],
      [KEYSYM_ESCAPE, "Escape"],
      [KEYSYM_CONTROL_L, "ControlLeft", false],
    ]);
    expect(next.ctrl).toBe("off"); // armed is consumed by the chord
  });

  it("locked modifiers persist across chords", () => {
    const sendKey = vi.fn();
    const after1 = composeChord(sendKey, lockedCtrl, KEYSYM_ESCAPE, "Escape");
    const after2 = composeChord(sendKey, after1, KEYSYM_TAB, "Tab");
    expect(after2.ctrl).toBe("locked");
    expect(sendKey).toHaveBeenCalledTimes(6);
    expect(sendKey.mock.calls[3]).toEqual([KEYSYM_CONTROL_L, "ControlLeft", true]);
  });
});

function renderBar(sendKey?: SendKey) {
  return render(<GuiKeyBar sendKey={sendKey} />);
}

describe("GuiKeyBar", () => {
  it("renders the ten buttons", () => {
    renderBar(vi.fn());
    expect(screen.getByTestId("gui-keybar")).toBeInTheDocument();
    for (const name of ["Esc", "Tab", "Ctrl", "Alt", "⇧", "←", "↑", "↓", "→"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Toggle on-screen keyboard" })).toBeInTheDocument();
  });

  it("one tap arms (rendered pressed), a chord consumes it", () => {
    const sendKey = vi.fn();
    renderBar(sendKey);
    fireEvent.click(screen.getByRole("button", { name: "Ctrl" }));
    expect(screen.getByRole("button", { name: "Ctrl", pressed: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Esc" }));
    expect(sendKey.mock.calls).toEqual([
      [KEYSYM_CONTROL_L, "ControlLeft", true],
      [KEYSYM_ESCAPE, "Escape"],
      [KEYSYM_CONTROL_L, "ControlLeft", false],
    ]);
    expect(screen.getByRole("button", { name: "Ctrl", pressed: false })).toBeInTheDocument();
  });

  it("a second tap locks (pressed with ●) and persists across two keys; a third releases", () => {
    const sendKey = vi.fn();
    renderBar(sendKey);
    const ctrl = screen.getByRole("button", { name: "Ctrl" });
    fireEvent.click(ctrl);
    fireEvent.click(ctrl);
    expect(screen.getByRole("button", { name: "Ctrl ●", pressed: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Esc" }));
    fireEvent.click(screen.getByRole("button", { name: "Tab" }));
    expect(sendKey).toHaveBeenCalledTimes(6); // both chords carry Ctrl
    expect(screen.getByRole("button", { name: "Ctrl ●", pressed: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ctrl ●" }));
    expect(screen.getByRole("button", { name: "Ctrl", pressed: false })).toBeInTheDocument();
  });

  it("⌨ focuses the hidden input; a typed c with Ctrl armed chords and leaves the input empty", () => {
    const sendKey = vi.fn();
    renderBar(sendKey);
    fireEvent.click(screen.getByRole("button", { name: "Ctrl" })); // armed
    fireEvent.click(screen.getByRole("button", { name: "Toggle on-screen keyboard" }));

    const input = screen.getByLabelText("On-screen keyboard");
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "c" } });
    expect(sendKey.mock.calls).toEqual([
      [KEYSYM_CONTROL_L, "ControlLeft", true],
      [0x63, null],
      [KEYSYM_CONTROL_L, "ControlLeft", false],
    ]);
    expect(input).toHaveValue("");
    // The armed Ctrl was consumed by the chord.
    expect(screen.getByRole("button", { name: "Ctrl", pressed: false })).toBeInTheDocument();
  });

  it("forwards special keys via keydown with preventDefault", () => {
    const sendKey = vi.fn();
    renderBar(sendKey);
    const input = screen.getByLabelText("On-screen keyboard");
    input.focus();
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    fireEvent.keyDown(input, { key: "a" }); // printables ride the input path
    expect(sendKey.mock.calls).toEqual([[0xff0d, "Enter"]]);
  });

  it("tapping ⌨ again or blur releases the input", () => {
    renderBar(vi.fn());
    const toggle = screen.getByRole("button", { name: "Toggle on-screen keyboard" });
    const input = screen.getByLabelText("On-screen keyboard");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    fireEvent.blur(input);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("is inert without a live sendKey (no throw)", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Ctrl" }));
    fireEvent.click(screen.getByRole("button", { name: "Esc" }));
    fireEvent.change(screen.getByLabelText("On-screen keyboard"), { target: { value: "c" } });
    expect(screen.getByTestId("gui-keybar")).toBeInTheDocument();
  });
});
