import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  MarkerPad,
  markerPadPopoverLayout,
  placeMarkerPad,
  selectCell,
  stepStage,
  padHeader,
  sameCell,
} from "./marker-pad";
import type { Marker } from "@/themes";

afterEach(cleanup);

describe("selectCell (relative 2D displacement)", () => {
  const at = (mode: Marker["mode"], stage: Marker["stage"]): Marker => ({ mode, stage });

  it("one pitch right = +1 stage; left past stage 1 = ∅", () => {
    expect(selectCell(at("manual", 1), 26, 0, 26)).toEqual(at("manual", 2));
    expect(selectCell(at("manual", 2), -26, 0, 26)).toEqual(at("manual", 1));
    expect(selectCell(at("manual", 1), -26, 0, 26)).toBeNull();
    // From ∅, right re-enters at stage 1 (reference row manual).
    expect(selectCell(null, 26, 0, 26)).toEqual(at("manual", 1));
  });

  it("one pitch down = next mode; up = previous mode", () => {
    expect(selectCell(at("auto", 2), 0, 26, 26)).toEqual(at("blocked", 2));
    expect(selectCell(at("auto", 2), 0, -26, 26)).toEqual(at("manual", 2));
  });

  it("unmarked rows enter the grid at `manual` on the first vertical step", () => {
    // ∅ spans all three mode rows, so the first pitch down lands on the first
    // mode; the second pitch advances to `auto`; up clamps at the top.
    expect(selectCell(null, 0, 26, 26)).toEqual(at("manual", 1));
    expect(selectCell(null, 0, 52, 26)).toEqual(at("auto", 1));
    expect(selectCell(null, 0, -26, 26)).toEqual(at("manual", 1));
  });

  it("clamps to the grid edges — over-drag sticks to the edge cell", () => {
    expect(selectCell(at("manual", 3), 26 * 5, 0, 26)).toEqual(at("manual", 3));
    expect(selectCell(at("blocked", 3), 0, 26 * 4, 26)).toEqual(at("blocked", 3));
    expect(selectCell(at("manual", 1), -26 * 9, -26 * 9, 26)).toBeNull();
  });

  it("diagonal moves both axes; sub-pitch displacement is a no-op", () => {
    expect(selectCell(at("manual", 1), 30, 30, 26)).toEqual(at("auto", 2));
    expect(selectCell(at("manual", 2), 12, 12, 26)).toEqual(at("manual", 2));
  });
});

describe("popover fit and placement", () => {
  const padHeight = 100;
  const sidebarHeight = 240;
  const rowHeight = 32;

  for (const sidebarWidth of [160, 300]) {
    for (const edge of ["first", "last"] as const) {
      it(`keeps the ${edge} visible row inside a ${sidebarWidth}px sidebar`, () => {
        const sidebar = { left: 10, top: 20, width: sidebarWidth, height: sidebarHeight };
        const row = {
          left: sidebar.left,
          top: edge === "first" ? sidebar.top : sidebar.top + sidebarHeight - rowHeight,
          width: sidebarWidth,
          height: rowHeight,
        };
        const layout = markerPadPopoverLayout(sidebarWidth);
        const position = placeMarkerPad(
          sidebar,
          row,
          { width: layout.width, height: padHeight },
          22,
        );
        const absoluteLeft = row.left + position.left;
        const absoluteTop = row.top + position.top;

        expect(absoluteLeft).toBeGreaterThanOrEqual(sidebar.left);
        expect(absoluteLeft + layout.width).toBeLessThanOrEqual(sidebar.left + sidebar.width);
        expect(absoluteTop).toBeGreaterThanOrEqual(sidebar.top);
        expect(absoluteTop + padHeight).toBeLessThanOrEqual(sidebar.top + sidebar.height);
        expect(selectCell({ mode: "manual", stage: 1 }, layout.cellPx, 0, layout.cellPx)).toEqual({
          mode: "manual",
          stage: 2,
        });
      });
    }
  }

  it("shrinks to the supported minimum and preserves preferred geometry when roomy", () => {
    expect(markerPadPopoverLayout(160)).toEqual({ width: 152, cellPx: 22, labelPx: 42 });
    expect(markerPadPopoverLayout(300)).toEqual({ width: 180, cellPx: 26, labelPx: 54 });
  });
});

