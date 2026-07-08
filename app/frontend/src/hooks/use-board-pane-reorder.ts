import { useCallback, useReducer, useRef } from "react";
import type { BoardEntry } from "@/api/boards";

/** Custom MIME so a board-pane-reorder drag never collides with the
 *  server-reorder (`application/x-server-reorder`), session-reorder
 *  (`application/x-session-reorder`), or window-move (default JSON) payloads. */
const BOARD_PANE_REORDER_MIME = "application/x-board-pane-reorder";

/** A board spans servers, so a pane's identity is (server, windowId) — the same
 *  composite key `DesktopRow` uses for its React `key`. `windowId` alone is
 *  ambiguous across servers. */
function paneKey(server: string, windowId: string): string {
  return `${server}:${windowId}`;
}

function keysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Drag-SOURCE props for the pane HEADER (the drag handle). Only the header is
 *  draggable — a live xterm terminal must not hijack the drag or become the
 *  drag image. */
export type BoardPaneDragProps = {
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
};

/** Drop-TARGET props for the whole pane ROOT. `onDragOver`/`onDrop` live on the
 *  pane root (not the ~24px header strip) so the optimistic preview updates and
 *  a release commits anywhere over a pane, not only over the header — a
 *  header-strip-only target made cancelled drags the common outcome (rework
 *  should-fix #1). The source stays header-only; the target is the pane body. */
export type BoardPaneDropProps = {
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
};

export type UseBoardPaneReorder = {
  /** The effective display order of entries — the transient drag override while
   *  a drag is in progress, else the authoritative `entries` prop. Consumers
   *  render THIS so reordering is instant/optimistic. */
  orderedEntries: BoardEntry[];
  /** Drag-source props for a given pane's HEADER (the drag handle) plus the
   *  drop-target props for its ROOT, returned separately so the consumer can
   *  attach `draggable`/`onDragStart`/`onDragEnd` to the header and
   *  `onDragOver`/`onDrop` to the whole pane. */
  getHandleProps: (
    server: string,
    windowId: string,
  ) => { handle: BoardPaneDragProps; drop: BoardPaneDropProps };
  /** True while a drag is active (for optional drag-affordance styling). */
  isDragging: boolean;
  /** The `server:windowId` key of the pane currently being dragged, or null.
   *  Consumers dim this pane (`opacity-50`) as drag-source feedback, matching
   *  the server/session reorder treatment. */
  draggingKey: string | null;
};

/**
 * HTML5 drag-reorder for the desktop board row. Adapts the `useServerReorder`
 * pattern (custom MIME, insert-before splice, derive-over-store optimistic
 * override in a ref, render-time equality reconcile — no whole-array watcher
 * effect, no drag-end snap-back) to board panes, with two board-specific
 * differences:
 *
 *   1. Identity is the composite `server:windowId` key (a board spans servers),
 *      not a bare name.
 *   2. NO debounce. Fractional indexing means one authoritative `reorder` POST
 *      per completed move (before/after neighbours), so the drop is the single
 *      commit point — unlike server-reorder's debounced full-order writes.
 *
 * `reorder` is the toast-wrapped `usePinActions().reorder` (server, windowId,
 * board, before, after). `entries` must be the authoritative board order (from
 * `useBoardEntries`, sorted by orderKey server-side).
 */
