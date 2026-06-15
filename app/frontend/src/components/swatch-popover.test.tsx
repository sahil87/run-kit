import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SwatchPopover } from "./swatch-popover";
import { PICKER_ANSI_INDICES, PICKER_COLOR_VALUES } from "@/themes";

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

  it("renders 10 color swatches (6 single + 4 blends)", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);

    const options = screen.getAllByRole("option");
    // 10 color swatches + 1 Clear button
    expect(options).toHaveLength(11);
  });

  it("renders a swatch for every picker color value, including the 4 blends", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
    for (const value of PICKER_COLOR_VALUES) {
      expect(screen.getByRole("option", { name: `Color ${value}` })).toBeTruthy();
    }
  });

  it("shows checkmark on selected color (blend)", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(
      <SwatchPopover selectedColor="1+3" onSelect={onSelect} onClose={onClose} />,
    );

    const selected = screen.getByRole("option", { name: "Color 1+3" });
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(selected.textContent).toContain("✓");
  });

  it("calls onSelect with color value string when a single swatch is clicked", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);

    fireEvent.click(screen.getByRole("option", { name: "Color 2" }));
    expect(onSelect).toHaveBeenCalledWith("2");
  });

  it("calls onSelect with a blend value when a blend swatch is clicked", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);

    fireEvent.click(screen.getByRole("option", { name: "Color 1+3" }));
    expect(onSelect).toHaveBeenCalledWith("1+3");
  });

  it("calls onSelect with null when Clear clicked", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(
      <SwatchPopover selectedColor="4" onSelect={onSelect} onClose={onClose} />,
    );

    fireEvent.click(screen.getByText("Clear"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("calls onClose on Escape", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ArrowRight reaches every swatch (including blends) then Clear; Enter selects", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);

    const listbox = screen.getByRole("listbox");
    // Step through all 10 swatches; on each, Enter must select that color value.
    for (let i = 0; i < PICKER_COLOR_VALUES.length; i++) {
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(PICKER_COLOR_VALUES[i]);
      fireEvent.keyDown(listbox, { key: "ArrowRight" });
    }
    // After 10 ArrowRights from index 0 we are on Clear (index 10); Enter clears.
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("ArrowDown from the bottom swatch row lands on Clear; Enter clears", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    // Focus starts on the first blend (slot 6, "1+3") via selectedColor.
    renderWithTheme(<SwatchPopover selectedColor="1+3" onSelect={onSelect} onClose={onClose} />);

    const listbox = screen.getByRole("listbox");
    // In the 4-col grid, slot 6 ("1+3") + ArrowDown → Clear (no real swatch below it).
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("ArrowUp from Clear returns to the swatch above its left edge (orange)", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);

    const listbox = screen.getByRole("listbox");
    // Walk to Clear (10 ArrowRights from slot 0), then ArrowUp → slot 6 ("1+3"), Enter selects it.
    for (let i = 0; i < PICKER_COLOR_VALUES.length; i++) {
      fireEvent.keyDown(listbox, { key: "ArrowRight" });
    }
    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("1+3");
  });

  it("Clear renders inside the grid (col-span cell), still reachable by label", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover selectedColor="4" onSelect={onSelect} onClose={onClose} />);
    const clear = screen.getByText("Clear");
    expect(clear.className).toContain("col-span-2");
    fireEvent.click(clear);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("Space selects the focused blend swatch", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    // Start focused on the first blend (orange, "1+3" — index 6).
    renderWithTheme(<SwatchPopover selectedColor="1+3" onSelect={onSelect} onClose={onClose} />);

    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: " " });
    expect(onSelect).toHaveBeenCalledWith("1+3");
  });

  it("excludes ANSI single indices 0, 7, 8, 9-15", () => {
    expect(PICKER_ANSI_INDICES).not.toContain(0);
    expect(PICKER_ANSI_INDICES).not.toContain(7);
    expect(PICKER_ANSI_INDICES).not.toContain(8);
    for (let i = 9; i <= 15; i++) {
      expect(PICKER_ANSI_INDICES).not.toContain(i);
    }
    expect(PICKER_ANSI_INDICES).toHaveLength(6);
  });
});
