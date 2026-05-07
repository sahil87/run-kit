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
        addToast(err instanceof Error ? err.message : "Failed to reorder pin");
      }
    },
    [addToast],
  );

  return { pin, unpin, reorder };
}
