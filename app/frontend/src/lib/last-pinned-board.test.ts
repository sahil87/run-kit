import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { BoardSummary } from "@/api/boards";
import {
  LAST_PINNED_BOARD_KEY,
  readLastPinnedBoard,
  writeLastPinnedBoard,
  orderBoardsLastUsedFirst,
} from "./last-pinned-board";

// These helpers back the pin popover's last-used ordering + empty-Enter target
// and the palette pin builder's ordering. Covering read/write persistence and
// the pure ordering proves that behavior without mounting the components.

function board(name: string, pinCount = 0): BoardSummary {
  return { name, pinCount };
}

describe("readLastPinnedBoard / writeLastPinnedBoard", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("round-trips a written value", () => {
    writeLastPinnedBoard("deploys");
    expect(localStorage.getItem(LAST_PINNED_BOARD_KEY)).toBe("deploys");
    expect(readLastPinnedBoard()).toBe("deploys");
  });

  it("returns null when no value has been written", () => {
    expect(readLastPinnedBoard()).toBeNull();
  });

  it("swallows a read failure (localStorage throwing) and returns null", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readLastPinnedBoard()).toBeNull();
  });

  it("swallows a write failure (quota / private mode) without throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeLastPinnedBoard("deploys")).not.toThrow();
  });
});

describe("orderBoardsLastUsedFirst", () => {
  it("moves the live last-used board to the front, keeping the rest in order", () => {
    const boards = [board("a"), board("b"), board("c")];
    expect(orderBoardsLastUsedFirst(boards, "c").map((b) => b.name)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("returns the input order unchanged when lastUsed is null", () => {
    const boards = [board("a"), board("b")];
    expect(orderBoardsLastUsedFirst(boards, null)).toBe(boards);
  });

  it("ignores a stale last-used board no longer in the live list", () => {
    const boards = [board("a"), board("b")];
    expect(orderBoardsLastUsedFirst(boards, "gone")).toBe(boards);
  });

  it("is a no-op when the last-used board is already first", () => {
    const boards = [board("a"), board("b")];
    expect(orderBoardsLastUsedFirst(boards, "a")).toBe(boards);
  });

  it("does not mutate the input array", () => {
    const boards = [board("a"), board("b"), board("c")];
    orderBoardsLastUsedFirst(boards, "c");
    expect(boards.map((b) => b.name)).toEqual(["a", "b", "c"]);
  });
});
