import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SwatchPopover } from "./swatch-popover";
import { PICKER_COLOR_VALUES, HUE_FAMILIES } from "@/themes";

/** The LEGACY descriptor the write seam maps a family name to. The popover
 *  presents family names but emits the legacy vocabulary the backend stores
 *  (familyToLegacy), so onSelect assertions expect the legacy value. */
const legacyOf = (familyName: string): string =>
  HUE_FAMILIES.find((f) => f.name === familyName)!.legacy;

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

  it("renders 10 owned-family swatches + Clear", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);

    const options = screen.getAllByRole("option");
    // 10 family swatches + 1 Clear button
    expect(options).toHaveLength(11);
  });

  it("renders a swatch for every owned family name", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
    for (const value of PICKER_COLOR_VALUES) {
      expect(screen.getByRole("option", { name: `Color ${value}` })).toBeTruthy();
    }
  });

  it("shows checkmark on the selected family", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(
      <SwatchPopover selectedColor="orange" onSelect={onSelect} onClose={onClose} />,
    );

    const selected = screen.getByRole("option", { name: "Color orange" });
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(selected.textContent).toContain("✓");
  });

  it("highlights the family swatch when selectedColor is a LEGACY descriptor (1+3 → orange)", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(
      <SwatchPopover selectedColor="1+3" onSelect={onSelect} onClose={onClose} />,
    );
    // The legacy "1+3" value normalizes to the "orange" family swatch.
    const orange = screen.getByRole("option", { name: "Color orange" });
    expect(orange.getAttribute("aria-selected")).toBe("true");
    expect(orange.textContent).toContain("✓");
  });

  it("calls onSelect with the family's LEGACY descriptor when a swatch is clicked", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);

    // The popover presents the family name ("green") but emits the legacy value
    // ("2") the backend stores/validates (write-seam mapping, must-fix 1).
    fireEvent.click(screen.getByRole("option", { name: "Color green" }));
    expect(onSelect).toHaveBeenCalledWith(legacyOf("green"));
    expect(legacyOf("green")).toBe("2");
  });

  it("calls onSelect with null when Clear clicked", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(
      <SwatchPopover selectedColor="blue" onSelect={onSelect} onClose={onClose} />,
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

  it("ArrowRight reaches every swatch then Clear; Enter emits the family's legacy value", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);

    const listbox = screen.getByRole("listbox");
    // Step through all 10 swatches; on each, Enter emits that family's legacy
    // descriptor (the stored vocabulary), not the presented family name.
    for (let i = 0; i < PICKER_COLOR_VALUES.length; i++) {
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(legacyOf(PICKER_COLOR_VALUES[i]));
      fireEvent.keyDown(listbox, { key: "ArrowRight" });
    }
    // After 10 ArrowRights from index 0 we are on Clear (index 10); Enter clears.
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("ArrowDown from the bottom swatch row lands on Clear; Enter clears", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    // Focus starts on the first item of the last swatch row (slot 8, "magenta").
    renderWithTheme(<SwatchPopover selectedColor="magenta" onSelect={onSelect} onClose={onClose} />);

    const listbox = screen.getByRole("listbox");
    // In the 4-col grid, slot 8 ("magenta") + ArrowDown → Clear (no real swatch below).
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("ArrowUp from Clear returns to the swatch above its left edge (slot 6, blue)", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);

    const listbox = screen.getByRole("listbox");
    // Walk to Clear (10 ArrowRights from slot 0), then ArrowUp → slot 6, Enter selects it.
    for (let i = 0; i < PICKER_COLOR_VALUES.length; i++) {
      fireEvent.keyDown(listbox, { key: "ArrowRight" });
    }
    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    fireEvent.keyDown(listbox, { key: "Enter" });
    // Clear occupies col 2 of the final row (colorCount % 4 === 2); stepping up one
    // row lands on slot (row1)*4 + 2 = 6 → "blue", emitted as its legacy value "4".
    expect(onSelect).toHaveBeenLastCalledWith(legacyOf(PICKER_COLOR_VALUES[6]));
    expect(PICKER_COLOR_VALUES[6]).toBe("blue");
  });

  it("Clear renders inside the grid (col-span cell), still reachable by label", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover selectedColor="blue" onSelect={onSelect} onClose={onClose} />);
    const clear = screen.getByText("Clear");
    expect(clear.className).toContain("col-span-2");
    fireEvent.click(clear);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("Space emits the focused swatch's legacy value", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    // Start focused on "orange".
    renderWithTheme(<SwatchPopover selectedColor="orange" onSelect={onSelect} onClose={onClose} />);

    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(listbox, { key: " " });
    expect(onSelect).toHaveBeenCalledWith(legacyOf("orange"));
    expect(legacyOf("orange")).toBe("1+3");
  });

  it("the 10 families are the display-ordered picker values (no weight variants)", () => {
    expect(PICKER_COLOR_VALUES).toEqual(HUE_FAMILIES.map((f) => f.name));
    expect(PICKER_COLOR_VALUES).toHaveLength(10);
  });
});