describe("stepStage / padHeader / sameCell", () => {
  it("stepStage steps within 1..3, mode unchanged", () => {
    expect(stepStage({ mode: "blocked", stage: 1 }, 1)).toEqual({ mode: "blocked", stage: 2 });
    expect(stepStage({ mode: "blocked", stage: 3 }, 1)).toEqual({ mode: "blocked", stage: 3 });
    expect(stepStage({ mode: "auto", stage: 1 }, -1)).toEqual({ mode: "auto", stage: 1 });
  });

  it("padHeader is `<mode> · <gloss>`, or ∅ on the clear cell", () => {
    expect(padHeader(null)).toBe("∅");
    expect(padHeader({ mode: "auto", stage: 2 })).toBe("auto · mid");
    expect(padHeader({ mode: "manual", stage: 3 })).toBe("manual · done");
  });

  it("sameCell compares grid positions, null = the ∅ column", () => {
    expect(sameCell(null, null)).toBe(true);
    expect(sameCell(null, { mode: "manual", stage: 1 })).toBe(false);
    expect(sameCell({ mode: "auto", stage: 2 }, { mode: "auto", stage: 2 })).toBe(true);
    expect(sameCell({ mode: "auto", stage: 2 }, { mode: "auto", stage: 3 })).toBe(false);
  });
});

