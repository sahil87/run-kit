import { describe, it, expect, vi, afterEach } from "vitest";
import { useRef } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useFocusTrap } from "./use-focus-trap";

/**
 * Harness component: renders a container holding ≥2 focusable buttons and drives
 * `useFocusTrap` from a ref to that container. `active`/`onEscape` are passed
 * through so each test controls activation.
 */
function Trap({ active, onEscape }: { active: boolean; onEscape: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active, onEscape);
  return (
    <div>
      <button type="button" data-testid="outside">
        outside
      </button>
      <div ref={ref} data-testid="container">
        <button type="button" data-testid="first">
          first
        </button>
        <button type="button" data-testid="middle">
          middle
        </button>
        <button type="button" data-testid="last">
          last
        </button>
      </div>
    </div>
  );
}

/**
 * Harness with a NESTED modal: the container holds its own focusable buttons
 * PLUS a `role="dialog" aria-modal="true"` descendant (mirroring `KillDialog`'s
 * `Dialog` rendering inside the drawer `<aside>`). The `aria-modal="true"` is
 * load-bearing: the trap only stands down for genuinely modal nested dialogs,
 * so a plain `role="dialog"` (e.g. the non-modal `PinPopover`) would NOT defer.
 * Drives the trap from a ref to the container so R10 (trap-defers-to-nested-
 * modal) can be exercised.
 */
function NestedTrap({ active, onEscape }: { active: boolean; onEscape: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active, onEscape);
  return (
    <div ref={ref} data-testid="container">
      <button type="button" data-testid="first">
        first
      </button>
      <button type="button" data-testid="last">
        last
      </button>
      <div role="dialog" aria-modal="true" data-testid="nested">
        <button type="button" data-testid="nested-button">
          nested
        </button>
      </div>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe("useFocusTrap", () => {
  it("focuses the first focusable element on activation", () => {
    const { getByTestId } = render(<Trap active onEscape={() => {}} />);
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("wraps Tab from the last focusable to the first", () => {
    const { getByTestId } = render(<Trap active onEscape={() => {}} />);
    const last = getByTestId("last");
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("wraps Shift+Tab from the first focusable to the last", () => {
    const { getByTestId } = render(<Trap active onEscape={() => {}} />);
    const first = getByTestId("first");
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(getByTestId("last"));
  });

  it("fires onEscape when Escape is pressed while active", () => {
    const onEscape = vi.fn();
    render(<Trap active onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("does not attach a listener or steal focus when inactive", () => {
    const onEscape = vi.fn();
    const addSpy = vi.spyOn(document, "addEventListener");
    const { getByTestId } = render(<Trap active={false} onEscape={onEscape} />);
    // No keydown listener attached while inactive.
    expect(addSpy.mock.calls.some(([type]) => type === "keydown")).toBe(false);
    // Focus is not moved into the container.
    expect(document.activeElement).not.toBe(getByTestId("first"));
    // Escape is inert.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
    addSpy.mockRestore();
  });

  it("removes the keydown listener when it deactivates", () => {
    const onEscape = vi.fn();
    const { rerender } = render(<Trap active onEscape={onEscape} />);
    rerender(<Trap active={false} onEscape={onEscape} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("stands down while a nested modal role=dialog aria-modal descendant is open (R10)", () => {
    const onEscape = vi.fn();
    const { getByTestId } = render(<NestedTrap active onEscape={onEscape} />);
    // Escape does NOT collapse the drawer — the nested modal owns its close.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
    // Tab from the last focusable does NOT wrap — the nested modal's own trap
    // governs; the drawer-wide wrap must not move focus into the rows behind.
    const last = getByTestId("last");
    last.focus();
    expect(document.activeElement).toBe(last);
    const ev = fireEvent.keyDown(document, { key: "Tab" });
    // Default not prevented (the trap took no action) and focus unchanged.
    expect(ev).toBe(true);
    expect(document.activeElement).toBe(last);
  });
});
