import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { BoardSummary } from "@/api/boards";

// Mock the boards API: spy on setBoardOrder, keep everything else real.
const setBoardOrderMock = vi.fn<(order: string[]) => Promise<{ ok: true }>>(() =>
  Promise.resolve({ ok: true }),
);
vi.mock("@/api/boards", async () => {
  const actual = await vi.importActual<typeof import("@/api/boards")>("@/api/boards");
  return {
    ...actual,
    setBoardOrder: (order: string[]) => setBoardOrderMock(order),
  };
});

import { useBoardListReorder } from "./use-board-list-reorder";

const MIME = "application/x-board-list-reorder";
const OTHER_MIME = "application/x-server-reorder";

function board(name: string, pinCount = 1): BoardSummary {
  return { name, pinCount };
}

/** Build a minimal synthetic React.DragEvent with a mutable dataTransfer bag. */
function makeDragEvent(opts: { types?: string[] } = {}) {
  const store = new Map<string, string>();
  const types: string[] = [...(opts.types ?? [])];
  const preventDefault = vi.fn();
  const dataTransfer = {
    setData: (type: string, data: string) => {
      store.set(type, data);
      if (!types.includes(type)) types.push(type);
    },
    getData: (type: string) => store.get(type) ?? "",
    get types() {
      return types;
    },
    dropEffect: "none",
    effectAllowed: "none",
  };
  return {
    dataTransfer,
    preventDefault,
  } as unknown as React.DragEvent;
}

