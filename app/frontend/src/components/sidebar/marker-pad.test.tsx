import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Marker } from "@/marker";
import {
  MarkerPad,
  markerPadPopoverLayout,
  padHeader,
  placeMarkerPad,
  sameCell,
  selectCell,
  stepStage,
} from "./marker-pad";

afterEach(cleanup);

const marker = (mode: Marker["mode"], stage: Marker["stage"]): Marker => ({
  mode,
  stage,
});

describe("selectCell", () => {
  it("moves stages horizontally and reaches the clear column", () => {
    expect(selectCell(marker("manual", 1), 26, 0, 26)).toEqual(marker("manual", 2));
    expect(selectCell(marker("manual", 2), -26, 0, 26)).toEqual(marker("manual", 1));
    expect(selectCell(marker("manual", 1), -26, 0, 26)).toBeNull();
    expect(selectCell(null, 26, 0, 26)).toEqual(marker("manual", 1));
  });

  it("moves modes vertically", () => {
    expect(selectCell(marker("auto", 2), 0, 26, 26)).toEqual(marker("blocked", 2));
    expect(selectCell(marker("auto", 2), 0, -26, 26)).toEqual(marker("manual", 2));
  });

  it("enters an unmarked row at manual on the first vertical pitch", () => {
    expect(selectCell(null, 0, 26, 26)).toEqual(marker("manual", 1));
    expect(selectCell(null, 0, 52, 26)).toEqual(marker("auto", 1));
    expect(selectCell(null, 0, -26, 26)).toEqual(marker("manual", 1));
  });

  it("clamps over-drag to the grid edges", () => {
    expect(selectCell(marker("manual", 3), 260, 0, 26)).toEqual(marker("manual", 3));
    expect(selectCell(marker("blocked", 3), 0, 260, 26)).toEqual(marker("blocked", 3));
    expect(selectCell(marker("manual", 1), -260, -260, 26)).toBeNull();
  });

  it("moves diagonally and ignores sub-pitch displacement", () => {
    expect(selectCell(marker("manual", 1), 30, 30, 26)).toEqual(marker("auto", 2));
    expect(selectCell(marker("manual", 2), 12, 12, 26)).toEqual(marker("manual", 2));
    expect(selectCell(null, 12, 12, 26)).toBeNull();
  });
});

