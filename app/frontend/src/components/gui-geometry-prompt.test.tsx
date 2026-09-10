import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GuiGeometryPrompt } from "./gui-geometry-prompt";

function renderPrompt(overrides?: { onSubmit?: (geometry: string) => void; onClose?: () => void }) {
  const onSubmit = overrides?.onSubmit ?? vi.fn();
  const onClose = overrides?.onClose ?? vi.fn();
  render(<GuiGeometryPrompt onSubmit={onSubmit} onClose={onClose} />);
  return { onSubmit, onClose };
}

function input(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Width×Height" });
}

describe("GuiGeometryPrompt", () => {
  afterEach(cleanup);

  it("opens with an empty focused input and a disabled Resize button", () => {
    renderPrompt();
    expect(input()).toHaveAttribute("placeholder", "1440x900");
    expect(document.activeElement).toBe(input());
    expect(screen.getByRole("button", { name: "Resize" })).toBeDisabled();
  });

  it("Enter submits the normalized geometry", () => {
    const { onSubmit } = renderPrompt();
    fireEvent.change(input(), { target: { value: "1440×900" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("1440x900");
  });

  it("the Resize button submits like Enter", () => {
    const { onSubmit } = renderPrompt();
    fireEvent.change(input(), { target: { value: " 1440 900 " } });
    fireEvent.click(screen.getByRole("button", { name: "Resize" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("1440x900");
  });

  it("invalid input shows the inline error, disables Resize, and Enter is a no-op", () => {
    const { onSubmit } = renderPrompt();
    fireEvent.change(input(), { target: { value: "abc" } });
    expect(input()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Width×Height, 320–7680 per side")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resize" })).toBeDisabled();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("an out-of-range size shows the same inline error", () => {
    renderPrompt();
    fireEvent.change(input(), { target: { value: "100x100" } });
    expect(screen.getByText("Width×Height, 320–7680 per side")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resize" })).toBeDisabled();
  });

  it("Escape closes without submitting", () => {
    const { onSubmit, onClose } = renderPrompt();
    fireEvent.change(input(), { target: { value: "1440x900" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
