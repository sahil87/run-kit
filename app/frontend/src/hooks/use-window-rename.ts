import { useRef } from "react";
import { renameWindow } from "@/api/client";
import { useToast } from "@/components/toast";
import { useWindowStore } from "@/store/window-store";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";

/**
 * Shared optimistic window-rename action, used by BOTH the sidebar inline
 * rename (`sidebar/index.tsx`) and the centered top-bar `WindowHeading`
 * (change 260703-5ilm). Both surfaces rename the same tmux windows and MUST
 * behave identically — optimistic store rename, rollback + toast on failure,
 * `clearRename` on settle — so the pattern lives here once instead of being
 * duplicated per call site.
 *
 * The optimistic path stamps the store's `pendingName`; a failure rolls it back
 * and surfaces a toast; success/settle clears the pending marker so the SSE
 * snapshot becomes authoritative again. The captured `(server, session,
 * windowId)` is held in a ref so rollback/settle target the right entry even if
 * the caller re-renders with different props between execute and resolution.
 *
 * @returns `execute(server, session, windowId, newName)` — fire-and-forget; the
 *   store update is synchronous, the API call optimistic. Callers own their own
 *   trim/empty-name guards before calling (renaming is unconditional here).
 */
export function useWindowRename(): {
  execute: (server: string, session: string, windowId: string, newName: string) => void;
} {
  const { addToast } = useToast();
  const renameWindowStore = useWindowStore((s) => s.renameWindow);
  const clearRename = useWindowStore((s) => s.clearRename);

  const lastRenameRef = useRef<{ server: string; session: string; windowId: string } | null>(null);

  const { execute } = useOptimisticAction<[string, string, string, string]>({
    action: (srv, _session, windowId, newName) => renameWindow(srv, windowId, newName),
    onOptimistic: (srv, session, windowId, newName) => {
      lastRenameRef.current = { server: srv, session, windowId };
      renameWindowStore(srv, session, windowId, newName);
    },
    onRollback: () => {
      const last = lastRenameRef.current;
      if (last) clearRename(last.server, last.session, last.windowId);
    },
    onError: (err) => {
      addToast(err.message || "Failed to rename window");
    },
    onSettled: () => {
      const last = lastRenameRef.current;
      if (last) clearRename(last.server, last.session, last.windowId);
      lastRenameRef.current = null;
    },
  });

  return { execute };
}
