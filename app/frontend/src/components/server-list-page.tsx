import { useState, useCallback, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { createServer, createSession, createWindow, getSessions } from "@/api/client";
import { Dialog } from "@/components/dialog";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useToast } from "@/components/toast";
import { useHostMetrics, useHostServices, useSessionContext } from "@/contexts/session-context";
import { HostMetrics } from "@/components/host-metrics";

// Well-known non-HTTP listening ports. A listening TCP port carries no protocol
// label (we read it from /proc/net/tcp), so we can't KNOW a port speaks HTTP
// without probing it — and probing every local port on each tick is more than
// this view warrants. Instead we gate the "Open in window" click for the common
// database/broker/cache ports where a proxied iframe would only ever show a
// broken frame. The tile still renders (a listening port is worth surfacing for
// awareness); only the click is disabled. This is a heuristic, not truth: an
// HTTP server on an unusual port stays clickable, and a service on a nonstandard
// port slips through — both low-harm, since the gate only affects the click.
const NON_HTTP_PORTS = new Set<number>([
  5432, // PostgreSQL
  3306, // MySQL / MariaDB
  6379, // Redis
  27017, // MongoDB
  5672, // AMQP (RabbitMQ)
  11211, // Memcached
  9092, // Kafka
  2379, // etcd
  25, // SMTP
  22, // SSH
]);

function isLikelyHttpPort(port: number): boolean {
  return !NON_HTTP_PORTS.has(port);
}

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
    sessionsByServer,
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
  const hostServices = useHostServices();
  const ghostNameRef = useRef<string | null>(null);
  // Guards against a double-click firing two create flows for the same port.
  const openingRef = useRef(false);

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
    // No `onError` toast here (unlike AppShell.handleCreateServer, whose hook
    // stays mounted): this page unmounts on navigate, so the mount-guarded
    // `onError` would be skipped on the common post-navigate failure path AND
    // would double-toast on the rare still-mounted failure. The failure toast
    // lives solely in the unmount-safe `onAlwaysRollback` below.
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
    // Also surface the failure here: `handleCreate` navigates away from `/`
    // synchronously, so this page unmounts before the create resolves and the
    // mount-guarded `onError` toast is skipped — the user would otherwise land
    // on "Server not found" with no explanation. `addToast` reaches the
    // root-level ToastProvider, which stays mounted across the navigation.
    onAlwaysRollback: () => {
      markServerPending("");
      addToast("Failed to create server");
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

  // "Open in window" — open a listening service's UI in an @rk_type=iframe tmux
  // window via the existing /proxy/{port}/ reverse proxy. `/` is server-less, so
  // resolve a target (server, session): the first-listed server, reusing its
  // first known session or creating an instant one, then create the iframe
  // window there and navigate to the server (the window surfaces via SSE).
  // Disabled when no servers exist (see the tile's disabled state).
  const handleOpenInWindow = useCallback(
    async (port: number) => {
      if (openingRef.current) return;
      // Non-HTTP ports have their button disabled, so this guard is belt-and-
      // suspenders — it keeps the invariant if the tile is ever wired to another
      // trigger (keyboard, programmatic) that bypasses the disabled state.
      if (!isLikelyHttpPort(port)) return;
      const target = servers[0];
      if (!target) return; // action is disabled in this state; defensive guard
      openingRef.current = true;
      try {
        const server = target.name;
        // Prefer the SSE-cached sessions, but on a fresh `/` load the per-server
        // stream is usually not attached yet, so `sessionsByServer` can be empty
        // even when the server HAS sessions. Fall back to an authoritative fetch
        // before creating anything — otherwise we'd try to create a "services"
        // session that may already exist, and tmux new-session 500s on a
        // duplicate name.
        let session = (sessionsByServer.get(server) ?? [])[0]?.name;
        if (!session) {
          const fetched = await getSessions(server).catch(() => []);
          session = fetched[0]?.name;
        }
        if (!session) {
          // The server genuinely has no session — create an instant one to host
          // the iframe window (reuses the createSession machinery the app uses).
          session = "services";
          await createSession(server, session);
        }
        await createWindow(
          server,
          session,
          // Window name, NOT a display label: tmux rejects colons and periods
          // (validate.ValidateName), so `:${port}` fails — use `port-${port}`.
          `port-${port}`,
          undefined,
          "iframe",
          `/proxy/${port}/`,
        );
        navigate({ to: "/$server", params: { server } });
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : "Failed to open service in window",
        );
      } finally {
        openingRef.current = false;
      }
    },
    [servers, sessionsByServer, navigate, addToast],
  );

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

        {/* SERVICES zone (Cockpit host-console home). A listening TCP port is a
            HOST property (not owned by any tmux window/session), so `/` — the
            box-level console — is its home. Each tile opens that port's UI in an
            @rk_type=iframe tmux window via the existing /proxy/{port}/ proxy. */}
        <section aria-label="Services" className="mb-6 max-w-md">
          <h2 className="text-xs uppercase tracking-wide text-text-secondary mb-2">
            Services
          </h2>
          {hostServices.length === 0 ? (
            <div className="text-xs text-text-secondary">No services</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {hostServices.map((svc) => (
                <div
                  key={svc.port}
                  className="flex items-center justify-between gap-3 bg-bg-card border border-border rounded px-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="text-text-primary font-mono text-sm">
                      :{svc.port}
                    </span>
                    {svc.process && (
                      <span className="text-text-secondary text-xs ml-2 truncate">
                        {svc.process}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleOpenInWindow(svc.port)}
                    disabled={servers.length === 0 || !isLikelyHttpPort(svc.port)}
                    title={
                      servers.length === 0
                        ? "Create a server first"
                        : !isLikelyHttpPort(svc.port)
                          ? "Not a web service"
                          : undefined
                    }
                    className="shrink-0 text-xs px-2 py-1 border border-border rounded text-text-secondary hover:text-text-primary hover:border-text-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-text-secondary disabled:hover:border-border"
                  >
                    Open in window
                  </button>
                </div>
              ))}
            </div>
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