describe("MarkerPad", () => {
  function renderPad(extra: Partial<React.ComponentProps<typeof MarkerPad>> = {}) {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <MarkerPad
        value={null}
        onPreview={onPreview}
        onCommit={onCommit}
        onCancel={onCancel}
        mode="popover"
        cellPx={26}
        {...extra}
      />,
    );
    return { onPreview, onCommit, onCancel };
  }

  it("renders the 3 mode rows × (∅ + 3 stage cells), header ∅ on an unmarked value", () => {
    renderPad();
    expect(screen.getByTestId("marker-pad-header").textContent).toBe("∅");
    expect(screen.getByTestId("marker-pad-cell-clear").getAttribute("aria-selected")).toBe("true");
    for (const mode of ["manual", "auto", "blocked"]) {
      for (const stage of [1, 2, 3]) {
        screen.getByTestId(`marker-pad-cell-${mode}-${stage}`);
      }
    }
  });

  it("the current value's cell highlights and the header names it", () => {
    renderPad({ value: { mode: "auto", stage: 2 } });
    expect(screen.getByTestId("marker-pad-header").textContent).toBe("auto · mid");
    expect(screen.getByTestId("marker-pad-cell-auto-2").getAttribute("aria-selected")).toBe("true");
    // Focus lands on the opening cell (the keyboard path starts there).
    expect(document.activeElement).toBe(screen.getByTestId("marker-pad-cell-auto-2"));
  });

  it("each stage cell is a mini well (12% wash + 30% edge) sized to cellPx", () => {
    renderPad({ mode: "inline", cellPx: 28 });
    const cell = screen.getByTestId("marker-pad-cell-manual-1");
    expect(cell.style.background).toContain("var(--color-marker-ink) 12%");
    expect(cell.style.borderRight).toContain("var(--color-marker-ink) 30%");
    expect(cell.style.width).toBe("28px");
  });

  it("renders the fitted popover width, cell pitch, and truncating label track", () => {
    const layout = markerPadPopoverLayout(160);
    renderPad({
      cellPx: layout.cellPx,
      popoverWidth: layout.width,
      labelPx: layout.labelPx,
    });
    expect(screen.getByTestId("marker-pad").style.width).toBe("152px");
    expect(screen.getByTestId("marker-pad-cell-manual-1").style.width).toBe("22px");
    expect(screen.getByText("blocked").parentElement?.style.width).toBe("42px");
    expect(screen.getByText("blocked").className).toContain("text-ellipsis");
  });

  it("hover previews a cell on the row without committing", () => {
    const { onPreview, onCommit } = renderPad({ value: { mode: "manual", stage: 1 } });
    fireEvent.mouseEnter(screen.getByTestId("marker-pad-cell-blocked-3"));
    expect(onPreview).toHaveBeenCalledWith({ mode: "blocked", stage: 3 });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId("marker-pad-header").textContent).toBe("blocked · done");
  });

  it("click commits the cell; the ∅ cell clears", () => {
    const { onCommit } = renderPad({ value: { mode: "manual", stage: 1 } });
    fireEvent.click(screen.getByTestId("marker-pad-cell-auto-2"));
    expect(onCommit).toHaveBeenCalledWith({ mode: "auto", stage: 2 });
    fireEvent.click(screen.getByTestId("marker-pad-cell-clear"));
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("keyboard: arrows move the highlight, Enter commits, Escape reverts", () => {
    const { onPreview, onCommit, onCancel } = renderPad({ value: { mode: "manual", stage: 1 } });
    const pad = screen.getByTestId("marker-pad");
    fireEvent.keyDown(pad, { key: "ArrowRight" });
    expect(onPreview).toHaveBeenCalledWith({ mode: "manual", stage: 2 });
    fireEvent.keyDown(pad, { key: "ArrowDown" });
    expect(onPreview).toHaveBeenCalledWith({ mode: "auto", stage: 2 });
    fireEvent.keyDown(pad, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({ mode: "auto", stage: 2 });
    fireEvent.keyDown(pad, { key: "ArrowLeft" });
    fireEvent.keyDown(pad, { key: "ArrowLeft" }); // stage 1 → ∅
    expect(onPreview).toHaveBeenLastCalledWith(null);
    fireEvent.keyDown(pad, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    // Escape reverts the highlight to the committed value, not merely closes.
    expect(onPreview).toHaveBeenLastCalledWith({ mode: "manual", stage: 1 });
  });

  it("inline: Escape reverts the highlight and bubbles so the card can dismiss", () => {
    const onDismiss = vi.fn();
    const onPreview = vi.fn();
    const onCancel = vi.fn();
    render(
      <div onKeyDown={onDismiss}>
        <MarkerPad
          value={{ mode: "blocked", stage: 2 }}
          onPreview={onPreview}
          onCommit={vi.fn()}
          onCancel={onCancel}
          mode="inline"
          cellPx={28}
        />
      </div>,
    );
    // Keyboard-active by focusing a cell normally (the inline pad never steals
    // focus on mount), then walk away from the committed cell.
    const cells = screen.getAllByRole("option");
    cells[0].focus();
    const pad = screen.getByTestId("marker-pad");
    fireEvent.keyDown(pad, { key: "ArrowUp" });
    expect(onPreview).toHaveBeenLastCalledWith({ mode: "auto", stage: 2 });
    fireEvent.keyDown(pad, { key: "Escape" });
    expect(onPreview).toHaveBeenLastCalledWith({ mode: "blocked", stage: 2 });
    expect(onCancel).toHaveBeenCalledOnce();
    // The inline pad does NOT swallow Escape — the card's dismissal still sees it.
    expect(onDismiss).toHaveBeenCalled();
  });

  it("the highlight prop streams external cells in (the strip's drag path)", () => {
    const { rerender } = render(
      <MarkerPad
        value={{ mode: "manual", stage: 1 }}
        onPreview={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        mode="popover"
        cellPx={26}
        highlight={{ mode: "manual", stage: 1 }}
      />,
    );
    expect(screen.getByTestId("marker-pad-header").textContent).toBe("manual · early");
    rerender(
      <MarkerPad
        value={{ mode: "manual", stage: 1 }}
        onPreview={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        mode="popover"
        cellPx={26}
        highlight={{ mode: "auto", stage: 3 }}
      />,
    );
    expect(screen.getByTestId("marker-pad-header").textContent).toBe("auto · done");
    expect(screen.getByTestId("marker-pad-cell-auto-3").getAttribute("aria-selected")).toBe("true");
  });
});
