import { useState, useCallback, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { createServer } from "@/api/client";
import { Dialog } from "@/components/dialog";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useToast } from "@/components/toast";
import { useHostMetrics, useSessionContext } from "@/contexts/session-context";
import { HostMetrics } from "@/components/host-metrics";

export function ServerListPage() {
  // Read the server list from SessionContext — the SAME source the AppShell
  // route guard (`resolveServerView`) reads. Keeping a separate local
  // `listServers()` fetch here was the root of this change's bug class: the
  // page showed one list while the guard checked another, so a just-created
  // server the guard hadn't seen yet flashed "Server not found".
  const {
    servers,
    serversLoaded,
    refreshServers,
    markServerPending,
  } = useSessionContext();
  // Local optimistic pulsing tiles for a create in flight. Self-contained and
  // unrelated to the guard (the OptimisticContext server-level ghosts are
  // rendered nowhere), so this stays local.
  const [ghostServers, setGhostServers] = useState<string[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState("");
  const navigate = useNavigate();
  const { addToast } = useToast();
  const hostMetrics = useHostMetrics();
  const ghostNameRef = useRef<string | null>(null);

  // Reconcile ghost tiles against SessionContext's list: drop any ghost whose
  // real server has appeared. Computed at render time (no effect/local fetch).
  const realNames = new Set(servers.map((s) => s.name));
  const visibleGhosts = ghostServers.filter((g) => !realNames.has(g));

  const { execute: executeCreateServer } = useOptimisticAction<[string]>({
    action: (name) => createServer(name),
    onOptimistic: (name) => {
      ghostNameRef.current = name;
      setGhostServers((prev) => [...prev, name]);
    },
    onRollback: () => {
      if (ghostNameRef.current) {
        const ghostName = ghostNameRef.current;
        setGhostServers((prev) => prev.filter((g) => g !== ghostName));
        ghostNameRef.current = null;
      }
    },
    onError: (err) => {
      addToast(err.message || "Failed to create server");
    },
    onSettled: () => {
      ghostNameRef.current = null;
    },
    // Refresh SessionContext's server list once the create resolves so the new
    // server appears and the route guard swaps the waiting state → the view.
    // `onAlwaysSettled` runs even though the create dialog has unmounted on
    // navigation — it only touches root-level SessionContext, which stays
    // mounted. Mirrors AppShell.handleCreateServer.
    onAlwaysSettled: () => {
      refreshServers();
    },
    // A failed create must not strand the UI on the waiting state — clear the
    // pending marker (empty string clears to null) on the rollback path (also
    // unmount-safe, root-context only). Mirrors AppShell.handleCreateServer.
    onAlwaysRollback: () => {
      markServerPending("");
    },
  });

  const handleCreate = useCallback(() => {
    const trimmed = createName.trim();
    if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) return;
    executeCreateServer(trimmed);
    // Mark the just-created server pending BEFORE navigating so the route guard
    // shows the "Creating server…" waiting state (not "Server not found") until
    // the refreshed list includes it. Cleared automatically by SessionContext
    // once it appears. Mirrors AppShell.handleCreateServer.
    markServerPending(trimmed);
    navigate({
      to: "/$server",
      params: { server: trimmed },
    });
    setShowCreateDialog(false);
    setCreateName("");
  }, [createName, navigate, executeCreateServer, markServerPending]);

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      {/* Minimal header */}
      <header className="shrink-0 px-4 sm:px-6 pt-6 pb-2 flex items-center gap-3">
        <img src="/icon.svg" alt="Run Kit" width={24} height={24} />
        <span className="text-sm text-text-secondary">Run Kit</span>
      </header>

      {/* Server list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pb-6">
        {/* HOST HEALTH zone (Cockpit host-console home). Renders host-global
            metrics from the server-independent `useHostMetrics()` stream, above
            the tmux-server tiles. `/` is the only surface that is about the BOX,
            not a session, so host health belongs here. */}
        <section aria-label="Host health" className="mb-6 max-w-md">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-xs uppercase tracking-wide text-text-secondary">
              Host Health
            </h2>
            {hostMetrics && (
              <span className="text-xs text-text-primary font-mono truncate">
                {hostMetrics.hostname}
              </span>
            )}
          </div>
          {hostMetrics ? (
            <HostMetrics metrics={hostMetrics} />
          ) : (
            <div className="text-xs text-text-secondary">No metrics</div>
          )}
        </section>

        <div className="text-sm text-text-secondary mb-4">
          {!serversLoaded
            ? "Loading servers..."
            : `${servers.length} server${servers.length !== 1 ? "s" : ""}`}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {servers.map(({ name, sessionCount }) => (
            <button
              key={name}
              onClick={() =>
                navigate({ to: "/$server", params: { server: name } })
              }
              className="bg-bg-card border border-border rounded p-4 text-left hover:border-text-secondary transition-colors min-h-[60px]"
            >
              <div className="text-text-primary font-medium text-sm">
                {name}
              </div>
              <div className="text-text-secondary text-xs mt-1">
                {sessionCount} sess
              </div>
            </button>
          ))}

          {/* Ghost server cards */}
          {visibleGhosts.map((name) => (
            <div
              key={`ghost-${name}`}
              className="bg-bg-card border border-border rounded p-4 text-left min-h-[60px] opacity-50 animate-pulse"
            >
              <div className="text-text-primary font-medium text-sm">
                {name}
              </div>
            </div>
          ))}

          {/* New Server button */}
          <button
            onClick={() => setShowCreateDialog(true)}
            className="border border-dashed border-border rounded p-4 text-sm text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors min-h-[60px] flex items-center justify-center"
          >
            + New Server
          </button>
        </div>
      </div>

      {showCreateDialog && (
        <Dialog
          title="Create tmux server"
          onClose={() => {
            setShowCreateDialog(false);
            setCreateName("");
          }}
        >
          <input
            autoFocus
            type="text"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            onFocus={(e) => e.target.select()}
            aria-label="Server name"
            placeholder="Server name..."
            className="w-full bg-transparent text-text-primary p-2 border border-border rounded outline-none placeholder:text-text-secondary"
          />
          <p className="text-xs text-text-secondary mt-1.5">
            Alphanumeric, hyphens, and underscores only.
          </p>
          <button
            onClick={handleCreate}
            disabled={
              !createName.trim() ||
              !/^[a-zA-Z0-9_-]+$/.test(createName.trim())
            }
            className="mt-2.5 w-full py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary disabled:opacity-50"
          >
            Create
          </button>
        </Dialog>
      )}
    </div>
  );
}
