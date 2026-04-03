import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { listServers, createServer } from "@/api/client";
import { Dialog } from "@/components/dialog";
import { useOptimisticAction } from "@/hooks/use-optimistic-action";
import { useToast } from "@/components/toast";

export function ServerListPage() {
  const [servers, setServers] = useState<string[]>([]);
  const [ghostServers, setGhostServers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState("");
  const navigate = useNavigate();
  const { addToast } = useToast();
  const ghostNameRef = useRef<string | null>(null);

  const fetchServers = useCallback(async () => {
    try {
      const data = await listServers();
      setServers(data);
      // Reconcile: remove ghost servers that now exist in real data
      setGhostServers((prev) => prev.filter((g) => !data.includes(g)));
    } catch {
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

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
  });

  const handleCreate = useCallback(() => {
    const trimmed = createName.trim();
    if (!trimmed || !/^[a-zA-Z0-9_-]+$/.test(trimmed)) return;
    executeCreateServer(trimmed);
    navigate({
      to: "/$server",
      params: { server: trimmed },
    });
    setShowCreateDialog(false);
    setCreateName("");
  }, [createName, navigate, executeCreateServer]);

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      {/* Minimal header */}
      <header className="shrink-0 px-4 sm:px-6 pt-6 pb-2 flex items-center gap-3">
        <img src="/icon.svg" alt="Run Kit" width={24} height={24} />
        <span className="text-sm text-text-secondary">Run Kit</span>
      </header>

      {/* Server list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pb-6">
        <div className="text-sm text-text-secondary mb-4">
          {loading
            ? "Loading servers..."
            : `${servers.length} server${servers.length !== 1 ? "s" : ""}`}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {servers.map((name) => (
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
            </button>
          ))}

          {/* Ghost server cards */}
          {ghostServers.map((name) => (
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
