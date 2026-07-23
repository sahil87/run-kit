import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SwatchPopover } from "./swatch-popover";
import {
  PICKER_COLOR_VALUES,
  MARKER_STATES,
  HUE_FAMILIES,
  DEFAULT_DARK_THEME,
  UNCOLORED_SELECTED_KEY,
  computeRowTints,
  computeRowBorders,
} from "@/themes";

/** The STORED value the write seam maps a picked display value to: a NORMAL
 *  shade maps to its legacy descriptor ("orange" → "1+3", the vocabulary
 *  pre-existing colors are stored in), while a DARK shade has no legacy form
 *  and is stored verbatim ("orange-dark"). onSelect assertions expect this. */
const storedOf = (value: string): string =>
  HUE_FAMILIES.find((f) => f.name === value)?.legacy ?? value;
/** Legacy descriptor of a normal-shade family name (write-seam vocabulary). */
const legacyOf = (familyName: string): string =>
  HUE_FAMILIES.find((f) => f.name === familyName)!.legacy;

/** jsdom serializes inline hex colors to rgb() — mirror that for assertions. */
const rgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

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

  it("renders 20 family/shade swatches + Clear color", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);

    const options = screen.getAllByRole("option");
    // 20 family/shade swatches + Clear + the ✕ close cell (an
    // option-as-command, keeping the listbox's children ARIA-valid)
    expect(options).toHaveLength(22);
  });

  it("renders a swatch for every family/shade value", () => {
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
    // The adjacent dark shade of the SAME family is NOT selected — the ring/✓
    // must be unambiguous between same-family shades.
    expect(
      screen.getByRole("option", { name: "Color orange-dark" }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("a dark-stored value highlights the DARK swatch, not its normal sibling", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(
      <SwatchPopover selectedColor="orange-dark" onSelect={onSelect} onClose={onClose} />,
    );
    const dark = screen.getByRole("option", { name: "Color orange-dark" });
    expect(dark.getAttribute("aria-selected")).toBe("true");
    expect(dark.textContent).toContain("✓");
    expect(
      screen.getByRole("option", { name: "Color orange" }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("swatches are uniform SOLID squares filled with the selected-tint blend (no split halves)", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
    const tints = computeRowTints(DEFAULT_DARK_THEME.palette);
    for (const value of ["blue", "blue-dark"]) {
      const swatch = screen.getByRole("option", { name: `Color ${value}` });
      expect(swatch.style.backgroundColor).toBe(rgb(tints.get(value)!.selected));
      // Single fill on the button itself — no inner base/selected half spans.
      expect(swatch.querySelectorAll("span")).toHaveLength(0);
    }
  });

  it("clicking a DARK swatch emits the {family}-dark value verbatim (no legacy form)", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByRole("option", { name: "Color green-dark" }));
    expect(onSelect).toHaveBeenCalledWith("green-dark");
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

  it("the 20 picker values are the families in PAIRED shade order (normal | dark adjacent)", () => {
    expect(PICKER_COLOR_VALUES).toEqual(
      HUE_FAMILIES.flatMap((f) => [f.name, `${f.name}-dark`]),
    );
    expect(PICKER_COLOR_VALUES).toHaveLength(20);
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

    it("the removal row is Clear (spanning cols 1–3) beside the ✕ close cell (col 4)", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const clear = screen.getByText("Clear");
      expect(clear.className).toContain("col-span-3");
      // The color grid itself is 4-wide below the removal row.
      expect(clear.parentElement!.className).toContain("grid-cols-4");
      fireEvent.click(clear);
      expect(onSelect).toHaveBeenCalledWith(null);
      // The ✕ close cell fills the freed col 4 — an 18px option-as-command
      // (role=option keeps the listbox's children ARIA-valid; it is never
      // aria-selected, matching Clear's existing option-as-command pattern).
      const close = screen.getByLabelText("Close picker");
      expect(close.className).toContain("w-[18px]");
      expect(close.getAttribute("role")).toBe("option");
      expect(close.getAttribute("aria-selected")).toBe("false");
    });
  });

  // ── Dismissal model: selection never closes; ✕ / outside / Escape do. ──
  describe("dismissal model", () => {
    it("selection NEVER closes: swatch, Clear, and marker picks leave onClose uncalled", () => {
      const onSelect = vi.fn();
      const onSelectMarker = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(
        <SwatchPopover onSelect={onSelect} onSelectMarker={onSelectMarker} onClose={onClose} />,
      );
      fireEvent.click(screen.getByRole("option", { name: "Color blue" }));
      fireEvent.click(screen.getByRole("option", { name: "Color blue-dark" }));
      fireEvent.click(screen.getByRole("option", { name: "Marker thick" }));
      fireEvent.click(screen.getByText("Clear"));
      expect(onSelect).toHaveBeenCalledTimes(3);
      expect(onSelectMarker).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("clicking the ✕ cell closes", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      fireEvent.click(screen.getByLabelText("Close picker"));
      expect(onClose).toHaveBeenCalledOnce();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("keyboard: ArrowRight from Clear reaches ✕ (Enter closes); ArrowLeft returns to Clear", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const listbox = screen.getByRole("listbox");
      // Uncolored initial focus = Clear (0,1). ArrowRight jumps the spanning
      // target straight to the ✕ (0,4).
      fireEvent.keyDown(listbox, { key: "ArrowRight" });
      fireEvent.keyDown(listbox, { key: "ArrowLeft" }); // back on Clear
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(null);
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.keyDown(listbox, { key: "ArrowRight" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("keyboard: ArrowUp from a col-4 swatch lands on the ✕, not Clear", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const listbox = screen.getByRole("listbox");
      // Clear (0,1) → (1,1) → walk to (1,4), then ArrowUp → ✕ (0,4).
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      for (let i = 0; i < 3; i++) fireEvent.keyDown(listbox, { key: "ArrowRight" });
      fireEvent.keyDown(listbox, { key: "ArrowUp" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onClose).toHaveBeenCalledOnce();
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  // ── Color-only keyboard nav: the conceptual grid minus the marker column. ──
  describe("keyboard navigation (color-only grid)", () => {
    it("initial focus FOLLOWS SELECTION: Clear color when uncolored — Enter clears, never emits a phantom color", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(null);
    });

    it("shows NO focus ring before the keyboard is used; the ring appears on the first arrow key", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const listbox = screen.getByRole("listbox");
      // At rest (mouse users): no focus ring anywhere — an always-on ring on
      // the autofocused listbox read as a phantom selection.
      expect(listbox.querySelectorAll(".ring-text-secondary")).toHaveLength(0);
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      expect(listbox.querySelectorAll(".ring-text-secondary")).toHaveLength(1);
    });

    it("the uncolored state highlights Clear as selected (bright ring), not any swatch", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const clear = screen.getByText("Clear");
      expect(clear.getAttribute("aria-selected")).toBe("true");
      expect(clear.className).toContain("ring-text-primary");
      // No color swatch carries the selection ring.
      for (const value of PICKER_COLOR_VALUES) {
        expect(
          screen.getByRole("option", { name: `Color ${value}` }).className,
        ).not.toContain("ring-text-primary");
      }
    });

    it("initial focus lands on the selected swatch (magenta, row 5)", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(
        <SwatchPopover selectedColor="magenta" onSelect={onSelect} onClose={onClose} />,
      );
      fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(legacyOf("magenta"));
      expect(PICKER_COLOR_VALUES[16]).toBe("magenta");
    });

    it("ArrowRight walks a color row (normal|dark pairs) and clamps at its right edge", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const listbox = screen.getByRole("listbox");
      // Uncolored → initial focus is Clear (row 0); descend into row 1 first.
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      // Row 1: red, red-dark, orange, orange-dark. Three ArrowRights reach the
      // row end (col 4 = orange-dark, a DARK value stored verbatim).
      for (let i = 0; i < 3; i++) fireEvent.keyDown(listbox, { key: "ArrowRight" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(PICKER_COLOR_VALUES[3]).toBe("orange-dark");
      expect(onSelect).toHaveBeenLastCalledWith("orange-dark");
      // A fourth ArrowRight clamps (no wrap into the next row).
      fireEvent.keyDown(listbox, { key: "ArrowRight" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith("orange-dark");
    });

    it("ArrowDown moves down a column to the bottom row (20 colors fill 5×4 — no dead cells)", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const listbox = screen.getByRole("listbox");
      // Descend from Clear into (1,1), walk to (1,4), then down the col-4
      // column: (2,4) = index 7, … (5,4) = index 19 (slate-dark) — every cell
      // on the way is a real color (the former dead cells are gone).
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      for (let i = 0; i < 3; i++) fireEvent.keyDown(listbox, { key: "ArrowRight" });
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(storedOf(PICKER_COLOR_VALUES[7]));
      for (let i = 0; i < 3; i++) fireEvent.keyDown(listbox, { key: "ArrowDown" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(PICKER_COLOR_VALUES[19]).toBe("slate-dark");
      expect(onSelect).toHaveBeenLastCalledWith("slate-dark");
      // ArrowDown at the bottom row is a no-op.
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith("slate-dark");
    });

    it("ArrowUp from row 1 lands on the single Clear color target; Enter clears", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const listbox = screen.getByRole("listbox");
      // Descend into row 1, walk right two cells, then ArrowUp → Clear (from
      // ANY column of row 1 it lands on the single spanning target).
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
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

    it("ArrowDown from Clear color (the uncolored initial focus) enters the first color row; ArrowUp returns", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const listbox = screen.getByRole("listbox");
      fireEvent.keyDown(listbox, { key: "ArrowDown" }); // Clear → (1,1)
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(legacyOf(PICKER_COLOR_VALUES[0]));
      fireEvent.keyDown(listbox, { key: "ArrowUp" }); // (1,1) → Clear
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelect).toHaveBeenLastCalledWith(null);
    });

    it("ArrowLeft at the left edge is a no-op when no marker column exists", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      renderWithTheme(<SwatchPopover onSelect={onSelect} onClose={onClose} />);
      const listbox = screen.getByRole("listbox");
      fireEvent.keyDown(listbox, { key: "ArrowDown" }); // Clear → (1,1)
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

  // ── Combined Label picker: side-by-side marker column | hairline | paired
  //    color grid. Marker section gated on onSelectMarker alone; the non-∅
  //    cells are LIVE ROW PREVIEWS of the currently selected color (tint.base
  //    background, guarded stripe with a 2px inset, paired texture) and never
  //    animate. ──
  describe("combined Label picker (side-by-side marker column)", () => {
    const tints = computeRowTints(DEFAULT_DARK_THEME.palette);
    const borders = computeRowBorders(DEFAULT_DARK_THEME.palette, DEFAULT_DARK_THEME.category);

    function renderLabelPicker(extra: Partial<React.ComponentProps<typeof SwatchPopover>> = {}) {
      const onSelect = vi.fn();
      const onSelectMarker = vi.fn();
      const onClose = vi.fn();
      const utils = renderWithTheme(
        <SwatchPopover
          onSelect={onSelect}
          onSelectMarker={onSelectMarker}
          onClose={onClose}
          {...extra}
        />,
      );
      return { onSelect, onSelectMarker, onClose, ...utils };
    }

    /** The 5 non-∅ marker preview cells (dotted/dashed/solid/double/thick). */
    function previewCells(): HTMLElement[] {
      return MARKER_STATES.filter((s) => s !== "").map(
        (s) => screen.getByRole("option", { name: `Marker ${s}` }) as HTMLElement,
      );
    }

    it("renders NO marker column and NO hairline when the marker props are absent", () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      const { container } = renderWithTheme(
        <SwatchPopover onSelect={onSelect} onClose={onClose} />,
      );
      // Color-only: 20 swatches + Clear + ✕ = 22 options, no marker cells.
      expect(screen.getAllByRole("option")).toHaveLength(22);
      expect(screen.queryByRole("option", { name: /^Marker / })).toBeNull();
      // No vertical hairline divider.
      expect(container.querySelector(".w-px")).toBeNull();
      expect(screen.getByRole("listbox").getAttribute("aria-label")).toBe("Color picker");
    });

    it("renders 6 marker cells (none + the 5 states in display order) beside a vertical hairline", () => {
      const { container } = renderLabelPicker();
      // 20 color swatches + Clear + ✕ + 6 marker cells = 28 options.
      expect(screen.getAllByRole("option")).toHaveLength(28);
      for (const state of ["none", "dotted", "dashed", "solid", "double", "thick"]) {
        expect(screen.getByRole("option", { name: `Marker ${state}` })).toBeTruthy();
      }
      // The listbox is labelled "Label picker" once markers are present.
      expect(screen.getByRole("listbox").getAttribute("aria-label")).toBe("Label picker");
      // The vertical hairline divides the two sections.
      expect(container.querySelector(".w-px")).not.toBeNull();
      // The marker cells live in a single left column, ∅ first (the removal
      // row), then the five states beside the five color rows.
      const markerCol = screen.getByRole("option", { name: "Marker none" }).parentElement!;
      expect(markerCol.className).toContain("flex-col");
      const cells = Array.from(markerCol.querySelectorAll("[data-marker-value]"));
      expect(cells.map((c) => c.getAttribute("data-marker-value"))).toEqual([
        "",
        "dotted",
        "dashed",
        "solid",
        "double",
        "thick",
      ]);
      // Marker cells share the 18px square metric so rows align 1:1.
      expect((cells[0] as HTMLElement).className).toContain("w-[18px]");
      expect((cells[0] as HTMLElement).className).toContain("h-[18px]");
    });

    it("the marker-cell ↔ grid-row pairing is a deliberate invariant (6 cells, 6 rows)", () => {
      // GRID_ROWS (1 removal row + 20 colors / 4 per row) must equal the
      // marker column's cell count — extend MARKER_STATES and
      // PICKER_COLOR_VALUES together (supersedes the old "load-bearing
      // coincidence").
      expect(MARKER_STATES.length).toBe(1 + PICKER_COLOR_VALUES.length / 4);
      expect(MARKER_STATES.length).toBe(6);
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

    it("marker cells are LIVE ROW PREVIEWS of the selected color (tint.base bg + guarded stripe, 2px inset)", () => {
      renderLabelPicker({ selectedColor: "green" });
      const guarded = borders.get("green")!;
      for (const cell of previewCells()) {
        // Mini window row: the cell's background is the selected value's BASE
        // tint (what a real green row shows at rest).
        expect(cell.style.backgroundColor).toBe(rgb(tints.get("green")!.base));
        // The texture pseudos read the same guarded color via the custom prop.
        expect(cell.style.getPropertyValue("--rk-marker-color")).toBe(guarded);
      }
      // Stripes draw in the guarded family color with a 2px left inset (the
      // marker must not kiss the cell edge — the cell reads as a mini row).
      const solidStripe = screen
        .getByRole("option", { name: "Marker solid" })
        .querySelector("span")! as HTMLElement;
      expect(solidStripe.style.borderLeft).toContain(rgb(guarded));
      expect(solidStripe.style.left).toBe("2px");
      const dottedStripe = screen
        .getByRole("option", { name: "Marker dotted" })
        .querySelector("span")! as HTMLElement;
      // Fixed one-period tile (seam-free at the 18px cell height too).
      expect(dottedStripe.style.backgroundImage).toContain("linear-gradient");
      expect(dottedStripe.style.backgroundImage).toContain(rgb(guarded));
      expect(dottedStripe.style.backgroundSize).toBe("3px 6px");
      // The ∅ cell is NOT a preview — it keeps the inset glyph cell.
      const none = screen.getByRole("option", { name: "Marker none" });
      expect(none.className).toContain("bg-bg-inset");
      expect(none.style.backgroundColor).toBe("");
    });

    it("a DARK selected color previews with its own tint/border (not the normal sibling's)", () => {
      renderLabelPicker({ selectedColor: "green-dark" });
      const [dotted] = previewCells();
      expect(dotted.style.backgroundColor).toBe(rgb(tints.get("green-dark")!.base));
      expect(dotted.style.getPropertyValue("--rk-marker-color")).toBe(borders.get("green-dark"));
    });

    it("uncolored previews fall back to the gray sentinel tint/border", () => {
      renderLabelPicker();
      for (const cell of previewCells()) {
        expect(cell.style.backgroundColor).toBe(rgb(tints.get(UNCOLORED_SELECTED_KEY)!.base));
        expect(cell.style.getPropertyValue("--rk-marker-color")).toBe(
          borders.get(UNCOLORED_SELECTED_KEY),
        );
      }
    });

    it("picking a swatch repaints the marker previews immediately", () => {
      const { onSelect } = renderLabelPicker({ selectedColor: "green" });
      const [dotted] = previewCells();
      expect(dotted.style.backgroundColor).toBe(rgb(tints.get("green")!.base));
      fireEvent.click(screen.getByRole("option", { name: "Color blue-dark" }));
      expect(onSelect).toHaveBeenCalledWith("blue-dark");
      // The preview column repaints from the pick, without any parent
      // re-render (the popover stays open — live toggling is the point).
      expect(dotted.style.backgroundColor).toBe(rgb(tints.get("blue-dark")!.base));
      // Clear reverts the previews to the gray sentinel.
      fireEvent.click(screen.getByText("Clear"));
      expect(dotted.style.backgroundColor).toBe(rgb(tints.get(UNCOLORED_SELECTED_KEY)!.base));
    });

    it("preview cells carry the paired STATIC row textures and never animate", () => {
      renderLabelPicker({ selectedColor: "green", selectedMarker: "double" });
      const listbox = screen.getByRole("listbox");
      // Thick pairs with the hazard wedge; double with the scanline wash.
      expect(
        screen.getByRole("option", { name: "Marker thick" }).querySelector(".rk-hazard"),
      ).not.toBeNull();
      expect(
        screen.getByRole("option", { name: "Marker double" }).querySelector(".rk-scanlines"),
      ).not.toBeNull();
      // Other cells carry no texture.
      expect(
        screen.getByRole("option", { name: "Marker solid" }).querySelector(".rk-hazard, .rk-scanlines"),
      ).toBeNull();
      // NEVER animated — even with double SELECTED, the crawl class is absent
      // everywhere in the picker, and the dashed preview never carries the
      // data-rain overlay (motion belongs to real rows only).
      expect(listbox.querySelector(".rk-scanlines-crawl")).toBeNull();
      expect(listbox.querySelector(".rk-dash-rain")).toBeNull();
    });

    it("ArrowLeft crosses the hairline into the marker column; ArrowUp/Down move within it", () => {
      const { onSelectMarker } = renderLabelPicker();
      const listbox = screen.getByRole("listbox");
      // Uncolored → initial focus is Clear (0,1); descend to (1,1) = first
      // color, then ArrowLeft crosses to (1,0) = dotted.
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      fireEvent.keyDown(listbox, { key: "ArrowLeft" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelectMarker).toHaveBeenLastCalledWith("dotted");
      // ArrowDown within the column walks the display order: dashed, solid,
      // double, thick.
      for (const state of ["dashed", "solid", "double", "thick"]) {
        fireEvent.keyDown(listbox, { key: "ArrowDown" });
        fireEvent.keyDown(listbox, { key: "Enter" });
        expect(onSelectMarker).toHaveBeenLastCalledWith(state);
      }
      // ArrowDown at the bottom of the column clamps on thick.
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelectMarker).toHaveBeenLastCalledWith("thick");
      // ArrowUp back to the top of the column reaches ∅ (clears).
      for (let i = 0; i < 5; i++) fireEvent.keyDown(listbox, { key: "ArrowUp" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(onSelectMarker).toHaveBeenLastCalledWith("");
    });

    it("ArrowRight crosses back from a marker cell to its row's first color", () => {
      const { onSelect, onSelectMarker } = renderLabelPicker();
      const listbox = screen.getByRole("listbox");
      // Clear (0,1) → (1,1) → marker "dotted" (1,0), down to "dashed" (2,0),
      // then back across the hairline → (2,1) = index 4 ("amber").
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      fireEvent.keyDown(listbox, { key: "ArrowLeft" });
      fireEvent.keyDown(listbox, { key: "ArrowDown" });
      fireEvent.keyDown(listbox, { key: "ArrowRight" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(PICKER_COLOR_VALUES[4]).toBe("amber");
      expect(onSelect).toHaveBeenLastCalledWith(legacyOf("amber"));
      expect(onSelectMarker).not.toHaveBeenCalled();
    });

    it("row 0 is the removal row: ArrowLeft from Clear color (the uncolored initial focus) reaches the ∅ cell", () => {
      const { onSelect, onSelectMarker } = renderLabelPicker();
      const listbox = screen.getByRole("listbox");
      // Uncolored → focus already sits on Clear color (row 0).
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
      // Clear spans cols 1–3 of the removal row, beside the ✕ close cell.
      expect(screen.getByText("Clear").className).toContain("col-span-3");
      expect(screen.getByLabelText("Close picker")).toBeTruthy();
    });
  });
});
