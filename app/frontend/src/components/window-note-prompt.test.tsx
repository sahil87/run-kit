import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { WindowNotePrompt } from "./window-note-prompt";

// The prompt behind `Window: Set note…` (260824-bb5n R5): pre-filled with the
// window's current note, an empty submit CLEARS it, Escape/backdrop close via
// the Dialog shell.

afterEach(cleanup);

describe("WindowNotePrompt", () => {
  it("pre-fills with the current note and submits the edited text", () => {
    const onSubmit = vi.fn();
    render(<WindowNotePrompt defaultNote="blocked on flaky e2e" onSubmit={onSubmit} onClose={vi.fn()} />);

    const input = screen.getByLabelText("Tab note");
    expect(input).toHaveValue("blocked on flaky e2e");

    fireEvent.change(input, { target: { value: "waiting on review" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("waiting on review");
  });

  it("trims the submitted text", () => {
    const onSubmit = vi.fn();
    render(<WindowNotePrompt defaultNote="" onSubmit={onSubmit} onClose={vi.fn()} />);

    const input = screen.getByLabelText("Tab note");
    fireEvent.change(input, { target: { value: "  hi  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("hi");
  });

  it("an empty submit clears the note (submits the empty string)", () => {
    const onSubmit = vi.fn();
    render(<WindowNotePrompt defaultNote="old note" onSubmit={onSubmit} onClose={vi.fn()} />);

    const input = screen.getByLabelText("Tab note");
    fireEvent.change(input, { target: { value: "" } });
    // The button flips to its clear affordance on an empty value.
    expect(screen.getByRole("button", { name: "Clear note" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear note" }));
    expect(onSubmit).toHaveBeenCalledWith("");
  });

  it("the button reads Set note while the value is non-empty", () => {
    render(<WindowNotePrompt defaultNote="x" onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Set note" })).toBeInTheDocument();
  });
});