describe("popover fit and placement", () => {
  const padHeight = 100;
  const sidebarHeight = 240;
  const rowHeight = 32;

  for (const sidebarWidth of [160, 300]) {
    for (const edge of ["first", "last"] as const) {
      it(`keeps the ${edge} visible row inside a ${sidebarWidth}px sidebar`, () => {
        const sidebar = {
          left: 10,
          top: 20,
          width: sidebarWidth,
          height: sidebarHeight,
        };
        const row = {
          left: sidebar.left,
          top:
            edge === "first"
              ? sidebar.top
              : sidebar.top + sidebarHeight - rowHeight,
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
        expect(absoluteLeft + layout.width).toBeLessThanOrEqual(
          sidebar.left + sidebar.width,
        );
        expect(absoluteTop).toBeGreaterThanOrEqual(sidebar.top);
        expect(absoluteTop + padHeight).toBeLessThanOrEqual(
          sidebar.top + sidebar.height,
        );
      });
    }
  }

  it("shrinks at minimum width and preserves roomy geometry", () => {
    expect(markerPadPopoverLayout(160)).toEqual({ width: 152, cellPx: 22, labelPx: 42 });
    expect(markerPadPopoverLayout(300)).toEqual({ width: 180, cellPx: 26, labelPx: 54 });
  });
});

describe("marker helpers", () => {
  it("steps stages without changing mode", () => {
    expect(stepStage(marker("blocked", 1), 1)).toEqual(marker("blocked", 2));
    expect(stepStage(marker("blocked", 3), 1)).toEqual(marker("blocked", 3));
    expect(stepStage(marker("auto", 1), -1)).toEqual(marker("auto", 1));
  });

  it("formats headers and compares cells", () => {
    expect(padHeader(null)).toBe("∅");
    expect(padHeader(marker("auto", 2))).toBe("auto · mid");
    expect(sameCell(null, null)).toBe(true);
    expect(sameCell(null, marker("manual", 1))).toBe(false);
    expect(sameCell(marker("auto", 2), marker("auto", 2))).toBe(true);
    expect(sameCell(marker("auto", 2), marker("auto", 3))).toBe(false);
  });
});

describe("MarkerPad", () => {
  function renderPad(
    extra: Partial<React.ComponentProps<typeof MarkerPad>> = {},
  ) {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <MarkerPad
        value={null}
        onPreview={onPreview}
        onCommit={onCommit}
        onCancel={onCancel}
        cellPx={26}
        {...extra}
      />,
    );
    return { onPreview, onCommit, onCancel };
  }

  it("renders the clear cell and all nine mode-stage cells", () => {
    renderPad();
    expect(screen.getByTestId("marker-pad-header")).toHaveTextContent("∅");
    expect(screen.getByTestId("marker-pad-cell-clear")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    for (const mode of ["manual", "auto", "blocked"]) {
      for (const stage of [1, 2, 3]) {
        expect(screen.getByTestId(`marker-pad-cell-${mode}-${stage}`)).toBeInTheDocument();
      }
    }
  });

  it("highlights, names, and focuses the committed value", () => {
    renderPad({ value: marker("auto", 2) });
    expect(screen.getByTestId("marker-pad-header")).toHaveTextContent("auto · mid");
    const cell = screen.getByTestId("marker-pad-cell-auto-2");
    expect(cell).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(cell);
  });

  it("renders shared mini-well chrome at the fitted pitch", () => {
    const layout = markerPadPopoverLayout(160);
    renderPad({
      cellPx: layout.cellPx,
      popoverWidth: layout.width,
      labelPx: layout.labelPx,
    });
    const cell = screen.getByTestId("marker-pad-cell-manual-1");
    expect(cell.style.background).toContain("var(--color-marker-ink) 12%");
    expect(cell.style.borderRight).toContain("var(--color-marker-ink) 30%");
    expect(cell.style.width).toBe("22px");
    expect(screen.getByTestId("marker-pad").style.width).toBe("152px");
    expect(screen.getByText("blocked").parentElement?.style.width).toBe("42px");
  });

  it("previews on hover without committing", () => {
    const { onPreview, onCommit } = renderPad({ value: marker("manual", 1) });
    fireEvent.mouseEnter(screen.getByTestId("marker-pad-cell-blocked-3"));
    expect(onPreview).toHaveBeenCalledWith(marker("blocked", 3));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByTestId("marker-pad-header")).toHaveTextContent("blocked · done");
  });

  it("commits a clicked cell and clears from the clear cell", () => {
    const { onCommit } = renderPad({ value: marker("manual", 1) });
    fireEvent.click(screen.getByTestId("marker-pad-cell-auto-2"));
    expect(onCommit).toHaveBeenCalledWith(marker("auto", 2));
    fireEvent.click(screen.getByTestId("marker-pad-cell-clear"));
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("walks with arrows, commits with Enter, and reverts before Escape cancel", () => {
    const { onPreview, onCommit, onCancel } = renderPad({
      value: marker("manual", 1),
    });
    const pad = screen.getByTestId("marker-pad");
    fireEvent.keyDown(pad, { key: "ArrowRight" });
    fireEvent.keyDown(pad, { key: "ArrowDown" });
    expect(onPreview).toHaveBeenLastCalledWith(marker("auto", 2));
    fireEvent.keyDown(pad, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith(marker("auto", 2));
    fireEvent.keyDown(pad, { key: "Escape" });
    expect(onPreview).toHaveBeenLastCalledWith(marker("manual", 1));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("commits with Space", () => {
    const { onCommit } = renderPad({ value: marker("manual", 1) });
    fireEvent.keyDown(screen.getByTestId("marker-pad"), { key: " " });
    expect(onCommit).toHaveBeenCalledWith(marker("manual", 1));
  });

  it("streams an external drag highlight", () => {
    const props = {
      value: marker("manual", 1),
      onPreview: vi.fn(),
      onCommit: vi.fn(),
      onCancel: vi.fn(),
      cellPx: 26,
    };
    const { rerender } = render(
      <MarkerPad {...props} highlight={marker("manual", 1)} />,
    );
    rerender(<MarkerPad {...props} highlight={marker("auto", 3)} />);
    expect(screen.getByTestId("marker-pad-header")).toHaveTextContent("auto · done");
    expect(screen.getByTestId("marker-pad-cell-auto-3")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