describe("useBoardListReorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setBoardOrderMock.mockClear();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe("MIME-type discrimination", () => {
    it("ignores dragOver when the payload lacks the board-list-reorder MIME", () => {
      const boards = [board("a"), board("b")];
      const { result } = renderHook(() => useBoardListReorder(boards));

      act(() => result.current.getTileProps("a").onDragStart(makeDragEvent()));
      // A dragOver whose dataTransfer carries only a FOREIGN mime must be ignored.
      const over = makeDragEvent({ types: [OTHER_MIME] });
      act(() => result.current.getTileProps("b").onDragOver(over));
      expect(over.preventDefault).not.toHaveBeenCalled();
      expect(result.current.orderedBoards.map((b) => b.name)).toEqual(["a", "b"]);
    });

    it("ignores drop when the payload lacks the board-list-reorder MIME", () => {
      const boards = [board("a"), board("b")];
      const { result } = renderHook(() => useBoardListReorder(boards));

      const drop = makeDragEvent({ types: [OTHER_MIME] });
      act(() => result.current.getTileProps("a").onDrop(drop));
      expect(drop.preventDefault).not.toHaveBeenCalled();
      expect(setBoardOrderMock).not.toHaveBeenCalled();
    });

    it("accepts a dragOver carrying the board-list-reorder MIME", () => {
      const boards = [board("a"), board("b")];
      const { result } = renderHook(() => useBoardListReorder(boards));

      act(() => result.current.getTileProps("a").onDragStart(makeDragEvent()));
      const over = makeDragEvent({ types: [MIME] });
      act(() => result.current.getTileProps("b").onDragOver(over));
      expect(over.preventDefault).toHaveBeenCalled();
    });
  });

  describe("insert-before splice correctness", () => {
    function reorder(names: string[], from: string, to: string): string[] {
      const boards = names.map((n) => board(n));
      const { result } = renderHook(() => useBoardListReorder(boards));
      act(() => result.current.getTileProps(from).onDragStart(makeDragEvent()));
      act(() =>
        result.current.getTileProps(to).onDragOver(makeDragEvent({ types: [MIME] })),
      );
      return result.current.orderedBoards.map((b) => b.name);
    }

    it("moves a board down (drag over a later tile)", () => {
      expect(reorder(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    });

    it("moves a board up (drag over an earlier tile)", () => {
      expect(reorder(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    });

    it("is a no-op when dragging a board over itself", () => {
      expect(reorder(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
    });

    it("marks every board draggable (no infra exclusion)", () => {
      const boards = [board("a"), board("b"), board("c")];
      const { result } = renderHook(() => useBoardListReorder(boards));
      for (const name of ["a", "b", "c"]) {
        const props = result.current.getTileProps(name);
        expect(props.draggable).toBe(true);
        expect(props.onDragStart).toBeTypeOf("function");
        expect(props.onDragOver).toBeTypeOf("function");
        expect(props.onDrop).toBeTypeOf("function");
      }
    });
  });

  describe("optimistic override seed + render-time reconcile", () => {
    it("clears the override once the authoritative order element-wise matches", () => {
      const initial = [board("a"), board("b"), board("c")];
      const { result, rerender } = renderHook(
        ({ boards }: { boards: BoardSummary[] }) => useBoardListReorder(boards),
        { initialProps: { boards: initial } },
      );

      act(() => result.current.getTileProps("a").onDragStart(makeDragEvent()));
      act(() =>
        result.current.getTileProps("c").onDragOver(makeDragEvent({ types: [MIME] })),
      );
      act(() => result.current.getTileProps("c").onDragEnd(makeDragEvent()));
      expect(result.current.orderedBoards.map((b) => b.name)).toEqual(["b", "c", "a"]);

      // The authoritative order arrives (SSE echo → useBoards re-fetch). Reconcile
      // drops the override — no snap-back.
      rerender({ boards: [board("b"), board("c"), board("a")] });
      expect(result.current.orderedBoards.map((b) => b.name)).toEqual(["b", "c", "a"]);
    });

    it("keeps showing the optimistic override until the authoritative order lands", () => {
      const initial = [board("a"), board("b"), board("c")];
      const { result, rerender } = renderHook(
        ({ boards }: { boards: BoardSummary[] }) => useBoardListReorder(boards),
        { initialProps: { boards: initial } },
      );

      act(() => result.current.getTileProps("a").onDragStart(makeDragEvent()));
      act(() =>
        result.current.getTileProps("c").onDragOver(makeDragEvent({ types: [MIME] })),
      );

      // A re-render with the STILL-OLD authoritative order must preserve the override.
      rerender({ boards: [board("a"), board("b"), board("c")] });
      expect(result.current.orderedBoards.map((b) => b.name)).toEqual(["b", "c", "a"]);
    });

    it("appends a board created mid-drag (absent from the override) after the ordered set", () => {
      const initial = [board("a"), board("b")];
      const { result, rerender } = renderHook(
        ({ boards }: { boards: BoardSummary[] }) => useBoardListReorder(boards),
        { initialProps: { boards: initial } },
      );
      act(() => result.current.getTileProps("a").onDragStart(makeDragEvent()));
      act(() =>
        result.current.getTileProps("b").onDragOver(makeDragEvent({ types: [MIME] })),
      );
      // A new board "c" materializes; the override [b,a] does not include it.
      rerender({ boards: [board("a"), board("b"), board("c")] });
      expect(result.current.orderedBoards.map((b) => b.name)).toEqual(["b", "a", "c"]);
    });
  });

  describe("debounce + drop-flush → single POST", () => {
    it("coalesces a rapid dragOver sweep into one debounced POST with the final order", () => {
      const boards = [board("a"), board("b"), board("c")];
      const { result } = renderHook(() => useBoardListReorder(boards));

      act(() => result.current.getTileProps("a").onDragStart(makeDragEvent()));
      act(() =>
        result.current.getTileProps("b").onDragOver(makeDragEvent({ types: [MIME] })),
      );
      act(() =>
        result.current.getTileProps("c").onDragOver(makeDragEvent({ types: [MIME] })),
      );
      expect(setBoardOrderMock).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(setBoardOrderMock).toHaveBeenCalledTimes(1);
      expect(setBoardOrderMock).toHaveBeenCalledWith(["b", "c", "a"]);
    });

    it("drop flushes the pending debounced POST immediately (single call)", () => {
      const boards = [board("a"), board("b"), board("c")];
      const { result } = renderHook(() => useBoardListReorder(boards));

      act(() => result.current.getTileProps("a").onDragStart(makeDragEvent()));
      act(() =>
        result.current.getTileProps("c").onDragOver(makeDragEvent({ types: [MIME] })),
      );
      act(() =>
        result.current.getTileProps("c").onDrop(makeDragEvent({ types: [MIME] })),
      );
      expect(setBoardOrderMock).toHaveBeenCalledTimes(1);
      expect(setBoardOrderMock).toHaveBeenCalledWith(["b", "c", "a"]);

      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(setBoardOrderMock).toHaveBeenCalledTimes(1);
    });

    it("surfaces a POST failure via the onError callback", async () => {
      setBoardOrderMock.mockRejectedValueOnce(new Error("boom"));
      const onError = vi.fn();
      const boards = [board("a"), board("b")];
      const { result } = renderHook(() => useBoardListReorder(boards, onError));

      act(() => result.current.getTileProps("a").onDragStart(makeDragEvent()));
      act(() =>
        result.current.getTileProps("b").onDragOver(makeDragEvent({ types: [MIME] })),
      );
      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
      });
      expect(onError).toHaveBeenCalledWith("boom");
    });
  });

  describe("unmount cleanup", () => {
    it("clears a pending debounce timer on unmount (no post-unmount POST)", () => {
      const boards = [board("a"), board("b")];
      const { result, unmount } = renderHook(() => useBoardListReorder(boards));

      act(() => result.current.getTileProps("a").onDragStart(makeDragEvent()));
      act(() =>
        result.current.getTileProps("b").onDragOver(makeDragEvent({ types: [MIME] })),
      );
      unmount();
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(setBoardOrderMock).not.toHaveBeenCalled();
    });
  });

  describe("isDragging / draggingName drag-source feedback", () => {
    it("reports draggingName while a drag is active and clears it on drag end", () => {
      const boards = [board("a"), board("b")];
      const { result } = renderHook(() => useBoardListReorder(boards));

      expect(result.current.isDragging).toBe(false);
      expect(result.current.draggingName).toBeNull();

      act(() => result.current.getTileProps("a").onDragStart(makeDragEvent()));
      expect(result.current.isDragging).toBe(true);
      expect(result.current.draggingName).toBe("a");

      act(() => result.current.getTileProps("a").onDragEnd(makeDragEvent()));
      expect(result.current.isDragging).toBe(false);
      expect(result.current.draggingName).toBeNull();
    });
  });

  describe("self-target drop acceptance (snap-back fix)", () => {
    it("accepts a dragOver on the dragged tile itself without reordering or scheduling a POST", () => {
      const boards = [board("a"), board("b"), board("c")];
      const { result } = renderHook(() => useBoardListReorder(boards));

      act(() => result.current.getTileProps("a").onDragStart(makeDragEvent()));
      const over = makeDragEvent({ types: [MIME] });
      act(() => result.current.getTileProps("a").onDragOver(over));

      expect(over.preventDefault).toHaveBeenCalled();
      expect(over.dataTransfer.dropEffect).toBe("move");
      expect(result.current.orderedBoards.map((b) => b.name)).toEqual(["a", "b", "c"]);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(setBoardOrderMock).not.toHaveBeenCalled();
    });

    it("does not reschedule an already-pending debounce when the dragged tile re-enters itself", () => {
      const boards = [board("a"), board("b")];
      const { result } = renderHook(() => useBoardListReorder(boards));

      act(() => result.current.getTileProps("a").onDragStart(makeDragEvent()));
      act(() =>
        result.current.getTileProps("b").onDragOver(makeDragEvent({ types: [MIME] })),
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });
      act(() => result.current.getTileProps("a").onDragOver(makeDragEvent({ types: [MIME] })));
      expect(result.current.orderedBoards.map((b) => b.name)).toEqual(["b", "a"]);

      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(setBoardOrderMock).toHaveBeenCalledTimes(1);
      expect(setBoardOrderMock).toHaveBeenCalledWith(["b", "a"]);
    });

    it("flushes the pending debounced POST on a drop over the SOURCE tile", () => {
      const boards = [board("a"), board("b"), board("c")];
      const { result } = renderHook(() => useBoardListReorder(boards));

      act(() => result.current.getTileProps("a").onDragStart(makeDragEvent()));
      act(() =>
        result.current.getTileProps("c").onDragOver(makeDragEvent({ types: [MIME] })),
      );
      act(() =>
        result.current.getTileProps("a").onDrop(makeDragEvent({ types: [MIME] })),
      );
      expect(setBoardOrderMock).toHaveBeenCalledTimes(1);
      expect(setBoardOrderMock).toHaveBeenCalledWith(["b", "c", "a"]);

      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(setBoardOrderMock).toHaveBeenCalledTimes(1);
    });
  });
});
