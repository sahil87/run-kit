import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Dialog } from "./dialog";

afterEach(cleanup);

describe("Dialog", () => {
  it("renders title and children", () => {
    render(
      <Dialog title="Kill window?" onClose={() => {}}>
        <p>Are you sure?</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Kill window?")).toBeInTheDocument();
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
  });

  it("labels the dialog with the title", () => {
    render(
      <Dialog title="Kill window?" onClose={() => {}}>
        <p>body</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Kill window?" })).toBeInTheDocument();
  });

  it("focuses the first focusable element on mount", () => {
    render(
      <Dialog title="Confirm" onClose={() => {}}>
        <button type="button">Cancel</button>
        <button type="button">Kill</button>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Confirm" onClose={onClose}>
        <button type="button">Cancel</button>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps Tab from the last focusable to the first", () => {
    render(
      <Dialog title="Confirm" onClose={() => {}}>
        <button type="button">Cancel</button>
        <button type="button">Kill</button>
      </Dialog>,
    );
    const kill = screen.getByRole("button", { name: "Kill" });
    kill.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("wraps Shift+Tab from the first focusable to the last", () => {
    render(
      <Dialog title="Confirm" onClose={() => {}}>
        <button type="button">Cancel</button>
        <button type="button">Kill</button>
      </Dialog>,
    );
    // Mount focus already put us on the first focusable (Cancel).
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Kill" })).toHaveFocus();
  });

  it("calls onClose on backdrop click but not on dialog-body click", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Dialog title="Confirm" onClose={onClose}>
        <button type="button">Cancel</button>
      </Dialog>,
    );
    fireEvent.click(screen.getByText("Confirm"));
    expect(onClose).not.toHaveBeenCalled();
    // The outermost overlay div carries the close-on-click handler.
    fireEvent.click(container.firstElementChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
