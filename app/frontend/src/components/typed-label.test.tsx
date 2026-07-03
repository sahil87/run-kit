import { render, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TypedLabel } from "./typed-label";

// jsdom has no `matchMedia`, so `prefersReducedMotion()`'s capability guard
// returns false and the sweep RUNS by default here. The reduced-motion test
// stubs matchMedia to exercise the JS skip.

// stepMs for a 2-char label: 350/2 = 175 → clamped to the 60ms max.
const STEP_2CH_MS = 60;

function getLabel(container: HTMLElement): Element {
  const el = container.querySelector(".rk-typed-label");
  expect(el).not.toBeNull();
  return el!;
}

describe("TypedLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the plain text at rest (no frame spans, no done state)", () => {
    const { container } = render(<TypedLabel text="Sessions" />);
    const label = getLabel(container);
    expect(label.textContent).toBe("Sessions");
    expect(label.classList.contains("rk-typed-done")).toBe(false);
    expect(container.querySelector(".rk-typed-cursor")).toBeNull();
  });

  it("passes className through to the label span", () => {
    const { container } = render(
      <TypedLabel text="Sessions" className="uppercase tracking-wide" />,
    );
    const label = getLabel(container);
    expect(label.classList.contains("uppercase")).toBe(true);
    expect(label.classList.contains("tracking-wide")).toBe(true);
  });

  it("starts the sweep on pointer enter: cursor on the first cell, rest faded", () => {
    const { container } = render(<TypedLabel text="AB" />);
    const label = getLabel(container);
    fireEvent.pointerEnter(label);

    const cursor = container.querySelector(".rk-typed-cursor");
    expect(cursor).not.toBeNull();
    // Inverse-video cursor renders the CHARACTER (not a caret glyph) — the
    // cursor sits ON the cell, so width never changes.
    expect(cursor!.textContent).toBe("A");
    expect(container.querySelector(".rk-typed-off")!.textContent).toBe("B");
    expect(label.textContent).toBe("AB");
  });

  it("advances the cursor per step and lands in the bright done state", () => {
    const { container } = render(<TypedLabel text="AB" />);
    const label = getLabel(container);
    fireEvent.pointerEnter(label);

    act(() => {
      vi.advanceTimersByTime(STEP_2CH_MS);
    });
    // Cursor moved to the second cell; first char is typed-bright.
    expect(container.querySelector(".rk-typed-on")!.textContent).toBe("A");
    expect(container.querySelector(".rk-typed-cursor")!.textContent).toBe("B");

    act(() => {
      vi.advanceTimersByTime(STEP_2CH_MS);
    });
    // Sweep complete: plain text again, held bright via rk-typed-done.
    expect(container.querySelector(".rk-typed-cursor")).toBeNull();
    expect(label.classList.contains("rk-typed-done")).toBe(true);
    expect(label.textContent).toBe("AB");
  });

  it("pointer leave cancels a mid-sweep pass and restores the rest state", () => {
    const { container } = render(<TypedLabel text="AB" />);
    const label = getLabel(container);
    fireEvent.pointerEnter(label);
    act(() => {
      vi.advanceTimersByTime(STEP_2CH_MS);
    });
    fireEvent.pointerLeave(label);

    expect(container.querySelector(".rk-typed-cursor")).toBeNull();
    expect(label.classList.contains("rk-typed-done")).toBe(false);
    expect(label.textContent).toBe("AB");
    // No stray timer keeps mutating after leave.
    act(() => {
      vi.advanceTimersByTime(STEP_2CH_MS * 4);
    });
    expect(container.querySelector(".rk-typed-cursor")).toBeNull();
  });

  it("skips the sweep entirely under prefers-reduced-motion (rest state IS the reduced state)", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true }),
    );
    const { container } = render(<TypedLabel text="AB" />);
    const label = getLabel(container);
    fireEvent.pointerEnter(label);

    expect(container.querySelector(".rk-typed-cursor")).toBeNull();
    expect(label.classList.contains("rk-typed-done")).toBe(false);
    expect(label.textContent).toBe("AB");
  });
});
