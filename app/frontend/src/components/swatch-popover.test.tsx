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

  it("renders 10 owned-family swatches + Clear color", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);

    const options = screen.getAllByRole("option");
    // 10 family swatches + 1 Clear color button
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

  it("calls onSelect with null when Clear color clicked", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(
      <SwatchPopover selectedColor="blue" onSelect={onSelect} onClose={onClose} />,
    );

    fireEvent.click(screen.getByText("Clear color"));
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

  it("the 10 families are the display-ordered picker values (no weight variants)", () => {
    expect(PICKER_COLOR_VALUES).toEqual(HUE_FAMILIES.map((f) => f.name));
    expect(PICKER_COLOR_VALUES).toHaveLength(10);
  });

  // ── Universal square style (maya): the ONLY style — no `square` prop. ──
  describe("universal square style", () => {
    it("every caller gets the square container: no rounding, hard offset block shadow", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const listbox = screen.getByRole("listbox");
      expect(listbox.className).not.toContain("rounded-md");
      expect(listbox.className).not.toContain("shadow-lg");
      expect(listbox.getAttribute("style")).toContain("3px 3px 0");
      // Cells are square too (no rounded-sm) and 18px.
      const swatch = screen.getByRole("option", { name: "Color orange" });
      expect(swatch.className).not.toContain("rounded-sm");
      expect(swatch.className).toContain("w-[18px]");
      expect(swatch.className).toContain("h-[18px]");
    });

    it("Clear color is a full-width first row spanning the 4 color columns (no col-span-2 corner cell)", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const clear = screen.getByText("Clear color");
      expect(clear.className).toContain("col-span-4");
      // The color grid itself is 4-wide (rows of 4/4/2 below the removal row).
      expect(clear.parentElement!.className).toContain("grid-cols-4");
      fireEvent.click(clear);
      expect(onSelect).toHaveBeenCalledWith(null);
    });
  });

  // ── Color-only keyboard nav: the conceptual grid minus the marker column. ──
  describe("keyboard navigation (color-only grid)", () => {
    it("initial focus is the first swatch when uncolored; Enter emits its legacy value", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(legacyOf(PICKER_COLOR_VALUES[0]));
    });

    it("initial focus lands on the selected swatch (magenta, row 3)", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(
        <SwatchPopover selectedColor="magenta" onSelect={onSelect} onClose={onClose} />,
      );
      fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(legacyOf("magenta"));
      expect(PICKER_COLOR_VALUES[8]).toBe("magenta");
    });

    it("ArrowRight walks a color row and clamps at its right edge", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const listbox = screen.getByRole("listbox");
      // Row 1: colors 0–3. Three ArrowRights reach the row end (col 4).
      for (let i = 0; i < 3; i++) fireEvent.keyDown(listbox, { key: "ArrowRight" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(legacyOf(PICKER_COLOR_VALUES[3]));
      // A fourth ArrowRight clamps (no wrap into the next row).
      fireEvent.keyDown(listbox, { key: "ArrowRight" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(legacyOf(PICKER_COLOR_VALUES[3]));
    });

    it("ArrowDown moves down a column; from the dead cells' columns it clamps to the last color of row 3", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const listbox = screen.getByRole("listbox");
      // Walk to (row 1, col 4), then down to (row 2, col 4) = color 7.
      for (let i = 0; i < 3; i++) fireEvent.keyDown(listbox, { key: "ArrowRight" });
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(legacyOf(PICKER_COLOR_VALUES[7]));
      // Row 3 holds only colors 8–9 (cols 1–2): ArrowDown from col 4 lands on
      // the nearest valid cell — color 9 (col 2), not a dead cell.
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(legacyOf(PICKER_COLOR_VALUES[9]));
      // ArrowDown at the bottom row is a no-op.
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(legacyOf(PICKER_COLOR_VALUES[9]));
    });

    it("ArrowUp from row 1 lands on the single Clear color target; Enter clears", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const listbox = screen.getByRole("listbox");
      // From ANY column of row 1 (walk right two cells first), ArrowUp → Clear.
      fireEvent.keyDown(listbox, { key: "ArrowRight" });
      fireEvent.keyDown(listbox, { key: "ArrowRight" });
      fireEvent.keyDown(listbox, { key: "ArrowUp" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(null);
      // ArrowUp at the top row is a no-op (still Clear).
      fireEvent.keyDown(listbox, { key: "ArrowUp" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(null);
    });

    it("ArrowDown from Clear color enters the first color row", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const listbox = screen.getByRole("listbox");
      fireEvent.keyDown(listbox, { key: "ArrowUp" }); // (1,1) → Clear
      fireEvent.keyDown(listbox, { key: "ArrowDown" }); // Clear → (1,1)
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(legacyOf(PICKER_COLOR_VALUES[0]));
    });

    it("ArrowLeft at the left edge is a no-op when no marker column exists", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const listbox = screen.getByRole("listbox");
      fireEvent.keyDown(listbox, { key: "ArrowLeft" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(legacyOf(PICKER_COLOR_VALUES[0]));
    });

    it("Space emits the focused swatch's legacy value", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      // Start focused on "orange".
      renderWithTheme(
        <SwatchPopover selectedColor="orange" onSelect={onSelect} onClose={onClose} />,
      );
      fireEvent.keyDown(screen.getByRole("listbox"), { key: " " });
      expect(onSelect).toHaveBeenCalledWith(legacyOf("orange"));
      expect(legacyOf("orange")).toBe("1+3");
    });
  });

  // ── Combined Label picker (maya): side-by-side marker column | hairline |
  //    color grid. Marker section still gated on onSelectMarker + markerColor. ──
  describe("combined Label picker (side-by-side marker column)", () => {
    function renderLabelPicker(extra: Partial<React.ComponentProps<typeof SwatchPopover>> = {}) {
      const onSelect = vi.fn();
      const onSelectMarker = vi.fn();
      const onClose = vi.fn();
      const utils = renderWithTheme(
        <SwatchPopover
          onSelect={onSelect}
          onSelectMarker={onSelectMarker}
          markerColor="#8888ff"
          onClose={onClose}
          {...extra}
        />,
      );
      return { onSelect, onSelectMarker, onClose, ...utils };
    }

    it("renders NO marker column and NO hairline when the marker props are absent", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      const { container } = renderWithTheme(
        <SwatchPopover onSelect={onSelect} onClose={onClose} />,
      );
      // Color-only: 10 swatches + Clear color = 11 options, no marker cells.
      expect(screen.getAllByRole("option")).toHaveLength(11);
      expect(screen.queryByRole("option", { name: /^Marker / })).toBeNull();
      // No vertical hairline divider.
      expect(container.querySelector(".w-px")).toBeNull();
      expect(screen.getByRole("listbox").getAttribute("aria-label")).toBe("Color picker");
    });

    it("renders 4 marker cells (none/dotted/solid/double) in a left column beside a vertical hairline", () => {
      const { container } = renderLabelPicker();
      // 10 color swatches + Clear color + 4 marker cells = 15 options.
      expect(screen.getAllByRole("option")).toHaveLength(15);
      for (const state of ["none", "dotted", "solid", "double"]) {
        expect(screen.getByRole("option", { name: `Marker ${state}` })).toBeTruthy();
      }
      // The listbox is labelled "Label picker" once markers are present.
      expect(screen.getByRole("listbox").getAttribute("aria-label")).toBe("Label picker");
      // The vertical hairline divides the two sections.
      expect(container.querySelector(".w-px")).not.toBeNull();
      // The marker cells live in a single left column, ∅ first (the removal
      // row), then dotted/solid/double beside the three color rows.
      const markerCol = screen.getByRole("option", { name: "Marker none" }).parentElement!;
      expect(markerCol.className).toContain("flex-col");
      const cells = Array.from(markerCol.querySelectorAll("[data-marker-value]"));
      expect(cells.map((c) => c.getAttribute("data-marker-value"))).toEqual([
        "",
        "dotted",
        "solid",
        "double",
      ]);
      // Marker cells share the 18px square metric so rows align 1:1.
      expect((cells[0] as HTMLElement).className).toContain("w-[18px]");
      expect((cells[0] as HTMLElement).className).toContain("h-[18px]");
    });

    it("clicking a marker cell calls onSelectMarker with that state (no cycling)", () => {
      const { onSelectMarker } = renderLabelPicker({ selectedMarker: "dotted" });
      // Clicking "solid" directly picks solid — NOT the next cycle state.
      fireEvent.click(screen.getByRole("option", { name: "Marker solid" }));
      expect(onSelectMarker).toHaveBeenCalledWith("solid");
      // The current marker ("dotted") is highlighted.
      expect(screen.getByRole("option", { name: "Marker dotted" }).getAttribute("aria-selected")).toBe("true");
    });

    it("clicking the 'none' marker cell clears the marker (empty string)", () => {
      const { onSelectMarker } = renderLabelPicker({ selectedMarker: "double" });
      fireEvent.click(screen.getByRole("option", { name: "Marker none" }));
      expect(onSelectMarker).toHaveBeenCalledWith("");
    });

    it("ArrowLeft crosses the hairline into the marker column; ArrowUp/Down move within it", () => {
      const { onSelectMarker } = renderLabelPicker();
      const listbox = screen.getByRole("listbox");
      // Initial focus (1,1) = first color; ArrowLeft crosses to (1,0) = dotted.
      fireEvent.keyDown(listbox, { key: "ArrowLeft" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelectMarker).toHaveBeenLastCalledWith("dotted");
      // ArrowDown within the column: solid, then double.
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelectMarker).toHaveBeenLastCalledWith("solid");
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelectMarker).toHaveBeenLastCalledWith("double");
      // ArrowUp back to the top of the column reaches ∅ (clears).
      for (let i = 0; i < 3; i++) fireEvent.keyDown(listbox, { key: "ArrowUp" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelectMarker).toHaveBeenLastCalledWith("");
    });

    it("ArrowRight crosses back from a marker cell to its row's first color", () => {
      const { onSelect, onSelectMarker } = renderLabelPicker();
      const listbox = screen.getByRole("listbox");
      // (1,1) → marker "dotted" (1,0), down to "solid" (2,0), then back across
      // the hairline → (2,1) = color 5 (index 4).
      fireEvent.keyDown(listbox, { key: "ArrowLeft" });
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      fireEvent.keyDown(listbox, { key: "ArrowRight" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(legacyOf(PICKER_COLOR_VALUES[4]));
      expect(onSelectMarker).not.toHaveBeenCalled();
    });

    it("row 0 is the removal row: ArrowLeft from Clear color reaches the ∅ cell", () => {
      const { onSelect, onSelectMarker } = renderLabelPicker();
      const listbox = screen.getByRole("listbox");
      fireEvent.keyDown(listbox, { key: "ArrowUp" }); // (1,1) → Clear color
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(null);
      fireEvent.keyDown(listbox, { key: "ArrowLeft" }); // Clear → ∅ (0,0)
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelectMarker).toHaveBeenLastCalledWith("");
    });

    it("the Label picker keeps the universal square vocabulary (18px cells, offset shadow)", () => {
      renderLabelPicker();
      const listbox = screen.getByRole("listbox");
      expect(listbox.className).not.toContain("rounded-md");
      expect(listbox.getAttribute("style")).toContain("3px 3px 0");
      const swatch = screen.getByRole("option", { name: "Color orange" });
      expect(swatch.className).toContain("w-[18px]");
      expect(swatch.className).toContain("h-[18px]");
      // Clear color spans the 4 color columns of the removal row.
      expect(screen.getByText("Clear color").className).toContain("col-span-4");
    });
  });
});
