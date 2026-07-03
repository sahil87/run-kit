import { useState, useCallback, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { createServer, createSession, createWindow, getSessions } from "@/api/client";
import { Dialog } from "@/components/dialog";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useToast } from "@/components/toast";
import { useHostMetrics, useHostServices, useSessionContext } from "@/contexts/session-context";
import { HostMetrics } from "@/components/host-metrics";
import { PageHeading } from "@/components/page-heading";
import { useBoards } from "@/hooks/use-boards";
import { TopBar } from "@/components/top-bar";

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
  // Cross-server pane boards for the BOARDS zone. useBoards is self-contained
  // (plain /api/boards fetch + the shared SSE pool) and boards aggregate
  // windows across servers, so the box-level Cockpit is their natural home.
  const { boards, isLoading: boardsLoading } = useBoards();
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
      {/* Shared full-width TopBar in cockpit mode: brand root crumb + the
          route-agnostic controls (FixedWidth / Notification / Theme). No
          hamburger (the Cockpit has no sidebar) and no connection dot (no
          per-server SSE stream here). Pinned above the scrollable content —
          same `flex-col h-screen` pinning the ad-hoc header used, so it stays
          fixed while the list below scrolls. Session/server-dependent props are
          passed empty (board-mode precedent). The page identity is carried by
          the retro PageHeading rendered at the top of the scroll content. */}
      <TopBar
        mode="cockpit"
        sessions={[]}
        currentSession={null}
        currentWindow={null}
        sessionName=""
        windowName=""
        isConnected={false}
        sidebarOpen={false}
        server=""
        onNavigate={() => {}}
        onToggleSidebar={() => {}}
        onCreateSession={() => {}}
        onCreateWindow={() => {}}
      />

      {/* Server list. `pt-6` matches the `mb-6` inter-section rhythm so the
          gap below the TopBar equals the gap between sections. */}
      <div className="flex-1 min-h-0 overflow-y-auto pt-6 px-4 sm:px-6 pb-6">
        {/* Retro page heading (tmux pane-title rule) — the Cockpit's page
            identity. Lowercase per the terminal idiom. Supersedes the earlier
            no-heading decision (intake assumption #11), revised by the user
            during the visual pass. */}
        <PageHeading page="cockpit" className="mb-6" />
        {/* HOST HEALTH zone (Cockpit host-console home). Renders host-global
            metrics from the server-independent `useHostMetrics()` stream, above
            the tmux-server tiles. `/` is the only surface that is about the BOX,
            not a session, so host health belongs here. */}
        <section aria-label="Host health" className="mb-6 max-w-md">
          {/* Heading row idiom (shared with TMUX SERVERS): `gap-3` between the
              uppercase heading and its side-text; side-text is secondary mono. */}
          <div className="flex items-center gap-3 mb-2">
            <h2 className="rk-label-caret text-xs uppercase tracking-wide text-text-secondary">
              Host Health
            </h2>
            {hostMetrics && (
              <span className="text-xs text-text-secondary font-mono truncate">
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

        {/* BOARDS zone — cross-server pane boards. A board aggregates windows
            across tmux servers, so the box-level Cockpit (not any single
            Server Cabin) is its list's natural home. Sits above TMUX SERVERS
            per the page's general→specific flow. Always visible: when zero
            boards exist the body shows the same "pin to start" hint as the
            sidebar BoardsSection, instead of the section appearing/vanishing
            with the first/last board. */}
        <section aria-label="Boards" className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="rk-label-caret text-xs uppercase tracking-wide text-text-secondary">
              Boards
            </h2>
            <span className="text-xs text-text-secondary font-mono">
              {boardsLoading
                ? "loading…"
                : `${boards.length} board${boards.length !== 1 ? "s" : ""}`}
            </span>
          </div>
          {!boardsLoading && boards.length === 0 ? (
            <div className="text-xs text-text-secondary">
              Pin a window to start a board
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {boards.map((b) => (
                <button
                  key={b.name}
                  onClick={() =>
                    navigate({ to: "/board/$name", params: { name: b.name } })
                  }
                  className="bg-bg-card border border-border rounded p-4 text-left hover:border-text-secondary transition-colors min-h-[60px]"
                >
                  <div className="text-text-primary font-medium text-sm">
                    {b.name}
                  </div>
                  <div className="text-text-secondary text-xs mt-1">
                    {b.pinCount} pin{b.pinCount !== 1 ? "s" : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* TMUX SERVERS zone (zone 2) — the tmux-server tile grid. */}
        <section aria-label="Tmux servers" className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="rk-label-caret text-xs uppercase tracking-wide text-text-secondary">
              Tmux Servers
            </h2>
            <span className="text-xs text-text-secondary font-mono">
              {!serversLoaded
                ? "loading…"
                : `${servers.length} server${servers.length !== 1 ? "s" : ""}`}
            </span>
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
        </section>

        {/* SERVICES zone (zone 3, Cockpit host-console home). A listening TCP
            port is a HOST property (not owned by any tmux window/session), so
            `/` — the box-level console — is its home. The backend probes each
            listening port and broadcasts ONLY the ports that answer HTTP (see
            internal/ports probe filter), so every tile here provably speaks
            HTTP — no client-side denylist heuristic is needed and "Open in
            window" is gated solely on a tmux server existing. Each tile opens
            that port's UI in an @rk_type=iframe tmux window via the /proxy/{port}/
            proxy. Placed last, after the tmux-server tiles. */}
        <section aria-label="Services" className="mb-6 max-w-md">
          <h2 className="rk-label-caret text-xs uppercase tracking-wide text-text-secondary mb-2">
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
                    disabled={servers.length === 0}
                    title={
                      servers.length === 0 ? "Create a server first" : undefined
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
