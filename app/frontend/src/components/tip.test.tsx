import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { Tip, TipGroup, TIP_OPEN_DELAY_MS } from "@/components/tip";

/**
 * Unit tests for the tier-1 `Tip` tooltip (260722-73al). Interaction depth
 * (warm-cluster sweeps, viewport flipping) is covered by the e2e spec
 * (tests/e2e/tooltips.spec.ts); these tests pin the component contract:
 * content slots, ARIA wiring, focus-open, coarse-pointer suppression, and the
 * label-less pass-through.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // Tests that stub matchMedia clean up here so jsdom's default (undefined —
  // useCoarsePointer treats it as a fine pointer) is restored between tests.
  delete (window as { matchMedia?: unknown }).matchMedia;
});

/** Install a matchMedia stub whose `(pointer: coarse)` answer is `coarse`. */
function stubMatchMedia(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
    writable: true,
    configurable: true,
  });
}

describe("Tip — content and ARIA", () => {
  it("opens on focus and renders the label with role=tooltip + aria-describedby", () => {
    render(
      <Tip label="Refresh page">
        <button aria-label="Refresh page">R</button>
      </Tip>,
    );
    const button = screen.getByRole("button", { name: "Refresh page" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button).not.toHaveAttribute("aria-describedby");

    // Keyboard focus opens immediately (no delay). jsdom always passes the
    // :focus-visible check inside floating-ui's useFocus.
    act(() => {
      fireEvent.focus(button);
    });
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Refresh page");
    // The tooltip pattern: the anchored control is described by the tip.
    expect(button.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("renders the optional keycap chip and dim modifier note", () => {
    render(
      <Tip label="Send" kbd="Enter" note="⇧click: force">
        <button aria-label="Send text">Send</button>
      </Tip>,
    );
    act(() => {
      fireEvent.focus(screen.getByRole("button", { name: "Send text" }));
    });
    const tooltip = screen.getByRole("tooltip");
    // The kbd slot renders as a real <kbd> keycap chip, not inline text.
    const kbd = tooltip.querySelector("kbd");
    expect(kbd).not.toBeNull();
    expect(kbd).toHaveTextContent("Enter");
    expect(tooltip).toHaveTextContent("⇧click: force");
  });

  it("adds no wrapper element and sets no native title on the child", () => {
    const { container } = render(
      <Tip label="Back">
        <button aria-label="Go back">←</button>
      </Tip>,
    );
    // Clone-child API: the button is the container's direct child (layout and
    // the top-bar width probe see the identical DOM).
    expect(container.firstElementChild?.tagName).toBe("BUTTON");
    expect(container.firstElementChild).not.toHaveAttribute("title");
  });

  it("opens after the hover delay and closes on Escape", () => {
    vi.useFakeTimers();
    render(
      <Tip label="Forward">
        <button aria-label="Go forward">→</button>
      </Tip>,
    );
    const button = screen.getByRole("button", { name: "Go forward" });
    act(() => {
      fireEvent.mouseEnter(button);
    });
    // Not yet: the 300ms open delay is pending.
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(TIP_OPEN_DELAY_MS);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Forward");

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("works inside a TipGroup provider", () => {
    render(
      <TipGroup>
        <Tip label="Theme">
          <button aria-label="Theme">T</button>
        </Tip>
      </TipGroup>,
    );
    act(() => {
      fireEvent.focus(screen.getByRole("button", { name: "Theme" }));
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Theme");
  });
});

describe("Tip — suppression", () => {
  it("renders nothing under a coarse pointer (child untouched, no ARIA wiring)", () => {
    stubMatchMedia(true);
    render(
      <Tip label="Unpin from board">
        <button aria-label="Unpin from board">✕</button>
      </Tip>,
    );
    const button = screen.getByRole("button", { name: "Unpin from board" });
    act(() => {
      fireEvent.focus(button);
      fireEvent.mouseEnter(button);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button).not.toHaveAttribute("aria-describedby");
  });

  it("passes the child through untouched when label is absent", () => {
    render(
      <Tip label={undefined}>
        <button aria-label="Copy version">v1.0.0</button>
      </Tip>,
    );
    const button = screen.getByRole("button", { name: "Copy version" });
    act(() => {
      fireEvent.focus(button);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button).not.toHaveAttribute("aria-describedby");
  });
});
