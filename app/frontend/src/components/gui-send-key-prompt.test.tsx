import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { GuiSendKeyPrompt } from "./gui-send-key-prompt";
import { parseKeyChord, SUGGESTED_CHORDS } from "@/lib/gui-send-key";
import { KEYSYM_F1, KEYSYM_SUPER_L } from "@/lib/gui-keysyms";

afterEach(cleanup);

describe("GuiSendKeyPrompt", () => {
  it("renders the five suggested chords as quick-pick chips", () => {
    render(<GuiSendKeyPrompt onSubmit={vi.fn()} onClose={vi.fn()} />);
    for (const chord of SUGGESTED_CHORDS) {
      expect(screen.getByRole("button", { name: chord })).toBeInTheDocument();
    }
  });

  it("tapping a chip submits that parsed chord immediately", () => {
    const onSubmit = vi.fn();
    render(<GuiSendKeyPrompt onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Alt+F4" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual(parseKeyChord("Alt+F4"));
    expect(onSubmit.mock.calls[0][0].key).toEqual({ keysym: KEYSYM_F1 + 3, code: "F4" });
  });

  it("a typed chord + Enter submits the parsed chord", () => {
    const onSubmit = vi.fn();
    render(<GuiSendKeyPrompt onSubmit={onSubmit} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Key chord");
    fireEvent.change(input, { target: { value: "Ctrl+Alt+Del" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual(parseKeyChord("Ctrl+Alt+Del"));
  });

  it("an unparseable non-empty value shows the inline error and disables Send", () => {
    const onSubmit = vi.fn();
    render(<GuiSendKeyPrompt onSubmit={onSubmit} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Key chord");
    fireEvent.change(input, { target: { value: "Ctrl+" } });
    expect(screen.getByText(/Not a chord/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a pristine empty field disables Send without the error", () => {
    render(<GuiSendKeyPrompt onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
    expect(screen.queryByText(/Not a chord/)).toBeNull();
  });

  it("Escape closes", () => {
    const onClose = vi.fn();
    render(<GuiSendKeyPrompt onSubmit={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("a modifiers-only suggestion (Super) submits the modifier chord", () => {
    const onSubmit = vi.fn();
    render(<GuiSendKeyPrompt onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Super" }));
    expect(onSubmit.mock.calls[0][0].key).toEqual({ keysym: KEYSYM_SUPER_L, code: "SuperLeft" });
  });
});
