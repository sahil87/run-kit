import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { BoardEntry } from "@/api/boards";
import { useBoardPaneReorder } from "./use-board-pane-reorder";

const MIME = "application/x-board-pane-reorder";
const OTHER_MIME = "application/x-server-reorder";

/** Build a minimal BoardEntry; only server/windowId matter for reorder. */
function entry(server: string, windowId: string): BoardEntry {
  return {
    server,
    windowId,
    session: `_rk-pin-${windowId}`,
    windowIndex: 0,
    windowName: windowId,
    orderKey: windowId,
  };
}

/** Build a synthetic React.DragEvent with a mutable dataTransfer bag. */
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
  return { dataTransfer, preventDefault } as unknown as React.DragEvent;
}

type ReorderFn = (
  server: string,
  windowId: string,
  board: string,
  before: string | null,
  after: string | null,
) => Promise<void>;

describe("useBoardPaneReorder", () => {
  let reorder: ReturnType<typeof vi.fn<ReorderFn>>;
  beforeEach(() => {
    // Default: the reorder POST resolves. Individual tests override with a
    // rejecting mock to exercise the failure-rollback path.
    reorder = vi.fn<ReorderFn>().mockResolvedValue(undefined);
  });

  describe("MIME-type discrimination", () => {
    it("ignores dragOver when the payload lacks the board-pane-reorder MIME", () => {
      const entries = [entry("s", "@a"), entry("s", "@b")];
      const { result } = renderHook(() =>
        useBoardPaneReorder(entries, "main", reorder),
      );
      act(() => result.current.getHandleProps("s", "@a").handle.onDragStart(makeDragEvent()));

      const over = makeDragEvent({ types: [OTHER_MIME] });
      act(() => result.current.getHandleProps("s", "@b").drop.onDragOver(over));
      expect(over.preventDefault).not.toHaveBeenCalled();
      expect(
        result.current.orderedEntries.map((e) => e.windowId),
      ).toEqual(["@a", "@b"]);
    });

    it("ignores drop when the payload lacks the board-pane-reorder MIME", () => {
      const entries = [entry("s", "@a"), entry("s", "@b")];
      const { result } = renderHook(() =>
        useBoardPaneReorder(entries, "main", reorder),
      );
      const drop = makeDragEvent({ types: [OTHER_MIME] });
      act(() => result.current.getHandleProps("s", "@a").drop.onDrop(drop));
      expect(drop.preventDefault).not.toHaveBeenCalled();
      expect(reorder).not.toHaveBeenCalled();
    });

    it("accepts a dragOver carrying the board-pane-reorder MIME", () => {
      const entries = [entry("s", "@a"), entry("s", "@b")];
      const { result } = renderHook(() =>
        useBoardPaneReorder(entries, "main", reorder),
      );
      act(() => result.current.getHandleProps("s", "@a").handle.onDragStart(makeDragEvent()));
      const over = makeDragEvent({ types: [MIME] });
      act(() => result.current.getHandleProps("s", "@b").drop.onDragOver(over));
      expect(over.preventDefault).toHaveBeenCalled();
      expect(over.dataTransfer.dropEffect).toBe("move");
    });
  });

  describe("insert-before splice preview (optimistic override)", () => {
    function preview(ids: string[], from: string, to: string): string[] {
      const entries = ids.map((id) => entry("s", id));
      const { result } = renderHook(() =>
        useBoardPaneReorder(entries, "main", reorder),
      );
      act(() => result.current.getHandleProps("s", from).handle.onDragStart(makeDragEvent()));
      act(() =>
        result.current.getHandleProps("s", to).drop.onDragOver(makeDragEvent({ types: [MIME] })),
      );
      return result.current.orderedEntries.map((e) => e.windowId);
    }

    it("moves a pane down (drag over a later pane)", () => {
      expect(preview(["@a", "@b", "@c"], "@a", "@c")).toEqual(["@b", "@c", "@a"]);
    });

    it("moves a pane up (drag over an earlier pane)", () => {
      expect(preview(["@a", "@b", "@c"], "@c", "@a")).toEqual(["@c", "@a", "@b"]);
    });

    it("is a no-op preview when dragging over itself", () => {
      expect(preview(["@a", "@b", "@c"], "@b", "@b")).toEqual(["@a", "@b", "@c"]);
    });
  });

  describe("self-target drop acceptance (snap-back fix)", () => {
    it("accepts a dragOver on the dragged pane itself without reordering", () => {
      const entries = [entry("s", "@a"), entry("s", "@b"), entry("s", "@c")];
      const { result } = renderHook(() =>
        useBoardPaneReorder(entries, "main", reorder),
      );
      act(() => result.current.getHandleProps("s", "@a").handle.onDragStart(makeDragEvent()));

      const over = makeDragEvent({ types: [MIME] });
      act(() => result.current.getHandleProps("s", "@a").drop.onDragOver(over));
      expect(over.preventDefault).toHaveBeenCalled();
      expect(over.dataTransfer.dropEffect).toBe("move");
      // No reorder math ran: order unchanged.
      expect(
        result.current.orderedEntries.map((e) => e.windowId),
      ).toEqual(["@a", "@b", "@c"]);
    });
  });

  describe("single POST on drop (no debounce)", () => {
    function dropAfter(
      ids: string[],
      from: string,
      to: string,
    ): { server: string; windowId: string; board: string; before: string | null; after: string | null } | null {
      const entries = ids.map((id) => entry("s", id));
      const { result } = renderHook(() =>
        useBoardPaneReorder(entries, "main", reorder),
      );
      act(() => result.current.getHandleProps("s", from).handle.onDragStart(makeDragEvent()));
      act(() =>
        result.current.getHandleProps("s", to).drop.onDragOver(makeDragEvent({ types: [MIME] })),
      );
      act(() =>
        result.current.getHandleProps("s", to).drop.onDrop(makeDragEvent({ types: [MIME] })),
      );
      if (reorder.mock.calls.length === 0) return null;
      const [server, windowId, board, before, after] = reorder.mock.calls[0];
      return { server, windowId, board, before, after };
    }

    it("fires ONE reorder with before/after = new neighbours (moved to end)", () => {
      // [a,b,c], drag a over c → [b,c,a]: before=@c, after=null.
      expect(dropAfter(["@a", "@b", "@c"], "@a", "@c")).toEqual({
        server: "s",
        windowId: "@a",
        board: "main",
        before: "@c",
        after: null,
      });
      expect(reorder).toHaveBeenCalledTimes(1);
    });

    it("fires ONE reorder with before=null when moved to the start", () => {
      // [a,b,c], drag c over a → [c,a,b]: before=null, after=@a.
      expect(dropAfter(["@a", "@b", "@c"], "@c", "@a")).toEqual({
        server: "s",
        windowId: "@c",
        board: "main",
        before: null,
        after: "@a",
      });
    });

    it("fires NO reorder for a self-drop (no-op)", () => {
      const entries = [entry("s", "@a"), entry("s", "@b")];
      const { result } = renderHook(() =>
        useBoardPaneReorder(entries, "main", reorder),
      );
      act(() => result.current.getHandleProps("s", "@a").handle.onDragStart(makeDragEvent()));
      // Drop without any reordering dragOver → override equals authoritative.
      act(() =>
        result.current.getHandleProps("s", "@a").drop.onDrop(makeDragEvent({ types: [MIME] })),
      );
      expect(reorder).not.toHaveBeenCalled();
    });

    it("carries the correct server for a cross-server board", () => {
      // Two servers on one board; drag srv2:@c over srv1:@a → lands first.
      const entries = [entry("srv1", "@a"), entry("srv1", "@b"), entry("srv2", "@c")];
      const { result } = renderHook(() =>
        useBoardPaneReorder(entries, "main", reorder),
      );
      act(() => result.current.getHandleProps("srv2", "@c").handle.onDragStart(makeDragEvent()));
      act(() =>
        result.current
          .getHandleProps("srv1", "@a")
          .drop.onDragOver(makeDragEvent({ types: [MIME] })),
      );
      act(() =>
        result.current.getHandleProps("srv1", "@a").drop.onDrop(makeDragEvent({ types: [MIME] })),
      );
      expect(reorder).toHaveBeenCalledTimes(1);
      // server must be srv2 (the dragged pane's server), windowId @c, after @a.
      expect(reorder).toHaveBeenCalledWith("srv2", "@c", "main", null, "@a");
    });
  });

  describe("drop reconciles the override against mid-drag entry churn", () => {
    it("never POSTs a neighbour removed mid-drag (reconciles against current keys)", () => {
      // Start [a,b,c,d]; drag @a over @c → optimistic override [b,c,a,d]. Then,
      // mid-drag, the authoritative entries lose @c (unpin / remote removal).
      // The RAW override still holds the stale @c immediately before @a, so a
      // naive `override[landedIdx-1]` would POST before=@c — a windowId no
      // longer on the board → 400. The drop must reconcile against the current
      // keys (effective order [b,a,d]) so before=@b, after=@d instead.
      const initial = [
        entry("s", "@a"),
        entry("s", "@b"),
        entry("s", "@c"),
        entry("s", "@d"),
      ];
      const { result, rerender } = renderHook(
        ({ entries }: { entries: BoardEntry[] }) =>
          useBoardPaneReorder(entries, "main", reorder),
        { initialProps: { entries: initial } },
      );
      act(() => result.current.getHandleProps("s", "@a").handle.onDragStart(makeDragEvent()));
      act(() =>
        result.current.getHandleProps("s", "@c").drop.onDragOver(makeDragEvent({ types: [MIME] })),
      );
      // @c disappears mid-drag; the raw override is still [@b,@c,@a,@d].
      rerender({ entries: [entry("s", "@a"), entry("s", "@b"), entry("s", "@d")] });
      act(() =>
        result.current.getHandleProps("s", "@d").drop.onDrop(makeDragEvent({ types: [MIME] })),
      );
      // Reconciled effective order [b,a,d]: @a lands between @b and @d — the
      // stale @c is never referenced.
      expect(reorder).toHaveBeenCalledTimes(1);
      expect(reorder).toHaveBeenCalledWith("s", "@a", "main", "@b", "@d");
    });
  });

  describe("cancelled drag reverts the preview (T011, A-018)", () => {
    it("clears the override on dragEnd when no drop committed (Escape / release outside)", () => {
      const initial = [entry("s", "@a"), entry("s", "@b"), entry("s", "@c")];
      const { result } = renderHook(() =>
        useBoardPaneReorder(initial, "main", reorder),
      );
      act(() => result.current.getHandleProps("s", "@a").handle.onDragStart(makeDragEvent()));
      act(() =>
        result.current.getHandleProps("s", "@c").drop.onDragOver(makeDragEvent({ types: [MIME] })),
      );
      // Optimistic preview is live: a moved to the end.
      expect(result.current.orderedEntries.map((e) => e.windowId)).toEqual([
        "@b",
        "@c",
        "@a",
      ]);

      // Drag ends WITHOUT a drop (cancel) → override reverts to authoritative.
      act(() => result.current.getHandleProps("s", "@a").handle.onDragEnd(makeDragEvent()));
      expect(result.current.orderedEntries.map((e) => e.windowId)).toEqual([
        "@a",
        "@b",
        "@c",
      ]);
      expect(reorder).not.toHaveBeenCalled();
    });

    it("keeps the override after a COMMITTED drop (no snap-back)", () => {
      const initial = [entry("s", "@a"), entry("s", "@b"), entry("s", "@c")];
      const { result } = renderHook(() =>
        useBoardPaneReorder(initial, "main", reorder),
      );
      act(() => result.current.getHandleProps("s", "@a").handle.onDragStart(makeDragEvent()));
      act(() =>
        result.current.getHandleProps("s", "@c").drop.onDragOver(makeDragEvent({ types: [MIME] })),
      );
      // A real drop commits (fires the POST) BEFORE dragEnd (HTML5 ordering).
      act(() =>
        result.current.getHandleProps("s", "@c").drop.onDrop(makeDragEvent({ types: [MIME] })),
      );
      act(() => result.current.getHandleProps("s", "@c").handle.onDragEnd(makeDragEvent()));
      expect(reorder).toHaveBeenCalledTimes(1);
      // The override survives dragEnd — the SSE echo (not dragEnd) clears it.
      expect(result.current.orderedEntries.map((e) => e.windowId)).toEqual([
        "@b",
        "@c",
        "@a",
      ]);
    });
  });

  describe("optimistic override rolls back on POST rejection (T014, A-012)", () => {
    it("clears the override when the reorder POST rejects", async () => {
      reorder = vi.fn<ReorderFn>().mockRejectedValue(new Error("boom"));
      const initial = [entry("s", "@a"), entry("s", "@b"), entry("s", "@c")];
      const { result } = renderHook(() =>
        useBoardPaneReorder(initial, "main", reorder),
      );
      act(() => result.current.getHandleProps("s", "@a").handle.onDragStart(makeDragEvent()));
      act(() =>
        result.current.getHandleProps("s", "@c").drop.onDragOver(makeDragEvent({ types: [MIME] })),
      );
      act(() =>
        result.current.getHandleProps("s", "@c").drop.onDrop(makeDragEvent({ types: [MIME] })),
      );
      expect(reorder).toHaveBeenCalledTimes(1);

      // The rejection is observed asynchronously (promise catch) → override
      // clears and the display reverts to the authoritative order.
      await waitFor(() =>
        expect(result.current.orderedEntries.map((e) => e.windowId)).toEqual([
          "@a",
          "@b",
          "@c",
        ]),
      );
    });
  });

  describe("render-time reconcile (no snap-back)", () => {
    it("clears the override once the authoritative order element-wise matches", () => {
      const initial = [entry("s", "@a"), entry("s", "@b"), entry("s", "@c")];
      const { result, rerender } = renderHook(
        ({ entries }: { entries: BoardEntry[] }) =>
          useBoardPaneReorder(entries, "main", reorder),
        { initialProps: { entries: initial } },
      );

      act(() => result.current.getHandleProps("s", "@a").handle.onDragStart(makeDragEvent()));
      act(() =>
        result.current.getHandleProps("s", "@c").drop.onDragOver(makeDragEvent({ types: [MIME] })),
      );
      // COMMIT the drop (fires the POST) before dragEnd — a committed drop keeps
      // the override until the SSE echo reconciles it (no snap-back). A drag
      // that ends WITHOUT a drop is a cancel and reverts (covered above).
      act(() =>
        result.current.getHandleProps("s", "@c").drop.onDrop(makeDragEvent({ types: [MIME] })),
      );
      act(() => result.current.getHandleProps("s", "@c").handle.onDragEnd(makeDragEvent()));
      expect(
        result.current.orderedEntries.map((e) => e.windowId),
      ).toEqual(["@b", "@c", "@a"]);

      // Authoritative order arrives (SSE echo refetched entries to match).
      const authoritative = [entry("s", "@b"), entry("s", "@c"), entry("s", "@a")];
      rerender({ entries: authoritative });
      expect(
        result.current.orderedEntries.map((e) => e.windowId),
      ).toEqual(["@b", "@c", "@a"]);
    });

    it("keeps showing the optimistic override until the authoritative order lands", () => {
      const initial = [entry("s", "@a"), entry("s", "@b"), entry("s", "@c")];
      const { result, rerender } = renderHook(
        ({ entries }: { entries: BoardEntry[] }) =>
          useBoardPaneReorder(entries, "main", reorder),
        { initialProps: { entries: initial } },
      );
      act(() => result.current.getHandleProps("s", "@a").handle.onDragStart(makeDragEvent()));
      act(() =>
        result.current.getHandleProps("s", "@c").drop.onDragOver(makeDragEvent({ types: [MIME] })),
      );
      // Re-render with the STILL-OLD authoritative order must preserve the override.
      rerender({ entries: [entry("s", "@a"), entry("s", "@b"), entry("s", "@c")] });
      expect(
        result.current.orderedEntries.map((e) => e.windowId),
      ).toEqual(["@b", "@c", "@a"]);
    });
  });

  describe("split drag-source / drop-target props (T012, A-019)", () => {
    it("returns the drag handle (draggable) separately from the pane drop target", () => {
      const entries = [entry("s", "@a"), entry("s", "@b")];
      const { result } = renderHook(() =>
        useBoardPaneReorder(entries, "main", reorder),
      );
      const props = result.current.getHandleProps("s", "@a");
      // The HANDLE (header) is the drag source and is draggable; it exposes no
      // drop handlers.
      expect(props.handle.draggable).toBe(true);
      expect(typeof props.handle.onDragStart).toBe("function");
      expect(typeof props.handle.onDragEnd).toBe("function");
      expect("onDrop" in props.handle).toBe(false);
      expect("onDragOver" in props.handle).toBe(false);
      // The DROP target (pane root) carries onDragOver/onDrop and is not the
      // draggable source.
      expect(typeof props.drop.onDragOver).toBe("function");
      expect(typeof props.drop.onDrop).toBe("function");
      expect("draggable" in props.drop).toBe(false);
    });

    it("commits a move via the pane-root drop target (drop over the body)", () => {
      // A drop released over the pane BODY (the drop-target props, attached to
      // the pane root — not the header) still commits: dragStart on the header
      // handle, dragOver+drop on the target pane's drop props.
      const entries = [entry("s", "@a"), entry("s", "@b"), entry("s", "@c")];
      const { result } = renderHook(() =>
        useBoardPaneReorder(entries, "main", reorder),
      );
      act(() => result.current.getHandleProps("s", "@a").handle.onDragStart(makeDragEvent()));
      act(() =>
        result.current.getHandleProps("s", "@c").drop.onDragOver(makeDragEvent({ types: [MIME] })),
      );
      act(() =>
        result.current.getHandleProps("s", "@c").drop.onDrop(makeDragEvent({ types: [MIME] })),
      );
      // [a,b,c], a dropped over c → lands last: before=@c, after=null.
      expect(reorder).toHaveBeenCalledTimes(1);
      expect(reorder).toHaveBeenCalledWith("s", "@a", "main", "@c", null);
    });
  });

  describe("isDragging / draggingKey drag-source feedback", () => {
    it("reports draggingKey while a drag is active and clears it on drag end", () => {
      const entries = [entry("s", "@a"), entry("s", "@b")];
      const { result } = renderHook(() =>
        useBoardPaneReorder(entries, "main", reorder),
      );
      expect(result.current.isDragging).toBe(false);
      expect(result.current.draggingKey).toBeNull();

      act(() => result.current.getHandleProps("s", "@a").handle.onDragStart(makeDragEvent()));
      expect(result.current.isDragging).toBe(true);
      expect(result.current.draggingKey).toBe("s:@a");

      act(() => result.current.getHandleProps("s", "@a").handle.onDragEnd(makeDragEvent()));
      expect(result.current.isDragging).toBe(false);
      expect(result.current.draggingKey).toBeNull();
    });
  });
});
