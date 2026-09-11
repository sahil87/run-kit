import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { useRef } from "react";
import { GuiToolbarMenu, type GuiToolbarMenuRow } from "./gui-toolbar-menu";

afterEach(cleanup);

function row(id: string, overrides: Partial<GuiToolbarMenuRow> = {}): GuiToolbarMenuRow {
  return { id, label: id, onSelect: vi.fn(), ...overrides };
}

/** The anchor chip is a sibling of the menu inside a positioned box — the
 *  pill's own shape. */
function renderMenu(rows: GuiToolbarMenuRow[], onClose = vi.fn()) {
  function Host() {
    const ref = useRef<HTMLButtonElement>(null);
    return (
      <div className="absolute">
        <button ref={ref} type="button" aria-label="anchor chip">
          chip
        </button>
        <GuiToolbarMenu
          kind="resolution"
          anchorRef={ref}
          rows={rows}
          ariaLabel="Resolution"
          onClose={onClose}
        />
      </div>
    );
  }
  const utils = render(<Host />);
  return { ...utils, onClose, anchor: screen.getByLabelText("anchor chip") };
}

describe("GuiToolbarMenu — rendering", () => {
  it("renders the rows as menuitems under one role=menu with the kind on data-menu", () => {
    renderMenu([row("a", { label: "1280×720" }), row("b", { label: "1600×900" })]);
    const menu = screen.getByTestId("gui-toolbar-menu");
    expect(menu.getAttribute("data-menu")).toBe("resolution");
    expect(menu.getAttribute("role")).toBe("menu");
    expect(menu.getAttribute("aria-label")).toBe("Resolution");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((el) => el.textContent)).toEqual(["1280×720", "1600×900"]);
  });

  it("renders a description as `label — description`, but `current` as the trailing check", () => {
    renderMenu([
      row("cur", { label: "1920×1080", description: "current" }),
      row("lock", { label: "Lock resolution", description: "resolution is fixed" }),
    ]);
    const items = screen.getAllByRole("menuitem");
    expect(items[0].textContent).toBe("1920×1080✓");
    expect(items[1].textContent).toBe("Lock resolution — resolution is fixed");
  });

  it("a disabled row is dimmed and inert — a click fires nothing", () => {
    const onSelect = vi.fn();
    renderMenu([row("a", { disabled: true, onSelect })]);
    const item = screen.getByRole("menuitem");
    expect(item).toHaveProperty("disabled", true);
    fireEvent.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("GuiToolbarMenu — pick and close", () => {
  it("a pick fires the row's onSelect and then onClose, in that order", () => {
    const log: string[] = [];
    const onSelect = vi.fn(() => log.push("select"));
    const onClose = vi.fn(() => log.push("close"));
    renderMenu([row("a", { onSelect })], onClose);
    fireEvent.click(screen.getByRole("menuitem"));
    expect(log).toEqual(["select", "close"]);
  });

  it("Escape closes and returns focus to the anchor chip", () => {
    const onClose = vi.fn();
    const { anchor } = renderMenu([row("a")], onClose);
    fireEvent.keyDown(screen.getByTestId("gui-toolbar-menu"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(anchor);
  });

  it("Tab closes and returns focus to the anchor chip", () => {
    const onClose = vi.fn();
    const { anchor } = renderMenu([row("a")], onClose);
    fireEvent.keyDown(screen.getByTestId("gui-toolbar-menu"), { key: "Tab" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(anchor);
  });

  it("a pointerdown outside both menu and anchor closes; inside does not", () => {
    const onClose = vi.fn();
    const { anchor } = renderMenu([row("a")], onClose);
    fireEvent.pointerDown(screen.getByTestId("gui-toolbar-menu"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("GuiToolbarMenu — keyboard", () => {
  it("focus lands on the first enabled row on open; arrows rove with wraparound, skipping disabled rows", () => {
    renderMenu([
      row("a", { label: "A", disabled: true }),
      row("b", { label: "B" }),
      row("c", { label: "C" }),
    ]);
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[1]);
    const menu = screen.getByTestId("gui-toolbar-menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
  });

  it("Enter on the focused row picks it", () => {
    const log: string[] = [];
    const onSelect = vi.fn(() => log.push("select"));
    const onClose = vi.fn(() => log.push("close"));
    renderMenu([row("a", { onSelect })], onClose);
    fireEvent.keyDown(screen.getByTestId("gui-toolbar-menu"), { key: "Enter" });
    // Enter on a focused button is the native click — fire it as the browser would.
    fireEvent.click(document.activeElement as Element);
    expect(log).toEqual(["select", "close"]);
  });

  it("keydown never propagates past the menu", () => {
    const spy = vi.fn();
    function Host() {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <div onKeyDown={spy}>
          <button ref={ref} type="button">
            chip
          </button>
          <GuiToolbarMenu
            kind="overflow"
            anchorRef={ref}
            rows={[row("a")]}
            ariaLabel="More actions"
            onClose={() => {}}
          />
        </div>
      );
    }
    render(<Host />);
    fireEvent.keyDown(screen.getByTestId("gui-toolbar-menu"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByTestId("gui-toolbar-menu"), { key: "x" });
    expect(spy).not.toHaveBeenCalled();
  });
});
