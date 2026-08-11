import { useCallback, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { createServer, killServer as killServerApi, DAEMON_SERVER } from "@/api/client";
import { Dialog } from "@/components/dialog";
import { useServerDialogs } from "@/contexts/server-dialogs-context";
import { useSessionContext } from "@/contexts/session-context";
import { useOptimisticContext } from "@/contexts/optimistic-context";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useToast } from "@/components/toast";
import { finalizeSafeName, toSafeServerName } from "@/lib/names";

/**
 * The single create-server + kill-server dialog implementation (260811-239r),
 * lifted verbatim from AppShell and mounted ONCE in `AppLayout` — the board
 * route does not render AppShell (DD-8), so both dialogs were twinned between
 * `app.tsx` and `board-page.tsx` and had drifted (the board copy lacked the
 * `DAEMON_SERVER` warning and the input sanitization). Open-state and the
 * close triggers come from `server-dialogs-context`; this component owns the
 * create-input local state and the submit/kill handlers.
 *
 * Unified behavior is AppShell's former superset on ALL routes: the create
 * input applies `toSafeServerName` on change and `finalizeSafeName` on submit,
 * and the kill confirm renders the `DAEMON_SERVER` warning everywhere. After a
 * confirmed kill the app navigates to `/` only when the killed server is
 * `SessionContext`'s `currentServer` — `null` on board routes, so a board kill
 * never navigates away (matching the board's previous behavior exactly).
 */
export function ServerDialogs() {
  const {
    createServerOpen,
    killServerTarget,
    closeCreateServer,
    clearKillServerTarget,
  } = useServerDialogs();
  const ctx = useSessionContext();
  const currentServer = ctx.currentServer;
  const refreshServers = ctx.refreshServers;
  const markServerPending = ctx.markServerPending;
  const { removeGhost, addGhostServer, markKilled, unmarkKilled } = useOptimisticContext();
  const { addToast } = useToast();
  const navigate = useNavigate();

  const [createServerName, setCreateServerName] = useState("");
  const ghostServerIdRef = useRef<string | null>(null);
  const killedServerNameRef = useRef<string | null>(null);

  const { execute: executeCreateServer } = useOptimisticAction<[string]>({
    action: (name) => createServer(name),
    onOptimistic: (name) => {
      ghostServerIdRef.current = addGhostServer(name);
    },
    onRollback: () => {
      if (ghostServerIdRef.current) {
        removeGhost(ghostServerIdRef.current);
        ghostServerIdRef.current = null;
      }
    },
    onError: (err) => {
      addToast(err.message || "Failed to create server");
    },
    onSettled: () => {
      ghostServerIdRef.current = null;
    },
    // Refresh the (otherwise one-time-fetched) server list once the create
    // resolves so the new server appears and the waiting state swaps to the
    // view. `onAlwaysSettled` runs even though the create dialog has already
    // closed on navigation — this component (which owns the hook) is mounted
    // at the AppLayout level and never unmounts on navigation, and
    // `refreshServers` only touches root-level SessionContext.
    onAlwaysSettled: () => {
      refreshServers();
    },
    // A failed create must not strand the UI on the waiting state — clear the
    // pending marker (empty string clears to null) on the rollback path (also
    // unmount-safe, root-context only).
    onAlwaysRollback: () => {
      markServerPending("");
    },
  });

  const handleCreateServer = useCallback(() => {
    const trimmed = finalizeSafeName(createServerName.trim());
    if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) return;
    executeCreateServer(trimmed);
    // Mark the just-created server pending so the route guard shows the brief
    // waiting state (not "Server not found") until the refreshed list includes
    // it. Cleared automatically by SessionContext once it appears.
    markServerPending(trimmed);
    navigate({ to: "/$server", params: { server: trimmed } });
    closeCreateServer();
    setCreateServerName("");
  }, [createServerName, navigate, executeCreateServer, markServerPending, closeCreateServer]);

  const { execute: executeKillServer } = useOptimisticAction<[string]>({
    action: (name) => killServerApi(name),
    onOptimistic: (name) => {
      killedServerNameRef.current = name;
      markKilled("server", name);
    },
    onRollback: () => {
      if (killedServerNameRef.current) {
        unmarkKilled("server", killedServerNameRef.current);
        killedServerNameRef.current = null;
      }
    },
    onError: (err) => {
      addToast(err.message || "Failed to kill server");
    },
    onSettled: () => {
      killedServerNameRef.current = null;
    },
  });

  const handleKillServer = useCallback(() => {
    if (!killServerTarget) return;
    const target = killServerTarget;
    executeKillServer(target);
    // Route away only when killing the currently-active server; killing another
    // server in the panel should leave the user where they are. `currentServer`
    // (SessionContext's deepest-first route-param walk) is null on board
    // routes, so a board-route kill never navigates away.
    if (target === currentServer) navigate({ to: "/" });
    clearKillServerTarget();
  }, [killServerTarget, currentServer, navigate, executeKillServer, clearKillServerTarget]);

  return (
    <>
      {createServerOpen && (
        <Dialog title="Create tmux server" onClose={() => { closeCreateServer(); setCreateServerName(""); }}>
          <input
            autoFocus
            type="text"
            value={createServerName}
            onChange={(e) => setCreateServerName(toSafeServerName(e.target.value))}
            onKeyDown={(e) => e.key === "Enter" && handleCreateServer()}
            onFocus={(e) => e.target.select()}
            aria-label="Server name"
            placeholder="Server name..."
            className="w-full bg-transparent text-text-primary p-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          <p className="text-xs text-text-secondary mt-1.5">
            Alphanumeric, hyphens, and underscores only.
          </p>
          <button
            onClick={handleCreateServer}
            disabled={!createServerName.trim() || !/^[a-zA-Z0-9_-]+$/.test(createServerName.trim())}
            className="mt-2.5 w-full py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary disabled:opacity-50"
          >
            Create
          </button>
        </Dialog>
      )}

      {killServerTarget && (
        <Dialog title="Kill tmux server?" onClose={clearKillServerTarget}>
          <p className="text-text-secondary mb-2.5">
            Kill server <strong>{killServerTarget}</strong> and all its sessions? This cannot be undone.
          </p>
          {killServerTarget === DAEMON_SERVER && (
            <p className="text-signal-red mb-2.5">
              <strong>{DAEMON_SERVER}</strong> hosts the run-kit daemon serving this dashboard — killing it takes the dashboard down.
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={clearKillServerTarget}
              className="flex-1 py-1.5 border border-border rounded hover:border-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleKillServer}
              className="flex-1 py-1.5 bg-red-900/30 border border-red-900 rounded hover:bg-red-900/50"
            >
              Kill
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
