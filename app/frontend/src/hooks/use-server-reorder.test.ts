import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ServerInfo } from "@/api/client";

// Mock the API client: spy on setServerOrder, keep isInfraServer real (the hook
// relies on its rk-daemon / rk-test-* classification for infra exclusion).
const setServerOrderMock = vi.fn<(order: string[]) => Promise<void>>(() =>
  Promise.resolve(),
);
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    setServerOrder: (order: string[]) => setServerOrderMock(order),
  };
});

import { useServerReorder } from "./use-server-reorder";

const MIME = "application/x-server-reorder";
const OTHER_MIME = "application/x-session-reorder";

function srv(name: string, rank?: number | null): ServerInfo {
  return { name, sessionCount: 0, rank: rank ?? null } as ServerInfo;
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
    // The hook never reads these, but React.DragEvent requires them structurally.
  } as unknown as React.DragEvent;
}

describe("useServerReorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setServerOrderMock.mockClear();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  describe("MIME-type discrimination", () => {
    it("ignores dragOver when the payload lacks the server-reorder MIME", () => {
      const servers = [srv("a"), srv("b")];
      const { result } = renderHook(() => useServerReorder(servers));

      // Start a drag on "a" (seeds the override + MIME on the dataTransfer).
      const start = makeDragEvent();
      act(() => result.current.getTileProps("a").onDragStart!(start));

      // A dragOver whose dataTransfer carries only a FOREIGN mime must be ignored:
      // no preventDefault, no reorder.
      const over = makeDragEvent({ types: [OTHER_MIME] });
      act(() => result.current.getTileProps("b").onDragOver!(over));
      expect(over.preventDefault).not.toHaveBeenCalled();
      expect(result.current.orderedServers.map((s) => s.name)).toEqual(["a", "b"]);
    });

    it("ignores drop when the payload lacks the server-reorder MIME", () => {
      const servers = [srv("a"), srv("b")];
      const { result } = renderHook(() => useServerReorder(servers));

      const drop = makeDragEvent({ types: [OTHER_MIME] });
      act(() => result.current.getTileProps("a").onDrop!(drop));
      expect(drop.preventDefault).not.toHaveBeenCalled();
      expect(setServerOrderMock).not.toHaveBeenCalled();
    });

    it("accepts a dragOver carrying the server-reorder MIME", () => {
      const servers = [srv("a"), srv("b")];
      const { result } = renderHook(() => useServerReorder(servers));

      const start = makeDragEvent();
      act(() => result.current.getTileProps("a").onDragStart!(start));
      // onDragStart set the MIME on `start`; a real dragOver event carries the
      // same MIME in its own dataTransfer.types.
      const over = makeDragEvent({ types: [MIME] });
      act(() => result.current.getTileProps("b").onDragOver!(over));
      expect(over.preventDefault).toHaveBeenCalled();
    });
  });

  describe("insert-before splice correctness", () => {
    function reorder(names: string[], from: string, to: string): string[] {
      const servers = names.map((n) => srv(n));
      const { result } = renderHook(() => useServerReorder(servers));
      act(() => result.current.getTileProps(from).onDragStart!(makeDragEvent()));
      act(() =>
        result.current.getTileProps(to).onDragOver!(makeDragEvent({ types: [MIME] })),
      );
      return result.current.orderedServers.map((s) => s.name);
    }

    it("moves a tile down (drag over a later tile)", () => {
      // Remove "a" then re-insert at the target's original index (post-removal
      // splice, matching the session-reorder pattern): [a,b,c] → [b,c,a].
      expect(reorder(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    });

    it("moves a tile up (drag over an earlier tile)", () => {
      // Drag "c" over "a" → [c, a, b].
      expect(reorder(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    });

    it("moves the first tile toward the last", () => {
      // Drag "a" over "d" → remove "a", insert at idx 3 of the shrunk array →
      // [b, c, d, a].
      expect(reorder(["a", "b", "c", "d"], "a", "d")).toEqual(["b", "c", "d", "a"]);
    });

    it("moves the last tile to before the first", () => {
      // Drag "d" over "a" → [d, a, b, c].
      expect(reorder(["a", "b", "c", "d"], "d", "a")).toEqual(["d", "a", "b", "c"]);
    });

    it("is a no-op when dragging a tile over itself", () => {
      expect(reorder(["a", "b", "c"], "b", "b")).toEqual(["a", "b", "c"]);
    });
  });

  describe("infra exclusion", () => {
    it("marks infra tiles non-draggable with no drop handlers", () => {
      const servers = [srv("web"), srv("rk-daemon"), srv("rk-test-e2e")];
      const { result } = renderHook(() => useServerReorder(servers));

      expect(result.current.getTileProps("web").draggable).toBe(true);
      const daemon = result.current.getTileProps("rk-daemon");
      expect(daemon.draggable).toBe(false);
      expect(daemon.onDragStart).toBeUndefined();
      expect(daemon.onDragOver).toBeUndefined();
      expect(daemon.onDrop).toBeUndefined();
    });

    it("does not start a drag from an infra tile", () => {
      const servers = [srv("web"), srv("api"), srv("rk-daemon")];
      const { result } = renderHook(() => useServerReorder(servers));
      // Infra tiles have no onDragStart, so no drag can originate — draggingName
      // stays null.
      expect(result.current.getTileProps("rk-daemon").onDragStart).toBeUndefined();
      expect(result.current.draggingName).toBeNull();
    });

    it("attaches no drop handler to an infra tile (not a valid drop target)", () => {
      const servers = [srv("web"), srv("api"), srv("rk-daemon")];
      const { result } = renderHook(() => useServerReorder(servers));

      act(() => result.current.getTileProps("web").onDragStart!(makeDragEvent()));
      // The infra tile exposes no onDragOver/onDrop handler at all, so a drag can
      // never land on it — the exclusion holds at the props layer.
      const daemon = result.current.getTileProps("rk-daemon");
      expect(daemon.onDragOver).toBeUndefined();
      expect(daemon.onDrop).toBeUndefined();
    });

    it("keeps infra servers pinned last in the ordered output after a regular reorder", () => {
      const servers = [srv("a"), srv("b"), srv("rk-daemon")];
      const { result } = renderHook(() => useServerReorder(servers));

      act(() => result.current.getTileProps("a").onDragStart!(makeDragEvent()));
      act(() =>
        result.current.getTileProps("b").onDragOver!(makeDragEvent({ types: [MIME] })),
      );
      // Regular order flips to [b, a]; infra "rk-daemon" stays last.
      expect(result.current.orderedServers.map((s) => s.name)).toEqual([
        "b",
        "a",
        "rk-daemon",
      ]);
    });

    it("posts only the regular-class order (infra omitted) on drop", () => {
      const servers = [srv("a"), srv("b"), srv("rk-daemon")];
      const { result } = renderHook(() => useServerReorder(servers));

      act(() => result.current.getTileProps("a").onDragStart!(makeDragEvent()));
      act(() =>
        result.current.getTileProps("b").onDragOver!(makeDragEvent({ types: [MIME] })),
      );
      act(() =>
        result.current.getTileProps("b").onDrop!(makeDragEvent({ types: [MIME] })),
      );
      expect(setServerOrderMock).toHaveBeenCalledTimes(1);
      expect(setServerOrderMock).toHaveBeenCalledWith(["b", "a"]);
    });
  });

  describe("optimistic override seed + render-time reconcile", () => {
    it("clears the override once the authoritative order element-wise matches", () => {
      const initial = [srv("a"), srv("b"), srv("c")];
      const { result, rerender } = renderHook(
        ({ servers }: { servers: ServerInfo[] }) => useServerReorder(servers),
        { initialProps: { servers: initial } },
      );

      // Drag "a" over "c" → optimistic override [b, c, a].
      act(() => result.current.getTileProps("a").onDragStart!(makeDragEvent()));
      act(() =>
        result.current.getTileProps("c").onDragOver!(makeDragEvent({ types: [MIME] })),
      );
      act(() => result.current.getTileProps("c").onDragEnd!(makeDragEvent()));
      expect(result.current.orderedServers.map((s) => s.name)).toEqual(["b", "c", "a"]);

      // The authoritative order now arrives (SSE echo re-sorted ctx.servers to
      // match). The render-time reconcile drops the override and reads the
      // authoritative order — no snap-back, no stale override.
      const authoritative = [srv("b"), srv("c"), srv("a")];
      rerender({ servers: authoritative });
      expect(result.current.orderedServers.map((s) => s.name)).toEqual(["b", "c", "a"]);
    });

    it("keeps showing the optimistic override until the authoritative order lands", () => {
      const initial = [srv("a"), srv("b"), srv("c")];
      const { result, rerender } = renderHook(
        ({ servers }: { servers: ServerInfo[] }) => useServerReorder(servers),
        { initialProps: { servers: initial } },
      );

      act(() => result.current.getTileProps("a").onDragStart!(makeDragEvent()));
      act(() =>
        result.current.getTileProps("c").onDragOver!(makeDragEvent({ types: [MIME] })),
      );

      // A re-render with the STILL-OLD authoritative order (echo not yet landed)
      // must preserve the optimistic override, not snap back to [a, b, c].
      rerender({ servers: [srv("a"), srv("b"), srv("c")] });
      expect(result.current.orderedServers.map((s) => s.name)).toEqual(["b", "c", "a"]);
    });
  });

  describe("debounce + drop-flush → single POST", () => {
    it("coalesces a rapid dragOver sweep into one debounced POST with the final order", () => {
      const servers = [srv("a"), srv("b"), srv("c")];
      const { result } = renderHook(() => useServerReorder(servers));

      act(() => result.current.getTileProps("a").onDragStart!(makeDragEvent()));
      // Sweep "a" over "b" then over "c": two dragOvers, each reschedules the timer.
      act(() =>
        result.current.getTileProps("b").onDragOver!(makeDragEvent({ types: [MIME] })),
      );
      act(() =>
        result.current.getTileProps("c").onDragOver!(makeDragEvent({ types: [MIME] })),
      );
      // Before the debounce fires, nothing has been POSTed.
      expect(setServerOrderMock).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(250);
      });
      // One POST with the FINAL order (a inserted before c → [b, c, a]).
      expect(setServerOrderMock).toHaveBeenCalledTimes(1);
      expect(setServerOrderMock).toHaveBeenCalledWith(["b", "c", "a"]);
    });

    it("drop flushes the pending debounced POST immediately (single call, no double-post)", () => {
      const servers = [srv("a"), srv("b"), srv("c")];
      const { result } = renderHook(() => useServerReorder(servers));

      act(() => result.current.getTileProps("a").onDragStart!(makeDragEvent()));
      act(() =>
        result.current.getTileProps("c").onDragOver!(makeDragEvent({ types: [MIME] })),
      );
      // Drop before the 250ms timer elapses: flushes now.
      act(() =>
        result.current.getTileProps("c").onDrop!(makeDragEvent({ types: [MIME] })),
      );
      expect(setServerOrderMock).toHaveBeenCalledTimes(1);
      expect(setServerOrderMock).toHaveBeenCalledWith(["b", "c", "a"]);

      // Advancing the timer must NOT fire a second POST — drop cleared it.
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(setServerOrderMock).toHaveBeenCalledTimes(1);
    });

    it("surfaces a POST failure via the onError callback", async () => {
      setServerOrderMock.mockRejectedValueOnce(new Error("boom"));
      const onError = vi.fn();
      const servers = [srv("a"), srv("b")];
      const { result } = renderHook(() => useServerReorder(servers, onError));

      act(() => result.current.getTileProps("a").onDragStart!(makeDragEvent()));
      act(() =>
        result.current.getTileProps("b").onDragOver!(makeDragEvent({ types: [MIME] })),
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
      const servers = [srv("a"), srv("b")];
      const { result, unmount } = renderHook(() => useServerReorder(servers));

      act(() => result.current.getTileProps("a").onDragStart!(makeDragEvent()));
      act(() =>
        result.current.getTileProps("b").onDragOver!(makeDragEvent({ types: [MIME] })),
      );
      // Unmount with a pending debounce; advancing the timer must not POST.
      unmount();
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(setServerOrderMock).not.toHaveBeenCalled();
    });
  });

  describe("isDragging / draggingName drag-source feedback", () => {
    it("reports draggingName while a drag is active and clears it on drag end", () => {
      const servers = [srv("a"), srv("b")];
      const { result } = renderHook(() => useServerReorder(servers));

      expect(result.current.isDragging).toBe(false);
      expect(result.current.draggingName).toBeNull();

      act(() => result.current.getTileProps("a").onDragStart!(makeDragEvent()));
      expect(result.current.isDragging).toBe(true);
      expect(result.current.draggingName).toBe("a");

      act(() => result.current.getTileProps("a").onDragEnd!(makeDragEvent()));
      expect(result.current.isDragging).toBe(false);
      expect(result.current.draggingName).toBeNull();
    });
  });

  describe("self-target drop acceptance (snap-back fix)", () => {
    it("accepts a dragOver on the dragged tile itself without reordering or scheduling a POST", () => {
      const servers = [srv("a"), srv("b"), srv("c")];
      const { result } = renderHook(() => useServerReorder(servers));

      act(() => result.current.getTileProps("a").onDragStart!(makeDragEvent()));

      // A dragOver on "a" ITSELF (the common terminal hover state once the
      // dragged tile is spliced under the cursor). Even though there is nothing
      // to reorder, the drop MUST be accepted so HTML5 DnD does not play the
      // native cancelled-drag snap-back animation to the origin.
      const over = makeDragEvent({ types: [MIME] });
      act(() => result.current.getTileProps("a").onDragOver!(over));

      expect(over.preventDefault).toHaveBeenCalled();
      expect(over.dataTransfer.dropEffect).toBe("move");
      // No reorder math ran: order is unchanged and no debounced POST was scheduled.
      expect(result.current.orderedServers.map((s) => s.name)).toEqual(["a", "b", "c"]);
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(setServerOrderMock).not.toHaveBeenCalled();
    });

    it("does not reschedule an already-pending debounce when the dragged tile re-enters itself", () => {
      const servers = [srv("a"), srv("b")];
      const { result } = renderHook(() => useServerReorder(servers));

      act(() => result.current.getTileProps("a").onDragStart!(makeDragEvent()));
      // Sweep "a" over "b" → schedules a debounced POST of [b, a] due at +250ms.
      act(() =>
        result.current.getTileProps("b").onDragOver!(makeDragEvent({ types: [MIME] })),
      );

      // Advance PARTWAY (200ms) toward the original 250ms deadline, then re-enter
      // the dragged tile itself. This is the case that distinguishes no-reschedule
      // from reschedule: if the self-target dragOver cleared and re-armed the timer,
      // the deadline would slip to 200+250=450ms and the assertions below would
      // catch it. Advancing straight to 250ms would NOT — a rescheduled timer still
      // coalesces into exactly one POST, just later.
      act(() => {
        vi.advanceTimersByTime(200);
      });
      // Re-enter the dragged tile itself: accepted, but MUST NOT touch the timer
      // or the override — the previously scheduled order stands.
      act(() => result.current.getTileProps("a").onDragOver!(makeDragEvent({ types: [MIME] })));
      expect(result.current.orderedServers.map((s) => s.name)).toEqual(["b", "a"]);

      // Advance the REMAINING 50ms to the original 250ms deadline. The POST must
      // fire here — proving the self-target dragOver did not push the deadline out.
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(setServerOrderMock).toHaveBeenCalledTimes(1);
      expect(setServerOrderMock).toHaveBeenCalledWith(["b", "a"]);
    });

    it("flushes the pending debounced POST on a drop over the SOURCE tile", () => {
      const servers = [srv("a"), srv("b"), srv("c")];
      const { result } = renderHook(() => useServerReorder(servers));

      act(() => result.current.getTileProps("a").onDragStart!(makeDragEvent()));
      // Sweep "a" over "c" → override [b, c, a], debounced POST pending.
      act(() =>
        result.current.getTileProps("c").onDragOver!(makeDragEvent({ types: [MIME] })),
      );
      // Release over the SOURCE tile "a" — the common real-world release point
      // now that self-target drops are accepted. The drop flushes immediately.
      act(() =>
        result.current.getTileProps("a").onDrop!(makeDragEvent({ types: [MIME] })),
      );
      expect(setServerOrderMock).toHaveBeenCalledTimes(1);
      expect(setServerOrderMock).toHaveBeenCalledWith(["b", "c", "a"]);

      // Advancing the timer must NOT fire a second POST — the drop cleared it.
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(setServerOrderMock).toHaveBeenCalledTimes(1);
    });
  });
});
