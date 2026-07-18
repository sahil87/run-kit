import { describe, it, expect, vi } from "vitest";
import type { BoardSummary } from "@/api/boards";
import { buildPinActions, PIN_NEW_BOARD_ACTION_ID } from "./palette-pin";

// buildPinActions backs the command-palette pin entries wired in app.tsx.
// Covering the label set, already-pinned exclusion, last-used-first ordering,
// and onSelect wiring proves the actions' behavior without mounting the shell.

function board(name: string, pinCount = 0): BoardSummary {
  return { name, pinCount };
}

const boards = [board("alpha"), board("beta"), board("gamma")];

describe("buildPinActions", () => {
  it("emits one direct-pin action per not-already-pinned board plus the new-board variant", () => {
    const actions = buildPinActions(boards, [], null, vi.fn(), vi.fn());
    expect(actions.map((a) => a.label)).toEqual([
      "Pin: Current Window to alpha",
      "Pin: Current Window to beta",
      "Pin: Current Window to gamma",
      "Pin: Current Window to new board…",
    ]);
    expect(actions[actions.length - 1].id).toBe(PIN_NEW_BOARD_ACTION_ID);
  });

  it("excludes boards the window is already pinned to", () => {
    const actions = buildPinActions(boards, ["beta"], null, vi.fn(), vi.fn());
    expect(actions.map((a) => a.label)).toEqual([
      "Pin: Current Window to alpha",
      "Pin: Current Window to gamma",
      "Pin: Current Window to new board…",
    ]);
  });

  it("orders direct-pin actions last-used-first (excluding the already-pinned)", () => {
    // Pinned to beta, last used gamma → gamma first, then alpha; new-board last.
    const actions = buildPinActions(boards, ["beta"], "gamma", vi.fn(), vi.fn());
    expect(actions.map((a) => a.label)).toEqual([
      "Pin: Current Window to gamma",
      "Pin: Current Window to alpha",
      "Pin: Current Window to new board…",
    ]);
  });

  it("returns only the new-board variant when zero boards exist", () => {
    const actions = buildPinActions([], [], null, vi.fn(), vi.fn());
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe(PIN_NEW_BOARD_ACTION_ID);
  });

  it("returns only the new-board variant when the window is pinned to every board", () => {
    const actions = buildPinActions(
      boards,
      ["alpha", "beta", "gamma"],
      null,
      vi.fn(),
      vi.fn(),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe(PIN_NEW_BOARD_ACTION_ID);
  });

  it("wires direct-pin onSelect to onPin(board) and the variant to onOpenNewBoardPopover", () => {
    const onPin = vi.fn();
    const onOpen = vi.fn();
    const actions = buildPinActions([board("alpha")], [], null, onPin, onOpen);
    actions[0].onSelect();
    expect(onPin).toHaveBeenCalledWith("alpha");
    actions[1].onSelect();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
