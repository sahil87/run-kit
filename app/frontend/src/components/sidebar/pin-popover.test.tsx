import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { BoardSummary } from "@/api/boards";

// usePinActions seam: capture pin/unpin so we can assert what a given keystroke
// pins to, without the router/toast tree the real hook needs.
const pin = vi.fn();
const unpin = vi.fn();
vi.mock("@/hooks/use-pin-actions", () => ({
  usePinActions: () => ({ pin, unpin, reorder: vi.fn() }),
}));

// last-used seam: drive the ordering + empty-Enter target deterministically.
let mockLastUsed: string | null = null;
vi.mock("@/lib/last-pinned-board", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/last-pinned-board")>();
  return {
    ...actual,
    readLastPinnedBoard: () => mockLastUsed,
  };
});

import { PinPopover } from "./pin-popover";

function board(name: string): BoardSummary {
  return { name, pinCount: 1 };
}

function renderPopover(boards: BoardSummary[], boardsLoading = false) {
  return render(
    <PinPopover
      server="srvA"
      windowId="@3"
      boards={boards}
      boardsLoading={boardsLoading}
      isPinnedTo={() => false}
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  pin.mockReset().mockResolvedValue(undefined);
  unpin.mockReset();
  mockLastUsed = null;
});
afterEach(() => cleanup());

describe("PinPopover cold start (zero boards)", () => {
  it("pre-fills the input with 'main', selects it, and pins to main on bare Enter", () => {
    renderPopover([]);
    const input = screen.getByLabelText("Pin to new board") as HTMLInputElement;
    expect(input.value).toBe("main");
    // Selected so a keystroke replaces it.
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("main".length);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(pin).toHaveBeenCalledWith("srvA", "@3", "main");
  });

  it("preserves the invent-a-name path when the user types over the selection", () => {
    renderPopover([]);
    const input = screen.getByLabelText("Pin to new board") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "custom" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(pin).toHaveBeenCalledWith("srvA", "@3", "custom");
  });

  it("does NOT prefill or pin to 'main' while boards are still loading (empty list mid-fetch)", () => {
    // boards=[] here means "not loaded yet", not "genuinely zero boards" — the
    // cold-start prefill must stay dormant so a bare Enter is a no-op.
    renderPopover([], /* boardsLoading */ true);
    const input = screen.getByLabelText("Pin to new board") as HTMLInputElement;
    expect(input.value).toBe("");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(pin).not.toHaveBeenCalled();
  });
});

describe("PinPopover with existing boards", () => {
  it("leaves the input empty when boards already exist", () => {
    renderPopover([board("alpha")]);
    const input = screen.getByLabelText("Pin to new board") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("orders the live last-used board first and marks it with an ↵ hint", () => {
    mockLastUsed = "gamma";
    renderPopover([board("alpha"), board("beta"), board("gamma")]);
    const rows = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    // gamma (last-used) is the first board row; carries the ↵ hint.
    expect(rows[0]).toContain("gamma");
    expect(rows[0]).toContain("↵");
    expect(screen.getByLabelText("press Enter to pin here")).toBeInTheDocument();
  });

  it("pins to the last-used board on empty-input Enter", () => {
    mockLastUsed = "gamma";
    renderPopover([board("alpha"), board("gamma")]);
    const input = screen.getByLabelText("Pin to new board");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(pin).toHaveBeenCalledWith("srvA", "@3", "gamma");
  });

  it("is a no-op on empty-input Enter when the last-used board is stale/absent", () => {
    mockLastUsed = "gone";
    renderPopover([board("alpha"), board("beta")]);
    const input = screen.getByLabelText("Pin to new board");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(pin).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("press Enter to pin here")).toBeNull();
  });
});

describe("PinPopover Pin button (mouse submit path)", () => {
  it("pins to the pre-filled 'main' on click at cold start", () => {
    renderPopover([]);
    fireEvent.click(screen.getByRole("button", { name: "Pin to board" }));
    expect(pin).toHaveBeenCalledWith("srvA", "@3", "main");
  });

  it("pins to a typed name on click", () => {
    renderPopover([board("alpha")]);
    const input = screen.getByLabelText("Pin to new board");
    fireEvent.change(input, { target: { value: "custom" } });
    fireEvent.click(screen.getByRole("button", { name: "Pin to board" }));
    expect(pin).toHaveBeenCalledWith("srvA", "@3", "custom");
  });

  it("mirrors empty-Enter: pins to the live last-used board when the input is empty", () => {
    mockLastUsed = "gamma";
    renderPopover([board("alpha"), board("gamma")]);
    fireEvent.click(screen.getByRole("button", { name: "Pin to board" }));
    expect(pin).toHaveBeenCalledWith("srvA", "@3", "gamma");
  });

  it("is disabled when a click would be a no-op (empty input, no live last-used board)", () => {
    mockLastUsed = "gone";
    renderPopover([board("alpha")]);
    const button = screen.getByRole("button", { name: "Pin to board" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(pin).not.toHaveBeenCalled();
  });
});