export function useBoardPaneReorder(
  entries: BoardEntry[],
  board: string,
  reorder: (
    server: string,
    windowId: string,
    board: string,
    before: string | null,
    after: string | null,
  ) => Promise<void>,
): UseBoardPaneReorder {
  // Transient drag override: the full display order of pane keys. A ref (not
  // state) so writing it does not itself re-render; a forceRender nudge drives
  // the optimistic repaint, matching useServerReorder.
  const overrideRef = useRef<string[] | null>(null);
  const dragKeyRef = useRef<string | null>(null);
  // Whether the in-flight drag committed a drop (onDrop fired a reorder POST).
  // A drag that ends WITHOUT committing — Escape, or release outside any valid
  // drop target — must revert the optimistic preview (there is no POST, so no
  // board-changed SSE echo will ever reconcile the override away). Reset at
  // dragStart; set true when onDrop fires the POST; read at dragEnd.
  const committedRef = useRef(false);
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  const authoritativeKeys = entries.map((e) => paneKey(e.server, e.windowId));

  // Render-time reconcile: once the authoritative order element-wise equals the
  // stored override, the round-trip (board-changed SSE echo → useBoardEntries
  // refetch) has landed — drop the override so we read the authoritative order.
  // Mutating the ref during render is safe (it is not state) and the displayed
  // output is unchanged, so no nudge.
  let effectiveKeys = overrideRef.current;
  if (effectiveKeys && keysEqual(effectiveKeys, authoritativeKeys)) {
    overrideRef.current = null;
    effectiveKeys = null;
  }

  // Build the ordered display list. When an override is active, reorder the
  // entries by the override keys (dropping any key no longer present) and
  // append any entry missing from the override (e.g. pinned mid-drag) after,
  // preserving its authoritative relative order.
  let orderedEntries: BoardEntry[];
  if (effectiveKeys) {
    const byKey = new Map(entries.map((e) => [paneKey(e.server, e.windowId), e]));
    const ordered: BoardEntry[] = [];
    for (const key of effectiveKeys) {
      const e = byKey.get(key);
      if (e) ordered.push(e);
    }
    for (const e of entries) {
      if (!effectiveKeys.includes(paneKey(e.server, e.windowId))) ordered.push(e);
    }
    orderedEntries = ordered;
  } else {
    orderedEntries = entries;
  }

  const onDragStart = useCallback(
    (e: React.DragEvent, server: string, windowId: string) => {
      const key = paneKey(server, windowId);
      dragKeyRef.current = key;
      committedRef.current = false; // fresh drag: not yet committed
      e.dataTransfer.setData(BOARD_PANE_REORDER_MIME, key);
      e.dataTransfer.effectAllowed = "move";
      // Seed the override with the current order so subsequent dragOver splices
      // operate on a stable base.
      overrideRef.current = entries.map((en) => paneKey(en.server, en.windowId));
      forceRender();
    },
    [entries],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent, targetServer: string, targetWindowId: string) => {
      const dragKey = dragKeyRef.current;
      if (!dragKey) return; // drag from another hook instance — not ours
      if (!e.dataTransfer.types.includes(BOARD_PANE_REORDER_MIME)) return;
      // Accept the drop BEFORE the self-target check: HTML5 DnD only registers a
      // release as accepted when the last dragover was preventDefault()ed.
      // Insert-before splicing lands the dragged pane under the cursor, so the
      // final dragover fires on the dragged pane's OWN element — bailing early
      // there would leave the drop uncancelled and play the native
      // cancelled-drag snap-back animation to the origin.
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";

      const targetKey = paneKey(targetServer, targetWindowId);
      if (dragKey === targetKey) return; // …then bail: nothing to reorder

      const base =
        overrideRef.current ?? entries.map((en) => paneKey(en.server, en.windowId));
      const fromIdx = base.indexOf(dragKey);
      const toIdx = base.indexOf(targetKey);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
      const next = [...base];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, dragKey); // insert-before semantics

      overrideRef.current = next;
      forceRender();
    },
    [entries],
  );

  const onDragEnd = useCallback(() => {
    // Drop the active-drag marker. Then branch on whether this drag committed:
    //   - COMMITTED (onDrop fired a reorder POST): keep the override — it
    //     outlives the POST until the board-changed SSE echo re-fetches entries
    //     to match, which clears it via the render-time reconcile above. No
    //     snap-back (the no-snap-back discipline applies to committed drops).
    //   - CANCELLED (Escape, or release outside any valid drop target — no
    //     onDrop fired): revert the optimistic preview. There is no POST, so no
    //     SSE echo will ever reconcile the override; leaving it rendered a
    //     phantom order the server never had (rework must-fix #2). Native HTML5
    //     cancel semantics = revert, which the single-commit-point drop model
    //     makes safe.
    dragKeyRef.current = null;
    if (!committedRef.current) {
      overrideRef.current = null;
    }
    forceRender();
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(BOARD_PANE_REORDER_MIME)) return;
      e.preventDefault();
      const dragKey = dragKeyRef.current;
      const override = overrideRef.current;
      dragKeyRef.current = null;
      if (!dragKey || !override) return;

      // The override IS the final optimistic order — but reconcile it against
      // the current authoritative keys first. If `entries` changed mid-drag
      // (pin/unpin, remote reorder), the raw override can hold a STALE key (a
      // pane no longer on the board) and OMIT a newly-present one; deriving
      // neighbours from it would compute a `before`/`after` that mismatches
      // what the user sees, and can even POST a windowId no longer on the board
      // → 400. Rebuild the effective order the same way the render does (drop
      // absent keys, append new-present entries) so the neighbours match the
      // displayed `orderedEntries`.
      const authoritative = entries.map((en) => paneKey(en.server, en.windowId));
      const authoritativeSet = new Set(authoritative);
      const effective = override.filter((k) => authoritativeSet.has(k));
      for (const key of authoritative) {
        if (!effective.includes(key)) effective.push(key);
      }
      const fromIdx = authoritative.indexOf(dragKey);
      const landedIdx = effective.indexOf(dragKey);
      if (fromIdx === -1 || landedIdx === -1) return;
      // Derive neighbours directly from the reconciled effective order (correct
      // by construction — it reflects the drop position AND the current board
      // membership).
      const before = landedIdx > 0 ? effective[landedIdx - 1] : null;
      const after = landedIdx < effective.length - 1 ? effective[landedIdx + 1] : null;
      // No-op guard: if the pane did not actually move (neighbours unchanged
      // from its authoritative slot), skip the POST.
      const authBefore = fromIdx > 0 ? authoritative[fromIdx - 1] : null;
      const authAfter =
        fromIdx < authoritative.length - 1 ? authoritative[fromIdx + 1] : null;
      if (before === authBefore && after === authAfter) return; // no-op: no POST

      const server = stripServerPrefix(dragKey);
      const windowId = stripServer(dragKey);
      // Neighbour keys are `server:windowId`; the endpoint wants bare windowIds.
      const beforeId = before ? stripServer(before) : null;
      const afterId = after ? stripServer(after) : null;
      // The drag committed a real move: mark it so onDragEnd keeps the override
      // (the board-changed SSE echo will reconcile it away). The single reorder
      // POST fires here — no debounce; fractional indexing is one call per move.
      committedRef.current = true;
      // Roll back the optimistic override if the POST rejects (rework
      // should-fix #3): usePinActions().reorder shows its toast AND rethrows, so
      // the hook observes the rejection here and clears the override — the
      // display returns to the authoritative order instead of stranding the
      // failed order rendered indefinitely (no SSE echo arrives for a failed
      // reorder). A late-arriving authoritative match would also clear it via
      // the render-time reconcile, but that never comes on failure.
      reorder(server, windowId, board, beforeId, afterId).catch(() => {
        overrideRef.current = null;
        forceRender();
      });
    },
    [entries, board, reorder],
  );

  const getHandleProps = useCallback(
    (
      server: string,
      windowId: string,
    ): { handle: BoardPaneDragProps; drop: BoardPaneDropProps } => ({
      // Drag SOURCE — the header only (draggable + lifecycle).
      handle: {
        draggable: true,
        onDragStart: (e) => onDragStart(e, server, windowId),
        onDragEnd,
      },
      // Drop TARGET — the whole pane root. onDragOver/onDrop are per-pane so the
      // insert-before splice targets this pane and a release anywhere over it
      // commits.
      drop: {
        onDragOver: (e) => onDragOver(e, server, windowId),
        onDrop,
      },
    }),
    [onDragStart, onDragOver, onDragEnd, onDrop],
  );

  return {
    orderedEntries,
    getHandleProps,
    isDragging: dragKeyRef.current !== null,
    draggingKey: dragKeyRef.current,
  };
}

/** Extract the bare windowId from a `server:windowId` composite key. windowIds
 *  are tmux ids like `@123` (no colon); the server segment is everything before
 *  the first colon. */
function stripServer(key: string): string {
  const idx = key.indexOf(":");
  return idx === -1 ? key : key.slice(idx + 1);
}

/** Extract the server name (the segment before the first colon) from a
 *  `server:windowId` composite key. */
function stripServerPrefix(key: string): string {
  const idx = key.indexOf(":");
  return idx === -1 ? key : key.slice(0, idx);
}
