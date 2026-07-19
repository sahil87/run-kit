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

  it("autofocuses the listbox on mount so keyboard nav works immediately", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
    // The palette action is the only keyboard path into the picker; arrows are
    // dead until the listbox holds focus, so the popover focuses it on mount.
    expect(document.activeElement).toBe(screen.getByRole("listbox"));
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

  // ── Combined-label extension (hwtr): optional marker section + square flag. ──
  describe("combined Label picker (marker section + square styling)", () => {
    it("renders NO marker section when the marker props are absent (color-only, unchanged)", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      // Color-only: 10 swatches + Clear = 11 options, and no marker cells.
      expect(screen.getAllByRole("option")).toHaveLength(11);
      expect(screen.queryByRole("option", { name: /^Marker / })).toBeNull();
      // Default (rounded) container — no square styling.
      expect(screen.getByRole("listbox").className).toContain("rounded-md");
    });

    it("renders 4 marker cells (none/dotted/solid/double) when marker props supplied", () => {
      const onSelect = vi.fn();
      const onSelectMarker = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(
        <SwatchPopover
          onSelect={onSelect}
          onSelectMarker={onSelectMarker}
          markerColor="#8888ff"
          square
          onClose={onClose}
        />,
      );
      // 10 color swatches + Clear + 4 marker cells = 15 options.
      expect(screen.getAllByRole("option")).toHaveLength(15);
      for (const state of ["none", "dotted", "solid", "double"]) {
        expect(screen.getByRole("option", { name: `Marker ${state}` })).toBeTruthy();
      }
      // The listbox is labelled "Label picker" once markers are present.
      expect(screen.getByRole("listbox").getAttribute("aria-label")).toBe("Label picker");
    });

    it("clicking a marker cell calls onSelectMarker with that state (no cycling)", () => {
      const onSelect = vi.fn();
      const onSelectMarker = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(
        <SwatchPopover
          selectedMarker="dotted"
          onSelect={onSelect}
          onSelectMarker={onSelectMarker}
          markerColor="#8888ff"
          square
          onClose={onClose}
        />,
      );
      // Clicking "solid" directly picks solid — NOT the next cycle state.
      fireEvent.click(screen.getByRole("option", { name: "Marker solid" }));
      expect(onSelectMarker).toHaveBeenCalledWith("solid");
      // The current marker ("dotted") is highlighted.
      expect(screen.getByRole("option", { name: "Marker dotted" }).getAttribute("aria-selected")).toBe("true");
    });

    it("clicking the 'none' marker cell clears the marker (empty string)", () => {
      const onSelect = vi.fn();
      const onSelectMarker = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(
        <SwatchPopover
          selectedMarker="double"
          onSelect={onSelect}
          onSelectMarker={onSelectMarker}
          markerColor="#8888ff"
          square
          onClose={onClose}
        />,
      );
      fireEvent.click(screen.getByRole("option", { name: "Marker none" }));
      expect(onSelectMarker).toHaveBeenCalledWith("");
    });

    it("keyboard nav reaches the marker cells (ArrowDown from Clear) and Enter activates them", () => {
      const onSelect = vi.fn();
      const onSelectMarker = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(
        <SwatchPopover
          onSelect={onSelect}
          onSelectMarker={onSelectMarker}
          markerColor="#8888ff"
          square
          onClose={onClose}
        />,
      );
      const listbox = screen.getByRole("listbox");
      // Walk to Clear (10 ArrowRights from slot 0 — Clear is index 10 in the 5×2
      // square grid), ArrowDown into the first marker cell ("none"), then
      // ArrowRight twice to "solid", Enter activates.
      for (let i = 0; i < PICKER_COLOR_VALUES.length; i++) {
        fireEvent.keyDown(listbox, { key: "ArrowRight" });
      }
      fireEvent.keyDown(listbox, { key: "ArrowDown" }); // → marker "none"
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelectMarker).toHaveBeenLastCalledWith("");
      fireEvent.keyDown(listbox, { key: "ArrowRight" }); // dotted
      fireEvent.keyDown(listbox, { key: "ArrowRight" }); // solid
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelectMarker).toHaveBeenLastCalledWith("solid");
    });

    it("the square flag strips rounding and applies the hard offset block shadow", () => {
      const onSelect = vi.fn();
      const onSelectMarker = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(
        <SwatchPopover
          onSelect={onSelect}
          onSelectMarker={onSelectMarker}
          markerColor="#8888ff"
          square
          onClose={onClose}
        />,
      );
      const listbox = screen.getByRole("listbox");
      // No rounded container, no blurred shadow-lg; hard offset block shadow.
      expect(listbox.className).not.toContain("rounded-md");
      expect(listbox.className).not.toContain("shadow-lg");
      expect(listbox.getAttribute("style")).toContain("3px 3px 0");
      // Cells are square too (no rounded-sm).
      const swatch = screen.getByRole("option", { name: "Color orange" });
      expect(swatch.className).not.toContain("rounded-sm");
    });

    it("the square layout is a 5×2 swatch grid with 18px cells and a full-width Clear row", () => {
      const onSelect = vi.fn();
      const onSelectMarker = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(
        <SwatchPopover
          onSelect={onSelect}
          onSelectMarker={onSelectMarker}
          markerColor="#8888ff"
          square
          onClose={onClose}
        />,
      );
      // The 10 swatches fill a 5-column grid (→ perfect 5×2).
      const swatch = screen.getByRole("option", { name: "Color orange" });
      const colorGrid = swatch.parentElement!;
      expect(colorGrid.className).toContain("grid-cols-5");
      // 18px square swatch cells (intake §2 BINDING layout).
      expect(swatch.className).toContain("w-[18px]");
      expect(swatch.className).toContain("h-[18px]");
      // "Clear color" is a full-width row spanning all 5 columns.
      const clear = screen.getByText("Clear color");
      expect(clear.className).toContain("col-span-5");
    });

    it("the DEFAULT (color-only) layout is unchanged: 4-col grid, 20px cells, col-span-2 'Clear'", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      // Scoping decision: the 5×2/18px/full-width layout is gated to `square`, so
      // color-only callers (session/server/palette modal) render exactly as today.
      const swatch = screen.getByRole("option", { name: "Color orange" });
      expect(swatch.parentElement!.className).toContain("grid-cols-4");
      expect(swatch.className).toContain("w-5");
      const clear = screen.getByText("Clear");
      expect(clear.className).toContain("col-span-2");
    });
  });
});
