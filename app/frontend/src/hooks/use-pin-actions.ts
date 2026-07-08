import { useCallback } from "react";
import { pinWindow, unpinWindow, reorderPin } from "@/api/boards";
import { useToast } from "@/components/toast";

interface PinActions {
  pin: (server: string, windowId: string, board: string) => Promise<void>;
  unpin: (server: string, windowId: string, board: string) => Promise<void>;
  reorder: (
    server: string,
    windowId: string,
    board: string,
    before: string | null,
    after: string | null,
  ) => Promise<void>;
}

/**
 * usePinActions wraps the boards API mutations with toast-based error
 * surfacing. Returns stable handlers that the SSE re-broadcast will
 * eventually reconcile (last-write-wins per spec).
 */
export function usePinActions(): PinActions {
  const { addToast } = useToast();

  const pin = useCallback(
    async (server: string, windowId: string, board: string) => {
      try {
        await pinWindow(server, windowId, board);
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Failed to pin window");
      }
    },
    [addToast],
  );

  const unpin = useCallback(
    async (server: string, windowId: string, board: string) => {
      try {
        await unpinWindow(server, windowId, board);
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Failed to unpin window");
      }
    },
    [addToast],
  );

  const reorder = useCallback(
    async (
      server: string,
      windowId: string,
      board: string,
      before: string | null,
      after: string | null,
    ) => {
      try {
        await reorderPin(server, windowId, board, before, after);
      } catch (err) {
        // Surface the toast, then RETHROW so the caller can observe the
        // rejection and roll back its optimistic state. reorder is the one pin
        // action with an optimistic preview (the board drag override / the
        // palette focus move); pin/unpin have no client-side optimistic order
        // to revert, so they still swallow. The board reorder hook attaches a
        // `.catch()` to clear the override; the palette move `.catch()`es to
        // avoid an unhandled rejection. Reworked in cycle 1 (was: swallowed,
        // leaving the failed order rendered indefinitely).
        addToast(err instanceof Error ? err.message : "Failed to reorder pin");
        throw err;
      }
    },
    [addToast],
  );

  return { pin, unpin, reorder };
}
