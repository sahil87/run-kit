import { useCallback, useEffect, useReducer, useRef } from "react";
import { setBoardOrder, type BoardSummary } from "@/api/boards";

/** Debounce for the reorder POST, mirroring useServerReorder's
 *  SERVER_ORDER_DEBOUNCE_MS (250ms) — coalesces a rapid drag-over sweep into
 *  one write. */
const BOARD_ORDER_DEBOUNCE_MS = 250;
/** Custom MIME so a board-list-reorder drag never collides with the
 *  server-reorder (`application/x-server-reorder`), session-reorder
 *  (`application/x-session-reorder`), or board-pane window-move payloads. */
const BOARD_LIST_REORDER_MIME = "application/x-board-list-reorder";

function namesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export type BoardTileDragProps = {
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
};

export type UseBoardListReorder = {
  /** The effective display order of boards — the transient drag override when a
   *  drag is in progress, else the authoritative `boards` prop. Consumers render
   *  THIS instead of `boards` so reordering is instant/optimistic. */
  orderedBoards: BoardSummary[];
  /** Drag props for a given board tile. Every board is draggable and a valid
   *  drop target (no infra-exclusion analog, unlike useServerReorder). */
  getTileProps: (name: string) => BoardTileDragProps;
  /** True while a drag is active (for optional drag-affordance styling). */
  isDragging: boolean;
  /** The name of the board currently being dragged, or null when no drag is
   *  active. Consumers dim this tile (`opacity-50`) as drag-source feedback,
   *  matching the server-tile-reorder treatment. */
  draggingName: string | null;
};

/** Shared HTML5 drag-reorder for the two board-list surfaces (sidebar
 *  BoardsSection + Host BOARDS zone). Mirrors useServerReorder structurally:
 *  a custom MIME, insert-before semantics, and the derive-over-store optimistic
 *  override (a ref, not state) cleared by a render-time name-equality reconcile
 *  against the authoritative order — no whole-array watcher effect, no snap-back
 *  on drag-end. The override outlives the debounced POST until the SSE echo
 *  (`board-order`) re-fetches `boards` to match, which clears it.
 *
 *  Unlike servers there is NO infra-exclusion: every board is draggable and a
 *  valid drop target.
 *
 *  `boards` must be the already-effective-sorted list (the backend-sorted
 *  `GET /api/boards` response, via useBoards). */
export function useBoardListReorder(
  boards: BoardSummary[],
  onError?: (message: string) => void,
): UseBoardListReorder {
  // Transient drag override: the full display order of board names. A ref (not
  // state) so writing it does not itself re-render; a minimal forceRender nudge
  // drives the optimistic repaint, matching useServerReorder.
  const overrideRef = useRef<string[] | null>(null);
  const dragNameRef = useRef<string | null>(null);
  const putTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  // Clear a pending debounced POST on unmount so a drag that ends right before
  // the list unmounts never fires a stray post-unmount write.
  useEffect(() => {
    return () => {
      if (putTimerRef.current) clearTimeout(putTimerRef.current);
    };
  }, []);

  const names = boards.map((b) => b.name);

  // Render-time reconcile: once the authoritative order element-wise equals the
  // stored override, the round-trip has landed — drop the override so we read
  // the authoritative order. Mutating the ref during render is safe (it is not
  // state) and the displayed output is unchanged, so no nudge.
  let effective = overrideRef.current;
  if (effective && namesEqual(effective, names)) {
    overrideRef.current = null;
    effective = null;
  }

  // Build the ordered display list. When an override is active, reorder the
  // BoardSummaries by the override names (dropping any name no longer present),
  // then append any board missing from the override (e.g. created mid-drag) in
  // its authoritative relative order.
  let orderedBoards: BoardSummary[];
  if (effective) {
    const byName = new Map(boards.map((b) => [b.name, b]));
    const ordered: BoardSummary[] = [];
    for (const name of effective) {
      const b = byName.get(name);
      if (b) ordered.push(b);
    }
    for (const b of boards) {
      if (!effective.includes(b.name)) ordered.push(b);
    }
    orderedBoards = ordered;
  } else {
    orderedBoards = boards;
  }

  const onDragStart = useCallback((e: React.DragEvent, name: string) => {
    dragNameRef.current = name;
    e.dataTransfer.setData(BOARD_LIST_REORDER_MIME, name);
    e.dataTransfer.effectAllowed = "move";
    // Seed the override with the current order so subsequent dragOver splices
    // operate on a stable base.
    overrideRef.current = boards.map((b) => b.name);
    forceRender();
  }, [boards]);

  const onDragOver = useCallback((e: React.DragEvent, targetName: string) => {
    const dragName = dragNameRef.current;
    if (!dragName) return; // drag from another hook instance — not ours
    if (!e.dataTransfer.types.includes(BOARD_LIST_REORDER_MIME)) return;
    // Accept the drop BEFORE the self-target check: HTML5 DnD only registers a
    // release as accepted when the last dragover was preventDefault()ed. Because
    // insert-before splicing lands the dragged tile under the cursor, the final
    // dragover fires on the dragged tile's OWN element — bailing early there
    // would leave the drop uncancelled and play the native cancelled-drag
    // snap-back animation (and starve the onDrop flush path). Proven on the
    // server hook.
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragName === targetName) return; // …then bail: nothing to reorder

    const base = overrideRef.current ?? boards.map((b) => b.name);
    const fromIdx = base.indexOf(dragName);
    const toIdx = base.indexOf(targetName);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const next = [...base];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragName); // insert-before semantics

    if (putTimerRef.current) clearTimeout(putTimerRef.current);
    const orderToPut = next.slice();
    putTimerRef.current = setTimeout(() => {
      putTimerRef.current = null;
      setBoardOrder(orderToPut).catch((err: Error) => {
        onError?.(err.message || "Failed to save board order");
      });
    }, BOARD_ORDER_DEBOUNCE_MS);

    overrideRef.current = next;
    forceRender();
  }, [boards, onError]);

  const onDragEnd = useCallback(() => {
    // No snap-back: the override outlives the debounced POST until the SSE echo
    // (board-order → useBoards re-fetch) re-sorts `boards` to match, which clears
    // it via the render-time reconcile above. Just drop the active-drag marker.
    dragNameRef.current = null;
    forceRender();
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(BOARD_LIST_REORDER_MIME)) return;
    e.preventDefault();
    // The dragOver handler already computed + scheduled the order; the drop just
    // finalizes. Flush any pending debounced POST immediately so the write is
    // not lost if the SSE echo races the timer.
    if (putTimerRef.current && overrideRef.current) {
      clearTimeout(putTimerRef.current);
      putTimerRef.current = null;
      const orderToPut = overrideRef.current.slice();
      setBoardOrder(orderToPut).catch((err: Error) => {
        onError?.(err.message || "Failed to save board order");
      });
    }
    dragNameRef.current = null;
  }, [onError]);

  const getTileProps = useCallback((name: string): BoardTileDragProps => {
    return {
      draggable: true,
      onDragStart: (e) => onDragStart(e, name),
      onDragOver: (e) => onDragOver(e, name),
      onDragEnd,
      onDrop,
    };
  }, [onDragStart, onDragOver, onDragEnd, onDrop]);

  return {
    orderedBoards,
    getTileProps,
    isDragging: dragNameRef.current !== null,
    draggingName: dragNameRef.current,
  };
}
