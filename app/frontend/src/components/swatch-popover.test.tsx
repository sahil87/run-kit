import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SwatchPopover } from "./swatch-popover";
import { PICKER_ANSI_INDICES } from "@/themes";

// Minimal ThemeProvider wrapper for tests
import { ThemeProvider } from "@/contexts/theme-context";

function mockMatchMedia() {
  const mql = {
    matches: true,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
}

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("SwatchPopover", () => {
  beforeEach(() => {
    mockMatchMedia();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders 7 color swatches", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);

    const options = screen.getAllByRole("option");
    // 7 color swatches + 1 Clear button
    expect(options).toHaveLength(8);
  });

  it("shows checkmark on selected color", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(
      <SwatchPopover selectedColor={4} onSelect={onSelect} onClose={onClose} />,
    );

    const selected = screen.getByRole("option", { name: "Color 4" });
    expect(selected.getAttribute("aria-selected")).toBe("true");
    // Check for checkmark character
    expect(selected.textContent).toContain("\u2713");
  });

  it("calls onSelect with color index when swatch clicked", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);

    const swatch = screen.getByRole("option", { name: "Color 2" });
    fireEvent.click(swatch);

    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("calls onSelect with null when Clear clicked", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(
      <SwatchPopover selectedColor={4} onSelect={onSelect} onClose={onClose} />,
    );

    const clearBtn = screen.getByText("Clear");
    fireEvent.click(clearBtn);

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("calls onClose on Escape", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("excludes ANSI indices 0, 7, 9-15 (except 8)", () => {
    expect(PICKER_ANSI_INDICES).not.toContain(0);
    expect(PICKER_ANSI_INDICES).not.toContain(7);
    for (let i = 9; i <= 15; i++) {
      expect(PICKER_ANSI_INDICES).not.toContain(i);
    }
    expect(PICKER_ANSI_INDICES).toHaveLength(7);
  });

  it("includes ANSI index 8 (bright black)", () => {
    expect(PICKER_ANSI_INDICES).toContain(8);
  });
});
